#import "PrivateVaultEnrollmentSasReceipt.h"

NS_ASSUME_NONNULL_BEGIN

/* Verifies a receipt against sealed authorization evidence without trusting a
 * caller-mutable challenge object. */
FOUNDATION_EXPORT AncPrivateVaultEnrollmentSasReceipt *_Nullable
AncPrivateVaultEnrollmentSasReceiptVerifyBound(
    NSData *encodedReceipt, NSData *vaultId, NSData *offerHash,
    NSData *challengeHash, NSData *sasTranscriptHash,
    NSData *candidateEndpointId, NSData *ceremonyId,
    NSData *candidateSigningPublicKey, uint64_t challengeCreatedAt,
    uint64_t challengeExpiresAt,
    AncPrivateVaultEnrollmentSasReceiptStatus *_Nullable status);

NS_ASSUME_NONNULL_END
