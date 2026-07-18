#import "PrivateVaultGenesisAccountAdmission.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

#include <math.h>
#include <objc/runtime.h>

static const uint8_t kCandidateHashDomain[] =
    "anc/v1/private-vault/genesis-account-admission/candidate-hash";
static const NSUInteger kBootstrapMaximum = 4096;
static const NSUInteger kConfirmationMaximum = 1024 * 1024;
static const NSUInteger kAuthorizationMaximum = 256 * 1024;
static const uint64_t kMaximumChallengeLifetimeMs = 10 * 60 * 1000;

@interface AncPrivateVaultGenesisAdmissionChallenge ()
@property(nonatomic, readwrite) NSString *challengeId;
@property(nonatomic, readwrite) NSString *accountId;
@property(nonatomic, readwrite) NSString *workspaceId;
@property(nonatomic, readwrite) NSData *candidateHash;
@property(nonatomic, readwrite) NSString *issuedAt;
@property(nonatomic, readwrite) NSString *expiresAt;
@property(nonatomic, readwrite) NSData *authenticationTag;
@end
@implementation AncPrivateVaultGenesisAdmissionChallenge
@end

@interface AncPrivateVaultGenesisAdmissionReceipt ()
@property(nonatomic, readwrite) NSString *accountId;
@property(nonatomic, readwrite) NSString *workspaceId;
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) NSString *controlEntryId;
@property(nonatomic, readwrite) NSData *controlEntryHash;
@property(nonatomic, readwrite) NSString *signerEndpointId;
@property(nonatomic, readwrite) NSData *candidateHash;
@property(nonatomic, readwrite) NSData *bootstrapTranscriptHash;
@end
@implementation AncPrivateVaultGenesisAdmissionReceipt
@end

static void AncAdmissionStatus(AncPrivateVaultGenesisAdmissionStatus *status,
                               AncPrivateVaultGenesisAdmissionStatus value) {
  if (status != NULL)
    *status = value;
}

static BOOL AncAdmissionOpaqueId(NSString *value) {
  NSData *bytes = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (bytes.length < 8 || bytes.length > 160)
    return NO;
  const uint8_t *raw = bytes.bytes;
  for (NSUInteger index = 0; index < bytes.length; index += 1) {
    uint8_t byte = raw[index];
    BOOL alphaNumeric = (byte >= 'A' && byte <= 'Z') ||
                        (byte >= 'a' && byte <= 'z') ||
                        (byte >= '0' && byte <= '9');
    if (!alphaNumeric && (index == 0 || (byte != '.' && byte != '_' &&
                                         byte != ':' && byte != '-')))
      return NO;
  }
  return YES;
}

static BOOL AncAdmissionCanonicalMap(NSData *bytes, NSUInteger maximum) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *value =
      AncPrivateVaultCanonicalDecode(bytes, maximum, &status);
  if (value == nil || value.type != AncPrivateVaultCanonicalTypeMap)
    return NO;
  NSData *roundTrip = AncPrivateVaultCanonicalEncode(value, &status);
  return roundTrip != nil && [roundTrip isEqualToData:bytes];
}

static NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *
AncAdmissionEnvelope(NSData *bytes, NSUInteger maximum, NSUInteger count) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root =
      AncPrivateVaultCanonicalDecode(bytes, maximum, &status);
  if (root == nil || root.type != AncPrivateVaultCanonicalTypeMap ||
      root.mapValue.count != count)
    return nil;
  for (NSUInteger key = 1; key <= count; key += 1)
    if (root.mapValue[@(key)] == nil)
      return nil;
  NSData *roundTrip = AncPrivateVaultCanonicalEncode(root, &status);
  return [roundTrip isEqualToData:bytes] ? root.mapValue : nil;
}

static BOOL AncAdmissionHeader(
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map,
    NSString *type) {
  return map[@1].type == AncPrivateVaultCanonicalTypeText &&
         [map[@1].textValue isEqualToString:@"anc/v1"] &&
         map[@2].type == AncPrivateVaultCanonicalTypeInteger &&
         map[@2].integerValue == 1 &&
         map[@3].type == AncPrivateVaultCanonicalTypeText &&
         [map[@3].textValue isEqualToString:type];
}

