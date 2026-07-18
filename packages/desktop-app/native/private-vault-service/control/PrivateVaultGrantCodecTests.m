#import <Foundation/Foundation.h>

#import "PrivateVaultGrantCodec.h"

#include <assert.h>

static NSData *Hex(NSString *value) {
  assert(value.length % 2 == 0);
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

static NSData *Pattern(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    NSData *grant = Hex(@"b10166616e632f763102500101010101010101010101010101010103656772616e74041a66961247055016161616161616161616161616161616183c5005050505050505050505050505050505183d5002020202020202020202020202020202183e5007070707070707070707070707070707183f500303030303030303030303030303030318405008080808080808080808080808080808184181500404040404040404040404040404040418428264726561646973756d6d6172697a651843817273796e7468657469632d70726f766964657218441a6696124718451a669620571846500909090909090909090909090909090918475840375f79aa1a33d3766de017f95a7b30dc0032d332589b3b9dbb44467e26892d2aa76f22b1e52ba7207803edac04a803c2083c8658ec27053bfe92dbf2daa30200");
    NSData *revocation = Hex(@"ab0166616e632f7631025001010101010101010101010101010101036c6772616e742d7265766f6b65041a669612490550313131313131313131313131313131311848582076841ff39e85522ccfe9eb53ed39925d615f5997cfbb8f3f71e10b22eec0f82418495009090909090909090909090909090909184a1a66961249184b6c757365725f7265766f6b6564184c5002020202020202020202020202020202184d5840cdd276cbffe853d610b445f7e6ae8875ff3c606b289a7607b37753a2630fc7a4b8153f1ae0965fe69a6badcf3dd80e02ceda4e12edc3f1bbf337f8dd41144503");
    uint8_t seed[32];
    memset(seed, 0x11, sizeof seed);
    uint8_t publicKey[32], privateKey[64];
    assert(anc_pv_ed25519_seed_keypair(publicKey, privateKey, seed) ==
           ANC_PV_CRYPTO_OK);

    AncPrivateVaultGrantCodecStatus status;
    AncPrivateVaultVerifiedGrant *verified =
        AncPrivateVaultVerifyGrantEnvelope(
            grant, Pattern(0x01, 16), 1721111112, Pattern(0x02, 16),
            publicKey, &status);
    assert(status == AncPrivateVaultGrantCodecStatusOK && verified != nil);
    assert([verified.grantRef isEqualToData:
        Hex(@"76841ff39e85522ccfe9eb53ed39925d615f5997cfbb8f3f71e10b22eec0f824")]);
    NSArray *expectedOperations = @[@"read", @"summarize"];
    NSArray *expectedProviders = @[@"synthetic-provider"];
    assert([verified.revocationRef isEqualToData:Pattern(0x09, 16)] &&
           [verified.operations isEqual:expectedOperations] &&
           [verified.providers isEqual:expectedProviders]);

    AncPrivateVaultVerifiedGrantRevocation *verifiedRevocation =
        AncPrivateVaultVerifyGrantRevocationEnvelope(
            revocation, Pattern(0x01, 16), verified, publicKey, &status);
    assert(status == AncPrivateVaultGrantCodecStatusOK &&
           verifiedRevocation != nil &&
           [verifiedRevocation.grantRef isEqualToData:verified.grantRef] &&
           [verifiedRevocation.reason isEqualToString:@"user_revoked"]);

    assert(AncPrivateVaultVerifyGrantEnvelope(
               grant, Pattern(0x01, 16), 1721114712, Pattern(0x02, 16),
               publicKey, &status) == nil &&
           status == AncPrivateVaultGrantCodecStatusExpired);
    assert(AncPrivateVaultVerifyGrantEnvelope(
               grant, Pattern(0xff, 16), 1721111112, Pattern(0x02, 16),
               publicKey, &status) == nil &&
           status == AncPrivateVaultGrantCodecStatusInvalid);
    uint8_t wrongKey[32];
    memset(wrongKey, 0xee, sizeof wrongKey);
    assert(AncPrivateVaultVerifyGrantEnvelope(
               grant, Pattern(0x01, 16), 1721111112, Pattern(0x02, 16),
               wrongKey, &status) == nil &&
           status == AncPrivateVaultGrantCodecStatusSignature);

    NSMutableData *tamperedRevocation = [revocation mutableCopy];
    ((uint8_t *)tamperedRevocation.mutableBytes)[tamperedRevocation.length - 1] ^= 1;
    assert(AncPrivateVaultVerifyGrantRevocationEnvelope(
               tamperedRevocation, Pattern(0x01, 16), verified, publicKey,
               &status) == nil &&
           status == AncPrivateVaultGrantCodecStatusSignature);
    [verified setValue:Pattern(0xee, 16) forKey:@"revocationRef"];
    assert(AncPrivateVaultVerifyGrantRevocationEnvelope(
               revocation, Pattern(0x01, 16), verified, publicKey, &status) ==
           nil);

    anc_pv_zeroize(seed, sizeof seed);
    anc_pv_zeroize(privateKey, sizeof privateKey);
  }
  return 0;
}
