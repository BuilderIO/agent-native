#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultEnrollmentOfferStatus) {
  AncPrivateVaultEnrollmentOfferStatusOK = 0,
  AncPrivateVaultEnrollmentOfferStatusInvalid = 1,
  AncPrivateVaultEnrollmentOfferStatusCryptoFailed = 2,
  AncPrivateVaultEnrollmentOfferStatusEncodingFailed = 3,
};

@interface AncPrivateVaultEnrollmentOfferResult : NSObject
@property(nonatomic, readonly) NSData *encodedOffer;
@property(nonatomic, readonly) NSData *offerHash;
@property(nonatomic, readonly) NSData *candidateKeyProof;
@property(nonatomic, readonly) NSData *signingPublicKey;
@property(nonatomic, readonly) NSData *keyAgreementPublicKey;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/* Builds the exact Core anc/v1 public offer and the candidate's proof of key
 * possession. Seeds are borrowed only for this call; no private key or seed is
 * retained in the result. IDs are exact 16-byte lifecycle identifiers. */
FOUNDATION_EXPORT AncPrivateVaultEnrollmentOfferResult *_Nullable
AncPrivateVaultEnrollmentOfferBuild(
    NSData *vaultId, NSData *endpointId, NSData *ceremonyId,
    NSData *envelopeId, NSData *enrollmentNonce, NSString *membershipRole,
    BOOL unattended, uint64_t createdAt, uint64_t expiresAt,
    const uint8_t *_Nonnull signingSeed,
    const uint8_t *_Nonnull boxSeed,
    AncPrivateVaultEnrollmentOfferStatus *_Nullable status);

NS_ASSUME_NONNULL_END
