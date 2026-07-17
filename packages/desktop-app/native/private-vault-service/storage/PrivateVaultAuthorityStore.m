#import "PrivateVaultAuthorityStore.h"

#import "PrivateVaultCrypto.h"

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static const uint8_t kAuthorityMagic[8] = {'A', 'N', 'P', 'V',
                                           'A', 'U', '0', '1'};
static const uint8_t kVaultDigestDomain[] =
    "anc/v1/private-vault/authority-store/vault-id";
static const uint8_t kAuthorityKeyDomain[] =
    "anc/v1/private-vault/authority-store/key";
static const uint8_t kAuthorityAADDomain[] =
    "anc/v1/private-vault/authority-store/aad";
static const uint8_t kFrameDigestDomain[] =
    "anc/v1/private-vault/authority-store/frame-digest";

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultAuthorityFaultHook gAuthorityFaultHook;
static AncPrivateVaultAuthorityDerivedKeyClearedHook
    gAuthorityDerivedKeyClearedHook;
void AncPrivateVaultAuthoritySetFaultHookForTesting(
    AncPrivateVaultAuthorityFaultHook hook) {
  gAuthorityFaultHook = [hook copy];
}
void AncPrivateVaultAuthoritySetDerivedKeyClearedHookForTesting(
    AncPrivateVaultAuthorityDerivedKeyClearedHook hook) {
  gAuthorityDerivedKeyClearedHook = [hook copy];
}
static BOOL AuthorityFault(AncPrivateVaultAuthorityFaultPoint point) {
  return gAuthorityFaultHook != nil && gAuthorityFaultHook(point);
}
#else
static BOOL AuthorityFault(NSInteger point) {
  (void)point;
  return NO;
}
#endif

static void ClearAuthorityKey(uint8_t key[32]) {
  anc_pv_zeroize(key, 32);
#if ANC_PRIVATE_VAULT_TESTING
  BOOL cleared = YES;
  for (size_t index = 0; index < 32; index++)
    cleared = cleared && key[index] == 0;
  if (gAuthorityDerivedKeyClearedHook != nil)
    gAuthorityDerivedKeyClearedHook(cleared);
#endif
}

static void WriteU16(uint8_t *p, uint16_t v) {
  p[0] = v >> 8;
  p[1] = v;
}
static void WriteU32(uint8_t *p, uint32_t v) {
  for (size_t i = 0; i < 4; i++)
    p[i] = (uint8_t)(v >> (24 - i * 8));
}
static void WriteU64(uint8_t *p, uint64_t v) {
  for (size_t i = 0; i < 8; i++)
    p[i] = (uint8_t)(v >> (56 - i * 8));
}
static uint16_t ReadU16(const uint8_t *p) {
  return ((uint16_t)p[0] << 8) | p[1];
}
static uint32_t ReadU32(const uint8_t *p) {
  uint32_t v = 0;
  for (size_t i = 0; i < 4; i++)
    v = (v << 8) | p[i];
  return v;
}
static uint64_t ReadU64(const uint8_t *p) {
  uint64_t v = 0;
  for (size_t i = 0; i < 8; i++)
    v = (v << 8) | p[i];
  return v;
}

static NSData *HashDomainData(const uint8_t *domain, size_t domainLength,
                              NSData *suffix) {
  NSMutableData *input = [NSMutableData dataWithBytes:domain
                                               length:domainLength];
  [input appendData:suffix];
  uint8_t digest[32] = {0};
  if (anc_pv_blake2b_256(digest, input.bytes, input.length) != ANC_PV_CRYPTO_OK)
    return nil;
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  anc_pv_zeroize(input.mutableBytes, input.length);
  return result;
}

static NSData *VaultDigest(NSString *vaultId) {
  NSData *utf8 = [vaultId dataUsingEncoding:NSUTF8StringEncoding];
  if (utf8.length == 0 || utf8.length > UINT32_MAX)
    return nil;
  uint8_t length[4];
  WriteU32(length, (uint32_t)utf8.length);
  NSMutableData *suffix = [NSMutableData dataWithBytes:length length:4];
  [suffix appendData:utf8];
  return HashDomainData(kVaultDigestDomain, sizeof kVaultDigestDomain, suffix);
}

static BOOL DeriveAuthorityKey(uint8_t output[32], const uint8_t localKey[32],
                               NSData *vaultDigest, uint64_t generation) {
  if (localKey == NULL || vaultDigest.length != 32)
    return NO;
  NSMutableData *message =
      [NSMutableData dataWithBytes:kAuthorityKeyDomain
                            length:sizeof kAuthorityKeyDomain];
  [message appendData:vaultDigest];
  uint8_t generationBytes[8];
  WriteU64(generationBytes, generation);
  [message appendBytes:generationBytes length:8];
  AncPrivateVaultCryptoStatus status =
      anc_pv_blake2b_256_keyed(output, message.bytes, message.length, localKey);
  anc_pv_zeroize(message.mutableBytes, message.length);
  return status == ANC_PV_CRYPTO_OK;
}

static NSData *FrameDigest(NSData *frame) {
  return HashDomainData(kFrameDigestDomain, sizeof kFrameDigestDomain, frame);
}

