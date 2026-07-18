#import <Foundation/Foundation.h>

#import "PrivateVaultCustodyRepository.h"
#import "PrivateVaultCustodyRepositoryGenesisInternal.h"
#import "PrivateVaultCustodyRepositoryRecoveryInternal.h"

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
static NSInteger gBoundaryDepth;
static NSInteger gMaximumBoundaryDepth;
static NSUInteger gCopyCount;

static NSString *StoreKey(NSDictionary *query) {
  return
      [NSString stringWithFormat:@"%@|%@", query[(__bridge id)kSecAttrService],
                                 query[(__bridge id)kSecAttrAccount]];
}

static OSStatus MockCopy(CFDictionaryRef rawQuery, CFTypeRef *result) {
  gCopyCount += 1;
  NSDictionary *query = (__bridge NSDictionary *)rawQuery;
  if (gBlockNextLiveCopy &&
      [query[(__bridge id)kSecAttrService]
          isEqualToString:AncPrivateVaultCustodyService]) {
    gBlockNextLiveCopy = NO;
    dispatch_semaphore_signal(gLiveCopyEntered);
    dispatch_semaphore_wait(gReleaseLiveCopy, DISPATCH_TIME_FOREVER);
  }
  NSData *value = gStore[StoreKey(query)];
  if (value == nil)
    return errSecItemNotFound;
  if (result != NULL)
    *result = CFBridgingRetain([value copy]);
  return errSecSuccess;
}

static OSStatus Mutation(NSDictionary *query, NSData *_Nullable value,
                         BOOL deleting) {
  gMutationCount += 1;
  if (gFailBefore == gMutationCount)
    return errSecInternalComponent;
  NSString *key = StoreKey(query);
  if (deleting) {
    if (gStore[key] == nil)
      return errSecItemNotFound;
    [gStore removeObjectForKey:key];
  } else {
    gStore[key] = [NSData dataWithBytes:value.bytes length:value.length];
    assert(gStore[key].bytes != value.bytes);
  }
  return gCommitThenError == gMutationCount ? errSecInternalComponent
                                            : errSecSuccess;
}

static OSStatus MockAdd(CFDictionaryRef raw, CFTypeRef *result) {
  (void)result;
  NSDictionary *attributes = (__bridge NSDictionary *)raw;
  if (gStore[StoreKey(attributes)] != nil)
    return errSecDuplicateItem;
  return Mutation(attributes, attributes[(__bridge id)kSecValueData], NO);
}

static OSStatus MockUpdate(CFDictionaryRef rawQuery,
                           CFDictionaryRef rawAttributes) {
  NSDictionary *query = (__bridge NSDictionary *)rawQuery;
  if (gStore[StoreKey(query)] == nil)
    return errSecItemNotFound;
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
  gBoundaryDepth = 0;
  gMaximumBoundaryDepth = 0;
  gCopyCount = 0;
}

static AncPrivateVaultKeychain *Keychain(void) {
  AncPrivateVaultSecItemFunctions functions = {
      .copyMatching = MockCopy,
      .add = MockAdd,
      .update = MockUpdate,
      .deleteItem = MockDelete,
  };
  return [[AncPrivateVaultKeychain alloc] initWithFunctions:functions
                                             contextFactory:^LAContext * {
                                               return [[LAContext alloc] init];
                                             }];
}

static const uint8_t *NullCustodyRecord(void) { return NULL; }

