#import "PrivateVaultEnrollmentAuthorizer.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultControlLogInternal.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultEnrollmentOffer.h"

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

static NSData *Sign(NSData *payload,
                    AncPrivateVaultGuardedMemory *signingPrivateKey) {
  if (payload == nil || signingPrivateKey == nil ||
      signingPrivateKey.length != 64 || signingPrivateKey.isClosed)
    return nil;
  NSMutableData *message = [NSMutableData dataWithBytes:kChallengeDomain
                                                 length:sizeof kChallengeDomain];
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
