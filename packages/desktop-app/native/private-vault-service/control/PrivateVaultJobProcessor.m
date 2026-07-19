#import "PrivateVaultJobProcessor.h"

#import "PrivateVaultAncCanonical.h"

#include <string.h>

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultJobProcessorAfterSpoolFaultHook gAfterSpoolFaultHook;
void AncPrivateVaultJobProcessorSetAfterSpoolFaultHookForTesting(
    AncPrivateVaultJobProcessorAfterSpoolFaultHook hook) {
  gAfterSpoolFaultHook = [hook copy];
}
#endif

static NSString *HexIdentifier(NSData *bytes) {
  if (bytes.length != 16) return nil;
  NSMutableString *value = [NSMutableString stringWithCapacity:32];
  const uint8_t *raw = bytes.bytes;
  for (NSUInteger index = 0; index < bytes.length; index += 1)
    [value appendFormat:@"%02x", raw[index]];
  return value;
}

static NSData *HexBytes(NSString *value) {
  if (value.length != 32) return nil;
  NSMutableData *bytes = [NSMutableData dataWithLength:16];
  for (NSUInteger index = 0; index < 16; index += 1) {
    unsigned int byte = 0;
    NSScanner *scanner = [NSScanner scannerWithString:
        [value substringWithRange:NSMakeRange(index * 2, 2)]];
    if (![scanner scanHexInt:&byte] || !scanner.isAtEnd) return nil;
    ((uint8_t *)bytes.mutableBytes)[index] = (uint8_t)byte;
  }
  return bytes;
}

static AncPrivateVaultCanonicalValue *JobField(
    NSDictionary *map, NSInteger key, AncPrivateVaultCanonicalType type) {
  AncPrivateVaultCanonicalValue *value = map[@(key)];
  return value != nil && value.type == type ? value : nil;
}

static BOOL LowerHexText(NSString *value, NSUInteger length) {
  if (![value isKindOfClass:NSString.class] || value.length != length)
    return NO;
  const char *bytes = value.UTF8String;
  if (bytes == NULL || strlen(bytes) != length) return NO;
  for (NSUInteger index = 0; index < length; index += 1)
    if (!((bytes[index] >= '0' && bytes[index] <= '9') ||
          (bytes[index] >= 'a' && bytes[index] <= 'f')))
      return NO;
  return YES;
}

static BOOL BrokerPath(NSString *value) {
  static NSSet<NSString *> *paths;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    paths = [NSSet setWithArray:@[
      @"/api/private-vault/jobs/broker/claim",
      @"/api/private-vault/jobs/broker/request",
      @"/api/private-vault/jobs/broker/ack",
      @"/api/private-vault/jobs/broker/retry",
      @"/api/private-vault/jobs/broker/result",
      @"/api/private-vault/jobs/broker/disclosure",
    ]];
  });
  return [paths containsObject:value];
}

static BOOL EndpointProofTimestamp(NSString *value) {
  if (![value isKindOfClass:NSString.class] || value.length != 24) return NO;
  static NSRegularExpression *pattern;
  static NSISO8601DateFormatter *formatter;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    pattern = [NSRegularExpression
        regularExpressionWithPattern:
            @"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:"
             "[0-9]{2}\\.[0-9]{3}Z$"
                             options:0
                               error:nil];
    formatter = [NSISO8601DateFormatter new];
    formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                              NSISO8601DateFormatWithFractionalSeconds;
  });
  return [pattern firstMatchInString:value
                             options:0
                               range:NSMakeRange(0, value.length)] != nil &&
         [formatter dateFromString:value] != nil;
}

static NSData *ResultEnvelopeHash(NSData *envelope) {
  if (envelope.length == 0) return nil;
  static const uint8_t domain[] = "anc/v1/result-envelope";
  uint8_t hash[32] = {0};
  BOOL okay = anc_pv_blake2b_256_two_part(
      hash, domain, sizeof domain, envelope.bytes, envelope.length) ==
      ANC_PV_CRYPTO_OK;
  NSData *result = okay ? [NSData dataWithBytes:hash length:sizeof hash] : nil;
  anc_pv_zeroize(hash, sizeof hash);
  return result;
}

@interface AncPrivateVaultAuthorizedJob ()
@property(nonatomic) NSData *body;
@property(nonatomic) NSData *jobHash;
@property(nonatomic) NSData *resourceId;
@property(nonatomic) NSString *operation;
@end
@implementation AncPrivateVaultAuthorizedJob
@end

static BOOL IsContentActionName(NSString *value) {
  if (![value isKindOfClass:NSString.class] || value.length == 0 ||
      value.length > 120)
    return NO;
  const char *bytes = value.UTF8String;
  if (bytes == NULL || strlen(bytes) != value.length || bytes[0] < 'a' ||
      bytes[0] > 'z')
    return NO;
  for (NSUInteger index = 1; index < value.length; index += 1) {
    const char byte = bytes[index];
    if (!((byte >= 'a' && byte <= 'z') || (byte >= '0' && byte <= '9') ||
          byte == '-'))
      return NO;
  }
  return YES;
}

@interface AncPrivateVaultPendingResult ()
@property(nonatomic) NSData *jobId;
@property(nonatomic) NSData *jobHash;
@property(nonatomic) NSString *state;
@property(nonatomic) uint64_t epoch;
@property(nonatomic) uint64_t retryCount;
@property(nonatomic) NSString *algorithmId;
@property(nonatomic) NSData *resultEnvelope;
@property(nonatomic) NSData *disclosureEnvelope;
@property(nonatomic) NSData *disclosureId;
@property(nonatomic) NSData *grantId;
@property(nonatomic) NSData *grantRef;
@property(nonatomic) NSData *resourceId;
@property(nonatomic) NSString *operation;
@property(nonatomic) NSString *providerId;
@property(nonatomic) NSString *destination;
@property(nonatomic) NSData *scopeHash;
@property(nonatomic) uint64_t issuedAt;
@property(nonatomic) uint64_t expiresAt;
@end
@implementation AncPrivateVaultPendingResult
@end

