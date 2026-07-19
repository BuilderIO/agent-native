#import "PrivateVaultRecoveryAuthorization.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultRecoveryWrap.h"

#include <math.h>

static const NSUInteger kMaximumEvidenceBytes = 1024 * 1024;
static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);
static const uint64_t kMaximumLifetimeSeconds = 600;
static const uint8_t kAuthorizationDomain[] = "anc/v1/recovery-authorization";
static const uint8_t kConfirmationDomain[] =
    "anc/v1/recovery-replacement-confirmation";
static const uint8_t kEndpointDomain[] = "anc/v1/endpoint";
static const uint8_t kEntryDomain[] = "anc/v1/log-entry";
static const uint8_t kRecoveryDomain[] = "anc/v1/recovery";

@interface AncPrivateVaultRecoveryAuthorizationResult ()
- (instancetype)initPrivateWithAuthorizationHash:(NSData *)authorizationHash
                                     snapshotHash:(NSData *)snapshotHash
                                confirmationNonce:(NSData *)confirmationNonce
                           confirmationEnvelopeId:(NSData *)confirmationEnvelopeId
                                       ceremonyId:(NSData *)ceremonyId
                              candidateEndpointId:(NSData *)candidateEndpointId
                              replacementWrapHash:(NSData *)replacementWrapHash;
@end

@implementation AncPrivateVaultRecoveryAuthorizationResult
@synthesize authorizationHash = _authorizationHash;
@synthesize snapshotHash = _snapshotHash;
@synthesize confirmationNonce = _confirmationNonce;
@synthesize confirmationEnvelopeId = _confirmationEnvelopeId;
@synthesize ceremonyId = _ceremonyId;
@synthesize candidateEndpointId = _candidateEndpointId;
@synthesize replacementWrapHash = _replacementWrapHash;
+ (BOOL)accessInstanceVariablesDirectly { return NO; }
- (instancetype)initPrivateWithAuthorizationHash:(NSData *)authorizationHash
                                     snapshotHash:(NSData *)snapshotHash
                                confirmationNonce:(NSData *)confirmationNonce
                           confirmationEnvelopeId:(NSData *)confirmationEnvelopeId
                                       ceremonyId:(NSData *)ceremonyId
                              candidateEndpointId:(NSData *)candidateEndpointId
                              replacementWrapHash:(NSData *)replacementWrapHash {
  self = [super init];
  if (self != nil) {
    _authorizationHash = [authorizationHash copy];
    _snapshotHash = [snapshotHash copy];
    _confirmationNonce = [confirmationNonce copy];
    _confirmationEnvelopeId = [confirmationEnvelopeId copy];
    _ceremonyId = [ceremonyId copy];
    _candidateEndpointId = [candidateEndpointId copy];
    _replacementWrapHash = [replacementWrapHash copy];
  }
  return self;
}
@end

@interface AncRecoveryAuthorizationEnvelope : NSObject
@property(nonatomic) NSData *vaultId;
@property(nonatomic) uint64_t createdAt;
@property(nonatomic) NSData *envelopeId;
@property(nonatomic) NSData *ceremonyId;
@property(nonatomic) uint64_t consumedGeneration;
@property(nonatomic) NSData *consumedId;
@property(nonatomic) NSData *consumedSigningPublicKey;
@property(nonatomic) NSData *consumedAgreementPublicKey;
@property(nonatomic) NSData *snapshotHash;
@property(nonatomic) NSData *consumedWrapHash;
@property(nonatomic) NSData *candidateBytes;
@property(nonatomic) NSData *confirmationBytes;
@property(nonatomic) NSData *replacementWrapBytes;
@property(nonatomic) uint64_t newEpoch;
@property(nonatomic) uint64_t expiresAt;
@property(nonatomic) NSData *signature;
@property(nonatomic) NSData *unsignedBytes;
@end
@implementation AncRecoveryAuthorizationEnvelope
@end

@interface AncRecoveryCandidate : NSObject
@property(nonatomic) uint64_t createdAt;
@property(nonatomic) NSData *envelopeId;
@property(nonatomic) NSData *endpointId;
@property(nonatomic) NSString *role;
@property(nonatomic) NSData *signingPublicKey;
@property(nonatomic) NSData *agreementPublicKey;
@property(nonatomic) NSData *addedById;
@property(nonatomic) NSData *transcriptHash;
@property(nonatomic) NSData *signature;
@property(nonatomic) NSData *unsignedBytes;
@end
@implementation AncRecoveryCandidate
@end

@interface AncRecoveryReplacementConfirmation : NSObject
@property(nonatomic) uint64_t createdAt;
@property(nonatomic) NSData *envelopeId;
@property(nonatomic) NSData *ceremonyId;
@property(nonatomic) uint64_t priorGeneration;
@property(nonatomic) NSData *priorId;
@property(nonatomic) uint64_t replacementGeneration;
@property(nonatomic) NSData *replacementId;
@property(nonatomic) NSData *replacementSigningPublicKey;
@property(nonatomic) NSData *replacementAgreementPublicKey;
@property(nonatomic) NSData *replacementWrapHash;
@property(nonatomic) NSData *candidateEndpointId;
@property(nonatomic) uint64_t newEpoch;
@property(nonatomic) NSData *nonce;
@property(nonatomic) NSData *signature;
@property(nonatomic) NSData *unsignedBytes;
@end
@implementation AncRecoveryReplacementConfirmation
@end

@interface AncRecoverySnapshot : NSObject
@property(nonatomic) uint64_t sequence;
@property(nonatomic) NSData *headHash;
@property(nonatomic) NSData *membershipHash;
@property(nonatomic) NSArray<NSData *> *priorEndpointIds;
@end
@implementation AncRecoverySnapshot
@end

static void SetStatus(AncPrivateVaultRecoveryAuthorizationStatus *status,
                      AncPrivateVaultRecoveryAuthorizationStatus value) {
  if (status != NULL)
    *status = value;
}

static NSData *SnapshotData(NSData *value, NSUInteger maximum) {
  if (![value isKindOfClass:NSData.class] || value.length == 0 ||
      value.length > maximum || (value.length > 0 && value.bytes == NULL))
    return nil;
  return [[NSData alloc] initWithBytes:value.bytes length:value.length];
}

