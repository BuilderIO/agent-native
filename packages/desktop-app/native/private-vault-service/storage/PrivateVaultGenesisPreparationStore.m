#import "PrivateVaultGenesisPreparationStore.h"

NSString *const AncPrivateVaultGenesisPreparationRecordId =
    @"genesis-preparation";

static const char kAncGenesisPreparationDigestDomain[] =
    "anc/v1/private-vault/genesis-preparation-record/fence";
static char kAncGenesisPreparationQueueKey;

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultGenesisPreparationStoreFaultHook
    gAncGenesisPreparationFaultHook;
static AncPrivateVaultGenesisPreparationRecordLifecycleHook
    gAncGenesisPreparationLifecycleHook;

void AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(
    AncPrivateVaultGenesisPreparationStoreFaultHook hook) {
  gAncGenesisPreparationFaultHook = [hook copy];
}

void AncPrivateVaultGenesisPreparationSetRecordLifecycleHookForTesting(
    AncPrivateVaultGenesisPreparationRecordLifecycleHook hook) {
  gAncGenesisPreparationLifecycleHook = [hook copy];
}
#endif

static BOOL AncGenesisFault(
    AncPrivateVaultGenesisPreparationStoreFaultPoint point) {
#if ANC_PRIVATE_VAULT_TESTING
  return gAncGenesisPreparationFaultHook != nil &&
         gAncGenesisPreparationFaultHook(point);
#else
  (void)point;
  return NO;
#endif
}

@interface AncPrivateVaultGenesisGuardedRecord : NSObject
@property(nonatomic, strong, readonly) AncPrivateVaultGuardedMemory *memory;
- (instancetype)initEmpty;
- (AncPrivateVaultGuardedMemoryStatus)
    borrow:(AncPrivateVaultGuardedMemoryBorrowBlock)block;
- (BOOL)isEqualToRecord:(AncPrivateVaultGenesisGuardedRecord *)other;
- (AncPrivateVaultGuardedMemoryStatus)close;
@end

@implementation AncPrivateVaultGenesisGuardedRecord {
  BOOL _closeNotified;
  BOOL _allocationNotified;
}

- (instancetype)initEmpty {
  self = [super init];
  if (self == nil)
    return nil;
  AncPrivateVaultGuardedMemoryStatus status;
  _memory = [AncPrivateVaultGuardedMemory
      memoryWithLength:ANC_PV_GENESIS_PREPARATION_RECORD_BYTES
                status:&status];
  if (_memory == nil || status != AncPrivateVaultGuardedMemoryStatusOK)
    return nil;
#if ANC_PRIVATE_VAULT_TESTING
  if (gAncGenesisPreparationLifecycleHook != nil) {
    _allocationNotified = YES;
    gAncGenesisPreparationLifecycleHook(YES, NO);
  }
#endif
  return self;
}

- (AncPrivateVaultGuardedMemoryStatus)
    borrow:(AncPrivateVaultGuardedMemoryBorrowBlock)block {
  return block == nil ? AncPrivateVaultGuardedMemoryStatusInvalid
                      : [self.memory borrow:block];
}

- (BOOL)isEqualToRecord:(AncPrivateVaultGenesisGuardedRecord *)other {
  if (other == nil || other == self)
    return other == self;
  __block BOOL equal = NO;
  AncPrivateVaultGuardedMemoryStatus first =
      [self borrow:^BOOL(uint8_t *firstBytes, size_t firstLength) {
        AncPrivateVaultGuardedMemoryStatus second =
            [other borrow:^BOOL(uint8_t *secondBytes, size_t secondLength) {
              equal = firstLength == secondLength &&
                      firstLength == ANC_PV_GENESIS_PREPARATION_RECORD_BYTES &&
                      anc_pv_memcmp(firstBytes, secondBytes, firstLength) ==
                          ANC_PV_CRYPTO_OK;
              return YES;
            }];
        return second == AncPrivateVaultGuardedMemoryStatusOK;
      }];
  return first == AncPrivateVaultGuardedMemoryStatusOK && equal;
}

- (AncPrivateVaultGuardedMemoryStatus)close {
  if (_closeNotified)
    return AncPrivateVaultGuardedMemoryStatusClosed;
  AncPrivateVaultGuardedMemoryStatus status =
      self.memory == nil ? AncPrivateVaultGuardedMemoryStatusClosed
                         : [self.memory close];
  _closeNotified = YES;
#if ANC_PRIVATE_VAULT_TESTING
  if (_allocationNotified && gAncGenesisPreparationLifecycleHook != nil)
    gAncGenesisPreparationLifecycleHook(
        NO, status == AncPrivateVaultGuardedMemoryStatusOK);
#endif
  return status;
}

- (void)dealloc {
  [self close];
}
@end

@interface AncPrivateVaultGenesisPreparationSecretsHandle ()
@property(nonatomic, strong, readonly) AncPrivateVaultGuardedMemory *memory;
- (instancetype)initEmpty;
@end

@implementation AncPrivateVaultGenesisPreparationSecretsHandle

- (instancetype)initEmpty {
  self = [super init];
  if (self == nil)
    return nil;
  AncPrivateVaultGuardedMemoryStatus status;
  _memory = [AncPrivateVaultGuardedMemory memoryWithLength:160 status:&status];
  return _memory != nil && status == AncPrivateVaultGuardedMemoryStatusOK
             ? self
             : nil;
}

- (BOOL)isClosed {
  return self.memory == nil || self.memory.closed;
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    borrow:(AncPrivateVaultGenesisPreparationSecretsBorrowBlock)block {
  if (block == nil || self.closed)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  __block BOOL accepted = NO;
  AncPrivateVaultGuardedMemoryStatus status =
      [self.memory borrow:^BOOL(uint8_t *bytes, size_t length) {
        if (length != 160)
          return NO;
        AncPrivateVaultGenesisPreparationSecretInputs secrets = {
            bytes, bytes + 32, bytes + 64, bytes + 96, bytes + 128};
        accepted = block(&secrets);
        return accepted;
      }];
  if (status == AncPrivateVaultGuardedMemoryStatusOK && accepted)
    return AncPrivateVaultGenesisPreparationStoreStatusOK;
  return status == AncPrivateVaultGuardedMemoryStatusClosed
             ? AncPrivateVaultGenesisPreparationStoreStatusInvalid
             : AncPrivateVaultGenesisPreparationStoreStatusFailed;
}

- (AncPrivateVaultGenesisPreparationStoreStatus)close {
  if (self.memory == nil || self.memory.closed)
    return AncPrivateVaultGenesisPreparationStoreStatusOK;
  return [self.memory close] == AncPrivateVaultGuardedMemoryStatusOK
             ? AncPrivateVaultGenesisPreparationStoreStatusOK
             : AncPrivateVaultGenesisPreparationStoreStatusFailed;
}

- (void)dealloc {
  [self close];
}
@end

@interface AncPrivateVaultGenesisPreparationStore ()
@property(nonatomic, strong) AncPrivateVaultKeychain *keychain;
@property(nonatomic, strong) AncPrivateVaultGenerationFence *fence;
@property(nonatomic, strong)
    AncPrivateVaultGenesisPreparationArtifactStore *artifactStore;
@property(nonatomic, strong) dispatch_queue_t queue;
@end

static dispatch_queue_t AncGenesisQueue(void) {
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create(
        "com.agentnative.private-vault.genesis-preparation-store",
        DISPATCH_QUEUE_SERIAL);
    dispatch_queue_set_specific(queue, &kAncGenesisPreparationQueueKey,
                                &kAncGenesisPreparationQueueKey, NULL);
  });
  return queue;
}

