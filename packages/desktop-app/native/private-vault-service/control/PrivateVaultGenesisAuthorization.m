#import "PrivateVaultGenesisAuthorization.h"
#import "PrivateVaultGenesisAuthorizationInternal.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

#import <math.h>
#import <objc/runtime.h>

static const NSUInteger kConfirmationMaximumBytes = 64 * 1024;
static const NSUInteger kAuthorizationMaximumBytes = 256 * 1024;
static const NSUInteger kSignedCommitMaximumBytes = 64 * 1024;
static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);
static const uint8_t kEndpointDomain[] = "anc/v1/endpoint";
static const uint8_t kCommitDomain[] = "anc/v1/log-entry";
static const uint8_t kAuthorizationDomain[] = "anc/v1/genesis-authorization";

@interface AncPrivateVaultGenesisAuthorizationResult ()
- (instancetype)initPrivateWithVaultId:(NSData *)vaultId
                            ceremonyId:(NSData *)ceremonyId
                            endpointId:(NSData *)endpointId
              endpointSigningPublicKey:(NSData *)endpointSigningPublicKey
         endpointKeyAgreementPublicKey:(NSData *)endpointKeyAgreementPublicKey
                         enrollmentRef:(NSData *)enrollmentRef
                            recoveryId:(NSData *)recoveryId
              recoverySigningPublicKey:(NSData *)recoverySigningPublicKey
         recoveryKeyAgreementPublicKey:(NSData *)recoveryKeyAgreementPublicKey
                      recoveryWrapHash:(NSData *)recoveryWrapHash
                   authorizationDigest:(NSData *)authorizationDigest
                   signedGenesisCommit:(NSData *)signedGenesisCommit;
@end

@interface AncGenesisAuthorizationEvidence : NSObject
@property(nonatomic) NSArray<NSData *> *fields;
@property(nonatomic) NSData *bootstrapTranscriptDigest;
@end
@implementation AncGenesisAuthorizationEvidence
@end

static NSMapTable<AncPrivateVaultGenesisAuthorizationResult *,
                  AncGenesisAuthorizationEvidence *> *GenesisEvidenceRegistry(void) {
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

static NSLock *GenesisEvidenceLock(void) {
  static NSLock *lock;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ lock = [NSLock new]; });
  return lock;
}

