#import <Foundation/Foundation.h>

#import "PrivateVaultGenesisPreparationArtifactStore.h"
#import "PrivateVaultGenesisPreparationRecord.h"
#import "PrivateVaultGenerationFence.h"
#import "PrivateVaultGuardedMemory.h"
#import "PrivateVaultKeychain.h"

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSString *const AncPrivateVaultGenesisPreparationRecordId;

typedef NS_ENUM(NSInteger, AncPrivateVaultGenesisPreparationStoreStatus) {
  AncPrivateVaultGenesisPreparationStoreStatusOK = 0,
  AncPrivateVaultGenesisPreparationStoreStatusNotFound,
  AncPrivateVaultGenesisPreparationStoreStatusInvalid,
  AncPrivateVaultGenesisPreparationStoreStatusConflict,
  AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected,
  AncPrivateVaultGenesisPreparationStoreStatusCorrupt,
  AncPrivateVaultGenesisPreparationStoreStatusInaccessible,
  AncPrivateVaultGenesisPreparationStoreStatusFailed,
};

typedef BOOL (^AncPrivateVaultGenesisPreparationSecretsBorrowBlock)(
    const AncPrivateVaultGenesisPreparationSecretInputs *secrets);

@interface AncPrivateVaultGenesisPreparationSecretsHandle : NSObject
@property(nonatomic, readonly, getter=isClosed) BOOL closed;
- (AncPrivateVaultGenesisPreparationStoreStatus)
    borrow:(AncPrivateVaultGenesisPreparationSecretsBorrowBlock)block;
- (AncPrivateVaultGenesisPreparationStoreStatus)close;
@end

@interface AncPrivateVaultGenesisPreparationStore : NSObject
- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain
                            fence:(AncPrivateVaultGenerationFence *)fence
                    artifactStore:(AncPrivateVaultGenesisPreparationArtifactStore *)artifactStore
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
- (AncPrivateVaultGenesisPreparationStoreStatus)
    createSnapshot:(const AncPrivateVaultGenesisPreparationSnapshot *)snapshot
            secrets:(const AncPrivateVaultGenesisPreparationSecretInputs *)secrets
             handle:(const uint8_t *)handle
       handleLength:(size_t)handleLength;
- (AncPrivateVaultGenesisPreparationStoreStatus)
    readHandle:(const uint8_t *)handle
    handleLength:(size_t)handleLength
       snapshot:(AncPrivateVaultGenesisPreparationSnapshot *)snapshot
    secretHandle:(AncPrivateVaultGenesisPreparationSecretsHandle *_Nullable *_Nullable)secretHandle;
#if ANC_PRIVATE_VAULT_TESTING
/* Structural transition harness only. Production lifecycle transitions belong
 * to phase-specific coordinator capabilities that independently verify their
 * typed proofs before CAS. */
- (AncPrivateVaultGenesisPreparationStoreStatus)
    transitionHandle:(const uint8_t *)handle
         handleLength:(size_t)handleLength
         nextSnapshot:(const AncPrivateVaultGenesisPreparationSnapshot *)snapshot
              secrets:(const AncPrivateVaultGenesisPreparationSecretInputs *)secrets;
#endif
- (AncPrivateVaultGenesisPreparationStoreStatus)
    reconcileHandle:(const uint8_t *)handle handleLength:(size_t)handleLength;
/* Trusted restart reconciliation intentionally needs no bearer capability and
 * returns no snapshot or secrets. A public wrong-token read may therefore do
 * the same non-secret crash repair, but it can neither disclose state nor
 * authorize a caller-selected transition. */
- (AncPrivateVaultGenesisPreparationStoreStatus)
    reconcileLookupId:(const uint8_t *)lookupId length:(size_t)length;
- (AncPrivateVaultGenesisPreparationStoreStatus)
    listPreparationLookupIds:(NSArray<NSData *> *_Nullable *_Nonnull)lookupIds;
@end

typedef NS_ENUM(NSInteger, AncPrivateVaultGenesisPreparationStoreFaultPoint) {
  AncPrivateVaultGenesisPreparationStoreFaultAfterStageWrite = 1,
  AncPrivateVaultGenesisPreparationStoreFaultBeforeFenceBegin,
  AncPrivateVaultGenesisPreparationStoreFaultAfterFenceBegin,
  AncPrivateVaultGenesisPreparationStoreFaultAfterLiveWrite,
  AncPrivateVaultGenesisPreparationStoreFaultAfterFenceCommit,
  AncPrivateVaultGenesisPreparationStoreFaultBeforeStageDelete,
  AncPrivateVaultGenesisPreparationStoreFaultBeforeArtifactPromote,
  AncPrivateVaultGenesisPreparationStoreFaultAfterMarkerBeforeStageWrite,
};
#if ANC_PRIVATE_VAULT_TESTING
typedef BOOL (^AncPrivateVaultGenesisPreparationStoreFaultHook)(
    AncPrivateVaultGenesisPreparationStoreFaultPoint point);
typedef void (^AncPrivateVaultGenesisPreparationRecordLifecycleHook)(
    BOOL allocated, BOOL closeCleared);
FOUNDATION_EXPORT void
AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(
    AncPrivateVaultGenesisPreparationStoreFaultHook _Nullable hook);
FOUNDATION_EXPORT void
AncPrivateVaultGenesisPreparationSetRecordLifecycleHookForTesting(
    AncPrivateVaultGenesisPreparationRecordLifecycleHook _Nullable hook);
#endif

NS_ASSUME_NONNULL_END
