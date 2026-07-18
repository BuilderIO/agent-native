#import "PrivateVaultMnemonic.h"

#import "PrivateVaultCrypto.h"

#import <sodium.h>

static const char *const kEnglishWords[2048] = {
#include "third-party/bip39/english.inc"
};

static void SetStatus(AncPrivateVaultMnemonicStatus *status,
                      AncPrivateVaultMnemonicStatus value) {
  if (status != NULL)
    *status = value;
}

static AncPrivateVaultGuardedMemory *
AllocateGuarded(size_t length, AncPrivateVaultMnemonicStatus *status) {
  AncPrivateVaultGuardedMemoryStatus memoryStatus;
  AncPrivateVaultGuardedMemory *memory =
      [AncPrivateVaultGuardedMemory memoryWithLength:length
                                              status:&memoryStatus];
  if (memory == nil)
    SetStatus(status, AncPrivateVaultMnemonicStatusMemoryFailed);
  return memory;
}

static BOOL ReadUTF8Scalar(const uint8_t *bytes, size_t length, size_t *offset,
                           uint32_t *scalar) {
  uint8_t first = bytes[(*offset)++];
  if (first < 0x80) {
    *scalar = first;
    return YES;
  }
  size_t trailing = first >= 0xc2 && first <= 0xdf   ? 1
                    : first >= 0xe0 && first <= 0xef ? 2
                    : first >= 0xf0 && first <= 0xf4 ? 3
                                                     : 0;
  if (trailing == 0 || trailing > length - *offset)
    return NO;
  uint8_t second = bytes[*offset];
  if ((second & 0xc0) != 0x80 || (first == 0xe0 && second < 0xa0) ||
      (first == 0xed && second > 0x9f) || (first == 0xf0 && second < 0x90) ||
      (first == 0xf4 && second > 0x8f))
    return NO;
  uint32_t value = first & (trailing == 1 ? 0x1f : trailing == 2 ? 0x0f : 0x07);
  for (size_t index = 0; index < trailing; index += 1) {
    uint8_t next = bytes[(*offset)++];
    if ((next & 0xc0) != 0x80)
      return NO;
    value = (value << 6) | (next & 0x3f);
  }
  *scalar = value;
  return YES;
}

static BOOL IsUnicodeWhitespace(uint32_t scalar) {
  return (scalar >= 0x09 && scalar <= 0x0d) || scalar == 0x20 ||
         scalar == 0x85 || scalar == 0xa0 || scalar == 0x1680 ||
         (scalar >= 0x2000 && scalar <= 0x200a) || scalar == 0x2028 ||
         scalar == 0x2029 || scalar == 0x202f || scalar == 0x205f ||
         scalar == 0x3000;
}

static BOOL FindEnglishWord(const char *word, uint16_t *index) {
  size_t lower = 0;
  size_t upper = 2048;
  while (lower < upper) {
    size_t middle = lower + (upper - lower) / 2;
    int comparison = strcmp(word, kEnglishWords[middle]);
    if (comparison == 0) {
      *index = (uint16_t)middle;
      return YES;
    }
    if (comparison < 0)
      upper = middle;
    else
      lower = middle + 1;
  }
  return NO;
}

static BOOL FinishWord(char word[9], size_t *wordLength, uint16_t output[24],
                       size_t *wordCount, size_t *canonicalBytes,
                       AncPrivateVaultMnemonicStatus *status) {
  if (*wordLength == 0)
    return YES;
  *canonicalBytes += *wordLength + (*wordCount == 0 ? 0 : 1);
  if (*canonicalBytes > ANC_PV_MNEMONIC_MAX_CANONICAL_UTF8_BYTES) {
    SetStatus(status, AncPrivateVaultMnemonicStatusTooLong);
    return NO;
  }
  if (*wordCount >= ANC_PV_MNEMONIC_WORD_COUNT) {
    SetStatus(status, AncPrivateVaultMnemonicStatusWrongWordCount);
    return NO;
  }
  word[*wordLength] = '\0';
  uint16_t index = 0;
  if (!FindEnglishWord(word, &index)) {
    SetStatus(status, AncPrivateVaultMnemonicStatusUnknownWord);
    return NO;
  }
  output[(*wordCount)++] = index;
  anc_pv_zeroize(word, 9);
  *wordLength = 0;
  return YES;
}

