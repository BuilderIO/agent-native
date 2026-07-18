#import "PrivateVaultGrantCodec.h"

#import "PrivateVaultAncCanonical.h"

#include <string.h>

static const uint8_t kGrantDomain[] = "anc/v1/grant";
static const uint8_t kRevokeDomain[] = "anc/v1/grant-revoke";
static const NSUInteger kMaximumEnvelopeBytes = 64 * 1024;
static const uint64_t kMaximumGrantLifetimeSeconds = 30 * 24 * 60 * 60;
static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);

@interface AncPrivateVaultVerifiedGrant ()
@property(nonatomic) NSData *vaultId;
@property(nonatomic) NSData *grantRef;
@property(nonatomic) NSData *grantId;
@property(nonatomic) NSData *issuerEndpointId;
@property(nonatomic) NSData *subjectAccountId;
@property(nonatomic) NSData *subjectEndpointId;
@property(nonatomic, nullable) NSData *subjectAgentId;
@property(nonatomic) NSArray<NSData *> *resourceIds;
@property(nonatomic) NSArray<NSString *> *operations;
@property(nonatomic) NSArray<NSString *> *providers;
@property(nonatomic) uint64_t issuedAt;
@property(nonatomic) uint64_t expiresAt;
@property(nonatomic) NSData *revocationRef;
@end
@implementation AncPrivateVaultVerifiedGrant
@end

@interface AncPrivateVaultVerifiedGrantRevocation ()
@property(nonatomic) NSData *grantRef;
@property(nonatomic) NSData *revocationRef;
@property(nonatomic) uint64_t revokedAt;
@property(nonatomic) NSString *reason;
@property(nonatomic) NSData *issuerEndpointId;
@end
@implementation AncPrivateVaultVerifiedGrantRevocation
@end

static void SetStatus(AncPrivateVaultGrantCodecStatus *status,
                      AncPrivateVaultGrantCodecStatus value) {
  if (status != NULL) *status = value;
}

static AncPrivateVaultCanonicalValue *Field(NSDictionary *map, NSInteger key,
                                             AncPrivateVaultCanonicalType type) {
  AncPrivateVaultCanonicalValue *value = map[@(key)];
  return value != nil && value.type == type ? value : nil;
}

static BOOL ExactKeys(NSDictionary *map, NSArray<NSNumber *> *keys) {
  return map.count == keys.count &&
      [[NSSet setWithArray:map.allKeys] isEqualToSet:[NSSet setWithArray:keys]];
}

static NSData *ExactBytes(NSDictionary *map, NSInteger key, NSUInteger length) {
  NSData *value = Field(map, key, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  return value.length == length ? value : nil;
}

static uint64_t PositiveInteger(NSDictionary *map, NSInteger key) {
  AncPrivateVaultCanonicalValue *value =
      Field(map, key, AncPrivateVaultCanonicalTypeInteger);
  return value.integerValue > 0 &&
          (uint64_t)value.integerValue <= kMaximumSafeInteger
      ? (uint64_t)value.integerValue
      : 0;
}

static BOOL ValidToken(NSString *value) {
  NSData *bytes = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (bytes.length == 0 || bytes.length > 120) return NO;
  const uint8_t *raw = bytes.bytes;
  for (NSUInteger index = 0; index < bytes.length; index += 1) {
    uint8_t byte = raw[index];
    BOOL allowed = (byte >= 'a' && byte <= 'z') ||
        (index > 0 && byte >= '0' && byte <= '9') ||
        (index > 0 &&
         (byte == '.' || byte == '_' || byte == ':' || byte == '-'));
    if (!allowed) return NO;
  }
  return YES;
}

static BOOL BytesStrictlyBefore(NSData *left, NSData *right) {
  if (left.length != right.length) return left.length < right.length;
  int comparison = memcmp(left.bytes, right.bytes, left.length);
  return comparison < 0;
}

static NSArray<NSData *> *OrderedIds(AncPrivateVaultCanonicalValue *value,
                                     NSUInteger maximum) {
  if (value.type != AncPrivateVaultCanonicalTypeArray ||
      value.arrayValue.count == 0 || value.arrayValue.count > maximum)
    return nil;
  NSMutableArray<NSData *> *result = [NSMutableArray array];
  for (AncPrivateVaultCanonicalValue *item in value.arrayValue) {
    if (item.type != AncPrivateVaultCanonicalTypeBytes ||
        item.bytesValue.length != 16)
      return nil;
    if (result.lastObject != nil &&
        !BytesStrictlyBefore(result.lastObject, item.bytesValue))
      return nil;
    [result addObject:[item.bytesValue copy]];
  }
  return [result copy];
}

static NSArray<NSString *> *OrderedTokens(AncPrivateVaultCanonicalValue *value,
                                          NSUInteger maximum) {
  if (value.type != AncPrivateVaultCanonicalTypeArray ||
      value.arrayValue.count == 0 || value.arrayValue.count > maximum)
    return nil;
  NSMutableArray<NSString *> *result = [NSMutableArray array];
  for (AncPrivateVaultCanonicalValue *item in value.arrayValue) {
    if (item.type != AncPrivateVaultCanonicalTypeText ||
        !ValidToken(item.textValue) ||
        (result.lastObject != nil &&
         [result.lastObject compare:item.textValue] != NSOrderedAscending))
      return nil;
    [result addObject:[item.textValue copy]];
  }
  return [result copy];
}

static NSData *UnsignedBytes(NSDictionary *map, NSInteger signatureKey) {
  NSMutableDictionary *unsignedMap = [map mutableCopy];
  [unsignedMap removeObjectForKey:@(signatureKey)];
  AncPrivateVaultCanonicalStatus status;
  return AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:unsignedMap], &status);
}

