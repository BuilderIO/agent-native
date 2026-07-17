#import "PrivateVaultHostedAppendRetryCoordinator.h"

static const uint64_t kAncRetryInitialMilliseconds = 1000;
static const uint64_t kAncRetryMaximumMilliseconds = 60000;

@interface AncPrivateVaultHostedAppendDispatchScheduler ()
@property(nonatomic, readonly) dispatch_queue_t queue;
@end

@implementation AncPrivateVaultHostedAppendDispatchScheduler
- (instancetype)initWithQueue:(dispatch_queue_t)queue {
  if (queue == nil)
    return nil;
  self = [super init];
  if (self == nil)
    return nil;
  _queue = queue;
  return self;
}
- (void)scheduleAfterMilliseconds:(uint64_t)milliseconds
                            block:(dispatch_block_t)block {
  if (block == nil)
    return;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(milliseconds * NSEC_PER_MSEC)),
      self.queue, block);
}
@end

typedef NS_ENUM(NSUInteger, AncRetryEntryState) {
  AncRetryEntryStatePending = 0,
  AncRetryEntryStateScheduled = 1,
  AncRetryEntryStateInFlight = 2,
  AncRetryEntryStateBlocked = 3,
};

@interface AncPrivateVaultHostedAppendRetrySnapshot ()
- (instancetype)initWithPending:(NSUInteger)pending
                      scheduled:(NSUInteger)scheduled
                       inFlight:(NSUInteger)inFlight
                        blocked:(NSUInteger)blocked
                      completed:(NSUInteger)completed
                    lastFailure:
                        (AncPrivateVaultHostedAppendRetryFailureCategory)
                            lastFailure;
@end

@implementation AncPrivateVaultHostedAppendRetrySnapshot
- (instancetype)initWithPending:(NSUInteger)pending
                      scheduled:(NSUInteger)scheduled
                       inFlight:(NSUInteger)inFlight
                        blocked:(NSUInteger)blocked
                      completed:(NSUInteger)completed
                    lastFailure:
                        (AncPrivateVaultHostedAppendRetryFailureCategory)
                            lastFailure {
  self = [super init];
  if (self == nil)
    return nil;
  _pendingCount = pending;
  _scheduledCount = scheduled;
  _inFlightCount = inFlight;
  _blockedCount = blocked;
  _completedSinceStartCount = completed;
  _lastFailureCategory = lastFailure;
  return self;
}
@end

@interface AncPrivateVaultHostedAppendRetryEntry : NSObject
@property(nonatomic, readonly) NSData *vaultId;
@property(nonatomic) AncRetryEntryState state;
@property(nonatomic) NSUInteger retryCount;
@property(nonatomic) uint64_t callbackToken;
@property(nonatomic) BOOL rediscoverAfterCompletion;
- (instancetype)initWithVaultId:(NSData *)vaultId;
@end

@implementation AncPrivateVaultHostedAppendRetryEntry
- (instancetype)initWithVaultId:(NSData *)vaultId {
  self = [super init];
  if (self == nil)
    return nil;
  _vaultId = [vaultId copy];
  _state = AncRetryEntryStatePending;
  return self;
}
@end

@interface AncPrivateVaultHostedAppendRetryCoordinator ()
@property(nonatomic, readonly) id<AncPrivateVaultHostedAppendCandidateSource>
    candidateSource;
@property(nonatomic, readonly) id<AncPrivateVaultHostedAppendRotationOperator>
    rotationOperator;
@property(nonatomic, readonly) id<AncPrivateVaultHostedAppendTransporting>
    transport;
@property(nonatomic, readonly) id<AncPrivateVaultHostedAppendRetryScheduling>
    scheduler;
@property(nonatomic, readonly) NSRecursiveLock *lock;
@property(nonatomic, readonly)
    NSMutableDictionary<NSData *, AncPrivateVaultHostedAppendRetryEntry *>
        *entries;
@property(nonatomic) BOOL started;
@property(nonatomic) BOOL candidateScanInFlight;
@property(nonatomic) BOOL candidateScanRequested;
@property(nonatomic) BOOL candidateScanScheduled;
@property(nonatomic) uint64_t candidateScanGeneration;
@property(nonatomic) NSUInteger candidateScanRetryCount;
@property(nonatomic) NSUInteger completedSinceStartCount;
@property(nonatomic) AncPrivateVaultHostedAppendRetryFailureCategory
    candidateScanFailureCategory;
@property(nonatomic)
    AncPrivateVaultHostedAppendRetryFailureCategory entryFailureCategory;
