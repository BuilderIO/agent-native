#import "PrivateVaultGenesisStartup.h"
#import "PrivateVaultGenesisCoordinatorInternal.h"
#import "PrivateVaultGenesisPreparationStoreInternal.h"

#import <objc/runtime.h>

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

AncPrivateVaultGenesisStartupStatus AncPrivateVaultResumePendingGenesisState(
    AncPrivateVaultGenesisArtifactStore *artifactStore,
    AncPrivateVaultGenesisPreparationStore *preparationStore,
    AncPrivateVaultGenesisCoordinator *coordinator) {
  if (artifactStore == nil || preparationStore == nil || coordinator == nil ||
      object_getClass(artifactStore) !=
          AncPrivateVaultGenesisArtifactStore.class ||
      object_getClass(preparationStore) !=
          AncPrivateVaultGenesisPreparationStore.class ||
      object_getClass(coordinator) != AncPrivateVaultGenesisCoordinator.class)
    return AncPrivateVaultGenesisStartupStatusInvalid;

  if ([coordinator validateTrustedTimeForStartup] !=
      AncPrivateVaultGenesisCoordinatorStatusOK)
    return AncPrivateVaultGenesisStartupStatusResumeFailed;

  for (NSUInteger pass = 0; pass < 2; pass += 1) {
    NSArray<NSData *> *lookupIds = nil;
    if ([preparationStore listPreparationLookupIds:&lookupIds] !=
        AncPrivateVaultGenesisPreparationStoreStatusOK)
      return AncPrivateVaultGenesisStartupStatusDiscoveryFailed;
    for (NSData *lookupId in lookupIds) {
      if (![lookupId isKindOfClass:NSData.class] || lookupId.length != 16)
        return AncPrivateVaultGenesisStartupStatusDiscoveryFailed;
      uint8_t lookupBytes[16] = {0};
      [lookupId getBytes:lookupBytes length:sizeof lookupBytes];
      AncPrivateVaultGenesisPreparationStoreStatus reconciled =
          [preparationStore reconcileLookupId:lookupBytes
                                       length:sizeof lookupBytes];
      sodium_memzero(lookupBytes, sizeof lookupBytes);
      if (reconciled == AncPrivateVaultGenesisPreparationStoreStatusNotFound)
        continue;
      if (reconciled != AncPrivateVaultGenesisPreparationStoreStatusOK)
        return AncPrivateVaultGenesisStartupStatusResumeFailed;
      if ([coordinator resumePreparationLookupId:lookupId] !=
          AncPrivateVaultGenesisCoordinatorStatusOK)
        return AncPrivateVaultGenesisStartupStatusResumeFailed;
    }
    if (pass == 0 &&
        AncPrivateVaultResumePendingGenesisArtifacts(artifactStore,
                                                     coordinator) !=
            AncPrivateVaultGenesisStartupStatusOK)
      return AncPrivateVaultGenesisStartupStatusResumeFailed;
  }

  NSArray<NSData *> *remaining = nil;
  if ([preparationStore listPreparationLookupIds:&remaining] !=
      AncPrivateVaultGenesisPreparationStoreStatusOK)
    return AncPrivateVaultGenesisStartupStatusDiscoveryFailed;
  for (NSData *lookupId in remaining) {
    if (![lookupId isKindOfClass:NSData.class] || lookupId.length != 16)
      return AncPrivateVaultGenesisStartupStatusDiscoveryFailed;
    uint8_t lookupBytes[16] = {0};
    [lookupId getBytes:lookupBytes length:sizeof lookupBytes];
    AncPrivateVaultGenesisPreparationSnapshot snapshot;
    AncPrivateVaultGenesisPreparationStoreStatus read =
        [preparationStore readLookupId:lookupBytes
                                length:sizeof lookupBytes
                              snapshot:&snapshot
                           secretHandle:nil];
    sodium_memzero(lookupBytes, sizeof lookupBytes);
    BOOL allowedPending =
        read == AncPrivateVaultGenesisPreparationStoreStatusOK &&
        snapshot.phase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED;
    anc_pv_genesis_preparation_snapshot_zero(&snapshot);
    if (!allowedPending)
      return AncPrivateVaultGenesisStartupStatusResumeFailed;
  }
  return AncPrivateVaultGenesisStartupStatusOK;
}
