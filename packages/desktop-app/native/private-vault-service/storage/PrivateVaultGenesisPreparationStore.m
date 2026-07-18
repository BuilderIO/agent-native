#import "PrivateVaultGenesisPreparationStore.h"
#import "PrivateVaultGenesisPreparationStoreInternal.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultAuthorityStoreInternal.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultControlLogInternal.h"
#import "PrivateVaultCustodyRepositoryGenesisInternal.h"
#import "PrivateVaultGenesisAuthorization.h"
#import "PrivateVaultGenesisAuthorizationInternal.h"
#import "PrivateVaultGenesisBootstrap.h"
#import "PrivateVaultGenesisBuilder.h"
#import "PrivateVaultGenesisHostedAppend.h"
#import "PrivateVaultRecoveryWrap.h"

#import <objc/runtime.h>

NSString *const AncPrivateVaultGenesisPreparationRecordId =
    @"genesis-preparation";

static const char kAncGenesisPreparationDigestDomain[] =
    "anc/v1/private-vault/genesis-preparation-record/fence";
static const char kAncGenesisCleanupReceiptDigestDomain[] =
    "anc/v1/genesis-hosted-append-receipt";
static NSString *const kAncGenesisCleanupReceiptRecordId =
    @"genesis-cleanup-receipt";
static const uint64_t kAncGenesisMaximumSafeInteger =
    UINT64_C(9007199254740991);
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

typedef AncPrivateVaultGenesisPreparationStoreStatus (
    ^AncGenesisConstructedTransition)(
        const AncPrivateVaultGenesisPreparationSnapshot *current,
        AncPrivateVaultGenesisPreparationSnapshot *next, BOOL *shouldCommit,
        BOOL *terminalizeSecrets);

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

static AncPrivateVaultGenesisPreparationStoreStatus AncGenesisCustodyStatus(
    AncPrivateVaultCustodyRepositoryStatus status) {
  switch (status) {
  case AncPrivateVaultCustodyRepositoryStatusOK:
    return AncPrivateVaultGenesisPreparationStoreStatusOK;
  case AncPrivateVaultCustodyRepositoryStatusNotFound:
    return AncPrivateVaultGenesisPreparationStoreStatusNotFound;
  case AncPrivateVaultCustodyRepositoryStatusInvalid:
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  case AncPrivateVaultCustodyRepositoryStatusConflict:
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  case AncPrivateVaultCustodyRepositoryStatusRollbackDetected:
    return AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected;
  case AncPrivateVaultCustodyRepositoryStatusCorrupt:
    return AncPrivateVaultGenesisPreparationStoreStatusCorrupt;
  case AncPrivateVaultCustodyRepositoryStatusInaccessible:
    return AncPrivateVaultGenesisPreparationStoreStatusInaccessible;
  case AncPrivateVaultCustodyRepositoryStatusFailed:
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  }
}

