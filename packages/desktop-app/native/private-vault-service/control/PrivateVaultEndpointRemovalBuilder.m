#import "PrivateVaultEndpointRemovalBuilder.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultRecoveryWrap.h"
#import "PrivateVaultRecoveryWrapInternal.h"

static const uint8_t kWrapDomain[] = "anc/v1/recovery-wrap";
static const uint8_t kLogDomain[] = "anc/v1/log-entry";
static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);

@interface AncPrivateVaultPreparedEndpointRemoval ()
- (instancetype)initPrivateWithEntry:(NSData *)entry
                                wrap:(NSData *)wrap
                          transcript:(NSData *)transcript
                           nextState:(AncPrivateVaultControlLogState *)state;
@end

@implementation AncPrivateVaultPreparedEndpointRemoval
@synthesize signedEntry = _signedEntry;
@synthesize recoveryWrap = _recoveryWrap;
@synthesize transcriptDigest = _transcriptDigest;
@synthesize nextState = _nextState;
+ (BOOL)accessInstanceVariablesDirectly { return NO; }
- (instancetype)initPrivateWithEntry:(NSData *)entry
                                wrap:(NSData *)wrap
                          transcript:(NSData *)transcript
                           nextState:(AncPrivateVaultControlLogState *)state {
  self = [super init];
  if (self != nil) {
    _signedEntry = [entry copy];
    _recoveryWrap = [wrap copy];
    _transcriptDigest = [transcript copy];
    _nextState = state;
  }
  return self;
}
@end

