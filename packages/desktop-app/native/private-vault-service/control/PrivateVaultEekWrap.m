#import "PrivateVaultEekWrap.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

#import <objc/runtime.h>

static const uint8_t kEekDomain[] = "anc/v1/eek-wrap";
static const uint64_t kMaxSafeInteger = UINT64_C(9007199254740991);

@interface AncPrivateVaultEekWrap ()
@property(nonatomic, readwrite) NSData *encodedEnvelope;
@property(nonatomic, readwrite) NSData *envelopeId;
@property(nonatomic, readwrite) NSData *recipientEndpointId;
@property(nonatomic, readwrite) NSData *issuerEndpointId;
@property(nonatomic, readwrite) NSData *nonce;
@property(nonatomic, readwrite) NSData *ciphertext;
@property(nonatomic, readwrite) uint64_t epoch;
@property(nonatomic, readwrite) uint64_t createdAt;
@end
@implementation AncPrivateVaultEekWrap
@end

static void SetStatus(AncPrivateVaultEekWrapStatus *status,
                      AncPrivateVaultEekWrapStatus value) {
  if (status != NULL)
    *status = value;
}

static BOOL Exact(NSData *data, NSUInteger length) {
  return [data isKindOfClass:NSData.class] && data.length == length;
}

static BOOL Same(NSData *left, NSData *right) {
  return Exact(left, right.length) &&
         anc_pv_memcmp(left.bytes, right.bytes, right.length) ==
             ANC_PV_CRYPTO_OK;
}

static AncPrivateVaultCanonicalValue *Field(
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map,
    NSNumber *key, AncPrivateVaultCanonicalType type) {
  AncPrivateVaultCanonicalValue *value = map[key];
  return value.type == type ? value : nil;
}

