#import "PrivateVaultGrantIndex.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultGenerationFence.h"

#include <fcntl.h>
#include <dirent.h>
#include <errno.h>
#include <limits.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static const uint8_t kKeyDomain[] = "anc/v1/grant-index-key";
static const uint8_t kFrameDomain[] = "anc/v1/grant-index-frame";
static const uint8_t kDigestDomain[] = "anc/v1/grant-index-frame-digest";
static const NSUInteger kMaximumIndexBytes = 1024 * 1024;
static const NSUInteger kMaximumGrants = 256;
static const NSUInteger kMaximumRevocations = 256;
static const NSUInteger kMaximumJobs = 256;
static const NSUInteger kMaximumTemporaryFilesPerVault = 64;
static NSString *const kFenceRecordId = @"grant-index";

@interface AncStoredGrant : NSObject
@property(nonatomic) NSData *envelope;
@property(nonatomic) NSString *issuerControlEndpointId;
@property(nonatomic) NSData *issuerSigningPublicKey;
@property(nonatomic) AncPrivateVaultVerifiedGrant *verified;
@end
@implementation AncStoredGrant
@end

@interface AncStoredJob : NSObject
@property(nonatomic) NSData *jobId;
@property(nonatomic) NSData *jobHash;
@property(nonatomic) NSData *grantRef;
@property(nonatomic) uint64_t expiresAt;
@property(nonatomic) NSData *subjectAccountId;
@property(nonatomic) NSData *subjectEndpointId;
@property(nonatomic, nullable) NSData *subjectAgentId;
@property(nonatomic) NSData *requesterSigningPublicKey;
@property(nonatomic) NSData *requesterBoxPublicKey;
@property(nonatomic) NSData *resourceId;
@property(nonatomic) NSString *operation;
@property(nonatomic) NSString *provider;
@property(nonatomic) NSString *status;
@property(nonatomic, nullable) NSString *resultState;
@property(nonatomic, nullable) NSData *resultHash;
@end
@implementation AncStoredJob
@end

@interface AncGrantIndexRecord : NSObject
@property(nonatomic) NSData *vaultId;
@property(nonatomic) uint64_t generation;
@property(nonatomic) NSArray<AncStoredGrant *> *grants;
@property(nonatomic) NSArray<NSData *> *revocations;
@property(nonatomic) NSArray<AncStoredJob *> *jobs;
@end
@implementation AncGrantIndexRecord
@end

@interface AncPrivateVaultGrantIndexSnapshot ()
@property(nonatomic) uint64_t generation;
@property(nonatomic) NSUInteger grantCount;
@property(nonatomic) NSUInteger revocationCount;
@property(nonatomic) NSUInteger jobCount;
@end
@implementation AncPrivateVaultGrantIndexSnapshot
@end

@interface AncPrivateVaultGrantContext ()
@property(nonatomic) NSData *grantRef;
@property(nonatomic) NSData *subjectAccountId;
@property(nonatomic) NSData *subjectEndpointId;
@property(nonatomic, nullable) NSData *subjectAgentId;
@end
@implementation AncPrivateVaultGrantContext
@end

static BOOL ValidVaultId(NSString *vaultId, NSData **bytes) {
  if (vaultId.length != 32) return NO;
  NSMutableData *decoded = [NSMutableData dataWithLength:16];
  for (NSUInteger index = 0; index < 16; index += 1) {
    unichar high = [vaultId characterAtIndex:index * 2];
    unichar low = [vaultId characterAtIndex:index * 2 + 1];
    int h = high >= '0' && high <= '9' ? high - '0'
        : high >= 'a' && high <= 'f' ? high - 'a' + 10 : -1;
    int l = low >= '0' && low <= '9' ? low - '0'
        : low >= 'a' && low <= 'f' ? low - 'a' + 10 : -1;
    if (h < 0 || l < 0) return NO;
    ((uint8_t *)decoded.mutableBytes)[index] = (uint8_t)((h << 4) | l);
  }
  if (bytes != NULL) *bytes = decoded;
  return YES;
}

static BOOL ValidControlId(NSString *value) {
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

static NSData *FieldBytes(NSDictionary *map, NSInteger key, NSUInteger length) {
  AncPrivateVaultCanonicalValue *value = map[@(key)];
  return value.type == AncPrivateVaultCanonicalTypeBytes &&
          value.bytesValue.length == length
      ? value.bytesValue
      : nil;
}

static uint64_t FieldPositive(NSDictionary *map, NSInteger key) {
  AncPrivateVaultCanonicalValue *value = map[@(key)];
  return value.type == AncPrivateVaultCanonicalTypeInteger &&
          value.integerValue > 0
      ? (uint64_t)value.integerValue
      : 0;
}

static BOOL ValidScopeText(NSString *value) {
  NSData *bytes = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (bytes.length == 0 || bytes.length > 160) return NO;
  const uint8_t *raw = bytes.bytes;
  for (NSUInteger index = 0; index < bytes.length; index += 1)
    if (raw[index] < 0x21 || raw[index] > 0x7e) return NO;
  return YES;
}

static NSData *EnvelopeIssuerId(NSData *envelope) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root =
      AncPrivateVaultCanonicalDecode(envelope, 64 * 1024, &status);
  if (root.type != AncPrivateVaultCanonicalTypeMap) return nil;
  return FieldBytes(root.mapValue, 61, 16);
}

static NSData *RevocationGrantRef(NSData *envelope) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root =
      AncPrivateVaultCanonicalDecode(envelope, 64 * 1024, &status);
  if (root.type != AncPrivateVaultCanonicalTypeMap) return nil;
  return FieldBytes(root.mapValue, 72, 32);
}

static BOOL DeriveKey(NSData *vaultId, const uint8_t *localStateKey,
                      uint8_t key[32]) {
  NSMutableData *message =
      [NSMutableData dataWithBytes:kKeyDomain length:sizeof kKeyDomain];
  [message appendData:vaultId];
  return anc_pv_blake2b_256_keyed(key, message.bytes, message.length,
                                  localStateKey) == ANC_PV_CRYPTO_OK;
}

static NSData *AAD(NSData *vaultId, uint64_t generation) {
  NSMutableData *data =
      [NSMutableData dataWithBytes:kFrameDomain length:sizeof kFrameDomain];
  [data appendData:vaultId];
  uint64_t big = CFSwapInt64HostToBig(generation);
  [data appendBytes:&big length:sizeof big];
  return data;
}