static BOOL ExactKeys(NSDictionary *map, NSArray<NSNumber *> *keys) {
  if (map.count != keys.count)
    return NO;
  for (NSNumber *key in keys)
    if (map[key] == nil)
      return NO;
  return YES;
}

static NSData *Bytes(NSDictionary *map, NSNumber *key, NSUInteger length) {
  AncPrivateVaultCanonicalValue *value = map[key];
  return value.type == AncPrivateVaultCanonicalTypeBytes &&
                 value.bytesValue.length == length
             ? [value.bytesValue copy]
             : nil;
}

static NSString *Text(NSDictionary *map, NSNumber *key) {
  AncPrivateVaultCanonicalValue *value = map[key];
  return value.type == AncPrivateVaultCanonicalTypeText ? value.textValue : nil;
}

static BOOL Integer(NSDictionary *map, NSNumber *key, uint64_t minimum,
                    uint64_t *output) {
  AncPrivateVaultCanonicalValue *value = map[key];
  if (value.type != AncPrivateVaultCanonicalTypeInteger ||
      value.integerValue < 0 || (uint64_t)value.integerValue < minimum ||
      (uint64_t)value.integerValue > kMaximumSafeInteger)
    return NO;
  *output = (uint64_t)value.integerValue;
  return YES;
}

static NSDictionary *DecodeMap(NSData *encoded, NSUInteger maximum) {
  if (encoded.length == 0 || encoded.length > maximum)
    return nil;
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root =
      AncPrivateVaultCanonicalDecode(encoded, maximum, &status);
  return root.type == AncPrivateVaultCanonicalTypeMap ? root.mapValue : nil;
}

static NSData *EncodeWithout(NSDictionary *map, NSNumber *excludedKey) {
  NSMutableDictionary *unsignedMap = [map mutableCopy];
  [unsignedMap removeObjectForKey:excludedKey];
  AncPrivateVaultCanonicalStatus status;
  return AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:unsignedMap], &status);
}

static NSMutableData *DomainMessage(const uint8_t *domain, size_t domainLength,
                                    NSData *payload) {
  NSMutableData *message =
      [NSMutableData dataWithBytes:domain length:domainLength];
  [message appendData:payload];
  return message;
}

static BOOL VerifyDomain(const uint8_t *domain, size_t domainLength,
                         NSData *payload, NSData *signature,
                         NSData *publicKey) {
  if (signature.length != 64 || publicKey.length != 32)
    return NO;
  NSMutableData *message = DomainMessage(domain, domainLength, payload);
  return anc_pv_ed25519_verify(signature.bytes, message.bytes, message.length,
                               publicKey.bytes) == ANC_PV_CRYPTO_OK;
}

