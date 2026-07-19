#import <Foundation/Foundation.h>

#import "PrivateVaultCrypto.h"
#import "PrivateVaultMnemonic.h"
#import "PrivateVaultRecoveryAuthority.h"

@interface AncSentinelData : NSData {
@public
  NSUInteger _observedLength;
  NSUInteger _postReadLength;
  NSUInteger _lengthReads;
  NSUInteger _getBytesCalls;
  NSUInteger _requestedBytes;
  NSUInteger _copyCalls;
  NSUInteger _mutableCopyCalls;
}
- (instancetype)initWithObservedLength:(NSUInteger)observedLength
                        postReadLength:(NSUInteger)postReadLength;
@end

@implementation AncSentinelData
- (instancetype)initWithObservedLength:(NSUInteger)observedLength
                        postReadLength:(NSUInteger)postReadLength {
  self = [super init];
  if (self != nil) {
    _observedLength = observedLength;
    _postReadLength = postReadLength;
  }
  return self;
}
- (NSUInteger)length {
  _lengthReads += 1;
  return _lengthReads == 1 ? _observedLength : _postReadLength;
}
- (const void *)bytes {
  static const uint8_t empty = 0;
  return &empty;
}
- (id)copyWithZone:(NSZone *)zone {
  (void)zone;
  _copyCalls += 1;
  return [NSMutableData data];
}
- (id)mutableCopyWithZone:(NSZone *)zone {
  (void)zone;
  _mutableCopyCalls += 1;
  return [NSMutableData data];
}
- (void)getBytes:(void *)buffer range:(NSRange)range {
  _getBytesCalls += 1;
  _requestedBytes = range.length;
  memset(buffer, 0, range.length);
}
@end

#define CHECK(condition)                                                       \
  do {                                                                         \
    if (!(condition)) {                                                        \
      fprintf(stderr, "recovery test failed at line %d\n", __LINE__);          \
      return 1;                                                                \
    }                                                                          \
  } while (0)

static AncPrivateVaultGuardedMemory *GuardedBytes(const uint8_t *bytes,
                                                  size_t length) {
  AncPrivateVaultGuardedMemoryStatus status;
  AncPrivateVaultGuardedMemory *memory =
      [AncPrivateVaultGuardedMemory memoryWithLength:length status:&status];
  if (memory == nil)
    return nil;
  if ([memory borrow:^BOOL(uint8_t *target, size_t targetLength) {
        if (targetLength != length)
          return NO;
        memcpy(target, bytes, length);
        return YES;
      }] != AncPrivateVaultGuardedMemoryStatusOK) {
    [memory close];
    return nil;
  }
  return memory;
}

static BOOL GuardedEquals(AncPrivateVaultGuardedMemory *memory,
                          const uint8_t *bytes, size_t length) {
  __block BOOL equal = NO;
  return [memory borrow:^BOOL(uint8_t *value, size_t valueLength) {
           if (valueLength != length)
             return NO;
           equal = anc_pv_memcmp(value, bytes, length) == ANC_PV_CRYPTO_OK;
           return YES;
         }] == AncPrivateVaultGuardedMemoryStatusOK &&
         equal;
}

static NSData *DataFromHex(NSString *hex) {
  if (hex.length % 2 != 0)
    return nil;
  NSMutableData *data = [NSMutableData dataWithLength:hex.length / 2];
  uint8_t *bytes = data.mutableBytes;
  for (NSUInteger index = 0; index < data.length; index += 1) {
    unsigned value = 0;
    NSString *pair = [hex substringWithRange:NSMakeRange(index * 2, 2)];
    NSScanner *scanner = [NSScanner scannerWithString:pair];
    if (![scanner scanHexInt:&value] || !scanner.isAtEnd)
      return nil;
    bytes[index] = (uint8_t)value;
  }
  return data;
}

static NSData *ParseOracleFrame(NSData *oracleFrame) {
  if (oracleFrame.length < 2)
    return nil;
  const uint8_t *frame = oracleFrame.bytes;
  NSUInteger mnemonicLength = ((NSUInteger)frame[0] << 8) | frame[1];
  if (mnemonicLength == 0 || mnemonicLength > 215 ||
      oracleFrame.length != mnemonicLength + 2)
    return nil;
  return [NSData dataWithBytes:frame + 2 length:mnemonicLength];
}

