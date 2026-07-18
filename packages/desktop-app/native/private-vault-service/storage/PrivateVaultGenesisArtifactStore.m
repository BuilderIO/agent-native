#import "PrivateVaultGenesisArtifactStore.h"

#import <objc/runtime.h>
#import <sodium.h>

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static const uint8_t kMagic[8] = {'A', 'N', 'V', 'G', 'E', 'N', '0', '1'};
static const uint8_t kDomain[] =
    "agent-native/private-vault/genesis-artifacts/anc-v1";
enum {
  kHeader = 108,
  kBootstrapMax = 4096,
  kConfirmationMax = 65536,
  kAuthorizationMax = 256 * 1024
};
static const uint64_t kSafe = UINT64_C(9007199254740991);

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultGenesisArtifactFaultHook gHook;
void AncPrivateVaultGenesisArtifactSetFaultHookForTesting(
    AncPrivateVaultGenesisArtifactFaultHook hook) {
  gHook = [hook copy];
}
static BOOL Fault(AncPrivateVaultGenesisArtifactFaultPoint p) {
  return gHook && gHook(p);
}
#else
static BOOL Fault(NSInteger p) {
  (void)p;
  return NO;
}
#endif
static void W16(uint8_t *p, uint16_t v) {
  p[0] = v;
  p[1] = v >> 8;
}
static void W64(uint8_t *p, uint64_t v) {
  for (size_t i = 0; i < 8; i++)
    p[i] = v >> (8 * i);
}
static uint16_t R16(const uint8_t *p) { return p[0] | ((uint16_t)p[1] << 8); }
static uint64_t R64(const uint8_t *p) {
  uint64_t v = 0;
  for (size_t i = 0; i < 8; i++)
    v |= (uint64_t)p[i] << (8 * i);
  return v;
}
static BOOL Eq(const void *a, const void *b, size_t n) {
  return a && b && sodium_memcmp(a, b, n) == 0;
}
static BOOL Hash(const uint8_t *head, const uint8_t *body, size_t length,
                 uint8_t out[32]) {
  crypto_generichash_state s;
  BOOL ok = crypto_generichash_init(&s, NULL, 0, 32) == 0 &&
            crypto_generichash_update(&s, kDomain, sizeof kDomain) == 0 &&
            crypto_generichash_update(&s, head, 76) == 0 &&
            crypto_generichash_update(&s, body, length) == 0 &&
            crypto_generichash_final(&s, out, 32) == 0;
  sodium_memzero(&s, sizeof s);
  return ok;
}
static NSString *Hex(const uint8_t *p) {
  if (!p)
    return nil;
  NSMutableString *s = [NSMutableString stringWithCapacity:32];
  for (size_t i = 0; i < 16; i++)
    [s appendFormat:@"%02x", p[i]];
  return s;
}
static BOOL DirStatValid(struct stat *st) {
  return S_ISDIR(st->st_mode) && !S_ISLNK(st->st_mode) &&
         st->st_uid == geteuid() && (st->st_mode & 0777) == 0700;
}
static BOOL SameObject(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino &&
         a->st_uid == b->st_uid;
}
static BOOL LowerHex(unichar c, uint8_t *value) {
  if (c >= '0' && c <= '9') {
    *value = (uint8_t)(c - '0');
    return YES;
  }
  if (c >= 'a' && c <= 'f') {
    *value = (uint8_t)(c - 'a' + 10);
    return YES;
  }
  return NO;
}
static BOOL ParseLiveName(NSString *name, uint8_t vault[16]) {
  static NSString *const suffix = @".genesis";
  if (name.length != 32 + suffix.length || ![name hasSuffix:suffix])
    return NO;
  for (NSUInteger i = 0; i < 16; i++) {
    uint8_t high = 0, low = 0;
    if (!LowerHex([name characterAtIndex:i * 2], &high) ||
        !LowerHex([name characterAtIndex:i * 2 + 1], &low))
      return NO;
    vault[i] = (uint8_t)((high << 4) | low);
  }
  return YES;
}
static BOOL IsStrictTemporaryName(NSString *name) {
  if (name.length != 32 + 1 + 36 + 4 || ![name hasSuffix:@".tmp"] ||
      [name characterAtIndex:32] != '.')
    return NO;
  for (NSUInteger i = 0; i < 32; i++) {
    uint8_t ignored = 0;
    if (!LowerHex([name characterAtIndex:i], &ignored))
      return NO;
  }
  NSString *uuidText = [name substringWithRange:NSMakeRange(33, 36)];
  if (![uuidText isEqualToString:uuidText.lowercaseString])
    return NO;
  NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:uuidText];
  return uuid != nil &&
         [uuid.UUIDString.lowercaseString isEqualToString:uuidText];
}

