#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

#import "PrivateVaultCrypto.h"
#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultGenesisArtifactStore.h"
#import "PrivateVaultGenesisBootstrap.h"
#import "PrivateVaultGenesisCoordinator.h"
#import "PrivateVaultGenesisCoordinatorInternal.h"
#import "PrivateVaultGenesisHostedAppend.h"
#import "PrivateVaultGenesisLock.h"
#import "PrivateVaultGenesisStartup.h"
#import "PrivateVaultMnemonic.h"

#import <sodium.h>

#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>

#ifndef ANC_PV_GENESIS_AUTHORIZATION_VECTOR_PATH
#error ANC_PV_GENESIS_AUTHORIZATION_VECTOR_PATH must name the frozen Core corpus
#endif

#define CHECK(c)                                                               \
  do {                                                                         \
    if (!(c)) {                                                                \
      fprintf(stderr, "genesis coordinator CHECK failed %s:%d: %s\n",          \
              __FILE__, __LINE__, #c);                                         \
      return 1;                                                                \
    }                                                                          \
  } while (0)

static NSString *gKeychainPath;
static BOOL gAmbiguousNextUpdate;
static BOOL gFailNextUpdateBeforeSave;
typedef NS_ENUM(NSInteger, CustodyMutationMode) {
  CustodyMutationModeDisabled = 0,
  CustodyMutationModeCountOnly = 1,
  CustodyMutationModeFailBefore = 2,
  CustodyMutationModeCommitThenError = 3,
};
static CustodyMutationMode gCustodyMutationMode;
static NSUInteger gCustodyMutationTarget;
static NSUInteger gCustodyMutationCount;
static BOOL gCustodyMutationHit;
static NSObject *KeychainSynchronization(void) {
  static NSObject *token;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    token = [NSObject new];
  });
  return token;
}
static CustodyMutationMode CustodyMutation(void) {
  if (gCustodyMutationMode == CustodyMutationModeDisabled)
    return CustodyMutationModeDisabled;
  gCustodyMutationCount += 1;
  if (gCustodyMutationMode == CustodyMutationModeCountOnly ||
      gCustodyMutationCount != gCustodyMutationTarget)
    return CustodyMutationModeDisabled;
  gCustodyMutationHit = YES;
  return gCustodyMutationMode;
}
static NSString *Key(NSDictionary *query) {
  return
      [NSString stringWithFormat:@"%@|%@", query[(__bridge id)kSecAttrService],
                                 query[(__bridge id)kSecAttrAccount]];
}
static NSMutableDictionary *LoadKeychain(void) {
  NSDictionary *value =
      [NSDictionary dictionaryWithContentsOfFile:gKeychainPath];
  return value == nil ? [NSMutableDictionary dictionary] : [value mutableCopy];
}
static BOOL SaveKeychain(NSDictionary *value) {
  return [value writeToFile:gKeychainPath atomically:YES];
}
static OSStatus KCopy(CFDictionaryRef raw, CFTypeRef *result) {
  @synchronized(KeychainSynchronization()) {
    NSData *value = LoadKeychain()[Key((__bridge NSDictionary *)raw)];
    if (value == nil)
      return errSecItemNotFound;
    if (result)
      *result = CFBridgingRetain([value copy]);
    return errSecSuccess;
  }
}
static OSStatus KAdd(CFDictionaryRef raw, CFTypeRef *result) {
  @synchronized(KeychainSynchronization()) {
    (void)result;
    NSDictionary *q = (__bridge NSDictionary *)raw;
    NSMutableDictionary *store = LoadKeychain();
    NSString *key = Key(q);
    if (store[key] != nil)
      return errSecDuplicateItem;
    CustodyMutationMode mutation = CustodyMutation();
    if (mutation == CustodyMutationModeFailBefore)
      return errSecIO;
    store[key] = [q[(__bridge id)kSecValueData] copy];
    BOOL saved = SaveKeychain(store);
    if (saved && mutation == CustodyMutationModeCommitThenError)
      return errSecIO;
    return saved ? errSecSuccess : errSecIO;
  }
}
static OSStatus KUpdate(CFDictionaryRef rawQuery,
                        CFDictionaryRef rawAttributes) {
  @synchronized(KeychainSynchronization()) {
    NSDictionary *q = (__bridge NSDictionary *)rawQuery;
    NSMutableDictionary *store = LoadKeychain();
    NSString *key = Key(q);
    if (store[key] == nil)
      return errSecItemNotFound;
    if (gFailNextUpdateBeforeSave) {
      gFailNextUpdateBeforeSave = NO;
      return errSecIO;
    }
    CustodyMutationMode mutation = CustodyMutation();
    if (mutation == CustodyMutationModeFailBefore)
      return errSecIO;
    store[key] = [(__bridge NSDictionary *)rawAttributes
        objectForKey:(__bridge id)kSecValueData];
    BOOL saved = SaveKeychain(store);
    if (saved && gAmbiguousNextUpdate) {
      gAmbiguousNextUpdate = NO;
      return errSecIO;
    }
    if (saved && mutation == CustodyMutationModeCommitThenError)
      return errSecIO;
    return saved ? errSecSuccess : errSecIO;
  }
}
static OSStatus KDelete(CFDictionaryRef raw) {
  @synchronized(KeychainSynchronization()) {
    NSMutableDictionary *store = LoadKeychain();
    NSString *key = Key((__bridge NSDictionary *)raw);
    if (store[key] == nil)
      return errSecItemNotFound;
    CustodyMutationMode mutation = CustodyMutation();
    if (mutation == CustodyMutationModeFailBefore)
      return errSecIO;
    [store removeObjectForKey:key];
    BOOL saved = SaveKeychain(store);
    if (saved && mutation == CustodyMutationModeCommitThenError)
      return errSecIO;
    return saved ? errSecSuccess : errSecIO;
  }
}
static AncPrivateVaultKeychain *TestKeychain(void) {
  AncPrivateVaultSecItemFunctions f = {.copyMatching = KCopy,
                                       .add = KAdd,
                                       .update = KUpdate,
                                       .deleteItem = KDelete};
  return [[AncPrivateVaultKeychain alloc]
      initWithFunctions:f
         contextFactory:^LAContext * {
           return [LAContext new];
         }];
}
static AncPrivateVaultCustodyRepository *Repository(void) {
  return [[AncPrivateVaultCustodyRepository alloc]
      initWithKeychain:TestKeychain()];
}
static NSData *HexData(NSString *hex) {
  if (hex.length == 0 || hex.length % 2 != 0)
    return nil;
  NSMutableData *data = [NSMutableData dataWithLength:hex.length / 2];
  uint8_t *out = data.mutableBytes;
  for (NSUInteger i = 0; i < data.length; i++) {
    unsigned value = 0;
    if ([[NSScanner
            scannerWithString:[hex substringWithRange:NSMakeRange(i * 2, 2)]]
            scanHexInt:&value] == NO)
      return nil;
    out[i] = (uint8_t)value;
  }
  return data;
}
static NSDictionary *Exact(void) {
  NSData *data =
      [NSData dataWithContentsOfFile:@ANC_PV_GENESIS_AUTHORIZATION_VECTOR_PATH];
  NSDictionary *root = [NSJSONSerialization JSONObjectWithData:data
                                                       options:0
                                                         error:nil];
  return root[@"exact"];
}
static NSString *HexString(NSData *data) {
  const uint8_t *p = data.bytes;
  NSMutableString *s = [NSMutableString stringWithCapacity:data.length * 2];
  for (NSUInteger i = 0; i < data.length; i++)
    [s appendFormat:@"%02x", p[i]];
  return s;
}

static NSData *GenesisHostedReceipt(
    const AncPrivateVaultGenesisPreparationSnapshot *snapshot) {
  NSData *vault = [NSData dataWithBytes:snapshot->vault_id length:16];
  NSData *entry =
      [NSData dataWithBytes:snapshot->log_entry_envelope_id length:16];
  NSData *head =
      [NSData dataWithBytes:snapshot->genesis_control_head_hash length:32];
  NSData *wrapHash =
      [NSData dataWithBytes:snapshot->recovery_wrap_hash length:32];
  AncPrivateVaultCanonicalValue *root =
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue integer:1],
        @3 : [AncPrivateVaultCanonicalValue
                 text:@"control-log-genesis-append-receipt"],
        @4 : [AncPrivateVaultCanonicalValue text:HexString(vault)],
        @5 : [AncPrivateVaultCanonicalValue text:HexString(entry)],
        @6 : [AncPrivateVaultCanonicalValue integer:0],
        @7 : [AncPrivateVaultCanonicalValue bytes:head],
        @8 : [AncPrivateVaultCanonicalValue bytes:wrapHash],
        @9 : [AncPrivateVaultCanonicalValue
                 integer:(int64_t)snapshot->recovery_wrap_length],
      }];
  AncPrivateVaultCanonicalStatus status;
  NSData *encoded = AncPrivateVaultCanonicalEncode(root, &status);
  return AncPrivateVaultGenesisHostedAppendReceiptDecode(encoded) != nil
             ? encoded
             : nil;
}
static void SetId(uint8_t out[160], size_t *length, NSString *value) {
  NSData *d = [value dataUsingEncoding:NSUTF8StringEncoding];
  memset(out, 0, 160);
  memcpy(out, d.bytes, d.length);
  *length = d.length;
}
static BOOL SyntheticSeed(NSString *label, uint8_t out[32]) {
  NSString *payload = [NSString
      stringWithFormat:
          @"agent-native synthetic genesis authorization vector %@", label];
  NSData *p = [payload dataUsingEncoding:NSUTF8StringEncoding];
  static const uint8_t prefix[] = "anc/v1/recovery\0";
  crypto_generichash_state state;
  BOOL ok = crypto_generichash_init(&state, NULL, 0, 32) == 0 &&
            crypto_generichash_update(&state, prefix, sizeof prefix - 1) == 0 &&
            crypto_generichash_update(&state, p.bytes, p.length) == 0 &&
            crypto_generichash_final(&state, out, 32) == 0;
  sodium_memzero(&state, sizeof state);
  return ok;
}
static int SeedPendingVariant(AncPrivateVaultCustodyRepository *repository,
                              NSDictionary *exact, NSInteger mutation) {
  NSData *bootstrap = HexData(exact[@"bootstrapTranscriptHex"]),
         *confirmation = HexData(exact[@"recoveryConfirmationHex"]);
  AncPrivateVaultGenesisBootstrapStatus status;
  AncPrivateVaultGenesisBootstrapResult *verified =
      AncPrivateVaultGenesisBootstrapVerify(bootstrap, confirmation, nil,
                                            &status);
  CHECK(verified != nil);
  AncPrivateVaultGenesisBootstrapTranscript *t = verified.transcript;
  NSString *vault = HexString(t.vaultId), *endpoint = HexString(t.endpointId),
           *ceremony = HexString(t.ceremonyId);
  uint8_t signing[32], box[32], local[32], pendingKey[32], active[32] = {0};
  CHECK(SyntheticSeed(@"endpoint signing", signing));
  CHECK(SyntheticSeed(@"endpoint agreement", box));
  if (mutation == 3)
    signing[0] ^= 1;
  else if (mutation == 4)
    box[0] ^= 1;
  memset(local, 0x91, 32);
  memset(pendingKey, 0xa2, 32);
  AncPrivateVaultCustodySnapshot s = {0};
  s.record_version = ANC_PV_CUSTODY_VERSION;
  s.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  s.role = ANC_PV_CUSTODY_ROLE_ENDPOINT;
  s.pending_kind = ANC_PV_CUSTODY_PENDING_GENESIS;
  s.rotation_phase = ANC_PV_CUSTODY_ROTATION_PREPARED;
  s.custody_generation = 1;
  s.expected_edge_present = 1;
  s.pending_epoch = 1;
  SetId(s.vault_id, &s.vault_id_length, vault);
  SetId(s.endpoint_id, &s.endpoint_id_length, endpoint);
  SetId(s.ceremony_id, &s.ceremony_id_length, ceremony);
  uint8_t privateSigning[64], privateBox[32];
  CHECK(anc_pv_ed25519_seed_keypair(s.signing_public_key, privateSigning,
                                    signing) == ANC_PV_CRYPTO_OK);
  CHECK(anc_pv_box_seed_keypair(s.box_public_key, privateBox, box) ==
        ANC_PV_CRYPTO_OK);
  if (mutation != 3)
    CHECK([t.endpointSigningPublicKey
        isEqualToData:[NSData dataWithBytes:s.signing_public_key length:32]]);
  if (mutation != 4)
    CHECK([t.endpointKeyAgreementPublicKey
        isEqualToData:[NSData dataWithBytes:s.box_public_key length:32]]);
  memcpy(s.pending_transcript_digest, verified.digest.bytes, 32);
  if (mutation == 1)
    s.ceremony_id[0] ^= 1;
  else if (mutation == 2)
    s.endpoint_id[0] ^= 1;
  else if (mutation == 5)
    s.pending_transcript_digest[0] ^= 1;
  AncPrivateVaultCustodySecretInputs secrets = {.signing_seed = signing,
                                                .box_seed = box,
                                                .local_state_key = local,
                                                .active_epoch_key = active,
                                                .pending_epoch_key =
                                                    pendingKey};
  AncPrivateVaultCustodyRepositoryStatus stored =
      [repository storeSnapshot:&s secrets:&secrets vaultId:vault];
  sodium_memzero(signing, 32);
  sodium_memzero(box, 32);
  sodium_memzero(local, 32);
  sodium_memzero(pendingKey, 32);
  sodium_memzero(privateSigning, 64);
  sodium_memzero(privateBox, 32);
  CHECK(stored == AncPrivateVaultCustodyRepositoryStatusOK);
  return 0;
}
static int SeedPending(AncPrivateVaultCustodyRepository *repository,
                       NSDictionary *exact) {
  return SeedPendingVariant(repository, exact, 0);
}

