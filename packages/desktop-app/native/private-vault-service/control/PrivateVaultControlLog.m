#import "PrivateVaultControlLog.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

#import <objc/runtime.h>

static const NSUInteger kControlMaximumBytes = 64 * 1024;
static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);
static const NSUInteger kMaximumMembers = 64;
static const NSUInteger kMaximumTombstones = 4096;
static const char kLogEntryDomain[] = "anc/v1/log-entry";

@interface AncPrivateVaultControlLogMember ()
@property(nonatomic, readwrite) NSString *endpointId;
@property(nonatomic, readwrite) NSString *role;
@property(nonatomic, readwrite) BOOL unattended;
@property(nonatomic, readwrite) NSData *signingPublicKey;
@property(nonatomic, readwrite) NSData *keyAgreementPublicKey;
@property(nonatomic, readwrite) NSString *enrollmentRef;
@end
@implementation AncPrivateVaultControlLogMember
@end

@interface AncPrivateVaultControlLogState ()
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) uint64_t sequence;
@property(nonatomic, readwrite) NSData *headHash;
@property(nonatomic, readwrite) NSData *membershipHash;
@property(nonatomic, readwrite) NSString *signedAt;
@property(nonatomic, readwrite) NSArray<AncPrivateVaultControlLogMember *> *activeMembers;
@property(nonatomic, readwrite) NSArray<NSString *> *removedEndpointIds;
@property(nonatomic, readwrite) uint64_t epoch;
@property(nonatomic, readwrite) uint64_t recoveryGeneration;
@property(nonatomic, readwrite) NSString *recoveryId;
@property(nonatomic, readwrite) NSData *recoverySigningPublicKey;
@property(nonatomic, readwrite) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readwrite) NSData *recoveryWrapHash;
@property(nonatomic, readwrite) NSString *freshnessMode;
@end
@implementation AncPrivateVaultControlLogState
@end

@interface AncPrivateVaultControlLogMembershipCommit ()
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) NSString *ceremonyId;
@property(nonatomic, readwrite) NSString *ceremonyKind;
@property(nonatomic, readwrite) uint64_t epoch;
@property(nonatomic, readwrite, nullable) NSData *previousMembershipHash;
@property(nonatomic, readwrite) NSArray<AncPrivateVaultControlLogMember *> *activeMembers;
@property(nonatomic, readwrite) NSArray<NSString *> *removedEndpointIds;
@property(nonatomic, readwrite) BOOL rotationCompleted;
@property(nonatomic, readwrite) BOOL outstandingJobsResolved;
@property(nonatomic, readwrite, nullable) NSData *recoverySnapshotHash;
@property(nonatomic, readwrite, nullable) NSData *recoveryAuthorizationHash;
@property(nonatomic, readwrite) uint64_t recoveryGeneration;
@property(nonatomic, readwrite) NSString *recoveryId;
@property(nonatomic, readwrite) NSData *recoverySigningPublicKey;
@property(nonatomic, readwrite) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readwrite) NSData *recoveryWrapHash;
@end
@implementation AncPrivateVaultControlLogMembershipCommit
@end

@interface AncPrivateVaultControlLogSignedEntry ()
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) NSString *createdAt;
@property(nonatomic, readwrite) NSString *envelopeId;
@property(nonatomic, readwrite) uint64_t sequence;
@property(nonatomic, readwrite) NSData *previousHash;
@property(nonatomic, readwrite) NSData *innerEnvelopeBytes;
@property(nonatomic, readwrite) NSString *signerEndpointId;
@property(nonatomic, readwrite) NSData *signature;
@end
@implementation AncPrivateVaultControlLogSignedEntry
@end

@interface AncPrivateVaultControlLogReplayResult ()
@property(nonatomic, readwrite) AncPrivateVaultControlLogState *state;
@property(nonatomic, readwrite) NSData *entryHash;
@property(nonatomic, readwrite) BOOL idempotent;
@property(nonatomic, readwrite, nullable)
    AncPrivateVaultControlLogState *authenticatedPriorState;
@end
@implementation AncPrivateVaultControlLogReplayResult
@end

static const void *kAncImmutableMutationAttempted =
    &kAncImmutableMutationAttempted;

