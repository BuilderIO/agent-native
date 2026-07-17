#import "PrivateVaultCustodyRepository.h"

NSString *const AncPrivateVaultCustodyRecordId = @"custody";
static NSString *const kAncCustodyBorrowScopeThreadKey =
    @"com.agentnative.private-vault.custody.borrow-scope";

static const char kCustodyFenceDigestDomain[] =
    "anc/v1/private-vault/custody-record/fence";
typedef struct AncGuardedCustodySecrets {
  uint8_t signingSeed[32];
  uint8_t boxSeed[32];
  uint8_t localStateKey[32];
  uint8_t activeEpochKey[32];
  uint8_t pendingEpochKey[32];
} AncGuardedCustodySecrets;

_Static_assert(sizeof(AncGuardedCustodySecrets) == 160,
               "guarded custody handle must remain exactly 160 bytes");

@interface AncPrivateVaultCustodyHandle ()
@property(nonatomic, strong, readonly) AncPrivateVaultGuardedMemory *memory;
- (instancetype)initEmpty;
@end

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultCustodyBeforeHandleCloseTestHook
    gAncBeforeHandleCloseTestHook;

void AncPrivateVaultCustodySetBeforeHandleCloseForTesting(
    AncPrivateVaultCustodyBeforeHandleCloseTestHook hook) {
  gAncBeforeHandleCloseTestHook = [hook copy];
}
#endif

@implementation AncPrivateVaultCustodyHandle

- (instancetype)initEmpty {
  self = [super init];
  if (self == nil) return nil;
  AncPrivateVaultGuardedMemoryStatus status;
  _memory = [AncPrivateVaultGuardedMemory
      memoryWithLength:sizeof(AncGuardedCustodySecrets)
                                                    status:&status];
  if (_memory == nil || status != AncPrivateVaultGuardedMemoryStatusOK)
    return nil;
  return self;
}

- (BOOL)isClosed {
  AncPrivateVaultGuardedMemory *memory = self.memory;
  return memory == nil || memory.closed;
}

