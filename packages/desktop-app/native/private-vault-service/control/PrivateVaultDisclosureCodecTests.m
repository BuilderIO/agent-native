#import <Foundation/Foundation.h>

#import "PrivateVaultDisclosureCodec.h"

#include <assert.h>

static NSData *Pattern(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

static NSData *Hex(NSString *value) {
  NSMutableData *data = [NSMutableData dataWithLength:value.length / 2];
  for (NSUInteger index = 0; index < data.length; index += 1) {
    unsigned int byte = 0;
    NSScanner *scanner = [NSScanner scannerWithString:
        [value substringWithRange:NSMakeRange(index * 2, 2)]];
    assert([scanner scanHexInt:&byte] && scanner.isAtEnd);
    ((uint8_t *)data.mutableBytes)[index] = (uint8_t)byte;
  }
  return data;
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    uint8_t seed[32], publicKey[32], privateKey[64];
    memset(seed, 0x11, sizeof seed);
    assert(anc_pv_ed25519_seed_keypair(publicKey, privateKey, seed) ==
           ANC_PV_CRYPTO_OK);
    NSData *grantRef = Hex(
        @"76841ff39e85522ccfe9eb53ed39925d615f5997cfbb8f3f71e10b22eec0f824");
    NSData *scopeHash = Hex(
        @"6e9aa8d95e9af4efe15639f3b4d5797d278a1f387b70539ba9873e9f3c0bf969");
    NSData *expected = Hex(
        @"ac0166616e632f7631025001010101010101010101010101010101036a646973636c6f73757265041a669612470550171717171717171717171717171717171850582076841ff39e85522ccfe9eb53ed39925d615f5997cfbb8f3f71e10b22eec0f82418517273796e7468657469632d70726f766964657218527573796e7468657469632d64657374696e6174696f6e185358206e9aa8d95e9af4efe15639f3b4d5797d278a1f387b70539ba9873e9f3c0bf96918541a6696124718551a669615cb1856584075a92ee2e3ad0f9dd2c59de5d560b538026b97c6ade0a51eba3c14e42cc91c38bc28d473acceb2dcc9739c5cb96b22a310d3301e66e2d1ee41c241be050ba200");
    AncPrivateVaultDisclosureCodecStatus status;
    NSData *sealed = AncPrivateVaultSealDisclosureEnvelope(
        Pattern(0x01, 16), Pattern(0x17, 16), 1721111111, grantRef,
        @"synthetic-provider", @"synthetic-destination", scopeHash,
        1721111111, 1721112011, seed, &status);
    assert(status == AncPrivateVaultDisclosureCodecStatusOK &&
           [sealed isEqualToData:expected]);
    AncPrivateVaultVerifiedDisclosure *verified =
        AncPrivateVaultVerifyDisclosureEnvelope(
            sealed, Pattern(0x01, 16), grantRef, 1721111112, publicKey,
            &status);
    assert(status == AncPrivateVaultDisclosureCodecStatusOK &&
           verified != nil &&
           [verified.providerId isEqualToString:@"synthetic-provider"] &&
           [verified.destination isEqualToString:@"synthetic-destination"] &&
           [verified.scopeHash isEqualToData:scopeHash]);
    NSData *boundedScope = AncPrivateVaultDisclosureScopeHash(
        Pattern(0x04, 16), @"get-document");
    assert(boundedScope.length == 32 &&
           ![boundedScope isEqualToData:scopeHash] &&
           AncPrivateVaultDisclosureScopeHash(Pattern(0x04, 16),
                                              @"get document") == nil);
    assert(AncPrivateVaultVerifyDisclosureEnvelope(
               sealed, Pattern(0x01, 16), grantRef, 1721112012, publicKey,
               &status) == nil &&
           status == AncPrivateVaultDisclosureCodecStatusExpired);
    ((uint8_t *)publicKey)[0] ^= 1;
    assert(AncPrivateVaultVerifyDisclosureEnvelope(
               sealed, Pattern(0x01, 16), grantRef, 1721111112, publicKey,
               &status) == nil &&
           status == AncPrivateVaultDisclosureCodecStatusSignature);
    assert(AncPrivateVaultSealDisclosureEnvelope(
               Pattern(0x01, 16), Pattern(0x17, 16), 1721111111, grantRef,
               @"synthetic provider", @"synthetic-destination", scopeHash,
               1721111111, 1721112011, seed, &status) == nil);
    anc_pv_zeroize(seed, sizeof seed);
    anc_pv_zeroize(publicKey, sizeof publicKey);
    anc_pv_zeroize(privateKey, sizeof privateKey);
  }
  return 0;
}
