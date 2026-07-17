#import "PrivateVaultRotationPreparationStore.h"
#import "PrivateVaultCustodyRecord.h"

@class AncPrivateVaultAuthorityCheckpoint;
@class AncPrivateVaultAuthorityStore;
@class AncPrivateVaultCustodyRepository;

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT BOOL AncPrivateVaultRotationPreparationOfficialTupleValid(
    const AncPrivateVaultRotationPreparationSnapshot *preparation,
    NSString *vaultId, AncPrivateVaultAuthorityCheckpoint *authority,
    const AncPrivateVaultCustodySnapshot *custody);

@interface AncPrivateVaultRotationPreparationStore (CoordinatorInternal)
/* This capability is deliberately absent from the public store API. It does
 * not trust its caller: before clearing the duplicate pending key it performs
 * its own exact official successor reread, tuple validation, and active-key
 * comparison through exact production store/repository classes. */
- (AncPrivateVaultRotationPreparationStoreStatus)
    consumeCommittedVaultId:(const uint8_t *_Nonnull)vaultId
             authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
          custodyRepository:
              (AncPrivateVaultCustodyRepository *)custodyRepository
                 checkpoint:
                      (AncPrivateVaultRotationPreparationCheckpoint *_Nullable
                           *_Nullable)checkpoint;
@end

NS_ASSUME_NONNULL_END
