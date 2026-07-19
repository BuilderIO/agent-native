#import "PrivateVaultGrantRevocationBuilder.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

static const char kLogEntryDomain[] = "anc/v1/log-entry";
static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);

@interface AncPrivateVaultGrantRevocationBuildResult ()
- (instancetype)initPrivateWithSignedEntry:(NSData *)signedEntry
                        revocationEnvelope:(NSData *)revocationEnvelope;
@end

@implementation AncPrivateVaultGrantRevocationBuildResult
@synthesize signedEntry = _signedEntry;
@synthesize revocationEnvelope = _revocationEnvelope;
+ (BOOL)accessInstanceVariablesDirectly { return NO; }
- (instancetype)initPrivateWithSignedEntry:(NSData *)signedEntry
                        revocationEnvelope:(NSData *)revocationEnvelope {
  self = [super init];
  if (self != nil) {
    _signedEntry = [signedEntry copy];
    _revocationEnvelope = [revocationEnvelope copy];
  }
  return self;
}
@end

static NSString *LowerHex(NSData *value) {
  if (value.length == 0) return nil;
  NSMutableString *result = [NSMutableString stringWithCapacity:value.length * 2];
  const uint8_t *bytes = value.bytes;
  for (NSUInteger index = 0; index < value.length; index += 1)
    [result appendFormat:@"%02x", bytes[index]];
  return result;
}

static NSData *DataFromLowerHex(NSString *value, NSUInteger length) {
  if (value.length != length * 2) return nil;
  const char *characters = value.UTF8String;
  if (characters == NULL || strlen(characters) != length * 2) return nil;
  NSMutableData *result = [NSMutableData dataWithLength:length];
  uint8_t *bytes = result.mutableBytes;
  for (NSUInteger index = 0; index < length; index += 1) {
    int high = characters[index * 2];
    int low = characters[index * 2 + 1];
    high = high >= '0' && high <= '9' ? high - '0'
                                      : high >= 'a' && high <= 'f'
                                            ? high - 'a' + 10
                                            : -1;
    low = low >= '0' && low <= '9' ? low - '0'
                                   : low >= 'a' && low <= 'f'
                                         ? low - 'a' + 10
                                         : -1;
    if (high < 0 || low < 0) return nil;
    bytes[index] = (uint8_t)((high << 4) | low);
  }
  return result;
}

static BOOL ValidOpaqueId(NSString *value) {
  NSData *bytes = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (bytes.length < 8 || bytes.length > 160) return NO;
  const uint8_t *raw = bytes.bytes;
  for (NSUInteger index = 0; index < bytes.length; index += 1) {
    uint8_t byte = raw[index];
    BOOL alnum = (byte >= 'A' && byte <= 'Z') ||
        (byte >= 'a' && byte <= 'z') || (byte >= '0' && byte <= '9');
    if (!alnum &&
        (index == 0 ||
         (byte != '.' && byte != '_' && byte != ':' && byte != '-')))
      return NO;
  }
  return YES;
}

static NSDate *Timestamp(NSString *value) {
  if (value.length == 0) return nil;
  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
      NSISO8601DateFormatWithFractionalSeconds;
  NSDate *date = [formatter dateFromString:value];
  if (date != nil) return date;
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime;
  return [formatter dateFromString:value];
}

static BOOL SameMember(AncPrivateVaultControlLogMember *left,
                       AncPrivateVaultControlLogMember *right) {
  return left != nil && right != nil &&
      [left.endpointId isEqualToString:right.endpointId] &&
      [left.role isEqualToString:right.role] &&
      left.unattended == right.unattended &&
      [left.signingPublicKey isEqualToData:right.signingPublicKey] &&
      [left.keyAgreementPublicKey isEqualToData:right.keyAgreementPublicKey] &&
      [left.enrollmentRef isEqualToString:right.enrollmentRef];
}

static BOOL SameMembers(NSArray<AncPrivateVaultControlLogMember *> *left,
                        NSArray<AncPrivateVaultControlLogMember *> *right) {
  if (left.count != right.count) return NO;
  for (NSUInteger index = 0; index < left.count; index += 1)
    if (!SameMember(left[index], right[index])) return NO;
  return YES;
}

