#import "PrivateVaultRecoveryPreparationStore.h"
#import "PrivateVaultRecoveryPreparationStoreInternal.h"

#import "PrivateVaultCrypto.h"

#import <objc/runtime.h>

NSString *const AncPrivateVaultRecoveryPreparationRecordId =
    @"recovery-bootstrap";

static const uint8_t kRecoveryPreparationMagic[8] = {'A', 'N', 'P', 'V',
                                                     'R', 'C', '0', '1'};
static const uint8_t kRecoveryPreparationDigestDomain[] =
    "anc/v1/private-vault/recovery-preparation-record";
enum {
  kRecoveryPreparationPublicBytes = 392,
  kRecoveryPreparationSecretBytes = 128,
  kRecoveryPreparationAuthenticatedBytes = 520,
  kRecoveryPreparationRecordBytes = 552,
};

static void WriteU16(uint8_t *output, uint16_t value) {
  output[0] = (uint8_t)(value >> 8);
  output[1] = (uint8_t)value;
}
static void WriteU64(uint8_t *output, uint64_t value) {
  for (size_t index = 0; index < 8; index += 1)
    output[index] = (uint8_t)(value >> (56 - index * 8));
}
static uint16_t ReadU16(const uint8_t *input) {
  return ((uint16_t)input[0] << 8) | input[1];
}
static uint64_t ReadU64(const uint8_t *input) {
  uint64_t value = 0;
  for (size_t index = 0; index < 8; index += 1)
    value = (value << 8) | input[index];
  return value;
}
static BOOL AllZero(const uint8_t *bytes, size_t length) {
  uint8_t combined = 0;
  for (size_t index = 0; index < length; index += 1)
    combined |= bytes[index];
  return combined == 0;
}
static BOOL ValidSnapshot(
    const AncPrivateVaultRecoveryPreparationSnapshot *snapshot) {
  return snapshot != NULL && snapshot->verified_at_ms > 0 &&
         snapshot->verified_at_ms <= UINT64_C(9007199254740991) &&
         snapshot->next_epoch > 0 &&
         snapshot->next_epoch <= UINT64_C(9007199254740991) &&
         snapshot->replacement_recovery_generation > 1 &&
         snapshot->replacement_recovery_generation <=
             UINT64_C(9007199254740991) &&
         snapshot->expected_next_sequence > 0 &&
         snapshot->expected_next_sequence <= UINT64_C(9007199254740991) &&
         !AllZero(snapshot->vault_id, 16) &&
         !AllZero(snapshot->lookup_id, 16) &&
         !AllZero(snapshot->ceremony_id, 16) &&
         !AllZero(snapshot->candidate_endpoint_id, 16) &&
         !AllZero(snapshot->artifact_digest, 32) &&
         !AllZero(snapshot->expected_previous_head, 32) &&
         !AllZero(snapshot->recovery_authorization_hash, 32) &&
         !AllZero(snapshot->entry_id, 16) &&
         !AllZero(snapshot->entry_hash, 32) &&
         !AllZero(snapshot->recovery_wrap_hash, 32) &&
         !AllZero(snapshot->candidate_signing_public_key, 32) &&
         !AllZero(snapshot->candidate_key_agreement_public_key, 32) &&
         snapshot->recovery_wrap_byte_length > 0 &&
         snapshot->recovery_wrap_byte_length <= 1048576 &&
         !AllZero(snapshot->artifact_commitment, 32);
}
static BOOL ValidSecrets(
    const AncPrivateVaultRecoveryPreparationSecretInputs *secrets) {
  return secrets != NULL && secrets->endpoint_signing_seed != NULL &&
         secrets->endpoint_box_seed != NULL &&
         secrets->local_state_key != NULL && secrets->eek != NULL;
}
static NSString *HexId(const uint8_t bytes[16]) {
  static const char digits[] = "0123456789abcdef";
  uint8_t encoded[32] = {0};
  for (size_t index = 0; index < 16; index += 1) {
    encoded[index * 2] = digits[bytes[index] >> 4];
    encoded[index * 2 + 1] = digits[bytes[index] & 15];
  }
  return [[NSString alloc] initWithBytes:encoded
                                  length:sizeof encoded
                                encoding:NSASCIIStringEncoding];
}
static BOOL ParseHexId(NSString *value, uint8_t output[16]) {
  if (![value isKindOfClass:NSString.class] || value.length != 32)
    return NO;
  for (size_t index = 0; index < 16; index += 1) {
    unichar high = [value characterAtIndex:index * 2];
    unichar low = [value characterAtIndex:index * 2 + 1];
    int left = high >= '0' && high <= '9' ? high - '0'
               : high >= 'a' && high <= 'f' ? high - 'a' + 10
                                             : -1;
    int right = low >= '0' && low <= '9' ? low - '0'
                : low >= 'a' && low <= 'f' ? low - 'a' + 10
                                           : -1;
    if (left < 0 || right < 0) {
      anc_pv_zeroize(output, 16);
      return NO;
    }
    output[index] = (uint8_t)((left << 4) | right);
  }
  return YES;
}
static BOOL RecordDigest(const uint8_t *record, uint8_t output[32]) {
  return anc_pv_blake2b_256_two_part(
             output, kRecoveryPreparationDigestDomain,
             sizeof kRecoveryPreparationDigestDomain, record,
             kRecoveryPreparationAuthenticatedBytes) == ANC_PV_CRYPTO_OK;
}

