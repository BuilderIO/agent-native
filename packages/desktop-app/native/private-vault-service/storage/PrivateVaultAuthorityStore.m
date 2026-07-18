#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultAuthorityStoreInternal.h"
#import "PrivateVaultGenesisAuthorization.h"
#import "PrivateVaultGenesisAuthorizationInternal.h"
#import "PrivateVaultRecoveryBuilderInternal.h"

#import "PrivateVaultAuthoritySnapshotInternal.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultControlLogInternal.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultCustodyRepositoryRecoveryInternal.h"
#import "PrivateVaultEnrollmentAuthorizationInternal.h"
#import "PrivateVaultEnrollmentSasReceipt.h"
#import "PrivateVaultEnrollmentSasReceiptInternal.h"

#import <objc/runtime.h>

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static const uint8_t kAuthorityMagic[8] = {'A', 'N', 'P', 'V',
                                           'A', 'U', '0', '1'};
static const uint8_t kVaultDigestDomain[] =
    "anc/v1/private-vault/authority-store/vault-id";
static const uint8_t kAuthorityKeyDomain[] =
    "anc/v1/private-vault/authority-store/key";
static const uint8_t kAuthorityAADDomain[] =
    "anc/v1/private-vault/authority-store/aad";
static const uint8_t kFrameDigestDomain[] =
    "anc/v1/private-vault/authority-store/frame-digest";

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultAuthorityFaultHook gAuthorityFaultHook;
static AncPrivateVaultAuthorityDerivedKeyClearedHook
    gAuthorityDerivedKeyClearedHook;
void AncPrivateVaultAuthoritySetFaultHookForTesting(
    AncPrivateVaultAuthorityFaultHook hook) {
  gAuthorityFaultHook = [hook copy];
}
void AncPrivateVaultAuthoritySetDerivedKeyClearedHookForTesting(
    AncPrivateVaultAuthorityDerivedKeyClearedHook hook) {
  gAuthorityDerivedKeyClearedHook = [hook copy];
}
static BOOL AuthorityFault(AncPrivateVaultAuthorityFaultPoint point) {
  return gAuthorityFaultHook != nil && gAuthorityFaultHook(point);
}
#else
static BOOL AuthorityFault(NSInteger point) {
  (void)point;
  return NO;
}
#endif

static void ClearAuthorityKey(uint8_t key[32]) {
  anc_pv_zeroize(key, 32);
#if ANC_PRIVATE_VAULT_TESTING
  BOOL cleared = YES;
  for (size_t index = 0; index < 32; index++)
    cleared = cleared && key[index] == 0;
  if (gAuthorityDerivedKeyClearedHook != nil)
    gAuthorityDerivedKeyClearedHook(cleared);
#endif
}

static void WriteU16(uint8_t *p, uint16_t v) {
  p[0] = v >> 8;
  p[1] = v;
}
static void WriteU32(uint8_t *p, uint32_t v) {
  for (size_t i = 0; i < 4; i++)
    p[i] = (uint8_t)(v >> (24 - i * 8));
}
static void WriteU64(uint8_t *p, uint64_t v) {
  for (size_t i = 0; i < 8; i++)
    p[i] = (uint8_t)(v >> (56 - i * 8));
}
static uint16_t ReadU16(const uint8_t *p) {
  return ((uint16_t)p[0] << 8) | p[1];
}
static uint32_t ReadU32(const uint8_t *p) {
  uint32_t v = 0;
  for (size_t i = 0; i < 4; i++)
    v = (v << 8) | p[i];
  return v;
}
static uint64_t ReadU64(const uint8_t *p) {
  uint64_t v = 0;
  for (size_t i = 0; i < 8; i++)
    v = (v << 8) | p[i];
  return v;
}

static NSData *HashDomainData(const uint8_t *domain, size_t domainLength,
                              NSData *suffix) {
  NSMutableData *input = [NSMutableData dataWithBytes:domain
                                               length:domainLength];
  [input appendData:suffix];
  uint8_t digest[32] = {0};
  if (anc_pv_blake2b_256(digest, input.bytes, input.length) != ANC_PV_CRYPTO_OK)
    return nil;
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  anc_pv_zeroize(input.mutableBytes, input.length);
  return result;
}

static NSData *VaultDigest(NSString *vaultId) {
  NSData *utf8 = [vaultId dataUsingEncoding:NSUTF8StringEncoding];
  if (utf8.length == 0 || utf8.length > UINT32_MAX)
    return nil;
  uint8_t length[4];
  WriteU32(length, (uint32_t)utf8.length);
  NSMutableData *suffix = [NSMutableData dataWithBytes:length length:4];
  [suffix appendData:utf8];
  return HashDomainData(kVaultDigestDomain, sizeof kVaultDigestDomain, suffix);
}

static BOOL DeriveAuthorityKey(uint8_t output[32], const uint8_t localKey[32],
                               NSData *vaultDigest, uint64_t generation) {
  if (localKey == NULL || vaultDigest.length != 32)
    return NO;
  NSMutableData *message =
      [NSMutableData dataWithBytes:kAuthorityKeyDomain
                            length:sizeof kAuthorityKeyDomain];
  [message appendData:vaultDigest];
  uint8_t generationBytes[8];
  WriteU64(generationBytes, generation);
  [message appendBytes:generationBytes length:8];
  AncPrivateVaultCryptoStatus status =
      anc_pv_blake2b_256_keyed(output, message.bytes, message.length, localKey);
  anc_pv_zeroize(message.mutableBytes, message.length);
  return status == ANC_PV_CRYPTO_OK;
}

static NSData *FrameDigest(NSData *frame) {
  return HashDomainData(kFrameDigestDomain, sizeof kFrameDigestDomain, frame);
}

static NSData *EncodeFrame(NSData *plaintext, NSString *vaultId,
                           uint64_t generation, const uint8_t localKey[32],
                           NSData *nonce, NSData **outDigest) {
  if (plaintext.length == 0 ||
      plaintext.length > ANC_PV_AUTHORITY_SNAPSHOT_MAX_BYTES ||
      plaintext.length > UINT32_MAX - ANC_PV_AUTH_BYTES || nonce.length != 24)
    return nil;
  NSData *vaultDigest = VaultDigest(vaultId);
  if (vaultDigest == nil)
    return nil;
  const uint32_t cipherLength = (uint32_t)plaintext.length + ANC_PV_AUTH_BYTES;
  NSMutableData *frame = [NSMutableData
      dataWithLength:ANC_PV_AUTHORITY_FRAME_HEADER_BYTES + cipherLength];
  uint8_t *bytes = frame.mutableBytes;
  memcpy(bytes, kAuthorityMagic, 8);
  WriteU16(bytes + 8, ANC_PV_AUTHORITY_FRAME_VERSION);
  WriteU16(bytes + 10, 0);
  WriteU64(bytes + 12, generation);
  WriteU32(bytes + 20, (uint32_t)plaintext.length);
  WriteU32(bytes + 24, cipherLength);
  memcpy(bytes + 28, vaultDigest.bytes, 32);
  memcpy(bytes + 60, nonce.bytes, 24);
  NSMutableData *aad = [NSMutableData dataWithBytes:kAuthorityAADDomain
                                             length:sizeof kAuthorityAADDomain];
  [aad appendBytes:bytes length:ANC_PV_AUTHORITY_FRAME_HEADER_BYTES];
  uint8_t key[32] = {0};
  size_t written = 0;
  BOOL okay = DeriveAuthorityKey(key, localKey, vaultDigest, generation) &&
              anc_pv_xchacha20poly1305_encrypt(
                  bytes + ANC_PV_AUTHORITY_FRAME_HEADER_BYTES, cipherLength,
                  &written, plaintext.bytes, plaintext.length, aad.bytes,
                  aad.length, nonce.bytes, key) == ANC_PV_CRYPTO_OK &&
              written == cipherLength;
  ClearAuthorityKey(key);
  anc_pv_zeroize(aad.mutableBytes, aad.length);
  if (!okay) {
    anc_pv_zeroize(frame.mutableBytes, frame.length);
    return nil;
  }
  NSData *digest = FrameDigest(frame);
  if (digest == nil) {
    anc_pv_zeroize(frame.mutableBytes, frame.length);
    return nil;
  }
  if (outDigest)
    *outDigest = digest;
  return frame;
}

static NSData *DecodeFrame(NSData *frame, NSString *vaultId,
                           uint64_t generation, const uint8_t localKey[32],
                           NSData **outDigest) {
  if (frame.length < ANC_PV_AUTHORITY_FRAME_HEADER_BYTES + ANC_PV_AUTH_BYTES)
    return nil;
  const uint8_t *bytes = frame.bytes;
  uint32_t plainLength = ReadU32(bytes + 20);
  uint32_t cipherLength = ReadU32(bytes + 24);
  NSData *vaultDigest = VaultDigest(vaultId);
  if (memcmp(bytes, kAuthorityMagic, 8) != 0 ||
      ReadU16(bytes + 8) != ANC_PV_AUTHORITY_FRAME_VERSION ||
      ReadU16(bytes + 10) != 0 || ReadU64(bytes + 12) != generation ||
      plainLength == 0 || plainLength > ANC_PV_AUTHORITY_SNAPSHOT_MAX_BYTES ||
      cipherLength != plainLength + ANC_PV_AUTH_BYTES ||
      frame.length != ANC_PV_AUTHORITY_FRAME_HEADER_BYTES + cipherLength ||
      vaultDigest == nil ||
      anc_pv_memcmp(bytes + 28, vaultDigest.bytes, 32) != ANC_PV_CRYPTO_OK)
    return nil;
  NSMutableData *aad = [NSMutableData dataWithBytes:kAuthorityAADDomain
                                             length:sizeof kAuthorityAADDomain];
  [aad appendBytes:bytes length:ANC_PV_AUTHORITY_FRAME_HEADER_BYTES];
  NSMutableData *plaintext = [NSMutableData dataWithLength:plainLength];
  uint8_t key[32] = {0};
  size_t written = 0;
  BOOL okay = DeriveAuthorityKey(key, localKey, vaultDigest, generation) &&
              anc_pv_xchacha20poly1305_decrypt(
                  plaintext.mutableBytes, plainLength, &written,
                  bytes + ANC_PV_AUTHORITY_FRAME_HEADER_BYTES, cipherLength,
                  aad.bytes, aad.length, bytes + 60, key) == ANC_PV_CRYPTO_OK &&
              written == plainLength;
  ClearAuthorityKey(key);
  anc_pv_zeroize(aad.mutableBytes, aad.length);
  if (!okay) {
    anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
    return nil;
  }
  NSData *digest = FrameDigest(frame);
  if (digest == nil) {
    anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
    return nil;
  }
  if (outDigest)
    *outDigest = digest;
  return plaintext;
}

static BOOL
CustodyVaultIdMatches(NSString *vaultId,
                      const AncPrivateVaultCustodySnapshot *custody) {
  NSData *encoded = [vaultId dataUsingEncoding:NSUTF8StringEncoding];
  return encoded.length > 0 && encoded.length == custody->vault_id_length &&
         anc_pv_memcmp(encoded.bytes, custody->vault_id, encoded.length) ==
             ANC_PV_CRYPTO_OK;
}

static BOOL CustodyOpaqueIdMatches(NSString *expected,
                                   const uint8_t bytes[ANC_PV_CUSTODY_ID_BYTES],
                                   size_t length) {
  NSData *encoded = [expected dataUsingEncoding:NSUTF8StringEncoding];
  return encoded.length > 0 && encoded.length == length &&
         anc_pv_memcmp(encoded.bytes, bytes, length) == ANC_PV_CRYPTO_OK;
}

