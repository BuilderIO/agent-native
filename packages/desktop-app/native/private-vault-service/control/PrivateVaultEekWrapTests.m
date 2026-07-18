#import <Foundation/Foundation.h>

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultEekWrap.h"

#include <assert.h>

static NSData *Hex(NSString *hex) {
  NSMutableData *data = [NSMutableData dataWithLength:hex.length / 2];
  uint8_t *bytes = data.mutableBytes;
  for (NSUInteger index = 0; index < data.length; index += 1) {
    unsigned value = 0;
    assert(sscanf([[hex substringWithRange:NSMakeRange(index * 2, 2)] UTF8String],
                  "%2x", &value) == 1);
    bytes[index] = (uint8_t)value;
  }
  return data;
}

static NSData *Repeated(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    NSData *encoded = Hex(
        @"ab0166616e632f7631025001010101010101010101010101010101036865656b2d77726170041a66961247055012121212121212121212121212121212181e07181f50030303030303030303030303030303031820500202020202020202020202020202020218215818919191919191919191919191919191919191919191919191182258405731304237672e128234cfc8dd5ec5c492e25a196cf7dba33b8e4e92c48c331ed0d8b9ef8e68d24fe8c64118fd9c16c82d9f1f888a764815e3f63afb721057e318235840380f28fad03ba789928c943f98e58a3f4d410ae76b8f124ddcd906e74c983836936d766ee7ad7232b5b41c653debbbd735c45810db12d180c2c6091af68f0101");
    uint8_t signingSeed[32], senderSeed[32], recipientSeed[32];
    memset(signingSeed, 0x11, sizeof signingSeed);
    memset(senderSeed, 0x22, sizeof senderSeed);
    memset(recipientSeed, 0x33, sizeof recipientSeed);
    uint8_t signingPublic[32] = {0}, signingPrivate[64] = {0};
    uint8_t senderPublic[32] = {0}, senderPrivate[32] = {0};
    uint8_t recipientPublic[32] = {0}, recipientPrivate[32] = {0};
    assert(anc_pv_ed25519_seed_keypair(signingPublic, signingPrivate,
                                      signingSeed) == ANC_PV_CRYPTO_OK);
    assert(anc_pv_box_seed_keypair(senderPublic, senderPrivate, senderSeed) ==
           ANC_PV_CRYPTO_OK);
    assert(anc_pv_box_seed_keypair(recipientPublic, recipientPrivate,
                                  recipientSeed) == ANC_PV_CRYPTO_OK);
    NSData *signing = [NSData dataWithBytes:signingPublic length:32];
    NSData *sender = [NSData dataWithBytes:senderPublic length:32];
    NSData *recipient = [NSData dataWithBytes:recipientPublic length:32];
    AncPrivateVaultEekWrapStatus status;
    AncPrivateVaultEekWrap *verified = AncPrivateVaultEekWrapVerify(
        encoded, Repeated(0x01, 16), Repeated(0x03, 16), Repeated(0x02, 16),
        7, signing, &status);
    assert(status == AncPrivateVaultEekWrapStatusOK && verified != nil &&
           verified.epoch == 7 && verified.createdAt == 1721111111 &&
           [verified.envelopeId isEqualToData:Repeated(0x12, 16)]);
    __block BOOL consumed = NO;
    assert(AncPrivateVaultEekWrapOpen(
               encoded, Repeated(0x01, 16), Repeated(0x03, 16),
               Repeated(0x02, 16), 7, signing, sender, recipient, recipientSeed,
               ^BOOL(const uint8_t epochKey[32]) {
                 consumed = anc_pv_memcmp(epochKey, Repeated(0x44, 32).bytes,
                                          32) == ANC_PV_CRYPTO_OK;
                 return consumed;
               }) == AncPrivateVaultEekWrapStatusOK &&
           consumed);
    uint8_t wrongSeed[32];
    memset(wrongSeed, 0x34, sizeof wrongSeed);
    assert(AncPrivateVaultEekWrapOpen(
               encoded, Repeated(0x01, 16), Repeated(0x03, 16),
               Repeated(0x02, 16), 7, signing, sender, recipient, wrongSeed,
               ^BOOL(__unused const uint8_t epochKey[32]) { return YES; }) ==
           AncPrivateVaultEekWrapStatusBindingMismatch);
    NSMutableData *badSignature = [encoded mutableCopy];
    ((uint8_t *)badSignature.mutableBytes)[badSignature.length - 1] ^= 1;
    assert(AncPrivateVaultEekWrapVerify(
               badSignature, Repeated(0x01, 16), Repeated(0x03, 16),
               Repeated(0x02, 16), 7, signing, &status) == nil &&
           status == AncPrivateVaultEekWrapStatusInvalidSignature);
    assert(AncPrivateVaultEekWrapVerify(
               encoded, Repeated(0x01, 16), Repeated(0x04, 16),
               Repeated(0x02, 16), 7, signing, &status) == nil &&
           status == AncPrivateVaultEekWrapStatusBindingMismatch);
    assert(AncPrivateVaultEekWrapVerify(
               encoded, Repeated(0x01, 16), Repeated(0x03, 16),
               Repeated(0x04, 16), 7, signing, &status) == nil &&
           status == AncPrivateVaultEekWrapStatusBindingMismatch);
    assert(AncPrivateVaultEekWrapVerify(
               encoded, Repeated(0x01, 16), Repeated(0x03, 16),
               Repeated(0x02, 16), 8, signing, &status) == nil &&
           status == AncPrivateVaultEekWrapStatusBindingMismatch);
    assert(AncPrivateVaultEekWrapVerify(
               encoded, Repeated(0x01, 16), Repeated(0x03, 16),
               Repeated(0x02, 16), 7, Repeated(0x99, 32), &status) == nil &&
           status == AncPrivateVaultEekWrapStatusInvalidSignature);
    NSMutableData *badCiphertext = [encoded mutableCopy];
    ((uint8_t *)badCiphertext.mutableBytes)[badCiphertext.length - 70] ^= 1;
    assert(AncPrivateVaultEekWrapVerify(
               badCiphertext, Repeated(0x01, 16), Repeated(0x03, 16),
               Repeated(0x02, 16), 7, signing, &status) == nil &&
           status == AncPrivateVaultEekWrapStatusInvalidSignature);
    AncPrivateVaultCanonicalStatus canonicalStatus;
    AncPrivateVaultCanonicalValue *decoded =
        AncPrivateVaultCanonicalDecode(encoded, 65536, &canonicalStatus);
    NSMutableDictionary *resignedMap = [decoded.mapValue mutableCopy];
    AncPrivateVaultCanonicalValue *originalCiphertext = resignedMap[@34];
    NSMutableData *changedCiphertext =
        [originalCiphertext.bytesValue mutableCopy];
    ((uint8_t *)changedCiphertext.mutableBytes)[0] ^= 1;
    resignedMap[@34] = [AncPrivateVaultCanonicalValue bytes:changedCiphertext];
    [resignedMap removeObjectForKey:@35];
    NSData *unsignedEnvelope = AncPrivateVaultCanonicalEncode(
        [AncPrivateVaultCanonicalValue map:resignedMap], &canonicalStatus);
    static const uint8_t domain[] = "anc/v1/eek-wrap";
    NSMutableData *message =
        [NSMutableData dataWithBytes:domain length:sizeof domain];
    [message appendData:unsignedEnvelope];
    uint8_t replacementSignature[64] = {0};
    assert(anc_pv_ed25519_sign(replacementSignature, message.bytes,
                              message.length, signingPrivate) ==
           ANC_PV_CRYPTO_OK);
    resignedMap[@35] = [AncPrivateVaultCanonicalValue
        bytes:[NSData dataWithBytes:replacementSignature length:64]];
    NSData *resigned = AncPrivateVaultCanonicalEncode(
        [AncPrivateVaultCanonicalValue map:resignedMap], &canonicalStatus);
    assert(AncPrivateVaultEekWrapOpen(
               resigned, Repeated(0x01, 16), Repeated(0x03, 16),
               Repeated(0x02, 16), 7, signing, sender, recipient, recipientSeed,
               ^BOOL(__unused const uint8_t *epochKey) { return YES; }) ==
           AncPrivateVaultEekWrapStatusAuthenticationFailed);
    anc_pv_zeroize(message.mutableBytes, message.length);
    anc_pv_zeroize(replacementSignature, sizeof replacementSignature);
    anc_pv_zeroize(signingSeed, sizeof signingSeed);
    anc_pv_zeroize(senderSeed, sizeof senderSeed);
    anc_pv_zeroize(recipientSeed, sizeof recipientSeed);
    anc_pv_zeroize(wrongSeed, sizeof wrongSeed);
    anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
    anc_pv_zeroize(senderPrivate, sizeof senderPrivate);
    anc_pv_zeroize(recipientPrivate, sizeof recipientPrivate);
    puts("private-vault EEK wrap parity passed");
  }
  return 0;
}
