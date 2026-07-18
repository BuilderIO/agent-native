#import "PrivateVaultEnrollmentSasReceipt.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

#import <objc/runtime.h>

static const uint8_t kReceiptDomain[] = "anc/v1/enrollment-sas-decision";
static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);

@interface AncPrivateVaultEnrollmentSasReceipt ()
@property(nonatomic, readwrite) NSData *encodedReceipt;
@property(nonatomic, readwrite) NSData *receiptHash;
@property(nonatomic, readwrite) NSData *receiptId;
@property(nonatomic, readwrite) NSData *vaultId;
@property(nonatomic, readwrite) NSData *offerHash;
@property(nonatomic, readwrite) NSData *challengeHash;
@property(nonatomic, readwrite) NSData *sasTranscriptHash;
@property(nonatomic, readwrite) NSData *candidateEndpointId;
@property(nonatomic, readwrite) NSData *ceremonyId;
@property(nonatomic, readwrite) uint64_t decidedAt;
@property(nonatomic, readwrite) AncPrivateVaultEnrollmentSasDecision decision;
@end
@implementation AncPrivateVaultEnrollmentSasReceipt
@end

static void SetStatus(AncPrivateVaultEnrollmentSasReceiptStatus *status,
                      AncPrivateVaultEnrollmentSasReceiptStatus value) {
  if (status != NULL)
    *status = value;
}

static BOOL Exact(NSData *data, NSUInteger length) {
  return [data isKindOfClass:NSData.class] && data.length == length;
}

static BOOL Same(NSData *left, NSData *right) {
  return Exact(left, right.length) && right.length > 0 &&
         anc_pv_memcmp(left.bytes, right.bytes, right.length) ==
             ANC_PV_CRYPTO_OK;
}

static AncPrivateVaultCanonicalValue *
Field(NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map,
      NSNumber *key, AncPrivateVaultCanonicalType type) {
  AncPrivateVaultCanonicalValue *value = map[key];
  return value.type == type ? value : nil;
}

static BOOL ExactKeys(NSDictionary<NSNumber *, id> *map,
                      NSArray<NSNumber *> *keys) {
  return map.count == keys.count && [[NSSet setWithArray:map.allKeys]
                                        isEqualToSet:[NSSet setWithArray:keys]];
}

static NSData *VaultId(AncPrivateVaultEnrollmentChallengeResult *challenge) {
  NSDictionary *map = nil;
  @try {
    AncPrivateVaultCanonicalStatus status;
    AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
        challenge.encodedChallenge, 2048, &status);
    map = root.type == AncPrivateVaultCanonicalTypeMap ? root.mapValue : nil;
  } @catch (__unused NSException *exception) {
    return nil;
  }
  NSData *vault = Field(map, @2, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  return Exact(vault, 16) ? [vault copy] : nil;
}

