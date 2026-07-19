#import "PrivateVaultEnrollmentAuthorizer.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultControlLogInternal.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultEnrollmentChallengeInternal.h"
#import "PrivateVaultEnrollmentOffer.h"
#import "PrivateVaultEnrollmentSasReceiptInternal.h"

static const uint8_t kChallengeDomain[] = "anc/v1/enrollment-challenge";
static const uint8_t kSasDomain[] = "anc/v1/enrollment-sas";
static const uint64_t kMaxSafeInteger = UINT64_C(9007199254740991);

@interface AncPrivateVaultPreparedEnrollmentChallenge ()
- (instancetype)initPrivateWithEncodedChallenge:(NSData *)encodedChallenge
                              verifiedChallenge:
                                  (AncPrivateVaultEnrollmentChallengeResult *)
                                      verifiedChallenge;
@end

@implementation AncPrivateVaultPreparedEnrollmentChallenge
@synthesize encodedChallenge = _encodedChallenge;
@synthesize verifiedChallenge = _verifiedChallenge;
+ (BOOL)accessInstanceVariablesDirectly { return NO; }
- (instancetype)initPrivateWithEncodedChallenge:(NSData *)encodedChallenge
                              verifiedChallenge:
                                  (AncPrivateVaultEnrollmentChallengeResult *)
                                      verifiedChallenge {
  self = [super init];
  if (self != nil) {
    _encodedChallenge = [encodedChallenge copy];
    _verifiedChallenge = verifiedChallenge;
  }
  return self;
}
@end

@interface AncPrivateVaultPreparedEnrollmentAuthorization ()
- (instancetype)initPrivateWithEncodedAuthorization:(NSData *)encoded
                              verifiedAuthorization:
                                  (AncPrivateVaultEnrollmentAuthorizationResult *)
                                      verified;
@end

@implementation AncPrivateVaultPreparedEnrollmentAuthorization
@synthesize encodedAuthorization = _encodedAuthorization;
@synthesize verifiedAuthorization = _verifiedAuthorization;
+ (BOOL)accessInstanceVariablesDirectly { return NO; }
- (instancetype)initPrivateWithEncodedAuthorization:(NSData *)encoded
                              verifiedAuthorization:
                                  (AncPrivateVaultEnrollmentAuthorizationResult *)
                                      verified {
  self = [super init];
  if (self != nil) {
    _encodedAuthorization = [encoded copy];
    _verifiedAuthorization = verified;
  }
  return self;
}
@end

static void SetStatus(AncPrivateVaultEnrollmentAuthorizerStatus *status,
                      AncPrivateVaultEnrollmentAuthorizerStatus value) {
  if (status != NULL)
    *status = value;
}