static int RunTests(NSData *oracleFrame) {
  CHECK(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
  NSData *oracleMnemonic = ParseOracleFrame(oracleFrame);
  CHECK(oracleMnemonic != nil);
  AncPrivateVaultMnemonicStatus mnemonicStatus;
  AncSentinelData *oversizedMnemonic =
      [[AncSentinelData alloc] initWithObservedLength:513 postReadLength:513];
  CHECK(AncPrivateVaultMnemonicDecode(oversizedMnemonic, &mnemonicStatus) ==
        nil);
  CHECK(mnemonicStatus == AncPrivateVaultMnemonicStatusTooLong);
  CHECK(oversizedMnemonic->_getBytesCalls == 0 &&
        oversizedMnemonic->_copyCalls == 0 &&
        oversizedMnemonic->_mutableCopyCalls == 0);
  AncSentinelData *racingMnemonic =
      [[AncSentinelData alloc] initWithObservedLength:512 postReadLength:513];
  CHECK(AncPrivateVaultMnemonicDecode(racingMnemonic, &mnemonicStatus) == nil);
  CHECK(mnemonicStatus == AncPrivateVaultMnemonicStatusInvalidArgument);
  CHECK(racingMnemonic->_getBytesCalls == 1 &&
        racingMnemonic->_requestedBytes == 512 &&
        racingMnemonic->_copyCalls == 0 &&
        racingMnemonic->_mutableCopyCalls == 0);
  NSMutableData *trailingFrame = [oracleFrame mutableCopy];
  uint8_t trailing = 0;
  [trailingFrame appendBytes:&trailing length:1];
  CHECK(ParseOracleFrame(trailingFrame) == nil);
  CHECK(ParseOracleFrame([oracleFrame
            subdataWithRange:NSMakeRange(0, oracleFrame.length - 1)]) == nil);

  uint8_t entropyBytes[32] = {0};
  uint8_t vaultBytes[16] = {0};
  for (size_t index = 0; index < 32; index += 1)
    entropyBytes[index] = (uint8_t)index;
  for (size_t index = 0; index < 16; index += 1)
    vaultBytes[index] = (uint8_t)index;
  AncPrivateVaultGuardedMemory *entropy = GuardedBytes(entropyBytes, 32);
  CHECK(entropy != nil);

  AncPrivateVaultGuardedMemory *encoded =
      AncPrivateVaultMnemonicEncode(entropy, &mnemonicStatus);
  CHECK(encoded != nil && mnemonicStatus == AncPrivateVaultMnemonicStatusOK);
  CHECK(GuardedEquals(encoded, oracleMnemonic.bytes, oracleMnemonic.length));
  AncPrivateVaultGuardedMemory *decoded =
      AncPrivateVaultMnemonicDecode(oracleMnemonic, &mnemonicStatus);
  CHECK(decoded != nil && GuardedEquals(decoded, entropyBytes, 32));
  NSMutableData *mutableMnemonic = [oracleMnemonic mutableCopy];
  AncPrivateVaultGuardedMemory *snapshottedDecode =
      AncPrivateVaultMnemonicDecode(mutableMnemonic, &mnemonicStatus);
  memset(mutableMnemonic.mutableBytes, 0, mutableMnemonic.length);
  CHECK(snapshottedDecode != nil &&
        GuardedEquals(snapshottedDecode, entropyBytes, 32));
  [snapshottedDecode close];
  CHECK(
      AncPrivateVaultMnemonicConfirm(oracleMnemonic, entropy, &mnemonicStatus));

  NSString *phrase = [[NSString alloc] initWithData:oracleMnemonic
                                           encoding:NSUTF8StringEncoding];
  NSArray<NSString *> *words = [phrase componentsSeparatedByString:@" "];
  CHECK(words.count == 24);
  NSString *spaced = [words componentsJoinedByString:@" \t\n"];
  CHECK(AncPrivateVaultMnemonicConfirm(
      [spaced dataUsingEncoding:NSUTF8StringEncoding], entropy,
      &mnemonicStatus));
  NSString *unicodeSpaced = [words componentsJoinedByString:@"\u00a0"];
  CHECK(AncPrivateVaultMnemonicConfirm(
      [unicodeSpaced dataUsingEncoding:NSUTF8StringEncoding], entropy,
      &mnemonicStatus));

  NSArray<NSString *> *shortWords =
      [words subarrayWithRange:NSMakeRange(0, 23)];
  CHECK(
      AncPrivateVaultMnemonicDecode([[shortWords componentsJoinedByString:@" "]
                                        dataUsingEncoding:NSUTF8StringEncoding],
                                    &mnemonicStatus) == nil);
  CHECK(mnemonicStatus == AncPrivateVaultMnemonicStatusWrongWordCount);
  NSMutableArray<NSString *> *longWords = [words mutableCopy];
  [longWords addObject:words.lastObject];
  CHECK(
      AncPrivateVaultMnemonicDecode([[longWords componentsJoinedByString:@" "]
                                        dataUsingEncoding:NSUTF8StringEncoding],
                                    &mnemonicStatus) == nil);
  CHECK(mnemonicStatus == AncPrivateVaultMnemonicStatusWrongWordCount);

  NSMutableArray<NSString *> *reordered = [words mutableCopy];
  [reordered exchangeObjectAtIndex:0 withObjectAtIndex:1];
  NSData *reorderedData = [[reordered componentsJoinedByString:@" "]
      dataUsingEncoding:NSUTF8StringEncoding];
  CHECK(
      !AncPrivateVaultMnemonicConfirm(reorderedData, entropy, &mnemonicStatus));
  CHECK(mnemonicStatus == AncPrivateVaultMnemonicStatusInvalidChecksum);
  NSMutableArray<NSString *> *checksumMutation = [words mutableCopy];
  checksumMutation[0] =
      [checksumMutation[0] isEqualToString:@"zoo"] ? @"ability" : @"zoo";
  CHECK(AncPrivateVaultMnemonicDecode(
            [[checksumMutation componentsJoinedByString:@" "]
                dataUsingEncoding:NSUTF8StringEncoding],
            &mnemonicStatus) == nil);
  CHECK(mnemonicStatus == AncPrivateVaultMnemonicStatusInvalidChecksum);
  NSMutableArray<NSString *> *unknownMutation = [words mutableCopy];
  unknownMutation[0] = @"notaword";
  CHECK(AncPrivateVaultMnemonicDecode(
            [[unknownMutation componentsJoinedByString:@" "]
                dataUsingEncoding:NSUTF8StringEncoding],
            &mnemonicStatus) == nil);
  CHECK(mnemonicStatus == AncPrivateVaultMnemonicStatusUnknownWord);

  uint8_t invalidUTF8Bytes[] = {0xc3, 0x28};
  CHECK(AncPrivateVaultMnemonicDecode(
            [NSData dataWithBytes:invalidUTF8Bytes
                           length:sizeof invalidUTF8Bytes],
            &mnemonicStatus) == nil);
  CHECK(mnemonicStatus == AncPrivateVaultMnemonicStatusInvalidEncoding);

  NSMutableString *confusable = [phrase mutableCopy];
  [confusable replaceCharactersInRange:NSMakeRange(0, 1) withString:@"ａ"];
  CHECK(AncPrivateVaultMnemonicDecode(
            [confusable dataUsingEncoding:NSUTF8StringEncoding],
            &mnemonicStatus) == nil);
  CHECK(mnemonicStatus == AncPrivateVaultMnemonicStatusInvalidCharacter);

  NSMutableData *exactInputBoundary = [NSMutableData dataWithLength:512];
  memset(exactInputBoundary.mutableBytes, ' ', exactInputBoundary.length);
  memcpy((uint8_t *)exactInputBoundary.mutableBytes +
             exactInputBoundary.length - oracleMnemonic.length,
         oracleMnemonic.bytes, oracleMnemonic.length);
  CHECK(AncPrivateVaultMnemonicConfirm(exactInputBoundary, entropy,
                                       &mnemonicStatus));
  [exactInputBoundary increaseLengthBy:1];
  CHECK(AncPrivateVaultMnemonicDecode(exactInputBoundary, &mnemonicStatus) ==
        nil);
  CHECK(mnemonicStatus == AncPrivateVaultMnemonicStatusTooLong);

  NSString *maxCanonical = [@[
    @"abstract", @"abstract", @"abstract", @"abstract", @"abstract",
    @"abstract", @"abstract", @"abstract", @"abstract", @"abstract",
    @"abstract", @"abstract", @"abstract", @"abstract", @"abstract",
    @"abstract", @"abstract", @"abstract", @"abstract", @"abstract",
    @"abstract", @"abstract", @"abstract", @"abstract"
  ] componentsJoinedByString:@" "];
  CHECK([maxCanonical dataUsingEncoding:NSUTF8StringEncoding].length == 215);
  CHECK(AncPrivateVaultMnemonicDecode(
            [maxCanonical dataUsingEncoding:NSUTF8StringEncoding],
            &mnemonicStatus) == nil);
  CHECK(mnemonicStatus != AncPrivateVaultMnemonicStatusTooLong);

  uint8_t differentBytes[32] = {0};
  memcpy(differentBytes, entropyBytes, 32);
  differentBytes[31] ^= 1;
  AncPrivateVaultGuardedMemory *different = GuardedBytes(differentBytes, 32);
  CHECK(!AncPrivateVaultMnemonicConfirm(oracleMnemonic, different,
                                        &mnemonicStatus));
  CHECK(mnemonicStatus == AncPrivateVaultMnemonicStatusMismatch);

  AncPrivateVaultRecoveryAuthorityStatus authorityStatus;
  AncSentinelData *oversizedVault =
      [[AncSentinelData alloc] initWithObservedLength:17 postReadLength:17];
  CHECK(AncPrivateVaultDeriveRecoveryAuthority(entropy, oversizedVault, 1,
                                               &authorityStatus) == nil);
  CHECK(oversizedVault->_getBytesCalls == 0 && oversizedVault->_copyCalls == 0);
  AncSentinelData *racingVault =
      [[AncSentinelData alloc] initWithObservedLength:16 postReadLength:15];
  CHECK(AncPrivateVaultDeriveRecoveryAuthority(entropy, racingVault, 1,
                                               &authorityStatus) == nil);
  CHECK(racingVault->_getBytesCalls == 1 &&
        racingVault->_requestedBytes == 16 && racingVault->_copyCalls == 0);
  AncPrivateVaultGuardedMemory *root = AncPrivateVaultDeriveRecoveryRoot(
      entropy, [NSData dataWithBytes:vaultBytes length:16], &authorityStatus);
  CHECK(root != nil &&
        authorityStatus == AncPrivateVaultRecoveryAuthorityStatusOK);
  NSMutableData *rootCommitment = [NSMutableData dataWithLength:32];
  static const uint8_t recoveryDomain[] = "anc/v1/recovery";
  CHECK([root borrow:^BOOL(uint8_t *bytes, size_t length) {
          return length == 32 &&
                 anc_pv_blake2b_256_two_part(
                     rootCommitment.mutableBytes, recoveryDomain,
                     sizeof recoveryDomain,
                     bytes, length) == ANC_PV_CRYPTO_OK;
        }] == AncPrivateVaultGuardedMemoryStatusOK);
  CHECK([rootCommitment
      isEqualToData:DataFromHex(@"77688ed409de8bea839eaffd177714784b5900a9fccbd"
                                @"c5b4be2a1a8b66171bc")]);
  anc_pv_zeroize(rootCommitment.mutableBytes, rootCommitment.length);
  CHECK([root close] == AncPrivateVaultGuardedMemoryStatusOK);
  NSMutableData *mutableVault = [NSMutableData dataWithBytes:vaultBytes
                                                      length:16];
  AncPrivateVaultRecoveryAuthority *authority =
      AncPrivateVaultDeriveRecoveryAuthority(entropy, mutableVault, 1,
                                             &authorityStatus);
  memset(mutableVault.mutableBytes, 0, mutableVault.length);
  CHECK(authority != nil &&
        authorityStatus == AncPrivateVaultRecoveryAuthorityStatusOK);
  CHECK([authority.recoveryId
      isEqualToData:DataFromHex(@"dae800f05777729e6f0f986851e371a2")]);
  CHECK([authority.signingPublicKey
      isEqualToData:DataFromHex(@"79b6f418f2503137efe265070a92aa4773cb75e4cb974"
                                @"67470c49745fc39a592")]);
  CHECK([authority.keyAgreementPublicKey
      isEqualToData:DataFromHex(@"df74bae8d760604be7a24833482eb4b2e28bb3434d0ad"
                                @"227bf70f139740e7578")]);
  AncPrivateVaultRecoveryAuthority *nextGeneration =
      AncPrivateVaultDeriveRecoveryAuthority(entropy,
                                             [NSData dataWithBytes:vaultBytes
                                                            length:16],
                                             2, &authorityStatus);
  CHECK(nextGeneration != nil);
  CHECK(![nextGeneration.recoveryId isEqualToData:authority.recoveryId]);
  CHECK(![nextGeneration.signingPublicKey
      isEqualToData:authority.signingPublicKey]);
  uint8_t differentVaultBytes[16] = {0};
  memcpy(differentVaultBytes, vaultBytes, 16);
  differentVaultBytes[15] ^= 1;
  AncPrivateVaultRecoveryAuthority *differentVault =
      AncPrivateVaultDeriveRecoveryAuthority(
          entropy, [NSData dataWithBytes:differentVaultBytes length:16], 1,
          &authorityStatus);
  CHECK(differentVault != nil);
  CHECK(![differentVault.recoveryId isEqualToData:authority.recoveryId]);
  CHECK(AncPrivateVaultDeriveRecoveryAuthority(
            entropy, [NSData dataWithBytes:vaultBytes length:15], 1,
            &authorityStatus) == nil);
  CHECK(AncPrivateVaultDeriveRecoveryAuthority(
            entropy, [NSData dataWithBytes:vaultBytes length:16], 0,
            &authorityStatus) == nil);
  CHECK(AncPrivateVaultDeriveRecoveryAuthority(
            entropy, [NSData dataWithBytes:vaultBytes length:16],
            UINT64_C(9007199254740992), &authorityStatus) == nil);
  CHECK(authorityStatus == AncPrivateVaultRecoveryAuthorityStatusOutOfRange);

  AncPrivateVaultMnemonicStatus randomStatus;
  AncPrivateVaultGuardedMemory *randomEntropy =
      AncPrivateVaultGenerateRecoveryEntropy(&randomStatus);
  CHECK(randomEntropy != nil &&
        randomStatus == AncPrivateVaultMnemonicStatusOK);
  uint8_t zero[32] = {0};
  CHECK(!GuardedEquals(randomEntropy, zero, sizeof zero));

  CHECK([decoded close] == AncPrivateVaultGuardedMemoryStatusOK);
  CHECK([decoded borrow:^BOOL(__unused uint8_t *bytes, __unused size_t length) {
          return YES;
        }] == AncPrivateVaultGuardedMemoryStatusClosed);
  [encoded close];
  [different close];
  [randomEntropy close];
  [authority.signingPrivateKey close];
  [authority.keyAgreementPrivateKey close];
  [nextGeneration.signingPrivateKey close];
  [nextGeneration.keyAgreementPrivateKey close];
  [differentVault.signingPrivateKey close];
  [differentVault.keyAgreementPrivateKey close];
  [entropy close];
  CHECK(AncPrivateVaultMnemonicEncode(entropy, &mnemonicStatus) == nil);
  anc_pv_zeroize(entropyBytes, sizeof entropyBytes);
  anc_pv_zeroize(differentBytes, sizeof differentBytes);
  anc_pv_zeroize(vaultBytes, sizeof vaultBytes);
  anc_pv_zeroize(differentVaultBytes, sizeof differentVaultBytes);
  return 0;
}

int main(void) {
  @autoreleasepool {
    NSMutableData *frame = [[[NSFileHandle fileHandleWithStandardInput]
        readDataToEndOfFile] mutableCopy];
    int result = RunTests(frame);
    anc_pv_zeroize(frame.mutableBytes, frame.length);
    return result;
  }
}
