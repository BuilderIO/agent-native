#import <Foundation/Foundation.h>

#import "PrivateVaultGenesisArtifactStore.h"
#import "PrivateVaultGenesisCoordinator.h"
#import "PrivateVaultGenesisPreparationStore.h"

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

/* Full request-surface startup gate. Preparation lookup ids are native-only;
 * confirmed work is resumed without an external bearer, expired PREPARED work
 * is terminalized, and the legacy public genesis spool is drained before the
 * service opens XPC. */
FOUNDATION_EXPORT AncPrivateVaultGenesisStartupStatus
AncPrivateVaultResumePendingGenesisState(
    AncPrivateVaultGenesisArtifactStore *_Nullable artifactStore,
    AncPrivateVaultGenesisPreparationStore *_Nullable preparationStore,
    AncPrivateVaultGenesisCoordinator *_Nullable coordinator);

NS_ASSUME_NONNULL_END