static AncPrivateVaultGenesisPreparationStoreStatus AncGenesisAuthorityStatus(
    AncPrivateVaultAuthorityStoreStatus status) {
  switch (status) {
  case AncPrivateVaultAuthorityStoreStatusOK:
    return AncPrivateVaultGenesisPreparationStoreStatusOK;
  case AncPrivateVaultAuthorityStoreStatusNotFound:
  case AncPrivateVaultAuthorityStoreStatusRemoved:
    return AncPrivateVaultGenesisPreparationStoreStatusNotFound;
  case AncPrivateVaultAuthorityStoreStatusInvalid:
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  case AncPrivateVaultAuthorityStoreStatusConflict:
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  case AncPrivateVaultAuthorityStoreStatusRollbackDetected:
    return AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected;
  case AncPrivateVaultAuthorityStoreStatusCorrupt:
    return AncPrivateVaultGenesisPreparationStoreStatusCorrupt;
  case AncPrivateVaultAuthorityStoreStatusProtectionFailed:
    return AncPrivateVaultGenesisPreparationStoreStatusInaccessible;
  case AncPrivateVaultAuthorityStoreStatusStorageFailed:
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

static NSData *AncGenesisCleanupReceiptDigest(NSData *receipt) {
  if (![receipt isKindOfClass:NSData.class] || receipt.length == 0 ||
      receipt.length > 1024)
    return nil;
  uint8_t digest[32] = {0};
  BOOL okay = anc_pv_blake2b_256_two_part(
                  digest,
                  (const uint8_t *)kAncGenesisCleanupReceiptDigestDomain,
                  sizeof kAncGenesisCleanupReceiptDigestDomain, receipt.bytes,
                  receipt.length) == ANC_PV_CRYPTO_OK;
  NSData *result =
      okay ? [NSData dataWithBytes:digest length:sizeof digest] : nil;
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static AncPrivateVaultGenesisPreparationStoreStatus
AncGenesisReadCleanupReceipt(AncPrivateVaultKeychain *keychain,
                             NSString *vaultId, NSData **receipt) {
  if (receipt != NULL)
    *receipt = nil;
  NSData *stored = nil;
  AncPrivateVaultKeychainStatus status = [keychain
      copyDataForService:AncPrivateVaultGenesisCleanupReceiptService
                 vaultId:vaultId
                recordId:kAncGenesisCleanupReceiptRecordId
                    data:&stored];
  if (status != AncPrivateVaultKeychainStatusOK)
    return AncGenesisKeychainStatus(status);
  AncPrivateVaultGenesisHostedAppendReceipt *decoded =
      AncPrivateVaultGenesisHostedAppendReceiptDecode(stored);
  if (decoded == nil || ![decoded.vaultId isEqualToString:vaultId])
    return AncPrivateVaultGenesisPreparationStoreStatusCorrupt;
  if (receipt != NULL)
    *receipt = stored;
  return AncPrivateVaultGenesisPreparationStoreStatusOK;
}

static AncPrivateVaultGenesisPreparationStoreStatus
AncGenesisPersistCleanupReceipt(AncPrivateVaultKeychain *keychain,
                                NSString *vaultId, NSData *receipt) {
  NSData *stored = nil;
  AncPrivateVaultGenesisPreparationStoreStatus read =
      AncGenesisReadCleanupReceipt(keychain, vaultId, &stored);
  if (read == AncPrivateVaultGenesisPreparationStoreStatusOK)
    return [stored isEqualToData:receipt]
               ? AncPrivateVaultGenesisPreparationStoreStatusOK
               : AncPrivateVaultGenesisPreparationStoreStatusConflict;
  if (read != AncPrivateVaultGenesisPreparationStoreStatusNotFound)
    return read;
  AncPrivateVaultKeychainStatus write =
      [keychain addData:receipt
             forService:AncPrivateVaultGenesisCleanupReceiptService
                vaultId:vaultId
               recordId:kAncGenesisCleanupReceiptRecordId];
  if (write != AncPrivateVaultKeychainStatusOK)
    return AncGenesisKeychainStatus(write);
  stored = nil;
  AncPrivateVaultGenesisPreparationStoreStatus verified =
      AncGenesisReadCleanupReceipt(keychain, vaultId, &stored);
  if (verified != AncPrivateVaultGenesisPreparationStoreStatusOK)
    return verified;
  return [stored isEqualToData:receipt]
             ? AncPrivateVaultGenesisPreparationStoreStatusOK
             : AncPrivateVaultGenesisPreparationStoreStatusConflict;
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

static NSData *AncGenesisPublicBytes(const uint8_t *bytes, size_t length) {
  return bytes == NULL || length == 0
             ? nil
             : [[NSData alloc] initWithBytes:bytes length:length];
}

static NSData *AncGenesisOwningData(NSData *value, NSUInteger maximumLength) {
  @try {
    if (![value isKindOfClass:NSData.class] || value.length == 0 ||
        value.length > maximumLength)
      return nil;
    NSUInteger length = value.length;
    NSMutableData *copy = [NSMutableData dataWithLength:length];
    [value getBytes:copy.mutableBytes length:length];
    return value.length == length ? [NSData dataWithData:copy] : nil;
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

static NSString *AncGenesisHex(const uint8_t *bytes, size_t length) {
  if (bytes == NULL || length == 0)
    return nil;
  static const char digits[] = "0123456789abcdef";
  char *encoded = calloc(length * 2 + 1, 1);
  if (encoded == NULL)
    return nil;
  for (size_t index = 0; index < length; index++) {
    encoded[index * 2] = digits[bytes[index] >> 4];
    encoded[index * 2 + 1] = digits[bytes[index] & 15];
  }
  NSString *result = [[NSString alloc] initWithBytes:encoded
                                               length:length * 2
                                             encoding:NSASCIIStringEncoding];
  anc_pv_zeroize(encoded, length * 2 + 1);
  free(encoded);
  return result;
}

static BOOL AncGenesisIdentifierBytesEqual(const uint8_t *bytes,
                                           size_t length,
                                           NSString *expected) {
  if (bytes == NULL || length == 0 || expected == nil)
    return NO;
  NSData *encoded = [expected dataUsingEncoding:NSASCIIStringEncoding];
  return encoded.length == length &&
         anc_pv_memcmp(bytes, encoded.bytes, length) == ANC_PV_CRYPTO_OK;
}

static NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *
AncGenesisCanonicalMap(NSData *encoded, NSUInteger maximumLength) {
  if (encoded == nil || encoded.length == 0 || encoded.length > maximumLength)
    return nil;
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root =
      AncPrivateVaultCanonicalDecode(encoded, maximumLength, &status);
  return status == AncPrivateVaultCanonicalStatusOK &&
                 root.type == AncPrivateVaultCanonicalTypeMap
             ? root.mapValue
             : nil;
}

static NSData *AncGenesisMapBytes(
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map,
    NSNumber *key, NSUInteger length) {
  AncPrivateVaultCanonicalValue *value = map[key];
  return value.type == AncPrivateVaultCanonicalTypeBytes &&
                 (length == NSNotFound || value.bytesValue.length == length)
             ? value.bytesValue
             : nil;
}

static BOOL AncGenesisMapInteger(
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map,
    NSNumber *key, uint64_t *output) {
  AncPrivateVaultCanonicalValue *value = map[key];
  if (value.type != AncPrivateVaultCanonicalTypeInteger ||
      value.integerValue < 0 || output == NULL)
    return NO;
  *output = (uint64_t)value.integerValue;
  return YES;
}

static BOOL AncGenesisLogTimestampSeconds(NSString *timestamp,
                                          uint64_t *seconds) {
  if (![timestamp isKindOfClass:NSString.class] || seconds == NULL)
    return NO;
  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  formatter.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                            NSISO8601DateFormatWithFractionalSeconds;
  NSDate *date = [formatter dateFromString:timestamp];
  NSTimeInterval value = date.timeIntervalSince1970;
  if (date == nil || value < 1 || value > (NSTimeInterval)UINT64_MAX)
    return NO;
  uint64_t integral = (uint64_t)value;
  if ((NSTimeInterval)integral != value)
    return NO;
  *seconds = integral;
  return YES;
}

static BOOL AncGenesisSnapshotPublicEqual(
    const AncPrivateVaultGenesisPreparationSnapshot *left,
    const AncPrivateVaultGenesisPreparationSnapshot *right) {
  return left != NULL && right != NULL &&
         memcmp(left, right, sizeof *left) == 0;
}

static BOOL AncGenesisDataEqualsBytes(NSData *value, const uint8_t *bytes,
                                      size_t length) {
  return value.length == length &&
         anc_pv_memcmp(value.bytes, bytes, length) == ANC_PV_CRYPTO_OK;
}

@interface AncGenesisConfirmedEvidence : NSObject
@property(nonatomic) NSData *recoveryWrap;
@property(nonatomic) NSData *confirmation;
@property(nonatomic) NSData *bootstrap;
@property(nonatomic) NSData *authorization;
@property(nonatomic) NSData *recoveryWrapHash;
@property(nonatomic) NSData *confirmationHash;
@property(nonatomic) NSData *bootstrapDigest;
@property(nonatomic) NSData *authorizationDigest;
@property(nonatomic) NSData *controlHeadHash;
@property(nonatomic) NSData *membershipHash;
@property(nonatomic) uint64_t wrapCreatedAt;
@property(nonatomic) uint64_t endpointCreatedAt;
@property(nonatomic) uint64_t logCreatedAt;
@property(nonatomic) uint64_t authorizationCreatedAt;
@end
@implementation AncGenesisConfirmedEvidence
@end

static BOOL AncGenesisEvidenceBindingsMatch(
    const AncPrivateVaultGenesisPreparationSnapshot *snapshot,
    AncGenesisConfirmedEvidence *evidence, uint64_t confirmedAtMs) {
  return snapshot != NULL && evidence != nil &&
         snapshot->confirmed_at_ms == confirmedAtMs &&
         snapshot->recovery_wrap_created_at_seconds == evidence.wrapCreatedAt &&
         snapshot->endpoint_created_at_seconds == evidence.endpointCreatedAt &&
         snapshot->log_entry_created_at_seconds == evidence.logCreatedAt &&
         snapshot->authorization_created_at_seconds ==
             evidence.authorizationCreatedAt &&
         AncGenesisDataEqualsBytes(evidence.recoveryWrapHash,
                                   snapshot->recovery_wrap_hash, 32) &&
         AncGenesisDataEqualsBytes(evidence.confirmationHash,
                                   snapshot->recovery_confirmation_hash, 32) &&
         AncGenesisDataEqualsBytes(evidence.bootstrapDigest,
                                   snapshot->bootstrap_transcript_digest, 32) &&
         AncGenesisDataEqualsBytes(evidence.authorizationDigest,
                                   snapshot->authorization_digest, 32) &&
         AncGenesisDataEqualsBytes(evidence.controlHeadHash,
                                   snapshot->genesis_control_head_hash, 32) &&
         AncGenesisDataEqualsBytes(evidence.membershipHash,
                                   snapshot->membership_hash, 32) &&
         snapshot->recovery_wrap_length == evidence.recoveryWrap.length &&
         snapshot->confirmation_length == evidence.confirmation.length &&
         snapshot->bootstrap_length == evidence.bootstrap.length &&
         snapshot->authorization_length == evidence.authorization.length;
}

static BOOL AncGenesisConfirmedSnapshotMatches(
    const AncPrivateVaultGenesisPreparationSnapshot *snapshot,
    AncGenesisConfirmedEvidence *evidence, uint64_t confirmedAtMs) {
  return snapshot != NULL &&
         snapshot->phase == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED &&
         snapshot->flags ==
             (ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND |
              ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) &&
         AncGenesisEvidenceBindingsMatch(snapshot, evidence, confirmedAtMs);
}

static AncGenesisConfirmedEvidence *AncGenesisVerifyConfirmedEvidenceBytes(
    NSData *wrapBytes, NSData *confirmationBytes, NSData *bootstrapBytes,
    NSData *authorizationBytes, NSData *declaredBootstrapDigest,
    uint64_t confirmedAtMs, AncPrivateVaultControlLog *controlLog,
    const AncPrivateVaultGenesisPreparationSnapshot *current) {
  if (controlLog == nil || current == NULL ||
      object_getClass(controlLog) != AncPrivateVaultControlLog.class ||
      confirmedAtMs == 0 || confirmedAtMs % 1000 != 0)
    return nil;
  wrapBytes = AncGenesisOwningData(
      wrapBytes,
      ANC_PV_GENESIS_PREPARATION_ARTIFACT_WRAP_MAX_BYTES);
  confirmationBytes = AncGenesisOwningData(
      confirmationBytes,
      ANC_PV_GENESIS_PREPARATION_ARTIFACT_CONFIRMATION_MAX_BYTES);
  bootstrapBytes = AncGenesisOwningData(
      bootstrapBytes,
      ANC_PV_GENESIS_PREPARATION_ARTIFACT_BOOTSTRAP_MAX_BYTES);
  authorizationBytes = AncGenesisOwningData(
      authorizationBytes,
      ANC_PV_GENESIS_PREPARATION_ARTIFACT_AUTHORIZATION_MAX_BYTES);
  declaredBootstrapDigest = AncGenesisOwningData(declaredBootstrapDigest, 32);
  NSData *vaultId = AncGenesisPublicBytes(current->vault_id, 16);
  if (wrapBytes == nil || confirmationBytes == nil || bootstrapBytes == nil ||
      authorizationBytes == nil || declaredBootstrapDigest.length != 32 ||
      vaultId.length != 16)
    return nil;

  AncPrivateVaultRecoveryWrapStatus wrapStatus;
  NSData *signingKey =
      AncGenesisPublicBytes(current->endpoint_signing_public_key, 32);
  AncPrivateVaultRecoveryWrap *wrap = AncPrivateVaultRecoveryWrapVerify(
      wrapBytes, vaultId, signingKey, &wrapStatus);
  NSData *wrapHash =
      AncPrivateVaultRecoveryWrapHash(wrapBytes, vaultId, &wrapStatus);
  AncPrivateVaultGenesisBootstrapStatus bootstrapStatus;
  AncPrivateVaultGenesisRecoveryConfirmation *confirmation =
      AncPrivateVaultGenesisRecoveryConfirmationDecode(
          confirmationBytes, vaultId, &bootstrapStatus);
  NSData *confirmationHash = AncPrivateVaultGenesisRecoveryConfirmationHash(
      confirmationBytes, vaultId, &bootstrapStatus);
  AncPrivateVaultGenesisBootstrapResult *bootstrap =
      AncPrivateVaultGenesisBootstrapVerify(
          bootstrapBytes, confirmationBytes, vaultId, &bootstrapStatus);
  if (wrap == nil || wrapHash.length != 32 || confirmation == nil ||
      confirmationHash.length != 32 || bootstrap == nil ||
      ![bootstrap.digest isEqualToData:declaredBootstrapDigest])
    return nil;

  AncPrivateVaultGenesisAuthorizationStatus authorizationStatus;
  AncPrivateVaultGenesisAuthorizationVerifier *verifier =
      [[AncPrivateVaultGenesisAuthorizationVerifier alloc]
          initWithAuthorization:authorizationBytes
           recoveryConfirmation:confirmationBytes
             bootstrapTranscript:bootstrapBytes
                  bootstrapResult:bootstrap
                          status:&authorizationStatus];
  if (verifier == nil)
    return nil;
  AncPrivateVaultGenesisAuthorizationStatus commitStatus;
  NSData *signedCommit = AncPrivateVaultGenesisAuthorizationCopySignedCommit(
      authorizationBytes, vaultId, &commitStatus);
  AncPrivateVaultControlLogReplayResult *replay = nil;
  AncPrivateVaultControlLogStatus replayStatus =
      [controlLog replaySignedEntry:signedCommit
                       currentState:nil
                           verifier:verifier
                             result:&replay];
  if (replayStatus != AncPrivateVaultControlLogStatusOK || replay == nil ||
      verifier.result == nil)
    return nil;

  NSData *evidenceVault = nil, *evidenceCeremony = nil,
         *evidenceEndpoint = nil, *evidenceSigning = nil,
         *evidenceAgreement = nil, *enrollment = nil, *evidenceRecovery = nil,
         *evidenceRecoverySigning = nil, *evidenceRecoveryAgreement = nil,
         *evidenceWrapHash = nil, *authorizationDigest = nil,
         *evidenceSignedCommit = nil, *evidenceBootstrapDigest = nil;
  if (!AncPrivateVaultGenesisAuthorizationResultCopyEvidence(
          verifier.result, &evidenceVault, &evidenceCeremony,
          &evidenceEndpoint, &evidenceSigning, &evidenceAgreement, &enrollment,
          &evidenceRecovery, &evidenceRecoverySigning,
          &evidenceRecoveryAgreement, &evidenceWrapHash, &authorizationDigest,
          &evidenceSignedCommit, &evidenceBootstrapDigest))
    return nil;

  NSDictionary *authorizationMap = AncGenesisCanonicalMap(
      authorizationBytes,
      ANC_PV_GENESIS_PREPARATION_ARTIFACT_AUTHORIZATION_MAX_BYTES);
  NSData *endpointBytes = AncGenesisMapBytes(authorizationMap, @373,
                                             NSNotFound);
  NSDictionary *endpointMap = AncGenesisCanonicalMap(endpointBytes, 64 * 1024);
  NSDictionary *commitMap = AncGenesisCanonicalMap(signedCommit, 64 * 1024);
  uint64_t authorizationCreatedAt = 0, endpointCreatedAt = 0,
           logCreatedAt = 0;
  AncPrivateVaultCanonicalValue *logTimestampValue = commitMap[@4];
  NSString *expectedVaultHex = AncGenesisHex(current->vault_id, 16);
  NSString *expectedEndpointHex = AncGenesisHex(current->endpoint_id, 16);
  NSString *expectedRecoveryHex = AncGenesisHex(current->recovery_id, 16);
  BOOL exact =
      authorizationMap != nil && endpointMap != nil && commitMap != nil &&
      AncGenesisMapInteger(authorizationMap, @4, &authorizationCreatedAt) &&
      AncGenesisMapInteger(endpointMap, @4, &endpointCreatedAt) &&
      logTimestampValue.type == AncPrivateVaultCanonicalTypeText &&
      AncGenesisLogTimestampSeconds(logTimestampValue.textValue,
                                    &logCreatedAt) &&
      [AncGenesisMapBytes(authorizationMap, @5, 16)
          isEqualToData:AncGenesisPublicBytes(
                            current->authorization_envelope_id, 16)] &&
      [AncGenesisMapBytes(endpointMap, @5, 16)
          isEqualToData:AncGenesisPublicBytes(current->endpoint_envelope_id,
                                              16)] &&
      [((AncPrivateVaultCanonicalValue *)commitMap[@5]).textValue
          isEqualToString:AncGenesisHex(current->log_entry_envelope_id, 16)] &&
      [evidenceVault isEqualToData:vaultId] &&
      AncGenesisDataEqualsBytes(evidenceCeremony, current->ceremony_id, 16) &&
      AncGenesisDataEqualsBytes(evidenceEndpoint, current->endpoint_id, 16) &&
      AncGenesisDataEqualsBytes(evidenceSigning,
                                current->endpoint_signing_public_key, 32) &&
      AncGenesisDataEqualsBytes(evidenceAgreement,
                                current->endpoint_agreement_public_key, 32) &&
      AncGenesisDataEqualsBytes(enrollment,
                                current->authorization_envelope_id, 16) &&
      AncGenesisDataEqualsBytes(evidenceRecovery, current->recovery_id, 16) &&
      AncGenesisDataEqualsBytes(evidenceRecoverySigning,
                                current->recovery_signing_public_key, 32) &&
      AncGenesisDataEqualsBytes(evidenceRecoveryAgreement,
                                current->recovery_agreement_public_key, 32) &&
      [evidenceWrapHash isEqualToData:wrapHash] &&
      [evidenceBootstrapDigest isEqualToData:bootstrap.digest] &&
      [evidenceSignedCommit isEqualToData:signedCommit] &&
      wrap.createdAt == confirmedAtMs / 1000 &&
      confirmation.confirmedAt == confirmedAtMs / 1000 &&
      endpointCreatedAt == confirmedAtMs / 1000 &&
      logCreatedAt == confirmedAtMs / 1000 &&
      authorizationCreatedAt == confirmedAtMs / 1000 &&
      AncGenesisDataEqualsBytes(wrap.envelopeId,
                                current->recovery_wrap_envelope_id, 16) &&
      AncGenesisDataEqualsBytes(wrap.ceremonyId, current->ceremony_id, 16) &&
      AncGenesisDataEqualsBytes(wrap.issuerEndpointId, current->endpoint_id,
                                16) &&
      AncGenesisDataEqualsBytes(wrap.nonce, current->recovery_wrap_nonce, 24) &&
      AncGenesisDataEqualsBytes(wrap.recoveryId, current->recovery_id, 16) &&
      AncGenesisDataEqualsBytes(wrap.recoveryKeyAgreementPublicKey,
                                current->recovery_agreement_public_key, 32) &&
      wrap.recoveryGeneration == 1 && wrap.epoch == 1 &&
      wrap.activationControlSequence == 0 &&
      AncGenesisDataEqualsBytes(confirmation.ceremonyId, current->ceremony_id,
                                16) &&
      AncGenesisDataEqualsBytes(confirmation.endpointId, current->endpoint_id,
                                16) &&
      AncGenesisDataEqualsBytes(confirmation.recoveryId, current->recovery_id,
                                16) &&
      AncGenesisDataEqualsBytes(confirmation.recoverySigningPublicKey,
                                current->recovery_signing_public_key, 32) &&
      AncGenesisDataEqualsBytes(confirmation.recoveryKeyAgreementPublicKey,
                                current->recovery_agreement_public_key, 32) &&
      [confirmation.recoveryWrapHash isEqualToData:wrapHash] &&
      [replay.state.vaultId isEqualToString:expectedVaultHex] &&
      replay.state.sequence == 0 && replay.state.epoch == 1 &&
      replay.state.recoveryGeneration == 1 &&
      [replay.state.recoveryId isEqualToString:expectedRecoveryHex] &&
      [replay.state.headHash isEqualToData:replay.entryHash] &&
      replay.state.activeMembers.count == 1 &&
      [replay.state.activeMembers.firstObject.endpointId
          isEqualToString:expectedEndpointHex] &&
      [replay.state.activeMembers.firstObject.signingPublicKey
          isEqualToData:evidenceSigning] &&
      [replay.state.activeMembers.firstObject.keyAgreementPublicKey
          isEqualToData:evidenceAgreement];
  if (!exact || authorizationDigest.length != 32 ||
      replay.entryHash.length != 32 || replay.state.membershipHash.length != 32)
    return nil;

  AncGenesisConfirmedEvidence *result = [AncGenesisConfirmedEvidence new];
  result.recoveryWrap = wrapBytes;
  result.confirmation = confirmationBytes;
  result.bootstrap = bootstrapBytes;
  result.authorization = authorizationBytes;
  result.recoveryWrapHash = wrapHash;
  result.confirmationHash = confirmationHash;
  result.bootstrapDigest = bootstrap.digest;
  result.authorizationDigest = authorizationDigest;
  result.controlHeadHash = replay.entryHash;
  result.membershipHash = replay.state.membershipHash;
  result.wrapCreatedAt = wrap.createdAt;
  result.endpointCreatedAt = endpointCreatedAt;
  result.logCreatedAt = logCreatedAt;
  result.authorizationCreatedAt = authorizationCreatedAt;
  return result;
}

static AncGenesisConfirmedEvidence *AncGenesisVerifyConfirmedEvidence(
    AncPrivateVaultPreparedGenesisArtifacts *artifacts, uint64_t confirmedAtMs,
    AncPrivateVaultControlLog *controlLog,
    const AncPrivateVaultGenesisPreparationSnapshot *current) {
  if (artifacts == nil ||
      object_getClass(artifacts) != AncPrivateVaultPreparedGenesisArtifacts.class)
    return nil;
  return AncGenesisVerifyConfirmedEvidenceBytes(
      artifacts.recoveryWrap, artifacts.recoveryConfirmation,
      artifacts.bootstrapTranscript, artifacts.authorization,
      artifacts.bootstrapTranscriptDigest, confirmedAtMs, controlLog, current);
}

static BOOL AncGenesisCustodyIdentifierEquals(const uint8_t *bytes,
                                              size_t length,
                                              NSString *expected) {
  NSData *expectedBytes =
      [expected dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:NO];
  return bytes != NULL && expectedBytes.length == length && length != 0 &&
         anc_pv_memcmp(bytes, expectedBytes.bytes, length) == ANC_PV_CRYPTO_OK;
}

static BOOL AncGenesisCommittedOfficialTupleExact(
    const AncPrivateVaultGenesisPreparationSnapshot *preparation,
    AncPrivateVaultGenesisHostedAppendReceipt *receipt,
    AncPrivateVaultAuthorityCheckpoint *authority,
    const AncPrivateVaultCustodySnapshot *custody) {
  if (preparation == NULL || receipt == nil || authority == nil ||
      authority.snapshot == nil || custody == NULL)
    return NO;
  NSString *vaultHex = AncGenesisHex(preparation->vault_id, 16);
  NSString *endpointHex = AncGenesisHex(preparation->endpoint_id, 16);
  AncPrivateVaultAuthoritySnapshot *snapshot = authority.snapshot;
  return preparation->phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED &&
         vaultHex.length == 32 && endpointHex.length == 32 &&
         [receipt.vaultId isEqualToString:vaultHex] && receipt.sequence == 0 &&
         [authority.vaultId isEqualToString:vaultHex] &&
         [snapshot.vaultId isEqualToString:vaultHex] &&
         authority.custodyGeneration == 2 &&
         snapshot.targetCustodyGeneration == 2 &&
         snapshot.previousCustodyGeneration == 1 &&
         snapshot.previousSequence == nil && snapshot.previousHead == nil &&
         snapshot.sequence == 0 && snapshot.epoch == 1 &&
         snapshot.recoveryGeneration == 1 &&
         snapshot.activeMembers.count == 1 &&
         [snapshot.activeMembers.firstObject.endpointId
             isEqualToString:endpointHex] &&
         [snapshot.activeMembers.firstObject.role isEqualToString:@"endpoint"] &&
         !snapshot.activeMembers.firstObject.unattended &&
         snapshot.removedEndpointIds.count == 0 &&
         snapshot.verifiedAtMs == preparation->terminal_at_ms &&
         AncGenesisDataEqualsBytes(authority.frameDigest,
                                   preparation->official_authority_g2_frame_digest,
                                   32) &&
         AncGenesisDataEqualsBytes(snapshot.headHash,
                                   preparation->genesis_control_head_hash, 32) &&
         AncGenesisDataEqualsBytes(snapshot.membershipHash,
                                   preparation->membership_hash, 32) &&
         AncGenesisDataEqualsBytes(snapshot.recoveryWrapHash,
                                   preparation->recovery_wrap_hash, 32) &&
         [receipt.headHash isEqualToData:snapshot.headHash] &&
         [receipt.recoveryWrapHash isEqualToData:snapshot.recoveryWrapHash] &&
         receipt.recoveryWrapByteLength == preparation->recovery_wrap_length &&
         custody->record_version == ANC_PV_CUSTODY_VERSION &&
         custody->authority_anchor_present == 1 &&
         custody->expected_edge_present == 0 &&
         custody->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
         custody->role == ANC_PV_CUSTODY_ROLE_ENDPOINT &&
         custody->pending_kind == ANC_PV_CUSTODY_PENDING_NONE &&
         custody->rotation_phase == ANC_PV_CUSTODY_ROTATION_NONE &&
         custody->enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_NONE &&
         custody->custody_generation == 2 && custody->active_epoch == 1 &&
         custody->pending_epoch == 0 && custody->recovery_generation == 1 &&
         custody->anchored_sequence == 0 &&
         custody->freshness_ms == preparation->terminal_at_ms &&
         AncGenesisCustodyIdentifierEquals(custody->vault_id,
                                           custody->vault_id_length, vaultHex) &&
         AncGenesisCustodyIdentifierEquals(
             custody->endpoint_id, custody->endpoint_id_length, endpointHex) &&
         anc_pv_memcmp(custody->signing_public_key,
                       preparation->endpoint_signing_public_key, 32) ==
             ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(custody->box_public_key,
                       preparation->endpoint_agreement_public_key, 32) ==
             ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(custody->snapshot_digest, authority.frameDigest.bytes,
                       32) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(custody->anchored_head, snapshot.headHash.bytes, 32) ==
             ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(custody->membership_digest,
                       snapshot.membershipHash.bytes, 32) == ANC_PV_CRYPTO_OK;
}

@implementation AncPrivateVaultGenesisPreparationStore

- (AncPrivateVaultGenesisPreparationStoreStatus)
    readLookupId:(const uint8_t *)lookupId
          length:(size_t)length
        snapshot:(AncPrivateVaultGenesisPreparationSnapshot *)snapshot
     secretHandle:(AncPrivateVaultGenesisPreparationSecretsHandle **)secretHandle {
  if (snapshot != NULL)
    anc_pv_genesis_preparation_snapshot_zero(snapshot);
  if (secretHandle != NULL)
    *secretHandle = nil;
  if (lookupId == NULL ||
      length != ANC_PV_GENESIS_PREPARATION_LOOKUP_ID_BYTES ||
      snapshot == NULL)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  BOOL wantsSecrets = secretHandle != NULL;
  __block AncPrivateVaultGenesisPreparationStoreStatus status;
  __block AncPrivateVaultGenesisPreparationSecretsHandle *resultSecrets = nil;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGenesisGuardedRecord *record = nil;
    AncPrivateVaultGenesisPreparationSecretsHandle *secrets = nil;
    status = [self reconcileLookupIdLocked:lookupId
                                    record:&record
                                  snapshot:snapshot
                             secretHandle:&secrets];
    AncPrivateVaultGuardedMemoryStatus recordClosed =
        record == nil ? AncPrivateVaultGuardedMemoryStatusOK : [record close];
    if (recordClosed != AncPrivateVaultGuardedMemoryStatusOK) {
      status = AncPrivateVaultGenesisPreparationStoreStatusFailed;
    }
    if (status == AncPrivateVaultGenesisPreparationStoreStatusOK &&
        wantsSecrets) {
      resultSecrets = secrets;
    } else {
      AncPrivateVaultGenesisPreparationStoreStatus secretClosed =
          [secrets close];
      if (secretClosed != AncPrivateVaultGenesisPreparationStoreStatusOK)
        status = secretClosed;
    }
  });
  if (status == AncPrivateVaultGenesisPreparationStoreStatusOK &&
      wantsSecrets)
    *secretHandle = resultSecrets;
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
    anc_pv_genesis_preparation_snapshot_zero(snapshot);
  return status;
}

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
    guardedCASTransitionHandle:(const uint8_t *)handle
                  handleLength:(size_t)handleLength
                     construct:(AncGenesisConstructedTransition)construct {
  if (handle == NULL ||
      handleLength != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES ||
      construct == nil)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  __block AncPrivateVaultGenesisPreparationStoreStatus status =
      AncPrivateVaultGenesisPreparationStoreStatusFailed;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGenesisGuardedRecord *current = nil;
    __block AncPrivateVaultGenesisGuardedRecord *candidate = nil;
    AncPrivateVaultGenesisPreparationSnapshot currentSnapshot;
    AncPrivateVaultGenesisPreparationSecretsHandle *currentSecrets = nil;
    status = [self reconcileLookupIdLocked:handle
                                    record:&current
                                  snapshot:&currentSnapshot
                             secretHandle:&currentSecrets];
    if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
      goto close_current;
    if (!anc_pv_genesis_preparation_handle_verify(
            handle, handleLength, currentSnapshot.preparation_lookup_id,
            currentSnapshot.handle_digest)) {
      status = AncPrivateVaultGenesisPreparationStoreStatusNotFound;
      goto close_current;
    }

    AncPrivateVaultGenesisPreparationSnapshot next;
    anc_pv_genesis_preparation_snapshot_zero(&next);
    BOOL shouldCommit = NO;
    BOOL terminalizeSecrets = NO;
    status = construct(&currentSnapshot, &next, &shouldCommit,
                       &terminalizeSecrets);
    if (status != AncPrivateVaultGenesisPreparationStoreStatusOK ||
        !shouldCommit) {
      anc_pv_genesis_preparation_snapshot_zero(&next);
      goto close_current;
    }

    AncPrivateVaultGenesisPreparationStoreStatus borrowed;
    if (terminalizeSecrets) {
      uint8_t terminalSecretBytes[160] = {0};
      AncPrivateVaultGenesisPreparationSecretInputs terminalSecrets = {
          terminalSecretBytes, terminalSecretBytes + 32,
          terminalSecretBytes + 64, terminalSecretBytes + 96,
          terminalSecretBytes + 128};
      AncPrivateVaultGenesisPreparationStoreStatus encodeStatus;
      candidate = AncGenesisEncode(&next, &terminalSecrets, &encodeStatus);
      anc_pv_zeroize(terminalSecretBytes, sizeof terminalSecretBytes);
      status = encodeStatus;
      borrowed = candidate == nil
                     ? AncPrivateVaultGenesisPreparationStoreStatusFailed
                     : AncPrivateVaultGenesisPreparationStoreStatusOK;
    } else {
      borrowed = [currentSecrets
          borrow:^BOOL(const AncPrivateVaultGenesisPreparationSecretInputs
                            *secrets) {
        AncPrivateVaultGenesisPreparationStoreStatus encodeStatus;
        candidate = AncGenesisEncode(&next, secrets, &encodeStatus);
        status = encodeStatus;
        return candidate != nil;
      }];
    }
    anc_pv_genesis_preparation_snapshot_zero(&next);
    if (borrowed != AncPrivateVaultGenesisPreparationStoreStatusOK ||
        candidate == nil) {
      if (status == AncPrivateVaultGenesisPreparationStoreStatusOK)
        status = AncPrivateVaultGenesisPreparationStoreStatusFailed;
      goto close_candidate;
    }
    if (!AncGenesisTransitionValid(current, candidate)) {
      status = AncPrivateVaultGenesisPreparationStoreStatusConflict;
      goto close_candidate;
    }

    status = AncGenesisCloseObjects(current, currentSecrets,
                                    AncPrivateVaultGenesisPreparationStoreStatusOK);
    current = nil;
    currentSecrets = nil;
    anc_pv_genesis_preparation_snapshot_zero(&currentSnapshot);
    if (status == AncPrivateVaultGenesisPreparationStoreStatusOK)
      status = [self commitCandidate:candidate
                           lookupKey:AncGenesisLookupKey(handle)
                         allowCreate:NO];

  close_candidate:
    if (candidate != nil &&
        [candidate close] != AncPrivateVaultGuardedMemoryStatusOK)
      status = AncPrivateVaultGenesisPreparationStoreStatusFailed;
  close_current:
    status = AncGenesisCloseObjects(current, currentSecrets, status);
    anc_pv_genesis_preparation_snapshot_zero(&currentSnapshot);
  });
  return status;
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    guardedCASTerminalTransitionLookupId:(const uint8_t *)lookupId
                                  length:(size_t)length
                               construct:
                                   (AncGenesisConstructedTransition)construct {
  if (lookupId == NULL ||
      length != ANC_PV_GENESIS_PREPARATION_LOOKUP_ID_BYTES || construct == nil)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  __block AncPrivateVaultGenesisPreparationStoreStatus status =
      AncPrivateVaultGenesisPreparationStoreStatusFailed;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGenesisGuardedRecord *current = nil;
    AncPrivateVaultGenesisGuardedRecord *candidate = nil;
    AncPrivateVaultGenesisPreparationSnapshot currentSnapshot;
    AncPrivateVaultGenesisPreparationSecretsHandle *currentSecrets = nil;
    status = [self reconcileLookupIdLocked:lookupId
                                    record:&current
                                  snapshot:&currentSnapshot
                             secretHandle:&currentSecrets];
    if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
      goto close_current;
    if (currentSnapshot.phase < ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED) {
      status = AncPrivateVaultGenesisPreparationStoreStatusConflict;
      goto close_current;
    }

    AncPrivateVaultGenesisPreparationSnapshot next;
    anc_pv_genesis_preparation_snapshot_zero(&next);
    BOOL shouldCommit = NO;
    BOOL terminalizeSecrets = NO;
    status = construct(&currentSnapshot, &next, &shouldCommit,
                       &terminalizeSecrets);
    if (status != AncPrivateVaultGenesisPreparationStoreStatusOK ||
        !shouldCommit) {
      anc_pv_genesis_preparation_snapshot_zero(&next);
      goto close_current;
    }
    if (!terminalizeSecrets) {
      anc_pv_genesis_preparation_snapshot_zero(&next);
      status = AncPrivateVaultGenesisPreparationStoreStatusConflict;
      goto close_current;
    }

    uint8_t terminalSecretBytes[160] = {0};
    AncPrivateVaultGenesisPreparationSecretInputs terminalSecrets = {
        terminalSecretBytes, terminalSecretBytes + 32,
        terminalSecretBytes + 64, terminalSecretBytes + 96,
        terminalSecretBytes + 128};
    AncPrivateVaultGenesisPreparationStoreStatus encodeStatus;
    candidate = AncGenesisEncode(&next, &terminalSecrets, &encodeStatus);
    anc_pv_zeroize(terminalSecretBytes, sizeof terminalSecretBytes);
    anc_pv_genesis_preparation_snapshot_zero(&next);
    if (candidate == nil) {
      status = encodeStatus;
      goto close_candidate;
    }
    if (!AncGenesisTransitionValid(current, candidate)) {
      status = AncPrivateVaultGenesisPreparationStoreStatusConflict;
      goto close_candidate;
    }

    status = AncGenesisCloseObjects(
        current, currentSecrets,
        AncPrivateVaultGenesisPreparationStoreStatusOK);
    current = nil;
    currentSecrets = nil;
    anc_pv_genesis_preparation_snapshot_zero(&currentSnapshot);
    if (status == AncPrivateVaultGenesisPreparationStoreStatusOK)
      status = [self commitCandidate:candidate
                           lookupKey:AncGenesisLookupKey(lookupId)
                         allowCreate:NO];

  close_candidate:
    if (candidate != nil &&
        [candidate close] != AncPrivateVaultGuardedMemoryStatusOK)
      status = AncPrivateVaultGenesisPreparationStoreStatusFailed;
  close_current:
    status = AncGenesisCloseObjects(current, currentSecrets, status);
    anc_pv_genesis_preparation_snapshot_zero(&currentSnapshot);
  });
  return status;
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
  BOOL terminal = internalSnapshot.phase >=
                  ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED;
  anc_pv_genesis_preparation_snapshot_zero(&internalSnapshot);
  if (terminal) {
    if ([internalSecrets close] !=
        AncPrivateVaultGenesisPreparationStoreStatusOK) {
      anc_pv_genesis_preparation_snapshot_zero(snapshot);
      return AncPrivateVaultGenesisPreparationStoreStatusFailed;
    }
  } else if (secretHandle != NULL)
    *secretHandle = internalSecrets;
  else if ([internalSecrets close] !=
           AncPrivateVaultGenesisPreparationStoreStatusOK) {
    anc_pv_genesis_preparation_snapshot_zero(snapshot);
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  }
  return AncPrivateVaultGenesisPreparationStoreStatusOK;
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    bindConfirmedHandle:(const uint8_t *)handle
           handleLength:(size_t)handleLength
              artifacts:(AncPrivateVaultPreparedGenesisArtifacts *)artifacts
          confirmedAtMs:(uint64_t)confirmedAtMs
             controlLog:(AncPrivateVaultControlLog *)controlLog {
  if (handle == NULL ||
      handleLength != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES ||
      confirmedAtMs == 0 || confirmedAtMs % 1000 != 0 || artifacts == nil ||
      controlLog == nil)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  AncPrivateVaultGenesisPreparationSnapshot observed;
  AncPrivateVaultGenesisPreparationStoreStatus status =
      [self readHandle:handle
          handleLength:handleLength
             snapshot:&observed
          secretHandle:nil];
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
    return status;
  if (observed.phase != ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED &&
      observed.phase != ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  }
  AncGenesisConfirmedEvidence *evidence = AncGenesisVerifyConfirmedEvidence(
      artifacts, confirmedAtMs, controlLog, &observed);
  if (evidence == nil) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  }
  if (observed.phase == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED) {
    if (!AncGenesisConfirmedSnapshotMatches(&observed, evidence,
                                            confirmedAtMs)) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return AncPrivateVaultGenesisPreparationStoreStatusConflict;
    }
    __block BOOL exactLiveArtifacts = NO;
    AncPrivateVaultGenesisPreparationArtifactStatus liveStatus =
        [self.artifactStore
            readLiveLookupId:observed.preparation_lookup_id
                     vaultId:observed.vault_id
                  ceremonyId:observed.ceremony_id
                  generation:2
              expectedDigest:observed.artifact_spool_digest
                   consumer:^BOOL(const uint8_t *wrap, size_t wrapLength,
                                   const uint8_t *confirmation,
                                   size_t confirmationLength,
                                   const uint8_t *bootstrap,
                                   size_t bootstrapLength,
                                   const uint8_t *authorization,
                                   size_t authorizationLength) {
      exactLiveArtifacts =
          wrapLength == evidence.recoveryWrap.length &&
          confirmationLength == evidence.confirmation.length &&
          bootstrapLength == evidence.bootstrap.length &&
          authorizationLength == evidence.authorization.length &&
          memcmp(wrap, evidence.recoveryWrap.bytes, wrapLength) == 0 &&
          memcmp(confirmation, evidence.confirmation.bytes,
                 confirmationLength) == 0 &&
          memcmp(bootstrap, evidence.bootstrap.bytes, bootstrapLength) == 0 &&
          memcmp(authorization, evidence.authorization.bytes,
                 authorizationLength) == 0;
      return exactLiveArtifacts;
    }];
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    if (liveStatus != AncPrivateVaultGenesisPreparationArtifactStatusOK)
      return AncGenesisArtifactStatus(liveStatus);
    return exactLiveArtifacts
               ? AncPrivateVaultGenesisPreparationStoreStatusOK
               : AncPrivateVaultGenesisPreparationStoreStatusConflict;
  }
  uint8_t artifactDigest[32] = {0};
  AncPrivateVaultGenesisPreparationArtifactStatus artifactStatus =
      [self.artifactStore stageLookupId:observed.preparation_lookup_id
                                vaultId:observed.vault_id
                             ceremonyId:observed.ceremony_id
                             generation:2
                           recoveryWrap:evidence.recoveryWrap
                           confirmation:evidence.confirmation
                              bootstrap:evidence.bootstrap
                          authorization:evidence.authorization
                                 digest:artifactDigest];
  if (artifactStatus != AncPrivateVaultGenesisPreparationArtifactStatusOK) {
    anc_pv_zeroize(artifactDigest, sizeof artifactDigest);
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncGenesisArtifactStatus(artifactStatus);
  }
  NSData *wrapAfter = AncGenesisOwningData(
      artifacts.recoveryWrap,
      ANC_PV_GENESIS_PREPARATION_ARTIFACT_WRAP_MAX_BYTES);
  NSData *confirmationAfter = AncGenesisOwningData(
      artifacts.recoveryConfirmation,
      ANC_PV_GENESIS_PREPARATION_ARTIFACT_CONFIRMATION_MAX_BYTES);
  NSData *bootstrapAfter = AncGenesisOwningData(
      artifacts.bootstrapTranscript,
      ANC_PV_GENESIS_PREPARATION_ARTIFACT_BOOTSTRAP_MAX_BYTES);
  NSData *authorizationAfter = AncGenesisOwningData(
      artifacts.authorization,
      ANC_PV_GENESIS_PREPARATION_ARTIFACT_AUTHORIZATION_MAX_BYTES);
  NSData *digestAfter =
      AncGenesisOwningData(artifacts.bootstrapTranscriptDigest, 32);
  if (![wrapAfter isEqualToData:evidence.recoveryWrap] ||
      ![confirmationAfter isEqualToData:evidence.confirmation] ||
      ![bootstrapAfter isEqualToData:evidence.bootstrap] ||
      ![authorizationAfter isEqualToData:evidence.authorization] ||
      ![digestAfter isEqualToData:evidence.bootstrapDigest]) {
    anc_pv_zeroize(artifactDigest, sizeof artifactDigest);
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  }
  if (AncGenesisFault(
          AncPrivateVaultGenesisPreparationStoreFaultAfterArtifactStageBeforePreparationCAS)) {
    anc_pv_zeroize(artifactDigest, sizeof artifactDigest);
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  }
  AncPrivateVaultGenesisPreparationSnapshot expected = observed;
  anc_pv_genesis_preparation_snapshot_zero(&observed);
  NSData *stagedDigest = AncGenesisPublicBytes(artifactDigest, 32);
  anc_pv_zeroize(artifactDigest, sizeof artifactDigest);
  status = [self
      guardedCASTransitionHandle:handle
                    handleLength:handleLength
                       construct:^AncPrivateVaultGenesisPreparationStoreStatus(
                           const AncPrivateVaultGenesisPreparationSnapshot *current,
                           AncPrivateVaultGenesisPreparationSnapshot *next,
                           BOOL *shouldCommit, BOOL *terminalizeSecrets) {
    (void)terminalizeSecrets;
    BOOL targetMatches =
        AncGenesisConfirmedSnapshotMatches(current, evidence, confirmedAtMs) &&
        AncGenesisDataEqualsBytes(stagedDigest,
                                  current->artifact_spool_digest, 32) &&
        current->phase == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED;
    if (current->phase == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED) {
      if (!targetMatches ||
          (current->flags &
           (ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND |
            ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE)) !=
              (ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND |
               ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE))
        return AncPrivateVaultGenesisPreparationStoreStatusConflict;
      *shouldCommit = NO;
      return AncPrivateVaultGenesisPreparationStoreStatusOK;
    }
    if (current->phase != ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED ||
        !AncGenesisSnapshotPublicEqual(current, &expected))
      return AncPrivateVaultGenesisPreparationStoreStatusConflict;
    *next = *current;
    next->phase = ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED;
    next->flags = ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND;
    next->generation++;
    next->confirmed_at_ms = confirmedAtMs;
    next->recovery_wrap_created_at_seconds = evidence.wrapCreatedAt;
    next->endpoint_created_at_seconds = evidence.endpointCreatedAt;
    next->log_entry_created_at_seconds = evidence.logCreatedAt;
    next->authorization_created_at_seconds = evidence.authorizationCreatedAt;
    memcpy(next->recovery_wrap_hash, evidence.recoveryWrapHash.bytes, 32);
    memcpy(next->recovery_confirmation_hash, evidence.confirmationHash.bytes,
           32);
    memcpy(next->bootstrap_transcript_digest, evidence.bootstrapDigest.bytes,
           32);
    memcpy(next->authorization_digest, evidence.authorizationDigest.bytes, 32);
    memcpy(next->genesis_control_head_hash, evidence.controlHeadHash.bytes, 32);
    memcpy(next->membership_hash, evidence.membershipHash.bytes, 32);
    memcpy(next->artifact_spool_digest, stagedDigest.bytes, 32);
    next->recovery_wrap_length = evidence.recoveryWrap.length;
    next->confirmation_length = evidence.confirmation.length;
    next->bootstrap_length = evidence.bootstrap.length;
    next->authorization_length = evidence.authorization.length;
    *shouldCommit = YES;
    return AncPrivateVaultGenesisPreparationStoreStatusOK;
  }];
  anc_pv_genesis_preparation_snapshot_zero(&expected);
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK) {
    if (status == AncPrivateVaultGenesisPreparationStoreStatusConflict) {
      AncPrivateVaultGenesisPreparationSnapshot afterConflict;
      AncPrivateVaultGenesisPreparationStoreStatus reread =
          [self readHandle:handle
               handleLength:handleLength
                  snapshot:&afterConflict
               secretHandle:nil];
      BOOL unbound =
          reread == AncPrivateVaultGenesisPreparationStoreStatusOK &&
          (afterConflict.flags &
           ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND) == 0 &&
          (afterConflict.phase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED ||
           afterConflict.phase ==
               ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED ||
           afterConflict.phase == ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED);
      anc_pv_genesis_preparation_snapshot_zero(&afterConflict);
      if (unbound) {
        AncPrivateVaultGenesisPreparationArtifactStatus cleaned =
            [self.artifactStore
                deleteStagedLookupId:handle
                      expectedDigest:stagedDigest.bytes];
        if (cleaned != AncPrivateVaultGenesisPreparationArtifactStatusOK &&
            cleaned !=
                AncPrivateVaultGenesisPreparationArtifactStatusNotFound)
          return AncGenesisArtifactStatus(cleaned);
      }
    }
    return status;
  }
  AncPrivateVaultGenesisPreparationArtifactStatus reconciledArtifacts =
      [self.artifactStore reconcileLookupId:handle
                              expectedDigest:stagedDigest.bytes];
  if (reconciledArtifacts !=
      AncPrivateVaultGenesisPreparationArtifactStatusOK)
    return AncGenesisArtifactStatus(reconciledArtifacts);
  return [self reconcileHandle:handle handleLength:handleLength];
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    beginCommittingHandle:(const uint8_t *)handle
             handleLength:(size_t)handleLength {
  return [self
      guardedCASTransitionHandle:handle
                    handleLength:handleLength
                       construct:^AncPrivateVaultGenesisPreparationStoreStatus(
                           const AncPrivateVaultGenesisPreparationSnapshot *current,
                           AncPrivateVaultGenesisPreparationSnapshot *next,
                           BOOL *shouldCommit, BOOL *terminalizeSecrets) {
    (void)terminalizeSecrets;
    if (current->phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING) {
      *shouldCommit = NO;
      return AncPrivateVaultGenesisPreparationStoreStatusOK;
    }
    if (current->phase != ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED ||
        current->flags !=
            (ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND |
             ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE))
      return AncPrivateVaultGenesisPreparationStoreStatusConflict;
    *next = *current;
    next->phase = ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING;
    next->generation++;
    *shouldCommit = YES;
    return AncPrivateVaultGenesisPreparationStoreStatusOK;
  }];
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    bindPendingGenesisCustodyHandle:(const uint8_t *)handle
                       handleLength:(size_t)handleLength
                  custodyRepository:
                      (AncPrivateVaultCustodyRepository *)custodyRepository {
  if (handle == NULL ||
      handleLength != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES ||
      custodyRepository == nil ||
      object_getClass(custodyRepository) !=
          AncPrivateVaultCustodyRepository.class)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  AncPrivateVaultGenesisPreparationSnapshot observed;
  AncPrivateVaultGenesisPreparationStoreStatus status =
      [self readHandle:handle
          handleLength:handleLength
             snapshot:&observed
          secretHandle:nil];
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
    return status;
  if (observed.phase != ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  }
  NSString *vaultId = AncGenesisHex(observed.vault_id, 16);
  NSString *endpointId = AncGenesisHex(observed.endpoint_id, 16);
  NSString *ceremonyId = AncGenesisHex(observed.ceremony_id, 16);
  NSData *signingKey =
      AncGenesisPublicBytes(observed.endpoint_signing_public_key, 32);
  NSData *agreementKey =
      AncGenesisPublicBytes(observed.endpoint_agreement_public_key, 32);
  NSData *bootstrapDigest =
      AncGenesisPublicBytes(observed.bootstrap_transcript_digest, 32);
  AncPrivateVaultPendingGenesisCustodyCheckpoint *checkpoint = nil;
  AncPrivateVaultCustodyRepositoryStatus custodyStatus =
      [custodyRepository
          pendingGenesisCheckpointVaultId:vaultId
                                endpointId:endpointId
                                ceremonyId:ceremonyId
                           signingPublicKey:signingKey
                                boxPublicKey:agreementKey
                   bootstrapTranscriptDigest:bootstrapDigest
                                 checkpoint:&checkpoint];
  if (custodyStatus != AncPrivateVaultCustodyRepositoryStatusOK ||
      checkpoint == nil || checkpoint.custodyGeneration != 1 ||
      ![checkpoint.vaultId isEqualToString:vaultId] ||
      checkpoint.recordDigest.length != 32) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK
               ? AncPrivateVaultGenesisPreparationStoreStatusCorrupt
               : AncGenesisCustodyStatus(custodyStatus);
  }
  AncPrivateVaultGenesisPreparationSnapshot expected = observed;
  anc_pv_genesis_preparation_snapshot_zero(&observed);
  NSData *custodyDigest = [checkpoint.recordDigest copy];
  status = [self
      guardedCASTransitionHandle:handle
                    handleLength:handleLength
                       construct:^AncPrivateVaultGenesisPreparationStoreStatus(
                           const AncPrivateVaultGenesisPreparationSnapshot *current,
                           AncPrivateVaultGenesisPreparationSnapshot *next,
                           BOOL *shouldCommit, BOOL *terminalizeSecrets) {
    (void)terminalizeSecrets;
    if (current->phase != ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING ||
        memcmp(current->vault_id, expected.vault_id, 16) != 0 ||
        memcmp(current->endpoint_id, expected.endpoint_id, 16) != 0 ||
        memcmp(current->ceremony_id, expected.ceremony_id, 16) != 0 ||
        memcmp(current->endpoint_signing_public_key,
               expected.endpoint_signing_public_key, 32) != 0 ||
        memcmp(current->endpoint_agreement_public_key,
               expected.endpoint_agreement_public_key, 32) != 0 ||
        memcmp(current->bootstrap_transcript_digest,
               expected.bootstrap_transcript_digest, 32) != 0)
      return AncPrivateVaultGenesisPreparationStoreStatusConflict;
    if ((current->flags &
         ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND) != 0) {
      if (!AncGenesisDataEqualsBytes(custodyDigest,
                                     current->custody_record_digest, 32))
        return AncPrivateVaultGenesisPreparationStoreStatusConflict;
      *shouldCommit = NO;
      return AncPrivateVaultGenesisPreparationStoreStatusOK;
    }
    *next = *current;
    next->flags |= ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND;
    next->generation++;
    memcpy(next->custody_record_digest, custodyDigest.bytes, 32);
    *shouldCommit = YES;
    return AncPrivateVaultGenesisPreparationStoreStatusOK;
  }];
  anc_pv_genesis_preparation_snapshot_zero(&expected);
  return status;
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    bindOfficialGenesisHandle:(const uint8_t *)handle
                  handleLength:(size_t)handleLength
                authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
             custodyRepository:
                 (AncPrivateVaultCustodyRepository *)custodyRepository {
  if (handle == NULL ||
      handleLength != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES ||
      authorityStore == nil || custodyRepository == nil ||
      object_getClass(authorityStore) != AncPrivateVaultAuthorityStore.class ||
      object_getClass(custodyRepository) !=
          AncPrivateVaultCustodyRepository.class)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;

  AncPrivateVaultGenesisPreparationSnapshot observed;
  AncPrivateVaultGenesisPreparationStoreStatus status =
      [self readHandle:handle
          handleLength:handleLength
             snapshot:&observed
          secretHandle:nil];
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
    return status;
  if (observed.phase != ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING &&
      observed.phase != ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  }
  NSString *vaultId = AncGenesisHex(observed.vault_id, 16);
  NSString *endpointId = AncGenesisHex(observed.endpoint_id, 16);
  NSString *recoveryId = AncGenesisHex(observed.recovery_id, 16);
  NSString *enrollmentRef =
      AncGenesisHex(observed.authorization_envelope_id, 16);
  AncPrivateVaultAuthorityCheckpoint *official = nil;
  AncPrivateVaultAuthorityStoreStatus authorityStatus =
      [authorityStore loadVaultId:vaultId checkpoint:&official error:nil];
  if (authorityStatus != AncPrivateVaultAuthorityStoreStatusOK ||
      official == nil) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return authorityStatus == AncPrivateVaultAuthorityStoreStatusOK
               ? AncPrivateVaultGenesisPreparationStoreStatusCorrupt
               : AncGenesisAuthorityStatus(authorityStatus);
  }
  AncPrivateVaultCustodySnapshot custody = {0};
  AncPrivateVaultCustodyHandle *custodyHandle = nil;
  AncPrivateVaultCustodyRepositoryStatus custodyStatus =
      [custodyRepository readVaultId:vaultId
                            snapshot:&custody
                              handle:&custodyHandle];
  AncPrivateVaultCustodyRepositoryStatus custodyClose =
      custodyHandle == nil ? AncPrivateVaultCustodyRepositoryStatusInaccessible
                           : [custodyHandle close];
  AncPrivateVaultAuthoritySnapshot *snapshot = official.snapshot;
  AncPrivateVaultAuthorityMember *member = snapshot.activeMembers.firstObject;
  uint8_t zero32[32] = {0};
  BOOL exact =
      custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
      custodyClose == AncPrivateVaultCustodyRepositoryStatusOK &&
      official.frameDigest.length == 32 &&
      official.custodyGeneration == 2 &&
      [official.vaultId isEqualToString:vaultId] && snapshot != nil &&
      [snapshot.vaultId isEqualToString:vaultId] &&
      snapshot.targetCustodyGeneration == 2 &&
      snapshot.previousCustodyGeneration == 1 &&
      snapshot.previousSequence == nil && snapshot.previousHead == nil &&
      snapshot.sequence == 0 && snapshot.epoch == 1 &&
      snapshot.recoveryGeneration == 1 &&
      snapshot.verifiedAtMs >= observed.confirmed_at_ms &&
      snapshot.verifiedAtMs <= kAncGenesisMaximumSafeInteger &&
      snapshot.signedAtMs == observed.confirmed_at_ms &&
      snapshot.activeMembers.count == 1 &&
      snapshot.removedEndpointIds.count == 0 &&
      [snapshot.recoveryId isEqualToString:recoveryId] &&
      AncGenesisDataEqualsBytes(snapshot.recoverySigningPublicKey,
                                observed.recovery_signing_public_key, 32) &&
      AncGenesisDataEqualsBytes(snapshot.recoveryKeyAgreementPublicKey,
                                observed.recovery_agreement_public_key, 32) &&
      AncGenesisDataEqualsBytes(snapshot.recoveryWrapHash,
                                observed.recovery_wrap_hash, 32) &&
      AncGenesisDataEqualsBytes(snapshot.headHash,
                                observed.genesis_control_head_hash, 32) &&
      AncGenesisDataEqualsBytes(snapshot.membershipHash,
                                observed.membership_hash, 32) && member != nil &&
      [member.endpointId isEqualToString:endpointId] &&
      [member.enrollmentRef isEqualToString:enrollmentRef] &&
      [member.role isEqualToString:@"endpoint"] && !member.unattended &&
      AncGenesisDataEqualsBytes(member.signingPublicKey,
                                observed.endpoint_signing_public_key, 32) &&
      AncGenesisDataEqualsBytes(member.keyAgreementPublicKey,
                                observed.endpoint_agreement_public_key, 32) &&
      custody.record_version == ANC_PV_CUSTODY_VERSION &&
      custody.custody_generation == 2 &&
      custody.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
      custody.role == ANC_PV_CUSTODY_ROLE_ENDPOINT &&
      custody.authority_anchor_present == 1 && custody.active_epoch == 1 &&
      custody.pending_epoch == 0 &&
      custody.pending_kind == ANC_PV_CUSTODY_PENDING_NONE &&
      custody.rotation_phase == ANC_PV_CUSTODY_ROTATION_NONE &&
      custody.enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_NONE &&
      custody.expected_edge_present == 0 &&
      custody.ceremony_id_length == 0 &&
      memcmp(custody.ceremony_id, zero32, 16) == 0 &&
      memcmp(custody.pending_transcript_digest, zero32, 32) == 0 &&
      memcmp(custody.expected_previous_head, zero32, 32) == 0 &&
      custody.expected_next_sequence == 0 &&
      custody.anchored_sequence == 0 &&
      custody.recovery_generation == 1 &&
      custody.signed_at_ms == snapshot.signedAtMs &&
      custody.freshness_ms == snapshot.verifiedAtMs &&
      AncGenesisDataEqualsBytes(official.frameDigest, custody.snapshot_digest,
                                32) &&
      AncGenesisDataEqualsBytes(snapshot.headHash, custody.anchored_head, 32) &&
      AncGenesisDataEqualsBytes(snapshot.membershipHash,
                                custody.membership_digest, 32) &&
      AncGenesisIdentifierBytesEqual(custody.vault_id,
                                     custody.vault_id_length, vaultId) &&
      AncGenesisIdentifierBytesEqual(custody.endpoint_id,
                                     custody.endpoint_id_length, endpointId) &&
      memcmp(custody.signing_public_key,
             observed.endpoint_signing_public_key, 32) == 0 &&
      memcmp(custody.box_public_key,
             observed.endpoint_agreement_public_key, 32) == 0;
  anc_pv_zeroize(&custody, sizeof custody);
  anc_pv_zeroize(zero32, sizeof zero32);
  if (!exact) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    if (custodyStatus != AncPrivateVaultCustodyRepositoryStatusOK)
      return AncGenesisCustodyStatus(custodyStatus);
    if (custodyClose != AncPrivateVaultCustodyRepositoryStatusOK)
      return AncGenesisCustodyStatus(custodyClose);
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  }

  AncPrivateVaultGenesisPreparationSnapshot expected = observed;
  anc_pv_genesis_preparation_snapshot_zero(&observed);
  NSData *officialDigest = [official.frameDigest copy];
  uint64_t terminalAtMs = snapshot.verifiedAtMs;
  status = [self
      guardedCASTransitionHandle:handle
                    handleLength:handleLength
                       construct:^AncPrivateVaultGenesisPreparationStoreStatus(
                           const AncPrivateVaultGenesisPreparationSnapshot *current,
                           AncPrivateVaultGenesisPreparationSnapshot *next,
                           BOOL *shouldCommit, BOOL *terminalizeSecrets) {
    if (current->phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED) {
      if (!AncGenesisDataEqualsBytes(
              officialDigest, current->official_authority_g2_frame_digest, 32) ||
          current->terminal_at_ms != terminalAtMs)
        return AncPrivateVaultGenesisPreparationStoreStatusConflict;
      *shouldCommit = NO;
      return AncPrivateVaultGenesisPreparationStoreStatusOK;
    }
    if (current->phase != ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING ||
        !AncGenesisSnapshotPublicEqual(current, &expected) ||
        (current->flags &
         ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND) == 0)
      return AncPrivateVaultGenesisPreparationStoreStatusConflict;
    *next = *current;
    next->phase = ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED;
    next->flags |=
        ANC_PV_GENESIS_PREPARATION_FLAG_OFFICIAL_AUTHORITY_BOUND;
    next->generation++;
    next->terminal_at_ms = terminalAtMs;
    memcpy(next->official_authority_g2_frame_digest, officialDigest.bytes, 32);
    *terminalizeSecrets = YES;
    *shouldCommit = YES;
    return AncPrivateVaultGenesisPreparationStoreStatusOK;
  }];
  anc_pv_genesis_preparation_snapshot_zero(&expected);
  return status;
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    cancelHandle:(const uint8_t *)handle
     handleLength:(size_t)handleLength
    cancelledAtMs:(uint64_t)cancelledAtMs
    authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
    custodyRepository:(AncPrivateVaultCustodyRepository *)custodyRepository {
  if (handle == NULL ||
      handleLength != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES ||
      cancelledAtMs == 0 || cancelledAtMs > kAncGenesisMaximumSafeInteger ||
      object_getClass(authorityStore) != AncPrivateVaultAuthorityStore.class ||
      object_getClass(custodyRepository) !=
          AncPrivateVaultCustodyRepository.class)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;

  AncPrivateVaultGenesisPreparationSnapshot observed;
  AncPrivateVaultGenesisPreparationStoreStatus status =
      [self readHandle:handle
          handleLength:handleLength
             snapshot:&observed
          secretHandle:nil];
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
    return status;
  if (observed.phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED ||
      observed.phase == ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  }
  NSString *vaultId = AncGenesisHex(observed.vault_id, 16);
  AncPrivateVaultAuthorityStoreStatus authorityStatus =
      [authorityStore proveAuthorityAbsentVaultId:vaultId];
  if (authorityStatus != AncPrivateVaultAuthorityStoreStatusNotFound) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return authorityStatus == AncPrivateVaultAuthorityStoreStatusOK ||
                   authorityStatus == AncPrivateVaultAuthorityStoreStatusRemoved
               ? AncPrivateVaultGenesisPreparationStoreStatusConflict
               : AncGenesisAuthorityStatus(authorityStatus);
  }

  if (observed.phase != ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED &&
      observed.phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING &&
      (observed.flags &
       ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND) == 0) {
    AncPrivateVaultGenesisPreparationStoreStatus bound =
        [self bindPendingGenesisCustodyHandle:handle
                                 handleLength:handleLength
                            custodyRepository:custodyRepository];
    if (bound != AncPrivateVaultGenesisPreparationStoreStatusOK &&
        bound != AncPrivateVaultGenesisPreparationStoreStatusNotFound) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return bound;
    }
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    status = [self readHandle:handle
                 handleLength:handleLength
                    snapshot:&observed
                 secretHandle:nil];
    if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
      return status;
  }

  NSData *cancelledCustodyDigest = nil;
  __block uint64_t effectiveCancelledAtMs = cancelledAtMs;
  if (observed.phase != ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED &&
      (observed.flags &
       ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND) != 0) {
    NSData *pendingDigest =
        AncGenesisPublicBytes(observed.custody_record_digest, 32);
    AncPrivateVaultCancelledGenesisCustodyCheckpoint *checkpoint = nil;
    AncPrivateVaultCustodyRepositoryStatus custodyStatus =
        [custodyRepository cancelPendingGenesisVaultId:vaultId
                                  expectedRecordDigest:pendingDigest
                                         cancelledAtMs:cancelledAtMs
                                            checkpoint:&checkpoint];
    if (custodyStatus != AncPrivateVaultCustodyRepositoryStatusOK ||
        checkpoint == nil || checkpoint.custodyGeneration != 2 ||
        checkpoint.recordDigest.length != 32 ||
        checkpoint.cancelledAtMs == 0 ||
        checkpoint.cancelledAtMs > kAncGenesisMaximumSafeInteger ||
        ![checkpoint.vaultId isEqualToString:vaultId]) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK
                 ? AncPrivateVaultGenesisPreparationStoreStatusCorrupt
                 : AncGenesisCustodyStatus(custodyStatus);
    }
    cancelledCustodyDigest = [checkpoint.recordDigest copy];
    effectiveCancelledAtMs = checkpoint.cancelledAtMs;
    if (AncGenesisFault(
            AncPrivateVaultGenesisPreparationStoreFaultAfterCancelledCustodyBeforePreparationCAS)) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return AncPrivateVaultGenesisPreparationStoreStatusFailed;
    }
  } else if (observed.phase !=
             ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED) {
    AncPrivateVaultCustodySnapshot custody = {0};
    AncPrivateVaultCustodyHandle *custodyHandle = nil;
    AncPrivateVaultCustodyRepositoryStatus custodyStatus =
        [custodyRepository readVaultId:vaultId
                              snapshot:&custody
                                handle:&custodyHandle];
    AncPrivateVaultCustodyRepositoryStatus closeStatus =
        custodyHandle == nil ? AncPrivateVaultCustodyRepositoryStatusOK
                             : [custodyHandle close];
    anc_pv_custody_snapshot_zero(&custody);
    if (closeStatus != AncPrivateVaultCustodyRepositoryStatusOK ||
        custodyStatus != AncPrivateVaultCustodyRepositoryStatusNotFound) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return closeStatus != AncPrivateVaultCustodyRepositoryStatusOK
                 ? AncGenesisCustodyStatus(closeStatus)
                 : (custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK
                        ? AncPrivateVaultGenesisPreparationStoreStatusConflict
                        : AncGenesisCustodyStatus(custodyStatus));
    }
  }

  if (observed.phase != ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED) {
    if (observed.phase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED &&
        cancelledAtMs > observed.expires_at_ms) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return AncPrivateVaultGenesisPreparationStoreStatusConflict;
    }
    if (observed.phase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED) {
      AncPrivateVaultGenesisPreparationArtifactStatus deleted =
          [self.artifactStore
              deleteUnboundStagedLookupId:observed.preparation_lookup_id
                                  vaultId:observed.vault_id
                               ceremonyId:observed.ceremony_id
                               generation:2];
      if (deleted != AncPrivateVaultGenesisPreparationArtifactStatusOK &&
          deleted != AncPrivateVaultGenesisPreparationArtifactStatusNotFound) {
        anc_pv_genesis_preparation_snapshot_zero(&observed);
        return AncGenesisArtifactStatus(deleted);
      }
    }
    AncPrivateVaultGenesisPreparationSnapshot expected = observed;
    status = [self
        guardedCASTransitionHandle:handle
                      handleLength:handleLength
                         construct:^AncPrivateVaultGenesisPreparationStoreStatus(
                             const AncPrivateVaultGenesisPreparationSnapshot *current,
                             AncPrivateVaultGenesisPreparationSnapshot *next,
                             BOOL *shouldCommit, BOOL *terminalizeSecrets) {
      if (!AncGenesisSnapshotPublicEqual(current, &expected))
        return AncPrivateVaultGenesisPreparationStoreStatusConflict;
      *next = *current;
      next->phase = ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED;
      next->generation++;
      next->terminal_at_ms = effectiveCancelledAtMs;
      if (current->phase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED)
        next->flags = ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED;
      if ((current->flags &
           ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND) != 0)
        memcpy(next->custody_record_digest, cancelledCustodyDigest.bytes, 32);
      *terminalizeSecrets = YES;
      *shouldCommit = YES;
      return AncPrivateVaultGenesisPreparationStoreStatusOK;
    }];
    anc_pv_genesis_preparation_snapshot_zero(&expected);
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
      return status;
    status = [self readHandle:handle
                 handleLength:handleLength
                    snapshot:&observed
                 secretHandle:nil];
    if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
      return status;
  }

  if ((observed.flags & ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED) ==
      0) {
    AncPrivateVaultGenesisPreparationArtifactStatus deleted =
        AncPrivateVaultGenesisPreparationArtifactStatusNotFound;
    if ((observed.flags &
         ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND) != 0) {
      AncPrivateVaultGenesisPreparationArtifactStatus promoted =
          [self.artifactStore
              reconcileLookupId:observed.preparation_lookup_id
                  expectedDigest:observed.artifact_spool_digest];
      if (promoted != AncPrivateVaultGenesisPreparationArtifactStatusOK) {
        anc_pv_genesis_preparation_snapshot_zero(&observed);
        return AncGenesisArtifactStatus(promoted);
      }
      deleted = [self.artifactStore
          deleteLiveLookupId:observed.preparation_lookup_id
              expectedDigest:observed.artifact_spool_digest];
    } else {
      deleted = [self.artifactStore
          deleteUnboundStagedLookupId:observed.preparation_lookup_id
                              vaultId:observed.vault_id
                           ceremonyId:observed.ceremony_id
                           generation:2];
    }
    if (deleted != AncPrivateVaultGenesisPreparationArtifactStatusOK &&
        deleted != AncPrivateVaultGenesisPreparationArtifactStatusNotFound) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return AncGenesisArtifactStatus(deleted);
    }
    AncPrivateVaultGenesisPreparationSnapshot expected = observed;
    status = [self
        guardedCASTransitionHandle:handle
                      handleLength:handleLength
                         construct:^AncPrivateVaultGenesisPreparationStoreStatus(
                             const AncPrivateVaultGenesisPreparationSnapshot *current,
                             AncPrivateVaultGenesisPreparationSnapshot *next,
                             BOOL *shouldCommit, BOOL *terminalizeSecrets) {
      if (!AncGenesisSnapshotPublicEqual(current, &expected) ||
          current->phase != ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED)
        return AncPrivateVaultGenesisPreparationStoreStatusConflict;
      *next = *current;
      next->flags &=
          (uint8_t)~ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE;
      next->flags |= ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED;
      next->generation++;
      *terminalizeSecrets = YES;
      *shouldCommit = YES;
      return AncPrivateVaultGenesisPreparationStoreStatusOK;
    }];
    anc_pv_genesis_preparation_snapshot_zero(&expected);
  } else if ((observed.flags &
              ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND) == 0) {
    AncPrivateVaultGenesisPreparationArtifactStatus deleted =
        [self.artifactStore
            deleteUnboundStagedLookupId:observed.preparation_lookup_id
                                vaultId:observed.vault_id
                             ceremonyId:observed.ceremony_id
                             generation:2];
    if (deleted != AncPrivateVaultGenesisPreparationArtifactStatusOK &&
        deleted != AncPrivateVaultGenesisPreparationArtifactStatusNotFound) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return AncGenesisArtifactStatus(deleted);
    }
  }
  uint8_t lookupId[ANC_PV_GENESIS_PREPARATION_LOOKUP_ID_BYTES] = {0};
  memcpy(lookupId, observed.preparation_lookup_id, sizeof lookupId);
  anc_pv_genesis_preparation_snapshot_zero(&observed);
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK) {
    anc_pv_zeroize(lookupId, sizeof lookupId);
    return status;
  }
  AncPrivateVaultGenesisPreparationStoreStatus reconciled =
      [self reconcileLookupId:lookupId length:sizeof lookupId];
  anc_pv_zeroize(lookupId, sizeof lookupId);
  return reconciled;
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    expireHandle:(const uint8_t *)handle
     handleLength:(size_t)handleLength
     expiredAtMs:(uint64_t)expiredAtMs
    authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
    custodyRepository:(AncPrivateVaultCustodyRepository *)custodyRepository {
  if (handle == NULL ||
      handleLength != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES ||
      expiredAtMs == 0 || expiredAtMs > kAncGenesisMaximumSafeInteger ||
      object_getClass(authorityStore) != AncPrivateVaultAuthorityStore.class ||
      object_getClass(custodyRepository) !=
          AncPrivateVaultCustodyRepository.class)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  AncPrivateVaultGenesisPreparationSnapshot observed;
  AncPrivateVaultGenesisPreparationStoreStatus status =
      [self readHandle:handle
          handleLength:handleLength
             snapshot:&observed
          secretHandle:nil];
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
    return status;
  if (observed.phase == ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED) {
    uint8_t lookupId[ANC_PV_GENESIS_PREPARATION_LOOKUP_ID_BYTES] = {0};
    memcpy(lookupId, observed.preparation_lookup_id, sizeof lookupId);
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    AncPrivateVaultGenesisPreparationStoreStatus reconciled =
        [self reconcileLookupId:lookupId length:sizeof lookupId];
    anc_pv_zeroize(lookupId, sizeof lookupId);
    return reconciled;
  }
  if (observed.phase != ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED ||
      expiredAtMs <= observed.expires_at_ms) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  }
  NSString *vaultId = AncGenesisHex(observed.vault_id, 16);
  AncPrivateVaultAuthorityStoreStatus authorityStatus =
      [authorityStore proveAuthorityAbsentVaultId:vaultId];
  AncPrivateVaultCustodySnapshot custody = {0};
  AncPrivateVaultCustodyHandle *custodyHandle = nil;
  AncPrivateVaultCustodyRepositoryStatus custodyStatus =
      [custodyRepository readVaultId:vaultId
                            snapshot:&custody
                              handle:&custodyHandle];
  AncPrivateVaultCustodyRepositoryStatus closeStatus =
      custodyHandle == nil ? AncPrivateVaultCustodyRepositoryStatusOK
                           : [custodyHandle close];
  anc_pv_custody_snapshot_zero(&custody);
  if (authorityStatus != AncPrivateVaultAuthorityStoreStatusNotFound ||
      custodyStatus != AncPrivateVaultCustodyRepositoryStatusNotFound ||
      closeStatus != AncPrivateVaultCustodyRepositoryStatusOK) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    if (authorityStatus == AncPrivateVaultAuthorityStoreStatusOK ||
        authorityStatus == AncPrivateVaultAuthorityStoreStatusRemoved ||
        custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK)
      return AncPrivateVaultGenesisPreparationStoreStatusConflict;
    if (authorityStatus != AncPrivateVaultAuthorityStoreStatusNotFound)
      return AncGenesisAuthorityStatus(authorityStatus);
    return AncGenesisCustodyStatus(
        closeStatus != AncPrivateVaultCustodyRepositoryStatusOK
            ? closeStatus
            : custodyStatus);
  }
  AncPrivateVaultGenesisPreparationArtifactStatus deleted =
      [self.artifactStore
          deleteUnboundStagedLookupId:observed.preparation_lookup_id
                              vaultId:observed.vault_id
                           ceremonyId:observed.ceremony_id
                           generation:2];
  if (deleted != AncPrivateVaultGenesisPreparationArtifactStatusOK &&
      deleted != AncPrivateVaultGenesisPreparationArtifactStatusNotFound) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncGenesisArtifactStatus(deleted);
  }
  AncPrivateVaultGenesisPreparationSnapshot expected = observed;
  uint8_t lookupId[ANC_PV_GENESIS_PREPARATION_LOOKUP_ID_BYTES] = {0};
  memcpy(lookupId, observed.preparation_lookup_id, sizeof lookupId);
  anc_pv_genesis_preparation_snapshot_zero(&observed);
  status = [self
      guardedCASTransitionHandle:handle
                    handleLength:handleLength
                       construct:^AncPrivateVaultGenesisPreparationStoreStatus(
                           const AncPrivateVaultGenesisPreparationSnapshot *current,
                           AncPrivateVaultGenesisPreparationSnapshot *next,
                           BOOL *shouldCommit, BOOL *terminalizeSecrets) {
    if (!AncGenesisSnapshotPublicEqual(current, &expected))
      return AncPrivateVaultGenesisPreparationStoreStatusConflict;
    *next = *current;
    next->phase = ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED;
    next->flags = ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED;
    next->generation++;
    next->terminal_at_ms = expiredAtMs;
    *terminalizeSecrets = YES;
    *shouldCommit = YES;
    return AncPrivateVaultGenesisPreparationStoreStatusOK;
  }];
  if (status == AncPrivateVaultGenesisPreparationStoreStatusOK) {
    deleted = [self.artifactStore
        deleteUnboundStagedLookupId:lookupId
                            vaultId:expected.vault_id
                         ceremonyId:expected.ceremony_id
                         generation:2];
    if (deleted != AncPrivateVaultGenesisPreparationArtifactStatusOK &&
        deleted != AncPrivateVaultGenesisPreparationArtifactStatusNotFound)
      status = AncGenesisArtifactStatus(deleted);
  }
  anc_pv_genesis_preparation_snapshot_zero(&expected);
  if (status == AncPrivateVaultGenesisPreparationStoreStatusOK)
    status = [self reconcileLookupId:lookupId length:sizeof lookupId];
  anc_pv_zeroize(lookupId, sizeof lookupId);
  return status;
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
    cleanupTerminalLookupId:(const uint8_t *)lookupId length:(size_t)length {
  if (lookupId == NULL ||
      length != ANC_PV_GENESIS_PREPARATION_LOOKUP_ID_BYTES)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;

  AncPrivateVaultGenesisPreparationSnapshot observed;
  AncPrivateVaultGenesisPreparationStoreStatus status =
      [self readLookupId:lookupId
                  length:length
                snapshot:&observed
             secretHandle:nil];
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
    return status;
  const AncPrivateVaultGenesisPreparationPhase phase = observed.phase;
  if (phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  }
  if (phase != ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED &&
      phase != ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  }

  const BOOL artifactsBound =
      (observed.flags & ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND) != 0;
  const BOOL artifactsCleaned =
      (observed.flags & ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED) != 0;
  if (!artifactsCleaned) {
    AncPrivateVaultGenesisPreparationArtifactStatus deleted =
        AncPrivateVaultGenesisPreparationArtifactStatusNotFound;
    if (artifactsBound) {
      AncPrivateVaultGenesisPreparationArtifactStatus reconciled =
          [self.artifactStore
              reconcileLookupId:observed.preparation_lookup_id
                  expectedDigest:observed.artifact_spool_digest];
      if (reconciled != AncPrivateVaultGenesisPreparationArtifactStatusOK &&
          reconciled !=
              AncPrivateVaultGenesisPreparationArtifactStatusNotFound) {
        anc_pv_genesis_preparation_snapshot_zero(&observed);
        return AncGenesisArtifactStatus(reconciled);
      }
      deleted = [self.artifactStore
          deleteLiveLookupId:observed.preparation_lookup_id
              expectedDigest:observed.artifact_spool_digest];
    } else {
      deleted = [self.artifactStore
          deleteUnboundStagedLookupId:observed.preparation_lookup_id
                              vaultId:observed.vault_id
                           ceremonyId:observed.ceremony_id
                           generation:2];
    }
    if (deleted != AncPrivateVaultGenesisPreparationArtifactStatusOK &&
        deleted != AncPrivateVaultGenesisPreparationArtifactStatusNotFound) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return AncGenesisArtifactStatus(deleted);
    }

    AncPrivateVaultGenesisPreparationSnapshot expected = observed;
    status = [self
        guardedCASTerminalTransitionLookupId:lookupId
                                      length:length
                                   construct:^AncPrivateVaultGenesisPreparationStoreStatus(
                                       const AncPrivateVaultGenesisPreparationSnapshot
                                           *current,
                                       AncPrivateVaultGenesisPreparationSnapshot
                                           *next,
                                       BOOL *shouldCommit,
                                       BOOL *terminalizeSecrets) {
      if (current->phase != ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED ||
          !AncGenesisSnapshotPublicEqual(current, &expected))
        return AncPrivateVaultGenesisPreparationStoreStatusConflict;
      *next = *current;
      next->flags &=
          (uint8_t)~ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE;
      next->flags |= ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED;
      next->generation++;
      *terminalizeSecrets = YES;
      *shouldCommit = YES;
      return AncPrivateVaultGenesisPreparationStoreStatusOK;
    }];
    anc_pv_genesis_preparation_snapshot_zero(&expected);
    if (status != AncPrivateVaultGenesisPreparationStoreStatusOK) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return status;
    }
  } else if (!artifactsBound) {
    AncPrivateVaultGenesisPreparationArtifactStatus deleted =
        [self.artifactStore
            deleteUnboundStagedLookupId:observed.preparation_lookup_id
                                vaultId:observed.vault_id
                             ceremonyId:observed.ceremony_id
                             generation:2];
    if (deleted != AncPrivateVaultGenesisPreparationArtifactStatusOK &&
        deleted != AncPrivateVaultGenesisPreparationArtifactStatusNotFound) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return AncGenesisArtifactStatus(deleted);
    }
  }
  anc_pv_genesis_preparation_snapshot_zero(&observed);
  return [self reconcileLookupId:lookupId length:length];
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    cleanCommittedLookupId:(const uint8_t *)lookupId
                    length:(size_t)length
                   receipt:(NSData *)receiptBytes
                controlLog:(AncPrivateVaultControlLog *)controlLog
            authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
         custodyRepository:
             (AncPrivateVaultCustodyRepository *)custodyRepository {
  NSData *canonicalReceipt = [receiptBytes copy];
  AncPrivateVaultGenesisHostedAppendReceipt *receipt =
      AncPrivateVaultGenesisHostedAppendReceiptDecode(canonicalReceipt);
  if (lookupId == NULL ||
      length != ANC_PV_GENESIS_PREPARATION_LOOKUP_ID_BYTES ||
      canonicalReceipt == nil || receipt == nil ||
      object_getClass(controlLog) != AncPrivateVaultControlLog.class ||
      object_getClass(authorityStore) != AncPrivateVaultAuthorityStore.class ||
      object_getClass(custodyRepository) !=
          AncPrivateVaultCustodyRepository.class)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;

  AncPrivateVaultGenesisPreparationSnapshot observed;
  AncPrivateVaultGenesisPreparationStoreStatus status =
      [self readLookupId:lookupId
                  length:length
                snapshot:&observed
             secretHandle:nil];
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
    return status;
  if (observed.phase != ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  }
  NSString *vaultHex = AncGenesisHex(observed.vault_id, 16);
  NSData *receiptDigest = AncGenesisCleanupReceiptDigest(canonicalReceipt);
  if (![receipt.vaultId isEqualToString:vaultHex] || receiptDigest.length != 32) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
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
  BOOL tuple = authorityStatus == AncPrivateVaultAuthorityStoreStatusOK &&
               authorityError == nil && custodyStatus ==
                                            AncPrivateVaultCustodyRepositoryStatusOK &&
               custodyHandle != nil &&
               AncGenesisCommittedOfficialTupleExact(&observed, receipt,
                                                      authority, &custody);

  __block NSData *wrap = nil, *confirmation = nil, *bootstrap = nil,
                         *authorization = nil;
  AncPrivateVaultGenesisPreparationArtifactStatus artifactStatus =
      tuple ? [self.artifactStore
                    readLiveLookupId:observed.preparation_lookup_id
                             vaultId:observed.vault_id
                          ceremonyId:observed.ceremony_id
                          generation:2
                      expectedDigest:observed.artifact_spool_digest
                           consumer:^BOOL(
                               const uint8_t *wrapBytes, size_t wrapLength,
                               const uint8_t *confirmationBytes,
                               size_t confirmationLength,
                               const uint8_t *bootstrapBytes,
                               size_t bootstrapLength,
                               const uint8_t *authorizationBytes,
                               size_t authorizationLength) {
        wrap = [NSData dataWithBytes:wrapBytes length:wrapLength];
        confirmation = [NSData dataWithBytes:confirmationBytes
                                      length:confirmationLength];
        bootstrap = [NSData dataWithBytes:bootstrapBytes
                                   length:bootstrapLength];
        authorization = [NSData dataWithBytes:authorizationBytes
                                       length:authorizationLength];
        return wrap.length == wrapLength &&
               confirmation.length == confirmationLength &&
               bootstrap.length == bootstrapLength &&
               authorization.length == authorizationLength;
      }]
            : AncPrivateVaultGenesisPreparationArtifactStatusBindingMismatch;
  BOOL artifactExact = NO;
  if (artifactStatus == AncPrivateVaultGenesisPreparationArtifactStatusOK) {
    NSData *bootstrapDigest =
        AncGenesisPublicBytes(observed.bootstrap_transcript_digest, 32);
    AncGenesisConfirmedEvidence *evidence =
        AncGenesisVerifyConfirmedEvidenceBytes(
            wrap, confirmation, bootstrap, authorization, bootstrapDigest,
            observed.confirmed_at_ms, controlLog, &observed);
    AncPrivateVaultGenesisAuthorizationStatus commitStatus;
    NSData *vaultId = AncGenesisPublicBytes(observed.vault_id, 16);
    NSData *signedCommit =
        AncPrivateVaultGenesisAuthorizationCopySignedCommit(
            authorization, vaultId, &commitStatus);
    NSString *entryId =
        AncPrivateVaultControlLogSignedEntryEnvelopeId(signedCommit);
    artifactExact =
        evidence != nil &&
        AncGenesisEvidenceBindingsMatch(&observed, evidence,
                                        observed.confirmed_at_ms) &&
        [entryId isEqualToString:receipt.entryId] &&
        [AncPrivateVaultControlLogSignedEntryDomainHash(signedCommit)
            isEqualToData:receipt.headHash] &&
        [evidence.recoveryWrapHash isEqualToData:receipt.recoveryWrapHash] &&
        evidence.recoveryWrap.length == receipt.recoveryWrapByteLength;
  } else if (artifactStatus ==
             AncPrivateVaultGenesisPreparationArtifactStatusNotFound) {
    NSData *storedReceipt = nil;
    status = AncGenesisReadCleanupReceipt(self.keychain, vaultHex,
                                          &storedReceipt);
    artifactExact =
        status == AncPrivateVaultGenesisPreparationStoreStatusOK &&
        [storedReceipt isEqualToData:canonicalReceipt];
    if (status == AncPrivateVaultGenesisPreparationStoreStatusNotFound)
      status = AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected;
  }
  AncPrivateVaultCustodyRepositoryStatus custodyClosed =
      custodyHandle == nil ? AncPrivateVaultCustodyRepositoryStatusInaccessible
                           : [custodyHandle close];
  anc_pv_custody_snapshot_zero(&custody);
  if (!tuple || !artifactExact ||
      custodyClosed != AncPrivateVaultCustodyRepositoryStatusOK) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    if (custodyClosed != AncPrivateVaultCustodyRepositoryStatusOK)
      return AncPrivateVaultGenesisPreparationStoreStatusInaccessible;
    if (artifactStatus ==
            AncPrivateVaultGenesisPreparationArtifactStatusNotFound &&
        status != AncPrivateVaultGenesisPreparationStoreStatusOK)
      return status;
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  }

  status = AncGenesisPersistCleanupReceipt(self.keychain, vaultHex,
                                           canonicalReceipt);
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return status;
  }
  if (AncGenesisFault(
          AncPrivateVaultGenesisPreparationStoreFaultAfterCleanupReceiptPersist)) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  }
  const BOOL receiptAlreadyBound =
      (observed.flags &
       ANC_PV_GENESIS_PREPARATION_FLAG_HOSTED_RECEIPT_BOUND) != 0;
  if (receiptAlreadyBound &&
      !AncGenesisDataEqualsBytes(
          receiptDigest, observed.hosted_recovery_receipt_digest, 32)) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  }
  if (!receiptAlreadyBound) {
    AncPrivateVaultGenesisPreparationSnapshot expected = observed;
    status = [self
        guardedCASTerminalTransitionLookupId:lookupId
                                      length:length
                                   construct:^AncPrivateVaultGenesisPreparationStoreStatus(
                                       const AncPrivateVaultGenesisPreparationSnapshot
                                           *current,
                                       AncPrivateVaultGenesisPreparationSnapshot
                                           *next,
                                       BOOL *shouldCommit,
                                       BOOL *terminalizeSecrets) {
      if (!AncGenesisSnapshotPublicEqual(current, &expected) ||
          current->phase != ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED)
        return AncPrivateVaultGenesisPreparationStoreStatusConflict;
      *next = *current;
      next->flags |= ANC_PV_GENESIS_PREPARATION_FLAG_HOSTED_RECEIPT_BOUND;
      memcpy(next->hosted_recovery_receipt_digest, receiptDigest.bytes, 32);
      next->generation++;
      *terminalizeSecrets = YES;
      *shouldCommit = YES;
      return AncPrivateVaultGenesisPreparationStoreStatusOK;
    }];
    anc_pv_genesis_preparation_snapshot_zero(&expected);
    if (status != AncPrivateVaultGenesisPreparationStoreStatusOK) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return status;
    }
    if (AncGenesisFault(
            AncPrivateVaultGenesisPreparationStoreFaultAfterHostedReceiptBind)) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return AncPrivateVaultGenesisPreparationStoreStatusFailed;
    }
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    status = [self readLookupId:lookupId
                         length:length
                       snapshot:&observed
                    secretHandle:nil];
    if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
      return status;
  }

  if ((observed.flags & ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED) ==
      0) {
    AncPrivateVaultGenesisPreparationArtifactStatus deleted =
        [self.artifactStore
            deleteLiveLookupId:observed.preparation_lookup_id
                expectedDigest:observed.artifact_spool_digest];
    if (deleted != AncPrivateVaultGenesisPreparationArtifactStatusOK &&
        deleted != AncPrivateVaultGenesisPreparationArtifactStatusNotFound) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return AncGenesisArtifactStatus(deleted);
    }
    if (AncGenesisFault(
            AncPrivateVaultGenesisPreparationStoreFaultAfterHostedArtifactCleanup)) {
      anc_pv_genesis_preparation_snapshot_zero(&observed);
      return AncPrivateVaultGenesisPreparationStoreStatusFailed;
    }
    AncPrivateVaultGenesisPreparationSnapshot expected = observed;
    status = [self
        guardedCASTerminalTransitionLookupId:lookupId
                                      length:length
                                   construct:^AncPrivateVaultGenesisPreparationStoreStatus(
                                       const AncPrivateVaultGenesisPreparationSnapshot
                                           *current,
                                       AncPrivateVaultGenesisPreparationSnapshot
                                           *next,
                                       BOOL *shouldCommit,
                                       BOOL *terminalizeSecrets) {
      if (!AncGenesisSnapshotPublicEqual(current, &expected) ||
          current->phase != ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED ||
          (current->flags &
           ANC_PV_GENESIS_PREPARATION_FLAG_HOSTED_RECEIPT_BOUND) == 0)
        return AncPrivateVaultGenesisPreparationStoreStatusConflict;
      *next = *current;
      next->flags &=
          (uint8_t)~ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE;
      next->flags |= ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED;
      next->generation++;
      *terminalizeSecrets = YES;
      *shouldCommit = YES;
      return AncPrivateVaultGenesisPreparationStoreStatusOK;
    }];
    anc_pv_genesis_preparation_snapshot_zero(&expected);
  }
  if (status == AncPrivateVaultGenesisPreparationStoreStatusOK &&
      AncGenesisFault(
          AncPrivateVaultGenesisPreparationStoreFaultAfterHostedCleanedCAS)) {
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    return AncPrivateVaultGenesisPreparationStoreStatusFailed;
  }
  anc_pv_genesis_preparation_snapshot_zero(&observed);
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK)
    return status;
  AncPrivateVaultGenesisPreparationSnapshot cleanedSnapshot;
  status = [self readLookupId:lookupId
                       length:length
                     snapshot:&cleanedSnapshot
                  secretHandle:nil];
  BOOL exactCleaned =
      status == AncPrivateVaultGenesisPreparationStoreStatusOK &&
      cleanedSnapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED &&
      (cleanedSnapshot.flags &
       ANC_PV_GENESIS_PREPARATION_FLAG_HOSTED_RECEIPT_BOUND) != 0 &&
      (cleanedSnapshot.flags &
       ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED) != 0 &&
      (cleanedSnapshot.flags &
       ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) == 0 &&
      AncGenesisDataEqualsBytes(
          receiptDigest, cleanedSnapshot.hosted_recovery_receipt_digest, 32);
  anc_pv_genesis_preparation_snapshot_zero(&cleanedSnapshot);
  if (!exactCleaned)
    return status == AncPrivateVaultGenesisPreparationStoreStatusOK
               ? AncPrivateVaultGenesisPreparationStoreStatusConflict
               : status;
  AncPrivateVaultGenesisPreparationArtifactStatus markerDeleted =
      [self.artifactStore deletePreparationIndexLookupId:lookupId];
  return markerDeleted == AncPrivateVaultGenesisPreparationArtifactStatusOK ||
                 markerDeleted ==
                     AncPrivateVaultGenesisPreparationArtifactStatusNotFound
             ? AncPrivateVaultGenesisPreparationStoreStatusOK
             : AncGenesisArtifactStatus(markerDeleted);
}

