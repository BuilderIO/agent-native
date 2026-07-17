#import "PrivateVaultHostedAppendCandidateIndex.h"

#import <objc/runtime.h>

#include <string.h>

@interface AncPrivateVaultHostedAppendCandidateIndex ()
@property(nonatomic, readonly)
    AncPrivateVaultRotationPreparationSpoolStore *spool;
@property(nonatomic, readonly)
    AncPrivateVaultHostedAppendRetryStore *retryStore;
@end

@implementation AncPrivateVaultHostedAppendCandidateIndex

- (instancetype)
    initWithSpool:(AncPrivateVaultRotationPreparationSpoolStore *)spool
       retryStore:(AncPrivateVaultHostedAppendRetryStore *)retryStore {
  if (object_getClass(spool) !=
          AncPrivateVaultRotationPreparationSpoolStore.class
      || object_getClass(retryStore) !=
             AncPrivateVaultHostedAppendRetryStore.class)
    return nil;
  self = [super init];
  if (self == nil)
    return nil;
  _spool = spool;
  _retryStore = retryStore;
  return self;
}

static AncPrivateVaultHostedAppendCandidateStatus
AncCandidateSpoolStatus(AncPrivateVaultRotationPreparationSpoolStatus status) {
  if (status == AncPrivateVaultRotationPreparationSpoolStatusOK)
    return AncPrivateVaultHostedAppendCandidateStatusOK;
  if (status == AncPrivateVaultRotationPreparationSpoolStatusStorageFailed)
    return AncPrivateVaultHostedAppendCandidateStatusUnavailable;
  if (status == AncPrivateVaultRotationPreparationSpoolStatusInvalid)
    return AncPrivateVaultHostedAppendCandidateStatusInvalid;
  return AncPrivateVaultHostedAppendCandidateStatusCorrupt;
}

static AncPrivateVaultHostedAppendCandidateStatus
AncCandidateRetryStatus(AncPrivateVaultHostedAppendRetryStoreStatus status) {
  switch (status) {
  case AncPrivateVaultHostedAppendRetryStoreStatusOK:
    return AncPrivateVaultHostedAppendCandidateStatusOK;
  case AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed:
    return AncPrivateVaultHostedAppendCandidateStatusUnavailable;
  case AncPrivateVaultHostedAppendRetryStoreStatusInvalid:
    return AncPrivateVaultHostedAppendCandidateStatusInvalid;
  case AncPrivateVaultHostedAppendRetryStoreStatusCorrupt:
    return AncPrivateVaultHostedAppendCandidateStatusCorrupt;
  }
  return AncPrivateVaultHostedAppendCandidateStatusCorrupt;
}

static BOOL AncCandidateIdentifier(NSData *value) {
  return [value isKindOfClass:NSData.class] &&
         ![value isKindOfClass:NSMutableData.class] && value.length == 16;
}

- (AncPrivateVaultHostedAppendCandidateStatus)pendingHostedAppendVaultIds:
    (NSArray<NSData *> **)vaultIds {
  if (vaultIds == NULL)
    return AncPrivateVaultHostedAppendCandidateStatusInvalid;
  *vaultIds = nil;
  NSArray<NSData *> *spoolVaults = nil;
  AncPrivateVaultHostedAppendCandidateStatus status =
      AncCandidateSpoolStatus([self.spool listLiveVaultIds:&spoolVaults
                                                     error:nil]);
  if (status != AncPrivateVaultHostedAppendCandidateStatusOK)
    return status;
  NSArray<NSData *> *markedVaults = nil;
  status =
      AncCandidateRetryStatus([self.retryStore listVaultIds:&markedVaults]);
  if (status != AncPrivateVaultHostedAppendCandidateStatusOK)
    return status;
  if (spoolVaults == nil || markedVaults == nil)
    return AncPrivateVaultHostedAppendCandidateStatusCorrupt;
  NSMutableSet<NSData *> *unique = [NSMutableSet set];
  for (id candidate in
       [spoolVaults arrayByAddingObjectsFromArray:markedVaults]) {
    if (!AncCandidateIdentifier(candidate))
      return AncPrivateVaultHostedAppendCandidateStatusCorrupt;
    [unique addObject:[candidate copy]];
    if (unique.count > ANC_PV_HOSTED_APPEND_RETRY_MAX_CANDIDATES)
      return AncPrivateVaultHostedAppendCandidateStatusCorrupt;
  }
  NSArray<NSData *> *sorted = [unique.allObjects
      sortedArrayUsingComparator:^NSComparisonResult(NSData *left,
                                                     NSData *right) {
        int compared = memcmp(left.bytes, right.bytes, 16);
        return compared < 0   ? NSOrderedAscending
               : compared > 0 ? NSOrderedDescending
                              : NSOrderedSame;
      }];
  *vaultIds = [sorted copy];
  return AncPrivateVaultHostedAppendCandidateStatusOK;
}

- (AncPrivateVaultHostedAppendCandidateStatus)markPendingVaultId:
    (NSData *)vaultId {
  if (!AncCandidateIdentifier(vaultId))
    return AncPrivateVaultHostedAppendCandidateStatusInvalid;
  return AncCandidateRetryStatus([self.retryStore addVaultId:vaultId.bytes]);
}

- (AncPrivateVaultHostedAppendCandidateStatus)clearPendingVaultId:
    (NSData *)vaultId {
  if (!AncCandidateIdentifier(vaultId))
    return AncPrivateVaultHostedAppendCandidateStatusInvalid;
  return AncCandidateRetryStatus([self.retryStore removeVaultId:vaultId.bytes]);
}

@end