static AncPrivateVaultGenesisCoordinator *Coordinator(NSString *root) {
  AncPrivateVaultCustodyRepository *repository = Repository();
  return [[AncPrivateVaultGenesisCoordinator alloc]
      initWithArtifactStore:[[AncPrivateVaultGenesisArtifactStore alloc]
                                initWithStateRootURL:[NSURL
                                                         fileURLWithPath:root]]
             authorityStore:[[AncPrivateVaultAuthorityStore alloc]
                                initWithStateRootURL:[NSURL
                                                         fileURLWithPath:root]
                                   custodyRepository:repository]
          custodyRepository:repository
                 controlLog:[AncPrivateVaultControlLog new]];
}
@interface FixedClock : NSObject <AncPrivateVaultGenesisTrustedClock>
@property(nonatomic) uint64_t value;
@property(nonatomic) BOOL available;
@end
@implementation FixedClock
- (BOOL)readNowMilliseconds:(uint64_t *)milliseconds {
  if (!milliseconds || !self.available)
    return NO;
  *milliseconds = self.value;
  return YES;
}
@end
static AncPrivateVaultGenesisCoordinator *
CoordinatorWithClock(NSString *root,
                     id<AncPrivateVaultGenesisTrustedClock> clock) {
  AncPrivateVaultCustodyRepository *repository = Repository();
  return [[AncPrivateVaultGenesisCoordinator alloc]
      initWithArtifactStore:[[AncPrivateVaultGenesisArtifactStore alloc]
                                initWithStateRootURL:[NSURL
                                                         fileURLWithPath:root]]
             authorityStore:[[AncPrivateVaultAuthorityStore alloc]
                                initWithStateRootURL:[NSURL
                                                         fileURLWithPath:root]
                                   custodyRepository:repository]
          custodyRepository:repository
                 controlLog:[AncPrivateVaultControlLog new]
               trustedClock:clock];
}
static AncPrivateVaultGenesisCoordinator *CoordinatorAt(NSString *root,
                                                        uint64_t at) {
  FixedClock *clock = [FixedClock new];
  clock.value = at;
  clock.available = YES;
  return CoordinatorWithClock(root, clock);
}
static NSString *NewRoot(NSString *label) {
  NSString *root = [NSTemporaryDirectory()
      stringByAppendingPathComponent:[NSString
                                         stringWithFormat:@"%@-%@", label,
                                                          NSUUID.UUID
                                                              .UUIDString]];
  return
      [NSFileManager.defaultManager createDirectoryAtPath:root
                              withIntermediateDirectories:NO
                                               attributes:@{
                                                 NSFilePosixPermissions : @0700
                                               }
                                                    error:nil]
          ? root
          : nil;
}

static AncPrivateVaultGenesisCoordinator *PreparationEnvironment(
    NSString *root, FixedClock *clock,
    AncPrivateVaultGenesisPreparationStore **outStore,
    AncPrivateVaultCustodyRepository **outRepository,
    AncPrivateVaultAuthorityStore **outAuthorityStore) {
  AncPrivateVaultKeychain *keychain = TestKeychain();
  AncPrivateVaultCustodyRepository *repository =
      [[AncPrivateVaultCustodyRepository alloc] initWithKeychain:keychain];
  NSURL *rootURL = [NSURL fileURLWithPath:root];
  AncPrivateVaultGenesisPreparationArtifactStore *preparationArtifacts =
      [[AncPrivateVaultGenesisPreparationArtifactStore alloc]
          initWithStateRootURL:rootURL];
  AncPrivateVaultGenesisPreparationStore *preparationStore =
      [[AncPrivateVaultGenesisPreparationStore alloc]
          initWithKeychain:keychain
                     fence:[[AncPrivateVaultGenerationFence alloc]
                               initWithKeychain:keychain]
             artifactStore:preparationArtifacts];
  AncPrivateVaultAuthorityStore *authorityStore =
      [[AncPrivateVaultAuthorityStore alloc]
          initWithStateRootURL:rootURL
             custodyRepository:repository];
  if (outStore != NULL)
    *outStore = preparationStore;
  if (outRepository != NULL)
    *outRepository = repository;
  if (outAuthorityStore != NULL)
    *outAuthorityStore = authorityStore;
  return [[AncPrivateVaultGenesisCoordinator alloc]
      initWithArtifactStore:[[AncPrivateVaultGenesisArtifactStore alloc]
                                initWithStateRootURL:rootURL]
             authorityStore:authorityStore
          custodyRepository:repository
                 controlLog:[AncPrivateVaultControlLog new]
           preparationStore:preparationStore
      preparationArtifactStore:preparationArtifacts
               trustedClock:clock];
}

static BOOL CopyPreparationHandle(
    AncPrivateVaultGenesisPreparationResult *prepared, uint8_t handle[48]) {
  __block BOOL copied = NO;
  uint8_t *destination = handle;
  return [prepared.preparationHandle
             borrow:^BOOL(uint8_t *bytes, size_t length) {
    if (length != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES)
      return NO;
    memcpy(destination, bytes, length);
    copied = YES;
    return YES;
  }] == AncPrivateVaultGuardedMemoryStatusOK && copied;
}

static AncPrivateVaultGuardedMemory *CopyPreparationRecoveryEntropy(
    AncPrivateVaultGenesisPreparationStore *store, const uint8_t handle[48]) {
  AncPrivateVaultGenesisPreparationSnapshot snapshot;
  AncPrivateVaultGenesisPreparationSecretsHandle *secrets = nil;
  if ([store readHandle:handle
           handleLength:48
              snapshot:&snapshot
           secretHandle:&secrets] !=
          AncPrivateVaultGenesisPreparationStoreStatusOK ||
      secrets == nil) {
    anc_pv_genesis_preparation_snapshot_zero(&snapshot);
    return nil;
  }
  AncPrivateVaultGuardedMemoryStatus memoryStatus;
  AncPrivateVaultGuardedMemory *entropy =
      [AncPrivateVaultGuardedMemory memoryWithLength:32 status:&memoryStatus];
  __block BOOL copied = NO;
  AncPrivateVaultGenesisPreparationStoreStatus borrowed =
      [secrets borrow:^BOOL(
                   const AncPrivateVaultGenesisPreparationSecretInputs *inputs) {
    return [entropy borrow:^BOOL(uint8_t *bytes, size_t length) {
      if (length != 32)
        return NO;
      memcpy(bytes, inputs->recovery_entropy, 32);
      copied = YES;
      return YES;
    }] == AncPrivateVaultGuardedMemoryStatusOK;
  }];
  AncPrivateVaultGenesisPreparationStoreStatus closed = [secrets close];
  anc_pv_genesis_preparation_snapshot_zero(&snapshot);
  if (memoryStatus != AncPrivateVaultGuardedMemoryStatusOK ||
      borrowed != AncPrivateVaultGenesisPreparationStoreStatusOK ||
      closed != AncPrivateVaultGenesisPreparationStoreStatusOK || !copied) {
    (void)[entropy close];
    return nil;
  }
  return entropy;
}

static int PreparationCancellationAndExpiryCases(void) {
  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-prepared-cancel");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    FixedClock *clock = [FixedClock new];
    clock.value = UINT64_C(1721111140000);
    clock.available = YES;
    AncPrivateVaultGenesisPreparationStore *store = nil;
    AncPrivateVaultCustodyRepository *repository = nil;
    AncPrivateVaultAuthorityStore *authorityStore = nil;
    AncPrivateVaultGenesisCoordinator *coordinator = PreparationEnvironment(
        root, clock, &store, &repository, &authorityStore);
    AncPrivateVaultGenesisPreparationResult *prepared = nil;
    CHECK([coordinator prepareWithResult:&prepared] ==
          AncPrivateVaultGenesisCoordinatorStatusOK);
    uint8_t handle[48] = {0};
    CHECK(CopyPreparationHandle(prepared, handle));
    AncPrivateVaultGuardedMemory *entropy =
        CopyPreparationRecoveryEntropy(store, handle);
    CHECK(entropy != nil);
    AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(
        ^BOOL(AncPrivateVaultGenesisPreparationStoreFaultPoint point) {
          return point ==
                 AncPrivateVaultGenesisPreparationStoreFaultAfterArtifactStageBeforePreparationCAS;
        });
    CHECK([coordinator confirmPreparationHandle:prepared.preparationHandle
                       confirmedRecoveryEntropy:entropy
                                        result:nil] ==
          AncPrivateVaultGenesisCoordinatorStatusStorageFailed);
    AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(nil);
    NSString *spoolBase = [[root
        stringByAppendingPathComponent:@"genesis-preparation-artifacts"]
        stringByAppendingPathComponent:
            HexString([NSData dataWithBytes:handle length:16])];
    CHECK([NSFileManager.defaultManager
        fileExistsAtPath:[spoolBase stringByAppendingString:@".stage"]]);
    clock.value += 1000;
    CHECK([coordinator cancelPreparationHandle:prepared.preparationHandle] ==
          AncPrivateVaultGenesisCoordinatorStatusOK);
    AncPrivateVaultGenesisPreparationSnapshot snapshot;
    AncPrivateVaultGenesisPreparationSecretsHandle *secrets = nil;
    CHECK([store readHandle:handle
               handleLength:sizeof handle
                  snapshot:&snapshot
               secretHandle:&secrets] ==
              AncPrivateVaultGenesisPreparationStoreStatusOK &&
          snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED &&
          snapshot.flags ==
              ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED &&
          snapshot.terminal_at_ms == clock.value && secrets == nil);
    CHECK(![NSFileManager.defaultManager
               fileExistsAtPath:[spoolBase stringByAppendingString:@".stage"]] &&
          ![NSFileManager.defaultManager
               fileExistsAtPath:[spoolBase stringByAppendingString:@".live"]]);
    AncPrivateVaultCustodySnapshot custody = {0};
    AncPrivateVaultCustodyHandle *custodyHandle = nil;
    CHECK([repository readVaultId:prepared.vaultId
                         snapshot:&custody
                           handle:&custodyHandle] ==
              AncPrivateVaultCustodyRepositoryStatusNotFound &&
          custodyHandle == nil);
    AncPrivateVaultAuthorityCheckpoint *authority = nil;
    CHECK([authorityStore loadVaultId:prepared.vaultId
                            checkpoint:&authority
                                 error:nil] ==
              AncPrivateVaultAuthorityStoreStatusNotFound &&
          authority == nil);
    CHECK([coordinator cancelPreparationHandle:prepared.preparationHandle] ==
          AncPrivateVaultGenesisCoordinatorStatusOK);
    NSArray<NSData *> *lookupIds = nil;
    CHECK([store listPreparationLookupIds:&lookupIds] ==
              AncPrivateVaultGenesisPreparationStoreStatusOK &&
          lookupIds.count == 0);
    CHECK([entropy close] == AncPrivateVaultGuardedMemoryStatusOK &&
          [prepared.preparationHandle close] ==
              AncPrivateVaultGuardedMemoryStatusOK &&
          [prepared.recoveryMnemonic close] ==
              AncPrivateVaultGuardedMemoryStatusOK);
    anc_pv_genesis_preparation_snapshot_zero(&snapshot);
    anc_pv_zeroize(handle, sizeof handle);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }

  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-prepared-expiry");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    FixedClock *clock = [FixedClock new];
    clock.value = UINT64_C(1721112140000);
    clock.available = YES;
    AncPrivateVaultGenesisPreparationStore *store = nil;
    AncPrivateVaultGenesisCoordinator *coordinator =
        PreparationEnvironment(root, clock, &store, NULL, NULL);
    AncPrivateVaultGenesisPreparationResult *prepared = nil;
    CHECK([coordinator prepareWithResult:&prepared] ==
          AncPrivateVaultGenesisCoordinatorStatusOK);
    uint8_t handle[48] = {0};
    CHECK(CopyPreparationHandle(prepared, handle));
    AncPrivateVaultGuardedMemory *entropy =
        CopyPreparationRecoveryEntropy(store, handle);
    CHECK(entropy != nil);
    AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(
        ^BOOL(AncPrivateVaultGenesisPreparationStoreFaultPoint point) {
          return point ==
                 AncPrivateVaultGenesisPreparationStoreFaultAfterArtifactStageBeforePreparationCAS;
        });
    CHECK([coordinator confirmPreparationHandle:prepared.preparationHandle
                       confirmedRecoveryEntropy:entropy
                                        result:nil] ==
          AncPrivateVaultGenesisCoordinatorStatusStorageFailed);
    AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(nil);
    NSString *spoolBase = [[root
        stringByAppendingPathComponent:@"genesis-preparation-artifacts"]
        stringByAppendingPathComponent:
            HexString([NSData dataWithBytes:handle length:16])];
    CHECK([NSFileManager.defaultManager
        fileExistsAtPath:[spoolBase stringByAppendingString:@".stage"]]);
    clock.value = prepared.expiresAtMs;
    CHECK([coordinator expirePreparationHandle:prepared.preparationHandle] ==
          AncPrivateVaultGenesisCoordinatorStatusConflict);
    clock.value++;
    CHECK([coordinator expirePreparationHandle:prepared.preparationHandle] ==
          AncPrivateVaultGenesisCoordinatorStatusOK);
    AncPrivateVaultGenesisPreparationSnapshot snapshot;
    AncPrivateVaultGenesisPreparationSecretsHandle *secrets = nil;
    CHECK([store readHandle:handle
               handleLength:sizeof handle
                  snapshot:&snapshot
               secretHandle:&secrets] ==
              AncPrivateVaultGenesisPreparationStoreStatusOK &&
          snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED &&
          snapshot.terminal_at_ms == clock.value && secrets == nil);
    CHECK(![NSFileManager.defaultManager
               fileExistsAtPath:[spoolBase stringByAppendingString:@".stage"]] &&
          ![NSFileManager.defaultManager
               fileExistsAtPath:[spoolBase stringByAppendingString:@".live"]]);
    CHECK([coordinator expirePreparationHandle:prepared.preparationHandle] ==
              AncPrivateVaultGenesisCoordinatorStatusOK &&
          [coordinator cancelPreparationHandle:prepared.preparationHandle] ==
              AncPrivateVaultGenesisCoordinatorStatusConflict);
    NSArray<NSData *> *lookupIds = nil;
    CHECK([store listPreparationLookupIds:&lookupIds] ==
              AncPrivateVaultGenesisPreparationStoreStatusOK &&
          lookupIds.count == 0);
    CHECK([entropy close] == AncPrivateVaultGuardedMemoryStatusOK &&
          [prepared.preparationHandle close] ==
              AncPrivateVaultGuardedMemoryStatusOK &&
          [prepared.recoveryMnemonic close] ==
              AncPrivateVaultGuardedMemoryStatusOK);
    anc_pv_genesis_preparation_snapshot_zero(&snapshot);
    anc_pv_zeroize(handle, sizeof handle);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }

  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-committing-cancel");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    FixedClock *clock = [FixedClock new];
    clock.value = UINT64_C(1721113140000);
    clock.available = YES;
    AncPrivateVaultGenesisPreparationStore *store = nil;
    AncPrivateVaultCustodyRepository *repository = nil;
    AncPrivateVaultAuthorityStore *authorityStore = nil;
    AncPrivateVaultGenesisCoordinator *coordinator = PreparationEnvironment(
        root, clock, &store, &repository, &authorityStore);
    AncPrivateVaultGenesisPreparationResult *prepared = nil;
    CHECK([coordinator prepareWithResult:&prepared] ==
          AncPrivateVaultGenesisCoordinatorStatusOK);
    uint8_t handle[48] = {0};
    CHECK(CopyPreparationHandle(prepared, handle));
    AncPrivateVaultGuardedMemory *entropy =
        CopyPreparationRecoveryEntropy(store, handle);
    CHECK(entropy != nil);
    AncPrivateVaultGenesisCoordinatorSetFaultHookForTesting(
        ^BOOL(AncPrivateVaultGenesisCoordinatorFaultPoint point) {
          return point ==
                 AncPrivateVaultGenesisCoordinatorFaultAfterArtifactAuthentication;
        });
    CHECK([coordinator confirmPreparationHandle:prepared.preparationHandle
                       confirmedRecoveryEntropy:entropy
                                        result:nil] ==
          AncPrivateVaultGenesisCoordinatorStatusStorageFailed);
    AncPrivateVaultGenesisCoordinatorSetFaultHookForTesting(nil);
    AncPrivateVaultGenesisPreparationSnapshot snapshot;
    CHECK([store readHandle:handle
               handleLength:sizeof handle
                  snapshot:&snapshot
               secretHandle:nil] ==
              AncPrivateVaultGenesisPreparationStoreStatusOK &&
          snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING &&
          (snapshot.flags &
           ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND) != 0);
    NSData *pendingDigest =
        [NSData dataWithBytes:snapshot.custody_record_digest length:32];
    clock.value += 1000;
    const uint64_t firstCancellationAtMs = clock.value;
    AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(
        ^BOOL(AncPrivateVaultGenesisPreparationStoreFaultPoint point) {
          return point ==
                 AncPrivateVaultGenesisPreparationStoreFaultAfterCancelledCustodyBeforePreparationCAS;
        });
    CHECK([coordinator cancelPreparationHandle:prepared.preparationHandle] ==
          AncPrivateVaultGenesisCoordinatorStatusStorageFailed);
    AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(nil);
    CHECK([store readHandle:handle
               handleLength:sizeof handle
                  snapshot:&snapshot
               secretHandle:nil] ==
              AncPrivateVaultGenesisPreparationStoreStatusOK &&
          snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING);
    clock.value += 5000;
    CHECK([coordinator cancelPreparationHandle:prepared.preparationHandle] ==
          AncPrivateVaultGenesisCoordinatorStatusOK);
    CHECK([store readHandle:handle
               handleLength:sizeof handle
                  snapshot:&snapshot
               secretHandle:nil] ==
              AncPrivateVaultGenesisPreparationStoreStatusOK &&
          snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED &&
          snapshot.terminal_at_ms == firstCancellationAtMs &&
          (snapshot.flags &
           ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED) != 0 &&
          (snapshot.flags &
           ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) == 0 &&
          memcmp(snapshot.custody_record_digest, pendingDigest.bytes, 32) != 0);
    AncPrivateVaultCustodySnapshot custody = {0};
    AncPrivateVaultCustodyHandle *custodyHandle = nil;
    CHECK([repository readVaultId:prepared.vaultId
                         snapshot:&custody
                           handle:&custodyHandle] ==
              AncPrivateVaultCustodyRepositoryStatusOK &&
          custody.lifecycle ==
              ANC_PV_CUSTODY_LIFECYCLE_CANCELLED_GENESIS &&
          custody.custody_generation == 2 && custodyHandle == nil &&
          memcmp(custody.removal_head, pendingDigest.bytes, 32) == 0);
    AncPrivateVaultAuthorityCheckpoint *authority = nil;
    CHECK([authorityStore loadVaultId:prepared.vaultId
                            checkpoint:&authority
                                 error:nil] ==
              AncPrivateVaultAuthorityStoreStatusNotFound &&
          authority == nil);
    NSData *vaultBytes = HexData(prepared.vaultId);
    AncPrivateVaultGenesisArtifacts *leftoverArtifacts = nil;
    AncPrivateVaultGenesisArtifactStore *genesisArtifacts =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    CHECK(vaultBytes.length == 16 &&
          [genesisArtifacts readVaultId:vaultBytes.bytes
                              artifacts:&leftoverArtifacts] ==
              AncPrivateVaultGenesisArtifactStoreStatusNotFound &&
          leftoverArtifacts == nil);
    CHECK([coordinator confirmPreparationHandle:prepared.preparationHandle
                       confirmedRecoveryEntropy:entropy
                                        result:nil] ==
              AncPrivateVaultGenesisCoordinatorStatusConflict &&
          [coordinator cancelPreparationHandle:prepared.preparationHandle] ==
              AncPrivateVaultGenesisCoordinatorStatusOK);
    CHECK([entropy close] == AncPrivateVaultGuardedMemoryStatusOK &&
          [prepared.preparationHandle close] ==
              AncPrivateVaultGuardedMemoryStatusOK &&
          [prepared.recoveryMnemonic close] ==
              AncPrivateVaultGuardedMemoryStatusOK);
    anc_pv_genesis_preparation_snapshot_zero(&snapshot);
    anc_pv_custody_snapshot_zero(&custody);
    anc_pv_zeroize(handle, sizeof handle);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }
  return 0;
}

