#import "PrivateVaultRecoveryBuilder.h"
#import "PrivateVaultRecoveryBuilderInternal.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultControlLogInternal.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultRecoveryAuthorization.h"
#import "PrivateVaultRecoveryWrap.h"
#import "PrivateVaultRecoveryPreparationStoreInternal.h"

#include <math.h>
#include <stdlib.h>

static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);
static const uint8_t kEndpointDomain[] = "anc/v1/endpoint";
static const uint8_t kWrapDomain[] = "anc/v1/recovery-wrap";
static const uint8_t kConfirmationDomain[] =
    "anc/v1/recovery-replacement-confirmation";
static const uint8_t kAuthorizationDomain[] =
    "anc/v1/recovery-authorization";
static const uint8_t kRecoveryDomain[] = "anc/v1/recovery";
static const uint8_t kLogDomain[] = "anc/v1/log-entry";

@interface AncPrivateVaultPreparedRecoveryArtifacts ()
- (instancetype)initPrivateWithSignedEntry:(NSData *)signedEntry
                              recoveryWrap:(NSData *)recoveryWrap
                           currentSnapshot:(NSData *)currentSnapshot
                      currentStateSnapshot:(NSData *)currentStateSnapshot
                     recoveryAuthorization:(NSData *)recoveryAuthorization
                                 entryHash:(NSData *)entryHash
                         authorizationHash:(NSData *)authorizationHash
                              snapshotHash:(NSData *)snapshotHash
                       candidateEndpointId:(NSData *)candidateEndpointId
                candidateSigningPublicKey:(NSData *)candidateSigningPublicKey
           candidateKeyAgreementPublicKey:
               (NSData *)candidateKeyAgreementPublicKey
                                ceremonyId:(NSData *)ceremonyId
                                   entryId:(NSString *)entryId
                                 nextState:
                                     (AncPrivateVaultControlLogState *)nextState;
@end

@implementation AncPrivateVaultPreparedRecoveryArtifacts
@synthesize signedEntry = _signedEntry;
@synthesize recoveryWrap = _recoveryWrap;
@synthesize currentSnapshot = _currentSnapshot;
@synthesize currentStateSnapshot = _currentStateSnapshot;
@synthesize recoveryAuthorization = _recoveryAuthorization;
@synthesize entryHash = _entryHash;
@synthesize authorizationHash = _authorizationHash;
@synthesize snapshotHash = _snapshotHash;
@synthesize candidateEndpointId = _candidateEndpointId;
@synthesize candidateSigningPublicKey = _candidateSigningPublicKey;
@synthesize candidateKeyAgreementPublicKey = _candidateKeyAgreementPublicKey;
@synthesize ceremonyId = _ceremonyId;
@synthesize entryId = _entryId;
@synthesize nextState = _nextState;
+ (BOOL)accessInstanceVariablesDirectly { return NO; }
- (instancetype)initPrivateWithSignedEntry:(NSData *)signedEntry
                              recoveryWrap:(NSData *)recoveryWrap
                           currentSnapshot:(NSData *)currentSnapshot
                      currentStateSnapshot:(NSData *)currentStateSnapshot
                     recoveryAuthorization:(NSData *)recoveryAuthorization
                                 entryHash:(NSData *)entryHash
                         authorizationHash:(NSData *)authorizationHash
                              snapshotHash:(NSData *)snapshotHash
                       candidateEndpointId:(NSData *)candidateEndpointId
                candidateSigningPublicKey:(NSData *)candidateSigningPublicKey
           candidateKeyAgreementPublicKey:
               (NSData *)candidateKeyAgreementPublicKey
                                ceremonyId:(NSData *)ceremonyId
                                   entryId:(NSString *)entryId
                                 nextState:
                                     (AncPrivateVaultControlLogState *)nextState {
  self = [super init];
  if (self != nil) {
    _signedEntry = [signedEntry copy];
    _recoveryWrap = [recoveryWrap copy];
    _currentSnapshot = [currentSnapshot copy];
    _currentStateSnapshot = [currentStateSnapshot copy];
    _recoveryAuthorization = [recoveryAuthorization copy];
    _entryHash = [entryHash copy];
    _authorizationHash = [authorizationHash copy];
    _snapshotHash = [snapshotHash copy];
    _candidateEndpointId = [candidateEndpointId copy];
    _candidateSigningPublicKey = [candidateSigningPublicKey copy];
    _candidateKeyAgreementPublicKey =
        [candidateKeyAgreementPublicKey copy];
    _ceremonyId = [ceremonyId copy];
    _entryId = [entryId copy];
    _nextState = nextState;
  }
  return self;
}
@end

@interface AncPrivateVaultRecoveryBuilderEvidence : NSObject
@property(nonatomic) AncPrivateVaultControlLogState *currentState;
@property(nonatomic) AncPrivateVaultControlLogState *nextState;
@property(nonatomic) NSData *entryHash;
@property(nonatomic) NSData *authorizationHash;
@property(nonatomic) NSData *ceremonyId;
@property(nonatomic) NSData *candidateEndpointId;
@property(nonatomic) NSData *candidateSigningPublicKey;
@property(nonatomic) NSData *candidateKeyAgreementPublicKey;
@property(nonatomic) NSData *currentStateSnapshot;
@end
@implementation AncPrivateVaultRecoveryBuilderEvidence
@end

static NSMapTable<AncPrivateVaultPreparedRecoveryArtifacts *,
                  AncPrivateVaultRecoveryBuilderEvidence *> *
RecoveryBuilderRegistry(void) {
  static NSMapTable *registry;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    registry = [NSMapTable weakToStrongObjectsMapTable];
  });
  return registry;
}
static NSLock *RecoveryBuilderRegistryLock(void) {
  static NSLock *lock;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ lock = [NSLock new]; });
  return lock;
}

