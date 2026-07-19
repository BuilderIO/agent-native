#import "PrivateVaultJobCodec.h"

#import "PrivateVaultAncCanonical.h"

#include <string.h>

static const uint8_t kJobDomain[] = "anc/v1/job";
static const uint8_t kResultDomain[] = "anc/v1/result";
static const NSUInteger kEnvelopeMaximum = 16 * 1024 * 1024 + 64 * 1024;
static const NSUInteger kPayloadMaximum = 16 * 1024 * 1024;

@implementation AncPrivateVaultOpenedJob
{
  NSMutableData *_mutablePayload;
  BOOL _closed;
}
- (instancetype)initWithPayload:(NSData *)payload
                       grantRef:(NSData *)grantRef
                         jobHash:(NSData *)jobHash {
  self = [super init];
  if (self != nil) {
    _mutablePayload = [payload mutableCopy];
    _payload = _mutablePayload;
    _grantRef = [grantRef copy];
    _jobHash = [jobHash copy];
  }
  return self;
}
- (BOOL)isClosed { return _closed; }
- (void)close {
  if (_closed) return;
  anc_pv_zeroize(_mutablePayload.mutableBytes, _mutablePayload.length);
  _closed = YES;
}
- (void)dealloc { [self close]; }
@end

@interface AncPrivateVaultJobCoordinates ()
@property(nonatomic) NSData *grantRef;
@property(nonatomic) uint64_t issuedAt;
@property(nonatomic) uint64_t expiresAt;
@end
@implementation AncPrivateVaultJobCoordinates
@end

@interface AncPrivateVaultSemanticJobPayload ()
@property(nonatomic) NSData *resourceId;
@property(nonatomic) NSString *operation;
@property(nonatomic) NSString *provider;
@property(nonatomic) NSData *body;
@property(nonatomic) NSString *disclosureProviderId;
@property(nonatomic) NSString *disclosureDestination;
@end
@implementation AncPrivateVaultSemanticJobPayload
@end

@interface AncPrivateVaultVerifiedResult ()
@property(nonatomic) NSString *state;
@end
@implementation AncPrivateVaultVerifiedResult
@end

@implementation AncPrivateVaultOpenedResult {
  NSMutableData *_mutablePayload;
  BOOL _closed;
}
- (instancetype)initWithPayload:(NSData *)payload state:(NSString *)state {
  self = [super init];
  if (self != nil) {
    _mutablePayload = [payload mutableCopy];
    _payload = _mutablePayload;
    _state = [state copy];
  }
  return self;
}
- (BOOL)isClosed { return _closed; }
- (void)close {
  if (_closed) return;
  anc_pv_zeroize(_mutablePayload.mutableBytes, _mutablePayload.length);
  _closed = YES;
}
- (void)dealloc { [self close]; }
@end

static void SetStatus(AncPrivateVaultJobCodecStatus *status,
                      AncPrivateVaultJobCodecStatus value) {
  if (status != NULL) *status = value;
}

static AncPrivateVaultCanonicalValue *Field(NSDictionary *map, NSInteger key,
                                             AncPrivateVaultCanonicalType type) {
  AncPrivateVaultCanonicalValue *value = map[@(key)];
  return value != nil && value.type == type ? value : nil;
}

static BOOL ExactBytes(NSDictionary *map, NSInteger key, NSUInteger length,
                       NSData **output) {
  AncPrivateVaultCanonicalValue *value =
      Field(map, key, AncPrivateVaultCanonicalTypeBytes);
  if (value.bytesValue.length != length) return NO;
  if (output != NULL) *output = value.bytesValue;
  return YES;
}

