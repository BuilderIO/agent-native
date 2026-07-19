#import "PrivateVaultGrantRevocationCoordinator.h"

#import "PrivateVaultAuthorityStoreInternal.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultControlLogInternal.h"
#import "PrivateVaultEndpointRequest.h"
#import "PrivateVaultGrantIndexControlVerifier.h"
#import "PrivateVaultGrantRevocationBuilder.h"

@interface AncPrivateVaultPreparedGrantRevocation ()
@property(nonatomic) NSString *vaultId;
@property(nonatomic) NSData *grantRef;
@property(nonatomic) NSData *signedEntry;
@property(nonatomic) NSData *requestBody;
@property(nonatomic) NSString *proofHeader;
@property(nonatomic) NSString *entryId;
@property(nonatomic) uint64_t sequence;
@property(nonatomic) NSData *headHash;
- (instancetype)initPrivate;
@end
@implementation AncPrivateVaultPreparedGrantRevocation
- (instancetype)initPrivate { return [super init]; }
@end

@interface AncGrantRevocationInspectionVerifier
    : NSObject <AncPrivateVaultControlLogAuthorizationVerifier>
@property(nonatomic) AncPrivateVaultVerifiedGrant *grant;
@property(nonatomic) NSData *expectedRevocation;
@property(nonatomic) NSData *signingPublicKey;
@end
@implementation AncGrantRevocationInspectionVerifier
- (BOOL)verifyGrantRevocationSignedEntry:(NSData *)signedEntry
                           innerEnvelope:(NSData *)innerEnvelope
                      revocationEnvelope:(NSData *)revocationEnvelope
                            currentState:(AncPrivateVaultControlLogState *)state {
  if (signedEntry.length == 0 || innerEnvelope.length == 0 || state == nil ||
      ![revocationEnvelope isEqualToData:self.expectedRevocation])
    return NO;
  AncPrivateVaultGrantCodecStatus status;
  return AncPrivateVaultVerifyGrantRevocationEnvelope(
             revocationEnvelope, self.grant.vaultId, self.grant,
             self.signingPublicKey.bytes, &status) != nil &&
      status == AncPrivateVaultGrantCodecStatusOK;
}
@end

static BOOL SameProjection(AncPrivateVaultControlLogState *left,
                           AncPrivateVaultControlLogState *right) {
  if (left == nil || right == nil || left.epoch != right.epoch ||
      left.recoveryGeneration != right.recoveryGeneration ||
      ![left.vaultId isEqualToString:right.vaultId] ||
      ![left.membershipHash isEqualToData:right.membershipHash] ||
      ![left.removedEndpointIds isEqualToArray:right.removedEndpointIds] ||
      ![left.recoveryId isEqualToString:right.recoveryId] ||
      ![left.recoverySigningPublicKey
          isEqualToData:right.recoverySigningPublicKey] ||
      ![left.recoveryKeyAgreementPublicKey
          isEqualToData:right.recoveryKeyAgreementPublicKey] ||
      ![left.recoveryWrapHash isEqualToData:right.recoveryWrapHash] ||
      ![left.freshnessMode isEqualToString:right.freshnessMode] ||
      left.activeMembers.count != right.activeMembers.count)
    return NO;
  for (NSUInteger index = 0; index < left.activeMembers.count; index += 1) {
    AncPrivateVaultControlLogMember *a = left.activeMembers[index];
    AncPrivateVaultControlLogMember *b = right.activeMembers[index];
    if (![a.endpointId isEqualToString:b.endpointId] ||
        ![a.role isEqualToString:b.role] || a.unattended != b.unattended ||
        ![a.signingPublicKey isEqualToData:b.signingPublicKey] ||
        ![a.keyAgreementPublicKey isEqualToData:b.keyAgreementPublicKey] ||
        ![a.enrollmentRef isEqualToString:b.enrollmentRef])
      return NO;
  }
  return YES;
}

