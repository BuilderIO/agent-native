#import "PrivateVaultGenesisCoordinator.h"

#import "PrivateVaultAuthorityStoreInternal.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultGenesisAuthorization.h"
#import "PrivateVaultGenesisAuthorizationInternal.h"
#import "PrivateVaultGenesisBootstrap.h"
#import "PrivateVaultGenesisCoordinatorInternal.h"

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

static NSArray<NSRecursiveLock *> *CoordinatorLocks(void) {
  static NSArray *locks;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSMutableArray *values = [NSMutableArray arrayWithCapacity:64];
    for (NSUInteger i = 0; i < 64; i++)
      [values addObject:[NSRecursiveLock new]];
    locks = [values copy];
  });
  return locks;
}
static NSRecursiveLock *CoordinatorLock(NSString *vaultId) {
  NSData *data = [vaultId dataUsingEncoding:NSASCIIStringEncoding];
  const uint8_t *p = data.bytes;
  uint64_t hash = UINT64_C(1469598103934665603);
  for (NSUInteger i = 0; i < data.length; i++) {
    hash ^= p[i];
    hash *= UINT64_C(1099511628211);
  }
  return CoordinatorLocks()[hash % 64];
}
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

@interface AncPrivateVaultGenesisCoordinator ()
@property(nonatomic) AncPrivateVaultGenesisArtifactStore *artifactStore;
@property(nonatomic) AncPrivateVaultAuthorityStore *authorityStore;
@property(nonatomic) AncPrivateVaultCustodyRepository *custodyRepository;
@property(nonatomic) AncPrivateVaultControlLog *controlLog;
@property(nonatomic) id<AncPrivateVaultGenesisTrustedClock> trustedClock;
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
  NSRecursiveLock *lock = CoordinatorLock(vaultHex);
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
  NSRecursiveLock *lock = CoordinatorLock(vaultHex);
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
