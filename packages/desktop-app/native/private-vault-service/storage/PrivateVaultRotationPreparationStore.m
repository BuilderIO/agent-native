#import "PrivateVaultRotationPreparationStore.h"
#import "PrivateVaultRotationPreparationStoreInternal.h"

#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultControlLogInternal.h"
#import "PrivateVaultCustodyRepository.h"
#import "PrivateVaultRecoveryWrapInternal.h"
#import "PrivateVaultAncCanonical.h"

#import <sodium.h>
#import <objc/runtime.h>

#include <stddef.h>
#include <string.h>

NSString *const AncPrivateVaultRotationPreparationRecordId =
    @"rotation-preparation";

static NSString *const kAncRotationCleanupReceiptRecordId =
    @"rotation-cleanup-receipt";
static const NSUInteger kAncRotationCleanupReceiptMaxBytes = 1024;
static const uint64_t kAncRotationMaxSafeInteger =
    UINT64_C(9007199254740991);

@interface AncPrivateVaultRotationAppendReceipt ()
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) NSString *entryId;
@property(nonatomic, readwrite) uint64_t sequence;
@property(nonatomic, readwrite) NSData *headHash;
@property(nonatomic, readwrite) NSData *recoveryWrapHash;
@property(nonatomic, readwrite) uint64_t recoveryWrapByteLength;
@end

@implementation AncPrivateVaultRotationAppendReceipt
@end

static BOOL AncRotationReceiptOpaqueId(NSString *value) {
  NSData *bytes = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (bytes.length < 8 || bytes.length > 160)
    return NO;
  const uint8_t *raw = bytes.bytes;
  for (NSUInteger index = 0; index < bytes.length; index += 1) {
    uint8_t byte = raw[index];
    BOOL alphaNumeric = (byte >= 'A' && byte <= 'Z') ||
                        (byte >= 'a' && byte <= 'z') ||
                        (byte >= '0' && byte <= '9');
    if (!alphaNumeric &&
        (index == 0 ||
         (byte != '.' && byte != '_' && byte != ':' && byte != '-')))
      return NO;
  }
  return YES;
}

AncPrivateVaultRotationAppendReceipt *
AncPrivateVaultRotationAppendReceiptDecode(NSData *encoded) {
  if (![encoded isKindOfClass:NSData.class] || encoded.length == 0 ||
      encoded.length > kAncRotationCleanupReceiptMaxBytes)
    return nil;
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      encoded, kAncRotationCleanupReceiptMaxBytes, &status);
  if (root == nil || root.type != AncPrivateVaultCanonicalTypeMap)
    return nil;
  NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map =
      root.mapValue;
  if (map.count != 9)
    return nil;
  for (NSUInteger key = 1; key <= 9; key += 1)
    if (map[@(key)] == nil)
      return nil;
  AncPrivateVaultCanonicalValue *suite = map[@1];
  AncPrivateVaultCanonicalValue *version = map[@2];
  AncPrivateVaultCanonicalValue *type = map[@3];
  AncPrivateVaultCanonicalValue *vault = map[@4];
  AncPrivateVaultCanonicalValue *entry = map[@5];
  AncPrivateVaultCanonicalValue *sequence = map[@6];
  AncPrivateVaultCanonicalValue *head = map[@7];
  AncPrivateVaultCanonicalValue *wrapHash = map[@8];
  AncPrivateVaultCanonicalValue *wrapLength = map[@9];
  if (suite.type != AncPrivateVaultCanonicalTypeText ||
      ![suite.textValue isEqualToString:@"anc/v1"] ||
      version.type != AncPrivateVaultCanonicalTypeInteger ||
      version.integerValue != 1 ||
      type.type != AncPrivateVaultCanonicalTypeText ||
      ![type.textValue
          isEqualToString:@"control-log-rotation-append-receipt"] ||
      vault.type != AncPrivateVaultCanonicalTypeText ||
      entry.type != AncPrivateVaultCanonicalTypeText ||
      !AncRotationReceiptOpaqueId(vault.textValue) ||
      !AncRotationReceiptOpaqueId(entry.textValue) ||
      sequence.type != AncPrivateVaultCanonicalTypeInteger ||
      sequence.integerValue < 0 ||
      (uint64_t)sequence.integerValue > kAncRotationMaxSafeInteger ||
      head.type != AncPrivateVaultCanonicalTypeBytes ||
      head.bytesValue.length != ANC_PV_HASH_BYTES ||
      wrapHash.type != AncPrivateVaultCanonicalTypeBytes ||
      wrapHash.bytesValue.length != ANC_PV_HASH_BYTES ||
      wrapLength.type != AncPrivateVaultCanonicalTypeInteger ||
      wrapLength.integerValue <= 0 ||
      wrapLength.integerValue > ANC_PV_ROTATION_RECOVERY_WRAP_MAX_BYTES)
    return nil;
  NSData *roundTrip = AncPrivateVaultCanonicalEncode(root, &status);
  if (roundTrip == nil || ![roundTrip isEqualToData:encoded])
    return nil;
  AncPrivateVaultRotationAppendReceipt *receipt =
      [[AncPrivateVaultRotationAppendReceipt alloc] init];
  receipt.vaultId = [vault.textValue copy];
  receipt.entryId = [entry.textValue copy];
  receipt.sequence = (uint64_t)sequence.integerValue;
  receipt.headHash = [head.bytesValue copy];
  receipt.recoveryWrapHash = [wrapHash.bytesValue copy];
  receipt.recoveryWrapByteLength = (uint64_t)wrapLength.integerValue;
  return receipt;
}

static NSString *const kAncRotationPreparationBorrowScopeThreadKey =
    @"com.agentnative.private-vault.rotation-preparation.borrow-scope";
static const char kAncRotationPreparationFenceDigestDomain[] =
    "anc/v1/private-vault/rotation-preparation-record/fence";
static char kAncRotationPreparationStoreQueueKey;

@interface AncPrivateVaultRotationPreparationKeyHandle ()
@property(nonatomic, strong, readonly) AncPrivateVaultGuardedMemory *memory;
@property(nonatomic, copy) NSString *registryKey;
@property(nonatomic) uint64_t fenceGeneration;
- (instancetype)initEmpty;
@end

@interface AncPrivateVaultRotationPreparationCheckpoint ()
- (instancetype)
    initWithFenceGeneration:(uint64_t)fenceGeneration
               recordDigest:(NSData *)recordDigest
                   snapshot:(const AncPrivateVaultRotationPreparationSnapshot *)
                                snapshot;
@end

@interface AncPrivateVaultGuardedRecord : NSObject {
  BOOL _closeNotified;
}
@property(nonatomic, strong, readonly) AncPrivateVaultGuardedMemory *memory;
- (instancetype)initEmpty;
- (AncPrivateVaultGuardedMemoryStatus)borrow:(BOOL (^)(uint8_t *bytes,
                                                       size_t length))block;
- (BOOL)isEqualToRecord:(AncPrivateVaultGuardedRecord *)other;
- (AncPrivateVaultGuardedMemoryStatus)close;
@end

@interface AncPrivateVaultRotationPreparationStore ()
@property(nonatomic, strong) AncPrivateVaultKeychain *keychain;
@property(nonatomic, strong) AncPrivateVaultGenerationFence *fence;
@property(nonatomic, strong)
    AncPrivateVaultRotationPreparationSpoolStore *spool;
@property(nonatomic, strong) dispatch_queue_t queue;
@end

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultRotationPreparationBeforeCommitTestHook
    gAncRotationPreparationBeforeCommitHook;
static AncPrivateVaultRotationPreparationRecordClearTestHook
    gAncRotationPreparationRecordClearHook;
static AncPrivateVaultRotationPreparationRecordLifecycleTestHook
    gAncRotationPreparationRecordLifecycleHook;
static AncPrivateVaultRotationPreparationStoreFaultTestHook
    gAncRotationPreparationStoreFaultHook;

void AncPrivateVaultRotationPreparationSetStoreFaultHookForTesting(
    AncPrivateVaultRotationPreparationStoreFaultTestHook hook) {
  gAncRotationPreparationStoreFaultHook = [hook copy];
}

void AncPrivateVaultRotationPreparationSetBeforeCommitHookForTesting(
    AncPrivateVaultRotationPreparationBeforeCommitTestHook hook) {
  gAncRotationPreparationBeforeCommitHook = [hook copy];
}

void AncPrivateVaultRotationPreparationSetRecordClearHookForTesting(
    AncPrivateVaultRotationPreparationRecordClearTestHook hook) {
  gAncRotationPreparationRecordClearHook = [hook copy];
}

void AncPrivateVaultRotationPreparationSetRecordLifecycleHookForTesting(
    AncPrivateVaultRotationPreparationRecordLifecycleTestHook hook) {
  gAncRotationPreparationRecordLifecycleHook = [hook copy];
}
#endif

static BOOL AncRotationPreparationFault(
    AncPrivateVaultRotationPreparationStoreFaultPoint point) {
#if ANC_PRIVATE_VAULT_TESTING
  return gAncRotationPreparationStoreFaultHook != nil &&
         gAncRotationPreparationStoreFaultHook(point);
#else
  (void)point;
  return NO;
#endif
}

static dispatch_queue_t AncRotationPreparationStoreQueue(void);
static BOOL AncOnRotationPreparationStoreQueue(void);
static NSMutableDictionary<NSString *, NSNumber *> *
AncRotationPreparationCurrentGenerations(void);

static BOOL AncRotationPreparationInBorrowScope(void) {
  return [NSThread.currentThread
              .threadDictionary[kAncRotationPreparationBorrowScopeThreadKey]
      boolValue];
}

@implementation AncPrivateVaultGuardedRecord

- (instancetype)initEmpty {
  self = [super init];
  if (self == nil)
    return nil;
  AncPrivateVaultGuardedMemoryStatus status;
  _memory = [AncPrivateVaultGuardedMemory
      memoryWithLength:ANC_PV_ROTATION_PREPARATION_RECORD_BYTES
                status:&status];
  if (_memory == nil || status != AncPrivateVaultGuardedMemoryStatusOK)
    return nil;
#if ANC_PRIVATE_VAULT_TESTING
  if (gAncRotationPreparationRecordLifecycleHook != nil)
    gAncRotationPreparationRecordLifecycleHook(YES, NO);
#endif
  return self;
}

- (AncPrivateVaultGuardedMemoryStatus)borrow:(BOOL (^)(uint8_t *bytes,
                                                       size_t length))block {
  return self.memory == nil || block == nil
             ? AncPrivateVaultGuardedMemoryStatusClosed
             : [self.memory borrow:block];
}

