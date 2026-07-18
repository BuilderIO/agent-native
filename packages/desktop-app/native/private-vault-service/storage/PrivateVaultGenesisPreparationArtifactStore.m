#import "PrivateVaultGenesisPreparationArtifactStore.h"

#import "PrivateVaultCrypto.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static const uint8_t kArtifactMagic[8] = {'A', 'N', 'P', 'V',
                                          'G', 'A', '0', '1'};
static const uint8_t kArtifactDomain[] =
    "anc/v1/private-vault/genesis-preparation-artifacts";
static const uint8_t kIndexMagic[8] = {'A', 'N', 'P', 'V',
                                       'G', 'I', '0', '1'};
static const uint8_t kIndexDomain[] =
    "anc/v1/private-vault/genesis-preparation-index";
static NSString *const kDirectoryName = @"genesis-preparation-artifacts";
static const size_t kMaximumArtifactFrameBytes =
    ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES +
    ANC_PV_GENESIS_PREPARATION_ARTIFACT_WRAP_MAX_BYTES +
    ANC_PV_GENESIS_PREPARATION_ARTIFACT_CONFIRMATION_MAX_BYTES +
    ANC_PV_GENESIS_PREPARATION_ARTIFACT_BOOTSTRAP_MAX_BYTES +
    ANC_PV_GENESIS_PREPARATION_ARTIFACT_AUTHORIZATION_MAX_BYTES;
static const uint64_t kMaxSafeInteger = UINT64_C(9007199254740991);

typedef NS_ENUM(NSInteger, AncFileReadStatus) {
  AncFileReadStatusOK = 0,
  AncFileReadStatusNotFound,
  AncFileReadStatusUnsafe,
  AncFileReadStatusFailed,
};

