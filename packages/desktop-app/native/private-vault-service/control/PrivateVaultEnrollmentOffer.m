#import "PrivateVaultEnrollmentOffer.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

#import <objc/runtime.h>

static const uint8_t kOfferDomain[] = "anc/v1/enrollment-offer";
static const uint8_t kProofDomain[] = "anc/v1/enrollment-key-proof";
static const uint64_t kMaxSafeInteger = UINT64_C(9007199254740991);

@interface AncPrivateVaultEnrollmentOfferResult ()
@property(nonatomic, readwrite) NSData *encodedOffer;
@property(nonatomic, readwrite) NSData *offerHash;
@property(nonatomic, readwrite) NSData *candidateKeyProof;
@property(nonatomic, readwrite) NSData *signingPublicKey;
@property(nonatomic, readwrite) NSData *keyAgreementPublicKey;
@property(nonatomic, readwrite) NSData *vaultId;
@property(nonatomic, readwrite) NSData *endpointId;
@property(nonatomic, readwrite) NSData *ceremonyId;
@property(nonatomic, readwrite) NSData *envelopeId;
@property(nonatomic, readwrite) NSData *enrollmentNonce;
@property(nonatomic, readwrite) NSString *membershipRole;
@property(nonatomic, readwrite) BOOL unattended;
@property(nonatomic, readwrite) uint64_t createdAt;
@property(nonatomic, readwrite) uint64_t expiresAt;
@end
@implementation AncPrivateVaultEnrollmentOfferResult
@end

static void SetStatus(AncPrivateVaultEnrollmentOfferStatus *status,
                      AncPrivateVaultEnrollmentOfferStatus value) {
  if (status != NULL)
    *status = value;
}

static BOOL Exact(NSData *value, NSUInteger length) {
  return [value isKindOfClass:NSData.class] && value.length == length;
}

static AncPrivateVaultEnrollmentOfferResult *Result(
    NSData *encodedOffer, NSData *offerHash, NSData *candidateKeyProof,
    NSData *signingPublicKey, NSData *keyAgreementPublicKey, NSData *vaultId,
    NSData *endpointId, NSData *ceremonyId, NSData *envelopeId,
    NSData *enrollmentNonce, NSString *membershipRole, BOOL unattended,
    uint64_t createdAt, uint64_t expiresAt) {
  AncPrivateVaultEnrollmentOfferResult *result =
      class_createInstance(AncPrivateVaultEnrollmentOfferResult.class, 0);
  result.encodedOffer = [encodedOffer copy];
  result.offerHash = [offerHash copy];
  result.candidateKeyProof = [candidateKeyProof copy];
  result.signingPublicKey = [signingPublicKey copy];
  result.keyAgreementPublicKey = [keyAgreementPublicKey copy];
  result.vaultId = [vaultId copy];
  result.endpointId = [endpointId copy];
  result.ceremonyId = [ceremonyId copy];
  result.envelopeId = [envelopeId copy];
  result.enrollmentNonce = [enrollmentNonce copy];
  result.membershipRole = [membershipRole copy];
  result.unattended = unattended;
  result.createdAt = createdAt;
  result.expiresAt = expiresAt;
  return result;
}