- (BOOL)isEqualToRecord:(AncPrivateVaultGuardedRecord *)other {
  if (other == nil || other == self)
    return other == self;
  __block BOOL equal = NO;
  AncPrivateVaultGuardedMemoryStatus first =
      [self borrow:^BOOL(uint8_t *firstBytes, size_t firstLength) {
        if (firstLength != ANC_PV_ROTATION_PREPARATION_RECORD_BYTES)
          return NO;
        AncPrivateVaultGuardedMemoryStatus second =
            [other borrow:^BOOL(uint8_t *secondBytes, size_t secondLength) {
              equal = secondLength == firstLength &&
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
  if (gAncRotationPreparationRecordClearHook != nil)
    gAncRotationPreparationRecordClearHook(
        status == AncPrivateVaultGuardedMemoryStatusOK);
  if (gAncRotationPreparationRecordLifecycleHook != nil)
    gAncRotationPreparationRecordLifecycleHook(
        NO, status == AncPrivateVaultGuardedMemoryStatusOK);
#endif
  return status;
}

- (void)dealloc {
  [self close];
}

@end

@implementation AncPrivateVaultRotationPreparationKeyHandle

- (instancetype)initEmpty {
  self = [super init];
  if (self == nil)
    return nil;
  AncPrivateVaultGuardedMemoryStatus status;
  _memory = [AncPrivateVaultGuardedMemory
      memoryWithLength:ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES
                status:&status];
  if (_memory == nil || status != AncPrivateVaultGuardedMemoryStatusOK)
    return nil;
  return self;
}

- (BOOL)isClosed {
  return self.memory == nil || self.memory.closed;
}

- (AncPrivateVaultRotationPreparationStoreStatus)borrow:
    (AncPrivateVaultRotationPreparationKeyBorrowBlock)block {
  NSMutableDictionary *thread = NSThread.currentThread.threadDictionary;
  if ([thread[kAncRotationPreparationBorrowScopeThreadKey] boolValue])
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  if (block == nil || self.memory == nil)
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  __block AncPrivateVaultGuardedMemoryStatus status =
      AncPrivateVaultGuardedMemoryStatusClosed;
  void (^borrowLocked)(void) = ^{
    NSNumber *current =
        AncRotationPreparationCurrentGenerations()[self.registryKey];
    if (self.registryKey.length == 0 || current == nil ||
        current.unsignedLongLongValue != self.fenceGeneration)
      return;
    status = [self.memory borrow:^BOOL(uint8_t *bytes, size_t length) {
      if (length != ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES)
        return NO;
      NSNumber *prior = thread[kAncRotationPreparationBorrowScopeThreadKey];
      thread[kAncRotationPreparationBorrowScopeThreadKey] = @YES;
      BOOL result = NO;
      @try {
        result = block(bytes);
      } @finally {
        if (prior == nil)
          [thread
              removeObjectForKey:kAncRotationPreparationBorrowScopeThreadKey];
        else
          thread[kAncRotationPreparationBorrowScopeThreadKey] = prior;
      }
      return result;
    }];
  };
  if (AncOnRotationPreparationStoreQueue())
    borrowLocked();
  else
    dispatch_sync(AncRotationPreparationStoreQueue(), borrowLocked);
  switch (status) {
  case AncPrivateVaultGuardedMemoryStatusOK:
    return AncPrivateVaultRotationPreparationStoreStatusOK;
  case AncPrivateVaultGuardedMemoryStatusClosed:
  case AncPrivateVaultGuardedMemoryStatusInvalid:
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  case AncPrivateVaultGuardedMemoryStatusAllocationFailed:
  case AncPrivateVaultGuardedMemoryStatusProtectionFailed:
  case AncPrivateVaultGuardedMemoryStatusCallbackFailed:
    return AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  }
}

- (AncPrivateVaultRotationPreparationStoreStatus)close {
  if ([NSThread.currentThread
              .threadDictionary[kAncRotationPreparationBorrowScopeThreadKey]
          boolValue])
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  __block AncPrivateVaultGuardedMemoryStatus status;
  if (AncOnRotationPreparationStoreQueue())
    status = [self.memory close];
  else
    dispatch_sync(AncRotationPreparationStoreQueue(), ^{
      status = [self.memory close];
    });
  return status == AncPrivateVaultGuardedMemoryStatusOK
             ? AncPrivateVaultRotationPreparationStoreStatusOK
             : AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
}

- (void)dealloc {
  [self close];
}

@end

@implementation AncPrivateVaultRotationPreparationCheckpoint

- (instancetype)
    initWithFenceGeneration:(uint64_t)fenceGeneration
               recordDigest:(NSData *)recordDigest
                   snapshot:(const AncPrivateVaultRotationPreparationSnapshot *)
                                snapshot {
  self = [super init];
  if (self == nil || fenceGeneration == 0 ||
      recordDigest.length != ANC_PV_HASH_BYTES || snapshot == NULL)
    return nil;
  _fenceGeneration = fenceGeneration;
  _recordDigest = [recordDigest copy];
  _snapshot = *snapshot;
  return self;
}

@end

static AncPrivateVaultRotationPreparationStoreStatus
AncRotationPreparationStatusForSpool(
    AncPrivateVaultRotationPreparationSpoolStatus status,
    BOOL missingIsRollback) {
  switch (status) {
  case AncPrivateVaultRotationPreparationSpoolStatusOK:
    return AncPrivateVaultRotationPreparationStoreStatusOK;
  case AncPrivateVaultRotationPreparationSpoolStatusNotFound:
    return missingIsRollback
               ? AncPrivateVaultRotationPreparationStoreStatusRollbackDetected
               : AncPrivateVaultRotationPreparationStoreStatusNotFound;
  case AncPrivateVaultRotationPreparationSpoolStatusInvalid:
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  case AncPrivateVaultRotationPreparationSpoolStatusStorageFailed:
    return AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  case AncPrivateVaultRotationPreparationSpoolStatusConflict:
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  case AncPrivateVaultRotationPreparationSpoolStatusCorrupt:
  case AncPrivateVaultRotationPreparationSpoolStatusBindingMismatch:
  case AncPrivateVaultRotationPreparationSpoolStatusAuthenticationFailed:
  case AncPrivateVaultRotationPreparationSpoolStatusWireMagic:
  case AncPrivateVaultRotationPreparationSpoolStatusWireVersion:
  case AncPrivateVaultRotationPreparationSpoolStatusWireFlags:
  case AncPrivateVaultRotationPreparationSpoolStatusWireReserved:
  case AncPrivateVaultRotationPreparationSpoolStatusRangeArtifactLength:
  case AncPrivateVaultRotationPreparationSpoolStatusBindingVault:
  case AncPrivateVaultRotationPreparationSpoolStatusBindingCeremony:
  case AncPrivateVaultRotationPreparationSpoolStatusBindingSignedHash:
  case AncPrivateVaultRotationPreparationSpoolStatusBindingRecoveryWrapHash:
  case AncPrivateVaultRotationPreparationSpoolStatusCryptoChecksum:
  case AncPrivateVaultRotationPreparationSpoolStatusWireTruncation:
  case AncPrivateVaultRotationPreparationSpoolStatusWireExtraBytes:
  case AncPrivateVaultRotationPreparationSpoolStatusBindingSubstitution:
  case AncPrivateVaultRotationPreparationSpoolStatusEncryptionMagic:
  case AncPrivateVaultRotationPreparationSpoolStatusEncryptionVersion:
  case AncPrivateVaultRotationPreparationSpoolStatusEncryptionFlags:
  case AncPrivateVaultRotationPreparationSpoolStatusEncryptionReserved:
  case AncPrivateVaultRotationPreparationSpoolStatusEncryptionLength:
  case AncPrivateVaultRotationPreparationSpoolStatusEncryptionBounds:
  case AncPrivateVaultRotationPreparationSpoolStatusEncryptionChecksum:
  case AncPrivateVaultRotationPreparationSpoolStatusEncryptionAEAD:
  case AncPrivateVaultRotationPreparationSpoolStatusRecordSpoolLength:
  case AncPrivateVaultRotationPreparationSpoolStatusRecordSpoolDigest:
    return AncPrivateVaultRotationPreparationStoreStatusCorrupt;
  }
  return AncPrivateVaultRotationPreparationStoreStatusCorrupt;
}

static dispatch_queue_t AncRotationPreparationStoreQueue(void) {
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create(
        "com.agentnative.private-vault.rotation-preparation-store",
        DISPATCH_QUEUE_SERIAL);
    dispatch_queue_set_specific(queue, &kAncRotationPreparationStoreQueueKey,
                                &kAncRotationPreparationStoreQueueKey, NULL);
  });
  return queue;
}

static BOOL AncOnRotationPreparationStoreQueue(void) {
  (void)AncRotationPreparationStoreQueue();
  return dispatch_get_specific(&kAncRotationPreparationStoreQueueKey) != NULL;
}

static NSMutableDictionary<NSString *, NSHashTable *> *
AncRotationPreparationHandleRegistry(void) {
  static NSMutableDictionary<NSString *, NSHashTable *> *registry;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    registry = [NSMutableDictionary dictionary];
  });
  return registry;
}

static NSMutableDictionary<NSString *, NSNumber *> *
AncRotationPreparationCurrentGenerations(void) {
  static NSMutableDictionary<NSString *, NSNumber *> *generations;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    generations = [NSMutableDictionary dictionary];
  });
  return generations;
}

static void AncRotationPreparationRegisterHandle(
    AncPrivateVaultRotationPreparationKeyHandle *handle, NSString *registryKey,
    uint64_t generation) {
  if (handle == nil)
    return;
  handle.registryKey = registryKey;
  handle.fenceGeneration = generation;
  NSHashTable *handles = AncRotationPreparationHandleRegistry()[registryKey];
  if (handles == nil) {
    handles = [NSHashTable weakObjectsHashTable];
    AncRotationPreparationHandleRegistry()[registryKey] = handles;
  }
  [handles addObject:handle];
  AncRotationPreparationCurrentGenerations()[registryKey] = @(generation);
}

static AncPrivateVaultRotationPreparationStoreStatus
AncRotationPreparationRevokeHandles(NSString *registryKey) {
  AncPrivateVaultRotationPreparationStoreStatus result =
      AncPrivateVaultRotationPreparationStoreStatusOK;
  NSHashTable *handles = AncRotationPreparationHandleRegistry()[registryKey];
  for (AncPrivateVaultRotationPreparationKeyHandle *handle in handles
           .allObjects) {
    AncPrivateVaultGuardedMemoryStatus status = [handle.memory close];
    if (status != AncPrivateVaultGuardedMemoryStatusOK)
      result = AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  }
  [AncRotationPreparationHandleRegistry() removeObjectForKey:registryKey];
  [AncRotationPreparationCurrentGenerations() removeObjectForKey:registryKey];
  return result;
}

static NSString *AncRotationPreparationVaultKey(const uint8_t vaultId[16]) {
  if (vaultId == NULL)
    return nil;
  static const char hex[] = "0123456789abcdef";
  char value[33];
  for (size_t i = 0; i < 16; i++) {
    value[i * 2] = hex[vaultId[i] >> 4];
    value[i * 2 + 1] = hex[vaultId[i] & 15];
  }
  value[32] = 0;
  return [NSString stringWithUTF8String:value];
}

static NSString *AncRotationPreparationRegistryKey(NSString *storageDomain,
                                                   NSString *vaultKey) {
  if (storageDomain.length == 0 || vaultKey.length == 0)
    return nil;
  return [NSString stringWithFormat:@"%@|%@", storageDomain, vaultKey];
}

static void
AncRotationPreparationClearRecord(AncPrivateVaultGuardedRecord *record) {
  if ([record isKindOfClass:AncPrivateVaultGuardedRecord.class])
    [(AncPrivateVaultGuardedRecord *)record close];
}

static void AncRotationPreparationClearKeychainRecord(
    AncPrivateVaultGuardedRecord *record) {
  AncRotationPreparationClearRecord(record);
}

static void AncRotationPreparationCleanupGuardedRecord(
    __strong AncPrivateVaultGuardedRecord **record) {
  AncRotationPreparationClearRecord(*record);
}

#define ANC_ROTATION_GUARDED_LOCAL                                             \
  __attribute__((cleanup(AncRotationPreparationCleanupGuardedRecord)))

static AncPrivateVaultRotationPreparationStoreStatus
AncRotationPreparationKeychainStatus(AncPrivateVaultKeychainStatus status) {
  switch (status) {
  case AncPrivateVaultKeychainStatusOK:
    return AncPrivateVaultRotationPreparationStoreStatusOK;
  case AncPrivateVaultKeychainStatusNotFound:
    return AncPrivateVaultRotationPreparationStoreStatusNotFound;
  case AncPrivateVaultKeychainStatusInvalid:
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  case AncPrivateVaultKeychainStatusDuplicate:
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  case AncPrivateVaultKeychainStatusCorrupt:
    return AncPrivateVaultRotationPreparationStoreStatusCorrupt;
  case AncPrivateVaultKeychainStatusInaccessible:
    return AncPrivateVaultRotationPreparationStoreStatusInaccessible;
  case AncPrivateVaultKeychainStatusFailed:
    return AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  }
}

static AncPrivateVaultRotationPreparationStoreStatus
AncRotationPreparationReadCleanupReceipt(AncPrivateVaultKeychain *keychain,
                                         NSString *vaultId,
                                         NSData **receipt) {
  if (receipt != NULL)
    *receipt = nil;
  NSData *stored = nil;
  AncPrivateVaultKeychainStatus status = [keychain
      copyDataForService:AncPrivateVaultRotationCleanupReceiptService
                 vaultId:vaultId
                recordId:kAncRotationCleanupReceiptRecordId
                    data:&stored];
  if (status != AncPrivateVaultKeychainStatusOK)
    return AncRotationPreparationKeychainStatus(status);
  if (AncPrivateVaultRotationAppendReceiptDecode(stored) == nil)
    return AncPrivateVaultRotationPreparationStoreStatusCorrupt;
  if (receipt != NULL)
    *receipt = stored;
  return AncPrivateVaultRotationPreparationStoreStatusOK;
}

static AncPrivateVaultRotationPreparationStoreStatus
AncRotationPreparationPersistCleanupReceipt(
    AncPrivateVaultKeychain *keychain, NSString *vaultId, NSData *receipt) {
  NSData *stored = nil;
  AncPrivateVaultRotationPreparationStoreStatus read =
      AncRotationPreparationReadCleanupReceipt(keychain, vaultId, &stored);
  if (read == AncPrivateVaultRotationPreparationStoreStatusOK &&
      [stored isEqualToData:receipt])
    return AncPrivateVaultRotationPreparationStoreStatusOK;
  AncPrivateVaultKeychainStatus write;
  if (read == AncPrivateVaultRotationPreparationStoreStatusNotFound) {
    write = [keychain addData:receipt
                   forService:AncPrivateVaultRotationCleanupReceiptService
                      vaultId:vaultId
                     recordId:kAncRotationCleanupReceiptRecordId];
  } else if (read == AncPrivateVaultRotationPreparationStoreStatusOK) {
    write = [keychain updateData:receipt
                      forService:AncPrivateVaultRotationCleanupReceiptService
                         vaultId:vaultId
                        recordId:kAncRotationCleanupReceiptRecordId];
  } else {
    return read;
  }
  if (write != AncPrivateVaultKeychainStatusOK)
    return AncRotationPreparationKeychainStatus(write);
  stored = nil;
  AncPrivateVaultRotationPreparationStoreStatus verified =
      AncRotationPreparationReadCleanupReceipt(keychain, vaultId, &stored);
  if (verified != AncPrivateVaultRotationPreparationStoreStatusOK)
    return verified;
  return [stored isEqualToData:receipt]
             ? AncPrivateVaultRotationPreparationStoreStatusOK
             : AncPrivateVaultRotationPreparationStoreStatusConflict;
}

static AncPrivateVaultRotationPreparationStoreStatus
AncRotationPreparationFenceStatus(AncPrivateVaultFenceStatus status) {
  switch (status) {
  case AncPrivateVaultFenceStatusOK:
    return AncPrivateVaultRotationPreparationStoreStatusOK;
  case AncPrivateVaultFenceStatusInvalid:
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  case AncPrivateVaultFenceStatusConflict:
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  case AncPrivateVaultFenceStatusRollbackDetected:
    return AncPrivateVaultRotationPreparationStoreStatusRollbackDetected;
  case AncPrivateVaultFenceStatusCorrupt:
    return AncPrivateVaultRotationPreparationStoreStatusCorrupt;
  case AncPrivateVaultFenceStatusInaccessible:
    return AncPrivateVaultRotationPreparationStoreStatusInaccessible;
  case AncPrivateVaultFenceStatusFailed:
    return AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  }
}

