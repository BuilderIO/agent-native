#import <Foundation/Foundation.h>

#include <stdint.h>

NS_ASSUME_NONNULL_BEGIN

enum {
  ANC_PV_ROTATION_ID_BYTES = 16,
  ANC_PV_ROTATION_PENDING_KEY_BYTES = 32,
  ANC_PV_ROTATION_SPOOL_NONCE_BYTES = 24,
  ANC_PV_ROTATION_SPOOL_DIGEST_BYTES = 32,
  ANC_PV_ROTATION_SIGNED_ENTRY_MAX_BYTES = 65536,
  ANC_PV_ROTATION_RECOVERY_WRAP_MAX_BYTES = 1048576,
};

typedef NS_ENUM(NSInteger, AncPrivateVaultRotationPreparationSpoolStatus) {
  AncPrivateVaultRotationPreparationSpoolStatusOK = 0,
  AncPrivateVaultRotationPreparationSpoolStatusNotFound = 1,
  AncPrivateVaultRotationPreparationSpoolStatusInvalid = 2,
  AncPrivateVaultRotationPreparationSpoolStatusCorrupt = 3,
  AncPrivateVaultRotationPreparationSpoolStatusBindingMismatch = 4,
  AncPrivateVaultRotationPreparationSpoolStatusAuthenticationFailed = 5,
  AncPrivateVaultRotationPreparationSpoolStatusStorageFailed = 6,
  AncPrivateVaultRotationPreparationSpoolStatusConflict = 7,
  AncPrivateVaultRotationPreparationSpoolStatusWireMagic = 8,
  AncPrivateVaultRotationPreparationSpoolStatusWireVersion = 9,
  AncPrivateVaultRotationPreparationSpoolStatusWireFlags = 10,
  AncPrivateVaultRotationPreparationSpoolStatusWireReserved = 11,
  AncPrivateVaultRotationPreparationSpoolStatusRangeArtifactLength = 12,
  AncPrivateVaultRotationPreparationSpoolStatusBindingVault = 13,
  AncPrivateVaultRotationPreparationSpoolStatusBindingCeremony = 14,
  AncPrivateVaultRotationPreparationSpoolStatusBindingSignedHash = 15,
  AncPrivateVaultRotationPreparationSpoolStatusBindingRecoveryWrapHash = 16,
  AncPrivateVaultRotationPreparationSpoolStatusCryptoChecksum = 17,
  AncPrivateVaultRotationPreparationSpoolStatusWireTruncation = 18,
  AncPrivateVaultRotationPreparationSpoolStatusWireExtraBytes = 19,
  AncPrivateVaultRotationPreparationSpoolStatusBindingSubstitution = 20,
  AncPrivateVaultRotationPreparationSpoolStatusEncryptionMagic = 21,
  AncPrivateVaultRotationPreparationSpoolStatusEncryptionVersion = 22,
  AncPrivateVaultRotationPreparationSpoolStatusEncryptionFlags = 23,
  AncPrivateVaultRotationPreparationSpoolStatusEncryptionReserved = 24,
  AncPrivateVaultRotationPreparationSpoolStatusEncryptionLength = 25,
  AncPrivateVaultRotationPreparationSpoolStatusEncryptionBounds = 26,
  AncPrivateVaultRotationPreparationSpoolStatusEncryptionChecksum = 27,
  AncPrivateVaultRotationPreparationSpoolStatusEncryptionAEAD = 28,
  AncPrivateVaultRotationPreparationSpoolStatusRecordSpoolLength = 29,
  AncPrivateVaultRotationPreparationSpoolStatusRecordSpoolDigest = 30,
};

FOUNDATION_EXPORT const char *
AncPrivateVaultRotationPreparationSpoolStatusCategory(
    AncPrivateVaultRotationPreparationSpoolStatus status);

typedef BOOL (^AncPrivateVaultRotationPreparationArtifactsConsumer)(
    const uint8_t *signedEntry, size_t signedEntryLength,
    const uint8_t *recoveryWrap, size_t recoveryWrapLength);

/* The returned NSData is ciphertext. Plaintext artifacts and derived keys are
 * held only in controlled mutable storage and cleared before this returns. */
FOUNDATION_EXPORT NSData
    *_Nullable AncPrivateVaultRotationPreparationSpoolEncode(
        const uint8_t *signedEntry, size_t signedEntryLength,
        const uint8_t *recoveryWrap, size_t recoveryWrapLength,
        const uint8_t *vaultId, const uint8_t *ceremonyId,
        const uint8_t *pendingKey, const uint8_t *nonce,
        uint8_t *outFrameDigest,
        AncPrivateVaultRotationPreparationSpoolStatus *_Nullable status);

/* Decrypts and validates synchronously. Pointers passed to consumer are valid
 * only for the duration of the callback and are cleared immediately after. */
FOUNDATION_EXPORT BOOL AncPrivateVaultRotationPreparationSpoolConsume(
    NSData *encryptedFrame, const uint8_t *expectedVaultId,
    const uint8_t *expectedCeremonyId, uint64_t expectedSignedEntryLength,
    uint64_t expectedRecoveryWrapLength, const uint8_t *expectedFrameDigest,
    const uint8_t *pendingKey,
    AncPrivateVaultRotationPreparationArtifactsConsumer consumer,
    AncPrivateVaultRotationPreparationSpoolStatus *_Nullable status);