static BOOL SameAuthorityProjection(AncPrivateVaultControlLogState *left,
                                    AncPrivateVaultControlLogState *right) {
  return left != nil && right != nil &&
      [left.vaultId isEqualToString:right.vaultId] &&
      left.epoch == right.epoch &&
      [left.membershipHash isEqualToData:right.membershipHash] &&
      SameMembers(left.activeMembers, right.activeMembers) &&
      [left.removedEndpointIds isEqualToArray:right.removedEndpointIds] &&
      left.recoveryGeneration == right.recoveryGeneration &&
      [left.recoveryId isEqualToString:right.recoveryId] &&
      [left.recoverySigningPublicKey
          isEqualToData:right.recoverySigningPublicKey] &&
      [left.recoveryKeyAgreementPublicKey
          isEqualToData:right.recoveryKeyAgreementPublicKey] &&
      [left.recoveryWrapHash isEqualToData:right.recoveryWrapHash] &&
      [left.freshnessMode isEqualToString:right.freshnessMode];
}

@interface AncGrantRevocationBuildVerifier
    : NSObject <AncPrivateVaultControlLogAuthorizationVerifier>
@property(nonatomic) AncPrivateVaultVerifiedGrant *grant;
@property(nonatomic) NSData *vaultId;
@property(nonatomic) NSData *signingPublicKey;
@property(nonatomic) NSData *expectedRevocation;
@end

@implementation AncGrantRevocationBuildVerifier
- (BOOL)verifyGrantRevocationSignedEntry:(NSData *)signedEntry
                           innerEnvelope:(NSData *)innerEnvelope
                      revocationEnvelope:(NSData *)revocationEnvelope
                            currentState:(AncPrivateVaultControlLogState *)state {
  if (signedEntry.length == 0 || innerEnvelope.length == 0 || state == nil ||
      ![revocationEnvelope isEqualToData:self.expectedRevocation])
    return NO;
  AncPrivateVaultGrantCodecStatus status;
  return AncPrivateVaultVerifyGrantRevocationEnvelope(
             revocationEnvelope, self.vaultId, self.grant,
             self.signingPublicKey.bytes, &status) != nil &&
      status == AncPrivateVaultGrantCodecStatusOK;
}
@end

