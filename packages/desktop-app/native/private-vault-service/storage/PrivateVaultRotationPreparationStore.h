#import <Foundation/Foundation.h>

#import "PrivateVaultGenerationFence.h"
#import "PrivateVaultGuardedMemory.h"
#import "PrivateVaultKeychain.h"
#import "PrivateVaultRotationPreparationRecord.h"
#import "PrivateVaultRotationPreparationSpool.h"

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSString *const AncPrivateVaultRotationPreparationRecordId;

typedef NS_ENUM(NSInteger, AncPrivateVaultRotationPreparationStoreStatus) {
  AncPrivateVaultRotationPreparationStoreStatusOK = 0,
  AncPrivateVaultRotationPreparationStoreStatusNotFound = 1,
  AncPrivateVaultRotationPreparationStoreStatusInvalid = 2,
  AncPrivateVaultRotationPreparationStoreStatusConflict = 3,
  AncPrivateVaultRotationPreparationStoreStatusRollbackDetected = 4,
  AncPrivateVaultRotationPreparationStoreStatusCorrupt = 5,
  AncPrivateVaultRotationPreparationStoreStatusInaccessible = 6,
  AncPrivateVaultRotationPreparationStoreStatusStorageFailed = 7,
};

typedef BOOL (^AncPrivateVaultRotationPreparationKeyBorrowBlock)(
    const uint8_t *pendingEpochKey);

@interface AncPrivateVaultRotationPreparationKeyHandle : NSObject
@property(nonatomic, readonly, getter=isClosed) BOOL closed;
- (AncPrivateVaultRotationPreparationStoreStatus)borrow:
    (AncPrivateVaultRotationPreparationKeyBorrowBlock)block;
- (AncPrivateVaultRotationPreparationStoreStatus)close;
@end

/*
 * The fence generation is the monotonic storage CAS revision. It is separate
 * from snapshot.preparation_generation, which remains fixed from PREPARED
 * through CLEANED for one ceremony.
 */
@interface AncPrivateVaultRotationPreparationCheckpoint : NSObject
@property(nonatomic, readonly) uint64_t fenceGeneration;
@property(nonatomic, readonly) NSData *recordDigest;
@property(nonatomic, readonly)
    AncPrivateVaultRotationPreparationSnapshot snapshot;
@end

@interface AncPrivateVaultRotationPreparationStore : NSObject

- (instancetype)
    initWithKeychain:(AncPrivateVaultKeychain *)keychain
               spool:(AncPrivateVaultRotationPreparationSpoolStore *)spool
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

- (AncPrivateVaultRotationPreparationStoreStatus)
    readVaultId:(const uint8_t *)vaultId
     checkpoint:
         (AncPrivateVaultRotationPreparationCheckpoint *_Nullable *_Nullable)
             checkpoint
         handle:
             (AncPrivateVaultRotationPreparationKeyHandle *_Nullable *_Nullable)
                 handle;

/* First record only. Restart after CLEANED is intentionally unavailable until
 * the custody coordinator can prove an authoritative base reread, changed
 * ceremony, distinct nonzero key, and the full Core parity transition. */
- (AncPrivateVaultRotationPreparationStoreStatus)
    createGenesisPrepared:
        (const AncPrivateVaultRotationPreparationSnapshot *)snapshot
          pendingEpochKey:(const uint8_t *)pendingEpochKey
               checkpoint:(AncPrivateVaultRotationPreparationCheckpoint
                               *_Nullable *_Nullable)checkpoint;

- (AncPrivateVaultRotationPreparationStoreStatus)
    markRewrappedVaultId:(const uint8_t *)vaultId
      expectedCheckpoint:
          (AncPrivateVaultRotationPreparationCheckpoint *)expectedCheckpoint
              checkpoint:(AncPrivateVaultRotationPreparationCheckpoint
                              *_Nullable *_Nullable)checkpoint;

- (AncPrivateVaultRotationPreparationStoreStatus)
    markAcknowledgedVaultId:(const uint8_t *)vaultId
         expectedCheckpoint:
             (AncPrivateVaultRotationPreparationCheckpoint *)expectedCheckpoint
                 checkpoint:(AncPrivateVaultRotationPreparationCheckpoint
                                 *_Nullable *_Nullable)checkpoint;

/*
 * This is the only API that creates a disk artifact. It encrypts first, writes
 * and fsyncs the stage spool, CASes the Keychain record to
 * AWAITING_CONTROL_COMMIT with the exact frame digest, then promotes and
 * fsyncs the spool. A failed promotion is recoverable by read/reconcile.
 */
