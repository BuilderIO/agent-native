#import <Foundation/Foundation.h>

#include <assert.h>
#include <stdio.h>
#include <string.h>

#import "PrivateVaultSession.h"

static NSString *const kVaultId = @"00112233445566778899aabbccddeeff";

@interface TestSessionHandle : NSObject <AncPrivateVaultSessionCustodyHandle> {
  uint8_t _bytes[160];
}
@property(nonatomic, getter=isClosed) BOOL closed;
@property(nonatomic) BOOL failClose;
- (BOOL)allBytesAreZero;
@end

@implementation TestSessionHandle
- (instancetype)init {
  self = [super init];
  if (self != nil) memset(_bytes, 0x61, sizeof _bytes);
  return self;
}
- (NSInteger)borrow:(BOOL (^)(const AncPrivateVaultCustodySecretInputs *))block {
  if (_closed || block == nil) return 7;
  AncPrivateVaultCustodySecretInputs secrets = {
      .signing_seed = _bytes,
      .box_seed = _bytes + 32,
      .local_state_key = _bytes + 64,
      .active_epoch_key = _bytes + 96,
      .pending_epoch_key = _bytes + 128,
  };
  return block(&secrets) ? 0 : 7;
}
- (NSInteger)close {
  if (_failClose) return 7;
  memset(_bytes, 0, sizeof _bytes);
  _closed = YES;
  return 0;
}
- (BOOL)allBytesAreZero {
  uint8_t value = 0;
  for (size_t index = 0; index < sizeof _bytes; index += 1)
    value |= _bytes[index];
  return value == 0;
}
@end

@interface TestSessionRepository
    : NSObject <AncPrivateVaultSessionCustodyRepository>
@property(nonatomic) AncPrivateVaultCustodySnapshot snapshot;
@property(nonatomic) TestSessionHandle *handle;
@property(nonatomic) NSInteger status;
@property(nonatomic) NSUInteger reads;
@end

@implementation TestSessionRepository
- (NSInteger)readVaultId:(NSString *)vaultId
                snapshot:(AncPrivateVaultCustodySnapshot *)snapshot
                  handle:(id<AncPrivateVaultSessionCustodyHandle> *)handle {
  (void)vaultId;
  _reads += 1;
  if (_status != 0) return _status;
  *snapshot = _snapshot;
  *handle = _handle;
  return 0;
}
@end

static AncPrivateVaultCustodySnapshot ActiveSnapshot(void) {
  AncPrivateVaultCustodySnapshot snapshot;
  anc_pv_custody_snapshot_zero(&snapshot);
  snapshot.record_version = ANC_PV_CUSTODY_VERSION;
  snapshot.authority_anchor_present = 1;
  snapshot.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_ACTIVE;
  snapshot.role = ANC_PV_CUSTODY_ROLE_ENDPOINT;
  snapshot.custody_generation = 2;
  snapshot.active_epoch = 1;
  NSData *vault = [kVaultId dataUsingEncoding:NSUTF8StringEncoding];
  memcpy(snapshot.vault_id, vault.bytes, vault.length);
  snapshot.vault_id_length = vault.length;
  NSData *endpoint = [@"endpoint:test-session" dataUsingEncoding:NSUTF8StringEncoding];
  memcpy(snapshot.endpoint_id, endpoint.bytes, endpoint.length);
  snapshot.endpoint_id_length = endpoint.length;
  return snapshot;
}

static TestSessionRepository *Repository(void) {
  TestSessionRepository *repository = [TestSessionRepository new];
  repository.snapshot = ActiveSnapshot();
  repository.handle = [TestSessionHandle new];
  return repository;
}

int main(void) {
  @autoreleasepool {
    TestSessionRepository *repository = Repository();
    AncPrivateVaultSession *session =
        [[AncPrivateVaultSession alloc] initWithRepository:repository];
    assert(!session.isUnlocked);
    assert([session unlockVaultId:kVaultId] ==
           AncPrivateVaultSessionStatusOK);
    assert(session.isUnlocked);
    assert(repository.reads == 1);
    assert([session unlockVaultId:kVaultId] ==
           AncPrivateVaultSessionStatusOK);
    assert(repository.reads == 1);
    assert([session unlockVaultId:@"ffffffffffffffffffffffffffffffff"] ==
           AncPrivateVaultSessionStatusConflict);

    __block BOOL borrowed = NO;
    assert([session borrowVaultId:kVaultId
                            block:^BOOL(
                                const AncPrivateVaultCustodySnapshot *snapshot,
                                const AncPrivateVaultCustodySecretInputs *secrets) {
      borrowed = snapshot->active_epoch == 1 &&
                 secrets->active_epoch_key[0] == 0x61;
      return borrowed;
    }] == AncPrivateVaultSessionStatusOK);
    assert(borrowed);
    assert([session lock] == AncPrivateVaultSessionStatusOK);
    assert(!session.isUnlocked);
    assert(repository.handle.allBytesAreZero);

    TestSessionRepository *pending = Repository();
    AncPrivateVaultCustodySnapshot pendingSnapshot = pending.snapshot;
    pendingSnapshot.authority_anchor_present = 0;
    pendingSnapshot.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
    pendingSnapshot.pending_kind = ANC_PV_CUSTODY_PENDING_ADD_DEVICE;
    pending.snapshot = pendingSnapshot;
    AncPrivateVaultSession *pendingSession =
        [[AncPrivateVaultSession alloc] initWithRepository:pending];
    assert([pendingSession unlockVaultId:kVaultId] ==
           AncPrivateVaultSessionStatusRejected);
    assert(pending.handle.isClosed);

    TestSessionRepository *rotating = Repository();
    AncPrivateVaultCustodySnapshot rotatingSnapshot = rotating.snapshot;
    rotatingSnapshot.rotation_phase = ANC_PV_CUSTODY_ROTATION_PREPARED;
    rotating.snapshot = rotatingSnapshot;
    AncPrivateVaultSession *rotatingSession =
        [[AncPrivateVaultSession alloc] initWithRepository:rotating];
    assert([rotatingSession unlockVaultId:kVaultId] ==
           AncPrivateVaultSessionStatusRejected);
    assert(rotating.handle.isClosed);

    TestSessionRepository *failed = Repository();
    failed.handle.failClose = YES;
    AncPrivateVaultSession *failedSession =
        [[AncPrivateVaultSession alloc] initWithRepository:failed];
    assert([failedSession unlockVaultId:kVaultId] ==
           AncPrivateVaultSessionStatusOK);
    assert([failedSession lock] ==
           AncPrivateVaultSessionStatusEvictionFailed);
    assert(!failedSession.isUnlocked);
    assert([failedSession unlockVaultId:kVaultId] ==
           AncPrivateVaultSessionStatusEvictionFailed);
    failed.handle.failClose = NO;
    assert([failedSession lock] == AncPrivateVaultSessionStatusOK);
  }
  puts("private-vault session tests passed");
  return 0;
}