BOOL AncPrivateVaultPreparedRecoveryArtifactsCopyEvidence(
    AncPrivateVaultPreparedRecoveryArtifacts *artifacts,
    AncPrivateVaultControlLogState **currentState,
    AncPrivateVaultControlLogState **nextState, NSData **entryHash,
    NSData **authorizationHash, NSData **ceremonyId,
    NSData **candidateEndpointId, NSData **candidateSigningPublicKey,
    NSData **candidateKeyAgreementPublicKey) {
  if (currentState == NULL || nextState == NULL || entryHash == NULL ||
      authorizationHash == NULL || ceremonyId == NULL ||
      candidateEndpointId == NULL || candidateSigningPublicKey == NULL ||
      candidateKeyAgreementPublicKey == NULL)
    return NO;
  *currentState = nil;
  *nextState = nil;
  *entryHash = nil;
  *authorizationHash = nil;
  *ceremonyId = nil;
  *candidateEndpointId = nil;
  *candidateSigningPublicKey = nil;
  *candidateKeyAgreementPublicKey = nil;
  NSLock *lock = RecoveryBuilderRegistryLock();
  [lock lock];
  AncPrivateVaultRecoveryBuilderEvidence *evidence =
      [RecoveryBuilderRegistry() objectForKey:artifacts];
  if (evidence != nil &&
      [artifacts.nextState isEqual:evidence.nextState] &&
      [artifacts.entryHash isEqualToData:evidence.entryHash] &&
      [artifacts.authorizationHash
          isEqualToData:evidence.authorizationHash] &&
      [artifacts.ceremonyId isEqualToData:evidence.ceremonyId] &&
      [artifacts.candidateEndpointId
          isEqualToData:evidence.candidateEndpointId] &&
      [artifacts.candidateSigningPublicKey
          isEqualToData:evidence.candidateSigningPublicKey] &&
      [artifacts.candidateKeyAgreementPublicKey
          isEqualToData:evidence.candidateKeyAgreementPublicKey] &&
      [artifacts.currentStateSnapshot
          isEqualToData:evidence.currentStateSnapshot]) {
    *currentState = evidence.currentState;
    *nextState = evidence.nextState;
    *entryHash = [evidence.entryHash copy];
    *authorizationHash = [evidence.authorizationHash copy];
    *ceremonyId = [evidence.ceremonyId copy];
    *candidateEndpointId = [evidence.candidateEndpointId copy];
    *candidateSigningPublicKey = [evidence.candidateSigningPublicKey copy];
    *candidateKeyAgreementPublicKey =
        [evidence.candidateKeyAgreementPublicKey copy];
  }
  [lock unlock];
  return *currentState != nil && *nextState != nil && (*entryHash).length == 32;
}

