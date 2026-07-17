#import "PrivateVaultRecoveryWrap.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

#include <math.h>
#include <stdio.h>

static const NSUInteger kMaximumEnvelopeBytes = 1024 * 1024;
static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);
static const uint8_t kWrapDomain[] = "anc/v1/recovery-wrap";
static const uint8_t kEEKDomain[] = "anc/v1/eek-wrap";

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultRecoveryWrapZeroizationHook gZeroizationHook;
void AncPrivateVaultRecoveryWrapSetZeroizationHookForTesting(
    AncPrivateVaultRecoveryWrapZeroizationHook hook) {
  gZeroizationHook = [hook copy];
}
#endif

static void ClearUnsealBuffer(uint8_t *bytes, size_t length) {
  anc_pv_zeroize(bytes, length);
#if ANC_PRIVATE_VAULT_TESTING
  BOOL cleared = YES;
  for (size_t index = 0; index < length; index++)
    cleared = cleared && bytes[index] == 0;
  if (gZeroizationHook != nil)
    gZeroizationHook(cleared);
#endif
}

@interface AncPrivateVaultRecoveryWrap ()
@property(nonatomic, readwrite) NSData *vaultId;
@property(nonatomic, readwrite) uint64_t createdAt;
@property(nonatomic, readwrite) NSData *envelopeId;
@property(nonatomic, readwrite) NSData *ceremonyId;
@property(nonatomic, readwrite) uint64_t recoveryGeneration;
@property(nonatomic, readwrite) NSData *recoveryId;
@property(nonatomic, readwrite) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readwrite) uint64_t epoch;
@property(nonatomic, readwrite) NSData *issuerEndpointId;
@property(nonatomic, readwrite) uint64_t activationControlSequence;
@property(nonatomic, readwrite) NSData *activationPreviousHead;
@property(nonatomic, readwrite) NSData *activationPreviousMembershipHash;
@property(nonatomic, readwrite) NSData *nonce;
@property(nonatomic, readwrite) NSData *ciphertext;
@property(nonatomic, readwrite) NSData *signature;
@end
@implementation AncPrivateVaultRecoveryWrap
@end

static BOOL ExactKeys(NSDictionary<NSNumber *, id> *map) {
  static NSArray<NSNumber *> *keys;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    keys = @[
      @1, @2, @3, @4, @5, @400, @401, @402, @403, @404, @405, @406, @407, @408,
      @409, @410, @411
    ];
  });
  if (map.count != keys.count)
    return NO;
  for (NSNumber *key in keys)
    if (map[key] == nil)
      return NO;
  return YES;
}

static BOOL Bytes(AncPrivateVaultCanonicalValue *value, NSUInteger length,
                  NSData **output) {
  if (value.type != AncPrivateVaultCanonicalTypeBytes ||
      value.bytesValue.length != length)
    return NO;
  *output = [value.bytesValue copy];
  return YES;
}

static BOOL Integer(AncPrivateVaultCanonicalValue *value, uint64_t minimum,
                    uint64_t *output) {
  if (value.type != AncPrivateVaultCanonicalTypeInteger ||
      value.integerValue < 0 || (uint64_t)value.integerValue < minimum ||
      (uint64_t)value.integerValue > kMaximumSafeInteger)
    return NO;
  *output = (uint64_t)value.integerValue;
  return YES;
}

static NSMutableData *DomainMessage(const uint8_t *domain, size_t length,
                                    NSData *payload) {
  NSMutableData *message = [NSMutableData dataWithBytes:domain length:length];
  [message appendData:payload];
  return message;
}

