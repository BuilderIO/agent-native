#import <Foundation/Foundation.h>

#import "PrivateVaultGenesisAccountAdmission.h"

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

int main(void) {
  @autoreleasepool {
    NSData *bootstrap = Hex(@"a30166616e632f763102010369626f6f747374726170");
    NSData *confirmation =
        Hex(@"a30166616e632f76310201036c636f6e6669726d6174696f6e");
    NSData *authorization =
        Hex(@"a30166616e632f76310201036d617574686f72697a6174696f6e");
    NSData *candidate = Hex(
        @"a60166616e632f7631020103782367656e657369732d6163636f756e742d61646d697"
         "373696f6e2d63616e6469646174650456a30166616e632f763102010369626f6f7473"
         "7"
         "4726170055819a30166616e632f76310201036c636f6e6669726d6174696f6e06581a"
         "a"
         "30166616e632f76310201036d617574686f72697a6174696f6e");
    NSData *challenge = Hex(
        @"aa0166616e632f7631020103782367656e657369732d6163636f756e742d61646d697"
        @"373696f6e2d6368616c6c656e67650478203131313131313131313131313131313131"
        @"3131313131313131313131313131310578486163636f756e743a32323232323232323"
        @"232323232323232323232323232323232323232323232323232323232323232323232"
        @"32323232323232323232323232323232323232323206784a776f726b73706163653a3"
        @"333333333333333333333333333333333333333333333333333333333333333333333"
        @"3333333333333333333333333333333333333333333333333333333333075820673fe"
        @"6f86c355c876ee10ca2442b0e0051b16afd2a4c11b3f5cc27959dd86cdb0878183230"
        @"32362d30372d31385431323a30303a30302e3030305a097818323032362d30372d313"
        @"85431323a30353a30302e3030305a0a58204444444444444444444444444444444444"
        @"444444444444444444444444444444");
    NSData *request = Hex(
        @"a50166616e632f7631020103782167656e657369732d6163636f756e742d61646d697"
        @"373696f6e2d72657175657374045882a60166616e632f7631020103782367656e6573"
        @"69732d6163636f756e742d61646d697373696f6e2d63616e6469646174650456a3016"
        @"6616e632f763102010369626f6f747374726170055819a30166616e632f7631020103"
        @"6c636f6e6669726d6174696f6e06581aa30166616e632f76310201036d617574686f7"
        @"2697a6174696f6e05590168aa0166616e632f7631020103782367656e657369732d61"
        @"63636f756e742d61646d697373696f6e2d6368616c6c656e676504782031313131313"
        @"131313131313131313131313131313131313131313131313131310578486163636f75"
        @"6e743a323232323232323232323232323232323232323232323232323232323232323"
        @"232323232323232323232323232323232323232323232323232323232323232320678"
        @"4a776f726b73706163653a33333333333333333333333333333333333333333333333"
        @"333333333333333333333333333333333333333333333333333333333333333333333"
        @"333333333333075820673fe6f86c355c876ee10ca2442b0e0051b16afd2a4c11b3f5c"
        @"c27959dd86cdb087818323032362d30372d31385431323a30303a30302e3030305a09"
        @"7818323032362d30372d31385431323a30353a30302e3030305a0a582044444444444"
        @"44444444444444444444444444444444444444444444444444444");
    NSData *receipt = Hex(
        @"ab0166616e632f7631020103782167656e657369732d6163636f756e742d61646d697"
        @"373696f6e2d726563656970740478486163636f756e743a3232323232323232323232"
        @"323232323232323232323232323232323232323232323232323232323232323232323"
        @"232323232323232323232323232323232323205784a776f726b73706163653a333333"
        @"333333333333333333333333333333333333333333333333333333333333333333333"
        @"333333333333333333333333333333333333333333333333333330678203535353535"
        @"353535353535353535353535353535353535353535353535353535077820363636363"
        @"636363636363636363636363636363636363636363636363636363608582077777777"
        @"777777777777777777777777777777777777777777777777777777770978203838383"
        @"8383838383838383838383838383838383838383838383838383838380a5820673fe6"
        @"f86c355c876ee10ca2442b0e0051b16afd2a4c11b3f5cc27959dd86cdb0b582099999"
        @"99999999999999999999999999999999999999999999999999999999999");

    AncPrivateVaultGenesisAdmissionStatus status;
    assert([[AncPrivateVaultGenesisAdmissionCandidateEncode(
        bootstrap, confirmation, authorization, &status) copy]
        isEqualToData:candidate]);
    assert(status == AncPrivateVaultGenesisAdmissionStatusOK);
    AncPrivateVaultGenesisAdmissionChallenge *decoded =
        AncPrivateVaultGenesisAdmissionChallengeDecode(
            challenge, candidate, 1784376150000ULL, &status);
    assert(decoded != nil && status == AncPrivateVaultGenesisAdmissionStatusOK);
    assert([decoded.accountId hasPrefix:@"account:"] &&
           [decoded.workspaceId hasPrefix:@"workspace:"]);
    assert([[AncPrivateVaultGenesisAdmissionRequestEncode(
        candidate, challenge, &status) copy] isEqualToData:request]);

    AncPrivateVaultGenesisAdmissionReceipt *decodedReceipt =
        AncPrivateVaultGenesisAdmissionReceiptDecode(
            receipt, decoded, candidate, @"55555555555555555555555555555555",
            @"66666666666666666666666666666666",
            [NSData dataWithBytes:(uint8_t[32]){[0 ... 31] = 0x77} length:32],
            @"88888888888888888888888888888888",
            [NSData dataWithBytes:(uint8_t[32]){[0 ... 31] = 0x99} length:32],
            &status);
    assert(decodedReceipt != nil &&
           status == AncPrivateVaultGenesisAdmissionStatusOK);

    NSMutableData *substituted = [candidate mutableCopy];
    ((uint8_t *)substituted.mutableBytes)[substituted.length - 1] ^= 1;
    assert(AncPrivateVaultGenesisAdmissionChallengeDecode(
               challenge, substituted, 1784376150000ULL, &status) == nil);
    assert(status == AncPrivateVaultGenesisAdmissionStatusBindingMismatch ||
           status == AncPrivateVaultGenesisAdmissionStatusInvalid);
    assert(AncPrivateVaultGenesisAdmissionChallengeDecode(
               challenge, candidate, 1784376300000ULL, &status) == nil);
    assert(status == AncPrivateVaultGenesisAdmissionStatusExpired);
    assert(AncPrivateVaultGenesisAdmissionReceiptDecode(
               receipt, decoded, candidate, @"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
               @"66666666666666666666666666666666",
               [NSData dataWithBytes:(uint8_t[32]){[0 ... 31] = 0x77}
                              length:32],
               @"88888888888888888888888888888888",
               [NSData dataWithBytes:(uint8_t[32]){[0 ... 31] = 0x99}
                              length:32],
               &status) == nil);
    assert(status == AncPrivateVaultGenesisAdmissionStatusBindingMismatch);
    fprintf(stdout, "private vault genesis account admission tests passed\n");
  }
  return 0;
}
