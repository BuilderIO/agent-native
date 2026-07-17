#import "PrivateVaultRotationPreparationSpool.h"

#import "PrivateVaultCrypto.h"
#import "PrivateVaultGuardedMemory.h"

#import <sodium.h>

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static const uint8_t kInnerMagic[8] = {'A', 'N', 'V', 'R', 'O', 'T', '0', '1'};
static const uint8_t kOuterMagic[8] = {'A', 'N', 'V', 'R', 'O', 'T', 'E', '1'};
static const uint8_t kInnerChecksumDomain[] =
    "agent-native/private-vault/rotation-preparation-artifacts/anc-v1";
static const uint8_t kSpoolKeyDomain[] =
    "agent-native/private-vault/rotation-preparation-spool-key/anc-v1";
static const uint8_t kOuterChecksumDomain[] =
    "agent-native/private-vault/rotation-preparation-spool-checksum/anc-v1";
static const uint8_t kFrameDigestDomain[] =
    "agent-native/private-vault/rotation-preparation-spool-frame/anc-v1";

enum {
  kInnerHeaderBytes = 124,
  kInnerChecksumBytes = 32,
  kOuterHeaderBytes = 108,
  kOuterChecksumBytes = 32,
  kOuterMinimumBytes = 156,
  kInnerMinimumBytes = 156,
  kInnerMaximumBytes =
      kInnerHeaderBytes + ANC_PV_ROTATION_SIGNED_ENTRY_MAX_BYTES +
      ANC_PV_ROTATION_RECOVERY_WRAP_MAX_BYTES + kInnerChecksumBytes,
  kOuterMaximumBytes = kOuterHeaderBytes + kInnerMaximumBytes +
                       ANC_PV_AUTH_BYTES + kOuterChecksumBytes,
  kMaximumLiveCandidateFiles = 256,
};

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultRotationPreparationSpoolFaultHook gFaultHook;
static AncPrivateVaultRotationPreparationSpoolClearHook gClearHook;
void AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(
    AncPrivateVaultRotationPreparationSpoolFaultHook hook) {
  gFaultHook = [hook copy];
}
void AncPrivateVaultRotationPreparationSpoolSetClearHookForTesting(
    AncPrivateVaultRotationPreparationSpoolClearHook hook) {
  gClearHook = [hook copy];
}
static BOOL Fault(AncPrivateVaultRotationPreparationSpoolFaultPoint point) {
  return gFaultHook != nil && gFaultHook(point);
}
#else
static BOOL Fault(NSInteger point) {
  (void)point;
  return NO;
}
#endif

static BOOL CloseDirectoryDescriptor(int fd) {
  if (fd < 0)
    return YES;
  BOOL closed = close(fd) == 0;
  return closed &&
         !Fault(AncPrivateVaultRotationPreparationSpoolFaultDirectoryClose);
}

static void SetStatus(AncPrivateVaultRotationPreparationSpoolStatus *status,
                      AncPrivateVaultRotationPreparationSpoolStatus value) {
  if (status != NULL)
    *status = value;
}

const char *AncPrivateVaultRotationPreparationSpoolStatusCategory(
    AncPrivateVaultRotationPreparationSpoolStatus status) {
  static const char *const categories[] = {
      "ok",
      "not_found",
      "invalid_argument",
      "corrupt",
      "binding_mismatch",
      "authentication_failed",
      "storage_failed",
      "conflict",
      "spool.wire.magic",
      "spool.wire.version",
      "spool.wire.flags",
      "spool.wire.reserved",
      "spool.range.artifact_length",
      "spool.binding.vault",
      "spool.binding.ceremony",
      "spool.binding.signed_hash",
      "spool.binding.recovery_wrap_hash",
      "spool.crypto.checksum",
      "spool.wire.truncation",
      "spool.wire.extra_bytes",
      "spool.binding.substitution",
      "spool.encryption.magic",
      "spool.encryption.version",
      "spool.encryption.flags",
      "spool.encryption.reserved",
      "spool.encryption.length",
      "spool.encryption.bounds",
      "spool.encryption.checksum",
      "spool.encryption.aead",
      "binding.record_spool_length",
      "binding.record_spool_digest",
  };
  if (status < 0 ||
      (NSUInteger)status >= sizeof categories / sizeof categories[0])
    return "invalid_argument";
  return categories[status];
}

static void WriteU16LE(uint8_t *p, uint16_t value) {
  p[0] = (uint8_t)value;
  p[1] = (uint8_t)(value >> 8);
}
static void WriteU64LE(uint8_t *p, uint64_t value) {
  for (size_t i = 0; i < 8; i++)
    p[i] = (uint8_t)(value >> (8 * i));
}
static uint16_t ReadU16LE(const uint8_t *p) {
  return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}
static uint64_t ReadU64LE(const uint8_t *p) {
  uint64_t value = 0;
  for (size_t i = 0; i < 8; i++)
    value |= (uint64_t)p[i] << (8 * i);
  return value;
}

static BOOL ConstantEqual(const void *left, const void *right, size_t length) {
  return left != NULL && right != NULL &&
         anc_pv_memcmp(left, right, length) == ANC_PV_CRYPTO_OK;
}

static BOOL RangesOverlap(const void *left, size_t leftLength,
                          const void *right, size_t rightLength) {
  if (left == NULL || right == NULL || leftLength == 0 || rightLength == 0)
    return NO;
  uintptr_t a = (uintptr_t)left;
  uintptr_t b = (uintptr_t)right;
  return a <= b ? b - a < leftLength : a - b < rightLength;
}

static BOOL Hash(const uint8_t *domain, size_t domainLength,
                 const uint8_t *payload, size_t payloadLength,
                 uint8_t output[32]) {
  crypto_generichash_state state;
  BOOL okay =
      crypto_generichash_init(&state, NULL, 0, 32) == 0 &&
      (domainLength == 0 ||
       crypto_generichash_update(&state, domain, domainLength) == 0) &&
      (payloadLength == 0 ||
       crypto_generichash_update(&state, payload, payloadLength) == 0) &&
      crypto_generichash_final(&state, output, 32) == 0;
  sodium_memzero(&state, sizeof state);
  return okay;
}

static BOOL DeriveKey(const uint8_t pendingKey[32], const uint8_t vaultId[16],
                      const uint8_t ceremonyId[16], uint8_t output[32]) {
  crypto_generichash_state state;
  BOOL okay = crypto_generichash_init(&state, NULL, 0, 32) == 0 &&
              crypto_generichash_update(&state, kSpoolKeyDomain,
                                        sizeof kSpoolKeyDomain) == 0 &&
              crypto_generichash_update(&state, pendingKey, 32) == 0 &&
              crypto_generichash_update(&state, vaultId, 16) == 0 &&
              crypto_generichash_update(&state, ceremonyId, 16) == 0 &&
              crypto_generichash_final(&state, output, 32) == 0;
  sodium_memzero(&state, sizeof state);
  return okay;
}

static BOOL FrameDigest(const uint8_t *frame, size_t length,
                        uint8_t output[32]) {
  return Hash(kFrameDigestDomain, sizeof kFrameDigestDomain, frame, length,
              output);
}

static void NotifyCleared(BOOL innerCleared, BOOL keyCleared) {
#if ANC_PRIVATE_VAULT_TESTING
  if (gClearHook != nil)
    gClearHook(innerCleared, keyCleared);
#else
  (void)innerCleared;
  (void)keyCleared;
#endif
}

#if ANC_PRIVATE_VAULT_TESTING
static void *GuardedMalloc(size_t length) {
  return Fault(AncPrivateVaultRotationPreparationSpoolFaultGuardedAllocation)
             ? NULL
             : sodium_malloc(length);
}
static int GuardedMLock(void *memory, size_t length) {
  return Fault(AncPrivateVaultRotationPreparationSpoolFaultGuardedMLock)
             ? -1
             : sodium_mlock(memory, length);
}
static int GuardedNoAccess(void *memory, __unused size_t length) {
  return Fault(AncPrivateVaultRotationPreparationSpoolFaultGuardedProtection)
             ? -1
             : sodium_mprotect_noaccess(memory);
}
static int GuardedReadWrite(void *memory, __unused size_t length) {
  return Fault(AncPrivateVaultRotationPreparationSpoolFaultGuardedProtection)
             ? -1
             : sodium_mprotect_readwrite(memory);
}
static void GuardedZero(void *memory, size_t length) {
  sodium_memzero(memory, length);
}
static void GuardedFree(void *memory) { sodium_free(memory); }
#endif

