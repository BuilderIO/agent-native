#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>

#import "PrivateVaultHostedAppendTransport.h"
#import "PrivateVaultRotationCoordinator.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultHostedAppendCandidateStatus) {
  AncPrivateVaultHostedAppendCandidateStatusOK = 0,
  AncPrivateVaultHostedAppendCandidateStatusUnavailable = 1,
  AncPrivateVaultHostedAppendCandidateStatusInvalid = 2,
  AncPrivateVaultHostedAppendCandidateStatusCorrupt = 3,
};

typedef NS_ENUM(NSInteger, AncPrivateVaultHostedAppendRetryFailureCategory) {
  AncPrivateVaultHostedAppendRetryFailureNone = 0,
  AncPrivateVaultHostedAppendRetryFailureCandidateUnavailable = 1,
  AncPrivateVaultHostedAppendRetryFailureCoordinatorUnavailable = 2,
  AncPrivateVaultHostedAppendRetryFailureTransportUnavailable = 3,
  AncPrivateVaultHostedAppendRetryFailureIntegrityBlocked = 4,
  AncPrivateVaultHostedAppendRetryFailureInvalidBlocked = 5,
  AncPrivateVaultHostedAppendRetryFailureProtectionBlocked = 6,
};

@protocol AncPrivateVaultHostedAppendCandidateSource <NSObject>
/* Returns only raw, immutable 16-byte vault identifiers from the bounded union
 * of encrypted live spools and durable retry markers. */
- (AncPrivateVaultHostedAppendCandidateStatus)pendingHostedAppendVaultIds:
    (NSArray<NSData *> *_Nullable *_Nonnull)vaultIds;
/* Marker persistence must complete before any coordinator or network work.
 * Clearing happens only after an official CLEANED result. */
- (AncPrivateVaultHostedAppendCandidateStatus)markPendingVaultId:
    (NSData *)vaultId;
- (AncPrivateVaultHostedAppendCandidateStatus)clearPendingVaultId:
    (NSData *)vaultId;
@end

@protocol AncPrivateVaultHostedAppendRotationOperator <NSObject>
/* Replays receipt-backed cleanup without exposing the persisted receipt. OK
 * means cleanup is complete; NotFound means continue with a normal append. */
- (AncPrivateVaultRotationCoordinatorStatus)
    recoverHostedAppendCleanupVaultId:(const uint8_t *_Nullable)vaultId
                               result:(AncPrivateVaultRotationCoordinatorResult
                                           *_Nullable *_Nullable)result;
- (AncPrivateVaultRotationCoordinatorStatus)
    resumeVaultId:(const uint8_t *_Nullable)vaultId
           result:
               (AncPrivateVaultRotationCoordinatorResult *_Nullable *_Nullable)
                   result;
- (AncPrivateVaultRotationCoordinatorStatus)
    prepareHostedAppendVaultId:(const uint8_t *_Nullable)vaultId
                       request:(AncPrivateVaultHostedAppendRequest *_Nullable
                                    *_Nullable)request;
- (AncPrivateVaultRotationCoordinatorStatus)
    finalizeHostedAppendVaultId:(const uint8_t *_Nullable)vaultId
                        receipt:(NSData *)receipt
                         result:(AncPrivateVaultRotationCoordinatorResult
                                     *_Nullable *_Nullable)result;
@end

@protocol AncPrivateVaultHostedAppendTransporting <NSObject>
- (void)appendBody:(NSData *)body
       proofHeader:(NSString *)proofHeader
        completion:(AncPrivateVaultHostedAppendCompletion)completion;
@end

@protocol AncPrivateVaultHostedAppendRetryScheduling <NSObject>
- (void)scheduleAfterMilliseconds:(uint64_t)milliseconds
                            block:(dispatch_block_t)block;
@end

@interface AncPrivateVaultHostedAppendDispatchScheduler
    : NSObject <AncPrivateVaultHostedAppendRetryScheduling>
- (instancetype)initWithQueue:(dispatch_queue_t)queue NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@end

@interface AncPrivateVaultHostedAppendRetrySnapshot : NSObject
@property(nonatomic, readonly) NSUInteger pendingCount;
@property(nonatomic, readonly) NSUInteger scheduledCount;
@property(nonatomic, readonly) NSUInteger inFlightCount;
@property(nonatomic, readonly) NSUInteger blockedCount;
@property(nonatomic, readonly) NSUInteger completedSinceStartCount;
@property(nonatomic, readonly)
    AncPrivateVaultHostedAppendRetryFailureCategory lastFailureCategory;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultHostedAppendRetryCoordinator : NSObject
- (nullable instancetype)
    initWithCandidateSource:
        (id<AncPrivateVaultHostedAppendCandidateSource>)candidateSource
           rotationOperator:
               (id<AncPrivateVaultHostedAppendRotationOperator>)rotationOperator
                  transport:
                      (id<AncPrivateVaultHostedAppendTransporting>)transport
                  scheduler:
                      (id<AncPrivateVaultHostedAppendRetryScheduling>)scheduler
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

/* start is idempotent and performs initial discovery. wake coalesces concurrent
 * nudges into at most one follow-up scan and supersedes a scheduled retry. */
- (void)start;
- (void)wake;
- (void)enqueueVaultId:(NSData *)vaultId;
/* Called only after the foreground coordinator has produced a new official
 * CONSUMED tuple. If an older attempt is clearing the same vault marker, the
 * new generation is rediscovered from its authenticated live spool. */
- (void)admitResumedVaultId:(NSData *)vaultId;
- (AncPrivateVaultHostedAppendRetrySnapshot *)snapshot;
@end

NS_ASSUME_NONNULL_END
