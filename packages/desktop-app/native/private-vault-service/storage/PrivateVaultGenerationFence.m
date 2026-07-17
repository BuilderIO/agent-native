#import "PrivateVaultGenerationFence.h"

#import "PrivateVaultCrypto.h"

static const uint8_t kFenceMagic[8] = {'A', 'N', 'P', 'V', 'G', 'F', '0', '1'};
static const uint8_t kFenceCodecVersion = 1;
static const NSUInteger kMaximumIdentifierBytes = 512;
static const NSUInteger kFixedCodecBytes = 8 + 1 + 1 + 2 + 8 + 32 + 32;
static const char kFenceDigestDomain[] = "anc/v1/private-vault/generation-fence";
static const char kFenceIdentityDomain[] =
    "anc/v1/private-vault/generation-fence-identity";

@interface AncPrivateVaultFenceSnapshot ()
@property(nonatomic, readwrite) AncPrivateVaultFenceState state;
@property(nonatomic, readwrite) uint64_t generation;
@end

@implementation AncPrivateVaultFenceSnapshot
@end

@interface AncPrivateVaultGenerationFence ()
@property(nonatomic, strong) AncPrivateVaultKeychain *keychain;
@property(nonatomic, strong) dispatch_queue_t queue;
@end

typedef struct AncFencePair {
  AncPrivateVaultFenceState fenceState;
  uint64_t fenceGeneration;
  AncPrivateVaultFenceState highWaterState;
  uint64_t highWaterGeneration;
  BOOL absent;
  BOOL initializing;
} AncFencePair;