static NSData *EncodeFrame(NSData *plaintext, NSString *vaultId,
                           uint64_t generation, const uint8_t localKey[32],
                           NSData *nonce, NSData **outDigest) {
  if (plaintext.length == 0 ||
      plaintext.length > ANC_PV_AUTHORITY_SNAPSHOT_MAX_BYTES ||
      plaintext.length > UINT32_MAX - ANC_PV_AUTH_BYTES || nonce.length != 24)
    return nil;
  NSData *vaultDigest = VaultDigest(vaultId);
  if (vaultDigest == nil)
    return nil;
  const uint32_t cipherLength = (uint32_t)plaintext.length + ANC_PV_AUTH_BYTES;
  NSMutableData *frame = [NSMutableData
      dataWithLength:ANC_PV_AUTHORITY_FRAME_HEADER_BYTES + cipherLength];
  uint8_t *bytes = frame.mutableBytes;
  memcpy(bytes, kAuthorityMagic, 8);
  WriteU16(bytes + 8, ANC_PV_AUTHORITY_FRAME_VERSION);
  WriteU16(bytes + 10, 0);
  WriteU64(bytes + 12, generation);
  WriteU32(bytes + 20, (uint32_t)plaintext.length);
  WriteU32(bytes + 24, cipherLength);
  memcpy(bytes + 28, vaultDigest.bytes, 32);
  memcpy(bytes + 60, nonce.bytes, 24);
  NSMutableData *aad = [NSMutableData dataWithBytes:kAuthorityAADDomain
                                             length:sizeof kAuthorityAADDomain];
  [aad appendBytes:bytes length:ANC_PV_AUTHORITY_FRAME_HEADER_BYTES];
  uint8_t key[32] = {0};
  size_t written = 0;
  BOOL okay = DeriveAuthorityKey(key, localKey, vaultDigest, generation) &&
              anc_pv_xchacha20poly1305_encrypt(
                  bytes + ANC_PV_AUTHORITY_FRAME_HEADER_BYTES, cipherLength,
                  &written, plaintext.bytes, plaintext.length, aad.bytes,
                  aad.length, nonce.bytes, key) == ANC_PV_CRYPTO_OK &&
              written == cipherLength;
  ClearAuthorityKey(key);
  anc_pv_zeroize(aad.mutableBytes, aad.length);
  if (!okay) {
    anc_pv_zeroize(frame.mutableBytes, frame.length);
    return nil;
  }
  NSData *digest = FrameDigest(frame);
  if (digest == nil) {
    anc_pv_zeroize(frame.mutableBytes, frame.length);
    return nil;
  }
  if (outDigest)
    *outDigest = digest;
  return frame;
}

static NSData *DecodeFrame(NSData *frame, NSString *vaultId,
                           uint64_t generation, const uint8_t localKey[32],
                           NSData **outDigest) {
  if (frame.length < ANC_PV_AUTHORITY_FRAME_HEADER_BYTES + ANC_PV_AUTH_BYTES)
    return nil;
  const uint8_t *bytes = frame.bytes;
  uint32_t plainLength = ReadU32(bytes + 20);
  uint32_t cipherLength = ReadU32(bytes + 24);
  NSData *vaultDigest = VaultDigest(vaultId);
  if (memcmp(bytes, kAuthorityMagic, 8) != 0 ||
      ReadU16(bytes + 8) != ANC_PV_AUTHORITY_FRAME_VERSION ||
      ReadU16(bytes + 10) != 0 || ReadU64(bytes + 12) != generation ||
      plainLength == 0 || plainLength > ANC_PV_AUTHORITY_SNAPSHOT_MAX_BYTES ||
      cipherLength != plainLength + ANC_PV_AUTH_BYTES ||
      frame.length != ANC_PV_AUTHORITY_FRAME_HEADER_BYTES + cipherLength ||
      vaultDigest == nil ||
      anc_pv_memcmp(bytes + 28, vaultDigest.bytes, 32) != ANC_PV_CRYPTO_OK)
    return nil;
  NSMutableData *aad = [NSMutableData dataWithBytes:kAuthorityAADDomain
                                             length:sizeof kAuthorityAADDomain];
  [aad appendBytes:bytes length:ANC_PV_AUTHORITY_FRAME_HEADER_BYTES];
  NSMutableData *plaintext = [NSMutableData dataWithLength:plainLength];
  uint8_t key[32] = {0};
  size_t written = 0;
  BOOL okay = DeriveAuthorityKey(key, localKey, vaultDigest, generation) &&
              anc_pv_xchacha20poly1305_decrypt(
                  plaintext.mutableBytes, plainLength, &written,
                  bytes + ANC_PV_AUTHORITY_FRAME_HEADER_BYTES, cipherLength,
                  aad.bytes, aad.length, bytes + 60, key) == ANC_PV_CRYPTO_OK &&
              written == plainLength;
  ClearAuthorityKey(key);
  anc_pv_zeroize(aad.mutableBytes, aad.length);
  if (!okay) {
    anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
    return nil;
  }
  NSData *digest = FrameDigest(frame);
  if (digest == nil) {
    anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
    return nil;
  }
  if (outDigest)
    *outDigest = digest;
  return plaintext;
}

static BOOL
CustodyVaultIdMatches(NSString *vaultId,
                      const AncPrivateVaultCustodySnapshot *custody) {
  NSData *encoded = [vaultId dataUsingEncoding:NSUTF8StringEncoding];
  return encoded.length > 0 && encoded.length == custody->vault_id_length &&
         anc_pv_memcmp(encoded.bytes, custody->vault_id, encoded.length) ==
             ANC_PV_CRYPTO_OK;
}