static NSString *AncGenesisLookupKey(const uint8_t *lookupId) {
  if (lookupId == NULL)
    return nil;
  static const char hex[] = "0123456789abcdef";
  char value[33];
  for (size_t index = 0; index < 16; index++) {
    value[index * 2] = hex[lookupId[index] >> 4];
    value[index * 2 + 1] = hex[lookupId[index] & 15];
  }
  value[32] = 0;
  return [NSString stringWithUTF8String:value];
}

static AncPrivateVaultGenesisPreparationStoreStatus AncGenesisKeychainStatus(
    AncPrivateVaultKeychainStatus status) {
  switch (status) {
  case AncPrivateVaultKeychainStatusOK:
    return AncPrivateVaultGenesisPreparationStoreStatusOK;
  case AncPrivateVaultKeychainStatusNotFound:
    return AncPrivateVaultGenesisPreparationStoreStatusNotFound;
  case AncPrivateVaultKeychainStatusInvalid:
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  case AncPrivateVaultKeychainStatusDuplicate:
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  case AncPrivateVaultKeychainStatusCorrupt:
    return AncPrivateVaultGenesisPreparationStoreStatusCorrupt;
  case AncPrivateVaultKeychainStatusInaccessible:
    return AncPrivateVaultGenesisPreparationStoreStatusInaccessible;
  case AncPrivateVaultKeychainStatusFailed:
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  }
}

static AncPrivateVaultGenesisPreparationStoreStatus AncGenesisFenceStatus(
    AncPrivateVaultFenceStatus status) {
  switch (status) {
  case AncPrivateVaultFenceStatusOK:
    return AncPrivateVaultGenesisPreparationStoreStatusOK;
  case AncPrivateVaultFenceStatusInvalid:
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  case AncPrivateVaultFenceStatusConflict:
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  case AncPrivateVaultFenceStatusRollbackDetected:
    return AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected;
  case AncPrivateVaultFenceStatusCorrupt:
    return AncPrivateVaultGenesisPreparationStoreStatusCorrupt;
  case AncPrivateVaultFenceStatusInaccessible:
    return AncPrivateVaultGenesisPreparationStoreStatusInaccessible;
  case AncPrivateVaultFenceStatusFailed:
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  }
}

static AncPrivateVaultGenesisPreparationStoreStatus AncGenesisArtifactStatus(
    AncPrivateVaultGenesisPreparationArtifactStatus status) {
  switch (status) {
  case AncPrivateVaultGenesisPreparationArtifactStatusOK:
    return AncPrivateVaultGenesisPreparationStoreStatusOK;
  case AncPrivateVaultGenesisPreparationArtifactStatusNotFound:
    return AncPrivateVaultGenesisPreparationStoreStatusNotFound;
  case AncPrivateVaultGenesisPreparationArtifactStatusInvalid:
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  case AncPrivateVaultGenesisPreparationArtifactStatusConflict:
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  case AncPrivateVaultGenesisPreparationArtifactStatusCorrupt:
  case AncPrivateVaultGenesisPreparationArtifactStatusBindingMismatch:
    return AncPrivateVaultGenesisPreparationStoreStatusCorrupt;
  case AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed:
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  }
}