static BOOL EncodeRecord(
    uint8_t record[kRecoveryPreparationRecordBytes],
    const AncPrivateVaultRecoveryPreparationSnapshot *snapshot,
    const AncPrivateVaultRecoveryPreparationSecretInputs *secrets) {
  if (!ValidSnapshot(snapshot) || !ValidSecrets(secrets))
    return NO;
  memset(record, 0, kRecoveryPreparationRecordBytes);
  memcpy(record, kRecoveryPreparationMagic, 8);
  WriteU16(record + 8, 1);
  memcpy(record + 16, snapshot->vault_id, 16);
  memcpy(record + 32, snapshot->lookup_id, 16);
  memcpy(record + 48, snapshot->ceremony_id, 16);
  memcpy(record + 64, snapshot->candidate_endpoint_id, 16);
  memcpy(record + 80, snapshot->artifact_digest, 32);
  WriteU64(record + 112, snapshot->verified_at_ms);
  WriteU64(record + 120, snapshot->next_epoch);
  WriteU64(record + 128, snapshot->replacement_recovery_generation);
  WriteU64(record + 136, snapshot->expected_next_sequence);
  memcpy(record + 144, snapshot->expected_previous_head, 32);
  memcpy(record + 176, snapshot->recovery_authorization_hash, 32);
  memcpy(record + 208, snapshot->entry_id, 16);
  memcpy(record + 224, snapshot->entry_hash, 32);
  memcpy(record + 256, snapshot->recovery_wrap_hash, 32);
  memcpy(record + 288, snapshot->candidate_signing_public_key, 32);
  memcpy(record + 320, snapshot->candidate_key_agreement_public_key, 32);
  WriteU64(record + 352, snapshot->recovery_wrap_byte_length);
  memcpy(record + 360, snapshot->artifact_commitment, 32);
  memcpy(record + 392, secrets->endpoint_signing_seed, 32);
  memcpy(record + 424, secrets->endpoint_box_seed, 32);
  memcpy(record + 456, secrets->local_state_key, 32);
  memcpy(record + 488, secrets->eek, 32);
  return RecordDigest(record, record + 520);
}

