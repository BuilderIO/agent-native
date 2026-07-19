#import "PrivateVaultDisclosureCodec.h"

#import "PrivateVaultAncCanonical.h"

static const uint8_t kDisclosureDomain[] = "anc/v1/disclosure";
static const NSUInteger kMaximumEnvelopeBytes = 64 * 1024;
static const uint64_t kMaximumLifetimeSeconds = 7 * 24 * 60 * 60;
static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);

@interface AncPrivateVaultVerifiedDisclosure ()
@property(nonatomic) NSData *vaultId;
@property(nonatomic) NSData *disclosureId;
@property(nonatomic) NSData *grantRef;
@property(nonatomic) NSString *providerId;
@property(nonatomic) NSString *destination;
@property(nonatomic) NSData *scopeHash;
@property(nonatomic) uint64_t issuedAt;
@property(nonatomic) uint64_t expiresAt;
@end
@implementation AncPrivateVaultVerifiedDisclosure
@end

static void SetStatus(AncPrivateVaultDisclosureCodecStatus *status,
                      AncPrivateVaultDisclosureCodecStatus value) {
  if (status != NULL) *status = value;
}

static AncPrivateVaultCanonicalValue *Field(NSDictionary *map, NSInteger key,
                                             AncPrivateVaultCanonicalType type) {
  AncPrivateVaultCanonicalValue *value = map[@(key)];
  return value != nil && value.type == type ? value : nil;
}

static NSData *ExactBytes(NSDictionary *map, NSInteger key, NSUInteger length) {
  NSData *value = Field(map, key, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  return value.length == length ? value : nil;
}

static BOOL ValidText(NSString *value, NSUInteger maximum) {
  NSData *bytes = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (bytes.length == 0 || bytes.length > maximum) return NO;
  const uint8_t *raw = bytes.bytes;
  for (NSUInteger index = 0; index < bytes.length; index += 1)
    if (raw[index] < 0x21 || raw[index] > 0x7e) return NO;
  return YES;
}

static BOOL ExactKeys(NSDictionary *map) {
  NSArray *keys = @[@1, @2, @3, @4, @5, @80, @81, @82, @83, @84, @85, @86];
  return map.count == keys.count &&
      [[NSSet setWithArray:map.allKeys] isEqualToSet:[NSSet setWithArray:keys]];
}

static NSData *UnsignedBytes(NSDictionary *map) {
  NSMutableDictionary *unsignedMap = [map mutableCopy];
  [unsignedMap removeObjectForKey:@86];
  AncPrivateVaultCanonicalStatus status;
  return AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:unsignedMap], &status);
}

static NSData *SigningMessage(NSData *unsignedBytes) {
  if (unsignedBytes.length == 0 ||
      unsignedBytes.length > NSUIntegerMax - sizeof kDisclosureDomain)
    return nil;
  NSMutableData *message = [NSMutableData
      dataWithCapacity:sizeof kDisclosureDomain + unsignedBytes.length];
  [message appendBytes:kDisclosureDomain length:sizeof kDisclosureDomain];
  [message appendData:unsignedBytes];
  return message;
}

NSData *AncPrivateVaultSealDisclosureEnvelope(
    NSData *vaultId, NSData *disclosureId, uint64_t createdAt,
    NSData *grantRef, NSString *providerId, NSString *destination,
    NSData *scopeHash, uint64_t issuedAt, uint64_t expiresAt,
    const uint8_t brokerSigningSeed[ANC_PV_SEED_BYTES],
    AncPrivateVaultDisclosureCodecStatus *status) {
  SetStatus(status, AncPrivateVaultDisclosureCodecStatusInvalid);
  if (vaultId.length != 16 || disclosureId.length != 16 ||
      grantRef.length != 32 || scopeHash.length != 32 || createdAt == 0 ||
      createdAt > issuedAt || issuedAt == 0 || expiresAt <= issuedAt ||
      expiresAt > kMaximumSafeInteger ||
      expiresAt - issuedAt > kMaximumLifetimeSeconds ||
      !ValidText(providerId, 120) || !ValidText(destination, 160) ||
      brokerSigningSeed == NULL)
    return nil;
  NSMutableDictionary *map = [@{
    @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
    @2 : [AncPrivateVaultCanonicalValue bytes:vaultId],
    @3 : [AncPrivateVaultCanonicalValue text:@"disclosure"],
    @4 : [AncPrivateVaultCanonicalValue integer:(int64_t)createdAt],
    @5 : [AncPrivateVaultCanonicalValue bytes:disclosureId],
    @80 : [AncPrivateVaultCanonicalValue bytes:grantRef],
    @81 : [AncPrivateVaultCanonicalValue text:providerId],
    @82 : [AncPrivateVaultCanonicalValue text:destination],
    @83 : [AncPrivateVaultCanonicalValue bytes:scopeHash],
    @84 : [AncPrivateVaultCanonicalValue integer:(int64_t)issuedAt],
    @85 : [AncPrivateVaultCanonicalValue integer:(int64_t)expiresAt],
  } mutableCopy];
  NSData *message = SigningMessage(UnsignedBytes(map));
  uint8_t publicKey[ANC_PV_SIGN_PUBLIC_KEY_BYTES] = {0};
  uint8_t privateKey[ANC_PV_SIGN_PRIVATE_KEY_BYTES] = {0};
  uint8_t signature[ANC_PV_SIGNATURE_BYTES] = {0};
  BOOL signedValue = message != nil &&
      anc_pv_ed25519_seed_keypair(publicKey, privateKey, brokerSigningSeed) ==
          ANC_PV_CRYPTO_OK &&
      anc_pv_ed25519_sign(signature, message.bytes, message.length,
                          privateKey) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(publicKey, sizeof publicKey);
  anc_pv_zeroize(privateKey, sizeof privateKey);
  if (!signedValue) {
    anc_pv_zeroize(signature, sizeof signature);
    SetStatus(status, AncPrivateVaultDisclosureCodecStatusCrypto);
    return nil;
  }
  map[@86] = [AncPrivateVaultCanonicalValue
      bytes:[NSData dataWithBytes:signature length:sizeof signature]];
  anc_pv_zeroize(signature, sizeof signature);
  AncPrivateVaultCanonicalStatus canonicalStatus;
  NSData *encoded = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:map], &canonicalStatus);
  if (encoded.length == 0 || encoded.length > kMaximumEnvelopeBytes) return nil;
  SetStatus(status, AncPrivateVaultDisclosureCodecStatusOK);
  return encoded;
}

