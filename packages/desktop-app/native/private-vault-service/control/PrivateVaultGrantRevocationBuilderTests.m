#import <Foundation/Foundation.h>

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultGrantCodec.h"
#import "PrivateVaultGrantRevocationBuilder.h"

#include <assert.h>

static AncPrivateVaultCanonicalValue *I(int64_t value) {
  return [AncPrivateVaultCanonicalValue integer:value];
}
static AncPrivateVaultCanonicalValue *T(NSString *value) {
  return [AncPrivateVaultCanonicalValue text:value];
}
static AncPrivateVaultCanonicalValue *B(NSData *value) {
  return [AncPrivateVaultCanonicalValue bytes:value];
}
static NSData *Pattern(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}
static NSString *Hex(NSData *value) {
  NSMutableString *result = [NSMutableString stringWithCapacity:value.length * 2];
  const uint8_t *bytes = value.bytes;
  for (NSUInteger index = 0; index < value.length; index += 1)
    [result appendFormat:@"%02x", bytes[index]];
  return result;
}
static NSData *Encode(
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map) {
  AncPrivateVaultCanonicalStatus status;
  NSData *result = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:map], &status);
  assert(result != nil && status == AncPrivateVaultCanonicalStatusOK);
  return result;
}
static NSData *SignedEntry(NSData *vaultId, NSString *endpointId,
                           NSData *inner, const uint8_t privateKey[64]) {
  NSMutableDictionary *entry = [@{
    @1 : T(@"anc/v1"), @2 : T(Hex(vaultId)), @3 : T(@"log-entry"),
    @4 : T(@"2024-07-16T06:25:10.000Z"),
    @5 : T(@"log-entry:genesis-0001"), @110 : I(0),
    @111 : B(Pattern(0, 32)), @112 : B(inner), @113 : T(endpointId),
  } mutableCopy];
  NSData *unsignedBytes = Encode(entry);
  static const char domain[] = "anc/v1/log-entry";
  NSMutableData *message =
      [NSMutableData dataWithBytes:domain length:sizeof domain];
  [message appendData:unsignedBytes];
  uint8_t signature[64] = {0};
  assert(anc_pv_ed25519_sign(signature, message.bytes, message.length,
                             privateKey) == ANC_PV_CRYPTO_OK);
  entry[@114] = B([NSData dataWithBytes:signature length:sizeof signature]);
  anc_pv_zeroize(signature, sizeof signature);
  return Encode(entry);
}

@interface GenesisVerifier
    : NSObject <AncPrivateVaultControlLogAuthorizationVerifier>
@end
@implementation GenesisVerifier
- (BOOL)verifyGenesisMembershipCommit:
            (AncPrivateVaultControlLogMembershipCommit *)commit
                           signedEntry:
                               (AncPrivateVaultControlLogSignedEntry *)entry
                      signedEntryBytes:(NSData *)signedEntryBytes
                    innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  return [commit.ceremonyKind isEqualToString:@"first_device"] &&
      entry.sequence == 0 && signedEntryBytes.length > innerEnvelopeBytes.length;
}
@end

@interface RevocationVerifier
    : NSObject <AncPrivateVaultControlLogAuthorizationVerifier>
