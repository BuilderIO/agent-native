#import "PrivateVaultEndpointRequest.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultGenesisAccountAdmission.h"

NSString *const AncPrivateVaultControlLogAppendPath =
    @"/api/private-vault/control-log/append";
NSString *const AncPrivateVaultControlLogAppendContentType =
    @"application/vnd.agent-native.control-log+cbor";
NSString *const AncPrivateVaultGenesisAdmissionPath =
    @"/api/private-vault/genesis/admit";
NSString *const AncPrivateVaultGenesisAdmissionContentType =
    @"application/vnd.agent-native.genesis-admission+cbor";

static const NSUInteger kSignedEntryMaximumBytes = 64 * 1024;
static const NSUInteger kRecoveryWrapMaximumBytes = 1024 * 1024;
static const NSUInteger kRequestMaximumBytes = 64 * 1024 + 1024 * 1024 + 256;
static const NSUInteger kCurrentSnapshotMaximumBytes = 64 * 1024;
static const NSUInteger kRecoveryAuthorizationMaximumBytes = 1024 * 1024;
static const NSUInteger kRecoveryRequestMaximumBytes =
    64 * 1024 + 1024 * 1024 + 64 * 1024 + 1024 * 1024 + 256;
static const uint8_t kBodyHashDomain[] = "anc/v1/endpoint-request-body";
static const uint8_t kRequestSignatureDomain[] = "anc/v1/endpoint-request";

@interface AncPrivateVaultGrantRevocationHostedAppendReceipt ()
@property(nonatomic) NSString *vaultId;
@property(nonatomic) NSString *entryId;
@property(nonatomic) uint64_t sequence;
@property(nonatomic) NSData *headHash;
- (instancetype)initPrivate;
@end
@implementation AncPrivateVaultGrantRevocationHostedAppendReceipt
- (instancetype)initPrivate { return [super init]; }
@end

static void
AncEndpointRequestSetStatus(AncPrivateVaultEndpointRequestStatus *status,
                            AncPrivateVaultEndpointRequestStatus value) {
  if (status != NULL)
    *status = value;
}

static BOOL AncEndpointRequestOpaqueId(NSString *value) {
  if (![value isKindOfClass:NSString.class] || value.length < 8 ||
      value.length > 160)
    return NO;
  NSRegularExpression *pattern = [NSRegularExpression
      regularExpressionWithPattern:@"^[A-Za-z0-9][A-Za-z0-9._:-]*$"
                           options:0
                             error:nil];
  return [pattern firstMatchInString:value
                             options:0
                               range:NSMakeRange(0, value.length)] != nil;
}

static BOOL AncEndpointRequestLowerHex(NSString *value, NSUInteger length) {
  if (![value isKindOfClass:NSString.class] || value.length != length)
    return NO;
  NSCharacterSet *invalid = [[NSCharacterSet
      characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
  return [value rangeOfCharacterFromSet:invalid].location == NSNotFound;
}

static BOOL AncEndpointRequestTimestamp(NSString *value) {
  if (![value isKindOfClass:NSString.class] || value.length != 24)
    return NO;
  NSRegularExpression *pattern = [NSRegularExpression
      regularExpressionWithPattern:
          @"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"
                           options:0
                             error:nil];
  if ([pattern firstMatchInString:value
                          options:0
                            range:NSMakeRange(0, value.length)] == nil)
    return NO;
  static NSISO8601DateFormatter *formatter;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    formatter = [[NSISO8601DateFormatter alloc] init];
    formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                              NSISO8601DateFormatWithFractionalSeconds;
  });
  return [formatter dateFromString:value] != nil;
}

static NSString *AncEndpointRequestHex(const uint8_t *bytes,
                                       NSUInteger length) {
  if (bytes == NULL || length == 0)
    return nil;
  NSMutableString *result = [NSMutableString stringWithCapacity:length * 2];
  for (NSUInteger index = 0; index < length; index += 1)
    [result appendFormat:@"%02x", bytes[index]];
  return result;
}