static NSArray<NSData *> *GenesisResultFields(
    AncPrivateVaultGenesisAuthorizationResult *result) {
  if (result == nil)
    return nil;
  @try {
    NSArray *fields = @[
      result.vaultId, result.ceremonyId, result.endpointId,
      result.endpointSigningPublicKey,
      result.endpointKeyAgreementPublicKey, result.enrollmentRef,
      result.recoveryId, result.recoverySigningPublicKey,
      result.recoveryKeyAgreementPublicKey, result.recoveryWrapHash,
      result.authorizationDigest, result.signedGenesisCommit
    ];
    NSMutableArray *copies = [NSMutableArray arrayWithCapacity:fields.count];
    for (NSData *field in fields) {
      if (![field isKindOfClass:NSData.class] || field.length == 0)
        return nil;
      [copies addObject:[NSData dataWithData:field]];
    }
    return [copies copy];
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

static BOOL RegisterGenesisEvidence(
    AncPrivateVaultGenesisAuthorizationResult *result,
    NSData *bootstrapTranscriptDigest) {
  NSArray<NSData *> *fields = GenesisResultFields(result);
  if (fields == nil || bootstrapTranscriptDigest.length != 32)
    return NO;
  AncGenesisAuthorizationEvidence *evidence =
      [AncGenesisAuthorizationEvidence new];
  evidence.fields = fields;
  evidence.bootstrapTranscriptDigest =
      [NSData dataWithData:bootstrapTranscriptDigest];
  NSLock *lock = GenesisEvidenceLock();
  [lock lock];
  BOOL registered = NO;
  @try {
    if (GenesisEvidenceRegistry().count < 1024) {
      [GenesisEvidenceRegistry() setObject:evidence forKey:result];
      registered = YES;
    }
  } @finally {
    [lock unlock];
  }
  return registered;
}

BOOL AncPrivateVaultGenesisAuthorizationResultCopyEvidence(
    AncPrivateVaultGenesisAuthorizationResult *result, NSData **vaultId,
    NSData **ceremonyId, NSData **endpointId, NSData **endpointSigningPublicKey,
    NSData **endpointKeyAgreementPublicKey, NSData **enrollmentRef,
    NSData **recoveryId, NSData **recoverySigningPublicKey,
    NSData **recoveryKeyAgreementPublicKey, NSData **recoveryWrapHash,
    NSData **authorizationDigest, NSData **signedGenesisCommit,
    NSData **bootstrapTranscriptDigest) {
  if (vaultId == NULL || ceremonyId == NULL || endpointId == NULL ||
      endpointSigningPublicKey == NULL || endpointKeyAgreementPublicKey == NULL ||
      enrollmentRef == NULL || recoveryId == NULL ||
      recoverySigningPublicKey == NULL || recoveryKeyAgreementPublicKey == NULL ||
      recoveryWrapHash == NULL || authorizationDigest == NULL ||
      signedGenesisCommit == NULL || bootstrapTranscriptDigest == NULL)
    return NO;
  *vaultId = *ceremonyId = *endpointId = *endpointSigningPublicKey =
      *endpointKeyAgreementPublicKey = *enrollmentRef = *recoveryId =
          *recoverySigningPublicKey = *recoveryKeyAgreementPublicKey =
              *recoveryWrapHash = *authorizationDigest = *signedGenesisCommit = nil;
  *bootstrapTranscriptDigest = nil;
  NSLock *lock = GenesisEvidenceLock();
  [lock lock];
  NSArray<NSData *> *official = nil;
  NSData *officialBootstrapDigest = nil;
  @try {
    AncGenesisAuthorizationEvidence *registered =
        [GenesisEvidenceRegistry() objectForKey:result];
    official = [registered.fields copy];
    officialBootstrapDigest = [registered.bootstrapTranscriptDigest copy];
  } @finally {
    [lock unlock];
  }
  NSArray<NSData *> *presented = GenesisResultFields(result);
  if (official.count != 12 || officialBootstrapDigest.length != 32 ||
      ![presented isEqualToArray:official])
    return NO;
  *vaultId = [official[0] copy];
  *ceremonyId = [official[1] copy];
  *endpointId = [official[2] copy];
  *endpointSigningPublicKey = [official[3] copy];
  *endpointKeyAgreementPublicKey = [official[4] copy];
  *enrollmentRef = [official[5] copy];
  *recoveryId = [official[6] copy];
  *recoverySigningPublicKey = [official[7] copy];
  *recoveryKeyAgreementPublicKey = [official[8] copy];
  *recoveryWrapHash = [official[9] copy];
  *authorizationDigest = [official[10] copy];
  *signedGenesisCommit = [official[11] copy];
  *bootstrapTranscriptDigest = officialBootstrapDigest;
  return YES;
}


@implementation AncPrivateVaultGenesisAuthorizationResult
@synthesize vaultId = _vaultId;
@synthesize ceremonyId = _ceremonyId;
@synthesize endpointId = _endpointId;
@synthesize endpointSigningPublicKey = _endpointSigningPublicKey;
@synthesize endpointKeyAgreementPublicKey = _endpointKeyAgreementPublicKey;
@synthesize enrollmentRef = _enrollmentRef;
@synthesize recoveryId = _recoveryId;
@synthesize recoverySigningPublicKey = _recoverySigningPublicKey;
@synthesize recoveryKeyAgreementPublicKey = _recoveryKeyAgreementPublicKey;
@synthesize recoveryWrapHash = _recoveryWrapHash;
@synthesize authorizationDigest = _authorizationDigest;
@synthesize signedGenesisCommit = _signedGenesisCommit;
+ (BOOL)accessInstanceVariablesDirectly { return NO; }
- (instancetype)initPrivateWithVaultId:(NSData *)vaultId
                            ceremonyId:(NSData *)ceremonyId
                            endpointId:(NSData *)endpointId
              endpointSigningPublicKey:(NSData *)endpointSigningPublicKey
         endpointKeyAgreementPublicKey:(NSData *)endpointKeyAgreementPublicKey
                         enrollmentRef:(NSData *)enrollmentRef
                            recoveryId:(NSData *)recoveryId
              recoverySigningPublicKey:(NSData *)recoverySigningPublicKey
         recoveryKeyAgreementPublicKey:(NSData *)recoveryKeyAgreementPublicKey
                      recoveryWrapHash:(NSData *)recoveryWrapHash
                   authorizationDigest:(NSData *)authorizationDigest
                   signedGenesisCommit:(NSData *)signedGenesisCommit {
  self = [super init];
  if (self != nil) {
    _vaultId = [vaultId copy];
    _ceremonyId = [ceremonyId copy];
    _endpointId = [endpointId copy];
    _endpointSigningPublicKey = [endpointSigningPublicKey copy];
    _endpointKeyAgreementPublicKey = [endpointKeyAgreementPublicKey copy];
    _enrollmentRef = [enrollmentRef copy];
    _recoveryId = [recoveryId copy];
    _recoverySigningPublicKey = [recoverySigningPublicKey copy];
    _recoveryKeyAgreementPublicKey = [recoveryKeyAgreementPublicKey copy];
    _recoveryWrapHash = [recoveryWrapHash copy];
    _authorizationDigest = [authorizationDigest copy];
    _signedGenesisCommit = [signedGenesisCommit copy];
  }
  return self;
}
@end

@interface AncGenesisAuthorizationEnvelope : NSObject
@property(nonatomic) NSData *vaultId;
@property(nonatomic) uint64_t createdAt;
@property(nonatomic) NSData *envelopeId;
@property(nonatomic) NSData *ceremonyId;
@property(nonatomic) NSData *endpointId;
@property(nonatomic) uint64_t epoch;
@property(nonatomic) NSData *endpointEnvelope;
@property(nonatomic) NSData *recoveryConfirmation;
@property(nonatomic) NSData *signedGenesisCommit;
@property(nonatomic) NSData *signature;
@property(nonatomic) NSData *unsignedBytes;
@end
@implementation AncGenesisAuthorizationEnvelope
@end

@interface AncGenesisEndpointEnvelope : NSObject
@property(nonatomic) NSData *vaultId;
@property(nonatomic) uint64_t createdAt;
@property(nonatomic) NSData *envelopeId;
@property(nonatomic) NSData *endpointId;
@property(nonatomic) NSString *role;
@property(nonatomic) BOOL unattended;
@property(nonatomic) NSData *signingPublicKey;
@property(nonatomic) NSData *keyAgreementPublicKey;
@property(nonatomic) NSData *addedByEndpointId;
@property(nonatomic) NSData *sasTranscriptHash;
@property(nonatomic) NSData *signature;
@property(nonatomic) NSData *unsignedBytes;
@end
@implementation AncGenesisEndpointEnvelope
@end

static void SetStatus(AncPrivateVaultGenesisAuthorizationStatus *status,
                      AncPrivateVaultGenesisAuthorizationStatus value) {
  if (status != NULL)
    *status = value;
}

static BOOL Equal(NSData *left, NSData *right) {
  return left != nil && right != nil && left.length == right.length &&
         [left isEqualToData:right];
}

static NSData *OwningSnapshot(NSData *input) {
  if (![input isKindOfClass:NSData.class])
    return nil;
  NSUInteger length = input.length;
  const void *bytes = input.bytes;
  if (length > 0 && bytes == NULL)
    return nil;
  return [[NSData alloc] initWithBytes:bytes length:length];
}

static BOOL ExactKeys(NSDictionary<NSNumber *, id> *map,
                      NSArray<NSNumber *> *keys,
                      AncPrivateVaultGenesisAuthorizationStatus *status) {
  NSSet *allowed = [NSSet setWithArray:keys];
  for (NSNumber *key in map) {
    if (![allowed containsObject:key]) {
      SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusUnknownField);
      return NO;
    }
  }
  for (NSNumber *key in keys) {
    if (map[key] == nil) {
      SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusMissingField);
      return NO;
    }
  }
  return map.count == keys.count;
}

static NSData *Bytes(NSDictionary *map, NSNumber *key, NSUInteger length,
                     AncPrivateVaultGenesisAuthorizationStatus *status) {
  AncPrivateVaultCanonicalValue *value = map[key];
  if (value.type != AncPrivateVaultCanonicalTypeBytes) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusWrongType);
    return nil;
  }
  if (length != NSNotFound && value.bytesValue.length != length) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusWrongLength);
    return nil;
  }
  return [value.bytesValue copy];
}

