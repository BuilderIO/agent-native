#import "PrivateVaultContinuityCoordinator.h"

#import "PrivateVaultAuthorityStoreInternal.h"
#import "PrivateVaultContinuityBuilder.h"
#import "PrivateVaultControlLogInternal.h"
#import "PrivateVaultEndpointRequest.h"

static NSString *const kContinuityPendingRecordId = @"continuity-pending-v1";
static const NSUInteger kContinuityPendingMaximumBytes = 2048;

@interface AncPrivateVaultPreparedContinuity ()
@property(nonatomic) NSString *vaultId;
@property(nonatomic) NSData *signedEntry;
@property(nonatomic) NSData *requestBody;
@property(nonatomic) NSString *proofHeader;
@property(nonatomic) NSString *entryId;
@property(nonatomic) uint64_t sequence;
@property(nonatomic) NSData *headHash;
- (instancetype)initPrivate;
@end
@implementation AncPrivateVaultPreparedContinuity
- (instancetype)initPrivate { return [super init]; }
@end

@implementation AncPrivateVaultContinuityCoordinator {
  AncPrivateVaultAuthorityStore *_authorityStore;
  AncPrivateVaultKeychain *_keychain;
  AncPrivateVaultControlLog *_controlLog;
}

- (instancetype)initWithAuthorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
                              keychain:(AncPrivateVaultKeychain *)keychain
                            controlLog:(id)controlLog {
  self = [super init];
  if (self == nil || authorityStore == nil || keychain == nil ||
      ![controlLog isKindOfClass:AncPrivateVaultControlLog.class])
    return nil;
  _authorityStore = authorityStore;
  _keychain = keychain;
  _controlLog = controlLog;
  return self;
}

- (AncPrivateVaultContinuityCoordinatorStatus)
    loadPendingVaultId:(NSString *)vaultId signedEntry:(NSData **)signedEntry {
  if (signedEntry != NULL) *signedEntry = nil;
  NSData *stored = nil;
  AncPrivateVaultKeychainStatus status = [_keychain
      copyDataForService:AncPrivateVaultContinuityPendingService
                 vaultId:vaultId
                recordId:kContinuityPendingRecordId
                    data:&stored];
  if (status == AncPrivateVaultKeychainStatusNotFound)
    return AncPrivateVaultContinuityCoordinatorStatusNotFound;
  if (status != AncPrivateVaultKeychainStatusOK || stored.length == 0 ||
      stored.length > kContinuityPendingMaximumBytes)
    return AncPrivateVaultContinuityCoordinatorStatusStorageFailed;
  if (signedEntry != NULL) *signedEntry = [stored copy];
  return AncPrivateVaultContinuityCoordinatorStatusOK;
}

- (AncPrivateVaultContinuityCoordinatorStatus)
    persistPendingVaultId:(NSString *)vaultId signedEntry:(NSData *)signedEntry {
  if (signedEntry.length == 0 ||
      signedEntry.length > kContinuityPendingMaximumBytes)
    return AncPrivateVaultContinuityCoordinatorStatusInvalid;
  AncPrivateVaultKeychainStatus status = [_keychain
      addData:signedEntry
      forService:AncPrivateVaultContinuityPendingService
         vaultId:vaultId
        recordId:kContinuityPendingRecordId];
  if (status != AncPrivateVaultKeychainStatusOK &&
      status != AncPrivateVaultKeychainStatusDuplicate)
    return AncPrivateVaultContinuityCoordinatorStatusStorageFailed;
  NSData *readback = nil;
  AncPrivateVaultContinuityCoordinatorStatus loaded =
      [self loadPendingVaultId:vaultId signedEntry:&readback];
  if (loaded != AncPrivateVaultContinuityCoordinatorStatusOK)
    return loaded;
  return [readback isEqualToData:signedEntry]
      ? AncPrivateVaultContinuityCoordinatorStatusOK
      : AncPrivateVaultContinuityCoordinatorStatusConflict;
}