static BOOL
AuthoritySnapshotMatchesCustody(AncPrivateVaultAuthoritySnapshot *snapshot,
                                NSString *vaultId,
                                const AncPrivateVaultCustodySnapshot *custody,
                                NSData *frameDigest, uint64_t expectedEpoch) {
  return snapshot != nil && frameDigest.length == ANC_PV_HASH_BYTES &&
         custody->record_version == ANC_PV_CUSTODY_VERSION &&
         custody->authority_anchor_present == 1 &&
         [snapshot.vaultId isEqualToString:vaultId] &&
         CustodyVaultIdMatches(vaultId, custody) &&
         snapshot.targetCustodyGeneration == custody->custody_generation &&
         snapshot.sequence == custody->anchored_sequence &&
         snapshot.headHash.length == ANC_PV_HASH_BYTES &&
         anc_pv_memcmp(snapshot.headHash.bytes, custody->anchored_head,
                       ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK &&
         snapshot.membershipHash.length == ANC_PV_HASH_BYTES &&
         anc_pv_memcmp(snapshot.membershipHash.bytes,
                       custody->membership_digest,
                       ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK &&
         snapshot.signedAtMs == custody->signed_at_ms &&
         snapshot.verifiedAtMs == custody->freshness_ms &&
         snapshot.epoch == expectedEpoch &&
         snapshot.recoveryGeneration == custody->recovery_generation &&
         anc_pv_memcmp(frameDigest.bytes, custody->snapshot_digest,
                       ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK;
}

static BOOL CloseCustodyHandle(AncPrivateVaultCustodyHandle *handle) {
  return handle == nil ||
         [handle close] == AncPrivateVaultCustodyRepositoryStatusOK;
}

static AncPrivateVaultAuthorityStoreStatus AuthorityStatusForCustodyFailure(
    AncPrivateVaultCustodyRepositoryStatus status) {
  switch (status) {
  case AncPrivateVaultCustodyRepositoryStatusInaccessible:
  case AncPrivateVaultCustodyRepositoryStatusFailed:
    return AncPrivateVaultAuthorityStoreStatusProtectionFailed;
  case AncPrivateVaultCustodyRepositoryStatusConflict:
    return AncPrivateVaultAuthorityStoreStatusConflict;
  case AncPrivateVaultCustodyRepositoryStatusRollbackDetected:
    return AncPrivateVaultAuthorityStoreStatusRollbackDetected;
  case AncPrivateVaultCustodyRepositoryStatusNotFound:
    return AncPrivateVaultAuthorityStoreStatusNotFound;
  case AncPrivateVaultCustodyRepositoryStatusInvalid:
  case AncPrivateVaultCustodyRepositoryStatusCorrupt:
  case AncPrivateVaultCustodyRepositoryStatusOK:
    return AncPrivateVaultAuthorityStoreStatusCorrupt;
  }
}

@interface AncPrivateVaultAuthorityCheckpoint ()
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) uint64_t custodyGeneration;
@property(nonatomic, readwrite) NSData *frameDigest;
@property(nonatomic, readwrite) AncPrivateVaultAuthoritySnapshot *snapshot;
@end
@implementation AncPrivateVaultAuthorityCheckpoint
@end

static void AuthorityRaiseImmutableMutation(void) {
  [NSException raise:NSInternalInconsistencyException
              format:@"verified authority commit values are immutable"];
}

@interface AncPrivateVaultImmutableAuthorityCheckpoint
    : AncPrivateVaultAuthorityCheckpoint
@end
@implementation AncPrivateVaultImmutableAuthorityCheckpoint
- (void)setVaultId:(NSString *)value {
  (void)value;
  AuthorityRaiseImmutableMutation();
}
- (void)setCustodyGeneration:(uint64_t)value {
  (void)value;
  AuthorityRaiseImmutableMutation();
}
- (void)setFrameDigest:(NSData *)value {
  (void)value;
  AuthorityRaiseImmutableMutation();
}
- (void)setSnapshot:(AncPrivateVaultAuthoritySnapshot *)value {
  (void)value;
  AuthorityRaiseImmutableMutation();
}
- (void)setValue:(id)value forKey:(NSString *)key {
  (void)value;
  (void)key;
  AuthorityRaiseImmutableMutation();
}
@end

@interface AncPrivateVaultVerifiedReplayResult ()
@property(nonatomic, readwrite, nullable)
    AncPrivateVaultAuthorityCheckpoint *expectedCheckpoint;
@property(nonatomic, readwrite) AncPrivateVaultAuthoritySnapshot *nextSnapshot;
@property(nonatomic, readwrite)
    AncPrivateVaultCustodyEpochTransition epochTransition;
@end

@interface AncPrivateVaultImmutableVerifiedReplayResult
    : AncPrivateVaultVerifiedReplayResult
@end

@interface AncPrivateVaultVerifiedEvidence : NSObject
@property(nonatomic, nullable) NSData *expectedCanonical;
@property(nonatomic) NSData *nextCanonical;
@property(nonatomic) NSString *vaultId;
@property(nonatomic) uint64_t expectedGeneration;
@property(nonatomic) NSData *expectedFrameDigest;
@property(nonatomic) uint64_t verifiedAtMs;
@property(nonatomic) AncPrivateVaultCustodyEpochTransition transition;
@property(nonatomic) NSData *replayEntryHash;
@property(nonatomic) BOOL testOnly;
@property(nonatomic) BOOL genesis;
@property(nonatomic) BOOL recoveryBootstrap;
@property(nonatomic) BOOL enrollmentBootstrap;
@property(nonatomic, nullable) NSData *authorizationDigest;
@property(nonatomic, nullable) NSString *genesisCeremonyId;
@property(nonatomic, nullable) NSString *genesisEndpointId;
@property(nonatomic, nullable) NSData *genesisEndpointSigningPublicKey;
@property(nonatomic, nullable) NSData *genesisEndpointAgreementPublicKey;
@property(nonatomic, nullable) NSData *genesisBootstrapTranscriptDigest;
@property(nonatomic) uint64_t recoveryPriorSequence;
@property(nonatomic) uint64_t recoveryPriorEpoch;
@property(nonatomic) uint64_t recoveryPriorGeneration;
@property(nonatomic, nullable) NSData *recoveryPriorHead;
@property(nonatomic, nullable) NSString *recoveryCeremonyId;
@property(nonatomic, nullable) NSString *recoveryCandidateEndpointId;
@property(nonatomic, nullable) NSData *recoveryCandidateSigningPublicKey;
@property(nonatomic, nullable) NSData *recoveryCandidateAgreementPublicKey;
@property(nonatomic) uint64_t enrollmentPriorSequence;
@property(nonatomic) uint64_t enrollmentPriorEpoch;
@property(nonatomic) uint64_t enrollmentPriorRecoveryGeneration;
@property(nonatomic, nullable) NSData *enrollmentPriorHead;
@property(nonatomic, nullable) NSData *enrollmentPriorMembershipHash;
@property(nonatomic, nullable) NSString *enrollmentCeremonyId;
@property(nonatomic, nullable) NSString *enrollmentCandidateEndpointId;
@property(nonatomic, nullable) NSString *enrollmentCandidateRole;
@property(nonatomic) BOOL enrollmentCandidateUnattended;
@property(nonatomic, nullable) NSData *enrollmentCandidateSigningPublicKey;
@property(nonatomic, nullable) NSData *enrollmentCandidateAgreementPublicKey;
@end
@implementation AncPrivateVaultVerifiedEvidence
@end

static BOOL AuthorityGenesisEvidenceMatchesPendingCustody(
    AncPrivateVaultVerifiedEvidence *evidence,
    const AncPrivateVaultCustodySnapshot *custody) {
  return evidence.genesis && evidence.genesisCeremonyId.length > 0 &&
         evidence.genesisEndpointId.length > 0 &&
         evidence.genesisEndpointSigningPublicKey.length == 32 &&
         evidence.genesisEndpointAgreementPublicKey.length == 32 &&
         evidence.genesisBootstrapTranscriptDigest.length == 32 &&
         CustodyOpaqueIdMatches(evidence.genesisCeremonyId,
                                custody->ceremony_id,
                                custody->ceremony_id_length) &&
         CustodyOpaqueIdMatches(evidence.genesisEndpointId,
                                custody->endpoint_id,
                                custody->endpoint_id_length) &&
         anc_pv_memcmp(evidence.genesisEndpointSigningPublicKey.bytes,
                       custody->signing_public_key, 32) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(evidence.genesisEndpointAgreementPublicKey.bytes,
                       custody->box_public_key, 32) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(evidence.genesisBootstrapTranscriptDigest.bytes,
                       custody->pending_transcript_digest,
                       32) == ANC_PV_CRYPTO_OK;
}

static BOOL AuthorityRecoveryEvidenceMatchesPendingCustody(
    AncPrivateVaultVerifiedEvidence *evidence,
    const AncPrivateVaultCustodySnapshot *custody) {
  return evidence.recoveryBootstrap &&
         evidence.authorizationDigest.length == ANC_PV_HASH_BYTES &&
         evidence.recoveryPriorHead.length == ANC_PV_HASH_BYTES &&
         evidence.recoveryCeremonyId.length > 0 &&
         evidence.recoveryCandidateEndpointId.length > 0 &&
         evidence.recoveryCandidateSigningPublicKey.length ==
             ANC_PV_SIGN_PUBLIC_KEY_BYTES &&
         evidence.recoveryCandidateAgreementPublicKey.length ==
             ANC_PV_BOX_PUBLIC_KEY_BYTES &&
         custody->expected_next_sequence ==
             evidence.recoveryPriorSequence + 1 &&
         custody->pending_epoch == evidence.recoveryPriorEpoch + 1 &&
         custody->recovery_generation == evidence.recoveryPriorGeneration + 1 &&
         CustodyOpaqueIdMatches(evidence.recoveryCeremonyId,
                                custody->ceremony_id,
                                custody->ceremony_id_length) &&
         CustodyOpaqueIdMatches(evidence.recoveryCandidateEndpointId,
                                custody->endpoint_id,
                                custody->endpoint_id_length) &&
         anc_pv_memcmp(evidence.recoveryCandidateSigningPublicKey.bytes,
                       custody->signing_public_key,
                       ANC_PV_SIGN_PUBLIC_KEY_BYTES) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(evidence.recoveryCandidateAgreementPublicKey.bytes,
                       custody->box_public_key,
                       ANC_PV_BOX_PUBLIC_KEY_BYTES) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(evidence.recoveryPriorHead.bytes,
                       custody->expected_previous_head,
                       ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(evidence.authorizationDigest.bytes,
                       custody->pending_transcript_digest,
                       ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK;
}

static BOOL AuthorityEnrollmentEvidenceMatchesPendingCustody(
    AncPrivateVaultVerifiedEvidence *evidence,
    const AncPrivateVaultCustodySnapshot *custody) {
  return evidence.enrollmentBootstrap &&
         evidence.authorizationDigest.length == ANC_PV_HASH_BYTES &&
         evidence.enrollmentPriorHead.length == ANC_PV_HASH_BYTES &&
         evidence.enrollmentPriorMembershipHash.length == ANC_PV_HASH_BYTES &&
         evidence.enrollmentCeremonyId.length > 0 &&
         evidence.enrollmentCandidateEndpointId.length > 0 &&
         ([evidence.enrollmentCandidateRole isEqualToString:@"endpoint"] ||
          [evidence.enrollmentCandidateRole isEqualToString:@"broker"]) &&
         custody->role ==
             ([evidence.enrollmentCandidateRole isEqualToString:@"broker"]
                  ? ANC_PV_CUSTODY_ROLE_BROKER
                  : ANC_PV_CUSTODY_ROLE_ENDPOINT) &&
         custody->pending_kind ==
             ([evidence.enrollmentCandidateRole isEqualToString:@"broker"]
                  ? ANC_PV_CUSTODY_PENDING_ADD_BROKER
                  : ANC_PV_CUSTODY_PENDING_ADD_DEVICE) &&
         evidence.enrollmentCandidateUnattended ==
             [evidence.enrollmentCandidateRole isEqualToString:@"broker"] &&
         evidence.enrollmentCandidateSigningPublicKey.length ==
             ANC_PV_SIGN_PUBLIC_KEY_BYTES &&
         evidence.enrollmentCandidateAgreementPublicKey.length ==
             ANC_PV_BOX_PUBLIC_KEY_BYTES &&
         custody->anchored_sequence == evidence.enrollmentPriorSequence &&
         custody->expected_next_sequence ==
             evidence.enrollmentPriorSequence + 1 &&
         custody->active_epoch == evidence.enrollmentPriorEpoch &&
         custody->recovery_generation ==
             evidence.enrollmentPriorRecoveryGeneration &&
         CustodyOpaqueIdMatches(evidence.enrollmentCeremonyId,
                                custody->ceremony_id,
                                custody->ceremony_id_length) &&
         CustodyOpaqueIdMatches(evidence.enrollmentCandidateEndpointId,
                                custody->endpoint_id,
                                custody->endpoint_id_length) &&
         anc_pv_memcmp(evidence.enrollmentCandidateSigningPublicKey.bytes,
                       custody->signing_public_key,
                       ANC_PV_SIGN_PUBLIC_KEY_BYTES) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(evidence.enrollmentCandidateAgreementPublicKey.bytes,
                       custody->box_public_key,
                       ANC_PV_BOX_PUBLIC_KEY_BYTES) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(evidence.enrollmentPriorHead.bytes,
                       custody->anchored_head,
                       ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(evidence.enrollmentPriorHead.bytes,
                       custody->expected_previous_head,
                       ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(evidence.enrollmentPriorMembershipHash.bytes,
                       custody->membership_digest,
                       ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK &&
         anc_pv_memcmp(evidence.authorizationDigest.bytes,
                       custody->pending_transcript_digest,
                       ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK;
}

static BOOL AuthorityRegisterVerifiedEvidence(
    AncPrivateVaultVerifiedReplayResult *result,
    AncPrivateVaultAuthorityCheckpoint *checkpoint,
    AncPrivateVaultAuthoritySnapshot *nextSnapshot,
    AncPrivateVaultCustodyEpochTransition transition, NSData *entryHash,
    BOOL testOnly);
static NSMapTable<AncPrivateVaultVerifiedReplayResult *,
                  AncPrivateVaultVerifiedEvidence *> *
AuthorityVerifiedRegistry(void);
static NSLock *AuthorityVerifiedRegistryLock(void);
static AncPrivateVaultAuthorityMember *
AuthorityMemberWithId(NSArray<AncPrivateVaultAuthorityMember *> *members,
                      NSString *endpointId);
@implementation AncPrivateVaultImmutableVerifiedReplayResult
- (void)setExpectedCheckpoint:(AncPrivateVaultAuthorityCheckpoint *)value {
  (void)value;
  AuthorityRaiseImmutableMutation();
}
- (void)setNextSnapshot:(AncPrivateVaultAuthoritySnapshot *)value {
  (void)value;
  AuthorityRaiseImmutableMutation();
}
- (void)setEpochTransition:(AncPrivateVaultCustodyEpochTransition)value {
  (void)value;
  AuthorityRaiseImmutableMutation();
}
- (void)setValue:(id)value forKey:(NSString *)key {
  (void)value;
  (void)key;
  AuthorityRaiseImmutableMutation();
}
@end

@implementation AncPrivateVaultVerifiedReplayResult
- (void)setValue:(id)value forKey:(NSString *)key {
  (void)value;
  (void)key;
  [NSException raise:NSInternalInconsistencyException
              format:@"verified replay results are immutable"];
}
#if ANC_PRIVATE_VAULT_TESTING
+ (instancetype)
    testResultWithExpectedCheckpoint:
        (AncPrivateVaultAuthorityCheckpoint *)checkpoint
                        nextSnapshot:
                            (AncPrivateVaultAuthoritySnapshot *)snapshot
                     epochTransition:
                         (AncPrivateVaultCustodyEpochTransition)transition {
  AncPrivateVaultVerifiedReplayResult *result = [super new];
  result.expectedCheckpoint = checkpoint;
  AncPrivateVaultAuthoritySnapshotStatus status;
  NSData *canonical = AncPrivateVaultAuthoritySnapshotEncode(snapshot, &status);
  result.nextSnapshot =
      canonical == nil
          ? nil
          : AncPrivateVaultAuthoritySnapshotDecode(canonical, &status);
  result.epochTransition = transition;
  if (result.nextSnapshot == nil ||
      !AuthorityRegisterVerifiedEvidence(result, checkpoint,
                                         result.nextSnapshot, transition,
                                         result.nextSnapshot.headHash, YES))
    return nil;
  return result;
}
+ (instancetype)
    testGenesisResultWithSnapshot:(AncPrivateVaultAuthoritySnapshot *)snapshot
                       ceremonyId:(NSString *)ceremonyId
                       endpointId:(NSString *)endpointId
               endpointSigningKey:(NSData *)endpointSigningKey
             endpointAgreementKey:(NSData *)endpointAgreementKey
        bootstrapTranscriptDigest:(NSData *)bootstrapTranscriptDigest {
  AncPrivateVaultAuthoritySnapshotStatus status;
  NSData *canonical = AncPrivateVaultAuthoritySnapshotEncode(snapshot, &status);
  AncPrivateVaultAuthoritySnapshot *frozen =
      canonical == nil
          ? nil
          : AncPrivateVaultAuthoritySnapshotDecode(canonical, &status);
  if (frozen == nil || frozen.targetCustodyGeneration != 2 ||
      frozen.previousCustodyGeneration != 1 || frozen.previousSequence != nil ||
      frozen.previousHead != nil || frozen.sequence != 0 ||
      ceremonyId.length == 0 || endpointId.length == 0 ||
      endpointSigningKey.length != 32 || endpointAgreementKey.length != 32 ||
      bootstrapTranscriptDigest.length != 32)
    return nil;
  AncPrivateVaultVerifiedReplayResult *result = [super new];
  result.expectedCheckpoint = nil;
  result.nextSnapshot = frozen;
  result.epochTransition =
      AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch;
  AncPrivateVaultVerifiedEvidence *e = [AncPrivateVaultVerifiedEvidence new];
  e.nextCanonical = [canonical copy];
  e.vaultId = [frozen.vaultId copy];
  e.expectedGeneration = 1;
  e.verifiedAtMs = frozen.verifiedAtMs;
  e.transition = AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch;
  e.replayEntryHash = [frozen.headHash copy];
  e.genesis = YES;
  e.testOnly = YES;
  e.genesisCeremonyId = [ceremonyId copy];
  e.genesisEndpointId = [endpointId copy];
  e.genesisEndpointSigningPublicKey = [endpointSigningKey copy];
  e.genesisEndpointAgreementPublicKey = [endpointAgreementKey copy];
  e.genesisBootstrapTranscriptDigest = [bootstrapTranscriptDigest copy];
  NSLock *lock = AuthorityVerifiedRegistryLock();
  [lock lock];
  @try {
    if (AuthorityVerifiedRegistry().count >= 1024)
      return nil;
    [AuthorityVerifiedRegistry() setObject:e forKey:result];
  } @finally {
    [lock unlock];
  }
  return result;
}
+ (instancetype)
    testEnrollmentResultWithSnapshot:
        (AncPrivateVaultAuthoritySnapshot *)snapshot
                 authorizationDigest:(NSData *)authorizationDigest
                          ceremonyId:(NSString *)ceremonyId
                 candidateEndpointId:(NSString *)candidateEndpointId
           candidateSigningPublicKey:(NSData *)candidateSigningPublicKey
         candidateAgreementPublicKey:(NSData *)candidateAgreementPublicKey
                 priorMembershipHash:(NSData *)priorMembershipHash {
  AncPrivateVaultAuthoritySnapshotStatus status;
  NSData *canonical = AncPrivateVaultAuthoritySnapshotEncode(snapshot, &status);
  AncPrivateVaultAuthoritySnapshot *frozen =
      canonical == nil
          ? nil
          : AncPrivateVaultAuthoritySnapshotDecode(canonical, &status);
  if (frozen == nil || frozen.targetCustodyGeneration != 3 ||
      frozen.previousCustodyGeneration != 2 || frozen.previousSequence == nil ||
      frozen.previousHead.length != 32 ||
      frozen.sequence != frozen.previousSequence.unsignedLongLongValue + 1 ||
      frozen.epoch == 0 || frozen.recoveryGeneration == 0 ||
      authorizationDigest.length != 32 || ceremonyId.length == 0 ||
      candidateEndpointId.length == 0 ||
      candidateSigningPublicKey.length != 32 ||
      candidateAgreementPublicKey.length != 32 ||
      priorMembershipHash.length != 32)
    return nil;
  AncPrivateVaultAuthorityMember *candidate =
      AuthorityMemberWithId(frozen.activeMembers, candidateEndpointId);
  if (candidate == nil ||
      (!([candidate.role isEqualToString:@"endpoint"] &&
         !candidate.unattended) &&
       !([candidate.role isEqualToString:@"broker"] && candidate.unattended)) ||
      ![candidate.signingPublicKey isEqualToData:candidateSigningPublicKey] ||
      ![candidate.keyAgreementPublicKey
          isEqualToData:candidateAgreementPublicKey])
    return nil;
  AncPrivateVaultVerifiedReplayResult *result = [super new];
  result.expectedCheckpoint = nil;
  result.nextSnapshot = frozen;
  result.epochTransition =
      AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch;
  AncPrivateVaultVerifiedEvidence *e = [AncPrivateVaultVerifiedEvidence new];
  e.nextCanonical = [canonical copy];
  e.vaultId = [frozen.vaultId copy];
  e.expectedGeneration = 2;
  e.verifiedAtMs = frozen.verifiedAtMs;
  e.transition = AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch;
  e.replayEntryHash = [frozen.headHash copy];
  e.authorizationDigest = [authorizationDigest copy];
  e.enrollmentBootstrap = YES;
  e.testOnly = YES;
  e.enrollmentPriorSequence = frozen.previousSequence.unsignedLongLongValue;
  e.enrollmentPriorEpoch = frozen.epoch;
  e.enrollmentPriorRecoveryGeneration = frozen.recoveryGeneration;
  e.enrollmentPriorHead = [frozen.previousHead copy];
  e.enrollmentPriorMembershipHash = [priorMembershipHash copy];
  e.enrollmentCeremonyId = [ceremonyId copy];
  e.enrollmentCandidateEndpointId = [candidateEndpointId copy];
  e.enrollmentCandidateRole = [candidate.role copy];
  e.enrollmentCandidateUnattended = candidate.unattended;
  e.enrollmentCandidateSigningPublicKey = [candidateSigningPublicKey copy];
  e.enrollmentCandidateAgreementPublicKey = [candidateAgreementPublicKey copy];
  NSLock *lock = AuthorityVerifiedRegistryLock();
  [lock lock];
  @try {
    if (AuthorityVerifiedRegistry().count >= 1024)
      return nil;
    [AuthorityVerifiedRegistry() setObject:e forKey:result];
  } @finally {
    [lock unlock];
  }
  return result;
}
#endif
@end

static const uint64_t kAuthorityMaximumSafeInteger = UINT64_C(9007199254740991);

static AncPrivateVaultAuthorityMember *
AuthorityMemberWithId(NSArray<AncPrivateVaultAuthorityMember *> *members,
                      NSString *endpointId) {
  for (AncPrivateVaultAuthorityMember *member in members)
    if ([member.endpointId isEqualToString:endpointId])
      return member;
  return nil;
}

static BOOL
AuthorityMemberMatchesControl(AncPrivateVaultAuthorityMember *authority,
                              AncPrivateVaultControlLogMember *control) {
  return authority != nil &&
         [authority.endpointId isEqualToString:control.endpointId] &&
         [authority.role isEqualToString:control.role] &&
         authority.unattended == control.unattended &&
         [authority.signingPublicKey isEqualToData:control.signingPublicKey] &&
         [authority.keyAgreementPublicKey
             isEqualToData:control.keyAgreementPublicKey] &&
         [authority.enrollmentRef isEqualToString:control.enrollmentRef];
}

static BOOL
AuthorityReplayMembershipValid(AncPrivateVaultControlLogState *expected,
                               AncPrivateVaultAuthoritySnapshot *next) {
  if ([expected.membershipHash isEqualToData:next.membershipHash])
    return NO;
  NSSet<NSString *> *nextRemoved = [NSSet setWithArray:next.removedEndpointIds];
  for (NSString *removed in expected.removedEndpointIds)
    if (![nextRemoved containsObject:removed])
      return NO;
  for (AncPrivateVaultControlLogMember *member in expected.activeMembers) {
    AncPrivateVaultAuthorityMember *retained =
        AuthorityMemberWithId(next.activeMembers, member.endpointId);
    if (retained != nil && !AuthorityMemberMatchesControl(retained, member))
      return NO;
  }

  if (next.recoveryGeneration == expected.recoveryGeneration) {
    return [next.recoveryId isEqualToString:expected.recoveryId] &&
           [next.recoverySigningPublicKey
               isEqualToData:expected.recoverySigningPublicKey] &&
           [next.recoveryKeyAgreementPublicKey
               isEqualToData:expected.recoveryKeyAgreementPublicKey] &&
           ![next.recoveryWrapHash isEqualToData:expected.recoveryWrapHash];
  }
  if (expected.recoveryGeneration == kAuthorityMaximumSafeInteger ||
      next.recoveryGeneration != expected.recoveryGeneration + 1 ||
      [next.recoveryId isEqualToString:expected.recoveryId] ||
      [next.recoverySigningPublicKey
          isEqualToData:expected.recoverySigningPublicKey] ||
      [next.recoveryKeyAgreementPublicKey
          isEqualToData:expected.recoveryKeyAgreementPublicKey] ||
      [next.recoveryWrapHash isEqualToData:expected.recoveryWrapHash] ||
      next.activeMembers.count != 1 ||
      ![next.activeMembers[0].role isEqualToString:@"endpoint"] ||
      next.activeMembers[0].unattended)
    return NO;
  for (AncPrivateVaultControlLogMember *member in expected.activeMembers)
    if (![nextRemoved containsObject:member.endpointId])
      return NO;
  return YES;
}

static BOOL
AuthorityMemberMatchesAuthority(AncPrivateVaultAuthorityMember *left,
                                AncPrivateVaultAuthorityMember *right) {
  return left != nil && right != nil &&
         [left.endpointId isEqualToString:right.endpointId] &&
         [left.role isEqualToString:right.role] &&
         left.unattended == right.unattended &&
         [left.signingPublicKey isEqualToData:right.signingPublicKey] &&
         [left.keyAgreementPublicKey
             isEqualToData:right.keyAgreementPublicKey] &&
         [left.enrollmentRef isEqualToString:right.enrollmentRef];
}

static BOOL AuthoritySnapshotTransitionValid(
    AncPrivateVaultAuthoritySnapshot *expected,
    AncPrivateVaultAuthoritySnapshot *next, NSData *entryHash,
    uint64_t expectedGeneration,
    AncPrivateVaultCustodyEpochTransition transition) {
  if (expected == nil || next == nil || entryHash.length != 32 ||
      transition != AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch ||
      expectedGeneration == 0 ||
      expectedGeneration == kAuthorityMaximumSafeInteger ||
      next.targetCustodyGeneration != expectedGeneration + 1 ||
      next.previousCustodyGeneration != expectedGeneration ||
      expected.sequence == kAuthorityMaximumSafeInteger ||
      next.sequence != expected.sequence + 1 ||
      next.signedAtMs < expected.signedAtMs || next.previousSequence == nil ||
      next.previousSequence.unsignedLongLongValue != expected.sequence ||
      ![next.previousHead isEqualToData:expected.headHash] ||
      ![next.headHash isEqualToData:entryHash] ||
      expected.epoch == kAuthorityMaximumSafeInteger ||
      next.epoch != expected.epoch + 1 ||
      ![next.vaultId isEqualToString:expected.vaultId] ||
      [next.membershipHash isEqualToData:expected.membershipHash])
    return NO;

  NSSet<NSString *> *removed = [NSSet setWithArray:next.removedEndpointIds];
  for (NSString *endpointId in expected.removedEndpointIds)
    if (![removed containsObject:endpointId])
      return NO;
  for (AncPrivateVaultAuthorityMember *member in expected.activeMembers) {
    AncPrivateVaultAuthorityMember *retained =
        AuthorityMemberWithId(next.activeMembers, member.endpointId);
    if (retained != nil && !AuthorityMemberMatchesAuthority(member, retained))
      return NO;
  }

  if (next.recoveryGeneration == expected.recoveryGeneration) {
    return [next.recoveryId isEqualToString:expected.recoveryId] &&
           [next.recoverySigningPublicKey
               isEqualToData:expected.recoverySigningPublicKey] &&
           [next.recoveryKeyAgreementPublicKey
               isEqualToData:expected.recoveryKeyAgreementPublicKey] &&
           ![next.recoveryWrapHash isEqualToData:expected.recoveryWrapHash];
  }
  if (expected.recoveryGeneration == kAuthorityMaximumSafeInteger ||
      next.recoveryGeneration != expected.recoveryGeneration + 1 ||
      [next.recoveryId isEqualToString:expected.recoveryId] ||
      [next.recoverySigningPublicKey
          isEqualToData:expected.recoverySigningPublicKey] ||
      [next.recoveryKeyAgreementPublicKey
          isEqualToData:expected.recoveryKeyAgreementPublicKey] ||
      [next.recoveryWrapHash isEqualToData:expected.recoveryWrapHash] ||
      next.activeMembers.count != 1 ||
      ![next.activeMembers[0].role isEqualToString:@"endpoint"] ||
      next.activeMembers[0].unattended)
    return NO;
  for (AncPrivateVaultAuthorityMember *member in expected.activeMembers)
    if (![removed containsObject:member.endpointId])
      return NO;
  return YES;
}

static NSMapTable<AncPrivateVaultVerifiedReplayResult *,
                  AncPrivateVaultVerifiedEvidence *> *
AuthorityVerifiedRegistry(void) {
  static NSMapTable *registry;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    registry = [[NSMapTable alloc]
        initWithKeyOptions:NSPointerFunctionsWeakMemory |
                           NSPointerFunctionsObjectPointerPersonality
              valueOptions:NSPointerFunctionsStrongMemory
                  capacity:64];
  });
  return registry;
}

static NSLock *AuthorityVerifiedRegistryLock(void) {
  static NSLock *lock;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    lock = [NSLock new];
  });
  return lock;
}

static BOOL AuthorityRegisterVerifiedEvidence(
    AncPrivateVaultVerifiedReplayResult *result,
    AncPrivateVaultAuthorityCheckpoint *checkpoint,
    AncPrivateVaultAuthoritySnapshot *nextSnapshot,
    AncPrivateVaultCustodyEpochTransition transition, NSData *entryHash,
    BOOL testOnly) {
  if (result == nil || checkpoint == nil || nextSnapshot == nil ||
      checkpoint.frameDigest.length != 32 || entryHash.length != 32)
    return NO;
  AncPrivateVaultAuthoritySnapshotStatus status;
  NSData *expectedCanonical =
      AncPrivateVaultAuthoritySnapshotEncode(checkpoint.snapshot, &status);
  NSData *nextCanonical =
      AncPrivateVaultAuthoritySnapshotEncode(nextSnapshot, &status);
  if (expectedCanonical == nil || nextCanonical == nil)
    return NO;
  AncPrivateVaultVerifiedEvidence *e = [AncPrivateVaultVerifiedEvidence new];
  e.expectedCanonical = [expectedCanonical copy];
  e.nextCanonical = [nextCanonical copy];
  e.vaultId = [checkpoint.vaultId copy];
  e.expectedGeneration = checkpoint.custodyGeneration;
  e.expectedFrameDigest = [checkpoint.frameDigest copy];
  e.verifiedAtMs = nextSnapshot.verifiedAtMs;
  e.transition = transition;
  e.replayEntryHash = [entryHash copy];
  e.testOnly = testOnly;
  NSLock *lock = AuthorityVerifiedRegistryLock();
  [lock lock];
  @try {
    if (AuthorityVerifiedRegistry().count >= 1024)
      return NO;
    [AuthorityVerifiedRegistry() setObject:e forKey:result];
    return YES;
  } @finally {
    [lock unlock];
  }
}

static AncPrivateVaultVerifiedEvidence *
AuthorityCopyVerifiedEvidence(AncPrivateVaultVerifiedReplayResult *result) {
  if (result == nil)
    return nil;
#if !ANC_PRIVATE_VAULT_TESTING
  if (object_getClass(result) !=
      [AncPrivateVaultImmutableVerifiedReplayResult class])
    return nil;
#endif
  NSLock *lock = AuthorityVerifiedRegistryLock();
  [lock lock];
  AncPrivateVaultVerifiedEvidence *registered =
      [AuthorityVerifiedRegistry() objectForKey:result];
  [lock unlock];
  if (registered == nil)
    return nil;
  @try {
    BOOL bootstrap = registered.genesis || registered.recoveryBootstrap ||
                     registered.enrollmentBootstrap;
    AncPrivateVaultAuthoritySnapshotStatus status;
    NSData *presentedExpected =
        bootstrap ? nil
                  : AncPrivateVaultAuthoritySnapshotEncode(
                        result.expectedCheckpoint.snapshot, &status);
    NSData *presentedNext =
        AncPrivateVaultAuthoritySnapshotEncode(result.nextSnapshot, &status);
    if (presentedNext == nil ||
        (!bootstrap &&
         (presentedExpected == nil ||
          ![presentedExpected isEqualToData:registered.expectedCanonical])) ||
        ![presentedNext isEqualToData:registered.nextCanonical] ||
        (bootstrap && result.expectedCheckpoint != nil) ||
        (!bootstrap && (![result.expectedCheckpoint.vaultId
                            isEqualToString:registered.vaultId] ||
                        result.expectedCheckpoint.custodyGeneration !=
                            registered.expectedGeneration ||
                        ![result.expectedCheckpoint.frameDigest
                            isEqualToData:registered.expectedFrameDigest])) ||
        result.epochTransition != registered.transition)
      return nil;
  } @catch (__unused NSException *exception) {
    return nil;
  }
  AncPrivateVaultVerifiedEvidence *copy = [AncPrivateVaultVerifiedEvidence new];
  copy.expectedCanonical = [registered.expectedCanonical copy];
  copy.nextCanonical = [registered.nextCanonical copy];
  copy.vaultId = [registered.vaultId copy];
  copy.expectedGeneration = registered.expectedGeneration;
  copy.expectedFrameDigest = [registered.expectedFrameDigest copy];
  copy.verifiedAtMs = registered.verifiedAtMs;
  copy.transition = registered.transition;
  copy.replayEntryHash = [registered.replayEntryHash copy];
  copy.testOnly = registered.testOnly;
  copy.genesis = registered.genesis;
  copy.recoveryBootstrap = registered.recoveryBootstrap;
  copy.enrollmentBootstrap = registered.enrollmentBootstrap;
  copy.authorizationDigest = [registered.authorizationDigest copy];
  copy.genesisCeremonyId = [registered.genesisCeremonyId copy];
  copy.genesisEndpointId = [registered.genesisEndpointId copy];
  copy.genesisEndpointSigningPublicKey =
      [registered.genesisEndpointSigningPublicKey copy];
  copy.genesisEndpointAgreementPublicKey =
      [registered.genesisEndpointAgreementPublicKey copy];
  copy.genesisBootstrapTranscriptDigest =
      [registered.genesisBootstrapTranscriptDigest copy];
  copy.recoveryPriorSequence = registered.recoveryPriorSequence;
  copy.recoveryPriorEpoch = registered.recoveryPriorEpoch;
  copy.recoveryPriorGeneration = registered.recoveryPriorGeneration;
  copy.recoveryPriorHead = [registered.recoveryPriorHead copy];
  copy.recoveryCeremonyId = [registered.recoveryCeremonyId copy];
  copy.recoveryCandidateEndpointId =
      [registered.recoveryCandidateEndpointId copy];
  copy.recoveryCandidateSigningPublicKey =
      [registered.recoveryCandidateSigningPublicKey copy];
  copy.recoveryCandidateAgreementPublicKey =
      [registered.recoveryCandidateAgreementPublicKey copy];
  copy.enrollmentPriorSequence = registered.enrollmentPriorSequence;
  copy.enrollmentPriorEpoch = registered.enrollmentPriorEpoch;
  copy.enrollmentPriorRecoveryGeneration =
      registered.enrollmentPriorRecoveryGeneration;
  copy.enrollmentPriorHead = [registered.enrollmentPriorHead copy];
  copy.enrollmentPriorMembershipHash =
      [registered.enrollmentPriorMembershipHash copy];
  copy.enrollmentCeremonyId = [registered.enrollmentCeremonyId copy];
  copy.enrollmentCandidateEndpointId =
      [registered.enrollmentCandidateEndpointId copy];
  copy.enrollmentCandidateRole = [registered.enrollmentCandidateRole copy];
  copy.enrollmentCandidateUnattended = registered.enrollmentCandidateUnattended;
  copy.enrollmentCandidateSigningPublicKey =
      [registered.enrollmentCandidateSigningPublicKey copy];
  copy.enrollmentCandidateAgreementPublicKey =
      [registered.enrollmentCandidateAgreementPublicKey copy];
  return copy;
}

static void
AuthorityConsumeBootstrapEvidence(AncPrivateVaultVerifiedReplayResult *result) {
  NSLock *lock = AuthorityVerifiedRegistryLock();
  [lock lock];
  @try {
    AncPrivateVaultVerifiedEvidence *registered =
        [AuthorityVerifiedRegistry() objectForKey:result];
    if (registered.genesis || registered.recoveryBootstrap ||
        registered.enrollmentBootstrap)
      [AuthorityVerifiedRegistry() removeObjectForKey:result];
  } @finally {
    [lock unlock];
  }
}

static NSString *AuthorityHexId(NSData *value) {
  if (![value isKindOfClass:NSData.class] || value.length != 16)
    return nil;
  const uint8_t *bytes = value.bytes;
  NSMutableString *result = [NSMutableString stringWithCapacity:32];
  for (NSUInteger index = 0; index < value.length; index++)
    [result appendFormat:@"%02x", bytes[index]];
  return [result copy];
}

AncPrivateVaultVerifiedReplayResult *
AncPrivateVaultVerifiedGenesisReplayResultCreate(
    AncPrivateVaultControlLogReplayResult *replayResult,
    AncPrivateVaultGenesisAuthorizationResult *authorizationResult,
    uint64_t verifiedAtMs) {
  if (replayResult == nil || authorizationResult == nil || verifiedAtMs == 0 ||
      verifiedAtMs > kAuthorityMaximumSafeInteger)
    return nil;
  @try {
    NSData *authVaultId = nil, *authCeremonyId = nil, *authEndpointId = nil,
           *authSigningKey = nil, *authAgreementKey = nil,
           *authEnrollmentRef = nil, *authRecoveryId = nil,
           *authRecoverySigningKey = nil, *authRecoveryAgreementKey = nil,
           *authRecoveryWrapHash = nil, *authDigest = nil,
           *authSignedCommit = nil, *authBootstrapDigest = nil;
    if (!AncPrivateVaultGenesisAuthorizationResultCopyEvidence(
            authorizationResult, &authVaultId, &authCeremonyId, &authEndpointId,
            &authSigningKey, &authAgreementKey, &authEnrollmentRef,
            &authRecoveryId, &authRecoverySigningKey, &authRecoveryAgreementKey,
            &authRecoveryWrapHash, &authDigest, &authSignedCommit,
            &authBootstrapDigest))
      return nil;
    AncPrivateVaultControlLogState *prior = nil, *state = nil;
    NSData *entryHash = nil;
    BOOL idempotent = YES;
    if (!AncPrivateVaultControlLogReplayResultCopyEvidence(
            replayResult, &prior, &state, &entryHash, &idempotent) ||
        idempotent || prior != nil || state == nil || state.sequence != 0 ||
        state.epoch != 1 || state.recoveryGeneration != 1 ||
        state.activeMembers.count != 1 || state.removedEndpointIds.count != 0 ||
        entryHash.length != 32 || authDigest.length != 32 ||
        authSignedCommit.length == 0)
      return nil;
    NSData *signedDigest =
        AncPrivateVaultControlLogSignedEntryDomainHash(authSignedCommit);
    if (signedDigest.length != 32 ||
        anc_pv_memcmp(signedDigest.bytes, entryHash.bytes, 32) !=
            ANC_PV_CRYPTO_OK) {
      return nil;
    }
    NSString *vaultId = AuthorityHexId(authVaultId);
    NSString *ceremonyId = AuthorityHexId(authCeremonyId);
    NSString *endpointId = AuthorityHexId(authEndpointId);
    NSString *enrollmentRef = AuthorityHexId(authEnrollmentRef);
    NSString *recoveryId = AuthorityHexId(authRecoveryId);
    AncPrivateVaultControlLogMember *member = state.activeMembers[0];
    if (vaultId == nil || ceremonyId == nil || endpointId == nil ||
        authBootstrapDigest.length != 32 || enrollmentRef == nil ||
        recoveryId == nil || ![state.vaultId isEqualToString:vaultId] ||
        ![member.endpointId isEqualToString:endpointId] ||
        ![member.role isEqualToString:@"endpoint"] || member.unattended ||
        ![member.signingPublicKey isEqualToData:authSigningKey] ||
        ![member.keyAgreementPublicKey isEqualToData:authAgreementKey] ||
        ![member.enrollmentRef isEqualToString:enrollmentRef] ||
        ![state.recoveryId isEqualToString:recoveryId] ||
        ![state.recoverySigningPublicKey
            isEqualToData:authRecoverySigningKey] ||
        ![state.recoveryKeyAgreementPublicKey
            isEqualToData:authRecoveryAgreementKey] ||
        ![state.recoveryWrapHash isEqualToData:authRecoveryWrapHash])
      return nil;
    AncPrivateVaultAuthoritySnapshot *snapshot =
        AncPrivateVaultAuthoritySnapshotCreateFromVerifiedControlState(
            state, 2, 1, nil, nil, verifiedAtMs);
    if (snapshot == nil || snapshot.sequence != 0 || snapshot.epoch != 1 ||
        ![snapshot.headHash isEqualToData:entryHash])
      return nil;
    AncPrivateVaultAuthoritySnapshotStatus snapshotStatus;
    NSData *canonical =
        AncPrivateVaultAuthoritySnapshotEncode(snapshot, &snapshotStatus);
    if (canonical == nil)
      return nil;
    AncPrivateVaultVerifiedReplayResult *verified =
        class_createInstance(AncPrivateVaultVerifiedReplayResult.class, 0);
    verified.expectedCheckpoint = nil;
    verified.nextSnapshot = snapshot;
    verified.epochTransition =
        AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch;
    object_setClass(verified,
                    AncPrivateVaultImmutableVerifiedReplayResult.class);
    AncPrivateVaultVerifiedEvidence *e = [AncPrivateVaultVerifiedEvidence new];
    e.nextCanonical = [canonical copy];
    e.vaultId = [vaultId copy];
    e.expectedGeneration = 1;
    e.verifiedAtMs = verifiedAtMs;
    e.transition = AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch;
    e.replayEntryHash = [entryHash copy];
    e.authorizationDigest = [authDigest copy];
    e.genesisCeremonyId = ceremonyId;
    e.genesisEndpointId = endpointId;
    e.genesisEndpointSigningPublicKey = [authSigningKey copy];
    e.genesisEndpointAgreementPublicKey = [authAgreementKey copy];
    e.genesisBootstrapTranscriptDigest = [authBootstrapDigest copy];
    e.genesis = YES;
    NSLock *lock = AuthorityVerifiedRegistryLock();
    [lock lock];
    @try {
      if (AuthorityVerifiedRegistry().count >= 1024)
        return nil;
      [AuthorityVerifiedRegistry() setObject:e forKey:verified];
    } @finally {
      [lock unlock];
    }
    return verified;
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

AncPrivateVaultVerifiedReplayResult *
AncPrivateVaultVerifiedRecoveryBootstrapResultCreate(
    AncPrivateVaultPreparedRecoveryArtifacts *artifacts,
    uint64_t verifiedAtMs) {
  if (artifacts == nil || verifiedAtMs == 0 ||
      verifiedAtMs > kAuthorityMaximumSafeInteger)
    return nil;
  @try {
    AncPrivateVaultControlLogState *current = nil, *next = nil;
    NSData *entryHash = nil, *authorizationHash = nil, *ceremonyBytes = nil,
           *candidateBytes = nil, *candidateSigningKey = nil,
           *candidateAgreementKey = nil;
    if (!AncPrivateVaultPreparedRecoveryArtifactsCopyEvidence(
            artifacts, &current, &next, &entryHash, &authorizationHash,
            &ceremonyBytes, &candidateBytes, &candidateSigningKey,
            &candidateAgreementKey) ||
        current == nil || next == nil || entryHash.length != 32 ||
        authorizationHash.length != 32 || ceremonyBytes.length != 16 ||
        candidateBytes.length != 16 || candidateSigningKey.length != 32 ||
        candidateAgreementKey.length != 32 ||
        current.sequence == kAuthorityMaximumSafeInteger ||
        current.epoch == kAuthorityMaximumSafeInteger ||
        current.recoveryGeneration == kAuthorityMaximumSafeInteger ||
        next.sequence != current.sequence + 1 ||
        next.epoch != current.epoch + 1 ||
        next.recoveryGeneration != current.recoveryGeneration + 1 ||
        ![next.vaultId isEqualToString:current.vaultId] ||
        ![next.headHash isEqualToData:entryHash] ||
        next.activeMembers.count != 1 ||
        ![next.activeMembers[0].role isEqualToString:@"endpoint"] ||
        next.activeMembers[0].unattended ||
        ![next.activeMembers[0].signingPublicKey
            isEqualToData:candidateSigningKey] ||
        ![next.activeMembers[0].keyAgreementPublicKey
            isEqualToData:candidateAgreementKey])
      return nil;
    NSString *ceremonyId = AuthorityHexId(ceremonyBytes);
    NSString *candidateId = AuthorityHexId(candidateBytes);
    AncPrivateVaultControlLogMember *candidate = next.activeMembers[0];
    NSSet<NSString *> *removed = [NSSet setWithArray:next.removedEndpointIds];
    if (ceremonyId == nil || candidateId == nil ||
        ![candidate.endpointId isEqualToString:candidateId] ||
        [current.membershipHash isEqualToData:next.membershipHash] ||
        [current.recoveryId isEqualToString:next.recoveryId] ||
        [current.recoverySigningPublicKey
            isEqualToData:next.recoverySigningPublicKey] ||
        [current.recoveryKeyAgreementPublicKey
            isEqualToData:next.recoveryKeyAgreementPublicKey] ||
        [current.recoveryWrapHash isEqualToData:next.recoveryWrapHash])
      return nil;
    for (AncPrivateVaultControlLogMember *member in current.activeMembers)
      if (![removed containsObject:member.endpointId])
        return nil;
    for (NSString *previouslyRemoved in current.removedEndpointIds)
      if (![removed containsObject:previouslyRemoved])
        return nil;
    AncPrivateVaultAuthoritySnapshot *snapshot =
        AncPrivateVaultAuthoritySnapshotCreateFromVerifiedControlState(
            next, 2, 1, @(current.sequence), current.headHash, verifiedAtMs);
    if (snapshot == nil || snapshot.previousSequence == nil ||
        snapshot.previousSequence.unsignedLongLongValue != current.sequence ||
        ![snapshot.previousHead isEqualToData:current.headHash] ||
        ![snapshot.headHash isEqualToData:entryHash])
      return nil;
    AncPrivateVaultAuthoritySnapshotStatus status;
    NSData *canonical =
        AncPrivateVaultAuthoritySnapshotEncode(snapshot, &status);
    if (canonical == nil)
      return nil;
    AncPrivateVaultVerifiedReplayResult *verified =
        class_createInstance(AncPrivateVaultVerifiedReplayResult.class, 0);
    verified.expectedCheckpoint = nil;
    verified.nextSnapshot = snapshot;
    verified.epochTransition =
        AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch;
    object_setClass(verified,
                    AncPrivateVaultImmutableVerifiedReplayResult.class);
    AncPrivateVaultVerifiedEvidence *e = [AncPrivateVaultVerifiedEvidence new];
    e.nextCanonical = [canonical copy];
    e.vaultId = [next.vaultId copy];
    e.expectedGeneration = 1;
    e.verifiedAtMs = verifiedAtMs;
    e.transition = AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch;
    e.replayEntryHash = [entryHash copy];
    e.authorizationDigest = [authorizationHash copy];
    e.recoveryBootstrap = YES;
    e.recoveryPriorSequence = current.sequence;
    e.recoveryPriorEpoch = current.epoch;
    e.recoveryPriorGeneration = current.recoveryGeneration;
    e.recoveryPriorHead = [current.headHash copy];
    e.recoveryCeremonyId = ceremonyId;
    e.recoveryCandidateEndpointId = candidateId;
    e.recoveryCandidateSigningPublicKey = [candidateSigningKey copy];
    e.recoveryCandidateAgreementPublicKey = [candidateAgreementKey copy];
    NSLock *lock = AuthorityVerifiedRegistryLock();
    [lock lock];
    @try {
      if (AuthorityVerifiedRegistry().count >= 1024)
        return nil;
      [AuthorityVerifiedRegistry() setObject:e forKey:verified];
    } @finally {
      [lock unlock];
    }
    return verified;
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

#if ANC_PRIVATE_VAULT_ENROLLMENT_AUTHORITY_LINKED
AncPrivateVaultVerifiedReplayResult *
AncPrivateVaultVerifiedEnrollmentBootstrapResultCreate(
    AncPrivateVaultEnrollmentAuthorizationResult *authorization,
    AncPrivateVaultEnrollmentSasReceipt *sasReceipt, uint64_t verifiedAtMs) {
  if (authorization == nil || sasReceipt == nil || verifiedAtMs == 0 ||
      verifiedAtMs > kAuthorityMaximumSafeInteger)
    return nil;
  @try {
    NSData *authVaultId = nil, *authorizationDigest = nil,
           *authorizationEnvelopeId = nil, *candidateSigningKey = nil,
           *candidateAgreementKey = nil, *priorMembershipHash = nil,
           *signedMembershipCommit = nil, *ceremonyBytes = nil,
           *candidateBytes = nil, *offerHash = nil, *challengeHash = nil,
           *sasTranscriptHash = nil;
    NSString *candidateRole = nil;
    BOOL candidateUnattended = NO;
    uint64_t challengeCreatedAt = 0, challengeExpiresAt = 0;
    AncPrivateVaultControlLogReplayResult *replay = nil;
    if (!AncPrivateVaultEnrollmentAuthorizationCopyEvidence(
            authorization, &authVaultId, &authorizationDigest,
            &authorizationEnvelopeId, &ceremonyBytes, &candidateBytes,
            &candidateRole, &candidateUnattended, &candidateSigningKey,
            &candidateAgreementKey, &offerHash, &challengeHash,
            &sasTranscriptHash, &challengeCreatedAt, &challengeExpiresAt,
            &priorMembershipHash, &signedMembershipCommit, &replay) ||
        authVaultId.length != 16 || authorizationDigest.length != 32 ||
        authorizationEnvelopeId.length != 16 || ceremonyBytes.length != 16 ||
        candidateBytes.length != 16 ||
        (!([candidateRole isEqualToString:@"endpoint"] &&
           !candidateUnattended) &&
         !([candidateRole isEqualToString:@"broker"] && candidateUnattended)) ||
        candidateSigningKey.length != 32 ||
        candidateAgreementKey.length != 32 || offerHash.length != 32 ||
        challengeHash.length != 32 || sasTranscriptHash.length != 32 ||
        challengeCreatedAt == 0 || challengeExpiresAt < challengeCreatedAt ||
        priorMembershipHash.length != 32 ||
        signedMembershipCommit.length == 0 || replay == nil)
      return nil;
    NSString *vaultId = AuthorityHexId(authVaultId);
    NSString *ceremonyId = AuthorityHexId(ceremonyBytes);
    NSString *candidateId = AuthorityHexId(candidateBytes);
    if (vaultId == nil || ceremonyId == nil || candidateId == nil)
      return nil;

    AncPrivateVaultEnrollmentSasReceiptStatus receiptStatus;
    AncPrivateVaultEnrollmentSasReceipt *verifiedReceipt =
        AncPrivateVaultEnrollmentSasReceiptVerifyBound(
            sasReceipt.encodedReceipt, authVaultId, offerHash, challengeHash,
            sasTranscriptHash, candidateBytes, ceremonyBytes,
            candidateSigningKey, challengeCreatedAt, challengeExpiresAt,
            &receiptStatus);
    if (verifiedReceipt == nil ||
        verifiedReceipt.decision !=
            AncPrivateVaultEnrollmentSasDecisionConfirmed ||
        ![verifiedReceipt.offerHash isEqualToData:offerHash] ||
        ![verifiedReceipt.challengeHash isEqualToData:challengeHash] ||
        ![verifiedReceipt.sasTranscriptHash isEqualToData:sasTranscriptHash] ||
        verifiedReceipt.decidedAt < challengeCreatedAt ||
        verifiedReceipt.decidedAt > challengeExpiresAt ||
        ![AuthorityHexId(verifiedReceipt.ceremonyId)
            isEqualToString:ceremonyId] ||
        ![AuthorityHexId(verifiedReceipt.candidateEndpointId)
            isEqualToString:candidateId])
      return nil;

    AncPrivateVaultControlLogState *prior = nil, *next = nil;
    NSData *entryHash = nil;
    BOOL idempotent = YES;
    if (!AncPrivateVaultControlLogReplayResultCopyEvidence(
            replay, &prior, &next, &entryHash, &idempotent) ||
        idempotent || prior == nil || next == nil || entryHash.length != 32 ||
        prior.sequence == kAuthorityMaximumSafeInteger ||
        next.sequence != prior.sequence + 1 ||
        ![prior.vaultId isEqualToString:vaultId] ||
        ![next.vaultId isEqualToString:prior.vaultId] ||
        ![next.headHash isEqualToData:entryHash] ||
        ![prior.membershipHash isEqualToData:priorMembershipHash] ||
        [next.membershipHash isEqualToData:prior.membershipHash] ||
        next.epoch != prior.epoch ||
        next.recoveryGeneration != prior.recoveryGeneration ||
        ![next.recoveryId isEqualToString:prior.recoveryId] ||
        ![next.recoverySigningPublicKey
            isEqualToData:prior.recoverySigningPublicKey] ||
        ![next.recoveryKeyAgreementPublicKey
            isEqualToData:prior.recoveryKeyAgreementPublicKey] ||
        ![next.recoveryWrapHash isEqualToData:prior.recoveryWrapHash] ||
        ![[NSSet setWithArray:next.removedEndpointIds]
            isEqualToSet:[NSSet setWithArray:prior.removedEndpointIds]] ||
        next.activeMembers.count != prior.activeMembers.count + 1)
      return nil;

    for (AncPrivateVaultControlLogMember *member in prior.activeMembers) {
      AncPrivateVaultControlLogMember *retained = nil;
      for (AncPrivateVaultControlLogMember *candidate in next.activeMembers)
        if ([candidate.endpointId isEqualToString:member.endpointId]) {
          retained = candidate;
          break;
        }
      if (retained == nil || ![retained.role isEqualToString:member.role] ||
          retained.unattended != member.unattended ||
          ![retained.signingPublicKey isEqualToData:member.signingPublicKey] ||
          ![retained.keyAgreementPublicKey
              isEqualToData:member.keyAgreementPublicKey] ||
          ![retained.enrollmentRef isEqualToString:member.enrollmentRef])
        return nil;
    }
    AncPrivateVaultControlLogMember *candidate = nil;
    for (AncPrivateVaultControlLogMember *member in next.activeMembers)
      if ([member.endpointId isEqualToString:candidateId]) {
        candidate = member;
        break;
      }
    NSString *enrollmentRef = AuthorityHexId(authorizationEnvelopeId);
    if (candidate == nil || enrollmentRef == nil ||
        ![candidate.role isEqualToString:candidateRole] ||
        candidate.unattended != candidateUnattended ||
        ![candidate.signingPublicKey isEqualToData:candidateSigningKey] ||
        ![candidate.keyAgreementPublicKey
            isEqualToData:candidateAgreementKey] ||
        ![candidate.enrollmentRef isEqualToString:enrollmentRef])
      return nil;

    NSData *signedDigest =
        AncPrivateVaultControlLogSignedEntryDomainHash(signedMembershipCommit);
    if (signedDigest.length != 32 ||
        anc_pv_memcmp(signedDigest.bytes, entryHash.bytes, 32) !=
            ANC_PV_CRYPTO_OK)
      return nil;
    AncPrivateVaultAuthoritySnapshot *snapshot =
        AncPrivateVaultAuthoritySnapshotCreateFromVerifiedControlState(
            next, 3, 2, @(prior.sequence), prior.headHash, verifiedAtMs);
    if (snapshot == nil || snapshot.previousSequence == nil ||
        snapshot.previousSequence.unsignedLongLongValue != prior.sequence ||
        ![snapshot.previousHead isEqualToData:prior.headHash] ||
        ![snapshot.headHash isEqualToData:entryHash])
      return nil;
    AncPrivateVaultAuthoritySnapshotStatus snapshotStatus;
    NSData *canonical =
        AncPrivateVaultAuthoritySnapshotEncode(snapshot, &snapshotStatus);
    if (canonical == nil)
      return nil;
    AncPrivateVaultVerifiedReplayResult *verified =
        class_createInstance(AncPrivateVaultVerifiedReplayResult.class, 0);
    verified.expectedCheckpoint = nil;
    verified.nextSnapshot = snapshot;
    verified.epochTransition =
        AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch;
    object_setClass(verified,
                    AncPrivateVaultImmutableVerifiedReplayResult.class);
    AncPrivateVaultVerifiedEvidence *e = [AncPrivateVaultVerifiedEvidence new];
    e.nextCanonical = [canonical copy];
    e.vaultId = [next.vaultId copy];
    e.expectedGeneration = 2;
    e.verifiedAtMs = verifiedAtMs;
    e.transition = AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch;
    e.replayEntryHash = [entryHash copy];
    e.authorizationDigest = [authorizationDigest copy];
    e.enrollmentBootstrap = YES;
    e.enrollmentPriorSequence = prior.sequence;
    e.enrollmentPriorEpoch = prior.epoch;
    e.enrollmentPriorRecoveryGeneration = prior.recoveryGeneration;
    e.enrollmentPriorHead = [prior.headHash copy];
    e.enrollmentPriorMembershipHash = [prior.membershipHash copy];
    e.enrollmentCeremonyId = [ceremonyId copy];
    e.enrollmentCandidateEndpointId = [candidateId copy];
    e.enrollmentCandidateRole = [candidateRole copy];
    e.enrollmentCandidateUnattended = candidateUnattended;
    e.enrollmentCandidateSigningPublicKey = [candidateSigningKey copy];
    e.enrollmentCandidateAgreementPublicKey = [candidateAgreementKey copy];
    NSLock *lock = AuthorityVerifiedRegistryLock();
    [lock lock];
    @try {
      if (AuthorityVerifiedRegistry().count >= 1024)
        return nil;
      [AuthorityVerifiedRegistry() setObject:e forKey:verified];
    } @finally {
      [lock unlock];
    }
    return verified;
  } @catch (__unused NSException *exception) {
    return nil;
  }
}
#endif

AncPrivateVaultVerifiedReplayResult *AncPrivateVaultVerifiedReplayResultCreate(
    AncPrivateVaultControlLogReplayResult *replayResult,
    AncPrivateVaultAuthorityCheckpoint *expectedCheckpoint,
    uint64_t targetCustodyGeneration, uint64_t verifiedAtMs,
    AncPrivateVaultCustodyEpochTransition epochTransition) {
  if (replayResult == nil || expectedCheckpoint == nil ||
      epochTransition !=
          AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch ||
      targetCustodyGeneration == 0 || verifiedAtMs == 0 ||
      targetCustodyGeneration > kAuthorityMaximumSafeInteger ||
      verifiedAtMs > kAuthorityMaximumSafeInteger)
    return nil;
  @try {
    AncPrivateVaultControlLogState *priorState = nil;
    AncPrivateVaultControlLogState *replayedState = nil;
    NSData *entryHash = nil;
    BOOL idempotent = NO;
    if (!AncPrivateVaultControlLogReplayResultCopyEvidence(
            replayResult, &priorState, &replayedState, &entryHash,
            &idempotent) ||
        idempotent)
      return nil;
    NSString *expectedVaultId = [expectedCheckpoint.vaultId copy];
    uint64_t expectedGeneration = expectedCheckpoint.custodyGeneration;
    NSData *expectedFrameDigest = [expectedCheckpoint.frameDigest copy];
    AncPrivateVaultAuthoritySnapshot *expectedSource =
        expectedCheckpoint.snapshot;
    AncPrivateVaultAuthoritySnapshotStatus status;
    NSData *expectedCanonical =
        AncPrivateVaultAuthoritySnapshotEncode(expectedSource, &status);
    AncPrivateVaultAuthoritySnapshot *expectedSnapshot =
        expectedCanonical == nil ? nil
                                 : AncPrivateVaultAuthoritySnapshotDecode(
                                       expectedCanonical, &status);
    AncPrivateVaultControlLogState *expectedState =
        AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(
            expectedCheckpoint);
    if (replayedState == nil || priorState == nil || expectedState == nil ||
        expectedSnapshot == nil || entryHash.length != 32 ||
        expectedFrameDigest.length != 32 || expectedGeneration == 0 ||
        expectedGeneration == kAuthorityMaximumSafeInteger ||
        targetCustodyGeneration != expectedGeneration + 1 ||
        verifiedAtMs < expectedSnapshot.verifiedAtMs ||
        ![expectedVaultId isEqualToString:expectedState.vaultId] ||
        ![expectedVaultId isEqualToString:expectedSnapshot.vaultId] ||
        expectedGeneration != expectedSnapshot.targetCustodyGeneration ||
        expectedState.sequence == kAuthorityMaximumSafeInteger ||
        replayedState.sequence != expectedState.sequence + 1 ||
        priorState.sequence != expectedState.sequence ||
        ![priorState.vaultId isEqualToString:expectedState.vaultId] ||
        ![priorState.headHash isEqualToData:expectedState.headHash] ||
        ![replayedState.vaultId isEqualToString:expectedState.vaultId] ||
        expectedState.epoch == kAuthorityMaximumSafeInteger ||
        replayedState.epoch != expectedState.epoch + 1)
      return nil;

    AncPrivateVaultAuthoritySnapshot *authenticatedPriorSnapshot =
        AncPrivateVaultAuthoritySnapshotCreateFromVerifiedControlState(
            priorState, expectedSnapshot.targetCustodyGeneration,
            expectedSnapshot.previousCustodyGeneration,
            expectedSnapshot.previousSequence, expectedSnapshot.previousHead,
            expectedSnapshot.verifiedAtMs);
    NSData *authenticatedPriorCanonical =
        authenticatedPriorSnapshot == nil
            ? nil
            : AncPrivateVaultAuthoritySnapshotEncode(authenticatedPriorSnapshot,
                                                     &status);
    if (authenticatedPriorCanonical == nil ||
        ![authenticatedPriorCanonical isEqualToData:expectedCanonical])
      return nil;

    AncPrivateVaultAuthoritySnapshot *nextSnapshot =
        AncPrivateVaultAuthoritySnapshotCreateFromVerifiedControlState(
            replayedState, targetCustodyGeneration, expectedGeneration,
            @(expectedState.sequence), expectedState.headHash, verifiedAtMs);
    if (nextSnapshot == nil ||
        ![entryHash isEqualToData:nextSnapshot.headHash] ||
        ![nextSnapshot.previousHead isEqualToData:expectedState.headHash] ||
        nextSnapshot.previousSequence.unsignedLongLongValue !=
            expectedState.sequence ||
        !AuthorityReplayMembershipValid(expectedState, nextSnapshot))
      return nil;

    AncPrivateVaultAuthoritySnapshot *frozenExpected =
        AncPrivateVaultAuthoritySnapshotCreateFromVerifiedControlState(
            expectedState, expectedSnapshot.targetCustodyGeneration,
            expectedSnapshot.previousCustodyGeneration,
            expectedSnapshot.previousSequence, expectedSnapshot.previousHead,
            expectedSnapshot.verifiedAtMs);
    NSData *frozenExpectedCanonical =
        frozenExpected == nil
            ? nil
            : AncPrivateVaultAuthoritySnapshotEncode(frozenExpected, &status);
    if (frozenExpectedCanonical == nil ||
        ![frozenExpectedCanonical isEqualToData:expectedCanonical])
      return nil;

    AncPrivateVaultAuthorityCheckpoint *checkpointCopy =
        [AncPrivateVaultAuthorityCheckpoint new];
    checkpointCopy.vaultId = expectedVaultId;
    checkpointCopy.custodyGeneration = expectedGeneration;
    checkpointCopy.frameDigest = expectedFrameDigest;
    checkpointCopy.snapshot = frozenExpected;
    object_setClass(checkpointCopy,
                    [AncPrivateVaultImmutableAuthorityCheckpoint class]);

    AncPrivateVaultVerifiedReplayResult *verified =
        class_createInstance([AncPrivateVaultVerifiedReplayResult class], 0);
    verified.expectedCheckpoint = checkpointCopy;
    verified.nextSnapshot = nextSnapshot;
    verified.epochTransition = epochTransition;
    object_setClass(verified,
                    [AncPrivateVaultImmutableVerifiedReplayResult class]);
    if (!AuthorityRegisterVerifiedEvidence(verified, checkpointCopy,
                                           nextSnapshot, epochTransition,
                                           entryHash, NO))
      return nil;
    return verified;
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

@interface AncPrivateVaultAuthorityStore ()
@property(nonatomic) NSURL *authorityURL;
@property(nonatomic) AncPrivateVaultCustodyRepository *custodyRepository;
@property(nonatomic) dispatch_queue_t queue;
@property(nonatomic) dev_t directoryDevice;
@property(nonatomic) ino_t directoryInode;
@property(nonatomic) uid_t directoryOwner;
@property(nonatomic) BOOL directoryPinned;
@end

static NSMutableDictionary<NSString *, NSRecursiveLock *> *
AuthorityLockMap(void) {
  // Desktop is a single-instance writer. This map is the required in-process
  // root-identity/vault serialization boundary; cross-process exclusion is an
  // outer Desktop lifecycle contract.
  static NSMutableDictionary<NSString *, NSRecursiveLock *> *locks;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    locks = [NSMutableDictionary dictionary];
  });
  return locks;
}

static NSRecursiveLock *AuthorityNamedLock(NSString *key) {
  @synchronized(AuthorityLockMap()) {
    NSRecursiveLock *lock = AuthorityLockMap()[key];
    if (lock == nil) {
      lock = [[NSRecursiveLock alloc] init];
      AuthorityLockMap()[key] = lock;
    }
    return lock;
  }
}

@implementation AncPrivateVaultAuthorityStore
- (instancetype)initWithStateRootURL:(NSURL *)stateRootURL
                   custodyRepository:
                       (AncPrivateVaultCustodyRepository *)repository {
  self = [super init];
  if (self) {
    _custodyRepository = repository;
    _authorityURL = [[stateRootURL URLByAppendingPathComponent:@"state"
                                                   isDirectory:YES]
        URLByAppendingPathComponent:@"authority"
                        isDirectory:YES];
    _queue = dispatch_queue_create(
        "com.agentnative.private-vault.authority-store", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (BOOL)prepareDirectory {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSURL *stateURL = [self.authorityURL URLByDeletingLastPathComponent];
  if (![fm createDirectoryAtURL:stateURL
          withIntermediateDirectories:YES
                           attributes:@{NSFilePosixPermissions : @0700}
                                error:nil])
    return NO;
  chmod(stateURL.fileSystemRepresentation, 0700);
  if (![fm createDirectoryAtURL:self.authorityURL
          withIntermediateDirectories:YES
                           attributes:@{NSFilePosixPermissions : @0700}
                                error:nil])
    return NO;
  struct stat st;
  if (lstat(self.authorityURL.fileSystemRepresentation, &st) != 0 ||
      !S_ISDIR(st.st_mode) || st.st_uid != getuid() ||
      (st.st_mode & 0777) != 0700)
    return NO;
  if (!self.directoryPinned) {
    self.directoryDevice = st.st_dev;
    self.directoryInode = st.st_ino;
    self.directoryOwner = st.st_uid;
    self.directoryPinned = YES;
  } else if (self.directoryDevice != st.st_dev ||
             self.directoryInode != st.st_ino ||
             self.directoryOwner != st.st_uid) {
    return NO;
  }
  NSRegularExpression *allowed = [NSRegularExpression
      regularExpressionWithPattern:@"^[0-9a-f]{64}\\.authority(?:\\.stage)?$"
                           options:0
                             error:nil];
  NSRegularExpression *temporary = [NSRegularExpression
      regularExpressionWithPattern:@"^\\.[0-9a-f]{64}\\.[0-9a-f-]{36}\\.tmp$"
                           options:0
                             error:nil];
  int directoryFD = open(self.authorityURL.fileSystemRepresentation,
                         O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat opened;
  if (directoryFD < 0 || fstat(directoryFD, &opened) != 0 ||
      opened.st_dev != self.directoryDevice ||
      opened.st_ino != self.directoryInode ||
      opened.st_uid != self.directoryOwner || !S_ISDIR(opened.st_mode) ||
      (opened.st_mode & 0777) != 0700) {
    if (directoryFD >= 0)
      close(directoryFD);
    return NO;
  }
  int listingFD = dup(directoryFD);
  DIR *listing = listingFD < 0 ? NULL : fdopendir(listingFD);
  if (listing == NULL) {
    if (listingFD >= 0)
      close(listingFD);
    close(directoryFD);
    return NO;
  }
#if ANC_PRIVATE_VAULT_TESTING
  if (AuthorityFault(AncPrivateVaultAuthorityFaultDirectoryListingFailure)) {
    closedir(listing);
    close(directoryFD);
    return NO;
  }
#endif
  errno = 0;
  struct dirent *entry = NULL;
  while ((entry = readdir(listing)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0)
      continue;
    NSString *name = [NSString stringWithUTF8String:entry->d_name];
    if (name == nil) {
      closedir(listing);
      close(directoryFD);
      return NO;
    }
    NSRange range = NSMakeRange(0, name.length);
    if ([allowed firstMatchInString:name options:0 range:range] != nil)
      continue;
    if ([temporary firstMatchInString:name options:0 range:range] == nil) {
      closedir(listing);
      close(directoryFD);
      return NO;
    }
    struct stat tempStat;
    BOOL safe = fstatat(directoryFD, name.fileSystemRepresentation, &tempStat,
                        AT_SYMLINK_NOFOLLOW) == 0 &&
                S_ISREG(tempStat.st_mode) && tempStat.st_uid == getuid() &&
                tempStat.st_nlink == 1 && (tempStat.st_mode & 0777) == 0600;
    BOOL removed =
        safe && unlinkat(directoryFD, name.fileSystemRepresentation, 0) == 0;
    if (removed)
      removed = fsync(directoryFD) == 0;
    if (!removed) {
      closedir(listing);
      close(directoryFD);
      return NO;
    }
  }
  BOOL listingOkay = errno == 0 && closedir(listing) == 0;
  close(directoryFD);
  if (!listingOkay)
    return NO;
  return YES;
}

- (int)openValidatedDirectory {
#if ANC_PRIVATE_VAULT_TESTING
  if (AuthorityFault(AncPrivateVaultAuthorityFaultBeforeDirectoryReopen))
    return -1;
#endif
  int directoryFD = open(self.authorityURL.fileSystemRepresentation,
                         O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat st;
  if (directoryFD < 0 || fstat(directoryFD, &st) != 0 ||
      !self.directoryPinned || st.st_dev != self.directoryDevice ||
      st.st_ino != self.directoryInode || st.st_uid != self.directoryOwner ||
      !S_ISDIR(st.st_mode) || (st.st_mode & 0777) != 0700) {
    if (directoryFD >= 0)
      close(directoryFD);
    return -1;
  }
  return directoryFD;
}

- (NSRecursiveLock *)operationLockForVaultId:(NSString *)vaultId {
  NSString *pathKey = [@"path:"
      stringByAppendingString:self.authorityURL.path.stringByStandardizingPath];
  NSRecursiveLock *bootstrap = AuthorityNamedLock(pathKey);
  [bootstrap lock];
  BOOL prepared = [self prepareDirectory];
  NSString *vaultName = [self nameForVaultId:vaultId suffix:@""];
  NSString *identity =
      prepared && vaultName != nil
          ? [NSString stringWithFormat:@"identity:%llu:%llu:%u:%@",
                                       (unsigned long long)self.directoryDevice,
                                       (unsigned long long)self.directoryInode,
                                       self.directoryOwner, vaultName]
          : nil;
  NSRecursiveLock *operation =
      identity == nil ? nil : AuthorityNamedLock(identity);
  [bootstrap unlock];
  return operation;
}

- (NSString *)nameForVaultId:(NSString *)vaultId suffix:(NSString *)suffix {
  NSData *digest = VaultDigest(vaultId);
  if (digest == nil)
    return nil;
  const uint8_t *bytes = digest.bytes;
  NSMutableString *hex = [NSMutableString stringWithCapacity:64];
  for (size_t i = 0; i < 32; i++)
    [hex appendFormat:@"%02x", bytes[i]];
  return [hex stringByAppendingString:suffix];
}

- (NSData *)readFileName:(NSString *)name missing:(BOOL *)missing {
  if (missing)
    *missing = NO;
  int dir = [self openValidatedDirectory];
  if (dir < 0)
    return nil;
  int fd = openat(dir, name.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW);
  if (fd < 0) {
    if (missing && errno == ENOENT)
      *missing = YES;
    close(dir);
    return nil;
  }
  struct stat st;
  if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) || st.st_uid != getuid() ||
      st.st_nlink != 1 || (st.st_mode & 0777) != 0600 || st.st_size < 0 ||
      st.st_size > ANC_PV_AUTHORITY_FRAME_HEADER_BYTES +
                       ANC_PV_AUTHORITY_SNAPSHOT_MAX_BYTES +
                       ANC_PV_AUTH_BYTES) {
    close(fd);
    close(dir);
    return nil;
  }
  NSMutableData *data = [NSMutableData dataWithLength:(NSUInteger)st.st_size];
  size_t offset = 0;
  while (offset < data.length) {
    ssize_t n =
        read(fd, (uint8_t *)data.mutableBytes + offset, data.length - offset);
    if (n <= 0) {
      data = nil;
      break;
    }
    offset += (size_t)n;
  }
  close(fd);
  close(dir);
  return data;
}

- (BOOL)writeStage:(NSData *)frame vaultId:(NSString *)vaultId {
  if (![self prepareDirectory])
    return NO;
  NSString *stage = [self nameForVaultId:vaultId suffix:@".authority.stage"];
  NSString *temporary = [NSString
      stringWithFormat:@".%@.%@.tmp", [self nameForVaultId:vaultId suffix:@""],
                       NSUUID.UUID.UUIDString.lowercaseString];
  int dir = [self openValidatedDirectory];
  if (dir < 0)
    return NO;
  int fd = openat(dir, temporary.fileSystemRepresentation,
                  O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  BOOL okay = fd >= 0;
  size_t offset = 0;
  while (okay && offset < frame.length) {
    ssize_t n =
        write(fd, (const uint8_t *)frame.bytes + offset, frame.length - offset);
    if (n <= 0)
      okay = NO;
    else
      offset += (size_t)n;
  }
  if (okay &&
      AuthorityFault(AncPrivateVaultAuthorityFaultAfterTemporaryWrite)) {
    close(fd);
    close(dir);
    return NO;
  }
  if (okay)
    okay = fsync(fd) == 0;
  if (okay &&
      AuthorityFault(AncPrivateVaultAuthorityFaultAfterTemporaryFsync)) {
    close(fd);
    close(dir);
    return NO;
  }
  if (fd >= 0)
    close(fd);
  if (okay)
    okay = renameat(dir, temporary.fileSystemRepresentation, dir,
                    stage.fileSystemRepresentation) == 0;
  if (okay && AuthorityFault(AncPrivateVaultAuthorityFaultAfterStageRename)) {
    close(dir);
    return NO;
  }
  if (okay)
    okay = fsync(dir) == 0;
  if (okay &&
      AuthorityFault(AncPrivateVaultAuthorityFaultAfterStageDirectoryFsync)) {
    close(dir);
    return NO;
  }
  if (!okay)
    unlinkat(dir, temporary.fileSystemRepresentation, 0);
  close(dir);
  return okay;
}

- (BOOL)promoteStageForVaultId:(NSString *)vaultId {
  NSString *stage = [self nameForVaultId:vaultId suffix:@".authority.stage"];
  NSString *live = [self nameForVaultId:vaultId suffix:@".authority"];
  int dir = [self openValidatedDirectory];
  if (dir < 0)
    return NO;
  BOOL okay = renameat(dir, stage.fileSystemRepresentation, dir,
                       live.fileSystemRepresentation) == 0;
  if (okay && AuthorityFault(AncPrivateVaultAuthorityFaultAfterLivePromote)) {
    close(dir);
    return NO;
  }
  if (okay)
    okay = fsync(dir) == 0;
  if (okay &&
      AuthorityFault(AncPrivateVaultAuthorityFaultAfterLiveDirectoryFsync)) {
    close(dir);
    return NO;
  }
  close(dir);
  return okay;
}

- (BOOL)removeStageForVaultId:(NSString *)vaultId {
  NSString *stage = [self nameForVaultId:vaultId suffix:@".authority.stage"];
  int dir = [self openValidatedDirectory];
  if (dir < 0)
    return NO;
  BOOL okay =
      unlinkat(dir, stage.fileSystemRepresentation, 0) == 0 || errno == ENOENT;
  if (okay)
    okay = fsync(dir) == 0;
  close(dir);
  return okay;
}

- (AncPrivateVaultAuthorityStoreStatus)
    loadVaultId:(NSString *)vaultId
     checkpoint:(AncPrivateVaultAuthorityCheckpoint **)checkpoint
          error:(NSError **)error {
  (void)error;
  if (checkpoint)
    *checkpoint = nil;
  if (vaultId.length == 0)
    return AncPrivateVaultAuthorityStoreStatusInvalid;
  NSRecursiveLock *operationLock = [self operationLockForVaultId:vaultId];
  if (operationLock == nil)
    return AncPrivateVaultAuthorityStoreStatusStorageFailed;
  [operationLock lock];
  @try {
    __block AncPrivateVaultAuthorityStoreStatus result;
    __block AncPrivateVaultAuthorityCheckpoint *loadedCheckpoint = nil;
    dispatch_sync(self.queue, ^{
      AncPrivateVaultCustodySnapshot custody;
      AncPrivateVaultCustodyHandle *handle = nil;
      AncPrivateVaultCustodyRepositoryStatus cs =
          [self.custodyRepository readVaultId:vaultId
                                     snapshot:&custody
                                       handle:&handle];
      if (cs == AncPrivateVaultCustodyRepositoryStatusNotFound) {
        result = CloseCustodyHandle(handle)
                     ? AncPrivateVaultAuthorityStoreStatusNotFound
                     : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      if (cs != AncPrivateVaultCustodyRepositoryStatusOK) {
        result = CloseCustodyHandle(handle)
                     ? AuthorityStatusForCustodyFailure(cs)
                     : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      if (custody.record_version == ANC_PV_CUSTODY_LEGACY_VERSION) {
        if (!CloseCustodyHandle(handle)) {
          result = AncPrivateVaultAuthorityStoreStatusProtectionFailed;
          return;
        }
        handle = nil;
        cs = [self.custodyRepository
            migrateLegacyCodecVaultId:vaultId
                   expectedGeneration:custody.custody_generation];
        if (cs != AncPrivateVaultCustodyRepositoryStatusOK) {
          result = cs == AncPrivateVaultCustodyRepositoryStatusConflict
                       ? AncPrivateVaultAuthorityStoreStatusConflict
                       : AncPrivateVaultAuthorityStoreStatusCorrupt;
          return;
        }
        cs = [self.custodyRepository readVaultId:vaultId
                                        snapshot:&custody
                                          handle:&handle];
        if (cs != AncPrivateVaultCustodyRepositoryStatusOK) {
          result = CloseCustodyHandle(handle)
                       ? AuthorityStatusForCustodyFailure(cs)
                       : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
          return;
        }
      }
      if (custody.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVING ||
          custody.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED) {
        result = CloseCustodyHandle(handle)
                     ? AncPrivateVaultAuthorityStoreStatusRemoved
                     : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      if (custody.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_CANCELLED_GENESIS) {
        if (!CloseCustodyHandle(handle) || ![self prepareDirectory]) {
          result = AncPrivateVaultAuthorityStoreStatusProtectionFailed;
          return;
        }
        BOOL liveMissing = NO;
        BOOL stageMissing = NO;
        NSData *live = [self readFileName:[self nameForVaultId:vaultId
                                                        suffix:@".authority"]
                                  missing:&liveMissing];
        NSData *stage =
            [self readFileName:[self nameForVaultId:vaultId
                                             suffix:@".authority.stage"]
                       missing:&stageMissing];
        if (liveMissing && stageMissing && live == nil && stage == nil)
          result = AncPrivateVaultAuthorityStoreStatusNotFound;
        else if (live != nil || stage != nil)
          result = AncPrivateVaultAuthorityStoreStatusConflict;
        else
          result = AncPrivateVaultAuthorityStoreStatusCorrupt;
        return;
      }
      if (custody.record_version != ANC_PV_CUSTODY_VERSION ||
          !custody.authority_anchor_present || handle == nil) {
        result = CloseCustodyHandle(handle)
                     ? AncPrivateVaultAuthorityStoreStatusCorrupt
                     : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      if (![self prepareDirectory]) {
        result = CloseCustodyHandle(handle)
                     ? AncPrivateVaultAuthorityStoreStatusStorageFailed
                     : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      BOOL missing = NO;
      NSData *live = [self readFileName:[self nameForVaultId:vaultId
                                                      suffix:@".authority"]
                                missing:&missing];
      BOOL stageMissing = NO;
      NSData *stage = [self
          readFileName:[self nameForVaultId:vaultId suffix:@".authority.stage"]
               missing:&stageMissing];
      if ((!missing && live == nil) || (!stageMissing && stage == nil)) {
        result = CloseCustodyHandle(handle)
                     ? AncPrivateVaultAuthorityStoreStatusCorrupt
                     : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      NSData *liveDigest = live == nil ? nil : FrameDigest(live);
      NSData *stageDigest = stage == nil ? nil : FrameDigest(stage);
      BOOL liveMatches =
          liveDigest != nil &&
          anc_pv_memcmp(liveDigest.bytes, custody.snapshot_digest, 32) ==
              ANC_PV_CRYPTO_OK;
      BOOL stageMatches =
          stageDigest != nil &&
          anc_pv_memcmp(stageDigest.bytes, custody.snapshot_digest, 32) ==
              ANC_PV_CRYPTO_OK;
      NSData *frame = nil;
      if (liveMatches) {
        frame = live;
        if (stage != nil) {
          if (stageMatches ||
              (stage.length >= ANC_PV_AUTHORITY_FRAME_HEADER_BYTES &&
               ReadU64((const uint8_t *)stage.bytes + 12) ==
                   custody.custody_generation + 1)) {
            if (![self removeStageForVaultId:vaultId]) {
              result =
                  CloseCustodyHandle(handle)
                      ? AncPrivateVaultAuthorityStoreStatusStorageFailed
                      : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
              return;
            }
          } else {
            result = CloseCustodyHandle(handle)
                         ? AncPrivateVaultAuthorityStoreStatusConflict
                         : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
            return;
          }
        }
      } else if (stageMatches) {
        if (![self promoteStageForVaultId:vaultId]) {
          result = CloseCustodyHandle(handle)
                       ? AncPrivateVaultAuthorityStoreStatusStorageFailed
                       : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
          return;
        }
        frame = stage;
      } else {
        AncPrivateVaultAuthorityStoreStatus mismatch =
            (live == nil && stage == nil)
                ? AncPrivateVaultAuthorityStoreStatusRollbackDetected
                : AncPrivateVaultAuthorityStoreStatusConflict;
        result = CloseCustodyHandle(handle)
                     ? mismatch
                     : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      __block NSData *plaintext = nil, *digest = nil;
      AncPrivateVaultCustodyRepositoryStatus borrow = [handle
          borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
            plaintext = DecodeFrame(frame, vaultId, custody.custody_generation,
                                    secrets->local_state_key, &digest);
            return plaintext != nil;
          }];
      AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
      if (borrow != AncPrivateVaultCustodyRepositoryStatusOK ||
          closed != AncPrivateVaultCustodyRepositoryStatusOK) {
        result = AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      if (anc_pv_memcmp(digest.bytes, custody.snapshot_digest, 32) !=
          ANC_PV_CRYPTO_OK) {
        result = AncPrivateVaultAuthorityStoreStatusConflict;
        return;
      }
      AncPrivateVaultAuthoritySnapshotStatus ss;
      AncPrivateVaultAuthoritySnapshot *snapshot =
          AncPrivateVaultAuthoritySnapshotDecode(plaintext, &ss);
      anc_pv_zeroize((void *)plaintext.bytes, plaintext.length);
      if (!AuthoritySnapshotMatchesCustody(snapshot, vaultId, &custody, digest,
                                           custody.active_epoch)) {
        result = AncPrivateVaultAuthorityStoreStatusCorrupt;
        return;
      }
      AncPrivateVaultAuthorityCheckpoint *cp =
          [AncPrivateVaultAuthorityCheckpoint new];
      cp.vaultId = vaultId;
      cp.custodyGeneration = custody.custody_generation;
      cp.frameDigest = digest;
      cp.snapshot = snapshot;
      loadedCheckpoint = cp;
      result = AncPrivateVaultAuthorityStoreStatusOK;
    });
    if (checkpoint)
      *checkpoint = loadedCheckpoint;
    return result;
  } @finally {
    [operationLock unlock];
  }
}

- (AncPrivateVaultAuthorityStoreStatus)proveAuthorityAbsentVaultId:
    (NSString *)vaultId {
  if (vaultId.length == 0)
    return AncPrivateVaultAuthorityStoreStatusInvalid;
  NSRecursiveLock *operationLock = [self operationLockForVaultId:vaultId];
  if (operationLock == nil)
    return AncPrivateVaultAuthorityStoreStatusStorageFailed;
  [operationLock lock];
  @try {
    __block AncPrivateVaultAuthorityStoreStatus result =
        AncPrivateVaultAuthorityStoreStatusStorageFailed;
    dispatch_sync(self.queue, ^{
      if (![self prepareDirectory]) {
        result = AncPrivateVaultAuthorityStoreStatusStorageFailed;
        return;
      }
      BOOL liveMissing = NO;
      BOOL stageMissing = NO;
      NSData *live = [self readFileName:[self nameForVaultId:vaultId
                                                      suffix:@".authority"]
                                missing:&liveMissing];
      NSData *stage = [self
          readFileName:[self nameForVaultId:vaultId suffix:@".authority.stage"]
               missing:&stageMissing];
      if (liveMissing && stageMissing && live == nil && stage == nil)
        result = AncPrivateVaultAuthorityStoreStatusNotFound;
      else if (live != nil || stage != nil)
        result = AncPrivateVaultAuthorityStoreStatusConflict;
      else
        result = AncPrivateVaultAuthorityStoreStatusCorrupt;
    });
    return result;
  } @finally {
    [operationLock unlock];
  }
}

- (AncPrivateVaultAuthorityStoreStatus)
    commitVerifiedReplayResult:(AncPrivateVaultVerifiedReplayResult *)result
                       vaultId:(NSString *)vaultId
                  verifiedAtMs:(uint64_t)verifiedAtMs
                    checkpoint:(AncPrivateVaultAuthorityCheckpoint **)checkpoint
                         error:(NSError **)error {
  (void)error;
  if (checkpoint)
    *checkpoint = nil;
  AncPrivateVaultVerifiedEvidence *evidence =
      AuthorityCopyVerifiedEvidence(result);
  BOOL bootstrap = evidence.genesis || evidence.recoveryBootstrap ||
                   evidence.enrollmentBootstrap;
  AncPrivateVaultAuthoritySnapshotStatus evidenceStatus;
  AncPrivateVaultAuthoritySnapshot *expectedSnapshot =
      evidence == nil || bootstrap
          ? nil
          : AncPrivateVaultAuthoritySnapshotDecode(evidence.expectedCanonical,
                                                   &evidenceStatus);
  AncPrivateVaultAuthoritySnapshot *nextSnapshot =
      evidence == nil ? nil
                      : AncPrivateVaultAuthoritySnapshotDecode(
                            evidence.nextCanonical, &evidenceStatus);
  if (evidence == nil ||
      ((unsigned)evidence.genesis + (unsigned)evidence.recoveryBootstrap +
           (unsigned)evidence.enrollmentBootstrap >
       1) ||
      (!bootstrap && expectedSnapshot == nil) || nextSnapshot == nil ||
      vaultId.length == 0 || evidence.verifiedAtMs != verifiedAtMs ||
      nextSnapshot.verifiedAtMs != verifiedAtMs ||
      (!bootstrap && verifiedAtMs < expectedSnapshot.verifiedAtMs) ||
      ![evidence.vaultId isEqualToString:vaultId] ||
      ![nextSnapshot.vaultId isEqualToString:vaultId] ||
      (evidence.genesis &&
       (evidence.expectedGeneration != 1 ||
        nextSnapshot.targetCustodyGeneration != 2 ||
        nextSnapshot.previousCustodyGeneration != 1 ||
        nextSnapshot.previousSequence != nil ||
        nextSnapshot.previousHead != nil || nextSnapshot.sequence != 0 ||
        nextSnapshot.epoch != 1 || nextSnapshot.recoveryGeneration != 1 ||
        ![nextSnapshot.headHash isEqualToData:evidence.replayEntryHash])) ||
      (evidence.recoveryBootstrap &&
       (evidence.expectedGeneration != 1 ||
        nextSnapshot.targetCustodyGeneration != 2 ||
        nextSnapshot.previousCustodyGeneration != 1 ||
        nextSnapshot.previousSequence == nil ||
        nextSnapshot.previousSequence.unsignedLongLongValue !=
            evidence.recoveryPriorSequence ||
        ![nextSnapshot.previousHead isEqualToData:evidence.recoveryPriorHead] ||
        nextSnapshot.sequence != evidence.recoveryPriorSequence + 1 ||
        nextSnapshot.epoch != evidence.recoveryPriorEpoch + 1 ||
        nextSnapshot.recoveryGeneration !=
            evidence.recoveryPriorGeneration + 1 ||
        ![nextSnapshot.headHash isEqualToData:evidence.replayEntryHash])) ||
      (evidence.enrollmentBootstrap &&
       (evidence.expectedGeneration != 2 ||
        nextSnapshot.targetCustodyGeneration != 3 ||
        nextSnapshot.previousCustodyGeneration != 2 ||
        nextSnapshot.previousSequence == nil ||
        nextSnapshot.previousSequence.unsignedLongLongValue !=
            evidence.enrollmentPriorSequence ||
        ![nextSnapshot.previousHead
            isEqualToData:evidence.enrollmentPriorHead] ||
        nextSnapshot.sequence != evidence.enrollmentPriorSequence + 1 ||
        nextSnapshot.epoch != evidence.enrollmentPriorEpoch ||
        nextSnapshot.recoveryGeneration !=
            evidence.enrollmentPriorRecoveryGeneration ||
        ![nextSnapshot.headHash isEqualToData:evidence.replayEntryHash])) ||
      (!bootstrap && !evidence.testOnly &&
       !AuthoritySnapshotTransitionValid(
           expectedSnapshot, nextSnapshot, evidence.replayEntryHash,
           evidence.expectedGeneration, evidence.transition)))
    return AncPrivateVaultAuthorityStoreStatusInvalid;
  AncPrivateVaultAuthorityCheckpoint *expected = nil;
  if (!bootstrap) {
    expected = [AncPrivateVaultAuthorityCheckpoint new];
    expected.vaultId = evidence.vaultId;
    expected.custodyGeneration = evidence.expectedGeneration;
    expected.frameDigest = evidence.expectedFrameDigest;
    expected.snapshot = expectedSnapshot;
  } else {
    AncPrivateVaultAuthorityCheckpoint *official = nil;
    AncPrivateVaultAuthorityStoreStatus officialStatus =
        [self loadVaultId:vaultId checkpoint:&official error:nil];
    if (officialStatus == AncPrivateVaultAuthorityStoreStatusOK) {
      AncPrivateVaultAuthoritySnapshotStatus ss;
      NSData *officialCanonical =
          AncPrivateVaultAuthoritySnapshotEncode(official.snapshot, &ss);
      NSData *wantedCanonical =
          AncPrivateVaultAuthoritySnapshotEncode(nextSnapshot, &ss);
      uint64_t expectedBootstrapGeneration =
          evidence.enrollmentBootstrap ? 3 : 2;
      if (official.custodyGeneration == expectedBootstrapGeneration &&
          officialCanonical != nil &&
          [officialCanonical isEqualToData:wantedCanonical]) {
        if (checkpoint)
          *checkpoint = official;
        AuthorityConsumeBootstrapEvidence(result);
        return AncPrivateVaultAuthorityStoreStatusOK;
      }
      return AncPrivateVaultAuthorityStoreStatusConflict;
    }
  }
  AncPrivateVaultCustodyEpochTransition transition = evidence.transition;
  NSRecursiveLock *operationLock = [self operationLockForVaultId:vaultId];
  if (operationLock == nil)
    return AncPrivateVaultAuthorityStoreStatusStorageFailed;
  [operationLock lock];
  @try {
    __block AncPrivateVaultAuthorityStoreStatus final;
    __block AncPrivateVaultAuthorityCheckpoint *committedCheckpoint = nil;
    dispatch_sync(self.queue, ^{
      AncPrivateVaultCustodySnapshot current;
      AncPrivateVaultCustodyHandle *handle = nil;
      AncPrivateVaultCustodyRepositoryStatus cs =
          [self.custodyRepository readVaultId:vaultId
                                     snapshot:&current
                                       handle:&handle];
      if (cs != AncPrivateVaultCustodyRepositoryStatusOK || handle == nil) {
        final = CloseCustodyHandle(handle)
                    ? AuthorityStatusForCustodyFailure(cs)
                    : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      BOOL promotes = transition ==
                      AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch;
      BOOL carries =
          transition == AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch;
      uint64_t nextEpoch =
          promotes ? current.pending_epoch : current.active_epoch;
      if ((!bootstrap && expected == nil) || (!carries && !promotes) ||
          (promotes && current.pending_epoch == 0) ||
          (!bootstrap &&
           (expected.custodyGeneration != current.custody_generation ||
            anc_pv_memcmp(expected.frameDigest.bytes, current.snapshot_digest,
                          32) != ANC_PV_CRYPTO_OK ||
            ![expected.vaultId isEqualToString:vaultId] ||
            !AuthoritySnapshotMatchesCustody(expected.snapshot, vaultId,
                                             &current, expected.frameDigest,
                                             current.active_epoch))) ||
          (evidence.genesis &&
           (current.custody_generation != 1 ||
            current.lifecycle != ANC_PV_CUSTODY_LIFECYCLE_PENDING ||
            current.pending_kind != ANC_PV_CUSTODY_PENDING_GENESIS ||
            current.authority_anchor_present ||
            !current.expected_edge_present || current.active_epoch != 0 ||
            current.pending_epoch != 1 ||
            !AuthorityGenesisEvidenceMatchesPendingCustody(evidence,
                                                           &current))) ||
          (evidence.recoveryBootstrap &&
           (current.custody_generation != 1 ||
            current.lifecycle != ANC_PV_CUSTODY_LIFECYCLE_PENDING ||
            current.pending_kind != ANC_PV_CUSTODY_PENDING_RECOVERY ||
            current.enrollment_phase !=
                ANC_PV_CUSTODY_ENROLLMENT_AUTHORIZATION_RECEIVED ||
            current.authority_anchor_present ||
            !current.expected_edge_present || current.active_epoch != 0 ||
            !AuthorityRecoveryEvidenceMatchesPendingCustody(evidence,
                                                            &current))) ||
          (evidence.enrollmentBootstrap &&
           (current.custody_generation != 2 ||
            current.lifecycle != ANC_PV_CUSTODY_LIFECYCLE_PENDING ||
            current.enrollment_phase !=
                ANC_PV_CUSTODY_ENROLLMENT_AUTHORIZATION_RECEIVED ||
            !current.authority_anchor_present ||
            !current.expected_edge_present || current.active_epoch == 0 ||
            current.pending_epoch != 0 ||
            !AuthorityEnrollmentEvidenceMatchesPendingCustody(evidence,
                                                              &current))) ||
          nextSnapshot.previousCustodyGeneration !=
              current.custody_generation ||
          nextSnapshot.targetCustodyGeneration !=
              current.custody_generation + 1 ||
          nextSnapshot.epoch != nextEpoch) {
        final = CloseCustodyHandle(handle)
                    ? AncPrivateVaultAuthorityStoreStatusConflict
                    : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      AncPrivateVaultAuthoritySnapshotStatus ss;
      NSMutableData *plaintext =
          [AncPrivateVaultAuthoritySnapshotEncode(nextSnapshot, &ss)
              mutableCopy];
      if (plaintext == nil) {
        final = CloseCustodyHandle(handle)
                    ? AncPrivateVaultAuthorityStoreStatusInvalid
                    : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      NSMutableData *nonce = [NSMutableData dataWithLength:24];
      if (anc_pv_random(nonce.mutableBytes, nonce.length) != ANC_PV_CRYPTO_OK) {
        anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
        final = CloseCustodyHandle(handle)
                    ? AncPrivateVaultAuthorityStoreStatusStorageFailed
                    : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      __block NSData *frame = nil, *digest = nil;
      AncPrivateVaultCustodyRepositoryStatus borrow = [handle
          borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
            frame =
                EncodeFrame(plaintext, vaultId, current.custody_generation + 1,
                            secrets->local_state_key, nonce, &digest);
            return frame != nil;
          }];
      AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
      anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
      if (borrow != AncPrivateVaultCustodyRepositoryStatusOK ||
          closed != AncPrivateVaultCustodyRepositoryStatusOK || frame == nil) {
        final = AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      AncPrivateVaultCustodySnapshot next = current;
      next.record_version = ANC_PV_CUSTODY_VERSION;
      next.custody_generation = current.custody_generation + 1;
      next.authority_anchor_present = 1;
      next.anchored_sequence = nextSnapshot.sequence;
      memcpy(next.anchored_head, nextSnapshot.headHash.bytes, 32);
      memcpy(next.membership_digest, nextSnapshot.membershipHash.bytes, 32);
      next.signed_at_ms = nextSnapshot.signedAtMs;
      next.recovery_generation = nextSnapshot.recoveryGeneration;
      memcpy(next.snapshot_digest, digest.bytes, 32);
      next.freshness_ms = verifiedAtMs;
      next.expected_edge_present = 0;
      next.expected_next_sequence = 0;
      memset(next.expected_previous_head, 0, 32);
      memset(next.pending_transcript_digest, 0, 32);
      if (promotes || evidence.enrollmentBootstrap) {
        next.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_ACTIVE;
        next.pending_kind = ANC_PV_CUSTODY_PENDING_NONE;
        next.rotation_phase = ANC_PV_CUSTODY_ROTATION_NONE;
        next.enrollment_phase = ANC_PV_CUSTODY_ENROLLMENT_NONE;
        memset(next.ceremony_id, 0, sizeof next.ceremony_id);
        next.ceremony_id_length = 0;
        if (promotes)
          next.active_epoch = current.pending_epoch;
        next.pending_epoch = 0;
      }
      if (!AuthoritySnapshotMatchesCustody(nextSnapshot, vaultId, &next, digest,
                                           next.active_epoch)) {
        final = AncPrivateVaultAuthorityStoreStatusInvalid;
        return;
      }
      if (![self writeStage:frame vaultId:vaultId]) {
        final = AncPrivateVaultAuthorityStoreStatusStorageFailed;
        return;
      }
      BOOL stageMissing = NO;
      NSData *stageRead = [self
          readFileName:[self nameForVaultId:vaultId suffix:@".authority.stage"]
               missing:&stageMissing];
      if (stageMissing || ![stageRead isEqualToData:frame] ||
          anc_pv_memcmp(FrameDigest(stageRead).bytes, digest.bytes, 32) !=
              ANC_PV_CRYPTO_OK) {
        final = AncPrivateVaultAuthorityStoreStatusCorrupt;
        return;
      }
      AncPrivateVaultCustodySnapshot verificationCustody;
      AncPrivateVaultCustodyHandle *verificationHandle = nil;
      cs = [self.custodyRepository readVaultId:vaultId
                                      snapshot:&verificationCustody
                                        handle:&verificationHandle];
      __block NSData *verifiedPlaintext = nil;
      if (cs != AncPrivateVaultCustodyRepositoryStatusOK ||
          verificationHandle == nil) {
        BOOL closedVerification = CloseCustodyHandle(verificationHandle);
        final = closedVerification
                    ? AuthorityStatusForCustodyFailure(cs)
                    : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      AncPrivateVaultCustodyRepositoryStatus verificationBorrow =
          [verificationHandle
              borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
                verifiedPlaintext = DecodeFrame(stageRead, vaultId,
                                                current.custody_generation + 1,
                                                secrets->local_state_key, nil);
                return verifiedPlaintext != nil;
              }];
      AncPrivateVaultCustodyRepositoryStatus verificationClose =
          [verificationHandle close];
      if (verificationBorrow != AncPrivateVaultCustodyRepositoryStatusOK ||
          verificationClose != AncPrivateVaultCustodyRepositoryStatusOK) {
        final = AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      AncPrivateVaultAuthoritySnapshot *verifiedSnapshot =
          AncPrivateVaultAuthoritySnapshotDecode(verifiedPlaintext, &ss);
      NSData *verifiedCanonical =
          verifiedSnapshot == nil
              ? nil
              : AncPrivateVaultAuthoritySnapshotEncode(verifiedSnapshot, &ss);
      NSData *expectedCanonical =
          AncPrivateVaultAuthoritySnapshotEncode(nextSnapshot, &ss);
      BOOL semanticMatch =
          verifiedSnapshot != nil &&
          [verifiedCanonical isEqualToData:expectedCanonical] &&
          AuthoritySnapshotMatchesCustody(verifiedSnapshot, vaultId, &next,
                                          digest, next.active_epoch);
      anc_pv_zeroize((void *)verifiedPlaintext.bytes, verifiedPlaintext.length);
      if (!semanticMatch) {
        final = AncPrivateVaultAuthorityStoreStatusCorrupt;
        return;
      }
      if (AuthorityFault(AncPrivateVaultAuthorityFaultAfterStageVerification)) {
        final = AncPrivateVaultAuthorityStoreStatusStorageFailed;
        return;
      }
      if (evidence.genesis) {
        cs =
            [self.custodyRepository promoteGenesisAuthorityAnchorVaultId:vaultId
                                                      nextPublicSnapshot:&next];
      } else if (evidence.recoveryBootstrap) {
        cs = AncPrivateVaultCustodyPromoteRecoveryAuthorityAnchor(
            self.custodyRepository, vaultId, &next);
      } else if (evidence.enrollmentBootstrap) {
        cs = [self.custodyRepository
            promoteEnrollmentAuthorityAnchorVaultId:vaultId
                                 nextPublicSnapshot:&next];
      } else {
        cs = [self.custodyRepository
            advanceAuthorityAnchorVaultId:vaultId
                       expectedGeneration:current.custody_generation
                   expectedSnapshotDigest:expected.frameDigest
                       nextPublicSnapshot:&next
                          epochTransition:transition];
      }
      if (cs != AncPrivateVaultCustodyRepositoryStatusOK) {
        final = cs == AncPrivateVaultCustodyRepositoryStatusConflict
                    ? AncPrivateVaultAuthorityStoreStatusConflict
                    : AncPrivateVaultAuthorityStoreStatusCorrupt;
        return;
      }
      if (AuthorityFault(AncPrivateVaultAuthorityFaultAfterCustodyAdvance)) {
        final = AncPrivateVaultAuthorityStoreStatusStorageFailed;
        return;
      }
      BOOL promotionStageMissing = NO;
      NSData *promotionStage = [self
          readFileName:[self nameForVaultId:vaultId suffix:@".authority.stage"]
               missing:&promotionStageMissing];
      NSData *promotionDigest =
          promotionStage == nil ? nil : FrameDigest(promotionStage);
      if (promotionStageMissing || ![promotionStage isEqualToData:frame] ||
          promotionDigest.length != ANC_PV_HASH_BYTES ||
          anc_pv_memcmp(promotionDigest.bytes, digest.bytes,
                        ANC_PV_HASH_BYTES) != ANC_PV_CRYPTO_OK) {
        final = AncPrivateVaultAuthorityStoreStatusCorrupt;
        return;
      }
      if (![self promoteStageForVaultId:vaultId]) {
        final = AncPrivateVaultAuthorityStoreStatusStorageFailed;
        return;
      }
      AncPrivateVaultAuthorityCheckpoint *cp =
          [AncPrivateVaultAuthorityCheckpoint new];
      cp.vaultId = vaultId;
      cp.custodyGeneration = next.custody_generation;
      cp.frameDigest = digest;
      cp.snapshot = nextSnapshot;
      committedCheckpoint = cp;
      final = AncPrivateVaultAuthorityStoreStatusOK;
    });
    if (final == AncPrivateVaultAuthorityStoreStatusOK) {
      if (AuthorityFault(AncPrivateVaultAuthorityFaultBeforeFinalReread))
        return AncPrivateVaultAuthorityStoreStatusStorageFailed;
      AncPrivateVaultAuthorityCheckpoint *confirmed = nil;
      AncPrivateVaultAuthorityStoreStatus confirmedStatus =
          [self loadVaultId:vaultId checkpoint:&confirmed error:nil];
      if (confirmedStatus != AncPrivateVaultAuthorityStoreStatusOK ||
          confirmed.custodyGeneration !=
              committedCheckpoint.custodyGeneration ||
          anc_pv_memcmp(confirmed.frameDigest.bytes,
                        committedCheckpoint.frameDigest.bytes,
                        32) != ANC_PV_CRYPTO_OK)
        return confirmedStatus == AncPrivateVaultAuthorityStoreStatusOK
                   ? AncPrivateVaultAuthorityStoreStatusCorrupt
                   : confirmedStatus;
      committedCheckpoint = confirmed;
    }
    if (checkpoint)
      *checkpoint = committedCheckpoint;
    if (final == AncPrivateVaultAuthorityStoreStatusOK && bootstrap)
      AuthorityConsumeBootstrapEvidence(result);
    return final;
  } @finally {
    [operationLock unlock];
  }
}
@end

#if ANC_PRIVATE_VAULT_TESTING
NSData *AncPrivateVaultAuthorityFrameEncodeForTesting(
    NSData *plaintext, NSString *vaultId, uint64_t generation, NSData *key,
    NSData *nonce, NSData **digest) {
  if (key.length != ANC_PV_KEY_BYTES)
    return nil;
  return EncodeFrame(plaintext, vaultId, generation, key.bytes, nonce, digest);
}
NSData *AncPrivateVaultAuthorityFrameDecodeForTesting(NSData *frame,
                                                      NSString *vaultId,
                                                      uint64_t generation,
                                                      NSData *key,
                                                      NSData **digest) {
  if (key.length != ANC_PV_KEY_BYTES)
    return nil;
  return DecodeFrame(frame, vaultId, generation, key.bytes, digest);
}
#endif