static NSString *Text(NSDictionary *map, NSNumber *key,
                      AncPrivateVaultGenesisAuthorizationStatus *status) {
  AncPrivateVaultCanonicalValue *value = map[key];
  if (value.type != AncPrivateVaultCanonicalTypeText) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusWrongType);
    return nil;
  }
  return [value.textValue copy];
}

static BOOL Integer(NSDictionary *map, NSNumber *key, uint64_t minimum,
                    uint64_t *output,
                    AncPrivateVaultGenesisAuthorizationStatus *status) {
  AncPrivateVaultCanonicalValue *value = map[key];
  if (value.type != AncPrivateVaultCanonicalTypeInteger) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusWrongType);
    return NO;
  }
  if (value.integerValue < 0 || (uint64_t)value.integerValue < minimum ||
      (uint64_t)value.integerValue > kMaximumSafeInteger) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusOutOfRange);
    return NO;
  }
  *output = (uint64_t)value.integerValue;
  return YES;
}

static NSDictionary *DecodeMap(
    NSData *encoded, NSUInteger maximum,
    AncPrivateVaultGenesisAuthorizationStatus oversized,
    AncPrivateVaultGenesisAuthorizationStatus *status) {
  if (encoded.length == 0) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusInvalidCanonical);
    return nil;
  }
  if (encoded.length > maximum) {
    SetStatus(status, oversized);
    return nil;
  }
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *root =
      AncPrivateVaultCanonicalDecode(encoded, maximum, &canonicalStatus);
  if (root == nil) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusInvalidCanonical);
    return nil;
  }
  if (root.type != AncPrivateVaultCanonicalTypeMap) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusWrongType);
    return nil;
  }
  return root.mapValue;
}

static NSData *UnsignedMap(NSDictionary *map, NSNumber *signatureKey,
                           AncPrivateVaultGenesisAuthorizationStatus *status) {
  NSMutableDictionary *unsignedMap = [map mutableCopy];
  [unsignedMap removeObjectForKey:signatureKey];
  AncPrivateVaultCanonicalStatus canonicalStatus;
  NSData *encoded = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:unsignedMap], &canonicalStatus);
  if (encoded == nil)
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusInvalidCanonical);
  return encoded;
}

static NSData *DomainMessage(const uint8_t *domain, size_t length,
                             NSData *payload) {
  NSMutableData *message = [NSMutableData dataWithBytes:domain length:length];
  [message appendData:payload];
  return message;
}

static BOOL VerifyDomain(NSData *signature, NSData *payload, NSData *publicKey,
                         const uint8_t *domain, size_t domainLength) {
  if (signature.length != 64 || publicKey.length != 32)
    return NO;
  NSData *message = DomainMessage(domain, domainLength, payload);
  return anc_pv_ed25519_verify(signature.bytes, message.bytes, message.length,
                               publicKey.bytes) == ANC_PV_CRYPTO_OK;
}

static BOOL VerifyExactDomain(
    NSData *signature, NSData *payload, NSData *publicKey, const uint8_t *domain,
    size_t domainLength, AncPrivateVaultGenesisAuthorizationStatus failure,
    AncPrivateVaultGenesisAuthorizationStatus *status) {
  if (VerifyDomain(signature, payload, publicKey, domain, domainLength))
    return YES;
  const struct {
    const uint8_t *bytes;
    size_t length;
  } alternatives[] = {{kEndpointDomain, sizeof kEndpointDomain},
                       {kCommitDomain, sizeof kCommitDomain},
                       {kAuthorizationDomain, sizeof kAuthorizationDomain}};
  for (NSUInteger index = 0;
       index < sizeof alternatives / sizeof alternatives[0]; index += 1) {
    if (alternatives[index].bytes != domain &&
        VerifyDomain(signature, payload, publicKey, alternatives[index].bytes,
                     alternatives[index].length)) {
      SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusCryptoDomain);
      return NO;
    }
  }
  SetStatus(status, failure);
  return NO;
}

