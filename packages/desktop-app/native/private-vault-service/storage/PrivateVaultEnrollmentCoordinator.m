#import "PrivateVaultEnrollmentCoordinator.h"

#import "PrivateVaultCrypto.h"
#import "PrivateVaultEnrollmentOffer.h"

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

static BOOL SnapshotMatchesArtifact(
    const AncPrivateVaultCustodySnapshot *snapshot,
    AncPrivateVaultEnrollmentOfferArtifact *artifact) {
  return snapshot->record_version == ANC_PV_CUSTODY_VERSION &&
         snapshot->custody_generation == 1 &&
         snapshot->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
         snapshot->role == ANC_PV_CUSTODY_ROLE_BROKER &&
         snapshot->pending_kind == ANC_PV_CUSTODY_PENDING_ADD_BROKER &&
         snapshot->enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_OFFER_PENDING &&
         !snapshot->authority_anchor_present && !snapshot->expected_edge_present &&
         snapshot->active_epoch == 0 && snapshot->pending_epoch == 0 &&
         [SnapshotId(snapshot->endpoint_id, snapshot->endpoint_id_length)
             isEqualToString:Hex(artifact.endpointId)] &&
         [SnapshotId(snapshot->ceremony_id, snapshot->ceremony_id_length)
             isEqualToString:Hex(artifact.ceremonyId)] &&
         anc_pv_memcmp(snapshot->signing_public_key,
                       artifact.signingPublicKey.bytes, 32) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(snapshot->box_public_key,
                       artifact.keyAgreementPublicKey.bytes, 32) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(snapshot->pending_transcript_digest,
                       artifact.offerHash.bytes, 32) == ANC_PV_CRYPTO_OK &&
         [artifact.membershipRole isEqualToString:@"broker"];
}

static AncPrivateVaultEnrollmentCandidate *Candidate(
    AncPrivateVaultEnrollmentOfferArtifact *artifact) {
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

static AncPrivateVaultEnrollmentCoordinatorStatus ArtifactStatus(
    AncPrivateVaultEnrollmentOfferArtifactStatus status) {
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

static AncPrivateVaultEnrollmentCoordinatorStatus CustodyStatus(
    AncPrivateVaultCustodyRepositoryStatus status) {
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
                        (AncPrivateVaultEnrollmentOfferArtifactStore *)artifactStore {
  self = [super init];
  if (self == nil || brokerCustodyRepository == nil || artifactStore == nil)
    return nil;
  _brokerCustodyRepository = brokerCustodyRepository;
  _artifactStore = artifactStore;
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
    BOOL matches = artifactRead == AncPrivateVaultEnrollmentOfferArtifactStatusOK &&
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
  NSData *endpointText = [Hex(endpointData) dataUsingEncoding:NSUTF8StringEncoding];
  NSData *ceremonyText = [Hex(ceremonyData) dataUsingEncoding:NSUTF8StringEncoding];
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
  AncPrivateVaultCustodySecretInputs secrets = {
      .signing_seed = signing,
      .box_seed = box,
      .local_state_key = local,
      .active_epoch_key = activeZero,
      .pending_epoch_key = pendingZero};
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
@end