static NSData *HashDomain(const uint8_t *domain, size_t domainLength,
                          NSData *payload) {
  uint8_t digest[32] = {0};
  BOOL okay = anc_pv_blake2b_256_two_part(
                  digest, domain, domainLength, payload.bytes, payload.length) ==
              ANC_PV_CRYPTO_OK;
  NSData *result =
      okay ? [NSData dataWithBytes:digest length:sizeof digest] : nil;
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static NSData *DataFromLowerHex(NSString *hex, NSUInteger length) {
  if (![hex isKindOfClass:NSString.class] || hex.length != length * 2)
    return nil;
  NSMutableData *data = [NSMutableData dataWithLength:length];
  uint8_t *output = data.mutableBytes;
  for (NSUInteger index = 0; index < length; index += 1) {
    unichar high = [hex characterAtIndex:index * 2];
    unichar low = [hex characterAtIndex:index * 2 + 1];
    int left = high >= '0' && high <= '9' ? high - '0'
               : high >= 'a' && high <= 'f' ? high - 'a' + 10
                                             : -1;
    int right = low >= '0' && low <= '9' ? low - '0'
                : low >= 'a' && low <= 'f' ? low - 'a' + 10
                                           : -1;
    if (left < 0 || right < 0)
      return nil;
    output[index] = (uint8_t)((left << 4) | right);
  }
  return data;
}

static NSString *LowerHex(NSData *data) {
  if (![data isKindOfClass:NSData.class])
    return nil;
  static const char hex[] = "0123456789abcdef";
  NSMutableData *encoded = [NSMutableData dataWithLength:data.length * 2];
  const uint8_t *input = data.bytes;
  uint8_t *output = encoded.mutableBytes;
  for (NSUInteger index = 0; index < data.length; index += 1) {
    output[index * 2] = hex[input[index] >> 4];
    output[index * 2 + 1] = hex[input[index] & 15];
  }
  return [[NSString alloc] initWithData:encoded
                               encoding:NSASCIIStringEncoding];
}

static NSTimeInterval TimestampSeconds(NSString *value) {
  if (![value isKindOfClass:NSString.class])
    return NAN;
  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                            NSISO8601DateFormatWithFractionalSeconds;
  NSDate *date = [formatter dateFromString:value];
  if (date == nil) {
    formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime;
    date = [formatter dateFromString:value];
  }
  return date == nil ? NAN : date.timeIntervalSince1970;
}

static BOOL DecodeCommon(NSDictionary *map, NSString *type,
                         NSData *expectedVaultId, uint64_t *createdAt,
                         NSData **envelopeId) {
  NSString *suite = Text(map, @1);
  NSData *vaultId = Bytes(map, @2, 16);
  NSString *actualType = Text(map, @3);
  return [suite isEqualToString:@"anc/v1"] &&
         [actualType isEqualToString:type] &&
         [vaultId isEqualToData:expectedVaultId] &&
         Integer(map, @4, 1, createdAt) &&
         (*envelopeId = Bytes(map, @5, 16)) != nil;
}

static AncRecoveryAuthorizationEnvelope *DecodeAuthorization(
    NSData *encoded, NSData *expectedVaultId) {
  NSDictionary *map = DecodeMap(encoded, kMaximumEvidenceBytes);
  NSArray *keys = @[
    @1, @2, @3, @4, @5, @440, @441, @442, @443, @444, @445, @446,
    @447, @448, @449, @450, @451, @452
  ];
  if (!ExactKeys(map, keys))
    return nil;
  AncRecoveryAuthorizationEnvelope *value =
      [AncRecoveryAuthorizationEnvelope new];
  value.vaultId = Bytes(map, @2, 16);
  value.ceremonyId = Bytes(map, @440, 16);
  value.consumedId = Bytes(map, @442, 16);
  value.consumedSigningPublicKey = Bytes(map, @443, 32);
  value.consumedAgreementPublicKey = Bytes(map, @444, 32);
  value.snapshotHash = Bytes(map, @445, 32);
  value.consumedWrapHash = Bytes(map, @446, 32);
  AncPrivateVaultCanonicalValue *candidateValue = map[@447];
  AncPrivateVaultCanonicalValue *confirmationValue = map[@448];
  AncPrivateVaultCanonicalValue *replacementWrapValue = map[@449];
  value.candidateBytes =
      candidateValue.type == AncPrivateVaultCanonicalTypeBytes
                             ? [candidateValue.bytesValue copy]
                             : nil;
  value.confirmationBytes =
      confirmationValue.type == AncPrivateVaultCanonicalTypeBytes
                                ? [confirmationValue.bytesValue copy]
                                : nil;
  value.replacementWrapBytes =
      replacementWrapValue.type == AncPrivateVaultCanonicalTypeBytes
          ? [replacementWrapValue.bytesValue copy]
          : nil;
  value.signature = Bytes(map, @452, 64);
  uint64_t createdAt = 0;
  uint64_t consumedGeneration = 0;
  uint64_t newEpoch = 0;
  uint64_t expiresAt = 0;
  NSData *envelopeId = nil;
  BOOL valid = DecodeCommon(map, @"recovery-authorization", expectedVaultId,
                            &createdAt, &envelopeId) &&
               value.ceremonyId != nil && value.consumedId != nil &&
               value.consumedSigningPublicKey != nil &&
               value.consumedAgreementPublicKey != nil &&
               value.snapshotHash != nil && value.consumedWrapHash != nil &&
               value.signature != nil &&
               Integer(map, @441, 1, &consumedGeneration) &&
               Integer(map, @450, 2, &newEpoch) &&
               Integer(map, @451, 1, &expiresAt) && expiresAt >= createdAt &&
               expiresAt - createdAt <= kMaximumLifetimeSeconds &&
               value.candidateBytes.length > 0 &&
               value.confirmationBytes.length > 0 &&
               value.replacementWrapBytes.length > 0 &&
               encoded.length + value.candidateBytes.length +
                       value.confirmationBytes.length +
                       value.replacementWrapBytes.length <=
                   kMaximumEvidenceBytes;
  value.createdAt = createdAt;
  value.envelopeId = envelopeId;
  value.consumedGeneration = consumedGeneration;
  value.newEpoch = newEpoch;
  value.expiresAt = expiresAt;
  value.unsignedBytes = valid ? EncodeWithout(map, @452) : nil;
  return valid && value.unsignedBytes != nil ? value : nil;
}

static AncRecoveryCandidate *DecodeCandidate(NSData *encoded,
                                              NSData *expectedVaultId) {
  NSDictionary *map = DecodeMap(encoded, kMaximumEvidenceBytes);
  NSArray *keys = @[
    @1, @2, @3, @4, @5, @10, @11, @12, @13, @14, @15, @16, @17
  ];
  if (!ExactKeys(map, keys))
    return nil;
  AncRecoveryCandidate *value = [AncRecoveryCandidate new];
  value.endpointId = Bytes(map, @10, 16);
  value.role = Text(map, @11);
  AncPrivateVaultCanonicalValue *unattended = map[@12];
  value.signingPublicKey = Bytes(map, @13, 32);
  value.agreementPublicKey = Bytes(map, @14, 32);
  value.addedById = Bytes(map, @15, 16);
  value.transcriptHash = Bytes(map, @16, 32);
  value.signature = Bytes(map, @17, 64);
  uint64_t createdAt = 0;
  NSData *envelopeId = nil;
  BOOL valid = DecodeCommon(map, @"endpoint", expectedVaultId,
                            &createdAt, &envelopeId) &&
               value.endpointId != nil && value.role.length > 0 &&
               [value.role lengthOfBytesUsingEncoding:NSUTF8StringEncoding] <=
                   64 &&
               unattended.type == AncPrivateVaultCanonicalTypeBoolean &&
               !unattended.booleanValue && value.signingPublicKey != nil &&
               value.agreementPublicKey != nil && value.addedById != nil &&
               value.transcriptHash != nil && value.signature != nil;
  value.createdAt = createdAt;
  value.envelopeId = envelopeId;
  value.unsignedBytes = valid ? EncodeWithout(map, @17) : nil;
  return valid && value.unsignedBytes != nil ? value : nil;
}

static AncRecoveryReplacementConfirmation *DecodeConfirmation(
    NSData *encoded, NSData *expectedVaultId) {
  NSDictionary *map = DecodeMap(encoded, kMaximumEvidenceBytes);
  NSArray *keys = @[
    @1, @2, @3, @4, @5, @420, @421, @422, @423, @424, @425, @426,
    @427, @428, @429, @430, @431
  ];
  if (!ExactKeys(map, keys))
    return nil;
  AncRecoveryReplacementConfirmation *value =
      [AncRecoveryReplacementConfirmation new];
  value.ceremonyId = Bytes(map, @420, 16);
  value.priorId = Bytes(map, @422, 16);
  value.replacementId = Bytes(map, @424, 16);
  value.replacementSigningPublicKey = Bytes(map, @425, 32);
  value.replacementAgreementPublicKey = Bytes(map, @426, 32);
  value.replacementWrapHash = Bytes(map, @427, 32);
  value.candidateEndpointId = Bytes(map, @428, 16);
  value.nonce = Bytes(map, @430, 32);
  value.signature = Bytes(map, @431, 64);
  uint64_t createdAt = 0;
  uint64_t priorGeneration = 0;
  uint64_t replacementGeneration = 0;
  uint64_t newEpoch = 0;
  NSData *envelopeId = nil;
  BOOL valid = DecodeCommon(map, @"recovery-replacement-confirmation",
                            expectedVaultId, &createdAt, &envelopeId) &&
               value.ceremonyId != nil && value.priorId != nil &&
               value.replacementId != nil &&
               value.replacementSigningPublicKey != nil &&
               value.replacementAgreementPublicKey != nil &&
               value.replacementWrapHash != nil &&
               value.candidateEndpointId != nil && value.nonce != nil &&
               value.signature != nil &&
               Integer(map, @421, 1, &priorGeneration) &&
               Integer(map, @423, 1, &replacementGeneration) &&
               Integer(map, @429, 2, &newEpoch);
  value.createdAt = createdAt;
  value.envelopeId = envelopeId;
  value.priorGeneration = priorGeneration;
  value.replacementGeneration = replacementGeneration;
  value.newEpoch = newEpoch;
  value.unsignedBytes = valid ? EncodeWithout(map, @431) : nil;
  return valid && value.unsignedBytes != nil ? value : nil;
}

static NSComparisonResult CompareData(NSData *left, NSData *right) {
  NSUInteger count = MIN(left.length, right.length);
  int result = memcmp(left.bytes, right.bytes, count);
  if (result < 0)
    return NSOrderedAscending;
  if (result > 0)
    return NSOrderedDescending;
  return left.length < right.length    ? NSOrderedAscending
         : left.length > right.length ? NSOrderedDescending
                                      : NSOrderedSame;
}

static AncRecoverySnapshot *DecodeSnapshot(NSData *encoded,
                                            NSData *expectedVaultId) {
  NSDictionary *map = DecodeMap(encoded, kMaximumEvidenceBytes);
  NSArray *keys = @[@1, @2, @3, @220, @221, @222, @223];
  if (!ExactKeys(map, keys) || ![Text(map, @1) isEqualToString:@"anc/v1"] ||
      ![Text(map, @3) isEqualToString:@"recovery-snapshot"] ||
      ![Bytes(map, @2, 16) isEqualToData:expectedVaultId])
    return nil;
  AncRecoverySnapshot *value = [AncRecoverySnapshot new];
  value.headHash = Bytes(map, @221, 32);
  value.membershipHash = Bytes(map, @222, 32);
  AncPrivateVaultCanonicalValue *ids = map[@223];
  uint64_t sequence = 0;
  if (!Integer(map, @220, 0, &sequence) || value.headHash == nil ||
      value.membershipHash == nil ||
      ids.type != AncPrivateVaultCanonicalTypeArray || ids.arrayValue.count < 1 ||
      ids.arrayValue.count > 64)
    return nil;
  value.sequence = sequence;
  NSMutableArray *prior = [NSMutableArray arrayWithCapacity:ids.arrayValue.count];
  for (AncPrivateVaultCanonicalValue *item in ids.arrayValue) {
    if (item.type != AncPrivateVaultCanonicalTypeBytes ||
        item.bytesValue.length != 16)
      return nil;
    NSData *identifier = [item.bytesValue copy];
    if (prior.count > 0 &&
        CompareData(prior.lastObject, identifier) != NSOrderedAscending)
      return nil;
    [prior addObject:identifier];
  }
  value.priorEndpointIds = [prior copy];
  return value;
}

static NSData *CandidateTranscriptHash(NSData *vaultId, NSData *ceremonyId,
                                       NSData *snapshotHash,
                                       NSData *consumedId,
                                       AncRecoveryCandidate *candidate,
                                       uint64_t targetEpoch) {
  NSDictionary *map = @{
    @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
    @2 : [AncPrivateVaultCanonicalValue bytes:vaultId],
    @440 : [AncPrivateVaultCanonicalValue bytes:ceremonyId],
    @445 : [AncPrivateVaultCanonicalValue bytes:snapshotHash],
    @442 : [AncPrivateVaultCanonicalValue bytes:consumedId],
    @10 : [AncPrivateVaultCanonicalValue bytes:candidate.endpointId],
    @13 : [AncPrivateVaultCanonicalValue bytes:candidate.signingPublicKey],
    @14 : [AncPrivateVaultCanonicalValue bytes:candidate.agreementPublicKey],
    @450 : [AncPrivateVaultCanonicalValue integer:(int64_t)targetEpoch],
  };
  AncPrivateVaultCanonicalStatus status;
  NSData *encoded = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:map], &status);
  return encoded == nil
             ? nil
             : HashDomain(kAuthorizationDomain,
                          sizeof kAuthorizationDomain, encoded);
}

