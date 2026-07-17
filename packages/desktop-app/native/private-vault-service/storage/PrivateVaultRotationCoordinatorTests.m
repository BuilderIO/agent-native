#import <Foundation/Foundation.h>

#import "PrivateVaultAuthoritySnapshotInternal.h"
#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultControlLogInternal.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultCustodyRepository.h"
#import "PrivateVaultRecoveryWrapInternal.h"
#import "PrivateVaultRotationCoordinator.h"
#import "PrivateVaultRotationCoordinatorInternal.h"
#import "PrivateVaultRotationPreparationStore.h"
#import "PrivateVaultRotationPreparationStoreInternal.h"

#import <sodium.h>

#include <assert.h>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <stddef.h>
#include <stdatomic.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

/* The corpus enters on stdin and is erased before exit. No private material is
 * embedded in this source or in the checked-in JSON fixture. */

enum {
  kMaterialHeaderBytes = 152,
  kPendingKeyBytes = 32,
  kSpoolNonceBytes = 24,
  kMaterialChecksumBytes = 32,
  kMaximumSignedEntryBytes = 65536,
  kMaximumRecoveryWrapBytes = 1048576,
  kMaximumAlternateOuterBytes = 1114424,
};

typedef struct RotationMaterial {
  NSMutableData *stream;
  const uint8_t *vaultId;
  const uint8_t *ceremonyId;
  const uint8_t *endpointId;
  const uint8_t *brokerId;
  const uint8_t *pendingKey;
  const uint8_t *nonce;
  const uint8_t *signedEntry;
  size_t signedEntryLength;
  const uint8_t *recoveryWrap;
  size_t recoveryWrapLength;
  const uint8_t *alternateOuter;
  size_t alternateOuterLength;
} RotationMaterial;

typedef struct RotationKeyMaterial {
  uint8_t issuerSigningSeed[32];
  uint8_t issuerAgreementSeed[32];
  uint8_t recoveryAgreementSeed[32];
  uint8_t brokerSigningSeed[32];
  uint8_t brokerAgreementSeed[32];
  uint8_t issuerSigningPublic[32];
  uint8_t issuerAgreementPublic[32];
  uint8_t recoveryAgreementPublic[32];
  uint8_t brokerSigningPublic[32];
  uint8_t brokerAgreementPublic[32];
} RotationKeyMaterial;

typedef NS_ENUM(NSUInteger, RotationMutation) {
  RotationMutationNone = 0,
  RotationMutationStalePreparation,
  RotationMutationBaseDigest,
  RotationMutationBaseSequence,
  RotationMutationBaseHead,
  RotationMutationBaseMembership,
  RotationMutationBaseEpoch,
  RotationMutationBaseRecoveryGeneration,
  RotationMutationIdentity,
  RotationMutationSigningKey,
  RotationMutationAgreementKey,
  RotationMutationEnrollment,
  RotationMutationActiveKey,
  RotationMutationWrongSignedEntry,
  RotationMutationWrongRecoveryWrap,
  RotationMutationTranscript,
  RotationMutationCrossCeremony,
};

static NSMutableDictionary<NSString *, NSData *> *gKeychain;
static NSString *gKeychainPath;

static uint16_t ReadU16LE(const uint8_t *p) {
  return (uint16_t)p[0] | (uint16_t)p[1] << 8;
}

static uint32_t ReadU32LE(const uint8_t *p) {
  return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 |
         (uint32_t)p[3] << 24;
}

static uint64_t ReadU64LE(const uint8_t *p) {
  uint64_t value = 0;
  for (size_t index = 0; index < 8; index++)
    value |= (uint64_t)p[index] << (index * 8);
  return value;
}

static uint64_t ReadU64BE(const uint8_t *p) {
  uint64_t value = 0;
  for (size_t index = 0; index < 8; index++)
    value = (value << 8) | p[index];
  return value;
}

static BOOL ReadExact(int descriptor, uint8_t *bytes, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = read(descriptor, bytes + offset, length - offset);
    if (count <= 0)
      return NO;
    offset += (size_t)count;
  }
  return YES;
}

static BOOL WriteExact(int descriptor, const uint8_t *bytes, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = write(descriptor, bytes + offset, length - offset);
    if (count <= 0)
      return NO;
    offset += (size_t)count;
  }
  return YES;
}

static BOOL HashParts(const uint8_t *domain, size_t domainLength,
                      const uint8_t *payload, size_t payloadLength,
                      uint8_t output[32]) {
  crypto_generichash_state state;
  BOOL okay = crypto_generichash_init(&state, NULL, 0, 32) == 0 &&
              crypto_generichash_update(&state, domain, domainLength) == 0 &&
              crypto_generichash_update(&state, payload, payloadLength) == 0 &&
              crypto_generichash_final(&state, output, 32) == 0;
  sodium_memzero(&state, sizeof state);
  return okay;
}

static BOOL ReadMaterial(RotationMaterial *material) {
  material->stream = nil;
  material->vaultId = NULL;
  material->ceremonyId = NULL;
  material->endpointId = NULL;
  material->brokerId = NULL;
  material->pendingKey = NULL;
  material->nonce = NULL;
  material->signedEntry = NULL;
  material->signedEntryLength = 0;
  material->recoveryWrap = NULL;
  material->recoveryWrapLength = 0;
  material->alternateOuter = NULL;
  material->alternateOuterLength = 0;
  uint8_t header[kMaterialHeaderBytes];
  if (!ReadExact(STDIN_FILENO, header, sizeof header))
    return NO;
  uint64_t lengths[5];
  for (size_t index = 0; index < 5; index++)
    lengths[index] = ReadU64LE(header + 16 + index * 8);
  if (memcmp(header, "ANVRMS02", 8) != 0 || ReadU16LE(header + 8) != 2 ||
      ReadU16LE(header + 10) != 0 ||
      ReadU32LE(header + 12) != kMaterialHeaderBytes ||
      lengths[0] != kPendingKeyBytes || lengths[1] != kSpoolNonceBytes ||
      lengths[2] == 0 || lengths[2] > kMaximumSignedEntryBytes ||
      lengths[3] == 0 || lengths[3] > kMaximumRecoveryWrapBytes ||
      lengths[4] < 312 || lengths[4] > kMaximumAlternateOuterBytes) {
    anc_pv_zeroize(header, sizeof header);
    return NO;
  }
  uint64_t payloadLength = 0;
  for (size_t index = 0; index < 5; index++) {
    if (UINT64_MAX - payloadLength < lengths[index]) {
      anc_pv_zeroize(header, sizeof header);
      return NO;
    }
    payloadLength += lengths[index];
  }
  if (payloadLength > NSUIntegerMax - kMaterialHeaderBytes -
                          kMaterialChecksumBytes) {
    anc_pv_zeroize(header, sizeof header);
    return NO;
  }
  NSUInteger total = kMaterialHeaderBytes + (NSUInteger)payloadLength +
                     kMaterialChecksumBytes;
  NSMutableData *stream = [NSMutableData dataWithLength:total];
  memcpy(stream.mutableBytes, header, sizeof header);
  anc_pv_zeroize(header, sizeof header);
  if (!ReadExact(STDIN_FILENO,
                 (uint8_t *)stream.mutableBytes + kMaterialHeaderBytes,
                 total - kMaterialHeaderBytes)) {
    anc_pv_zeroize(stream.mutableBytes, stream.length);
    return NO;
  }
  uint8_t extra = 0;
  if (read(STDIN_FILENO, &extra, 1) != 0) {
    anc_pv_zeroize(stream.mutableBytes, stream.length);
    return NO;
  }
  static const uint8_t checksumDomain[] =
      "agent-native/private-vault/rotation-preparation-material-stream/anc-v1";
  uint8_t checksum[32] = {0};
  BOOL valid = HashParts(checksumDomain, sizeof checksumDomain, stream.bytes,
                         stream.length - 32, checksum) &&
               sodium_memcmp(checksum,
                             (const uint8_t *)stream.bytes + stream.length - 32,
                             32) == 0;
  anc_pv_zeroize(checksum, sizeof checksum);
  if (!valid) {
    anc_pv_zeroize(stream.mutableBytes, stream.length);
    return NO;
  }
  const uint8_t *bytes = stream.bytes;
  size_t offset = kMaterialHeaderBytes;
  material->stream = stream;
  material->vaultId = bytes + 56;
  material->ceremonyId = bytes + 72;
  material->endpointId = bytes + 88;
  material->brokerId = bytes + 104;
  material->pendingKey = bytes + offset;
  offset += (size_t)lengths[0];
  material->nonce = bytes + offset;
  offset += (size_t)lengths[1];
  material->signedEntry = bytes + offset;
  material->signedEntryLength = (size_t)lengths[2];
  offset += material->signedEntryLength;
  material->recoveryWrap = bytes + offset;
  material->recoveryWrapLength = (size_t)lengths[3];
  offset += material->recoveryWrapLength;
  material->alternateOuter = bytes + offset;
  material->alternateOuterLength = (size_t)lengths[4];
  return YES;
}

static void ClearMaterial(RotationMaterial *material) {
  if (material->stream != nil)
    anc_pv_zeroize(material->stream.mutableBytes, material->stream.length);
  material->stream = nil;
  material->vaultId = NULL;
  material->ceremonyId = NULL;
  material->endpointId = NULL;
  material->brokerId = NULL;
  material->pendingKey = NULL;
  material->nonce = NULL;
  material->signedEntry = NULL;
  material->signedEntryLength = 0;
  material->recoveryWrap = NULL;
  material->recoveryWrapLength = 0;
  material->alternateOuter = NULL;
  material->alternateOuterLength = 0;
}

static BOOL DeriveBytes(NSString *label, uint8_t *output, size_t length) {
  static const uint8_t domain[] =
      "agent-native/private-vault/rotation-preparation/test-derivation/anc-v1";
  NSData *labelBytes = [label dataUsingEncoding:NSUTF8StringEncoding];
  size_t cursor = 0;
  uint8_t counter = 0;
  while (cursor < length) {
    NSMutableData *input = [NSMutableData dataWithBytes:domain
                                                 length:sizeof domain];
    [input appendData:labelBytes];
    [input appendBytes:&counter length:1];
    uint8_t block[32] = {0};
    BOOL okay = anc_pv_blake2b_256(block, input.bytes, input.length) ==
                ANC_PV_CRYPTO_OK;
    anc_pv_zeroize(input.mutableBytes, input.length);
    if (!okay) {
      anc_pv_zeroize(block, sizeof block);
      anc_pv_zeroize(output, length);
      return NO;
    }
    size_t count = MIN(sizeof block, length - cursor);
    memcpy(output + cursor, block, count);
    anc_pv_zeroize(block, sizeof block);
    cursor += count;
    counter++;
  }
  return YES;
}