@end

@implementation AncPrivateVaultHostedAppendRetryCoordinator

- (instancetype)
    initWithCandidateSource:
        (id<AncPrivateVaultHostedAppendCandidateSource>)candidateSource
           rotationOperator:
               (id<AncPrivateVaultHostedAppendRotationOperator>)rotationOperator
                  transport:
                      (id<AncPrivateVaultHostedAppendTransporting>)transport
                  scheduler:(id<AncPrivateVaultHostedAppendRetryScheduling>)
                                scheduler {
  if (candidateSource == nil || rotationOperator == nil || transport == nil ||
      scheduler == nil)
    return nil;
  self = [super init];
  if (self == nil)
    return nil;
  _candidateSource = candidateSource;
  _rotationOperator = rotationOperator;
  _transport = transport;
  _scheduler = scheduler;
  _lock = [[NSRecursiveLock alloc] init];
  _entries = [[NSMutableDictionary alloc] init];
  _candidateScanFailureCategory = AncPrivateVaultHostedAppendRetryFailureNone;
  _entryFailureCategory = AncPrivateVaultHostedAppendRetryFailureNone;
  return self;
}

static uint64_t AncRetryDelay(NSUInteger retryCount) {
  uint64_t delay = kAncRetryInitialMilliseconds;
  for (NSUInteger index = 1;
       index < retryCount && delay < kAncRetryMaximumMilliseconds; index++) {
    delay = MIN(delay * 2, kAncRetryMaximumMilliseconds);
  }
  return delay;
}

- (void)start {
  [self.lock lock];
  if (self.started) {
    [self.lock unlock];
    return;
  }
  self.started = YES;
  [self.lock unlock];
  [self wake];
}

- (void)wake {
  [self.lock lock];
  if (!self.started) {
    [self.lock unlock];
    return;
  }
  self.candidateScanRequested = YES;
  if (self.candidateScanInFlight) {
    [self.lock unlock];
    return;
  }
  if (self.candidateScanScheduled) {
    self.candidateScanScheduled = NO;
    self.candidateScanGeneration += 1;
  }
  self.candidateScanRequested = NO;
  self.candidateScanInFlight = YES;
  [self.lock unlock];
  [self performCandidateScan];
}

- (void)performCandidateScan {
  NSArray<NSData *> *candidates = nil;
  AncPrivateVaultHostedAppendCandidateStatus status =
      [self.candidateSource pendingHostedAppendVaultIds:&candidates];
  __block BOOL invalidCandidate = NO;
  if (status == AncPrivateVaultHostedAppendCandidateStatusOK &&
      candidates != nil) {
    for (id candidate in [candidates copy]) {
      if (![candidate isKindOfClass:[NSData class]] ||
          [candidate isKindOfClass:[NSMutableData class]] ||
          [(NSData *)candidate length] != 16) {
        [self.lock lock];
        invalidCandidate = YES;
        [self.lock unlock];
        continue;
      }
      [self enqueueVaultId:[candidate copy]];
    }
  }

  [self.lock lock];
  self.candidateScanInFlight = NO;
  BOOL rescanRequested = self.candidateScanRequested;
  self.candidateScanRequested = NO;
  BOOL scheduleRetry = NO;
  uint64_t scheduleGeneration = 0;
  uint64_t delay = 0;
  if (status == AncPrivateVaultHostedAppendCandidateStatusOK &&
      candidates != nil) {
    self.candidateScanRetryCount = 0;
    self.candidateScanFailureCategory =
        invalidCandidate ? AncPrivateVaultHostedAppendRetryFailureInvalidBlocked
                         : AncPrivateVaultHostedAppendRetryFailureNone;
  } else {
    self.candidateScanFailureCategory =
        status == AncPrivateVaultHostedAppendCandidateStatusUnavailable
            ? AncPrivateVaultHostedAppendRetryFailureCandidateUnavailable
            : AncPrivateVaultHostedAppendRetryFailureIntegrityBlocked;
    if (status == AncPrivateVaultHostedAppendCandidateStatusUnavailable &&
        !rescanRequested && !self.candidateScanScheduled) {
      self.candidateScanScheduled = YES;
      self.candidateScanRetryCount += 1;
      delay = AncRetryDelay(self.candidateScanRetryCount);
      self.candidateScanGeneration += 1;
      scheduleGeneration = self.candidateScanGeneration;
      scheduleRetry = YES;
    }
  }
  [self.lock unlock];

  if (rescanRequested) {
    [self wake];
    return;
  }
  if (!scheduleRetry)
    return;
  __weak typeof(self) weakSelf = self;
  [self.scheduler
      scheduleAfterMilliseconds:delay
                          block:^{
                            typeof(self) strongSelf = weakSelf;
                            if (strongSelf == nil)
                              return;
                            [strongSelf.lock lock];
                            BOOL current = strongSelf.candidateScanScheduled &&
                                           strongSelf.candidateScanGeneration ==
                                               scheduleGeneration;
                            if (!current) {
                              [strongSelf.lock unlock];
                              return;
                            }
                            strongSelf.candidateScanScheduled = NO;
                            [strongSelf.lock unlock];
                            [strongSelf wake];
                          }];
}

