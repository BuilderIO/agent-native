#import "PrivateVaultGenesisPreparationStore.h"

@class AncPrivateVaultControlLog;
@class AncPrivateVaultCustodyRepository;
@class AncPrivateVaultAuthorityStore;
@class AncPrivateVaultPreparedGenesisArtifacts;

NS_ASSUME_NONNULL_BEGIN

typedef BOOL (^AncPrivateVaultCommittedGenesisHostedAppendBorrowBlock)(
    NSString *vaultId, NSString *endpointId, const uint8_t *signedGenesisEntry,
    size_t signedGenesisEntryLength, const uint8_t *recoveryWrap,
    size_t recoveryWrapLength, const uint8_t *recoveryConfirmation,
    size_t recoveryConfirmationLength, const uint8_t *bootstrapTranscript,
    size_t bootstrapTranscriptLength, const uint8_t *authorization,
    size_t authorizationLength, const uint8_t *endpointSigningSeed,
    NSData *endpointSigningPublicKey);

/* Proof-bearing genesis transitions. These methods construct the next durable
 * snapshot from the reconciled current record; no caller supplies record state
 * or secret material. */
@interface AncPrivateVaultGenesisPreparationStore (GenesisInternal)

/* Trusted startup-only read by durable lookup id. It never accepts a
 * caller-provided transition or exposes data outside the native service. The
 * returned secret handle must be closed by the coordinator. */
- (AncPrivateVaultGenesisPreparationStoreStatus)
    readLookupId:(const uint8_t *)lookupId
          length:(size_t)length
        snapshot:(AncPrivateVaultGenesisPreparationSnapshot *)snapshot
     secretHandle:
         (AncPrivateVaultGenesisPreparationSecretsHandle *_Nullable *_Nullable)
             secretHandle;

/* Startup-only, handleless cleanup is intentionally restricted to already
 * terminal records. It derives every deletion target from the authenticated
 * record and refuses COMMITTED cleanup until the hosted receipt is bound. */
- (AncPrivateVaultGenesisPreparationStoreStatus)
    cleanupTerminalLookupId:(const uint8_t *)lookupId
                     length:(size_t)length;

/* Binds an exact canonical hosted append receipt only after independently
 * authenticating the COMMITTED official tuple and retained genesis artifacts.
 * Receipt bytes are fenced before artifact deletion; CLEANED is the final CAS.
 */
- (AncPrivateVaultGenesisPreparationStoreStatus)
    cleanCommittedLookupId:(const uint8_t *)lookupId
                    length:(size_t)length
                   receipt:(NSData *)receipt
                controlLog:(AncPrivateVaultControlLog *)controlLog
            authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
         custodyRepository:
             (AncPrivateVaultCustodyRepository *)custodyRepository;

/* Startup-only recovery reads the fenced receipt internally. NotFound means
 * hosted acknowledgement has not yet been durably proven. */
- (AncPrivateVaultGenesisPreparationStoreStatus)
    recoverCommittedCleanupLookupId:(const uint8_t *)lookupId
                              length:(size_t)length
                          controlLog:(AncPrivateVaultControlLog *)controlLog
                      authorityStore:
                          (AncPrivateVaultAuthorityStore *)authorityStore
                   custodyRepository:
                       (AncPrivateVaultCustodyRepository *)custodyRepository;

/* Independently rereads the exact COMMITTED record, official Authority g2,
 * official Custody g2, and digest-bound live artifact spool. The complete
 * confirmed evidence is replayed before the retained public append artifacts
 * and active endpoint signing seed are lent synchronously. No object or secret
 * supplied by the caller participates in validation. */
- (AncPrivateVaultGenesisPreparationStoreStatus)
    borrowCommittedHostedAppendLookupId:(const uint8_t *)lookupId
                                  length:(size_t)length
                              controlLog:(AncPrivateVaultControlLog *)controlLog
                          authorityStore:
                              (AncPrivateVaultAuthorityStore *)authorityStore
                       custodyRepository:
                           (AncPrivateVaultCustodyRepository *)custodyRepository
                                consumer:
                                    (AncPrivateVaultCommittedGenesisHostedAppendBorrowBlock)
                                        consumer;

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
