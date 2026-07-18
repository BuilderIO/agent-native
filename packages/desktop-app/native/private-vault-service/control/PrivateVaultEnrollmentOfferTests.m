#import <Foundation/Foundation.h>

#import "PrivateVaultEnrollmentOffer.h"
#import "PrivateVaultCrypto.h"

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

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    NSData *vault = Hex(@"000102030405060708090a0b0c0d0e0f");
    NSData *endpoint = Hex(@"101112131415161718191a1b1c1d1e1f");
    NSData *ceremony = Hex(@"202122232425262728292a2b2c2d2e2f");
    NSData *envelope = Hex(@"303132333435363738393a3b3c3d3e3f");
    NSData *nonce = Hex(@"404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f");
    NSMutableData *signingSeed =
        [Hex(@"606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f")
            mutableCopy];
    NSMutableData *boxSeed =
        [Hex(@"808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f")
            mutableCopy];
    AncPrivateVaultEnrollmentOfferStatus status;
    AncPrivateVaultEnrollmentOfferResult *result =
        AncPrivateVaultEnrollmentOfferBuild(
            vault, endpoint, ceremony, envelope, nonce, @"broker", YES,
            1721117511, 1721118111, signingSeed.bytes, boxSeed.bytes, &status);
    assert(status == AncPrivateVaultEnrollmentOfferStatusOK && result != nil);
    assert([result.signingPublicKey
        isEqualToData:Hex(@"174553b456dddfc6908ecab1c101fe6ab21e2baa0617795b7d43a63482993fd5")]);
    assert([result.keyAgreementPublicKey
        isEqualToData:Hex(@"3de70cb2b9bb0bda3873d13e8a7cf4ea870dabeb296caa1dfce0a5f411c8d234")]);
    assert([result.encodedOffer
        isEqualToData:Hex(@"ad0166616e632f76310250000102030405060708090a0b0c0d0e0f0370656e726f6c6c6d656e742d6f66666572041a66962b470550303132333435363738393a3b3c3d3e3f18a050101112131415161718191a1b1c1d1e1f18a150202122232425262728292a2b2c2d2e2f18a26662726f6b657218a3f518a45820174553b456dddfc6908ecab1c101fe6ab21e2baa0617795b7d43a63482993fd518a558203de70cb2b9bb0bda3873d13e8a7cf4ea870dabeb296caa1dfce0a5f411c8d23418a65820404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f18a81a66962d9f")]);
    assert([result.offerHash
        isEqualToData:Hex(@"b44220e10afb6f46407104bc873bca0a6b245af6433165c41413fd56f2a6a5ed")]);
    assert([result.candidateKeyProof
        isEqualToData:Hex(@"9a7393a4e510dd83bfc8bc8078fdb1495b56c0d289127c40f46f6a558e54ffdf861e21c40543bfd51fe1904ab2b0b2fd76ba32d6455788f4bc1190d818ba7a09")]);
    assert(AncPrivateVaultEnrollmentOfferBuild(
               vault, endpoint, ceremony, envelope, nonce, @"broker", NO,
               1721117511, 1721118111, signingSeed.bytes, boxSeed.bytes,
               &status) == nil &&
           status == AncPrivateVaultEnrollmentOfferStatusInvalid);
    assert(AncPrivateVaultEnrollmentOfferBuild(
               vault, endpoint, ceremony, envelope, nonce, @"broker", YES,
               1721117511, 1721118112, signingSeed.bytes, boxSeed.bytes,
               &status) == nil &&
           status == AncPrivateVaultEnrollmentOfferStatusInvalid);
    anc_pv_zeroize(signingSeed.mutableBytes, signingSeed.length);
    anc_pv_zeroize(boxSeed.mutableBytes, boxSeed.length);
    puts("private-vault enrollment offer parity passed");
  }
  return 0;
}
