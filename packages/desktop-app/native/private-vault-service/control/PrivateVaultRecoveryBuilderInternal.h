#import "PrivateVaultRecoveryBuilder.h"

NS_ASSUME_NONNULL_BEGIN

/* Registry-backed evidence bridge. Only artifacts emitted by the production
 * builder can satisfy this call; callers cannot synthesize verified state. */
FOUNDATION_EXPORT BOOL AncPrivateVaultPreparedRecoveryArtifactsCopyEvidence(
    AncPrivateVaultPreparedRecoveryArtifacts *artifacts,
    AncPrivateVaultControlLogState *_Nullable *_Nonnull currentState,
    AncPrivateVaultControlLogState *_Nullable *_Nonnull nextState,
    NSData *_Nullable *_Nonnull entryHash,
    NSData *_Nullable *_Nonnull authorizationHash,
    NSData *_Nullable *_Nonnull ceremonyId,
    NSData *_Nullable *_Nonnull candidateEndpointId,
    NSData *_Nullable *_Nonnull candidateSigningPublicKey,
    NSData *_Nullable *_Nonnull candidateKeyAgreementPublicKey);

NS_ASSUME_NONNULL_END
