#import <Foundation/Foundation.h>

#import "PrivateVaultCrypto.h"
#import "PrivateVaultRecoveryPreparationStore.h"
#import "PrivateVaultRecoveryPreparationStoreInternal.h"

#include <assert.h>
#include <stdio.h>

static NSMutableDictionary<NSString *, NSData *> *gItems;
static NSString *Key(NSDictionary *query) {
  return [NSString
      stringWithFormat:@"%@|%@", query[(__bridge id)kSecAttrService],
                       query[(__bridge id)kSecAttrAccount]];
}
static OSStatus CopyItem(CFDictionaryRef raw, CFTypeRef *result) {
  NSData *value = gItems[Key((__bridge NSDictionary *)raw)];
  if (value == nil)
    return errSecItemNotFound;
  if (result != NULL)
    *result = CFBridgingRetain([value copy]);
  return errSecSuccess;
}
static OSStatus AddItem(CFDictionaryRef raw, CFTypeRef *result) {
  (void)result;
  NSDictionary *attributes = (__bridge NSDictionary *)raw;
  NSString *key = Key(attributes);
  if (gItems[key] != nil)
    return errSecDuplicateItem;
  NSData *value = attributes[(__bridge id)kSecValueData];
  gItems[key] = [NSData dataWithBytes:value.bytes length:value.length];
  return errSecSuccess;
}
static OSStatus UpdateItem(CFDictionaryRef rawQuery,
                           CFDictionaryRef rawAttributes) {
  NSString *key = Key((__bridge NSDictionary *)rawQuery);
  if (gItems[key] == nil)
    return errSecItemNotFound;
  NSDictionary *attributes = (__bridge NSDictionary *)rawAttributes;
  NSData *value = attributes[(__bridge id)kSecValueData];
  gItems[key] = [NSData dataWithBytes:value.bytes length:value.length];
  return errSecSuccess;
}
static OSStatus DeleteItem(CFDictionaryRef raw) {
  NSString *key = Key((__bridge NSDictionary *)raw);
  if (gItems[key] == nil)
    return errSecItemNotFound;
  [gItems removeObjectForKey:key];
  return errSecSuccess;
}
static AncPrivateVaultRecoveryPreparationStore *Store(void) {
  AncPrivateVaultSecItemFunctions functions = {
      .copyMatching = CopyItem,
      .add = AddItem,
      .update = UpdateItem,
      .deleteItem = DeleteItem,
  };
  AncPrivateVaultKeychain *keychain =
      [[AncPrivateVaultKeychain alloc] initWithFunctions:functions
                                          contextFactory:^LAContext * {
                                            return [[LAContext alloc] init];
                                          }];
  return [[AncPrivateVaultRecoveryPreparationStore alloc]
      initWithKeychain:keychain];
}
static void Pattern(uint8_t *bytes, size_t length, uint8_t start) {
  for (size_t index = 0; index < length; index += 1)
    bytes[index] = (uint8_t)(start + index);
}
static NSString *Hex(const uint8_t bytes[16]) {
  NSMutableString *value = [NSMutableString stringWithCapacity:32];
  for (size_t index = 0; index < 16; index += 1)
    [value appendFormat:@"%02x", bytes[index]];
  return value;
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    gItems = [NSMutableDictionary dictionary];
    AncPrivateVaultRecoveryPreparationStore *store = Store();
    AncPrivateVaultRecoveryPreparationSnapshot snapshot = {0};
    Pattern(snapshot.vault_id, 16, 1);
    Pattern(snapshot.lookup_id, 16, 17);
    Pattern(snapshot.ceremony_id, 16, 33);
    Pattern(snapshot.candidate_endpoint_id, 16, 49);
    Pattern(snapshot.artifact_digest, 32, 65);
    snapshot.verified_at_ms = UINT64_C(1721200060000);
    snapshot.next_epoch = 7;
    snapshot.replacement_recovery_generation = 4;
    snapshot.expected_next_sequence = 19;
    Pattern(snapshot.expected_previous_head, 32, 97);
    Pattern(snapshot.recovery_authorization_hash, 32, 129);
    Pattern(snapshot.entry_id, 16, 161);
    Pattern(snapshot.entry_hash, 32, 177);
    Pattern(snapshot.recovery_wrap_hash, 32, 209);
    Pattern(snapshot.candidate_signing_public_key, 32, 7);
    Pattern(snapshot.candidate_key_agreement_public_key, 32, 39);
    snapshot.recovery_wrap_byte_length = 512;
    Pattern(snapshot.artifact_commitment, 32, 71);
    uint8_t signing[32], box[32], local[32], eek[32];
    Pattern(signing, 32, 3);
    Pattern(box, 32, 35);
    Pattern(local, 32, 67);
    Pattern(eek, 32, 99);
    AncPrivateVaultRecoveryPreparationSecretInputs secrets = {
        .endpoint_signing_seed = signing,
        .endpoint_box_seed = box,
        .local_state_key = local,
        .eek = eek,
    };
    AncPrivateVaultRecoveryPreparationStoreStatus created =
        [store createSnapshot:&snapshot secrets:&secrets];
    if (created != AncPrivateVaultRecoveryPreparationStoreStatusOK)
      fprintf(stderr, "recovery preparation create status: %ld\n",
              (long)created);
    if (created != AncPrivateVaultRecoveryPreparationStoreStatusOK)
      fprintf(stderr, "recovery preparation item count: %lu\n",
              (unsigned long)gItems.count);
    assert(created == AncPrivateVaultRecoveryPreparationStoreStatusOK);
    assert([store createSnapshot:&snapshot secrets:&secrets] ==
           AncPrivateVaultRecoveryPreparationStoreStatusOK);
    NSString *vaultId = Hex(snapshot.vault_id);
    AncPrivateVaultRecoveryPreparationSnapshot observed = {0};
    AncPrivateVaultRecoveryPreparationSecretsHandle *handle = nil;
    assert([store readVaultId:vaultId snapshot:&observed handle:&handle] ==
           AncPrivateVaultRecoveryPreparationStoreStatusOK);
    assert(memcmp(&snapshot, &observed, sizeof snapshot) == 0);
    const uint8_t *signingExpected = signing;
    const uint8_t *boxExpected = box;
    const uint8_t *localExpected = local;
    const uint8_t *eekExpected = eek;
    __block BOOL exact = NO;
    assert([handle
               borrow:^BOOL(
                   const AncPrivateVaultRecoveryPreparationSecretInputs *value) {
                 exact = memcmp(value->endpoint_signing_seed,
                                signingExpected, 32) == 0 &&
                         memcmp(value->endpoint_box_seed, boxExpected, 32) ==
                             0 &&
                         memcmp(value->local_state_key, localExpected, 32) ==
                             0 &&
                         memcmp(value->eek, eekExpected, 32) == 0;
                 return exact;
               }] == AncPrivateVaultRecoveryPreparationStoreStatusOK);
    assert(exact && [handle close] ==
                        AncPrivateVaultRecoveryPreparationStoreStatusOK &&
           handle.isClosed);
    AncPrivateVaultRecoveryPreparationEvidence *evidence = nil;
    assert([store readEvidenceVaultId:vaultId evidence:&evidence handle:nil] ==
           AncPrivateVaultRecoveryPreparationStoreStatusOK);
    AncPrivateVaultRecoveryPreparationSnapshot evidenceSnapshot = {0};
    assert(AncPrivateVaultRecoveryPreparationEvidenceCopySnapshot(
               evidence, &evidenceSnapshot) &&
           memcmp(&snapshot, &evidenceSnapshot, sizeof snapshot) == 0);
    assert(!AncPrivateVaultRecoveryPreparationEvidenceCopySnapshot(
        (id)[NSObject new], &evidenceSnapshot));
    AncPrivateVaultRecoveryPreparationSnapshot conflict = snapshot;
    conflict.expected_next_sequence += 1;
    AncPrivateVaultRecoveryPreparationStoreStatus conflictStatus =
        [store createSnapshot:&conflict secrets:&secrets];
    if (conflictStatus != AncPrivateVaultRecoveryPreparationStoreStatusConflict)
      fprintf(stderr, "recovery preparation conflict status: %ld\n",
              (long)conflictStatus);
    assert(conflictStatus ==
           AncPrivateVaultRecoveryPreparationStoreStatusConflict);
    NSMutableData *corrupt = [gItems.allValues.firstObject mutableCopy];
    ((uint8_t *)corrupt.mutableBytes)[144] ^= 1;
    gItems[gItems.allKeys.firstObject] = corrupt;
    assert([store readVaultId:vaultId snapshot:&observed handle:nil] ==
           AncPrivateVaultRecoveryPreparationStoreStatusCorrupt);
    assert([store deleteVaultId:vaultId] ==
           AncPrivateVaultRecoveryPreparationStoreStatusOK);
    assert([store deleteVaultId:vaultId] ==
           AncPrivateVaultRecoveryPreparationStoreStatusOK);
    assert([store readVaultId:vaultId snapshot:&observed handle:nil] ==
           AncPrivateVaultRecoveryPreparationStoreStatusNotFound);
    anc_pv_zeroize(signing, sizeof signing);
    anc_pv_zeroize(box, sizeof box);
    anc_pv_zeroize(local, sizeof local);
    anc_pv_zeroize(eek, sizeof eek);
  }
  puts("private-vault recovery preparation store tests passed");
  return 0;
}