static BOOL ExactCommon(NSDictionary *map, NSString *type, NSData *vaultId) {
  AncPrivateVaultCanonicalValue *suite =
      Field(map, 1, AncPrivateVaultCanonicalTypeText);
  AncPrivateVaultCanonicalValue *actualVault =
      Field(map, 2, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *actualType =
      Field(map, 3, AncPrivateVaultCanonicalTypeText);
  AncPrivateVaultCanonicalValue *created =
      Field(map, 4, AncPrivateVaultCanonicalTypeInteger);
  return suite != nil && [suite.textValue isEqualToString:@"anc/v1"] &&
         actualVault.bytesValue.length == 16 &&
         [actualVault.bytesValue isEqualToData:vaultId] && actualType != nil &&
         [actualType.textValue isEqualToString:type] && created.integerValue > 0 &&
         ExactBytes(map, 5, 16, NULL);
}

static BOOL ScopeText(AncPrivateVaultCanonicalValue *value) {
  if (value.type != AncPrivateVaultCanonicalTypeText) return NO;
  NSData *bytes = [value.textValue dataUsingEncoding:NSUTF8StringEncoding];
  if (bytes.length == 0 || bytes.length > 160) return NO;
  const uint8_t *raw = bytes.bytes;
  for (NSUInteger index = 0; index < bytes.length; index += 1)
    if (raw[index] < 0x21 || raw[index] > 0x7e) return NO;
  return YES;
}

static NSData *DomainMessage(const uint8_t *domain, size_t domainLength,
                             NSData *payload);
static NSData *UnsignedBytes(NSDictionary *map, NSInteger signatureKey);

AncPrivateVaultJobCoordinates *AncPrivateVaultInspectJobEnvelope(
    NSData *envelope, NSData *expectedVaultId, NSData *expectedJobId,
    NSData *expectedRecipientEndpointId,
    AncPrivateVaultJobCodecStatus *status) {
  SetStatus(status, AncPrivateVaultJobCodecStatusInvalid);
  if (envelope.length == 0 || envelope.length > kEnvelopeMaximum ||
      expectedVaultId.length != 16 || expectedJobId.length != 16 ||
      expectedRecipientEndpointId.length != 16)
    return nil;
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      envelope, kEnvelopeMaximum, &canonicalStatus);
  NSDictionary *map = root.type == AncPrivateVaultCanonicalTypeMap
      ? root.mapValue : nil;
  NSSet *expected = [NSSet setWithArray:@[
    @1, @2, @3, @4, @5, @90, @91, @92, @93, @94, @95, @96
  ]];
  NSData *jobId = nil, *grantRef = nil, *recipient = nil;
  AncPrivateVaultCanonicalValue *issued =
      Field(map, 92, AncPrivateVaultCanonicalTypeInteger);
  AncPrivateVaultCanonicalValue *expires =
      Field(map, 93, AncPrivateVaultCanonicalTypeInteger);
  AncPrivateVaultCanonicalValue *ciphertext =
      Field(map, 95, AncPrivateVaultCanonicalTypeBytes);
  if (map.count != expected.count ||
      ![expected isEqualToSet:[NSSet setWithArray:map.allKeys]] ||
      !ExactCommon(map, @"job", expectedVaultId) ||
      !ExactBytes(map, 90, 16, &jobId) ||
      ![jobId isEqualToData:expectedJobId] ||
      !ExactBytes(map, 91, 32, &grantRef) || issued.integerValue <= 0 ||
      expires.integerValue <= issued.integerValue ||
      !ExactBytes(map, 94, 16, &recipient) ||
      ![recipient isEqualToData:expectedRecipientEndpointId] ||
      ciphertext.bytesValue.length < 24 + 16 + sizeof kJobDomain ||
      ciphertext.bytesValue.length >
          kPayloadMaximum + 24 + 16 + sizeof kJobDomain ||
      !ExactBytes(map, 96, 64, NULL))
    return nil;
  AncPrivateVaultJobCoordinates *coordinates =
      [AncPrivateVaultJobCoordinates new];
  coordinates.grantRef = [grantRef copy];
  coordinates.issuedAt = (uint64_t)issued.integerValue;
  coordinates.expiresAt = (uint64_t)expires.integerValue;
  SetStatus(status, AncPrivateVaultJobCodecStatusOK);
  return coordinates;
}

