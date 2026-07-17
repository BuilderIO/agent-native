#import "PrivateVaultHostedAppendRetryStore.h"

#import "PrivateVaultCrypto.h"

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static const uint8_t kAncRetryMagic[8] = {'A', 'N', 'P', 'V',
                                          'H', 'A', 'R', '1'};
static const uint8_t kAncRetryVersion = 1;
static const uint8_t kAncRetryChecksumDomain[] =
    "agent-native/private-vault/hosted-append-retry-marker/anc-v1";
enum {
  kAncRetryBodyBytes = 8 + 1 + 1 + 2 + 16,
  kAncRetryRecordBytes = 8 + 1 + 1 + 2 + 16 + 32,
};
static NSString *const kAncRetrySuffix = @".hosted-append-retry";

@interface AncPrivateVaultHostedAppendRetryStore ()
@property(nonatomic, copy) NSURL *stateRootURL;
@property(nonatomic) dispatch_queue_t queue;
@property(nonatomic) BOOL rootPinned;
@property(nonatomic) dev_t rootDevice;
@property(nonatomic) ino_t rootInode;
@property(nonatomic) uid_t rootOwner;
@property(nonatomic) BOOL statePinned;
@property(nonatomic) dev_t stateDevice;
@property(nonatomic) ino_t stateInode;
@property(nonatomic) uid_t stateOwner;
@property(nonatomic) BOOL directoryPinned;
@property(nonatomic) dev_t directoryDevice;
@property(nonatomic) ino_t directoryInode;
@property(nonatomic) uid_t directoryOwner;
@end

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultHostedAppendRetryStoreFaultHook gAncRetryFaultHook;
void AncPrivateVaultHostedAppendRetryStoreSetFaultHookForTesting(
    AncPrivateVaultHostedAppendRetryStoreFaultHook hook) {
  gAncRetryFaultHook = [hook copy];
}
#endif

static BOOL
AncRetryFault(AncPrivateVaultHostedAppendRetryStoreFaultPoint point) {
#if ANC_PRIVATE_VAULT_TESTING
  return gAncRetryFaultHook != nil && gAncRetryFaultHook(point);
#else
  (void)point;
  return NO;
#endif
}