@interface AncPrivateVaultSealedResult ()
@property(nonatomic) NSData *resultEnvelope;
@property(nonatomic) NSData *disclosureEnvelope;
@property(nonatomic) NSData *disclosureId;
@property(nonatomic) NSData *grantRef;
@property(nonatomic) NSString *providerId;
@property(nonatomic) NSString *destination;
@property(nonatomic) NSData *scopeHash;
@property(nonatomic) uint64_t issuedAt;
@property(nonatomic) uint64_t expiresAt;
@end
@implementation AncPrivateVaultSealedResult
@end

@implementation AncPrivateVaultJobProcessor {
  AncPrivateVaultSession *_session;
  AncPrivateVaultAuthorityStore *_authorityStore;
  AncPrivateVaultGrantIndex *_grantIndex;
  AncPrivateVaultResultSpool *_resultSpool;
  dispatch_queue_t _queue;
}

- (AncPrivateVaultJobProcessorStatus)
    sealResultPayload:(NSData *)payload
                 state:(NSString *)state
               vaultId:(NSString *)vaultId
                  jobId:(NSData *)jobId
                 jobHash:(NSData *)jobHash
              nowSeconds:(uint64_t)nowSeconds
                  result:(AncPrivateVaultSealedResult **)result {
  if (result != NULL) *result = nil;
  if (payload == nil || vaultId.length != 32 || jobId.length != 16 ||
      jobHash.length != 32 || nowSeconds == 0 || nowSeconds > UINT64_MAX / 1000 ||
      !([state isEqualToString:@"completed"] ||
        [state isEqualToString:@"failed"]))
    return AncPrivateVaultJobProcessorStatusInvalid;
  __block AncPrivateVaultJobProcessorStatus status =
      AncPrivateVaultJobProcessorStatusUnauthorized;
  __block NSData *sealed = nil;
  __block AncPrivateVaultSealedResult *sealedResult = nil;
  dispatch_sync(_queue, ^{
    AncPrivateVaultJobContext *job = nil;
    AncPrivateVaultGrantIndexStatus indexStatus =
        [_grantIndex resolveJobId:jobId jobHash:jobHash vaultId:vaultId
                          context:&job];
    if (indexStatus != AncPrivateVaultGrantIndexStatusOK || job == nil) return;
    AncPrivateVaultAuthorityCheckpoint *checkpoint = nil;
    if ([_authorityStore loadVaultId:vaultId checkpoint:&checkpoint error:nil] !=
            AncPrivateVaultAuthorityStoreStatusOK || checkpoint == nil) {
      status = AncPrivateVaultJobProcessorStatusStorageFailed;
      return;
    }
    uint64_t nowMs = nowSeconds * 1000;
    if (checkpoint.snapshot.verifiedAtMs > nowMs ||
        nowMs - checkpoint.snapshot.verifiedAtMs > 15 * 60 * 1000) {
      status = AncPrivateVaultJobProcessorStatusStaleAuthority;
      return;
    }
    AncPrivateVaultAuthorityMember *broker = nil;
    for (AncPrivateVaultAuthorityMember *member in checkpoint.snapshot.activeMembers)
      if ([member.role isEqualToString:@"broker"] && member.unattended) {
        if (broker != nil) return;
        broker = member;
      }
    NSData *vaultBytes = HexBytes(vaultId);
    NSString *recipientId = HexIdentifier(job.subjectEndpointId);
    AncPrivateVaultAuthorityMember *recipient = nil;
    for (AncPrivateVaultAuthorityMember *member in checkpoint.snapshot.activeMembers)
      if ([member.endpointId isEqualToString:recipientId]) recipient = member;
    if (broker == nil || recipient == nil || vaultBytes == nil ||
        broker.signingPublicKey.length != 32 ||
        broker.keyAgreementPublicKey.length != 32 ||
        ![recipient.role isEqualToString:@"endpoint"] ||
        ![recipient.keyAgreementPublicKey isEqualToData:job.requesterBoxPublicKey])
      return;
    if (job.grantRef.length != 32 || job.resourceId.length != 16 ||
        job.disclosureProviderId.length == 0 ||
        job.disclosureDestination.length == 0) return;
    NSData *scopeHash = AncPrivateVaultDisclosureScopeHash(
        job.resourceId, job.operation);
    if (scopeHash.length != 32) return;
    __block NSData *disclosure = [job.disclosureEnvelope copy];
    __block AncPrivateVaultVerifiedDisclosure *verifiedDisclosure = nil;
    if (disclosure != nil) {
      AncPrivateVaultDisclosureCodecStatus disclosureStatus;
      verifiedDisclosure = AncPrivateVaultVerifyDisclosureEnvelope(
          disclosure, vaultBytes, job.grantRef, nowSeconds,
          broker.signingPublicKey.bytes, &disclosureStatus);
      if (verifiedDisclosure == nil ||
          ![verifiedDisclosure.providerId
              isEqualToString:job.disclosureProviderId] ||
          ![verifiedDisclosure.destination
              isEqualToString:job.disclosureDestination] ||
          ![verifiedDisclosure.scopeHash isEqualToData:scopeHash]) {
        status = AncPrivateVaultJobProcessorStatusStorageFailed;
        return;
      }
    }
    AncPrivateVaultResultSpoolStatus spoolStatus =
        [_resultSpool loadEnvelopeForVaultId:vaultBytes jobId:jobId
                                      result:&sealed];
    if (spoolStatus == AncPrivateVaultResultSpoolStatusOK) {
      AncPrivateVaultJobCodecStatus codecStatus;
      AncPrivateVaultVerifiedResult *verified =
          AncPrivateVaultVerifyResultEnvelope(
              sealed, vaultBytes, jobId, jobHash, job.subjectEndpointId,
              broker.signingPublicKey.bytes, &codecStatus);
      NSData *sealedHash = ResultEnvelopeHash(sealed);
      if (verified == nil || ![verified.state isEqualToString:state] ||
          sealedHash == nil ||
          (job.resultRecorded &&
           (![job.resultState isEqualToString:verified.state] ||
            ![job.resultHash isEqualToData:sealedHash]))) {
        sealed = nil;
        status = AncPrivateVaultJobProcessorStatusStorageFailed;
        return;
      }
      if (!job.resultRecorded) {
        indexStatus = [_grantIndex recordResultHash:sealedHash
                                             state:verified.state
                                             jobId:jobId jobHash:jobHash
                                            vaultId:vaultId];
        if (indexStatus != AncPrivateVaultGrantIndexStatusOK) {
          sealed = nil;
          status = AncPrivateVaultJobProcessorStatusStorageFailed;
          return;
        }
      }
      status = AncPrivateVaultJobProcessorStatusOK;
      sealedResult = [AncPrivateVaultSealedResult new];
      sealedResult.resultEnvelope = sealed;
      sealedResult.disclosureEnvelope = disclosure;
      sealedResult.disclosureId = verifiedDisclosure.disclosureId;
      sealedResult.grantRef = verifiedDisclosure.grantRef;
      sealedResult.providerId = verifiedDisclosure.providerId;
      sealedResult.destination = verifiedDisclosure.destination;
      sealedResult.scopeHash = verifiedDisclosure.scopeHash;
      sealedResult.issuedAt = verifiedDisclosure.issuedAt;
      sealedResult.expiresAt = verifiedDisclosure.expiresAt;
      return;
    }
    if (spoolStatus != AncPrivateVaultResultSpoolStatusNotFound ||
        job.resultRecorded) {
      sealed = nil;
      status = AncPrivateVaultJobProcessorStatusStorageFailed;
      return;
    }
    AncPrivateVaultSessionStatus borrowed = [_session borrowVaultId:vaultId
        block:^BOOL(const AncPrivateVaultCustodySnapshot *snapshot,
                    const AncPrivateVaultCustodySecretInputs *secrets) {
          NSString *local = [[NSString alloc]
              initWithBytes:snapshot->endpoint_id
                     length:snapshot->endpoint_id_length
                   encoding:NSUTF8StringEncoding];
          if (snapshot->role != ANC_PV_CUSTODY_ROLE_BROKER ||
              ![local isEqualToString:broker.endpointId] ||
              secrets->signing_seed == NULL || secrets->box_seed == NULL)
            return NO;
          uint8_t signPublic[32] = {0}, signPrivate[64] = {0};
          uint8_t boxPublic[32] = {0}, boxPrivate[32] = {0};
          uint8_t envelopeId[16] = {0}, disclosureId[16] = {0}, nonce[24] = {0};
          BOOL keys = anc_pv_ed25519_seed_keypair(
                          signPublic, signPrivate, secrets->signing_seed) ==
                          ANC_PV_CRYPTO_OK &&
              anc_pv_box_seed_keypair(boxPublic, boxPrivate,
                                      secrets->box_seed) == ANC_PV_CRYPTO_OK &&
              anc_pv_memcmp(signPublic, broker.signingPublicKey.bytes, 32) == 0 &&
              anc_pv_memcmp(boxPublic, broker.keyAgreementPublicKey.bytes, 32) == 0 &&
              anc_pv_random(envelopeId, sizeof envelopeId) == ANC_PV_CRYPTO_OK &&
              anc_pv_random(disclosureId, sizeof disclosureId) ==
                  ANC_PV_CRYPTO_OK &&
              anc_pv_random(nonce, sizeof nonce) == ANC_PV_CRYPTO_OK;
          uint64_t disclosureExpiresAt = nowSeconds + 15 * 60;
          if (disclosureExpiresAt > job.expiresAt)
            disclosureExpiresAt = job.expiresAt;
          AncPrivateVaultDisclosureCodecStatus disclosureStatus;
          if (keys && disclosure == nil && disclosureExpiresAt > nowSeconds) {
            disclosure = AncPrivateVaultSealDisclosureEnvelope(
                vaultBytes,
                [NSData dataWithBytes:disclosureId length:sizeof disclosureId],
                nowSeconds, job.grantRef, job.disclosureProviderId,
                job.disclosureDestination, scopeHash, nowSeconds,
                disclosureExpiresAt, secrets->signing_seed,
                &disclosureStatus);
          }
          AncPrivateVaultJobCodecStatus codecStatus;
          sealed = keys ? AncPrivateVaultSealResultEnvelope(
              vaultBytes, [NSData dataWithBytes:envelopeId length:sizeof envelopeId],
              nowSeconds, jobId, jobHash, job.subjectEndpointId, state, payload,
              [NSData dataWithBytes:nonce length:sizeof nonce],
              secrets->signing_seed, boxPrivate,
              recipient.keyAgreementPublicKey.bytes, &codecStatus) : nil;
          anc_pv_zeroize(signPublic, sizeof signPublic);
          anc_pv_zeroize(signPrivate, sizeof signPrivate);
          anc_pv_zeroize(boxPublic, sizeof boxPublic);
          anc_pv_zeroize(boxPrivate, sizeof boxPrivate);
          anc_pv_zeroize(envelopeId, sizeof envelopeId);
          anc_pv_zeroize(disclosureId, sizeof disclosureId);
          anc_pv_zeroize(nonce, sizeof nonce);
          return sealed != nil && disclosure != nil;
        }];
    if (borrowed != AncPrivateVaultSessionStatusOK || sealed == nil ||
        disclosure == nil) {
      status = AncPrivateVaultJobProcessorStatusCryptoFailed;
      return;
    }
    AncPrivateVaultDisclosureCodecStatus disclosureStatus;
    verifiedDisclosure = AncPrivateVaultVerifyDisclosureEnvelope(
        disclosure, vaultBytes, job.grantRef, nowSeconds,
        broker.signingPublicKey.bytes, &disclosureStatus);
    if (verifiedDisclosure == nil ||
        ![verifiedDisclosure.providerId
            isEqualToString:job.disclosureProviderId] ||
        ![verifiedDisclosure.destination
            isEqualToString:job.disclosureDestination] ||
        ![verifiedDisclosure.scopeHash isEqualToData:scopeHash]) {
      sealed = nil;
      status = AncPrivateVaultJobProcessorStatusCryptoFailed;
      return;
    }
    indexStatus = [_grantIndex stageDisclosureEnvelope:disclosure
                                                jobId:jobId
                                               jobHash:jobHash
                                               vaultId:vaultId];
    if (indexStatus != AncPrivateVaultGrantIndexStatusOK) {
      sealed = nil;
      status = AncPrivateVaultJobProcessorStatusStorageFailed;
      return;
    }
    spoolStatus = [_resultSpool storeEnvelope:sealed vaultId:vaultBytes
                                         jobId:jobId];
    if (spoolStatus != AncPrivateVaultResultSpoolStatusOK) {
      sealed = nil;
      status = AncPrivateVaultJobProcessorStatusStorageFailed;
      return;
    }
#if ANC_PRIVATE_VAULT_TESTING
    if (gAfterSpoolFaultHook != nil && gAfterSpoolFaultHook()) {
      sealed = nil;
      status = AncPrivateVaultJobProcessorStatusStorageFailed;
      return;
    }
#endif
    NSData *resultHash = ResultEnvelopeHash(sealed);
    if (resultHash == nil) {
      sealed = nil;
      status = AncPrivateVaultJobProcessorStatusCryptoFailed;
      return;
    }
    indexStatus = [_grantIndex recordResultHash:resultHash state:state jobId:jobId
                                        jobHash:jobHash vaultId:vaultId];
    if (indexStatus == AncPrivateVaultGrantIndexStatusOK) {
      status = AncPrivateVaultJobProcessorStatusOK;
      sealedResult = [AncPrivateVaultSealedResult new];
      sealedResult.resultEnvelope = sealed;
      sealedResult.disclosureEnvelope = disclosure;
      sealedResult.disclosureId = verifiedDisclosure.disclosureId;
      sealedResult.grantRef = verifiedDisclosure.grantRef;
      sealedResult.providerId = verifiedDisclosure.providerId;
      sealedResult.destination = verifiedDisclosure.destination;
      sealedResult.scopeHash = verifiedDisclosure.scopeHash;
      sealedResult.issuedAt = verifiedDisclosure.issuedAt;
      sealedResult.expiresAt = verifiedDisclosure.expiresAt;
    } else {
      sealed = nil;
      status = AncPrivateVaultJobProcessorStatusStorageFailed;
    }
  });
  if (status == AncPrivateVaultJobProcessorStatusOK && result != NULL)
    *result = sealedResult;
  return status;
}

