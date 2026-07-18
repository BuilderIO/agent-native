#import "PrivateVaultStateRoot.h"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static BOOL AncPrivateVaultValidateAncestor(int fd, uid_t userID,
                                            BOOL requireUserOwner,
                                            dev_t expectedDevice) {
  struct stat state;
  if (fd < 0 || fstat(fd, &state) != 0 || !S_ISDIR(state.st_mode) ||
      (requireUserOwner ? state.st_uid != userID
                        : state.st_uid != 0 && state.st_uid != userID) ||
      (state.st_mode & 0022) != 0 ||
      (expectedDevice != 0 && state.st_dev != expectedDevice)) {
    return NO;
  }
  return YES;
}

static int AncPrivateVaultOpenExistingPath(NSString *path, uid_t userID,
                                           dev_t *device) {
  if (path.length == 0 || !path.isAbsolutePath ||
      ![path.stringByStandardizingPath isEqualToString:path]) {
    return -1;
  }

  int current = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (!AncPrivateVaultValidateAncestor(current, userID, NO, 0)) {
    if (current >= 0)
      close(current);
    return -1;
  }

  NSArray<NSString *> *components = path.pathComponents;
  for (NSUInteger index = 1; index < components.count; index += 1) {
    NSString *component = components[index];
    if (component.length == 0 || [component isEqualToString:@"."] ||
        [component isEqualToString:@".."] || [component containsString:@"/"]) {
      close(current);
      return -1;
    }
    int next = openat(current, component.fileSystemRepresentation,
                      O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    close(current);
    current = next;
    BOOL finalComponent = index + 1 == components.count;
    if (!AncPrivateVaultValidateAncestor(current, userID, finalComponent, 0)) {
      if (current >= 0)
        close(current);
      return -1;
    }
  }

  struct stat base;
  if (fstat(current, &base) != 0) {
    close(current);
    return -1;
  }
  if (device != NULL)
    *device = base.st_dev;
  return current;
}

static int AncPrivateVaultOpenOrCreatePrivateDirectory(
    int parent, const char *name, uid_t userID, dev_t device, BOOL exactMode) {
  int directory =
      openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (directory < 0 && errno == ENOENT) {
    if (mkdirat(parent, name, 0700) != 0 || fsync(parent) != 0)
      return -1;
    directory =
        openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  }
  if (!AncPrivateVaultValidateAncestor(directory, userID, YES, device)) {
    if (directory >= 0)
      close(directory);
    return -1;
  }

  struct stat state;
  if (fstat(directory, &state) != 0 ||
      (exactMode && (state.st_mode & 0777) != 0700)) {
    if (!exactMode || fchmod(directory, 0700) != 0 ||
        fstat(directory, &state) != 0 || (state.st_mode & 0777) != 0700) {
      close(directory);
      return -1;
    }
  }
  return directory;
}

NSURL *AncPrivateVaultPrepareStateRoot(NSURL *applicationSupportURL) {
  if (applicationSupportURL == nil || !applicationSupportURL.isFileURL)
    return nil;

  uid_t userID = getuid();
  dev_t device = 0;
  int applicationSupport = AncPrivateVaultOpenExistingPath(
      applicationSupportURL.path, userID, &device);
  if (applicationSupport < 0)
    return nil;

  int agentNative = AncPrivateVaultOpenOrCreatePrivateDirectory(
      applicationSupport, "AgentNative", userID, device, NO);
  close(applicationSupport);
  if (agentNative < 0)
    return nil;

  int privateVault = AncPrivateVaultOpenOrCreatePrivateDirectory(
      agentNative, "PrivateVault", userID, device, YES);
  close(agentNative);
  if (privateVault < 0)
    return nil;

  struct stat pinned;
  BOOL valid = fstat(privateVault, &pinned) == 0 && S_ISDIR(pinned.st_mode) &&
               pinned.st_uid == userID && pinned.st_dev == device &&
               (pinned.st_mode & 0777) == 0700;
  close(privateVault);
  if (!valid)
    return nil;

  return [[applicationSupportURL URLByAppendingPathComponent:@"AgentNative"
                                                 isDirectory:YES]
      URLByAppendingPathComponent:@"PrivateVault"
                      isDirectory:YES];
}

NSURL *AncPrivateVaultPrepareRecoveryStateRoot(NSURL *stateRootURL) {
  if (stateRootURL == nil || !stateRootURL.isFileURL)
    return nil;
  uid_t userID = getuid();
  dev_t device = 0;
  int stateRoot = AncPrivateVaultOpenExistingPath(stateRootURL.path, userID,
                                                  &device);
  if (stateRoot < 0)
    return nil;
  int recovery = AncPrivateVaultOpenOrCreatePrivateDirectory(
      stateRoot, "Recovery", userID, device, YES);
  close(stateRoot);
  if (recovery < 0)
    return nil;
  struct stat pinned;
  BOOL valid = fstat(recovery, &pinned) == 0 && S_ISDIR(pinned.st_mode) &&
               pinned.st_uid == userID && pinned.st_dev == device &&
               (pinned.st_mode & 0777) == 0700;
  close(recovery);
  return valid ? [stateRootURL URLByAppendingPathComponent:@"Recovery"
                                                isDirectory:YES]
               : nil;
}
