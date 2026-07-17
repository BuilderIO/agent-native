#import <Foundation/Foundation.h>

#import "PrivateVaultRotationPreparationStore.h"

#include <assert.h>

static NSMutableDictionary<NSString *, NSData *> *gStore;

static NSString *StoreKey(NSDictionary *query) {
  return
      [NSString stringWithFormat:@"%@|%@", query[(__bridge id)kSecAttrService],
                                 query[(__bridge id)kSecAttrAccount]];
}

static OSStatus MockCopy(CFDictionaryRef rawQuery, CFTypeRef *result) {
  NSData *value = gStore[StoreKey((__bridge NSDictionary *)rawQuery)];
  if (value == nil)
    return errSecItemNotFound;
  if (result != NULL)
    *result = CFBridgingRetain([value copy]);
  return errSecSuccess;
}

static OSStatus MockAdd(CFDictionaryRef raw, CFTypeRef *result) {
  (void)result;
  NSDictionary *attributes = (__bridge NSDictionary *)raw;
  NSString *key = StoreKey(attributes);
  if (gStore[key] != nil)
    return errSecDuplicateItem;
  NSData *value = attributes[(__bridge id)kSecValueData];
  gStore[key] = [NSData dataWithBytes:value.bytes length:value.length];
  return errSecSuccess;
}

static OSStatus MockUpdate(CFDictionaryRef rawQuery,
                           CFDictionaryRef rawAttributes) {
  NSDictionary *query = (__bridge NSDictionary *)rawQuery;
  NSString *key = StoreKey(query);
  if (gStore[key] == nil)
    return errSecItemNotFound;
  NSDictionary *attributes = (__bridge NSDictionary *)rawAttributes;
  NSData *value = attributes[(__bridge id)kSecValueData];
  gStore[key] = [NSData dataWithBytes:value.bytes length:value.length];
  return errSecSuccess;
}

static OSStatus MockDelete(CFDictionaryRef rawQuery) {
  NSString *key = StoreKey((__bridge NSDictionary *)rawQuery);
  if (gStore[key] == nil)
    return errSecItemNotFound;
  [gStore removeObjectForKey:key];
  return errSecSuccess;
}

static AncPrivateVaultKeychain *KeychainWithDomain(NSString *storageDomain) {
  AncPrivateVaultSecItemFunctions functions = {
      .copyMatching = MockCopy,
      .add = MockAdd,
      .update = MockUpdate,
      .deleteItem = MockDelete,
  };
  return [[AncPrivateVaultKeychain alloc] initWithFunctions:functions
                                             contextFactory:^LAContext * {
                                               return [[LAContext alloc] init];
                                             }
                                              storageDomain:storageDomain];
}

static AncPrivateVaultKeychain *Keychain(void) {
  return KeychainWithDomain(@"test-keychain:shared");
}

static NSString *KeyForRotationVault(NSString *service,
                                     const uint8_t vaultId[16]) {
  for (NSString *key in gStore) {
    if (![key hasPrefix:[service stringByAppendingString:@"|"]])
      continue;
    AncPrivateVaultRotationPreparationSnapshot snapshot;
    uint8_t pending[32] = {0};
    AncPrivateVaultRotationPreparationStatus status =
        anc_pv_rotation_preparation_record_decode(
            gStore[key].bytes, gStore[key].length, &snapshot, pending);
    BOOL matches = status == ANC_PV_ROTATION_PREPARATION_OK &&
                   memcmp(snapshot.vault_id, vaultId, 16) == 0;
    anc_pv_rotation_preparation_snapshot_zero(&snapshot);
    anc_pv_zeroize(pending, sizeof pending);
    if (matches)
      return key;
  }
  return nil;
}

static void Fill(uint8_t *bytes, size_t length, uint8_t start) {
  for (size_t index = 0; index < length; index++)
    bytes[index] = (uint8_t)(start + index);
}

static NSString *VaultKey(const uint8_t vaultId[16]) {
  NSMutableString *value = [NSMutableString stringWithCapacity:32];
  for (size_t index = 0; index < 16; index++)
    [value appendFormat:@"%02x", vaultId[index]];
  return value;
}