NSData *AncPrivateVaultRecoveryWrapEncodeUnsigned(
    AncPrivateVaultRecoveryWrap *wrap,
    AncPrivateVaultRecoveryWrapStatus *status) {
  if (status)
    *status = AncPrivateVaultRecoveryWrapStatusWrongType;
  if (wrap == nil)
    return nil;
  NSDictionary *map = @{
    @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
    @2 : [AncPrivateVaultCanonicalValue bytes:wrap.vaultId],
    @3 : [AncPrivateVaultCanonicalValue text:@"recovery-wrap"],
    @4 : [AncPrivateVaultCanonicalValue integer:(int64_t)wrap.createdAt],
    @5 : [AncPrivateVaultCanonicalValue bytes:wrap.envelopeId],
    @400 : [AncPrivateVaultCanonicalValue bytes:wrap.ceremonyId],
    @401 : [AncPrivateVaultCanonicalValue
        integer:(int64_t)wrap.recoveryGeneration],
    @402 : [AncPrivateVaultCanonicalValue bytes:wrap.recoveryId],
    @403 : [AncPrivateVaultCanonicalValue
        bytes:wrap.recoveryKeyAgreementPublicKey],
    @404 : [AncPrivateVaultCanonicalValue integer:(int64_t)wrap.epoch],
    @405 : [AncPrivateVaultCanonicalValue bytes:wrap.issuerEndpointId],
    @406 : [AncPrivateVaultCanonicalValue
        integer:(int64_t)wrap.activationControlSequence],
    @407 : [AncPrivateVaultCanonicalValue bytes:wrap.activationPreviousHead],
    @408 : [AncPrivateVaultCanonicalValue
        bytes:wrap.activationPreviousMembershipHash],
    @409 : [AncPrivateVaultCanonicalValue bytes:wrap.nonce],
    @410 : [AncPrivateVaultCanonicalValue bytes:wrap.ciphertext],
  };
  AncPrivateVaultCanonicalStatus canonical;
  NSData *encoded = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:map], &canonical);
  if (encoded != nil && status)
    *status = AncPrivateVaultRecoveryWrapStatusOK;
  return encoded;
}

AncPrivateVaultRecoveryWrap *
AncPrivateVaultRecoveryWrapDecode(NSData *encoded, NSData *expectedVaultId,
                                  AncPrivateVaultRecoveryWrapStatus *status) {
  if (status)
    *status = AncPrivateVaultRecoveryWrapStatusInvalidCanonical;
  if (encoded.length == 0 || encoded.length > kMaximumEnvelopeBytes) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusTooLarge;
    return nil;
  }
  AncPrivateVaultCanonicalStatus canonical;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      encoded, kMaximumEnvelopeBytes, &canonical);
  if (root == nil || root.type != AncPrivateVaultCanonicalTypeMap)
    return nil;
  NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map =
      root.mapValue;
  if (!ExactKeys(map)) {
    NSSet *allowed = [NSSet setWithArray:@[
      @1, @2, @3, @4, @5, @400, @401, @402, @403, @404, @405, @406, @407, @408,
      @409, @410, @411
    ]];
    BOOL unknown = NO;
    for (NSNumber *key in map)
      unknown = unknown || ![allowed containsObject:key];
    if (status)
      *status = unknown ? AncPrivateVaultRecoveryWrapStatusUnknownField
                        : AncPrivateVaultRecoveryWrapStatusMissingField;
    return nil;
  }
  if (map[@1].type != AncPrivateVaultCanonicalTypeText ||
      ![map[@1].textValue isEqualToString:@"anc/v1"] ||
      map[@3].type != AncPrivateVaultCanonicalTypeText ||
      ![map[@3].textValue isEqualToString:@"recovery-wrap"]) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusWrongType;
    return nil;
  }
  AncPrivateVaultRecoveryWrap *wrap = [AncPrivateVaultRecoveryWrap new];
  NSDictionary<NSNumber *, NSNumber *> *byteLengths = @{
    @2 : @16,
    @5 : @16,
    @400 : @16,
    @402 : @16,
    @403 : @32,
    @405 : @16,
    @407 : @32,
    @408 : @32,
    @409 : @24,
    @410 : @64,
    @411 : @64,
  };
  for (NSNumber *key in byteLengths) {
    if (((AncPrivateVaultCanonicalValue *)map[key]).type !=
        AncPrivateVaultCanonicalTypeBytes) {
      if (status)
        *status = AncPrivateVaultRecoveryWrapStatusWrongType;
      return nil;
    }
    if (((AncPrivateVaultCanonicalValue *)map[key]).bytesValue.length !=
        byteLengths[key].unsignedIntegerValue) {
      if (status)
        *status = AncPrivateVaultRecoveryWrapStatusWrongLength;
      return nil;
    }
  }
  NSData *vault = nil, *envelope = nil, *ceremony = nil, *recoveryId = nil;
  NSData *recoveryPublic = nil, *issuer = nil, *previousHead = nil;
  NSData *previousMembership = nil, *nonce = nil, *ciphertext = nil;
  NSData *signature = nil;
  BOOL lengths =
      Bytes(map[@2], 16, &vault) && Bytes(map[@5], 16, &envelope) &&
      Bytes(map[@400], 16, &ceremony) && Bytes(map[@402], 16, &recoveryId) &&
      Bytes(map[@403], 32, &recoveryPublic) && Bytes(map[@405], 16, &issuer) &&
      Bytes(map[@407], 32, &previousHead) &&
      Bytes(map[@408], 32, &previousMembership) &&
      Bytes(map[@409], 24, &nonce) && Bytes(map[@410], 64, &ciphertext) &&
      Bytes(map[@411], 64, &signature);
  if (!lengths || expectedVaultId.length != 16) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusWrongLength;
    return nil;
  }
  if (![vault isEqualToData:expectedVaultId]) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusControlBinding;
    return nil;
  }
  uint64_t createdAt = 0, recoveryGeneration = 0, epoch = 0, activation = 0;
  BOOL integers = Integer(map[@4], 1, &createdAt) &&
                  Integer(map[@401], 1, &recoveryGeneration) &&
                  Integer(map[@404], 1, &epoch) &&
                  Integer(map[@406], 0, &activation);
  if (!integers) {
    if (status)
      *status = map[@4].type == AncPrivateVaultCanonicalTypeInteger &&
                        map[@401].type == AncPrivateVaultCanonicalTypeInteger &&
                        map[@404].type == AncPrivateVaultCanonicalTypeInteger &&
                        map[@406].type == AncPrivateVaultCanonicalTypeInteger
                    ? AncPrivateVaultRecoveryWrapStatusOutOfRange
                    : AncPrivateVaultRecoveryWrapStatusWrongType;
    return nil;
  }
  wrap.vaultId = vault;
  wrap.createdAt = createdAt;
  wrap.envelopeId = envelope;
  wrap.ceremonyId = ceremony;
  wrap.recoveryGeneration = recoveryGeneration;
  wrap.recoveryId = recoveryId;
  wrap.recoveryKeyAgreementPublicKey = recoveryPublic;
  wrap.epoch = epoch;
  wrap.issuerEndpointId = issuer;
  wrap.activationControlSequence = activation;
  wrap.activationPreviousHead = previousHead;
  wrap.activationPreviousMembershipHash = previousMembership;
  wrap.nonce = nonce;
  wrap.ciphertext = ciphertext;
  wrap.signature = signature;
  AncPrivateVaultRecoveryWrapStatus encodeStatus;
  NSData *roundTrip =
      AncPrivateVaultRecoveryWrapEncodeUnsigned(wrap, &encodeStatus);
  NSMutableDictionary *signedMap = [map mutableCopy];
  [signedMap removeObjectForKey:@411];
  NSData *observedUnsigned = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:signedMap], &canonical);
  if (![roundTrip isEqualToData:observedUnsigned])
    return nil;
  if (status)
    *status = AncPrivateVaultRecoveryWrapStatusOK;
  return wrap;
}