AncPrivateVaultSemanticJobPayload *AncPrivateVaultDecodeSemanticJobPayload(
    NSData *encoded, AncPrivateVaultJobCodecStatus *status) {
  SetStatus(status, AncPrivateVaultJobCodecStatusInvalid);
  if (encoded.length == 0 || encoded.length > kPayloadMaximum) return nil;
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      encoded, kPayloadMaximum, &canonicalStatus);
  NSDictionary *map = root.type == AncPrivateVaultCanonicalTypeMap
      ? root.mapValue : nil;
  NSSet *expected = [NSSet setWithArray:@[@1, @2, @3, @4, @5, @6, @7, @8]];
  AncPrivateVaultCanonicalValue *suite =
      Field(map, 1, AncPrivateVaultCanonicalTypeText);
  AncPrivateVaultCanonicalValue *type =
      Field(map, 2, AncPrivateVaultCanonicalTypeText);
  NSData *resourceId = nil;
  AncPrivateVaultCanonicalValue *operation = map[@4];
  AncPrivateVaultCanonicalValue *provider = map[@5];
  AncPrivateVaultCanonicalValue *body =
      Field(map, 6, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *disclosureProvider = map[@7];
  AncPrivateVaultCanonicalValue *disclosureDestination = map[@8];
  if (map.count != expected.count ||
      ![expected isEqualToSet:[NSSet setWithArray:map.allKeys]] ||
      ![suite.textValue isEqualToString:@"anc/v1"] ||
      ![type.textValue isEqualToString:@"semantic-job"] ||
      !ExactBytes(map, 3, 16, &resourceId) || !ScopeText(operation) ||
      !ScopeText(provider) || body == nil ||
      body.bytesValue.length > kPayloadMaximum ||
      !ScopeText(disclosureProvider) || !ScopeText(disclosureDestination))
    return nil;
  AncPrivateVaultSemanticJobPayload *payload =
      [AncPrivateVaultSemanticJobPayload new];
  payload.resourceId = [resourceId copy];
  payload.operation = [operation.textValue copy];
  payload.provider = [provider.textValue copy];
  payload.body = [body.bytesValue copy];
  payload.disclosureProviderId = [disclosureProvider.textValue copy];
  payload.disclosureDestination = [disclosureDestination.textValue copy];
  SetStatus(status, AncPrivateVaultJobCodecStatusOK);
  return payload;
}

AncPrivateVaultVerifiedResult *AncPrivateVaultVerifyResultEnvelope(
    NSData *envelope, NSData *expectedVaultId, NSData *expectedJobId,
    NSData *expectedJobHash, NSData *expectedRecipientEndpointId,
    const uint8_t brokerSigningPublicKey[32],
    AncPrivateVaultJobCodecStatus *status) {
  SetStatus(status, AncPrivateVaultJobCodecStatusInvalid);
  if (envelope.length == 0 || envelope.length > kEnvelopeMaximum ||
      expectedVaultId.length != 16 || expectedJobId.length != 16 ||
      expectedJobHash.length != 32 || expectedRecipientEndpointId.length != 16 ||
      brokerSigningPublicKey == NULL)
    return nil;
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      envelope, kEnvelopeMaximum, &canonicalStatus);
  NSDictionary *map = root.type == AncPrivateVaultCanonicalTypeMap
      ? root.mapValue : nil;
  NSSet *expected = [NSSet setWithArray:@[
    @1, @2, @3, @4, @5, @100, @101, @102, @103, @104, @105
  ]];
  NSData *jobId = nil, *jobHash = nil, *recipient = nil, *signature = nil;
  AncPrivateVaultCanonicalValue *ciphertext =
      Field(map, 103, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *state =
      Field(map, 105, AncPrivateVaultCanonicalTypeText);
  if (map.count != expected.count ||
      ![expected isEqualToSet:[NSSet setWithArray:map.allKeys]] ||
      !ExactCommon(map, @"result", expectedVaultId) ||
      !ExactBytes(map, 100, 16, &jobId) ||
      ![jobId isEqualToData:expectedJobId] ||
      !ExactBytes(map, 101, 32, &jobHash) ||
      ![jobHash isEqualToData:expectedJobHash] ||
      !ExactBytes(map, 102, 16, &recipient) ||
      ![recipient isEqualToData:expectedRecipientEndpointId] ||
      ciphertext.bytesValue.length < 24 + 16 + sizeof kResultDomain ||
      ciphertext.bytesValue.length >
          kPayloadMaximum + 24 + 16 + sizeof kResultDomain ||
      !ExactBytes(map, 104, 64, &signature) ||
      !([state.textValue isEqualToString:@"completed"] ||
        [state.textValue isEqualToString:@"failed"]))
    return nil;
  NSData *unsignedBytes = UnsignedBytes(map, 104);
  NSData *message = DomainMessage(kResultDomain, sizeof kResultDomain,
                                  unsignedBytes);
  if (message == nil ||
      anc_pv_ed25519_verify(signature.bytes, message.bytes, message.length,
                            brokerSigningPublicKey) != ANC_PV_CRYPTO_OK) {
    SetStatus(status, AncPrivateVaultJobCodecStatusSignature);
    return nil;
  }
  AncPrivateVaultVerifiedResult *verified = [AncPrivateVaultVerifiedResult new];
  verified.state = [state.textValue copy];
  SetStatus(status, AncPrivateVaultJobCodecStatusOK);
  return verified;
}