static BOOL
AuthoritySnapshotMatchesCustody(AncPrivateVaultAuthoritySnapshot *snapshot,
                                NSString *vaultId,
                                const AncPrivateVaultCustodySnapshot *custody,
                                NSData *frameDigest, uint64_t expectedEpoch) {
  return snapshot != nil && frameDigest.length == ANC_PV_HASH_BYTES &&
         custody->record_version == ANC_PV_CUSTODY_VERSION &&
         custody->authority_anchor_present == 1 &&
         [snapshot.vaultId isEqualToString:vaultId] &&
         CustodyVaultIdMatches(vaultId, custody) &&
         snapshot.targetCustodyGeneration == custody->custody_generation &&
         snapshot.sequence == custody->anchored_sequence &&
         snapshot.headHash.length == ANC_PV_HASH_BYTES &&
         anc_pv_memcmp(snapshot.headHash.bytes, custody->anchored_head,
                       ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK &&
         snapshot.membershipHash.length == ANC_PV_HASH_BYTES &&
         anc_pv_memcmp(snapshot.membershipHash.bytes,
                       custody->membership_digest,
                       ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK &&
         snapshot.signedAtMs == custody->signed_at_ms &&
         snapshot.verifiedAtMs == custody->freshness_ms &&
         snapshot.epoch == expectedEpoch &&
         snapshot.recoveryGeneration == custody->recovery_generation &&
         anc_pv_memcmp(frameDigest.bytes, custody->snapshot_digest,
                       ANC_PV_HASH_BYTES) == ANC_PV_CRYPTO_OK;
}

static BOOL CloseCustodyHandle(AncPrivateVaultCustodyHandle *handle) {
  return handle == nil ||
         [handle close] == AncPrivateVaultCustodyRepositoryStatusOK;
}

static AncPrivateVaultAuthorityStoreStatus AuthorityStatusForCustodyFailure(
    AncPrivateVaultCustodyRepositoryStatus status) {
  switch (status) {
  case AncPrivateVaultCustodyRepositoryStatusInaccessible:
  case AncPrivateVaultCustodyRepositoryStatusFailed:
    return AncPrivateVaultAuthorityStoreStatusProtectionFailed;
  case AncPrivateVaultCustodyRepositoryStatusConflict:
    return AncPrivateVaultAuthorityStoreStatusConflict;
  case AncPrivateVaultCustodyRepositoryStatusRollbackDetected:
    return AncPrivateVaultAuthorityStoreStatusRollbackDetected;
  case AncPrivateVaultCustodyRepositoryStatusNotFound:
    return AncPrivateVaultAuthorityStoreStatusNotFound;
  case AncPrivateVaultCustodyRepositoryStatusInvalid:
  case AncPrivateVaultCustodyRepositoryStatusCorrupt:
  case AncPrivateVaultCustodyRepositoryStatusOK:
    return AncPrivateVaultAuthorityStoreStatusCorrupt;
  }
}

@interface AncPrivateVaultAuthorityCheckpoint ()
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) uint64_t custodyGeneration;
@property(nonatomic, readwrite) NSData *frameDigest;
@property(nonatomic, readwrite) AncPrivateVaultAuthoritySnapshot *snapshot;
@end
@implementation AncPrivateVaultAuthorityCheckpoint
@end

@interface AncPrivateVaultVerifiedReplayResult ()
@property(nonatomic, readwrite, nullable)
    AncPrivateVaultAuthorityCheckpoint *expectedCheckpoint;
@property(nonatomic, readwrite) AncPrivateVaultAuthoritySnapshot *nextSnapshot;
@property(nonatomic, readwrite)
    AncPrivateVaultCustodyEpochTransition epochTransition;
@end
@implementation AncPrivateVaultVerifiedReplayResult
#if ANC_PRIVATE_VAULT_TESTING
+ (instancetype)
    testResultWithExpectedCheckpoint:
        (AncPrivateVaultAuthorityCheckpoint *)checkpoint
                        nextSnapshot:
                            (AncPrivateVaultAuthoritySnapshot *)snapshot
                     epochTransition:
                         (AncPrivateVaultCustodyEpochTransition)transition {
  AncPrivateVaultVerifiedReplayResult *result = [super new];
  result.expectedCheckpoint = checkpoint;
  AncPrivateVaultAuthoritySnapshotStatus status;
  NSData *canonical = AncPrivateVaultAuthoritySnapshotEncode(snapshot, &status);
  result.nextSnapshot =
      canonical == nil
          ? nil
          : AncPrivateVaultAuthoritySnapshotDecode(canonical, &status);
  result.epochTransition = transition;
  return result;
}
#endif
@end

@interface AncPrivateVaultAuthorityStore ()
@property(nonatomic) NSURL *authorityURL;
@property(nonatomic) AncPrivateVaultCustodyRepository *custodyRepository;
@property(nonatomic) dispatch_queue_t queue;
@property(nonatomic) dev_t directoryDevice;
@property(nonatomic) ino_t directoryInode;
@property(nonatomic) uid_t directoryOwner;
@property(nonatomic) BOOL directoryPinned;
@end

static NSMutableDictionary<NSString *, NSRecursiveLock *> *
AuthorityLockMap(void) {
  // Desktop is a single-instance writer. This map is the required in-process
  // root-identity/vault serialization boundary; cross-process exclusion is an
  // outer Desktop lifecycle contract.
  static NSMutableDictionary<NSString *, NSRecursiveLock *> *locks;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    locks = [NSMutableDictionary dictionary];
  });
  return locks;
}

static NSRecursiveLock *AuthorityNamedLock(NSString *key) {
  @synchronized(AuthorityLockMap()) {
    NSRecursiveLock *lock = AuthorityLockMap()[key];
    if (lock == nil) {
      lock = [[NSRecursiveLock alloc] init];
      AuthorityLockMap()[key] = lock;
    }
    return lock;
  }
}

