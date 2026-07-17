#import <Foundation/Foundation.h>

#import "PrivateVaultGenerationFence.h"

#include <assert.h>

static NSMutableDictionary<NSString *, NSData *> *gStore;
static NSMutableArray<NSDictionary *> *gQueries;
static NSUInteger gMutationCount;
static NSUInteger gFailBeforeMutation;
static NSUInteger gCommitThenErrorMutation;
static BOOL gCorruptNextCopy;
static BOOL gHideNextCopy;

static NSString *StoreKey(NSDictionary *query) {
  return [NSString stringWithFormat:@"%@|%@",
                                    query[(__bridge id)kSecAttrService],
                                    query[(__bridge id)kSecAttrAccount]];
}

static OSStatus MockCopy(CFDictionaryRef rawQuery, CFTypeRef *result) {
  NSDictionary *query = (__bridge NSDictionary *)rawQuery;
  [gQueries addObject:[query copy]];
  if (gHideNextCopy) {
    gHideNextCopy = NO;
    return errSecItemNotFound;
  }
  NSData *value = gStore[StoreKey(query)];
  if (value == nil) return errSecItemNotFound;
  NSData *returned = value;
  if (gCorruptNextCopy) {
    gCorruptNextCopy = NO;
    NSMutableData *corrupt = [value mutableCopy];
    ((uint8_t *)corrupt.mutableBytes)[0] ^= 1;
    returned = corrupt;
  }
  if (result != NULL) *result = CFBridgingRetain([returned copy]);
  return errSecSuccess;
}

static OSStatus Mutate(NSDictionary *query, NSData *_Nullable value,
                       BOOL deleteValue) {
  gMutationCount += 1;
  if (gFailBeforeMutation == gMutationCount) return errSecInternalComponent;
  NSString *key = StoreKey(query);
  if (deleteValue) {
    if (gStore[key] == nil) return errSecItemNotFound;
    [gStore removeObjectForKey:key];
  } else {
    gStore[key] = [value copy];
  }
  return gCommitThenErrorMutation == gMutationCount ? errSecInternalComponent
                                                     : errSecSuccess;
}

static OSStatus MockAdd(CFDictionaryRef rawAttributes, CFTypeRef *result) {
  (void)result;
  NSDictionary *attributes = (__bridge NSDictionary *)rawAttributes;
  NSString *key = StoreKey(attributes);
  if (gStore[key] != nil) return errSecDuplicateItem;
  return Mutate(attributes, attributes[(__bridge id)kSecValueData], NO);
}

static OSStatus MockUpdate(CFDictionaryRef rawQuery,
                           CFDictionaryRef rawAttributes) {
  NSDictionary *query = (__bridge NSDictionary *)rawQuery;
  if (gStore[StoreKey(query)] == nil) return errSecItemNotFound;
  NSDictionary *attributes = (__bridge NSDictionary *)rawAttributes;
  return Mutate(query, attributes[(__bridge id)kSecValueData], NO);
}

static OSStatus MockDelete(CFDictionaryRef rawQuery) {
  return Mutate((__bridge NSDictionary *)rawQuery, nil, YES);
}

