#import "PrivateVaultRecoveryBuilder.h"

@class AncPrivateVaultRecoveryPreparationEvidence;

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

FOUNDATION_EXPORT NSData *_Nullable
AncPrivateVaultRecoveryPreparationArtifactsCommitment(
    NSData *signedEntry, NSData *recoveryWrap, NSData *currentSnapshot,
    NSData *currentStateSnapshot, NSData *recoveryAuthorization);

/* Rehydrates the builder capability after process death only when the exact
 * public artifacts match a protected Keychain preparation-evidence token. */
FOUNDATION_EXPORT AncPrivateVaultPreparedRecoveryArtifacts *_Nullable
AncPrivateVaultRestorePreparedRecoveryArtifacts(
    AncPrivateVaultRecoveryPreparationEvidence *evidence,
    NSData *signedEntry, NSData *recoveryWrap, NSData *currentSnapshot,
    NSData *currentStateSnapshot, NSData *recoveryAuthorization);

NS_ASSUME_NONNULL_END