static NSData *DomainHash(const uint8_t *domain, size_t length, NSData *payload) {
  uint8_t digest[32] = {0};
  if (anc_pv_blake2b_256_two_part(digest, domain, length, payload.bytes,
                                  payload.length) != ANC_PV_CRYPTO_OK)
    return nil;
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static NSString *Hex(NSData *bytes) {
  const uint8_t *raw = bytes.bytes;
  NSMutableString *hex = [NSMutableString stringWithCapacity:bytes.length * 2];
  for (NSUInteger index = 0; index < bytes.length; index += 1)
    [hex appendFormat:@"%02x", raw[index]];
  return hex;
}

static BOOL SoftwareKind(NSString *value) {
  return value.length >= 1 && value.length <= 64;
}

static double TimestampMilliseconds(NSString *value, BOOL *valid) {
  *valid = NO;
  NSISO8601DateFormatter *formatter = [[NSISO8601DateFormatter alloc] init];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                            NSISO8601DateFormatWithFractionalSeconds;
  NSDate *date = [formatter dateFromString:value];
  if (date == nil) {
    formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime;
    date = [formatter dateFromString:value];
  }
  NSTimeInterval interval = date.timeIntervalSince1970;
  if (date == nil || interval < 0 || interval > (double)kMaximumSafeInteger)
    return 0;
  *valid = YES;
  return interval * 1000.0;
}

static BOOL SameBootstrapTranscript(
    AncPrivateVaultGenesisBootstrapTranscript *left,
    AncPrivateVaultGenesisBootstrapTranscript *right) {
  return Equal(left.vaultId, right.vaultId) &&
      Equal(left.ceremonyId, right.ceremonyId) &&
      Equal(left.endpointId, right.endpointId) &&
      Equal(left.endpointSigningPublicKey, right.endpointSigningPublicKey) &&
      Equal(left.endpointKeyAgreementPublicKey,
            right.endpointKeyAgreementPublicKey) &&
      Equal(left.enrollmentRef, right.enrollmentRef) &&
      Equal(left.recoveryId, right.recoveryId) &&
      Equal(left.recoverySigningPublicKey, right.recoverySigningPublicKey) &&
      Equal(left.recoveryKeyAgreementPublicKey,
            right.recoveryKeyAgreementPublicKey) &&
      left.recoveryGeneration == right.recoveryGeneration &&
      left.epoch == right.epoch &&
      Equal(left.recoveryWrapHash, right.recoveryWrapHash) &&
      Equal(left.recoveryConfirmationHash, right.recoveryConfirmationHash);
}

static AncPrivateVaultGenesisAuthorizationStatus BootstrapStatus(
    AncPrivateVaultGenesisBootstrapStatus value) {
  switch (value) {
  case AncPrivateVaultGenesisBootstrapStatusInvalidCanonical:
    return AncPrivateVaultGenesisAuthorizationStatusInvalidCanonical;
  case AncPrivateVaultGenesisBootstrapStatusMissingField:
    return AncPrivateVaultGenesisAuthorizationStatusMissingField;
  case AncPrivateVaultGenesisBootstrapStatusUnknownField:
    return AncPrivateVaultGenesisAuthorizationStatusUnknownField;
  case AncPrivateVaultGenesisBootstrapStatusWrongType:
    return AncPrivateVaultGenesisAuthorizationStatusWrongType;
  case AncPrivateVaultGenesisBootstrapStatusWrongLiteral:
    return AncPrivateVaultGenesisAuthorizationStatusWrongLiteral;
  case AncPrivateVaultGenesisBootstrapStatusWrongLength:
    return AncPrivateVaultGenesisAuthorizationStatusWrongLength;
  case AncPrivateVaultGenesisBootstrapStatusOutOfRange:
    return AncPrivateVaultGenesisAuthorizationStatusOutOfRange;
  case AncPrivateVaultGenesisBootstrapStatusVaultBinding:
  case AncPrivateVaultGenesisBootstrapStatusConfirmationVaultBinding:
    return AncPrivateVaultGenesisAuthorizationStatusVaultBinding;
  default:
    return AncPrivateVaultGenesisAuthorizationStatusRecoveryBinding;
  }
}

BOOL AncPrivateVaultGenesisAuthorizationDecodeConfirmation(
    NSData *recoveryConfirmation, NSData *expectedVaultId,
    AncPrivateVaultGenesisAuthorizationStatus *status) {
  NSData *confirmationSnapshot = OwningSnapshot(recoveryConfirmation);
  NSData *vaultSnapshot = OwningSnapshot(expectedVaultId);
  if (confirmationSnapshot.length > kConfirmationMaximumBytes) {
    SetStatus(status,
              AncPrivateVaultGenesisAuthorizationStatusConfirmationTooLarge);
    return NO;
  }
  AncPrivateVaultGenesisBootstrapStatus bootstrapStatus;
  BOOL okay = AncPrivateVaultGenesisRecoveryConfirmationDecode(
                  confirmationSnapshot, vaultSnapshot, &bootstrapStatus) != nil;
  SetStatus(status, okay ? AncPrivateVaultGenesisAuthorizationStatusOK
                         : BootstrapStatus(bootstrapStatus));
  return okay;
}

static AncGenesisAuthorizationEnvelope *DecodeAuthorization(
    NSData *encoded, NSData *expectedVaultId,
    AncPrivateVaultGenesisAuthorizationStatus *status) {
  NSDictionary *map = DecodeMap(
      encoded, kAuthorizationMaximumBytes,
      AncPrivateVaultGenesisAuthorizationStatusAuthorizationTooLarge, status);
  NSArray *keys = @[
    @1, @2, @3, @4, @5, @370, @371, @372, @373, @374, @375, @376
  ];
  if (map == nil || !ExactKeys(map, keys, status))
    return nil;
  NSString *suite = Text(map, @1, status);
  NSData *vaultId = Bytes(map, @2, 16, status);
  NSString *type = Text(map, @3, status);
  uint64_t createdAt = 0;
  NSData *envelopeId = Bytes(map, @5, 16, status);
  NSData *ceremonyId = Bytes(map, @370, 16, status);
  NSData *endpointId = Bytes(map, @371, 16, status);
  uint64_t epoch = 0;
  NSData *endpoint = Bytes(map, @373, NSNotFound, status);
  NSData *confirmation = Bytes(map, @374, NSNotFound, status);
  NSData *commit = Bytes(map, @375, NSNotFound, status);
  NSData *signature = Bytes(map, @376, 64, status);
  if (suite == nil || vaultId == nil || type == nil || envelopeId == nil ||
      ceremonyId == nil || endpointId == nil || endpoint == nil ||
      confirmation == nil || commit == nil || signature == nil ||
      !Integer(map, @4, 1, &createdAt, status) ||
      !Integer(map, @372, 1, &epoch, status))
    return nil;
  if (endpoint.length > kSignedCommitMaximumBytes) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusEndpointTooLarge);
    return nil;
  }
  if (confirmation.length > kConfirmationMaximumBytes) {
    SetStatus(status,
              AncPrivateVaultGenesisAuthorizationStatusConfirmationTooLarge);
    return nil;
  }
  if (commit.length > kSignedCommitMaximumBytes) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusCommitTooLarge);
    return nil;
  }
  NSArray<NSData *> *nestedValues = @[ endpoint, confirmation, commit ];
  for (NSUInteger index = 0; index < nestedValues.count; index += 1) {
    NSData *nested = nestedValues[index];
    AncPrivateVaultCanonicalStatus nestedStatus;
    AncPrivateVaultCanonicalValue *nestedRoot = AncPrivateVaultCanonicalDecode(
        nested, nested.length, &nestedStatus);
    if (nestedRoot.type != AncPrivateVaultCanonicalTypeMap) {
      SetStatus(status, index == 0
                            ? AncPrivateVaultGenesisAuthorizationStatusEndpointInvalidCanonical
                            : AncPrivateVaultGenesisAuthorizationStatusInvalidCanonical);
      return nil;
    }
  }
  if (![suite isEqualToString:@"anc/v1"] ||
      ![type isEqualToString:@"genesis-authorization"]) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusWrongLiteral);
    return nil;
  }
  if (epoch != 1) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusOutOfRange);
    return nil;
  }
  if (!Equal(vaultId, expectedVaultId)) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusVaultBinding);
    return nil;
  }
  NSData *unsignedBytes = UnsignedMap(map, @376, status);
  if (unsignedBytes == nil)
    return nil;
  AncGenesisAuthorizationEnvelope *result =
      [[AncGenesisAuthorizationEnvelope alloc] init];
  result.vaultId = vaultId;
  result.createdAt = createdAt;
  result.envelopeId = envelopeId;
  result.ceremonyId = ceremonyId;
  result.endpointId = endpointId;
  result.epoch = epoch;
  result.endpointEnvelope = endpoint;
  result.recoveryConfirmation = confirmation;
  result.signedGenesisCommit = commit;
  result.signature = signature;
  result.unsignedBytes = unsignedBytes;
  return result;
}