@interface AncPrivateVaultGenesisArtifacts ()
@property(nonatomic, readwrite) NSData *vaultId;
@property(nonatomic, readwrite) NSData *ceremonyId;
@property(nonatomic, readwrite) uint64_t verifiedAtMs;
@property(nonatomic, readwrite) NSData *bootstrapTranscript;
@property(nonatomic, readwrite) NSData *recoveryConfirmation;
@property(nonatomic, readwrite) NSData *authorization;
@end
@interface AncImmutableGenesisArtifacts : AncPrivateVaultGenesisArtifacts
@end
static void Imm(void) {
  [NSException raise:NSInternalInconsistencyException
              format:@"genesis artifacts are immutable"];
}
@implementation AncImmutableGenesisArtifacts
- (void)setVaultId:(NSData *)v {
  (void)v;
  Imm();
}
- (void)setCeremonyId:(NSData *)v {
  (void)v;
  Imm();
}
- (void)setVerifiedAtMs:(uint64_t)v {
  (void)v;
  Imm();
}
- (void)setBootstrapTranscript:(NSData *)v {
  (void)v;
  Imm();
}
- (void)setRecoveryConfirmation:(NSData *)v {
  (void)v;
  Imm();
}
- (void)setAuthorization:(NSData *)v {
  (void)v;
  Imm();
}
- (void)setValue:(id)v forKey:(NSString *)k {
  (void)v;
  (void)k;
  Imm();
}
@end
@implementation AncPrivateVaultGenesisArtifacts
@end