static NSData *AncAdmissionCandidateHash(NSData *candidate) {
  uint8_t digest[ANC_PV_HASH_BYTES] = {0};
  if (anc_pv_sha256_two_part(digest, kCandidateHashDomain,
                             sizeof kCandidateHashDomain, candidate.bytes,
                             candidate.length) != ANC_PV_CRYPTO_OK)
    return nil;
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static BOOL AncAdmissionTimestamp(NSString *value, uint64_t *milliseconds) {
  NSData *bytes = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (bytes.length != 24)
    return NO;
  const char *raw = bytes.bytes;
  const NSUInteger digits[] = {0,  1,  2,  3,  5,  6,  8,  9, 11,
                               12, 14, 15, 17, 18, 20, 21, 22};
  for (NSUInteger index = 0; index < sizeof digits / sizeof digits[0];
       index += 1)
    if (raw[digits[index]] < '0' || raw[digits[index]] > '9')
      return NO;
  if (raw[4] != '-' || raw[7] != '-' || raw[10] != 'T' || raw[13] != ':' ||
      raw[16] != ':' || raw[19] != '.' || raw[23] != 'Z')
    return NO;
  static NSISO8601DateFormatter *formatter;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    formatter = [NSISO8601DateFormatter new];
    formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                              NSISO8601DateFormatWithFractionalSeconds;
    formatter.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
  });
  NSDate *date = [formatter dateFromString:value];
  if (date == nil || date.timeIntervalSince1970 < 0)
    return NO;
  double exact = date.timeIntervalSince1970 * 1000.0;
  if (exact > (double)UINT64_MAX)
    return NO;
  *milliseconds = (uint64_t)llround(exact);
  return YES;
}

NSData *AncPrivateVaultGenesisAdmissionCandidateEncode(
    NSData *bootstrapTranscript, NSData *recoveryConfirmation,
    NSData *authorization, AncPrivateVaultGenesisAdmissionStatus *status) {
  AncAdmissionStatus(status, AncPrivateVaultGenesisAdmissionStatusInvalid);
  if (bootstrapTranscript.length == 0 ||
      bootstrapTranscript.length > kBootstrapMaximum ||
      recoveryConfirmation.length == 0 ||
      recoveryConfirmation.length > kConfirmationMaximum ||
      authorization.length == 0 ||
      authorization.length > kAuthorizationMaximum) {
    if (bootstrapTranscript.length > kBootstrapMaximum ||
        recoveryConfirmation.length > kConfirmationMaximum ||
        authorization.length > kAuthorizationMaximum)
      AncAdmissionStatus(status, AncPrivateVaultGenesisAdmissionStatusTooLarge);
    return nil;
  }
  if (!AncAdmissionCanonicalMap(bootstrapTranscript, kBootstrapMaximum) ||
      !AncAdmissionCanonicalMap(recoveryConfirmation, kConfirmationMaximum) ||
      !AncAdmissionCanonicalMap(authorization, kAuthorizationMaximum))
    return nil;
  AncPrivateVaultCanonicalValue *root = [AncPrivateVaultCanonicalValue map:@{
    @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
    @2 : [AncPrivateVaultCanonicalValue integer:1],
    @3 : [AncPrivateVaultCanonicalValue
        text:@"genesis-account-admission-candidate"],
    @4 : [AncPrivateVaultCanonicalValue bytes:bootstrapTranscript],
    @5 : [AncPrivateVaultCanonicalValue bytes:recoveryConfirmation],
    @6 : [AncPrivateVaultCanonicalValue bytes:authorization],
  }];
  AncPrivateVaultCanonicalStatus canonicalStatus;
  NSData *encoded = AncPrivateVaultCanonicalEncode(root, &canonicalStatus);
  if (encoded.length == 0 ||
      encoded.length > ANC_PV_GENESIS_ADMISSION_CANDIDATE_MAX_BYTES) {
    AncAdmissionStatus(
        status, encoded.length > ANC_PV_GENESIS_ADMISSION_CANDIDATE_MAX_BYTES
                    ? AncPrivateVaultGenesisAdmissionStatusTooLarge
                    : AncPrivateVaultGenesisAdmissionStatusInvalid);
    return nil;
  }
  AncAdmissionStatus(status, AncPrivateVaultGenesisAdmissionStatusOK);
  return encoded;
}