@interface AncPrivateVaultRotationPreparationSpoolStore : NSObject
/* stateRootURL is a preapproved, already-existing, owner-only 0700 directory.
 * The store never creates, chmods, or follows links for this trust anchor. */
- (instancetype)initWithStateRootURL:(NSURL *)stateRootURL
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

- (AncPrivateVaultRotationPreparationSpoolStatus)
          writeStageOuterFrame:(NSData *)encryptedFrame
                       vaultId:(const uint8_t *)vaultId
                    ceremonyId:(const uint8_t *)ceremonyId
     expectedSignedEntryLength:(uint64_t)signedEntryLength
    expectedRecoveryWrapLength:(uint64_t)recoveryWrapLength
           expectedFrameDigest:(const uint8_t *)frameDigest
                    pendingKey:(const uint8_t *)pendingKey
                         error:(NSError *_Nullable *_Nullable)error;
- (AncPrivateVaultRotationPreparationSpoolStatus)
        promoteStageForVaultId:(const uint8_t *)vaultId
                    ceremonyId:(const uint8_t *)ceremonyId
     expectedSignedEntryLength:(uint64_t)signedEntryLength
    expectedRecoveryWrapLength:(uint64_t)recoveryWrapLength
           expectedFrameDigest:(const uint8_t *)frameDigest
                    pendingKey:(const uint8_t *)pendingKey
                         error:(NSError *_Nullable *_Nullable)error;
- (AncPrivateVaultRotationPreparationSpoolStatus)
              reconcileVaultId:(const uint8_t *)vaultId
                    ceremonyId:(const uint8_t *)ceremonyId
     expectedSignedEntryLength:(uint64_t)signedEntryLength
    expectedRecoveryWrapLength:(uint64_t)recoveryWrapLength
           expectedFrameDigest:(const uint8_t *)frameDigest
                    pendingKey:(const uint8_t *)pendingKey
                         error:(NSError *_Nullable *_Nullable)error;
- (AncPrivateVaultRotationPreparationSpoolStatus)
               readLiveVaultId:(const uint8_t *)vaultId
                    ceremonyId:(const uint8_t *)ceremonyId
     expectedSignedEntryLength:(uint64_t)signedEntryLength
    expectedRecoveryWrapLength:(uint64_t)recoveryWrapLength
           expectedFrameDigest:(const uint8_t *)frameDigest
                    pendingKey:(const uint8_t *)pendingKey
                      consumer:
                          (AncPrivateVaultRotationPreparationArtifactsConsumer)
                              consumer
                         error:(NSError *_Nullable *_Nullable)error;
- (AncPrivateVaultRotationPreparationSpoolStatus)
    deleteVaultId:(const uint8_t *)vaultId
       ceremonyId:(const uint8_t *)ceremonyId
            error:(NSError *_Nullable *_Nullable)error;
@end

typedef NS_ENUM(NSInteger, AncPrivateVaultRotationPreparationSpoolFaultPoint) {
  AncPrivateVaultRotationPreparationSpoolFaultShortWrite = 1,
  AncPrivateVaultRotationPreparationSpoolFaultFileFsync = 2,
  AncPrivateVaultRotationPreparationSpoolFaultFileClose = 3,
  AncPrivateVaultRotationPreparationSpoolFaultDirectoryFsync = 4,
  AncPrivateVaultRotationPreparationSpoolFaultDirectoryListing = 5,
  AncPrivateVaultRotationPreparationSpoolFaultBeforeDirectoryReopen = 6,
  AncPrivateVaultRotationPreparationSpoolFaultBeforeFileOpen = 7,
  AncPrivateVaultRotationPreparationSpoolFaultAfterStageRename = 8,
  AncPrivateVaultRotationPreparationSpoolFaultAfterLiveRename = 9,
  AncPrivateVaultRotationPreparationSpoolFaultGuardedAllocation = 10,
  AncPrivateVaultRotationPreparationSpoolFaultGuardedMLock = 11,
  AncPrivateVaultRotationPreparationSpoolFaultGuardedProtection = 12,
  AncPrivateVaultRotationPreparationSpoolFaultBeforeStageRename = 13,
  AncPrivateVaultRotationPreparationSpoolFaultBeforeLiveRename = 14,
  AncPrivateVaultRotationPreparationSpoolFaultBeforeUnlink = 15,
  AncPrivateVaultRotationPreparationSpoolFaultAfterRenameBeforeReadback = 16,
  AncPrivateVaultRotationPreparationSpoolFaultDirectoryClose = 17,
};

#if ANC_PRIVATE_VAULT_TESTING
typedef BOOL (^AncPrivateVaultRotationPreparationSpoolFaultHook)(
    AncPrivateVaultRotationPreparationSpoolFaultPoint point);
FOUNDATION_EXPORT void
    AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(
        AncPrivateVaultRotationPreparationSpoolFaultHook _Nullable hook);
typedef void (^AncPrivateVaultRotationPreparationSpoolClearHook)(
    BOOL innerCleared, BOOL keyCleared);
FOUNDATION_EXPORT void
    AncPrivateVaultRotationPreparationSpoolSetClearHookForTesting(
        AncPrivateVaultRotationPreparationSpoolClearHook _Nullable hook);
#endif

NS_ASSUME_NONNULL_END