static AncPrivateVaultControlLogMember *MemberByIdentifier(
    NSArray<AncPrivateVaultControlLogMember *> *members, NSData *identifier) {
  NSString *hex = LowerHex(identifier);
  for (AncPrivateVaultControlLogMember *member in members)
    if ([member.endpointId isEqualToString:hex])
      return member;
  return nil;
}

static NSArray<NSData *> *SortedStateIdentifiers(
    NSArray<AncPrivateVaultControlLogMember *> *members) {
  NSMutableArray *values = [NSMutableArray arrayWithCapacity:members.count];
  for (AncPrivateVaultControlLogMember *member in members) {
    NSData *identifier = DataFromLowerHex(member.endpointId, 16);
    if (identifier == nil)
      return nil;
    [values addObject:identifier];
  }
  [values sortUsingComparator:^NSComparisonResult(NSData *left, NSData *right) {
    return CompareData(left, right);
  }];
  for (NSUInteger index = 1; index < values.count; index += 1)
    if (CompareData(values[index - 1], values[index]) != NSOrderedAscending)
      return nil;
  return [values copy];
}

static BOOL UnsealEEK(NSData *encodedWrap, NSData *vaultId,
                      NSData *issuerSigningPublicKey,
                      NSData *issuerAgreementPublicKey,
                      AncPrivateVaultRecoveryAuthority *authority,
                      uint8_t output[32]) {
  __block BOOL copied = NO;
  AncPrivateVaultGuardedMemoryStatus borrowStatus =
      [authority.keyAgreementPrivateKey
          borrow:^BOOL(uint8_t *privateKey, size_t length) {
            if (length != 32)
              return NO;
            AncPrivateVaultRecoveryWrapStatus status =
                AncPrivateVaultRecoveryWrapUnseal(
                    encodedWrap, vaultId, issuerSigningPublicKey,
                    issuerAgreementPublicKey, privateKey,
                    ^BOOL(const uint8_t *eek) {
                      memcpy(output, eek, 32);
                      copied = YES;
                      return YES;
                    });
            return status == AncPrivateVaultRecoveryWrapStatusOK && copied;
          }];
  return borrowStatus == AncPrivateVaultGuardedMemoryStatusOK && copied;
}