static BOOL DecodeWordIndexes(NSData *input, uint16_t output[24],
                              AncPrivateVaultMnemonicStatus *status) {
  if (input == nil) {
    SetStatus(status, AncPrivateVaultMnemonicStatusInvalidArgument);
    return NO;
  }
  NSUInteger observedLength = 0;
  @try {
    observedLength = input.length;
  } @catch (__unused NSException *exception) {
    SetStatus(status, AncPrivateVaultMnemonicStatusInvalidArgument);
    return NO;
  }
  if (observedLength > ANC_PV_MNEMONIC_MAX_INPUT_UTF8_BYTES) {
    SetStatus(status, AncPrivateVaultMnemonicStatusTooLong);
    return NO;
  }
  NSMutableData *snapshot = [NSMutableData dataWithLength:observedLength];
  if (snapshot == nil) {
    SetStatus(status, AncPrivateVaultMnemonicStatusMemoryFailed);
    return NO;
  }
  @try {
    [input getBytes:snapshot.mutableBytes range:NSMakeRange(0, observedLength)];
    if (input.length != observedLength) {
      SetStatus(status, AncPrivateVaultMnemonicStatusInvalidArgument);
      return NO;
    }
    const uint8_t *bytes = snapshot.bytes;
    size_t offset = 0;
    size_t wordCount = 0;
    size_t canonicalBytes = 0;
    char word[9] = {0};
    size_t wordLength = 0;
    while (offset < snapshot.length) {
      uint32_t scalar = 0;
      if (!ReadUTF8Scalar(bytes, snapshot.length, &offset, &scalar)) {
        anc_pv_zeroize(word, sizeof word);
        SetStatus(status, AncPrivateVaultMnemonicStatusInvalidEncoding);
        return NO;
      }
      if (IsUnicodeWhitespace(scalar)) {
        if (!FinishWord(word, &wordLength, output, &wordCount, &canonicalBytes,
                        status)) {
          anc_pv_zeroize(word, sizeof word);
          return NO;
        }
        continue;
      }
      if (scalar < 'a' || scalar > 'z') {
        anc_pv_zeroize(word, sizeof word);
        SetStatus(status, AncPrivateVaultMnemonicStatusInvalidCharacter);
        return NO;
      }
      if (wordLength >= sizeof word - 1) {
        anc_pv_zeroize(word, sizeof word);
        SetStatus(status, AncPrivateVaultMnemonicStatusUnknownWord);
        return NO;
      }
      word[wordLength++] = (char)scalar;
    }
    if (!FinishWord(word, &wordLength, output, &wordCount, &canonicalBytes,
                    status)) {
      anc_pv_zeroize(word, sizeof word);
      return NO;
    }
    anc_pv_zeroize(word, sizeof word);
    if (wordCount != ANC_PV_MNEMONIC_WORD_COUNT) {
      SetStatus(status, AncPrivateVaultMnemonicStatusWrongWordCount);
      return NO;
    }
    return YES;
  } @catch (__unused NSException *exception) {
    SetStatus(status, AncPrivateVaultMnemonicStatusInvalidArgument);
    return NO;
  } @finally {
    anc_pv_zeroize(snapshot.mutableBytes, snapshot.length);
  }
}

AncPrivateVaultGuardedMemory *
AncPrivateVaultGenerateRecoveryEntropy(AncPrivateVaultMnemonicStatus *status) {
  SetStatus(status, AncPrivateVaultMnemonicStatusInvalidArgument);
  if (anc_pv_crypto_init() != ANC_PV_CRYPTO_OK) {
    SetStatus(status, AncPrivateVaultMnemonicStatusCryptoFailed);
    return nil;
  }
  AncPrivateVaultGuardedMemory *entropy =
      AllocateGuarded(ANC_PV_RECOVERY_ENTROPY_BYTES, status);
  if (entropy == nil)
    return nil;
  __block BOOL generated = NO;
  AncPrivateVaultGuardedMemoryStatus memoryStatus =
      [entropy borrow:^BOOL(uint8_t *bytes, size_t length) {
        generated = anc_pv_random(bytes, length) == ANC_PV_CRYPTO_OK;
        return generated;
      }];
  if (memoryStatus != AncPrivateVaultGuardedMemoryStatusOK || !generated) {
    [entropy close];
    SetStatus(status, generated ? AncPrivateVaultMnemonicStatusMemoryFailed
                                : AncPrivateVaultMnemonicStatusCryptoFailed);
    return nil;
  }
  SetStatus(status, AncPrivateVaultMnemonicStatusOK);
  return entropy;
}

