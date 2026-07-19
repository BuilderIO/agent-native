#import "PrivateVaultCustodyRecord.h"
#import "PrivateVaultRotationPreparationStore.h"

@class AncPrivateVaultAuthorityCheckpoint;
@class AncPrivateVaultAuthorityStore;
@class AncPrivateVaultCustodyRepository;

NS_ASSUME_NONNULL_BEGIN

@interface AncPrivateVaultRotationAppendReceipt : NSObject
@property(nonatomic, readonly) NSString *_Nonnull vaultId;
@property(nonatomic, readonly) NSString *_Nonnull entryId;
@property(nonatomic, readonly) uint64_t sequence;
@property(nonatomic, readonly) NSData *_Nonnull headHash;
@property(nonatomic, readonly) NSData *_Nonnull recoveryWrapHash;
@property(nonatomic, readonly) uint64_t recoveryWrapByteLength;
@end

FOUNDATION_EXPORT AncPrivateVaultRotationAppendReceipt
    *_Nullable AncPrivateVaultRotationAppendReceiptDecode(NSData *encoded);

FOUNDATION_EXPORT BOOL AncPrivateVaultRotationPreparationOfficialTupleValid(
    const AncPrivateVaultRotationPreparationSnapshot *preparation,
    NSString *vaultId, AncPrivateVaultAuthorityCheckpoint *authority,
    const AncPrivateVaultCustodySnapshot *custody);

typedef BOOL (^AncPrivateVaultConsumedHostedAppendConsumer)(
    NSString *vaultId, NSString *endpointId, const uint8_t *signedEntry,
    size_t signedEntryLength, const uint8_t *recoveryWrap,
    size_t recoveryWrapLength, const uint8_t *signingSeed,
    NSData *signingPublicKey);

@interface AncPrivateVaultRotationPreparationStore (CoordinatorInternal)
/* Starts the first ceremony or CASes a fully cleaned tombstone to the next
 * PREPARED generation. The coordinator must supply an authenticated fresh base
 * tuple; the record transition independently enforces a changed ceremony and
 * distinct nonzero pending key. */
- (AncPrivateVaultRotationPreparationStoreStatus)
    createPrepared:
        (const AncPrivateVaultRotationPreparationSnapshot *_Nonnull)snapshot
          pendingEpochKey:(const uint8_t *_Nonnull)pendingEpochKey
       expectedCheckpoint:
           (AncPrivateVaultRotationPreparationCheckpoint *_Nullable)expected
               checkpoint:(AncPrivateVaultRotationPreparationCheckpoint
                               *_Nullable *_Nullable)checkpoint;

/* This capability is deliberately absent from the public store API. It does
 * not trust its caller: before clearing the duplicate pending key it performs
 * its own exact official successor reread, tuple validation, and active-key
 * comparison through exact production store/repository classes. */
- (AncPrivateVaultRotationPreparationStoreStatus)
    consumeCommittedVaultId:(const uint8_t *_Nonnull)vaultId
             authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
          custodyRepository:
              (AncPrivateVaultCustodyRepository *)custodyRepository
                 checkpoint:(AncPrivateVaultRotationPreparationCheckpoint
                                 *_Nullable *_Nullable)checkpoint;

/* Trusted-main hosted acknowledgement is an exact sequence/head/recovery-wrap
 * proof, never a boolean. This method independently rereads the official tuple,
 * authenticates a retained spool when present, durably deletes it, and only
 * then CASes the secret-free record to CLEANED. A retry after process death may
 * observe the spool already absent and completes only against the same official
 * proof. */
- (AncPrivateVaultRotationPreparationStoreStatus)
    cleanConsumedVaultId:(const uint8_t *_Nonnull)vaultId
                 receipt:(NSData *)receipt
          authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
       custodyRepository:(AncPrivateVaultCustodyRepository *)custodyRepository
              checkpoint:(AncPrivateVaultRotationPreparationCheckpoint
                              *_Nullable *_Nullable)checkpoint;

/* Restart-only cleanup capability. It reads the exact receipt fence from
 * Keychain and feeds it back through cleanConsumedVaultId internally. Receipt
 * bytes never cross this API; NotFound means no hosted acknowledgement has
 * been durably fenced yet. */
- (AncPrivateVaultRotationPreparationStoreStatus)
    recoverPersistedHostedAppendReceiptVaultId:
        (const uint8_t *_Nonnull)vaultId
                                   authorityStore:
                                       (AncPrivateVaultAuthorityStore *)
                                           authorityStore
                                custodyRepository:
                                    (AncPrivateVaultCustodyRepository *)
                                        custodyRepository
                                       checkpoint:
                                           (AncPrivateVaultRotationPreparationCheckpoint
                                                *_Nullable *_Nullable)
                                               checkpoint;

/* Authenticates the exact CONSUMED official tuple and retained encrypted spool,
 * then lends its public append artifacts and guarded signing seed only for the
 * synchronous callback. No secret pointer or plaintext record escapes. */
- (AncPrivateVaultRotationPreparationStoreStatus)
    borrowConsumedHostedAppendVaultId:(const uint8_t *_Nonnull)vaultId
                       authorityStore:
                           (AncPrivateVaultAuthorityStore *)authorityStore
                    custodyRepository:
                        (AncPrivateVaultCustodyRepository *)custodyRepository
                             consumer:
                                 (AncPrivateVaultConsumedHostedAppendConsumer)
                                     consumer;
@end

NS_ASSUME_NONNULL_END