static NSData *FrameDigest(NSData *frame) {
  uint8_t digest[32] = {0};
  if (anc_pv_blake2b_256_two_part(digest, kDigestDomain, sizeof kDigestDomain,
                                  frame.bytes, frame.length) !=
      ANC_PV_CRYPTO_OK)
    return nil;
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static NSData *EncodeRecord(AncGrantIndexRecord *record) {
  NSMutableArray *grants = [NSMutableArray array];
  for (AncStoredGrant *grant in record.grants) {
    [grants addObject:[AncPrivateVaultCanonicalValue array:@[
      [AncPrivateVaultCanonicalValue bytes:grant.envelope],
      [AncPrivateVaultCanonicalValue text:grant.issuerControlEndpointId],
      [AncPrivateVaultCanonicalValue bytes:grant.issuerSigningPublicKey],
    ]]];
  }
  NSMutableArray *revocations = [NSMutableArray array];
  for (NSData *revocation in record.revocations)
    [revocations addObject:[AncPrivateVaultCanonicalValue bytes:revocation]];
  NSMutableArray *jobs = [NSMutableArray array];
  for (AncStoredJob *job in record.jobs) {
    [jobs addObject:[AncPrivateVaultCanonicalValue array:@[
      [AncPrivateVaultCanonicalValue bytes:job.jobId],
      [AncPrivateVaultCanonicalValue bytes:job.jobHash],
      [AncPrivateVaultCanonicalValue bytes:job.grantRef],
      [AncPrivateVaultCanonicalValue integer:(int64_t)job.expiresAt],
      [AncPrivateVaultCanonicalValue bytes:job.subjectAccountId],
      [AncPrivateVaultCanonicalValue bytes:job.subjectEndpointId],
      job.subjectAgentId == nil ? [AncPrivateVaultCanonicalValue nullValue]
                                : [AncPrivateVaultCanonicalValue bytes:job.subjectAgentId],
      [AncPrivateVaultCanonicalValue bytes:job.requesterSigningPublicKey],
      [AncPrivateVaultCanonicalValue bytes:job.requesterBoxPublicKey],
      [AncPrivateVaultCanonicalValue bytes:job.resourceId],
      [AncPrivateVaultCanonicalValue text:job.operation],
      [AncPrivateVaultCanonicalValue text:job.provider],
      [AncPrivateVaultCanonicalValue text:job.status],
      job.resultState == nil ? [AncPrivateVaultCanonicalValue nullValue]
                             : [AncPrivateVaultCanonicalValue text:job.resultState],
      job.resultHash == nil ? [AncPrivateVaultCanonicalValue nullValue]
                            : [AncPrivateVaultCanonicalValue bytes:job.resultHash],
    ]]];
  }
  AncPrivateVaultCanonicalStatus status;
  return AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue bytes:record.vaultId],
        @3 : [AncPrivateVaultCanonicalValue integer:(int64_t)record.generation],
        @4 : [AncPrivateVaultCanonicalValue array:grants],
        @5 : [AncPrivateVaultCanonicalValue array:revocations],
        @6 : [AncPrivateVaultCanonicalValue array:jobs],
      }],
      &status);
}

