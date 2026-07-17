#import "PrivateVaultGenerationFence.h"

static const uint8_t kFenceMagic[8] = {'A', 'N', 'P', 'V', 'G', 'F', '0', '2'};
static const uint8_t kFenceCodecVersion = 2;
static const NSUInteger kMaximumIdentifierBytes = 512;
static const NSUInteger kFixedCodecBytes = 8 + 1 + 1 + 2 + 8 + 32 + 32 + 32;
static const char kFenceDigestDomain[] = "anc/v1/private-vault/generation-fence";
static const char kFenceIdentityDomain[] =
    "anc/v1/private-vault/generation-fence-identity";

@interface AncPrivateVaultFenceSnapshot ()
@property(nonatomic, readwrite) AncPrivateVaultFenceState state;
@property(nonatomic, readwrite) uint64_t generation;
@property(nonatomic, readwrite) NSData *recordDigest;
@end

@implementation AncPrivateVaultFenceSnapshot
@end

typedef struct AncFencePair {
  AncPrivateVaultFenceState fenceState;
  uint64_t fenceGeneration;
  uint8_t fenceDigest[ANC_PV_HASH_BYTES];
  AncPrivateVaultFenceState highWaterState;
  uint64_t highWaterGeneration;
  uint8_t highWaterDigest[ANC_PV_HASH_BYTES];
  BOOL absent;
  BOOL initializing;
} AncFencePair;

@interface AncPrivateVaultGenerationFence ()
@property(nonatomic, strong) AncPrivateVaultKeychain *keychain;
@property(nonatomic, strong) dispatch_queue_t queue;
@end