static BOOL DecodeRecord(
    const uint8_t *record, size_t length,
    AncPrivateVaultRecoveryPreparationSnapshot *snapshot,
    uint8_t secrets[kRecoveryPreparationSecretBytes]) {
  if (record == NULL || length != kRecoveryPreparationRecordBytes ||
      memcmp(record, kRecoveryPreparationMagic, 8) != 0 ||
      ReadU16(record + 8) != 1 || !AllZero(record + 10, 6))
    return NO;
  uint8_t digest[32] = {0};
  BOOL authentic = RecordDigest(record, digest) &&
                   anc_pv_memcmp(digest, record + 520, 32) ==
                       ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(digest, sizeof digest);
  if (!authentic)
    return NO;
  AncPrivateVaultRecoveryPreparationSnapshot decoded = {0};
  memcpy(decoded.vault_id, record + 16, 16);
  memcpy(decoded.lookup_id, record + 32, 16);
  memcpy(decoded.ceremony_id, record + 48, 16);
  memcpy(decoded.candidate_endpoint_id, record + 64, 16);
  memcpy(decoded.artifact_digest, record + 80, 32);
  decoded.verified_at_ms = ReadU64(record + 112);
  decoded.next_epoch = ReadU64(record + 120);
  decoded.replacement_recovery_generation = ReadU64(record + 128);
  decoded.expected_next_sequence = ReadU64(record + 136);
  memcpy(decoded.expected_previous_head, record + 144, 32);
  memcpy(decoded.recovery_authorization_hash, record + 176, 32);
  memcpy(decoded.entry_id, record + 208, 16);
  memcpy(decoded.entry_hash, record + 224, 32);
  memcpy(decoded.recovery_wrap_hash, record + 256, 32);
  memcpy(decoded.candidate_signing_public_key, record + 288, 32);
  memcpy(decoded.candidate_key_agreement_public_key, record + 320, 32);
  decoded.recovery_wrap_byte_length = ReadU64(record + 352);
  memcpy(decoded.artifact_commitment, record + 360, 32);
  if (!ValidSnapshot(&decoded)) {
    anc_pv_zeroize(&decoded, sizeof decoded);
    return NO;
  }
  memcpy(secrets, record + kRecoveryPreparationPublicBytes,
         kRecoveryPreparationSecretBytes);
  *snapshot = decoded;
  return YES;
}

static AncPrivateVaultRecoveryPreparationStoreStatus StoreStatus(
    AncPrivateVaultKeychainStatus status) {
  switch (status) {
  case AncPrivateVaultKeychainStatusOK:
    return AncPrivateVaultRecoveryPreparationStoreStatusOK;
  case AncPrivateVaultKeychainStatusNotFound:
    return AncPrivateVaultRecoveryPreparationStoreStatusNotFound;
  case AncPrivateVaultKeychainStatusDuplicate:
    return AncPrivateVaultRecoveryPreparationStoreStatusConflict;
  case AncPrivateVaultKeychainStatusCorrupt:
    return AncPrivateVaultRecoveryPreparationStoreStatusCorrupt;
  case AncPrivateVaultKeychainStatusInaccessible:
    return AncPrivateVaultRecoveryPreparationStoreStatusInaccessible;
  case AncPrivateVaultKeychainStatusInvalid:
    return AncPrivateVaultRecoveryPreparationStoreStatusInvalid;
  case AncPrivateVaultKeychainStatusFailed:
    return AncPrivateVaultRecoveryPreparationStoreStatusFailed;
  }
  return AncPrivateVaultRecoveryPreparationStoreStatusFailed;
}

@interface AncPrivateVaultRecoveryPreparationSecretsHandle ()
@property(nonatomic) AncPrivateVaultGuardedMemory *memory;
@end

@implementation AncPrivateVaultRecoveryPreparationSecretsHandle
- (BOOL)isClosed { return self.memory == nil || self.memory.isClosed; }
- (AncPrivateVaultRecoveryPreparationStoreStatus)
    borrow:(AncPrivateVaultRecoveryPreparationSecretsBorrowBlock)block {
  if (block == nil || self.isClosed)
    return AncPrivateVaultRecoveryPreparationStoreStatusInvalid;
  AncPrivateVaultGuardedMemoryStatus status =
      [self.memory borrow:^BOOL(uint8_t *bytes, size_t length) {
        if (length != kRecoveryPreparationSecretBytes)
          return NO;
        AncPrivateVaultRecoveryPreparationSecretInputs secrets = {
            .endpoint_signing_seed = bytes,
            .endpoint_box_seed = bytes + 32,
            .local_state_key = bytes + 64,
            .eek = bytes + 96,
        };
        return block(&secrets);
      }];
  return status == AncPrivateVaultGuardedMemoryStatusOK
             ? AncPrivateVaultRecoveryPreparationStoreStatusOK
             : AncPrivateVaultRecoveryPreparationStoreStatusFailed;
}
- (AncPrivateVaultRecoveryPreparationStoreStatus)close {
  if (self.memory == nil)
    return AncPrivateVaultRecoveryPreparationStoreStatusOK;
  AncPrivateVaultGuardedMemoryStatus status = [self.memory close];
  self.memory = nil;
  return status == AncPrivateVaultGuardedMemoryStatusOK
             ? AncPrivateVaultRecoveryPreparationStoreStatusOK
             : AncPrivateVaultRecoveryPreparationStoreStatusFailed;
}
- (void)dealloc { [self close]; }
@end

