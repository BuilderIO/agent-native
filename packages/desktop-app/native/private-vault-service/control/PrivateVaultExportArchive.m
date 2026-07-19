#import "PrivateVaultExportArchive.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

#import <objc/runtime.h>

static const uint64_t kMaxSafeInteger = UINT64_C(9007199254740991);
static const NSUInteger kMaximumEncoded =
    (NSUInteger)ANC_PV_MAX_EXPORT_BYTES + 64 * 1024;
static const uint8_t kExportKeyDomain[] = "anc/v1/export-key";
static const uint8_t kExportArchiveDomain[] = "anc/v1/export-archive";

@interface AncPrivateVaultExportArchiveMetadata ()
@property(nonatomic, readwrite) NSData *vaultId;
@property(nonatomic, readwrite) NSData *exportId;
@property(nonatomic, readwrite) uint64_t createdAt;
@property(nonatomic, readwrite) NSData *sourceSnapshotHash;
@property(nonatomic, readwrite) uint64_t objectCount;
@property(nonatomic, readwrite) NSData *plaintextHash;
@end
@implementation AncPrivateVaultExportArchiveMetadata
@end
@interface AncPrivateVaultConcreteExportArchiveMetadata
    : AncPrivateVaultExportArchiveMetadata
@end
@implementation AncPrivateVaultConcreteExportArchiveMetadata
@end

@interface AncPrivateVaultSealedExportArchive ()
@property(nonatomic, readwrite) NSData *encodedArchive;
@property(nonatomic, readwrite) AncPrivateVaultExportArchiveMetadata *metadata;
@end
@implementation AncPrivateVaultSealedExportArchive
@end
@interface AncPrivateVaultConcreteSealedExportArchive
    : AncPrivateVaultSealedExportArchive
@end
@implementation AncPrivateVaultConcreteSealedExportArchive
@end

@interface AncPrivateVaultOpenedExportArchive ()
@property(nonatomic, readwrite) NSData *plaintext;
@property(nonatomic, readwrite) AncPrivateVaultExportArchiveMetadata *metadata;
@end
@implementation AncPrivateVaultOpenedExportArchive
@end
@interface AncPrivateVaultConcreteOpenedExportArchive
    : AncPrivateVaultOpenedExportArchive
@end
@implementation AncPrivateVaultConcreteOpenedExportArchive
@end

static void SetStatus(AncPrivateVaultExportArchiveStatus *status,
                      AncPrivateVaultExportArchiveStatus value) {
  if (status != NULL) *status = value;
}

static BOOL Exact(NSData *value, NSUInteger length) {
  return [value isKindOfClass:NSData.class] && value.length == length;
}

static BOOL Same(NSData *left, NSData *right) {
  return Exact(left, right.length) && right.length > 0 &&
         anc_pv_memcmp(left.bytes, right.bytes, right.length) ==
             ANC_PV_CRYPTO_OK;
}

static AncPrivateVaultCanonicalValue *T(NSString *value) {
  return [AncPrivateVaultCanonicalValue text:value];
}
static AncPrivateVaultCanonicalValue *B(NSData *value) {
  return [AncPrivateVaultCanonicalValue bytes:value];
}
static AncPrivateVaultCanonicalValue *I(uint64_t value) {
  return value <= kMaxSafeInteger
             ? [AncPrivateVaultCanonicalValue integer:(int64_t)value]
             : nil;
}

static NSData *EncodeMap(NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *value =
      [AncPrivateVaultCanonicalValue map:map];
  return value == nil ? nil : AncPrivateVaultCanonicalEncode(value, &status);
}

static AncPrivateVaultCanonicalValue *Field(
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map,
    NSNumber *key, AncPrivateVaultCanonicalType type) {
  AncPrivateVaultCanonicalValue *value = map[key];
  return value.type == type ? value : nil;
}