AncPrivateVaultGrantRevocationBuildResult *
AncPrivateVaultBuildGrantRevocation(
    AncPrivateVaultControlLogState *currentState,
    AncPrivateVaultVerifiedGrant *grant, NSData *revocationEnvelopeId,
    NSString *logEnvelopeId, NSString *createdAt, uint64_t revokedAt,
    NSString *reason, const uint8_t issuerSigningSeed[ANC_PV_SEED_BYTES]) {
  if (currentState == nil || grant == nil || revocationEnvelopeId.length != 16 ||
      !ValidOpaqueId(logEnvelopeId) || revokedAt == 0 ||
      issuerSigningSeed == NULL ||
      currentState.sequence >= kMaximumSafeInteger ||
      currentState.headHash.length != 32)
    return nil;
  NSDate *createdDate = Timestamp(createdAt);
  NSTimeInterval interval = createdDate.timeIntervalSince1970;
  if (createdDate == nil || interval < 1 ||
      interval > (NSTimeInterval)kMaximumSafeInteger ||
      (uint64_t)interval != revokedAt)
    return nil;

  NSData *vaultId = DataFromLowerHex(currentState.vaultId, 16);
  NSString *issuerId = LowerHex(grant.issuerEndpointId);
  AncPrivateVaultControlLogMember *issuer = nil;
  for (AncPrivateVaultControlLogMember *member in currentState.activeMembers)
    if ([member.endpointId isEqualToString:issuerId]) issuer = member;

  uint8_t signingPublic[ANC_PV_SIGN_PUBLIC_KEY_BYTES] = {0};
  uint8_t signingPrivate[ANC_PV_SIGN_PRIVATE_KEY_BYTES] = {0};
  BOOL keyDerived =
      anc_pv_ed25519_seed_keypair(signingPublic, signingPrivate,
                                  issuerSigningSeed) == ANC_PV_CRYPTO_OK;
  BOOL issuerValid = keyDerived && issuer != nil &&
      [issuer.role isEqualToString:@"endpoint"] && !issuer.unattended &&
      issuer.signingPublicKey.length == sizeof signingPublic &&
      anc_pv_memcmp(signingPublic, issuer.signingPublicKey.bytes,
                    sizeof signingPublic) == ANC_PV_CRYPTO_OK;
  if (!issuerValid || vaultId == nil ||
      ![grant.vaultId isEqualToData:vaultId]) {
    anc_pv_zeroize(signingPublic, sizeof signingPublic);
    anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
    return nil;
  }

  AncPrivateVaultGrantCodecStatus grantStatus;
  NSData *revocation = AncPrivateVaultSealGrantRevocationEnvelope(
      grant.vaultId, revocationEnvelopeId, revokedAt, grant, revokedAt, reason,
      issuerSigningSeed, &grantStatus);
  AncPrivateVaultCanonicalStatus canonicalStatus;
  NSData *inner = revocation == nil ||
          grantStatus != AncPrivateVaultGrantCodecStatusOK
      ? nil
      : AncPrivateVaultCanonicalEncode(
            [AncPrivateVaultCanonicalValue map:@{
              @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
              @2 : [AncPrivateVaultCanonicalValue text:currentState.vaultId],
              @3 : [AncPrivateVaultCanonicalValue text:@"grant_revocation"],
              @160 : [AncPrivateVaultCanonicalValue bytes:revocation],
            }],
            &canonicalStatus);
  NSMutableDictionary *outer =
      inner == nil || canonicalStatus != AncPrivateVaultCanonicalStatusOK
      ? nil
      : [@{
          @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
          @2 : [AncPrivateVaultCanonicalValue text:currentState.vaultId],
          @3 : [AncPrivateVaultCanonicalValue text:@"log-entry"],
          @4 : [AncPrivateVaultCanonicalValue text:createdAt],
          @5 : [AncPrivateVaultCanonicalValue text:logEnvelopeId],
          @110 : [AncPrivateVaultCanonicalValue
              integer:(int64_t)(currentState.sequence + 1)],
          @111 : [AncPrivateVaultCanonicalValue bytes:currentState.headHash],
          @112 : [AncPrivateVaultCanonicalValue bytes:inner],
          @113 : [AncPrivateVaultCanonicalValue text:issuer.endpointId],
        } mutableCopy];
  NSData *unsignedBytes = outer == nil
      ? nil
      : AncPrivateVaultCanonicalEncode(
            [AncPrivateVaultCanonicalValue map:outer], &canonicalStatus);
  if (unsignedBytes == nil ||
      canonicalStatus != AncPrivateVaultCanonicalStatusOK) {
    anc_pv_zeroize(signingPublic, sizeof signingPublic);
    anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
    return nil;
  }
  NSMutableData *message =
      [NSMutableData dataWithBytes:kLogEntryDomain
                            length:sizeof kLogEntryDomain];
  [message appendData:unsignedBytes];
  uint8_t signature[ANC_PV_SIGNATURE_BYTES] = {0};
  BOOL signedEntry =
      anc_pv_ed25519_sign(signature, message.bytes, message.length,
                          signingPrivate) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
  if (!signedEntry) {
    anc_pv_zeroize(signingPublic, sizeof signingPublic);
    anc_pv_zeroize(signature, sizeof signature);
    return nil;
  }
  outer[@114] = [AncPrivateVaultCanonicalValue
      bytes:[NSData dataWithBytes:signature length:sizeof signature]];
  anc_pv_zeroize(signature, sizeof signature);
  NSData *encoded = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:outer], &canonicalStatus);

  AncGrantRevocationBuildVerifier *verifier =
      [AncGrantRevocationBuildVerifier new];
  verifier.grant = grant;
  verifier.vaultId = grant.vaultId;
  verifier.signingPublicKey =
      [NSData dataWithBytes:signingPublic length:sizeof signingPublic];
  verifier.expectedRevocation = revocation;
  anc_pv_zeroize(signingPublic, sizeof signingPublic);
  AncPrivateVaultControlLogReplayResult *replay = nil;
  AncPrivateVaultControlLogStatus replayStatus =
      encoded == nil || canonicalStatus != AncPrivateVaultCanonicalStatusOK
      ? AncPrivateVaultControlLogStatusInvalidEntry
      : [[AncPrivateVaultControlLog new]
            replaySignedEntry:encoded
                currentState:currentState
                    verifier:verifier
                      result:&replay];
  if (replayStatus != AncPrivateVaultControlLogStatusOK || replay == nil ||
      replay.state.sequence != currentState.sequence + 1 ||
      !SameAuthorityProjection(currentState, replay.state))
    return nil;
  return [[AncPrivateVaultGrantRevocationBuildResult alloc]
      initPrivateWithSignedEntry:encoded
              revocationEnvelope:revocation];
}