@implementation AncPrivateVaultRecoveryPreparationEvidence
@end

static NSMapTable<AncPrivateVaultRecoveryPreparationEvidence *, NSData *> *
RecoveryPreparationEvidenceRegistry(void) {
  static NSMapTable *registry;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    registry = [NSMapTable weakToStrongObjectsMapTable];
  });
  return registry;
}
static NSLock *RecoveryPreparationEvidenceRegistryLock(void) {
  static NSLock *lock;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ lock = [NSLock new]; });
  return lock;
}
BOOL AncPrivateVaultRecoveryPreparationEvidenceCopySnapshot(
    AncPrivateVaultRecoveryPreparationEvidence *evidence,
    AncPrivateVaultRecoveryPreparationSnapshot *snapshot) {
  if (evidence == nil || snapshot == NULL)
    return NO;
  memset(snapshot, 0, sizeof *snapshot);
  NSLock *lock = RecoveryPreparationEvidenceRegistryLock();
  [lock lock];
  NSData *encoded = [RecoveryPreparationEvidenceRegistry() objectForKey:evidence];
  if (encoded.length == sizeof *snapshot)
    memcpy(snapshot, encoded.bytes, sizeof *snapshot);
  [lock unlock];
  return ValidSnapshot(snapshot);
}

@interface AncPrivateVaultRecoveryPreparationStore ()
@property(nonatomic) AncPrivateVaultKeychain *keychain;
@property(nonatomic) dispatch_queue_t queue;
@end