static NSData *SnapshotExact(NSData *value, NSUInteger length) {
  @try {
    if (![value isKindOfClass:NSData.class] || value.length != length)
      return nil;
    NSMutableData *snapshot = [NSMutableData dataWithLength:length];
    if (snapshot == nil)
      return nil;
    [value getBytes:snapshot.mutableBytes range:NSMakeRange(0, length)];
    return value.length == length ? [NSData dataWithData:snapshot] : nil;
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

static NSData *BytesFromHex(NSString *value) {
  if (![value isKindOfClass:NSString.class] || value.length != 32)
    return nil;
  NSMutableData *result = [NSMutableData dataWithLength:16];
  uint8_t *output = result.mutableBytes;
  for (NSUInteger index = 0; index < 16; index += 1) {
    unichar high = [value characterAtIndex:index * 2];
    unichar low = [value characterAtIndex:index * 2 + 1];
    int highValue = high >= '0' && high <= '9'
                        ? (int)(high - '0')
                    : high >= 'a' && high <= 'f' ? (int)(high - 'a' + 10) : -1;
    int lowValue = low >= '0' && low <= '9'
                       ? (int)(low - '0')
                   : low >= 'a' && low <= 'f' ? (int)(low - 'a' + 10) : -1;
    if (highValue < 0 || lowValue < 0) {
      anc_pv_zeroize(output, result.length);
      return nil;
    }
    output[index] = (uint8_t)((highValue << 4) | lowValue);
  }
  return [NSData dataWithData:result];
}

static NSData *Encode(
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map) {
  AncPrivateVaultCanonicalStatus status;
  return AncPrivateVaultCanonicalEncode([AncPrivateVaultCanonicalValue map:map],
                                        &status);
}

static NSData *DomainHash(const uint8_t *domain, size_t domainLength,
                          NSData *payload) {
  if (payload == nil)
    return nil;
  uint8_t digest[32] = {0};
  BOOL okay = anc_pv_blake2b_256_two_part(
                  digest, domain, domainLength, payload.bytes, payload.length) ==
              ANC_PV_CRYPTO_OK;
  NSData *result =
      okay ? [NSData dataWithBytes:digest length:sizeof digest] : nil;
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static NSData *SignDomain(NSData *payload,
                          AncPrivateVaultGuardedMemory *signingPrivateKey,
                          const uint8_t *domain, size_t domainLength) {
  if (payload == nil || signingPrivateKey == nil ||
      signingPrivateKey.length != 64 || signingPrivateKey.isClosed)
    return nil;
  NSMutableData *message = [NSMutableData dataWithBytes:domain
                                                 length:domainLength];
  [message appendData:payload];
  uint8_t signature[64] = {0};
  uint8_t *signatureBytes = signature;
  __block BOOL signedMessage = NO;
  AncPrivateVaultGuardedMemoryStatus borrowed =
      [signingPrivateKey borrow:^BOOL(uint8_t *key, size_t length) {
        if (length != 64)
          return NO;
        signedMessage = anc_pv_ed25519_sign(signatureBytes, message.bytes,
                                             message.length, key) ==
                        ANC_PV_CRYPTO_OK;
        return signedMessage;
      }];
  anc_pv_zeroize(message.mutableBytes, message.length);
  NSData *result = borrowed == AncPrivateVaultGuardedMemoryStatusOK &&
                           signedMessage
                       ? [NSData dataWithBytes:signature length:sizeof signature]
                       : nil;
  anc_pv_zeroize(signature, sizeof signature);
  return result;
}

static NSData *Sign(NSData *payload,
                    AncPrivateVaultGuardedMemory *signingPrivateKey) {
  return SignDomain(payload, signingPrivateKey, kChallengeDomain,
                    sizeof kChallengeDomain);
}

static NSString *HexData(NSData *data) {
  if (![data isKindOfClass:NSData.class])
    return nil;
  const uint8_t *bytes = data.bytes;
  NSMutableString *result =
      [NSMutableString stringWithCapacity:data.length * 2];
  for (NSUInteger index = 0; index < data.length; index += 1)
    [result appendFormat:@"%02x", bytes[index]];
  return result;
}

static NSString *Timestamp(uint64_t seconds) {
  if (seconds > kMaxSafeInteger)
    return nil;
  NSDate *date = [NSDate dateWithTimeIntervalSince1970:(NSTimeInterval)seconds];
  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                            NSISO8601DateFormatWithFractionalSeconds;
  formatter.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
  return [formatter stringFromDate:date];
}

static AncPrivateVaultCanonicalValue *MemberValue(
    NSString *endpointId, NSString *role, BOOL unattended, NSData *signingKey,
    NSData *agreementKey, NSString *enrollmentRef) {
  if (endpointId.length != 32 || role.length == 0 || signingKey.length != 32 ||
      agreementKey.length != 32 || enrollmentRef.length != 32)
    return nil;
  return [AncPrivateVaultCanonicalValue array:@[
    [AncPrivateVaultCanonicalValue text:endpointId],
    [AncPrivateVaultCanonicalValue text:role],
    [AncPrivateVaultCanonicalValue boolean:unattended],
    [AncPrivateVaultCanonicalValue bytes:signingKey],
    [AncPrivateVaultCanonicalValue bytes:agreementKey],
    [AncPrivateVaultCanonicalValue text:enrollmentRef],
  ]];
}

static BOOL CloseSecret(AncPrivateVaultGuardedMemory *memory) {
  return memory == nil || memory.isClosed ||
         [memory close] == AncPrivateVaultGuardedMemoryStatusOK;
}

AncPrivateVaultPreparedEnrollmentChallenge *
AncPrivateVaultBuildEnrollmentChallenge(
    NSData *encodedOffer, NSData *candidateKeyProof,
    AncPrivateVaultControlLogState *authenticatedState,
    AncPrivateVaultGuardedMemory *authorizerSigningSeed,
    AncPrivateVaultGuardedMemory *authorizerAgreementSeed,
    NSData *challengeEnvelopeId, NSData *sasNonce,
    uint64_t authenticatedHeadSignedAtSeconds, uint64_t createdAt,
    uint64_t expiresAt, AncPrivateVaultEnrollmentAuthorizerStatus *status) {
  SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusInvalid);
  NSData *proof = SnapshotExact(candidateKeyProof, 64);
  NSData *envelope = SnapshotExact(challengeEnvelopeId, 16);
  NSData *nonce = SnapshotExact(sasNonce, 32);
  AncPrivateVaultControlLogState *state =
      AncPrivateVaultControlLogStateCreateImmutableCopy(authenticatedState);
  AncPrivateVaultGuardedMemory *signingPrivate = nil;
  AncPrivateVaultGuardedMemory *agreementPrivate = nil;
  AncPrivateVaultPreparedEnrollmentChallenge *result = nil;
  uint8_t signingPublic[32] = {0};
  uint8_t agreementPublic[32] = {0};
  uint8_t *signingPublicBytes = signingPublic;
  uint8_t *agreementPublicBytes = agreementPublic;
  BOOL cleanupOkay = YES;
  @try {
    if (![encodedOffer isKindOfClass:NSData.class] || encodedOffer.length == 0 ||
        encodedOffer.length > 64 * 1024 || proof == nil || envelope == nil ||
        nonce == nil || state == nil || authorizerSigningSeed == nil ||
        authorizerAgreementSeed == nil || authorizerSigningSeed.length != 32 ||
        authorizerAgreementSeed.length != 32 || authorizerSigningSeed.isClosed ||
        authorizerAgreementSeed.isClosed ||
        authenticatedHeadSignedAtSeconds == 0 || createdAt == 0 ||
        createdAt > kMaxSafeInteger || expiresAt <= createdAt ||
        expiresAt > kMaxSafeInteger || expiresAt - createdAt > 600 ||
        authenticatedHeadSignedAtSeconds > kMaxSafeInteger - 900 ||
        createdAt > authenticatedHeadSignedAtSeconds + 900 ||
        expiresAt > authenticatedHeadSignedAtSeconds + 900) {
      @throw [NSException exceptionWithName:@"AncInvalid"
                                     reason:nil
                                   userInfo:nil];
    }
    AncPrivateVaultGuardedMemoryStatus memoryStatus;
    signingPrivate = [AncPrivateVaultGuardedMemory memoryWithLength:64
                                                            status:&memoryStatus];
    agreementPrivate = [AncPrivateVaultGuardedMemory memoryWithLength:32
                                                               status:&memoryStatus];
    if (signingPrivate == nil || agreementPrivate == nil) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusCrypto);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    __block BOOL signingOkay = NO;
    AncPrivateVaultGuardedMemoryStatus signingBorrow =
        [signingPrivate borrow:^BOOL(uint8_t *privateKey, size_t privateLength) {
          if (privateLength != 64)
            return NO;
          return [authorizerSigningSeed
                     borrow:^BOOL(uint8_t *seed, size_t seedLength) {
                       signingOkay = seedLength == 32 &&
                                    anc_pv_ed25519_seed_keypair(
                                        signingPublicBytes, privateKey, seed) ==
                                        ANC_PV_CRYPTO_OK;
                       return signingOkay;
                     }] == AncPrivateVaultGuardedMemoryStatusOK &&
                 signingOkay;
    }];
    __block BOOL agreementOkay = NO;
    AncPrivateVaultGuardedMemoryStatus agreementBorrow = [agreementPrivate
        borrow:^BOOL(uint8_t *privateKey, size_t privateLength) {
          if (privateLength != 32)
            return NO;
          return [authorizerAgreementSeed
                     borrow:^BOOL(uint8_t *seed, size_t length) {
                       agreementOkay =
                           length == 32 &&
                           anc_pv_box_seed_keypair(agreementPublicBytes,
                                                   privateKey, seed) ==
                               ANC_PV_CRYPTO_OK;
                       return agreementOkay;
                     }] == AncPrivateVaultGuardedMemoryStatusOK &&
                 agreementOkay;
        }];
    if (signingBorrow != AncPrivateVaultGuardedMemoryStatusOK || !signingOkay ||
        agreementBorrow != AncPrivateVaultGuardedMemoryStatusOK ||
        !agreementOkay) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusCrypto);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    NSData *vault = BytesFromHex(state.vaultId);
    NSData *signingKey = [NSData dataWithBytes:signingPublic length:32];
    NSData *agreementKey = [NSData dataWithBytes:agreementPublic length:32];
    AncPrivateVaultControlLogMember *authorizer = nil;
    for (AncPrivateVaultControlLogMember *member in state.activeMembers) {
      if ([member.role isEqualToString:@"endpoint"] && !member.unattended &&
          [member.signingPublicKey isEqualToData:signingKey] &&
          [member.keyAgreementPublicKey isEqualToData:agreementKey]) {
        if (authorizer != nil) {
          SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusConflict);
          @throw [NSException exceptionWithName:@"AncExpected"
                                         reason:nil
                                       userInfo:nil];
        }
        authorizer = member;
      }
    }
    NSData *authorizerId = BytesFromHex(authorizer.endpointId);
    AncPrivateVaultEnrollmentOfferStatus offerStatus;
    AncPrivateVaultEnrollmentOfferResult *offer =
        vault == nil ? nil
                     : AncPrivateVaultEnrollmentOfferVerify(
                           encodedOffer, proof, vault, &offerStatus);
    if (offer == nil || authorizerId == nil || state.sequence > kMaxSafeInteger ||
        state.headHash.length != 32 || state.membershipHash.length != 32 ||
        offer.createdAt > createdAt || offer.expiresAt < createdAt) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusConflict);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    NSDictionary *sasMap = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue bytes:vault],
      @3 : [AncPrivateVaultCanonicalValue text:@"enrollment-sas"],
      @320 : [AncPrivateVaultCanonicalValue bytes:offer.ceremonyId],
      @321 : [AncPrivateVaultCanonicalValue bytes:offer.offerHash],
      @322 : [AncPrivateVaultCanonicalValue bytes:offer.endpointId],
      @323 : [AncPrivateVaultCanonicalValue bytes:offer.signingPublicKey],
      @324 : [AncPrivateVaultCanonicalValue bytes:offer.keyAgreementPublicKey],
      @325 : [AncPrivateVaultCanonicalValue bytes:proof],
      @326 : [AncPrivateVaultCanonicalValue bytes:authorizerId],
      @327 : [AncPrivateVaultCanonicalValue bytes:signingKey],
      @328 : [AncPrivateVaultCanonicalValue bytes:agreementKey],
      @329 : [AncPrivateVaultCanonicalValue integer:(int64_t)state.sequence],
      @330 : [AncPrivateVaultCanonicalValue bytes:state.headHash],
      @331 : [AncPrivateVaultCanonicalValue bytes:state.membershipHash],
      @332 : [AncPrivateVaultCanonicalValue text:offer.membershipRole],
      @333 : [AncPrivateVaultCanonicalValue bytes:nonce],
      @334 : [AncPrivateVaultCanonicalValue bytes:envelope],
      @335 : [AncPrivateVaultCanonicalValue integer:(int64_t)createdAt],
      @336 : [AncPrivateVaultCanonicalValue integer:(int64_t)expiresAt],
    };
    NSData *sasTranscript = Encode(sasMap);
    NSData *sasHash =
        DomainHash(kSasDomain, sizeof kSasDomain, sasTranscript);
    NSDictionary *unsignedMap = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue bytes:vault],
      @3 : [AncPrivateVaultCanonicalValue text:@"enrollment-challenge"],
      @4 : [AncPrivateVaultCanonicalValue integer:(int64_t)createdAt],
      @5 : [AncPrivateVaultCanonicalValue bytes:envelope],
      @170 : [AncPrivateVaultCanonicalValue bytes:offer.offerHash],
      @171 : [AncPrivateVaultCanonicalValue bytes:proof],
      @172 : [AncPrivateVaultCanonicalValue bytes:authorizerId],
      @173 : [AncPrivateVaultCanonicalValue bytes:signingKey],
      @174 : [AncPrivateVaultCanonicalValue bytes:agreementKey],
      @175 : [AncPrivateVaultCanonicalValue integer:(int64_t)state.sequence],
      @176 : [AncPrivateVaultCanonicalValue bytes:state.headHash],
      @177 : [AncPrivateVaultCanonicalValue bytes:state.membershipHash],
      @178 : [AncPrivateVaultCanonicalValue text:offer.membershipRole],
      @179 : [AncPrivateVaultCanonicalValue bytes:sasHash ?: NSData.data],
      @180 : [AncPrivateVaultCanonicalValue bytes:nonce],
      @181 : [AncPrivateVaultCanonicalValue integer:(int64_t)expiresAt],
    };
    NSData *unsignedChallenge = Encode(unsignedMap);
    NSData *signature = Sign(unsignedChallenge, signingPrivate);
    NSMutableDictionary *signedMap = [unsignedMap mutableCopy];
    signedMap[@182] =
        [AncPrivateVaultCanonicalValue bytes:signature ?: NSData.data];
    NSData *encodedChallenge = Encode(signedMap);
    if (sasTranscript == nil || sasHash == nil || unsignedChallenge == nil ||
        signature == nil || encodedChallenge == nil) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusEncoding);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    AncPrivateVaultEnrollmentChallengeStatus verifyStatus;
    AncPrivateVaultEnrollmentChallengeResult *verified =
        AncPrivateVaultEnrollmentChallengeVerify(
            encodedOffer, encodedChallenge, state,
            authenticatedHeadSignedAtSeconds, createdAt, &verifyStatus);
    if (verified == nil ||
        ![verified.sasTranscriptHash isEqualToData:sasHash]) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusVerification);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    result = [[AncPrivateVaultPreparedEnrollmentChallenge alloc]
        initPrivateWithEncodedChallenge:encodedChallenge
                      verifiedChallenge:verified];
    if (result == nil) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusEncoding);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusOK);
  } @catch (NSException *exception) {
    (void)exception;
  }
  BOOL signingClosed = CloseSecret(signingPrivate);
  BOOL agreementClosed = CloseSecret(agreementPrivate);
  cleanupOkay = signingClosed && agreementClosed;
  anc_pv_zeroize(signingPublic, sizeof signingPublic);
  anc_pv_zeroize(agreementPublic, sizeof agreementPublic);
  if (!cleanupOkay) {
    SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusCleanup);
    return nil;
  }
  return result;
}