static int PreparationCases(void) {
  NSString *root = NewRoot(@"genesis-preparation-coordinator");
  CHECK(root != nil);
  gKeychainPath =
      [root stringByAppendingPathComponent:@"preparation-keychain.plist"];
  AncPrivateVaultKeychain *keychain = TestKeychain();
  AncPrivateVaultGenerationFence *fence =
      [[AncPrivateVaultGenerationFence alloc] initWithKeychain:keychain];
  AncPrivateVaultCustodyRepository *repository =
      [[AncPrivateVaultCustodyRepository alloc] initWithKeychain:keychain];
  NSURL *rootURL = [NSURL fileURLWithPath:root];
  AncPrivateVaultGenesisPreparationArtifactStore *preparationArtifacts =
      [[AncPrivateVaultGenesisPreparationArtifactStore alloc]
          initWithStateRootURL:rootURL];
  AncPrivateVaultGenesisPreparationStore *preparationStore =
      [[AncPrivateVaultGenesisPreparationStore alloc]
          initWithKeychain:keychain
                     fence:fence
             artifactStore:preparationArtifacts];
  AncPrivateVaultAuthorityStore *authorityStore =
      [[AncPrivateVaultAuthorityStore alloc]
          initWithStateRootURL:rootURL
             custodyRepository:repository];
  FixedClock *clock = [FixedClock new];
  clock.value = UINT64_C(1721111140000);
  clock.available = YES;
  AncPrivateVaultGenesisCoordinator *coordinator =
      [[AncPrivateVaultGenesisCoordinator alloc]
          initWithArtifactStore:[[AncPrivateVaultGenesisArtifactStore alloc]
                                    initWithStateRootURL:rootURL]
               authorityStore:authorityStore
            custodyRepository:repository
                   controlLog:[AncPrivateVaultControlLog new]
             preparationStore:preparationStore
        preparationArtifactStore:preparationArtifacts
                 trustedClock:clock];
  CHECK(coordinator != nil &&
        [coordinator prepareWithResult:NULL] ==
            AncPrivateVaultGenesisCoordinatorStatusInvalid);
  AncPrivateVaultGenesisPreparationResult *prepared = nil;
  CHECK([coordinator prepareWithResult:&prepared] ==
            AncPrivateVaultGenesisCoordinatorStatusOK &&
        prepared != nil && prepared.vaultId.length == 32 &&
        prepared.expiresAtMs == clock.value + UINT64_C(600000) &&
        prepared.preparationHandle.length == 48 &&
        prepared.recoveryMnemonic.length > 0);
  BOOL immutable = NO;
  @try {
    [prepared setValue:@"substitution" forKey:@"vaultId"];
  } @catch (__unused NSException *exception) {
    immutable = YES;
  }
  CHECK(immutable);

  uint8_t handle[48] = {0};
  uint8_t *handlePointer = handle;
  __block BOOL handleCopied = NO;
  CHECK([prepared.preparationHandle
            borrow:^BOOL(uint8_t *bytes, size_t length) {
    if (length != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES)
      return NO;
    memcpy(handlePointer, bytes, length);
    handleCopied = YES;
    return YES;
  }] == AncPrivateVaultGuardedMemoryStatusOK &&
        handleCopied);
  __block NSData *mnemonicBytes = nil;
  CHECK([prepared.recoveryMnemonic
            borrow:^BOOL(uint8_t *bytes, size_t length) {
    mnemonicBytes = [NSData dataWithBytes:bytes length:length];
    return mnemonicBytes.length == length;
  }] == AncPrivateVaultGuardedMemoryStatusOK &&
        mnemonicBytes.length > 0);
  AncPrivateVaultGenesisPreparationSnapshot snapshot;
  AncPrivateVaultGenesisPreparationSecretsHandle *secretHandle = nil;
  CHECK([preparationStore readHandle:handle
                         handleLength:sizeof handle
                            snapshot:&snapshot
                         secretHandle:&secretHandle] ==
            AncPrivateVaultGenesisPreparationStoreStatusOK &&
        snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED &&
        snapshot.generation == 1 && snapshot.flags == 0 &&
        snapshot.prepared_at_ms == clock.value &&
        snapshot.expires_at_ms == prepared.expiresAtMs &&
        snapshot.confirmed_at_ms == 0 && secretHandle != nil);
  AncPrivateVaultGuardedMemoryStatus memoryStatus;
  AncPrivateVaultGuardedMemory *expectedEntropy =
      [AncPrivateVaultGuardedMemory memoryWithLength:32 status:&memoryStatus];
  __block BOOL entropyCopied = NO;
  CHECK(expectedEntropy != nil &&
        [secretHandle
            borrow:^BOOL(
                const AncPrivateVaultGenesisPreparationSecretInputs *secrets) {
    return [expectedEntropy borrow:^BOOL(uint8_t *destination, size_t length) {
      if (length != 32)
        return NO;
      memcpy(destination, secrets->recovery_entropy, 32);
      entropyCopied = YES;
      return YES;
    }] == AncPrivateVaultGuardedMemoryStatusOK;
  }] == AncPrivateVaultGenesisPreparationStoreStatusOK &&
        entropyCopied &&
        [secretHandle close] ==
            AncPrivateVaultGenesisPreparationStoreStatusOK);
  AncPrivateVaultMnemonicStatus mnemonicStatus;
  CHECK(AncPrivateVaultMnemonicConfirm(mnemonicBytes, expectedEntropy,
                                       &mnemonicStatus) &&
        mnemonicStatus == AncPrivateVaultMnemonicStatusOK);
  AncPrivateVaultCustodySnapshot custody = {0};
  AncPrivateVaultCustodyHandle *custodyHandle = nil;
  CHECK([repository readVaultId:prepared.vaultId
                       snapshot:&custody
                         handle:&custodyHandle] ==
            AncPrivateVaultCustodyRepositoryStatusNotFound &&
        custodyHandle == nil);
  AncPrivateVaultAuthorityCheckpoint *official = nil;
  CHECK([authorityStore loadVaultId:prepared.vaultId
                          checkpoint:&official
                               error:nil] ==
            AncPrivateVaultAuthorityStoreStatusNotFound &&
        official == nil);

  AncPrivateVaultGuardedMemory *wrongEntropy =
      [AncPrivateVaultGuardedMemory memoryWithLength:32 status:&memoryStatus];
  CHECK(wrongEntropy != nil &&
        [wrongEntropy borrow:^BOOL(uint8_t *bytes, size_t length) {
          if (length != 32)
            return NO;
          memset(bytes, 0xa5, length);
          return YES;
        }] == AncPrivateVaultGuardedMemoryStatusOK &&
        [coordinator confirmPreparationHandle:prepared.preparationHandle
                     confirmedRecoveryEntropy:wrongEntropy
                                      result:nil] ==
            AncPrivateVaultGenesisCoordinatorStatusAuthorizationFailed);
  CHECK([repository readVaultId:prepared.vaultId
                       snapshot:&custody
                         handle:&custodyHandle] ==
            AncPrivateVaultCustodyRepositoryStatusNotFound &&
        custodyHandle == nil);
  AncPrivateVaultGenesisCoordinatorResult *officialResult = nil;
  CHECK([coordinator confirmPreparationHandle:prepared.preparationHandle
                     confirmedRecoveryEntropy:expectedEntropy
                                      result:&officialResult] ==
            AncPrivateVaultGenesisCoordinatorStatusOK &&
        officialResult != nil &&
        [officialResult.vaultId isEqualToString:prepared.vaultId] &&
        officialResult.custodyGeneration == 2 &&
        officialResult.activeEpoch == 1 && officialResult.sequence == 0 &&
        officialResult.recoveryGeneration == 1);
  AncPrivateVaultGenesisPreparationSecretsHandle *terminalSecrets = nil;
  CHECK([preparationStore readHandle:handle
                         handleLength:sizeof handle
                            snapshot:&snapshot
                         secretHandle:&terminalSecrets] ==
            AncPrivateVaultGenesisPreparationStoreStatusOK &&
        snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED &&
        snapshot.terminal_at_ms == clock.value && terminalSecrets == nil &&
        (snapshot.flags &
         ANC_PV_GENESIS_PREPARATION_FLAG_OFFICIAL_AUTHORITY_BOUND) != 0);
  CHECK([repository readVaultId:prepared.vaultId
                       snapshot:&custody
                         handle:&custodyHandle] ==
            AncPrivateVaultCustodyRepositoryStatusOK &&
        custody.custody_generation == 2 &&
        custody.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
        custodyHandle != nil &&
        [custodyHandle close] == AncPrivateVaultCustodyRepositoryStatusOK);
  custodyHandle = nil;
  CHECK([authorityStore loadVaultId:prepared.vaultId
                          checkpoint:&official
                               error:nil] ==
            AncPrivateVaultAuthorityStoreStatusOK &&
        official.frameDigest.length == 32 &&
        memcmp(snapshot.official_authority_g2_frame_digest,
               official.frameDigest.bytes, 32) == 0);
  CHECK([coordinator confirmPreparationHandle:prepared.preparationHandle
                     confirmedRecoveryEntropy:expectedEntropy
                                      result:nil] ==
        AncPrivateVaultGenesisCoordinatorStatusOK);
  NSArray<NSData *> *lookupIds = nil;
  CHECK([preparationStore listPreparationLookupIds:&lookupIds] ==
            AncPrivateVaultGenesisPreparationStoreStatusOK &&
        lookupIds.count == 1 &&
        [lookupIds.firstObject
            isEqualToData:[NSData dataWithBytes:handle length:16]]);
  CHECK([prepared.preparationHandle close] ==
            AncPrivateVaultGuardedMemoryStatusOK &&
        [prepared.recoveryMnemonic close] ==
            AncPrivateVaultGuardedMemoryStatusOK &&
        [expectedEntropy close] == AncPrivateVaultGuardedMemoryStatusOK &&
        [wrongEntropy close] == AncPrivateVaultGuardedMemoryStatusOK);
  anc_pv_genesis_preparation_snapshot_zero(&snapshot);
  anc_pv_custody_snapshot_zero(&custody);
  anc_pv_zeroize(handle, sizeof handle);
  CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  return 0;
}