AncPrivateVaultEnrollmentOfferResult *AncPrivateVaultEnrollmentOfferBuild(
    NSData *vaultId, NSData *endpointId, NSData *ceremonyId,
    NSData *envelopeId, NSData *enrollmentNonce, NSString *membershipRole,
    BOOL unattended, uint64_t createdAt, uint64_t expiresAt,
    const uint8_t *signingSeed, const uint8_t *boxSeed,
    AncPrivateVaultEnrollmentOfferStatus *status) {
  SetStatus(status, AncPrivateVaultEnrollmentOfferStatusInvalid);
  BOOL broker = [membershipRole isEqualToString:@"broker"];
  if (!Exact(vaultId, 16) || !Exact(endpointId, 16) ||
      !Exact(ceremonyId, 16) || !Exact(envelopeId, 16) ||
      !Exact(enrollmentNonce, 32) ||
      (!broker && ![membershipRole isEqualToString:@"endpoint"]) ||
      unattended != broker || createdAt == 0 || expiresAt <= createdAt ||
      expiresAt - createdAt > 600 || createdAt > kMaxSafeInteger ||
      expiresAt > kMaxSafeInteger || signingSeed == NULL || boxSeed == NULL)
    return nil;
  uint8_t signingPublic[32] = {0}, signingPrivate[64] = {0};
  uint8_t agreementPublic[32] = {0}, agreementPrivate[32] = {0};
  if (anc_pv_ed25519_seed_keypair(signingPublic, signingPrivate,
                                   signingSeed) != ANC_PV_CRYPTO_OK ||
      anc_pv_box_seed_keypair(agreementPublic, agreementPrivate, boxSeed) !=
          ANC_PV_CRYPTO_OK) {
    anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
    anc_pv_zeroize(agreementPrivate, sizeof agreementPrivate);
    SetStatus(status, AncPrivateVaultEnrollmentOfferStatusCryptoFailed);
    return nil;
  }
  NSData *signingPublicData =
      [NSData dataWithBytes:signingPublic length:sizeof signingPublic];
  NSData *agreementPublicData =
      [NSData dataWithBytes:agreementPublic length:sizeof agreementPublic];
  NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *fields = @{
    @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
    @2 : [AncPrivateVaultCanonicalValue bytes:vaultId],
    @3 : [AncPrivateVaultCanonicalValue text:@"enrollment-offer"],
    @4 : [AncPrivateVaultCanonicalValue integer:(int64_t)createdAt],
    @5 : [AncPrivateVaultCanonicalValue bytes:envelopeId],
    @160 : [AncPrivateVaultCanonicalValue bytes:endpointId],
    @161 : [AncPrivateVaultCanonicalValue bytes:ceremonyId],
    @162 : [AncPrivateVaultCanonicalValue text:membershipRole],
    @163 : [AncPrivateVaultCanonicalValue boolean:unattended],
    @164 : [AncPrivateVaultCanonicalValue bytes:signingPublicData],
    @165 : [AncPrivateVaultCanonicalValue bytes:agreementPublicData],
    @166 : [AncPrivateVaultCanonicalValue bytes:enrollmentNonce],
    @168 : [AncPrivateVaultCanonicalValue integer:(int64_t)expiresAt],
  };
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *map =
      [AncPrivateVaultCanonicalValue map:fields];
  NSData *offer = map == nil
                      ? nil
                      : AncPrivateVaultCanonicalEncode(map, &canonicalStatus);
  uint8_t offerHash[32] = {0}, proof[64] = {0};
  BOOL hashed = offer != nil &&
                anc_pv_blake2b_256_two_part(
                    offerHash, kOfferDomain, sizeof kOfferDomain, offer.bytes,
                    offer.length) == ANC_PV_CRYPTO_OK;
  uint8_t proofMessage[sizeof kProofDomain + 32] = {0};
  memcpy(proofMessage, kProofDomain, sizeof kProofDomain);
  if (hashed)
    memcpy(proofMessage + sizeof kProofDomain, offerHash, 32);
  BOOL signedProof =
      hashed && anc_pv_ed25519_sign(proof, proofMessage, sizeof proofMessage,
                                    signingPrivate) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
  anc_pv_zeroize(agreementPrivate, sizeof agreementPrivate);
  anc_pv_zeroize(proofMessage, sizeof proofMessage);
  if (!signedProof) {
    anc_pv_zeroize(offerHash, sizeof offerHash);
    anc_pv_zeroize(proof, sizeof proof);
    SetStatus(status, offer == nil
                          ? AncPrivateVaultEnrollmentOfferStatusEncodingFailed
                          : AncPrivateVaultEnrollmentOfferStatusCryptoFailed);
    return nil;
  }
  AncPrivateVaultEnrollmentOfferResult *result = Result(
      offer, [NSData dataWithBytes:offerHash length:sizeof offerHash],
      [NSData dataWithBytes:proof length:sizeof proof], signingPublicData,
      agreementPublicData, vaultId, endpointId, ceremonyId, envelopeId,
      enrollmentNonce, membershipRole, unattended, createdAt, expiresAt);
  anc_pv_zeroize(offerHash, sizeof offerHash);
  anc_pv_zeroize(proof, sizeof proof);
  anc_pv_zeroize(signingPublic, sizeof signingPublic);
  anc_pv_zeroize(agreementPublic, sizeof agreementPublic);
  SetStatus(status, AncPrivateVaultEnrollmentOfferStatusOK);
  return result;
}

static AncPrivateVaultCanonicalValue *Field(
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map,
    NSNumber *key, AncPrivateVaultCanonicalType type) {
  AncPrivateVaultCanonicalValue *value = map[key];
  return value.type == type ? value : nil;
}