AncPrivateVaultOpenedResult *AncPrivateVaultOpenResultEnvelope(
    NSData *envelope, NSData *expectedVaultId, NSData *expectedJobId,
    NSData *expectedJobHash, NSData *expectedRecipientEndpointId,
    const uint8_t brokerSigningPublicKey[ANC_PV_SIGN_PUBLIC_KEY_BYTES],
    const uint8_t brokerBoxPublicKey[ANC_PV_BOX_PUBLIC_KEY_BYTES],
    const uint8_t recipientBoxPrivateKey[ANC_PV_BOX_PRIVATE_KEY_BYTES],
    AncPrivateVaultJobCodecStatus *status) {
  AncPrivateVaultVerifiedResult *verified =
      AncPrivateVaultVerifyResultEnvelope(
          envelope, expectedVaultId, expectedJobId, expectedJobHash,
          expectedRecipientEndpointId, brokerSigningPublicKey, status);
  if (verified == nil || brokerBoxPublicKey == NULL ||
      recipientBoxPrivateKey == NULL) {
    if (verified != nil)
      SetStatus(status, AncPrivateVaultJobCodecStatusInvalid);
    return nil;
  }
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      envelope, kEnvelopeMaximum, &canonicalStatus);
  NSDictionary *map = root.type == AncPrivateVaultCanonicalTypeMap
                          ? root.mapValue
                          : nil;
  NSData *packed =
      Field(map, 103, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  if (packed.length < 24 + 16 + sizeof kResultDomain ||
      packed.length > kPayloadMaximum + 24 + 16 + sizeof kResultDomain) {
    SetStatus(status, AncPrivateVaultJobCodecStatusInvalid);
    return nil;
  }
  const uint8_t *packedBytes = packed.bytes;
  NSUInteger ciphertextLength = packed.length - 24;
  NSMutableData *opened = [NSMutableData dataWithLength:ciphertextLength - 16];
  size_t openedLength = 0;
  if (anc_pv_box_open(opened.mutableBytes, opened.length, &openedLength,
                      packedBytes + 24, ciphertextLength, packedBytes,
                      brokerBoxPublicKey, recipientBoxPrivateKey) !=
          ANC_PV_CRYPTO_OK ||
      openedLength < sizeof kResultDomain ||
      memcmp(opened.bytes, kResultDomain, sizeof kResultDomain) != 0 ||
      openedLength - sizeof kResultDomain > kPayloadMaximum) {
    anc_pv_zeroize(opened.mutableBytes, opened.length);
    SetStatus(status, AncPrivateVaultJobCodecStatusCrypto);
    return nil;
  }
  NSData *payload =
      [NSData dataWithBytes:(const uint8_t *)opened.bytes + sizeof kResultDomain
                     length:openedLength - sizeof kResultDomain];
  anc_pv_zeroize(opened.mutableBytes, opened.length);
  SetStatus(status, AncPrivateVaultJobCodecStatusOK);
  return [[AncPrivateVaultOpenedResult alloc] initWithPayload:payload
                                                        state:verified.state];
}

static NSData *DomainMessage(const uint8_t *domain, size_t domainLength,
                             NSData *payload) {
  if (payload == nil || payload.length > NSUIntegerMax - domainLength) return nil;
  NSMutableData *message =
      [NSMutableData dataWithCapacity:domainLength + payload.length];
  [message appendBytes:domain length:domainLength];
  [message appendData:payload];
  return message;
}

static NSData *UnsignedBytes(NSDictionary *map, NSInteger signatureKey) {
  NSMutableDictionary *unsignedMap = [map mutableCopy];
  [unsignedMap removeObjectForKey:@(signatureKey)];
  AncPrivateVaultCanonicalValue *value =
      [AncPrivateVaultCanonicalValue map:unsignedMap];
  AncPrivateVaultCanonicalStatus status;
  return value == nil ? nil : AncPrivateVaultCanonicalEncode(value, &status);
}