static int ArtifactFaultAndFilesystemCases(NSDictionary *exact) {
  NSData *vault = HexData(exact[@"parsed"][@"vaultIdHex"]),
         *ceremony = HexData(exact[@"parsed"][@"ceremonyIdHex"]),
         *bootstrap = HexData(exact[@"bootstrapTranscriptHex"]),
         *confirmation = HexData(exact[@"recoveryConfirmationHex"]),
         *authorization = HexData(exact[@"authorizationHex"]);
  NSArray *createFsyncPoints = @[
    @(AncPrivateVaultGenesisArtifactFaultStateCreateFsync),
    @(AncPrivateVaultGenesisArtifactFaultGenesisCreateFsync)
  ];
  for (NSNumber *number in createFsyncPoints)
    @autoreleasepool {
      NSString *root = NewRoot(@"genesis-artifact-create-fsync");
      CHECK(root != nil);
      NSInteger wanted = number.integerValue;
      AncPrivateVaultGenesisArtifactSetFaultHookForTesting(
          ^BOOL(AncPrivateVaultGenesisArtifactFaultPoint p) {
            return p == wanted;
          });
      AncPrivateVaultGenesisArtifactStore *failed =
          [[AncPrivateVaultGenesisArtifactStore alloc]
              initWithStateRootURL:[NSURL fileURLWithPath:root]];
      CHECK([failed stageVaultId:vault.bytes
                          ceremonyId:ceremony.bytes
                        verifiedAtMs:1721111140000ULL
                 bootstrapTranscript:bootstrap
                recoveryConfirmation:confirmation
                       authorization:authorization] ==
            AncPrivateVaultGenesisArtifactStoreStatusStorageFailed);
      AncPrivateVaultGenesisArtifactStore *retryFailed =
          [[AncPrivateVaultGenesisArtifactStore alloc]
              initWithStateRootURL:[NSURL fileURLWithPath:root]];
      CHECK([retryFailed stageVaultId:vault.bytes
                           ceremonyId:ceremony.bytes
                         verifiedAtMs:1721111140000ULL
                  bootstrapTranscript:bootstrap
                 recoveryConfirmation:confirmation
                        authorization:authorization] ==
            AncPrivateVaultGenesisArtifactStoreStatusStorageFailed);
      AncPrivateVaultGenesisArtifactSetFaultHookForTesting(nil);
      AncPrivateVaultGenesisArtifactStore *reopened =
          [[AncPrivateVaultGenesisArtifactStore alloc]
              initWithStateRootURL:[NSURL fileURLWithPath:root]];
      CHECK([reopened stageVaultId:vault.bytes
                          ceremonyId:ceremony.bytes
                        verifiedAtMs:1721111140000ULL
                 bootstrapTranscript:bootstrap
                recoveryConfirmation:confirmation
                       authorization:authorization] ==
            AncPrivateVaultGenesisArtifactStoreStatusOK);
      CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
    }
  NSArray *points = @[
    @(AncPrivateVaultGenesisArtifactFaultShortWrite),
    @(AncPrivateVaultGenesisArtifactFaultFileFsync),
    @(AncPrivateVaultGenesisArtifactFaultAfterRename),
    @(AncPrivateVaultGenesisArtifactFaultDirectoryFsync),
    @(AncPrivateVaultGenesisArtifactFaultBeforeReadback)
  ];
  for (NSNumber *number in points)
    @autoreleasepool {
      NSString *root = NewRoot(@"genesis-artifact-fault");
      CHECK(root != nil);
      AncPrivateVaultGenesisArtifactStore *store =
          [[AncPrivateVaultGenesisArtifactStore alloc]
              initWithStateRootURL:[NSURL fileURLWithPath:root]];
      NSInteger wanted = number.integerValue;
      AncPrivateVaultGenesisArtifactSetFaultHookForTesting(
          ^BOOL(AncPrivateVaultGenesisArtifactFaultPoint p) {
            return p == wanted;
          });
      CHECK([store stageVaultId:vault.bytes
                          ceremonyId:ceremony.bytes
                        verifiedAtMs:1721111140000ULL
                 bootstrapTranscript:bootstrap
                recoveryConfirmation:confirmation
                       authorization:authorization] ==
            AncPrivateVaultGenesisArtifactStoreStatusStorageFailed);
      AncPrivateVaultGenesisArtifactSetFaultHookForTesting(nil);
      AncPrivateVaultGenesisArtifacts *artifacts = nil;
      AncPrivateVaultGenesisArtifactStoreStatus read =
          [store readVaultId:vault.bytes artifacts:&artifacts];
      BOOL ambiguous =
          wanted == AncPrivateVaultGenesisArtifactFaultAfterRename ||
          wanted == AncPrivateVaultGenesisArtifactFaultDirectoryFsync ||
          wanted == AncPrivateVaultGenesisArtifactFaultBeforeReadback;
      CHECK(read == (ambiguous
                         ? AncPrivateVaultGenesisArtifactStoreStatusOK
                         : AncPrivateVaultGenesisArtifactStoreStatusNotFound));
      if (ambiguous)
        CHECK([store stageVaultId:vault.bytes
                            ceremonyId:ceremony.bytes
                          verifiedAtMs:1721111140000ULL
                   bootstrapTranscript:bootstrap
                  recoveryConfirmation:confirmation
                         authorization:authorization] ==
              AncPrivateVaultGenesisArtifactStoreStatusOK);
      CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
    }
  NSArray *attacks = @[
    @"permissions", @"hardlink", @"symlink", @"nonregular", @"dirswap",
    @"stateswap", @"rootswap"
  ];
  for (NSString *attack in attacks)
    @autoreleasepool {
      NSString *root = NewRoot(@"genesis-artifact-fs");
      CHECK(root != nil);
      AncPrivateVaultGenesisArtifactStore *store =
          [[AncPrivateVaultGenesisArtifactStore alloc]
              initWithStateRootURL:[NSURL fileURLWithPath:root]];
      CHECK([store stageVaultId:vault.bytes
                          ceremonyId:ceremony.bytes
                        verifiedAtMs:1721111140000ULL
                 bootstrapTranscript:bootstrap
                recoveryConfirmation:confirmation
                       authorization:authorization] ==
            AncPrivateVaultGenesisArtifactStoreStatusOK);
      NSString *dir = [root stringByAppendingPathComponent:@"state/genesis"];
      NSString *live =
          [dir stringByAppendingPathComponent:
                   [HexString(vault) stringByAppendingString:@".genesis"]];
      if ([attack isEqualToString:@"permissions"])
        CHECK(chmod(live.fileSystemRepresentation, 0644) == 0);
      else if ([attack isEqualToString:@"hardlink"])
        CHECK(link(live.fileSystemRepresentation,
                   [[dir stringByAppendingPathComponent:@"alias"]
                       fileSystemRepresentation]) == 0);
      else if ([attack isEqualToString:@"symlink"]) {
        CHECK(unlink(live.fileSystemRepresentation) == 0);
        CHECK(symlink("/dev/null", live.fileSystemRepresentation) == 0);
      } else if ([attack isEqualToString:@"nonregular"]) {
        CHECK(unlink(live.fileSystemRepresentation) == 0);
        CHECK(mkdir(live.fileSystemRepresentation, 0600) == 0);
      } else if ([attack isEqualToString:@"dirswap"]) {
        NSString *old =
            [root stringByAppendingPathComponent:@"state/genesis-old"];
        CHECK(rename(dir.fileSystemRepresentation,
                     old.fileSystemRepresentation) == 0);
        CHECK(mkdir(dir.fileSystemRepresentation, 0700) == 0);
      } else if ([attack isEqualToString:@"stateswap"]) {
        NSString *state = [root stringByAppendingPathComponent:@"state"];
        NSString *old = [root stringByAppendingPathComponent:@"state-old"];
        CHECK(rename(state.fileSystemRepresentation,
                     old.fileSystemRepresentation) == 0);
        CHECK(mkdir(state.fileSystemRepresentation, 0700) == 0);
      } else {
        NSString *old = [root stringByAppendingString:@"-old"];
        CHECK(rename(root.fileSystemRepresentation,
                     old.fileSystemRepresentation) == 0);
        CHECK(mkdir(root.fileSystemRepresentation, 0700) == 0);
      }
      AncPrivateVaultGenesisArtifacts *ignored = nil;
      CHECK([store readVaultId:vault.bytes artifacts:&ignored] !=
            AncPrivateVaultGenesisArtifactStoreStatusOK);
      CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
      if ([attack isEqualToString:@"rootswap"])
        CHECK([NSFileManager.defaultManager
            removeItemAtPath:[root stringByAppendingString:@"-old"]
                       error:nil]);
    }
  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-artifact-discovery");
    CHECK(root != nil);
    AncPrivateVaultGenesisArtifactStore *store =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    CHECK([store stageVaultId:vault.bytes
                        ceremonyId:ceremony.bytes
                      verifiedAtMs:1721111140000ULL
               bootstrapTranscript:bootstrap
              recoveryConfirmation:confirmation
                     authorization:authorization] ==
          AncPrivateVaultGenesisArtifactStoreStatusOK);
    uint8_t other[16];
    memset(other, 0x88, sizeof other);
    CHECK([store stageVaultId:other
                        ceremonyId:ceremony.bytes
                      verifiedAtMs:1721111140000ULL
               bootstrapTranscript:bootstrap
              recoveryConfirmation:confirmation
                     authorization:authorization] ==
          AncPrivateVaultGenesisArtifactStoreStatusOK);
    NSString *dir = [root stringByAppendingPathComponent:@"state/genesis"];
    NSString *tmpName =
        [NSString stringWithFormat:@"%@.%@.tmp", HexString(vault),
                                   NSUUID.UUID.UUIDString.lowercaseString];
    NSString *tmp = [dir stringByAppendingPathComponent:tmpName];
    CHECK([@"stale" writeToFile:tmp
                     atomically:NO
                       encoding:NSUTF8StringEncoding
                          error:nil]);
    CHECK(chmod(tmp.fileSystemRepresentation, 0600) == 0);
    NSArray<NSData *> *listed = nil;
    CHECK([store listVaultIds:&listed] ==
              AncPrivateVaultGenesisArtifactStoreStatusOK &&
          listed.count == 2 &&
          ![NSFileManager.defaultManager fileExistsAtPath:tmp]);
    CHECK([listed containsObject:vault] &&
          [listed containsObject:[NSData dataWithBytes:other length:16]]);
    NSString *unknown = [dir stringByAppendingPathComponent:@"unexpected"];
    CHECK([@"x" writeToFile:unknown
                 atomically:NO
                   encoding:NSUTF8StringEncoding
                      error:nil]);
    CHECK([store listVaultIds:&listed] ==
          AncPrivateVaultGenesisArtifactStoreStatusCorrupt);
    CHECK([NSFileManager.defaultManager removeItemAtPath:unknown error:nil]);
    for (NSUInteger i = 0;
         i < ANC_PV_GENESIS_ARTIFACT_MAX_STALE_TEMPORARIES + 1; i++) {
      NSString *name =
          [NSString stringWithFormat:@"%@.%@.tmp", HexString(vault),
                                     NSUUID.UUID.UUIDString.lowercaseString];
      NSString *path = [dir stringByAppendingPathComponent:name];
      CHECK([@"x" writeToFile:path
                   atomically:NO
                     encoding:NSUTF8StringEncoding
                        error:nil]);
      CHECK(chmod(path.fileSystemRepresentation, 0600) == 0);
    }
    CHECK([store listVaultIds:&listed] ==
          AncPrivateVaultGenesisArtifactStoreStatusCorrupt);
    NSUInteger remainingTemporaries = 0;
    for (NSString *name in
         [NSFileManager.defaultManager contentsOfDirectoryAtPath:dir error:nil])
      if ([name hasSuffix:@".tmp"])
        remainingTemporaries += 1;
    CHECK(remainingTemporaries >= 1);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }
  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-artifact-concurrency");
    CHECK(root != nil);
    dispatch_group_t group = dispatch_group_create();
    dispatch_queue_t queue =
        dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);
    __block int failures = 0;
    for (NSUInteger i = 0; i < 32; i++)
      dispatch_group_async(group, queue, ^{
        AncPrivateVaultGenesisArtifactStore *store =
            [[AncPrivateVaultGenesisArtifactStore alloc]
                initWithStateRootURL:[NSURL fileURLWithPath:root]];
        if ([store stageVaultId:vault.bytes
                          ceremonyId:ceremony.bytes
                        verifiedAtMs:1721111140000ULL
                 bootstrapTranscript:bootstrap
                recoveryConfirmation:confirmation
                       authorization:authorization] !=
            AncPrivateVaultGenesisArtifactStoreStatusOK)
          __sync_fetch_and_add(&failures, 1);
      });
    CHECK(dispatch_group_wait(
              group, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);
    CHECK(failures == 0);
    AncPrivateVaultGenesisArtifactStore *store =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    AncPrivateVaultGenesisArtifactSetFaultHookForTesting(
        ^BOOL(AncPrivateVaultGenesisArtifactFaultPoint p) {
          return p == AncPrivateVaultGenesisArtifactFaultBeforeUnlink;
        });
    CHECK([store deleteVaultId:vault.bytes] ==
          AncPrivateVaultGenesisArtifactStoreStatusStorageFailed);
    AncPrivateVaultGenesisArtifactSetFaultHookForTesting(nil);
    AncPrivateVaultGenesisArtifacts *x = nil;
    CHECK([store readVaultId:vault.bytes artifacts:&x] ==
          AncPrivateVaultGenesisArtifactStoreStatusOK);
    NSMutableData *mutableBootstrap = [bootstrap mutableCopy];
    CHECK([store deleteVaultId:vault.bytes] ==
          AncPrivateVaultGenesisArtifactStoreStatusOK);
    CHECK([store stageVaultId:vault.bytes
                        ceremonyId:ceremony.bytes
                      verifiedAtMs:1721111140000ULL
               bootstrapTranscript:mutableBootstrap
              recoveryConfirmation:confirmation
                     authorization:authorization] ==
          AncPrivateVaultGenesisArtifactStoreStatusOK);
    ((uint8_t *)mutableBootstrap.mutableBytes)[0] ^= 1;
    x = nil;
    CHECK([store readVaultId:vault.bytes artifacts:&x] ==
              AncPrivateVaultGenesisArtifactStoreStatusOK &&
          [x.bootstrapTranscript isEqualToData:bootstrap]);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }
  NSArray *corruptions = @[ @"truncate", @"trailing", @"header", @"checksum" ];
  for (NSString *kind in corruptions)
    @autoreleasepool {
      NSString *root = NewRoot(@"genesis-artifact-corrupt");
      CHECK(root != nil);
      AncPrivateVaultGenesisArtifactStore *store =
          [[AncPrivateVaultGenesisArtifactStore alloc]
              initWithStateRootURL:[NSURL fileURLWithPath:root]];
      CHECK([store stageVaultId:vault.bytes
                          ceremonyId:ceremony.bytes
                        verifiedAtMs:1721111140000ULL
                 bootstrapTranscript:bootstrap
                recoveryConfirmation:confirmation
                       authorization:authorization] ==
            AncPrivateVaultGenesisArtifactStoreStatusOK);
      NSString *live =
          [root stringByAppendingPathComponent:
                    [NSString stringWithFormat:@"state/genesis/%@.genesis",
                                               HexString(vault)]];
      NSMutableData *frame = [[NSData dataWithContentsOfFile:live] mutableCopy];
      if ([kind isEqualToString:@"truncate"])
        [frame setLength:frame.length - 1];
      else if ([kind isEqualToString:@"trailing"])
        [frame appendBytes:"x" length:1];
      else if ([kind isEqualToString:@"header"])
        ((uint8_t *)frame.mutableBytes)[8] ^= 1;
      else
        ((uint8_t *)frame.mutableBytes)[76] ^= 1;
      CHECK([frame writeToFile:live atomically:NO]);
      chmod(live.fileSystemRepresentation, 0600);
      AncPrivateVaultGenesisArtifacts *x = nil;
      CHECK([store readVaultId:vault.bytes artifacts:&x] !=
            AncPrivateVaultGenesisArtifactStoreStatusOK);
      CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
    }
  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-artifact-filename");
    CHECK(root != nil);
    AncPrivateVaultGenesisArtifactStore *store =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    CHECK([store stageVaultId:vault.bytes
                        ceremonyId:ceremony.bytes
                      verifiedAtMs:1721111140000ULL
               bootstrapTranscript:bootstrap
              recoveryConfirmation:confirmation
                     authorization:authorization] ==
          AncPrivateVaultGenesisArtifactStoreStatusOK);
    uint8_t other[16];
    memset(other, 0x88, 16);
    NSString *dir = [root stringByAppendingPathComponent:@"state/genesis"];
    NSString *from =
        [dir stringByAppendingPathComponent:
                 [HexString(vault) stringByAppendingString:@".genesis"]];
    NSString *to = [dir stringByAppendingPathComponent:
                            [HexString([NSData dataWithBytes:other length:16])
                                stringByAppendingString:@".genesis"]];
    CHECK(rename(from.fileSystemRepresentation, to.fileSystemRepresentation) ==
          0);
    AncPrivateVaultGenesisArtifacts *x = nil;
    CHECK([store readVaultId:other artifacts:&x] ==
          AncPrivateVaultGenesisArtifactStoreStatusCorrupt);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }
  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-keychain-fail-before");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    AncPrivateVaultCustodyRepository *repository = Repository();
    CHECK(SeedPending(repository, exact) == 0);
    AncPrivateVaultGenesisArtifactStore *store =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    CHECK([store stageVaultId:vault.bytes
                        ceremonyId:ceremony.bytes
                      verifiedAtMs:1721111140000ULL
               bootstrapTranscript:bootstrap
              recoveryConfirmation:confirmation
                     authorization:authorization] ==
          AncPrivateVaultGenesisArtifactStoreStatusOK);
    gFailNextUpdateBeforeSave = YES;
    AncPrivateVaultGenesisCoordinatorResult *result = nil;
    CHECK([Coordinator(root) resumeVaultId:vault.bytes result:&result] !=
          AncPrivateVaultGenesisCoordinatorStatusOK);
    CHECK([Coordinator(root) resumeVaultId:vault.bytes result:&result] ==
          AncPrivateVaultGenesisCoordinatorStatusOK);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }
  return 0;
}

