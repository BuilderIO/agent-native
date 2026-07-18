#import "PrivateVaultGenesisCoordinator.h"

#import "PrivateVaultAuthorityStoreInternal.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultGenesisAuthorization.h"
#import "PrivateVaultGenesisAuthorizationInternal.h"
#import "PrivateVaultGenesisBootstrap.h"
#import "PrivateVaultGenesisBuilder.h"
#import "PrivateVaultGenesisCoordinatorInternal.h"
#import "PrivateVaultGenesisLock.h"
#import "PrivateVaultGenesisPreparationStoreInternal.h"
#import "PrivateVaultCustodyRepositoryGenesisInternal.h"
#import "PrivateVaultMnemonic.h"
#import "PrivateVaultRecoveryAuthority.h"

#import <math.h>
#import <objc/runtime.h>

static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);

@interface AncPrivateVaultGenesisCoordinatorResult ()
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite)
    AncPrivateVaultAuthorityCheckpoint *authorityCheckpoint;
@property(nonatomic, readwrite) uint64_t custodyGeneration;
@property(nonatomic, readwrite) uint64_t activeEpoch;
@property(nonatomic, readwrite) uint64_t sequence;
@property(nonatomic, readwrite) NSData *headHash;
@property(nonatomic, readwrite) NSData *membershipHash;
@property(nonatomic, readwrite) uint64_t recoveryGeneration;
@property(nonatomic, readwrite) NSData *recoveryWrapHash;
@end
@interface AncImmutableGenesisCoordinatorResult
    : AncPrivateVaultGenesisCoordinatorResult
@end
static void RaiseImmutable(void) {
  [NSException raise:NSInternalInconsistencyException
              format:@"genesis coordinator results are immutable"];
}
@implementation AncImmutableGenesisCoordinatorResult
- (void)setVaultId:(NSString *)v {
  (void)v;
  RaiseImmutable();
}
- (void)setAuthorityCheckpoint:(AncPrivateVaultAuthorityCheckpoint *)v {
  (void)v;
  RaiseImmutable();
}
- (void)setCustodyGeneration:(uint64_t)v {
  (void)v;
  RaiseImmutable();
}
- (void)setActiveEpoch:(uint64_t)v {
  (void)v;
  RaiseImmutable();
}
- (void)setSequence:(uint64_t)v {
  (void)v;
  RaiseImmutable();
}
- (void)setHeadHash:(NSData *)v {
  (void)v;
  RaiseImmutable();
}
- (void)setMembershipHash:(NSData *)v {
  (void)v;
  RaiseImmutable();
}
- (void)setRecoveryGeneration:(uint64_t)v {
  (void)v;
  RaiseImmutable();
}
- (void)setRecoveryWrapHash:(NSData *)v {
  (void)v;
  RaiseImmutable();
}
- (void)setValue:(id)v forKey:(NSString *)k {
  (void)v;
  (void)k;
  RaiseImmutable();
}
@end
@implementation AncPrivateVaultGenesisCoordinatorResult
@end

@interface AncPrivateVaultGenesisPreparationResult ()
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) uint64_t expiresAtMs;
@property(nonatomic, readwrite)
    AncPrivateVaultGuardedMemory *preparationHandle;
@property(nonatomic, readwrite)
    AncPrivateVaultGuardedMemory *recoveryMnemonic;
@end
@interface AncImmutableGenesisPreparationResult
    : AncPrivateVaultGenesisPreparationResult
@end
@implementation AncImmutableGenesisPreparationResult
- (void)setVaultId:(NSString *)value {
  (void)value;
  RaiseImmutable();
}
- (void)setExpiresAtMs:(uint64_t)value {
  (void)value;
  RaiseImmutable();
}
- (void)setPreparationHandle:(AncPrivateVaultGuardedMemory *)value {
  (void)value;
  RaiseImmutable();
}
- (void)setRecoveryMnemonic:(AncPrivateVaultGuardedMemory *)value {
  (void)value;
  RaiseImmutable();
}
- (void)setValue:(id)value forKey:(NSString *)key {
  (void)value;
  (void)key;
  RaiseImmutable();
}
@end
@implementation AncPrivateVaultGenesisPreparationResult
+ (BOOL)accessInstanceVariablesDirectly {
  return NO;
}
@end

@implementation AncPrivateVaultGenesisSystemTrustedClock
- (BOOL)readNowMilliseconds:(uint64_t *)milliseconds {
  if (milliseconds == NULL)
    return NO;
  NSTimeInterval seconds = NSDate.date.timeIntervalSince1970;
  if (!isfinite(seconds) || seconds <= 0 ||
      seconds > (double)kMaximumSafeInteger / 1000.0)
    return NO;
  uint64_t value = (uint64_t)floor(seconds * 1000.0);
  if (value == 0 || value > kMaximumSafeInteger)
    return NO;
  *milliseconds = value;
  return YES;
}
@end

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultGenesisCoordinatorFaultHook gCoordinatorFaultHook;
void AncPrivateVaultGenesisCoordinatorSetFaultHookForTesting(
    AncPrivateVaultGenesisCoordinatorFaultHook hook) {
  gCoordinatorFaultHook = [hook copy];
}
static BOOL
CoordinatorFault(AncPrivateVaultGenesisCoordinatorFaultPoint point) {
  return gCoordinatorFaultHook != nil && gCoordinatorFaultHook(point);
}
#else
static BOOL CoordinatorFault(NSInteger point) {
  (void)point;
  return NO;
}
#endif

static NSString *Hex(const uint8_t *bytes) {
  if (bytes == NULL)
    return nil;
  NSMutableString *value = [NSMutableString stringWithCapacity:32];
  for (size_t i = 0; i < 16; i++)
    [value appendFormat:@"%02x", bytes[i]];
  return value;
}
static BOOL Zero(const uint8_t *bytes, size_t length) {
  if (bytes == NULL)
    return NO;
  uint8_t aggregate = 0;
  for (size_t i = 0; i < length; i++)
    aggregate |= bytes[i];
  return aggregate == 0;
}
static BOOL Identifier(const uint8_t *bytes, size_t length, NSString *value) {
  NSData *encoded = [value dataUsingEncoding:NSASCIIStringEncoding];
  return encoded.length == length &&
         anc_pv_memcmp(bytes, encoded.bytes, length) == ANC_PV_CRYPTO_OK;
}
static BOOL OfficialExact(AncPrivateVaultAuthorityCheckpoint *official,
                          const AncPrivateVaultCustodySnapshot *custody,
                          NSString *vaultHex, uint64_t expectedFreshness) {
  AncPrivateVaultAuthoritySnapshot *snapshot = official.snapshot;
  if (official == nil || snapshot == nil || custody == NULL ||
      official.custodyGeneration != 2 ||
      snapshot.targetCustodyGeneration != 2 ||
      snapshot.previousCustodyGeneration != 1 ||
      snapshot.previousSequence != nil || snapshot.previousHead != nil ||
      snapshot.sequence != 0 || snapshot.epoch != 1 ||
      snapshot.recoveryGeneration != 1 || snapshot.activeMembers.count != 1 ||
      snapshot.removedEndpointIds.count != 0 ||
      snapshot.activeMembers[0].unattended ||
      ![snapshot.activeMembers[0].role isEqualToString:@"endpoint"] ||
      ![official.vaultId isEqualToString:vaultHex] ||
      ![snapshot.vaultId isEqualToString:vaultHex] ||
      custody->record_version != ANC_PV_CUSTODY_VERSION ||
      custody->custody_generation != 2 ||
      custody->lifecycle != ANC_PV_CUSTODY_LIFECYCLE_ACTIVE ||
      custody->role != ANC_PV_CUSTODY_ROLE_ENDPOINT ||
      custody->authority_anchor_present != 1 || custody->active_epoch != 1 ||
      custody->pending_epoch != 0 ||
      custody->pending_kind != ANC_PV_CUSTODY_PENDING_NONE ||
      custody->rotation_phase != ANC_PV_CUSTODY_ROTATION_NONE ||
      custody->enrollment_phase != ANC_PV_CUSTODY_ENROLLMENT_NONE ||
      custody->expected_edge_present != 0 ||
      custody->expected_next_sequence != 0 ||
      custody->ceremony_id_length != 0 ||
      !Zero(custody->ceremony_id, sizeof custody->ceremony_id) ||
      !Zero(custody->pending_transcript_digest, 32) ||
      !Zero(custody->expected_previous_head, 32) ||
      custody->anchored_sequence != 0 || custody->recovery_generation != 1 ||
      custody->signed_at_ms != snapshot.signedAtMs ||
      custody->freshness_ms != snapshot.verifiedAtMs ||
      (expectedFreshness != 0 && custody->freshness_ms != expectedFreshness) ||
      !Identifier(custody->vault_id, custody->vault_id_length, vaultHex) ||
      !Identifier(custody->endpoint_id, custody->endpoint_id_length,
                  snapshot.activeMembers[0].endpointId) ||
      anc_pv_memcmp(custody->signing_public_key,
                    snapshot.activeMembers[0].signingPublicKey.bytes,
                    32) != ANC_PV_CRYPTO_OK ||
      anc_pv_memcmp(custody->box_public_key,
                    snapshot.activeMembers[0].keyAgreementPublicKey.bytes,
                    32) != ANC_PV_CRYPTO_OK ||
      anc_pv_memcmp(custody->snapshot_digest, official.frameDigest.bytes, 32) !=
          ANC_PV_CRYPTO_OK ||
      anc_pv_memcmp(custody->anchored_head, snapshot.headHash.bytes, 32) !=
          ANC_PV_CRYPTO_OK ||
      anc_pv_memcmp(custody->membership_digest, snapshot.membershipHash.bytes,
                    32) != ANC_PV_CRYPTO_OK)
    return NO;
  return YES;
}
static AncPrivateVaultGenesisCoordinatorStatus
ArtifactStatus(AncPrivateVaultGenesisArtifactStoreStatus status) {
  switch (status) {
  case AncPrivateVaultGenesisArtifactStoreStatusOK:
    return AncPrivateVaultGenesisCoordinatorStatusOK;
  case AncPrivateVaultGenesisArtifactStoreStatusNotFound:
    return AncPrivateVaultGenesisCoordinatorStatusNotFound;
  case AncPrivateVaultGenesisArtifactStoreStatusConflict:
    return AncPrivateVaultGenesisCoordinatorStatusConflict;
  case AncPrivateVaultGenesisArtifactStoreStatusInvalid:
    return AncPrivateVaultGenesisCoordinatorStatusInvalid;
  default:
    return AncPrivateVaultGenesisCoordinatorStatusStorageFailed;
  }
}

