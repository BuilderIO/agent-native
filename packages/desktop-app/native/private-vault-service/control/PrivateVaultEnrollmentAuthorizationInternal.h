#import "PrivateVaultEnrollmentAuthorization.h"

NS_ASSUME_NONNULL_BEGIN

/* Copies registry-backed evidence only for a result minted by the complete
 * native enrollment verifier. Every output is an owning immutable value. */
FOUNDATION_EXPORT BOOL AncPrivateVaultEnrollmentAuthorizationCopyEvidence(
    AncPrivateVaultEnrollmentAuthorizationResult *result,
    NSData *_Nullable *_Nonnull vaultId,
    NSData *_Nullable *_Nonnull authorizationDigest,
    NSData *_Nullable *_Nonnull authorizationEnvelopeId,
    NSData *_Nullable *_Nonnull ceremonyId,
    NSData *_Nullable *_Nonnull candidateEndpointId,
    NSString *_Nullable *_Nonnull candidateRole, BOOL *candidateUnattended,
    NSData *_Nullable *_Nonnull candidateSigningPublicKey,
    NSData *_Nullable *_Nonnull candidateAgreementPublicKey,
    NSData *_Nullable *_Nonnull offerHash,
    NSData *_Nullable *_Nonnull challengeHash,
    NSData *_Nullable *_Nonnull sasTranscriptHash,
    uint64_t *challengeCreatedAt, uint64_t *challengeExpiresAt,
    NSData *_Nullable *_Nonnull priorMembershipHash,
    NSData *_Nullable *_Nonnull signedMembershipCommit,
    AncPrivateVaultControlLogReplayResult *_Nullable *_Nonnull replay);

/* Opens the EEK using only registry-backed authorization evidence. */
FOUNDATION_EXPORT AncPrivateVaultEekWrapStatus
AncPrivateVaultEnrollmentAuthorizationOpenEEK(
    AncPrivateVaultEnrollmentAuthorizationResult *result,
    const uint8_t *_Nonnull recipientBoxSeed,
    AncPrivateVaultEekConsumer consumer);

NS_ASSUME_NONNULL_END