- (void)enqueueVaultId:(NSData *)vaultId {
  if (![vaultId isKindOfClass:[NSData class]] ||
      [vaultId isKindOfClass:[NSMutableData class]] || vaultId.length != 16) {
    [self.lock lock];
    self.entryFailureCategory =
        AncPrivateVaultHostedAppendRetryFailureInvalidBlocked;
    [self.lock unlock];
    return;
  }
  NSData *identifier = [vaultId copy];
  [self.lock lock];
  if (self.entries[identifier] != nil) {
    [self.lock unlock];
    return;
  }
  AncPrivateVaultHostedAppendRetryEntry *entry =
      [[AncPrivateVaultHostedAppendRetryEntry alloc]
          initWithVaultId:identifier];
  self.entries[identifier] = entry;
  [self.lock unlock];
  [self attemptEntry:entry];
}

- (void)admitResumedVaultId:(NSData *)vaultId {
  if (![vaultId isKindOfClass:[NSData class]] ||
      [vaultId isKindOfClass:[NSMutableData class]] || vaultId.length != 16) {
    [self.lock lock];
    self.entryFailureCategory =
        AncPrivateVaultHostedAppendRetryFailureInvalidBlocked;
    [self.lock unlock];
    return;
  }
  NSData *identifier = [vaultId copy];
  [self.lock lock];
  AncPrivateVaultHostedAppendRetryEntry *existing = self.entries[identifier];
  if (existing != nil) {
    existing.rediscoverAfterCompletion = YES;
    [self.lock unlock];
    return;
  }
  [self.lock unlock];
  [self enqueueVaultId:identifier];
}

static BOOL AncRetryCoordinatorStatusIsTransient(
    AncPrivateVaultRotationCoordinatorStatus status) {
  return status == AncPrivateVaultRotationCoordinatorStatusNotFound ||
         status == AncPrivateVaultRotationCoordinatorStatusInaccessible ||
         status == AncPrivateVaultRotationCoordinatorStatusStorageFailed ||
         status == AncPrivateVaultRotationCoordinatorStatusClockFailed;
}

static BOOL AncRetryCandidateStatusIsTransient(
    AncPrivateVaultHostedAppendCandidateStatus status) {
  return status == AncPrivateVaultHostedAppendCandidateStatusUnavailable;
}

static AncPrivateVaultHostedAppendRetryFailureCategory
AncRetryCandidateFailure(AncPrivateVaultHostedAppendCandidateStatus status) {
  if (status == AncPrivateVaultHostedAppendCandidateStatusUnavailable)
    return AncPrivateVaultHostedAppendRetryFailureCandidateUnavailable;
  if (status == AncPrivateVaultHostedAppendCandidateStatusInvalid)
    return AncPrivateVaultHostedAppendRetryFailureInvalidBlocked;
  return AncPrivateVaultHostedAppendRetryFailureIntegrityBlocked;
}

static AncPrivateVaultHostedAppendRetryFailureCategory
AncRetryCoordinatorFailure(AncPrivateVaultRotationCoordinatorStatus status) {
  if (AncRetryCoordinatorStatusIsTransient(status))
    return AncPrivateVaultHostedAppendRetryFailureCoordinatorUnavailable;
  if (status == AncPrivateVaultRotationCoordinatorStatusInvalid)
    return AncPrivateVaultHostedAppendRetryFailureInvalidBlocked;
  if (status == AncPrivateVaultRotationCoordinatorStatusProtectionFailed)
    return AncPrivateVaultHostedAppendRetryFailureProtectionBlocked;
  return AncPrivateVaultHostedAppendRetryFailureIntegrityBlocked;
}