static BOOL DeriveKeys(RotationKeyMaterial *keys) {
  memset(keys, 0, sizeof *keys);
  uint8_t signingPrivate[64] = {0};
  uint8_t boxPrivate[32] = {0};
  BOOL okay =
      DeriveBytes(@"issuer-signing-seed", keys->issuerSigningSeed, 32) &&
      DeriveBytes(@"issuer-agreement-seed", keys->issuerAgreementSeed, 32) &&
      DeriveBytes(@"recovery-agreement-seed", keys->recoveryAgreementSeed,
                  32) &&
      DeriveBytes(@"broker-signing-seed", keys->brokerSigningSeed, 32) &&
      DeriveBytes(@"broker-agreement-seed", keys->brokerAgreementSeed, 32) &&
      anc_pv_ed25519_seed_keypair(keys->issuerSigningPublic, signingPrivate,
                                  keys->issuerSigningSeed) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
  if (okay)
    okay = anc_pv_box_seed_keypair(keys->issuerAgreementPublic, boxPrivate,
                                   keys->issuerAgreementSeed) ==
           ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(boxPrivate, sizeof boxPrivate);
  if (okay)
    okay = anc_pv_box_seed_keypair(keys->recoveryAgreementPublic, boxPrivate,
                                   keys->recoveryAgreementSeed) ==
           ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(boxPrivate, sizeof boxPrivate);
  if (okay)
    okay = anc_pv_ed25519_seed_keypair(keys->brokerSigningPublic,
                                       signingPrivate,
                                       keys->brokerSigningSeed) ==
           ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
  if (okay)
    okay = anc_pv_box_seed_keypair(keys->brokerAgreementPublic, boxPrivate,
                                   keys->brokerAgreementSeed) ==
           ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(boxPrivate, sizeof boxPrivate);
  if (!okay)
    anc_pv_zeroize(keys, sizeof *keys);
  return okay;
}

static NSString *HexBytes(const uint8_t *bytes, size_t length) {
  NSMutableString *value = [NSMutableString stringWithCapacity:length * 2];
  for (size_t index = 0; index < length; index++)
    [value appendFormat:@"%02x", bytes[index]];
  return value;
}

static NSData *Bytes(uint8_t value, size_t length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, value, length);
  return [data copy];
}

static NSString *KeychainKey(NSDictionary *query) {
  return [NSString
      stringWithFormat:@"%@|%@", query[(__bridge id)kSecAttrService],
                       query[(__bridge id)kSecAttrAccount]];
}

static BOOL RefreshMockKeychain(void) {
  NSData *encoded = [NSData dataWithContentsOfFile:gKeychainPath];
  if (encoded == nil) {
    gKeychain = [NSMutableDictionary dictionary];
    return YES;
  }
  id decoded = [NSPropertyListSerialization propertyListWithData:encoded
                                                          options:0
                                                           format:nil
                                                            error:nil];
  if (![decoded isKindOfClass:NSDictionary.class])
    return NO;
  gKeychain = [decoded mutableCopy];
  return YES;
}

static BOOL PersistMockKeychain(void) {
  NSData *encoded = [NSPropertyListSerialization
      dataWithPropertyList:gKeychain
                    format:NSPropertyListBinaryFormat_v1_0
                   options:0
                     error:nil];
  NSString *temporary = [gKeychainPath
      stringByAppendingFormat:@".%@.tmp", NSUUID.UUID.UUIDString];
  int descriptor = open(temporary.fileSystemRepresentation,
                        O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  BOOL okay = encoded != nil && descriptor >= 0;
  size_t offset = 0;
  while (okay && offset < encoded.length) {
    ssize_t count = write(descriptor,
                          (const uint8_t *)encoded.bytes + offset,
                          encoded.length - offset);
    if (count <= 0)
      okay = NO;
    else
      offset += (size_t)count;
  }
  if (okay)
    okay = fsync(descriptor) == 0;
  if (descriptor >= 0)
    close(descriptor);
  if (okay)
    okay = rename(temporary.fileSystemRepresentation,
                  gKeychainPath.fileSystemRepresentation) == 0;
  if (!okay)
    unlink(temporary.fileSystemRepresentation);
  NSString *directoryPath = gKeychainPath.stringByDeletingLastPathComponent;
  int directory = open(directoryPath.fileSystemRepresentation,
                       O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (okay)
    okay = directory >= 0 && fsync(directory) == 0;
  if (directory >= 0)
    close(directory);
  return okay;
}

static OSStatus MockCopy(CFDictionaryRef rawQuery, CFTypeRef *result) {
  if (!RefreshMockKeychain())
    return errSecIO;
  NSData *value = gKeychain[KeychainKey((__bridge NSDictionary *)rawQuery)];
  if (value == nil)
    return errSecItemNotFound;
  if (result != NULL)
    *result = CFBridgingRetain(
        [NSData dataWithBytes:value.bytes length:value.length]);
  return errSecSuccess;
}

static OSStatus MockAdd(CFDictionaryRef raw, CFTypeRef *result) {
  (void)result;
  if (!RefreshMockKeychain())
    return errSecIO;
  NSDictionary *attributes = (__bridge NSDictionary *)raw;
  NSString *key = KeychainKey(attributes);
  if (gKeychain[key] != nil)
    return errSecDuplicateItem;
  NSData *value = attributes[(__bridge id)kSecValueData];
  gKeychain[key] = [NSData dataWithBytes:value.bytes length:value.length];
  return PersistMockKeychain() ? errSecSuccess : errSecIO;
}

static OSStatus MockUpdate(CFDictionaryRef rawQuery,
                           CFDictionaryRef rawAttributes) {
  if (!RefreshMockKeychain())
    return errSecIO;
  NSString *key = KeychainKey((__bridge NSDictionary *)rawQuery);
  if (gKeychain[key] == nil)
    return errSecItemNotFound;
  NSData *value =
      ((__bridge NSDictionary *)rawAttributes)[(__bridge id)kSecValueData];
  gKeychain[key] = [NSData dataWithBytes:value.bytes length:value.length];
  return PersistMockKeychain() ? errSecSuccess : errSecIO;
}

static OSStatus MockDelete(CFDictionaryRef rawQuery) {
  if (!RefreshMockKeychain())
    return errSecIO;
  NSString *key = KeychainKey((__bridge NSDictionary *)rawQuery);
  if (gKeychain[key] == nil)
    return errSecItemNotFound;
  [gKeychain removeObjectForKey:key];
  return PersistMockKeychain() ? errSecSuccess : errSecIO;
}

static AncPrivateVaultKeychain *TestKeychain(void) {
  AncPrivateVaultSecItemFunctions functions = {
      .copyMatching = MockCopy,
      .add = MockAdd,
      .update = MockUpdate,
      .deleteItem = MockDelete,
  };
  return [[AncPrivateVaultKeychain alloc]
      initWithFunctions:functions
          contextFactory:^LAContext * {
            return [[LAContext alloc] init];
          }
           storageDomain:@"rotation-coordinator:test-keychain"];
}

static void SetId(uint8_t output[ANC_PV_CUSTODY_ID_BYTES], size_t *length,
                  NSString *value) {
  NSData *encoded = [value dataUsingEncoding:NSUTF8StringEncoding];
  assert(encoded.length > 0 && encoded.length <= ANC_PV_CUSTODY_ID_BYTES);
  memcpy(output, encoded.bytes, encoded.length);
  *length = encoded.length;
}

@interface AncPrivateVaultControlLogMember (CoordinatorTestConstruction)
@property(nonatomic, readwrite) NSString *endpointId;
@property(nonatomic, readwrite) NSString *role;
@property(nonatomic, readwrite) BOOL unattended;
@property(nonatomic, readwrite) NSData *signingPublicKey;
@property(nonatomic, readwrite) NSData *keyAgreementPublicKey;
@property(nonatomic, readwrite) NSString *enrollmentRef;
@end

@interface AncPrivateVaultControlLogState (CoordinatorTestConstruction)
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) uint64_t sequence;
@property(nonatomic, readwrite) NSData *headHash;
@property(nonatomic, readwrite) NSData *membershipHash;
@property(nonatomic, readwrite) NSString *signedAt;
@property(nonatomic, readwrite)
    NSArray<AncPrivateVaultControlLogMember *> *activeMembers;
@property(nonatomic, readwrite) NSArray<NSString *> *removedEndpointIds;
@property(nonatomic, readwrite) uint64_t epoch;
@property(nonatomic, readwrite) uint64_t recoveryGeneration;
@property(nonatomic, readwrite) NSString *recoveryId;
@property(nonatomic, readwrite) NSData *recoverySigningPublicKey;
@property(nonatomic, readwrite) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readwrite) NSData *recoveryWrapHash;
@property(nonatomic, readwrite) NSString *freshnessMode;
@end

@interface CoordinatorClock : NSObject <AncPrivateVaultTrustedClock>
@property(nonatomic) uint64_t milliseconds;
@property(nonatomic) BOOL fail;
@end

@implementation CoordinatorClock
- (BOOL)readNowMilliseconds:(uint64_t *)milliseconds {
  if (self.fail || milliseconds == NULL)
    return NO;
  *milliseconds = self.milliseconds;
  return YES;
}
@end

static AncPrivateVaultControlLogMember *Member(
    const uint8_t endpointId[16], NSString *role, BOOL unattended,
    const uint8_t signing[32], const uint8_t agreement[32],
    const uint8_t enrollment[16]) {
  AncPrivateVaultControlLogMember *member =
      [[AncPrivateVaultControlLogMember alloc] init];
  member.endpointId = HexBytes(endpointId, 16);
  member.role = role;
  member.unattended = unattended;
  member.signingPublicKey = [NSData dataWithBytes:signing length:32];
  member.keyAgreementPublicKey = [NSData dataWithBytes:agreement length:32];
  member.enrollmentRef = HexBytes(enrollment, 16);
  return member;
}

static AncPrivateVaultControlLogState *BaseState(
    const RotationMaterial *material, const RotationKeyMaterial *keys) {
  uint8_t endpointEnrollment[16], removedEndpoint[16], removedSigning[32],
      removedAgreement[32], removedEnrollment[16], brokerEnrollment[16],
      recoveryId[16];
  memset(endpointEnrollment, 0x44, sizeof endpointEnrollment);
  memset(removedEndpoint, 0x47, sizeof removedEndpoint);
  memset(removedSigning, 0x4b, sizeof removedSigning);
  memset(removedAgreement, 0x4c, sizeof removedAgreement);
  memset(removedEnrollment, 0x4d, sizeof removedEnrollment);
  memset(brokerEnrollment, 0x4a, sizeof brokerEnrollment);
  memset(recoveryId, 0x45, sizeof recoveryId);
  AncPrivateVaultControlLogState *state =
      [[AncPrivateVaultControlLogState alloc] init];
  state.vaultId = HexBytes(material->vaultId, 16);
  state.sequence = 19;
  state.headHash = Bytes(0x55, 32);
  state.membershipHash = Bytes(0x66, 32);
  state.signedAt = @"2024-07-18T10:00:01.000Z";
  state.activeMembers = @[
    Member(material->endpointId, @"endpoint", NO, keys->issuerSigningPublic,
           keys->issuerAgreementPublic, endpointEnrollment),
    Member(removedEndpoint, @"endpoint", NO, removedSigning, removedAgreement,
           removedEnrollment),
    Member(material->brokerId, @"broker", YES, keys->brokerSigningPublic,
           keys->brokerAgreementPublic, brokerEnrollment),
  ];
  state.removedEndpointIds = @[];
  state.epoch = 4;
  state.recoveryGeneration = 2;
  state.recoveryId = HexBytes(recoveryId, sizeof recoveryId);
  state.recoverySigningPublicKey = Bytes(0x67, 32);
  state.recoveryKeyAgreementPublicKey =
      [NSData dataWithBytes:keys->recoveryAgreementPublic length:32];
  state.recoveryWrapHash = Bytes(0x68, 32);
  state.freshnessMode = @"endpoint_witnessed";
  return state;
}

