#import "PrivateVaultObjectRevision.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

#import <objc/runtime.h>

static const uint64_t kMaxSafeInteger = UINT64_C(9007199254740991);
static const NSUInteger kMaximumPlaintext = 1024 * 1024;
static const NSUInteger kMaximumEncoded = 1024 * 1024 + 64 * 1024;
static const uint8_t kDekDomain[] = "anc/v1/dek-wrap";
static const uint8_t kHeaderDomain[] = "anc/v1/object-header";
static const uint8_t kChunkDomain[] = "anc/v1/chunk";

@interface AncPrivateVaultSealedObjectRevision ()
@property(nonatomic, readwrite) NSData *encodedRevision;
@property(nonatomic, readwrite) NSData *revisionId;
@property(nonatomic, readwrite) NSData *objectId;
@property(nonatomic, readwrite) uint64_t revision;
@property(nonatomic, readwrite) uint64_t epoch;
@property(nonatomic, readwrite) NSString *contentType;
@property(nonatomic, readwrite) uint64_t plaintextLength;
@end
@implementation AncPrivateVaultSealedObjectRevision
@end

@interface AncPrivateVaultImmutableSealedObjectRevision
    : AncPrivateVaultSealedObjectRevision
@end
@implementation AncPrivateVaultImmutableSealedObjectRevision
- (void)setEncodedRevision:(NSData *)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable object revision"]; }
- (void)setRevisionId:(NSData *)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable object revision"]; }
- (void)setObjectId:(NSData *)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable object revision"]; }
- (void)setRevision:(uint64_t)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable object revision"]; }
- (void)setEpoch:(uint64_t)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable object revision"]; }
- (void)setContentType:(NSString *)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable object revision"]; }
- (void)setPlaintextLength:(uint64_t)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable object revision"]; }
- (void)setValue:(id)value forKey:(NSString *)key { (void)value; (void)key; [NSException raise:NSInternalInconsistencyException format:@"immutable object revision"]; }
@end

@interface AncPrivateVaultOpenedObjectRevision ()
@property(nonatomic, readwrite) NSData *plaintext;
@property(nonatomic, readwrite) NSData *revisionId;
@property(nonatomic, readwrite) NSData *objectId;
@property(nonatomic, readwrite) uint64_t revision;
@property(nonatomic, readwrite) uint64_t epoch;
@property(nonatomic, readwrite) NSString *contentType;
@property(nonatomic, readwrite) NSData *writerEndpointId;
@end
@implementation AncPrivateVaultOpenedObjectRevision
@end

@interface AncPrivateVaultImmutableOpenedObjectRevision
    : AncPrivateVaultOpenedObjectRevision
@end
@implementation AncPrivateVaultImmutableOpenedObjectRevision
- (void)setPlaintext:(NSData *)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable opened object revision"]; }
- (void)setRevisionId:(NSData *)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable opened object revision"]; }
- (void)setObjectId:(NSData *)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable opened object revision"]; }
- (void)setRevision:(uint64_t)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable opened object revision"]; }
- (void)setEpoch:(uint64_t)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable opened object revision"]; }
- (void)setContentType:(NSString *)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable opened object revision"]; }
- (void)setWriterEndpointId:(NSData *)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable opened object revision"]; }
- (void)setValue:(id)value forKey:(NSString *)key { (void)value; (void)key; [NSException raise:NSInternalInconsistencyException format:@"immutable opened object revision"]; }
@end

@interface AncPrivateVaultInspectedObjectRevision ()
@property(nonatomic, readwrite) NSData *objectId;
@property(nonatomic, readwrite) uint64_t revision;
@property(nonatomic, readwrite) uint64_t epoch;
@property(nonatomic, readwrite) NSString *contentType;
@property(nonatomic, readwrite) NSData *writerEndpointId;
@end
@implementation AncPrivateVaultInspectedObjectRevision
@end

@interface AncPrivateVaultImmutableInspectedObjectRevision
    : AncPrivateVaultInspectedObjectRevision
@end
@implementation AncPrivateVaultImmutableInspectedObjectRevision
- (void)setObjectId:(NSData *)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable inspected object revision"]; }
- (void)setRevision:(uint64_t)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable inspected object revision"]; }
- (void)setEpoch:(uint64_t)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable inspected object revision"]; }
- (void)setContentType:(NSString *)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable inspected object revision"]; }
- (void)setWriterEndpointId:(NSData *)value { (void)value; [NSException raise:NSInternalInconsistencyException format:@"immutable inspected object revision"]; }
- (void)setValue:(id)value forKey:(NSString *)key { (void)value; (void)key; [NSException raise:NSInternalInconsistencyException format:@"immutable inspected object revision"]; }
@end

static void SetStatus(AncPrivateVaultObjectRevisionStatus *status,
                      AncPrivateVaultObjectRevisionStatus value) {
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

static NSData *EncodeMap(NSDictionary *map) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *value =
      [AncPrivateVaultCanonicalValue map:map];
  return value == nil ? nil : AncPrivateVaultCanonicalEncode(value, &status);
}

static NSDictionary *DecodeMap(NSData *encoded, NSUInteger maximum) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *value =
      AncPrivateVaultCanonicalDecode(encoded, maximum, &status);
  return value.type == AncPrivateVaultCanonicalTypeMap ? value.mapValue : nil;
}