static dispatch_queue_t AncFenceQueue(void) {
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create("com.agentnative.private-vault.fence",
                                  DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

static BOOL AncDigestEquals(const uint8_t left[ANC_PV_HASH_BYTES],
                            const uint8_t right[ANC_PV_HASH_BYTES]) {
  return anc_pv_memcmp(left, right, ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK;
}

static BOOL AncDigestData(NSData *data, uint8_t output[ANC_PV_HASH_BYTES]) {
  if (data.length != ANC_PV_HASH_BYTES) return NO;
  memcpy(output, data.bytes, ANC_PV_HASH_BYTES);
  return YES;
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
                            length:sizeof(kFenceIdentityDomain)];
  uint32_t vaultLength = CFSwapInt32HostToBig((uint32_t)vault.length);
  uint32_t recordLength = CFSwapInt32HostToBig((uint32_t)record.length);
  [input appendBytes:&vaultLength length:sizeof(vaultLength)];
  [input appendData:vault];
  [input appendBytes:&recordLength length:sizeof(recordLength)];
  [input appendData:record];
  BOOL ok = anc_pv_blake2b_256(output, input.bytes, input.length) ==
            ANC_PV_CRYPTO_OK;
  return ok;
}

static NSData *_Nullable AncFenceEncode(
    AncPrivateVaultFenceState state, uint64_t generation,
    const uint8_t recordDigest[ANC_PV_HASH_BYTES], NSString *vaultId,
    NSString *recordId) {
  if ((state != AncPrivateVaultFenceStatePending &&
       state != AncPrivateVaultFenceStateStable) ||
      generation == 0 || recordDigest == NULL) {
    return nil;
  }
  uint8_t identity[ANC_PV_HASH_BYTES] = {0};
  if (!AncFenceIdentity(vaultId, recordId, identity)) return nil;
  NSMutableData *body = [NSMutableData dataWithBytes:kFenceMagic
                                              length:sizeof kFenceMagic];
  const uint8_t version = kFenceCodecVersion;
  const uint8_t encodedState = (uint8_t)state;
  const uint16_t reserved = 0;
  uint64_t bigGeneration = CFSwapInt64HostToBig(generation);
  [body appendBytes:&version length:1];
  [body appendBytes:&encodedState length:1];
  [body appendBytes:&reserved length:2];
  [body appendBytes:&bigGeneration length:8];
  [body appendBytes:identity length:32];
  [body appendBytes:recordDigest length:32];
  anc_pv_zeroize(identity, sizeof identity);
  NSMutableData *integrityInput =
      [NSMutableData dataWithBytes:kFenceDigestDomain
                            length:sizeof kFenceDigestDomain];
  [integrityInput appendData:body];
  uint8_t integrity[ANC_PV_HASH_BYTES] = {0};
  if (anc_pv_blake2b_256(integrity, integrityInput.bytes,
                         integrityInput.length) != ANC_PV_CRYPTO_OK) {
    anc_pv_zeroize(integrity, sizeof integrity);
    return nil;
  }
  [body appendBytes:integrity length:32];
  anc_pv_zeroize(integrity, sizeof integrity);
  return body;
}

static BOOL AncFenceDecode(NSData *data, NSString *vaultId, NSString *recordId,
                           AncPrivateVaultFenceState *state,
                           uint64_t *generation,
                           uint8_t recordDigest[ANC_PV_HASH_BYTES]) {
  if (data.length != kFixedCodecBytes) return NO;
  const uint8_t *bytes = data.bytes;
  if (memcmp(bytes, kFenceMagic, 8) != 0 || bytes[8] != 2 ||
      (bytes[9] != AncPrivateVaultFenceStatePending &&
       bytes[9] != AncPrivateVaultFenceStateStable) ||
      bytes[10] != 0 || bytes[11] != 0) {
    return NO;
  }
  uint64_t encodedGeneration = 0;
  memcpy(&encodedGeneration, bytes + 12, 8);
  encodedGeneration = CFSwapInt64BigToHost(encodedGeneration);
  if (encodedGeneration == 0) return NO;
  uint8_t identity[32] = {0};
  if (!AncFenceIdentity(vaultId, recordId, identity)) return NO;
  BOOL identityOK = AncDigestEquals(identity, bytes + 20);
  anc_pv_zeroize(identity, sizeof identity);
  if (!identityOK) return NO;
  NSMutableData *integrityInput =
      [NSMutableData dataWithBytes:kFenceDigestDomain
                            length:sizeof kFenceDigestDomain];
  [integrityInput appendBytes:bytes length:84];
  uint8_t integrity[32] = {0};
  BOOL integrityOK =
      anc_pv_blake2b_256(integrity, integrityInput.bytes,
                         integrityInput.length) == ANC_PV_CRYPTO_OK &&
      AncDigestEquals(integrity, bytes + 84);
  anc_pv_zeroize(integrity, sizeof integrity);
  if (!integrityOK) return NO;
  *state = (AncPrivateVaultFenceState)bytes[9];
  *generation = encodedGeneration;
  memcpy(recordDigest, bytes + 52, 32);
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
  if (self == nil || keychain == nil) return nil;
  _keychain = keychain;
  _queue = AncFenceQueue();
  return self;
}

- (AncPrivateVaultFenceStatus)readPairVaultId:(NSString *)vaultId
                                      recordId:(NSString *)recordId
                                          pair:(AncFencePair *)pair {
  memset(pair, 0, sizeof *pair);
  NSData *fenceData = nil;
  NSData *highData = nil;
  AncPrivateVaultKeychainStatus fenceStatus =
      [self.keychain copyDataForService:AncPrivateVaultFenceService
                                vaultId:vaultId
                               recordId:recordId
                                   data:&fenceData];
  AncPrivateVaultKeychainStatus highStatus =
      [self.keychain copyDataForService:AncPrivateVaultHighWaterService
                                vaultId:vaultId
                               recordId:recordId
                                   data:&highData];
  if (fenceStatus == AncPrivateVaultKeychainStatusNotFound &&
      highStatus == AncPrivateVaultKeychainStatusNotFound) {
    pair->absent = YES;
    return AncPrivateVaultFenceStatusOK;
  }
  if (fenceStatus != AncPrivateVaultKeychainStatusOK &&
      fenceStatus != AncPrivateVaultKeychainStatusNotFound)
    return AncFenceStatusForKeychain(fenceStatus);
  if (highStatus != AncPrivateVaultKeychainStatusOK &&
      highStatus != AncPrivateVaultKeychainStatusNotFound)
    return AncFenceStatusForKeychain(highStatus);
  if (fenceStatus == AncPrivateVaultKeychainStatusNotFound &&
      highStatus == AncPrivateVaultKeychainStatusOK) {
    if (!AncFenceDecode(highData, vaultId, recordId, &pair->highWaterState,
                        &pair->highWaterGeneration, pair->highWaterDigest))
      return AncPrivateVaultFenceStatusCorrupt;
    if (pair->highWaterState == AncPrivateVaultFenceStatePending &&
        pair->highWaterGeneration == 1) {
      pair->initializing = YES;
      return AncPrivateVaultFenceStatusOK;
    }
    return AncPrivateVaultFenceStatusRollbackDetected;
  }
  if (fenceStatus != AncPrivateVaultKeychainStatusOK ||
      highStatus != AncPrivateVaultKeychainStatusOK)
    return AncPrivateVaultFenceStatusRollbackDetected;
  if (!AncFenceDecode(fenceData, vaultId, recordId, &pair->fenceState,
                      &pair->fenceGeneration, pair->fenceDigest) ||
      !AncFenceDecode(highData, vaultId, recordId, &pair->highWaterState,
                      &pair->highWaterGeneration, pair->highWaterDigest))
    return AncPrivateVaultFenceStatusCorrupt;
  if (pair->fenceGeneration == pair->highWaterGeneration &&
      !AncDigestEquals(pair->fenceDigest, pair->highWaterDigest))
    return AncPrivateVaultFenceStatusRollbackDetected;
  if (pair->fenceState == pair->highWaterState &&
      pair->fenceGeneration == pair->highWaterGeneration)
    return AncPrivateVaultFenceStatusOK;
  if (pair->fenceState == AncPrivateVaultFenceStateStable &&
      pair->highWaterState == AncPrivateVaultFenceStatePending &&
      (pair->highWaterGeneration == pair->fenceGeneration ||
       (pair->fenceGeneration != UINT64_MAX &&
        pair->highWaterGeneration == pair->fenceGeneration + 1)))
    return AncPrivateVaultFenceStatusOK;
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
  if (status == AncPrivateVaultKeychainStatusOK)
    return AncPrivateVaultFenceStatusOK;
  NSData *observed = nil;
  AncPrivateVaultKeychainStatus read =
      [self.keychain copyDataForService:service
                                vaultId:vaultId
                               recordId:recordId
                                   data:&observed];
  if (read == AncPrivateVaultKeychainStatusOK)
    return [observed isEqualToData:target] ? AncPrivateVaultFenceStatusOK
                                           : AncPrivateVaultFenceStatusConflict;
  return read == AncPrivateVaultKeychainStatusNotFound
             ? AncFenceStatusForKeychain(status)
             : AncFenceStatusForKeychain(read);
}

- (AncPrivateVaultFenceStatus)
    beginLocked:(uint64_t)generation
          digest:(const uint8_t[ANC_PV_HASH_BYTES])digest
         vaultId:(NSString *)vaultId
        recordId:(NSString *)recordId {
  NSData *pending = AncFenceEncode(AncPrivateVaultFenceStatePending, generation,
                                   digest, vaultId, recordId);
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
    if (generation != 1 || !AncDigestEquals(pair.highWaterDigest, digest))
      return AncPrivateVaultFenceStatusConflict;
    return [self writeData:pending
                   service:AncPrivateVaultFenceService
                   vaultId:vaultId
                  recordId:recordId
                       add:YES];
  }
  if (pair.fenceState == AncPrivateVaultFenceStatePending &&
      pair.highWaterState == AncPrivateVaultFenceStatePending &&
      pair.fenceGeneration == generation &&
      pair.highWaterGeneration == generation)
    return AncDigestEquals(pair.fenceDigest, digest)
               ? AncPrivateVaultFenceStatusOK
               : AncPrivateVaultFenceStatusConflict;
  if (pair.fenceState != AncPrivateVaultFenceStateStable)
    return AncPrivateVaultFenceStatusConflict;
  if (pair.highWaterState == AncPrivateVaultFenceStatePending &&
      pair.highWaterGeneration == pair.fenceGeneration) {
    if (!AncDigestEquals(pair.highWaterDigest, pair.fenceDigest))
      return AncPrivateVaultFenceStatusRollbackDetected;
    NSData *stable = AncFenceEncode(AncPrivateVaultFenceStateStable,
                                    pair.fenceGeneration, pair.fenceDigest,
                                    vaultId, recordId);
    status = [self writeData:stable
                     service:AncPrivateVaultHighWaterService
                     vaultId:vaultId
                    recordId:recordId
                         add:NO];
    if (status != AncPrivateVaultFenceStatusOK) return status;
    pair.highWaterState = AncPrivateVaultFenceStateStable;
  }
  if (generation == pair.fenceGeneration)
    return AncDigestEquals(pair.fenceDigest, digest)
               ? AncPrivateVaultFenceStatusOK
               : AncPrivateVaultFenceStatusConflict;
  if (pair.fenceGeneration == UINT64_MAX ||
      generation != pair.fenceGeneration + 1)
    return AncPrivateVaultFenceStatusConflict;
  if (pair.highWaterState == AncPrivateVaultFenceStatePending &&
      pair.highWaterGeneration == generation) {
    if (!AncDigestEquals(pair.highWaterDigest, digest))
      return AncPrivateVaultFenceStatusConflict;
    return [self writeData:pending
                   service:AncPrivateVaultFenceService
                   vaultId:vaultId
                  recordId:recordId
                       add:NO];
  }
  if (pair.highWaterState != AncPrivateVaultFenceStateStable ||
      pair.highWaterGeneration != pair.fenceGeneration)
    return AncPrivateVaultFenceStatusRollbackDetected;
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

- (AncPrivateVaultFenceStatus)
    commitLocked:(uint64_t)generation
           digest:(const uint8_t[ANC_PV_HASH_BYTES])digest
          vaultId:(NSString *)vaultId
         recordId:(NSString *)recordId {
  NSData *stable = AncFenceEncode(AncPrivateVaultFenceStateStable, generation,
                                  digest, vaultId, recordId);
  if (stable == nil) return AncPrivateVaultFenceStatusInvalid;
  AncFencePair pair;
  AncPrivateVaultFenceStatus status =
      [self readPairVaultId:vaultId recordId:recordId pair:&pair];
  if (status != AncPrivateVaultFenceStatusOK) return status;
  if (pair.absent || pair.initializing)
    return AncPrivateVaultFenceStatusConflict;
  if (pair.fenceGeneration != generation ||
      pair.highWaterGeneration != generation ||
      !AncDigestEquals(pair.fenceDigest, digest) ||
      !AncDigestEquals(pair.highWaterDigest, digest))
    return AncPrivateVaultFenceStatusConflict;
  if (pair.fenceState == AncPrivateVaultFenceStateStable) {
    if (pair.highWaterState == AncPrivateVaultFenceStateStable)
      return AncPrivateVaultFenceStatusOK;
    return [self writeData:stable
                   service:AncPrivateVaultHighWaterService
                   vaultId:vaultId
                  recordId:recordId
                       add:NO];
  }
  if (pair.fenceState != AncPrivateVaultFenceStatePending ||
      pair.highWaterState != AncPrivateVaultFenceStatePending)
    return AncPrivateVaultFenceStatusConflict;
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

- (AncPrivateVaultFenceStatus)
    beginGeneration:(uint64_t)generation
       recordDigest:(NSData *)recordDigest
            vaultId:(NSString *)vaultId
           recordId:(NSString *)recordId {
  uint8_t checkedDigest[32] = {0};
  if (!AncDigestData(recordDigest, checkedDigest))
    return AncPrivateVaultFenceStatusInvalid;
  anc_pv_zeroize(checkedDigest, sizeof checkedDigest);
  NSData *digest = [recordDigest copy];
  __block AncPrivateVaultFenceStatus status;
  dispatch_sync(self.queue, ^{
    status = [self beginLocked:generation
                        digest:digest.bytes
                       vaultId:vaultId
                      recordId:recordId];
  });
  return status;
}

- (AncPrivateVaultFenceStatus)
    commitGeneration:(uint64_t)generation
        recordDigest:(NSData *)recordDigest
             vaultId:(NSString *)vaultId
            recordId:(NSString *)recordId {
  uint8_t checkedDigest[32] = {0};
  if (!AncDigestData(recordDigest, checkedDigest))
    return AncPrivateVaultFenceStatusInvalid;
  anc_pv_zeroize(checkedDigest, sizeof checkedDigest);
  NSData *digest = [recordDigest copy];
  __block AncPrivateVaultFenceStatus status;
  dispatch_sync(self.queue, ^{
    status = [self commitLocked:generation
                         digest:digest.bytes
                        vaultId:vaultId
                       recordId:recordId];
  });
  return status;
}

- (AncPrivateVaultFenceStatus)readVaultId:(NSString *)vaultId
                                  recordId:(NSString *)recordId
                                  snapshot:(AncPrivateVaultFenceSnapshot **)out {
  if (out == NULL) return AncPrivateVaultFenceStatusInvalid;
  *out = nil;
  __block AncFencePair pair;
  __block AncPrivateVaultFenceStatus status;
  dispatch_sync(self.queue, ^{
    status = [self readPairVaultId:vaultId recordId:recordId pair:&pair];
  });
  if (status != AncPrivateVaultFenceStatusOK) return status;
  AncPrivateVaultFenceSnapshot *snapshot = [[AncPrivateVaultFenceSnapshot alloc] init];
  if (pair.absent) {
    snapshot.state = AncPrivateVaultFenceStateAbsent;
    snapshot.generation = 0;
    snapshot.recordDigest = [NSData data];
  } else if (pair.initializing) {
    snapshot.state = AncPrivateVaultFenceStatePending;
    snapshot.generation = 1;
    snapshot.recordDigest = [NSData dataWithBytes:pair.highWaterDigest length:32];
  } else if (pair.fenceState == AncPrivateVaultFenceStateStable &&
             pair.highWaterState == AncPrivateVaultFenceStatePending) {
    snapshot.state = AncPrivateVaultFenceStatePending;
    snapshot.generation = pair.highWaterGeneration;
    snapshot.recordDigest = [NSData dataWithBytes:pair.highWaterDigest length:32];
  } else {
    snapshot.state = pair.fenceState;
    snapshot.generation = pair.fenceGeneration;
    snapshot.recordDigest = [NSData dataWithBytes:pair.fenceDigest length:32];
  }
  anc_pv_zeroize(&pair, sizeof pair);
  *out = snapshot;
  return AncPrivateVaultFenceStatusOK;
}

@end