static NSString *AncEndpointRequestBase64URL(NSData *data) {
  if (data.length == 0)
    return nil;
  NSString *value = [data base64EncodedStringWithOptions:0];
  value = [value stringByReplacingOccurrencesOfString:@"+" withString:@"-"];
  value = [value stringByReplacingOccurrencesOfString:@"/" withString:@"_"];
  while ([value hasSuffix:@"="])
    value = [value substringToIndex:value.length - 1];
  return value;
}

NSData *AncPrivateVaultControlLogAppendRequestEncode(
    NSData *signedEntry, NSData *recoveryWrap,
    AncPrivateVaultEndpointRequestStatus *status) {
  AncEndpointRequestSetStatus(status,
                              AncPrivateVaultEndpointRequestStatusInvalid);
  if (![signedEntry isKindOfClass:NSData.class] ||
      ![recoveryWrap isKindOfClass:NSData.class] || signedEntry.length == 0 ||
      signedEntry.length > kSignedEntryMaximumBytes ||
      recoveryWrap.length == 0 ||
      recoveryWrap.length > kRecoveryWrapMaximumBytes) {
    if (signedEntry.length > kSignedEntryMaximumBytes ||
        recoveryWrap.length > kRecoveryWrapMaximumBytes)
      AncEndpointRequestSetStatus(status,
                                  AncPrivateVaultEndpointRequestStatusTooLarge);
    return nil;
  }
  AncPrivateVaultCanonicalValue *envelope =
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue integer:1],
        @3 : [AncPrivateVaultCanonicalValue
            text:@"control-log-rotation-append-request"],
        @4 : [AncPrivateVaultCanonicalValue bytes:[signedEntry copy]],
        @5 : [AncPrivateVaultCanonicalValue bytes:[recoveryWrap copy]],
      }];
  AncPrivateVaultCanonicalStatus canonicalStatus;
  NSData *encoded = AncPrivateVaultCanonicalEncode(envelope, &canonicalStatus);
  if (encoded == nil || canonicalStatus != AncPrivateVaultCanonicalStatusOK ||
      encoded.length > kRequestMaximumBytes) {
    AncEndpointRequestSetStatus(
        status, encoded.length > kRequestMaximumBytes
                    ? AncPrivateVaultEndpointRequestStatusTooLarge
                    : AncPrivateVaultEndpointRequestStatusInvalid);
    return nil;
  }
  AncEndpointRequestSetStatus(status, AncPrivateVaultEndpointRequestStatusOK);
  return encoded;
}

NSData *AncPrivateVaultControlLogGrantRevocationAppendRequestEncode(
    NSData *signedEntry, AncPrivateVaultEndpointRequestStatus *status) {
  AncEndpointRequestSetStatus(status,
                              AncPrivateVaultEndpointRequestStatusInvalid);
  if (![signedEntry isKindOfClass:NSData.class] || signedEntry.length == 0 ||
      signedEntry.length > kSignedEntryMaximumBytes) {
    if (signedEntry.length > kSignedEntryMaximumBytes)
      AncEndpointRequestSetStatus(status,
                                  AncPrivateVaultEndpointRequestStatusTooLarge);
    return nil;
  }
  AncPrivateVaultCanonicalStatus canonicalStatus;
  NSData *encoded = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue integer:1],
        @3 : [AncPrivateVaultCanonicalValue
            text:@"control-log-grant-revocation-append-request"],
        @4 : [AncPrivateVaultCanonicalValue bytes:[signedEntry copy]],
      }],
      &canonicalStatus);
  if (encoded == nil || canonicalStatus != AncPrivateVaultCanonicalStatusOK ||
      encoded.length > kRequestMaximumBytes) {
    AncEndpointRequestSetStatus(
        status, encoded.length > kRequestMaximumBytes
                    ? AncPrivateVaultEndpointRequestStatusTooLarge
                    : AncPrivateVaultEndpointRequestStatusInvalid);
    return nil;
  }
  AncEndpointRequestSetStatus(status, AncPrivateVaultEndpointRequestStatusOK);
  return encoded;
}

