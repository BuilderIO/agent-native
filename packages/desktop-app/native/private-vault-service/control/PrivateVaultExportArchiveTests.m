#import <Foundation/Foundation.h>

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultExportArchive.h"

#define CHECK(condition)                                                        \
  do {                                                                          \
    if (!(condition)) {                                                         \
      fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #condition);      \
      return 1;                                                                 \
    }                                                                           \
  } while (0)

static NSData *Filled(NSUInteger length, uint8_t byte) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

static AncPrivateVaultGuardedMemory *GuardedFilled(uint8_t byte) {
  AncPrivateVaultGuardedMemoryStatus status;
  AncPrivateVaultGuardedMemory *memory =
      [AncPrivateVaultGuardedMemory memoryWithLength:32 status:&status];
  if (memory == nil || status != AncPrivateVaultGuardedMemoryStatusOK)
    return nil;
  status = [memory borrow:^BOOL(uint8_t *bytes, size_t length) {
    memset(bytes, byte, length);
    return length == 32;
  }];
  return status == AncPrivateVaultGuardedMemoryStatusOK ? memory : nil;
}

static BOOL GuardedEquals(AncPrivateVaultGuardedMemory *memory, uint8_t byte) {
  __block BOOL equal = YES;
  AncPrivateVaultGuardedMemoryStatus status =
      [memory borrow:^BOOL(uint8_t *bytes, size_t length) {
    if (length != 32) return NO;
    for (size_t index = 0; index < length; index++) equal &= bytes[index] == byte;
    return equal;
  }];
  return status == AncPrivateVaultGuardedMemoryStatusOK && equal;
}

static NSString *Hex(NSData *data) {
  NSMutableString *value = [NSMutableString stringWithCapacity:data.length * 2];
  const uint8_t *bytes = data.bytes;
  for (NSUInteger index = 0; index < data.length; index++)
    [value appendFormat:@"%02x", bytes[index]];
  return value;
}

static int TestVectorAndRoundTrip(void) {
  NSData *vaultId = Filled(16, 0x11);
  NSData *plaintext =
      [@"{\"documents\":[{\"title\":\"private sentinel\"}]}"
          dataUsingEncoding:NSUTF8StringEncoding];
  AncPrivateVaultGuardedMemory *root = GuardedFilled(0x44);
  CHECK(root != nil);
  AncPrivateVaultExportArchiveStatus status;
  AncPrivateVaultSealedExportArchive *sealed = AncPrivateVaultSealExportArchive(
      vaultId, Filled(16, 0x22), UINT64_C(1800000000000), Filled(32, 0x33),
      2, plaintext, root, Filled(24, 0x55), &status);
  CHECK(status == AncPrivateVaultExportArchiveStatusOK && sealed != nil);
  CHECK([Hex(sealed.encodedArchive) isEqualToString:
      @"aa0166616e632f7631025011111111111111111111111111111111036e6578706f72742d61726368697665041b000001a3185c50000550222222222222222222222222222222221901cc582033333333333333333333333333333333333333333333333333333333333333331901cd021901ce5820edbe86d937b96e76706b0a2d7cd3a01421f58f1a117e4c3ad4aa31abc2b86eed1901cf58185555555555555555555555555555555555555555555555551901d0583c487f09bb05418b4b1e25c3dcffaaf4ddd7c44a03bfe11e151efc168f31329904751ef618f351c32260ac4c34373e662fd2faaefd95f00c5f92c08f8c"]);
  CHECK([sealed.encodedArchive rangeOfData:plaintext
                                  options:0
                                    range:NSMakeRange(0, sealed.encodedArchive.length)]
            .location == NSNotFound);
  AncPrivateVaultExportArchiveMetadata *inspected =
      AncPrivateVaultInspectExportArchive(sealed.encodedArchive, &status);
  CHECK(status == AncPrivateVaultExportArchiveStatusOK && inspected != nil);
  CHECK(inspected.createdAt == UINT64_C(1800000000000) &&
        inspected.objectCount == 2);
  AncPrivateVaultOpenedExportArchive *opened = AncPrivateVaultOpenExportArchive(
      sealed.encodedArchive, vaultId, root, &status);
  CHECK(status == AncPrivateVaultExportArchiveStatusOK && opened != nil);
  CHECK([opened.plaintext isEqualToData:plaintext]);
  CHECK([opened.metadata.sourceSnapshotHash isEqualToData:Filled(32, 0x33)]);
  AncPrivateVaultExportArchiveMetadata *verified =
      AncPrivateVaultVerifyExportArchive(sealed.encodedArchive, vaultId, root,
                                         &status);
  CHECK(status == AncPrivateVaultExportArchiveStatusOK && verified != nil);
  CHECK([verified.plaintextHash isEqualToData:opened.metadata.plaintextHash]);
  CHECK(GuardedEquals(root, 0x44));
  CHECK([root close] == AncPrivateVaultGuardedMemoryStatusOK);
  return 0;
}

