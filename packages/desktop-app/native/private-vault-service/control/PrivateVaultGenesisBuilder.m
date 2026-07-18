#import "PrivateVaultGenesisBuilder.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultGenesisAuthorization.h"
#import "PrivateVaultGenesisBootstrap.h"
#import "PrivateVaultRecoveryAuthority.h"
#import "PrivateVaultRecoveryWrap.h"

static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);
static const uint8_t kEndpointDomain[] = "anc/v1/endpoint";
static const uint8_t kEEKDomain[] = "anc/v1/eek-wrap";
static const uint8_t kWrapDomain[] = "anc/v1/recovery-wrap";
static const uint8_t kLogDomain[] = "anc/v1/log-entry";
static const uint8_t kAuthorizationDomain[] = "anc/v1/genesis-authorization";

@interface AncPrivateVaultPreparedGenesisArtifacts ()
- (instancetype)initPrivateWithRecoveryWrap:(NSData *)recoveryWrap
                        recoveryConfirmation:(NSData *)recoveryConfirmation
                          bootstrapTranscript:(NSData *)bootstrapTranscript
                                authorization:(NSData *)authorization
                   bootstrapTranscriptDigest:(NSData *)digest;
@end

@implementation AncPrivateVaultPreparedGenesisArtifacts
@synthesize recoveryWrap = _recoveryWrap;
@synthesize recoveryConfirmation = _recoveryConfirmation;
@synthesize bootstrapTranscript = _bootstrapTranscript;
@synthesize authorization = _authorization;
@synthesize bootstrapTranscriptDigest = _bootstrapTranscriptDigest;
+ (BOOL)accessInstanceVariablesDirectly { return NO; }
- (instancetype)initPrivateWithRecoveryWrap:(NSData *)recoveryWrap
                        recoveryConfirmation:(NSData *)recoveryConfirmation
                          bootstrapTranscript:(NSData *)bootstrapTranscript
                                authorization:(NSData *)authorization
                   bootstrapTranscriptDigest:(NSData *)digest {
  self = [super init];
  if (self != nil) {
    _recoveryWrap = [recoveryWrap copy];
    _recoveryConfirmation = [recoveryConfirmation copy];
    _bootstrapTranscript = [bootstrapTranscript copy];
    _authorization = [authorization copy];
    _bootstrapTranscriptDigest = [digest copy];
  }
  return self;
}
@end

static void SetStatus(AncPrivateVaultGenesisBuilderStatus *status,
                      AncPrivateVaultGenesisBuilderStatus value) {
  if (status != NULL)
    *status = value;
}

static AncPrivateVaultCanonicalValue *VText(NSString *value) {
  return [AncPrivateVaultCanonicalValue text:value];
}
static AncPrivateVaultCanonicalValue *VBytes(NSData *value) {
  return [AncPrivateVaultCanonicalValue bytes:value];
}
static AncPrivateVaultCanonicalValue *VInt(uint64_t value) {
  return value <= INT64_MAX
             ? [AncPrivateVaultCanonicalValue integer:(int64_t)value]
             : nil;
}

static NSData *SnapshotExact(NSData *input, NSUInteger expectedLength) {
  @try {
    if (![input isKindOfClass:NSData.class] || input.length != expectedLength)
      return nil;
    NSMutableData *snapshot = [NSMutableData dataWithLength:expectedLength];
    if (snapshot == nil)
      return nil;
    [input getBytes:snapshot.mutableBytes
              range:NSMakeRange(0, expectedLength)];
    if (input.length != expectedLength) {
      anc_pv_zeroize(snapshot.mutableBytes, snapshot.length);
      return nil;
    }
    return [NSData dataWithData:snapshot];
  } @catch (__unused NSException *exception) {
    return nil;
  }
}
static NSData *Encode(NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map) {
  AncPrivateVaultCanonicalStatus status;
  return AncPrivateVaultCanonicalEncode([AncPrivateVaultCanonicalValue map:map],
                                        &status);
}