NSData *AncPrivateVaultGenesisAuthorizationCopySignedCommit(
    NSData *authorization, NSData *expectedVaultId,
    AncPrivateVaultGenesisAuthorizationStatus *status) {
  NSData *authorizationSnapshot = OwningSnapshot(authorization);
  NSData *vaultSnapshot = OwningSnapshot(expectedVaultId);
  if (authorizationSnapshot == nil || vaultSnapshot.length != 16) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusWrongLength);
    return nil;
  }
  AncGenesisAuthorizationEnvelope *decoded =
      DecodeAuthorization(authorizationSnapshot, vaultSnapshot, status);
  if (decoded == nil)
    return nil;
  SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusOK);
  return [decoded.signedGenesisCommit copy];
}

BOOL AncPrivateVaultGenesisAuthorizationDecode(
    NSData *authorization, NSData *expectedVaultId,
    AncPrivateVaultGenesisAuthorizationStatus *status) {
  NSData *authorizationSnapshot = OwningSnapshot(authorization);
  NSData *vaultSnapshot = OwningSnapshot(expectedVaultId);
  AncGenesisAuthorizationEnvelope *value =
      DecodeAuthorization(authorizationSnapshot, vaultSnapshot, status);
  if (value != nil)
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusOK);
  return value != nil;
}

static AncGenesisEndpointEnvelope *DecodeEndpoint(
    NSData *encoded, AncPrivateVaultGenesisAuthorizationStatus *status) {
  AncPrivateVaultGenesisAuthorizationStatus nestedStatus;
  NSDictionary *map = DecodeMap(
      encoded, kSignedCommitMaximumBytes,
      AncPrivateVaultGenesisAuthorizationStatusEndpointTooLarge, &nestedStatus);
  if (map == nil) {
    SetStatus(status,
              nestedStatus == AncPrivateVaultGenesisAuthorizationStatusInvalidCanonical
                  ? AncPrivateVaultGenesisAuthorizationStatusEndpointInvalidCanonical
                  : nestedStatus);
    return nil;
  }
  NSArray *keys = @[
    @1, @2, @3, @4, @5, @10, @11, @12, @13, @14, @15, @16, @17
  ];
  if (!ExactKeys(map, keys, &nestedStatus)) {
    SetStatus(status,
              nestedStatus == AncPrivateVaultGenesisAuthorizationStatusMissingField
                  ? AncPrivateVaultGenesisAuthorizationStatusEndpointMissingField
                  : AncPrivateVaultGenesisAuthorizationStatusEndpointUnknownField);
    return nil;
  }
  NSString *suite = Text(map, @1, &nestedStatus);
  NSData *vaultId = Bytes(map, @2, 16, &nestedStatus);
  NSString *type = Text(map, @3, &nestedStatus);
  uint64_t createdAt = 0;
  NSData *envelopeId = Bytes(map, @5, 16, &nestedStatus);
  NSData *endpointId = Bytes(map, @10, 16, &nestedStatus);
  NSString *role = Text(map, @11, &nestedStatus);
  AncPrivateVaultCanonicalValue *unattendedValue = map[@12];
  if (unattendedValue.type != AncPrivateVaultCanonicalTypeBoolean) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusEndpointWrongType);
    return nil;
  }
  NSData *signing = Bytes(map, @13, 32, &nestedStatus);
  NSData *agreement = Bytes(map, @14, 32, &nestedStatus);
  NSData *addedBy = Bytes(map, @15, 16, &nestedStatus);
  NSData *sasHash = Bytes(map, @16, 32, &nestedStatus);
  NSData *signature = Bytes(map, @17, 64, &nestedStatus);
  if (suite == nil || vaultId == nil || type == nil || envelopeId == nil ||
      endpointId == nil || role == nil || signing == nil || agreement == nil ||
      addedBy == nil || sasHash == nil || signature == nil ||
      !Integer(map, @4, 1, &createdAt, &nestedStatus)) {
    SetStatus(status,
              nestedStatus == AncPrivateVaultGenesisAuthorizationStatusWrongType
                  ? AncPrivateVaultGenesisAuthorizationStatusEndpointWrongType
              : nestedStatus == AncPrivateVaultGenesisAuthorizationStatusWrongLength
                  ? AncPrivateVaultGenesisAuthorizationStatusEndpointWrongLength
                  : AncPrivateVaultGenesisAuthorizationStatusEndpointOutOfRange);
    return nil;
  }
  if (![suite isEqualToString:@"anc/v1"] ||
      ![type isEqualToString:@"endpoint"]) {
    SetStatus(status,
              AncPrivateVaultGenesisAuthorizationStatusEndpointWrongLiteral);
    return nil;
  }
  if (!SoftwareKind(role)) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusEndpointRole);
    return nil;
  }
  NSData *unsignedBytes = UnsignedMap(map, @17, status);
  if (unsignedBytes == nil)
    return nil;
  AncGenesisEndpointEnvelope *result = [[AncGenesisEndpointEnvelope alloc] init];
  result.vaultId = vaultId;
  result.createdAt = createdAt;
  result.envelopeId = envelopeId;
  result.endpointId = endpointId;
  result.role = role;
  result.unattended = unattendedValue.booleanValue;
  result.signingPublicKey = signing;
  result.keyAgreementPublicKey = agreement;
  result.addedByEndpointId = addedBy;
  result.sasTranscriptHash = sasHash;
  result.signature = signature;
  result.unsignedBytes = unsignedBytes;
  return result;
}

static NSData *ControlUnsignedBytes(
    NSData *signedBytes, AncPrivateVaultControlLogSignedEntry *entry,
    NSData *innerBytes, AncPrivateVaultGenesisAuthorizationStatus *status) {
  NSDictionary *map = DecodeMap(
      signedBytes, kSignedCommitMaximumBytes,
      AncPrivateVaultGenesisAuthorizationStatusCommitBinding, status);
  if (map == nil)
    return nil;
  NSData *rawInner = Bytes(map, @112, NSNotFound, status);
  NSData *signature = Bytes(map, @114, 64, status);
  if (rawInner == nil || signature == nil || !Equal(rawInner, innerBytes) ||
      !Equal(rawInner, entry.innerEnvelopeBytes) ||
      !Equal(signature, entry.signature)) {
    SetStatus(status, AncPrivateVaultGenesisAuthorizationStatusCommitBinding);
    return nil;
  }
  return UnsignedMap(map, @114, status);
}