static dispatch_queue_t ArtifactQueue(void) {
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create(
        "com.agentnative.private-vault.genesis-preparation-artifacts",
        DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultGenesisPreparationArtifactFaultHook gFaultHook;
void AncPrivateVaultGenesisPreparationArtifactSetFaultHookForTesting(
    AncPrivateVaultGenesisPreparationArtifactFaultHook hook) {
  gFaultHook = [hook copy];
}
static BOOL ShouldFault(
    AncPrivateVaultGenesisPreparationArtifactFaultPoint point) {
  return gFaultHook != nil && gFaultHook(point);
}
#else
static BOOL ShouldFault(__unused NSInteger point) { return NO; }
#endif

static void WriteU16(uint8_t *bytes, uint16_t value) {
  bytes[0] = (uint8_t)value;
  bytes[1] = (uint8_t)(value >> 8);
}

static void WriteU32(uint8_t *bytes, uint32_t value) {
  for (size_t index = 0; index < 4; index++) {
    bytes[index] = (uint8_t)(value >> (index * 8));
  }
}

static void WriteU64(uint8_t *bytes, uint64_t value) {
  for (size_t index = 0; index < 8; index++) {
    bytes[index] = (uint8_t)(value >> (index * 8));
  }
}

static uint16_t ReadU16(const uint8_t *bytes) {
  return (uint16_t)(bytes[0] | ((uint16_t)bytes[1] << 8));
}

static uint32_t ReadU32(const uint8_t *bytes) {
  uint32_t value = 0;
  for (size_t index = 0; index < 4; index++) {
    value |= (uint32_t)bytes[index] << (index * 8);
  }
  return value;
}

static uint64_t ReadU64(const uint8_t *bytes) {
  uint64_t value = 0;
  for (size_t index = 0; index < 8; index++) {
    value |= (uint64_t)bytes[index] << (index * 8);
  }
  return value;
}

static BOOL IsZero(const uint8_t *bytes, size_t length) {
  uint8_t aggregate = 0;
  for (size_t index = 0; index < length; index++) {
    aggregate |= bytes[index];
  }
  return aggregate == 0;
}

static BOOL IsEqual(const uint8_t *left, const uint8_t *right, size_t length) {
  return anc_pv_memcmp(left, right, length) == ANC_PV_CRYPTO_OK;
}

static NSString *LookupHex(const uint8_t lookupId[16]) {
  static const char digits[] = "0123456789abcdef";
  char encoded[33] = {0};
  for (size_t index = 0; index < 16; index++) {
    encoded[index * 2] = digits[lookupId[index] >> 4];
    encoded[index * 2 + 1] = digits[lookupId[index] & 15];
  }
  return [[NSString alloc] initWithBytes:encoded
                                  length:32
                                encoding:NSASCIIStringEncoding];
}

static BOOL DecodeLookupFilename(NSString *name, NSString *suffix,
                                 uint8_t lookupId[16]) {
  if (name.length != 32 + suffix.length || ![name hasSuffix:suffix]) {
    return NO;
  }
  for (NSUInteger index = 0; index < 16; index++) {
    int values[2] = {0, 0};
    for (NSUInteger nibble = 0; nibble < 2; nibble++) {
      const unichar character = [name characterAtIndex:index * 2 + nibble];
      if (character >= '0' && character <= '9') {
        values[nibble] = character - '0';
      } else if (character >= 'a' && character <= 'f') {
        values[nibble] = character - 'a' + 10;
      } else {
        return NO;
      }
    }
    lookupId[index] = (uint8_t)((values[0] << 4) | values[1]);
  }
  return YES;
}

static BOOL DirectoryIsSecure(int descriptor) {
  struct stat info;
  return fstat(descriptor, &info) == 0 && S_ISDIR(info.st_mode) &&
         info.st_uid == geteuid() && (info.st_mode & 0777) == 0700 &&
         info.st_nlink >= 2;
}

static BOOL FileIsSecure(int descriptor) {
  struct stat info;
  return fstat(descriptor, &info) == 0 && S_ISREG(info.st_mode) &&
         info.st_uid == geteuid() && (info.st_mode & 0777) == 0600 &&
         info.st_nlink == 1;
}

static BOOL ArtifactDigest(uint8_t digest[32], const uint8_t *frame,
                           size_t frameLength) {
  return anc_pv_blake2b_256_two_part(digest, kArtifactDomain,
                                     sizeof(kArtifactDomain), frame,
                                     frameLength) == ANC_PV_CRYPTO_OK;
}

static NSData *BoundedSnapshot(NSData *source, size_t maximumLength) {
  if (source == nil) {
    return nil;
  }
  @try {
    const NSUInteger length = source.length;
    if (length == 0 || length > maximumLength) {
      return nil;
    }
    NSMutableData *snapshot = [NSMutableData dataWithLength:length];
    [source getBytes:snapshot.mutableBytes length:length];
    if (source.length != length) {
      anc_pv_zeroize(snapshot.mutableBytes, snapshot.length);
      return nil;
    }
    return snapshot;
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

static AncFileReadStatus ReadExactFile(int directoryDescriptor, NSString *name,
                                       size_t minimumLength,
                                       size_t maximumLength,
                                       NSData **data) {
  *data = nil;
  int descriptor = openat(directoryDescriptor, name.UTF8String,
                          O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (descriptor < 0) {
    return errno == ENOENT ? AncFileReadStatusNotFound
                           : (errno == ELOOP ? AncFileReadStatusUnsafe
                                             : AncFileReadStatusFailed);
  }
  if (!FileIsSecure(descriptor)) {
    close(descriptor);
    return AncFileReadStatusUnsafe;
  }
  struct stat info;
  if (fstat(descriptor, &info) != 0 || info.st_size < 0 ||
      (uint64_t)info.st_size < minimumLength ||
      (uint64_t)info.st_size > maximumLength) {
    close(descriptor);
    return AncFileReadStatusUnsafe;
  }
  NSMutableData *result = [NSMutableData dataWithLength:(NSUInteger)info.st_size];
  size_t offset = 0;
  while (offset < result.length) {
    const ssize_t readCount =
        read(descriptor, (uint8_t *)result.mutableBytes + offset,
             result.length - offset);
    if (readCount <= 0) {
      close(descriptor);
      return AncFileReadStatusFailed;
    }
    offset += (size_t)readCount;
  }
  uint8_t extra = 0;
  const ssize_t extraCount = read(descriptor, &extra, 1);
  const int closeStatus = close(descriptor);
  if (extraCount != 0 || closeStatus != 0) {
    return AncFileReadStatusFailed;
  }
  *data = result;
  return AncFileReadStatusOK;
}

static BOOL WriteAll(int descriptor, const uint8_t *bytes, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    if (ShouldFault(
            AncPrivateVaultGenesisPreparationArtifactFaultShortWrite)) {
      return NO;
    }
    const ssize_t written = write(descriptor, bytes + offset, length - offset);
    if (written <= 0) {
      return NO;
    }
    offset += (size_t)written;
  }
  return YES;
}

static AncPrivateVaultGenesisPreparationArtifactStatus AtomicInstall(
    int directoryDescriptor, NSString *name, NSData *contents,
    size_t minimumLength, size_t maximumLength, BOOL stageFault) {
  NSString *temporaryName =
      [NSString stringWithFormat:@"%@.tmp-%@", name,
                                 NSUUID.UUID.UUIDString.lowercaseString];
  int descriptor = openat(directoryDescriptor, temporaryName.UTF8String,
                          O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                          0600);
  if (descriptor < 0) {
    return AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
  }
  BOOL valid = FileIsSecure(descriptor) &&
               WriteAll(descriptor, contents.bytes, contents.length) &&
               !ShouldFault(
                   AncPrivateVaultGenesisPreparationArtifactFaultFileFsync) &&
               fsync(descriptor) == 0;
  if (close(descriptor) != 0) {
    valid = NO;
  }
  if (!valid) {
    unlinkat(directoryDescriptor, temporaryName.UTF8String, 0);
    return AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
  }

  if (renameatx_np(directoryDescriptor, temporaryName.UTF8String,
                   directoryDescriptor, name.UTF8String, RENAME_EXCL) != 0) {
    const int renameError = errno;
    unlinkat(directoryDescriptor, temporaryName.UTF8String, 0);
    if (renameError != EEXIST) {
      return AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
    }
    NSData *existing = nil;
    const AncFileReadStatus readStatus =
        ReadExactFile(directoryDescriptor, name, minimumLength, maximumLength,
                      &existing);
    if (readStatus != AncFileReadStatusOK) {
      return readStatus == AncFileReadStatusUnsafe
                 ? AncPrivateVaultGenesisPreparationArtifactStatusCorrupt
                 : AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
    }
    if (![existing isEqualToData:contents]) {
      return AncPrivateVaultGenesisPreparationArtifactStatusConflict;
    }
    if (fsync(directoryDescriptor) != 0) {
      return AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
    }
    NSData *readback = nil;
    if (ReadExactFile(directoryDescriptor, name, minimumLength, maximumLength,
                      &readback) != AncFileReadStatusOK ||
        ![readback isEqualToData:contents]) {
      return AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
    }
    return AncPrivateVaultGenesisPreparationArtifactStatusOK;
  }

  if ((stageFault &&
       ShouldFault(
           AncPrivateVaultGenesisPreparationArtifactFaultAfterStageRename)) ||
      ShouldFault(
          AncPrivateVaultGenesisPreparationArtifactFaultDirectoryFsync) ||
      fsync(directoryDescriptor) != 0) {
    return AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
  }
  if (ShouldFault(
          AncPrivateVaultGenesisPreparationArtifactFaultBeforeReadback)) {
    return AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
  }
  NSData *readback = nil;
  const AncFileReadStatus readStatus =
      ReadExactFile(directoryDescriptor, name, minimumLength, maximumLength,
                    &readback);
  if (readStatus != AncFileReadStatusOK || ![readback isEqualToData:contents]) {
    return readStatus == AncFileReadStatusUnsafe
               ? AncPrivateVaultGenesisPreparationArtifactStatusCorrupt
               : AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
  }
  return AncPrivateVaultGenesisPreparationArtifactStatusOK;
}

static NSData *BuildArtifactFrame(const uint8_t lookupId[16],
                                  const uint8_t vaultId[16],
                                  const uint8_t ceremonyId[16],
                                  uint64_t confirmationGeneration,
                                  NSData *recoveryWrap, NSData *confirmation,
                                  NSData *bootstrap, NSData *authorization,
                                  uint8_t digest[32]) {
  NSData *wrapSnapshot = BoundedSnapshot(
      recoveryWrap, ANC_PV_GENESIS_PREPARATION_ARTIFACT_WRAP_MAX_BYTES);
  NSData *confirmationSnapshot = BoundedSnapshot(
      confirmation,
      ANC_PV_GENESIS_PREPARATION_ARTIFACT_CONFIRMATION_MAX_BYTES);
  NSData *bootstrapSnapshot = BoundedSnapshot(
      bootstrap, ANC_PV_GENESIS_PREPARATION_ARTIFACT_BOOTSTRAP_MAX_BYTES);
  NSData *authorizationSnapshot = BoundedSnapshot(
      authorization,
      ANC_PV_GENESIS_PREPARATION_ARTIFACT_AUTHORIZATION_MAX_BYTES);
  if (lookupId == NULL || vaultId == NULL || ceremonyId == NULL ||
      confirmationGeneration != 2 || wrapSnapshot == nil ||
      confirmationSnapshot == nil || bootstrapSnapshot == nil ||
      authorizationSnapshot == nil) {
    return nil;
  }

  const size_t frameLength =
      ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES + wrapSnapshot.length +
      confirmationSnapshot.length + bootstrapSnapshot.length +
      authorizationSnapshot.length;
  NSMutableData *frame = [NSMutableData dataWithLength:frameLength];
  uint8_t *bytes = frame.mutableBytes;
  memcpy(bytes, kArtifactMagic, sizeof(kArtifactMagic));
  WriteU16(bytes + 8, 1);
  WriteU32(bytes + 12, ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES);
  WriteU64(bytes + 16, confirmationGeneration);
  memcpy(bytes + 24, lookupId, 16);
  memcpy(bytes + 40, vaultId, 16);
  memcpy(bytes + 56, ceremonyId, 16);
  WriteU64(bytes + 72, wrapSnapshot.length);
  WriteU64(bytes + 80, confirmationSnapshot.length);
  WriteU64(bytes + 88, bootstrapSnapshot.length);
  WriteU64(bytes + 96, authorizationSnapshot.length);
  size_t offset = ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES;
  for (NSData *part in @[ wrapSnapshot, confirmationSnapshot, bootstrapSnapshot,
                          authorizationSnapshot ]) {
    memcpy(bytes + offset, part.bytes, part.length);
    offset += part.length;
  }
  uint8_t computedDigest[32] = {0};
  if (!ArtifactDigest(computedDigest, bytes, frameLength)) {
    anc_pv_zeroize(bytes, frameLength);
    return nil;
  }
  memcpy(bytes + 104, computedDigest, 32);
  memcpy(digest, computedDigest, 32);
  anc_pv_zeroize(computedDigest, sizeof(computedDigest));
  return frame;
}

static BOOL ValidateArtifactFrame(
    NSData *frame, const uint8_t *lookupId, const uint8_t *vaultId,
    const uint8_t *ceremonyId, uint64_t confirmationGeneration,
    const uint8_t *expectedDigest,
    AncPrivateVaultGenesisPreparationArtifactsConsumer consumer) {
  if (frame.length < ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES ||
      frame.length > kMaximumArtifactFrameBytes) {
    return NO;
  }
  const uint8_t *bytes = frame.bytes;
  if (memcmp(bytes, kArtifactMagic, sizeof(kArtifactMagic)) != 0 ||
      ReadU16(bytes + 8) != 1 || bytes[10] != 0 || bytes[11] != 0 ||
      ReadU32(bytes + 12) !=
          ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES ||
      ReadU64(bytes + 16) == 0 || !IsZero(bytes + 136, 56)) {
    return NO;
  }
  const uint64_t wrapLength = ReadU64(bytes + 72);
  const uint64_t confirmationLength = ReadU64(bytes + 80);
  const uint64_t bootstrapLength = ReadU64(bytes + 88);
  const uint64_t authorizationLength = ReadU64(bytes + 96);
  if (wrapLength == 0 ||
      wrapLength > ANC_PV_GENESIS_PREPARATION_ARTIFACT_WRAP_MAX_BYTES ||
      confirmationLength == 0 ||
      confirmationLength >
          ANC_PV_GENESIS_PREPARATION_ARTIFACT_CONFIRMATION_MAX_BYTES ||
      bootstrapLength == 0 ||
      bootstrapLength >
          ANC_PV_GENESIS_PREPARATION_ARTIFACT_BOOTSTRAP_MAX_BYTES ||
      authorizationLength == 0 ||
      authorizationLength >
          ANC_PV_GENESIS_PREPARATION_ARTIFACT_AUTHORIZATION_MAX_BYTES ||
      wrapLength + confirmationLength + bootstrapLength + authorizationLength >
          SIZE_MAX - ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES ||
      ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES + wrapLength +
              confirmationLength + bootstrapLength + authorizationLength !=
          frame.length) {
    return NO;
  }
  if ((lookupId != NULL && !IsEqual(lookupId, bytes + 24, 16)) ||
      (vaultId != NULL && !IsEqual(vaultId, bytes + 40, 16)) ||
      (ceremonyId != NULL && !IsEqual(ceremonyId, bytes + 56, 16)) ||
      (confirmationGeneration != 0 &&
       confirmationGeneration != ReadU64(bytes + 16)) ||
      (expectedDigest != NULL &&
       !IsEqual(expectedDigest, bytes + 104, 32))) {
    return NO;
  }

  NSMutableData *digestInput = [frame mutableCopy];
  memset((uint8_t *)digestInput.mutableBytes + 104, 0, 32);
  uint8_t digest[32] = {0};
  const BOOL digestValid =
      ArtifactDigest(digest, digestInput.bytes, digestInput.length) &&
      IsEqual(digest, bytes + 104, 32);
  anc_pv_zeroize(digest, sizeof(digest));
  anc_pv_zeroize(digestInput.mutableBytes, digestInput.length);
  if (!digestValid) {
    return NO;
  }

  if (consumer != nil) {
    const size_t offset = ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES;
    @try {
      return consumer(bytes + offset, (size_t)wrapLength,
                      bytes + offset + wrapLength,
                      (size_t)confirmationLength,
                      bytes + offset + wrapLength + confirmationLength,
                      (size_t)bootstrapLength,
                      bytes + offset + wrapLength + confirmationLength +
                          bootstrapLength,
                      (size_t)authorizationLength);
    } @catch (__unused NSException *exception) {
      return NO;
    }
  }
  return YES;
}

static NSData *BuildIndexFrame(const uint8_t lookupId[16],
                               uint64_t preparedAtMs, uint64_t expiresAtMs) {
  if (lookupId == NULL || preparedAtMs == 0 ||
      preparedAtMs > kMaxSafeInteger || expiresAtMs <= preparedAtMs ||
      expiresAtMs > kMaxSafeInteger || expiresAtMs - preparedAtMs > 600000) {
    return nil;
  }
  NSMutableData *frame =
      [NSMutableData dataWithLength:ANC_PV_GENESIS_PREPARATION_INDEX_BYTES];
  uint8_t *bytes = frame.mutableBytes;
  memcpy(bytes, kIndexMagic, sizeof(kIndexMagic));
  WriteU16(bytes + 8, 1);
  WriteU16(bytes + 10, ANC_PV_GENESIS_PREPARATION_INDEX_BYTES);
  memcpy(bytes + 16, lookupId, 16);
  WriteU64(bytes + 32, preparedAtMs);
  WriteU64(bytes + 40, expiresAtMs);
  uint8_t checksum[32] = {0};
  if (anc_pv_blake2b_256_two_part(checksum, kIndexDomain,
                                  sizeof(kIndexDomain), bytes, 72) !=
      ANC_PV_CRYPTO_OK) {
    return nil;
  }
  memcpy(bytes + 72, checksum, sizeof(checksum));
  anc_pv_zeroize(checksum, sizeof(checksum));
  return frame;
}

static BOOL ValidateIndexFrame(NSData *frame, const uint8_t *lookupId) {
  if (frame.length != ANC_PV_GENESIS_PREPARATION_INDEX_BYTES) {
    return NO;
  }
  const uint8_t *bytes = frame.bytes;
  const uint64_t prepared = ReadU64(bytes + 32);
  const uint64_t expires = ReadU64(bytes + 40);
  if (memcmp(bytes, kIndexMagic, sizeof(kIndexMagic)) != 0 ||
      ReadU16(bytes + 8) != 1 ||
      ReadU16(bytes + 10) != ANC_PV_GENESIS_PREPARATION_INDEX_BYTES ||
      !IsZero(bytes + 12, 4) || !IsZero(bytes + 48, 24) || prepared == 0 ||
      prepared > kMaxSafeInteger || expires <= prepared ||
      expires > kMaxSafeInteger || expires - prepared > 600000 ||
      (lookupId != NULL && !IsEqual(lookupId, bytes + 16, 16))) {
    return NO;
  }
  uint8_t checksum[32] = {0};
  const BOOL valid =
      anc_pv_blake2b_256_two_part(checksum, kIndexDomain,
                                  sizeof(kIndexDomain), bytes, 72) ==
          ANC_PV_CRYPTO_OK &&
      IsEqual(checksum, bytes + 72, 32);
  anc_pv_zeroize(checksum, sizeof(checksum));
  return valid;
}

@interface AncPrivateVaultGenesisPreparationArtifactStore () {
  int _rootDescriptor;
  int _directoryDescriptor;
}
@property(nonatomic) dispatch_queue_t queue;
@end

static BOOL IsLowercaseUUIDAtEnd(NSString *name, NSUInteger offset) {
  if (name.length != offset + 36) {
    return NO;
  }
  for (NSUInteger index = 0; index < 36; index++) {
    const unichar character = [name characterAtIndex:offset + index];
    const BOOL hyphen = index == 8 || index == 13 || index == 18 || index == 23;
    if ((hyphen && character != '-') ||
        (!hyphen && !((character >= '0' && character <= '9') ||
                      (character >= 'a' && character <= 'f')))) {
      return NO;
    }
  }
  return YES;
}

static BOOL CleanupStrictTemporaryFiles(int rootDescriptor) {
  int scanDescriptor =
      openat(rootDescriptor, kDirectoryName.UTF8String,
             O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (scanDescriptor < 0 || !DirectoryIsSecure(scanDescriptor)) {
    if (scanDescriptor >= 0) {
      close(scanDescriptor);
    }
    return NO;
  }
  DIR *directory = fdopendir(scanDescriptor);
  if (directory == NULL) {
    close(scanDescriptor);
    return NO;
  }
  NSUInteger matchingCount = 0;
  BOOL removed = NO;
  BOOL valid = YES;
  struct dirent *entry = NULL;
  while ((entry = readdir(directory)) != NULL) {
    NSString *name = [NSString stringWithUTF8String:entry->d_name];
    if (name == nil) {
      continue;
    }
    NSRange marker = [name rangeOfString:@".tmp-"];
    if (marker.location == NSNotFound) {
      continue;
    }
    NSString *suffix = nil;
    if ([name containsString:@".stage.tmp-"]) {
      suffix = @".stage.tmp-";
    } else if ([name containsString:@".prepare-index.tmp-"]) {
      suffix = @".prepare-index.tmp-";
    } else {
      continue;
    }
    matchingCount++;
    uint8_t lookup[16] = {0};
    NSString *prefixSuffix = [suffix substringToIndex:suffix.length - 5];
    const NSUInteger uuidOffset = 32 + suffix.length;
    if (matchingCount > ANC_PV_GENESIS_PREPARATION_INDEX_MAXIMUM ||
        !DecodeLookupFilename(
            [name substringToIndex:32 + prefixSuffix.length], prefixSuffix,
            lookup) ||
        !IsLowercaseUUIDAtEnd(name, uuidOffset)) {
      valid = NO;
      break;
    }
    int descriptor = openat(scanDescriptor, name.UTF8String,
                            O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (descriptor < 0 || !FileIsSecure(descriptor)) {
      if (descriptor >= 0) {
        close(descriptor);
      }
      valid = NO;
      break;
    }
    close(descriptor);
    if (unlinkat(scanDescriptor, name.UTF8String, 0) != 0) {
      valid = NO;
      break;
    }
    removed = YES;
  }
  if (removed && fsync(scanDescriptor) != 0) {
    valid = NO;
  }
  if (closedir(directory) != 0) {
    valid = NO;
  }
  return valid;
}

@implementation AncPrivateVaultGenesisPreparationArtifactStore

- (instancetype)initWithStateRootURL:(NSURL *)stateRootURL {
  self = [super init];
  if (self == nil || !stateRootURL.isFileURL) {
    return nil;
  }
  _rootDescriptor = -1;
  _directoryDescriptor = -1;
  int root = open(stateRootURL.fileSystemRepresentation,
                  O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0 || !DirectoryIsSecure(root)) {
    if (root >= 0) {
      close(root);
    }
    return nil;
  }
  if (mkdirat(root, kDirectoryName.UTF8String, 0700) != 0 && errno != EEXIST) {
    close(root);
    return nil;
  }
  int directory = openat(root, kDirectoryName.UTF8String,
                         O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (directory < 0 || !DirectoryIsSecure(directory) || fsync(root) != 0 ||
      !CleanupStrictTemporaryFiles(root)) {
    if (directory >= 0) {
      close(directory);
    }
    close(root);
    return nil;
  }
  _rootDescriptor = root;
  _directoryDescriptor = directory;
  _queue = ArtifactQueue();
  return self;
}

- (void)dealloc {
  if (_directoryDescriptor >= 0) {
    close(_directoryDescriptor);
  }
  if (_rootDescriptor >= 0) {
    close(_rootDescriptor);
  }
}

- (AncPrivateVaultGenesisPreparationArtifactStatus)
    stageLookupId:(const uint8_t *)lookupId
          vaultId:(const uint8_t *)vaultId
       ceremonyId:(const uint8_t *)ceremonyId
       generation:(uint64_t)generation
     recoveryWrap:(NSData *)recoveryWrap
     confirmation:(NSData *)confirmation
        bootstrap:(NSData *)bootstrap
    authorization:(NSData *)authorization
           digest:(uint8_t *)digest {
  if (lookupId == NULL || vaultId == NULL || ceremonyId == NULL ||
      digest == NULL) {
    return AncPrivateVaultGenesisPreparationArtifactStatusInvalid;
  }
  __block AncPrivateVaultGenesisPreparationArtifactStatus status =
      AncPrivateVaultGenesisPreparationArtifactStatusOK;
  dispatch_sync(self.queue, ^{
    uint8_t computedDigest[32] = {0};
    NSData *frame = BuildArtifactFrame(
        lookupId, vaultId, ceremonyId, generation, recoveryWrap, confirmation,
        bootstrap, authorization, computedDigest);
    if (frame == nil) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusInvalid;
      return;
    }
    NSString *name = [LookupHex(lookupId) stringByAppendingString:@".stage"];
    status = AtomicInstall(
        self->_directoryDescriptor, name, frame,
        ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES,
        kMaximumArtifactFrameBytes, YES);
    if (status != AncPrivateVaultGenesisPreparationArtifactStatusOK) {
      return;
    }
    NSData *readback = nil;
    if (ReadExactFile(self->_directoryDescriptor, name,
                      ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES,
                      kMaximumArtifactFrameBytes, &readback) !=
            AncFileReadStatusOK ||
        !ValidateArtifactFrame(readback, lookupId, vaultId, ceremonyId,
                               generation, computedDigest, nil)) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusCorrupt;
      return;
    }
    memcpy(digest, computedDigest, 32);
  });
  return status;
}

static AncPrivateVaultGenesisPreparationArtifactStatus ReconcileArtifact(
    int directoryDescriptor, const uint8_t lookupId[16],
    const uint8_t digest[32], BOOL honorPromotionFault) {
  NSString *base = LookupHex(lookupId);
  NSString *stageName = [base stringByAppendingString:@".stage"];
  NSString *liveName = [base stringByAppendingString:@".live"];
  NSData *stage = nil;
  NSData *live = nil;
  const AncFileReadStatus stageStatus =
      ReadExactFile(directoryDescriptor, stageName,
                    ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES,
                    kMaximumArtifactFrameBytes, &stage);
  const AncFileReadStatus liveStatus =
      ReadExactFile(directoryDescriptor, liveName,
                    ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES,
                    kMaximumArtifactFrameBytes, &live);
  if (stageStatus == AncFileReadStatusUnsafe ||
      liveStatus == AncFileReadStatusUnsafe) {
    return AncPrivateVaultGenesisPreparationArtifactStatusCorrupt;
  }
  if ((stageStatus != AncFileReadStatusOK &&
       stageStatus != AncFileReadStatusNotFound) ||
      (liveStatus != AncFileReadStatusOK &&
       liveStatus != AncFileReadStatusNotFound)) {
    return AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
  }
  if (stage == nil && live == nil) {
    return AncPrivateVaultGenesisPreparationArtifactStatusNotFound;
  }
  if ((stage != nil &&
       !ValidateArtifactFrame(stage, lookupId, nil, nil, 0, digest, nil)) ||
      (live != nil &&
       !ValidateArtifactFrame(live, lookupId, nil, nil, 0, digest, nil))) {
    return AncPrivateVaultGenesisPreparationArtifactStatusBindingMismatch;
  }
  if (live != nil) {
    if (stage != nil && ![stage isEqualToData:live]) {
      return AncPrivateVaultGenesisPreparationArtifactStatusConflict;
    }
    if (stage != nil) {
      if (ShouldFault(
              AncPrivateVaultGenesisPreparationArtifactFaultBeforeUnlink) ||
          unlinkat(directoryDescriptor, stageName.UTF8String, 0) != 0 ||
          fsync(directoryDescriptor) != 0) {
        return AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
      }
    }
    return AncPrivateVaultGenesisPreparationArtifactStatusOK;
  }
  if (honorPromotionFault &&
      ShouldFault(
          AncPrivateVaultGenesisPreparationArtifactFaultBeforeLiveRename)) {
    return AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
  }
  if (renameatx_np(directoryDescriptor, stageName.UTF8String,
                   directoryDescriptor, liveName.UTF8String, RENAME_EXCL) != 0 ||
      fsync(directoryDescriptor) != 0) {
    return AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
  }
  NSData *readback = nil;
  if (ReadExactFile(directoryDescriptor, liveName,
                    ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES,
                    kMaximumArtifactFrameBytes, &readback) !=
          AncFileReadStatusOK ||
      !ValidateArtifactFrame(readback, lookupId, nil, nil, 0, digest, nil)) {
    return AncPrivateVaultGenesisPreparationArtifactStatusCorrupt;
  }
  return AncPrivateVaultGenesisPreparationArtifactStatusOK;
}

- (AncPrivateVaultGenesisPreparationArtifactStatus)
    promoteLookupId:(const uint8_t *)lookupId
      expectedDigest:(const uint8_t *)digest {
  if (lookupId == NULL || digest == NULL) {
    return AncPrivateVaultGenesisPreparationArtifactStatusInvalid;
  }
  __block AncPrivateVaultGenesisPreparationArtifactStatus status;
  dispatch_sync(self.queue, ^{
    status = ReconcileArtifact(self->_directoryDescriptor, lookupId, digest, YES);
  });
  return status;
}

- (AncPrivateVaultGenesisPreparationArtifactStatus)
    reconcileLookupId:(const uint8_t *)lookupId
       expectedDigest:(const uint8_t *)digest {
  if (lookupId == NULL || digest == NULL) {
    return AncPrivateVaultGenesisPreparationArtifactStatusInvalid;
  }
  __block AncPrivateVaultGenesisPreparationArtifactStatus status;
  dispatch_sync(self.queue, ^{
    status = ReconcileArtifact(self->_directoryDescriptor, lookupId, digest, NO);
  });
  return status;
}

- (AncPrivateVaultGenesisPreparationArtifactStatus)
    readLiveLookupId:(const uint8_t *)lookupId
              vaultId:(const uint8_t *)vaultId
           ceremonyId:(const uint8_t *)ceremonyId
           generation:(uint64_t)generation
       expectedDigest:(const uint8_t *)digest
              consumer:
                  (AncPrivateVaultGenesisPreparationArtifactsConsumer)consumer {
  if (lookupId == NULL || vaultId == NULL || ceremonyId == NULL ||
      generation != 2 || digest == NULL || consumer == nil) {
    return AncPrivateVaultGenesisPreparationArtifactStatusInvalid;
  }
  __block AncPrivateVaultGenesisPreparationArtifactStatus status =
      AncPrivateVaultGenesisPreparationArtifactStatusOK;
  dispatch_sync(self.queue, ^{
    NSData *frame = nil;
    const AncFileReadStatus readStatus = ReadExactFile(
        self->_directoryDescriptor,
        [LookupHex(lookupId) stringByAppendingString:@".live"],
        ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES,
        kMaximumArtifactFrameBytes, &frame);
    if (readStatus == AncFileReadStatusNotFound) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusNotFound;
    } else if (readStatus == AncFileReadStatusUnsafe) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusCorrupt;
    } else if (readStatus != AncFileReadStatusOK) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
    } else if (!ValidateArtifactFrame(frame, lookupId, vaultId, ceremonyId,
                                      generation, digest, consumer)) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusBindingMismatch;
    }
  });
  return status;
}

- (AncPrivateVaultGenesisPreparationArtifactStatus)
    deleteStagedLookupId:(const uint8_t *)lookupId
          expectedDigest:(const uint8_t *)digest {
  if (lookupId == NULL || digest == NULL) {
    return AncPrivateVaultGenesisPreparationArtifactStatusInvalid;
  }
  __block AncPrivateVaultGenesisPreparationArtifactStatus status =
      AncPrivateVaultGenesisPreparationArtifactStatusOK;
  dispatch_sync(self.queue, ^{
    NSString *name =
        [LookupHex(lookupId) stringByAppendingString:@".stage"];
    NSData *frame = nil;
    const AncFileReadStatus readStatus = ReadExactFile(
        self->_directoryDescriptor, name,
        ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES,
        kMaximumArtifactFrameBytes, &frame);
    if (readStatus == AncFileReadStatusNotFound) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusNotFound;
      return;
    }
    if (readStatus == AncFileReadStatusUnsafe) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusCorrupt;
      return;
    }
    if (readStatus != AncFileReadStatusOK) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
      return;
    }
    if (!ValidateArtifactFrame(frame, lookupId, nil, nil, 0, digest, nil)) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusBindingMismatch;
      return;
    }
    if (ShouldFault(
            AncPrivateVaultGenesisPreparationArtifactFaultBeforeUnlink) ||
        unlinkat(self->_directoryDescriptor, name.UTF8String, 0) != 0 ||
        fsync(self->_directoryDescriptor) != 0) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
    }
  });
  return status;
}

