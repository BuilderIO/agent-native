#import "PrivateVaultControlLog.h"

@class AncPrivateVaultAuthorityCheckpoint;

NS_ASSUME_NONNULL_BEGIN

/* Internal authenticated-authority bridge. The returned state is a deeply
 * copied, validated, immutable snapshot suitable only as replay input. */
FOUNDATION_EXPORT AncPrivateVaultControlLogState *_Nullable
AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(
    AncPrivateVaultAuthorityCheckpoint *checkpoint);
FOUNDATION_EXPORT AncPrivateVaultControlLogState *_Nullable
AncPrivateVaultControlLogStateCreateImmutableCopy(
    AncPrivateVaultControlLogState *state);
FOUNDATION_EXPORT BOOL AncPrivateVaultControlLogReplayResultCopyEvidence(
    AncPrivateVaultControlLogReplayResult *result,
    AncPrivateVaultControlLogState *_Nullable *_Nullable priorState,
    AncPrivateVaultControlLogState *_Nullable *_Nonnull currentState,
    NSData *_Nullable *_Nonnull entryHash, BOOL *idempotent);
/* Exact anc/v1 log-entry domain hash. The payload must already be the complete
 * canonical signed entry; this helper intentionally performs no parsing. */
FOUNDATION_EXPORT NSData *_Nullable
AncPrivateVaultControlLogSignedEntryDomainHash(NSData *signedEntry);

NS_ASSUME_NONNULL_END
