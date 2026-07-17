#import <Foundation/Foundation.h>

#import "PrivateVaultHostedAppendRetryCoordinator.h"

static void Check(BOOL condition, NSString *message) {
  if (!condition) {
    fprintf(stderr, "retry coordinator test failed: %s\n", message.UTF8String);
    abort();
  }
}

static NSData *Vault(uint8_t marker) {
  uint8_t bytes[16] = {0};
  bytes[15] = marker;
  return [NSData dataWithBytes:bytes length:sizeof bytes];
}

@interface FakeCandidateSource
    : NSObject <AncPrivateVaultHostedAppendCandidateSource>
@property(nonatomic) AncPrivateVaultHostedAppendCandidateStatus status;
@property(nonatomic) AncPrivateVaultHostedAppendCandidateStatus markerStatus;
@property(nonatomic) AncPrivateVaultHostedAppendCandidateStatus clearStatus;
@property(nonatomic) NSArray<NSData *> *candidates;
@property(nonatomic) NSUInteger calls;
@property(nonatomic) NSUInteger markerCalls;
@property(nonatomic) NSUInteger clearCalls;
@property(nonatomic, copy, nullable) dispatch_block_t onScan;
@property(nonatomic, copy, nullable) dispatch_block_t onClear;
@end
@implementation FakeCandidateSource
- (AncPrivateVaultHostedAppendCandidateStatus)pendingHostedAppendVaultIds:
    (NSArray<NSData *> **)vaultIds {
  self.calls += 1;
  if (self.onScan != nil)
    self.onScan();
  if (vaultIds != NULL)
    *vaultIds = self.candidates;
  return self.status;
}
- (AncPrivateVaultHostedAppendCandidateStatus)markPendingVaultId:
    (NSData *)vaultId {
  Check(vaultId.length == 16, @"marker receives exact vault identifier");
  self.markerCalls += 1;
  return self.markerStatus;
}
- (AncPrivateVaultHostedAppendCandidateStatus)clearPendingVaultId:
    (NSData *)vaultId {
  Check(vaultId.length == 16, @"clear receives exact vault identifier");
  self.clearCalls += 1;
  if (self.onClear != nil)
    self.onClear();
  return self.clearStatus;
}
@end

@interface FakeRequest : NSObject
@property(nonatomic) NSData *body;
@property(nonatomic) NSString *proofHeader;
@end
@implementation FakeRequest
@end

@interface FakeRotationOperator
    : NSObject <AncPrivateVaultHostedAppendRotationOperator>
@property(nonatomic) AncPrivateVaultRotationCoordinatorStatus cleanupStatus;
@property(nonatomic) AncPrivateVaultRotationCoordinatorStatus resumeStatus;
@property(nonatomic) AncPrivateVaultRotationCoordinatorStatus prepareStatus;
@property(nonatomic) AncPrivateVaultRotationCoordinatorStatus finalizeStatus;
@property(nonatomic) NSUInteger cleanupCalls;
@property(nonatomic) NSUInteger resumeCalls;
@property(nonatomic) NSUInteger prepareCalls;
@property(nonatomic) NSUInteger finalizeCalls;
@end
@implementation FakeRotationOperator
- (AncPrivateVaultRotationCoordinatorStatus)
    recoverHostedAppendCleanupVaultId:(const uint8_t *)vaultId
                               result:
                                   (AncPrivateVaultRotationCoordinatorResult **)
                                       result {
  self.cleanupCalls += 1;
  return self.cleanupStatus;
}
- (AncPrivateVaultRotationCoordinatorStatus)
    resumeVaultId:(const uint8_t *)vaultId
           result:(AncPrivateVaultRotationCoordinatorResult **)result {
  self.resumeCalls += 1;
  return self.resumeStatus;
}
- (AncPrivateVaultRotationCoordinatorStatus)
    prepareHostedAppendVaultId:(const uint8_t *)vaultId
                       request:(AncPrivateVaultHostedAppendRequest **)request {
  self.prepareCalls += 1;
  if (self.prepareStatus == AncPrivateVaultRotationCoordinatorStatusOK &&
      request != NULL) {
    FakeRequest *fresh = [[FakeRequest alloc] init];
    fresh.body = [NSData dataWithBytes:&_prepareCalls
                                length:sizeof _prepareCalls];
    fresh.proofHeader = [NSString
        stringWithFormat:@"proof-%lu", (unsigned long)self.prepareCalls];
    *request = (AncPrivateVaultHostedAppendRequest *)fresh;
  }
  return self.prepareStatus;
}
- (AncPrivateVaultRotationCoordinatorStatus)
    finalizeHostedAppendVaultId:(const uint8_t *)vaultId
                        receipt:(NSData *)receipt
                         result:(AncPrivateVaultRotationCoordinatorResult **)
                                    result {
  self.finalizeCalls += 1;
  return self.finalizeStatus;
}
@end