static dispatch_queue_t AncFenceQueue(void) {
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create("com.agentnative.private-vault.fence",
                                  DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

static void AncAppendUInt64(NSMutableData *data, uint64_t value) {
  uint64_t big = CFSwapInt64HostToBig(value);
  [data appendBytes:&big length:sizeof(big)];
}

static BOOL AncFenceIdentity(NSString *vaultId, NSString *recordId,
                             uint8_t output[ANC_PV_HASH_BYTES]) {
  NSData *vault = [vaultId dataUsingEncoding:NSUTF8StringEncoding];
  NSData *record = [recordId dataUsingEncoding:NSUTF8StringEncoding];
  if (vault.length == 0 || record.length == 0 ||
      vault.length > kMaximumIdentifierBytes ||
      record.length > kMaximumIdentifierBytes) {
    return NO;
  }
  NSMutableData *input =
      [NSMutableData dataWithBytes:kFenceIdentityDomain
                            length:sizeof(kFenceIdentityDomain) - 1];
  uint32_t vaultLength = CFSwapInt32HostToBig((uint32_t)vault.length);
  uint32_t recordLength = CFSwapInt32HostToBig((uint32_t)record.length);
  [input appendBytes:&vaultLength length:sizeof(vaultLength)];
  [input appendData:vault];
  [input appendBytes:&recordLength length:sizeof(recordLength)];
  [input appendData:record];
  return anc_pv_blake2b_256(output, input.bytes, input.length) ==
         ANC_PV_CRYPTO_OK;
}

static NSData *_Nullable AncFenceEncode(AncPrivateVaultFenceState state,
                                        uint64_t generation,
                                        NSString *vaultId,
                                        NSString *recordId) {
  if ((state != AncPrivateVaultFenceStatePending &&
       state != AncPrivateVaultFenceStateStable) ||
      generation == 0) {
    return nil;
  }
  uint8_t identity[ANC_PV_HASH_BYTES];
  if (!AncFenceIdentity(vaultId, recordId, identity)) return nil;
  NSMutableData *body = [NSMutableData dataWithBytes:kFenceMagic
                                              length:sizeof(kFenceMagic)];
  uint8_t version = kFenceCodecVersion;
  uint8_t encodedState = (uint8_t)state;
  uint16_t reserved = 0;
  [body appendBytes:&version length:sizeof(version)];
  [body appendBytes:&encodedState length:sizeof(encodedState)];
  [body appendBytes:&reserved length:sizeof(reserved)];
  AncAppendUInt64(body, generation);
  [body appendBytes:identity length:sizeof(identity)];
  anc_pv_zeroize(identity, sizeof(identity));

  NSMutableData *digestInput =
      [NSMutableData dataWithBytes:kFenceDigestDomain
                            length:sizeof(kFenceDigestDomain) - 1];
  [digestInput appendData:body];
  uint8_t digest[ANC_PV_HASH_BYTES];
  if (anc_pv_blake2b_256(digest, digestInput.bytes, digestInput.length) !=
      ANC_PV_CRYPTO_OK) {
    return nil;
  }
  [body appendBytes:digest length:sizeof(digest)];
  anc_pv_zeroize(digest, sizeof(digest));
  return body;
}

static BOOL AncFenceDecode(NSData *data, NSString *expectedVaultId,
                           NSString *expectedRecordId,
                           AncPrivateVaultFenceState *state,
                           uint64_t *generation) {
  if (data.length != kFixedCodecBytes) return NO;
  const uint8_t *bytes = data.bytes;
  if (memcmp(bytes, kFenceMagic, sizeof(kFenceMagic)) != 0 ||
      bytes[8] != kFenceCodecVersion ||
      (bytes[9] != AncPrivateVaultFenceStatePending &&
       bytes[9] != AncPrivateVaultFenceStateStable) ||
      bytes[10] != 0 || bytes[11] != 0) {
    return NO;
  }
  uint64_t encodedGeneration = 0;
  memcpy(&encodedGeneration, bytes + 12, sizeof(encodedGeneration));
  encodedGeneration = CFSwapInt64BigToHost(encodedGeneration);
  if (encodedGeneration == 0) return NO;
  const NSUInteger identityOffset = 20;
  uint8_t expectedIdentity[ANC_PV_HASH_BYTES];
  if (!AncFenceIdentity(expectedVaultId, expectedRecordId, expectedIdentity)) {
    return NO;
  }
  BOOL identityMatches =
      anc_pv_memcmp(expectedIdentity, bytes + identityOffset,
                    ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(expectedIdentity, sizeof(expectedIdentity));
  if (!identityMatches) return NO;
  const NSUInteger digestOffset = identityOffset + ANC_PV_HASH_BYTES;
  NSMutableData *digestInput =
      [NSMutableData dataWithBytes:kFenceDigestDomain
                            length:sizeof(kFenceDigestDomain) - 1];
  [digestInput appendBytes:bytes length:digestOffset];
  uint8_t digest[ANC_PV_HASH_BYTES];
  BOOL valid = anc_pv_blake2b_256(digest, digestInput.bytes,
                                  digestInput.length) == ANC_PV_CRYPTO_OK &&
               anc_pv_memcmp(digest, bytes + digestOffset,
                             ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(digest, sizeof(digest));
  if (!valid) return NO;
  *state = (AncPrivateVaultFenceState)bytes[9];
  *generation = encodedGeneration;
  return YES;
}

static AncPrivateVaultFenceStatus AncFenceStatusForKeychain(
    AncPrivateVaultKeychainStatus status) {
  switch (status) {
    case AncPrivateVaultKeychainStatusOK:
      return AncPrivateVaultFenceStatusOK;
    case AncPrivateVaultKeychainStatusCorrupt:
      return AncPrivateVaultFenceStatusCorrupt;
    case AncPrivateVaultKeychainStatusInaccessible:
      return AncPrivateVaultFenceStatusInaccessible;
    case AncPrivateVaultKeychainStatusInvalid:
      return AncPrivateVaultFenceStatusInvalid;
    case AncPrivateVaultKeychainStatusNotFound:
    case AncPrivateVaultKeychainStatusDuplicate:
    case AncPrivateVaultKeychainStatusFailed:
      return AncPrivateVaultFenceStatusFailed;
  }
}

@implementation AncPrivateVaultGenerationFence

- (instancetype)init {
  return [self initWithKeychain:[[AncPrivateVaultKeychain alloc] init]];
}

- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain {
  self = [super init];
  if (self == nil) return nil;
  if (keychain == nil) return nil;
  _keychain = keychain;
  _queue = AncFenceQueue();
  return self;
}

- (AncPrivateVaultFenceStatus)readPairVaultId:(NSString *)vaultId
                                      recordId:(NSString *)recordId
                                          pair:(AncFencePair *)pair {
  NSData *fenceData = nil;
  NSData *highWaterData = nil;
  AncPrivateVaultKeychainStatus fenceStatus =
      [self.keychain copyDataForService:AncPrivateVaultFenceService
                                vaultId:vaultId
                               recordId:recordId
                                   data:&fenceData];
  AncPrivateVaultKeychainStatus highWaterStatus =
      [self.keychain copyDataForService:AncPrivateVaultHighWaterService
                                vaultId:vaultId
                               recordId:recordId
                                   data:&highWaterData];
  if (fenceStatus == AncPrivateVaultKeychainStatusNotFound &&
      highWaterStatus == AncPrivateVaultKeychainStatusNotFound) {
    memset(pair, 0, sizeof(*pair));
    pair->absent = YES;
    return AncPrivateVaultFenceStatusOK;
  }
  if (fenceStatus != AncPrivateVaultKeychainStatusOK &&
      fenceStatus != AncPrivateVaultKeychainStatusNotFound) {
    return AncFenceStatusForKeychain(fenceStatus);
  }
  if (highWaterStatus != AncPrivateVaultKeychainStatusOK &&
      highWaterStatus != AncPrivateVaultKeychainStatusNotFound) {
    return AncFenceStatusForKeychain(highWaterStatus);
  }
  if (fenceStatus == AncPrivateVaultKeychainStatusNotFound &&
      highWaterStatus == AncPrivateVaultKeychainStatusOK) {
    memset(pair, 0, sizeof(*pair));
    if (!AncFenceDecode(highWaterData, vaultId, recordId,
                        &pair->highWaterState,
                        &pair->highWaterGeneration)) {
      return AncPrivateVaultFenceStatusCorrupt;
    }
    // The sole recoverable missing-item state is the first-create crash seam:
    // high-water pending generation 1 was durable but the matching fence add
    // did not return. When the companion high-water record is stable, a missing
    // item is rollback and fails closed.
    if (pair->highWaterState == AncPrivateVaultFenceStatePending &&
        pair->highWaterGeneration == 1) {
      pair->initializing = YES;
      return AncPrivateVaultFenceStatusOK;
    }
    return AncPrivateVaultFenceStatusRollbackDetected;
  }
  if (fenceStatus == AncPrivateVaultKeychainStatusNotFound ||
      highWaterStatus == AncPrivateVaultKeychainStatusNotFound) {
    return AncPrivateVaultFenceStatusRollbackDetected;
  }
  memset(pair, 0, sizeof(*pair));
  if (!AncFenceDecode(fenceData, vaultId, recordId, &pair->fenceState,
                      &pair->fenceGeneration) ||
      !AncFenceDecode(highWaterData, vaultId, recordId,
                      &pair->highWaterState, &pair->highWaterGeneration)) {
    return AncPrivateVaultFenceStatusCorrupt;
  }
  if (pair->fenceState == pair->highWaterState &&
      pair->fenceGeneration == pair->highWaterGeneration) {
    return AncPrivateVaultFenceStatusOK;
  }
  if (pair->fenceState == AncPrivateVaultFenceStateStable &&
      pair->highWaterState == AncPrivateVaultFenceStatePending &&
      (pair->highWaterGeneration == pair->fenceGeneration ||
       (pair->fenceGeneration != UINT64_MAX &&
        pair->highWaterGeneration == pair->fenceGeneration + 1))) {
    return AncPrivateVaultFenceStatusOK;
  }
  return AncPrivateVaultFenceStatusRollbackDetected;
}

- (AncPrivateVaultFenceStatus)writeData:(NSData *)target
                                service:(NSString *)service
                                vaultId:(NSString *)vaultId
                               recordId:(NSString *)recordId
                                    add:(BOOL)add {
  AncPrivateVaultKeychainStatus status =
      add ? [self.keychain addData:target
                        forService:service
                           vaultId:vaultId
                          recordId:recordId]
          : [self.keychain updateData:target
                           forService:service
                              vaultId:vaultId
                             recordId:recordId];
  if (status == AncPrivateVaultKeychainStatusOK) {
    return AncPrivateVaultFenceStatusOK;
  }
  // SecItem writes can commit and still surface an interruption. Reread and
  // accept only byte-for-byte equality with the exact intended target.
  NSData *observed = nil;
  AncPrivateVaultKeychainStatus readStatus =
      [self.keychain copyDataForService:service
                                vaultId:vaultId
                               recordId:recordId
                                   data:&observed];
  if (readStatus == AncPrivateVaultKeychainStatusOK &&
      [observed isEqualToData:target]) {
    return AncPrivateVaultFenceStatusOK;
  }
  if (readStatus == AncPrivateVaultKeychainStatusOK) {
    return AncPrivateVaultFenceStatusConflict;
  }
  if (readStatus == AncPrivateVaultKeychainStatusNotFound) {
    return AncFenceStatusForKeychain(status);
  }
  return AncFenceStatusForKeychain(readStatus);
}

- (AncPrivateVaultFenceStatus)beginLockedGeneration:(uint64_t)generation
                                            vaultId:(NSString *)vaultId
                                           recordId:(NSString *)recordId {
  NSData *pending = AncFenceEncode(AncPrivateVaultFenceStatePending,
                                   generation, vaultId, recordId);
  if (pending == nil) return AncPrivateVaultFenceStatusInvalid;
  AncFencePair pair;
  AncPrivateVaultFenceStatus status =
      [self readPairVaultId:vaultId recordId:recordId pair:&pair];
  if (status != AncPrivateVaultFenceStatusOK) return status;
  if (pair.absent) {
    if (generation != 1) return AncPrivateVaultFenceStatusConflict;
    status = [self writeData:pending
                     service:AncPrivateVaultHighWaterService
                     vaultId:vaultId
                    recordId:recordId
                         add:YES];
    if (status != AncPrivateVaultFenceStatusOK) return status;
    return [self writeData:pending
                   service:AncPrivateVaultFenceService
                   vaultId:vaultId
                  recordId:recordId
                       add:YES];
  }
  if (pair.initializing) {
    if (generation != 1) return AncPrivateVaultFenceStatusConflict;
    return [self writeData:pending
                   service:AncPrivateVaultFenceService
                   vaultId:vaultId
                  recordId:recordId
                       add:YES];
  }
  if (pair.fenceState == AncPrivateVaultFenceStatePending &&
      pair.highWaterState == AncPrivateVaultFenceStatePending &&
      pair.fenceGeneration == generation &&
      pair.highWaterGeneration == generation) {
    return AncPrivateVaultFenceStatusOK;
  }
  if (pair.fenceState != AncPrivateVaultFenceStateStable) {
    return AncPrivateVaultFenceStatusConflict;
  }
  // Finish an interrupted commit before considering the next generation.
  if (pair.highWaterState == AncPrivateVaultFenceStatePending &&
      pair.highWaterGeneration == pair.fenceGeneration) {
    NSData *stable = AncFenceEncode(AncPrivateVaultFenceStateStable,
                                    pair.fenceGeneration, vaultId, recordId);
    status = [self writeData:stable
                     service:AncPrivateVaultHighWaterService
                     vaultId:vaultId
                    recordId:recordId
                         add:NO];
    if (status != AncPrivateVaultFenceStatusOK) return status;
    pair.highWaterState = AncPrivateVaultFenceStateStable;
  }
  if (pair.fenceGeneration == UINT64_MAX ||
      generation != pair.fenceGeneration + 1) {
    return AncPrivateVaultFenceStatusConflict;
  }
  if (pair.highWaterState == AncPrivateVaultFenceStatePending &&
      pair.highWaterGeneration == generation) {
    return [self writeData:pending
                   service:AncPrivateVaultFenceService
                   vaultId:vaultId
                  recordId:recordId
                       add:NO];
  }
  if (pair.highWaterState != AncPrivateVaultFenceStateStable ||
      pair.highWaterGeneration != pair.fenceGeneration) {
    return AncPrivateVaultFenceStatusRollbackDetected;
  }
  status = [self writeData:pending
                   service:AncPrivateVaultHighWaterService
                   vaultId:vaultId
                  recordId:recordId
                       add:NO];
  if (status != AncPrivateVaultFenceStatusOK) return status;
  return [self writeData:pending
                 service:AncPrivateVaultFenceService
                 vaultId:vaultId
                recordId:recordId
                     add:NO];
}

- (AncPrivateVaultFenceStatus)commitLockedGeneration:(uint64_t)generation
                                             vaultId:(NSString *)vaultId
                                            recordId:(NSString *)recordId {
  NSData *stable = AncFenceEncode(AncPrivateVaultFenceStateStable, generation,
                                  vaultId, recordId);
  if (stable == nil) return AncPrivateVaultFenceStatusInvalid;
  AncFencePair pair;
  AncPrivateVaultFenceStatus status =
      [self readPairVaultId:vaultId recordId:recordId pair:&pair];
  if (status != AncPrivateVaultFenceStatusOK) return status;
  if (pair.absent) return AncPrivateVaultFenceStatusConflict;
  if (pair.initializing) return AncPrivateVaultFenceStatusConflict;
  if (pair.fenceState == AncPrivateVaultFenceStateStable &&
      pair.fenceGeneration == generation &&
      pair.highWaterGeneration == generation) {
    if (pair.highWaterState == AncPrivateVaultFenceStateStable) {
      return AncPrivateVaultFenceStatusOK;
    }
    return [self writeData:stable
                   service:AncPrivateVaultHighWaterService
                   vaultId:vaultId
                  recordId:recordId
                       add:NO];
  }
  if (pair.fenceState != AncPrivateVaultFenceStatePending ||
      pair.highWaterState != AncPrivateVaultFenceStatePending ||
      pair.fenceGeneration != generation ||
      pair.highWaterGeneration != generation) {
    return AncPrivateVaultFenceStatusConflict;
  }
  status = [self writeData:stable
                   service:AncPrivateVaultFenceService
                   vaultId:vaultId
                  recordId:recordId
                       add:NO];
  if (status != AncPrivateVaultFenceStatusOK) return status;
  return [self writeData:stable
                 service:AncPrivateVaultHighWaterService
                 vaultId:vaultId
                recordId:recordId
                     add:NO];
}

- (AncPrivateVaultFenceStatus)beginGeneration:(uint64_t)generation
                                      vaultId:(NSString *)vaultId
                                     recordId:(NSString *)recordId {
  __block AncPrivateVaultFenceStatus status;
  dispatch_sync(self.queue, ^{
    status = [self beginLockedGeneration:generation
                                 vaultId:vaultId
                                recordId:recordId];
  });
  return status;
}

- (AncPrivateVaultFenceStatus)commitGeneration:(uint64_t)generation
                                       vaultId:(NSString *)vaultId
                                      recordId:(NSString *)recordId {
  __block AncPrivateVaultFenceStatus status;
  dispatch_sync(self.queue, ^{
    status = [self commitLockedGeneration:generation
                                  vaultId:vaultId
                                 recordId:recordId];
  });
  return status;
}

- (AncPrivateVaultFenceStatus)readVaultId:(NSString *)vaultId
                                  recordId:(NSString *)recordId
                                  snapshot:
                                      (AncPrivateVaultFenceSnapshot **)snapshot {
  if (snapshot == NULL) return AncPrivateVaultFenceStatusInvalid;
  *snapshot = nil;
  __block AncPrivateVaultFenceStatus status;
  __block AncFencePair pair;
  dispatch_sync(self.queue, ^{
    status = [self readPairVaultId:vaultId recordId:recordId pair:&pair];
  });
  if (status != AncPrivateVaultFenceStatusOK) return status;
  AncPrivateVaultFenceSnapshot *value =
      [[AncPrivateVaultFenceSnapshot alloc] init];
  if (pair.absent) {
    value.state = AncPrivateVaultFenceStateAbsent;
    value.generation = 0;
  } else if (pair.initializing) {
    value.state = AncPrivateVaultFenceStatePending;
    value.generation = 1;
  } else if (pair.fenceState == AncPrivateVaultFenceStateStable &&
             pair.highWaterState == AncPrivateVaultFenceStatePending &&
             pair.fenceGeneration != UINT64_MAX &&
             pair.highWaterGeneration == pair.fenceGeneration + 1) {
    // Never report the older stable frame as current once the high-water item
    // durably records the next generation. The caller must finish roll-forward.
    value.state = AncPrivateVaultFenceStatePending;
    value.generation = pair.highWaterGeneration;
  } else {
    value.state = pair.fenceState;
    value.generation = pair.fenceGeneration;
  }
  *snapshot = value;
  return AncPrivateVaultFenceStatusOK;
}

@end
