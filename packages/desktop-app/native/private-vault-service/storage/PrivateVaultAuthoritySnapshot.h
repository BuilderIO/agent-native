#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

enum {
  ANC_PV_AUTHORITY_SNAPSHOT_MAX_BYTES = 1024 * 1024,
  ANC_PV_AUTHORITY_SNAPSHOT_HASH_BYTES = 32,
  ANC_PV_AUTHORITY_SNAPSHOT_MAX_ACTIVE_MEMBERS = 64,
  ANC_PV_AUTHORITY_SNAPSHOT_MAX_REMOVED_ENDPOINTS = 4096,
};

typedef NS_ENUM(NSInteger, AncPrivateVaultAuthoritySnapshotStatus) {
  AncPrivateVaultAuthoritySnapshotStatusOK = 0,
  AncPrivateVaultAuthoritySnapshotStatusInvalid = 1,
  AncPrivateVaultAuthoritySnapshotStatusTooLarge = 2,
  AncPrivateVaultAuthoritySnapshotStatusNonCanonical = 3,
};

@interface AncPrivateVaultAuthorityMember : NSObject
@property(nonatomic, readonly) NSString *endpointId;
@property(nonatomic, readonly) NSString *role;
@property(nonatomic, readonly) BOOL unattended;
@property(nonatomic, readonly) NSData *signingPublicKey;
@property(nonatomic, readonly) NSData *keyAgreementPublicKey;
@property(nonatomic, readonly) NSString *enrollmentRef;
@end

@interface AncPrivateVaultAuthoritySnapshot : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) uint64_t targetCustodyGeneration;
@property(nonatomic, readonly) uint64_t previousCustodyGeneration;
@property(nonatomic, readonly, nullable) NSNumber *previousSequence;
@property(nonatomic, readonly, nullable) NSData *previousHead;
@property(nonatomic, readonly) uint64_t verifiedAtMs;
@property(nonatomic, readonly) uint64_t sequence;
@property(nonatomic, readonly) NSData *headHash;
@property(nonatomic, readonly) NSData *membershipHash;
@property(nonatomic, readonly) NSString *signedAt;
@property(nonatomic, readonly) uint64_t signedAtMs;
@property(nonatomic, readonly)
    NSArray<AncPrivateVaultAuthorityMember *> *activeMembers;
@property(nonatomic, readonly) NSArray<NSString *> *removedEndpointIds;
@property(nonatomic, readonly) uint64_t epoch;
@property(nonatomic, readonly) uint64_t recoveryGeneration;
@property(nonatomic, readonly) NSString *recoveryId;
@property(nonatomic, readonly) NSData *recoverySigningPublicKey;
@property(nonatomic, readonly) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readonly) NSData *recoveryWrapHash;
@property(nonatomic, readonly) NSString *freshnessMode;
@end

FOUNDATION_EXPORT AncPrivateVaultAuthoritySnapshot
    *_Nullable AncPrivateVaultAuthoritySnapshotDecode(
        NSData *data, AncPrivateVaultAuthoritySnapshotStatus *status);

FOUNDATION_EXPORT NSData *_Nullable AncPrivateVaultAuthoritySnapshotEncode(
    AncPrivateVaultAuthoritySnapshot *snapshot,
    AncPrivateVaultAuthoritySnapshotStatus *status);

FOUNDATION_EXPORT BOOL AncPrivateVaultAuthoritySnapshotIsFreshForBroker(
    AncPrivateVaultAuthoritySnapshot *_Nullable snapshot, uint64_t nowMs);

NS_ASSUME_NONNULL_END
