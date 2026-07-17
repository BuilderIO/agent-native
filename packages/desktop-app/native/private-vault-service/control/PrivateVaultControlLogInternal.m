#import "PrivateVaultControlLogInternal.h"

#import "PrivateVaultAuthoritySnapshot.h"
#import "PrivateVaultAuthorityStore.h"

@interface AncPrivateVaultControlLogMember (AuthenticatedBridgePrivate)
@property(nonatomic, readwrite) NSString *endpointId;
@property(nonatomic, readwrite) NSString *role;
@property(nonatomic, readwrite) BOOL unattended;
@property(nonatomic, readwrite) NSData *signingPublicKey;
@property(nonatomic, readwrite) NSData *keyAgreementPublicKey;
@property(nonatomic, readwrite) NSString *enrollmentRef;
@end

@interface AncPrivateVaultControlLogState (AuthenticatedBridgePrivate)
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) uint64_t sequence;
@property(nonatomic, readwrite) NSData *headHash;
@property(nonatomic, readwrite) NSData *membershipHash;
@property(nonatomic, readwrite) NSString *signedAt;
@property(nonatomic, readwrite)
    NSArray<AncPrivateVaultControlLogMember *> *activeMembers;
@property(nonatomic, readwrite) NSArray<NSString *> *removedEndpointIds;
@property(nonatomic, readwrite) uint64_t epoch;
@property(nonatomic, readwrite) uint64_t recoveryGeneration;
@property(nonatomic, readwrite) NSString *recoveryId;
@property(nonatomic, readwrite) NSData *recoverySigningPublicKey;
@property(nonatomic, readwrite) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readwrite) NSData *recoveryWrapHash;
@property(nonatomic, readwrite) NSString *freshnessMode;
@end

AncPrivateVaultControlLogState *
AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(
    AncPrivateVaultAuthorityCheckpoint *checkpoint) {
  if (checkpoint == nil)
    return nil;
  @try {
    NSString *vaultId = [checkpoint.vaultId copy];
    uint64_t custodyGeneration = checkpoint.custodyGeneration;
    NSData *frameDigest = [checkpoint.frameDigest copy];
    AncPrivateVaultAuthoritySnapshot *source = checkpoint.snapshot;
    AncPrivateVaultAuthoritySnapshotStatus status;
    NSData *canonical = AncPrivateVaultAuthoritySnapshotEncode(source, &status);
    AncPrivateVaultAuthoritySnapshot *snapshot =
        canonical == nil
            ? nil
            : AncPrivateVaultAuthoritySnapshotDecode(canonical, &status);
    if (snapshot == nil || vaultId.length == 0 || frameDigest.length != 32 ||
        custodyGeneration == 0 ||
        ![vaultId isEqualToString:snapshot.vaultId] ||
        custodyGeneration != snapshot.targetCustodyGeneration)
      return nil;

    NSMutableArray<AncPrivateVaultControlLogMember *> *members =
        [NSMutableArray arrayWithCapacity:snapshot.activeMembers.count];
    for (AncPrivateVaultAuthorityMember *sourceMember in
         snapshot.activeMembers) {
      AncPrivateVaultControlLogMember *member =
          [[AncPrivateVaultControlLogMember alloc] init];
      member.endpointId = [sourceMember.endpointId copy];
      member.role = [sourceMember.role copy];
      member.unattended = sourceMember.unattended;
      member.signingPublicKey = [sourceMember.signingPublicKey copy];
      member.keyAgreementPublicKey =
          [sourceMember.keyAgreementPublicKey copy];
      member.enrollmentRef = [sourceMember.enrollmentRef copy];
      [members addObject:member];
    }

    AncPrivateVaultControlLogState *state =
        [[AncPrivateVaultControlLogState alloc] init];
    state.vaultId = [snapshot.vaultId copy];
    state.sequence = snapshot.sequence;
    state.headHash = [snapshot.headHash copy];
    state.membershipHash = [snapshot.membershipHash copy];
    state.signedAt = [snapshot.signedAt copy];
    state.activeMembers = [members copy];
    state.removedEndpointIds =
        [[NSArray alloc] initWithArray:snapshot.removedEndpointIds
                            copyItems:YES];
    state.epoch = snapshot.epoch;
    state.recoveryGeneration = snapshot.recoveryGeneration;
    state.recoveryId = [snapshot.recoveryId copy];
    state.recoverySigningPublicKey =
        [snapshot.recoverySigningPublicKey copy];
    state.recoveryKeyAgreementPublicKey =
        [snapshot.recoveryKeyAgreementPublicKey copy];
    state.recoveryWrapHash = [snapshot.recoveryWrapHash copy];
    state.freshnessMode = [snapshot.freshnessMode copy];
    return AncPrivateVaultControlLogStateCreateImmutableCopy(state);
  } @catch (__unused NSException *exception) {
    return nil;
  }
}
