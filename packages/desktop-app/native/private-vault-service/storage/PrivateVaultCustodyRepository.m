#import "PrivateVaultCustodyRepository.h"

#include <stdlib.h>

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

typedef BOOL (^AncCustodyRecordBorrowBlock)(uint8_t *record);

@interface AncCustodyRecordBuffer : NSObject
@property(nonatomic, strong, readonly) AncPrivateVaultGuardedMemory *memory;
- (instancetype)initEmpty;
- (AncPrivateVaultCustodyRepositoryStatus)borrow:
    (AncCustodyRecordBorrowBlock)block;
- (AncPrivateVaultCustodyRepositoryStatus)close;
@end

@implementation AncCustodyRecordBuffer

- (instancetype)initEmpty {
  self = [super init];
  if (self == nil)
    return nil;
  AncPrivateVaultGuardedMemoryStatus status;
  _memory = [AncPrivateVaultGuardedMemory
      memoryWithLength:ANC_PV_CUSTODY_RECORD_BYTES
                status:&status];
  if (_memory == nil || status != AncPrivateVaultGuardedMemoryStatusOK)
    return nil;
  return self;
}

- (AncPrivateVaultCustodyRepositoryStatus)borrow:
    (AncCustodyRecordBorrowBlock)block {
  if (block == nil || self.memory == nil)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  AncPrivateVaultGuardedMemoryStatus status =
      [self.memory borrow:^BOOL(uint8_t *bytes, size_t length) {
        return length == ANC_PV_CUSTODY_RECORD_BYTES && block(bytes);
      }];
  switch (status) {
  case AncPrivateVaultGuardedMemoryStatusOK:
    return AncPrivateVaultCustodyRepositoryStatusOK;
  case AncPrivateVaultGuardedMemoryStatusClosed:
  case AncPrivateVaultGuardedMemoryStatusInvalid:
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  case AncPrivateVaultGuardedMemoryStatusAllocationFailed:
  case AncPrivateVaultGuardedMemoryStatusProtectionFailed:
  case AncPrivateVaultGuardedMemoryStatusCallbackFailed:
    return AncPrivateVaultCustodyRepositoryStatusFailed;
  }
}

- (AncPrivateVaultCustodyRepositoryStatus)close {
  AncPrivateVaultGuardedMemoryStatus status = [self.memory close];
  return status == AncPrivateVaultGuardedMemoryStatusOK
             ? AncPrivateVaultCustodyRepositoryStatusOK
             : AncPrivateVaultCustodyRepositoryStatusFailed;
}

- (void)dealloc {
  [self close];
}

@end

@interface AncPrivateVaultCustodyHandle ()
@property(nonatomic, strong, readonly) AncPrivateVaultGuardedMemory *memory;
- (instancetype)initEmpty;
@end

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultCustodyBeforeHandleCloseTestHook
    gAncBeforeHandleCloseTestHook;
static AncPrivateVaultCustodyHandleCloseStatusTestHook
    gAncHandleCloseStatusTestHook;

void AncPrivateVaultCustodySetBeforeHandleCloseForTesting(
    AncPrivateVaultCustodyBeforeHandleCloseTestHook hook) {
  gAncBeforeHandleCloseTestHook = [hook copy];
}
void AncPrivateVaultCustodySetHandleCloseStatusForTesting(
    AncPrivateVaultCustodyHandleCloseStatusTestHook hook) {
  gAncHandleCloseStatusTestHook = [hook copy];
}
#endif

@implementation AncPrivateVaultCustodyHandle