NSData *
AncPrivateVaultRecoveryWrapHash(NSData *encoded, NSData *expectedVaultId,
                                AncPrivateVaultRecoveryWrapStatus *status) {
  if (AncPrivateVaultRecoveryWrapDecode(encoded, expectedVaultId, status) ==
      nil)
    return nil;
  NSMutableData *message =
      (NSMutableData *)DomainMessage(kWrapDomain, sizeof kWrapDomain, encoded);
  uint8_t digest[32] = {0};
  BOOL okay = anc_pv_blake2b_256(digest, message.bytes, message.length) ==
              ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(message.mutableBytes, message.length);
  NSData *result = okay ? [NSData dataWithBytes:digest length:32] : nil;
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

AncPrivateVaultRecoveryWrap *
AncPrivateVaultRecoveryWrapVerify(NSData *encoded, NSData *expectedVaultId,
                                  NSData *issuerSigningPublicKey,
                                  AncPrivateVaultRecoveryWrapStatus *status) {
  AncPrivateVaultRecoveryWrap *wrap =
      AncPrivateVaultRecoveryWrapDecode(encoded, expectedVaultId, status);
  if (wrap == nil)
    return nil;
  if (issuerSigningPublicKey.length != 32) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusWrongLength;
    return nil;
  }
  NSData *unsignedBytes =
      AncPrivateVaultRecoveryWrapEncodeUnsigned(wrap, status);
  NSMutableData *message = (NSMutableData *)DomainMessage(
      kWrapDomain, sizeof kWrapDomain, unsignedBytes);
  BOOL okay =
      anc_pv_ed25519_verify(wrap.signature.bytes, message.bytes, message.length,
                            issuerSigningPublicKey.bytes) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(message.mutableBytes, message.length);
  if (!okay) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusInvalidSignature;
    return nil;
  }
  if (status)
    *status = AncPrivateVaultRecoveryWrapStatusOK;
  return wrap;
}

