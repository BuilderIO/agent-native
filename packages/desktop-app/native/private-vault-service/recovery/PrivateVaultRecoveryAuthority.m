#import "PrivateVaultRecoveryAuthority.h"

#import "PrivateVaultCrypto.h"

static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);
static const uint8_t kRecoveryAuthorityDomain[] = "anc/v1/recovery-authority";

@interface AncPrivateVaultRecoveryAuthority ()
- (instancetype)initPrivateWithGeneration:(uint64_t)generation
                               recoveryId:(NSData *)recoveryId
                         signingPublicKey:(NSData *)signingPublicKey
                    keyAgreementPublicKey:(NSData *)keyAgreementPublicKey
                        signingPrivateKey:
                            (AncPrivateVaultGuardedMemory *)signingPrivateKey
                   keyAgreementPrivateKey:
                       (AncPrivateVaultGuardedMemory *)keyAgreementPrivateKey;
@end

@implementation AncPrivateVaultRecoveryAuthority
@synthesize recoveryGeneration = _recoveryGeneration;
@synthesize recoveryId = _recoveryId;
@synthesize signingPublicKey = _signingPublicKey;
@synthesize keyAgreementPublicKey = _keyAgreementPublicKey;
@synthesize signingPrivateKey = _signingPrivateKey;
@synthesize keyAgreementPrivateKey = _keyAgreementPrivateKey;
+ (BOOL)accessInstanceVariablesDirectly {
  return NO;
}
- (instancetype)initPrivateWithGeneration:(uint64_t)generation
                               recoveryId:(NSData *)recoveryId
                         signingPublicKey:(NSData *)signingPublicKey
                    keyAgreementPublicKey:(NSData *)keyAgreementPublicKey
                        signingPrivateKey:
                            (AncPrivateVaultGuardedMemory *)signingPrivateKey
                   keyAgreementPrivateKey:
                       (AncPrivateVaultGuardedMemory *)keyAgreementPrivateKey {
  self = [super init];
  if (self != nil) {
    _recoveryGeneration = generation;
    _recoveryId = [recoveryId copy];
    _signingPublicKey = [signingPublicKey copy];
    _keyAgreementPublicKey = [keyAgreementPublicKey copy];
    _signingPrivateKey = signingPrivateKey;
    _keyAgreementPrivateKey = keyAgreementPrivateKey;
  }
  return self;
}
@end

static void SetStatus(AncPrivateVaultRecoveryAuthorityStatus *status,
                      AncPrivateVaultRecoveryAuthorityStatus value) {
  if (status != NULL)
    *status = value;
}

static AncPrivateVaultGuardedMemory *
AllocateGuarded(size_t length, AncPrivateVaultRecoveryAuthorityStatus *status) {
  AncPrivateVaultGuardedMemoryStatus memoryStatus;
  AncPrivateVaultGuardedMemory *memory =
      [AncPrivateVaultGuardedMemory memoryWithLength:length
                                              status:&memoryStatus];
  if (memory == nil)
    SetStatus(status, AncPrivateVaultRecoveryAuthorityStatusMemoryFailed);
  return memory;
}

typedef struct AncRecoveryCbor {
  uint8_t bytes[128];
  size_t length;
  BOOL valid;
} AncRecoveryCbor;

static void AppendRaw(AncRecoveryCbor *output, const void *bytes,
                      size_t length) {
  if (!output->valid || length > sizeof output->bytes - output->length) {
    output->valid = NO;
    return;
  }
  memcpy(output->bytes + output->length, bytes, length);
  output->length += length;
}

static void AppendUnsigned(AncRecoveryCbor *output, uint8_t major,
                           uint64_t value) {
  uint8_t bytes[9] = {0};
  size_t count = 1;
  if (value < 24) {
    bytes[0] = (uint8_t)((major << 5) | value);
  } else {
    size_t width = value <= UINT8_MAX    ? 1
                   : value <= UINT16_MAX ? 2
                   : value <= UINT32_MAX ? 4
                                         : 8;
    bytes[0] = (uint8_t)((major << 5) | (width == 1   ? 24
                                         : width == 2 ? 25
                                         : width == 4 ? 26
                                                      : 27));
    count += width;
    for (size_t index = 0; index < width; index += 1)
      bytes[width - index] = (uint8_t)(value >> (index * 8));
  }
  AppendRaw(output, bytes, count);
  anc_pv_zeroize(bytes, sizeof bytes);
}

