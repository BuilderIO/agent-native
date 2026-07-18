#import "PrivateVaultJobProcessor.h"

#include <string.h>

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
  dispatch_queue_t _queue;
}

- (instancetype)initWithSession:(AncPrivateVaultSession *)session
                  authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
                      grantIndex:(AncPrivateVaultGrantIndex *)grantIndex {
  self = [super init];
  if (self == nil || session == nil || authorityStore == nil || grantIndex == nil)
    return nil;
  _session = session;
  _authorityStore = authorityStore;
  _grantIndex = grantIndex;
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