static AncPrivateVaultGuardedMemory *GuardedMemory(size_t length) {
  AncPrivateVaultGuardedMemoryStatus status;
#if ANC_PRIVATE_VAULT_TESTING
  const AncPrivateVaultGuardedMemoryFunctions functions = {
      .malloc_fn = GuardedMalloc,
      .mlock_fn = GuardedMLock,
      .mprotect_noaccess_fn = GuardedNoAccess,
      .mprotect_readwrite_fn = GuardedReadWrite,
      .memzero_fn = GuardedZero,
      .free_fn = GuardedFree,
  };
  return [AncPrivateVaultGuardedMemory memoryWithLength:length
                                              functions:&functions
                                                 status:&status];
#else
  return [AncPrivateVaultGuardedMemory memoryWithLength:length status:&status];
#endif
}

NSData *AncPrivateVaultRotationPreparationSpoolEncode(
    const uint8_t *signedEntry, size_t signedEntryLength,
    const uint8_t *recoveryWrap, size_t recoveryWrapLength,
    const uint8_t vaultId[16], const uint8_t ceremonyId[16],
    const uint8_t pendingKey[32], const uint8_t nonce[24],
    uint8_t outFrameDigest[32],
    AncPrivateVaultRotationPreparationSpoolStatus *status) {
  if (signedEntry == NULL || recoveryWrap == NULL || vaultId == NULL ||
      ceremonyId == NULL || pendingKey == NULL || nonce == NULL ||
      outFrameDigest == NULL || signedEntryLength == 0 ||
      signedEntryLength > ANC_PV_ROTATION_SIGNED_ENTRY_MAX_BYTES ||
      recoveryWrapLength == 0 ||
      recoveryWrapLength > ANC_PV_ROTATION_RECOVERY_WRAP_MAX_BYTES)
    return nil;
  if ((status != NULL &&
       (RangesOverlap(status, sizeof *status, signedEntry, signedEntryLength) ||
        RangesOverlap(status, sizeof *status, recoveryWrap,
                      recoveryWrapLength) ||
        RangesOverlap(status, sizeof *status, vaultId, 16) ||
        RangesOverlap(status, sizeof *status, ceremonyId, 16) ||
        RangesOverlap(status, sizeof *status, pendingKey, 32) ||
        RangesOverlap(status, sizeof *status, nonce, 24) ||
        RangesOverlap(status, sizeof *status, outFrameDigest, 32))) ||
      RangesOverlap(outFrameDigest, 32, signedEntry, signedEntryLength) ||
      RangesOverlap(outFrameDigest, 32, recoveryWrap, recoveryWrapLength) ||
      RangesOverlap(outFrameDigest, 32, vaultId, 16) ||
      RangesOverlap(outFrameDigest, 32, ceremonyId, 16) ||
      RangesOverlap(outFrameDigest, 32, pendingKey, 32) ||
      RangesOverlap(outFrameDigest, 32, nonce, 24))
    return nil;
  SetStatus(status, AncPrivateVaultRotationPreparationSpoolStatusInvalid);

  const size_t innerLength = kInnerHeaderBytes + signedEntryLength +
                             recoveryWrapLength + kInnerChecksumBytes;
  const size_t outerLength =
      kOuterHeaderBytes + innerLength + ANC_PV_AUTH_BYTES + kOuterChecksumBytes;
  AncPrivateVaultGuardedMemory *innerMemory = GuardedMemory(innerLength);
  AncPrivateVaultGuardedMemory *keyMemory = GuardedMemory(32);
  __block NSMutableData *outer = nil;
  AncPrivateVaultGuardedMemoryStatus innerBorrow =
      innerMemory == nil || keyMemory == nil
          ? AncPrivateVaultGuardedMemoryStatusAllocationFailed
          : [innerMemory borrow:^BOOL(uint8_t *inner, size_t guardedLength) {
              if (guardedLength != innerLength)
                return NO;
              memset(inner, 0, innerLength);
              memcpy(inner, kInnerMagic, 8);
              WriteU16LE(inner + 8, 1);
              WriteU64LE(inner + 12, signedEntryLength);
              WriteU64LE(inner + 20, recoveryWrapLength);
              memcpy(inner + 28, vaultId, 16);
              memcpy(inner + 44, ceremonyId, 16);
              BOOL okay =
                  Hash(NULL, 0, signedEntry, signedEntryLength, inner + 60) &&
                  Hash(NULL, 0, recoveryWrap, recoveryWrapLength, inner + 92);
              memcpy(inner + 124, signedEntry, signedEntryLength);
              memcpy(inner + 124 + signedEntryLength, recoveryWrap,
                     recoveryWrapLength);
              okay = okay &&
                     Hash(kInnerChecksumDomain, sizeof kInnerChecksumDomain,
                          inner, innerLength - 32, inner + innerLength - 32);
              if (!okay)
                return NO;
              outer = [NSMutableData dataWithLength:outerLength];
              uint8_t *bytes = outer.mutableBytes;
              memcpy(bytes, kOuterMagic, 8);
              WriteU16LE(bytes + 8, 1);
              WriteU64LE(bytes + 12, innerLength);
              memcpy(bytes + 20, vaultId, 16);
              memcpy(bytes + 36, ceremonyId, 16);
              memcpy(bytes + 52, nonce, 24);
              okay = Hash(NULL, 0, inner, innerLength, bytes + 76);
              AncPrivateVaultGuardedMemoryStatus keyBorrow =
                  okay ? [keyMemory borrow:^BOOL(uint8_t *key,
                                                 size_t keyLength) {
                    if (keyLength != 32 ||
                        !DeriveKey(pendingKey, vaultId, ceremonyId, key))
                      return NO;
                    size_t written = 0;
                    return anc_pv_xchacha20poly1305_encrypt(
                               bytes + kOuterHeaderBytes,
                               innerLength + ANC_PV_AUTH_BYTES, &written, inner,
                               innerLength, bytes, kOuterHeaderBytes, nonce,
                               key) == ANC_PV_CRYPTO_OK &&
                           written == innerLength + ANC_PV_AUTH_BYTES;
                  }]
                       : AncPrivateVaultGuardedMemoryStatusCallbackFailed;
              return keyBorrow == AncPrivateVaultGuardedMemoryStatusOK &&
                     Hash(kOuterChecksumDomain, sizeof kOuterChecksumDomain,
                          bytes, outerLength - 32, bytes + outerLength - 32) &&
                     FrameDigest(bytes, outerLength, outFrameDigest);
            }];
  AncPrivateVaultGuardedMemoryStatus keyClose =
      keyMemory == nil ? AncPrivateVaultGuardedMemoryStatusAllocationFailed
                       : [keyMemory close];
  AncPrivateVaultGuardedMemoryStatus innerClose =
      innerMemory == nil ? AncPrivateVaultGuardedMemoryStatusAllocationFailed
                         : [innerMemory close];
  BOOL okay = innerBorrow == AncPrivateVaultGuardedMemoryStatusOK &&
              keyClose == AncPrivateVaultGuardedMemoryStatusOK &&
              innerClose == AncPrivateVaultGuardedMemoryStatusOK;
  NotifyCleared(innerClose == AncPrivateVaultGuardedMemoryStatusOK,
                keyClose == AncPrivateVaultGuardedMemoryStatusOK);
  if (!okay) {
    if (outer != nil)
      anc_pv_zeroize(outer.mutableBytes, outer.length);
    anc_pv_zeroize(outFrameDigest, 32);
    SetStatus(status, AncPrivateVaultRotationPreparationSpoolStatusCorrupt);
    return nil;
  }
  SetStatus(status, AncPrivateVaultRotationPreparationSpoolStatusOK);
  return outer;
}