AncPrivateVaultPreparedEnrollmentAuthorization *
AncPrivateVaultBuildEnrollmentAuthorization(
    NSData *encodedOffer,
    AncPrivateVaultEnrollmentChallengeResult *verifiedChallenge,
    AncPrivateVaultEnrollmentSasReceipt *confirmedReceipt,
    AncPrivateVaultControlLogState *authenticatedState,
    AncPrivateVaultGuardedMemory *authorizerSigningSeed,
    AncPrivateVaultGuardedMemory *authorizerAgreementSeed,
    AncPrivateVaultGuardedMemory *activeEpochKey, NSData *authorizationEnvelopeId,
    NSData *endpointEnvelopeId, NSData *eekWrapEnvelopeId,
    NSData *eekWrapNonce, NSData *controlEntryId,
    uint64_t controlEntryCreatedAt, uint64_t authenticatedHeadSignedAtSeconds,
    uint64_t createdAt, uint64_t expiresAt,
    AncPrivateVaultEnrollmentAuthorizerStatus *status) {
  static const uint8_t endpointDomain[] = "anc/v1/endpoint";
  static const uint8_t wrapDomain[] = "anc/v1/eek-wrap";
  static const uint8_t entryDomain[] = "anc/v1/log-entry";
  static const uint8_t authorizationDomain[] =
      "anc/v1/enrollment-authorization";
  SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusInvalid);
  NSData *authorizationId = SnapshotExact(authorizationEnvelopeId, 16);
  NSData *endpointId = SnapshotExact(endpointEnvelopeId, 16);
  NSData *wrapId = SnapshotExact(eekWrapEnvelopeId, 16);
  NSData *nonce = SnapshotExact(eekWrapNonce, 24);
  NSData *entryId = SnapshotExact(controlEntryId, 16);
  AncPrivateVaultControlLogState *state =
      AncPrivateVaultControlLogStateCreateImmutableCopy(authenticatedState);
  AncPrivateVaultGuardedMemory *signingPrivate = nil;
  AncPrivateVaultGuardedMemory *agreementPrivate = nil;
  AncPrivateVaultPreparedEnrollmentAuthorization *result = nil;
  NSMutableData *signingPublic = [NSMutableData dataWithLength:32];
  NSMutableData *agreementPublic = [NSMutableData dataWithLength:32];
  NSMutableData *ciphertext = [NSMutableData dataWithLength:64];
  BOOL cleanupOkay = YES;
  @try {
    if (![encodedOffer isKindOfClass:NSData.class] || encodedOffer.length == 0 ||
        encodedOffer.length > 64 * 1024 || verifiedChallenge == nil ||
        confirmedReceipt == nil || state == nil || authorizationId == nil ||
        endpointId == nil || wrapId == nil || nonce == nil || entryId == nil ||
        authorizerSigningSeed == nil || authorizerAgreementSeed == nil ||
        activeEpochKey == nil || authorizerSigningSeed.length != 32 ||
        authorizerAgreementSeed.length != 32 || activeEpochKey.length != 32 ||
        authorizerSigningSeed.isClosed || authorizerAgreementSeed.isClosed ||
        activeEpochKey.isClosed || authenticatedHeadSignedAtSeconds == 0 ||
        controlEntryCreatedAt == 0 ||
        controlEntryCreatedAt > kMaxSafeInteger || createdAt == 0 ||
        createdAt > kMaxSafeInteger || expiresAt <= createdAt ||
        controlEntryCreatedAt < createdAt || controlEntryCreatedAt > expiresAt ||
        expiresAt > kMaxSafeInteger || expiresAt - createdAt > 600 ||
        state.sequence >= kMaxSafeInteger || state.epoch == 0 ||
        state.epoch > kMaxSafeInteger ||
        authenticatedHeadSignedAtSeconds > kMaxSafeInteger - 900 ||
        createdAt > authenticatedHeadSignedAtSeconds + 900 ||
        expiresAt > authenticatedHeadSignedAtSeconds + 900 ||
        state.headHash.length != 32 || state.membershipHash.length != 32 ||
        state.recoveryGeneration == 0 ||
        state.recoveryGeneration > kMaxSafeInteger ||
        state.recoveryId.length != 32 ||
        state.recoverySigningPublicKey.length != 32 ||
        state.recoveryKeyAgreementPublicKey.length != 32 ||
        state.recoveryWrapHash.length != 32) {
      @throw [NSException exceptionWithName:@"AncInvalid"
                                     reason:nil
                                   userInfo:nil];
    }
    AncPrivateVaultGuardedMemoryStatus memoryStatus;
    signingPrivate = [AncPrivateVaultGuardedMemory memoryWithLength:64
                                                            status:&memoryStatus];
    agreementPrivate = [AncPrivateVaultGuardedMemory memoryWithLength:32
                                                              status:&memoryStatus];
    if (signingPrivate == nil || agreementPrivate == nil) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusCrypto);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    __block BOOL signingOkay = NO;
    AncPrivateVaultGuardedMemoryStatus signingBorrow =
        [signingPrivate borrow:^BOOL(uint8_t *privateKey, size_t privateLength) {
          return privateLength == 64 &&
                 [authorizerSigningSeed
                     borrow:^BOOL(uint8_t *seed, size_t seedLength) {
                       signingOkay = seedLength == 32 &&
                                    anc_pv_ed25519_seed_keypair(
                                        signingPublic.mutableBytes, privateKey,
                                        seed) == ANC_PV_CRYPTO_OK;
                       return signingOkay;
                     }] == AncPrivateVaultGuardedMemoryStatusOK &&
                 signingOkay;
        }];
    __block BOOL agreementOkay = NO;
    AncPrivateVaultGuardedMemoryStatus agreementBorrow =
        [agreementPrivate borrow:^BOOL(uint8_t *privateKey, size_t privateLength) {
          return privateLength == 32 &&
                 [authorizerAgreementSeed
                     borrow:^BOOL(uint8_t *seed, size_t seedLength) {
                       agreementOkay = seedLength == 32 &&
                                         anc_pv_box_seed_keypair(
                                             agreementPublic.mutableBytes,
                                             privateKey, seed) ==
                                             ANC_PV_CRYPTO_OK;
                       return agreementOkay;
                     }] == AncPrivateVaultGuardedMemoryStatusOK &&
                 agreementOkay;
        }];
    if (signingBorrow != AncPrivateVaultGuardedMemoryStatusOK ||
        agreementBorrow != AncPrivateVaultGuardedMemoryStatusOK ||
        !signingOkay || !agreementOkay) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusCrypto);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    NSData *vault = BytesFromHex(state.vaultId);
    NSData *signingKey = [NSData dataWithData:signingPublic];
    NSData *agreementKey = [NSData dataWithData:agreementPublic];
    NSData *evidenceVault = nil, *encodedChallenge = nil,
           *evidenceOfferHash = nil, *evidenceChallengeHash = nil,
           *evidenceSasHash = nil, *evidenceCandidate = nil,
           *evidenceCandidateSigning = nil,
           *evidenceCandidateAgreement = nil, *evidenceCeremony = nil;
    NSString *evidenceRole = nil;
    uint64_t evidenceCreatedAt = 0, evidenceExpiresAt = 0;
    if (!AncPrivateVaultEnrollmentChallengeCopyEvidence(
            verifiedChallenge, &evidenceVault, &encodedChallenge,
            &evidenceOfferHash, &evidenceChallengeHash, &evidenceSasHash,
            &evidenceCandidate, &evidenceCandidateSigning,
            &evidenceCandidateAgreement, &evidenceCeremony, &evidenceRole,
            &evidenceCreatedAt, &evidenceExpiresAt)) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusConflict);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    AncPrivateVaultEnrollmentChallengeStatus challengeStatus;
    AncPrivateVaultEnrollmentChallengeResult *challenge =
        vault == nil
            ? nil
            : AncPrivateVaultEnrollmentChallengeVerify(
                  encodedOffer, encodedChallenge, state,
                  authenticatedHeadSignedAtSeconds, createdAt, &challengeStatus);
    AncPrivateVaultEnrollmentSasReceiptStatus receiptStatus;
    AncPrivateVaultEnrollmentSasReceipt *receipt =
        challenge == nil
            ? nil
            : AncPrivateVaultEnrollmentSasReceiptVerifyBound(
                  confirmedReceipt.encodedReceipt, evidenceVault,
                  evidenceOfferHash, evidenceChallengeHash, evidenceSasHash,
                  evidenceCandidate, evidenceCeremony,
                  evidenceCandidateSigning, evidenceCreatedAt,
                  evidenceExpiresAt, &receiptStatus);
    if (challenge == nil || receipt == nil ||
        receipt.decision != AncPrivateVaultEnrollmentSasDecisionConfirmed ||
        ![challenge.challengeHash isEqualToData:evidenceChallengeHash] ||
        ![challenge.authorizerSigningPublicKey isEqualToData:signingKey] ||
        ![challenge.authorizerKeyAgreementPublicKey
            isEqualToData:agreementKey] ||
        challenge.createdAt > createdAt || challenge.expiresAt < createdAt ||
        ![challenge.targetMembershipRole isEqualToString:@"broker"] ||
        challenge.controlSequence != state.sequence) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusConflict);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    NSString *authorizerHex = HexData(challenge.authorizerEndpointId);
    AncPrivateVaultControlLogMember *authorizer = nil;
    for (AncPrivateVaultControlLogMember *member in state.activeMembers) {
      if ([member.endpointId isEqualToString:authorizerHex]) {
        authorizer = member;
        break;
      }
    }
    if (authorizer == nil || ![authorizer.role isEqualToString:@"endpoint"] ||
        authorizer.unattended ||
        ![authorizer.signingPublicKey isEqualToData:signingKey] ||
        ![authorizer.keyAgreementPublicKey isEqualToData:agreementKey]) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusConflict);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    NSDictionary *endpointUnsigned = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue bytes:vault],
      @3 : [AncPrivateVaultCanonicalValue text:@"endpoint"],
      @4 : [AncPrivateVaultCanonicalValue integer:(int64_t)createdAt],
      @5 : [AncPrivateVaultCanonicalValue bytes:endpointId],
      @10 : [AncPrivateVaultCanonicalValue bytes:challenge.candidateEndpointId],
      @11 : [AncPrivateVaultCanonicalValue text:@"desktop-broker"],
      @12 : [AncPrivateVaultCanonicalValue boolean:YES],
      @13 : [AncPrivateVaultCanonicalValue
          bytes:challenge.candidateSigningPublicKey],
      @14 : [AncPrivateVaultCanonicalValue
          bytes:challenge.candidateKeyAgreementPublicKey],
      @15 : [AncPrivateVaultCanonicalValue
          bytes:challenge.authorizerEndpointId],
      @16 : [AncPrivateVaultCanonicalValue bytes:challenge.sasTranscriptHash],
    };
    NSData *endpointUnsignedBytes = Encode(endpointUnsigned);
    NSData *endpointSignature = SignDomain(
        endpointUnsignedBytes, signingPrivate, endpointDomain,
        sizeof endpointDomain);
    NSMutableDictionary *endpointSigned = [endpointUnsigned mutableCopy];
    endpointSigned[@17] = [AncPrivateVaultCanonicalValue
        bytes:endpointSignature ?: NSData.data];
    NSData *endpointEnvelope = Encode(endpointSigned);

    __block BOOL wrapped = NO;
    __block size_t ciphertextLength = 0;
    AncPrivateVaultGuardedMemoryStatus wrapBorrow =
        [agreementPrivate borrow:^BOOL(uint8_t *privateKey, size_t length) {
          if (length != 32)
            return NO;
          return [activeEpochKey borrow:^BOOL(uint8_t *epochKey,
                                              size_t epochLength) {
            if (epochLength != 32)
              return NO;
            uint8_t plaintext[48] = {0};
            memcpy(plaintext, "anc/v1/eek-wrap", 16);
            memcpy(plaintext + 16, epochKey, 32);
            wrapped = anc_pv_box_wrap(
                          ciphertext.mutableBytes, ciphertext.length,
                          &ciphertextLength, plaintext, sizeof plaintext,
                          nonce.bytes,
                          challenge.candidateKeyAgreementPublicKey.bytes,
                          privateKey) == ANC_PV_CRYPTO_OK &&
                      ciphertextLength == 64;
            anc_pv_zeroize(plaintext, sizeof plaintext);
            return wrapped;
          }] == AncPrivateVaultGuardedMemoryStatusOK &&
                 wrapped;
        }];
    if (wrapBorrow != AncPrivateVaultGuardedMemoryStatusOK || !wrapped) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusCrypto);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    NSDictionary *wrapUnsigned = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue bytes:vault],
      @3 : [AncPrivateVaultCanonicalValue text:@"eek-wrap"],
      @4 : [AncPrivateVaultCanonicalValue integer:(int64_t)createdAt],
      @5 : [AncPrivateVaultCanonicalValue bytes:wrapId],
      @30 : [AncPrivateVaultCanonicalValue integer:(int64_t)state.epoch],
      @31 : [AncPrivateVaultCanonicalValue bytes:challenge.candidateEndpointId],
      @32 : [AncPrivateVaultCanonicalValue
          bytes:challenge.authorizerEndpointId],
      @33 : [AncPrivateVaultCanonicalValue bytes:nonce],
      @34 : [AncPrivateVaultCanonicalValue bytes:ciphertext],
    };
    NSData *wrapUnsignedBytes = Encode(wrapUnsigned);
    NSData *wrapSignature = SignDomain(wrapUnsignedBytes, signingPrivate,
                                       wrapDomain, sizeof wrapDomain);
    NSMutableDictionary *wrapSigned = [wrapUnsigned mutableCopy];
    wrapSigned[@35] = [AncPrivateVaultCanonicalValue
        bytes:wrapSignature ?: NSData.data];
    NSData *eekWrap = Encode(wrapSigned);

    NSMutableArray<AncPrivateVaultCanonicalValue *> *members =
        [NSMutableArray arrayWithCapacity:state.activeMembers.count + 1];
    for (AncPrivateVaultControlLogMember *member in state.activeMembers) {
      AncPrivateVaultCanonicalValue *value =
          MemberValue(member.endpointId, member.role, member.unattended,
                      member.signingPublicKey, member.keyAgreementPublicKey,
                      member.enrollmentRef);
      if (value == nil) {
        SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusConflict);
        @throw [NSException exceptionWithName:@"AncExpected"
                                       reason:nil
                                     userInfo:nil];
      }
      [members addObject:value];
    }
    AncPrivateVaultCanonicalValue *candidateMember = MemberValue(
        HexData(challenge.candidateEndpointId), @"broker", YES,
        challenge.candidateSigningPublicKey,
        challenge.candidateKeyAgreementPublicKey, HexData(authorizationId));
    if (candidateMember == nil) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusConflict);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    [members addObject:candidateMember];
    NSDictionary *commitMap = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue text:state.vaultId],
      @3 : [AncPrivateVaultCanonicalValue text:@"membership_commit"],
      @140 : [AncPrivateVaultCanonicalValue text:HexData(challenge.ceremonyId)],
      @141 : [AncPrivateVaultCanonicalValue text:@"add_broker"],
      @142 : [AncPrivateVaultCanonicalValue integer:(int64_t)state.epoch],
      @143 : [AncPrivateVaultCanonicalValue bytes:state.membershipHash],
      @144 : [AncPrivateVaultCanonicalValue array:members],
      @145 : [AncPrivateVaultCanonicalValue array:@[]],
      @146 : [AncPrivateVaultCanonicalValue boolean:NO],
      @147 : [AncPrivateVaultCanonicalValue boolean:NO],
      @148 : [AncPrivateVaultCanonicalValue nullValue],
      @149 : [AncPrivateVaultCanonicalValue nullValue],
      @155 : [AncPrivateVaultCanonicalValue
          integer:(int64_t)state.recoveryGeneration],
      @156 : [AncPrivateVaultCanonicalValue text:state.recoveryId],
      @157 : [AncPrivateVaultCanonicalValue bytes:state.recoverySigningPublicKey],
      @158 : [AncPrivateVaultCanonicalValue
          bytes:state.recoveryKeyAgreementPublicKey],
      @159 : [AncPrivateVaultCanonicalValue bytes:state.recoveryWrapHash],
    };
    NSData *commitBytes = Encode(commitMap);
    NSString *createdAtText = Timestamp(controlEntryCreatedAt);
    NSDictionary *entryUnsigned = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue text:state.vaultId],
      @3 : [AncPrivateVaultCanonicalValue text:@"log-entry"],
      @4 : [AncPrivateVaultCanonicalValue text:createdAtText ?: @""],
      @5 : [AncPrivateVaultCanonicalValue text:HexData(entryId)],
      @110 : [AncPrivateVaultCanonicalValue
          integer:(int64_t)(state.sequence + 1)],
      @111 : [AncPrivateVaultCanonicalValue bytes:state.headHash],
      @112 : [AncPrivateVaultCanonicalValue bytes:commitBytes ?: NSData.data],
      @113 : [AncPrivateVaultCanonicalValue text:authorizerHex],
    };
    NSData *entryUnsignedBytes = Encode(entryUnsigned);
    NSData *entrySignature = SignDomain(entryUnsignedBytes, signingPrivate,
                                        entryDomain, sizeof entryDomain);
    NSMutableDictionary *entrySigned = [entryUnsigned mutableCopy];
    entrySigned[@114] = [AncPrivateVaultCanonicalValue
        bytes:entrySignature ?: NSData.data];
    NSData *signedCommit = Encode(entrySigned);

    NSDictionary *authorizationUnsigned = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue bytes:vault],
      @3 : [AncPrivateVaultCanonicalValue
          text:@"enrollment-authorization"],
      @4 : [AncPrivateVaultCanonicalValue integer:(int64_t)createdAt],
      @5 : [AncPrivateVaultCanonicalValue bytes:authorizationId],
      @300 : [AncPrivateVaultCanonicalValue bytes:challenge.offerHash],
      @301 : [AncPrivateVaultCanonicalValue bytes:challenge.challengeHash],
      @302 : [AncPrivateVaultCanonicalValue
          bytes:challenge.authorizerEndpointId],
      @303 : [AncPrivateVaultCanonicalValue text:@"broker"],
      @304 : [AncPrivateVaultCanonicalValue integer:(int64_t)state.sequence],
      @305 : [AncPrivateVaultCanonicalValue bytes:state.headHash],
      @306 : [AncPrivateVaultCanonicalValue bytes:state.membershipHash],
      @307 : [AncPrivateVaultCanonicalValue
          bytes:endpointEnvelope ?: NSData.data],
      @308 : [AncPrivateVaultCanonicalValue bytes:eekWrap ?: NSData.data],
      @309 : [AncPrivateVaultCanonicalValue bytes:signedCommit ?: NSData.data],
      @310 : [AncPrivateVaultCanonicalValue integer:(int64_t)expiresAt],
    };
    NSData *authorizationUnsignedBytes = Encode(authorizationUnsigned);
    NSData *authorizationSignature = SignDomain(
        authorizationUnsignedBytes, signingPrivate, authorizationDomain,
        sizeof authorizationDomain);
    NSMutableDictionary *authorizationSigned =
        [authorizationUnsigned mutableCopy];
    authorizationSigned[@311] = [AncPrivateVaultCanonicalValue
        bytes:authorizationSignature ?: NSData.data];
    NSData *encodedAuthorization = Encode(authorizationSigned);
    if (endpointEnvelope == nil || eekWrap == nil || commitBytes == nil ||
        createdAtText == nil || signedCommit == nil ||
        encodedAuthorization == nil || encodedAuthorization.length > 256 * 1024) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusEncoding);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    AncPrivateVaultEnrollmentAuthorizationStatus verifyStatus;
    AncPrivateVaultEnrollmentAuthorizationResult *verified =
        AncPrivateVaultEnrollmentAuthorizationVerify(
            encodedOffer, encodedChallenge, encodedAuthorization,
            state, authenticatedHeadSignedAtSeconds, createdAt,
            [AncPrivateVaultControlLog new], &verifyStatus);
    if (verified == nil ||
        ![verified.authorizationEnvelopeId isEqualToData:authorizationId]) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusVerification);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    result = [[AncPrivateVaultPreparedEnrollmentAuthorization alloc]
        initPrivateWithEncodedAuthorization:encodedAuthorization
                      verifiedAuthorization:verified];
    if (result == nil) {
      SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusEncoding);
      @throw [NSException exceptionWithName:@"AncExpected"
                                     reason:nil
                                   userInfo:nil];
    }
    SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusOK);
  } @catch (__unused NSException *exception) {
  }
  BOOL signingClosed = CloseSecret(signingPrivate);
  BOOL agreementClosed = CloseSecret(agreementPrivate);
  cleanupOkay = signingClosed && agreementClosed;
  anc_pv_zeroize(signingPublic.mutableBytes, signingPublic.length);
  anc_pv_zeroize(agreementPublic.mutableBytes, agreementPublic.length);
  anc_pv_zeroize(ciphertext.mutableBytes, ciphertext.length);
  if (!cleanupOkay) {
    SetStatus(status, AncPrivateVaultEnrollmentAuthorizerStatusCleanup);
    return nil;
  }
  return result;
}

NSString *AncPrivateVaultEnrollmentAuthorizerCategory(
    AncPrivateVaultEnrollmentAuthorizerStatus status) {
  switch (status) {
  case AncPrivateVaultEnrollmentAuthorizerStatusOK:
    return @"ok";
  case AncPrivateVaultEnrollmentAuthorizerStatusInvalid:
    return @"invalid";
  case AncPrivateVaultEnrollmentAuthorizerStatusConflict:
    return @"conflict";
  case AncPrivateVaultEnrollmentAuthorizerStatusExpired:
    return @"expired";
  case AncPrivateVaultEnrollmentAuthorizerStatusCrypto:
    return @"crypto";
  case AncPrivateVaultEnrollmentAuthorizerStatusEncoding:
    return @"encoding";
  case AncPrivateVaultEnrollmentAuthorizerStatusVerification:
    return @"verification";
  case AncPrivateVaultEnrollmentAuthorizerStatusCleanup:
    return @"cleanup";
  }
  return @"invalid";
}
