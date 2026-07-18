#import "PrivateVaultGenesisAuthorization.h"

NS_ASSUME_NONNULL_BEGIN

/* Copies registry-backed evidence only for a result minted by a successful
 * concrete genesis authorization callback. Every output is owning data. */
FOUNDATION_EXPORT BOOL AncPrivateVaultGenesisAuthorizationResultCopyEvidence(
    AncPrivateVaultGenesisAuthorizationResult *result,
    NSData *_Nullable *_Nonnull vaultId,
    NSData *_Nullable *_Nonnull ceremonyId,
    NSData *_Nullable *_Nonnull endpointId,
    NSData *_Nullable *_Nonnull endpointSigningPublicKey,
    NSData *_Nullable *_Nonnull endpointKeyAgreementPublicKey,
    NSData *_Nullable *_Nonnull enrollmentRef,
    NSData *_Nullable *_Nonnull recoveryId,
    NSData *_Nullable *_Nonnull recoverySigningPublicKey,
    NSData *_Nullable *_Nonnull recoveryKeyAgreementPublicKey,
    NSData *_Nullable *_Nonnull recoveryWrapHash,
    NSData *_Nullable *_Nonnull authorizationDigest,
    NSData *_Nullable *_Nonnull signedGenesisCommit,
    NSData *_Nullable *_Nonnull bootstrapTranscriptDigest);

NS_ASSUME_NONNULL_END