static AncPrivateVaultRotationPreparationSpoolStatus
ValidateOuter(NSData *frame, const uint8_t *expectedVaultId,
              const uint8_t *expectedCeremonyId, uint64_t expectedSignedLength,
              uint64_t expectedWrapLength, const uint8_t *expectedDigest) {
  if (frame.length < kOuterMinimumBytes || frame.length > kOuterMaximumBytes)
    return AncPrivateVaultRotationPreparationSpoolStatusEncryptionLength;
  const uint8_t *bytes = frame.bytes;
  if (!ConstantEqual(bytes, kOuterMagic, 8))
    return AncPrivateVaultRotationPreparationSpoolStatusEncryptionMagic;
  if (ReadU16LE(bytes + 8) != 1)
    return AncPrivateVaultRotationPreparationSpoolStatusEncryptionVersion;
  if (bytes[10] != 0)
    return AncPrivateVaultRotationPreparationSpoolStatusEncryptionFlags;
  if (bytes[11] != 0)
    return AncPrivateVaultRotationPreparationSpoolStatusEncryptionReserved;
  uint64_t innerLength = ReadU64LE(bytes + 12);
  if (innerLength < kInnerMinimumBytes || innerLength > kInnerMaximumBytes ||
      innerLength > SIZE_MAX ||
      frame.length != kOuterHeaderBytes + (size_t)innerLength +
                          ANC_PV_AUTH_BYTES + kOuterChecksumBytes)
    return innerLength < kInnerMinimumBytes ||
                   innerLength > kInnerMaximumBytes || innerLength > SIZE_MAX
               ? AncPrivateVaultRotationPreparationSpoolStatusEncryptionBounds
               : AncPrivateVaultRotationPreparationSpoolStatusEncryptionLength;
  uint8_t digest[32];
  BOOL checksumOkay = Hash(kOuterChecksumDomain, sizeof kOuterChecksumDomain,
                           bytes, frame.length - 32, digest) &&
                      ConstantEqual(digest, bytes + frame.length - 32, 32);
  anc_pv_zeroize(digest, sizeof digest);
  if (!checksumOkay)
    return AncPrivateVaultRotationPreparationSpoolStatusEncryptionChecksum;
  (void)expectedVaultId;
  (void)expectedCeremonyId;
  (void)expectedDigest;
  if ((expectedSignedLength > 0 || expectedWrapLength > 0) &&
      (expectedSignedLength == 0 ||
       expectedSignedLength > ANC_PV_ROTATION_SIGNED_ENTRY_MAX_BYTES ||
       expectedWrapLength == 0 ||
       expectedWrapLength > ANC_PV_ROTATION_RECOVERY_WRAP_MAX_BYTES))
    return AncPrivateVaultRotationPreparationSpoolStatusRecordSpoolLength;
  return AncPrivateVaultRotationPreparationSpoolStatusOK;
}

BOOL AncPrivateVaultRotationPreparationSpoolConsume(
    NSData *encryptedFrame, const uint8_t expectedVaultId[16],
    const uint8_t expectedCeremonyId[16], uint64_t expectedSignedEntryLength,
    uint64_t expectedRecoveryWrapLength, const uint8_t expectedFrameDigest[32],
    const uint8_t pendingKey[32],
    AncPrivateVaultRotationPreparationArtifactsConsumer consumer,
    AncPrivateVaultRotationPreparationSpoolStatus *status) {
  SetStatus(status, AncPrivateVaultRotationPreparationSpoolStatusInvalid);
  if (encryptedFrame == nil || expectedVaultId == NULL ||
      expectedCeremonyId == NULL || expectedFrameDigest == NULL ||
      pendingKey == NULL || consumer == nil)
    return NO;
  AncPrivateVaultRotationPreparationSpoolStatus validation =
      ValidateOuter(encryptedFrame, expectedVaultId, expectedCeremonyId,
                    expectedSignedEntryLength, expectedRecoveryWrapLength,
                    expectedFrameDigest);
  if (validation != AncPrivateVaultRotationPreparationSpoolStatusOK) {
    SetStatus(status, validation);
    return NO;
  }
  const uint8_t *outer = encryptedFrame.bytes;
  size_t innerLength = (size_t)ReadU64LE(outer + 12);
  AncPrivateVaultGuardedMemory *innerMemory = GuardedMemory(innerLength);
  AncPrivateVaultGuardedMemory *keyMemory = GuardedMemory(32);
  __block AncPrivateVaultRotationPreparationSpoolStatus result =
      AncPrivateVaultRotationPreparationSpoolStatusEncryptionAEAD;
  __block BOOL consumed = NO;
  AncPrivateVaultGuardedMemoryStatus innerBorrow =
      innerMemory == nil || keyMemory == nil
          ? AncPrivateVaultGuardedMemoryStatusAllocationFailed
          : [innerMemory borrow:^BOOL(uint8_t *inner, size_t guardedLength) {
              if (guardedLength != innerLength)
                return NO;
              memset(inner, 0, innerLength);
              __block size_t written = 0;
              AncPrivateVaultGuardedMemoryStatus keyBorrow =
                  [keyMemory borrow:^BOOL(uint8_t *key, size_t keyLength) {
                    return keyLength == 32 &&
                           DeriveKey(pendingKey, outer + 20, outer + 36, key) &&
                           anc_pv_xchacha20poly1305_decrypt(
                               inner, innerLength, &written,
                               outer + kOuterHeaderBytes,
                               innerLength + ANC_PV_AUTH_BYTES, outer,
                               kOuterHeaderBytes, outer + 52,
                               key) == ANC_PV_CRYPTO_OK &&
                           written == innerLength;
                  }];
              if (keyBorrow != AncPrivateVaultGuardedMemoryStatusOK)
                return NO;
              uint64_t signedLength = ReadU64LE(inner + 12);
              uint64_t wrapLength = ReadU64LE(inner + 20);
              if (!ConstantEqual(inner, kInnerMagic, 8)) {
                result = AncPrivateVaultRotationPreparationSpoolStatusWireMagic;
                return NO;
              }
              if (ReadU16LE(inner + 8) != 1) {
                result =
                    AncPrivateVaultRotationPreparationSpoolStatusWireVersion;
                return NO;
              }
              if (inner[10] != 0) {
                result = AncPrivateVaultRotationPreparationSpoolStatusWireFlags;
                return NO;
              }
              if (inner[11] != 0) {
                result =
                    AncPrivateVaultRotationPreparationSpoolStatusWireReserved;
                return NO;
              }
              if (signedLength == 0 ||
                  signedLength > ANC_PV_ROTATION_SIGNED_ENTRY_MAX_BYTES ||
                  wrapLength == 0 ||
                  wrapLength > ANC_PV_ROTATION_RECOVERY_WRAP_MAX_BYTES) {
                result =
                    AncPrivateVaultRotationPreparationSpoolStatusRangeArtifactLength;
                return NO;
              }
              uint64_t declaredInnerLength = kInnerHeaderBytes + signedLength +
                                             wrapLength + kInnerChecksumBytes;
              if (declaredInnerLength != innerLength) {
                result =
                    declaredInnerLength > innerLength
                        ? AncPrivateVaultRotationPreparationSpoolStatusWireTruncation
                        : AncPrivateVaultRotationPreparationSpoolStatusWireExtraBytes;
                return NO;
              }
              if (signedLength != expectedSignedEntryLength ||
                  wrapLength != expectedRecoveryWrapLength) {
                result =
                    AncPrivateVaultRotationPreparationSpoolStatusRecordSpoolLength;
                return NO;
              }
              if (!ConstantEqual(inner + 28, outer + 20, 16)) {
                result =
                    AncPrivateVaultRotationPreparationSpoolStatusBindingVault;
                return NO;
              }
              if (!ConstantEqual(inner + 44, outer + 36, 16)) {
                result =
                    AncPrivateVaultRotationPreparationSpoolStatusBindingCeremony;
                return NO;
              }
              uint8_t digest[32];
              if (!Hash(NULL, 0, inner + 124, signedLength, digest) ||
                  !ConstantEqual(digest, inner + 60, 32)) {
                anc_pv_zeroize(digest, sizeof digest);
                result =
                    AncPrivateVaultRotationPreparationSpoolStatusBindingSignedHash;
                return NO;
              }
              if (!Hash(NULL, 0, inner + 124 + signedLength, wrapLength,
                        digest) ||
                  !ConstantEqual(digest, inner + 92, 32)) {
                anc_pv_zeroize(digest, sizeof digest);
                result =
                    AncPrivateVaultRotationPreparationSpoolStatusBindingRecoveryWrapHash;
                return NO;
              }
              if (!Hash(kInnerChecksumDomain, sizeof kInnerChecksumDomain,
                        inner, innerLength - 32, digest) ||
                  !ConstantEqual(digest, inner + innerLength - 32, 32)) {
                anc_pv_zeroize(digest, sizeof digest);
                result =
                    AncPrivateVaultRotationPreparationSpoolStatusCryptoChecksum;
                return NO;
              }
              if (!Hash(NULL, 0, inner, innerLength, digest) ||
                  !ConstantEqual(digest, outer + 76, 32)) {
                anc_pv_zeroize(digest, sizeof digest);
                result =
                    AncPrivateVaultRotationPreparationSpoolStatusBindingSubstitution;
                return NO;
              }
              if (!ConstantEqual(outer + 20, expectedVaultId, 16) ||
                  !ConstantEqual(outer + 36, expectedCeremonyId, 16)) {
                anc_pv_zeroize(digest, sizeof digest);
                result =
                    AncPrivateVaultRotationPreparationSpoolStatusBindingSubstitution;
                return NO;
              }
              if (!FrameDigest(outer, encryptedFrame.length, digest) ||
                  !ConstantEqual(digest, expectedFrameDigest, 32)) {
                anc_pv_zeroize(digest, sizeof digest);
                result =
                    AncPrivateVaultRotationPreparationSpoolStatusRecordSpoolDigest;
                return NO;
              }
              anc_pv_zeroize(digest, sizeof digest);
              @try {
                consumed = consumer(inner + 124, signedLength,
                                    inner + 124 + signedLength, wrapLength);
              } @catch (__unused NSException *exception) {
                consumed = NO;
              }
              result =
                  consumed
                      ? AncPrivateVaultRotationPreparationSpoolStatusOK
                      : AncPrivateVaultRotationPreparationSpoolStatusInvalid;
              return consumed;
            }];
  AncPrivateVaultGuardedMemoryStatus keyClose =
      keyMemory == nil ? AncPrivateVaultGuardedMemoryStatusAllocationFailed
                       : [keyMemory close];
  AncPrivateVaultGuardedMemoryStatus innerClose =
      innerMemory == nil ? AncPrivateVaultGuardedMemoryStatusAllocationFailed
                         : [innerMemory close];
  if (innerBorrow != AncPrivateVaultGuardedMemoryStatusOK &&
      result == AncPrivateVaultRotationPreparationSpoolStatusOK)
    result = AncPrivateVaultRotationPreparationSpoolStatusAuthenticationFailed;
  if (keyClose != AncPrivateVaultGuardedMemoryStatusOK ||
      innerClose != AncPrivateVaultGuardedMemoryStatusOK) {
    consumed = NO;
    result = AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
  }
  NotifyCleared(innerClose == AncPrivateVaultGuardedMemoryStatusOK,
                keyClose == AncPrivateVaultGuardedMemoryStatusOK);
  SetStatus(status, result);
  return consumed;
}

