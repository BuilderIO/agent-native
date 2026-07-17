#import "PrivateVaultRotationCoordinator.h"

NS_ASSUME_NONNULL_BEGIN

#if ANC_PRIVATE_VAULT_TESTING
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
