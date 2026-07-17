#import "PrivateVaultAuthoritySnapshot.h"

#import "PrivateVaultAncCanonical.h"

#include <stdio.h>
#include <time.h>

static const uint64_t kAncPrivateVaultMaxSafeInteger = 9007199254740991ULL;

@interface AncPrivateVaultAuthorityMember ()
@property(nonatomic, readwrite) NSString *endpointId;
@property(nonatomic, readwrite) NSString *role;
@property(nonatomic, readwrite) BOOL unattended;
@property(nonatomic, readwrite) NSData *signingPublicKey;
@property(nonatomic, readwrite) NSData *keyAgreementPublicKey;
@property(nonatomic, readwrite) NSString *enrollmentRef;
@end
@implementation AncPrivateVaultAuthorityMember
@end

@interface AncPrivateVaultAuthoritySnapshot ()
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) uint64_t targetCustodyGeneration;
@property(nonatomic, readwrite) uint64_t previousCustodyGeneration;
@property(nonatomic, readwrite, nullable) NSNumber *previousSequence;
@property(nonatomic, readwrite, nullable) NSData *previousHead;
@property(nonatomic, readwrite) uint64_t verifiedAtMs;
@property(nonatomic, readwrite) uint64_t sequence;
@property(nonatomic, readwrite) NSData *headHash;
@property(nonatomic, readwrite) NSData *membershipHash;
@property(nonatomic, readwrite) NSString *signedAt;
@property(nonatomic, readwrite) uint64_t signedAtMs;
@property(nonatomic, readwrite)
    NSArray<AncPrivateVaultAuthorityMember *> *activeMembers;
@property(nonatomic, readwrite) NSArray<NSString *> *removedEndpointIds;
@property(nonatomic, readwrite) uint64_t epoch;
@property(nonatomic, readwrite) uint64_t recoveryGeneration;
@property(nonatomic, readwrite) NSString *recoveryId;
@property(nonatomic, readwrite) NSData *recoverySigningPublicKey;
@property(nonatomic, readwrite) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readwrite) NSData *recoveryWrapHash;
@property(nonatomic, readwrite) NSString *freshnessMode;
@end
@implementation AncPrivateVaultAuthoritySnapshot
@end

static BOOL AncAuthorityExactKeys(NSDictionary<NSNumber *, id> *map) {
  static NSArray<NSNumber *> *keys;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    keys = @[
      @1,   @2,   @3,   @500, @501, @502, @503, @504, @505, @510, @511,
      @512, @513, @514, @515, @516, @517, @518, @519, @520, @521, @522
    ];
  });
  if (map.count != keys.count)
    return NO;
  for (NSNumber *key in keys)
    if (map[key] == nil)
      return NO;
  return YES;
}

static BOOL AncAuthorityProtocolId(NSString *value) {
  if (![value isKindOfClass:NSString.class])
    return NO;
  NSData *ascii = [value dataUsingEncoding:NSASCIIStringEncoding];
  if (ascii.length < 8 || ascii.length > 160)
    return NO;
  const uint8_t *bytes = ascii.bytes;
  BOOL firstOkay = (bytes[0] >= 'A' && bytes[0] <= 'Z') ||
                   (bytes[0] >= 'a' && bytes[0] <= 'z') ||
                   (bytes[0] >= '0' && bytes[0] <= '9');
  if (!firstOkay)
    return NO;
  for (NSUInteger index = 1; index < ascii.length; index++) {
    uint8_t byte = bytes[index];
    BOOL okay = (byte >= 'A' && byte <= 'Z') || (byte >= 'a' && byte <= 'z') ||
                (byte >= '0' && byte <= '9') || byte == '.' || byte == '_' ||
                byte == ':' || byte == '-';
    if (!okay)
      return NO;
  }
  return YES;
}

static BOOL AncAuthorityInteger(AncPrivateVaultCanonicalValue *value,
                                uint64_t *output, BOOL positive) {
  if (value.type != AncPrivateVaultCanonicalTypeInteger ||
      value.integerValue < 0 ||
      (uint64_t)value.integerValue > kAncPrivateVaultMaxSafeInteger ||
      (positive && value.integerValue == 0))
    return NO;
  *output = (uint64_t)value.integerValue;
  return YES;
}

static BOOL AncAuthorityBytes32(AncPrivateVaultCanonicalValue *value,
                                NSData **output) {
  if (value.type != AncPrivateVaultCanonicalTypeBytes ||
      value.bytesValue.length != ANC_PV_AUTHORITY_SNAPSHOT_HASH_BYTES)
    return NO;
  *output = value.bytesValue;
  return YES;
}