AncPrivateVaultEnrollmentOfferResult *AncPrivateVaultEnrollmentOfferVerify(
    NSData *encodedOffer, NSData *candidateKeyProof, NSData *expectedVaultId,
    AncPrivateVaultEnrollmentOfferStatus *status) {
  SetStatus(status, AncPrivateVaultEnrollmentOfferStatusInvalid);
  if (encodedOffer.length == 0 || encodedOffer.length > 64 * 1024 ||
      candidateKeyProof.length != 64 || !Exact(expectedVaultId, 16))
    return nil;
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      encodedOffer, 64 * 1024, &canonicalStatus);
  NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map =
      root.type == AncPrivateVaultCanonicalTypeMap ? root.mapValue : nil;
  NSSet<NSNumber *> *keys = [NSSet setWithArray:@[
    @1, @2, @3, @4, @5, @160, @161, @162, @163, @164, @165, @166, @168
  ]];
  if (map.count != keys.count ||
      ![[NSSet setWithArray:map.allKeys] isEqualToSet:keys])
    return nil;
  AncPrivateVaultCanonicalValue *suite =
      Field(map, @1, AncPrivateVaultCanonicalTypeText);
  AncPrivateVaultCanonicalValue *vault =
      Field(map, @2, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *type =
      Field(map, @3, AncPrivateVaultCanonicalTypeText);
  AncPrivateVaultCanonicalValue *created =
      Field(map, @4, AncPrivateVaultCanonicalTypeInteger);
  AncPrivateVaultCanonicalValue *envelope =
      Field(map, @5, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *endpoint =
      Field(map, @160, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *ceremony =
      Field(map, @161, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *role =
      Field(map, @162, AncPrivateVaultCanonicalTypeText);
  AncPrivateVaultCanonicalValue *unattended =
      Field(map, @163, AncPrivateVaultCanonicalTypeBoolean);
  AncPrivateVaultCanonicalValue *signing =
      Field(map, @164, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *agreement =
      Field(map, @165, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *nonce =
      Field(map, @166, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *expires =
      Field(map, @168, AncPrivateVaultCanonicalTypeInteger);
  BOOL broker = [role.textValue isEqualToString:@"broker"];
  BOOL valid = suite != nil && [suite.textValue isEqualToString:@"anc/v1"] &&
               vault != nil && Exact(vault.bytesValue, 16) &&
               [vault.bytesValue isEqualToData:expectedVaultId] && type != nil &&
               [type.textValue isEqualToString:@"enrollment-offer"] &&
               created != nil && created.integerValue > 0 &&
               (uint64_t)created.integerValue <= kMaxSafeInteger &&
               envelope != nil &&
               Exact(envelope.bytesValue, 16) && endpoint != nil &&
               Exact(endpoint.bytesValue, 16) && ceremony != nil &&
               Exact(ceremony.bytesValue, 16) && role != nil &&
               (broker || [role.textValue isEqualToString:@"endpoint"]) &&
               unattended != nil && unattended.booleanValue == broker &&
               signing != nil && Exact(signing.bytesValue, 32) &&
               agreement != nil && Exact(agreement.bytesValue, 32) &&
               nonce != nil && Exact(nonce.bytesValue, 32) && expires != nil &&
               expires.integerValue > created.integerValue &&
               (uint64_t)expires.integerValue <= kMaxSafeInteger &&
               expires.integerValue - created.integerValue <= 600;
  if (!valid)
    return nil;
  uint8_t hash[32] = {0};
  BOOL hashed = anc_pv_blake2b_256_two_part(
                    hash, kOfferDomain, sizeof kOfferDomain,
                    encodedOffer.bytes, encodedOffer.length) ==
                ANC_PV_CRYPTO_OK;
  uint8_t proofMessage[sizeof kProofDomain + 32] = {0};
  memcpy(proofMessage, kProofDomain, sizeof kProofDomain);
  if (hashed)
    memcpy(proofMessage + sizeof kProofDomain, hash, 32);
  BOOL verified =
      hashed && anc_pv_ed25519_verify(
                    candidateKeyProof.bytes, proofMessage,
                    sizeof proofMessage, signing.bytesValue.bytes) ==
                    ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(proofMessage, sizeof proofMessage);
  if (!verified) {
    anc_pv_zeroize(hash, sizeof hash);
    SetStatus(status, AncPrivateVaultEnrollmentOfferStatusCryptoFailed);
    return nil;
  }
  AncPrivateVaultEnrollmentOfferResult *result = Result(
      encodedOffer, [NSData dataWithBytes:hash length:32], candidateKeyProof,
      signing.bytesValue, agreement.bytesValue, vault.bytesValue,
      endpoint.bytesValue, ceremony.bytesValue, envelope.bytesValue,
      nonce.bytesValue, role.textValue, unattended.booleanValue,
      (uint64_t)created.integerValue, (uint64_t)expires.integerValue);
  anc_pv_zeroize(hash, sizeof hash);
  SetStatus(status, AncPrivateVaultEnrollmentOfferStatusOK);
  return result;
}