@interface ScheduledItem : NSObject
@property(nonatomic) uint64_t delay;
@property(nonatomic, copy) dispatch_block_t block;
@end
@implementation ScheduledItem
@end

@interface FakeScheduler : NSObject <AncPrivateVaultHostedAppendRetryScheduling>
@property(nonatomic) NSMutableArray<ScheduledItem *> *items;
@end
@implementation FakeScheduler
- (instancetype)init {
  self = [super init];
  if (self)
    _items = [[NSMutableArray alloc] init];
  return self;
}
- (void)scheduleAfterMilliseconds:(uint64_t)milliseconds
                            block:(dispatch_block_t)block {
  ScheduledItem *item = [[ScheduledItem alloc] init];
  item.delay = milliseconds;
  item.block = block;
  [self.items addObject:item];
}
- (void)runNext {
  ScheduledItem *item = self.items.firstObject;
  Check(item != nil, @"scheduled work exists");
  [self.items removeObjectAtIndex:0];
  item.block();
}
@end

@interface FakeTransport : NSObject <AncPrivateVaultHostedAppendTransporting>
@property(nonatomic)
    NSMutableArray<AncPrivateVaultHostedAppendCompletion> *completions;
@property(nonatomic) NSMutableArray<NSData *> *bodies;
@property(nonatomic) NSMutableArray<NSString *> *proofs;
@end
@implementation FakeTransport
- (instancetype)init {
  self = [super init];
  if (self) {
    _completions = [[NSMutableArray alloc] init];
    _bodies = [[NSMutableArray alloc] init];
    _proofs = [[NSMutableArray alloc] init];
  }
  return self;
}
- (void)appendBody:(NSData *)body
       proofHeader:(NSString *)proofHeader
        completion:(AncPrivateVaultHostedAppendCompletion)completion {
  [self.bodies addObject:[body copy]];
  [self.proofs addObject:[proofHeader copy]];
  [self.completions addObject:[completion copy]];
}
@end

static AncPrivateVaultHostedAppendRetryCoordinator *
MakeCoordinator(FakeCandidateSource *source, FakeRotationOperator *rotation,
                FakeTransport *transport, FakeScheduler *scheduler) {
  return [[AncPrivateVaultHostedAppendRetryCoordinator alloc]
      initWithCandidateSource:source
             rotationOperator:rotation
                    transport:transport
                    scheduler:scheduler];
}

