#import <Foundation/Foundation.h>

#include <assert.h>

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultContinuityBuilder.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultCrypto.h"

static AncPrivateVaultCanonicalValue *T(NSString *value) {
  return [AncPrivateVaultCanonicalValue text:value];
}
static AncPrivateVaultCanonicalValue *I(int64_t value) {
  return [AncPrivateVaultCanonicalValue integer:value];
}
static AncPrivateVaultCanonicalValue *B(NSData *value) {
  return [AncPrivateVaultCanonicalValue bytes:value];
}
static NSData *Pattern(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

static NSData *SignEntry(NSDictionary *unsignedMap,
                         const uint8_t signingPrivate[64]) {
  AncPrivateVaultCanonicalStatus status;
  NSData *unsignedBytes = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:unsignedMap], &status);
  assert(unsignedBytes != nil && status == AncPrivateVaultCanonicalStatusOK);
  static const char domain[] = "anc/v1/log-entry";
  NSMutableData *message =
      [NSMutableData dataWithBytes:domain length:sizeof domain];
  [message appendData:unsignedBytes];
  uint8_t signature[64] = {0};
  assert(anc_pv_ed25519_sign(signature, message.bytes, message.length,
                             signingPrivate) == ANC_PV_CRYPTO_OK);
  NSMutableDictionary *signedMap = [unsignedMap mutableCopy];
  signedMap[@114] = B([NSData dataWithBytes:signature length:sizeof signature]);
  anc_pv_zeroize(signature, sizeof signature);
  return AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:signedMap], &status);
}

@interface ContinuityGenesisVerifier
    : NSObject <AncPrivateVaultControlLogAuthorizationVerifier>
@end
@implementation ContinuityGenesisVerifier
- (BOOL)verifyGenesisMembershipCommit:
            (AncPrivateVaultControlLogMembershipCommit *)commit
                            signedEntry:
                                (AncPrivateVaultControlLogSignedEntry *)entry
                       signedEntryBytes:(NSData *)signedEntryBytes
                     innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  return commit != nil && entry != nil && signedEntryBytes.length > 0 &&
      innerEnvelopeBytes.length > 0;
}
@end

static AncPrivateVaultControlLogState *Genesis(
    NSString *vaultId, NSString *endpointId, NSData *signingPublicKey,
    const uint8_t signingPrivate[64]) {
  AncPrivateVaultCanonicalStatus status;
  NSData *inner = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:@{
        @1 : T(@"anc/v1"),
        @2 : T(vaultId),
        @3 : T(@"membership_commit"),
        @140 : T(@"ceremony:first-device-0001"),
        @141 : T(@"first_device"),
        @142 : I(1),
        @143 : [AncPrivateVaultCanonicalValue nullValue],
        @144 : [AncPrivateVaultCanonicalValue array:@[
          [AncPrivateVaultCanonicalValue array:@[
            T(endpointId), T(@"endpoint"),
            [AncPrivateVaultCanonicalValue boolean:NO], B(signingPublicKey),
            B(Pattern(0x42, 32)), T(@"enrollment:first-device-0001")
          ]]
        ]],
        @145 : [AncPrivateVaultCanonicalValue array:@[]],
        @146 : [AncPrivateVaultCanonicalValue boolean:NO],
        @147 : [AncPrivateVaultCanonicalValue boolean:NO],
        @148 : [AncPrivateVaultCanonicalValue nullValue],
        @149 : [AncPrivateVaultCanonicalValue nullValue],
        @155 : I(1),
        @156 : T(@"recovery:authority-0001"),
        @157 : B(Pattern(0x51, 32)),
        @158 : B(Pattern(0x52, 32)),
        @159 : B(Pattern(0x53, 32)),
      }],
      &status);
  assert(inner != nil && status == AncPrivateVaultCanonicalStatusOK);
  NSDictionary *unsignedMap = @{
    @1 : T(@"anc/v1"),
    @2 : T(vaultId),
    @3 : T(@"log-entry"),
    @4 : T(@"2026-07-19T09:00:00.000Z"),
    @5 : T(@"log-entry:genesis-0001"),
    @110 : I(0),
    @111 : B(Pattern(0, 32)),
    @112 : B(inner),
    @113 : T(endpointId),
  };
  NSData *entry = SignEntry(unsignedMap, signingPrivate);
  AncPrivateVaultControlLogReplayResult *replay = nil;
  assert([[AncPrivateVaultControlLog new]
             replaySignedEntry:entry
                 currentState:nil
                     verifier:[ContinuityGenesisVerifier new]
                       result:&replay] == AncPrivateVaultControlLogStatusOK);
  assert(replay != nil && replay.state.sequence == 0);
  return replay.state;
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    uint8_t seed[32] = {0};
    memset(seed, 0x31, sizeof seed);
    uint8_t publicKey[32] = {0};
    uint8_t privateKey[64] = {0};
    assert(anc_pv_ed25519_seed_keypair(publicKey, privateKey, seed) ==
           ANC_PV_CRYPTO_OK);
    NSData *publicData =
        [NSData dataWithBytes:publicKey length:sizeof publicKey];
    AncPrivateVaultControlLogState *state = Genesis(
        @"vault:continuity-0001", @"endpoint:continuity-0001", publicData,
        privateKey);
    anc_pv_zeroize(privateKey, sizeof privateKey);
    anc_pv_zeroize(publicKey, sizeof publicKey);

    NSData *entry = AncPrivateVaultBuildContinuityCheckpoint(
        state, @"log-entry:continuity-0001",
        @"2026-07-19T09:10:00.000Z", @"endpoint:continuity-0001", seed,
        publicData);
    assert(entry.length > 0);
    AncPrivateVaultControlLogReplayResult *replay = nil;
    assert([[AncPrivateVaultControlLog new]
               replaySignedEntry:entry
                   currentState:state
                       verifier:nil
                         result:&replay] == AncPrivateVaultControlLogStatusOK);
    assert(replay != nil && replay.state.sequence == 1 &&
           [replay.state.signedAt isEqualToString:
                                      @"2026-07-19T09:10:00.000Z"] &&
           [replay.state.freshnessMode
               isEqualToString:@"endpoint_witnessed"] &&
           [replay.state.membershipHash isEqualToData:state.membershipHash]);

    NSMutableData *wrongPublic = [publicData mutableCopy];
    ((uint8_t *)wrongPublic.mutableBytes)[0] ^= 1;
    assert(AncPrivateVaultBuildContinuityCheckpoint(
               state, @"log-entry:continuity-0002",
               @"2026-07-19T09:11:00.000Z", @"endpoint:continuity-0001",
               seed, wrongPublic) == nil);
    assert(AncPrivateVaultBuildContinuityCheckpoint(
               state, @"log-entry:continuity-0003",
               @"2026-07-19T09:11:00Z", @"endpoint:continuity-0001", seed,
               publicData) == nil);
    anc_pv_zeroize(seed, sizeof seed);
    puts("continuity builder tests passed");
  }
  return 0;
}
