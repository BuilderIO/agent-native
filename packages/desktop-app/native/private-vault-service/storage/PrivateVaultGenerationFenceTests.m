#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>
#import <objc/runtime.h>

#include <assert.h>
#include <stdio.h>

#import "PrivateVaultGenerationFence.h"
#import "PrivateVaultCrypto.h"

static NSMutableDictionary<NSString *, NSData *> *gStore;
static NSMutableArray<NSDictionary *> *gCopyQueries;
static NSMutableArray<NSDictionary *> *gAddQueries;
static NSMutableArray<NSDictionary *> *gUpdateQueries;
static NSMutableArray<NSDictionary *> *gDeleteQueries;
static NSMutableArray<LAContext *> *gContexts;
static OSStatus gCopyFailure;
static OSStatus gAddFailure;
static OSStatus gUpdateFailure;
static BOOL gCommitThenFailAdd;
static BOOL gCommitThenFailUpdate;
static NSUInteger gAddCalls;
static NSUInteger gUpdateCalls;
static NSUInteger gFailAddCall;
static NSUInteger gFailUpdateCall;

static NSString *StoreKey(NSDictionary *query) {
  NSString *service = query[(__bridge id)kSecAttrService];
  NSString *account = query[(__bridge id)kSecAttrAccount];
  return [NSString stringWithFormat:@"%@|%@", service, account];
}

static OSStatus MockCopy(CFDictionaryRef rawQuery, CFTypeRef *result) {
  NSDictionary *query = (__bridge NSDictionary *)rawQuery;
  [gCopyQueries addObject:[query copy]];
  if (gCopyFailure != errSecSuccess) {
    OSStatus failure = gCopyFailure;
    gCopyFailure = errSecSuccess;
    return failure;
  }
  NSData *value = gStore[StoreKey(query)];
  if (value == nil) return errSecItemNotFound;
  if (result != NULL) *result = CFBridgingRetain([value copy]);
  return errSecSuccess;
}

static OSStatus MockAdd(CFDictionaryRef rawAttributes, CFTypeRef *result) {
  (void)result;
  NSDictionary *attributes = (__bridge NSDictionary *)rawAttributes;
  gAddCalls += 1;
  [gAddQueries addObject:[attributes copy]];
  NSString *key = StoreKey(attributes);
  if (gStore[key] != nil) return errSecDuplicateItem;
  if (gFailAddCall != 0 && gAddCalls == gFailAddCall) {
    return errSecInternalComponent;
  }
  if (gAddFailure != errSecSuccess && !gCommitThenFailAdd) {
    OSStatus failure = gAddFailure;
    gAddFailure = errSecSuccess;
    return failure;
  }
  gStore[key] = [attributes[(__bridge id)kSecValueData] copy];
  if (gCommitThenFailAdd) {
    gCommitThenFailAdd = NO;
    return errSecInternalComponent;
  }
  return errSecSuccess;
}

static OSStatus MockUpdate(CFDictionaryRef rawQuery,
                           CFDictionaryRef rawAttributes) {
  NSDictionary *query = (__bridge NSDictionary *)rawQuery;
  NSDictionary *attributes = (__bridge NSDictionary *)rawAttributes;
  gUpdateCalls += 1;
  [gUpdateQueries addObject:@{
    @"query" : [query copy],
    @"attributes" : [attributes copy],
  }];
  NSString *key = StoreKey(query);
  if (gStore[key] == nil) return errSecItemNotFound;
  if (gFailUpdateCall != 0 && gUpdateCalls == gFailUpdateCall) {
    return errSecInternalComponent;
  }
  if (gUpdateFailure != errSecSuccess && !gCommitThenFailUpdate) {
    OSStatus failure = gUpdateFailure;
    gUpdateFailure = errSecSuccess;
    return failure;
  }
  gStore[key] = [attributes[(__bridge id)kSecValueData] copy];
  if (gCommitThenFailUpdate) {
    gCommitThenFailUpdate = NO;
    return errSecInternalComponent;
  }
  return errSecSuccess;
}

static OSStatus MockDelete(CFDictionaryRef rawQuery) {
  NSDictionary *query = (__bridge NSDictionary *)rawQuery;
  [gDeleteQueries addObject:[query copy]];
  NSString *key = StoreKey(query);
  if (gStore[key] == nil) return errSecItemNotFound;
  [gStore removeObjectForKey:key];
  return errSecSuccess;
}

