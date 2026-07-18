#import "PrivateVaultGenesisPreparationStore.h"

@class AncPrivateVaultControlLog;
@class AncPrivateVaultCustodyRepository;
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

@end

NS_ASSUME_NONNULL_END
