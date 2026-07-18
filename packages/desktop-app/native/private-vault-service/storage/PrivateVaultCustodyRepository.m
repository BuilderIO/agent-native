#import "PrivateVaultCustodyRepository.h"
#import "PrivateVaultCustodyRepositoryGenesisInternal.h"
#import "PrivateVaultCustodyRepositoryRecoveryInternal.h"

#import <objc/runtime.h>

#include <stdlib.h>

NSString *const AncPrivateVaultCustodyRecordId = @"custody";
NSString *const AncPrivateVaultEndpointCustodyRecordId = @"custody";
NSString *const AncPrivateVaultBrokerCustodyRecordId = @"custody:broker";
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

static NSData *_Nullable AncCustodyDigest(AncCustodyRecordBuffer *record);
static BOOL AncGenesisCancellationCommitment(
    const AncPrivateVaultCustodySnapshot *current,
    NSData *pendingRecordDigest, uint64_t cancelledAtMs, uint8_t output[32]);
static BOOL AncSnapshotMatchesVaultId(
    const AncPrivateVaultCustodySnapshot *snapshot, NSString *vaultId);
static BOOL AncPublicSnapshotsEqual(
    const AncPrivateVaultCustodySnapshot *left,
    const AncPrivateVaultCustodySnapshot *right);

@interface AncPrivateVaultCustodyRepository (GenesisPrivate)
@property(nonatomic, strong) dispatch_queue_t queue;
- (AncPrivateVaultCustodyRepositoryStatus)
    reconcileVaultId:(NSString *)vaultId
           liveRecord:(AncCustodyRecordBuffer *_Nullable *_Nonnull)liveRecord
         liveSnapshot:(AncPrivateVaultCustodySnapshot *)liveSnapshot;
- (AncPrivateVaultCustodyRepositoryStatus)
    storeLockedSnapshot:(const AncPrivateVaultCustodySnapshot *)snapshot
                 secrets:(const AncPrivateVaultCustodySecretInputs *)secrets
                 vaultId:(NSString *)vaultId;
- (AncPrivateVaultCustodyRepositoryStatus)
    promoteRecoveryAuthorityAnchorVaultId:(NSString *)vaultId
                        nextPublicSnapshot:
                            (const AncPrivateVaultCustodySnapshot *)snapshot;
@end

@interface AncPrivateVaultPendingGenesisCustodyCheckpoint ()
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) uint64_t custodyGeneration;
@property(nonatomic, readwrite) NSData *recordDigest;
- (instancetype)initPrivateWithVaultId:(NSString *)vaultId
                             generation:(uint64_t)generation
                           recordDigest:(NSData *)recordDigest;
@end

AncPrivateVaultCustodyRepositoryStatus
AncPrivateVaultCustodyPromoteRecoveryAuthorityAnchor(
    AncPrivateVaultCustodyRepository *repository, NSString *vaultId,
    const AncPrivateVaultCustodySnapshot *snapshot) {
  if (![repository isKindOfClass:AncPrivateVaultCustodyRepository.class])
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  return [repository promoteRecoveryAuthorityAnchorVaultId:vaultId
                                         nextPublicSnapshot:snapshot];
}

@interface AncImmutablePendingGenesisCustodyCheckpoint
    : AncPrivateVaultPendingGenesisCustodyCheckpoint
@end

static void AncRaiseImmutablePendingGenesisCheckpoint(void) {
  [NSException raise:NSInternalInconsistencyException
              format:@"pending genesis custody checkpoints are immutable"];
}

@implementation AncImmutablePendingGenesisCustodyCheckpoint
- (void)setVaultId:(NSString *)value {
  (void)value;
  AncRaiseImmutablePendingGenesisCheckpoint();
}
- (void)setCustodyGeneration:(uint64_t)value {
  (void)value;
  AncRaiseImmutablePendingGenesisCheckpoint();
}
- (void)setRecordDigest:(NSData *)value {
  (void)value;
  AncRaiseImmutablePendingGenesisCheckpoint();
}
- (void)setValue:(id)value forKey:(NSString *)key {
  (void)value;
  (void)key;
  AncRaiseImmutablePendingGenesisCheckpoint();
}
@end

@implementation AncPrivateVaultPendingGenesisCustodyCheckpoint
+ (BOOL)accessInstanceVariablesDirectly { return NO; }
- (instancetype)initPrivateWithVaultId:(NSString *)vaultId
                             generation:(uint64_t)generation
                           recordDigest:(NSData *)recordDigest {
  self = [super init];
  if (self != nil) {
    _vaultId = [vaultId copy];
    _custodyGeneration = generation;
    _recordDigest = [recordDigest copy];
  }
  return self;
}
@end

@interface AncPrivateVaultCancelledGenesisCustodyCheckpoint ()
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) uint64_t custodyGeneration;
@property(nonatomic, readwrite) NSData *recordDigest;
@property(nonatomic, readwrite) NSData *cancellationCommitment;
@property(nonatomic, readwrite) uint64_t cancelledAtMs;
- (instancetype)initPrivateWithVaultId:(NSString *)vaultId
                             generation:(uint64_t)generation
                           recordDigest:(NSData *)recordDigest
                 cancellationCommitment:(NSData *)cancellationCommitment
                         cancelledAtMs:(uint64_t)cancelledAtMs;
@end
@interface AncImmutableCancelledGenesisCustodyCheckpoint
    : AncPrivateVaultCancelledGenesisCustodyCheckpoint
@end
@implementation AncImmutableCancelledGenesisCustodyCheckpoint
- (void)setVaultId:(NSString *)value {
  (void)value;
  AncRaiseImmutablePendingGenesisCheckpoint();
}
- (void)setCustodyGeneration:(uint64_t)value {
  (void)value;
  AncRaiseImmutablePendingGenesisCheckpoint();
}
- (void)setRecordDigest:(NSData *)value {
  (void)value;
  AncRaiseImmutablePendingGenesisCheckpoint();
}
- (void)setCancellationCommitment:(NSData *)value {
  (void)value;
  AncRaiseImmutablePendingGenesisCheckpoint();
}
- (void)setCancelledAtMs:(uint64_t)value {
  (void)value;
  AncRaiseImmutablePendingGenesisCheckpoint();
}
- (void)setValue:(id)value forKey:(NSString *)key {
  (void)value;
  (void)key;
  AncRaiseImmutablePendingGenesisCheckpoint();
}
@end
@implementation AncPrivateVaultCancelledGenesisCustodyCheckpoint
+ (BOOL)accessInstanceVariablesDirectly {
  return NO;
}
- (instancetype)initPrivateWithVaultId:(NSString *)vaultId
                             generation:(uint64_t)generation
                           recordDigest:(NSData *)recordDigest
                 cancellationCommitment:(NSData *)cancellationCommitment
                         cancelledAtMs:(uint64_t)cancelledAtMs {
  self = [super init];
  if (self != nil) {
    _vaultId = [vaultId copy];
    _custodyGeneration = generation;
    _recordDigest = [recordDigest copy];
    _cancellationCommitment = [cancellationCommitment copy];
    _cancelledAtMs = cancelledAtMs;
  }
  return self;
}
@end

@interface AncPrivateVaultPendingRecoveryCustodyCheckpoint ()
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) uint64_t custodyGeneration;
@property(nonatomic, readwrite) NSData *recordDigest;
- (instancetype)initPrivateWithVaultId:(NSString *)vaultId
                             generation:(uint64_t)generation
                           recordDigest:(NSData *)recordDigest;
@end
@interface AncImmutablePendingRecoveryCustodyCheckpoint
    : AncPrivateVaultPendingRecoveryCustodyCheckpoint
@end
@implementation AncImmutablePendingRecoveryCustodyCheckpoint
- (void)setVaultId:(NSString *)value { (void)value; AncRaiseImmutablePendingGenesisCheckpoint(); }
- (void)setCustodyGeneration:(uint64_t)value { (void)value; AncRaiseImmutablePendingGenesisCheckpoint(); }
- (void)setRecordDigest:(NSData *)value { (void)value; AncRaiseImmutablePendingGenesisCheckpoint(); }
- (void)setValue:(id)value forKey:(NSString *)key { (void)value; (void)key; AncRaiseImmutablePendingGenesisCheckpoint(); }
@end
@implementation AncPrivateVaultPendingRecoveryCustodyCheckpoint
+ (BOOL)accessInstanceVariablesDirectly { return NO; }
- (instancetype)initPrivateWithVaultId:(NSString *)vaultId
                             generation:(uint64_t)generation
                           recordDigest:(NSData *)recordDigest {
  self = [super init];
  if (self != nil) {
    _vaultId = [vaultId copy];
    _custodyGeneration = generation;
    _recordDigest = [recordDigest copy];
  }
  return self;
}
@end

static BOOL AncGenesisHexIdentifier(NSString *value, uint8_t output[160],
                                    size_t *outputLength) {
  @try {
    if (![value isKindOfClass:NSString.class] || value.length != 32 ||
        output == NULL || outputLength == NULL)
      return NO;
    NSData *encoded = [value dataUsingEncoding:NSASCIIStringEncoding
                          allowLossyConversion:NO];
    if (encoded.length != 32 || value.length != 32)
      return NO;
    const uint8_t *bytes = encoded.bytes;
    for (NSUInteger index = 0; index < encoded.length; index++) {
      if (!((bytes[index] >= '0' && bytes[index] <= '9') ||
            (bytes[index] >= 'a' && bytes[index] <= 'f')))
        return NO;
    }
    memset(output, 0, 160);
    memcpy(output, bytes, encoded.length);
    *outputLength = encoded.length;
    return YES;
  } @catch (__unused NSException *exception) {
    if (output != NULL)
      anc_pv_zeroize(output, 160);
    if (outputLength != NULL)
      *outputLength = 0;
    return NO;
  }
}

static BOOL AncGenesisExactPublicBytes(NSData *value, uint8_t output[32]) {
  @try {
    if (![value isKindOfClass:NSData.class] || value.length != 32)
      return NO;
    [value getBytes:output length:32];
    return value.length == 32;
  } @catch (__unused NSException *exception) {
    anc_pv_zeroize(output, 32);
    return NO;
  }
}

static NSString *AncGenesisIdentifierString(const uint8_t *bytes,
                                             size_t length) {
  if (bytes == NULL || length != 32)
    return nil;
  return [[NSString alloc] initWithBytes:bytes
                                  length:length
                                encoding:NSASCIIStringEncoding];
}

static NSData *AncGenesisPublicData(const uint8_t bytes[32]) {
  if (bytes == NULL)
    return nil;
  NSMutableData *value = [NSMutableData dataWithLength:32];
  if (value == nil)
    return nil;
  memcpy(value.mutableBytes, bytes, 32);
  return [NSData dataWithData:value];
}