static void AppendText(AncRecoveryCbor *output, const char *text) {
  size_t length = strlen(text);
  AppendUnsigned(output, 3, length);
  AppendRaw(output, text, length);
}

static void AppendBytes(AncRecoveryCbor *output, const uint8_t *bytes,
                        size_t length) {
  AppendUnsigned(output, 2, length);
  AppendRaw(output, bytes, length);
}

static AncRecoveryCbor AuthorityPreimage(const uint8_t vaultId[16],
                                         uint64_t generation,
                                         const char *purpose,
                                         const uint8_t root[32]) {
  AncRecoveryCbor output = {.length = 0, .valid = YES};
  AppendUnsigned(&output, 5, 5);
  AppendUnsigned(&output, 0, 1);
  AppendText(&output, "anc/v1");
  AppendUnsigned(&output, 0, 2);
  AppendBytes(&output, vaultId, 16);
  AppendUnsigned(&output, 0, 3);
  AppendText(&output, purpose);
  AppendUnsigned(&output, 0, 204);
  AppendBytes(&output, root, 32);
  AppendUnsigned(&output, 0, 205);
  AppendUnsigned(&output, 0, generation);
  return output;
}

static AncRecoveryCbor
RecoveryIdPreimage(const uint8_t vaultId[16], uint64_t generation,
                   const uint8_t signingPublicKey[32],
                   const uint8_t keyAgreementPublicKey[32]) {
  AncRecoveryCbor output = {.length = 0, .valid = YES};
  AppendUnsigned(&output, 5, 5);
  AppendUnsigned(&output, 0, 1);
  AppendText(&output, "anc/v1");
  AppendUnsigned(&output, 0, 2);
  AppendBytes(&output, vaultId, 16);
  AppendUnsigned(&output, 0, 205);
  AppendUnsigned(&output, 0, generation);
  AppendUnsigned(&output, 0, 363);
  AppendBytes(&output, signingPublicKey, 32);
  AppendUnsigned(&output, 0, 364);
  AppendBytes(&output, keyAgreementPublicKey, 32);
  return output;
}

static BOOL DomainHash(uint8_t output[32], AncRecoveryCbor *preimage) {
  BOOL okay = preimage->valid &&
              anc_pv_blake2b_256_two_part(output, kRecoveryAuthorityDomain,
                                          sizeof kRecoveryAuthorityDomain,
                                          preimage->bytes,
                                          preimage->length) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(preimage->bytes, sizeof preimage->bytes);
  preimage->length = 0;
  preimage->valid = NO;
  return okay;
}

static BOOL DeriveSeed(AncPrivateVaultGuardedMemory *root,
                       const uint8_t vaultId[16], uint64_t generation,
                       const char *purpose,
                       AncPrivateVaultGuardedMemory *seed) {
  __block BOOL derived = NO;
  AncPrivateVaultGuardedMemoryStatus rootStatus =
      [root borrow:^BOOL(uint8_t *rootBytes, size_t rootLength) {
        if (rootLength != 32)
          return NO;
        __block AncRecoveryCbor preimage =
            AuthorityPreimage(vaultId, generation, purpose, rootBytes);
        AncPrivateVaultGuardedMemoryStatus seedStatus =
            [seed borrow:^BOOL(uint8_t *seedBytes, size_t seedLength) {
              if (seedLength != 32)
                return NO;
              derived = DomainHash(seedBytes, &preimage);
              return derived;
            }];
        if (seedStatus != AncPrivateVaultGuardedMemoryStatusOK) {
          anc_pv_zeroize(preimage.bytes, sizeof preimage.bytes);
          return NO;
        }
        return YES;
      }];
  return rootStatus == AncPrivateVaultGuardedMemoryStatusOK && derived;
}