@interface AncPrivateVaultRecoveryAuthorizationVerifier ()
- (instancetype)
       initWithPublicAuthorization:(NSData *)authorization
                   currentSnapshot:(NSData *)currentSnapshot
               currentRecoveryWrap:(NSData *)currentRecoveryWrap
           trustedNowMilliseconds:(uint64_t)trustedNowMilliseconds
                             status:
                                 (AncPrivateVaultRecoveryAuthorizationStatus *)status
    NS_DESIGNATED_INITIALIZER;
@property(nonatomic) NSData *authorizationBytes;
@property(nonatomic) NSData *snapshotBytes;
@property(nonatomic) NSData *currentWrapBytes;
@property(nonatomic) AncRecoveryAuthorizationEnvelope *authorization;
@property(nonatomic) AncRecoverySnapshot *snapshot;
@property(nonatomic) AncRecoveryCandidate *candidate;
@property(nonatomic) AncRecoveryReplacementConfirmation *confirmation;
@property(nonatomic) AncPrivateVaultRecoveryAuthority *consumedAuthority;
@property(nonatomic) AncPrivateVaultRecoveryAuthority *replacementAuthority;
@property(nonatomic) uint64_t trustedNowMilliseconds;
@property(nonatomic) BOOL publicEvidenceOnly;
@property(nonatomic, readwrite, nullable)
    AncPrivateVaultRecoveryAuthorizationResult *result;
@property(nonatomic, readwrite) AncPrivateVaultRecoveryAuthorizationStatus status;
@end

@implementation AncPrivateVaultRecoveryAuthorizationVerifier

- (instancetype)
       initWithPublicAuthorization:(NSData *)authorization
                   currentSnapshot:(NSData *)currentSnapshot
               currentRecoveryWrap:(NSData *)currentRecoveryWrap
           trustedNowMilliseconds:(uint64_t)trustedNowMilliseconds
                             status:
                                 (AncPrivateVaultRecoveryAuthorizationStatus *)status {
  SetStatus(status, AncPrivateVaultRecoveryAuthorizationStatusInvalidArgument);
  self = [super init];
  if (self == nil)
    return nil;
  NSData *authorizationCopy =
      SnapshotData(authorization, kMaximumEvidenceBytes);
  NSData *snapshotCopy = SnapshotData(currentSnapshot, kMaximumEvidenceBytes);
  NSData *wrapCopy = SnapshotData(currentRecoveryWrap, kMaximumEvidenceBytes);
  if (authorizationCopy == nil || snapshotCopy == nil || wrapCopy == nil ||
      trustedNowMilliseconds == 0)
    return nil;
  AncPrivateVaultCanonicalValue *vaultValue =
      DecodeMap(authorizationCopy, kMaximumEvidenceBytes)[@2];
  NSData *vaultId = vaultValue.bytesValue;
  if (vaultId.length != 16) {
    _status = AncPrivateVaultRecoveryAuthorizationStatusInvalidCanonical;
    SetStatus(status, _status);
    return nil;
  }
  AncRecoveryAuthorizationEnvelope *decodedAuthorization =
      DecodeAuthorization(authorizationCopy, vaultId);
  AncRecoverySnapshot *decodedSnapshot = DecodeSnapshot(snapshotCopy, vaultId);
  AncRecoveryCandidate *decodedCandidate =
      DecodeCandidate(decodedAuthorization.candidateBytes, vaultId);
  AncRecoveryReplacementConfirmation *decodedConfirmation =
      DecodeConfirmation(decodedAuthorization.confirmationBytes, vaultId);
  if (decodedAuthorization == nil || decodedSnapshot == nil ||
      decodedCandidate == nil || decodedConfirmation == nil ||
      decodedAuthorization.consumedGeneration == 0 ||
      decodedAuthorization.consumedGeneration == kMaximumSafeInteger ||
      decodedConfirmation.replacementGeneration !=
          decodedAuthorization.consumedGeneration + 1 ||
      ![decodedConfirmation.priorId
          isEqualToData:decodedAuthorization.consumedId]) {
    _status = AncPrivateVaultRecoveryAuthorizationStatusBinding;
    SetStatus(status, _status);
    return nil;
  }
  _authorizationBytes = authorizationCopy;
  _snapshotBytes = snapshotCopy;
  _currentWrapBytes = wrapCopy;
  _authorization = decodedAuthorization;
  _snapshot = decodedSnapshot;
  _candidate = decodedCandidate;
  _confirmation = decodedConfirmation;
  _trustedNowMilliseconds = trustedNowMilliseconds;
  _publicEvidenceOnly = YES;
  _status = AncPrivateVaultRecoveryAuthorizationStatusOK;
  SetStatus(status, _status);
  return self;
}