AncPrivateVaultGrantRevocationHostedAppendReceipt *
AncPrivateVaultControlLogGrantRevocationAppendReceiptDecode(NSData *encoded) {
  if (![encoded isKindOfClass:NSData.class] || encoded.length == 0 ||
      encoded.length > 1024)
    return nil;
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root =
      AncPrivateVaultCanonicalDecode(encoded, 1024, &status);
  if (root == nil || status != AncPrivateVaultCanonicalStatusOK ||
      root.type != AncPrivateVaultCanonicalTypeMap || root.mapValue.count != 7)
    return nil;
  NSDictionary *map = root.mapValue;
  const int keys[] = {1, 2, 3, 4, 5, 6, 7};
  for (NSUInteger index = 0; index < sizeof keys / sizeof keys[0]; index += 1)
    if (map[@(keys[index])] == nil) return nil;
  AncPrivateVaultCanonicalValue *suite = map[@1];
  AncPrivateVaultCanonicalValue *version = map[@2];
  AncPrivateVaultCanonicalValue *type = map[@3];
  AncPrivateVaultCanonicalValue *vault = map[@4];
  AncPrivateVaultCanonicalValue *entry = map[@5];
  AncPrivateVaultCanonicalValue *sequence = map[@6];
  AncPrivateVaultCanonicalValue *head = map[@7];
  if (suite.type != AncPrivateVaultCanonicalTypeText ||
      ![suite.textValue isEqualToString:@"anc/v1"] ||
      version.type != AncPrivateVaultCanonicalTypeInteger ||
      version.integerValue != 1 || type.type != AncPrivateVaultCanonicalTypeText ||
      ![type.textValue
          isEqualToString:@"control-log-grant-revocation-append-receipt"] ||
      vault.type != AncPrivateVaultCanonicalTypeText ||
      !AncEndpointRequestOpaqueId(vault.textValue) ||
      entry.type != AncPrivateVaultCanonicalTypeText ||
      !AncEndpointRequestOpaqueId(entry.textValue) ||
      sequence.type != AncPrivateVaultCanonicalTypeInteger ||
      sequence.integerValue <= 0 ||
      head.type != AncPrivateVaultCanonicalTypeBytes ||
      head.bytesValue.length != 32)
    return nil;
  AncPrivateVaultGrantRevocationHostedAppendReceipt *receipt =
      [[AncPrivateVaultGrantRevocationHostedAppendReceipt alloc] initPrivate];
  receipt.vaultId = [vault.textValue copy];
  receipt.entryId = [entry.textValue copy];
  receipt.sequence = (uint64_t)sequence.integerValue;
  receipt.headHash = [head.bytesValue copy];
  return receipt;
}

NSData *AncPrivateVaultControlLogRecoveryAppendRequestEncode(
    NSData *signedEntry, NSData *recoveryWrap, NSData *currentSnapshot,
    NSData *recoveryAuthorization,
    AncPrivateVaultEndpointRequestStatus *status) {
  AncEndpointRequestSetStatus(status,
                              AncPrivateVaultEndpointRequestStatusInvalid);
  NSArray<NSData *> *values = @[
    signedEntry ?: NSData.data, recoveryWrap ?: NSData.data,
    currentSnapshot ?: NSData.data, recoveryAuthorization ?: NSData.data
  ];
  const NSUInteger maximums[] = {
    kSignedEntryMaximumBytes, kRecoveryWrapMaximumBytes,
    kCurrentSnapshotMaximumBytes, kRecoveryAuthorizationMaximumBytes
  };
  for (NSUInteger index = 0; index < values.count; index++) {
    NSData *value = values[index];
    if (![value isKindOfClass:NSData.class] || value.length == 0 ||
        value.length > maximums[index]) {
      if (value.length > maximums[index])
        AncEndpointRequestSetStatus(
            status, AncPrivateVaultEndpointRequestStatusTooLarge);
      return nil;
    }
  }
  AncPrivateVaultCanonicalValue *envelope =
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue integer:1],
        @3 : [AncPrivateVaultCanonicalValue
            text:@"control-log-recovery-append-request"],
        @4 : [AncPrivateVaultCanonicalValue bytes:[signedEntry copy]],
        @5 : [AncPrivateVaultCanonicalValue bytes:[recoveryWrap copy]],
        @6 : [AncPrivateVaultCanonicalValue bytes:[currentSnapshot copy]],
        @7 : [AncPrivateVaultCanonicalValue
            bytes:[recoveryAuthorization copy]],
      }];
  AncPrivateVaultCanonicalStatus canonicalStatus;
  NSData *encoded = AncPrivateVaultCanonicalEncode(envelope, &canonicalStatus);
  if (encoded == nil || canonicalStatus != AncPrivateVaultCanonicalStatusOK ||
      encoded.length > kRecoveryRequestMaximumBytes) {
    AncEndpointRequestSetStatus(
        status, encoded.length > kRecoveryRequestMaximumBytes
                    ? AncPrivateVaultEndpointRequestStatusTooLarge
                    : AncPrivateVaultEndpointRequestStatusInvalid);
    return nil;
  }
  AncEndpointRequestSetStatus(status, AncPrivateVaultEndpointRequestStatusOK);
  return encoded;
}