static void TestStartupDiscoveryDedupeAndSuccess(void) {
  FakeCandidateSource *source = [[FakeCandidateSource alloc] init];
  source.status = AncPrivateVaultHostedAppendCandidateStatusOK;
  source.candidates = @[ Vault(1), Vault(1) ];
  FakeRotationOperator *rotation = [[FakeRotationOperator alloc] init];
  rotation.cleanupStatus = AncPrivateVaultRotationCoordinatorStatusNotFound;
  rotation.resumeStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  rotation.prepareStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  rotation.finalizeStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  FakeTransport *transport = [[FakeTransport alloc] init];
  FakeScheduler *scheduler = [[FakeScheduler alloc] init];
  AncPrivateVaultHostedAppendRetryCoordinator *coordinator =
      MakeCoordinator(source, rotation, transport, scheduler);
  [coordinator start];
  [coordinator start];
  [coordinator enqueueVaultId:Vault(1)];
  Check(source.calls == 1 && source.markerCalls == 1 &&
            transport.completions.count == 1,
        @"start and enqueue dedupe");
  Check(coordinator.snapshot.inFlightCount == 1, @"one in flight");
  AncPrivateVaultHostedAppendCompletion completion = transport.completions[0];
  NSData *receipt = [@"opaque" dataUsingEncoding:NSUTF8StringEncoding];
  completion(AncPrivateVaultHostedAppendTransportStatusOK, receipt);
  completion(AncPrivateVaultHostedAppendTransportStatusOK, receipt);
  Check(rotation.finalizeCalls == 1 && source.clearCalls == 1,
        @"duplicate callback ignored and marker clears once");
  Check(coordinator.snapshot.completedSinceStartCount == 1 &&
            coordinator.snapshot.inFlightCount == 0,
        @"success cleans active state");

  [coordinator enqueueVaultId:Vault(1)];
  Check(transport.completions.count == 2 &&
            coordinator.snapshot.inFlightCount == 1,
        @"a later rotation for the same vault is admitted");
  completion(AncPrivateVaultHostedAppendTransportStatusOK, receipt);
  Check(rotation.finalizeCalls == 1 && coordinator.snapshot.inFlightCount == 1,
        @"an old callback cannot complete the later rotation");
  transport.completions[1](AncPrivateVaultHostedAppendTransportStatusOK,
                           receipt);
  Check(rotation.finalizeCalls == 2 &&
            coordinator.snapshot.completedSinceStartCount == 2,
        @"the later rotation completes independently");
}

static void TestWakeCoalescing(void) {
  FakeCandidateSource *source = [[FakeCandidateSource alloc] init];
  source.status = AncPrivateVaultHostedAppendCandidateStatusOK;
  source.candidates = @[];
  FakeRotationOperator *rotation = [[FakeRotationOperator alloc] init];
  FakeTransport *transport = [[FakeTransport alloc] init];
  FakeScheduler *scheduler = [[FakeScheduler alloc] init];
  AncPrivateVaultHostedAppendRetryCoordinator *coordinator =
      MakeCoordinator(source, rotation, transport, scheduler);
  __weak FakeCandidateSource *weakSource = source;
  source.onScan = ^{
    weakSource.onScan = nil;
    [coordinator wake];
    [coordinator wake];
    [coordinator wake];
  };
  [coordinator wake];
  Check(source.calls == 0, @"wake before start is inert");
  [coordinator start];
  Check(source.calls == 2,
        @"concurrent wake nudges coalesce into one follow-up scan");
  [coordinator wake];
  Check(source.calls == 3, @"a later wake performs a new scan");
  [coordinator start];
  Check(source.calls == 3, @"repeated start remains idempotent");
}

static void TestTransientBackoffAndFreshProof(void) {
  FakeCandidateSource *source = [[FakeCandidateSource alloc] init];
  source.status = AncPrivateVaultHostedAppendCandidateStatusOK;
  source.candidates = @[ Vault(2) ];
  FakeRotationOperator *rotation = [[FakeRotationOperator alloc] init];
  rotation.cleanupStatus = AncPrivateVaultRotationCoordinatorStatusNotFound;
  rotation.resumeStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  rotation.prepareStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  rotation.finalizeStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  FakeTransport *transport = [[FakeTransport alloc] init];
  FakeScheduler *scheduler = [[FakeScheduler alloc] init];
  AncPrivateVaultHostedAppendRetryCoordinator *coordinator =
      MakeCoordinator(source, rotation, transport, scheduler);
  [coordinator start];
  transport.completions[0](
      AncPrivateVaultHostedAppendTransportStatusNetworkFailed, nil);
  Check(scheduler.items[0].delay == 1000 &&
            coordinator.snapshot.scheduledCount == 1,
        @"first bounded backoff");
  [scheduler runNext];
  Check(rotation.prepareCalls == 2 && transport.completions.count == 2 &&
            ![transport.proofs[0] isEqualToString:transport.proofs[1]],
        @"retry prepares a fresh proof");
  transport.completions[1](AncPrivateVaultHostedAppendTransportStatusHTTPError,
                           nil);
  Check(scheduler.items[0].delay == 2000, @"backoff doubles");
  NSArray<NSNumber *> *remainingDelays =
      @[ @2000, @4000, @8000, @16000, @32000, @60000, @60000 ];
  for (NSNumber *expectedDelay in remainingDelays) {
    Check(scheduler.items[0].delay == expectedDelay.unsignedLongLongValue,
          @"backoff follows the bounded sequence");
    [scheduler runNext];
    AncPrivateVaultHostedAppendCompletion retryCompletion =
        transport.completions.lastObject;
    retryCompletion(AncPrivateVaultHostedAppendTransportStatusNetworkFailed,
                    nil);
  }
}