static AncPrivateVaultCanonicalValue *Field(NSDictionary *map, NSNumber *key,
                                             AncPrivateVaultCanonicalType type) {
  AncPrivateVaultCanonicalValue *value = map[key];
  return value.type == type ? value : nil;
}

static BOOL Keys(NSDictionary *map, NSArray *keys) {
  return map.count == keys.count &&
         [[NSSet setWithArray:map.allKeys]
             isEqualToSet:[NSSet setWithArray:keys]];
}

static NSDictionary *Common(NSData *vaultId, NSString *type,
                            uint64_t createdAt, NSData *envelopeId) {
  AncPrivateVaultCanonicalValue *created = I(createdAt);
  if (!Exact(vaultId, 16) || !Exact(envelopeId, 16) || created == nil)
    return nil;
  return @{@1 : T(@"anc/v1"), @2 : B(vaultId), @3 : T(type),
           @4 : created, @5 : B(envelopeId)};
}

static NSData *DomainData(const uint8_t *domain, size_t domainLength,
                          NSData *payload) {
  NSMutableData *value = [NSMutableData dataWithBytes:domain
                                                length:domainLength];
  [value appendData:payload];
  return value;
}

static NSData *Hash(const uint8_t *domain, size_t domainLength,
                    NSData *payload) {
  uint8_t output[32] = {0};
  BOOL valid = payload != nil &&
               anc_pv_blake2b_256_two_part(output, domain, domainLength,
                                           payload.bytes, payload.length) ==
                   ANC_PV_CRYPTO_OK;
  NSData *result =
      valid ? [NSData dataWithBytes:output length:sizeof output] : nil;
  anc_pv_zeroize(output, sizeof output);
  return result;
}

static NSData *HexBytes(NSString *hex) {
  if (![hex isKindOfClass:NSString.class] || hex.length != 32) return nil;
  NSMutableData *result = [NSMutableData dataWithLength:16];
  uint8_t *bytes = result.mutableBytes;
  for (NSUInteger index = 0; index < 16; index++) {
    unichar high = [hex characterAtIndex:index * 2];
    unichar low = [hex characterAtIndex:index * 2 + 1];
    int a = high >= '0' && high <= '9' ? high - '0'
            : high >= 'a' && high <= 'f' ? high - 'a' + 10 : -1;
    int b = low >= '0' && low <= '9' ? low - '0'
            : low >= 'a' && low <= 'f' ? low - 'a' + 10 : -1;
    if (a < 0 || b < 0) return nil;
    bytes[index] = (uint8_t)((a << 4) | b);
  }
  return result;
}

static NSData *Sign(NSData *payload, AncPrivateVaultGuardedMemory *privateKey,
                    const uint8_t *domain, size_t domainLength) {
  if (payload == nil || privateKey == nil) return nil;
  NSMutableData *signature = [NSMutableData dataWithLength:64];
  NSData *message = DomainData(domain, domainLength, payload);
  __block BOOL signedValue = NO;
  AncPrivateVaultGuardedMemoryStatus borrowed =
      [privateKey borrow:^BOOL(uint8_t *bytes, size_t length) {
        signedValue = length == 64 &&
                      anc_pv_ed25519_sign(signature.mutableBytes,
                                         message.bytes, message.length,
                                         bytes) == ANC_PV_CRYPTO_OK;
        return signedValue;
      }];
  return borrowed == AncPrivateVaultGuardedMemoryStatusOK && signedValue
             ? [NSData dataWithData:signature]
             : nil;
}

static NSData *ChunkAAD(NSData *objectId, uint64_t revision) {
  return EncodeMap(@{@50 : B(objectId), @51 : I(revision), @132 : I(0),
                     @133 : I(1)});
}

static BOOL CommonValid(NSDictionary *map, NSData *vaultId, NSString *type) {
  AncPrivateVaultCanonicalValue *suite =
      Field(map, @1, AncPrivateVaultCanonicalTypeText);
  AncPrivateVaultCanonicalValue *vault =
      Field(map, @2, AncPrivateVaultCanonicalTypeBytes);
  AncPrivateVaultCanonicalValue *kind =
      Field(map, @3, AncPrivateVaultCanonicalTypeText);
  AncPrivateVaultCanonicalValue *created =
      Field(map, @4, AncPrivateVaultCanonicalTypeInteger);
  AncPrivateVaultCanonicalValue *envelope =
      Field(map, @5, AncPrivateVaultCanonicalTypeBytes);
  return [suite.textValue isEqualToString:@"anc/v1"] &&
         Same(vault.bytesValue, vaultId) &&
         [kind.textValue isEqualToString:type] && created.integerValue > 0 &&
         (uint64_t)created.integerValue <= kMaxSafeInteger &&
         Exact(envelope.bytesValue, 16);
}

static uint64_t PositiveInteger(NSDictionary *map, NSNumber *key) {
  AncPrivateVaultCanonicalValue *value =
      Field(map, key, AncPrivateVaultCanonicalTypeInteger);
  return value.integerValue > 0 &&
                 (uint64_t)value.integerValue <= kMaxSafeInteger
             ? (uint64_t)value.integerValue
             : 0;
}

static uint64_t CreatedAt(NSDictionary *map) {
  return PositiveInteger(map, @4);
}

