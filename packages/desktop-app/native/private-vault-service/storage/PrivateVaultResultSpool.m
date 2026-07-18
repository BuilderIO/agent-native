#import "PrivateVaultResultSpool.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

enum {
  kMaximumResultEnvelopeBytes = 16 * 1024 * 1024 + 64 * 1024,
};

typedef struct AncPrivateVaultResultFileWitness {
  dev_t device;
  ino_t inode;
  off_t size;
  BOOL present;
} AncPrivateVaultResultFileWitness;

@interface AncPrivateVaultResultSpool ()
@property(nonatomic) NSURL *stateRootURL;
@property(nonatomic) dispatch_queue_t queue;
@property(nonatomic) BOOL rootPinned;
@property(nonatomic) dev_t rootDevice;
@property(nonatomic) ino_t rootInode;
@property(nonatomic) uid_t rootOwner;
@property(nonatomic) BOOL statePinned;
@property(nonatomic) dev_t stateDevice;
@property(nonatomic) ino_t stateInode;
@property(nonatomic) uid_t stateOwner;
@property(nonatomic) BOOL spoolPinned;
@property(nonatomic) dev_t spoolDevice;
@property(nonatomic) ino_t spoolInode;
@property(nonatomic) uid_t spoolOwner;
@end

@implementation AncPrivateVaultResultSpool

