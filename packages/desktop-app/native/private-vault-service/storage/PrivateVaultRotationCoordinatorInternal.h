#import "PrivateVaultRotationCoordinator.h"

NS_ASSUME_NONNULL_BEGIN

#if ANC_PRIVATE_VAULT_TESTING
FOUNDATION_EXPORT BOOL
AncPrivateVaultRotationEndpointRemovalTargetMatchesPreparedForTesting(
    const AncPrivateVaultRotationPreparationSnapshot *snapshot,
    NSData *targetEndpointId, NSData *authorityFrameDigest,
    const uint8_t *_Nonnull pendingEpochKey);

@interface AncPrivateVaultRotationCoordinator (TestingInternal)
- (instancetype)
    initWithPreparationStore:
        (AncPrivateVaultRotationPreparationStore *)preparationStore
              authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
           custodyRepository:
               (AncPrivateVaultCustodyRepository *)custodyRepository
                  controlLog:(AncPrivateVaultControlLog *)controlLog
                trustedClock:(id<AncPrivateVaultTrustedClock>)trustedClock;
@end
#endif

NS_ASSUME_NONNULL_END
