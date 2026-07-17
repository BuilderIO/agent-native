#import "PrivateVaultRotationCoordinator.h"

#import "PrivateVaultRotationCoordinatorInternal.h"
#import "PrivateVaultRotationPreparationStoreInternal.h"
#import "PrivateVaultAuthorityStoreInternal.h"
#import "PrivateVaultControlLogInternal.h"
#import "PrivateVaultRecoveryWrapInternal.h"

#import <math.h>
#import <objc/runtime.h>

static const uint64_t kAncRotationCoordinatorMaximumSafeInteger =
    UINT64_C(9007199254740991);

@interface AncPrivateVaultRotationCoordinatorResult ()
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite)
    AncPrivateVaultRotationPreparationCheckpoint *preparationCheckpoint;
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

@interface AncPrivateVaultImmutableRotationCoordinatorResult
    : AncPrivateVaultRotationCoordinatorResult
@end

static void AncRotationCoordinatorRaiseImmutableMutation(void) {
  [NSException raise:NSInternalInconsistencyException
              format:@"rotation coordinator results are immutable"];
}

@implementation AncPrivateVaultImmutableRotationCoordinatorResult
- (void)setVaultId:(NSString *)value { (void)value; AncRotationCoordinatorRaiseImmutableMutation(); }
- (void)setPreparationCheckpoint:(AncPrivateVaultRotationPreparationCheckpoint *)value { (void)value; AncRotationCoordinatorRaiseImmutableMutation(); }
- (void)setAuthorityCheckpoint:(AncPrivateVaultAuthorityCheckpoint *)value { (void)value; AncRotationCoordinatorRaiseImmutableMutation(); }
- (void)setCustodyGeneration:(uint64_t)value { (void)value; AncRotationCoordinatorRaiseImmutableMutation(); }
- (void)setActiveEpoch:(uint64_t)value { (void)value; AncRotationCoordinatorRaiseImmutableMutation(); }
- (void)setSequence:(uint64_t)value { (void)value; AncRotationCoordinatorRaiseImmutableMutation(); }
- (void)setHeadHash:(NSData *)value { (void)value; AncRotationCoordinatorRaiseImmutableMutation(); }
- (void)setMembershipHash:(NSData *)value { (void)value; AncRotationCoordinatorRaiseImmutableMutation(); }
- (void)setRecoveryGeneration:(uint64_t)value { (void)value; AncRotationCoordinatorRaiseImmutableMutation(); }
- (void)setRecoveryWrapHash:(NSData *)value { (void)value; AncRotationCoordinatorRaiseImmutableMutation(); }
- (void)setValue:(id)value forKey:(NSString *)key { (void)value; (void)key; AncRotationCoordinatorRaiseImmutableMutation(); }
@end

@implementation AncPrivateVaultRotationCoordinatorResult
@end

@implementation AncPrivateVaultSystemTrustedClock
- (BOOL)readNowMilliseconds:(uint64_t *)milliseconds {
  if (milliseconds == NULL)
    return NO;
  NSTimeInterval interval = NSDate.date.timeIntervalSince1970;
  if (!isfinite(interval) || interval <= 0 ||
      interval > (double)kAncRotationCoordinatorMaximumSafeInteger / 1000.0)
    return NO;
  uint64_t value = (uint64_t)floor(interval * 1000.0);
  if (value == 0 || value > kAncRotationCoordinatorMaximumSafeInteger)
    return NO;
  *milliseconds = value;
  return YES;
}
@end

@interface AncPrivateVaultRotationCoordinator ()
@property(nonatomic) AncPrivateVaultRotationPreparationStore *preparationStore;
@property(nonatomic) AncPrivateVaultAuthorityStore *authorityStore;
@property(nonatomic) AncPrivateVaultCustodyRepository *custodyRepository;
@property(nonatomic) AncPrivateVaultControlLog *controlLog;
@property(nonatomic) id<AncPrivateVaultTrustedClock> trustedClock;
@end

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultRotationCoordinatorFaultHook
    gAncPrivateVaultRotationCoordinatorFaultHook;
void AncPrivateVaultRotationCoordinatorSetFaultHookForTesting(
    AncPrivateVaultRotationCoordinatorFaultHook hook) {
  gAncPrivateVaultRotationCoordinatorFaultHook = [hook copy];
}
#endif

static BOOL AncRotationCoordinatorFault(
    AncPrivateVaultRotationCoordinatorFaultPoint point) {
#if ANC_PRIVATE_VAULT_TESTING
  return gAncPrivateVaultRotationCoordinatorFaultHook != nil &&
         gAncPrivateVaultRotationCoordinatorFaultHook(point);
#else
  (void)point;
  return NO;
#endif
}

static NSArray<NSRecursiveLock *> *AncRotationCoordinatorLocks(void) {
  static NSArray<NSRecursiveLock *> *locks;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSMutableArray<NSRecursiveLock *> *values =
        [NSMutableArray arrayWithCapacity:64];
    for (NSUInteger index = 0; index < 64; index++)
      [values addObject:[NSRecursiveLock new]];
    locks = [values copy];
  });
  return locks;
}

static NSRecursiveLock *AncRotationCoordinatorLockForVault(NSString *vaultId) {
  NSData *bytes = [vaultId dataUsingEncoding:NSASCIIStringEncoding];
  const uint8_t *raw = bytes.bytes;
  uint64_t hash = UINT64_C(1469598103934665603);
  for (NSUInteger index = 0; index < bytes.length; index++) {
    hash ^= raw[index];
    hash *= UINT64_C(1099511628211);
  }
  return AncRotationCoordinatorLocks()[hash % 64];
}

static BOOL AncRotationCoordinatorHasExactCollaborators(
    AncPrivateVaultRotationPreparationStore *preparationStore,
    AncPrivateVaultAuthorityStore *authorityStore,
    AncPrivateVaultCustodyRepository *custodyRepository,
    AncPrivateVaultControlLog *controlLog) {
  return object_getClass(preparationStore) ==
             AncPrivateVaultRotationPreparationStore.class &&
         object_getClass(authorityStore) == AncPrivateVaultAuthorityStore.class &&
         object_getClass(custodyRepository) ==
             AncPrivateVaultCustodyRepository.class &&
         object_getClass(controlLog) == AncPrivateVaultControlLog.class;
}

