#import "PrivateVaultEnrollmentChallenge.h"
#import "PrivateVaultEnrollmentChallengeInternal.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultEnrollmentOffer.h"

#import <objc/runtime.h>

static const uint8_t kChallengeDomain[] = "anc/v1/enrollment-challenge";
static const uint8_t kSasDomain[] = "anc/v1/enrollment-sas";
static const uint64_t kMaxSafeInteger = UINT64_C(9007199254740991);

@interface AncPrivateVaultEnrollmentChallengeResult ()
@property(nonatomic, readwrite) NSData *encodedChallenge;
@property(nonatomic, readwrite) NSData *challengeHash;
@property(nonatomic, readwrite) NSData *sasTranscript;
@property(nonatomic, readwrite) NSData *sasTranscriptHash;
@property(nonatomic, readwrite) NSString *sasCode;
@property(nonatomic, readwrite) NSData *offerHash;
@property(nonatomic, readwrite) NSData *candidateEndpointId;
@property(nonatomic, readwrite) NSData *candidateSigningPublicKey;
@property(nonatomic, readwrite) NSData *candidateKeyAgreementPublicKey;
@property(nonatomic, readwrite) NSData *ceremonyId;
@property(nonatomic, readwrite) NSData *challengeEnvelopeId;
@property(nonatomic, readwrite) NSData *authorizerEndpointId;
@property(nonatomic, readwrite) NSData *authorizerSigningPublicKey;
@property(nonatomic, readwrite) NSData *authorizerKeyAgreementPublicKey;
@property(nonatomic, readwrite) NSString *targetMembershipRole;
@property(nonatomic, readwrite) uint64_t controlSequence;
@property(nonatomic, readwrite) uint64_t createdAt;
@property(nonatomic, readwrite) uint64_t expiresAt;
@end
@implementation AncPrivateVaultEnrollmentChallengeResult
@end

@interface AncPrivateVaultImmutableEnrollmentChallengeResult
    : AncPrivateVaultEnrollmentChallengeResult
@end

@interface AncPrivateVaultEnrollmentChallengeEvidence : NSObject
@property(nonatomic) NSData *vaultId;
@property(nonatomic) NSData *encodedChallenge;
@property(nonatomic) NSData *offerHash;
@property(nonatomic) NSData *challengeHash;
@property(nonatomic) NSData *sasTranscriptHash;
@property(nonatomic) NSData *candidateEndpointId;
@property(nonatomic) NSData *candidateSigningPublicKey;
@property(nonatomic) NSData *candidateAgreementPublicKey;
@property(nonatomic) NSData *ceremonyId;
@property(nonatomic) NSString *targetMembershipRole;
@property(nonatomic) uint64_t createdAt;
@property(nonatomic) uint64_t expiresAt;
@end
@implementation AncPrivateVaultEnrollmentChallengeEvidence
@end

static NSMapTable<AncPrivateVaultEnrollmentChallengeResult *,
                  AncPrivateVaultEnrollmentChallengeEvidence *> *
ChallengeEvidenceRegistry(void) {
  static NSMapTable *registry;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    registry = [NSMapTable weakToStrongObjectsMapTable];
  });
  return registry;
}

static NSLock *ChallengeEvidenceLock(void) {
  static NSLock *lock;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    lock = [NSLock new];
  });
  return lock;
}

static void RaiseImmutableChallenge(void) {
  [NSException raise:NSInternalInconsistencyException
              format:@"enrollment challenge results are immutable"];
}