@interface AncPrivateVaultGenesisAuthorizationVerifier ()
@property(nonatomic) NSData *authorization;
@property(nonatomic) NSData *recoveryConfirmation;
@property(nonatomic) NSData *bootstrapTranscript;
@property(nonatomic) AncPrivateVaultGenesisBootstrapResult *bootstrapResult;
@end

@implementation AncPrivateVaultGenesisAuthorizationVerifier
@synthesize result = _result;
@synthesize status = _status;
+ (BOOL)accessInstanceVariablesDirectly { return NO; }
- (void)setValue:(id)value forKey:(NSString *)key {
  (void)value;
  (void)key;
  [NSException raise:NSInternalInconsistencyException
              format:@"genesis authorization verifier state is immutable"];
}
- (instancetype)initWithAuthorization:(NSData *)authorization
                   recoveryConfirmation:(NSData *)recoveryConfirmation
                     bootstrapTranscript:(NSData *)bootstrapTranscript
                          bootstrapResult:(AncPrivateVaultGenesisBootstrapResult *)bootstrapResult
                                  status:(AncPrivateVaultGenesisAuthorizationStatus *)status {
  self = [super init];
  if (self == nil)
    return nil;
  _authorization = OwningSnapshot(authorization);
  _recoveryConfirmation = OwningSnapshot(recoveryConfirmation);
  _bootstrapTranscript = OwningSnapshot(bootstrapTranscript);
  _bootstrapResult = bootstrapResult;
  _status = AncPrivateVaultGenesisAuthorizationStatusOK;
  if (_authorization == nil || _recoveryConfirmation == nil ||
      _bootstrapTranscript == nil || _bootstrapResult == nil) {
    _status = AncPrivateVaultGenesisAuthorizationStatusBootstrapBinding;
    SetStatus(status, _status);
    return nil;
  }
  AncPrivateVaultGenesisBootstrapStatus bootstrapStatus;
  AncPrivateVaultGenesisBootstrapResult *verified =
      AncPrivateVaultGenesisBootstrapVerify(
          _bootstrapTranscript, _recoveryConfirmation,
          _bootstrapResult.transcript.vaultId, &bootstrapStatus);
  if (verified == nil || !Equal(verified.digest, _bootstrapResult.digest) ||
      !SameBootstrapTranscript(verified.transcript,
                              _bootstrapResult.transcript)) {
    _status = AncPrivateVaultGenesisAuthorizationStatusBootstrapBinding;
    SetStatus(status, _status);
    return nil;
  }
  _bootstrapResult = verified;
  SetStatus(status, _status);
  return self;
}

- (BOOL)verifyGenesisMembershipCommit:
            (AncPrivateVaultControlLogMembershipCommit *)commit
                               signedEntry:
                                   (AncPrivateVaultControlLogSignedEntry *)entry
                          signedEntryBytes:(NSData *)signedEntryBytes
                        innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  @synchronized(self) {
    return [self verifyLockedGenesisMembershipCommit:commit
                                         signedEntry:entry
                                    signedEntryBytes:signedEntryBytes
                                  innerEnvelopeBytes:innerEnvelopeBytes];
  }
}