static AncPrivateVaultGenesisCoordinatorStatus PreparationStatus(
    AncPrivateVaultGenesisPreparationStoreStatus status) {
  switch (status) {
  case AncPrivateVaultGenesisPreparationStoreStatusOK:
    return AncPrivateVaultGenesisCoordinatorStatusOK;
  case AncPrivateVaultGenesisPreparationStoreStatusNotFound:
    return AncPrivateVaultGenesisCoordinatorStatusNotFound;
  case AncPrivateVaultGenesisPreparationStoreStatusInvalid:
  case AncPrivateVaultGenesisPreparationStoreStatusCorrupt:
    return AncPrivateVaultGenesisCoordinatorStatusInvalid;
  case AncPrivateVaultGenesisPreparationStoreStatusConflict:
  case AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected:
    return AncPrivateVaultGenesisCoordinatorStatusConflict;
  case AncPrivateVaultGenesisPreparationStoreStatusInaccessible:
    return AncPrivateVaultGenesisCoordinatorStatusProtectionFailed;
  case AncPrivateVaultGenesisPreparationStoreStatusFailed:
    return AncPrivateVaultGenesisCoordinatorStatusStorageFailed;
  }
}

static AncPrivateVaultGenesisCoordinatorStatus PreparationArtifactStatus(
    AncPrivateVaultGenesisPreparationArtifactStatus status) {
  switch (status) {
  case AncPrivateVaultGenesisPreparationArtifactStatusOK:
    return AncPrivateVaultGenesisCoordinatorStatusOK;
  case AncPrivateVaultGenesisPreparationArtifactStatusNotFound:
    return AncPrivateVaultGenesisCoordinatorStatusNotFound;
  case AncPrivateVaultGenesisPreparationArtifactStatusInvalid:
  case AncPrivateVaultGenesisPreparationArtifactStatusCorrupt:
  case AncPrivateVaultGenesisPreparationArtifactStatusBindingMismatch:
    return AncPrivateVaultGenesisCoordinatorStatusInvalid;
  case AncPrivateVaultGenesisPreparationArtifactStatusConflict:
    return AncPrivateVaultGenesisCoordinatorStatusConflict;
  case AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed:
    return AncPrivateVaultGenesisCoordinatorStatusStorageFailed;
  }
}

static BOOL RandomNonzero(uint8_t *bytes, size_t length) {
  if (bytes == NULL || length == 0)
    return NO;
  for (NSUInteger attempt = 0; attempt < 8; attempt++) {
    if (anc_pv_random(bytes, length) != ANC_PV_CRYPTO_OK)
      return NO;
    if (!Zero(bytes, length))
      return YES;
  }
  anc_pv_zeroize(bytes, length);
  return NO;
}

static BOOL RandomPreparationHandle(uint8_t handle[48]) {
  if (handle == NULL)
    return NO;
  for (NSUInteger attempt = 0; attempt < 8; attempt++) {
    if (anc_pv_random(handle, 48) != ANC_PV_CRYPTO_OK)
      return NO;
    if (!Zero(handle, 16) && !Zero(handle + 16, 32))
      return YES;
  }
  anc_pv_zeroize(handle, 48);
  return NO;
}

static AncPrivateVaultGuardedMemory *GuardedCopy(const uint8_t *bytes,
                                                 size_t length) {
  if (bytes == NULL || length == 0)
    return nil;
  AncPrivateVaultGuardedMemoryStatus status;
  AncPrivateVaultGuardedMemory *memory =
      [AncPrivateVaultGuardedMemory memoryWithLength:length status:&status];
  if (memory == nil || status != AncPrivateVaultGuardedMemoryStatusOK)
    return nil;
  status = [memory borrow:^BOOL(uint8_t *destination, size_t destinationLength) {
    if (destinationLength != length)
      return NO;
    memcpy(destination, bytes, length);
    return YES;
  }];
  if (status != AncPrivateVaultGuardedMemoryStatusOK) {
    (void)[memory close];
    return nil;
  }
  return memory;
}

static AncPrivateVaultGuardedMemory *EmptyGuarded32(void) {
  AncPrivateVaultGuardedMemoryStatus status;
  AncPrivateVaultGuardedMemory *memory =
      [AncPrivateVaultGuardedMemory memoryWithLength:32 status:&status];
  if (memory == nil || status != AncPrivateVaultGuardedMemoryStatusOK)
    return nil;
  return memory;
}

static AncPrivateVaultGuardedMemory *RandomGuarded32(void) {
  AncPrivateVaultGuardedMemory *memory = EmptyGuarded32();
  if (memory == nil)
    return nil;
  __block BOOL generated = NO;
  AncPrivateVaultGuardedMemoryStatus status =
      [memory borrow:^BOOL(uint8_t *bytes, size_t length) {
    generated = length == 32 && RandomNonzero(bytes, length);
    return generated;
  }];
  if (status != AncPrivateVaultGuardedMemoryStatusOK || !generated) {
    (void)[memory close];
    return nil;
  }
  return memory;
}

static BOOL CloseGuarded(AncPrivateVaultGuardedMemory *memory) {
  return memory == nil || memory.isClosed ||
         [memory close] == AncPrivateVaultGuardedMemoryStatusOK;
}

static BOOL DeriveEndpointPublicKeys(AncPrivateVaultGuardedMemory *signingSeed,
                                     AncPrivateVaultGuardedMemory *boxSeed,
                                     uint8_t signingPublic[32],
                                     uint8_t boxPublic[32]) {
  if (signingSeed == nil || boxSeed == nil || signingPublic == NULL ||
      boxPublic == NULL || signingSeed.length != 32 || boxSeed.length != 32 ||
      signingSeed.isClosed || boxSeed.isClosed)
    return NO;
  AncPrivateVaultGuardedMemoryStatus memoryStatus;
  AncPrivateVaultGuardedMemory *signingPrivate =
      [AncPrivateVaultGuardedMemory memoryWithLength:64 status:&memoryStatus];
  AncPrivateVaultGuardedMemory *boxPrivate =
      signingPrivate == nil
          ? nil
          : [AncPrivateVaultGuardedMemory memoryWithLength:32
                                                    status:&memoryStatus];
  __block BOOL derived = signingPrivate != nil && boxPrivate != nil;
  if (derived) {
    AncPrivateVaultGuardedMemoryStatus signingBorrow =
        [signingSeed borrow:^BOOL(uint8_t *seed, size_t seedLength) {
      return seedLength == 32 &&
             [signingPrivate borrow:^BOOL(uint8_t *privateKey,
                                           size_t privateLength) {
        return privateLength == 64 &&
               anc_pv_ed25519_seed_keypair(signingPublic, privateKey, seed) ==
                   ANC_PV_CRYPTO_OK;
      }] == AncPrivateVaultGuardedMemoryStatusOK;
    }];
    AncPrivateVaultGuardedMemoryStatus boxBorrow =
        [boxSeed borrow:^BOOL(uint8_t *seed, size_t seedLength) {
      return seedLength == 32 &&
             [boxPrivate borrow:^BOOL(uint8_t *privateKey,
                                      size_t privateLength) {
        return privateLength == 32 &&
               anc_pv_box_seed_keypair(boxPublic, privateKey, seed) ==
                   ANC_PV_CRYPTO_OK;
      }] == AncPrivateVaultGuardedMemoryStatusOK;
    }];
    derived = signingBorrow == AncPrivateVaultGuardedMemoryStatusOK &&
              boxBorrow == AncPrivateVaultGuardedMemoryStatusOK;
  }
  BOOL closed = YES;
  closed = CloseGuarded(signingPrivate) && closed;
  closed = CloseGuarded(boxPrivate) && closed;
  if (!derived || !closed) {
    anc_pv_zeroize(signingPublic, 32);
    anc_pv_zeroize(boxPublic, 32);
    return NO;
  }
  return YES;
}