static AncGrantIndexRecord *DecodeRecord(NSData *plaintext,
                                         NSData *expectedVaultId,
                                         uint64_t expectedGeneration) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      plaintext, kMaximumIndexBytes, &status);
  NSDictionary *map = root.type == AncPrivateVaultCanonicalTypeMap
      ? root.mapValue
      : nil;
  NSSet *legacyKeys = [NSSet setWithArray:@[@1, @2, @3, @4, @5]];
  NSSet *currentKeys = [NSSet setWithArray:@[@1, @2, @3, @4, @5, @6]];
  AncPrivateVaultCanonicalValue *grantsValue = map[@4];
  AncPrivateVaultCanonicalValue *revocationsValue = map[@5];
  AncPrivateVaultCanonicalValue *jobsValue = map[@6];
  NSSet *actualKeys = [NSSet setWithArray:map.allKeys];
  BOOL legacy = map.count == 5 && [legacyKeys isEqualToSet:actualKeys];
  BOOL current = map.count == 6 && [currentKeys isEqualToSet:actualKeys];
  if ((!legacy && !current) ||
      ![((AncPrivateVaultCanonicalValue *)map[@1]).textValue
          isEqualToString:@"anc/v1"] ||
      ![FieldBytes(map, 2, 16) isEqualToData:expectedVaultId] ||
      FieldPositive(map, 3) != expectedGeneration ||
      grantsValue.type != AncPrivateVaultCanonicalTypeArray ||
      grantsValue.arrayValue.count > kMaximumGrants ||
      revocationsValue.type != AncPrivateVaultCanonicalTypeArray ||
      revocationsValue.arrayValue.count > kMaximumRevocations ||
      (!legacy && (jobsValue.type != AncPrivateVaultCanonicalTypeArray ||
                   jobsValue.arrayValue.count > kMaximumJobs)))
    return nil;
  NSMutableArray<AncStoredGrant *> *grants = [NSMutableArray array];
  for (AncPrivateVaultCanonicalValue *item in grantsValue.arrayValue) {
    if (item.type != AncPrivateVaultCanonicalTypeArray ||
        item.arrayValue.count != 3)
      return nil;
    AncPrivateVaultCanonicalValue *envelope = item.arrayValue[0];
    AncPrivateVaultCanonicalValue *controlId = item.arrayValue[1];
    AncPrivateVaultCanonicalValue *publicKey = item.arrayValue[2];
    if (envelope.type != AncPrivateVaultCanonicalTypeBytes ||
        envelope.bytesValue.length == 0 || envelope.bytesValue.length > 64 * 1024 ||
        controlId.type != AncPrivateVaultCanonicalTypeText ||
        !ValidControlId(controlId.textValue) ||
        publicKey.type != AncPrivateVaultCanonicalTypeBytes ||
        publicKey.bytesValue.length != 32)
      return nil;
    NSData *issuerId = EnvelopeIssuerId(envelope.bytesValue);
    AncPrivateVaultGrantCodecStatus grantStatus;
    uint64_t issuedAt = 0;
    AncPrivateVaultCanonicalStatus grantCanonicalStatus;
    AncPrivateVaultCanonicalValue *grantRoot = AncPrivateVaultCanonicalDecode(
        envelope.bytesValue, 64 * 1024, &grantCanonicalStatus);
    if (grantRoot.type == AncPrivateVaultCanonicalTypeMap)
      issuedAt = FieldPositive(grantRoot.mapValue, 68);
    AncPrivateVaultVerifiedGrant *verified =
        issuerId == nil || issuedAt == 0
            ? nil
            : AncPrivateVaultVerifyGrantEnvelope(
                  envelope.bytesValue, expectedVaultId, issuedAt, issuerId,
                  publicKey.bytesValue.bytes, &grantStatus);
    if (verified == nil) return nil;
    AncStoredGrant *stored = [AncStoredGrant new];
    stored.envelope = [envelope.bytesValue copy];
    stored.issuerControlEndpointId = [controlId.textValue copy];
    stored.issuerSigningPublicKey = [publicKey.bytesValue copy];
    stored.verified = verified;
    [grants addObject:stored];
  }
  NSMutableArray<NSData *> *revocations = [NSMutableArray array];
  NSMutableSet<NSData *> *revokedRefs = [NSMutableSet set];
  for (AncPrivateVaultCanonicalValue *item in revocationsValue.arrayValue) {
    if (item.type != AncPrivateVaultCanonicalTypeBytes ||
        item.bytesValue.length == 0 || item.bytesValue.length > 64 * 1024)
      return nil;
    NSData *grantRef = RevocationGrantRef(item.bytesValue);
    AncStoredGrant *stored = nil;
    for (AncStoredGrant *candidate in grants)
      if ([candidate.verified.grantRef isEqualToData:grantRef]) stored = candidate;
    AncPrivateVaultGrantCodecStatus revokeStatus;
    if (stored == nil || [revokedRefs containsObject:grantRef] ||
        AncPrivateVaultVerifyGrantRevocationEnvelope(
            item.bytesValue, expectedVaultId, stored.verified,
            stored.issuerSigningPublicKey.bytes, &revokeStatus) == nil)
      return nil;
    [revokedRefs addObject:grantRef];
    [revocations addObject:[item.bytesValue copy]];
  }
  NSMutableArray<AncStoredJob *> *jobs = [NSMutableArray array];
  NSMutableSet<NSData *> *jobIds = [NSMutableSet set];
  for (AncPrivateVaultCanonicalValue *item in
       (legacy ? @[] : jobsValue.arrayValue)) {
    if (item.type != AncPrivateVaultCanonicalTypeArray ||
        item.arrayValue.count != 15)
      return nil;
    NSArray<AncPrivateVaultCanonicalValue *> *fields = item.arrayValue;
    AncPrivateVaultCanonicalValue *agent = fields[6];
    AncPrivateVaultCanonicalValue *resultState = fields[13];
    AncPrivateVaultCanonicalValue *resultHash = fields[14];
    BOOL agentValid = agent.type == AncPrivateVaultCanonicalTypeNull ||
        (agent.type == AncPrivateVaultCanonicalTypeBytes &&
         agent.bytesValue.length == 16);
    BOOL resultEmpty = resultState.type == AncPrivateVaultCanonicalTypeNull &&
        resultHash.type == AncPrivateVaultCanonicalTypeNull;
    BOOL resultPresent = resultState.type == AncPrivateVaultCanonicalTypeText &&
        ([resultState.textValue isEqualToString:@"completed"] ||
         [resultState.textValue isEqualToString:@"failed"]) &&
        resultHash.type == AncPrivateVaultCanonicalTypeBytes &&
        resultHash.bytesValue.length == 32;
    if (fields[0].type != AncPrivateVaultCanonicalTypeBytes ||
        fields[0].bytesValue.length != 16 ||
        [jobIds containsObject:fields[0].bytesValue] ||
        fields[1].type != AncPrivateVaultCanonicalTypeBytes ||
        fields[1].bytesValue.length != 32 ||
        fields[2].type != AncPrivateVaultCanonicalTypeBytes ||
        fields[2].bytesValue.length != 32 ||
        fields[3].type != AncPrivateVaultCanonicalTypeInteger ||
        fields[3].integerValue <= 0 ||
        fields[4].type != AncPrivateVaultCanonicalTypeBytes ||
        fields[4].bytesValue.length != 16 ||
        fields[5].type != AncPrivateVaultCanonicalTypeBytes ||
        fields[5].bytesValue.length != 16 || !agentValid ||
        fields[7].type != AncPrivateVaultCanonicalTypeBytes ||
        fields[7].bytesValue.length != 32 ||
        fields[8].type != AncPrivateVaultCanonicalTypeBytes ||
        fields[8].bytesValue.length != 32 ||
        fields[9].type != AncPrivateVaultCanonicalTypeBytes ||
        fields[9].bytesValue.length != 16 ||
        fields[10].type != AncPrivateVaultCanonicalTypeText ||
        !ValidScopeText(fields[10].textValue) ||
        fields[11].type != AncPrivateVaultCanonicalTypeText ||
        !ValidScopeText(fields[11].textValue) ||
        fields[12].type != AncPrivateVaultCanonicalTypeText ||
        !([fields[12].textValue isEqualToString:@"claimed"] ||
          [fields[12].textValue isEqualToString:@"result"]) ||
        ([fields[12].textValue isEqualToString:@"claimed"] && !resultEmpty) ||
        ([fields[12].textValue isEqualToString:@"result"] && !resultPresent))
      return nil;
    AncStoredJob *job = [AncStoredJob new];
    job.jobId = [fields[0].bytesValue copy];
    job.jobHash = [fields[1].bytesValue copy];
    job.grantRef = [fields[2].bytesValue copy];
    job.expiresAt = (uint64_t)fields[3].integerValue;
    job.subjectAccountId = [fields[4].bytesValue copy];
    job.subjectEndpointId = [fields[5].bytesValue copy];
    job.subjectAgentId = agent.type == AncPrivateVaultCanonicalTypeBytes
        ? [agent.bytesValue copy] : nil;
    job.requesterSigningPublicKey = [fields[7].bytesValue copy];
    job.requesterBoxPublicKey = [fields[8].bytesValue copy];
    job.resourceId = [fields[9].bytesValue copy];
    job.operation = [fields[10].textValue copy];
    job.provider = [fields[11].textValue copy];
    job.status = [fields[12].textValue copy];
    job.resultState = resultPresent ? [resultState.textValue copy] : nil;
    job.resultHash = resultPresent ? [resultHash.bytesValue copy] : nil;
    [jobIds addObject:job.jobId];
    [jobs addObject:job];
  }
  AncGrantIndexRecord *record = [AncGrantIndexRecord new];
  record.vaultId = [expectedVaultId copy];
  record.generation = expectedGeneration;
  record.grants = [grants copy];
  record.revocations = [revocations copy];
  record.jobs = [jobs copy];
  return record;
}

