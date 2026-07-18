#import "PrivateVaultBootstrapReplay.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultAuthorityStoreInternal.h"
#import "PrivateVaultCustodyRepositoryRecoveryInternal.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultGenesisAccountAdmission.h"
#import "PrivateVaultGenesisBuilder.h"
#import "PrivateVaultRecoveryBuilder.h"

#include <assert.h>
#include <stdio.h>

static NSMutableDictionary<NSString *, NSData *> *gRecoveryKeychain;
static NSString *RecoveryKeychainKey(NSDictionary *query) {
  return [NSString
      stringWithFormat:@"%@|%@", query[(__bridge id)kSecAttrService],
                       query[(__bridge id)kSecAttrAccount]];
}
static OSStatus RecoveryKeychainCopy(CFDictionaryRef raw, CFTypeRef *result) {
  NSData *value =
      gRecoveryKeychain[RecoveryKeychainKey((__bridge NSDictionary *)raw)];
  if (value == nil)
    return errSecItemNotFound;
  if (result != NULL)
    *result = CFBridgingRetain([value copy]);
  return errSecSuccess;
}
static OSStatus RecoveryKeychainAdd(CFDictionaryRef raw, CFTypeRef *result) {
  (void)result;
  NSDictionary *attributes = (__bridge NSDictionary *)raw;
  NSString *key = RecoveryKeychainKey(attributes);
  if (gRecoveryKeychain[key] != nil)
    return errSecDuplicateItem;
  NSData *value = attributes[(__bridge id)kSecValueData];
  gRecoveryKeychain[key] =
      [NSData dataWithBytes:value.bytes length:value.length];
  return errSecSuccess;
}
static OSStatus RecoveryKeychainUpdate(CFDictionaryRef rawQuery,
                                       CFDictionaryRef rawAttributes) {
  NSString *key =
      RecoveryKeychainKey((__bridge NSDictionary *)rawQuery);
  if (gRecoveryKeychain[key] == nil)
    return errSecItemNotFound;
  NSDictionary *attributes = (__bridge NSDictionary *)rawAttributes;
  NSData *value = attributes[(__bridge id)kSecValueData];
  gRecoveryKeychain[key] =
      [NSData dataWithBytes:value.bytes length:value.length];
  return errSecSuccess;
}
static OSStatus RecoveryKeychainDelete(CFDictionaryRef raw) {
  NSString *key = RecoveryKeychainKey((__bridge NSDictionary *)raw);
  if (gRecoveryKeychain[key] == nil)
    return errSecItemNotFound;
  [gRecoveryKeychain removeObjectForKey:key];
  return errSecSuccess;
}
static AncPrivateVaultCustodyRepository *RecoveryRepository(void) {
  AncPrivateVaultSecItemFunctions functions = {
      .copyMatching = RecoveryKeychainCopy,
      .add = RecoveryKeychainAdd,
      .update = RecoveryKeychainUpdate,
      .deleteItem = RecoveryKeychainDelete,
  };
  AncPrivateVaultKeychain *keychain =
      [[AncPrivateVaultKeychain alloc] initWithFunctions:functions
                                          contextFactory:^LAContext * {
                                            return [[LAContext alloc] init];
                                          }];
  return [[AncPrivateVaultCustodyRepository alloc] initWithKeychain:keychain];
}

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
           replay.replacementRecoveryAuthority.recoveryGeneration == 2 &&
           fixture.entropy.isClosed);
    __block BOOL eekMatches = NO;
    assert([replay.verifiedEEK borrow:^BOOL(uint8_t *bytes, size_t length) {
             eekMatches = length == fixture.expectedEEK.length &&
                          memcmp(bytes, fixture.expectedEEK.bytes, length) == 0;
             return eekMatches;
           }] == AncPrivateVaultGuardedMemoryStatusOK);
    assert(eekMatches);
    AncPrivateVaultGuardedMemory *candidateSigning =
        Guarded(Pattern(0x31, 32));
    AncPrivateVaultGuardedMemory *candidateAgreement =
        Guarded(Pattern(0x32, 32));
    AncPrivateVaultRecoveryBuilderStatus builderStatus;
    AncPrivateVaultPreparedRecoveryArtifacts *prepared =
        AncPrivateVaultBuildRecoveryArtifacts(
            replay, candidateSigning, candidateAgreement, Pattern(0x33, 16),
            Pattern(0x34, 16), Pattern(0x35, 16), Pattern(0x36, 16),
            Pattern(0x37, 16), Pattern(0x38, 16), Pattern(0x39, 16),
            Pattern(0x3a, 24), Pattern(0x3b, 32),
            UINT64_C(1721200060000), &builderStatus);
    assert(prepared != nil &&
           builderStatus == AncPrivateVaultRecoveryBuilderStatusOK &&
           prepared.signedEntry.length > 0 &&
           prepared.recoveryWrap.length > 0 &&
           prepared.currentSnapshot.length > 0 &&
           prepared.recoveryAuthorization.length > 0 &&
           prepared.entryHash.length == 32 &&
           prepared.authorizationHash.length == 32 &&
           prepared.snapshotHash.length == 32 &&
           prepared.nextState.sequence == 1 && prepared.nextState.epoch == 2 &&
           prepared.nextState.recoveryGeneration == 2 &&
           prepared.nextState.activeMembers.count == 1 &&
           [prepared.nextState.activeMembers[0].endpointId
               isEqualToString:Hex(Pattern(0x34, 16))]);
    AncPrivateVaultVerifiedReplayResult *recoveryCapability =
        AncPrivateVaultVerifiedRecoveryBootstrapResultCreate(
            prepared, UINT64_C(1721200060000));
    assert(recoveryCapability != nil &&
           recoveryCapability.expectedCheckpoint == nil &&
           recoveryCapability.nextSnapshot.targetCustodyGeneration == 2 &&
           recoveryCapability.nextSnapshot.previousCustodyGeneration == 1 &&
           recoveryCapability.nextSnapshot.previousSequence.unsignedLongLongValue ==
               0 &&
           [recoveryCapability.nextSnapshot.previousHead
               isEqualToData:replay.state.headHash] &&
           recoveryCapability.nextSnapshot.sequence == 1 &&
           recoveryCapability.nextSnapshot.epoch == 2 &&
           recoveryCapability.nextSnapshot.recoveryGeneration == 2);
    gRecoveryKeychain = [NSMutableDictionary dictionary];
    AncPrivateVaultCustodyRepository *repository = RecoveryRepository();
    NSMutableData *localStateKey = [Pattern(0x3c, 32) mutableCopy];
    NSMutableData *zeroEpochKey = [NSMutableData dataWithLength:32];
    __block AncPrivateVaultCustodyRepositoryStatus installStatus =
        AncPrivateVaultCustodyRepositoryStatusFailed;
    AncPrivateVaultGuardedMemoryStatus signingBorrow =
        [candidateSigning borrow:^BOOL(uint8_t *signingBytes,
                                        size_t signingLength) {
      return [candidateAgreement borrow:^BOOL(uint8_t *agreementBytes,
                                               size_t agreementLength) {
        return [replay.verifiedEEK borrow:^BOOL(uint8_t *eekBytes,
                                                size_t eekLength) {
          if (signingLength != 32 || agreementLength != 32 ||
              eekLength != 32)
            return NO;
          AncPrivateVaultCustodySecretInputs secrets = {
              .signing_seed = signingBytes,
              .box_seed = agreementBytes,
              .local_state_key = localStateKey.mutableBytes,
              .active_epoch_key = zeroEpochKey.mutableBytes,
              .pending_epoch_key = eekBytes,
          };
          installStatus = [repository
              installPendingRecoveryVaultId:replay.state.vaultId
                                  endpointId:Hex(Pattern(0x34, 16))
                                  ceremonyId:Hex(Pattern(0x33, 16))
                             signingPublicKey:
                                 prepared.candidateSigningPublicKey
                                  boxPublicKey:
                                      prepared.candidateKeyAgreementPublicKey
                                    nextEpoch:prepared.nextState.epoch
                    replacementRecoveryGeneration:
                        prepared.nextState.recoveryGeneration
                            expectedNextSequence:prepared.nextState.sequence
                             expectedPreviousHead:replay.state.headHash
                       recoveryAuthorizationHash:
                           prepared.authorizationHash
                                     secrets:&secrets
                                  checkpoint:nil];
          return installStatus == AncPrivateVaultCustodyRepositoryStatusOK;
        }] == AncPrivateVaultGuardedMemoryStatusOK;
      }] == AncPrivateVaultGuardedMemoryStatusOK;
    }];
    assert(signingBorrow == AncPrivateVaultGuardedMemoryStatusOK);
    assert(installStatus == AncPrivateVaultCustodyRepositoryStatusOK);
    NSString *authorityRoot = [NSTemporaryDirectory()
        stringByAppendingPathComponent:[NSString
            stringWithFormat:@"recovery-authority-%@",
                             NSUUID.UUID.UUIDString]];
    assert([NSFileManager.defaultManager
               createDirectoryAtPath:authorityRoot
         withIntermediateDirectories:YES
                          attributes:@{NSFilePosixPermissions : @0700}
                               error:nil]);
    AncPrivateVaultAuthorityStore *authorityStore =
        [[AncPrivateVaultAuthorityStore alloc]
            initWithStateRootURL:
                [NSURL fileURLWithPath:authorityRoot isDirectory:YES]
               custodyRepository:repository];
    AncPrivateVaultAuthorityCheckpoint *committed = nil;
    assert([authorityStore
               commitVerifiedReplayResult:recoveryCapability
                                    vaultId:replay.state.vaultId
                               verifiedAtMs:UINT64_C(1721200060000)
                                 checkpoint:&committed
                                      error:nil] ==
           AncPrivateVaultAuthorityStoreStatusOK);
    assert(committed.custodyGeneration == 2 &&
           committed.snapshot.sequence == prepared.nextState.sequence &&
           [committed.snapshot.headHash isEqualToData:prepared.entryHash]);
    AncPrivateVaultCustodySnapshot promoted;
    AncPrivateVaultCustodyHandle *promotedHandle = nil;
    assert([repository readVaultId:replay.state.vaultId snapshot:&promoted
                              handle:&promotedHandle] ==
           AncPrivateVaultCustodyRepositoryStatusOK);
    assert(promoted.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
           promoted.authority_anchor_present && promoted.active_epoch == 2 &&
           promoted.pending_epoch == 0 && promoted.custody_generation == 2);
    __block BOOL promotedEEKMatches = NO;
    assert([promotedHandle
               borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
                 promotedEEKMatches =
                     memcmp(secrets->active_epoch_key,
                            fixture.expectedEEK.bytes, 32) == 0 &&
                     memcmp(secrets->pending_epoch_key,
                            zeroEpochKey.bytes, 32) == 0;
                 return promotedEEKMatches;
               }] == AncPrivateVaultCustodyRepositoryStatusOK);
    assert(promotedEEKMatches &&
           [promotedHandle close] ==
               AncPrivateVaultCustodyRepositoryStatusOK);
    AncPrivateVaultVerifiedReplayResult *retryCapability =
        AncPrivateVaultVerifiedRecoveryBootstrapResultCreate(
            prepared, UINT64_C(1721200060000));
    assert(retryCapability != nil &&
           [authorityStore
               commitVerifiedReplayResult:retryCapability
                                    vaultId:replay.state.vaultId
                               verifiedAtMs:UINT64_C(1721200060000)
                                 checkpoint:nil
                                      error:nil] ==
               AncPrivateVaultAuthorityStoreStatusOK);
    assert([NSFileManager.defaultManager removeItemAtPath:authorityRoot
                                                    error:nil]);
    anc_pv_zeroize(localStateKey.mutableBytes, localStateKey.length);
    anc_pv_zeroize(zeroEpochKey.mutableBytes, zeroEpochKey.length);
    assert(!candidateSigning.isClosed && !candidateAgreement.isClosed);
    assert([candidateSigning close] == AncPrivateVaultGuardedMemoryStatusOK);
    assert([candidateAgreement close] == AncPrivateVaultGuardedMemoryStatusOK);
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
           replay.currentRecoveryAuthority == nil &&
           replay.replacementRecoveryAuthority == nil);
    candidateSigning = Guarded(Pattern(0x41, 32));
    candidateAgreement = Guarded(Pattern(0x42, 32));
    assert(AncPrivateVaultBuildRecoveryArtifacts(
               replay, candidateSigning, candidateAgreement,
               Pattern(0x43, 16), Pattern(0x44, 16), Pattern(0x45, 16),
               Pattern(0x46, 16), Pattern(0x47, 16), Pattern(0x48, 16),
               Pattern(0x49, 16), Pattern(0x4a, 24), Pattern(0x4b, 32),
               UINT64_C(1721200060000), &builderStatus) == nil &&
           builderStatus == AncPrivateVaultRecoveryBuilderStatusInvalidArgument);
    assert([candidateSigning close] == AncPrivateVaultGuardedMemoryStatusOK);
    assert([candidateAgreement close] == AncPrivateVaultGuardedMemoryStatusOK);
  }
  puts("private-vault bootstrap replay tests passed");
  return 0;
}