static int64_t TimestampMilliseconds(NSString *value, BOOL *okay) {
  NSString *pattern = @"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}("
                      @"\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$";
  if (![value isKindOfClass:NSString.class] ||
      [value rangeOfString:pattern options:NSRegularExpressionSearch]
              .location == NSNotFound) {
    *okay = NO;
    return 0;
  }
  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                            NSISO8601DateFormatWithFractionalSeconds;
  NSDate *date = [formatter dateFromString:value];
  if (date == nil) {
    formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime;
    date = [formatter dateFromString:value];
  }
  *okay = date != nil && date.timeIntervalSince1970 >= 0;
  return *okay ? (int64_t)floor(date.timeIntervalSince1970 * 1000.0 + 0.0001)
               : 0;
}

static NSData *HexData(NSString *hex, NSUInteger length) {
  if (![hex isKindOfClass:NSString.class] || hex.length != length * 2)
    return nil;
  NSMutableData *data = [NSMutableData dataWithLength:length];
  uint8_t *bytes = data.mutableBytes;
  for (NSUInteger index = 0; index < length; index++) {
    unichar high = [hex characterAtIndex:index * 2];
    unichar low = [hex characterAtIndex:index * 2 + 1];
    if (!((high >= '0' && high <= '9') || (high >= 'a' && high <= 'f')) ||
        !((low >= '0' && low <= '9') || (low >= 'a' && low <= 'f')))
      return nil;
    uint8_t highValue = high <= '9' ? high - '0' : high - 'a' + 10;
    uint8_t lowValue = low <= '9' ? low - '0' : low - 'a' + 10;
    bytes[index] = (uint8_t)((highValue << 4) | lowValue);
  }
  return data;
}

static BOOL ExactStringKeys(NSDictionary *dictionary,
                            NSArray<NSString *> *keys) {
  if (![dictionary isKindOfClass:NSDictionary.class] ||
      dictionary.count != keys.count)
    return NO;
  NSSet *expected = [NSSet setWithArray:keys];
  for (id key in dictionary)
    if (![key isKindOfClass:NSString.class] || ![expected containsObject:key])
      return NO;
  return YES;
}

static BOOL UIntValue(id value, uint64_t *output) {
  if (![value isKindOfClass:NSNumber.class] ||
      CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID())
    return NO;
  const char *type = [value objCType];
  if (strcmp(type, @encode(float)) == 0 || strcmp(type, @encode(double)) == 0)
    return NO;
  long long signedValue = [value longLongValue];
  if (signedValue < 0 || (uint64_t)signedValue > kMaximumSafeInteger)
    return NO;
  *output = (uint64_t)signedValue;
  return YES;
}

static BOOL BooleanValue(id value) {
  return [value isKindOfClass:NSNumber.class] &&
         CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID();
}

static BOOL ValidMember(NSDictionary *member) {
  if (!ExactStringKeys(member, @[
        @"endpointId", @"role", @"unattended", @"signingPublicKey",
        @"keyAgreementPublicKey", @"enrollmentRef"
      ]))
    return NO;
  return HexData(member[@"endpointId"], 16) != nil &&
         ([member[@"role"] isEqual:@"endpoint"] ||
          [member[@"role"] isEqual:@"broker"]) &&
         BooleanValue(member[@"unattended"]) &&
         (([member[@"role"] isEqual:@"endpoint"] &&
           ![member[@"unattended"] boolValue]) ||
          ([member[@"role"] isEqual:@"broker"] &&
           [member[@"unattended"] boolValue])) &&
         HexData(member[@"signingPublicKey"], 32) != nil &&
         HexData(member[@"keyAgreementPublicKey"], 32) != nil &&
         HexData(member[@"enrollmentRef"], 16) != nil;
}

static BOOL ValidMembers(id members) {
  if (![members isKindOfClass:NSArray.class] || [members count] == 0 ||
      [members count] > 64)
    return NO;
  NSString *previous = nil;
  NSUInteger brokers = 0;
  for (id member in members)
    if (!ValidMember(member) ||
        (previous != nil &&
         [previous compare:member[@"endpointId"]] != NSOrderedAscending))
      return NO;
    else {
      previous = member[@"endpointId"];
      brokers += [member[@"role"] isEqual:@"broker"] ? 1 : 0;
    }
  if (brokers > 1)
    return NO;
  return YES;
}

