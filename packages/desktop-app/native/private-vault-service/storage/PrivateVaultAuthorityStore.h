#import <Foundation/Foundation.h>

#import "PrivateVaultAuthoritySnapshot.h"
#import "PrivateVaultCustodyRepository.h"

NS_ASSUME_NONNULL_BEGIN

enum {
  ANC_PV_AUTHORITY_FRAME_HEADER_BYTES = 84,
  ANC_PV_AUTHORITY_FRAME_VERSION = 1,
};

typedef NS_ENUM(NSInteger, AncPrivateVaultAuthorityStoreStatus) {
  AncPrivateVaultAuthorityStoreStatusOK = 0,
  AncPrivateVaultAuthorityStoreStatusNotFound = 1,
  AncPrivateVaultAuthorityStoreStatusRemoved = 2,
  AncPrivateVaultAuthorityStoreStatusInvalid = 3,
  AncPrivateVaultAuthorityStoreStatusCorrupt = 4,
  AncPrivateVaultAuthorityStoreStatusRollbackDetected = 5,
  AncPrivateVaultAuthorityStoreStatusConflict = 6,
  AncPrivateVaultAuthorityStoreStatusProtectionFailed = 7,
  AncPrivateVaultAuthorityStoreStatusStorageFailed = 8,
};

@interface AncPrivateVaultAuthorityCheckpoint : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) uint64_t custodyGeneration;
@property(nonatomic, readonly) NSData *frameDigest;
@property(nonatomic, readonly) AncPrivateVaultAuthoritySnapshot *snapshot;
@end

/* Created by the pure replay layer; consumers can inspect but not initialize.
 */
@interface AncPrivateVaultVerifiedReplayResult : NSObject
@property(nonatomic, readonly, nullable)
    AncPrivateVaultAuthorityCheckpoint *expectedCheckpoint;
@property(nonatomic, readonly) AncPrivateVaultAuthoritySnapshot *nextSnapshot;
@property(nonatomic, readonly)
    AncPrivateVaultCustodyEpochTransition epochTransition;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultAuthorityStore : NSObject
- (instancetype)initWithStateRootURL:(NSURL *)stateRootURL
                   custodyRepository:
                       (AncPrivateVaultCustodyRepository *)custodyRepository
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

- (AncPrivateVaultAuthorityStoreStatus)
    loadVaultId:(NSString *)vaultId
     checkpoint:
         (AncPrivateVaultAuthorityCheckpoint *_Nullable *_Nullable)checkpoint
          error:(NSError *_Nullable *_Nullable)error;

- (AncPrivateVaultAuthorityStoreStatus)
    commitVerifiedReplayResult:(AncPrivateVaultVerifiedReplayResult *)result
                       vaultId:(NSString *)vaultId
                  verifiedAtMs:(uint64_t)verifiedAtMs
                    checkpoint:(AncPrivateVaultAuthorityCheckpoint *_Nullable
                                    *_Nullable)checkpoint
                         error:(NSError *_Nullable *_Nullable)error;
@end

typedef NS_ENUM(NSInteger, AncPrivateVaultAuthorityFaultPoint) {
  AncPrivateVaultAuthorityFaultAfterTemporaryWrite = 1,
  AncPrivateVaultAuthorityFaultAfterTemporaryFsync = 2,
  AncPrivateVaultAuthorityFaultAfterStageRename = 3,
  AncPrivateVaultAuthorityFaultAfterStageDirectoryFsync = 4,
  AncPrivateVaultAuthorityFaultAfterStageVerification = 5,
  AncPrivateVaultAuthorityFaultAfterCustodyAdvance = 6,
  AncPrivateVaultAuthorityFaultAfterLivePromote = 7,
  AncPrivateVaultAuthorityFaultAfterLiveDirectoryFsync = 8,
  AncPrivateVaultAuthorityFaultBeforeFinalReread = 9,
  AncPrivateVaultAuthorityFaultBeforeDirectoryReopen = 10,
  AncPrivateVaultAuthorityFaultDirectoryListingFailure = 11,
};
#if ANC_PRIVATE_VAULT_TESTING
typedef BOOL (^AncPrivateVaultAuthorityFaultHook)(
    AncPrivateVaultAuthorityFaultPoint point);
FOUNDATION_EXPORT void AncPrivateVaultAuthoritySetFaultHookForTesting(
    AncPrivateVaultAuthorityFaultHook _Nullable hook);
typedef void (^AncPrivateVaultAuthorityDerivedKeyClearedHook)(BOOL cleared);
FOUNDATION_EXPORT void
    AncPrivateVaultAuthoritySetDerivedKeyClearedHookForTesting(
        AncPrivateVaultAuthorityDerivedKeyClearedHook _Nullable hook);
FOUNDATION_EXPORT NSData
    *_Nullable AncPrivateVaultAuthorityFrameEncodeForTesting(
        NSData *plaintext, NSString *vaultId, uint64_t custodyGeneration,
        NSData *localStateKey, NSData *nonce,
        NSData *_Nullable *_Nullable digest);
FOUNDATION_EXPORT NSData
    *_Nullable AncPrivateVaultAuthorityFrameDecodeForTesting(
        NSData *frame, NSString *vaultId, uint64_t custodyGeneration,
        NSData *localStateKey, NSData *_Nullable *_Nullable digest);
@interface AncPrivateVaultVerifiedReplayResult (Testing)
+ (instancetype)
    testResultWithExpectedCheckpoint:
        (AncPrivateVaultAuthorityCheckpoint *_Nullable)checkpoint
                        nextSnapshot:
                            (AncPrivateVaultAuthoritySnapshot *)snapshot
                     epochTransition:
                         (AncPrivateVaultCustodyEpochTransition)transition;
@end
#endif

NS_ASSUME_NONNULL_END
