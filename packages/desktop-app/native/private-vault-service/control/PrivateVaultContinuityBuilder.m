#import "PrivateVaultContinuityBuilder.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

static const char kLogEntryDomain[] = "anc/v1/log-entry";
static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);

static BOOL AncContinuityOpaqueId(NSString *value) {
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

static BOOL AncContinuityTimestamp(NSString *value) {
  if (value.length != 24 || ![value hasSuffix:@"Z"]) return NO;
  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
      NSISO8601DateFormatWithFractionalSeconds;
  NSDate *date = [formatter dateFromString:value];
  return date != nil && date.timeIntervalSince1970 >= 1;
}

static BOOL AncContinuitySameMember(AncPrivateVaultControlLogMember *left,
                                    AncPrivateVaultControlLogMember *right) {
  return left != nil && right != nil &&
      [left.endpointId isEqualToString:right.endpointId] &&
      [left.role isEqualToString:right.role] &&
      left.unattended == right.unattended &&
      [left.signingPublicKey isEqualToData:right.signingPublicKey] &&
      [left.keyAgreementPublicKey isEqualToData:right.keyAgreementPublicKey] &&
      [left.enrollmentRef isEqualToString:right.enrollmentRef];
}

static BOOL AncContinuityPreservesAuthority(
    AncPrivateVaultControlLogState *prior,
    AncPrivateVaultControlLogState *next) {
  if (prior == nil || next == nil || next.sequence != prior.sequence + 1 ||
      ![prior.vaultId isEqualToString:next.vaultId] ||
      ![prior.membershipHash isEqualToData:next.membershipHash] ||
      prior.epoch != next.epoch ||
      prior.recoveryGeneration != next.recoveryGeneration ||
      ![prior.removedEndpointIds isEqualToArray:next.removedEndpointIds] ||
      ![prior.recoveryId isEqualToString:next.recoveryId] ||
      ![prior.recoverySigningPublicKey
          isEqualToData:next.recoverySigningPublicKey] ||
      ![prior.recoveryKeyAgreementPublicKey
          isEqualToData:next.recoveryKeyAgreementPublicKey] ||
      ![prior.recoveryWrapHash isEqualToData:next.recoveryWrapHash] ||
      ![next.freshnessMode isEqualToString:@"endpoint_witnessed"] ||
      prior.activeMembers.count != next.activeMembers.count)
    return NO;
  for (NSUInteger index = 0; index < prior.activeMembers.count; index += 1)
    if (!AncContinuitySameMember(prior.activeMembers[index],
                                 next.activeMembers[index]))
      return NO;
  return YES;
}

NSData *AncPrivateVaultBuildContinuityCheckpoint(
    AncPrivateVaultControlLogState *currentState, NSString *logEnvelopeId,
    NSString *createdAt, NSString *endpointId,
    const uint8_t endpointSigningSeed[ANC_PV_SEED_BYTES],
    NSData *expectedSigningPublicKey) {
  if (currentState == nil ||
      currentState.sequence >= kMaximumSafeInteger ||
      currentState.headHash.length != 32 ||
      currentState.membershipHash.length != 32 ||
      !AncContinuityOpaqueId(currentState.vaultId) ||
      !AncContinuityOpaqueId(logEnvelopeId) ||
      !AncContinuityOpaqueId(endpointId) ||
      !AncContinuityTimestamp(createdAt) || endpointSigningSeed == NULL ||
      expectedSigningPublicKey.length != ANC_PV_SIGN_PUBLIC_KEY_BYTES)
    return nil;

  AncPrivateVaultControlLogMember *signer = nil;
  BOOL duplicate = NO;
  for (AncPrivateVaultControlLogMember *member in currentState.activeMembers) {
    if (![member.endpointId isEqualToString:endpointId]) continue;
    if (signer != nil) duplicate = YES;
    signer = member;
  }
  uint8_t signingPublic[ANC_PV_SIGN_PUBLIC_KEY_BYTES] = {0};
  uint8_t signingPrivate[ANC_PV_SIGN_PRIVATE_KEY_BYTES] = {0};
  BOOL derived = anc_pv_ed25519_seed_keypair(
                     signingPublic, signingPrivate, endpointSigningSeed) ==
      ANC_PV_CRYPTO_OK;
  BOOL authorized = derived && !duplicate && signer != nil &&
      [signer.role isEqualToString:@"endpoint"] && !signer.unattended &&
      [signer.signingPublicKey isEqualToData:expectedSigningPublicKey] &&
      anc_pv_memcmp(signingPublic, expectedSigningPublicKey.bytes,
                    sizeof signingPublic) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(signingPublic, sizeof signingPublic);
  if (!authorized) {
    anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
    return nil;
  }

  AncPrivateVaultCanonicalStatus status;
  NSData *inner = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue text:currentState.vaultId],
        @3 : [AncPrivateVaultCanonicalValue text:@"continuity_checkpoint"],
        @150 : [AncPrivateVaultCanonicalValue
            bytes:currentState.membershipHash],
      }],
      &status);
  NSMutableDictionary *outer =
      inner == nil || status != AncPrivateVaultCanonicalStatusOK
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
          @113 : [AncPrivateVaultCanonicalValue text:endpointId],
        } mutableCopy];
  NSData *unsignedBytes = outer == nil
      ? nil
      : AncPrivateVaultCanonicalEncode(
            [AncPrivateVaultCanonicalValue map:outer], &status);
  if (unsignedBytes == nil || status != AncPrivateVaultCanonicalStatusOK) {
    anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
    return nil;
  }
  NSMutableData *message =
      [NSMutableData dataWithBytes:kLogEntryDomain length:sizeof kLogEntryDomain];
  [message appendData:unsignedBytes];
  uint8_t signature[ANC_PV_SIGNATURE_BYTES] = {0};
  BOOL signedEntry = anc_pv_ed25519_sign(
                         signature, message.bytes, message.length,
                         signingPrivate) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
  if (!signedEntry) {
    anc_pv_zeroize(signature, sizeof signature);
    return nil;
  }
  outer[@114] = [AncPrivateVaultCanonicalValue bytes:
      [NSData dataWithBytes:signature length:sizeof signature]];
  anc_pv_zeroize(signature, sizeof signature);
  NSData *encoded = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:outer], &status);
  AncPrivateVaultControlLogReplayResult *replay = nil;
  AncPrivateVaultControlLogStatus replayStatus =
      encoded == nil || status != AncPrivateVaultCanonicalStatusOK
      ? AncPrivateVaultControlLogStatusInvalidEntry
      : [[AncPrivateVaultControlLog new]
            replaySignedEntry:encoded
                currentState:currentState
                    verifier:nil
                      result:&replay];
  if (replayStatus != AncPrivateVaultControlLogStatusOK || replay == nil ||
      replay.idempotent ||
      !AncContinuityPreservesAuthority(currentState, replay.state) ||
      ![replay.state.signedAt isEqualToString:createdAt])
    return nil;
  return encoded;
}