@implementation AncPrivateVaultAuthorityStore
- (instancetype)initWithStateRootURL:(NSURL *)stateRootURL
                   custodyRepository:
                       (AncPrivateVaultCustodyRepository *)repository {
  self = [super init];
  if (self) {
    _custodyRepository = repository;
    _authorityURL = [[stateRootURL URLByAppendingPathComponent:@"state"
                                                   isDirectory:YES]
        URLByAppendingPathComponent:@"authority"
                        isDirectory:YES];
    _queue = dispatch_queue_create(
        "com.agentnative.private-vault.authority-store", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (BOOL)prepareDirectory {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSURL *stateURL = [self.authorityURL URLByDeletingLastPathComponent];
  if (![fm createDirectoryAtURL:stateURL
          withIntermediateDirectories:YES
                           attributes:@{NSFilePosixPermissions : @0700}
                                error:nil])
    return NO;
  chmod(stateURL.fileSystemRepresentation, 0700);
  if (![fm createDirectoryAtURL:self.authorityURL
          withIntermediateDirectories:YES
                           attributes:@{NSFilePosixPermissions : @0700}
                                error:nil])
    return NO;
  struct stat st;
  if (lstat(self.authorityURL.fileSystemRepresentation, &st) != 0 ||
      !S_ISDIR(st.st_mode) || st.st_uid != getuid() ||
      (st.st_mode & 0777) != 0700)
    return NO;
  if (!self.directoryPinned) {
    self.directoryDevice = st.st_dev;
    self.directoryInode = st.st_ino;
    self.directoryOwner = st.st_uid;
    self.directoryPinned = YES;
  } else if (self.directoryDevice != st.st_dev ||
             self.directoryInode != st.st_ino ||
             self.directoryOwner != st.st_uid) {
    return NO;
  }
  NSRegularExpression *allowed = [NSRegularExpression
      regularExpressionWithPattern:@"^[0-9a-f]{64}\\.authority(?:\\.stage)?$"
                           options:0
                             error:nil];
  NSRegularExpression *temporary = [NSRegularExpression
      regularExpressionWithPattern:@"^\\.[0-9a-f]{64}\\.[0-9a-f-]{36}\\.tmp$"
                           options:0
                             error:nil];
  int directoryFD = open(self.authorityURL.fileSystemRepresentation,
                         O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat opened;
  if (directoryFD < 0 || fstat(directoryFD, &opened) != 0 ||
      opened.st_dev != self.directoryDevice ||
      opened.st_ino != self.directoryInode ||
      opened.st_uid != self.directoryOwner || !S_ISDIR(opened.st_mode) ||
      (opened.st_mode & 0777) != 0700) {
    if (directoryFD >= 0)
      close(directoryFD);
    return NO;
  }
  int listingFD = dup(directoryFD);
  DIR *listing = listingFD < 0 ? NULL : fdopendir(listingFD);
  if (listing == NULL) {
    if (listingFD >= 0)
      close(listingFD);
    close(directoryFD);
    return NO;
  }
#if ANC_PRIVATE_VAULT_TESTING
  if (AuthorityFault(AncPrivateVaultAuthorityFaultDirectoryListingFailure)) {
    closedir(listing);
    close(directoryFD);
    return NO;
  }
#endif
  errno = 0;
  struct dirent *entry = NULL;
  while ((entry = readdir(listing)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0)
      continue;
    NSString *name = [NSString stringWithUTF8String:entry->d_name];
    if (name == nil) {
      closedir(listing);
      close(directoryFD);
      return NO;
    }
    NSRange range = NSMakeRange(0, name.length);
    if ([allowed firstMatchInString:name options:0 range:range] != nil)
      continue;
    if ([temporary firstMatchInString:name options:0 range:range] == nil) {
      closedir(listing);
      close(directoryFD);
      return NO;
    }
    struct stat tempStat;
    BOOL safe = fstatat(directoryFD, name.fileSystemRepresentation, &tempStat,
                        AT_SYMLINK_NOFOLLOW) == 0 &&
                S_ISREG(tempStat.st_mode) && tempStat.st_uid == getuid() &&
                tempStat.st_nlink == 1 && (tempStat.st_mode & 0777) == 0600;
    BOOL removed =
        safe && unlinkat(directoryFD, name.fileSystemRepresentation, 0) == 0;
    if (removed)
      removed = fsync(directoryFD) == 0;
    if (!removed) {
      closedir(listing);
      close(directoryFD);
      return NO;
    }
  }
  BOOL listingOkay = errno == 0 && closedir(listing) == 0;
  close(directoryFD);
  if (!listingOkay)
    return NO;
  return YES;
}

- (int)openValidatedDirectory {
#if ANC_PRIVATE_VAULT_TESTING
  if (AuthorityFault(AncPrivateVaultAuthorityFaultBeforeDirectoryReopen))
    return -1;
#endif
  int directoryFD = open(self.authorityURL.fileSystemRepresentation,
                         O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat st;
  if (directoryFD < 0 || fstat(directoryFD, &st) != 0 ||
      !self.directoryPinned || st.st_dev != self.directoryDevice ||
      st.st_ino != self.directoryInode || st.st_uid != self.directoryOwner ||
      !S_ISDIR(st.st_mode) || (st.st_mode & 0777) != 0700) {
    if (directoryFD >= 0)
      close(directoryFD);
    return -1;
  }
  return directoryFD;
}

- (NSRecursiveLock *)operationLockForVaultId:(NSString *)vaultId {
  NSString *pathKey = [@"path:"
      stringByAppendingString:self.authorityURL.path.stringByStandardizingPath];
  NSRecursiveLock *bootstrap = AuthorityNamedLock(pathKey);
  [bootstrap lock];
  BOOL prepared = [self prepareDirectory];
  NSString *vaultName = [self nameForVaultId:vaultId suffix:@""];
  NSString *identity =
      prepared && vaultName != nil
          ? [NSString stringWithFormat:@"identity:%llu:%llu:%u:%@",
                                       (unsigned long long)self.directoryDevice,
                                       (unsigned long long)self.directoryInode,
                                       self.directoryOwner, vaultName]
          : nil;
  NSRecursiveLock *operation =
      identity == nil ? nil : AuthorityNamedLock(identity);
  [bootstrap unlock];
  return operation;
}

- (NSString *)nameForVaultId:(NSString *)vaultId suffix:(NSString *)suffix {
  NSData *digest = VaultDigest(vaultId);
  if (digest == nil)
    return nil;
  const uint8_t *bytes = digest.bytes;
  NSMutableString *hex = [NSMutableString stringWithCapacity:64];
  for (size_t i = 0; i < 32; i++)
    [hex appendFormat:@"%02x", bytes[i]];
  return [hex stringByAppendingString:suffix];
}

- (NSData *)readFileName:(NSString *)name missing:(BOOL *)missing {
  if (missing)
    *missing = NO;
  int dir = [self openValidatedDirectory];
  if (dir < 0)
    return nil;
  int fd = openat(dir, name.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW);
  if (fd < 0) {
    if (missing && errno == ENOENT)
      *missing = YES;
    close(dir);
    return nil;
  }
  struct stat st;
  if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) || st.st_uid != getuid() ||
      st.st_nlink != 1 || (st.st_mode & 0777) != 0600 || st.st_size < 0 ||
      st.st_size > ANC_PV_AUTHORITY_FRAME_HEADER_BYTES +
                       ANC_PV_AUTHORITY_SNAPSHOT_MAX_BYTES +
                       ANC_PV_AUTH_BYTES) {
    close(fd);
    close(dir);
    return nil;
  }
  NSMutableData *data = [NSMutableData dataWithLength:(NSUInteger)st.st_size];
  size_t offset = 0;
  while (offset < data.length) {
    ssize_t n =
        read(fd, (uint8_t *)data.mutableBytes + offset, data.length - offset);
    if (n <= 0) {
      data = nil;
      break;
    }
    offset += (size_t)n;
  }
  close(fd);
  close(dir);
  return data;
}

- (BOOL)writeStage:(NSData *)frame vaultId:(NSString *)vaultId {
  if (![self prepareDirectory])
    return NO;
  NSString *stage = [self nameForVaultId:vaultId suffix:@".authority.stage"];
  NSString *temporary = [NSString
      stringWithFormat:@".%@.%@.tmp", [self nameForVaultId:vaultId suffix:@""],
                       NSUUID.UUID.UUIDString.lowercaseString];
  int dir = [self openValidatedDirectory];
  if (dir < 0)
    return NO;
  int fd = openat(dir, temporary.fileSystemRepresentation,
                  O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  BOOL okay = fd >= 0;
  size_t offset = 0;
  while (okay && offset < frame.length) {
    ssize_t n =
        write(fd, (const uint8_t *)frame.bytes + offset, frame.length - offset);
    if (n <= 0)
      okay = NO;
    else
      offset += (size_t)n;
  }
  if (okay &&
      AuthorityFault(AncPrivateVaultAuthorityFaultAfterTemporaryWrite)) {
    close(fd);
    close(dir);
    return NO;
  }
  if (okay)
    okay = fsync(fd) == 0;
  if (okay &&
      AuthorityFault(AncPrivateVaultAuthorityFaultAfterTemporaryFsync)) {
    close(fd);
    close(dir);
    return NO;
  }
  if (fd >= 0)
    close(fd);
  if (okay)
    okay = renameat(dir, temporary.fileSystemRepresentation, dir,
                    stage.fileSystemRepresentation) == 0;
  if (okay && AuthorityFault(AncPrivateVaultAuthorityFaultAfterStageRename)) {
    close(dir);
    return NO;
  }
  if (okay)
    okay = fsync(dir) == 0;
  if (okay &&
      AuthorityFault(AncPrivateVaultAuthorityFaultAfterStageDirectoryFsync)) {
    close(dir);
    return NO;
  }
  if (!okay)
    unlinkat(dir, temporary.fileSystemRepresentation, 0);
  close(dir);
  return okay;
}

- (BOOL)promoteStageForVaultId:(NSString *)vaultId {
  NSString *stage = [self nameForVaultId:vaultId suffix:@".authority.stage"];
  NSString *live = [self nameForVaultId:vaultId suffix:@".authority"];
  int dir = [self openValidatedDirectory];
  if (dir < 0)
    return NO;
  BOOL okay = renameat(dir, stage.fileSystemRepresentation, dir,
                       live.fileSystemRepresentation) == 0;
  if (okay && AuthorityFault(AncPrivateVaultAuthorityFaultAfterLivePromote)) {
    close(dir);
    return NO;
  }
  if (okay)
    okay = fsync(dir) == 0;
  if (okay &&
      AuthorityFault(AncPrivateVaultAuthorityFaultAfterLiveDirectoryFsync)) {
    close(dir);
    return NO;
  }
  close(dir);
  return okay;
}

- (BOOL)removeStageForVaultId:(NSString *)vaultId {
  NSString *stage = [self nameForVaultId:vaultId suffix:@".authority.stage"];
  int dir = [self openValidatedDirectory];
  if (dir < 0)
    return NO;
  BOOL okay =
      unlinkat(dir, stage.fileSystemRepresentation, 0) == 0 || errno == ENOENT;
  if (okay)
    okay = fsync(dir) == 0;
  close(dir);
  return okay;
}

- (AncPrivateVaultAuthorityStoreStatus)
    loadVaultId:(NSString *)vaultId
     checkpoint:(AncPrivateVaultAuthorityCheckpoint **)checkpoint
          error:(NSError **)error {
  (void)error;
  if (checkpoint)
    *checkpoint = nil;
  if (vaultId.length == 0)
    return AncPrivateVaultAuthorityStoreStatusInvalid;
  NSRecursiveLock *operationLock = [self operationLockForVaultId:vaultId];
  if (operationLock == nil)
    return AncPrivateVaultAuthorityStoreStatusStorageFailed;
  [operationLock lock];
  @try {
    __block AncPrivateVaultAuthorityStoreStatus result;
    __block AncPrivateVaultAuthorityCheckpoint *loadedCheckpoint = nil;
    dispatch_sync(self.queue, ^{
      AncPrivateVaultCustodySnapshot custody;
      AncPrivateVaultCustodyHandle *handle = nil;
      AncPrivateVaultCustodyRepositoryStatus cs =
          [self.custodyRepository readVaultId:vaultId
                                     snapshot:&custody
                                       handle:&handle];
      if (cs == AncPrivateVaultCustodyRepositoryStatusNotFound) {
        result = CloseCustodyHandle(handle)
                     ? AncPrivateVaultAuthorityStoreStatusNotFound
                     : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      if (cs != AncPrivateVaultCustodyRepositoryStatusOK) {
        result = CloseCustodyHandle(handle)
                     ? AuthorityStatusForCustodyFailure(cs)
                     : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      if (custody.record_version == ANC_PV_CUSTODY_LEGACY_VERSION) {
        if (!CloseCustodyHandle(handle)) {
          result = AncPrivateVaultAuthorityStoreStatusProtectionFailed;
          return;
        }
        handle = nil;
        cs = [self.custodyRepository
            migrateLegacyCodecVaultId:vaultId
                   expectedGeneration:custody.custody_generation];
        if (cs != AncPrivateVaultCustodyRepositoryStatusOK) {
          result = cs == AncPrivateVaultCustodyRepositoryStatusConflict
                       ? AncPrivateVaultAuthorityStoreStatusConflict
                       : AncPrivateVaultAuthorityStoreStatusCorrupt;
          return;
        }
        cs = [self.custodyRepository readVaultId:vaultId
                                        snapshot:&custody
                                          handle:&handle];
        if (cs != AncPrivateVaultCustodyRepositoryStatusOK) {
          result = CloseCustodyHandle(handle)
                       ? AuthorityStatusForCustodyFailure(cs)
                       : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
          return;
        }
      }
      if (custody.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVING ||
          custody.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED) {
        result = CloseCustodyHandle(handle)
                     ? AncPrivateVaultAuthorityStoreStatusRemoved
                     : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      if (custody.record_version != ANC_PV_CUSTODY_VERSION ||
          !custody.authority_anchor_present || handle == nil) {
        result = CloseCustodyHandle(handle)
                     ? AncPrivateVaultAuthorityStoreStatusCorrupt
                     : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      if (![self prepareDirectory]) {
        result = CloseCustodyHandle(handle)
                     ? AncPrivateVaultAuthorityStoreStatusStorageFailed
                     : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      BOOL missing = NO;
      NSData *live = [self readFileName:[self nameForVaultId:vaultId
                                                      suffix:@".authority"]
                                missing:&missing];
      BOOL stageMissing = NO;
      NSData *stage = [self
          readFileName:[self nameForVaultId:vaultId suffix:@".authority.stage"]
               missing:&stageMissing];
      if ((!missing && live == nil) || (!stageMissing && stage == nil)) {
        result = CloseCustodyHandle(handle)
                     ? AncPrivateVaultAuthorityStoreStatusCorrupt
                     : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      NSData *liveDigest = live == nil ? nil : FrameDigest(live);
      NSData *stageDigest = stage == nil ? nil : FrameDigest(stage);
      BOOL liveMatches =
          liveDigest != nil &&
          anc_pv_memcmp(liveDigest.bytes, custody.snapshot_digest, 32) ==
              ANC_PV_CRYPTO_OK;
      BOOL stageMatches =
          stageDigest != nil &&
          anc_pv_memcmp(stageDigest.bytes, custody.snapshot_digest, 32) ==
              ANC_PV_CRYPTO_OK;
      NSData *frame = nil;
      if (liveMatches) {
        frame = live;
        if (stage != nil) {
          if (stageMatches ||
              (stage.length >= ANC_PV_AUTHORITY_FRAME_HEADER_BYTES &&
               ReadU64((const uint8_t *)stage.bytes + 12) ==
                   custody.custody_generation + 1)) {
            if (![self removeStageForVaultId:vaultId]) {
              result =
                  CloseCustodyHandle(handle)
                      ? AncPrivateVaultAuthorityStoreStatusStorageFailed
                      : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
              return;
            }
          } else {
            result = CloseCustodyHandle(handle)
                         ? AncPrivateVaultAuthorityStoreStatusConflict
                         : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
            return;
          }
        }
      } else if (stageMatches) {
        if (![self promoteStageForVaultId:vaultId]) {
          result = CloseCustodyHandle(handle)
                       ? AncPrivateVaultAuthorityStoreStatusStorageFailed
                       : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
          return;
        }
        frame = stage;
      } else {
        AncPrivateVaultAuthorityStoreStatus mismatch =
            (live == nil && stage == nil)
                ? AncPrivateVaultAuthorityStoreStatusRollbackDetected
                : AncPrivateVaultAuthorityStoreStatusConflict;
        result = CloseCustodyHandle(handle)
                     ? mismatch
                     : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      __block NSData *plaintext = nil, *digest = nil;
      AncPrivateVaultCustodyRepositoryStatus borrow = [handle
          borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
            plaintext = DecodeFrame(frame, vaultId, custody.custody_generation,
                                    secrets->local_state_key, &digest);
            return plaintext != nil;
          }];
      AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
      if (borrow != AncPrivateVaultCustodyRepositoryStatusOK ||
          closed != AncPrivateVaultCustodyRepositoryStatusOK) {
        result = AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      if (anc_pv_memcmp(digest.bytes, custody.snapshot_digest, 32) !=
          ANC_PV_CRYPTO_OK) {
        result = AncPrivateVaultAuthorityStoreStatusConflict;
        return;
      }
      AncPrivateVaultAuthoritySnapshotStatus ss;
      AncPrivateVaultAuthoritySnapshot *snapshot =
          AncPrivateVaultAuthoritySnapshotDecode(plaintext, &ss);
      anc_pv_zeroize((void *)plaintext.bytes, plaintext.length);
      if (!AuthoritySnapshotMatchesCustody(snapshot, vaultId, &custody, digest,
                                           custody.active_epoch)) {
        result = AncPrivateVaultAuthorityStoreStatusCorrupt;
        return;
      }
      AncPrivateVaultAuthorityCheckpoint *cp =
          [AncPrivateVaultAuthorityCheckpoint new];
      cp.vaultId = vaultId;
      cp.custodyGeneration = custody.custody_generation;
      cp.frameDigest = digest;
      cp.snapshot = snapshot;
      loadedCheckpoint = cp;
      result = AncPrivateVaultAuthorityStoreStatusOK;
    });
    if (checkpoint)
      *checkpoint = loadedCheckpoint;
    return result;
  } @finally {
    [operationLock unlock];
  }
}

- (AncPrivateVaultAuthorityStoreStatus)
    commitVerifiedReplayResult:(AncPrivateVaultVerifiedReplayResult *)result
                       vaultId:(NSString *)vaultId
                  verifiedAtMs:(uint64_t)verifiedAtMs
                    checkpoint:(AncPrivateVaultAuthorityCheckpoint **)checkpoint
                         error:(NSError **)error {
  (void)error;
  if (checkpoint)
    *checkpoint = nil;
  if (result == nil || vaultId.length == 0 ||
      result.nextSnapshot.verifiedAtMs != verifiedAtMs ||
      ![result.nextSnapshot.vaultId isEqualToString:vaultId])
    return AncPrivateVaultAuthorityStoreStatusInvalid;
  NSRecursiveLock *operationLock = [self operationLockForVaultId:vaultId];
  if (operationLock == nil)
    return AncPrivateVaultAuthorityStoreStatusStorageFailed;
  [operationLock lock];
  @try {
    __block AncPrivateVaultAuthorityStoreStatus final;
    __block AncPrivateVaultAuthorityCheckpoint *committedCheckpoint = nil;
    dispatch_sync(self.queue, ^{
      AncPrivateVaultCustodySnapshot current;
      AncPrivateVaultCustodyHandle *handle = nil;
      AncPrivateVaultCustodyRepositoryStatus cs =
          [self.custodyRepository readVaultId:vaultId
                                     snapshot:&current
                                       handle:&handle];
      if (cs != AncPrivateVaultCustodyRepositoryStatusOK || handle == nil) {
        final = CloseCustodyHandle(handle)
                    ? AuthorityStatusForCustodyFailure(cs)
                    : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      AncPrivateVaultAuthorityCheckpoint *expected = result.expectedCheckpoint;
      BOOL promotes = result.epochTransition ==
                      AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch;
      BOOL carries = result.epochTransition ==
                     AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch;
      uint64_t nextEpoch =
          promotes ? current.pending_epoch : current.active_epoch;
      if (expected == nil || (!carries && !promotes) ||
          (promotes && current.pending_epoch == 0) ||
          expected.custodyGeneration != current.custody_generation ||
          anc_pv_memcmp(expected.frameDigest.bytes, current.snapshot_digest,
                        32) != ANC_PV_CRYPTO_OK ||
          ![expected.vaultId isEqualToString:vaultId] ||
          !AuthoritySnapshotMatchesCustody(expected.snapshot, vaultId, &current,
                                           expected.frameDigest,
                                           current.active_epoch) ||
          result.nextSnapshot.previousCustodyGeneration !=
              current.custody_generation ||
          result.nextSnapshot.targetCustodyGeneration !=
              current.custody_generation + 1 ||
          result.nextSnapshot.epoch != nextEpoch) {
        final = CloseCustodyHandle(handle)
                    ? AncPrivateVaultAuthorityStoreStatusConflict
                    : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      AncPrivateVaultAuthoritySnapshotStatus ss;
      NSMutableData *plaintext =
          [AncPrivateVaultAuthoritySnapshotEncode(result.nextSnapshot, &ss)
              mutableCopy];
      if (plaintext == nil) {
        final = CloseCustodyHandle(handle)
                    ? AncPrivateVaultAuthorityStoreStatusInvalid
                    : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      NSMutableData *nonce = [NSMutableData dataWithLength:24];
      if (anc_pv_random(nonce.mutableBytes, nonce.length) != ANC_PV_CRYPTO_OK) {
        anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
        final = CloseCustodyHandle(handle)
                    ? AncPrivateVaultAuthorityStoreStatusStorageFailed
                    : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      __block NSData *frame = nil, *digest = nil;
      AncPrivateVaultCustodyRepositoryStatus borrow = [handle
          borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
            frame =
                EncodeFrame(plaintext, vaultId, current.custody_generation + 1,
                            secrets->local_state_key, nonce, &digest);
            return frame != nil;
          }];
      AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
      anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
      if (borrow != AncPrivateVaultCustodyRepositoryStatusOK ||
          closed != AncPrivateVaultCustodyRepositoryStatusOK || frame == nil) {
        final = AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      AncPrivateVaultCustodySnapshot next = current;
      next.record_version = ANC_PV_CUSTODY_VERSION;
      next.custody_generation = current.custody_generation + 1;
      next.authority_anchor_present = 1;
      next.anchored_sequence = result.nextSnapshot.sequence;
      memcpy(next.anchored_head, result.nextSnapshot.headHash.bytes, 32);
      memcpy(next.membership_digest, result.nextSnapshot.membershipHash.bytes,
             32);
      next.signed_at_ms = result.nextSnapshot.signedAtMs;
      next.recovery_generation = result.nextSnapshot.recoveryGeneration;
      memcpy(next.snapshot_digest, digest.bytes, 32);
      next.freshness_ms = verifiedAtMs;
      next.expected_edge_present = 0;
      next.expected_next_sequence = 0;
      memset(next.expected_previous_head, 0, 32);
      memset(next.pending_transcript_digest, 0, 32);
      if (promotes) {
        next.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_ACTIVE;
        next.pending_kind = ANC_PV_CUSTODY_PENDING_NONE;
        next.rotation_phase = ANC_PV_CUSTODY_ROTATION_NONE;
        next.enrollment_phase = ANC_PV_CUSTODY_ENROLLMENT_NONE;
        memset(next.ceremony_id, 0, sizeof next.ceremony_id);
        next.ceremony_id_length = 0;
        next.active_epoch = current.pending_epoch;
        next.pending_epoch = 0;
      }
      if (!AuthoritySnapshotMatchesCustody(result.nextSnapshot, vaultId, &next,
                                           digest, next.active_epoch)) {
        final = AncPrivateVaultAuthorityStoreStatusInvalid;
        return;
      }
      if (![self writeStage:frame vaultId:vaultId]) {
        final = AncPrivateVaultAuthorityStoreStatusStorageFailed;
        return;
      }
      BOOL stageMissing = NO;
      NSData *stageRead = [self
          readFileName:[self nameForVaultId:vaultId suffix:@".authority.stage"]
               missing:&stageMissing];
      if (stageMissing || ![stageRead isEqualToData:frame] ||
          anc_pv_memcmp(FrameDigest(stageRead).bytes, digest.bytes, 32) !=
              ANC_PV_CRYPTO_OK) {
        final = AncPrivateVaultAuthorityStoreStatusCorrupt;
        return;
      }
      AncPrivateVaultCustodySnapshot verificationCustody;
      AncPrivateVaultCustodyHandle *verificationHandle = nil;
      cs = [self.custodyRepository readVaultId:vaultId
                                      snapshot:&verificationCustody
                                        handle:&verificationHandle];
      __block NSData *verifiedPlaintext = nil;
      if (cs != AncPrivateVaultCustodyRepositoryStatusOK ||
          verificationHandle == nil) {
        BOOL closedVerification = CloseCustodyHandle(verificationHandle);
        final = closedVerification
                    ? AuthorityStatusForCustodyFailure(cs)
                    : AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      AncPrivateVaultCustodyRepositoryStatus verificationBorrow =
          [verificationHandle
              borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
                verifiedPlaintext = DecodeFrame(stageRead, vaultId,
                                                current.custody_generation + 1,
                                                secrets->local_state_key, nil);
                return verifiedPlaintext != nil;
              }];
      AncPrivateVaultCustodyRepositoryStatus verificationClose =
          [verificationHandle close];
      if (verificationBorrow != AncPrivateVaultCustodyRepositoryStatusOK ||
          verificationClose != AncPrivateVaultCustodyRepositoryStatusOK) {
        final = AncPrivateVaultAuthorityStoreStatusProtectionFailed;
        return;
      }
      AncPrivateVaultAuthoritySnapshot *verifiedSnapshot =
          AncPrivateVaultAuthoritySnapshotDecode(verifiedPlaintext, &ss);
      NSData *verifiedCanonical =
          verifiedSnapshot == nil
              ? nil
              : AncPrivateVaultAuthoritySnapshotEncode(verifiedSnapshot, &ss);
      NSData *expectedCanonical =
          AncPrivateVaultAuthoritySnapshotEncode(result.nextSnapshot, &ss);
      BOOL semanticMatch =
          verifiedSnapshot != nil &&
          [verifiedCanonical isEqualToData:expectedCanonical] &&
          AuthoritySnapshotMatchesCustody(verifiedSnapshot, vaultId, &next,
                                          digest, next.active_epoch);
      anc_pv_zeroize((void *)verifiedPlaintext.bytes, verifiedPlaintext.length);
      if (!semanticMatch) {
        final = AncPrivateVaultAuthorityStoreStatusCorrupt;
        return;
      }
      if (AuthorityFault(AncPrivateVaultAuthorityFaultAfterStageVerification)) {
        final = AncPrivateVaultAuthorityStoreStatusStorageFailed;
        return;
      }
      cs = [self.custodyRepository
          advanceAuthorityAnchorVaultId:vaultId
                     expectedGeneration:current.custody_generation
                 expectedSnapshotDigest:expected.frameDigest
                     nextPublicSnapshot:&next
                        epochTransition:result.epochTransition];
      if (cs != AncPrivateVaultCustodyRepositoryStatusOK) {
        final = cs == AncPrivateVaultCustodyRepositoryStatusConflict
                    ? AncPrivateVaultAuthorityStoreStatusConflict
                    : AncPrivateVaultAuthorityStoreStatusCorrupt;
        return;
      }
      if (AuthorityFault(AncPrivateVaultAuthorityFaultAfterCustodyAdvance)) {
        final = AncPrivateVaultAuthorityStoreStatusStorageFailed;
        return;
      }
      BOOL promotionStageMissing = NO;
      NSData *promotionStage = [self
          readFileName:[self nameForVaultId:vaultId suffix:@".authority.stage"]
               missing:&promotionStageMissing];
      NSData *promotionDigest =
          promotionStage == nil ? nil : FrameDigest(promotionStage);
      if (promotionStageMissing || ![promotionStage isEqualToData:frame] ||
          promotionDigest.length != ANC_PV_HASH_BYTES ||
          anc_pv_memcmp(promotionDigest.bytes, digest.bytes,
                        ANC_PV_HASH_BYTES) != ANC_PV_CRYPTO_OK) {
        final = AncPrivateVaultAuthorityStoreStatusCorrupt;
        return;
      }
      if (![self promoteStageForVaultId:vaultId]) {
        final = AncPrivateVaultAuthorityStoreStatusStorageFailed;
        return;
      }
      AncPrivateVaultAuthorityCheckpoint *cp =
          [AncPrivateVaultAuthorityCheckpoint new];
      cp.vaultId = vaultId;
      cp.custodyGeneration = next.custody_generation;
      cp.frameDigest = digest;
      cp.snapshot = result.nextSnapshot;
      committedCheckpoint = cp;
      final = AncPrivateVaultAuthorityStoreStatusOK;
    });
    if (final == AncPrivateVaultAuthorityStoreStatusOK) {
      if (AuthorityFault(AncPrivateVaultAuthorityFaultBeforeFinalReread))
        return AncPrivateVaultAuthorityStoreStatusStorageFailed;
      AncPrivateVaultAuthorityCheckpoint *confirmed = nil;
      AncPrivateVaultAuthorityStoreStatus confirmedStatus =
          [self loadVaultId:vaultId checkpoint:&confirmed error:nil];
      if (confirmedStatus != AncPrivateVaultAuthorityStoreStatusOK ||
          confirmed.custodyGeneration !=
              committedCheckpoint.custodyGeneration ||
          anc_pv_memcmp(confirmed.frameDigest.bytes,
                        committedCheckpoint.frameDigest.bytes,
                        32) != ANC_PV_CRYPTO_OK)
        return confirmedStatus == AncPrivateVaultAuthorityStoreStatusOK
                   ? AncPrivateVaultAuthorityStoreStatusCorrupt
                   : confirmedStatus;
      committedCheckpoint = confirmed;
    }
    if (checkpoint)
      *checkpoint = committedCheckpoint;
    return final;
  } @finally {
    [operationLock unlock];
  }
}
@end

#if ANC_PRIVATE_VAULT_TESTING
NSData *AncPrivateVaultAuthorityFrameEncodeForTesting(
    NSData *plaintext, NSString *vaultId, uint64_t generation, NSData *key,
    NSData *nonce, NSData **digest) {
  if (key.length != ANC_PV_KEY_BYTES)
    return nil;
  return EncodeFrame(plaintext, vaultId, generation, key.bytes, nonce, digest);
}
NSData *AncPrivateVaultAuthorityFrameDecodeForTesting(NSData *frame,
                                                      NSString *vaultId,
                                                      uint64_t generation,
                                                      NSData *key,
                                                      NSData **digest) {
  if (key.length != ANC_PV_KEY_BYTES)
    return nil;
  return DecodeFrame(frame, vaultId, generation, key.bytes, digest);
}
#endif