AncPrivateVaultGuardedMemory *
AncPrivateVaultMnemonicEncode(AncPrivateVaultGuardedMemory *entropy,
                              AncPrivateVaultMnemonicStatus *status) {
  SetStatus(status, AncPrivateVaultMnemonicStatusInvalidArgument);
  if (entropy == nil || entropy.length != ANC_PV_RECOVERY_ENTROPY_BYTES)
    return nil;
  if (anc_pv_crypto_init() != ANC_PV_CRYPTO_OK) {
    SetStatus(status, AncPrivateVaultMnemonicStatusCryptoFailed);
    return nil;
  }
  __block uint8_t combined[33] = {0};
  uint8_t *combinedBytes = combined;
  __block BOOL encoded = NO;
  AncPrivateVaultGuardedMemoryStatus memoryStatus =
      [entropy borrow:^BOOL(uint8_t *bytes, size_t length) {
        if (length != ANC_PV_RECOVERY_ENTROPY_BYTES)
          return NO;
        memcpy(combinedBytes, bytes, length);
        uint8_t checksum[crypto_hash_sha256_BYTES] = {0};
        encoded = crypto_hash_sha256(checksum, bytes, length) == 0;
        if (encoded)
          combinedBytes[32] = checksum[0];
        anc_pv_zeroize(checksum, sizeof checksum);
        return encoded;
      }];
  if (memoryStatus != AncPrivateVaultGuardedMemoryStatusOK || !encoded) {
    anc_pv_zeroize(combined, sizeof combined);
    SetStatus(status, encoded ? AncPrivateVaultMnemonicStatusMemoryFailed
                              : AncPrivateVaultMnemonicStatusCryptoFailed);
    return nil;
  }

  uint16_t indexes[24] = {0};
  uint16_t *wordIndexes = indexes;
  size_t outputLength = 23;
  for (size_t word = 0; word < 24; word += 1) {
    uint16_t value = 0;
    for (size_t bit = 0; bit < 11; bit += 1) {
      size_t position = word * 11 + bit;
      value = (uint16_t)((value << 1) |
                         ((combined[position / 8] >> (7 - position % 8)) & 1));
    }
    indexes[word] = value;
    outputLength += strlen(kEnglishWords[value]);
  }
  anc_pv_zeroize(combined, sizeof combined);
  if (outputLength > ANC_PV_MNEMONIC_MAX_CANONICAL_UTF8_BYTES) {
    anc_pv_zeroize(indexes, sizeof indexes);
    SetStatus(status, AncPrivateVaultMnemonicStatusTooLong);
    return nil;
  }
  AncPrivateVaultGuardedMemory *output = AllocateGuarded(outputLength, status);
  if (output == nil) {
    anc_pv_zeroize(indexes, sizeof indexes);
    return nil;
  }
  __block BOOL copied = NO;
  memoryStatus = [output borrow:^BOOL(uint8_t *bytes, size_t length) {
    size_t offset = 0;
    for (size_t word = 0; word < 24; word += 1) {
      if (word > 0)
        bytes[offset++] = ' ';
      const char *value = kEnglishWords[wordIndexes[word]];
      size_t wordLength = strlen(value);
      memcpy(bytes + offset, value, wordLength);
      offset += wordLength;
    }
    copied = offset == length;
    return copied;
  }];
  anc_pv_zeroize(indexes, sizeof indexes);
  if (memoryStatus != AncPrivateVaultGuardedMemoryStatusOK || !copied) {
    [output close];
    SetStatus(status, AncPrivateVaultMnemonicStatusMemoryFailed);
    return nil;
  }
  SetStatus(status, AncPrivateVaultMnemonicStatusOK);
  return output;
}