static NSData *Hash(NSData *encoded) {
  uint8_t digest[32] = {0};
  BOOL ok = anc_pv_blake2b_256_two_part(digest, kReceiptDomain,
                                        sizeof kReceiptDomain, encoded.bytes,
                                        encoded.length) == ANC_PV_CRYPTO_OK;
  NSData *result = ok ? [NSData dataWithBytes:digest length:32] : nil;
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static AncPrivateVaultEnrollmentSasReceipt *
Receipt(NSData *encoded, NSDictionary *map,
        AncPrivateVaultEnrollmentSasDecision decision) {
  NSData *hash = Hash(encoded);
  if (hash == nil)
    return nil;
  AncPrivateVaultEnrollmentSasReceipt *result =
      class_createInstance(AncPrivateVaultEnrollmentSasReceipt.class, 0);
  result.encodedReceipt = [encoded copy];
  result.receiptHash = hash;
  result.vaultId =
      [Field(map, @2, AncPrivateVaultCanonicalTypeBytes).bytesValue copy];
  result.decidedAt =
      (uint64_t)Field(map, @4, AncPrivateVaultCanonicalTypeInteger)
          .integerValue;
  result.receiptId =
      [Field(map, @5, AncPrivateVaultCanonicalTypeBytes).bytesValue copy];
  result.offerHash =
      [Field(map, @620, AncPrivateVaultCanonicalTypeBytes).bytesValue copy];
  result.challengeHash =
      [Field(map, @621, AncPrivateVaultCanonicalTypeBytes).bytesValue copy];
  result.sasTranscriptHash =
      [Field(map, @622, AncPrivateVaultCanonicalTypeBytes).bytesValue copy];
  result.candidateEndpointId =
      [Field(map, @623, AncPrivateVaultCanonicalTypeBytes).bytesValue copy];
  result.ceremonyId =
      [Field(map, @624, AncPrivateVaultCanonicalTypeBytes).bytesValue copy];
  result.decision = decision;
  return result;
}

AncPrivateVaultEnrollmentSasReceipt *AncPrivateVaultEnrollmentSasReceiptVerify(
    NSData *encoded, AncPrivateVaultEnrollmentChallengeResult *challenge,
    AncPrivateVaultEnrollmentSasReceiptStatus *status) {
  SetStatus(status, AncPrivateVaultEnrollmentSasReceiptStatusInvalid);
  @try {
    if (encoded.length == 0 || encoded.length > 2048 || challenge == nil)
      return nil;
    AncPrivateVaultCanonicalStatus canonicalStatus;
    AncPrivateVaultCanonicalValue *root =
        AncPrivateVaultCanonicalDecode(encoded, 2048, &canonicalStatus);
    NSDictionary *map =
        root.type == AncPrivateVaultCanonicalTypeMap ? root.mapValue : nil;
    NSArray *keys =
        @[ @1, @2, @3, @4, @5, @620, @621, @622, @623, @624, @625, @626 ];
    if (!ExactKeys(map, keys))
      return nil;
    NSData *vault =
        Field(map, @2, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    AncPrivateVaultCanonicalValue *decided =
        Field(map, @4, AncPrivateVaultCanonicalTypeInteger);
    NSString *decisionText =
        Field(map, @625, AncPrivateVaultCanonicalTypeText).textValue;
    AncPrivateVaultEnrollmentSasDecision decision =
        [decisionText isEqualToString:@"confirmed"]
            ? AncPrivateVaultEnrollmentSasDecisionConfirmed
        : [decisionText isEqualToString:@"mismatch"]
            ? AncPrivateVaultEnrollmentSasDecisionMismatch
            : 0;
    BOOL valid =
        [Field(map, @1, AncPrivateVaultCanonicalTypeText).textValue
            isEqualToString:@"anc/v1"] &&
        [Field(map, @3, AncPrivateVaultCanonicalTypeText).textValue
            isEqualToString:@"enrollment-sas-decision"] &&
        Exact(vault, 16) && decided.integerValue >= 0 &&
        (uint64_t)decided.integerValue <= kMaximumSafeInteger &&
        Exact(Field(map, @5, AncPrivateVaultCanonicalTypeBytes).bytesValue,
              16) &&
        Exact(Field(map, @620, AncPrivateVaultCanonicalTypeBytes).bytesValue,
              32) &&
        Exact(Field(map, @621, AncPrivateVaultCanonicalTypeBytes).bytesValue,
              32) &&
        Exact(Field(map, @622, AncPrivateVaultCanonicalTypeBytes).bytesValue,
              32) &&
        Exact(Field(map, @623, AncPrivateVaultCanonicalTypeBytes).bytesValue,
              16) &&
        Exact(Field(map, @624, AncPrivateVaultCanonicalTypeBytes).bytesValue,
              16) &&
        decision != 0 &&
        Exact(Field(map, @626, AncPrivateVaultCanonicalTypeBytes).bytesValue,
              64);
    if (!valid)
      return nil;
    NSData *expectedVault = VaultId(challenge);
    BOOL bound =
        Same(vault, expectedVault) &&
        Same(Field(map, @620, AncPrivateVaultCanonicalTypeBytes).bytesValue,
             challenge.offerHash) &&
        Same(Field(map, @621, AncPrivateVaultCanonicalTypeBytes).bytesValue,
             challenge.challengeHash) &&
        Same(Field(map, @622, AncPrivateVaultCanonicalTypeBytes).bytesValue,
             challenge.sasTranscriptHash) &&
        Same(Field(map, @623, AncPrivateVaultCanonicalTypeBytes).bytesValue,
             challenge.candidateEndpointId) &&
        Same(Field(map, @624, AncPrivateVaultCanonicalTypeBytes).bytesValue,
             challenge.ceremonyId) &&
        (uint64_t)decided.integerValue >= challenge.createdAt &&
        (uint64_t)decided.integerValue <= challenge.expiresAt;
    if (!bound) {
      SetStatus(status,
                AncPrivateVaultEnrollmentSasReceiptStatusBindingMismatch);
      return nil;
    }
    NSMutableDictionary *unsignedMap = [map mutableCopy];
    [unsignedMap removeObjectForKey:@626];
    NSData *unsignedBytes = AncPrivateVaultCanonicalEncode(
        [AncPrivateVaultCanonicalValue map:unsignedMap], &canonicalStatus);
    NSMutableData *message =
        [NSMutableData dataWithBytes:kReceiptDomain
                              length:sizeof kReceiptDomain];
    [message appendData:unsignedBytes];
    NSData *signature =
        Field(map, @626, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    BOOL verified =
        unsignedBytes != nil &&
        anc_pv_ed25519_verify(signature.bytes, message.bytes, message.length,
                              challenge.candidateSigningPublicKey.bytes) ==
            ANC_PV_CRYPTO_OK;
    anc_pv_zeroize(message.mutableBytes, message.length);
    if (!verified) {
      SetStatus(status,
                AncPrivateVaultEnrollmentSasReceiptStatusInvalidSignature);
      return nil;
    }
    AncPrivateVaultEnrollmentSasReceipt *result =
        Receipt(encoded, map, decision);
    SetStatus(status,
              result == nil
                  ? AncPrivateVaultEnrollmentSasReceiptStatusCryptoFailed
                  : AncPrivateVaultEnrollmentSasReceiptStatusOK);
    return result;
  } @catch (__unused NSException *exception) {
    SetStatus(status, AncPrivateVaultEnrollmentSasReceiptStatusInvalid);
    return nil;
  }
}

AncPrivateVaultEnrollmentSasReceipt *AncPrivateVaultEnrollmentSasReceiptBuild(
    AncPrivateVaultEnrollmentChallengeResult *challenge, NSData *receiptId,
    uint64_t decidedAt, AncPrivateVaultEnrollmentSasDecision decision,
    const uint8_t *candidateSigningSeed,
    AncPrivateVaultEnrollmentSasReceiptStatus *status) {
  SetStatus(status, AncPrivateVaultEnrollmentSasReceiptStatusInvalid);
  if (challenge == nil || !Exact(receiptId, 16) ||
      candidateSigningSeed == NULL || decidedAt < challenge.createdAt ||
      decidedAt > challenge.expiresAt ||
      (decision != AncPrivateVaultEnrollmentSasDecisionConfirmed &&
       decision != AncPrivateVaultEnrollmentSasDecisionMismatch))
    return nil;
  NSData *vault = VaultId(challenge);
  if (vault == nil)
    return nil;
  uint8_t publicKey[32] = {0}, privateKey[64] = {0}, signature[64] = {0};
  AncPrivateVaultEnrollmentSasReceipt *result = nil;
  @try {
    NSDictionary *unsignedMap = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue bytes:vault],
      @3 : [AncPrivateVaultCanonicalValue text:@"enrollment-sas-decision"],
      @4 : [AncPrivateVaultCanonicalValue integer:(int64_t)decidedAt],
      @5 : [AncPrivateVaultCanonicalValue bytes:receiptId],
      @620 : [AncPrivateVaultCanonicalValue bytes:challenge.offerHash],
      @621 : [AncPrivateVaultCanonicalValue bytes:challenge.challengeHash],
      @622 : [AncPrivateVaultCanonicalValue bytes:challenge.sasTranscriptHash],
      @623 :
          [AncPrivateVaultCanonicalValue bytes:challenge.candidateEndpointId],
      @624 : [AncPrivateVaultCanonicalValue bytes:challenge.ceremonyId],
      @625 : [AncPrivateVaultCanonicalValue
          text:decision == AncPrivateVaultEnrollmentSasDecisionConfirmed
                   ? @"confirmed"
                   : @"mismatch"],
    };
    AncPrivateVaultCanonicalStatus canonicalStatus;
    NSData *unsignedBytes = AncPrivateVaultCanonicalEncode(
        [AncPrivateVaultCanonicalValue map:unsignedMap], &canonicalStatus);
    NSMutableData *message =
        [NSMutableData dataWithBytes:kReceiptDomain
                              length:sizeof kReceiptDomain];
    [message appendData:unsignedBytes];
    BOOL signedReceipt =
        unsignedBytes != nil &&
        anc_pv_ed25519_seed_keypair(publicKey, privateKey,
                                    candidateSigningSeed) == ANC_PV_CRYPTO_OK &&
        anc_pv_memcmp(publicKey, challenge.candidateSigningPublicKey.bytes,
                      32) == ANC_PV_CRYPTO_OK &&
        anc_pv_ed25519_sign(signature, message.bytes, message.length,
                            privateKey) == ANC_PV_CRYPTO_OK;
    anc_pv_zeroize(message.mutableBytes, message.length);
    if (signedReceipt) {
      NSMutableDictionary *signedMap = [unsignedMap mutableCopy];
      signedMap[@626] = [AncPrivateVaultCanonicalValue
          bytes:[NSData dataWithBytes:signature length:64]];
      NSData *encoded = AncPrivateVaultCanonicalEncode(
          [AncPrivateVaultCanonicalValue map:signedMap], &canonicalStatus);
      result =
          AncPrivateVaultEnrollmentSasReceiptVerify(encoded, challenge, status);
    }
  } @catch (__unused NSException *exception) {
    result = nil;
  }
  anc_pv_zeroize(publicKey, sizeof publicKey);
  anc_pv_zeroize(privateKey, sizeof privateKey);
  anc_pv_zeroize(signature, sizeof signature);
  if (result == nil && (status == NULL ||
                        *status == AncPrivateVaultEnrollmentSasReceiptStatusOK))
    SetStatus(status, AncPrivateVaultEnrollmentSasReceiptStatusCryptoFailed);
  return result;
}