static BOOL ValidRemovedEndpointIds(id value, NSUInteger maximum) {
  if (![value isKindOfClass:NSArray.class] || [value count] > maximum)
    return NO;
  NSString *previous = nil;
  for (id identifier in value) {
    if (HexData(identifier, 16) == nil ||
        (previous != nil &&
         [previous compare:identifier] != NSOrderedAscending))
      return NO;
    previous = identifier;
  }
  return YES;
}

static BOOL ActiveMembersExcludeRemoved(NSArray *members, NSArray *removed) {
  NSSet *removedSet = [NSSet setWithArray:removed];
  for (NSDictionary *member in members)
    if ([removedSet containsObject:member[@"endpointId"]])
      return NO;
  return YES;
}

static NSDictionary *FreezeDictionary(NSDictionary *dictionary) {
  if (![NSJSONSerialization isValidJSONObject:dictionary])
    return nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:dictionary
                                                 options:0
                                                   error:nil];
  return data == nil ? nil
                     : [NSJSONSerialization JSONObjectWithData:data
                                                       options:0
                                                         error:nil];
}

static BOOL ParseState(NSDictionary *input, NSDictionary **output) {
  NSDictionary *state = FreezeDictionary(input);
  if (!ExactStringKeys(state, @[
        @"vaultId", @"sequence", @"headHash", @"membershipHash", @"signedAt",
        @"activeMembers", @"removedEndpointIds", @"epoch",
        @"recoveryGeneration", @"recoveryId", @"recoverySigningPublicKey",
        @"recoveryKeyAgreementPublicKey", @"recoveryWrapHash", @"freshnessMode"
      ]))
    return NO;
  uint64_t sequence = 0, epoch = 0, generation = 0;
  if (HexData(state[@"vaultId"], 16) == nil ||
      !UIntValue(state[@"sequence"], &sequence) ||
      HexData(state[@"headHash"], 32) == nil ||
      HexData(state[@"membershipHash"], 32) == nil ||
      ![state[@"signedAt"] isKindOfClass:NSString.class] ||
      !ValidMembers(state[@"activeMembers"]) ||
      !ValidRemovedEndpointIds(state[@"removedEndpointIds"], 4096) ||
      !ActiveMembersExcludeRemoved(state[@"activeMembers"],
                                   state[@"removedEndpointIds"]) ||
      !UIntValue(state[@"epoch"], &epoch) || epoch == 0 ||
      !UIntValue(state[@"recoveryGeneration"], &generation) ||
      generation == 0 || HexData(state[@"recoveryId"], 16) == nil ||
      HexData(state[@"recoverySigningPublicKey"], 32) == nil ||
      HexData(state[@"recoveryKeyAgreementPublicKey"], 32) == nil ||
      HexData(state[@"recoveryWrapHash"], 32) == nil ||
      (![state[@"freshnessMode"] isEqual:@"endpoint_witnessed"] &&
       ![state[@"freshnessMode"] isEqual:@"eventual_fork_detection"]))
    return NO;
  *output = state;
  return YES;
}

static BOOL ParseCommit(NSDictionary *input, NSDictionary **output) {
  NSDictionary *commit = FreezeDictionary(input);
  if (!ExactStringKeys(commit, @[
        @"suite", @"type", @"vaultId", @"ceremonyId", @"ceremonyKind", @"epoch",
        @"previousMembershipHash", @"activeMembers", @"removedEndpointIds",
        @"rotationCompleted", @"outstandingJobsResolved",
        @"recoverySnapshotHash", @"recoveryAuthorizationHash",
        @"recoveryGeneration", @"recoveryId", @"recoverySigningPublicKey",
        @"recoveryKeyAgreementPublicKey", @"recoveryWrapHash"
      ]))
    return NO;
  uint64_t epoch = 0, generation = 0;
  if (![commit[@"suite"] isEqual:@"anc/v1"] ||
      ![commit[@"type"] isEqual:@"membership_commit"] ||
      HexData(commit[@"vaultId"], 16) == nil ||
      HexData(commit[@"ceremonyId"], 16) == nil || ![@[
        @"first_device", @"add_device", @"add_broker", @"remove_device",
        @"remove_broker", @"broker_replacement", @"recovery"
      ] containsObject:commit[@"ceremonyKind"]] ||
      !UIntValue(commit[@"epoch"], &epoch) || epoch == 0 ||
      (commit[@"previousMembershipHash"] != NSNull.null &&
       HexData(commit[@"previousMembershipHash"], 32) == nil) ||
      !ValidMembers(commit[@"activeMembers"]) ||
      !ValidRemovedEndpointIds(commit[@"removedEndpointIds"], 64) ||
      !ActiveMembersExcludeRemoved(commit[@"activeMembers"],
                                   commit[@"removedEndpointIds"]) ||
      !BooleanValue(commit[@"rotationCompleted"]) ||
      !BooleanValue(commit[@"outstandingJobsResolved"]) ||
      (commit[@"recoverySnapshotHash"] != NSNull.null &&
       HexData(commit[@"recoverySnapshotHash"], 32) == nil) ||
      (commit[@"recoveryAuthorizationHash"] != NSNull.null &&
       HexData(commit[@"recoveryAuthorizationHash"], 32) == nil) ||
      !UIntValue(commit[@"recoveryGeneration"], &generation) ||
      generation == 0 || HexData(commit[@"recoveryId"], 16) == nil ||
      HexData(commit[@"recoverySigningPublicKey"], 32) == nil ||
      HexData(commit[@"recoveryKeyAgreementPublicKey"], 32) == nil ||
      HexData(commit[@"recoveryWrapHash"], 32) == nil)
    return NO;
  BOOL recovery = [commit[@"ceremonyKind"] isEqual:@"recovery"];
  BOOL hasSnapshot = commit[@"recoverySnapshotHash"] != NSNull.null;
  BOOL hasAuthorization = commit[@"recoveryAuthorizationHash"] != NSNull.null;
  if ((recovery && (!hasSnapshot || !hasAuthorization)) ||
      (!recovery && (hasSnapshot || hasAuthorization)))
    return NO;
  *output = commit;
  return YES;
}