AncPrivateVaultRecoveryAuthority *AncPrivateVaultDeriveRecoveryAuthority(
    AncPrivateVaultGuardedMemory *recoveryEntropy, NSData *vaultId,
    uint64_t recoveryGeneration,
    AncPrivateVaultRecoveryAuthorityStatus *status) {
  SetStatus(status, AncPrivateVaultRecoveryAuthorityStatusInvalidArgument);
  if (recoveryEntropy == nil || recoveryEntropy.length != 32 || vaultId == nil)
    return nil;
  if (recoveryGeneration < 1 || recoveryGeneration > kMaximumSafeInteger) {
    SetStatus(status, AncPrivateVaultRecoveryAuthorityStatusOutOfRange);
    return nil;
  }
  if (anc_pv_crypto_init() != ANC_PV_CRYPTO_OK) {
    SetStatus(status, AncPrivateVaultRecoveryAuthorityStatusCryptoFailed);
    return nil;
  }
  uint8_t vaultSnapshot[16] = {0};
  uint8_t *vaultSnapshotBytes = vaultSnapshot;
  @try {
    NSUInteger observedLength = vaultId.length;
    if (observedLength != sizeof vaultSnapshot)
      return nil;
    [vaultId getBytes:vaultSnapshot range:NSMakeRange(0, observedLength)];
    if (vaultId.length != observedLength) {
      anc_pv_zeroize(vaultSnapshot, sizeof vaultSnapshot);
      return nil;
    }
  } @catch (__unused NSException *exception) {
    anc_pv_zeroize(vaultSnapshot, sizeof vaultSnapshot);
    return nil;
  }

  AncPrivateVaultGuardedMemory *root = AllocateGuarded(32, status);
  AncPrivateVaultGuardedMemory *signingSeed = AllocateGuarded(32, status);
  AncPrivateVaultGuardedMemory *agreementSeed = AllocateGuarded(32, status);
  AncPrivateVaultGuardedMemory *signingPrivate = AllocateGuarded(64, status);
  AncPrivateVaultGuardedMemory *agreementPrivate = AllocateGuarded(32, status);
  if (root == nil || signingSeed == nil || agreementSeed == nil ||
      signingPrivate == nil || agreementPrivate == nil) {
    [root close];
    [signingSeed close];
    [agreementSeed close];
    [signingPrivate close];
    [agreementPrivate close];
    anc_pv_zeroize(vaultSnapshot, sizeof vaultSnapshot);
    return nil;
  }

  __block BOOL rootDerived = NO;
  AncPrivateVaultGuardedMemoryStatus rootStatus =
      [root borrow:^BOOL(uint8_t *rootBytes, size_t rootLength) {
        if (rootLength != 32)
          return NO;
        AncPrivateVaultGuardedMemoryStatus entropyStatus = [recoveryEntropy
            borrow:^BOOL(uint8_t *entropyBytes, size_t entropyLength) {
              if (entropyLength != 32)
                return NO;
              rootDerived =
                  anc_pv_argon2id(rootBytes, entropyBytes, entropyLength,
                                  vaultSnapshotBytes) == ANC_PV_CRYPTO_OK;
              return rootDerived;
            }];
        return entropyStatus == AncPrivateVaultGuardedMemoryStatusOK &&
               rootDerived;
      }];
  const uint8_t *vaultBytes = vaultSnapshot;
  BOOL signingSeedDerived =
      rootStatus == AncPrivateVaultGuardedMemoryStatusOK && rootDerived &&
      DeriveSeed(root, vaultBytes, recoveryGeneration, "signing", signingSeed);
  BOOL agreementSeedDerived =
      signingSeedDerived && DeriveSeed(root, vaultBytes, recoveryGeneration,
                                       "key-agreement", agreementSeed);
  uint8_t signingPublic[32] = {0};
  uint8_t agreementPublic[32] = {0};
  uint8_t *signingPublicBytes = signingPublic;
  uint8_t *agreementPublicBytes = agreementPublic;
  __block BOOL signingKeysDerived = NO;
  AncPrivateVaultGuardedMemoryStatus signingSeedStatus =
      agreementSeedDerived
          ? [signingSeed borrow:^BOOL(uint8_t *seedBytes, size_t seedLength) {
              if (seedLength != 32)
                return NO;
              AncPrivateVaultGuardedMemoryStatus privateStatus = [signingPrivate
                  borrow:^BOOL(uint8_t *privateBytes, size_t privateLength) {
                    if (privateLength != 64)
                      return NO;
                    signingKeysDerived = anc_pv_ed25519_seed_keypair(
                                             signingPublicBytes, privateBytes,
                                             seedBytes) == ANC_PV_CRYPTO_OK;
                    return signingKeysDerived;
                  }];
              return privateStatus == AncPrivateVaultGuardedMemoryStatusOK &&
                     signingKeysDerived;
            }]
          : AncPrivateVaultGuardedMemoryStatusCallbackFailed;
  __block BOOL agreementKeysDerived = NO;
  AncPrivateVaultGuardedMemoryStatus agreementSeedStatus =
      signingSeedStatus == AncPrivateVaultGuardedMemoryStatusOK &&
              signingKeysDerived
          ? [agreementSeed borrow:^BOOL(uint8_t *seedBytes, size_t seedLength) {
              if (seedLength != 32)
                return NO;
              AncPrivateVaultGuardedMemoryStatus privateStatus =
                  [agreementPrivate borrow:^BOOL(uint8_t *privateBytes,
                                                 size_t privateLength) {
                    if (privateLength != 32)
                      return NO;
                    agreementKeysDerived =
                        anc_pv_box_seed_keypair(agreementPublicBytes,
                                                privateBytes,
                                                seedBytes) == ANC_PV_CRYPTO_OK;
                    return agreementKeysDerived;
                  }];
              return privateStatus == AncPrivateVaultGuardedMemoryStatusOK &&
                     agreementKeysDerived;
            }]
          : AncPrivateVaultGuardedMemoryStatusCallbackFailed;

  uint8_t recoveryHash[32] = {0};
  AncRecoveryCbor recoveryIdPreimage = RecoveryIdPreimage(
      vaultBytes, recoveryGeneration, signingPublic, agreementPublic);
  BOOL recoveryIdDerived =
      agreementSeedStatus == AncPrivateVaultGuardedMemoryStatusOK &&
      agreementKeysDerived && DomainHash(recoveryHash, &recoveryIdPreimage);
  AncPrivateVaultGuardedMemoryStatus rootCloseStatus = [root close];
  AncPrivateVaultGuardedMemoryStatus signingSeedCloseStatus =
      [signingSeed close];
  AncPrivateVaultGuardedMemoryStatus agreementSeedCloseStatus =
      [agreementSeed close];
  BOOL intermediatesClosed =
      rootCloseStatus == AncPrivateVaultGuardedMemoryStatusOK &&
      signingSeedCloseStatus == AncPrivateVaultGuardedMemoryStatusOK &&
      agreementSeedCloseStatus == AncPrivateVaultGuardedMemoryStatusOK;
  recoveryIdDerived = recoveryIdDerived && intermediatesClosed;
  if (!recoveryIdDerived) {
    AncPrivateVaultGuardedMemoryStatus signingPrivateCloseStatus =
        [signingPrivate close];
    AncPrivateVaultGuardedMemoryStatus agreementPrivateCloseStatus =
        [agreementPrivate close];
    BOOL privateKeysClosed =
        signingPrivateCloseStatus == AncPrivateVaultGuardedMemoryStatusOK &&
        agreementPrivateCloseStatus == AncPrivateVaultGuardedMemoryStatusOK;
    anc_pv_zeroize(signingPublic, sizeof signingPublic);
    anc_pv_zeroize(agreementPublic, sizeof agreementPublic);
    anc_pv_zeroize(recoveryHash, sizeof recoveryHash);
    anc_pv_zeroize(vaultSnapshot, sizeof vaultSnapshot);
    SetStatus(status, intermediatesClosed && privateKeysClosed
                          ? AncPrivateVaultRecoveryAuthorityStatusCryptoFailed
                          : AncPrivateVaultRecoveryAuthorityStatusMemoryFailed);
    return nil;
  }

  AncPrivateVaultRecoveryAuthority *result =
      [[AncPrivateVaultRecoveryAuthority alloc]
          initPrivateWithGeneration:recoveryGeneration
                         recoveryId:[NSData dataWithBytes:recoveryHash
                                                   length:16]
                   signingPublicKey:[NSData dataWithBytes:signingPublic
                                                   length:32]
              keyAgreementPublicKey:[NSData dataWithBytes:agreementPublic
                                                   length:32]
                  signingPrivateKey:signingPrivate
             keyAgreementPrivateKey:agreementPrivate];
  anc_pv_zeroize(signingPublic, sizeof signingPublic);
  anc_pv_zeroize(agreementPublic, sizeof agreementPublic);
  anc_pv_zeroize(recoveryHash, sizeof recoveryHash);
  anc_pv_zeroize(vaultSnapshot, sizeof vaultSnapshot);
  SetStatus(status, result == nil
                        ? AncPrivateVaultRecoveryAuthorityStatusMemoryFailed
                        : AncPrivateVaultRecoveryAuthorityStatusOK);
  if (result == nil) {
    [signingPrivate close];
    [agreementPrivate close];
  }
  return result;
}
