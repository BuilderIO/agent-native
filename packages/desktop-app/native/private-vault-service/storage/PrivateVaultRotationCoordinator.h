#import <Foundation/Foundation.h>

#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultCustodyRepository.h"
#import "PrivateVaultRotationPreparationStore.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultRotationCoordinatorStatus) {
  AncPrivateVaultRotationCoordinatorStatusOK = 0,
  AncPrivateVaultRotationCoordinatorStatusNotFound = 1,
  AncPrivateVaultRotationCoordinatorStatusInvalid = 2,
  AncPrivateVaultRotationCoordinatorStatusConflict = 3,
  AncPrivateVaultRotationCoordinatorStatusRollbackDetected = 4,
  AncPrivateVaultRotationCoordinatorStatusCorrupt = 5,
  AncPrivateVaultRotationCoordinatorStatusInaccessible = 6,
  AncPrivateVaultRotationCoordinatorStatusStorageFailed = 7,
  AncPrivateVaultRotationCoordinatorStatusClockFailed = 8,
  AncPrivateVaultRotationCoordinatorStatusControlRejected = 9,
  AncPrivateVaultRotationCoordinatorStatusRecoveryWrapRejected = 10,
  AncPrivateVaultRotationCoordinatorStatusAuthorityRejected = 11,
  AncPrivateVaultRotationCoordinatorStatusCustodyRejected = 12,
  AncPrivateVaultRotationCoordinatorStatusProtectionFailed = 13,
};

/* The clock is part of the signed native TCB. It must return Unix epoch
 * milliseconds from a production-trusted source and fail rather than inventing
 * a value when that source is unavailable. */
@protocol AncPrivateVaultTrustedClock <NSObject>
- (BOOL)readNowMilliseconds:(uint64_t *_Nonnull)milliseconds;
@end

@interface AncPrivateVaultSystemTrustedClock
    : NSObject <AncPrivateVaultTrustedClock>
@end

/* A secret-free proof-of-done assembled only from the final official reread. */
@interface AncPrivateVaultRotationCoordinatorResult : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly)
    AncPrivateVaultRotationPreparationCheckpoint *preparationCheckpoint;
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

/* Networkable public material for one fresh, exact hosted append attempt. */
@interface AncPrivateVaultHostedAppendRequest : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) NSString *endpointId;
@property(nonatomic, readonly) NSData *body;
@property(nonatomic, readonly) NSString *proofHeader;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultRotationCoordinator : NSObject

- (instancetype)initWithPreparationStore:
                    (AncPrivateVaultRotationPreparationStore *)preparationStore
                          authorityStore:
                              (AncPrivateVaultAuthorityStore *)authorityStore
                       custodyRepository:
                           (AncPrivateVaultCustodyRepository *)custodyRepository
                              controlLog:(AncPrivateVaultControlLog *)controlLog
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

/* Resumes one exact ceremony by its raw 16-byte vault identifier. The method
 * serializes all work for that vault, never deletes the encrypted spool, and
 * returns success only after the official custody/authority reread and the
 * AWAITING_CONTROL_COMMIT -> CONSUMED CAS have both succeeded. */
- (AncPrivateVaultRotationCoordinatorStatus)
    resumeVaultId:(const uint8_t *_Nullable)vaultId
           result:
               (AncPrivateVaultRotationCoordinatorResult *_Nullable *_Nullable)
                   result;

/* Trusted Desktop main calls this only after an exact hosted append receipt.
 * The receipt is bound to the final official sequence/head and durably reread
 * recovery wrap; cleanup remains idempotent across a crash after the fsynced
 * spool deletion. */
- (AncPrivateVaultRotationCoordinatorStatus)
    finalizeHostedAppendVaultId:(const uint8_t *_Nullable)vaultId
                        receipt:(NSData *)receipt
                         result:(AncPrivateVaultRotationCoordinatorResult
                                     *_Nullable *_Nullable)result;

/* Restart recovery after the exact hosted receipt was already fenced in
 * Keychain. No caller supplies or receives receipt bytes. NotFound means the
 * network append still needs to run; OK proves the official state is CLEANED. */
- (AncPrivateVaultRotationCoordinatorStatus)
    recoverHostedAppendCleanupVaultId:(const uint8_t *_Nullable)vaultId
                                result:
                                    (AncPrivateVaultRotationCoordinatorResult
                                         *_Nullable *_Nullable)result;

/* Rereads and authenticates the exact CONSUMED tuple and spool, then creates a
 * fresh body-bound proof with the guarded endpoint seed. No caller supplies a
 * path, endpoint identity, timestamp, nonce, body, or signing material. */
- (AncPrivateVaultRotationCoordinatorStatus)
    prepareHostedAppendVaultId:(const uint8_t *_Nullable)vaultId
                       request:(AncPrivateVaultHostedAppendRequest *_Nullable
                                    *_Nullable)request;

@end

typedef NS_ENUM(NSInteger, AncPrivateVaultRotationCoordinatorFaultPoint) {
  AncPrivateVaultRotationCoordinatorFaultAfterArtifactAuthentication = 1,
  AncPrivateVaultRotationCoordinatorFaultAfterAuthorityCommit = 2,
  AncPrivateVaultRotationCoordinatorFaultBeforeOfficialReread = 3,
  AncPrivateVaultRotationCoordinatorFaultBeforePreparationConsume = 4,
};

#if ANC_PRIVATE_VAULT_TESTING
typedef BOOL (^AncPrivateVaultRotationCoordinatorFaultHook)(
    AncPrivateVaultRotationCoordinatorFaultPoint point);
FOUNDATION_EXPORT void AncPrivateVaultRotationCoordinatorSetFaultHookForTesting(
    AncPrivateVaultRotationCoordinatorFaultHook _Nullable hook);
#endif

NS_ASSUME_NONNULL_END