AncPrivateVaultGenesisAdmissionChallenge *
AncPrivateVaultGenesisAdmissionChallengeDecode(
    NSData *challenge, NSData *expectedCandidate, uint64_t nowMilliseconds,
    AncPrivateVaultGenesisAdmissionStatus *status) {
  AncAdmissionStatus(status, AncPrivateVaultGenesisAdmissionStatusInvalid);
  NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map =
      AncAdmissionEnvelope(challenge,
                           ANC_PV_GENESIS_ADMISSION_CHALLENGE_MAX_BYTES, 10);
  NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *candidateMap =
      AncAdmissionEnvelope(expectedCandidate,
                           ANC_PV_GENESIS_ADMISSION_CANDIDATE_MAX_BYTES, 6);
  if (map == nil || candidateMap == nil ||
      !AncAdmissionHeader(map, @"genesis-account-admission-challenge") ||
      !AncAdmissionHeader(candidateMap,
                          @"genesis-account-admission-candidate") ||
      map[@4].type != AncPrivateVaultCanonicalTypeText ||
      map[@5].type != AncPrivateVaultCanonicalTypeText ||
      map[@6].type != AncPrivateVaultCanonicalTypeText ||
      map[@7].type != AncPrivateVaultCanonicalTypeBytes ||
      map[@7].bytesValue.length != 32 ||
      map[@8].type != AncPrivateVaultCanonicalTypeText ||
      map[@9].type != AncPrivateVaultCanonicalTypeText ||
      map[@10].type != AncPrivateVaultCanonicalTypeBytes ||
      map[@10].bytesValue.length != 32 ||
      !AncAdmissionOpaqueId(map[@4].textValue) ||
      !AncAdmissionOpaqueId(map[@5].textValue) ||
      !AncAdmissionOpaqueId(map[@6].textValue))
    return nil;
  NSData *candidateHash = AncAdmissionCandidateHash(expectedCandidate);
  if (candidateHash == nil) {
    AncAdmissionStatus(status,
                       AncPrivateVaultGenesisAdmissionStatusCryptoFailed);
    return nil;
  }
  if (![candidateHash isEqualToData:map[@7].bytesValue]) {
    AncAdmissionStatus(status,
                       AncPrivateVaultGenesisAdmissionStatusBindingMismatch);
    return nil;
  }
  uint64_t issuedAt = 0, expiresAt = 0;
  if (!AncAdmissionTimestamp(map[@8].textValue, &issuedAt) ||
      !AncAdmissionTimestamp(map[@9].textValue, &expiresAt) ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > kMaximumChallengeLifetimeMs)
    return nil;
  if (issuedAt > nowMilliseconds + 30000 || nowMilliseconds >= expiresAt) {
    AncAdmissionStatus(status, AncPrivateVaultGenesisAdmissionStatusExpired);
    return nil;
  }
  AncPrivateVaultGenesisAdmissionChallenge *decoded =
      [AncPrivateVaultGenesisAdmissionChallenge new];
  decoded.challengeId = [map[@4].textValue copy];
  decoded.accountId = [map[@5].textValue copy];
  decoded.workspaceId = [map[@6].textValue copy];
  decoded.candidateHash = [candidateHash copy];
  decoded.issuedAt = [map[@8].textValue copy];
  decoded.expiresAt = [map[@9].textValue copy];
  decoded.authenticationTag = [map[@10].bytesValue copy];
  AncAdmissionStatus(status, AncPrivateVaultGenesisAdmissionStatusOK);
  return decoded;
}

NSData *AncPrivateVaultGenesisAdmissionRequestEncode(
    NSData *candidate, NSData *challenge,
    AncPrivateVaultGenesisAdmissionStatus *status) {
  AncAdmissionStatus(status, AncPrivateVaultGenesisAdmissionStatusInvalid);
  NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *candidateMap =
      AncAdmissionEnvelope(candidate,
                           ANC_PV_GENESIS_ADMISSION_CANDIDATE_MAX_BYTES, 6);
  NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *challengeMap =
      AncAdmissionEnvelope(challenge,
                           ANC_PV_GENESIS_ADMISSION_CHALLENGE_MAX_BYTES, 10);
  if (candidateMap == nil || challengeMap == nil ||
      !AncAdmissionHeader(candidateMap,
                          @"genesis-account-admission-candidate") ||
      !AncAdmissionHeader(challengeMap, @"genesis-account-admission-challenge"))
    return nil;
  AncPrivateVaultCanonicalValue *root = [AncPrivateVaultCanonicalValue map:@{
    @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
    @2 : [AncPrivateVaultCanonicalValue integer:1],
    @3 : [AncPrivateVaultCanonicalValue
        text:@"genesis-account-admission-request"],
    @4 : [AncPrivateVaultCanonicalValue bytes:candidate],
    @5 : [AncPrivateVaultCanonicalValue bytes:challenge],
  }];
  AncPrivateVaultCanonicalStatus canonicalStatus;
  NSData *encoded = AncPrivateVaultCanonicalEncode(root, &canonicalStatus);
  if (encoded.length == 0 ||
      encoded.length > ANC_PV_GENESIS_ADMISSION_REQUEST_MAX_BYTES) {
    AncAdmissionStatus(
        status, encoded.length > ANC_PV_GENESIS_ADMISSION_REQUEST_MAX_BYTES
                    ? AncPrivateVaultGenesisAdmissionStatusTooLarge
                    : AncPrivateVaultGenesisAdmissionStatusInvalid);
    return nil;
  }
  AncAdmissionStatus(status, AncPrivateVaultGenesisAdmissionStatusOK);
  return encoded;
}