- (instancetype)
       initWithAuthorization:(NSData *)authorization
             currentSnapshot:(NSData *)currentSnapshot
         currentRecoveryWrap:(NSData *)currentRecoveryWrap
           consumedAuthority:
               (AncPrivateVaultRecoveryAuthority *)consumedAuthority
        replacementAuthority:
            (AncPrivateVaultRecoveryAuthority *)replacementAuthority
     trustedNowMilliseconds:(uint64_t)trustedNowMilliseconds
                       status:
                           (AncPrivateVaultRecoveryAuthorizationStatus *)status {
  SetStatus(status, AncPrivateVaultRecoveryAuthorizationStatusInvalidArgument);
  self = [super init];
  if (self == nil)
    return nil;
  NSData *authorizationCopy =
      SnapshotData(authorization, kMaximumEvidenceBytes);
  NSData *snapshotCopy = SnapshotData(currentSnapshot, kMaximumEvidenceBytes);
  NSData *wrapCopy = SnapshotData(currentRecoveryWrap, kMaximumEvidenceBytes);
  if (authorizationCopy == nil || snapshotCopy == nil || wrapCopy == nil ||
      consumedAuthority == nil || replacementAuthority == nil ||
      trustedNowMilliseconds == 0 ||
      consumedAuthority.keyAgreementPrivateKey.isClosed ||
      replacementAuthority.keyAgreementPrivateKey.isClosed) {
    _status = AncPrivateVaultRecoveryAuthorizationStatusInvalidArgument;
    return nil;
  }
  AncPrivateVaultCanonicalValue *vaultValue =
      DecodeMap(authorizationCopy, kMaximumEvidenceBytes)[@2];
  NSData *vaultId = vaultValue.bytesValue;
  if (vaultId.length != 16) {
    _status = AncPrivateVaultRecoveryAuthorizationStatusInvalidCanonical;
    SetStatus(status, _status);
    return nil;
  }
  AncRecoveryAuthorizationEnvelope *decodedAuthorization =
      DecodeAuthorization(authorizationCopy, vaultId);
  AncRecoverySnapshot *decodedSnapshot = DecodeSnapshot(snapshotCopy, vaultId);
  AncRecoveryCandidate *decodedCandidate =
      DecodeCandidate(decodedAuthorization.candidateBytes, vaultId);
  AncRecoveryReplacementConfirmation *decodedConfirmation =
      DecodeConfirmation(decodedAuthorization.confirmationBytes, vaultId);
  if (decodedAuthorization == nil || decodedSnapshot == nil ||
      decodedCandidate == nil || decodedConfirmation == nil) {
    _status = AncPrivateVaultRecoveryAuthorizationStatusInvalidCanonical;
    SetStatus(status, _status);
    return nil;
  }
  if (consumedAuthority.recoveryGeneration !=
          decodedAuthorization.consumedGeneration ||
      replacementAuthority.recoveryGeneration !=
          consumedAuthority.recoveryGeneration + 1 ||
      ![consumedAuthority.recoveryId
          isEqualToData:decodedAuthorization.consumedId] ||
      ![consumedAuthority.signingPublicKey
          isEqualToData:decodedAuthorization.consumedSigningPublicKey] ||
      ![consumedAuthority.keyAgreementPublicKey
          isEqualToData:decodedAuthorization.consumedAgreementPublicKey] ||
      ![replacementAuthority.recoveryId
          isEqualToData:decodedConfirmation.replacementId] ||
      ![replacementAuthority.signingPublicKey
          isEqualToData:decodedConfirmation.replacementSigningPublicKey] ||
      ![replacementAuthority.keyAgreementPublicKey
          isEqualToData:decodedConfirmation.replacementAgreementPublicKey]) {
    _status = AncPrivateVaultRecoveryAuthorizationStatusBinding;
    SetStatus(status, _status);
    return nil;
  }
  _authorizationBytes = authorizationCopy;
  _snapshotBytes = snapshotCopy;
  _currentWrapBytes = wrapCopy;
  _authorization = decodedAuthorization;
  _snapshot = decodedSnapshot;
  _candidate = decodedCandidate;
  _confirmation = decodedConfirmation;
  _consumedAuthority = consumedAuthority;
  _replacementAuthority = replacementAuthority;
  _trustedNowMilliseconds = trustedNowMilliseconds;
  _publicEvidenceOnly = NO;
  _status = AncPrivateVaultRecoveryAuthorizationStatusOK;
  SetStatus(status, _status);
  return self;
}

