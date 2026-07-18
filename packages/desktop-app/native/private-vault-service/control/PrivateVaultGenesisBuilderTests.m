#import <Foundation/Foundation.h>

#import "PrivateVaultCrypto.h"
#import "PrivateVaultGenesisBuilder.h"
#import "PrivateVaultGenesisAuthorization.h"
#import "PrivateVaultGenesisBootstrap.h"
#import "PrivateVaultRecoveryAuthority.h"
#import "PrivateVaultRecoveryWrap.h"

#define CHECK(condition)                                                       \
  do {                                                                         \
    if (!(condition)) {                                                        \
      fprintf(stderr, "genesis builder test failed at line %d\n", __LINE__); \
      return 1;                                                                \
    }                                                                          \
  } while (0)

@interface AncGenesisSentinelData : NSData {
@public
  NSUInteger _lengthReads;
  BOOL _throwOnLength;
  BOOL _throwOnGetBytes;
  BOOL _changeAfterRead;
}
@end
@implementation AncGenesisSentinelData
- (NSUInteger)length {
  _lengthReads += 1;
  if (_throwOnLength) [NSException raise:@"sentinel" format:@"length"];
  return _changeAfterRead && _lengthReads > 1 ? 17 : 16;
}
- (const void *)bytes { return NULL; }
- (void)getBytes:(void *)buffer range:(NSRange)range {
  if (_throwOnGetBytes) [NSException raise:@"sentinel" format:@"getBytes"];
  memset(buffer, 0, range.length);
}
@end

static AncPrivateVaultGuardedMemory *Guarded(NSData *data) {
  AncPrivateVaultGuardedMemoryStatus status;
  AncPrivateVaultGuardedMemory *memory =
      [AncPrivateVaultGuardedMemory memoryWithLength:data.length status:&status];
  if (memory == nil) return nil;
  if ([memory borrow:^BOOL(uint8_t *bytes, size_t length) {
        if (length != data.length) return NO;
        memcpy(bytes, data.bytes, length);
        return YES;
      }] != AncPrivateVaultGuardedMemoryStatusOK) {
    [memory close];
    return nil;
  }
  return memory;
}

static uint64_t U64(NSData *data) {
  if (data.length != 8) return 0;
  const uint8_t *b = data.bytes;
  uint64_t value = 0;
  for (NSUInteger index = 0; index < 8; index++) value = (value << 8) | b[index];
  return value;
}

static NSArray<NSData *> *ReadOracle(void) {
  NSFileHandle *input = NSFileHandle.fileHandleWithStandardInput;
  NSMutableData *frame = [NSMutableData data];
  while (YES) {
    NSData *chunk = [input readDataOfLength:16384];
    if (chunk.length == 0) break;
    if (frame.length + chunk.length > 1024 * 1024 + 32) return nil;
    [frame appendData:chunk];
  }
  @try {
  if (frame.length < 42) return nil;
  const uint8_t *bytes = frame.bytes;
  if (memcmp(bytes, "ANCPVG1\0", 8) != 0) return nil;
  NSUInteger bodyLength = frame.length - 32;
  uint8_t digest[32] = {0};
  static const uint8_t domain[] = "anc/v1/recovery";
  if (anc_pv_blake2b_256_two_part(digest, domain, sizeof domain, bytes,
                                  bodyLength) != ANC_PV_CRYPTO_OK ||
      anc_pv_memcmp(digest, bytes + bodyLength, 32) != ANC_PV_CRYPTO_OK) {
    anc_pv_zeroize(digest, sizeof digest);
    return nil;
  }
  anc_pv_zeroize(digest, sizeof digest);
  NSUInteger count = ((NSUInteger)bytes[8] << 8) | bytes[9], offset = 10;
  if (count != 22) return nil;
  NSMutableArray<NSData *> *fields = [NSMutableArray arrayWithCapacity:count];
  for (NSUInteger index = 0; index < count; index++) {
    if (offset + 4 > bodyLength) return nil;
    NSUInteger length = ((NSUInteger)bytes[offset] << 24) |
                        ((NSUInteger)bytes[offset + 1] << 16) |
                        ((NSUInteger)bytes[offset + 2] << 8) | bytes[offset + 3];
    offset += 4;
    if (length > 256 * 1024 || offset + length > bodyLength) return nil;
    NSData *field = index < 4
        ? [NSMutableData dataWithBytes:bytes + offset length:length]
        : [NSData dataWithBytes:bytes + offset length:length];
    [fields addObject:field];
    offset += length;
  }
  return offset == bodyLength ? fields : nil;
  } @finally {
    anc_pv_zeroize(frame.mutableBytes, frame.length);
  }
}