static BOOL CopyLivePreparationArtifacts(
    AncPrivateVaultGenesisPreparationArtifactStore *artifactStore,
    const AncPrivateVaultGenesisPreparationSnapshot *snapshot,
    NSData **recoveryWrap, NSData **confirmation, NSData **bootstrap,
    NSData **authorization,
    AncPrivateVaultGenesisPreparationArtifactStatus *outStatus) {
  if (recoveryWrap != NULL)
    *recoveryWrap = nil;
  if (confirmation != NULL)
    *confirmation = nil;
  if (bootstrap != NULL)
    *bootstrap = nil;
  if (authorization != NULL)
    *authorization = nil;
  if (artifactStore == nil || snapshot == NULL || recoveryWrap == NULL ||
      confirmation == NULL || bootstrap == NULL || authorization == NULL)
    return NO;
  __block NSData *ownedWrap = nil;
  __block NSData *ownedConfirmation = nil;
  __block NSData *ownedBootstrap = nil;
  __block NSData *ownedAuthorization = nil;
  AncPrivateVaultGenesisPreparationArtifactStatus status =
      [artifactStore
          readLiveLookupId:snapshot->preparation_lookup_id
                   vaultId:snapshot->vault_id
                ceremonyId:snapshot->ceremony_id
                generation:2
            expectedDigest:snapshot->artifact_spool_digest
                 consumer:^BOOL(const uint8_t *wrap, size_t wrapLength,
                                 const uint8_t *confirmationBytes,
                                 size_t confirmationLength,
                                 const uint8_t *bootstrapBytes,
                                 size_t bootstrapLength,
                                 const uint8_t *authorizationBytes,
                                 size_t authorizationLength) {
    ownedWrap = [NSData dataWithBytes:wrap length:wrapLength];
    ownedConfirmation =
        [NSData dataWithBytes:confirmationBytes length:confirmationLength];
    ownedBootstrap =
        [NSData dataWithBytes:bootstrapBytes length:bootstrapLength];
    ownedAuthorization =
        [NSData dataWithBytes:authorizationBytes length:authorizationLength];
    return ownedWrap.length == wrapLength &&
           ownedConfirmation.length == confirmationLength &&
           ownedBootstrap.length == bootstrapLength &&
           ownedAuthorization.length == authorizationLength;
  }];
  if (outStatus != NULL)
    *outStatus = status;
  if (status != AncPrivateVaultGenesisPreparationArtifactStatusOK ||
      ownedWrap == nil || ownedConfirmation == nil || ownedBootstrap == nil ||
      ownedAuthorization == nil)
    return NO;
  *recoveryWrap = ownedWrap;
  *confirmation = ownedConfirmation;
  *bootstrap = ownedBootstrap;
  *authorization = ownedAuthorization;
  return YES;
}

static BOOL CopyPreparationSecrets(
    AncPrivateVaultGenesisPreparationStore *store, const uint8_t *handle,
    AncPrivateVaultGuardedMemory *confirmedRecoveryEntropy,
    AncPrivateVaultGenesisPreparationSnapshot *snapshot,
    AncPrivateVaultGuardedMemory **recoveryEntropy,
    AncPrivateVaultGuardedMemory **signingSeed,
    AncPrivateVaultGuardedMemory **boxSeed,
    AncPrivateVaultGuardedMemory **localStateKey,
    AncPrivateVaultGuardedMemory **epochOneEEK,
    AncPrivateVaultGenesisPreparationStoreStatus *outStatus) {
  if (snapshot != NULL)
    anc_pv_genesis_preparation_snapshot_zero(snapshot);
  if (recoveryEntropy != NULL)
    *recoveryEntropy = nil;
  if (signingSeed != NULL)
    *signingSeed = nil;
  if (boxSeed != NULL)
    *boxSeed = nil;
  if (localStateKey != NULL)
    *localStateKey = nil;
  if (epochOneEEK != NULL)
    *epochOneEEK = nil;
  if (store == nil || handle == NULL || confirmedRecoveryEntropy == nil ||
      object_getClass(confirmedRecoveryEntropy) !=
          AncPrivateVaultGuardedMemory.class ||
      confirmedRecoveryEntropy.length != 32 ||
      confirmedRecoveryEntropy.isClosed || snapshot == NULL ||
      recoveryEntropy == NULL || signingSeed == NULL || boxSeed == NULL ||
      localStateKey == NULL || epochOneEEK == NULL)
    return NO;
  AncPrivateVaultGenesisPreparationSecretsHandle *secretHandle = nil;
  AncPrivateVaultGenesisPreparationStoreStatus status =
      [store readHandle:handle
          handleLength:ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES
             snapshot:snapshot
          secretHandle:&secretHandle];
  if (status != AncPrivateVaultGenesisPreparationStoreStatusOK ||
      secretHandle == nil) {
    if (outStatus != NULL)
      *outStatus = status;
    return NO;
  }
  AncPrivateVaultGuardedMemory *ownedRecovery = EmptyGuarded32();
  AncPrivateVaultGuardedMemory *ownedSigning = EmptyGuarded32();
  AncPrivateVaultGuardedMemory *ownedBox = EmptyGuarded32();
  AncPrivateVaultGuardedMemory *ownedLocal = EmptyGuarded32();
  AncPrivateVaultGuardedMemory *ownedEEK = EmptyGuarded32();
  __block BOOL copied = ownedRecovery != nil && ownedSigning != nil &&
                          ownedBox != nil && ownedLocal != nil && ownedEEK != nil;
  if (copied) {
    status = [secretHandle
        borrow:^BOOL(
            const AncPrivateVaultGenesisPreparationSecretInputs *secrets) {
      __block BOOL recoveryMatches = NO;
      AncPrivateVaultGuardedMemoryStatus compared =
          [confirmedRecoveryEntropy
              borrow:^BOOL(uint8_t *confirmedBytes, size_t confirmedLength) {
        recoveryMatches =
            confirmedLength == 32 &&
            anc_pv_memcmp(confirmedBytes, secrets->recovery_entropy, 32) ==
                ANC_PV_CRYPTO_OK;
        return recoveryMatches;
      }];
      if (compared != AncPrivateVaultGuardedMemoryStatusOK ||
          !recoveryMatches)
        return NO;
      AncPrivateVaultGuardedMemory *targets[] = {
          ownedRecovery, ownedSigning, ownedBox, ownedLocal, ownedEEK};
      const uint8_t *sources[] = {
          secrets->recovery_entropy, secrets->endpoint_signing_seed,
          secrets->endpoint_agreement_seed, secrets->local_state_key,
          secrets->epoch_one_eek};
      for (size_t index = 0; index < 5; index++) {
        AncPrivateVaultGuardedMemory *target = targets[index];
        const uint8_t *source = sources[index];
        AncPrivateVaultGuardedMemoryStatus copyStatus =
            [target borrow:^BOOL(uint8_t *destination, size_t length) {
          if (length != 32)
            return NO;
          memcpy(destination, source, 32);
          return YES;
        }];
        if (copyStatus != AncPrivateVaultGuardedMemoryStatusOK)
          return NO;
      }
      return YES;
    }];
    copied = status == AncPrivateVaultGenesisPreparationStoreStatusOK;
  }
  AncPrivateVaultGenesisPreparationStoreStatus closeStatus =
      [secretHandle close];
  if (!copied ||
      closeStatus != AncPrivateVaultGenesisPreparationStoreStatusOK) {
    CloseGuarded(ownedRecovery);
    CloseGuarded(ownedSigning);
    CloseGuarded(ownedBox);
    CloseGuarded(ownedLocal);
    CloseGuarded(ownedEEK);
    if (outStatus != NULL)
      *outStatus = closeStatus != AncPrivateVaultGenesisPreparationStoreStatusOK
                       ? closeStatus
                       : AncPrivateVaultGenesisPreparationStoreStatusConflict;
    anc_pv_genesis_preparation_snapshot_zero(snapshot);
    return NO;
  }
  *recoveryEntropy = ownedRecovery;
  *signingSeed = ownedSigning;
  *boxSeed = ownedBox;
  *localStateKey = ownedLocal;
  *epochOneEEK = ownedEEK;
  if (outStatus != NULL)
    *outStatus = AncPrivateVaultGenesisPreparationStoreStatusOK;
  return YES;
}

@interface AncPrivateVaultGenesisCoordinator ()
@property(nonatomic) AncPrivateVaultGenesisArtifactStore *artifactStore;
@property(nonatomic) AncPrivateVaultAuthorityStore *authorityStore;
@property(nonatomic) AncPrivateVaultCustodyRepository *custodyRepository;
@property(nonatomic) AncPrivateVaultControlLog *controlLog;
@property(nonatomic) id<AncPrivateVaultGenesisTrustedClock> trustedClock;
@property(nonatomic, nullable)
    AncPrivateVaultGenesisPreparationStore *preparationStore;
@property(nonatomic, nullable)
    AncPrivateVaultGenesisPreparationArtifactStore *preparationArtifactStore;