@property(nonatomic) AncPrivateVaultVerifiedGrant *grant;
@property(nonatomic) NSData *vaultId;
@property(nonatomic) NSData *publicKey;
@property(nonatomic) NSData *expectedEnvelope;
@end
@implementation RevocationVerifier
- (BOOL)verifyGrantRevocationSignedEntry:(NSData *)signedEntry
                           innerEnvelope:(NSData *)innerEnvelope
                      revocationEnvelope:(NSData *)revocationEnvelope
                            currentState:(AncPrivateVaultControlLogState *)state {
  if (signedEntry.length <= innerEnvelope.length || state == nil ||
      ![revocationEnvelope isEqualToData:self.expectedEnvelope])
    return NO;
  AncPrivateVaultGrantCodecStatus status;
  return AncPrivateVaultVerifyGrantRevocationEnvelope(
             revocationEnvelope, self.vaultId, self.grant,
             self.publicKey.bytes, &status) != nil &&
      status == AncPrivateVaultGrantCodecStatusOK;
}
@end

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    NSData *vaultId = Pattern(0x01, 16);
    NSData *endpointId = Pattern(0x02, 16);
    uint8_t seed[32];
    memset(seed, 0x11, sizeof seed);
    uint8_t publicKey[32] = {0};
    uint8_t privateKey[64] = {0};
    assert(anc_pv_ed25519_seed_keypair(publicKey, privateKey, seed) ==
           ANC_PV_CRYPTO_OK);
    NSData *publicData = [NSData dataWithBytes:publicKey length:sizeof publicKey];
    NSString *endpointText = Hex(endpointId);
    AncPrivateVaultCanonicalValue *member =
        [AncPrivateVaultCanonicalValue array:@[
          T(endpointText), T(@"endpoint"),
          [AncPrivateVaultCanonicalValue boolean:NO], B(publicData),
          B(Pattern(0x41, 32)), T(@"enrollment:owner-0001"),
        ]];
    NSData *genesisInner = Encode(@{
      @1 : T(@"anc/v1"), @2 : T(Hex(vaultId)),
      @3 : T(@"membership_commit"), @140 : T(@"ceremony:first-0001"),
      @141 : T(@"first_device"), @142 : I(1),
      @143 : [AncPrivateVaultCanonicalValue nullValue],
      @144 : [AncPrivateVaultCanonicalValue array:@[member]],
      @145 : [AncPrivateVaultCanonicalValue array:@[]],
      @146 : [AncPrivateVaultCanonicalValue boolean:NO],
      @147 : [AncPrivateVaultCanonicalValue boolean:NO],
      @148 : [AncPrivateVaultCanonicalValue nullValue],
      @149 : [AncPrivateVaultCanonicalValue nullValue], @155 : I(1),
      @156 : T(@"recovery:authority-0001"), @157 : B(Pattern(0xc1, 32)),
      @158 : B(Pattern(0xd1, 32)), @159 : B(Pattern(0xe1, 32)),
    });
    NSData *genesis = SignedEntry(vaultId, endpointText, genesisInner, privateKey);
    AncPrivateVaultControlLogReplayResult *genesisReplay = nil;
    AncPrivateVaultControlLogStatus logStatus =
        [[AncPrivateVaultControlLog new]
            replaySignedEntry:genesis
                currentState:nil
                    verifier:[GenesisVerifier new]
                      result:&genesisReplay];
    assert(logStatus == AncPrivateVaultControlLogStatusOK &&
           genesisReplay != nil);

    AncPrivateVaultGrantCodecStatus grantStatus;
    NSData *sealedGrant = AncPrivateVaultSealGrantEnvelope(
        vaultId, Pattern(0x16, 16), 1721111111, Pattern(0x05, 16),
        endpointId, Pattern(0x07, 16), endpointId, Pattern(0x08, 16),
        @[Pattern(0x04, 16)], @[@"read"], @[@"content"], 1721111111,
        1721114711, Pattern(0x09, 16), seed, &grantStatus);
    AncPrivateVaultVerifiedGrant *grant = AncPrivateVaultVerifyGrantEnvelope(
        sealedGrant, vaultId, 1721111112, endpointId, publicKey, &grantStatus);
    assert(grantStatus == AncPrivateVaultGrantCodecStatusOK && grant != nil);

    AncPrivateVaultGrantRevocationBuildResult *built =
        AncPrivateVaultBuildGrantRevocation(
            genesisReplay.state, grant, Pattern(0x31, 16),
            @"log-entry:grant-revoke-0001",
            @"2024-07-16T06:25:13.000Z", 1721111113, @"user_revoked",
            seed);
    assert(built.signedEntry.length > built.revocationEnvelope.length &&
           built.revocationEnvelope.length > 0);

    RevocationVerifier *verifier = [RevocationVerifier new];
    verifier.grant = grant;
    verifier.vaultId = vaultId;
    verifier.publicKey = publicData;
    verifier.expectedEnvelope = built.revocationEnvelope;
    AncPrivateVaultControlLogReplayResult *replay = nil;
    logStatus = [[AncPrivateVaultControlLog new]
        replaySignedEntry:built.signedEntry
            currentState:genesisReplay.state
                verifier:verifier
                  result:&replay];
    assert(logStatus == AncPrivateVaultControlLogStatusOK && replay != nil &&
           replay.state.sequence == 1 &&
           [replay.state.membershipHash
               isEqualToData:genesisReplay.state.membershipHash]);

    uint8_t wrongSeed[32];
    memset(wrongSeed, 0xee, sizeof wrongSeed);
    assert(AncPrivateVaultBuildGrantRevocation(
               genesisReplay.state, grant, Pattern(0x31, 16),
               @"log-entry:grant-revoke-0002",
               @"2024-07-16T06:25:13.000Z", 1721111113,
               @"user_revoked", wrongSeed) == nil);
    assert(AncPrivateVaultBuildGrantRevocation(
               genesisReplay.state, grant, Pattern(0x31, 16),
               @"log-entry:grant-revoke-0003",
               @"2024-07-16T06:25:13.000Z", 1721111112,
               @"user_revoked", seed) == nil);
    NSMutableData *tampered = [built.signedEntry mutableCopy];
    ((uint8_t *)tampered.mutableBytes)[tampered.length - 1] ^= 1;
    assert([[AncPrivateVaultControlLog new]
               replaySignedEntry:tampered
                   currentState:genesisReplay.state
                       verifier:verifier
                         result:&replay] !=
           AncPrivateVaultControlLogStatusOK);

    anc_pv_zeroize(seed, sizeof seed);
    anc_pv_zeroize(wrongSeed, sizeof wrongSeed);
    anc_pv_zeroize(publicKey, sizeof publicKey);
    anc_pv_zeroize(privateKey, sizeof privateKey);
  }
  return 0;
}