static NSComparisonResult AncAuthorityUTF8Compare(NSString *left,
                                                  NSString *right) {
  NSData *a = [left dataUsingEncoding:NSUTF8StringEncoding];
  NSData *b = [right dataUsingEncoding:NSUTF8StringEncoding];
  const NSUInteger shared = MIN(a.length, b.length);
  int comparison = memcmp(a.bytes, b.bytes, shared);
  if (comparison < 0)
    return NSOrderedAscending;
  if (comparison > 0)
    return NSOrderedDescending;
  if (a.length < b.length)
    return NSOrderedAscending;
  if (a.length > b.length)
    return NSOrderedDescending;
  return NSOrderedSame;
}

static NSNumber *AncAuthoritySignedAtMs(NSString *value) {
  static NSRegularExpression *expression;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    expression = [NSRegularExpression
        regularExpressionWithPattern:
            @"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-"
             "9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$"
                             options:0
                               error:nil];
  });
  if ([expression firstMatchInString:value
                             options:0
                               range:NSMakeRange(0, value.length)] == nil)
    return nil;
  int year = [[value substringWithRange:NSMakeRange(0, 4)] intValue];
  int month = [[value substringWithRange:NSMakeRange(5, 2)] intValue];
  int day = [[value substringWithRange:NSMakeRange(8, 2)] intValue];
  int hour = [[value substringWithRange:NSMakeRange(11, 2)] intValue];
  int minute = [[value substringWithRange:NSMakeRange(14, 2)] intValue];
  int second = [[value substringWithRange:NSMakeRange(17, 2)] intValue];
  NSUInteger zoneIndex = 19;
  NSString *fraction = @"";
  if ([value characterAtIndex:zoneIndex] == '.') {
    NSCharacterSet *zones =
        [NSCharacterSet characterSetWithCharactersInString:@"Z+-"];
    NSRange zoneRange = [value
        rangeOfCharacterFromSet:zones
                        options:0
                          range:NSMakeRange(zoneIndex + 1,
                                            value.length - zoneIndex - 1)];
    if (zoneRange.location == NSNotFound)
      return nil;
    fraction = [value
        substringWithRange:NSMakeRange(zoneIndex + 1,
                                       zoneRange.location - zoneIndex - 1)];
    zoneIndex = zoneRange.location;
  }
  NSString *zone = [value substringFromIndex:zoneIndex];
  struct tm parts = {.tm_year = year - 1900,
                     .tm_mon = month - 1,
                     .tm_mday = day,
                     .tm_hour = hour,
                     .tm_min = minute,
                     .tm_sec = second,
                     .tm_isdst = 0};
  time_t localSeconds = timegm(&parts);
  struct tm exact;
  if (localSeconds < 0 || gmtime_r(&localSeconds, &exact) == NULL ||
      exact.tm_year != year - 1900 || exact.tm_mon != month - 1 ||
      exact.tm_mday != day || exact.tm_hour != hour || exact.tm_min != minute ||
      exact.tm_sec != second)
    return nil;
  int offsetSeconds = 0;
  if (![zone isEqualToString:@"Z"]) {
    int zoneHour = [[zone substringWithRange:NSMakeRange(1, 2)] intValue];
    int zoneMinute = [[zone substringWithRange:NSMakeRange(4, 2)] intValue];
    if (zoneHour > 23 || zoneMinute > 59)
      return nil;
    offsetSeconds = (zoneHour * 60 + zoneMinute) * 60;
    if ([zone characterAtIndex:0] == '-')
      offsetSeconds = -offsetSeconds;
  }
  int64_t utcSeconds = (int64_t)localSeconds - offsetSeconds;
  if (utcSeconds < 0)
    return nil;
  uint64_t fractionalMilliseconds = 0;
  NSUInteger usedFractionDigits = MIN((NSUInteger)3, fraction.length);
  for (NSUInteger index = 0; index < usedFractionDigits; index++)
    fractionalMilliseconds =
        fractionalMilliseconds * 10 + [fraction characterAtIndex:index] - '0';
  for (NSUInteger index = usedFractionDigits; index < 3; index++)
    fractionalMilliseconds *= 10;
  uint64_t milliseconds = (uint64_t)utcSeconds * 1000 + fractionalMilliseconds;
  if (milliseconds > kAncPrivateVaultMaxSafeInteger)
    return nil;
  return @(milliseconds);
}