static NSString *AuthorityFileName(NSString *vaultId) {
  static const uint8_t domain[] =
      "anc/v1/private-vault/authority-store/vault-id";
  NSData *utf8 = [vaultId dataUsingEncoding:NSUTF8StringEncoding];
  uint8_t length[4] = {(uint8_t)(utf8.length >> 24),
                       (uint8_t)(utf8.length >> 16),
                       (uint8_t)(utf8.length >> 8), (uint8_t)utf8.length};
  NSMutableData *input = [NSMutableData dataWithBytes:domain
                                               length:sizeof domain];
  [input appendBytes:length length:sizeof length];
  [input appendData:utf8];
  uint8_t digest[32] = {0};
  assert(anc_pv_blake2b_256(digest, input.bytes, input.length) ==
         ANC_PV_CRYPTO_OK);
  NSString *name = [HexBytes(digest, sizeof digest)
      stringByAppendingString:@".authority"];
  anc_pv_zeroize(digest, sizeof digest);
  anc_pv_zeroize(input.mutableBytes, input.length);
  return name;
}

static NSString *SpoolFileName(const uint8_t vaultId[16],
                               const uint8_t ceremonyId[16]) {
  return [NSString stringWithFormat:@"%@%@.rotation-spool",
                                    HexBytes(vaultId, 16),
                                    HexBytes(ceremonyId, 16)];
}

@interface CoordinatorEnvironment : NSObject
@property(nonatomic) NSURL *rootURL;
@property(nonatomic) NSString *vaultId;
@property(nonatomic) AncPrivateVaultKeychain *keychain;
@property(nonatomic) AncPrivateVaultCustodyRepository *custody;
@property(nonatomic) AncPrivateVaultAuthorityStore *authority;
@property(nonatomic) AncPrivateVaultRotationPreparationStore *preparation;
@property(nonatomic) AncPrivateVaultRotationCoordinator *coordinator;
@property(nonatomic) CoordinatorClock *clock;
@property(nonatomic) AncPrivateVaultControlLogState *baseState;
@property(nonatomic) AncPrivateVaultControlLogState *successorState;
@property(nonatomic) AncPrivateVaultRotationPreparationCheckpoint *awaiting;
@property(nonatomic) NSString *spoolPath;
@end

@implementation CoordinatorEnvironment
@end

@interface CoordinatorPreparationStoreSubclass
    : AncPrivateVaultRotationPreparationStore
@end
@implementation CoordinatorPreparationStoreSubclass
@end
@interface CoordinatorAuthorityStoreSubclass : AncPrivateVaultAuthorityStore
@end
@implementation CoordinatorAuthorityStoreSubclass
@end
@interface CoordinatorCustodyRepositorySubclass
    : AncPrivateVaultCustodyRepository
@end
@implementation CoordinatorCustodyRepositorySubclass
@end
@interface CoordinatorControlLogSubclass : AncPrivateVaultControlLog
@end
@implementation CoordinatorControlLogSubclass
@end

static BOOL ApplyByteMutation(uint8_t *bytes, size_t length,
                              RotationMutation mutation,
                              RotationMutation target) {
  if (mutation != target)
    return NO;
  assert(length > 0);
  bytes[0] ^= 0x80;
  return YES;
}