static NSData *SealRecord(AncGrantIndexRecord *record,
                          const uint8_t *localStateKey) {
  NSMutableData *plaintext = [EncodeRecord(record) mutableCopy];
  uint8_t key[32] = {0};
  NSMutableData *nonce = [NSMutableData dataWithLength:24];
  if (plaintext.length == 0 || plaintext.length > kMaximumIndexBytes) {
    anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
    return nil;
  }
  if (!DeriveKey(record.vaultId, localStateKey, key)) {
    anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
    return nil;
  }
  if (anc_pv_random(nonce.mutableBytes, nonce.length) != ANC_PV_CRYPTO_OK) {
    anc_pv_zeroize(key, sizeof key);
    anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
    return nil;
  }
  NSMutableData *ciphertext =
      [NSMutableData dataWithLength:plaintext.length + 16];
  size_t ciphertextLength = 0;
  NSData *aad = AAD(record.vaultId, record.generation);
  BOOL encrypted = anc_pv_xchacha20poly1305_encrypt(
          ciphertext.mutableBytes, ciphertext.length, &ciphertextLength,
          plaintext.bytes, plaintext.length, aad.bytes, aad.length, nonce.bytes,
          key) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(key, sizeof key);
  anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
  if (!encrypted)
    return nil;
  ciphertext.length = ciphertextLength;
  AncPrivateVaultCanonicalStatus status;
  NSData *frame = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue integer:1],
        @2 : [AncPrivateVaultCanonicalValue integer:(int64_t)record.generation],
        @3 : [AncPrivateVaultCanonicalValue bytes:nonce],
        @4 : [AncPrivateVaultCanonicalValue bytes:ciphertext],
      }],
      &status);
  return frame.length <= kMaximumIndexBytes + 1024 ? frame : nil;
}

static AncGrantIndexRecord *OpenFrame(NSData *frame, NSData *vaultId,
                                      uint64_t generation,
                                      const uint8_t *localStateKey) {
  if (frame.length == 0 || frame.length > kMaximumIndexBytes + 1024) return nil;
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      frame, kMaximumIndexBytes + 1024, &status);
  NSDictionary *map = root.type == AncPrivateVaultCanonicalTypeMap
      ? root.mapValue
      : nil;
  NSSet *keys = [NSSet setWithArray:@[@1, @2, @3, @4]];
  NSData *nonce = FieldBytes(map, 3, 24);
  AncPrivateVaultCanonicalValue *ciphertextValue = map[@4];
  NSData *ciphertext =
      ciphertextValue.type == AncPrivateVaultCanonicalTypeBytes
      ? ciphertextValue.bytesValue
      : nil;
  if (map.count != 4 ||
      ![keys isEqualToSet:[NSSet setWithArray:map.allKeys]] ||
      FieldPositive(map, 1) != 1 || FieldPositive(map, 2) != generation ||
      nonce == nil || ciphertext.length < 16 ||
      ciphertext.length > kMaximumIndexBytes + 16)
    return nil;
  uint8_t key[32] = {0};
  NSMutableData *plaintext =
      [NSMutableData dataWithLength:ciphertext.length - 16];
  size_t plaintextLength = 0;
  NSData *aad = AAD(vaultId, generation);
  BOOL decrypted = DeriveKey(vaultId, localStateKey, key) &&
      anc_pv_xchacha20poly1305_decrypt(
          plaintext.mutableBytes, plaintext.length, &plaintextLength,
          ciphertext.bytes, ciphertext.length, aad.bytes, aad.length,
          nonce.bytes, key) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(key, sizeof key);
  if (!decrypted) {
    anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
    return nil;
  }
  plaintext.length = plaintextLength;
  AncGrantIndexRecord *record = DecodeRecord(plaintext, vaultId, generation);
  anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
  return record;
}

static BOOL WriteAll(int fd, NSData *data) {
  const uint8_t *bytes = data.bytes;
  size_t remaining = data.length;
  while (remaining > 0) {
    ssize_t written = write(fd, bytes, remaining);
    if (written <= 0) return NO;
    bytes += written;
    remaining -= (size_t)written;
  }
  return fsync(fd) == 0;
}

static AncPrivateVaultGrantIndexStatus AuthorizeRecord(
    AncGrantIndexRecord *record, NSData *vaultBytes, NSData *grantRef,
    uint64_t nowSeconds, NSData *subjectAccountId, NSData *subjectEndpointId,
    NSData *subjectAgentId, NSData *resourceId, NSString *operation,
    NSString *provider) {
  for (NSData *revocation in record.revocations)
    if ([RevocationGrantRef(revocation) isEqualToData:grantRef])
      return AncPrivateVaultGrantIndexStatusUnauthorized;
  AncStoredGrant *stored = nil;
  for (AncStoredGrant *candidate in record.grants)
    if ([candidate.verified.grantRef isEqualToData:grantRef]) stored = candidate;
  if (stored == nil) return AncPrivateVaultGrantIndexStatusNotFound;
  AncPrivateVaultGrantCodecStatus codecStatus;
  AncPrivateVaultVerifiedGrant *verified = AncPrivateVaultVerifyGrantEnvelope(
      stored.envelope, vaultBytes, nowSeconds, stored.verified.issuerEndpointId,
      stored.issuerSigningPublicKey.bytes, &codecStatus);
  BOOL agentMatches =
      (verified.subjectAgentId == nil && subjectAgentId == nil) ||
      [verified.subjectAgentId isEqualToData:subjectAgentId];
  return verified != nil &&
          [verified.subjectAccountId isEqualToData:subjectAccountId] &&
          [verified.subjectEndpointId isEqualToData:subjectEndpointId] &&
          agentMatches && [verified.resourceIds containsObject:resourceId] &&
          [verified.operations containsObject:operation] &&
          [verified.providers containsObject:provider]
      ? AncPrivateVaultGrantIndexStatusOK
      : AncPrivateVaultGrantIndexStatusUnauthorized;
}

@implementation AncPrivateVaultGrantIndex {
  AncPrivateVaultSession *_session;
  AncPrivateVaultGenerationFence *_fence;
  dispatch_queue_t _queue;
  int _directoryFD;
}