AncPrivateVaultVerifiedDisclosure *AncPrivateVaultVerifyDisclosureEnvelope(
    NSData *envelope, NSData *expectedVaultId, NSData *expectedGrantRef,
    uint64_t nowSeconds,
    const uint8_t brokerSigningPublicKey[ANC_PV_SIGN_PUBLIC_KEY_BYTES],
    AncPrivateVaultDisclosureCodecStatus *status) {
  SetStatus(status, AncPrivateVaultDisclosureCodecStatusInvalid);
  if (envelope.length == 0 || envelope.length > kMaximumEnvelopeBytes ||
      expectedVaultId.length != 16 || expectedGrantRef.length != 32 ||
      nowSeconds == 0 || nowSeconds > kMaximumSafeInteger ||
      brokerSigningPublicKey == NULL)
    return nil;
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      envelope, kMaximumEnvelopeBytes, &canonicalStatus);
  NSDictionary *map = root.type == AncPrivateVaultCanonicalTypeMap
      ? root.mapValue : nil;
  NSData *vaultId = ExactBytes(map, 2, 16);
  NSData *disclosureId = ExactBytes(map, 5, 16);
  NSData *grantRef = ExactBytes(map, 80, 32);
  NSData *scopeHash = ExactBytes(map, 83, 32);
  NSString *providerId = Field(map, 81, AncPrivateVaultCanonicalTypeText).textValue;
  NSString *destination = Field(map, 82, AncPrivateVaultCanonicalTypeText).textValue;
  int64_t createdAt = Field(map, 4, AncPrivateVaultCanonicalTypeInteger).integerValue;
  int64_t issuedAt = Field(map, 84, AncPrivateVaultCanonicalTypeInteger).integerValue;
  int64_t expiresAt = Field(map, 85, AncPrivateVaultCanonicalTypeInteger).integerValue;
  NSData *signature = ExactBytes(map, 86, ANC_PV_SIGNATURE_BYTES);
  if (canonicalStatus != AncPrivateVaultCanonicalStatusOK || !ExactKeys(map) ||
      ![Field(map, 1, AncPrivateVaultCanonicalTypeText).textValue
          isEqualToString:@"anc/v1"] ||
      ![Field(map, 3, AncPrivateVaultCanonicalTypeText).textValue
          isEqualToString:@"disclosure"] ||
      ![vaultId isEqualToData:expectedVaultId] ||
      ![grantRef isEqualToData:expectedGrantRef] || disclosureId == nil ||
      scopeHash == nil || !ValidText(providerId, 120) ||
      !ValidText(destination, 160) || createdAt <= 0 || issuedAt <= 0 ||
      createdAt > issuedAt || expiresAt <= issuedAt ||
      (uint64_t)expiresAt - (uint64_t)issuedAt > kMaximumLifetimeSeconds ||
      signature == nil)
    return nil;
  if (nowSeconds > (uint64_t)expiresAt) {
    SetStatus(status, AncPrivateVaultDisclosureCodecStatusExpired);
    return nil;
  }
  NSData *message = SigningMessage(UnsignedBytes(map));
  if (message == nil ||
      anc_pv_ed25519_verify(signature.bytes, message.bytes, message.length,
                            brokerSigningPublicKey) != ANC_PV_CRYPTO_OK) {
    SetStatus(status, AncPrivateVaultDisclosureCodecStatusSignature);
    return nil;
  }
  AncPrivateVaultVerifiedDisclosure *verified =
      [AncPrivateVaultVerifiedDisclosure new];
  verified.vaultId = [vaultId copy];
  verified.disclosureId = [disclosureId copy];
  verified.grantRef = [grantRef copy];
  verified.providerId = [providerId copy];
  verified.destination = [destination copy];
  verified.scopeHash = [scopeHash copy];
  verified.issuedAt = (uint64_t)issuedAt;
  verified.expiresAt = (uint64_t)expiresAt;
  SetStatus(status, AncPrivateVaultDisclosureCodecStatusOK);
  return verified;
}