- (AncPrivateVaultJobProcessorStatus)
    acknowledgeHostedResultForVaultId:(NSString *)vaultId
                                  jobId:(NSData *)jobId
                                 jobHash:(NSData *)jobHash
                                    state:(NSString *)state {
  if (vaultId.length != 32 || jobId.length != 16 || jobHash.length != 32 ||
      !([state isEqualToString:@"completed"] ||
        [state isEqualToString:@"failed"]))
    return AncPrivateVaultJobProcessorStatusInvalid;
  __block AncPrivateVaultJobProcessorStatus status =
      AncPrivateVaultJobProcessorStatusUnauthorized;
  dispatch_sync(_queue, ^{
    AncPrivateVaultJobContext *job = nil;
    AncPrivateVaultGrantIndexStatus indexStatus =
        [_grantIndex resolveJobId:jobId jobHash:jobHash vaultId:vaultId
                          context:&job];
    if (indexStatus != AncPrivateVaultGrantIndexStatusOK || job == nil ||
        !job.resultRecorded || ![job.resultState isEqualToString:state] ||
        job.resultHash.length != 32)
      return;
    NSData *vaultBytes = HexBytes(vaultId);
    NSData *envelope = nil;
    AncPrivateVaultResultSpoolStatus spoolStatus = vaultBytes == nil
        ? AncPrivateVaultResultSpoolStatusInvalid
        : [_resultSpool loadEnvelopeForVaultId:vaultBytes jobId:jobId
                                        result:&envelope];
    if (job.receiptAcknowledged &&
        spoolStatus == AncPrivateVaultResultSpoolStatusNotFound) {
      status = AncPrivateVaultJobProcessorStatusOK;
      return;
    }
    NSData *resultHash = envelope == nil ? nil : ResultEnvelopeHash(envelope);
    if (spoolStatus != AncPrivateVaultResultSpoolStatusOK ||
        resultHash == nil || ![resultHash isEqualToData:job.resultHash]) {
      status = AncPrivateVaultJobProcessorStatusStorageFailed;
      return;
    }
    if (!job.receiptAcknowledged) {
      indexStatus = [_grantIndex acknowledgeResultHash:resultHash state:state
                                                 jobId:jobId jobHash:jobHash
                                                vaultId:vaultId];
      if (indexStatus != AncPrivateVaultGrantIndexStatusOK) {
        status = AncPrivateVaultJobProcessorStatusStorageFailed;
        return;
      }
    }
    spoolStatus = [_resultSpool deleteEnvelope:envelope vaultId:vaultBytes
                                          jobId:jobId];
    status = spoolStatus == AncPrivateVaultResultSpoolStatusOK
        ? AncPrivateVaultJobProcessorStatusOK
        : AncPrivateVaultJobProcessorStatusStorageFailed;
  });
  return status;
}