@implementation AncPrivateVaultRecoveryPreparationStore
- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain {
  self = [super init];
  if (self != nil) {
    if (keychain == nil)
      return nil;
    _keychain = keychain;
    _queue = dispatch_queue_create(
        "com.agentnative.private-vault.recovery-preparation",
        DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (AncPrivateVaultRecoveryPreparationStoreStatus)
    createSnapshot:(const AncPrivateVaultRecoveryPreparationSnapshot *)snapshot
            secrets:
                (const AncPrivateVaultRecoveryPreparationSecretInputs *)secrets {
  if (!ValidSnapshot(snapshot) || !ValidSecrets(secrets))
    return AncPrivateVaultRecoveryPreparationStoreStatusInvalid;
  NSString *vaultId = HexId(snapshot->vault_id);
  if (vaultId == nil)
    return AncPrivateVaultRecoveryPreparationStoreStatusInvalid;
  __block AncPrivateVaultRecoveryPreparationStoreStatus result =
      AncPrivateVaultRecoveryPreparationStoreStatusFailed;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGuardedMemoryStatus memoryStatus;
    AncPrivateVaultGuardedMemory *record = [AncPrivateVaultGuardedMemory
        memoryWithLength:kRecoveryPreparationRecordBytes
                  status:&memoryStatus];
    if (record == nil)
      return;
    __block BOOL encoded = NO;
    AncPrivateVaultGuardedMemoryStatus borrowed =
        [record borrow:^BOOL(uint8_t *bytes, size_t length) {
          encoded = length == kRecoveryPreparationRecordBytes &&
                    EncodeRecord(bytes, snapshot, secrets);
          if (!encoded)
            return NO;
          AncPrivateVaultKeychainStatus added = [self.keychain
              addBytes:bytes
                 length:length
             forService:AncPrivateVaultRecoveryPreparationService
                vaultId:vaultId
               recordId:AncPrivateVaultRecoveryPreparationRecordId];
          if (added == AncPrivateVaultKeychainStatusDuplicate ||
              added == AncPrivateVaultKeychainStatusCorrupt) {
            __block BOOL exact = NO, structurallyValid = NO;
            __block AncPrivateVaultRecoveryPreparationSnapshot presentSnapshot =
                {0};
            NSMutableData *presentSecrets =
                [NSMutableData dataWithLength:kRecoveryPreparationSecretBytes];
            AncPrivateVaultKeychainStatus observed = [self.keychain
                consumeBytesForService:
                    AncPrivateVaultRecoveryPreparationService
                                 vaultId:vaultId
                                recordId:
                                    AncPrivateVaultRecoveryPreparationRecordId
                                consumer:^BOOL(const uint8_t *present,
                                               size_t presentLength) {
                                  exact = presentLength == length &&
                                          anc_pv_memcmp(present, bytes,
                                                        length) ==
                                              ANC_PV_CRYPTO_OK;
                                  structurallyValid = DecodeRecord(
                                      present, presentLength, &presentSnapshot,
                                      presentSecrets.mutableBytes);
                                  return YES;
                                }];
            if (observed != AncPrivateVaultKeychainStatusOK)
              result = StoreStatus(observed);
            else if (exact)
              result = AncPrivateVaultRecoveryPreparationStoreStatusOK;
            else if (structurallyValid)
              result = AncPrivateVaultRecoveryPreparationStoreStatusConflict;
            else
              result = AncPrivateVaultRecoveryPreparationStoreStatusCorrupt;
            anc_pv_zeroize(&presentSnapshot, sizeof presentSnapshot);
            anc_pv_zeroize(presentSecrets.mutableBytes,
                           presentSecrets.length);
          } else {
            result = StoreStatus(added);
          }
          return YES;
        }];
    AncPrivateVaultGuardedMemoryStatus closed = [record close];
    if (!encoded || borrowed != AncPrivateVaultGuardedMemoryStatusOK ||
        closed != AncPrivateVaultGuardedMemoryStatusOK)
      result = AncPrivateVaultRecoveryPreparationStoreStatusFailed;
  });
  return result;
}

- (AncPrivateVaultRecoveryPreparationStoreStatus)
    readVaultId:(NSString *)vaultId
       snapshot:(AncPrivateVaultRecoveryPreparationSnapshot *)snapshot
         handle:(AncPrivateVaultRecoveryPreparationSecretsHandle **)handle {
  if (snapshot != NULL)
    memset(snapshot, 0, sizeof *snapshot);
  if (handle != NULL)
    *handle = nil;
  NSMutableData *expectedVault = [NSMutableData dataWithLength:16];
  if (snapshot == NULL ||
      !ParseHexId(vaultId, expectedVault.mutableBytes))
    return AncPrivateVaultRecoveryPreparationStoreStatusInvalid;
  __block AncPrivateVaultRecoveryPreparationStoreStatus result =
      AncPrivateVaultRecoveryPreparationStoreStatusFailed;
  __block AncPrivateVaultRecoveryPreparationSnapshot decoded = {0};
  __block AncPrivateVaultRecoveryPreparationSecretsHandle *secretHandle = nil;
  dispatch_sync(self.queue, ^{
    AncPrivateVaultGuardedMemoryStatus memoryStatus;
    AncPrivateVaultGuardedMemory *ownedSecrets = [AncPrivateVaultGuardedMemory
        memoryWithLength:kRecoveryPreparationSecretBytes
                  status:&memoryStatus];
    if (ownedSecrets == nil)
      return;
    __block BOOL decodedOkay = NO;
    AncPrivateVaultKeychainStatus read = [self.keychain
        consumeBytesForService:AncPrivateVaultRecoveryPreparationService
                       vaultId:vaultId
                      recordId:AncPrivateVaultRecoveryPreparationRecordId
                      consumer:^BOOL(const uint8_t *record, size_t length) {
                        return [ownedSecrets
                                   borrow:^BOOL(uint8_t *secrets,
                                                size_t secretsLength) {
                                     decodedOkay =
                                         secretsLength ==
                                             kRecoveryPreparationSecretBytes &&
                                         DecodeRecord(record, length, &decoded,
                                                      secrets) &&
                                         anc_pv_memcmp(decoded.vault_id,
                                                       expectedVault.bytes,
                                                       16) ==
                                             ANC_PV_CRYPTO_OK;
                                     return decodedOkay;
                                   }] ==
                                   AncPrivateVaultGuardedMemoryStatusOK &&
                               decodedOkay;
                      }];
    if (read != AncPrivateVaultKeychainStatusOK || !decodedOkay) {
      [ownedSecrets close];
      result = read == AncPrivateVaultKeychainStatusOK
                   ? AncPrivateVaultRecoveryPreparationStoreStatusCorrupt
                   : StoreStatus(read);
      return;
    }
    secretHandle = [AncPrivateVaultRecoveryPreparationSecretsHandle new];
    secretHandle.memory = ownedSecrets;
    result = AncPrivateVaultRecoveryPreparationStoreStatusOK;
  });
  anc_pv_zeroize(expectedVault.mutableBytes, expectedVault.length);
  if (result == AncPrivateVaultRecoveryPreparationStoreStatusOK) {
    *snapshot = decoded;
    if (handle != NULL)
      *handle = secretHandle;
    else if ([secretHandle close] !=
             AncPrivateVaultRecoveryPreparationStoreStatusOK)
      return AncPrivateVaultRecoveryPreparationStoreStatusFailed;
  } else {
    anc_pv_zeroize(&decoded, sizeof decoded);
  }
  return result;
}

- (AncPrivateVaultRecoveryPreparationStoreStatus)
    readEvidenceVaultId:(NSString *)vaultId
               evidence:(AncPrivateVaultRecoveryPreparationEvidence **)evidence
                 handle:(AncPrivateVaultRecoveryPreparationSecretsHandle **)handle {
  if (evidence == NULL)
    return AncPrivateVaultRecoveryPreparationStoreStatusInvalid;
  *evidence = nil;
  AncPrivateVaultRecoveryPreparationSnapshot snapshot = {0};
  AncPrivateVaultRecoveryPreparationSecretsHandle *secrets = nil;
  AncPrivateVaultRecoveryPreparationStoreStatus status =
      [self readVaultId:vaultId snapshot:&snapshot handle:&secrets];
  if (status != AncPrivateVaultRecoveryPreparationStoreStatusOK)
    return status;
  AncPrivateVaultRecoveryPreparationEvidence *result =
      class_createInstance(AncPrivateVaultRecoveryPreparationEvidence.class,
                           0);
  NSData *encoded = [NSData dataWithBytes:&snapshot length:sizeof snapshot];
  NSLock *lock = RecoveryPreparationEvidenceRegistryLock();
  [lock lock];
  BOOL registered = RecoveryPreparationEvidenceRegistry().count < 256 &&
                    result != nil && encoded.length == sizeof snapshot;
  if (registered)
    [RecoveryPreparationEvidenceRegistry() setObject:encoded forKey:result];
  [lock unlock];
  anc_pv_zeroize(&snapshot, sizeof snapshot);
  if (!registered) {
    [secrets close];
    return AncPrivateVaultRecoveryPreparationStoreStatusFailed;
  }
  *evidence = result;
  if (handle != NULL)
    *handle = secrets;
  else if ([secrets close] != AncPrivateVaultRecoveryPreparationStoreStatusOK)
    return AncPrivateVaultRecoveryPreparationStoreStatusFailed;
  return AncPrivateVaultRecoveryPreparationStoreStatusOK;
}

- (AncPrivateVaultRecoveryPreparationStoreStatus)deleteVaultId:
    (NSString *)vaultId {
  uint8_t parsed[16] = {0};
  if (!ParseHexId(vaultId, parsed))
    return AncPrivateVaultRecoveryPreparationStoreStatusInvalid;
  anc_pv_zeroize(parsed, sizeof parsed);
  __block AncPrivateVaultKeychainStatus status;
  dispatch_sync(self.queue, ^{
    status = [self.keychain
        deleteDataForService:AncPrivateVaultRecoveryPreparationService
                     vaultId:vaultId
                    recordId:AncPrivateVaultRecoveryPreparationRecordId];
  });
  return status == AncPrivateVaultKeychainStatusNotFound
             ? AncPrivateVaultRecoveryPreparationStoreStatusOK
             : StoreStatus(status);
}
@end