static dispatch_queue_t AncRetryQueue(void) {
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create(
        "com.agentnative.private-vault.hosted-append-retry-store",
        DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

static BOOL AncRetryHexDigit(unichar value, uint8_t *nibble) {
  if (value >= '0' && value <= '9')
    *nibble = (uint8_t)(value - '0');
  else if (value >= 'a' && value <= 'f')
    *nibble = (uint8_t)(value - 'a' + 10);
  else
    return NO;
  return YES;
}

static BOOL AncRetryDigest(const uint8_t *body, size_t bodyLength,
                           uint8_t digest[32]) {
  if (body == NULL || bodyLength != kAncRetryBodyBytes || digest == NULL)
    return NO;
  NSMutableData *input =
      [NSMutableData dataWithBytes:kAncRetryChecksumDomain
                            length:sizeof kAncRetryChecksumDomain];
  [input appendBytes:body length:bodyLength];
  return anc_pv_blake2b_256(digest, input.bytes, input.length) ==
         ANC_PV_CRYPTO_OK;
}

static NSData *AncRetryEncode(const uint8_t vaultId[16]) {
  if (vaultId == NULL)
    return nil;
  uint8_t record[kAncRetryRecordBytes] = {0};
  memcpy(record, kAncRetryMagic, sizeof kAncRetryMagic);
  record[8] = kAncRetryVersion;
  memcpy(record + 12, vaultId, 16);
  uint8_t checksum[32] = {0};
  if (!AncRetryDigest(record, kAncRetryBodyBytes, checksum))
    return nil;
  memcpy(record + kAncRetryBodyBytes, checksum, sizeof checksum);
  NSData *result = [NSData dataWithBytes:record length:sizeof record];
  anc_pv_zeroize(checksum, sizeof checksum);
  anc_pv_zeroize(record, sizeof record);
  return result;
}

static BOOL AncRetryDecode(NSData *record, const uint8_t *expectedVaultId,
                           uint8_t decodedVaultId[16]) {
  if (![record isKindOfClass:NSData.class] ||
      record.length != kAncRetryRecordBytes)
    return NO;
  const uint8_t *bytes = record.bytes;
  if (memcmp(bytes, kAncRetryMagic, sizeof kAncRetryMagic) != 0 ||
      bytes[8] != kAncRetryVersion || bytes[9] != 0 || bytes[10] != 0 ||
      bytes[11] != 0)
    return NO;
  uint8_t checksum[32] = {0};
  BOOL valid =
      AncRetryDigest(bytes, kAncRetryBodyBytes, checksum) &&
      anc_pv_memcmp(checksum, bytes + kAncRetryBodyBytes, 32) ==
          ANC_PV_CRYPTO_OK &&
      (expectedVaultId == NULL ||
       anc_pv_memcmp(expectedVaultId, bytes + 12, 16) == ANC_PV_CRYPTO_OK);
  if (valid && decodedVaultId != NULL)
    memcpy(decodedVaultId, bytes + 12, 16);
  anc_pv_zeroize(checksum, sizeof checksum);
  return valid;
}

static BOOL AncRetryFileSafe(int directoryFD, const char *name,
                             struct stat *state) {
  struct stat local;
  if (directoryFD < 0 || name == NULL ||
      fstatat(directoryFD, name, &local, AT_SYMLINK_NOFOLLOW) != 0 ||
      !S_ISREG(local.st_mode) || local.st_uid != getuid() ||
      local.st_nlink != 1 || (local.st_mode & 0777) != 0600 ||
      local.st_size != (off_t)kAncRetryRecordBytes)
    return NO;
  if (state != NULL)
    *state = local;
  return YES;
}

@implementation AncPrivateVaultHostedAppendRetryStore

- (instancetype)initWithStateRootURL:(NSURL *)stateRootURL {
  self = [super init];
  if (self == nil || stateRootURL == nil || !stateRootURL.isFileURL)
    return nil;
  _stateRootURL = [stateRootURL copy];
  _queue = AncRetryQueue();
  return self;
}

- (NSString *)nameForVaultId:(const uint8_t[16])vaultId {
  if (vaultId == NULL)
    return nil;
  NSMutableString *name =
      [NSMutableString stringWithCapacity:32 + kAncRetrySuffix.length];
  for (size_t index = 0; index < 16; index += 1)
    [name appendFormat:@"%02x", vaultId[index]];
  [name appendString:kAncRetrySuffix];
  return name;
}

- (BOOL)parseName:(NSString *)name vaultId:(uint8_t[16])vaultId {
  if (name == nil || name.length != 32 + kAncRetrySuffix.length ||
      ![name hasSuffix:kAncRetrySuffix])
    return NO;
  for (NSUInteger index = 0; index < 16; index += 1) {
    uint8_t high = 0, low = 0;
    if (!AncRetryHexDigit([name characterAtIndex:index * 2], &high) ||
        !AncRetryHexDigit([name characterAtIndex:index * 2 + 1], &low))
      return NO;
    vaultId[index] = (uint8_t)((high << 4) | low);
  }
  return YES;
}

- (BOOL)validateAndPinDirectory:(int)fd
                         pinned:(BOOL *)pinned
                         device:(dev_t *)device
                          inode:(ino_t *)inode
                          owner:(uid_t *)owner
                 expectedDevice:(dev_t)expectedDevice {
  struct stat state;
  if (fd < 0 || fstat(fd, &state) != 0 || !S_ISDIR(state.st_mode) ||
      state.st_uid != getuid() || (state.st_mode & 0777) != 0700 ||
      (expectedDevice != 0 && state.st_dev != expectedDevice))
    return NO;
  if (!*pinned) {
    *pinned = YES;
    *device = state.st_dev;
    *inode = state.st_ino;
    *owner = state.st_uid;
    return YES;
  }
  return *device == state.st_dev && *inode == state.st_ino &&
         *owner == state.st_uid;
}

- (BOOL)prepareDirectory {
  NSString *path = self.stateRootURL.path;
  if (path.length == 0 || !path.isAbsolutePath ||
      ![path.stringByStandardizingPath isEqualToString:path])
    return NO;
  struct stat pathState;
  if (lstat(path.fileSystemRepresentation, &pathState) != 0 ||
      !S_ISDIR(pathState.st_mode) || pathState.st_uid != getuid() ||
      (pathState.st_mode & 0777) != 0700)
    return NO;
  int root = open(path.fileSystemRepresentation,
                  O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct stat openedRoot;
  if (root < 0 || fstat(root, &openedRoot) != 0 ||
      openedRoot.st_dev != pathState.st_dev ||
      openedRoot.st_ino != pathState.st_ino ||
      openedRoot.st_uid != pathState.st_uid ||
      ![self validateAndPinDirectory:root
                              pinned:&_rootPinned
                              device:&_rootDevice
                               inode:&_rootInode
                               owner:&_rootOwner
                      expectedDevice:0]) {
    if (root >= 0)
      close(root);
    return NO;
  }
  int state =
      openat(root, "state", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (state < 0 && errno == ENOENT) {
    if (mkdirat(root, "state", 0700) != 0 || fsync(root) != 0) {
      close(root);
      return NO;
    }
    state =
        openat(root, "state", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  }
  if (![self validateAndPinDirectory:state
                              pinned:&_statePinned
                              device:&_stateDevice
                               inode:&_stateInode
                               owner:&_stateOwner
                      expectedDevice:self.rootDevice]) {
    if (state >= 0)
      close(state);
    close(root);
    return NO;
  }
  int directory = openat(state, "hosted-append-retry",
                         O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (directory < 0 && errno == ENOENT) {
    if (mkdirat(state, "hosted-append-retry", 0700) != 0 || fsync(state) != 0) {
      close(state);
      close(root);
      return NO;
    }
    directory = openat(state, "hosted-append-retry",
                       O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  }
  if (![self validateAndPinDirectory:directory
                              pinned:&_directoryPinned
                              device:&_directoryDevice
                               inode:&_directoryInode
                               owner:&_directoryOwner
                      expectedDevice:self.stateDevice]) {
    if (directory >= 0)
      close(directory);
    close(state);
    close(root);
    return NO;
  }
  BOOL stateClosed = close(state) == 0;
  BOOL rootClosed = close(root) == 0;
  BOOL parentClosed = stateClosed && rootClosed;
  if (!parentClosed) {
    close(directory);
    return NO;
  }

  int listingFD = dup(directory);
  DIR *listing = listingFD < 0 ? NULL : fdopendir(listingFD);
  if (listing == NULL ||
      AncRetryFault(
          AncPrivateVaultHostedAppendRetryStoreFaultDirectoryListing)) {
    if (listing != NULL)
      closedir(listing);
    else if (listingFD >= 0)
      close(listingFD);
    close(directory);
    return NO;
  }
  NSRegularExpression *temporary = [NSRegularExpression
      regularExpressionWithPattern:@"^\\.[0-9a-f]{32}\\.[0-9a-f-]{36}\\.tmp$"
                           options:0
                             error:nil];
  BOOL okay = YES;
  errno = 0;
  struct dirent *entry;
  while (okay && (entry = readdir(listing)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0)
      continue;
    NSString *name = [NSString stringWithUTF8String:entry->d_name];
    uint8_t vaultId[16] = {0};
    if (name != nil && [self parseName:name vaultId:vaultId]) {
      okay = AncRetryFileSafe(directory, entry->d_name, NULL);
    } else if (name != nil &&
               [temporary
                   firstMatchInString:name
                              options:0
                                range:NSMakeRange(0, name.length)] != nil) {
      struct stat temporaryState;
      okay =
          fstatat(directory, entry->d_name, &temporaryState,
                  AT_SYMLINK_NOFOLLOW) == 0 &&
          S_ISREG(temporaryState.st_mode) &&
          temporaryState.st_uid == getuid() && temporaryState.st_nlink == 1 &&
          (temporaryState.st_mode & 0777) == 0600 &&
          temporaryState.st_size >= 0 &&
          temporaryState.st_size <= (off_t)kAncRetryRecordBytes &&
          unlinkat(directory, entry->d_name, 0) == 0 && fsync(directory) == 0;
    } else {
      okay = NO;
    }
    anc_pv_zeroize(vaultId, sizeof vaultId);
  }
  okay = okay && errno == 0 && closedir(listing) == 0 && close(directory) == 0;
  return okay;
}

- (int)openValidatedDirectory {
  if (AncRetryFault(
          AncPrivateVaultHostedAppendRetryStoreFaultBeforeDirectoryReopen))
    return -1;
  int root = open(self.stateRootURL.fileSystemRepresentation,
                  O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct stat rootState;
  if (root < 0 || fstat(root, &rootState) != 0 || !self.rootPinned ||
      rootState.st_dev != self.rootDevice ||
      rootState.st_ino != self.rootInode ||
      rootState.st_uid != self.rootOwner || !S_ISDIR(rootState.st_mode) ||
      (rootState.st_mode & 0777) != 0700) {
    if (root >= 0)
      close(root);
    return -1;
  }
  int state =
      openat(root, "state", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct stat stateState;
  if (state < 0 || fstat(state, &stateState) != 0 || !self.statePinned ||
      stateState.st_dev != self.stateDevice ||
      stateState.st_ino != self.stateInode ||
      stateState.st_uid != self.stateOwner || !S_ISDIR(stateState.st_mode) ||
      (stateState.st_mode & 0777) != 0700) {
    if (state >= 0)
      close(state);
    close(root);
    return -1;
  }
  int directory = openat(state, "hosted-append-retry",
                         O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct stat directoryState;
  BOOL valid = directory >= 0 && fstat(directory, &directoryState) == 0 &&
               self.directoryPinned &&
               directoryState.st_dev == self.directoryDevice &&
               directoryState.st_ino == self.directoryInode &&
               directoryState.st_uid == self.directoryOwner &&
               S_ISDIR(directoryState.st_mode) &&
               (directoryState.st_mode & 0777) == 0700;
  BOOL stateClosed = close(state) == 0;
  BOOL rootClosed = close(root) == 0;
  BOOL parentsClosed = stateClosed && rootClosed;
  if (!valid || !parentsClosed) {
    if (directory >= 0)
      close(directory);
    return -1;
  }
  return directory;
}

- (BOOL)markerCountInDirectory:(int)directory count:(NSUInteger *)count {
  if (directory < 0 || count == NULL)
    return NO;
  *count = 0;
  int listingFD = dup(directory);
  DIR *listing = listingFD < 0 ? NULL : fdopendir(listingFD);
  if (listing == NULL) {
    if (listingFD >= 0)
      close(listingFD);
    return NO;
  }
  BOOL okay = YES;
  struct dirent *entry;
  while (okay) {
    errno = 0;
    entry = readdir(listing);
    if (entry == NULL) {
      okay = errno == 0;
      break;
    }
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0)
      continue;
    NSString *name = [NSString stringWithUTF8String:entry->d_name];
    uint8_t candidate[16] = {0};
    if (name != nil && [self parseName:name vaultId:candidate]) {
      *count += 1;
      if (*count > ANC_PV_HOSTED_APPEND_RETRY_MAX_CANDIDATES)
        okay = NO;
    }
    anc_pv_zeroize(candidate, sizeof candidate);
  }
  return closedir(listing) == 0 && okay;
}

- (NSData *)readName:(NSString *)name
             missing:(BOOL *)missing
               state:(struct stat *)fileState {
  if (missing != NULL)
    *missing = NO;
  int directory = [self openValidatedDirectory];
  if (directory < 0)
    return nil;
  int fd = openat(directory, name.fileSystemRepresentation,
                  O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) {
    if (missing != NULL && errno == ENOENT)
      *missing = YES;
    close(directory);
    return nil;
  }
  struct stat state;
  if (fstat(fd, &state) != 0 || !S_ISREG(state.st_mode) ||
      state.st_uid != getuid() || state.st_nlink != 1 ||
      (state.st_mode & 0777) != 0600 ||
      state.st_size != (off_t)kAncRetryRecordBytes) {
    close(fd);
    close(directory);
    return nil;
  }
  uint8_t bytes[kAncRetryRecordBytes] = {0};
  size_t offset = 0;
  while (offset < sizeof bytes) {
    ssize_t amount = read(fd, bytes + offset, sizeof bytes - offset);
    if (amount <= 0)
      break;
    offset += (size_t)amount;
  }
  BOOL fileClosed = close(fd) == 0;
  BOOL directoryClosed = close(directory) == 0;
  BOOL okay = offset == sizeof bytes && fileClosed && directoryClosed;
  NSData *result =
      okay ? [NSData dataWithBytes:bytes length:sizeof bytes] : nil;
  anc_pv_zeroize(bytes, sizeof bytes);
  if (okay && fileState != NULL)
    *fileState = state;
  return result;
}

- (BOOL)verifyName:(NSString *)name
             vault:(const uint8_t[16])vaultId
     expectedState:(const struct stat *)expectedState {
  struct stat state;
  BOOL missing = NO;
  NSData *record = [self readName:name missing:&missing state:&state];
  return record != nil && !missing && AncRetryDecode(record, vaultId, NULL) &&
         (expectedState == NULL || (state.st_dev == expectedState->st_dev &&
                                    state.st_ino == expectedState->st_ino &&
                                    state.st_size == expectedState->st_size));
}

- (AncPrivateVaultHostedAppendRetryStoreStatus)addVaultId:
    (const uint8_t *)vaultId {
  if (vaultId == NULL)
    return AncPrivateVaultHostedAppendRetryStoreStatusInvalid;
  __block AncPrivateVaultHostedAppendRetryStoreStatus result;
  dispatch_sync(self.queue, ^{
    if (![self prepareDirectory]) {
      result = AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed;
      return;
    }
    NSString *name = [self nameForVaultId:vaultId];
    BOOL missing = NO;
    NSData *existing = [self readName:name missing:&missing state:NULL];
    if (existing != nil) {
      result = AncRetryDecode(existing, vaultId, NULL)
                   ? AncPrivateVaultHostedAppendRetryStoreStatusOK
                   : AncPrivateVaultHostedAppendRetryStoreStatusCorrupt;
      return;
    }
    if (!missing) {
      result = AncPrivateVaultHostedAppendRetryStoreStatusCorrupt;
      return;
    }
    NSData *record = AncRetryEncode(vaultId);
    NSString *temporary =
        [NSString stringWithFormat:@".%@.%@.tmp", [name substringToIndex:32],
                                   NSUUID.UUID.UUIDString.lowercaseString];
    int directory = [self openValidatedDirectory];
    NSUInteger markerCount = 0;
    if (directory < 0 ||
        ![self markerCountInDirectory:directory count:&markerCount] ||
        markerCount >= ANC_PV_HOSTED_APPEND_RETRY_MAX_CANDIDATES) {
      if (directory >= 0)
        close(directory);
      result = AncPrivateVaultHostedAppendRetryStoreStatusCorrupt;
      return;
    }
    int fd = directory < 0
                 ? -1
                 : openat(directory, temporary.fileSystemRepresentation,
                          O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                          0600);
    BOOL okay = record != nil && fd >= 0;
    size_t offset = 0;
    while (okay && offset < record.length) {
      ssize_t amount = write(fd, (const uint8_t *)record.bytes + offset,
                             record.length - offset);
      if (amount <= 0)
        okay = NO;
      else
        offset += (size_t)amount;
    }
    if (okay)
      okay = fsync(fd) == 0;
    struct stat written;
    if (okay)
      okay = fstat(fd, &written) == 0 && S_ISREG(written.st_mode) &&
             written.st_uid == getuid() && written.st_nlink == 1 &&
             (written.st_mode & 0777) == 0600 &&
             written.st_size == (off_t)record.length;
    BOOL closeOkay = fd < 0 || close(fd) == 0;
    okay = okay && closeOkay;
    if (okay &&
        AncRetryFault(
            AncPrivateVaultHostedAppendRetryStoreFaultAfterTemporaryFsync)) {
      close(directory);
      result = AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed;
      return;
    }
    if (okay)
      okay = renameat(directory, temporary.fileSystemRepresentation, directory,
                      name.fileSystemRepresentation) == 0;
    if (okay &&
        AncRetryFault(
            AncPrivateVaultHostedAppendRetryStoreFaultAfterRenameBeforeReadback)) {
      close(directory);
      result = AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed;
      return;
    }
    if (okay)
      okay = [self verifyName:name vault:vaultId expectedState:&written];
    if (okay)
      okay = fsync(directory) == 0;
    if (!okay)
      unlinkat(directory, temporary.fileSystemRepresentation, 0);
    BOOL directoryClosed = directory < 0 || close(directory) == 0;
    result = okay && directoryClosed
                 ? AncPrivateVaultHostedAppendRetryStoreStatusOK
                 : AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed;
  });
  return result;
}

- (AncPrivateVaultHostedAppendRetryStoreStatus)removeVaultId:
    (const uint8_t *)vaultId {
  if (vaultId == NULL)
    return AncPrivateVaultHostedAppendRetryStoreStatusInvalid;
  __block AncPrivateVaultHostedAppendRetryStoreStatus result;
  dispatch_sync(self.queue, ^{
    if (![self prepareDirectory]) {
      result = AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed;
      return;
    }
    NSString *name = [self nameForVaultId:vaultId];
    BOOL missing = NO;
    struct stat witness;
    NSData *record = [self readName:name missing:&missing state:&witness];
    if (missing) {
      result = AncPrivateVaultHostedAppendRetryStoreStatusOK;
      return;
    }
    if (record == nil || !AncRetryDecode(record, vaultId, NULL)) {
      result = AncPrivateVaultHostedAppendRetryStoreStatusCorrupt;
      return;
    }
    NSString *quarantine =
        [NSString stringWithFormat:@".%@.%@.tmp", [name substringToIndex:32],
                                   NSUUID.UUID.UUIDString.lowercaseString];
    int directory = [self openValidatedDirectory];
    BOOL okay = directory >= 0 &&
                [self verifyName:name vault:vaultId expectedState:&witness] &&
                renameat(directory, name.fileSystemRepresentation, directory,
                         quarantine.fileSystemRepresentation) == 0;
    if (okay &&
        AncRetryFault(
            AncPrivateVaultHostedAppendRetryStoreFaultAfterRemoveRename)) {
      close(directory);
      result = AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed;
      return;
    }
    if (okay)
      okay = [self verifyName:quarantine
                         vault:vaultId
                 expectedState:&witness] &&
             unlinkat(directory, quarantine.fileSystemRepresentation, 0) == 0;
    if (okay) {
      struct stat absent;
      okay = fstatat(directory, name.fileSystemRepresentation, &absent,
                     AT_SYMLINK_NOFOLLOW) != 0 &&
             errno == ENOENT && fsync(directory) == 0;
    }
    BOOL directoryClosed = directory < 0 || close(directory) == 0;
    result = okay && directoryClosed
                 ? AncPrivateVaultHostedAppendRetryStoreStatusOK
                 : AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed;
  });
  return result;
}

- (AncPrivateVaultHostedAppendRetryStoreStatus)listVaultIds:
    (NSArray<NSData *> **)vaultIds {
  if (vaultIds == NULL)
    return AncPrivateVaultHostedAppendRetryStoreStatusInvalid;
  *vaultIds = nil;
  __block NSArray<NSData *> *found = nil;
  __block AncPrivateVaultHostedAppendRetryStoreStatus result;
  dispatch_sync(self.queue, ^{
    if (![self prepareDirectory]) {
      result = AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed;
      return;
    }
    int directory = [self openValidatedDirectory];
    int listingFD = directory < 0 ? -1 : dup(directory);
    DIR *listing = listingFD < 0 ? NULL : fdopendir(listingFD);
    if (listing == NULL ||
        AncRetryFault(
            AncPrivateVaultHostedAppendRetryStoreFaultDirectoryListing)) {
      if (listing != NULL)
        closedir(listing);
      else if (listingFD >= 0)
        close(listingFD);
      if (directory >= 0)
        close(directory);
      result = AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed;
      return;
    }
    NSMutableOrderedSet<NSData *> *unique = [NSMutableOrderedSet orderedSet];
    BOOL okay = YES;
    struct dirent *entry;
    while (okay) {
      errno = 0;
      entry = readdir(listing);
      if (entry == NULL) {
        okay = errno == 0;
        break;
      }
      if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0)
        continue;
      NSString *name = [NSString stringWithUTF8String:entry->d_name];
      uint8_t candidate[16] = {0};
      okay = [self parseName:name vaultId:candidate] &&
             AncRetryFileSafe(directory, entry->d_name, NULL);
      if (okay) {
        BOOL missing = NO;
        NSData *record = [self readName:name missing:&missing state:NULL];
        okay = record != nil && !missing &&
               AncRetryDecode(record, candidate, NULL) &&
               unique.count < ANC_PV_HOSTED_APPEND_RETRY_MAX_CANDIDATES;
        if (okay)
          [unique addObject:[NSData dataWithBytes:candidate length:16]];
      }
      anc_pv_zeroize(candidate, sizeof candidate);
    }
    BOOL listingClosed = closedir(listing) == 0;
    BOOL directoryClosed = close(directory) == 0;
    BOOL closed = listingClosed && directoryClosed;
    if (!okay || !closed) {
      result = AncPrivateVaultHostedAppendRetryStoreStatusCorrupt;
      return;
    }
    found = [[unique array] copy];
    result = AncPrivateVaultHostedAppendRetryStoreStatusOK;
  });
  if (result == AncPrivateVaultHostedAppendRetryStoreStatusOK)
    *vaultIds = found;
  return result;
}

@end