static AncPrivateVaultRotationPreparationSpoolStatus
ValidateBoundFrame(NSData *frame, const uint8_t vaultId[16],
                   const uint8_t ceremonyId[16], uint64_t signedLength,
                   uint64_t wrapLength, const uint8_t frameDigest[32],
                   const uint8_t pendingKey[32]) {
  AncPrivateVaultRotationPreparationSpoolStatus status;
  AncPrivateVaultRotationPreparationSpoolConsume(
      frame, vaultId, ceremonyId, signedLength, wrapLength, frameDigest,
      pendingKey,
      ^BOOL(const uint8_t *signedBytes, size_t signedBytesLength,
            const uint8_t *wrapBytes, size_t wrapBytesLength) {
        (void)signedBytes;
        (void)signedBytesLength;
        (void)wrapBytes;
        (void)wrapBytesLength;
        return YES;
      },
      &status);
  return status;
}

typedef struct AncPrivateVaultRotationPreparationFileWitness {
  dev_t device;
  ino_t inode;
  off_t size;
  uint8_t digest[32];
  BOOL present;
} AncPrivateVaultRotationPreparationFileWitness;

static void
ClearFileWitness(AncPrivateVaultRotationPreparationFileWitness *witness) {
  if (witness != NULL)
    anc_pv_zeroize(witness, sizeof *witness);
}

@interface AncPrivateVaultRotationPreparationSpoolStore ()
@property(nonatomic) NSURL *stateRootURL;
@property(nonatomic) dispatch_queue_t queue;
@property(nonatomic) BOOL stateRootPinned;
@property(nonatomic) dev_t stateRootDevice;
@property(nonatomic) ino_t stateRootInode;
@property(nonatomic) uid_t stateRootOwner;
@property(nonatomic) BOOL stateDirectoryPinned;
@property(nonatomic) dev_t stateDirectoryDevice;
@property(nonatomic) ino_t stateDirectoryInode;
@property(nonatomic) uid_t stateDirectoryOwner;
@property(nonatomic) BOOL directoryPinned;
@property(nonatomic) dev_t directoryDevice;
@property(nonatomic) ino_t directoryInode;
@property(nonatomic) uid_t directoryOwner;
@property(nonatomic) BOOL prepareIntegrityFailure;
@end