static NSData *
AncRotationPreparationDigest(AncPrivateVaultGuardedRecord *record) {
  if (record == nil)
    return nil;
  uint8_t digest[ANC_PV_HASH_BYTES] = {0};
  uint8_t *digestBytes = digest;
  __block BOOL hashed = NO;
  AncPrivateVaultGuardedMemoryStatus borrowed =
      [record borrow:^BOOL(uint8_t *bytes, size_t length) {
        crypto_generichash_state state;
        hashed = length == ANC_PV_ROTATION_PREPARATION_RECORD_BYTES &&
                 crypto_generichash_init(&state, NULL, 0, sizeof digest) == 0 &&
                 crypto_generichash_update(
                     &state,
                     (const uint8_t *)kAncRotationPreparationFenceDigestDomain,
                     sizeof kAncRotationPreparationFenceDigestDomain) == 0 &&
                 crypto_generichash_update(&state, bytes, length) == 0 &&
                 crypto_generichash_final(&state, digestBytes,
                                          ANC_PV_HASH_BYTES) == 0;
        sodium_memzero(&state, sizeof state);
        return hashed;
      }];
  if (borrowed != AncPrivateVaultGuardedMemoryStatusOK || !hashed) {
    anc_pv_zeroize(digest, sizeof digest);
    return nil;
  }
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static BOOL AncRotationPreparationSnapshotMatchesVault(
    const AncPrivateVaultRotationPreparationSnapshot *snapshot,
    const uint8_t vaultId[16]) {
  return snapshot != NULL && vaultId != NULL &&
         anc_pv_memcmp(snapshot->vault_id, vaultId, 16) == ANC_PV_CRYPTO_OK;
}

static AncPrivateVaultRotationPreparationStoreStatus
AncRotationPreparationDecode(
    AncPrivateVaultGuardedRecord *record,
    AncPrivateVaultRotationPreparationSnapshot *snapshot,
    AncPrivateVaultRotationPreparationKeyHandle **outHandle) {
  if (record == nil || snapshot == NULL || outHandle == NULL)
    return AncPrivateVaultRotationPreparationStoreStatusCorrupt;
  *outHandle = nil;
  anc_pv_rotation_preparation_snapshot_zero(snapshot);
  AncPrivateVaultRotationPreparationKeyHandle *handle =
      [[AncPrivateVaultRotationPreparationKeyHandle alloc] initEmpty];
  if (handle == nil)
    return AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  __block AncPrivateVaultRotationPreparationStatus decoded =
      ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT;
  AncPrivateVaultGuardedMemoryStatus guarded =
      [record borrow:^BOOL(uint8_t *recordBytes, size_t recordLength) {
        if (recordLength != ANC_PV_ROTATION_PREPARATION_RECORD_BYTES)
          return NO;
        return
            [handle.memory borrow:^BOOL(uint8_t *keyBytes, size_t keyLength) {
              if (keyLength != ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES)
                return NO;
              decoded = anc_pv_rotation_preparation_record_decode(
                  recordBytes, recordLength, snapshot, keyBytes);
              return decoded == ANC_PV_ROTATION_PREPARATION_OK;
            }] == AncPrivateVaultGuardedMemoryStatusOK;
      }];
  if (guarded != AncPrivateVaultGuardedMemoryStatusOK ||
      decoded != ANC_PV_ROTATION_PREPARATION_OK) {
    [handle close];
    anc_pv_rotation_preparation_snapshot_zero(snapshot);
    return decoded == ANC_PV_ROTATION_PREPARATION_RECORD_CRYPTO_CHECKSUM ||
                   decoded >= ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_MAGIC
               ? AncPrivateVaultRotationPreparationStoreStatusCorrupt
               : AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  }
  if (snapshot->phase >= ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED) {
    AncPrivateVaultRotationPreparationStoreStatus closed = [handle close];
    if (closed != AncPrivateVaultRotationPreparationStoreStatusOK)
      return closed;
  } else {
    *outHandle = handle;
  }
  return AncPrivateVaultRotationPreparationStoreStatusOK;
}

static AncPrivateVaultRotationPreparationStatus
AncRotationPreparationTransitionValidate(
    AncPrivateVaultGuardedRecord *current,
    AncPrivateVaultGuardedRecord *candidate) {
  if (current == nil || candidate == nil)
    return ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT;
  __block AncPrivateVaultRotationPreparationStatus result =
      ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT;
  AncPrivateVaultGuardedMemoryStatus currentBorrow =
      [current borrow:^BOOL(uint8_t *currentBytes, size_t currentLength) {
        AncPrivateVaultGuardedMemoryStatus candidateBorrow = [candidate
            borrow:^BOOL(uint8_t *candidateBytes, size_t candidateLength) {
              result = anc_pv_rotation_preparation_transition_validate(
                  currentBytes, currentLength, candidateBytes, candidateLength);
              return YES;
            }];
        return candidateBorrow == AncPrivateVaultGuardedMemoryStatusOK;
      }];
  return currentBorrow == AncPrivateVaultGuardedMemoryStatusOK
             ? result
             : ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT;
}

@implementation AncPrivateVaultRotationPreparationStore

- (instancetype)
    initWithKeychain:(AncPrivateVaultKeychain *)keychain
               spool:(AncPrivateVaultRotationPreparationSpoolStore *)spool {
  self = [super init];
  if (self == nil || keychain == nil || spool == nil)
    return nil;
  _keychain = keychain;
  _fence = [[AncPrivateVaultGenerationFence alloc] initWithKeychain:keychain];
  _spool = spool;
  _queue = AncRotationPreparationStoreQueue();
  return _fence == nil ? nil : self;
}

- (AncPrivateVaultRotationPreparationStoreStatus)
    readService:(NSString *)service
       vaultKey:(NSString *)vaultKey
           data:(AncPrivateVaultGuardedRecord **)data {
  if (data == NULL)
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  *data = nil;
  AncPrivateVaultGuardedRecord *owned =
      [[AncPrivateVaultGuardedRecord alloc] initEmpty];
  if (owned == nil)
    return AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  __block AncPrivateVaultKeychainStatus status =
      AncPrivateVaultKeychainStatusFailed;
  AncPrivateVaultGuardedMemoryStatus guarded =
      [owned borrow:^BOOL(uint8_t *destination, size_t destinationLength) {
        status = [self.keychain
            consumeBytesForService:service
                           vaultId:vaultKey
                          recordId:AncPrivateVaultRotationPreparationRecordId
                          consumer:^BOOL(const uint8_t *source,
                                         size_t sourceLength) {
                            if (sourceLength != destinationLength ||
                                destinationLength !=
                                    ANC_PV_ROTATION_PREPARATION_RECORD_BYTES)
                              return NO;
                            memcpy(destination, source, sourceLength);
                            return YES;
                          }];
        return status == AncPrivateVaultKeychainStatusOK;
      }];
  if (status != AncPrivateVaultKeychainStatusOK ||
      guarded != AncPrivateVaultGuardedMemoryStatusOK) {
    [owned close];
    return status == AncPrivateVaultKeychainStatusOK
               ? AncPrivateVaultRotationPreparationStoreStatusStorageFailed
               : AncRotationPreparationKeychainStatus(status);
  }
  *data = owned;
  return AncPrivateVaultRotationPreparationStoreStatusOK;
}

- (AncPrivateVaultRotationPreparationStoreStatus)
    writeExact:(AncPrivateVaultGuardedRecord *)data
       service:(NSString *)service
      vaultKey:(NSString *)vaultKey {
  AncPrivateVaultGuardedRecord *existing ANC_ROTATION_GUARDED_LOCAL = nil;
  AncPrivateVaultGuardedRecord *observed ANC_ROTATION_GUARDED_LOCAL = nil;
  @try {
    AncPrivateVaultRotationPreparationStoreStatus read =
        [self readService:service vaultKey:vaultKey data:&existing];
    if (read == AncPrivateVaultRotationPreparationStoreStatusOK &&
        [existing isEqualToRecord:data])
      return AncPrivateVaultRotationPreparationStoreStatusOK;
    __block AncPrivateVaultKeychainStatus write =
        AncPrivateVaultKeychainStatusFailed;
    AncPrivateVaultGuardedMemoryStatus borrowed =
        [data borrow:^BOOL(uint8_t *bytes, size_t length) {
          write =
              read == AncPrivateVaultRotationPreparationStoreStatusNotFound
                  ? [self.keychain
                          addBytes:bytes
                            length:length
                        forService:service
                           vaultId:vaultKey
                          recordId:AncPrivateVaultRotationPreparationRecordId]
              : read == AncPrivateVaultRotationPreparationStoreStatusOK
                  ? [self.keychain
                        updateBytes:bytes
                             length:length
                         forService:service
                            vaultId:vaultKey
                           recordId:AncPrivateVaultRotationPreparationRecordId]
                  : AncPrivateVaultKeychainStatusFailed;
          return write == AncPrivateVaultKeychainStatusOK;
        }];
    if (read != AncPrivateVaultRotationPreparationStoreStatusOK &&
        read != AncPrivateVaultRotationPreparationStoreStatusNotFound)
      return read;
    if (borrowed != AncPrivateVaultGuardedMemoryStatusOK)
      return write == AncPrivateVaultKeychainStatusOK
                 ? AncPrivateVaultRotationPreparationStoreStatusStorageFailed
                 : AncRotationPreparationKeychainStatus(write);
    if (write != AncPrivateVaultKeychainStatusOK)
      return AncRotationPreparationKeychainStatus(write);
    AncPrivateVaultRotationPreparationStoreStatus verified =
        [self readService:service vaultKey:vaultKey data:&observed];
    if (verified != AncPrivateVaultRotationPreparationStoreStatusOK)
      return verified;
    return [observed isEqualToRecord:data]
               ? AncPrivateVaultRotationPreparationStoreStatusOK
               : AncPrivateVaultRotationPreparationStoreStatusConflict;
  } @finally {
    AncRotationPreparationClearKeychainRecord(existing);
    AncRotationPreparationClearKeychainRecord(observed);
  }
}

- (AncPrivateVaultRotationPreparationStoreStatus)deleteStageVaultKey:
    (NSString *)vaultKey {
  AncPrivateVaultKeychainStatus deleted = [self.keychain
      deleteDataForService:AncPrivateVaultRotationPreparationStageService
                   vaultId:vaultKey
                  recordId:AncPrivateVaultRotationPreparationRecordId];
  return AncRotationPreparationKeychainStatus(deleted);
}

- (AncPrivateVaultRotationPreparationStoreStatus)
        finishStage:(AncPrivateVaultGuardedRecord *)stage
             digest:(NSData *)digest
    fenceGeneration:(uint64_t)fenceGeneration
           vaultKey:(NSString *)vaultKey {
  NSString *registryKey =
      AncRotationPreparationRegistryKey(self.keychain.storageDomain, vaultKey);
  AncPrivateVaultRotationPreparationStoreStatus revoked =
      AncRotationPreparationRevokeHandles(registryKey);
  if (revoked != AncPrivateVaultRotationPreparationStoreStatusOK)
    return revoked;
  if (AncRotationPreparationFault(
          AncPrivateVaultRotationPreparationStoreFaultBeforeFenceBegin))
    return AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  AncPrivateVaultFenceStatus fence =
      [self.fence beginGeneration:fenceGeneration
                     recordDigest:digest
                          vaultId:vaultKey
                         recordId:AncPrivateVaultRotationPreparationRecordId];
  if (fence != AncPrivateVaultFenceStatusOK)
    return AncRotationPreparationFenceStatus(fence);
  if (AncRotationPreparationFault(
          AncPrivateVaultRotationPreparationStoreFaultAfterFenceBegin))
    return AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  AncPrivateVaultRotationPreparationStoreStatus live =
      [self writeExact:stage
               service:AncPrivateVaultRotationPreparationService
              vaultKey:vaultKey];
  if (live != AncPrivateVaultRotationPreparationStoreStatusOK)
    return live;
  if (AncRotationPreparationFault(
          AncPrivateVaultRotationPreparationStoreFaultAfterLiveWrite))
    return AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  fence =
      [self.fence commitGeneration:fenceGeneration
                      recordDigest:digest
                           vaultId:vaultKey
                          recordId:AncPrivateVaultRotationPreparationRecordId];
  if (fence != AncPrivateVaultFenceStatusOK)
    return AncRotationPreparationFenceStatus(fence);
  if (AncRotationPreparationFault(
          AncPrivateVaultRotationPreparationStoreFaultAfterFenceCommit))
    return AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  AncPrivateVaultFenceSnapshot *observedFence = nil;
  fence = [self.fence readVaultId:vaultKey
                         recordId:AncPrivateVaultRotationPreparationRecordId
                         snapshot:&observedFence];
  if (fence != AncPrivateVaultFenceStatusOK ||
      observedFence.state != AncPrivateVaultFenceStateStable ||
      observedFence.generation != fenceGeneration ||
      ![observedFence.recordDigest isEqualToData:digest])
    return AncPrivateVaultRotationPreparationStoreStatusRollbackDetected;
  AncPrivateVaultGuardedRecord *observedLive ANC_ROTATION_GUARDED_LOCAL = nil;
  AncPrivateVaultRotationPreparationStoreStatus read =
      [self readService:AncPrivateVaultRotationPreparationService
               vaultKey:vaultKey
                   data:&observedLive];
  if (read != AncPrivateVaultRotationPreparationStoreStatusOK ||
      ![observedLive isEqualToRecord:stage] ||
      ![[AncRotationPreparationDigest(observedLive) copy] isEqualToData:digest])
    return AncPrivateVaultRotationPreparationStoreStatusRollbackDetected;
  AncRotationPreparationCurrentGenerations()[registryKey] = @(fenceGeneration);
  if (AncRotationPreparationFault(
          AncPrivateVaultRotationPreparationStoreFaultBeforeStageDelete))
    return AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  return [self deleteStageVaultKey:vaultKey];
}

- (AncPrivateVaultRotationPreparationStoreStatus)
    reconcileVaultId:(const uint8_t[16])vaultId
              record:(AncPrivateVaultGuardedRecord **)outRecord
            snapshot:(AncPrivateVaultRotationPreparationSnapshot *)outSnapshot
              handle:(AncPrivateVaultRotationPreparationKeyHandle **)outHandle
     fenceGeneration:(uint64_t *)outFenceGeneration
              digest:(NSData **)outDigest {
  *outRecord = nil;
  *outHandle = nil;
  *outFenceGeneration = 0;
  *outDigest = nil;
  anc_pv_rotation_preparation_snapshot_zero(outSnapshot);
  NSString *vaultKey = AncRotationPreparationVaultKey(vaultId);
  NSString *registryKey =
      AncRotationPreparationRegistryKey(self.keychain.storageDomain, vaultKey);
  if (vaultKey == nil)
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  AncPrivateVaultGuardedRecord *live ANC_ROTATION_GUARDED_LOCAL = nil;
  AncPrivateVaultGuardedRecord *stage ANC_ROTATION_GUARDED_LOCAL = nil;
  AncPrivateVaultRotationPreparationStoreStatus liveStatus =
      [self readService:AncPrivateVaultRotationPreparationService
               vaultKey:vaultKey
                   data:&live];
  AncPrivateVaultRotationPreparationStoreStatus stageStatus =
      [self readService:AncPrivateVaultRotationPreparationStageService
               vaultKey:vaultKey
                   data:&stage];
  if (liveStatus != AncPrivateVaultRotationPreparationStoreStatusOK &&
      liveStatus != AncPrivateVaultRotationPreparationStoreStatusNotFound)
    return liveStatus;
  if (stageStatus != AncPrivateVaultRotationPreparationStoreStatusOK &&
      stageStatus != AncPrivateVaultRotationPreparationStoreStatusNotFound)
    return stageStatus;

  AncPrivateVaultRotationPreparationSnapshot liveSnapshot;
  AncPrivateVaultRotationPreparationSnapshot stageSnapshot;
  AncPrivateVaultRotationPreparationKeyHandle *liveHandle = nil;
  AncPrivateVaultRotationPreparationKeyHandle *stageHandle = nil;
  if (live != nil) {
    AncPrivateVaultRotationPreparationStoreStatus decoded =
        AncRotationPreparationDecode(live, &liveSnapshot, &liveHandle);
    if (decoded != AncPrivateVaultRotationPreparationStoreStatusOK ||
        !AncRotationPreparationSnapshotMatchesVault(&liveSnapshot, vaultId)) {
      [liveHandle close];
      return decoded == AncPrivateVaultRotationPreparationStoreStatusOK
                 ? AncPrivateVaultRotationPreparationStoreStatusRollbackDetected
                 : decoded;
    }
  } else {
    anc_pv_rotation_preparation_snapshot_zero(&liveSnapshot);
  }
  if (stage != nil) {
    AncPrivateVaultRotationPreparationStoreStatus decoded =
        AncRotationPreparationDecode(stage, &stageSnapshot, &stageHandle);
    if (decoded != AncPrivateVaultRotationPreparationStoreStatusOK ||
        !AncRotationPreparationSnapshotMatchesVault(&stageSnapshot, vaultId)) {
      [liveHandle close];
      [stageHandle close];
      return decoded == AncPrivateVaultRotationPreparationStoreStatusOK
                 ? AncPrivateVaultRotationPreparationStoreStatusRollbackDetected
                 : decoded;
    }
  } else {
    anc_pv_rotation_preparation_snapshot_zero(&stageSnapshot);
  }
  NSData *liveDigest = live == nil ? nil : AncRotationPreparationDigest(live);
  NSData *stageDigest =
      stage == nil ? nil : AncRotationPreparationDigest(stage);
  if ((live != nil && liveDigest == nil) ||
      (stage != nil && stageDigest == nil)) {
    [liveHandle close];
    [stageHandle close];
    return AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  }

  AncPrivateVaultFenceSnapshot *fence = nil;
  AncPrivateVaultFenceStatus fenceStatus =
      [self.fence readVaultId:vaultKey
                     recordId:AncPrivateVaultRotationPreparationRecordId
                     snapshot:&fence];
  if (fenceStatus != AncPrivateVaultFenceStatusOK) {
    [liveHandle close];
    [stageHandle close];
    return AncRotationPreparationFenceStatus(fenceStatus);
  }
  if (fence.state == AncPrivateVaultFenceStateAbsent) {
    [liveHandle close];
    if (live != nil || stage == nil ||
        stageSnapshot.phase != ANC_PV_ROTATION_PREPARATION_PHASE_PREPARED ||
        stageSnapshot.preparation_generation != 1) {
      [stageHandle close];
      return live == nil && stage == nil
                 ? AncPrivateVaultRotationPreparationStoreStatusNotFound
                 : AncPrivateVaultRotationPreparationStoreStatusRollbackDetected;
    }
    [stageHandle close];
    AncPrivateVaultRotationPreparationStoreStatus finished =
        [self finishStage:stage
                     digest:stageDigest
            fenceGeneration:1
                   vaultKey:vaultKey];
    if (finished != AncPrivateVaultRotationPreparationStoreStatusOK)
      return finished;
    return [self reconcileVaultId:vaultId
                           record:outRecord
                         snapshot:outSnapshot
                           handle:outHandle
                  fenceGeneration:outFenceGeneration
                           digest:outDigest];
  }

  BOOL stageValid = NO;
  if (stage != nil && fence.generation > 0) {
    if (live == nil)
      stageValid =
          stageSnapshot.phase == ANC_PV_ROTATION_PREPARATION_PHASE_PREPARED &&
          stageSnapshot.preparation_generation == 1;
    else if ([liveDigest isEqualToData:stageDigest])
      stageValid = YES;
    else
      stageValid = AncRotationPreparationTransitionValidate(live, stage) ==
                   ANC_PV_ROTATION_PREPARATION_OK;
  }
  if (fence.state == AncPrivateVaultFenceStatePending) {
    [liveHandle close];
    [stageHandle close];
    if (stage == nil || !stageValid ||
        ![stageDigest isEqualToData:fence.recordDigest])
      return AncPrivateVaultRotationPreparationStoreStatusRollbackDetected;
    AncPrivateVaultRotationPreparationStoreStatus finished =
        [self finishStage:stage
                     digest:stageDigest
            fenceGeneration:fence.generation
                   vaultKey:vaultKey];
    if (finished != AncPrivateVaultRotationPreparationStoreStatusOK)
      return finished;
    return [self reconcileVaultId:vaultId
                           record:outRecord
                         snapshot:outSnapshot
                           handle:outHandle
                  fenceGeneration:outFenceGeneration
                           digest:outDigest];
  }
  if (live == nil || liveSnapshot.phase == 0 ||
      ![liveDigest isEqualToData:fence.recordDigest]) {
    [liveHandle close];
    [stageHandle close];
    return AncPrivateVaultRotationPreparationStoreStatusRollbackDetected;
  }
  if (stage != nil) {
    [liveHandle close];
    [stageHandle close];
    if ([stageDigest isEqualToData:liveDigest]) {
      AncPrivateVaultRotationPreparationStoreStatus deleted =
          [self deleteStageVaultKey:vaultKey];
      if (deleted != AncPrivateVaultRotationPreparationStoreStatusOK)
        return deleted;
    } else {
      if (!stageValid || fence.generation == UINT64_MAX)
        return AncPrivateVaultRotationPreparationStoreStatusRollbackDetected;
      AncPrivateVaultRotationPreparationStoreStatus finished =
          [self finishStage:stage
                       digest:stageDigest
              fenceGeneration:fence.generation + 1
                     vaultKey:vaultKey];
      if (finished != AncPrivateVaultRotationPreparationStoreStatusOK)
        return finished;
    }
    return [self reconcileVaultId:vaultId
                           record:outRecord
                         snapshot:outSnapshot
                           handle:outHandle
                  fenceGeneration:outFenceGeneration
                           digest:outDigest];
  }
  if (liveSnapshot.phase ==
      ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT) {
    __block AncPrivateVaultRotationPreparationSpoolStatus spool =
        AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
    AncRotationPreparationRegisterHandle(liveHandle, registryKey,
                                         fence.generation);
    AncPrivateVaultRotationPreparationStoreStatus borrowed =
        [liveHandle borrow:^BOOL(const uint8_t *key) {
          NSError *error = nil;
          spool =
              [self.spool reconcileVaultId:liveSnapshot.vault_id
                                  ceremonyId:liveSnapshot.ceremony_id
                   expectedSignedEntryLength:liveSnapshot.signed_entry_length
                  expectedRecoveryWrapLength:liveSnapshot.recovery_wrap_length
                         expectedFrameDigest:liveSnapshot.encrypted_spool_digest
                                  pendingKey:key
                                       error:&error];
          return spool == AncPrivateVaultRotationPreparationSpoolStatusOK;
        }];
    if (borrowed != AncPrivateVaultRotationPreparationStoreStatusOK ||
        spool != AncPrivateVaultRotationPreparationSpoolStatusOK) {
      AncPrivateVaultRotationPreparationStoreStatus closed =
          [liveHandle close];
      if (closed != AncPrivateVaultRotationPreparationStoreStatusOK)
        return closed;
      return spool != AncPrivateVaultRotationPreparationSpoolStatusOK
                 ? AncRotationPreparationStatusForSpool(spool, YES)
                 : borrowed;
    }
  }
  *outRecord = live;
  live = nil;
  *outSnapshot = liveSnapshot;
  AncRotationPreparationRegisterHandle(liveHandle, registryKey,
                                       fence.generation);
  *outHandle = liveHandle;
  *outFenceGeneration = fence.generation;
  *outDigest = liveDigest;
  return AncPrivateVaultRotationPreparationStoreStatusOK;
}

- (AncPrivateVaultRotationPreparationStoreStatus)
    readVaultId:(const uint8_t[16])vaultId
     checkpoint:(AncPrivateVaultRotationPreparationCheckpoint **)checkpoint
         handle:(AncPrivateVaultRotationPreparationKeyHandle **)handle {
  if (AncRotationPreparationInBorrowScope())
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  if (vaultId == NULL)
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  __block AncPrivateVaultRotationPreparationStoreStatus status;
  __block AncPrivateVaultRotationPreparationCheckpoint *resultCheckpoint = nil;
  __block AncPrivateVaultRotationPreparationKeyHandle *resultHandle = nil;
  const BOOL wantsCheckpoint = checkpoint != NULL;
  const BOOL wantsHandle = handle != NULL;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGuardedRecord *record ANC_ROTATION_GUARDED_LOCAL = nil;
    NSData *digest = nil;
    uint64_t generation = 0;
    AncPrivateVaultRotationPreparationSnapshot snapshot;
    AncPrivateVaultRotationPreparationKeyHandle *value = nil;
    status = [self reconcileVaultId:vaultId
                             record:&record
                           snapshot:&snapshot
                             handle:&value
                    fenceGeneration:&generation
                             digest:&digest];
    if (status == AncPrivateVaultRotationPreparationStoreStatusOK) {
      if (wantsCheckpoint)
        resultCheckpoint = [[AncPrivateVaultRotationPreparationCheckpoint alloc]
            initWithFenceGeneration:generation
                       recordDigest:digest
                           snapshot:&snapshot];
      if (wantsHandle)
        resultHandle = value;
      else
        [value close];
    }
    anc_pv_rotation_preparation_snapshot_zero(&snapshot);
  });
  if (checkpoint != NULL)
    *checkpoint = status == AncPrivateVaultRotationPreparationStoreStatusOK
                      ? resultCheckpoint
                      : nil;
  if (handle != NULL)
    *handle = status == AncPrivateVaultRotationPreparationStoreStatusOK
                  ? resultHandle
                  : nil;
  return status;
}

