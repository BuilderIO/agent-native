#import "PrivateVaultRecoveryPreparationStore.h"

NS_ASSUME_NONNULL_BEGIN

/* Registry-backed bridge: only an evidence object returned by a successful
 * Keychain read can disclose the authenticated public preparation tuple. */
FOUNDATION_EXPORT BOOL AncPrivateVaultRecoveryPreparationEvidenceCopySnapshot(
    AncPrivateVaultRecoveryPreparationEvidence *evidence,
    AncPrivateVaultRecoveryPreparationSnapshot *snapshot);

NS_ASSUME_NONNULL_END