static NSString *AncPrivateVaultEndpointProofHeaderCreate(
    NSString *vaultId, NSString *endpointId, NSData *body, NSString *issuedAt,
    NSString *nonce, NSString *path, NSUInteger maximumBodyBytes,
    const uint8_t *signingSeed, NSData *expectedSigningPublicKey,
    AncPrivateVaultEndpointRequestStatus *status) {
  AncEndpointRequestSetStatus(status,
                              AncPrivateVaultEndpointRequestStatusInvalid);
  if (!AncEndpointRequestOpaqueId(vaultId) ||
      !AncEndpointRequestOpaqueId(endpointId) ||
      ![body isKindOfClass:NSData.class] || body.length == 0 ||
      body.length > maximumBodyBytes || ![path isKindOfClass:NSString.class] ||
      path.length == 0 || !AncEndpointRequestTimestamp(issuedAt) ||
      !AncEndpointRequestLowerHex(nonce, 32) || signingSeed == NULL ||
      expectedSigningPublicKey.length != 32) {
    if (body.length > maximumBodyBytes)
      AncEndpointRequestSetStatus(status,
                                  AncPrivateVaultEndpointRequestStatusTooLarge);
    return nil;
  }

  uint8_t bodyHash[32] = {0};
  if (anc_pv_blake2b_256_two_part(bodyHash, kBodyHashDomain,
                                  sizeof kBodyHashDomain, body.bytes,
                                  body.length) != ANC_PV_CRYPTO_OK) {
    AncEndpointRequestSetStatus(
        status, AncPrivateVaultEndpointRequestStatusCryptoFailed);
    return nil;
  }
  NSData *bodyHashData = [NSData dataWithBytes:bodyHash length:sizeof bodyHash];
  NSString *bodyHashHex = AncEndpointRequestHex(bodyHash, sizeof bodyHash);
  anc_pv_zeroize(bodyHash, sizeof bodyHash);
  AncPrivateVaultCanonicalValue *unsignedProof =
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue integer:1],
        @3 : [AncPrivateVaultCanonicalValue text:@"endpoint_request"],
        @4 : [AncPrivateVaultCanonicalValue text:vaultId],
        @5 : [AncPrivateVaultCanonicalValue text:endpointId],
        @6 : [AncPrivateVaultCanonicalValue text:@"POST"],
        @7 : [AncPrivateVaultCanonicalValue text:path],
        @8 : [AncPrivateVaultCanonicalValue bytes:bodyHashData],
        @9 : [AncPrivateVaultCanonicalValue text:issuedAt],
        @10 : [AncPrivateVaultCanonicalValue text:nonce],
      }];
  AncPrivateVaultCanonicalStatus canonicalStatus;
  NSData *unsignedBytes =
      AncPrivateVaultCanonicalEncode(unsignedProof, &canonicalStatus);
  if (unsignedBytes == nil ||
      canonicalStatus != AncPrivateVaultCanonicalStatusOK) {
    AncEndpointRequestSetStatus(status,
                                AncPrivateVaultEndpointRequestStatusInvalid);
    return nil;
  }

  uint8_t publicKey[32] = {0};
  uint8_t privateKey[64] = {0};
  uint8_t signature[64] = {0};
  BOOL identityMatches =
      anc_pv_ed25519_seed_keypair(publicKey, privateKey, signingSeed) ==
          ANC_PV_CRYPTO_OK &&
      anc_pv_memcmp(publicKey, expectedSigningPublicKey.bytes, 32) ==
          ANC_PV_CRYPTO_OK;
  if (!identityMatches) {
    anc_pv_zeroize(publicKey, sizeof publicKey);
    anc_pv_zeroize(privateKey, sizeof privateKey);
    AncEndpointRequestSetStatus(
        status, AncPrivateVaultEndpointRequestStatusIdentityMismatch);
    return nil;
  }
  NSMutableData *message = [NSMutableData
      dataWithCapacity:sizeof kRequestSignatureDomain + unsignedBytes.length];
  [message appendBytes:kRequestSignatureDomain
                length:sizeof kRequestSignatureDomain];
  [message appendData:unsignedBytes];
  BOOL signedProof =
      anc_pv_ed25519_sign(signature, message.bytes, message.length,
                          privateKey) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(publicKey, sizeof publicKey);
  anc_pv_zeroize(privateKey, sizeof privateKey);
  if (!signedProof) {
    anc_pv_zeroize(signature, sizeof signature);
    AncEndpointRequestSetStatus(
        status, AncPrivateVaultEndpointRequestStatusCryptoFailed);
    return nil;
  }

  NSString *signatureHex = AncEndpointRequestHex(signature, sizeof signature);
  anc_pv_zeroize(signature, sizeof signature);
  NSString *json = [NSString
      stringWithFormat:@"{\"version\":1,\"suite\":\"anc/"
                       @"v1\",\"type\":\"endpoint_request\",\"vaultId\":\"%@\","
                       @"\"endpointId\":\"%@\",\"method\":\"POST\",\"path\":\"%"
                       @"@\",\"bodyHash\":\"%@\",\"issuedAt\":\"%@\",\"nonce\":"
                       @"\"%@\",\"signature\":\"%@\"}",
                       vaultId, endpointId, path, bodyHashHex, issuedAt, nonce,
                       signatureHex];
  NSData *jsonBytes = [json dataUsingEncoding:NSUTF8StringEncoding];
  NSString *header = AncEndpointRequestBase64URL(jsonBytes);
  if (header.length == 0 || header.length > 8192) {
    AncEndpointRequestSetStatus(status,
                                AncPrivateVaultEndpointRequestStatusTooLarge);
    return nil;
  }
  AncEndpointRequestSetStatus(status, AncPrivateVaultEndpointRequestStatusOK);
  return header;
}

