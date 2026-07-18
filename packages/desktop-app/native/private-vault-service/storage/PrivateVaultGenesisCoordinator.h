#import <Foundation/Foundation.h>

#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultGenesisArtifactStore.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultGenesisCoordinatorStatus) {
  AncPrivateVaultGenesisCoordinatorStatusOK = 0,
  AncPrivateVaultGenesisCoordinatorStatusNotFound = 1,
  AncPrivateVaultGenesisCoordinatorStatusInvalid = 2,
  AncPrivateVaultGenesisCoordinatorStatusConflict = 3,
  AncPrivateVaultGenesisCoordinatorStatusAuthorizationFailed = 4,
  AncPrivateVaultGenesisCoordinatorStatusStorageFailed = 5,
  AncPrivateVaultGenesisCoordinatorStatusProtectionFailed = 6,
};

@interface AncPrivateVaultGenesisCoordinatorResult : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly)
    AncPrivateVaultAuthorityCheckpoint *authorityCheckpoint;
@property(nonatomic, readonly) uint64_t custodyGeneration;
@property(nonatomic, readonly) uint64_t activeEpoch;
@property(nonatomic, readonly) uint64_t sequence;
@property(nonatomic, readonly) NSData *headHash;
@property(nonatomic, readonly) NSData *membershipHash;
@property(nonatomic, readonly) uint64_t recoveryGeneration;
@property(nonatomic, readonly) NSData *recoveryWrapHash;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultGenesisCoordinator : NSObject
- (instancetype)
    initWithArtifactStore:(AncPrivateVaultGenesisArtifactStore *)artifactStore
           authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
        custodyRepository:(AncPrivateVaultCustodyRepository *)custodyRepository
               controlLog:(AncPrivateVaultControlLog *)controlLog;
- (instancetype)init NS_UNAVAILABLE;

/* Durably stages the three public genesis artifacts before any official state
 * transition, then verifies and commits them. Safe to repeat after ambiguity.
 */
- (AncPrivateVaultGenesisCoordinatorStatus)
           commitVaultId:(const uint8_t *)vaultId
     bootstrapTranscript:(NSData *)bootstrapTranscript
    recoveryConfirmation:(NSData *)recoveryConfirmation
           authorization:(NSData *)authorization
                  result:(AncPrivateVaultGenesisCoordinatorResult *_Nullable
                              *_Nullable)result;

/* Freshly re-verifies the durable artifacts and reconciles an interrupted
 * official commit. Success includes an exact custody/authority reread and
 * durable artifact cleanup. */
- (AncPrivateVaultGenesisCoordinatorStatus)
    resumeVaultId:(const uint8_t *)vaultId
           result:
               (AncPrivateVaultGenesisCoordinatorResult *_Nullable *_Nullable)
                   result;
@end

typedef NS_ENUM(NSInteger, AncPrivateVaultGenesisCoordinatorFaultPoint) {
  AncPrivateVaultGenesisCoordinatorFaultAfterArtifactAuthentication = 1,
  AncPrivateVaultGenesisCoordinatorFaultAfterAuthorityCommit = 2,
  AncPrivateVaultGenesisCoordinatorFaultBeforeOfficialReread = 3,
  AncPrivateVaultGenesisCoordinatorFaultBeforeArtifactCleanup = 4,
};

#if ANC_PRIVATE_VAULT_TESTING
typedef BOOL (^AncPrivateVaultGenesisCoordinatorFaultHook)(
    AncPrivateVaultGenesisCoordinatorFaultPoint point);
FOUNDATION_EXPORT void AncPrivateVaultGenesisCoordinatorSetFaultHookForTesting(
    AncPrivateVaultGenesisCoordinatorFaultHook _Nullable hook);
#endif

NS_ASSUME_NONNULL_END