static BOOL Verify(NSDictionary *map, NSInteger signatureKey,
                   const uint8_t *domain, size_t domainLength,
                   const uint8_t publicKey[ANC_PV_SIGN_PUBLIC_KEY_BYTES]) {
  NSData *signature = ExactBytes(map, signatureKey, 64);
  NSData *unsignedBytes = UnsignedBytes(map, signatureKey);
  if (signature == nil || unsignedBytes == nil || publicKey == NULL ||
      unsignedBytes.length > NSUIntegerMax - domainLength)
    return NO;
  NSMutableData *message =
      [NSMutableData dataWithCapacity:domainLength + unsignedBytes.length];
  [message appendBytes:domain length:domainLength];
  [message appendData:unsignedBytes];
  return anc_pv_ed25519_verify(signature.bytes, message.bytes, message.length,
                               publicKey) == ANC_PV_CRYPTO_OK;
}

static NSData *GrantHash(NSData *envelope) {
  uint8_t digest[32] = {0};
  if (anc_pv_blake2b_256_two_part(digest, kGrantDomain, sizeof kGrantDomain,
                                  envelope.bytes, envelope.length) !=
      ANC_PV_CRYPTO_OK)
    return nil;
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

AncPrivateVaultVerifiedGrant *AncPrivateVaultVerifyGrantEnvelope(
    NSData *envelope, NSData *expectedVaultId, uint64_t nowSeconds,
    NSData *expectedIssuerEndpointId,
    const uint8_t issuerSigningPublicKey[ANC_PV_SIGN_PUBLIC_KEY_BYTES],
    AncPrivateVaultGrantCodecStatus *status) {
  SetStatus(status, AncPrivateVaultGrantCodecStatusInvalid);
  if (envelope.length == 0 || envelope.length > kMaximumEnvelopeBytes ||
      expectedVaultId.length != 16 || expectedIssuerEndpointId.length != 16 ||
      nowSeconds == 0 || nowSeconds > kMaximumSafeInteger ||
      issuerSigningPublicKey == NULL)
    return nil;
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      envelope, kMaximumEnvelopeBytes, &canonicalStatus);
  NSDictionary *map = root.type == AncPrivateVaultCanonicalTypeMap
      ? root.mapValue
      : nil;
  NSArray *keys = @[
    @1, @2, @3, @4, @5, @60, @61, @62, @63, @64, @65, @66, @67, @68,
    @69, @70, @71
  ];
  NSData *vaultId = ExactBytes(map, 2, 16);
  NSData *issuerId = ExactBytes(map, 61, 16);
  NSData *agentId = nil;
  AncPrivateVaultCanonicalValue *agent = map[@64];
  if (agent.type == AncPrivateVaultCanonicalTypeBytes)
    agentId = agent.bytesValue.length == 16 ? agent.bytesValue : nil;
  else if (agent.type != AncPrivateVaultCanonicalTypeNull)
    return nil;
  NSArray<NSData *> *resources = OrderedIds(map[@65], 256);
  NSArray<NSString *> *operations = OrderedTokens(map[@66], 128);
  NSArray<NSString *> *providers = OrderedTokens(map[@67], 64);
  uint64_t createdAt = PositiveInteger(map, 4);
  uint64_t issuedAt = PositiveInteger(map, 68);
  uint64_t expiresAt = PositiveInteger(map, 69);
  if (!ExactKeys(map, keys) ||
      ![Field(map, 1, AncPrivateVaultCanonicalTypeText).textValue
          isEqualToString:@"anc/v1"] ||
      ![Field(map, 3, AncPrivateVaultCanonicalTypeText).textValue
          isEqualToString:@"grant"] ||
      vaultId == nil || ![vaultId isEqualToData:expectedVaultId] ||
      ExactBytes(map, 5, 16) == nil || ExactBytes(map, 60, 16) == nil ||
      issuerId == nil || ![issuerId isEqualToData:expectedIssuerEndpointId] ||
      ExactBytes(map, 62, 16) == nil || ExactBytes(map, 63, 16) == nil ||
      (agent.type == AncPrivateVaultCanonicalTypeBytes && agentId == nil) ||
      resources == nil || operations == nil || providers == nil ||
      ExactBytes(map, 70, 16) == nil || createdAt == 0 || issuedAt == 0 ||
      expiresAt == 0 || createdAt > issuedAt || expiresAt <= issuedAt ||
      expiresAt - issuedAt > kMaximumGrantLifetimeSeconds) {
    return nil;
  }
  if (nowSeconds < issuedAt || nowSeconds > expiresAt) {
    SetStatus(status, AncPrivateVaultGrantCodecStatusExpired);
    return nil;
  }
  if (!Verify(map, 71, kGrantDomain, sizeof kGrantDomain,
              issuerSigningPublicKey)) {
    SetStatus(status, AncPrivateVaultGrantCodecStatusSignature);
    return nil;
  }
  NSData *grantRef = GrantHash(envelope);
  if (grantRef == nil) {
    SetStatus(status, AncPrivateVaultGrantCodecStatusCrypto);
    return nil;
  }
  AncPrivateVaultVerifiedGrant *grant =
      [[AncPrivateVaultVerifiedGrant alloc] init];
  grant.vaultId = [vaultId copy];
  grant.grantRef = grantRef;
  grant.grantId = [ExactBytes(map, 60, 16) copy];
  grant.issuerEndpointId = [issuerId copy];
  grant.subjectAccountId = [ExactBytes(map, 62, 16) copy];
  grant.subjectEndpointId = [ExactBytes(map, 63, 16) copy];
  grant.subjectAgentId = [agentId copy];
  grant.resourceIds = resources;
  grant.operations = operations;
  grant.providers = providers;
  grant.issuedAt = issuedAt;
  grant.expiresAt = expiresAt;
  grant.revocationRef = [ExactBytes(map, 70, 16) copy];
  SetStatus(status, AncPrivateVaultGrantCodecStatusOK);
  return grant;
}