@implementation AncPrivateVaultRotationPreparationSpoolStore
- (instancetype)initWithStateRootURL:(NSURL *)stateRootURL {
  self = [super init];
  if (self) {
    _stateRootURL = [stateRootURL copy];
    _queue = dispatch_queue_create(
        "com.agentnative.private-vault.rotation-preparation-spool",
        DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (NSString *)baseNameForVaultId:(const uint8_t[16])vaultId
                      ceremonyId:(const uint8_t[16])ceremonyId {
  if (vaultId == NULL || ceremonyId == NULL)
    return nil;
  NSMutableString *value = [NSMutableString stringWithCapacity:64];
  for (size_t i = 0; i < 16; i++)
    [value appendFormat:@"%02x", vaultId[i]];
  for (size_t i = 0; i < 16; i++)
    [value appendFormat:@"%02x", ceremonyId[i]];
  return value;
}

- (BOOL)isSafeFileName:(NSString *)name directory:(int)directoryFD {
  struct stat file;
  return name != nil &&
         fstatat(directoryFD, name.fileSystemRepresentation, &file,
                 AT_SYMLINK_NOFOLLOW) == 0 &&
         S_ISREG(file.st_mode) && file.st_uid == getuid() &&
         file.st_nlink == 1 && (file.st_mode & 0777) == 0600 &&
         file.st_size >= 0 && file.st_size <= kOuterMaximumBytes;
}

- (BOOL)prepareDirectory {
  self.prepareIntegrityFailure = NO;
  struct stat rootPath;
  if (lstat(self.stateRootURL.fileSystemRepresentation, &rootPath) != 0 ||
      !S_ISDIR(rootPath.st_mode) || rootPath.st_uid != getuid() ||
      (rootPath.st_mode & 0777) != 0700)
    return NO;
  if (!self.stateRootPinned) {
    self.stateRootPinned = YES;
    self.stateRootDevice = rootPath.st_dev;
    self.stateRootInode = rootPath.st_ino;
    self.stateRootOwner = rootPath.st_uid;
  } else if (self.stateRootDevice != rootPath.st_dev ||
             self.stateRootInode != rootPath.st_ino ||
             self.stateRootOwner != rootPath.st_uid) {
    return NO;
  }
  int root = open(self.stateRootURL.fileSystemRepresentation,
                  O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat openedRoot;
  if (root < 0 || fstat(root, &openedRoot) != 0 ||
      openedRoot.st_dev != self.stateRootDevice ||
      openedRoot.st_ino != self.stateRootInode ||
      openedRoot.st_uid != self.stateRootOwner ||
      !S_ISDIR(openedRoot.st_mode) || (openedRoot.st_mode & 0777) != 0700) {
    if (root >= 0)
      close(root);
    return NO;
  }
  int state = openat(root, "state", O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (state < 0 && errno == ENOENT) {
    if (mkdirat(root, "state", 0700) != 0 || fsync(root) != 0) {
      close(root);
      return NO;
    }
    state = openat(root, "state", O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  }
  struct stat openedState;
  if (state < 0 || fstat(state, &openedState) != 0 ||
      !S_ISDIR(openedState.st_mode) || openedState.st_uid != getuid() ||
      openedState.st_dev != openedRoot.st_dev ||
      (openedState.st_mode & 0777) != 0700) {
    if (state >= 0)
      close(state);
    close(root);
    return NO;
  }
  if (!self.stateDirectoryPinned) {
    self.stateDirectoryPinned = YES;
    self.stateDirectoryDevice = openedState.st_dev;
    self.stateDirectoryInode = openedState.st_ino;
    self.stateDirectoryOwner = openedState.st_uid;
  } else if (self.stateDirectoryDevice != openedState.st_dev ||
             self.stateDirectoryInode != openedState.st_ino ||
             self.stateDirectoryOwner != openedState.st_uid) {
    close(state);
    close(root);
    return NO;
  }
  int dir = openat(state, "rotation-preparation",
                   O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (dir < 0 && errno == ENOENT) {
    if (mkdirat(state, "rotation-preparation", 0700) != 0 ||
        fsync(state) != 0) {
      close(state);
      close(root);
      return NO;
    }
    dir = openat(state, "rotation-preparation",
                 O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  }
  struct stat opened;
  if (dir < 0 || fstat(dir, &opened) != 0 || !S_ISDIR(opened.st_mode) ||
      opened.st_uid != getuid() || opened.st_dev != openedState.st_dev ||
      (opened.st_mode & 0777) != 0700) {
    if (dir >= 0)
      close(dir);
    close(state);
    close(root);
    return NO;
  }
  if (!self.directoryPinned) {
    self.directoryPinned = YES;
    self.directoryDevice = opened.st_dev;
    self.directoryInode = opened.st_ino;
    self.directoryOwner = opened.st_uid;
  } else if (self.directoryDevice != opened.st_dev ||
             self.directoryInode != opened.st_ino ||
             self.directoryOwner != opened.st_uid) {
    close(dir);
    close(state);
    close(root);
    return NO;
  }
  BOOL stateClosed = CloseDirectoryDescriptor(state);
  BOOL rootClosed = CloseDirectoryDescriptor(root);
  if (!stateClosed || !rootClosed) {
    (void)CloseDirectoryDescriptor(dir);
    return NO;
  }
  int listingFD = dup(dir);
  DIR *listing = listingFD < 0 ? NULL : fdopendir(listingFD);
  if (listing == NULL ||
      Fault(AncPrivateVaultRotationPreparationSpoolFaultDirectoryListing)) {
    if (listing != NULL)
      closedir(listing);
    else if (listingFD >= 0)
      close(listingFD);
    close(dir);
    return NO;
  }
  NSRegularExpression *allowed =
      [NSRegularExpression regularExpressionWithPattern:
                               @"^[0-9a-f]{64}\\.rotation-spool(?:\\.stage)?$"
                                                options:0
                                                  error:nil];
  NSRegularExpression *temporary = [NSRegularExpression
      regularExpressionWithPattern:@"^\\.[0-9a-f]{64}\\.[0-9a-f-]{36}\\.tmp$"
                           options:0
                             error:nil];
  BOOL okay = YES;
  errno = 0;
  struct dirent *entry;
  while (okay && (entry = readdir(listing)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0)
      continue;
    NSString *name = [NSString stringWithUTF8String:entry->d_name];
    NSRange range = NSMakeRange(0, name.length);
    if (name == nil) {
      self.prepareIntegrityFailure = YES;
      okay = NO;
    } else if ([allowed firstMatchInString:name options:0 range:range] != nil) {
      okay = [self isSafeFileName:name directory:dir];
      if (!okay)
        self.prepareIntegrityFailure = YES;
    } else if ([temporary firstMatchInString:name options:0
                                       range:range] != nil) {
      struct stat file;
      BOOL structurallySafe =
          fstatat(dir, entry->d_name, &file, AT_SYMLINK_NOFOLLOW) == 0 &&
          S_ISREG(file.st_mode) && file.st_uid == getuid() &&
          file.st_nlink == 1 && (file.st_mode & 0777) == 0600;
      if (!structurallySafe)
        self.prepareIntegrityFailure = YES;
      okay = structurallySafe && unlinkat(dir, entry->d_name, 0) == 0 &&
             fsync(dir) == 0;
    } else {
      self.prepareIntegrityFailure = YES;
      okay = NO;
    }
  }
  okay = okay && errno == 0 && closedir(listing) == 0;
  BOOL directoryClosed = CloseDirectoryDescriptor(dir);
  return okay && directoryClosed;
}

- (int)openValidatedDirectory {
  if (Fault(AncPrivateVaultRotationPreparationSpoolFaultBeforeDirectoryReopen))
    return -1;
  int root = open(self.stateRootURL.fileSystemRepresentation,
                  O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat rootStat;
  if (root < 0 || fstat(root, &rootStat) != 0 || !self.stateRootPinned ||
      rootStat.st_dev != self.stateRootDevice ||
      rootStat.st_ino != self.stateRootInode ||
      rootStat.st_uid != self.stateRootOwner || !S_ISDIR(rootStat.st_mode) ||
      (rootStat.st_mode & 0777) != 0700) {
    if (root >= 0)
      close(root);
    return -1;
  }
  int state = openat(root, "state", O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat stateStat;
  if (state < 0 || fstat(state, &stateStat) != 0 ||
      !self.stateDirectoryPinned ||
      stateStat.st_dev != self.stateDirectoryDevice ||
      stateStat.st_ino != self.stateDirectoryInode ||
      stateStat.st_uid != self.stateDirectoryOwner ||
      !S_ISDIR(stateStat.st_mode) || (stateStat.st_mode & 0777) != 0700) {
    if (state >= 0)
      close(state);
    close(root);
    return -1;
  }
  int fd = openat(state, "rotation-preparation",
                  O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat st;
  BOOL valid = fd >= 0 && fstat(fd, &st) == 0 && self.directoryPinned &&
               st.st_dev == self.directoryDevice &&
               st.st_ino == self.directoryInode &&
               st.st_uid == self.directoryOwner && S_ISDIR(st.st_mode) &&
               (st.st_mode & 0777) == 0700;
  BOOL stateClosed = CloseDirectoryDescriptor(state);
  BOOL rootClosed = CloseDirectoryDescriptor(root);
  if (!valid || !stateClosed || !rootClosed) {
    if (fd >= 0)
      close(fd);
    return -1;
  }
  return fd;
}

- (NSData *)readName:(NSString *)name
             missing:(BOOL *)missing
             witness:(AncPrivateVaultRotationPreparationFileWitness *)witness {
  if (missing)
    *missing = NO;
  ClearFileWitness(witness);
  int dir = [self openValidatedDirectory];
  if (dir < 0 ||
      Fault(AncPrivateVaultRotationPreparationSpoolFaultBeforeFileOpen)) {
    if (dir >= 0)
      close(dir);
    return nil;
  }
  int fd = openat(dir, name.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW);
  if (fd < 0) {
    if (missing && errno == ENOENT)
      *missing = YES;
    if (!CloseDirectoryDescriptor(dir) && missing)
      *missing = NO;
    return nil;
  }
  struct stat st;
  if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) || st.st_uid != getuid() ||
      st.st_nlink != 1 || (st.st_mode & 0777) != 0600 || st.st_size < 0 ||
      st.st_size > kOuterMaximumBytes) {
    close(fd);
    close(dir);
    return nil;
  }
  NSMutableData *data = [NSMutableData dataWithLength:(NSUInteger)st.st_size];
  size_t offset = 0;
  while (offset < data.length) {
    ssize_t amount =
        read(fd, (uint8_t *)data.mutableBytes + offset, data.length - offset);
    if (amount <= 0) {
      data = nil;
      break;
    }
    offset += (size_t)amount;
  }
  BOOL closeOkay =
      close(fd) == 0 &&
      !Fault(AncPrivateVaultRotationPreparationSpoolFaultFileClose);
  closeOkay = CloseDirectoryDescriptor(dir) && closeOkay;
  if (!closeOkay || data == nil)
    return nil;
  uint8_t digest[32];
  if (!FrameDigest(data.bytes, data.length, digest))
    return nil;
  if (witness != NULL) {
    witness->device = st.st_dev;
    witness->inode = st.st_ino;
    witness->size = st.st_size;
    memcpy(witness->digest, digest, 32);
    witness->present = YES;
  }
  anc_pv_zeroize(digest, sizeof digest);
  return data;
}

- (BOOL)verifyWitness:
            (const AncPrivateVaultRotationPreparationFileWitness *)witness
              forName:(NSString *)name
            directory:(int)directoryFD {
  if (witness == NULL || !witness->present || directoryFD < 0 || name == nil)
    return NO;
  int fd =
      openat(directoryFD, name.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW);
  struct stat st;
  if (fd < 0 || fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) ||
      st.st_uid != getuid() || st.st_nlink != 1 ||
      (st.st_mode & 0777) != 0600 || st.st_dev != witness->device ||
      st.st_ino != witness->inode || st.st_size != witness->size ||
      st.st_size < 0 || st.st_size > kOuterMaximumBytes) {
    if (fd >= 0)
      close(fd);
    return NO;
  }
  NSMutableData *data = [NSMutableData dataWithLength:(NSUInteger)st.st_size];
  size_t offset = 0;
  while (offset < data.length) {
    ssize_t amount =
        read(fd, (uint8_t *)data.mutableBytes + offset, data.length - offset);
    if (amount <= 0) {
      close(fd);
      return NO;
    }
    offset += (size_t)amount;
  }
  if (close(fd) != 0)
    return NO;
  uint8_t digest[32];
  BOOL okay = FrameDigest(data.bytes, data.length, digest) &&
              ConstantEqual(digest, witness->digest, 32);
  anc_pv_zeroize(digest, sizeof digest);
  return okay;
}

- (BOOL)nameIsAbsent:(NSString *)name directory:(int)directoryFD {
  struct stat st;
  if (fstatat(directoryFD, name.fileSystemRepresentation, &st,
              AT_SYMLINK_NOFOLLOW) == 0)
    return NO;
  return errno == ENOENT;
}

- (BOOL)unlinkWitness:
            (const AncPrivateVaultRotationPreparationFileWitness *)witness
              forName:(NSString *)name
            directory:(int)directoryFD {
  if (witness == NULL || !witness->present || name == nil || directoryFD < 0)
    return NO;
  int fd =
      openat(directoryFD, name.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW);
  struct stat before;
  if (fd < 0 || fstat(fd, &before) != 0 || !S_ISREG(before.st_mode) ||
      before.st_uid != getuid() || before.st_nlink != 1 ||
      (before.st_mode & 0777) != 0600 || before.st_dev != witness->device ||
      before.st_ino != witness->inode || before.st_size != witness->size ||
      before.st_size < 0 || before.st_size > kOuterMaximumBytes) {
    if (fd >= 0)
      close(fd);
    return NO;
  }
  NSMutableData *data =
      [NSMutableData dataWithLength:(NSUInteger)before.st_size];
  size_t offset = 0;
  while (offset < data.length) {
    ssize_t amount =
        read(fd, (uint8_t *)data.mutableBytes + offset, data.length - offset);
    if (amount <= 0) {
      close(fd);
      return NO;
    }
    offset += (size_t)amount;
  }
  uint8_t digest[32];
  BOOL okay = FrameDigest(data.bytes, data.length, digest) &&
              ConstantEqual(digest, witness->digest, 32) &&
              !Fault(AncPrivateVaultRotationPreparationSpoolFaultBeforeUnlink);
  anc_pv_zeroize(digest, sizeof digest);
  if (okay)
    okay = unlinkat(directoryFD, name.fileSystemRepresentation, 0) == 0;
  struct stat after;
  if (okay)
    okay = fstat(fd, &after) == 0 && after.st_dev == witness->device &&
           after.st_ino == witness->inode && after.st_nlink == 0;
  BOOL closed = close(fd) == 0 &&
                !Fault(AncPrivateVaultRotationPreparationSpoolFaultFileClose);
  return okay && closed && [self nameIsAbsent:name directory:directoryFD];
}

- (BOOL)
    quarantineAndDeleteName:(NSString *)name
                    witness:
                        (const AncPrivateVaultRotationPreparationFileWitness *)
                            witness
                   baseName:(NSString *)baseName
                  directory:(int)directoryFD {
  if (witness == NULL || !witness->present)
    return YES;
  NSString *quarantine =
      [NSString stringWithFormat:@".%@.%@.tmp", baseName,
                                 NSUUID.UUID.UUIDString.lowercaseString];
  return
      [self verifyWitness:witness forName:name directory:directoryFD] &&
      !Fault(AncPrivateVaultRotationPreparationSpoolFaultBeforeLiveRename) &&
      renameat(directoryFD, name.fileSystemRepresentation, directoryFD,
               quarantine.fileSystemRepresentation) == 0 &&
      !Fault(
          AncPrivateVaultRotationPreparationSpoolFaultAfterRenameBeforeReadback) &&
      [self unlinkWitness:witness forName:quarantine directory:directoryFD] &&
      [self nameIsAbsent:name directory:directoryFD];
}

- (AncPrivateVaultRotationPreparationSpoolStatus)
          writeStageOuterFrame:(NSData *)frame
                       vaultId:(const uint8_t[16])vaultId
                    ceremonyId:(const uint8_t[16])ceremonyId
     expectedSignedEntryLength:(uint64_t)signedEntryLength
    expectedRecoveryWrapLength:(uint64_t)recoveryWrapLength
           expectedFrameDigest:(const uint8_t[32])frameDigest
                    pendingKey:(const uint8_t[32])pendingKey
                         error:(NSError **)error {
  (void)error;
  __block AncPrivateVaultRotationPreparationSpoolStatus result;
  dispatch_sync(self.queue, ^{
    if ([self prepareDirectory] == NO ||
        ValidateBoundFrame(frame, vaultId, ceremonyId, signedEntryLength,
                           recoveryWrapLength, frameDigest, pendingKey) !=
            AncPrivateVaultRotationPreparationSpoolStatusOK) {
      result = AncPrivateVaultRotationPreparationSpoolStatusInvalid;
      return;
    }
    NSString *base = [self baseNameForVaultId:vaultId ceremonyId:ceremonyId];
    NSString *stage = [base stringByAppendingString:@".rotation-spool.stage"];
    NSString *temporary =
        [NSString stringWithFormat:@".%@.%@.tmp", base,
                                   NSUUID.UUID.UUIDString.lowercaseString];
    int dir = [self openValidatedDirectory];
    int fd = dir < 0 ? -1
                     : openat(dir, temporary.fileSystemRepresentation,
                              O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    BOOL okay = fd >= 0;
    AncPrivateVaultRotationPreparationFileWitness witness = {0};
    size_t offset = 0;
    while (okay && offset < frame.length) {
      size_t requested = frame.length - offset;
      if (Fault(AncPrivateVaultRotationPreparationSpoolFaultShortWrite))
        requested = requested > 1 ? requested - 1 : 0;
      ssize_t amount =
          requested == 0
              ? -1
              : write(fd, (const uint8_t *)frame.bytes + offset, requested);
      if (amount <= 0)
        okay = NO;
      else
        offset += (size_t)amount;
    }
    if (okay)
      okay = !Fault(AncPrivateVaultRotationPreparationSpoolFaultFileFsync) &&
             fsync(fd) == 0;
    struct stat writtenStat;
    if (okay)
      okay = fstat(fd, &writtenStat) == 0 && S_ISREG(writtenStat.st_mode) &&
             writtenStat.st_uid == getuid() && writtenStat.st_nlink == 1 &&
             (writtenStat.st_mode & 0777) == 0600 &&
             writtenStat.st_size == (off_t)frame.length &&
             FrameDigest(frame.bytes, frame.length, witness.digest);
    if (okay) {
      witness.device = writtenStat.st_dev;
      witness.inode = writtenStat.st_ino;
      witness.size = writtenStat.st_size;
      witness.present = YES;
    }
    if (fd >= 0) {
      BOOL closed = close(fd) == 0;
      okay = okay && closed &&
             !Fault(AncPrivateVaultRotationPreparationSpoolFaultFileClose);
    }
    if (okay)
      okay = [self verifyWitness:&witness forName:temporary directory:dir];
    if (okay)
      okay =
          !Fault(AncPrivateVaultRotationPreparationSpoolFaultBeforeStageRename);
    if (okay)
      okay = renameat(dir, temporary.fileSystemRepresentation, dir,
                      stage.fileSystemRepresentation) == 0;
    if (okay)
      okay =
          !Fault(
              AncPrivateVaultRotationPreparationSpoolFaultAfterRenameBeforeReadback) &&
          [self verifyWitness:&witness forName:stage directory:dir];
    if (okay)
      okay =
          !Fault(
              AncPrivateVaultRotationPreparationSpoolFaultAfterStageRename) &&
          !Fault(AncPrivateVaultRotationPreparationSpoolFaultDirectoryFsync) &&
          fsync(dir) == 0;
    if (!okay && dir >= 0)
      unlinkat(dir, temporary.fileSystemRepresentation, 0);
    BOOL directoryClosed = CloseDirectoryDescriptor(dir);
    okay = okay && directoryClosed;
    ClearFileWitness(&witness);
    result = okay ? AncPrivateVaultRotationPreparationSpoolStatusOK
                  : AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
  });
  return result;
}

- (AncPrivateVaultRotationPreparationSpoolStatus)
        promoteStageForVaultId:(const uint8_t[16])vaultId
                    ceremonyId:(const uint8_t[16])ceremonyId
     expectedSignedEntryLength:(uint64_t)signedEntryLength
    expectedRecoveryWrapLength:(uint64_t)recoveryWrapLength
           expectedFrameDigest:(const uint8_t[32])frameDigest
                    pendingKey:(const uint8_t[32])pendingKey
                         error:(NSError **)error {
  (void)error;
  __block AncPrivateVaultRotationPreparationSpoolStatus result;
  dispatch_sync(self.queue, ^{
    if (![self prepareDirectory]) {
      result = AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
      return;
    }
    NSString *base = [self baseNameForVaultId:vaultId ceremonyId:ceremonyId];
    NSString *stage = [base stringByAppendingString:@".rotation-spool.stage"];
    NSString *live = [base stringByAppendingString:@".rotation-spool"];
    BOOL stageMissing = NO;
    AncPrivateVaultRotationPreparationFileWitness stageWitness = {0};
    NSData *stageFrame = [self readName:stage
                                missing:&stageMissing
                                witness:&stageWitness];
    if (stageFrame == nil ||
        ValidateBoundFrame(stageFrame, vaultId, ceremonyId, signedEntryLength,
                           recoveryWrapLength, frameDigest, pendingKey) !=
            AncPrivateVaultRotationPreparationSpoolStatusOK) {
      ClearFileWitness(&stageWitness);
      result = stageMissing
                   ? AncPrivateVaultRotationPreparationSpoolStatusNotFound
                   : AncPrivateVaultRotationPreparationSpoolStatusCorrupt;
      return;
    }
    int dir = [self openValidatedDirectory];
    BOOL okay =
        dir >= 0 &&
        [self verifyWitness:&stageWitness forName:stage directory:dir] &&
        !Fault(AncPrivateVaultRotationPreparationSpoolFaultBeforeLiveRename) &&
        renameat(dir, stage.fileSystemRepresentation, dir,
                 live.fileSystemRepresentation) == 0;
    if (okay)
      okay =
          !Fault(
              AncPrivateVaultRotationPreparationSpoolFaultAfterRenameBeforeReadback) &&
          [self verifyWitness:&stageWitness forName:live directory:dir];
    if (okay)
      okay =
          !Fault(AncPrivateVaultRotationPreparationSpoolFaultAfterLiveRename) &&
          !Fault(AncPrivateVaultRotationPreparationSpoolFaultDirectoryFsync) &&
          fsync(dir) == 0;
    BOOL directoryClosed = CloseDirectoryDescriptor(dir);
    okay = okay && directoryClosed;
    ClearFileWitness(&stageWitness);
    result =
        okay
            ? AncPrivateVaultRotationPreparationSpoolStatusOK
            : (errno == ENOENT
                   ? AncPrivateVaultRotationPreparationSpoolStatusNotFound
                   : AncPrivateVaultRotationPreparationSpoolStatusStorageFailed);
  });
  return result;
}

- (AncPrivateVaultRotationPreparationSpoolStatus)
              reconcileVaultId:(const uint8_t[16])vaultId
                    ceremonyId:(const uint8_t[16])ceremonyId
     expectedSignedEntryLength:(uint64_t)signedEntryLength
    expectedRecoveryWrapLength:(uint64_t)recoveryWrapLength
           expectedFrameDigest:(const uint8_t[32])frameDigest
                    pendingKey:(const uint8_t[32])pendingKey
                         error:(NSError **)error {
  (void)error;
  __block AncPrivateVaultRotationPreparationSpoolStatus result;
  dispatch_sync(self.queue, ^{
    if (![self prepareDirectory]) {
      result = AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
      return;
    }
    NSString *base = [self baseNameForVaultId:vaultId ceremonyId:ceremonyId];
    NSString *stageName =
        [base stringByAppendingString:@".rotation-spool.stage"];
    NSString *liveName = [base stringByAppendingString:@".rotation-spool"];
    BOOL liveMissing = NO, stageMissing = NO;
    AncPrivateVaultRotationPreparationFileWitness liveWitness = {0};
    AncPrivateVaultRotationPreparationFileWitness stageWitness = {0};
    NSData *live = [self readName:liveName
                          missing:&liveMissing
                          witness:&liveWitness];
    NSData *stage = [self readName:stageName
                           missing:&stageMissing
                           witness:&stageWitness];
    BOOL liveValid =
        live != nil &&
        ValidateBoundFrame(live, vaultId, ceremonyId, signedEntryLength,
                           recoveryWrapLength, frameDigest, pendingKey) ==
            AncPrivateVaultRotationPreparationSpoolStatusOK;
    BOOL stageValid =
        stage != nil &&
        ValidateBoundFrame(stage, vaultId, ceremonyId, signedEntryLength,
                           recoveryWrapLength, frameDigest, pendingKey) ==
            AncPrivateVaultRotationPreparationSpoolStatusOK;
    if ((!liveMissing && !liveValid) || (!stageMissing && !stageValid)) {
      ClearFileWitness(&liveWitness);
      ClearFileWitness(&stageWitness);
      result = AncPrivateVaultRotationPreparationSpoolStatusCorrupt;
      return;
    }
    if (liveMissing && stageMissing) {
      ClearFileWitness(&liveWitness);
      ClearFileWitness(&stageWitness);
      result = AncPrivateVaultRotationPreparationSpoolStatusNotFound;
      return;
    }
    int dir = [self openValidatedDirectory];
    BOOL okay = dir >= 0;
    if (okay && liveValid && stageValid) {
      okay =
          [self verifyWitness:&liveWitness forName:liveName directory:dir] &&
          [self verifyWitness:&stageWitness forName:stageName directory:dir] &&
          [self unlinkWitness:&stageWitness forName:stageName directory:dir] &&
          [self verifyWitness:&liveWitness forName:liveName directory:dir];
    } else if (okay && !liveValid && stageValid) {
      okay =
          [self verifyWitness:&stageWitness forName:stageName directory:dir] &&
          !Fault(
              AncPrivateVaultRotationPreparationSpoolFaultBeforeLiveRename) &&
          renameat(dir, stageName.fileSystemRepresentation, dir,
                   liveName.fileSystemRepresentation) == 0 &&
          !Fault(
              AncPrivateVaultRotationPreparationSpoolFaultAfterRenameBeforeReadback) &&
          [self verifyWitness:&stageWitness forName:liveName directory:dir];
    }
    if (okay)
      okay =
          !Fault(AncPrivateVaultRotationPreparationSpoolFaultDirectoryFsync) &&
          fsync(dir) == 0;
    BOOL directoryClosed = CloseDirectoryDescriptor(dir);
    okay = okay && directoryClosed;
    ClearFileWitness(&liveWitness);
    ClearFileWitness(&stageWitness);
    result = okay ? AncPrivateVaultRotationPreparationSpoolStatusOK
                  : AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
  });
  return result;
}

- (AncPrivateVaultRotationPreparationSpoolStatus)
               readLiveVaultId:(const uint8_t[16])vaultId
                    ceremonyId:(const uint8_t[16])ceremonyId
     expectedSignedEntryLength:(uint64_t)signedEntryLength
    expectedRecoveryWrapLength:(uint64_t)recoveryWrapLength
           expectedFrameDigest:(const uint8_t[32])frameDigest
                    pendingKey:(const uint8_t[32])pendingKey
                      consumer:
                          (AncPrivateVaultRotationPreparationArtifactsConsumer)
                              consumer
                         error:(NSError **)error {
  (void)error;
  __block AncPrivateVaultRotationPreparationSpoolStatus result;
  dispatch_sync(self.queue, ^{
    if (![self prepareDirectory]) {
      result = AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
      return;
    }
    NSString *name = [[self baseNameForVaultId:vaultId ceremonyId:ceremonyId]
        stringByAppendingString:@".rotation-spool"];
    BOOL missing = NO;
    NSData *frame = [self readName:name missing:&missing witness:NULL];
    if (frame == nil) {
      result = missing
                   ? AncPrivateVaultRotationPreparationSpoolStatusNotFound
                   : AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
      return;
    }
    AncPrivateVaultRotationPreparationSpoolStatus consumeStatus;
    AncPrivateVaultRotationPreparationSpoolConsume(
        frame, vaultId, ceremonyId, signedEntryLength, recoveryWrapLength,
        frameDigest, pendingKey, consumer, &consumeStatus);
    result = consumeStatus;
  });
  return result;
}

- (AncPrivateVaultRotationPreparationSpoolStatus)
    listLiveVaultIds:(NSArray<NSData *> **)vaultIds
               error:(NSError **)error {
  (void)error;
  if (vaultIds == NULL)
    return AncPrivateVaultRotationPreparationSpoolStatusInvalid;
  *vaultIds = nil;
  __block AncPrivateVaultRotationPreparationSpoolStatus result;
  __block NSArray<NSData *> *found = nil;
  dispatch_sync(self.queue, ^{
    if (![self prepareDirectory]) {
      result = self.prepareIntegrityFailure
                   ? AncPrivateVaultRotationPreparationSpoolStatusCorrupt
                   : AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
      return;
    }
    int dir = [self openValidatedDirectory];
    int listingFD = dir < 0 ? -1 : dup(dir);
    DIR *listing = listingFD < 0 ? NULL : fdopendir(listingFD);
    if (listing == NULL ||
        Fault(AncPrivateVaultRotationPreparationSpoolFaultDirectoryListing)) {
      if (listing != NULL)
        closedir(listing);
      else if (listingFD >= 0)
        close(listingFD);
      (void)CloseDirectoryDescriptor(dir);
      result = AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
      return;
    }
    NSMutableOrderedSet<NSData *> *unique = [NSMutableOrderedSet orderedSet];
    NSUInteger liveCandidateCount = 0;
    BOOL okay = YES;
    BOOL integrityFailure = NO;
    struct dirent *entry;
    while (okay) {
      errno = 0;
      entry = readdir(listing);
      if (entry == NULL) {
        okay = errno == 0;
        break;
      }
      if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0)
        continue;
      NSString *name = [NSString stringWithUTF8String:entry->d_name];
      if (name == nil || ![name hasSuffix:@".rotation-spool"])
        continue;
      liveCandidateCount++;
      if (liveCandidateCount > kMaximumLiveCandidateFiles) {
        integrityFailure = YES;
        okay = NO;
        break;
      }
      if (name.length != 64 + @".rotation-spool".length ||
          ![self isSafeFileName:name directory:dir]) {
        integrityFailure = YES;
        okay = NO;
        break;
      }
      uint8_t identity[32] = {0};
      for (NSUInteger index = 0; index < sizeof identity && okay; index++) {
        unichar high = [name characterAtIndex:index * 2];
        unichar low = [name characterAtIndex:index * 2 + 1];
        int highValue = high >= '0' && high <= '9'   ? high - '0'
                        : high >= 'a' && high <= 'f' ? high - 'a' + 10
                                                     : -1;
        int lowValue = low >= '0' && low <= '9'   ? low - '0'
                       : low >= 'a' && low <= 'f' ? low - 'a' + 10
                                                  : -1;
        if (highValue < 0 || lowValue < 0)
          okay = NO;
        else
          identity[index] = (uint8_t)((highValue << 4) | lowValue);
      }
      if (!okay) {
        integrityFailure = YES;
        anc_pv_zeroize(identity, sizeof identity);
        break;
      }
      BOOL missing = NO;
      NSData *frame = [self readName:name missing:&missing witness:NULL];
      BOOL valid =
          frame != nil &&
          ValidateOuter(frame, identity, identity + 16, 0, 0, NULL) ==
              AncPrivateVaultRotationPreparationSpoolStatusOK &&
          ConstantEqual((const uint8_t *)frame.bytes + 20, identity, 16) &&
          ConstantEqual((const uint8_t *)frame.bytes + 36, identity + 16, 16);
      if (valid)
        [unique addObject:[NSData dataWithBytes:identity length:16]];
      anc_pv_zeroize(identity, sizeof identity);
      if (!valid) {
        integrityFailure = YES;
        okay = NO;
      }
    }
    BOOL listingClosed = closedir(listing) == 0;
    BOOL directoryClosed = CloseDirectoryDescriptor(dir);
    okay = okay && listingClosed && directoryClosed;
    if (!okay) {
      result = integrityFailure
                   ? AncPrivateVaultRotationPreparationSpoolStatusCorrupt
                   : AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
      return;
    }
    found = [[unique array] copy];
    result = AncPrivateVaultRotationPreparationSpoolStatusOK;
  });
  if (result == AncPrivateVaultRotationPreparationSpoolStatusOK)
    *vaultIds = found;
  return result;
}

- (AncPrivateVaultRotationPreparationSpoolStatus)
    deleteVaultId:(const uint8_t[16])vaultId
       ceremonyId:(const uint8_t[16])ceremonyId
            error:(NSError **)error {
  (void)error;
  __block AncPrivateVaultRotationPreparationSpoolStatus result;
  dispatch_sync(self.queue, ^{
    if (![self prepareDirectory]) {
      result = AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
      return;
    }
    NSString *base = [self baseNameForVaultId:vaultId ceremonyId:ceremonyId];
    NSString *live = [base stringByAppendingString:@".rotation-spool"];
    NSString *stage = [base stringByAppendingString:@".rotation-spool.stage"];
    BOOL liveMissing = NO, stageMissing = NO;
    AncPrivateVaultRotationPreparationFileWitness liveWitness = {0};
    AncPrivateVaultRotationPreparationFileWitness stageWitness = {0};
    NSData *liveFrame = [self readName:live
                               missing:&liveMissing
                               witness:&liveWitness];
    NSData *stageFrame = [self readName:stage
                                missing:&stageMissing
                                witness:&stageWitness];
    if ((!liveMissing && liveFrame == nil) ||
        (!stageMissing && stageFrame == nil)) {
      ClearFileWitness(&liveWitness);
      ClearFileWitness(&stageWitness);
      result = AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
      return;
    }
    int dir = [self openValidatedDirectory];
    BOOL okay = dir >= 0 &&
                [self quarantineAndDeleteName:live
                                      witness:&liveWitness
                                     baseName:base
                                    directory:dir] &&
                [self quarantineAndDeleteName:stage
                                      witness:&stageWitness
                                     baseName:base
                                    directory:dir];
    if (okay)
      okay =
          !Fault(AncPrivateVaultRotationPreparationSpoolFaultDirectoryFsync) &&
          fsync(dir) == 0;
    BOOL directoryClosed = CloseDirectoryDescriptor(dir);
    okay = okay && directoryClosed;
    ClearFileWitness(&liveWitness);
    ClearFileWitness(&stageWitness);
    result = okay ? AncPrivateVaultRotationPreparationSpoolStatusOK
                  : AncPrivateVaultRotationPreparationSpoolStatusStorageFailed;
  });
  return result;
}
@end
