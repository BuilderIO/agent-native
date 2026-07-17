#import <Foundation/Foundation.h>

#import "PrivateVaultAuthoritySnapshot.h"
#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultAuthorityStoreInternal.h"

#import <objc/runtime.h>

#include <stdio.h>
#include <sys/stat.h>

#ifndef ANC_PV_AUTHORITY_VECTOR_PATH
#error ANC_PV_AUTHORITY_VECTOR_PATH must name the frozen Core vector corpus
#endif

#define CHECK(condition)                                                       \
  do {                                                                         \
    if (!(condition)) {                                                        \
      fprintf(stderr, "authority snapshot CHECK failed at %s:%d: %s\n",        \
              __FILE__, __LINE__, #condition);                                 \
      return 1;                                                                \
    }                                                                          \
  } while (0)

typedef struct AuthorityTestSecrets {
  uint8_t signing[32], box[32], local[32], active[32], pending[32];
} AuthorityTestSecrets;

typedef void (^AuthorityCustodyMutation)(
    AncPrivateVaultCustodySnapshot *snapshot);
@interface AuthorityMutatingRepository : AncPrivateVaultCustodyRepository
@property(nonatomic) AncPrivateVaultCustodyRepository *base;
@property(nonatomic, copy) AuthorityCustodyMutation mutation;
- (instancetype)initWithBase:(AncPrivateVaultCustodyRepository *)base
                    mutation:(AuthorityCustodyMutation)mutation;
@end
@implementation AuthorityMutatingRepository
- (instancetype)initWithBase:(AncPrivateVaultCustodyRepository *)base
                    mutation:(AuthorityCustodyMutation)mutation {
  self = [super init];
  if (self != nil) {
    _base = base;
    _mutation = [mutation copy];
  }
  return self;
}
- (AncPrivateVaultCustodyRepositoryStatus)
    readVaultId:(NSString *)vaultId
       snapshot:(AncPrivateVaultCustodySnapshot *)snapshot
         handle:(AncPrivateVaultCustodyHandle **)handle {
  AncPrivateVaultCustodyRepositoryStatus status =
      [self.base readVaultId:vaultId snapshot:snapshot handle:handle];
  if (status == AncPrivateVaultCustodyRepositoryStatusOK &&
      self.mutation != nil)
    self.mutation(snapshot);
  return status;
}
- (AncPrivateVaultCustodyRepositoryStatus)
    advanceAuthorityAnchorVaultId:(NSString *)vaultId
               expectedGeneration:(uint64_t)expectedGeneration
           expectedSnapshotDigest:(NSData *)expectedSnapshotDigest
               nextPublicSnapshot:
                   (const AncPrivateVaultCustodySnapshot *)nextPublicSnapshot
                  epochTransition:
                      (AncPrivateVaultCustodyEpochTransition)epochTransition {
  return [self.base advanceAuthorityAnchorVaultId:vaultId
                               expectedGeneration:expectedGeneration
                           expectedSnapshotDigest:expectedSnapshotDigest
                               nextPublicSnapshot:nextPublicSnapshot
                                  epochTransition:epochTransition];
}
- (AncPrivateVaultCustodyRepositoryStatus)
    migrateLegacyCodecVaultId:(NSString *)vaultId
           expectedGeneration:(uint64_t)expectedGeneration {
  return [self.base migrateLegacyCodecVaultId:vaultId
                           expectedGeneration:expectedGeneration];
}
@end
static NSMutableDictionary<NSString *, NSData *> *gAuthorityKeychain;
static NSString *AuthorityStoreKey(NSDictionary *query) {
  return
      [NSString stringWithFormat:@"%@|%@", query[(__bridge id)kSecAttrService],
                                 query[(__bridge id)kSecAttrAccount]];
}
static OSStatus AuthorityCopy(CFDictionaryRef raw, CFTypeRef *result) {
  NSData *value =
      gAuthorityKeychain[AuthorityStoreKey((__bridge NSDictionary *)raw)];
  if (value == nil)
    return errSecItemNotFound;
  if (result)
    *result = CFBridgingRetain([value copy]);
  return errSecSuccess;
}
static OSStatus AuthorityAdd(CFDictionaryRef raw, CFTypeRef *result) {
  (void)result;
  NSDictionary *attributes = (__bridge NSDictionary *)raw;
  NSString *key = AuthorityStoreKey(attributes);
  if (gAuthorityKeychain[key])
    return errSecDuplicateItem;
  NSData *value = attributes[(__bridge id)kSecValueData];
  gAuthorityKeychain[key] =
      [NSData dataWithBytes:value.bytes length:value.length];
  return errSecSuccess;
}
static OSStatus AuthorityUpdate(CFDictionaryRef rawQuery,
                                CFDictionaryRef rawAttributes) {
  NSDictionary *query = (__bridge NSDictionary *)rawQuery;
  NSString *key = AuthorityStoreKey(query);
  if (!gAuthorityKeychain[key])
    return errSecItemNotFound;
  NSDictionary *attributes = (__bridge NSDictionary *)rawAttributes;
  NSData *value = attributes[(__bridge id)kSecValueData];
  gAuthorityKeychain[key] =
      [NSData dataWithBytes:value.bytes length:value.length];
  return errSecSuccess;
}
static OSStatus AuthorityDelete(CFDictionaryRef raw) {
  NSString *key = AuthorityStoreKey((__bridge NSDictionary *)raw);
  if (!gAuthorityKeychain[key])
    return errSecItemNotFound;
  [gAuthorityKeychain removeObjectForKey:key];
  return errSecSuccess;
}
static AncPrivateVaultCustodyRepository *AuthorityRepository(void) {
  AncPrivateVaultSecItemFunctions functions = {.copyMatching = AuthorityCopy,
                                               .add = AuthorityAdd,
                                               .update = AuthorityUpdate,
                                               .deleteItem = AuthorityDelete};
  AncPrivateVaultKeychain *keychain =
      [[AncPrivateVaultKeychain alloc] initWithFunctions:functions
                                          contextFactory:^LAContext * {
                                            return [[LAContext alloc] init];
                                          }];
  return [[AncPrivateVaultCustodyRepository alloc] initWithKeychain:keychain];
}
static void AuthoritySetId(uint8_t output[160], size_t *length,
                           NSString *value) {
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  memset(output, 0, 160);
  memcpy(output, data.bytes, data.length);
  *length = data.length;
}
static void AuthorityFill(uint8_t *bytes, size_t length, uint8_t start) {
  for (size_t i = 0; i < length; i++)
    bytes[i] = (uint8_t)(start + i);
}

static NSData *DataFromHex(NSString *hex) {
  if (hex.length % 2 != 0)
    return nil;
  NSMutableData *data = [NSMutableData dataWithLength:hex.length / 2];
  uint8_t *bytes = data.mutableBytes;
  for (NSUInteger index = 0; index < data.length; index += 1) {
    unsigned int value = 0;
    NSString *pair = [hex substringWithRange:NSMakeRange(index * 2, 2)];
    if (sscanf(pair.UTF8String, "%2x", &value) != 1)
      return nil;
    bytes[index] = (uint8_t)value;
  }
  return data;
}

static NSMutableData *DeriveSynthetic(NSString *label) {
  static const uint8_t domain[] =
      "anc/v1/private-vault/authority-store/test-derivation";
  NSData *text = [label dataUsingEncoding:NSUTF8StringEncoding];
  NSMutableData *input = [NSMutableData dataWithBytes:domain
                                               length:sizeof domain];
  [input appendData:text];
  NSMutableData *result = [NSMutableData dataWithLength:32];
  if (anc_pv_blake2b_256(result.mutableBytes, input.bytes, input.length) !=
      ANC_PV_CRYPTO_OK)
    return nil;
  anc_pv_zeroize(input.mutableBytes, input.length);
  return result;
}

static int
RunAuthorityCrashCase(AncPrivateVaultAuthoritySnapshot *genesis,
                      AncPrivateVaultAuthoritySnapshot *descendant,
                      NSData *genesisCanonical, NSData *localKey,
                      NSString *vaultDigestHex,
                      AncPrivateVaultAuthorityFaultPoint faultPoint) {
  gAuthorityKeychain = [NSMutableDictionary dictionary];
  AncPrivateVaultCustodyRepository *repository = AuthorityRepository();
  AuthorityTestSecrets secrets = {0};
  AuthorityFill(secrets.signing, 32, 1);
  AuthorityFill(secrets.box, 32, 33);
  memcpy(secrets.local, localKey.bytes, 32);
  AuthorityFill(secrets.active, 32, 97);
  AncPrivateVaultCustodySnapshot custody = {0};
  custody.record_version = ANC_PV_CUSTODY_VERSION;
  custody.authority_anchor_present = 1;
  custody.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_ACTIVE;
  custody.role = ANC_PV_CUSTODY_ROLE_ENDPOINT;
  custody.custody_generation = 1;
  AuthoritySetId(custody.vault_id, &custody.vault_id_length, genesis.vaultId);
  AuthoritySetId(custody.endpoint_id, &custody.endpoint_id_length,
                 @"endpoint:01-owner");
  uint8_t signingPrivate[64] = {0}, boxPrivate[32] = {0};
  CHECK(anc_pv_ed25519_seed_keypair(custody.signing_public_key, signingPrivate,
                                    secrets.signing) == ANC_PV_CRYPTO_OK);
  CHECK(anc_pv_box_seed_keypair(custody.box_public_key, boxPrivate,
                                secrets.box) == ANC_PV_CRYPTO_OK);
  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
  anc_pv_zeroize(boxPrivate, sizeof boxPrivate);
  custody.active_epoch = 1;
  custody.recovery_generation = 1;
  custody.anchored_sequence = genesis.sequence;
  memcpy(custody.anchored_head, genesis.headHash.bytes, 32);
  memcpy(custody.membership_digest, genesis.membershipHash.bytes, 32);
  custody.signed_at_ms = genesis.signedAtMs;
  custody.freshness_ms = genesis.verifiedAtMs;
  NSMutableData *nonce = [NSMutableData dataWithLength:24];
  memset(nonce.mutableBytes, 0x44, 24);
  NSData *genesisDigest = nil;
  NSData *genesisFrame = AncPrivateVaultAuthorityFrameEncodeForTesting(
      genesisCanonical, genesis.vaultId, 1, localKey, nonce, &genesisDigest);
  CHECK(genesisFrame != nil);
  memcpy(custody.snapshot_digest, genesisDigest.bytes, 32);
  AncPrivateVaultCustodySecretInputs inputs = {
      .signing_seed = secrets.signing,
      .box_seed = secrets.box,
      .local_state_key = secrets.local,
      .active_epoch_key = secrets.active,
      .pending_epoch_key = secrets.pending};
  CHECK([repository storeSnapshot:&custody
                          secrets:&inputs
                          vaultId:genesis.vaultId] ==
        AncPrivateVaultCustodyRepositoryStatusOK);
  NSString *root = [NSTemporaryDirectory()
      stringByAppendingPathComponent:[NSString
                                         stringWithFormat:@"authority-crash-%@",
                                                          NSUUID.UUID
                                                              .UUIDString]];
  NSString *authority =
      [root stringByAppendingPathComponent:@"state/authority"];
  CHECK([NSFileManager.defaultManager
            createDirectoryAtPath:authority
      withIntermediateDirectories:YES
                       attributes:@{
                         NSFilePosixPermissions : @0700
                       }
                            error:nil]);
  NSString *live =
      [authority stringByAppendingPathComponent:
                     [vaultDigestHex stringByAppendingString:@".authority"]];
  CHECK([genesisFrame writeToFile:live atomically:NO]);
  CHECK(chmod(live.fileSystemRepresentation, 0600) == 0);
  AncPrivateVaultAuthorityStore *store = [[AncPrivateVaultAuthorityStore alloc]
      initWithStateRootURL:[NSURL fileURLWithPath:root isDirectory:YES]
         custodyRepository:repository];
  AncPrivateVaultAuthorityCheckpoint *initial = nil;
  CHECK([store loadVaultId:genesis.vaultId checkpoint:&initial
                     error:nil] == AncPrivateVaultAuthorityStoreStatusOK);
  AncPrivateVaultVerifiedReplayResult *replay = [AncPrivateVaultVerifiedReplayResult
      testResultWithExpectedCheckpoint:initial
                          nextSnapshot:descendant
                       epochTransition:
                           AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch];
  AncPrivateVaultAuthoritySetFaultHookForTesting(
      ^BOOL(AncPrivateVaultAuthorityFaultPoint point) {
        return point == faultPoint;
      });
  CHECK([store commitVerifiedReplayResult:replay
                                  vaultId:genesis.vaultId
                             verifiedAtMs:descendant.verifiedAtMs
                               checkpoint:nil
                                    error:nil] !=
        AncPrivateVaultAuthorityStoreStatusOK);
  AncPrivateVaultAuthoritySetFaultHookForTesting(nil);
  AncPrivateVaultAuthorityStore *recovered =
      [[AncPrivateVaultAuthorityStore alloc]
          initWithStateRootURL:[NSURL fileURLWithPath:root isDirectory:YES]
             custodyRepository:repository];
  AncPrivateVaultAuthorityCheckpoint *checkpoint = nil;
  CHECK([recovered loadVaultId:genesis.vaultId
                    checkpoint:&checkpoint
                         error:nil] == AncPrivateVaultAuthorityStoreStatusOK);
  uint64_t expectedGeneration =
      faultPoint <= AncPrivateVaultAuthorityFaultAfterStageVerification ? 1 : 2;
  uint64_t expectedSequence = expectedGeneration == 1 ? 0 : 1;
  CHECK(checkpoint.custodyGeneration == expectedGeneration);
  CHECK(checkpoint.snapshot.sequence == expectedSequence);
  CHECK([NSFileManager.defaultManager removeItemAtPath:root error:nil]);
  anc_pv_zeroize(&secrets, sizeof secrets);
  return 0;
}

int main(void) {
  @autoreleasepool {
    NSString *path = @ANC_PV_AUTHORITY_VECTOR_PATH;
    NSData *jsonData = [NSData dataWithContentsOfFile:path];
    CHECK(jsonData != nil);
    NSDictionary *corpus = [NSJSONSerialization JSONObjectWithData:jsonData
                                                           options:0
                                                             error:nil];
    CHECK([corpus[@"schema"]
        isEqualToString:@"anc/v1-native-authority-store-vectors@1"]);
    CHECK([corpus[@"protocolBaseCommit"]
        isEqualToString:@"de5291f47275dcc96d285bb92623496aedb5394e"]);
    CHECK([corpus[@"snapshotCases"] count] == 32);
    for (NSDictionary *testCase in corpus[@"snapshotCases"]) {
      NSData *canonical = DataFromHex(testCase[@"canonicalHex"]);
      CHECK(canonical != nil);
      AncPrivateVaultAuthoritySnapshotStatus status;
      AncPrivateVaultAuthoritySnapshot *snapshot =
          AncPrivateVaultAuthoritySnapshotDecode(canonical, &status);
      if ([testCase[@"expectedStatus"] isEqualToString:@"accept"]) {
        CHECK(snapshot != nil);
        CHECK(status == AncPrivateVaultAuthoritySnapshotStatusOK);
        NSData *encoded =
            AncPrivateVaultAuthoritySnapshotEncode(snapshot, &status);
        CHECK(encoded != nil && [encoded isEqualToData:canonical]);
      } else {
        CHECK(snapshot == nil);
        CHECK(status != AncPrivateVaultAuthoritySnapshotStatusOK);
      }
    }
    NSDictionary *vector = corpus[@"frameVector"];
    NSDictionary *frameSnapshotCase = nil;
    for (NSDictionary *testCase in corpus[@"snapshotCases"])
      if ([testCase[@"name"] isEqualToString:@"descendant"])
        frameSnapshotCase = testCase;
    NSData *plaintext = DataFromHex(frameSnapshotCase[@"canonicalHex"]);
    NSMutableData *key = DeriveSynthetic(vector[@"localStateKeyLabel"]);
    NSData *nonce = DataFromHex(vector[@"nonceHex"]);
    NSData *digest = nil;
    __block NSUInteger clearedDerivedKeys = 0;
    __block BOOL everyDerivedKeyCleared = YES;
    AncPrivateVaultAuthoritySetDerivedKeyClearedHookForTesting(^(BOOL cleared) {
      everyDerivedKeyCleared = everyDerivedKeyCleared && cleared;
      clearedDerivedKeys += 1;
    });
    NSData *frame = AncPrivateVaultAuthorityFrameEncodeForTesting(
        plaintext, vector[@"vaultId"],
        [vector[@"custodyGeneration"] unsignedLongLongValue], key, nonce,
        &digest);
    CHECK([frame isEqualToData:DataFromHex(vector[@"frameHex"])]);
    CHECK([digest isEqualToData:DataFromHex(vector[@"frameDigestHex"])]);
    NSData *decoded = AncPrivateVaultAuthorityFrameDecodeForTesting(
        frame, vector[@"vaultId"],
        [vector[@"custodyGeneration"] unsignedLongLongValue], key, nil);
    CHECK([decoded isEqualToData:plaintext]);
    for (NSDictionary *mutation in corpus[@"frameMutations"]) {
      NSData *badFrame = DataFromHex(mutation[@"frameHex"]);
      NSMutableData *badKey = DeriveSynthetic(mutation[@"localStateKeyLabel"]);
      NSData *mutationDigest = nil;
      NSData *mutationPlaintext = AncPrivateVaultAuthorityFrameDecodeForTesting(
          badFrame, mutation[@"vaultId"],
          [mutation[@"custodyGeneration"] unsignedLongLongValue], badKey,
          &mutationDigest);
      if ([mutation[@"name"] isEqualToString:@"frame_digest"]) {
        CHECK(mutationPlaintext != nil);
        CHECK(![mutationDigest
            isEqualToData:DataFromHex(mutation[@"frameDigestHex"])]);
      } else {
        CHECK(mutationPlaintext == nil);
      }
      anc_pv_zeroize(badKey.mutableBytes, badKey.length);
    }
    AncPrivateVaultAuthoritySetDerivedKeyClearedHookForTesting(nil);
    CHECK(clearedDerivedKeys >= 2 && everyDerivedKeyCleared);

    NSDictionary *genesisCase = nil, *descendantCase = nil;
    for (NSDictionary *testCase in corpus[@"snapshotCases"]) {
      if ([testCase[@"name"] isEqualToString:@"genesis"])
        genesisCase = testCase;
      if ([testCase[@"name"] isEqualToString:@"descendant"])
        descendantCase = testCase;
    }
    AncPrivateVaultAuthoritySnapshotStatus snapshotStatus;
    AncPrivateVaultAuthoritySnapshot *genesis =
        AncPrivateVaultAuthoritySnapshotDecode(
            DataFromHex(genesisCase[@"canonicalHex"]), &snapshotStatus);
    AncPrivateVaultAuthoritySnapshot *descendant =
        AncPrivateVaultAuthoritySnapshotDecode(
            DataFromHex(descendantCase[@"canonicalHex"]), &snapshotStatus);
    CHECK(genesis != nil && descendant != nil);
    NSData *immutableGenesis =
        AncPrivateVaultAuthoritySnapshotEncode(genesis, &snapshotStatus);
    BOOL activeMembersMutated = NO;
    @try {
      [(NSMutableArray *)(id)genesis.activeMembers addObject:@"mutation"];
      activeMembersMutated = YES;
    } @catch (__unused NSException *exception) {
    }
    BOOL removedMembersMutated = NO;
    @try {
      [(NSMutableArray *)(id)genesis.removedEndpointIds addObject:@"mutation"];
      removedMembersMutated = YES;
    } @catch (__unused NSException *exception) {
    }
    CHECK(!activeMembersMutated && !removedMembersMutated);
    CHECK(![genesis.headHash isKindOfClass:NSMutableData.class]);
    CHECK(![genesis.activeMembers.firstObject.signingPublicKey
        isKindOfClass:NSMutableData.class]);
    CHECK([[AncPrivateVaultAuthoritySnapshotEncode(genesis, &snapshotStatus)
        copy] isEqualToData:immutableGenesis]);
    gAuthorityKeychain = [NSMutableDictionary dictionary];
    AncPrivateVaultCustodyRepository *repository = AuthorityRepository();
    AuthorityTestSecrets secrets = {0};
    AuthorityFill(secrets.signing, 32, 1);
    AuthorityFill(secrets.box, 32, 33);
    memcpy(secrets.local, key.bytes, 32);
    AuthorityFill(secrets.active, 32, 97);
    AncPrivateVaultCustodySnapshot custody = {0};
    custody.record_version = ANC_PV_CUSTODY_VERSION;
    custody.authority_anchor_present = 1;
    custody.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_ACTIVE;
    custody.role = ANC_PV_CUSTODY_ROLE_ENDPOINT;
    custody.custody_generation = 1;
    AuthoritySetId(custody.vault_id, &custody.vault_id_length, genesis.vaultId);
    AuthoritySetId(custody.endpoint_id, &custody.endpoint_id_length,
                   @"endpoint:01-owner");
    uint8_t signingPrivate[64] = {0}, boxPrivate[32] = {0};
    CHECK(anc_pv_ed25519_seed_keypair(custody.signing_public_key,
                                      signingPrivate,
                                      secrets.signing) == ANC_PV_CRYPTO_OK);
    CHECK(anc_pv_box_seed_keypair(custody.box_public_key, boxPrivate,
                                  secrets.box) == ANC_PV_CRYPTO_OK);
    anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
    anc_pv_zeroize(boxPrivate, sizeof boxPrivate);
    custody.active_epoch = 1;
    custody.recovery_generation = 1;
    custody.anchored_sequence = genesis.sequence;
    memcpy(custody.anchored_head, genesis.headHash.bytes, 32);
    memcpy(custody.membership_digest, genesis.membershipHash.bytes, 32);
    custody.signed_at_ms = genesis.signedAtMs;
    custody.freshness_ms = genesis.verifiedAtMs;
    NSMutableData *genesisNonce = [NSMutableData dataWithLength:24];
    memset(genesisNonce.mutableBytes, 0x44, 24);
    NSData *genesisDigest = nil;
    NSData *genesisFrame = AncPrivateVaultAuthorityFrameEncodeForTesting(
        DataFromHex(genesisCase[@"canonicalHex"]), genesis.vaultId, 1, key,
        genesisNonce, &genesisDigest);
    CHECK(genesisFrame != nil);
    memcpy(custody.snapshot_digest, genesisDigest.bytes, 32);
    AncPrivateVaultCustodySecretInputs secretInputs = {
        .signing_seed = secrets.signing,
        .box_seed = secrets.box,
        .local_state_key = secrets.local,
        .active_epoch_key = secrets.active,
        .pending_epoch_key = secrets.pending};
    CHECK([repository storeSnapshot:&custody
                            secrets:&secretInputs
                            vaultId:genesis.vaultId] ==
          AncPrivateVaultCustodyRepositoryStatusOK);
    NSString *temporary = [NSTemporaryDirectory()
        stringByAppendingPathComponent:
            [NSString stringWithFormat:@"authority-store-%@",
                                       NSUUID.UUID.UUIDString]];
    NSString *authority =
        [temporary stringByAppendingPathComponent:@"state/authority"];
    CHECK([NSFileManager.defaultManager
              createDirectoryAtPath:authority
        withIntermediateDirectories:YES
                         attributes:@{
                           NSFilePosixPermissions : @0700
                         }
                              error:nil]);
    NSString *liveName =
        [NSString stringWithFormat:@"%@.authority", vector[@"vaultDigestHex"]];
    NSString *livePath = [authority stringByAppendingPathComponent:liveName];
    CHECK([genesisFrame writeToFile:livePath atomically:NO]);
    CHECK(chmod(livePath.fileSystemRepresentation, 0600) == 0);
    AncPrivateVaultAuthorityStore *store =
        [[AncPrivateVaultAuthorityStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:temporary
                                            isDirectory:YES]
               custodyRepository:repository];
    AncPrivateVaultAuthorityCheckpoint *initial = nil;
    CHECK([store loadVaultId:genesis.vaultId checkpoint:&initial
                       error:nil] == AncPrivateVaultAuthorityStoreStatusOK);
    CHECK(initial.custodyGeneration == 1 &&
          [initial.frameDigest isEqualToData:genesisDigest]);
    AncPrivateVaultCustodySetHandleCloseStatusForTesting(
        ^AncPrivateVaultCustodyRepositoryStatus(
            AncPrivateVaultCustodyHandle *closing,
            AncPrivateVaultCustodyRepositoryStatus actual) {
          (void)closing;
          (void)actual;
          return AncPrivateVaultCustodyRepositoryStatusFailed;
        });
    CHECK([store loadVaultId:genesis.vaultId checkpoint:nil error:nil] ==
          AncPrivateVaultAuthorityStoreStatusProtectionFailed);
    AncPrivateVaultCustodySetHandleCloseStatusForTesting(nil);
    AncPrivateVaultVerifiedReplayResult *replay = [AncPrivateVaultVerifiedReplayResult
        testResultWithExpectedCheckpoint:initial
                            nextSnapshot:descendant
                         epochTransition:
                             AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch];
    Class privateVerifiedClass =
        NSClassFromString(@"AncPrivateVaultImmutableVerifiedReplayResult");
    CHECK(privateVerifiedClass != Nil);
    AncPrivateVaultVerifiedReplayResult *forgedPrivate =
        class_createInstance(privateVerifiedClass, 0);
    Ivar expectedIvar =
        class_getInstanceVariable(privateVerifiedClass, "_expectedCheckpoint");
    Ivar nextIvar =
        class_getInstanceVariable(privateVerifiedClass, "_nextSnapshot");
    CHECK(expectedIvar != NULL && nextIvar != NULL);
    object_setIvar(forgedPrivate, expectedIvar, replay.expectedCheckpoint);
    object_setIvar(forgedPrivate, nextIvar, replay.nextSnapshot);
    CHECK(![forgedPrivate
        respondsToSelector:NSSelectorFromString(
                               @"internalResultWithExpectedCheckpoint:snapshot:transition:")]);
    CHECK([store commitVerifiedReplayResult:forgedPrivate
                                    vaultId:genesis.vaultId
                               verifiedAtMs:descendant.verifiedAtMs
                                 checkpoint:nil
                                      error:nil] ==
          AncPrivateVaultAuthorityStoreStatusInvalid);
    CHECK([store commitVerifiedReplayResult:replay
                                    vaultId:genesis.vaultId
                               verifiedAtMs:initial.snapshot.verifiedAtMs - 1
                                 checkpoint:nil
                                      error:nil] ==
          AncPrivateVaultAuthorityStoreStatusInvalid);
    AncPrivateVaultVerifiedReplayResult *tamperedPresentation =
        [AncPrivateVaultVerifiedReplayResult
            testResultWithExpectedCheckpoint:initial
                                nextSnapshot:descendant
                             epochTransition:
                                 AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch];
    object_setIvar(tamperedPresentation, nextIvar, genesis);
    CHECK([store commitVerifiedReplayResult:tamperedPresentation
                                    vaultId:genesis.vaultId
                               verifiedAtMs:descendant.verifiedAtMs
                                 checkpoint:nil
                                      error:nil] ==
          AncPrivateVaultAuthorityStoreStatusInvalid);
    CHECK(replay.nextSnapshot != descendant);
    CHECK([[AncPrivateVaultAuthoritySnapshotEncode(replay.nextSnapshot,
                                                   &snapshotStatus) copy]
        isEqualToData:DataFromHex(descendantCase[@"canonicalHex"])]);
    AncPrivateVaultAuthoritySnapshot *challenger =
        AncPrivateVaultAuthoritySnapshotDecode(
            DataFromHex(descendantCase[@"canonicalHex"]), &snapshotStatus);
    NSMutableData *challengerHead = [challenger.headHash mutableCopy];
    ((uint8_t *)challengerHead.mutableBytes)[0] ^= 0x80;
    [challenger setValue:challengerHead forKey:@"headHash"];
    AncPrivateVaultVerifiedReplayResult *challengerReplay =
        [AncPrivateVaultVerifiedReplayResult
            testResultWithExpectedCheckpoint:initial
                                nextSnapshot:challenger
                             epochTransition:
                                 AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch];
    AncPrivateVaultAuthorityStore *secondStore =
        [[AncPrivateVaultAuthorityStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:temporary
                                            isDirectory:YES]
               custodyRepository:repository];
    dispatch_semaphore_t writerStart = dispatch_semaphore_create(0);
    dispatch_group_t writers = dispatch_group_create();
    __block AncPrivateVaultAuthorityStoreStatus writerA;
    __block AncPrivateVaultAuthorityStoreStatus writerB;
    __block AncPrivateVaultAuthorityCheckpoint *committedA = nil;
    __block AncPrivateVaultAuthorityCheckpoint *committedB = nil;
    dispatch_group_async(
        writers, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
          dispatch_semaphore_wait(writerStart, DISPATCH_TIME_FOREVER);
          writerA = [store commitVerifiedReplayResult:replay
                                              vaultId:genesis.vaultId
                                         verifiedAtMs:descendant.verifiedAtMs
                                           checkpoint:&committedA
                                                error:nil];
        });
    dispatch_group_async(
        writers, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
          dispatch_semaphore_wait(writerStart, DISPATCH_TIME_FOREVER);
          writerB =
              [secondStore commitVerifiedReplayResult:challengerReplay
                                              vaultId:genesis.vaultId
                                         verifiedAtMs:challenger.verifiedAtMs
                                           checkpoint:&committedB
                                                error:nil];
        });
    dispatch_semaphore_signal(writerStart);
    dispatch_semaphore_signal(writerStart);
    CHECK(dispatch_group_wait(writers, dispatch_time(DISPATCH_TIME_NOW,
                                                     10 * NSEC_PER_SEC)) == 0);
    CHECK((writerA == AncPrivateVaultAuthorityStoreStatusOK &&
           writerB == AncPrivateVaultAuthorityStoreStatusConflict) ||
          (writerB == AncPrivateVaultAuthorityStoreStatusOK &&
           writerA == AncPrivateVaultAuthorityStoreStatusConflict));
    AncPrivateVaultAuthorityCheckpoint *committed =
        writerA == AncPrivateVaultAuthorityStoreStatusOK ? committedA
                                                         : committedB;
    CHECK(committed.custodyGeneration == 2 && committed.snapshot.sequence == 1);
    AncPrivateVaultAuthorityCheckpoint *winner = nil;
    CHECK([store loadVaultId:genesis.vaultId checkpoint:&winner
                       error:nil] == AncPrivateVaultAuthorityStoreStatusOK);
    CHECK([winner.frameDigest isEqualToData:committed.frameDigest]);
    CHECK([winner.snapshot.headHash isEqualToData:committed.snapshot.headHash]);
    NSArray<AuthorityCustodyMutation> *splitMutations = @[
      ^(AncPrivateVaultCustodySnapshot *value) {
        value->vault_id[0] ^= 1;
      },
      ^(AncPrivateVaultCustodySnapshot *value) {
        value->custody_generation += 1;
      },
      ^(AncPrivateVaultCustodySnapshot *value) {
        value->authority_anchor_present = 0;
      },
      ^(AncPrivateVaultCustodySnapshot *value) {
        value->anchored_sequence += 1;
      },
      ^(AncPrivateVaultCustodySnapshot *value) {
        value->anchored_head[0] ^= 1;
      },
      ^(AncPrivateVaultCustodySnapshot *value) {
        value->membership_digest[0] ^= 1;
      },
      ^(AncPrivateVaultCustodySnapshot *value) {
        value->signed_at_ms += 1;
      },
      ^(AncPrivateVaultCustodySnapshot *value) {
        value->freshness_ms += 1;
      },
      ^(AncPrivateVaultCustodySnapshot *value) {
        value->active_epoch += 1;
      },
      ^(AncPrivateVaultCustodySnapshot *value) {
        value->recovery_generation += 1;
      },
      ^(AncPrivateVaultCustodySnapshot *value) {
        value->snapshot_digest[0] ^= 1;
      },
    ];
    for (AuthorityCustodyMutation mutation in splitMutations) {
      AuthorityMutatingRepository *mutating =
          [[AuthorityMutatingRepository alloc] initWithBase:repository
                                                   mutation:mutation];
      AncPrivateVaultAuthorityStore *splitStore =
          [[AncPrivateVaultAuthorityStore alloc]
              initWithStateRootURL:[NSURL fileURLWithPath:temporary
                                              isDirectory:YES]
                 custodyRepository:mutating];
      CHECK([splitStore loadVaultId:genesis.vaultId checkpoint:nil error:nil] !=
            AncPrivateVaultAuthorityStoreStatusOK);
    }
    AncPrivateVaultAuthorityCheckpoint *securityCheck = nil;
    CHECK(chmod(livePath.fileSystemRepresentation, 0644) == 0);
    CHECK([store
              loadVaultId:genesis.vaultId
               checkpoint:&securityCheck
                    error:nil] == AncPrivateVaultAuthorityStoreStatusCorrupt);
    CHECK(chmod(livePath.fileSystemRepresentation, 0600) == 0);
    NSString *aliasPath =
        [authority stringByAppendingPathComponent:@"unexpected-link"];
    CHECK(link(livePath.fileSystemRepresentation,
               aliasPath.fileSystemRepresentation) == 0);
    CHECK([store loadVaultId:genesis.vaultId
                  checkpoint:&securityCheck
                       error:nil] ==
          AncPrivateVaultAuthorityStoreStatusStorageFailed);
    CHECK(unlink(aliasPath.fileSystemRepresentation) == 0);
    NSData *savedLive = [NSData dataWithContentsOfFile:livePath];
    CHECK(unlink(livePath.fileSystemRepresentation) == 0);
    CHECK(symlink("/etc/passwd", livePath.fileSystemRepresentation) == 0);
    CHECK([store
              loadVaultId:genesis.vaultId
               checkpoint:&securityCheck
                    error:nil] == AncPrivateVaultAuthorityStoreStatusCorrupt);
    CHECK(unlink(livePath.fileSystemRepresentation) == 0);
    CHECK([savedLive writeToFile:livePath atomically:NO]);
    CHECK(chmod(livePath.fileSystemRepresentation, 0600) == 0);
    NSString *movedAuthority = [authority stringByAppendingString:@"-moved"];
    __block BOOL swappedAtReopen = NO;
    __block BOOL swapOperationsOkay = YES;
    AncPrivateVaultAuthoritySetFaultHookForTesting(
        ^BOOL(AncPrivateVaultAuthorityFaultPoint point) {
          if (point != AncPrivateVaultAuthorityFaultBeforeDirectoryReopen ||
              swappedAtReopen)
            return NO;
          swappedAtReopen = YES;
          swapOperationsOkay =
              rename(authority.fileSystemRepresentation,
                     movedAuthority.fileSystemRepresentation) == 0 &&
              [NSFileManager.defaultManager
                        createDirectoryAtPath:authority
                  withIntermediateDirectories:NO
                                   attributes:@{
                                     NSFilePosixPermissions : @0700
                                   }
                                        error:nil];
          return NO;
        });
    CHECK([store
              loadVaultId:genesis.vaultId
               checkpoint:&securityCheck
                    error:nil] == AncPrivateVaultAuthorityStoreStatusCorrupt);
    AncPrivateVaultAuthoritySetFaultHookForTesting(nil);
    CHECK(swappedAtReopen && swapOperationsOkay);
    CHECK([NSFileManager.defaultManager removeItemAtPath:authority error:nil]);
    CHECK(rename(movedAuthority.fileSystemRepresentation,
                 authority.fileSystemRepresentation) == 0);
    __block BOOL listingFaultInvoked = NO;
    AncPrivateVaultAuthoritySetFaultHookForTesting(
        ^BOOL(AncPrivateVaultAuthorityFaultPoint point) {
          if (point == AncPrivateVaultAuthorityFaultDirectoryListingFailure) {
            listingFaultInvoked = YES;
            return YES;
          }
          return NO;
        });
    CHECK([store loadVaultId:genesis.vaultId
                  checkpoint:&securityCheck
                       error:nil] ==
          AncPrivateVaultAuthorityStoreStatusStorageFailed);
    AncPrivateVaultAuthoritySetFaultHookForTesting(nil);
    CHECK(listingFaultInvoked);
    CHECK(rename(authority.fileSystemRepresentation,
                 movedAuthority.fileSystemRepresentation) == 0);
    CHECK([NSFileManager.defaultManager
              createDirectoryAtPath:authority
        withIntermediateDirectories:NO
                         attributes:@{
                           NSFilePosixPermissions : @0700
                         }
                              error:nil]);
    CHECK([store loadVaultId:genesis.vaultId
                  checkpoint:&securityCheck
                       error:nil] ==
          AncPrivateVaultAuthorityStoreStatusStorageFailed);
    CHECK([NSFileManager.defaultManager removeItemAtPath:authority error:nil]);
    CHECK(rename(movedAuthority.fileSystemRepresentation,
                 authority.fileSystemRepresentation) == 0);

    AncPrivateVaultCustodySnapshot terminal;
    AncPrivateVaultCustodyHandle *terminalHandle = nil;
    CHECK([repository readVaultId:genesis.vaultId
                         snapshot:&terminal
                           handle:&terminalHandle] ==
          AncPrivateVaultCustodyRepositoryStatusOK);
    CHECK([terminalHandle close] == AncPrivateVaultCustodyRepositoryStatusOK);
    terminal.custody_generation = 3;
    terminal.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_REMOVING;
    terminal.active_epoch = 0;
    terminal.pending_epoch = 0;
    terminal.removal_sequence = 2;
    AuthorityFill(terminal.removal_head, 32, 0xd1);
    AuthorityFill(terminal.removal_authorization_digest, 32, 0xe1);
    terminal.removal_time_ms = descendant.verifiedAtMs + 1000;
    AuthorityTestSecrets zeroSecrets = {0};
    AncPrivateVaultCustodySecretInputs zeroInputs = {
        .signing_seed = zeroSecrets.signing,
        .box_seed = zeroSecrets.box,
        .local_state_key = zeroSecrets.local,
        .active_epoch_key = zeroSecrets.active,
        .pending_epoch_key = zeroSecrets.pending};
    CHECK([repository storeSnapshot:&terminal
                            secrets:&zeroInputs
                            vaultId:genesis.vaultId] ==
          AncPrivateVaultCustodyRepositoryStatusOK);
    CHECK(unlink(livePath.fileSystemRepresentation) == 0);
    CHECK([store
              loadVaultId:genesis.vaultId
               checkpoint:&securityCheck
                    error:nil] == AncPrivateVaultAuthorityStoreStatusRemoved);
    for (NSInteger point = AncPrivateVaultAuthorityFaultAfterTemporaryWrite;
         point <= AncPrivateVaultAuthorityFaultBeforeFinalReread; point += 1) {
      CHECK(RunAuthorityCrashCase(
                genesis, descendant, DataFromHex(genesisCase[@"canonicalHex"]),
                key, vector[@"vaultDigestHex"],
                (AncPrivateVaultAuthorityFaultPoint)point) == 0);
    }
    CHECK([NSFileManager.defaultManager removeItemAtPath:temporary error:nil]);
    anc_pv_zeroize(&secrets, sizeof secrets);
    anc_pv_zeroize(key.mutableBytes, key.length);
    puts("private-vault authority snapshot and frame corpus passed");
  }
  return 0;
}
