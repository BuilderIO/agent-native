#import <Foundation/Foundation.h>

#import "PrivateVaultGuardedMemory.h"

NS_ASSUME_NONNULL_BEGIN

enum {
  ANC_PV_RECOVERY_ENTROPY_BYTES = 32,
  ANC_PV_MNEMONIC_WORD_COUNT = 24,
  ANC_PV_MNEMONIC_MAX_CANONICAL_UTF8_BYTES = 215,
  ANC_PV_MNEMONIC_MAX_INPUT_UTF8_BYTES = 512,
};

typedef NS_ENUM(NSInteger, AncPrivateVaultMnemonicStatus) {
  AncPrivateVaultMnemonicStatusOK = 0,
  AncPrivateVaultMnemonicStatusInvalidArgument = 1,
  AncPrivateVaultMnemonicStatusTooLong = 2,
  AncPrivateVaultMnemonicStatusInvalidEncoding = 3,
  AncPrivateVaultMnemonicStatusInvalidCharacter = 4,
  AncPrivateVaultMnemonicStatusWrongWordCount = 5,
  AncPrivateVaultMnemonicStatusUnknownWord = 6,
  AncPrivateVaultMnemonicStatusInvalidChecksum = 7,
  AncPrivateVaultMnemonicStatusMismatch = 8,
  AncPrivateVaultMnemonicStatusCryptoFailed = 9,
  AncPrivateVaultMnemonicStatusMemoryFailed = 10,
};

FOUNDATION_EXPORT AncPrivateVaultGuardedMemory
    *_Nullable AncPrivateVaultGenerateRecoveryEntropy(
        AncPrivateVaultMnemonicStatus *status);

/* Returns canonical lowercase ASCII words separated by one space. */
FOUNDATION_EXPORT AncPrivateVaultGuardedMemory
    *_Nullable AncPrivateVaultMnemonicEncode(
        AncPrivateVaultGuardedMemory *entropy,
        AncPrivateVaultMnemonicStatus *status);

/* Collapses NFKD whitespace; English words must already be lowercase ASCII. */
FOUNDATION_EXPORT AncPrivateVaultGuardedMemory
    *_Nullable AncPrivateVaultMnemonicDecode(
        NSData *mnemonicUTF8, AncPrivateVaultMnemonicStatus *status);

/* Decodes the complete phrase and compares exact entropy in constant time. */
FOUNDATION_EXPORT BOOL AncPrivateVaultMnemonicConfirm(
    NSData *mnemonicUTF8, AncPrivateVaultGuardedMemory *expectedEntropy,
    AncPrivateVaultMnemonicStatus *status);

NS_ASSUME_NONNULL_END
