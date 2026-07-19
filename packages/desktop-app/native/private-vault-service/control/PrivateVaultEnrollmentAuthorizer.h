#import <Foundation/Foundation.h>

#import "PrivateVaultControlLog.h"
#import "PrivateVaultEnrollmentChallenge.h"
#import "PrivateVaultGuardedMemory.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultEnrollmentAuthorizerStatus) {
  AncPrivateVaultEnrollmentAuthorizerStatusOK = 0,
  AncPrivateVaultEnrollmentAuthorizerStatusInvalid = 1,
  AncPrivateVaultEnrollmentAuthorizerStatusConflict = 2,
  AncPrivateVaultEnrollmentAuthorizerStatusExpired = 3,
  AncPrivateVaultEnrollmentAuthorizerStatusCrypto = 4,
  AncPrivateVaultEnrollmentAuthorizerStatusEncoding = 5,
  AncPrivateVaultEnrollmentAuthorizerStatusVerification = 6,
  AncPrivateVaultEnrollmentAuthorizerStatusCleanup = 7,
};

/* Public challenge bytes emitted only after production verification against
 * the same authenticated control state used to construct them. */
@interface AncPrivateVaultPreparedEnrollmentChallenge : NSObject
@property(nonatomic, readonly) NSData *encodedChallenge;
@property(nonatomic, readonly) AncPrivateVaultEnrollmentChallengeResult
    *verifiedChallenge;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/* Builds the attended authorizer half of the frozen anc/v1 challenge. The
 * endpoint seeds stay in guarded memory and are borrowed synchronously. */
FOUNDATION_EXPORT AncPrivateVaultPreparedEnrollmentChallenge *_Nullable
AncPrivateVaultBuildEnrollmentChallenge(
    NSData *encodedOffer, NSData *candidateKeyProof,
    AncPrivateVaultControlLogState *authenticatedState,
    AncPrivateVaultGuardedMemory *authorizerSigningSeed,
    AncPrivateVaultGuardedMemory *authorizerAgreementSeed,
    NSData *challengeEnvelopeId, NSData *sasNonce,
    uint64_t authenticatedHeadSignedAtSeconds, uint64_t createdAt,
    uint64_t expiresAt,
    AncPrivateVaultEnrollmentAuthorizerStatus *_Nullable status);

FOUNDATION_EXPORT NSString *AncPrivateVaultEnrollmentAuthorizerCategory(
    AncPrivateVaultEnrollmentAuthorizerStatus status);

NS_ASSUME_NONNULL_END
