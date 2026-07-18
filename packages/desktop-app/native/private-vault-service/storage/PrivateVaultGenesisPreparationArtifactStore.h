#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

enum {
  ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES = 192,
  ANC_PV_GENESIS_PREPARATION_ARTIFACT_WRAP_MAX_BYTES = 1048576,
  ANC_PV_GENESIS_PREPARATION_ARTIFACT_CONFIRMATION_MAX_BYTES = 65536,
  ANC_PV_GENESIS_PREPARATION_ARTIFACT_BOOTSTRAP_MAX_BYTES = 131072,
  ANC_PV_GENESIS_PREPARATION_ARTIFACT_AUTHORIZATION_MAX_BYTES = 1048576,
  ANC_PV_GENESIS_PREPARATION_INDEX_BYTES = 104,
  ANC_PV_GENESIS_PREPARATION_INDEX_MAXIMUM = 256,
};

typedef NS_ENUM(NSInteger, AncPrivateVaultGenesisPreparationArtifactStatus) {
  AncPrivateVaultGenesisPreparationArtifactStatusOK = 0,
  AncPrivateVaultGenesisPreparationArtifactStatusNotFound,
  AncPrivateVaultGenesisPreparationArtifactStatusInvalid,
  AncPrivateVaultGenesisPreparationArtifactStatusCorrupt,
  AncPrivateVaultGenesisPreparationArtifactStatusBindingMismatch,
  AncPrivateVaultGenesisPreparationArtifactStatusConflict,
  AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed,
};

typedef BOOL (^AncPrivateVaultGenesisPreparationArtifactsConsumer)(
    const uint8_t *recoveryWrap, size_t recoveryWrapLength,
    const uint8_t *confirmation, size_t confirmationLength,
    const uint8_t *bootstrap, size_t bootstrapLength,
    const uint8_t *authorization, size_t authorizationLength);

@interface AncPrivateVaultGenesisPreparationArtifactStore : NSObject
- (instancetype)initWithStateRootURL:(NSURL *)stateRootURL NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
- (AncPrivateVaultGenesisPreparationArtifactStatus)
    stageLookupId:(const uint8_t *)lookupId vaultId:(const uint8_t *)vaultId
       ceremonyId:(const uint8_t *)ceremonyId generation:(uint64_t)generation
      recoveryWrap:(NSData *)recoveryWrap confirmation:(NSData *)confirmation
          bootstrap:(NSData *)bootstrap authorization:(NSData *)authorization
           digest:(uint8_t *)digest;
// `generation` is the immutable confirmation generation (exactly 2), not the
// preparation record's later fence generation.
- (AncPrivateVaultGenesisPreparationArtifactStatus)
    promoteLookupId:(const uint8_t *)lookupId expectedDigest:(const uint8_t *)digest;
- (AncPrivateVaultGenesisPreparationArtifactStatus)
    reconcileLookupId:(const uint8_t *)lookupId expectedDigest:(const uint8_t *)digest;
- (AncPrivateVaultGenesisPreparationArtifactStatus)
    readLiveLookupId:(const uint8_t *)lookupId vaultId:(const uint8_t *)vaultId
           ceremonyId:(const uint8_t *)ceremonyId generation:(uint64_t)generation
       expectedDigest:(const uint8_t *)digest
              consumer:(AncPrivateVaultGenesisPreparationArtifactsConsumer)consumer;
- (AncPrivateVaultGenesisPreparationArtifactStatus)
    deleteStagedLookupId:(const uint8_t *)lookupId
          expectedDigest:(const uint8_t *)digest;
/* Deletes an unbound staged confirmation only after its complete authenticated
 * frame matches the durable PREPARED ceremony. This is the crash cleanup path
 * for a stage write that preceded a failed preparation-record CAS. */
- (AncPrivateVaultGenesisPreparationArtifactStatus)
    deleteUnboundStagedLookupId:(const uint8_t *)lookupId
                        vaultId:(const uint8_t *)vaultId
                     ceremonyId:(const uint8_t *)ceremonyId
                     generation:(uint64_t)generation;
/* Deletes only an exactly digest-bound live spool. A mismatched or unsafe
 * path fails closed and is never unlinked. */
- (AncPrivateVaultGenesisPreparationArtifactStatus)
    deleteLiveLookupId:(const uint8_t *)lookupId
        expectedDigest:(const uint8_t *)digest;
- (AncPrivateVaultGenesisPreparationArtifactStatus)
    createPreparationIndexLookupId:(const uint8_t *)lookupId
                       preparedAtMs:(uint64_t)preparedAtMs
                        expiresAtMs:(uint64_t)expiresAtMs;
- (AncPrivateVaultGenesisPreparationArtifactStatus)
    listPreparationLookupIds:(NSArray<NSData *> *_Nullable *_Nonnull)lookupIds;
- (AncPrivateVaultGenesisPreparationArtifactStatus)
    deletePreparationIndexLookupId:(const uint8_t *)lookupId;
@end

typedef NS_ENUM(NSInteger, AncPrivateVaultGenesisPreparationArtifactFaultPoint) {
  AncPrivateVaultGenesisPreparationArtifactFaultShortWrite = 1,
  AncPrivateVaultGenesisPreparationArtifactFaultFileFsync,
  AncPrivateVaultGenesisPreparationArtifactFaultAfterStageRename,
  AncPrivateVaultGenesisPreparationArtifactFaultDirectoryFsync,
  AncPrivateVaultGenesisPreparationArtifactFaultBeforeReadback,
  AncPrivateVaultGenesisPreparationArtifactFaultBeforeLiveRename,
  AncPrivateVaultGenesisPreparationArtifactFaultBeforeUnlink,
};
#if ANC_PRIVATE_VAULT_TESTING
typedef BOOL (^AncPrivateVaultGenesisPreparationArtifactFaultHook)(
    AncPrivateVaultGenesisPreparationArtifactFaultPoint point);
FOUNDATION_EXPORT void
AncPrivateVaultGenesisPreparationArtifactSetFaultHookForTesting(
    AncPrivateVaultGenesisPreparationArtifactFaultHook _Nullable hook);
#endif

NS_ASSUME_NONNULL_END