static NSString *AncRotationCoordinatorHex(const uint8_t *bytes,
                                            size_t length) {
  if (bytes == NULL || length == 0)
    return nil;
  NSMutableString *value = [NSMutableString stringWithCapacity:length * 2];
  for (size_t index = 0; index < length; index++)
    [value appendFormat:@"%02x", bytes[index]];
  return value;
}

static BOOL AncRotationCoordinatorBytesEqualData(const uint8_t *bytes,
                                                  NSData *data,
                                                  size_t length) {
  return bytes != NULL && data.length == length &&
         anc_pv_memcmp(bytes, data.bytes, length) == ANC_PV_CRYPTO_OK;
}

static BOOL AncRotationCoordinatorBytesEqual(const uint8_t *left,
                                              const uint8_t *right,
                                              size_t length) {
  return left != NULL && right != NULL &&
         anc_pv_memcmp(left, right, length) == ANC_PV_CRYPTO_OK;
}

static BOOL AncRotationCoordinatorCustodyIdentifier(const uint8_t *bytes,
                                                     size_t length,
                                                     NSString *expected) {
  NSData *encoded = [expected dataUsingEncoding:NSUTF8StringEncoding];
  return bytes != NULL && encoded.length == length &&
         anc_pv_memcmp(bytes, encoded.bytes, length) == ANC_PV_CRYPTO_OK;
}

static AncPrivateVaultAuthorityMember *AncRotationCoordinatorMember(
    AncPrivateVaultAuthoritySnapshot *authority, NSString *endpointId) {
  for (AncPrivateVaultAuthorityMember *member in authority.activeMembers)
    if ([member.endpointId isEqualToString:endpointId])
      return member;
  return nil;
}

static BOOL AncRotationCoordinatorPreparationValid(
    const uint8_t *requestedVault,
    const AncPrivateVaultRotationPreparationSnapshot *preparation,
    NSString *vaultHex) {
  if (requestedVault == NULL || preparation == NULL || vaultHex.length != 32 ||
      !AncRotationCoordinatorBytesEqual(
          requestedVault, preparation->vault_id,
          ANC_PV_ROTATION_PREPARATION_ID_BYTES) ||
      (preparation->phase !=
           ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT &&
       preparation->phase != ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED) ||
      preparation->flags !=
          (ANC_PV_ROTATION_PREPARATION_FLAG_EDGE_BOUND |
           ANC_PV_ROTATION_PREPARATION_FLAG_SPOOL_DURABLE) ||
      preparation->preparation_generation == 0 ||
      preparation->base_custody_generation == 0 ||
      preparation->base_custody_generation == UINT64_MAX ||
      preparation->base_sequence == UINT64_MAX ||
      preparation->base_epoch == UINT64_MAX ||
      preparation->base_recovery_generation == 0 ||
      preparation->pending_epoch != preparation->base_epoch + 1 ||
      preparation->expected_sequence != preparation->base_sequence + 1 ||
      !AncRotationCoordinatorBytesEqual(preparation->expected_previous_head,
                                        preparation->base_head, 32) ||
      preparation->signed_entry_length == 0 ||
      preparation->signed_entry_length >
          ANC_PV_ROTATION_SIGNED_ENTRY_MAX_BYTES ||
      preparation->recovery_wrap_length == 0 ||
      preparation->recovery_wrap_length >
          ANC_PV_ROTATION_RECOVERY_WRAP_MAX_BYTES)
    return NO;
  BOOL endpoint = preparation->role ==
                      ANC_PV_ROTATION_PREPARATION_ROLE_ENDPOINT &&
                  preparation->unattended == 0;
  BOOL broker = preparation->role == ANC_PV_ROTATION_PREPARATION_ROLE_BROKER &&
                preparation->unattended == 1;
  return endpoint || broker;
}