static int PublicCommitCases(NSDictionary *exact) {
  NSData *vault = HexData(exact[@"parsed"][@"vaultIdHex"]),
         *bootstrap = HexData(exact[@"bootstrapTranscriptHex"]),
         *confirmation = HexData(exact[@"recoveryConfirmationHex"]),
         *authorization = HexData(exact[@"authorizationHex"]);
  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-public-commit");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    CHECK(SeedPending(Repository(), exact) == 0);
    AncPrivateVaultGenesisCoordinatorResult *first = nil, *second = nil;
    AncPrivateVaultGenesisCoordinatorStatus publicStatus =
        [CoordinatorAt(root, 1721111140000ULL) commitVaultId:vault.bytes
                                         bootstrapTranscript:bootstrap
                                        recoveryConfirmation:confirmation
                                               authorization:authorization
                                                      result:&first];
    CHECK(publicStatus == AncPrivateVaultGenesisCoordinatorStatusOK);
    CHECK(first.custodyGeneration == 2 && first.sequence == 0 &&
          first.activeEpoch == 1);
    BOOL immutable = NO;
    @try {
      [first setValue:@3 forKey:@"sequence"];
    } @catch (__unused NSException *e) {
      immutable = YES;
    }
    CHECK(immutable);
    CHECK([CoordinatorAt(root, 1721111150000ULL) commitVaultId:vault.bytes
                                           bootstrapTranscript:bootstrap
                                          recoveryConfirmation:confirmation
                                                 authorization:authorization
                                                        result:&second] ==
          AncPrivateVaultGenesisCoordinatorStatusOK);
    CHECK([first.authorityCheckpoint.frameDigest
              isEqualToData:second.authorityCheckpoint.frameDigest] &&
          [first.headHash isEqualToData:second.headHash]);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }
  for (NSInteger mutation = 1; mutation <= 5; mutation++)
    @autoreleasepool {
      NSString *root = NewRoot(@"genesis-pending-substitution");
      CHECK(root != nil);
      gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
      CHECK(SeedPendingVariant(Repository(), exact, mutation) == 0);
      AncPrivateVaultGenesisCoordinatorResult *r = nil;
      CHECK([CoordinatorAt(root, 1721111140000ULL) commitVaultId:vault.bytes
                                             bootstrapTranscript:bootstrap
                                            recoveryConfirmation:confirmation
                                                   authorization:authorization
                                                          result:&r] !=
            AncPrivateVaultGenesisCoordinatorStatusOK);
      AncPrivateVaultGenesisArtifacts *x = nil;
      AncPrivateVaultGenesisArtifactStore *s =
          [[AncPrivateVaultGenesisArtifactStore alloc]
              initWithStateRootURL:[NSURL fileURLWithPath:root]];
      CHECK([s readVaultId:vault.bytes artifacts:&x] ==
            AncPrivateVaultGenesisArtifactStoreStatusNotFound);
      CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
    }
  for (uint64_t clockValueIndex = 0; clockValueIndex < 2; clockValueIndex++)
    @autoreleasepool {
      uint64_t at = clockValueIndex == 0 ? 0 : UINT64_C(9007199254740992);
      NSString *root = NewRoot(@"genesis-clock-invalid");
      CHECK(root != nil);
      gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
      CHECK(SeedPending(Repository(), exact) == 0);
      CHECK([CoordinatorAt(root, at) commitVaultId:vault.bytes
                               bootstrapTranscript:bootstrap
                              recoveryConfirmation:confirmation
                                     authorization:authorization
                                            result:nil] ==
            AncPrivateVaultGenesisCoordinatorStatusInvalid);
      CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
    }
  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-clock-unavailable");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    CHECK(SeedPending(Repository(), exact) == 0);
    FixedClock *clock = [FixedClock new];
    clock.value = 1721111140000ULL;
    clock.available = NO;
    CHECK([CoordinatorWithClock(root, clock) commitVaultId:vault.bytes
                                       bootstrapTranscript:bootstrap
                                      recoveryConfirmation:confirmation
                                             authorization:authorization
                                                    result:nil] ==
          AncPrivateVaultGenesisCoordinatorStatusInvalid);
    NSArray<NSData *> *pending = nil;
    AncPrivateVaultGenesisArtifactStore *store =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    CHECK([store listVaultIds:&pending] ==
              AncPrivateVaultGenesisArtifactStoreStatusOK &&
          pending.count == 0);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }
  return 0;
}
static void ResetCustodyMutation(void) {
  gCustodyMutationMode = CustodyMutationModeDisabled;
  gCustodyMutationTarget = 0;
  gCustodyMutationCount = 0;
  gCustodyMutationHit = NO;
}
static int VerifyExactPromotedCustody(NSDictionary *exact) {
  NSString *vaultId = exact[@"parsed"][@"vaultIdHex"];
  AncPrivateVaultCustodySnapshot snapshot;
  AncPrivateVaultCustodyHandle *handle = nil;
  AncPrivateVaultCustodyRepository *repository = Repository();
  CHECK([repository readVaultId:vaultId snapshot:&snapshot handle:&handle] ==
        AncPrivateVaultCustodyRepositoryStatusOK);
  CHECK(snapshot.custody_generation == 2 && snapshot.active_epoch == 1 &&
        snapshot.pending_epoch == 0 &&
        snapshot.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
        snapshot.authority_anchor_present);
  __block BOOL exactSecrets = NO;
  CHECK(
      [handle borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
        uint8_t expectedActive[32];
        uint8_t zero[32] = {0};
        memset(expectedActive, 0xa2, sizeof expectedActive);
        exactSecrets =
            sodium_memcmp(secrets->active_epoch_key, expectedActive, 32) == 0 &&
            sodium_memcmp(secrets->pending_epoch_key, zero, 32) == 0;
        sodium_memzero(expectedActive, sizeof expectedActive);
        return exactSecrets;
      }] == AncPrivateVaultCustodyRepositoryStatusOK);
  CHECK(exactSecrets);
  CHECK([handle close] == AncPrivateVaultCustodyRepositoryStatusOK);
  return 0;
}
static int CustodyTransitionMutationCases(NSDictionary *exact) {
  NSData *vault = HexData(exact[@"parsed"][@"vaultIdHex"]),
         *bootstrap = HexData(exact[@"bootstrapTranscriptHex"]),
         *confirmation = HexData(exact[@"recoveryConfirmationHex"]),
         *authorization = HexData(exact[@"authorizationHex"]);
  NSUInteger mutationCount = 0;
  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-custody-mutation-count");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    CHECK(SeedPending(Repository(), exact) == 0);
    ResetCustodyMutation();
    gCustodyMutationMode = CustodyMutationModeCountOnly;
    AncPrivateVaultGenesisCoordinatorResult *result = nil;
    CHECK([CoordinatorAt(root, 1721111140000ULL) commitVaultId:vault.bytes
                                           bootstrapTranscript:bootstrap
                                          recoveryConfirmation:confirmation
                                                 authorization:authorization
                                                        result:&result] ==
          AncPrivateVaultGenesisCoordinatorStatusOK);
    mutationCount = gCustodyMutationCount;
    ResetCustodyMutation();
    CHECK(mutationCount > 0 && VerifyExactPromotedCustody(exact) == 0);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }

  NSArray<NSNumber *> *modes = @[
    @(CustodyMutationModeFailBefore), @(CustodyMutationModeCommitThenError)
  ];
  for (NSNumber *modeValue in modes)
    for (NSUInteger target = 1; target <= mutationCount; target++)
      @autoreleasepool {
        NSString *root = NewRoot(@"genesis-custody-mutation");
        CHECK(root != nil);
        gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
        CHECK(SeedPending(Repository(), exact) == 0);
        ResetCustodyMutation();
        gCustodyMutationMode = (CustodyMutationMode)modeValue.integerValue;
        gCustodyMutationTarget = target;
        AncPrivateVaultGenesisCoordinatorResult *commitResult = nil;
        (void)[CoordinatorAt(root, 1721111140000ULL)
                   commitVaultId:vault.bytes
             bootstrapTranscript:bootstrap
            recoveryConfirmation:confirmation
                   authorization:authorization
                          result:&commitResult];
        CHECK(gCustodyMutationHit);
        ResetCustodyMutation();

        AncPrivateVaultGenesisCoordinatorResult *resumeResult = nil;
        CHECK([CoordinatorAt(root, 1721111140000ULL)
                  resumeVaultId:vault.bytes
                         result:&resumeResult] ==
              AncPrivateVaultGenesisCoordinatorStatusOK);
        CHECK(resumeResult != nil && resumeResult.custodyGeneration == 2 &&
              VerifyExactPromotedCustody(exact) == 0);

        AncPrivateVaultGenesisCoordinatorResult *again = nil;
        CHECK([CoordinatorAt(root, 1721111140000ULL) resumeVaultId:vault.bytes
                                                            result:&again] ==
              AncPrivateVaultGenesisCoordinatorStatusOK);
        CHECK(again != nil && again.custodyGeneration == 2 &&
              VerifyExactPromotedCustody(exact) == 0);
        CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
      }
  ResetCustodyMutation();
  return 0;
}
static int SameVaultCommitConcurrencyCases(NSDictionary *exact) {
  NSData *vault = HexData(exact[@"parsed"][@"vaultIdHex"]),
         *bootstrap = HexData(exact[@"bootstrapTranscriptHex"]),
         *confirmation = HexData(exact[@"recoveryConfirmationHex"]),
         *authorization = HexData(exact[@"authorizationHex"]);
  NSString *root = NewRoot(@"genesis-same-vault-concurrency");
  CHECK(root != nil);
  gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
  CHECK(SeedPending(Repository(), exact) == 0);
  dispatch_group_t group = dispatch_group_create();
  dispatch_queue_t queue =
      dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);
  __block int failures = 0;
  for (NSUInteger index = 0; index < 32; index++)
    dispatch_group_async(group, queue, ^{
      AncPrivateVaultGenesisCoordinatorResult *result = nil;
      AncPrivateVaultGenesisCoordinatorStatus status =
          [CoordinatorAt(root, 1721111140000ULL) commitVaultId:vault.bytes
                                           bootstrapTranscript:bootstrap
                                          recoveryConfirmation:confirmation
                                                 authorization:authorization
                                                        result:&result];
      if (status != AncPrivateVaultGenesisCoordinatorStatusOK ||
          result == nil || result.custodyGeneration != 2 ||
          result.activeEpoch != 1 || result.sequence != 0)
        __sync_fetch_and_add(&failures, 1);
    });
  CHECK(dispatch_group_wait(
            group, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC)) == 0);
  CHECK(failures == 0);

  AncPrivateVaultGenesisCoordinatorResult *resumed = nil;
  CHECK([CoordinatorAt(root, 1721111140000ULL) resumeVaultId:vault.bytes
                                                      result:&resumed] ==
        AncPrivateVaultGenesisCoordinatorStatusOK);
  CHECK(resumed != nil && resumed.custodyGeneration == 2 &&
        resumed.activeEpoch == 1 && resumed.sequence == 0 &&
        VerifyExactPromotedCustody(exact) == 0);
  AncPrivateVaultGenesisArtifactStore *store =
      [[AncPrivateVaultGenesisArtifactStore alloc]
          initWithStateRootURL:[NSURL fileURLWithPath:root]];
  NSArray<NSData *> *remaining = nil;
  CHECK([store listVaultIds:&remaining] ==
            AncPrivateVaultGenesisArtifactStoreStatusOK &&
        remaining.count == 0);
  CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  return 0;
}

