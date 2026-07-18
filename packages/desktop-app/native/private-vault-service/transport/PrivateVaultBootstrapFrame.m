#import "PrivateVaultBootstrapFrame.h"

#include <math.h>

static const NSUInteger kControlMaximum = 8 * 1024;
static const NSUInteger kEntryMaximum = 64 * 1024;
static const NSUInteger kWrapMaximum = 1024 * 1024;
static const NSUInteger kEvidenceMaximum = 2 * 1024 * 1024;

@interface AncPrivateVaultBootstrapFrame ()
@property(nonatomic) NSString *vaultId;
@property(nonatomic) int64_t afterSequence;
@property(nonatomic) int64_t throughSequence;
@property(nonatomic) uint64_t headSequence;
@property(nonatomic) NSString *headHash;
@property(nonatomic) BOOL complete;
@property(nonatomic) NSArray<NSData *> *entries;
@property(nonatomic) NSArray<id> *entryRecoveryWraps;
@property(nonatomic) NSArray<id> *entryEvidenceKinds;
@property(nonatomic) NSArray<id> *entryEvidence;
@property(nonatomic, nullable) NSString *recoveryWrapHash;
@property(nonatomic, nullable) NSData *recoveryWrap;
- (instancetype)initPrivate;
@end

@implementation AncPrivateVaultBootstrapFrame
- (instancetype)initPrivate { return [super init]; }
- (void)setVaultId:(NSString *)value { _vaultId = [value copy]; }
- (void)setHeadHash:(NSString *)value { _headHash = [value copy]; }
- (void)setEntries:(NSArray<NSData *> *)value { _entries = [[NSArray alloc] initWithArray:value copyItems:YES]; }
- (void)setEntryRecoveryWraps:(NSArray<id> *)value { _entryRecoveryWraps = [[NSArray alloc] initWithArray:value copyItems:YES]; }
- (void)setEntryEvidenceKinds:(NSArray<id> *)value { _entryEvidenceKinds = [[NSArray alloc] initWithArray:value copyItems:YES]; }
- (void)setEntryEvidence:(NSArray<id> *)value { _entryEvidence = [[NSArray alloc] initWithArray:value copyItems:YES]; }
- (void)setRecoveryWrapHash:(NSString *)value { _recoveryWrapHash = [value copy]; }
- (void)setRecoveryWrap:(NSData *)value { _recoveryWrap = [value copy]; }
@end

static void Fail(AncPrivateVaultBootstrapFrameStatus *status,
                 AncPrivateVaultBootstrapFrameStatus value) {
  if (status != NULL) *status = value;
}

static BOOL ExactKeys(NSDictionary *value, NSArray<NSString *> *keys) {
  return value.count == keys.count &&
         [[NSSet setWithArray:value.allKeys]
             isEqualToSet:[NSSet setWithArray:keys]];
}

static BOOL IsInteger(NSNumber *value, int64_t minimum, int64_t maximum) {
  if (![value isKindOfClass:NSNumber.class] ||
      CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()) return NO;
  double floating = value.doubleValue;
  int64_t integer = value.longLongValue;
  return isfinite(floating) && floating == (double)integer &&
         integer >= minimum && integer <= maximum;
}