AncPrivateVaultSealedObjectRevision *AncPrivateVaultSealObjectRevision(
    NSData *vaultId, NSData *objectId, NSData *writerEndpointId,
    uint64_t revision, uint64_t epoch,
    NSString *contentType, NSData *plaintext, uint64_t createdAt,
    NSData *dekEnvelopeId, NSData *headerEnvelopeId, NSData *chunkEnvelopeId,
    NSData *dekNonce, AncPrivateVaultControlLogState *authenticatedState,
    AncPrivateVaultGuardedMemory *writerSigningSeed,
    AncPrivateVaultGuardedMemory *epochKey,
    AncPrivateVaultObjectRevisionStatus *status) {
  SetStatus(status, AncPrivateVaultObjectRevisionStatusInvalid);
  AncPrivateVaultGuardedMemory *signingPrivate = nil;
  AncPrivateVaultGuardedMemory *dek = nil;
  AncPrivateVaultSealedObjectRevision *result = nil;
  @try {
    if (!Exact(vaultId, 16) || !Exact(objectId, 16) ||
        !Exact(writerEndpointId, 16) || revision == 0 ||
        revision > kMaxSafeInteger || epoch == 0 || epoch > kMaxSafeInteger ||
        createdAt == 0 || createdAt > kMaxSafeInteger ||
        ![contentType isKindOfClass:NSString.class] ||
        contentType.length == 0 ||
        [contentType lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 120 ||
        ![plaintext isKindOfClass:NSData.class] || plaintext.length == 0 ||
        plaintext.length > kMaximumPlaintext || !Exact(dekEnvelopeId, 16) ||
        !Exact(headerEnvelopeId, 16) || !Exact(chunkEnvelopeId, 16) ||
        !Exact(dekNonce, 24) || authenticatedState == nil ||
        authenticatedState.epoch != epoch ||
        !Same(HexBytes(authenticatedState.vaultId), vaultId) ||
        writerSigningSeed.length != 32 ||
        epochKey.length != 32 || writerSigningSeed.isClosed ||
        epochKey.isClosed)
      @throw [NSException exceptionWithName:@"AncInvalid" reason:nil userInfo:nil];
    AncPrivateVaultGuardedMemoryStatus memoryStatus;
    signingPrivate = [AncPrivateVaultGuardedMemory memoryWithLength:64
                                                            status:&memoryStatus];
    dek = [AncPrivateVaultGuardedMemory memoryWithLength:32 status:&memoryStatus];
    NSMutableData *writerPublic = [NSMutableData dataWithLength:32];
    if (signingPrivate == nil || dek == nil)
      @throw [NSException exceptionWithName:@"AncCrypto" reason:nil userInfo:nil];
    __block BOOL derived = NO;
    AncPrivateVaultGuardedMemoryStatus signingBorrow =
        [signingPrivate borrow:^BOOL(uint8_t *privateBytes, size_t privateLength) {
          return privateLength == 64 &&
                 [writerSigningSeed borrow:^BOOL(uint8_t *seed,
                                                  size_t seedLength) {
                   derived = seedLength == 32 &&
                             anc_pv_ed25519_seed_keypair(
                                 writerPublic.mutableBytes, privateBytes,
                                 seed) == ANC_PV_CRYPTO_OK;
                   return derived;
                 }] == AncPrivateVaultGuardedMemoryStatusOK && derived;
        }];
    __block BOOL randomized = NO;
    AncPrivateVaultGuardedMemoryStatus dekRandom =
        [dek borrow:^BOOL(uint8_t *bytes, size_t length) {
          randomized = length == 32 &&
                       anc_pv_random(bytes, length) == ANC_PV_CRYPTO_OK;
          return randomized;
        }];
    if (signingBorrow != AncPrivateVaultGuardedMemoryStatusOK || !derived ||
        dekRandom != AncPrivateVaultGuardedMemoryStatusOK || !randomized)
      @throw [NSException exceptionWithName:@"AncCrypto" reason:nil userInfo:nil];
    NSMutableString *writerHex = [NSMutableString stringWithCapacity:32];
    const uint8_t *writerBytes = writerEndpointId.bytes;
    for (NSUInteger index = 0; index < 16; index++)
      [writerHex appendFormat:@"%02x", writerBytes[index]];
    AncPrivateVaultControlLogMember *activeWriter = nil;
    for (AncPrivateVaultControlLogMember *candidate in
         authenticatedState.activeMembers) {
      if ([candidate.endpointId isEqualToString:writerHex]) {
        if (activeWriter != nil)
          @throw [NSException exceptionWithName:@"AncBinding" reason:nil userInfo:nil];
        activeWriter = candidate;
      }
    }
    if (activeWriter == nil || !Same(activeWriter.signingPublicKey, writerPublic))
      @throw [NSException exceptionWithName:@"AncBinding" reason:nil userInfo:nil];

    NSMutableDictionary *dekMap =
        [Common(vaultId, @"dek-wrap", createdAt, dekEnvelopeId) mutableCopy];
    dekMap[@40] = B(objectId); dekMap[@41] = I(revision);
    dekMap[@42] = I(epoch); dekMap[@43] = B(dekNonce);
    NSData *dekAAD = EncodeMap(dekMap);
    NSData *dekDomainAAD = DomainData(kDekDomain, sizeof kDekDomain, dekAAD);
    NSMutableData *wrappedDek = [NSMutableData dataWithLength:48];
    __block BOOL wrapped = NO;
    __block size_t wrappedLength = 0;
    AncPrivateVaultGuardedMemoryStatus wrapBorrow =
        [epochKey borrow:^BOOL(uint8_t *epochBytes, size_t epochLength) {
          if (epochLength != 32) return NO;
          return [dek borrow:^BOOL(uint8_t *dekBytes, size_t dekLength) {
            wrapped = dekLength == 32 &&
                      anc_pv_xchacha20poly1305_encrypt(
                          wrappedDek.mutableBytes, wrappedDek.length,
                          &wrappedLength, dekBytes, dekLength,
                          dekDomainAAD.bytes, dekDomainAAD.length,
                          dekNonce.bytes, epochBytes) == ANC_PV_CRYPTO_OK &&
                      wrappedLength == 48;
            return wrapped;
          }] == AncPrivateVaultGuardedMemoryStatusOK && wrapped;
        }];
    if (wrapBorrow != AncPrivateVaultGuardedMemoryStatusOK || !wrapped)
      @throw [NSException exceptionWithName:@"AncCrypto" reason:nil userInfo:nil];
    dekMap[@44] = B(wrappedDek);
    NSData *encodedDek = EncodeMap(dekMap);
    NSData *dekHash = Hash(kDekDomain, sizeof kDekDomain, encodedDek);

    if (encodedDek == nil || dekHash == nil)
      @throw [NSException exceptionWithName:@"AncEncoding" reason:nil userInfo:nil];

    NSMutableDictionary *headerMap =
        [Common(vaultId, @"object-header", createdAt, headerEnvelopeId)
            mutableCopy];
    headerMap[@50] = B(objectId); headerMap[@51] = I(revision);
    headerMap[@52] = I(epoch); headerMap[@53] = I(1);
    headerMap[@54] = I(plaintext.length); headerMap[@55] = T(contentType);
    headerMap[@56] = B(dekHash); headerMap[@57] = B(writerEndpointId);
    NSData *unsignedHeader = EncodeMap(headerMap);
    NSData *headerSignature = Sign(unsignedHeader, signingPrivate,
                                   kHeaderDomain, sizeof kHeaderDomain);
    if (unsignedHeader == nil || headerSignature == nil)
      @throw [NSException exceptionWithName:@"AncCrypto" reason:nil userInfo:nil];
    headerMap[@58] = B(headerSignature);
    NSData *encodedHeader = EncodeMap(headerMap);

    NSData *chunkAAD = ChunkAAD(objectId, revision);
    NSData *chunkDomainAAD =
        DomainData(kChunkDomain, sizeof kChunkDomain, chunkAAD);
    NSMutableData *streamHeader = [NSMutableData dataWithLength:24];
    NSMutableData *streamCiphertext =
        [NSMutableData dataWithLength:plaintext.length + 17];
    __block BOOL encrypted = NO;
    __block size_t streamLength = 0;
    AncPrivateVaultGuardedMemoryStatus streamBorrow =
        [dek borrow:^BOOL(uint8_t *dekBytes, size_t dekLength) {
          encrypted = dekLength == 32 &&
                      anc_pv_secretstream_encrypt_final(
                          streamHeader.mutableBytes,
                          streamCiphertext.mutableBytes,
                          streamCiphertext.length, &streamLength,
                          plaintext.bytes, plaintext.length,
                          chunkDomainAAD.bytes, chunkDomainAAD.length,
                          dekBytes) == ANC_PV_CRYPTO_OK &&
                      streamLength == streamCiphertext.length;
          return encrypted;
        }];
    if (streamBorrow != AncPrivateVaultGuardedMemoryStatusOK || !encrypted)
      @throw [NSException exceptionWithName:@"AncCrypto" reason:nil userInfo:nil];
    NSMutableDictionary *chunkMap =
        [Common(vaultId, @"chunk", createdAt, chunkEnvelopeId) mutableCopy];
    chunkMap[@130] = B(objectId); chunkMap[@131] = I(revision);
    chunkMap[@132] = I(0); chunkMap[@133] = I(1);
    chunkMap[@134] = B(streamHeader); chunkMap[@135] = B(streamCiphertext);
    NSData *encodedChunk = EncodeMap(chunkMap);
    if (encodedHeader == nil || encodedChunk == nil)
      @throw [NSException exceptionWithName:@"AncEncoding" reason:nil userInfo:nil];

    NSData *bundle = EncodeMap(@{
      @1 : T(@"anc/v1-object-bundle"),
      @2 : B(encodedDek),
      @3 : B(encodedHeader),
      @4 : [AncPrivateVaultCanonicalValue array:@[ B(encodedChunk) ]]
    });
    NSData *revisionId =
        Hash(kHeaderDomain, sizeof kHeaderDomain, encodedHeader);
    if (bundle == nil || revisionId == nil ||
        bundle.length > kMaximumEncoded)
      @throw [NSException exceptionWithName:@"AncEncoding" reason:nil userInfo:nil];
    result = class_createInstance(AncPrivateVaultSealedObjectRevision.class, 0);
    result.encodedRevision = bundle;
    result.revisionId = revisionId;
    result.objectId = [objectId copy];
    result.revision = revision;
    result.epoch = epoch;
    result.contentType = [contentType copy];
    result.plaintextLength = plaintext.length;
    object_setClass(result,
                    AncPrivateVaultImmutableSealedObjectRevision.class);
    SetStatus(status, AncPrivateVaultObjectRevisionStatusOK);
  } @catch (NSException *exception) {
    if ([exception.name isEqualToString:@"AncBinding"])
      SetStatus(status, AncPrivateVaultObjectRevisionStatusBinding);
    else if ([exception.name isEqualToString:@"AncCrypto"])
      SetStatus(status, AncPrivateVaultObjectRevisionStatusCrypto);
    else if ([exception.name isEqualToString:@"AncEncoding"])
      SetStatus(status, AncPrivateVaultObjectRevisionStatusEncoding);
  }
  BOOL signingClosed = signingPrivate == nil ||
      [signingPrivate close] == AncPrivateVaultGuardedMemoryStatusOK;
  BOOL dekClosed = dek == nil || [dek close] == AncPrivateVaultGuardedMemoryStatusOK;
  if (!signingClosed || !dekClosed) {
    SetStatus(status, AncPrivateVaultObjectRevisionStatusCleanup);
    return nil;
  }
  return result;
}

AncPrivateVaultInspectedObjectRevision *AncPrivateVaultInspectObjectRevision(
    NSData *encodedRevision, NSData *expectedVaultId,
    NSData *expectedObjectId,
    AncPrivateVaultControlLogState *authenticatedState,
    AncPrivateVaultObjectRevisionStatus *status) {
  SetStatus(status, AncPrivateVaultObjectRevisionStatusInvalid);
  AncPrivateVaultInspectedObjectRevision *result = nil;
  @try {
    if (![encodedRevision isKindOfClass:NSData.class] ||
        encodedRevision.length == 0 || encodedRevision.length > kMaximumEncoded ||
        !Exact(expectedVaultId, 16) ||
        (expectedObjectId != nil && !Exact(expectedObjectId, 16)) ||
        authenticatedState == nil || authenticatedState.epoch == 0 ||
        authenticatedState.epoch > kMaxSafeInteger ||
        !Same(HexBytes(authenticatedState.vaultId), expectedVaultId))
      @throw [NSException exceptionWithName:@"AncInvalid" reason:nil userInfo:nil];
    NSDictionary *bundle = DecodeMap(encodedRevision, kMaximumEncoded);
    NSArray *parts = Field(bundle, @4, AncPrivateVaultCanonicalTypeArray).arrayValue;
    if (!Keys(bundle, @[@1,@2,@3,@4]) ||
        ![Field(bundle, @1, AncPrivateVaultCanonicalTypeText).textValue
            isEqualToString:@"anc/v1-object-bundle"] ||
        Field(bundle, @2, AncPrivateVaultCanonicalTypeBytes) == nil ||
        Field(bundle, @3, AncPrivateVaultCanonicalTypeBytes) == nil ||
        parts.count != 1 ||
        ((AncPrivateVaultCanonicalValue *)parts[0]).type !=
            AncPrivateVaultCanonicalTypeBytes)
      @throw [NSException exceptionWithName:@"AncEncoding" reason:nil userInfo:nil];
    NSData *encodedDek = Field(bundle, @2, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *encodedHeader = Field(bundle, @3, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *encodedChunk = ((AncPrivateVaultCanonicalValue *)parts[0]).bytesValue;
    NSDictionary *dekMap = DecodeMap(encodedDek, 64 * 1024);
    NSDictionary *headerMap = DecodeMap(encodedHeader, 64 * 1024);
    NSDictionary *chunkMap = DecodeMap(encodedChunk, kMaximumEncoded);
    if (!Keys(dekMap, @[@1,@2,@3,@4,@5,@40,@41,@42,@43,@44]) ||
        !Keys(headerMap, @[@1,@2,@3,@4,@5,@50,@51,@52,@53,@54,@55,@56,@57,@58]) ||
        !Keys(chunkMap, @[@1,@2,@3,@4,@5,@130,@131,@132,@133,@134,@135]) ||
        !CommonValid(dekMap, expectedVaultId, @"dek-wrap") ||
        !CommonValid(headerMap, expectedVaultId, @"object-header") ||
        !CommonValid(chunkMap, expectedVaultId, @"chunk") ||
        CreatedAt(dekMap) != CreatedAt(headerMap) ||
        CreatedAt(dekMap) != CreatedAt(chunkMap))
      @throw [NSException exceptionWithName:@"AncEncoding" reason:nil userInfo:nil];
    NSData *dekObject = Field(dekMap, @40, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *headerObject = Field(headerMap, @50, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *chunkObject = Field(chunkMap, @130, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    uint64_t revision = PositiveInteger(dekMap, @41);
    uint64_t headerRevision = PositiveInteger(headerMap, @51);
    uint64_t chunkRevision = PositiveInteger(chunkMap, @131);
    uint64_t epoch = PositiveInteger(dekMap, @42);
    uint64_t headerEpoch = PositiveInteger(headerMap, @52);
    uint64_t chunkCount = PositiveInteger(headerMap, @53);
    uint64_t plaintextLength = PositiveInteger(headerMap, @54);
    NSString *contentType = Field(headerMap, @55, AncPrivateVaultCanonicalTypeText).textValue;
    NSData *dekRef = Field(headerMap, @56, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *writerId = Field(headerMap, @57, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *signature = Field(headerMap, @58, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    int64_t chunkIndex = Field(chunkMap, @132, AncPrivateVaultCanonicalTypeInteger).integerValue;
    uint64_t encodedChunkCount = PositiveInteger(chunkMap, @133);
    NSData *streamHeader = Field(chunkMap, @134, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *streamCiphertext = Field(chunkMap, @135, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *nonce = Field(dekMap, @43, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *wrappedDek = Field(dekMap, @44, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    if (!Exact(dekObject, 16) || !Same(dekObject, headerObject) ||
        !Same(dekObject, chunkObject) ||
        (expectedObjectId != nil && !Same(dekObject, expectedObjectId)) ||
        revision == 0 || revision != headerRevision || revision != chunkRevision ||
        epoch != authenticatedState.epoch || headerEpoch != epoch ||
        chunkCount != 1 || encodedChunkCount != 1 || chunkIndex != 0 ||
        plaintextLength == 0 || plaintextLength > kMaximumPlaintext ||
        contentType.length == 0 ||
        [contentType lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 120 ||
        !Exact(dekRef, 32) || !Exact(writerId, 16) || !Exact(signature, 64) ||
        !Exact(nonce, 24) || !Exact(wrappedDek, 48) ||
        !Exact(streamHeader, 24) ||
        streamCiphertext.length != plaintextLength + 17 ||
        !Same(Hash(kDekDomain, sizeof kDekDomain, encodedDek), dekRef))
      @throw [NSException exceptionWithName:@"AncBinding" reason:nil userInfo:nil];
    NSMutableString *writerHex = [NSMutableString stringWithCapacity:32];
    const uint8_t *writerBytes = writerId.bytes;
    for (NSUInteger index = 0; index < 16; index++)
      [writerHex appendFormat:@"%02x", writerBytes[index]];
    AncPrivateVaultControlLogMember *member = nil;
    for (AncPrivateVaultControlLogMember *candidate in authenticatedState.activeMembers) {
      if ([candidate.endpointId isEqualToString:writerHex]) {
        if (member != nil)
          @throw [NSException exceptionWithName:@"AncBinding" reason:nil userInfo:nil];
        member = candidate;
      }
    }
    NSMutableDictionary *unsignedHeaderMap = [headerMap mutableCopy];
    [unsignedHeaderMap removeObjectForKey:@58];
    NSData *headerMessage = DomainData(
        kHeaderDomain, sizeof kHeaderDomain, EncodeMap(unsignedHeaderMap));
    if (member == nil || !Exact(member.signingPublicKey, 32) ||
        anc_pv_ed25519_verify(signature.bytes, headerMessage.bytes,
                             headerMessage.length,
                             member.signingPublicKey.bytes) != ANC_PV_CRYPTO_OK)
      @throw [NSException exceptionWithName:@"AncSignature" reason:nil userInfo:nil];
    result = class_createInstance(AncPrivateVaultInspectedObjectRevision.class, 0);
    result.objectId = [dekObject copy];
    result.revision = revision;
    result.epoch = epoch;
    result.contentType = [contentType copy];
    result.writerEndpointId = [writerId copy];
    object_setClass(result, AncPrivateVaultImmutableInspectedObjectRevision.class);
    SetStatus(status, AncPrivateVaultObjectRevisionStatusOK);
  } @catch (NSException *exception) {
    if ([exception.name isEqualToString:@"AncBinding"])
      SetStatus(status, AncPrivateVaultObjectRevisionStatusBinding);
    else if ([exception.name isEqualToString:@"AncSignature"])
      SetStatus(status, AncPrivateVaultObjectRevisionStatusSignature);
    else if ([exception.name isEqualToString:@"AncEncoding"])
      SetStatus(status, AncPrivateVaultObjectRevisionStatusEncoding);
  }
  return result;
}

AncPrivateVaultOpenedObjectRevision *AncPrivateVaultOpenObjectRevision(
    NSData *encodedRevision, NSData *expectedVaultId,
    NSData *expectedObjectId, AncPrivateVaultControlLogState *authenticatedState,
    AncPrivateVaultGuardedMemory *epochKey,
    AncPrivateVaultObjectRevisionStatus *status) {
  SetStatus(status, AncPrivateVaultObjectRevisionStatusInvalid);
  AncPrivateVaultGuardedMemory *dek = nil;
  AncPrivateVaultOpenedObjectRevision *result = nil;
  @try {
    if (![encodedRevision isKindOfClass:NSData.class] ||
        encodedRevision.length == 0 ||
        encodedRevision.length > kMaximumEncoded ||
        !Exact(expectedVaultId, 16) ||
        (expectedObjectId != nil && !Exact(expectedObjectId, 16)) ||
        authenticatedState == nil || epochKey.length != 32 ||
        epochKey.isClosed || authenticatedState.epoch == 0 ||
        authenticatedState.epoch > kMaxSafeInteger ||
        !Same(HexBytes(authenticatedState.vaultId), expectedVaultId))
      @throw [NSException exceptionWithName:@"AncInvalid" reason:nil userInfo:nil];
    NSDictionary *bundle = DecodeMap(encodedRevision, kMaximumEncoded);
    NSArray *parts =
        Field(bundle, @4, AncPrivateVaultCanonicalTypeArray).arrayValue;
    if (!Keys(bundle, @[ @1, @2, @3, @4 ]) ||
        ![Field(bundle, @1, AncPrivateVaultCanonicalTypeText).textValue
            isEqualToString:@"anc/v1-object-bundle"] ||
        Field(bundle, @2, AncPrivateVaultCanonicalTypeBytes) == nil ||
        Field(bundle, @3, AncPrivateVaultCanonicalTypeBytes) == nil ||
        parts.count != 1 ||
        ((AncPrivateVaultCanonicalValue *)parts[0]).type !=
            AncPrivateVaultCanonicalTypeBytes)
      @throw [NSException exceptionWithName:@"AncEncoding" reason:nil userInfo:nil];
    NSData *encodedDek =
        Field(bundle, @2, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *encodedHeader =
        Field(bundle, @3, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *encodedChunk =
        ((AncPrivateVaultCanonicalValue *)parts[0]).bytesValue;
    NSDictionary *dekMap = DecodeMap(encodedDek, 64 * 1024);
    NSDictionary *headerMap = DecodeMap(encodedHeader, 64 * 1024);
    NSDictionary *chunkMap = DecodeMap(encodedChunk, kMaximumEncoded);
    if (!Keys(dekMap, @[@1,@2,@3,@4,@5,@40,@41,@42,@43,@44]) ||
        !Keys(headerMap,
              @[@1,@2,@3,@4,@5,@50,@51,@52,@53,@54,@55,@56,@57,@58]) ||
        !Keys(chunkMap,
              @[@1,@2,@3,@4,@5,@130,@131,@132,@133,@134,@135]) ||
        !CommonValid(dekMap, expectedVaultId, @"dek-wrap") ||
        !CommonValid(headerMap, expectedVaultId, @"object-header") ||
        !CommonValid(chunkMap, expectedVaultId, @"chunk") ||
        CreatedAt(dekMap) != CreatedAt(headerMap) ||
        CreatedAt(dekMap) != CreatedAt(chunkMap))
      @throw [NSException exceptionWithName:@"AncEncoding" reason:nil userInfo:nil];

    NSData *dekObject = Field(dekMap, @40,
                              AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *headerObject = Field(headerMap, @50,
                                 AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *chunkObject = Field(chunkMap, @130,
                                AncPrivateVaultCanonicalTypeBytes).bytesValue;
    uint64_t dekRevision = PositiveInteger(dekMap, @41);
    uint64_t headerRevision = PositiveInteger(headerMap, @51);
    uint64_t chunkRevision = PositiveInteger(chunkMap, @131);
    uint64_t dekEpoch = PositiveInteger(dekMap, @42);
    uint64_t headerEpoch = PositiveInteger(headerMap, @52);
    uint64_t chunkCount = PositiveInteger(headerMap, @53);
    uint64_t plaintextLength = PositiveInteger(headerMap, @54);
    NSString *contentType =
        Field(headerMap, @55, AncPrivateVaultCanonicalTypeText).textValue;
    NSData *dekRef = Field(headerMap, @56,
                           AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *writerId = Field(headerMap, @57,
                             AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *signature = Field(headerMap, @58,
                              AncPrivateVaultCanonicalTypeBytes).bytesValue;
    int64_t chunkIndex =
        Field(chunkMap, @132, AncPrivateVaultCanonicalTypeInteger).integerValue;
    uint64_t encodedChunkCount = PositiveInteger(chunkMap, @133);
    NSData *streamHeader = Field(chunkMap, @134,
                                 AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *streamCiphertext = Field(
        chunkMap, @135, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *nonce =
        Field(dekMap, @43, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    NSData *wrappedDek =
        Field(dekMap, @44, AncPrivateVaultCanonicalTypeBytes).bytesValue;
    if (!Exact(dekObject, 16) || !Same(dekObject, headerObject) ||
        !Same(dekObject, chunkObject) ||
        (expectedObjectId != nil && !Same(dekObject, expectedObjectId)) ||
        dekRevision == 0 || dekRevision != headerRevision ||
        dekRevision != chunkRevision || dekEpoch != authenticatedState.epoch ||
        headerEpoch != dekEpoch || chunkCount != 1 || encodedChunkCount != 1 ||
        chunkIndex != 0 || plaintextLength == 0 ||
        plaintextLength > kMaximumPlaintext || contentType.length == 0 ||
        [contentType lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 120 ||
        !Exact(dekRef, 32) ||
        !Exact(writerId, 16) || !Exact(signature, 64) || !Exact(nonce, 24) ||
        !Exact(wrappedDek, 48) || !Exact(streamHeader, 24) ||
        streamCiphertext.length != plaintextLength + 17 ||
        !Same(Hash(kDekDomain, sizeof kDekDomain, encodedDek), dekRef))
      @throw [NSException exceptionWithName:@"AncBinding" reason:nil userInfo:nil];

    NSString *writerHex = nil;
    const uint8_t *writerBytes = writerId.bytes;
    NSMutableString *writer = [NSMutableString stringWithCapacity:32];
    for (NSUInteger index = 0; index < 16; index++)
      [writer appendFormat:@"%02x", writerBytes[index]];
    writerHex = writer;
    AncPrivateVaultControlLogMember *member = nil;
    for (AncPrivateVaultControlLogMember *candidate in
         authenticatedState.activeMembers) {
      if ([candidate.endpointId isEqualToString:writerHex]) {
        if (member != nil)
          @throw [NSException exceptionWithName:@"AncBinding" reason:nil userInfo:nil];
        member = candidate;
      }
    }
    NSMutableDictionary *unsignedHeaderMap = [headerMap mutableCopy];
    [unsignedHeaderMap removeObjectForKey:@58];
    NSData *unsignedHeader = EncodeMap(unsignedHeaderMap);
    NSData *headerMessage =
        DomainData(kHeaderDomain, sizeof kHeaderDomain, unsignedHeader);
    if (member == nil || !Exact(member.signingPublicKey, 32) ||
        anc_pv_ed25519_verify(signature.bytes, headerMessage.bytes,
                             headerMessage.length,
                             member.signingPublicKey.bytes) !=
            ANC_PV_CRYPTO_OK)
      @throw [NSException exceptionWithName:@"AncSignature" reason:nil userInfo:nil];

    AncPrivateVaultGuardedMemoryStatus memoryStatus;
    dek = [AncPrivateVaultGuardedMemory memoryWithLength:32 status:&memoryStatus];
    if (dek == nil)
      @throw [NSException exceptionWithName:@"AncCrypto" reason:nil userInfo:nil];
    NSMutableDictionary *dekAADMap = [dekMap mutableCopy];
    [dekAADMap removeObjectForKey:@44];
    NSData *dekAAD = EncodeMap(dekAADMap);
    NSData *dekDomainAAD = DomainData(kDekDomain, sizeof kDekDomain, dekAAD);
    __block BOOL unwrapped = NO;
    __block size_t dekLength = 0;
    AncPrivateVaultGuardedMemoryStatus unwrapBorrow =
        [epochKey borrow:^BOOL(uint8_t *epochBytes, size_t epochLength) {
          if (epochLength != 32) return NO;
          return [dek borrow:^BOOL(uint8_t *dekBytes, size_t capacity) {
            unwrapped = capacity == 32 &&
                        anc_pv_xchacha20poly1305_decrypt(
                            dekBytes, capacity, &dekLength, wrappedDek.bytes,
                            wrappedDek.length, dekDomainAAD.bytes,
                            dekDomainAAD.length, nonce.bytes,
                            epochBytes) == ANC_PV_CRYPTO_OK &&
                        dekLength == 32;
            return unwrapped;
          }] == AncPrivateVaultGuardedMemoryStatusOK && unwrapped;
        }];
    if (unwrapBorrow != AncPrivateVaultGuardedMemoryStatusOK || !unwrapped)
      @throw [NSException exceptionWithName:@"AncCrypto" reason:nil userInfo:nil];

    NSData *chunkAAD = ChunkAAD(dekObject, dekRevision);
    NSData *chunkDomainAAD =
        DomainData(kChunkDomain, sizeof kChunkDomain, chunkAAD);
    NSMutableData *plaintext = [NSMutableData dataWithLength:plaintextLength];
    __block BOOL opened = NO;
    __block size_t openedLength = 0;
    AncPrivateVaultGuardedMemoryStatus openBorrow =
        [dek borrow:^BOOL(uint8_t *dekBytes, size_t length) {
          opened = length == 32 &&
                   anc_pv_secretstream_decrypt_final(
                       plaintext.mutableBytes, plaintext.length,
                       &openedLength, streamHeader.bytes,
                       streamCiphertext.bytes, streamCiphertext.length,
                       chunkDomainAAD.bytes, chunkDomainAAD.length,
                       dekBytes) == ANC_PV_CRYPTO_OK &&
                   openedLength == plaintextLength;
          return opened;
        }];
    if (openBorrow != AncPrivateVaultGuardedMemoryStatusOK || !opened)
      @throw [NSException exceptionWithName:@"AncCrypto" reason:nil userInfo:nil];
    result = class_createInstance(AncPrivateVaultOpenedObjectRevision.class, 0);
    result.plaintext = [NSData dataWithData:plaintext];
    result.revisionId = Hash(kHeaderDomain, sizeof kHeaderDomain, encodedHeader);
    result.objectId = [dekObject copy];
    result.revision = dekRevision;
    result.epoch = dekEpoch;
    result.contentType = [contentType copy];
    result.writerEndpointId = [writerId copy];
    if (!Exact(result.revisionId, 32))
      @throw [NSException exceptionWithName:@"AncCrypto" reason:nil userInfo:nil];
    object_setClass(result,
                    AncPrivateVaultImmutableOpenedObjectRevision.class);
    SetStatus(status, AncPrivateVaultObjectRevisionStatusOK);
  } @catch (NSException *exception) {
    if ([exception.name isEqualToString:@"AncBinding"])
      SetStatus(status, AncPrivateVaultObjectRevisionStatusBinding);
    else if ([exception.name isEqualToString:@"AncSignature"])
      SetStatus(status, AncPrivateVaultObjectRevisionStatusSignature);
    else if ([exception.name isEqualToString:@"AncCrypto"])
      SetStatus(status, AncPrivateVaultObjectRevisionStatusCrypto);
    else if ([exception.name isEqualToString:@"AncEncoding"])
      SetStatus(status, AncPrivateVaultObjectRevisionStatusEncoding);
  }
  BOOL closed = dek == nil ||
                [dek close] == AncPrivateVaultGuardedMemoryStatusOK;
  if (!closed) {
    SetStatus(status, AncPrivateVaultObjectRevisionStatusCleanup);
    return nil;
  }
  return result;
}

NSString *AncPrivateVaultObjectRevisionCategory(
    AncPrivateVaultObjectRevisionStatus status) {
  switch (status) {
  case AncPrivateVaultObjectRevisionStatusOK: return @"ok";
  case AncPrivateVaultObjectRevisionStatusBinding: return @"binding";
  case AncPrivateVaultObjectRevisionStatusSignature: return @"signature";
  case AncPrivateVaultObjectRevisionStatusCrypto: return @"crypto";
  case AncPrivateVaultObjectRevisionStatusEncoding: return @"encoding";
  case AncPrivateVaultObjectRevisionStatusCleanup: return @"cleanup";
  case AncPrivateVaultObjectRevisionStatusInvalid: return @"invalid";
  }
}