static BOOL AncRotationCoordinatorIdentityValid(
    const AncPrivateVaultRotationPreparationSnapshot *preparation,
    AncPrivateVaultAuthoritySnapshot *authority,
    const AncPrivateVaultCustodySnapshot *custody) {
  NSString *endpointId = AncRotationCoordinatorHex(
      preparation->endpoint_id, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
  NSString *enrollmentRef = AncRotationCoordinatorHex(
      preparation->enrollment_ref, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
  NSString *role =
      preparation->role == ANC_PV_ROTATION_PREPARATION_ROLE_ENDPOINT
          ? @"endpoint"
          : preparation->role == ANC_PV_ROTATION_PREPARATION_ROLE_BROKER
                ? @"broker"
                : nil;
  AncPrivateVaultAuthorityMember *member =
      AncRotationCoordinatorMember(authority, endpointId);
  return endpointId != nil && enrollmentRef != nil && role != nil &&
         member != nil && [member.role isEqualToString:role] &&
         member.unattended == (preparation->unattended != 0) &&
         [member.enrollmentRef isEqualToString:enrollmentRef] &&
         AncRotationCoordinatorBytesEqualData(preparation->signing_public_key,
                                              member.signingPublicKey, 32) &&
         AncRotationCoordinatorBytesEqualData(preparation->agreement_public_key,
                                              member.keyAgreementPublicKey, 32) &&
         AncRotationCoordinatorCustodyIdentifier(
             custody->endpoint_id, custody->endpoint_id_length, endpointId) &&
         custody->role ==
             (preparation->role == ANC_PV_ROTATION_PREPARATION_ROLE_ENDPOINT
                  ? ANC_PV_CUSTODY_ROLE_ENDPOINT
                  : ANC_PV_CUSTODY_ROLE_BROKER) &&
         AncRotationCoordinatorBytesEqual(preparation->signing_public_key,
                                          custody->signing_public_key, 32) &&
         AncRotationCoordinatorBytesEqual(preparation->agreement_public_key,
                                          custody->box_public_key, 32);
}

static BOOL AncRotationCoordinatorBaseTupleValid(
    const AncPrivateVaultRotationPreparationSnapshot *preparation,
    NSString *vaultHex, AncPrivateVaultAuthorityCheckpoint *authority,
    const AncPrivateVaultCustodySnapshot *custody) {
  AncPrivateVaultAuthoritySnapshot *snapshot = authority.snapshot;
  NSString *ceremony = AncRotationCoordinatorHex(
      preparation->ceremony_id, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
  if (authority == nil || snapshot == nil || custody == NULL ||
      ![authority.vaultId isEqualToString:vaultHex] ||
      ![snapshot.vaultId isEqualToString:vaultHex] ||
      authority.custodyGeneration != preparation->base_custody_generation ||
      snapshot.targetCustodyGeneration !=
          preparation->base_custody_generation ||
      !AncRotationCoordinatorBytesEqualData(preparation->base_frame_digest,
                                             authority.frameDigest, 32) ||
      snapshot.sequence != preparation->base_sequence ||
      !AncRotationCoordinatorBytesEqualData(preparation->base_head,
                                             snapshot.headHash, 32) ||
      !AncRotationCoordinatorBytesEqualData(preparation->base_membership,
                                             snapshot.membershipHash, 32) ||
      snapshot.epoch != preparation->base_epoch ||
      snapshot.recoveryGeneration !=
          preparation->base_recovery_generation ||
      custody->record_version != ANC_PV_CUSTODY_VERSION ||
      custody->authority_anchor_present != 1 ||
      custody->custody_generation != preparation->base_custody_generation ||
      !AncRotationCoordinatorCustodyIdentifier(custody->vault_id,
                                               custody->vault_id_length,
                                               vaultHex) ||
      !AncRotationCoordinatorBytesEqualData(custody->snapshot_digest,
                                             authority.frameDigest, 32) ||
      custody->anchored_sequence != snapshot.sequence ||
      !AncRotationCoordinatorBytesEqualData(custody->anchored_head,
                                             snapshot.headHash, 32) ||
      !AncRotationCoordinatorBytesEqualData(custody->membership_digest,
                                             snapshot.membershipHash, 32) ||
      custody->signed_at_ms != snapshot.signedAtMs ||
      custody->freshness_ms != snapshot.verifiedAtMs ||
      custody->active_epoch != preparation->base_epoch ||
      custody->pending_epoch != preparation->pending_epoch ||
      custody->expected_edge_present != 1 ||
      custody->expected_next_sequence != preparation->expected_sequence ||
      !AncRotationCoordinatorBytesEqual(custody->expected_previous_head,
                                        preparation->expected_previous_head,
                                        32) ||
      !AncRotationCoordinatorBytesEqual(custody->pending_transcript_digest,
                                        preparation->transcript_digest, 32) ||
      !AncRotationCoordinatorCustodyIdentifier(custody->ceremony_id,
                                               custody->ceremony_id_length,
                                               ceremony))
    return NO;
  return AncRotationCoordinatorIdentityValid(preparation, snapshot, custody);
}

static AncPrivateVaultRotationCoordinatorStatus
AncRotationCoordinatorStatusForPreparation(
    AncPrivateVaultRotationPreparationStoreStatus status) {
  switch (status) {
  case AncPrivateVaultRotationPreparationStoreStatusOK:
    return AncPrivateVaultRotationCoordinatorStatusOK;
  case AncPrivateVaultRotationPreparationStoreStatusNotFound:
    return AncPrivateVaultRotationCoordinatorStatusNotFound;
  case AncPrivateVaultRotationPreparationStoreStatusInvalid:
    return AncPrivateVaultRotationCoordinatorStatusInvalid;
  case AncPrivateVaultRotationPreparationStoreStatusConflict:
    return AncPrivateVaultRotationCoordinatorStatusConflict;
  case AncPrivateVaultRotationPreparationStoreStatusRollbackDetected:
    return AncPrivateVaultRotationCoordinatorStatusRollbackDetected;
  case AncPrivateVaultRotationPreparationStoreStatusCorrupt:
    return AncPrivateVaultRotationCoordinatorStatusCorrupt;
  case AncPrivateVaultRotationPreparationStoreStatusInaccessible:
    return AncPrivateVaultRotationCoordinatorStatusInaccessible;
  case AncPrivateVaultRotationPreparationStoreStatusStorageFailed:
    return AncPrivateVaultRotationCoordinatorStatusStorageFailed;
  }
  return AncPrivateVaultRotationCoordinatorStatusStorageFailed;
}

static AncPrivateVaultRotationCoordinatorStatus
AncRotationCoordinatorStatusForAuthority(AncPrivateVaultAuthorityStoreStatus status) {
  switch (status) {
  case AncPrivateVaultAuthorityStoreStatusOK:
    return AncPrivateVaultRotationCoordinatorStatusOK;
  case AncPrivateVaultAuthorityStoreStatusNotFound:
    return AncPrivateVaultRotationCoordinatorStatusNotFound;
  case AncPrivateVaultAuthorityStoreStatusRemoved:
    return AncPrivateVaultRotationCoordinatorStatusConflict;
  case AncPrivateVaultAuthorityStoreStatusInvalid:
    return AncPrivateVaultRotationCoordinatorStatusInvalid;
  case AncPrivateVaultAuthorityStoreStatusCorrupt:
    return AncPrivateVaultRotationCoordinatorStatusCorrupt;
  case AncPrivateVaultAuthorityStoreStatusRollbackDetected:
    return AncPrivateVaultRotationCoordinatorStatusRollbackDetected;
  case AncPrivateVaultAuthorityStoreStatusConflict:
    return AncPrivateVaultRotationCoordinatorStatusConflict;
  case AncPrivateVaultAuthorityStoreStatusProtectionFailed:
    return AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
  case AncPrivateVaultAuthorityStoreStatusStorageFailed:
    return AncPrivateVaultRotationCoordinatorStatusStorageFailed;
  }
  return AncPrivateVaultRotationCoordinatorStatusAuthorityRejected;
}

static AncPrivateVaultRotationCoordinatorStatus
AncRotationCoordinatorStatusForCustody(
    AncPrivateVaultCustodyRepositoryStatus status) {
  switch (status) {
  case AncPrivateVaultCustodyRepositoryStatusOK:
    return AncPrivateVaultRotationCoordinatorStatusOK;
  case AncPrivateVaultCustodyRepositoryStatusNotFound:
    return AncPrivateVaultRotationCoordinatorStatusNotFound;
  case AncPrivateVaultCustodyRepositoryStatusInvalid:
    return AncPrivateVaultRotationCoordinatorStatusInvalid;
  case AncPrivateVaultCustodyRepositoryStatusConflict:
    return AncPrivateVaultRotationCoordinatorStatusConflict;
  case AncPrivateVaultCustodyRepositoryStatusRollbackDetected:
    return AncPrivateVaultRotationCoordinatorStatusRollbackDetected;
  case AncPrivateVaultCustodyRepositoryStatusCorrupt:
    return AncPrivateVaultRotationCoordinatorStatusCorrupt;
  case AncPrivateVaultCustodyRepositoryStatusInaccessible:
    return AncPrivateVaultRotationCoordinatorStatusInaccessible;
  case AncPrivateVaultCustodyRepositoryStatusFailed:
    return AncPrivateVaultRotationCoordinatorStatusStorageFailed;
  }
  return AncPrivateVaultRotationCoordinatorStatusCustodyRejected;
}

static AncPrivateVaultRotationCoordinatorResult *
AncRotationCoordinatorMakeResult(
    NSString *vaultId,
    AncPrivateVaultRotationPreparationCheckpoint *preparation,
    AncPrivateVaultAuthorityCheckpoint *authority,
    const AncPrivateVaultCustodySnapshot *custody) {
  if (vaultId == nil || preparation == nil || authority == nil ||
      custody == NULL)
    return nil;
  AncPrivateVaultRotationCoordinatorResult *result =
      class_createInstance(AncPrivateVaultRotationCoordinatorResult.class, 0);
  result.vaultId = [vaultId copy];
  result.preparationCheckpoint = preparation;
  result.authorityCheckpoint = authority;
  result.custodyGeneration = custody->custody_generation;
  result.activeEpoch = custody->active_epoch;
  result.sequence = authority.snapshot.sequence;
  result.headHash = [authority.snapshot.headHash copy];
  result.membershipHash = [authority.snapshot.membershipHash copy];
  result.recoveryGeneration = authority.snapshot.recoveryGeneration;
  result.recoveryWrapHash = [authority.snapshot.recoveryWrapHash copy];
  object_setClass(result,
                  AncPrivateVaultImmutableRotationCoordinatorResult.class);
  return result;
}

@implementation AncPrivateVaultRotationCoordinator

- (instancetype)
    initWithPreparationStore:
        (AncPrivateVaultRotationPreparationStore *)preparationStore
              authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
           custodyRepository:
               (AncPrivateVaultCustodyRepository *)custodyRepository
                  controlLog:(AncPrivateVaultControlLog *)controlLog {
  self = [super init];
  if (self == nil)
    return nil;
  if (!AncRotationCoordinatorHasExactCollaborators(
          preparationStore, authorityStore, custodyRepository, controlLog))
    return nil;
  _preparationStore = preparationStore;
  _authorityStore = authorityStore;
  _custodyRepository = custodyRepository;
  _controlLog = controlLog;
  _trustedClock = [AncPrivateVaultSystemTrustedClock new];
  return self;
}

#if ANC_PRIVATE_VAULT_TESTING
- (instancetype)
    initWithPreparationStore:
        (AncPrivateVaultRotationPreparationStore *)preparationStore
              authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
           custodyRepository:
               (AncPrivateVaultCustodyRepository *)custodyRepository
                  controlLog:(AncPrivateVaultControlLog *)controlLog
                trustedClock:(id<AncPrivateVaultTrustedClock>)trustedClock {
  if (trustedClock == nil)
    return nil;
  self = [self initWithPreparationStore:preparationStore
                         authorityStore:authorityStore
                      custodyRepository:custodyRepository
                             controlLog:controlLog];
  if (self == nil)
    return nil;
  _trustedClock = trustedClock;
  return self;
}
#endif

- (AncPrivateVaultRotationCoordinatorStatus)
    resumeVaultId:(const uint8_t[16])vaultId
            result:(AncPrivateVaultRotationCoordinatorResult **)result {
  if (result != NULL)
    *result = nil;
  if (vaultId == NULL)
    return AncPrivateVaultRotationCoordinatorStatusInvalid;
  NSString *vaultHex = AncRotationCoordinatorHex(
      vaultId, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
  if (vaultHex.length != 32 ||
      ![vaultHex isEqualToString:vaultHex.lowercaseString])
    return AncPrivateVaultRotationCoordinatorStatusInvalid;
  NSRecursiveLock *operationLock =
      AncRotationCoordinatorLockForVault(vaultHex);
  [operationLock lock];
  @try {
    AncPrivateVaultRotationPreparationCheckpoint *preparationCheckpoint = nil;
    AncPrivateVaultRotationPreparationKeyHandle *preparationHandle = nil;
    AncPrivateVaultRotationPreparationStoreStatus preparationStatus =
        [self.preparationStore readVaultId:vaultId
                                checkpoint:&preparationCheckpoint
                                    handle:&preparationHandle];
    if (preparationStatus !=
            AncPrivateVaultRotationPreparationStoreStatusOK ||
        preparationCheckpoint == nil) {
      if (preparationHandle != nil)
        [preparationHandle close];
      return preparationStatus ==
                     AncPrivateVaultRotationPreparationStoreStatusOK
                 ? AncPrivateVaultRotationCoordinatorStatusProtectionFailed
                 : AncRotationCoordinatorStatusForPreparation(
                       preparationStatus);
    }
    AncPrivateVaultRotationPreparationSnapshot preparation =
        preparationCheckpoint.snapshot;
    if (!AncRotationCoordinatorPreparationValid(vaultId, &preparation,
                                                vaultHex)) {
      AncPrivateVaultRotationPreparationStoreStatus closed =
          preparationHandle == nil
              ? AncPrivateVaultRotationPreparationStoreStatusOK
              : [preparationHandle close];
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      return closed == AncPrivateVaultRotationPreparationStoreStatusOK
                 ? AncPrivateVaultRotationCoordinatorStatusInvalid
                 : AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
    }

    if (preparation.phase == ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED) {
      AncPrivateVaultRotationPreparationStoreStatus closed =
          [preparationHandle close];
      if (closed != AncPrivateVaultRotationPreparationStoreStatusOK) {
        anc_pv_rotation_preparation_snapshot_zero(&preparation);
        return AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
      }
      AncPrivateVaultRotationPreparationCheckpoint *consumed = nil;
      preparationStatus = [self.preparationStore
          consumeCommittedVaultId:vaultId
                   authorityStore:self.authorityStore
                custodyRepository:self.custodyRepository
                       checkpoint:&consumed];
      if (preparationStatus !=
          AncPrivateVaultRotationPreparationStoreStatusOK) {
        anc_pv_rotation_preparation_snapshot_zero(&preparation);
        return AncRotationCoordinatorStatusForPreparation(preparationStatus);
      }
      AncPrivateVaultAuthorityCheckpoint *official = nil;
      AncPrivateVaultAuthorityStoreStatus authorityStatus =
          [self.authorityStore loadVaultId:vaultHex
                                checkpoint:&official
                                     error:nil];
      AncPrivateVaultCustodySnapshot custody;
      AncPrivateVaultCustodyHandle *custodyHandle = nil;
      AncPrivateVaultCustodyRepositoryStatus custodyStatus =
          [self.custodyRepository readVaultId:vaultHex
                                     snapshot:&custody
                                       handle:&custodyHandle];
      BOOL valid = authorityStatus == AncPrivateVaultAuthorityStoreStatusOK &&
                   custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
                   custodyHandle != nil &&
                   AncPrivateVaultRotationPreparationOfficialTupleValid(
                       &preparation, vaultHex, official, &custody);
      AncPrivateVaultCustodyRepositoryStatus custodyClosed =
          custodyHandle == nil ? AncPrivateVaultCustodyRepositoryStatusInvalid
                               : [custodyHandle close];
      AncPrivateVaultRotationCoordinatorResult *done =
          valid && custodyClosed == AncPrivateVaultCustodyRepositoryStatusOK
              ? AncRotationCoordinatorMakeResult(vaultHex, consumed, official,
                                                 &custody)
              : nil;
      anc_pv_custody_snapshot_zero(&custody);
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      if (!valid)
        return AncPrivateVaultRotationCoordinatorStatusConflict;
      if (custodyClosed != AncPrivateVaultCustodyRepositoryStatusOK ||
          done == nil)
        return AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
      if (result != NULL)
        *result = done;
      return AncPrivateVaultRotationCoordinatorStatusOK;
    }

    if (preparationHandle == nil) {
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      return AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
    }

    uint64_t nowMilliseconds = 0;
    if (![self.trustedClock readNowMilliseconds:&nowMilliseconds] ||
        nowMilliseconds == 0 ||
        nowMilliseconds > kAncRotationCoordinatorMaximumSafeInteger) {
      AncPrivateVaultRotationPreparationStoreStatus closed =
          [preparationHandle close];
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      return closed == AncPrivateVaultRotationPreparationStoreStatusOK
                 ? AncPrivateVaultRotationCoordinatorStatusClockFailed
                 : AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
    }

    AncPrivateVaultAuthorityCheckpoint *currentAuthority = nil;
    NSError *authorityError = nil;
    AncPrivateVaultAuthorityStoreStatus authorityStatus =
        [self.authorityStore loadVaultId:vaultHex
                              checkpoint:&currentAuthority
                                   error:&authorityError];
    if (authorityStatus != AncPrivateVaultAuthorityStoreStatusOK ||
        currentAuthority == nil || authorityError != nil) {
      AncPrivateVaultRotationPreparationStoreStatus closed =
          [preparationHandle close];
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      return closed == AncPrivateVaultRotationPreparationStoreStatusOK
                 ? AncRotationCoordinatorStatusForAuthority(authorityStatus)
                 : AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
    }
    if (nowMilliseconds < currentAuthority.snapshot.verifiedAtMs) {
      AncPrivateVaultRotationPreparationStoreStatus closed =
          [preparationHandle close];
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      return closed == AncPrivateVaultRotationPreparationStoreStatusOK
                 ? AncPrivateVaultRotationCoordinatorStatusClockFailed
                 : AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
    }

    BOOL basePath = currentAuthority.custodyGeneration ==
                    preparation.base_custody_generation;
    BOOL retryPath =
        currentAuthority.custodyGeneration ==
        preparation.base_custody_generation + 1;
    if (!basePath && !retryPath) {
      AncPrivateVaultRotationPreparationStoreStatus closed =
          [preparationHandle close];
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      return closed == AncPrivateVaultRotationPreparationStoreStatusOK
                 ? (currentAuthority.custodyGeneration <
                            preparation.base_custody_generation
                        ? AncPrivateVaultRotationCoordinatorStatusRollbackDetected
                        : AncPrivateVaultRotationCoordinatorStatusConflict)
                 : AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
    }

    if (basePath) {
      AncPrivateVaultCustodySnapshot baseCustody;
      AncPrivateVaultCustodyHandle *baseCustodyHandle = nil;
      AncPrivateVaultCustodyRepositoryStatus custodyStatus =
          [self.custodyRepository readVaultId:vaultHex
                                     snapshot:&baseCustody
                                       handle:&baseCustodyHandle];
      BOOL valid = custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
                   baseCustodyHandle != nil &&
                   AncRotationCoordinatorBaseTupleValid(
                       &preparation, vaultHex, currentAuthority, &baseCustody);
      AncPrivateVaultCustodyRepositoryStatus baseClosed =
          baseCustodyHandle == nil
              ? AncPrivateVaultCustodyRepositoryStatusInvalid
              : [baseCustodyHandle close];
      anc_pv_custody_snapshot_zero(&baseCustody);
      if (!valid || baseClosed != AncPrivateVaultCustodyRepositoryStatusOK) {
        AncPrivateVaultRotationPreparationStoreStatus closed =
            [preparationHandle close];
        anc_pv_rotation_preparation_snapshot_zero(&preparation);
        if (closed != AncPrivateVaultRotationPreparationStoreStatusOK ||
            baseClosed != AncPrivateVaultCustodyRepositoryStatusOK)
          return AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
        return valid ? AncRotationCoordinatorStatusForCustody(baseClosed)
                     : AncPrivateVaultRotationCoordinatorStatusConflict;
      }
    } else {
      AncPrivateVaultCustodySnapshot successorCustody;
      AncPrivateVaultCustodyHandle *successorHandle = nil;
      AncPrivateVaultCustodyRepositoryStatus custodyStatus =
          [self.custodyRepository readVaultId:vaultHex
                                     snapshot:&successorCustody
                                       handle:&successorHandle];
      BOOL valid = custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
                   successorHandle != nil &&
                   AncPrivateVaultRotationPreparationOfficialTupleValid(
                       &preparation, vaultHex, currentAuthority,
                       &successorCustody);
      AncPrivateVaultCustodyRepositoryStatus successorClosed =
          successorHandle == nil
              ? AncPrivateVaultCustodyRepositoryStatusInvalid
              : [successorHandle close];
      anc_pv_custody_snapshot_zero(&successorCustody);
      if (!valid ||
          successorClosed != AncPrivateVaultCustodyRepositoryStatusOK) {
        AncPrivateVaultRotationPreparationStoreStatus closed =
            [preparationHandle close];
        anc_pv_rotation_preparation_snapshot_zero(&preparation);
        return closed != AncPrivateVaultRotationPreparationStoreStatusOK ||
                       successorClosed !=
                           AncPrivateVaultCustodyRepositoryStatusOK
                   ? AncPrivateVaultRotationCoordinatorStatusProtectionFailed
                   : AncPrivateVaultRotationCoordinatorStatusConflict;
      }
    }

    __block BOOL artifactsInspected = NO;
    __block BOOL artifactsVerified = NO;
    __block AncPrivateVaultControlLogReplayResult *replayResult = nil;
    __block NSData *artifactEntryHash = nil;
    NSString *preparationCeremony = AncRotationCoordinatorHex(
        preparation.ceremony_id, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
    AncPrivateVaultRotationPreparationStoreStatus artifactStatus =
        [self.preparationStore
            consumeAwaitingArtifactsVaultId:vaultId
                       expectedCheckpoint:preparationCheckpoint
                                 consumer:^BOOL(
                                     const uint8_t *signedEntry,
                                     size_t signedEntryLength,
                                     const uint8_t *recoveryWrap,
                                     size_t recoveryWrapLength) {
      @autoreleasepool {
        artifactsInspected = YES;
        NSData *signedData =
            [NSData dataWithBytesNoCopy:(void *)signedEntry
                                 length:signedEntryLength
                           freeWhenDone:NO];
        NSData *wrapData =
            [NSData dataWithBytesNoCopy:(void *)recoveryWrap
                                 length:recoveryWrapLength
                           freeWhenDone:NO];
        artifactEntryHash =
            AncPrivateVaultControlLogSignedEntryDomainHash(signedData);
        if (artifactEntryHash.length != 32)
          return NO;
        if (basePath) {
          AncPrivateVaultControlLogState *currentState =
              AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(
                  currentAuthority);
          AncPrivateVaultRecoveryWrapRotationVerifier *verifier =
              [[AncPrivateVaultRecoveryWrapRotationVerifier alloc]
                  initWithEncodedWrap:wrapData
                      trustedNowMilliseconds:nowMilliseconds];
          if (currentState == nil || verifier == nil)
            return NO;
          AncPrivateVaultControlLogStatus replayStatus = [self.controlLog
              replaySignedEntry:signedData
                   currentState:currentState
                       verifier:verifier
                         result:&replayResult];
          AncPrivateVaultControlLogState *prior = nil;
          AncPrivateVaultControlLogState *next = nil;
          NSData *registeredEntryHash = nil;
          BOOL idempotent = YES;
          BOOL evidence =
              replayStatus == AncPrivateVaultControlLogStatusOK &&
              replayResult != nil && verifier.isVerified &&
              AncPrivateVaultControlLogReplayResultCopyEvidence(
                  replayResult, &prior, &next, &registeredEntryHash,
                  &idempotent);
          artifactsVerified =
              evidence && !idempotent && prior != nil && next != nil &&
              [registeredEntryHash isEqualToData:artifactEntryHash] &&
              next.sequence == preparation.expected_sequence &&
              [next.headHash isEqualToData:artifactEntryHash] &&
              AncRotationCoordinatorBytesEqualData(
                  preparation.expected_previous_head, prior.headHash, 32) &&
              next.epoch == preparation.pending_epoch &&
              next.recoveryGeneration ==
                  preparation.base_recovery_generation &&
              AncRotationCoordinatorBytesEqualData(
                  preparation.transcript_digest, next.membershipHash, 32) &&
              [verifier.verifiedWrapHash
                  isEqualToData:next.recoveryWrapHash] &&
              [verifier.verifiedCeremonyId
                  isEqualToString:preparationCeremony];
        } else {
          AncPrivateVaultControlLogState *successorState =
              AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(
                  currentAuthority);
          NSData *wrapHash = nil;
          NSString *wrapCeremony = nil;
          artifactsVerified =
              successorState != nil &&
              [artifactEntryHash
                  isEqualToData:currentAuthority.snapshot.headHash] &&
              AncPrivateVaultRecoveryWrapVerifyCommittedSuccessor(
                  wrapData, successorState, nowMilliseconds, &wrapHash,
                  &wrapCeremony) &&
              [wrapHash
                  isEqualToData:currentAuthority.snapshot.recoveryWrapHash] &&
              [wrapCeremony isEqualToString:preparationCeremony];
        }
        return artifactsVerified;
      }
    }];
    if (artifactStatus !=
            AncPrivateVaultRotationPreparationStoreStatusOK ||
        !artifactsVerified) {
      AncPrivateVaultRotationPreparationStoreStatus closed =
          [preparationHandle close];
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      return closed != AncPrivateVaultRotationPreparationStoreStatusOK
                 ? AncPrivateVaultRotationCoordinatorStatusProtectionFailed
                 : artifactsInspected && !artifactsVerified
                       ? retryPath
                             ? AncPrivateVaultRotationCoordinatorStatusRecoveryWrapRejected
                             : AncPrivateVaultRotationCoordinatorStatusControlRejected
                 : artifactStatus !=
                           AncPrivateVaultRotationPreparationStoreStatusOK
                       ? AncRotationCoordinatorStatusForPreparation(
                             artifactStatus)
                       : AncPrivateVaultRotationCoordinatorStatusControlRejected;
    }
    if (AncRotationCoordinatorFault(
            AncPrivateVaultRotationCoordinatorFaultAfterArtifactAuthentication)) {
      AncPrivateVaultRotationPreparationStoreStatus closed =
          [preparationHandle close];
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      return closed == AncPrivateVaultRotationPreparationStoreStatusOK
                 ? AncPrivateVaultRotationCoordinatorStatusStorageFailed
                 : AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
    }

    if (basePath) {
      AncPrivateVaultVerifiedReplayResult *verified =
          AncPrivateVaultVerifiedReplayResultCreate(
              replayResult, currentAuthority,
              preparation.base_custody_generation + 1, nowMilliseconds,
              AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch);
      if (verified == nil) {
        AncPrivateVaultRotationPreparationStoreStatus closed =
            [preparationHandle close];
        anc_pv_rotation_preparation_snapshot_zero(&preparation);
        return closed == AncPrivateVaultRotationPreparationStoreStatusOK
                   ? AncPrivateVaultRotationCoordinatorStatusAuthorityRejected
                   : AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
      }
      AncPrivateVaultAuthorityCheckpoint *committed = nil;
      authorityStatus = [self.authorityStore
          commitVerifiedReplayResult:verified
                             vaultId:vaultHex
                        verifiedAtMs:nowMilliseconds
                          checkpoint:&committed
                               error:&authorityError];
      if (authorityStatus != AncPrivateVaultAuthorityStoreStatusOK ||
          committed == nil || authorityError != nil) {
        AncPrivateVaultRotationPreparationStoreStatus closed =
            [preparationHandle close];
        anc_pv_rotation_preparation_snapshot_zero(&preparation);
        return closed == AncPrivateVaultRotationPreparationStoreStatusOK
                   ? AncRotationCoordinatorStatusForAuthority(authorityStatus)
                   : AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
      }
      currentAuthority = committed;
      if (AncRotationCoordinatorFault(
              AncPrivateVaultRotationCoordinatorFaultAfterAuthorityCommit)) {
        AncPrivateVaultRotationPreparationStoreStatus closed =
            [preparationHandle close];
        anc_pv_rotation_preparation_snapshot_zero(&preparation);
        return closed == AncPrivateVaultRotationPreparationStoreStatusOK
                   ? AncPrivateVaultRotationCoordinatorStatusStorageFailed
                   : AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
      }
    }
    if (AncRotationCoordinatorFault(
            AncPrivateVaultRotationCoordinatorFaultBeforeOfficialReread)) {
      AncPrivateVaultRotationPreparationStoreStatus closed =
          [preparationHandle close];
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      return closed == AncPrivateVaultRotationPreparationStoreStatusOK
                 ? AncPrivateVaultRotationCoordinatorStatusStorageFailed
                 : AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
    }

    AncPrivateVaultAuthorityCheckpoint *officialAuthority = nil;
    authorityError = nil;
    authorityStatus = [self.authorityStore loadVaultId:vaultHex
                                            checkpoint:&officialAuthority
                                                 error:&authorityError];
    AncPrivateVaultCustodySnapshot officialCustody;
    AncPrivateVaultCustodyHandle *officialCustodyHandle = nil;
    AncPrivateVaultCustodyRepositoryStatus officialCustodyStatus =
        [self.custodyRepository readVaultId:vaultHex
                                   snapshot:&officialCustody
                                     handle:&officialCustodyHandle];
    BOOL officialValid =
        authorityStatus == AncPrivateVaultAuthorityStoreStatusOK &&
        authorityError == nil && officialAuthority != nil &&
        officialCustodyStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
        officialCustodyHandle != nil &&
        AncPrivateVaultRotationPreparationOfficialTupleValid(
            &preparation, vaultHex, officialAuthority, &officialCustody) &&
        [artifactEntryHash isEqualToData:officialAuthority.snapshot.headHash];
    __block BOOL keyMatches = NO;
    __block AncPrivateVaultCustodyRepositoryStatus officialBorrow =
        AncPrivateVaultCustodyRepositoryStatusInvalid;
    if (officialValid) {
      preparationStatus =
          [preparationHandle borrow:^BOOL(const uint8_t *pendingKey) {
        officialBorrow = [officialCustodyHandle
            borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
              keyMatches = anc_pv_memcmp(pendingKey, secrets->active_epoch_key,
                                        ANC_PV_KEY_BYTES) == ANC_PV_CRYPTO_OK;
              return keyMatches;
            }];
        return officialBorrow == AncPrivateVaultCustodyRepositoryStatusOK &&
               keyMatches;
      }];
      officialValid =
          preparationStatus ==
              AncPrivateVaultRotationPreparationStoreStatusOK &&
          officialBorrow == AncPrivateVaultCustodyRepositoryStatusOK &&
          keyMatches;
    }
    AncPrivateVaultCustodyRepositoryStatus officialClosed =
        officialCustodyHandle == nil
            ? AncPrivateVaultCustodyRepositoryStatusInvalid
            : [officialCustodyHandle close];
    AncPrivateVaultRotationPreparationStoreStatus preparationClosed =
        [preparationHandle close];
    if (!officialValid ||
        officialClosed != AncPrivateVaultCustodyRepositoryStatusOK ||
        preparationClosed != AncPrivateVaultRotationPreparationStoreStatusOK) {
      anc_pv_custody_snapshot_zero(&officialCustody);
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      return officialClosed != AncPrivateVaultCustodyRepositoryStatusOK ||
                     preparationClosed !=
                         AncPrivateVaultRotationPreparationStoreStatusOK
                 ? AncPrivateVaultRotationCoordinatorStatusProtectionFailed
                 : AncPrivateVaultRotationCoordinatorStatusConflict;
    }
    if (AncRotationCoordinatorFault(
            AncPrivateVaultRotationCoordinatorFaultBeforePreparationConsume)) {
      anc_pv_custody_snapshot_zero(&officialCustody);
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      return AncPrivateVaultRotationCoordinatorStatusStorageFailed;
    }

    AncPrivateVaultRotationPreparationCheckpoint *consumed = nil;
    preparationStatus = [self.preparationStore
        consumeCommittedVaultId:vaultId
                 authorityStore:self.authorityStore
              custodyRepository:self.custodyRepository
                     checkpoint:&consumed];
    if (preparationStatus !=
            AncPrivateVaultRotationPreparationStoreStatusOK ||
        consumed == nil) {
      anc_pv_custody_snapshot_zero(&officialCustody);
      anc_pv_rotation_preparation_snapshot_zero(&preparation);
      return AncRotationCoordinatorStatusForPreparation(preparationStatus);
    }
    AncPrivateVaultRotationCoordinatorResult *done =
        AncRotationCoordinatorMakeResult(vaultHex, consumed, officialAuthority,
                                         &officialCustody);
    anc_pv_custody_snapshot_zero(&officialCustody);
    anc_pv_rotation_preparation_snapshot_zero(&preparation);
    if (done == nil)
      return AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
    if (result != NULL)
      *result = done;
    return AncPrivateVaultRotationCoordinatorStatusOK;
  } @catch (__unused NSException *exception) {
    return AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
  } @finally {
    [operationLock unlock];
  }
}

- (AncPrivateVaultRotationCoordinatorStatus)
    finalizeHostedAppendVaultId:(const uint8_t[16])vaultId
                         receipt:(NSData *)receiptBytes
                          result:
                              (AncPrivateVaultRotationCoordinatorResult **)result {
  if (result != NULL)
    *result = nil;
  NSData *canonicalReceipt = [receiptBytes copy];
  AncPrivateVaultRotationAppendReceipt *receipt =
      AncPrivateVaultRotationAppendReceiptDecode(canonicalReceipt);
  if (vaultId == NULL || canonicalReceipt == nil || receipt == nil)
    return AncPrivateVaultRotationCoordinatorStatusInvalid;
  NSString *vaultHex = AncRotationCoordinatorHex(
      vaultId, ANC_PV_ROTATION_PREPARATION_ID_BYTES);
  NSRecursiveLock *operationLock =
      AncRotationCoordinatorLockForVault(vaultHex);
  [operationLock lock];
  @try {
    AncPrivateVaultRotationPreparationCheckpoint *cleaned = nil;
    AncPrivateVaultRotationPreparationStoreStatus preparationStatus =
        [self.preparationStore
                  cleanConsumedVaultId:vaultId
                                receipt:canonicalReceipt
                       authorityStore:self.authorityStore
                    custodyRepository:self.custodyRepository
                           checkpoint:&cleaned];
    if (preparationStatus !=
            AncPrivateVaultRotationPreparationStoreStatusOK ||
        cleaned == nil ||
        cleaned.snapshot.phase !=
            ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED)
      return preparationStatus ==
                     AncPrivateVaultRotationPreparationStoreStatusOK
                 ? AncPrivateVaultRotationCoordinatorStatusProtectionFailed
                 : AncRotationCoordinatorStatusForPreparation(
                       preparationStatus);

    AncPrivateVaultAuthorityCheckpoint *authority = nil;
    NSError *authorityError = nil;
    AncPrivateVaultAuthorityStoreStatus authorityStatus =
        [self.authorityStore loadVaultId:vaultHex
                              checkpoint:&authority
                                   error:&authorityError];
    AncPrivateVaultCustodySnapshot custody = {0};
    AncPrivateVaultCustodyHandle *custodyHandle = nil;
    AncPrivateVaultCustodyRepositoryStatus custodyStatus =
        [self.custodyRepository readVaultId:vaultHex
                                   snapshot:&custody
                                     handle:&custodyHandle];
    BOOL valid = authorityStatus == AncPrivateVaultAuthorityStoreStatusOK &&
                 authorityError == nil && authority != nil &&
                 [authority.vaultId isEqualToString:receipt.vaultId] &&
                 authority.snapshot.sequence == receipt.sequence &&
                 [authority.snapshot.headHash isEqualToData:receipt.headHash] &&
                 [authority.snapshot.recoveryWrapHash
                     isEqualToData:receipt.recoveryWrapHash] &&
                 custodyStatus == AncPrivateVaultCustodyRepositoryStatusOK &&
                 custodyHandle != nil &&
                 custody.custody_generation ==
                     authority.custodyGeneration &&
                 custody.anchored_sequence == receipt.sequence &&
                 AncRotationCoordinatorBytesEqualData(
                     custody.anchored_head, receipt.headHash, 32);
    AncPrivateVaultCustodyRepositoryStatus closed =
        custodyHandle == nil ? AncPrivateVaultCustodyRepositoryStatusInvalid
                             : [custodyHandle close];
    AncPrivateVaultRotationCoordinatorResult *done =
        valid && closed == AncPrivateVaultCustodyRepositoryStatusOK
            ? AncRotationCoordinatorMakeResult(vaultHex, cleaned, authority,
                                               &custody)
            : nil;
    anc_pv_custody_snapshot_zero(&custody);
    if (!valid)
      return AncPrivateVaultRotationCoordinatorStatusConflict;
    if (closed != AncPrivateVaultCustodyRepositoryStatusOK || done == nil)
      return AncPrivateVaultRotationCoordinatorStatusProtectionFailed;
    if (result != NULL)
      *result = done;
    return AncPrivateVaultRotationCoordinatorStatusOK;
  } @finally {
    [operationLock unlock];
  }
}

@end
