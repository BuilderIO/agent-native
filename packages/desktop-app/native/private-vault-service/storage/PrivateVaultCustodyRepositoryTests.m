#import <Foundation/Foundation.h>

#import "PrivateVaultCustodyRepository.h"

#include <assert.h>

typedef struct TestSecrets {
  uint8_t signingSeed[32];
  uint8_t boxSeed[32];
  uint8_t localKey[32];
  uint8_t activeKey[32];
  uint8_t pendingKey[32];
} TestSecrets;

static NSMutableDictionary<NSString *, NSData *> *gStore;
static NSUInteger gMutationCount;
static NSUInteger gFailBefore;
static NSUInteger gCommitThenError;
static BOOL gBlockNextLiveCopy;
static dispatch_semaphore_t gLiveCopyEntered;
static dispatch_semaphore_t gReleaseLiveCopy;

static NSString *StoreKey(NSDictionary *query) {
  return [NSString stringWithFormat:@"%@|%@",
                                    query[(__bridge id)kSecAttrService],
                                    query[(__bridge id)kSecAttrAccount]];
}

static OSStatus MockCopy(CFDictionaryRef rawQuery, CFTypeRef *result) {
  NSDictionary *query = (__bridge NSDictionary *)rawQuery;
  if (gBlockNextLiveCopy &&
      [query[(__bridge id)kSecAttrService]
          isEqualToString:AncPrivateVaultCustodyService]) {
    gBlockNextLiveCopy = NO;
    dispatch_semaphore_signal(gLiveCopyEntered);
    dispatch_semaphore_wait(gReleaseLiveCopy, DISPATCH_TIME_FOREVER);
  }
  NSData *value = gStore[StoreKey(query)];
  if (value == nil) return errSecItemNotFound;
  if (result != NULL) *result = CFBridgingRetain([value copy]);
  return errSecSuccess;
}

static OSStatus Mutation(NSDictionary *query, NSData *_Nullable value,
                         BOOL deleting) {
  gMutationCount += 1;
  if (gFailBefore == gMutationCount) return errSecInternalComponent;
  NSString *key = StoreKey(query);
  if (deleting) {
    if (gStore[key] == nil) return errSecItemNotFound;
    [gStore removeObjectForKey:key];
  } else {
    gStore[key] = [value copy];
  }
  return gCommitThenError == gMutationCount ? errSecInternalComponent
                                             : errSecSuccess;
}

static OSStatus MockAdd(CFDictionaryRef raw, CFTypeRef *result) {
  (void)result;
  NSDictionary *attributes = (__bridge NSDictionary *)raw;
  if (gStore[StoreKey(attributes)] != nil) return errSecDuplicateItem;
  return Mutation(attributes, attributes[(__bridge id)kSecValueData], NO);
}

static OSStatus MockUpdate(CFDictionaryRef rawQuery,
                           CFDictionaryRef rawAttributes) {
  NSDictionary *query = (__bridge NSDictionary *)rawQuery;
  if (gStore[StoreKey(query)] == nil) return errSecItemNotFound;
  NSDictionary *attributes = (__bridge NSDictionary *)rawAttributes;
  return Mutation(query, attributes[(__bridge id)kSecValueData], NO);
}

static OSStatus MockDelete(CFDictionaryRef rawQuery) {
  return Mutation((__bridge NSDictionary *)rawQuery, nil, YES);
}

static void Reset(void) {
  gStore = [NSMutableDictionary dictionary];
  gMutationCount = 0;
  gFailBefore = 0;
  gCommitThenError = 0;
  gBlockNextLiveCopy = NO;
  gLiveCopyEntered = nil;
  gReleaseLiveCopy = nil;
}

static AncPrivateVaultKeychain *Keychain(void) {
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
          }];
}

static AncPrivateVaultCustodyRepository *Repository(void) {
  AncPrivateVaultKeychain *keychain = Keychain();
  return [[AncPrivateVaultCustodyRepository alloc] initWithKeychain:keychain];
}

static void Fill(uint8_t *bytes, size_t length, uint8_t start) {
  for (size_t index = 0; index < length; index += 1)
    bytes[index] = (uint8_t)(start + index);
}

static void SetId(uint8_t output[160], size_t *length, NSString *value) {
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  assert(data.length <= 160);
  memset(output, 0, 160);
  memcpy(output, data.bytes, data.length);
  *length = data.length;
}

static AncPrivateVaultCustodySecretInputs Inputs(TestSecrets *secrets) {
  return (AncPrivateVaultCustodySecretInputs){
      .signing_seed = secrets->signingSeed,
      .box_seed = secrets->boxSeed,
      .local_state_key = secrets->localKey,
      .active_epoch_key = secrets->activeKey,
      .pending_epoch_key = secrets->pendingKey,
  };
}

static void MakeActive(AncPrivateVaultCustodySnapshot *snapshot,
                       TestSecrets *secrets, uint64_t generation,
                       uint8_t seedStart, NSString *vaultId) {
  memset(snapshot, 0, sizeof *snapshot);
  memset(secrets, 0, sizeof *secrets);
  snapshot->lifecycle = ANC_PV_CUSTODY_LIFECYCLE_ACTIVE;
  snapshot->role = ANC_PV_CUSTODY_ROLE_ENDPOINT;
  snapshot->custody_generation = generation;
  SetId(snapshot->vault_id, &snapshot->vault_id_length, vaultId);
  SetId(snapshot->endpoint_id, &snapshot->endpoint_id_length, @"endpoint-1");
  Fill(secrets->signingSeed, 32, seedStart);
  Fill(secrets->boxSeed, 32, (uint8_t)(seedStart + 32));
  Fill(secrets->localKey, 32, (uint8_t)(seedStart + 64));
  Fill(secrets->activeKey, 32, (uint8_t)(seedStart + 96));
  uint8_t signingPrivate[64] = {0};
  uint8_t boxPrivate[32] = {0};
  assert(anc_pv_ed25519_seed_keypair(snapshot->signing_public_key,
                                     signingPrivate,
                                     secrets->signingSeed) ==
         ANC_PV_CRYPTO_OK);
  assert(anc_pv_box_seed_keypair(snapshot->box_public_key, boxPrivate,
                                 secrets->boxSeed) == ANC_PV_CRYPTO_OK);
  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
  anc_pv_zeroize(boxPrivate, sizeof boxPrivate);
  snapshot->active_epoch = generation;
  snapshot->recovery_generation = 1;
  snapshot->anchored_sequence = generation;
  Fill(snapshot->anchored_head, 32, 0x21);
  Fill(snapshot->membership_digest, 32, 0x41);
  snapshot->signed_at_ms = 1700000000000ULL + generation;
  Fill(snapshot->snapshot_digest, 32, 0x61);
  snapshot->freshness_ms = 1700000001000ULL + generation;
}