static void TestTerminalAndInvalidInputs(void) {
  FakeCandidateSource *source = [[FakeCandidateSource alloc] init];
  source.status = AncPrivateVaultHostedAppendCandidateStatusOK;
  source.candidates = @[ Vault(3) ];
  FakeRotationOperator *rotation = [[FakeRotationOperator alloc] init];
  rotation.cleanupStatus = AncPrivateVaultRotationCoordinatorStatusCorrupt;
  FakeTransport *transport = [[FakeTransport alloc] init];
  FakeScheduler *scheduler = [[FakeScheduler alloc] init];
  AncPrivateVaultHostedAppendRetryCoordinator *coordinator =
      MakeCoordinator(source, rotation, transport, scheduler);
  [coordinator start];
  Check(coordinator.snapshot.blockedCount == 1 && scheduler.items.count == 0 &&
            coordinator.snapshot.lastFailureCategory ==
                AncPrivateVaultHostedAppendRetryFailureIntegrityBlocked,
        @"corruption blocks without retry");
  uint8_t shortIdentifier[15] = {0};
  [coordinator enqueueVaultId:[NSData dataWithBytes:shortIdentifier
                                             length:sizeof shortIdentifier]];
  Check(coordinator.snapshot.blockedCount == 1,
        @"invalid identifier never enters state");

  NSArray<NSNumber *> *statuses = @[
    @(AncPrivateVaultRotationCoordinatorStatusRollbackDetected),
    @(AncPrivateVaultRotationCoordinatorStatusCorrupt),
    @(AncPrivateVaultRotationCoordinatorStatusInvalid),
    @(AncPrivateVaultRotationCoordinatorStatusProtectionFailed),
  ];
  NSArray<NSNumber *> *categories = @[
    @(AncPrivateVaultHostedAppendRetryFailureIntegrityBlocked),
    @(AncPrivateVaultHostedAppendRetryFailureIntegrityBlocked),
    @(AncPrivateVaultHostedAppendRetryFailureInvalidBlocked),
    @(AncPrivateVaultHostedAppendRetryFailureProtectionBlocked),
  ];
  for (NSUInteger index = 0; index < statuses.count; index++) {
    FakeCandidateSource *caseSource = [[FakeCandidateSource alloc] init];
    caseSource.status = AncPrivateVaultHostedAppendCandidateStatusOK;
    caseSource.candidates = @[ Vault((uint8_t)(10 + index)) ];
    FakeRotationOperator *caseRotation = [[FakeRotationOperator alloc] init];
    caseRotation.cleanupStatus = statuses[index].integerValue;
    FakeScheduler *caseScheduler = [[FakeScheduler alloc] init];
    AncPrivateVaultHostedAppendRetryCoordinator *caseCoordinator =
        MakeCoordinator(caseSource, caseRotation, [[FakeTransport alloc] init],
                        caseScheduler);
    [caseCoordinator start];
    Check(caseCoordinator.snapshot.blockedCount == 1 &&
              caseCoordinator.snapshot.lastFailureCategory ==
                  categories[index].integerValue &&
              caseScheduler.items.count == 0,
          @"terminal failures remain blocked");
  }
}

