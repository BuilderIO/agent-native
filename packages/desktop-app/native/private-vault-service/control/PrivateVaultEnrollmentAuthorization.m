#import "PrivateVaultEnrollmentAuthorization.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

#import <objc/runtime.h>

static const uint8_t kAuthorizationDomain[] =
    "anc/v1/enrollment-authorization";
static const uint8_t kEndpointDomain[] = "anc/v1/endpoint";
static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);

@interface AncPrivateVaultParsedEnrollmentAuthorization : NSObject
@property(nonatomic) NSData *encoded;
@property(nonatomic) NSData *digest;
@property(nonatomic) NSData *vaultId;
@property(nonatomic) uint64_t createdAt;
@property(nonatomic) NSData *envelopeId;
@property(nonatomic) NSData *offerHash;
@property(nonatomic) NSData *challengeHash;
@property(nonatomic) NSData *authorizerEndpointId;
@property(nonatomic) NSString *targetMembershipRole;
@property(nonatomic) uint64_t previousControlSequence;
@property(nonatomic) NSData *previousControlHeadHash;
@property(nonatomic) NSData *previousMembershipHash;
@property(nonatomic) NSData *endpointEnvelope;
@property(nonatomic) NSData *eekWrapEnvelope;
@property(nonatomic) NSData *signedMembershipCommit;
@property(nonatomic) uint64_t expiresAt;
@end
@implementation AncPrivateVaultParsedEnrollmentAuthorization
@end

@interface AncPrivateVaultParsedCandidateEndpoint : NSObject
@property(nonatomic) NSData *endpointId;
@property(nonatomic) BOOL unattended;
@property(nonatomic) NSData *signingPublicKey;
@property(nonatomic) NSData *keyAgreementPublicKey;
@property(nonatomic) NSData *addedByEndpointId;
@property(nonatomic) NSData *sasTranscriptHash;
@end
@implementation AncPrivateVaultParsedCandidateEndpoint
@end

@interface AncPrivateVaultEnrollmentAuthorizationResult ()
    <AncPrivateVaultControlLogAuthorizationVerifier>
@property(nonatomic, readwrite) NSData *encodedAuthorization;
@property(nonatomic, readwrite) NSData *authorizationDigest;
@property(nonatomic, readwrite) NSData *authorizationEnvelopeId;
@property(nonatomic, readwrite) NSData *endpointEnvelope;
@property(nonatomic, readwrite) NSData *eekWrapEnvelope;
@property(nonatomic, readwrite) NSData *signedMembershipCommit;
@property(nonatomic, readwrite) AncPrivateVaultEnrollmentChallengeResult
    *challenge;
@property(nonatomic, readwrite) AncPrivateVaultControlLogReplayResult *replay;
@property(nonatomic) AncPrivateVaultParsedEnrollmentAuthorization *parsed;
@property(nonatomic) AncPrivateVaultParsedCandidateEndpoint *candidate;
@property(nonatomic) BOOL callbackAccepted;
@end

static void SetStatus(AncPrivateVaultEnrollmentAuthorizationStatus *status,
                      AncPrivateVaultEnrollmentAuthorizationStatus value) {
  if (status != NULL)
    *status = value;
}

static BOOL Exact(NSData *value, NSUInteger length) {
  return [value isKindOfClass:NSData.class] && value.length == length;
}

static BOOL Same(NSData *left, NSData *right) {
  return Exact(left, right.length) && right.length > 0 &&
         anc_pv_memcmp(left.bytes, right.bytes, right.length) ==
             ANC_PV_CRYPTO_OK;
}

static AncPrivateVaultCanonicalValue *Field(
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map,
    NSNumber *key, AncPrivateVaultCanonicalType type) {
  AncPrivateVaultCanonicalValue *value = map[key];
  return value.type == type ? value : nil;
}

static BOOL ExactKeys(NSDictionary<NSNumber *, id> *map,
                      NSArray<NSNumber *> *keys) {
  return map.count == keys.count &&
         [[NSSet setWithArray:map.allKeys]
             isEqualToSet:[NSSet setWithArray:keys]];
}

