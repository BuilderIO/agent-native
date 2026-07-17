#import <Foundation/Foundation.h>

#import "PrivateVaultCrypto.h"
#import "PrivateVaultRotationPreparationSpool.h"

#import <sodium.h>

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

enum {
  kMaterialAlternateOuterMinimumBytes = 312,
  kMaterialAlternateOuterMaximumBytes =
      108 + 124 + ANC_PV_ROTATION_SIGNED_ENTRY_MAX_BYTES +
      ANC_PV_ROTATION_RECOVERY_WRAP_MAX_BYTES + 32 + ANC_PV_AUTH_BYTES + 32,
};
_Static_assert(kMaterialAlternateOuterMaximumBytes == 1114424,
               "ANVRMS02 alternate outer maximum changed");

static BOOL MaterialAlternateOuterLengthAllowed(uint64_t length) {
  return length >= kMaterialAlternateOuterMinimumBytes &&
         length <= kMaterialAlternateOuterMaximumBytes;
}

static uint64_t ReadU64LE(const uint8_t *p) {
  uint64_t value = 0;
  for (size_t i = 0; i < 8; i++)
    value |= (uint64_t)p[i] << (8 * i);
  return value;
}

static uint16_t ReadU16LE(const uint8_t *p) {
  return (uint16_t)p[0] | (uint16_t)p[1] << 8;
}

static uint32_t ReadU32LE(const uint8_t *p) {
  return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 |
         (uint32_t)p[3] << 24;
}

static void WriteU16LE(uint8_t *p, uint16_t value) {
  p[0] = (uint8_t)value;
  p[1] = (uint8_t)(value >> 8);
}

static void WriteU64LE(uint8_t *p, uint64_t value) {
  for (size_t i = 0; i < 8; i++)
    p[i] = (uint8_t)(value >> (8 * i));
}

static BOOL HashParts(const uint8_t *domain, size_t domainLength,
                      const uint8_t *first, size_t firstLength,
                      const uint8_t *second, size_t secondLength,
                      const uint8_t *third, size_t thirdLength,
                      uint8_t output[32]) {
  crypto_generichash_state state;
  BOOL okay = crypto_generichash_init(&state, NULL, 0, 32) == 0 &&
              (domainLength == 0 ||
               crypto_generichash_update(&state, domain, domainLength) == 0) &&
              (firstLength == 0 ||
               crypto_generichash_update(&state, first, firstLength) == 0) &&
              (secondLength == 0 ||
               crypto_generichash_update(&state, second, secondLength) == 0) &&
              (thirdLength == 0 ||
               crypto_generichash_update(&state, third, thirdLength) == 0) &&
              crypto_generichash_final(&state, output, 32) == 0;
  sodium_memzero(&state, sizeof state);
  return okay;
}

static NSData *Hex(NSString *value) {
  if (value.length % 2 != 0)
    return nil;
  NSMutableData *data = [NSMutableData dataWithLength:value.length / 2];
  uint8_t *bytes = data.mutableBytes;
  for (NSUInteger index = 0; index < value.length; index += 2) {
    unsigned int byte = 0;
    NSScanner *scanner = [NSScanner
        scannerWithString:[value substringWithRange:NSMakeRange(index, 2)]];
    if (![scanner scanHexInt:&byte] || !scanner.isAtEnd)
      return nil;
    bytes[index / 2] = (uint8_t)byte;
  }
  return data;
}

static BOOL ReadExact(int fd, uint8_t *output, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = read(fd, output + offset, length - offset);
    if (count <= 0)
      return NO;
    offset += (size_t)count;
  }
  return YES;
}

static BOOL ValidateMaterialStream(NSData *stream) {
  static const size_t headerLength = 152;
  if (stream.length < headerLength + 32)
    return NO;
  const uint8_t *header = stream.bytes;
  if (memcmp(header, "ANVRMS02", 8) != 0 || ReadU16LE(header + 8) != 2 ||
      ReadU16LE(header + 10) != 0 || ReadU32LE(header + 12) != headerLength)
    return NO;
  uint64_t lengths[5];
  for (size_t index = 0; index < 5; index++)
    lengths[index] = ReadU64LE(header + 16 + index * 8);
  if (lengths[0] != 32 || lengths[1] != 24 || lengths[2] == 0 ||
      lengths[2] > 65536 || lengths[3] == 0 || lengths[3] > 1048576 ||
      !MaterialAlternateOuterLengthAllowed(lengths[4]))
    return NO;
  uint64_t payloadLength = 0;
  for (size_t index = 0; index < 5; index++) {
    if (UINT64_MAX - payloadLength < lengths[index])
      return NO;
    payloadLength += lengths[index];
  }
  if (payloadLength > NSUIntegerMax - headerLength - 32)
    return NO;
  NSUInteger total = headerLength + (NSUInteger)payloadLength + 32;
  if (stream.length != total)
    return NO;
  static const uint8_t domain[] =
      "agent-native/private-vault/rotation-preparation-material-stream/anc-v1";
  uint8_t checksum[32] = {0};
  BOOL okay =
      HashParts(domain, sizeof domain, stream.bytes, total - 32, NULL, 0, NULL,
                0, checksum) &&
      sodium_memcmp(checksum, (const uint8_t *)stream.bytes + total - 32,
                    sizeof checksum) == 0;
  sodium_memzero(checksum, sizeof checksum);
  return okay;
}

static NSMutableData *ReadMaterialStream(void) {
  enum { headerLength = 152 };
  uint8_t header[headerLength];
  if (!ReadExact(STDIN_FILENO, header, sizeof header))
    return nil;
  uint64_t signedLength = ReadU64LE(header + 32);
  uint64_t wrapLength = ReadU64LE(header + 40);
  uint64_t alternateOuterLength = ReadU64LE(header + 48);
  if (memcmp(header, "ANVRMS02", 8) != 0 || ReadU16LE(header + 8) != 2 ||
      ReadU16LE(header + 10) != 0 || ReadU32LE(header + 12) != headerLength ||
      ReadU64LE(header + 16) != 32 || ReadU64LE(header + 24) != 24 ||
      signedLength == 0 || signedLength > 65536 || wrapLength == 0 ||
      wrapLength > 1048576 ||
      !MaterialAlternateOuterLengthAllowed(alternateOuterLength)) {
    sodium_memzero(header, sizeof header);
    return nil;
  }
  NSUInteger total = headerLength + 32 + 24 + (NSUInteger)signedLength +
                     (NSUInteger)wrapLength + (NSUInteger)alternateOuterLength +
                     32;
  NSMutableData *stream = [NSMutableData dataWithLength:total];
  memcpy(stream.mutableBytes, header, headerLength);
  sodium_memzero(header, sizeof header);
  if (!ReadExact(STDIN_FILENO, (uint8_t *)stream.mutableBytes + headerLength,
                 total - headerLength)) {
    anc_pv_zeroize(stream.mutableBytes, stream.length);
    return nil;
  }
  uint8_t extra = 0;
  if (read(STDIN_FILENO, &extra, 1) != 0) {
    anc_pv_zeroize(stream.mutableBytes, stream.length);
    return nil;
  }
  if (!ValidateMaterialStream(stream)) {
    anc_pv_zeroize(stream.mutableBytes, stream.length);
    return nil;
  }
  return stream;
}