static int CoordinatorCrashCases(NSDictionary *exact) {
  NSData *vault = HexData(exact[@"parsed"][@"vaultIdHex"]),
         *ceremony = HexData(exact[@"parsed"][@"ceremonyIdHex"]),
         *bootstrap = HexData(exact[@"bootstrapTranscriptHex"]),
         *confirmation = HexData(exact[@"recoveryConfirmationHex"]),
         *authorization = HexData(exact[@"authorizationHex"]);
  NSArray *points = @[
    @(AncPrivateVaultAuthorityFaultAfterStageVerification),
    @(AncPrivateVaultAuthorityFaultAfterCustodyAdvance),
    @(AncPrivateVaultAuthorityFaultAfterLivePromote),
    @(AncPrivateVaultAuthorityFaultBeforeFinalReread)
  ];
  for (NSNumber *number in points)
    @autoreleasepool {
      NSString *root = NewRoot(@"genesis-coordinator-crash");
      CHECK(root != nil);
      gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
      AncPrivateVaultCustodyRepository *repository = Repository();
      CHECK(SeedPending(repository, exact) == 0);
      AncPrivateVaultGenesisArtifactStore *store =
          [[AncPrivateVaultGenesisArtifactStore alloc]
              initWithStateRootURL:[NSURL fileURLWithPath:root]];
      CHECK([store stageVaultId:vault.bytes
                          ceremonyId:ceremony.bytes
                        verifiedAtMs:1721111140000ULL
                 bootstrapTranscript:bootstrap
                recoveryConfirmation:confirmation
                       authorization:authorization] ==
            AncPrivateVaultGenesisArtifactStoreStatusOK);
      NSInteger wanted = number.integerValue;
      AncPrivateVaultAuthoritySetFaultHookForTesting(
          ^BOOL(AncPrivateVaultAuthorityFaultPoint p) {
            return p == wanted;
          });
      AncPrivateVaultGenesisCoordinatorResult *result = nil;
      CHECK([Coordinator(root) resumeVaultId:vault.bytes result:&result] !=
            AncPrivateVaultGenesisCoordinatorStatusOK);
      AncPrivateVaultAuthoritySetFaultHookForTesting(nil);
      CHECK([Coordinator(root) resumeVaultId:vault.bytes result:&result] ==
            AncPrivateVaultGenesisCoordinatorStatusOK);
      CHECK(result.custodyGeneration == 2);
      CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
    }
  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-keychain-ambiguous");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    AncPrivateVaultCustodyRepository *repository = Repository();
    CHECK(SeedPending(repository, exact) == 0);
    AncPrivateVaultGenesisArtifactStore *store =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    CHECK([store stageVaultId:vault.bytes
                        ceremonyId:ceremony.bytes
                      verifiedAtMs:1721111140000ULL
               bootstrapTranscript:bootstrap
              recoveryConfirmation:confirmation
                     authorization:authorization] ==
          AncPrivateVaultGenesisArtifactStoreStatusOK);
    gAmbiguousNextUpdate = YES;
    AncPrivateVaultGenesisCoordinatorResult *result = nil;
    /* The repository reconciles a write that persisted but reported failure;
     * returning OK here is proof of exact read-after-ambiguity, not optimism.
     */
    CHECK([Coordinator(root) resumeVaultId:vault.bytes result:&result] ==
          AncPrivateVaultGenesisCoordinatorStatusOK);
    CHECK([Coordinator(root) resumeVaultId:vault.bytes result:&result] ==
          AncPrivateVaultGenesisCoordinatorStatusOK);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }
  return 0;
}
static int StartupSweepCases(NSDictionary *exact) {
  NSData *vault = HexData(exact[@"parsed"][@"vaultIdHex"]),
         *ceremony = HexData(exact[@"parsed"][@"ceremonyIdHex"]),
         *bootstrap = HexData(exact[@"bootstrapTranscriptHex"]),
         *confirmation = HexData(exact[@"recoveryConfirmationHex"]),
         *authorization = HexData(exact[@"authorizationHex"]);
  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-startup-empty");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    AncPrivateVaultGenesisArtifactStore *store =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    CHECK(AncPrivateVaultResumePendingGenesisArtifacts(store,
                                                       Coordinator(root)) ==
          AncPrivateVaultGenesisStartupStatusOK);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }
  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-startup-resume");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    CHECK(SeedPending(Repository(), exact) == 0);
    AncPrivateVaultGenesisArtifactStore *store =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    CHECK([store stageVaultId:vault.bytes
                        ceremonyId:ceremony.bytes
                      verifiedAtMs:1721111140000ULL
               bootstrapTranscript:bootstrap
              recoveryConfirmation:confirmation
                     authorization:authorization] ==
          AncPrivateVaultGenesisArtifactStoreStatusOK);
    CHECK(AncPrivateVaultResumePendingGenesisArtifacts(store,
                                                       Coordinator(root)) ==
          AncPrivateVaultGenesisStartupStatusOK);
    NSArray<NSData *> *remaining = nil;
    CHECK([store listVaultIds:&remaining] ==
              AncPrivateVaultGenesisArtifactStoreStatusOK &&
          remaining.count == 0);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }
  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-startup-resume-failure");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    AncPrivateVaultGenesisArtifactStore *store =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    CHECK([store stageVaultId:vault.bytes
                        ceremonyId:ceremony.bytes
                      verifiedAtMs:1721111140000ULL
               bootstrapTranscript:bootstrap
              recoveryConfirmation:confirmation
                     authorization:authorization] ==
          AncPrivateVaultGenesisArtifactStoreStatusOK);
    CHECK(AncPrivateVaultResumePendingGenesisArtifacts(store,
                                                       Coordinator(root)) ==
          AncPrivateVaultGenesisStartupStatusResumeFailed);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }
  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-startup-discovery-failure");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    AncPrivateVaultGenesisArtifactStore *store =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    NSString *unexpected =
        [root stringByAppendingPathComponent:@"state/genesis/unexpected"];
    CHECK([@"x" writeToFile:unexpected
                 atomically:NO
                   encoding:NSUTF8StringEncoding
                      error:nil]);
    CHECK(AncPrivateVaultResumePendingGenesisArtifacts(store,
                                                       Coordinator(root)) ==
          AncPrivateVaultGenesisStartupStatusDiscoveryFailed);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }
  return 0;
}