- (AncPrivateVaultGenesisPreparationArtifactStatus)
    deleteUnboundStagedLookupId:(const uint8_t *)lookupId
                        vaultId:(const uint8_t *)vaultId
                     ceremonyId:(const uint8_t *)ceremonyId
                     generation:(uint64_t)generation {
  if (lookupId == NULL || vaultId == NULL || ceremonyId == NULL ||
      generation == 0) {
    return AncPrivateVaultGenesisPreparationArtifactStatusInvalid;
  }
  __block AncPrivateVaultGenesisPreparationArtifactStatus status =
      AncPrivateVaultGenesisPreparationArtifactStatusOK;
  dispatch_sync(self.queue, ^{
    NSString *name =
        [LookupHex(lookupId) stringByAppendingString:@".stage"];
    NSData *frame = nil;
    const AncFileReadStatus readStatus = ReadExactFile(
        self->_directoryDescriptor, name,
        ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES,
        kMaximumArtifactFrameBytes, &frame);
    if (readStatus == AncFileReadStatusNotFound) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusNotFound;
      return;
    }
    if (readStatus == AncFileReadStatusUnsafe) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusCorrupt;
      return;
    }
    if (readStatus != AncFileReadStatusOK) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
      return;
    }
    if (!ValidateArtifactFrame(frame, lookupId, vaultId, ceremonyId,
                               generation, NULL, nil)) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusBindingMismatch;
      return;
    }
    if (ShouldFault(
            AncPrivateVaultGenesisPreparationArtifactFaultBeforeUnlink) ||
        unlinkat(self->_directoryDescriptor, name.UTF8String, 0) != 0 ||
        fsync(self->_directoryDescriptor) != 0) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
    }
  });
  return status;
}

