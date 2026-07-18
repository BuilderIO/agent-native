#import "PrivateVaultCustodyRepository.h"

NS_ASSUME_NONNULL_BEGIN

@interface AncPrivateVaultPendingRecoveryCustodyCheckpoint : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) uint64_t custodyGeneration;
@property(nonatomic, readonly) NSData *recordDigest;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultCustodyRepository (RecoveryInternal)

/* Fresh-device recovery starts as an unanchored g1 record. The authenticated
 * recovery edge is the only transition allowed to promote it to active g2. */
- (AncPrivateVaultCustodyRepositoryStatus)
    installPendingRecoveryVaultId:(NSString *)vaultId
                        endpointId:(NSString *)endpointId
                        ceremonyId:(NSString *)ceremonyId
                   signingPublicKey:(NSData *)signingPublicKey
                        boxPublicKey:(NSData *)boxPublicKey
                          nextEpoch:(uint64_t)nextEpoch
          replacementRecoveryGeneration:(uint64_t)recoveryGeneration
                  expectedNextSequence:(uint64_t)expectedNextSequence
                   expectedPreviousHead:(NSData *)expectedPreviousHead
             recoveryAuthorizationHash:(NSData *)authorizationHash
                           secrets:
                               (const AncPrivateVaultCustodySecretInputs *)secrets
                        checkpoint:
                            (AncPrivateVaultPendingRecoveryCustodyCheckpoint
                                 *_Nullable *_Nullable)checkpoint;

@end

FOUNDATION_EXPORT AncPrivateVaultCustodyRepositoryStatus
AncPrivateVaultCustodyPromoteRecoveryAuthorityAnchor(
    AncPrivateVaultCustodyRepository *repository, NSString *vaultId,
    const AncPrivateVaultCustodySnapshot *snapshot);

NS_ASSUME_NONNULL_END