static NSMutableData *
BuildInner(const uint8_t *signedEntry, size_t signedEntryLength,
           const uint8_t *recoveryWrap, size_t recoveryWrapLength,
           const uint8_t vault[16], const uint8_t ceremony[16]) {
  NSUInteger length = 124 + signedEntryLength + recoveryWrapLength + 32;
  NSMutableData *inner = [NSMutableData dataWithLength:length];
  uint8_t *bytes = inner.mutableBytes;
  memcpy(bytes, "ANVROT01", 8);
  WriteU16LE(bytes + 8, 1);
  WriteU64LE(bytes + 12, signedEntryLength);
  WriteU64LE(bytes + 20, recoveryWrapLength);
  memcpy(bytes + 28, vault, 16);
  memcpy(bytes + 44, ceremony, 16);
  if (!HashParts(NULL, 0, signedEntry, signedEntryLength, NULL, 0, NULL, 0,
                 bytes + 60) ||
      !HashParts(NULL, 0, recoveryWrap, recoveryWrapLength, NULL, 0, NULL, 0,
                 bytes + 92))
    return nil;
  memcpy(bytes + 124, signedEntry, signedEntryLength);
  memcpy(bytes + 124 + signedEntryLength, recoveryWrap, recoveryWrapLength);
  static const uint8_t domain[] =
      "agent-native/private-vault/rotation-preparation-artifacts/anc-v1";
  if (!HashParts(domain, sizeof domain, bytes, length - 32, NULL, 0, NULL, 0,
                 bytes + length - 32))
    return nil;
  return inner;
}

static NSMutableData *BuildOuter(NSData *inner, const uint8_t vault[16],
                                 const uint8_t ceremony[16],
                                 const uint8_t nonce[24],
                                 const uint8_t pendingKey[32],
                                 uint8_t frameDigest[32], uint8_t keyOut[32]) {
  NSUInteger length = 108 + inner.length + 16 + 32;
  NSMutableData *outer = [NSMutableData dataWithLength:length];
  uint8_t *bytes = outer.mutableBytes;
  memcpy(bytes, "ANVROTE1", 8);
  WriteU16LE(bytes + 8, 1);
  WriteU64LE(bytes + 12, inner.length);
  memcpy(bytes + 20, vault, 16);
  memcpy(bytes + 36, ceremony, 16);
  memcpy(bytes + 52, nonce, 24);
  if (!HashParts(NULL, 0, inner.bytes, inner.length, NULL, 0, NULL, 0,
                 bytes + 76))
    return nil;
  static const uint8_t keyDomain[] =
      "agent-native/private-vault/rotation-preparation-spool-key/anc-v1";
  if (!HashParts(keyDomain, sizeof keyDomain, pendingKey, 32, vault, 16,
                 ceremony, 16, keyOut))
    return nil;
  size_t written = 0;
  if (anc_pv_xchacha20poly1305_encrypt(bytes + 108, inner.length + 16, &written,
                                       inner.bytes, inner.length, bytes, 108,
                                       nonce, keyOut) != ANC_PV_CRYPTO_OK ||
      written != inner.length + 16)
    return nil;
  static const uint8_t checksumDomain[] =
      "agent-native/private-vault/rotation-preparation-spool-checksum/anc-v1";
  if (!HashParts(checksumDomain, sizeof checksumDomain, bytes, length - 32,
                 NULL, 0, NULL, 0, bytes + length - 32))
    return nil;
  static const uint8_t digestDomain[] =
      "agent-native/private-vault/rotation-preparation-spool-frame/anc-v1";
  if (!HashParts(digestDomain, sizeof digestDomain, bytes, length, NULL, 0,
                 NULL, 0, frameDigest))
    return nil;
  return outer;
}

static BOOL CommitmentMatches(const void *bytes, size_t length,
                              NSString *expectedHex) {
  uint8_t digest[32] = {0};
  BOOL okay = HashParts(NULL, 0, bytes, length, NULL, 0, NULL, 0, digest) &&
              [Hex(expectedHex) isEqualToData:[NSData dataWithBytes:digest
                                                             length:32]];
  anc_pv_zeroize(digest, sizeof digest);
  return okay;
}

static BOOL ApplyMutation(NSMutableData *data, NSDictionary *mutation) {
  NSString *op = mutation[@"op"];
  NSInteger offset = [mutation[@"offset"] integerValue];
  if (offset < 0)
    offset = (NSInteger)data.length + offset;
  if ([op isEqualToString:@"flip"] && offset >= 0 &&
      (NSUInteger)offset < data.length) {
    ((uint8_t *)data.mutableBytes)[offset] ^= 1;
    return YES;
  }
  if ([op isEqualToString:@"set_u8"] && offset >= 0 &&
      (NSUInteger)offset < data.length) {
    ((uint8_t *)data.mutableBytes)[offset] =
        [mutation[@"value"] unsignedCharValue];
    return YES;
  }
  if ([op isEqualToString:@"set_u16"] && offset >= 0 &&
      (NSUInteger)offset + 2 <= data.length) {
    WriteU16LE((uint8_t *)data.mutableBytes + offset,
               [mutation[@"value"] unsignedShortValue]);
    return YES;
  }
  if ([op isEqualToString:@"set_u64"] && offset >= 0 &&
      (NSUInteger)offset + 8 <= data.length) {
    WriteU64LE((uint8_t *)data.mutableBytes + offset,
               [mutation[@"value"] unsignedLongLongValue]);
    return YES;
  }
  if ([op isEqualToString:@"truncate"]) {
    NSUInteger count = [mutation[@"bytes"] unsignedIntegerValue];
    if (count > data.length)
      return NO;
    data.length -= count;
    return YES;
  }
  if ([op isEqualToString:@"append"]) {
    NSData *suffix = Hex(mutation[@"hex"]);
    if (suffix == nil)
      return NO;
    [data appendData:suffix];
    return YES;
  }
  return NO;
}

static BOOL RepairChecksum(NSMutableData *data, const uint8_t *domain,
                           size_t domainLength) {
  return data.length >= 32 &&
         HashParts(domain, domainLength, data.bytes, data.length - 32, NULL, 0,
                   NULL, 0, (uint8_t *)data.mutableBytes + data.length - 32);
}

static void ClearMutable(NSData *data) {
  if ([data isKindOfClass:NSMutableData.class])
    anc_pv_zeroize(((NSMutableData *)data).mutableBytes, data.length);
}

static BOOL MalformedMaterialStreamsAreRejected(NSData *valid) {
  NSMutableArray<NSMutableData *> *cases = [NSMutableArray array];
  NSArray<NSNumber *> *byteOffsets = @[ @0, @8, @10, @12 ];
  for (NSNumber *value in byteOffsets) {
    NSMutableData *mutated = [valid mutableCopy];
    ((uint8_t *)mutated.mutableBytes)[value.unsignedIntegerValue] ^= 1;
    [cases addObject:mutated];
  }
  for (NSUInteger offset = 16; offset <= 48; offset += 8) {
    NSMutableData *zero = [valid mutableCopy];
    WriteU64LE((uint8_t *)zero.mutableBytes + offset, 0);
    [cases addObject:zero];
    NSMutableData *huge = [valid mutableCopy];
    WriteU64LE((uint8_t *)huge.mutableBytes + offset, UINT64_MAX);
    [cases addObject:huge];
  }
  NSMutableData *alternateOuterOverMaximum = [valid mutableCopy];
  WriteU64LE((uint8_t *)alternateOuterOverMaximum.mutableBytes + 48,
             (uint64_t)kMaterialAlternateOuterMaximumBytes + 1);
  [cases addObject:alternateOuterOverMaximum];
  NSMutableData *truncated = [valid mutableCopy];
  truncated.length -= 1;
  [cases addObject:truncated];
  NSMutableData *extra = [valid mutableCopy];
  uint8_t extraByte = 0;
  [extra appendBytes:&extraByte length:1];
  [cases addObject:extra];
  NSMutableData *checksum = [valid mutableCopy];
  ((uint8_t *)checksum.mutableBytes)[checksum.length - 1] ^= 1;
  [cases addObject:checksum];
  BOOL okay = YES;
  for (NSMutableData *testCase in cases) {
    okay = !ValidateMaterialStream(testCase) && okay;
    anc_pv_zeroize(testCase.mutableBytes, testCase.length);
  }
  return okay;
}