static int PreparationStartupSweepCases(void) {
  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-preparation-startup-empty-clock");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    FixedClock *clock = [FixedClock new];
    clock.value = UINT64_C(1721111140000);
    clock.available = NO;
    AncPrivateVaultGenesisPreparationStore *preparationStore = nil;
    AncPrivateVaultGenesisCoordinator *coordinator = PreparationEnvironment(
        root, clock, &preparationStore, NULL, NULL);
    AncPrivateVaultGenesisArtifactStore *artifacts =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    CHECK(AncPrivateVaultResumePendingGenesisState(
              artifacts, preparationStore, coordinator) ==
          AncPrivateVaultGenesisStartupStatusResumeFailed);
    clock.available = YES;
    CHECK(AncPrivateVaultResumePendingGenesisState(
              artifacts, preparationStore, coordinator) ==
          AncPrivateVaultGenesisStartupStatusOK);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }

  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-preparation-startup-marker-only");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    FixedClock *clock = [FixedClock new];
    clock.value = UINT64_C(1721611140000);
    clock.available = YES;
    AncPrivateVaultGenesisPreparationStore *preparationStore = nil;
    AncPrivateVaultGenesisCoordinator *coordinator = PreparationEnvironment(
        root, clock, &preparationStore, NULL, NULL);
    AncPrivateVaultGenesisPreparationArtifactStore *preparationArtifacts =
        [[AncPrivateVaultGenesisPreparationArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    uint8_t orphanLookup[16] = {0};
    randombytes_buf(orphanLookup, sizeof orphanLookup);
    CHECK([preparationArtifacts
              createPreparationIndexLookupId:orphanLookup
                                 preparedAtMs:clock.value
                                  expiresAtMs:clock.value + 1000] ==
          AncPrivateVaultGenesisPreparationArtifactStatusOK);
    AncPrivateVaultGenesisArtifactStore *artifacts =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    CHECK(AncPrivateVaultResumePendingGenesisState(
              artifacts, preparationStore, coordinator) ==
          AncPrivateVaultGenesisStartupStatusOK);
    NSArray<NSData *> *remaining = nil;
    CHECK([preparationStore listPreparationLookupIds:&remaining] ==
              AncPrivateVaultGenesisPreparationStoreStatusOK &&
          remaining.count == 0);
    anc_pv_zeroize(orphanLookup, sizeof orphanLookup);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }

  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-preparation-startup-expiry");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    FixedClock *clock = [FixedClock new];
    clock.value = UINT64_C(1722111140000);
    clock.available = YES;
    AncPrivateVaultGenesisPreparationStore *preparationStore = nil;
    AncPrivateVaultGenesisCoordinator *coordinator = PreparationEnvironment(
        root, clock, &preparationStore, NULL, NULL);
    AncPrivateVaultGenesisPreparationResult *prepared = nil;
    CHECK([coordinator prepareWithResult:&prepared] ==
          AncPrivateVaultGenesisCoordinatorStatusOK);
    uint8_t handle[48] = {0};
    CHECK(CopyPreparationHandle(prepared, handle));
    AncPrivateVaultGenesisArtifactStore *artifacts =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    CHECK(AncPrivateVaultResumePendingGenesisState(
              artifacts, preparationStore, coordinator) ==
          AncPrivateVaultGenesisStartupStatusOK);
    AncPrivateVaultGenesisPreparationSnapshot snapshot;
    CHECK([preparationStore readHandle:handle
                          handleLength:sizeof handle
                             snapshot:&snapshot
                          secretHandle:nil] ==
              AncPrivateVaultGenesisPreparationStoreStatusOK &&
          snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED);
    clock.value = prepared.expiresAtMs + 1;
    CHECK(AncPrivateVaultResumePendingGenesisState(
              artifacts, preparationStore, coordinator) ==
          AncPrivateVaultGenesisStartupStatusOK);
    CHECK([preparationStore readHandle:handle
                          handleLength:sizeof handle
                             snapshot:&snapshot
                          secretHandle:nil] ==
              AncPrivateVaultGenesisPreparationStoreStatusOK &&
          snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED);
    NSArray<NSData *> *remaining = nil;
    CHECK([preparationStore listPreparationLookupIds:&remaining] ==
              AncPrivateVaultGenesisPreparationStoreStatusOK &&
          remaining.count == 0);
    CHECK([prepared.preparationHandle close] ==
              AncPrivateVaultGuardedMemoryStatusOK &&
          [prepared.recoveryMnemonic close] ==
              AncPrivateVaultGuardedMemoryStatusOK);
    anc_pv_genesis_preparation_snapshot_zero(&snapshot);
    anc_pv_zeroize(handle, sizeof handle);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }

  @autoreleasepool {
    NSString *root = NewRoot(@"genesis-preparation-startup-cancel-cleanup");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    FixedClock *clock = [FixedClock new];
    clock.value = UINT64_C(1722611140000);
    clock.available = YES;
    AncPrivateVaultGenesisPreparationStore *preparationStore = nil;
    AncPrivateVaultGenesisCoordinator *coordinator = PreparationEnvironment(
        root, clock, &preparationStore, NULL, NULL);
    AncPrivateVaultGenesisPreparationResult *prepared = nil;
    CHECK([coordinator prepareWithResult:&prepared] ==
          AncPrivateVaultGenesisCoordinatorStatusOK);
    uint8_t handle[48] = {0};
    CHECK(CopyPreparationHandle(prepared, handle));
    AncPrivateVaultGuardedMemory *entropy =
        CopyPreparationRecoveryEntropy(preparationStore, handle);
    CHECK(entropy != nil);
    AncPrivateVaultGenesisCoordinatorSetFaultHookForTesting(
        ^BOOL(AncPrivateVaultGenesisCoordinatorFaultPoint point) {
          return point ==
                 AncPrivateVaultGenesisCoordinatorFaultAfterArtifactAuthentication;
        });
    CHECK([coordinator confirmPreparationHandle:prepared.preparationHandle
                       confirmedRecoveryEntropy:entropy
                                        result:nil] ==
          AncPrivateVaultGenesisCoordinatorStatusStorageFailed);
    AncPrivateVaultGenesisCoordinatorSetFaultHookForTesting(nil);
    AncPrivateVaultGenesisPreparationArtifactSetFaultHookForTesting(
        ^BOOL(AncPrivateVaultGenesisPreparationArtifactFaultPoint point) {
          return point ==
                 AncPrivateVaultGenesisPreparationArtifactFaultBeforeUnlink;
        });
    CHECK([coordinator cancelPreparationHandle:prepared.preparationHandle] ==
          AncPrivateVaultGenesisCoordinatorStatusStorageFailed);
    AncPrivateVaultGenesisPreparationArtifactSetFaultHookForTesting(nil);
    AncPrivateVaultGenesisPreparationSnapshot cancelled;
    CHECK([preparationStore readHandle:handle
                          handleLength:sizeof handle
                             snapshot:&cancelled
                          secretHandle:nil] ==
              AncPrivateVaultGenesisPreparationStoreStatusOK &&
          cancelled.phase == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED &&
          (cancelled.flags &
           ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) != 0 &&
          (cancelled.flags &
           ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED) == 0);
    AncPrivateVaultGenesisArtifactStore *artifacts =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    CHECK(AncPrivateVaultResumePendingGenesisState(
              artifacts, preparationStore, coordinator) ==
          AncPrivateVaultGenesisStartupStatusOK);
    NSArray<NSData *> *remaining = nil;
    CHECK([preparationStore listPreparationLookupIds:&remaining] ==
              AncPrivateVaultGenesisPreparationStoreStatusOK &&
          remaining.count == 0);
    CHECK([artifacts listVaultIds:&remaining] ==
              AncPrivateVaultGenesisArtifactStoreStatusOK &&
          remaining.count == 0);
    CHECK([entropy close] == AncPrivateVaultGuardedMemoryStatusOK &&
          [prepared.preparationHandle close] ==
              AncPrivateVaultGuardedMemoryStatusOK &&
          [prepared.recoveryMnemonic close] ==
              AncPrivateVaultGuardedMemoryStatusOK);
    anc_pv_genesis_preparation_snapshot_zero(&cancelled);
    anc_pv_zeroize(handle, sizeof handle);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }

  for (NSUInteger variant = 0; variant < 5; variant += 1) {
    @autoreleasepool {
      NSArray<NSString *> *labels = @[
        @"genesis-preparation-concurrent-receipt-cleanup",
        @"genesis-preparation-startup-receipt-persist",
        @"genesis-preparation-startup-receipt-bind",
        @"genesis-preparation-startup-artifact-cleanup",
        @"genesis-preparation-startup-cleaned-marker",
      ];
      NSString *root = NewRoot(labels[variant]);
      CHECK(root != nil);
      gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
      FixedClock *clock = [FixedClock new];
      clock.value = UINT64_C(1723111140000) + variant * 1000000;
      clock.available = YES;
      AncPrivateVaultGenesisPreparationStore *preparationStore = nil;
      AncPrivateVaultGenesisCoordinator *coordinator = PreparationEnvironment(
          root, clock, &preparationStore, NULL, NULL);
      AncPrivateVaultGenesisPreparationResult *prepared = nil;
      CHECK([coordinator prepareWithResult:&prepared] ==
            AncPrivateVaultGenesisCoordinatorStatusOK);
      uint8_t handle[48] = {0};
      CHECK(CopyPreparationHandle(prepared, handle));
      AncPrivateVaultGuardedMemory *entropy =
          CopyPreparationRecoveryEntropy(preparationStore, handle);
      CHECK(entropy != nil);
      if (variant == 0) {
        AncPrivateVaultGenesisPreparationStoreFaultPoint target =
            AncPrivateVaultGenesisPreparationStoreFaultAfterStageWrite;
        AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(
            ^BOOL(AncPrivateVaultGenesisPreparationStoreFaultPoint point) {
              return point == target;
            });
      } else {
        AncPrivateVaultGenesisCoordinatorSetFaultHookForTesting(
            ^BOOL(AncPrivateVaultGenesisCoordinatorFaultPoint point) {
              return point ==
                     AncPrivateVaultGenesisCoordinatorFaultAfterArtifactAuthentication;
            });
      }
      CHECK([coordinator confirmPreparationHandle:prepared.preparationHandle
                         confirmedRecoveryEntropy:entropy
                                          result:nil] ==
            AncPrivateVaultGenesisCoordinatorStatusStorageFailed);
      AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(nil);
      AncPrivateVaultGenesisCoordinatorSetFaultHookForTesting(nil);
      AncPrivateVaultGenesisPreparationSnapshot interrupted;
      CHECK([preparationStore readHandle:handle
                            handleLength:sizeof handle
                               snapshot:&interrupted
                            secretHandle:nil] ==
                AncPrivateVaultGenesisPreparationStoreStatusOK &&
            (interrupted.phase ==
                 ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED ||
             interrupted.phase ==
                 ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING));
      AncPrivateVaultGenesisArtifactStore *artifacts =
          [[AncPrivateVaultGenesisArtifactStore alloc]
              initWithStateRootURL:[NSURL fileURLWithPath:root]];
      CHECK(AncPrivateVaultResumePendingGenesisState(
                artifacts, preparationStore, coordinator) ==
            AncPrivateVaultGenesisStartupStatusResumeFailed);
      AncPrivateVaultGenesisPreparationSnapshot completed;
      AncPrivateVaultGenesisPreparationSecretsHandle *terminalSecrets = nil;
      CHECK([preparationStore readHandle:handle
                            handleLength:sizeof handle
                               snapshot:&completed
                            secretHandle:&terminalSecrets] ==
                AncPrivateVaultGenesisPreparationStoreStatusOK &&
            completed.phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED &&
            terminalSecrets == nil);
      NSData *lookup = [NSData dataWithBytes:completed.preparation_lookup_id
                                      length:16];
      NSData *receipt = GenesisHostedReceipt(&completed);
      CHECK(receipt != nil);
      NSMutableData *wrongReceipt = [receipt mutableCopy];
      ((uint8_t *)wrongReceipt.mutableBytes)[wrongReceipt.length - 1] ^= 1;
      CHECK([coordinator finalizeHostedGenesisAppendLookupId:lookup
                                                     receipt:wrongReceipt] !=
            AncPrivateVaultGenesisCoordinatorStatusOK);
      NSArray<NSNumber *> *cleanupFaults = @[
        @(AncPrivateVaultGenesisPreparationStoreFaultAfterCleanupReceiptPersist),
        @(AncPrivateVaultGenesisPreparationStoreFaultAfterHostedReceiptBind),
        @(AncPrivateVaultGenesisPreparationStoreFaultAfterHostedArtifactCleanup),
        @(AncPrivateVaultGenesisPreparationStoreFaultAfterHostedCleanedCAS),
      ];
      if (variant == 0) {
        __block BOOL concurrentExact = YES;
        NSObject *resultLock = [NSObject new];
        dispatch_apply(16,
                       dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0),
                       ^(size_t index) {
          (void)index;
          BOOL exact =
              [coordinator finalizeHostedGenesisAppendLookupId:lookup
                                                       receipt:receipt] ==
              AncPrivateVaultGenesisCoordinatorStatusOK;
          if (!exact)
            @synchronized(resultLock) {
              concurrentExact = NO;
            }
        });
        CHECK(concurrentExact);
      } else {
        AncPrivateVaultGenesisPreparationStoreFaultPoint cleanupTarget =
            cleanupFaults[variant - 1].integerValue;
        AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(
            ^BOOL(AncPrivateVaultGenesisPreparationStoreFaultPoint point) {
              return point == cleanupTarget;
            });
        CHECK([coordinator finalizeHostedGenesisAppendLookupId:lookup
                                                       receipt:receipt] ==
              AncPrivateVaultGenesisCoordinatorStatusStorageFailed);
        AncPrivateVaultGenesisPreparationSetStoreFaultHookForTesting(nil);
      }
      if (variant == 4) {
        NSString *vaultHex = HexString(
            [NSData dataWithBytes:completed.vault_id length:16]);
        CHECK([TestKeychain()
                  deleteDataForService:
                      AncPrivateVaultGenesisCleanupReceiptService
                               vaultId:vaultHex
                              recordId:@"genesis-cleanup-receipt"] ==
              AncPrivateVaultKeychainStatusOK);
        CHECK(AncPrivateVaultResumePendingGenesisState(
                  artifacts, preparationStore, coordinator) ==
              AncPrivateVaultGenesisStartupStatusResumeFailed);
        NSArray<NSData *> *blockedMarkers = nil;
        CHECK([preparationStore
                  listPreparationLookupIds:&blockedMarkers] ==
                  AncPrivateVaultGenesisPreparationStoreStatusOK &&
              blockedMarkers.count == 1);
        CHECK([TestKeychain()
                  addData:receipt
                  forService:AncPrivateVaultGenesisCleanupReceiptService
                     vaultId:vaultHex
                    recordId:@"genesis-cleanup-receipt"] ==
              AncPrivateVaultKeychainStatusOK);
      }
      CHECK(AncPrivateVaultResumePendingGenesisState(
                artifacts, preparationStore, coordinator) ==
            AncPrivateVaultGenesisStartupStatusOK);
      CHECK([coordinator finalizeHostedGenesisAppendLookupId:lookup
                                                     receipt:receipt] ==
            AncPrivateVaultGenesisCoordinatorStatusOK);
      anc_pv_genesis_preparation_snapshot_zero(&completed);
      CHECK([preparationStore readHandle:handle
                            handleLength:sizeof handle
                               snapshot:&completed
                            secretHandle:&terminalSecrets] ==
                AncPrivateVaultGenesisPreparationStoreStatusOK &&
            completed.phase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED &&
            (completed.flags &
             ANC_PV_GENESIS_PREPARATION_FLAG_HOSTED_RECEIPT_BOUND) != 0 &&
            (completed.flags &
             ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED) != 0 &&
            (completed.flags &
             ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) == 0 &&
            terminalSecrets == nil);
      NSArray<NSData *> *remaining = nil;
      CHECK([preparationStore listPreparationLookupIds:&remaining] ==
                AncPrivateVaultGenesisPreparationStoreStatusOK &&
            remaining.count == 0);
      CHECK(AncPrivateVaultResumePendingGenesisState(
                artifacts, preparationStore, coordinator) ==
            AncPrivateVaultGenesisStartupStatusOK);
      CHECK([entropy close] == AncPrivateVaultGuardedMemoryStatusOK &&
            [prepared.preparationHandle close] ==
                AncPrivateVaultGuardedMemoryStatusOK &&
            [prepared.recoveryMnemonic close] ==
                AncPrivateVaultGuardedMemoryStatusOK);
      anc_pv_genesis_preparation_snapshot_zero(&interrupted);
      anc_pv_genesis_preparation_snapshot_zero(&completed);
      anc_pv_zeroize(handle, sizeof handle);
      CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
    }
  }
  return 0;
}