- (AncPrivateVaultJobProcessorStatus)
    recoverPendingHostedResultForVaultId:(NSString *)vaultId
                              nowSeconds:(uint64_t)nowSeconds
                                    result:(AncPrivateVaultPendingResult **)result {
  if (result != NULL) *result = nil;
  if (vaultId.length != 32)
    return AncPrivateVaultJobProcessorStatusInvalid;
  __block AncPrivateVaultJobProcessorStatus status =
      AncPrivateVaultJobProcessorStatusStorageFailed;
  __block AncPrivateVaultPendingResult *pending = nil;
  dispatch_sync(_queue, ^{
    AncPrivateVaultJobContext *job = nil;
    AncPrivateVaultGrantIndexStatus indexStatus =
        [_grantIndex nextPendingResultForVaultId:vaultId context:&job];
    if (indexStatus == AncPrivateVaultGrantIndexStatusNotFound) {
      status = AncPrivateVaultJobProcessorStatusOK;
      return;
    }
    NSData *vaultBytes = HexBytes(vaultId);
    if (indexStatus != AncPrivateVaultGrantIndexStatusOK || job == nil ||
        vaultBytes == nil || job.jobId.length != 16 ||
        job.jobHash.length != 32 || job.resultHash.length != 32 ||
        job.resultState == nil || job.hostedEpoch == 0 ||
        job.hostedRetryCount > 100 || job.hostedAlgorithmId.length == 0 ||
        job.grantRef.length != 32 || job.resourceId.length != 16 ||
        job.operation.length == 0 || job.disclosureEnvelope.length == 0 ||
        job.disclosureProviderId.length == 0 ||
        job.disclosureDestination.length == 0) {
      return;
    }
    AncPrivateVaultAuthorityCheckpoint *checkpoint = nil;
    if ([_authorityStore loadVaultId:vaultId checkpoint:&checkpoint error:nil] !=
            AncPrivateVaultAuthorityStoreStatusOK || checkpoint == nil)
      return;
    uint64_t nowMs = nowSeconds * 1000;
    if (checkpoint.snapshot.verifiedAtMs > nowMs ||
        nowMs - checkpoint.snapshot.verifiedAtMs > 15 * 60 * 1000)
      return;
    AncPrivateVaultAuthorityMember *broker = nil;
    for (AncPrivateVaultAuthorityMember *member in checkpoint.snapshot.activeMembers)
      if ([member.role isEqualToString:@"broker"] && member.unattended) {
        if (broker != nil) return;
        broker = member;
      }
    if (broker.signingPublicKey.length != 32) return;
    AncPrivateVaultRevocableGrantContext *grant = nil;
    indexStatus = [_grantIndex resolveGrantForRevocationRef:job.grantRef
                                                    vaultId:vaultId
                                                    context:&grant];
    if (indexStatus != AncPrivateVaultGrantIndexStatusOK || grant == nil ||
        grant.grant.grantId.length != 16)
      return;
    NSData *scopeHash = AncPrivateVaultDisclosureScopeHash(
        job.resourceId, job.operation);
    AncPrivateVaultDisclosureCodecStatus disclosureStatus;
    AncPrivateVaultVerifiedDisclosure *disclosure =
        scopeHash.length == 32
            ? AncPrivateVaultVerifyDisclosureEnvelope(
                  job.disclosureEnvelope, vaultBytes, job.grantRef, nowSeconds,
                  broker.signingPublicKey.bytes, &disclosureStatus)
            : nil;
    if (disclosure == nil ||
        ![disclosure.providerId isEqualToString:job.disclosureProviderId] ||
        ![disclosure.destination isEqualToString:job.disclosureDestination] ||
        ![disclosure.scopeHash isEqualToData:scopeHash])
      return;
    NSData *envelope = nil;
    AncPrivateVaultResultSpoolStatus spoolStatus =
        [_resultSpool loadEnvelopeForVaultId:vaultBytes jobId:job.jobId
                                      result:&envelope];
    NSData *hash = envelope == nil ? nil : ResultEnvelopeHash(envelope);
    if (spoolStatus != AncPrivateVaultResultSpoolStatusOK || hash == nil ||
        ![hash isEqualToData:job.resultHash])
      return;
    pending = [AncPrivateVaultPendingResult new];
    pending.jobId = [job.jobId copy];
    pending.jobHash = [job.jobHash copy];
    pending.state = [job.resultState copy];
    pending.epoch = job.hostedEpoch;
    pending.retryCount = job.hostedRetryCount;
    pending.algorithmId = [job.hostedAlgorithmId copy];
    pending.resultEnvelope = [envelope copy];
    pending.disclosureEnvelope = [job.disclosureEnvelope copy];
    pending.disclosureId = [disclosure.disclosureId copy];
    pending.grantId = [grant.grant.grantId copy];
    pending.grantRef = [job.grantRef copy];
    pending.resourceId = [job.resourceId copy];
    pending.operation = [job.operation copy];
    pending.providerId = [disclosure.providerId copy];
    pending.destination = [disclosure.destination copy];
    pending.scopeHash = [scopeHash copy];
    pending.issuedAt = disclosure.issuedAt;
    pending.expiresAt = disclosure.expiresAt;
    status = AncPrivateVaultJobProcessorStatusOK;
  });
  if (status == AncPrivateVaultJobProcessorStatusOK && result != NULL)
    *result = pending;
  return status;
}