static BOOL RunFixtureParity(NSDictionary *fixture) {
  NSMutableData *stream = ReadMaterialStream();
  if (stream == nil ||
      ![fixture[@"schema"]
          isEqualToString:@"anc/v1-native-rotation-preparation-vectors@2"] ||
      [fixture[@"materialStreamLayout"][@"alternateOuterMaxBytes"]
          unsignedLongLongValue] != kMaterialAlternateOuterMaximumBytes ||
      !MalformedMaterialStreamsAreRejected(stream)) {
    ClearMutable(stream);
    return NO;
  }
  const uint8_t *streamBytes = stream.bytes;
  size_t signedEntryLength = (size_t)ReadU64LE(streamBytes + 32);
  size_t recoveryWrapLength = (size_t)ReadU64LE(streamBytes + 40);
  size_t alternateOuterLength = (size_t)ReadU64LE(streamBytes + 48);
  const uint8_t *pending = streamBytes + 152;
  const uint8_t *nonce = pending + 32;
  const uint8_t *signedEntry = nonce + 24;
  const uint8_t *recoveryWrap = signedEntry + signedEntryLength;
  const uint8_t *alternateOuterBytes = recoveryWrap + recoveryWrapLength;
  const uint8_t *vault = streamBytes + 56;
  const uint8_t *ceremony = streamBytes + 72;
  const uint8_t *alternateVault = streamBytes + 120;
  const uint8_t *alternateCeremony = streamBytes + 136;
  NSMutableData *inner =
      BuildInner(signedEntry, signedEntryLength, recoveryWrap,
                 recoveryWrapLength, vault, ceremony);
  uint8_t manualDigest[32] = {0};
  uint8_t derivedKey[32] = {0};
  NSMutableData *manualOuter = BuildOuter(inner, vault, ceremony, nonce,
                                          pending, manualDigest, derivedKey);
  uint8_t alternateDigest[32] = {0};
  uint8_t alternateDerivedKey[32] = {0};
  NSMutableData *alternateOuter =
      [NSMutableData dataWithBytes:alternateOuterBytes
                            length:alternateOuterLength];
  NSDictionary *wire = fixture[@"wireCommitments"];
  NSDictionary *innerCommitment = wire[@"innerSpool"];
  NSDictionary *outerCommitment = wire[@"primaryOuterFrame"];
  NSDictionary *alternateCommitment = wire[@"alternateSubstitutionOuterFrame"];
  BOOL okay =
      inner != nil && manualOuter != nil && alternateOuter != nil &&
      inner.length == [innerCommitment[@"bytes"] unsignedIntegerValue] &&
      CommitmentMatches(inner.bytes, inner.length,
                        innerCommitment[@"commitmentHex"]) &&
      [NSData dataWithBytes:(const uint8_t *)inner.bytes + inner.length - 32
                     length:32] != nil &&
      [[NSData dataWithBytes:(const uint8_t *)inner.bytes + inner.length - 32
                      length:32]
          isEqualToData:Hex(innerCommitment[@"checksumHex"])] &&
      manualOuter.length == [outerCommitment[@"bytes"] unsignedIntegerValue] &&
      CommitmentMatches(manualOuter.bytes, manualOuter.length,
                        outerCommitment[@"outerFrameCommitmentHex"]) &&
      CommitmentMatches(manualOuter.bytes, 108,
                        outerCommitment[@"aadCommitmentHex"]);
  uint8_t digest[32] = {0};
  okay = okay &&
         HashParts(NULL, 0, pending, 32, vault, 16, ceremony, 16, digest) &&
         [Hex(outerCommitment[@"kdfInputCommitmentHex"])
             isEqualToData:[NSData dataWithBytes:digest length:32]] &&
         CommitmentMatches(derivedKey, sizeof derivedKey,
                           outerCommitment[@"derivedKeyCommitmentHex"]) &&
         CommitmentMatches((const uint8_t *)manualOuter.bytes + 108,
                           inner.length + 16,
                           outerCommitment[@"ciphertextCommitmentHex"]) &&
         [[NSData dataWithBytes:(const uint8_t *)manualOuter.bytes +
                                manualOuter.length - 32
                         length:32]
             isEqualToData:Hex(outerCommitment[@"checksumHex"])] &&
         [[NSData dataWithBytes:manualDigest length:32]
             isEqualToData:Hex(outerCommitment[@"frameDigestHex"])];
  okay =
      okay &&
      alternateOuter.length ==
          [alternateCommitment[@"bytes"] unsignedIntegerValue] &&
      CommitmentMatches(alternateOuter.bytes, alternateOuter.length,
                        alternateCommitment[@"outerFrameCommitmentHex"]) &&
      CommitmentMatches(alternateOuter.bytes, 108,
                        alternateCommitment[@"aadCommitmentHex"]) &&
      memcmp((const uint8_t *)alternateOuter.bytes + 20, alternateVault, 16) ==
          0 &&
      memcmp((const uint8_t *)alternateOuter.bytes + 36, alternateCeremony,
             16) == 0 &&
      HashParts(NULL, 0, pending, 32, alternateVault, 16, alternateCeremony, 16,
                digest) &&
      [Hex(alternateCommitment[@"kdfInputCommitmentHex"])
          isEqualToData:[NSData dataWithBytes:digest length:32]] &&
      HashParts((const uint8_t
                     *)"agent-native/private-vault/rotation-preparation-spool-"
                       "key/anc-v1",
                sizeof("agent-native/private-vault/rotation-preparation-"
                       "spool-key/anc-v1"),
                pending, 32, alternateVault, 16, alternateCeremony, 16,
                alternateDerivedKey) &&
      CommitmentMatches(alternateDerivedKey, sizeof alternateDerivedKey,
                        alternateCommitment[@"derivedKeyCommitmentHex"]) &&
      CommitmentMatches((const uint8_t *)alternateOuter.bytes + 108,
                        alternateOuter.length - 108 - 32,
                        alternateCommitment[@"ciphertextCommitmentHex"]) &&
      [[NSData dataWithBytes:(const uint8_t *)alternateOuter.bytes +
                             alternateOuter.length - 32
                      length:32]
          isEqualToData:Hex(alternateCommitment[@"checksumHex"])] &&
      HashParts((const uint8_t
                     *)"agent-native/private-vault/rotation-preparation-spool-"
                       "frame/anc-v1",
                sizeof("agent-native/private-vault/rotation-preparation-"
                       "spool-frame/anc-v1"),
                alternateOuter.bytes, alternateOuter.length, NULL, 0, NULL, 0,
                alternateDigest) &&
      [[NSData dataWithBytes:alternateDigest length:32]
          isEqualToData:Hex(alternateCommitment[@"frameDigestHex"])] &&
      ![alternateOuter isEqualToData:manualOuter];
  if (!okay)
    fprintf(stderr, "fixture parity commitment stage failed\n");
  AncPrivateVaultRotationPreparationSpoolStatus encodeStatus;
  uint8_t apiDigest[32] = {0};
  NSData *apiOuter = AncPrivateVaultRotationPreparationSpoolEncode(
      signedEntry, signedEntryLength, recoveryWrap, recoveryWrapLength, vault,
      ceremony, pending, nonce, apiDigest, &encodeStatus);
  okay = okay &&
         encodeStatus == AncPrivateVaultRotationPreparationSpoolStatusOK &&
         [apiOuter isEqualToData:manualOuter] &&
         memcmp(apiDigest, manualDigest, 32) == 0;

  static const uint8_t innerChecksumDomain[] =
      "agent-native/private-vault/rotation-preparation-artifacts/anc-v1";
  static const uint8_t outerChecksumDomain[] =
      "agent-native/private-vault/rotation-preparation-spool-checksum/anc-v1";
  static const uint8_t frameDomain[] =
      "agent-native/private-vault/rotation-preparation-spool-frame/anc-v1";
  for (NSDictionary *testCase in fixture[@"negativeCases"]) {
    NSString *category = testCase[@"category"];
    NSDictionary *execution = testCase[@"execution"];
    NSString *applyTo = execution[@"applyTo"];
    if ([applyTo isEqualToString:@"record"] &&
        ![category hasPrefix:@"binding.record_spool"])
      continue;
    NSMutableData *frame = nil;
    uint64_t expectedSigned = signedEntryLength;
    uint64_t expectedWrap = recoveryWrapLength;
    uint8_t expectedDigest[32] = {0};
    if ([execution[@"baselineSpool"]
            isEqualToString:@"alternate_substitution_outer"]) {
      frame = [alternateOuter mutableCopy];
      memcpy(expectedDigest, manualDigest, 32);
    } else if ([applyTo isEqualToString:@"inner_spool"]) {
      NSMutableData *mutatedInner = [inner mutableCopy];
      okay =
          okay && ApplyMutation(mutatedInner, execution[@"effectiveMutation"]);
      if ([execution[@"integrityRepair"]
              isEqualToString:@"inner_spool_checksum"])
        okay = okay && RepairChecksum(mutatedInner, innerChecksumDomain,
                                      sizeof innerChecksumDomain);
      uint8_t mutationKey[32] = {0};
      frame = BuildOuter(mutatedInner, vault, ceremony, nonce, pending,
                         expectedDigest, mutationKey);
      anc_pv_zeroize(mutationKey, sizeof mutationKey);
      ClearMutable(mutatedInner);
    } else if ([applyTo isEqualToString:@"encrypted_outer_spool"]) {
      frame = [manualOuter mutableCopy];
      okay = okay && ApplyMutation(frame, execution[@"effectiveMutation"]);
      if ([execution[@"integrityRepair"]
              isEqualToString:@"outer_spool_checksum"])
        okay = okay && RepairChecksum(frame, outerChecksumDomain,
                                      sizeof outerChecksumDomain);
      okay = okay && HashParts(frameDomain, sizeof frameDomain, frame.bytes,
                               frame.length, NULL, 0, NULL, 0, expectedDigest);
    } else if ([category isEqualToString:@"binding.record_spool_length"]) {
      frame = [manualOuter mutableCopy];
      memcpy(expectedDigest, manualDigest, 32);
      if ([testCase[@"name"] containsString:@"signed"])
        expectedSigned += 1;
      else
        expectedWrap += 1;
    } else if ([category isEqualToString:@"binding.record_spool_digest"]) {
      frame = [manualOuter mutableCopy];
      memcpy(expectedDigest, manualDigest, 32);
      expectedDigest[0] ^= 1;
    }
    if (frame == nil) {
      okay = NO;
      continue;
    }
    __block BOOL callbackCalled = NO;
    AncPrivateVaultRotationPreparationSpoolStatus status;
    BOOL consumed = AncPrivateVaultRotationPreparationSpoolConsume(
        frame, vault, ceremony, expectedSigned, expectedWrap, expectedDigest,
        pending,
        ^BOOL(const uint8_t *signedBytes, size_t signedLength,
              const uint8_t *wrapBytes, size_t wrapLength) {
          (void)signedBytes;
          (void)signedLength;
          (void)wrapBytes;
          (void)wrapLength;
          callbackCalled = YES;
          return YES;
        },
        &status);
    NSString *actualCategory = [NSString
        stringWithUTF8String:
            AncPrivateVaultRotationPreparationSpoolStatusCategory(status)];
    okay = okay && !consumed && !callbackCalled &&
           [actualCategory isEqualToString:category];
    if (consumed || callbackCalled ||
        ![actualCategory isEqualToString:category])
      fprintf(stderr, "fixture negative %s expected %s got %s\n",
              [testCase[@"name"] UTF8String], category.UTF8String,
              actualCategory.UTF8String);
    ClearMutable(frame);
    anc_pv_zeroize(expectedDigest, sizeof expectedDigest);
  }
  anc_pv_zeroize(digest, sizeof digest);
  anc_pv_zeroize(apiDigest, sizeof apiDigest);
  anc_pv_zeroize(manualDigest, sizeof manualDigest);
  anc_pv_zeroize(derivedKey, sizeof derivedKey);
  anc_pv_zeroize(alternateDigest, sizeof alternateDigest);
  anc_pv_zeroize(alternateDerivedKey, sizeof alternateDerivedKey);
  ClearMutable(inner);
  ClearMutable(manualOuter);
  ClearMutable(alternateOuter);
  ClearMutable(stream);
  return okay;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    CHECK(argc == 2);
    NSData *fixtureJSON = [NSData dataWithContentsOfFile:@(argv[1])];
    NSDictionary *fixture = [NSJSONSerialization JSONObjectWithData:fixtureJSON
                                                            options:0
                                                              error:nil];
    CHECK(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    CHECK(RunFixtureParity(fixture));
    uint8_t vault[16], ceremony[16], key[32], nonce[24];
    memset(vault, 0x11, sizeof vault);
    memset(ceremony, 0x33, sizeof ceremony);
    memset(key, 0x77, sizeof key);
    memset(nonce, 0x88, sizeof nonce);
    const uint8_t signedEntry[] = {1, 2, 3, 4, 5};
    const uint8_t recoveryWrap[] = {9, 8, 7, 6};
    const uint8_t *signedEntryBytes = signedEntry;
    const uint8_t *recoveryWrapBytes = recoveryWrap;
    uint8_t frameDigest[32];
    __block BOOL innerCleared = NO, keyCleared = NO;
    AncPrivateVaultRotationPreparationSpoolSetClearHookForTesting(
        ^(BOOL inner, BOOL derivedKey) {
          innerCleared = inner;
          keyCleared = derivedKey;
        });
    AncPrivateVaultRotationPreparationSpoolStatus status;
    NSData *frame = AncPrivateVaultRotationPreparationSpoolEncode(
        signedEntry, sizeof signedEntry, recoveryWrap, sizeof recoveryWrap,
        vault, ceremony, key, nonce, frameDigest, &status);
    CHECK(frame != nil);
    CHECK(status == AncPrivateVaultRotationPreparationSpoolStatusOK);
    CHECK(innerCleared && keyCleared);
    CHECK(frame.length ==
          108 + 124 + sizeof signedEntry + sizeof recoveryWrap + 32 + 16 + 32);
    const uint8_t *bytes = frame.bytes;
    CHECK(memcmp(bytes, "ANVROTE1", 8) == 0);
    CHECK(bytes[8] == 1 && bytes[9] == 0 && bytes[10] == 0 && bytes[11] == 0);
    CHECK(ReadU64LE(bytes + 12) ==
          124 + sizeof signedEntry + sizeof recoveryWrap + 32);
    CHECK(memcmp(bytes + 20, vault, 16) == 0);
    CHECK(memcmp(bytes + 36, ceremony, 16) == 0);
    CHECK(memcmp(bytes + 52, nonce, 24) == 0);

    uint8_t signedBefore[sizeof signedEntry], wrapBefore[sizeof recoveryWrap];
    uint8_t vaultBefore[16], ceremonyBefore[16], keyBefore[32], nonceBefore[24];
    memcpy(signedBefore, signedEntry, sizeof signedEntry);
    memcpy(wrapBefore, recoveryWrap, sizeof recoveryWrap);
    memcpy(vaultBefore, vault, sizeof vault);
    memcpy(ceremonyBefore, ceremony, sizeof ceremony);
    memcpy(keyBefore, key, sizeof key);
    memcpy(nonceBefore, nonce, sizeof nonce);
    uint8_t *aliasOutputs[] = {
        (uint8_t *)signedEntryBytes,
        (uint8_t *)recoveryWrapBytes,
        vault,
        ceremony,
        key,
        nonce,
    };
    for (size_t aliasIndex = 0;
         aliasIndex < sizeof aliasOutputs / sizeof aliasOutputs[0];
         aliasIndex++) {
      CHECK(AncPrivateVaultRotationPreparationSpoolEncode(
                signedEntry, sizeof signedEntry, recoveryWrap,
                sizeof recoveryWrap, vault, ceremony, key, nonce,
                aliasOutputs[aliasIndex], &status) == nil);
    }
    for (size_t aliasIndex = 0;
         aliasIndex < sizeof aliasOutputs / sizeof aliasOutputs[0];
         aliasIndex++) {
      uint8_t distinctDigest[32];
      CHECK(AncPrivateVaultRotationPreparationSpoolEncode(
                signedEntry, sizeof signedEntry, recoveryWrap,
                sizeof recoveryWrap, vault, ceremony, key, nonce,
                distinctDigest,
                (AncPrivateVaultRotationPreparationSpoolStatus *)
                    aliasOutputs[aliasIndex]) == nil);
    }
    uint8_t outputAlias[32];
    memset(outputAlias, 0x5a, sizeof outputAlias);
    CHECK(AncPrivateVaultRotationPreparationSpoolEncode(
              signedEntry, sizeof signedEntry, recoveryWrap,
              sizeof recoveryWrap, vault, ceremony, key, nonce, outputAlias,
              (AncPrivateVaultRotationPreparationSpoolStatus *)outputAlias) ==
          nil);
    CHECK(outputAlias[0] == 0x5a && outputAlias[31] == 0x5a);
    CHECK(memcmp(signedBefore, signedEntry, sizeof signedEntry) == 0);
    CHECK(memcmp(wrapBefore, recoveryWrap, sizeof recoveryWrap) == 0);
    CHECK(memcmp(vaultBefore, vault, sizeof vault) == 0);
    CHECK(memcmp(ceremonyBefore, ceremony, sizeof ceremony) == 0);
    CHECK(memcmp(keyBefore, key, sizeof key) == 0);
    CHECK(memcmp(nonceBefore, nonce, sizeof nonce) == 0);

    NSArray<NSNumber *> *guardedFaults = @[
      @(AncPrivateVaultRotationPreparationSpoolFaultGuardedAllocation),
      @(AncPrivateVaultRotationPreparationSpoolFaultGuardedMLock),
      @(AncPrivateVaultRotationPreparationSpoolFaultGuardedProtection),
    ];
    for (NSNumber *faultValue in guardedFaults) {
      AncPrivateVaultRotationPreparationSpoolFaultPoint injected =
          (AncPrivateVaultRotationPreparationSpoolFaultPoint)
              faultValue.integerValue;
      AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(
          ^BOOL(AncPrivateVaultRotationPreparationSpoolFaultPoint point) {
            return point == injected;
          });
      uint8_t rejectedDigest[32];
      memset(rejectedDigest, 0xa5, sizeof rejectedDigest);
      CHECK(AncPrivateVaultRotationPreparationSpoolEncode(
                signedEntry, sizeof signedEntry, recoveryWrap,
                sizeof recoveryWrap, vault, ceremony, key, nonce,
                rejectedDigest, &status) == nil);
      CHECK(status != AncPrivateVaultRotationPreparationSpoolStatusOK);
      CHECK(rejectedDigest[0] == 0 && rejectedDigest[31] == 0);
    }
    AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(nil);

    NSArray<NSNumber *> *filesystemFaults = @[
      @(AncPrivateVaultRotationPreparationSpoolFaultShortWrite),
      @(AncPrivateVaultRotationPreparationSpoolFaultFileFsync),
      @(AncPrivateVaultRotationPreparationSpoolFaultFileClose),
      @(AncPrivateVaultRotationPreparationSpoolFaultDirectoryFsync),
      @(AncPrivateVaultRotationPreparationSpoolFaultDirectoryListing),
      @(AncPrivateVaultRotationPreparationSpoolFaultBeforeDirectoryReopen),
      @(AncPrivateVaultRotationPreparationSpoolFaultBeforeFileOpen),
      @(AncPrivateVaultRotationPreparationSpoolFaultAfterStageRename),
      @(AncPrivateVaultRotationPreparationSpoolFaultAfterLiveRename),
      @(AncPrivateVaultRotationPreparationSpoolFaultBeforeStageRename),
      @(AncPrivateVaultRotationPreparationSpoolFaultBeforeLiveRename),
      @(AncPrivateVaultRotationPreparationSpoolFaultBeforeUnlink),
      @(AncPrivateVaultRotationPreparationSpoolFaultAfterRenameBeforeReadback),
      @(AncPrivateVaultRotationPreparationSpoolFaultDirectoryClose),
    ];
    for (NSNumber *faultValue in filesystemFaults) {
      AncPrivateVaultRotationPreparationSpoolFaultPoint injected =
          (AncPrivateVaultRotationPreparationSpoolFaultPoint)
              faultValue.integerValue;
      NSURL *faultRoot = [NSURL
          fileURLWithPath:[NSTemporaryDirectory()
                              stringByAppendingPathComponent:NSUUID.UUID
                                                                 .UUIDString]
              isDirectory:YES];
      CHECK([NSFileManager.defaultManager
                 createDirectoryAtURL:faultRoot
          withIntermediateDirectories:NO
                           attributes:@{
                             NSFilePosixPermissions : @0700
                           }
                                error:nil]);
      CHECK(chmod(faultRoot.fileSystemRepresentation, 0700) == 0);
      AncPrivateVaultRotationPreparationSpoolStore *faultStore =
          [[AncPrivateVaultRotationPreparationSpoolStore alloc]
              initWithStateRootURL:faultRoot];
      BOOL liveFault =
          injected ==
              AncPrivateVaultRotationPreparationSpoolFaultDirectoryListing ||
          injected ==
              AncPrivateVaultRotationPreparationSpoolFaultBeforeFileOpen;
      BOOL promoteFault =
          injected ==
              AncPrivateVaultRotationPreparationSpoolFaultBeforeLiveRename ||
          injected ==
              AncPrivateVaultRotationPreparationSpoolFaultAfterLiveRename;
      BOOL deleteFault =
          injected == AncPrivateVaultRotationPreparationSpoolFaultBeforeUnlink;
      if (liveFault || promoteFault || deleteFault)
        CHECK([faultStore writeStageOuterFrame:frame
                                       vaultId:vault
                                    ceremonyId:ceremony
                     expectedSignedEntryLength:sizeof signedEntry
                    expectedRecoveryWrapLength:sizeof recoveryWrap
                           expectedFrameDigest:frameDigest
                                    pendingKey:key
                                         error:nil] ==
              AncPrivateVaultRotationPreparationSpoolStatusOK);
      if (deleteFault)
        CHECK([faultStore reconcileVaultId:vault
                                  ceremonyId:ceremony
                   expectedSignedEntryLength:sizeof signedEntry
                  expectedRecoveryWrapLength:sizeof recoveryWrap
                         expectedFrameDigest:frameDigest
                                  pendingKey:key
                                       error:nil] ==
              AncPrivateVaultRotationPreparationSpoolStatusOK);
      NSUInteger descriptorsBefore =
          [NSFileManager.defaultManager contentsOfDirectoryAtPath:@"/dev/fd"
                                                            error:nil]
              .count;
      __block BOOL injectedObserved = NO;
      AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(
          ^BOOL(AncPrivateVaultRotationPreparationSpoolFaultPoint point) {
            if (point != injected)
              return NO;
            injectedObserved = YES;
            return YES;
          });
      AncPrivateVaultRotationPreparationSpoolStatus failed =
          deleteFault
              ? [faultStore deleteVaultId:vault ceremonyId:ceremony error:nil]
          : promoteFault
              ? [faultStore promoteStageForVaultId:vault
                                        ceremonyId:ceremony
                         expectedSignedEntryLength:sizeof signedEntry
                        expectedRecoveryWrapLength:sizeof recoveryWrap
                               expectedFrameDigest:frameDigest
                                        pendingKey:key
                                             error:nil]
          : liveFault ? [faultStore reconcileVaultId:vault
                                            ceremonyId:ceremony
                             expectedSignedEntryLength:sizeof signedEntry
                            expectedRecoveryWrapLength:sizeof recoveryWrap
                                   expectedFrameDigest:frameDigest
                                            pendingKey:key
                                                 error:nil]
                      : [faultStore writeStageOuterFrame:frame
                                                 vaultId:vault
                                              ceremonyId:ceremony
                               expectedSignedEntryLength:sizeof signedEntry
                              expectedRecoveryWrapLength:sizeof recoveryWrap
                                     expectedFrameDigest:frameDigest
                                              pendingKey:key
                                                   error:nil];
      if (failed == AncPrivateVaultRotationPreparationSpoolStatusOK)
        fprintf(stderr, "filesystem fault did not fail: %ld\n", (long)injected);
      CHECK(failed != AncPrivateVaultRotationPreparationSpoolStatusOK);
      CHECK(injectedObserved);
      AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(nil);
      NSUInteger descriptorsAfter =
          [NSFileManager.defaultManager contentsOfDirectoryAtPath:@"/dev/fd"
                                                            error:nil]
              .count;
      CHECK(descriptorsAfter == descriptorsBefore);
      CHECK([faultStore writeStageOuterFrame:frame
                                     vaultId:vault
                                  ceremonyId:ceremony
                   expectedSignedEntryLength:sizeof signedEntry
                  expectedRecoveryWrapLength:sizeof recoveryWrap
                         expectedFrameDigest:frameDigest
                                  pendingKey:key
                                       error:nil] ==
            AncPrivateVaultRotationPreparationSpoolStatusOK);
      CHECK([faultStore reconcileVaultId:vault
                                ceremonyId:ceremony
                 expectedSignedEntryLength:sizeof signedEntry
                expectedRecoveryWrapLength:sizeof recoveryWrap
                       expectedFrameDigest:frameDigest
                                pendingKey:key
                                     error:nil] ==
            AncPrivateVaultRotationPreparationSpoolStatusOK);
      CHECK([faultStore deleteVaultId:vault ceremonyId:ceremony error:nil] ==
            AncPrivateVaultRotationPreparationSpoolStatusOK);
      CHECK([NSFileManager.defaultManager removeItemAtURL:faultRoot error:nil]);
    }

    __block NSUInteger callbacks = 0;
    BOOL consumed = AncPrivateVaultRotationPreparationSpoolConsume(
        frame, vault, ceremony, sizeof signedEntry, sizeof recoveryWrap,
        frameDigest, key,
        ^BOOL(const uint8_t *signedBytes, size_t signedLength,
              const uint8_t *wrapBytes, size_t wrapLength) {
          callbacks++;
          return signedLength == sizeof signedEntry &&
                 wrapLength == sizeof recoveryWrap &&
                 memcmp(signedBytes, signedEntryBytes, signedLength) == 0 &&
                 memcmp(wrapBytes, recoveryWrapBytes, wrapLength) == 0;
        },
        &status);
    CHECK(consumed && callbacks == 1);
    CHECK(status == AncPrivateVaultRotationPreparationSpoolStatusOK);
    CHECK(innerCleared && keyCleared);

    NSMutableData *tampered = [frame mutableCopy];
    ((uint8_t *)tampered.mutableBytes)[108] ^= 1;
    callbacks = 0;
    CHECK(!AncPrivateVaultRotationPreparationSpoolConsume(
        tampered, vault, ceremony, sizeof signedEntry, sizeof recoveryWrap,
        frameDigest, key,
        ^BOOL(const uint8_t *signedBytes, size_t signedLength,
              const uint8_t *wrapBytes, size_t wrapLength) {
          (void)signedBytes;
          (void)signedLength;
          (void)wrapBytes;
          (void)wrapLength;
          callbacks++;
          return YES;
        },
        &status));
    CHECK(callbacks == 0);
    CHECK(status ==
          AncPrivateVaultRotationPreparationSpoolStatusEncryptionChecksum);

    callbacks = 0;
    CHECK(!AncPrivateVaultRotationPreparationSpoolConsume(
        frame, vault, ceremony, sizeof signedEntry, sizeof recoveryWrap,
        frameDigest, key,
        ^BOOL(const uint8_t *signedBytes, size_t signedLength,
              const uint8_t *wrapBytes, size_t wrapLength) {
          (void)signedBytes;
          (void)signedLength;
          (void)wrapBytes;
          (void)wrapLength;
          callbacks++;
          @throw [NSException exceptionWithName:@"test"
                                         reason:nil
                                       userInfo:nil];
        },
        &status));
    CHECK(callbacks == 1 && innerCleared && keyCleared);

    NSURL *temporary = [NSURL
        fileURLWithPath:[NSTemporaryDirectory()
                            stringByAppendingPathComponent:NSUUID.UUID
                                                               .UUIDString]
            isDirectory:YES];
    CHECK([NSFileManager.defaultManager
               createDirectoryAtURL:temporary
        withIntermediateDirectories:NO
                         attributes:@{
                           NSFilePosixPermissions : @0700
                         }
                              error:nil]);
    CHECK(chmod(temporary.fileSystemRepresentation, 0700) == 0);
    AncPrivateVaultRotationPreparationSpoolStore *store =
        [[AncPrivateVaultRotationPreparationSpoolStore alloc]
            initWithStateRootURL:temporary];
    AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(
        ^BOOL(AncPrivateVaultRotationPreparationSpoolFaultPoint point) {
          return point ==
                 AncPrivateVaultRotationPreparationSpoolFaultDirectoryClose;
        });
    CHECK([store writeStageOuterFrame:frame
                                 vaultId:vault
                              ceremonyId:ceremony
               expectedSignedEntryLength:sizeof signedEntry
              expectedRecoveryWrapLength:sizeof recoveryWrap
                     expectedFrameDigest:frameDigest
                              pendingKey:key
                                   error:nil] !=
          AncPrivateVaultRotationPreparationSpoolStatusOK);
    AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(nil);

    NSURL *unapprovedRoot = [NSURL
        fileURLWithPath:[NSTemporaryDirectory()
                            stringByAppendingPathComponent:NSUUID.UUID
                                                               .UUIDString]
            isDirectory:YES];
    CHECK([NSFileManager.defaultManager
               createDirectoryAtURL:unapprovedRoot
        withIntermediateDirectories:NO
                         attributes:@{
                           NSFilePosixPermissions : @0755
                         }
                              error:nil]);
    CHECK(chmod(unapprovedRoot.fileSystemRepresentation, 0755) == 0);
    AncPrivateVaultRotationPreparationSpoolStore *unapprovedStore =
        [[AncPrivateVaultRotationPreparationSpoolStore alloc]
            initWithStateRootURL:unapprovedRoot];
    CHECK([unapprovedStore writeStageOuterFrame:frame
                                        vaultId:vault
                                     ceremonyId:ceremony
                      expectedSignedEntryLength:sizeof signedEntry
                     expectedRecoveryWrapLength:sizeof recoveryWrap
                            expectedFrameDigest:frameDigest
                                     pendingKey:key
                                          error:nil] !=
          AncPrivateVaultRotationPreparationSpoolStatusOK);
    CHECK([NSFileManager.defaultManager removeItemAtURL:unapprovedRoot
                                                  error:nil]);
    CHECK([store writeStageOuterFrame:frame
                                 vaultId:vault
                              ceremonyId:ceremony
               expectedSignedEntryLength:sizeof signedEntry
              expectedRecoveryWrapLength:sizeof recoveryWrap
                     expectedFrameDigest:frameDigest
                              pendingKey:key
                                   error:nil] ==
          AncPrivateVaultRotationPreparationSpoolStatusOK);
    CHECK([store reconcileVaultId:vault
                              ceremonyId:ceremony
               expectedSignedEntryLength:sizeof signedEntry
              expectedRecoveryWrapLength:sizeof recoveryWrap
                     expectedFrameDigest:frameDigest
                              pendingKey:key
                                   error:nil] ==
          AncPrivateVaultRotationPreparationSpoolStatusOK);
    callbacks = 0;
    CHECK([store readLiveVaultId:vault
                              ceremonyId:ceremony
               expectedSignedEntryLength:sizeof signedEntry
              expectedRecoveryWrapLength:sizeof recoveryWrap
                     expectedFrameDigest:frameDigest
                              pendingKey:key
                                consumer:^BOOL(const uint8_t *signedBytes,
                                               size_t signedLength,
                                               const uint8_t *wrapBytes,
                                               size_t wrapLength) {
                                  callbacks++;
                                  return memcmp(signedBytes, signedEntryBytes,
                                                signedLength) == 0 &&
                                         memcmp(wrapBytes, recoveryWrapBytes,
                                                wrapLength) == 0;
                                }
                                   error:nil] ==
          AncPrivateVaultRotationPreparationSpoolStatusOK);
    CHECK(callbacks == 1);
    NSURL *root = [[temporary URLByAppendingPathComponent:@"state"
                                              isDirectory:YES]
        URLByAppendingPathComponent:@"rotation-preparation"
                        isDirectory:YES];
    struct stat directory;
    CHECK(lstat(root.fileSystemRepresentation, &directory) == 0);
    CHECK(S_ISDIR(directory.st_mode) && (directory.st_mode & 0777) == 0700);
    NSArray<NSURL *> *files =
        [NSFileManager.defaultManager contentsOfDirectoryAtURL:root
                                    includingPropertiesForKeys:nil
                                                       options:0
                                                         error:nil];
    CHECK(files.count == 1);
    struct stat live;
    CHECK(lstat(files.firstObject.fileSystemRepresentation, &live) == 0);
    CHECK(S_ISREG(live.st_mode) && live.st_nlink == 1 &&
          (live.st_mode & 0777) == 0600);
    CHECK([store deleteVaultId:vault ceremonyId:ceremony error:nil] ==
          AncPrivateVaultRotationPreparationSpoolStatusOK);

    NSURL *state = [temporary URLByAppendingPathComponent:@"state"
                                              isDirectory:YES];
    NSURL *savedState = [temporary URLByAppendingPathComponent:@"state-saved"
                                                   isDirectory:YES];
    __block BOOL swapped = NO;
    AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(^BOOL(
        AncPrivateVaultRotationPreparationSpoolFaultPoint point) {
      if (point !=
              AncPrivateVaultRotationPreparationSpoolFaultBeforeDirectoryReopen ||
          swapped)
        return NO;
      swapped = YES;
      if (rename(state.fileSystemRepresentation,
                 savedState.fileSystemRepresentation) != 0)
        return YES;
      return symlink(savedState.fileSystemRepresentation,
                     state.fileSystemRepresentation) != 0;
    });
    CHECK([store writeStageOuterFrame:frame
                                 vaultId:vault
                              ceremonyId:ceremony
               expectedSignedEntryLength:sizeof signedEntry
              expectedRecoveryWrapLength:sizeof recoveryWrap
                     expectedFrameDigest:frameDigest
                              pendingKey:key
                                   error:nil] ==
          AncPrivateVaultRotationPreparationSpoolStatusStorageFailed);
    CHECK(swapped);
    AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(nil);
    CHECK(unlink(state.fileSystemRepresentation) == 0);
    CHECK(rename(savedState.fileSystemRepresentation,
                 state.fileSystemRepresentation) == 0);

    NSURL *symlinkRoot = [NSURL
        fileURLWithPath:[NSTemporaryDirectory()
                            stringByAppendingPathComponent:NSUUID.UUID
                                                               .UUIDString]
            isDirectory:YES];
    CHECK(symlink(temporary.fileSystemRepresentation,
                  symlinkRoot.fileSystemRepresentation) == 0);
    AncPrivateVaultRotationPreparationSpoolStore *symlinkStore =
        [[AncPrivateVaultRotationPreparationSpoolStore alloc]
            initWithStateRootURL:symlinkRoot];
    CHECK([symlinkStore writeStageOuterFrame:frame
                                     vaultId:vault
                                  ceremonyId:ceremony
                   expectedSignedEntryLength:sizeof signedEntry
                  expectedRecoveryWrapLength:sizeof recoveryWrap
                         expectedFrameDigest:frameDigest
                                  pendingKey:key
                                       error:nil] !=
          AncPrivateVaultRotationPreparationSpoolStatusOK);
    CHECK(unlink(symlinkRoot.fileSystemRepresentation) == 0);

    NSString *baseName = [@"11111111111111111111111111111111"
        stringByAppendingString:@"33333333333333333333333333333333"];
    NSURL *stageURL =
        [root URLByAppendingPathComponent:
                  [baseName stringByAppendingString:@".rotation-spool.stage"]];
    NSURL *liveURL =
        [root URLByAppendingPathComponent:
                  [baseName stringByAppendingString:@".rotation-spool"]];
    NSMutableData *replacementFrame = [frame mutableCopy];
    ((uint8_t *)replacementFrame.mutableBytes)[108] ^= 0x80;

    NSURL * (^makeReplacement)(void) = ^NSURL * {
      NSURL *url =
          [temporary URLByAppendingPathComponent:NSUUID.UUID.UUIDString];
      if (![replacementFrame writeToURL:url options:0 error:nil] ||
          chmod(url.fileSystemRepresentation, 0600) != 0)
        return nil;
      return url;
    };

    __block NSURL *replacement = makeReplacement();
    CHECK(replacement != nil);
    swapped = NO;
    __block BOOL mutationOkay = YES;
    AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(^BOOL(
        AncPrivateVaultRotationPreparationSpoolFaultPoint point) {
      if (point !=
              AncPrivateVaultRotationPreparationSpoolFaultAfterRenameBeforeReadback ||
          swapped)
        return NO;
      swapped = YES;
      mutationOkay = unlink(stageURL.fileSystemRepresentation) == 0 &&
                     rename(replacement.fileSystemRepresentation,
                            stageURL.fileSystemRepresentation) == 0;
      return NO;
    });
    CHECK([store writeStageOuterFrame:frame
                                 vaultId:vault
                              ceremonyId:ceremony
               expectedSignedEntryLength:sizeof signedEntry
              expectedRecoveryWrapLength:sizeof recoveryWrap
                     expectedFrameDigest:frameDigest
                              pendingKey:key
                                   error:nil] ==
          AncPrivateVaultRotationPreparationSpoolStatusStorageFailed);
    CHECK(swapped && mutationOkay);
    AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(nil);
    CHECK(unlink(stageURL.fileSystemRepresentation) == 0);

    CHECK([store writeStageOuterFrame:frame
                                 vaultId:vault
                              ceremonyId:ceremony
               expectedSignedEntryLength:sizeof signedEntry
              expectedRecoveryWrapLength:sizeof recoveryWrap
                     expectedFrameDigest:frameDigest
                              pendingKey:key
                                   error:nil] ==
          AncPrivateVaultRotationPreparationSpoolStatusOK);
    replacement = makeReplacement();
    CHECK(replacement != nil);
    swapped = NO;
    mutationOkay = YES;
    AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(^BOOL(
        AncPrivateVaultRotationPreparationSpoolFaultPoint point) {
      if (point !=
              AncPrivateVaultRotationPreparationSpoolFaultBeforeLiveRename ||
          swapped)
        return NO;
      swapped = YES;
      mutationOkay = unlink(stageURL.fileSystemRepresentation) == 0 &&
                     rename(replacement.fileSystemRepresentation,
                            stageURL.fileSystemRepresentation) == 0;
      return NO;
    });
    CHECK([store promoteStageForVaultId:vault
                              ceremonyId:ceremony
               expectedSignedEntryLength:sizeof signedEntry
              expectedRecoveryWrapLength:sizeof recoveryWrap
                     expectedFrameDigest:frameDigest
                              pendingKey:key
                                   error:nil] ==
          AncPrivateVaultRotationPreparationSpoolStatusStorageFailed);
    CHECK(swapped && mutationOkay &&
          access(liveURL.fileSystemRepresentation, F_OK) == 0);
    AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(nil);
    callbacks = 0;
    CHECK([store readLiveVaultId:vault
                              ceremonyId:ceremony
               expectedSignedEntryLength:sizeof signedEntry
              expectedRecoveryWrapLength:sizeof recoveryWrap
                     expectedFrameDigest:frameDigest
                              pendingKey:key
                                consumer:^BOOL(const uint8_t *signedBytes,
                                               size_t signedLength,
                                               const uint8_t *wrapBytes,
                                               size_t wrapLength) {
                                  (void)signedBytes;
                                  (void)signedLength;
                                  (void)wrapBytes;
                                  (void)wrapLength;
                                  callbacks++;
                                  return YES;
                                }
                                   error:nil] !=
          AncPrivateVaultRotationPreparationSpoolStatusOK);
    CHECK(callbacks == 0);
    CHECK(unlink(liveURL.fileSystemRepresentation) == 0);

    CHECK([store writeStageOuterFrame:frame
                                 vaultId:vault
                              ceremonyId:ceremony
               expectedSignedEntryLength:sizeof signedEntry
              expectedRecoveryWrapLength:sizeof recoveryWrap
                     expectedFrameDigest:frameDigest
                              pendingKey:key
                                   error:nil] ==
          AncPrivateVaultRotationPreparationSpoolStatusOK);
    CHECK([store reconcileVaultId:vault
                              ceremonyId:ceremony
               expectedSignedEntryLength:sizeof signedEntry
              expectedRecoveryWrapLength:sizeof recoveryWrap
                     expectedFrameDigest:frameDigest
                              pendingKey:key
                                   error:nil] ==
          AncPrivateVaultRotationPreparationSpoolStatusOK);
    replacement = makeReplacement();
    CHECK(replacement != nil);
    NSURL *displaced =
        [temporary URLByAppendingPathComponent:NSUUID.UUID.UUIDString];
    swapped = NO;
    mutationOkay = YES;
    AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(^BOOL(
        AncPrivateVaultRotationPreparationSpoolFaultPoint point) {
      if (point != AncPrivateVaultRotationPreparationSpoolFaultBeforeUnlink ||
          swapped)
        return NO;
      swapped = YES;
      NSArray<NSURL *> *entries =
          [NSFileManager.defaultManager contentsOfDirectoryAtURL:root
                                      includingPropertiesForKeys:nil
                                                         options:0
                                                           error:nil];
      NSURL *quarantine = nil;
      for (NSURL *entry in entries) {
        if ([entry.lastPathComponent hasPrefix:@"."] &&
            [entry.lastPathComponent hasSuffix:@".tmp"])
          quarantine = entry;
      }
      mutationOkay = quarantine != nil &&
                     rename(quarantine.fileSystemRepresentation,
                            displaced.fileSystemRepresentation) == 0 &&
                     rename(replacement.fileSystemRepresentation,
                            quarantine.fileSystemRepresentation) == 0;
      return NO;
    });
    CHECK([store deleteVaultId:vault ceremonyId:ceremony error:nil] ==
          AncPrivateVaultRotationPreparationSpoolStatusStorageFailed);
    CHECK(swapped && mutationOkay);
    AncPrivateVaultRotationPreparationSpoolSetFaultHookForTesting(nil);
    CHECK(unlink(displaced.fileSystemRepresentation) == 0);
    NSArray<NSURL *> *residue =
        [NSFileManager.defaultManager contentsOfDirectoryAtURL:root
                                    includingPropertiesForKeys:nil
                                                       options:0
                                                         error:nil];
    for (NSURL *entry in residue)
      CHECK(unlink(entry.fileSystemRepresentation) == 0);

    CHECK([NSFileManager.defaultManager removeItemAtURL:temporary error:nil]);
    AncPrivateVaultRotationPreparationSpoolSetClearHookForTesting(nil);
    puts("Private Vault rotation-preparation spool tests passed");
  }
  return 0;
}
