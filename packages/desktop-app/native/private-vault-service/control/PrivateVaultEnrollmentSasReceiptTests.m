#import <Foundation/Foundation.h>

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultEnrollmentSasReceipt.h"
#import "PrivateVaultEnrollmentSasReceiptStore.h"

#include <assert.h>
#import <objc/runtime.h>

static NSMutableDictionary<NSString *, NSData *> *gStore;

static NSString *Key(NSDictionary *query) {
  return
      [NSString stringWithFormat:@"%@|%@", query[(__bridge id)kSecAttrService],
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

static OSStatus Update(CFDictionaryRef rawQuery,
                       CFDictionaryRef rawAttributes) {
  NSString *key = Key((__bridge NSDictionary *)rawQuery);
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
          storageDomain:@"enrollment-sas-receipt-test"];
}

@interface AncPrivateVaultEnrollmentChallengeResult (SasReceiptTests)
@property(nonatomic, readwrite) NSData *encodedChallenge;
@property(nonatomic, readwrite) NSData *challengeHash;
@property(nonatomic, readwrite) NSData *sasTranscriptHash;
@property(nonatomic, readwrite) NSData *offerHash;
@property(nonatomic, readwrite) NSData *candidateEndpointId;
@property(nonatomic, readwrite) NSData *candidateSigningPublicKey;
@property(nonatomic, readwrite) NSData *ceremonyId;
@property(nonatomic, readwrite) uint64_t createdAt;
@property(nonatomic, readwrite) uint64_t expiresAt;
@end

static NSData *Repeated(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

static AncPrivateVaultEnrollmentChallengeResult *
Challenge(NSData *candidateSigningPublicKey) {
  AncPrivateVaultCanonicalStatus status;
  NSData *encoded = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x01, 16)],
        @3 : [AncPrivateVaultCanonicalValue text:@"enrollment-challenge"],
      }],
      &status);
  AncPrivateVaultEnrollmentChallengeResult *challenge =
      class_createInstance(AncPrivateVaultEnrollmentChallengeResult.class, 0);
  challenge.encodedChallenge = encoded;
  challenge.offerHash = Repeated(0x11, 32);
  challenge.challengeHash = Repeated(0x22, 32);
  challenge.sasTranscriptHash = Repeated(0x33, 32);
  challenge.candidateEndpointId = Repeated(0x44, 16);
  challenge.candidateSigningPublicKey = candidateSigningPublicKey;
  challenge.ceremonyId = Repeated(0x55, 16);
  challenge.createdAt = 1721111120;
  challenge.expiresAt = 1721111720;
  return challenge;
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    gStore = [NSMutableDictionary dictionary];
    uint8_t signingSeed[32], signingPublic[32], signingPrivate[64];
    memset(signingSeed, 0x12, sizeof signingSeed);
    assert(anc_pv_ed25519_seed_keypair(signingPublic, signingPrivate,
                                       signingSeed) == ANC_PV_CRYPTO_OK);
    NSData *publicKey = [NSData dataWithBytes:signingPublic length:32];
    AncPrivateVaultEnrollmentChallengeResult *challenge = Challenge(publicKey);
    AncPrivateVaultEnrollmentSasReceiptStatus status;
    AncPrivateVaultEnrollmentSasReceipt *confirmed =
        AncPrivateVaultEnrollmentSasReceiptBuild(
            challenge, Repeated(0x66, 16), 1721111150,
            AncPrivateVaultEnrollmentSasDecisionConfirmed, signingSeed,
            &status);
    assert(status == AncPrivateVaultEnrollmentSasReceiptStatusOK &&
           confirmed != nil &&
           confirmed.decision ==
               AncPrivateVaultEnrollmentSasDecisionConfirmed &&
           confirmed.decidedAt == 1721111150 &&
           [confirmed.offerHash isEqualToData:challenge.offerHash]);
    AncPrivateVaultEnrollmentSasReceipt *replayed =
        AncPrivateVaultEnrollmentSasReceiptVerify(confirmed.encodedReceipt,
                                                  challenge, &status);
    assert(status == AncPrivateVaultEnrollmentSasReceiptStatusOK &&
           [replayed.receiptHash isEqualToData:confirmed.receiptHash]);

    AncPrivateVaultEnrollmentSasReceipt *mismatch =
        AncPrivateVaultEnrollmentSasReceiptBuild(
            challenge, Repeated(0x67, 16), 1721111151,
            AncPrivateVaultEnrollmentSasDecisionMismatch, signingSeed, &status);
    assert(status == AncPrivateVaultEnrollmentSasReceiptStatusOK &&
           mismatch.decision == AncPrivateVaultEnrollmentSasDecisionMismatch);

    NSMutableData *corrupt = [confirmed.encodedReceipt mutableCopy];
    ((uint8_t *)corrupt.mutableBytes)[corrupt.length - 1] ^= 1;
    assert(AncPrivateVaultEnrollmentSasReceiptVerify(corrupt, challenge,
                                                     &status) == nil &&
           status == AncPrivateVaultEnrollmentSasReceiptStatusInvalidSignature);
    AncPrivateVaultEnrollmentChallengeResult *wrongChallenge =
        Challenge(publicKey);
    wrongChallenge.sasTranscriptHash = Repeated(0x34, 32);
    assert(AncPrivateVaultEnrollmentSasReceiptVerify(
               confirmed.encodedReceipt, wrongChallenge, &status) == nil &&
           status == AncPrivateVaultEnrollmentSasReceiptStatusBindingMismatch);
    uint8_t wrongSeed[32];
    memset(wrongSeed, 0x13, sizeof wrongSeed);
    assert(AncPrivateVaultEnrollmentSasReceiptBuild(
               challenge, Repeated(0x68, 16), 1721111152,
               AncPrivateVaultEnrollmentSasDecisionConfirmed, wrongSeed,
               &status) == nil);
    assert(AncPrivateVaultEnrollmentSasReceiptBuild(
               challenge, Repeated(0x69, 16), 1721111721,
               AncPrivateVaultEnrollmentSasDecisionConfirmed, signingSeed,
               &status) == nil);

    AncPrivateVaultEnrollmentSasReceiptStore *store =
        [[AncPrivateVaultEnrollmentSasReceiptStore alloc]
            initWithKeychain:Keychain()
                    recordId:@"candidate-decision"];
    assert([store storeReceipt:confirmed.encodedReceipt challenge:challenge] ==
           AncPrivateVaultEnrollmentSasReceiptStoreStatusOK);
    assert([store storeReceipt:confirmed.encodedReceipt challenge:challenge] ==
           AncPrivateVaultEnrollmentSasReceiptStoreStatusOK);
    AncPrivateVaultEnrollmentSasReceipt *storedReceipt = nil;
    assert([store readChallenge:challenge receipt:&storedReceipt] ==
               AncPrivateVaultEnrollmentSasReceiptStoreStatusOK &&
           [storedReceipt.receiptHash isEqualToData:confirmed.receiptHash]);
    assert(AncPrivateVaultEnrollmentSasReceiptVerify(
               mismatch.encodedReceipt, challenge, &status) != nil &&
           status == AncPrivateVaultEnrollmentSasReceiptStatusOK);
    AncPrivateVaultEnrollmentSasReceipt *recheckedMismatch =
        AncPrivateVaultEnrollmentSasReceiptVerify(mismatch.encodedReceipt,
                                                  challenge, &status);
    assert(recheckedMismatch != nil &&
           status == AncPrivateVaultEnrollmentSasReceiptStatusOK);
    AncPrivateVaultEnrollmentSasReceiptStoreStatus conflictingDecision =
        [store storeReceipt:mismatch.encodedReceipt challenge:challenge];
    assert(conflictingDecision ==
           AncPrivateVaultEnrollmentSasReceiptStoreStatusConflict);

    AncPrivateVaultEnrollmentSasReceiptStore *mismatchFirst =
        [[AncPrivateVaultEnrollmentSasReceiptStore alloc]
            initWithKeychain:Keychain()
                    recordId:@"candidate-mismatch"];
    assert([mismatchFirst storeReceipt:mismatch.encodedReceipt
                             challenge:challenge] ==
           AncPrivateVaultEnrollmentSasReceiptStoreStatusOK);
    assert([mismatchFirst storeReceipt:confirmed.encodedReceipt
                             challenge:challenge] ==
           AncPrivateVaultEnrollmentSasReceiptStoreStatusConflict);

    NSString *storedKey = nil;
    for (NSString *key in gStore) {
      if ([key hasPrefix:AncPrivateVaultEnrollmentSasReceiptService] &&
          [gStore[key] isEqualToData:confirmed.encodedReceipt])
        storedKey = key;
    }
    assert(storedKey != nil);
    NSMutableData *corruptStored = [gStore[storedKey] mutableCopy];
    ((uint8_t *)corruptStored.mutableBytes)[corruptStored.length - 1] ^= 1;
    gStore[storedKey] = corruptStored;
    storedReceipt = nil;
    assert([store readChallenge:challenge receipt:&storedReceipt] ==
               AncPrivateVaultEnrollmentSasReceiptStoreStatusCorrupt &&
           storedReceipt == nil);
    anc_pv_zeroize(signingSeed, sizeof signingSeed);
    anc_pv_zeroize(wrongSeed, sizeof wrongSeed);
    anc_pv_zeroize(signingPublic, sizeof signingPublic);
    anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
    puts("private-vault enrollment SAS receipt passed");
  }
  return 0;
}