- (AncPrivateVaultRotationPreparationStoreStatus)
       commitCandidate:(AncPrivateVaultGuardedRecord *)candidate
               vaultId:(const uint8_t[16])vaultId
    expectedCheckpoint:(AncPrivateVaultRotationPreparationCheckpoint *)expected
         allowCreation:(BOOL)allowCreation
         outCheckpoint:
             (AncPrivateVaultRotationPreparationCheckpoint **)outCheckpoint {
  AncPrivateVaultGuardedRecord *current ANC_ROTATION_GUARDED_LOCAL = nil;
  NSData *digest = nil;
  uint64_t generation = 0;
  AncPrivateVaultRotationPreparationSnapshot currentSnapshot;
  AncPrivateVaultRotationPreparationKeyHandle *handle = nil;
  AncPrivateVaultRotationPreparationStoreStatus reconciled =
      [self reconcileVaultId:vaultId
                      record:&current
                    snapshot:&currentSnapshot
                      handle:&handle
             fenceGeneration:&generation
                      digest:&digest];
  [handle close];
  if (allowCreation &&
      reconciled == AncPrivateVaultRotationPreparationStoreStatusNotFound) {
    if (expected != nil)
      return AncPrivateVaultRotationPreparationStoreStatusConflict;
    generation = 0;
  } else if (reconciled != AncPrivateVaultRotationPreparationStoreStatusOK) {
    return reconciled;
  } else if (expected == nil || expected.fenceGeneration != generation ||
             ![expected.recordDigest isEqualToData:digest]) {
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  }
  AncPrivateVaultRotationPreparationSnapshot candidateSnapshot;
  AncPrivateVaultRotationPreparationKeyHandle *candidateHandle = nil;
  AncPrivateVaultRotationPreparationStoreStatus decoded =
      AncRotationPreparationDecode(candidate, &candidateSnapshot,
                                   &candidateHandle);
  [candidateHandle close];
  if (decoded != AncPrivateVaultRotationPreparationStoreStatusOK ||
      !AncRotationPreparationSnapshotMatchesVault(&candidateSnapshot,
                                                  vaultId)) {
    anc_pv_rotation_preparation_snapshot_zero(&candidateSnapshot);
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  }
  if (current == nil) {
    if (candidateSnapshot.phase != ANC_PV_ROTATION_PREPARATION_PHASE_PREPARED ||
        candidateSnapshot.preparation_generation != 1) {
      anc_pv_rotation_preparation_snapshot_zero(&candidateSnapshot);
      return AncPrivateVaultRotationPreparationStoreStatusConflict;
    }
  } else if (AncRotationPreparationTransitionValidate(current, candidate) !=
             ANC_PV_ROTATION_PREPARATION_OK) {
    anc_pv_rotation_preparation_snapshot_zero(&candidateSnapshot);
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  }
#if ANC_PRIVATE_VAULT_TESTING
  if (gAncRotationPreparationBeforeCommitHook != nil)
    gAncRotationPreparationBeforeCommitHook();
#endif
  NSString *vaultKey = AncRotationPreparationVaultKey(vaultId);
  AncPrivateVaultGuardedRecord *recheckedLive ANC_ROTATION_GUARDED_LOCAL = nil;
  AncPrivateVaultRotationPreparationStoreStatus rechecked =
      [self readService:AncPrivateVaultRotationPreparationService
               vaultKey:vaultKey
                   data:&recheckedLive];
  AncPrivateVaultFenceSnapshot *recheckedFence = nil;
  AncPrivateVaultFenceStatus recheckedFenceStatus =
      [self.fence readVaultId:vaultKey
                     recordId:AncPrivateVaultRotationPreparationRecordId
                     snapshot:&recheckedFence];
  BOOL stable = recheckedFenceStatus == AncPrivateVaultFenceStatusOK;
  if (current == nil) {
    stable =
        stable &&
        rechecked == AncPrivateVaultRotationPreparationStoreStatusNotFound &&
        recheckedFence.state == AncPrivateVaultFenceStateAbsent;
  } else {
    stable = stable &&
             rechecked == AncPrivateVaultRotationPreparationStoreStatusOK &&
             [recheckedLive isEqualToRecord:current] &&
             recheckedFence.state == AncPrivateVaultFenceStateStable &&
             recheckedFence.generation == generation &&
             [recheckedFence.recordDigest isEqualToData:digest];
  }
  if (!stable) {
    anc_pv_rotation_preparation_snapshot_zero(&candidateSnapshot);
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  }
  AncPrivateVaultRotationPreparationStoreStatus staged =
      [self writeExact:candidate
               service:AncPrivateVaultRotationPreparationStageService
              vaultKey:vaultKey];
  if (staged != AncPrivateVaultRotationPreparationStoreStatusOK) {
    anc_pv_rotation_preparation_snapshot_zero(&candidateSnapshot);
    return staged;
  }
  if (AncRotationPreparationFault(
          AncPrivateVaultRotationPreparationStoreFaultAfterStageWrite)) {
    anc_pv_rotation_preparation_snapshot_zero(&candidateSnapshot);
    return AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
  }
  NSData *candidateDigest = AncRotationPreparationDigest(candidate);
  AncPrivateVaultRotationPreparationStoreStatus committed =
      candidateDigest == nil
          ? AncPrivateVaultRotationPreparationStoreStatusStorageFailed
          : [self finishStage:candidate
                         digest:candidateDigest
                fenceGeneration:generation + 1
                       vaultKey:vaultKey];
  if (committed == AncPrivateVaultRotationPreparationStoreStatusOK &&
      outCheckpoint != NULL)
    *outCheckpoint = [[AncPrivateVaultRotationPreparationCheckpoint alloc]
        initWithFenceGeneration:generation + 1
                   recordDigest:candidateDigest
                       snapshot:&candidateSnapshot];
  anc_pv_rotation_preparation_snapshot_zero(&candidateSnapshot);
  return committed;
}

