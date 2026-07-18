#import "PrivateVaultSession.h"

#include <string.h>

static const NSInteger kAncCustodyStatusOK = 0;
static const NSInteger kAncCustodyStatusNotFound = 1;

static BOOL AncSessionSnapshotMatches(
    const AncPrivateVaultCustodySnapshot *snapshot, NSString *vaultId) {
  NSData *vaultBytes = [vaultId dataUsingEncoding:NSUTF8StringEncoding];
  if (snapshot == NULL || vaultBytes.length == 0 ||
      vaultBytes.length != snapshot->vault_id_length ||
      vaultBytes.length > sizeof snapshot->vault_id ||
      memcmp(snapshot->vault_id, vaultBytes.bytes, vaultBytes.length) != 0 ||
      snapshot->endpoint_id_length < 8 ||
      snapshot->endpoint_id_length > sizeof snapshot->endpoint_id ||
      snapshot->record_version != ANC_PV_CUSTODY_VERSION ||
      snapshot->authority_anchor_present != 1 ||
      snapshot->expected_edge_present != 0 ||
      snapshot->lifecycle != ANC_PV_CUSTODY_LIFECYCLE_ACTIVE ||
      (snapshot->role != ANC_PV_CUSTODY_ROLE_ENDPOINT &&
       snapshot->role != ANC_PV_CUSTODY_ROLE_BROKER) ||
      snapshot->pending_kind != ANC_PV_CUSTODY_PENDING_NONE ||
      snapshot->rotation_phase != ANC_PV_CUSTODY_ROTATION_NONE ||
      snapshot->enrollment_phase != ANC_PV_CUSTODY_ENROLLMENT_NONE ||
      snapshot->custody_generation == 0 || snapshot->active_epoch == 0 ||
      snapshot->pending_epoch != 0) {
    return NO;
  }
  return YES;
}

@implementation AncPrivateVaultSession {
  id<AncPrivateVaultSessionCustodyRepository> _repository;
  NSLock *_lock;
  id<AncPrivateVaultSessionCustodyHandle> _handle;
  NSString *_vaultId;
  AncPrivateVaultCustodySnapshot _snapshot;
  BOOL _evictionFailed;
}

- (instancetype)initWithRepository:
    (id<AncPrivateVaultSessionCustodyRepository>)repository {
  self = [super init];
  if (self != nil) {
    _repository = repository;
    _lock = [NSLock new];
    anc_pv_custody_snapshot_zero(&_snapshot);
  }
  return self;
}

- (void)dealloc {
  [self lock];
  anc_pv_custody_snapshot_zero(&_snapshot);
}

- (BOOL)isUnlocked {
  [_lock lock];
  BOOL result = _handle != nil && !_handle.isClosed && !_evictionFailed;
  [_lock unlock];
  return result;
}

- (AncPrivateVaultSessionStatus)unlockVaultId:(NSString *)vaultId {
  if (vaultId.length != 32) return AncPrivateVaultSessionStatusInvalid;
  [_lock lock];
  if (_evictionFailed) {
    [_lock unlock];
    return AncPrivateVaultSessionStatusEvictionFailed;
  }
  if (_handle != nil) {
    AncPrivateVaultSessionStatus status =
        [_vaultId isEqualToString:vaultId] && !_handle.isClosed
            ? AncPrivateVaultSessionStatusOK
            : AncPrivateVaultSessionStatusConflict;
    [_lock unlock];
    return status;
  }

  AncPrivateVaultCustodySnapshot candidate;
  anc_pv_custody_snapshot_zero(&candidate);
  id<AncPrivateVaultSessionCustodyHandle> candidateHandle = nil;
  NSInteger read = [_repository readVaultId:vaultId
                                   snapshot:&candidate
                                     handle:&candidateHandle];
  if (read != kAncCustodyStatusOK || candidateHandle == nil ||
      candidateHandle.isClosed || !AncSessionSnapshotMatches(&candidate, vaultId)) {
    if (candidateHandle != nil) [candidateHandle close];
    anc_pv_custody_snapshot_zero(&candidate);
    [_lock unlock];
    return read == kAncCustodyStatusNotFound
               ? AncPrivateVaultSessionStatusNotFound
               : read == kAncCustodyStatusOK
                     ? AncPrivateVaultSessionStatusRejected
                     : AncPrivateVaultSessionStatusFailed;
  }
  _handle = candidateHandle;
  _vaultId = [vaultId copy];
  _snapshot = candidate;
  anc_pv_custody_snapshot_zero(&candidate);
  [_lock unlock];
  return AncPrivateVaultSessionStatusOK;
}

- (AncPrivateVaultSessionStatus)lock {
  [_lock lock];
  if (_handle == nil) {
    _evictionFailed = NO;
    [_lock unlock];
    return AncPrivateVaultSessionStatusOK;
  }
  NSInteger close = [_handle close];
  if (close != kAncCustodyStatusOK || !_handle.isClosed) {
    _evictionFailed = YES;
    [_lock unlock];
    return AncPrivateVaultSessionStatusEvictionFailed;
  }
  _handle = nil;
  _vaultId = nil;
  _evictionFailed = NO;
  anc_pv_custody_snapshot_zero(&_snapshot);
  [_lock unlock];
  return AncPrivateVaultSessionStatusOK;
}

- (AncPrivateVaultSessionStatus)
    borrowVaultId:(NSString *)vaultId
             block:(AncPrivateVaultSessionBorrowBlock)block {
  if (vaultId.length != 32 || block == nil)
    return AncPrivateVaultSessionStatusInvalid;
  [_lock lock];
  if (_evictionFailed || _handle == nil || _handle.isClosed ||
      ![_vaultId isEqualToString:vaultId]) {
    [_lock unlock];
    return AncPrivateVaultSessionStatusRejected;
  }
  AncPrivateVaultCustodySnapshot snapshot = _snapshot;
  NSInteger status = [_handle borrow:^BOOL(
      const AncPrivateVaultCustodySecretInputs *secrets) {
    return block(&snapshot, secrets);
  }];
  anc_pv_custody_snapshot_zero(&snapshot);
  [_lock unlock];
  return status == kAncCustodyStatusOK ? AncPrivateVaultSessionStatusOK
                                      : AncPrivateVaultSessionStatusFailed;
}

@end