static NSData *RecordDigest(NSData *record) {
  static const char domain[] =
      "anc/v1/private-vault/rotation-preparation-record/fence";
  uint8_t input[sizeof domain + ANC_PV_ROTATION_PREPARATION_RECORD_BYTES];
  uint8_t digest[32] = {0};
  memcpy(input, domain, sizeof domain);
  memcpy(input + sizeof domain, record.bytes, record.length);
  assert(anc_pv_blake2b_256(digest, input, sizeof input) == ANC_PV_CRYPTO_OK);
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(input, sizeof input);
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static AncPrivateVaultRotationPreparationSnapshot Snapshot(void) {
  AncPrivateVaultRotationPreparationSnapshot value = {0};
  value.phase = ANC_PV_ROTATION_PREPARATION_PHASE_PREPARED;
  value.role = ANC_PV_ROTATION_PREPARATION_ROLE_ENDPOINT;
  value.preparation_generation = 1;
  Fill(value.vault_id, 16, 0x11);
  Fill(value.endpoint_id, 16, 0x21);
  Fill(value.ceremony_id, 16, 0x31);
  value.base_custody_generation = 4;
  Fill(value.base_frame_digest, 32, 0x41);
  value.base_sequence = 7;
  Fill(value.base_head, 32, 0x51);
  Fill(value.base_membership, 32, 0x61);
  value.base_epoch = 2;
  value.base_recovery_generation = 3;
  Fill(value.signing_public_key, 32, 0x71);
  Fill(value.agreement_public_key, 32, 0x81);
  Fill(value.enrollment_ref, 16, 0x91);
  value.pending_epoch = 3;
  return value;
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    gStore = [NSMutableDictionary dictionary];
    __block NSUInteger clearedRecordCount = 0;
    __block BOOL everyRecordCleared = YES;
    __block NSUInteger guardedRecordAllocations = 0;
    __block NSUInteger guardedRecordCloses = 0;
    __block NSInteger activeGuardedRecords = 0;
    AncPrivateVaultRotationPreparationSetRecordLifecycleHookForTesting(
        ^(BOOL allocated, BOOL closeCleared) {
          if (allocated) {
            guardedRecordAllocations++;
            activeGuardedRecords++;
          } else {
            assert(closeCleared);
            guardedRecordCloses++;
            activeGuardedRecords--;
            assert(activeGuardedRecords >= 0);
          }
        });
    __block NSUInteger boundaryOpens = 0;
    __block NSUInteger boundaryCloses = 0;
    __block NSInteger boundaryDepth = 0;
    AncPrivateVaultKeychainSetBoundaryHookForTesting(
        ^(BOOL opened, BOOL writeBoundary) {
          (void)writeBoundary;
          if (opened) {
            boundaryOpens++;
            boundaryDepth++;
            assert(boundaryDepth == 1);
          } else {
            boundaryCloses++;
            boundaryDepth--;
            assert(boundaryDepth == 0);
          }
        });
    AncPrivateVaultRotationPreparationSetRecordClearHookForTesting(
        ^(BOOL cleared) {
          clearedRecordCount++;
          everyRecordCleared = everyRecordCleared && cleared;
        });
    AncPrivateVaultKeychain *keychain = Keychain();
    NSURL *temporary = [NSURL
        fileURLWithPath:[NSTemporaryDirectory()
                            stringByAppendingPathComponent:NSUUID.UUID
                                                               .UUIDString]
            isDirectory:YES];
    assert([NSFileManager.defaultManager
               createDirectoryAtURL:temporary
        withIntermediateDirectories:NO
                         attributes:@{
                           NSFilePosixPermissions : @0700
                         }
                              error:nil]);
    AncPrivateVaultRotationPreparationSpoolStore *spool =
        [[AncPrivateVaultRotationPreparationSpoolStore alloc]
            initWithStateRootURL:temporary];
    AncPrivateVaultRotationPreparationStore *first =
        [[AncPrivateVaultRotationPreparationStore alloc]
            initWithKeychain:keychain
                       spool:spool];
    AncPrivateVaultRotationPreparationStore *second =
        [[AncPrivateVaultRotationPreparationStore alloc]
            initWithKeychain:keychain
                       spool:spool];
    AncPrivateVaultRotationPreparationStore *isolated =
        [[AncPrivateVaultRotationPreparationStore alloc]
            initWithKeychain:KeychainWithDomain(@"test-keychain:isolated")
                       spool:spool];
    assert(first != nil && second != nil && isolated != nil);

    const AncPrivateVaultRotationPreparationStoreFaultPoint crashPoints[] = {
        AncPrivateVaultRotationPreparationStoreFaultAfterStageWrite,
        AncPrivateVaultRotationPreparationStoreFaultBeforeFenceBegin,
        AncPrivateVaultRotationPreparationStoreFaultAfterFenceBegin,
        AncPrivateVaultRotationPreparationStoreFaultAfterLiveWrite,
        AncPrivateVaultRotationPreparationStoreFaultAfterFenceCommit,
        AncPrivateVaultRotationPreparationStoreFaultBeforeStageDelete,
    };
    for (NSUInteger index = 0;
         index < sizeof crashPoints / sizeof crashPoints[0]; index++) {
      AncPrivateVaultRotationPreparationSnapshot crashSnapshot = Snapshot();
      crashSnapshot.vault_id[0] = (uint8_t)(0xd0 + index);
      crashSnapshot.ceremony_id[0] = (uint8_t)(0xe0 + index);
      uint8_t crashKey[32];
      Fill(crashKey, sizeof crashKey, (uint8_t)(0x20 + index));
      AncPrivateVaultRotationPreparationStoreFaultPoint target =
          crashPoints[index];
      AncPrivateVaultRotationPreparationSetStoreFaultHookForTesting(
          ^BOOL(AncPrivateVaultRotationPreparationStoreFaultPoint point) {
            return point == target;
          });
      assert([first createGenesisPrepared:&crashSnapshot
                          pendingEpochKey:crashKey
                               checkpoint:nil] ==
             AncPrivateVaultRotationPreparationStoreStatusStorageFailed);
      AncPrivateVaultRotationPreparationSetStoreFaultHookForTesting(nil);
      AncPrivateVaultRotationPreparationCheckpoint *recovered = nil;
      assert([second readVaultId:crashSnapshot.vault_id
                      checkpoint:&recovered
                          handle:nil] ==
             AncPrivateVaultRotationPreparationStoreStatusOK);
      assert(recovered.fenceGeneration == 1 &&
             recovered.snapshot.phase ==
                 ANC_PV_ROTATION_PREPARATION_PHASE_PREPARED);
      anc_pv_zeroize(crashKey, sizeof crashKey);
      anc_pv_rotation_preparation_snapshot_zero(&crashSnapshot);
      assert(activeGuardedRecords == 0 &&
             guardedRecordAllocations == guardedRecordCloses);
    }

    AncPrivateVaultRotationPreparationSnapshot snapshot = Snapshot();
    uint8_t pendingKey[32];
    Fill(pendingKey, sizeof pendingKey, 0xa1);
    uint8_t *pendingKeyBytes = pendingKey;
    AncPrivateVaultRotationPreparationCheckpoint *prepared = nil;
    assert([first createGenesisPrepared:&snapshot
                        pendingEpochKey:pendingKey
                             checkpoint:&prepared] ==
           AncPrivateVaultRotationPreparationStoreStatusOK);
    assert(prepared.fenceGeneration == 1);

    AncPrivateVaultRotationPreparationCheckpoint *observed = nil;
    AncPrivateVaultRotationPreparationKeyHandle *staleHandle = nil;
    assert([second readVaultId:snapshot.vault_id
                    checkpoint:&observed
                        handle:&staleHandle] ==
           AncPrivateVaultRotationPreparationStoreStatusOK);
    assert(observed.fenceGeneration == prepared.fenceGeneration);
    assert([staleHandle borrow:^BOOL(const uint8_t *key) {
             assert(memcmp(key, pendingKeyBytes, 32) == 0);
             AncPrivateVaultRotationPreparationCheckpoint *unused = nil;
             assert([first readVaultId:snapshot.vault_id
                            checkpoint:&unused
                                handle:nil] ==
                    AncPrivateVaultRotationPreparationStoreStatusConflict);
             assert([second createGenesisPrepared:&snapshot
                                  pendingEpochKey:pendingKeyBytes
                                       checkpoint:nil] ==
                    AncPrivateVaultRotationPreparationStoreStatusConflict);
             assert([first markRewrappedVaultId:snapshot.vault_id
                             expectedCheckpoint:prepared
                                     checkpoint:nil] ==
                    AncPrivateVaultRotationPreparationStoreStatusConflict);
             assert([second armAwaitingControlCommitVaultId:snapshot.vault_id
                                         expectedCheckpoint:prepared
                                           expectedSequence:0
                                       expectedPreviousHead:snapshot.base_head
                                           transcriptDigest:pendingKeyBytes
                                                signedEntry:pendingKeyBytes
                                          signedEntryLength:1
                                               recoveryWrap:pendingKeyBytes
                                         recoveryWrapLength:1
                                                      nonce:pendingKeyBytes
                                                 checkpoint:nil] ==
                    AncPrivateVaultRotationPreparationStoreStatusConflict);
             assert([first
                        consumeAwaitingArtifactsVaultId:snapshot.vault_id
                                     expectedCheckpoint:prepared
                                               consumer:^BOOL(
                                                   const uint8_t *signedBytes,
                                                   size_t signedLength,
                                                   const uint8_t *wrapBytes,
                                                   size_t wrapLength) {
                                                 (void)signedBytes;
                                                 (void)signedLength;
                                                 (void)wrapBytes;
                                                 (void)wrapLength;
                                                 return YES;
                                               }] ==
                    AncPrivateVaultRotationPreparationStoreStatusConflict);
             return YES;
           }] == AncPrivateVaultRotationPreparationStoreStatusOK);
    AncPrivateVaultRotationPreparationKeyHandle *isolatedHandle = nil;
    assert([isolated readVaultId:snapshot.vault_id
                      checkpoint:nil
                          handle:&isolatedHandle] ==
           AncPrivateVaultRotationPreparationStoreStatusOK);

    NSString *liveKey = KeyForRotationVault(
        AncPrivateVaultRotationPreparationService, snapshot.vault_id);
    NSData *originalLive = [gStore[liveKey] copy];
    AncPrivateVaultRotationPreparationSetBeforeCommitHookForTesting(^{
      NSMutableData *changed = [originalLive mutableCopy];
      ((uint8_t *)changed.mutableBytes)[40] ^= 1;
      gStore[liveKey] = changed;
    });
    assert([first markRewrappedVaultId:snapshot.vault_id
                    expectedCheckpoint:prepared
                            checkpoint:nil] ==
           AncPrivateVaultRotationPreparationStoreStatusConflict);
    AncPrivateVaultRotationPreparationSetBeforeCommitHookForTesting(nil);
    gStore[liveKey] = originalLive;

    snapshot.phase = ANC_PV_ROTATION_PREPARATION_PHASE_REWRAPPED;
    uint8_t rewrappedBytes[ANC_PV_ROTATION_PREPARATION_RECORD_BYTES] = {0};
    assert(anc_pv_rotation_preparation_record_encode(
               &snapshot, pendingKey, rewrappedBytes, sizeof rewrappedBytes) ==
           ANC_PV_ROTATION_PREPARATION_OK);
    NSMutableData *rewrappedRecord =
        [NSMutableData dataWithBytes:rewrappedBytes
                              length:sizeof rewrappedBytes];
    anc_pv_zeroize(rewrappedBytes, sizeof rewrappedBytes);
    NSString *vaultKey = VaultKey(snapshot.vault_id);
    assert([keychain addBytes:rewrappedRecord.bytes
                       length:rewrappedRecord.length
                   forService:AncPrivateVaultRotationPreparationStageService
                      vaultId:vaultKey
                     recordId:AncPrivateVaultRotationPreparationRecordId] ==
           AncPrivateVaultKeychainStatusOK);
    assert([keychain updateBytes:rewrappedRecord.bytes
                          length:rewrappedRecord.length
                      forService:AncPrivateVaultRotationPreparationService
                         vaultId:vaultKey
                        recordId:AncPrivateVaultRotationPreparationRecordId] ==
           AncPrivateVaultKeychainStatusOK);
    AncPrivateVaultGenerationFence *fence =
        [[AncPrivateVaultGenerationFence alloc] initWithKeychain:keychain];
    assert([fence beginGeneration:2
                     recordDigest:RecordDigest(rewrappedRecord)
                          vaultId:vaultKey
                         recordId:AncPrivateVaultRotationPreparationRecordId] ==
           AncPrivateVaultFenceStatusOK);
    anc_pv_zeroize(rewrappedRecord.mutableBytes, rewrappedRecord.length);
    AncPrivateVaultRotationPreparationCheckpoint *rewrapped = nil;
    assert([second readVaultId:snapshot.vault_id
                    checkpoint:&rewrapped
                        handle:nil] ==
           AncPrivateVaultRotationPreparationStoreStatusOK);
    assert(rewrapped.fenceGeneration == 2 &&
           rewrapped.snapshot.phase ==
               ANC_PV_ROTATION_PREPARATION_PHASE_REWRAPPED);
    assert(staleHandle.closed);
    assert(!isolatedHandle.closed);
    assert([isolatedHandle borrow:^BOOL(const uint8_t *key) {
             return memcmp(key, pendingKeyBytes, 32) == 0;
           }] == AncPrivateVaultRotationPreparationStoreStatusOK);
    assert([isolatedHandle close] ==
           AncPrivateVaultRotationPreparationStoreStatusOK);
    assert([staleHandle borrow:^BOOL(const uint8_t *key) {
             (void)key;
             return YES;
           }] != AncPrivateVaultRotationPreparationStoreStatusOK);
    assert([second markRewrappedVaultId:snapshot.vault_id
                     expectedCheckpoint:prepared
                             checkpoint:nil] ==
           AncPrivateVaultRotationPreparationStoreStatusConflict);

    AncPrivateVaultRotationPreparationCheckpoint *acknowledged = nil;
    assert([second markAcknowledgedVaultId:snapshot.vault_id
                        expectedCheckpoint:rewrapped
                                checkpoint:&acknowledged] ==
           AncPrivateVaultRotationPreparationStoreStatusOK);
    assert(acknowledged.snapshot.phase ==
           ANC_PV_ROTATION_PREPARATION_PHASE_ACKNOWLEDGED);

    uint8_t transcript[32];
    uint8_t nonce[24];
    Fill(transcript, sizeof transcript, 0xb1);
    Fill(nonce, sizeof nonce, 0xc1);
    const uint8_t signedEntry[] = {1, 2, 3, 4};
    const uint8_t recoveryWrap[] = {9, 8, 7};
    const uint8_t *signedEntryBytes = signedEntry;
    const uint8_t *recoveryWrapBytes = recoveryWrap;
    AncPrivateVaultRotationPreparationCheckpoint *awaiting = nil;
    AncPrivateVaultRotationPreparationSetStoreFaultHookForTesting(
        ^BOOL(AncPrivateVaultRotationPreparationStoreFaultPoint point) {
          return point ==
                 AncPrivateVaultRotationPreparationStoreFaultAfterSpoolStage;
        });
    assert([first armAwaitingControlCommitVaultId:snapshot.vault_id
                               expectedCheckpoint:acknowledged
                                 expectedSequence:snapshot.base_sequence + 1
                             expectedPreviousHead:snapshot.base_head
                                 transcriptDigest:transcript
                                      signedEntry:signedEntry
                                signedEntryLength:sizeof signedEntry
                                     recoveryWrap:recoveryWrap
                               recoveryWrapLength:sizeof recoveryWrap
                                            nonce:nonce
                                       checkpoint:&awaiting] ==
           AncPrivateVaultRotationPreparationStoreStatusStorageFailed);
    assert(awaiting == nil);
    AncPrivateVaultRotationPreparationSetStoreFaultHookForTesting(
        ^BOOL(AncPrivateVaultRotationPreparationStoreFaultPoint point) {
          return point ==
                 AncPrivateVaultRotationPreparationStoreFaultBeforeSpoolPromote;
        });
    assert([first armAwaitingControlCommitVaultId:snapshot.vault_id
                               expectedCheckpoint:acknowledged
                                 expectedSequence:snapshot.base_sequence + 1
                             expectedPreviousHead:snapshot.base_head
                                 transcriptDigest:transcript
                                      signedEntry:signedEntry
                                signedEntryLength:sizeof signedEntry
                                     recoveryWrap:recoveryWrap
                               recoveryWrapLength:sizeof recoveryWrap
                                            nonce:nonce
                                       checkpoint:&awaiting] ==
           AncPrivateVaultRotationPreparationStoreStatusStorageFailed);
    assert(awaiting == nil);
    AncPrivateVaultRotationPreparationSetStoreFaultHookForTesting(nil);
    assert([second readVaultId:snapshot.vault_id
                    checkpoint:&awaiting
                        handle:nil] ==
           AncPrivateVaultRotationPreparationStoreStatusOK);
    assert(awaiting.snapshot.phase ==
           ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT);
    __block BOOL consumed = NO;
    assert(
        [second
            consumeAwaitingArtifactsVaultId:snapshot.vault_id
                         expectedCheckpoint:awaiting
                                   consumer:^BOOL(const uint8_t *signedBytes,
                                                  size_t signedLength,
                                                  const uint8_t *wrapBytes,
                                                  size_t wrapLength) {
                                     consumed = YES;
                                     return signedLength ==
                                                sizeof signedEntry &&
                                            wrapLength == sizeof recoveryWrap &&
                                            memcmp(signedBytes,
                                                   signedEntryBytes,
                                                   signedLength) == 0 &&
                                            memcmp(wrapBytes, recoveryWrapBytes,
                                                   wrapLength) == 0;
                                   }] ==
        AncPrivateVaultRotationPreparationStoreStatusOK);
    assert(consumed);

    NSString *rotationVaultKey = VaultKey(snapshot.vault_id);
    NSUInteger opensBeforeThrow = boundaryOpens;
    assert(
        [keychain
            consumeBytesForService:AncPrivateVaultRotationPreparationService
                           vaultId:rotationVaultKey
                          recordId:AncPrivateVaultRotationPreparationRecordId
                          consumer:^BOOL(const uint8_t *bytes, size_t length) {
                            (void)bytes;
                            (void)length;
                            @throw [NSException exceptionWithName:@"test"
                                                           reason:nil
                                                         userInfo:nil];
                          }] == AncPrivateVaultKeychainStatusCorrupt);
    assert(boundaryOpens == opensBeforeThrow + 1 &&
           boundaryOpens == boundaryCloses && boundaryDepth == 0);
    NSString *rotationStoreKey = KeyForRotationVault(
        AncPrivateVaultRotationPreparationService, snapshot.vault_id);
    NSData *savedRotationRecord = gStore[rotationStoreKey];
    for (NSNumber *invalidLength in @[ @0, @511, @513 ]) {
      gStore[rotationStoreKey] =
          [NSMutableData dataWithLength:invalidLength.unsignedIntegerValue];
      NSUInteger opensBeforeLength = boundaryOpens;
      __block BOOL invalidCallbackCalled = NO;
      assert(
          [keychain
              consumeBytesForService:AncPrivateVaultRotationPreparationService
                             vaultId:rotationVaultKey
                            recordId:AncPrivateVaultRotationPreparationRecordId
                            consumer:^BOOL(const uint8_t *bytes,
                                           size_t length) {
                              (void)bytes;
                              (void)length;
                              invalidCallbackCalled = YES;
                              return YES;
                            }] == AncPrivateVaultKeychainStatusCorrupt);
      assert(!invalidCallbackCalled && boundaryOpens == opensBeforeLength + 1 &&
             boundaryOpens == boundaryCloses && boundaryDepth == 0);
      NSUInteger clearsBeforeInvalidRead = clearedRecordCount;
      assert([first readVaultId:snapshot.vault_id checkpoint:nil handle:nil] ==
             AncPrivateVaultRotationPreparationStoreStatusCorrupt);
      assert(clearedRecordCount > clearsBeforeInvalidRead &&
             everyRecordCleared && boundaryOpens == boundaryCloses &&
             boundaryDepth == 0);
    }
    gStore[rotationStoreKey] = savedRotationRecord;

    anc_pv_zeroize(pendingKey, sizeof pendingKey);
    anc_pv_rotation_preparation_snapshot_zero(&snapshot);
    assert(clearedRecordCount >= 4 && everyRecordCleared);
    assert(activeGuardedRecords == 0 && guardedRecordAllocations > 0 &&
           guardedRecordAllocations == guardedRecordCloses);
    assert(boundaryOpens > 0 && boundaryOpens == boundaryCloses &&
           boundaryDepth == 0);
    AncPrivateVaultKeychainSetBoundaryHookForTesting(nil);
    AncPrivateVaultRotationPreparationSetRecordClearHookForTesting(nil);
    AncPrivateVaultRotationPreparationSetRecordLifecycleHookForTesting(nil);
    assert([NSFileManager.defaultManager removeItemAtURL:temporary error:nil]);
    puts("Private Vault rotation-preparation store tests passed");
  }
  return 0;
}
