#import <Foundation/Foundation.h>

#include <assert.h>
#include <sys/stat.h>
#include <unistd.h>

#import "PrivateVaultStateRoot.h"

static NSURL *TemporaryDirectory(void) {
  NSString *path =
      [NSHomeDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
  assert([[NSFileManager defaultManager]
            createDirectoryAtPath:path
      withIntermediateDirectories:NO
                       attributes:@{
                         NSFilePosixPermissions : @0700
                       }
                            error:nil]);
  return [NSURL fileURLWithPath:path isDirectory:YES];
}

static void Remove(NSURL *url) {
  [[NSFileManager defaultManager] removeItemAtURL:url error:nil];
}

int main(void) {
  @autoreleasepool {
    NSURL *base = TemporaryDirectory();
    NSURL *root = AncPrivateVaultPrepareStateRoot(base);
    assert(root != nil);
    struct stat state;
    assert(lstat(root.fileSystemRepresentation, &state) == 0);
    assert(S_ISDIR(state.st_mode) && !S_ISLNK(state.st_mode));
    assert(state.st_uid == getuid() && (state.st_mode & 0777) == 0700);
    struct stat first = state;
    assert([AncPrivateVaultPrepareStateRoot(base) isEqual:root]);
    assert(lstat(root.fileSystemRepresentation, &state) == 0);
    assert(first.st_dev == state.st_dev && first.st_ino == state.st_ino);
    NSURL *recoveryRoot = AncPrivateVaultPrepareRecoveryStateRoot(root);
    assert(recoveryRoot != nil &&
           [AncPrivateVaultPrepareRecoveryStateRoot(root)
               isEqual:recoveryRoot]);
    assert(lstat(recoveryRoot.fileSystemRepresentation, &state) == 0);
    assert(S_ISDIR(state.st_mode) && !S_ISLNK(state.st_mode) &&
           state.st_uid == getuid() && (state.st_mode & 0777) == 0700);
    NSURL *brokerRoot = AncPrivateVaultPrepareBrokerStateRoot(root);
    assert(brokerRoot != nil && ![brokerRoot isEqual:recoveryRoot] &&
           [AncPrivateVaultPrepareBrokerStateRoot(root) isEqual:brokerRoot]);
    assert(lstat(brokerRoot.fileSystemRepresentation, &state) == 0);
    assert(S_ISDIR(state.st_mode) && !S_ISLNK(state.st_mode) &&
           state.st_uid == getuid() && (state.st_mode & 0777) == 0700);
    Remove(base);

    NSURL *missing =
        [TemporaryDirectory() URLByAppendingPathComponent:@"missing"
                                              isDirectory:YES];
    NSURL *missingParent = [missing URLByDeletingLastPathComponent];
    assert(AncPrivateVaultPrepareStateRoot(missing) == nil);
    Remove(missingParent);

    NSURL *symlinkBase = TemporaryDirectory();
    NSURL *real = [symlinkBase URLByAppendingPathComponent:@"real"
                                               isDirectory:YES];
    assert([[NSFileManager defaultManager]
               createDirectoryAtURL:real
        withIntermediateDirectories:NO
                         attributes:@{
                           NSFilePosixPermissions : @0700
                         }
                              error:nil]);
    NSURL *alias = [symlinkBase URLByAppendingPathComponent:@"alias"];
    assert(symlink(real.path.fileSystemRepresentation,
                   alias.path.fileSystemRepresentation) == 0);
    assert(AncPrivateVaultPrepareStateRoot(alias) == nil);
    Remove(symlinkBase);

    NSURL *childBase = TemporaryDirectory();
    NSURL *outside = TemporaryDirectory();
    NSURL *agentNative = [childBase URLByAppendingPathComponent:@"AgentNative"];
    assert(symlink(outside.path.fileSystemRepresentation,
                   agentNative.path.fileSystemRepresentation) == 0);
    assert(AncPrivateVaultPrepareStateRoot(childBase) == nil);
    Remove(childBase);
    Remove(outside);

    NSURL *modeBase = TemporaryDirectory();
    NSURL *modeRoot = AncPrivateVaultPrepareStateRoot(modeBase);
    assert(modeRoot != nil &&
           chmod(modeRoot.fileSystemRepresentation, 0755) == 0);
    assert(AncPrivateVaultPrepareStateRoot(modeBase) != nil);
    assert(lstat(modeRoot.fileSystemRepresentation, &state) == 0);
    assert((state.st_mode & 0777) == 0700);
    Remove(modeBase);

    puts("state root tests passed");
  }
  return 0;
}