- (instancetype)
    initWithArtifactStore:(AncPrivateVaultGenesisArtifactStore *)artifactStore
           authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
        custodyRepository:(AncPrivateVaultCustodyRepository *)custodyRepository
               controlLog:(AncPrivateVaultControlLog *)controlLog
             trustedClock:(id<AncPrivateVaultGenesisTrustedClock>)trustedClock;
@end

@implementation AncPrivateVaultGenesisCoordinator
- (instancetype)
    initWithArtifactStore:(AncPrivateVaultGenesisArtifactStore *)artifactStore
           authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
        custodyRepository:(AncPrivateVaultCustodyRepository *)custodyRepository
               controlLog:(AncPrivateVaultControlLog *)controlLog {
  return [self
      initWithArtifactStore:artifactStore
             authorityStore:authorityStore
          custodyRepository:custodyRepository
                 controlLog:controlLog
               trustedClock:[AncPrivateVaultGenesisSystemTrustedClock new]];
}
- (instancetype)
    initWithArtifactStore:(AncPrivateVaultGenesisArtifactStore *)artifactStore
           authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
        custodyRepository:(AncPrivateVaultCustodyRepository *)custodyRepository
               controlLog:(AncPrivateVaultControlLog *)controlLog
             trustedClock:(id<AncPrivateVaultGenesisTrustedClock>)trustedClock {
  self = [super init];
  if (self != nil) {
    BOOL exact =
        object_getClass(artifactStore) ==
            AncPrivateVaultGenesisArtifactStore.class
        &&
        object_getClass(authorityStore) == AncPrivateVaultAuthorityStore.class
        &&
        object_getClass(custodyRepository) ==
            AncPrivateVaultCustodyRepository.class
        && object_getClass(controlLog) == AncPrivateVaultControlLog.class;
    if (!exact || trustedClock == nil)
      return nil;
    _artifactStore = artifactStore;
    _authorityStore = authorityStore;
    _custodyRepository = custodyRepository;
    _controlLog = controlLog;
    _trustedClock = trustedClock;
  }
  return self;
}

- (instancetype)
    initWithArtifactStore:(AncPrivateVaultGenesisArtifactStore *)artifactStore
           authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
        custodyRepository:(AncPrivateVaultCustodyRepository *)custodyRepository
               controlLog:(AncPrivateVaultControlLog *)controlLog
         preparationStore:
             (AncPrivateVaultGenesisPreparationStore *)preparationStore
    preparationArtifactStore:
        (AncPrivateVaultGenesisPreparationArtifactStore *)preparationArtifactStore
             trustedClock:(id<AncPrivateVaultGenesisTrustedClock>)trustedClock {
  if (object_getClass(preparationStore) !=
          AncPrivateVaultGenesisPreparationStore.class ||
      object_getClass(preparationArtifactStore) !=
          AncPrivateVaultGenesisPreparationArtifactStore.class)
    return nil;
  self = [self initWithArtifactStore:artifactStore
                      authorityStore:authorityStore
                   custodyRepository:custodyRepository
                          controlLog:controlLog
                        trustedClock:trustedClock];
  if (self != nil) {
    _preparationStore = preparationStore;
    _preparationArtifactStore = preparationArtifactStore;
  }
  return self;
}

- (AncPrivateVaultGenesisCoordinatorStatus)
    prepareWithResult:(AncPrivateVaultGenesisPreparationResult **)result {
  if (result == NULL)
    return AncPrivateVaultGenesisCoordinatorStatusInvalid;
  *result = nil;
  if (self.preparationStore == nil || self.preparationArtifactStore == nil)
    return AncPrivateVaultGenesisCoordinatorStatusInvalid;
  uint64_t now = 0;
  if (![self.trustedClock readNowMilliseconds:&now] || now == 0 ||
      now > kMaximumSafeInteger - UINT64_C(600000))
    return AncPrivateVaultGenesisCoordinatorStatusInvalid;
  now -= now % UINT64_C(1000);
  if (now == 0)
    return AncPrivateVaultGenesisCoordinatorStatusInvalid;

  uint8_t handle[48] = {0};
  AncPrivateVaultGenesisPreparationSnapshot snapshot = {0};
  uint8_t signingPublic[32] = {0};
  uint8_t boxPublic[32] = {0};
  AncPrivateVaultGuardedMemory *recoveryEntropy = nil;
  AncPrivateVaultGuardedMemory *signingSeed = nil;
  AncPrivateVaultGuardedMemory *boxSeed = nil;
  AncPrivateVaultGuardedMemory *localStateKey = nil;
  AncPrivateVaultGuardedMemory *epochOneEEK = nil;
  AncPrivateVaultGuardedMemory *mnemonic = nil;
  AncPrivateVaultGuardedMemory *resultHandle = nil;
  AncPrivateVaultRecoveryAuthority *recoveryAuthority = nil;
  AncPrivateVaultGenesisCoordinatorStatus finalStatus =
      AncPrivateVaultGenesisCoordinatorStatusStorageFailed;

  @try {
    snapshot.phase = ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED;
    snapshot.generation = 1;
    snapshot.prepared_at_ms = now;
    snapshot.expires_at_ms = now + UINT64_C(600000);
    BOOL identifiers =
        RandomPreparationHandle(handle) &&
        RandomNonzero(snapshot.vault_id, sizeof snapshot.vault_id) &&
        RandomNonzero(snapshot.ceremony_id, sizeof snapshot.ceremony_id) &&
        RandomNonzero(snapshot.endpoint_id, sizeof snapshot.endpoint_id) &&
        RandomNonzero(snapshot.recovery_wrap_envelope_id,
                      sizeof snapshot.recovery_wrap_envelope_id) &&
        RandomNonzero(snapshot.endpoint_envelope_id,
                      sizeof snapshot.endpoint_envelope_id) &&
        RandomNonzero(snapshot.log_entry_envelope_id,
                      sizeof snapshot.log_entry_envelope_id) &&
        RandomNonzero(snapshot.authorization_envelope_id,
                      sizeof snapshot.authorization_envelope_id) &&
        RandomNonzero(snapshot.recovery_wrap_nonce,
                      sizeof snapshot.recovery_wrap_nonce);
    if (!identifiers)
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    memcpy(snapshot.preparation_lookup_id, handle, 16);
    if (anc_pv_genesis_preparation_handle_digest(
            handle, sizeof handle, snapshot.handle_digest) !=
        ANC_PV_GENESIS_PREPARATION_OK)
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];

    AncPrivateVaultMnemonicStatus mnemonicStatus;
    recoveryEntropy = AncPrivateVaultGenerateRecoveryEntropy(&mnemonicStatus);
    signingSeed = RandomGuarded32();
    boxSeed = RandomGuarded32();
    localStateKey = RandomGuarded32();
    epochOneEEK = RandomGuarded32();
    if (recoveryEntropy == nil || signingSeed == nil || boxSeed == nil ||
        localStateKey == nil || epochOneEEK == nil ||
        !DeriveEndpointPublicKeys(signingSeed, boxSeed, signingPublic,
                                  boxPublic))
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    memcpy(snapshot.endpoint_signing_public_key, signingPublic, 32);
    memcpy(snapshot.endpoint_agreement_public_key, boxPublic, 32);

    NSData *vaultId = [NSData dataWithBytes:snapshot.vault_id length:16];
    AncPrivateVaultRecoveryAuthorityStatus recoveryStatus;
    recoveryAuthority = AncPrivateVaultDeriveRecoveryAuthority(
        recoveryEntropy, vaultId, 1, &recoveryStatus);
    if (recoveryAuthority == nil || recoveryAuthority.recoveryId.length != 16 ||
        recoveryAuthority.signingPublicKey.length != 32 ||
        recoveryAuthority.keyAgreementPublicKey.length != 32)
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    memcpy(snapshot.recovery_id, recoveryAuthority.recoveryId.bytes, 16);
    memcpy(snapshot.recovery_signing_public_key,
           recoveryAuthority.signingPublicKey.bytes, 32);
    memcpy(snapshot.recovery_agreement_public_key,
           recoveryAuthority.keyAgreementPublicKey.bytes, 32);
    BOOL recoveryPrivateClosed = YES;
    recoveryPrivateClosed =
        CloseGuarded(recoveryAuthority.signingPrivateKey) &&
        recoveryPrivateClosed;
    recoveryPrivateClosed =
        CloseGuarded(recoveryAuthority.keyAgreementPrivateKey) &&
        recoveryPrivateClosed;
    if (!recoveryPrivateClosed)
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];

    mnemonic = AncPrivateVaultMnemonicEncode(recoveryEntropy, &mnemonicStatus);
    resultHandle = GuardedCopy(handle, sizeof handle);
    if (mnemonic == nil || resultHandle == nil)
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];

    __block AncPrivateVaultGenesisPreparationStoreStatus storeStatus =
        AncPrivateVaultGenesisPreparationStoreStatusFailed;
    uint8_t *handlePointer = handle;
    AncPrivateVaultGuardedMemoryStatus borrowed =
        [recoveryEntropy borrow:^BOOL(uint8_t *recoveryBytes,
                                      size_t recoveryLength) {
      return recoveryLength == 32 &&
             [signingSeed borrow:^BOOL(uint8_t *signingBytes,
                                       size_t signingLength) {
        return signingLength == 32 &&
               [boxSeed borrow:^BOOL(uint8_t *boxBytes, size_t boxLength) {
          return boxLength == 32 &&
                 [localStateKey borrow:^BOOL(uint8_t *localBytes,
                                             size_t localLength) {
            return localLength == 32 &&
                   [epochOneEEK borrow:^BOOL(uint8_t *eekBytes,
                                             size_t eekLength) {
              if (eekLength != 32)
                return NO;
              AncPrivateVaultGenesisPreparationSecretInputs secrets = {
                  recoveryBytes, signingBytes, boxBytes, localBytes, eekBytes};
              storeStatus = [self.preparationStore
                  createSnapshot:&snapshot
                         secrets:&secrets
                          handle:handlePointer
                    handleLength:ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES];
              return storeStatus ==
                     AncPrivateVaultGenesisPreparationStoreStatusOK;
            }] == AncPrivateVaultGuardedMemoryStatusOK;
          }] == AncPrivateVaultGuardedMemoryStatusOK;
        }] == AncPrivateVaultGuardedMemoryStatusOK;
      }] == AncPrivateVaultGuardedMemoryStatusOK;
    }];
    if (borrowed != AncPrivateVaultGuardedMemoryStatusOK ||
        storeStatus != AncPrivateVaultGenesisPreparationStoreStatusOK) {
      finalStatus = PreparationStatus(storeStatus);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }
    AncPrivateVaultGenesisPreparationResult *value = (id)class_createInstance(
        AncPrivateVaultGenesisPreparationResult.class, 0);
    value.vaultId = Hex(snapshot.vault_id);
    value.expiresAtMs = snapshot.expires_at_ms;
    value.preparationHandle = resultHandle;
    value.recoveryMnemonic = mnemonic;
    if (value.vaultId == nil)
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    object_setClass(value, AncImmutableGenesisPreparationResult.class);
    if (result != NULL)
      *result = value;
    resultHandle = nil;
    mnemonic = nil;
    finalStatus = AncPrivateVaultGenesisCoordinatorStatusOK;
  } @catch (__unused NSException *exception) {
  } @finally {
    BOOL closed = YES;
    closed = CloseGuarded(recoveryEntropy) && closed;
    closed = CloseGuarded(signingSeed) && closed;
    closed = CloseGuarded(boxSeed) && closed;
    closed = CloseGuarded(localStateKey) && closed;
    closed = CloseGuarded(epochOneEEK) && closed;
    closed = CloseGuarded(recoveryAuthority.signingPrivateKey) && closed;
    closed = CloseGuarded(recoveryAuthority.keyAgreementPrivateKey) && closed;
    closed = CloseGuarded(resultHandle) && closed;
    closed = CloseGuarded(mnemonic) && closed;
    anc_pv_zeroize(handle, sizeof handle);
    anc_pv_zeroize(signingPublic, sizeof signingPublic);
    anc_pv_zeroize(boxPublic, sizeof boxPublic);
    anc_pv_genesis_preparation_snapshot_zero(&snapshot);
    if (!closed) {
      if (result != NULL && *result != nil) {
        (void)[(*result).preparationHandle close];
        (void)[(*result).recoveryMnemonic close];
        *result = nil;
      }
      finalStatus = AncPrivateVaultGenesisCoordinatorStatusProtectionFailed;
    }
  }
  return finalStatus;
}