static CoordinatorEnvironment *CreateEnvironmentAtRoot(
    const RotationMaterial *material, const RotationKeyMaterial *keys,
    RotationMutation mutation, NSString *requestedRoot) {
  CoordinatorEnvironment *environment = [[CoordinatorEnvironment alloc] init];
  NSString *root = requestedRoot ?: [NSTemporaryDirectory()
      stringByAppendingPathComponent:
          [NSString stringWithFormat:@"rotation-coordinator-%@",
                                     NSUUID.UUID.UUIDString]];
  environment.rootURL = [NSURL fileURLWithPath:root isDirectory:YES];
  if (![NSFileManager.defaultManager createDirectoryAtURL:environment.rootURL
                               withIntermediateDirectories:NO
                                                attributes:@{
                                                  NSFilePosixPermissions : @0700
                                                }
                                                     error:nil])
    { fprintf(stderr, "environment: root\n"); return nil; }

  gKeychainPath = [root stringByAppendingPathComponent:@"test-keychain.plist"];
  gKeychain = [NSMutableDictionary dictionary];
  if (!PersistMockKeychain())
    { fprintf(stderr, "environment: keychain\n"); return nil; }

  environment.vaultId = HexBytes(material->vaultId, 16);
  environment.keychain = TestKeychain();
  environment.custody = [[AncPrivateVaultCustodyRepository alloc]
      initWithKeychain:environment.keychain];
  AncPrivateVaultRotationPreparationSpoolStore *spool =
      [[AncPrivateVaultRotationPreparationSpoolStore alloc]
          initWithStateRootURL:environment.rootURL];
  environment.preparation = [[AncPrivateVaultRotationPreparationStore alloc]
      initWithKeychain:environment.keychain
                 spool:spool];

  environment.baseState = BaseState(material, keys);
  uint8_t ceremonyId[16];
  memcpy(ceremonyId, material->ceremonyId, sizeof ceremonyId);
  if (mutation == RotationMutationCrossCeremony)
    ceremonyId[0] ^= 0x80;
  AncPrivateVaultRecoveryWrapRotationVerifier *wrapVerifier =
      [[AncPrivateVaultRecoveryWrapRotationVerifier alloc]
          initWithEncodedWrap:[NSData dataWithBytes:material->recoveryWrap
                                             length:material->recoveryWrapLength]
              trustedNowMilliseconds:UINT64_C(1721296803000)];
  AncPrivateVaultControlLogReplayResult *replay = nil;
  AncPrivateVaultControlLogStatus replayStatus =
      [[AncPrivateVaultControlLog alloc]
          replaySignedEntry:[NSData dataWithBytes:material->signedEntry
                                           length:material->signedEntryLength]
               currentState:environment.baseState
                   verifier:wrapVerifier
                     result:&replay];
  if (replayStatus != AncPrivateVaultControlLogStatusOK || replay == nil ||
      replay.idempotent || !wrapVerifier.isVerified) {
    fprintf(stderr, "environment: replay status=%ld result=%d verified=%d\n",
            (long)replayStatus, replay != nil, wrapVerifier.isVerified);
    return nil;
  }
  environment.successorState = replay.state;

  const uint64_t verifiedAt = UINT64_C(1721296801000);
  AncPrivateVaultAuthoritySnapshot *baseSnapshot =
      AncPrivateVaultAuthoritySnapshotCreateFromVerifiedControlState(
          environment.baseState, 2, 1, @18, Bytes(0x54, 32), verifiedAt);
  AncPrivateVaultAuthoritySnapshotStatus snapshotStatus;
  NSData *canonical = AncPrivateVaultAuthoritySnapshotEncode(baseSnapshot,
                                                              &snapshotStatus);
  if (canonical == nil)
    { fprintf(stderr, "environment: canonical status=%ld\n",
              (long)snapshotStatus); return nil; }

  uint8_t localKey[32], activeKey[32], zeroKey[32] = {0};
  if (!DeriveBytes(@"coordinator-local-state-key", localKey,
                   sizeof localKey) ||
      !DeriveBytes(@"coordinator-active-epoch-key", activeKey,
                   sizeof activeKey)) {
    anc_pv_zeroize(localKey, sizeof localKey);
    anc_pv_zeroize(activeKey, sizeof activeKey);
    fprintf(stderr, "environment: derivation\n");
    return nil;
  }
  NSData *nonce = Bytes(0x5e, 24);
  NSData *frameDigest = nil;
  NSData *frame = AncPrivateVaultAuthorityFrameEncodeForTesting(
      canonical, environment.vaultId, 2,
      [NSData dataWithBytes:localKey length:sizeof localKey], nonce,
      &frameDigest);
  if (frame == nil || frameDigest.length != 32) {
    anc_pv_zeroize(localKey, sizeof localKey);
    anc_pv_zeroize(activeKey, sizeof activeKey);
    fprintf(stderr, "environment: frame\n");
    return nil;
  }

  AncPrivateVaultCustodySnapshot custody = {0};
  custody.record_version = ANC_PV_CUSTODY_VERSION;
  custody.authority_anchor_present = 1;
  custody.expected_edge_present = 1;
  custody.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  custody.role = ANC_PV_CUSTODY_ROLE_ENDPOINT;
  custody.pending_kind = ANC_PV_CUSTODY_PENDING_RECOVERY;
  custody.rotation_phase = ANC_PV_CUSTODY_ROTATION_AWAITING_CONTROL_COMMIT;
  custody.custody_generation = 2;
  SetId(custody.vault_id, &custody.vault_id_length, environment.vaultId);
  SetId(custody.endpoint_id, &custody.endpoint_id_length,
        HexBytes(material->endpointId, 16));
  SetId(custody.ceremony_id, &custody.ceremony_id_length,
        HexBytes(ceremonyId, sizeof ceremonyId));
  memcpy(custody.signing_public_key, keys->issuerSigningPublic, 32);
  memcpy(custody.box_public_key, keys->issuerAgreementPublic, 32);
  custody.active_epoch = 4;
  custody.pending_epoch = 5;
  custody.recovery_generation = 2;
  custody.anchored_sequence = 19;
  memset(custody.anchored_head, 0x55, 32);
  memset(custody.membership_digest, 0x66, 32);
  custody.signed_at_ms = verifiedAt;
  memcpy(custody.snapshot_digest, frameDigest.bytes, 32);
  custody.freshness_ms = verifiedAt;
  custody.expected_next_sequence = 20;
  memset(custody.expected_previous_head, 0x55, 32);
  memcpy(custody.pending_transcript_digest,
         environment.successorState.membershipHash.bytes, 32);

  AncPrivateVaultCustodySnapshot genesis = custody;
  genesis.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_ACTIVE;
  genesis.pending_kind = ANC_PV_CUSTODY_PENDING_NONE;
  genesis.rotation_phase = ANC_PV_CUSTODY_ROTATION_NONE;
  genesis.custody_generation = 1;
  memset(genesis.ceremony_id, 0, sizeof genesis.ceremony_id);
  genesis.ceremony_id_length = 0;
  genesis.pending_epoch = 0;
  genesis.expected_edge_present = 0;
  genesis.expected_next_sequence = 0;
  memset(genesis.expected_previous_head, 0,
         sizeof genesis.expected_previous_head);
  memset(genesis.pending_transcript_digest, 0,
         sizeof genesis.pending_transcript_digest);
  AncPrivateVaultCustodySecretInputs genesisSecrets = {
      .signing_seed = keys->issuerSigningSeed,
      .box_seed = keys->issuerAgreementSeed,
      .local_state_key = localKey,
      .active_epoch_key = activeKey,
      .pending_epoch_key = zeroKey,
  };
  AncPrivateVaultCustodyRepositoryStatus genesisStatus =
      [environment.custody storeSnapshot:&genesis
                                 secrets:&genesisSecrets
                                 vaultId:environment.vaultId];
  anc_pv_custody_snapshot_zero(&genesis);

  uint8_t custodyPendingKey[32];
  memcpy(custodyPendingKey, material->pendingKey, sizeof custodyPendingKey);
  if (mutation == RotationMutationActiveKey)
    custodyPendingKey[0] ^= 0x80;

  AncPrivateVaultCustodySecretInputs secrets = {
      .signing_seed = keys->issuerSigningSeed,
      .box_seed = keys->issuerAgreementSeed,
      .local_state_key = localKey,
      .active_epoch_key = zeroKey,
      .pending_epoch_key = custodyPendingKey,
  };
  AncPrivateVaultCustodyRepositoryStatus custodyStatus =
      [environment.custody storeSnapshot:&custody
                                 secrets:&secrets
                                 vaultId:environment.vaultId];
  anc_pv_zeroize(localKey, sizeof localKey);
  anc_pv_zeroize(activeKey, sizeof activeKey);
  anc_pv_zeroize(zeroKey, sizeof zeroKey);
  anc_pv_zeroize(custodyPendingKey, sizeof custodyPendingKey);
  anc_pv_custody_snapshot_zero(&custody);
  if (genesisStatus != AncPrivateVaultCustodyRepositoryStatusOK ||
      custodyStatus != AncPrivateVaultCustodyRepositoryStatusOK)
    { fprintf(stderr, "environment: custody genesis=%ld store=%ld\n",
              (long)genesisStatus, (long)custodyStatus); return nil; }

  NSString *authorityDirectory =
      [root stringByAppendingPathComponent:@"state/authority"];
  if (![NSFileManager.defaultManager
          createDirectoryAtPath:authorityDirectory
    withIntermediateDirectories:YES
                     attributes:@{NSFilePosixPermissions : @0700}
                          error:nil])
    { fprintf(stderr, "environment: authority directory\n"); return nil; }
  NSString *authorityPath = [authorityDirectory
      stringByAppendingPathComponent:AuthorityFileName(environment.vaultId)];
  if (![frame writeToFile:authorityPath atomically:NO] ||
      chmod(authorityPath.fileSystemRepresentation, 0600) != 0)
    { fprintf(stderr, "environment: authority write\n"); return nil; }
  environment.authority = [[AncPrivateVaultAuthorityStore alloc]
      initWithStateRootURL:environment.rootURL
         custodyRepository:environment.custody];
  AncPrivateVaultAuthorityCheckpoint *baseCheckpoint = nil;
  if ([environment.authority loadVaultId:environment.vaultId
                              checkpoint:&baseCheckpoint
                                   error:nil] !=
          AncPrivateVaultAuthorityStoreStatusOK ||
      baseCheckpoint.custodyGeneration != 2)
    { fprintf(stderr, "environment: authority load\n"); return nil; }

  AncPrivateVaultRotationPreparationSnapshot preparation = {0};
  preparation.phase = ANC_PV_ROTATION_PREPARATION_PHASE_PREPARED;
  preparation.role = ANC_PV_ROTATION_PREPARATION_ROLE_ENDPOINT;
  preparation.preparation_generation = 1;
  memcpy(preparation.vault_id, material->vaultId, 16);
  memcpy(preparation.endpoint_id, material->endpointId, 16);
  memcpy(preparation.ceremony_id, ceremonyId, sizeof ceremonyId);
  preparation.base_custody_generation = 2;
  memcpy(preparation.base_frame_digest, frameDigest.bytes, 32);
  preparation.base_sequence = 19;
  memset(preparation.base_head, 0x55, 32);
  memset(preparation.base_membership, 0x66, 32);
  preparation.base_epoch = 4;
  preparation.base_recovery_generation = 2;
  memcpy(preparation.signing_public_key, keys->issuerSigningPublic, 32);
  memcpy(preparation.agreement_public_key, keys->issuerAgreementPublic, 32);
  memset(preparation.enrollment_ref, 0x44, 16);
  preparation.pending_epoch = 5;

  if (mutation == RotationMutationStalePreparation)
    preparation.base_custody_generation = 3;
  ApplyByteMutation(preparation.base_frame_digest, 32, mutation,
                    RotationMutationBaseDigest);
  if (mutation == RotationMutationBaseSequence)
    preparation.base_sequence = 18;
  ApplyByteMutation(preparation.base_head, 32, mutation,
                    RotationMutationBaseHead);
  ApplyByteMutation(preparation.base_membership, 32, mutation,
                    RotationMutationBaseMembership);
  if (mutation == RotationMutationBaseEpoch)
    preparation.base_epoch = 3;
  if (mutation == RotationMutationBaseEpoch)
    preparation.pending_epoch = 4;
  if (mutation == RotationMutationBaseRecoveryGeneration)
    preparation.base_recovery_generation = 1;
  if (mutation == RotationMutationIdentity)
    preparation.endpoint_id[0] ^= 0x40;
  ApplyByteMutation(preparation.signing_public_key, 32, mutation,
                    RotationMutationSigningKey);
  ApplyByteMutation(preparation.agreement_public_key, 32, mutation,
                    RotationMutationAgreementKey);
  ApplyByteMutation(preparation.enrollment_ref, 16, mutation,
                    RotationMutationEnrollment);

  AncPrivateVaultRotationPreparationCheckpoint *checkpoint = nil;
  if ([environment.preparation createGenesisPrepared:&preparation
                                      pendingEpochKey:material->pendingKey
                                           checkpoint:&checkpoint] !=
      AncPrivateVaultRotationPreparationStoreStatusOK)
    { fprintf(stderr, "environment: preparation create\n"); return nil; }
  if ([environment.preparation markRewrappedVaultId:material->vaultId
                                 expectedCheckpoint:checkpoint
                                         checkpoint:&checkpoint] !=
      AncPrivateVaultRotationPreparationStoreStatusOK)
    { fprintf(stderr, "environment: preparation rewrap\n"); return nil; }
  if ([environment.preparation markAcknowledgedVaultId:material->vaultId
                                    expectedCheckpoint:checkpoint
                                            checkpoint:&checkpoint] !=
      AncPrivateVaultRotationPreparationStoreStatusOK)
    { fprintf(stderr, "environment: preparation acknowledge\n"); return nil; }
  AncPrivateVaultRotationPreparationCheckpoint *awaiting = nil;
  NSMutableData *signedEntry =
      [NSMutableData dataWithBytes:material->signedEntry
                           length:material->signedEntryLength];
  NSMutableData *recoveryWrap =
      [NSMutableData dataWithBytes:material->recoveryWrap
                           length:material->recoveryWrapLength];
  uint8_t transcript[32];
  memcpy(transcript, environment.successorState.membershipHash.bytes,
         sizeof transcript);
  if (mutation == RotationMutationWrongSignedEntry)
    ((uint8_t *)signedEntry.mutableBytes)[signedEntry.length - 1] ^= 0x80;
  if (mutation == RotationMutationWrongRecoveryWrap)
    ((uint8_t *)recoveryWrap.mutableBytes)[recoveryWrap.length - 1] ^= 0x80;
  if (mutation == RotationMutationTranscript)
    transcript[0] ^= 0x80;
  if ([environment.preparation
          armAwaitingControlCommitVaultId:material->vaultId
                        expectedCheckpoint:checkpoint
                          expectedSequence:preparation.base_sequence + 1
                      expectedPreviousHead:preparation.base_head
                          transcriptDigest:transcript
                               signedEntry:signedEntry.bytes
                         signedEntryLength:signedEntry.length
                              recoveryWrap:recoveryWrap.bytes
                        recoveryWrapLength:recoveryWrap.length
                                   nonce:material->nonce
                              checkpoint:&awaiting] !=
      AncPrivateVaultRotationPreparationStoreStatusOK)
    { fprintf(stderr, "environment: preparation arm\n"); return nil; }
  anc_pv_zeroize(signedEntry.mutableBytes, signedEntry.length);
  anc_pv_zeroize(recoveryWrap.mutableBytes, recoveryWrap.length);
  anc_pv_zeroize(transcript, sizeof transcript);
  environment.awaiting = awaiting;
  anc_pv_rotation_preparation_snapshot_zero(&preparation);

  environment.clock = [[CoordinatorClock alloc] init];
  environment.clock.milliseconds = UINT64_C(1721296803000);
  environment.coordinator = [[AncPrivateVaultRotationCoordinator alloc]
      initWithPreparationStore:environment.preparation
                authorityStore:environment.authority
             custodyRepository:environment.custody
                    controlLog:[[AncPrivateVaultControlLog alloc] init]
                  trustedClock:environment.clock];
  environment.spoolPath = [[[root stringByAppendingPathComponent:@"state"]
      stringByAppendingPathComponent:@"rotation-preparation"]
      stringByAppendingPathComponent:
          SpoolFileName(material->vaultId, ceremonyId)];
  anc_pv_zeroize(ceremonyId, sizeof ceremonyId);
  return environment;
}

static CoordinatorEnvironment *CreateEnvironment(
    const RotationMaterial *material, const RotationKeyMaterial *keys,
    RotationMutation mutation) {
  return CreateEnvironmentAtRoot(material, keys, mutation, nil);
}

static CoordinatorEnvironment *OpenExistingEnvironment(
    const RotationMaterial *material, const RotationKeyMaterial *keys,
    NSString *root) {
  CoordinatorEnvironment *environment = [[CoordinatorEnvironment alloc] init];
  environment.rootURL = [NSURL fileURLWithPath:root isDirectory:YES];
  environment.vaultId = HexBytes(material->vaultId, 16);
  gKeychainPath = [root stringByAppendingPathComponent:@"test-keychain.plist"];
  if (!RefreshMockKeychain())
    return nil;
  environment.keychain = TestKeychain();
  environment.custody = [[AncPrivateVaultCustodyRepository alloc]
      initWithKeychain:environment.keychain];
  AncPrivateVaultRotationPreparationSpoolStore *spool =
      [[AncPrivateVaultRotationPreparationSpoolStore alloc]
          initWithStateRootURL:environment.rootURL];
  environment.preparation = [[AncPrivateVaultRotationPreparationStore alloc]
      initWithKeychain:environment.keychain
                 spool:spool];
  environment.authority = [[AncPrivateVaultAuthorityStore alloc]
      initWithStateRootURL:environment.rootURL
         custodyRepository:environment.custody];
  environment.baseState = BaseState(material, keys);
  AncPrivateVaultRecoveryWrapRotationVerifier *wrapVerifier =
      [[AncPrivateVaultRecoveryWrapRotationVerifier alloc]
          initWithEncodedWrap:[NSData dataWithBytes:material->recoveryWrap
                                             length:material->recoveryWrapLength]
              trustedNowMilliseconds:UINT64_C(1721296803000)];
  AncPrivateVaultControlLogReplayResult *replay = nil;
  if ([[AncPrivateVaultControlLog alloc]
          replaySignedEntry:[NSData dataWithBytes:material->signedEntry
                                           length:material->signedEntryLength]
               currentState:environment.baseState
                   verifier:wrapVerifier
                     result:&replay] != AncPrivateVaultControlLogStatusOK ||
      replay == nil || replay.idempotent || !wrapVerifier.isVerified)
    return nil;
  environment.successorState = replay.state;
  environment.clock = [[CoordinatorClock alloc] init];
  environment.clock.milliseconds = UINT64_C(1721296803000);
  environment.coordinator = [[AncPrivateVaultRotationCoordinator alloc]
      initWithPreparationStore:environment.preparation
                authorityStore:environment.authority
             custodyRepository:environment.custody
                    controlLog:[[AncPrivateVaultControlLog alloc] init]
                  trustedClock:environment.clock];
  environment.spoolPath = [[[root stringByAppendingPathComponent:@"state"]
      stringByAppendingPathComponent:@"rotation-preparation"]
      stringByAppendingPathComponent:
          SpoolFileName(material->vaultId, material->ceremonyId)];
  return environment.coordinator == nil ? nil : environment;
}