@interface AncPrivateVaultGenesisArtifactStore () {
  int _rootFD;
  int _parentFD;
  int _directoryFD;
  dev_t _rootDev;
  ino_t _rootIno;
  dev_t _parentDev;
  ino_t _parentIno;
  dev_t _directoryDev;
  ino_t _directoryIno;
}
@property(nonatomic) dispatch_queue_t queue;
@property(nonatomic) BOOL validRoot;
@property(nonatomic, copy) NSString *rootPath;
@end
@implementation AncPrivateVaultGenesisArtifactStore
- (instancetype)initWithStateRootURL:(NSURL *)url {
  self = [super init];
  if (self) {
    _rootFD = -1;
    _parentFD = -1;
    _directoryFD = -1;
    NSString *root = url.path.stringByStandardizingPath;
    if (!url.isFileURL || root.length == 0 || !root.isAbsolutePath ||
        ![root isEqualToString:url.path])
      return nil;
    _rootPath = [root copy];
    struct stat rs;
    int rootFD = open(root.fileSystemRepresentation,
                      O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    BOOL ok = rootFD >= 0 && fstat(rootFD, &rs) == 0 && DirStatValid(&rs);
    if (ok && mkdirat(rootFD, "state", 0700) != 0 && errno != EEXIST)
      ok = NO;
    _parentFD = ok ? openat(rootFD, "state",
                            O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
                   : -1;
    struct stat ps;
    if (_parentFD < 0 || fstat(_parentFD, &ps) != 0 || !DirStatValid(&ps) ||
        ps.st_dev != rs.st_dev)
      ok = NO;
    /* Always prove the root -> state link durable. A previous process may have
     * created state and crashed when its parent fsync failed. EEXIST is not
     * evidence of durability. */
    if (ok && (Fault(AncPrivateVaultGenesisArtifactFaultStateCreateFsync) ||
               fsync(rootFD) != 0))
      ok = NO;
    if (ok && mkdirat(_parentFD, "genesis", 0700) != 0 && errno != EEXIST)
      ok = NO;
    _directoryFD = ok ? openat(_parentFD, "genesis",
                               O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
                      : -1;
    struct stat ds;
    if (_directoryFD < 0 || fstat(_directoryFD, &ds) != 0 ||
        !DirStatValid(&ds) || ds.st_dev != ps.st_dev)
      ok = NO;
    /* Likewise, an existing genesis directory is accepted only after the
     * state -> genesis link is durably flushed by this process. */
    if (ok && (Fault(AncPrivateVaultGenesisArtifactFaultGenesisCreateFsync) ||
               fsync(_parentFD) != 0))
      ok = NO;
    if (ok) {
      _rootFD = rootFD;
      _rootDev = rs.st_dev;
      _rootIno = rs.st_ino;
      _parentDev = ps.st_dev;
      _parentIno = ps.st_ino;
      _directoryDev = ds.st_dev;
      _directoryIno = ds.st_ino;
    }
    _validRoot = ok;
    if (!ok && rootFD >= 0)
      close(rootFD);
    _queue =
        dispatch_queue_create("com.agentnative.private-vault.genesis-artifacts",
                              DISPATCH_QUEUE_SERIAL);
  }
  return self;
}
- (void)dealloc {
  if (_directoryFD >= 0)
    close(_directoryFD);
  if (_parentFD >= 0)
    close(_parentFD);
  if (_rootFD >= 0)
    close(_rootFD);
}
- (BOOL)directoryValid {
  if (!self.validRoot)
    return NO;
  int pathFD = open(self.rootPath.fileSystemRepresentation,
                    O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  struct stat pathRoot, root, state, linkedState, directory, linkedDirectory;
  BOOL ok =
      pathFD >= 0 && fstat(pathFD, &pathRoot) == 0 && DirStatValid(&pathRoot) &&
      pathRoot.st_dev == _rootDev && pathRoot.st_ino == _rootIno &&
      fstat(_rootFD, &root) == 0 && DirStatValid(&root) &&
      root.st_dev == _rootDev && root.st_ino == _rootIno &&
      fstatat(_rootFD, "state", &linkedState, AT_SYMLINK_NOFOLLOW) == 0 &&
      DirStatValid(&linkedState) && linkedState.st_dev == _parentDev &&
      linkedState.st_ino == _parentIno && fstat(_parentFD, &state) == 0 &&
      DirStatValid(&state) && state.st_dev == _parentDev &&
      state.st_ino == _parentIno && SameObject(&state, &linkedState) &&
      fstatat(_parentFD, "genesis", &linkedDirectory, AT_SYMLINK_NOFOLLOW) ==
          0 &&
      DirStatValid(&linkedDirectory) &&
      linkedDirectory.st_dev == _directoryDev &&
      linkedDirectory.st_ino == _directoryIno &&
      fstat(_directoryFD, &directory) == 0 && DirStatValid(&directory) &&
      directory.st_dev == _directoryDev && directory.st_ino == _directoryIno &&
      SameObject(&directory, &linkedDirectory);
  if (pathFD >= 0)
    ok = close(pathFD) == 0 && ok;
  return ok;
}
- (NSString *)name:(const uint8_t *)vault suffix:(NSString *)suffix {
  NSString *h = Hex(vault);
  return h ? [h stringByAppendingString:suffix] : nil;
}
- (NSData *)encode:(const uint8_t *)vault
          ceremony:(const uint8_t *)ceremony
                at:(uint64_t)at
         bootstrap:(NSData *)b
      confirmation:(NSData *)c
     authorization:(NSData *)a {
  if (!vault || !ceremony || at == 0 || at > kSafe || b.length == 0 ||
      b.length > kBootstrapMax || c.length == 0 ||
      c.length > kConfirmationMax || a.length == 0 ||
      a.length > kAuthorizationMax)
    return nil;
  size_t n = b.length + c.length + a.length;
  NSMutableData *f = [NSMutableData dataWithLength:kHeader + n];
  uint8_t *p = f.mutableBytes;
  memcpy(p, kMagic, 8);
  W16(p + 8, 1);
  p[10] = p[11] = 0;
  W64(p + 12, at);
  W64(p + 20, b.length);
  W64(p + 28, c.length);
  W64(p + 36, a.length);
  memcpy(p + 44, vault, 16);
  memcpy(p + 60, ceremony, 16);
  memcpy(p + kHeader, b.bytes, b.length);
  memcpy(p + kHeader + b.length, c.bytes, c.length);
  memcpy(p + kHeader + b.length + c.length, a.bytes, a.length);
  return Hash(p, p + kHeader, n, p + 76) ? f : nil;
}
- (AncPrivateVaultGenesisArtifacts *)decode:(NSData *)f
                                      vault:(const uint8_t *)vault {
  if (!vault || f.length < kHeader)
    return nil;
  const uint8_t *p = f.bytes;
  if (!Eq(p, kMagic, 8) || R16(p + 8) != 1 || p[10] || p[11] ||
      !Eq(p + 44, vault, 16))
    return nil;
  uint64_t at = R64(p + 12), bl = R64(p + 20), cl = R64(p + 28),
           al = R64(p + 36);
  if (at == 0 || at > kSafe || bl == 0 || bl > kBootstrapMax || cl == 0 ||
      cl > kConfirmationMax || al == 0 || al > kAuthorizationMax ||
      bl > SIZE_MAX || cl > SIZE_MAX || al > SIZE_MAX ||
      f.length != kHeader + (size_t)bl + (size_t)cl + (size_t)al)
    return nil;
  uint8_t d[32];
  BOOL ok = Hash(p, p + kHeader, f.length - kHeader, d) && Eq(d, p + 76, 32);
  sodium_memzero(d, 32);
  if (!ok)
    return nil;
  AncPrivateVaultGenesisArtifacts *r =
      (id)class_createInstance(AncPrivateVaultGenesisArtifacts.class, 0);
  r.vaultId = [NSData dataWithBytes:p + 44 length:16];
  r.ceremonyId = [NSData dataWithBytes:p + 60 length:16];
  r.verifiedAtMs = at;
  r.bootstrapTranscript = [f subdataWithRange:NSMakeRange(kHeader, bl)];
  r.recoveryConfirmation = [f subdataWithRange:NSMakeRange(kHeader + bl, cl)];
  r.authorization = [f subdataWithRange:NSMakeRange(kHeader + bl + cl, al)];
  object_setClass(r, AncImmutableGenesisArtifacts.class);
  return r;
}
- (AncPrivateVaultGenesisArtifactStoreStatus)
    readUnlocked:(const uint8_t *)vault
       artifacts:(AncPrivateVaultGenesisArtifacts **)out {
  if (out)
    *out = nil;
  if (![self directoryValid])
    return AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
  NSString *n = [self name:vault suffix:@".genesis"];
  if (!n)
    return AncPrivateVaultGenesisArtifactStoreStatusInvalid;
  int fd = openat(_directoryFD, n.fileSystemRepresentation,
                  O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0)
    return errno == ENOENT
               ? AncPrivateVaultGenesisArtifactStoreStatusNotFound
               : AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
  struct stat st;
  BOOL ok = fstat(fd, &st) == 0 && S_ISREG(st.st_mode) &&
            st.st_uid == geteuid() && (st.st_mode & 0777) == 0600 &&
            st.st_nlink == 1 && st.st_size >= kHeader &&
            st.st_size <=
                kHeader + kBootstrapMax + kConfirmationMax + kAuthorizationMax;
  NSMutableData *d = ok ? [NSMutableData dataWithLength:st.st_size] : nil;
  size_t off = 0;
  while (ok && off < d.length) {
    ssize_t z = read(fd, (uint8_t *)d.mutableBytes + off, d.length - off);
    if (z <= 0) {
      ok = NO;
      break;
    }
    off += z;
  }
  ok = close(fd) == 0 && ok;
  AncPrivateVaultGenesisArtifacts *r = ok ? [self decode:d vault:vault] : nil;
  if (!r)
    return ok ? AncPrivateVaultGenesisArtifactStoreStatusCorrupt
              : AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
  if (out)
    *out = r;
  return AncPrivateVaultGenesisArtifactStoreStatusOK;
}
- (AncPrivateVaultGenesisArtifactStoreStatus)stageVaultId:(const uint8_t *)vault
                                               ceremonyId:
                                                   (const uint8_t *)ceremony
                                             verifiedAtMs:(uint64_t)at
                                      bootstrapTranscript:(NSData *)b
                                     recoveryConfirmation:(NSData *)c
                                            authorization:(NSData *)a {
  NSData *f = [self encode:vault
                  ceremony:ceremony
                        at:at
                 bootstrap:b
              confirmation:c
             authorization:a];
  if (!f)
    return AncPrivateVaultGenesisArtifactStoreStatusInvalid;
  __block AncPrivateVaultGenesisArtifactStoreStatus result;
  dispatch_sync(self.queue, ^{
    if (![self directoryValid]) {
      result = AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
      return;
    }
    NSString *live = [self name:vault suffix:@".genesis"];
    NSString *tmp =
        [NSString stringWithFormat:@"%@.%@.tmp", Hex(vault),
                                   NSUUID.UUID.UUIDString.lowercaseString];
    int fd = openat(self->_directoryFD, tmp.fileSystemRepresentation,
                    O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) {
      result = AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
      return;
    }
    size_t off = 0;
    BOOL ok = YES;
    while (off < f.length) {
      size_t req = Fault(AncPrivateVaultGenesisArtifactFaultShortWrite)
                       ? 0
                       : f.length - off;
      ssize_t z = req ? write(fd, (const uint8_t *)f.bytes + off, req) : -1;
      if (z <= 0) {
        ok = NO;
        break;
      }
      off += z;
    }
    ok = ok && !Fault(AncPrivateVaultGenesisArtifactFaultFileFsync) &&
         fsync(fd) == 0;
    ok = close(fd) == 0 && ok;
    if (!ok) {
      unlinkat(self->_directoryFD, tmp.fileSystemRepresentation, 0);
      result = AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
      return;
    }
    int renamed = renameatx_np(self->_directoryFD, tmp.fileSystemRepresentation,
                               self->_directoryFD,
                               live.fileSystemRepresentation, RENAME_EXCL);
    if (renamed != 0) {
      int e = errno;
      unlinkat(self->_directoryFD, tmp.fileSystemRepresentation, 0);
      if (e != EEXIST) {
        result = AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
        return;
      }
      AncPrivateVaultGenesisArtifacts *x = nil;
      result = [self readUnlocked:vault artifacts:&x];
      NSData *xf = result == AncPrivateVaultGenesisArtifactStoreStatusOK
                       ? [self encode:vault
                                  ceremony:x.ceremonyId.bytes
                                        at:x.verifiedAtMs
                                 bootstrap:x.bootstrapTranscript
                              confirmation:x.recoveryConfirmation
                             authorization:x.authorization]
                       : nil;
      result = xf && [xf isEqualToData:f]
                   ? AncPrivateVaultGenesisArtifactStoreStatusOK
                   : AncPrivateVaultGenesisArtifactStoreStatusConflict;
      return;
    }
    if (Fault(AncPrivateVaultGenesisArtifactFaultAfterRename)) {
      result = AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
      return;
    }
    if (Fault(AncPrivateVaultGenesisArtifactFaultDirectoryFsync) ||
        fsync(self->_directoryFD) != 0 ||
        Fault(AncPrivateVaultGenesisArtifactFaultBeforeReadback)) {
      result = AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
      return;
    }
    AncPrivateVaultGenesisArtifacts *x = nil;
    result = [self readUnlocked:vault artifacts:&x];
    NSData *xf = result == AncPrivateVaultGenesisArtifactStoreStatusOK
                     ? [self encode:vault
                                ceremony:x.ceremonyId.bytes
                                      at:x.verifiedAtMs
                               bootstrap:x.bootstrapTranscript
                            confirmation:x.recoveryConfirmation
                           authorization:x.authorization]
                     : nil;
    if (!xf || ![xf isEqualToData:f])
      result = AncPrivateVaultGenesisArtifactStoreStatusCorrupt;
  });
  return result;
}
- (AncPrivateVaultGenesisArtifactStoreStatus)
    readVaultId:(const uint8_t *)vault
      artifacts:(AncPrivateVaultGenesisArtifacts **)out {
  if (!vault || !out)
    return AncPrivateVaultGenesisArtifactStoreStatusInvalid;
  __block AncPrivateVaultGenesisArtifactStoreStatus s;
  __block AncPrivateVaultGenesisArtifacts *value = nil;
  dispatch_sync(self.queue, ^{
    s = [self readUnlocked:vault artifacts:&value];
  });
  *out = value;
  return s;
}
- (AncPrivateVaultGenesisArtifactStoreStatus)deleteVaultId:
    (const uint8_t *)vault {
  if (!vault)
    return AncPrivateVaultGenesisArtifactStoreStatusInvalid;
  __block AncPrivateVaultGenesisArtifactStoreStatus s;
  dispatch_sync(self.queue, ^{
    if (![self directoryValid] ||
        Fault(AncPrivateVaultGenesisArtifactFaultBeforeUnlink)) {
      s = AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
      return;
    }
    NSString *n = [self name:vault suffix:@".genesis"];
    if (unlinkat(self->_directoryFD, n.fileSystemRepresentation, 0) != 0 &&
        errno != ENOENT) {
      s = AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
      return;
    }
    s = fsync(self->_directoryFD) == 0
            ? AncPrivateVaultGenesisArtifactStoreStatusOK
            : AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
  });
  return s;
}
- (AncPrivateVaultGenesisArtifactStoreStatus)listVaultIds:
    (NSArray<NSData *> **)vaultIds {
  if (!vaultIds)
    return AncPrivateVaultGenesisArtifactStoreStatusInvalid;
  *vaultIds = nil;
  __block AncPrivateVaultGenesisArtifactStoreStatus status;
  __block NSArray<NSData *> *found = nil;
  dispatch_sync(self.queue, ^{
    if (![self directoryValid]) {
      status = AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
      return;
    }
    int listingFD = openat(self->_directoryFD, ".",
                           O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    DIR *listing = listingFD >= 0 ? fdopendir(listingFD) : NULL;
    if (!listing) {
      if (listingFD >= 0)
        close(listingFD);
      status = AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
      return;
    }
    NSMutableOrderedSet<NSData *> *unique = [NSMutableOrderedSet orderedSet];
    NSUInteger staleCount = 0;
    BOOL removedStale = NO, okay = YES, corrupt = NO;
    while (okay) {
      errno = 0;
      struct dirent *entry = readdir(listing);
      if (!entry) {
        okay = errno == 0;
        break;
      }
      if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0)
        continue;
      NSString *name = [NSString stringWithUTF8String:entry->d_name];
      uint8_t candidate[16] = {0};
      if (name && ParseLiveName(name, candidate)) {
        AncPrivateVaultGenesisArtifacts *artifacts = nil;
        AncPrivateVaultGenesisArtifactStoreStatus read =
            [self readUnlocked:candidate artifacts:&artifacts];
        if (read != AncPrivateVaultGenesisArtifactStoreStatusOK ||
            unique.count >= ANC_PV_GENESIS_ARTIFACT_MAX_VAULTS) {
          corrupt = YES;
          okay = NO;
        } else {
          [unique addObject:[NSData dataWithBytes:candidate length:16]];
        }
      } else if (name && IsStrictTemporaryName(name)) {
        staleCount += 1;
        struct stat temporary;
        BOOL safe =
            staleCount <= ANC_PV_GENESIS_ARTIFACT_MAX_STALE_TEMPORARIES &&
            fstatat(self->_directoryFD, entry->d_name, &temporary,
                    AT_SYMLINK_NOFOLLOW) == 0 &&
            S_ISREG(temporary.st_mode) && temporary.st_uid == geteuid() &&
            (temporary.st_mode & 0777) == 0600 && temporary.st_nlink == 1;
        if (!safe || unlinkat(self->_directoryFD, entry->d_name, 0) != 0) {
          corrupt = YES;
          okay = NO;
        } else {
          removedStale = YES;
        }
      } else {
        corrupt = YES;
        okay = NO;
      }
      sodium_memzero(candidate, sizeof candidate);
    }
    BOOL listingClosed = closedir(listing) == 0;
    BOOL cleanupDurable = !removedStale || fsync(self->_directoryFD) == 0;
    okay = okay && cleanupDurable;
    okay = okay && listingClosed && [self directoryValid];
    if (!okay) {
      status = corrupt ? AncPrivateVaultGenesisArtifactStoreStatusCorrupt
                       : AncPrivateVaultGenesisArtifactStoreStatusStorageFailed;
      return;
    }
    found = [[unique array] copy];
    status = AncPrivateVaultGenesisArtifactStoreStatusOK;
  });
  if (status == AncPrivateVaultGenesisArtifactStoreStatusOK)
    *vaultIds = found;
  return status;
}
@end