- (AncPrivateVaultGenesisPreparationArtifactStatus)
    deleteLiveLookupId:(const uint8_t *)lookupId
        expectedDigest:(const uint8_t *)digest {
  if (lookupId == NULL || digest == NULL) {
    return AncPrivateVaultGenesisPreparationArtifactStatusInvalid;
  }
  __block AncPrivateVaultGenesisPreparationArtifactStatus status =
      AncPrivateVaultGenesisPreparationArtifactStatusOK;
  dispatch_sync(self.queue, ^{
    NSString *name =
        [LookupHex(lookupId) stringByAppendingString:@".live"];
    NSData *frame = nil;
    const AncFileReadStatus readStatus = ReadExactFile(
        self->_directoryDescriptor, name,
        ANC_PV_GENESIS_PREPARATION_ARTIFACT_HEADER_BYTES,
        kMaximumArtifactFrameBytes, &frame);
    if (readStatus == AncFileReadStatusNotFound) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusNotFound;
      return;
    }
    if (readStatus == AncFileReadStatusUnsafe) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusCorrupt;
      return;
    }
    if (readStatus != AncFileReadStatusOK) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
      return;
    }
    if (!ValidateArtifactFrame(frame, lookupId, nil, nil, 0, digest, nil)) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusBindingMismatch;
      return;
    }
    if (ShouldFault(
            AncPrivateVaultGenesisPreparationArtifactFaultBeforeUnlink) ||
        unlinkat(self->_directoryDescriptor, name.UTF8String, 0) != 0 ||
        fsync(self->_directoryDescriptor) != 0) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
    }
  });
  return status;
}