- (AncPrivateVaultContinuityCoordinatorStatus)
    clearPendingVaultId:(NSString *)vaultId {
  AncPrivateVaultKeychainStatus status = [_keychain
      deleteDataForService:AncPrivateVaultContinuityPendingService
                    vaultId:vaultId
                   recordId:kContinuityPendingRecordId];
  return status == AncPrivateVaultKeychainStatusOK ||
          status == AncPrivateVaultKeychainStatusNotFound
      ? AncPrivateVaultContinuityCoordinatorStatusOK
      : AncPrivateVaultContinuityCoordinatorStatusStorageFailed;
}

- (AncPrivateVaultContinuityCoordinatorStatus)
    prepareVaultId:(NSString *)vaultId
       logEnvelopeId:(NSString *)logEnvelopeId
      entryCreatedAt:(NSString *)entryCreatedAt
       proofIssuedAt:(NSString *)proofIssuedAt
               nonce:(NSString *)nonce
          endpointId:(NSString *)endpointId
         signingSeed:(const uint8_t *)signingSeed
expectedSigningPublicKey:(NSData *)expectedSigningPublicKey
              result:(AncPrivateVaultPreparedContinuity **)result {
  if (result != NULL) *result = nil;
  if (vaultId.length == 0 || logEnvelopeId.length == 0 ||
      entryCreatedAt.length == 0 || proofIssuedAt.length == 0 ||
      nonce.length == 0 || endpointId.length == 0 || signingSeed == NULL ||
      expectedSigningPublicKey.length != 32)
    return AncPrivateVaultContinuityCoordinatorStatusInvalid;
  AncPrivateVaultAuthorityCheckpoint *checkpoint = nil;
  if ([_authorityStore loadVaultId:vaultId checkpoint:&checkpoint error:nil] !=
          AncPrivateVaultAuthorityStoreStatusOK ||
      checkpoint == nil)
    return AncPrivateVaultContinuityCoordinatorStatusStorageFailed;
  AncPrivateVaultControlLogState *state =
      AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(checkpoint);
  if (state == nil)
    return AncPrivateVaultContinuityCoordinatorStatusStorageFailed;

  NSData *signedEntry = nil;
  AncPrivateVaultContinuityCoordinatorStatus pending =
      [self loadPendingVaultId:vaultId signedEntry:&signedEntry];
  if (pending == AncPrivateVaultContinuityCoordinatorStatusNotFound) {
    signedEntry = AncPrivateVaultBuildContinuityCheckpoint(
        state, logEnvelopeId, entryCreatedAt, endpointId, signingSeed,
        expectedSigningPublicKey);
    if (signedEntry == nil)
      return AncPrivateVaultContinuityCoordinatorStatusUnauthorized;
    pending = [self persistPendingVaultId:vaultId signedEntry:signedEntry];
  }
  if (pending != AncPrivateVaultContinuityCoordinatorStatusOK)
    return pending;

  AncPrivateVaultControlLogReplayResult *replay = nil;
  AncPrivateVaultControlLogStatus replayStatus = [_controlLog
      replaySignedEntry:signedEntry
          currentState:state
              verifier:nil
                result:&replay];
  if (replayStatus != AncPrivateVaultControlLogStatusOK || replay == nil)
    return AncPrivateVaultContinuityCoordinatorStatusConflict;
  if (replay.idempotent) {
    AncPrivateVaultContinuityCoordinatorStatus cleared =
        [self clearPendingVaultId:vaultId];
    if (cleared != AncPrivateVaultContinuityCoordinatorStatusOK) return cleared;
    signedEntry = AncPrivateVaultBuildContinuityCheckpoint(
        state, logEnvelopeId, entryCreatedAt, endpointId, signingSeed,
        expectedSigningPublicKey);
    if (signedEntry == nil)
      return AncPrivateVaultContinuityCoordinatorStatusUnauthorized;
    pending = [self persistPendingVaultId:vaultId signedEntry:signedEntry];
    if (pending != AncPrivateVaultContinuityCoordinatorStatusOK) return pending;
    replay = nil;
    replayStatus = [_controlLog replaySignedEntry:signedEntry
                                      currentState:state
                                          verifier:nil
                                            result:&replay];
  }
  if (replayStatus != AncPrivateVaultControlLogStatusOK || replay == nil ||
      replay.idempotent ||
      ![replay.state.freshnessMode isEqualToString:@"endpoint_witnessed"])
    return AncPrivateVaultContinuityCoordinatorStatusConflict;

  AncPrivateVaultEndpointRequestStatus requestStatus;
  NSData *body = AncPrivateVaultControlLogContinuityAppendRequestEncode(
      signedEntry, &requestStatus);
  NSString *proof = body == nil ? nil
      : AncPrivateVaultControlLogAppendProofHeaderCreate(
            vaultId, endpointId, body, proofIssuedAt, nonce, signingSeed,
            expectedSigningPublicKey, &requestStatus);
  NSString *entryId =
      AncPrivateVaultControlLogSignedEntryEnvelopeId(signedEntry);
  if (body == nil || proof == nil || entryId.length == 0 ||
      requestStatus != AncPrivateVaultEndpointRequestStatusOK)
    return AncPrivateVaultContinuityCoordinatorStatusInvalid;
  AncPrivateVaultPreparedContinuity *prepared =
      [[AncPrivateVaultPreparedContinuity alloc] initPrivate];
  prepared.vaultId = [vaultId copy];
  prepared.signedEntry = [signedEntry copy];
  prepared.requestBody = [body copy];
  prepared.proofHeader = [proof copy];
  prepared.entryId = [entryId copy];
  prepared.sequence = replay.state.sequence;
  prepared.headHash = [replay.state.headHash copy];
  if (result != NULL) *result = prepared;
  return AncPrivateVaultContinuityCoordinatorStatusOK;
}

