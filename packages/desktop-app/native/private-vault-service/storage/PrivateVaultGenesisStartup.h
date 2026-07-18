#import <Foundation/Foundation.h>

#import "PrivateVaultGenesisArtifactStore.h"
#import "PrivateVaultGenesisCoordinator.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultGenesisStartupStatus) {
  AncPrivateVaultGenesisStartupStatusOK = 0,
  AncPrivateVaultGenesisStartupStatusInvalid = 1,
  AncPrivateVaultGenesisStartupStatusDiscoveryFailed = 2,
  AncPrivateVaultGenesisStartupStatusResumeFailed = 3,
};

/* Synchronously drains the validated, public-only genesis recovery directory.
 * The caller must keep the request surface closed until this returns OK. */
FOUNDATION_EXPORT AncPrivateVaultGenesisStartupStatus
AncPrivateVaultResumePendingGenesisArtifacts(
    AncPrivateVaultGenesisArtifactStore *_Nullable artifactStore,
    AncPrivateVaultGenesisCoordinator *_Nullable coordinator);

NS_ASSUME_NONNULL_END
