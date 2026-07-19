#import <Foundation/Foundation.h>

#import "PrivateVaultEndpointRemovalBuilder.h"
#import "PrivateVaultCrypto.h"

#include <assert.h>

@interface AncPrivateVaultControlLogMember (RemovalTest)
@property(nonatomic, readwrite) NSString *endpointId;
@property(nonatomic, readwrite) NSString *role;
@property(nonatomic, readwrite) BOOL unattended;
@property(nonatomic, readwrite) NSData *signingPublicKey;
@property(nonatomic, readwrite) NSData *keyAgreementPublicKey;
@property(nonatomic, readwrite) NSString *enrollmentRef;
@end
@interface AncPrivateVaultControlLogState (RemovalTest)
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) uint64_t sequence;
@property(nonatomic, readwrite) NSData *headHash;
@property(nonatomic, readwrite) NSData *membershipHash;
@property(nonatomic, readwrite) NSString *signedAt;
@property(nonatomic, readwrite) NSArray *activeMembers;
@property(nonatomic, readwrite) NSArray *removedEndpointIds;
@property(nonatomic, readwrite) uint64_t epoch;
@property(nonatomic, readwrite) uint64_t recoveryGeneration;
@property(nonatomic, readwrite) NSString *recoveryId;
@property(nonatomic, readwrite) NSData *recoverySigningPublicKey;
@property(nonatomic, readwrite) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readwrite) NSData *recoveryWrapHash;
@property(nonatomic, readwrite) NSString *freshnessMode;
@end