AncPrivateVaultGuardedMemory *
AncPrivateVaultMnemonicDecode(NSData *mnemonicUTF8,
                              AncPrivateVaultMnemonicStatus *status) {
  SetStatus(status, AncPrivateVaultMnemonicStatusInvalidArgument);
  if (mnemonicUTF8 == nil)
    return nil;
  if (anc_pv_crypto_init() != ANC_PV_CRYPTO_OK) {
    SetStatus(status, AncPrivateVaultMnemonicStatusCryptoFailed);
    return nil;
  }
  uint16_t wordIndexes[24] = {0};
  if (!DecodeWordIndexes(mnemonicUTF8, wordIndexes, status)) {
    anc_pv_zeroize(wordIndexes, sizeof wordIndexes);
    return nil;
  }
  uint8_t combined[33] = {0};
  uint8_t *combinedBytes = combined;
  for (NSUInteger word = 0; word < 24; word += 1) {
    uint16_t value = wordIndexes[word];
    for (NSUInteger bit = 0; bit < 11; bit += 1) {
      NSUInteger position = word * 11 + bit;
      combined[position / 8] |=
          (uint8_t)(((value >> (10 - bit)) & 1) << (7 - position % 8));
    }
  }
  anc_pv_zeroize(wordIndexes, sizeof wordIndexes);
  uint8_t checksum[crypto_hash_sha256_BYTES] = {0};
  BOOL hashed = crypto_hash_sha256(checksum, combined, 32) == 0;
  BOOL validChecksum =
      hashed && anc_pv_memcmp(checksum, combined + 32, 1) == ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(checksum, sizeof checksum);
  if (!validChecksum) {
    anc_pv_zeroize(combined, sizeof combined);
    SetStatus(status, hashed ? AncPrivateVaultMnemonicStatusInvalidChecksum
                             : AncPrivateVaultMnemonicStatusCryptoFailed);
    return nil;
  }
  AncPrivateVaultGuardedMemory *entropy = AllocateGuarded(32, status);
  if (entropy == nil) {
    anc_pv_zeroize(combined, sizeof combined);
    return nil;
  }
  AncPrivateVaultGuardedMemoryStatus memoryStatus =
      [entropy borrow:^BOOL(uint8_t *bytes, size_t length) {
        if (length != 32)
          return NO;
        memcpy(bytes, combinedBytes, length);
        return YES;
      }];
  anc_pv_zeroize(combined, sizeof combined);
  if (memoryStatus != AncPrivateVaultGuardedMemoryStatusOK) {
    [entropy close];
    SetStatus(status, AncPrivateVaultMnemonicStatusMemoryFailed);
    return nil;
  }
  SetStatus(status, AncPrivateVaultMnemonicStatusOK);
  return entropy;
}

BOOL AncPrivateVaultMnemonicConfirm(
    NSData *mnemonicUTF8, AncPrivateVaultGuardedMemory *expectedEntropy,
    AncPrivateVaultMnemonicStatus *status) {
  SetStatus(status, AncPrivateVaultMnemonicStatusInvalidArgument);
  if (expectedEntropy == nil || expectedEntropy.length != 32)
    return NO;
  AncPrivateVaultGuardedMemory *decoded =
      AncPrivateVaultMnemonicDecode(mnemonicUTF8, status);
  if (decoded == nil)
    return NO;
  __block BOOL equal = NO;
  AncPrivateVaultGuardedMemoryStatus decodedStatus =
      [decoded borrow:^BOOL(uint8_t *decodedBytes, size_t decodedLength) {
        if (decodedLength != 32)
          return NO;
        AncPrivateVaultGuardedMemoryStatus expectedStatus = [expectedEntropy
            borrow:^BOOL(uint8_t *expectedBytes, size_t expectedLength) {
              if (expectedLength != decodedLength)
                return NO;
              equal = anc_pv_memcmp(decodedBytes, expectedBytes,
                                    decodedLength) == ANC_PV_CRYPTO_OK;
              return YES;
            }];
        return expectedStatus == AncPrivateVaultGuardedMemoryStatusOK;
      }];
  AncPrivateVaultGuardedMemoryStatus closeStatus = [decoded close];
  if (decodedStatus != AncPrivateVaultGuardedMemoryStatusOK ||
      closeStatus != AncPrivateVaultGuardedMemoryStatusOK) {
    SetStatus(status, AncPrivateVaultMnemonicStatusMemoryFailed);
    return NO;
  }
  SetStatus(status, equal ? AncPrivateVaultMnemonicStatusOK
                          : AncPrivateVaultMnemonicStatusMismatch);
  return equal;
}