static NSData *DomainHash(const uint8_t *domain, size_t domainLength,
                          NSData *payload) {
  uint8_t digest[32] = {0};
  if (anc_pv_blake2b_256_two_part(digest, domain, domainLength, payload.bytes,
                                  payload.length) != ANC_PV_CRYPTO_OK)
    return nil;
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

AncPrivateVaultOpenedJob *AncPrivateVaultOpenJobEnvelope(
    NSData *envelope, NSData *expectedVaultId, NSData *expectedJobId,
    NSData *expectedRecipientEndpointId, uint64_t nowSeconds,
    const uint8_t senderSigningPublicKey[ANC_PV_SIGN_PUBLIC_KEY_BYTES],
    const uint8_t senderBoxPublicKey[ANC_PV_BOX_PUBLIC_KEY_BYTES],
    const uint8_t recipientBoxPrivateKey[ANC_PV_BOX_PRIVATE_KEY_BYTES],
    AncPrivateVaultJobCodecStatus *status) {
  SetStatus(status, AncPrivateVaultJobCodecStatusInvalid);
  if (envelope.length == 0 || envelope.length > kEnvelopeMaximum ||
      expectedVaultId.length != 16 || expectedJobId.length != 16 ||
      expectedRecipientEndpointId.length != 16 || nowSeconds == 0 ||
      senderSigningPublicKey == NULL || senderBoxPublicKey == NULL ||
      recipientBoxPrivateKey == NULL) {
    if (envelope.length > kEnvelopeMaximum)
      SetStatus(status, AncPrivateVaultJobCodecStatusTooLarge);
    return nil;
  }
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      envelope, kEnvelopeMaximum, &canonicalStatus);
  NSDictionary *map = root.type == AncPrivateVaultCanonicalTypeMap
                          ? root.mapValue
                          : nil;
  NSSet *expected = [NSSet setWithArray:@[
    @1, @2, @3, @4, @5, @90, @91, @92, @93, @94, @95, @96
  ]];
  NSData *jobId = nil;
  NSData *grantRef = nil;
  NSData *recipient = nil;
  NSData *packed = nil;
  NSData *signature = nil;
  AncPrivateVaultCanonicalValue *created = Field(
      map, 4, AncPrivateVaultCanonicalTypeInteger);
  AncPrivateVaultCanonicalValue *issued = Field(
      map, 92, AncPrivateVaultCanonicalTypeInteger);
  AncPrivateVaultCanonicalValue *expires = Field(
      map, 93, AncPrivateVaultCanonicalTypeInteger);
  if (map == nil || map.count != expected.count ||
      ![expected isEqualToSet:[NSSet setWithArray:map.allKeys]] ||
      !ExactCommon(map, @"job", expectedVaultId) ||
      !ExactBytes(map, 90, 16, &jobId) ||
      ![jobId isEqualToData:expectedJobId] ||
      !ExactBytes(map, 91, 32, &grantRef) || issued.integerValue <= 0 ||
      created.integerValue <= 0 || created.integerValue > issued.integerValue ||
      expires.integerValue <= issued.integerValue ||
      nowSeconds < (uint64_t)issued.integerValue ||
      nowSeconds > (uint64_t)expires.integerValue ||
      !ExactBytes(map, 94, 16, &recipient) ||
      ![recipient isEqualToData:expectedRecipientEndpointId] ||
      !ExactBytes(map, 96, 64, &signature)) {
    if (issued != nil && expires != nil &&
        (nowSeconds < (uint64_t)MAX(issued.integerValue, 0) ||
         nowSeconds > (uint64_t)MAX(expires.integerValue, 0)))
      SetStatus(status, AncPrivateVaultJobCodecStatusExpired);
    return nil;
  }
  AncPrivateVaultCanonicalValue *ciphertextValue =
      Field(map, 95, AncPrivateVaultCanonicalTypeBytes);
  packed = ciphertextValue.bytesValue;
  if (packed.length < 24 + 16 + sizeof kJobDomain ||
      packed.length > kPayloadMaximum + 24 + 16 + sizeof kJobDomain)
    return nil;

  NSData *unsignedBytes = UnsignedBytes(map, 96);
  NSData *signatureMessage =
      DomainMessage(kJobDomain, sizeof kJobDomain, unsignedBytes);
  if (unsignedBytes == nil || signatureMessage == nil ||
      anc_pv_ed25519_verify(signature.bytes, signatureMessage.bytes,
                            signatureMessage.length,
                            senderSigningPublicKey) != ANC_PV_CRYPTO_OK) {
    SetStatus(status, AncPrivateVaultJobCodecStatusSignature);
    return nil;
  }

  const uint8_t *packedBytes = packed.bytes;
  NSUInteger ciphertextLength = packed.length - 24;
  NSMutableData *opened = [NSMutableData dataWithLength:ciphertextLength - 16];
  size_t openedLength = 0;
  if (anc_pv_box_open(opened.mutableBytes, opened.length, &openedLength,
                      packedBytes + 24, ciphertextLength, packedBytes,
                      senderBoxPublicKey, recipientBoxPrivateKey) !=
          ANC_PV_CRYPTO_OK ||
      openedLength < sizeof kJobDomain ||
      memcmp(opened.bytes, kJobDomain, sizeof kJobDomain) != 0 ||
      openedLength - sizeof kJobDomain > kPayloadMaximum) {
    anc_pv_zeroize(opened.mutableBytes, opened.length);
    SetStatus(status, AncPrivateVaultJobCodecStatusCrypto);
    return nil;
  }
  NSData *payload = [NSData dataWithBytes:(const uint8_t *)opened.bytes +
                                           sizeof kJobDomain
                                   length:openedLength - sizeof kJobDomain];
  anc_pv_zeroize(opened.mutableBytes, opened.length);
  NSData *jobHash = DomainHash(kJobDomain, sizeof kJobDomain, envelope);
  if (jobHash == nil) {
    SetStatus(status, AncPrivateVaultJobCodecStatusCrypto);
    return nil;
  }
  SetStatus(status, AncPrivateVaultJobCodecStatusOK);
  return [[AncPrivateVaultOpenedJob alloc] initWithPayload:payload
                                                 grantRef:grantRef
                                                  jobHash:jobHash];
}

