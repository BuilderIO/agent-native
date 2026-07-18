#import "PrivateVaultRecoveryCoordinator.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultAuthorityStoreInternal.h"
#import "PrivateVaultBootstrapReplay.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultCustodyRepositoryRecoveryInternal.h"
#import "PrivateVaultEndpointRequest.h"
#import "PrivateVaultGenesisHostedAppend.h"
#import "PrivateVaultGenesisPreparationArtifactStore.h"
#import "PrivateVaultHostedAppendRetryStore.h"
#import "PrivateVaultHostedAppendTransport.h"
#import "PrivateVaultRecoveryBuilder.h"
#import "PrivateVaultRecoveryBuilderInternal.h"
#import "PrivateVaultRecoveryPreparationStore.h"
#import "PrivateVaultRecoveryPreparationStoreInternal.h"

#include <math.h>

static NSString *Hex(NSData *data) {
  if (![data isKindOfClass:NSData.class])
    return nil;
  static const char digits[] = "0123456789abcdef";
  NSMutableData *encoded = [NSMutableData dataWithLength:data.length * 2];
  const uint8_t *input = data.bytes;
  uint8_t *output = encoded.mutableBytes;
  for (NSUInteger index = 0; index < data.length; index += 1) {
    output[index * 2] = digits[input[index] >> 4];
    output[index * 2 + 1] = digits[input[index] & 15];
  }
  return [[NSString alloc] initWithData:encoded
                               encoding:NSASCIIStringEncoding];
}
static NSData *RandomData(NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  return anc_pv_random(data.mutableBytes, data.length) == ANC_PV_CRYPTO_OK
             ? data
             : nil;
}
static AncPrivateVaultGuardedMemory *RandomGuarded(NSUInteger length) {
  AncPrivateVaultGuardedMemoryStatus status;
  AncPrivateVaultGuardedMemory *memory =
      [AncPrivateVaultGuardedMemory memoryWithLength:length status:&status];
  if (memory == nil)
    return nil;
  __block BOOL generated = NO;
  if ([memory borrow:^BOOL(uint8_t *bytes, size_t count) {
        generated = count == length &&
                    anc_pv_random(bytes, count) == ANC_PV_CRYPTO_OK;
        return generated;
      }] != AncPrivateVaultGuardedMemoryStatusOK ||
      !generated) {
    [memory close];
    return nil;
  }
  return memory;
}
static NSData *SnapshotBundle(NSData *currentSnapshot,
                              NSData *currentStateSnapshot) {
  if (currentSnapshot.length == 0 || currentStateSnapshot.length == 0)
    return nil;
  AncPrivateVaultCanonicalStatus status;
  NSData *encoded = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue bytes:currentSnapshot],
        @2 : [AncPrivateVaultCanonicalValue bytes:currentStateSnapshot],
      }],
      &status);
  return encoded.length <=
                 ANC_PV_GENESIS_PREPARATION_ARTIFACT_BOOTSTRAP_MAX_BYTES
             ? encoded
             : nil;
}
static BOOL DecodeSnapshotBundle(NSData *encoded, NSData **currentSnapshot,
                                 NSData **currentStateSnapshot) {
  if (currentSnapshot == NULL || currentStateSnapshot == NULL)
    return NO;
  *currentSnapshot = nil;
  *currentStateSnapshot = nil;
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      encoded, ANC_PV_GENESIS_PREPARATION_ARTIFACT_BOOTSTRAP_MAX_BYTES,
      &status);
  if (root.type != AncPrivateVaultCanonicalTypeMap ||
      root.mapValue.count != 2 ||
      root.mapValue[@1].type != AncPrivateVaultCanonicalTypeBytes ||
      root.mapValue[@2].type != AncPrivateVaultCanonicalTypeBytes ||
      root.mapValue[@1].bytesValue.length == 0 ||
      root.mapValue[@2].bytesValue.length == 0)
    return NO;
  NSData *roundTrip = AncPrivateVaultCanonicalEncode(root, &status);
  if (![roundTrip isEqualToData:encoded])
    return NO;
  *currentSnapshot = [root.mapValue[@1].bytesValue copy];
  *currentStateSnapshot = [root.mapValue[@2].bytesValue copy];
  return YES;
}
static NSString *IssuedAt(void) {
  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  formatter.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                            NSISO8601DateFormatWithFractionalSeconds;
  return [formatter stringFromDate:NSDate.date];
}

