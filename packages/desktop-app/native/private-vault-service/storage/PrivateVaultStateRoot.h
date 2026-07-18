#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Creates and validates Application Support/AgentNative/PrivateVault without
// following symlinks in any path component. The returned URL is suitable only
// after callers independently pin the directory inode they open for use.
NSURL *_Nullable AncPrivateVaultPrepareStateRoot(NSURL *applicationSupportURL);

// Creates and validates a separate owner-only recovery namespace beneath an
// already validated Private Vault state root. Rotation and recovery retry
// markers must never share a directory or interpretation surface.
NSURL *_Nullable AncPrivateVaultPrepareRecoveryStateRoot(NSURL *stateRootURL);

NS_ASSUME_NONNULL_END