@implementation AncPrivateVaultGrantRevocationCoordinator {
  AncPrivateVaultGrantIndex *_grantIndex;
  AncPrivateVaultAuthorityStore *_authorityStore;
  AncPrivateVaultControlLog *_controlLog;
}

- (instancetype)initWithGrantIndex:(AncPrivateVaultGrantIndex *)grantIndex
                    authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
                        controlLog:(id)controlLog {
  self = [super init];
  if (self == nil || grantIndex == nil || authorityStore == nil ||
      ![controlLog isKindOfClass:AncPrivateVaultControlLog.class])
    return nil;
  _grantIndex = grantIndex;
  _authorityStore = authorityStore;
  _controlLog = controlLog;
  return self;
}

- (AncPrivateVaultGrantRevocationCoordinatorStatus)
    prepareVaultId:(NSString *)vaultId
          grantRef:(NSData *)grantRef
revocationEnvelopeId:(NSData *)revocationEnvelopeId
       logEnvelopeId:(NSString *)logEnvelopeId
           createdAt:(NSString *)createdAt
       revokedAtSeconds:(uint64_t)revokedAtSeconds
             reason:(NSString *)reason
              nonce:(NSString *)nonce
         endpointId:(NSString *)endpointId
        signingSeed:(const uint8_t *)signingSeed