static NSString *Hex(NSData *data) {
  if (![data isKindOfClass:NSData.class])
    return nil;
  const uint8_t *bytes = data.bytes;
  NSMutableString *value =
      [NSMutableString stringWithCapacity:data.length * 2];
  for (NSUInteger index = 0; index < data.length; index += 1)
    [value appendFormat:@"%02x", bytes[index]];
  return value;
}

static NSData *BytesFromHex(NSString *hex, NSUInteger length) {
  if (![hex isKindOfClass:NSString.class] || hex.length != length * 2)
    return nil;
  NSMutableData *result = [NSMutableData dataWithLength:length];
  uint8_t *bytes = result.mutableBytes;
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
    bytes[index] = (uint8_t)((a << 4) | b);
  }
  return result;
}

static NSData *DomainHash(const uint8_t *domain, size_t domainLength,
                          NSData *payload) {
  uint8_t digest[32] = {0};
  BOOL ok = payload != nil &&
            anc_pv_blake2b_256_two_part(digest, domain, domainLength,
                                        payload.bytes, payload.length) ==
                ANC_PV_CRYPTO_OK;
  NSData *result = ok ? [NSData dataWithBytes:digest length:sizeof digest] : nil;
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *CanonicalMap(
    NSData *encoded, NSUInteger maximum) {
  if (![encoded isKindOfClass:NSData.class] || encoded.length == 0 ||
      encoded.length > maximum)
    return nil;
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root =
      AncPrivateVaultCanonicalDecode(encoded, maximum, &status);
  return root.type == AncPrivateVaultCanonicalTypeMap ? root.mapValue : nil;
}

static BOOL VerifyDomainSignature(
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map,
    NSNumber *signatureKey, NSData *signature, NSData *publicKey,
    const uint8_t *domain, size_t domainLength) {
  if (!Exact(signature, 64) || !Exact(publicKey, 32))
    return NO;
  NSMutableDictionary *unsignedMap = [map mutableCopy];
  [unsignedMap removeObjectForKey:signatureKey];
  AncPrivateVaultCanonicalStatus status;
  NSData *unsignedBytes = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:unsignedMap], &status);
  if (unsignedBytes == nil)
    return NO;
  NSMutableData *message =
      [NSMutableData dataWithBytes:domain length:domainLength];
  [message appendData:unsignedBytes];
  BOOL verified = anc_pv_ed25519_verify(
                      signature.bytes, message.bytes, message.length,
                      publicKey.bytes) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(message.mutableBytes, message.length);
  return verified;
}