- (BOOL)verifyLockedGenesisMembershipCommit:
            (AncPrivateVaultControlLogMembershipCommit *)commit
                               signedEntry:
                                   (AncPrivateVaultControlLogSignedEntry *)entry
                          signedEntryBytes:(NSData *)signedEntryBytes
                        innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  NSData *authorization = _authorization;
  NSData *confirmation = _recoveryConfirmation;
  NSData *signedBytes = OwningSnapshot(signedEntryBytes);
  NSData *innerBytes = OwningSnapshot(innerEnvelopeBytes);
  AncPrivateVaultGenesisBootstrapResult *bootstrap = _bootstrapResult;
  _result = nil;
  _status = AncPrivateVaultGenesisAuthorizationStatusInvalidCanonical;

  NSData *vaultId = [bootstrap.transcript.vaultId copy];
  AncGenesisAuthorizationEnvelope *auth =
      DecodeAuthorization(authorization, vaultId, &_status);
  if (auth == nil)
    return NO;
  if (!Equal(auth.recoveryConfirmation, confirmation)) {
    _status =
        AncPrivateVaultGenesisAuthorizationStatusRecoveryConfirmationBinding;
    return NO;
  }
  if (confirmation.length > kConfirmationMaximumBytes) {
    _status = AncPrivateVaultGenesisAuthorizationStatusConfirmationTooLarge;
    return NO;
  }
  AncPrivateVaultGenesisBootstrapStatus bootstrapStatus;
  AncPrivateVaultGenesisRecoveryConfirmation *confirmationValue =
      AncPrivateVaultGenesisRecoveryConfirmationDecode(confirmation, vaultId,
                                                       &bootstrapStatus);
  if (confirmationValue == nil) {
    _status = BootstrapStatus(bootstrapStatus);
    return NO;
  }
  if (!Equal(auth.ceremonyId, confirmationValue.ceremonyId) ||
      !Equal(auth.ceremonyId, bootstrap.transcript.ceremonyId)) {
    _status = AncPrivateVaultGenesisAuthorizationStatusCeremonyBinding;
    return NO;
  }
  if (!Equal(auth.endpointId, confirmationValue.endpointId) ||
      !Equal(auth.endpointId, bootstrap.transcript.endpointId)) {
    _status = AncPrivateVaultGenesisAuthorizationStatusEndpointBinding;
    return NO;
  }

  AncGenesisEndpointEnvelope *endpoint =
      DecodeEndpoint(auth.endpointEnvelope, &_status);
  if (endpoint == nil)
    return NO;
  if (!Equal(endpoint.vaultId, vaultId) || !Equal(auth.vaultId, vaultId)) {
    _status = AncPrivateVaultGenesisAuthorizationStatusVaultBinding;
    return NO;
  }
  if (!Equal(endpoint.endpointId, auth.endpointId) ||
      !Equal(endpoint.addedByEndpointId, auth.endpointId)) {
    _status = AncPrivateVaultGenesisAuthorizationStatusEndpointBinding;
    return NO;
  }
  NSData *confirmationHash = AncPrivateVaultGenesisRecoveryConfirmationHash(
      confirmation, vaultId, &bootstrapStatus);
  if (confirmationHash == nil ||
      !Equal(endpoint.sasTranscriptHash, confirmationHash)) {
    _status = AncPrivateVaultGenesisAuthorizationStatusRecoveryBinding;
    return NO;
  }
  if (!Equal(endpoint.signingPublicKey,
             bootstrap.transcript.endpointSigningPublicKey) ||
      !Equal(endpoint.keyAgreementPublicKey,
             bootstrap.transcript.endpointKeyAgreementPublicKey) ||
      !Equal(auth.envelopeId, bootstrap.transcript.enrollmentRef)) {
    _status = AncPrivateVaultGenesisAuthorizationStatusBootstrapBinding;
    return NO;
  }
  if (endpoint.unattended) {
    _status = AncPrivateVaultGenesisAuthorizationStatusRoleBinding;
    return NO;
  }
  if (!Equal(confirmationValue.recoveryId, bootstrap.transcript.recoveryId) ||
      !Equal(confirmationValue.recoverySigningPublicKey,
             bootstrap.transcript.recoverySigningPublicKey) ||
      !Equal(confirmationValue.recoveryKeyAgreementPublicKey,
             bootstrap.transcript.recoveryKeyAgreementPublicKey) ||
      !Equal(confirmationValue.recoveryWrapHash,
             bootstrap.transcript.recoveryWrapHash)) {
    _status = AncPrivateVaultGenesisAuthorizationStatusRecoveryBinding;
    return NO;
  }

  if (commit == nil || entry == nil || !Equal(auth.signedGenesisCommit, signedBytes)) {
    _status = AncPrivateVaultGenesisAuthorizationStatusCommitBinding;
    return NO;
  }
  NSData *unsignedCommit =
      ControlUnsignedBytes(signedBytes, entry, innerBytes, &_status);
  if (unsignedCommit == nil)
    return NO;
  NSString *vaultHex = Hex(vaultId);
  NSString *ceremonyHex = Hex(auth.ceremonyId);
  NSString *endpointHex = Hex(auth.endpointId);
  NSString *enrollmentHex = Hex(auth.envelopeId);
  if (![commit.vaultId isEqualToString:vaultHex] ||
      ![entry.vaultId isEqualToString:vaultHex] ||
      ![commit.ceremonyId isEqualToString:ceremonyHex] || commit.epoch != 1 ||
      auth.epoch != 1 || ![commit.ceremonyKind isEqualToString:@"first_device"] ||
      commit.previousMembershipHash != nil || commit.rotationCompleted ||
      commit.outstandingJobsResolved || commit.recoverySnapshotHash != nil ||
      commit.recoveryAuthorizationHash != nil) {
    _status = [commit.ceremonyId isEqualToString:ceremonyHex]
                      ? AncPrivateVaultGenesisAuthorizationStatusCommitBinding
                      : AncPrivateVaultGenesisAuthorizationStatusCeremonyBinding;
    if (![commit.ceremonyKind isEqualToString:@"first_device"])
      _status = AncPrivateVaultGenesisAuthorizationStatusRoleBinding;
    if (commit.previousMembershipHash != nil)
      _status = AncPrivateVaultGenesisAuthorizationStatusHeadBinding;
    return NO;
  }
  if (commit.removedEndpointIds.count != 0 || commit.activeMembers.count != 1) {
    _status = AncPrivateVaultGenesisAuthorizationStatusMemberBinding;
    return NO;
  }
  AncPrivateVaultControlLogMember *member = commit.activeMembers.firstObject;
  if (![member.endpointId isEqualToString:endpointHex] ||
      ![member.role isEqualToString:@"endpoint"] || member.unattended ||
      !Equal(member.signingPublicKey, endpoint.signingPublicKey) ||
      !Equal(member.keyAgreementPublicKey, endpoint.keyAgreementPublicKey) ||
      ![member.enrollmentRef isEqualToString:enrollmentHex]) {
    _status = AncPrivateVaultGenesisAuthorizationStatusMemberBinding;
    return NO;
  }
  if (commit.recoveryGeneration != 1 ||
      ![commit.recoveryId isEqualToString:Hex(confirmationValue.recoveryId)] ||
      !Equal(commit.recoverySigningPublicKey,
             confirmationValue.recoverySigningPublicKey) ||
      !Equal(commit.recoveryKeyAgreementPublicKey,
             confirmationValue.recoveryKeyAgreementPublicKey) ||
      !Equal(commit.recoveryWrapHash, confirmationValue.recoveryWrapHash)) {
    _status = AncPrivateVaultGenesisAuthorizationStatusRecoveryBinding;
    return NO;
  }
  if (entry.sequence != 0 ||
      !Equal(entry.previousHash, [NSMutableData dataWithLength:32])) {
    _status = AncPrivateVaultGenesisAuthorizationStatusHeadBinding;
    return NO;
  }
  if (![entry.signerEndpointId isEqualToString:endpointHex]) {
    _status = AncPrivateVaultGenesisAuthorizationStatusEndpointBinding;
    return NO;
  }

  BOOL commitTimeValid = NO;
  double commitMilliseconds =
      TimestampMilliseconds(entry.createdAt, &commitTimeValid);
  if (!commitTimeValid || auth.createdAt < confirmationValue.confirmedAt) {
    _status = AncPrivateVaultGenesisAuthorizationStatusTimeBinding;
    return NO;
  }
  double confirmationMilliseconds =
      (double)confirmationValue.confirmedAt * 1000.0;
  double endpointMilliseconds = (double)endpoint.createdAt * 1000.0;
  double authorizationMilliseconds = (double)auth.createdAt * 1000.0;
  if (!(confirmationMilliseconds <= endpointMilliseconds &&
        endpointMilliseconds <= commitMilliseconds &&
        commitMilliseconds <= authorizationMilliseconds)) {
    _status = AncPrivateVaultGenesisAuthorizationStatusOrderBinding;
    return NO;
  }
  if (!VerifyExactDomain(
          endpoint.signature, endpoint.unsignedBytes, endpoint.signingPublicKey,
          kEndpointDomain, sizeof kEndpointDomain,
          AncPrivateVaultGenesisAuthorizationStatusEndpointSignature,
          &_status) ||
      !VerifyExactDomain(
          entry.signature, unsignedCommit, endpoint.signingPublicKey,
          kCommitDomain, sizeof kCommitDomain,
          AncPrivateVaultGenesisAuthorizationStatusCommitSignature, &_status) ||
      !VerifyExactDomain(
          auth.signature, auth.unsignedBytes, endpoint.signingPublicKey,
          kAuthorizationDomain, sizeof kAuthorizationDomain,
          AncPrivateVaultGenesisAuthorizationStatusAuthorizationSignature,
          &_status))
    return NO;

  NSData *digest = DomainHash(kAuthorizationDomain, sizeof kAuthorizationDomain,
                              authorization);
  if (digest == nil) {
    _status = AncPrivateVaultGenesisAuthorizationStatusCryptoDomain;
    return NO;
  }
  _result = [[AncPrivateVaultGenesisAuthorizationResult alloc]
             initPrivateWithVaultId:vaultId
                         ceremonyId:auth.ceremonyId
                         endpointId:auth.endpointId
           endpointSigningPublicKey:endpoint.signingPublicKey
      endpointKeyAgreementPublicKey:endpoint.keyAgreementPublicKey
                      enrollmentRef:auth.envelopeId
                         recoveryId:confirmationValue.recoveryId
           recoverySigningPublicKey:confirmationValue.recoverySigningPublicKey
      recoveryKeyAgreementPublicKey:
          confirmationValue.recoveryKeyAgreementPublicKey
                   recoveryWrapHash:confirmationValue.recoveryWrapHash
                authorizationDigest:digest
                signedGenesisCommit:signedBytes];
  if (_result == nil || !RegisterGenesisEvidence(_result, bootstrap.digest)) {
    _result = nil;
    _status = AncPrivateVaultGenesisAuthorizationStatusCryptoDomain;
    return NO;
  }
  _status = AncPrivateVaultGenesisAuthorizationStatusOK;
  return YES;
}
@end