AncPrivateVaultGenesisAdmissionReceipt *
AncPrivateVaultGenesisAdmissionReceiptDecode(
    NSData *receipt, AncPrivateVaultGenesisAdmissionChallenge *challenge,
    NSData *expectedCandidate, NSString *expectedVaultId,
    NSString *expectedControlEntryId, NSData *expectedControlEntryHash,
    NSString *expectedSignerEndpointId, NSData *expectedBootstrapTranscriptHash,
    AncPrivateVaultGenesisAdmissionStatus *status) {
  AncAdmissionStatus(status, AncPrivateVaultGenesisAdmissionStatusInvalid);
  NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map =
      AncAdmissionEnvelope(receipt, ANC_PV_GENESIS_ADMISSION_RECEIPT_MAX_BYTES,
                           11);
  NSData *candidateHash = AncAdmissionCandidateHash(expectedCandidate);
  if (map == nil || candidateHash == nil ||
      !AncAdmissionHeader(map, @"genesis-account-admission-receipt") ||
      object_getClass(challenge) !=
          AncPrivateVaultGenesisAdmissionChallenge.class
      || map[@4].type != AncPrivateVaultCanonicalTypeText ||
      map[@5].type != AncPrivateVaultCanonicalTypeText ||
      map[@6].type != AncPrivateVaultCanonicalTypeText ||
      map[@7].type != AncPrivateVaultCanonicalTypeText ||
      map[@8].type != AncPrivateVaultCanonicalTypeBytes ||
      map[@8].bytesValue.length != 32 ||
      map[@9].type != AncPrivateVaultCanonicalTypeText ||
      map[@10].type != AncPrivateVaultCanonicalTypeBytes ||
      map[@10].bytesValue.length != 32 ||
      map[@11].type != AncPrivateVaultCanonicalTypeBytes ||
      map[@11].bytesValue.length != 32)
    return nil;
  BOOL exact =
      [map[@4].textValue isEqualToString:challenge.accountId] &&
      [map[@5].textValue isEqualToString:challenge.workspaceId] &&
      [map[@6].textValue isEqualToString:expectedVaultId] &&
      [map[@7].textValue isEqualToString:expectedControlEntryId] &&
      [map[@8].bytesValue isEqualToData:expectedControlEntryHash] &&
      [map[@9].textValue isEqualToString:expectedSignerEndpointId] &&
      [map[@10].bytesValue isEqualToData:candidateHash] &&
      [map[@11].bytesValue isEqualToData:expectedBootstrapTranscriptHash] &&
      AncAdmissionOpaqueId(map[@4].textValue) &&
      AncAdmissionOpaqueId(map[@5].textValue) &&
      AncAdmissionOpaqueId(map[@6].textValue) &&
      AncAdmissionOpaqueId(map[@7].textValue) &&
      AncAdmissionOpaqueId(map[@9].textValue);
  if (!exact) {
    AncAdmissionStatus(status,
                       AncPrivateVaultGenesisAdmissionStatusBindingMismatch);
    return nil;
  }
  AncPrivateVaultGenesisAdmissionReceipt *decoded =
      [AncPrivateVaultGenesisAdmissionReceipt new];
  decoded.accountId = [map[@4].textValue copy];
  decoded.workspaceId = [map[@5].textValue copy];
  decoded.vaultId = [map[@6].textValue copy];
  decoded.controlEntryId = [map[@7].textValue copy];
  decoded.controlEntryHash = [map[@8].bytesValue copy];
  decoded.signerEndpointId = [map[@9].textValue copy];
  decoded.candidateHash = [map[@10].bytesValue copy];
  decoded.bootstrapTranscriptHash = [map[@11].bytesValue copy];
  AncAdmissionStatus(status, AncPrivateVaultGenesisAdmissionStatusOK);
  return decoded;
}