- (AncPrivateVaultGenesisPreparationArtifactStatus)
    createPreparationIndexLookupId:(const uint8_t *)lookupId
                       preparedAtMs:(uint64_t)preparedAtMs
                        expiresAtMs:(uint64_t)expiresAtMs {
  if (lookupId == NULL) {
    return AncPrivateVaultGenesisPreparationArtifactStatusInvalid;
  }
  __block AncPrivateVaultGenesisPreparationArtifactStatus status;
  dispatch_sync(self.queue, ^{
    NSData *frame = BuildIndexFrame(lookupId, preparedAtMs, expiresAtMs);
    if (frame == nil) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusInvalid;
      return;
    }
    status = AtomicInstall(
        self->_directoryDescriptor,
        [LookupHex(lookupId) stringByAppendingString:@".prepare-index"], frame,
        ANC_PV_GENESIS_PREPARATION_INDEX_BYTES,
        ANC_PV_GENESIS_PREPARATION_INDEX_BYTES, NO);
    if (status != AncPrivateVaultGenesisPreparationArtifactStatusOK) {
      return;
    }
    NSData *readback = nil;
    const AncFileReadStatus readStatus = ReadExactFile(
        self->_directoryDescriptor,
        [LookupHex(lookupId) stringByAppendingString:@".prepare-index"],
        ANC_PV_GENESIS_PREPARATION_INDEX_BYTES,
        ANC_PV_GENESIS_PREPARATION_INDEX_BYTES, &readback);
    if (readStatus != AncFileReadStatusOK ||
        !ValidateIndexFrame(readback, lookupId)) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusCorrupt;
    }
  });
  return status;
}

