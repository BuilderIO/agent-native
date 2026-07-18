#import "PrivateVaultGenesisPreparationStore.h"

@class AncPrivateVaultControlLog;
@class AncPrivateVaultCustodyRepository;
@class AncPrivateVaultAuthorityStore;
@class AncPrivateVaultPreparedGenesisArtifacts;

NS_ASSUME_NONNULL_BEGIN

/* Proof-bearing genesis transitions. These methods construct the next durable
 * snapshot from the reconciled current record; no caller supplies record state
 * or secret material. */
@interface AncPrivateVaultGenesisPreparationStore (GenesisInternal)

- (AncPrivateVaultGenesisPreparationStoreStatus)
    bindConfirmedHandle:(const uint8_t *)handle
           handleLength:(size_t)handleLength
              artifacts:(AncPrivateVaultPreparedGenesisArtifacts *)artifacts
          confirmedAtMs:(uint64_t)confirmedAtMs
             controlLog:(AncPrivateVaultControlLog *)controlLog;

- (AncPrivateVaultGenesisPreparationStoreStatus)
    beginCommittingHandle:(const uint8_t *)handle
             handleLength:(size_t)handleLength;

- (AncPrivateVaultGenesisPreparationStoreStatus)
    bindPendingGenesisCustodyHandle:(const uint8_t *)handle
                       handleLength:(size_t)handleLength
                  custodyRepository:
                      (AncPrivateVaultCustodyRepository *)custodyRepository;

/* Binds COMMITTED only after independently loading exact official g2
 * authority and custody state. The retained custody digest continues to name
 * the authenticated pending g1 predecessor; the official frame digest proves
 * the g1 -> g2 promotion. */
- (AncPrivateVaultGenesisPreparationStoreStatus)
    bindOfficialGenesisHandle:(const uint8_t *)handle
                  handleLength:(size_t)handleLength
                authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
             custodyRepository:
                 (AncPrivateVaultCustodyRepository *)custodyRepository;

@end

NS_ASSUME_NONNULL_END