expectedSigningPublicKey:(NSData *)expectedSigningPublicKey
             result:(AncPrivateVaultPreparedGrantRevocation **)result {
  if (result != NULL) *result = nil;
  if (vaultId.length != 32 || grantRef.length != 32 ||
      revocationEnvelopeId.length != 16 || logEnvelopeId.length == 0 ||
      createdAt.length == 0 || revokedAtSeconds == 0 || reason.length == 0 ||
      nonce.length == 0 || endpointId.length == 0 || signingSeed == NULL ||
      expectedSigningPublicKey.length != 32)
    return AncPrivateVaultGrantRevocationCoordinatorStatusInvalid;
  AncPrivateVaultAuthorityCheckpoint *checkpoint = nil;
  if ([_authorityStore loadVaultId:vaultId checkpoint:&checkpoint error:nil] !=
          AncPrivateVaultAuthorityStoreStatusOK ||
      checkpoint == nil)
    return AncPrivateVaultGrantRevocationCoordinatorStatusStorageFailed;
  AncPrivateVaultControlLogState *state =
      AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(checkpoint);
  AncPrivateVaultControlLogMember *member = nil;
  BOOL duplicateMember = NO;
  for (AncPrivateVaultControlLogMember *candidate in state.activeMembers) {
    if (![candidate.endpointId isEqualToString:endpointId]) continue;
    if (member != nil) duplicateMember = YES;
    member = candidate;
  }
  if (state == nil || member == nil || duplicateMember ||
      ![member.role isEqualToString:@"endpoint"] || member.unattended ||
      ![member.signingPublicKey isEqualToData:expectedSigningPublicKey])
    return AncPrivateVaultGrantRevocationCoordinatorStatusUnauthorized;

  AncPrivateVaultPendingGrantRevocation *pending = nil;
  AncPrivateVaultGrantIndexStatus pendingStatus =
      [_grantIndex pendingRevocationForVaultId:vaultId context:&pending];
  if (pendingStatus != AncPrivateVaultGrantIndexStatusOK &&
      pendingStatus != AncPrivateVaultGrantIndexStatusNotFound)
    return AncPrivateVaultGrantRevocationCoordinatorStatusStorageFailed;
  if (pending != nil && ![pending.grantRef isEqualToData:grantRef])
    return AncPrivateVaultGrantRevocationCoordinatorStatusConflict;
  AncPrivateVaultRevocableGrantContext *grantContext = nil;
  if ([_grantIndex resolveGrantForRevocationRef:grantRef vaultId:vaultId
                                         context:&grantContext] !=
          AncPrivateVaultGrantIndexStatusOK ||
      grantContext == nil)
    return AncPrivateVaultGrantRevocationCoordinatorStatusNotFound;
  if (pending == nil && grantContext.isRevoked)
    return AncPrivateVaultGrantRevocationCoordinatorStatusConflict;

  NSData *signedEntry = pending.signedEntry;
  NSData *revocation = pending.revocationEnvelope;
  if (pending == nil) {
    AncPrivateVaultGrantRevocationBuildResult *built =
        AncPrivateVaultBuildGrantRevocation(
            state, grantContext.grant, revocationEnvelopeId, logEnvelopeId,
            createdAt, revokedAtSeconds, reason, signingSeed);
    if (built == nil)
      return AncPrivateVaultGrantRevocationCoordinatorStatusUnauthorized;
    if ([_grantIndex stagePendingRevocationSignedEntry:built.signedEntry
                                    revocationEnvelope:built.revocationEnvelope
                                               vaultId:vaultId] !=
        AncPrivateVaultGrantIndexStatusOK)
      return AncPrivateVaultGrantRevocationCoordinatorStatusStorageFailed;
    signedEntry = built.signedEntry;
    revocation = built.revocationEnvelope;
  }

  AncGrantRevocationInspectionVerifier *verifier =
      [AncGrantRevocationInspectionVerifier new];
  verifier.grant = grantContext.grant;
  verifier.expectedRevocation = revocation;
  verifier.signingPublicKey = grantContext.issuerSigningPublicKey;
  AncPrivateVaultControlLogReplayResult *replay = nil;
  if ([_controlLog replaySignedEntry:signedEntry currentState:state
                            verifier:verifier result:&replay] !=
          AncPrivateVaultControlLogStatusOK ||
      replay == nil || replay.idempotent ||
      !SameProjection(state, replay.state))
    return AncPrivateVaultGrantRevocationCoordinatorStatusConflict;
  AncPrivateVaultEndpointRequestStatus requestStatus;
  NSData *body =
      AncPrivateVaultControlLogGrantRevocationAppendRequestEncode(
          signedEntry, &requestStatus);
  NSString *proof = body == nil ? nil
      : AncPrivateVaultControlLogAppendProofHeaderCreate(
            vaultId, endpointId, body, createdAt, nonce, signingSeed,
            expectedSigningPublicKey, &requestStatus);
  NSString *entryId =
      AncPrivateVaultControlLogSignedEntryEnvelopeId(signedEntry);
  if (body == nil || proof == nil || entryId.length == 0 ||
      requestStatus != AncPrivateVaultEndpointRequestStatusOK)
    return AncPrivateVaultGrantRevocationCoordinatorStatusInvalid;
  AncPrivateVaultPreparedGrantRevocation *prepared =
      [[AncPrivateVaultPreparedGrantRevocation alloc] initPrivate];
  prepared.vaultId = [vaultId copy];
  prepared.grantRef = [grantRef copy];
  prepared.signedEntry = [signedEntry copy];
  prepared.requestBody = [body copy];
  prepared.proofHeader = [proof copy];
  prepared.entryId = [entryId copy];
  prepared.sequence = replay.state.sequence;
  prepared.headHash = [replay.state.headHash copy];
  if (result != NULL) *result = prepared;
  return AncPrivateVaultGrantRevocationCoordinatorStatusOK;
}