static void DestroyEnvironment(CoordinatorEnvironment *environment) {
  if (environment != nil)
    assert([NSFileManager.defaultManager removeItemAtURL:environment.rootURL
                                                   error:nil]);
  gKeychain = nil;
  gKeychainPath = nil;
}

static void AssertAwaiting(const RotationMaterial *material,
                           CoordinatorEnvironment *environment) {
  AncPrivateVaultRotationPreparationCheckpoint *checkpoint = nil;
  assert([environment.preparation readVaultId:material->vaultId
                                   checkpoint:&checkpoint
                                       handle:nil] ==
         AncPrivateVaultRotationPreparationStoreStatusOK);
  assert(checkpoint.snapshot.phase ==
         ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT);
  assert([[NSFileManager defaultManager] fileExistsAtPath:environment.spoolPath]);
}

static void AssertCleaned(const RotationMaterial *material,
                          CoordinatorEnvironment *environment) {
  AncPrivateVaultRotationPreparationCheckpoint *checkpoint = nil;
  assert([environment.preparation readVaultId:material->vaultId
                                   checkpoint:&checkpoint
                                       handle:nil] ==
         AncPrivateVaultRotationPreparationStoreStatusOK);
  AncPrivateVaultRotationPreparationSnapshot snapshot = checkpoint.snapshot;
  assert(snapshot.phase == ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED);
  const uint8_t *cleared =
      (const uint8_t *)&snapshot +
      offsetof(AncPrivateVaultRotationPreparationSnapshot, pending_epoch);
  size_t clearedLength =
      sizeof snapshot -
      offsetof(AncPrivateVaultRotationPreparationSnapshot, pending_epoch);
  uint8_t zero[sizeof snapshot] = {0};
  assert(sodium_memcmp(cleared, zero, clearedLength) == 0);
  assert(![NSFileManager.defaultManager
      fileExistsAtPath:environment.spoolPath]);
  anc_pv_rotation_preparation_snapshot_zero(&snapshot);
  anc_pv_zeroize(zero, sizeof zero);
}

static NSData *AppendReceipt(NSString *vaultId, NSString *entryId,
                             uint64_t sequence, NSData *headHash,
                             NSData *recoveryWrapHash,
                             uint64_t recoveryWrapLength) {
  AncPrivateVaultCanonicalValue *root =
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue integer:1],
        @3 : [AncPrivateVaultCanonicalValue
                 text:@"control-log-rotation-append-receipt"],
        @4 : [AncPrivateVaultCanonicalValue text:vaultId],
        @5 : [AncPrivateVaultCanonicalValue text:entryId],
        @6 : [AncPrivateVaultCanonicalValue integer:(int64_t)sequence],
        @7 : [AncPrivateVaultCanonicalValue bytes:headHash],
        @8 : [AncPrivateVaultCanonicalValue bytes:recoveryWrapHash],
        @9 : [AncPrivateVaultCanonicalValue
                 integer:(int64_t)recoveryWrapLength],
      }];
  AncPrivateVaultCanonicalStatus status;
  NSData *encoded = AncPrivateVaultCanonicalEncode(root, &status);
  assert(encoded != nil &&
         AncPrivateVaultRotationAppendReceiptDecode(encoded) != nil);
  return encoded;
}

static AncPrivateVaultRotationCoordinatorResult *
ResumeSuccessfully(const RotationMaterial *material,
                   CoordinatorEnvironment *environment) {
  AncPrivateVaultRotationCoordinatorResult *result = nil;
  assert([environment.coordinator resumeVaultId:material->vaultId
                                         result:&result] ==
         AncPrivateVaultRotationCoordinatorStatusOK);
  assert(result != nil);
  return result;
}

static void AssertConsumed(const RotationMaterial *material,
                           CoordinatorEnvironment *environment,
                           AncPrivateVaultRotationCoordinatorResult *result,
                           NSData *originalSpool) {
  assert([result.vaultId isEqualToString:environment.vaultId]);
  assert(result.custodyGeneration == 3);
  assert(result.activeEpoch == 5);
  assert(result.sequence == 20);
  assert([result.headHash isEqualToData:environment.successorState.headHash]);
  assert([result.membershipHash
      isEqualToData:environment.successorState.membershipHash]);
  assert(result.recoveryGeneration == 2);
  assert([result.recoveryWrapHash
      isEqualToData:environment.successorState.recoveryWrapHash]);
  assert(result.authorityCheckpoint.custodyGeneration == 3);
  assert(result.preparationCheckpoint.snapshot.phase ==
         ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED);

  AncPrivateVaultRotationPreparationCheckpoint *preparation = nil;
  AncPrivateVaultRotationPreparationKeyHandle *preparationHandle = nil;
  assert([environment.preparation readVaultId:material->vaultId
                                   checkpoint:&preparation
                                       handle:&preparationHandle] ==
         AncPrivateVaultRotationPreparationStoreStatusOK);
  assert(preparation.snapshot.phase ==
         ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED);
  assert(preparation.snapshot.flags ==
         (ANC_PV_ROTATION_PREPARATION_FLAG_EDGE_BOUND |
          ANC_PV_ROTATION_PREPARATION_FLAG_SPOOL_DURABLE));
  assert(preparation.snapshot.signed_entry_length ==
         material->signedEntryLength);
  assert(preparation.snapshot.recovery_wrap_length ==
         material->recoveryWrapLength);
  assert(preparationHandle == nil);
  BOOL foundPersistedPreparation = NO;
  for (NSString *key in gKeychain) {
    if (![key hasPrefix:
                  [AncPrivateVaultRotationPreparationService
                      stringByAppendingString:@"|"]])
      continue;
    NSData *record = gKeychain[key];
    if (record.length != ANC_PV_ROTATION_PREPARATION_RECORD_BYTES)
      continue;
    AncPrivateVaultRotationPreparationSnapshot persisted;
    uint8_t persistedKey[32] = {0};
    AncPrivateVaultRotationPreparationStatus decode =
        anc_pv_rotation_preparation_record_decode(
            record.bytes, record.length, &persisted, persistedKey);
    if (decode == ANC_PV_ROTATION_PREPARATION_OK &&
        memcmp(persisted.vault_id, material->vaultId, 16) == 0) {
      uint8_t zero[32] = {0};
      assert(persisted.phase ==
             ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED);
      assert(sodium_memcmp(persistedKey, zero, 32) == 0);
      anc_pv_zeroize(zero, sizeof zero);
      foundPersistedPreparation = YES;
    }
    anc_pv_zeroize(persistedKey, sizeof persistedKey);
    anc_pv_rotation_preparation_snapshot_zero(&persisted);
  }
  assert(foundPersistedPreparation);

  AncPrivateVaultCustodySnapshot custody;
  AncPrivateVaultCustodyHandle *custodyHandle = nil;
  assert([environment.custody readVaultId:environment.vaultId
                                snapshot:&custody
                                  handle:&custodyHandle] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  assert(custody.custody_generation == 3 && custody.active_epoch == 5 &&
         custody.pending_epoch == 0 &&
         custody.rotation_phase == ANC_PV_CUSTODY_ROTATION_NONE &&
         custody.expected_edge_present == 0 &&
         custody.anchored_sequence == 20 &&
         memcmp(custody.anchored_head, environment.successorState.headHash.bytes,
                32) == 0 &&
         memcmp(custody.membership_digest,
                environment.successorState.membershipHash.bytes, 32) == 0 &&
         custody.recovery_generation == 2);
  __block BOOL secretsCorrect = NO;
  assert([custodyHandle
             borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
               uint8_t zero[32] = {0};
               secretsCorrect =
                   sodium_memcmp(secrets->active_epoch_key,
                                 material->pendingKey, 32) == 0 &&
                   sodium_memcmp(secrets->pending_epoch_key, zero, 32) == 0;
               anc_pv_zeroize(zero, sizeof zero);
               return secretsCorrect;
             }] == AncPrivateVaultCustodyRepositoryStatusOK);
  assert(secretsCorrect);
  assert([custodyHandle close] ==
         AncPrivateVaultCustodyRepositoryStatusOK);
  anc_pv_custody_snapshot_zero(&custody);

  NSData *retainedSpool =
      [NSData dataWithContentsOfFile:environment.spoolPath];
  assert(retainedSpool != nil && [retainedSpool isEqualToData:originalSpool]);
}

static void RunHappyPath(const RotationMaterial *material,
                         const RotationKeyMaterial *keys) {
  CoordinatorEnvironment *environment =
      CreateEnvironment(material, keys, RotationMutationNone);
  assert(environment != nil);
  NSData *spool = [NSData dataWithContentsOfFile:environment.spoolPath];
  assert(spool.length > 0);
  AncPrivateVaultRotationCoordinatorResult *first =
      ResumeSuccessfully(material, environment);
  AssertConsumed(material, environment, first, spool);

  BOOL immutable = NO;
  @try {
    [first setValue:@0 forKey:@"sequence"];
  } @catch (__unused NSException *exception) {
    immutable = YES;
  }
  assert(immutable);

  AncPrivateVaultRotationCoordinatorResult *retry =
      ResumeSuccessfully(material, environment);
  AssertConsumed(material, environment, retry, spool);
  assert(retry.preparationCheckpoint.fenceGeneration ==
         first.preparationCheckpoint.fenceGeneration);
  assert([retry.authorityCheckpoint.frameDigest
      isEqualToData:first.authorityCheckpoint.frameDigest]);
  DestroyEnvironment(environment);
}

