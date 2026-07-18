#import "PrivateVaultEnrollmentCoordinator.h"

#import "PrivateVaultAuthorityStoreInternal.h"
#import "PrivateVaultControlLogInternal.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultEnrollmentAuthorizationInternal.h"
#import "PrivateVaultEnrollmentChallengeInternal.h"
#import "PrivateVaultEnrollmentOffer.h"
#import "PrivateVaultEnrollmentSasReceiptInternal.h"

#import <objc/runtime.h>

@interface AncPrivateVaultEnrollmentCandidate ()
@property(nonatomic, readwrite) NSData *vaultId;
@property(nonatomic, readwrite) NSData *endpointId;
@property(nonatomic, readwrite) NSData *ceremonyId;
@property(nonatomic, readwrite) NSData *encodedOffer;
@property(nonatomic, readwrite) NSData *offerHash;
@property(nonatomic, readwrite) NSData *candidateKeyProof;
@property(nonatomic, readwrite) NSData *signingPublicKey;
@property(nonatomic, readwrite) NSData *keyAgreementPublicKey;
@end
@implementation AncPrivateVaultEnrollmentCandidate
@end

@interface AncPrivateVaultEnrollmentCoordinator ()
@property(nonatomic) AncPrivateVaultCustodyRepository *brokerCustodyRepository;
@property(nonatomic) AncPrivateVaultEnrollmentOfferArtifactStore *artifactStore;
@property(nonatomic) AncPrivateVaultEnrollmentSasReceiptStore *sasReceiptStore;
@property(nonatomic) AncPrivateVaultAuthorityStore *authorityStore;
@end

static NSString *Hex(NSData *data) {
  if (data.length != 16)
    return nil;
  const uint8_t *bytes = data.bytes;
  NSMutableString *hex = [NSMutableString stringWithCapacity:32];
  for (NSUInteger index = 0; index < 16; index += 1)
    [hex appendFormat:@"%02x", bytes[index]];
  return hex;
}