- (instancetype)initWithStateRootURL:(NSURL *)stateRootURL {
  self = [super init];
  if (self != nil) {
    _stateRootURL = [stateRootURL copy];
    _queue = dispatch_queue_create("com.agentnative.private-vault.result-spool",
                                   DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (NSString *)baseNameForVaultId:(NSData *)vaultId jobId:(NSData *)jobId {
  if (vaultId.length != 16 || jobId.length != 16) return nil;
  NSMutableString *name = [NSMutableString stringWithCapacity:64];
  for (NSData *part in @[ vaultId, jobId ]) {
    const uint8_t *bytes = part.bytes;
    for (NSUInteger index = 0; index < part.length; index += 1)
      [name appendFormat:@"%02x", bytes[index]];
  }
  return name;
}

- (BOOL)isSafeFileName:(NSString *)name directory:(int)directory {
  struct stat file;
  return name != nil &&
      fstatat(directory, name.fileSystemRepresentation, &file,
              AT_SYMLINK_NOFOLLOW) == 0 &&
      S_ISREG(file.st_mode) && file.st_uid == getuid() && file.st_nlink == 1 &&
      (file.st_mode & 0777) == 0600 && file.st_size > 0 &&
      file.st_size <= kMaximumResultEnvelopeBytes;
}

- (BOOL)pinDirectoryStat:(struct stat)opened
                   pinned:(BOOL *)pinned
                   device:(dev_t *)device
                    inode:(ino_t *)inode
                    owner:(uid_t *)owner {
  if (!*pinned) {
    *pinned = YES;
    *device = opened.st_dev;
    *inode = opened.st_ino;
    *owner = opened.st_uid;
    return YES;
  }
  return *device == opened.st_dev && *inode == opened.st_ino &&
      *owner == opened.st_uid;
}

- (BOOL)prepareDirectory {
  struct stat rootPath;
  if (lstat(self.stateRootURL.fileSystemRepresentation, &rootPath) != 0 ||
      !S_ISDIR(rootPath.st_mode) || rootPath.st_uid != getuid() ||
      (rootPath.st_mode & 0777) != 0700 ||
      ![self pinDirectoryStat:rootPath pinned:&_rootPinned
                       device:&_rootDevice inode:&_rootInode owner:&_rootOwner])
    return NO;
  int root = open(self.stateRootURL.fileSystemRepresentation,
                  O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat openedRoot;
  if (root < 0 || fstat(root, &openedRoot) != 0 ||
      openedRoot.st_dev != self.rootDevice ||
      openedRoot.st_ino != self.rootInode ||
      openedRoot.st_uid != self.rootOwner || !S_ISDIR(openedRoot.st_mode) ||
      (openedRoot.st_mode & 0777) != 0700) {
    if (root >= 0) close(root);
    return NO;
  }
  int state = openat(root, "state", O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (state < 0 && errno == ENOENT) {
    if (mkdirat(root, "state", 0700) != 0 || fsync(root) != 0) {
      close(root);
      return NO;
    }
    state = openat(root, "state", O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  }
  struct stat openedState;
  if (state < 0 || fstat(state, &openedState) != 0 ||
      !S_ISDIR(openedState.st_mode) || openedState.st_uid != getuid() ||
      openedState.st_dev != openedRoot.st_dev ||
      (openedState.st_mode & 0777) != 0700 ||
      ![self pinDirectoryStat:openedState pinned:&_statePinned
                       device:&_stateDevice inode:&_stateInode
                        owner:&_stateOwner]) {
    if (state >= 0) close(state);
    close(root);
    return NO;
  }
  int spool = openat(state, "result-spool",
                     O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (spool < 0 && errno == ENOENT) {
    if (mkdirat(state, "result-spool", 0700) != 0 || fsync(state) != 0) {
      close(state);
      close(root);
      return NO;
    }
    spool = openat(state, "result-spool",
                   O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  }
  struct stat openedSpool;
  BOOL okay = spool >= 0 && fstat(spool, &openedSpool) == 0 &&
      S_ISDIR(openedSpool.st_mode) && openedSpool.st_uid == getuid() &&
      openedSpool.st_dev == openedState.st_dev &&
      (openedSpool.st_mode & 0777) == 0700 &&
      [self pinDirectoryStat:openedSpool pinned:&_spoolPinned
                      device:&_spoolDevice inode:&_spoolInode
                       owner:&_spoolOwner];
  close(state);
  close(root);
  if (!okay) {
    if (spool >= 0) close(spool);
    return NO;
  }
  int listingFD = dup(spool);
  DIR *listing = listingFD < 0 ? NULL : fdopendir(listingFD);
  if (listing == NULL) {
    if (listingFD >= 0) close(listingFD);
    close(spool);
    return NO;
  }
  NSRegularExpression *allowed = [NSRegularExpression
      regularExpressionWithPattern:@"^[0-9a-f]{64}\\.result(?:\\.stage)?$"
                           options:0 error:nil];
  NSRegularExpression *temporary = [NSRegularExpression
      regularExpressionWithPattern:@"^\\.[0-9a-f]{64}\\.[0-9a-f-]{36}\\.tmp$"
                           options:0 error:nil];
  errno = 0;
  struct dirent *entry;
  while (okay && (entry = readdir(listing)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0)
      continue;
    NSString *name = [NSString stringWithUTF8String:entry->d_name];
    NSRange range = NSMakeRange(0, name.length);
    if (name == nil) {
      okay = NO;
    } else if ([allowed firstMatchInString:name options:0 range:range] != nil) {
      okay = [self isSafeFileName:name directory:spool];
    } else if ([temporary firstMatchInString:name options:0 range:range] != nil) {
      struct stat file;
      okay = fstatat(spool, entry->d_name, &file, AT_SYMLINK_NOFOLLOW) == 0 &&
          S_ISREG(file.st_mode) && file.st_uid == getuid() &&
          file.st_nlink == 1 && (file.st_mode & 0777) == 0600 &&
          unlinkat(spool, entry->d_name, 0) == 0 && fsync(spool) == 0;
    } else {
      okay = NO;
    }
  }
  okay = okay && errno == 0 && closedir(listing) == 0 && close(spool) == 0;
  return okay;
}

- (int)openValidatedDirectory {
  int root = open(self.stateRootURL.fileSystemRepresentation,
                  O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat rootStat;
  if (root < 0 || fstat(root, &rootStat) != 0 || !self.rootPinned ||
      rootStat.st_dev != self.rootDevice || rootStat.st_ino != self.rootInode ||
      rootStat.st_uid != self.rootOwner || !S_ISDIR(rootStat.st_mode) ||
      (rootStat.st_mode & 0777) != 0700) {
    if (root >= 0) close(root);
    return -1;
  }
  int state = openat(root, "state", O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat stateStat;
  if (state < 0 || fstat(state, &stateStat) != 0 || !self.statePinned ||
      stateStat.st_dev != self.stateDevice || stateStat.st_ino != self.stateInode ||
      stateStat.st_uid != self.stateOwner || !S_ISDIR(stateStat.st_mode) ||
      (stateStat.st_mode & 0777) != 0700) {
    if (state >= 0) close(state);
    close(root);
    return -1;
  }
  int spool = openat(state, "result-spool",
                     O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat spoolStat;
  BOOL valid = spool >= 0 && fstat(spool, &spoolStat) == 0 && self.spoolPinned &&
      spoolStat.st_dev == self.spoolDevice && spoolStat.st_ino == self.spoolInode &&
      spoolStat.st_uid == self.spoolOwner && S_ISDIR(spoolStat.st_mode) &&
      (spoolStat.st_mode & 0777) == 0700;
  close(state);
  close(root);
  if (!valid) {
    if (spool >= 0) close(spool);
    return -1;
  }
  return spool;
}

- (NSData *)readName:(NSString *)name
              missing:(BOOL *)missing
              witness:(AncPrivateVaultResultFileWitness *)witness {
  if (missing != NULL) *missing = NO;
  if (witness != NULL) memset(witness, 0, sizeof *witness);
  int directory = [self openValidatedDirectory];
  int fd = directory < 0 ? -1 :
      openat(directory, name.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW);
  if (fd < 0) {
    if (missing != NULL && errno == ENOENT) *missing = YES;
    if (directory >= 0) close(directory);
    return nil;
  }
  struct stat before;
  if (fstat(fd, &before) != 0 || !S_ISREG(before.st_mode) ||
      before.st_uid != getuid() || before.st_nlink != 1 ||
      (before.st_mode & 0777) != 0600 || before.st_size <= 0 ||
      before.st_size > kMaximumResultEnvelopeBytes) {
    close(fd);
    close(directory);
    return nil;
  }
  NSMutableData *data = [NSMutableData dataWithLength:(NSUInteger)before.st_size];
  size_t offset = 0;
  while (offset < data.length) {
    ssize_t amount = read(fd, (uint8_t *)data.mutableBytes + offset,
                          data.length - offset);
    if (amount <= 0) {
      data = nil;
      break;
    }
    offset += (size_t)amount;
  }
  struct stat after;
  struct stat path;
  BOOL stable = data != nil && fstat(fd, &after) == 0 &&
      fstatat(directory, name.fileSystemRepresentation, &path,
              AT_SYMLINK_NOFOLLOW) == 0 &&
      after.st_dev == before.st_dev && after.st_ino == before.st_ino &&
      after.st_size == before.st_size && after.st_nlink == 1 &&
      path.st_dev == before.st_dev && path.st_ino == before.st_ino &&
      path.st_size == before.st_size && path.st_nlink == 1;
  stable = close(fd) == 0 && close(directory) == 0 && stable;
  if (!stable) return nil;
  if (witness != NULL) {
    witness->device = before.st_dev;
    witness->inode = before.st_ino;
    witness->size = before.st_size;
    witness->present = YES;
  }
  return data;
}

- (BOOL)promoteStage:(NSString *)stage live:(NSString *)live
               witness:(AncPrivateVaultResultFileWitness)witness {
  int directory = [self openValidatedDirectory];
  struct stat current;
  BOOL okay = directory >= 0 && witness.present &&
      fstatat(directory, stage.fileSystemRepresentation, &current,
              AT_SYMLINK_NOFOLLOW) == 0 &&
      current.st_dev == witness.device && current.st_ino == witness.inode &&
      current.st_size == witness.size && current.st_nlink == 1 &&
      renameatx_np(directory, stage.fileSystemRepresentation, directory,
                   live.fileSystemRepresentation, RENAME_EXCL) == 0 &&
      fsync(directory) == 0;
  if (directory >= 0) okay = close(directory) == 0 && okay;
  return okay;
}

- (AncPrivateVaultResultSpoolStatus)loadEnvelopeForVaultId:(NSData *)vaultId
                                                     jobId:(NSData *)jobId
                                                    result:(NSData **)result {
  if (result != NULL) *result = nil;
  NSString *base = [self baseNameForVaultId:vaultId jobId:jobId];
  if (base == nil) return AncPrivateVaultResultSpoolStatusInvalid;
  __block AncPrivateVaultResultSpoolStatus status;
  __block NSData *loaded = nil;
  dispatch_sync(self.queue, ^{
    if (![self prepareDirectory]) {
      status = AncPrivateVaultResultSpoolStatusStorageFailed;
      return;
    }
    NSString *live = [base stringByAppendingString:@".result"];
    BOOL missing = NO;
    loaded = [self readName:live missing:&missing witness:NULL];
    if (loaded != nil) {
      status = AncPrivateVaultResultSpoolStatusOK;
      return;
    }
    if (!missing) {
      status = AncPrivateVaultResultSpoolStatusCorrupt;
      return;
    }
    NSString *stage = [base stringByAppendingString:@".result.stage"];
    AncPrivateVaultResultFileWitness witness = {0};
    NSData *staged = [self readName:stage missing:&missing witness:&witness];
    if (staged == nil) {
      status = missing ? AncPrivateVaultResultSpoolStatusNotFound
                       : AncPrivateVaultResultSpoolStatusCorrupt;
      return;
    }
    if (![self promoteStage:stage live:live witness:witness]) {
      status = AncPrivateVaultResultSpoolStatusStorageFailed;
      return;
    }
    NSData *readback = [self readName:live missing:&missing witness:NULL];
    if (readback == nil || ![readback isEqualToData:staged]) {
      status = AncPrivateVaultResultSpoolStatusCorrupt;
      return;
    }
    loaded = readback;
    status = AncPrivateVaultResultSpoolStatusOK;
  });
  if (status == AncPrivateVaultResultSpoolStatusOK && result != NULL)
    *result = loaded;
  return status;
}

- (AncPrivateVaultResultSpoolStatus)storeEnvelope:(NSData *)envelope
                                          vaultId:(NSData *)vaultId
                                             jobId:(NSData *)jobId {
  NSString *base = [self baseNameForVaultId:vaultId jobId:jobId];
  if (base == nil || envelope.length == 0 ||
      envelope.length > kMaximumResultEnvelopeBytes)
    return AncPrivateVaultResultSpoolStatusInvalid;
  __block AncPrivateVaultResultSpoolStatus status;
  dispatch_sync(self.queue, ^{
    if (![self prepareDirectory]) {
      status = AncPrivateVaultResultSpoolStatusStorageFailed;
      return;
    }
    NSString *live = [base stringByAppendingString:@".result"];
    BOOL missing = NO;
    NSData *existing = [self readName:live missing:&missing witness:NULL];
    if (existing != nil) {
      status = [existing isEqualToData:envelope]
          ? AncPrivateVaultResultSpoolStatusOK
          : AncPrivateVaultResultSpoolStatusConflict;
      return;
    }
    if (!missing) {
      status = AncPrivateVaultResultSpoolStatusCorrupt;
      return;
    }
    NSString *stage = [base stringByAppendingString:@".result.stage"];
    AncPrivateVaultResultFileWitness stageWitness = {0};
    NSData *staged = [self readName:stage missing:&missing witness:&stageWitness];
    if (staged != nil) {
      if (![staged isEqualToData:envelope]) {
        status = AncPrivateVaultResultSpoolStatusConflict;
        return;
      }
      status = [self promoteStage:stage live:live witness:stageWitness]
          ? AncPrivateVaultResultSpoolStatusOK
          : AncPrivateVaultResultSpoolStatusStorageFailed;
      return;
    }
    if (!missing) {
      status = AncPrivateVaultResultSpoolStatusCorrupt;
      return;
    }
    NSString *temporary = [NSString stringWithFormat:@".%@.%@.tmp", base,
        NSUUID.UUID.UUIDString.lowercaseString];
    int directory = [self openValidatedDirectory];
    int fd = directory < 0 ? -1 :
        openat(directory, temporary.fileSystemRepresentation,
               O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    BOOL okay = fd >= 0;
    size_t offset = 0;
    while (okay && offset < envelope.length) {
      ssize_t amount = write(fd, (const uint8_t *)envelope.bytes + offset,
                             envelope.length - offset);
      if (amount <= 0) okay = NO;
      else offset += (size_t)amount;
    }
    struct stat written;
    if (okay) okay = fsync(fd) == 0 && fstat(fd, &written) == 0 &&
        S_ISREG(written.st_mode) && written.st_uid == getuid() &&
        written.st_nlink == 1 && (written.st_mode & 0777) == 0600 &&
        written.st_size == (off_t)envelope.length;
    if (fd >= 0) okay = close(fd) == 0 && okay;
    if (okay) okay = renameatx_np(directory, temporary.fileSystemRepresentation,
                                  directory, stage.fileSystemRepresentation,
                                  RENAME_EXCL) == 0 && fsync(directory) == 0;
    if (!okay && directory >= 0)
      unlinkat(directory, temporary.fileSystemRepresentation, 0);
    if (directory >= 0) okay = close(directory) == 0 && okay;
    if (!okay) {
      status = AncPrivateVaultResultSpoolStatusStorageFailed;
      return;
    }
    AncPrivateVaultResultFileWitness witness = {0};
    NSData *stageReadback = [self readName:stage missing:&missing witness:&witness];
    if (stageReadback == nil || ![stageReadback isEqualToData:envelope] ||
        ![self promoteStage:stage live:live witness:witness]) {
      status = AncPrivateVaultResultSpoolStatusStorageFailed;
      return;
    }
    NSData *liveReadback = [self readName:live missing:&missing witness:NULL];
    status = liveReadback != nil && [liveReadback isEqualToData:envelope]
        ? AncPrivateVaultResultSpoolStatusOK
        : AncPrivateVaultResultSpoolStatusCorrupt;
  });
  return status;
}

- (AncPrivateVaultResultSpoolStatus)deleteEnvelope:(NSData *)expectedEnvelope
                                           vaultId:(NSData *)vaultId
                                              jobId:(NSData *)jobId {
  NSString *base = [self baseNameForVaultId:vaultId jobId:jobId];
  if (base == nil || expectedEnvelope.length == 0)
    return AncPrivateVaultResultSpoolStatusInvalid;
  __block AncPrivateVaultResultSpoolStatus status;
  dispatch_sync(self.queue, ^{
    if (![self prepareDirectory]) {
      status = AncPrivateVaultResultSpoolStatusStorageFailed;
      return;
    }
    NSString *live = [base stringByAppendingString:@".result"];
    BOOL missing = NO;
    AncPrivateVaultResultFileWitness witness = {0};
    NSData *current = [self readName:live missing:&missing witness:&witness];
    if (current == nil) {
      status = missing ? AncPrivateVaultResultSpoolStatusNotFound
                       : AncPrivateVaultResultSpoolStatusCorrupt;
      return;
    }
    if (![current isEqualToData:expectedEnvelope]) {
      status = AncPrivateVaultResultSpoolStatusConflict;
      return;
    }
    int directory = [self openValidatedDirectory];
    int fd = directory < 0 ? -1 :
        openat(directory, live.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW);
    struct stat opened;
    BOOL okay = fd >= 0 && fstat(fd, &opened) == 0 && witness.present &&
        opened.st_dev == witness.device && opened.st_ino == witness.inode &&
        opened.st_size == witness.size && opened.st_nlink == 1 &&
        unlinkat(directory, live.fileSystemRepresentation, 0) == 0;
    struct stat after;
    if (okay) okay = fstat(fd, &after) == 0 && after.st_nlink == 0 &&
        after.st_dev == witness.device && after.st_ino == witness.inode &&
        fsync(directory) == 0;
    if (fd >= 0) okay = close(fd) == 0 && okay;
    if (directory >= 0) okay = close(directory) == 0 && okay;
    status = okay ? AncPrivateVaultResultSpoolStatusOK
                  : AncPrivateVaultResultSpoolStatusStorageFailed;
  });
  return status;
}

@end