static void RunHostedAppendCleanup(const RotationMaterial *material,
                                   const RotationKeyMaterial *keys) {
  CoordinatorEnvironment *environment =
      CreateEnvironment(material, keys, RotationMutationNone);
  assert(environment != nil);
  NSData *spool = [NSData dataWithContentsOfFile:environment.spoolPath];
  AncPrivateVaultRotationCoordinatorResult *consumed =
      ResumeSuccessfully(material, environment);
  AssertConsumed(material, environment, consumed, spool);
  uint64_t recoveryWrapLength =
      consumed.preparationCheckpoint.snapshot.recovery_wrap_length;
  assert(recoveryWrapLength > 0);
  NSString *entryId = AncPrivateVaultControlLogSignedEntryEnvelopeId(
      [NSData dataWithBytes:material->signedEntry
                     length:material->signedEntryLength]);
  assert(entryId.length > 0);
  NSData *receipt = AppendReceipt(
      consumed.vaultId, entryId, consumed.sequence, consumed.headHash,
      consumed.recoveryWrapHash, recoveryWrapLength);

  NSMutableData *wrongHead = [consumed.headHash mutableCopy];
  ((uint8_t *)wrongHead.mutableBytes)[0] ^= 0x80;
  assert([environment.coordinator
             finalizeHostedAppendVaultId:material->vaultId
                                  receipt:AppendReceipt(
                                              consumed.vaultId, entryId,
                                              consumed.sequence, wrongHead,
                                              consumed.recoveryWrapHash,
                                              recoveryWrapLength)
                                   result:nil] ==
         AncPrivateVaultRotationCoordinatorStatusConflict);
  assert([environment.coordinator
             finalizeHostedAppendVaultId:material->vaultId
                                  receipt:AppendReceipt(
                                              consumed.vaultId, entryId,
                                              consumed.sequence + 1,
                                              consumed.headHash,
                                              consumed.recoveryWrapHash,
                                              recoveryWrapLength)
                                   result:nil] ==
         AncPrivateVaultRotationCoordinatorStatusConflict);
  NSMutableData *wrongWrapHash = [consumed.recoveryWrapHash mutableCopy];
  ((uint8_t *)wrongWrapHash.mutableBytes)[0] ^= 0x40;
  assert([environment.coordinator
             finalizeHostedAppendVaultId:material->vaultId
                                  receipt:AppendReceipt(
                                              consumed.vaultId, entryId,
                                              consumed.sequence,
                                              consumed.headHash, wrongWrapHash,
                                              recoveryWrapLength)
                                   result:nil] ==
         AncPrivateVaultRotationCoordinatorStatusConflict);
  assert([environment.coordinator
             finalizeHostedAppendVaultId:material->vaultId
                                  receipt:AppendReceipt(
                                              consumed.vaultId, entryId,
                                              consumed.sequence,
                                              consumed.headHash,
                                              consumed.recoveryWrapHash,
                                              recoveryWrapLength + 1)
                                   result:nil] ==
         AncPrivateVaultRotationCoordinatorStatusConflict);
  assert([environment.coordinator
             finalizeHostedAppendVaultId:material->vaultId
                                  receipt:AppendReceipt(
                                              consumed.vaultId,
                                              @"entry:receipt-substitution",
                                              consumed.sequence,
                                              consumed.headHash,
                                              consumed.recoveryWrapHash,
                                              recoveryWrapLength)
                                   result:nil] ==
         AncPrivateVaultRotationCoordinatorStatusConflict);
  AssertConsumed(material, environment, consumed, spool);

  AncPrivateVaultRotationCoordinatorResult *cleaned = nil;
  AncPrivateVaultRotationCoordinatorStatus cleanupStatus =
      [environment.coordinator finalizeHostedAppendVaultId:material->vaultId
                                                   receipt:receipt
                                                    result:&cleaned];
  assert(cleanupStatus == AncPrivateVaultRotationCoordinatorStatusOK);
  assert(cleaned != nil && cleaned.sequence == consumed.sequence &&
         [cleaned.headHash isEqualToData:consumed.headHash]);
  AssertCleaned(material, environment);
  assert([environment.coordinator
             finalizeHostedAppendVaultId:material->vaultId
                                  receipt:receipt
                                   result:&cleaned] ==
         AncPrivateVaultRotationCoordinatorStatusOK);
  AssertCleaned(material, environment);
  DestroyEnvironment(environment);

  CoordinatorEnvironment *interrupted =
      CreateEnvironment(material, keys, RotationMutationNone);
  assert(interrupted != nil);
  AncPrivateVaultRotationCoordinatorResult *interruptedConsumed =
      ResumeSuccessfully(material, interrupted);
  uint64_t interruptedWrapLength = interruptedConsumed.preparationCheckpoint
                                       .snapshot.recovery_wrap_length;
  assert(interruptedWrapLength > 0);
  NSData *interruptedReceipt = AppendReceipt(
      interruptedConsumed.vaultId, entryId, interruptedConsumed.sequence,
      interruptedConsumed.headHash, interruptedConsumed.recoveryWrapHash,
      interruptedWrapLength);
  AncPrivateVaultRotationPreparationSetStoreFaultHookForTesting(
      ^BOOL(AncPrivateVaultRotationPreparationStoreFaultPoint point) {
        return point ==
               AncPrivateVaultRotationPreparationStoreFaultAfterSpoolDelete;
      });
  assert([interrupted.coordinator
             finalizeHostedAppendVaultId:material->vaultId
                                  receipt:interruptedReceipt
                                   result:nil] ==
         AncPrivateVaultRotationCoordinatorStatusStorageFailed);
  AncPrivateVaultRotationPreparationSetStoreFaultHookForTesting(nil);
  assert(![NSFileManager.defaultManager
      fileExistsAtPath:interrupted.spoolPath]);
  AncPrivateVaultRotationPreparationCheckpoint *stillConsumed = nil;
  assert([interrupted.preparation readVaultId:material->vaultId
                                   checkpoint:&stillConsumed
                                       handle:nil] ==
         AncPrivateVaultRotationPreparationStoreStatusOK);
  assert(stillConsumed.snapshot.phase ==
         ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED);
  assert([interrupted.coordinator
             finalizeHostedAppendVaultId:material->vaultId
                                  receipt:interruptedReceipt
                                   result:nil] ==
         AncPrivateVaultRotationCoordinatorStatusOK);
  AssertCleaned(material, interrupted);
  DestroyEnvironment(interrupted);

  CoordinatorEnvironment *fenced =
      CreateEnvironment(material, keys, RotationMutationNone);
  assert(fenced != nil);
  AncPrivateVaultRotationCoordinatorResult *fencedConsumed =
      ResumeSuccessfully(material, fenced);
  uint64_t fencedWrapLength =
      fencedConsumed.preparationCheckpoint.snapshot.recovery_wrap_length;
  NSData *fencedReceipt = AppendReceipt(
      fencedConsumed.vaultId, entryId, fencedConsumed.sequence,
      fencedConsumed.headHash, fencedConsumed.recoveryWrapHash,
      fencedWrapLength);
  AncPrivateVaultRotationPreparationSetStoreFaultHookForTesting(
      ^BOOL(AncPrivateVaultRotationPreparationStoreFaultPoint point) {
        return point ==
               AncPrivateVaultRotationPreparationStoreFaultAfterCleanupReceiptPersist;
      });
  assert([fenced.coordinator
             finalizeHostedAppendVaultId:material->vaultId
                                  receipt:fencedReceipt
                                   result:nil] ==
         AncPrivateVaultRotationCoordinatorStatusStorageFailed);
  AncPrivateVaultRotationPreparationSetStoreFaultHookForTesting(nil);
  assert([NSFileManager.defaultManager fileExistsAtPath:fenced.spoolPath]);
  NSData *persistedReceipt = nil;
  assert([fenced.keychain
             copyDataForService:AncPrivateVaultRotationCleanupReceiptService
                        vaultId:fenced.vaultId
                       recordId:@"rotation-cleanup-receipt"
                           data:&persistedReceipt] ==
         AncPrivateVaultKeychainStatusOK);
  assert([persistedReceipt isEqualToData:fencedReceipt]);
  assert([fenced.coordinator
             finalizeHostedAppendVaultId:material->vaultId
                                  receipt:fencedReceipt
                                   result:nil] ==
         AncPrivateVaultRotationCoordinatorStatusOK);
  AssertCleaned(material, fenced);
  DestroyEnvironment(fenced);

  CoordinatorEnvironment *missingBeforeAck =
      CreateEnvironment(material, keys, RotationMutationNone);
  assert(missingBeforeAck != nil);
  AncPrivateVaultRotationCoordinatorResult *missingConsumed =
      ResumeSuccessfully(material, missingBeforeAck);
  uint64_t missingWrapLength =
      missingConsumed.preparationCheckpoint.snapshot.recovery_wrap_length;
  NSData *missingReceipt = AppendReceipt(
      missingConsumed.vaultId, entryId, missingConsumed.sequence,
      missingConsumed.headHash, missingConsumed.recoveryWrapHash,
      missingWrapLength);
  assert([NSFileManager.defaultManager
      removeItemAtPath:missingBeforeAck.spoolPath
                 error:nil]);
  assert([missingBeforeAck.coordinator
             finalizeHostedAppendVaultId:material->vaultId
                                  receipt:missingReceipt
                                   result:nil] ==
         AncPrivateVaultRotationCoordinatorStatusRollbackDetected);
  DestroyEnvironment(missingBeforeAck);
}

static void RunCoordinatorCrashRetries(const RotationMaterial *material,
                                       const RotationKeyMaterial *keys) {
  const AncPrivateVaultRotationCoordinatorFaultPoint points[] = {
      AncPrivateVaultRotationCoordinatorFaultAfterArtifactAuthentication,
      AncPrivateVaultRotationCoordinatorFaultAfterAuthorityCommit,
      AncPrivateVaultRotationCoordinatorFaultBeforeOfficialReread,
      AncPrivateVaultRotationCoordinatorFaultBeforePreparationConsume,
  };
  for (size_t index = 0; index < sizeof points / sizeof points[0]; index++) {
    CoordinatorEnvironment *environment =
        CreateEnvironment(material, keys, RotationMutationNone);
    assert(environment != nil);
    NSData *spool = [NSData dataWithContentsOfFile:environment.spoolPath];
    AncPrivateVaultRotationCoordinatorFaultPoint target = points[index];
    AncPrivateVaultRotationCoordinatorSetFaultHookForTesting(
        ^BOOL(AncPrivateVaultRotationCoordinatorFaultPoint point) {
          return point == target;
        });
    assert([environment.coordinator resumeVaultId:material->vaultId
                                           result:nil] ==
           AncPrivateVaultRotationCoordinatorStatusStorageFailed);
    AncPrivateVaultRotationCoordinatorSetFaultHookForTesting(nil);
    AssertAwaiting(material, environment);

    AncPrivateVaultRotationCoordinator *restarted =
        [[AncPrivateVaultRotationCoordinator alloc]
            initWithPreparationStore:environment.preparation
                      authorityStore:environment.authority
                   custodyRepository:environment.custody
                          controlLog:[[AncPrivateVaultControlLog alloc] init]
                        trustedClock:environment.clock];
    environment.coordinator = restarted;
    AncPrivateVaultRotationCoordinatorResult *result =
        ResumeSuccessfully(material, environment);
    AssertConsumed(material, environment, result, spool);
    DestroyEnvironment(environment);
  }
}

