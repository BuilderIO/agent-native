#import "PrivateVaultGenesisStartup.h"

#include <sodium.h>

AncPrivateVaultGenesisStartupStatus
AncPrivateVaultResumePendingGenesisArtifacts(
    AncPrivateVaultGenesisArtifactStore *artifactStore,
    AncPrivateVaultGenesisCoordinator *coordinator) {
  if (artifactStore == nil || coordinator == nil)
    return AncPrivateVaultGenesisStartupStatusInvalid;

  NSArray<NSData *> *vaultIds = nil;
  if ([artifactStore listVaultIds:&vaultIds] !=
      AncPrivateVaultGenesisArtifactStoreStatusOK)
    return AncPrivateVaultGenesisStartupStatusDiscoveryFailed;

  for (NSData *vaultId in vaultIds) {
    if (vaultId.length != 16)
      return AncPrivateVaultGenesisStartupStatusDiscoveryFailed;
    uint8_t bytes[16] = {0};
    [vaultId getBytes:bytes length:sizeof bytes];
    AncPrivateVaultGenesisCoordinatorResult *result = nil;
    AncPrivateVaultGenesisCoordinatorStatus status =
        [coordinator resumeVaultId:bytes result:&result];
    sodium_memzero(bytes, sizeof bytes);
    if (status != AncPrivateVaultGenesisCoordinatorStatusOK || result == nil)
      return AncPrivateVaultGenesisStartupStatusResumeFailed;
  }

  NSArray<NSData *> *remaining = nil;
  if ([artifactStore listVaultIds:&remaining] !=
      AncPrivateVaultGenesisArtifactStoreStatusOK)
    return AncPrivateVaultGenesisStartupStatusDiscoveryFailed;
  return remaining.count == 0 ? AncPrivateVaultGenesisStartupStatusOK
                              : AncPrivateVaultGenesisStartupStatusResumeFailed;
}