- (AncPrivateVaultGenesisPreparationArtifactStatus)
    listPreparationLookupIds:(NSArray<NSData *> **)lookupIds {
  if (lookupIds == NULL) {
    return AncPrivateVaultGenesisPreparationArtifactStatusInvalid;
  }
  *lookupIds = nil;
  __block AncPrivateVaultGenesisPreparationArtifactStatus status =
      AncPrivateVaultGenesisPreparationArtifactStatusOK;
  __block NSArray<NSData *> *result = nil;
  dispatch_sync(self.queue, ^{
    if (!CleanupStrictTemporaryFiles(self->_rootDescriptor)) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusCorrupt;
      return;
    }
    int scanDescriptor =
        openat(self->_rootDescriptor, kDirectoryName.UTF8String,
               O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    DIR *directory = scanDescriptor >= 0 && DirectoryIsSecure(scanDescriptor)
                         ? fdopendir(scanDescriptor)
                         : NULL;
    if (directory == NULL) {
      if (scanDescriptor >= 0) {
        close(scanDescriptor);
      }
      status = AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
      return;
    }
    NSMutableArray<NSData *> *found = [NSMutableArray array];
    struct dirent *entry = NULL;
    while ((entry = readdir(directory)) != NULL) {
      NSString *name = [NSString stringWithUTF8String:entry->d_name];
      if (name == nil || ![name hasSuffix:@".prepare-index"]) {
        continue;
      }
      uint8_t filenameLookup[16] = {0};
      if (!DecodeLookupFilename(name, @".prepare-index", filenameLookup) ||
          found.count >= ANC_PV_GENESIS_PREPARATION_INDEX_MAXIMUM) {
        status = AncPrivateVaultGenesisPreparationArtifactStatusCorrupt;
        break;
      }
      NSData *frame = nil;
      const AncFileReadStatus readStatus = ReadExactFile(
          self->_directoryDescriptor, name,
          ANC_PV_GENESIS_PREPARATION_INDEX_BYTES,
          ANC_PV_GENESIS_PREPARATION_INDEX_BYTES, &frame);
      if (readStatus != AncFileReadStatusOK ||
          !ValidateIndexFrame(frame, filenameLookup)) {
        status = AncPrivateVaultGenesisPreparationArtifactStatusCorrupt;
        break;
      }
      [found addObject:[NSData dataWithBytes:filenameLookup length:16]];
    }
    if (closedir(directory) != 0 &&
        status == AncPrivateVaultGenesisPreparationArtifactStatusOK) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
    }
    if (status == AncPrivateVaultGenesisPreparationArtifactStatusOK) {
      [found sortUsingComparator:^NSComparisonResult(NSData *left,
                                                      NSData *right) {
        const int comparison = memcmp(left.bytes, right.bytes, 16);
        return comparison < 0 ? NSOrderedAscending
                              : (comparison > 0 ? NSOrderedDescending
                                                : NSOrderedSame);
      }];
      for (NSUInteger index = 1; index < found.count; index++) {
        if ([found[index - 1] isEqualToData:found[index]]) {
          status = AncPrivateVaultGenesisPreparationArtifactStatusCorrupt;
          break;
        }
      }
      if (status == AncPrivateVaultGenesisPreparationArtifactStatusOK) {
        result = [found copy];
      }
    }
  });
  if (status == AncPrivateVaultGenesisPreparationArtifactStatusOK) {
    *lookupIds = result;
  }
  return status;
}

