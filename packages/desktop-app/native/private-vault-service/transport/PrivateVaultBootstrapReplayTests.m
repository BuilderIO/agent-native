#import "PrivateVaultBootstrapReplay.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultGenesisAccountAdmission.h"
#import "PrivateVaultGenesisBuilder.h"

#include <assert.h>
#include <stdio.h>

static NSData *Pattern(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

static AncPrivateVaultGuardedMemory *Guarded(NSData *value) {
  AncPrivateVaultGuardedMemoryStatus status;
  AncPrivateVaultGuardedMemory *memory =
      [AncPrivateVaultGuardedMemory memoryWithLength:value.length
                                              status:&status];
  assert(memory != nil);
  assert([memory borrow:^BOOL(uint8_t *bytes, size_t length) {
           memcpy(bytes, value.bytes, length);
           return YES;
         }] == AncPrivateVaultGuardedMemoryStatusOK);
  return memory;
}

static NSString *Hex(NSData *data) {
  static const char digits[] = "0123456789abcdef";
  NSMutableData *encoded = [NSMutableData dataWithLength:data.length * 2];
  const uint8_t *input = data.bytes;
  uint8_t *output = encoded.mutableBytes;
  for (NSUInteger index = 0; index < data.length; index += 1) {
    output[index * 2] = digits[input[index] >> 4];
    output[index * 2 + 1] = digits[input[index] & 15];
  }
  return [[NSString alloc] initWithData:encoded
                               encoding:NSASCIIStringEncoding];
}

static NSData *Hash(NSString *domain, NSData *payload) {
  NSData *domainBytes = [domain dataUsingEncoding:NSASCIIStringEncoding];
  NSMutableData *terminated = [domainBytes mutableCopy];
  uint8_t zero = 0;
  [terminated appendBytes:&zero length:1];
  uint8_t digest[32] = {0};
  assert(anc_pv_blake2b_256_two_part(
             digest, terminated.bytes, terminated.length, payload.bytes,
             payload.length) == ANC_PV_CRYPTO_OK);
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static NSData *SignedEntry(NSData *authorization) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      authorization, 256 * 1024, &status);
  AncPrivateVaultCanonicalValue *entry = root.mapValue[@375];
  assert(entry.type == AncPrivateVaultCanonicalTypeBytes &&
         entry.bytesValue.length > 0);
  return entry.bytesValue;
}

static AncPrivateVaultBootstrapFrame *Frame(NSData *entry, NSData *wrap,
                                             NSData *candidate,
                                             NSData *headHash,
                                             NSData *wrapHash,
                                             NSData *finalWrap,
                                             NSString *vaultId) {
  NSDictionary *control = @{
    @"version" : @1,
    @"suite" : @"anc/v1",
    @"type" : @"vault-bootstrap-response",
    @"vaultId" : vaultId,
    @"afterSequence" : @-1,
    @"throughSequence" : @0,
    @"head" : @{ @"sequence" : @0, @"hash" : Hex(headHash) },
    @"complete" : @YES,
    @"entryByteLengths" : @[ @(entry.length) ],
    @"entryRecoveryWrapByteLengths" : @[ @(wrap.length) ],
    @"entryEvidenceKinds" : @[ @"genesis" ],
    @"entryEvidenceByteLengths" : @[ @(candidate.length) ],
    @"recoveryWrapHash" : Hex(wrapHash),
    @"recoveryWrapByteLength" : @(finalWrap.length),
  };
  NSError *error = nil;
  NSData *json = [NSJSONSerialization dataWithJSONObject:control
                                                 options:0
                                                   error:&error];
  assert(error == nil && json.length > 0 && json.length <= 8 * 1024);
  uint32_t length = (uint32_t)json.length;
  uint8_t prefix[4] = {(uint8_t)(length >> 24), (uint8_t)(length >> 16),
                       (uint8_t)(length >> 8), (uint8_t)length};
  NSMutableData *encoded = [NSMutableData dataWithBytes:prefix length:4];
  [encoded appendData:json];
  [encoded appendData:entry];
  [encoded appendData:wrap];
  [encoded appendData:candidate];
  [encoded appendData:finalWrap];
  AncPrivateVaultBootstrapFrameStatus status;
  AncPrivateVaultBootstrapFrame *frame =
      AncPrivateVaultBootstrapFrameDecode(encoded, &status);
  assert(frame != nil && status == AncPrivateVaultBootstrapFrameStatusOK);
  return frame;
}

@interface GenesisFixture : NSObject
@property(nonatomic) AncPrivateVaultGuardedMemory *entropy;
@property(nonatomic) AncPrivateVaultGuardedMemory *signingSeed;
@property(nonatomic) AncPrivateVaultGuardedMemory *agreementSeed;
@property(nonatomic) AncPrivateVaultGuardedMemory *eek;
@property(nonatomic) NSData *expectedEEK;
@property(nonatomic) AncPrivateVaultBootstrapFrame *frame;
@end
@implementation GenesisFixture
@end