static void ResetMock(void) {
  gStore = [NSMutableDictionary dictionary];
  gCopyQueries = [NSMutableArray array];
  gAddQueries = [NSMutableArray array];
  gUpdateQueries = [NSMutableArray array];
  gDeleteQueries = [NSMutableArray array];
  gContexts = [NSMutableArray array];
  gCopyFailure = errSecSuccess;
  gAddFailure = errSecSuccess;
  gUpdateFailure = errSecSuccess;
  gCommitThenFailAdd = NO;
  gCommitThenFailUpdate = NO;
  gAddCalls = 0;
  gUpdateCalls = 0;
  gFailAddCall = 0;
  gFailUpdateCall = 0;
}

static AncPrivateVaultKeychain *MakeKeychain(void) {
  AncPrivateVaultSecItemFunctions functions = {
      .copyMatching = MockCopy,
      .add = MockAdd,
      .update = MockUpdate,
      .deleteItem = MockDelete,
  };
  return [[AncPrivateVaultKeychain alloc]
      initWithFunctions:functions
          contextFactory:^LAContext * {
            LAContext *context = [[LAContext alloc] init];
            [gContexts addObject:context];
            return context;
          }];
}

static AncPrivateVaultGenerationFence *MakeFence(void) {
  return [[AncPrivateVaultGenerationFence alloc]
      initWithKeychain:MakeKeychain()];
}

static void AssertKeys(NSDictionary *dictionary,
                       NSArray<id> *expectedKeys) {
  NSSet *actual = [NSSet setWithArray:dictionary.allKeys];
  NSSet *expected = [NSSet setWithArray:expectedKeys];
  assert([actual isEqualToSet:expected]);
  assert(dictionary[(__bridge id)kSecAttrLabel] == nil);
  assert(dictionary[(__bridge id)kSecAttrDescription] == nil);
  assert(dictionary[(__bridge id)kSecAttrComment] == nil);
}

