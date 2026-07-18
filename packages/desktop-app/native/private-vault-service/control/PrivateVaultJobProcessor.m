#import "PrivateVaultJobProcessor.h"

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
@end
@implementation AncPrivateVaultAuthorizedJob
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
                  result:(NSData **)result {
  if (result != NULL) *result = nil;
  if (payload == nil || vaultId.length != 32 || jobId.length != 16 ||
      jobHash.length != 32 || nowSeconds == 0 || nowSeconds > UINT64_MAX / 1000 ||
      !([state isEqualToString:@"completed"] ||
        [state isEqualToString:@"failed"]))
    return AncPrivateVaultJobProcessorStatusInvalid;
  __block AncPrivateVaultJobProcessorStatus status =
      AncPrivateVaultJobProcessorStatusUnauthorized;
  __block NSData *sealed = nil;
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
          uint8_t envelopeId[16] = {0}, nonce[24] = {0};
          BOOL keys = anc_pv_ed25519_seed_keypair(
                          signPublic, signPrivate, secrets->signing_seed) ==
                          ANC_PV_CRYPTO_OK &&
              anc_pv_box_seed_keypair(boxPublic, boxPrivate,
                                      secrets->box_seed) == ANC_PV_CRYPTO_OK &&
              anc_pv_memcmp(signPublic, broker.signingPublicKey.bytes, 32) == 0 &&
              anc_pv_memcmp(boxPublic, broker.keyAgreementPublicKey.bytes, 32) == 0 &&
              anc_pv_random(envelopeId, sizeof envelopeId) == ANC_PV_CRYPTO_OK &&
              anc_pv_random(nonce, sizeof nonce) == ANC_PV_CRYPTO_OK;
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
          anc_pv_zeroize(nonce, sizeof nonce);
          return sealed != nil;
        }];
    if (borrowed != AncPrivateVaultSessionStatusOK || sealed == nil) {
      status = AncPrivateVaultJobProcessorStatusCryptoFailed;
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
    } else {
      sealed = nil;
      status = AncPrivateVaultJobProcessorStatusStorageFailed;
    }
  });
  if (status == AncPrivateVaultJobProcessorStatusOK && result != NULL)
    *result = sealed;
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
          nowSeconds:(uint64_t)nowSeconds
              result:(AncPrivateVaultAuthorizedJob **)result {
  if (result != NULL) *result = nil;
  if (jobEnvelope.length == 0 || vaultId.length != 32 || jobId.length != 16 ||
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
    grantStatus = [_grantIndex
        claimJobId:jobId jobHash:openedJobHash grantRef:coordinates.grantRef
             vaultId:vaultId nowSeconds:nowSeconds
    expiresAtSeconds:coordinates.expiresAt
    subjectAccountId:grant.subjectAccountId
    subjectEndpointId:grant.subjectEndpointId
       subjectAgentId:grant.subjectAgentId
    requesterSigningPublicKey:requester.signingPublicKey
        requesterBoxPublicKey:requester.keyAgreementPublicKey
                 resourceId:resourceId operation:operation provider:provider];
    if (grantStatus == AncPrivateVaultGrantIndexStatusOK) {
      authorizedJob = [AncPrivateVaultAuthorizedJob new];
      authorizedJob.body = semanticBody;
      authorizedJob.jobHash = openedJobHash;
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

@end
