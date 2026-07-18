#import <Foundation/Foundation.h>

#import "PrivateVaultControlLog.h"
#import "PrivateVaultEekWrap.h"
#import "PrivateVaultEnrollmentChallenge.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultEnrollmentAuthorizationStatus) {
  AncPrivateVaultEnrollmentAuthorizationStatusOK = 0,
  AncPrivateVaultEnrollmentAuthorizationStatusInvalid = 1,
  AncPrivateVaultEnrollmentAuthorizationStatusExpired = 2,
  AncPrivateVaultEnrollmentAuthorizationStatusBindingMismatch = 3,
  AncPrivateVaultEnrollmentAuthorizationStatusInvalidSignature = 4,
  AncPrivateVaultEnrollmentAuthorizationStatusInvalidTransition = 5,
  AncPrivateVaultEnrollmentAuthorizationStatusCryptoFailed = 6,
};

/* Immutable public evidence from one complete enrollment authorization. The
 * candidate EEK remains wrapped; only openEEKWithRecipientBoxSeed may lend its
 * plaintext to a synchronous native consumer. */
@interface AncPrivateVaultEnrollmentAuthorizationResult : NSObject
@property(nonatomic, readonly) NSData *encodedAuthorization;
@property(nonatomic, readonly) NSData *authorizationDigest;
@property(nonatomic, readonly) NSData *authorizationEnvelopeId;
@property(nonatomic, readonly) NSData *endpointEnvelope;
@property(nonatomic, readonly) NSData *eekWrapEnvelope;
@property(nonatomic, readonly) NSData *signedMembershipCommit;
@property(nonatomic, readonly) AncPrivateVaultEnrollmentChallengeResult
    *challenge;
@property(nonatomic, readonly) AncPrivateVaultControlLogReplayResult *replay;

- (AncPrivateVaultEekWrapStatus)
    openEEKWithRecipientBoxSeed:(const uint8_t *_Nonnull)recipientBoxSeed
                       consumer:(AncPrivateVaultEekConsumer)consumer;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/* Verifies challenge, authorization, endpoint certificate, EEK wrap, and the
 * signed membership edge against one authenticated native control state. */
FOUNDATION_EXPORT AncPrivateVaultEnrollmentAuthorizationResult *_Nullable
AncPrivateVaultEnrollmentAuthorizationVerify(
    NSData *encodedOffer, NSData *encodedChallenge,
    NSData *encodedAuthorization, AncPrivateVaultControlLogState *controlState,
    uint64_t authenticatedHeadSignedAtSeconds, uint64_t nowSeconds,
    AncPrivateVaultControlLog *controlLog,
    AncPrivateVaultEnrollmentAuthorizationStatus *_Nullable status);

NS_ASSUME_NONNULL_END