static NSString *KeyForService(NSString *service) {
  for (NSString *key in gStore)
    if ([key hasPrefix:[service stringByAppendingString:@"|"]]) return key;
  return nil;
}

static NSData *Encode(AncPrivateVaultCustodySnapshot *snapshot,
                      TestSecrets *secrets) {
  AncPrivateVaultCustodySecretInputs inputs = Inputs(secrets);
  uint8_t bytes[ANC_PV_CUSTODY_RECORD_BYTES] = {0};
  assert(anc_pv_custody_record_encode(snapshot, &inputs, bytes, sizeof bytes) ==
         ANC_PV_CUSTODY_OK);
  NSData *result = [NSData dataWithBytes:bytes length:sizeof bytes];
  anc_pv_zeroize(bytes, sizeof bytes);
  return result;
}

static NSData *CustodyDigest(NSData *record) {
  static const char domain[] = "anc/v1/private-vault/custody-record/fence";
  uint8_t input[sizeof domain + ANC_PV_CUSTODY_RECORD_BYTES];
  memcpy(input, domain, sizeof domain);
  memcpy(input + sizeof domain, record.bytes, record.length);
  uint8_t digest[32] = {0};
  assert(anc_pv_blake2b_256(digest, input, sizeof input) == ANC_PV_CRYPTO_OK);
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(input, sizeof input);
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static void AssertRead(AncPrivateVaultCustodyRepository *repository,
                       NSString *vaultId, uint64_t generation,
                       uint8_t firstSigningByte) {
  AncPrivateVaultCustodySnapshot snapshot;
  AncPrivateVaultCustodyHandle *handle = nil;
  assert([repository readVaultId:vaultId snapshot:&snapshot handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(snapshot.custody_generation == generation);
  __block BOOL borrowed = NO;
  assert([handle borrow:^BOOL(
                     const AncPrivateVaultCustodySecretInputs *secrets) {
           borrowed = YES;
           return secrets->signing_seed[0] == firstSigningByte;
         }] == AncPrivateVaultCustodyRepositoryStatusOK);
  assert(borrowed);
  assert([handle close] == AncPrivateVaultCustodyRepositoryStatusOK);
  assert([handle close] == AncPrivateVaultCustodyRepositoryStatusOK);
  assert(handle.closed);
  assert([handle borrow:^BOOL(
                     const AncPrivateVaultCustodySecretInputs *secrets) {
           (void)secrets;
           return YES;
         }] != AncPrivateVaultCustodyRepositoryStatusOK);
}

static void TestRoundTripAndMonotonicity(void) {
  Reset();
  AncPrivateVaultCustodyRepository *repository = Repository();
  AncPrivateVaultCustodySnapshot first;
  TestSecrets firstSecrets;
  MakeActive(&first, &firstSecrets, 1, 1, @"vault");
  AncPrivateVaultCustodySecretInputs firstInputs = Inputs(&firstSecrets);
  assert([repository storeSnapshot:&first
                           secrets:&firstInputs
                           vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  AssertRead(repository, @"vault", 1, 1);
  assert(gStore[KeyForService(AncPrivateVaultCustodyStageService)] == nil);
  NSData *live = gStore[KeyForService(AncPrivateVaultCustodyService)];
  NSData *fence = gStore[KeyForService(AncPrivateVaultFenceService)];
  static const char domain[] = "anc/v1/private-vault/custody-record/fence";
  uint8_t digestInput[sizeof domain + ANC_PV_CUSTODY_RECORD_BYTES];
  memcpy(digestInput, domain, sizeof domain);
  memcpy(digestInput + sizeof domain, live.bytes, live.length);
  uint8_t digest[32] = {0};
  assert(anc_pv_blake2b_256(digest, digestInput, sizeof digestInput) ==
         ANC_PV_CRYPTO_OK);
  assert(memcmp((const uint8_t *)fence.bytes + 52, digest, 32) == 0);
  uint8_t withoutNul[32] = {0};
  uint8_t withoutNulInput[sizeof domain - 1 + ANC_PV_CUSTODY_RECORD_BYTES];
  memcpy(withoutNulInput, domain, sizeof domain - 1);
  memcpy(withoutNulInput + sizeof domain - 1, live.bytes, live.length);
  assert(anc_pv_blake2b_256(withoutNul, withoutNulInput,
                            sizeof withoutNulInput) == ANC_PV_CRYPTO_OK);
  assert(anc_pv_memcmp(digest, withoutNul, 32) != ANC_PV_CRYPTO_OK);
  anc_pv_zeroize(digestInput, sizeof digestInput);
  anc_pv_zeroize(withoutNulInput, sizeof withoutNulInput);
  anc_pv_zeroize(digest, sizeof digest);
  anc_pv_zeroize(withoutNul, sizeof withoutNul);

  AncPrivateVaultCustodySnapshot future;
  TestSecrets futureSecrets;
  MakeActive(&future, &futureSecrets, 3, 2, @"vault");
  AncPrivateVaultCustodySecretInputs futureInputs = Inputs(&futureSecrets);
  assert([repository storeSnapshot:&future
                           secrets:&futureInputs
                           vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusConflict);
  MakeActive(&future, &futureSecrets, 2, 2, @"other-vault");
  futureInputs = Inputs(&futureSecrets);
  assert([repository storeSnapshot:&future
                           secrets:&futureInputs
                           vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusInvalid);
}

static void TestCrashMatrixAndAmbiguousCommits(void) {
  for (NSUInteger failure = 1; failure <= 7; failure += 1) {
    Reset();
    AncPrivateVaultCustodyRepository *repository = Repository();
    AncPrivateVaultCustodySnapshot snapshot;
    TestSecrets secrets;
    MakeActive(&snapshot, &secrets, 1, 5, @"vault");
    AncPrivateVaultCustodySecretInputs inputs = Inputs(&secrets);
    gFailBefore = failure;
    (void)[repository storeSnapshot:&snapshot secrets:&inputs vaultId:@"vault"];
    gFailBefore = 0;
    AncPrivateVaultCustodyRepository *restarted = Repository();
    AncPrivateVaultCustodySnapshot observed;
    AncPrivateVaultCustodyHandle *handle = nil;
    AncPrivateVaultCustodyRepositoryStatus read =
        [restarted readVaultId:@"vault" snapshot:&observed handle:&handle];
    if (failure == 1) {
      assert(read == AncPrivateVaultCustodyRepositoryStatusNotFound);
    } else {
      assert(read == AncPrivateVaultCustodyRepositoryStatusOK);
      assert(observed.custody_generation == 1);
      [handle close];
      assert(gStore[KeyForService(AncPrivateVaultCustodyStageService)] == nil);
    }
  }
  for (NSUInteger ambiguous = 1; ambiguous <= 7; ambiguous += 1) {
    Reset();
    AncPrivateVaultCustodyRepository *repository = Repository();
    AncPrivateVaultCustodySnapshot snapshot;
    TestSecrets secrets;
    MakeActive(&snapshot, &secrets, 1, 7, @"vault");
    AncPrivateVaultCustodySecretInputs inputs = Inputs(&secrets);
    gCommitThenError = ambiguous;
    assert([repository storeSnapshot:&snapshot
                             secrets:&inputs
                             vaultId:@"vault"] ==
           AncPrivateVaultCustodyRepositoryStatusOK);
    AssertRead(repository, @"vault", 1, 7);
  }

  for (NSUInteger failure = 1; failure <= 7; failure += 1) {
    Reset();
    AncPrivateVaultCustodyRepository *repository = Repository();
    AncPrivateVaultCustodySnapshot first;
    TestSecrets firstSecrets;
    MakeActive(&first, &firstSecrets, 1, 31, @"vault");
    AncPrivateVaultCustodySecretInputs firstInputs = Inputs(&firstSecrets);
    assert([repository storeSnapshot:&first
                             secrets:&firstInputs
                             vaultId:@"vault"] ==
           AncPrivateVaultCustodyRepositoryStatusOK);

    AncPrivateVaultCustodySnapshot second;
    TestSecrets secondSecrets;
    MakeActive(&second, &secondSecrets, 2, 33, @"vault");
    AncPrivateVaultCustodySecretInputs secondInputs = Inputs(&secondSecrets);
    gMutationCount = 0;
    gFailBefore = failure;
    (void)[repository storeSnapshot:&second
                            secrets:&secondInputs
                            vaultId:@"vault"];
    gFailBefore = 0;

    AncPrivateVaultCustodyRepository *restarted = Repository();
    AssertRead(restarted, @"vault", failure == 1 ? 1 : 2,
               failure == 1 ? 31 : 33);
    assert(gStore[KeyForService(AncPrivateVaultCustodyStageService)] == nil);
  }

  for (NSUInteger ambiguous = 1; ambiguous <= 7; ambiguous += 1) {
    Reset();
    AncPrivateVaultCustodyRepository *repository = Repository();
    AncPrivateVaultCustodySnapshot first;
    TestSecrets firstSecrets;
    MakeActive(&first, &firstSecrets, 1, 35, @"vault");
    AncPrivateVaultCustodySecretInputs firstInputs = Inputs(&firstSecrets);
    assert([repository storeSnapshot:&first
                             secrets:&firstInputs
                             vaultId:@"vault"] ==
           AncPrivateVaultCustodyRepositoryStatusOK);

    AncPrivateVaultCustodySnapshot second;
    TestSecrets secondSecrets;
    MakeActive(&second, &secondSecrets, 2, 37, @"vault");
    AncPrivateVaultCustodySecretInputs secondInputs = Inputs(&secondSecrets);
    gMutationCount = 0;
    gCommitThenError = ambiguous;
    assert([repository storeSnapshot:&second
                             secrets:&secondInputs
                             vaultId:@"vault"] ==
           AncPrivateVaultCustodyRepositoryStatusOK);
    gCommitThenError = 0;
    AssertRead(Repository(), @"vault", 2, 37);
  }
}

static void TestCorruptionSwapAndMissing(void) {
  Reset();
  AncPrivateVaultCustodyRepository *repository = Repository();
  AncPrivateVaultCustodySnapshot snapshot;
  TestSecrets secrets;
  MakeActive(&snapshot, &secrets, 1, 9, @"vault");
  AncPrivateVaultCustodySecretInputs inputs = Inputs(&secrets);
  assert([repository storeSnapshot:&snapshot secrets:&inputs vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  NSString *liveKey = KeyForService(AncPrivateVaultCustodyService);
  NSData *original = [gStore[liveKey] copy];
  NSMutableData *corrupt = [original mutableCopy];
  ((uint8_t *)corrupt.mutableBytes)[700] ^= 1;
  gStore[liveKey] = corrupt;
  AncPrivateVaultCustodyHandle *handle = nil;
  __block NSUInteger failedDecodeClosedHandles = 0;
  AncPrivateVaultCustodySetBeforeHandleCloseForTesting(
      ^(AncPrivateVaultCustodyHandle *closing) {
        (void)closing;
        failedDecodeClosedHandles += 1;
      });
  assert([repository readVaultId:@"vault" snapshot:&snapshot handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusCorrupt);
  AncPrivateVaultCustodySetBeforeHandleCloseForTesting(nil);
  assert(handle == nil);
  assert(failedDecodeClosedHandles >= 1);
  gStore[liveKey] = original;
  AncPrivateVaultCustodySnapshot swappedSnapshot;
  TestSecrets swappedSecrets;
  MakeActive(&swappedSnapshot, &swappedSecrets, 2, 21, @"other-vault");
  AncPrivateVaultCustodySecretInputs swappedInputs = Inputs(&swappedSecrets);
  uint8_t swappedBytes[ANC_PV_CUSTODY_RECORD_BYTES] = {0};
  assert(anc_pv_custody_record_encode(&swappedSnapshot, &swappedInputs,
                                      swappedBytes, sizeof swappedBytes) ==
         ANC_PV_CUSTODY_OK);
  NSData *swapped = [NSData dataWithBytes:swappedBytes length:sizeof swappedBytes];
  anc_pv_zeroize(swappedBytes, sizeof swappedBytes);
  AncPrivateVaultKeychain *keychain = Keychain();
  assert([keychain addData:swapped
                forService:AncPrivateVaultCustodyStageService
                   vaultId:@"vault"
                  recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultKeychainStatusOK);
  assert([repository readVaultId:@"vault" snapshot:&snapshot handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
  assert([keychain deleteDataForService:AncPrivateVaultCustodyStageService
                                 vaultId:@"vault"
                                recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultKeychainStatusOK);
  [gStore removeObjectForKey:liveKey];
  assert([repository readVaultId:@"vault" snapshot:&snapshot handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
}

static void TestPendingMissingMismatchAndFutureStage(void) {
  Reset();
  AncPrivateVaultCustodyRepository *repository = Repository();
  AncPrivateVaultCustodySnapshot snapshot;
  TestSecrets secrets;
  MakeActive(&snapshot, &secrets, 1, 23, @"vault");
  AncPrivateVaultCustodySecretInputs inputs = Inputs(&secrets);
  gFailBefore = 4;
  assert([repository storeSnapshot:&snapshot secrets:&inputs vaultId:@"vault"] !=
         AncPrivateVaultCustodyRepositoryStatusOK);
  gFailBefore = 0;
  NSString *stageKey = KeyForService(AncPrivateVaultCustodyStageService);
  NSData *stage = [gStore[stageKey] copy];
  [gStore removeObjectForKey:stageKey];
  AncPrivateVaultCustodyHandle *handle = nil;
  assert([Repository() readVaultId:@"vault" snapshot:&snapshot handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusRollbackDetected);

  gStore[stageKey] = stage;
  AncPrivateVaultCustodySnapshot mismatch;
  TestSecrets mismatchSecrets;
  MakeActive(&mismatch, &mismatchSecrets, 1, 25, @"vault");
  gStore[stageKey] = Encode(&mismatch, &mismatchSecrets);
  assert([Repository() readVaultId:@"vault" snapshot:&snapshot handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusRollbackDetected);

  Reset();
  repository = Repository();
  MakeActive(&snapshot, &secrets, 1, 27, @"vault");
  inputs = Inputs(&secrets);
  assert([repository storeSnapshot:&snapshot secrets:&inputs vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  AncPrivateVaultCustodySnapshot future;
  TestSecrets futureSecrets;
  MakeActive(&future, &futureSecrets, 3, 29, @"vault");
  AncPrivateVaultKeychain *keychain = Keychain();
  assert([keychain addData:Encode(&future, &futureSecrets)
                forService:AncPrivateVaultCustodyStageService
                   vaultId:@"vault"
                  recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultKeychainStatusOK);
  assert([repository readVaultId:@"vault" snapshot:&snapshot handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
}

static void MakeTombstone(AncPrivateVaultCustodySnapshot *snapshot,
                          TestSecrets *secrets, uint64_t generation,
                          AncPrivateVaultCustodyLifecycle lifecycle) {
  MakeActive(snapshot, secrets, generation, 11, @"vault");
  snapshot->lifecycle = lifecycle;
  snapshot->active_epoch = 0;
  anc_pv_zeroize(secrets, sizeof *secrets);
  snapshot->removal_sequence = generation;
  Fill(snapshot->removal_head, 32, 0x81);
  Fill(snapshot->removal_authorization_digest, 32, 0xa1);
  snapshot->removal_time_ms = 1700000002000ULL + generation;
}

static void TestGenesisTombstonesFailClosed(void) {
  for (AncPrivateVaultCustodyLifecycle lifecycle =
           ANC_PV_CUSTODY_LIFECYCLE_REMOVING;
       lifecycle <= ANC_PV_CUSTODY_LIFECYCLE_REMOVED; lifecycle += 1) {
    Reset();
    AncPrivateVaultCustodySnapshot tombstone;
    TestSecrets secrets;
    MakeTombstone(&tombstone, &secrets, 1, lifecycle);
    AncPrivateVaultCustodySecretInputs inputs = Inputs(&secrets);
    assert([Repository() storeSnapshot:&tombstone
                                secrets:&inputs
                                vaultId:@"vault"] ==
           AncPrivateVaultCustodyRepositoryStatusConflict);
    for (NSUInteger pendingFence = 0; pendingFence <= 1; pendingFence += 1) {
      Reset();
      MakeTombstone(&tombstone, &secrets, 1, lifecycle);
      NSData *record = Encode(&tombstone, &secrets);
      AncPrivateVaultKeychain *keychain = Keychain();
      assert([keychain addData:record
                    forService:AncPrivateVaultCustodyStageService
                       vaultId:@"vault"
                      recordId:AncPrivateVaultCustodyRecordId] ==
             AncPrivateVaultKeychainStatusOK);
      if (pendingFence == 1) {
        AncPrivateVaultGenerationFence *fence =
            [[AncPrivateVaultGenerationFence alloc]
                initWithKeychain:keychain];
        assert([fence beginGeneration:1
                         recordDigest:CustodyDigest(record)
                              vaultId:@"vault"
                             recordId:AncPrivateVaultCustodyRecordId] ==
               AncPrivateVaultFenceStatusOK);
      }
      AncPrivateVaultCustodySnapshot observed;
      AncPrivateVaultCustodyHandle *handle = nil;
      assert([[[AncPrivateVaultCustodyRepository alloc]
                  initWithKeychain:keychain] readVaultId:@"vault"
                                           snapshot:&observed
                                              handle:&handle] ==
             AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
      assert(handle == nil);
    }
    for (NSUInteger stableFence = 0; stableFence <= 1; stableFence += 1) {
      Reset();
      MakeTombstone(&tombstone, &secrets, 1, lifecycle);
      NSData *record = Encode(&tombstone, &secrets);
      AncPrivateVaultKeychain *keychain = Keychain();
      assert([keychain addData:record
                    forService:AncPrivateVaultCustodyService
                       vaultId:@"vault"
                      recordId:AncPrivateVaultCustodyRecordId] ==
             AncPrivateVaultKeychainStatusOK);
      if (stableFence == 0) {
        assert([keychain addData:record
                      forService:AncPrivateVaultCustodyStageService
                         vaultId:@"vault"
                        recordId:AncPrivateVaultCustodyRecordId] ==
               AncPrivateVaultKeychainStatusOK);
      }
      NSData *digest = CustodyDigest(record);
      AncPrivateVaultGenerationFence *fence =
          [[AncPrivateVaultGenerationFence alloc] initWithKeychain:keychain];
      assert([fence beginGeneration:1
                       recordDigest:digest
                            vaultId:@"vault"
                           recordId:AncPrivateVaultCustodyRecordId] ==
             AncPrivateVaultFenceStatusOK);
      if (stableFence == 1) {
        assert([fence commitGeneration:1
                          recordDigest:digest
                               vaultId:@"vault"
                              recordId:AncPrivateVaultCustodyRecordId] ==
               AncPrivateVaultFenceStatusOK);
      }
      AncPrivateVaultCustodySnapshot observed;
      AncPrivateVaultCustodyHandle *handle = nil;
      assert([[[AncPrivateVaultCustodyRepository alloc]
                  initWithKeychain:keychain] readVaultId:@"vault"
                                           snapshot:&observed
                                              handle:&handle] ==
             AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
      assert(handle == nil);
    }
  }
}

static void TestSubstitutionAndPendingSourceSwap(void) {
  Reset();
  AncPrivateVaultCustodyRepository *repository = Repository();
  AncPrivateVaultCustodySnapshot first;
  TestSecrets firstSecrets;
  MakeActive(&first, &firstSecrets, 1, 41, @"vault");
  AncPrivateVaultCustodySecretInputs firstInputs = Inputs(&firstSecrets);
  assert([repository storeSnapshot:&first
                           secrets:&firstInputs
                           vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  AncPrivateVaultCustodySnapshot substitute;
  TestSecrets substituteSecrets;
  MakeActive(&substitute, &substituteSecrets, 1, 43, @"vault");
  gStore[KeyForService(AncPrivateVaultCustodyService)] =
      Encode(&substitute, &substituteSecrets);
  AncPrivateVaultCustodyHandle *handle = nil;
  assert([repository readVaultId:@"vault" snapshot:&first handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
  assert(handle == nil);

  Reset();
  repository = Repository();
  MakeActive(&first, &firstSecrets, 1, 45, @"vault");
  firstInputs = Inputs(&firstSecrets);
  assert([repository storeSnapshot:&first
                           secrets:&firstInputs
                           vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  AncPrivateVaultCustodySnapshot second;
  TestSecrets secondSecrets;
  MakeActive(&second, &secondSecrets, 2, 47, @"vault");
  AncPrivateVaultCustodySecretInputs secondInputs = Inputs(&secondSecrets);
  gMutationCount = 0;
  gFailBefore = 4;
  assert([repository storeSnapshot:&second
                           secrets:&secondInputs
                           vaultId:@"vault"] !=
         AncPrivateVaultCustodyRepositoryStatusOK);
  gFailBefore = 0;
  NSString *liveKey = KeyForService(AncPrivateVaultCustodyService);
  NSString *stageKey = KeyForService(AncPrivateVaultCustodyStageService);
  NSData *oldLive = gStore[liveKey];
  gStore[liveKey] = gStore[stageKey];
  gStore[stageKey] = oldLive;
  assert([Repository() readVaultId:@"vault" snapshot:&first handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
  assert(handle == nil);
}

static void TestHandleRevocationAndReadStoreSerialization(void) {
  Reset();
  AncPrivateVaultCustodyRepository *firstRepository = Repository();
  AncPrivateVaultCustodyRepository *secondRepository = Repository();
  AncPrivateVaultCustodySnapshot first;
  TestSecrets firstSecrets;
  MakeActive(&first, &firstSecrets, 1, 51, @"vault");
  AncPrivateVaultCustodySecretInputs firstInputs = Inputs(&firstSecrets);
  assert([firstRepository storeSnapshot:&first
                                secrets:&firstInputs
                                vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  AncPrivateVaultCustodyHandle *oldHandle = nil;
  assert([firstRepository readVaultId:@"vault"
                              snapshot:&first
                                 handle:&oldHandle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  AncPrivateVaultCustodyHandle *otherHandle = nil;
  assert([secondRepository readVaultId:@"vault"
                               snapshot:&first
                                  handle:&otherHandle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);

  dispatch_semaphore_t firstEntered = dispatch_semaphore_create(0);
  dispatch_semaphore_t secondEntered = dispatch_semaphore_create(0);
  dispatch_group_t oppositeClosedGroup = dispatch_group_create();
  __block BOOL firstSawOtherOpen = NO;
  __block BOOL secondSawOtherOpen = NO;
  dispatch_group_async(
      oppositeClosedGroup,
      dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        assert([oldHandle borrow:^BOOL(
                              const AncPrivateVaultCustodySecretInputs *secrets) {
                 (void)secrets;
                 dispatch_semaphore_signal(firstEntered);
                 dispatch_semaphore_wait(secondEntered,
                                         DISPATCH_TIME_FOREVER);
                 firstSawOtherOpen = !otherHandle.closed;
                 return YES;
               }] == AncPrivateVaultCustodyRepositoryStatusOK);
      });
  dispatch_group_async(
      oppositeClosedGroup,
      dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        assert([otherHandle borrow:^BOOL(
                                const AncPrivateVaultCustodySecretInputs *secrets) {
                 (void)secrets;
                 dispatch_semaphore_signal(secondEntered);
                 dispatch_semaphore_wait(firstEntered,
                                         DISPATCH_TIME_FOREVER);
                 secondSawOtherOpen = !oldHandle.closed;
                 return YES;
               }] == AncPrivateVaultCustodyRepositoryStatusOK);
      });
  assert(dispatch_group_wait(oppositeClosedGroup,
                             dispatch_time(DISPATCH_TIME_NOW,
                                           5 * NSEC_PER_SEC)) == 0);
  assert(firstSawOtherOpen && secondSawOtherOpen);

  AncPrivateVaultCustodySnapshot second;
  TestSecrets secondSecrets;
  MakeActive(&second, &secondSecrets, 2, 53, @"vault");
  AncPrivateVaultCustodySecretInputs secondInputs = Inputs(&secondSecrets);
  dispatch_semaphore_t recursiveDone = dispatch_semaphore_create(0);
  __block AncPrivateVaultCustodyRepositoryStatus recursiveStatus;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    recursiveStatus = [oldHandle
        borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
          (void)secrets;
          assert(!oldHandle.closed);
          assert([oldHandle borrow:^BOOL(
                                const AncPrivateVaultCustodySecretInputs *inner) {
                   (void)inner;
                   return YES;
                 }] == AncPrivateVaultCustodyRepositoryStatusConflict);
          assert([oldHandle close] ==
                 AncPrivateVaultCustodyRepositoryStatusConflict);
          assert([otherHandle borrow:^BOOL(
                                  const AncPrivateVaultCustodySecretInputs *inner) {
                   (void)inner;
                   return YES;
                 }] == AncPrivateVaultCustodyRepositoryStatusConflict);
          assert([otherHandle close] ==
                 AncPrivateVaultCustodyRepositoryStatusConflict);
          AncPrivateVaultCustodySnapshot nestedSnapshot;
          AncPrivateVaultCustodyHandle *nestedHandle = nil;
          assert([firstRepository readVaultId:@"vault"
                                      snapshot:&nestedSnapshot
                                         handle:&nestedHandle] ==
                 AncPrivateVaultCustodyRepositoryStatusConflict);
          assert([secondRepository storeSnapshot:&second
                                          secrets:&secondInputs
                                          vaultId:@"vault"] ==
                 AncPrivateVaultCustodyRepositoryStatusConflict);
          return YES;
        }];
    dispatch_semaphore_signal(recursiveDone);
  });
  assert(dispatch_semaphore_wait(recursiveDone,
                                 dispatch_time(DISPATCH_TIME_NOW,
                                               5 * NSEC_PER_SEC)) == 0);
  assert(recursiveStatus == AncPrivateVaultCustodyRepositoryStatusOK);

  dispatch_semaphore_t borrowed = dispatch_semaphore_create(0);
  dispatch_semaphore_t releaseBorrow = dispatch_semaphore_create(0);
  dispatch_semaphore_t closeAttempt = dispatch_semaphore_create(0);
  dispatch_semaphore_t storeDone = dispatch_semaphore_create(0);
  __block AncPrivateVaultCustodyRepositoryStatus borrowStatus;
  __block AncPrivateVaultCustodyRepositoryStatus storeStatus;
  AncPrivateVaultCustodySetBeforeHandleCloseForTesting(
      ^(AncPrivateVaultCustodyHandle *closing) {
        if (closing == oldHandle) dispatch_semaphore_signal(closeAttempt);
      });
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    borrowStatus = [oldHandle
        borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
          (void)secrets;
          dispatch_semaphore_signal(borrowed);
          dispatch_semaphore_wait(releaseBorrow, DISPATCH_TIME_FOREVER);
          return YES;
        }];
  });
  assert(dispatch_semaphore_wait(borrowed,
                                 dispatch_time(DISPATCH_TIME_NOW,
                                               5 * NSEC_PER_SEC)) == 0);
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    storeStatus = [secondRepository storeSnapshot:&second
                                           secrets:&secondInputs
                                           vaultId:@"vault"];
    dispatch_semaphore_signal(storeDone);
  });
  assert(dispatch_semaphore_wait(closeAttempt,
                                 dispatch_time(DISPATCH_TIME_NOW,
                                               5 * NSEC_PER_SEC)) == 0);
  assert(dispatch_semaphore_wait(storeDone, DISPATCH_TIME_NOW) != 0);
  dispatch_semaphore_signal(releaseBorrow);
  assert(dispatch_semaphore_wait(storeDone,
                                 dispatch_time(DISPATCH_TIME_NOW,
                                               5 * NSEC_PER_SEC)) == 0);
  AncPrivateVaultCustodySetBeforeHandleCloseForTesting(nil);
  assert(borrowStatus == AncPrivateVaultCustodyRepositoryStatusOK);
  assert(storeStatus == AncPrivateVaultCustodyRepositoryStatusOK);
  assert(oldHandle.closed);

  Reset();
  firstRepository = Repository();
  secondRepository = Repository();
  MakeActive(&first, &firstSecrets, 1, 55, @"vault");
  firstInputs = Inputs(&firstSecrets);
  assert([firstRepository storeSnapshot:&first
                                secrets:&firstInputs
                                vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  MakeActive(&second, &secondSecrets, 2, 57, @"vault");
  secondInputs = Inputs(&secondSecrets);
  gLiveCopyEntered = dispatch_semaphore_create(0);
  gReleaseLiveCopy = dispatch_semaphore_create(0);
  gBlockNextLiveCopy = YES;
  dispatch_semaphore_t readDone = dispatch_semaphore_create(0);
  storeDone = dispatch_semaphore_create(0);
  __block AncPrivateVaultCustodyRepositoryStatus readStatus;
  __block AncPrivateVaultCustodyHandle *racingHandle = nil;
  __block AncPrivateVaultCustodySnapshot racingSnapshot;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    readStatus = [firstRepository readVaultId:@"vault"
                                      snapshot:&racingSnapshot
                                         handle:&racingHandle];
    dispatch_semaphore_signal(readDone);
  });
  assert(dispatch_semaphore_wait(gLiveCopyEntered,
                                 dispatch_time(DISPATCH_TIME_NOW,
                                               5 * NSEC_PER_SEC)) == 0);
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    storeStatus = [secondRepository storeSnapshot:&second
                                           secrets:&secondInputs
                                           vaultId:@"vault"];
    dispatch_semaphore_signal(storeDone);
  });
  dispatch_semaphore_signal(gReleaseLiveCopy);
  assert(dispatch_semaphore_wait(readDone,
                                 dispatch_time(DISPATCH_TIME_NOW,
                                               5 * NSEC_PER_SEC)) == 0);
  assert(dispatch_semaphore_wait(storeDone,
                                 dispatch_time(DISPATCH_TIME_NOW,
                                               5 * NSEC_PER_SEC)) == 0);
  assert(readStatus == AncPrivateVaultCustodyRepositoryStatusOK);
  assert(racingSnapshot.custody_generation == 1);
  assert(storeStatus == AncPrivateVaultCustodyRepositoryStatusOK);
  assert(racingHandle.closed);
}

static void TestSixtyFourConcurrentWriters(void) {
  Reset();
  AncPrivateVaultCustodyRepository *repository = Repository();
  AncPrivateVaultCustodySnapshot first;
  TestSecrets firstSecrets;
  MakeActive(&first, &firstSecrets, 1, 61, @"vault");
  AncPrivateVaultCustodySecretInputs firstInputs = Inputs(&firstSecrets);
  assert([repository storeSnapshot:&first
                           secrets:&firstInputs
                           vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  const size_t count = 64;
  AncPrivateVaultCustodySnapshot *snapshots =
      calloc(count, sizeof *snapshots);
  TestSecrets *secrets = calloc(count, sizeof *secrets);
  AncPrivateVaultCustodyRepositoryStatus *statuses =
      calloc(count, sizeof *statuses);
  assert(snapshots != NULL && secrets != NULL && statuses != NULL);
  dispatch_group_t group = dispatch_group_create();
  for (size_t index = 0; index < count; index += 1) {
    MakeActive(&snapshots[index], &secrets[index], 2,
               (uint8_t)(65 + index), @"vault");
    dispatch_group_async(
        group, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
          AncPrivateVaultCustodySecretInputs inputs = Inputs(&secrets[index]);
          statuses[index] = [Repository() storeSnapshot:&snapshots[index]
                                                   secrets:&inputs
                                                   vaultId:@"vault"];
        });
  }
  dispatch_group_wait(group, DISPATCH_TIME_FOREVER);
  size_t winners = 0;
  for (size_t index = 0; index < count; index += 1)
    if (statuses[index] == AncPrivateVaultCustodyRepositoryStatusOK)
      winners += 1;
  assert(winners == 1);
  free(statuses);
  free(secrets);
  free(snapshots);
}

static void TestConcurrentUserCloseBorrowAndRepositoryRevoke(void) {
  Reset();
  AncPrivateVaultCustodyRepository *repository = Repository();
  AncPrivateVaultCustodySnapshot first;
  TestSecrets firstSecrets;
  MakeActive(&first, &firstSecrets, 1, 131, @"vault");
  AncPrivateVaultCustodySecretInputs firstInputs = Inputs(&firstSecrets);
  assert([repository storeSnapshot:&first
                           secrets:&firstInputs
                           vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  AncPrivateVaultCustodyHandle *handle = nil;
  assert([repository readVaultId:@"vault" snapshot:&first handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  AncPrivateVaultCustodySnapshot second;
  TestSecrets secondSecrets;
  MakeActive(&second, &secondSecrets, 2, 133, @"vault");
  AncPrivateVaultCustodySecretInputs secondInputs = Inputs(&secondSecrets);

  dispatch_semaphore_t start = dispatch_semaphore_create(0);
  dispatch_group_t group = dispatch_group_create();
  __block BOOL borrowStatusesValid = YES;
  __block BOOL closeStatusesValid = YES;
  __block AncPrivateVaultCustodyRepositoryStatus storeStatus;
  dispatch_group_async(
      group, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        dispatch_semaphore_wait(start, DISPATCH_TIME_FOREVER);
        for (NSUInteger iteration = 0; iteration < 2000; iteration += 1) {
          AncPrivateVaultCustodyRepositoryStatus status =
              [handle borrow:^BOOL(
                          const AncPrivateVaultCustodySecretInputs *secrets) {
                (void)secrets;
                return YES;
              }];
          if (status != AncPrivateVaultCustodyRepositoryStatusOK &&
              status != AncPrivateVaultCustodyRepositoryStatusInvalid)
            borrowStatusesValid = NO;
        }
      });
  dispatch_group_async(
      group, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        dispatch_semaphore_wait(start, DISPATCH_TIME_FOREVER);
        for (NSUInteger iteration = 0; iteration < 2000; iteration += 1)
          if ([handle close] != AncPrivateVaultCustodyRepositoryStatusOK)
            closeStatusesValid = NO;
      });
  dispatch_group_async(
      group, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        dispatch_semaphore_wait(start, DISPATCH_TIME_FOREVER);
        storeStatus = [Repository() storeSnapshot:&second
                                           secrets:&secondInputs
                                           vaultId:@"vault"];
      });
  dispatch_semaphore_signal(start);
  dispatch_semaphore_signal(start);
  dispatch_semaphore_signal(start);
  assert(dispatch_group_wait(group,
                             dispatch_time(DISPATCH_TIME_NOW,
                                           10 * NSEC_PER_SEC)) == 0);
  assert(borrowStatusesValid);
  assert(closeStatusesValid);
  assert(storeStatus == AncPrivateVaultCustodyRepositoryStatusOK);
  assert(handle.closed);
}

static void TestTombstonesAndConcurrentWriters(void) {
  Reset();
  AncPrivateVaultCustodyRepository *firstRepository = Repository();
  AncPrivateVaultCustodySnapshot first;
  TestSecrets firstSecrets;
  MakeActive(&first, &firstSecrets, 1, 13, @"vault");
  AncPrivateVaultCustodySecretInputs firstInputs = Inputs(&firstSecrets);
  assert([firstRepository storeSnapshot:&first
                                secrets:&firstInputs
                                vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);

  AncPrivateVaultCustodySnapshot left;
  AncPrivateVaultCustodySnapshot right;
  TestSecrets leftSecrets;
  TestSecrets rightSecrets;
  MakeActive(&left, &leftSecrets, 2, 15, @"vault");
  MakeActive(&right, &rightSecrets, 2, 17, @"vault");
  AncPrivateVaultCustodySecretInputs leftInputs = Inputs(&leftSecrets);
  AncPrivateVaultCustodySecretInputs rightInputs = Inputs(&rightSecrets);
  AncPrivateVaultCustodyRepository *secondRepository = Repository();
  __block AncPrivateVaultCustodyRepositoryStatus leftStatus;
  __block AncPrivateVaultCustodyRepositoryStatus rightStatus;
  dispatch_group_t group = dispatch_group_create();
  dispatch_queue_t queue = dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);
  dispatch_group_async(group, queue, ^{
    leftStatus = [firstRepository storeSnapshot:&left
                                         secrets:&leftInputs
                                         vaultId:@"vault"];
  });
  dispatch_group_async(group, queue, ^{
    rightStatus = [secondRepository storeSnapshot:&right
                                           secrets:&rightInputs
                                           vaultId:@"vault"];
  });
  dispatch_group_wait(group, DISPATCH_TIME_FOREVER);
  assert((leftStatus == AncPrivateVaultCustodyRepositoryStatusOK) !=
         (rightStatus == AncPrivateVaultCustodyRepositoryStatusOK));

  AncPrivateVaultCustodySnapshot directRemoved;
  TestSecrets directRemovedSecrets;
  MakeTombstone(&directRemoved, &directRemovedSecrets, 3,
                ANC_PV_CUSTODY_LIFECYCLE_REMOVED);
  AncPrivateVaultCustodySecretInputs directRemovedInputs =
      Inputs(&directRemovedSecrets);
  assert([firstRepository storeSnapshot:&directRemoved
                                secrets:&directRemovedInputs
                                vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusConflict);

  AncPrivateVaultCustodySnapshot retainedSnapshot;
  AncPrivateVaultCustodyHandle *retainedHandle = nil;
  assert([firstRepository readVaultId:@"vault"
                              snapshot:&retainedSnapshot
                                 handle:&retainedHandle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(retainedHandle != nil && !retainedHandle.closed);

  AncPrivateVaultCustodySnapshot removing;
  TestSecrets removingSecrets;
  MakeTombstone(&removing, &removingSecrets, 3,
                ANC_PV_CUSTODY_LIFECYCLE_REMOVING);
  AncPrivateVaultCustodySecretInputs removingInputs = Inputs(&removingSecrets);
  assert([firstRepository storeSnapshot:&removing
                                secrets:&removingInputs
                                vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(retainedHandle.closed);
  AncPrivateVaultCustodySnapshot tombstoneRead;
  AncPrivateVaultCustodyHandle *tombstoneHandle = nil;
  assert([firstRepository readVaultId:@"vault"
                              snapshot:&tombstoneRead
                                 handle:&tombstoneHandle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(tombstoneRead.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVING);
  assert(tombstoneHandle == nil);
  AncPrivateVaultCustodySnapshot removed;
  TestSecrets removedSecrets;
  MakeTombstone(&removed, &removedSecrets, 4,
                ANC_PV_CUSTODY_LIFECYCLE_REMOVED);
  AncPrivateVaultCustodySecretInputs removedInputs = Inputs(&removedSecrets);
  assert([firstRepository storeSnapshot:&removed
                                secrets:&removedInputs
                                vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  AncPrivateVaultCustodySnapshot resurrection;
  TestSecrets resurrectionSecrets;
  MakeActive(&resurrection, &resurrectionSecrets, 5, 19, @"vault");
  AncPrivateVaultCustodySecretInputs resurrectionInputs =
      Inputs(&resurrectionSecrets);
  assert([firstRepository storeSnapshot:&resurrection
                                secrets:&resurrectionInputs
                                vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusConflict);
  tombstoneHandle = nil;
  assert([firstRepository readVaultId:@"vault"
                              snapshot:&tombstoneRead
                                 handle:&tombstoneHandle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(tombstoneRead.custody_generation == 4);
  assert(tombstoneRead.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED);
  assert(tombstoneHandle == nil);
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    TestRoundTripAndMonotonicity();
    TestCrashMatrixAndAmbiguousCommits();
    TestCorruptionSwapAndMissing();
    TestPendingMissingMismatchAndFutureStage();
    TestGenesisTombstonesFailClosed();
    TestSubstitutionAndPendingSourceSwap();
    TestHandleRevocationAndReadStoreSerialization();
    TestSixtyFourConcurrentWriters();
    TestConcurrentUserCloseBorrowAndRepositoryRevoke();
    TestTombstonesAndConcurrentWriters();
    puts("private-vault custody repository tests passed");
  }
  return 0;
}
