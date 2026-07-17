#import <Foundation/Foundation.h>

#include <assert.h>
#include <sys/stat.h>

#import "PrivateVaultHostedAppendCandidateIndex.h"

int main(void) {
  @autoreleasepool {
    NSURL *root = [NSURL
        fileURLWithPath:[NSTemporaryDirectory()
                            stringByAppendingPathComponent:NSUUID.UUID
                                                               .UUIDString]
            isDirectory:YES];
    BOOL created = [NSFileManager.defaultManager
               createDirectoryAtURL:root
        withIntermediateDirectories:NO
                         attributes:@{
                           NSFilePosixPermissions : @0700,
                         }
                              error:nil];
    assert(created);
    assert(chmod(root.fileSystemRepresentation, 0700) == 0);
    AncPrivateVaultRotationPreparationSpoolStore *spool =
        [[AncPrivateVaultRotationPreparationSpoolStore alloc]
            initWithStateRootURL:root];
    AncPrivateVaultHostedAppendRetryStore *retryStore =
        [[AncPrivateVaultHostedAppendRetryStore alloc]
            initWithStateRootURL:root];
    AncPrivateVaultHostedAppendCandidateIndex *index =
        [[AncPrivateVaultHostedAppendCandidateIndex alloc]
            initWithSpool:spool
               retryStore:retryStore];
    assert(index != nil);
    uint8_t raw[16] = {0};
    raw[15] = 7;
    NSData *vaultId = [NSData dataWithBytes:raw length:sizeof raw];
    assert([index markPendingVaultId:vaultId] ==
           AncPrivateVaultHostedAppendCandidateStatusOK);
    NSArray<NSData *> *candidates = nil;
    assert([index pendingHostedAppendVaultIds:&candidates] ==
               AncPrivateVaultHostedAppendCandidateStatusOK &&
           candidates.count == 1 &&
           [candidates.firstObject isEqualToData:vaultId] &&
           ![candidates.firstObject isKindOfClass:NSMutableData.class]);
    assert([index clearPendingVaultId:vaultId] ==
               AncPrivateVaultHostedAppendCandidateStatusOK &&
           [index pendingHostedAppendVaultIds:&candidates] ==
               AncPrivateVaultHostedAppendCandidateStatusOK &&
           candidates.count == 0);
    NSMutableData *mutable = [vaultId mutableCopy];
    assert([index markPendingVaultId:mutable] ==
           AncPrivateVaultHostedAppendCandidateStatusInvalid);
    assert([NSFileManager.defaultManager removeItemAtURL:root error:nil]);
    puts("hosted append candidate index tests passed");
  }
  return 0;
}