static NSData *AncGenesisDigest(AncPrivateVaultGenesisGuardedRecord *record) {
  uint8_t digest[32] = {0};
  uint8_t *digestBytes = digest;
  __block BOOL hashed = NO;
  AncPrivateVaultGuardedMemoryStatus status =
      [record borrow:^BOOL(uint8_t *bytes, size_t length) {
        hashed = length == ANC_PV_GENESIS_PREPARATION_RECORD_BYTES &&
                 anc_pv_blake2b_256_two_part(
                     digestBytes,
                     (const uint8_t *)kAncGenesisPreparationDigestDomain,
                     sizeof kAncGenesisPreparationDigestDomain, bytes, length) ==
                     ANC_PV_CRYPTO_OK;
        return YES;
      }];
  if (status != AncPrivateVaultGuardedMemoryStatusOK || !hashed) {
    anc_pv_zeroize(digest, sizeof digest);
    return nil;
  }
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static AncPrivateVaultGenesisPreparationStoreStatus AncGenesisDecode(
    AncPrivateVaultGenesisGuardedRecord *record,
    AncPrivateVaultGenesisPreparationSnapshot *snapshot,
    AncPrivateVaultGenesisPreparationSecretsHandle **secretHandle) {
  if (record == nil || snapshot == NULL || secretHandle == NULL)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  *secretHandle = nil;
  anc_pv_genesis_preparation_snapshot_zero(snapshot);
  AncPrivateVaultGenesisPreparationSecretsHandle *secrets =
      [[AncPrivateVaultGenesisPreparationSecretsHandle alloc] initEmpty];
  if (secrets == nil)
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  __block AncPrivateVaultGenesisPreparationRecordStatus decoded =
      ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  AncPrivateVaultGuardedMemoryStatus recordStatus =
      [record borrow:^BOOL(uint8_t *recordBytes, size_t recordLength) {
        AncPrivateVaultGuardedMemoryStatus secretStatus =
            [secrets.memory borrow:^BOOL(uint8_t *secretBytes,
                                         size_t secretLength) {
              if (secretLength != 160)
                return NO;
              AncPrivateVaultGenesisPreparationSecretOutputs outputs = {
                  secretBytes, secretBytes + 32, secretBytes + 64,
                  secretBytes + 96, secretBytes + 128};
              decoded = anc_pv_genesis_preparation_record_decode(
                  recordBytes, recordLength, snapshot, &outputs);
              return YES;
            }];
        return secretStatus == AncPrivateVaultGuardedMemoryStatusOK;
      }];
  if (recordStatus != AncPrivateVaultGuardedMemoryStatusOK ||
      decoded != ANC_PV_GENESIS_PREPARATION_OK) {
    AncPrivateVaultGenesisPreparationStoreStatus closeStatus = [secrets close];
    anc_pv_genesis_preparation_snapshot_zero(snapshot);
    if (closeStatus != AncPrivateVaultGenesisPreparationStoreStatusOK)
      return closeStatus;
    return decoded == ANC_PV_GENESIS_PREPARATION_CRYPTO_CHECKSUM ||
                   decoded >= ANC_PV_GENESIS_PREPARATION_WIRE_LENGTH
               ? AncPrivateVaultGenesisPreparationStoreStatusCorrupt
               : AncPrivateVaultGenesisPreparationStoreStatusFailed;
  }
  *secretHandle = secrets;
  return AncPrivateVaultGenesisPreparationStoreStatusOK;
}

static BOOL AncGenesisTransitionValid(
    AncPrivateVaultGenesisGuardedRecord *current,
    AncPrivateVaultGenesisGuardedRecord *candidate) {
  __block AncPrivateVaultGenesisPreparationRecordStatus result =
      ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  AncPrivateVaultGuardedMemoryStatus first =
      [current borrow:^BOOL(uint8_t *currentBytes, size_t currentLength) {
        AncPrivateVaultGuardedMemoryStatus second =
            [candidate borrow:^BOOL(uint8_t *nextBytes, size_t nextLength) {
              result = anc_pv_genesis_preparation_transition_validate(
                  currentBytes, currentLength, nextBytes, nextLength);
              return YES;
            }];
        return second == AncPrivateVaultGuardedMemoryStatusOK;
      }];
  return first == AncPrivateVaultGuardedMemoryStatusOK &&
         result == ANC_PV_GENESIS_PREPARATION_OK;
}

static AncPrivateVaultGenesisGuardedRecord *AncGenesisEncode(
    const AncPrivateVaultGenesisPreparationSnapshot *snapshot,
    const AncPrivateVaultGenesisPreparationSecretInputs *secrets,
    AncPrivateVaultGenesisPreparationStoreStatus *outStatus) {
  if (outStatus != NULL)
    *outStatus = AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  if (snapshot == NULL || secrets == NULL || outStatus == NULL)
    return nil;
  AncPrivateVaultGenesisGuardedRecord *record =
      [[AncPrivateVaultGenesisGuardedRecord alloc] initEmpty];
  if (record == nil) {
    *outStatus = AncPrivateVaultGenesisPreparationStoreStatusFailed;
    return nil;
  }
  __block AncPrivateVaultGenesisPreparationRecordStatus encoded =
      ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  AncPrivateVaultGuardedMemoryStatus status =
      [record borrow:^BOOL(uint8_t *bytes, size_t length) {
        encoded = anc_pv_genesis_preparation_record_encode(snapshot, secrets,
                                                            bytes, length);
        return YES;
      }];
  if (status != AncPrivateVaultGuardedMemoryStatusOK ||
      encoded != ANC_PV_GENESIS_PREPARATION_OK) {
    AncPrivateVaultGuardedMemoryStatus closeStatus = [record close];
    *outStatus = closeStatus == AncPrivateVaultGuardedMemoryStatusOK &&
                         encoded != ANC_PV_GENESIS_PREPARATION_OK
                     ? AncPrivateVaultGenesisPreparationStoreStatusInvalid
                     : AncPrivateVaultGenesisPreparationStoreStatusFailed;
    return nil;
  }
  *outStatus = AncPrivateVaultGenesisPreparationStoreStatusOK;
  return record;
}

static AncPrivateVaultGenesisPreparationStoreStatus AncGenesisCloseObjects(
    AncPrivateVaultGenesisGuardedRecord *record,
    AncPrivateVaultGenesisPreparationSecretsHandle *secrets,
    AncPrivateVaultGenesisPreparationStoreStatus status) {
  AncPrivateVaultGenesisPreparationStoreStatus secretStatus =
      secrets == nil ? AncPrivateVaultGenesisPreparationStoreStatusOK
                     : [secrets close];
  AncPrivateVaultGuardedMemoryStatus recordStatus =
      record == nil ? AncPrivateVaultGuardedMemoryStatusOK : [record close];
  return secretStatus == AncPrivateVaultGenesisPreparationStoreStatusOK &&
                 recordStatus == AncPrivateVaultGuardedMemoryStatusOK
             ? status
             : AncPrivateVaultGenesisPreparationStoreStatusFailed;
}

@implementation AncPrivateVaultGenesisPreparationStore

- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain
                            fence:(AncPrivateVaultGenerationFence *)fence
                    artifactStore:(AncPrivateVaultGenesisPreparationArtifactStore *)artifactStore {
  self = [super init];
  if (self == nil || keychain == nil || fence == nil || artifactStore == nil)
    return nil;
  _keychain = keychain;
  _fence = fence;
  _artifactStore = artifactStore;
  _queue = AncGenesisQueue();
  return self;
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    readService:(NSString *)service
      lookupKey:(NSString *)lookupKey
          record:(AncPrivateVaultGenesisGuardedRecord **)outRecord {
  *outRecord = nil;
  AncPrivateVaultGenesisGuardedRecord *record =
      [[AncPrivateVaultGenesisGuardedRecord alloc] initEmpty];
  if (record == nil)
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  __block BOOL copied = NO;
  AncPrivateVaultKeychainStatus status =
      [self.keychain consumeGenesisPreparationRecordForService:service
                                                       vaultId:lookupKey
                                                      recordId:AncPrivateVaultGenesisPreparationRecordId
                                                      consumer:^BOOL(const uint8_t *bytes) {
        AncPrivateVaultGuardedMemoryStatus guarded =
            [record borrow:^BOOL(uint8_t *destination, size_t length) {
              if (length != ANC_PV_GENESIS_PREPARATION_RECORD_BYTES)
                return NO;
              memcpy(destination, bytes, length);
              copied = YES;
              return YES;
            }];
        return guarded == AncPrivateVaultGuardedMemoryStatusOK;
      }];
  if (status != AncPrivateVaultKeychainStatusOK || !copied) {
    AncPrivateVaultGuardedMemoryStatus closed = [record close];
    if (closed != AncPrivateVaultGuardedMemoryStatusOK)
      return AncPrivateVaultGenesisPreparationStoreStatusFailed;
    return status == AncPrivateVaultKeychainStatusOK
               ? AncPrivateVaultGenesisPreparationStoreStatusCorrupt
               : AncGenesisKeychainStatus(status);
  }
  *outRecord = record;
  return AncPrivateVaultGenesisPreparationStoreStatusOK;
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    writeExact:(AncPrivateVaultGenesisGuardedRecord *)record
        service:(NSString *)service
      lookupKey:(NSString *)lookupKey
            add:(BOOL)add {
  __block AncPrivateVaultKeychainStatus status =
      AncPrivateVaultKeychainStatusFailed;
  AncPrivateVaultGuardedMemoryStatus guarded =
      [record borrow:^BOOL(uint8_t *bytes, size_t length) {
        status = add ? [self.keychain addGenesisPreparationRecord:bytes
                                                           length:length
                                                       forService:service
                                                          vaultId:lookupKey
                                                         recordId:AncPrivateVaultGenesisPreparationRecordId]
                     : [self.keychain updateGenesisPreparationRecord:bytes
                                                              length:length
                                                          forService:service
                                                             vaultId:lookupKey
                                                            recordId:AncPrivateVaultGenesisPreparationRecordId];
        return YES;
      }];
  return guarded == AncPrivateVaultGuardedMemoryStatusOK
             ? AncGenesisKeychainStatus(status)
             : AncPrivateVaultGenesisPreparationStoreStatusFailed;
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    deleteStageLookupKey:(NSString *)lookupKey {
  AncPrivateVaultKeychainStatus status =
      [self.keychain deleteGenesisPreparationStageVaultId:lookupKey
                                                  recordId:AncPrivateVaultGenesisPreparationRecordId];
  return status == AncPrivateVaultKeychainStatusOK ||
                 status == AncPrivateVaultKeychainStatusNotFound
             ? AncPrivateVaultGenesisPreparationStoreStatusOK
             : AncGenesisKeychainStatus(status);
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    finishStage:(AncPrivateVaultGenesisGuardedRecord *)stage
          digest:(NSData *)digest
      generation:(uint64_t)generation
       lookupKey:(NSString *)lookupKey {
  if (AncGenesisFault(
          AncPrivateVaultGenesisPreparationStoreFaultBeforeFenceBegin))
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  AncPrivateVaultFenceStatus begun =
      [self.fence beginGeneration:generation
                     recordDigest:digest
                          vaultId:lookupKey
                         recordId:AncPrivateVaultGenesisPreparationRecordId];
  if (begun != AncPrivateVaultFenceStatusOK)
    return AncGenesisFenceStatus(begun);
  if (AncGenesisFault(
          AncPrivateVaultGenesisPreparationStoreFaultAfterFenceBegin))
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;

  AncPrivateVaultGenesisGuardedRecord *live = nil;
  AncPrivateVaultGenesisPreparationStoreStatus liveStatus =
      [self readService:AncPrivateVaultGenesisPreparationService
              lookupKey:lookupKey
                  record:&live];
  AncPrivateVaultGenesisPreparationStoreStatus writeStatus;
  if (liveStatus == AncPrivateVaultGenesisPreparationStoreStatusNotFound) {
    writeStatus = [self writeExact:stage
                           service:AncPrivateVaultGenesisPreparationService
                         lookupKey:lookupKey
                               add:YES];
  } else if (liveStatus == AncPrivateVaultGenesisPreparationStoreStatusOK &&
             [live isEqualToRecord:stage]) {
    writeStatus = AncPrivateVaultGenesisPreparationStoreStatusOK;
  } else if (liveStatus == AncPrivateVaultGenesisPreparationStoreStatusOK &&
             AncGenesisTransitionValid(live, stage)) {
    writeStatus = [self writeExact:stage
                           service:AncPrivateVaultGenesisPreparationService
                         lookupKey:lookupKey
                               add:NO];
  } else {
    writeStatus = liveStatus == AncPrivateVaultGenesisPreparationStoreStatusOK
                      ? AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected
                      : liveStatus;
  }
  if (live != nil &&
      [live close] != AncPrivateVaultGuardedMemoryStatusOK)
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  if (writeStatus != AncPrivateVaultGenesisPreparationStoreStatusOK)
    return writeStatus;
  if (AncGenesisFault(
          AncPrivateVaultGenesisPreparationStoreFaultAfterLiveWrite))
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;

  AncPrivateVaultFenceStatus committed =
      [self.fence commitGeneration:generation
                      recordDigest:digest
                           vaultId:lookupKey
                          recordId:AncPrivateVaultGenesisPreparationRecordId];
  if (committed != AncPrivateVaultFenceStatusOK)
    return AncGenesisFenceStatus(committed);
  if (AncGenesisFault(
          AncPrivateVaultGenesisPreparationStoreFaultAfterFenceCommit))
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;

  AncPrivateVaultFenceSnapshot *fenceSnapshot = nil;
  AncPrivateVaultFenceStatus fenceRead =
      [self.fence readVaultId:lookupKey
                     recordId:AncPrivateVaultGenesisPreparationRecordId
                     snapshot:&fenceSnapshot];
  AncPrivateVaultGenesisGuardedRecord *observed = nil;
  AncPrivateVaultGenesisPreparationStoreStatus observedStatus =
      [self readService:AncPrivateVaultGenesisPreparationService
              lookupKey:lookupKey
                  record:&observed];
  NSData *observedDigest = observed == nil ? nil : AncGenesisDigest(observed);
  BOOL durable = fenceRead == AncPrivateVaultFenceStatusOK &&
                 fenceSnapshot.state == AncPrivateVaultFenceStateStable &&
                 fenceSnapshot.generation == generation &&
                 [fenceSnapshot.recordDigest isEqualToData:digest] &&
                 observedStatus == AncPrivateVaultGenesisPreparationStoreStatusOK &&
                 [observedDigest isEqualToData:digest] &&
                 [observed isEqualToRecord:stage];
  if (observed != nil &&
      [observed close] != AncPrivateVaultGuardedMemoryStatusOK)
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  if (!durable)
    return AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected;
  if (AncGenesisFault(
          AncPrivateVaultGenesisPreparationStoreFaultBeforeStageDelete))
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  return [self deleteStageLookupKey:lookupKey];
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    commitCandidate:(AncPrivateVaultGenesisGuardedRecord *)candidate
          lookupKey:(NSString *)lookupKey
        allowCreate:(BOOL)allowCreate {
  AncPrivateVaultGenesisGuardedRecord *stage = nil;
  AncPrivateVaultGenesisPreparationStoreStatus stageStatus =
      [self readService:AncPrivateVaultGenesisPreparationStageService
              lookupKey:lookupKey
                  record:&stage];
  if (stageStatus == AncPrivateVaultGenesisPreparationStoreStatusOK) {
    if (![stage isEqualToRecord:candidate]) {
      return AncGenesisCloseObjects(
          stage, nil, AncPrivateVaultGenesisPreparationStoreStatusConflict);
    }
    if ([stage close] != AncPrivateVaultGuardedMemoryStatusOK)
      return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  } else if (stageStatus == AncPrivateVaultGenesisPreparationStoreStatusNotFound) {
    AncPrivateVaultGenesisPreparationStoreStatus written =
        [self writeExact:candidate
                 service:AncPrivateVaultGenesisPreparationStageService
               lookupKey:lookupKey
                     add:YES];
    if (written != AncPrivateVaultGenesisPreparationStoreStatusOK &&
        written != AncPrivateVaultGenesisPreparationStoreStatusConflict)
      return written;
    if (written == AncPrivateVaultGenesisPreparationStoreStatusConflict) {
      AncPrivateVaultGenesisGuardedRecord *racedStage = nil;
      AncPrivateVaultGenesisPreparationStoreStatus reread =
          [self readService:AncPrivateVaultGenesisPreparationStageService
                  lookupKey:lookupKey
                      record:&racedStage];
      BOOL equal = reread == AncPrivateVaultGenesisPreparationStoreStatusOK &&
                   [racedStage isEqualToRecord:candidate];
      AncPrivateVaultGenesisPreparationStoreStatus closed =
          AncGenesisCloseObjects(racedStage, nil, reread);
      if (!equal ||
          closed != AncPrivateVaultGenesisPreparationStoreStatusOK)
        return equal ? closed
                     : AncPrivateVaultGenesisPreparationStoreStatusConflict;
    }
  } else {
    return stageStatus;
  }
  if (AncGenesisFault(
          AncPrivateVaultGenesisPreparationStoreFaultAfterStageWrite))
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;

  AncPrivateVaultGenesisPreparationSnapshot snapshot;
  AncPrivateVaultGenesisPreparationSecretsHandle *secretHandle = nil;
  AncPrivateVaultGenesisPreparationStoreStatus decoded =
      AncGenesisDecode(candidate, &snapshot, &secretHandle);
  if (decoded != AncPrivateVaultGenesisPreparationStoreStatusOK)
    return decoded;
  AncPrivateVaultGenesisGuardedRecord *live = nil;
  AncPrivateVaultGenesisPreparationStoreStatus liveStatus =
      [self readService:AncPrivateVaultGenesisPreparationService
              lookupKey:lookupKey
                  record:&live];
  BOOL valid = (allowCreate &&
                liveStatus == AncPrivateVaultGenesisPreparationStoreStatusNotFound &&
                snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED &&
                snapshot.generation == 1) ||
               (liveStatus == AncPrivateVaultGenesisPreparationStoreStatusOK &&
                ([live isEqualToRecord:candidate] ||
                 AncGenesisTransitionValid(live, candidate)));
  AncPrivateVaultGuardedMemoryStatus liveClose =
      live == nil ? AncPrivateVaultGuardedMemoryStatusOK : [live close];
  AncPrivateVaultGenesisPreparationStoreStatus secretClose =
      [secretHandle close];
  uint64_t generation = snapshot.generation;
  anc_pv_genesis_preparation_snapshot_zero(&snapshot);
  if (secretClose != AncPrivateVaultGenesisPreparationStoreStatusOK)
    return secretClose;
  if (liveClose != AncPrivateVaultGuardedMemoryStatusOK)
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  if (!valid)
    return liveStatus == AncPrivateVaultGenesisPreparationStoreStatusOK ||
                   liveStatus == AncPrivateVaultGenesisPreparationStoreStatusNotFound
               ? AncPrivateVaultGenesisPreparationStoreStatusConflict
               : liveStatus;
  NSData *digest = AncGenesisDigest(candidate);
  return digest == nil
             ? AncPrivateVaultGenesisPreparationStoreStatusFailed
             : [self finishStage:candidate
                           digest:digest
                       generation:generation
                        lookupKey:lookupKey];
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    reconcileLookupIdLocked:(const uint8_t *)lookupId
                      record:(AncPrivateVaultGenesisGuardedRecord **)outRecord
                    snapshot:(AncPrivateVaultGenesisPreparationSnapshot *)outSnapshot
               secretHandle:(AncPrivateVaultGenesisPreparationSecretsHandle **)outSecrets {
  *outRecord = nil;
  *outSecrets = nil;
  anc_pv_genesis_preparation_snapshot_zero(outSnapshot);
  NSString *lookupKey = AncGenesisLookupKey(lookupId);
  AncPrivateVaultGenesisGuardedRecord *live = nil;
  AncPrivateVaultGenesisGuardedRecord *stage = nil;
  AncPrivateVaultGenesisPreparationStoreStatus liveStatus =
      [self readService:AncPrivateVaultGenesisPreparationService
              lookupKey:lookupKey
                  record:&live];
  AncPrivateVaultGenesisPreparationStoreStatus stageStatus =
      [self readService:AncPrivateVaultGenesisPreparationStageService
              lookupKey:lookupKey
                  record:&stage];
  if ((liveStatus != AncPrivateVaultGenesisPreparationStoreStatusOK &&
       liveStatus != AncPrivateVaultGenesisPreparationStoreStatusNotFound) ||
      (stageStatus != AncPrivateVaultGenesisPreparationStoreStatusOK &&
       stageStatus != AncPrivateVaultGenesisPreparationStoreStatusNotFound)) {
    AncPrivateVaultGenesisPreparationStoreStatus result =
        liveStatus != AncPrivateVaultGenesisPreparationStoreStatusOK &&
                   liveStatus != AncPrivateVaultGenesisPreparationStoreStatusNotFound
               ? liveStatus
               : stageStatus;
    result = AncGenesisCloseObjects(live, nil, result);
    return AncGenesisCloseObjects(stage, nil, result);
  }

  AncPrivateVaultGenesisPreparationSnapshot liveSnapshot;
  AncPrivateVaultGenesisPreparationSnapshot stageSnapshot;
  AncPrivateVaultGenesisPreparationSecretsHandle *liveSecrets = nil;
  AncPrivateVaultGenesisPreparationSecretsHandle *stageSecrets = nil;
  if (live != nil) {
    AncPrivateVaultGenesisPreparationStoreStatus decoded =
        AncGenesisDecode(live, &liveSnapshot, &liveSecrets);
    if (decoded != AncPrivateVaultGenesisPreparationStoreStatusOK ||
        anc_pv_memcmp(liveSnapshot.preparation_lookup_id, lookupId, 16) !=
            ANC_PV_CRYPTO_OK) {
      AncPrivateVaultGenesisPreparationStoreStatus result =
          decoded == AncPrivateVaultGenesisPreparationStoreStatusOK
                 ? AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected
                 : decoded;
      result = AncGenesisCloseObjects(live, liveSecrets, result);
      return AncGenesisCloseObjects(stage, nil, result);
    }
  } else {
    anc_pv_genesis_preparation_snapshot_zero(&liveSnapshot);
  }
  if (stage != nil) {
    AncPrivateVaultGenesisPreparationStoreStatus decoded =
        AncGenesisDecode(stage, &stageSnapshot, &stageSecrets);
    if (decoded != AncPrivateVaultGenesisPreparationStoreStatusOK ||
        anc_pv_memcmp(stageSnapshot.preparation_lookup_id, lookupId, 16) !=
            ANC_PV_CRYPTO_OK) {
      AncPrivateVaultGenesisPreparationStoreStatus result =
          decoded == AncPrivateVaultGenesisPreparationStoreStatusOK
                 ? AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected
                 : decoded;
      result = AncGenesisCloseObjects(live, liveSecrets, result);
      return AncGenesisCloseObjects(stage, stageSecrets, result);
    }
  } else {
    anc_pv_genesis_preparation_snapshot_zero(&stageSnapshot);
  }

  NSData *liveDigest = live == nil ? nil : AncGenesisDigest(live);
  NSData *stageDigest = stage == nil ? nil : AncGenesisDigest(stage);
  AncPrivateVaultFenceSnapshot *fenceSnapshot = nil;
  AncPrivateVaultFenceStatus fenceStatus =
      [self.fence readVaultId:lookupKey
                     recordId:AncPrivateVaultGenesisPreparationRecordId
                     snapshot:&fenceSnapshot];
  if (fenceStatus != AncPrivateVaultFenceStatusOK) {
    AncPrivateVaultGenesisPreparationStoreStatus result =
        AncGenesisFenceStatus(fenceStatus);
    result = AncGenesisCloseObjects(live, liveSecrets, result);
    return AncGenesisCloseObjects(stage, stageSecrets, result);
  }

  BOOL stageTransition =
      stage != nil &&
      ((live == nil && stageSnapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED &&
        stageSnapshot.generation == 1) ||
       (live != nil && ([live isEqualToRecord:stage] ||
                        AncGenesisTransitionValid(live, stage))));
  if (fenceSnapshot.state == AncPrivateVaultFenceStateAbsent) {
    AncPrivateVaultGenesisPreparationStoreStatus closed =
        AncGenesisCloseObjects(live, liveSecrets,
                               AncPrivateVaultGenesisPreparationStoreStatusOK);
    closed = AncGenesisCloseObjects(nil, stageSecrets, closed);
    if (live != nil || stage == nil || !stageTransition) {
      AncPrivateVaultGenesisPreparationStoreStatus result =
          live == nil && stage == nil
                 ? AncPrivateVaultGenesisPreparationStoreStatusNotFound
                 : AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected;
      return AncGenesisCloseObjects(stage, nil,
                                    closed == AncPrivateVaultGenesisPreparationStoreStatusOK
                                        ? result
                                        : closed);
    }
    if (closed != AncPrivateVaultGenesisPreparationStoreStatusOK)
      return AncGenesisCloseObjects(stage, nil, closed);
    AncPrivateVaultGenesisPreparationStoreStatus finished =
        [self finishStage:stage
                   digest:stageDigest
               generation:stageSnapshot.generation
                lookupKey:lookupKey];
    finished = AncGenesisCloseObjects(stage, nil, finished);
    if (finished != AncPrivateVaultGenesisPreparationStoreStatusOK)
      return finished;
    return [self reconcileLookupIdLocked:lookupId
                                   record:outRecord
                                 snapshot:outSnapshot
                            secretHandle:outSecrets];
  }
  if (fenceSnapshot.state == AncPrivateVaultFenceStatePending) {
    AncPrivateVaultGenesisPreparationStoreStatus closed =
        AncGenesisCloseObjects(live, liveSecrets,
                               AncPrivateVaultGenesisPreparationStoreStatusOK);
    closed = AncGenesisCloseObjects(nil, stageSecrets, closed);
    if (stage == nil || !stageTransition ||
        ![stageDigest isEqualToData:fenceSnapshot.recordDigest] ||
        stageSnapshot.generation != fenceSnapshot.generation) {
      return AncGenesisCloseObjects(
          stage, nil,
          closed == AncPrivateVaultGenesisPreparationStoreStatusOK
              ? AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected
              : closed);
    }
    if (closed != AncPrivateVaultGenesisPreparationStoreStatusOK)
      return AncGenesisCloseObjects(stage, nil, closed);
    AncPrivateVaultGenesisPreparationStoreStatus finished =
        [self finishStage:stage
                   digest:stageDigest
               generation:fenceSnapshot.generation
                lookupKey:lookupKey];
    finished = AncGenesisCloseObjects(stage, nil, finished);
    if (finished != AncPrivateVaultGenesisPreparationStoreStatusOK)
      return finished;
    return [self reconcileLookupIdLocked:lookupId
                                   record:outRecord
                                 snapshot:outSnapshot
                            secretHandle:outSecrets];
  }
  if (live == nil || ![liveDigest isEqualToData:fenceSnapshot.recordDigest] ||
      liveSnapshot.generation != fenceSnapshot.generation) {
    AncPrivateVaultGenesisPreparationStoreStatus result =
        AncGenesisCloseObjects(
            live, liveSecrets,
            AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected);
    return AncGenesisCloseObjects(stage, stageSecrets, result);
  }
  if (stage != nil) {
    AncPrivateVaultGenesisPreparationStoreStatus closed =
        AncGenesisCloseObjects(live, liveSecrets,
                               AncPrivateVaultGenesisPreparationStoreStatusOK);
    closed = AncGenesisCloseObjects(nil, stageSecrets, closed);
    AncPrivateVaultGenesisPreparationStoreStatus resolved;
    if ([stageDigest isEqualToData:liveDigest]) {
      resolved = [self deleteStageLookupKey:lookupKey];
    } else if (stageTransition && fenceSnapshot.generation != UINT64_MAX &&
               stageSnapshot.generation == fenceSnapshot.generation + 1) {
      resolved = [self finishStage:stage
                            digest:stageDigest
                        generation:stageSnapshot.generation
                         lookupKey:lookupKey];
    } else {
      resolved = AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected;
    }
    resolved = AncGenesisCloseObjects(stage, nil, resolved);
    if (closed != AncPrivateVaultGenesisPreparationStoreStatusOK)
      return closed;
    if (resolved != AncPrivateVaultGenesisPreparationStoreStatusOK)
      return resolved;
    return [self reconcileLookupIdLocked:lookupId
                                   record:outRecord
                                 snapshot:outSnapshot
                            secretHandle:outSecrets];
  }

  if (liveSnapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED &&
      (liveSnapshot.flags & ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND) != 0 &&
      (liveSnapshot.flags & ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) == 0) {
    if (AncGenesisFault(
            AncPrivateVaultGenesisPreparationStoreFaultBeforeArtifactPromote)) {
      return AncGenesisCloseObjects(
          live, liveSecrets,
          AncPrivateVaultGenesisPreparationStoreStatusFailed);
    }
    AncPrivateVaultGenesisPreparationArtifactStatus artifact =
        [self.artifactStore reconcileLookupId:lookupId
                               expectedDigest:liveSnapshot.artifact_spool_digest];
    if (artifact != AncPrivateVaultGenesisPreparationArtifactStatusOK) {
      return AncGenesisCloseObjects(live, liveSecrets,
                                    AncGenesisArtifactStatus(artifact));
    }
    AncPrivateVaultGenesisPreparationSnapshot promoted = liveSnapshot;
    promoted.flags |= ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE;
    promoted.generation++;
    __block AncPrivateVaultGenesisGuardedRecord *candidate = nil;
    AncPrivateVaultGenesisPreparationStoreStatus borrowed =
        [liveSecrets borrow:^BOOL(
                         const AncPrivateVaultGenesisPreparationSecretInputs *secrets) {
          AncPrivateVaultGenesisPreparationStoreStatus encodeStatus;
          candidate = AncGenesisEncode(&promoted, secrets, &encodeStatus);
          return candidate != nil;
        }];
    AncPrivateVaultGenesisPreparationStoreStatus closeStatus =
        AncGenesisCloseObjects(live, liveSecrets,
                               AncPrivateVaultGenesisPreparationStoreStatusOK);
    if (borrowed != AncPrivateVaultGenesisPreparationStoreStatusOK ||
        closeStatus != AncPrivateVaultGenesisPreparationStoreStatusOK ||
        candidate == nil) {
      closeStatus = AncGenesisCloseObjects(candidate, nil, closeStatus);
      return closeStatus != AncPrivateVaultGenesisPreparationStoreStatusOK
                 ? closeStatus
                 : AncPrivateVaultGenesisPreparationStoreStatusFailed;
    }
    AncPrivateVaultGenesisPreparationStoreStatus committed =
        [self commitCandidate:candidate lookupKey:lookupKey allowCreate:NO];
    committed = AncGenesisCloseObjects(candidate, nil, committed);
    if (committed != AncPrivateVaultGenesisPreparationStoreStatusOK)
      return committed;
    return [self reconcileLookupIdLocked:lookupId
                                   record:outRecord
                                 snapshot:outSnapshot
                            secretHandle:outSecrets];
  }

  *outRecord = live;
  *outSnapshot = liveSnapshot;
  *outSecrets = liveSecrets;
  return AncPrivateVaultGenesisPreparationStoreStatusOK;
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    createSnapshot:(const AncPrivateVaultGenesisPreparationSnapshot *)snapshot
            secrets:(const AncPrivateVaultGenesisPreparationSecretInputs *)secrets
             handle:(const uint8_t *)handle
       handleLength:(size_t)handleLength {
  if (snapshot == NULL || secrets == NULL || handle == NULL ||
      handleLength != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES ||
      snapshot->phase != ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED ||
      snapshot->generation != 1 ||
      !anc_pv_genesis_preparation_handle_verify(
          handle, handleLength, snapshot->preparation_lookup_id,
          snapshot->handle_digest))
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  AncPrivateVaultGenesisPreparationStoreStatus encodeStatus;
  AncPrivateVaultGenesisGuardedRecord *candidate =
      AncGenesisEncode(snapshot, secrets, &encodeStatus);
  if (candidate == nil)
    return encodeStatus;
  AncPrivateVaultGenesisPreparationArtifactStatus marker =
      [self.artifactStore
          createPreparationIndexLookupId:handle
                             preparedAtMs:snapshot->prepared_at_ms
                              expiresAtMs:snapshot->expires_at_ms];
  if (marker != AncPrivateVaultGenesisPreparationArtifactStatusOK)
    return AncGenesisCloseObjects(candidate, nil,
                                  AncGenesisArtifactStatus(marker));
  if (AncGenesisFault(
          AncPrivateVaultGenesisPreparationStoreFaultAfterMarkerBeforeStageWrite)) {
    AncPrivateVaultGenesisPreparationStoreStatus cleanup =
        [self reconcileLookupId:handle length:16];
    AncPrivateVaultGenesisPreparationStoreStatus result =
        cleanup == AncPrivateVaultGenesisPreparationStoreStatusNotFound
            ? AncPrivateVaultGenesisPreparationStoreStatusFailed
            : cleanup;
    return AncGenesisCloseObjects(candidate, nil, result);
  }
  __block AncPrivateVaultGenesisPreparationStoreStatus status;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGenesisGuardedRecord *existingRecord = nil;
    AncPrivateVaultGenesisPreparationSnapshot existingSnapshot;
    AncPrivateVaultGenesisPreparationSecretsHandle *existingSecrets = nil;
    AncPrivateVaultGenesisPreparationStoreStatus existing =
        [self reconcileLookupIdLocked:handle
                                record:&existingRecord
                              snapshot:&existingSnapshot
                         secretHandle:&existingSecrets];
    BOOL exactExisting =
        existing == AncPrivateVaultGenesisPreparationStoreStatusOK &&
        [existingRecord isEqualToRecord:candidate];
    existing = AncGenesisCloseObjects(existingRecord, existingSecrets, existing);
    anc_pv_genesis_preparation_snapshot_zero(&existingSnapshot);
    if (existing == AncPrivateVaultGenesisPreparationStoreStatusOK)
      status = exactExisting
                   ? AncPrivateVaultGenesisPreparationStoreStatusOK
                   : AncPrivateVaultGenesisPreparationStoreStatusConflict;
    else if (existing == AncPrivateVaultGenesisPreparationStoreStatusNotFound)
      status = [self commitCandidate:candidate
                           lookupKey:AncGenesisLookupKey(handle)
                         allowCreate:YES];
    else
      status = existing;
    if (status != AncPrivateVaultGenesisPreparationStoreStatusOK) {
      const AncPrivateVaultGenesisPreparationStoreStatus originalStatus =
          status;
      AncPrivateVaultGenesisGuardedRecord *reconciledRecord = nil;
      AncPrivateVaultGenesisPreparationSnapshot reconciledSnapshot;
      AncPrivateVaultGenesisPreparationSecretsHandle *reconciledSecrets = nil;
      AncPrivateVaultGenesisPreparationStoreStatus reconciled =
          [self reconcileLookupIdLocked:handle
                                  record:&reconciledRecord
                                snapshot:&reconciledSnapshot
                           secretHandle:&reconciledSecrets];
      BOOL exact =
          reconciled == AncPrivateVaultGenesisPreparationStoreStatusOK &&
          [reconciledRecord isEqualToRecord:candidate];
      AncPrivateVaultGenesisPreparationStoreStatus beforeClose = reconciled;
      reconciled = AncGenesisCloseObjects(reconciledRecord, reconciledSecrets,
                                          reconciled);
      anc_pv_genesis_preparation_snapshot_zero(&reconciledSnapshot);
      if (reconciled == AncPrivateVaultGenesisPreparationStoreStatusFailed &&
          beforeClose != AncPrivateVaultGenesisPreparationStoreStatusFailed)
        status = AncPrivateVaultGenesisPreparationStoreStatusFailed;
      else if (reconciled != AncPrivateVaultGenesisPreparationStoreStatusOK)
        status = originalStatus;
      else
        status = exact ? AncPrivateVaultGenesisPreparationStoreStatusOK
                       : AncPrivateVaultGenesisPreparationStoreStatusConflict;
    }
  });
  AncPrivateVaultGuardedMemoryStatus candidateClose = [candidate close];
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK) {
    /* This second pass is cleanup only. It may retire a provable marker-only
     * orphan, but it can never turn a non-exact candidate into success. */
    (void)[self reconcileLookupId:handle length:16];
  }
  return candidateClose == AncPrivateVaultGuardedMemoryStatusOK
             ? status
             : AncPrivateVaultGenesisPreparationStoreStatusFailed;
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    readHandle:(const uint8_t *)handle
    handleLength:(size_t)handleLength
       snapshot:(AncPrivateVaultGenesisPreparationSnapshot *)snapshot
    secretHandle:(AncPrivateVaultGenesisPreparationSecretsHandle **)secretHandle {
  if (snapshot != NULL)
    anc_pv_genesis_preparation_snapshot_zero(snapshot);
  if (secretHandle != NULL)
    *secretHandle = nil;
  if (handle == NULL ||
      handleLength != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES || snapshot == NULL)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  __block AncPrivateVaultGenesisPreparationStoreStatus status;
  __block AncPrivateVaultGenesisPreparationSnapshot internalSnapshot;
  __block AncPrivateVaultGenesisPreparationSecretsHandle *internalSecrets = nil;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGenesisGuardedRecord *record = nil;
    status = [self reconcileLookupIdLocked:handle
                                    record:&record
                                  snapshot:&internalSnapshot
                             secretHandle:&internalSecrets];
    if (record != nil &&
        [record close] != AncPrivateVaultGuardedMemoryStatusOK)
      status = AncPrivateVaultGenesisPreparationStoreStatusFailed;
  });
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK ||
      !anc_pv_genesis_preparation_handle_verify(
          handle, handleLength, internalSnapshot.preparation_lookup_id,
          internalSnapshot.handle_digest)) {
    AncPrivateVaultGenesisPreparationStoreStatus closeStatus =
        [internalSecrets close];
    anc_pv_genesis_preparation_snapshot_zero(&internalSnapshot);
    if (closeStatus != AncPrivateVaultGenesisPreparationStoreStatusOK)
      return closeStatus;
    return status == AncPrivateVaultGenesisPreparationStoreStatusOK
               ? AncPrivateVaultGenesisPreparationStoreStatusNotFound
               : status;
  }
  *snapshot = internalSnapshot;
  anc_pv_genesis_preparation_snapshot_zero(&internalSnapshot);
  if (secretHandle != NULL)
    *secretHandle = internalSecrets;
  else if ([internalSecrets close] !=
           AncPrivateVaultGenesisPreparationStoreStatusOK) {
    anc_pv_genesis_preparation_snapshot_zero(snapshot);
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  }
  return AncPrivateVaultGenesisPreparationStoreStatusOK;
}

#if ANC_PRIVATE_VAULT_TESTING
- (AncPrivateVaultGenesisPreparationStoreStatus)
    transitionHandle:(const uint8_t *)handle
         handleLength:(size_t)handleLength
         nextSnapshot:(const AncPrivateVaultGenesisPreparationSnapshot *)snapshot
              secrets:(const AncPrivateVaultGenesisPreparationSecretInputs *)secrets {
  if (handle == NULL ||
      handleLength != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES ||
      snapshot == NULL || secrets == NULL ||
      !anc_pv_genesis_preparation_handle_verify(
          handle, handleLength, snapshot->preparation_lookup_id,
          snapshot->handle_digest))
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  AncPrivateVaultGenesisPreparationStoreStatus encodeStatus;
  AncPrivateVaultGenesisGuardedRecord *candidate =
      AncGenesisEncode(snapshot, secrets, &encodeStatus);
  if (candidate == nil)
    return encodeStatus;
  __block AncPrivateVaultGenesisPreparationStoreStatus status;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGenesisGuardedRecord *current = nil;
    AncPrivateVaultGenesisPreparationSnapshot currentSnapshot;
    AncPrivateVaultGenesisPreparationSecretsHandle *currentSecrets = nil;
    status = [self reconcileLookupIdLocked:handle
                                    record:&current
                                  snapshot:&currentSnapshot
                             secretHandle:&currentSecrets];
    if (status == AncPrivateVaultGenesisPreparationStoreStatusOK &&
        (!anc_pv_genesis_preparation_handle_verify(
             handle, handleLength, currentSnapshot.preparation_lookup_id,
             currentSnapshot.handle_digest) ||
         !AncGenesisTransitionValid(current, candidate)))
      status = AncPrivateVaultGenesisPreparationStoreStatusConflict;
    AncPrivateVaultGenesisPreparationStoreStatus secretClose =
        [currentSecrets close];
    AncPrivateVaultGuardedMemoryStatus recordClose = [current close];
    anc_pv_genesis_preparation_snapshot_zero(&currentSnapshot);
    if (secretClose != AncPrivateVaultGenesisPreparationStoreStatusOK ||
        (current != nil && recordClose != AncPrivateVaultGuardedMemoryStatusOK))
      status = AncPrivateVaultGenesisPreparationStoreStatusFailed;
    if (status == AncPrivateVaultGenesisPreparationStoreStatusOK)
      status = [self commitCandidate:candidate
                           lookupKey:AncGenesisLookupKey(handle)
                         allowCreate:NO];
  });
  if ([candidate close] != AncPrivateVaultGuardedMemoryStatusOK)
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  return status;
}
#endif

- (AncPrivateVaultGenesisPreparationStoreStatus)
    reconcileHandle:(const uint8_t *)handle handleLength:(size_t)handleLength {
  if (handle == NULL ||
      handleLength != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  AncPrivateVaultGenesisPreparationSnapshot snapshot;
  AncPrivateVaultGenesisPreparationStoreStatus status =
      [self readHandle:handle
          handleLength:handleLength
             snapshot:&snapshot
          secretHandle:nil];
  anc_pv_genesis_preparation_snapshot_zero(&snapshot);
  return status;
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    reconcileLookupId:(const uint8_t *)lookupId length:(size_t)length {
  if (lookupId == NULL ||
      length != ANC_PV_GENESIS_PREPARATION_LOOKUP_ID_BYTES)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  __block AncPrivateVaultGenesisPreparationStoreStatus status;
  __block BOOL retireMarker = NO;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGenesisGuardedRecord *record = nil;
    AncPrivateVaultGenesisPreparationSnapshot snapshot;
    AncPrivateVaultGenesisPreparationSecretsHandle *secrets = nil;
    status = [self reconcileLookupIdLocked:lookupId
                                    record:&record
                                  snapshot:&snapshot
                             secretHandle:&secrets];
    retireMarker =
        status == AncPrivateVaultGenesisPreparationStoreStatusOK &&
        (snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED ||
         snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED ||
         snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED) &&
        (snapshot.flags & ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED) !=
            0;
    AncPrivateVaultGenesisPreparationStoreStatus secretClose = [secrets close];
    AncPrivateVaultGuardedMemoryStatus recordClose = [record close];
    anc_pv_genesis_preparation_snapshot_zero(&snapshot);
    if (secretClose != AncPrivateVaultGenesisPreparationStoreStatusOK ||
        (record != nil && recordClose != AncPrivateVaultGuardedMemoryStatusOK))
      status = AncPrivateVaultGenesisPreparationStoreStatusFailed;
  });
  if (status == AncPrivateVaultGenesisPreparationStoreStatusNotFound) {
    AncPrivateVaultGenesisPreparationArtifactStatus deleted =
        [self.artifactStore deletePreparationIndexLookupId:lookupId];
    if (deleted != AncPrivateVaultGenesisPreparationArtifactStatusOK &&
        deleted != AncPrivateVaultGenesisPreparationArtifactStatusNotFound)
      return AncGenesisArtifactStatus(deleted);
  }
  if (status == AncPrivateVaultGenesisPreparationStoreStatusOK &&
      retireMarker) {
    AncPrivateVaultGenesisPreparationArtifactStatus deleted =
        [self.artifactStore deletePreparationIndexLookupId:lookupId];
    if (deleted != AncPrivateVaultGenesisPreparationArtifactStatusOK &&
        deleted != AncPrivateVaultGenesisPreparationArtifactStatusNotFound)
      return AncGenesisArtifactStatus(deleted);
  }
  return status;
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    listPreparationLookupIds:(NSArray<NSData *> **)lookupIds {
  if (lookupIds != NULL)
    *lookupIds = nil;
  if (lookupIds == NULL)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  return AncGenesisArtifactStatus(
      [self.artifactStore listPreparationLookupIds:lookupIds]);
}

@end