- (instancetype)initWithSession:(AncPrivateVaultSession *)session
                  authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
                      grantIndex:(AncPrivateVaultGrantIndex *)grantIndex
                     resultSpool:(AncPrivateVaultResultSpool *)resultSpool {
  self = [super init];
  if (self == nil || session == nil || authorityStore == nil ||
      grantIndex == nil || resultSpool == nil)
    return nil;
  _session = session;
  _authorityStore = authorityStore;
  _grantIndex = grantIndex;
  _resultSpool = resultSpool;
  _queue = dispatch_queue_create("com.agentnative.private-vault.jobs",
                                 DISPATCH_QUEUE_SERIAL);
  return self;
}

- (AncPrivateVaultJobProcessorStatus)
    openJobEnvelope:(NSData *)jobEnvelope
            vaultId:(NSString *)vaultId
               jobId:(NSData *)jobId
          hostedEpoch:(uint64_t)hostedEpoch
     hostedRetryCount:(uint64_t)hostedRetryCount
     hostedAlgorithmId:(NSString *)hostedAlgorithmId
          nowSeconds:(uint64_t)nowSeconds
              result:(AncPrivateVaultAuthorizedJob **)result {
  if (result != NULL) *result = nil;
  if (jobEnvelope.length == 0 || vaultId.length != 32 || jobId.length != 16 ||
      hostedEpoch == 0 || hostedRetryCount > 100 ||
      hostedAlgorithmId.length == 0 || hostedAlgorithmId.length > 160 ||
      nowSeconds == 0 || nowSeconds > UINT64_MAX / 1000)
    return AncPrivateVaultJobProcessorStatusInvalid;
  __block AncPrivateVaultJobProcessorStatus status =
      AncPrivateVaultJobProcessorStatusUnauthorized;
  __block AncPrivateVaultAuthorizedJob *authorizedJob = nil;
  dispatch_sync(_queue, ^{
    NSData *vaultBytes = HexBytes(vaultId);
    AncPrivateVaultAuthorityCheckpoint *checkpoint = nil;
    if (vaultBytes == nil ||
        [_authorityStore loadVaultId:vaultId checkpoint:&checkpoint error:nil] !=
            AncPrivateVaultAuthorityStoreStatusOK || checkpoint == nil) {
      status = AncPrivateVaultJobProcessorStatusStorageFailed;
      return;
    }
    uint64_t nowMs = nowSeconds * 1000;
    if (checkpoint.snapshot.verifiedAtMs > nowMs ||
        nowMs - checkpoint.snapshot.verifiedAtMs > 15 * 60 * 1000) {
      status = AncPrivateVaultJobProcessorStatusStaleAuthority;
      return;
    }
    AncPrivateVaultAuthorityMember *broker = nil;
    NSUInteger unattendedBrokers = 0;
    for (AncPrivateVaultAuthorityMember *member in
         checkpoint.snapshot.activeMembers) {
      if ([member.role isEqualToString:@"broker"] && member.unattended) {
        unattendedBrokers += 1;
        broker = member;
      }
    }
    NSData *brokerEndpointBytes = HexBytes(broker.endpointId);
    if (unattendedBrokers != 1 || brokerEndpointBytes == nil ||
        broker.keyAgreementPublicKey.length != 32) {
      status = AncPrivateVaultJobProcessorStatusUnauthorized;
      return;
    }
    AncPrivateVaultJobCodecStatus codecStatus;
    AncPrivateVaultJobCoordinates *coordinates =
        AncPrivateVaultInspectJobEnvelope(jobEnvelope, vaultBytes, jobId,
                                          brokerEndpointBytes, &codecStatus);
    if (coordinates == nil || nowSeconds < coordinates.issuedAt ||
        nowSeconds > coordinates.expiresAt) {
      status = AncPrivateVaultJobProcessorStatusUnauthorized;
      return;
    }
    AncPrivateVaultGrantContext *grant = nil;
    AncPrivateVaultGrantIndexStatus grantStatus =
        [_grantIndex resolveGrantRef:coordinates.grantRef vaultId:vaultId
                          nowSeconds:nowSeconds context:&grant];
    if (grantStatus != AncPrivateVaultGrantIndexStatusOK || grant == nil) {
      status = grantStatus == AncPrivateVaultGrantIndexStatusStorageFailed ||
                       grantStatus == AncPrivateVaultGrantIndexStatusCorrupt ||
                       grantStatus == AncPrivateVaultGrantIndexStatusRollbackDetected
          ? AncPrivateVaultJobProcessorStatusStorageFailed
          : AncPrivateVaultJobProcessorStatusUnauthorized;
      return;
    }
    NSString *requesterId = HexIdentifier(grant.subjectEndpointId);
    AncPrivateVaultAuthorityMember *requester = nil;
    for (AncPrivateVaultAuthorityMember *member in
         checkpoint.snapshot.activeMembers)
      if ([member.endpointId isEqualToString:requesterId]) requester = member;
    if (requester == nil || ![requester.role isEqualToString:@"endpoint"] ||
        requester.signingPublicKey.length != 32 ||
        requester.keyAgreementPublicKey.length != 32) {
      status = AncPrivateVaultJobProcessorStatusUnauthorized;
      return;
    }
    __block NSMutableData *semanticBody = nil;
    __block NSData *openedJobHash = nil;
    __block NSData *resourceId = nil;
    __block NSString *operation = nil;
    __block NSString *provider = nil;
    __block NSString *disclosureProviderId = nil;
    __block NSString *disclosureDestination = nil;
    AncPrivateVaultSessionStatus borrowed = [_session borrowVaultId:vaultId
        block:^BOOL(const AncPrivateVaultCustodySnapshot *snapshot,
                    const AncPrivateVaultCustodySecretInputs *secrets) {
          AncPrivateVaultJobCodecStatus openStatus;
          if (snapshot == NULL || secrets == NULL || secrets->box_seed == NULL ||
              snapshot->role != ANC_PV_CUSTODY_ROLE_BROKER)
            return NO;
          NSString *localEndpoint = [[NSString alloc]
              initWithBytes:snapshot->endpoint_id
                     length:snapshot->endpoint_id_length
                   encoding:NSUTF8StringEncoding];
          if (![localEndpoint isEqualToString:broker.endpointId])
            return NO;
          uint8_t localPublic[32] = {0}, localPrivate[32] = {0};
          BOOL derived = anc_pv_box_seed_keypair(localPublic, localPrivate,
                                                 secrets->box_seed) ==
              ANC_PV_CRYPTO_OK;
          BOOL keyMatches = derived &&
              anc_pv_memcmp(localPublic, broker.keyAgreementPublicKey.bytes, 32) == 0 &&
              anc_pv_memcmp(localPublic, snapshot->box_public_key, 32) == 0;
          AncPrivateVaultOpenedJob *opened = keyMatches
              ? AncPrivateVaultOpenJobEnvelope(
                    jobEnvelope, vaultBytes, jobId, brokerEndpointBytes,
                    nowSeconds, requester.signingPublicKey.bytes,
                    requester.keyAgreementPublicKey.bytes, localPrivate,
                    &openStatus)
              : nil;
          anc_pv_zeroize(localPublic, sizeof localPublic);
          anc_pv_zeroize(localPrivate, sizeof localPrivate);
          if (opened == nil) return NO;
          AncPrivateVaultSemanticJobPayload *semantic =
              AncPrivateVaultDecodeSemanticJobPayload(opened.payload,
                                                      &openStatus);
          if (semantic == nil) {
            [opened close];
            return NO;
          }
          semanticBody = [semantic.body mutableCopy];
          openedJobHash = [opened.jobHash copy];
          resourceId = [semantic.resourceId copy];
          operation = [semantic.operation copy];
          provider = [semantic.provider copy];
          disclosureProviderId = [semantic.disclosureProviderId copy];
          disclosureDestination = [semantic.disclosureDestination copy];
          [opened close];
          return YES;
        }];
    if (borrowed != AncPrivateVaultSessionStatusOK || semanticBody == nil ||
        openedJobHash == nil) {
      status = borrowed == AncPrivateVaultSessionStatusOK
          ? AncPrivateVaultJobProcessorStatusCryptoFailed
          : AncPrivateVaultJobProcessorStatusLocked;
      return;
    }
    if (![provider isEqualToString:@"content"] ||
        !IsContentActionName(operation)) {
      anc_pv_zeroize(semanticBody.mutableBytes, semanticBody.length);
      status = AncPrivateVaultJobProcessorStatusUnauthorized;
      return;
    }
    grantStatus = [_grantIndex
        claimJobId:jobId jobHash:openedJobHash grantRef:coordinates.grantRef
             vaultId:vaultId nowSeconds:nowSeconds
    expiresAtSeconds:coordinates.expiresAt
    subjectAccountId:grant.subjectAccountId
    subjectEndpointId:grant.subjectEndpointId
       subjectAgentId:grant.subjectAgentId
    requesterSigningPublicKey:requester.signingPublicKey
        requesterBoxPublicKey:requester.keyAgreementPublicKey
                resourceId:resourceId operation:operation provider:provider
       disclosureProviderId:disclosureProviderId
       disclosureDestination:disclosureDestination
                hostedEpoch:hostedEpoch hostedRetryCount:hostedRetryCount
           hostedAlgorithmId:hostedAlgorithmId];
    if (grantStatus == AncPrivateVaultGrantIndexStatusOK) {
      authorizedJob = [AncPrivateVaultAuthorizedJob new];
      authorizedJob.body = semanticBody;
      authorizedJob.jobHash = openedJobHash;
      authorizedJob.resourceId = resourceId;
      authorizedJob.operation = operation;
      status = AncPrivateVaultJobProcessorStatusOK;
    } else {
      anc_pv_zeroize(semanticBody.mutableBytes, semanticBody.length);
      status = grantStatus == AncPrivateVaultGrantIndexStatusReplay
          ? AncPrivateVaultJobProcessorStatusReplay
          : grantStatus == AncPrivateVaultGrantIndexStatusStorageFailed ||
                    grantStatus == AncPrivateVaultGrantIndexStatusRollbackDetected ||
                    grantStatus == AncPrivateVaultGrantIndexStatusCorrupt
              ? AncPrivateVaultJobProcessorStatusStorageFailed
              : AncPrivateVaultJobProcessorStatusUnauthorized;
    }
  });
  if (status == AncPrivateVaultJobProcessorStatusOK && result != NULL)
    *result = authorizedJob;
  return status;
}

