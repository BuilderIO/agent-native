#import <Foundation/Foundation.h>

#import "PrivateVaultHostedAppendRetryStore.h"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#define CHECK(value)                                                           \
  do {                                                                         \
    if (!(value)) {                                                            \
      fprintf(stderr, "CHECK failed at %s:%d: %s\n", __FILE__, __LINE__,       \
              #value);                                                         \
      return 1;                                                                \
    }                                                                          \
  } while (0)

static NSURL *TemporaryRoot(void) {
  NSString *path = [NSTemporaryDirectory()
      stringByAppendingPathComponent:
          [@"anc-hosted-retry-"
              stringByAppendingString:NSUUID.UUID.UUIDString]];
  BOOL created = [[NSFileManager defaultManager]
            createDirectoryAtPath:path
      withIntermediateDirectories:NO
                       attributes:@{
                         NSFilePosixPermissions : @0700
                       }
                            error:nil];
  return created ? [NSURL fileURLWithPath:path isDirectory:YES] : nil;
}

static void RemoveRoot(NSURL *root) {
  [[NSFileManager defaultManager] removeItemAtURL:root error:nil];
}

static void FillVault(uint8_t vault[16], uint16_t value) {
  memset(vault, 0, 16);
  vault[0] = (uint8_t)(value >> 8);
  vault[1] = (uint8_t)value;
  for (size_t index = 2; index < 16; index += 1)
    vault[index] = (uint8_t)(value + index);
}

static NSString *MarkerName(const uint8_t vault[16]) {
  NSMutableString *name = [NSMutableString stringWithCapacity:53];
  for (size_t index = 0; index < 16; index += 1)
    [name appendFormat:@"%02x", vault[index]];
  [name appendString:@".hosted-append-retry"];
  return name;
}

static NSURL *RetryDirectory(NSURL *root) {
  return [[[root URLByAppendingPathComponent:@"state" isDirectory:YES]
      URLByAppendingPathComponent:@"hosted-append-retry"
                      isDirectory:YES] copy];
}

static NSURL *MarkerURL(NSURL *root, const uint8_t vault[16]) {
  return [RetryDirectory(root) URLByAppendingPathComponent:MarkerName(vault)];
}

static BOOL WriteExactFile(NSURL *url, const uint8_t *bytes, size_t length,
                           mode_t mode) {
  int fd = open(url.fileSystemRepresentation,
                O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, mode);
  if (fd < 0)
    return NO;
  size_t offset = 0;
  while (offset < length) {
    ssize_t amount = write(fd, bytes + offset, length - offset);
    if (amount <= 0)
      break;
    offset += (size_t)amount;
  }
  return offset == length && fsync(fd) == 0 && close(fd) == 0;
}

static int TestBasicIdempotenceRestartAndImmutability(void) {
  NSURL *root = TemporaryRoot();
  CHECK(root != nil);
  uint8_t first[16], second[16];
  FillVault(first, 1);
  FillVault(second, 2);
  AncPrivateVaultHostedAppendRetryStore *store =
      [[AncPrivateVaultHostedAppendRetryStore alloc] initWithStateRootURL:root];
  CHECK([store addVaultId:first] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  CHECK([store addVaultId:first] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  CHECK([store addVaultId:second] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  NSArray<NSData *> *listed = nil;
  CHECK([store listVaultIds:&listed] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  CHECK(listed.count == 2);
  CHECK([listed containsObject:[NSData dataWithBytes:first length:16]]);
  CHECK([listed containsObject:[NSData dataWithBytes:second length:16]]);
  for (NSData *candidate in listed) {
    CHECK(candidate.length == 16);
    CHECK(![candidate respondsToSelector:@selector(mutableBytes)]);
  }
  AncPrivateVaultHostedAppendRetryStore *restarted =
      [[AncPrivateVaultHostedAppendRetryStore alloc] initWithStateRootURL:root];
  listed = nil;
  CHECK([restarted listVaultIds:&listed] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  CHECK(listed.count == 2);
  CHECK([restarted removeVaultId:first] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  CHECK([restarted removeVaultId:first] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  listed = nil;
  CHECK([restarted listVaultIds:&listed] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  CHECK(listed.count == 1 &&
        [listed.firstObject isEqualToData:[NSData dataWithBytes:second
                                                         length:16]]);
  RemoveRoot(root);
  return 0;
}

static int TestUnsafeEntryRejection(void) {
  uint8_t vault[16];
  FillVault(vault, 9);

  NSURL *modeRoot = TemporaryRoot();
  AncPrivateVaultHostedAppendRetryStore *modeStore =
      [[AncPrivateVaultHostedAppendRetryStore alloc]
          initWithStateRootURL:modeRoot];
  CHECK([modeStore addVaultId:vault] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  CHECK(chmod(MarkerURL(modeRoot, vault).fileSystemRepresentation, 0644) == 0);
  NSArray *listed = nil;
  CHECK([modeStore listVaultIds:&listed] !=
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  RemoveRoot(modeRoot);

  NSURL *hardRoot = TemporaryRoot();
  AncPrivateVaultHostedAppendRetryStore *hardStore =
      [[AncPrivateVaultHostedAppendRetryStore alloc]
          initWithStateRootURL:hardRoot];
  CHECK([hardStore addVaultId:vault] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  NSURL *hardAlias = [hardRoot URLByAppendingPathComponent:@"outside-link"];
  CHECK(link(MarkerURL(hardRoot, vault).fileSystemRepresentation,
             hardAlias.fileSystemRepresentation) == 0);
  listed = nil;
  CHECK([hardStore listVaultIds:&listed] !=
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  RemoveRoot(hardRoot);

  NSURL *symlinkRoot = TemporaryRoot();
  AncPrivateVaultHostedAppendRetryStore *symlinkStore =
      [[AncPrivateVaultHostedAppendRetryStore alloc]
          initWithStateRootURL:symlinkRoot];
  listed = nil;
  CHECK([symlinkStore listVaultIds:&listed] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  NSURL *outside = TemporaryRoot();
  uint8_t zeros[60] = {0};
  NSURL *outsideFile = [outside URLByAppendingPathComponent:@"marker"];
  CHECK(WriteExactFile(outsideFile, zeros, sizeof zeros, 0600));
  CHECK(symlink(outsideFile.fileSystemRepresentation,
                MarkerURL(symlinkRoot, vault).fileSystemRepresentation) == 0);
  CHECK([symlinkStore listVaultIds:&listed] !=
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  RemoveRoot(symlinkRoot);
  RemoveRoot(outside);

  NSURL *unknownRoot = TemporaryRoot();
  AncPrivateVaultHostedAppendRetryStore *unknownStore =
      [[AncPrivateVaultHostedAppendRetryStore alloc]
          initWithStateRootURL:unknownRoot];
  CHECK([unknownStore listVaultIds:&listed] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  NSURL *unknown =
      [RetryDirectory(unknownRoot) URLByAppendingPathComponent:@"surprise.txt"];
  CHECK(WriteExactFile(unknown, zeros, sizeof zeros, 0600));
  CHECK([unknownStore listVaultIds:&listed] !=
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  RemoveRoot(unknownRoot);
  return 0;
}

static int TestAtomicFaultRecoveryAndReadback(void) {
  NSURL *root = TemporaryRoot();
  uint8_t vault[16];
  FillVault(vault, 31);
  AncPrivateVaultHostedAppendRetryStore *store =
      [[AncPrivateVaultHostedAppendRetryStore alloc] initWithStateRootURL:root];
  AncPrivateVaultHostedAppendRetryStoreSetFaultHookForTesting(
      ^BOOL(AncPrivateVaultHostedAppendRetryStoreFaultPoint point) {
        return point ==
               AncPrivateVaultHostedAppendRetryStoreFaultAfterTemporaryFsync;
      });
  CHECK([store addVaultId:vault] ==
        AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed);
  AncPrivateVaultHostedAppendRetryStoreSetFaultHookForTesting(nil);
  AncPrivateVaultHostedAppendRetryStore *restarted =
      [[AncPrivateVaultHostedAppendRetryStore alloc] initWithStateRootURL:root];
  NSArray *listed = nil;
  CHECK([restarted listVaultIds:&listed] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  CHECK(listed.count == 0);
  RemoveRoot(root);

  NSURL *renameRoot = TemporaryRoot();
  uint8_t renameVault[16];
  FillVault(renameVault, 33);
  AncPrivateVaultHostedAppendRetryStore *renameStore =
      [[AncPrivateVaultHostedAppendRetryStore alloc]
          initWithStateRootURL:renameRoot];
  AncPrivateVaultHostedAppendRetryStoreSetFaultHookForTesting(^BOOL(
      AncPrivateVaultHostedAppendRetryStoreFaultPoint point) {
    return point ==
           AncPrivateVaultHostedAppendRetryStoreFaultAfterRenameBeforeReadback;
  });
  CHECK([renameStore addVaultId:renameVault] ==
        AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed);
  AncPrivateVaultHostedAppendRetryStoreSetFaultHookForTesting(nil);
  AncPrivateVaultHostedAppendRetryStore *renameRestarted =
      [[AncPrivateVaultHostedAppendRetryStore alloc]
          initWithStateRootURL:renameRoot];
  listed = nil;
  CHECK([renameRestarted listVaultIds:&listed] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  CHECK(listed.count == 1);
  AncPrivateVaultHostedAppendRetryStoreSetFaultHookForTesting(^BOOL(
      AncPrivateVaultHostedAppendRetryStoreFaultPoint point) {
    return point == AncPrivateVaultHostedAppendRetryStoreFaultAfterRemoveRename;
  });
  CHECK([renameRestarted removeVaultId:renameVault] ==
        AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed);
  AncPrivateVaultHostedAppendRetryStoreSetFaultHookForTesting(nil);
  AncPrivateVaultHostedAppendRetryStore *removeRestarted =
      [[AncPrivateVaultHostedAppendRetryStore alloc]
          initWithStateRootURL:renameRoot];
  listed = nil;
  CHECK([removeRestarted listVaultIds:&listed] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  CHECK(listed.count == 0);
  RemoveRoot(renameRoot);

  NSURL *substitutionRoot = TemporaryRoot();
  uint8_t substitutionVault[16];
  FillVault(substitutionVault, 32);
  NSData *substitutionVaultData =
      [NSData dataWithBytes:substitutionVault length:sizeof substitutionVault];
  AncPrivateVaultHostedAppendRetryStore *substitutionStore =
      [[AncPrivateVaultHostedAppendRetryStore alloc]
          initWithStateRootURL:substitutionRoot];
  __block BOOL changed = NO;
  AncPrivateVaultHostedAppendRetryStoreSetFaultHookForTesting(^BOOL(
      AncPrivateVaultHostedAppendRetryStoreFaultPoint point) {
    if (point ==
        AncPrivateVaultHostedAppendRetryStoreFaultAfterRenameBeforeReadback) {
      uint8_t zeros[60] = {0};
      changed = WriteExactFile(
          MarkerURL(substitutionRoot, substitutionVaultData.bytes), zeros,
          sizeof zeros, 0600);
    }
    return NO;
  });
  CHECK([substitutionStore addVaultId:substitutionVault] ==
        AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed);
  CHECK(changed);
  AncPrivateVaultHostedAppendRetryStoreSetFaultHookForTesting(nil);
  listed = nil;
  CHECK([substitutionStore listVaultIds:&listed] !=
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  RemoveRoot(substitutionRoot);

  NSURL *partialRoot = TemporaryRoot();
  AncPrivateVaultHostedAppendRetryStore *partialStore =
      [[AncPrivateVaultHostedAppendRetryStore alloc]
          initWithStateRootURL:partialRoot];
  listed = nil;
  CHECK([partialStore listVaultIds:&listed] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  NSString *partialName = [NSString
      stringWithFormat:@".%@.%@.tmp", [MarkerName(vault) substringToIndex:32],
                       NSUUID.UUID.UUIDString.lowercaseString];
  NSURL *partialURL =
      [RetryDirectory(partialRoot) URLByAppendingPathComponent:partialName];
  uint8_t partialBytes[17] = {0};
  CHECK(WriteExactFile(partialURL, partialBytes, sizeof partialBytes, 0600));
  AncPrivateVaultHostedAppendRetryStore *partialRestarted =
      [[AncPrivateVaultHostedAppendRetryStore alloc]
          initWithStateRootURL:partialRoot];
  listed = nil;
  CHECK([partialRestarted listVaultIds:&listed] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  CHECK(listed.count == 0 &&
        ![NSFileManager.defaultManager fileExistsAtPath:partialURL.path]);
  RemoveRoot(partialRoot);
  return 0;
}

static int TestEnumerationCap(void) {
  NSURL *root = TemporaryRoot();
  AncPrivateVaultHostedAppendRetryStore *store =
      [[AncPrivateVaultHostedAppendRetryStore alloc] initWithStateRootURL:root];
  for (uint16_t index = 0; index < ANC_PV_HOSTED_APPEND_RETRY_MAX_CANDIDATES;
       index += 1) {
    uint8_t vault[16];
    FillVault(vault, (uint16_t)(1000 + index));
    CHECK([store addVaultId:vault] ==
          AncPrivateVaultHostedAppendRetryStoreStatusOK);
  }
  uint8_t overflow[16];
  FillVault(overflow,
            (uint16_t)(1000 + ANC_PV_HOSTED_APPEND_RETRY_MAX_CANDIDATES));
  CHECK([store addVaultId:overflow] ==
        AncPrivateVaultHostedAppendRetryStoreStatusCorrupt);
  NSArray *listed = nil;
  CHECK([store listVaultIds:&listed] ==
        AncPrivateVaultHostedAppendRetryStoreStatusOK);
  CHECK(listed.count == ANC_PV_HOSTED_APPEND_RETRY_MAX_CANDIDATES);
  RemoveRoot(root);
  return 0;
}

int main(void) {
  @autoreleasepool {
    CHECK(TestBasicIdempotenceRestartAndImmutability() == 0);
    CHECK(TestUnsafeEntryRejection() == 0);
    CHECK(TestAtomicFaultRecoveryAndReadback() == 0);
    CHECK(TestEnumerationCap() == 0);
    puts("hosted append retry store tests passed");
  }
  return 0;
}