static void TestRestartCleanupAndDiscoveryRetry(void) {
  FakeCandidateSource *source = [[FakeCandidateSource alloc] init];
  source.status = AncPrivateVaultHostedAppendCandidateStatusUnavailable;
  FakeRotationOperator *rotation = [[FakeRotationOperator alloc] init];
  rotation.cleanupStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  FakeTransport *transport = [[FakeTransport alloc] init];
  FakeScheduler *scheduler = [[FakeScheduler alloc] init];
  AncPrivateVaultHostedAppendRetryCoordinator *coordinator =
      MakeCoordinator(source, rotation, transport, scheduler);
  [coordinator start];
  Check(scheduler.items[0].delay == 1000 &&
            coordinator.snapshot.scheduledCount == 1,
        @"candidate availability retries are observable");
  source.status = AncPrivateVaultHostedAppendCandidateStatusOK;
  source.candidates = @[ Vault(4) ];
  [scheduler runNext];
  Check(rotation.cleanupCalls == 1 && rotation.resumeCalls == 0 &&
            transport.completions.count == 0 &&
            coordinator.snapshot.completedSinceStartCount == 1 &&
            coordinator.snapshot.lastFailureCategory ==
                AncPrivateVaultHostedAppendRetryFailureNone,
        @"restart-shaped receipt cleanup completes without network");
}

static void TestMarkerPersistenceAndClearRetry(void) {
  FakeCandidateSource *source = [[FakeCandidateSource alloc] init];
  source.status = AncPrivateVaultHostedAppendCandidateStatusOK;
  source.markerStatus = AncPrivateVaultHostedAppendCandidateStatusUnavailable;
  source.candidates = @[ Vault(5) ];
  FakeRotationOperator *rotation = [[FakeRotationOperator alloc] init];
  rotation.cleanupStatus = AncPrivateVaultRotationCoordinatorStatusNotFound;
  rotation.resumeStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  rotation.prepareStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  rotation.finalizeStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  FakeTransport *transport = [[FakeTransport alloc] init];
  FakeScheduler *scheduler = [[FakeScheduler alloc] init];
  AncPrivateVaultHostedAppendRetryCoordinator *coordinator =
      MakeCoordinator(source, rotation, transport, scheduler);
  [coordinator start];
  Check(rotation.cleanupCalls == 0 && transport.completions.count == 0 &&
            coordinator.snapshot.scheduledCount == 1,
        @"no state or network work precedes the durable marker");
  source.markerStatus = AncPrivateVaultHostedAppendCandidateStatusOK;
  [scheduler runNext];
  Check(transport.completions.count == 1, @"marked retry reaches transport");
  source.clearStatus = AncPrivateVaultHostedAppendCandidateStatusUnavailable;
  transport.completions[0](AncPrivateVaultHostedAppendTransportStatusOK,
                           [@"receipt" dataUsingEncoding:NSUTF8StringEncoding]);
  Check(coordinator.snapshot.scheduledCount == 1 && source.clearCalls == 1,
        @"marker clear failure retains retry state");
  source.clearStatus = AncPrivateVaultHostedAppendCandidateStatusOK;
  rotation.cleanupStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  [scheduler runNext];
  Check(coordinator.snapshot.completedSinceStartCount == 1 &&
            transport.completions.count == 1 && source.clearCalls == 2,
        @"receipt-backed retry clears marker without another post");
}

static void TestSameVaultAdmissionDuringMarkerClear(void) {
  FakeCandidateSource *source = [[FakeCandidateSource alloc] init];
  source.status = AncPrivateVaultHostedAppendCandidateStatusOK;
  source.candidates = @[ Vault(6) ];
  FakeRotationOperator *rotation = [[FakeRotationOperator alloc] init];
  rotation.cleanupStatus = AncPrivateVaultRotationCoordinatorStatusNotFound;
  rotation.resumeStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  rotation.prepareStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  rotation.finalizeStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  FakeTransport *transport = [[FakeTransport alloc] init];
  FakeScheduler *scheduler = [[FakeScheduler alloc] init];
  AncPrivateVaultHostedAppendRetryCoordinator *coordinator =
      MakeCoordinator(source, rotation, transport, scheduler);
  [coordinator start];
  __weak FakeCandidateSource *weakSource = source;
  source.onClear = ^{
    weakSource.onClear = nil;
    [coordinator admitResumedVaultId:Vault(6)];
  };
  transport.completions[0](AncPrivateVaultHostedAppendTransportStatusOK,
                           [@"first" dataUsingEncoding:NSUTF8StringEncoding]);
  Check(coordinator.snapshot.completedSinceStartCount == 1 &&
            coordinator.snapshot.inFlightCount == 1 &&
            transport.completions.count == 2,
        @"a new official generation racing marker clear is rediscovered");
  source.candidates = @[];
  transport.completions[1](AncPrivateVaultHostedAppendTransportStatusOK,
                           [@"second" dataUsingEncoding:NSUTF8StringEncoding]);
  Check(coordinator.snapshot.completedSinceStartCount == 2 &&
            coordinator.snapshot.inFlightCount == 0,
        @"rediscovered generation completes independently");
}

