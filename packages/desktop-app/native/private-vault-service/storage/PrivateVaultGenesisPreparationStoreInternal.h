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

/* Terminalizes an uncommitted ceremony only after proving official authority
 * is absent. If a pending g1 custody record exists, it is first bound and then
 * atomically replaced by its exact cancelled-genesis g2 tombstone. */
- (AncPrivateVaultGenesisPreparationStoreStatus)
    cancelHandle:(const uint8_t *)handle
     handleLength:(size_t)handleLength
    cancelledAtMs:(uint64_t)cancelledAtMs
    authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
    custodyRepository:(AncPrivateVaultCustodyRepository *)custodyRepository;

/* Expiry is valid only from PREPARED and strictly after its durable deadline.
 * It proves that neither authority nor custody was created. */
- (AncPrivateVaultGenesisPreparationStoreStatus)
    expireHandle:(const uint8_t *)handle
     handleLength:(size_t)handleLength
     expiredAtMs:(uint64_t)expiredAtMs
    authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
    custodyRepository:(AncPrivateVaultCustodyRepository *)custodyRepository;

@end

NS_ASSUME_NONNULL_END