AncPrivateVaultEekWrap *AncPrivateVaultEekWrapVerify(
    NSData *encoded, NSData *expectedVaultId,
    NSData *expectedRecipientEndpointId, NSData *expectedIssuerEndpointId,
    uint64_t expectedEpoch, NSData *expectedIssuerSigningPublicKey,
    AncPrivateVaultEekWrapStatus *status) {
  SetStatus(status, AncPrivateVaultEekWrapStatusInvalid);
  @try {
    if (encoded.length == 0 || encoded.length > 64 * 1024 ||
        !Exact(expectedVaultId, 16) ||
        !Exact(expectedRecipientEndpointId, 16) ||
        !Exact(expectedIssuerEndpointId, 16) || expectedEpoch == 0 ||
        expectedEpoch > kMaxSafeInteger ||
        !Exact(expectedIssuerSigningPublicKey, 32))
      return nil;
    AncPrivateVaultCanonicalStatus canonicalStatus;
    AncPrivateVaultCanonicalValue *root =
        AncPrivateVaultCanonicalDecode(encoded, 64 * 1024, &canonicalStatus);
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map =
        root.type == AncPrivateVaultCanonicalTypeMap ? root.mapValue : nil;
    NSSet<NSNumber *> *keys = [NSSet setWithArray:@[
      @1, @2, @3, @4, @5, @30, @31, @32, @33, @34, @35
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
    AncPrivateVaultCanonicalValue *epoch =
        Field(map, @30, AncPrivateVaultCanonicalTypeInteger);
    AncPrivateVaultCanonicalValue *recipient =
        Field(map, @31, AncPrivateVaultCanonicalTypeBytes);
    AncPrivateVaultCanonicalValue *issuer =
        Field(map, @32, AncPrivateVaultCanonicalTypeBytes);
    AncPrivateVaultCanonicalValue *nonce =
        Field(map, @33, AncPrivateVaultCanonicalTypeBytes);
    AncPrivateVaultCanonicalValue *ciphertext =
        Field(map, @34, AncPrivateVaultCanonicalTypeBytes);
    AncPrivateVaultCanonicalValue *signature =
        Field(map, @35, AncPrivateVaultCanonicalTypeBytes);
    BOOL valid = suite != nil && [suite.textValue isEqualToString:@"anc/v1"] &&
                 vault != nil && Exact(vault.bytesValue, 16) && type != nil &&
                 [type.textValue isEqualToString:@"eek-wrap"] && created != nil &&
                 created.integerValue >= 0 &&
                 (uint64_t)created.integerValue <= kMaxSafeInteger &&
                 envelope != nil && Exact(envelope.bytesValue, 16) &&
                 epoch != nil && epoch.integerValue >= 1 &&
                 (uint64_t)epoch.integerValue <= kMaxSafeInteger &&
                 recipient != nil && Exact(recipient.bytesValue, 16) &&
                 issuer != nil && Exact(issuer.bytesValue, 16) && nonce != nil &&
                 Exact(nonce.bytesValue, 24) && ciphertext != nil &&
                 Exact(ciphertext.bytesValue, 64) && signature != nil &&
                 Exact(signature.bytesValue, 64);
    if (!valid)
      return nil;
    if (!Same(vault.bytesValue, expectedVaultId) ||
        !Same(recipient.bytesValue, expectedRecipientEndpointId) ||
        !Same(issuer.bytesValue, expectedIssuerEndpointId) ||
        (uint64_t)epoch.integerValue != expectedEpoch) {
      SetStatus(status, AncPrivateVaultEekWrapStatusBindingMismatch);
      return nil;
    }
    NSMutableDictionary *unsignedMap = [map mutableCopy];
    [unsignedMap removeObjectForKey:@35];
    NSData *unsignedEnvelope = AncPrivateVaultCanonicalEncode(
        [AncPrivateVaultCanonicalValue map:unsignedMap], &canonicalStatus);
    if (unsignedEnvelope == nil) {
      SetStatus(status, AncPrivateVaultEekWrapStatusCryptoFailed);
      return nil;
    }
    NSMutableData *message =
        [NSMutableData dataWithBytes:kEekDomain length:sizeof kEekDomain];
    [message appendData:unsignedEnvelope];
    BOOL verified = anc_pv_ed25519_verify(
                        signature.bytesValue.bytes, message.bytes,
                        message.length, expectedIssuerSigningPublicKey.bytes) ==
                    ANC_PV_CRYPTO_OK;
    anc_pv_zeroize(message.mutableBytes, message.length);
    if (!verified) {
      SetStatus(status, AncPrivateVaultEekWrapStatusInvalidSignature);
      return nil;
    }
    AncPrivateVaultEekWrap *result =
        class_createInstance(AncPrivateVaultEekWrap.class, 0);
    result.encodedEnvelope = [encoded copy];
    result.envelopeId = [envelope.bytesValue copy];
    result.recipientEndpointId = [recipient.bytesValue copy];
    result.issuerEndpointId = [issuer.bytesValue copy];
    result.nonce = [nonce.bytesValue copy];
    result.ciphertext = [ciphertext.bytesValue copy];
    result.epoch = (uint64_t)epoch.integerValue;
    result.createdAt = (uint64_t)created.integerValue;
    SetStatus(status, AncPrivateVaultEekWrapStatusOK);
    return result;
  } @catch (__unused NSException *exception) {
    SetStatus(status, AncPrivateVaultEekWrapStatusInvalid);
    return nil;
  }
}

AncPrivateVaultEekWrapStatus AncPrivateVaultEekWrapOpen(
    NSData *encoded, NSData *expectedVaultId,
    NSData *expectedRecipientEndpointId, NSData *expectedIssuerEndpointId,
    uint64_t expectedEpoch, NSData *expectedIssuerSigningPublicKey,
    NSData *expectedIssuerKeyAgreementPublicKey,
    NSData *expectedRecipientKeyAgreementPublicKey,
    const uint8_t recipientBoxSeed[32], AncPrivateVaultEekConsumer consumer) {
  AncPrivateVaultEekWrapStatus status;
  AncPrivateVaultEekWrap *wrap = AncPrivateVaultEekWrapVerify(
      encoded, expectedVaultId, expectedRecipientEndpointId,
      expectedIssuerEndpointId, expectedEpoch,
      expectedIssuerSigningPublicKey, &status);
  if (wrap == nil)
    return status;
  if (!Exact(expectedIssuerKeyAgreementPublicKey, 32) ||
      !Exact(expectedRecipientKeyAgreementPublicKey, 32) ||
      recipientBoxSeed == NULL || consumer == nil)
    return AncPrivateVaultEekWrapStatusInvalid;
  uint8_t recipientPublic[32] = {0}, recipientPrivate[32] = {0};
  uint8_t plaintext[sizeof kEekDomain + 32] = {0};
  size_t written = 0;
  AncPrivateVaultEekWrapStatus result = AncPrivateVaultEekWrapStatusCryptoFailed;
  BOOL derived = anc_pv_box_seed_keypair(recipientPublic, recipientPrivate,
                                         recipientBoxSeed) == ANC_PV_CRYPTO_OK;
  if (!derived ||
      anc_pv_memcmp(recipientPublic,
                    expectedRecipientKeyAgreementPublicKey.bytes, 32) !=
          ANC_PV_CRYPTO_OK) {
    result = AncPrivateVaultEekWrapStatusBindingMismatch;
    goto cleanup;
  }
  if (anc_pv_box_open(plaintext, sizeof plaintext, &written,
                      wrap.ciphertext.bytes, wrap.ciphertext.length,
                      wrap.nonce.bytes,
                      expectedIssuerKeyAgreementPublicKey.bytes,
                      recipientPrivate) != ANC_PV_CRYPTO_OK) {
    result = AncPrivateVaultEekWrapStatusAuthenticationFailed;
    goto cleanup;
  }
  if (written != sizeof plaintext ||
      anc_pv_memcmp(plaintext, kEekDomain, sizeof kEekDomain) !=
          ANC_PV_CRYPTO_OK) {
    result = AncPrivateVaultEekWrapStatusDomainMismatch;
    goto cleanup;
  }
  @try {
    result = consumer(plaintext + sizeof kEekDomain)
                 ? AncPrivateVaultEekWrapStatusOK
                 : AncPrivateVaultEekWrapStatusConsumerRejected;
  } @catch (__unused NSException *exception) {
    result = AncPrivateVaultEekWrapStatusConsumerRejected;
  }
cleanup:
  anc_pv_zeroize(recipientPublic, sizeof recipientPublic);
  anc_pv_zeroize(recipientPrivate, sizeof recipientPrivate);
  anc_pv_zeroize(plaintext, sizeof plaintext);
  return result;
}