- (AncPrivateVaultGuardedRecord *)
    encodeSnapshot:(const AncPrivateVaultRotationPreparationSnapshot *)snapshot
         keyHandle:(AncPrivateVaultRotationPreparationKeyHandle *)handle
         directKey:(const uint8_t *)directKey {
  AncPrivateVaultGuardedRecord *record =
      [[AncPrivateVaultGuardedRecord alloc] initEmpty];
  if (record == nil)
    return nil;
  __block AncPrivateVaultRotationPreparationStatus encoded =
      ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT;
  AncPrivateVaultGuardedMemoryStatus borrowed =
      [record borrow:^BOOL(uint8_t *recordBytes, size_t recordLength) {
        if (recordLength != ANC_PV_ROTATION_PREPARATION_RECORD_BYTES)
          return NO;
        if (directKey != NULL) {
          encoded = anc_pv_rotation_preparation_record_encode(
              snapshot, directKey, recordBytes, recordLength);
          return encoded == ANC_PV_ROTATION_PREPARATION_OK;
        }
        return [handle borrow:^BOOL(const uint8_t *key) {
                 encoded = anc_pv_rotation_preparation_record_encode(
                     snapshot, key, recordBytes, recordLength);
                 return encoded == ANC_PV_ROTATION_PREPARATION_OK;
               }] == AncPrivateVaultRotationPreparationStoreStatusOK;
      }];
  if (borrowed != AncPrivateVaultGuardedMemoryStatusOK ||
      encoded != ANC_PV_ROTATION_PREPARATION_OK) {
    [record close];
    return nil;
  }
  return record;
}

- (AncPrivateVaultRotationPreparationStoreStatus)
    createGenesisPrepared:
        (const AncPrivateVaultRotationPreparationSnapshot *)snapshot
          pendingEpochKey:(const uint8_t[32])pendingEpochKey
               checkpoint:
                   (AncPrivateVaultRotationPreparationCheckpoint **)checkpoint {
  if (AncRotationPreparationInBorrowScope())
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  if (snapshot == NULL || pendingEpochKey == NULL ||
      snapshot->phase != ANC_PV_ROTATION_PREPARATION_PHASE_PREPARED)
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  AncPrivateVaultGuardedRecord *candidate =
      [self encodeSnapshot:snapshot keyHandle:nil directKey:pendingEpochKey];
  if (candidate == nil)
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  __block AncPrivateVaultRotationPreparationStoreStatus status;
  __block AncPrivateVaultRotationPreparationCheckpoint *resultCheckpoint = nil;
  dispatch_sync(self.queue, ^{
    status = [self commitCandidate:candidate
                           vaultId:snapshot->vault_id
                expectedCheckpoint:nil
                     allowCreation:YES
                     outCheckpoint:&resultCheckpoint];
  });
  AncRotationPreparationClearRecord(candidate);
  if (checkpoint != NULL)
    *checkpoint = status == AncPrivateVaultRotationPreparationStoreStatusOK
                      ? resultCheckpoint
                      : nil;
  return status;
}

- (AncPrivateVaultRotationPreparationStoreStatus)
    createPrepared:
        (const AncPrivateVaultRotationPreparationSnapshot *)snapshot
          pendingEpochKey:(const uint8_t[32])pendingEpochKey
       expectedCheckpoint:
           (AncPrivateVaultRotationPreparationCheckpoint *)expected
               checkpoint:
                   (AncPrivateVaultRotationPreparationCheckpoint **)checkpoint {
  if (checkpoint != NULL)
    *checkpoint = nil;
  if (AncRotationPreparationInBorrowScope())
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  if (snapshot == NULL || pendingEpochKey == NULL ||
      snapshot->phase != ANC_PV_ROTATION_PREPARATION_PHASE_PREPARED)
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  AncPrivateVaultGuardedRecord *candidate =
      [self encodeSnapshot:snapshot keyHandle:nil directKey:pendingEpochKey];
  if (candidate == nil)
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  __block AncPrivateVaultRotationPreparationStoreStatus status;
  __block AncPrivateVaultRotationPreparationCheckpoint *result = nil;
  dispatch_sync(self.queue, ^{
    status = [self commitCandidate:candidate
                           vaultId:snapshot->vault_id
                expectedCheckpoint:expected
                     allowCreation:expected == nil
                     outCheckpoint:&result];
  });
  AncRotationPreparationClearRecord(candidate);
  if (checkpoint != NULL &&
      status == AncPrivateVaultRotationPreparationStoreStatusOK)
    *checkpoint = result;
  return status;
}

- (AncPrivateVaultRotationPreparationStoreStatus)
        advanceVaultId:(const uint8_t[16])vaultId
    expectedCheckpoint:(AncPrivateVaultRotationPreparationCheckpoint *)expected
               toPhase:(AncPrivateVaultRotationPreparationPhase)phase
            checkpoint:
                (AncPrivateVaultRotationPreparationCheckpoint **)checkpoint {
  if (AncRotationPreparationInBorrowScope())
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  if (vaultId == NULL || expected == nil)
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  __block AncPrivateVaultRotationPreparationStoreStatus status;
  __block AncPrivateVaultRotationPreparationCheckpoint *resultCheckpoint = nil;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGuardedRecord *record ANC_ROTATION_GUARDED_LOCAL = nil;
    NSData *digest = nil;
    uint64_t generation = 0;
    AncPrivateVaultRotationPreparationSnapshot snapshot;
    AncPrivateVaultRotationPreparationKeyHandle *handle = nil;
    status = [self reconcileVaultId:vaultId
                             record:&record
                           snapshot:&snapshot
                             handle:&handle
                    fenceGeneration:&generation
                             digest:&digest];
    if (status != AncPrivateVaultRotationPreparationStoreStatusOK)
      return;
    if (expected.fenceGeneration != generation ||
        ![expected.recordDigest isEqualToData:digest] ||
        !anc_pv_rotation_preparation_phase_transition_allowed(snapshot.phase,
                                                              phase)) {
      [handle close];
      status = AncPrivateVaultRotationPreparationStoreStatusConflict;
      return;
    }
    snapshot.phase = phase;
    AncPrivateVaultGuardedRecord *candidate = [self encodeSnapshot:&snapshot
                                                         keyHandle:handle
                                                         directKey:NULL];
    [handle close];
    if (candidate == nil) {
      status = AncPrivateVaultRotationPreparationStoreStatusInvalid;
      return;
    }
    status = [self commitCandidate:candidate
                           vaultId:vaultId
                expectedCheckpoint:expected
                     allowCreation:NO
                     outCheckpoint:&resultCheckpoint];
    AncRotationPreparationClearRecord(candidate);
    anc_pv_rotation_preparation_snapshot_zero(&snapshot);
  });
  if (checkpoint != NULL)
    *checkpoint = status == AncPrivateVaultRotationPreparationStoreStatusOK
                      ? resultCheckpoint
                      : nil;
  return status;
}

- (AncPrivateVaultRotationPreparationStoreStatus)
    markRewrappedVaultId:(const uint8_t[16])vaultId
      expectedCheckpoint:
          (AncPrivateVaultRotationPreparationCheckpoint *)expected
              checkpoint:
                  (AncPrivateVaultRotationPreparationCheckpoint **)checkpoint {
  return [self advanceVaultId:vaultId
           expectedCheckpoint:expected
                      toPhase:ANC_PV_ROTATION_PREPARATION_PHASE_REWRAPPED
                   checkpoint:checkpoint];
}

- (AncPrivateVaultRotationPreparationStoreStatus)
    markAcknowledgedVaultId:(const uint8_t[16])vaultId
         expectedCheckpoint:
             (AncPrivateVaultRotationPreparationCheckpoint *)expected
                 checkpoint:(AncPrivateVaultRotationPreparationCheckpoint **)
                                checkpoint {
  return [self advanceVaultId:vaultId
           expectedCheckpoint:expected
                      toPhase:ANC_PV_ROTATION_PREPARATION_PHASE_ACKNOWLEDGED
                   checkpoint:checkpoint];
}

- (AncPrivateVaultRotationPreparationStoreStatus)
    armAwaitingControlCommitVaultId:(const uint8_t[16])vaultId
                 expectedCheckpoint:
                     (AncPrivateVaultRotationPreparationCheckpoint *)expected
                   expectedSequence:(uint64_t)expectedSequence
               expectedPreviousHead:(const uint8_t[32])expectedPreviousHead
                   transcriptDigest:(const uint8_t[32])transcriptDigest
                        signedEntry:(const uint8_t *)signedEntry
                  signedEntryLength:(size_t)signedEntryLength
                       recoveryWrap:(const uint8_t *)recoveryWrap
                 recoveryWrapLength:(size_t)recoveryWrapLength
                              nonce:(const uint8_t[24])nonce
                         checkpoint:
                             (AncPrivateVaultRotationPreparationCheckpoint **)
                                 checkpoint {
  if (AncRotationPreparationInBorrowScope())
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  if (vaultId == NULL || expected == nil || expectedPreviousHead == NULL ||
      transcriptDigest == NULL || signedEntry == NULL || recoveryWrap == NULL ||
      nonce == NULL)
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  __block AncPrivateVaultRotationPreparationStoreStatus status;
  __block AncPrivateVaultRotationPreparationCheckpoint *resultCheckpoint = nil;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGuardedRecord *record ANC_ROTATION_GUARDED_LOCAL = nil;
    NSData *digest = nil;
    uint64_t generation = 0;
    AncPrivateVaultRotationPreparationSnapshot snapshot;
    AncPrivateVaultRotationPreparationKeyHandle *handle = nil;
    status = [self reconcileVaultId:vaultId
                             record:&record
                           snapshot:&snapshot
                             handle:&handle
                    fenceGeneration:&generation
                             digest:&digest];
    if (status != AncPrivateVaultRotationPreparationStoreStatusOK)
      return;
    if (expected.fenceGeneration != generation ||
        ![expected.recordDigest isEqualToData:digest] ||
        snapshot.phase != ANC_PV_ROTATION_PREPARATION_PHASE_ACKNOWLEDGED) {
      [handle close];
      status = AncPrivateVaultRotationPreparationStoreStatusConflict;
      return;
    }
    __block NSData *outer = nil;
    uint8_t frameDigest[32] = {0};
    uint8_t *frameDigestBytes = frameDigest;
    __block AncPrivateVaultRotationPreparationSpoolStatus spoolStatus;
    AncPrivateVaultRotationPreparationStoreStatus borrowed =
        [handle borrow:^BOOL(const uint8_t *key) {
          outer = AncPrivateVaultRotationPreparationSpoolEncode(
              signedEntry, signedEntryLength, recoveryWrap, recoveryWrapLength,
              vaultId, snapshot.ceremony_id, key, nonce, frameDigestBytes,
              &spoolStatus);
          return outer != nil &&
                 spoolStatus == AncPrivateVaultRotationPreparationSpoolStatusOK;
        }];
    if (borrowed != AncPrivateVaultRotationPreparationStoreStatusOK ||
        outer == nil) {
      [handle close];
      anc_pv_zeroize(frameDigest, sizeof frameDigest);
      status = AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
      return;
    }
    __block NSError *error = nil;
    borrowed = [handle borrow:^BOOL(const uint8_t *key) {
      spoolStatus = [self.spool writeStageOuterFrame:outer
                                             vaultId:vaultId
                                          ceremonyId:snapshot.ceremony_id
                           expectedSignedEntryLength:signedEntryLength
                          expectedRecoveryWrapLength:recoveryWrapLength
                                 expectedFrameDigest:frameDigestBytes
                                          pendingKey:key
                                               error:&error];
      return spoolStatus == AncPrivateVaultRotationPreparationSpoolStatusOK;
    }];
    if (borrowed != AncPrivateVaultRotationPreparationStoreStatusOK ||
        spoolStatus != AncPrivateVaultRotationPreparationSpoolStatusOK) {
      [handle close];
      anc_pv_zeroize(frameDigest, sizeof frameDigest);
      status = AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
      return;
    }
    if (AncRotationPreparationFault(
            AncPrivateVaultRotationPreparationStoreFaultAfterSpoolStage)) {
      [handle close];
      anc_pv_zeroize(frameDigest, sizeof frameDigest);
      status = AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
      return;
    }
    snapshot.phase = ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT;
    snapshot.flags = ANC_PV_ROTATION_PREPARATION_FLAG_EDGE_BOUND |
                     ANC_PV_ROTATION_PREPARATION_FLAG_SPOOL_DURABLE;
    snapshot.expected_sequence = expectedSequence;
    memcpy(snapshot.expected_previous_head, expectedPreviousHead, 32);
    memcpy(snapshot.transcript_digest, transcriptDigest, 32);
    snapshot.signed_entry_length = signedEntryLength;
    snapshot.recovery_wrap_length = recoveryWrapLength;
    memcpy(snapshot.encrypted_spool_digest, frameDigest, 32);
    AncPrivateVaultGuardedRecord *candidate = [self encodeSnapshot:&snapshot
                                                         keyHandle:handle
                                                         directKey:NULL];
    [handle close];
    anc_pv_zeroize(frameDigest, sizeof frameDigest);
    if (candidate == nil) {
      status = AncPrivateVaultRotationPreparationStoreStatusInvalid;
      return;
    }
    status = [self commitCandidate:candidate
                           vaultId:vaultId
                expectedCheckpoint:expected
                     allowCreation:NO
                     outCheckpoint:&resultCheckpoint];
    if (status != AncPrivateVaultRotationPreparationStoreStatusOK) {
      AncRotationPreparationClearRecord(candidate);
      return;
    }
    AncPrivateVaultRotationPreparationSnapshot promotedSnapshot;
    AncPrivateVaultRotationPreparationKeyHandle *promotedHandle = nil;
    status = AncRotationPreparationDecode(candidate, &promotedSnapshot,
                                          &promotedHandle);
    if (status != AncPrivateVaultRotationPreparationStoreStatusOK) {
      AncRotationPreparationClearRecord(candidate);
      return;
    }
    AncRotationPreparationRegisterHandle(
        promotedHandle,
        AncRotationPreparationRegistryKey(
            self.keychain.storageDomain,
            AncRotationPreparationVaultKey(vaultId)),
        generation + 1);
    if (AncRotationPreparationFault(
            AncPrivateVaultRotationPreparationStoreFaultBeforeSpoolPromote)) {
      [promotedHandle close];
      anc_pv_rotation_preparation_snapshot_zero(&promotedSnapshot);
      AncRotationPreparationClearRecord(candidate);
      status = AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
      return;
    }
    borrowed = [promotedHandle borrow:^BOOL(const uint8_t *key) {
      spoolStatus = [self.spool
              promoteStageForVaultId:vaultId
                          ceremonyId:snapshot.ceremony_id
           expectedSignedEntryLength:signedEntryLength
          expectedRecoveryWrapLength:recoveryWrapLength
                 expectedFrameDigest:promotedSnapshot.encrypted_spool_digest
                          pendingKey:key
                               error:&error];
      return spoolStatus == AncPrivateVaultRotationPreparationSpoolStatusOK;
    }];
    [promotedHandle close];
    anc_pv_rotation_preparation_snapshot_zero(&promotedSnapshot);
    if (borrowed != AncPrivateVaultRotationPreparationStoreStatusOK ||
        spoolStatus != AncPrivateVaultRotationPreparationSpoolStatusOK)
      status = AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
    AncRotationPreparationClearRecord(candidate);
    anc_pv_rotation_preparation_snapshot_zero(&snapshot);
  });
  if (checkpoint != NULL)
    *checkpoint = status == AncPrivateVaultRotationPreparationStoreStatusOK
                      ? resultCheckpoint
                      : nil;
  return status;
}

