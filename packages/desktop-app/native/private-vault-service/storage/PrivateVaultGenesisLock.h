#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/*
 * Process-wide exact lock identity for one canonical 16-byte genesis vault id
 * encoded as 32 lowercase hexadecimal characters. Equal ids always receive
 * the same recursive lock; distinct ids never share a stripe.
 */
FOUNDATION_EXPORT NSRecursiveLock *_Nullable
AncPrivateVaultGenesisLockForVaultId(NSString *_Nullable vaultId);

NS_ASSUME_NONNULL_END