static BOOL AncGenesisRangesOverlap(const void *left, size_t leftLength,
                                    const void *right, size_t rightLength) {
  if (left == NULL || right == NULL || leftLength == 0 || rightLength == 0)
    return NO;
  uintptr_t leftStart = (uintptr_t)left;
  uintptr_t rightStart = (uintptr_t)right;
  if (leftStart > UINTPTR_MAX - leftLength ||
      rightStart > UINTPTR_MAX - rightLength)
    return YES;
  return leftStart < rightStart + rightLength &&
         rightStart < leftStart + leftLength;
}

static BOOL AncGenesisSecretInputPointersValid(
    const AncPrivateVaultCustodySecretInputs *secrets) {
  if (secrets == NULL || secrets->signing_seed == NULL ||
      secrets->box_seed == NULL || secrets->local_state_key == NULL ||
      secrets->active_epoch_key == NULL || secrets->pending_epoch_key == NULL)
    return NO;
  const uint8_t *fields[] = {
      secrets->signing_seed, secrets->box_seed, secrets->local_state_key,
      secrets->active_epoch_key, secrets->pending_epoch_key,
  };
  for (size_t left = 0; left < 5; left++) {
    if (AncGenesisRangesOverlap(secrets, sizeof *secrets, fields[left], 32))
      return NO;
    for (size_t right = left + 1; right < 5; right++) {
      if (AncGenesisRangesOverlap(fields[left], 32, fields[right], 32))
        return NO;
    }
  }
  return YES;
}

static AncPrivateVaultCustodyRepositoryStatus AncGenesisValidateSecretInputs(
    const AncPrivateVaultCustodySecretInputs *secrets,
    const uint8_t expectedSigningPublic[32],
    const uint8_t expectedBoxPublic[32]) {
  if (secrets == NULL || secrets->signing_seed == NULL ||
      secrets->box_seed == NULL || secrets->local_state_key == NULL ||
      secrets->active_epoch_key == NULL || secrets->pending_epoch_key == NULL)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  uint8_t activeAggregate = 0;
  uint8_t requiredAggregate[4] = {0};
  const uint8_t *required[] = {secrets->signing_seed, secrets->box_seed,
                               secrets->local_state_key,
                               secrets->pending_epoch_key};
  for (size_t index = 0; index < 32; index++) {
    activeAggregate |= secrets->active_epoch_key[index];
    for (size_t field = 0; field < 4; field++)
      requiredAggregate[field] |= required[field][index];
  }
  if (activeAggregate != 0 || requiredAggregate[0] == 0 ||
      requiredAggregate[1] == 0 || requiredAggregate[2] == 0 ||
      requiredAggregate[3] == 0)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  uint8_t derivedSigningPublic[32] = {0};
  uint8_t derivedBoxPublic[32] = {0};
  uint8_t *derivedSigningPointer = derivedSigningPublic;
  uint8_t *derivedBoxPointer = derivedBoxPublic;
  AncPrivateVaultGuardedMemoryStatus memoryStatus;
  AncPrivateVaultGuardedMemory *signingPrivate =
      [AncPrivateVaultGuardedMemory memoryWithLength:64 status:&memoryStatus];
  AncPrivateVaultGuardedMemory *boxPrivate =
      signingPrivate == nil
          ? nil
          : [AncPrivateVaultGuardedMemory memoryWithLength:32
                                                    status:&memoryStatus];
  if (signingPrivate == nil || boxPrivate == nil) {
    AncPrivateVaultGuardedMemoryStatus signingClose =
        signingPrivate == nil ? AncPrivateVaultGuardedMemoryStatusOK
                              : [signingPrivate close];
    AncPrivateVaultGuardedMemoryStatus boxClose =
        boxPrivate == nil ? AncPrivateVaultGuardedMemoryStatusOK
                          : [boxPrivate close];
    anc_pv_zeroize(derivedSigningPublic, sizeof derivedSigningPublic);
    anc_pv_zeroize(derivedBoxPublic, sizeof derivedBoxPublic);
    (void)signingClose;
    (void)boxClose;
    return AncPrivateVaultCustodyRepositoryStatusFailed;
  }
  __block BOOL signingDerived = NO;
  __block BOOL boxDerived = NO;
  AncPrivateVaultGuardedMemoryStatus signingBorrow =
      [signingPrivate borrow:^BOOL(uint8_t *privateBytes, size_t length) {
        signingDerived =
            length == 64 &&
            anc_pv_ed25519_seed_keypair(derivedSigningPointer, privateBytes,
                                        secrets->signing_seed) ==
                ANC_PV_CRYPTO_OK;
        return signingDerived;
      }];
  AncPrivateVaultGuardedMemoryStatus boxBorrow =
      [boxPrivate borrow:^BOOL(uint8_t *privateBytes, size_t length) {
        boxDerived = length == 32 &&
                     anc_pv_box_seed_keypair(derivedBoxPointer, privateBytes,
                                             secrets->box_seed) ==
                         ANC_PV_CRYPTO_OK;
        return boxDerived;
      }];
  BOOL valid = signingBorrow == AncPrivateVaultGuardedMemoryStatusOK &&
               boxBorrow == AncPrivateVaultGuardedMemoryStatusOK &&
               signingDerived && boxDerived &&
      anc_pv_memcmp(derivedSigningPublic, expectedSigningPublic, 32) ==
          ANC_PV_CRYPTO_OK &&
      anc_pv_memcmp(derivedBoxPublic, expectedBoxPublic, 32) ==
          ANC_PV_CRYPTO_OK;
  AncPrivateVaultGuardedMemoryStatus signingClose = [signingPrivate close];
  AncPrivateVaultGuardedMemoryStatus boxClose = [boxPrivate close];
  anc_pv_zeroize(derivedSigningPublic, sizeof derivedSigningPublic);
  anc_pv_zeroize(derivedBoxPublic, sizeof derivedBoxPublic);
  if (signingClose != AncPrivateVaultGuardedMemoryStatusOK ||
      boxClose != AncPrivateVaultGuardedMemoryStatusOK)
    return AncPrivateVaultCustodyRepositoryStatusFailed;
  return valid ? AncPrivateVaultCustodyRepositoryStatusOK
               : AncPrivateVaultCustodyRepositoryStatusInvalid;
}

static BOOL AncBuildPendingGenesisSnapshot(
    NSString *vaultId, NSString *endpointId, NSString *ceremonyId,
    NSData *signingPublicKey, NSData *boxPublicKey,
    NSData *bootstrapTranscriptDigest,
    AncPrivateVaultCustodySnapshot *snapshot) {
  if (snapshot == NULL)
    return NO;
  anc_pv_custody_snapshot_zero(snapshot);
  snapshot->record_version = ANC_PV_CUSTODY_VERSION;
  snapshot->expected_edge_present = 1;
  snapshot->lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  snapshot->role = ANC_PV_CUSTODY_ROLE_ENDPOINT;
  snapshot->pending_kind = ANC_PV_CUSTODY_PENDING_GENESIS;
  snapshot->rotation_phase = ANC_PV_CUSTODY_ROTATION_PREPARED;
  snapshot->enrollment_phase = ANC_PV_CUSTODY_ENROLLMENT_NONE;
  snapshot->custody_generation = 1;
  snapshot->pending_epoch = 1;
  if (!AncGenesisHexIdentifier(vaultId, snapshot->vault_id,
                               &snapshot->vault_id_length) ||
      !AncGenesisHexIdentifier(endpointId, snapshot->endpoint_id,
                               &snapshot->endpoint_id_length) ||
      !AncGenesisHexIdentifier(ceremonyId, snapshot->ceremony_id,
                               &snapshot->ceremony_id_length) ||
      !AncGenesisExactPublicBytes(signingPublicKey,
                                  snapshot->signing_public_key) ||
      !AncGenesisExactPublicBytes(boxPublicKey, snapshot->box_public_key) ||
      !AncGenesisExactPublicBytes(bootstrapTranscriptDigest,
                                  snapshot->pending_transcript_digest)) {
    anc_pv_custody_snapshot_zero(snapshot);
    return NO;
  }
  return YES;
}

static BOOL AncBuildPendingRecoverySnapshot(
    NSString *vaultId, NSString *endpointId, NSString *ceremonyId,
    NSData *signingPublicKey, NSData *boxPublicKey, uint64_t nextEpoch,
    uint64_t recoveryGeneration, uint64_t expectedNextSequence,
    NSData *expectedPreviousHead, NSData *authorizationHash,
    AncPrivateVaultCustodySnapshot *snapshot) {
  if (snapshot == NULL || nextEpoch == 0 || recoveryGeneration == 0 ||
      expectedNextSequence == 0)
    return NO;
  anc_pv_custody_snapshot_zero(snapshot);
  snapshot->record_version = ANC_PV_CUSTODY_VERSION;
  snapshot->expected_edge_present = 1;
  snapshot->lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  snapshot->role = ANC_PV_CUSTODY_ROLE_ENDPOINT;
  snapshot->pending_kind = ANC_PV_CUSTODY_PENDING_RECOVERY;
  snapshot->rotation_phase = ANC_PV_CUSTODY_ROTATION_PREPARED;
  snapshot->enrollment_phase =
      ANC_PV_CUSTODY_ENROLLMENT_AUTHORIZATION_RECEIVED;
  snapshot->custody_generation = 1;
  snapshot->pending_epoch = nextEpoch;
  snapshot->recovery_generation = recoveryGeneration;
  snapshot->expected_next_sequence = expectedNextSequence;
  if (!AncGenesisHexIdentifier(vaultId, snapshot->vault_id,
                               &snapshot->vault_id_length) ||
      !AncGenesisHexIdentifier(endpointId, snapshot->endpoint_id,
                               &snapshot->endpoint_id_length) ||
      !AncGenesisHexIdentifier(ceremonyId, snapshot->ceremony_id,
                               &snapshot->ceremony_id_length) ||
      !AncGenesisExactPublicBytes(signingPublicKey,
                                  snapshot->signing_public_key) ||
      !AncGenesisExactPublicBytes(boxPublicKey, snapshot->box_public_key) ||
      !AncGenesisExactPublicBytes(expectedPreviousHead,
                                  snapshot->expected_previous_head) ||
      !AncGenesisExactPublicBytes(authorizationHash,
                                  snapshot->pending_transcript_digest)) {
    anc_pv_custody_snapshot_zero(snapshot);
    return NO;
  }
  return YES;
}

@implementation AncPrivateVaultCustodyRepository (GenesisInternal)