static NSString *Hex(NSData *data) {
  if (data == nil)
    return nil;
  const uint8_t *bytes = data.bytes;
  static const char digits[] = "0123456789abcdef";
  char *output = calloc(data.length * 2 + 1, 1);
  if (output == NULL)
    return nil;
  for (NSUInteger index = 0; index < data.length; index++) {
    output[index * 2] = digits[bytes[index] >> 4];
    output[index * 2 + 1] = digits[bytes[index] & 15];
  }
  NSString *result = [[NSString alloc] initWithBytes:output
                                               length:data.length * 2
                                             encoding:NSASCIIStringEncoding];
  anc_pv_zeroize(output, data.length * 2 + 1);
  free(output);
  return result;
}

static NSString *Timestamp(uint64_t seconds) {
  NSDate *date = [NSDate dateWithTimeIntervalSince1970:(NSTimeInterval)seconds];
  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  formatter.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                            NSISO8601DateFormatWithFractionalSeconds;
  return [formatter stringFromDate:date];
}

static NSData *DomainMessage(const uint8_t *domain, size_t domainLength,
                             NSData *payload) {
  NSMutableData *message = [NSMutableData dataWithBytes:domain
                                                 length:domainLength];
  [message appendData:payload];
  return message;
}

static NSData *Sign(const uint8_t *domain, size_t domainLength, NSData *payload,
                    AncPrivateVaultGuardedMemory *privateKey) {
  NSMutableData *message = (NSMutableData *)DomainMessage(domain, domainLength,
                                                          payload);
  uint8_t signature[64] = {0};
  uint8_t *signaturePointer = signature;
  __block BOOL okay = NO;
  AncPrivateVaultGuardedMemoryStatus borrow = [privateKey borrow:^BOOL(
      uint8_t *key, size_t length) {
    if (length != 64)
      return NO;
    okay = anc_pv_ed25519_sign(signaturePointer, message.bytes, message.length, key) ==
           ANC_PV_CRYPTO_OK;
    return okay;
  }];
  okay = okay && borrow == AncPrivateVaultGuardedMemoryStatusOK;
  anc_pv_zeroize(message.mutableBytes, message.length);
  NSData *result = okay ? [NSData dataWithBytes:signature length:sizeof signature]
                        : nil;
  anc_pv_zeroize(signature, sizeof signature);
  return result;
}

static BOOL DeriveEndpointKeypairs(
    AncPrivateVaultGuardedMemory *signingSeed,
    AncPrivateVaultGuardedMemory *agreementSeed, uint8_t signingPublic[32],
    AncPrivateVaultGuardedMemory **signingPrivate,
    uint8_t agreementPublic[32],
    AncPrivateVaultGuardedMemory **agreementPrivate) {
  if (signingSeed.length != 32 || agreementSeed.length != 32)
    return NO;
  AncPrivateVaultGuardedMemoryStatus memoryStatus;
  *signingPrivate = [AncPrivateVaultGuardedMemory memoryWithLength:64
                                                            status:&memoryStatus];
  if (*signingPrivate == nil)
    return NO;
  *agreementPrivate = [AncPrivateVaultGuardedMemory memoryWithLength:32
                                                              status:&memoryStatus];
  if (*agreementPrivate == nil) {
    [*signingPrivate close];
    *signingPrivate = nil;
    return NO;
  }
  __block BOOL okay = NO;
  AncPrivateVaultGuardedMemoryStatus borrow = [*signingPrivate borrow:^BOOL(
      uint8_t *privateBytes, size_t privateLength) {
    if (privateLength != 64)
      return NO;
    return [signingSeed borrow:^BOOL(uint8_t *seed, size_t seedLength) {
      if (seedLength != 32)
        return NO;
      okay = anc_pv_ed25519_seed_keypair(signingPublic, privateBytes, seed) ==
             ANC_PV_CRYPTO_OK;
      return okay;
    }] == AncPrivateVaultGuardedMemoryStatusOK && okay;
  }];
  if (borrow != AncPrivateVaultGuardedMemoryStatusOK || !okay)
    return NO;
  okay = NO;
  borrow = [*agreementPrivate borrow:^BOOL(uint8_t *privateBytes,
                                            size_t privateLength) {
    if (privateLength != 32)
      return NO;
    return [agreementSeed borrow:^BOOL(uint8_t *seed, size_t seedLength) {
      if (seedLength != 32)
        return NO;
      okay = anc_pv_box_seed_keypair(agreementPublic, privateBytes, seed) ==
             ANC_PV_CRYPTO_OK;
      return okay;
    }] == AncPrivateVaultGuardedMemoryStatusOK && okay;
  }];
  return borrow == AncPrivateVaultGuardedMemoryStatusOK && okay;
}