static GenesisFixture *BuildFixture(BOOL corruptFinalWrap) {
  NSData *entropyBytes = Pattern(0x11, 32);
  NSData *signingBytes = Pattern(0x12, 32);
  NSData *agreementBytes = Pattern(0x13, 32);
  NSData *eekBytes = Pattern(0x14, 32);
  AncPrivateVaultGuardedMemory *entropy = Guarded(entropyBytes);
  AncPrivateVaultGuardedMemory *signing = Guarded(signingBytes);
  AncPrivateVaultGuardedMemory *agreement = Guarded(agreementBytes);
  AncPrivateVaultGuardedMemory *eek = Guarded(eekBytes);
  NSData *vaultId = Pattern(0x21, 16);
  AncPrivateVaultGenesisBuilderStatus builderStatus;
  AncPrivateVaultPreparedGenesisArtifacts *artifacts =
      AncPrivateVaultBuildGenesisArtifacts(
          entropy, signing, agreement, eek, vaultId, Pattern(0x22, 16),
          Pattern(0x23, 16), Pattern(0x24, 16), Pattern(0x25, 16),
          Pattern(0x26, 16), Pattern(0x27, 16), Pattern(0x28, 24),
          1721200000, 1721200010, 1721200020, 1721200030, 1721200040,
          &builderStatus);
  assert(artifacts != nil &&
         builderStatus == AncPrivateVaultGenesisBuilderStatusOK);
  AncPrivateVaultGenesisAdmissionStatus admissionStatus;
  NSData *candidate = AncPrivateVaultGenesisAdmissionCandidateEncode(
      artifacts.bootstrapTranscript, artifacts.recoveryConfirmation,
      artifacts.authorization, &admissionStatus);
  assert(candidate != nil &&
         admissionStatus == AncPrivateVaultGenesisAdmissionStatusOK);
  NSData *entry = SignedEntry(artifacts.authorization);
  NSData *headHash = Hash(@"anc/v1/log-entry", entry);
  NSData *wrapHash = Hash(@"anc/v1/recovery-wrap", artifacts.recoveryWrap);
  NSData *finalWrap = artifacts.recoveryWrap;
  if (corruptFinalWrap) {
    NSMutableData *corrupt = [finalWrap mutableCopy];
    ((uint8_t *)corrupt.mutableBytes)[corrupt.length - 1] ^= 1;
    finalWrap = corrupt;
  }
  AncPrivateVaultBootstrapFrame *frame =
      Frame(entry, artifacts.recoveryWrap, candidate, headHash, wrapHash,
            finalWrap, Hex(vaultId));
  GenesisFixture *fixture = [GenesisFixture new];
  fixture.entropy = entropy;
  fixture.signingSeed = signing;
  fixture.agreementSeed = agreement;
  fixture.eek = eek;
  fixture.expectedEEK = eekBytes;
  fixture.frame = frame;
  return fixture;
}

static void CloseInputs(GenesisFixture *fixture) {
  assert([fixture.signingSeed close] ==
         AncPrivateVaultGuardedMemoryStatusOK);
  assert([fixture.agreementSeed close] ==
         AncPrivateVaultGuardedMemoryStatusOK);
  assert([fixture.eek close] == AncPrivateVaultGuardedMemoryStatusOK);
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    GenesisFixture *fixture = BuildFixture(NO);
    CloseInputs(fixture);
    AncPrivateVaultBootstrapReplayStatus status;
    AncPrivateVaultBootstrapReplay *replay =
        [[AncPrivateVaultBootstrapReplay alloc]
            initWithOwnedRecoveryEntropy:fixture.entropy
                  trustedNowMilliseconds:UINT64_C(1721200060000)
                                  status:&status];
    assert(replay != nil && status == AncPrivateVaultBootstrapReplayStatusOK);
    assert([replay consumeFrame:fixture.frame status:&status]);
    assert(replay.isComplete && replay.state.sequence == 0 &&
           replay.currentRecoveryAuthority.recoveryGeneration == 1 &&
           fixture.entropy.isClosed);
    __block BOOL eekMatches = NO;
    assert([replay.verifiedEEK borrow:^BOOL(uint8_t *bytes, size_t length) {
             eekMatches = length == fixture.expectedEEK.length &&
                          memcmp(bytes, fixture.expectedEEK.bytes, length) == 0;
             return eekMatches;
           }] == AncPrivateVaultGuardedMemoryStatusOK);
    assert(eekMatches);
    [replay invalidate];

    GenesisFixture *corrupt = BuildFixture(YES);
    CloseInputs(corrupt);
    replay = [[AncPrivateVaultBootstrapReplay alloc]
        initWithOwnedRecoveryEntropy:corrupt.entropy
              trustedNowMilliseconds:UINT64_C(1721200060000)
                              status:&status];
    assert(replay != nil);
    assert(![replay consumeFrame:corrupt.frame status:&status]);
    assert(status == AncPrivateVaultBootstrapReplayStatusFinalWrap &&
           corrupt.entropy.isClosed && replay.verifiedEEK == nil &&
           replay.currentRecoveryAuthority == nil);
  }
  puts("private-vault bootstrap replay tests passed");
  return 0;
}
