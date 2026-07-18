#import "PrivateVaultEnrollmentOffer.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

#import <objc/runtime.h>

static const uint8_t kOfferDomain[] = "anc/v1/enrollment-offer";
static const uint8_t kProofDomain[] = "anc/v1/enrollment-key-proof";

@interface AncPrivateVaultEnrollmentOfferResult ()
@property(nonatomic, readwrite) NSData *encodedOffer;
@property(nonatomic, readwrite) NSData *offerHash;
@property(nonatomic, readwrite) NSData *candidateKeyProof;
@property(nonatomic, readwrite) NSData *signingPublicKey;
@property(nonatomic, readwrite) NSData *keyAgreementPublicKey;
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
      expiresAt - createdAt > 600 || createdAt > INT64_MAX ||
      expiresAt > INT64_MAX || signingSeed == NULL || boxSeed == NULL)
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
  AncPrivateVaultEnrollmentOfferResult *result =
      class_createInstance(AncPrivateVaultEnrollmentOfferResult.class, 0);
  result.encodedOffer = [offer copy];
  result.offerHash = [NSData dataWithBytes:offerHash length:sizeof offerHash];
  result.candidateKeyProof = [NSData dataWithBytes:proof length:sizeof proof];
  result.signingPublicKey = signingPublicData;
  result.keyAgreementPublicKey = agreementPublicData;
  anc_pv_zeroize(offerHash, sizeof offerHash);
  anc_pv_zeroize(proof, sizeof proof);
  anc_pv_zeroize(signingPublic, sizeof signingPublic);
  anc_pv_zeroize(agreementPublic, sizeof agreementPublic);
  SetStatus(status, AncPrivateVaultEnrollmentOfferStatusOK);
  return result;
}