static BOOL ParseEntry(NSDictionary *input, NSDictionary **output) {
  NSDictionary *entry = FreezeDictionary(input);
  if (!ExactStringKeys(entry, @[
        @"suite", @"type", @"vaultId", @"createdAt", @"envelopeId", @"sequence",
        @"previousHash", @"innerEnvelope", @"signerEndpointId", @"signature"
      ]))
    return NO;
  uint64_t sequence = 0;
  if (![entry[@"suite"] isEqual:@"anc/v1"] ||
      ![entry[@"type"] isEqual:@"log-entry"] ||
      HexData(entry[@"vaultId"], 16) == nil ||
      ![entry[@"createdAt"] isKindOfClass:NSString.class] ||
      HexData(entry[@"envelopeId"], 16) == nil ||
      !UIntValue(entry[@"sequence"], &sequence) ||
      HexData(entry[@"previousHash"], 32) == nil ||
      ![entry[@"innerEnvelope"] isKindOfClass:NSDictionary.class] ||
      HexData(entry[@"signerEndpointId"], 16) == nil ||
      HexData(entry[@"signature"], 64) == nil)
    return NO;
  *output = entry;
  return YES;
}

static NSDictionary *Issuer(NSDictionary *state, NSData *issuerId) {
  NSMutableString *identifier = [NSMutableString stringWithCapacity:32];
  for (NSUInteger i = 0; i < issuerId.length; i++)
    [identifier appendFormat:@"%02x", ((const uint8_t *)issuerId.bytes)[i]];
  for (NSDictionary *member in state[@"activeMembers"])
    if ([member[@"endpointId"] isEqualToString:identifier] &&
        [member[@"role"] isEqualToString:@"endpoint"])
      return member;
  return nil;
}

AncPrivateVaultRecoveryWrap *AncPrivateVaultRecoveryWrapVerifyCurrent(
    NSData *encoded, NSDictionary *state, uint64_t now,
    AncPrivateVaultRecoveryWrapStatus *status) {
  NSDictionary *frozenState = nil;
  if (!ParseState(state, &frozenState)) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusControlBinding;
    return nil;
  }
  state = frozenState;
  NSData *vault = HexData(state[@"vaultId"], 16);
  AncPrivateVaultRecoveryWrap *wrap =
      AncPrivateVaultRecoveryWrapDecode(encoded, vault, status);
  if (wrap == nil)
    return nil;
  NSData *hash = AncPrivateVaultRecoveryWrapHash(encoded, vault, status);
  if (![hash isEqualToData:HexData(state[@"recoveryWrapHash"], 32)]) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusHashMismatch;
    return nil;
  }
  if (wrap.recoveryGeneration !=
          [state[@"recoveryGeneration"] unsignedLongLongValue] ||
      ![wrap.recoveryId isEqualToData:HexData(state[@"recoveryId"], 16)] ||
      ![wrap.recoveryKeyAgreementPublicKey
          isEqualToData:HexData(state[@"recoveryKeyAgreementPublicKey"], 32)] ||
      wrap.epoch != [state[@"epoch"] unsignedLongLongValue]) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusAuthorityBinding;
    return nil;
  }
  if (wrap.activationControlSequence >
      [state[@"sequence"] unsignedLongLongValue]) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusActivationBinding;
    return nil;
  }
  BOOL timeOkay = NO;
  int64_t stateTime = TimestampMilliseconds(state[@"signedAt"], &timeOkay);
  if (!timeOkay || wrap.createdAt > UINT64_MAX / 1000 ||
      wrap.createdAt * 1000 > (uint64_t)stateTime || wrap.createdAt > now) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusCurrentTime;
    return nil;
  }
  NSDictionary *issuer = Issuer(state, wrap.issuerEndpointId);
  if (issuer == nil) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusIssuerBinding;
    return nil;
  }
  return AncPrivateVaultRecoveryWrapVerify(
      encoded, vault, HexData(issuer[@"signingPublicKey"], 32), status);
}

