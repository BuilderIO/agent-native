#import <Foundation/Foundation.h>

#import "PrivateVaultGenesisPreparationStore.h"

#include <assert.h>

static NSMutableDictionary<NSString *, NSData *> *gStore;

static NSString *StoreKey(NSDictionary *query) {
  return [NSString
      stringWithFormat:@"%@|%@", query[(__bridge id)kSecAttrService],
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

static OSStatus MockAdd(CFDictionaryRef rawAttributes, CFTypeRef *result) {
  (void)result;
  NSDictionary *attributes = (__bridge NSDictionary *)rawAttributes;
  NSString *key = StoreKey(attributes);
  if (gStore[key] != nil)
    return errSecDuplicateItem;
  NSData *value = attributes[(__bridge id)kSecValueData];
  gStore[key] = [NSData dataWithBytes:value.bytes length:value.length];
  return errSecSuccess;
}

static OSStatus MockUpdate(CFDictionaryRef rawQuery,
                           CFDictionaryRef rawAttributes) {
  NSString *key = StoreKey((__bridge NSDictionary *)rawQuery);
  if (gStore[key] == nil)
    return errSecItemNotFound;
  NSData *value =
      ((__bridge NSDictionary *)rawAttributes)[(__bridge id)kSecValueData];
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

static AncPrivateVaultKeychain *Keychain(NSString *domain) {
  AncPrivateVaultSecItemFunctions functions = {
      .copyMatching = MockCopy,
      .add = MockAdd,
      .update = MockUpdate,
      .deleteItem = MockDelete,
  };
  return [[AncPrivateVaultKeychain alloc]
      initWithFunctions:functions
           contextFactory:^LAContext * {
             return [[LAContext alloc] init];
           }
            storageDomain:domain];
}

static void Fill(uint8_t *bytes, size_t length, uint8_t start) {
  for (size_t index = 0; index < length; index++)
    bytes[index] = (uint8_t)(start + index);
}

static AncPrivateVaultGenesisPreparationSnapshot
PreparedSnapshot(const uint8_t handle[48], uint8_t discriminator) {
  AncPrivateVaultGenesisPreparationSnapshot snapshot = {0};
  snapshot.phase = ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED;
  snapshot.generation = 1;
  snapshot.prepared_at_ms = 100000 + discriminator;
  snapshot.expires_at_ms = snapshot.prepared_at_ms + 300000;
  memcpy(snapshot.preparation_lookup_id, handle, 16);
  assert(anc_pv_genesis_preparation_handle_digest(
             handle, 48, snapshot.handle_digest) ==
         ANC_PV_GENESIS_PREPARATION_OK);
  Fill(snapshot.vault_id, 16, (uint8_t)(0x10 + discriminator));
  Fill(snapshot.ceremony_id, 16, (uint8_t)(0x20 + discriminator));
  Fill(snapshot.endpoint_id, 16, (uint8_t)(0x30 + discriminator));
  Fill(snapshot.recovery_wrap_envelope_id, 16,
       (uint8_t)(0x40 + discriminator));
  Fill(snapshot.endpoint_envelope_id, 16,
       (uint8_t)(0x50 + discriminator));
  Fill(snapshot.log_entry_envelope_id, 16,
       (uint8_t)(0x60 + discriminator));
  Fill(snapshot.authorization_envelope_id, 16,
       (uint8_t)(0x70 + discriminator));
  Fill(snapshot.recovery_wrap_nonce, 24,
       (uint8_t)(0x80 + discriminator));
  Fill(snapshot.endpoint_signing_public_key, 32,
       (uint8_t)(0x90 + discriminator));
  Fill(snapshot.endpoint_agreement_public_key, 32,
       (uint8_t)(0xa0 + discriminator));
  Fill(snapshot.recovery_id, 16, (uint8_t)(0xb0 + discriminator));
  Fill(snapshot.recovery_signing_public_key, 32,
       (uint8_t)(0xc0 + discriminator));
  Fill(snapshot.recovery_agreement_public_key, 32,
       (uint8_t)(0xd0 + discriminator));
  return snapshot;
}

static AncPrivateVaultGenesisPreparationSecretInputs
SecretInputs(uint8_t secrets[160], uint8_t discriminator) {
  Fill(secrets, 160, (uint8_t)(1 + discriminator));
  AncPrivateVaultGenesisPreparationSecretInputs inputs = {
      secrets, secrets + 32, secrets + 64, secrets + 96, secrets + 128};
  return inputs;
}

static BOOL SnapshotIsZero(
    const AncPrivateVaultGenesisPreparationSnapshot *snapshot) {
  const uint8_t *bytes = (const uint8_t *)snapshot;
  uint8_t aggregate = 0;
  for (size_t index = 0; index < sizeof(*snapshot); index++)
    aggregate |= bytes[index];
  return aggregate == 0;
}

static NSString *LookupKey(const uint8_t lookupId[16]) {
  NSMutableString *key = [NSMutableString stringWithCapacity:32];
  for (size_t index = 0; index < 16; index++)
    [key appendFormat:@"%02x", lookupId[index]];
  return key;
}

static NSData *EncodeRecord(
    const AncPrivateVaultGenesisPreparationSnapshot *snapshot,
    const AncPrivateVaultGenesisPreparationSecretInputs *secrets) {
  NSMutableData *record =
      [NSMutableData dataWithLength:ANC_PV_GENESIS_PREPARATION_RECORD_BYTES];
  AncPrivateVaultGenesisPreparationRecordStatus status =
      anc_pv_genesis_preparation_record_encode(
          snapshot, secrets, record.mutableBytes, record.length);
  assert(status == ANC_PV_GENESIS_PREPARATION_OK);
  return record;
}

static NSData *RecordDigest(NSData *record) {
  static const char domain[] =
      "anc/v1/private-vault/genesis-preparation-record/fence";
  uint8_t digest[32] = {0};
  assert(anc_pv_blake2b_256_two_part(
             digest, (const uint8_t *)domain, sizeof domain, record.bytes,
             record.length) == ANC_PV_CRYPTO_OK);
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static NSData *ReadRecord(AncPrivateVaultKeychain *keychain,
                          NSString *service, const uint8_t lookupId[16]) {
  __block NSData *record = nil;
  assert([keychain
             consumeGenesisPreparationRecordForService:service
                                                vaultId:LookupKey(lookupId)
                                               recordId:AncPrivateVaultGenesisPreparationRecordId
                                               consumer:^BOOL(const uint8_t *bytes) {
    record = [NSData dataWithBytes:bytes
                           length:ANC_PV_GENESIS_PREPARATION_RECORD_BYTES];
    return YES;
  }] == AncPrivateVaultKeychainStatusOK);
  return record;
}

static AncPrivateVaultGenesisPreparationSnapshot ExpiredSnapshot(
    AncPrivateVaultGenesisPreparationSnapshot prepared) {
  prepared.phase = ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED;
  prepared.flags = ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED;
  prepared.generation = 2;
  prepared.terminal_at_ms = prepared.expires_at_ms + 1;
  return prepared;
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    gStore = [NSMutableDictionary dictionary];
    NSURL *temporary = [NSURL
        fileURLWithPath:[NSTemporaryDirectory()
                            stringByAppendingPathComponent:NSUUID.UUID
                                                               .UUIDString]
            isDirectory:YES];
    assert([NSFileManager.defaultManager
               createDirectoryAtURL:temporary
        withIntermediateDirectories:NO
                         attributes:@{NSFilePosixPermissions : @0700}
                              error:nil]);
    AncPrivateVaultKeychain *keychain = Keychain(@"genesis-store-tests");
    AncPrivateVaultGenerationFence *fence =
        [[AncPrivateVaultGenerationFence alloc] initWithKeychain:keychain];
    AncPrivateVaultGenesisPreparationArtifactStore *artifacts =
        [[AncPrivateVaultGenesisPreparationArtifactStore alloc]
            initWithStateRootURL:temporary];
    AncPrivateVaultGenesisPreparationStore *first =
        [[AncPrivateVaultGenesisPreparationStore alloc]
            initWithKeychain:keychain
                       fence:fence
               artifactStore:artifacts];
    AncPrivateVaultGenesisPreparationStore *second =
        [[AncPrivateVaultGenesisPreparationStore alloc]
            initWithKeychain:keychain
                       fence:fence
               artifactStore:artifacts];
    assert(first != nil && second != nil);

    __block NSInteger guardedActive = 0;
    __block NSUInteger guardedAllocations = 0;
    __block NSUInteger guardedCloses = 0;
    AncPrivateVaultGenesisPreparationSetRecordLifecycleHookForTesting(
        ^(BOOL allocated, BOOL closeCleared) {
          if (allocated) {
            guardedAllocations++;
            guardedActive++;
          } else {
            assert(closeCleared);
            guardedCloses++;
            guardedActive--;
            assert(guardedActive >= 0);
          }
        });

    const AncPrivateVaultGenesisPreparationStoreFaultPoint crashPoints[] = {
        AncPrivateVaultGenesisPreparationStoreFaultAfterStageWrite,
        AncPrivateVaultGenesisPreparationStoreFaultBeforeFenceBegin,
        AncPrivateVaultGenesisPreparationStoreFaultAfterFenceBegin,
        AncPrivateVaultGenesisPreparationStoreFaultAfterLiveWrite,
        AncPrivateVaultGenesisPreparationStoreFaultAfterFenceCommit,
        AncPrivateVaultGenesisPreparationStoreFaultBeforeStageDelete,
    };
    const AncPrivateVaultGenesisPreparationStoreStatus crashResults[] = {
        AncPrivateVaultGenesisPreparationStoreStatusOK,
        AncPrivateVaultGenesisPreparationStoreStatusFailed,
        AncPrivateVaultGenesisPreparationStoreStatusFailed,
        AncPrivateVaultGenesisPreparationStoreStatusFailed,
        AncPrivateVaultGenesisPreparationStoreStatusOK,
        AncPrivateVaultGenesisPreparationStoreStatusOK,
    };
    for (size_t index = 0;
         index < sizeof crashPoints / sizeof crashPoints[0]; index++) {
      uint8_t handle[48];
      Fill(handle, sizeof handle, (uint8_t)(0x11 + index * 3));
      AncPrivateVaultGenesisPreparationSnapshot snapshot =
          PreparedSnapshot(handle, (uint8_t)index);
      uint8_t secretBytes[160];
      AncPrivateVaultGenesisPreparationSecretInputs secrets =
          SecretInputs(secretBytes, (uint8_t)index);
      AncPrivateVaultGenesisPreparationStoreFaultPoint target =
          crashPoints[index];
      AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(
          ^BOOL(AncPrivateVaultGenesisPreparationStoreFaultPoint point) {
            return point == target;
          });
      assert([first createSnapshot:&snapshot
                           secrets:&secrets
                            handle:handle
                      handleLength:sizeof handle] == crashResults[index]);
      AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(nil);
      assert([second reconcileLookupId:handle length:16] ==
             AncPrivateVaultGenesisPreparationStoreStatusOK);
      anc_pv_zeroize(secretBytes, sizeof secretBytes);
      anc_pv_genesis_preparation_snapshot_zero(&snapshot);
      assert(guardedActive == 0 && guardedAllocations == guardedCloses);
    }

    NSArray<NSData *> *beforeOrphanAttempts = nil;
    assert([first listPreparationLookupIds:&beforeOrphanAttempts] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);
    uint8_t orphanHandle[48];
    Fill(orphanHandle, sizeof orphanHandle, 0x39);
    AncPrivateVaultGenesisPreparationSnapshot orphanSnapshot =
        PreparedSnapshot(orphanHandle, 0x13);
    uint8_t orphanSecretBytes[160];
    AncPrivateVaultGenesisPreparationSecretInputs orphanSecrets =
        SecretInputs(orphanSecretBytes, 0x23);
    AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(
        ^BOOL(AncPrivateVaultGenesisPreparationStoreFaultPoint point) {
          return point ==
                 AncPrivateVaultGenesisPreparationStoreFaultAfterMarkerBeforeStageWrite;
        });
    for (NSUInteger attempt = 0; attempt < 300; attempt++) {
      assert([first createSnapshot:&orphanSnapshot
                           secrets:&orphanSecrets
                            handle:orphanHandle
                      handleLength:sizeof orphanHandle] ==
             AncPrivateVaultGenesisPreparationStoreStatusFailed);
    }
    AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(nil);
    NSArray<NSData *> *afterOrphanAttempts = nil;
    assert([first listPreparationLookupIds:&afterOrphanAttempts] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);
    assert(afterOrphanAttempts.count == beforeOrphanAttempts.count);
    anc_pv_zeroize(orphanSecretBytes, sizeof orphanSecretBytes);
    anc_pv_genesis_preparation_snapshot_zero(&orphanSnapshot);

    uint8_t handle[48];
    uint8_t *handlePointer = handle;
    Fill(handle, sizeof handle, 0x51);
    AncPrivateVaultGenesisPreparationSnapshot prepared =
        PreparedSnapshot(handle, 0x21);
    uint8_t secretBytes[160];
    uint8_t *secretBytesPointer = secretBytes;
    AncPrivateVaultGenesisPreparationSecretInputs secrets =
        SecretInputs(secretBytes, 0x31);
    AncPrivateVaultGenesisPreparationSnapshot *preparedPointer = &prepared;
    AncPrivateVaultGenesisPreparationSecretInputs *secretsPointer = &secrets;
    assert([first createSnapshot:&prepared
                         secrets:&secrets
                          handle:handle
                    handleLength:sizeof handle] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);
    assert([second createSnapshot:&prepared
                          secrets:&secrets
                           handle:handle
                     handleLength:sizeof handle] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);
    uint8_t crossToken[48];
    memcpy(crossToken, handle, sizeof crossToken);
    crossToken[47] ^= 0x80;
    AncPrivateVaultGenesisPreparationSnapshot crossTokenSnapshot =
        PreparedSnapshot(crossToken, 0x21);
    assert([second createSnapshot:&crossTokenSnapshot
                          secrets:&secrets
                           handle:crossToken
                     handleLength:sizeof crossToken] ==
           AncPrivateVaultGenesisPreparationStoreStatusConflict);
    AncPrivateVaultGenesisPreparationSnapshot substitutedSnapshot = prepared;
    substitutedSnapshot.endpoint_signing_public_key[0] ^= 1;
    uint8_t substitutedSecretBytes[160];
    AncPrivateVaultGenesisPreparationSecretInputs substitutedSecrets =
        SecretInputs(substitutedSecretBytes, 0x32);
    assert([second createSnapshot:&substitutedSnapshot
                          secrets:&substitutedSecrets
                           handle:handle
                     handleLength:sizeof handle] ==
           AncPrivateVaultGenesisPreparationStoreStatusConflict);
    anc_pv_zeroize(substitutedSecretBytes, sizeof substitutedSecretBytes);
    anc_pv_genesis_preparation_snapshot_zero(&crossTokenSnapshot);
    anc_pv_genesis_preparation_snapshot_zero(&substitutedSnapshot);
    NSMutableArray<NSNumber *> *concurrentStatuses = [NSMutableArray array];
    dispatch_apply(8, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0),
                   ^(size_t index) {
      (void)index;
      AncPrivateVaultGenesisPreparationStoreStatus status =
          [first createSnapshot:preparedPointer
                        secrets:secretsPointer
                         handle:handlePointer
                   handleLength:ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES];
      @synchronized(concurrentStatuses) {
        [concurrentStatuses addObject:@(status)];
      }
    });
    assert(concurrentStatuses.count == 8);
    for (NSNumber *status in concurrentStatuses) {
      assert(status.integerValue ==
             AncPrivateVaultGenesisPreparationStoreStatusOK);
    }

    uint8_t wrongHandle[48];
    memcpy(wrongHandle, handle, sizeof wrongHandle);
    wrongHandle[47] ^= 1;
    AncPrivateVaultGenesisPreparationSnapshot hidden;
    memset(&hidden, 0xa5, sizeof hidden);
    AncPrivateVaultGenesisPreparationSecretsHandle *hiddenSecrets =
        (AncPrivateVaultGenesisPreparationSecretsHandle *)[NSObject new];
    assert([second readHandle:wrongHandle
                  handleLength:sizeof wrongHandle
                     snapshot:&hidden
                  secretHandle:&hiddenSecrets] ==
           AncPrivateVaultGenesisPreparationStoreStatusNotFound);
    assert(SnapshotIsZero(&hidden) && hiddenSecrets == nil);
    assert([second transitionHandle:wrongHandle
                       handleLength:sizeof wrongHandle
                       nextSnapshot:&prepared
                            secrets:&secrets] ==
           AncPrivateVaultGenesisPreparationStoreStatusInvalid);

    AncPrivateVaultGenesisPreparationSnapshot observed;
    AncPrivateVaultGenesisPreparationSecretsHandle *observedSecrets = nil;
    assert([second readHandle:handle
                  handleLength:sizeof handle
                     snapshot:&observed
                  secretHandle:&observedSecrets] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);
    assert(observed.phase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED);
    assert([observedSecrets borrow:^BOOL(
                                const AncPrivateVaultGenesisPreparationSecretInputs *value) {
             return memcmp(value->recovery_entropy, secretBytesPointer, 32) ==
                        0 &&
                    memcmp(value->epoch_one_eek, secretBytesPointer + 128,
                           32) == 0;
           }] == AncPrivateVaultGenesisPreparationStoreStatusOK);
    assert([observedSecrets close] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);
    assert(observedSecrets.closed);
    assert([observedSecrets borrow:^BOOL(
                                const AncPrivateVaultGenesisPreparationSecretInputs *value) {
             (void)value;
             return YES;
           }] == AncPrivateVaultGenesisPreparationStoreStatusInvalid);

    NSString *lookupKey = LookupKey(handle);
    NSData *liveRecord = ReadRecord(
        keychain, AncPrivateVaultGenesisPreparationService, handle);
    assert([keychain addGenesisPreparationRecord:liveRecord.bytes
                                           length:liveRecord.length
                                       forService:AncPrivateVaultGenesisPreparationStageService
                                          vaultId:lookupKey
                                         recordId:AncPrivateVaultGenesisPreparationRecordId] ==
           AncPrivateVaultKeychainStatusOK);
    assert([second reconcileLookupId:handle length:16] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);

    uint8_t zeroSecretBytes[160] = {0};
    AncPrivateVaultGenesisPreparationSecretInputs zeroSecrets = {
        zeroSecretBytes, zeroSecretBytes + 32, zeroSecretBytes + 64,
        zeroSecretBytes + 96, zeroSecretBytes + 128};
    AncPrivateVaultGenesisPreparationSnapshot expired =
        ExpiredSnapshot(prepared);
    NSData *expiredRecord = EncodeRecord(&expired, &zeroSecrets);
    assert([keychain addGenesisPreparationRecord:expiredRecord.bytes
                                           length:expiredRecord.length
                                       forService:AncPrivateVaultGenesisPreparationStageService
                                          vaultId:lookupKey
                                         recordId:AncPrivateVaultGenesisPreparationRecordId] ==
           AncPrivateVaultKeychainStatusOK);
    assert([second reconcileLookupId:handle length:16] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);

    uint8_t pendingHandle[48];
    Fill(pendingHandle, sizeof pendingHandle, 0x71);
    AncPrivateVaultGenesisPreparationSnapshot pendingPrepared =
        PreparedSnapshot(pendingHandle, 0x41);
    uint8_t pendingSecretBytes[160];
    AncPrivateVaultGenesisPreparationSecretInputs pendingSecrets =
        SecretInputs(pendingSecretBytes, 0x51);
    assert([first createSnapshot:&pendingPrepared
                         secrets:&pendingSecrets
                          handle:pendingHandle
                    handleLength:sizeof pendingHandle] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);
    AncPrivateVaultGenesisPreparationSnapshot pendingExpired =
        ExpiredSnapshot(pendingPrepared);
    NSData *pendingRecord = EncodeRecord(&pendingExpired, &zeroSecrets);
    NSString *pendingKey = LookupKey(pendingHandle);
    assert([keychain addGenesisPreparationRecord:pendingRecord.bytes
                                           length:pendingRecord.length
                                       forService:AncPrivateVaultGenesisPreparationStageService
                                          vaultId:pendingKey
                                         recordId:AncPrivateVaultGenesisPreparationRecordId] ==
           AncPrivateVaultKeychainStatusOK);
    assert([fence beginGeneration:2
                     recordDigest:RecordDigest(pendingRecord)
                          vaultId:pendingKey
                         recordId:AncPrivateVaultGenesisPreparationRecordId] ==
           AncPrivateVaultFenceStatusOK);
    assert([second reconcileLookupId:pendingHandle length:16] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);

    uint8_t conflictHandle[48];
    Fill(conflictHandle, sizeof conflictHandle, 0x91);
    AncPrivateVaultGenesisPreparationSnapshot conflictPrepared =
        PreparedSnapshot(conflictHandle, 0x61);
    uint8_t conflictSecretBytes[160];
    AncPrivateVaultGenesisPreparationSecretInputs conflictSecrets =
        SecretInputs(conflictSecretBytes, 0x71);
    assert([first createSnapshot:&conflictPrepared
                         secrets:&conflictSecrets
                          handle:conflictHandle
                    handleLength:sizeof conflictHandle] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);
    AncPrivateVaultGenesisPreparationSnapshot disagree = conflictPrepared;
    disagree.vault_id[0] ^= 1;
    NSData *disagreeRecord = EncodeRecord(&disagree, &conflictSecrets);
    assert([keychain addGenesisPreparationRecord:disagreeRecord.bytes
                                           length:disagreeRecord.length
                                       forService:AncPrivateVaultGenesisPreparationStageService
                                          vaultId:LookupKey(conflictHandle)
                                         recordId:AncPrivateVaultGenesisPreparationRecordId] ==
           AncPrivateVaultKeychainStatusOK);
    assert([second reconcileLookupId:conflictHandle length:16] ==
           AncPrivateVaultGenesisPreparationStoreStatusRollbackDetected);

    uint8_t retirementHandle[48];
    Fill(retirementHandle, sizeof retirementHandle, 0xb1);
    AncPrivateVaultGenesisPreparationSnapshot retirementPrepared =
        PreparedSnapshot(retirementHandle, 0x72);
    uint8_t retirementSecretBytes[160];
    AncPrivateVaultGenesisPreparationSecretInputs retirementSecrets =
        SecretInputs(retirementSecretBytes, 0x42);
    assert([first createSnapshot:&retirementPrepared
                         secrets:&retirementSecrets
                          handle:retirementHandle
                    handleLength:sizeof retirementHandle] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);
    AncPrivateVaultGenesisPreparationSnapshot retirementExpired =
        ExpiredSnapshot(retirementPrepared);
    assert([first transitionHandle:retirementHandle
                       handleLength:sizeof retirementHandle
                       nextSnapshot:&retirementExpired
                            secrets:&zeroSecrets] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);
    AncPrivateVaultGenesisPreparationArtifactSetFaultHookForTesting(
        ^BOOL(AncPrivateVaultGenesisPreparationArtifactFaultPoint point) {
          return point ==
                 AncPrivateVaultGenesisPreparationArtifactFaultBeforeUnlink;
        });
    assert([second reconcileLookupId:retirementHandle length:16] ==
           AncPrivateVaultGenesisPreparationStoreStatusFailed);
    AncPrivateVaultGenesisPreparationArtifactSetFaultHookForTesting(nil);
    assert([second reconcileLookupId:retirementHandle length:16] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);
    assert([second reconcileLookupId:retirementHandle length:16] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);

    NSArray<NSData *> *beforeRetirementSeries = nil;
    assert([first listPreparationLookupIds:&beforeRetirementSeries] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);
    uint8_t seriesSecretBytes[160];
    AncPrivateVaultGenesisPreparationSecretInputs seriesSecrets =
        SecretInputs(seriesSecretBytes, 0x52);
    for (uint32_t index = 0; index < 300; index++) {
      uint8_t seriesHandle[48];
      Fill(seriesHandle, sizeof seriesHandle, 0xd1);
      memcpy(seriesHandle, &index, sizeof index);
      AncPrivateVaultGenesisPreparationSnapshot seriesPrepared =
          PreparedSnapshot(seriesHandle, (uint8_t)(0x82 + index));
      assert([first createSnapshot:&seriesPrepared
                           secrets:&seriesSecrets
                            handle:seriesHandle
                      handleLength:sizeof seriesHandle] ==
             AncPrivateVaultGenesisPreparationStoreStatusOK);
      AncPrivateVaultGenesisPreparationSnapshot seriesExpired =
          ExpiredSnapshot(seriesPrepared);
      assert([first transitionHandle:seriesHandle
                         handleLength:sizeof seriesHandle
                         nextSnapshot:&seriesExpired
                              secrets:&zeroSecrets] ==
             AncPrivateVaultGenesisPreparationStoreStatusOK);
      assert([second reconcileLookupId:seriesHandle length:16] ==
             AncPrivateVaultGenesisPreparationStoreStatusOK);
      anc_pv_genesis_preparation_snapshot_zero(&seriesPrepared);
      anc_pv_genesis_preparation_snapshot_zero(&seriesExpired);
    }
    NSArray<NSData *> *afterRetirementSeries = nil;
    assert([first listPreparationLookupIds:&afterRetirementSeries] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);
    assert(afterRetirementSeries.count == beforeRetirementSeries.count);
    anc_pv_zeroize(seriesSecretBytes, sizeof seriesSecretBytes);
    anc_pv_zeroize(retirementSecretBytes, sizeof retirementSecretBytes);
    anc_pv_genesis_preparation_snapshot_zero(&retirementPrepared);
    anc_pv_genesis_preparation_snapshot_zero(&retirementExpired);

    NSArray<NSData *> *lookupIds = nil;
    assert([first listPreparationLookupIds:&lookupIds] ==
           AncPrivateVaultGenesisPreparationStoreStatusOK);
    __block BOOL listed = NO;
    [lookupIds enumerateObjectsUsingBlock:^(NSData *lookup, NSUInteger index,
                                            BOOL *stop) {
      (void)index;
      if (lookup.length == 16 && memcmp(lookup.bytes, handlePointer, 16) == 0) {
        listed = YES;
        *stop = YES;
      }
    }];
    assert(!listed);
    assert([first reconcileLookupId:handle length:15] ==
           AncPrivateVaultGenesisPreparationStoreStatusInvalid);
    assert([first reconcileHandle:handle handleLength:47] ==
           AncPrivateVaultGenesisPreparationStoreStatusInvalid);

    anc_pv_zeroize(secretBytes, sizeof secretBytes);
    anc_pv_genesis_preparation_snapshot_zero(&prepared);
    anc_pv_genesis_preparation_snapshot_zero(&observed);
    assert(guardedActive == 0 && guardedAllocations > 0 &&
           guardedAllocations == guardedCloses);
    AncPrivateVaultGenesisPreparationSetRecordLifecycleHookForTesting(nil);
    assert([NSFileManager.defaultManager removeItemAtURL:temporary error:nil]);
    puts("Private Vault genesis-preparation store tests passed");
  }
  return 0;
}