static void SetStatus(AncPrivateVaultRecoveryBuilderStatus *status,
                      AncPrivateVaultRecoveryBuilderStatus value) {
  if (status != NULL)
    *status = value;
}
static AncPrivateVaultCanonicalValue *T(NSString *value) {
  return [AncPrivateVaultCanonicalValue text:value];
}
static AncPrivateVaultCanonicalValue *B(NSData *value) {
  return [AncPrivateVaultCanonicalValue bytes:value];
}
static AncPrivateVaultCanonicalValue *I(uint64_t value) {
  return value <= INT64_MAX
             ? [AncPrivateVaultCanonicalValue integer:(int64_t)value]
             : nil;
}
static AncPrivateVaultCanonicalValue *A(
    NSArray<AncPrivateVaultCanonicalValue *> *value) {
  return [AncPrivateVaultCanonicalValue array:value];
}
static NSData *Encode(
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map) {
  AncPrivateVaultCanonicalStatus status;
  return AncPrivateVaultCanonicalEncode([AncPrivateVaultCanonicalValue map:map],
                                        &status);
}
static NSData *Exact(NSData *value, NSUInteger length) {
  if (![value isKindOfClass:NSData.class] || value.length != length)
    return nil;
  return [NSData dataWithBytes:value.bytes length:length];
}
static NSData *HexData(NSString *hex, NSUInteger length) {
  if (![hex isKindOfClass:NSString.class] || hex.length != length * 2)
    return nil;
  NSMutableData *data = [NSMutableData dataWithLength:length];
  uint8_t *output = data.mutableBytes;
  for (NSUInteger index = 0; index < length; index++) {
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
static NSString *Hex(NSData *data) {
  if (![data isKindOfClass:NSData.class])
    return nil;
  static const char digits[] = "0123456789abcdef";
  NSMutableData *encoded = [NSMutableData dataWithLength:data.length * 2];
  const uint8_t *input = data.bytes;
  uint8_t *output = encoded.mutableBytes;
  for (NSUInteger index = 0; index < data.length; index++) {
    output[index * 2] = digits[input[index] >> 4];
    output[index * 2 + 1] = digits[input[index] & 15];
  }
  return [[NSString alloc] initWithData:encoded
                               encoding:NSASCIIStringEncoding];
}
static NSString *Timestamp(uint64_t seconds) {
  NSDate *date = [NSDate dateWithTimeIntervalSince1970:(NSTimeInterval)seconds];
  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  formatter.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                            NSISO8601DateFormatWithFractionalSeconds;
  return [formatter stringFromDate:date];
}
static NSData *Hash(const uint8_t *domain, size_t domainLength,
                    NSData *payload) {
  uint8_t digest[32] = {0};
  BOOL okay = payload != nil &&
              anc_pv_blake2b_256_two_part(digest, domain, domainLength,
                                          payload.bytes, payload.length) ==
                  ANC_PV_CRYPTO_OK;
  NSData *result =
      okay ? [NSData dataWithBytes:digest length:sizeof digest] : nil;
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

NSData *AncPrivateVaultRecoveryPreparationArtifactsCommitment(
    NSData *signedEntry, NSData *recoveryWrap, NSData *currentSnapshot,
    NSData *currentStateSnapshot, NSData *recoveryAuthorization) {
  if (![signedEntry isKindOfClass:NSData.class] || signedEntry.length == 0 ||
      signedEntry.length > 262144 ||
      ![recoveryWrap isKindOfClass:NSData.class] || recoveryWrap.length == 0 ||
      recoveryWrap.length > 1048576 ||
      ![currentSnapshot isKindOfClass:NSData.class] ||
      currentSnapshot.length == 0 || currentSnapshot.length > 65536 ||
      ![currentStateSnapshot isKindOfClass:NSData.class] ||
      currentStateSnapshot.length == 0 ||
      currentStateSnapshot.length > 65536 ||
      ![recoveryAuthorization isKindOfClass:NSData.class] ||
      recoveryAuthorization.length == 0 ||
      recoveryAuthorization.length > 1048576)
    return nil;
  static const uint8_t domain[] =
      "anc/v1/recovery-preparation-artifacts";
  NSData *encoded =
      Encode(@{@1 : B(signedEntry), @2 : B(recoveryWrap),
               @3 : B(currentSnapshot), @4 : B(currentStateSnapshot),
               @5 : B(recoveryAuthorization)});
  return Hash(domain, sizeof domain, encoded);
}
static NSData *Sign(const uint8_t *domain, size_t domainLength, NSData *payload,
                    AncPrivateVaultGuardedMemory *privateKey) {
  if (payload == nil || privateKey == nil || privateKey.isClosed)
    return nil;
  NSMutableData *message = [NSMutableData dataWithBytes:domain
                                                  length:domainLength];
  [message appendData:payload];
  uint8_t signature[64] = {0};
  uint8_t *signaturePointer = signature;
  __block BOOL signedValue = NO;
  AncPrivateVaultGuardedMemoryStatus borrowed = [privateKey
      borrow:^BOOL(uint8_t *key, size_t length) {
        signedValue = length == 64 &&
                      anc_pv_ed25519_sign(signaturePointer, message.bytes,
                                          message.length, key) ==
                          ANC_PV_CRYPTO_OK;
        return signedValue;
      }];
  anc_pv_zeroize(message.mutableBytes, message.length);
  NSData *result = borrowed == AncPrivateVaultGuardedMemoryStatusOK &&
                           signedValue
                       ? [NSData dataWithBytes:signature length:64]
                       : nil;
  anc_pv_zeroize(signature, sizeof signature);
  return result;
}
static BOOL DeriveEndpoint(AncPrivateVaultGuardedMemory *signingSeed,
                           AncPrivateVaultGuardedMemory *agreementSeed,
                           uint8_t signingPublic[32],
                           AncPrivateVaultGuardedMemory **signingPrivate,
                           uint8_t agreementPublic[32],
                           AncPrivateVaultGuardedMemory **agreementPrivate) {
  AncPrivateVaultGuardedMemoryStatus status;
  *signingPrivate = [AncPrivateVaultGuardedMemory memoryWithLength:64
                                                            status:&status];
  *agreementPrivate = [AncPrivateVaultGuardedMemory memoryWithLength:32
                                                              status:&status];
  if (*signingPrivate == nil || *agreementPrivate == nil)
    return NO;
  __block BOOL okay = NO;
  BOOL signingOkay = [*signingPrivate
      borrow:^BOOL(uint8_t *privateKey, size_t privateLength) {
        return [signingSeed borrow:^BOOL(uint8_t *seed, size_t seedLength) {
          okay = privateLength == 64 && seedLength == 32 &&
                 anc_pv_ed25519_seed_keypair(signingPublic, privateKey, seed) ==
                     ANC_PV_CRYPTO_OK;
          return okay;
        }] == AncPrivateVaultGuardedMemoryStatusOK && okay;
      }] == AncPrivateVaultGuardedMemoryStatusOK && okay;
  okay = NO;
  BOOL agreementOkay = [*agreementPrivate
      borrow:^BOOL(uint8_t *privateKey, size_t privateLength) {
        return [agreementSeed borrow:^BOOL(uint8_t *seed, size_t seedLength) {
          okay = privateLength == 32 && seedLength == 32 &&
                 anc_pv_box_seed_keypair(agreementPublic, privateKey, seed) ==
                     ANC_PV_CRYPTO_OK;
          return okay;
        }] == AncPrivateVaultGuardedMemoryStatusOK && okay;
      }] == AncPrivateVaultGuardedMemoryStatusOK && okay;
  return signingOkay && agreementOkay;
}
static AncPrivateVaultCanonicalValue *MemberValue(
    NSString *endpointId, NSData *signingPublic, NSData *agreementPublic,
    NSString *enrollmentRef) {
  return A(@[
    T(endpointId), T(@"endpoint"),
    [AncPrivateVaultCanonicalValue boolean:NO], B(signingPublic),
    B(agreementPublic), T(enrollmentRef)
  ]);
}

AncPrivateVaultPreparedRecoveryArtifacts *
AncPrivateVaultBuildRecoveryArtifacts(
    AncPrivateVaultBootstrapReplay *replay,
    AncPrivateVaultGuardedMemory *endpointSigningSeed,
    AncPrivateVaultGuardedMemory *endpointKeyAgreementSeed, NSData *ceremonyId,
    NSData *candidateEndpointId, NSData *candidateEnvelopeId,
    NSData *replacementWrapEnvelopeId, NSData *confirmationEnvelopeId,
    NSData *authorizationEnvelopeId, NSData *logEntryEnvelopeId,
    NSData *replacementWrapNonce, NSData *confirmationNonce,
    uint64_t trustedNowMilliseconds,
    AncPrivateVaultRecoveryBuilderStatus *status) {
  SetStatus(status, AncPrivateVaultRecoveryBuilderStatusInvalidArgument);
  NSData *ceremony = Exact(ceremonyId, 16);
  NSData *candidateId = Exact(candidateEndpointId, 16);
  NSData *candidateEnvelope = Exact(candidateEnvelopeId, 16);
  NSData *wrapEnvelope = Exact(replacementWrapEnvelopeId, 16);
  NSData *confirmationEnvelope = Exact(confirmationEnvelopeId, 16);
  NSData *authorizationEnvelope = Exact(authorizationEnvelopeId, 16);
  NSData *logEnvelope = Exact(logEntryEnvelopeId, 16);
  NSData *wrapNonce = Exact(replacementWrapNonce, 24);
  NSData *nonce = Exact(confirmationNonce, 32);
  AncPrivateVaultControlLogState *current = replay.state;
  AncPrivateVaultRecoveryAuthority *consumed =
      replay.currentRecoveryAuthority;
  AncPrivateVaultRecoveryAuthority *replacement =
      replay.replacementRecoveryAuthority;
  NSData *vault = HexData(current.vaultId, 16);
  uint64_t base = trustedNowMilliseconds / 1000;
  if (replay == nil || !replay.isComplete || replay.verifiedEEK == nil ||
      replay.verifiedEEK.isClosed || current == nil || consumed == nil ||
      replacement == nil || endpointSigningSeed.length != 32 ||
      endpointSigningSeed.isClosed || endpointKeyAgreementSeed.length != 32 ||
      endpointKeyAgreementSeed.isClosed || ceremony == nil ||
      candidateId == nil || candidateEnvelope == nil || wrapEnvelope == nil ||
      confirmationEnvelope == nil || authorizationEnvelope == nil ||
      logEnvelope == nil || wrapNonce == nil || nonce == nil || vault == nil ||
      base == 0 || base > kMaximumSafeInteger - 604 ||
      current.sequence == kMaximumSafeInteger ||
      current.epoch == kMaximumSafeInteger ||
      current.recoveryGeneration == kMaximumSafeInteger ||
      replacement.recoveryGeneration != current.recoveryGeneration + 1)
    return nil;

  uint8_t signingPublicBytes[32] = {0};
  uint8_t agreementPublicBytes[32] = {0};
  AncPrivateVaultGuardedMemory *signingPrivate = nil;
  AncPrivateVaultGuardedMemory *agreementPrivate = nil;
  AncPrivateVaultPreparedRecoveryArtifacts *result = nil;
  BOOL cleanup = YES;
  @try {
    if (!DeriveEndpoint(endpointSigningSeed, endpointKeyAgreementSeed,
                        signingPublicBytes, &signingPrivate,
                        agreementPublicBytes, &agreementPrivate)) {
      SetStatus(status, AncPrivateVaultRecoveryBuilderStatusCrypto);
      @throw [NSException exceptionWithName:@"AncCrypto"
                                     reason:nil
                                   userInfo:nil];
    }
    NSData *signingPublic =
        [NSData dataWithBytes:signingPublicBytes length:32];
    NSData *agreementPublic =
        [NSData dataWithBytes:agreementPublicBytes length:32];
    NSMutableArray<NSData *> *priorIds =
        [NSMutableArray arrayWithCapacity:current.activeMembers.count];
    BOOL hasBroker = NO;
    for (AncPrivateVaultControlLogMember *member in current.activeMembers) {
      NSData *identifier = HexData(member.endpointId, 16);
      if (identifier == nil)
        @throw [NSException exceptionWithName:@"AncEncoding"
                                       reason:nil
                                     userInfo:nil];
      [priorIds addObject:identifier];
      hasBroker = hasBroker || [member.role isEqualToString:@"broker"];
    }
    [priorIds sortUsingComparator:^NSComparisonResult(NSData *left,
                                                       NSData *right) {
      NSUInteger shared = MIN(left.length, right.length);
      int compared = memcmp(left.bytes, right.bytes, shared);
      if (compared < 0)
        return NSOrderedAscending;
      if (compared > 0)
        return NSOrderedDescending;
      return left.length < right.length ? NSOrderedAscending
             : left.length > right.length ? NSOrderedDescending
                                           : NSOrderedSame;
    }];
    NSMutableArray *priorValues =
        [NSMutableArray arrayWithCapacity:priorIds.count];
    NSMutableArray *removed =
        [NSMutableArray arrayWithCapacity:priorIds.count];
    for (NSData *identifier in priorIds) {
      [priorValues addObject:B(identifier)];
      [removed addObject:T(Hex(identifier))];
    }
    NSData *snapshot = Encode(@{
      @1 : T(@"anc/v1"), @2 : B(vault), @3 : T(@"recovery-snapshot"),
      @220 : I(current.sequence), @221 : B(current.headHash),
      @222 : B(current.membershipHash), @223 : A(priorValues),
    });
    NSData *stateSnapshot =
        AncPrivateVaultControlLogStatePersistenceEncode(current);
    NSData *snapshotHash =
        Hash(kRecoveryDomain, sizeof kRecoveryDomain, snapshot);
    uint64_t newEpoch = current.epoch + 1;
    NSData *candidateTranscript = Encode(@{
      @1 : T(@"anc/v1"), @2 : B(vault), @440 : B(ceremony),
      @445 : B(snapshotHash), @442 : B(consumed.recoveryId),
      @10 : B(candidateId), @13 : B(signingPublic),
      @14 : B(agreementPublic), @450 : I(newEpoch),
    });
    NSData *candidateTranscriptHash =
        Hash(kAuthorizationDomain, sizeof kAuthorizationDomain,
             candidateTranscript);
    NSMutableDictionary *candidateMap = [@{
      @1 : T(@"anc/v1"), @2 : B(vault), @3 : T(@"endpoint"),
      @4 : I(base), @5 : B(candidateEnvelope), @10 : B(candidateId),
      @11 : T(@"endpoint"),
      @12 : [AncPrivateVaultCanonicalValue boolean:NO],
      @13 : B(signingPublic), @14 : B(agreementPublic),
      @15 : B(consumed.recoveryId), @16 : B(candidateTranscriptHash),
    } mutableCopy];
    NSData *candidateUnsigned = Encode(candidateMap);
    candidateMap[@17] = B(Sign(kEndpointDomain, sizeof kEndpointDomain,
                               candidateUnsigned,
                               consumed.signingPrivateKey));
    NSData *candidate = Encode(candidateMap);

    uint8_t plaintext[48] = {0};
    memcpy(plaintext, "anc/v1/eek-wrap", 16);
    uint8_t ciphertext[64] = {0};
    uint8_t *ciphertextPointer = ciphertext;
    uint8_t *plaintextPointer = plaintext;
    __block BOOL wrapped = NO;
    NSData *replacementPublic = replacement.keyAgreementPublicKey;
    NSData *wrapNonceCopy = wrapNonce;
    AncPrivateVaultGuardedMemoryStatus wrapBorrow = [agreementPrivate
        borrow:^BOOL(uint8_t *agreementKey, size_t agreementLength) {
          return [replay.verifiedEEK borrow:^BOOL(uint8_t *eek,
                                                  size_t eekLength) {
            size_t written = 0;
            if (eekLength == 32)
              memcpy(plaintextPointer + 16, eek, 32);
            wrapped = agreementLength == 32 && eekLength == 32 &&
                      anc_pv_box_wrap(
                          ciphertextPointer, 64, &written, plaintextPointer, 48,
                          wrapNonceCopy.bytes, replacementPublic.bytes,
                          agreementKey) == ANC_PV_CRYPTO_OK &&
                      written == sizeof ciphertext;
            return wrapped;
          }] == AncPrivateVaultGuardedMemoryStatusOK && wrapped;
        }];
    anc_pv_zeroize(plaintext, sizeof plaintext);
    if (wrapBorrow != AncPrivateVaultGuardedMemoryStatusOK || !wrapped)
      @throw [NSException exceptionWithName:@"AncCrypto"
                                     reason:nil
                                   userInfo:nil];
    NSMutableDictionary *wrapMap = [@{
      @1 : T(@"anc/v1"), @2 : B(vault), @3 : T(@"recovery-wrap"),
      @4 : I(base + 1), @5 : B(wrapEnvelope), @400 : B(ceremony),
      @401 : I(replacement.recoveryGeneration),
      @402 : B(replacement.recoveryId),
      @403 : B(replacement.keyAgreementPublicKey), @404 : I(newEpoch),
      @405 : B(candidateId), @406 : I(current.sequence + 1),
      @407 : B(current.headHash), @408 : B(current.membershipHash),
      @409 : B(wrapNonce),
      @410 : B([NSData dataWithBytes:ciphertext length:sizeof ciphertext]),
    } mutableCopy];
    anc_pv_zeroize(ciphertext, sizeof ciphertext);
    NSData *wrapUnsigned = Encode(wrapMap);
    wrapMap[@411] = B(Sign(kWrapDomain, sizeof kWrapDomain, wrapUnsigned,
                           signingPrivate));
    NSData *replacementWrap = Encode(wrapMap);
    NSData *replacementWrapHash =
        Hash(kWrapDomain, sizeof kWrapDomain, replacementWrap);

    NSMutableDictionary *confirmationMap = [@{
      @1 : T(@"anc/v1"), @2 : B(vault),
      @3 : T(@"recovery-replacement-confirmation"), @4 : I(base + 2),
      @5 : B(confirmationEnvelope), @420 : B(ceremony),
      @421 : I(current.recoveryGeneration), @422 : B(consumed.recoveryId),
      @423 : I(replacement.recoveryGeneration),
      @424 : B(replacement.recoveryId),
      @425 : B(replacement.signingPublicKey),
      @426 : B(replacement.keyAgreementPublicKey),
      @427 : B(replacementWrapHash), @428 : B(candidateId),
      @429 : I(newEpoch), @430 : B(nonce),
    } mutableCopy];
    NSData *confirmationUnsigned = Encode(confirmationMap);
    confirmationMap[@431] = B(Sign(
        kConfirmationDomain, sizeof kConfirmationDomain, confirmationUnsigned,
        replacement.signingPrivateKey));
    NSData *confirmation = Encode(confirmationMap);

    NSMutableDictionary *authorizationMap = [@{
      @1 : T(@"anc/v1"), @2 : B(vault),
      @3 : T(@"recovery-authorization"), @4 : I(base + 3),
      @5 : B(authorizationEnvelope), @440 : B(ceremony),
      @441 : I(current.recoveryGeneration), @442 : B(consumed.recoveryId),
      @443 : B(consumed.signingPublicKey),
      @444 : B(consumed.keyAgreementPublicKey), @445 : B(snapshotHash),
      @446 : B(current.recoveryWrapHash), @447 : B(candidate),
      @448 : B(confirmation), @449 : B(replacementWrap),
      @450 : I(newEpoch), @451 : I(base + 603),
    } mutableCopy];
    NSData *authorizationUnsigned = Encode(authorizationMap);
    authorizationMap[@452] = B(Sign(
        kAuthorizationDomain, sizeof kAuthorizationDomain,
        authorizationUnsigned, consumed.signingPrivateKey));
    NSData *authorization = Encode(authorizationMap);
    NSData *authorizationHash =
        Hash(kAuthorizationDomain, sizeof kAuthorizationDomain, authorization);
    NSString *candidateHex = Hex(candidateId);
    NSString *authorizationHex = Hex(authorizationEnvelope);
    NSString *ceremonyHex = Hex(ceremony);
    AncPrivateVaultCanonicalValue *member =
        MemberValue(candidateHex, signingPublic, agreementPublic,
                    authorizationHex);
    NSDictionary *innerMap = @{
      @1 : T(@"anc/v1"), @2 : T(current.vaultId),
      @3 : T(@"membership_commit"), @140 : T(ceremonyHex),
      @141 : T(@"recovery"), @142 : I(newEpoch),
      @143 : B(current.membershipHash), @144 : A(@[ member ]),
      @145 : A(removed),
      @146 : [AncPrivateVaultCanonicalValue boolean:YES],
      @147 : [AncPrivateVaultCanonicalValue boolean:hasBroker],
      @148 : B(snapshotHash), @149 : B(authorizationHash),
      @155 : I(replacement.recoveryGeneration),
      @156 : T(Hex(replacement.recoveryId)),
      @157 : B(replacement.signingPublicKey),
      @158 : B(replacement.keyAgreementPublicKey),
      @159 : B(replacementWrapHash),
    };
    NSData *inner = Encode(innerMap);
    NSMutableDictionary *entryMap = [@{
      @1 : T(@"anc/v1"), @2 : T(current.vaultId), @3 : T(@"log-entry"),
      @4 : T(Timestamp(base + 4)), @5 : T(Hex(logEnvelope)),
      @110 : I(current.sequence + 1), @111 : B(current.headHash),
      @112 : B(inner), @113 : T(candidateHex),
    } mutableCopy];
    NSData *entryUnsigned = Encode(entryMap);
    entryMap[@114] =
        B(Sign(kLogDomain, sizeof kLogDomain, entryUnsigned, signingPrivate));
    NSData *signedEntry = Encode(entryMap);

    AncPrivateVaultRecoveryAuthorizationStatus verifierStatus;
    AncPrivateVaultRecoveryAuthorizationVerifier *verifier =
        [[AncPrivateVaultRecoveryAuthorizationVerifier alloc]
             initWithAuthorization:authorization
                   currentSnapshot:snapshot
               currentRecoveryWrap:replay.currentRecoveryWrap
                 consumedAuthority:consumed
              replacementAuthority:replacement
           trustedNowMilliseconds:trustedNowMilliseconds
                             status:&verifierStatus];
    AncPrivateVaultControlLogReplayResult *replayed = nil;
    AncPrivateVaultControlLogStatus replayStatus =
        verifier == nil
            ? AncPrivateVaultControlLogStatusRecoveryAuthorizationRequired
            : [[AncPrivateVaultControlLog new]
                  replaySignedEntry:signedEntry
                       currentState:current
                           verifier:verifier
                             result:&replayed];
    NSData *entryHash = AncPrivateVaultControlLogSignedEntryDomainHash(
        signedEntry);
    if (snapshot == nil || stateSnapshot == nil || snapshotHash == nil ||
        candidate == nil ||
        replacementWrap == nil || replacementWrapHash == nil ||
        confirmation == nil || authorization == nil ||
        authorizationHash == nil || inner == nil || signedEntry == nil ||
        entryHash == nil || verifier.result == nil ||
        verifierStatus != AncPrivateVaultRecoveryAuthorizationStatusOK ||
        replayStatus != AncPrivateVaultControlLogStatusOK || replayed == nil ||
        ![replayed.entryHash isEqualToData:entryHash] ||
        ![replayed.state.recoveryWrapHash isEqualToData:replacementWrapHash]) {
      SetStatus(status, AncPrivateVaultRecoveryBuilderStatusVerification);
      @throw [NSException exceptionWithName:@"AncVerification"
                                     reason:nil
                                   userInfo:nil];
    }
    result = [[AncPrivateVaultPreparedRecoveryArtifacts alloc]
        initPrivateWithSignedEntry:signedEntry
                     recoveryWrap:replacementWrap
                  currentSnapshot:snapshot
             currentStateSnapshot:stateSnapshot
            recoveryAuthorization:authorization
                        entryHash:entryHash
                authorizationHash:authorizationHash
                     snapshotHash:snapshotHash
              candidateEndpointId:candidateId
       candidateSigningPublicKey:signingPublic
  candidateKeyAgreementPublicKey:agreementPublic
                       ceremonyId:ceremony
                          entryId:Hex(logEnvelope)
                        nextState:replayed.state];
    AncPrivateVaultRecoveryBuilderEvidence *evidence =
        [AncPrivateVaultRecoveryBuilderEvidence new];
    evidence.currentState = current;
    evidence.nextState = replayed.state;
    evidence.entryHash = [entryHash copy];
    evidence.authorizationHash = [authorizationHash copy];
    evidence.ceremonyId = [ceremony copy];
    evidence.candidateEndpointId = [candidateId copy];
    evidence.candidateSigningPublicKey = [signingPublic copy];
    evidence.candidateKeyAgreementPublicKey = [agreementPublic copy];
    evidence.currentStateSnapshot = [stateSnapshot copy];
    NSLock *registryLock = RecoveryBuilderRegistryLock();
    [registryLock lock];
    BOOL registered = RecoveryBuilderRegistry().count < 1024 && result != nil;
    if (registered)
      [RecoveryBuilderRegistry() setObject:evidence forKey:result];
    [registryLock unlock];
    if (!registered)
      @throw [NSException exceptionWithName:@"AncEncoding"
                                     reason:nil
                                   userInfo:nil];
    SetStatus(status, AncPrivateVaultRecoveryBuilderStatusOK);
  } @catch (__unused NSException *exception) {
    if (status == NULL || *status == AncPrivateVaultRecoveryBuilderStatusInvalidArgument)
      SetStatus(status, AncPrivateVaultRecoveryBuilderStatusEncoding);
    result = nil;
  } @finally {
    BOOL signingClosed =
        signingPrivate == nil || signingPrivate.isClosed ||
        [signingPrivate close] == AncPrivateVaultGuardedMemoryStatusOK;
    BOOL agreementClosed =
        agreementPrivate == nil || agreementPrivate.isClosed ||
        [agreementPrivate close] == AncPrivateVaultGuardedMemoryStatusOK;
    cleanup = signingClosed && agreementClosed;
    anc_pv_zeroize(signingPublicBytes, sizeof signingPublicBytes);
    anc_pv_zeroize(agreementPublicBytes, sizeof agreementPublicBytes);
  }
  if (!cleanup) {
    SetStatus(status, AncPrivateVaultRecoveryBuilderStatusCleanup);
    return nil;
  }
  return result;
}

@interface AncPersistedRecoveryAuthorizationVerifier
    : NSObject <AncPrivateVaultControlLogAuthorizationVerifier>
@property(nonatomic) NSData *signedEntry;
@property(nonatomic) NSData *currentStateCanonical;
@property(nonatomic) NSData *snapshotHash;
@property(nonatomic) NSData *authorizationHash;
@property(nonatomic) NSString *ceremonyId;
@property(nonatomic) NSString *candidateEndpointId;
@property(nonatomic) NSData *candidateSigningPublicKey;
@property(nonatomic) NSData *candidateAgreementPublicKey;
@property(nonatomic) NSData *recoveryWrapHash;
@property(nonatomic) uint64_t nextEpoch;
@property(nonatomic) uint64_t replacementRecoveryGeneration;
@end

@implementation AncPersistedRecoveryAuthorizationVerifier
- (BOOL)verifyRecoveryMembershipCommit:
            (AncPrivateVaultControlLogMembershipCommit *)commit
                            signedEntry:
                                (AncPrivateVaultControlLogSignedEntry *)entry
                           currentState:
                               (AncPrivateVaultControlLogState *)state
                       signedEntryBytes:(NSData *)signedEntryBytes
                     innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  NSData *presentedState =
      AncPrivateVaultControlLogStatePersistenceEncode(state);
  AncPrivateVaultControlLogMember *member =
      commit.activeMembers.count == 1 ? commit.activeMembers.firstObject : nil;
  return [signedEntryBytes isEqualToData:self.signedEntry] &&
         [presentedState isEqualToData:self.currentStateCanonical] &&
         [entry.innerEnvelopeBytes isEqualToData:innerEnvelopeBytes] &&
         [entry.envelopeId
             isEqualToString:
                 AncPrivateVaultControlLogSignedEntryEnvelopeId(
                     self.signedEntry)] &&
         [entry.signerEndpointId
             isEqualToString:self.candidateEndpointId] &&
         [commit.ceremonyKind isEqualToString:@"recovery"] &&
         [commit.ceremonyId isEqualToString:self.ceremonyId] &&
         commit.epoch == self.nextEpoch &&
         [commit.recoverySnapshotHash isEqualToData:self.snapshotHash] &&
         [commit.recoveryAuthorizationHash
             isEqualToData:self.authorizationHash] &&
         commit.recoveryGeneration ==
             self.replacementRecoveryGeneration &&
         [commit.recoveryWrapHash isEqualToData:self.recoveryWrapHash] &&
         member != nil &&
         [member.endpointId isEqualToString:self.candidateEndpointId] &&
         [member.role isEqualToString:@"endpoint"] && !member.unattended &&
         [member.signingPublicKey
             isEqualToData:self.candidateSigningPublicKey] &&
         [member.keyAgreementPublicKey
             isEqualToData:self.candidateAgreementPublicKey];
}
@end

AncPrivateVaultPreparedRecoveryArtifacts *
AncPrivateVaultRestorePreparedRecoveryArtifacts(
    AncPrivateVaultRecoveryPreparationEvidence *evidence,
    NSData *signedEntry, NSData *recoveryWrap, NSData *currentSnapshot,
    NSData *currentStateSnapshot, NSData *recoveryAuthorization) {
  AncPrivateVaultRecoveryPreparationSnapshot preparation = {0};
  if (!AncPrivateVaultRecoveryPreparationEvidenceCopySnapshot(
          evidence, &preparation))
    return nil;
  AncPrivateVaultPreparedRecoveryArtifacts *result = nil;
  @try {
    NSData *commitment =
        AncPrivateVaultRecoveryPreparationArtifactsCommitment(
            signedEntry, recoveryWrap, currentSnapshot, currentStateSnapshot,
            recoveryAuthorization);
    NSData *expectedCommitment =
        [NSData dataWithBytes:preparation.artifact_commitment length:32];
    NSData *entryHash =
        AncPrivateVaultControlLogSignedEntryDomainHash(signedEntry);
    NSData *wrapHash = Hash(kWrapDomain, sizeof kWrapDomain, recoveryWrap);
    NSData *authorizationHash = Hash(
        kAuthorizationDomain, sizeof kAuthorizationDomain,
        recoveryAuthorization);
    NSData *snapshotHash =
        Hash(kRecoveryDomain, sizeof kRecoveryDomain, currentSnapshot);
    NSString *vaultId = Hex([NSData dataWithBytes:preparation.vault_id
                                           length:16]);
    NSString *entryId = Hex([NSData dataWithBytes:preparation.entry_id
                                           length:16]);
    NSString *ceremonyId =
        Hex([NSData dataWithBytes:preparation.ceremony_id length:16]);
    NSString *candidateId = Hex(
        [NSData dataWithBytes:preparation.candidate_endpoint_id length:16]);
    NSData *candidateSigning = [NSData
        dataWithBytes:preparation.candidate_signing_public_key
               length:32];
    NSData *candidateAgreement = [NSData
        dataWithBytes:preparation.candidate_key_agreement_public_key
               length:32];
    AncPrivateVaultControlLogState *current =
        AncPrivateVaultControlLogStatePersistenceDecode(currentStateSnapshot);
    NSData *roundTrip =
        AncPrivateVaultControlLogStatePersistenceEncode(current);
    if (commitment.length != 32 ||
        ![commitment isEqualToData:expectedCommitment] ||
        entryHash.length != 32 ||
        anc_pv_memcmp(entryHash.bytes, preparation.entry_hash, 32) !=
            ANC_PV_CRYPTO_OK ||
        wrapHash.length != 32 ||
        anc_pv_memcmp(wrapHash.bytes, preparation.recovery_wrap_hash, 32) !=
            ANC_PV_CRYPTO_OK ||
        recoveryWrap.length != preparation.recovery_wrap_byte_length ||
        authorizationHash.length != 32 ||
        anc_pv_memcmp(authorizationHash.bytes,
                      preparation.recovery_authorization_hash, 32) !=
            ANC_PV_CRYPTO_OK ||
        current == nil || ![roundTrip isEqualToData:currentStateSnapshot] ||
        ![current.vaultId isEqualToString:vaultId] ||
        current.sequence == kMaximumSafeInteger ||
        current.sequence + 1 != preparation.expected_next_sequence ||
        anc_pv_memcmp(current.headHash.bytes,
                      preparation.expected_previous_head, 32) !=
            ANC_PV_CRYPTO_OK ||
        current.epoch == kMaximumSafeInteger ||
        current.epoch + 1 != preparation.next_epoch ||
        current.recoveryGeneration == kMaximumSafeInteger ||
        current.recoveryGeneration + 1 !=
            preparation.replacement_recovery_generation ||
        ![AncPrivateVaultControlLogSignedEntryEnvelopeId(signedEntry)
            isEqualToString:entryId])
      return nil;
    AncPersistedRecoveryAuthorizationVerifier *verifier =
        [AncPersistedRecoveryAuthorizationVerifier new];
    verifier.signedEntry = [signedEntry copy];
    verifier.currentStateCanonical = [currentStateSnapshot copy];
    verifier.snapshotHash = snapshotHash;
    verifier.authorizationHash = authorizationHash;
    verifier.ceremonyId = ceremonyId;
    verifier.candidateEndpointId = candidateId;
    verifier.candidateSigningPublicKey = candidateSigning;
    verifier.candidateAgreementPublicKey = candidateAgreement;
    verifier.recoveryWrapHash = wrapHash;
    verifier.nextEpoch = preparation.next_epoch;
    verifier.replacementRecoveryGeneration =
        preparation.replacement_recovery_generation;
    AncPrivateVaultControlLogReplayResult *replayed = nil;
    AncPrivateVaultControlLogStatus replayStatus =
        [[AncPrivateVaultControlLog new]
            replaySignedEntry:signedEntry
                 currentState:current
                     verifier:verifier
                       result:&replayed];
    if (replayStatus != AncPrivateVaultControlLogStatusOK || replayed == nil ||
        ![replayed.entryHash isEqualToData:entryHash] ||
        replayed.state.sequence != preparation.expected_next_sequence ||
        replayed.state.epoch != preparation.next_epoch ||
        replayed.state.recoveryGeneration !=
            preparation.replacement_recovery_generation ||
        ![replayed.state.recoveryWrapHash isEqualToData:wrapHash] ||
        replayed.state.activeMembers.count != 1 ||
        ![replayed.state.activeMembers.firstObject.endpointId
            isEqualToString:candidateId] ||
        ![replayed.state.activeMembers.firstObject.signingPublicKey
            isEqualToData:candidateSigning] ||
        ![replayed.state.activeMembers.firstObject.keyAgreementPublicKey
            isEqualToData:candidateAgreement])
      return nil;
    result = [[AncPrivateVaultPreparedRecoveryArtifacts alloc]
        initPrivateWithSignedEntry:signedEntry
                     recoveryWrap:recoveryWrap
                  currentSnapshot:currentSnapshot
             currentStateSnapshot:currentStateSnapshot
            recoveryAuthorization:recoveryAuthorization
                        entryHash:entryHash
                authorizationHash:authorizationHash
                     snapshotHash:snapshotHash
              candidateEndpointId:
                  [NSData dataWithBytes:preparation.candidate_endpoint_id
                                 length:16]
       candidateSigningPublicKey:candidateSigning
  candidateKeyAgreementPublicKey:candidateAgreement
                       ceremonyId:
                           [NSData dataWithBytes:preparation.ceremony_id
                                          length:16]
                          entryId:entryId
                        nextState:replayed.state];
    AncPrivateVaultRecoveryBuilderEvidence *builderEvidence =
        [AncPrivateVaultRecoveryBuilderEvidence new];
    builderEvidence.currentState = current;
    builderEvidence.nextState = replayed.state;
    builderEvidence.entryHash = [entryHash copy];
    builderEvidence.authorizationHash = [authorizationHash copy];
    builderEvidence.ceremonyId =
        [NSData dataWithBytes:preparation.ceremony_id length:16];
    builderEvidence.candidateEndpointId =
        [NSData dataWithBytes:preparation.candidate_endpoint_id length:16];
    builderEvidence.candidateSigningPublicKey = candidateSigning;
    builderEvidence.candidateKeyAgreementPublicKey = candidateAgreement;
    builderEvidence.currentStateSnapshot = [currentStateSnapshot copy];
    NSLock *lock = RecoveryBuilderRegistryLock();
    [lock lock];
    BOOL registered = RecoveryBuilderRegistry().count < 1024 && result != nil;
    if (registered)
      [RecoveryBuilderRegistry() setObject:builderEvidence forKey:result];
    [lock unlock];
    if (!registered)
      result = nil;
  } @catch (__unused NSException *exception) {
    result = nil;
  } @finally {
    anc_pv_zeroize(&preparation, sizeof preparation);
  }
  return result;
}

NSString *AncPrivateVaultRecoveryBuilderCategory(
    AncPrivateVaultRecoveryBuilderStatus status) {
  static NSArray<NSString *> *categories;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    categories = @[
      @"", @"input.invalid", @"time.invalid", @"crypto.failed",
      @"encoding.failed", @"verification.failed", @"cleanup.failed"
    ];
  });
  return status >= 0 && (NSUInteger)status < categories.count
             ? categories[(NSUInteger)status]
             : @"unknown";
}