- (AncPrivateVaultGenesisCoordinatorStatus)
    confirmPreparationHandle:(AncPrivateVaultGuardedMemory *)handleMemory
        confirmedRecoveryEntropy:
            (AncPrivateVaultGuardedMemory *)confirmedRecoveryEntropy
                         result:
                             (AncPrivateVaultGenesisCoordinatorResult **)result {
  if (result != NULL)
    *result = nil;
  if (self.preparationStore == nil || self.preparationArtifactStore == nil ||
      handleMemory == nil || confirmedRecoveryEntropy == nil ||
      object_getClass(handleMemory) != AncPrivateVaultGuardedMemory.class ||
      object_getClass(confirmedRecoveryEntropy) !=
          AncPrivateVaultGuardedMemory.class ||
      handleMemory.length != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES ||
      confirmedRecoveryEntropy.length != 32 || handleMemory.isClosed ||
      confirmedRecoveryEntropy.isClosed)
    return AncPrivateVaultGenesisCoordinatorStatusInvalid;

  uint8_t handle[ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES] = {0};
  uint8_t *handlePointer = handle;
  __block BOOL copiedHandle = NO;
  if ([handleMemory borrow:^BOOL(uint8_t *bytes, size_t length) {
        if (length != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES)
          return NO;
        memcpy(handlePointer, bytes, length);
        copiedHandle = YES;
        return YES;
      }] != AncPrivateVaultGuardedMemoryStatusOK ||
      !copiedHandle) {
    anc_pv_zeroize(handle, sizeof handle);
    return AncPrivateVaultGenesisCoordinatorStatusProtectionFailed;
  }

  AncPrivateVaultGenesisPreparationSnapshot snapshot;
  AncPrivateVaultGenesisPreparationStoreStatus initial =
      [self.preparationStore
          readHandle:handle
          handleLength:sizeof handle
             snapshot:&snapshot
          secretHandle:nil];
  if (initial != AncPrivateVaultGenesisPreparationStoreStatusOK) {
    anc_pv_zeroize(handle, sizeof handle);
    anc_pv_genesis_preparation_snapshot_zero(&snapshot);
    return PreparationStatus(initial);
  }
  NSString *vaultId = Hex(snapshot.vault_id);
  anc_pv_genesis_preparation_snapshot_zero(&snapshot);
  NSRecursiveLock *lock = AncPrivateVaultGenesisLockForVaultId(vaultId);
  if (lock == nil) {
    anc_pv_zeroize(handle, sizeof handle);
    return AncPrivateVaultGenesisCoordinatorStatusInvalid;
  }

  AncPrivateVaultGuardedMemory *recoveryEntropy = nil;
  AncPrivateVaultGuardedMemory *signingSeed = nil;
  AncPrivateVaultGuardedMemory *boxSeed = nil;
  AncPrivateVaultGuardedMemory *localStateKey = nil;
  AncPrivateVaultGuardedMemory *epochOneEEK = nil;
  AncPrivateVaultGenesisCoordinatorStatus finalStatus =
      AncPrivateVaultGenesisCoordinatorStatusStorageFailed;
  [lock lock];
  @try {
    AncPrivateVaultGenesisPreparationStoreStatus readStatus =
        [self.preparationStore
            readHandle:handle
            handleLength:sizeof handle
               snapshot:&snapshot
            secretHandle:nil];
    if (readStatus != AncPrivateVaultGenesisPreparationStoreStatusOK ||
        ![Hex(snapshot.vault_id) isEqualToString:vaultId]) {
      finalStatus = readStatus ==
                            AncPrivateVaultGenesisPreparationStoreStatusOK
                        ? AncPrivateVaultGenesisCoordinatorStatusConflict
                        : PreparationStatus(readStatus);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }
    if (snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED ||
        snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED) {
      finalStatus = AncPrivateVaultGenesisCoordinatorStatusConflict;
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }

    if (snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED) {
      AncPrivateVaultGenesisPreparationStoreStatus bound =
          [self.preparationStore
              bindOfficialGenesisHandle:handle
                            handleLength:sizeof handle
                          authorityStore:self.authorityStore
                       custodyRepository:self.custodyRepository];
      if (bound != AncPrivateVaultGenesisPreparationStoreStatusOK) {
        finalStatus = PreparationStatus(bound);
        @throw [NSException exceptionWithName:@"AncExpected"
                                       reason:nil
                                     userInfo:nil];
      }
      finalStatus = [self resumeVaultId:snapshot.vault_id result:result];
      @throw [NSException exceptionWithName:@"AncFinished" reason:nil userInfo:nil];
    }

    AncPrivateVaultGenesisPreparationStoreStatus secretStatus;
    if (!CopyPreparationSecrets(
            self.preparationStore, handle, confirmedRecoveryEntropy, &snapshot,
            &recoveryEntropy, &signingSeed, &boxSeed, &localStateKey,
            &epochOneEEK, &secretStatus)) {
      finalStatus = secretStatus ==
                            AncPrivateVaultGenesisPreparationStoreStatusConflict
                        ? AncPrivateVaultGenesisCoordinatorStatusAuthorizationFailed
                        : PreparationStatus(secretStatus);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }

    uint64_t confirmedAtMs = snapshot.confirmed_at_ms;
    AncPrivateVaultPreparedGenesisArtifacts *builtArtifacts = nil;
    if (snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED ||
        snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED) {
      if (snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED) {
        uint64_t now = 0;
        if (![self.trustedClock readNowMilliseconds:&now] || now == 0 ||
            now > kMaximumSafeInteger) {
          finalStatus = AncPrivateVaultGenesisCoordinatorStatusInvalid;
          @throw [NSException exceptionWithName:@"AncExpected"
                                         reason:nil
                                       userInfo:nil];
        }
        confirmedAtMs = now - now % UINT64_C(1000);
        if (confirmedAtMs < snapshot.prepared_at_ms ||
            confirmedAtMs > snapshot.expires_at_ms) {
          finalStatus = AncPrivateVaultGenesisCoordinatorStatusConflict;
          @throw [NSException exceptionWithName:@"AncExpected"
                                         reason:nil
                                       userInfo:nil];
        }
      }
      uint64_t confirmedSeconds = confirmedAtMs / UINT64_C(1000);
      AncPrivateVaultGenesisBuilderStatus builderStatus;
      builtArtifacts = AncPrivateVaultBuildGenesisArtifacts(
          recoveryEntropy, signingSeed, boxSeed, epochOneEEK,
          [NSData dataWithBytes:snapshot.vault_id length:16],
          [NSData dataWithBytes:snapshot.ceremony_id length:16],
          [NSData dataWithBytes:snapshot.endpoint_id length:16],
          [NSData dataWithBytes:snapshot.recovery_wrap_envelope_id length:16],
          [NSData dataWithBytes:snapshot.authorization_envelope_id length:16],
          [NSData dataWithBytes:snapshot.endpoint_envelope_id length:16],
          [NSData dataWithBytes:snapshot.log_entry_envelope_id length:16],
          [NSData dataWithBytes:snapshot.recovery_wrap_nonce length:24],
          confirmedSeconds, confirmedSeconds, confirmedSeconds,
          confirmedSeconds, confirmedSeconds, &builderStatus);
      if (builtArtifacts == nil) {
        finalStatus =
            builderStatus == AncPrivateVaultGenesisBuilderStatusMemoryFailed ||
                    builderStatus ==
                        AncPrivateVaultGenesisBuilderStatusCleanupFailed
                ? AncPrivateVaultGenesisCoordinatorStatusProtectionFailed
                : AncPrivateVaultGenesisCoordinatorStatusAuthorizationFailed;
        @throw [NSException exceptionWithName:@"AncExpected"
                                       reason:nil
                                     userInfo:nil];
      }
      AncPrivateVaultGenesisPreparationStoreStatus confirmed =
          [self.preparationStore bindConfirmedHandle:handle
                                         handleLength:sizeof handle
                                            artifacts:builtArtifacts
                                        confirmedAtMs:confirmedAtMs
                                           controlLog:self.controlLog];
      if (confirmed != AncPrivateVaultGenesisPreparationStoreStatusOK) {
        finalStatus = PreparationStatus(confirmed);
        @throw [NSException exceptionWithName:@"AncExpected"
                                       reason:nil
                                     userInfo:nil];
      }
    }

    readStatus = [self.preparationStore readHandle:handle
                                      handleLength:sizeof handle
                                         snapshot:&snapshot
                                      secretHandle:nil];
    if (readStatus != AncPrivateVaultGenesisPreparationStoreStatusOK) {
      finalStatus = PreparationStatus(readStatus);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }
    if (snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED) {
      AncPrivateVaultGenesisPreparationStoreStatus committing =
          [self.preparationStore beginCommittingHandle:handle
                                          handleLength:sizeof handle];
      if (committing != AncPrivateVaultGenesisPreparationStoreStatusOK) {
        finalStatus = PreparationStatus(committing);
        @throw [NSException exceptionWithName:@"AncExpected"
                                       reason:nil
                                     userInfo:nil];
      }
      readStatus = [self.preparationStore readHandle:handle
                                        handleLength:sizeof handle
                                           snapshot:&snapshot
                                        secretHandle:nil];
    }
    if (readStatus != AncPrivateVaultGenesisPreparationStoreStatusOK ||
        snapshot.phase != ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING) {
      finalStatus = readStatus ==
                            AncPrivateVaultGenesisPreparationStoreStatusOK
                        ? AncPrivateVaultGenesisCoordinatorStatusConflict
                        : PreparationStatus(readStatus);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }

    if ((snapshot.flags &
         ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND) == 0) {
      uint8_t activeKey[32] = {0};
      uint8_t *activeKeyPointer = activeKey;
      __block AncPrivateVaultCustodyRepositoryStatus installed =
          AncPrivateVaultCustodyRepositoryStatusFailed;
      __block AncPrivateVaultPendingGenesisCustodyCheckpoint *checkpoint = nil;
      AncPrivateVaultGuardedMemoryStatus borrowed =
          [signingSeed borrow:^BOOL(uint8_t *signingBytes,
                                    size_t signingLength) {
        return signingLength == 32 &&
               [boxSeed borrow:^BOOL(uint8_t *boxBytes, size_t boxLength) {
          return boxLength == 32 &&
                 [localStateKey borrow:^BOOL(uint8_t *localBytes,
                                             size_t localLength) {
            return localLength == 32 &&
                   [epochOneEEK borrow:^BOOL(uint8_t *eekBytes,
                                             size_t eekLength) {
              if (eekLength != 32)
                return NO;
              AncPrivateVaultCustodySecretInputs secrets = {
                  .signing_seed = signingBytes,
                  .box_seed = boxBytes,
                  .local_state_key = localBytes,
                  .active_epoch_key = activeKeyPointer,
                  .pending_epoch_key = eekBytes,
              };
              installed = [self.custodyRepository
                  installPendingGenesisVaultId:Hex(snapshot.vault_id)
                                         endpointId:Hex(snapshot.endpoint_id)
                                         ceremonyId:Hex(snapshot.ceremony_id)
                                    signingPublicKey:
                                        [NSData
                                            dataWithBytes:snapshot
                                                              .endpoint_signing_public_key
                                                   length:32]
                                         boxPublicKey:
                                             [NSData
                                                 dataWithBytes:snapshot
                                                                   .endpoint_agreement_public_key
                                                        length:32]
                              bootstrapTranscriptDigest:
                                  [NSData
                                      dataWithBytes:snapshot
                                                        .bootstrap_transcript_digest
                                           length:32]
                                               secrets:&secrets
                                            checkpoint:&checkpoint];
              return installed == AncPrivateVaultCustodyRepositoryStatusOK;
            }] == AncPrivateVaultGuardedMemoryStatusOK;
          }] == AncPrivateVaultGuardedMemoryStatusOK;
        }] == AncPrivateVaultGuardedMemoryStatusOK;
      }];
      anc_pv_zeroize(activeKey, sizeof activeKey);
      if (borrowed != AncPrivateVaultGuardedMemoryStatusOK ||
          installed != AncPrivateVaultCustodyRepositoryStatusOK ||
          checkpoint == nil || checkpoint.recordDigest.length != 32) {
        finalStatus = installed == AncPrivateVaultCustodyRepositoryStatusConflict
                          ? AncPrivateVaultGenesisCoordinatorStatusConflict
                          : AncPrivateVaultGenesisCoordinatorStatusStorageFailed;
        @throw [NSException exceptionWithName:@"AncExpected"
                                       reason:nil
                                     userInfo:nil];
      }
      AncPrivateVaultGenesisPreparationStoreStatus bound =
          [self.preparationStore
              bindPendingGenesisCustodyHandle:handle
                                   handleLength:sizeof handle
                              custodyRepository:self.custodyRepository];
      if (bound != AncPrivateVaultGenesisPreparationStoreStatusOK) {
        finalStatus = PreparationStatus(bound);
        @throw [NSException exceptionWithName:@"AncExpected"
                                       reason:nil
                                     userInfo:nil];
      }
    }

    readStatus = [self.preparationStore readHandle:handle
                                      handleLength:sizeof handle
                                         snapshot:&snapshot
                                      secretHandle:nil];
    if (readStatus != AncPrivateVaultGenesisPreparationStoreStatusOK ||
        snapshot.phase != ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING ||
        (snapshot.flags &
         ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND) == 0) {
      finalStatus = AncPrivateVaultGenesisCoordinatorStatusConflict;
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }
    NSData *recoveryWrap = nil;
    NSData *confirmation = nil;
    NSData *bootstrap = nil;
    NSData *authorization = nil;
    AncPrivateVaultGenesisPreparationArtifactStatus artifactStatus;
    if (!CopyLivePreparationArtifacts(
            self.preparationArtifactStore, &snapshot, &recoveryWrap,
            &confirmation, &bootstrap, &authorization, &artifactStatus)) {
      finalStatus = PreparationArtifactStatus(artifactStatus);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }
    (void)recoveryWrap;
    AncPrivateVaultGenesisCoordinatorResult *officialResult = nil;
    AncPrivateVaultGenesisCoordinatorStatus committed =
        [self commitVaultId:snapshot.vault_id
               bootstrapTranscript:bootstrap
              recoveryConfirmation:confirmation
                     authorization:authorization
                            result:&officialResult];
    if (committed != AncPrivateVaultGenesisCoordinatorStatusOK ||
        officialResult == nil) {
      finalStatus = committed;
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }
    AncPrivateVaultGenesisPreparationStoreStatus terminal =
        [self.preparationStore
            bindOfficialGenesisHandle:handle
                          handleLength:sizeof handle
                        authorityStore:self.authorityStore
                     custodyRepository:self.custodyRepository];
    if (terminal != AncPrivateVaultGenesisPreparationStoreStatusOK) {
      finalStatus = PreparationStatus(terminal);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }
    if (result != NULL)
      *result = officialResult;
    finalStatus = AncPrivateVaultGenesisCoordinatorStatusOK;
  } @catch (NSException *exception) {
    if (![exception.name isEqualToString:@"AncExpected"] &&
        ![exception.name isEqualToString:@"AncFinished"])
      finalStatus = AncPrivateVaultGenesisCoordinatorStatusStorageFailed;
  } @finally {
    BOOL closed = YES;
    closed = CloseGuarded(recoveryEntropy) && closed;
    closed = CloseGuarded(signingSeed) && closed;
    closed = CloseGuarded(boxSeed) && closed;
    closed = CloseGuarded(localStateKey) && closed;
    closed = CloseGuarded(epochOneEEK) && closed;
    anc_pv_zeroize(handle, sizeof handle);
    anc_pv_genesis_preparation_snapshot_zero(&snapshot);
    [lock unlock];
    if (!closed) {
      if (result != NULL)
        *result = nil;
      finalStatus = AncPrivateVaultGenesisCoordinatorStatusProtectionFailed;
    }
  }
  return finalStatus;
}