- (AncPrivateVaultRotationPreparationStoreStatus)
    consumeAwaitingArtifactsVaultId:(const uint8_t[16])vaultId
                 expectedCheckpoint:
                     (AncPrivateVaultRotationPreparationCheckpoint *)expected
                           consumer:
                               (AncPrivateVaultRotationPreparationArtifactsConsumer)
                                   consumer {
  if (AncRotationPreparationInBorrowScope())
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  if (vaultId == NULL || expected == nil || consumer == nil)
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  __block AncPrivateVaultRotationPreparationStoreStatus status;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGuardedRecord *record ANC_ROTATION_GUARDED_LOCAL = nil;
    NSData *digest = nil;
    uint64_t generation = 0;
    AncPrivateVaultRotationPreparationSnapshot snapshot;
    AncPrivateVaultRotationPreparationKeyHandle *handle = nil;
    status = [self reconcileVaultId:vaultId
                             record:&record
                           snapshot:&snapshot
                             handle:&handle
                    fenceGeneration:&generation
                             digest:&digest];
    if (status != AncPrivateVaultRotationPreparationStoreStatusOK)
      return;
    if (expected.fenceGeneration != generation ||
        ![expected.recordDigest isEqualToData:digest] ||
        snapshot.phase !=
            ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT) {
      [handle close];
      status = AncPrivateVaultRotationPreparationStoreStatusConflict;
      return;
    }
    __block AncPrivateVaultRotationPreparationSpoolStatus spoolStatus =
        AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
    status = [handle borrow:^BOOL(const uint8_t *key) {
      NSError *error = nil;
      spoolStatus = [self.spool readLiveVaultId:vaultId
                                     ceremonyId:snapshot.ceremony_id
                      expectedSignedEntryLength:snapshot.signed_entry_length
                     expectedRecoveryWrapLength:snapshot.recovery_wrap_length
                            expectedFrameDigest:snapshot.encrypted_spool_digest
                                     pendingKey:key
                                       consumer:consumer
                                          error:&error];
      return spoolStatus == AncPrivateVaultRotationPreparationSpoolStatusOK;
    }];
    AncPrivateVaultRotationPreparationStoreStatus closed = [handle close];
    if (closed != AncPrivateVaultRotationPreparationStoreStatusOK) {
      status = closed;
    } else if (spoolStatus !=
               AncPrivateVaultRotationPreparationSpoolStatusOK) {
      status = AncRotationPreparationStatusForSpool(spoolStatus, NO);
    }
    anc_pv_rotation_preparation_snapshot_zero(&snapshot);
  });
  return status;
}

static NSString *AncRotationPreparationHex(const uint8_t *bytes,
                                            size_t length) {
  if (bytes == NULL || length == 0)
    return nil;
  NSMutableString *value = [NSMutableString stringWithCapacity:length * 2];
  for (size_t index = 0; index < length; index++)
    [value appendFormat:@"%02x", bytes[index]];
  return value;
}

static BOOL AncRotationPreparationFixedDataEqual(const uint8_t *bytes,
                                                  NSData *data,
                                                  size_t length) {
  return bytes != NULL && data.length == length &&
         anc_pv_memcmp(bytes, data.bytes, length) == ANC_PV_CRYPTO_OK;
}

static BOOL AncRotationPreparationCustodyIdentifier(
    const uint8_t *bytes, size_t length, NSString *expected) {
  if (bytes == NULL || expected.length == 0 || length != expected.length)
    return NO;
  NSData *encoded = [expected dataUsingEncoding:NSUTF8StringEncoding];
  return encoded.length == length &&
         anc_pv_memcmp(bytes, encoded.bytes, length) == ANC_PV_CRYPTO_OK;
}

static AncPrivateVaultAuthorityMember *AncRotationPreparationAuthorityMember(
    AncPrivateVaultAuthoritySnapshot *authority, NSString *endpointId) {
  for (AncPrivateVaultAuthorityMember *member in authority.activeMembers)
    if ([member.endpointId isEqualToString:endpointId])
      return member;
  return nil;
}