static NSData *SealEncryptedEnvelope(
    const uint8_t *domain, size_t domainLength,
    NSMutableDictionary *unsignedMap, NSInteger signatureKey,
    NSData *payload, NSData *nonce,
    const uint8_t senderSigningSeed[ANC_PV_SEED_BYTES],
    const uint8_t senderBoxPrivateKey[ANC_PV_BOX_PRIVATE_KEY_BYTES],
    const uint8_t recipientBoxPublicKey[ANC_PV_BOX_PUBLIC_KEY_BYTES],
    AncPrivateVaultJobCodecStatus *status) {
  if (payload.length > kPayloadMaximum || nonce.length != 24 ||
      senderSigningSeed == NULL || senderBoxPrivateKey == NULL ||
      recipientBoxPublicKey == NULL ||
      payload.length > NSUIntegerMax - domainLength) {
    if (payload.length > kPayloadMaximum)
      SetStatus(status, AncPrivateVaultJobCodecStatusTooLarge);
    return nil;
  }
  NSMutableData *boxPlaintext =
      [NSMutableData dataWithCapacity:domainLength + payload.length];
  [boxPlaintext appendBytes:domain length:domainLength];
  [boxPlaintext appendData:payload];
  NSMutableData *ciphertext =
      [NSMutableData dataWithLength:boxPlaintext.length + 16];
  size_t ciphertextLength = 0;
  if (anc_pv_box_wrap(ciphertext.mutableBytes, ciphertext.length,
                      &ciphertextLength, boxPlaintext.bytes,
                      boxPlaintext.length, nonce.bytes,
                      recipientBoxPublicKey, senderBoxPrivateKey) !=
      ANC_PV_CRYPTO_OK) {
    anc_pv_zeroize(boxPlaintext.mutableBytes, boxPlaintext.length);
    anc_pv_zeroize(ciphertext.mutableBytes, ciphertext.length);
    SetStatus(status, AncPrivateVaultJobCodecStatusCrypto);
    return nil;
  }
  anc_pv_zeroize(boxPlaintext.mutableBytes, boxPlaintext.length);
  NSMutableData *packed = [NSMutableData dataWithCapacity:24 + ciphertextLength];
  [packed appendData:nonce];
  [packed appendBytes:ciphertext.bytes length:ciphertextLength];
  anc_pv_zeroize(ciphertext.mutableBytes, ciphertext.length);
  unsignedMap[@95] = [AncPrivateVaultCanonicalValue bytes:packed];

  AncPrivateVaultCanonicalStatus canonicalStatus;
  NSData *unsignedBytes = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:unsignedMap], &canonicalStatus);
  uint8_t signingPublic[32] = {0};
  uint8_t signingPrivate[64] = {0};
  uint8_t signature[64] = {0};
  NSData *signatureMessage =
      DomainMessage(domain, domainLength, unsignedBytes);
  BOOL signedEnvelope = unsignedBytes != nil && signatureMessage != nil &&
      anc_pv_ed25519_seed_keypair(signingPublic, signingPrivate,
                                  senderSigningSeed) == ANC_PV_CRYPTO_OK &&
      anc_pv_ed25519_sign(signature, signatureMessage.bytes,
                          signatureMessage.length,
                          signingPrivate) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(signingPublic, sizeof signingPublic);
  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
  if (!signedEnvelope) {
    anc_pv_zeroize(signature, sizeof signature);
    SetStatus(status, AncPrivateVaultJobCodecStatusCrypto);
    return nil;
  }
  unsignedMap[@(signatureKey)] = [AncPrivateVaultCanonicalValue
      bytes:[NSData dataWithBytes:signature length:sizeof signature]];
  anc_pv_zeroize(signature, sizeof signature);
  NSData *encoded = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:unsignedMap], &canonicalStatus);
  if (encoded.length == 0 || encoded.length > kEnvelopeMaximum) {
    if (encoded.length > kEnvelopeMaximum)
      SetStatus(status, AncPrivateVaultJobCodecStatusTooLarge);
    return nil;
  }
  SetStatus(status, AncPrivateVaultJobCodecStatusOK);
  return encoded;
}