static BOOL ExactKeys(
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map,
    NSArray<NSNumber *> *keys) {
  return map.count == keys.count &&
         [[NSSet setWithArray:map.allKeys]
             isEqualToSet:[NSSet setWithArray:keys]];
}

static NSData *DomainData(const uint8_t *domain, size_t length,
                          NSData *payload) {
  NSMutableData *value = [NSMutableData dataWithBytes:domain length:length];
  [value appendData:payload];
  return value;
}

static NSData *PlaintextHash(NSData *plaintext) {
  uint8_t output[ANC_PV_HASH_BYTES] = {0};
  BOOL valid = anc_pv_export_blake2b_256_two_part(
                   output, kExportArchiveDomain,
                   sizeof kExportArchiveDomain, plaintext.bytes,
                   plaintext.length) == ANC_PV_CRYPTO_OK;
  NSData *result =
      valid ? [NSData dataWithBytes:output length:sizeof output] : nil;
  anc_pv_zeroize(output, sizeof output);
  return result;
}

static NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *HeaderMap(
    AncPrivateVaultExportArchiveMetadata *metadata, NSData *nonce) {
  AncPrivateVaultCanonicalValue *created = I(metadata.createdAt);
  AncPrivateVaultCanonicalValue *count = I(metadata.objectCount);
  if (created == nil || count == nil) return nil;
  return @{
    @1 : T(@"anc/v1"),
    @2 : B(metadata.vaultId),
    @3 : T(@"export-archive"),
    @4 : created,
    @5 : B(metadata.exportId),
    @460 : B(metadata.sourceSnapshotHash),
    @461 : count,
    @462 : B(metadata.plaintextHash),
    @463 : B(nonce),
  };
}

static AncPrivateVaultExportArchiveMetadata *Metadata(
    NSData *vaultId, NSData *exportId, uint64_t createdAt,
    NSData *sourceSnapshotHash, uint64_t objectCount, NSData *plaintextHash) {
  AncPrivateVaultExportArchiveMetadata *metadata =
      class_createInstance(AncPrivateVaultExportArchiveMetadata.class, 0);
  metadata.vaultId = [vaultId copy];
  metadata.exportId = [exportId copy];
  metadata.createdAt = createdAt;
  metadata.sourceSnapshotHash = [sourceSnapshotHash copy];
  metadata.objectCount = objectCount;
  metadata.plaintextHash = [plaintextHash copy];
  object_setClass(metadata,
                  AncPrivateVaultConcreteExportArchiveMetadata.class);
  return metadata;
}