static BOOL CloseSecret(AncPrivateVaultGuardedMemory *memory) {
  if (memory == nil || memory.isClosed)
    return YES;
  return [memory close] == AncPrivateVaultGuardedMemoryStatusOK;
}

AncPrivateVaultPreparedGenesisArtifacts *AncPrivateVaultBuildGenesisArtifacts(
    AncPrivateVaultGuardedMemory *recoveryEntropy,
    AncPrivateVaultGuardedMemory *endpointSigningSeed,
    AncPrivateVaultGuardedMemory *endpointKeyAgreementSeed,
    AncPrivateVaultGuardedMemory *epochOneEEK, NSData *vaultId,
    NSData *ceremonyId, NSData *endpointId, NSData *recoveryWrapEnvelopeId,
    NSData *authorizationEnvelopeId, NSData *endpointEnvelopeId,
    NSData *logEntryEnvelopeId, NSData *recoveryWrapNonce,
    uint64_t recoveryWrapCreatedAt, uint64_t confirmedAt,
    uint64_t endpointCreatedAt, uint64_t logEntryCreatedAt,
    uint64_t authorizationCreatedAt,
    AncPrivateVaultGenesisBuilderStatus *status) {
  SetStatus(status, AncPrivateVaultGenesisBuilderStatusInvalidArgument);
  NSData *vault = SnapshotExact(vaultId, 16);
  NSData *ceremony = SnapshotExact(ceremonyId, 16);
  NSData *endpoint = SnapshotExact(endpointId, 16);
  NSData *wrapEnvelope = SnapshotExact(recoveryWrapEnvelopeId, 16);
  NSData *authorizationEnvelope = SnapshotExact(authorizationEnvelopeId, 16);
  NSData *endpointEnvelope = SnapshotExact(endpointEnvelopeId, 16);
  NSData *logEnvelope = SnapshotExact(logEntryEnvelopeId, 16);
  NSData *wrapNonce = SnapshotExact(recoveryWrapNonce, 24);
  uint8_t signingPublic[32] = {0};
  uint8_t agreementPublic[32] = {0};
  AncPrivateVaultGuardedMemory *signingPrivate = nil;
  AncPrivateVaultGuardedMemory *agreementPrivate = nil;
  AncPrivateVaultRecoveryAuthority *recoveryAuthority = nil;
  AncPrivateVaultPreparedGenesisArtifacts *result = nil;
  BOOL cleanupOkay = YES;

  @try {
    NSArray<NSData *> *ids = @[ vault ?: NSData.data, ceremony ?: NSData.data,
                                endpoint ?: NSData.data, wrapEnvelope ?: NSData.data,
                                authorizationEnvelope ?: NSData.data,
                                endpointEnvelope ?: NSData.data, logEnvelope ?: NSData.data ];
    BOOL validIds = YES;
    for (NSData *identifier in ids)
      validIds = validIds && [identifier isKindOfClass:NSData.class] &&
                 identifier.length == 16;
    if (!validIds || wrapNonce.length != 24 || recoveryEntropy == nil ||
        endpointSigningSeed == nil || endpointKeyAgreementSeed == nil ||
        epochOneEEK == nil || recoveryEntropy.length != 32 ||
        endpointSigningSeed.length != 32 || endpointKeyAgreementSeed.length != 32 ||
        epochOneEEK.length != 32 || recoveryEntropy.isClosed ||
        endpointSigningSeed.isClosed || endpointKeyAgreementSeed.isClosed ||
        epochOneEEK.isClosed)
      @throw [NSException exceptionWithName:@"AncInvalid" reason:nil userInfo:nil];
    if (recoveryWrapCreatedAt == 0 ||
        recoveryWrapCreatedAt > confirmedAt || confirmedAt > endpointCreatedAt ||
        endpointCreatedAt > logEntryCreatedAt ||
        logEntryCreatedAt > authorizationCreatedAt ||
        authorizationCreatedAt > kMaximumSafeInteger) {
      SetStatus(status, AncPrivateVaultGenesisBuilderStatusTimestampOrder);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }
    if (!DeriveEndpointKeypairs(endpointSigningSeed, endpointKeyAgreementSeed,
                                signingPublic, &signingPrivate, agreementPublic,
                                &agreementPrivate)) {
      SetStatus(status, AncPrivateVaultGenesisBuilderStatusCryptoFailed);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }

    AncPrivateVaultRecoveryAuthorityStatus recoveryStatus;
    recoveryAuthority = AncPrivateVaultDeriveRecoveryAuthority(
        recoveryEntropy, vault, 1, &recoveryStatus);
    if (recoveryAuthority == nil) {
      SetStatus(status, recoveryStatus == AncPrivateVaultRecoveryAuthorityStatusMemoryFailed
                            ? AncPrivateVaultGenesisBuilderStatusMemoryFailed
                            : AncPrivateVaultGenesisBuilderStatusCryptoFailed);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }
    NSData *signingPublicData = [NSData dataWithBytes:signingPublic length:32];
    NSData *agreementPublicData = [NSData dataWithBytes:agreementPublic length:32];

    __block NSData *ciphertext = nil;
    AncPrivateVaultGuardedMemoryStatus eekBorrow = [agreementPrivate borrow:^BOOL(
        uint8_t *agreementPrivateBytes, size_t agreementPrivateLength) {
      if (agreementPrivateLength != 32)
        return NO;
      return [epochOneEEK borrow:^BOOL(uint8_t *eek, size_t length) {
      if (length != 32)
        return NO;
      uint8_t plaintext[sizeof kEEKDomain + 32] = {0};
      uint8_t boxed[sizeof plaintext + 16] = {0};
      size_t boxedLength = 0;
      memcpy(plaintext, kEEKDomain, sizeof kEEKDomain);
      memcpy(plaintext + sizeof kEEKDomain, eek, 32);
      BOOL okay = anc_pv_box_wrap(boxed, sizeof boxed, &boxedLength, plaintext,
                                  sizeof plaintext, wrapNonce.bytes,
                                  recoveryAuthority.keyAgreementPublicKey.bytes,
                                  agreementPrivateBytes) == ANC_PV_CRYPTO_OK &&
                  boxedLength == 64;
      if (okay)
        ciphertext = [NSData dataWithBytes:boxed length:boxedLength];
      anc_pv_zeroize(plaintext, sizeof plaintext);
      anc_pv_zeroize(boxed, sizeof boxed);
      return okay;
      }] == AncPrivateVaultGuardedMemoryStatusOK;
    }];
    if (eekBorrow != AncPrivateVaultGuardedMemoryStatusOK || ciphertext == nil) {
      SetStatus(status, AncPrivateVaultGenesisBuilderStatusCryptoFailed);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }

    NSData *zeros = [NSMutableData dataWithLength:32];
    NSDictionary *wrapUnsignedMap = @{
      @1 : VText(@"anc/v1"), @2 : VBytes(vault), @3 : VText(@"recovery-wrap"),
      @4 : VInt(recoveryWrapCreatedAt), @5 : VBytes(wrapEnvelope),
      @400 : VBytes(ceremony), @401 : VInt(1),
      @402 : VBytes(recoveryAuthority.recoveryId),
      @403 : VBytes(recoveryAuthority.keyAgreementPublicKey), @404 : VInt(1),
      @405 : VBytes(endpoint), @406 : VInt(0), @407 : VBytes(zeros),
      @408 : VBytes(zeros), @409 : VBytes(wrapNonce), @410 : VBytes(ciphertext),
    };
    NSData *wrapUnsigned = Encode(wrapUnsignedMap);
    NSData *wrapSignature = Sign(kWrapDomain, sizeof kWrapDomain, wrapUnsigned,
                                 signingPrivate);
    NSMutableDictionary *wrapSignedMap = [wrapUnsignedMap mutableCopy];
    wrapSignedMap[@411] = VBytes(wrapSignature ?: NSData.data);
    NSData *recoveryWrap = Encode(wrapSignedMap);
    AncPrivateVaultRecoveryWrapStatus wrapStatus;
    AncPrivateVaultRecoveryWrap *verifiedWrap = AncPrivateVaultRecoveryWrapVerify(
        recoveryWrap, vault, [NSData dataWithBytes:signingPublic length:32],
        &wrapStatus);
    NSData *wrapHash = AncPrivateVaultRecoveryWrapHash(recoveryWrap, vault,
                                                       &wrapStatus);
    if (wrapUnsigned == nil || wrapSignature == nil || recoveryWrap == nil ||
        verifiedWrap == nil || wrapHash == nil) {
      SetStatus(status, AncPrivateVaultGenesisBuilderStatusVerificationFailed);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }
    __block AncPrivateVaultRecoveryWrapStatus unsealStatus =
        AncPrivateVaultRecoveryWrapStatusUnsealAuthentication;
    __block BOOL eekMatches = NO;
    AncPrivateVaultGuardedMemoryStatus recoveryBorrow =
        [recoveryAuthority.keyAgreementPrivateKey borrow:^BOOL(
            uint8_t *recoveryPrivateKey, size_t recoveryPrivateLength) {
      if (recoveryPrivateLength != 32)
        return NO;
      return [epochOneEEK borrow:^BOOL(uint8_t *expectedEEK,
                                       size_t expectedLength) {
        if (expectedLength != 32)
          return NO;
        unsealStatus = AncPrivateVaultRecoveryWrapUnseal(
            recoveryWrap, vault, signingPublicData, agreementPublicData,
            recoveryPrivateKey,
            ^BOOL(const uint8_t *openedEEK) {
          eekMatches = anc_pv_memcmp(openedEEK, expectedEEK, 32) ==
                       ANC_PV_CRYPTO_OK;
          return eekMatches;
        });
        return unsealStatus == AncPrivateVaultRecoveryWrapStatusOK && eekMatches;
      }] == AncPrivateVaultGuardedMemoryStatusOK;
    }];
    if (recoveryBorrow != AncPrivateVaultGuardedMemoryStatusOK || !eekMatches ||
        unsealStatus != AncPrivateVaultRecoveryWrapStatusOK) {
      SetStatus(status, AncPrivateVaultGenesisBuilderStatusVerificationFailed);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }

    NSDictionary *confirmationMap = @{
      @1 : VText(@"anc/v1"), @2 : VBytes(vault),
      @3 : VText(@"genesis-recovery-confirmation"), @360 : VBytes(ceremony),
      @361 : VBytes(endpoint), @362 : VBytes(recoveryAuthority.recoveryId),
      @363 : VBytes(recoveryAuthority.signingPublicKey),
      @364 : VBytes(recoveryAuthority.keyAgreementPublicKey), @365 : VBytes(wrapHash),
      @366 : VInt(confirmedAt), @367 : VInt(1),
    };
    NSData *confirmation = Encode(confirmationMap);
    AncPrivateVaultGenesisBootstrapStatus bootstrapStatus;
    NSData *confirmationHash = AncPrivateVaultGenesisRecoveryConfirmationHash(
        confirmation, vault, &bootstrapStatus);
    if (confirmation == nil || confirmationHash == nil) {
      SetStatus(status, AncPrivateVaultGenesisBuilderStatusEncodingFailed);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }

    NSDictionary *bootstrapMap = @{
      @1 : VText(@"anc/v1"), @2 : VBytes(vault),
      @3 : VText(@"genesis-bootstrap-transcript"), @380 : VBytes(ceremony),
      @381 : VBytes(endpoint), @382 : VBytes(signingPublicData),
      @383 : VBytes(agreementPublicData), @384 : VBytes(authorizationEnvelope),
      @385 : VBytes(recoveryAuthority.recoveryId),
      @386 : VBytes(recoveryAuthority.signingPublicKey),
      @387 : VBytes(recoveryAuthority.keyAgreementPublicKey), @388 : VInt(1),
      @389 : VInt(1), @390 : VBytes(wrapHash), @391 : VBytes(confirmationHash),
    };
    NSData *bootstrap = Encode(bootstrapMap);
    AncPrivateVaultGenesisBootstrapResult *bootstrapResult =
        AncPrivateVaultGenesisBootstrapVerify(bootstrap, confirmation, vault,
                                              &bootstrapStatus);
    if (bootstrapResult == nil) {
      SetStatus(status, AncPrivateVaultGenesisBuilderStatusVerificationFailed);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }

    NSDictionary *endpointUnsignedMap = @{
      @1 : VText(@"anc/v1"), @2 : VBytes(vault), @3 : VText(@"endpoint"),
      @4 : VInt(endpointCreatedAt), @5 : VBytes(endpointEnvelope),
      @10 : VBytes(endpoint), @11 : VText(@"desktop"),
      @12 : [AncPrivateVaultCanonicalValue boolean:NO],
      @13 : VBytes(signingPublicData), @14 : VBytes(agreementPublicData),
      @15 : VBytes(endpoint), @16 : VBytes(confirmationHash),
    };
    NSData *endpointUnsigned = Encode(endpointUnsignedMap);
    NSData *endpointSignature = Sign(kEndpointDomain, sizeof kEndpointDomain,
                                     endpointUnsigned, signingPrivate);
    NSMutableDictionary *endpointSignedMap = [endpointUnsignedMap mutableCopy];
    endpointSignedMap[@17] = VBytes(endpointSignature ?: NSData.data);
    NSData *encodedEndpoint = Encode(endpointSignedMap);

    NSString *vaultHex = Hex(vault), *ceremonyHex = Hex(ceremony);
    NSString *endpointHex = Hex(endpoint), *authorizationHex = Hex(authorizationEnvelope);
    AncPrivateVaultCanonicalValue *member = [AncPrivateVaultCanonicalValue array:@[
      VText(endpointHex), VText(@"endpoint"),
      [AncPrivateVaultCanonicalValue boolean:NO], VBytes(signingPublicData),
      VBytes(agreementPublicData), VText(authorizationHex),
    ]];
    NSDictionary *commitMap = @{
      @1 : VText(@"anc/v1"), @2 : VText(vaultHex),
      @3 : VText(@"membership_commit"), @140 : VText(ceremonyHex),
      @141 : VText(@"first_device"), @142 : VInt(1),
      @143 : [AncPrivateVaultCanonicalValue nullValue],
      @144 : [AncPrivateVaultCanonicalValue array:@[ member ]],
      @145 : [AncPrivateVaultCanonicalValue array:@[]],
      @146 : [AncPrivateVaultCanonicalValue boolean:NO],
      @147 : [AncPrivateVaultCanonicalValue boolean:NO],
      @148 : [AncPrivateVaultCanonicalValue nullValue],
      @149 : [AncPrivateVaultCanonicalValue nullValue], @155 : VInt(1),
      @156 : VText(Hex(recoveryAuthority.recoveryId)),
      @157 : VBytes(recoveryAuthority.signingPublicKey),
      @158 : VBytes(recoveryAuthority.keyAgreementPublicKey), @159 : VBytes(wrapHash),
    };
    NSData *commit = Encode(commitMap);
    NSString *logTimestamp = Timestamp(logEntryCreatedAt);
    NSDictionary *logUnsignedMap = @{
      @1 : VText(@"anc/v1"), @2 : VText(vaultHex), @3 : VText(@"log-entry"),
      @4 : VText(logTimestamp), @5 : VText(Hex(logEnvelope)), @110 : VInt(0),
      @111 : VBytes(zeros), @112 : VBytes(commit), @113 : VText(endpointHex),
    };
    NSData *logUnsigned = Encode(logUnsignedMap);
    NSData *logSignature = Sign(kLogDomain, sizeof kLogDomain, logUnsigned,
                                signingPrivate);
    NSMutableDictionary *logSignedMap = [logUnsignedMap mutableCopy];
    logSignedMap[@114] = VBytes(logSignature ?: NSData.data);
    NSData *signedCommit = Encode(logSignedMap);

    NSDictionary *authorizationUnsignedMap = @{
      @1 : VText(@"anc/v1"), @2 : VBytes(vault),
      @3 : VText(@"genesis-authorization"), @4 : VInt(authorizationCreatedAt),
      @5 : VBytes(authorizationEnvelope), @370 : VBytes(ceremony),
      @371 : VBytes(endpoint), @372 : VInt(1), @373 : VBytes(encodedEndpoint),
      @374 : VBytes(confirmation), @375 : VBytes(signedCommit),
    };
    NSData *authorizationUnsigned = Encode(authorizationUnsignedMap);
    NSData *authorizationSignature = Sign(kAuthorizationDomain,
                                          sizeof kAuthorizationDomain,
                                          authorizationUnsigned, signingPrivate);
    NSMutableDictionary *authorizationSignedMap =
        [authorizationUnsignedMap mutableCopy];
    authorizationSignedMap[@376] = VBytes(authorizationSignature ?: NSData.data);
    NSData *authorization = Encode(authorizationSignedMap);
    if (endpointUnsigned == nil || endpointSignature == nil || encodedEndpoint == nil ||
        commit == nil || logTimestamp == nil || logUnsigned == nil ||
        logSignature == nil || signedCommit == nil || authorizationUnsigned == nil ||
        authorizationSignature == nil || authorization == nil) {
      SetStatus(status, AncPrivateVaultGenesisBuilderStatusEncodingFailed);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }

    AncPrivateVaultGenesisAuthorizationStatus authorizationStatus;
    AncPrivateVaultGenesisAuthorizationVerifier *verifier =
        [[AncPrivateVaultGenesisAuthorizationVerifier alloc]
               initWithAuthorization:authorization
                recoveryConfirmation:confirmation
                  bootstrapTranscript:bootstrap
                       bootstrapResult:bootstrapResult
                               status:&authorizationStatus];
    AncPrivateVaultControlLogReplayResult *replayResult = nil;
    AncPrivateVaultControlLogStatus replayStatus =
        [[AncPrivateVaultControlLog new] replaySignedEntry:signedCommit
                                              currentState:nil
                                                  verifier:verifier
                                                    result:&replayResult];
    if (verifier == nil || replayStatus != AncPrivateVaultControlLogStatusOK ||
        replayResult == nil || verifier.result == nil) {
      SetStatus(status, AncPrivateVaultGenesisBuilderStatusVerificationFailed);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }
    result = [[AncPrivateVaultPreparedGenesisArtifacts alloc]
            initPrivateWithRecoveryWrap:recoveryWrap
                    recoveryConfirmation:confirmation
                      bootstrapTranscript:bootstrap
                            authorization:authorization
               bootstrapTranscriptDigest:bootstrapResult.digest];
    if (result == nil) {
      SetStatus(status, AncPrivateVaultGenesisBuilderStatusMemoryFailed);
      @throw [NSException exceptionWithName:@"AncExpected" reason:nil userInfo:nil];
    }
    SetStatus(status, AncPrivateVaultGenesisBuilderStatusOK);
  } @catch (NSException *exception) {
    if (![exception.name isEqualToString:@"AncExpected"] &&
        ![exception.name isEqualToString:@"AncInvalid"])
      SetStatus(status, AncPrivateVaultGenesisBuilderStatusEncodingFailed);
  } @finally {
    anc_pv_zeroize(signingPublic, sizeof signingPublic);
    anc_pv_zeroize(agreementPublic, sizeof agreementPublic);
    cleanupOkay = CloseSecret(signingPrivate) && cleanupOkay;
    cleanupOkay = CloseSecret(agreementPrivate) && cleanupOkay;
    cleanupOkay = CloseSecret(recoveryAuthority.signingPrivateKey) && cleanupOkay;
    cleanupOkay = CloseSecret(recoveryAuthority.keyAgreementPrivateKey) && cleanupOkay;
  }
  if (!cleanupOkay) {
    result = nil;
    SetStatus(status, AncPrivateVaultGenesisBuilderStatusCleanupFailed);
  }
  return result;
}

NSString *AncPrivateVaultGenesisBuilderCategory(
    AncPrivateVaultGenesisBuilderStatus status) {
  switch (status) {
  case AncPrivateVaultGenesisBuilderStatusOK: return @"ok";
  case AncPrivateVaultGenesisBuilderStatusInvalidArgument: return @"input.invalid";
  case AncPrivateVaultGenesisBuilderStatusTimestampOrder: return @"binding.timestamp_order";
  case AncPrivateVaultGenesisBuilderStatusMemoryFailed: return @"memory.failed";
  case AncPrivateVaultGenesisBuilderStatusCryptoFailed: return @"crypto.failed";
  case AncPrivateVaultGenesisBuilderStatusEncodingFailed: return @"wire.encoding";
  case AncPrivateVaultGenesisBuilderStatusVerificationFailed: return @"verification.failed";
  case AncPrivateVaultGenesisBuilderStatusCleanupFailed: return @"cleanup.failed";
  }
}