- (BOOL)verifyRecoveryMembershipCommit:
            (AncPrivateVaultControlLogMembershipCommit *)commit
                            signedEntry:
                                (AncPrivateVaultControlLogSignedEntry *)entry
                           currentState:
                               (AncPrivateVaultControlLogState *)state
                       signedEntryBytes:(NSData *)signedEntryBytes
                     innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  self.result = nil;
  self.status = AncPrivateVaultRecoveryAuthorizationStatusBinding;
  if (commit == nil || entry == nil || state == nil ||
      signedEntryBytes.length == 0 || innerEnvelopeBytes.length == 0 ||
      (!self.publicEvidenceOnly &&
       (self.consumedAuthority.keyAgreementPrivateKey.isClosed ||
        self.replacementAuthority.keyAgreementPrivateKey.isClosed)))
    return NO;
  NSData *vaultId = DataFromLowerHex(state.vaultId, 16);
  NSData *stateRecoveryId = DataFromLowerHex(state.recoveryId, 16);
  NSData *stateHead = state.headHash;
  NSData *stateMembership = state.membershipHash;
  uint64_t now = self.trustedNowMilliseconds / 1000;
  if (vaultId == nil || stateRecoveryId == nil || stateHead.length != 32 ||
      stateMembership.length != 32 ||
      ![vaultId isEqualToData:self.authorization.vaultId] ||
      state.recoveryGeneration != self.authorization.consumedGeneration ||
      ![stateRecoveryId isEqualToData:self.authorization.consumedId] ||
      ![state.recoverySigningPublicKey
          isEqualToData:self.authorization.consumedSigningPublicKey] ||
      ![state.recoveryKeyAgreementPublicKey
          isEqualToData:self.authorization.consumedAgreementPublicKey] ||
      self.authorization.newEpoch != state.epoch + 1)
    return NO;

  if (!VerifyDomain(kAuthorizationDomain, sizeof kAuthorizationDomain,
                    self.authorization.unsignedBytes,
                    self.authorization.signature,
                    state.recoverySigningPublicKey)) {
    self.status = AncPrivateVaultRecoveryAuthorizationStatusSignature;
    return NO;
  }
  NSData *snapshotHash = HashDomain(kRecoveryDomain, sizeof kRecoveryDomain,
                                    self.snapshotBytes);
  NSArray<NSData *> *stateIds = SortedStateIdentifiers(state.activeMembers);
  if (snapshotHash == nil ||
      ![snapshotHash isEqualToData:self.authorization.snapshotHash] ||
      self.snapshot.sequence != state.sequence ||
      ![self.snapshot.headHash isEqualToData:stateHead] ||
      ![self.snapshot.membershipHash isEqualToData:stateMembership] ||
      ![self.snapshot.priorEndpointIds isEqualToArray:stateIds])
    return NO;

  AncPrivateVaultRecoveryWrapStatus wrapStatus;
  AncPrivateVaultRecoveryWrap *currentWrap =
      AncPrivateVaultRecoveryWrapDecode(self.currentWrapBytes, vaultId,
                                        &wrapStatus);
  NSData *currentWrapHash =
      AncPrivateVaultRecoveryWrapHash(self.currentWrapBytes, vaultId,
                                      &wrapStatus);
  AncPrivateVaultControlLogMember *currentIssuer =
      MemberByIdentifier(state.activeMembers, currentWrap.issuerEndpointId);
  NSTimeInterval stateSignedAt = TimestampSeconds(state.signedAt);
  if (currentWrap == nil || currentWrapHash == nil || currentIssuer == nil ||
      ![currentWrapHash isEqualToData:self.authorization.consumedWrapHash] ||
      ![currentWrapHash isEqualToData:state.recoveryWrapHash] ||
      currentWrap.recoveryGeneration != state.recoveryGeneration ||
      ![currentWrap.recoveryId isEqualToData:stateRecoveryId] ||
      ![currentWrap.recoveryKeyAgreementPublicKey
          isEqualToData:state.recoveryKeyAgreementPublicKey] ||
      currentWrap.epoch != state.epoch ||
      currentWrap.activationControlSequence > state.sequence ||
      !isfinite(stateSignedAt) || currentWrap.createdAt > stateSignedAt ||
      currentWrap.createdAt > now ||
      AncPrivateVaultRecoveryWrapVerify(
          self.currentWrapBytes, vaultId, currentIssuer.signingPublicKey,
          &wrapStatus) == nil) {
    self.status = AncPrivateVaultRecoveryAuthorizationStatusCurrentWrap;
    return NO;
  }

  NSData *expectedTranscript = CandidateTranscriptHash(
      vaultId, self.authorization.ceremonyId, snapshotHash,
      self.authorization.consumedId, self.candidate,
      self.authorization.newEpoch);
  if (![self.candidate.addedById
          isEqualToData:self.authorization.consumedId] ||
      ![self.candidate.transcriptHash isEqualToData:expectedTranscript] ||
      !VerifyDomain(kEndpointDomain, sizeof kEndpointDomain,
                    self.candidate.unsignedBytes, self.candidate.signature,
                    state.recoverySigningPublicKey) ||
      MemberByIdentifier(state.activeMembers, self.candidate.endpointId) != nil ||
      [state.removedEndpointIds containsObject:LowerHex(self.candidate.endpointId)]) {
    self.status = AncPrivateVaultRecoveryAuthorizationStatusSignature;
    return NO;
  }

  NSData *replacementWrapHash = AncPrivateVaultRecoveryWrapHash(
      self.authorization.replacementWrapBytes, vaultId, &wrapStatus);
  if (!VerifyDomain(kConfirmationDomain, sizeof kConfirmationDomain,
                    self.confirmation.unsignedBytes,
                    self.confirmation.signature,
                    self.confirmation.replacementSigningPublicKey) ||
      ![self.confirmation.ceremonyId
          isEqualToData:self.authorization.ceremonyId] ||
      self.confirmation.priorGeneration != state.recoveryGeneration ||
      ![self.confirmation.priorId isEqualToData:stateRecoveryId] ||
      self.confirmation.replacementGeneration != state.recoveryGeneration + 1 ||
      (!self.publicEvidenceOnly &&
       ![self.confirmation.replacementId
           isEqualToData:self.replacementAuthority.recoveryId]) ||
      [self.confirmation.replacementId
          isEqualToData:self.authorization.consumedId] ||
      ![self.confirmation.replacementWrapHash
          isEqualToData:replacementWrapHash] ||
      ![self.confirmation.candidateEndpointId
          isEqualToData:self.candidate.endpointId] ||
      self.confirmation.newEpoch != self.authorization.newEpoch ||
      self.confirmation.createdAt > self.authorization.createdAt ||
      self.authorization.createdAt - self.confirmation.createdAt >
          kMaximumLifetimeSeconds) {
    self.status = AncPrivateVaultRecoveryAuthorizationStatusSignature;
    return NO;
  }

  AncPrivateVaultRecoveryWrap *replacementWrap =
      AncPrivateVaultRecoveryWrapVerify(
          self.authorization.replacementWrapBytes, vaultId,
          self.candidate.signingPublicKey, &wrapStatus);
  if (replacementWrap == nil || replacementWrapHash == nil ||
      ![replacementWrap.ceremonyId
          isEqualToData:self.authorization.ceremonyId] ||
      replacementWrap.recoveryGeneration !=
          self.confirmation.replacementGeneration ||
      ![replacementWrap.recoveryId
          isEqualToData:self.confirmation.replacementId] ||
      ![replacementWrap.recoveryKeyAgreementPublicKey
          isEqualToData:self.confirmation.replacementAgreementPublicKey] ||
      replacementWrap.epoch != self.authorization.newEpoch ||
      ![replacementWrap.issuerEndpointId
          isEqualToData:self.candidate.endpointId] ||
      replacementWrap.activationControlSequence != state.sequence + 1 ||
      ![replacementWrap.activationPreviousHead isEqualToData:stateHead] ||
      ![replacementWrap.activationPreviousMembershipHash
          isEqualToData:stateMembership]) {
    self.status = AncPrivateVaultRecoveryAuthorizationStatusReplacementWrap;
    return NO;
  }

  NSTimeInterval entryCreatedAt = TimestampSeconds(entry.createdAt);
  if (!isfinite(entryCreatedAt) || self.candidate.createdAt < stateSignedAt ||
      replacementWrap.createdAt < self.candidate.createdAt ||
      self.confirmation.createdAt < replacementWrap.createdAt ||
      self.authorization.createdAt < self.confirmation.createdAt ||
      entryCreatedAt < self.authorization.createdAt ||
      entryCreatedAt > self.authorization.expiresAt ||
      entryCreatedAt - self.candidate.createdAt > kMaximumLifetimeSeconds ||
      entryCreatedAt > now + 30) {
    self.status = AncPrivateVaultRecoveryAuthorizationStatusTime;
    return NO;
  }

  NSDictionary *signedMap = DecodeMap(signedEntryBytes, 64 * 1024);
  NSData *unsignedEntry = ExactKeys(
                              signedMap,
                              @[@1, @2, @3, @4, @5, @110, @111, @112, @113,
                                @114])
                              ? EncodeWithout(signedMap, @114)
                              : nil;
  if (unsignedEntry == nil ||
      !VerifyDomain(kEntryDomain, sizeof kEntryDomain, unsignedEntry,
                    entry.signature, self.candidate.signingPublicKey)) {
    self.status = AncPrivateVaultRecoveryAuthorizationStatusSignature;
    return NO;
  }

  NSData *authorizationHash = HashDomain(
      kAuthorizationDomain, sizeof kAuthorizationDomain,
      self.authorizationBytes);
  NSString *candidateId = LowerHex(self.candidate.endpointId);
  NSString *authorizationId = LowerHex(self.authorization.envelopeId);
  NSArray<NSString *> *priorIds =
      [[state.activeMembers valueForKey:@"endpointId"]
          sortedArrayUsingSelector:@selector(compare:)];
  BOOL hasBroker = NO;
  for (AncPrivateVaultControlLogMember *member in state.activeMembers)
    hasBroker = hasBroker || [member.role isEqualToString:@"broker"];
  AncPrivateVaultControlLogMember *sole =
      commit.activeMembers.count == 1 ? commit.activeMembers.firstObject : nil;
  if (![entry.vaultId isEqualToString:state.vaultId] ||
      ![commit.vaultId isEqualToString:state.vaultId] ||
      entry.sequence != state.sequence + 1 ||
      ![entry.previousHash isEqualToData:stateHead] ||
      ![entry.signerEndpointId isEqualToString:candidateId] ||
      ![entry.innerEnvelopeBytes isEqualToData:innerEnvelopeBytes] ||
      ![commit.ceremonyKind isEqualToString:@"recovery"] ||
      ![commit.ceremonyId isEqualToString:LowerHex(self.authorization.ceremonyId)] ||
      ![commit.previousMembershipHash isEqualToData:stateMembership] ||
      commit.epoch != self.authorization.newEpoch || sole == nil ||
      ![sole.endpointId isEqualToString:candidateId] ||
      ![sole.role isEqualToString:@"endpoint"] || sole.unattended ||
      ![sole.signingPublicKey isEqualToData:self.candidate.signingPublicKey] ||
      ![sole.keyAgreementPublicKey
          isEqualToData:self.candidate.agreementPublicKey] ||
      ![sole.enrollmentRef isEqualToString:authorizationId] ||
      ![commit.removedEndpointIds isEqualToArray:priorIds] ||
      !commit.rotationCompleted || commit.outstandingJobsResolved != hasBroker ||
      ![commit.recoverySnapshotHash isEqualToData:snapshotHash] ||
      ![commit.recoveryAuthorizationHash isEqualToData:authorizationHash] ||
      commit.recoveryGeneration != self.confirmation.replacementGeneration ||
      ![commit.recoveryId isEqualToString:LowerHex(self.confirmation.replacementId)] ||
      ![commit.recoverySigningPublicKey
          isEqualToData:self.confirmation.replacementSigningPublicKey] ||
      ![commit.recoveryKeyAgreementPublicKey
          isEqualToData:self.confirmation.replacementAgreementPublicKey] ||
      ![commit.recoveryWrapHash isEqualToData:replacementWrapHash])
    return NO;

  if (!self.publicEvidenceOnly) {
    uint8_t currentEEK[32] = {0};
    uint8_t replacementEEK[32] = {0};
    BOOL currentOpened = UnsealEEK(
        self.currentWrapBytes, vaultId, currentIssuer.signingPublicKey,
        currentIssuer.keyAgreementPublicKey, self.consumedAuthority, currentEEK);
    BOOL replacementOpened = UnsealEEK(
        self.authorization.replacementWrapBytes, vaultId,
        self.candidate.signingPublicKey, self.candidate.agreementPublicKey,
        self.replacementAuthority, replacementEEK);
    BOOL sameEEK = currentOpened && replacementOpened &&
                   anc_pv_memcmp(currentEEK, replacementEEK, 32) ==
                       ANC_PV_CRYPTO_OK;
    anc_pv_zeroize(currentEEK, sizeof currentEEK);
    anc_pv_zeroize(replacementEEK, sizeof replacementEEK);
    if (!sameEEK) {
      self.status = AncPrivateVaultRecoveryAuthorizationStatusEEKContinuity;
      return NO;
    }
  }

  self.result = [[AncPrivateVaultRecoveryAuthorizationResult alloc]
      initPrivateWithAuthorizationHash:authorizationHash
                           snapshotHash:snapshotHash
                      confirmationNonce:self.confirmation.nonce
                 confirmationEnvelopeId:self.confirmation.envelopeId
                             ceremonyId:self.authorization.ceremonyId
                    candidateEndpointId:self.candidate.endpointId
                    replacementWrapHash:replacementWrapHash];
  self.status = AncPrivateVaultRecoveryAuthorizationStatusOK;
  return self.result != nil;
}