static int TestAuthenticationAndStrictDecoding(void) {
  NSData *vaultId = Filled(16, 0x11);
  AncPrivateVaultGuardedMemory *root = GuardedFilled(0x44);
  AncPrivateVaultExportArchiveStatus status;
  AncPrivateVaultSealedExportArchive *sealed = AncPrivateVaultSealExportArchive(
      vaultId, Filled(16, 0x22), 1, Filled(32, 0x33), 1,
      Filled(64, 0x66), root, Filled(24, 0x55), &status);
  CHECK(sealed != nil);
  AncPrivateVaultGuardedMemory *wrongRoot = GuardedFilled(0x45);
  CHECK(AncPrivateVaultOpenExportArchive(sealed.encodedArchive, vaultId,
                                         wrongRoot, &status) == nil);
  CHECK(status == AncPrivateVaultExportArchiveStatusAuthentication);
  CHECK(AncPrivateVaultVerifyExportArchive(sealed.encodedArchive, vaultId,
                                           wrongRoot, &status) == nil);
  CHECK(status == AncPrivateVaultExportArchiveStatusAuthentication);
  CHECK(AncPrivateVaultOpenExportArchive(sealed.encodedArchive,
                                         Filled(16, 0x12), root,
                                         &status) == nil);
  CHECK(status == AncPrivateVaultExportArchiveStatusAuthentication);
  NSMutableData *tampered = [sealed.encodedArchive mutableCopy];
  ((uint8_t *)tampered.mutableBytes)[tampered.length - 1] ^= 1;
  CHECK(AncPrivateVaultOpenExportArchive(tampered, vaultId, root, &status) == nil);
  CHECK(status == AncPrivateVaultExportArchiveStatusAuthentication);
  NSMutableData *trailing = [sealed.encodedArchive mutableCopy];
  uint8_t zero = 0;
  [trailing appendBytes:&zero length:1];
  CHECK(AncPrivateVaultInspectExportArchive(trailing, &status) == nil);
  CHECK(status == AncPrivateVaultExportArchiveStatusInvalid);
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *decoded = AncPrivateVaultCanonicalDecode(
      sealed.encodedArchive, sealed.encodedArchive.length, &canonicalStatus);
  NSMutableDictionary *unknown = [decoded.mapValue mutableCopy];
  unknown[@999] = [AncPrivateVaultCanonicalValue integer:1];
  NSData *unknownEncoded = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:unknown], &canonicalStatus);
  CHECK(AncPrivateVaultInspectExportArchive(unknownEncoded, &status) == nil);
  CHECK(GuardedEquals(root, 0x44) && GuardedEquals(wrongRoot, 0x45));
  [root close];
  [wrongRoot close];
  return 0;
}

static int TestBounds(void) {
  AncPrivateVaultGuardedMemory *root = GuardedFilled(0x44);
  AncPrivateVaultExportArchiveStatus status;
  CHECK(AncPrivateVaultSealExportArchive(
            Filled(16, 0x11), Filled(16, 0x22), 1, Filled(32, 0x33), 1,
            [NSData data], root, Filled(24, 0x55), &status) == nil);
  CHECK(status == AncPrivateVaultExportArchiveStatusInvalid);
  CHECK(AncPrivateVaultSealExportArchive(
            Filled(16, 0x11), Filled(16, 0x22), 1, Filled(32, 0x33), 0,
            Filled(1, 0x66), root, Filled(24, 0x55), &status) == nil);
  CHECK(status == AncPrivateVaultExportArchiveStatusInvalid);
  [root close];
  return 0;
}

int main(void) {
  @autoreleasepool {
    if (anc_pv_crypto_init() != ANC_PV_CRYPTO_OK) return 1;
    if (TestVectorAndRoundTrip() != 0) return 1;
    if (TestAuthenticationAndStrictDecoding() != 0) return 1;
    if (TestBounds() != 0) return 1;
    puts("Private Vault export archive tests passed");
  }
  return 0;
}