NSString *AncPrivateVaultControlLogAppendProofHeaderCreate(
    NSString *vaultId, NSString *endpointId, NSData *body, NSString *issuedAt,
    NSString *nonce, const uint8_t *signingSeed,
    NSData *expectedSigningPublicKey,
    AncPrivateVaultEndpointRequestStatus *status) {
  return AncPrivateVaultEndpointProofHeaderCreate(
      vaultId, endpointId, body, issuedAt, nonce,
      AncPrivateVaultControlLogAppendPath, kRecoveryRequestMaximumBytes,
      signingSeed,
      expectedSigningPublicKey, status);
}

NSString *AncPrivateVaultGenesisAdmissionProofHeaderCreate(
    NSString *vaultId, NSString *endpointId, NSData *body, NSString *issuedAt,
    NSString *nonce, const uint8_t *signingSeed,
    NSData *expectedSigningPublicKey,
    AncPrivateVaultEndpointRequestStatus *status) {
  return AncPrivateVaultEndpointProofHeaderCreate(
      vaultId, endpointId, body, issuedAt, nonce,
      AncPrivateVaultGenesisAdmissionPath,
      ANC_PV_GENESIS_ADMISSION_REQUEST_MAX_BYTES, signingSeed,
      expectedSigningPublicKey, status);
}