AncPrivateVaultAuthoritySnapshot *AncPrivateVaultAuthoritySnapshotDecode(
    NSData *data, AncPrivateVaultAuthoritySnapshotStatus *status) {
  if (status)
    *status = AncPrivateVaultAuthoritySnapshotStatusInvalid;
  if (data.length > ANC_PV_AUTHORITY_SNAPSHOT_MAX_BYTES) {
    if (status)
      *status = AncPrivateVaultAuthoritySnapshotStatusTooLarge;
    return nil;
  }
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      data, ANC_PV_AUTHORITY_SNAPSHOT_MAX_BYTES, &canonicalStatus);
  if (root == nil) {
    if (status)
      *status =
          canonicalStatus == AncPrivateVaultCanonicalStatusTooLarge
              ? AncPrivateVaultAuthoritySnapshotStatusTooLarge
              : (canonicalStatus == AncPrivateVaultCanonicalStatusNonCanonical
                     ? AncPrivateVaultAuthoritySnapshotStatusNonCanonical
                     : AncPrivateVaultAuthoritySnapshotStatusInvalid);
    return nil;
  }
  if (root.type != AncPrivateVaultCanonicalTypeMap ||
      !AncAuthorityExactKeys(root.mapValue))
    return nil;
  NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map =
      root.mapValue;
  if (map[@1].type != AncPrivateVaultCanonicalTypeText ||
      ![map[@1].textValue isEqualToString:@"anc/v1"] ||
      map[@2].type != AncPrivateVaultCanonicalTypeText ||
      !AncAuthorityProtocolId(map[@2].textValue) ||
      map[@3].type != AncPrivateVaultCanonicalTypeText ||
      ![map[@3].textValue isEqualToString:@"authority-snapshot"] ||
      map[@500].type != AncPrivateVaultCanonicalTypeInteger ||
      map[@500].integerValue != 1)
    return nil;

  AncPrivateVaultAuthoritySnapshot *snapshot =
      [[AncPrivateVaultAuthoritySnapshot alloc] init];
  snapshot.vaultId = [map[@2].textValue copy];
  uint64_t targetGeneration = 0, previousGeneration = 0, verifiedAt = 0;
  uint64_t sequence = 0, epoch = 0, recoveryGeneration = 0;
  NSData *headHash = nil, *membershipHash = nil, *recoverySigning = nil;
  NSData *recoveryAgreement = nil, *recoveryWrap = nil;
  if (!AncAuthorityInteger(map[@501], &targetGeneration, YES) ||
      !AncAuthorityInteger(map[@502], &previousGeneration, NO) ||
      !AncAuthorityInteger(map[@505], &verifiedAt, YES) ||
      !AncAuthorityInteger(map[@510], &sequence, NO) ||
      !AncAuthorityInteger(map[@516], &epoch, YES) ||
      !AncAuthorityInteger(map[@517], &recoveryGeneration, YES) ||
      targetGeneration != previousGeneration + 1 ||
      !AncAuthorityBytes32(map[@511], &headHash) ||
      !AncAuthorityBytes32(map[@512], &membershipHash) ||
      !AncAuthorityBytes32(map[@519], &recoverySigning) ||
      !AncAuthorityBytes32(map[@520], &recoveryAgreement) ||
      !AncAuthorityBytes32(map[@521], &recoveryWrap))
    return nil;
  snapshot.targetCustodyGeneration = targetGeneration;
  snapshot.previousCustodyGeneration = previousGeneration;
  snapshot.verifiedAtMs = verifiedAt;
  snapshot.sequence = sequence;
  snapshot.epoch = epoch;
  snapshot.recoveryGeneration = recoveryGeneration;
  snapshot.headHash = [headHash copy];
  snapshot.membershipHash = [membershipHash copy];
  snapshot.recoverySigningPublicKey = [recoverySigning copy];
  snapshot.recoveryKeyAgreementPublicKey = [recoveryAgreement copy];
  snapshot.recoveryWrapHash = [recoveryWrap copy];

  const BOOL genesis = map[@503].type == AncPrivateVaultCanonicalTypeNull &&
                       map[@504].type == AncPrivateVaultCanonicalTypeNull;
  if (!genesis) {
    uint64_t previous = 0;
    NSData *head = nil;
    if (!AncAuthorityInteger(map[@503], &previous, NO) ||
        !AncAuthorityBytes32(map[@504], &head) ||
        snapshot.sequence != previous + 1)
      return nil;
    snapshot.previousSequence = @(previous);
    snapshot.previousHead = [head copy];
  } else if (snapshot.previousCustodyGeneration != 0 ||
             snapshot.sequence != 0) {
    return nil;
  }

  if (map[@513].type != AncPrivateVaultCanonicalTypeText)
    return nil;
  NSNumber *signedAtMs = AncAuthoritySignedAtMs(map[@513].textValue);
  if (signedAtMs == nil ||
      signedAtMs.unsignedLongLongValue > snapshot.verifiedAtMs + 30000)
    return nil;
  snapshot.signedAt = [map[@513].textValue copy];
  snapshot.signedAtMs = signedAtMs.unsignedLongLongValue;

  if (map[@514].type != AncPrivateVaultCanonicalTypeArray ||
      map[@514].arrayValue.count == 0 ||
      map[@514].arrayValue.count > ANC_PV_AUTHORITY_SNAPSHOT_MAX_ACTIVE_MEMBERS)
    return nil;
  NSMutableArray *members = [NSMutableArray array];
  NSString *priorId = nil;
  NSUInteger brokerCount = 0;
  for (AncPrivateVaultCanonicalValue *entry in map[@514].arrayValue) {
    if (entry.type != AncPrivateVaultCanonicalTypeArray ||
        entry.arrayValue.count != 6)
      return nil;
    NSArray<AncPrivateVaultCanonicalValue *> *tuple = entry.arrayValue;
    if (tuple[0].type != AncPrivateVaultCanonicalTypeText ||
        !AncAuthorityProtocolId(tuple[0].textValue) ||
        tuple[1].type != AncPrivateVaultCanonicalTypeText ||
        !([tuple[1].textValue isEqualToString:@"endpoint"] ||
          [tuple[1].textValue isEqualToString:@"broker"]) ||
        tuple[2].type != AncPrivateVaultCanonicalTypeBoolean ||
        ([tuple[1].textValue isEqualToString:@"endpoint"] &&
         tuple[2].booleanValue) ||
        ([tuple[1].textValue isEqualToString:@"broker"] &&
         !tuple[2].booleanValue) ||
        tuple[3].type != AncPrivateVaultCanonicalTypeBytes ||
        tuple[3].bytesValue.length != 32 ||
        tuple[4].type != AncPrivateVaultCanonicalTypeBytes ||
        tuple[4].bytesValue.length != 32 ||
        tuple[5].type != AncPrivateVaultCanonicalTypeText ||
        !AncAuthorityProtocolId(tuple[5].textValue) ||
        (priorId != nil &&
         AncAuthorityUTF8Compare(priorId, tuple[0].textValue) !=
             NSOrderedAscending))
      return nil;
    if ([tuple[1].textValue isEqualToString:@"broker"] && ++brokerCount > 1)
      return nil;
    AncPrivateVaultAuthorityMember *member =
        [[AncPrivateVaultAuthorityMember alloc] init];
    member.endpointId = [tuple[0].textValue copy];
    member.role = [tuple[1].textValue copy];
    member.unattended = tuple[2].booleanValue;
    member.signingPublicKey = [tuple[3].bytesValue copy];
    member.keyAgreementPublicKey = [tuple[4].bytesValue copy];
    member.enrollmentRef = [tuple[5].textValue copy];
    [members addObject:member];
    priorId = member.endpointId;
  }
  snapshot.activeMembers = [members copy];

  if (map[@515].type != AncPrivateVaultCanonicalTypeArray ||
      map[@515].arrayValue.count >
          ANC_PV_AUTHORITY_SNAPSHOT_MAX_REMOVED_ENDPOINTS)
    return nil;
  NSMutableArray *removed = [NSMutableArray array];
  NSSet<NSString *> *activeEndpointIds =
      [NSSet setWithArray:[members valueForKey:@"endpointId"]];
  priorId = nil;
  for (AncPrivateVaultCanonicalValue *entry in map[@515].arrayValue) {
    if (entry.type != AncPrivateVaultCanonicalTypeText ||
        !AncAuthorityProtocolId(entry.textValue) ||
        [activeEndpointIds containsObject:entry.textValue] ||
        (priorId != nil && AncAuthorityUTF8Compare(priorId, entry.textValue) !=
                               NSOrderedAscending))
      return nil;
    [removed addObject:[entry.textValue copy]];
    priorId = entry.textValue;
  }
  snapshot.removedEndpointIds = [removed copy];
  if (map[@518].type != AncPrivateVaultCanonicalTypeText ||
      !AncAuthorityProtocolId(map[@518].textValue) ||
      map[@522].type != AncPrivateVaultCanonicalTypeText ||
      !([map[@522].textValue isEqualToString:@"endpoint_witnessed"] ||
        [map[@522].textValue isEqualToString:@"eventual_fork_detection"]))
    return nil;
  snapshot.recoveryId = [map[@518].textValue copy];
  snapshot.freshnessMode = [map[@522].textValue copy];
  if (status)
    *status = AncPrivateVaultAuthoritySnapshotStatusOK;
  return snapshot;
}