NSString *AncPrivateVaultGenesisAuthorizationCategory(
    AncPrivateVaultGenesisAuthorizationStatus status) {
  switch (status) {
  case AncPrivateVaultGenesisAuthorizationStatusOK: return @"ok";
  case AncPrivateVaultGenesisAuthorizationStatusInvalidCanonical: return @"wire.invalid_canonical";
  case AncPrivateVaultGenesisAuthorizationStatusMissingField: return @"wire.missing_field";
  case AncPrivateVaultGenesisAuthorizationStatusUnknownField: return @"wire.unknown_field";
  case AncPrivateVaultGenesisAuthorizationStatusWrongType: return @"wire.wrong_type";
  case AncPrivateVaultGenesisAuthorizationStatusWrongLiteral: return @"wire.wrong_literal";
  case AncPrivateVaultGenesisAuthorizationStatusWrongLength: return @"wire.length";
  case AncPrivateVaultGenesisAuthorizationStatusOutOfRange: return @"wire.range";
  case AncPrivateVaultGenesisAuthorizationStatusConfirmationTooLarge: return @"limits.confirmation";
  case AncPrivateVaultGenesisAuthorizationStatusAuthorizationTooLarge: return @"limits.authorization";
  case AncPrivateVaultGenesisAuthorizationStatusEndpointTooLarge: return @"limits.endpoint";
  case AncPrivateVaultGenesisAuthorizationStatusCommitTooLarge: return @"limits.commit";
  case AncPrivateVaultGenesisAuthorizationStatusEndpointInvalidCanonical: return @"wire.endpoint.invalid_canonical";
  case AncPrivateVaultGenesisAuthorizationStatusEndpointMissingField: return @"wire.endpoint.missing_field";
  case AncPrivateVaultGenesisAuthorizationStatusEndpointUnknownField: return @"wire.endpoint.unknown_field";
  case AncPrivateVaultGenesisAuthorizationStatusEndpointWrongType: return @"wire.endpoint.wrong_type";
  case AncPrivateVaultGenesisAuthorizationStatusEndpointWrongLiteral: return @"wire.endpoint.wrong_literal";
  case AncPrivateVaultGenesisAuthorizationStatusEndpointWrongLength: return @"wire.endpoint.length";
  case AncPrivateVaultGenesisAuthorizationStatusEndpointOutOfRange: return @"wire.endpoint.range";
  case AncPrivateVaultGenesisAuthorizationStatusEndpointRole: return @"wire.endpoint.role";
  case AncPrivateVaultGenesisAuthorizationStatusVaultBinding: return @"binding.vault";
  case AncPrivateVaultGenesisAuthorizationStatusRecoveryConfirmationBinding: return @"binding.recovery_confirmation";
  case AncPrivateVaultGenesisAuthorizationStatusCeremonyBinding: return @"binding.ceremony";
  case AncPrivateVaultGenesisAuthorizationStatusEndpointBinding: return @"binding.endpoint";
  case AncPrivateVaultGenesisAuthorizationStatusRecoveryBinding: return @"binding.recovery";
  case AncPrivateVaultGenesisAuthorizationStatusBootstrapBinding: return @"binding.bootstrap";
  case AncPrivateVaultGenesisAuthorizationStatusCommitBinding: return @"binding.commit";
  case AncPrivateVaultGenesisAuthorizationStatusTimeBinding: return @"binding.time";
  case AncPrivateVaultGenesisAuthorizationStatusOrderBinding: return @"binding.order";
  case AncPrivateVaultGenesisAuthorizationStatusHeadBinding: return @"binding.head";
  case AncPrivateVaultGenesisAuthorizationStatusRoleBinding: return @"binding.role";
  case AncPrivateVaultGenesisAuthorizationStatusMemberBinding: return @"binding.member";
  case AncPrivateVaultGenesisAuthorizationStatusEndpointSignature: return @"crypto.endpoint_signature";
  case AncPrivateVaultGenesisAuthorizationStatusCommitSignature: return @"crypto.commit_signature";
  case AncPrivateVaultGenesisAuthorizationStatusAuthorizationSignature: return @"crypto.authorization_signature";
  case AncPrivateVaultGenesisAuthorizationStatusCryptoDomain: return @"crypto.domain";
  }
}