@implementation AncPrivateVaultImmutableEnrollmentChallengeResult
- (void)setEncodedChallenge:(NSData *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setChallengeHash:(NSData *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setSasTranscript:(NSData *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setSasTranscriptHash:(NSData *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setSasCode:(NSString *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setOfferHash:(NSData *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setCandidateEndpointId:(NSData *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setCandidateSigningPublicKey:(NSData *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setCandidateKeyAgreementPublicKey:(NSData *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setCeremonyId:(NSData *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setChallengeEnvelopeId:(NSData *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setAuthorizerEndpointId:(NSData *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setAuthorizerSigningPublicKey:(NSData *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setAuthorizerKeyAgreementPublicKey:(NSData *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setTargetMembershipRole:(NSString *)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setControlSequence:(uint64_t)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setCreatedAt:(uint64_t)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setExpiresAt:(uint64_t)value {
  (void)value;
  RaiseImmutableChallenge();
}
- (void)setValue:(id)value forKey:(NSString *)key {
  (void)value;
  (void)key;
  RaiseImmutableChallenge();
}
@end

static void SetStatus(AncPrivateVaultEnrollmentChallengeStatus *status,
                      AncPrivateVaultEnrollmentChallengeStatus value) {
  if (status != NULL)
    *status = value;
}

static BOOL Exact(NSData *value, NSUInteger length) {
  return [value isKindOfClass:NSData.class] && value.length == length;
}

static AncPrivateVaultCanonicalValue *
Field(NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map,
      NSNumber *key, AncPrivateVaultCanonicalType type) {
  AncPrivateVaultCanonicalValue *value = map[key];
  return value.type == type ? value : nil;
}

static NSData *BytesFromHex(NSString *hex, NSUInteger length) {
  if (![hex isKindOfClass:NSString.class] || hex.length != length * 2)
    return nil;
  NSMutableData *result = [NSMutableData dataWithLength:length];
  uint8_t *output = result.mutableBytes;
  for (NSUInteger index = 0; index < length; index += 1) {
    unichar high = [hex characterAtIndex:index * 2];
    unichar low = [hex characterAtIndex:index * 2 + 1];
    int a = high >= '0' && high <= '9'   ? high - '0'
            : high >= 'a' && high <= 'f' ? high - 'a' + 10
                                         : -1;
    int b = low >= '0' && low <= '9'   ? low - '0'
            : low >= 'a' && low <= 'f' ? low - 'a' + 10
                                       : -1;
    if (a < 0 || b < 0)
      return nil;
    output[index] = (uint8_t)((a << 4) | b);
  }
  return result;
}

static NSString *Hex(NSData *data) {
  if (![data isKindOfClass:NSData.class])
    return nil;
  const uint8_t *bytes = data.bytes;
  NSMutableString *result =
      [NSMutableString stringWithCapacity:data.length * 2];
  for (NSUInteger index = 0; index < data.length; index += 1)
    [result appendFormat:@"%02x", bytes[index]];
  return result;
}

static BOOL Same(NSData *a, NSData *b) {
  return Exact(a, b.length) && anc_pv_memcmp(a.bytes, b.bytes, b.length) == 0;
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

static NSString *SasCode(NSData *transcriptHash) {
  if (!Exact(transcriptHash, 32))
    return nil;
  NSData *block = transcriptHash;
  uint32_t counter = 0;
  for (;;) {
    const uint8_t *bytes = block.bytes;
    uint32_t candidate = ((uint32_t)bytes[0] << 24) |
                         ((uint32_t)bytes[1] << 16) |
                         ((uint32_t)bytes[2] << 8) | bytes[3];
    if (candidate < UINT32_C(4000000000)) {
      uint32_t digits = candidate % UINT32_C(1000000000);
      return [NSString stringWithFormat:@"%03u-%03u-%03u", digits / 1000000,
                                        (digits / 1000) % 1000, digits % 1000];
    }
    uint8_t payload[36] = {0};
    memcpy(payload, transcriptHash.bytes, 32);
    payload[32] = (uint8_t)(counter >> 24);
    payload[33] = (uint8_t)(counter >> 16);
    payload[34] = (uint8_t)(counter >> 8);
    payload[35] = (uint8_t)counter;
    block = DomainHash(kSasDomain, sizeof kSasDomain,
                       [NSData dataWithBytes:payload length:sizeof payload]);
    anc_pv_zeroize(payload, sizeof payload);
    if (block == nil || counter == UINT32_MAX)
      return nil;
    counter += 1;
  }
}

AncPrivateVaultEnrollmentChallengeResult *
AncPrivateVaultEnrollmentChallengeVerify(
    NSData *encodedOffer, NSData *encodedChallenge,
    AncPrivateVaultControlLogState *state,
    uint64_t authenticatedHeadSignedAtSeconds, uint64_t nowSeconds,
    AncPrivateVaultEnrollmentChallengeStatus *status) {
  SetStatus(status, AncPrivateVaultEnrollmentChallengeStatusInvalid);
  @try {
    if (encodedChallenge.length == 0 || encodedChallenge.length > 64 * 1024 ||
        state == nil || nowSeconds == 0 ||
        authenticatedHeadSignedAtSeconds == 0 || nowSeconds > kMaxSafeInteger ||
        authenticatedHeadSignedAtSeconds > kMaxSafeInteger - 900)
      return nil;
    if (authenticatedHeadSignedAtSeconds > nowSeconds + 30) {
      SetStatus(status, AncPrivateVaultEnrollmentChallengeStatusStaleAuthority);
      return nil;
    }
    if (nowSeconds >= authenticatedHeadSignedAtSeconds + 900) {
      SetStatus(status, AncPrivateVaultEnrollmentChallengeStatusStaleAuthority);
      return nil;
    }
    NSData *vaultId = BytesFromHex(state.vaultId, 16);
    if (vaultId == nil || !Exact(state.headHash, 32) ||
        !Exact(state.membershipHash, 32))
      return nil;
    AncPrivateVaultCanonicalStatus canonicalStatus;
    AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
        encodedChallenge, 64 * 1024, &canonicalStatus);
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map =
        root.type == AncPrivateVaultCanonicalTypeMap ? root.mapValue : nil;
    NSSet<NSNumber *> *keys = [NSSet setWithArray:@[
      @1, @2, @3, @4, @5, @170, @171, @172, @173, @174, @175, @176, @177, @178,
      @179, @180, @181, @182
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
    AncPrivateVaultCanonicalValue *offerHash =
        Field(map, @170, AncPrivateVaultCanonicalTypeBytes);
    AncPrivateVaultCanonicalValue *proof =
        Field(map, @171, AncPrivateVaultCanonicalTypeBytes);
    AncPrivateVaultCanonicalValue *authorizerId =
        Field(map, @172, AncPrivateVaultCanonicalTypeBytes);
    AncPrivateVaultCanonicalValue *authorizerSigning =
        Field(map, @173, AncPrivateVaultCanonicalTypeBytes);
    AncPrivateVaultCanonicalValue *authorizerAgreement =
        Field(map, @174, AncPrivateVaultCanonicalTypeBytes);
    AncPrivateVaultCanonicalValue *sequence =
        Field(map, @175, AncPrivateVaultCanonicalTypeInteger);
    AncPrivateVaultCanonicalValue *head =
        Field(map, @176, AncPrivateVaultCanonicalTypeBytes);
    AncPrivateVaultCanonicalValue *membership =
        Field(map, @177, AncPrivateVaultCanonicalTypeBytes);
    AncPrivateVaultCanonicalValue *role =
        Field(map, @178, AncPrivateVaultCanonicalTypeText);
    AncPrivateVaultCanonicalValue *sasHash =
        Field(map, @179, AncPrivateVaultCanonicalTypeBytes);
    AncPrivateVaultCanonicalValue *nonce =
        Field(map, @180, AncPrivateVaultCanonicalTypeBytes);
    AncPrivateVaultCanonicalValue *expires =
        Field(map, @181, AncPrivateVaultCanonicalTypeInteger);
    AncPrivateVaultCanonicalValue *signature =
        Field(map, @182, AncPrivateVaultCanonicalTypeBytes);
    BOOL broker = [role.textValue isEqualToString:@"broker"];
    BOOL valid =
        suite != nil && [suite.textValue isEqualToString:@"anc/v1"] &&
        vault != nil && Same(vault.bytesValue, vaultId) && type != nil &&
        [type.textValue isEqualToString:@"enrollment-challenge"] &&
        created != nil && created.integerValue > 0 &&
        (uint64_t)created.integerValue <= kMaxSafeInteger && envelope != nil &&
        Exact(envelope.bytesValue, 16) && offerHash != nil &&
        Exact(offerHash.bytesValue, 32) && proof != nil &&
        Exact(proof.bytesValue, 64) && authorizerId != nil &&
        Exact(authorizerId.bytesValue, 16) && authorizerSigning != nil &&
        Exact(authorizerSigning.bytesValue, 32) && authorizerAgreement != nil &&
        Exact(authorizerAgreement.bytesValue, 32) && sequence != nil &&
        sequence.integerValue >= 0 &&
        (uint64_t)sequence.integerValue <= kMaxSafeInteger && head != nil &&
        Exact(head.bytesValue, 32) && membership != nil &&
        Exact(membership.bytesValue, 32) && role != nil &&
        (broker || [role.textValue isEqualToString:@"endpoint"]) &&
        sasHash != nil && Exact(sasHash.bytesValue, 32) && nonce != nil &&
        Exact(nonce.bytesValue, 32) && expires != nil &&
        expires.integerValue > created.integerValue &&
        (uint64_t)expires.integerValue <= kMaxSafeInteger &&
        expires.integerValue - created.integerValue <= 600 &&
        signature != nil && Exact(signature.bytesValue, 64);
    if (!valid)
      return nil;
    uint64_t createdAt = (uint64_t)created.integerValue;
    uint64_t expiresAt = (uint64_t)expires.integerValue;
    if (createdAt > nowSeconds || expiresAt < nowSeconds ||
        expiresAt > authenticatedHeadSignedAtSeconds + 900) {
      SetStatus(status, AncPrivateVaultEnrollmentChallengeStatusExpired);
      return nil;
    }
    AncPrivateVaultEnrollmentOfferStatus offerStatus;
    AncPrivateVaultEnrollmentOfferResult *offer =
        AncPrivateVaultEnrollmentOfferVerify(encodedOffer, proof.bytesValue,
                                             vaultId, &offerStatus);
    if (offer == nil) {
      SetStatus(status,
                offerStatus == AncPrivateVaultEnrollmentOfferStatusCryptoFailed
                    ? AncPrivateVaultEnrollmentChallengeStatusInvalidSignature
                    : AncPrivateVaultEnrollmentChallengeStatusInvalid);
      return nil;
    }
    if (offer.createdAt > nowSeconds || offer.expiresAt < nowSeconds ||
        createdAt < offer.createdAt || createdAt > offer.expiresAt ||
        !Same(offer.offerHash, offerHash.bytesValue) ||
        ![offer.membershipRole isEqualToString:role.textValue]) {
      SetStatus(status, AncPrivateVaultEnrollmentChallengeStatusConflict);
      return nil;
    }
    NSString *candidateId = Hex(offer.endpointId);
    if ([state.removedEndpointIds containsObject:candidateId]) {
      SetStatus(status, AncPrivateVaultEnrollmentChallengeStatusConflict);
      return nil;
    }
    for (AncPrivateVaultControlLogMember *member in state.activeMembers) {
      if ([member.endpointId isEqualToString:candidateId] ||
          (broker && [member.role isEqualToString:@"broker"])) {
        SetStatus(status, AncPrivateVaultEnrollmentChallengeStatusConflict);
        return nil;
      }
    }
    NSString *authorizerHex = Hex(authorizerId.bytesValue);
    AncPrivateVaultControlLogMember *authorizer = nil;
    for (AncPrivateVaultControlLogMember *member in state.activeMembers)
      if ([member.endpointId isEqualToString:authorizerHex]) {
        authorizer = member;
        break;
      }
    if (authorizer == nil || ![authorizer.role isEqualToString:@"endpoint"] ||
        authorizer.unattended ||
        !Same(authorizer.signingPublicKey, authorizerSigning.bytesValue) ||
        !Same(authorizer.keyAgreementPublicKey,
              authorizerAgreement.bytesValue) ||
        (uint64_t)sequence.integerValue != state.sequence ||
        !Same(head.bytesValue, state.headHash) ||
        !Same(membership.bytesValue, state.membershipHash)) {
      SetStatus(status, AncPrivateVaultEnrollmentChallengeStatusConflict);
      return nil;
    }
    NSMutableDictionary *unsignedMap = [map mutableCopy];
    [unsignedMap removeObjectForKey:@182];
    NSData *unsignedChallenge = AncPrivateVaultCanonicalEncode(
        [AncPrivateVaultCanonicalValue map:unsignedMap], &canonicalStatus);
    if (unsignedChallenge == nil) {
      SetStatus(status, AncPrivateVaultEnrollmentChallengeStatusCryptoFailed);
      return nil;
    }
    NSMutableData *signedMessage =
        [NSMutableData dataWithBytes:kChallengeDomain
                              length:sizeof kChallengeDomain];
    [signedMessage appendData:unsignedChallenge];
    BOOL signatureValid =
        anc_pv_ed25519_verify(signature.bytesValue.bytes, signedMessage.bytes,
                              signedMessage.length,
                              authorizerSigning.bytesValue.bytes) ==
        ANC_PV_CRYPTO_OK;
    anc_pv_zeroize(signedMessage.mutableBytes, signedMessage.length);
    if (!signatureValid) {
      SetStatus(status,
                AncPrivateVaultEnrollmentChallengeStatusInvalidSignature);
      return nil;
    }
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *sasMap = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue bytes:vaultId],
      @3 : [AncPrivateVaultCanonicalValue text:@"enrollment-sas"],
      @320 : [AncPrivateVaultCanonicalValue bytes:offer.ceremonyId],
      @321 : [AncPrivateVaultCanonicalValue bytes:offerHash.bytesValue],
      @322 : [AncPrivateVaultCanonicalValue bytes:offer.endpointId],
      @323 : [AncPrivateVaultCanonicalValue bytes:offer.signingPublicKey],
      @324 : [AncPrivateVaultCanonicalValue bytes:offer.keyAgreementPublicKey],
      @325 : [AncPrivateVaultCanonicalValue bytes:proof.bytesValue],
      @326 : [AncPrivateVaultCanonicalValue bytes:authorizerId.bytesValue],
      @327 : [AncPrivateVaultCanonicalValue bytes:authorizerSigning.bytesValue],
      @328 :
          [AncPrivateVaultCanonicalValue bytes:authorizerAgreement.bytesValue],
      @329 : [AncPrivateVaultCanonicalValue integer:sequence.integerValue],
      @330 : [AncPrivateVaultCanonicalValue bytes:head.bytesValue],
      @331 : [AncPrivateVaultCanonicalValue bytes:membership.bytesValue],
      @332 : [AncPrivateVaultCanonicalValue text:role.textValue],
      @333 : [AncPrivateVaultCanonicalValue bytes:nonce.bytesValue],
      @334 : [AncPrivateVaultCanonicalValue bytes:envelope.bytesValue],
      @335 : [AncPrivateVaultCanonicalValue integer:created.integerValue],
      @336 : [AncPrivateVaultCanonicalValue integer:expires.integerValue],
    };
    NSData *sasTranscript = AncPrivateVaultCanonicalEncode(
        [AncPrivateVaultCanonicalValue map:sasMap], &canonicalStatus);
    NSData *computedSasHash =
        sasTranscript == nil
            ? nil
            : DomainHash(kSasDomain, sizeof kSasDomain, sasTranscript);
    if (computedSasHash == nil || !Same(computedSasHash, sasHash.bytesValue)) {
      SetStatus(status, AncPrivateVaultEnrollmentChallengeStatusConflict);
      return nil;
    }
    NSData *challengeHash =
        DomainHash(kChallengeDomain, sizeof kChallengeDomain, encodedChallenge);
    NSString *sasCode = SasCode(computedSasHash);
    if (challengeHash == nil || sasCode == nil) {
      SetStatus(status, AncPrivateVaultEnrollmentChallengeStatusCryptoFailed);
      return nil;
    }
    AncPrivateVaultEnrollmentChallengeResult *result =
        class_createInstance(AncPrivateVaultEnrollmentChallengeResult.class, 0);
    result.encodedChallenge = [encodedChallenge copy];
    result.challengeHash = challengeHash;
    result.sasTranscript = sasTranscript;
    result.sasTranscriptHash = computedSasHash;
    result.sasCode = sasCode;
    result.offerHash = [offerHash.bytesValue copy];
    result.candidateEndpointId = [offer.endpointId copy];
    result.candidateSigningPublicKey = [offer.signingPublicKey copy];
    result.candidateKeyAgreementPublicKey = [offer.keyAgreementPublicKey copy];
    result.ceremonyId = [offer.ceremonyId copy];
    result.challengeEnvelopeId = [envelope.bytesValue copy];
    result.authorizerEndpointId = [authorizerId.bytesValue copy];
    result.authorizerSigningPublicKey = [authorizerSigning.bytesValue copy];
    result.authorizerKeyAgreementPublicKey =
        [authorizerAgreement.bytesValue copy];
    result.targetMembershipRole = [role.textValue copy];
    result.controlSequence = (uint64_t)sequence.integerValue;
    result.createdAt = createdAt;
    result.expiresAt = expiresAt;
    AncPrivateVaultEnrollmentChallengeEvidence *evidence =
        [AncPrivateVaultEnrollmentChallengeEvidence new];
    evidence.vaultId = [vaultId copy];
    evidence.encodedChallenge = [result.encodedChallenge copy];
    evidence.offerHash = [result.offerHash copy];
    evidence.challengeHash = [result.challengeHash copy];
    evidence.sasTranscriptHash = [result.sasTranscriptHash copy];
    evidence.candidateEndpointId = [result.candidateEndpointId copy];
    evidence.candidateSigningPublicKey =
        [result.candidateSigningPublicKey copy];
    evidence.candidateAgreementPublicKey =
        [result.candidateKeyAgreementPublicKey copy];
    evidence.ceremonyId = [result.ceremonyId copy];
    evidence.targetMembershipRole = [result.targetMembershipRole copy];
    evidence.createdAt = result.createdAt;
    evidence.expiresAt = result.expiresAt;
    NSLock *evidenceLock = ChallengeEvidenceLock();
    [evidenceLock lock];
    @try {
      if (ChallengeEvidenceRegistry().count >= 1024) {
        SetStatus(status, AncPrivateVaultEnrollmentChallengeStatusCryptoFailed);
        return nil;
      }
      [ChallengeEvidenceRegistry() setObject:evidence forKey:result];
    } @finally {
      [evidenceLock unlock];
    }
    object_setClass(result,
                    AncPrivateVaultImmutableEnrollmentChallengeResult.class);
    SetStatus(status, AncPrivateVaultEnrollmentChallengeStatusOK);
    return result;
  } @catch (__unused NSException *exception) {
    SetStatus(status, AncPrivateVaultEnrollmentChallengeStatusInvalid);
    return nil;
  }
}

BOOL AncPrivateVaultEnrollmentChallengeCopyEvidence(
    AncPrivateVaultEnrollmentChallengeResult *result, NSData **vaultId,
    NSData **encodedChallenge, NSData **offerHash, NSData **challengeHash,
    NSData **sasTranscriptHash, NSData **candidateEndpointId,
    NSData **candidateSigningPublicKey, NSData **candidateAgreementPublicKey,
    NSData **ceremonyId, NSString **targetMembershipRole, uint64_t *createdAt,
    uint64_t *expiresAt) {
  if (vaultId == NULL || encodedChallenge == NULL || offerHash == NULL ||
      challengeHash == NULL || sasTranscriptHash == NULL ||
      candidateEndpointId == NULL || candidateSigningPublicKey == NULL ||
      candidateAgreementPublicKey == NULL || ceremonyId == NULL ||
      targetMembershipRole == NULL || createdAt == NULL || expiresAt == NULL)
    return NO;
  *vaultId = nil;
  *encodedChallenge = nil;
  *offerHash = nil;
  *challengeHash = nil;
  *sasTranscriptHash = nil;
  *candidateEndpointId = nil;
  *candidateSigningPublicKey = nil;
  *candidateAgreementPublicKey = nil;
  *ceremonyId = nil;
  *targetMembershipRole = nil;
  *createdAt = 0;
  *expiresAt = 0;
  if (result == nil ||
      object_getClass(result) !=
          AncPrivateVaultImmutableEnrollmentChallengeResult.class)
    return NO;
  NSLock *lock = ChallengeEvidenceLock();
  [lock lock];
  AncPrivateVaultEnrollmentChallengeEvidence *evidence =
      [ChallengeEvidenceRegistry() objectForKey:result];
  [lock unlock];
  if (evidence == nil)
    return NO;
  @try {
    if (![result.encodedChallenge isEqualToData:evidence.encodedChallenge] ||
        ![result.offerHash isEqualToData:evidence.offerHash] ||
        ![result.challengeHash isEqualToData:evidence.challengeHash] ||
        ![result.sasTranscriptHash isEqualToData:evidence.sasTranscriptHash] ||
        ![result.candidateEndpointId
            isEqualToData:evidence.candidateEndpointId] ||
        ![result.candidateSigningPublicKey
            isEqualToData:evidence.candidateSigningPublicKey] ||
        ![result.candidateKeyAgreementPublicKey
            isEqualToData:evidence.candidateAgreementPublicKey] ||
        ![result.ceremonyId isEqualToData:evidence.ceremonyId] ||
        ![result.targetMembershipRole
            isEqualToString:evidence.targetMembershipRole] ||
        result.createdAt != evidence.createdAt ||
        result.expiresAt != evidence.expiresAt)
      return NO;
    *vaultId = [evidence.vaultId copy];
    *encodedChallenge = [evidence.encodedChallenge copy];
    *offerHash = [evidence.offerHash copy];
    *challengeHash = [evidence.challengeHash copy];
    *sasTranscriptHash = [evidence.sasTranscriptHash copy];
    *candidateEndpointId = [evidence.candidateEndpointId copy];
    *candidateSigningPublicKey = [evidence.candidateSigningPublicKey copy];
    *candidateAgreementPublicKey = [evidence.candidateAgreementPublicKey copy];
    *ceremonyId = [evidence.ceremonyId copy];
    *targetMembershipRole = [evidence.targetMembershipRole copy];
    *createdAt = evidence.createdAt;
    *expiresAt = evidence.expiresAt;
    return YES;
  } @catch (__unused NSException *exception) {
    return NO;
  }
}