- (AncPrivateVaultGenesisCoordinatorStatus)
           commitVaultId:(const uint8_t *)vaultId
     bootstrapTranscript:(NSData *)bootstrap
    recoveryConfirmation:(NSData *)confirmation
           authorization:(NSData *)authorization
                  result:(AncPrivateVaultGenesisCoordinatorResult **)result {
  if (result)
    *result = nil;
  NSString *vaultHex = Hex(vaultId);
  uint64_t now = 0;
  if (vaultHex == nil || ![self.trustedClock readNowMilliseconds:&now] ||
      now == 0 || now > kMaximumSafeInteger)
    return AncPrivateVaultGenesisCoordinatorStatusInvalid;
  NSRecursiveLock *lock = AncPrivateVaultGenesisLockForVaultId(vaultHex);
  if (lock == nil)
    return AncPrivateVaultGenesisCoordinatorStatusInvalid;
  [lock lock];
  @try {
    NSData *expectedVault = [NSData dataWithBytes:vaultId length:16];
    AncPrivateVaultGenesisBootstrapStatus bootstrapStatus;
    AncPrivateVaultGenesisBootstrapResult *bootstrapResult =
        AncPrivateVaultGenesisBootstrapVerify(bootstrap, confirmation,
                                              expectedVault, &bootstrapStatus);
    AncPrivateVaultGenesisAuthorizationStatus authStatus;
    NSData *signedCommit = AncPrivateVaultGenesisAuthorizationCopySignedCommit(
        authorization, expectedVault, &authStatus);
    AncPrivateVaultGenesisAuthorizationVerifier *verifier =
        bootstrapResult == nil || signedCommit == nil
            ? nil
            : [[AncPrivateVaultGenesisAuthorizationVerifier alloc]
                  initWithAuthorization:authorization
                   recoveryConfirmation:confirmation
                    bootstrapTranscript:bootstrap
                        bootstrapResult:bootstrapResult
                                 status:&authStatus];
    AncPrivateVaultControlLogReplayResult *replay = nil;
    if (verifier == nil ||
        [self.controlLog
            replaySignedEntry:signedCommit
                 currentState:nil
                     verifier:verifier
                       result:&replay] != AncPrivateVaultControlLogStatusOK ||
        replay == nil || verifier.result == nil ||
        AncPrivateVaultVerifiedGenesisReplayResultCreate(
            replay, verifier.result, now) == nil)
      return AncPrivateVaultGenesisCoordinatorStatusAuthorizationFailed;
    AncPrivateVaultCustodySnapshot pending = {0};
    AncPrivateVaultCustodyHandle *pendingHandle = nil;
    AncPrivateVaultCustodyRepositoryStatus pendingStatus =
        [self.custodyRepository readVaultId:vaultHex
                                   snapshot:&pending
                                     handle:&pendingHandle];
    AncPrivateVaultCustodyRepositoryStatus pendingClose =
        pendingHandle == nil
            ? AncPrivateVaultCustodyRepositoryStatusInaccessible
            : [pendingHandle close];
    if (pendingStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
        pendingClose == AncPrivateVaultCustodyRepositoryStatusOK &&
        pending.custody_generation == 2 &&
        pending.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
        pending.authority_anchor_present == 1) {
      AncPrivateVaultAuthorityCheckpoint *existing = nil;
      AncPrivateVaultAuthorityStoreStatus existingStatus =
          [self.authorityStore loadVaultId:vaultHex
                                checkpoint:&existing
                                     error:nil];
      BOOL same =
          existingStatus == AncPrivateVaultAuthorityStoreStatusOK &&
          OfficialExact(existing, &pending, vaultHex, 0) &&
          existing.snapshot.sequence == replay.state.sequence &&
          existing.snapshot.epoch == replay.state.epoch &&
          existing.snapshot.recoveryGeneration ==
              replay.state.recoveryGeneration &&
          [existing.snapshot.headHash isEqualToData:replay.state.headHash] &&
          [existing.snapshot.membershipHash
              isEqualToData:replay.state.membershipHash] &&
          [existing.snapshot.recoveryWrapHash
              isEqualToData:replay.state.recoveryWrapHash];
      anc_pv_zeroize(&pending, sizeof pending);
      return same ? [self resumeVaultId:vaultId result:result]
                  : AncPrivateVaultGenesisCoordinatorStatusConflict;
    }
    AncPrivateVaultGenesisBootstrapTranscript *transcript =
        bootstrapResult.transcript;
    NSData *endpointASCII = [Hex(transcript.endpointId.bytes)
        dataUsingEncoding:NSASCIIStringEncoding];
    NSData *ceremonyASCII = [Hex(transcript.ceremonyId.bytes)
        dataUsingEncoding:NSASCIIStringEncoding];
    BOOL pendingMatches =
        pendingStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
        pendingClose == AncPrivateVaultCustodyRepositoryStatusOK &&
        pending.custody_generation == 1 &&
        pending.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
        pending.role == ANC_PV_CUSTODY_ROLE_ENDPOINT &&
        pending.pending_kind == ANC_PV_CUSTODY_PENDING_GENESIS &&
        pending.rotation_phase == ANC_PV_CUSTODY_ROTATION_PREPARED &&
        pending.enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_NONE &&
        pending.authority_anchor_present == 0 &&
        pending.expected_edge_present == 1 && pending.active_epoch == 0 &&
        pending.pending_epoch == 1 && pending.recovery_generation == 0 &&
        pending.anchored_sequence == 0 && pending.signed_at_ms == 0 &&
        pending.freshness_ms == 0 && pending.expected_next_sequence == 0 &&
        Zero(pending.anchored_head, 32) &&
        Zero(pending.membership_digest, 32) &&
        Zero(pending.snapshot_digest, 32) &&
        Zero(pending.expected_previous_head, 32) &&
        pending.ceremony_id_length > 0 &&
        !Zero(pending.pending_transcript_digest, 32) &&
        Identifier(pending.vault_id, pending.vault_id_length, vaultHex) &&
        pending.endpoint_id_length == endpointASCII.length &&
        pending.ceremony_id_length == ceremonyASCII.length &&
        anc_pv_memcmp(pending.endpoint_id, endpointASCII.bytes,
                      endpointASCII.length) == ANC_PV_CRYPTO_OK &&
        anc_pv_memcmp(pending.ceremony_id, ceremonyASCII.bytes,
                      ceremonyASCII.length) == ANC_PV_CRYPTO_OK &&
        anc_pv_memcmp(pending.signing_public_key,
                      transcript.endpointSigningPublicKey.bytes,
                      32) == ANC_PV_CRYPTO_OK &&
        anc_pv_memcmp(pending.box_public_key,
                      transcript.endpointKeyAgreementPublicKey.bytes,
                      32) == ANC_PV_CRYPTO_OK &&
        anc_pv_memcmp(pending.pending_transcript_digest,
                      bootstrapResult.digest.bytes, 32) == ANC_PV_CRYPTO_OK;
    anc_pv_zeroize(&pending, sizeof pending);
    if (!pendingMatches)
      return AncPrivateVaultGenesisCoordinatorStatusConflict;
    AncPrivateVaultGenesisArtifactStoreStatus staged =
        [self.artifactStore stageVaultId:vaultId
                              ceremonyId:transcript.ceremonyId.bytes
                            verifiedAtMs:now
                     bootstrapTranscript:bootstrap
                    recoveryConfirmation:confirmation
                           authorization:authorization];
    if (staged != AncPrivateVaultGenesisArtifactStoreStatusOK)
      return ArtifactStatus(staged);
    return [self resumeVaultId:vaultId result:result];
  } @finally {
    [lock unlock];
  }
}