static int TrustedTimeCases(void) {
  @autoreleasepool {
    NSString *root = NewRoot(@"trusted-time-basic");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    AncPrivateVaultTrustedTimeStore *store =
        [[AncPrivateVaultTrustedTimeStore alloc]
            initWithKeychain:TestKeychain()];
    uint64_t trusted = 0;
    CHECK([store observeSystemMilliseconds:UINT64_C(1724111140000)
                        trustedMilliseconds:&trusted] ==
              AncPrivateVaultTrustedTimeStatusOK &&
          trusted == UINT64_C(1724111140000));
    CHECK([store observeSystemMilliseconds:UINT64_C(1724111145000)
                        trustedMilliseconds:&trusted] ==
              AncPrivateVaultTrustedTimeStatusOK &&
          trusted == UINT64_C(1724111145000));
    CHECK([store observeSystemMilliseconds:UINT64_C(1724111144999)
                        trustedMilliseconds:&trusted] ==
              AncPrivateVaultTrustedTimeStatusRollbackDetected &&
          trusted == 0);
    FixedClock *system = [FixedClock new];
    system.value = UINT64_C(1724111145000);
    system.available = YES;
    AncPrivateVaultGenesisPersistedTrustedClock *clock =
        [[AncPrivateVaultGenesisPersistedTrustedClock alloc]
            initWithStore:store
              systemClock:system];
    CHECK([clock readNowMilliseconds:&trusted] &&
          trusted == system.value);
    system.value--;
    CHECK(![clock readNowMilliseconds:&trusted] && trusted == 0);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }

  for (NSUInteger phase = 0; phase < 2; phase += 1) {
    for (NSUInteger mutationIndex = 0; mutationIndex < 2; mutationIndex += 1) {
      for (NSUInteger failure = 1; failure <= 4; failure += 1) {
        @autoreleasepool {
        NSString *root = NewRoot(@"trusted-time-crash");
        CHECK(root != nil);
        gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
        AncPrivateVaultTrustedTimeStore *store =
            [[AncPrivateVaultTrustedTimeStore alloc]
                initWithKeychain:TestKeychain()];
        uint64_t trusted = 0;
        if (phase == 1)
          CHECK([store observeSystemMilliseconds:UINT64_C(1725111140000)
                              trustedMilliseconds:&trusted] ==
                AncPrivateVaultTrustedTimeStatusOK);
        gCustodyMutationMode =
            mutationIndex == 0 ? CustodyMutationModeFailBefore
                               : CustodyMutationModeCommitThenError;
        gCustodyMutationTarget = failure;
        gCustodyMutationCount = 0;
        gCustodyMutationHit = NO;
        uint64_t target = phase == 0 ? UINT64_C(1725111140000)
                                     : UINT64_C(1725111141000);
        AncPrivateVaultTrustedTimeStatus interrupted =
            [store observeSystemMilliseconds:target
                         trustedMilliseconds:&trusted];
        CHECK(gCustodyMutationHit &&
              (mutationIndex == 0
                   ? interrupted != AncPrivateVaultTrustedTimeStatusOK
                   : interrupted == AncPrivateVaultTrustedTimeStatusOK));
        gCustodyMutationMode = CustodyMutationModeDisabled;
        AncPrivateVaultTrustedTimeStore *reopened =
            [[AncPrivateVaultTrustedTimeStore alloc]
                initWithKeychain:TestKeychain()];
        CHECK([reopened observeSystemMilliseconds:target
                              trustedMilliseconds:&trusted] ==
                  AncPrivateVaultTrustedTimeStatusOK &&
              trusted == target);
        CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
        }
      }
    }
  }

  @autoreleasepool {
    NSString *root = NewRoot(@"trusted-time-corrupt");
    CHECK(root != nil);
    gKeychainPath = [root stringByAppendingPathComponent:@"keychain.plist"];
    AncPrivateVaultTrustedTimeStore *store =
        [[AncPrivateVaultTrustedTimeStore alloc]
            initWithKeychain:TestKeychain()];
    uint64_t trusted = 0;
    CHECK([store observeSystemMilliseconds:UINT64_C(1726111140000)
                        trustedMilliseconds:&trusted] ==
          AncPrivateVaultTrustedTimeStatusOK);
    NSMutableDictionary *keychain = LoadKeychain();
    NSString *targetKey = nil;
    for (NSString *key in keychain) {
      if ([key containsString:AncPrivateVaultTrustedTimeHighWaterService]) {
        targetKey = key;
        break;
      }
    }
    CHECK(targetKey != nil);
    NSMutableData *corrupt = [keychain[targetKey] mutableCopy];
    CHECK(corrupt.length == 60);
    ((uint8_t *)corrupt.mutableBytes)[28] ^= 1;
    keychain[targetKey] = corrupt;
    CHECK(SaveKeychain(keychain));
    CHECK([store observeSystemMilliseconds:UINT64_C(1726111140000)
                        trustedMilliseconds:&trusted] ==
              AncPrivateVaultTrustedTimeStatusCorrupt &&
          trusted == 0);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  }
  return 0;
}
static int Child(NSString *root) {
  NSDictionary *exact = Exact();
  NSData *vault = HexData(exact[@"parsed"][@"vaultIdHex"]);
  AncPrivateVaultGenesisCoordinatorResult *result = nil;
  CHECK([Coordinator(root) resumeVaultId:vault.bytes result:&result] ==
        AncPrivateVaultGenesisCoordinatorStatusOK);
  CHECK(result != nil && result.custodyGeneration == 2 &&
        result.sequence == 0 && result.activeEpoch == 1);
  AncPrivateVaultGenesisArtifacts *artifacts = nil;
  AncPrivateVaultGenesisArtifactStore *store =
      [[AncPrivateVaultGenesisArtifactStore alloc]
          initWithStateRootURL:[NSURL fileURLWithPath:root]];
  CHECK([store readVaultId:vault.bytes artifacts:&artifacts] ==
        AncPrivateVaultGenesisArtifactStoreStatusNotFound);
  return 0;
}

static int GenesisLockIdentityAndConcurrencyCases(void) {
  NSString *vaultA = @"00000000000000000000000000000001";
  NSString *vaultACopy = [[NSString alloc] initWithString:vaultA];
  NSString *vaultB = @"00000000000000000000000000000002";
  NSRecursiveLock *lockA = AncPrivateVaultGenesisLockForVaultId(vaultA);
  NSRecursiveLock *lockACopy =
      AncPrivateVaultGenesisLockForVaultId(vaultACopy);
  NSRecursiveLock *lockB = AncPrivateVaultGenesisLockForVaultId(vaultB);
  CHECK(lockA != nil && lockA == lockACopy && lockB != nil && lockA != lockB);
  CHECK(AncPrivateVaultGenesisLockForVaultId(nil) == nil);
  CHECK(AncPrivateVaultGenesisLockForVaultId(@"00") == nil);
  CHECK(AncPrivateVaultGenesisLockForVaultId(
            @"0000000000000000000000000000000A") == nil);
  CHECK(AncPrivateVaultGenesisLockForVaultId(
            @"0000000000000000000000000000000g") == nil);

  [lockA lock];
  [lockA lock];
  [lockA unlock];
  [lockA unlock];

  NSMutableArray<NSValue *> *concurrentLocks = [NSMutableArray array];
  dispatch_apply(64, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0),
                 ^(size_t index) {
                   (void)index;
                   NSRecursiveLock *lock =
                       AncPrivateVaultGenesisLockForVaultId(vaultA);
                   @synchronized(concurrentLocks) {
                     [concurrentLocks
                         addObject:[NSValue
                                       valueWithPointer:
                                           (__bridge const void *)lock]];
                   }
                 });
  CHECK(concurrentLocks.count == 64);
  for (NSValue *value in concurrentLocks)
    CHECK(value.pointerValue == (__bridge const void *)lockA);

  dispatch_semaphore_t attempted = dispatch_semaphore_create(0);
  dispatch_semaphore_t acquired = dispatch_semaphore_create(0);
  [lockA lock];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    dispatch_semaphore_signal(attempted);
    [AncPrivateVaultGenesisLockForVaultId(vaultACopy) lock];
    dispatch_semaphore_signal(acquired);
    [AncPrivateVaultGenesisLockForVaultId(vaultACopy) unlock];
  });
  CHECK(dispatch_semaphore_wait(attempted,
                                dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC)) ==
        0);
  CHECK(dispatch_semaphore_wait(
            acquired, dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC)) !=
        0);
  [lockA unlock];
  CHECK(dispatch_semaphore_wait(acquired,
                                dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC)) ==
        0);

  dispatch_semaphore_t otherAcquired = dispatch_semaphore_create(0);
  [lockA lock];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    [lockB lock];
    dispatch_semaphore_signal(otherAcquired);
    [lockB unlock];
  });
  CHECK(dispatch_semaphore_wait(
            otherAcquired,
            dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC)) == 0);
  [lockA unlock];
  return 0;
}

static int GenesisHostedAppendCodecCases(void) {
  NSMutableData *head = [NSMutableData dataWithLength:32];
  NSMutableData *wrapHash = [NSMutableData dataWithLength:32];
  memset(head.mutableBytes, 0xab, head.length);
  memset(wrapHash.mutableBytes, 0xcd, wrapHash.length);
  AncPrivateVaultCanonicalValue *root =
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue integer:1],
        @3 : [AncPrivateVaultCanonicalValue
                 text:@"control-log-genesis-append-receipt"],
        @4 : [AncPrivateVaultCanonicalValue text:@"vault:example-0001"],
        @5 : [AncPrivateVaultCanonicalValue text:@"entry:example-0002"],
        @6 : [AncPrivateVaultCanonicalValue integer:0],
        @7 : [AncPrivateVaultCanonicalValue bytes:head],
        @8 : [AncPrivateVaultCanonicalValue bytes:wrapHash],
        @9 : [AncPrivateVaultCanonicalValue integer:4],
      }];
  AncPrivateVaultCanonicalStatus status;
  NSData *encoded = AncPrivateVaultCanonicalEncode(root, &status);
  AncPrivateVaultGenesisHostedAppendReceipt *receipt =
      AncPrivateVaultGenesisHostedAppendReceiptDecode(encoded);
  CHECK(receipt != nil && receipt.sequence == 0 &&
        [receipt.vaultId isEqualToString:@"vault:example-0001"] &&
        [receipt.entryId isEqualToString:@"entry:example-0002"] &&
        receipt.recoveryWrapByteLength == 4);
  static const char domain[] = "anc/v1/genesis-hosted-append-receipt";
  uint8_t digest[32] = {0};
  CHECK(anc_pv_blake2b_256_two_part(
            digest, (const uint8_t *)domain, sizeof domain, encoded.bytes,
            encoded.length) == ANC_PV_CRYPTO_OK);
  CHECK([HexString([NSData dataWithBytes:digest length:sizeof digest])
            isEqualToString:
                @"8b12f022c253de5b52cf7866e2b328a74e61fa8f83914b3e51c7dde8986dd547"]);
  anc_pv_zeroize(digest, sizeof digest);

  NSMutableDictionary *wrongType = [root.mapValue mutableCopy];
  wrongType[@3] = [AncPrivateVaultCanonicalValue
      text:@"control-log-rotation-append-receipt"];
  CHECK(AncPrivateVaultGenesisHostedAppendReceiptDecode(
            AncPrivateVaultCanonicalEncode(
                [AncPrivateVaultCanonicalValue map:wrongType], &status)) ==
        nil);
  NSMutableDictionary *wrongSequence = [root.mapValue mutableCopy];
  wrongSequence[@6] = [AncPrivateVaultCanonicalValue integer:1];
  CHECK(AncPrivateVaultGenesisHostedAppendReceiptDecode(
            AncPrivateVaultCanonicalEncode(
                [AncPrivateVaultCanonicalValue map:wrongSequence], &status)) ==
        nil);
  NSData *request = AncPrivateVaultGenesisHostedAppendRequestEncode(
      [NSData dataWithBytes:"abc" length:3],
      [NSData dataWithBytes:"defg" length:4]);
  CHECK(request.length > 0 &&
        request.length <= ANC_PV_GENESIS_HOSTED_APPEND_REQUEST_MAX_BYTES);
  return 0;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc == 4 && strcmp(argv[1], "--restart-child") == 0) {
      gKeychainPath = @(argv[3]);
      return Child(@(argv[2]));
    }
    CHECK(sodium_init() >= 0);
    CHECK(PreparationCases() == 0);
    CHECK(PreparationCancellationAndExpiryCases() == 0);
    CHECK(GenesisHostedAppendCodecCases() == 0);
    CHECK(GenesisLockIdentityAndConcurrencyCases() == 0);
    NSDictionary *exact = Exact();
    CHECK(exact != nil);
    CHECK(ArtifactFaultAndFilesystemCases(exact) == 0);
    CHECK(PublicCommitCases(exact) == 0);
    CHECK(CustodyTransitionMutationCases(exact) == 0);
    CHECK(SameVaultCommitConcurrencyCases(exact) == 0);
    CHECK(CoordinatorCrashCases(exact) == 0);
    CHECK(StartupSweepCases(exact) == 0);
    CHECK(PreparationStartupSweepCases() == 0);
    CHECK(TrustedTimeCases() == 0);
    NSString *root = [NSTemporaryDirectory()
        stringByAppendingPathComponent:
            [NSString stringWithFormat:@"genesis-coordinator-%@",
                                       NSUUID.UUID.UUIDString]];
    CHECK([NSFileManager.defaultManager
              createDirectoryAtPath:root
        withIntermediateDirectories:NO
                         attributes:@{
                           NSFilePosixPermissions : @0700
                         }
                              error:nil]);
    gKeychainPath =
        [root stringByAppendingPathComponent:@"test-keychain.plist"];
    AncPrivateVaultCustodyRepository *repository = Repository();
    CHECK(SeedPending(repository, exact) == 0);
    NSData *vault = HexData(exact[@"parsed"][@"vaultIdHex"]),
           *ceremony = HexData(exact[@"parsed"][@"ceremonyIdHex"]),
           *bootstrap = HexData(exact[@"bootstrapTranscriptHex"]),
           *confirmation = HexData(exact[@"recoveryConfirmationHex"]),
           *authorization = HexData(exact[@"authorizationHex"]);
    AncPrivateVaultGenesisArtifactStore *store =
        [[AncPrivateVaultGenesisArtifactStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:root]];
    CHECK([store stageVaultId:vault.bytes
                        ceremonyId:ceremony.bytes
                      verifiedAtMs:1721111140000ULL
               bootstrapTranscript:bootstrap
              recoveryConfirmation:confirmation
                     authorization:authorization] ==
          AncPrivateVaultGenesisArtifactStoreStatusOK);
    CHECK([store stageVaultId:vault.bytes
                        ceremonyId:ceremony.bytes
                      verifiedAtMs:1721111140000ULL
               bootstrapTranscript:bootstrap
              recoveryConfirmation:confirmation
                     authorization:authorization] ==
          AncPrivateVaultGenesisArtifactStoreStatusOK);
    NSMutableData *changed = [authorization mutableCopy];
    ((uint8_t *)changed.mutableBytes)[0] ^= 1;
    CHECK([store stageVaultId:vault.bytes
                        ceremonyId:ceremony.bytes
                      verifiedAtMs:1721111140000ULL
               bootstrapTranscript:bootstrap
              recoveryConfirmation:confirmation
                     authorization:changed] ==
          AncPrivateVaultGenesisArtifactStoreStatusConflict);
    NSTask *task = [NSTask new];
    task.executableURL =
        [NSURL fileURLWithPath:NSProcessInfo.processInfo.arguments[0]];
    task.arguments = @[ @"--restart-child", root, gKeychainPath ];
    CHECK([task launchAndReturnError:nil]);
    [task waitUntilExit];
    CHECK(task.terminationStatus == 0);
    CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
    fprintf(stdout, "private vault genesis coordinator tests passed\n");
    return 0;
  }
}
