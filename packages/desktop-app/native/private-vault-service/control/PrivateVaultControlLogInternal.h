#import "PrivateVaultControlLog.h"

@class AncPrivateVaultAuthorityCheckpoint;

NS_ASSUME_NONNULL_BEGIN

/* Internal authenticated-authority bridge. The returned state is a deeply
 * copied, validated, immutable snapshot suitable only as replay input. */
FOUNDATION_EXPORT AncPrivateVaultControlLogState
    *_Nullable AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(
        AncPrivateVaultAuthorityCheckpoint *checkpoint);
FOUNDATION_EXPORT AncPrivateVaultControlLogState
    *_Nullable AncPrivateVaultControlLogStateCreateImmutableCopy(
        AncPrivateVaultControlLogState *state);
FOUNDATION_EXPORT BOOL AncPrivateVaultControlLogReplayResultCopyEvidence(
    AncPrivateVaultControlLogReplayResult *result,
    AncPrivateVaultControlLogState *_Nullable *_Nullable priorState,
    AncPrivateVaultControlLogState *_Nullable *_Nonnull currentState,
    NSData *_Nullable *_Nonnull entryHash, BOOL *idempotent);
/* Exact anc/v1 log-entry domain hash. The payload must already be the complete
 * canonical signed entry; this helper intentionally performs no parsing. */
FOUNDATION_EXPORT NSData
    *_Nullable AncPrivateVaultControlLogSignedEntryDomainHash(
        NSData *signedEntry);
/* Strictly parses the complete canonical signed entry and returns its opaque
 * envelope id. No unverified field other than this exact identifier escapes. */
FOUNDATION_EXPORT NSString
    *_Nullable AncPrivateVaultControlLogSignedEntryEnvelopeId(
        NSData *signedEntry);
/* Strictly parses the complete canonical signed entry and returns its signer
 * endpoint id. Callers must still authenticate the entry against authority. */
FOUNDATION_EXPORT NSString
    *_Nullable AncPrivateVaultControlLogSignedEntrySignerEndpointId(
        NSData *signedEntry);

/* Canonical restart snapshot for an already-authenticated control state. The
 * decoder validates structure but does not confer authenticity; callers must
 * bind the exact bytes to protected native preparation evidence. */
FOUNDATION_EXPORT NSData *_Nullable
AncPrivateVaultControlLogStatePersistenceEncode(
    AncPrivateVaultControlLogState *state);
FOUNDATION_EXPORT AncPrivateVaultControlLogState *_Nullable
AncPrivateVaultControlLogStatePersistenceDecode(NSData *encoded);

NS_ASSUME_NONNULL_END