AncPrivateVaultRecoveryWrap *AncPrivateVaultRecoveryWrapVerifyRotation(
    NSData *encoded, NSDictionary *state, NSDictionary *commit,
    NSDictionary *entry, AncPrivateVaultRecoveryWrapStatus *status) {
  NSDictionary *frozenState = nil, *frozenCommit = nil, *frozenEntry = nil;
  NSDictionary *innerCommit = nil;
  if (!ParseState(state, &frozenState) || !ParseCommit(commit, &frozenCommit) ||
      !ParseEntry(entry, &frozenEntry) ||
      !ParseCommit(frozenEntry[@"innerEnvelope"], &innerCommit) ||
      ![innerCommit isEqual:frozenCommit]) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusControlBinding;
    return nil;
  }
  state = frozenState;
  commit = frozenCommit;
  entry = frozenEntry;
  if ([commit[@"ceremonyKind"] isEqualToString:@"recovery"] ||
      [commit[@"epoch"] unsignedLongLongValue] !=
          [state[@"epoch"] unsignedLongLongValue] + 1 ||
      ![entry[@"vaultId"] isEqual:state[@"vaultId"]] ||
      ![commit[@"vaultId"] isEqual:state[@"vaultId"]] ||
      [entry[@"sequence"] unsignedLongLongValue] !=
          [state[@"sequence"] unsignedLongLongValue] + 1 ||
      ![entry[@"previousHash"] isEqual:state[@"headHash"]]) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusControlBinding;
    return nil;
  }
  NSData *vault = HexData(state[@"vaultId"], 16);
  AncPrivateVaultRecoveryWrap *wrap =
      AncPrivateVaultRecoveryWrapDecode(encoded, vault, status);
  if (wrap == nil)
    return nil;
  NSData *hash = AncPrivateVaultRecoveryWrapHash(encoded, vault, status);
  if (![hash isEqualToData:HexData(commit[@"recoveryWrapHash"], 32)]) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusHashMismatch;
    return nil;
  }
  if (![wrap.ceremonyId isEqualToData:HexData(commit[@"ceremonyId"], 16)]) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusControlBinding;
    return nil;
  }
  NSDictionary *issuer = Issuer(state, wrap.issuerEndpointId);
  NSMutableString *issuerHex = [NSMutableString string];
  for (NSUInteger i = 0; i < wrap.issuerEndpointId.length; i++)
    [issuerHex appendFormat:@"%02x",
                            ((const uint8_t *)wrap.issuerEndpointId.bytes)[i]];
  if (issuer == nil ||
      ![issuerHex isEqualToString:entry[@"signerEndpointId"]]) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusIssuerBinding;
    return nil;
  }
  if (wrap.epoch != [commit[@"epoch"] unsignedLongLongValue] ||
      wrap.activationControlSequence !=
          [entry[@"sequence"] unsignedLongLongValue] ||
      ![wrap.activationPreviousHead
          isEqualToData:HexData(state[@"headHash"], 32)] ||
      ![wrap.activationPreviousMembershipHash
          isEqualToData:HexData(state[@"membershipHash"], 32)]) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusActivationBinding;
    return nil;
  }
  if (wrap.recoveryGeneration !=
          [state[@"recoveryGeneration"] unsignedLongLongValue] ||
      ![wrap.recoveryId isEqualToData:HexData(state[@"recoveryId"], 16)] ||
      ![wrap.recoveryKeyAgreementPublicKey
          isEqualToData:HexData(state[@"recoveryKeyAgreementPublicKey"], 32)] ||
      [commit[@"recoveryGeneration"] unsignedLongLongValue] !=
          [state[@"recoveryGeneration"] unsignedLongLongValue] ||
      ![commit[@"recoveryId"] isEqual:state[@"recoveryId"]] ||
      ![commit[@"recoverySigningPublicKey"]
          isEqual:state[@"recoverySigningPublicKey"]] ||
      ![commit[@"recoveryKeyAgreementPublicKey"]
          isEqual:state[@"recoveryKeyAgreementPublicKey"]]) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusAuthorityBinding;
    return nil;
  }
  BOOL lowerOkay = NO, upperOkay = NO;
  int64_t lower = TimestampMilliseconds(state[@"signedAt"], &lowerOkay);
  int64_t upper = TimestampMilliseconds(entry[@"createdAt"], &upperOkay);
  if (!lowerOkay || !upperOkay || wrap.createdAt > UINT64_MAX / 1000) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusRotationTime;
    return nil;
  }
  uint64_t wrapMilliseconds = wrap.createdAt * 1000;
  if (wrapMilliseconds < (uint64_t)lower ||
      wrapMilliseconds > (uint64_t)upper) {
    if (status)
      *status = AncPrivateVaultRecoveryWrapStatusRotationTime;
    return nil;
  }
  return AncPrivateVaultRecoveryWrapVerify(
      encoded, vault, HexData(issuer[@"signingPublicKey"], 32), status);
}