static AncPrivateVaultParsedEnrollmentAuthorization *ParseAuthorization(
    NSData *encoded, NSData *expectedVaultId, NSData *authorizerSigningKey,
    AncPrivateVaultEnrollmentAuthorizationStatus *status) {
  NSDictionary *map = CanonicalMap(encoded, 256 * 1024);
  NSArray *keys = @[
    @1, @2, @3, @4, @5, @300, @301, @302, @303, @304, @305, @306,
    @307, @308, @309, @310, @311
  ];
  if (!ExactKeys(map, keys))
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
  AncPrivateVaultCanonicalValue *role =
      Field(map, @303, AncPrivateVaultCanonicalTypeText);
  AncPrivateVaultCanonicalValue *sequence =
      Field(map, @304, AncPrivateVaultCanonicalTypeInteger);
  AncPrivateVaultCanonicalValue *expires =
      Field(map, @310, AncPrivateVaultCanonicalTypeInteger);
  NSData *offerHash = Field(map, @300, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *challengeHash =
      Field(map, @301, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *authorizer = Field(map, @302, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *head = Field(map, @305, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *membership =
      Field(map, @306, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *endpoint = Field(map, @307, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *eek = Field(map, @308, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *commit = Field(map, @309, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *signature = Field(map, @311, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  BOOL valid = [suite.textValue isEqualToString:@"anc/v1"] &&
               [type.textValue isEqualToString:@"enrollment-authorization"] &&
               Exact(vault.bytesValue, 16) && Same(vault.bytesValue, expectedVaultId) &&
               created.integerValue >= 0 &&
               (uint64_t)created.integerValue <= kMaximumSafeInteger &&
               Exact(envelope.bytesValue, 16) && Exact(offerHash, 32) &&
               Exact(challengeHash, 32) && Exact(authorizer, 16) &&
               ([role.textValue isEqualToString:@"endpoint"] ||
                [role.textValue isEqualToString:@"broker"]) &&
               sequence.integerValue >= 0 &&
               (uint64_t)sequence.integerValue <= kMaximumSafeInteger &&
               Exact(head, 32) && Exact(membership, 32) &&
               endpoint.length > 0 && endpoint.length <= 65536 &&
               eek.length > 0 && eek.length <= 65536 &&
               commit.length > 0 && commit.length <= 65536 &&
               CanonicalMap(endpoint, 65536) != nil &&
               CanonicalMap(eek, 65536) != nil &&
               CanonicalMap(commit, 65536) != nil &&
               expires.integerValue >= 1 &&
               (uint64_t)expires.integerValue <= kMaximumSafeInteger &&
               expires.integerValue > created.integerValue &&
               expires.integerValue - created.integerValue <= 600 &&
               Exact(signature, 64);
  if (!valid)
    return nil;
  if (!VerifyDomainSignature(map, @311, signature, authorizerSigningKey,
                             kAuthorizationDomain,
                             sizeof kAuthorizationDomain)) {
    SetStatus(status,
              AncPrivateVaultEnrollmentAuthorizationStatusInvalidSignature);
    return nil;
  }
  NSData *digest = DomainHash(kAuthorizationDomain,
                              sizeof kAuthorizationDomain, encoded);
  if (digest == nil) {
    SetStatus(status, AncPrivateVaultEnrollmentAuthorizationStatusCryptoFailed);
    return nil;
  }
  AncPrivateVaultParsedEnrollmentAuthorization *result =
      [AncPrivateVaultParsedEnrollmentAuthorization new];
  result.encoded = [encoded copy];
  result.digest = digest;
  result.vaultId = [vault.bytesValue copy];
  result.createdAt = (uint64_t)created.integerValue;
  result.envelopeId = [envelope.bytesValue copy];
  result.offerHash = [offerHash copy];
  result.challengeHash = [challengeHash copy];
  result.authorizerEndpointId = [authorizer copy];
  result.targetMembershipRole = [role.textValue copy];
  result.previousControlSequence = (uint64_t)sequence.integerValue;
  result.previousControlHeadHash = [head copy];
  result.previousMembershipHash = [membership copy];
  result.endpointEnvelope = [endpoint copy];
  result.eekWrapEnvelope = [eek copy];
  result.signedMembershipCommit = [commit copy];
  result.expiresAt = (uint64_t)expires.integerValue;
  return result;
}

static AncPrivateVaultParsedCandidateEndpoint *ParseCandidateEndpoint(
    NSData *encoded, NSData *expectedVaultId, NSData *authorizerSigningKey) {
  NSDictionary *map = CanonicalMap(encoded, 65536);
  NSArray *keys = @[ @1, @2, @3, @4, @5, @10, @11, @12, @13, @14,
                     @15, @16, @17 ];
  if (!ExactKeys(map, keys) ||
      ![Field(map, @1, AncPrivateVaultCanonicalTypeText).textValue
          isEqualToString:@"anc/v1"] ||
      !Same(Field(map, @2, AncPrivateVaultCanonicalTypeBytes).bytesValue,
            expectedVaultId) ||
      ![Field(map, @3, AncPrivateVaultCanonicalTypeText).textValue
          isEqualToString:@"endpoint"])
    return nil;
  AncPrivateVaultCanonicalValue *created =
      Field(map, @4, AncPrivateVaultCanonicalTypeInteger);
  NSString *software = Field(map, @11, AncPrivateVaultCanonicalTypeText).textValue;
  AncPrivateVaultCanonicalValue *unattended =
      Field(map, @12, AncPrivateVaultCanonicalTypeBoolean);
  NSData *signature = Field(map, @17, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *endpoint = Field(map, @10, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *signing = Field(map, @13, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *agreement = Field(map, @14, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *addedBy = Field(map, @15, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *sas = Field(map, @16, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  if (created.integerValue < 0 ||
      (uint64_t)created.integerValue > kMaximumSafeInteger ||
      !Exact(Field(map, @5, AncPrivateVaultCanonicalTypeBytes).bytesValue, 16) ||
      software.length == 0 || software.length > 64 || unattended == nil ||
      !Exact(endpoint, 16) || !Exact(signing, 32) || !Exact(agreement, 32) ||
      !Exact(addedBy, 16) || !Exact(sas, 32) || !Exact(signature, 64) ||
      !VerifyDomainSignature(map, @17, signature, authorizerSigningKey,
                             kEndpointDomain, sizeof kEndpointDomain))
    return nil;
  AncPrivateVaultParsedCandidateEndpoint *result =
      [AncPrivateVaultParsedCandidateEndpoint new];
  result.endpointId = [endpoint copy];
  result.unattended = unattended.booleanValue;
  result.signingPublicKey = [signing copy];
  result.keyAgreementPublicKey = [agreement copy];
  result.addedByEndpointId = [addedBy copy];
  result.sasTranscriptHash = [sas copy];
  return result;
}

static BOOL SameMember(AncPrivateVaultControlLogMember *left,
                       AncPrivateVaultControlLogMember *right) {
  return [left.endpointId isEqualToString:right.endpointId] &&
         [left.role isEqualToString:right.role] &&
         left.unattended == right.unattended &&
         Same(left.signingPublicKey, right.signingPublicKey) &&
         Same(left.keyAgreementPublicKey, right.keyAgreementPublicKey) &&
         [left.enrollmentRef isEqualToString:right.enrollmentRef];
}

@implementation AncPrivateVaultEnrollmentAuthorizationResult

- (BOOL)verifyEnrollmentMembershipCommit:
            (AncPrivateVaultControlLogMembershipCommit *)commit
                              signedEntry:
                                  (AncPrivateVaultControlLogSignedEntry *)entry
                             currentState:
                                 (AncPrivateVaultControlLogState *)state
                         signedEntryBytes:(NSData *)signedEntryBytes
                       innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  (void)innerEnvelopeBytes;
  if (self.callbackAccepted || commit == nil || entry == nil || state == nil ||
      ![signedEntryBytes isEqualToData:self.signedMembershipCommit])
    return NO;
  NSString *candidateId = Hex(self.challenge.candidateEndpointId);
  NSString *authorizerId = Hex(self.challenge.authorizerEndpointId);
  NSString *ceremonyId = Hex(self.challenge.ceremonyId);
  NSString *enrollmentRef = Hex(self.authorizationEnvelopeId);
  NSString *expectedKind =
      [self.parsed.targetMembershipRole isEqualToString:@"broker"]
          ? @"add_broker"
          : @"add_device";
  if (candidateId == nil || authorizerId == nil || ceremonyId == nil ||
      enrollmentRef == nil || ![commit.vaultId isEqualToString:state.vaultId] ||
      ![commit.ceremonyId isEqualToString:ceremonyId] ||
      ![commit.ceremonyKind isEqualToString:expectedKind] ||
      commit.epoch != state.epoch ||
      !Same(commit.previousMembershipHash, state.membershipHash) ||
      commit.removedEndpointIds.count != 0 || commit.rotationCompleted ||
      commit.outstandingJobsResolved || commit.recoverySnapshotHash != nil ||
      commit.recoveryAuthorizationHash != nil ||
      commit.recoveryGeneration != state.recoveryGeneration ||
      ![commit.recoveryId isEqualToString:state.recoveryId] ||
      !Same(commit.recoverySigningPublicKey,
            state.recoverySigningPublicKey) ||
      !Same(commit.recoveryKeyAgreementPublicKey,
            state.recoveryKeyAgreementPublicKey) ||
      !Same(commit.recoveryWrapHash, state.recoveryWrapHash) ||
      state.sequence == kMaximumSafeInteger || entry.sequence != state.sequence + 1 ||
      ![entry.vaultId isEqualToString:state.vaultId] ||
      ![entry.signerEndpointId isEqualToString:authorizerId] ||
      !Same(entry.previousHash, state.headHash) ||
      commit.activeMembers.count != state.activeMembers.count + 1)
    return NO;
  AncPrivateVaultControlLogMember *candidate = nil;
  for (AncPrivateVaultControlLogMember *member in commit.activeMembers) {
    if ([member.endpointId isEqualToString:candidateId]) {
      if (candidate != nil)
        return NO;
      candidate = member;
      continue;
    }
    AncPrivateVaultControlLogMember *prior = nil;
    for (AncPrivateVaultControlLogMember *value in state.activeMembers)
      if ([value.endpointId isEqualToString:member.endpointId]) {
        prior = value;
        break;
      }
    if (prior == nil || !SameMember(member, prior))
      return NO;
  }
  BOOL accepted = candidate != nil &&
                  [candidate.role isEqualToString:self.parsed.targetMembershipRole] &&
                  candidate.unattended == self.candidate.unattended &&
                  [candidate.enrollmentRef isEqualToString:enrollmentRef] &&
                  Same(candidate.signingPublicKey,
                       self.challenge.candidateSigningPublicKey) &&
                  Same(candidate.keyAgreementPublicKey,
                       self.challenge.candidateKeyAgreementPublicKey);
  self.callbackAccepted = accepted;
  return accepted;
}

- (AncPrivateVaultEekWrapStatus)
    openEEKWithRecipientBoxSeed:(const uint8_t *)recipientBoxSeed
                       consumer:(AncPrivateVaultEekConsumer)consumer {
  return AncPrivateVaultEekWrapOpen(
      self.eekWrapEnvelope, self.parsed.vaultId,
      self.challenge.candidateEndpointId,
      self.challenge.authorizerEndpointId, self.replay.state.epoch,
      self.challenge.authorizerSigningPublicKey,
      self.challenge.authorizerKeyAgreementPublicKey,
      self.challenge.candidateKeyAgreementPublicKey, recipientBoxSeed,
      consumer);
}
@end

AncPrivateVaultEnrollmentAuthorizationResult *
AncPrivateVaultEnrollmentAuthorizationVerify(
    NSData *encodedOffer, NSData *encodedChallenge,
    NSData *encodedAuthorization, AncPrivateVaultControlLogState *controlState,
    uint64_t authenticatedHeadSignedAtSeconds, uint64_t nowSeconds,
    AncPrivateVaultControlLog *controlLog,
    AncPrivateVaultEnrollmentAuthorizationStatus *status) {
  SetStatus(status, AncPrivateVaultEnrollmentAuthorizationStatusInvalid);
  @try {
    if (controlLog == nil || nowSeconds == 0 ||
        nowSeconds > kMaximumSafeInteger)
      return nil;
    AncPrivateVaultEnrollmentChallengeStatus challengeStatus;
    AncPrivateVaultEnrollmentChallengeResult *challenge =
        AncPrivateVaultEnrollmentChallengeVerify(
            encodedOffer, encodedChallenge, controlState,
            authenticatedHeadSignedAtSeconds, nowSeconds, &challengeStatus);
    if (challenge == nil) {
      SetStatus(status,
                challengeStatus == AncPrivateVaultEnrollmentChallengeStatusExpired
                    ? AncPrivateVaultEnrollmentAuthorizationStatusExpired
                    : AncPrivateVaultEnrollmentAuthorizationStatusBindingMismatch);
      return nil;
    }
    NSData *vaultId = BytesFromHex(controlState.vaultId, 16);
    AncPrivateVaultParsedEnrollmentAuthorization *authorization =
        ParseAuthorization(encodedAuthorization, vaultId,
                           challenge.authorizerSigningPublicKey, status);
    if (authorization == nil)
      return nil;
    if (nowSeconds > authorization.expiresAt ||
        authorization.createdAt < challenge.createdAt ||
        authorization.createdAt > challenge.expiresAt) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizationStatusExpired);
      return nil;
    }
    BOOL bound = Same(authorization.offerHash, challenge.offerHash) &&
                 Same(authorization.challengeHash, challenge.challengeHash) &&
                 Same(authorization.authorizerEndpointId,
                      challenge.authorizerEndpointId) &&
                 [authorization.targetMembershipRole
                     isEqualToString:challenge.targetMembershipRole] &&
                 authorization.previousControlSequence == controlState.sequence &&
                 Same(authorization.previousControlHeadHash,
                      controlState.headHash) &&
                 Same(authorization.previousMembershipHash,
                      controlState.membershipHash);
    if (!bound) {
      SetStatus(status,
                AncPrivateVaultEnrollmentAuthorizationStatusBindingMismatch);
      return nil;
    }
    AncPrivateVaultParsedCandidateEndpoint *candidate =
        ParseCandidateEndpoint(authorization.endpointEnvelope, vaultId,
                               challenge.authorizerSigningPublicKey);
    if (candidate == nil ||
        !Same(candidate.endpointId, challenge.candidateEndpointId) ||
        !Same(candidate.signingPublicKey,
              challenge.candidateSigningPublicKey) ||
        !Same(candidate.keyAgreementPublicKey,
              challenge.candidateKeyAgreementPublicKey) ||
        !Same(candidate.addedByEndpointId,
              challenge.authorizerEndpointId) ||
        !Same(candidate.sasTranscriptHash, challenge.sasTranscriptHash) ||
        candidate.unattended !=
            [authorization.targetMembershipRole isEqualToString:@"broker"]) {
      SetStatus(status,
                AncPrivateVaultEnrollmentAuthorizationStatusBindingMismatch);
      return nil;
    }
    AncPrivateVaultEekWrapStatus eekStatus;
    if (AncPrivateVaultEekWrapVerify(
            authorization.eekWrapEnvelope, vaultId,
            challenge.candidateEndpointId, challenge.authorizerEndpointId,
            controlState.epoch, challenge.authorizerSigningPublicKey,
            &eekStatus) == nil) {
      SetStatus(status,
                eekStatus == AncPrivateVaultEekWrapStatusInvalidSignature
                    ? AncPrivateVaultEnrollmentAuthorizationStatusInvalidSignature
                    : AncPrivateVaultEnrollmentAuthorizationStatusBindingMismatch);
      return nil;
    }
    AncPrivateVaultEnrollmentAuthorizationResult *result =
        class_createInstance(
            AncPrivateVaultEnrollmentAuthorizationResult.class, 0);
    result.encodedAuthorization = [authorization.encoded copy];
    result.authorizationDigest = [authorization.digest copy];
    result.authorizationEnvelopeId = [authorization.envelopeId copy];
    result.endpointEnvelope = [authorization.endpointEnvelope copy];
    result.eekWrapEnvelope = [authorization.eekWrapEnvelope copy];
    result.signedMembershipCommit =
        [authorization.signedMembershipCommit copy];
    result.challenge = challenge;
    result.parsed = authorization;
    result.candidate = candidate;
    AncPrivateVaultControlLogReplayResult *replay = nil;
    AncPrivateVaultControlLogStatus replayStatus = [controlLog
        replaySignedEntry:authorization.signedMembershipCommit
             currentState:controlState
                 verifier:result
                   result:&replay];
    if (replayStatus != AncPrivateVaultControlLogStatusOK || replay == nil ||
        replay.idempotent || !result.callbackAccepted) {
      SetStatus(status,
                AncPrivateVaultEnrollmentAuthorizationStatusInvalidTransition);
      return nil;
    }
    result.replay = replay;
    SetStatus(status, AncPrivateVaultEnrollmentAuthorizationStatusOK);
    return result;
  } @catch (__unused NSException *exception) {
    SetStatus(status, AncPrivateVaultEnrollmentAuthorizationStatusInvalid);
    return nil;
  }
}
