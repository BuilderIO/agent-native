#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultGenesisArtifactStoreStatus) {
  AncPrivateVaultGenesisArtifactStoreStatusOK = 0,
  AncPrivateVaultGenesisArtifactStoreStatusNotFound = 1,
  AncPrivateVaultGenesisArtifactStoreStatusInvalid = 2,
  AncPrivateVaultGenesisArtifactStoreStatusConflict = 3,
  AncPrivateVaultGenesisArtifactStoreStatusCorrupt = 4,
  AncPrivateVaultGenesisArtifactStoreStatusStorageFailed = 5,
};

enum {
  ANC_PV_GENESIS_ARTIFACT_MAX_VAULTS = 256,
  ANC_PV_GENESIS_ARTIFACT_MAX_STALE_TEMPORARIES = 256,
};

/* Immutable, public-only recovery material. No endpoint or epoch secret is
 * accepted by this type or written by the artifact store. */
@interface AncPrivateVaultGenesisArtifacts : NSObject
@property(nonatomic, readonly) NSData *vaultId;
@property(nonatomic, readonly) NSData *ceremonyId;
@property(nonatomic, readonly) uint64_t verifiedAtMs;
@property(nonatomic, readonly) NSData *bootstrapTranscript;
@property(nonatomic, readonly) NSData *recoveryConfirmation;
@property(nonatomic, readonly) NSData *authorization;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultGenesisArtifactStore : NSObject
/* stateRootURL must already be a real, owner-only 0700 directory. */
- (instancetype)initWithStateRootURL:(NSURL *)stateRootURL
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

- (AncPrivateVaultGenesisArtifactStoreStatus)
            stageVaultId:(const uint8_t *)vaultId
              ceremonyId:(const uint8_t *)ceremonyId
            verifiedAtMs:(uint64_t)verifiedAtMs
     bootstrapTranscript:(NSData *)bootstrapTranscript
    recoveryConfirmation:(NSData *)recoveryConfirmation
           authorization:(NSData *)authorization;
- (AncPrivateVaultGenesisArtifactStoreStatus)
    readVaultId:(const uint8_t *)vaultId
      artifacts:(AncPrivateVaultGenesisArtifacts *_Nullable *_Nonnull)artifacts;
- (AncPrivateVaultGenesisArtifactStoreStatus)deleteVaultId:
    (const uint8_t *)vaultId;
/* Returns copied immutable, unique, validated 16-byte vault identifiers only.
 * Strictly named stale write temporaries are removed durably during discovery.
 */
- (AncPrivateVaultGenesisArtifactStoreStatus)listVaultIds:
    (NSArray<NSData *> *_Nullable *_Nonnull)vaultIds;
@end

typedef NS_ENUM(NSInteger, AncPrivateVaultGenesisArtifactFaultPoint) {
  AncPrivateVaultGenesisArtifactFaultShortWrite = 1,
  AncPrivateVaultGenesisArtifactFaultFileFsync = 2,
  AncPrivateVaultGenesisArtifactFaultAfterRename = 3,
  AncPrivateVaultGenesisArtifactFaultDirectoryFsync = 4,
  AncPrivateVaultGenesisArtifactFaultBeforeReadback = 5,
  AncPrivateVaultGenesisArtifactFaultBeforeUnlink = 6,
  AncPrivateVaultGenesisArtifactFaultStateCreateFsync = 7,
  AncPrivateVaultGenesisArtifactFaultGenesisCreateFsync = 8,
};

#if ANC_PRIVATE_VAULT_TESTING
typedef BOOL (^AncPrivateVaultGenesisArtifactFaultHook)(
    AncPrivateVaultGenesisArtifactFaultPoint point);
FOUNDATION_EXPORT void AncPrivateVaultGenesisArtifactSetFaultHookForTesting(
    AncPrivateVaultGenesisArtifactFaultHook _Nullable hook);
#endif

NS_ASSUME_NONNULL_END