AncPrivateVaultRecoveryWrapStatus AncPrivateVaultRecoveryWrapUnseal(
    NSData *encoded, NSData *expectedVaultId, NSData *issuerSigningPublicKey,
    NSData *issuerKeyAgreementPublicKey,
    const uint8_t recoveryKeyAgreementPrivateKey[32],
    AncPrivateVaultRecoveryEEKConsumer consumer) {
  AncPrivateVaultRecoveryWrapStatus status;
  AncPrivateVaultRecoveryWrap *wrap = AncPrivateVaultRecoveryWrapVerify(
      encoded, expectedVaultId, issuerSigningPublicKey, &status);
  if (wrap == nil || issuerKeyAgreementPublicKey.length != 32 ||
      recoveryKeyAgreementPrivateKey == NULL || consumer == nil)
    return wrap == nil ? status
                       : AncPrivateVaultRecoveryWrapStatusUnsealAuthentication;
  uint8_t plaintext[48] = {0};
  size_t written = 0;
  BOOL opened =
      anc_pv_box_open(plaintext, sizeof plaintext, &written,
                      wrap.ciphertext.bytes, wrap.ciphertext.length,
                      wrap.nonce.bytes, issuerKeyAgreementPublicKey.bytes,
                      recoveryKeyAgreementPrivateKey) == ANC_PV_CRYPTO_OK;
  if (!opened) {
    ClearUnsealBuffer(plaintext, sizeof plaintext);
    return AncPrivateVaultRecoveryWrapStatusUnsealAuthentication;
  }
  if (written != sizeof plaintext ||
      anc_pv_memcmp(plaintext, kEEKDomain, sizeof kEEKDomain) !=
          ANC_PV_CRYPTO_OK) {
    ClearUnsealBuffer(plaintext, sizeof plaintext);
    return AncPrivateVaultRecoveryWrapStatusUnsealDomain;
  }
  __block BOOL consumed = NO;
  @try {
    consumed = consumer(plaintext + sizeof kEEKDomain);
  } @catch (__unused NSException *exception) {
    consumed = NO;
  } @finally {
    ClearUnsealBuffer(plaintext, sizeof plaintext);
  }
  return consumed ? AncPrivateVaultRecoveryWrapStatusOK
                  : AncPrivateVaultRecoveryWrapStatusUnsealZeroization;
}

NSString *
AncPrivateVaultRecoveryWrapCategory(AncPrivateVaultRecoveryWrapStatus status) {
  static NSArray<NSString *> *values;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    values = @[
      @"", @"wire.invalid_canonical", @"wire.missing_field",
      @"wire.unknown_field", @"wire.wrong_type", @"wire.length", @"wire.range",
      @"limits.envelope", @"crypto.signature", @"crypto.hash",
      @"binding.control", @"binding.authority", @"binding.issuer",
      @"binding.activation", @"time.rotation", @"time.current",
      @"unseal.authentication", @"unseal.domain", @"unseal.zeroization"
    ];
  });
  return status >= 0 && (NSUInteger)status < values.count
             ? values[status]
             : @"wire.invalid_canonical";
}