- (AncPrivateVaultCustodyRepositoryStatus)
    pendingGenesisCheckpointVaultId:(NSString *)vaultId
                           endpointId:(NSString *)endpointId
                           ceremonyId:(NSString *)ceremonyId
                      signingPublicKey:(NSData *)signingPublicKey
                           boxPublicKey:(NSData *)boxPublicKey
              bootstrapTranscriptDigest:(NSData *)bootstrapTranscriptDigest
                            checkpoint:
                                (AncPrivateVaultPendingGenesisCustodyCheckpoint
                                     **)checkpoint {
  if (checkpoint != NULL)
    *checkpoint = nil;
  if ([NSThread.currentThread.threadDictionary[kAncCustodyBorrowScopeThreadKey]
          boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  AncPrivateVaultCustodySnapshot expected;
  if (!AncBuildPendingGenesisSnapshot(
          vaultId, endpointId, ceremonyId, signingPublicKey, boxPublicKey,
          bootstrapTranscriptDigest, &expected)) {
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  }
  NSString *canonicalVaultId =
      AncGenesisIdentifierString(expected.vault_id, expected.vault_id_length);
  if (canonicalVaultId == nil) {
    anc_pv_custody_snapshot_zero(&expected);
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  }
  __block AncPrivateVaultCustodyRepositoryStatus status;
  __block AncPrivateVaultPendingGenesisCustodyCheckpoint *result = nil;
  dispatch_sync(self.queue, ^{
    AncCustodyRecordBuffer *live = nil;
    AncPrivateVaultCustodySnapshot observed;
    status = [self reconcileVaultId:canonicalVaultId
                         liveRecord:&live
                       liveSnapshot:&observed];
    BOOL exact = status == AncPrivateVaultCustodyRepositoryStatusOK &&
                 AncPublicSnapshotsEqual(&observed, &expected);
    NSData *digest = exact ? AncCustodyDigest(live) : nil;
    AncPrivateVaultCustodyRepositoryStatus closed =
        live == nil ? AncPrivateVaultCustodyRepositoryStatusOK : [live close];
    if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
      status = closed;
    else if (status == AncPrivateVaultCustodyRepositoryStatusOK &&
             (!exact || digest.length != 32))
      status = AncPrivateVaultCustodyRepositoryStatusConflict;
    else if (status == AncPrivateVaultCustodyRepositoryStatusOK) {
      NSString *observedVaultId =
          AncGenesisIdentifierString(observed.vault_id,
                                     observed.vault_id_length);
      if (observedVaultId == nil)
        status = AncPrivateVaultCustodyRepositoryStatusCorrupt;
      else
        result = [[AncPrivateVaultPendingGenesisCustodyCheckpoint alloc]
            initPrivateWithVaultId:observedVaultId
                        generation:observed.custody_generation
                      recordDigest:digest];
      if (status == AncPrivateVaultCustodyRepositoryStatusOK && result == nil)
        status = AncPrivateVaultCustodyRepositoryStatusFailed;
    }
    if (result != nil)
      object_setClass(result,
                      AncImmutablePendingGenesisCustodyCheckpoint.class);
    anc_pv_custody_snapshot_zero(&observed);
  });
  anc_pv_custody_snapshot_zero(&expected);
  if (status == AncPrivateVaultCustodyRepositoryStatusOK && checkpoint != NULL)
    *checkpoint = result;
  return status;
}

- (AncPrivateVaultCustodyRepositoryStatus)
    installPendingGenesisVaultId:(NSString *)vaultId
                       endpointId:(NSString *)endpointId
                       ceremonyId:(NSString *)ceremonyId
                  signingPublicKey:(NSData *)signingPublicKey
                       boxPublicKey:(NSData *)boxPublicKey
            bootstrapTranscriptDigest:(NSData *)bootstrapTranscriptDigest
                          secrets:
                              (const AncPrivateVaultCustodySecretInputs *)secrets
                       checkpoint:
                           (AncPrivateVaultPendingGenesisCustodyCheckpoint
                                **)checkpoint {
  if (checkpoint != NULL)
    *checkpoint = nil;
  AncPrivateVaultCustodySnapshot snapshot;
  if (!AncBuildPendingGenesisSnapshot(
          vaultId, endpointId, ceremonyId, signingPublicKey, boxPublicKey,
          bootstrapTranscriptDigest, &snapshot)) {
    anc_pv_custody_snapshot_zero(&snapshot);
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  }
  NSString *canonicalVaultId =
      AncGenesisIdentifierString(snapshot.vault_id, snapshot.vault_id_length);
  NSString *canonicalEndpointId = AncGenesisIdentifierString(
      snapshot.endpoint_id, snapshot.endpoint_id_length);
  NSString *canonicalCeremonyId = AncGenesisIdentifierString(
      snapshot.ceremony_id, snapshot.ceremony_id_length);
  NSData *canonicalSigningPublicKey =
      AncGenesisPublicData(snapshot.signing_public_key);
  NSData *canonicalBoxPublicKey =
      AncGenesisPublicData(snapshot.box_public_key);
  NSData *canonicalBootstrapTranscriptDigest =
      AncGenesisPublicData(snapshot.pending_transcript_digest);
  if (canonicalVaultId == nil || canonicalEndpointId == nil ||
      canonicalCeremonyId == nil || canonicalSigningPublicKey == nil ||
      canonicalBoxPublicKey == nil ||
      canonicalBootstrapTranscriptDigest == nil) {
    anc_pv_custody_snapshot_zero(&snapshot);
    return AncPrivateVaultCustodyRepositoryStatusFailed;
  }
  if (!AncGenesisSecretInputPointersValid(secrets)) {
    anc_pv_custody_snapshot_zero(&snapshot);
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  }
  AncPrivateVaultGuardedMemoryStatus memoryStatus;
  AncPrivateVaultGuardedMemory *ownedSecrets =
      [AncPrivateVaultGuardedMemory memoryWithLength:160 status:&memoryStatus];
  if (ownedSecrets == nil || memoryStatus != AncPrivateVaultGuardedMemoryStatusOK) {
    anc_pv_custody_snapshot_zero(&snapshot);
    return AncPrivateVaultCustodyRepositoryStatusFailed;
  }
  __block AncPrivateVaultCustodyRepositoryStatus status =
      AncPrivateVaultCustodyRepositoryStatusFailed;
  AncPrivateVaultGuardedMemoryStatus borrowed =
      [ownedSecrets borrow:^BOOL(uint8_t *bytes, size_t length) {
        if (length != 160)
          return NO;
        memcpy(bytes, secrets->signing_seed, 32);
        memcpy(bytes + 32, secrets->box_seed, 32);
        memcpy(bytes + 64, secrets->local_state_key, 32);
        memcpy(bytes + 96, secrets->active_epoch_key, 32);
        memcpy(bytes + 128, secrets->pending_epoch_key, 32);
        AncPrivateVaultCustodySecretInputs owned = {
            .signing_seed = bytes,
            .box_seed = bytes + 32,
            .local_state_key = bytes + 64,
            .active_epoch_key = bytes + 96,
            .pending_epoch_key = bytes + 128,
        };
        status = AncGenesisValidateSecretInputs(
            &owned, snapshot.signing_public_key, snapshot.box_public_key);
        if (status == AncPrivateVaultCustodyRepositoryStatusOK)
          status = [self storeSnapshot:&snapshot
                               secrets:&owned
                               vaultId:canonicalVaultId];
        return status == AncPrivateVaultCustodyRepositoryStatusOK;
      }];
  AncPrivateVaultGuardedMemoryStatus secretClose = [ownedSecrets close];
  anc_pv_custody_snapshot_zero(&snapshot);
  if (secretClose != AncPrivateVaultGuardedMemoryStatusOK)
    return AncPrivateVaultCustodyRepositoryStatusFailed;
  if (borrowed != AncPrivateVaultGuardedMemoryStatusOK &&
      status == AncPrivateVaultCustodyRepositoryStatusOK)
    return AncPrivateVaultCustodyRepositoryStatusFailed;
  if (status != AncPrivateVaultCustodyRepositoryStatusOK)
    return status;
  return [self pendingGenesisCheckpointVaultId:canonicalVaultId
                                     endpointId:canonicalEndpointId
                                     ceremonyId:canonicalCeremonyId
                               signingPublicKey:canonicalSigningPublicKey
                                    boxPublicKey:canonicalBoxPublicKey
                        bootstrapTranscriptDigest:
                            canonicalBootstrapTranscriptDigest
                                      checkpoint:checkpoint];
}

- (AncPrivateVaultCustodyRepositoryStatus)
    cancelPendingGenesisVaultId:(NSString *)vaultId
            expectedRecordDigest:(NSData *)expectedRecordDigest
                   cancelledAtMs:(uint64_t)cancelledAtMs
                      checkpoint:
                          (AncPrivateVaultCancelledGenesisCustodyCheckpoint **)
                              checkpoint {
  if (checkpoint != NULL)
    *checkpoint = nil;
  if ([NSThread.currentThread.threadDictionary[kAncCustodyBorrowScopeThreadKey]
          boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  uint8_t canonicalVaultBytes[160] = {0};
  uint8_t expectedBytes[32] = {0};
  size_t canonicalVaultLength = 0;
  BOOL exactExpected =
      AncGenesisExactPublicBytes(expectedRecordDigest, expectedBytes);
  NSData *expected = exactExpected ? AncGenesisPublicData(expectedBytes) : nil;
  anc_pv_zeroize(expectedBytes, sizeof expectedBytes);
  if (!AncGenesisHexIdentifier(vaultId, canonicalVaultBytes,
                               &canonicalVaultLength) ||
      canonicalVaultLength != 32 || !exactExpected || expected.length != 32 ||
      cancelledAtMs == 0 ||
      cancelledAtMs > UINT64_C(9007199254740991)) {
    anc_pv_zeroize(canonicalVaultBytes, sizeof canonicalVaultBytes);
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  }
  NSString *canonicalVaultId =
      AncGenesisIdentifierString(canonicalVaultBytes, canonicalVaultLength);
  anc_pv_zeroize(canonicalVaultBytes, sizeof canonicalVaultBytes);
  if (canonicalVaultId == nil)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;

  __block AncPrivateVaultCustodyRepositoryStatus status =
      AncPrivateVaultCustodyRepositoryStatusFailed;
  __block AncPrivateVaultCancelledGenesisCustodyCheckpoint *result = nil;
  dispatch_sync(self.queue, ^{
    AncCustodyRecordBuffer *live = nil;
    AncPrivateVaultCustodySnapshot current;
    status = [self reconcileVaultId:canonicalVaultId
                         liveRecord:&live
                       liveSnapshot:&current];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK)
      return;
    NSData *currentDigest = AncCustodyDigest(live);
    BOOL exactCancelled =
        currentDigest.length == 32 &&
        current.record_version == ANC_PV_CUSTODY_VERSION &&
        current.custody_generation == 2 &&
        current.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_CANCELLED_GENESIS &&
        anc_pv_memcmp(current.removal_head, expected.bytes, 32) ==
            ANC_PV_CRYPTO_OK &&
        AncSnapshotMatchesVaultId(&current, canonicalVaultId);
    if (exactCancelled) {
      NSData *commitment =
          AncGenesisPublicData(current.removal_authorization_digest);
      AncPrivateVaultCustodyRepositoryStatus liveClosed = [live close];
      if (liveClosed != AncPrivateVaultCustodyRepositoryStatusOK ||
          commitment.length != 32) {
        status = liveClosed != AncPrivateVaultCustodyRepositoryStatusOK
                     ? liveClosed
                     : AncPrivateVaultCustodyRepositoryStatusFailed;
        anc_pv_custody_snapshot_zero(&current);
        return;
      }
      result = [[AncPrivateVaultCancelledGenesisCustodyCheckpoint alloc]
          initPrivateWithVaultId:canonicalVaultId
                       generation:2
                     recordDigest:currentDigest
           cancellationCommitment:commitment
                   cancelledAtMs:current.removal_time_ms];
      if (result == nil)
        status = AncPrivateVaultCustodyRepositoryStatusFailed;
      else
        object_setClass(
            result, AncImmutableCancelledGenesisCustodyCheckpoint.class);
      anc_pv_custody_snapshot_zero(&current);
      return;
    }
    BOOL exactPending =
        currentDigest.length == 32 && [currentDigest isEqualToData:expected] &&
        current.record_version == ANC_PV_CUSTODY_VERSION &&
        current.custody_generation == 1 &&
        current.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
        current.role == ANC_PV_CUSTODY_ROLE_ENDPOINT &&
        current.pending_kind == ANC_PV_CUSTODY_PENDING_GENESIS &&
        current.rotation_phase == ANC_PV_CUSTODY_ROTATION_PREPARED &&
        current.enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_NONE &&
        !current.authority_anchor_present && current.expected_edge_present &&
        current.active_epoch == 0 && current.pending_epoch == 1 &&
        current.recovery_generation == 0 && current.vault_id_length == 32 &&
        current.endpoint_id_length == 32 && current.ceremony_id_length == 32 &&
        AncSnapshotMatchesVaultId(&current, canonicalVaultId);
    AncPrivateVaultCustodyRepositoryStatus liveClosed = [live close];
    if (liveClosed != AncPrivateVaultCustodyRepositoryStatusOK) {
      status = liveClosed;
      anc_pv_custody_snapshot_zero(&current);
      return;
    }
    if (!exactPending) {
      status = AncPrivateVaultCustodyRepositoryStatusConflict;
      anc_pv_custody_snapshot_zero(&current);
      return;
    }
    AncPrivateVaultCustodySnapshot cancelled = current;
    cancelled.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_CANCELLED_GENESIS;
    cancelled.pending_kind = ANC_PV_CUSTODY_PENDING_NONE;
    cancelled.rotation_phase = ANC_PV_CUSTODY_ROTATION_NONE;
    cancelled.enrollment_phase = ANC_PV_CUSTODY_ENROLLMENT_NONE;
    cancelled.custody_generation = 2;
    cancelled.expected_edge_present = 0;
    cancelled.pending_epoch = 0;
    cancelled.ceremony_id_length = 0;
    anc_pv_zeroize(cancelled.ceremony_id, sizeof cancelled.ceremony_id);
    cancelled.expected_next_sequence = 0;
    anc_pv_zeroize(cancelled.expected_previous_head,
                   sizeof cancelled.expected_previous_head);
    anc_pv_zeroize(cancelled.pending_transcript_digest,
                   sizeof cancelled.pending_transcript_digest);
    memcpy(cancelled.removal_head, currentDigest.bytes, 32);
    cancelled.removal_time_ms = cancelledAtMs;
    uint8_t cancellationCommitment[32] = {0};
    BOOL committed = AncGenesisCancellationCommitment(
        &current, currentDigest, cancelledAtMs, cancellationCommitment);
    if (committed)
      memcpy(cancelled.removal_authorization_digest,
             cancellationCommitment, 32);
    uint8_t zeroSecrets[160] = {0};
    AncPrivateVaultCustodySecretInputs secrets = {
        .signing_seed = zeroSecrets,
        .box_seed = zeroSecrets + 32,
        .local_state_key = zeroSecrets + 64,
        .active_epoch_key = zeroSecrets + 96,
        .pending_epoch_key = zeroSecrets + 128,
    };
    status = committed
                 ? [self storeLockedSnapshot:&cancelled
                                      secrets:&secrets
                                      vaultId:canonicalVaultId]
                 : AncPrivateVaultCustodyRepositoryStatusFailed;
    anc_pv_zeroize(zeroSecrets, sizeof zeroSecrets);
    if (status == AncPrivateVaultCustodyRepositoryStatusOK) {
      AncCustodyRecordBuffer *terminalRecord = nil;
      AncPrivateVaultCustodySnapshot terminalSnapshot;
      status = [self reconcileVaultId:canonicalVaultId
                           liveRecord:&terminalRecord
                         liveSnapshot:&terminalSnapshot];
      NSData *terminalDigest =
          status == AncPrivateVaultCustodyRepositoryStatusOK
              ? AncCustodyDigest(terminalRecord)
              : nil;
      AncPrivateVaultCustodyRepositoryStatus terminalClosed =
          terminalRecord == nil
              ? AncPrivateVaultCustodyRepositoryStatusOK
              : [terminalRecord close];
      BOOL exactTerminal =
          status == AncPrivateVaultCustodyRepositoryStatusOK &&
          terminalClosed == AncPrivateVaultCustodyRepositoryStatusOK &&
          terminalDigest.length == 32 &&
          terminalSnapshot.lifecycle ==
              ANC_PV_CUSTODY_LIFECYCLE_CANCELLED_GENESIS &&
          terminalSnapshot.custody_generation == 2 &&
          terminalSnapshot.removal_time_ms == cancelledAtMs &&
          anc_pv_memcmp(terminalSnapshot.removal_head, expected.bytes, 32) ==
              ANC_PV_CRYPTO_OK &&
          anc_pv_memcmp(terminalSnapshot.removal_authorization_digest,
                        cancellationCommitment, 32) == ANC_PV_CRYPTO_OK;
      if (!exactTerminal)
        status = terminalClosed != AncPrivateVaultCustodyRepositoryStatusOK
                     ? terminalClosed
                     : AncPrivateVaultCustodyRepositoryStatusCorrupt;
      else {
        result = [[AncPrivateVaultCancelledGenesisCustodyCheckpoint alloc]
            initPrivateWithVaultId:canonicalVaultId
                         generation:2
                       recordDigest:terminalDigest
             cancellationCommitment:
                 AncGenesisPublicData(cancellationCommitment)
                     cancelledAtMs:terminalSnapshot.removal_time_ms];
        if (result == nil)
          status = AncPrivateVaultCustodyRepositoryStatusFailed;
        else
          object_setClass(
              result, AncImmutableCancelledGenesisCustodyCheckpoint.class);
      }
      anc_pv_custody_snapshot_zero(&terminalSnapshot);
    }
    anc_pv_zeroize(cancellationCommitment,
                   sizeof cancellationCommitment);
    anc_pv_custody_snapshot_zero(&cancelled);
    anc_pv_custody_snapshot_zero(&current);
  });
  if (status == AncPrivateVaultCustodyRepositoryStatusOK && checkpoint != NULL)
    *checkpoint = result;
  return status;
}

@end

@implementation AncPrivateVaultCustodyRepository (RecoveryInternal)

- (AncPrivateVaultCustodyRepositoryStatus)
    installPendingRecoveryVaultId:(NSString *)vaultId
                        endpointId:(NSString *)endpointId
                        ceremonyId:(NSString *)ceremonyId
                   signingPublicKey:(NSData *)signingPublicKey
                        boxPublicKey:(NSData *)boxPublicKey
                          nextEpoch:(uint64_t)nextEpoch
          replacementRecoveryGeneration:(uint64_t)recoveryGeneration
                  expectedNextSequence:(uint64_t)expectedNextSequence
                   expectedPreviousHead:(NSData *)expectedPreviousHead
             recoveryAuthorizationHash:(NSData *)authorizationHash
                           secrets:
                               (const AncPrivateVaultCustodySecretInputs *)secrets
                        checkpoint:
                            (AncPrivateVaultPendingRecoveryCustodyCheckpoint **)
                                checkpoint {
  if (checkpoint != NULL)
    *checkpoint = nil;
  AncPrivateVaultCustodySnapshot snapshot;
  if (!AncBuildPendingRecoverySnapshot(
          vaultId, endpointId, ceremonyId, signingPublicKey, boxPublicKey,
          nextEpoch, recoveryGeneration, expectedNextSequence,
          expectedPreviousHead, authorizationHash, &snapshot) ||
      !AncGenesisSecretInputPointersValid(secrets)) {
    anc_pv_custody_snapshot_zero(&snapshot);
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  }
  NSString *canonicalVaultId =
      AncGenesisIdentifierString(snapshot.vault_id, snapshot.vault_id_length);
  if (canonicalVaultId == nil) {
    anc_pv_custody_snapshot_zero(&snapshot);
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  }
  AncPrivateVaultGuardedMemoryStatus memoryStatus;
  AncPrivateVaultGuardedMemory *owned =
      [AncPrivateVaultGuardedMemory memoryWithLength:160 status:&memoryStatus];
  if (owned == nil || memoryStatus != AncPrivateVaultGuardedMemoryStatusOK) {
    anc_pv_custody_snapshot_zero(&snapshot);
    return AncPrivateVaultCustodyRepositoryStatusFailed;
  }
  __block AncPrivateVaultCustodyRepositoryStatus status =
      AncPrivateVaultCustodyRepositoryStatusFailed;
  AncPrivateVaultGuardedMemoryStatus borrowed =
      [owned borrow:^BOOL(uint8_t *bytes, size_t length) {
        if (length != 160)
          return NO;
        memcpy(bytes, secrets->signing_seed, 32);
        memcpy(bytes + 32, secrets->box_seed, 32);
        memcpy(bytes + 64, secrets->local_state_key, 32);
        memcpy(bytes + 96, secrets->active_epoch_key, 32);
        memcpy(bytes + 128, secrets->pending_epoch_key, 32);
        AncPrivateVaultCustodySecretInputs copied = {
            .signing_seed = bytes,
            .box_seed = bytes + 32,
            .local_state_key = bytes + 64,
            .active_epoch_key = bytes + 96,
            .pending_epoch_key = bytes + 128,
        };
        status = AncGenesisValidateSecretInputs(
            &copied, snapshot.signing_public_key, snapshot.box_public_key);
        if (status == AncPrivateVaultCustodyRepositoryStatusOK)
          status = [self storeSnapshot:&snapshot
                               secrets:&copied
                               vaultId:canonicalVaultId];
        return status == AncPrivateVaultCustodyRepositoryStatusOK;
      }];
  AncPrivateVaultGuardedMemoryStatus closed = [owned close];
  if (closed != AncPrivateVaultGuardedMemoryStatusOK ||
      (borrowed != AncPrivateVaultGuardedMemoryStatusOK &&
       status == AncPrivateVaultCustodyRepositoryStatusOK))
    status = AncPrivateVaultCustodyRepositoryStatusFailed;
  if (status != AncPrivateVaultCustodyRepositoryStatusOK) {
    anc_pv_custody_snapshot_zero(&snapshot);
    return status;
  }
  __block AncPrivateVaultPendingRecoveryCustodyCheckpoint *result = nil;
  dispatch_sync(self.queue, ^{
    AncCustodyRecordBuffer *live = nil;
    AncPrivateVaultCustodySnapshot observed;
    status = [self reconcileVaultId:canonicalVaultId
                         liveRecord:&live
                       liveSnapshot:&observed];
    BOOL exact = status == AncPrivateVaultCustodyRepositoryStatusOK &&
                 AncPublicSnapshotsEqual(&observed, &snapshot);
    NSData *digest = exact ? AncCustodyDigest(live) : nil;
    AncPrivateVaultCustodyRepositoryStatus liveClosed =
        live == nil ? AncPrivateVaultCustodyRepositoryStatusOK : [live close];
    if (liveClosed != AncPrivateVaultCustodyRepositoryStatusOK)
      status = liveClosed;
    else if (!exact || digest.length != 32)
      status = AncPrivateVaultCustodyRepositoryStatusConflict;
    else {
      result = [[AncPrivateVaultPendingRecoveryCustodyCheckpoint alloc]
          initPrivateWithVaultId:canonicalVaultId
                       generation:observed.custody_generation
                     recordDigest:digest];
      if (result == nil)
        status = AncPrivateVaultCustodyRepositoryStatusFailed;
      else
        object_setClass(
            result, AncImmutablePendingRecoveryCustodyCheckpoint.class);
    }
    anc_pv_custody_snapshot_zero(&observed);
  });
  anc_pv_custody_snapshot_zero(&snapshot);
  if (status == AncPrivateVaultCustodyRepositoryStatusOK && checkpoint != NULL)
    *checkpoint = result;
  return status;
}

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
@property(nonatomic, copy) NSString *recordId;
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

static NSString *AncCustodyHandleRegistryId(NSString *recordId,
                                             NSString *vaultId) {
  if (recordId.length == 0 || vaultId.length == 0)
    return nil;
  return [NSString
      stringWithFormat:@"%lu:%@%@", (unsigned long)[recordId
                                             lengthOfBytesUsingEncoding:
                                                 NSUTF8StringEncoding],
                       recordId, vaultId];
}

static void AncRegisterHandle(AncPrivateVaultCustodyHandle *handle,
                              NSString *registryId, uint64_t generation) {
  NSMutableDictionary<NSNumber *, NSHashTable *> *vault =
      AncCustodyHandleRegistry()[registryId];
  if (vault == nil) {
    vault = [NSMutableDictionary dictionary];
    AncCustodyHandleRegistry()[registryId] = vault;
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
AncRevokeHandles(NSString *registryId) {
  NSMutableDictionary<NSNumber *, NSHashTable *> *vault =
      AncCustodyHandleRegistry()[registryId];
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
  [AncCustodyHandleRegistry() removeObjectForKey:registryId];
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

static BOOL AncGenesisCancellationCommitment(
    const AncPrivateVaultCustodySnapshot *current,
    NSData *pendingRecordDigest, uint64_t cancelledAtMs, uint8_t output[32]) {
  static const uint8_t domain[] =
      "anc/v1/private-vault/genesis-cancellation";
  if (current == NULL || output == NULL ||
      ![pendingRecordDigest isKindOfClass:NSData.class] ||
      pendingRecordDigest.length != 32 || cancelledAtMs == 0 ||
      current->vault_id_length != 32 || current->endpoint_id_length != 32 ||
      current->ceremony_id_length != 32)
    return NO;
  uint8_t body[232] = {0};
  memcpy(body, current->vault_id, 32);
  memcpy(body + 32, current->endpoint_id, 32);
  memcpy(body + 64, current->ceremony_id, 32);
  memcpy(body + 96, current->signing_public_key, 32);
  memcpy(body + 128, current->box_public_key, 32);
  memcpy(body + 160, current->pending_transcript_digest, 32);
  [pendingRecordDigest getBytes:body + 192 length:32];
  for (size_t index = 0; index < 8; index++)
    body[224 + index] = (uint8_t)(cancelledAtMs >> (56 - index * 8));
  BOOL valid = anc_pv_blake2b_256_two_part(
                   output, domain, sizeof domain, body, sizeof body) ==
               ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(body, sizeof body);
  if (!valid)
    anc_pv_zeroize(output, 32);
  return valid;
}

static BOOL
AncTerminalTransitionAllowed(const AncPrivateVaultCustodySnapshot *current,
                             const AncPrivateVaultCustodySnapshot *next,
                             NSData *currentRecordDigest) {
  if (current->lifecycle ==
      ANC_PV_CUSTODY_LIFECYCLE_CANCELLED_GENESIS)
    return NO;
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
  if (next->lifecycle ==
      ANC_PV_CUSTODY_LIFECYCLE_CANCELLED_GENESIS) {
    if (current->record_version != ANC_PV_CUSTODY_VERSION ||
        current->custody_generation != 1 ||
        current->lifecycle != ANC_PV_CUSTODY_LIFECYCLE_PENDING ||
        current->role != ANC_PV_CUSTODY_ROLE_ENDPOINT ||
        current->pending_kind != ANC_PV_CUSTODY_PENDING_GENESIS ||
        current->rotation_phase != ANC_PV_CUSTODY_ROTATION_PREPARED ||
        current->enrollment_phase != ANC_PV_CUSTODY_ENROLLMENT_NONE ||
        current->authority_anchor_present ||
        !current->expected_edge_present || current->active_epoch != 0 ||
        current->pending_epoch != 1 || current->recovery_generation != 0 ||
        current->vault_id_length != 32 || current->endpoint_id_length != 32 ||
        current->ceremony_id_length != 32 ||
        next->record_version != ANC_PV_CUSTODY_VERSION ||
        next->custody_generation != 2 ||
        next->role != ANC_PV_CUSTODY_ROLE_ENDPOINT ||
        next->pending_kind != ANC_PV_CUSTODY_PENDING_NONE ||
        next->rotation_phase != ANC_PV_CUSTODY_ROTATION_NONE ||
        next->enrollment_phase != ANC_PV_CUSTODY_ENROLLMENT_NONE ||
        next->authority_anchor_present || next->expected_edge_present ||
        next->active_epoch != 0 || next->pending_epoch != 0 ||
        next->recovery_generation != 0 || next->vault_id_length != 32 ||
        next->endpoint_id_length != 32 || next->ceremony_id_length != 0 ||
        next->removal_time_ms == 0 || currentRecordDigest.length != 32 ||
        memcmp(current->vault_id, next->vault_id, 32) != 0 ||
        memcmp(current->endpoint_id, next->endpoint_id, 32) != 0 ||
        memcmp(current->signing_public_key, next->signing_public_key, 32) != 0 ||
        memcmp(current->box_public_key, next->box_public_key, 32) != 0 ||
        anc_pv_memcmp(next->removal_head, currentRecordDigest.bytes, 32) !=
            ANC_PV_CRYPTO_OK)
      return NO;
    uint8_t expected[32] = {0};
    BOOL valid = AncGenesisCancellationCommitment(
                     current, currentRecordDigest, next->removal_time_ms,
                     expected) &&
                 anc_pv_memcmp(expected,
                               next->removal_authorization_digest, 32) ==
                     ANC_PV_CRYPTO_OK;
    anc_pv_zeroize(expected, sizeof expected);
    return valid;
  }
  if (next->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED)
    return NO;
  return YES;
}

static BOOL
AncLifecycleIsTombstone(const AncPrivateVaultCustodySnapshot *snapshot) {
  return snapshot->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVING ||
         snapshot->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED ||
         snapshot->lifecycle ==
             ANC_PV_CUSTODY_LIFECYCLE_CANCELLED_GENESIS;
}

@implementation AncPrivateVaultCustodyRepository

- (instancetype)init {
  AncPrivateVaultKeychain *keychain = [[AncPrivateVaultKeychain alloc] init];
  return [self initWithKeychain:keychain];
}

- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain {
  return [self initWithKeychain:keychain
                       recordId:AncPrivateVaultCustodyRecordId];
}

- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain
                        recordId:(NSString *)recordId {
  self = [super init];
  if (self == nil || keychain == nil || recordId.length == 0 ||
      [recordId lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 512)
    return nil;
  _keychain = keychain;
  _recordId = [recordId copy];
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
                            recordId:self.recordId
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
                                 recordId:self.recordId]
                    : [self.keychain
                          updateCustodyRecord:bytes
                                        length:ANC_PV_CUSTODY_RECORD_BYTES
                                  forService:service
                                     vaultId:vaultId
                                    recordId:self.recordId];
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
                                recordId:self.recordId];
  if (deleted != AncPrivateVaultKeychainStatusOK)
    return AncRepositoryStatusForKeychain(deleted);
  __block BOOL observed = NO;
  AncPrivateVaultKeychainStatus read = [self.keychain
      consumeCustodyRecordForService:AncPrivateVaultCustodyStageService
                             vaultId:vaultId
                            recordId:self.recordId
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
  NSString *registryId = AncCustodyHandleRegistryId(self.recordId, vaultId);
  if (registryId == nil)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  AncPrivateVaultCustodyRepositoryStatus revoked =
      AncRevokeHandles(registryId);
  if (revoked != AncPrivateVaultCustodyRepositoryStatusOK)
    return revoked;
  AncPrivateVaultFenceStatus fence =
      [self.fence beginGeneration:generation
                     recordDigest:digest
                          vaultId:vaultId
                         recordId:self.recordId];
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
                              recordId:self.recordId];
  if (fence != AncPrivateVaultFenceStatusOK)
    return AncRepositoryStatusForFence(fence);
  AncPrivateVaultFenceSnapshot *verifiedFence = nil;
  fence = [self.fence readVaultId:vaultId
                         recordId:self.recordId
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
                     recordId:self.recordId
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
        if (!AncTerminalTransitionAllowed(&liveSnapshot, &stageSnapshot,
                                          liveDigest))
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
                              recordId:self.recordId];
      if (committed != AncPrivateVaultFenceStatusOK)
        return closeBoth(AncRepositoryStatusForFence(committed));
      AncPrivateVaultCustodyRepositoryStatus deleted =
          [self deleteStageVaultId:vaultId];
      if (deleted != AncPrivateVaultCustodyRepositoryStatusOK)
        return closeBoth(deleted);
    } else if (fence.generation != UINT64_MAX &&
               stageSnapshot.custody_generation == fence.generation + 1) {
      if (!AncTerminalTransitionAllowed(&liveSnapshot, &stageSnapshot,
                                        liveDigest))
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
    NSData *currentDigest = AncCustodyDigest(current);
    if (currentDigest.length != 32 ||
        !AncTerminalTransitionAllowed(&currentSnapshot, snapshot,
                                      currentDigest)) {
      AncPrivateVaultCustodyRepositoryStatus closed = [current close];
      if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
        return closed;
      return AncPrivateVaultCustodyRepositoryStatusConflict;
    }
    AncPrivateVaultCustodyRepositoryStatus closed = [current close];
    if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
      return closed;
  }
  NSString *registryId = AncCustodyHandleRegistryId(self.recordId, vaultId);
  if (registryId == nil)
    return AncPrivateVaultCustodyRepositoryStatusInvalid;
  AncPrivateVaultCustodyRepositoryStatus revoked =
      AncRevokeHandles(registryId);
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

static BOOL AncAllZero(const uint8_t *bytes, size_t length) {
  uint8_t value = 0;
  for (size_t index = 0; index < length; index++)
    value |= bytes[index];
  return value == 0;
}

static BOOL AncPublicSnapshotsEqual(
    const AncPrivateVaultCustodySnapshot *left,
    const AncPrivateVaultCustodySnapshot *right) {
#define ANC_EQUAL_SCALAR(field) (left->field == right->field)
#define ANC_EQUAL_BYTES(field)                                                  \
  (anc_pv_memcmp(left->field, right->field, sizeof left->field) ==             \
   ANC_PV_CRYPTO_OK)
  return ANC_EQUAL_SCALAR(record_version) &&
         ANC_EQUAL_SCALAR(authority_anchor_present) &&
         ANC_EQUAL_SCALAR(expected_edge_present) && ANC_EQUAL_SCALAR(lifecycle) &&
         ANC_EQUAL_SCALAR(role) && ANC_EQUAL_SCALAR(pending_kind) &&
         ANC_EQUAL_SCALAR(rotation_phase) && ANC_EQUAL_SCALAR(enrollment_phase) &&
         ANC_EQUAL_SCALAR(custody_generation) && ANC_EQUAL_BYTES(vault_id) &&
         ANC_EQUAL_SCALAR(vault_id_length) && ANC_EQUAL_BYTES(endpoint_id) &&
         ANC_EQUAL_SCALAR(endpoint_id_length) && ANC_EQUAL_BYTES(ceremony_id) &&
         ANC_EQUAL_SCALAR(ceremony_id_length) &&
         ANC_EQUAL_BYTES(signing_public_key) && ANC_EQUAL_BYTES(box_public_key) &&
         ANC_EQUAL_SCALAR(active_epoch) && ANC_EQUAL_SCALAR(pending_epoch) &&
         ANC_EQUAL_SCALAR(recovery_generation) &&
         ANC_EQUAL_SCALAR(anchored_sequence) && ANC_EQUAL_BYTES(anchored_head) &&
         ANC_EQUAL_BYTES(membership_digest) && ANC_EQUAL_SCALAR(signed_at_ms) &&
         ANC_EQUAL_BYTES(snapshot_digest) && ANC_EQUAL_SCALAR(freshness_ms) &&
         ANC_EQUAL_SCALAR(expected_next_sequence) &&
         ANC_EQUAL_BYTES(expected_previous_head) &&
         ANC_EQUAL_BYTES(pending_transcript_digest) &&
         ANC_EQUAL_SCALAR(removal_sequence) && ANC_EQUAL_BYTES(removal_head) &&
         ANC_EQUAL_BYTES(removal_authorization_digest) &&
         ANC_EQUAL_SCALAR(removal_time_ms);
#undef ANC_EQUAL_BYTES
#undef ANC_EQUAL_SCALAR
}

static BOOL AncGenesisOfficialPublicStateValid(
    const AncPrivateVaultCustodySnapshot *pending,
    const AncPrivateVaultCustodySnapshot *official, NSString *vaultId) {
  return pending->record_version == ANC_PV_CUSTODY_VERSION &&
         pending->custody_generation == 1 &&
         pending->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
         pending->role == ANC_PV_CUSTODY_ROLE_ENDPOINT &&
         pending->pending_kind == ANC_PV_CUSTODY_PENDING_GENESIS &&
         pending->rotation_phase == ANC_PV_CUSTODY_ROTATION_PREPARED &&
         pending->enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_NONE &&
         !pending->authority_anchor_present && pending->expected_edge_present &&
         pending->active_epoch == 0 && pending->pending_epoch == 1 &&
         pending->recovery_generation == 0 &&
         pending->anchored_sequence == 0 &&
         AncAllZero(pending->anchored_head, ANC_PV_HASH_BYTES) &&
         AncAllZero(pending->membership_digest, ANC_PV_HASH_BYTES) &&
         pending->signed_at_ms == 0 &&
         AncAllZero(pending->snapshot_digest, ANC_PV_HASH_BYTES) &&
         pending->freshness_ms == 0 && pending->expected_next_sequence == 0 &&
         AncAllZero(pending->expected_previous_head, ANC_PV_HASH_BYTES) &&
         pending->ceremony_id_length > 0 &&
         !AncAllZero(pending->pending_transcript_digest, ANC_PV_HASH_BYTES) &&
         official->record_version == ANC_PV_CUSTODY_VERSION &&
         official->custody_generation == 2 &&
         official->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
         official->role == pending->role &&
         official->pending_kind == ANC_PV_CUSTODY_PENDING_NONE &&
         official->rotation_phase == ANC_PV_CUSTODY_ROTATION_NONE &&
         official->enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_NONE &&
         official->authority_anchor_present && !official->expected_edge_present &&
         official->active_epoch == 1 && official->pending_epoch == 0 &&
         official->recovery_generation == 1 && official->anchored_sequence == 0 &&
         official->ceremony_id_length == 0 &&
         official->expected_next_sequence == 0 &&
         AncAllZero(official->expected_previous_head, ANC_PV_HASH_BYTES) &&
         AncAllZero(official->pending_transcript_digest, ANC_PV_HASH_BYTES) &&
         official->signed_at_ms > 0 && official->freshness_ms > 0 &&
         !AncAllZero(official->anchored_head, ANC_PV_HASH_BYTES) &&
         !AncAllZero(official->membership_digest, ANC_PV_HASH_BYTES) &&
         !AncAllZero(official->snapshot_digest, ANC_PV_HASH_BYTES) &&
         AncSnapshotMatchesVaultId(official, vaultId) &&
         pending->vault_id_length == official->vault_id_length &&
         memcmp(pending->vault_id, official->vault_id,
                pending->vault_id_length) == 0 &&
         pending->endpoint_id_length == official->endpoint_id_length &&
         memcmp(pending->endpoint_id, official->endpoint_id,
                pending->endpoint_id_length) == 0 &&
         memcmp(pending->signing_public_key, official->signing_public_key,
                ANC_PV_SIGN_PUBLIC_KEY_BYTES) == 0 &&
         memcmp(pending->box_public_key, official->box_public_key,
                ANC_PV_BOX_PUBLIC_KEY_BYTES) == 0;
}

static BOOL AncRecoveryOfficialPublicStateValid(
    const AncPrivateVaultCustodySnapshot *pending,
    const AncPrivateVaultCustodySnapshot *official, NSString *vaultId) {
  return pending->record_version == ANC_PV_CUSTODY_VERSION &&
         pending->custody_generation == 1 &&
         pending->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
         pending->role == ANC_PV_CUSTODY_ROLE_ENDPOINT &&
         pending->pending_kind == ANC_PV_CUSTODY_PENDING_RECOVERY &&
         pending->rotation_phase == ANC_PV_CUSTODY_ROTATION_PREPARED &&
         pending->enrollment_phase ==
             ANC_PV_CUSTODY_ENROLLMENT_AUTHORIZATION_RECEIVED &&
         !pending->authority_anchor_present && pending->expected_edge_present &&
         pending->active_epoch == 0 && pending->pending_epoch > 0 &&
         pending->recovery_generation > 0 &&
         pending->anchored_sequence == 0 &&
         AncAllZero(pending->anchored_head, ANC_PV_HASH_BYTES) &&
         AncAllZero(pending->membership_digest, ANC_PV_HASH_BYTES) &&
         pending->signed_at_ms == 0 &&
         AncAllZero(pending->snapshot_digest, ANC_PV_HASH_BYTES) &&
         pending->freshness_ms == 0 && pending->expected_next_sequence > 0 &&
         !AncAllZero(pending->expected_previous_head, ANC_PV_HASH_BYTES) &&
         pending->ceremony_id_length > 0 &&
         !AncAllZero(pending->pending_transcript_digest, ANC_PV_HASH_BYTES) &&
         official->record_version == ANC_PV_CUSTODY_VERSION &&
         official->custody_generation == 2 &&
         official->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
         official->role == pending->role &&
         official->pending_kind == ANC_PV_CUSTODY_PENDING_NONE &&
         official->rotation_phase == ANC_PV_CUSTODY_ROTATION_NONE &&
         official->enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_NONE &&
         official->authority_anchor_present && !official->expected_edge_present &&
         official->active_epoch == pending->pending_epoch &&
         official->pending_epoch == 0 &&
         official->recovery_generation == pending->recovery_generation &&
         official->anchored_sequence == pending->expected_next_sequence &&
         official->ceremony_id_length == 0 &&
         official->expected_next_sequence == 0 &&
         AncAllZero(official->expected_previous_head, ANC_PV_HASH_BYTES) &&
         AncAllZero(official->pending_transcript_digest, ANC_PV_HASH_BYTES) &&
         official->signed_at_ms > 0 && official->freshness_ms > 0 &&
         !AncAllZero(official->anchored_head, ANC_PV_HASH_BYTES) &&
         !AncAllZero(official->membership_digest, ANC_PV_HASH_BYTES) &&
         !AncAllZero(official->snapshot_digest, ANC_PV_HASH_BYTES) &&
         AncSnapshotMatchesVaultId(official, vaultId) &&
         pending->vault_id_length == official->vault_id_length &&
         memcmp(pending->vault_id, official->vault_id,
                pending->vault_id_length) == 0 &&
         pending->endpoint_id_length == official->endpoint_id_length &&
         memcmp(pending->endpoint_id, official->endpoint_id,
                pending->endpoint_id_length) == 0 &&
         memcmp(pending->signing_public_key, official->signing_public_key,
                ANC_PV_SIGN_PUBLIC_KEY_BYTES) == 0 &&
         memcmp(pending->box_public_key, official->box_public_key,
                ANC_PV_BOX_PUBLIC_KEY_BYTES) == 0;
}

static BOOL AncAllZero(const uint8_t *bytes, size_t length);
static BOOL AncPublicSnapshotsEqual(
    const AncPrivateVaultCustodySnapshot *left,
    const AncPrivateVaultCustodySnapshot *right);

static BOOL AncEnrollmentAuthorizationPublicStateValid(
    const AncPrivateVaultCustodySnapshot *offer,
    const AncPrivateVaultCustodySnapshot *authorized, NSString *vaultId) {
  if (offer == NULL || authorized == NULL ||
      offer->custody_generation == UINT64_MAX)
    return NO;
  AncPrivateVaultCustodySnapshot normalized = *authorized;
  normalized.authority_anchor_present = offer->authority_anchor_present;
  normalized.expected_edge_present = offer->expected_edge_present;
  normalized.enrollment_phase = offer->enrollment_phase;
  normalized.custody_generation = offer->custody_generation;
  normalized.active_epoch = offer->active_epoch;
  normalized.recovery_generation = offer->recovery_generation;
  normalized.anchored_sequence = offer->anchored_sequence;
  memcpy(normalized.anchored_head, offer->anchored_head,
         ANC_PV_HASH_BYTES);
  memcpy(normalized.membership_digest, offer->membership_digest,
         ANC_PV_HASH_BYTES);
  normalized.signed_at_ms = offer->signed_at_ms;
  memcpy(normalized.snapshot_digest, offer->snapshot_digest,
         ANC_PV_HASH_BYTES);
  normalized.freshness_ms = offer->freshness_ms;
  normalized.expected_next_sequence = offer->expected_next_sequence;
  memcpy(normalized.expected_previous_head, offer->expected_previous_head,
         ANC_PV_HASH_BYTES);
  memcpy(normalized.pending_transcript_digest,
         offer->pending_transcript_digest, ANC_PV_HASH_BYTES);
  return offer->record_version == ANC_PV_CUSTODY_VERSION &&
         offer->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
         (offer->pending_kind == ANC_PV_CUSTODY_PENDING_ADD_DEVICE ||
          offer->pending_kind == ANC_PV_CUSTODY_PENDING_ADD_BROKER) &&
         offer->enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_OFFER_PENDING &&
         offer->rotation_phase == ANC_PV_CUSTODY_ROTATION_NONE &&
         !offer->authority_anchor_present && !offer->expected_edge_present &&
         offer->active_epoch == 0 && offer->pending_epoch == 0 &&
         offer->recovery_generation == 0 &&
         authorized->custody_generation == offer->custody_generation + 1 &&
         authorized->enrollment_phase ==
             ANC_PV_CUSTODY_ENROLLMENT_AUTHORIZATION_RECEIVED &&
         authorized->authority_anchor_present &&
         authorized->expected_edge_present && authorized->active_epoch > 0 &&
         authorized->pending_epoch == 0 &&
         authorized->recovery_generation > 0 &&
         authorized->expected_next_sequence ==
             authorized->anchored_sequence + 1 &&
         anc_pv_memcmp(authorized->expected_previous_head,
                       authorized->anchored_head, ANC_PV_HASH_BYTES) ==
             ANC_PV_CRYPTO_OK &&
         !AncAllZero(authorized->anchored_head, ANC_PV_HASH_BYTES) &&
         !AncAllZero(authorized->membership_digest, ANC_PV_HASH_BYTES) &&
         !AncAllZero(authorized->snapshot_digest, ANC_PV_HASH_BYTES) &&
         !AncAllZero(authorized->pending_transcript_digest,
                     ANC_PV_HASH_BYTES) &&
         authorized->signed_at_ms > 0 && authorized->freshness_ms > 0 &&
         AncSnapshotMatchesVaultId(authorized, vaultId) &&
         AncPublicSnapshotsEqual(offer, &normalized);
}

static BOOL AncEnrollmentOfficialPublicStateValid(
    const AncPrivateVaultCustodySnapshot *pending,
    const AncPrivateVaultCustodySnapshot *official, NSString *vaultId) {
  if (pending == NULL || official == NULL ||
      pending->custody_generation == UINT64_MAX)
    return NO;
  AncPrivateVaultCustodySnapshot normalized = *official;
  normalized.lifecycle = pending->lifecycle;
  normalized.pending_kind = pending->pending_kind;
  normalized.enrollment_phase = pending->enrollment_phase;
  normalized.custody_generation = pending->custody_generation;
  memcpy(normalized.ceremony_id, pending->ceremony_id,
         sizeof normalized.ceremony_id);
  normalized.ceremony_id_length = pending->ceremony_id_length;
  normalized.anchored_sequence = pending->anchored_sequence;
  memcpy(normalized.anchored_head, pending->anchored_head,
         ANC_PV_HASH_BYTES);
  memcpy(normalized.membership_digest, pending->membership_digest,
         ANC_PV_HASH_BYTES);
  normalized.signed_at_ms = pending->signed_at_ms;
  memcpy(normalized.snapshot_digest, pending->snapshot_digest,
         ANC_PV_HASH_BYTES);
  normalized.freshness_ms = pending->freshness_ms;
  normalized.expected_edge_present = pending->expected_edge_present;
  normalized.expected_next_sequence = pending->expected_next_sequence;
  memcpy(normalized.expected_previous_head, pending->expected_previous_head,
         ANC_PV_HASH_BYTES);
  memcpy(normalized.pending_transcript_digest,
         pending->pending_transcript_digest, ANC_PV_HASH_BYTES);
  return pending->record_version == ANC_PV_CUSTODY_VERSION &&
         pending->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
         (pending->pending_kind == ANC_PV_CUSTODY_PENDING_ADD_DEVICE ||
          pending->pending_kind == ANC_PV_CUSTODY_PENDING_ADD_BROKER) &&
         pending->enrollment_phase ==
             ANC_PV_CUSTODY_ENROLLMENT_AUTHORIZATION_RECEIVED &&
         pending->authority_anchor_present && pending->expected_edge_present &&
         pending->active_epoch > 0 && pending->pending_epoch == 0 &&
         pending->expected_next_sequence == pending->anchored_sequence + 1 &&
         official->record_version == ANC_PV_CUSTODY_VERSION &&
         official->custody_generation == pending->custody_generation + 1 &&
         official->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
         official->pending_kind == ANC_PV_CUSTODY_PENDING_NONE &&
         official->rotation_phase == ANC_PV_CUSTODY_ROTATION_NONE &&
         official->enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_NONE &&
         official->authority_anchor_present &&
         !official->expected_edge_present &&
         official->active_epoch == pending->active_epoch &&
         official->pending_epoch == 0 &&
         official->recovery_generation == pending->recovery_generation &&
         official->anchored_sequence == pending->expected_next_sequence &&
         official->ceremony_id_length == 0 &&
         official->expected_next_sequence == 0 &&
         AncAllZero(official->expected_previous_head, ANC_PV_HASH_BYTES) &&
         AncAllZero(official->pending_transcript_digest, ANC_PV_HASH_BYTES) &&
         official->signed_at_ms >= pending->signed_at_ms &&
         official->freshness_ms >= pending->freshness_ms &&
         !AncAllZero(official->anchored_head, ANC_PV_HASH_BYTES) &&
         !AncAllZero(official->membership_digest, ANC_PV_HASH_BYTES) &&
         !AncAllZero(official->snapshot_digest, ANC_PV_HASH_BYTES) &&
         AncSnapshotMatchesVaultId(official, vaultId) &&
         AncPublicSnapshotsEqual(pending, &normalized);
}

- (AncPrivateVaultCustodyRepositoryStatus)
    promoteGenesisAuthorityAnchorVaultId:(NSString *)vaultId
                       nextPublicSnapshot:
                           (const AncPrivateVaultCustodySnapshot *)nextPublicSnapshot {
  if ([NSThread.currentThread.threadDictionary[kAncCustodyBorrowScopeThreadKey]
          boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  if (vaultId.length == 0 || nextPublicSnapshot == NULL)
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
    if (current.record_version == ANC_PV_CUSTODY_VERSION &&
        current.custody_generation == 2 &&
        current.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
        current.authority_anchor_present &&
        AncPublicSnapshotsEqual(&current, nextPublicSnapshot)) {
      status = [live close];
      return;
    }
    if (!AncGenesisOfficialPublicStateValid(&current, nextPublicSnapshot,
                                            vaultId)) {
      AncPrivateVaultCustodyRepositoryStatus closed = [live close];
      status = closed == AncPrivateVaultCustodyRepositoryStatusOK
                   ? AncPrivateVaultCustodyRepositoryStatusConflict
                   : closed;
      return;
    }
    AncPrivateVaultCustodyHandle *handle = nil;
    AncPrivateVaultCustodySnapshot decoded;
    status = AncDecodeRecord(live, &decoded, &handle);
    AncPrivateVaultCustodyRepositoryStatus liveClosed = [live close];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK ||
        liveClosed != AncPrivateVaultCustodyRepositoryStatusOK) {
      if (liveClosed != AncPrivateVaultCustodyRepositoryStatusOK)
        status = liveClosed;
      return;
    }
    AncCustodyRecordBuffer *candidate = [[AncCustodyRecordBuffer alloc] initEmpty];
    if (candidate == nil) {
      status = [handle close];
      if (status == AncPrivateVaultCustodyRepositoryStatusOK)
        status = AncPrivateVaultCustodyRepositoryStatusFailed;
      return;
    }
    __block BOOL encoded = NO;
    status = [candidate borrow:^BOOL(uint8_t *recordBytes) {
      AncPrivateVaultCustodyRepositoryStatus borrowed = [handle
          borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
            uint8_t zeroKey[ANC_PV_KEY_BYTES] = {0};
            AncPrivateVaultCustodySecretInputs promoted = *secrets;
            promoted.active_epoch_key = secrets->pending_epoch_key;
            promoted.pending_epoch_key = zeroKey;
            encoded = anc_pv_custody_record_encode(
                          nextPublicSnapshot, &promoted, recordBytes,
                          ANC_PV_CUSTODY_RECORD_BYTES) == ANC_PV_CUSTODY_OK;
            anc_pv_zeroize(zeroKey, sizeof zeroKey);
            return encoded;
          }];
      return borrowed == AncPrivateVaultCustodyRepositoryStatusOK && encoded;
    }];
    AncPrivateVaultCustodyRepositoryStatus handleClosed = [handle close];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK || !encoded ||
        handleClosed != AncPrivateVaultCustodyRepositoryStatusOK) {
      AncPrivateVaultCustodyRepositoryStatus candidateClosed = [candidate close];
      status = handleClosed != AncPrivateVaultCustodyRepositoryStatusOK
                   ? handleClosed
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
    promoteRecoveryAuthorityAnchorVaultId:(NSString *)vaultId
                        nextPublicSnapshot:
                            (const AncPrivateVaultCustodySnapshot *)nextPublicSnapshot {
  if ([NSThread.currentThread.threadDictionary[kAncCustodyBorrowScopeThreadKey]
          boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  if (vaultId.length == 0 || nextPublicSnapshot == NULL)
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
    if (current.record_version == ANC_PV_CUSTODY_VERSION &&
        current.custody_generation == 2 &&
        current.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
        current.authority_anchor_present &&
        AncPublicSnapshotsEqual(&current, nextPublicSnapshot)) {
      status = [live close];
      return;
    }
    if (!AncRecoveryOfficialPublicStateValid(&current, nextPublicSnapshot,
                                             vaultId)) {
      AncPrivateVaultCustodyRepositoryStatus closed = [live close];
      status = closed == AncPrivateVaultCustodyRepositoryStatusOK
                   ? AncPrivateVaultCustodyRepositoryStatusConflict
                   : closed;
      return;
    }
    AncPrivateVaultCustodyHandle *handle = nil;
    AncPrivateVaultCustodySnapshot decoded;
    status = AncDecodeRecord(live, &decoded, &handle);
    AncPrivateVaultCustodyRepositoryStatus liveClosed = [live close];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK ||
        liveClosed != AncPrivateVaultCustodyRepositoryStatusOK) {
      if (liveClosed != AncPrivateVaultCustodyRepositoryStatusOK)
        status = liveClosed;
      return;
    }
    AncCustodyRecordBuffer *candidate = [[AncCustodyRecordBuffer alloc] initEmpty];
    if (candidate == nil) {
      status = [handle close];
      if (status == AncPrivateVaultCustodyRepositoryStatusOK)
        status = AncPrivateVaultCustodyRepositoryStatusFailed;
      return;
    }
    __block BOOL encoded = NO;
    status = [candidate borrow:^BOOL(uint8_t *recordBytes) {
      AncPrivateVaultCustodyRepositoryStatus borrowed = [handle
          borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
            uint8_t zeroKey[ANC_PV_KEY_BYTES] = {0};
            AncPrivateVaultCustodySecretInputs promoted = *secrets;
            promoted.active_epoch_key = secrets->pending_epoch_key;
            promoted.pending_epoch_key = zeroKey;
            encoded = anc_pv_custody_record_encode(
                          nextPublicSnapshot, &promoted, recordBytes,
                          ANC_PV_CUSTODY_RECORD_BYTES) == ANC_PV_CUSTODY_OK;
            anc_pv_zeroize(zeroKey, sizeof zeroKey);
            return encoded;
          }];
      return borrowed == AncPrivateVaultCustodyRepositoryStatusOK && encoded;
    }];
    AncPrivateVaultCustodyRepositoryStatus handleClosed = [handle close];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK || !encoded ||
        handleClosed != AncPrivateVaultCustodyRepositoryStatusOK) {
      AncPrivateVaultCustodyRepositoryStatus candidateClosed = [candidate close];
      status = handleClosed != AncPrivateVaultCustodyRepositoryStatusOK
                   ? handleClosed
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
    acceptEnrollmentAuthorizationVaultId:(NSString *)vaultId
                       expectedGeneration:(uint64_t)expectedGeneration
                       nextPublicSnapshot:
                           (const AncPrivateVaultCustodySnapshot *)nextPublicSnapshot
                           activeEpochKey:
                               (const uint8_t *)activeEpochKey {
  if ([NSThread.currentThread.threadDictionary[kAncCustodyBorrowScopeThreadKey]
          boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  if (vaultId.length == 0 || expectedGeneration == 0 ||
      nextPublicSnapshot == NULL || activeEpochKey == NULL ||
      AncAllZero(activeEpochKey, ANC_PV_KEY_BYTES))
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
    if (current.custody_generation == nextPublicSnapshot->custody_generation &&
        AncPublicSnapshotsEqual(&current, nextPublicSnapshot)) {
      AncPrivateVaultCustodyHandle *handle = nil;
      AncPrivateVaultCustodySnapshot decoded;
      status = AncDecodeRecord(live, &decoded, &handle);
      AncPrivateVaultCustodyRepositoryStatus liveClosed = [live close];
      if (status == AncPrivateVaultCustodyRepositoryStatusOK &&
          liveClosed == AncPrivateVaultCustodyRepositoryStatusOK) {
        __block BOOL exact = NO;
        status = [handle
            borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
              exact = anc_pv_memcmp(secrets->active_epoch_key, activeEpochKey,
                                    ANC_PV_KEY_BYTES) == ANC_PV_CRYPTO_OK;
              return YES;
            }];
        AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
        if (status == AncPrivateVaultCustodyRepositoryStatusOK &&
            closed != AncPrivateVaultCustodyRepositoryStatusOK)
          status = closed;
        if (status == AncPrivateVaultCustodyRepositoryStatusOK && !exact)
          status = AncPrivateVaultCustodyRepositoryStatusConflict;
      } else if (liveClosed != AncPrivateVaultCustodyRepositoryStatusOK) {
        status = liveClosed;
      }
      return;
    }
    if (current.custody_generation != expectedGeneration ||
        !AncEnrollmentAuthorizationPublicStateValid(
            &current, nextPublicSnapshot, vaultId)) {
      AncPrivateVaultCustodyRepositoryStatus closed = [live close];
      status = closed == AncPrivateVaultCustodyRepositoryStatusOK
                   ? AncPrivateVaultCustodyRepositoryStatusConflict
                   : closed;
      return;
    }
    AncPrivateVaultCustodyHandle *handle = nil;
    AncPrivateVaultCustodySnapshot decoded;
    status = AncDecodeRecord(live, &decoded, &handle);
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
      status = [handle close];
      if (status == AncPrivateVaultCustodyRepositoryStatusOK)
        status = AncPrivateVaultCustodyRepositoryStatusFailed;
      return;
    }
    __block BOOL encoded = NO;
    status = [candidate borrow:^BOOL(uint8_t *recordBytes) {
      AncPrivateVaultCustodyRepositoryStatus borrowed = [handle
          borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
            uint8_t zero[ANC_PV_KEY_BYTES] = {0};
            AncPrivateVaultCustodySecretInputs nextSecrets = *secrets;
            nextSecrets.active_epoch_key = activeEpochKey;
            nextSecrets.pending_epoch_key = zero;
            encoded = anc_pv_custody_record_encode(
                          nextPublicSnapshot, &nextSecrets, recordBytes,
                          ANC_PV_CUSTODY_RECORD_BYTES) == ANC_PV_CUSTODY_OK;
            anc_pv_zeroize(zero, sizeof zero);
            return encoded;
          }];
      return borrowed == AncPrivateVaultCustodyRepositoryStatusOK && encoded;
    }];
    AncPrivateVaultCustodyRepositoryStatus handleClosed = [handle close];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK || !encoded ||
        handleClosed != AncPrivateVaultCustodyRepositoryStatusOK) {
      AncPrivateVaultCustodyRepositoryStatus candidateClosed =
          [candidate close];
      status = handleClosed != AncPrivateVaultCustodyRepositoryStatusOK
                   ? handleClosed
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
    promoteEnrollmentAuthorityAnchorVaultId:(NSString *)vaultId
                          nextPublicSnapshot:
                              (const AncPrivateVaultCustodySnapshot *)nextPublicSnapshot {
  if ([NSThread.currentThread.threadDictionary[kAncCustodyBorrowScopeThreadKey]
          boolValue])
    return AncPrivateVaultCustodyRepositoryStatusConflict;
  if (vaultId.length == 0 || nextPublicSnapshot == NULL)
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
    if (current.custody_generation == nextPublicSnapshot->custody_generation &&
        current.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
        AncPublicSnapshotsEqual(&current, nextPublicSnapshot)) {
      status = [live close];
      return;
    }
    if (!AncEnrollmentOfficialPublicStateValid(&current, nextPublicSnapshot,
                                               vaultId)) {
      AncPrivateVaultCustodyRepositoryStatus closed = [live close];
      status = closed == AncPrivateVaultCustodyRepositoryStatusOK
                   ? AncPrivateVaultCustodyRepositoryStatusConflict
                   : closed;
      return;
    }
    AncPrivateVaultCustodyHandle *handle = nil;
    AncPrivateVaultCustodySnapshot decoded;
    status = AncDecodeRecord(live, &decoded, &handle);
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
      status = [handle close];
      if (status == AncPrivateVaultCustodyRepositoryStatusOK)
        status = AncPrivateVaultCustodyRepositoryStatusFailed;
      return;
    }
    __block BOOL encoded = NO;
    status = [candidate borrow:^BOOL(uint8_t *recordBytes) {
      AncPrivateVaultCustodyRepositoryStatus borrowed = [handle
          borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
            uint8_t zero[ANC_PV_KEY_BYTES] = {0};
            AncPrivateVaultCustodySecretInputs nextSecrets = *secrets;
            nextSecrets.pending_epoch_key = zero;
            encoded = anc_pv_custody_record_encode(
                          nextPublicSnapshot, &nextSecrets, recordBytes,
                          ANC_PV_CUSTODY_RECORD_BYTES) == ANC_PV_CUSTODY_OK;
            anc_pv_zeroize(zero, sizeof zero);
            return encoded;
          }];
      return borrowed == AncPrivateVaultCustodyRepositoryStatusOK && encoded;
    }];
    AncPrivateVaultCustodyRepositoryStatus handleClosed = [handle close];
    if (status != AncPrivateVaultCustodyRepositoryStatusOK || !encoded ||
        handleClosed != AncPrivateVaultCustodyRepositoryStatusOK) {
      AncPrivateVaultCustodyRepositoryStatus candidateClosed =
          [candidate close];
      status = handleClosed != AncPrivateVaultCustodyRepositoryStatusOK
                   ? handleClosed
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
  if (snapshot->lifecycle ==
      ANC_PV_CUSTODY_LIFECYCLE_CANCELLED_GENESIS)
    return AncPrivateVaultCustodyRepositoryStatusConflict;
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
    NSString *registryId =
        AncCustodyHandleRegistryId(self.recordId, vaultId);
    if (registryId == nil) {
      status = [custodyHandle close];
      if (status == AncPrivateVaultCustodyRepositoryStatusOK)
        status = AncPrivateVaultCustodyRepositoryStatusInvalid;
      return;
    }
    AncRegisterHandle(custodyHandle, registryId,
                      decoded.custody_generation);
    resultHandle = custodyHandle;
  });
  if (status == AncPrivateVaultCustodyRepositoryStatusOK) {
    *snapshot = resultSnapshot;
    *handle = resultHandle;
  }
  return status;
}

@end