static void SetStatus(AncPrivateVaultEndpointRemovalBuilderStatus *status,
                      AncPrivateVaultEndpointRemovalBuilderStatus value) {
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
static AncPrivateVaultCanonicalValue *A(NSArray *value) {
  return [AncPrivateVaultCanonicalValue array:value];
}
static NSData *Encode(NSDictionary *map) {
  AncPrivateVaultCanonicalStatus status;
  NSData *result = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:map], &status);
  return status == AncPrivateVaultCanonicalStatusOK ? result : nil;
}
static NSData *Exact(NSData *value, NSUInteger length) {
  return [value isKindOfClass:NSData.class] && value.length == length
             ? [NSData dataWithBytes:value.bytes length:length]
             : nil;
}
static NSData *HexData(NSString *hex, NSUInteger length) {
  if (![hex isKindOfClass:NSString.class] || hex.length != length * 2)
    return nil;
  NSMutableData *result = [NSMutableData dataWithLength:length];
  uint8_t *bytes = result.mutableBytes;
  for (NSUInteger index = 0; index < length; index++) {
    unichar h = [hex characterAtIndex:index * 2];
    unichar l = [hex characterAtIndex:index * 2 + 1];
    int hi = h >= '0' && h <= '9' ? h - '0'
             : h >= 'a' && h <= 'f' ? h - 'a' + 10 : -1;
    int lo = l >= '0' && l <= '9' ? l - '0'
             : l >= 'a' && l <= 'f' ? l - 'a' + 10 : -1;
    if (hi < 0 || lo < 0)
      return nil;
    bytes[index] = (uint8_t)((hi << 4) | lo);
  }
  return result;
}
static NSString *Hex(NSData *data) {
  if (![data isKindOfClass:NSData.class])
    return nil;
  NSMutableString *result = [NSMutableString stringWithCapacity:data.length * 2];
  const uint8_t *bytes = data.bytes;
  for (NSUInteger index = 0; index < data.length; index++)
    [result appendFormat:@"%02x", bytes[index]];
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
static NSData *Hash(const uint8_t *domain, size_t domainLength, NSData *data) {
  uint8_t digest[32] = {0};
  BOOL okay = data != nil &&
      anc_pv_blake2b_256_two_part(digest, domain, domainLength, data.bytes,
                                  data.length) == ANC_PV_CRYPTO_OK;
  NSData *result = okay ? [NSData dataWithBytes:digest length:32] : nil;
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}
static NSData *Signature(const uint8_t *domain, size_t domainLength,
                         NSData *payload, const uint8_t seed[32],
                         NSData **publicKey) {
  uint8_t publicBytes[32] = {0}, privateBytes[64] = {0}, signature[64] = {0};
  NSMutableData *message = payload == nil ? nil
      : [NSMutableData dataWithBytes:domain length:domainLength];
  [message appendData:payload];
  BOOL okay = message != nil &&
      anc_pv_ed25519_seed_keypair(publicBytes, privateBytes, seed) ==
          ANC_PV_CRYPTO_OK &&
      anc_pv_ed25519_sign(signature, message.bytes, message.length,
                          privateBytes) == ANC_PV_CRYPTO_OK;
  NSData *result = okay ? [NSData dataWithBytes:signature length:64] : nil;
  if (publicKey != NULL)
    *publicKey = okay ? [NSData dataWithBytes:publicBytes length:32] : nil;
  anc_pv_zeroize(message.mutableBytes, message.length);
  anc_pv_zeroize(publicBytes, sizeof publicBytes);
  anc_pv_zeroize(privateBytes, sizeof privateBytes);
  anc_pv_zeroize(signature, sizeof signature);
  return result;
}
static AncPrivateVaultCanonicalValue *MemberValue(
    AncPrivateVaultControlLogMember *member) {
  return A(@[ T(member.endpointId), T(member.role),
              [AncPrivateVaultCanonicalValue boolean:member.unattended],
              B(member.signingPublicKey), B(member.keyAgreementPublicKey),
              T(member.enrollmentRef) ]);
}

AncPrivateVaultPreparedEndpointRemoval *AncPrivateVaultBuildEndpointRemoval(
    AncPrivateVaultControlLogState *current, NSData *targetEndpointId,
    NSData *ceremonyId, NSData *wrapEnvelopeId, NSData *entryEnvelopeId,
    NSData *wrapNonce, uint64_t createdAt, const uint8_t pendingKey[32],
    const uint8_t signingSeed[32], const uint8_t agreementSeed[32],
    AncPrivateVaultEndpointRemovalBuilderStatus *status) {
  SetStatus(status, AncPrivateVaultEndpointRemovalBuilderStatusInvalidArgument);
  NSData *target = Exact(targetEndpointId, 16);
  NSData *ceremony = Exact(ceremonyId, 16);
  NSData *wrapEnvelope = Exact(wrapEnvelopeId, 16);
  NSData *entryEnvelope = Exact(entryEnvelopeId, 16);
  NSData *nonce = Exact(wrapNonce, 24);
  NSData *vault = HexData(current.vaultId, 16);
  if (current == nil || target == nil || ceremony == nil ||
      wrapEnvelope == nil || entryEnvelope == nil || nonce == nil ||
      vault == nil || pendingKey == NULL || signingSeed == NULL ||
      agreementSeed == NULL || createdAt == 0 ||
      createdAt > kMaximumSafeInteger ||
      current.sequence >= kMaximumSafeInteger ||
      current.epoch >= kMaximumSafeInteger || current.headHash.length != 32 ||
      current.membershipHash.length != 32 ||
      current.recoveryGeneration == 0 || current.recoveryId.length != 32 ||
      current.recoverySigningPublicKey.length != 32 ||
      current.recoveryKeyAgreementPublicKey.length != 32)
    return nil;

  NSString *targetHex = Hex(target);
  AncPrivateVaultControlLogMember *targetMember = nil;
  NSData *issuerPublic = nil;
  NSData *signatureProbe = Signature(kLogDomain, sizeof kLogDomain,
                                     [NSData data], signingSeed, &issuerPublic);
  (void)signatureProbe;
  uint8_t agreementPublicBytes[32] = {0}, agreementPrivate[32] = {0};
  BOOL agreementOkay = anc_pv_box_seed_keypair(
      agreementPublicBytes, agreementPrivate, agreementSeed) == ANC_PV_CRYPTO_OK;
  NSData *agreementPublic = agreementOkay
      ? [NSData dataWithBytes:agreementPublicBytes length:32] : nil;
  AncPrivateVaultControlLogMember *issuer = nil;
  for (AncPrivateVaultControlLogMember *member in current.activeMembers) {
    if ([member.endpointId isEqualToString:targetHex])
      targetMember = member;
    if ([member.role isEqualToString:@"endpoint"] && !member.unattended &&
        [member.signingPublicKey isEqualToData:issuerPublic] &&
        [member.keyAgreementPublicKey isEqualToData:agreementPublic])
      issuer = member;
  }
  if (issuer == nil || targetMember == nil || targetMember == issuer ||
      ![targetMember.role isEqualToString:@"endpoint"] ||
      targetMember.unattended || current.activeMembers.count < 2 ||
      [current.removedEndpointIds containsObject:targetHex]) {
    anc_pv_zeroize(agreementPublicBytes, sizeof agreementPublicBytes);
    anc_pv_zeroize(agreementPrivate, sizeof agreementPrivate);
    SetStatus(status, AncPrivateVaultEndpointRemovalBuilderStatusTargetRejected);
    return nil;
  }

  uint8_t plaintext[48] = {0}, ciphertext[64] = {0};
  memcpy(plaintext, "anc/v1/eek-wrap", 16);
  memcpy(plaintext + 16, pendingKey, 32);
  size_t written = 0;
  BOOL wrapped = agreementOkay &&
      anc_pv_box_wrap(ciphertext, sizeof ciphertext, &written, plaintext,
                      sizeof plaintext, nonce.bytes,
                      current.recoveryKeyAgreementPublicKey.bytes,
                      agreementPrivate) == ANC_PV_CRYPTO_OK &&
      written == sizeof ciphertext;
  anc_pv_zeroize(plaintext, sizeof plaintext);
  anc_pv_zeroize(agreementPrivate, sizeof agreementPrivate);
  anc_pv_zeroize(agreementPublicBytes, sizeof agreementPublicBytes);
  if (!wrapped) {
    anc_pv_zeroize(ciphertext, sizeof ciphertext);
    SetStatus(status, AncPrivateVaultEndpointRemovalBuilderStatusCryptoFailed);
    return nil;
  }

  NSMutableDictionary *wrapMap = [@{
    @1:T(@"anc/v1"), @2:B(vault), @3:T(@"recovery-wrap"), @4:I(createdAt),
    @5:B(wrapEnvelope), @400:B(ceremony), @401:I(current.recoveryGeneration),
    @402:B(HexData(current.recoveryId, 16)),
    @403:B(current.recoveryKeyAgreementPublicKey), @404:I(current.epoch + 1),
    @405:B(HexData(issuer.endpointId, 16)), @406:I(current.sequence + 1),
    @407:B(current.headHash), @408:B(current.membershipHash), @409:B(nonce),
    @410:B([NSData dataWithBytes:ciphertext length:sizeof ciphertext]),
  } mutableCopy];
  anc_pv_zeroize(ciphertext, sizeof ciphertext);
  NSData *wrapUnsigned = Encode(wrapMap);
  wrapMap[@411] = B(Signature(kWrapDomain, sizeof kWrapDomain, wrapUnsigned,
                              signingSeed, NULL));
  NSData *wrap = Encode(wrapMap);
  NSData *wrapHash = Hash(kWrapDomain, sizeof kWrapDomain, wrap);

  NSMutableArray *members = [NSMutableArray array];
  for (AncPrivateVaultControlLogMember *member in current.activeMembers)
    if (member != targetMember)
      [members addObject:MemberValue(member)];
  NSArray *removed = @[ T(targetHex) ];
  NSDictionary *innerMap = @{
    @1:T(@"anc/v1"), @2:T(current.vaultId), @3:T(@"membership_commit"),
    @140:T(Hex(ceremony)), @141:T(@"remove_device"), @142:I(current.epoch + 1),
    @143:B(current.membershipHash), @144:A(members), @145:A(removed),
    @146:[AncPrivateVaultCanonicalValue boolean:YES],
    @147:[AncPrivateVaultCanonicalValue boolean:NO],
    @148:[AncPrivateVaultCanonicalValue nullValue],
    @149:[AncPrivateVaultCanonicalValue nullValue],
    @155:I(current.recoveryGeneration),
    @156:T(current.recoveryId), @157:B(current.recoverySigningPublicKey),
    @158:B(current.recoveryKeyAgreementPublicKey), @159:B(wrapHash),
  };
  NSData *inner = Encode(innerMap);
  NSMutableDictionary *entryMap = [@{
    @1:T(@"anc/v1"), @2:T(current.vaultId), @3:T(@"log-entry"),
    @4:T(Timestamp(createdAt)), @5:T(Hex(entryEnvelope)),
    @110:I(current.sequence + 1), @111:B(current.headHash), @112:B(inner),
    @113:T(issuer.endpointId),
  } mutableCopy];
  NSData *entryUnsigned = Encode(entryMap);
  entryMap[@114] = B(Signature(kLogDomain, sizeof kLogDomain, entryUnsigned,
                               signingSeed, NULL));
  NSData *entry = Encode(entryMap);

  AncPrivateVaultRecoveryWrapRotationVerifier *verifier =
      [[AncPrivateVaultRecoveryWrapRotationVerifier alloc]
          initWithEncodedWrap:wrap trustedNowMilliseconds:createdAt * 1000];
  AncPrivateVaultControlLogReplayResult *replay = nil;
  AncPrivateVaultControlLogStatus replayStatus =
      entry == nil || verifier == nil ? AncPrivateVaultControlLogStatusFailed
      : [[AncPrivateVaultControlLog new] replaySignedEntry:entry
                                             currentState:current
                                                 verifier:verifier
                                                   result:&replay];
  if (wrap == nil || wrapHash == nil || inner == nil || entry == nil ||
      replayStatus != AncPrivateVaultControlLogStatusOK || replay == nil ||
      !verifier.isVerified || replay.state.activeMembers.count != members.count ||
      [replay.state.activeMembers valueForKey:@"endpointId"] == nil ||
      [[replay.state.activeMembers valueForKey:@"endpointId"]
          containsObject:targetHex] || replay.state.epoch != current.epoch + 1 ||
      replay.state.sequence != current.sequence + 1 ||
      ![replay.state.recoveryWrapHash isEqualToData:wrapHash]) {
    SetStatus(status, AncPrivateVaultEndpointRemovalBuilderStatusVerificationFailed);
    return nil;
  }
  SetStatus(status, AncPrivateVaultEndpointRemovalBuilderStatusOK);
  return [[AncPrivateVaultPreparedEndpointRemoval alloc]
      initPrivateWithEntry:entry wrap:wrap
                transcript:replay.state.membershipHash
                 nextState:replay.state];
}