static NSData *Bytes(uint8_t byte, NSUInteger length) {
  NSMutableData *value = [NSMutableData dataWithLength:length];
  memset(value.mutableBytes, byte, length);
  return value;
}
static NSString *Hex(NSData *value) {
  NSMutableString *result = [NSMutableString string];
  const uint8_t *bytes = value.bytes;
  for (NSUInteger index = 0; index < value.length; index++)
    [result appendFormat:@"%02x", bytes[index]];
  return result;
}
static AncPrivateVaultControlLogMember *Member(
    NSData *identifier, NSString *role, BOOL unattended,
    NSData *signing, NSData *agreement, uint8_t enrollment) {
  AncPrivateVaultControlLogMember *member = [AncPrivateVaultControlLogMember new];
  member.endpointId = Hex(identifier);
  member.role = role;
  member.unattended = unattended;
  member.signingPublicKey = signing;
  member.keyAgreementPublicKey = agreement;
  member.enrollmentRef = Hex(Bytes(enrollment, 16));
  return member;
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    uint8_t signingSeed[32], agreementSeed[32], pending[32], recoverySeed[32];
    memset(signingSeed, 0x11, 32);
    memset(agreementSeed, 0x12, 32);
    memset(pending, 0x13, 32);
    memset(recoverySeed, 0x14, 32);
    uint8_t signingPublic[32], signingPrivate[64], agreementPublic[32],
        agreementPrivate[32], recoveryPublic[32], recoveryPrivate[32];
    assert(anc_pv_ed25519_seed_keypair(signingPublic, signingPrivate,
                                       signingSeed) == ANC_PV_CRYPTO_OK);
    assert(anc_pv_box_seed_keypair(agreementPublic, agreementPrivate,
                                   agreementSeed) == ANC_PV_CRYPTO_OK);
    assert(anc_pv_box_seed_keypair(recoveryPublic, recoveryPrivate,
                                   recoverySeed) == ANC_PV_CRYPTO_OK);
    NSData *currentId = Bytes(0x21, 16), *targetId = Bytes(0x22, 16),
        *brokerId = Bytes(0x23, 16);
    AncPrivateVaultControlLogState *state = [AncPrivateVaultControlLogState new];
    state.vaultId = Hex(Bytes(0x20, 16));
    state.sequence = 7;
    state.headHash = Bytes(0x31, 32);
    state.membershipHash = Bytes(0x32, 32);
    state.signedAt = @"2024-07-18T10:00:01.000Z";
    state.activeMembers = @[
      Member(currentId, @"endpoint", NO,
             [NSData dataWithBytes:signingPublic length:32],
             [NSData dataWithBytes:agreementPublic length:32], 0x41),
      Member(targetId, @"endpoint", NO, Bytes(0x42, 32), Bytes(0x43, 32), 0x44),
      Member(brokerId, @"broker", YES, Bytes(0x45, 32), Bytes(0x46, 32), 0x47),
    ];
    state.removedEndpointIds = @[];
    state.epoch = 3;
    state.recoveryGeneration = 2;
    state.recoveryId = Hex(Bytes(0x48, 16));
    state.recoverySigningPublicKey = Bytes(0x49, 32);
    state.recoveryKeyAgreementPublicKey =
        [NSData dataWithBytes:recoveryPublic length:32];
    state.recoveryWrapHash = Bytes(0x4a, 32);
    state.freshnessMode = @"endpoint_witnessed";

    AncPrivateVaultEndpointRemovalBuilderStatus status;
    AncPrivateVaultPreparedEndpointRemoval *result =
        AncPrivateVaultBuildEndpointRemoval(
            state, targetId, Bytes(0x51, 16), Bytes(0x52, 16), Bytes(0x53, 16),
            Bytes(0x54, 24), UINT64_C(1721296802), pending, signingSeed,
            agreementSeed, &status);
    assert(result != nil && status == AncPrivateVaultEndpointRemovalBuilderStatusOK);
    assert(result.signedEntry.length > 0 && result.recoveryWrap.length > 0 &&
           result.transcriptDigest.length == 32 && result.nextState.epoch == 4 &&
           result.nextState.sequence == 8 &&
           ![[result.nextState.activeMembers valueForKey:@"endpointId"]
               containsObject:Hex(targetId)] &&
           [result.nextState.removedEndpointIds containsObject:Hex(targetId)]);
    AncPrivateVaultPreparedEndpointRemoval *lostReceiptRetry =
        AncPrivateVaultBuildEndpointRemoval(
            state, targetId, Bytes(0x51, 16), Bytes(0x52, 16), Bytes(0x53, 16),
            Bytes(0x54, 24), UINT64_C(1721296802), pending, signingSeed,
            agreementSeed, &status);
    assert(lostReceiptRetry != nil &&
           [lostReceiptRetry.signedEntry isEqualToData:result.signedEntry] &&
           [lostReceiptRetry.recoveryWrap isEqualToData:result.recoveryWrap] &&
           [lostReceiptRetry.transcriptDigest
               isEqualToData:result.transcriptDigest]);
    assert(AncPrivateVaultBuildEndpointRemoval(
               state, currentId, Bytes(0x51, 16), Bytes(0x52, 16),
               Bytes(0x53, 16), Bytes(0x54, 24), UINT64_C(1721296802),
               pending, signingSeed, agreementSeed, &status) == nil &&
           status == AncPrivateVaultEndpointRemovalBuilderStatusTargetRejected);
    assert(AncPrivateVaultBuildEndpointRemoval(
               state, brokerId, Bytes(0x51, 16), Bytes(0x52, 16),
               Bytes(0x53, 16), Bytes(0x54, 24), UINT64_C(1721296802),
               pending, signingSeed, agreementSeed, &status) == nil &&
           status == AncPrivateVaultEndpointRemovalBuilderStatusTargetRejected);
    anc_pv_zeroize(signingSeed, sizeof signingSeed);
    anc_pv_zeroize(agreementSeed, sizeof agreementSeed);
    anc_pv_zeroize(pending, sizeof pending);
    anc_pv_zeroize(recoverySeed, sizeof recoverySeed);
    anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
    anc_pv_zeroize(agreementPrivate, sizeof agreementPrivate);
    anc_pv_zeroize(recoveryPrivate, sizeof recoveryPrivate);
    puts("private vault endpoint removal builder tests passed");
  }
  return 0;
}