static void RunAuthorityCrashRetries(const RotationMaterial *material,
                                     const RotationKeyMaterial *keys) {
  const AncPrivateVaultAuthorityFaultPoint points[] = {
      AncPrivateVaultAuthorityFaultAfterCustodyAdvance,
      AncPrivateVaultAuthorityFaultAfterLivePromote,
      AncPrivateVaultAuthorityFaultAfterLiveDirectoryFsync,
      AncPrivateVaultAuthorityFaultBeforeFinalReread,
  };
  for (size_t index = 0; index < sizeof points / sizeof points[0]; index++) {
    CoordinatorEnvironment *environment =
        CreateEnvironment(material, keys, RotationMutationNone);
    assert(environment != nil);
    NSData *spool = [NSData dataWithContentsOfFile:environment.spoolPath];
    AncPrivateVaultAuthorityFaultPoint target = points[index];
    AncPrivateVaultAuthoritySetFaultHookForTesting(
        ^BOOL(AncPrivateVaultAuthorityFaultPoint point) {
          return point == target;
        });
    assert([environment.coordinator resumeVaultId:material->vaultId
                                           result:nil] ==
           AncPrivateVaultRotationCoordinatorStatusStorageFailed);
    AncPrivateVaultAuthoritySetFaultHookForTesting(nil);
    AssertAwaiting(material, environment);
    NSString *livePath = [[[environment.rootURL path]
        stringByAppendingPathComponent:@"state/authority"]
        stringByAppendingPathComponent:AuthorityFileName(environment.vaultId)];
    NSData *liveFrame = [NSData dataWithContentsOfFile:livePath];
    assert(liveFrame.length >= ANC_PV_AUTHORITY_FRAME_HEADER_BYTES);
    assert(ReadU64BE((const uint8_t *)liveFrame.bytes + 12) ==
           (target == AncPrivateVaultAuthorityFaultAfterCustodyAdvance ? 2
                                                                       : 3));
    AncPrivateVaultAuthorityCheckpoint *intermediateAuthority = nil;
    assert([environment.authority loadVaultId:environment.vaultId
                                  checkpoint:&intermediateAuthority
                                       error:nil] ==
           AncPrivateVaultAuthorityStoreStatusOK);
    AncPrivateVaultCustodySnapshot intermediateCustody;
    AncPrivateVaultCustodyHandle *intermediateHandle = nil;
    assert([environment.custody readVaultId:environment.vaultId
                                  snapshot:&intermediateCustody
                                    handle:&intermediateHandle] ==
           AncPrivateVaultCustodyRepositoryStatusOK);
    assert(intermediateHandle != nil);
    assert(intermediateCustody.custody_generation == 3);
    assert(intermediateAuthority.custodyGeneration == 3);
    assert([intermediateHandle close] ==
           AncPrivateVaultCustodyRepositoryStatusOK);
    anc_pv_custody_snapshot_zero(&intermediateCustody);
    environment.authority = [[AncPrivateVaultAuthorityStore alloc]
        initWithStateRootURL:environment.rootURL
           custodyRepository:environment.custody];
    environment.coordinator = [[AncPrivateVaultRotationCoordinator alloc]
        initWithPreparationStore:environment.preparation
                  authorityStore:environment.authority
               custodyRepository:environment.custody
                      controlLog:[[AncPrivateVaultControlLog alloc] init]
                    trustedClock:environment.clock];
    AncPrivateVaultRotationCoordinatorResult *result =
        ResumeSuccessfully(material, environment);
    AssertConsumed(material, environment, result, spool);
    DestroyEnvironment(environment);
  }
}

static void RunRejectedInputs(const RotationMaterial *material,
                              const RotationKeyMaterial *keys) {
  const struct {
    RotationMutation mutation;
    AncPrivateVaultRotationCoordinatorStatus expected;
  } cases[] = {
      {RotationMutationStalePreparation,
       AncPrivateVaultRotationCoordinatorStatusConflict},
      {RotationMutationBaseDigest,
       AncPrivateVaultRotationCoordinatorStatusConflict},
      {RotationMutationBaseSequence,
       AncPrivateVaultRotationCoordinatorStatusConflict},
      {RotationMutationBaseHead,
       AncPrivateVaultRotationCoordinatorStatusConflict},
      {RotationMutationBaseMembership,
       AncPrivateVaultRotationCoordinatorStatusConflict},
      {RotationMutationBaseEpoch,
       AncPrivateVaultRotationCoordinatorStatusConflict},
      {RotationMutationBaseRecoveryGeneration,
       AncPrivateVaultRotationCoordinatorStatusConflict},
      {RotationMutationIdentity,
       AncPrivateVaultRotationCoordinatorStatusConflict},
      {RotationMutationSigningKey,
       AncPrivateVaultRotationCoordinatorStatusConflict},
      {RotationMutationAgreementKey,
       AncPrivateVaultRotationCoordinatorStatusConflict},
      {RotationMutationEnrollment,
       AncPrivateVaultRotationCoordinatorStatusConflict},
      {RotationMutationActiveKey,
       AncPrivateVaultRotationCoordinatorStatusConflict},
      {RotationMutationWrongSignedEntry,
       AncPrivateVaultRotationCoordinatorStatusControlRejected},
      {RotationMutationWrongRecoveryWrap,
       AncPrivateVaultRotationCoordinatorStatusControlRejected},
      {RotationMutationTranscript,
       AncPrivateVaultRotationCoordinatorStatusConflict},
      {RotationMutationCrossCeremony,
       AncPrivateVaultRotationCoordinatorStatusControlRejected},
  };
  for (size_t index = 0; index < sizeof cases / sizeof cases[0]; index++) {
    CoordinatorEnvironment *environment =
        CreateEnvironment(material, keys, cases[index].mutation);
    assert(environment != nil);
    AncPrivateVaultRotationCoordinatorStatus observed =
        [environment.coordinator resumeVaultId:material->vaultId result:nil];
    if (observed != cases[index].expected)
      fprintf(stderr,
              "rejection case=%zu mutation=%lu expected=%ld observed=%ld\n",
              index, (unsigned long)cases[index].mutation,
              (long)cases[index].expected, (long)observed);
    assert(observed == cases[index].expected);
    AssertAwaiting(material, environment);
    DestroyEnvironment(environment);
  }

  CoordinatorEnvironment *clockFailure =
      CreateEnvironment(material, keys, RotationMutationNone);
  assert(clockFailure != nil);
  clockFailure.clock.fail = YES;
  assert([clockFailure.coordinator resumeVaultId:material->vaultId
                                          result:nil] ==
         AncPrivateVaultRotationCoordinatorStatusClockFailed);
  AssertAwaiting(material, clockFailure);
  DestroyEnvironment(clockFailure);

  CoordinatorEnvironment *futureEntry =
      CreateEnvironment(material, keys, RotationMutationNone);
  assert(futureEntry != nil);
  futureEntry.clock.milliseconds = UINT64_C(1721296801500);
  assert([futureEntry.coordinator resumeVaultId:material->vaultId result:nil] ==
         AncPrivateVaultRotationCoordinatorStatusControlRejected);
  AssertAwaiting(material, futureEntry);
  DestroyEnvironment(futureEntry);
}

static void RunMissingSpool(const RotationMaterial *material,
                            const RotationKeyMaterial *keys) {
  CoordinatorEnvironment *environment =
      CreateEnvironment(material, keys, RotationMutationNone);
  assert(environment != nil);
  assert([NSFileManager.defaultManager removeItemAtPath:environment.spoolPath
                                                   error:nil]);
  assert([environment.coordinator resumeVaultId:material->vaultId result:nil] ==
         AncPrivateVaultRotationCoordinatorStatusRollbackDetected);
  DestroyEnvironment(environment);
}

static void RunCollaboratorSubclassRejection(
    const RotationMaterial *material, const RotationKeyMaterial *keys) {
  CoordinatorEnvironment *environment =
      CreateEnvironment(material, keys, RotationMutationNone);
  assert(environment != nil);
  AncPrivateVaultRotationPreparationSpoolStore *spool =
      [[AncPrivateVaultRotationPreparationSpoolStore alloc]
          initWithStateRootURL:environment.rootURL];
  CoordinatorPreparationStoreSubclass *preparation =
      [[CoordinatorPreparationStoreSubclass alloc]
          initWithKeychain:environment.keychain
                     spool:spool];
  CoordinatorAuthorityStoreSubclass *authority =
      [[CoordinatorAuthorityStoreSubclass alloc]
          initWithStateRootURL:environment.rootURL
             custodyRepository:environment.custody];
  CoordinatorCustodyRepositorySubclass *custody =
      [[CoordinatorCustodyRepositorySubclass alloc]
          initWithKeychain:environment.keychain];
  CoordinatorControlLogSubclass *control =
      [[CoordinatorControlLogSubclass alloc] init];
  assert([[AncPrivateVaultRotationCoordinator alloc]
             initWithPreparationStore:preparation
                       authorityStore:environment.authority
                    custodyRepository:environment.custody
                           controlLog:[[AncPrivateVaultControlLog alloc] init]] ==
         nil);
  assert([[AncPrivateVaultRotationCoordinator alloc]
             initWithPreparationStore:environment.preparation
                       authorityStore:authority
                    custodyRepository:environment.custody
                           controlLog:[[AncPrivateVaultControlLog alloc] init]] ==
         nil);
  assert([[AncPrivateVaultRotationCoordinator alloc]
             initWithPreparationStore:environment.preparation
                       authorityStore:environment.authority
                    custodyRepository:custody
                           controlLog:[[AncPrivateVaultControlLog alloc] init]] ==
         nil);
  assert([[AncPrivateVaultRotationCoordinator alloc]
             initWithPreparationStore:environment.preparation
                       authorityStore:environment.authority
                    custodyRepository:environment.custody
                           controlLog:control] == nil);
  DestroyEnvironment(environment);
}

static void RunConcurrentResume(const RotationMaterial *material,
                                const RotationKeyMaterial *keys) {
  CoordinatorEnvironment *environment =
      CreateEnvironment(material, keys, RotationMutationNone);
  assert(environment != nil);
  __block _Atomic int successes = 0;
  dispatch_group_t group = dispatch_group_create();
  dispatch_queue_t queue =
      dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);
  for (size_t index = 0; index < 16; index++) {
    dispatch_group_async(group, queue, ^{
      AncPrivateVaultRotationCoordinatorResult *result = nil;
      if ([environment.coordinator resumeVaultId:material->vaultId
                                           result:&result] ==
              AncPrivateVaultRotationCoordinatorStatusOK &&
          result != nil && result.custodyGeneration == 3 &&
          result.activeEpoch == 5 && result.sequence == 20)
        atomic_fetch_add(&successes, 1);
    });
  }
  assert(dispatch_group_wait(group, dispatch_time(DISPATCH_TIME_NOW,
                                                  30 * NSEC_PER_SEC)) == 0);
  assert(atomic_load(&successes) == 16);
  DestroyEnvironment(environment);
}