- (AncPrivateVaultContinuityCoordinatorStatus)
    finalizeVaultId:(NSString *)vaultId
             receipt:(NSData *)receipt
        verifiedAtMs:(uint64_t)verifiedAtMs {
  if (vaultId.length == 0 || receipt.length == 0 || verifiedAtMs == 0)
    return AncPrivateVaultContinuityCoordinatorStatusInvalid;
  NSData *signedEntry = nil;
  AncPrivateVaultContinuityCoordinatorStatus pending =
      [self loadPendingVaultId:vaultId signedEntry:&signedEntry];
  if (pending != AncPrivateVaultContinuityCoordinatorStatusOK) return pending;
  AncPrivateVaultContinuityHostedAppendReceipt *decoded =
      AncPrivateVaultControlLogContinuityAppendReceiptDecode(receipt);
  NSData *entryHash =
      AncPrivateVaultControlLogSignedEntryDomainHash(signedEntry);
  NSString *entryId =
      AncPrivateVaultControlLogSignedEntryEnvelopeId(signedEntry);
  if (decoded == nil || ![decoded.vaultId isEqualToString:vaultId] ||
      ![decoded.entryId isEqualToString:entryId] ||
      ![decoded.headHash isEqualToData:entryHash])
    return AncPrivateVaultContinuityCoordinatorStatusReceiptRejected;
  AncPrivateVaultAuthorityCheckpoint *checkpoint = nil;
  if ([_authorityStore loadVaultId:vaultId checkpoint:&checkpoint error:nil] !=
          AncPrivateVaultAuthorityStoreStatusOK ||
      checkpoint == nil)
    return AncPrivateVaultContinuityCoordinatorStatusStorageFailed;
  AncPrivateVaultControlLogState *state =
      AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(checkpoint);
  if (state == nil)
    return AncPrivateVaultContinuityCoordinatorStatusStorageFailed;
  if (decoded.sequence == state.sequence &&
      [decoded.headHash isEqualToData:state.headHash])
    return [self clearPendingVaultId:vaultId];
  if (decoded.sequence != state.sequence + 1)
    return AncPrivateVaultContinuityCoordinatorStatusReceiptRejected;
  AncPrivateVaultControlLogReplayResult *replay = nil;
  if ([_controlLog replaySignedEntry:signedEntry currentState:state verifier:nil
                              result:&replay] !=
          AncPrivateVaultControlLogStatusOK ||
      replay == nil || replay.idempotent ||
      replay.state.sequence != decoded.sequence ||
      ![replay.state.headHash isEqualToData:decoded.headHash] ||
      ![replay.state.freshnessMode isEqualToString:@"endpoint_witnessed"])
    return AncPrivateVaultContinuityCoordinatorStatusUnauthorized;
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
    return AncPrivateVaultContinuityCoordinatorStatusStorageFailed;
  return [self clearPendingVaultId:vaultId];
}

@end
