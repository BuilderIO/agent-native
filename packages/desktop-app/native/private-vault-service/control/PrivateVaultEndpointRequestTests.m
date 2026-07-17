#import <Foundation/Foundation.h>

#include <assert.h>

#import "PrivateVaultCrypto.h"
#import "PrivateVaultEndpointRequest.h"

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
    anc_pv_zeroize(seed, sizeof seed);
    puts("endpoint request tests passed");
  }
  return 0;
}