BOOL AncPrivateVaultRotationPreparationOfficialTupleValid(
    const AncPrivateVaultRotationPreparationSnapshot *preparation,
    NSString *vaultHex, AncPrivateVaultAuthorityCheckpoint *authority,
    const AncPrivateVaultCustodySnapshot *custody) {
  if (preparation == NULL || vaultHex.length != 32 || authority == nil ||
      custody == NULL || preparation->base_custody_generation == 0 ||
      preparation->base_custody_generation == UINT64_MAX ||
      preparation->base_sequence == UINT64_MAX ||
      preparation->base_epoch == UINT64_MAX ||
      preparation->expected_sequence != preparation->base_sequence + 1 ||
      preparation->pending_epoch != preparation->base_epoch + 1 ||
      preparation->base_recovery_generation == 0 ||
      preparation->flags !=
          (ANC_PV_ROTATION_PREPARATION_FLAG_EDGE_BOUND |
           ANC_PV_ROTATION_PREPARATION_FLAG_SPOOL_DURABLE) ||
      !AncRotationPreparationFixedDataEqual(
          preparation->expected_previous_head,
          [NSData dataWithBytes:preparation->base_head length:32], 32))
    return NO;

  AncPrivateVaultAuthoritySnapshot *snapshot = authority.snapshot;
  if (![authority.vaultId isEqualToString:vaultHex] ||
      ![snapshot.vaultId isEqualToString:vaultHex] ||
      authority.custodyGeneration != preparation->base_custody_generation + 1 ||
      snapshot.targetCustodyGeneration != authority.custodyGeneration ||
      snapshot.previousCustodyGeneration !=
          preparation->base_custody_generation ||
      snapshot.previousSequence == nil ||
      snapshot.previousSequence.unsignedLongLongValue !=
          preparation->base_sequence ||
      !AncRotationPreparationFixedDataEqual(preparation->base_head,
                                             snapshot.previousHead, 32) ||
      snapshot.sequence != preparation->expected_sequence ||
      !AncRotationPreparationFixedDataEqual(preparation->transcript_digest,
                                             snapshot.membershipHash, 32) ||
      snapshot.epoch != preparation->pending_epoch ||
      snapshot.recoveryGeneration !=
          preparation->base_recovery_generation ||
      authority.frameDigest.length != ANC_PV_HASH_BYTES)
    return NO;

  NSString *endpointHex = AncRotationPreparationHex(
      preparation->endpoint_id, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
  NSString *ceremonyHex = AncRotationPreparationHex(
      preparation->ceremony_id, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
  NSString *enrollmentHex = AncRotationPreparationHex(
      preparation->enrollment_ref, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
  NSString *expectedRole =
      preparation->role == ANC_PV_ROTATION_PREPARATION_ROLE_ENDPOINT
          ? @"endpoint"
          : preparation->role == ANC_PV_ROTATION_PREPARATION_ROLE_BROKER
                ? @"broker"
                : nil;
  AncPrivateVaultAuthorityMember *member =
      AncRotationPreparationAuthorityMember(snapshot, endpointHex);
  if (endpointHex == nil || ceremonyHex == nil || enrollmentHex == nil ||
      expectedRole == nil || member == nil ||
      ![member.role isEqualToString:expectedRole] ||
      member.unattended != (preparation->unattended != 0) ||
      !AncRotationPreparationFixedDataEqual(preparation->signing_public_key,
                                             member.signingPublicKey, 32) ||
      !AncRotationPreparationFixedDataEqual(preparation->agreement_public_key,
                                             member.keyAgreementPublicKey, 32) ||
      ![member.enrollmentRef isEqualToString:enrollmentHex])
    return NO;

  return custody->record_version == ANC_PV_CUSTODY_VERSION &&
         custody->authority_anchor_present == 1 &&
         custody->expected_edge_present == 0 &&
         custody->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
         custody->pending_kind == ANC_PV_CUSTODY_PENDING_NONE &&
         custody->rotation_phase == ANC_PV_CUSTODY_ROTATION_NONE &&
         custody->enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_NONE &&
         custody->custody_generation == authority.custodyGeneration &&
         AncRotationPreparationCustodyIdentifier(
             custody->vault_id, custody->vault_id_length, vaultHex) &&
         AncRotationPreparationCustodyIdentifier(
             custody->endpoint_id, custody->endpoint_id_length, endpointHex) &&
         custody->ceremony_id_length == 0 &&
         custody->role ==
             (preparation->role == ANC_PV_ROTATION_PREPARATION_ROLE_ENDPOINT
                  ? ANC_PV_CUSTODY_ROLE_ENDPOINT
                  : ANC_PV_CUSTODY_ROLE_BROKER) &&
         AncRotationPreparationFixedDataEqual(preparation->signing_public_key,
                                              [NSData dataWithBytes:custody->signing_public_key
                                                            length:32],
                                              32) &&
         AncRotationPreparationFixedDataEqual(preparation->agreement_public_key,
                                              [NSData dataWithBytes:custody->box_public_key
                                                            length:32],
                                              32) &&
         custody->active_epoch == preparation->pending_epoch &&
         custody->pending_epoch == 0 &&
         custody->recovery_generation == snapshot.recoveryGeneration &&
         custody->anchored_sequence == snapshot.sequence &&
         AncRotationPreparationFixedDataEqual(custody->anchored_head,
                                              snapshot.headHash, 32) &&
         AncRotationPreparationFixedDataEqual(custody->membership_digest,
                                              snapshot.membershipHash, 32) &&
         custody->signed_at_ms == snapshot.signedAtMs &&
         custody->freshness_ms == snapshot.verifiedAtMs &&
         AncRotationPreparationFixedDataEqual(custody->snapshot_digest,
                                              authority.frameDigest, 32) &&
         custody->expected_next_sequence == 0;
}

- (AncPrivateVaultRotationPreparationStoreStatus)
    consumeCommittedVaultId:(const uint8_t[16])vaultId
             authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
          custodyRepository:
              (AncPrivateVaultCustodyRepository *)custodyRepository
                 checkpoint:
                     (AncPrivateVaultRotationPreparationCheckpoint **)checkpoint {
  if (checkpoint != NULL)
    *checkpoint = nil;
  if (vaultId == NULL || object_getClass(self) !=
                             AncPrivateVaultRotationPreparationStore.class ||
      object_getClass(authorityStore) != AncPrivateVaultAuthorityStore.class ||
      object_getClass(custodyRepository) !=
          AncPrivateVaultCustodyRepository.class ||
      AncRotationPreparationInBorrowScope())
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;

  __block AncPrivateVaultRotationPreparationStoreStatus status;
  __block AncPrivateVaultRotationPreparationCheckpoint *result = nil;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGuardedRecord *record ANC_ROTATION_GUARDED_LOCAL = nil;
    NSData *digest = nil;
    uint64_t generation = 0;
    AncPrivateVaultRotationPreparationSnapshot preparation;
    AncPrivateVaultRotationPreparationKeyHandle *preparationHandle = nil;
    status = [self reconcileVaultId:vaultId
                             record:&record
                           snapshot:&preparation
                             handle:&preparationHandle
                    fenceGeneration:&generation
                             digest:&digest];
    if (status != AncPrivateVaultRotationPreparationStoreStatusOK)
      return;
    AncPrivateVaultRotationPreparationCheckpoint *expected =
        [[AncPrivateVaultRotationPreparationCheckpoint alloc]
            initWithFenceGeneration:generation
                       recordDigest:digest
                           snapshot:&preparation];
    if (preparation.phase !=
            ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT &&
        preparation.phase != ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED) {
      [preparationHandle close];
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      status = AncPrivateVaultRotationPreparationStoreStatusConflict;
      return;
    }

    NSString *vaultHex = AncRotationPreparationHex(
        vaultId, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
    NSString *preparationCeremony = AncRotationPreparationHex(
        preparation.ceremony_id, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
    AncPrivateVaultAuthorityCheckpoint *authority = nil;
    NSError *authorityError = nil;
    AncPrivateVaultAuthorityStoreStatus authorityStatus =
        [authorityStore loadVaultId:vaultHex
                         checkpoint:&authority
                              error:&authorityError];
    AncPrivateVaultCustodySnapshot custody = {0};
    AncPrivateVaultCustodyHandle *custodyHandle = nil;
    AncPrivateVaultCustodyRepositoryStatus custodyStatus =
        [custodyRepository readVaultId:vaultHex
                              snapshot:&custody
                                handle:&custodyHandle];
    BOOL tuple = authorityStatus == AncPrivateVaultAuthorityStoreStatusOK &&
                 custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
                 authorityError == nil && authority != nil &&
                 custodyHandle != nil &&
                 AncPrivateVaultRotationPreparationOfficialTupleValid(
                     &preparation, vaultHex, authority, &custody);
    __block BOOL artifactsBound = NO;
    __block AncPrivateVaultRotationPreparationSpoolStatus spoolStatus =
        AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
    AncPrivateVaultRotationPreparationArtifactsConsumer artifactConsumer =
        ^BOOL(const uint8_t *signedEntry, size_t signedEntryLength,
              const uint8_t *recoveryWrap, size_t recoveryWrapLength) {
      @autoreleasepool {
        NSData *signedData =
            [NSData dataWithBytesNoCopy:(void *)signedEntry
                                 length:signedEntryLength
                           freeWhenDone:NO];
        NSData *wrapData =
            [NSData dataWithBytesNoCopy:(void *)recoveryWrap
                                 length:recoveryWrapLength
                           freeWhenDone:NO];
        NSData *entryHash =
            AncPrivateVaultControlLogSignedEntryDomainHash(signedData);
        AncPrivateVaultControlLogState *officialState =
            AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(
                authority);
        NSData *wrapHash = nil;
        NSString *wrapCeremony = nil;
        BOOL wrapVerified =
            officialState != nil &&
            AncPrivateVaultRecoveryWrapVerifyCommittedSuccessor(
                wrapData, officialState, authority.snapshot.verifiedAtMs,
                &wrapHash, &wrapCeremony);
        artifactsBound = wrapVerified && entryHash.length == 32 &&
                         wrapHash.length == 32 &&
                         [entryHash isEqualToData:authority.snapshot.headHash] &&
                         [wrapHash
                             isEqualToData:authority.snapshot.recoveryWrapHash] &&
                         [wrapCeremony
                             isEqualToString:preparationCeremony];
        return artifactsBound;
      }
    };
    if (tuple) {
      __block NSError *spoolError = nil;
      if (preparation.phase ==
          ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT) {
        status = [preparationHandle borrow:^BOOL(const uint8_t *pendingKey) {
          spoolStatus = [self.spool
                  readLiveVaultId:vaultId
                       ceremonyId:preparation.ceremony_id
        expectedSignedEntryLength:preparation.signed_entry_length
       expectedRecoveryWrapLength:preparation.recovery_wrap_length
              expectedFrameDigest:preparation.encrypted_spool_digest
                       pendingKey:pendingKey
                         consumer:artifactConsumer
                            error:&spoolError];
          return spoolStatus ==
                     AncPrivateVaultRotationPreparationSpoolStatusOK &&
                 artifactsBound;
        }];
        tuple = status == AncPrivateVaultRotationPreparationStoreStatusOK &&
                spoolStatus ==
                    AncPrivateVaultRotationPreparationSpoolStatusOK &&
                artifactsBound;
      } else {
        custodyStatus = [custodyHandle
            borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
          spoolStatus = [self.spool
                  readLiveVaultId:vaultId
                       ceremonyId:preparation.ceremony_id
        expectedSignedEntryLength:preparation.signed_entry_length
       expectedRecoveryWrapLength:preparation.recovery_wrap_length
              expectedFrameDigest:preparation.encrypted_spool_digest
                       pendingKey:secrets->active_epoch_key
                         consumer:artifactConsumer
                            error:&spoolError];
          return spoolStatus ==
                     AncPrivateVaultRotationPreparationSpoolStatusOK &&
                 artifactsBound;
        }];
        tuple = custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
                spoolStatus ==
                    AncPrivateVaultRotationPreparationSpoolStatusOK &&
                artifactsBound;
      }
    }
    __block BOOL keysEqual = preparation.phase ==
                             ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED;
    __block AncPrivateVaultCustodyRepositoryStatus custodyBorrow =
        AncPrivateVaultCustodyRepositoryStatusInvalid;
    if (tuple && preparation.phase ==
                     ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT) {
      status = [preparationHandle borrow:^BOOL(const uint8_t *pendingKey) {
        custodyBorrow = [custodyHandle
            borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
              keysEqual = anc_pv_memcmp(pendingKey, secrets->active_epoch_key,
                                       ANC_PV_KEY_BYTES) == ANC_PV_CRYPTO_OK;
              return keysEqual;
            }];
        return custodyBorrow == AncPrivateVaultCustodyRepositoryStatusOK &&
               keysEqual;
      }];
      tuple = tuple &&
              status == AncPrivateVaultRotationPreparationStoreStatusOK &&
              custodyBorrow == AncPrivateVaultCustodyRepositoryStatusOK &&
              keysEqual;
    }
    AncPrivateVaultCustodyRepositoryStatus custodyClosed =
        custodyHandle == nil ? AncPrivateVaultCustodyRepositoryStatusInvalid
                             : [custodyHandle close];
    AncPrivateVaultRotationPreparationStoreStatus preparationClosed =
        [preparationHandle close];
    if (!tuple || custodyClosed != AncPrivateVaultCustodyRepositoryStatusOK ||
        preparationClosed !=
            AncPrivateVaultRotationPreparationStoreStatusOK) {
      anc_pv_custody_snapshot_zero(&custody);
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      status = custodyClosed != AncPrivateVaultCustodyRepositoryStatusOK ||
                       preparationClosed !=
                           AncPrivateVaultRotationPreparationStoreStatusOK
                   ? AncPrivateVaultRotationPreparationStoreStatusInaccessible
                   : AncPrivateVaultRotationPreparationStoreStatusConflict;
      return;
    }
    anc_pv_custody_snapshot_zero(&custody);

    if (preparation.phase == ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED) {
      result = expected;
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      status = AncPrivateVaultRotationPreparationStoreStatusOK;
      return;
    }
    preparation.phase = ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED;
    uint8_t zeroKey[ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES] = {0};
    AncPrivateVaultGuardedRecord *candidate =
        [self encodeSnapshot:&preparation keyHandle:nil directKey:zeroKey];
    anc_pv_zeroize(zeroKey, sizeof zeroKey);
    if (candidate == nil) {
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      status = AncPrivateVaultRotationPreparationStoreStatusInaccessible;
      return;
    }
    status = [self commitCandidate:candidate
                           vaultId:vaultId
                expectedCheckpoint:expected
                     allowCreation:NO
                     outCheckpoint:&result];
    AncRotationPreparationClearRecord(candidate);
    anc_pv_rotation_preparation_snapshot_zero(&preparation);
  });
  if (checkpoint != NULL &&
      status == AncPrivateVaultRotationPreparationStoreStatusOK)
    *checkpoint = result;
  return status;
}

- (AncPrivateVaultRotationPreparationStoreStatus)
    borrowConsumedHostedAppendVaultId:(const uint8_t[16])vaultId
                       authorityStore:
                           (AncPrivateVaultAuthorityStore *)authorityStore
                    custodyRepository:
                        (AncPrivateVaultCustodyRepository *)custodyRepository
                              consumer:
                                  (AncPrivateVaultConsumedHostedAppendConsumer)
                                      consumer {
  if (vaultId == NULL || consumer == nil ||
      object_getClass(self) != AncPrivateVaultRotationPreparationStore.class ||
      object_getClass(authorityStore) != AncPrivateVaultAuthorityStore.class ||
      object_getClass(custodyRepository) !=
          AncPrivateVaultCustodyRepository.class ||
      AncRotationPreparationInBorrowScope())
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;

  __block AncPrivateVaultRotationPreparationStoreStatus status;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGuardedRecord *record ANC_ROTATION_GUARDED_LOCAL = nil;
    NSData *digest = nil;
    uint64_t generation = 0;
    AncPrivateVaultRotationPreparationSnapshot preparation;
    AncPrivateVaultRotationPreparationKeyHandle *preparationHandle = nil;
    status = [self reconcileVaultId:vaultId
                             record:&record
                           snapshot:&preparation
                             handle:&preparationHandle
                    fenceGeneration:&generation
                             digest:&digest];
    if (status != AncPrivateVaultRotationPreparationStoreStatusOK)
      return;
    if (preparation.phase != ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED) {
      [preparationHandle close];
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      status = AncPrivateVaultRotationPreparationStoreStatusConflict;
      return;
    }

    NSString *vaultHex = AncRotationPreparationHex(
        vaultId, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
    NSString *endpointId = AncRotationPreparationHex(
        preparation.endpoint_id, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
    NSString *ceremonyId = AncRotationPreparationHex(
        preparation.ceremony_id, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
    AncPrivateVaultAuthorityCheckpoint *authority = nil;
    NSError *authorityError = nil;
    AncPrivateVaultAuthorityStoreStatus authorityStatus =
        [authorityStore loadVaultId:vaultHex
                         checkpoint:&authority
                              error:&authorityError];
    AncPrivateVaultCustodySnapshot custody = {0};
    AncPrivateVaultCustodyHandle *custodyHandle = nil;
    AncPrivateVaultCustodyRepositoryStatus custodyStatus =
        [custodyRepository readVaultId:vaultHex
                              snapshot:&custody
                                handle:&custodyHandle];
    BOOL tuple = vaultHex != nil && endpointId != nil && ceremonyId != nil &&
                 authorityStatus == AncPrivateVaultAuthorityStoreStatusOK &&
                 authorityError == nil && authority != nil &&
                 custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
                 custodyHandle != nil &&
                 AncPrivateVaultRotationPreparationOfficialTupleValid(
                     &preparation, vaultHex, authority, &custody);
    __block BOOL artifactsBound = NO;
    __block BOOL consumed = NO;
    __block AncPrivateVaultRotationPreparationSpoolStatus spoolStatus =
        AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
    if (tuple) {
      NSData *signingPublicKey =
          [NSData dataWithBytes:custody.signing_public_key length:32];
      custodyStatus = [custodyHandle
          borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
        spoolStatus = [self.spool
                readLiveVaultId:vaultId
                     ceremonyId:preparation.ceremony_id
      expectedSignedEntryLength:preparation.signed_entry_length
     expectedRecoveryWrapLength:preparation.recovery_wrap_length
            expectedFrameDigest:preparation.encrypted_spool_digest
                     pendingKey:secrets->active_epoch_key
                       consumer:^BOOL(const uint8_t *signedEntry,
                                      size_t signedEntryLength,
                                      const uint8_t *recoveryWrap,
                                      size_t recoveryWrapLength) {
          NSData *signedData =
              [NSData dataWithBytesNoCopy:(void *)signedEntry
                                   length:signedEntryLength
                             freeWhenDone:NO];
          NSData *wrapData =
              [NSData dataWithBytesNoCopy:(void *)recoveryWrap
                                   length:recoveryWrapLength
                             freeWhenDone:NO];
          NSData *entryHash =
              AncPrivateVaultControlLogSignedEntryDomainHash(signedData);
          NSString *signer =
              AncPrivateVaultControlLogSignedEntrySignerEndpointId(signedData);
          AncPrivateVaultControlLogState *officialState =
              AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(
                  authority);
          NSData *wrapHash = nil;
          NSString *wrapCeremony = nil;
          artifactsBound =
              officialState != nil && entryHash.length == 32 &&
              [entryHash isEqualToData:authority.snapshot.headHash] &&
              [signer isEqualToString:endpointId] &&
              AncPrivateVaultRecoveryWrapVerifyCommittedSuccessor(
                  wrapData, officialState, authority.snapshot.verifiedAtMs,
                  &wrapHash, &wrapCeremony) &&
              [wrapHash
                  isEqualToData:authority.snapshot.recoveryWrapHash] &&
              [wrapCeremony isEqualToString:ceremonyId];
          if (artifactsBound)
            consumed = consumer(vaultHex, endpointId, signedEntry,
                                signedEntryLength, recoveryWrap,
                                recoveryWrapLength, secrets->signing_seed,
                                signingPublicKey);
          return artifactsBound && consumed;
        }
                          error:nil];
        return spoolStatus ==
                   AncPrivateVaultRotationPreparationSpoolStatusOK &&
               artifactsBound && consumed;
      }];
      tuple = custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
              spoolStatus ==
                  AncPrivateVaultRotationPreparationSpoolStatusOK &&
              artifactsBound && consumed;
    }
    AncPrivateVaultCustodyRepositoryStatus custodyClosed =
        custodyHandle == nil ? AncPrivateVaultCustodyRepositoryStatusInvalid
                             : [custodyHandle close];
    AncPrivateVaultRotationPreparationStoreStatus preparationClosed =
        [preparationHandle close];
    anc_pv_custody_snapshot_zero(&custody);
    anc_pv_rotation_preparation_snapshot_zero(&preparation);
    if (custodyClosed != AncPrivateVaultCustodyRepositoryStatusOK ||
        preparationClosed !=
            AncPrivateVaultRotationPreparationStoreStatusOK) {
      status = AncPrivateVaultRotationPreparationStoreStatusInaccessible;
    } else if (!tuple) {
      status = spoolStatus ==
                       AncPrivateVaultRotationPreparationSpoolStatusNotFound
                   ? AncPrivateVaultRotationPreparationStoreStatusRollbackDetected
                   : AncPrivateVaultRotationPreparationStoreStatusConflict;
    } else {
      status = AncPrivateVaultRotationPreparationStoreStatusOK;
    }
  });
  return status;
}

- (AncPrivateVaultRotationPreparationStoreStatus)
    cleanConsumedVaultId:(const uint8_t[16])vaultId
                  receipt:(NSData *)receiptBytes
                 authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
              custodyRepository:
                  (AncPrivateVaultCustodyRepository *)custodyRepository
                     checkpoint:
                         (AncPrivateVaultRotationPreparationCheckpoint **)checkpoint {
  if (checkpoint != NULL)
    *checkpoint = nil;
  NSData *canonicalReceipt = [receiptBytes copy];
  AncPrivateVaultRotationAppendReceipt *receipt =
      AncPrivateVaultRotationAppendReceiptDecode(canonicalReceipt);
  if (vaultId == NULL || canonicalReceipt == nil || receipt == nil ||
      object_getClass(self) != AncPrivateVaultRotationPreparationStore.class ||
      object_getClass(authorityStore) != AncPrivateVaultAuthorityStore.class ||
      object_getClass(custodyRepository) !=
          AncPrivateVaultCustodyRepository.class ||
      AncRotationPreparationInBorrowScope())
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;

  __block AncPrivateVaultRotationPreparationStoreStatus status;
  __block AncPrivateVaultRotationPreparationCheckpoint *result = nil;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGuardedRecord *record ANC_ROTATION_GUARDED_LOCAL = nil;
    NSData *digest = nil;
    uint64_t generation = 0;
    AncPrivateVaultRotationPreparationSnapshot preparation;
    AncPrivateVaultRotationPreparationKeyHandle *preparationHandle = nil;
    status = [self reconcileVaultId:vaultId
                             record:&record
                           snapshot:&preparation
                             handle:&preparationHandle
                    fenceGeneration:&generation
                             digest:&digest];
    if (status != AncPrivateVaultRotationPreparationStoreStatusOK)
      return;
    AncPrivateVaultRotationPreparationCheckpoint *expected =
        [[AncPrivateVaultRotationPreparationCheckpoint alloc]
            initWithFenceGeneration:generation
                       recordDigest:digest
                           snapshot:&preparation];
    if (preparation.phase != ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED &&
        preparation.phase != ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED) {
      [preparationHandle close];
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      status = AncPrivateVaultRotationPreparationStoreStatusConflict;
      return;
    }

    NSString *vaultHex = AncRotationPreparationHex(
        vaultId, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
    if (![receipt.vaultId isEqualToString:vaultHex]) {
      [preparationHandle close];
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      status = AncPrivateVaultRotationPreparationStoreStatusConflict;
      return;
    }
    AncPrivateVaultAuthorityCheckpoint *authority = nil;
    NSError *authorityError = nil;
    AncPrivateVaultAuthorityStoreStatus authorityStatus =
        [authorityStore loadVaultId:vaultHex
                         checkpoint:&authority
                              error:&authorityError];
    AncPrivateVaultCustodySnapshot custody = {0};
    AncPrivateVaultCustodyHandle *custodyHandle = nil;
    AncPrivateVaultCustodyRepositoryStatus custodyStatus =
        [custodyRepository readVaultId:vaultHex
                              snapshot:&custody
                                handle:&custodyHandle];
    AncPrivateVaultRotationPreparationSnapshot tuplePreparation = preparation;
    if (tuplePreparation.phase == ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED) {
      tuplePreparation.flags =
          ANC_PV_ROTATION_PREPARATION_FLAG_EDGE_BOUND |
          ANC_PV_ROTATION_PREPARATION_FLAG_SPOOL_DURABLE;
      tuplePreparation.pending_epoch = tuplePreparation.base_epoch + 1;
      tuplePreparation.expected_sequence = tuplePreparation.base_sequence + 1;
      memcpy(tuplePreparation.expected_previous_head,
             tuplePreparation.base_head, ANC_PV_HASH_BYTES);
      if (authority != nil && authority.snapshot.membershipHash.length == 32)
        memcpy(tuplePreparation.transcript_digest,
               authority.snapshot.membershipHash.bytes, ANC_PV_HASH_BYTES);
    }
    BOOL tuple = authorityStatus == AncPrivateVaultAuthorityStoreStatusOK &&
                 authorityError == nil && authority != nil &&
                 custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
                 custodyHandle != nil &&
                 authority.snapshot.sequence == receipt.sequence &&
                 [authority.snapshot.headHash isEqualToData:receipt.headHash] &&
                 [authority.snapshot.recoveryWrapHash
                     isEqualToData:receipt.recoveryWrapHash] &&
                 (preparation.phase ==
                          ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED ||
                  preparation.recovery_wrap_length ==
                      receipt.recoveryWrapByteLength) &&
                 AncPrivateVaultRotationPreparationOfficialTupleValid(
                     &tuplePreparation, vaultHex, authority, &custody);
    anc_pv_rotation_preparation_snapshot_zero(&tuplePreparation);
    __block AncPrivateVaultRotationPreparationStoreStatus receiptFenceStatus =
        AncPrivateVaultRotationPreparationStoreStatusConflict;
    if (tuple &&
        preparation.phase == ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED) {
      NSString *preparationCeremony = AncRotationPreparationHex(
          preparation.ceremony_id,
          ANC_PV_ROTATION_PREPARATION_ID_BYTES);
      __block BOOL artifactsBound = NO;
      __block AncPrivateVaultRotationPreparationSpoolStatus spoolStatus =
          AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
      AncPrivateVaultCustodyRepositoryStatus borrowed = [custodyHandle
          borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
        spoolStatus = [self.spool
                readLiveVaultId:vaultId
                     ceremonyId:preparation.ceremony_id
      expectedSignedEntryLength:preparation.signed_entry_length
     expectedRecoveryWrapLength:preparation.recovery_wrap_length
            expectedFrameDigest:preparation.encrypted_spool_digest
                     pendingKey:secrets->active_epoch_key
                       consumer:^BOOL(const uint8_t *signedEntry,
                                      size_t signedEntryLength,
                                      const uint8_t *recoveryWrap,
                                      size_t recoveryWrapLength) {
          NSData *signedData =
              [NSData dataWithBytesNoCopy:(void *)signedEntry
                                   length:signedEntryLength
                             freeWhenDone:NO];
          NSData *wrapData =
              [NSData dataWithBytesNoCopy:(void *)recoveryWrap
                                   length:recoveryWrapLength
                             freeWhenDone:NO];
          NSData *entryHash =
              AncPrivateVaultControlLogSignedEntryDomainHash(signedData);
          NSString *entryId =
              AncPrivateVaultControlLogSignedEntryEnvelopeId(signedData);
          AncPrivateVaultControlLogState *officialState =
              AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(
                  authority);
          NSData *wrapHash = nil;
          NSString *wrapCeremony = nil;
          artifactsBound =
              officialState != nil && entryHash.length == 32 &&
              [entryHash isEqualToData:receipt.headHash] &&
              [entryId isEqualToString:receipt.entryId] &&
              recoveryWrapLength == receipt.recoveryWrapByteLength &&
              AncPrivateVaultRecoveryWrapVerifyCommittedSuccessor(
                  wrapData, officialState, authority.snapshot.verifiedAtMs,
                  &wrapHash, &wrapCeremony) &&
              [wrapHash
                  isEqualToData:receipt.recoveryWrapHash] &&
              [wrapCeremony isEqualToString:preparationCeremony];
          return artifactsBound;
        }
                          error:nil];
        return (spoolStatus ==
                    AncPrivateVaultRotationPreparationSpoolStatusOK &&
                artifactsBound) ||
               spoolStatus ==
                   AncPrivateVaultRotationPreparationSpoolStatusNotFound;
      }];
      if (borrowed == AncPrivateVaultCustodyRepositoryStatusOK &&
          spoolStatus == AncPrivateVaultRotationPreparationSpoolStatusOK &&
          artifactsBound) {
        receiptFenceStatus = AncRotationPreparationPersistCleanupReceipt(
            self.keychain, vaultHex, canonicalReceipt);
      } else if (borrowed == AncPrivateVaultCustodyRepositoryStatusOK &&
                 spoolStatus ==
                     AncPrivateVaultRotationPreparationSpoolStatusNotFound) {
        NSData *storedReceipt = nil;
        receiptFenceStatus = AncRotationPreparationReadCleanupReceipt(
            self.keychain, vaultHex, &storedReceipt);
        if (receiptFenceStatus ==
            AncPrivateVaultRotationPreparationStoreStatusNotFound)
          receiptFenceStatus =
              AncPrivateVaultRotationPreparationStoreStatusRollbackDetected;
        else if (receiptFenceStatus ==
                AncPrivateVaultRotationPreparationStoreStatusOK &&
            ![storedReceipt isEqualToData:canonicalReceipt])
          receiptFenceStatus =
              AncPrivateVaultRotationPreparationStoreStatusConflict;
      }
      tuple = receiptFenceStatus ==
              AncPrivateVaultRotationPreparationStoreStatusOK;
    } else if (tuple && preparation.phase ==
                            ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED) {
      NSData *storedReceipt = nil;
      receiptFenceStatus = AncRotationPreparationReadCleanupReceipt(
          self.keychain, vaultHex, &storedReceipt);
      if (receiptFenceStatus ==
          AncPrivateVaultRotationPreparationStoreStatusNotFound)
        receiptFenceStatus =
            AncPrivateVaultRotationPreparationStoreStatusRollbackDetected;
      tuple = receiptFenceStatus ==
                  AncPrivateVaultRotationPreparationStoreStatusOK &&
              [storedReceipt isEqualToData:canonicalReceipt];
    }
    AncPrivateVaultCustodyRepositoryStatus custodyClosed =
        custodyHandle == nil ? AncPrivateVaultCustodyRepositoryStatusInvalid
                             : [custodyHandle close];
    AncPrivateVaultRotationPreparationStoreStatus preparationClosed =
        [preparationHandle close];
    if (!tuple ||
        custodyClosed != AncPrivateVaultCustodyRepositoryStatusOK ||
        preparationClosed !=
            AncPrivateVaultRotationPreparationStoreStatusOK) {
      anc_pv_custody_snapshot_zero(&custody);
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      status = custodyClosed != AncPrivateVaultCustodyRepositoryStatusOK ||
                       preparationClosed !=
                           AncPrivateVaultRotationPreparationStoreStatusOK
                   ? AncPrivateVaultRotationPreparationStoreStatusInaccessible
                   : receiptFenceStatus !=
                             AncPrivateVaultRotationPreparationStoreStatusConflict
                         ? receiptFenceStatus
                         : AncPrivateVaultRotationPreparationStoreStatusConflict;
      return;
    }
    anc_pv_custody_snapshot_zero(&custody);

    if (preparation.phase == ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED) {
      result = expected;
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      status = AncPrivateVaultRotationPreparationStoreStatusOK;
      return;
    }

    if (AncRotationPreparationFault(
            AncPrivateVaultRotationPreparationStoreFaultAfterCleanupReceiptPersist)) {
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      status = AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
      return;
    }

    AncPrivateVaultRotationPreparationSpoolStatus deleted =
        [self.spool deleteVaultId:vaultId
                       ceremonyId:preparation.ceremony_id
                            error:nil];
    if (deleted != AncPrivateVaultRotationPreparationSpoolStatusOK) {
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      status = AncRotationPreparationStatusForSpool(deleted, NO);
      return;
    }
    if (AncRotationPreparationFault(
            AncPrivateVaultRotationPreparationStoreFaultAfterSpoolDelete)) {
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      status = AncPrivateVaultRotationPreparationStoreStatusStorageFailed;
      return;
    }

    preparation.phase = ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED;
    preparation.flags = 0;
    memset((uint8_t *)&preparation +
               offsetof(AncPrivateVaultRotationPreparationSnapshot,
                        pending_epoch),
           0,
           sizeof preparation -
               offsetof(AncPrivateVaultRotationPreparationSnapshot,
                        pending_epoch));
    uint8_t zeroKey[ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES] = {0};
    AncPrivateVaultGuardedRecord *candidate =
        [self encodeSnapshot:&preparation keyHandle:nil directKey:zeroKey];
    anc_pv_zeroize(zeroKey, sizeof zeroKey);
    if (candidate == nil) {
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      status = AncPrivateVaultRotationPreparationStoreStatusInaccessible;
      return;
    }
    status = [self commitCandidate:candidate
                           vaultId:vaultId
                expectedCheckpoint:expected
                     allowCreation:NO
                     outCheckpoint:&result];
    AncRotationPreparationClearRecord(candidate);
    anc_pv_rotation_preparation_snapshot_zero(&preparation);
  });
  if (checkpoint != NULL &&
      status == AncPrivateVaultRotationPreparationStoreStatusOK)
    *checkpoint = result;
  return status;
}