static void Reset(void) {
  gStore = [NSMutableDictionary dictionary];
  gQueries = [NSMutableArray array];
  gMutationCount = 0;
  gFailBeforeMutation = 0;
  gCommitThenErrorMutation = 0;
  gCorruptNextCopy = NO;
  gHideNextCopy = NO;
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

static NSData *Digest(uint8_t value) {
  uint8_t bytes[32];
  memset(bytes, value, sizeof bytes);
  return [NSData dataWithBytes:bytes length:sizeof bytes];
}

static NSString *KeyForService(NSString *service) {
  for (NSString *key in gStore)
    if ([key hasPrefix:[service stringByAppendingString:@"|"]]) return key;
  return nil;
}

static void RecomputeFenceIntegrity(NSMutableData *data) {
  static const char domain[] = "anc/v1/private-vault/generation-fence";
  uint8_t input[sizeof domain + 84];
  memcpy(input, domain, sizeof domain);
  memcpy(input + sizeof domain, data.bytes, 84);
  uint8_t digest[32] = {0};
  assert(anc_pv_blake2b_256(digest, input, sizeof input) == ANC_PV_CRYPTO_OK);
  [data replaceBytesInRange:NSMakeRange(84, 32)
                  withBytes:digest
                     length:32];
  anc_pv_zeroize(input, sizeof input);
  anc_pv_zeroize(digest, sizeof digest);
}

static NSData *FenceIdentity(BOOL includeTerminatingNul) {
  static const char domain[] =
      "anc/v1/private-vault/generation-fence-identity";
  NSMutableData *input = [NSMutableData
      dataWithBytes:domain
             length:includeTerminatingNul ? sizeof domain : sizeof domain - 1];
  NSData *vault = [@"v" dataUsingEncoding:NSUTF8StringEncoding];
  NSData *record = [@"custody" dataUsingEncoding:NSUTF8StringEncoding];
  uint32_t vaultLength = CFSwapInt32HostToBig((uint32_t)vault.length);
  uint32_t recordLength = CFSwapInt32HostToBig((uint32_t)record.length);
  [input appendBytes:&vaultLength length:sizeof vaultLength];
  [input appendData:vault];
  [input appendBytes:&recordLength length:sizeof recordLength];
  [input appendData:record];
  uint8_t digest[32] = {0};
  assert(anc_pv_blake2b_256(digest, input.bytes, input.length) ==
         ANC_PV_CRYPTO_OK);
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static void TestKeychainExactReadback(void) {
  Reset();
  AncPrivateVaultKeychain *keychain = Keychain();
  NSData *one = [@"one" dataUsingEncoding:NSUTF8StringEncoding];
  NSData *two = [@"two" dataUsingEncoding:NSUTF8StringEncoding];
  gCommitThenErrorMutation = 1;
  assert([keychain addData:one
                forService:AncPrivateVaultCustodyService
                   vaultId:@"v"
                  recordId:@"custody"] == AncPrivateVaultKeychainStatusOK);
  NSDictionary *add = gQueries.firstObject;
  assert([add[(__bridge id)kSecAttrSynchronizable] isEqual:@NO]);
  assert([add[(__bridge id)kSecUseDataProtectionKeychain] isEqual:@YES]);
  NSDictionary *readback = gQueries.lastObject;
  LAContext *context = readback[(__bridge id)kSecUseAuthenticationContext];
  assert(context.interactionNotAllowed);
  gCommitThenErrorMutation = 2;
  assert([keychain updateData:two
                   forService:AncPrivateVaultCustodyService
                      vaultId:@"v"
                     recordId:@"custody"] == AncPrivateVaultKeychainStatusOK);
  gCommitThenErrorMutation = 3;
  assert([keychain deleteDataForService:AncPrivateVaultCustodyService
                                 vaultId:@"v"
                                recordId:@"custody"] ==
         AncPrivateVaultKeychainStatusOK);
  NSData *missing = nil;
  assert([keychain copyDataForService:AncPrivateVaultCustodyService
                              vaultId:@"v"
                             recordId:@"custody"
                                 data:&missing] ==
         AncPrivateVaultKeychainStatusNotFound);
  gCorruptNextCopy = YES;
  assert([keychain addData:one
                forService:AncPrivateVaultCustodyStageService
                   vaultId:@"v"
                  recordId:@"custody"] ==
         AncPrivateVaultKeychainStatusCorrupt);
  gHideNextCopy = YES;
  assert([keychain addData:one
                forService:AncPrivateVaultCustodyService
                   vaultId:@"missing-readback"
                  recordId:@"custody"] ==
         AncPrivateVaultKeychainStatusFailed);
}

static void TestDigestBoundTransitions(void) {
  Reset();
  AncPrivateVaultGenerationFence *fence =
      [[AncPrivateVaultGenerationFence alloc] initWithKeychain:Keychain()];
  NSData *a = Digest(0x11);
  NSData *b = Digest(0x22);
  assert([fence beginGeneration:1
                   recordDigest:a
                        vaultId:@"v"
                       recordId:@"custody"] == AncPrivateVaultFenceStatusOK);
  AncPrivateVaultFenceSnapshot *snapshot = nil;
  assert([fence readVaultId:@"v" recordId:@"custody" snapshot:&snapshot] ==
         AncPrivateVaultFenceStatusOK);
  assert(snapshot.state == AncPrivateVaultFenceStatePending);
  assert(snapshot.generation == 1 && [snapshot.recordDigest isEqualToData:a]);
  assert([fence beginGeneration:1
                   recordDigest:b
                        vaultId:@"v"
                       recordId:@"custody"] ==
         AncPrivateVaultFenceStatusConflict);
  assert([fence commitGeneration:1
                    recordDigest:b
                         vaultId:@"v"
                        recordId:@"custody"] ==
         AncPrivateVaultFenceStatusConflict);
  assert([fence commitGeneration:1
                    recordDigest:a
                         vaultId:@"v"
                        recordId:@"custody"] == AncPrivateVaultFenceStatusOK);
  assert([fence beginGeneration:2
                   recordDigest:b
                        vaultId:@"v"
                       recordId:@"custody"] == AncPrivateVaultFenceStatusOK);
  assert([fence commitGeneration:2
                    recordDigest:b
                         vaultId:@"v"
                        recordId:@"custody"] == AncPrivateVaultFenceStatusOK);
  NSData *frame = gStore[KeyForService(AncPrivateVaultFenceService)];
  assert(frame.length == 116);
  const uint8_t *bytes = frame.bytes;
  assert(memcmp(bytes, "ANPVGF02", 8) == 0 && bytes[8] == 2);
  NSData *identityWithNul = FenceIdentity(YES);
  NSData *identityWithoutNul = FenceIdentity(NO);
  assert(memcmp(bytes + 20, identityWithNul.bytes, 32) == 0);
  assert(![identityWithNul isEqualToData:identityWithoutNul]);
  assert(memcmp(bytes + 52, b.bytes, 32) == 0);
}

static void TestMismatchCorruptionAndMissing(void) {
  Reset();
  AncPrivateVaultGenerationFence *fence =
      [[AncPrivateVaultGenerationFence alloc] initWithKeychain:Keychain()];
  NSData *a = Digest(0x31);
  assert([fence beginGeneration:1
                   recordDigest:a
                        vaultId:@"v"
                       recordId:@"custody"] == AncPrivateVaultFenceStatusOK);
  assert([fence commitGeneration:1
                    recordDigest:a
                         vaultId:@"v"
                        recordId:@"custody"] == AncPrivateVaultFenceStatusOK);
  NSString *highKey = KeyForService(AncPrivateVaultHighWaterService);
  NSMutableData *mismatched = [gStore[highKey] mutableCopy];
  memset((uint8_t *)mismatched.mutableBytes + 52, 0x44, 32);
  RecomputeFenceIntegrity(mismatched);
  gStore[highKey] = mismatched;
  AncPrivateVaultFenceSnapshot *snapshot = nil;
  assert([fence readVaultId:@"v" recordId:@"custody" snapshot:&snapshot] ==
         AncPrivateVaultFenceStatusRollbackDetected);
  [gStore removeObjectForKey:highKey];
  assert([fence readVaultId:@"v" recordId:@"custody" snapshot:&snapshot] ==
         AncPrivateVaultFenceStatusRollbackDetected);
}

static void TestAmbiguousAndInterruptedWrites(void) {
  Reset();
  AncPrivateVaultGenerationFence *fence =
      [[AncPrivateVaultGenerationFence alloc] initWithKeychain:Keychain()];
  NSData *a = Digest(0x51);
  gCommitThenErrorMutation = 1;
  assert([fence beginGeneration:1
                   recordDigest:a
                        vaultId:@"v"
                       recordId:@"custody"] == AncPrivateVaultFenceStatusOK);
  gFailBeforeMutation = gMutationCount + 1;
  assert([fence commitGeneration:1
                    recordDigest:a
                         vaultId:@"v"
                        recordId:@"custody"] != AncPrivateVaultFenceStatusOK);
  gFailBeforeMutation = 0;
  AncPrivateVaultGenerationFence *restarted =
      [[AncPrivateVaultGenerationFence alloc] initWithKeychain:Keychain()];
  assert([restarted commitGeneration:1
                        recordDigest:a
                             vaultId:@"v"
                            recordId:@"custody"] ==
         AncPrivateVaultFenceStatusOK);
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    TestKeychainExactReadback();
    TestDigestBoundTransitions();
    TestMismatchCorruptionAndMissing();
    TestAmbiguousAndInterruptedWrites();
    puts("private-vault generation-fence v2 tests passed");
  }
  return 0;
}