static void AncRaiseImmutableMutation(id object) {
  objc_setAssociatedObject(object, kAncImmutableMutationAttempted, @YES,
                           OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [NSException raise:NSInternalInconsistencyException
              format:@"authenticated replay values are immutable"];
}

static BOOL AncImmutableMutationAttempted(id object) {
  return [objc_getAssociatedObject(object, kAncImmutableMutationAttempted)
      boolValue];
}

@interface AncPrivateVaultImmutableCallbackData : NSData
- (instancetype)initWithData:(NSData *)data;
@end

@implementation AncPrivateVaultImmutableCallbackData {
  NSData *_backing;
}
- (instancetype)initWithData:(NSData *)data {
  self = [super init];
  if (self != nil)
    _backing = [NSData dataWithBytes:data.bytes length:data.length];
  return self;
}
- (NSUInteger)length { return _backing.length; }
- (const void *)bytes { return _backing.bytes; }
- (void *)mutableBytes { AncRaiseImmutableMutation(self); return NULL; }
- (void)setLength:(NSUInteger)length { (void)length; AncRaiseImmutableMutation(self); }
- (void)increaseLengthBy:(NSUInteger)extraLength { (void)extraLength; AncRaiseImmutableMutation(self); }
- (void)appendBytes:(const void *)bytes length:(NSUInteger)length {
  (void)bytes; (void)length; AncRaiseImmutableMutation(self);
}
- (void)appendData:(NSData *)data { (void)data; AncRaiseImmutableMutation(self); }
- (void)replaceBytesInRange:(NSRange)range withBytes:(const void *)bytes {
  (void)range; (void)bytes; AncRaiseImmutableMutation(self);
}
- (void)replaceBytesInRange:(NSRange)range
                  withBytes:(const void *)bytes
                     length:(NSUInteger)length {
  (void)range; (void)bytes; (void)length; AncRaiseImmutableMutation(self);
}
- (void)resetBytesInRange:(NSRange)range {
  (void)range; AncRaiseImmutableMutation(self);
}
- (void)setData:(NSData *)data { (void)data; AncRaiseImmutableMutation(self); }
@end

static NSData *AncImmutableCallbackData(NSData *data) {
  return [[AncPrivateVaultImmutableCallbackData alloc] initWithData:data];
}

@interface AncPrivateVaultAuthenticatedControlLogMember
    : AncPrivateVaultControlLogMember
@end
@implementation AncPrivateVaultAuthenticatedControlLogMember
- (void)setEndpointId:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRole:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setUnattended:(BOOL)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setSigningPublicKey:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setKeyAgreementPublicKey:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setEnrollmentRef:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setValue:(id)value forKey:(NSString *)key { (void)value; (void)key; AncRaiseImmutableMutation(self); }
@end

@interface AncPrivateVaultAuthenticatedControlLogMembershipCommit
    : AncPrivateVaultControlLogMembershipCommit
@end
@implementation AncPrivateVaultAuthenticatedControlLogMembershipCommit
- (void)setVaultId:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setCeremonyId:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setCeremonyKind:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setEpoch:(uint64_t)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setPreviousMembershipHash:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setActiveMembers:(NSArray *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRemovedEndpointIds:(NSArray *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRotationCompleted:(BOOL)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setOutstandingJobsResolved:(BOOL)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRecoverySnapshotHash:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRecoveryAuthorizationHash:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRecoveryGeneration:(uint64_t)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRecoveryId:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRecoverySigningPublicKey:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRecoveryKeyAgreementPublicKey:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRecoveryWrapHash:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setValue:(id)value forKey:(NSString *)key { (void)value; (void)key; AncRaiseImmutableMutation(self); }
@end

@interface AncPrivateVaultAuthenticatedControlLogSignedEntry
    : AncPrivateVaultControlLogSignedEntry
@end
@implementation AncPrivateVaultAuthenticatedControlLogSignedEntry
- (void)setVaultId:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setCreatedAt:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setEnvelopeId:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setSequence:(uint64_t)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setPreviousHash:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setInnerEnvelopeBytes:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setSignerEndpointId:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setSignature:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setValue:(id)value forKey:(NSString *)key { (void)value; (void)key; AncRaiseImmutableMutation(self); }
@end

@interface AncPrivateVaultAuthenticatedControlLogState
    : AncPrivateVaultControlLogState
@end
@implementation AncPrivateVaultAuthenticatedControlLogState
- (void)setVaultId:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setSequence:(uint64_t)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setHeadHash:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setMembershipHash:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setSignedAt:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setActiveMembers:(NSArray *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRemovedEndpointIds:(NSArray *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setEpoch:(uint64_t)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRecoveryGeneration:(uint64_t)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRecoveryId:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRecoverySigningPublicKey:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRecoveryKeyAgreementPublicKey:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setRecoveryWrapHash:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setFreshnessMode:(NSString *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setValue:(id)value forKey:(NSString *)key { (void)value; (void)key; AncRaiseImmutableMutation(self); }
@end

@interface AncPrivateVaultAuthenticatedReplayResult
    : AncPrivateVaultControlLogReplayResult
@end
@implementation AncPrivateVaultAuthenticatedReplayResult
- (void)setState:(AncPrivateVaultControlLogState *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setEntryHash:(NSData *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setIdempotent:(BOOL)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setAuthenticatedPriorState:(AncPrivateVaultControlLogState *)value { (void)value; AncRaiseImmutableMutation(self); }
- (void)setValue:(id)value forKey:(NSString *)key { (void)value; (void)key; AncRaiseImmutableMutation(self); }
@end

typedef NS_ENUM(NSInteger, AncInnerType) {
  AncInnerMembership,
  AncInnerContinuity,
  AncInnerAbort,
  AncInnerGrantRevocation,
};

@interface AncControlInner : NSObject
@property(nonatomic) AncInnerType type;
@property(nonatomic) NSString *vaultId;
@property(nonatomic) NSString *ceremonyId;
@property(nonatomic) NSString *ceremonyKind;
@property(nonatomic) uint64_t epoch;
@property(nonatomic, nullable) NSData *previousMembershipHash;
@property(nonatomic) NSArray<AncPrivateVaultControlLogMember *> *activeMembers;
@property(nonatomic) NSArray<NSString *> *removedEndpointIds;
@property(nonatomic) BOOL rotationCompleted;
@property(nonatomic) BOOL outstandingJobsResolved;
@property(nonatomic, nullable) NSData *recoverySnapshotHash;
@property(nonatomic, nullable) NSData *recoveryAuthorizationHash;
@property(nonatomic) uint64_t recoveryGeneration;
@property(nonatomic) NSString *recoveryId;
@property(nonatomic) NSData *recoverySigningPublicKey;
@property(nonatomic) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic) NSData *recoveryWrapHash;
@property(nonatomic) NSData *membershipHash;
@property(nonatomic) NSData *revocationEnvelopeBytes;
@end
@implementation AncControlInner
@end

@interface AncControlEntry : NSObject
@property(nonatomic) NSString *vaultId;
@property(nonatomic) NSString *createdAt;
@property(nonatomic) NSDate *createdDate;
@property(nonatomic) NSString *envelopeId;
@property(nonatomic) uint64_t sequence;
@property(nonatomic) NSData *previousHash;
@property(nonatomic) NSData *innerBytes;
@property(nonatomic) AncControlInner *inner;
@property(nonatomic) NSString *signerEndpointId;
@property(nonatomic) NSData *signature;
@property(nonatomic) NSData *unsignedBytes;
@end
@implementation AncControlEntry
@end

static BOOL AncExactKeys(NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map,
                         const int *keys, NSUInteger count) {
  if (map.count != count) return NO;
  for (NSUInteger index = 0; index < count; index += 1)
    if (map[@(keys[index])] == nil) return NO;
  return YES;
}

static AncPrivateVaultCanonicalValue *AncField(NSDictionary *map, int key,
                                                AncPrivateVaultCanonicalType type) {
  AncPrivateVaultCanonicalValue *value = map[@(key)];
  return value.type == type ? value : nil;
}

static BOOL AncOpaqueId(NSString *value) {
  NSData *bytes = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (bytes.length < 8 || bytes.length > 160) return NO;
  const uint8_t *raw = bytes.bytes;
  for (NSUInteger index = 0; index < bytes.length; index += 1) {
    uint8_t byte = raw[index];
    BOOL alnum = (byte >= 'A' && byte <= 'Z') ||
                 (byte >= 'a' && byte <= 'z') ||
                 (byte >= '0' && byte <= '9');
    if (!alnum && (index == 0 || (byte != '.' && byte != '_' && byte != ':' && byte != '-')))
      return NO;
  }
  return YES;
}

static BOOL AncToken(NSString *value) {
  NSData *bytes = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (bytes.length == 0 || bytes.length > 120) return NO;
  const uint8_t *raw = bytes.bytes;
  for (NSUInteger index = 0; index < bytes.length; index += 1) {
    uint8_t byte = raw[index];
    BOOL allowed = (byte >= 'a' && byte <= 'z') ||
                   (index > 0 && byte >= '0' && byte <= '9') ||
                   (index > 0 && (byte == '.' || byte == '_' || byte == ':' || byte == '-'));
    if (!allowed) return NO;
  }
  return YES;
}

static NSDate *AncTimestamp(NSString *value) {
  NSString *pattern = @"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$";
  if ([value rangeOfString:pattern options:NSRegularExpressionSearch].location == NSNotFound)
    return nil;
  NSISO8601DateFormatter *formatter = [[NSISO8601DateFormatter alloc] init];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                            NSISO8601DateFormatWithFractionalSeconds;
  NSDate *date = [formatter dateFromString:value];
  if (date != nil) return date;
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime;
  return [formatter dateFromString:value];
}

static BOOL AncSortedUniqueStrings(NSArray<NSString *> *values) {
  for (NSUInteger index = 1; index < values.count; index += 1)
    if ([values[index - 1] compare:values[index]] != NSOrderedAscending) return NO;
  return YES;
}

static NSData *AncDomainMessage(NSData *payload) {
  NSMutableData *message = [NSMutableData dataWithBytes:kLogEntryDomain
                                                  length:sizeof kLogEntryDomain];
  [message appendData:payload];
  return message;
}

static NSData *AncHash(NSData *payload) {
  NSData *message = AncDomainMessage(payload);
  uint8_t digest[32] = {0};
  if (anc_pv_blake2b_256(digest, message.bytes, message.length) != ANC_PV_CRYPTO_OK)
    return nil;
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

NSData *AncPrivateVaultControlLogSignedEntryDomainHash(NSData *signedEntry) {
  if (![signedEntry isKindOfClass:NSData.class] || signedEntry.length == 0 ||
      signedEntry.length > kControlMaximumBytes)
    return nil;
  return AncHash(signedEntry);
}

static BOOL AncCeremonyKind(NSString *kind, BOOL membership) {
  NSArray *allowed = membership
      ? @[@"first_device", @"add_device", @"add_broker", @"remove_device",
          @"remove_broker", @"broker_replacement", @"recovery"]
      : @[@"first_device", @"add_device", @"remove_device", @"rotate_epoch",
          @"recovery", @"broker_replacement", @"grant_issue", @"grant_revoke",
          @"direct_external_disclosure", @"vault_deletion"];
  return [allowed containsObject:kind];
}

static AncPrivateVaultControlLogMember *AncParseMember(AncPrivateVaultCanonicalValue *value) {
  if (value.type != AncPrivateVaultCanonicalTypeArray || value.arrayValue.count != 6)
    return nil;
  NSArray *array = value.arrayValue;
  if (((AncPrivateVaultCanonicalValue *)array[0]).type != AncPrivateVaultCanonicalTypeText ||
      ((AncPrivateVaultCanonicalValue *)array[1]).type != AncPrivateVaultCanonicalTypeText ||
      ((AncPrivateVaultCanonicalValue *)array[2]).type != AncPrivateVaultCanonicalTypeBoolean ||
      ((AncPrivateVaultCanonicalValue *)array[3]).type != AncPrivateVaultCanonicalTypeBytes ||
      ((AncPrivateVaultCanonicalValue *)array[4]).type != AncPrivateVaultCanonicalTypeBytes ||
      ((AncPrivateVaultCanonicalValue *)array[5]).type != AncPrivateVaultCanonicalTypeText)
    return nil;
  AncPrivateVaultControlLogMember *member = [[AncPrivateVaultControlLogMember alloc] init];
  member.endpointId = ((AncPrivateVaultCanonicalValue *)array[0]).textValue;
  member.role = ((AncPrivateVaultCanonicalValue *)array[1]).textValue;
  member.unattended = ((AncPrivateVaultCanonicalValue *)array[2]).booleanValue;
  member.signingPublicKey = ((AncPrivateVaultCanonicalValue *)array[3]).bytesValue;
  member.keyAgreementPublicKey = ((AncPrivateVaultCanonicalValue *)array[4]).bytesValue;
  member.enrollmentRef = ((AncPrivateVaultCanonicalValue *)array[5]).textValue;
  if (!AncOpaqueId(member.endpointId) || !AncOpaqueId(member.enrollmentRef) ||
      member.signingPublicKey.length != 32 || member.keyAgreementPublicKey.length != 32 ||
      (![member.role isEqualToString:@"endpoint"] && ![member.role isEqualToString:@"broker"]) ||
      ([member.role isEqualToString:@"endpoint"] && member.unattended) ||
      ([member.role isEqualToString:@"broker"] && !member.unattended))
    return nil;
  return member;
}

static NSArray<NSString *> *AncParseIds(AncPrivateVaultCanonicalValue *value,
                                        NSUInteger maximum) {
  if (value.type != AncPrivateVaultCanonicalTypeArray || value.arrayValue.count > maximum)
    return nil;
  NSMutableArray *ids = [NSMutableArray array];
  for (AncPrivateVaultCanonicalValue *item in value.arrayValue) {
    if (item.type != AncPrivateVaultCanonicalTypeText || !AncOpaqueId(item.textValue)) return nil;
    [ids addObject:item.textValue];
  }
  return AncSortedUniqueStrings(ids) ? ids : nil;
}

static NSData *AncNullableHash(AncPrivateVaultCanonicalValue *value, BOOL *valid) {
  if (value.type == AncPrivateVaultCanonicalTypeNull) {
    *valid = YES;
    return nil;
  }
  *valid = value.type == AncPrivateVaultCanonicalTypeBytes && value.bytesValue.length == 32;
  return *valid ? value.bytesValue : nil;
}

static AncControlInner *AncParseInner(NSData *bytes) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(bytes, kControlMaximumBytes, &status);
  if (root.type != AncPrivateVaultCanonicalTypeMap) return nil;
  NSDictionary *map = root.mapValue;
  AncPrivateVaultCanonicalValue *suite = AncField(map, 1, AncPrivateVaultCanonicalTypeText);
  AncPrivateVaultCanonicalValue *vault = AncField(map, 2, AncPrivateVaultCanonicalTypeText);
  AncPrivateVaultCanonicalValue *type = AncField(map, 3, AncPrivateVaultCanonicalTypeText);
  if (![suite.textValue isEqualToString:@"anc/v1"] || !AncOpaqueId(vault.textValue)) return nil;
  AncControlInner *inner = [[AncControlInner alloc] init];
  inner.vaultId = vault.textValue;
  if ([type.textValue isEqualToString:@"continuity_checkpoint"]) {
    const int keys[] = {1, 2, 3, 150};
    NSData *hash = AncField(map, 150, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    if (!AncExactKeys(map, keys, 4) || hash.length != 32) return nil;
    inner.type = AncInnerContinuity;
    inner.membershipHash = hash;
    return inner;
  }
  if ([type.textValue isEqualToString:@"ceremony_abort"]) {
    const int keys[] = {1, 2, 3, 151, 152, 153, 154};
    NSString *ceremonyId = AncField(map, 151, AncPrivateVaultCanonicalTypeText).textValue;
    NSString *kind = AncField(map, 152, AncPrivateVaultCanonicalTypeText).textValue;
    NSData *hash = AncField(map, 153, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSString *reason = AncField(map, 154, AncPrivateVaultCanonicalTypeText).textValue;
    if (!AncExactKeys(map, keys, 7) || !AncOpaqueId(ceremonyId) ||
        !AncCeremonyKind(kind, NO) || hash.length != 32 || !AncToken(reason)) return nil;
    inner.type = AncInnerAbort;
    inner.ceremonyId = ceremonyId;
    inner.ceremonyKind = kind;
    return inner;
  }
  if ([type.textValue isEqualToString:@"grant_revocation"]) {
    const int keys[] = {1, 2, 3, 160};
    NSData *revocation =
        AncField(map, 160, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    if (!AncExactKeys(map, keys, 4) || revocation.length == 0 ||
        revocation.length > kControlMaximumBytes)
      return nil;
    inner.type = AncInnerGrantRevocation;
    inner.revocationEnvelopeBytes = revocation;
    return inner;
  }
  if (![type.textValue isEqualToString:@"membership_commit"]) return nil;
  const int keys[] = {1, 2, 3, 140, 141, 142, 143, 144, 145, 146, 147,
                      148, 149, 155, 156, 157, 158, 159};
  if (!AncExactKeys(map, keys, sizeof keys / sizeof keys[0])) return nil;
  NSString *ceremonyId = AncField(map, 140, AncPrivateVaultCanonicalTypeText).textValue;
  NSString *kind = AncField(map, 141, AncPrivateVaultCanonicalTypeText).textValue;
  AncPrivateVaultCanonicalValue *epoch = AncField(map, 142, AncPrivateVaultCanonicalTypeInteger);
  AncPrivateVaultCanonicalValue *membersValue = AncField(map, 144, AncPrivateVaultCanonicalTypeArray);
  AncPrivateVaultCanonicalValue *rotation = AncField(map, 146, AncPrivateVaultCanonicalTypeBoolean);
  AncPrivateVaultCanonicalValue *jobs = AncField(map, 147, AncPrivateVaultCanonicalTypeBoolean);
  NSArray *removed = AncParseIds(AncField(map, 145, AncPrivateVaultCanonicalTypeArray), kMaximumMembers);
  if (!AncOpaqueId(ceremonyId) || !AncCeremonyKind(kind, YES) || epoch.integerValue <= 0 ||
      membersValue.arrayValue.count == 0 || membersValue.arrayValue.count > kMaximumMembers ||
      removed == nil || rotation == nil || jobs == nil)
    return nil;
  NSMutableArray *members = [NSMutableArray array];
  NSUInteger brokers = 0;
  for (AncPrivateVaultCanonicalValue *item in membersValue.arrayValue) {
    AncPrivateVaultControlLogMember *member = AncParseMember(item);
    if (member == nil) return nil;
    if ([member.role isEqualToString:@"broker"]) brokers += 1;
    [members addObject:member];
  }
  for (NSUInteger index = 1; index < members.count; index += 1)
    if ([((AncPrivateVaultControlLogMember *)members[index - 1]).endpointId
            compare:((AncPrivateVaultControlLogMember *)members[index]).endpointId] != NSOrderedAscending)
      return nil;
  if (brokers > 1) return nil;
  NSSet *activeIds = [NSSet setWithArray:[members valueForKey:@"endpointId"]];
  for (NSString *removedId in removed) if ([activeIds containsObject:removedId]) return nil;
  BOOL valid = NO;
  NSData *previous = AncNullableHash(map[@143], &valid); if (!valid) return nil;
  NSData *snapshot = AncNullableHash(map[@148], &valid); if (!valid) return nil;
  NSData *authorization = AncNullableHash(map[@149], &valid); if (!valid) return nil;
  BOOL recovery = [kind isEqualToString:@"recovery"];
  if (recovery != (snapshot != nil && authorization != nil) ||
      (!recovery && (snapshot != nil || authorization != nil))) return nil;
  AncPrivateVaultCanonicalValue *recoveryGeneration = AncField(map, 155, AncPrivateVaultCanonicalTypeInteger);
  NSString *recoveryId = AncField(map, 156, AncPrivateVaultCanonicalTypeText).textValue;
  NSData *recoverySigning = AncField(map, 157, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *recoveryAgreement = AncField(map, 158, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *recoveryWrap = AncField(map, 159, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  if (recoveryGeneration.integerValue <= 0 || !AncOpaqueId(recoveryId) ||
      recoverySigning.length != 32 || recoveryAgreement.length != 32 || recoveryWrap.length != 32)
    return nil;
  inner.type = AncInnerMembership;
  inner.ceremonyId = ceremonyId;
  inner.ceremonyKind = kind;
  inner.epoch = (uint64_t)epoch.integerValue;
  inner.previousMembershipHash = previous;
  inner.activeMembers = members;
  inner.removedEndpointIds = removed;
  inner.rotationCompleted = rotation.booleanValue;
  inner.outstandingJobsResolved = jobs.booleanValue;
  inner.recoverySnapshotHash = snapshot;
  inner.recoveryAuthorizationHash = authorization;
  inner.recoveryGeneration = (uint64_t)recoveryGeneration.integerValue;
  inner.recoveryId = recoveryId;
  inner.recoverySigningPublicKey = recoverySigning;
  inner.recoveryKeyAgreementPublicKey = recoveryAgreement;
  inner.recoveryWrapHash = recoveryWrap;
  return inner;
}

static AncControlEntry *AncParseEntry(NSData *bytes) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(bytes, kControlMaximumBytes, &status);
  if (root.type != AncPrivateVaultCanonicalTypeMap) return nil;
  NSDictionary *map = root.mapValue;
  const int keys[] = {1, 2, 3, 4, 5, 110, 111, 112, 113, 114};
  if (!AncExactKeys(map, keys, 10)) return nil;
  if (AncField(map, 1, AncPrivateVaultCanonicalTypeText) == nil ||
      AncField(map, 2, AncPrivateVaultCanonicalTypeText) == nil ||
      AncField(map, 3, AncPrivateVaultCanonicalTypeText) == nil ||
      AncField(map, 4, AncPrivateVaultCanonicalTypeText) == nil ||
      AncField(map, 5, AncPrivateVaultCanonicalTypeText) == nil ||
      AncField(map, 110, AncPrivateVaultCanonicalTypeInteger) == nil ||
      AncField(map, 111, AncPrivateVaultCanonicalTypeBytes) == nil ||
      AncField(map, 112, AncPrivateVaultCanonicalTypeBytes) == nil ||
      AncField(map, 113, AncPrivateVaultCanonicalTypeText) == nil ||
      AncField(map, 114, AncPrivateVaultCanonicalTypeBytes) == nil)
    return nil;
  NSString *suite = AncField(map, 1, AncPrivateVaultCanonicalTypeText).textValue;
  NSString *vault = AncField(map, 2, AncPrivateVaultCanonicalTypeText).textValue;
  NSString *type = AncField(map, 3, AncPrivateVaultCanonicalTypeText).textValue;
  NSString *created = AncField(map, 4, AncPrivateVaultCanonicalTypeText).textValue;
  NSString *envelope = AncField(map, 5, AncPrivateVaultCanonicalTypeText).textValue;
  AncPrivateVaultCanonicalValue *sequence = AncField(map, 110, AncPrivateVaultCanonicalTypeInteger);
  NSData *previous = AncField(map, 111, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSData *innerBytes = AncField(map, 112, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSString *signer = AncField(map, 113, AncPrivateVaultCanonicalTypeText).textValue;
  NSData *signature = AncField(map, 114, AncPrivateVaultCanonicalTypeBytes).bytesValue;
  NSDate *date = AncTimestamp(created);
  if (![suite isEqualToString:@"anc/v1"] || ![type isEqualToString:@"log-entry"] ||
      !AncOpaqueId(vault) || !AncOpaqueId(envelope) || !AncOpaqueId(signer) ||
      sequence.integerValue < 0 || date == nil || previous.length != 32 ||
      innerBytes.length == 0 || innerBytes.length > kControlMaximumBytes || signature.length != 64)
    return nil;
  AncControlInner *inner = AncParseInner(innerBytes);
  if (inner == nil || ![inner.vaultId isEqualToString:vault]) return nil;
  NSMutableDictionary *unsignedMap = [map mutableCopy];
  [unsignedMap removeObjectForKey:@114];
  AncPrivateVaultCanonicalStatus encodeStatus;
  NSData *unsignedBytes = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:unsignedMap], &encodeStatus);
  if (unsignedBytes == nil) return nil;
  AncControlEntry *entry = [[AncControlEntry alloc] init];
  entry.vaultId = vault; entry.createdAt = created; entry.createdDate = date;
  entry.envelopeId = envelope; entry.sequence = (uint64_t)sequence.integerValue;
  entry.previousHash = previous; entry.innerBytes = innerBytes; entry.inner = inner;
  entry.signerEndpointId = signer; entry.signature = signature; entry.unsignedBytes = unsignedBytes;
  return entry;
}

NSString *AncPrivateVaultControlLogSignedEntryEnvelopeId(NSData *signedEntry) {
  if (![signedEntry isKindOfClass:NSData.class] || signedEntry.length == 0 ||
      signedEntry.length > kControlMaximumBytes)
    return nil;
  return [AncParseEntry(signedEntry).envelopeId copy];
}

NSString *
AncPrivateVaultControlLogSignedEntrySignerEndpointId(NSData *signedEntry) {
  if (![signedEntry isKindOfClass:NSData.class] || signedEntry.length == 0 ||
      signedEntry.length > kControlMaximumBytes)
    return nil;
  return [AncParseEntry(signedEntry).signerEndpointId copy];
}

static AncPrivateVaultControlLogMember *AncFindMember(NSArray *members, NSString *endpointId) {
  for (AncPrivateVaultControlLogMember *member in members)
    if ([member.endpointId isEqualToString:endpointId]) return member;
  return nil;
}

static BOOL AncSameMember(AncPrivateVaultControlLogMember *left,
                          AncPrivateVaultControlLogMember *right) {
  return [left.endpointId isEqualToString:right.endpointId] &&
         [left.role isEqualToString:right.role] && left.unattended == right.unattended &&
         [left.signingPublicKey isEqualToData:right.signingPublicKey] &&
         [left.keyAgreementPublicKey isEqualToData:right.keyAgreementPublicKey] &&
         [left.enrollmentRef isEqualToString:right.enrollmentRef];
}

static AncPrivateVaultControlLogMember *AncCopyMember(
    AncPrivateVaultControlLogMember *member) {
  AncPrivateVaultControlLogMember *copy = [[AncPrivateVaultControlLogMember alloc] init];
  copy.endpointId = [member.endpointId copy]; copy.role = [member.role copy];
  copy.unattended = member.unattended;
  copy.signingPublicKey = [member.signingPublicKey copy];
  copy.keyAgreementPublicKey = [member.keyAgreementPublicKey copy];
  copy.enrollmentRef = [member.enrollmentRef copy];
  return copy;
}

static NSArray<AncPrivateVaultControlLogMember *> *AncCopyMembers(NSArray *members) {
  NSMutableArray *copies = [NSMutableArray arrayWithCapacity:members.count];
  for (AncPrivateVaultControlLogMember *member in members) [copies addObject:AncCopyMember(member)];
  return [copies copy];
}

static NSArray<AncPrivateVaultControlLogMember *> *AncCopyImmutableMembers(
    NSArray *members) {
  NSArray *copies = AncCopyMembers(members);
  for (AncPrivateVaultControlLogMember *member in copies)
    object_setClass(member, AncPrivateVaultAuthenticatedControlLogMember.class);
  return copies;
}

static AncPrivateVaultControlLogState *AncCopyState(AncPrivateVaultControlLogState *state) {
  AncPrivateVaultControlLogState *copy = [[AncPrivateVaultControlLogState alloc] init];
  copy.vaultId = [state.vaultId copy]; copy.sequence = state.sequence;
  copy.headHash = [state.headHash copy]; copy.membershipHash = [state.membershipHash copy];
  copy.signedAt = [state.signedAt copy];
  copy.activeMembers = AncCopyMembers(state.activeMembers ?: @[]);
  copy.removedEndpointIds = [[NSArray alloc] initWithArray:state.removedEndpointIds ?: @[]
                                                 copyItems:YES];
  copy.epoch = state.epoch; copy.recoveryGeneration = state.recoveryGeneration;
  copy.recoveryId = [state.recoveryId copy];
  copy.recoverySigningPublicKey = [state.recoverySigningPublicKey copy];
  copy.recoveryKeyAgreementPublicKey = [state.recoveryKeyAgreementPublicKey copy];
  copy.recoveryWrapHash = [state.recoveryWrapHash copy];
  copy.freshnessMode = [state.freshnessMode copy];
  return copy;
}

AncPrivateVaultControlLogState *
AncPrivateVaultControlLogStateCreateImmutableCopy(
    AncPrivateVaultControlLogState *state) {
  if (state == nil)
    return nil;
  @try {
    NSMutableArray *members = [NSMutableArray array];
    for (AncPrivateVaultControlLogMember *source in state.activeMembers) {
      AncPrivateVaultControlLogMember *member =
          [[AncPrivateVaultControlLogMember alloc] init];
      member.endpointId = [source.endpointId copy];
      member.role = [source.role copy];
      member.unattended = source.unattended;
      member.signingPublicKey = [source.signingPublicKey copy];
      member.keyAgreementPublicKey = [source.keyAgreementPublicKey copy];
      member.enrollmentRef = [source.enrollmentRef copy];
      object_setClass(member,
                      AncPrivateVaultAuthenticatedControlLogMember.class);
      [members addObject:member];
    }
    AncPrivateVaultControlLogState *copy =
        [[AncPrivateVaultControlLogState alloc] init];
    copy.vaultId = [state.vaultId copy];
    copy.sequence = state.sequence;
    copy.headHash = [state.headHash copy];
    copy.membershipHash = [state.membershipHash copy];
    copy.signedAt = [state.signedAt copy];
    copy.activeMembers = [members copy];
    copy.removedEndpointIds =
        [[NSArray alloc] initWithArray:state.removedEndpointIds ?: @[]
                            copyItems:YES];
    copy.epoch = state.epoch;
    copy.recoveryGeneration = state.recoveryGeneration;
    copy.recoveryId = [state.recoveryId copy];
    copy.recoverySigningPublicKey = [state.recoverySigningPublicKey copy];
    copy.recoveryKeyAgreementPublicKey =
        [state.recoveryKeyAgreementPublicKey copy];
    copy.recoveryWrapHash = [state.recoveryWrapHash copy];
    copy.freshnessMode = [state.freshnessMode copy];
    object_setClass(copy, AncPrivateVaultAuthenticatedControlLogState.class);
    return copy;
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

@interface AncPrivateVaultReplayEvidence : NSObject
@property(nonatomic) AncPrivateVaultControlLogState *priorState;
@property(nonatomic) AncPrivateVaultControlLogState *currentState;
@property(nonatomic) NSData *priorCanonical;
@property(nonatomic) NSData *currentCanonical;
@property(nonatomic) NSData *entryHash;
@property(nonatomic) BOOL idempotent;
@end
@implementation AncPrivateVaultReplayEvidence
@end

static NSData *AncControlStateCanonical(
    AncPrivateVaultControlLogState *state) {
  if (state == nil)
    return nil;
  @try {
    NSMutableArray *members = [NSMutableArray array];
    for (AncPrivateVaultControlLogMember *member in state.activeMembers) {
      [members addObject:[AncPrivateVaultCanonicalValue array:@[
                 [AncPrivateVaultCanonicalValue text:member.endpointId],
                 [AncPrivateVaultCanonicalValue text:member.role],
                 [AncPrivateVaultCanonicalValue boolean:member.unattended],
                 [AncPrivateVaultCanonicalValue bytes:member.signingPublicKey],
                 [AncPrivateVaultCanonicalValue
                     bytes:member.keyAgreementPublicKey],
                 [AncPrivateVaultCanonicalValue text:member.enrollmentRef]
               ]]];
    }
    NSMutableArray *removed = [NSMutableArray array];
    for (NSString *endpointId in state.removedEndpointIds)
      [removed addObject:[AncPrivateVaultCanonicalValue text:endpointId]];
    AncPrivateVaultCanonicalValue *root =
        [AncPrivateVaultCanonicalValue map:@{
          @1 : [AncPrivateVaultCanonicalValue text:state.vaultId],
          @2 : [AncPrivateVaultCanonicalValue integer:(int64_t)state.sequence],
          @3 : [AncPrivateVaultCanonicalValue bytes:state.headHash],
          @4 : [AncPrivateVaultCanonicalValue bytes:state.membershipHash],
          @5 : [AncPrivateVaultCanonicalValue text:state.signedAt],
          @6 : [AncPrivateVaultCanonicalValue array:members],
          @7 : [AncPrivateVaultCanonicalValue array:removed],
          @8 : [AncPrivateVaultCanonicalValue integer:(int64_t)state.epoch],
          @9 : [AncPrivateVaultCanonicalValue
              integer:(int64_t)state.recoveryGeneration],
          @10 : [AncPrivateVaultCanonicalValue text:state.recoveryId],
          @11 : [AncPrivateVaultCanonicalValue
              bytes:state.recoverySigningPublicKey],
          @12 : [AncPrivateVaultCanonicalValue
              bytes:state.recoveryKeyAgreementPublicKey],
          @13 : [AncPrivateVaultCanonicalValue bytes:state.recoveryWrapHash],
          @14 : [AncPrivateVaultCanonicalValue text:state.freshnessMode],
        }];
    AncPrivateVaultCanonicalStatus status;
    return AncPrivateVaultCanonicalEncode(root, &status);
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

NSData *AncPrivateVaultControlLogStatePersistenceEncode(
    AncPrivateVaultControlLogState *state) {
  return AncControlStateCanonical(state);
}

static BOOL AncPersistenceIdentifier(NSString *value) {
  NSData *bytes = [value dataUsingEncoding:NSUTF8StringEncoding];
  return bytes.length >= 8 && bytes.length <= 160;
}

AncPrivateVaultControlLogState *
AncPrivateVaultControlLogStatePersistenceDecode(NSData *encoded) {
  if (![encoded isKindOfClass:NSData.class] || encoded.length == 0 ||
      encoded.length > 65536)
    return nil;
  @try {
    AncPrivateVaultCanonicalStatus canonicalStatus;
    AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
        encoded, 65536, &canonicalStatus);
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map =
        root.type == AncPrivateVaultCanonicalTypeMap ? root.mapValue : nil;
    if (map.count != 14)
      return nil;
    for (NSUInteger key = 1; key <= 14; key += 1)
      if (map[@(key)] == nil)
        return nil;
    if (map[@1].type != AncPrivateVaultCanonicalTypeText ||
        !AncPersistenceIdentifier(map[@1].textValue) ||
        map[@2].type != AncPrivateVaultCanonicalTypeInteger ||
        map[@2].integerValue < 0 ||
        map[@2].integerValue > INT64_C(9007199254740991) ||
        map[@3].type != AncPrivateVaultCanonicalTypeBytes ||
        map[@3].bytesValue.length != 32 ||
        map[@4].type != AncPrivateVaultCanonicalTypeBytes ||
        map[@4].bytesValue.length != 32 ||
        map[@5].type != AncPrivateVaultCanonicalTypeText ||
        map[@5].textValue.length == 0 ||
        map[@6].type != AncPrivateVaultCanonicalTypeArray ||
        map[@6].arrayValue.count == 0 || map[@6].arrayValue.count > 64 ||
        map[@7].type != AncPrivateVaultCanonicalTypeArray ||
        map[@7].arrayValue.count > 256 ||
        map[@8].type != AncPrivateVaultCanonicalTypeInteger ||
        map[@8].integerValue < 1 ||
        map[@8].integerValue > INT64_C(9007199254740991) ||
        map[@9].type != AncPrivateVaultCanonicalTypeInteger ||
        map[@9].integerValue < 1 ||
        map[@9].integerValue > INT64_C(9007199254740991) ||
        map[@10].type != AncPrivateVaultCanonicalTypeText ||
        !AncPersistenceIdentifier(map[@10].textValue) ||
        map[@11].type != AncPrivateVaultCanonicalTypeBytes ||
        map[@11].bytesValue.length != 32 ||
        map[@12].type != AncPrivateVaultCanonicalTypeBytes ||
        map[@12].bytesValue.length != 32 ||
        map[@13].type != AncPrivateVaultCanonicalTypeBytes ||
        map[@13].bytesValue.length != 32 ||
        map[@14].type != AncPrivateVaultCanonicalTypeText ||
        (![map[@14].textValue isEqualToString:@"endpoint_witnessed"] &&
         ![map[@14].textValue
             isEqualToString:@"eventual_fork_detection"]))
      return nil;
    NSMutableArray *members = [NSMutableArray array];
    NSString *priorId = nil;
    for (AncPrivateVaultCanonicalValue *tuple in map[@6].arrayValue) {
      if (tuple.type != AncPrivateVaultCanonicalTypeArray ||
          tuple.arrayValue.count != 6)
        return nil;
      NSArray<AncPrivateVaultCanonicalValue *> *values = tuple.arrayValue;
      NSString *endpointId = values[0].textValue;
      NSString *role = values[1].textValue;
      if (values[0].type != AncPrivateVaultCanonicalTypeText ||
          !AncPersistenceIdentifier(endpointId) ||
          values[1].type != AncPrivateVaultCanonicalTypeText ||
          (![role isEqualToString:@"endpoint"] &&
           ![role isEqualToString:@"broker"]) ||
          values[2].type != AncPrivateVaultCanonicalTypeBoolean ||
          ([role isEqualToString:@"endpoint"] && values[2].booleanValue) ||
          ([role isEqualToString:@"broker"] && !values[2].booleanValue) ||
          values[3].type != AncPrivateVaultCanonicalTypeBytes ||
          values[3].bytesValue.length != 32 ||
          values[4].type != AncPrivateVaultCanonicalTypeBytes ||
          values[4].bytesValue.length != 32 ||
          values[5].type != AncPrivateVaultCanonicalTypeText ||
          !AncPersistenceIdentifier(values[5].textValue) ||
          (priorId != nil && [priorId compare:endpointId] != NSOrderedAscending))
        return nil;
      AncPrivateVaultControlLogMember *member =
          [AncPrivateVaultControlLogMember new];
      member.endpointId = [endpointId copy];
      member.role = [role copy];
      member.unattended = values[2].booleanValue;
      member.signingPublicKey = [values[3].bytesValue copy];
      member.keyAgreementPublicKey = [values[4].bytesValue copy];
      member.enrollmentRef = [values[5].textValue copy];
      [members addObject:member];
      priorId = endpointId;
    }
    NSMutableArray *removed = [NSMutableArray array];
    priorId = nil;
    for (AncPrivateVaultCanonicalValue *value in map[@7].arrayValue) {
      if (value.type != AncPrivateVaultCanonicalTypeText ||
          !AncPersistenceIdentifier(value.textValue) ||
          (priorId != nil &&
           [priorId compare:value.textValue] != NSOrderedAscending))
        return nil;
      [removed addObject:[value.textValue copy]];
      priorId = value.textValue;
    }
    AncPrivateVaultControlLogState *state =
        [AncPrivateVaultControlLogState new];
    state.vaultId = [map[@1].textValue copy];
    state.sequence = (uint64_t)map[@2].integerValue;
    state.headHash = [map[@3].bytesValue copy];
    state.membershipHash = [map[@4].bytesValue copy];
    state.signedAt = [map[@5].textValue copy];
    state.activeMembers = [members copy];
    state.removedEndpointIds = [removed copy];
    state.epoch = (uint64_t)map[@8].integerValue;
    state.recoveryGeneration = (uint64_t)map[@9].integerValue;
    state.recoveryId = [map[@10].textValue copy];
    state.recoverySigningPublicKey = [map[@11].bytesValue copy];
    state.recoveryKeyAgreementPublicKey = [map[@12].bytesValue copy];
    state.recoveryWrapHash = [map[@13].bytesValue copy];
    state.freshnessMode = [map[@14].textValue copy];
    NSData *roundTrip = AncControlStateCanonical(state);
    return [roundTrip isEqualToData:encoded]
               ? AncPrivateVaultControlLogStateCreateImmutableCopy(state)
               : nil;
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

static NSMapTable<AncPrivateVaultControlLogReplayResult *,
                  AncPrivateVaultReplayEvidence *> *
AncReplayEvidenceRegistry(void) {
  static NSMapTable *registry;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    registry = [NSMapTable
        mapTableWithKeyOptions:NSPointerFunctionsWeakMemory |
                               NSPointerFunctionsObjectPointerPersonality
                  valueOptions:NSPointerFunctionsStrongMemory];
  });
  return registry;
}

static NSLock *AncReplayEvidenceLock(void) {
  static NSLock *lock;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ lock = [[NSLock alloc] init]; });
  return lock;
}

static BOOL AncRegisterReplayEvidence(
    AncPrivateVaultControlLogReplayResult *result,
    AncPrivateVaultControlLogState *prior,
    AncPrivateVaultControlLogState *current, NSData *entryHash,
    BOOL idempotent) {
  NSData *priorCanonical = prior == nil ? [NSData data]
                                        : AncControlStateCanonical(prior);
  NSData *currentCanonical = AncControlStateCanonical(current);
  if (result == nil || current == nil || entryHash.length != 32 ||
      priorCanonical == nil || currentCanonical == nil)
    return NO;
  AncPrivateVaultReplayEvidence *evidence =
      [[AncPrivateVaultReplayEvidence alloc] init];
  /* Keep registry state pointer-distinct from the presentation object. The
   * public result is deliberately inspectable, so even a runtime ivar write on
   * that object must not race the later evidence copy. */
  evidence.priorState =
      prior == nil
          ? nil
          : AncPrivateVaultControlLogStateCreateImmutableCopy(prior);
  evidence.currentState =
      AncPrivateVaultControlLogStateCreateImmutableCopy(current);
  if (evidence.currentState == nil ||
      (prior != nil && evidence.priorState == nil))
    return NO;
  evidence.priorCanonical = priorCanonical;
  evidence.currentCanonical = currentCanonical;
  evidence.entryHash = [entryHash copy];
  evidence.idempotent = idempotent;
  NSLock *lock = AncReplayEvidenceLock();
  [lock lock];
  NSMapTable *registry = AncReplayEvidenceRegistry();
  BOOL allowed = registry.count < 1024;
  if (allowed)
    [registry setObject:evidence forKey:result];
  [lock unlock];
  return allowed;
}

BOOL AncPrivateVaultControlLogReplayResultCopyEvidence(
    AncPrivateVaultControlLogReplayResult *result,
    AncPrivateVaultControlLogState **priorState,
    AncPrivateVaultControlLogState **currentState, NSData **entryHash,
    BOOL *idempotent) {
  if (currentState == NULL || entryHash == NULL || idempotent == NULL)
    return NO;
  if (priorState != NULL)
    *priorState = nil;
  *currentState = nil;
  *entryHash = nil;
  *idempotent = NO;
  if (result == nil ||
      ![result isMemberOfClass:AncPrivateVaultAuthenticatedReplayResult.class])
    return NO;
  NSLock *lock = AncReplayEvidenceLock();
  [lock lock];
  AncPrivateVaultReplayEvidence *evidence =
      [AncReplayEvidenceRegistry() objectForKey:result];
  [lock unlock];
  if (evidence == nil)
    return NO;
  @try {
    NSData *observedCurrent = AncControlStateCanonical(result.state);
    NSData *observedPrior =
        result.authenticatedPriorState == nil
            ? [NSData data]
            : AncControlStateCanonical(result.authenticatedPriorState);
    if (![observedCurrent isEqualToData:evidence.currentCanonical] ||
        ![observedPrior isEqualToData:evidence.priorCanonical] ||
        ![result.entryHash isEqualToData:evidence.entryHash] ||
        result.idempotent != evidence.idempotent)
      return NO;
    AncPrivateVaultControlLogState *currentCopy =
        AncPrivateVaultControlLogStateCreateImmutableCopy(
            evidence.currentState);
    AncPrivateVaultControlLogState *priorCopy =
        evidence.priorState == nil
            ? nil
            : AncPrivateVaultControlLogStateCreateImmutableCopy(
                  evidence.priorState);
    if (currentCopy == nil ||
        (evidence.priorState != nil && priorCopy == nil))
      return NO;
    if (priorState != NULL)
      *priorState = priorCopy;
    *currentState = currentCopy;
    *entryHash = [evidence.entryHash copy];
    *idempotent = evidence.idempotent;
    return YES;
  } @catch (__unused NSException *exception) {
    return NO;
  }
}

static AncPrivateVaultControlLogMembershipCommit *AncCopyCommit(AncControlInner *inner) {
  AncPrivateVaultControlLogMembershipCommit *copy =
      [[AncPrivateVaultControlLogMembershipCommit alloc] init];
  copy.vaultId = [inner.vaultId copy]; copy.ceremonyId = [inner.ceremonyId copy];
  copy.ceremonyKind = [inner.ceremonyKind copy]; copy.epoch = inner.epoch;
  copy.previousMembershipHash = [inner.previousMembershipHash copy];
  copy.activeMembers = AncCopyImmutableMembers(inner.activeMembers);
  copy.removedEndpointIds = [[NSArray alloc] initWithArray:inner.removedEndpointIds copyItems:YES];
  copy.rotationCompleted = inner.rotationCompleted;
  copy.outstandingJobsResolved = inner.outstandingJobsResolved;
  copy.recoverySnapshotHash = [inner.recoverySnapshotHash copy];
  copy.recoveryAuthorizationHash = [inner.recoveryAuthorizationHash copy];
  copy.recoveryGeneration = inner.recoveryGeneration; copy.recoveryId = [inner.recoveryId copy];
  copy.recoverySigningPublicKey = [inner.recoverySigningPublicKey copy];
  copy.recoveryKeyAgreementPublicKey = [inner.recoveryKeyAgreementPublicKey copy];
  copy.recoveryWrapHash = [inner.recoveryWrapHash copy];
  object_setClass(copy,
                  AncPrivateVaultAuthenticatedControlLogMembershipCommit.class);
  return copy;
}

static AncPrivateVaultControlLogSignedEntry *AncCopySignedEntry(AncControlEntry *entry) {
  AncPrivateVaultControlLogSignedEntry *copy = [[AncPrivateVaultControlLogSignedEntry alloc] init];
  copy.vaultId = [entry.vaultId copy]; copy.createdAt = [entry.createdAt copy];
  copy.envelopeId = [entry.envelopeId copy]; copy.sequence = entry.sequence;
  copy.previousHash = [entry.previousHash copy]; copy.innerEnvelopeBytes = [entry.innerBytes copy];
  copy.signerEndpointId = [entry.signerEndpointId copy]; copy.signature = [entry.signature copy];
  object_setClass(copy, AncPrivateVaultAuthenticatedControlLogSignedEntry.class);
  return copy;
}

static BOOL AncCommitMutationAttempted(
    AncPrivateVaultControlLogMembershipCommit *commit) {
  if (AncImmutableMutationAttempted(commit)) return YES;
  for (AncPrivateVaultControlLogMember *member in commit.activeMembers)
    if (AncImmutableMutationAttempted(member)) return YES;
  return NO;
}

static BOOL AncMembersEqual(NSArray *left, NSArray *right) {
  if (left.count != right.count) return NO;
  for (NSUInteger index = 0; index < left.count; index += 1)
    if (!AncSameMember(left[index], right[index])) return NO;
  return YES;
}

static BOOL AncNullableDataEqual(NSData *left, NSData *right) {
  return left == right || [left isEqualToData:right];
}

static BOOL AncCommitSnapshotEqual(AncPrivateVaultControlLogMembershipCommit *copy,
                                   AncControlInner *inner) {
  return [copy.vaultId isEqualToString:inner.vaultId] &&
      [copy.ceremonyId isEqualToString:inner.ceremonyId] &&
      [copy.ceremonyKind isEqualToString:inner.ceremonyKind] && copy.epoch == inner.epoch &&
      AncNullableDataEqual(copy.previousMembershipHash, inner.previousMembershipHash) &&
      AncMembersEqual(copy.activeMembers, inner.activeMembers) &&
      [copy.removedEndpointIds isEqualToArray:inner.removedEndpointIds] &&
      copy.rotationCompleted == inner.rotationCompleted &&
      copy.outstandingJobsResolved == inner.outstandingJobsResolved &&
      AncNullableDataEqual(copy.recoverySnapshotHash, inner.recoverySnapshotHash) &&
      AncNullableDataEqual(copy.recoveryAuthorizationHash, inner.recoveryAuthorizationHash) &&
      copy.recoveryGeneration == inner.recoveryGeneration &&
      [copy.recoveryId isEqualToString:inner.recoveryId] &&
      [copy.recoverySigningPublicKey isEqualToData:inner.recoverySigningPublicKey] &&
      [copy.recoveryKeyAgreementPublicKey isEqualToData:inner.recoveryKeyAgreementPublicKey] &&
      [copy.recoveryWrapHash isEqualToData:inner.recoveryWrapHash];
}

static BOOL AncSignedEntrySnapshotEqual(AncPrivateVaultControlLogSignedEntry *copy,
                                        AncControlEntry *entry) {
  return [copy.vaultId isEqualToString:entry.vaultId] &&
      [copy.createdAt isEqualToString:entry.createdAt] &&
      [copy.envelopeId isEqualToString:entry.envelopeId] && copy.sequence == entry.sequence &&
      [copy.previousHash isEqualToData:entry.previousHash] &&
      [copy.innerEnvelopeBytes isEqualToData:entry.innerBytes] &&
      [copy.signerEndpointId isEqualToString:entry.signerEndpointId] &&
      [copy.signature isEqualToData:entry.signature];
}

static BOOL AncStateSnapshotEqual(AncPrivateVaultControlLogState *copy,
                                  AncPrivateVaultControlLogState *state) {
  return [copy.vaultId isEqualToString:state.vaultId] && copy.sequence == state.sequence &&
      [copy.headHash isEqualToData:state.headHash] &&
      [copy.membershipHash isEqualToData:state.membershipHash] &&
      [copy.signedAt isEqualToString:state.signedAt] &&
      AncMembersEqual(copy.activeMembers, state.activeMembers) &&
      [copy.removedEndpointIds isEqualToArray:state.removedEndpointIds] &&
      copy.epoch == state.epoch && copy.recoveryGeneration == state.recoveryGeneration &&
      [copy.recoveryId isEqualToString:state.recoveryId] &&
      [copy.recoverySigningPublicKey isEqualToData:state.recoverySigningPublicKey] &&
      [copy.recoveryKeyAgreementPublicKey isEqualToData:state.recoveryKeyAgreementPublicKey] &&
      [copy.recoveryWrapHash isEqualToData:state.recoveryWrapHash] &&
      [copy.freshnessMode isEqualToString:state.freshnessMode];
}

static BOOL AncStateValid(AncPrivateVaultControlLogState *state) {
  if (!AncOpaqueId(state.vaultId) || state.sequence > kMaximumSafeInteger ||
      state.headHash.length != 32 || state.membershipHash.length != 32 ||
      AncTimestamp(state.signedAt) == nil || state.activeMembers.count == 0 ||
      state.activeMembers.count > kMaximumMembers ||
      state.removedEndpointIds.count > kMaximumTombstones || state.epoch == 0 ||
      state.epoch > kMaximumSafeInteger || state.recoveryGeneration == 0 ||
      state.recoveryGeneration > kMaximumSafeInteger || !AncOpaqueId(state.recoveryId) ||
      state.recoverySigningPublicKey.length != 32 ||
      state.recoveryKeyAgreementPublicKey.length != 32 || state.recoveryWrapHash.length != 32 ||
      (![state.freshnessMode isEqualToString:@"endpoint_witnessed"] &&
       ![state.freshnessMode isEqualToString:@"eventual_fork_detection"]))
    return NO;
  NSUInteger brokers = 0;
  NSMutableSet *activeIds = [NSMutableSet set];
  NSString *previous = nil;
  for (AncPrivateVaultControlLogMember *member in state.activeMembers) {
    if (!AncOpaqueId(member.endpointId) || !AncOpaqueId(member.enrollmentRef) ||
        member.signingPublicKey.length != 32 || member.keyAgreementPublicKey.length != 32 ||
        (![member.role isEqualToString:@"endpoint"] && ![member.role isEqualToString:@"broker"]) ||
        ([member.role isEqualToString:@"endpoint"] && member.unattended) ||
        ([member.role isEqualToString:@"broker"] && !member.unattended) ||
        (previous != nil && [previous compare:member.endpointId] != NSOrderedAscending))
      return NO;
    if ([member.role isEqualToString:@"broker"]) brokers += 1;
    [activeIds addObject:member.endpointId]; previous = member.endpointId;
  }
  if (brokers > 1 || activeIds.count != state.activeMembers.count ||
      !AncSortedUniqueStrings(state.removedEndpointIds)) return NO;
  for (NSString *removedId in state.removedEndpointIds)
    if (!AncOpaqueId(removedId) || [activeIds containsObject:removedId]) return NO;
  return YES;
}

static BOOL AncTransitionValid(AncPrivateVaultControlLogState *current,
                               AncControlInner *commit) {
  NSMutableArray *added = [NSMutableArray array], *removed = [NSMutableArray array];
  for (AncPrivateVaultControlLogMember *next in commit.activeMembers) {
    AncPrivateVaultControlLogMember *prior = AncFindMember(current.activeMembers, next.endpointId);
    if (prior == nil) [added addObject:next]; else if (!AncSameMember(prior, next)) return NO;
  }
  for (AncPrivateVaultControlLogMember *prior in current.activeMembers)
    if (AncFindMember(commit.activeMembers, prior.endpointId) == nil) [removed addObject:prior];
  for (AncPrivateVaultControlLogMember *member in added)
    if ([current.removedEndpointIds containsObject:member.endpointId]) return NO;
  if (![commit.previousMembershipHash isEqualToData:current.membershipHash]) return NO;
  NSArray *removedIds = [[removed valueForKey:@"endpointId"] sortedArrayUsingSelector:@selector(compare:)];
  if (![removedIds isEqualToArray:commit.removedEndpointIds]) return NO;
  NSArray *brokersBefore = [current.activeMembers filteredArrayUsingPredicate:
      [NSPredicate predicateWithBlock:^BOOL(AncPrivateVaultControlLogMember *member, NSDictionary *bindings) {
        (void)bindings; return [member.role isEqualToString:@"broker"];
      }]];
  NSArray *brokersAfter = [commit.activeMembers filteredArrayUsingPredicate:
      [NSPredicate predicateWithBlock:^BOOL(AncPrivateVaultControlLogMember *member, NSDictionary *bindings) {
        (void)bindings; return [member.role isEqualToString:@"broker"];
      }]];
  BOOL sameRecovery = commit.recoveryGeneration == current.recoveryGeneration &&
      [commit.recoveryId isEqualToString:current.recoveryId] &&
      [commit.recoverySigningPublicKey isEqualToData:current.recoverySigningPublicKey] &&
      [commit.recoveryKeyAgreementPublicKey isEqualToData:current.recoveryKeyAgreementPublicKey];
  BOOL recoveryTransition = [commit.ceremonyKind isEqualToString:@"recovery"]
      ? current.recoveryGeneration < kMaximumSafeInteger &&
        commit.recoveryGeneration == current.recoveryGeneration + 1 &&
        ![commit.recoveryId isEqualToString:current.recoveryId] &&
        ![commit.recoverySigningPublicKey isEqualToData:current.recoverySigningPublicKey] &&
        ![commit.recoveryKeyAgreementPublicKey isEqualToData:current.recoveryKeyAgreementPublicKey] &&
        ![commit.recoveryWrapHash isEqualToData:current.recoveryWrapHash]
      : sameRecovery && (commit.epoch == current.epoch
          ? [commit.recoveryWrapHash isEqualToData:current.recoveryWrapHash]
          : ![commit.recoveryWrapHash isEqualToData:current.recoveryWrapHash]);
  if (!recoveryTransition) return NO;
  if (![commit.ceremonyKind isEqualToString:@"broker_replacement"] &&
      ![commit.ceremonyKind isEqualToString:@"remove_broker"] &&
      ![commit.ceremonyKind isEqualToString:@"recovery"] && commit.outstandingJobsResolved)
    return NO;
  if ([commit.ceremonyKind isEqualToString:@"first_device"]) return NO;
  if ([commit.ceremonyKind isEqualToString:@"add_device"])
    return added.count == 1 && [((AncPrivateVaultControlLogMember *)added[0]).role isEqualToString:@"endpoint"] &&
           removed.count == 0 && commit.epoch == current.epoch && !commit.rotationCompleted;
  if ([commit.ceremonyKind isEqualToString:@"add_broker"])
    return brokersBefore.count == 0 && brokersAfter.count == 1 && added.count == 1 &&
           [((AncPrivateVaultControlLogMember *)added[0]).role isEqualToString:@"broker"] &&
           removed.count == 0 && commit.epoch == current.epoch && !commit.rotationCompleted;
  if ([commit.ceremonyKind isEqualToString:@"remove_device"])
    return added.count == 0 && removed.count == 1 &&
           [((AncPrivateVaultControlLogMember *)removed[0]).role isEqualToString:@"endpoint"] &&
           current.epoch < kMaximumSafeInteger && commit.epoch == current.epoch + 1 && commit.rotationCompleted;
  if ([commit.ceremonyKind isEqualToString:@"remove_broker"])
    return brokersBefore.count == 1 && brokersAfter.count == 0 && added.count == 0 && removed.count == 1 &&
           [((AncPrivateVaultControlLogMember *)removed[0]).role isEqualToString:@"broker"] &&
           current.epoch < kMaximumSafeInteger && commit.epoch == current.epoch + 1 &&
           commit.rotationCompleted && commit.outstandingJobsResolved;
  if ([commit.ceremonyKind isEqualToString:@"broker_replacement"])
    return brokersBefore.count == 1 && brokersAfter.count == 1 && added.count == 1 && removed.count == 1 &&
           [((AncPrivateVaultControlLogMember *)added[0]).role isEqualToString:@"broker"] &&
           [((AncPrivateVaultControlLogMember *)removed[0]).role isEqualToString:@"broker"] &&
           current.epoch < kMaximumSafeInteger && commit.epoch == current.epoch + 1 &&
           commit.rotationCompleted && commit.outstandingJobsResolved;
  if ([commit.ceremonyKind isEqualToString:@"recovery"])
    return added.count == 1 && [((AncPrivateVaultControlLogMember *)added[0]).role isEqualToString:@"endpoint"] &&
           removed.count == current.activeMembers.count && commit.activeMembers.count == 1 &&
           current.epoch < kMaximumSafeInteger && commit.epoch == current.epoch + 1 &&
           commit.rotationCompleted && commit.outstandingJobsResolved == (brokersBefore.count == 1) &&
           commit.recoverySnapshotHash != nil && commit.recoveryAuthorizationHash != nil;
  return NO;
}

static AncPrivateVaultControlLogState *AncNextState(AncPrivateVaultControlLogState *current,
                                                     AncControlEntry *entry,
                                                     NSData *entryHash,
                                                     NSData *membershipHash) {
  AncPrivateVaultControlLogState *state = [[AncPrivateVaultControlLogState alloc] init];
  state.vaultId = entry.vaultId; state.sequence = entry.sequence; state.headHash = entryHash;
  state.signedAt = entry.createdAt;
  if (entry.inner.type == AncInnerMembership) {
    state.membershipHash = membershipHash;
    state.activeMembers = entry.inner.activeMembers;
    NSMutableSet *removed = [NSMutableSet setWithArray:current.removedEndpointIds ?: @[]];
    [removed addObjectsFromArray:entry.inner.removedEndpointIds];
    state.removedEndpointIds = [removed.allObjects sortedArrayUsingSelector:@selector(compare:)];
    state.epoch = entry.inner.epoch; state.recoveryGeneration = entry.inner.recoveryGeneration;
    state.recoveryId = entry.inner.recoveryId;
    state.recoverySigningPublicKey = entry.inner.recoverySigningPublicKey;
    state.recoveryKeyAgreementPublicKey = entry.inner.recoveryKeyAgreementPublicKey;
    state.recoveryWrapHash = entry.inner.recoveryWrapHash;
  } else {
    state.membershipHash = current.membershipHash; state.activeMembers = current.activeMembers;
    state.removedEndpointIds = current.removedEndpointIds; state.epoch = current.epoch;
    state.recoveryGeneration = current.recoveryGeneration; state.recoveryId = current.recoveryId;
    state.recoverySigningPublicKey = current.recoverySigningPublicKey;
    state.recoveryKeyAgreementPublicKey = current.recoveryKeyAgreementPublicKey;
    state.recoveryWrapHash = current.recoveryWrapHash;
  }
  state.freshnessMode = @"endpoint_witnessed";
  return state;
}

@implementation AncPrivateVaultControlLog

- (AncPrivateVaultControlLogStatus)
    replaySignedEntry:(NSData *)signedEntry
         currentState:(AncPrivateVaultControlLogState *)current
             verifier:(id<AncPrivateVaultControlLogAuthorizationVerifier>)verifier
               result:(AncPrivateVaultControlLogReplayResult **)outResult {
  if (outResult == NULL) return AncPrivateVaultControlLogStatusInvalidEntry;
  *outResult = nil;
  NSData *authenticatedSignedEntry = nil;
  @try {
    if (![signedEntry isKindOfClass:NSData.class])
      return AncPrivateVaultControlLogStatusInvalidEntry;
    authenticatedSignedEntry = [NSData dataWithData:signedEntry];
  } @catch (__unused NSException *exception) {
    return AncPrivateVaultControlLogStatusInvalidEntry;
  }
  AncControlEntry *entry = AncParseEntry(authenticatedSignedEntry);
  if (entry == nil) return AncPrivateVaultControlLogStatusInvalidEntry;
  NSData *entryHash = AncHash(authenticatedSignedEntry);
  if (entryHash == nil) return AncPrivateVaultControlLogStatusFailed;
  if (current != nil) {
    @try {
      current = AncCopyState(current);
      if (!AncStateValid(current)) return AncPrivateVaultControlLogStatusInvalidEntry;
    } @catch (__unused NSException *exception) {
      return AncPrivateVaultControlLogStatusInvalidEntry;
    }
  }
  if (current != nil) {
    if (![entry.vaultId isEqualToString:current.vaultId]) return AncPrivateVaultControlLogStatusInvalidEntry;
    if (entry.sequence < current.sequence) return AncPrivateVaultControlLogStatusRollback;
    if (entry.sequence == current.sequence) {
      if (![entryHash isEqualToData:current.headHash]) return AncPrivateVaultControlLogStatusFork;
      AncPrivateVaultControlLogReplayResult *result =
          class_createInstance(AncPrivateVaultControlLogReplayResult.class, 0);
      result.state = AncPrivateVaultControlLogStateCreateImmutableCopy(current);
      result.entryHash = [entryHash copy];
      result.idempotent = YES;
      result.authenticatedPriorState =
          AncPrivateVaultControlLogStateCreateImmutableCopy(current);
      if (result.state == nil || result.authenticatedPriorState == nil)
        return AncPrivateVaultControlLogStatusFailed;
      object_setClass(result, AncPrivateVaultAuthenticatedReplayResult.class);
      if (!AncRegisterReplayEvidence(
              result, result.authenticatedPriorState, result.state,
              result.entryHash, YES))
        return AncPrivateVaultControlLogStatusFailed;
      *outResult = result;
      return AncPrivateVaultControlLogStatusOK;
    }
    if (current.sequence == kMaximumSafeInteger || entry.sequence > current.sequence + 1)
      return AncPrivateVaultControlLogStatusGap;
    if (![entry.previousHash isEqualToData:current.headHash]) return AncPrivateVaultControlLogStatusFork;
    NSDate *currentDate = AncTimestamp(current.signedAt);
    if (currentDate == nil || [entry.createdDate compare:currentDate] == NSOrderedAscending)
      return AncPrivateVaultControlLogStatusInvalidTransition;
  } else if (entry.sequence != 0 ||
             ![entry.previousHash isEqualToData:[NSMutableData dataWithLength:32]]) {
    return AncPrivateVaultControlLogStatusInvalidGenesis;
  }
  AncControlInner *inner = entry.inner;
  AncPrivateVaultControlLogMember *signer = nil;
  if (current == nil) {
    if (inner.type != AncInnerMembership || ![inner.ceremonyKind isEqualToString:@"first_device"] ||
        inner.epoch != 1 || inner.previousMembershipHash != nil || inner.activeMembers.count != 1 ||
        ![((AncPrivateVaultControlLogMember *)inner.activeMembers[0]).role isEqualToString:@"endpoint"] ||
        inner.removedEndpointIds.count != 0 || inner.rotationCompleted || inner.outstandingJobsResolved ||
        inner.recoverySnapshotHash != nil || inner.recoveryAuthorizationHash != nil ||
        inner.recoveryGeneration != 1 ||
        ![entry.signerEndpointId isEqualToString:((AncPrivateVaultControlLogMember *)inner.activeMembers[0]).endpointId])
      return AncPrivateVaultControlLogStatusInvalidGenesis;
    signer = inner.activeMembers[0];
  } else {
    signer = AncFindMember(current.activeMembers, entry.signerEndpointId);
    AncPrivateVaultControlLogMember *recoveryCandidate =
        inner.type == AncInnerMembership && [inner.ceremonyKind isEqualToString:@"recovery"]
            ? AncFindMember(inner.activeMembers, entry.signerEndpointId) : nil;
    if (signer == nil) signer = recoveryCandidate;
    if (signer == nil) {
      if (inner.type == AncInnerMembership && AncFindMember(inner.activeMembers, entry.signerEndpointId) != nil)
        return AncPrivateVaultControlLogStatusCandidateSelfEnrollment;
      return AncPrivateVaultControlLogStatusUnauthorizedSigner;
    }
    if (inner.type == AncInnerMembership && ![inner.ceremonyKind isEqualToString:@"recovery"] &&
        AncFindMember(current.activeMembers, entry.signerEndpointId) == nil)
      return AncPrivateVaultControlLogStatusCandidateSelfEnrollment;
    if (inner.type == AncInnerMembership && ![signer.role isEqualToString:@"endpoint"])
      return AncPrivateVaultControlLogStatusUnauthorizedSigner;
  }
  NSData *signatureMessage = AncDomainMessage(entry.unsignedBytes);
  if (anc_pv_ed25519_verify(entry.signature.bytes, signatureMessage.bytes,
                            signatureMessage.length, signer.signingPublicKey.bytes) != ANC_PV_CRYPTO_OK)
    return AncPrivateVaultControlLogStatusInvalidSignature;
  NSData *membershipHash = inner.type == AncInnerMembership ? AncHash(entry.innerBytes) : current.membershipHash;
  if (membershipHash == nil) return AncPrivateVaultControlLogStatusFailed;
  if (current == nil) {
    SEL selector = @selector(verifyGenesisMembershipCommit:signedEntry:signedEntryBytes:innerEnvelopeBytes:);
    if (![verifier respondsToSelector:selector])
      return AncPrivateVaultControlLogStatusGenesisAuthorizationRequired;
    AncPrivateVaultControlLogMembershipCommit *commitSnapshot = AncCopyCommit(inner);
    AncPrivateVaultControlLogSignedEntry *entrySnapshot = AncCopySignedEntry(entry);
    NSData *signedBytesSnapshot = AncImmutableCallbackData(authenticatedSignedEntry);
    NSData *innerBytesSnapshot = AncImmutableCallbackData(entry.innerBytes);
    BOOL authorized = NO;
    @try {
      authorized = [verifier verifyGenesisMembershipCommit:commitSnapshot
                                                signedEntry:entrySnapshot
                                           signedEntryBytes:signedBytesSnapshot
                                         innerEnvelopeBytes:innerBytesSnapshot];
    } @catch (__unused NSException *exception) {
      authorized = NO;
    }
    if (!authorized || AncCommitMutationAttempted(commitSnapshot) ||
        AncImmutableMutationAttempted(entrySnapshot) ||
        AncImmutableMutationAttempted(signedBytesSnapshot) ||
        AncImmutableMutationAttempted(innerBytesSnapshot) ||
        !AncCommitSnapshotEqual(commitSnapshot, inner) ||
        !AncSignedEntrySnapshotEqual(entrySnapshot, entry) ||
        ![signedBytesSnapshot isEqualToData:authenticatedSignedEntry] ||
        ![innerBytesSnapshot isEqualToData:entry.innerBytes] ||
        ![signedEntry isEqualToData:authenticatedSignedEntry])
      return AncPrivateVaultControlLogStatusGenesisAuthorizationRequired;
  } else if (inner.type == AncInnerContinuity) {
    if (![inner.membershipHash isEqualToData:current.membershipHash])
      return AncPrivateVaultControlLogStatusInvalidTransition;
  } else if (inner.type == AncInnerAbort) {
    if (![signer.role isEqualToString:@"endpoint"] ||
        ![verifier respondsToSelector:@selector(verifyCeremonyAbortSignedEntry:innerEnvelope:currentState:)])
      return AncPrivateVaultControlLogStatusCeremonyAbortAuthorizationRequired;
    AncPrivateVaultControlLogState *stateSnapshot = AncCopyState(current);
    NSData *signedSnapshot = [authenticatedSignedEntry copy];
    NSData *innerSnapshot = [entry.innerBytes copy];
    BOOL authorized = NO;
    @try {
      authorized = [verifier verifyCeremonyAbortSignedEntry:signedSnapshot
                                               innerEnvelope:innerSnapshot
                                                 currentState:stateSnapshot];
    } @catch (__unused NSException *exception) {
      authorized = NO;
    }
    if (!authorized || !AncStateSnapshotEqual(stateSnapshot, current) ||
        ![innerSnapshot isEqualToData:entry.innerBytes] ||
        ![AncHash(signedSnapshot) isEqualToData:entryHash])
      return AncPrivateVaultControlLogStatusCeremonyAbortAuthorizationRequired;
  } else if (inner.type == AncInnerGrantRevocation) {
    SEL selector = @selector(verifyGrantRevocationSignedEntry:innerEnvelope:revocationEnvelope:currentState:);
    if (![signer.role isEqualToString:@"endpoint"] ||
        ![verifier respondsToSelector:selector])
      return AncPrivateVaultControlLogStatusGrantRevocationAuthorizationRequired;
    AncPrivateVaultControlLogState *stateSnapshot = AncCopyState(current);
    NSData *signedSnapshot = [authenticatedSignedEntry copy];
    NSData *innerSnapshot = [entry.innerBytes copy];
    NSData *revocationSnapshot = [inner.revocationEnvelopeBytes copy];
    BOOL authorized = NO;
    @try {
      authorized = [verifier verifyGrantRevocationSignedEntry:signedSnapshot
                                                innerEnvelope:innerSnapshot
                                           revocationEnvelope:revocationSnapshot
                                                 currentState:stateSnapshot];
    } @catch (__unused NSException *exception) {
      authorized = NO;
    }
    if (!authorized || !AncStateSnapshotEqual(stateSnapshot, current) ||
        ![innerSnapshot isEqualToData:entry.innerBytes] ||
        ![revocationSnapshot isEqualToData:inner.revocationEnvelopeBytes] ||
        ![AncHash(signedSnapshot) isEqualToData:entryHash])
      return AncPrivateVaultControlLogStatusGrantRevocationAuthorizationRequired;
  } else {
    if (!AncTransitionValid(current, inner)) return AncPrivateVaultControlLogStatusInvalidTransition;
    if (![inner.ceremonyKind isEqualToString:@"recovery"] &&
        AncFindMember(inner.activeMembers, entry.signerEndpointId) == nil)
      return AncPrivateVaultControlLogStatusUnauthorizedSigner;
    SEL typedRecoverySelector = @selector(verifyRecoveryMembershipCommit:signedEntry:currentState:signedEntryBytes:innerEnvelopeBytes:);
    SEL legacyRecoverySelector = @selector(verifyRecoverySignedEntry:innerEnvelope:currentState:);
    if ([inner.ceremonyKind isEqualToString:@"recovery"] &&
        ![verifier respondsToSelector:typedRecoverySelector] &&
        ![verifier respondsToSelector:legacyRecoverySelector])
      return AncPrivateVaultControlLogStatusRecoveryAuthorizationRequired;
    if ([inner.ceremonyKind isEqualToString:@"recovery"]) {
      AncPrivateVaultControlLogState *stateSnapshot = AncCopyState(current);
      AncPrivateVaultControlLogMembershipCommit *commitSnapshot =
          AncCopyCommit(inner);
      AncPrivateVaultControlLogSignedEntry *entrySnapshot =
          AncCopySignedEntry(entry);
      NSData *signedSnapshot = [authenticatedSignedEntry copy];
      NSData *innerSnapshot = [entry.innerBytes copy];
      BOOL authorized = NO;
      @try {
        if ([verifier respondsToSelector:typedRecoverySelector]) {
          authorized = [verifier
              verifyRecoveryMembershipCommit:commitSnapshot
                                   signedEntry:entrySnapshot
                                  currentState:stateSnapshot
                              signedEntryBytes:signedSnapshot
                            innerEnvelopeBytes:innerSnapshot];
        } else {
          authorized = [verifier verifyRecoverySignedEntry:signedSnapshot
                                             innerEnvelope:innerSnapshot
                                               currentState:stateSnapshot];
        }
      } @catch (__unused NSException *exception) {
        authorized = NO;
      }
      if (!authorized || AncCommitMutationAttempted(commitSnapshot) ||
          AncImmutableMutationAttempted(entrySnapshot) ||
          !AncCommitSnapshotEqual(commitSnapshot, inner) ||
          !AncSignedEntrySnapshotEqual(entrySnapshot, entry) ||
          !AncStateSnapshotEqual(stateSnapshot, current) ||
          ![innerSnapshot isEqualToData:entry.innerBytes] ||
          ![AncHash(signedSnapshot) isEqualToData:entryHash])
        return AncPrivateVaultControlLogStatusRecoveryAuthorizationRequired;
    }
    if ([inner.ceremonyKind isEqualToString:@"add_device"] ||
        [inner.ceremonyKind isEqualToString:@"add_broker"]) {
      SEL selector = @selector(verifyEnrollmentMembershipCommit:signedEntry:currentState:signedEntryBytes:innerEnvelopeBytes:);
      if ([verifier respondsToSelector:selector]) {
        AncPrivateVaultControlLogMembershipCommit *commitSnapshot =
            AncCopyCommit(inner);
        AncPrivateVaultControlLogSignedEntry *entrySnapshot =
            AncCopySignedEntry(entry);
        AncPrivateVaultControlLogState *stateSnapshot = AncCopyState(current);
        NSData *signedSnapshot = AncImmutableCallbackData(authenticatedSignedEntry);
        NSData *innerSnapshot = AncImmutableCallbackData(entry.innerBytes);
        BOOL authorized = NO;
        @try {
          authorized = [verifier
              verifyEnrollmentMembershipCommit:commitSnapshot
                                        signedEntry:entrySnapshot
                                       currentState:stateSnapshot
                                   signedEntryBytes:signedSnapshot
                                 innerEnvelopeBytes:innerSnapshot];
        } @catch (__unused NSException *exception) {
          authorized = NO;
        }
        if (!authorized || AncCommitMutationAttempted(commitSnapshot) ||
            AncImmutableMutationAttempted(entrySnapshot) ||
            AncImmutableMutationAttempted(signedSnapshot) ||
            AncImmutableMutationAttempted(innerSnapshot) ||
            !AncCommitSnapshotEqual(commitSnapshot, inner) ||
            !AncSignedEntrySnapshotEqual(entrySnapshot, entry) ||
            !AncStateSnapshotEqual(stateSnapshot, current) ||
            ![signedSnapshot isEqualToData:authenticatedSignedEntry] ||
            ![innerSnapshot isEqualToData:entry.innerBytes])
          return AncPrivateVaultControlLogStatusEnrollmentAuthorizationRequired;
      }
    }
    if (![inner.ceremonyKind isEqualToString:@"recovery"] &&
        inner.epoch == current.epoch + 1) {
      SEL selector = @selector(verifyRecoveryWrapRotationCommit:signedEntry:currentState:signedEntryBytes:innerEnvelopeBytes:);
      if (![verifier respondsToSelector:selector])
        return AncPrivateVaultControlLogStatusRecoveryWrapRotationRequired;
      AncPrivateVaultControlLogMembershipCommit *commitSnapshot = AncCopyCommit(inner);
      AncPrivateVaultControlLogSignedEntry *entrySnapshot = AncCopySignedEntry(entry);
      AncPrivateVaultControlLogState *stateSnapshot = AncCopyState(current);
      BOOL authorized = NO;
      @try {
        authorized = [verifier verifyRecoveryWrapRotationCommit:commitSnapshot
                                                     signedEntry:entrySnapshot
                                                    currentState:stateSnapshot
                                                signedEntryBytes:[authenticatedSignedEntry copy]
                                              innerEnvelopeBytes:[entry.innerBytes copy]];
      } @catch (__unused NSException *exception) {
        authorized = NO;
      }
      if (!authorized || AncCommitMutationAttempted(commitSnapshot) ||
          AncImmutableMutationAttempted(entrySnapshot) ||
          !AncCommitSnapshotEqual(commitSnapshot, inner) ||
          !AncSignedEntrySnapshotEqual(entrySnapshot, entry) ||
          !AncStateSnapshotEqual(stateSnapshot, current))
        return AncPrivateVaultControlLogStatusRecoveryWrapRotationRequired;
    }
  }
  AncPrivateVaultControlLogState *state = AncNextState(current, entry, entryHash, membershipHash);
  if (state.removedEndpointIds.count > kMaximumTombstones)
    return AncPrivateVaultControlLogStatusInvalidTransition;
  if (inner.type == AncInnerContinuity && [signer.role isEqualToString:@"broker"]) {
    state.signedAt = [current.signedAt copy];
    state.freshnessMode = @"eventual_fork_detection";
  }
  AncPrivateVaultControlLogReplayResult *result =
      class_createInstance(AncPrivateVaultControlLogReplayResult.class, 0);
  result.state = AncPrivateVaultControlLogStateCreateImmutableCopy(state);
  result.entryHash = [entryHash copy];
  result.idempotent = NO;
  result.authenticatedPriorState =
      current == nil
          ? nil
          : AncPrivateVaultControlLogStateCreateImmutableCopy(current);
  if (result.state == nil || (current != nil && result.authenticatedPriorState == nil))
    return AncPrivateVaultControlLogStatusFailed;
  object_setClass(result, AncPrivateVaultAuthenticatedReplayResult.class);
  if (!AncRegisterReplayEvidence(result, result.authenticatedPriorState,
                                 result.state, result.entryHash, NO))
    return AncPrivateVaultControlLogStatusFailed;
  *outResult = result;
  return AncPrivateVaultControlLogStatusOK;
}

@end