- (BOOL)beginEntry:(AncPrivateVaultHostedAppendRetryEntry *)entry
             token:(uint64_t *)token {
  [self.lock lock];
  AncPrivateVaultHostedAppendRetryEntry *official = self.entries[entry.vaultId];
  if (official != entry || entry.state == AncRetryEntryStateInFlight ||
      entry.state == AncRetryEntryStateBlocked) {
    [self.lock unlock];
    return NO;
  }
  entry.state = AncRetryEntryStateInFlight;
  entry.callbackToken += 1;
  *token = entry.callbackToken;
  [self.lock unlock];
  return YES;
}

- (void)attemptEntry:(AncPrivateVaultHostedAppendRetryEntry *)entry {
  uint64_t token = 0;
  if (![self beginEntry:entry token:&token])
    return;
  AncPrivateVaultHostedAppendCandidateStatus markerStatus =
      [self.candidateSource markPendingVaultId:entry.vaultId];
  if (markerStatus != AncPrivateVaultHostedAppendCandidateStatusOK) {
    if ([self consumeCallbackForEntry:entry token:token])
      [self failEntry:entry
            transient:AncRetryCandidateStatusIsTransient(markerStatus)
             category:AncRetryCandidateFailure(markerStatus)];
    return;
  }
  AncPrivateVaultRotationCoordinatorStatus status = [self.rotationOperator
      recoverHostedAppendCleanupVaultId:entry.vaultId.bytes
                                 result:NULL];
  if (status == AncPrivateVaultRotationCoordinatorStatusOK) {
    if ([self consumeCallbackForEntry:entry token:token])
      [self completeEntry:entry];
    return;
  }
  if (status != AncPrivateVaultRotationCoordinatorStatusNotFound) {
    [self handleCoordinatorFailure:status entry:entry token:token];
    return;
  }
  status = [self.rotationOperator resumeVaultId:entry.vaultId.bytes
                                         result:NULL];
  if (status != AncPrivateVaultRotationCoordinatorStatusOK) {
    [self handleCoordinatorFailure:status entry:entry token:token];
    return;
  }
  AncPrivateVaultHostedAppendRequest *request = nil;
  status = [self.rotationOperator prepareHostedAppendVaultId:entry.vaultId.bytes
                                                     request:&request];
  if (status != AncPrivateVaultRotationCoordinatorStatusOK || request == nil ||
      request.body == nil || request.proofHeader == nil) {
    [self handleCoordinatorFailure:
              status == AncPrivateVaultRotationCoordinatorStatusOK
                  ? AncPrivateVaultRotationCoordinatorStatusProtectionFailed
                  : status
                             entry:entry
                             token:token];
    return;
  }
  __weak typeof(self) weakSelf = self;
  [self.transport
       appendBody:request.body
      proofHeader:request.proofHeader
       completion:^(AncPrivateVaultHostedAppendTransportStatus transportStatus,
                    NSData *receipt) {
         [weakSelf handleTransportStatus:transportStatus
                                 receipt:receipt
                                   entry:entry
                                   token:token];
       }];
}

- (void)markEntryCompleted:(AncPrivateVaultHostedAppendRetryEntry *)entry {
  __block BOOL rediscover = NO;
  [self.lock lock];
  if (self.entries[entry.vaultId] == entry) {
    rediscover = entry.rediscoverAfterCompletion;
    [self.entries removeObjectForKey:entry.vaultId];
    self.completedSinceStartCount += 1;
    if (self.entries.count == 0)
      self.entryFailureCategory = AncPrivateVaultHostedAppendRetryFailureNone;
  }
  [self.lock unlock];
  if (rediscover)
    [self wake];
}

- (void)completeEntry:(AncPrivateVaultHostedAppendRetryEntry *)entry {
  AncPrivateVaultHostedAppendCandidateStatus status =
      [self.candidateSource clearPendingVaultId:entry.vaultId];
  if (status == AncPrivateVaultHostedAppendCandidateStatusOK) {
    [self markEntryCompleted:entry];
    return;
  }
  [self failEntry:entry
        transient:AncRetryCandidateStatusIsTransient(status)
         category:AncRetryCandidateFailure(status)];
}

- (BOOL)consumeCallbackForEntry:(AncPrivateVaultHostedAppendRetryEntry *)entry
                          token:(uint64_t)token {
  [self.lock lock];
  BOOL current = self.entries[entry.vaultId] == entry &&
                 entry.state == AncRetryEntryStateInFlight &&
                 entry.callbackToken == token;
  if (current)
    entry.callbackToken += 1;
  [self.lock unlock];
  return current;
}

