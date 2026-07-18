#import <Foundation/Foundation.h>

#import "PrivateVaultEnrollmentCoordinator.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultEnrollmentOffer.h"

#include <assert.h>

static NSMutableDictionary<NSString *, NSData *> *gStore;

static NSString *Key(NSDictionary *query) {
  return [NSString stringWithFormat:@"%@|%@", query[(__bridge id)kSecAttrService],
                                    query[(__bridge id)kSecAttrAccount]];
}
static OSStatus Copy(CFDictionaryRef raw, CFTypeRef *result) {
  NSData *value = gStore[Key((__bridge NSDictionary *)raw)];
  if (value == nil)
    return errSecItemNotFound;
  if (result != NULL)
    *result = CFBridgingRetain([value copy]);
  return errSecSuccess;
}
static OSStatus Add(CFDictionaryRef raw, CFTypeRef *result) {
  (void)result;
  NSDictionary *attributes = (__bridge NSDictionary *)raw;
  NSString *key = Key(attributes);
  if (gStore[key] != nil)
    return errSecDuplicateItem;
  NSData *value = attributes[(__bridge id)kSecValueData];
  gStore[key] = [NSData dataWithBytes:value.bytes length:value.length];
  return errSecSuccess;
}
static OSStatus Update(CFDictionaryRef rawQuery, CFDictionaryRef rawAttributes) {
  NSDictionary *query = (__bridge NSDictionary *)rawQuery;
  NSString *key = Key(query);
  if (gStore[key] == nil)
    return errSecItemNotFound;
  NSData *value =
      ((__bridge NSDictionary *)rawAttributes)[(__bridge id)kSecValueData];
  gStore[key] = [NSData dataWithBytes:value.bytes length:value.length];
  return errSecSuccess;
}
static OSStatus Delete(CFDictionaryRef raw) {
  NSString *key = Key((__bridge NSDictionary *)raw);
  if (gStore[key] == nil)
    return errSecItemNotFound;
  [gStore removeObjectForKey:key];
  return errSecSuccess;
}
static AncPrivateVaultKeychain *Keychain(void) {
  AncPrivateVaultSecItemFunctions functions = {
      .copyMatching = Copy, .add = Add, .update = Update, .deleteItem = Delete};
  return [[AncPrivateVaultKeychain alloc]
      initWithFunctions:functions
          contextFactory:^LAContext * {
            return [[LAContext alloc] init];
          }
           storageDomain:@"enrollment-coordinator-test"];
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    gStore = [NSMutableDictionary dictionary];
    AncPrivateVaultKeychain *keychain = Keychain();
    AncPrivateVaultCustodyRepository *repository =
        [[AncPrivateVaultCustodyRepository alloc]
            initWithKeychain:keychain
                  recordId:AncPrivateVaultBrokerCustodyRecordId];
    AncPrivateVaultEnrollmentOfferArtifactStore *artifacts =
        [[AncPrivateVaultEnrollmentOfferArtifactStore alloc]
            initWithKeychain:keychain
                    recordId:AncPrivateVaultBrokerCustodyRecordId];
    AncPrivateVaultEnrollmentCoordinator *coordinator =
        [[AncPrivateVaultEnrollmentCoordinator alloc]
            initWithBrokerCustodyRepository:repository
                               artifactStore:artifacts];
    uint8_t vaultBytes[16];
    for (size_t index = 0; index < sizeof vaultBytes; index += 1)
      vaultBytes[index] = (uint8_t)index;
    NSData *vault = [NSData dataWithBytes:vaultBytes length:sizeof vaultBytes];
    AncPrivateVaultEnrollmentCandidate *first = nil;
    assert([coordinator prepareBrokerVaultId:vault
                                  nowSeconds:1721117511
                                   candidate:&first] ==
           AncPrivateVaultEnrollmentCoordinatorStatusOK);
    assert(first != nil && first.endpointId.length == 16 &&
           first.ceremonyId.length == 16 && first.offerHash.length == 32 &&
           first.candidateKeyProof.length == 64);
    AncPrivateVaultEnrollmentCandidate *retry = nil;
    assert([coordinator prepareBrokerVaultId:vault
                                nowSeconds:1721117571
                                 candidate:&retry] ==
           AncPrivateVaultEnrollmentCoordinatorStatusOK);
    assert([retry.encodedOffer isEqualToData:first.encodedOffer] &&
           [retry.candidateKeyProof isEqualToData:first.candidateKeyProof]);
    AncPrivateVaultCustodySnapshot snapshot;
    AncPrivateVaultCustodyHandle *handle = nil;
    assert([repository readVaultId:@"000102030405060708090a0b0c0d0e0f"
                           snapshot:&snapshot
                             handle:&handle] ==
           AncPrivateVaultCustodyRepositoryStatusOK);
    assert(snapshot.role == ANC_PV_CUSTODY_ROLE_BROKER &&
           snapshot.pending_kind == ANC_PV_CUSTODY_PENDING_ADD_BROKER &&
           snapshot.enrollment_phase ==
               ANC_PV_CUSTODY_ENROLLMENT_OFFER_PENDING &&
           snapshot.custody_generation == 1 &&
           memcmp(snapshot.pending_transcript_digest, first.offerHash.bytes,
                  32) == 0);
    __block BOOL secretsMatch = NO;
    AncPrivateVaultCustodyRepositoryStatus borrowed =
        [handle borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *value) {
             uint8_t signingPublic[32] = {0}, signingPrivate[64] = {0};
             uint8_t agreementPublic[32] = {0}, agreementPrivate[32] = {0};
             secretsMatch =
                 anc_pv_ed25519_seed_keypair(signingPublic, signingPrivate,
                                              value->signing_seed) ==
                     ANC_PV_CRYPTO_OK &&
                 anc_pv_box_seed_keypair(agreementPublic, agreementPrivate,
                                          value->box_seed) == ANC_PV_CRYPTO_OK &&
                 memcmp(signingPublic, first.signingPublicKey.bytes, 32) == 0 &&
                 memcmp(agreementPublic, first.keyAgreementPublicKey.bytes,
                        32) == 0;
             anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
             anc_pv_zeroize(agreementPrivate, sizeof agreementPrivate);
             return secretsMatch;
           }];
    assert(borrowed == AncPrivateVaultCustodyRepositoryStatusOK);
    assert([handle close] == AncPrivateVaultCustodyRepositoryStatusOK &&
           secretsMatch);

    NSString *artifactKey = nil;
    for (NSString *key in gStore)
      if ([key hasPrefix:AncPrivateVaultEnrollmentOfferService])
        artifactKey = key;
    assert(artifactKey != nil);
    NSData *artifactBytes = [gStore[artifactKey] copy];
    [gStore removeObjectForKey:artifactKey];
    retry = nil;
    assert([coordinator prepareBrokerVaultId:vault
                                nowSeconds:1721117572
                                 candidate:&retry] ==
               AncPrivateVaultEnrollmentCoordinatorStatusFailed &&
           retry == nil);
    gStore[artifactKey] = artifactBytes;
    NSMutableData *corrupt = [gStore[artifactKey] mutableCopy];
    ((uint8_t *)corrupt.mutableBytes)[corrupt.length - 1] ^= 1;
    gStore[artifactKey] = corrupt;
    retry = nil;
    assert([coordinator prepareBrokerVaultId:vault
                                nowSeconds:1721117573
                                 candidate:&retry] ==
               AncPrivateVaultEnrollmentCoordinatorStatusCorrupt &&
           retry == nil);

    uint8_t orphanVaultBytes[16], endpoint[16], ceremony[16], envelope[16];
    uint8_t nonce[32], signing[32], agreement[32];
    for (size_t index = 0; index < 16; index += 1) {
      orphanVaultBytes[index] = (uint8_t)(0x10 + index);
      endpoint[index] = (uint8_t)(0x20 + index);
      ceremony[index] = (uint8_t)(0x30 + index);
      envelope[index] = (uint8_t)(0x40 + index);
    }
    for (size_t index = 0; index < 32; index += 1) {
      nonce[index] = (uint8_t)(0x50 + index);
      signing[index] = (uint8_t)(0x70 + index);
      agreement[index] = (uint8_t)(0x90 + index);
    }
    NSData *orphanVault =
        [NSData dataWithBytes:orphanVaultBytes length:sizeof orphanVaultBytes];
    AncPrivateVaultEnrollmentOfferStatus offerStatus;
    AncPrivateVaultEnrollmentOfferResult *orphanOffer =
        AncPrivateVaultEnrollmentOfferBuild(
            orphanVault, [NSData dataWithBytes:endpoint length:sizeof endpoint],
            [NSData dataWithBytes:ceremony length:sizeof ceremony],
            [NSData dataWithBytes:envelope length:sizeof envelope],
            [NSData dataWithBytes:nonce length:sizeof nonce], @"broker", YES,
            1721117600, 1721118200, signing, agreement, &offerStatus);
    assert(orphanOffer != nil &&
           [artifacts storeVaultId:orphanVault
                       encodedOffer:orphanOffer.encodedOffer
                           offerHash:orphanOffer.offerHash
                    candidateKeyProof:orphanOffer.candidateKeyProof] ==
               AncPrivateVaultEnrollmentOfferArtifactStatusOK);
    AncPrivateVaultEnrollmentCandidate *recovered = nil;
    assert([coordinator prepareBrokerVaultId:orphanVault
                                  nowSeconds:1721117601
                                   candidate:&recovered] ==
               AncPrivateVaultEnrollmentCoordinatorStatusOK &&
           recovered != nil &&
           ![recovered.offerHash isEqualToData:orphanOffer.offerHash]);
    anc_pv_zeroize(signing, sizeof signing);
    anc_pv_zeroize(agreement, sizeof agreement);
    puts("private-vault enrollment coordinator tests passed");
  }
  return 0;
}