AncPrivateVaultVerifiedGrantRevocation *
AncPrivateVaultVerifyGrantRevocationEnvelope(
    NSData *envelope, NSData *expectedVaultId,
    AncPrivateVaultVerifiedGrant *expectedGrant,
    const uint8_t issuerSigningPublicKey[ANC_PV_SIGN_PUBLIC_KEY_BYTES],
    AncPrivateVaultGrantCodecStatus *status) {
  SetStatus(status, AncPrivateVaultGrantCodecStatusInvalid);
  if (envelope.length == 0 || envelope.length > kMaximumEnvelopeBytes ||
      expectedVaultId.length != 16 || expectedGrant == nil ||
      issuerSigningPublicKey == NULL)
    return nil;
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      envelope, kMaximumEnvelopeBytes, &canonicalStatus);
  NSDictionary *map = root.type == AncPrivateVaultCanonicalTypeMap
      ? root.mapValue
      : nil;
  NSArray *keys = @[@1, @2, @3, @4, @5, @72, @73, @74, @75, @76, @77];
  NSData *vaultId = ExactBytes(map, 2, 16);
  NSData *grantRef = ExactBytes(map, 72, 32);
  NSData *revocationRef = ExactBytes(map, 73, 16);
  NSData *issuerId = ExactBytes(map, 76, 16);
  uint64_t createdAt = PositiveInteger(map, 4);
  uint64_t revokedAt = PositiveInteger(map, 74);
  NSString *reason =
      Field(map, 75, AncPrivateVaultCanonicalTypeText).textValue;
  if (!ExactKeys(map, keys) ||
      ![Field(map, 1, AncPrivateVaultCanonicalTypeText).textValue
          isEqualToString:@"anc/v1"] ||
      ![Field(map, 3, AncPrivateVaultCanonicalTypeText).textValue
          isEqualToString:@"grant-revoke"] ||
      vaultId == nil || ![vaultId isEqualToData:expectedVaultId] ||
      ExactBytes(map, 5, 16) == nil || grantRef == nil ||
      ![grantRef isEqualToData:expectedGrant.grantRef] ||
      revocationRef == nil ||
      ![revocationRef isEqualToData:expectedGrant.revocationRef] ||
      issuerId == nil ||
      ![issuerId isEqualToData:expectedGrant.issuerEndpointId] ||
      createdAt == 0 || revokedAt == 0 || createdAt > revokedAt ||
      revokedAt < expectedGrant.issuedAt || !ValidToken(reason))
    return nil;
  if (!Verify(map, 77, kRevokeDomain, sizeof kRevokeDomain,
              issuerSigningPublicKey)) {
    SetStatus(status, AncPrivateVaultGrantCodecStatusSignature);
    return nil;
  }
  AncPrivateVaultVerifiedGrantRevocation *revocation =
      [[AncPrivateVaultVerifiedGrantRevocation alloc] init];
  revocation.grantRef = [grantRef copy];
  revocation.revocationRef = [revocationRef copy];
  revocation.revokedAt = revokedAt;
  revocation.reason = [reason copy];
  revocation.issuerEndpointId = [issuerId copy];
  SetStatus(status, AncPrivateVaultGrantCodecStatusOK);
  return revocation;
}