static NSDictionary<NSString *, id> *Decode(NSData *encoded) {
  if (![encoded isKindOfClass:NSData.class] || encoded.length > kMaximumEncoded)
    return nil;
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *value =
      AncPrivateVaultCanonicalDecode(encoded, kMaximumEncoded,
                                     &canonicalStatus);
  NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map =
      value.type == AncPrivateVaultCanonicalTypeMap ? value.mapValue : nil;
  NSArray<NSNumber *> *keys =
      @[@1, @2, @3, @4, @5, @460, @461, @462, @463, @464];
  if (map == nil || !ExactKeys(map, keys)) return nil;
  AncPrivateVaultCanonicalValue *suite =
      Field(map, @1, AncPrivateVaultCanonicalTypeText);
  AncPrivateVaultCanonicalValue *vault =
      Field(map, @2, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *type =
      Field(map, @3, AncPrivateVaultCanonicalTypeText);
  AncPrivateVaultCanonicalValue *created =
      Field(map, @4, AncPrivateVaultCanonicalTypeInteger);
  AncPrivateVaultCanonicalValue *exportId =
      Field(map, @5, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *snapshot =
      Field(map, @460, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *count =
      Field(map, @461, AncPrivateVaultCanonicalTypeInteger);
  AncPrivateVaultCanonicalValue *hash =
      Field(map, @462, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *nonce =
      Field(map, @463, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *ciphertext =
      Field(map, @464, AncPrivateVaultCanonicalTypeBytes);
  if (![suite.textValue isEqualToString:@"anc/v1"] ||
      ![type.textValue isEqualToString:@"export-archive"] ||
      !Exact(vault.bytesValue, 16) || !Exact(exportId.bytesValue, 16) ||
      created.integerValue <= 0 || count.integerValue <= 0 ||
      (uint64_t)created.integerValue > kMaxSafeInteger ||
      (uint64_t)count.integerValue > kMaxSafeInteger ||
      !Exact(snapshot.bytesValue, 32) || !Exact(hash.bytesValue, 32) ||
      !Exact(nonce.bytesValue, 24) || ciphertext.bytesValue.length <= 16 ||
      ciphertext.bytesValue.length >
          (NSUInteger)ANC_PV_MAX_EXPORT_BYTES + ANC_PV_AUTH_BYTES)
    return nil;
  AncPrivateVaultExportArchiveMetadata *metadata = Metadata(
      vault.bytesValue, exportId.bytesValue, (uint64_t)created.integerValue,
      snapshot.bytesValue, (uint64_t)count.integerValue, hash.bytesValue);
  return @{
    @"metadata" : metadata,
    @"nonce" : [nonce.bytesValue copy],
    @"ciphertext" : [ciphertext.bytesValue copy],
  };
}

AncPrivateVaultSealedExportArchive *AncPrivateVaultSealExportArchive(
    NSData *vaultId, NSData *exportId, uint64_t createdAt,
    NSData *sourceSnapshotHash, uint64_t objectCount, NSData *plaintext,
    AncPrivateVaultGuardedMemory *recoveryRoot, NSData *nonce,
    AncPrivateVaultExportArchiveStatus *status) {
  SetStatus(status, AncPrivateVaultExportArchiveStatusInvalid);
  NSMutableData *exportKey =
      [NSMutableData dataWithLength:ANC_PV_KEY_BYTES];
  NSMutableData *workingPlaintext = nil;
  NSMutableData *ciphertext = nil;
  AncPrivateVaultSealedExportArchive *result = nil;
  @try {
    if (!Exact(vaultId, 16) || !Exact(exportId, 16) || createdAt == 0 ||
        createdAt > kMaxSafeInteger || !Exact(sourceSnapshotHash, 32) ||
        objectCount == 0 || objectCount > kMaxSafeInteger ||
        ![plaintext isKindOfClass:NSData.class] || plaintext.length == 0 ||
        plaintext.length > ANC_PV_MAX_EXPORT_BYTES || !Exact(nonce, 24) ||
        recoveryRoot.length != 32 || recoveryRoot.isClosed)
      @throw [NSException exceptionWithName:@"AncInvalid" reason:nil userInfo:nil];
    workingPlaintext = [plaintext mutableCopy];
    NSData *hash = PlaintextHash(workingPlaintext);
    if (hash == nil)
      @throw [NSException exceptionWithName:@"AncCrypto" reason:nil userInfo:nil];
    AncPrivateVaultExportArchiveMetadata *metadata =
        Metadata(vaultId, exportId, createdAt, sourceSnapshotHash, objectCount,
                 hash);
    NSData *header = EncodeMap(HeaderMap(metadata, nonce));
    if (header == nil)
      @throw [NSException exceptionWithName:@"AncEncoding" reason:nil userInfo:nil];
    NSData *aad = DomainData(kExportArchiveDomain,
                             sizeof kExportArchiveDomain, header);
    if (aad == nil)
      @throw [NSException exceptionWithName:@"AncEncoding" reason:nil userInfo:nil];
    __block BOOL derived = NO;
    AncPrivateVaultGuardedMemoryStatus borrowed =
        [recoveryRoot borrow:^BOOL(uint8_t *root, size_t length) {
          derived = length == ANC_PV_KEY_BYTES &&
                    anc_pv_blake2b_256_keyed(
                        exportKey.mutableBytes, kExportKeyDomain,
                        sizeof kExportKeyDomain,
                        root) == ANC_PV_CRYPTO_OK;
          return derived;
        }];
    ciphertext =
        [NSMutableData dataWithLength:workingPlaintext.length + ANC_PV_AUTH_BYTES];
    size_t ciphertextLength = 0;
    if (borrowed != AncPrivateVaultGuardedMemoryStatusOK || !derived ||
        anc_pv_export_xchacha20poly1305_encrypt(
            ciphertext.mutableBytes, ciphertext.length, &ciphertextLength,
            workingPlaintext.bytes, workingPlaintext.length, aad.bytes,
            aad.length, nonce.bytes, exportKey.bytes) != ANC_PV_CRYPTO_OK ||
        ciphertextLength != ciphertext.length)
      @throw [NSException exceptionWithName:@"AncCrypto" reason:nil userInfo:nil];
    NSMutableDictionary *archiveMap = [HeaderMap(metadata, nonce) mutableCopy];
    archiveMap[@464] = B(ciphertext);
    NSData *encoded = EncodeMap(archiveMap);
    if (encoded == nil)
      @throw [NSException exceptionWithName:@"AncEncoding" reason:nil userInfo:nil];
    result = class_createInstance(AncPrivateVaultSealedExportArchive.class, 0);
    result.encodedArchive = encoded;
    result.metadata = metadata;
    object_setClass(result, AncPrivateVaultConcreteSealedExportArchive.class);
    SetStatus(status, AncPrivateVaultExportArchiveStatusOK);
  } @catch (NSException *exception) {
    if ([exception.name isEqualToString:@"AncEncoding"])
      SetStatus(status, AncPrivateVaultExportArchiveStatusEncoding);
    else if ([exception.name isEqualToString:@"AncCrypto"])
      SetStatus(status, AncPrivateVaultExportArchiveStatusCrypto);
  } @finally {
    anc_pv_zeroize(exportKey.mutableBytes, exportKey.length);
    if (workingPlaintext.length > 0)
      anc_pv_zeroize(workingPlaintext.mutableBytes, workingPlaintext.length);
    if (result == nil && ciphertext.length > 0)
      anc_pv_zeroize(ciphertext.mutableBytes, ciphertext.length);
  }
  return result;
}

AncPrivateVaultExportArchiveMetadata *AncPrivateVaultInspectExportArchive(
    NSData *encodedArchive, AncPrivateVaultExportArchiveStatus *status) {
  SetStatus(status, AncPrivateVaultExportArchiveStatusInvalid);
  NSDictionary<NSString *, id> *decoded = Decode(encodedArchive);
  AncPrivateVaultExportArchiveMetadata *metadata = decoded[@"metadata"];
  if (metadata != nil) SetStatus(status, AncPrivateVaultExportArchiveStatusOK);
  return metadata;
}

AncPrivateVaultOpenedExportArchive *AncPrivateVaultOpenExportArchive(
    NSData *encodedArchive, NSData *expectedVaultId,
    AncPrivateVaultGuardedMemory *recoveryRoot,
    AncPrivateVaultExportArchiveStatus *status) {
  SetStatus(status, AncPrivateVaultExportArchiveStatusInvalid);
  NSMutableData *exportKey =
      [NSMutableData dataWithLength:ANC_PV_KEY_BYTES];
  NSMutableData *plaintext = nil;
  AncPrivateVaultOpenedExportArchive *result = nil;
  @try {
    if (!Exact(expectedVaultId, 16) || recoveryRoot.length != 32 ||
        recoveryRoot.isClosed)
      @throw [NSException exceptionWithName:@"AncInvalid" reason:nil userInfo:nil];
    NSDictionary<NSString *, id> *decoded = Decode(encodedArchive);
    AncPrivateVaultExportArchiveMetadata *metadata = decoded[@"metadata"];
    NSData *nonce = decoded[@"nonce"];
    NSData *ciphertext = decoded[@"ciphertext"];
    if (metadata == nil || !Same(metadata.vaultId, expectedVaultId))
      @throw [NSException exceptionWithName:@"AncAuthentication" reason:nil userInfo:nil];
    NSData *header = EncodeMap(HeaderMap(metadata, nonce));
    if (header == nil)
      @throw [NSException exceptionWithName:@"AncEncoding" reason:nil userInfo:nil];
    NSData *aad = DomainData(kExportArchiveDomain,
                             sizeof kExportArchiveDomain, header);
    if (aad == nil)
      @throw [NSException exceptionWithName:@"AncEncoding" reason:nil userInfo:nil];
    __block BOOL derived = NO;
    AncPrivateVaultGuardedMemoryStatus borrowed =
        [recoveryRoot borrow:^BOOL(uint8_t *root, size_t length) {
          derived = length == ANC_PV_KEY_BYTES &&
                    anc_pv_blake2b_256_keyed(
                        exportKey.mutableBytes, kExportKeyDomain,
                        sizeof kExportKeyDomain,
                        root) == ANC_PV_CRYPTO_OK;
          return derived;
        }];
    plaintext = [NSMutableData
        dataWithLength:ciphertext.length - ANC_PV_AUTH_BYTES];
    size_t plaintextLength = 0;
    if (borrowed != AncPrivateVaultGuardedMemoryStatusOK || !derived)
      @throw [NSException exceptionWithName:@"AncCrypto" reason:nil userInfo:nil];
    if (anc_pv_export_xchacha20poly1305_decrypt(
            plaintext.mutableBytes, plaintext.length, &plaintextLength,
            ciphertext.bytes, ciphertext.length, aad.bytes, aad.length,
            nonce.bytes, exportKey.bytes) != ANC_PV_CRYPTO_OK ||
        plaintextLength != plaintext.length)
      @throw [NSException exceptionWithName:@"AncAuthentication" reason:nil userInfo:nil];
    NSData *hash = PlaintextHash(plaintext);
    if (hash == nil || !Same(hash, metadata.plaintextHash))
      @throw [NSException exceptionWithName:@"AncAuthentication" reason:nil userInfo:nil];
    result = class_createInstance(AncPrivateVaultOpenedExportArchive.class, 0);
    result.plaintext = [NSData dataWithData:plaintext];
    result.metadata = metadata;
    object_setClass(result, AncPrivateVaultConcreteOpenedExportArchive.class);
    SetStatus(status, AncPrivateVaultExportArchiveStatusOK);
  } @catch (NSException *exception) {
    if ([exception.name isEqualToString:@"AncEncoding"])
      SetStatus(status, AncPrivateVaultExportArchiveStatusEncoding);
    else if ([exception.name isEqualToString:@"AncCrypto"])
      SetStatus(status, AncPrivateVaultExportArchiveStatusCrypto);
    else if ([exception.name isEqualToString:@"AncAuthentication"])
      SetStatus(status, AncPrivateVaultExportArchiveStatusAuthentication);
  } @finally {
    anc_pv_zeroize(exportKey.mutableBytes, exportKey.length);
    if (plaintext.length > 0)
      anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
  }
  return result;
}

AncPrivateVaultExportArchiveMetadata *AncPrivateVaultVerifyExportArchive(
    NSData *encodedArchive, NSData *expectedVaultId,
    AncPrivateVaultGuardedMemory *recoveryRoot,
    AncPrivateVaultExportArchiveStatus *status) {
  SetStatus(status, AncPrivateVaultExportArchiveStatusInvalid);
  NSMutableData *exportKey =
      [NSMutableData dataWithLength:ANC_PV_KEY_BYTES];
  NSMutableData *plaintext = nil;
  AncPrivateVaultExportArchiveMetadata *result = nil;
  @try {
    if (!Exact(expectedVaultId, 16) || recoveryRoot.length != 32 ||
        recoveryRoot.isClosed)
      @throw [NSException exceptionWithName:@"AncInvalid" reason:nil userInfo:nil];
    NSDictionary<NSString *, id> *decoded = Decode(encodedArchive);
    AncPrivateVaultExportArchiveMetadata *metadata = decoded[@"metadata"];
    NSData *nonce = decoded[@"nonce"];
    NSData *ciphertext = decoded[@"ciphertext"];
    if (metadata == nil || !Same(metadata.vaultId, expectedVaultId))
      @throw [NSException exceptionWithName:@"AncAuthentication"
                                     reason:nil
                                   userInfo:nil];
    NSData *header = EncodeMap(HeaderMap(metadata, nonce));
    if (header == nil)
      @throw [NSException exceptionWithName:@"AncEncoding" reason:nil userInfo:nil];
    NSData *aad = DomainData(kExportArchiveDomain,
                             sizeof kExportArchiveDomain, header);
    if (aad == nil)
      @throw [NSException exceptionWithName:@"AncEncoding" reason:nil userInfo:nil];
    __block BOOL derived = NO;
    AncPrivateVaultGuardedMemoryStatus borrowed =
        [recoveryRoot borrow:^BOOL(uint8_t *root, size_t length) {
          derived = length == ANC_PV_KEY_BYTES &&
                    anc_pv_blake2b_256_keyed(
                        exportKey.mutableBytes, kExportKeyDomain,
                        sizeof kExportKeyDomain,
                        root) == ANC_PV_CRYPTO_OK;
          return derived;
        }];
    plaintext = [NSMutableData
        dataWithLength:ciphertext.length - ANC_PV_AUTH_BYTES];
    size_t plaintextLength = 0;
    if (borrowed != AncPrivateVaultGuardedMemoryStatusOK || !derived)
      @throw [NSException exceptionWithName:@"AncCrypto" reason:nil userInfo:nil];
    if (anc_pv_export_xchacha20poly1305_decrypt(
            plaintext.mutableBytes, plaintext.length, &plaintextLength,
            ciphertext.bytes, ciphertext.length, aad.bytes, aad.length,
            nonce.bytes, exportKey.bytes) != ANC_PV_CRYPTO_OK ||
        plaintextLength != plaintext.length)
      @throw [NSException exceptionWithName:@"AncAuthentication"
                                     reason:nil
                                   userInfo:nil];
    NSData *hash = PlaintextHash(plaintext);
    if (hash == nil || !Same(hash, metadata.plaintextHash))
      @throw [NSException exceptionWithName:@"AncAuthentication"
                                     reason:nil
                                   userInfo:nil];
    result = metadata;
    SetStatus(status, AncPrivateVaultExportArchiveStatusOK);
  } @catch (NSException *exception) {
    if ([exception.name isEqualToString:@"AncEncoding"])
      SetStatus(status, AncPrivateVaultExportArchiveStatusEncoding);
    else if ([exception.name isEqualToString:@"AncCrypto"])
      SetStatus(status, AncPrivateVaultExportArchiveStatusCrypto);
    else if ([exception.name isEqualToString:@"AncAuthentication"])
      SetStatus(status, AncPrivateVaultExportArchiveStatusAuthentication);
  } @finally {
    anc_pv_zeroize(exportKey.mutableBytes, exportKey.length);
    if (plaintext.length > 0)
      anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
  }
  return result;
}

NSString *AncPrivateVaultExportArchiveCategory(
    AncPrivateVaultExportArchiveStatus status) {
  switch (status) {
    case AncPrivateVaultExportArchiveStatusOK:
      return @"ok";
    case AncPrivateVaultExportArchiveStatusInvalid:
      return @"invalid";
    case AncPrivateVaultExportArchiveStatusEncoding:
      return @"encoding";
    case AncPrivateVaultExportArchiveStatusCrypto:
      return @"crypto";
    case AncPrivateVaultExportArchiveStatusAuthentication:
      return @"authentication";
    case AncPrivateVaultExportArchiveStatusCleanup:
      return @"cleanup";
  }
  return @"unknown";
}