static AncPrivateVaultPreparedGenesisArtifacts *Build(
    NSArray<NSData *> *v, uint64_t wrapAt,
    AncPrivateVaultGuardedMemory **entropyOut,
    AncPrivateVaultGuardedMemory **eekOut,
    AncPrivateVaultGuardedMemory **signOut,
    AncPrivateVaultGuardedMemory **agreementOut,
    AncPrivateVaultGenesisBuilderStatus *status) {
  AncPrivateVaultGuardedMemory *entropy = Guarded(v[0]);
  AncPrivateVaultGuardedMemory *sign = Guarded(v[1]);
  AncPrivateVaultGuardedMemory *agreement = Guarded(v[2]);
  AncPrivateVaultGuardedMemory *eek = Guarded(v[3]);
  if (entropyOut) *entropyOut = entropy; if (eekOut) *eekOut = eek;
  if (signOut) *signOut = sign; if (agreementOut) *agreementOut = agreement;
  return AncPrivateVaultBuildGenesisArtifacts(
      entropy, sign, agreement, eek, v[4], v[5], v[6], v[7], v[8], v[9],
      v[10], v[11], wrapAt, U64(v[13]), U64(v[14]), U64(v[15]), U64(v[16]),
      status);
}

static int RunTests(NSArray<NSData *> *v) {
  CHECK(v != nil && anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
  AncPrivateVaultGuardedMemory *entropy = nil, *eek = nil, *sign = nil;
  AncPrivateVaultGuardedMemory *agreement = nil;
  AncPrivateVaultGenesisBuilderStatus status;
  AncPrivateVaultPreparedGenesisArtifacts *artifacts =
      Build(v, U64(v[12]), &entropy, &eek, &sign, &agreement, &status);
  CHECK(artifacts != nil && status == AncPrivateVaultGenesisBuilderStatusOK);
  CHECK(!sign.isClosed && !agreement.isClosed && !entropy.isClosed && !eek.isClosed);
  CHECK([artifacts.recoveryWrap isEqualToData:v[17]]);
  CHECK([artifacts.recoveryConfirmation isEqualToData:v[18]]);
  CHECK([artifacts.bootstrapTranscript isEqualToData:v[19]]);
  CHECK([artifacts.authorization isEqualToData:v[20]]);
  CHECK([artifacts.bootstrapTranscriptDigest isEqualToData:v[21]]);

  NSMutableData *mutatedWrap = [artifacts.recoveryWrap mutableCopy];
  ((uint8_t *)mutatedWrap.mutableBytes)[mutatedWrap.length - 1] ^= 1;
  AncPrivateVaultRecoveryWrapStatus wrapStatus;
  CHECK(AncPrivateVaultRecoveryWrapVerify(mutatedWrap, v[4],
            ({ uint8_t pub[32] = {0}, priv[64] = {0};
               anc_pv_ed25519_seed_keypair(pub, priv, v[1].bytes);
               anc_pv_zeroize(priv, sizeof priv);
               [NSData dataWithBytes:pub length:32]; }), &wrapStatus) == nil);
  NSMutableData *mutatedBootstrap = [artifacts.bootstrapTranscript mutableCopy];
  ((uint8_t *)mutatedBootstrap.mutableBytes)[mutatedBootstrap.length - 1] ^= 1;
  AncPrivateVaultGenesisBootstrapStatus bootstrapStatus;
  CHECK(AncPrivateVaultGenesisBootstrapVerify(
            mutatedBootstrap, artifacts.recoveryConfirmation, v[4],
            &bootstrapStatus) == nil);
  NSMutableData *mutatedAuthorization = [artifacts.authorization mutableCopy];
  ((uint8_t *)mutatedAuthorization.mutableBytes)[0] = 0;
  AncPrivateVaultGenesisAuthorizationStatus authorizationStatus;
  CHECK(!AncPrivateVaultGenesisAuthorizationDecode(
      mutatedAuthorization, v[4], &authorizationStatus));

  uint8_t endpointSigningPublic[32] = {0}, endpointSigningPrivate[64] = {0};
  uint8_t endpointAgreementPublic[32] = {0}, endpointAgreementPrivate[32] = {0};
  CHECK(anc_pv_ed25519_seed_keypair(endpointSigningPublic, endpointSigningPrivate,
                                    v[1].bytes) == ANC_PV_CRYPTO_OK);
  CHECK(anc_pv_box_seed_keypair(endpointAgreementPublic, endpointAgreementPrivate,
                                v[2].bytes) == ANC_PV_CRYPTO_OK);
  NSData *endpointSigningPublicData =
      [NSData dataWithBytes:endpointSigningPublic length:32];
  NSData *endpointAgreementPublicData =
      [NSData dataWithBytes:endpointAgreementPublic length:32];
  AncPrivateVaultRecoveryAuthorityStatus authorityStatus;
  AncPrivateVaultRecoveryAuthority *authority =
      AncPrivateVaultDeriveRecoveryAuthority(entropy, v[4], 1, &authorityStatus);
  CHECK(authority != nil);
  __block BOOL unsealed = NO;
  CHECK([authority.keyAgreementPrivateKey borrow:^BOOL(uint8_t *privateKey,
                                                        size_t length) {
    if (length != 32) return NO;
    return AncPrivateVaultRecoveryWrapUnseal(
        artifacts.recoveryWrap, v[4],
        endpointSigningPublicData, endpointAgreementPublicData, privateKey,
        ^BOOL(const uint8_t *opened) {
          unsealed = anc_pv_memcmp(opened, v[3].bytes, 32) == ANC_PV_CRYPTO_OK;
          return unsealed;
        }) == AncPrivateVaultRecoveryWrapStatusOK;
  }] == AncPrivateVaultGuardedMemoryStatusOK && unsealed);
  NSMutableData *wrongEntropyBytes = [v[0] mutableCopy];
  ((uint8_t *)wrongEntropyBytes.mutableBytes)[0] ^= 1;
  AncPrivateVaultGuardedMemory *wrongEntropy = Guarded(wrongEntropyBytes);
  AncPrivateVaultRecoveryAuthority *wrongAuthority =
      AncPrivateVaultDeriveRecoveryAuthority(wrongEntropy, v[4], 1,
                                             &authorityStatus);
  CHECK(wrongAuthority != nil);
  CHECK([wrongAuthority.keyAgreementPrivateKey borrow:^BOOL(
      uint8_t *privateKey, size_t length) {
    if (length != 32) return NO;
    AncPrivateVaultRecoveryWrapStatus wrongStatus =
        AncPrivateVaultRecoveryWrapUnseal(
            artifacts.recoveryWrap, v[4], endpointSigningPublicData,
            endpointAgreementPublicData, privateKey,
            ^BOOL(__unused const uint8_t *opened) { return YES; });
    return wrongStatus != AncPrivateVaultRecoveryWrapStatusOK;
  }] == AncPrivateVaultGuardedMemoryStatusOK);
  [wrongAuthority.signingPrivateKey close];
  [wrongAuthority.keyAgreementPrivateKey close];
  [wrongEntropy close];
  anc_pv_zeroize(wrongEntropyBytes.mutableBytes, wrongEntropyBytes.length);
  anc_pv_zeroize(endpointSigningPrivate, sizeof endpointSigningPrivate);
  anc_pv_zeroize(endpointAgreementPrivate, sizeof endpointAgreementPrivate);
  anc_pv_zeroize(endpointSigningPublic, sizeof endpointSigningPublic);
  anc_pv_zeroize(endpointAgreementPublic, sizeof endpointAgreementPublic);
  [authority.signingPrivateKey close]; [authority.keyAgreementPrivateKey close];

  AncPrivateVaultGuardedMemory *badEntropy = nil, *badEEK = nil, *badSign = nil;
  AncPrivateVaultGuardedMemory *badAgreement = nil;
  CHECK(Build(v, U64(v[13]) + 1, &badEntropy, &badEEK, &badSign, &badAgreement,
              &status) == nil);
  CHECK(status == AncPrivateVaultGenesisBuilderStatusTimestampOrder);
  CHECK(!badSign.isClosed && !badAgreement.isClosed);
  [badEntropy close]; [badEEK close]; [badSign close]; [badAgreement close];

  for (NSNumber *indexValue in @[ @0, @1, @4, @11 ]) {
    NSUInteger index = indexValue.unsignedIntegerValue;
    NSMutableArray<NSData *> *changed = [v mutableCopy];
    NSMutableData *field = [v[index] mutableCopy];
    ((uint8_t *)field.mutableBytes)[0] ^= 0x80;
    changed[index] = field;
    AncPrivateVaultGuardedMemory *a = nil, *b = nil, *c = nil, *d = nil;
    AncPrivateVaultPreparedGenesisArtifacts *different =
        Build(changed, U64(changed[12]), &a, &d, &b, &c, &status);
    CHECK(different != nil && status == AncPrivateVaultGenesisBuilderStatusOK);
    CHECK(![different.authorization isEqualToData:artifacts.authorization]);
    [a close]; [b close]; [c close]; [d close];
    if (index < 4) anc_pv_zeroize(field.mutableBytes, field.length);
  }

  AncPrivateVaultGuardedMemory *closedEntropy = Guarded(v[0]);
  AncPrivateVaultGuardedMemory *closedSign = Guarded(v[1]);
  AncPrivateVaultGuardedMemory *closedAgreement = Guarded(v[2]);
  AncPrivateVaultGuardedMemory *closedEEK = Guarded(v[3]);
  [closedEEK close];
  CHECK(AncPrivateVaultBuildGenesisArtifacts(
            closedEntropy, closedSign, closedAgreement, closedEEK, v[4], v[5],
            v[6], v[7], v[8], v[9], v[10], v[11], U64(v[12]), U64(v[13]),
            U64(v[14]), U64(v[15]), U64(v[16]), &status) == nil);
  CHECK(status == AncPrivateVaultGenesisBuilderStatusInvalidArgument);
  [closedEntropy close]; [closedSign close]; [closedAgreement close];

  for (NSUInteger mode = 0; mode < 3; mode++) {
    AncGenesisSentinelData *sentinel = [AncGenesisSentinelData new];
    sentinel->_throwOnLength = mode == 0; sentinel->_throwOnGetBytes = mode == 1;
    sentinel->_changeAfterRead = mode == 2;
    AncPrivateVaultGuardedMemory *a = Guarded(v[0]), *b = Guarded(v[1]);
    AncPrivateVaultGuardedMemory *c = Guarded(v[2]), *d = Guarded(v[3]);
    CHECK(AncPrivateVaultBuildGenesisArtifacts(
              a, b, c, d, sentinel, v[5], v[6], v[7], v[8], v[9], v[10],
              v[11], U64(v[12]), U64(v[13]), U64(v[14]), U64(v[15]),
              U64(v[16]), &status) == nil);
    CHECK(status == AncPrivateVaultGenesisBuilderStatusInvalidArgument);
    CHECK(!b.isClosed && !c.isClosed);
    [a close]; [b close]; [c close]; [d close];
  }
  [entropy close]; [eek close]; [sign close]; [agreement close];
  return 0;
}

int main(void) {
  @autoreleasepool {
    CHECK(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    NSArray<NSData *> *oracle = ReadOracle();
    int result = RunTests(oracle);
    for (NSUInteger index = 0; index < MIN((NSUInteger)4, oracle.count); index++) {
      NSMutableData *secret = (NSMutableData *)oracle[index];
      anc_pv_zeroize(secret.mutableBytes, secret.length);
    }
    return result;
  }
}