static void TestScanIntegritySurvivesEntryCompletion(void) {
  FakeCandidateSource *source = [[FakeCandidateSource alloc] init];
  source.status = AncPrivateVaultHostedAppendCandidateStatusOK;
  source.candidates = @[ Vault(7) ];
  FakeRotationOperator *rotation = [[FakeRotationOperator alloc] init];
  rotation.cleanupStatus = AncPrivateVaultRotationCoordinatorStatusNotFound;
  rotation.resumeStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  rotation.prepareStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  rotation.finalizeStatus = AncPrivateVaultRotationCoordinatorStatusOK;
  FakeTransport *transport = [[FakeTransport alloc] init];
  FakeScheduler *scheduler = [[FakeScheduler alloc] init];
  AncPrivateVaultHostedAppendRetryCoordinator *coordinator =
      MakeCoordinator(source, rotation, transport, scheduler);
  [coordinator start];
  source.status = AncPrivateVaultHostedAppendCandidateStatusCorrupt;
  source.candidates = nil;
  [coordinator wake];
  transport.completions[0](AncPrivateVaultHostedAppendTransportStatusOK,
                           [@"receipt" dataUsingEncoding:NSUTF8StringEncoding]);
  Check(coordinator.snapshot.lastFailureCategory ==
            AncPrivateVaultHostedAppendRetryFailureIntegrityBlocked,
        @"entry completion cannot erase a terminal discovery failure");
  source.status = AncPrivateVaultHostedAppendCandidateStatusOK;
  source.candidates = @[];
  [coordinator wake];
  Check(coordinator.snapshot.lastFailureCategory ==
            AncPrivateVaultHostedAppendRetryFailureNone,
        @"a clean rescan remediates the discovery failure");
}

static void TestActiveCandidateScanIsObservable(void) {
  FakeCandidateSource *source = [[FakeCandidateSource alloc] init];
  source.status = AncPrivateVaultHostedAppendCandidateStatusOK;
  source.candidates = @[];
  dispatch_semaphore_t entered = dispatch_semaphore_create(0);
  dispatch_semaphore_t release = dispatch_semaphore_create(0);
  dispatch_semaphore_t finished = dispatch_semaphore_create(0);
  source.onScan = ^{
    dispatch_semaphore_signal(entered);
    dispatch_semaphore_wait(release, DISPATCH_TIME_FOREVER);
  };
  AncPrivateVaultHostedAppendRetryCoordinator *coordinator = MakeCoordinator(
      source, [[FakeRotationOperator alloc] init], [[FakeTransport alloc] init],
      [[FakeScheduler alloc] init]);
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    [coordinator start];
    dispatch_semaphore_signal(finished);
  });
  Check(dispatch_semaphore_wait(
            entered, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC)) == 0,
        @"candidate scan entered");
  Check(coordinator.snapshot.inFlightCount == 1,
        @"active discovery is reported as retrying work");
  dispatch_semaphore_signal(release);
  Check(dispatch_semaphore_wait(
            finished, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC)) == 0,
        @"candidate scan completed");
  Check(coordinator.snapshot.inFlightCount == 0,
        @"completed discovery returns to idle");
}

int main(void) {
  @autoreleasepool {
    TestStartupDiscoveryDedupeAndSuccess();
    TestWakeCoalescing();
    TestTransientBackoffAndFreshProof();
    TestTerminalAndInvalidInputs();
    TestRestartCleanupAndDiscoveryRetry();
    TestMarkerPersistenceAndClearRetry();
    TestSameVaultAdmissionDuringMarkerClear();
    TestScanIntegritySurvivesEntryCompletion();
    TestActiveCandidateScanIsObservable();
    puts("hosted append retry coordinator tests passed");
  }
  return 0;
}
