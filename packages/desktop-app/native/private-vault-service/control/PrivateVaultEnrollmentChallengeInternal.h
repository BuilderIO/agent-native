#import "PrivateVaultEnrollmentChallenge.h"

NS_ASSUME_NONNULL_BEGIN

/* Copies registry-backed evidence only for a challenge minted by the complete
 * native verifier. */
FOUNDATION_EXPORT BOOL AncPrivateVaultEnrollmentChallengeCopyEvidence(
    AncPrivateVaultEnrollmentChallengeResult *result,
    NSData *_Nullable *_Nonnull vaultId,
    NSData *_Nullable *_Nonnull encodedChallenge,
    NSData *_Nullable *_Nonnull offerHash,
    NSData *_Nullable *_Nonnull challengeHash,
    NSData *_Nullable *_Nonnull sasTranscriptHash,
    NSData *_Nullable *_Nonnull candidateEndpointId,
    NSData *_Nullable *_Nonnull candidateSigningPublicKey,
    NSData *_Nullable *_Nonnull candidateAgreementPublicKey,
    NSData *_Nullable *_Nonnull ceremonyId,
    NSString *_Nullable *_Nonnull targetMembershipRole, uint64_t *createdAt,
    uint64_t *expiresAt);

NS_ASSUME_NONNULL_END