static void AssertGenericCustodySelectorsRejected(
    AncPrivateVaultKeychain *keychain, NSString *service, NSData *data) {
  NSData *escaped = data;
  __block BOOL consumed = NO;
  assert([keychain copyDataForService:service
                              vaultId:@"generic-rejected"
                             recordId:AncPrivateVaultCustodyRecordId
                                 data:&escaped] ==
         AncPrivateVaultKeychainStatusInvalid);
  assert(escaped == nil);
  assert([keychain consumeBytesForService:service
                                  vaultId:@"generic-rejected"
                                 recordId:AncPrivateVaultCustodyRecordId
                                 consumer:^BOOL(const uint8_t *bytes,
                                                size_t length) {
                                   (void)bytes;
                                   (void)length;
                                   consumed = YES;
                                   return YES;
                                 }] == AncPrivateVaultKeychainStatusInvalid);
  assert(!consumed);
  assert([keychain addBytes:data.bytes
                     length:data.length
                 forService:service
                    vaultId:@"generic-rejected"
                   recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultKeychainStatusInvalid);
  assert([keychain updateBytes:data.bytes
                        length:data.length
                    forService:service
                       vaultId:@"generic-rejected"
                      recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultKeychainStatusInvalid);
  assert([keychain addData:data
                forService:service
                   vaultId:@"generic-rejected"
                  recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultKeychainStatusInvalid);
  assert([keychain updateData:data
                   forService:service
                      vaultId:@"generic-rejected"
                     recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultKeychainStatusInvalid);
  assert([keychain deleteDataForService:service
                                vaultId:@"generic-rejected"
                               recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultKeychainStatusInvalid);
  assert(gCopyCount == 0 && gMutationCount == 0 && gBoundaryDepth == 0 &&
         gMaximumBoundaryDepth == 0);
}

static void TestExactCustodyKeychainBoundary(void) {
  Reset();
  AncPrivateVaultKeychain *keychain = Keychain();
  AncPrivateVaultKeychainSetBoundaryHookForTesting(
      ^(BOOL opened, BOOL writeBoundary) {
        (void)writeBoundary;
        gBoundaryDepth += opened ? 1 : -1;
        assert(gBoundaryDepth >= 0);
        if (gBoundaryDepth > gMaximumBoundaryDepth)
          gMaximumBoundaryDepth = gBoundaryDepth;
      });
  NSMutableData *record =
      [NSMutableData dataWithLength:ANC_PV_CUSTODY_RECORD_BYTES];
  memset(record.mutableBytes, 0xa5, record.length);
  NSData *shortRecord = [NSMutableData dataWithLength:17];
  AssertGenericCustodySelectorsRejected(
      keychain, AncPrivateVaultCustodyService, shortRecord);
  AssertGenericCustodySelectorsRejected(
      keychain, AncPrivateVaultCustodyStageService, shortRecord);
  assert([keychain addCustodyRecord:record.bytes
                              length:0
                          forService:AncPrivateVaultCustodyService
                             vaultId:@"wrong-length-zero"
                            recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultKeychainStatusInvalid);
  assert([keychain addCustodyRecord:record.bytes
                              length:ANC_PV_CUSTODY_RECORD_BYTES - 1
                          forService:AncPrivateVaultCustodyService
                             vaultId:@"wrong-length-short"
                            recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultKeychainStatusInvalid);
  assert([keychain updateCustodyRecord:record.bytes
                                 length:ANC_PV_CUSTODY_RECORD_BYTES + 1
                             forService:AncPrivateVaultCustodyService
                                vaultId:@"wrong-length-long"
                               recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultKeychainStatusInvalid);
  assert([keychain addCustodyRecord:NullCustodyRecord()
                              length:ANC_PV_CUSTODY_RECORD_BYTES
                          forService:AncPrivateVaultCustodyService
                             vaultId:@"wrong-length-null"
                            recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultKeychainStatusInvalid);
  assert(gMutationCount == 0 && gBoundaryDepth == 0 &&
         gMaximumBoundaryDepth == 0);
  assert([keychain addCustodyRecord:record.bytes
                              length:record.length
                        forService:AncPrivateVaultCustodyService
                           vaultId:@"exact-boundary"
                          recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultKeychainStatusOK);
  gCopyCount = 0;
  gMutationCount = 0;
  gBoundaryDepth = 0;
  gMaximumBoundaryDepth = 0;
  __block BOOL consumed = NO;
  __block AncPrivateVaultKeychainStatus nested =
      AncPrivateVaultKeychainStatusOK;
  assert([keychain
             consumeCustodyRecordForService:AncPrivateVaultCustodyService
                                    vaultId:@"exact-boundary"
                                   recordId:AncPrivateVaultCustodyRecordId
                                   consumer:^BOOL(const uint8_t *bytes) {
                                     assert(gBoundaryDepth == 1);
                                     assert(bytes != NULL && bytes[0] == 0xa5);
                                     NSData *escaped = record;
                                     __block BOOL genericConsumed = NO;
                                     assert([keychain
                                                copyDataForService:
                                                    AncPrivateVaultFenceService
                                                             vaultId:@"reentrant"
                                                            recordId:@"fence"
                                                                data:&escaped] ==
                                            AncPrivateVaultKeychainStatusInvalid);
                                     assert(escaped == nil);
                                     assert([keychain
                                                consumeBytesForService:
                                                    AncPrivateVaultFenceService
                                                             vaultId:@"reentrant"
                                                            recordId:@"fence"
                                                            consumer:^BOOL(
                                                                const uint8_t *raw,
                                                                size_t length) {
                                                              (void)raw;
                                                              (void)length;
                                                              genericConsumed =
                                                                  YES;
                                                              return YES;
                                                            }] ==
                                            AncPrivateVaultKeychainStatusInvalid);
                                     assert(!genericConsumed);
                                     assert([keychain
                                                addBytes:record.bytes
                                                   length:record.length
                                               forService:
                                                   AncPrivateVaultFenceService
                                                  vaultId:@"reentrant"
                                                 recordId:@"fence"] ==
                                            AncPrivateVaultKeychainStatusInvalid);
                                     assert([keychain
                                                updateBytes:record.bytes
                                                      length:record.length
                                                  forService:
                                                      AncPrivateVaultFenceService
                                                     vaultId:@"reentrant"
                                                    recordId:@"fence"] ==
                                            AncPrivateVaultKeychainStatusInvalid);
                                     assert([keychain
                                                addData:record
                                             forService:
                                                 AncPrivateVaultFenceService
                                                vaultId:@"reentrant"
                                               recordId:@"fence"] ==
                                            AncPrivateVaultKeychainStatusInvalid);
                                     assert([keychain
                                                updateData:record
                                                forService:
                                                    AncPrivateVaultFenceService
                                                   vaultId:@"reentrant"
                                                  recordId:@"fence"] ==
                                            AncPrivateVaultKeychainStatusInvalid);
                                     assert([keychain
                                                deleteDataForService:
                                                    AncPrivateVaultFenceService
                                                             vaultId:@"reentrant"
                                                            recordId:@"fence"] ==
                                            AncPrivateVaultKeychainStatusInvalid);
                                     nested = [keychain
                                         consumeCustodyRecordForService:
                                             AncPrivateVaultCustodyService
                                                                  vaultId:
                                                                      @"exact-boundary"
                                                                 recordId:
                                                                     AncPrivateVaultCustodyRecordId
                                                                 consumer:^BOOL(
                                                                     const uint8_t
                                                                         *inner) {
                                                                   (void)inner;
                                                                   return YES;
                                                                 }];
                                     consumed = YES;
                                     return YES;
                                   }] == AncPrivateVaultKeychainStatusOK);
  assert(consumed && nested == AncPrivateVaultKeychainStatusInvalid);
  assert(gBoundaryDepth == 0 && gMaximumBoundaryDepth == 1 &&
         gCopyCount == 1 && gMutationCount == 0);
  assert([keychain addCustodyRecord:record.bytes
                              length:record.length
                        forService:AncPrivateVaultFenceService
                           vaultId:@"wrong-service"
                          recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultKeychainStatusInvalid);

  AncPrivateVaultKeychainSetBoundaryHookForTesting(nil);
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
  snapshot->record_version = ANC_PV_CUSTODY_VERSION;
  snapshot->authority_anchor_present = 1;
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
                                     secrets->signingSeed) == ANC_PV_CRYPTO_OK);
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

static void MakePendingGenesis(AncPrivateVaultCustodySnapshot *snapshot,
                               TestSecrets *secrets, NSString *vaultId) {
  MakeActive(snapshot, secrets, 1, 201, vaultId);
  snapshot->authority_anchor_present = 0;
  snapshot->expected_edge_present = 1;
  snapshot->lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  snapshot->pending_kind = ANC_PV_CUSTODY_PENDING_GENESIS;
  snapshot->rotation_phase = ANC_PV_CUSTODY_ROTATION_PREPARED;
  snapshot->active_epoch = 0;
  snapshot->pending_epoch = 1;
  snapshot->recovery_generation = 0;
  snapshot->anchored_sequence = 0;
  memset(snapshot->anchored_head, 0, 32);
  memset(snapshot->membership_digest, 0, 32);
  snapshot->signed_at_ms = 0;
  memset(snapshot->snapshot_digest, 0, 32);
  snapshot->freshness_ms = 0;
  SetId(snapshot->ceremony_id, &snapshot->ceremony_id_length,
        @"ceremony:genesis-test");
  Fill(snapshot->pending_transcript_digest, 32, 0xd1);
  memset(secrets->activeKey, 0, 32);
  Fill(secrets->pendingKey, 32, 0xe1);
}

static NSString *KeyForService(NSString *service) {
  for (NSString *key in gStore)
    if ([key hasPrefix:[service stringByAppendingString:@"|"]])
      return key;
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

static NSData *LegacyRecord(NSData *v2Record) {
  NSMutableData *legacy = [v2Record mutableCopy];
  uint8_t *bytes = legacy.mutableBytes;
  bytes[4] = 0;
  bytes[5] = ANC_PV_CUSTODY_LEGACY_VERSION;
  bytes[13] = 0;
  if (bytes[10] == ANC_PV_CUSTODY_PENDING_GENESIS) {
    /* Legacy genesis inferred its expected edge from sequence one. */
    memset(bytes + 872, 0, 8);
    bytes[879] = 1;
  }
  static const uint8_t domain[] =
      "agent-native/private-vault/custody-record/checksum/anc-v1";
  uint8_t input[sizeof domain + 1056];
  memcpy(input, domain, sizeof domain);
  memcpy(input + sizeof domain, bytes, 1056);
  assert(anc_pv_blake2b_256(bytes + 1056, input, sizeof input) ==
         ANC_PV_CRYPTO_OK);
  anc_pv_zeroize(input, sizeof input);
  return legacy;
}

static AncPrivateVaultKeychainStatus AddCustodyData(
    AncPrivateVaultKeychain *keychain, NSData *record, NSString *service,
    NSString *vaultId) {
  return [keychain addCustodyRecord:record.bytes
                             length:record.length
                         forService:service
                            vaultId:vaultId
                           recordId:AncPrivateVaultCustodyRecordId];
}

static void SeedLegacy(AncPrivateVaultKeychain *keychain, NSData *record,
                       NSString *vaultId) {
  NSData *digest = CustodyDigest(record);
  assert(AddCustodyData(keychain, record, AncPrivateVaultCustodyService,
                        vaultId) ==
         AncPrivateVaultKeychainStatusOK);
  AncPrivateVaultGenerationFence *fence =
      [[AncPrivateVaultGenerationFence alloc] initWithKeychain:keychain];
  assert([fence beginGeneration:1
                   recordDigest:digest
                        vaultId:vaultId
                       recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultFenceStatusOK);
  assert([fence commitGeneration:1
                    recordDigest:digest
                         vaultId:vaultId
                        recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultFenceStatusOK);
}

static void StageLegacy(AncPrivateVaultKeychain *keychain, NSData *record,
                        NSString *vaultId, uint64_t generation) {
  NSData *digest = CustodyDigest(record);
  assert(AddCustodyData(keychain, record, AncPrivateVaultCustodyStageService,
                        vaultId) ==
         AncPrivateVaultKeychainStatusOK);
  AncPrivateVaultGenerationFence *fence =
      [[AncPrivateVaultGenerationFence alloc] initWithKeychain:keychain];
  assert([fence beginGeneration:generation
                   recordDigest:digest
                        vaultId:vaultId
                       recordId:AncPrivateVaultCustodyRecordId] ==
         AncPrivateVaultFenceStatusOK);
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
  assert(
      [handle borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
        borrowed = YES;
        return secrets->signing_seed[0] == firstSigningByte;
      }] == AncPrivateVaultCustodyRepositoryStatusOK);
  assert(borrowed);
  assert([handle close] == AncPrivateVaultCustodyRepositoryStatusOK);
  assert([handle close] == AncPrivateVaultCustodyRepositoryStatusOK);
  assert(handle.closed);
  assert(
      [handle borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
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
  assert([repository storeSnapshot:&snapshot
                           secrets:&inputs
                           vaultId:@"vault"] ==
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
  NSData *swapped = [NSData dataWithBytes:swappedBytes
                                   length:sizeof swappedBytes];
  anc_pv_zeroize(swappedBytes, sizeof swappedBytes);
  AncPrivateVaultKeychain *keychain = Keychain();
  assert(AddCustodyData(keychain, swapped,
                        AncPrivateVaultCustodyStageService, @"vault") ==
         AncPrivateVaultKeychainStatusOK);
  assert([repository readVaultId:@"vault" snapshot:&snapshot handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusRollbackDetected);
  assert([keychain
             deleteCustodyRecordForService:AncPrivateVaultCustodyStageService
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
  assert([repository storeSnapshot:&snapshot
                           secrets:&inputs
                           vaultId:@"vault"] !=
         AncPrivateVaultCustodyRepositoryStatusOK);
  gFailBefore = 0;
  NSString *stageKey = KeyForService(AncPrivateVaultCustodyStageService);
  NSData *stage = [gStore[stageKey] copy];
  [gStore removeObjectForKey:stageKey];
  AncPrivateVaultCustodyHandle *handle = nil;
  assert([Repository() readVaultId:@"vault"
                          snapshot:&snapshot
                            handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusRollbackDetected);

  gStore[stageKey] = stage;
  AncPrivateVaultCustodySnapshot mismatch;
  TestSecrets mismatchSecrets;
  MakeActive(&mismatch, &mismatchSecrets, 1, 25, @"vault");
  gStore[stageKey] = Encode(&mismatch, &mismatchSecrets);
  assert([Repository() readVaultId:@"vault"
                          snapshot:&snapshot
                            handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusRollbackDetected);

  Reset();
  repository = Repository();
  MakeActive(&snapshot, &secrets, 1, 27, @"vault");
  inputs = Inputs(&secrets);
  assert([repository storeSnapshot:&snapshot
                           secrets:&inputs
                           vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  AncPrivateVaultCustodySnapshot future;
  TestSecrets futureSecrets;
  MakeActive(&future, &futureSecrets, 3, 29, @"vault");
  AncPrivateVaultKeychain *keychain = Keychain();
  assert(AddCustodyData(keychain, Encode(&future, &futureSecrets),
                        AncPrivateVaultCustodyStageService, @"vault") ==
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
      assert(AddCustodyData(keychain, record,
                            AncPrivateVaultCustodyStageService, @"vault") ==
             AncPrivateVaultKeychainStatusOK);
      if (pendingFence == 1) {
        AncPrivateVaultGenerationFence *fence =
            [[AncPrivateVaultGenerationFence alloc] initWithKeychain:keychain];
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
      assert(AddCustodyData(keychain, record, AncPrivateVaultCustodyService,
                            @"vault") ==
             AncPrivateVaultKeychainStatusOK);
      if (stableFence == 0) {
        assert(AddCustodyData(keychain, record,
                              AncPrivateVaultCustodyStageService, @"vault") ==
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

static void TestPendingGenesisInstallCheckpoint(void) {
  Reset();
  AncPrivateVaultCustodyRepository *repository = Repository();
  NSString *vault = @"00112233445566778899aabbccddeeff";
  NSString *endpoint = @"102132435465768798a9bacbdcedfe0f";
  NSString *ceremony = @"ffeeddccbbaa99887766554433221100";
  TestSecrets secrets = {0};
  Fill(secrets.signingSeed, 32, 0x11);
  Fill(secrets.boxSeed, 32, 0x31);
  Fill(secrets.localKey, 32, 0x51);
  Fill(secrets.pendingKey, 32, 0x71);
  uint8_t signingPublic[32] = {0};
  uint8_t signingPrivate[64] = {0};
  uint8_t boxPublic[32] = {0};
  uint8_t boxPrivate[32] = {0};
  assert(anc_pv_ed25519_seed_keypair(signingPublic, signingPrivate,
                                     secrets.signingSeed) ==
         ANC_PV_CRYPTO_OK);
  assert(anc_pv_box_seed_keypair(boxPublic, boxPrivate, secrets.boxSeed) ==
         ANC_PV_CRYPTO_OK);
  NSData *signing = [NSData dataWithBytes:signingPublic length:32];
  NSData *box = [NSData dataWithBytes:boxPublic length:32];
  uint8_t bootstrapBytes[32];
  Fill(bootstrapBytes, sizeof bootstrapBytes, 0x91);
  NSData *bootstrap = [NSData dataWithBytes:bootstrapBytes length:32];
  AncPrivateVaultCustodySecretInputs inputs = Inputs(&secrets);
  AncPrivateVaultPendingGenesisCustodyCheckpoint *first = nil;
  assert([repository installPendingGenesisVaultId:vault
                                        endpointId:endpoint
                                        ceremonyId:ceremony
                                   signingPublicKey:signing
                                        boxPublicKey:box
                             bootstrapTranscriptDigest:bootstrap
                                           secrets:&inputs
                                        checkpoint:&first] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(first != nil && [first.vaultId isEqualToString:vault] &&
         first.custodyGeneration == 1 && first.recordDigest.length == 32);
  NSData *firstDigest = [first.recordDigest copy];
  BOOL immutable = NO;
  @try {
    [first setValue:[NSMutableData dataWithLength:32] forKey:@"recordDigest"];
  } @catch (__unused NSException *exception) {
    immutable = YES;
  }
  assert(immutable && [first.recordDigest isEqualToData:firstDigest]);
  AncPrivateVaultPendingGenesisCustodyCheckpoint *second = nil;
  assert([repository installPendingGenesisVaultId:vault
                                        endpointId:endpoint
                                        ceremonyId:ceremony
                                   signingPublicKey:signing
                                        boxPublicKey:box
                             bootstrapTranscriptDigest:bootstrap
                                           secrets:&inputs
                                        checkpoint:&second] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert([first.recordDigest isEqualToData:second.recordDigest]);
  AncPrivateVaultPendingGenesisCustodyCheckpoint *reread = nil;
  assert([repository pendingGenesisCheckpointVaultId:vault
                                           endpointId:endpoint
                                           ceremonyId:ceremony
                                      signingPublicKey:signing
                                           boxPublicKey:box
                              bootstrapTranscriptDigest:bootstrap
                                         checkpoint:&reread] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert([reread.recordDigest isEqualToData:first.recordDigest]);
  NSMutableData *wrongKey = [signing mutableCopy];
  ((uint8_t *)wrongKey.mutableBytes)[0] ^= 1;
  assert([repository pendingGenesisCheckpointVaultId:vault
                                           endpointId:endpoint
                                           ceremonyId:ceremony
                                      signingPublicKey:wrongKey
                                           boxPublicKey:box
                              bootstrapTranscriptDigest:bootstrap
                                         checkpoint:&reread] ==
         AncPrivateVaultCustodyRepositoryStatusConflict);
  assert([repository installPendingGenesisVaultId:vault
                                        endpointId:endpoint
                                        ceremonyId:ceremony
                                   signingPublicKey:wrongKey
                                        boxPublicKey:box
                             bootstrapTranscriptDigest:bootstrap
                                           secrets:&inputs
                                        checkpoint:&reread] ==
         AncPrivateVaultCustodyRepositoryStatusInvalid);
  AncPrivateVaultCustodySecretInputs aliasedInputs = inputs;
  aliasedInputs.box_seed = aliasedInputs.signing_seed;
  assert([repository installPendingGenesisVaultId:vault
                                        endpointId:endpoint
                                        ceremonyId:ceremony
                                   signingPublicKey:signing
                                        boxPublicKey:box
                             bootstrapTranscriptDigest:bootstrap
                                           secrets:&aliasedInputs
                                        checkpoint:&reread] ==
         AncPrivateVaultCustodyRepositoryStatusInvalid);
  secrets.activeKey[0] = 1;
  inputs = Inputs(&secrets);
  assert([repository installPendingGenesisVaultId:vault
                                        endpointId:endpoint
                                        ceremonyId:ceremony
                                   signingPublicKey:signing
                                        boxPublicKey:box
                             bootstrapTranscriptDigest:bootstrap
                                           secrets:&inputs
                                        checkpoint:&reread] ==
         AncPrivateVaultCustodyRepositoryStatusInvalid);
  AncPrivateVaultCustodySnapshot observed;
  AncPrivateVaultCustodyHandle *handle = nil;
  assert([repository readVaultId:vault snapshot:&observed handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(observed.custody_generation == 1 &&
         observed.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
         observed.pending_kind == ANC_PV_CUSTODY_PENDING_GENESIS &&
         observed.active_epoch == 0 && observed.pending_epoch == 1 &&
         handle != nil);
  assert([handle close] == AncPrivateVaultCustodyRepositoryStatusOK);
  anc_pv_custody_snapshot_zero(&observed);
  anc_pv_zeroize(&secrets, sizeof secrets);
  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
  anc_pv_zeroize(boxPrivate, sizeof boxPrivate);
  anc_pv_zeroize(signingPublic, sizeof signingPublic);
  anc_pv_zeroize(boxPublic, sizeof boxPublic);
  anc_pv_zeroize(bootstrapBytes, sizeof bootstrapBytes);
}

static void TestPendingGenesisOwnsMutableInputs(void) {
  Reset();
  AncPrivateVaultCustodyRepository *repository = Repository();
  NSMutableString *vault =
      [@"0123456789abcdef0123456789abcdef" mutableCopy];
  NSMutableString *endpoint =
      [@"11111111111111111111111111111111" mutableCopy];
  NSMutableString *ceremony =
      [@"22222222222222222222222222222222" mutableCopy];
  NSString *expectedVault = [vault copy];
  NSString *expectedEndpoint = [endpoint copy];
  NSString *expectedCeremony = [ceremony copy];
  TestSecrets secrets = {0};
  Fill(secrets.signingSeed, 32, 0x12);
  Fill(secrets.boxSeed, 32, 0x32);
  Fill(secrets.localKey, 32, 0x52);
  Fill(secrets.pendingKey, 32, 0x72);
  TestSecrets expectedSecrets = secrets;
  uint8_t signingPublic[32] = {0};
  uint8_t signingPrivate[64] = {0};
  uint8_t boxPublic[32] = {0};
  uint8_t boxPrivate[32] = {0};
  assert(anc_pv_ed25519_seed_keypair(signingPublic, signingPrivate,
                                     secrets.signingSeed) ==
         ANC_PV_CRYPTO_OK);
  assert(anc_pv_box_seed_keypair(boxPublic, boxPrivate, secrets.boxSeed) ==
         ANC_PV_CRYPTO_OK);
  NSMutableData *signing =
      [NSMutableData dataWithBytes:signingPublic length:32];
  NSMutableData *box = [NSMutableData dataWithBytes:boxPublic length:32];
  uint8_t bootstrapBytes[32];
  Fill(bootstrapBytes, sizeof bootstrapBytes, 0x92);
  NSData *expectedBootstrap =
      [NSData dataWithBytes:bootstrapBytes length:32];
  NSMutableData *bootstrap = [expectedBootstrap mutableCopy];
  AncPrivateVaultCustodySecretInputs inputs = Inputs(&secrets);
  gBlockNextLiveCopy = YES;
  gLiveCopyEntered = dispatch_semaphore_create(0);
  gReleaseLiveCopy = dispatch_semaphore_create(0);
  __block AncPrivateVaultCustodyRepositoryStatus status =
      AncPrivateVaultCustodyRepositoryStatusFailed;
  __block AncPrivateVaultPendingGenesisCustodyCheckpoint *checkpoint = nil;
  dispatch_group_t group = dispatch_group_create();
  dispatch_group_async(group,
                       dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    status = [repository installPendingGenesisVaultId:vault
                                            endpointId:endpoint
                                            ceremonyId:ceremony
                                       signingPublicKey:signing
                                            boxPublicKey:box
                                 bootstrapTranscriptDigest:bootstrap
                                               secrets:&inputs
                                            checkpoint:&checkpoint];
  });
  assert(dispatch_semaphore_wait(
             gLiveCopyEntered,
             dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);
  [vault setString:@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"];
  [endpoint setString:@"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"];
  [ceremony setString:@"cccccccccccccccccccccccccccccccc"];
  memset(signing.mutableBytes, 0xdd, signing.length);
  memset(box.mutableBytes, 0xee, box.length);
  memset(bootstrap.mutableBytes, 0xff, bootstrap.length);
  memset(&secrets, 0xa5, sizeof secrets);
  dispatch_semaphore_signal(gReleaseLiveCopy);
  assert(dispatch_group_wait(
             group, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);
  assert(status == AncPrivateVaultCustodyRepositoryStatusOK &&
         checkpoint != nil &&
         [checkpoint.vaultId isEqualToString:expectedVault]);
  AncPrivateVaultCustodySnapshot observed;
  AncPrivateVaultCustodyHandle *handle = nil;
  assert([repository readVaultId:expectedVault
                         snapshot:&observed
                           handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  NSData *observedEndpoint =
      [NSData dataWithBytes:observed.endpoint_id
                     length:observed.endpoint_id_length];
  NSData *observedCeremony =
      [NSData dataWithBytes:observed.ceremony_id
                     length:observed.ceremony_id_length];
  assert([[[NSString alloc] initWithData:observedEndpoint
                                encoding:NSASCIIStringEncoding]
             isEqualToString:expectedEndpoint] &&
         [[[NSString alloc] initWithData:observedCeremony
                                encoding:NSASCIIStringEncoding]
             isEqualToString:expectedCeremony] &&
         memcmp(observed.pending_transcript_digest, expectedBootstrap.bytes,
                32) == 0);
  assert([handle borrow:^BOOL(
                     const AncPrivateVaultCustodySecretInputs *stored) {
           return memcmp(stored->signing_seed, expectedSecrets.signingSeed,
                         32) == 0 &&
                  memcmp(stored->box_seed, expectedSecrets.boxSeed, 32) == 0 &&
                  memcmp(stored->local_state_key, expectedSecrets.localKey,
                         32) == 0 &&
                  memcmp(stored->pending_epoch_key, expectedSecrets.pendingKey,
                         32) == 0;
         }] == AncPrivateVaultCustodyRepositoryStatusOK);
  assert([handle close] == AncPrivateVaultCustodyRepositoryStatusOK);
  anc_pv_custody_snapshot_zero(&observed);
  anc_pv_zeroize(&secrets, sizeof secrets);
  anc_pv_zeroize(&expectedSecrets, sizeof expectedSecrets);
  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
  anc_pv_zeroize(boxPrivate, sizeof boxPrivate);
  anc_pv_zeroize(signingPublic, sizeof signingPublic);
  anc_pv_zeroize(boxPublic, sizeof boxPublic);
  anc_pv_zeroize(bootstrapBytes, sizeof bootstrapBytes);
}

static NSData *InstallCancellationFixture(
    AncPrivateVaultCustodyRepository *repository, NSString *vault,
    uint8_t seed) {
  TestSecrets secrets = {0};
  Fill(secrets.signingSeed, 32, seed);
  Fill(secrets.boxSeed, 32, (uint8_t)(seed + 32));
  Fill(secrets.localKey, 32, (uint8_t)(seed + 64));
  Fill(secrets.pendingKey, 32, (uint8_t)(seed + 96));
  uint8_t signingPublic[32] = {0};
  uint8_t signingPrivate[64] = {0};
  uint8_t boxPublic[32] = {0};
  uint8_t boxPrivate[32] = {0};
  assert(anc_pv_ed25519_seed_keypair(signingPublic, signingPrivate,
                                     secrets.signingSeed) ==
         ANC_PV_CRYPTO_OK);
  assert(anc_pv_box_seed_keypair(boxPublic, boxPrivate, secrets.boxSeed) ==
         ANC_PV_CRYPTO_OK);
  NSData *signing = [NSData dataWithBytes:signingPublic length:32];
  NSData *box = [NSData dataWithBytes:boxPublic length:32];
  uint8_t bootstrapBytes[32];
  Fill(bootstrapBytes, sizeof bootstrapBytes, 0x95);
  NSData *bootstrap = [NSData dataWithBytes:bootstrapBytes length:32];
  AncPrivateVaultCustodySecretInputs inputs = Inputs(&secrets);
  AncPrivateVaultPendingGenesisCustodyCheckpoint *pending = nil;
  assert([repository installPendingGenesisVaultId:vault
                                        endpointId:@"11112222333344445555666677778888"
                                        ceremonyId:@"88887777666655554444333322221111"
                                   signingPublicKey:signing
                                        boxPublicKey:box
                             bootstrapTranscriptDigest:bootstrap
                                           secrets:&inputs
                                        checkpoint:&pending] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  NSData *pendingDigest = [pending.recordDigest copy];
  anc_pv_zeroize(&secrets, sizeof secrets);
  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
  anc_pv_zeroize(boxPrivate, sizeof boxPrivate);
  anc_pv_zeroize(signingPublic, sizeof signingPublic);
  anc_pv_zeroize(boxPublic, sizeof boxPublic);
  anc_pv_zeroize(bootstrapBytes, sizeof bootstrapBytes);
  return pendingDigest;
}

static void TestPendingGenesisCancellation(void) {
  Reset();
  AncPrivateVaultCustodyRepository *repository = Repository();
  NSString *vault = @"abcdef0123456789abcdef0123456789";
  NSData *pendingDigest = InstallCancellationFixture(repository, vault, 0x15);
  NSMutableData *wrongDigest = [pendingDigest mutableCopy];
  ((uint8_t *)wrongDigest.mutableBytes)[0] ^= 1;
  AncPrivateVaultCancelledGenesisCustodyCheckpoint *cancelled = nil;
  const uint64_t cancelledAtMs = 1700000000555ULL;
  assert([repository cancelPendingGenesisVaultId:vault
                            expectedRecordDigest:wrongDigest
                                   cancelledAtMs:cancelledAtMs
                                      checkpoint:&cancelled] ==
         AncPrivateVaultCustodyRepositoryStatusConflict);
  assert(cancelled == nil);
  assert([repository cancelPendingGenesisVaultId:vault
                            expectedRecordDigest:pendingDigest
                                   cancelledAtMs:cancelledAtMs
                                      checkpoint:&cancelled] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(cancelled != nil && [cancelled.vaultId isEqualToString:vault] &&
         cancelled.custodyGeneration == 2 &&
         cancelled.recordDigest.length == 32 &&
         cancelled.cancellationCommitment.length == 32 &&
         cancelled.cancelledAtMs == cancelledAtMs);
  NSData *terminalDigest = [cancelled.recordDigest copy];
  NSData *commitment = [cancelled.cancellationCommitment copy];
  BOOL immutable = NO;
  @try {
    [cancelled setValue:[NSMutableData dataWithLength:32]
                 forKey:@"recordDigest"];
  } @catch (__unused NSException *exception) {
    immutable = YES;
  }
  assert(immutable && [cancelled.recordDigest isEqualToData:terminalDigest]);
  AncPrivateVaultCustodySnapshot observed;
  AncPrivateVaultCustodyHandle *handle = nil;
  assert([repository readVaultId:vault snapshot:&observed handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(observed.lifecycle ==
             ANC_PV_CUSTODY_LIFECYCLE_CANCELLED_GENESIS &&
         observed.custody_generation == 2 &&
         observed.removal_time_ms == cancelledAtMs && handle == nil &&
         memcmp(observed.removal_head, pendingDigest.bytes, 32) == 0 &&
         memcmp(observed.removal_authorization_digest, commitment.bytes, 32) ==
             0);
  AncPrivateVaultCustodySecretInputs zero = {0};
  assert([repository storeSnapshot:&observed secrets:&zero vaultId:vault] ==
         AncPrivateVaultCustodyRepositoryStatusConflict);
  anc_pv_custody_snapshot_zero(&observed);
  AncPrivateVaultCancelledGenesisCustodyCheckpoint *retry = nil;
  assert([repository cancelPendingGenesisVaultId:vault
                            expectedRecordDigest:pendingDigest
                                   cancelledAtMs:cancelledAtMs
                                      checkpoint:&retry] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert([retry.recordDigest isEqualToData:terminalDigest] &&
         [retry.cancellationCommitment isEqualToData:commitment] &&
         retry.cancelledAtMs == cancelledAtMs);
  assert([repository cancelPendingGenesisVaultId:vault
                            expectedRecordDigest:wrongDigest
                                   cancelledAtMs:cancelledAtMs
                                      checkpoint:&retry] ==
         AncPrivateVaultCustodyRepositoryStatusConflict);
  assert([repository cancelPendingGenesisVaultId:vault
                            expectedRecordDigest:pendingDigest
                                   cancelledAtMs:cancelledAtMs + 1
                                      checkpoint:&retry] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert([retry.recordDigest isEqualToData:terminalDigest] &&
         [retry.cancellationCommitment isEqualToData:commitment] &&
         retry.cancelledAtMs == cancelledAtMs);
}

static void TestPendingGenesisCancellationCrashAndConcurrency(void) {
  NSString *vault = @"abcdef0123456789abcdef0123456789";
  const uint64_t cancelledAtMs = 1700000000666ULL;
  for (NSUInteger failure = 1; failure <= 7; failure += 1) {
    Reset();
    AncPrivateVaultCustodyRepository *repository = Repository();
    NSData *pendingDigest =
        InstallCancellationFixture(repository, vault, (uint8_t)(0x16 + failure));
    gMutationCount = 0;
    gFailBefore = failure;
    (void)[repository cancelPendingGenesisVaultId:vault
                             expectedRecordDigest:pendingDigest
                                    cancelledAtMs:cancelledAtMs
                                       checkpoint:NULL];
    gFailBefore = 0;
    AncPrivateVaultCustodyRepository *restarted = Repository();
    AncPrivateVaultCustodySnapshot observed;
    AncPrivateVaultCustodyHandle *handle = nil;
    assert([restarted readVaultId:vault snapshot:&observed handle:&handle] ==
           AncPrivateVaultCustodyRepositoryStatusOK);
    assert((observed.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
            observed.custody_generation == 1 && handle != nil) ||
           (observed.lifecycle ==
                ANC_PV_CUSTODY_LIFECYCLE_CANCELLED_GENESIS &&
            observed.custody_generation == 2 && handle == nil));
    if (handle != nil)
      assert([handle close] == AncPrivateVaultCustodyRepositoryStatusOK);
    anc_pv_custody_snapshot_zero(&observed);
    AncPrivateVaultCancelledGenesisCustodyCheckpoint *checkpoint = nil;
    assert([restarted cancelPendingGenesisVaultId:vault
                              expectedRecordDigest:pendingDigest
                                     cancelledAtMs:cancelledAtMs
                                        checkpoint:&checkpoint] ==
           AncPrivateVaultCustodyRepositoryStatusOK);
    assert(checkpoint.custodyGeneration == 2);
    assert(gStore[KeyForService(AncPrivateVaultCustodyStageService)] == nil);
  }
  for (NSUInteger ambiguous = 1; ambiguous <= 7; ambiguous += 1) {
    Reset();
    AncPrivateVaultCustodyRepository *repository = Repository();
    NSData *pendingDigest = InstallCancellationFixture(
        repository, vault, (uint8_t)(0x26 + ambiguous));
    gMutationCount = 0;
    gCommitThenError = ambiguous;
    AncPrivateVaultCancelledGenesisCustodyCheckpoint *checkpoint = nil;
    assert([repository cancelPendingGenesisVaultId:vault
                              expectedRecordDigest:pendingDigest
                                     cancelledAtMs:cancelledAtMs
                                        checkpoint:&checkpoint] ==
           AncPrivateVaultCustodyRepositoryStatusOK);
    gCommitThenError = 0;
    assert(checkpoint.custodyGeneration == 2);
  }

  Reset();
  AncPrivateVaultCustodyRepository *repository = Repository();
  NSData *pendingDigest = InstallCancellationFixture(repository, vault, 0x45);
  const size_t count = 32;
  AncPrivateVaultCustodyRepositoryStatus *statuses =
      calloc(count, sizeof *statuses);
  assert(statuses != NULL);
  dispatch_group_t group = dispatch_group_create();
  for (size_t index = 0; index < count; index += 1) {
    dispatch_group_async(
        group, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
          statuses[index] =
              [Repository() cancelPendingGenesisVaultId:vault
                                    expectedRecordDigest:pendingDigest
                                           cancelledAtMs:cancelledAtMs + index
                                              checkpoint:NULL];
        });
  }
  dispatch_group_wait(group, DISPATCH_TIME_FOREVER);
  size_t winners = 0;
  for (size_t index = 0; index < count; index += 1)
    if (statuses[index] == AncPrivateVaultCustodyRepositoryStatusOK)
      winners += 1;
  assert(winners == count);
  free(statuses);
  AncPrivateVaultCustodySnapshot observed;
  AncPrivateVaultCustodyHandle *handle = nil;
  assert([Repository() readVaultId:vault snapshot:&observed handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(observed.lifecycle ==
             ANC_PV_CUSTODY_LIFECYCLE_CANCELLED_GENESIS &&
         observed.custody_generation == 2 && handle == nil &&
         observed.removal_time_ms >= cancelledAtMs &&
         observed.removal_time_ms < cancelledAtMs + count);
  anc_pv_custody_snapshot_zero(&observed);
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
        assert(
            [oldHandle borrow:^BOOL(
                           const AncPrivateVaultCustodySecretInputs *secrets) {
              (void)secrets;
              dispatch_semaphore_signal(firstEntered);
              dispatch_semaphore_wait(secondEntered, DISPATCH_TIME_FOREVER);
              firstSawOtherOpen = !otherHandle.closed;
              return YES;
            }] == AncPrivateVaultCustodyRepositoryStatusOK);
      });
  dispatch_group_async(
      oppositeClosedGroup,
      dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        assert([otherHandle
                   borrow:^BOOL(
                       const AncPrivateVaultCustodySecretInputs *secrets) {
                     (void)secrets;
                     dispatch_semaphore_signal(secondEntered);
                     dispatch_semaphore_wait(firstEntered,
                                             DISPATCH_TIME_FOREVER);
                     secondSawOtherOpen = !oldHandle.closed;
                     return YES;
                   }] == AncPrivateVaultCustodyRepositoryStatusOK);
      });
  assert(dispatch_group_wait(
             oppositeClosedGroup,
             dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);
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
          assert(
              [oldHandle borrow:^BOOL(
                             const AncPrivateVaultCustodySecretInputs *inner) {
                (void)inner;
                return YES;
              }] == AncPrivateVaultCustodyRepositoryStatusConflict);
          assert([oldHandle close] ==
                 AncPrivateVaultCustodyRepositoryStatusConflict);
          assert([otherHandle
                     borrow:^BOOL(
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
  assert(dispatch_semaphore_wait(
             recursiveDone,
             dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);
  assert(recursiveStatus == AncPrivateVaultCustodyRepositoryStatusOK);

  dispatch_semaphore_t borrowed = dispatch_semaphore_create(0);
  dispatch_semaphore_t releaseBorrow = dispatch_semaphore_create(0);
  dispatch_semaphore_t closeAttempt = dispatch_semaphore_create(0);
  dispatch_semaphore_t storeDone = dispatch_semaphore_create(0);
  __block AncPrivateVaultCustodyRepositoryStatus borrowStatus;
  __block AncPrivateVaultCustodyRepositoryStatus storeStatus;
  AncPrivateVaultCustodySetBeforeHandleCloseForTesting(
      ^(AncPrivateVaultCustodyHandle *closing) {
        if (closing == oldHandle)
          dispatch_semaphore_signal(closeAttempt);
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
  assert(dispatch_semaphore_wait(
             borrowed, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) ==
         0);
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    storeStatus = [secondRepository storeSnapshot:&second
                                          secrets:&secondInputs
                                          vaultId:@"vault"];
    dispatch_semaphore_signal(storeDone);
  });
  assert(dispatch_semaphore_wait(
             closeAttempt,
             dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);
  assert(dispatch_semaphore_wait(storeDone, DISPATCH_TIME_NOW) != 0);
  dispatch_semaphore_signal(releaseBorrow);
  assert(dispatch_semaphore_wait(
             storeDone, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) ==
         0);
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
  assert(dispatch_semaphore_wait(
             gLiveCopyEntered,
             dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    storeStatus = [secondRepository storeSnapshot:&second
                                          secrets:&secondInputs
                                          vaultId:@"vault"];
    dispatch_semaphore_signal(storeDone);
  });
  dispatch_semaphore_signal(gReleaseLiveCopy);
  assert(dispatch_semaphore_wait(
             readDone, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) ==
         0);
  assert(dispatch_semaphore_wait(
             storeDone, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) ==
         0);
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
  AncPrivateVaultCustodySnapshot *snapshots = calloc(count, sizeof *snapshots);
  TestSecrets *secrets = calloc(count, sizeof *secrets);
  AncPrivateVaultCustodyRepositoryStatus *statuses =
      calloc(count, sizeof *statuses);
  assert(snapshots != NULL && secrets != NULL && statuses != NULL);
  dispatch_group_t group = dispatch_group_create();
  for (size_t index = 0; index < count; index += 1) {
    MakeActive(&snapshots[index], &secrets[index], 2, (uint8_t)(65 + index),
               @"vault");
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
          AncPrivateVaultCustodyRepositoryStatus status = [handle
              borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
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
  assert(dispatch_group_wait(
             group, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) == 0);
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
  dispatch_queue_t queue =
      dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);
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
  AncPrivateVaultCustodySnapshot removed = removing;
  removed.custody_generation = 4;
  removed.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_REMOVED;
  TestSecrets removedSecrets = {0};
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

static void TestAdvanceAuthorityAnchorCAS(void) {
  Reset();
  AncPrivateVaultCustodyRepository *repository = Repository();
  AncPrivateVaultCustodySnapshot current;
  TestSecrets secrets;
  MakeActive(&current, &secrets, 1, 141, @"vault");
  AncPrivateVaultCustodySecretInputs source = Inputs(&secrets);
  assert([repository storeSnapshot:&current secrets:&source vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  AncPrivateVaultCustodySnapshot observed;
  AncPrivateVaultCustodyHandle *oldHandle = nil;
  assert([repository readVaultId:@"vault"
                        snapshot:&observed
                          handle:&oldHandle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  NSData *expected = [NSData dataWithBytes:current.snapshot_digest length:32];
  AncPrivateVaultCustodySnapshot next = current;
  next.custody_generation = 2;
  next.anchored_sequence += 1;
  Fill(next.anchored_head, 32, 0xa1);
  Fill(next.membership_digest, 32, 0xb1);
  Fill(next.snapshot_digest, 32, 0xc1);
  next.signed_at_ms += 1000;
  next.freshness_ms += 1000;
  assert(
      [repository
          advanceAuthorityAnchorVaultId:@"vault"
                     expectedGeneration:1
                 expectedSnapshotDigest:expected
                     nextPublicSnapshot:&next
                        epochTransition:
                            AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch] ==
      AncPrivateVaultCustodyRepositoryStatusOK);
  assert(oldHandle.closed);
  assert([oldHandle
             borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *borrowed) {
               (void)borrowed;
               return YES;
             }] != AncPrivateVaultCustodyRepositoryStatusOK);
  AssertRead(repository, @"vault", 2, 141);
  assert(
      [repository
          advanceAuthorityAnchorVaultId:@"vault"
                     expectedGeneration:1
                 expectedSnapshotDigest:expected
                     nextPublicSnapshot:&next
                        epochTransition:
                            AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch] ==
      AncPrivateVaultCustodyRepositoryStatusConflict);
}

static void TestPromoteGenesisAuthorityAnchorCAS(void) {
  Reset();
  AncPrivateVaultCustodyRepository *repository = Repository();
  AncPrivateVaultCustodySnapshot pending;
  TestSecrets secrets;
  MakePendingGenesis(&pending, &secrets, @"vault");
  AncPrivateVaultCustodySecretInputs source = Inputs(&secrets);
  assert([repository storeSnapshot:&pending secrets:&source vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);

  AncPrivateVaultCustodySnapshot official = pending;
  official.authority_anchor_present = 1;
  official.expected_edge_present = 0;
  official.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_ACTIVE;
  official.pending_kind = ANC_PV_CUSTODY_PENDING_NONE;
  official.rotation_phase = ANC_PV_CUSTODY_ROTATION_NONE;
  official.custody_generation = 2;
  official.ceremony_id_length = 0;
  memset(official.ceremony_id, 0, sizeof official.ceremony_id);
  official.active_epoch = 1;
  official.pending_epoch = 0;
  official.recovery_generation = 1;
  Fill(official.anchored_head, 32, 0xa1);
  Fill(official.membership_digest, 32, 0xb1);
  official.signed_at_ms = 1700000010000ULL;
  Fill(official.snapshot_digest, 32, 0xc1);
  official.freshness_ms = 1700000011000ULL;
  memset(official.pending_transcript_digest, 0, 32);
  assert([repository promoteGenesisAuthorityAnchorVaultId:@"vault"
                                       nextPublicSnapshot:&official] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  AncPrivateVaultCustodySnapshot observed;
  AncPrivateVaultCustodyHandle *handle = nil;
  assert([repository readVaultId:@"vault" snapshot:&observed handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(observed.custody_generation == 2 &&
         observed.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
         observed.authority_anchor_present && !observed.expected_edge_present &&
         observed.pending_kind == ANC_PV_CUSTODY_PENDING_NONE &&
         observed.active_epoch == 1 && observed.pending_epoch == 0);
  __block BOOL promotedSecret = NO;
  assert([handle borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *value) {
           promotedSecret =
               memcmp(value->active_epoch_key, secrets.pendingKey, 32) == 0;
           uint8_t zero[32] = {0};
           return promotedSecret &&
                  memcmp(value->pending_epoch_key, zero, 32) == 0;
         }] == AncPrivateVaultCustodyRepositoryStatusOK);
  assert([handle close] == AncPrivateVaultCustodyRepositoryStatusOK);
  assert(promotedSecret);
  assert([repository promoteGenesisAuthorityAnchorVaultId:@"vault"
                                       nextPublicSnapshot:&official] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  official.membership_digest[0] ^= 1;
  assert([repository promoteGenesisAuthorityAnchorVaultId:@"vault"
                                       nextPublicSnapshot:&official] ==
         AncPrivateVaultCustodyRepositoryStatusConflict);
  official.membership_digest[0] ^= 1;
  official.custody_generation = 3;
  assert([repository promoteGenesisAuthorityAnchorVaultId:@"vault"
                                       nextPublicSnapshot:&official] !=
         AncPrivateVaultCustodyRepositoryStatusOK);
  anc_pv_zeroize(&secrets, sizeof secrets);
}

static void TestPendingRecoveryPromotionCAS(void) {
  Reset();
  AncPrivateVaultCustodyRepository *repository = Repository();
  NSString *vault = @"11112222333344445555666677778888";
  NSString *endpoint = @"9999aaaabbbbccccddddeeeeffff0000";
  NSString *ceremony = @"0123456789abcdeffedcba9876543210";
  TestSecrets secrets = {0};
  Fill(secrets.signingSeed, 32, 0x21);
  Fill(secrets.boxSeed, 32, 0x31);
  Fill(secrets.localKey, 32, 0x41);
  Fill(secrets.pendingKey, 32, 0x51);
  uint8_t signingPublic[32] = {0};
  uint8_t signingPrivate[64] = {0};
  uint8_t boxPublic[32] = {0};
  uint8_t boxPrivate[32] = {0};
  assert(anc_pv_ed25519_seed_keypair(signingPublic, signingPrivate,
                                     secrets.signingSeed) ==
         ANC_PV_CRYPTO_OK);
  assert(anc_pv_box_seed_keypair(boxPublic, boxPrivate, secrets.boxSeed) ==
         ANC_PV_CRYPTO_OK);
  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
  anc_pv_zeroize(boxPrivate, sizeof boxPrivate);
  NSData *signing = [NSData dataWithBytes:signingPublic length:32];
  NSData *box = [NSData dataWithBytes:boxPublic length:32];
  NSData *previousHead = [NSData dataWithBytes:(uint8_t[32]){1} length:32];
  NSData *authorizationHash =
      [NSData dataWithBytes:(uint8_t[32]){2} length:32];
  AncPrivateVaultCustodySecretInputs inputs = Inputs(&secrets);
  AncPrivateVaultPendingRecoveryCustodyCheckpoint *checkpoint = nil;
  AncPrivateVaultCustodyRepositoryStatus recoveryInstall = [repository
             installPendingRecoveryVaultId:vault
                                  endpointId:endpoint
                                  ceremonyId:ceremony
                             signingPublicKey:signing
                                  boxPublicKey:box
                                    nextEpoch:4
                    replacementRecoveryGeneration:3
                            expectedNextSequence:8
                             expectedPreviousHead:previousHead
                       recoveryAuthorizationHash:authorizationHash
                                     secrets:&inputs
                                  checkpoint:&checkpoint];
  assert(recoveryInstall == AncPrivateVaultCustodyRepositoryStatusOK);
  assert(checkpoint.custodyGeneration == 1 &&
         checkpoint.recordDigest.length == 32);
  AncPrivateVaultCustodySnapshot pending;
  AncPrivateVaultCustodyHandle *handle = nil;
  assert([repository readVaultId:vault snapshot:&pending handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(pending.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
         pending.pending_kind == ANC_PV_CUSTODY_PENDING_RECOVERY &&
         pending.rotation_phase == ANC_PV_CUSTODY_ROTATION_PREPARED &&
         pending.enrollment_phase ==
             ANC_PV_CUSTODY_ENROLLMENT_AUTHORIZATION_RECEIVED &&
         pending.pending_epoch == 4 && pending.recovery_generation == 3 &&
         pending.expected_next_sequence == 8);
  assert([handle close] == AncPrivateVaultCustodyRepositoryStatusOK);

  AncPrivateVaultCustodySnapshot official = pending;
  official.authority_anchor_present = 1;
  official.expected_edge_present = 0;
  official.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_ACTIVE;
  official.pending_kind = ANC_PV_CUSTODY_PENDING_NONE;
  official.rotation_phase = ANC_PV_CUSTODY_ROTATION_NONE;
  official.enrollment_phase = ANC_PV_CUSTODY_ENROLLMENT_NONE;
  official.custody_generation = 2;
  memset(official.ceremony_id, 0, sizeof official.ceremony_id);
  official.ceremony_id_length = 0;
  official.active_epoch = 4;
  official.pending_epoch = 0;
  official.anchored_sequence = 8;
  Fill(official.anchored_head, 32, 0x61);
  Fill(official.membership_digest, 32, 0x71);
  official.signed_at_ms = 1700000010000ULL;
  Fill(official.snapshot_digest, 32, 0x81);
  official.freshness_ms = 1700000011000ULL;
  official.expected_next_sequence = 0;
  memset(official.expected_previous_head, 0, 32);
  memset(official.pending_transcript_digest, 0, 32);
  assert(AncPrivateVaultCustodyPromoteRecoveryAuthorityAnchor(
             repository, vault, &official) ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  handle = nil;
  assert([repository readVaultId:vault snapshot:&pending handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(pending.custody_generation == 2 &&
         pending.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
         pending.active_epoch == 4 && pending.pending_epoch == 0 &&
         pending.anchored_sequence == 8);
  __block BOOL promoted = NO;
  assert([handle borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *value) {
           uint8_t zero[32] = {0};
           promoted = memcmp(value->active_epoch_key, secrets.pendingKey, 32) ==
                          0 &&
                      memcmp(value->pending_epoch_key, zero, 32) == 0;
           return promoted;
         }] == AncPrivateVaultCustodyRepositoryStatusOK);
  assert([handle close] == AncPrivateVaultCustodyRepositoryStatusOK &&
         promoted);
  assert(AncPrivateVaultCustodyPromoteRecoveryAuthorityAnchor(
             repository, vault, &official) ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  official.recovery_generation += 1;
  assert(AncPrivateVaultCustodyPromoteRecoveryAuthorityAnchor(
             repository, vault, &official) ==
         AncPrivateVaultCustodyRepositoryStatusConflict);
  anc_pv_zeroize(&secrets, sizeof secrets);
}

static void TestLegacyCodecMigrations(void) {
  Reset();
  AncPrivateVaultKeychain *keychain = Keychain();
  AncPrivateVaultCustodyRepository *repository =
      [[AncPrivateVaultCustodyRepository alloc] initWithKeychain:keychain];
  AncPrivateVaultCustodySnapshot offer;
  TestSecrets secrets;
  MakeActive(&offer, &secrets, 1, 151, @"vault");
  offer.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  offer.pending_kind = ANC_PV_CUSTODY_PENDING_ADD_DEVICE;
  offer.enrollment_phase = ANC_PV_CUSTODY_ENROLLMENT_OFFER_PENDING;
  SetId(offer.ceremony_id, &offer.ceremony_id_length, @"ceremony-legacy");
  offer.active_epoch = 0;
  memset(secrets.activeKey, 0, 32);
  offer.recovery_generation = 0;
  offer.authority_anchor_present = 0;
  offer.anchored_sequence = 0;
  memset(offer.anchored_head, 0, 32);
  memset(offer.membership_digest, 0, 32);
  offer.signed_at_ms = 0;
  memset(offer.snapshot_digest, 0, 32);
  offer.freshness_ms = 0;
  NSData *legacyOffer = LegacyRecord(Encode(&offer, &secrets));
  SeedLegacy(keychain, legacyOffer, @"vault");
  AncPrivateVaultCustodyRepositoryStatus offerMigration =
      [repository migrateLegacyCodecVaultId:@"vault" expectedGeneration:1];
  assert(offerMigration == AncPrivateVaultCustodyRepositoryStatusOK);
  AncPrivateVaultCustodySnapshot migrated;
  AncPrivateVaultCustodyHandle *handle = nil;
  assert([repository readVaultId:@"vault" snapshot:&migrated handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(migrated.record_version == ANC_PV_CUSTODY_VERSION &&
         migrated.custody_generation == 2 &&
         !migrated.authority_anchor_present && !migrated.expected_edge_present);
  assert([handle close] == AncPrivateVaultCustodyRepositoryStatusOK);
  assert([repository migrateLegacyCodecVaultId:@"vault" expectedGeneration:1] ==
         AncPrivateVaultCustodyRepositoryStatusConflict);

  Reset();
  keychain = Keychain();
  repository =
      [[AncPrivateVaultCustodyRepository alloc] initWithKeychain:keychain];
  AncPrivateVaultCustodySnapshot genesis;
  TestSecrets genesisSecrets;
  MakeActive(&genesis, &genesisSecrets, 1, 155, @"vault");
  genesis.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  genesis.pending_kind = ANC_PV_CUSTODY_PENDING_GENESIS;
  genesis.rotation_phase = ANC_PV_CUSTODY_ROTATION_PREPARED;
  SetId(genesis.ceremony_id, &genesis.ceremony_id_length, @"genesis-legacy");
  genesis.active_epoch = 0;
  memset(genesisSecrets.activeKey, 0, 32);
  genesis.pending_epoch = 1;
  Fill(genesisSecrets.pendingKey, 32, 0xd1);
  genesis.recovery_generation = 0;
  genesis.authority_anchor_present = 0;
  genesis.expected_edge_present = 1;
  genesis.expected_next_sequence = 0;
  memset(genesis.expected_previous_head, 0, 32);
  Fill(genesis.pending_transcript_digest, 32, 0xcf);
  genesis.anchored_sequence = 0;
  memset(genesis.anchored_head, 0, 32);
  memset(genesis.membership_digest, 0, 32);
  genesis.signed_at_ms = 0;
  memset(genesis.snapshot_digest, 0, 32);
  genesis.freshness_ms = 0;
  SeedLegacy(keychain, LegacyRecord(Encode(&genesis, &genesisSecrets)),
             @"vault");
  assert([repository migrateLegacyCodecVaultId:@"vault" expectedGeneration:1] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  handle = nil;
  assert([repository readVaultId:@"vault" snapshot:&migrated handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(migrated.record_version == ANC_PV_CUSTODY_VERSION &&
         migrated.custody_generation == 2 &&
         migrated.pending_kind == ANC_PV_CUSTODY_PENDING_GENESIS &&
         migrated.expected_edge_present &&
         migrated.expected_next_sequence == 0 &&
         memcmp(migrated.pending_transcript_digest,
                genesis.pending_transcript_digest, 32) == 0);
  assert([handle close] == AncPrivateVaultCustodyRepositoryStatusOK);

  Reset();
  keychain = Keychain();
  repository =
      [[AncPrivateVaultCustodyRepository alloc] initWithKeychain:keychain];
  AncPrivateVaultCustodySnapshot legacyActive;
  TestSecrets legacyActiveSecrets;
  MakeActive(&legacyActive, &legacyActiveSecrets, 1, 157, @"vault");
  SeedLegacy(keychain,
             LegacyRecord(Encode(&legacyActive, &legacyActiveSecrets)),
             @"vault");
  assert([repository migrateLegacyCodecVaultId:@"vault" expectedGeneration:1] ==
         AncPrivateVaultCustodyRepositoryStatusConflict);

  Reset();
  keychain = Keychain();
  repository =
      [[AncPrivateVaultCustodyRepository alloc] initWithKeychain:keychain];
  AncPrivateVaultCustodySnapshot recovery;
  TestSecrets recoverySecrets;
  MakeActive(&recovery, &recoverySecrets, 1, 159, @"vault");
  recovery.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  recovery.pending_kind = ANC_PV_CUSTODY_PENDING_RECOVERY;
  recovery.rotation_phase = ANC_PV_CUSTODY_ROTATION_PREPARED;
  SetId(recovery.ceremony_id, &recovery.ceremony_id_length, @"recovery-legacy");
  memset(recoverySecrets.activeKey, 0, 32);
  recovery.pending_epoch = recovery.active_epoch + 1;
  Fill(recoverySecrets.pendingKey, 32, 0xe1);
  recovery.expected_edge_present = 1;
  recovery.expected_next_sequence = recovery.anchored_sequence + 1;
  memcpy(recovery.expected_previous_head, recovery.anchored_head, 32);
  Fill(recovery.pending_transcript_digest, 32, 0xf1);
  SeedLegacy(keychain, LegacyRecord(Encode(&recovery, &recoverySecrets)),
             @"vault");
  assert([repository migrateLegacyCodecVaultId:@"vault" expectedGeneration:1] ==
         AncPrivateVaultCustodyRepositoryStatusConflict);

  Reset();
  keychain = Keychain();
  repository =
      [[AncPrivateVaultCustodyRepository alloc] initWithKeychain:keychain];
  AncPrivateVaultCustodySnapshot invalidGenerationOne;
  TestSecrets invalidGenerationOneSecrets;
  MakeTombstone(&invalidGenerationOne, &invalidGenerationOneSecrets, 1,
                ANC_PV_CUSTODY_LIFECYCLE_REMOVED);
  SeedLegacy(
      keychain,
      LegacyRecord(Encode(&invalidGenerationOne, &invalidGenerationOneSecrets)),
      @"vault");
  assert([repository migrateLegacyCodecVaultId:@"vault" expectedGeneration:1] ==
         AncPrivateVaultCustodyRepositoryStatusRollbackDetected);

  Reset();
  keychain = Keychain();
  repository =
      [[AncPrivateVaultCustodyRepository alloc] initWithKeychain:keychain];
  AncPrivateVaultCustodySnapshot active;
  TestSecrets activeSecrets;
  MakeActive(&active, &activeSecrets, 1, 161, @"vault");
  AncPrivateVaultCustodySecretInputs activeInputs = Inputs(&activeSecrets);
  assert([repository storeSnapshot:&active
                           secrets:&activeInputs
                           vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  AncPrivateVaultCustodySnapshot removing;
  TestSecrets removingSecrets;
  MakeTombstone(&removing, &removingSecrets, 2,
                ANC_PV_CUSTODY_LIFECYCLE_REMOVING);
  StageLegacy(keychain, LegacyRecord(Encode(&removing, &removingSecrets)),
              @"vault", 2);
  AncPrivateVaultCustodyRepositoryStatus removingMigration =
      [repository migrateLegacyCodecVaultId:@"vault" expectedGeneration:2];
  assert(removingMigration == AncPrivateVaultCustodyRepositoryStatusOK);
  handle = nil;
  assert([repository readVaultId:@"vault" snapshot:&migrated handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(migrated.record_version == ANC_PV_CUSTODY_VERSION &&
         migrated.custody_generation == 3 &&
         migrated.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVING &&
         handle == nil);

  AncPrivateVaultCustodySnapshot removed = migrated;
  removed.record_version = ANC_PV_CUSTODY_VERSION;
  removed.custody_generation = 4;
  removed.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_REMOVED;
  TestSecrets removedSecrets = {0};
  AncPrivateVaultCustodySecretInputs removedInputs = Inputs(&removedSecrets);
  AncPrivateVaultCustodySnapshot substitutions[9];
  for (size_t index = 0; index < 9; index += 1)
    substitutions[index] = removed;
  substitutions[0].endpoint_id[0] ^= 1;
  substitutions[1].signing_public_key[0] ^= 1;
  substitutions[2].box_public_key[0] ^= 1;
  substitutions[3].membership_digest[0] ^= 1;
  substitutions[4].removal_authorization_digest[0] ^= 1;
  substitutions[5].signed_at_ms += 1;
  substitutions[6].freshness_ms += 1;
  substitutions[7].role = ANC_PV_CUSTODY_ROLE_BROKER;
  substitutions[8].recovery_generation += 1;
  for (size_t index = 0; index < 9; index += 1) {
    assert([repository storeSnapshot:&substitutions[index]
                             secrets:&removedInputs
                             vaultId:@"vault"] ==
           AncPrivateVaultCustodyRepositoryStatusConflict);
  }
  Reset();
  keychain = Keychain();
  repository =
      [[AncPrivateVaultCustodyRepository alloc] initWithKeychain:keychain];
  MakeActive(&active, &activeSecrets, 1, 163, @"vault");
  activeInputs = Inputs(&activeSecrets);
  assert([repository storeSnapshot:&active
                           secrets:&activeInputs
                           vaultId:@"vault"] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  MakeTombstone(&removing, &removingSecrets, 2,
                ANC_PV_CUSTODY_LIFECYCLE_REMOVING);
  StageLegacy(keychain, LegacyRecord(Encode(&removing, &removingSecrets)),
              @"vault", 2);
  handle = nil;
  assert([repository readVaultId:@"vault" snapshot:&migrated handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(migrated.record_version == ANC_PV_CUSTODY_LEGACY_VERSION &&
         migrated.custody_generation == 2 &&
         migrated.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVING &&
         handle == nil);
  removed = migrated;
  removed.record_version = ANC_PV_CUSTODY_VERSION;
  removed.custody_generation = 3;
  removed.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_REMOVED;
  StageLegacy(keychain, LegacyRecord(Encode(&removed, &removedSecrets)),
              @"vault", 3);
  assert([repository migrateLegacyCodecVaultId:@"vault" expectedGeneration:3] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  handle = nil;
  assert([repository readVaultId:@"vault" snapshot:&migrated handle:&handle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(migrated.record_version == ANC_PV_CUSTODY_VERSION &&
         migrated.custody_generation == 4 &&
         migrated.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED &&
         handle == nil);
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    TestExactCustodyKeychainBoundary();
    TestRoundTripAndMonotonicity();
    TestCrashMatrixAndAmbiguousCommits();
    TestCorruptionSwapAndMissing();
    TestPendingMissingMismatchAndFutureStage();
    TestGenesisTombstonesFailClosed();
    TestPendingGenesisInstallCheckpoint();
    TestPendingGenesisOwnsMutableInputs();
    TestPendingGenesisCancellation();
    TestPendingGenesisCancellationCrashAndConcurrency();
    TestSubstitutionAndPendingSourceSwap();
    TestHandleRevocationAndReadStoreSerialization();
    TestSixtyFourConcurrentWriters();
    TestConcurrentUserCloseBorrowAndRepositoryRevoke();
    TestTombstonesAndConcurrentWriters();
    TestAdvanceAuthorityAnchorCAS();
    TestPromoteGenesisAuthorityAnchorCAS();
    TestPendingRecoveryPromotionCAS();
    TestLegacyCodecMigrations();
    puts("private-vault custody repository tests passed");
  }
  return 0;
}