static BOOL IsLowerHash(id value) {
  if (![value isKindOfClass:NSString.class] || [value length] != 64) return NO;
  NSCharacterSet *invalid = [[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
  return [(NSString *)value rangeOfCharacterFromSet:invalid].location == NSNotFound;
}

static BOOL BoundedLengths(id value, NSUInteger maximum, NSUInteger count) {
  if (![value isKindOfClass:NSArray.class] || [value count] != count) return NO;
  for (id item in value) {
    if (!IsInteger(item, 0, (int64_t)maximum)) return NO;
  }
  return YES;
}

AncPrivateVaultBootstrapFrame *AncPrivateVaultBootstrapFrameDecode(
    NSData *encoded, AncPrivateVaultBootstrapFrameStatus *status) {
  Fail(status, AncPrivateVaultBootstrapFrameStatusInvalid);
  if (![encoded isKindOfClass:NSData.class] || encoded.length < 5) return nil;
  if (encoded.length > ANC_PV_BOOTSTRAP_FRAME_MAX_BYTES) {
    Fail(status, AncPrivateVaultBootstrapFrameStatusTooLarge);
    return nil;
  }
  const uint8_t *bytes = encoded.bytes;
  uint32_t controlLength = ((uint32_t)bytes[0] << 24) |
                           ((uint32_t)bytes[1] << 16) |
                           ((uint32_t)bytes[2] << 8) | bytes[3];
  if (controlLength == 0 || controlLength > kControlMaximum ||
      4ULL + controlLength > encoded.length) return nil;
  NSData *control = [encoded subdataWithRange:NSMakeRange(4, controlLength)];
  NSError *error = nil;
  id decoded = [NSJSONSerialization JSONObjectWithData:control options:0 error:&error];
  if (error != nil || ![decoded isKindOfClass:NSDictionary.class]) return nil;
  NSDictionary *m = decoded;
  NSArray *keys = @[@"version", @"suite", @"type", @"vaultId",
                    @"afterSequence", @"throughSequence", @"head", @"complete",
                    @"entryByteLengths", @"entryRecoveryWrapByteLengths",
                    @"entryEvidenceKinds", @"entryEvidenceByteLengths",
                    @"recoveryWrapHash", @"recoveryWrapByteLength"];
  if (!ExactKeys(m, keys) || ![m[@"version"] isEqual:@1] ||
      ![m[@"suite"] isEqual:@"anc/v1"] ||
      ![m[@"type"] isEqual:@"vault-bootstrap-response"] ||
      ![m[@"vaultId"] isKindOfClass:NSString.class] ||
      [m[@"vaultId"] length] < 8 || [m[@"vaultId"] length] > 160 ||
      !IsInteger(m[@"afterSequence"], -1, INT64_MAX) ||
      !IsInteger(m[@"throughSequence"], -1, INT64_MAX) ||
      CFGetTypeID((__bridge CFTypeRef)m[@"complete"]) != CFBooleanGetTypeID()) return nil;
  NSDictionary *head = m[@"head"];
  if (![head isKindOfClass:NSDictionary.class] ||
      !ExactKeys(head, @[@"sequence", @"hash"]) ||
      !IsInteger(head[@"sequence"], 0, INT64_MAX) || !IsLowerHash(head[@"hash"])) return nil;
  NSArray *entryLengths = m[@"entryByteLengths"];
  NSUInteger count = [entryLengths isKindOfClass:NSArray.class] ? entryLengths.count : NSUIntegerMax;
  if (count > ANC_PV_BOOTSTRAP_PAGE_MAX_ENTRIES ||
      !BoundedLengths(entryLengths, kEntryMaximum, count) ||
      !BoundedLengths(m[@"entryRecoveryWrapByteLengths"], kWrapMaximum, count) ||
      !BoundedLengths(m[@"entryEvidenceByteLengths"], kEvidenceMaximum, count) ||
      ![m[@"entryEvidenceKinds"] isKindOfClass:NSArray.class] ||
      [m[@"entryEvidenceKinds"] count] != count ||
      !IsInteger(m[@"recoveryWrapByteLength"], 0, kWrapMaximum)) return nil;
  for (NSNumber *length in entryLengths) if (length.unsignedIntegerValue == 0) return nil;
  int64_t after = [m[@"afterSequence"] longLongValue];
  int64_t through = [m[@"throughSequence"] longLongValue];
  uint64_t headSequence = [head[@"sequence"] unsignedLongLongValue];
  BOOL complete = [m[@"complete"] boolValue];
  if (through != after + (int64_t)count || through > (int64_t)headSequence ||
      complete != (through == (int64_t)headSequence)) return nil;
  NSUInteger finalWrapLength = [m[@"recoveryWrapByteLength"] unsignedIntegerValue];
  id finalWrapHash = m[@"recoveryWrapHash"];
  if (complete != (finalWrapLength > 0 && IsLowerHash(finalWrapHash)) ||
      (!complete && finalWrapHash != NSNull.null)) return nil;

  NSUInteger offset = 4 + controlLength;
  NSMutableArray *entries = [NSMutableArray arrayWithCapacity:count];
  NSMutableArray *wraps = [NSMutableArray arrayWithCapacity:count];
  NSMutableArray *evidenceKinds = [NSMutableArray arrayWithCapacity:count];
  NSMutableArray *evidence = [NSMutableArray arrayWithCapacity:count];
  for (NSUInteger index = 0; index < count; index++) {
    NSUInteger lengths[3] = {
      [entryLengths[index] unsignedIntegerValue],
      [m[@"entryRecoveryWrapByteLengths"][index] unsignedIntegerValue],
      [m[@"entryEvidenceByteLengths"][index] unsignedIntegerValue],
    };
    id kind = m[@"entryEvidenceKinds"][index];
    BOOL validKind = kind == NSNull.null || [kind isEqual:@"genesis"] || [kind isEqual:@"recovery"];
    if (!validKind || ((kind == NSNull.null) != (lengths[2] == 0))) return nil;
    NSMutableArray *targets[3] = {entries, wraps, evidence};
    for (NSUInteger part = 0; part < 3; part++) {
      if (lengths[part] > encoded.length - offset) {
        Fail(status, AncPrivateVaultBootstrapFrameStatusBounds);
        return nil;
      }
      id value = lengths[part] == 0 ? NSNull.null :
        [encoded subdataWithRange:NSMakeRange(offset, lengths[part])];
      [targets[part] addObject:value];
      offset += lengths[part];
    }
    [evidenceKinds addObject:kind];
  }
  if (finalWrapLength > encoded.length - offset ||
      offset + finalWrapLength != encoded.length) {
    Fail(status, AncPrivateVaultBootstrapFrameStatusBounds);
    return nil;
  }
  AncPrivateVaultBootstrapFrame *result =
      [[AncPrivateVaultBootstrapFrame alloc] initPrivate];
  result.vaultId = m[@"vaultId"];
  result.afterSequence = after;
  result.throughSequence = through;
  result.headSequence = headSequence;
  result.headHash = head[@"hash"];
  result.complete = complete;
  result.entries = entries;
  result.entryRecoveryWraps = wraps;
  result.entryEvidenceKinds = evidenceKinds;
  result.entryEvidence = evidence;
  result.recoveryWrapHash = complete ? finalWrapHash : nil;
  result.recoveryWrap = finalWrapLength == 0 ? nil :
    [encoded subdataWithRange:NSMakeRange(offset, finalWrapLength)];
  Fail(status, AncPrivateVaultBootstrapFrameStatusOK);
  return result;
}
