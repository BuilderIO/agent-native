#import "PrivateVaultAuthoritySnapshot.h"

@class AncPrivateVaultControlLogState;

NS_ASSUME_NONNULL_BEGIN

/* Internal bridge from an already authenticated replay state. Construction is
 * followed by canonical encode/decode validation and returns a frozen copy. */
FOUNDATION_EXPORT AncPrivateVaultAuthoritySnapshot *_Nullable
AncPrivateVaultAuthoritySnapshotCreateFromVerifiedControlState(
    AncPrivateVaultControlLogState *state, uint64_t targetCustodyGeneration,
    uint64_t previousCustodyGeneration,
    NSNumber *_Nullable previousSequence, NSData *_Nullable previousHead,
    uint64_t verifiedAtMs);

NS_ASSUME_NONNULL_END