- (instancetype)initWithStateRootURL:(NSURL *)stateRootURL
                             session:(AncPrivateVaultSession *)session
                            keychain:(AncPrivateVaultKeychain *)keychain {
  self = [super init];
  if (self == nil || !stateRootURL.isFileURL || session == nil || keychain == nil)
    return nil;
  int root = open(stateRootURL.fileSystemRepresentation,
                  O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0) return nil;
  if (mkdirat(root, "grant-index", 0700) != 0 && errno != EEXIST) {
    close(root);
    return nil;
  }
  int directory =
      openat(root, "grant-index", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  close(root);
  struct stat info;
  if (directory < 0 || fstat(directory, &info) != 0 ||
      !S_ISDIR(info.st_mode) || info.st_uid != geteuid() ||
      (info.st_mode & 0777) != 0700 || info.st_nlink < 2) {
    if (directory >= 0) close(directory);
    return nil;
  }
  _directoryFD = directory;
  _session = session;
  _fence = [[AncPrivateVaultGenerationFence alloc] initWithKeychain:keychain];
  _queue = dispatch_queue_create(
      "com.agentnative.private-vault.grant-index", DISPATCH_QUEUE_SERIAL);
  return self;
}

- (void)dealloc {
  if (_directoryFD >= 0) close(_directoryFD);
}

- (NSString *)nameForVault:(NSString *)vaultId suffix:(NSString *)suffix {
  return [NSString stringWithFormat:@"%@.%@", vaultId, suffix];
}

- (NSData *)readName:(NSString *)name present:(BOOL *)present {
  if (present != NULL) *present = NO;
  int fd = openat(_directoryFD, name.UTF8String,
                  O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return errno == ENOENT ? [NSData data] : nil;
  struct stat info;
  if (fstat(fd, &info) != 0 || !S_ISREG(info.st_mode) ||
      info.st_uid != geteuid() || info.st_nlink != 1 ||
      (info.st_mode & 0777) != 0600 || info.st_size <= 0 ||
      info.st_size > (off_t)(kMaximumIndexBytes + 1024)) {
    close(fd);
    return nil;
  }
  NSMutableData *data = [NSMutableData dataWithLength:(NSUInteger)info.st_size];
  uint8_t *cursor = data.mutableBytes;
  size_t remaining = data.length;
  while (remaining > 0) {
    ssize_t count = read(fd, cursor, remaining);
    if (count <= 0) {
      close(fd);
      return nil;
    }
    cursor += count;
    remaining -= (size_t)count;
  }
  close(fd);
  if (present != NULL) *present = YES;
  return data;
}

- (BOOL)writeStage:(NSData *)frame vaultId:(NSString *)vaultId {
  uint8_t random[8] = {0};
  if (anc_pv_random(random, sizeof random) != ANC_PV_CRYPTO_OK) return NO;
  uint64_t randomValue = 0;
  memcpy(&randomValue, random, sizeof randomValue);
  NSString *temporary = [NSString stringWithFormat:
      @"%@.tmp.%016llx", vaultId,
      (unsigned long long)CFSwapInt64BigToHost(randomValue)];
  anc_pv_zeroize(random, sizeof random);
  randomValue = 0;
  int fd = openat(_directoryFD, temporary.UTF8String,
                  O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) return NO;
  BOOL wrote = WriteAll(fd, frame);
  close(fd);
  NSString *stage = [self nameForVault:vaultId suffix:@"stage"];
  if (!wrote || renameat(_directoryFD, temporary.UTF8String, _directoryFD,
                         stage.UTF8String) != 0 ||
      fsync(_directoryFD) != 0) {
    unlinkat(_directoryFD, temporary.UTF8String, 0);
    return NO;
  }
  return YES;
}

- (BOOL)removeTemporaryFilesForVaultId:(NSString *)vaultId {
  NSString *prefix = [vaultId stringByAppendingString:@".tmp."];
  int duplicate = dup(_directoryFD);
  if (duplicate < 0) return NO;
  DIR *directory = fdopendir(duplicate);
  if (directory == NULL) {
    close(duplicate);
    return NO;
  }
  NSUInteger matched = 0;
  BOOL removed = NO;
  BOOL valid = YES;
  struct dirent *entry = NULL;
  while ((entry = readdir(directory)) != NULL) {
    NSString *name = [NSString stringWithUTF8String:entry->d_name];
    if (name == nil || ![name hasPrefix:prefix]) continue;
    matched += 1;
    if (matched > kMaximumTemporaryFilesPerVault ||
        unlinkat(_directoryFD, entry->d_name, 0) != 0) {
      valid = NO;
      break;
    }
    removed = YES;
  }
  closedir(directory);
  return valid && (!removed || fsync(_directoryFD) == 0);
}

- (BOOL)promoteVaultId:(NSString *)vaultId {
  NSString *stage = [self nameForVault:vaultId suffix:@"stage"];
  NSString *live = [self nameForVault:vaultId suffix:@"live"];
  return renameat(_directoryFD, stage.UTF8String, _directoryFD,
                  live.UTF8String) == 0 && fsync(_directoryFD) == 0;
}

- (AncPrivateVaultGrantIndexStatus)
    loadLockedVaultId:(NSString *)vaultId
            vaultBytes:(NSData *)vaultBytes
         localStateKey:(const uint8_t *)localStateKey
                record:(AncGrantIndexRecord **)outRecord {
  *outRecord = nil;
  if (![self removeTemporaryFilesForVaultId:vaultId])
    return AncPrivateVaultGrantIndexStatusStorageFailed;
  AncPrivateVaultFenceSnapshot *fence = nil;
  AncPrivateVaultFenceStatus fenceStatus =
      [_fence readVaultId:vaultId recordId:kFenceRecordId snapshot:&fence];
  if (fenceStatus != AncPrivateVaultFenceStatusOK)
    return fenceStatus == AncPrivateVaultFenceStatusRollbackDetected
        ? AncPrivateVaultGrantIndexStatusRollbackDetected
        : AncPrivateVaultGrantIndexStatusStorageFailed;
  BOOL livePresent = NO, stagePresent = NO;
  NSData *live = [self readName:[self nameForVault:vaultId suffix:@"live"]
                         present:&livePresent];
  NSData *stage = [self readName:[self nameForVault:vaultId suffix:@"stage"]
                          present:&stagePresent];
  if (live == nil || stage == nil) return AncPrivateVaultGrantIndexStatusCorrupt;
  if (fence.state == AncPrivateVaultFenceStateAbsent) {
    if (livePresent)
      return AncPrivateVaultGrantIndexStatusRollbackDetected;
    if (stagePresent) {
      NSString *stageName = [self nameForVault:vaultId suffix:@"stage"];
      if (unlinkat(_directoryFD, stageName.UTF8String, 0) != 0 ||
          fsync(_directoryFD) != 0)
        return AncPrivateVaultGrantIndexStatusStorageFailed;
    }
    AncGrantIndexRecord *empty = [AncGrantIndexRecord new];
    empty.vaultId = vaultBytes;
    empty.generation = 0;
    empty.grants = @[];
    empty.revocations = @[];
    empty.jobs = @[];
    *outRecord = empty;
    return AncPrivateVaultGrantIndexStatusOK;
  }
  NSData *candidate = nil;
  if (fence.state == AncPrivateVaultFenceStatePending) {
    if (stagePresent && [[FrameDigest(stage) copy] isEqualToData:fence.recordDigest]) {
      candidate = stage;
      if (![self promoteVaultId:vaultId])
        return AncPrivateVaultGrantIndexStatusStorageFailed;
      live = candidate;
      livePresent = YES;
      stagePresent = NO;
    } else if (livePresent &&
               [[FrameDigest(live) copy] isEqualToData:fence.recordDigest]) {
      candidate = live;
    } else {
      return AncPrivateVaultGrantIndexStatusRollbackDetected;
    }
    if ([_fence commitGeneration:fence.generation
                    recordDigest:fence.recordDigest
                         vaultId:vaultId
                        recordId:kFenceRecordId] !=
        AncPrivateVaultFenceStatusOK)
      return AncPrivateVaultGrantIndexStatusStorageFailed;
  } else {
    if (!livePresent ||
        ![FrameDigest(live) isEqualToData:fence.recordDigest])
      return AncPrivateVaultGrantIndexStatusRollbackDetected;
    candidate = live;
    if (stagePresent) {
      NSString *stageName = [self nameForVault:vaultId suffix:@"stage"];
      if (unlinkat(_directoryFD, stageName.UTF8String, 0) != 0 ||
          fsync(_directoryFD) != 0)
        return AncPrivateVaultGrantIndexStatusStorageFailed;
    }
  }
  AncGrantIndexRecord *record = OpenFrame(candidate, vaultBytes,
                                           fence.generation, localStateKey);
  if (record == nil) return AncPrivateVaultGrantIndexStatusCorrupt;
  *outRecord = record;
  return AncPrivateVaultGrantIndexStatusOK;
}

- (AncPrivateVaultGrantIndexStatus)
    commitLockedRecord:(AncGrantIndexRecord *)record
               vaultId:(NSString *)vaultId
         localStateKey:(const uint8_t *)localStateKey {
  NSData *frame = SealRecord(record, localStateKey);
  if (frame == nil) return AncPrivateVaultGrantIndexStatusStorageFailed;
  NSData *digest = FrameDigest(frame);
  if (digest == nil || ![self writeStage:frame vaultId:vaultId])
    return AncPrivateVaultGrantIndexStatusStorageFailed;
  if ([_fence beginGeneration:record.generation
                  recordDigest:digest
                       vaultId:vaultId
                      recordId:kFenceRecordId] !=
      AncPrivateVaultFenceStatusOK)
    return AncPrivateVaultGrantIndexStatusStorageFailed;
  if (![self promoteVaultId:vaultId])
    return AncPrivateVaultGrantIndexStatusStorageFailed;
  BOOL present = NO;
  NSData *readback = [self readName:[self nameForVault:vaultId suffix:@"live"]
                             present:&present];
  if (!present || ![FrameDigest(readback) isEqualToData:digest])
    return AncPrivateVaultGrantIndexStatusStorageFailed;
  if ([_fence commitGeneration:record.generation
                  recordDigest:digest
                       vaultId:vaultId
                      recordId:kFenceRecordId] !=
      AncPrivateVaultFenceStatusOK)
    return AncPrivateVaultGrantIndexStatusStorageFailed;
  return AncPrivateVaultGrantIndexStatusOK;
}

- (AncPrivateVaultGrantIndexStatus)
    withVaultId:(NSString *)vaultId
           block:(AncPrivateVaultGrantIndexStatus (^)(NSData *,
                   const uint8_t *, AncGrantIndexRecord *))block {
  NSData *vaultBytes = nil;
  if (!ValidVaultId(vaultId, &vaultBytes) || block == nil)
    return AncPrivateVaultGrantIndexStatusInvalid;
  __block AncPrivateVaultGrantIndexStatus result =
      AncPrivateVaultGrantIndexStatusCustodyUnavailable;
  AncPrivateVaultSessionStatus borrowed = [_session borrowVaultId:vaultId
      block:^BOOL(const AncPrivateVaultCustodySnapshot *snapshot,
                  const AncPrivateVaultCustodySecretInputs *secrets) {
        if (snapshot == NULL || secrets == NULL ||
            secrets->local_state_key == NULL)
          return NO;
        AncGrantIndexRecord *record = nil;
        result = [self loadLockedVaultId:vaultId vaultBytes:vaultBytes
                           localStateKey:secrets->local_state_key record:&record];
        if (result == AncPrivateVaultGrantIndexStatusOK)
          result = block(vaultBytes, secrets->local_state_key, record);
        return YES;
      }];
  return borrowed == AncPrivateVaultSessionStatusOK
      ? result
      : AncPrivateVaultGrantIndexStatusCustodyUnavailable;
}

- (AncPrivateVaultGrantIndexStatus)
    loadVaultId:(NSString *)vaultId
       snapshot:(AncPrivateVaultGrantIndexSnapshot **)snapshot {
  if (snapshot != NULL) *snapshot = nil;
  __block AncPrivateVaultGrantIndexSnapshot *value = nil;
  __block AncPrivateVaultGrantIndexStatus status;
  dispatch_sync(_queue, ^{
    status = [self withVaultId:vaultId
        block:^AncPrivateVaultGrantIndexStatus(
            NSData *vaultBytes, const uint8_t *key, AncGrantIndexRecord *record) {
          (void)vaultBytes;
          (void)key;
          value = [AncPrivateVaultGrantIndexSnapshot new];
          value.generation = record.generation;
          value.grantCount = record.grants.count;
          value.revocationCount = record.revocations.count;
          value.jobCount = record.jobs.count;
          return AncPrivateVaultGrantIndexStatusOK;
        }];
  });
  if (status == AncPrivateVaultGrantIndexStatusOK && snapshot != NULL)
    *snapshot = value;
  return status;
}

- (AncPrivateVaultGrantIndexStatus)
    storeGrantEnvelope:(NSData *)grantEnvelope
               vaultId:(NSString *)vaultId
            nowSeconds:(uint64_t)nowSeconds
       issuerEndpointId:(NSData *)issuerEndpointId
 issuerControlEndpointId:(NSString *)issuerControlEndpointId
issuerSigningPublicKey:(NSData *)issuerSigningPublicKey {
  if (grantEnvelope.length == 0 || issuerEndpointId.length != 16 ||
      issuerSigningPublicKey.length != 32 ||
      !ValidControlId(issuerControlEndpointId))
    return AncPrivateVaultGrantIndexStatusInvalid;
  __block AncPrivateVaultGrantIndexStatus status;
  dispatch_sync(_queue, ^{
    status = [self withVaultId:vaultId
        block:^AncPrivateVaultGrantIndexStatus(
            NSData *vaultBytes, const uint8_t *key, AncGrantIndexRecord *record) {
          AncPrivateVaultGrantCodecStatus codecStatus;
          AncPrivateVaultVerifiedGrant *verified =
              AncPrivateVaultVerifyGrantEnvelope(
                  grantEnvelope, vaultBytes, nowSeconds, issuerEndpointId,
                  issuerSigningPublicKey.bytes, &codecStatus);
          if (verified == nil) return AncPrivateVaultGrantIndexStatusUnauthorized;
          for (AncStoredGrant *existing in record.grants) {
            if ([existing.verified.grantRef isEqualToData:verified.grantRef]) {
              return [existing.envelope isEqualToData:grantEnvelope] &&
                      [existing.issuerControlEndpointId
                          isEqualToString:issuerControlEndpointId] &&
                      [existing.issuerSigningPublicKey
                          isEqualToData:issuerSigningPublicKey]
                  ? AncPrivateVaultGrantIndexStatusOK
                  : AncPrivateVaultGrantIndexStatusConflict;
            }
          }
          if (record.grants.count >= kMaximumGrants)
            return AncPrivateVaultGrantIndexStatusConflict;
          if (record.generation >= INT64_MAX)
            return AncPrivateVaultGrantIndexStatusConflict;
          AncStoredGrant *stored = [AncStoredGrant new];
          stored.envelope = [grantEnvelope copy];
          stored.issuerControlEndpointId = [issuerControlEndpointId copy];
          stored.issuerSigningPublicKey = [issuerSigningPublicKey copy];
          stored.verified = verified;
          record.grants = [record.grants arrayByAddingObject:stored];
          record.generation += 1;
          return [self commitLockedRecord:record vaultId:vaultId
                             localStateKey:key];
        }];
  });
  return status;
}

- (AncPrivateVaultGrantIndexStatus)
    applyRevocationEnvelope:(NSData *)revocationEnvelope
                    vaultId:(NSString *)vaultId
    signerControlEndpointId:(NSString *)signerControlEndpointId
     signerSigningPublicKey:(NSData *)signerSigningPublicKey {
  if (revocationEnvelope.length == 0 || signerSigningPublicKey.length != 32 ||
      !ValidControlId(signerControlEndpointId))
    return AncPrivateVaultGrantIndexStatusInvalid;
  __block AncPrivateVaultGrantIndexStatus status;
  dispatch_sync(_queue, ^{
    status = [self withVaultId:vaultId
        block:^AncPrivateVaultGrantIndexStatus(
            NSData *vaultBytes, const uint8_t *key, AncGrantIndexRecord *record) {
          NSData *grantRef = RevocationGrantRef(revocationEnvelope);
          AncStoredGrant *stored = nil;
          for (AncStoredGrant *candidate in record.grants)
            if ([candidate.verified.grantRef isEqualToData:grantRef]) stored = candidate;
          if (stored == nil) return AncPrivateVaultGrantIndexStatusNotFound;
          if (![stored.issuerControlEndpointId
                  isEqualToString:signerControlEndpointId] ||
              ![stored.issuerSigningPublicKey
                  isEqualToData:signerSigningPublicKey])
            return AncPrivateVaultGrantIndexStatusUnauthorized;
          AncPrivateVaultGrantCodecStatus codecStatus;
          if (AncPrivateVaultVerifyGrantRevocationEnvelope(
                  revocationEnvelope, vaultBytes, stored.verified,
                  signerSigningPublicKey.bytes, &codecStatus) == nil)
            return AncPrivateVaultGrantIndexStatusUnauthorized;
          for (NSData *existing in record.revocations) {
            NSData *existingRef = RevocationGrantRef(existing);
            if ([existingRef isEqualToData:grantRef])
              return [existing isEqualToData:revocationEnvelope]
                  ? AncPrivateVaultGrantIndexStatusOK
                  : AncPrivateVaultGrantIndexStatusConflict;
          }
          if (record.revocations.count >= kMaximumRevocations)
            return AncPrivateVaultGrantIndexStatusConflict;
          if (record.generation >= INT64_MAX)
            return AncPrivateVaultGrantIndexStatusConflict;
          record.revocations =
              [record.revocations arrayByAddingObject:[revocationEnvelope copy]];
          record.generation += 1;
          return [self commitLockedRecord:record vaultId:vaultId
                             localStateKey:key];
        }];
  });
  return status;
}

- (AncPrivateVaultGrantIndexStatus)
    authorizeGrantRef:(NSData *)grantRef
              vaultId:(NSString *)vaultId
           nowSeconds:(uint64_t)nowSeconds
     subjectAccountId:(NSData *)subjectAccountId
    subjectEndpointId:(NSData *)subjectEndpointId
       subjectAgentId:(NSData *)subjectAgentId
           resourceId:(NSData *)resourceId
            operation:(NSString *)operation
             provider:(NSString *)provider {
  if (grantRef.length != 32 || subjectAccountId.length != 16 ||
      subjectEndpointId.length != 16 ||
      (subjectAgentId != nil && subjectAgentId.length != 16) ||
      resourceId.length != 16 || operation.length == 0 || provider.length == 0)
    return AncPrivateVaultGrantIndexStatusInvalid;
  __block AncPrivateVaultGrantIndexStatus status;
  dispatch_sync(_queue, ^{
    status = [self withVaultId:vaultId
        block:^AncPrivateVaultGrantIndexStatus(
            NSData *vaultBytes, const uint8_t *key, AncGrantIndexRecord *record) {
          (void)key;
          return AuthorizeRecord(record, vaultBytes, grantRef, nowSeconds,
                                 subjectAccountId, subjectEndpointId,
                                 subjectAgentId, resourceId, operation,
                                 provider);
        }];
  });
  return status;
}

- (AncPrivateVaultGrantIndexStatus)
    resolveGrantRef:(NSData *)grantRef
            vaultId:(NSString *)vaultId
         nowSeconds:(uint64_t)nowSeconds
            context:(AncPrivateVaultGrantContext **)context {
  if (context != NULL) *context = nil;
  if (grantRef.length != 32 || nowSeconds == 0)
    return AncPrivateVaultGrantIndexStatusInvalid;
  __block AncPrivateVaultGrantContext *resolved = nil;
  __block AncPrivateVaultGrantIndexStatus status;
  dispatch_sync(_queue, ^{
    status = [self withVaultId:vaultId
        block:^AncPrivateVaultGrantIndexStatus(
            NSData *vaultBytes, const uint8_t *key, AncGrantIndexRecord *record) {
          (void)key;
          for (NSData *revocation in record.revocations)
            if ([RevocationGrantRef(revocation) isEqualToData:grantRef])
              return AncPrivateVaultGrantIndexStatusUnauthorized;
          AncStoredGrant *stored = nil;
          for (AncStoredGrant *candidate in record.grants)
            if ([candidate.verified.grantRef isEqualToData:grantRef])
              stored = candidate;
          if (stored == nil) return AncPrivateVaultGrantIndexStatusNotFound;
          AncPrivateVaultGrantCodecStatus codecStatus;
          AncPrivateVaultVerifiedGrant *verified =
              AncPrivateVaultVerifyGrantEnvelope(
                  stored.envelope, vaultBytes, nowSeconds,
                  stored.verified.issuerEndpointId,
                  stored.issuerSigningPublicKey.bytes, &codecStatus);
          if (verified == nil)
            return AncPrivateVaultGrantIndexStatusUnauthorized;
          resolved = [AncPrivateVaultGrantContext new];
          resolved.grantRef = [verified.grantRef copy];
          resolved.subjectAccountId = [verified.subjectAccountId copy];
          resolved.subjectEndpointId = [verified.subjectEndpointId copy];
          resolved.subjectAgentId = [verified.subjectAgentId copy];
          return AncPrivateVaultGrantIndexStatusOK;
        }];
  });
  if (status == AncPrivateVaultGrantIndexStatusOK && context != NULL)
    *context = resolved;
  return status;
}

- (AncPrivateVaultGrantIndexStatus)
    claimJobId:(NSData *)jobId
        jobHash:(NSData *)jobHash
        grantRef:(NSData *)grantRef
         vaultId:(NSString *)vaultId
      nowSeconds:(uint64_t)nowSeconds
  expiresAtSeconds:(uint64_t)expiresAtSeconds
subjectAccountId:(NSData *)subjectAccountId
subjectEndpointId:(NSData *)subjectEndpointId
   subjectAgentId:(NSData *)subjectAgentId
requesterSigningPublicKey:(NSData *)requesterSigningPublicKey
 requesterBoxPublicKey:(NSData *)requesterBoxPublicKey
       resourceId:(NSData *)resourceId
        operation:(NSString *)operation
         provider:(NSString *)provider {
  if (jobId.length != 16 || jobHash.length != 32 || grantRef.length != 32 ||
      nowSeconds == 0 || expiresAtSeconds <= nowSeconds ||
      expiresAtSeconds > INT64_MAX || subjectAccountId.length != 16 ||
      subjectEndpointId.length != 16 ||
      (subjectAgentId != nil && subjectAgentId.length != 16) ||
      requesterSigningPublicKey.length != 32 ||
      requesterBoxPublicKey.length != 32 || resourceId.length != 16 ||
      !ValidScopeText(operation) || !ValidScopeText(provider))
    return AncPrivateVaultGrantIndexStatusInvalid;
  __block AncPrivateVaultGrantIndexStatus status;
  dispatch_sync(_queue, ^{
    status = [self withVaultId:vaultId
        block:^AncPrivateVaultGrantIndexStatus(
            NSData *vaultBytes, const uint8_t *key, AncGrantIndexRecord *record) {
          NSMutableArray<AncStoredJob *> *unexpired = [NSMutableArray array];
          for (AncStoredJob *job in record.jobs) {
            if (job.expiresAt >= nowSeconds) {
              if ([job.jobId isEqualToData:jobId])
                return AncPrivateVaultGrantIndexStatusReplay;
              [unexpired addObject:job];
            }
          }
          AncPrivateVaultGrantIndexStatus authorized = AuthorizeRecord(
              record, vaultBytes, grantRef, nowSeconds, subjectAccountId,
              subjectEndpointId, subjectAgentId, resourceId, operation,
              provider);
          if (authorized != AncPrivateVaultGrantIndexStatusOK)
            return authorized;
          if (unexpired.count >= kMaximumJobs || record.generation >= INT64_MAX)
            return AncPrivateVaultGrantIndexStatusConflict;
          AncStoredJob *job = [AncStoredJob new];
          job.jobId = [jobId copy];
          job.jobHash = [jobHash copy];
          job.grantRef = [grantRef copy];
          job.expiresAt = expiresAtSeconds;
          job.subjectAccountId = [subjectAccountId copy];
          job.subjectEndpointId = [subjectEndpointId copy];
          job.subjectAgentId = [subjectAgentId copy];
          job.requesterSigningPublicKey = [requesterSigningPublicKey copy];
          job.requesterBoxPublicKey = [requesterBoxPublicKey copy];
          job.resourceId = [resourceId copy];
          job.operation = [operation copy];
          job.provider = [provider copy];
          job.status = @"claimed";
          job.resultState = nil;
          job.resultHash = nil;
          [unexpired addObject:job];
          record.jobs = [unexpired copy];
          record.generation += 1;
          return [self commitLockedRecord:record vaultId:vaultId
                             localStateKey:key];
        }];
  });
  return status;
}

- (AncPrivateVaultGrantIndexStatus)
    recordResultHash:(NSData *)resultHash
               state:(NSString *)state
               jobId:(NSData *)jobId
              jobHash:(NSData *)jobHash
               vaultId:(NSString *)vaultId {
  if (resultHash.length != 32 || jobId.length != 16 || jobHash.length != 32 ||
      !([state isEqualToString:@"completed"] ||
        [state isEqualToString:@"failed"]))
    return AncPrivateVaultGrantIndexStatusInvalid;
  __block AncPrivateVaultGrantIndexStatus status;
  dispatch_sync(_queue, ^{
    status = [self withVaultId:vaultId
        block:^AncPrivateVaultGrantIndexStatus(
            NSData *vaultBytes, const uint8_t *key, AncGrantIndexRecord *record) {
          (void)vaultBytes;
          AncStoredJob *job = nil;
          for (AncStoredJob *candidate in record.jobs)
            if ([candidate.jobId isEqualToData:jobId]) job = candidate;
          if (job == nil) return AncPrivateVaultGrantIndexStatusNotFound;
          if (![job.jobHash isEqualToData:jobHash])
            return AncPrivateVaultGrantIndexStatusConflict;
          if ([job.status isEqualToString:@"result"])
            return [job.resultState isEqualToString:state] &&
                    [job.resultHash isEqualToData:resultHash]
                ? AncPrivateVaultGrantIndexStatusOK
                : AncPrivateVaultGrantIndexStatusConflict;
          if (![job.status isEqualToString:@"claimed"] ||
              record.generation >= INT64_MAX)
            return AncPrivateVaultGrantIndexStatusConflict;
          job.status = @"result";
          job.resultState = [state copy];
          job.resultHash = [resultHash copy];
          record.generation += 1;
          return [self commitLockedRecord:record vaultId:vaultId
                             localStateKey:key];
        }];
  });
  return status;
}

@end