- (AncPrivateVaultJobProcessorStatus)
    signEndpointRequestProof:(NSData *)unsignedProof
                   nowSeconds:(uint64_t)nowSeconds
                       result:(NSData **)result {
  if (result != NULL) *result = nil;
  if (unsignedProof.length == 0 || unsignedProof.length > 64 * 1024 ||
      nowSeconds == 0 || nowSeconds > UINT64_MAX / 1000)
    return AncPrivateVaultJobProcessorStatusInvalid;
  __block AncPrivateVaultJobProcessorStatus status =
      AncPrivateVaultJobProcessorStatusUnauthorized;
  __block NSData *signatureResult = nil;
  dispatch_sync(_queue, ^{
    AncPrivateVaultCanonicalStatus canonicalStatus;
    AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
        unsignedProof, 64 * 1024, &canonicalStatus);
    NSDictionary *map = root.type == AncPrivateVaultCanonicalTypeMap
                            ? root.mapValue
                            : nil;
    NSSet *keys = [NSSet setWithArray:@[
      @1, @2, @3, @4, @5, @6, @7, @8, @9, @10
    ]];
    NSString *vaultId = JobField(map, 4, AncPrivateVaultCanonicalTypeText).textValue;
    NSString *endpointId =
        JobField(map, 5, AncPrivateVaultCanonicalTypeText).textValue;
    NSString *path = JobField(map, 7, AncPrivateVaultCanonicalTypeText).textValue;
    NSString *nonce = JobField(map, 10, AncPrivateVaultCanonicalTypeText).textValue;
    if (canonicalStatus != AncPrivateVaultCanonicalStatusOK ||
        map.count != keys.count ||
        ![keys isEqualToSet:[NSSet setWithArray:map.allKeys]] ||
        ![JobField(map, 1, AncPrivateVaultCanonicalTypeText).textValue
            isEqualToString:@"anc/v1"] ||
        JobField(map, 2, AncPrivateVaultCanonicalTypeInteger).integerValue != 1 ||
        ![JobField(map, 3, AncPrivateVaultCanonicalTypeText).textValue
            isEqualToString:@"endpoint_request"] ||
        !LowerHexText(vaultId, 32) || !LowerHexText(endpointId, 32) ||
        ![JobField(map, 6, AncPrivateVaultCanonicalTypeText).textValue
            isEqualToString:@"POST"] ||
        !BrokerPath(path) ||
        JobField(map, 8, AncPrivateVaultCanonicalTypeBytes).bytesValue.length != 32 ||
        !EndpointProofTimestamp(
            JobField(map, 9, AncPrivateVaultCanonicalTypeText).textValue) ||
        !LowerHexText(nonce, 32)) {
      status = AncPrivateVaultJobProcessorStatusInvalid;
      return;
    }
    AncPrivateVaultAuthorityCheckpoint *checkpoint = nil;
    if ([_authorityStore loadVaultId:vaultId checkpoint:&checkpoint error:nil] !=
            AncPrivateVaultAuthorityStoreStatusOK ||
        checkpoint == nil) {
      status = AncPrivateVaultJobProcessorStatusStorageFailed;
      return;
    }
    uint64_t nowMs = nowSeconds * 1000;
    if (checkpoint.snapshot.verifiedAtMs > nowMs ||
        nowMs - checkpoint.snapshot.verifiedAtMs > 15 * 60 * 1000) {
      status = AncPrivateVaultJobProcessorStatusStaleAuthority;
      return;
    }
    AncPrivateVaultAuthorityMember *broker = nil;
    NSUInteger count = 0;
    for (AncPrivateVaultAuthorityMember *member in
         checkpoint.snapshot.activeMembers) {
      if ([member.role isEqualToString:@"broker"] && member.unattended) {
        broker = member;
        count += 1;
      }
    }
    if (count != 1 || ![broker.endpointId isEqualToString:endpointId] ||
        broker.signingPublicKey.length != 32) {
      status = AncPrivateVaultJobProcessorStatusUnauthorized;
      return;
    }
    AncPrivateVaultSessionStatus borrowed = [_session borrowVaultId:vaultId
        block:^BOOL(const AncPrivateVaultCustodySnapshot *snapshot,
                    const AncPrivateVaultCustodySecretInputs *secrets) {
          if (snapshot == NULL || secrets == NULL ||
              secrets->signing_seed == NULL ||
              snapshot->role != ANC_PV_CUSTODY_ROLE_BROKER)
            return NO;
          NSString *localEndpoint = [[NSString alloc]
              initWithBytes:snapshot->endpoint_id
                     length:snapshot->endpoint_id_length
                   encoding:NSUTF8StringEncoding];
          if (![localEndpoint isEqualToString:endpointId]) return NO;
          uint8_t publicKey[32] = {0};
          uint8_t privateKey[64] = {0};
          uint8_t signature[64] = {0};
          BOOL keysMatch =
              anc_pv_ed25519_seed_keypair(publicKey, privateKey,
                                          secrets->signing_seed) ==
                  ANC_PV_CRYPTO_OK &&
              anc_pv_memcmp(publicKey, broker.signingPublicKey.bytes, 32) ==
                  ANC_PV_CRYPTO_OK &&
              anc_pv_memcmp(publicKey, snapshot->signing_public_key, 32) ==
                  ANC_PV_CRYPTO_OK;
          static const uint8_t domain[] = "anc/v1/endpoint-request";
          NSMutableData *message = [NSMutableData
              dataWithCapacity:sizeof domain + unsignedProof.length];
          [message appendBytes:domain length:sizeof domain];
          [message appendData:unsignedProof];
          BOOL signedValue = keysMatch &&
              anc_pv_ed25519_sign(signature, message.bytes, message.length,
                                  privateKey) == ANC_PV_CRYPTO_OK;
          if (signedValue)
            signatureResult = [NSData dataWithBytes:signature length:64];
          anc_pv_zeroize(publicKey, sizeof publicKey);
          anc_pv_zeroize(privateKey, sizeof privateKey);
          anc_pv_zeroize(signature, sizeof signature);
          return signedValue;
        }];
    status = borrowed == AncPrivateVaultSessionStatusOK &&
                     signatureResult.length == 64
                 ? AncPrivateVaultJobProcessorStatusOK
                 : AncPrivateVaultJobProcessorStatusLocked;
  });
  if (status == AncPrivateVaultJobProcessorStatusOK && result != NULL)
    *result = signatureResult;
  return status;
}

@end