- (AncPrivateVaultRotationPreparationStoreStatus)
    armAwaitingControlCommitVaultId:(const uint8_t *)vaultId
                 expectedCheckpoint:
                     (AncPrivateVaultRotationPreparationCheckpoint *)
                         expectedCheckpoint
                   expectedSequence:(uint64_t)expectedSequence
               expectedPreviousHead:(const uint8_t *)expectedPreviousHead
                   transcriptDigest:(const uint8_t *)transcriptDigest
                        signedEntry:(const uint8_t *)signedEntry
                  signedEntryLength:(size_t)signedEntryLength
                       recoveryWrap:(const uint8_t *)recoveryWrap
                 recoveryWrapLength:(size_t)recoveryWrapLength
                              nonce:(const uint8_t *)nonce
                         checkpoint:
                             (AncPrivateVaultRotationPreparationCheckpoint
                                  *_Nullable *_Nullable)checkpoint;

/* Read and authenticate the live spool without releasing retained pointers. */
- (AncPrivateVaultRotationPreparationStoreStatus)
    consumeAwaitingArtifactsVaultId:(const uint8_t *)vaultId
                 expectedCheckpoint:
                     (AncPrivateVaultRotationPreparationCheckpoint *)
                         expectedCheckpoint
                           consumer:
                               (AncPrivateVaultRotationPreparationArtifactsConsumer)
                                   consumer;

@end

typedef NS_ENUM(NSInteger, AncPrivateVaultRotationPreparationStoreFaultPoint) {
  AncPrivateVaultRotationPreparationStoreFaultAfterStageWrite = 1,
  AncPrivateVaultRotationPreparationStoreFaultBeforeFenceBegin = 2,
  AncPrivateVaultRotationPreparationStoreFaultAfterFenceBegin = 3,
  AncPrivateVaultRotationPreparationStoreFaultAfterLiveWrite = 4,
  AncPrivateVaultRotationPreparationStoreFaultAfterFenceCommit = 5,
  AncPrivateVaultRotationPreparationStoreFaultBeforeStageDelete = 6,
  AncPrivateVaultRotationPreparationStoreFaultAfterSpoolStage = 7,
  AncPrivateVaultRotationPreparationStoreFaultBeforeSpoolPromote = 8,
};
#if ANC_PRIVATE_VAULT_TESTING
typedef BOOL (^AncPrivateVaultRotationPreparationStoreFaultTestHook)(
    AncPrivateVaultRotationPreparationStoreFaultPoint point);
FOUNDATION_EXPORT void
    AncPrivateVaultRotationPreparationSetStoreFaultHookForTesting(
        AncPrivateVaultRotationPreparationStoreFaultTestHook _Nullable hook);
typedef void (^AncPrivateVaultRotationPreparationBeforeCommitTestHook)(void);
FOUNDATION_EXPORT void
    AncPrivateVaultRotationPreparationSetBeforeCommitHookForTesting(
        AncPrivateVaultRotationPreparationBeforeCommitTestHook _Nullable hook);
typedef void (^AncPrivateVaultRotationPreparationRecordClearTestHook)(
    BOOL allBytesCleared);
FOUNDATION_EXPORT void
    AncPrivateVaultRotationPreparationSetRecordClearHookForTesting(
        AncPrivateVaultRotationPreparationRecordClearTestHook _Nullable hook);
typedef void (^AncPrivateVaultRotationPreparationRecordLifecycleTestHook)(
    BOOL allocated, BOOL closeCleared);
FOUNDATION_EXPORT void
    AncPrivateVaultRotationPreparationSetRecordLifecycleHookForTesting(
        AncPrivateVaultRotationPreparationRecordLifecycleTestHook _Nullable hook);
#endif

/*
 * CONSUMED and CLEANED are deliberately not exposed here. A later reviewed
 * custody coordinator must prove the exact official custody/authority reread
 * before consuming, and a hosted-ack verifier must prove durable append before
 * cleanup. A boolean escape hatch would turn that cryptographic gate into
 * theater, which is a surprisingly poor storage primitive.
 */

/*
 * Security.framework necessarily returns a short-lived pageable CFData for a
 * Keychain item. The store bounds it to exactly 512 bytes, immediately decodes
 * the pending key into guarded memory, never returns or stores the record on an
 * object, and zeroizes every caller-controlled mutable encode/stage buffer.
 * Public checkpoints contain only the secret-free snapshot and record digest.
 */

NS_ASSUME_NONNULL_END