- (instancetype)initEmpty {
  self = [super init];
  if (self == nil)
    return nil;
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

- (AncPrivateVaultCustodyRepositoryStatus)borrow:
    (AncPrivateVaultCustodyHandleBorrowBlock)block {
  if ([NSThread.currentThread.threadDictionary[kAncCustodyBorrowScopeThreadKey]
          boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  AncPrivateVaultGuardedMemory *memory = self.memory;
  if (block == nil || memory == nil)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  AncPrivateVaultGuardedMemoryStatus status =
      [memory borrow:^BOOL(uint8_t *bytes, size_t length) {
        if (length != sizeof(AncGuardedCustodySecrets))
          return NO;
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
  if ([NSThread.currentThread.threadDictionary[kAncCustodyBorrowScopeThreadKey]
          boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  AncPrivateVaultGuardedMemory *memory = self.memory;
  if (memory == nil)
    return AncPrivateVaultCustodyRepositoryStatusOK;
#if ANC_PRIVATE_VAULT_TESTING
  AncPrivateVaultCustodyBeforeHandleCloseTestHook hook =
      gAncBeforeHandleCloseTestHook;
  if (hook != nil)
    hook(self);
#endif
  AncPrivateVaultGuardedMemoryStatus status = [memory close];
  AncPrivateVaultCustodyRepositoryStatus result =
      status == AncPrivateVaultGuardedMemoryStatusOK
          ? AncPrivateVaultCustodyRepositoryStatusOK
          : AncPrivateVaultCustodyRepositoryStatusFailed;
#if ANC_PRIVATE_VAULT_TESTING
  AncPrivateVaultCustodyHandleCloseStatusTestHook statusHook =
      gAncHandleCloseStatusTestHook;
  if (statusHook != nil)
    result = statusHook(self, result);
#endif
  return result;
}

- (void)dealloc {
  [self close];
}

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
  static NSMutableDictionary<
      NSString *, NSMutableDictionary<NSNumber *, NSHashTable *> *> *registry;
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

static AncPrivateVaultCustodyRepositoryStatus
AncRevokeHandles(NSString *vaultId) {
  NSMutableDictionary<NSNumber *, NSHashTable *> *vault =
      AncCustodyHandleRegistry()[vaultId];
  if (vault == nil)
    return AncPrivateVaultCustodyRepositoryStatusOK;
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

static AncPrivateVaultCustodySecretOutputs
AncOutputs(AncGuardedCustodySecrets *secrets) {
  return (AncPrivateVaultCustodySecretOutputs){
      .signing_seed = secrets->signingSeed,
      .box_seed = secrets->boxSeed,
      .local_state_key = secrets->localStateKey,
      .active_epoch_key = secrets->activeEpochKey,
      .pending_epoch_key = secrets->pendingEpochKey,
  };
}

static AncPrivateVaultCustodyRepositoryStatus
AncRepositoryStatusForKeychain(AncPrivateVaultKeychainStatus status) {
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

static AncPrivateVaultCustodyRepositoryStatus
AncRepositoryStatusForFence(AncPrivateVaultFenceStatus status) {
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

static NSData *_Nullable AncCustodyDigest(AncCustodyRecordBuffer *record) {
  typedef struct AncCustodyDigestBytes {
    uint8_t bytes[ANC_PV_HASH_BYTES];
  } AncCustodyDigestBytes;
  __block AncCustodyDigestBytes digest = {0};
  __block BOOL hashed = NO;
  AncPrivateVaultCustodyRepositoryStatus borrowed =
      [record borrow:^BOOL(uint8_t *bytes) {
        hashed = anc_pv_blake2b_256_two_part(
                     digest.bytes,
                     (const uint8_t *)kCustodyFenceDigestDomain,
                     sizeof kCustodyFenceDigestDomain, bytes,
                     ANC_PV_CUSTODY_RECORD_BYTES) == ANC_PV_CRYPTO_OK;
        return hashed;
      }];
  if (borrowed != AncPrivateVaultCustodyRepositoryStatusOK || !hashed) {
    anc_pv_zeroize(&digest, sizeof digest);
    return nil;
  }
  NSData *result = [NSData dataWithBytes:digest.bytes length:32];
  anc_pv_zeroize(&digest, sizeof digest);
  return result;
}

static AncPrivateVaultCustodyRepositoryStatus
AncDecodeRecord(AncCustodyRecordBuffer *record,
                AncPrivateVaultCustodySnapshot *snapshot,
                AncPrivateVaultCustodyHandle **outHandle) {
  if (outHandle == NULL)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  *outHandle = nil;
  if (record == nil)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  AncPrivateVaultCustodyHandle *handle =
      [[AncPrivateVaultCustodyHandle alloc] initEmpty];
  if (handle == nil)
    return AncPrivateVaultCustodyRepositoryStatusFailed;
  __block AncPrivateVaultCustodyRecordStatus decodeStatus =
      ANC_PV_CUSTODY_INVALID_RECORD;
  AncPrivateVaultGuardedMemoryStatus guardedStatus =
      [handle.memory borrow:^BOOL(uint8_t *bytes, size_t length) {
        if (length != sizeof(AncGuardedCustodySecrets))
          return NO;
        AncPrivateVaultCustodySecretOutputs outputs =
            AncOutputs((AncGuardedCustodySecrets *)bytes);
        AncPrivateVaultCustodyRepositoryStatus recordBorrow =
            [record borrow:^BOOL(uint8_t *recordBytes) {
              decodeStatus = anc_pv_custody_record_decode(
                  recordBytes, ANC_PV_CUSTODY_RECORD_BYTES, snapshot, &outputs);
              return decodeStatus == ANC_PV_CUSTODY_OK;
            }];
        return recordBorrow == AncPrivateVaultCustodyRepositoryStatusOK &&
               decodeStatus == ANC_PV_CUSTODY_OK;
      }];
  if (guardedStatus != AncPrivateVaultGuardedMemoryStatusOK ||
      decodeStatus != ANC_PV_CUSTODY_OK) {
    AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
    anc_pv_custody_snapshot_zero(snapshot);
    if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
      return closed;
    return decodeStatus == ANC_PV_CUSTODY_INVALID_RECORD ||
                   decodeStatus == ANC_PV_CUSTODY_CHECKSUM_FAILED
               ? AncPrivateVaultCustodyRepositoryStatusCorrupt
               : AncPrivateVaultCustodyRepositoryStatusFailed;
  }
  *outHandle = handle;
  return AncPrivateVaultCustodyRepositoryStatusOK;
}

static BOOL
AncSnapshotMatchesVaultId(const AncPrivateVaultCustodySnapshot *snapshot,
                          NSString *vaultId) {
  NSData *value = [vaultId dataUsingEncoding:NSUTF8StringEncoding];
  return value.length == snapshot->vault_id_length && value.length > 0 &&
         memcmp(value.bytes, snapshot->vault_id, value.length) == 0;
}

static BOOL
AncTerminalPublicStateMatches(const AncPrivateVaultCustodySnapshot *current,
                              const AncPrivateVaultCustodySnapshot *next) {
  AncPrivateVaultCustodySnapshot normalized = *next;
  normalized.record_version = current->record_version;
  normalized.lifecycle = current->lifecycle;
  normalized.custody_generation = current->custody_generation;
  return memcmp(current, &normalized, sizeof normalized) == 0;
}

static BOOL
AncTerminalTransitionAllowed(const AncPrivateVaultCustodySnapshot *current,
                             const AncPrivateVaultCustodySnapshot *next) {
  if (current->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED ||
      current->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVING) {
    if (current->custody_generation == UINT64_MAX ||
        next->custody_generation != current->custody_generation + 1 ||
        !AncTerminalPublicStateMatches(current, next))
      return NO;
    const BOOL legacyMigration =
        current->record_version == ANC_PV_CUSTODY_LEGACY_VERSION &&
        next->record_version == ANC_PV_CUSTODY_VERSION &&
        next->lifecycle == current->lifecycle;
    const BOOL removalCompletion =
        current->record_version == next->record_version &&
        current->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVING &&
        next->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED;
    return legacyMigration || removalCompletion;
  }
  if (next->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED)
    return NO;
  return YES;
}

static BOOL
AncLifecycleIsTombstone(const AncPrivateVaultCustodySnapshot *snapshot) {
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
  if (self == nil || keychain == nil)
    return nil;
  _keychain = keychain;
  _fence = [[AncPrivateVaultGenerationFence alloc] initWithKeychain:keychain];
  if (_fence == nil)
    return nil;
  _queue = AncCustodyRepositoryQueue();
  return self;
}

- (AncPrivateVaultCustodyRepositoryStatus)readService:(NSString *)service
                                              vaultId:(NSString *)vaultId
                                               record:(AncCustodyRecordBuffer **)
                                                          outRecord {
  if (outRecord == NULL)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  *outRecord = nil;
  __block AncCustodyRecordBuffer *record = nil;
  __block AncPrivateVaultCustodyRepositoryStatus importStatus =
      AncPrivateVaultCustodyRepositoryStatusOK;
  AncPrivateVaultKeychainStatus read = [self.keychain
      consumeCustodyRecordForService:service
                             vaultId:vaultId
                            recordId:AncPrivateVaultCustodyRecordId
                            consumer:^BOOL(const uint8_t *bytes) {
                              record = [[AncCustodyRecordBuffer alloc] initEmpty];
                              if (record == nil) {
                                importStatus =
                                    AncPrivateVaultCustodyRepositoryStatusFailed;
                                return NO;
                              }
                              importStatus = [record borrow:^BOOL(uint8_t *target) {
                                memcpy(target, bytes,
                                       ANC_PV_CUSTODY_RECORD_BYTES);
                                return YES;
                              }];
                              return importStatus ==
                                     AncPrivateVaultCustodyRepositoryStatusOK;
                            }];
  if (read != AncPrivateVaultKeychainStatusOK) {
    AncPrivateVaultCustodyRepositoryStatus closed =
        record == nil ? AncPrivateVaultCustodyRepositoryStatusOK
                      : [record close];
    if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
      return closed;
    return importStatus != AncPrivateVaultCustodyRepositoryStatusOK
               ? importStatus
               : AncRepositoryStatusForKeychain(read);
  }
  *outRecord = record;
  return AncPrivateVaultCustodyRepositoryStatusOK;
}

- (AncPrivateVaultCustodyRepositoryStatus)
    recordsEqual:(AncCustodyRecordBuffer *)left
            right:(AncCustodyRecordBuffer *)right
            equal:(BOOL *)equal {
  if (left == nil || right == nil || equal == NULL)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  *equal = NO;
  __block AncPrivateVaultCustodyRepositoryStatus inner =
      AncPrivateVaultCustodyRepositoryStatusFailed;
  AncPrivateVaultCustodyRepositoryStatus outer =
      [left borrow:^BOOL(uint8_t *leftBytes) {
        inner = [right borrow:^BOOL(uint8_t *rightBytes) {
          *equal = anc_pv_memcmp(leftBytes, rightBytes,
                                ANC_PV_CUSTODY_RECORD_BYTES) ==
                   ANC_PV_CRYPTO_OK;
          return YES;
        }];
        return inner == AncPrivateVaultCustodyRepositoryStatusOK;
      }];
  return outer == AncPrivateVaultCustodyRepositoryStatusOK ? inner : outer;
}

- (AncPrivateVaultCustodyRepositoryStatus)writeExact:
                                                (AncCustodyRecordBuffer *)record
                                             service:(NSString *)service
                                             vaultId:(NSString *)vaultId {
  AncCustodyRecordBuffer *existing = nil;
  AncPrivateVaultCustodyRepositoryStatus read =
      [self readService:service vaultId:vaultId record:&existing];
  BOOL equal = NO;
  if (read == AncPrivateVaultCustodyRepositoryStatusOK) {
    AncPrivateVaultCustodyRepositoryStatus compared =
        [self recordsEqual:existing right:record equal:&equal];
    AncPrivateVaultCustodyRepositoryStatus closed = [existing close];
    if (compared != AncPrivateVaultCustodyRepositoryStatusOK)
      return compared;
    if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
      return closed;
    if (equal)
      return AncPrivateVaultCustodyRepositoryStatusOK;
  } else if (read != AncPrivateVaultCustodyRepositoryStatusNotFound) {
    return read;
  }
  __block AncPrivateVaultKeychainStatus write =
      AncPrivateVaultKeychainStatusFailed;
  AncPrivateVaultCustodyRepositoryStatus borrowed =
      [record borrow:^BOOL(uint8_t *bytes) {
        write = read == AncPrivateVaultCustodyRepositoryStatusNotFound
                    ? [self.keychain
                          addCustodyRecord:bytes
                                     length:ANC_PV_CUSTODY_RECORD_BYTES
                               forService:service
                                  vaultId:vaultId
                                 recordId:AncPrivateVaultCustodyRecordId]
                    : [self.keychain
                          updateCustodyRecord:bytes
                                        length:ANC_PV_CUSTODY_RECORD_BYTES
                                  forService:service
                                     vaultId:vaultId
                                    recordId:AncPrivateVaultCustodyRecordId];
        return YES;
      }];
  if (borrowed != AncPrivateVaultCustodyRepositoryStatusOK)
    return borrowed;
  if (write != AncPrivateVaultKeychainStatusOK)
    return AncRepositoryStatusForKeychain(write);
  AncCustodyRecordBuffer *observed = nil;
  read = [self readService:service vaultId:vaultId record:&observed];
  if (read != AncPrivateVaultCustodyRepositoryStatusOK)
    return read;
  AncPrivateVaultCustodyRepositoryStatus compared =
      [self recordsEqual:observed right:record equal:&equal];
  AncPrivateVaultCustodySnapshot snapshot;
  AncPrivateVaultCustodyHandle *validationHandle = nil;
  AncPrivateVaultCustodyRepositoryStatus decoded =
      AncDecodeRecord(observed, &snapshot, &validationHandle);
  AncPrivateVaultCustodyRepositoryStatus closed =
      validationHandle == nil ? AncPrivateVaultCustodyRepositoryStatusOK
                              : [validationHandle close];
  AncPrivateVaultCustodyRepositoryStatus observedClosed = [observed close];
  anc_pv_custody_snapshot_zero(&snapshot);
  if (compared != AncPrivateVaultCustodyRepositoryStatusOK)
    return compared;
  if (!equal)
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
    return closed;
  if (observedClosed != AncPrivateVaultCustodyRepositoryStatusOK)
    return observedClosed;
  return decoded;
}

- (AncPrivateVaultCustodyRepositoryStatus)deleteStageVaultId:
    (NSString *)vaultId {
  AncPrivateVaultKeychainStatus deleted =
      [self.keychain
          deleteCustodyRecordForService:AncPrivateVaultCustodyStageService
                                 vaultId:vaultId
                                recordId:AncPrivateVaultCustodyRecordId];
  if (deleted != AncPrivateVaultKeychainStatusOK)
    return AncRepositoryStatusForKeychain(deleted);
  __block BOOL observed = NO;
  AncPrivateVaultKeychainStatus read = [self.keychain
      consumeCustodyRecordForService:AncPrivateVaultCustodyStageService
                             vaultId:vaultId
                            recordId:AncPrivateVaultCustodyRecordId
                            consumer:^BOOL(const uint8_t *bytes) {
                              (void)bytes;
                              observed = YES;
                              return YES;
                            }];
  return read == AncPrivateVaultKeychainStatusNotFound
             ? AncPrivateVaultCustodyRepositoryStatusOK
         : read == AncPrivateVaultKeychainStatusOK && observed
             ? AncPrivateVaultCustodyRepositoryStatusConflict
             : AncRepositoryStatusForKeychain(read);
}

- (AncPrivateVaultCustodyRepositoryStatus)
    finishStage:(AncCustodyRecordBuffer *)stage
                                               digest:(NSData *)digest
                                           generation:(uint64_t)generation
                                              vaultId:(NSString *)vaultId {
  AncPrivateVaultCustodyRepositoryStatus revoked = AncRevokeHandles(vaultId);
  if (revoked != AncPrivateVaultCustodyRepositoryStatusOK)
    return revoked;
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
  if (live != AncPrivateVaultCustodyRepositoryStatusOK)
    return live;
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
  AncCustodyRecordBuffer *verifiedLive = nil;
  AncPrivateVaultCustodyRepositoryStatus read =
      [self readService:AncPrivateVaultCustodyService
                vaultId:vaultId
                 record:&verifiedLive];
  if (read != AncPrivateVaultCustodyRepositoryStatusOK)
    return read;
  NSData *liveDigest = AncCustodyDigest(verifiedLive);
  BOOL equal = NO;
  AncPrivateVaultCustodyRepositoryStatus compared =
      [self recordsEqual:verifiedLive right:stage equal:&equal];
  AncPrivateVaultCustodyRepositoryStatus closed = [verifiedLive close];
  if (compared != AncPrivateVaultCustodyRepositoryStatusOK)
    return compared;
  if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
    return closed;
  if (!equal || ![liveDigest isEqualToData:digest])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  return [self deleteStageVaultId:vaultId];
}

- (AncPrivateVaultCustodyRepositoryStatus)
    reconcileVaultId:(NSString *)vaultId
          liveRecord:(AncCustodyRecordBuffer **)outLive
        liveSnapshot:(AncPrivateVaultCustodySnapshot *)outSnapshot {
  *outLive = nil;
  anc_pv_custody_snapshot_zero(outSnapshot);
  __block AncCustodyRecordBuffer *live = nil;
  __block AncCustodyRecordBuffer *stage = nil;
  AncPrivateVaultCustodyRepositoryStatus (^closeBoth)(
      AncPrivateVaultCustodyRepositoryStatus) =
      ^AncPrivateVaultCustodyRepositoryStatus(
          AncPrivateVaultCustodyRepositoryStatus result) {
        AncPrivateVaultCustodyRepositoryStatus liveClosed =
            live == nil ? AncPrivateVaultCustodyRepositoryStatusOK
                        : [live close];
        AncPrivateVaultCustodyRepositoryStatus stageClosed =
            stage == nil ? AncPrivateVaultCustodyRepositoryStatusOK
                         : [stage close];
        if (liveClosed != AncPrivateVaultCustodyRepositoryStatusOK)
          return liveClosed;
        if (stageClosed != AncPrivateVaultCustodyRepositoryStatusOK)
          return stageClosed;
        return result;
      };
  AncPrivateVaultCustodyRepositoryStatus liveStatus =
      [self readService:AncPrivateVaultCustodyService
                vaultId:vaultId
                 record:&live];
  AncPrivateVaultCustodyRepositoryStatus stageStatus =
      [self readService:AncPrivateVaultCustodyStageService
                vaultId:vaultId
                 record:&stage];
  if (liveStatus != AncPrivateVaultCustodyRepositoryStatusOK &&
      liveStatus != AncPrivateVaultCustodyRepositoryStatusNotFound)
    return closeBoth(liveStatus);
  if (stageStatus != AncPrivateVaultCustodyRepositoryStatusOK &&
      stageStatus != AncPrivateVaultCustodyRepositoryStatusNotFound)
    return closeBoth(stageStatus);

  AncPrivateVaultCustodySnapshot liveSnapshot;
  AncPrivateVaultCustodySnapshot stageSnapshot;
  if (liveStatus == AncPrivateVaultCustodyRepositoryStatusOK) {
    AncPrivateVaultCustodyHandle *validationHandle = nil;
    AncPrivateVaultCustodyRepositoryStatus decoded =
        AncDecodeRecord(live, &liveSnapshot, &validationHandle);
    AncPrivateVaultCustodyRepositoryStatus closed =
        validationHandle == nil ? AncPrivateVaultCustodyRepositoryStatusOK
                                : [validationHandle close];
    if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
      return closeBoth(closed);
    if (decoded != AncPrivateVaultCustodyRepositoryStatusOK)
      return closeBoth(decoded);
    if (!AncSnapshotMatchesVaultId(&liveSnapshot, vaultId))
      return closeBoth(AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
  } else {
    anc_pv_custody_snapshot_zero(&liveSnapshot);
  }
  if (stageStatus == AncPrivateVaultCustodyRepositoryStatusOK) {
    AncPrivateVaultCustodyHandle *validationHandle = nil;
    AncPrivateVaultCustodyRepositoryStatus decoded =
        AncDecodeRecord(stage, &stageSnapshot, &validationHandle);
    AncPrivateVaultCustodyRepositoryStatus closed =
        validationHandle == nil ? AncPrivateVaultCustodyRepositoryStatusOK
                                : [validationHandle close];
    if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
      return closeBoth(closed);
    if (decoded != AncPrivateVaultCustodyRepositoryStatusOK)
      return closeBoth(decoded);
    if (!AncSnapshotMatchesVaultId(&stageSnapshot, vaultId))
      return closeBoth(AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
  } else {
    anc_pv_custody_snapshot_zero(&stageSnapshot);
  }
  if ((live != nil && liveSnapshot.custody_generation == 1 &&
       AncLifecycleIsTombstone(&liveSnapshot)) ||
      (stage != nil && stageSnapshot.custody_generation == 1 &&
       AncLifecycleIsTombstone(&stageSnapshot)))
    return closeBoth(AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
  NSData *liveDigest = live == nil ? nil : AncCustodyDigest(live);
  NSData *stageDigest = stage == nil ? nil : AncCustodyDigest(stage);
  if ((live != nil && liveDigest == nil) ||
      (stage != nil && stageDigest == nil))
    return closeBoth(AncPrivateVaultCustodyRepositoryStatusFailed);

  AncPrivateVaultFenceSnapshot *fence = nil;
  AncPrivateVaultFenceStatus fenceStatus =
      [self.fence readVaultId:vaultId
                     recordId:AncPrivateVaultCustodyRecordId
                     snapshot:&fence];
  if (fenceStatus != AncPrivateVaultFenceStatusOK)
    return closeBoth(AncRepositoryStatusForFence(fenceStatus));
  if (fence.state == AncPrivateVaultFenceStateAbsent) {
    if (live != nil)
      return closeBoth(AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
    if (stage == nil)
      return closeBoth(AncPrivateVaultCustodyRepositoryStatusNotFound);
    if (stageSnapshot.custody_generation != 1)
      return closeBoth(AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
    if (AncLifecycleIsTombstone(&stageSnapshot))
      return closeBoth(AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
    AncPrivateVaultCustodyRepositoryStatus finished =
        [self finishStage:stage
                   digest:stageDigest
               generation:1
                  vaultId:vaultId];
    if (finished != AncPrivateVaultCustodyRepositoryStatusOK)
      return closeBoth(finished);
    AncPrivateVaultCustodyRepositoryStatus closed =
        closeBoth(AncPrivateVaultCustodyRepositoryStatusOK);
    if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
      return closed;
    return [self reconcileVaultId:vaultId
                       liveRecord:outLive
                     liveSnapshot:outSnapshot];
  }
  if (fence.state == AncPrivateVaultFenceStatePending) {
    if (stage == nil || stageSnapshot.custody_generation != fence.generation ||
        ![stageDigest isEqualToData:fence.recordDigest])
      return closeBoth(AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
    if (live == nil && AncLifecycleIsTombstone(&stageSnapshot))
      return closeBoth(AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
    if (live != nil) {
      if (stageSnapshot.custody_generation == liveSnapshot.custody_generation) {
        if (![liveDigest isEqualToData:stageDigest])
          return closeBoth(
              AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
      } else {
        if (liveSnapshot.custody_generation == UINT64_MAX ||
            stageSnapshot.custody_generation !=
                liveSnapshot.custody_generation + 1)
          return closeBoth(
              AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
        if (!AncTerminalTransitionAllowed(&liveSnapshot, &stageSnapshot))
          return closeBoth(
              AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
      }
    }
    AncPrivateVaultCustodyRepositoryStatus finished =
        [self finishStage:stage
                   digest:stageDigest
               generation:fence.generation
                  vaultId:vaultId];
    if (finished != AncPrivateVaultCustodyRepositoryStatusOK)
      return closeBoth(finished);
    AncPrivateVaultCustodyRepositoryStatus closed =
        closeBoth(AncPrivateVaultCustodyRepositoryStatusOK);
    if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
      return closed;
    return [self reconcileVaultId:vaultId
                       liveRecord:outLive
                     liveSnapshot:outSnapshot];
  }
  if (live == nil || liveSnapshot.custody_generation != fence.generation ||
      ![liveDigest isEqualToData:fence.recordDigest])
    return closeBoth(AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
  if (stage != nil) {
    if (stageSnapshot.custody_generation == fence.generation &&
        [stageDigest isEqualToData:fence.recordDigest]) {
      AncPrivateVaultFenceStatus committed =
          [self.fence commitGeneration:fence.generation
                          recordDigest:fence.recordDigest
                               vaultId:vaultId
                              recordId:AncPrivateVaultCustodyRecordId];
      if (committed != AncPrivateVaultFenceStatusOK)
        return closeBoth(AncRepositoryStatusForFence(committed));
      AncPrivateVaultCustodyRepositoryStatus deleted =
          [self deleteStageVaultId:vaultId];
      if (deleted != AncPrivateVaultCustodyRepositoryStatusOK)
        return closeBoth(deleted);
    } else if (fence.generation != UINT64_MAX &&
               stageSnapshot.custody_generation == fence.generation + 1) {
      if (!AncTerminalTransitionAllowed(&liveSnapshot, &stageSnapshot))
        return closeBoth(
            AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
      AncPrivateVaultCustodyRepositoryStatus finished =
          [self finishStage:stage
                     digest:stageDigest
                 generation:stageSnapshot.custody_generation
                    vaultId:vaultId];
      if (finished != AncPrivateVaultCustodyRepositoryStatusOK)
        return closeBoth(finished);
      AncPrivateVaultCustodyRepositoryStatus closed =
          closeBoth(AncPrivateVaultCustodyRepositoryStatusOK);
      if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
        return closed;
      return [self reconcileVaultId:vaultId
                         liveRecord:outLive
                       liveSnapshot:outSnapshot];
    } else {
      return closeBoth(AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
    }
  }
  AncPrivateVaultCustodyRepositoryStatus stageClosed =
      stage == nil ? AncPrivateVaultCustodyRepositoryStatusOK : [stage close];
  if (stageClosed != AncPrivateVaultCustodyRepositoryStatusOK)
    return closeBoth(stageClosed);
  stage = nil;
  *outLive = live;
  live = nil;
  *outSnapshot = liveSnapshot;
  return AncPrivateVaultCustodyRepositoryStatusOK;
}

- (AncPrivateVaultCustodyRepositoryStatus)
    storeLockedSnapshot:(const AncPrivateVaultCustodySnapshot *)snapshot
                secrets:(const AncPrivateVaultCustodySecretInputs *)secrets
                vaultId:(NSString *)vaultId {
  if (!AncSnapshotMatchesVaultId(snapshot, vaultId))
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  AncCustodyRecordBuffer *candidate =
      [[AncCustodyRecordBuffer alloc] initEmpty];
  if (candidate == nil)
    return AncPrivateVaultCustodyRepositoryStatusFailed;
  __block AncPrivateVaultCustodyRecordStatus encodedStatus =
      ANC_PV_CUSTODY_INVALID_RECORD;
  AncPrivateVaultCustodyRepositoryStatus borrowed =
      [candidate borrow:^BOOL(uint8_t *bytes) {
        encodedStatus = anc_pv_custody_record_encode(
            snapshot, secrets, bytes, ANC_PV_CUSTODY_RECORD_BYTES);
        return encodedStatus == ANC_PV_CUSTODY_OK;
      }];
  AncPrivateVaultCustodyRepositoryStatus result =
      borrowed == AncPrivateVaultCustodyRepositoryStatusOK &&
              encodedStatus == ANC_PV_CUSTODY_OK
          ? [self commitLockedCandidate:candidate
                                snapshot:snapshot
                                 vaultId:vaultId]
          : AncPrivateVaultCustodyRepositoryStatusInvalid;
  AncPrivateVaultCustodyRepositoryStatus closed = [candidate close];
  return closed == AncPrivateVaultCustodyRepositoryStatusOK ? result : closed;
}

- (AncPrivateVaultCustodyRepositoryStatus)
    commitLockedCandidate:(AncCustodyRecordBuffer *)candidate
                 snapshot:(const AncPrivateVaultCustodySnapshot *)snapshot
                  vaultId:(NSString *)vaultId {
  AncCustodyRecordBuffer *current = nil;
  AncPrivateVaultCustodySnapshot currentSnapshot;
  AncPrivateVaultCustodyRepositoryStatus reconciled =
      [self reconcileVaultId:vaultId
                  liveRecord:&current
                liveSnapshot:&currentSnapshot];
  if (reconciled != AncPrivateVaultCustodyRepositoryStatusOK &&
      reconciled != AncPrivateVaultCustodyRepositoryStatusNotFound)
    return reconciled;
  if (reconciled == AncPrivateVaultCustodyRepositoryStatusNotFound) {
    if (snapshot->custody_generation != 1 || AncLifecycleIsTombstone(snapshot))
      return AncPrivateVaultCustodyRepositoryStatusConflict;
  } else {
    if (snapshot->custody_generation == currentSnapshot.custody_generation) {
      BOOL equal = NO;
      AncPrivateVaultCustodyRepositoryStatus compared =
          [self recordsEqual:candidate right:current equal:&equal];
      AncPrivateVaultCustodyRepositoryStatus closed = [current close];
      if (compared != AncPrivateVaultCustodyRepositoryStatusOK)
        return compared;
      if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
        return closed;
      return equal ? AncPrivateVaultCustodyRepositoryStatusOK
                   : AncPrivateVaultCustodyRepositoryStatusConflict;
    }
    if (currentSnapshot.custody_generation == UINT64_MAX ||
        snapshot->custody_generation != currentSnapshot.custody_generation + 1) {
      AncPrivateVaultCustodyRepositoryStatus closed = [current close];
      if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
        return closed;
      return AncPrivateVaultCustodyRepositoryStatusConflict;
    }
    if (!AncTerminalTransitionAllowed(&currentSnapshot, snapshot)) {
      AncPrivateVaultCustodyRepositoryStatus closed = [current close];
      if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
        return closed;
      return AncPrivateVaultCustodyRepositoryStatusConflict;
    }
    AncPrivateVaultCustodyRepositoryStatus closed = [current close];
    if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
      return closed;
  }
  AncPrivateVaultCustodyRepositoryStatus revoked = AncRevokeHandles(vaultId);
  if (revoked != AncPrivateVaultCustodyRepositoryStatusOK)
    return revoked;
  AncPrivateVaultCustodyRepositoryStatus staged =
      [self writeExact:candidate
               service:AncPrivateVaultCustodyStageService
               vaultId:vaultId];
  if (staged != AncPrivateVaultCustodyRepositoryStatusOK)
    return staged;
  NSData *digest = AncCustodyDigest(candidate);
  if (digest == nil)
    return AncPrivateVaultCustodyRepositoryStatusFailed;
  return [self finishStage:candidate
                    digest:digest
                generation:snapshot->custody_generation
                   vaultId:vaultId];
}

- (AncPrivateVaultCustodyRepositoryStatus)
    advanceAuthorityAnchorVaultId:(NSString *)vaultId
               expectedGeneration:(uint64_t)expectedGeneration
           expectedSnapshotDigest:(NSData *)expectedSnapshotDigest
               nextPublicSnapshot:
                   (const AncPrivateVaultCustodySnapshot *)nextPublicSnapshot
                  epochTransition:
                      (AncPrivateVaultCustodyEpochTransition)epochTransition {
  if ([NSThread.currentThread.threadDictionary[kAncCustodyBorrowScopeThreadKey]
          boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  if (vaultId.length == 0 || expectedGeneration == 0 ||
      expectedSnapshotDigest.length != ANC_PV_HASH_BYTES ||
      nextPublicSnapshot == NULL ||
      (epochTransition !=
           AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch &&
       epochTransition !=
           AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch))
    return AncPrivateVaultCustodyRepositoryStatusInvalid;

  __block AncPrivateVaultCustodyRepositoryStatus status;
  dispatch_sync(self.queue, ^{
    AncCustodyRecordBuffer *live = nil;
    AncPrivateVaultCustodySnapshot current;
    status = [self reconcileVaultId:vaultId
                         liveRecord:&live
                       liveSnapshot:&current];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK)
      return;
    if (current.record_version != ANC_PV_CUSTODY_VERSION ||
        current.custody_generation != expectedGeneration ||
        !current.authority_anchor_present ||
        anc_pv_memcmp(current.snapshot_digest, expectedSnapshotDigest.bytes,
                      ANC_PV_HASH_BYTES) != ANC_PV_CRYPTO_OK ||
        nextPublicSnapshot->record_version != ANC_PV_CUSTODY_VERSION ||
        nextPublicSnapshot->custody_generation != expectedGeneration + 1 ||
        !nextPublicSnapshot->authority_anchor_present ||
        !AncSnapshotMatchesVaultId(nextPublicSnapshot, vaultId)) {
      AncPrivateVaultCustodyRepositoryStatus closed = [live close];
      status = closed == AncPrivateVaultCustodyRepositoryStatusOK
                   ? AncPrivateVaultCustodyRepositoryStatusConflict
                   : closed;
      return;
    }

    AncPrivateVaultCustodyHandle *internalHandle = nil;
    AncPrivateVaultCustodySnapshot decoded;
    status = AncDecodeRecord(live, &decoded, &internalHandle);
    AncPrivateVaultCustodyRepositoryStatus liveClosed = [live close];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK ||
        liveClosed != AncPrivateVaultCustodyRepositoryStatusOK) {
      if (liveClosed != AncPrivateVaultCustodyRepositoryStatusOK)
        status = liveClosed;
      return;
    }
    AncCustodyRecordBuffer *candidate =
        [[AncCustodyRecordBuffer alloc] initEmpty];
    if (candidate == nil) {
      status = [internalHandle close];
      if (status == AncPrivateVaultCustodyRepositoryStatusOK)
        status = AncPrivateVaultCustodyRepositoryStatusFailed;
      return;
    }
    __block BOOL encoded = NO;
    status = [candidate borrow:^BOOL(uint8_t *nextRecord) {
      AncPrivateVaultCustodyRepositoryStatus secretBorrow = [internalHandle
          borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *currentSecrets) {
            uint8_t zeroKey[ANC_PV_KEY_BYTES] = {0};
            AncPrivateVaultCustodySecretInputs nextSecrets = *currentSecrets;
            if (epochTransition ==
                AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch) {
              if (nextPublicSnapshot->active_epoch != current.active_epoch ||
                  nextPublicSnapshot->pending_epoch != current.pending_epoch)
                return NO;
            } else {
              if (current.pending_epoch == 0 ||
                  nextPublicSnapshot->active_epoch != current.pending_epoch ||
                  nextPublicSnapshot->pending_epoch != 0)
                return NO;
              nextSecrets.active_epoch_key = currentSecrets->pending_epoch_key;
              nextSecrets.pending_epoch_key = zeroKey;
            }
            encoded = anc_pv_custody_record_encode(
                          nextPublicSnapshot, &nextSecrets, nextRecord,
                          ANC_PV_CUSTODY_RECORD_BYTES) == ANC_PV_CUSTODY_OK;
            anc_pv_zeroize(zeroKey, sizeof zeroKey);
            return encoded;
          }];
      return secretBorrow == AncPrivateVaultCustodyRepositoryStatusOK && encoded;
    }];
    AncPrivateVaultCustodyRepositoryStatus closed = [internalHandle close];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK || !encoded ||
        closed != AncPrivateVaultCustodyRepositoryStatusOK) {
      AncPrivateVaultCustodyRepositoryStatus candidateClosed = [candidate close];
      status = closed != AncPrivateVaultCustodyRepositoryStatusOK
                   ? closed
               : candidateClosed != AncPrivateVaultCustodyRepositoryStatusOK
                   ? candidateClosed
                   : AncPrivateVaultCustodyRepositoryStatusInvalid;
      return;
    }
    status = [self commitLockedCandidate:candidate
                                snapshot:nextPublicSnapshot
                                 vaultId:vaultId];
    AncPrivateVaultCustodyRepositoryStatus candidateClosed = [candidate close];
    if (candidateClosed != AncPrivateVaultCustodyRepositoryStatusOK)
      status = candidateClosed;
  });
  return status;
}

- (AncPrivateVaultCustodyRepositoryStatus)
    migrateLegacyCodecVaultId:(NSString *)vaultId
           expectedGeneration:(uint64_t)expectedGeneration {
  if (vaultId.length == 0 || expectedGeneration == 0)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  __block AncPrivateVaultCustodyRepositoryStatus status;
  dispatch_sync(self.queue, ^{
    AncCustodyRecordBuffer *live = nil;
    AncPrivateVaultCustodySnapshot current;
    status = [self reconcileVaultId:vaultId
                         liveRecord:&live
                       liveSnapshot:&current];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK)
      return;
    if (current.record_version != ANC_PV_CUSTODY_LEGACY_VERSION ||
        current.custody_generation != expectedGeneration) {
      AncPrivateVaultCustodyRepositoryStatus closed = [live close];
      status = closed == AncPrivateVaultCustodyRepositoryStatusOK
                   ? AncPrivateVaultCustodyRepositoryStatusConflict
                   : closed;
      return;
    }
    const BOOL terminal = AncLifecycleIsTombstone(&current);
    const BOOL unanchoredPending =
        current.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
        !current.authority_anchor_present &&
        (current.pending_kind == ANC_PV_CUSTODY_PENDING_GENESIS ||
         current.enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_OFFER_PENDING);
    if (!terminal && !unanchoredPending) {
      AncPrivateVaultCustodyRepositoryStatus closed = [live close];
      status = closed == AncPrivateVaultCustodyRepositoryStatusOK
                   ? AncPrivateVaultCustodyRepositoryStatusConflict
                   : closed;
      return;
    }
    AncPrivateVaultCustodySnapshot next = current;
    next.record_version = ANC_PV_CUSTODY_VERSION;
    next.custody_generation += 1;
    if (current.pending_kind == ANC_PV_CUSTODY_PENDING_GENESIS) {
      next.expected_edge_present = 1;
      next.expected_next_sequence = 0;
      memset(next.expected_previous_head, 0, ANC_PV_HASH_BYTES);
    } else {
      next.expected_edge_present = 0;
      next.expected_next_sequence = 0;
      memset(next.expected_previous_head, 0, ANC_PV_HASH_BYTES);
      memset(next.pending_transcript_digest, 0, ANC_PV_HASH_BYTES);
    }
    AncCustodyRecordBuffer *candidate =
        [[AncCustodyRecordBuffer alloc] initEmpty];
    if (candidate == nil) {
      AncPrivateVaultCustodyRepositoryStatus closed = [live close];
      status = AncPrivateVaultCustodyRepositoryStatusFailed;
      if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
        status = closed;
      return;
    }
    __block BOOL encoded = NO;
    status = [candidate borrow:^BOOL(uint8_t *record) {
      if (terminal) {
        AncGuardedCustodySecrets zero = {0};
        AncPrivateVaultCustodySecretInputs secrets = {
            .signing_seed = zero.signingSeed,
            .box_seed = zero.boxSeed,
            .local_state_key = zero.localStateKey,
            .active_epoch_key = zero.activeEpochKey,
            .pending_epoch_key = zero.pendingEpochKey,
        };
        encoded = anc_pv_custody_record_encode(
                      &next, &secrets, record,
                      ANC_PV_CUSTODY_RECORD_BYTES) == ANC_PV_CUSTODY_OK;
        anc_pv_zeroize(&zero, sizeof zero);
        return encoded;
      }
      AncPrivateVaultCustodyHandle *handle = nil;
      AncPrivateVaultCustodySnapshot decoded;
      AncPrivateVaultCustodyRepositoryStatus decodedStatus =
          AncDecodeRecord(live, &decoded, &handle);
      if (decodedStatus != AncPrivateVaultCustodyRepositoryStatusOK)
        return NO;
      AncPrivateVaultCustodyRepositoryStatus secretBorrow = [handle
          borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
            encoded = anc_pv_custody_record_encode(
                          &next, secrets, record,
                          ANC_PV_CUSTODY_RECORD_BYTES) == ANC_PV_CUSTODY_OK;
            return encoded;
          }];
      AncPrivateVaultCustodyRepositoryStatus handleClosed = [handle close];
      return secretBorrow == AncPrivateVaultCustodyRepositoryStatusOK &&
             handleClosed == AncPrivateVaultCustodyRepositoryStatusOK &&
             encoded;
    }];
    AncPrivateVaultCustodyRepositoryStatus liveClosed = [live close];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK || !encoded) {
      AncPrivateVaultCustodyRepositoryStatus candidateClosed = [candidate close];
      if (liveClosed != AncPrivateVaultCustodyRepositoryStatusOK)
        status = liveClosed;
      else if (candidateClosed != AncPrivateVaultCustodyRepositoryStatusOK)
        status = candidateClosed;
      if (status == AncPrivateVaultCustodyRepositoryStatusOK)
        status = AncPrivateVaultCustodyRepositoryStatusInvalid;
      return;
    }
    if (liveClosed != AncPrivateVaultCustodyRepositoryStatusOK) {
      status = liveClosed;
      AncPrivateVaultCustodyRepositoryStatus candidateClosed = [candidate close];
      if (candidateClosed != AncPrivateVaultCustodyRepositoryStatusOK)
        status = candidateClosed;
      return;
    }
    status = [self commitLockedCandidate:candidate
                                snapshot:&next
                                 vaultId:vaultId];
    AncPrivateVaultCustodyRepositoryStatus candidateClosed = [candidate close];
    if (candidateClosed != AncPrivateVaultCustodyRepositoryStatusOK)
      status = candidateClosed;
  });
  return status;
}

- (AncPrivateVaultCustodyRepositoryStatus)
    storeSnapshot:(const AncPrivateVaultCustodySnapshot *)snapshot
          secrets:(const AncPrivateVaultCustodySecretInputs *)secrets
          vaultId:(NSString *)vaultId {
  if ([NSThread.currentThread.threadDictionary[kAncCustodyBorrowScopeThreadKey]
          boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  if (snapshot == NULL || secrets == NULL || vaultId.length == 0)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  __block AncPrivateVaultCustodyRepositoryStatus status;
  dispatch_sync(self.queue, ^{
    status = [self storeLockedSnapshot:snapshot
                               secrets:secrets
                               vaultId:vaultId];
  });
  return status;
}

- (AncPrivateVaultCustodyRepositoryStatus)
    readVaultId:(NSString *)vaultId
       snapshot:(AncPrivateVaultCustodySnapshot *)snapshot
         handle:(AncPrivateVaultCustodyHandle **)handle {
  if ([NSThread.currentThread.threadDictionary[kAncCustodyBorrowScopeThreadKey]
          boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  if (vaultId.length == 0 || snapshot == NULL || handle == NULL)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  anc_pv_custody_snapshot_zero(snapshot);
  *handle = nil;
  __block AncPrivateVaultCustodyRepositoryStatus status;
  __block AncPrivateVaultCustodySnapshot resultSnapshot;
  __block AncPrivateVaultCustodyHandle *resultHandle = nil;
  dispatch_sync(self.queue, ^{
    AncCustodyRecordBuffer *live = nil;
    AncPrivateVaultCustodySnapshot value;
    status = [self reconcileVaultId:vaultId
                         liveRecord:&live
                       liveSnapshot:&value];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK)
      return;
    AncPrivateVaultCustodyHandle *custodyHandle = nil;
    AncPrivateVaultCustodySnapshot decoded;
    status = AncDecodeRecord(live, &decoded, &custodyHandle);
    AncPrivateVaultCustodyRepositoryStatus liveClosed = [live close];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK ||
        liveClosed != AncPrivateVaultCustodyRepositoryStatusOK) {
      if (liveClosed != AncPrivateVaultCustodyRepositoryStatusOK)
        status = liveClosed;
      return;
    }
    if (decoded.custody_generation != value.custody_generation) {
      status = [custodyHandle close];
      if (status == AncPrivateVaultCustodyRepositoryStatusOK)
        status = AncPrivateVaultCustodyRepositoryStatusRollbackDetected;
      return;
    }
    resultSnapshot = decoded;
    if (AncLifecycleIsTombstone(&decoded)) {
      status = [custodyHandle close];
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