NSData *AncPrivateVaultAuthoritySnapshotEncode(
    AncPrivateVaultAuthoritySnapshot *snapshot,
    AncPrivateVaultAuthoritySnapshotStatus *status) {
  if (status)
    *status = AncPrivateVaultAuthoritySnapshotStatusInvalid;
  if (snapshot == nil)
    return nil;
  NSMutableArray *members = [NSMutableArray array];
  for (AncPrivateVaultAuthorityMember *member in snapshot.activeMembers) {
    [members
        addObject:[AncPrivateVaultCanonicalValue array:@[
          [AncPrivateVaultCanonicalValue text:member.endpointId],
          [AncPrivateVaultCanonicalValue text:member.role],
          [AncPrivateVaultCanonicalValue boolean:member.unattended],
          [AncPrivateVaultCanonicalValue bytes:member.signingPublicKey],
          [AncPrivateVaultCanonicalValue bytes:member.keyAgreementPublicKey],
          [AncPrivateVaultCanonicalValue text:member.enrollmentRef]
        ]]];
  }
  NSMutableArray *removed = [NSMutableArray array];
  for (NSString *endpointId in snapshot.removedEndpointIds)
    [removed addObject:[AncPrivateVaultCanonicalValue text:endpointId]];
  AncPrivateVaultCanonicalValue *root = [AncPrivateVaultCanonicalValue map:@{
    @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
    @2 : [AncPrivateVaultCanonicalValue text:snapshot.vaultId],
    @3 : [AncPrivateVaultCanonicalValue text:@"authority-snapshot"],
    @500 : [AncPrivateVaultCanonicalValue integer:1],
    @501 : [AncPrivateVaultCanonicalValue
        integer:(int64_t)snapshot.targetCustodyGeneration],
    @502 : [AncPrivateVaultCanonicalValue
        integer:(int64_t)snapshot.previousCustodyGeneration],
    @503 : snapshot.previousSequence == nil
        ? [AncPrivateVaultCanonicalValue nullValue]
        : [AncPrivateVaultCanonicalValue
              integer:snapshot.previousSequence.longLongValue],
    @504 : snapshot.previousHead == nil
        ? [AncPrivateVaultCanonicalValue nullValue]
        : [AncPrivateVaultCanonicalValue bytes:snapshot.previousHead],
    @505 :
        [AncPrivateVaultCanonicalValue integer:(int64_t)snapshot.verifiedAtMs],
    @510 : [AncPrivateVaultCanonicalValue integer:(int64_t)snapshot.sequence],
    @511 : [AncPrivateVaultCanonicalValue bytes:snapshot.headHash],
    @512 : [AncPrivateVaultCanonicalValue bytes:snapshot.membershipHash],
    @513 : [AncPrivateVaultCanonicalValue text:snapshot.signedAt],
    @514 : [AncPrivateVaultCanonicalValue array:members],
    @515 : [AncPrivateVaultCanonicalValue array:removed],
    @516 : [AncPrivateVaultCanonicalValue integer:(int64_t)snapshot.epoch],
    @517 : [AncPrivateVaultCanonicalValue
        integer:(int64_t)snapshot.recoveryGeneration],
    @518 : [AncPrivateVaultCanonicalValue text:snapshot.recoveryId],
    @519 :
        [AncPrivateVaultCanonicalValue bytes:snapshot.recoverySigningPublicKey],
    @520 : [AncPrivateVaultCanonicalValue
        bytes:snapshot.recoveryKeyAgreementPublicKey],
    @521 : [AncPrivateVaultCanonicalValue bytes:snapshot.recoveryWrapHash],
    @522 : [AncPrivateVaultCanonicalValue text:snapshot.freshnessMode],
  }];
  AncPrivateVaultCanonicalStatus canonicalStatus;
  NSData *encoded = AncPrivateVaultCanonicalEncode(root, &canonicalStatus);
  AncPrivateVaultAuthoritySnapshotStatus validationStatus;
  AncPrivateVaultAuthoritySnapshot *validated =
      encoded == nil
          ? nil
          : AncPrivateVaultAuthoritySnapshotDecode(encoded, &validationStatus);
  if (validated == nil)
    return nil;
  if (status)
    *status = AncPrivateVaultAuthoritySnapshotStatusOK;
  return encoded;
}