static void RunProcessDeathResume(const RotationMaterial *material,
                                  const RotationKeyMaterial *keys) {
  NSString *root = [NSTemporaryDirectory()
      stringByAppendingPathComponent:
          [NSString stringWithFormat:@"rotation-coordinator-process-death-%@",
                                     NSUUID.UUID.UUIDString]];
  NSString *executable = NSProcessInfo.processInfo.arguments.firstObject;
  assert(executable.length > 0 && executable.isAbsolutePath);
  int input[2] = {-1, -1};
  assert(pipe(input) == 0);
  posix_spawn_file_actions_t actions;
  assert(posix_spawn_file_actions_init(&actions) == 0);
  assert(posix_spawn_file_actions_adddup2(&actions, input[0], STDIN_FILENO) ==
         0);
  assert(posix_spawn_file_actions_addclose(&actions, input[0]) == 0);
  assert(posix_spawn_file_actions_addclose(&actions, input[1]) == 0);
  char *arguments[] = {(char *)executable.fileSystemRepresentation,
                       "--process-death-child",
                       (char *)root.fileSystemRepresentation, NULL};
  pid_t child = 0;
  assert(posix_spawn(&child, executable.fileSystemRepresentation, &actions,
                     NULL, arguments, environ) == 0);
  assert(posix_spawn_file_actions_destroy(&actions) == 0);
  close(input[0]);
  assert(WriteExact(input[1], material->stream.bytes,
                    material->stream.length));
  close(input[1]);
  int childStatus = 0;
  assert(waitpid(child, &childStatus, 0) == child);
  assert(WIFSIGNALED(childStatus) && WTERMSIG(childStatus) == SIGKILL);
  CoordinatorEnvironment *environment =
      OpenExistingEnvironment(material, keys, root);
  assert(environment != nil);
  NSData *spool = [NSData dataWithContentsOfFile:environment.spoolPath];
  assert(spool.length > 0);
  AncPrivateVaultRotationCoordinatorResult *result =
      ResumeSuccessfully(material, environment);
  AssertConsumed(material, environment, result, spool);
  DestroyEnvironment(environment);
}

static void RunProcessDeathCleanup(const RotationMaterial *material,
                                   const RotationKeyMaterial *keys) {
  NSString *root = [NSTemporaryDirectory()
      stringByAppendingPathComponent:
          [NSString stringWithFormat:@"rotation-cleanup-process-death-%@",
                                     NSUUID.UUID.UUIDString]];
  NSString *executable = NSProcessInfo.processInfo.arguments.firstObject;
  assert(executable.length > 0 && executable.isAbsolutePath);
  int input[2] = {-1, -1};
  assert(pipe(input) == 0);
  posix_spawn_file_actions_t actions;
  assert(posix_spawn_file_actions_init(&actions) == 0);
  assert(posix_spawn_file_actions_adddup2(&actions, input[0], STDIN_FILENO) ==
         0);
  assert(posix_spawn_file_actions_addclose(&actions, input[0]) == 0);
  assert(posix_spawn_file_actions_addclose(&actions, input[1]) == 0);
  char *arguments[] = {(char *)executable.fileSystemRepresentation,
                       "--cleanup-process-death-child",
                       (char *)root.fileSystemRepresentation, NULL};
  pid_t child = 0;
  assert(posix_spawn(&child, executable.fileSystemRepresentation, &actions,
                     NULL, arguments, environ) == 0);
  assert(posix_spawn_file_actions_destroy(&actions) == 0);
  close(input[0]);
  assert(WriteExact(input[1], material->stream.bytes,
                    material->stream.length));
  close(input[1]);
  int childStatus = 0;
  assert(waitpid(child, &childStatus, 0) == child);
  assert(WIFSIGNALED(childStatus) && WTERMSIG(childStatus) == SIGKILL);

  CoordinatorEnvironment *environment =
      OpenExistingEnvironment(material, keys, root);
  assert(environment != nil);
  assert(![NSFileManager.defaultManager
      fileExistsAtPath:environment.spoolPath]);
  AncPrivateVaultRotationPreparationCheckpoint *preparation = nil;
  assert([environment.preparation readVaultId:material->vaultId
                                   checkpoint:&preparation
                                       handle:nil] ==
         AncPrivateVaultRotationPreparationStoreStatusOK);
  assert(preparation.snapshot.phase ==
         ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED);
  assert(preparation.snapshot.recovery_wrap_length > 0);
  AncPrivateVaultAuthorityCheckpoint *authority = nil;
  assert([environment.authority loadVaultId:environment.vaultId
                                  checkpoint:&authority
                                       error:nil] ==
         AncPrivateVaultAuthorityStoreStatusOK);
  assert(authority != nil);
  NSString *entryId = AncPrivateVaultControlLogSignedEntryEnvelopeId(
      [NSData dataWithBytes:material->signedEntry
                     length:material->signedEntryLength]);
  NSData *receipt = AppendReceipt(
      environment.vaultId, entryId, authority.snapshot.sequence,
      authority.snapshot.headHash, authority.snapshot.recoveryWrapHash,
      preparation.snapshot.recovery_wrap_length);
  assert([environment.coordinator
             finalizeHostedAppendVaultId:material->vaultId
                                  receipt:receipt
                                   result:nil] ==
         AncPrivateVaultRotationCoordinatorStatusOK);
  AssertCleaned(material, environment);
  DestroyEnvironment(environment);
}

static void RunTamperedSpool(const RotationMaterial *material,
                             const RotationKeyMaterial *keys) {
  CoordinatorEnvironment *environment =
      CreateEnvironment(material, keys, RotationMutationNone);
  assert(environment != nil);
  NSData *alternate = [NSData dataWithBytes:material->alternateOuter
                                    length:material->alternateOuterLength];
  assert([alternate writeToFile:environment.spoolPath atomically:NO]);
  assert(chmod(environment.spoolPath.fileSystemRepresentation, 0600) == 0);
  AncPrivateVaultRotationCoordinatorStatus observed =
      [environment.coordinator resumeVaultId:material->vaultId result:nil];
  if (observed != AncPrivateVaultRotationCoordinatorStatusCorrupt)
    fprintf(stderr, "tampered spool expected=%ld observed=%ld\n",
            (long)AncPrivateVaultRotationCoordinatorStatusCorrupt,
            (long)observed);
  assert(observed == AncPrivateVaultRotationCoordinatorStatusCorrupt);
  BOOL stillAwaiting = NO;
  for (NSString *key in gKeychain) {
    if (![key hasPrefix:
                  [AncPrivateVaultRotationPreparationService
                      stringByAppendingString:@"|"]])
      continue;
    NSData *record = gKeychain[key];
    if (record.length != ANC_PV_ROTATION_PREPARATION_RECORD_BYTES)
      continue;
    AncPrivateVaultRotationPreparationSnapshot snapshot;
    uint8_t pendingKey[32] = {0};
    if (anc_pv_rotation_preparation_record_decode(
            record.bytes, record.length, &snapshot, pendingKey) ==
            ANC_PV_ROTATION_PREPARATION_OK &&
        memcmp(snapshot.vault_id, material->vaultId, 16) == 0) {
      stillAwaiting =
          snapshot.phase ==
              ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT &&
          sodium_memcmp(pendingKey, material->pendingKey, 32) == 0;
    }
    anc_pv_zeroize(pendingKey, sizeof pendingKey);
    anc_pv_rotation_preparation_snapshot_zero(&snapshot);
  }
  assert(stillAwaiting);
  assert([NSFileManager.defaultManager fileExistsAtPath:environment.spoolPath]);
  DestroyEnvironment(environment);
}

static int RunProcessDeathChild(NSString *root) {
  RotationMaterial material;
  RotationKeyMaterial keys;
  if (!ReadMaterial(&material) || !DeriveKeys(&keys))
    return 90;
  CoordinatorEnvironment *environment = CreateEnvironmentAtRoot(
      &material, &keys, RotationMutationNone, root);
  if (environment == nil)
    return 91;
  AncPrivateVaultRotationCoordinatorSetFaultHookForTesting(
      ^BOOL(AncPrivateVaultRotationCoordinatorFaultPoint point) {
        if (point ==
            AncPrivateVaultRotationCoordinatorFaultAfterAuthorityCommit)
          kill(getpid(), SIGKILL);
        return NO;
      });
  AncPrivateVaultRotationCoordinatorStatus observed =
      [environment.coordinator resumeVaultId:material.vaultId result:nil];
  return 100 + (int)observed;
}

static int RunCleanupProcessDeathChild(NSString *root) {
  RotationMaterial material;
  RotationKeyMaterial keys;
  if (!ReadMaterial(&material) || !DeriveKeys(&keys))
    return 90;
  CoordinatorEnvironment *environment = CreateEnvironmentAtRoot(
      &material, &keys, RotationMutationNone, root);
  if (environment == nil)
    return 91;
  AncPrivateVaultRotationCoordinatorResult *consumed =
      ResumeSuccessfully(&material, environment);
  uint64_t recoveryWrapLength =
      consumed.preparationCheckpoint.snapshot.recovery_wrap_length;
  if (recoveryWrapLength == 0)
    return 92;
  NSString *entryId = AncPrivateVaultControlLogSignedEntryEnvelopeId(
      [NSData dataWithBytes:material.signedEntry
                     length:material.signedEntryLength]);
  NSData *receipt = AppendReceipt(
      consumed.vaultId, entryId, consumed.sequence, consumed.headHash,
      consumed.recoveryWrapHash, recoveryWrapLength);
  if (receipt == nil)
    return 93;
  AncPrivateVaultRotationPreparationSetStoreFaultHookForTesting(
      ^BOOL(AncPrivateVaultRotationPreparationStoreFaultPoint point) {
        if (point ==
            AncPrivateVaultRotationPreparationStoreFaultAfterSpoolDelete)
          kill(getpid(), SIGKILL);
        return NO;
      });
  AncPrivateVaultRotationCoordinatorStatus observed =
      [environment.coordinator
          finalizeHostedAppendVaultId:material.vaultId
                               receipt:receipt
                                result:nil];
  return 100 + (int)observed;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    if (argc == 3 && strcmp(argv[1], "--process-death-child") == 0)
      return RunProcessDeathChild([NSString stringWithUTF8String:argv[2]]);
    if (argc == 3 &&
        strcmp(argv[1], "--cleanup-process-death-child") == 0)
      return RunCleanupProcessDeathChild(
          [NSString stringWithUTF8String:argv[2]]);
    assert(argc == 1);
    RotationMaterial material;
    RotationKeyMaterial keys;
    assert(ReadMaterial(&material));
    assert(DeriveKeys(&keys));
    RunHappyPath(&material, &keys);
    RunHostedAppendCleanup(&material, &keys);
    RunCoordinatorCrashRetries(&material, &keys);
    RunAuthorityCrashRetries(&material, &keys);
    RunRejectedInputs(&material, &keys);
    RunTamperedSpool(&material, &keys);
    RunMissingSpool(&material, &keys);
    RunCollaboratorSubclassRejection(&material, &keys);
    RunConcurrentResume(&material, &keys);
    RunProcessDeathResume(&material, &keys);
    RunProcessDeathCleanup(&material, &keys);
    AncPrivateVaultRotationCoordinatorSetFaultHookForTesting(nil);
    AncPrivateVaultAuthoritySetFaultHookForTesting(nil);
    AncPrivateVaultRotationPreparationSetStoreFaultHookForTesting(nil);
    anc_pv_zeroize(&keys, sizeof keys);
    ClearMaterial(&material);
    puts("Private Vault rotation coordinator tests passed");
  }
  return 0;
}