@interface AncPrivateVaultRecoveryCoordinator ()
@property(nonatomic) AncPrivateVaultRecoveryPreparationStore *preparationStore;
@property(nonatomic)
    AncPrivateVaultGenesisPreparationArtifactStore *artifactStore;
@property(nonatomic) AncPrivateVaultHostedAppendRetryStore *retryStore;
@property(nonatomic) AncPrivateVaultCustodyRepository *custodyRepository;
@property(nonatomic) AncPrivateVaultAuthorityStore *authorityStore;
@property(nonatomic) AncPrivateVaultHostedAppendTransport *transport;
@property(nonatomic) dispatch_queue_t queue;
@end

@implementation AncPrivateVaultRecoveryCoordinator
- (instancetype)
    initWithPreparationStore:
        (AncPrivateVaultRecoveryPreparationStore *)preparationStore
              artifactStore:
                  (AncPrivateVaultGenesisPreparationArtifactStore *)artifactStore
                 retryStore:
                     (AncPrivateVaultHostedAppendRetryStore *)retryStore
          custodyRepository:
              (AncPrivateVaultCustodyRepository *)custodyRepository
              authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
                   transport:
                       (AncPrivateVaultHostedAppendTransport *)transport {
  self = [super init];
  if (self != nil) {
    if (preparationStore == nil || artifactStore == nil || retryStore == nil ||
        custodyRepository == nil || authorityStore == nil || transport == nil)
      return nil;
    _preparationStore = preparationStore;
    _artifactStore = artifactStore;
    _retryStore = retryStore;
    _custodyRepository = custodyRepository;
    _authorityStore = authorityStore;
    _transport = transport;
    _queue = dispatch_queue_create(
        "com.agentnative.private-vault.recovery-coordinator",
        DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (void)finish:(AncPrivateVaultRecoveryCoordinatorCompletion)completion
         status:(AncPrivateVaultRecoveryCoordinatorStatus)status
        vaultId:(NSString *)vaultId {
  if (completion != nil)
    completion(status, vaultId ?: @"");
}

- (BOOL)cleanupSnapshot:
            (const AncPrivateVaultRecoveryPreparationSnapshot *)snapshot
                  vaultId:(NSString *)vaultId {
  AncPrivateVaultGenesisPreparationArtifactStatus artifact =
      [self.artifactStore deleteLiveLookupId:snapshot->lookup_id
                              expectedDigest:snapshot->artifact_digest];
  if (artifact != AncPrivateVaultGenesisPreparationArtifactStatusOK &&
      artifact != AncPrivateVaultGenesisPreparationArtifactStatusNotFound)
    return NO;
  if ([self.preparationStore deleteVaultId:vaultId] !=
      AncPrivateVaultRecoveryPreparationStoreStatusOK)
    return NO;
  return [self.retryStore removeVaultId:snapshot->vault_id] ==
         AncPrivateVaultHostedAppendRetryStoreStatusOK;
}

- (void)resumeEvidence:(AncPrivateVaultRecoveryPreparationEvidence *)evidence
                handle:
                    (AncPrivateVaultRecoveryPreparationSecretsHandle *)handle
               vaultId:(NSString *)vaultId
            completion:(AncPrivateVaultRecoveryCoordinatorCompletion)completion {
  AncPrivateVaultRecoveryPreparationSnapshot snapshot = {0};
  if (!AncPrivateVaultRecoveryPreparationEvidenceCopySnapshot(evidence,
                                                              &snapshot)) {
    [handle close];
    [self finish:completion
           status:AncPrivateVaultRecoveryCoordinatorStatusVerificationFailed
          vaultId:vaultId];
    return;
  }
  NSData *snapshotData = [NSData dataWithBytes:&snapshot length:sizeof snapshot];
  anc_pv_zeroize(&snapshot, sizeof snapshot);
  const AncPrivateVaultRecoveryPreparationSnapshot *snapshotValue =
      snapshotData.bytes;
  AncPrivateVaultAuthorityCheckpoint *official = nil;
  AncPrivateVaultAuthorityStoreStatus officialStatus =
      [self.authorityStore loadVaultId:vaultId
                            checkpoint:&official
                                 error:nil];
  if (officialStatus == AncPrivateVaultAuthorityStoreStatusOK) {
    BOOL exact = official.snapshot.sequence ==
                     snapshotValue->expected_next_sequence &&
                 anc_pv_memcmp(official.snapshot.headHash.bytes,
                               snapshotValue->entry_hash, 32) ==
                     ANC_PV_CRYPTO_OK;
    [handle close];
    BOOL cleaned =
        exact && [self cleanupSnapshot:snapshotValue vaultId:vaultId];
    [self finish:completion
           status:cleaned ? AncPrivateVaultRecoveryCoordinatorStatusOK
                          : AncPrivateVaultRecoveryCoordinatorStatusConflict
          vaultId:vaultId];
    return;
  }
  AncPrivateVaultGenesisPreparationArtifactStatus reconciled =
      [self.artifactStore reconcileLookupId:snapshotValue->lookup_id
                             expectedDigest:snapshotValue->artifact_digest];
  if (reconciled != AncPrivateVaultGenesisPreparationArtifactStatusOK) {
    [handle close];
    [self finish:completion
           status:AncPrivateVaultRecoveryCoordinatorStatusStorageFailed
          vaultId:vaultId];
    return;
  }
  __block NSData *signedEntry = nil, *recoveryWrap = nil,
                   *snapshotBundle = nil, *authorization = nil;
  AncPrivateVaultGenesisPreparationArtifactStatus read =
      [self.artifactStore
          readLiveLookupId:snapshotValue->lookup_id
                   vaultId:snapshotValue->vault_id
                ceremonyId:snapshotValue->ceremony_id
                generation:snapshotValue->replacement_recovery_generation
            expectedDigest:snapshotValue->artifact_digest
                  consumer:^(const uint8_t *wrap, size_t wrapLength,
                             const uint8_t *entry, size_t entryLength,
                             const uint8_t *bundle, size_t bundleLength,
                             const uint8_t *auth, size_t authLength) {
                    recoveryWrap = [NSData dataWithBytes:wrap
                                                   length:wrapLength];
                    signedEntry = [NSData dataWithBytes:entry
                                                 length:entryLength];
                    snapshotBundle = [NSData dataWithBytes:bundle
                                                    length:bundleLength];
                    authorization = [NSData dataWithBytes:auth
                                                   length:authLength];
                    return YES;
                  }];
  NSData *currentSnapshot = nil, *currentStateSnapshot = nil;
  BOOL bundleOK = DecodeSnapshotBundle(snapshotBundle, &currentSnapshot,
                                       &currentStateSnapshot);
  AncPrivateVaultPreparedRecoveryArtifacts *artifacts =
      read == AncPrivateVaultGenesisPreparationArtifactStatusOK && bundleOK
          ? AncPrivateVaultRestorePreparedRecoveryArtifacts(
                evidence, signedEntry, recoveryWrap, currentSnapshot,
                currentStateSnapshot, authorization)
          : nil;
  __block AncPrivateVaultEndpointRequestStatus requestStatus;
  NSData *body = artifacts == nil
                     ? nil
                     : AncPrivateVaultControlLogRecoveryAppendRequestEncode(
                           artifacts.signedEntry, artifacts.recoveryWrap,
                           artifacts.currentSnapshot,
                           artifacts.recoveryAuthorization, &requestStatus);
  __block NSString *proof = nil;
  __block AncPrivateVaultCustodyRepositoryStatus custodyStatus =
      AncPrivateVaultCustodyRepositoryStatusFailed;
  AncPrivateVaultRecoveryPreparationStoreStatus borrowed =
      artifacts == nil || body == nil
          ? AncPrivateVaultRecoveryPreparationStoreStatusCorrupt
          : [handle
                borrow:^BOOL(
                    const AncPrivateVaultRecoveryPreparationSecretInputs *secrets) {
                  const AncPrivateVaultRecoveryPreparationSnapshot *borrowSnapshot =
                      snapshotData.bytes;
                  uint8_t signingPublic[32] = {0}, signingPrivate[64] = {0};
                  uint8_t boxPublic[32] = {0}, boxPrivate[32] = {0};
                  BOOL keys = anc_pv_ed25519_seed_keypair(
                                  signingPublic, signingPrivate,
                                  secrets->endpoint_signing_seed) ==
                                  ANC_PV_CRYPTO_OK &&
                              anc_pv_box_seed_keypair(
                                  boxPublic, boxPrivate,
                                  secrets->endpoint_box_seed) ==
                                  ANC_PV_CRYPTO_OK;
                  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
                  anc_pv_zeroize(boxPrivate, sizeof boxPrivate);
                  NSData *signing =
                      [NSData dataWithBytes:signingPublic length:32];
                  NSData *agreement =
                      [NSData dataWithBytes:boxPublic length:32];
                  anc_pv_zeroize(signingPublic, sizeof signingPublic);
                  anc_pv_zeroize(boxPublic, sizeof boxPublic);
                  if (!keys ||
                      anc_pv_memcmp(signing.bytes,
                                    borrowSnapshot
                                        ->candidate_signing_public_key,
                                    32) != ANC_PV_CRYPTO_OK ||
                      anc_pv_memcmp(
                          agreement.bytes,
                          borrowSnapshot
                              ->candidate_key_agreement_public_key,
                          32) != ANC_PV_CRYPTO_OK)
                    return NO;
                  uint8_t zero[32] = {0};
                  AncPrivateVaultCustodySecretInputs custodySecrets = {
                      .signing_seed = secrets->endpoint_signing_seed,
                      .box_seed = secrets->endpoint_box_seed,
                      .local_state_key = secrets->local_state_key,
                      .active_epoch_key = zero,
                      .pending_epoch_key = secrets->eek,
                  };
                  custodyStatus = [self.custodyRepository
                      installPendingRecoveryVaultId:vaultId
                                          endpointId:
                                              Hex([NSData
                                                  dataWithBytes:borrowSnapshot
                                                                    ->candidate_endpoint_id
                                                         length:16])
                                          ceremonyId:
                                              Hex([NSData
                                                  dataWithBytes:borrowSnapshot
                                                                    ->ceremony_id
                                                         length:16])
                                     signingPublicKey:signing
                                          boxPublicKey:agreement
                                            nextEpoch:borrowSnapshot->next_epoch
                            replacementRecoveryGeneration:
                                borrowSnapshot
                                    ->replacement_recovery_generation
                                    expectedNextSequence:
                                        borrowSnapshot->expected_next_sequence
                                     expectedPreviousHead:
                                         [NSData
                                             dataWithBytes:borrowSnapshot
                                                               ->expected_previous_head
                                                    length:32]
                               recoveryAuthorizationHash:
                                   [NSData
                                       dataWithBytes:borrowSnapshot
                                                         ->recovery_authorization_hash
                                              length:32]
                                             secrets:&custodySecrets
                                          checkpoint:nil];
                  anc_pv_zeroize(zero, sizeof zero);
                  NSData *nonce = RandomData(16);
                  proof = custodyStatus ==
                                  AncPrivateVaultCustodyRepositoryStatusOK
                              ? AncPrivateVaultControlLogAppendProofHeaderCreate(
                                    vaultId,
                                    Hex([NSData
                                        dataWithBytes:borrowSnapshot
                                                          ->candidate_endpoint_id
                                               length:16]),
                                    body, IssuedAt(), Hex(nonce),
                                    secrets->endpoint_signing_seed, signing,
                                    &requestStatus)
                              : nil;
                  return proof.length > 0;
                }];
  AncPrivateVaultRecoveryPreparationStoreStatus closed = [handle close];
  if (borrowed != AncPrivateVaultRecoveryPreparationStoreStatusOK ||
      closed != AncPrivateVaultRecoveryPreparationStoreStatusOK ||
      custodyStatus != AncPrivateVaultCustodyRepositoryStatusOK ||
      proof.length == 0) {
    [self finish:completion
           status:AncPrivateVaultRecoveryCoordinatorStatusProtectionFailed
          vaultId:vaultId];
    return;
  }
  NSData *completionSnapshotData = snapshotData;
  [self.transport
      appendBody:body
       proofHeader:proof
        completion:^(AncPrivateVaultHostedAppendTransportStatus transportStatus,
                     NSData *receiptBytes) {
          dispatch_async(self.queue, ^{
            const AncPrivateVaultRecoveryPreparationSnapshot
                *completionSnapshot = completionSnapshotData.bytes;
            if (transportStatus != AncPrivateVaultHostedAppendTransportStatusOK) {
              [self finish:completion
                     status:AncPrivateVaultRecoveryCoordinatorStatusNetworkFailed
                    vaultId:vaultId];
              return;
            }
            AncPrivateVaultRecoveryHostedAppendReceipt *receipt =
                AncPrivateVaultRecoveryHostedAppendReceiptDecode(receiptBytes);
            BOOL exactReceipt =
                receipt != nil && [receipt.vaultId isEqualToString:vaultId] &&
                [receipt.entryId isEqualToString:artifacts.entryId] &&
                receipt.sequence == completionSnapshot->expected_next_sequence &&
                anc_pv_memcmp(receipt.headHash.bytes,
                              completionSnapshot->entry_hash, 32) ==
                    ANC_PV_CRYPTO_OK &&
                anc_pv_memcmp(receipt.recoveryWrapHash.bytes,
                              completionSnapshot->recovery_wrap_hash, 32) ==
                    ANC_PV_CRYPTO_OK &&
                receipt.recoveryWrapByteLength ==
                    completionSnapshot->recovery_wrap_byte_length;
            AncPrivateVaultVerifiedReplayResult *capability =
                exactReceipt
                    ? AncPrivateVaultVerifiedRecoveryBootstrapResultCreate(
                          artifacts, completionSnapshot->verified_at_ms)
                    : nil;
            AncPrivateVaultAuthorityCheckpoint *committed = nil;
            AncPrivateVaultAuthorityStoreStatus commitStatus =
                capability == nil
                    ? AncPrivateVaultAuthorityStoreStatusInvalid
                    : [self.authorityStore
                          commitVerifiedReplayResult:capability
                                               vaultId:vaultId
                                          verifiedAtMs:
                                              completionSnapshot->verified_at_ms
                                            checkpoint:&committed
                                                 error:nil];
            BOOL committedExact =
                commitStatus == AncPrivateVaultAuthorityStoreStatusOK &&
                committed.snapshot.sequence ==
                    completionSnapshot->expected_next_sequence &&
                anc_pv_memcmp(committed.snapshot.headHash.bytes,
                              completionSnapshot->entry_hash, 32) ==
                    ANC_PV_CRYPTO_OK;
            BOOL cleaned = committedExact &&
                           [self cleanupSnapshot:completionSnapshot
                                        vaultId:vaultId];
            AncPrivateVaultRecoveryCoordinatorStatus status =
                !exactReceipt
                    ? AncPrivateVaultRecoveryCoordinatorStatusReceiptInvalid
                : !committedExact
                    ? AncPrivateVaultRecoveryCoordinatorStatusVerificationFailed
                : !cleaned
                    ? AncPrivateVaultRecoveryCoordinatorStatusStorageFailed
                    : AncPrivateVaultRecoveryCoordinatorStatusOK;
            [self finish:completion status:status vaultId:vaultId];
          });
        }];
}

- (void)resumeVaultId:(NSString *)vaultId
           completion:(AncPrivateVaultRecoveryCoordinatorCompletion)completion {
  dispatch_async(self.queue, ^{
    AncPrivateVaultRecoveryPreparationEvidence *evidence = nil;
    AncPrivateVaultRecoveryPreparationSecretsHandle *handle = nil;
    AncPrivateVaultRecoveryPreparationStoreStatus status =
        [self.preparationStore readEvidenceVaultId:vaultId
                                          evidence:&evidence
                                            handle:&handle];
    if (status != AncPrivateVaultRecoveryPreparationStoreStatusOK) {
      [self finish:completion
             status:status ==
                            AncPrivateVaultRecoveryPreparationStoreStatusNotFound
                        ? AncPrivateVaultRecoveryCoordinatorStatusNotFound
                        : AncPrivateVaultRecoveryCoordinatorStatusStorageFailed
            vaultId:vaultId];
      return;
    }
    [self resumeEvidence:evidence
                  handle:handle
                 vaultId:vaultId
              completion:completion];
  });
}

- (void)beginWithReplay:(AncPrivateVaultBootstrapReplay *)replay
             completion:(AncPrivateVaultRecoveryCoordinatorCompletion)completion {
  dispatch_async(self.queue, ^{
    NSString *vaultId = replay.state.vaultId ?: @"";
    if (replay == nil || !replay.isComplete || replay.verifiedEEK == nil ||
        vaultId.length != 32) {
      [replay invalidate];
      [self finish:completion
             status:AncPrivateVaultRecoveryCoordinatorStatusInvalid
            vaultId:vaultId];
      return;
    }
    NSData *vault = nil;
    @try {
      NSMutableData *decoded = [NSMutableData dataWithLength:16];
      for (NSUInteger index = 0; index < 16; index += 1) {
        unsigned int byte = 0;
        NSScanner *scanner = [NSScanner scannerWithString:
            [vaultId substringWithRange:NSMakeRange(index * 2, 2)]];
        if (![scanner scanHexInt:&byte])
          @throw [NSException exceptionWithName:@"AncVaultId"
                                         reason:nil
                                       userInfo:nil];
        ((uint8_t *)decoded.mutableBytes)[index] = (uint8_t)byte;
      }
      vault = decoded;
    } @catch (__unused NSException *exception) {
      vault = nil;
    }
    AncPrivateVaultGuardedMemory *signing = RandomGuarded(32);
    AncPrivateVaultGuardedMemory *agreement = RandomGuarded(32);
    AncPrivateVaultGuardedMemory *local = RandomGuarded(32);
    NSData *lookup = RandomData(16), *ceremony = RandomData(16),
           *candidate = RandomData(16), *candidateEnvelope = RandomData(16),
           *wrapEnvelope = RandomData(16), *confirmationEnvelope = RandomData(16),
           *authorizationEnvelope = RandomData(16), *entryEnvelope = RandomData(16),
           *wrapNonce = RandomData(24), *confirmationNonce = RandomData(32);
    AncPrivateVaultRecoveryBuilderStatus builderStatus;
    uint64_t verifiedAtMs =
        (uint64_t)llround(NSDate.date.timeIntervalSince1970 * 1000.0);
    AncPrivateVaultPreparedRecoveryArtifacts *artifacts =
        vault == nil || signing == nil || agreement == nil || local == nil
            ? nil
            : AncPrivateVaultBuildRecoveryArtifacts(
                  replay, signing, agreement, ceremony, candidate,
                  candidateEnvelope, wrapEnvelope, confirmationEnvelope,
                  authorizationEnvelope, entryEnvelope, wrapNonce,
                  confirmationNonce, verifiedAtMs, &builderStatus);
    NSData *bundle = artifacts == nil
                         ? nil
                         : SnapshotBundle(artifacts.currentSnapshot,
                                          artifacts.currentStateSnapshot);
    uint8_t spoolDigest[32] = {0};
    AncPrivateVaultGenesisPreparationArtifactStatus staged =
        bundle == nil
            ? AncPrivateVaultGenesisPreparationArtifactStatusInvalid
            : [self.artifactStore
                  stageLookupId:lookup.bytes
                         vaultId:vault.bytes
                      ceremonyId:ceremony.bytes
                      generation:artifacts.nextState.recoveryGeneration
                    recoveryWrap:artifacts.recoveryWrap
                    confirmation:artifacts.signedEntry
                        bootstrap:bundle
                    authorization:artifacts.recoveryAuthorization
                           digest:spoolDigest];
    if (staged != AncPrivateVaultGenesisPreparationArtifactStatusOK) {
      if (artifacts != nil)
        [self.artifactStore
            deleteUnboundStagedLookupId:lookup.bytes
                                 vaultId:vault.bytes
                              ceremonyId:ceremony.bytes
                              generation:artifacts.nextState.recoveryGeneration];
      [signing close];
      [agreement close];
      [local close];
      [replay invalidate];
      anc_pv_zeroize(spoolDigest, sizeof spoolDigest);
      [self finish:completion
             status:AncPrivateVaultRecoveryCoordinatorStatusStorageFailed
            vaultId:vaultId];
      return;
    }
    NSData *spoolDigestData =
        [NSData dataWithBytes:spoolDigest length:sizeof spoolDigest];
    if ([self.retryStore addVaultId:vault.bytes] !=
        AncPrivateVaultHostedAppendRetryStoreStatusOK) {
      [self.artifactStore deleteStagedLookupId:lookup.bytes
                                expectedDigest:spoolDigestData.bytes];
      [signing close];
      [agreement close];
      [local close];
      [replay invalidate];
      anc_pv_zeroize(spoolDigest, sizeof spoolDigest);
      [self finish:completion
             status:AncPrivateVaultRecoveryCoordinatorStatusStorageFailed
            vaultId:vaultId];
      return;
    }
    NSData *commitment =
        AncPrivateVaultRecoveryPreparationArtifactsCommitment(
            artifacts.signedEntry, artifacts.recoveryWrap,
            artifacts.currentSnapshot, artifacts.currentStateSnapshot,
            artifacts.recoveryAuthorization);
    NSData *wrapHash = [NSData dataWithBytes:
        artifacts.nextState.recoveryWrapHash.bytes length:32];
    NSMutableData *snapshotData = [NSMutableData
        dataWithLength:sizeof(AncPrivateVaultRecoveryPreparationSnapshot)];
    AncPrivateVaultRecoveryPreparationSnapshot *snapshot =
        snapshotData.mutableBytes;
    memcpy(snapshot->vault_id, vault.bytes, 16);
    memcpy(snapshot->lookup_id, lookup.bytes, 16);
    memcpy(snapshot->ceremony_id, ceremony.bytes, 16);
    memcpy(snapshot->candidate_endpoint_id, candidate.bytes, 16);
    memcpy(snapshot->artifact_digest, spoolDigestData.bytes, 32);
    snapshot->verified_at_ms = verifiedAtMs;
    snapshot->next_epoch = artifacts.nextState.epoch;
    snapshot->replacement_recovery_generation =
        artifacts.nextState.recoveryGeneration;
    snapshot->expected_next_sequence = artifacts.nextState.sequence;
    memcpy(snapshot->expected_previous_head, replay.state.headHash.bytes, 32);
    memcpy(snapshot->recovery_authorization_hash,
           artifacts.authorizationHash.bytes, 32);
    memcpy(snapshot->entry_id, entryEnvelope.bytes, 16);
    memcpy(snapshot->entry_hash, artifacts.entryHash.bytes, 32);
    memcpy(snapshot->recovery_wrap_hash, wrapHash.bytes, 32);
    memcpy(snapshot->candidate_signing_public_key,
           artifacts.candidateSigningPublicKey.bytes, 32);
    memcpy(snapshot->candidate_key_agreement_public_key,
           artifacts.candidateKeyAgreementPublicKey.bytes, 32);
    snapshot->recovery_wrap_byte_length = artifacts.recoveryWrap.length;
    memcpy(snapshot->artifact_commitment, commitment.bytes, 32);
    __block AncPrivateVaultRecoveryPreparationStoreStatus preparationStatus =
        AncPrivateVaultRecoveryPreparationStoreStatusFailed;
    AncPrivateVaultGuardedMemoryStatus signingBorrow =
        [signing borrow:^BOOL(uint8_t *signingBytes, size_t signingLength) {
          return [agreement
                     borrow:^BOOL(uint8_t *agreementBytes,
                                  size_t agreementLength) {
                       return [local
                                  borrow:^BOOL(uint8_t *localBytes,
                                               size_t localLength) {
                                    return [replay.verifiedEEK
                                               borrow:^BOOL(uint8_t *eek,
                                                            size_t eekLength) {
                                                 if (signingLength != 32 ||
                                                     agreementLength != 32 ||
                                                     localLength != 32 ||
                                                     eekLength != 32)
                                                   return NO;
                                                 AncPrivateVaultRecoveryPreparationSecretInputs
                                                     secrets = {
                                                         .endpoint_signing_seed =
                                                             signingBytes,
                                                         .endpoint_box_seed =
                                                             agreementBytes,
                                                         .local_state_key =
                                                             localBytes,
                                                         .eek = eek,
                                                     };
                                                 preparationStatus =
                                                     [self.preparationStore
                                                         createSnapshot:
                                                             snapshotData.bytes
                                                               secrets:&secrets];
                                                 return preparationStatus ==
                                                        AncPrivateVaultRecoveryPreparationStoreStatusOK;
                                               }] ==
                                               AncPrivateVaultGuardedMemoryStatusOK;
                                  }] ==
                                  AncPrivateVaultGuardedMemoryStatusOK;
                     }] == AncPrivateVaultGuardedMemoryStatusOK;
        }];
    [signing close];
    [agreement close];
    [local close];
    [replay invalidate];
    anc_pv_zeroize(spoolDigest, sizeof spoolDigest);
    anc_pv_zeroize(snapshotData.mutableBytes, snapshotData.length);
    if (signingBorrow != AncPrivateVaultGuardedMemoryStatusOK ||
        preparationStatus !=
            AncPrivateVaultRecoveryPreparationStoreStatusOK) {
      [self.retryStore removeVaultId:vault.bytes];
      [self.artifactStore deleteStagedLookupId:lookup.bytes
                                expectedDigest:spoolDigestData.bytes];
      [self finish:completion
             status:AncPrivateVaultRecoveryCoordinatorStatusProtectionFailed
            vaultId:vaultId];
      return;
    }
    [self resumeVaultId:vaultId completion:completion];
  });
}
@end
