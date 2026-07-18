#import <Foundation/Foundation.h>

#import "PrivateVaultJobCodec.h"

#include <assert.h>

static NSData *Hex(NSString *value) {
  assert(value.length % 2 == 0);
  NSMutableData *data = [NSMutableData dataWithLength:value.length / 2];
  uint8_t *bytes = data.mutableBytes;
  for (NSUInteger index = 0; index < data.length; index += 1) {
    unsigned int byte = 0;
    NSString *pair = [value substringWithRange:NSMakeRange(index * 2, 2)];
    NSScanner *scanner = [NSScanner scannerWithString:pair];
    assert([scanner scanHexInt:&byte] && scanner.isAtEnd);
    bytes[index] = (uint8_t)byte;
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
    NSData *job = Hex(@"ac0166616e632f763102500101010101010101010101010101010103636a6f62041a66961247055018181818181818181818181818181818185a5006060606060606060606060606060606185b582076841ff39e85522ccfe9eb53ed39925d615f5997cfbb8f3f71e10b22eec0f824185c1a66961247185d1a6696149f185e5003030303030303030303030303030303185f5852939393939393939393939393939393939393939393939393ef05269e840644ee9631e5cc7bbfc68feb8b7947b7d4dd07288ddfdbd9f561adba227ab1fda0d80a3e98a02078e6e0ee6b555e2b53095251595a1860584005fb2843edbab5ef8d2f2a14bcb9a3225ead67d48962ed5b133e30658f0a90002538566406725ec50c4f4b2b1b9b896001d5f37faa8cbdd94d97ca2cc0e86c04");
    uint8_t signingSeed[32], senderBoxSeed[32], recipientBoxSeed[32];
    memset(signingSeed, 0x11, sizeof signingSeed);
    memset(senderBoxSeed, 0x22, sizeof senderBoxSeed);
    memset(recipientBoxSeed, 0x33, sizeof recipientBoxSeed);
    uint8_t signingPublic[32], signingPrivate[64];
    uint8_t senderBoxPublic[32], senderBoxPrivate[32];
    uint8_t recipientBoxPublic[32], recipientBoxPrivate[32];
    assert(anc_pv_ed25519_seed_keypair(signingPublic, signingPrivate,
                                       signingSeed) == ANC_PV_CRYPTO_OK);
    assert(anc_pv_box_seed_keypair(senderBoxPublic, senderBoxPrivate,
                                   senderBoxSeed) == ANC_PV_CRYPTO_OK);
    assert(anc_pv_box_seed_keypair(recipientBoxPublic, recipientBoxPrivate,
                                   recipientBoxSeed) == ANC_PV_CRYPTO_OK);

    AncPrivateVaultJobCodecStatus status;
    NSData *semantic = Hex(@"a60166616e632f7631026c73656d616e7469632d6a6f620350090909090909090909090909090909090464726561640567636f6e74656e740658197b22616374696f6e223a226765742d646f63756d656e74227d");
    AncPrivateVaultSemanticJobPayload *semanticPayload =
        AncPrivateVaultDecodeSemanticJobPayload(semantic, &status);
    assert(status == AncPrivateVaultJobCodecStatusOK && semanticPayload != nil &&
           [semanticPayload.resourceId isEqualToData:Pattern(0x09, 16)] &&
           [semanticPayload.operation isEqualToString:@"read"] &&
           [semanticPayload.provider isEqualToString:@"content"] &&
           [semanticPayload.body isEqualToData:
               [@"{\"action\":\"get-document\"}"
                   dataUsingEncoding:NSUTF8StringEncoding]]);
    AncPrivateVaultOpenedJob *opened = AncPrivateVaultOpenJobEnvelope(
        job, Pattern(0x01, 16), Pattern(0x06, 16), Pattern(0x03, 16),
        1721111200, signingPublic, senderBoxPublic, recipientBoxPrivate, &status);
    assert(status == AncPrivateVaultJobCodecStatusOK && opened != nil);
    AncPrivateVaultJobCoordinates *coordinates =
        AncPrivateVaultInspectJobEnvelope(job, Pattern(0x01, 16),
                                          Pattern(0x06, 16),
                                          Pattern(0x03, 16), &status);
    assert(status == AncPrivateVaultJobCodecStatusOK && coordinates != nil &&
           [coordinates.grantRef isEqualToData:
               Hex(@"76841ff39e85522ccfe9eb53ed39925d615f5997cfbb8f3f71e10b22eec0f824")] &&
           coordinates.issuedAt == 1721111111 &&
           coordinates.expiresAt == 1721111711);
    assert([[[NSString alloc] initWithData:opened.payload
                                  encoding:NSUTF8StringEncoding]
        isEqualToString:@"synthetic encrypted job request"]);
    assert(opened.grantRef.length == 32 && opened.jobHash.length == 32);

    NSData *result = AncPrivateVaultSealResultEnvelope(
        Pattern(0x01, 16), Pattern(0x19, 16), 1721111111,
        Pattern(0x06, 16), opened.jobHash, Pattern(0x03, 16), @"completed",
        [@"synthetic encrypted job result"
            dataUsingEncoding:NSUTF8StringEncoding],
        Pattern(0x94, 24), signingSeed, recipientBoxPrivate, senderBoxPublic,
        &status);
    assert(status == AncPrivateVaultJobCodecStatusOK && result != nil);
    NSData *expectedResult = Hex(@"ab0166616e632f76310250010101010101010101010101010101010366726573756c74041a669612470550191919191919191919191919191919191864500606060606060606060606060606060618655820b2437f2f0396a4f877e49ce6d8d0fe7888fc7efd547efff3c7ad3b1431c2b2f6186650030303030303030303030303030303031867585494949494949494949494949494949494949494949494949457008cdcbf16605ccbb5b711aaa1a3c791da42c0cee5335752da897d119f18962c04cf198d01a168a77e935ec5de286c2f14523c85a10ac116d19c3718685840e02be8b08b7d71f4e3798b48eca55850009d7124d6b1383c370a61cf3583c46277b385f86d35e57a458e7efbb82971ae8a69f3001e3d6ec4904ef68182b8b701186969636f6d706c65746564");
    assert([result isEqualToData:expectedResult]);
    AncPrivateVaultVerifiedResult *verifiedResult =
        AncPrivateVaultVerifyResultEnvelope(
            result, Pattern(0x01, 16), Pattern(0x06, 16), opened.jobHash,
            Pattern(0x03, 16), signingPublic, &status);
    assert(status == AncPrivateVaultJobCodecStatusOK &&
           [verifiedResult.state isEqualToString:@"completed"]);
    assert(AncPrivateVaultVerifyResultEnvelope(
               result, Pattern(0x01, 16), Pattern(0x06, 16),
               Pattern(0xff, 32), Pattern(0x03, 16), signingPublic,
               &status) == nil);
    assert(status == AncPrivateVaultJobCodecStatusInvalid);
    NSMutableData *corruptResultSignature = [result mutableCopy];
    ((uint8_t *)corruptResultSignature.mutableBytes)[result.length - 76] ^= 1;
    assert(AncPrivateVaultVerifyResultEnvelope(
               corruptResultSignature, Pattern(0x01, 16),
               Pattern(0x06, 16), opened.jobHash, Pattern(0x03, 16),
               signingPublic, &status) == nil);
    assert(status == AncPrivateVaultJobCodecStatusSignature);
    NSMutableData *invalidResultState = [result mutableCopy];
    ((uint8_t *)invalidResultState.mutableBytes)[result.length - 1] = 'x';
    assert(AncPrivateVaultVerifyResultEnvelope(
               invalidResultState, Pattern(0x01, 16), Pattern(0x06, 16),
               opened.jobHash, Pattern(0x03, 16), signingPublic,
               &status) == nil);
    assert(status == AncPrivateVaultJobCodecStatusInvalid);

    NSMutableData *corrupt = [job mutableCopy];
    ((uint8_t *)corrupt.mutableBytes)[corrupt.length - 1] ^= 1;
    assert(AncPrivateVaultOpenJobEnvelope(
               corrupt, Pattern(0x01, 16), Pattern(0x06, 16),
               Pattern(0x03, 16), 1721111200, signingPublic, senderBoxPublic,
               recipientBoxPrivate, &status) == nil);
    assert(status == AncPrivateVaultJobCodecStatusSignature);
    assert(AncPrivateVaultOpenJobEnvelope(
               job, Pattern(0x01, 16), Pattern(0x06, 16), Pattern(0x03, 16),
               1721111800, signingPublic, senderBoxPublic, recipientBoxPrivate,
               &status) == nil);
    assert(status == AncPrivateVaultJobCodecStatusExpired);

    anc_pv_zeroize(signingSeed, sizeof signingSeed);
    anc_pv_zeroize(senderBoxSeed, sizeof senderBoxSeed);
    anc_pv_zeroize(recipientBoxSeed, sizeof recipientBoxSeed);
    anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
    anc_pv_zeroize(senderBoxPrivate, sizeof senderBoxPrivate);
    anc_pv_zeroize(recipientBoxPrivate, sizeof recipientBoxPrivate);
  }
  return 0;
}