- (AncPrivateVaultGenesisCoordinatorStatus)
    resumeVaultId:(const uint8_t *)vaultId
           result:(AncPrivateVaultGenesisCoordinatorResult **)result {
  if (result)
    *result = nil;
  NSString *vaultHex = Hex(vaultId);
  if (vaultHex == nil)
    return AncPrivateVaultGenesisCoordinatorStatusInvalid;
  NSRecursiveLock *lock = AncPrivateVaultGenesisLockForVaultId(vaultHex);
  if (lock == nil)
    return AncPrivateVaultGenesisCoordinatorStatusInvalid;
  [lock lock];
  @try {
    AncPrivateVaultGenesisArtifacts *artifacts = nil;
    AncPrivateVaultGenesisArtifactStoreStatus read =
        [self.artifactStore readVaultId:vaultId artifacts:&artifacts];
    if (read == AncPrivateVaultGenesisArtifactStoreStatusNotFound) {
      AncPrivateVaultAuthorityCheckpoint *official = nil;
      if ([self.authorityStore
              loadVaultId:vaultHex
               checkpoint:&official
                    error:nil] != AncPrivateVaultAuthorityStoreStatusOK ||
          official == nil)
        return AncPrivateVaultGenesisCoordinatorStatusNotFound;
      AncPrivateVaultCustodySnapshot custody = {0};
      AncPrivateVaultCustodyHandle *handle = nil;
      AncPrivateVaultCustodyRepositoryStatus cs =
          [self.custodyRepository readVaultId:vaultHex
                                     snapshot:&custody
                                       handle:&handle];
      AncPrivateVaultCustodyRepositoryStatus closed =
          handle == nil ? AncPrivateVaultCustodyRepositoryStatusInaccessible
                        : [handle close];
      BOOL exact = cs == AncPrivateVaultCustodyRepositoryStatusOK &&
                   closed == AncPrivateVaultCustodyRepositoryStatusOK &&
                   OfficialExact(official, &custody, vaultHex, 0);
      if (!exact) {
        anc_pv_zeroize(&custody, sizeof custody);
        return AncPrivateVaultGenesisCoordinatorStatusProtectionFailed;
      }
      AncPrivateVaultGenesisCoordinatorResult *value = (id)class_createInstance(
          AncPrivateVaultGenesisCoordinatorResult.class, 0);
      value.vaultId = [vaultHex copy];
      value.authorityCheckpoint = official;
      value.custodyGeneration = custody.custody_generation;
      value.activeEpoch = custody.active_epoch;
      value.sequence = official.snapshot.sequence;
      value.headHash = [official.snapshot.headHash copy];
      value.membershipHash = [official.snapshot.membershipHash copy];
      value.recoveryGeneration = official.snapshot.recoveryGeneration;
      value.recoveryWrapHash = [official.snapshot.recoveryWrapHash copy];
      anc_pv_zeroize(&custody, sizeof custody);
      object_setClass(value, AncImmutableGenesisCoordinatorResult.class);
      if (result)
        *result = value;
      return AncPrivateVaultGenesisCoordinatorStatusOK;
    }
    if (read != AncPrivateVaultGenesisArtifactStoreStatusOK)
      return ArtifactStatus(read);
    NSData *expectedVault = [NSData dataWithBytes:vaultId length:16];
    AncPrivateVaultGenesisBootstrapStatus bootstrapStatus;
    AncPrivateVaultGenesisBootstrapResult *bootstrap =
        AncPrivateVaultGenesisBootstrapVerify(artifacts.bootstrapTranscript,
                                              artifacts.recoveryConfirmation,
                                              expectedVault, &bootstrapStatus);
    if (bootstrap == nil)
      return AncPrivateVaultGenesisCoordinatorStatusAuthorizationFailed;
    if (![artifacts.ceremonyId isEqualToData:bootstrap.transcript.ceremonyId])
      return AncPrivateVaultGenesisCoordinatorStatusAuthorizationFailed;
    AncPrivateVaultGenesisAuthorizationStatus authorizationStatus;
    NSData *signedCommit = AncPrivateVaultGenesisAuthorizationCopySignedCommit(
        artifacts.authorization, expectedVault, &authorizationStatus);
    AncPrivateVaultGenesisAuthorizationVerifier *verifier =
        [[AncPrivateVaultGenesisAuthorizationVerifier alloc]
            initWithAuthorization:artifacts.authorization
             recoveryConfirmation:artifacts.recoveryConfirmation
              bootstrapTranscript:artifacts.bootstrapTranscript
                  bootstrapResult:bootstrap
                           status:&authorizationStatus];
    if (verifier == nil || signedCommit.length == 0)
      return AncPrivateVaultGenesisCoordinatorStatusAuthorizationFailed;
    AncPrivateVaultControlLogReplayResult *replay = nil;
    AncPrivateVaultControlLogStatus replayStatus =
        [self.controlLog replaySignedEntry:signedCommit
                              currentState:nil
                                  verifier:verifier
                                    result:&replay];
    if (replayStatus != AncPrivateVaultControlLogStatusOK || replay == nil)
      return AncPrivateVaultGenesisCoordinatorStatusAuthorizationFailed;
    AncPrivateVaultVerifiedReplayResult *verified =
        AncPrivateVaultVerifiedGenesisReplayResultCreate(
            replay, verifier.result, artifacts.verifiedAtMs);
    if (verified == nil ||
        CoordinatorFault(
            AncPrivateVaultGenesisCoordinatorFaultAfterArtifactAuthentication))
      return verified == nil
                 ? AncPrivateVaultGenesisCoordinatorStatusAuthorizationFailed
                 : AncPrivateVaultGenesisCoordinatorStatusStorageFailed;
    AncPrivateVaultAuthorityCheckpoint *checkpoint = nil;
    AncPrivateVaultAuthorityStoreStatus committed =
        [self.authorityStore commitVerifiedReplayResult:verified
                                                vaultId:vaultHex
                                           verifiedAtMs:artifacts.verifiedAtMs
                                             checkpoint:&checkpoint
                                                  error:nil];
    if (committed != AncPrivateVaultAuthorityStoreStatusOK ||
        checkpoint == nil) {
      if (committed == AncPrivateVaultAuthorityStoreStatusConflict)
        return AncPrivateVaultGenesisCoordinatorStatusConflict;
      if (committed == AncPrivateVaultAuthorityStoreStatusProtectionFailed)
        return AncPrivateVaultGenesisCoordinatorStatusProtectionFailed;
      return AncPrivateVaultGenesisCoordinatorStatusStorageFailed;
    }
    if (CoordinatorFault(
            AncPrivateVaultGenesisCoordinatorFaultAfterAuthorityCommit) ||
        CoordinatorFault(
            AncPrivateVaultGenesisCoordinatorFaultBeforeOfficialReread))
      return AncPrivateVaultGenesisCoordinatorStatusStorageFailed;
    AncPrivateVaultAuthorityCheckpoint *official = nil;
    if ([self.authorityStore
            loadVaultId:vaultHex
             checkpoint:&official
                  error:nil] != AncPrivateVaultAuthorityStoreStatusOK ||
        official == nil)
      return AncPrivateVaultGenesisCoordinatorStatusStorageFailed;
    AncPrivateVaultCustodySnapshot custody;
    AncPrivateVaultCustodyHandle *handle = nil;
    AncPrivateVaultCustodyRepositoryStatus custodyStatus =
        [self.custodyRepository readVaultId:vaultHex
                                   snapshot:&custody
                                     handle:&handle];
    AncPrivateVaultCustodyRepositoryStatus closeStatus =
        handle == nil ? AncPrivateVaultCustodyRepositoryStatusInaccessible
                      : [handle close];
    BOOL exact =
        custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
        closeStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
        OfficialExact(official, &custody, vaultHex, artifacts.verifiedAtMs) &&
        [official.frameDigest isEqualToData:checkpoint.frameDigest] &&
        [official.snapshot.headHash
            isEqualToData:checkpoint.snapshot.headHash] &&
        checkpoint.custodyGeneration == official.custodyGeneration;
    if (!exact) {
      anc_pv_zeroize(&custody, sizeof custody);
      return AncPrivateVaultGenesisCoordinatorStatusProtectionFailed;
    }
    if (CoordinatorFault(
            AncPrivateVaultGenesisCoordinatorFaultBeforeArtifactCleanup))
      return AncPrivateVaultGenesisCoordinatorStatusStorageFailed;
    AncPrivateVaultGenesisArtifactStoreStatus cleanupStatus =
        [self.artifactStore deleteVaultId:vaultId];
    if (cleanupStatus != AncPrivateVaultGenesisArtifactStoreStatusOK)
      return AncPrivateVaultGenesisCoordinatorStatusStorageFailed;
    AncPrivateVaultGenesisCoordinatorResult *value = (id)class_createInstance(
        AncPrivateVaultGenesisCoordinatorResult.class, 0);
    value.vaultId = [vaultHex copy];
    value.authorityCheckpoint = official;
    value.custodyGeneration = custody.custody_generation;
    value.activeEpoch = custody.active_epoch;
    value.sequence = official.snapshot.sequence;
    value.headHash = [official.snapshot.headHash copy];
    value.membershipHash = [official.snapshot.membershipHash copy];
    value.recoveryGeneration = official.snapshot.recoveryGeneration;
    value.recoveryWrapHash = [official.snapshot.recoveryWrapHash copy];
    object_setClass(value, AncImmutableGenesisCoordinatorResult.class);
    anc_pv_zeroize(&custody, sizeof custody);
    if (result)
      *result = value;
    return AncPrivateVaultGenesisCoordinatorStatusOK;
  } @finally {
    [lock unlock];
  }
}
@end