- (AncPrivateVaultGrantRevocationCoordinatorStatus)
    finalizeVaultId:(NSString *)vaultId
             receipt:(NSData *)receipt
        verifiedAtMs:(uint64_t)verifiedAtMs {
  if (vaultId.length != 32 || receipt.length == 0 || verifiedAtMs == 0)
    return AncPrivateVaultGrantRevocationCoordinatorStatusInvalid;
  AncPrivateVaultPendingGrantRevocation *pending = nil;
  if ([_grantIndex pendingRevocationForVaultId:vaultId context:&pending] !=
          AncPrivateVaultGrantIndexStatusOK ||
      pending == nil)
    return AncPrivateVaultGrantRevocationCoordinatorStatusNotFound;
  AncPrivateVaultGrantRevocationHostedAppendReceipt *decoded =
      AncPrivateVaultControlLogGrantRevocationAppendReceiptDecode(receipt);
  NSData *entryHash =
      AncPrivateVaultControlLogSignedEntryDomainHash(pending.signedEntry);
  NSString *entryId =
      AncPrivateVaultControlLogSignedEntryEnvelopeId(pending.signedEntry);
  if (decoded == nil || ![decoded.vaultId isEqualToString:vaultId] ||
      ![decoded.entryId isEqualToString:entryId] ||
      ![decoded.headHash isEqualToData:entryHash])
    return AncPrivateVaultGrantRevocationCoordinatorStatusReceiptRejected;
  AncPrivateVaultAuthorityCheckpoint *checkpoint = nil;
  if ([_authorityStore loadVaultId:vaultId checkpoint:&checkpoint error:nil] !=
          AncPrivateVaultAuthorityStoreStatusOK ||
      checkpoint == nil)
    return AncPrivateVaultGrantRevocationCoordinatorStatusStorageFailed;
  AncPrivateVaultControlLogState *state =
      AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(checkpoint);
  AncPrivateVaultRevocableGrantContext *grantContext = nil;
  if (state == nil ||
      [_grantIndex resolveGrantForRevocationRef:pending.grantRef
                                        vaultId:vaultId
                                        context:&grantContext] !=
          AncPrivateVaultGrantIndexStatusOK ||
      grantContext == nil)
    return AncPrivateVaultGrantRevocationCoordinatorStatusStorageFailed;
  if (decoded.sequence == state.sequence &&
      [decoded.headHash isEqualToData:state.headHash] &&
      grantContext.isRevoked) {
    return [_grantIndex clearPendingRevocationSignedEntry:pending.signedEntry
                                                   vaultId:vaultId] ==
            AncPrivateVaultGrantIndexStatusOK
        ? AncPrivateVaultGrantRevocationCoordinatorStatusOK
        : AncPrivateVaultGrantRevocationCoordinatorStatusStorageFailed;
  }
  if (decoded.sequence != state.sequence + 1)
    return AncPrivateVaultGrantRevocationCoordinatorStatusReceiptRejected;
  AncPrivateVaultGrantIndexControlVerifier *verifier =
      [[AncPrivateVaultGrantIndexControlVerifier alloc]
          initWithGrantIndex:_grantIndex fallback:nil];
  AncPrivateVaultControlLogReplayResult *replay = nil;
  if ([_controlLog replaySignedEntry:pending.signedEntry currentState:state
                            verifier:verifier result:&replay] !=
          AncPrivateVaultControlLogStatusOK ||
      replay == nil || replay.idempotent ||
      replay.state.sequence != decoded.sequence ||
      ![replay.state.headHash isEqualToData:decoded.headHash] ||
      !SameProjection(state, replay.state))
    return AncPrivateVaultGrantRevocationCoordinatorStatusUnauthorized;
  AncPrivateVaultVerifiedReplayResult *verified =
      AncPrivateVaultVerifiedCarryReplayResultCreate(
          replay, checkpoint, checkpoint.custodyGeneration + 1, verifiedAtMs);
  AncPrivateVaultAuthorityCheckpoint *committed = nil;
  if (verified == nil ||
      [_authorityStore commitVerifiedReplayResult:verified vaultId:vaultId
                                      verifiedAtMs:verifiedAtMs
                                        checkpoint:&committed error:nil] !=
          AncPrivateVaultAuthorityStoreStatusOK ||
      committed == nil || committed.snapshot.sequence != decoded.sequence ||
      ![committed.snapshot.headHash isEqualToData:decoded.headHash])
    return AncPrivateVaultGrantRevocationCoordinatorStatusStorageFailed;
  return [_grantIndex clearPendingRevocationSignedEntry:pending.signedEntry
                                                 vaultId:vaultId] ==
          AncPrivateVaultGrantIndexStatusOK
      ? AncPrivateVaultGrantRevocationCoordinatorStatusOK
      : AncPrivateVaultGrantRevocationCoordinatorStatusStorageFailed;
}

@end
