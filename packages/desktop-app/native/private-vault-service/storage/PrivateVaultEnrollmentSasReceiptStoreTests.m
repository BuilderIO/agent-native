#import <Foundation/Foundation.h>

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultEnrollmentSasReceiptStore.h"

#include <assert.h>
#import <objc/runtime.h>

@interface AncPrivateVaultEnrollmentChallengeResult (SasReceiptStoreTests)
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

@interface AncTestReceiptKeychain : AncPrivateVaultKeychain
@property(nonatomic) NSMutableDictionary<NSString *, NSData *> *values;
@end
@implementation AncTestReceiptKeychain
- (AncPrivateVaultKeychainStatus)addData:(NSData *)data
                              forService:(NSString *)service
                                 vaultId:(NSString *)vaultId
                                recordId:(NSString *)recordId {
  NSString *key =
      [NSString stringWithFormat:@"%@|%@|%@", service, vaultId, recordId];
  if (self.values[key] != nil)
    return AncPrivateVaultKeychainStatusDuplicate;
  self.values[key] = [data copy];
  return AncPrivateVaultKeychainStatusOK;
}
- (AncPrivateVaultKeychainStatus)copyDataForService:(NSString *)service
                                            vaultId:(NSString *)vaultId
                                           recordId:(NSString *)recordId
                                               data:(NSData **)data {
  NSString *key =
      [NSString stringWithFormat:@"%@|%@|%@", service, vaultId, recordId];
  NSData *value = self.values[key];
  if (value == nil)
    return AncPrivateVaultKeychainStatusNotFound;
  *data = [value copy];
  return AncPrivateVaultKeychainStatusOK;
}
@end

static NSData *Repeated(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

static AncPrivateVaultEnrollmentChallengeResult *Challenge(NSData *publicKey) {
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
  challenge.candidateSigningPublicKey = publicKey;
  challenge.ceremonyId = Repeated(0x55, 16);
  challenge.createdAt = 1721111120;
  challenge.expiresAt = 1721111720;
  return challenge;
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    uint8_t seed[32], publicKey[32], privateKey[64];
    memset(seed, 0x12, sizeof seed);
    assert(anc_pv_ed25519_seed_keypair(publicKey, privateKey, seed) ==
           ANC_PV_CRYPTO_OK);
    AncPrivateVaultEnrollmentChallengeResult *challenge =
        Challenge([NSData dataWithBytes:publicKey length:32]);
    AncPrivateVaultEnrollmentSasReceiptStatus receiptStatus;
    AncPrivateVaultEnrollmentSasReceipt *confirmed =
        AncPrivateVaultEnrollmentSasReceiptBuild(
            challenge, Repeated(0x66, 16), 1721111150,
            AncPrivateVaultEnrollmentSasDecisionConfirmed, seed,
            &receiptStatus);
    AncPrivateVaultEnrollmentSasReceipt *mismatch =
        AncPrivateVaultEnrollmentSasReceiptBuild(
            challenge, Repeated(0x67, 16), 1721111151,
            AncPrivateVaultEnrollmentSasDecisionMismatch, seed, &receiptStatus);
    AncTestReceiptKeychain *keychain =
        class_createInstance(AncTestReceiptKeychain.class, 0);
    keychain.values = [NSMutableDictionary dictionary];
    AncPrivateVaultEnrollmentSasReceiptStore *store =
        [[AncPrivateVaultEnrollmentSasReceiptStore alloc]
            initWithKeychain:keychain
                    recordId:@"broker"];
    assert([store storeReceipt:confirmed.encodedReceipt challenge:challenge] ==
           AncPrivateVaultEnrollmentSasReceiptStoreStatusOK);
    assert([store storeReceipt:confirmed.encodedReceipt challenge:challenge] ==
           AncPrivateVaultEnrollmentSasReceiptStoreStatusOK);
    assert([store storeReceipt:mismatch.encodedReceipt challenge:challenge] ==
           AncPrivateVaultEnrollmentSasReceiptStoreStatusConflict);
    AncPrivateVaultEnrollmentChallengeResult *replacementChallenge =
        Challenge([NSData dataWithBytes:publicKey length:32]);
    replacementChallenge.ceremonyId = Repeated(0x56, 16);
    AncPrivateVaultEnrollmentSasReceipt *replacementMismatch =
        AncPrivateVaultEnrollmentSasReceiptBuild(
            replacementChallenge, Repeated(0x68, 16), 1721111152,
            AncPrivateVaultEnrollmentSasDecisionMismatch, seed, &receiptStatus);
    assert([store storeReceipt:replacementMismatch.encodedReceipt
                     challenge:replacementChallenge] ==
           AncPrivateVaultEnrollmentSasReceiptStoreStatusOK);
    AncPrivateVaultEnrollmentSasReceipt *read = nil;
    assert([store readChallenge:challenge receipt:&read] ==
               AncPrivateVaultEnrollmentSasReceiptStoreStatusOK &&
           read.decision == AncPrivateVaultEnrollmentSasDecisionConfirmed &&
           [read.receiptHash isEqualToData:confirmed.receiptHash]);
    NSString *key = nil;
    for (NSString *candidate in keychain.values) {
      if ([keychain.values[candidate] isEqualToData:confirmed.encodedReceipt]) {
        key = candidate;
        break;
      }
    }
    assert(key != nil);
    NSMutableData *corrupt = [keychain.values[key] mutableCopy];
    ((uint8_t *)corrupt.mutableBytes)[corrupt.length - 1] ^= 1;
    keychain.values[key] = corrupt;
    assert([store readChallenge:challenge receipt:&read] ==
           AncPrivateVaultEnrollmentSasReceiptStoreStatusCorrupt);
    anc_pv_zeroize(seed, sizeof seed);
    anc_pv_zeroize(publicKey, sizeof publicKey);
    anc_pv_zeroize(privateKey, sizeof privateKey);
    puts("private-vault enrollment SAS receipt store passed");
  }
  return 0;
}