- (AncPrivateVaultGenesisPreparationArtifactStatus)
    deletePreparationIndexLookupId:(const uint8_t *)lookupId {
  if (lookupId == NULL) {
    return AncPrivateVaultGenesisPreparationArtifactStatusInvalid;
  }
  __block AncPrivateVaultGenesisPreparationArtifactStatus status =
      AncPrivateVaultGenesisPreparationArtifactStatusOK;
  dispatch_sync(self.queue, ^{
    NSString *name =
        [LookupHex(lookupId) stringByAppendingString:@".prepare-index"];
    NSData *frame = nil;
    const AncFileReadStatus readStatus = ReadExactFile(
        self->_directoryDescriptor, name,
        ANC_PV_GENESIS_PREPARATION_INDEX_BYTES,
        ANC_PV_GENESIS_PREPARATION_INDEX_BYTES, &frame);
    if (readStatus == AncFileReadStatusNotFound) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusNotFound;
      return;
    }
    if (readStatus != AncFileReadStatusOK ||
        !ValidateIndexFrame(frame, lookupId)) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusCorrupt;
      return;
    }
    if (ShouldFault(
            AncPrivateVaultGenesisPreparationArtifactFaultBeforeUnlink) ||
        unlinkat(self->_directoryDescriptor, name.UTF8String, 0) != 0 ||
        fsync(self->_directoryDescriptor) != 0) {
      status = AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed;
    }
  });
  return status;
}

@end