NSData *AncPrivateVaultSealJobEnvelope(
    NSData *vaultId, NSData *envelopeId, uint64_t createdAt, NSData *jobId,
    NSData *grantRef, uint64_t issuedAt, uint64_t expiresAt,
    NSData *recipientEndpointId, NSData *payload, NSData *nonce,
    const uint8_t senderSigningSeed[ANC_PV_SEED_BYTES],
    const uint8_t senderBoxPrivateKey[ANC_PV_BOX_PRIVATE_KEY_BYTES],
    const uint8_t recipientBoxPublicKey[ANC_PV_BOX_PUBLIC_KEY_BYTES],
    AncPrivateVaultJobCodecStatus *status) {
  SetStatus(status, AncPrivateVaultJobCodecStatusInvalid);
  if (vaultId.length != 16 || envelopeId.length != 16 || createdAt == 0 ||
      createdAt > UINT64_C(9007199254740991) || jobId.length != 16 ||
      grantRef.length != 32 || issuedAt == 0 || expiresAt <= issuedAt ||
      expiresAt > UINT64_C(9007199254740991) || createdAt > issuedAt ||
      recipientEndpointId.length != 16) {
    return nil;
  }
  NSMutableDictionary *unsignedMap = [@{
    @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
    @2 : [AncPrivateVaultCanonicalValue bytes:vaultId],
    @3 : [AncPrivateVaultCanonicalValue text:@"job"],
    @4 : [AncPrivateVaultCanonicalValue integer:(int64_t)createdAt],
    @5 : [AncPrivateVaultCanonicalValue bytes:envelopeId],
    @90 : [AncPrivateVaultCanonicalValue bytes:jobId],
    @91 : [AncPrivateVaultCanonicalValue bytes:grantRef],
    @92 : [AncPrivateVaultCanonicalValue integer:(int64_t)issuedAt],
    @93 : [AncPrivateVaultCanonicalValue integer:(int64_t)expiresAt],
    @94 : [AncPrivateVaultCanonicalValue bytes:recipientEndpointId],
  } mutableCopy];
  return SealEncryptedEnvelope(kJobDomain, sizeof kJobDomain, unsignedMap, 96,
                               payload, nonce,
                               senderSigningSeed, senderBoxPrivateKey,
                               recipientBoxPublicKey, status);
}