- (AncPrivateVaultGenesisPreparationStoreStatus)
    recoverCommittedCleanupLookupId:(const uint8_t *)lookupId
                              length:(size_t)length
                          controlLog:(AncPrivateVaultControlLog *)controlLog
                      authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
                   custodyRepository:
                       (AncPrivateVaultCustodyRepository *)custodyRepository {
  if (lookupId == NULL ||
      length != ANC_PV_GENESIS_PREPARATION_LOOKUP_ID_BYTES)
    return AncPrivateVaultGenesisPreparationStoreStatusInvalid;
  AncPrivateVaultGenesisPreparationSnapshot snapshot;
  AncPrivateVaultGenesisPreparationStoreStatus read =
      [self readLookupId:lookupId
                  length:length
                snapshot:&snapshot
             secretHandle:nil];
  if (read != AncPrivateVaultGenesisPreparationStoreStatusOK)
    return read;
  NSString *vaultHex = AncGenesisHex(snapshot.vault_id, 16);
  BOOL committed =
      snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED;
  anc_pv_genesis_preparation_snapshot_zero(&snapshot);
  if (!committed || vaultHex.length != 32)
    return AncPrivateVaultGenesisPreparationStoreStatusConflict;
  NSData *receipt = nil;
  read = AncGenesisReadCleanupReceipt(self.keychain, vaultHex, &receipt);
  if (read != AncPrivateVaultGenesisPreparationStoreStatusOK)
    return read;
  return [self cleanCommittedLookupId:lookupId
                               length:length
                              receipt:receipt
                           controlLog:controlLog
                       authorityStore:authorityStore
                    custodyRepository:custodyRepository];
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
        (snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED ||
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