- (void)handleTransportStatus:
            (AncPrivateVaultHostedAppendTransportStatus)transportStatus
                      receipt:(NSData *)receipt
                        entry:(AncPrivateVaultHostedAppendRetryEntry *)entry
                        token:(uint64_t)token {
  if (![self consumeCallbackForEntry:entry token:token])
    return;
  if (transportStatus != AncPrivateVaultHostedAppendTransportStatusOK ||
      receipt == nil) {
    BOOL transient =
        transportStatus ==
            AncPrivateVaultHostedAppendTransportStatusNetworkFailed ||
        transportStatus == AncPrivateVaultHostedAppendTransportStatusHTTPError;
    [self failEntry:entry
          transient:transient
           category:
               transient
                   ? AncPrivateVaultHostedAppendRetryFailureTransportUnavailable
                   : AncPrivateVaultHostedAppendRetryFailureIntegrityBlocked];
    return;
  }
  AncPrivateVaultRotationCoordinatorStatus status =
      [self.rotationOperator finalizeHostedAppendVaultId:entry.vaultId.bytes
                                                 receipt:receipt
                                                  result:NULL];
  if (status != AncPrivateVaultRotationCoordinatorStatusOK) {
    [self failEntry:entry
          transient:AncRetryCoordinatorStatusIsTransient(status)
           category:AncRetryCoordinatorFailure(status)];
    return;
  }
  [self completeEntry:entry];
}

- (void)handleCoordinatorFailure:
            (AncPrivateVaultRotationCoordinatorStatus)status
                           entry:(AncPrivateVaultHostedAppendRetryEntry *)entry
                           token:(uint64_t)token {
  if (![self consumeCallbackForEntry:entry token:token])
    return;
  [self failEntry:entry
        transient:AncRetryCoordinatorStatusIsTransient(status)
         category:AncRetryCoordinatorFailure(status)];
}

- (void)failEntry:(AncPrivateVaultHostedAppendRetryEntry *)entry
        transient:(BOOL)transient
         category:(AncPrivateVaultHostedAppendRetryFailureCategory)category {
  [self.lock lock];
  if (self.entries[entry.vaultId] != entry) {
    [self.lock unlock];
    return;
  }
  self.entryFailureCategory = category;
  if (!transient) {
    entry.state = AncRetryEntryStateBlocked;
    [self.lock unlock];
    return;
  }
  entry.state = AncRetryEntryStateScheduled;
  entry.retryCount += 1;
  uint64_t delay = AncRetryDelay(entry.retryCount);
  [self.lock unlock];
  __weak typeof(self) weakSelf = self;
  [self.scheduler
      scheduleAfterMilliseconds:delay
                          block:^{
                            typeof(self) strongSelf = weakSelf;
                            if (strongSelf == nil)
                              return;
                            [strongSelf.lock lock];
                            BOOL current =
                                strongSelf.entries[entry.vaultId] == entry &&
                                entry.state == AncRetryEntryStateScheduled;
                            if (current)
                              entry.state = AncRetryEntryStatePending;
                            [strongSelf.lock unlock];
                            if (current)
                              [strongSelf attemptEntry:entry];
                          }];
}

- (AncPrivateVaultHostedAppendRetrySnapshot *)snapshot {
  NSUInteger pending = 0, scheduled = 0, inFlight = 0, blocked = 0;
  [self.lock lock];
  if (self.candidateScanInFlight)
    inFlight += 1;
  if (self.candidateScanScheduled)
    scheduled += 1;
  for (AncPrivateVaultHostedAppendRetryEntry *entry in self.entries.allValues) {
    switch (entry.state) {
    case AncRetryEntryStatePending:
      pending += 1;
      break;
    case AncRetryEntryStateScheduled:
      scheduled += 1;
      break;
    case AncRetryEntryStateInFlight:
      inFlight += 1;
      break;
    case AncRetryEntryStateBlocked:
      blocked += 1;
      break;
    }
  }
  AncPrivateVaultHostedAppendRetrySnapshot *snapshot =
      [[AncPrivateVaultHostedAppendRetrySnapshot alloc]
          initWithPending:pending
                scheduled:scheduled
                 inFlight:inFlight
                  blocked:blocked
                completed:self.completedSinceStartCount
              lastFailure:self.candidateScanFailureCategory !=
                                  AncPrivateVaultHostedAppendRetryFailureNone
                              ? self.candidateScanFailureCategory
                              : self.entryFailureCategory];
  [self.lock unlock];
  return snapshot;
}

@end