static NSString *SnapshotId(const uint8_t *bytes, size_t length) {
  if (bytes == NULL || length == 0 || length > ANC_PV_CUSTODY_ID_BYTES)
    return nil;
  NSData *data = [NSData dataWithBytes:bytes length:length];
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

static uint64_t TimestampMs(NSString *value) {
  if (value.length == 0)
    return 0;
  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                            NSISO8601DateFormatWithFractionalSeconds;
  NSDate *date = [formatter dateFromString:value];
  if (date == nil) {
    formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime;
    date = [formatter dateFromString:value];
  }
  NSTimeInterval milliseconds = date.timeIntervalSince1970 * 1000.0;
  return date != nil && milliseconds >= 1.0 &&
                 milliseconds <= 9007199254740991.0
             ? (uint64_t)milliseconds
             : 0;
}

static NSData *PriorStateDigest(AncPrivateVaultControlLogState *state) {
  static const uint8_t domain[] = "anc/v1/enrollment-prior-control-state";
  NSData *encoded = AncPrivateVaultControlLogStatePersistenceEncode(state);
  if (encoded == nil)
    return nil;
  uint8_t digest[32] = {0};
  BOOL ok =
      anc_pv_blake2b_256_two_part(digest, domain, sizeof domain, encoded.bytes,
                                  encoded.length) == ANC_PV_CRYPTO_OK;
  NSData *result =
      ok ? [NSData dataWithBytes:digest length:sizeof digest] : nil;
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static BOOL
PendingMatchesChallenge(const AncPrivateVaultCustodySnapshot *snapshot,
                        NSString *vaultId, NSData *candidateEndpointId,
                        NSData *ceremonyId, NSData *candidateSigningPublicKey,
                        NSData *candidateAgreementPublicKey,
                        NSData *offerHash) {
  return snapshot != NULL &&
         snapshot->record_version == ANC_PV_CUSTODY_VERSION &&
         snapshot->custody_generation == 1 &&
         snapshot->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
         snapshot->role == ANC_PV_CUSTODY_ROLE_BROKER &&
         snapshot->pending_kind == ANC_PV_CUSTODY_PENDING_ADD_BROKER &&
         snapshot->enrollment_phase ==
             ANC_PV_CUSTODY_ENROLLMENT_OFFER_PENDING &&
         !snapshot->authority_anchor_present &&
         !snapshot->expected_edge_present &&
         [SnapshotId(snapshot->vault_id, snapshot->vault_id_length)
             isEqualToString:vaultId] &&
         [SnapshotId(snapshot->endpoint_id, snapshot->endpoint_id_length)
             isEqualToString:Hex(candidateEndpointId)] &&
         [SnapshotId(snapshot->ceremony_id, snapshot->ceremony_id_length)
             isEqualToString:Hex(ceremonyId)] &&
         anc_pv_memcmp(snapshot->signing_public_key,
                       candidateSigningPublicKey.bytes,
                       32) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(snapshot->box_public_key,
                       candidateAgreementPublicKey.bytes,
                       32) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(snapshot->pending_transcript_digest, offerHash.bytes,
                       32) == ANC_PV_CRYPTO_OK;
}

static BOOL PublicSnapshotsEqual(
    const AncPrivateVaultCustodySnapshot *left,
    const AncPrivateVaultCustodySnapshot *right) {
#define ANC_EQUAL_SCALAR(field) (left->field == right->field)
#define ANC_EQUAL_BYTES(field)                                                  \
  (anc_pv_memcmp(left->field, right->field, sizeof left->field) ==             \
   ANC_PV_CRYPTO_OK)
  return left != NULL && right != NULL && ANC_EQUAL_SCALAR(record_version) &&
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

static BOOL
SnapshotMatchesArtifact(const AncPrivateVaultCustodySnapshot *snapshot,
                        AncPrivateVaultEnrollmentOfferArtifact *artifact) {
  return snapshot->record_version == ANC_PV_CUSTODY_VERSION &&
         snapshot->custody_generation == 1 &&
         snapshot->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
         snapshot->role == ANC_PV_CUSTODY_ROLE_BROKER &&
         snapshot->pending_kind == ANC_PV_CUSTODY_PENDING_ADD_BROKER &&
         snapshot->enrollment_phase ==
             ANC_PV_CUSTODY_ENROLLMENT_OFFER_PENDING &&
         !snapshot->authority_anchor_present &&
         !snapshot->expected_edge_present && snapshot->active_epoch == 0 &&
         snapshot->pending_epoch == 0 &&
         [SnapshotId(snapshot->endpoint_id, snapshot->endpoint_id_length)
             isEqualToString:Hex(artifact.endpointId)] &&
         [SnapshotId(snapshot->ceremony_id, snapshot->ceremony_id_length)
             isEqualToString:Hex(artifact.ceremonyId)] &&
         anc_pv_memcmp(snapshot->signing_public_key,
                       artifact.signingPublicKey.bytes,
                       32) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(snapshot->box_public_key,
                       artifact.keyAgreementPublicKey.bytes,
                       32) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(snapshot->pending_transcript_digest,
                       artifact.offerHash.bytes, 32) == ANC_PV_CRYPTO_OK &&
         [artifact.membershipRole isEqualToString:@"broker"];
}

static AncPrivateVaultEnrollmentCandidate *
Candidate(AncPrivateVaultEnrollmentOfferArtifact *artifact) {
  AncPrivateVaultEnrollmentCandidate *result =
      class_createInstance(AncPrivateVaultEnrollmentCandidate.class, 0);
  result.vaultId = [artifact.vaultId copy];
  result.endpointId = [artifact.endpointId copy];
  result.ceremonyId = [artifact.ceremonyId copy];
  result.encodedOffer = [artifact.encodedOffer copy];
  result.offerHash = [artifact.offerHash copy];
  result.candidateKeyProof = [artifact.candidateKeyProof copy];
  result.signingPublicKey = [artifact.signingPublicKey copy];
  result.keyAgreementPublicKey = [artifact.keyAgreementPublicKey copy];
  return result;
}

static AncPrivateVaultEnrollmentCoordinatorStatus
ArtifactStatus(AncPrivateVaultEnrollmentOfferArtifactStatus status) {
  switch (status) {
  case AncPrivateVaultEnrollmentOfferArtifactStatusOK:
    return AncPrivateVaultEnrollmentCoordinatorStatusOK;
  case AncPrivateVaultEnrollmentOfferArtifactStatusInvalid:
    return AncPrivateVaultEnrollmentCoordinatorStatusInvalid;
  case AncPrivateVaultEnrollmentOfferArtifactStatusConflict:
    return AncPrivateVaultEnrollmentCoordinatorStatusConflict;
  case AncPrivateVaultEnrollmentOfferArtifactStatusCorrupt:
    return AncPrivateVaultEnrollmentCoordinatorStatusCorrupt;
  case AncPrivateVaultEnrollmentOfferArtifactStatusInaccessible:
    return AncPrivateVaultEnrollmentCoordinatorStatusInaccessible;
  case AncPrivateVaultEnrollmentOfferArtifactStatusNotFound:
  case AncPrivateVaultEnrollmentOfferArtifactStatusFailed:
    return AncPrivateVaultEnrollmentCoordinatorStatusFailed;
  }
}

static AncPrivateVaultEnrollmentCoordinatorStatus
CustodyStatus(AncPrivateVaultCustodyRepositoryStatus status) {
  switch (status) {
  case AncPrivateVaultCustodyRepositoryStatusOK:
    return AncPrivateVaultEnrollmentCoordinatorStatusOK;
  case AncPrivateVaultCustodyRepositoryStatusInvalid:
    return AncPrivateVaultEnrollmentCoordinatorStatusInvalid;
  case AncPrivateVaultCustodyRepositoryStatusConflict:
  case AncPrivateVaultCustodyRepositoryStatusRollbackDetected:
    return AncPrivateVaultEnrollmentCoordinatorStatusConflict;
  case AncPrivateVaultCustodyRepositoryStatusCorrupt:
    return AncPrivateVaultEnrollmentCoordinatorStatusCorrupt;
  case AncPrivateVaultCustodyRepositoryStatusInaccessible:
    return AncPrivateVaultEnrollmentCoordinatorStatusInaccessible;
  case AncPrivateVaultCustodyRepositoryStatusNotFound:
  case AncPrivateVaultCustodyRepositoryStatusFailed:
    return AncPrivateVaultEnrollmentCoordinatorStatusFailed;
  }
}

@implementation AncPrivateVaultEnrollmentCoordinator
- (instancetype)
    initWithBrokerCustodyRepository:
        (AncPrivateVaultCustodyRepository *)brokerCustodyRepository
                      artifactStore:
                          (AncPrivateVaultEnrollmentOfferArtifactStore *)
                              artifactStore {
  self = [super init];
  if (self == nil || brokerCustodyRepository == nil || artifactStore == nil)
    return nil;
  _brokerCustodyRepository = brokerCustodyRepository;
  _artifactStore = artifactStore;
  return self;
}

- (instancetype)
    initWithBrokerCustodyRepository:
        (AncPrivateVaultCustodyRepository *)brokerCustodyRepository
                      artifactStore:
                          (AncPrivateVaultEnrollmentOfferArtifactStore *)
                              artifactStore
                    sasReceiptStore:(AncPrivateVaultEnrollmentSasReceiptStore *)
                                        sasReceiptStore
                     authorityStore:
                         (AncPrivateVaultAuthorityStore *)authorityStore {
  self = [super init];
  if (self == nil || brokerCustodyRepository == nil || artifactStore == nil ||
      sasReceiptStore == nil || authorityStore == nil)
    return nil;
  _brokerCustodyRepository = brokerCustodyRepository;
  _artifactStore = artifactStore;
  _sasReceiptStore = sasReceiptStore;
  _authorityStore = authorityStore;
  return self;
}

- (AncPrivateVaultEnrollmentCoordinatorStatus)
    prepareBrokerVaultId:(NSData *)vaultId
              nowSeconds:(uint64_t)nowSeconds
               candidate:(AncPrivateVaultEnrollmentCandidate **)candidate {
  if (candidate == NULL)
    return AncPrivateVaultEnrollmentCoordinatorStatusInvalid;
  *candidate = nil;
  NSString *vault = Hex(vaultId);
  if (vault == nil || nowSeconds == 0 || nowSeconds > INT64_MAX - 600)
    return AncPrivateVaultEnrollmentCoordinatorStatusInvalid;
  AncPrivateVaultCustodySnapshot existing;
  AncPrivateVaultCustodyHandle *handle = nil;
  AncPrivateVaultCustodyRepositoryStatus read =
      [self.brokerCustodyRepository readVaultId:vault
                                       snapshot:&existing
                                         handle:&handle];
  if (read == AncPrivateVaultCustodyRepositoryStatusOK) {
    AncPrivateVaultEnrollmentOfferArtifact *artifact = nil;
    AncPrivateVaultEnrollmentOfferArtifactStatus artifactRead =
        [self.artifactStore readVaultId:vaultId artifact:&artifact];
    BOOL matches =
        artifactRead == AncPrivateVaultEnrollmentOfferArtifactStatusOK &&
        SnapshotMatchesArtifact(&existing, artifact);
    AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
    if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
      return CustodyStatus(closed);
    if (!matches)
      return artifactRead == AncPrivateVaultEnrollmentOfferArtifactStatusOK
                 ? AncPrivateVaultEnrollmentCoordinatorStatusCorrupt
                 : ArtifactStatus(artifactRead);
    *candidate = Candidate(artifact);
    return AncPrivateVaultEnrollmentCoordinatorStatusOK;
  }
  if (read != AncPrivateVaultCustodyRepositoryStatusNotFound)
    return CustodyStatus(read);

  AncPrivateVaultEnrollmentOfferArtifact *orphan = nil;
  AncPrivateVaultEnrollmentOfferArtifactStatus orphanStatus =
      [self.artifactStore readVaultId:vaultId artifact:&orphan];
  if (orphanStatus == AncPrivateVaultEnrollmentOfferArtifactStatusOK) {
    AncPrivateVaultEnrollmentOfferArtifactStatus deleted =
        [self.artifactStore deleteVaultId:vaultId
                        expectedOfferHash:orphan.offerHash];
    if (deleted != AncPrivateVaultEnrollmentOfferArtifactStatusOK)
      return ArtifactStatus(deleted);
  } else if (orphanStatus !=
             AncPrivateVaultEnrollmentOfferArtifactStatusNotFound) {
    return ArtifactStatus(orphanStatus);
  }

  uint8_t endpoint[16] = {0}, ceremony[16] = {0}, envelope[16] = {0};
  uint8_t nonce[32] = {0}, signing[32] = {0}, box[32] = {0}, local[32] = {0};
  BOOL random = anc_pv_random(endpoint, sizeof endpoint) == ANC_PV_CRYPTO_OK &&
                anc_pv_random(ceremony, sizeof ceremony) == ANC_PV_CRYPTO_OK &&
                anc_pv_random(envelope, sizeof envelope) == ANC_PV_CRYPTO_OK &&
                anc_pv_random(nonce, sizeof nonce) == ANC_PV_CRYPTO_OK &&
                anc_pv_random(signing, sizeof signing) == ANC_PV_CRYPTO_OK &&
                anc_pv_random(box, sizeof box) == ANC_PV_CRYPTO_OK &&
                anc_pv_random(local, sizeof local) == ANC_PV_CRYPTO_OK;
  NSData *endpointData = [NSData dataWithBytes:endpoint length:sizeof endpoint];
  NSData *ceremonyData = [NSData dataWithBytes:ceremony length:sizeof ceremony];
  NSData *envelopeData = [NSData dataWithBytes:envelope length:sizeof envelope];
  NSData *nonceData = [NSData dataWithBytes:nonce length:sizeof nonce];
  AncPrivateVaultEnrollmentOfferStatus offerStatus;
  AncPrivateVaultEnrollmentOfferResult *offer =
      random ? AncPrivateVaultEnrollmentOfferBuild(
                   vaultId, endpointData, ceremonyData, envelopeData, nonceData,
                   @"broker", YES, nowSeconds, nowSeconds + 600, signing, box,
                   &offerStatus)
             : nil;
  if (offer == nil) {
    anc_pv_zeroize(signing, sizeof signing);
    anc_pv_zeroize(box, sizeof box);
    anc_pv_zeroize(local, sizeof local);
    return AncPrivateVaultEnrollmentCoordinatorStatusFailed;
  }
  AncPrivateVaultEnrollmentOfferArtifactStatus storedArtifact =
      [self.artifactStore storeVaultId:vaultId
                          encodedOffer:offer.encodedOffer
                             offerHash:offer.offerHash
                     candidateKeyProof:offer.candidateKeyProof];
  if (storedArtifact != AncPrivateVaultEnrollmentOfferArtifactStatusOK) {
    anc_pv_zeroize(signing, sizeof signing);
    anc_pv_zeroize(box, sizeof box);
    anc_pv_zeroize(local, sizeof local);
    return ArtifactStatus(storedArtifact);
  }
  AncPrivateVaultCustodySnapshot pending = {0};
  pending.record_version = ANC_PV_CUSTODY_VERSION;
  pending.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  pending.role = ANC_PV_CUSTODY_ROLE_BROKER;
  pending.pending_kind = ANC_PV_CUSTODY_PENDING_ADD_BROKER;
  pending.enrollment_phase = ANC_PV_CUSTODY_ENROLLMENT_OFFER_PENDING;
  pending.custody_generation = 1;
  NSData *vaultText = [vault dataUsingEncoding:NSUTF8StringEncoding];
  NSData *endpointText =
      [Hex(endpointData) dataUsingEncoding:NSUTF8StringEncoding];
  NSData *ceremonyText =
      [Hex(ceremonyData) dataUsingEncoding:NSUTF8StringEncoding];
  memcpy(pending.vault_id, vaultText.bytes, vaultText.length);
  pending.vault_id_length = vaultText.length;
  memcpy(pending.endpoint_id, endpointText.bytes, endpointText.length);
  pending.endpoint_id_length = endpointText.length;
  memcpy(pending.ceremony_id, ceremonyText.bytes, ceremonyText.length);
  pending.ceremony_id_length = ceremonyText.length;
  memcpy(pending.signing_public_key, offer.signingPublicKey.bytes, 32);
  memcpy(pending.box_public_key, offer.keyAgreementPublicKey.bytes, 32);
  memcpy(pending.pending_transcript_digest, offer.offerHash.bytes, 32);
  uint8_t activeZero[32] = {0}, pendingZero[32] = {0};
  AncPrivateVaultCustodySecretInputs secrets = {.signing_seed = signing,
                                                .box_seed = box,
                                                .local_state_key = local,
                                                .active_epoch_key = activeZero,
                                                .pending_epoch_key =
                                                    pendingZero};
  AncPrivateVaultCustodyRepositoryStatus storedCustody =
      [self.brokerCustodyRepository storeSnapshot:&pending
                                          secrets:&secrets
                                          vaultId:vault];
  anc_pv_zeroize(signing, sizeof signing);
  anc_pv_zeroize(box, sizeof box);
  anc_pv_zeroize(local, sizeof local);
  if (storedCustody != AncPrivateVaultCustodyRepositoryStatusOK) {
    AncPrivateVaultEnrollmentOfferArtifactStatus deleted =
        [self.artifactStore deleteVaultId:vaultId
                        expectedOfferHash:offer.offerHash];
    return deleted == AncPrivateVaultEnrollmentOfferArtifactStatusOK
               ? CustodyStatus(storedCustody)
               : ArtifactStatus(deleted);
  }
  AncPrivateVaultEnrollmentOfferArtifact *artifact = nil;
  AncPrivateVaultEnrollmentOfferArtifactStatus finalRead =
      [self.artifactStore readVaultId:vaultId artifact:&artifact];
  if (finalRead != AncPrivateVaultEnrollmentOfferArtifactStatusOK ||
      !SnapshotMatchesArtifact(&pending, artifact))
    return finalRead == AncPrivateVaultEnrollmentOfferArtifactStatusOK
               ? AncPrivateVaultEnrollmentCoordinatorStatusCorrupt
               : ArtifactStatus(finalRead);
  *candidate = Candidate(artifact);
  return AncPrivateVaultEnrollmentCoordinatorStatusOK;
}

- (AncPrivateVaultEnrollmentCoordinatorStatus)
    recordSasDecisionForChallenge:
        (AncPrivateVaultEnrollmentChallengeResult *)challenge
                        receiptId:(NSData *)receiptId
                        decidedAt:(uint64_t)decidedAt
                         decision:(AncPrivateVaultEnrollmentSasDecision)decision
                          receipt:
                              (AncPrivateVaultEnrollmentSasReceipt **)receipt {
  if (receipt == NULL)
    return AncPrivateVaultEnrollmentCoordinatorStatusInvalid;
  *receipt = nil;
  if (self.sasReceiptStore == nil || challenge == nil)
    return AncPrivateVaultEnrollmentCoordinatorStatusInvalid;
  NSData *vaultBytes = nil, *encodedChallenge = nil, *offerHash = nil,
         *challengeHash = nil, *sasTranscriptHash = nil,
         *candidateEndpointId = nil, *candidateSigningPublicKey = nil,
         *candidateAgreementPublicKey = nil, *ceremonyId = nil;
  NSString *targetMembershipRole = nil;
  uint64_t challengeCreatedAt = 0, challengeExpiresAt = 0;
  if (!AncPrivateVaultEnrollmentChallengeCopyEvidence(
          challenge, &vaultBytes, &encodedChallenge, &offerHash, &challengeHash,
          &sasTranscriptHash, &candidateEndpointId, &candidateSigningPublicKey,
          &candidateAgreementPublicKey, &ceremonyId, &targetMembershipRole,
          &challengeCreatedAt, &challengeExpiresAt) ||
      ![targetMembershipRole isEqualToString:@"broker"])
    return AncPrivateVaultEnrollmentCoordinatorStatusConflict;
  (void)encodedChallenge;
  NSString *vault = Hex(vaultBytes);
  if (vault == nil)
    return AncPrivateVaultEnrollmentCoordinatorStatusInvalid;
  AncPrivateVaultCustodySnapshot snapshot;
  AncPrivateVaultCustodyHandle *handle = nil;
  AncPrivateVaultCustodyRepositoryStatus read =
      [self.brokerCustodyRepository readVaultId:vault
                                       snapshot:&snapshot
                                         handle:&handle];
  if (read != AncPrivateVaultCustodyRepositoryStatusOK || handle == nil)
    return CustodyStatus(read);
  if (!PendingMatchesChallenge(&snapshot, vault, candidateEndpointId,
                               ceremonyId, candidateSigningPublicKey,
                               candidateAgreementPublicKey, offerHash)) {
    AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
    return closed == AncPrivateVaultCustodyRepositoryStatusOK
               ? AncPrivateVaultEnrollmentCoordinatorStatusConflict
               : CustodyStatus(closed);
  }
  __block AncPrivateVaultEnrollmentSasReceipt *built = nil;
  __block AncPrivateVaultEnrollmentSasReceiptStatus buildStatus =
      AncPrivateVaultEnrollmentSasReceiptStatusInvalid;
  AncPrivateVaultCustodyRepositoryStatus borrowed =
      [handle borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
        built = AncPrivateVaultEnrollmentSasReceiptBuild(
            challenge, receiptId, decidedAt, decision, secrets->signing_seed,
            &buildStatus);
        return built != nil;
      }];
  AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
  if (borrowed != AncPrivateVaultCustodyRepositoryStatusOK ||
      closed != AncPrivateVaultCustodyRepositoryStatusOK || built == nil)
    return closed != AncPrivateVaultCustodyRepositoryStatusOK
               ? CustodyStatus(closed)
           : buildStatus ==
                   AncPrivateVaultEnrollmentSasReceiptStatusBindingMismatch
               ? AncPrivateVaultEnrollmentCoordinatorStatusConflict
               : AncPrivateVaultEnrollmentCoordinatorStatusFailed;
  AncPrivateVaultEnrollmentSasReceiptStatus sealedStatus;
  if (AncPrivateVaultEnrollmentSasReceiptVerifyBound(
          built.encodedReceipt, vaultBytes, offerHash, challengeHash,
          sasTranscriptHash, candidateEndpointId, ceremonyId,
          candidateSigningPublicKey, challengeCreatedAt, challengeExpiresAt,
          &sealedStatus) == nil)
    return AncPrivateVaultEnrollmentCoordinatorStatusConflict;
  AncPrivateVaultEnrollmentSasReceiptStoreStatus stored =
      [self.sasReceiptStore storeReceipt:built.encodedReceipt
                               challenge:challenge];
  switch (stored) {
  case AncPrivateVaultEnrollmentSasReceiptStoreStatusOK:
    *receipt = built;
    return AncPrivateVaultEnrollmentCoordinatorStatusOK;
  case AncPrivateVaultEnrollmentSasReceiptStoreStatusInvalid:
    return AncPrivateVaultEnrollmentCoordinatorStatusInvalid;
  case AncPrivateVaultEnrollmentSasReceiptStoreStatusConflict:
    return AncPrivateVaultEnrollmentCoordinatorStatusConflict;
  case AncPrivateVaultEnrollmentSasReceiptStoreStatusCorrupt:
    return AncPrivateVaultEnrollmentCoordinatorStatusCorrupt;
  case AncPrivateVaultEnrollmentSasReceiptStoreStatusInaccessible:
    return AncPrivateVaultEnrollmentCoordinatorStatusInaccessible;
  case AncPrivateVaultEnrollmentSasReceiptStoreStatusNotFound:
  case AncPrivateVaultEnrollmentSasReceiptStoreStatusFailed:
    return AncPrivateVaultEnrollmentCoordinatorStatusFailed;
  }
}

- (AncPrivateVaultEnrollmentCoordinatorStatus)
    activateAuthorization:
        (AncPrivateVaultEnrollmentAuthorizationResult *)authorization
             verifiedAtMs:(uint64_t)verifiedAtMs
               checkpoint:(AncPrivateVaultAuthorityCheckpoint **)checkpoint {
  if (checkpoint == NULL)
    return AncPrivateVaultEnrollmentCoordinatorStatusInvalid;
  *checkpoint = nil;
  if (self.sasReceiptStore == nil || self.authorityStore == nil ||
      authorization == nil || verifiedAtMs == 0 ||
      verifiedAtMs > UINT64_C(9007199254740991))
    return AncPrivateVaultEnrollmentCoordinatorStatusInvalid;

  AncPrivateVaultEnrollmentSasReceipt *receipt = nil;
  AncPrivateVaultEnrollmentSasReceiptStoreStatus receiptRead =
      [self.sasReceiptStore readChallenge:authorization.challenge
                                  receipt:&receipt];
  if (receiptRead != AncPrivateVaultEnrollmentSasReceiptStoreStatusOK)
    return receiptRead == AncPrivateVaultEnrollmentSasReceiptStoreStatusNotFound
               ? AncPrivateVaultEnrollmentCoordinatorStatusConflict
           : receiptRead ==
                   AncPrivateVaultEnrollmentSasReceiptStoreStatusCorrupt
               ? AncPrivateVaultEnrollmentCoordinatorStatusCorrupt
           : receiptRead ==
                   AncPrivateVaultEnrollmentSasReceiptStoreStatusInaccessible
               ? AncPrivateVaultEnrollmentCoordinatorStatusInaccessible
               : AncPrivateVaultEnrollmentCoordinatorStatusFailed;
  NSData *vaultBytes = nil, *authorizationDigest = nil,
         *authorizationEnvelopeId = nil, *ceremonyBytes = nil,
         *candidateBytes = nil, *candidateSigningKey = nil,
         *candidateAgreementKey = nil, *offerHash = nil, *challengeHash = nil,
         *sasTranscriptHash = nil, *priorMembershipHash = nil,
         *signedMembershipCommit = nil;
  NSString *candidateRole = nil;
  BOOL candidateUnattended = NO;
  uint64_t challengeCreatedAt = 0, challengeExpiresAt = 0;
  AncPrivateVaultControlLogReplayResult *replay = nil;
  if (!AncPrivateVaultEnrollmentAuthorizationCopyEvidence(
          authorization, &vaultBytes, &authorizationDigest,
          &authorizationEnvelopeId, &ceremonyBytes, &candidateBytes,
          &candidateRole, &candidateUnattended, &candidateSigningKey,
          &candidateAgreementKey, &offerHash, &challengeHash,
          &sasTranscriptHash, &challengeCreatedAt, &challengeExpiresAt,
          &priorMembershipHash, &signedMembershipCommit, &replay))
    return AncPrivateVaultEnrollmentCoordinatorStatusConflict;
  NSString *vault = Hex(vaultBytes);
  AncPrivateVaultControlLogState *prior = nil, *next = nil;
  NSData *entryHash = nil;
  BOOL idempotent = YES;
  if (vault == nil || ![candidateRole isEqualToString:@"broker"] ||
      !candidateUnattended ||
      !AncPrivateVaultControlLogReplayResultCopyEvidence(
          replay, &prior, &next, &entryHash, &idempotent) ||
      idempotent || prior == nil || next == nil || prior.sequence == UINT64_MAX)
    return AncPrivateVaultEnrollmentCoordinatorStatusConflict;

  AncPrivateVaultCustodySnapshot current;
  AncPrivateVaultCustodyHandle *handle = nil;
  AncPrivateVaultCustodyRepositoryStatus custodyRead =
      [self.brokerCustodyRepository readVaultId:vault
                                       snapshot:&current
                                         handle:&handle];
  if (custodyRead != AncPrivateVaultCustodyRepositoryStatusOK || handle == nil)
    return CustodyStatus(custodyRead);

  BOOL candidateMatches =
      current.record_version == ANC_PV_CUSTODY_VERSION &&
      current.role == ANC_PV_CUSTODY_ROLE_BROKER &&
      [SnapshotId(current.endpoint_id, current.endpoint_id_length)
          isEqualToString:Hex(candidateBytes)] &&
      [SnapshotId(current.ceremony_id, current.ceremony_id_length)
          isEqualToString:Hex(ceremonyBytes)] &&
      anc_pv_memcmp(current.signing_public_key, candidateSigningKey.bytes,
                    32) == ANC_PV_CRYPTO_OK &&
      anc_pv_memcmp(current.box_public_key, candidateAgreementKey.bytes, 32) ==
          ANC_PV_CRYPTO_OK;
  BOOL generationOne =
      current.custody_generation == 1 &&
      current.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
      current.pending_kind == ANC_PV_CUSTODY_PENDING_ADD_BROKER &&
      current.enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_OFFER_PENDING &&
      !current.authority_anchor_present && !current.expected_edge_present &&
      anc_pv_memcmp(current.pending_transcript_digest, offerHash.bytes, 32) ==
          ANC_PV_CRYPTO_OK;
  BOOL generationTwo =
      current.custody_generation == 2 &&
      current.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
      current.pending_kind == ANC_PV_CUSTODY_PENDING_ADD_BROKER &&
      current.enrollment_phase ==
          ANC_PV_CUSTODY_ENROLLMENT_AUTHORIZATION_RECEIVED;
  BOOL generationThree = current.custody_generation == 3 &&
                         current.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE;
  if (!candidateMatches ||
      (!generationOne && !generationTwo && !generationThree)) {
    AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
    return closed == AncPrivateVaultCustodyRepositoryStatusOK
               ? AncPrivateVaultEnrollmentCoordinatorStatusConflict
               : CustodyStatus(closed);
  }

  uint64_t effectiveVerifiedAtMs =
      generationOne ? verifiedAtMs : current.freshness_ms;
  AncPrivateVaultVerifiedReplayResult *capability =
      AncPrivateVaultVerifiedEnrollmentBootstrapResultCreate(
          authorization, receipt, effectiveVerifiedAtMs);
  if (capability == nil) {
    AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
    return closed == AncPrivateVaultCustodyRepositoryStatusOK
               ? AncPrivateVaultEnrollmentCoordinatorStatusConflict
               : CustodyStatus(closed);
  }

  if (generationThree) {
    AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
    if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
      return CustodyStatus(closed);
    AncPrivateVaultAuthorityCheckpoint *existing = nil;
    AncPrivateVaultAuthorityStoreStatus loaded =
        [self.authorityStore loadVaultId:vault checkpoint:&existing error:nil];
    AncPrivateVaultAuthoritySnapshotStatus existingStatus, expectedStatus;
    NSData *existingBytes =
        existing == nil
            ? nil
            : AncPrivateVaultAuthoritySnapshotEncode(existing.snapshot,
                                                     &existingStatus);
    NSData *expectedBytes = AncPrivateVaultAuthoritySnapshotEncode(
        capability.nextSnapshot, &expectedStatus);
    if (loaded == AncPrivateVaultAuthorityStoreStatusOK &&
        existing.custodyGeneration == 3 && existingBytes != nil &&
        expectedBytes != nil && [existingBytes isEqualToData:expectedBytes] &&
        [existing.snapshot.headHash isEqualToData:entryHash]) {
      *checkpoint = existing;
      return AncPrivateVaultEnrollmentCoordinatorStatusOK;
    }
    return loaded == AncPrivateVaultAuthorityStoreStatusCorrupt
               ? AncPrivateVaultEnrollmentCoordinatorStatusCorrupt
               : AncPrivateVaultEnrollmentCoordinatorStatusConflict;
  }

  NSData *priorDigest = PriorStateDigest(prior);
  uint64_t signedAtMs = TimestampMs(prior.signedAt);
  if (priorDigest.length != 32 || signedAtMs == 0 ||
      prior.sequence == UINT64_MAX) {
    AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
    return closed == AncPrivateVaultCustodyRepositoryStatusOK
               ? AncPrivateVaultEnrollmentCoordinatorStatusInvalid
               : CustodyStatus(closed);
  }
  AncPrivateVaultCustodySnapshot authorized = current;
  authorized.authority_anchor_present = 1;
  authorized.expected_edge_present = 1;
  authorized.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  authorized.pending_kind = ANC_PV_CUSTODY_PENDING_ADD_BROKER;
  authorized.rotation_phase = ANC_PV_CUSTODY_ROTATION_NONE;
  authorized.enrollment_phase =
      ANC_PV_CUSTODY_ENROLLMENT_AUTHORIZATION_RECEIVED;
  authorized.custody_generation = 2;
  authorized.active_epoch = prior.epoch;
  authorized.pending_epoch = 0;
  authorized.recovery_generation = prior.recoveryGeneration;
  authorized.anchored_sequence = prior.sequence;
  memcpy(authorized.anchored_head, prior.headHash.bytes, 32);
  memcpy(authorized.membership_digest, prior.membershipHash.bytes, 32);
  authorized.signed_at_ms = signedAtMs;
  memcpy(authorized.snapshot_digest, priorDigest.bytes, 32);
  authorized.freshness_ms = effectiveVerifiedAtMs;
  authorized.expected_next_sequence = prior.sequence + 1;
  memcpy(authorized.expected_previous_head, prior.headHash.bytes, 32);
  memcpy(authorized.pending_transcript_digest, authorizationDigest.bytes, 32);

  if (generationTwo) {
    BOOL exact = PublicSnapshotsEqual(&current, &authorized);
    AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
    if (closed != AncPrivateVaultCustodyRepositoryStatusOK)
      return CustodyStatus(closed);
    if (!exact)
      return AncPrivateVaultEnrollmentCoordinatorStatusConflict;
  } else {

    AncPrivateVaultGuardedMemoryStatus epochMemoryStatus;
    AncPrivateVaultGuardedMemory *epochMemory =
        [AncPrivateVaultGuardedMemory memoryWithLength:32
                                                status:&epochMemoryStatus];
    if (epochMemory == nil) {
      AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
      return closed == AncPrivateVaultCustodyRepositoryStatusOK
                 ? AncPrivateVaultEnrollmentCoordinatorStatusFailed
                 : CustodyStatus(closed);
    }
    __block BOOL opened = NO;
    AncPrivateVaultCustodyRepositoryStatus borrowed =
        [handle borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
          AncPrivateVaultGuardedMemoryStatus copied =
              [epochMemory borrow:^BOOL(uint8_t *epochKey, size_t length) {
                if (length != 32)
                  return NO;
                AncPrivateVaultEekWrapStatus openStatus = [authorization
                    openEEKWithRecipientBoxSeed:secrets->box_seed
                                       consumer:^BOOL(const uint8_t *value) {
                                         memcpy(epochKey, value, 32);
                                         opened = YES;
                                         return YES;
                                       }];
                return openStatus == AncPrivateVaultEekWrapStatusOK && opened;
              }];
          return copied == AncPrivateVaultGuardedMemoryStatusOK && opened;
        }];
    AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
    if (borrowed != AncPrivateVaultCustodyRepositoryStatusOK ||
        closed != AncPrivateVaultCustodyRepositoryStatusOK || !opened) {
      [epochMemory close];
      return closed != AncPrivateVaultCustodyRepositoryStatusOK
                 ? CustodyStatus(closed)
                 : AncPrivateVaultEnrollmentCoordinatorStatusConflict;
    }
    __block AncPrivateVaultCustodyRepositoryStatus accepted =
        AncPrivateVaultCustodyRepositoryStatusFailed;
    AncPrivateVaultGuardedMemoryStatus acceptedBorrow =
        [epochMemory borrow:^BOOL(uint8_t *epochKey, size_t length) {
          if (length != 32)
            return NO;
          accepted = [self.brokerCustodyRepository
              acceptEnrollmentAuthorizationVaultId:vault
                                expectedGeneration:1
                                nextPublicSnapshot:&authorized
                                    activeEpochKey:epochKey];
          return accepted == AncPrivateVaultCustodyRepositoryStatusOK;
        }];
    AncPrivateVaultGuardedMemoryStatus epochClosed = [epochMemory close];
    if (acceptedBorrow != AncPrivateVaultGuardedMemoryStatusOK ||
        epochClosed != AncPrivateVaultGuardedMemoryStatusOK)
      return AncPrivateVaultEnrollmentCoordinatorStatusFailed;
    if (accepted != AncPrivateVaultCustodyRepositoryStatusOK)
      return CustodyStatus(accepted);
  }

  AncPrivateVaultAuthorityCheckpoint *committed = nil;
  AncPrivateVaultAuthorityStoreStatus commit =
      [self.authorityStore commitVerifiedReplayResult:capability
                                              vaultId:vault
                                         verifiedAtMs:effectiveVerifiedAtMs
                                           checkpoint:&committed
                                                error:nil];
  if (commit != AncPrivateVaultAuthorityStoreStatusOK || committed == nil)
    return commit == AncPrivateVaultAuthorityStoreStatusCorrupt
               ? AncPrivateVaultEnrollmentCoordinatorStatusCorrupt
           : commit == AncPrivateVaultAuthorityStoreStatusConflict
               ? AncPrivateVaultEnrollmentCoordinatorStatusConflict
               : AncPrivateVaultEnrollmentCoordinatorStatusFailed;
  *checkpoint = committed;
  return AncPrivateVaultEnrollmentCoordinatorStatusOK;
}
@end