- (AncPrivateVaultRotationPreparationStoreStatus)
    recoverPersistedHostedAppendReceiptVaultId:(const uint8_t[16])vaultId
                                authorityStore:
                                    (AncPrivateVaultAuthorityStore *)
                                        authorityStore
                             custodyRepository:
                                 (AncPrivateVaultCustodyRepository *)
                                     custodyRepository
                                    checkpoint:
                                        (AncPrivateVaultRotationPreparationCheckpoint **)
                                            checkpoint {
  if (checkpoint != NULL)
    *checkpoint = nil;
  if (vaultId == NULL ||
      object_getClass(self) != AncPrivateVaultRotationPreparationStore.class ||
      object_getClass(authorityStore) != AncPrivateVaultAuthorityStore.class ||
      object_getClass(custodyRepository) !=
          AncPrivateVaultCustodyRepository.class ||
      AncRotationPreparationInBorrowScope())
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  NSString *vaultHex = AncRotationPreparationHex(
      vaultId, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
  if (vaultHex.length != 32)
    return AncPrivateVaultRotationPreparationStoreStatusInvalid;
  NSData *receipt = nil;
  AncPrivateVaultRotationPreparationStoreStatus read =
      AncRotationPreparationReadCleanupReceipt(self.keychain, vaultHex,
                                               &receipt);
  if (read != AncPrivateVaultRotationPreparationStoreStatusOK)
    return read;
  AncPrivateVaultRotationAppendReceipt *decoded =
      AncPrivateVaultRotationAppendReceiptDecode(receipt);
  if (decoded == nil)
    return AncPrivateVaultRotationPreparationStoreStatusCorrupt;
  if (![decoded.vaultId isEqualToString:vaultHex])
    return AncPrivateVaultRotationPreparationStoreStatusConflict;
  AncPrivateVaultRotationPreparationCheckpoint *current = nil;
  read = [self readVaultId:vaultId checkpoint:&current handle:nil];
  if (read != AncPrivateVaultRotationPreparationStoreStatusOK || current == nil)
    return read == AncPrivateVaultRotationPreparationStoreStatusOK
               ? AncPrivateVaultRotationPreparationStoreStatusCorrupt
               : read;
  AncPrivateVaultRotationPreparationSnapshot snapshot = current.snapshot;
  if (snapshot.phase ==
          ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT ||
      snapshot.phase == ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED) {
    if (decoded.sequence < snapshot.expected_sequence)
      return AncPrivateVaultRotationPreparationStoreStatusNotFound;
    if (decoded.sequence > snapshot.expected_sequence)
      return AncPrivateVaultRotationPreparationStoreStatusConflict;
  } else if (snapshot.phase == ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED) {
    if (snapshot.base_sequence == UINT64_MAX ||
        decoded.sequence != snapshot.base_sequence + 1)
      return AncPrivateVaultRotationPreparationStoreStatusConflict;
  } else {
    return AncPrivateVaultRotationPreparationStoreStatusNotFound;
  }
  return [self cleanConsumedVaultId:vaultId
                            receipt:receipt
                     authorityStore:authorityStore
                  custodyRepository:custodyRepository
                         checkpoint:checkpoint];
}

@end