static void AssertBase(NSDictionary *dictionary, NSString *service) {
  assert([dictionary[(__bridge id)kSecClass]
      isEqual:(__bridge id)kSecClassGenericPassword]);
  assert([dictionary[(__bridge id)kSecAttrService] isEqual:service]);
  assert([dictionary[(__bridge id)kSecAttrAccessGroup]
      isEqual:AncPrivateVaultKeychainAccessGroup]);
  assert([dictionary[(__bridge id)kSecAttrSynchronizable]
      isEqual:@NO]);
  assert([dictionary[(__bridge id)kSecUseDataProtectionKeychain]
      isEqual:@YES]);
  NSString *account = dictionary[(__bridge id)kSecAttrAccount];
  assert(account.length == 64);
  NSCharacterSet *notLowerHex =
      [[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"]
          invertedSet];
  assert([account rangeOfCharacterFromSet:notLowerHex].location == NSNotFound);
}

static NSString *KeyForService(NSString *service) {
  for (NSString *key in gStore) {
    if ([key hasPrefix:[service stringByAppendingString:@"|"]]) return key;
  }
  return nil;
}

static NSString *Hex(NSData *data) {
  static const char characters[] = "0123456789abcdef";
  NSMutableString *result = [NSMutableString stringWithCapacity:data.length * 2];
  const uint8_t *bytes = data.bytes;
  for (NSUInteger index = 0; index < data.length; ++index) {
    [result appendFormat:@"%c%c", characters[bytes[index] >> 4],
                         characters[bytes[index] & 0x0f]];
  }
  return result;
}

static void TestExactKeychainQueries(void) {
  ResetMock();
  AncPrivateVaultKeychain *keychain = MakeKeychain();
  NSData *value = [@"record" dataUsingEncoding:NSUTF8StringEncoding];
  assert([keychain addData:value
                forService:AncPrivateVaultFenceService
                   vaultId:@"vault"
                  recordId:@"record"] == AncPrivateVaultKeychainStatusOK);
  NSDictionary *add = gAddQueries.lastObject;
  AssertBase(add, AncPrivateVaultFenceService);
  assert([add[(__bridge id)kSecAttrAccount]
      isEqualToString:
          @"ac4b25607175e893511228cf095704d4e5fecf87a0063b7a645bce2a95ebc42c"]);
  AssertKeys(add, @[
    (__bridge id)kSecClass, (__bridge id)kSecAttrService,
    (__bridge id)kSecAttrAccount, (__bridge id)kSecAttrAccessGroup,
    (__bridge id)kSecAttrSynchronizable,
    (__bridge id)kSecUseDataProtectionKeychain,
    (__bridge id)kSecAttrAccessible, (__bridge id)kSecValueData,
  ]);
  assert([add[(__bridge id)kSecAttrAccessible]
      isEqual:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]);

  NSData *copied = nil;
  assert([keychain copyDataForService:AncPrivateVaultFenceService
                              vaultId:@"vault"
                             recordId:@"record"
                                 data:&copied] == AncPrivateVaultKeychainStatusOK);
  assert([copied isEqualToData:value]);
  NSDictionary *copy = gCopyQueries.lastObject;
  AssertBase(copy, AncPrivateVaultFenceService);
  AssertKeys(copy, @[
    (__bridge id)kSecClass, (__bridge id)kSecAttrService,
    (__bridge id)kSecAttrAccount, (__bridge id)kSecAttrAccessGroup,
    (__bridge id)kSecAttrSynchronizable,
    (__bridge id)kSecUseDataProtectionKeychain, (__bridge id)kSecReturnData,
    (__bridge id)kSecMatchLimit, (__bridge id)kSecUseAuthenticationContext,
  ]);
  LAContext *context = copy[(__bridge id)kSecUseAuthenticationContext];
  assert(context.interactionNotAllowed);

  NSData *updated = [@"updated" dataUsingEncoding:NSUTF8StringEncoding];
  assert([keychain updateData:updated
                   forService:AncPrivateVaultFenceService
                      vaultId:@"vault"
                     recordId:@"record"] == AncPrivateVaultKeychainStatusOK);
  NSDictionary *update = gUpdateQueries.lastObject;
  AssertBase(update[@"query"], AncPrivateVaultFenceService);
  AssertKeys(update[@"query"], @[
    (__bridge id)kSecClass, (__bridge id)kSecAttrService,
    (__bridge id)kSecAttrAccount, (__bridge id)kSecAttrAccessGroup,
    (__bridge id)kSecAttrSynchronizable,
    (__bridge id)kSecUseDataProtectionKeychain,
  ]);
  AssertKeys(update[@"attributes"], @[(__bridge id)kSecValueData]);

  assert([keychain deleteDataForService:AncPrivateVaultFenceService
                                 vaultId:@"vault"
                                recordId:@"record"] ==
         AncPrivateVaultKeychainStatusOK);
  AssertBase(gDeleteQueries.lastObject, AncPrivateVaultFenceService);
  AssertKeys(gDeleteQueries.lastObject, @[
    (__bridge id)kSecClass, (__bridge id)kSecAttrService,
    (__bridge id)kSecAttrAccount, (__bridge id)kSecAttrAccessGroup,
    (__bridge id)kSecAttrSynchronizable,
    (__bridge id)kSecUseDataProtectionKeychain,
  ]);

  assert([keychain copyDataForService:AncPrivateVaultFenceService
                              vaultId:@"vault"
                             recordId:@"record"
                                 data:NULL] == AncPrivateVaultKeychainStatusInvalid);
  NSMutableData *oversized = [NSMutableData dataWithLength:2049];
  assert([keychain addData:oversized
                forService:AncPrivateVaultFenceService
                   vaultId:@"vault"
                  recordId:@"record"] == AncPrivateVaultKeychainStatusInvalid);
  assert([keychain addData:value
                forService:AncPrivateVaultFenceService
                   vaultId:@"second-vault"
                  recordId:@"record"] == AncPrivateVaultKeychainStatusOK);
  assert([keychain addData:value
                forService:AncPrivateVaultFenceService
                   vaultId:@"second-vault"
                  recordId:@"record"] == AncPrivateVaultKeychainStatusDuplicate);
  gCopyFailure = errSecDecode;
  assert([keychain copyDataForService:AncPrivateVaultFenceService
                              vaultId:@"second-vault"
                             recordId:@"record"
                                 data:&copied] == AncPrivateVaultKeychainStatusCorrupt);
}

static void TestOpaqueAccounts(void) {
  ResetMock();
  AncPrivateVaultKeychain *keychain = MakeKeychain();
  NSData *value = [@"x" dataUsingEncoding:NSUTF8StringEncoding];
  assert([keychain addData:value
                forService:AncPrivateVaultFenceService
                   vaultId:@"private-vault-name"
                  recordId:@"revealing-record"] == AncPrivateVaultKeychainStatusOK);
  NSString *first = gAddQueries.lastObject[(__bridge id)kSecAttrAccount];
  [gStore removeAllObjects];
  assert([keychain addData:value
                forService:AncPrivateVaultHighWaterService
                   vaultId:@"private-vault-name"
                  recordId:@"revealing-record"] == AncPrivateVaultKeychainStatusOK);
  NSString *second = gAddQueries.lastObject[(__bridge id)kSecAttrAccount];
  assert(![first isEqualToString:second]);
  assert([first rangeOfString:@"vault"].location == NSNotFound);
  assert([first rangeOfString:@"record"].location == NSNotFound);
}

static void TestOpaqueFenceRecordsAndCaps(void) {
  ResetMock();
  AncPrivateVaultGenerationFence *fence = MakeFence();
  NSString *vaultId = @"user-visible-private-vault";
  NSString *recordId = @"user-visible-record-name";
  assert([fence beginGeneration:1 vaultId:vaultId recordId:recordId] ==
         AncPrivateVaultFenceStatusOK);
  NSData *vaultBytes = [vaultId dataUsingEncoding:NSUTF8StringEncoding];
  NSData *recordBytes = [recordId dataUsingEncoding:NSUTF8StringEncoding];
  for (NSData *value in gStore.allValues) {
    assert([value rangeOfData:vaultBytes
                      options:0
                        range:NSMakeRange(0, value.length)].location ==
           NSNotFound);
    assert([value rangeOfData:recordBytes
                      options:0
                        range:NSMakeRange(0, value.length)].location ==
           NSNotFound);
  }
  NSString *oversized = [@"x" stringByPaddingToLength:513
                                           withString:@"x"
                                      startingAtIndex:0];
  assert([fence beginGeneration:1 vaultId:oversized recordId:@"r"] ==
         AncPrivateVaultFenceStatusInvalid);
  assert([fence beginGeneration:0 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusInvalid);
}

static void TestTransitionsAndRestart(void) {
  ResetMock();
  AncPrivateVaultGenerationFence *fence = MakeFence();
  AncPrivateVaultFenceSnapshot *snapshot = nil;
  assert([fence readVaultId:@"v" recordId:@"r" snapshot:&snapshot] ==
         AncPrivateVaultFenceStatusOK);
  assert(snapshot.state == AncPrivateVaultFenceStateAbsent);
  assert([fence beginGeneration:2 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusConflict);
  assert([fence beginGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  NSString *golden =
      @"414e5056474630310101000000000000000000010bb2e58735049e3f7c69240be252"
      @"bf20eb7fd0bf6bce7859bcaf671bca20dae39fe2430e888386a1519ee34185e959"
      @"e7eb37306b78ec964ecf4c6777224ed8a3";
  assert([[Hex(gStore[KeyForService(AncPrivateVaultFenceService)])
      lowercaseString] isEqualToString:golden]);
  assert([[Hex(gStore[KeyForService(AncPrivateVaultHighWaterService)])
      lowercaseString] isEqualToString:golden]);
  assert([fence beginGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  assert([fence commitGeneration:2 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusConflict);
  assert([fence commitGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  assert([fence commitGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  assert([fence beginGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusConflict);
  assert([fence beginGeneration:2 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  assert([fence beginGeneration:3 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusConflict);
  assert([fence commitGeneration:2 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);

  AncPrivateVaultGenerationFence *restarted = MakeFence();
  assert([restarted readVaultId:@"v" recordId:@"r" snapshot:&snapshot] ==
         AncPrivateVaultFenceStatusOK);
  assert(snapshot.state == AncPrivateVaultFenceStateStable);
  assert(snapshot.generation == 2);
  assert([restarted beginGeneration:3 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
}

static void TestAmbiguousCommittedWrites(void) {
  ResetMock();
  AncPrivateVaultGenerationFence *fence = MakeFence();
  gCommitThenFailAdd = YES;
  assert([fence beginGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  gCommitThenFailUpdate = YES;
  assert([fence commitGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  gCommitThenFailUpdate = YES;
  assert([fence beginGeneration:2 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
}

static void TestCrashRecoveryAtEveryWriteBoundary(void) {
  ResetMock();
  AncPrivateVaultGenerationFence *fence = MakeFence();
  gFailAddCall = 1;  // no item durable; restart remains clean initialization.
  assert([fence beginGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusFailed);
  gFailAddCall = 0;
  gAddCalls = 0;
  fence = MakeFence();
  gFailAddCall = 2;  // high-water pending(1) durable; fence absent.
  assert([fence beginGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusFailed);
  gFailAddCall = 0;
  AncPrivateVaultGenerationFence *restarted = MakeFence();
  assert([restarted beginGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  restarted = MakeFence();  // both pending(1) survive restart.
  assert([restarted beginGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);

  gUpdateCalls = 0;
  gFailUpdateCall = 1;  // neither commit write took effect.
  assert([restarted commitGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusConflict);
  gFailUpdateCall = 0;

  gUpdateCalls = 0;
  gFailUpdateCall = 2;  // fence stable(1); high-water pending(1).
  assert([restarted commitGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusConflict);
  gFailUpdateCall = 0;
  AncPrivateVaultFenceSnapshot *snapshot = nil;
  assert([restarted readVaultId:@"v" recordId:@"r" snapshot:&snapshot] ==
         AncPrivateVaultFenceStatusOK);
  assert(snapshot.state == AncPrivateVaultFenceStateStable);
  assert(snapshot.generation == 1);
  restarted = MakeFence();
  assert([restarted commitGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  restarted = MakeFence();  // both stable(1) survive restart.
  assert([restarted commitGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);

  gUpdateCalls = 0;
  gFailUpdateCall = 1;  // neither begin(2) write took effect.
  assert([restarted beginGeneration:2 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusConflict);
  gFailUpdateCall = 0;
  gUpdateCalls = 0;
  gFailUpdateCall = 2;  // high-water pending(2); fence stable(1).
  assert([restarted beginGeneration:2 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusConflict);
  gFailUpdateCall = 0;
  assert([restarted readVaultId:@"v" recordId:@"r" snapshot:&snapshot] ==
         AncPrivateVaultFenceStatusOK);
  assert(snapshot.state == AncPrivateVaultFenceStatePending);
  assert(snapshot.generation == 2);
  restarted = MakeFence();
  assert([restarted beginGeneration:2 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  restarted = MakeFence();  // both pending(2) survive restart.
  assert([restarted beginGeneration:2 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  assert([restarted commitGeneration:2 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
}

static void TestRollbackMismatch(void) {
  ResetMock();
  AncPrivateVaultGenerationFence *fence = MakeFence();
  assert([fence beginGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  assert([fence commitGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  NSString *fenceKey = KeyForService(AncPrivateVaultFenceService);
  NSString *highKey = KeyForService(AncPrivateVaultHighWaterService);
  NSData *oldFence = [gStore[fenceKey] copy];
  NSData *oldHigh = [gStore[highKey] copy];
  assert([fence beginGeneration:2 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  assert([fence commitGeneration:2 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  NSData *currentFence = [gStore[fenceKey] copy];
  gStore[fenceKey] = oldFence;
  AncPrivateVaultFenceSnapshot *snapshot = nil;
  assert([fence readVaultId:@"v" recordId:@"r" snapshot:&snapshot] ==
         AncPrivateVaultFenceStatusRollbackDetected);
  gStore[fenceKey] = currentFence;
  gStore[highKey] = oldHigh;
  assert([fence readVaultId:@"v" recordId:@"r" snapshot:&snapshot] ==
         AncPrivateVaultFenceStatusRollbackDetected);
}

static void TestCorruptionSwapAndMissing(void) {
  ResetMock();
  AncPrivateVaultGenerationFence *fence = MakeFence();
  assert([fence beginGeneration:1 vaultId:@"v1" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  assert([fence commitGeneration:1 vaultId:@"v1" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  NSData *v1Fence = [gStore[KeyForService(AncPrivateVaultFenceService)] copy];
  NSData *v1High = [gStore[KeyForService(AncPrivateVaultHighWaterService)] copy];

  NSString *fenceKey = KeyForService(AncPrivateVaultFenceService);
  NSString *highKey = KeyForService(AncPrivateVaultHighWaterService);
  gStore[fenceKey] = [v1Fence subdataWithRange:NSMakeRange(0, v1Fence.length - 1)];
  AncPrivateVaultFenceSnapshot *snapshot = nil;
  assert([fence readVaultId:@"v1" recordId:@"r" snapshot:&snapshot] ==
         AncPrivateVaultFenceStatusCorrupt);
  gStore[fenceKey] = v1Fence;
  NSMutableData *tampered = [v1Fence mutableCopy];
  ((uint8_t *)tampered.mutableBytes)[12] ^= 1;
  gStore[fenceKey] = tampered;
  assert([fence readVaultId:@"v1" recordId:@"r" snapshot:&snapshot] ==
         AncPrivateVaultFenceStatusCorrupt);
  gStore[fenceKey] = v1Fence;
  gStore[fenceKey] = [NSMutableData dataWithLength:2049];
  assert([fence readVaultId:@"v1" recordId:@"r" snapshot:&snapshot] ==
         AncPrivateVaultFenceStatusCorrupt);
  gStore[fenceKey] = v1Fence;

  assert([fence beginGeneration:1 vaultId:@"v2" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  NSString *v2FenceKey = nil;
  NSString *v2HighKey = nil;
  for (NSString *key in gStore) {
    if ([key hasPrefix:[AncPrivateVaultFenceService stringByAppendingString:@"|"]] &&
        ![key isEqual:fenceKey]) v2FenceKey = key;
    if ([key hasPrefix:[AncPrivateVaultHighWaterService stringByAppendingString:@"|"]] &&
        ![key isEqual:highKey]) v2HighKey = key;
  }
  assert(v2FenceKey != nil && v2HighKey != nil);
  gStore[v2FenceKey] = v1Fence;
  gStore[v2HighKey] = v1High;
  assert([fence readVaultId:@"v2" recordId:@"r" snapshot:&snapshot] ==
         AncPrivateVaultFenceStatusCorrupt);

  ResetMock();
  fence = MakeFence();
  assert([fence beginGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  assert([fence commitGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
  [gStore removeObjectForKey:KeyForService(AncPrivateVaultFenceService)];
  assert([fence readVaultId:@"v" recordId:@"r" snapshot:&snapshot] ==
         AncPrivateVaultFenceStatusRollbackDetected);
}

static void TestNoUIAndContentFreeFailures(void) {
  ResetMock();
  AncPrivateVaultGenerationFence *fence = MakeFence();
  gCopyFailure = errSecInteractionNotAllowed;
  assert([fence beginGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusInaccessible);
  for (LAContext *context in gContexts) assert(context.interactionNotAllowed);
  assert(gContexts.count >= 1);
  if (gContexts.count >= 2) assert(gContexts[0] != gContexts[1]);
  assert(![fence respondsToSelector:NSSelectorFromString(@"deleteGeneration:")]);
  assert(![fence respondsToSelector:NSSelectorFromString(@"deleteVaultId:recordId:")]);
  assert([fence readVaultId:@"v" recordId:@"r" snapshot:NULL] ==
         AncPrivateVaultFenceStatusInvalid);
  assert(NSStringFromClass([AncPrivateVaultGenerationFence class]).length > 0);
}

static void TestConcurrentSerialization(void) {
  ResetMock();
  AncPrivateVaultGenerationFence *fence = MakeFence();
  __block int failures = 0;
  dispatch_apply(32, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0),
                 ^(size_t index) {
                   (void)index;
                   if ([fence beginGeneration:1 vaultId:@"v" recordId:@"r"] !=
                       AncPrivateVaultFenceStatusOK) {
                     @synchronized(fence) { failures += 1; }
                   }
                 });
  assert(failures == 0);
  assert([fence commitGeneration:1 vaultId:@"v" recordId:@"r"] ==
         AncPrivateVaultFenceStatusOK);
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    TestExactKeychainQueries();
    TestOpaqueAccounts();
    TestOpaqueFenceRecordsAndCaps();
    TestTransitionsAndRestart();
    TestAmbiguousCommittedWrites();
    TestCrashRecoveryAtEveryWriteBoundary();
    TestRollbackMismatch();
    TestCorruptionSwapAndMissing();
    TestNoUIAndContentFreeFailures();
    TestConcurrentSerialization();
    puts("private-vault generation-fence tests passed");
  }
  return 0;
}