- (AncPrivateVaultCustodyRepositoryStatus)
    borrow:(AncPrivateVaultCustodyHandleBorrowBlock)block {
  if ([NSThread.currentThread
          .threadDictionary[kAncCustodyBorrowScopeThreadKey] boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  AncPrivateVaultGuardedMemory *memory = self.memory;
  if (block == nil || memory == nil)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  AncPrivateVaultGuardedMemoryStatus status =
      [memory borrow:^BOOL(uint8_t *bytes, size_t length) {
        if (length != sizeof(AncGuardedCustodySecrets)) return NO;
        const AncGuardedCustodySecrets *value =
            (const AncGuardedCustodySecrets *)bytes;
        AncPrivateVaultCustodySecretInputs inputs = {
            .signing_seed = value->signingSeed,
            .box_seed = value->boxSeed,
            .local_state_key = value->localStateKey,
            .active_epoch_key = value->activeEpochKey,
            .pending_epoch_key = value->pendingEpochKey,
        };
        NSMutableDictionary *thread = NSThread.currentThread.threadDictionary;
        NSNumber *prior = thread[kAncCustodyBorrowScopeThreadKey];
        thread[kAncCustodyBorrowScopeThreadKey] = @YES;
        BOOL result = NO;
        @try {
          result = block(&inputs);
        } @finally {
          if (prior == nil) {
            [thread removeObjectForKey:kAncCustodyBorrowScopeThreadKey];
          } else {
            thread[kAncCustodyBorrowScopeThreadKey] = prior;
          }
        }
        return result;
      }];
  switch (status) {
    case AncPrivateVaultGuardedMemoryStatusOK:
      return AncPrivateVaultCustodyRepositoryStatusOK;
    case AncPrivateVaultGuardedMemoryStatusClosed:
      return AncPrivateVaultCustodyRepositoryStatusInvalid;
    case AncPrivateVaultGuardedMemoryStatusInvalid:
    case AncPrivateVaultGuardedMemoryStatusAllocationFailed:
    case AncPrivateVaultGuardedMemoryStatusProtectionFailed:
    case AncPrivateVaultGuardedMemoryStatusCallbackFailed:
      return AncPrivateVaultCustodyRepositoryStatusFailed;
  }
}

- (AncPrivateVaultCustodyRepositoryStatus)close {
  if ([NSThread.currentThread
          .threadDictionary[kAncCustodyBorrowScopeThreadKey] boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  AncPrivateVaultGuardedMemory *memory = self.memory;
  if (memory == nil) return AncPrivateVaultCustodyRepositoryStatusOK;
#if ANC_PRIVATE_VAULT_TESTING
  AncPrivateVaultCustodyBeforeHandleCloseTestHook hook =
      gAncBeforeHandleCloseTestHook;
  if (hook != nil) hook(self);
#endif
  AncPrivateVaultGuardedMemoryStatus status = [memory close];
  return status == AncPrivateVaultGuardedMemoryStatusOK
             ? AncPrivateVaultCustodyRepositoryStatusOK
             : AncPrivateVaultCustodyRepositoryStatusFailed;
}

- (void)dealloc { [self close]; }

@end

@interface AncPrivateVaultCustodyRepository ()
@property(nonatomic, strong) AncPrivateVaultKeychain *keychain;
@property(nonatomic, strong) AncPrivateVaultGenerationFence *fence;
@property(nonatomic, strong) dispatch_queue_t queue;
@end

static dispatch_queue_t AncCustodyRepositoryQueue(void) {
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create("com.agentnative.private-vault.custody",
                                  DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

static NSMutableDictionary<NSString *,
                           NSMutableDictionary<NSNumber *, NSHashTable *> *> *
AncCustodyHandleRegistry(void) {
  static NSMutableDictionary<NSString *,
                             NSMutableDictionary<NSNumber *, NSHashTable *> *>
      *registry;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    registry = [NSMutableDictionary dictionary];
  });
  return registry;
}

static void AncRegisterHandle(AncPrivateVaultCustodyHandle *handle,
                              NSString *vaultId, uint64_t generation) {
  NSMutableDictionary<NSNumber *, NSHashTable *> *vault =
      AncCustodyHandleRegistry()[vaultId];
  if (vault == nil) {
    vault = [NSMutableDictionary dictionary];
    AncCustodyHandleRegistry()[vaultId] = vault;
  }
  NSNumber *key = @(generation);
  NSHashTable *handles = vault[key];
  if (handles == nil) {
    handles = [NSHashTable weakObjectsHashTable];
    vault[key] = handles;
  }
  [handles addObject:handle];
}

static AncPrivateVaultCustodyRepositoryStatus AncRevokeHandles(
    NSString *vaultId) {
  NSMutableDictionary<NSNumber *, NSHashTable *> *vault =
      AncCustodyHandleRegistry()[vaultId];
  if (vault == nil) return AncPrivateVaultCustodyRepositoryStatusOK;
  AncPrivateVaultCustodyRepositoryStatus result =
      AncPrivateVaultCustodyRepositoryStatusOK;
  for (NSHashTable *handles in vault.allValues) {
    for (AncPrivateVaultCustodyHandle *handle in handles.allObjects) {
      AncPrivateVaultCustodyRepositoryStatus status = [handle close];
      if (status != AncPrivateVaultCustodyRepositoryStatusOK)
        result = AncPrivateVaultCustodyRepositoryStatusFailed;
    }
  }
  [AncCustodyHandleRegistry() removeObjectForKey:vaultId];
  return result;
}

static AncPrivateVaultCustodySecretOutputs AncOutputs(
    AncGuardedCustodySecrets *secrets) {
  return (AncPrivateVaultCustodySecretOutputs){
      .signing_seed = secrets->signingSeed,
      .box_seed = secrets->boxSeed,
      .local_state_key = secrets->localStateKey,
      .active_epoch_key = secrets->activeEpochKey,
      .pending_epoch_key = secrets->pendingEpochKey,
  };
}

static AncPrivateVaultCustodyRepositoryStatus AncRepositoryStatusForKeychain(
    AncPrivateVaultKeychainStatus status) {
  switch (status) {
    case AncPrivateVaultKeychainStatusOK:
      return AncPrivateVaultCustodyRepositoryStatusOK;
    case AncPrivateVaultKeychainStatusNotFound:
      return AncPrivateVaultCustodyRepositoryStatusNotFound;
    case AncPrivateVaultKeychainStatusInvalid:
      return AncPrivateVaultCustodyRepositoryStatusInvalid;
    case AncPrivateVaultKeychainStatusCorrupt:
      return AncPrivateVaultCustodyRepositoryStatusCorrupt;
    case AncPrivateVaultKeychainStatusInaccessible:
      return AncPrivateVaultCustodyRepositoryStatusInaccessible;
    case AncPrivateVaultKeychainStatusDuplicate:
      return AncPrivateVaultCustodyRepositoryStatusConflict;
    case AncPrivateVaultKeychainStatusFailed:
      return AncPrivateVaultCustodyRepositoryStatusFailed;
  }
}

static AncPrivateVaultCustodyRepositoryStatus AncRepositoryStatusForFence(
    AncPrivateVaultFenceStatus status) {
  switch (status) {
    case AncPrivateVaultFenceStatusOK:
      return AncPrivateVaultCustodyRepositoryStatusOK;
    case AncPrivateVaultFenceStatusInvalid:
      return AncPrivateVaultCustodyRepositoryStatusInvalid;
    case AncPrivateVaultFenceStatusConflict:
      return AncPrivateVaultCustodyRepositoryStatusConflict;
    case AncPrivateVaultFenceStatusRollbackDetected:
      return AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
    case AncPrivateVaultFenceStatusCorrupt:
      return AncPrivateVaultCustodyRepositoryStatusCorrupt;
    case AncPrivateVaultFenceStatusInaccessible:
      return AncPrivateVaultCustodyRepositoryStatusInaccessible;
    case AncPrivateVaultFenceStatusFailed:
      return AncPrivateVaultCustodyRepositoryStatusFailed;
  }
}

static NSData *_Nullable AncCustodyDigest(NSData *record) {
  if (record.length != ANC_PV_CUSTODY_RECORD_BYTES) return nil;
  uint8_t input[sizeof kCustodyFenceDigestDomain +
                ANC_PV_CUSTODY_RECORD_BYTES];
  memcpy(input, kCustodyFenceDigestDomain, sizeof kCustodyFenceDigestDomain);
  memcpy(input + sizeof kCustodyFenceDigestDomain, record.bytes,
         ANC_PV_CUSTODY_RECORD_BYTES);
  uint8_t digest[32] = {0};
  if (anc_pv_blake2b_256(digest, input, sizeof input) != ANC_PV_CRYPTO_OK) {
    anc_pv_zeroize(input, sizeof input);
    anc_pv_zeroize(digest, sizeof digest);
    return nil;
  }
  NSData *result = [NSData dataWithBytes:digest length:32];
  anc_pv_zeroize(input, sizeof input);
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static AncPrivateVaultCustodyRepositoryStatus AncDecodeRecord(
    NSData *data, AncPrivateVaultCustodySnapshot *snapshot,
    AncPrivateVaultCustodyHandle **outHandle) {
  if (outHandle == NULL) return AncPrivateVaultCustodyRepositoryStatusInvalid;
  *outHandle = nil;
  if (data.length != ANC_PV_CUSTODY_RECORD_BYTES)
    return AncPrivateVaultCustodyRepositoryStatusCorrupt;
  AncPrivateVaultCustodyHandle *handle =
      [[AncPrivateVaultCustodyHandle alloc] initEmpty];
  if (handle == nil) return AncPrivateVaultCustodyRepositoryStatusFailed;
  __block AncPrivateVaultCustodyRecordStatus decodeStatus =
      ANC_PV_CUSTODY_INVALID_RECORD;
  AncPrivateVaultGuardedMemoryStatus guardedStatus =
      [handle.memory borrow:^BOOL(uint8_t *bytes, size_t length) {
        if (length != sizeof(AncGuardedCustodySecrets)) return NO;
        AncPrivateVaultCustodySecretOutputs outputs =
            AncOutputs((AncGuardedCustodySecrets *)bytes);
        decodeStatus = anc_pv_custody_record_decode(
            data.bytes, data.length, snapshot, &outputs);
        return decodeStatus == ANC_PV_CUSTODY_OK;
      }];
  if (guardedStatus != AncPrivateVaultGuardedMemoryStatusOK ||
      decodeStatus != ANC_PV_CUSTODY_OK) {
    [handle close];
    anc_pv_custody_snapshot_zero(snapshot);
    return decodeStatus == ANC_PV_CUSTODY_INVALID_RECORD ||
                   decodeStatus == ANC_PV_CUSTODY_CHECKSUM_FAILED
               ? AncPrivateVaultCustodyRepositoryStatusCorrupt
               : AncPrivateVaultCustodyRepositoryStatusFailed;
  }
  *outHandle = handle;
  return AncPrivateVaultCustodyRepositoryStatusOK;
}

static BOOL AncSnapshotMatchesVaultId(
    const AncPrivateVaultCustodySnapshot *snapshot, NSString *vaultId) {
  NSData *value = [vaultId dataUsingEncoding:NSUTF8StringEncoding];
  return value.length == snapshot->vault_id_length && value.length > 0 &&
         memcmp(value.bytes, snapshot->vault_id, value.length) == 0;
}

static BOOL AncTerminalTransitionAllowed(
    const AncPrivateVaultCustodySnapshot *current,
    const AncPrivateVaultCustodySnapshot *next) {
  if (current->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED) return NO;
  if (current->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVING)
    return next->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED;
  if (next->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED) return NO;
  return YES;
}

static BOOL AncLifecycleIsTombstone(
    const AncPrivateVaultCustodySnapshot *snapshot) {
  return snapshot->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVING ||
         snapshot->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED;
}

@implementation AncPrivateVaultCustodyRepository

- (instancetype)init {
  AncPrivateVaultKeychain *keychain = [[AncPrivateVaultKeychain alloc] init];
  return [self initWithKeychain:keychain];
}

- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain {
  self = [super init];
  if (self == nil || keychain == nil) return nil;
  _keychain = keychain;
  _fence = [[AncPrivateVaultGenerationFence alloc] initWithKeychain:keychain];
  if (_fence == nil) return nil;
  _queue = AncCustodyRepositoryQueue();
  return self;
}

- (AncPrivateVaultCustodyRepositoryStatus)readService:(NSString *)service
                                               vaultId:(NSString *)vaultId
                                                  data:(NSData **)data {
  return AncRepositoryStatusForKeychain(
      [self.keychain copyDataForService:service
                                vaultId:vaultId
                               recordId:AncPrivateVaultCustodyRecordId
                                   data:data]);
}

- (AncPrivateVaultCustodyRepositoryStatus)writeExact:(NSData *)data
                                              service:(NSString *)service
                                              vaultId:(NSString *)vaultId {
  NSData *existing = nil;
  AncPrivateVaultKeychainStatus read =
      [self.keychain copyDataForService:service
                                vaultId:vaultId
                               recordId:AncPrivateVaultCustodyRecordId
                                   data:&existing];
  if (read == AncPrivateVaultKeychainStatusOK && [existing isEqualToData:data])
    return AncPrivateVaultCustodyRepositoryStatusOK;
  AncPrivateVaultKeychainStatus write =
      read == AncPrivateVaultKeychainStatusNotFound
          ? [self.keychain addData:data
                        forService:service
                           vaultId:vaultId
                          recordId:AncPrivateVaultCustodyRecordId]
          : read == AncPrivateVaultKeychainStatusOK
                ? [self.keychain updateData:data
                                 forService:service
                                    vaultId:vaultId
                                   recordId:AncPrivateVaultCustodyRecordId]
                : read;
  if (write != AncPrivateVaultKeychainStatusOK)
    return AncRepositoryStatusForKeychain(write);
  NSData *observed = nil;
  AncPrivateVaultKeychainStatus verified =
      [self.keychain copyDataForService:service
                                vaultId:vaultId
                               recordId:AncPrivateVaultCustodyRecordId
                                   data:&observed];
  if (verified != AncPrivateVaultKeychainStatusOK)
    return AncRepositoryStatusForKeychain(verified);
  if (![observed isEqualToData:data])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  AncPrivateVaultCustodySnapshot snapshot;
  AncPrivateVaultCustodyHandle *validationHandle = nil;
  AncPrivateVaultCustodyRepositoryStatus decoded =
      AncDecodeRecord(observed, &snapshot, &validationHandle);
  if (validationHandle != nil) [validationHandle close];
  anc_pv_custody_snapshot_zero(&snapshot);
  return decoded;
}

- (AncPrivateVaultCustodyRepositoryStatus)deleteStageVaultId:(NSString *)vaultId {
  AncPrivateVaultKeychainStatus deleted =
      [self.keychain deleteDataForService:AncPrivateVaultCustodyStageService
                                   vaultId:vaultId
                                  recordId:AncPrivateVaultCustodyRecordId];
  if (deleted != AncPrivateVaultKeychainStatusOK)
    return AncRepositoryStatusForKeychain(deleted);
  NSData *observed = nil;
  AncPrivateVaultKeychainStatus read =
      [self.keychain copyDataForService:AncPrivateVaultCustodyStageService
                                vaultId:vaultId
                               recordId:AncPrivateVaultCustodyRecordId
                                   data:&observed];
  return read == AncPrivateVaultKeychainStatusNotFound
             ? AncPrivateVaultCustodyRepositoryStatusOK
             : read == AncPrivateVaultKeychainStatusOK
                   ? AncPrivateVaultCustodyRepositoryStatusConflict
                   : AncRepositoryStatusForKeychain(read);
}

- (AncPrivateVaultCustodyRepositoryStatus)
    finishStage:(NSData *)stage
          digest:(NSData *)digest
      generation:(uint64_t)generation
         vaultId:(NSString *)vaultId {
  AncPrivateVaultCustodyRepositoryStatus revoked = AncRevokeHandles(vaultId);
  if (revoked != AncPrivateVaultCustodyRepositoryStatusOK) return revoked;
  AncPrivateVaultFenceStatus fence =
      [self.fence beginGeneration:generation
                     recordDigest:digest
                          vaultId:vaultId
                         recordId:AncPrivateVaultCustodyRecordId];
  if (fence != AncPrivateVaultFenceStatusOK)
    return AncRepositoryStatusForFence(fence);
  AncPrivateVaultCustodyRepositoryStatus live =
      [self writeExact:stage
                service:AncPrivateVaultCustodyService
                vaultId:vaultId];
  if (live != AncPrivateVaultCustodyRepositoryStatusOK) return live;
  fence = [self.fence commitGeneration:generation
                           recordDigest:digest
                                vaultId:vaultId
                               recordId:AncPrivateVaultCustodyRecordId];
  if (fence != AncPrivateVaultFenceStatusOK)
    return AncRepositoryStatusForFence(fence);
  AncPrivateVaultFenceSnapshot *verifiedFence = nil;
  fence = [self.fence readVaultId:vaultId
                          recordId:AncPrivateVaultCustodyRecordId
                          snapshot:&verifiedFence];
  if (fence != AncPrivateVaultFenceStatusOK)
    return AncRepositoryStatusForFence(fence);
  if (verifiedFence.state != AncPrivateVaultFenceStateStable ||
      verifiedFence.generation != generation ||
      ![verifiedFence.recordDigest isEqualToData:digest])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  NSData *verifiedLive = nil;
  AncPrivateVaultCustodyRepositoryStatus read =
      [self readService:AncPrivateVaultCustodyService
                vaultId:vaultId
                   data:&verifiedLive];
  if (read != AncPrivateVaultCustodyRepositoryStatusOK) return read;
  NSData *liveDigest = AncCustodyDigest(verifiedLive);
  if (![verifiedLive isEqualToData:stage] || ![liveDigest isEqualToData:digest])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  return [self deleteStageVaultId:vaultId];
}

- (AncPrivateVaultCustodyRepositoryStatus)
    reconcileVaultId:(NSString *)vaultId
             liveData:(NSData **)outLive
         liveSnapshot:(AncPrivateVaultCustodySnapshot *)outSnapshot {
  *outLive = nil;
  anc_pv_custody_snapshot_zero(outSnapshot);
  NSData *live = nil;
  NSData *stage = nil;
  AncPrivateVaultCustodyRepositoryStatus liveStatus =
      [self readService:AncPrivateVaultCustodyService vaultId:vaultId data:&live];
  AncPrivateVaultCustodyRepositoryStatus stageStatus =
      [self readService:AncPrivateVaultCustodyStageService vaultId:vaultId data:&stage];
  if (liveStatus != AncPrivateVaultCustodyRepositoryStatusOK &&
      liveStatus != AncPrivateVaultCustodyRepositoryStatusNotFound)
    return liveStatus;
  if (stageStatus != AncPrivateVaultCustodyRepositoryStatusOK &&
      stageStatus != AncPrivateVaultCustodyRepositoryStatusNotFound)
    return stageStatus;

  AncPrivateVaultCustodySnapshot liveSnapshot;
  AncPrivateVaultCustodySnapshot stageSnapshot;
  if (liveStatus == AncPrivateVaultCustodyRepositoryStatusOK) {
    AncPrivateVaultCustodyHandle *validationHandle = nil;
    AncPrivateVaultCustodyRepositoryStatus decoded =
        AncDecodeRecord(live, &liveSnapshot, &validationHandle);
    if (validationHandle != nil) [validationHandle close];
    if (decoded != AncPrivateVaultCustodyRepositoryStatusOK) return decoded;
    if (!AncSnapshotMatchesVaultId(&liveSnapshot, vaultId))
      return AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
  } else {
    anc_pv_custody_snapshot_zero(&liveSnapshot);
  }
  if (stageStatus == AncPrivateVaultCustodyRepositoryStatusOK) {
    AncPrivateVaultCustodyHandle *validationHandle = nil;
    AncPrivateVaultCustodyRepositoryStatus decoded =
        AncDecodeRecord(stage, &stageSnapshot, &validationHandle);
    if (validationHandle != nil) [validationHandle close];
    if (decoded != AncPrivateVaultCustodyRepositoryStatusOK) return decoded;
    if (!AncSnapshotMatchesVaultId(&stageSnapshot, vaultId))
      return AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
  } else {
    anc_pv_custody_snapshot_zero(&stageSnapshot);
  }
  if ((live != nil && liveSnapshot.custody_generation == 1 &&
       AncLifecycleIsTombstone(&liveSnapshot)) ||
      (stage != nil && stageSnapshot.custody_generation == 1 &&
       AncLifecycleIsTombstone(&stageSnapshot)))
    return AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
  NSData *liveDigest = live == nil ? nil : AncCustodyDigest(live);
  NSData *stageDigest = stage == nil ? nil : AncCustodyDigest(stage);
  if ((live != nil && liveDigest == nil) || (stage != nil && stageDigest == nil))
    return AncPrivateVaultCustodyRepositoryStatusFailed;

  AncPrivateVaultFenceSnapshot *fence = nil;
  AncPrivateVaultFenceStatus fenceStatus =
      [self.fence readVaultId:vaultId
                      recordId:AncPrivateVaultCustodyRecordId
                      snapshot:&fence];
  if (fenceStatus != AncPrivateVaultFenceStatusOK)
    return AncRepositoryStatusForFence(fenceStatus);
  if (fence.state == AncPrivateVaultFenceStateAbsent) {
    if (live != nil) return AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
    if (stage == nil) return AncPrivateVaultCustodyRepositoryStatusNotFound;
    if (stageSnapshot.custody_generation != 1)
      return AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
    if (AncLifecycleIsTombstone(&stageSnapshot))
      return AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
    AncPrivateVaultCustodyRepositoryStatus finished =
        [self finishStage:stage
                   digest:stageDigest
               generation:1
                  vaultId:vaultId];
    if (finished != AncPrivateVaultCustodyRepositoryStatusOK) return finished;
    return [self reconcileVaultId:vaultId liveData:outLive liveSnapshot:outSnapshot];
  }
  if (fence.state == AncPrivateVaultFenceStatePending) {
    if (stage == nil || stageSnapshot.custody_generation != fence.generation ||
        ![stageDigest isEqualToData:fence.recordDigest])
      return AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
    if (live == nil && AncLifecycleIsTombstone(&stageSnapshot))
      return AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
    if (live != nil && liveSnapshot.custody_generation != UINT64_MAX &&
        stageSnapshot.custody_generation ==
            liveSnapshot.custody_generation + 1 &&
        !AncTerminalTransitionAllowed(&liveSnapshot, &stageSnapshot))
      return AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
    AncPrivateVaultCustodyRepositoryStatus finished =
        [self finishStage:stage
                   digest:stageDigest
               generation:fence.generation
                  vaultId:vaultId];
    if (finished != AncPrivateVaultCustodyRepositoryStatusOK) return finished;
    return [self reconcileVaultId:vaultId liveData:outLive liveSnapshot:outSnapshot];
  }
  if (live == nil || liveSnapshot.custody_generation != fence.generation ||
      ![liveDigest isEqualToData:fence.recordDigest])
    return AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
  if (stage != nil) {
    if (stageSnapshot.custody_generation == fence.generation &&
        [stageDigest isEqualToData:fence.recordDigest]) {
      AncPrivateVaultFenceStatus committed =
          [self.fence commitGeneration:fence.generation
                           recordDigest:fence.recordDigest
                                vaultId:vaultId
                               recordId:AncPrivateVaultCustodyRecordId];
      if (committed != AncPrivateVaultFenceStatusOK)
        return AncRepositoryStatusForFence(committed);
      AncPrivateVaultCustodyRepositoryStatus deleted =
          [self deleteStageVaultId:vaultId];
      if (deleted != AncPrivateVaultCustodyRepositoryStatusOK) return deleted;
    } else if (fence.generation != UINT64_MAX &&
               stageSnapshot.custody_generation == fence.generation + 1) {
      if (!AncTerminalTransitionAllowed(&liveSnapshot, &stageSnapshot))
        return AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
      AncPrivateVaultCustodyRepositoryStatus finished =
          [self finishStage:stage
                     digest:stageDigest
                 generation:stageSnapshot.custody_generation
                    vaultId:vaultId];
      if (finished != AncPrivateVaultCustodyRepositoryStatusOK) return finished;
      return [self reconcileVaultId:vaultId liveData:outLive liveSnapshot:outSnapshot];
    } else {
      return AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
    }
  }
  *outLive = live;
  *outSnapshot = liveSnapshot;
  return AncPrivateVaultCustodyRepositoryStatusOK;
}

- (AncPrivateVaultCustodyRepositoryStatus)
    storeLockedSnapshot:(const AncPrivateVaultCustodySnapshot *)snapshot
                 secrets:(const AncPrivateVaultCustodySecretInputs *)secrets
                 vaultId:(NSString *)vaultId {
  uint8_t encoded[ANC_PV_CUSTODY_RECORD_BYTES] = {0};
  if (!AncSnapshotMatchesVaultId(snapshot, vaultId))
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  AncPrivateVaultCustodyRecordStatus encodedStatus =
      anc_pv_custody_record_encode(snapshot, secrets, encoded, sizeof encoded);
  if (encodedStatus != ANC_PV_CUSTODY_OK) {
    anc_pv_zeroize(encoded, sizeof encoded);
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  }
  NSData *candidate = [NSData dataWithBytes:encoded length:sizeof encoded];
  anc_pv_zeroize(encoded, sizeof encoded);
  NSData *current = nil;
  AncPrivateVaultCustodySnapshot currentSnapshot;
  AncPrivateVaultCustodyRepositoryStatus reconciled =
      [self reconcileVaultId:vaultId
                    liveData:&current
                liveSnapshot:&currentSnapshot];
  if (reconciled != AncPrivateVaultCustodyRepositoryStatusOK &&
      reconciled != AncPrivateVaultCustodyRepositoryStatusNotFound)
    return reconciled;
  if (reconciled == AncPrivateVaultCustodyRepositoryStatusNotFound) {
    if (snapshot->custody_generation != 1 ||
        AncLifecycleIsTombstone(snapshot))
      return AncPrivateVaultCustodyRepositoryStatusConflict;
  } else {
    if (snapshot->custody_generation == currentSnapshot.custody_generation)
      return [candidate isEqualToData:current]
                 ? AncPrivateVaultCustodyRepositoryStatusOK
                 : AncPrivateVaultCustodyRepositoryStatusConflict;
    if (currentSnapshot.custody_generation == UINT64_MAX ||
        snapshot->custody_generation != currentSnapshot.custody_generation + 1)
      return AncPrivateVaultCustodyRepositoryStatusConflict;
    if (!AncTerminalTransitionAllowed(&currentSnapshot, snapshot))
      return AncPrivateVaultCustodyRepositoryStatusConflict;
  }
  AncPrivateVaultCustodyRepositoryStatus revoked = AncRevokeHandles(vaultId);
  if (revoked != AncPrivateVaultCustodyRepositoryStatusOK) return revoked;
  AncPrivateVaultCustodyRepositoryStatus staged =
      [self writeExact:candidate
                service:AncPrivateVaultCustodyStageService
                vaultId:vaultId];
  if (staged != AncPrivateVaultCustodyRepositoryStatusOK) return staged;
  NSData *digest = AncCustodyDigest(candidate);
  if (digest == nil) return AncPrivateVaultCustodyRepositoryStatusFailed;
  return [self finishStage:candidate
                    digest:digest
                generation:snapshot->custody_generation
                   vaultId:vaultId];
}

- (AncPrivateVaultCustodyRepositoryStatus)
    storeSnapshot:(const AncPrivateVaultCustodySnapshot *)snapshot
           secrets:(const AncPrivateVaultCustodySecretInputs *)secrets
           vaultId:(NSString *)vaultId {
  if ([NSThread.currentThread
          .threadDictionary[kAncCustodyBorrowScopeThreadKey] boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  if (snapshot == NULL || secrets == NULL || vaultId.length == 0)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  __block AncPrivateVaultCustodyRepositoryStatus status;
  dispatch_sync(self.queue, ^{
    status = [self storeLockedSnapshot:snapshot secrets:secrets vaultId:vaultId];
  });
  return status;
}

- (AncPrivateVaultCustodyRepositoryStatus)
    readVaultId:(NSString *)vaultId
       snapshot:(AncPrivateVaultCustodySnapshot *)snapshot
          handle:(AncPrivateVaultCustodyHandle **)handle {
  if ([NSThread.currentThread
          .threadDictionary[kAncCustodyBorrowScopeThreadKey] boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  if (vaultId.length == 0 || snapshot == NULL || handle == NULL)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  anc_pv_custody_snapshot_zero(snapshot);
  *handle = nil;
  __block AncPrivateVaultCustodyRepositoryStatus status;
  __block AncPrivateVaultCustodySnapshot resultSnapshot;
  __block AncPrivateVaultCustodyHandle *resultHandle = nil;
  dispatch_sync(self.queue, ^{
    NSData *live = nil;
    AncPrivateVaultCustodySnapshot value;
    status = [self reconcileVaultId:vaultId
                           liveData:&live
                       liveSnapshot:&value];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK) return;
    AncPrivateVaultCustodyHandle *custodyHandle = nil;
    AncPrivateVaultCustodySnapshot decoded;
    status = AncDecodeRecord(live, &decoded, &custodyHandle);
    if (status != AncPrivateVaultCustodyRepositoryStatusOK) return;
    if (decoded.custody_generation != value.custody_generation) {
      [custodyHandle close];
      status = AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
      return;
    }
    resultSnapshot = decoded;
    if (AncLifecycleIsTombstone(&decoded)) {
      [custodyHandle close];
      return;
    }
    AncRegisterHandle(custodyHandle, vaultId, decoded.custody_generation);
    resultHandle = custodyHandle;
  });
  if (status == AncPrivateVaultCustodyRepositoryStatusOK) {
    *snapshot = resultSnapshot;
    *handle = resultHandle;
  }
  return status;
}

@end
