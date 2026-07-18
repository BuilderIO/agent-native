#import <Foundation/Foundation.h>

#include <assert.h>

#import "PrivateVaultCrypto.h"
#import "PrivateVaultEndpointRequest.h"
#import "PrivateVaultGenesisHostedAppend.h"
#import "PrivateVaultAncCanonical.h"

static NSData *Hex(NSString *value) {
  NSMutableData *data = [NSMutableData dataWithLength:value.length / 2];
  uint8_t *bytes = data.mutableBytes;
  for (NSUInteger index = 0; index < data.length; index += 1) {
    unsigned int byte = 0;
    assert([[NSScanner
        scannerWithString:[value substringWithRange:NSMakeRange(index * 2, 2)]]
        scanHexInt:&byte]);
    bytes[index] = (uint8_t)byte;
  }
  return data;
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    AncPrivateVaultEndpointRequestStatus status;
    NSData *signedEntry = [NSData dataWithBytes:(uint8_t[]){1, 2, 3} length:3];
    NSData *recoveryWrap = [NSData dataWithBytes:(uint8_t[]){4, 5} length:2];
    NSData *body = AncPrivateVaultControlLogAppendRequestEncode(
        signedEntry, recoveryWrap, &status);
    assert(status == AncPrivateVaultEndpointRequestStatusOK);
    assert([body
        isEqualToData:
            Hex(@"a50166616e632f76310201037823636f6e74726f6c2d6c6f672d726f74617"
                @"4696f6e2d617070656e642d72657175657374044301020305420405")]);
    NSData *recoveryBody =
        AncPrivateVaultControlLogRecoveryAppendRequestEncode(
            signedEntry, recoveryWrap, [NSData dataWithBytes:(uint8_t[]){6}
                                                     length:1],
            [NSData dataWithBytes:(uint8_t[]){7, 8} length:2], &status);
    assert(status == AncPrivateVaultEndpointRequestStatusOK);
    assert([recoveryBody
        isEqualToData:
            Hex(@"a70166616e632f76310201037823636f6e74726f6c2d6c6f672d7265636"
                @"f766572792d617070656e642d726571756573740443010203054204050641"
                @"0607420708")]);
    AncPrivateVaultCanonicalStatus canonicalStatus;
    NSData *receiptBytes = AncPrivateVaultCanonicalEncode(
        [AncPrivateVaultCanonicalValue map:@{
          @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
          @2 : [AncPrivateVaultCanonicalValue integer:1],
          @3 : [AncPrivateVaultCanonicalValue
                   text:@"control-log-recovery-append-receipt"],
          @4 : [AncPrivateVaultCanonicalValue
                   text:@"21212121212121212121212121212121"],
          @5 : [AncPrivateVaultCanonicalValue
                   text:@"39393939393939393939393939393939"],
          @6 : [AncPrivateVaultCanonicalValue integer:1],
          @7 : [AncPrivateVaultCanonicalValue bytes:
                   [NSData dataWithBytes:(uint8_t[32]){0x44} length:32]],
          @8 : [AncPrivateVaultCanonicalValue bytes:
                   [NSData dataWithBytes:(uint8_t[32]){0x55} length:32]],
          @9 : [AncPrivateVaultCanonicalValue integer:64],
        }],
        &canonicalStatus);
    assert(receiptBytes != nil &&
           canonicalStatus == AncPrivateVaultCanonicalStatusOK);
    AncPrivateVaultRecoveryHostedAppendReceipt *recoveryReceipt =
        AncPrivateVaultRecoveryHostedAppendReceiptDecode(receiptBytes);
    assert(recoveryReceipt != nil && recoveryReceipt.sequence == 1 &&
           recoveryReceipt.recoveryWrapByteLength == 64 &&
           recoveryReceipt.headHash.length == 32 &&
           recoveryReceipt.recoveryWrapHash.length == 32);
    NSMutableData *nonCanonicalReceipt = [receiptBytes mutableCopy];
    [nonCanonicalReceipt appendBytes:(uint8_t[]){0} length:1];
    assert(AncPrivateVaultRecoveryHostedAppendReceiptDecode(
               nonCanonicalReceipt) == nil);

    uint8_t seed[32];
    for (NSUInteger index = 0; index < sizeof seed; index += 1)
      seed[index] = (uint8_t)(index + 1);
    uint8_t publicKey[32] = {0};
    uint8_t privateKey[64] = {0};
    assert(anc_pv_ed25519_seed_keypair(publicKey, privateKey, seed) ==
           ANC_PV_CRYPTO_OK);
    anc_pv_zeroize(privateKey, sizeof privateKey);
    NSData *expectedPublicKey = [NSData dataWithBytes:publicKey
                                               length:sizeof publicKey];
    anc_pv_zeroize(publicKey, sizeof publicKey);

    NSString *header = AncPrivateVaultControlLogAppendProofHeaderCreate(
        @"vault-auth-0001", @"endpoint-auth-0001", body,
        @"2026-07-17T01:00:00.000Z", @"0123456789abcdef0123456789abcdef", seed,
        expectedPublicKey, &status);
    assert(status == AncPrivateVaultEndpointRequestStatusOK);
    assert([header
        isEqualToString:
            @"eyJ2ZXJzaW9uIjoxLCJzdWl0ZSI6ImFuYy92MSIsInR5cGUiOiJlbmRwb2ludF9yZ"
            @"XF1ZXN0IiwidmF1bHRJZCI6InZhdWx0LWF1dGgtMDAwMSIsImVuZHBvaW50SWQiOi"
            @"JlbmRwb2ludC1hdXRoLTAwMDEiLCJtZXRob2QiOiJQT1NUIiwicGF0aCI6Ii9hcGk"
            @"vcHJpdmF0ZS12YXVsdC9jb250cm9sLWxvZy9hcHBlbmQiLCJib2R5SGFzaCI6IjY4"
            @"MjFiZmU1Y2I5MDJmNWRjZmM4NDcwMDZiYTBlNzRkM2YxYTY1ODg0MTQ2MzQwOTQzZ"
            @"jRiZTJlNWM5NWY3M2UiLCJpc3N1ZWRBdCI6IjIwMjYtMDctMTdUMDE6MDA6MDAuMD"
            @"AwWiIsIm5vbmNlIjoiMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYiLCJ"
            @"zaWduYXR1cmUiOiJkZDRhYjIxMTljYWY0ZjJlODRlYmRiMGIyN2IzN2FjZDY3NWIz"
            @"ZWUzYWMzZDE1MTU1ZWFkZjAxNGEyYzgyZWIyMzlmZWJkOGI4Y2UyM2E5MjVmZTkwZ"
            @"GEzMDZiNDA3MTI4NzNkMDc5YzY5NGJjZmIxNTAzZjNjYjY4Mjg4NjYwNiJ9"]);

    NSMutableData *wrongPublic = [expectedPublicKey mutableCopy];
    ((uint8_t *)wrongPublic.mutableBytes)[0] ^= 1;
    assert(AncPrivateVaultControlLogAppendProofHeaderCreate(
               @"vault-auth-0001", @"endpoint-auth-0001", body,
               @"2026-07-17T01:00:00.000Z", @"0123456789abcdef0123456789abcdef",
               seed, wrongPublic, &status) == nil);
    assert(status == AncPrivateVaultEndpointRequestStatusIdentityMismatch);
    assert(AncPrivateVaultControlLogAppendProofHeaderCreate(
               @"vault-auth-0001", @"endpoint-auth-0001", body,
               @"2026-07-17T01:00:00Z", @"0123456789abcdef0123456789abcdef",
               seed, expectedPublicKey, &status) == nil);
    assert(AncPrivateVaultControlLogAppendProofHeaderCreate(
               @"vault-auth-0001", @"endpoint-auth-0001", body,
               @"2026-07-17T01:00:00.000Z", @"ABCDEF", seed, expectedPublicKey,
               &status) == nil);
    assert(AncPrivateVaultControlLogAppendProofHeaderCreate(
               @"bad", @"endpoint-auth-0001", body, @"2026-07-17T01:00:00.000Z",
               @"0123456789abcdef0123456789abcdef", seed, expectedPublicKey,
               &status) == nil);
    assert(AncPrivateVaultControlLogAppendRequestEncode(
               [NSData data], recoveryWrap, &status) == nil);
    NSMutableData *oversized = [NSMutableData dataWithLength:1024 * 1024 + 1];
    assert(AncPrivateVaultControlLogAppendRequestEncode(signedEntry, oversized,
                                                        &status) == nil);
    assert(status == AncPrivateVaultEndpointRequestStatusTooLarge);
    assert(AncPrivateVaultControlLogRecoveryAppendRequestEncode(
               signedEntry, recoveryWrap, NSData.data, NSData.data,
               &status) == nil);
    oversized = [NSMutableData dataWithLength:64 * 1024 + 1];
    assert(AncPrivateVaultControlLogRecoveryAppendRequestEncode(
               signedEntry, recoveryWrap, oversized, NSData.data,
               &status) == nil);
    assert(status == AncPrivateVaultEndpointRequestStatusTooLarge);
    anc_pv_zeroize(seed, sizeof seed);
    puts("endpoint request tests passed");
  }
  return 0;
}
