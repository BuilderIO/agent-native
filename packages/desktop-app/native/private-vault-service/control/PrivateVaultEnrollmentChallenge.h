#import <Foundation/Foundation.h>

#import "PrivateVaultControlLog.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultEnrollmentChallengeStatus) {
  AncPrivateVaultEnrollmentChallengeStatusOK = 0,
  AncPrivateVaultEnrollmentChallengeStatusInvalid = 1,
  AncPrivateVaultEnrollmentChallengeStatusExpired = 2,
  AncPrivateVaultEnrollmentChallengeStatusStaleAuthority = 3,
  AncPrivateVaultEnrollmentChallengeStatusConflict = 4,
  AncPrivateVaultEnrollmentChallengeStatusInvalidSignature = 5,
  AncPrivateVaultEnrollmentChallengeStatusCryptoFailed = 6,
};

/* Immutable public evidence from one challenge verified against an
 * authenticated native control state. It contains no candidate private key. */
@interface AncPrivateVaultEnrollmentChallengeResult : NSObject
@property(nonatomic, readonly) NSData *encodedChallenge;
@property(nonatomic, readonly) NSData *challengeHash;
@property(nonatomic, readonly) NSData *sasTranscript;
@property(nonatomic, readonly) NSData *sasTranscriptHash;
@property(nonatomic, readonly) NSString *sasCode;
@property(nonatomic, readonly) NSData *offerHash;
@property(nonatomic, readonly) NSData *candidateEndpointId;
@property(nonatomic, readonly) NSData *candidateSigningPublicKey;
@property(nonatomic, readonly) NSData *candidateKeyAgreementPublicKey;
@property(nonatomic, readonly) NSData *ceremonyId;
@property(nonatomic, readonly) NSData *challengeEnvelopeId;
@property(nonatomic, readonly) NSData *authorizerEndpointId;
@property(nonatomic, readonly) NSData *authorizerSigningPublicKey;
@property(nonatomic, readonly) NSData *authorizerKeyAgreementPublicKey;
@property(nonatomic, readonly) NSString *targetMembershipRole;
@property(nonatomic, readonly) uint64_t controlSequence;
@property(nonatomic, readonly) uint64_t createdAt;
@property(nonatomic, readonly) uint64_t expiresAt;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/* Verifies the complete offer/challenge/SAS bundle against one authenticated
 * control state. authenticatedHeadSignedAtSeconds must come from the same
 * authority checkpoint used to construct controlState. */
FOUNDATION_EXPORT AncPrivateVaultEnrollmentChallengeResult
    *_Nullable AncPrivateVaultEnrollmentChallengeVerify(
        NSData *encodedOffer, NSData *encodedChallenge,
        AncPrivateVaultControlLogState *controlState,
        uint64_t authenticatedHeadSignedAtSeconds, uint64_t nowSeconds,
        AncPrivateVaultEnrollmentChallengeStatus *_Nullable status);

NS_ASSUME_NONNULL_END