@end

@interface AncPrivateVaultRecoveryPublicEvidenceVerifier ()
@property(nonatomic) AncPrivateVaultRecoveryAuthorizationVerifier *inner;
@end

@implementation AncPrivateVaultRecoveryPublicEvidenceVerifier

- (instancetype)
       initWithAuthorization:(NSData *)authorization
             currentSnapshot:(NSData *)currentSnapshot
         currentRecoveryWrap:(NSData *)currentRecoveryWrap
     trustedNowMilliseconds:(uint64_t)trustedNowMilliseconds
                       status:(AncPrivateVaultRecoveryAuthorizationStatus *)status {
  self = [super init];
  if (self == nil)
    return nil;
  _inner = [[AncPrivateVaultRecoveryAuthorizationVerifier alloc]
       initWithPublicAuthorization:authorization
                   currentSnapshot:currentSnapshot
               currentRecoveryWrap:currentRecoveryWrap
           trustedNowMilliseconds:trustedNowMilliseconds
                             status:status];
  return _inner == nil ? nil : self;
}

- (AncPrivateVaultRecoveryAuthorizationResult *)result {
  return self.inner.result;
}

- (AncPrivateVaultRecoveryAuthorizationStatus)status {
  return self.inner.status;
}

- (BOOL)verifyRecoveryMembershipCommit:
            (AncPrivateVaultControlLogMembershipCommit *)commit
                            signedEntry:
                                (AncPrivateVaultControlLogSignedEntry *)entry
                           currentState:
                               (AncPrivateVaultControlLogState *)state
                       signedEntryBytes:(NSData *)signedEntryBytes
                     innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  return [self.inner verifyRecoveryMembershipCommit:commit
                                        signedEntry:entry
                                       currentState:state
                                   signedEntryBytes:signedEntryBytes
                                 innerEnvelopeBytes:innerEnvelopeBytes];
}

@end

NSString *AncPrivateVaultRecoveryAuthorizationCategory(
    AncPrivateVaultRecoveryAuthorizationStatus status) {
  static NSArray<NSString *> *categories;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    categories = @[
      @"", @"input.invalid", @"wire.invalid_canonical", @"binding.invalid",
      @"crypto.signature", @"time.invalid", @"wrap.current",
      @"wrap.replacement", @"wrap.eek_continuity"
    ];
  });
  return status >= 0 && (NSUInteger)status < categories.count
             ? categories[status]
             : @"unknown";
}