NSData *AncPrivateVaultSealResultEnvelope(
    NSData *vaultId, NSData *envelopeId, uint64_t createdAt, NSData *jobId,
    NSData *jobHash, NSData *recipientEndpointId, NSString *state,
    NSData *payload, NSData *nonce,
    const uint8_t senderSigningSeed[ANC_PV_SEED_BYTES],
    const uint8_t senderBoxPrivateKey[ANC_PV_BOX_PRIVATE_KEY_BYTES],
    const uint8_t recipientBoxPublicKey[ANC_PV_BOX_PUBLIC_KEY_BYTES],
    AncPrivateVaultJobCodecStatus *status) {
  SetStatus(status, AncPrivateVaultJobCodecStatusInvalid);
  if (vaultId.length != 16 || envelopeId.length != 16 || createdAt == 0 ||
      createdAt > UINT64_C(9007199254740991) ||
      jobId.length != 16 || jobHash.length != 32 ||
      recipientEndpointId.length != 16 ||
      !([state isEqualToString:@"completed"] ||
        [state isEqualToString:@"failed"]) ||
      payload.length > kPayloadMaximum || nonce.length != 24 ||
      senderSigningSeed == NULL || senderBoxPrivateKey == NULL ||
      recipientBoxPublicKey == NULL) {
    if (payload.length > kPayloadMaximum)
      SetStatus(status, AncPrivateVaultJobCodecStatusTooLarge);
    return nil;
  }
  if (payload.length > NSUIntegerMax - sizeof kResultDomain) return nil;
  NSMutableData *boxPlaintext =
      [NSMutableData dataWithCapacity:sizeof kResultDomain + payload.length];
  [boxPlaintext appendBytes:kResultDomain length:sizeof kResultDomain];
  [boxPlaintext appendData:payload];
  NSMutableData *ciphertext =
      [NSMutableData dataWithLength:boxPlaintext.length + 16];
  size_t ciphertextLength = 0;
  if (anc_pv_box_wrap(ciphertext.mutableBytes, ciphertext.length,
                      &ciphertextLength, boxPlaintext.bytes,
                      boxPlaintext.length, nonce.bytes,
                      recipientBoxPublicKey, senderBoxPrivateKey) !=
      ANC_PV_CRYPTO_OK) {
    anc_pv_zeroize(boxPlaintext.mutableBytes, boxPlaintext.length);
    anc_pv_zeroize(ciphertext.mutableBytes, ciphertext.length);
    SetStatus(status, AncPrivateVaultJobCodecStatusCrypto);
    return nil;
  }
  anc_pv_zeroize(boxPlaintext.mutableBytes, boxPlaintext.length);
  NSMutableData *packed = [NSMutableData dataWithCapacity:24 + ciphertextLength];
  [packed appendData:nonce];
  [packed appendBytes:ciphertext.bytes length:ciphertextLength];
  anc_pv_zeroize(ciphertext.mutableBytes, ciphertext.length);

  NSMutableDictionary *unsignedMap = [@{
    @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
    @2 : [AncPrivateVaultCanonicalValue bytes:vaultId],
    @3 : [AncPrivateVaultCanonicalValue text:@"result"],
    @4 : [AncPrivateVaultCanonicalValue integer:(int64_t)createdAt],
    @5 : [AncPrivateVaultCanonicalValue bytes:envelopeId],
    @100 : [AncPrivateVaultCanonicalValue bytes:jobId],
    @101 : [AncPrivateVaultCanonicalValue bytes:jobHash],
    @102 : [AncPrivateVaultCanonicalValue bytes:recipientEndpointId],
    @103 : [AncPrivateVaultCanonicalValue bytes:packed],
    @105 : [AncPrivateVaultCanonicalValue text:state],
  } mutableCopy];
  AncPrivateVaultCanonicalStatus canonicalStatus;
  NSData *unsignedBytes = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:unsignedMap], &canonicalStatus);
  uint8_t signingPublic[32] = {0};
  uint8_t signingPrivate[64] = {0};
  uint8_t signature[64] = {0};
  NSData *signatureMessage =
      DomainMessage(kResultDomain, sizeof kResultDomain, unsignedBytes);
  BOOL signedResult = unsignedBytes != nil && signatureMessage != nil &&
      anc_pv_ed25519_seed_keypair(signingPublic, signingPrivate,
                                  senderSigningSeed) == ANC_PV_CRYPTO_OK &&
      anc_pv_ed25519_sign(signature, signatureMessage.bytes,
                          signatureMessage.length,
                          signingPrivate) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(signingPublic, sizeof signingPublic);
  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
  if (!signedResult) {
    anc_pv_zeroize(signature, sizeof signature);
    SetStatus(status, AncPrivateVaultJobCodecStatusCrypto);
    return nil;
  }
  unsignedMap[@104] = [AncPrivateVaultCanonicalValue
      bytes:[NSData dataWithBytes:signature length:sizeof signature]];
  anc_pv_zeroize(signature, sizeof signature);
  NSData *encoded = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:unsignedMap], &canonicalStatus);
  if (encoded.length == 0 || encoded.length > kEnvelopeMaximum) {
    if (encoded.length > kEnvelopeMaximum)
      SetStatus(status, AncPrivateVaultJobCodecStatusTooLarge);
    return nil;
  }
  SetStatus(status, AncPrivateVaultJobCodecStatusOK);
  return encoded;
}
