#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultEekWrapStatus) {
  AncPrivateVaultEekWrapStatusOK = 0,
  AncPrivateVaultEekWrapStatusInvalid = 1,
  AncPrivateVaultEekWrapStatusBindingMismatch = 2,
  AncPrivateVaultEekWrapStatusInvalidSignature = 3,
  AncPrivateVaultEekWrapStatusAuthenticationFailed = 4,
  AncPrivateVaultEekWrapStatusDomainMismatch = 5,
  AncPrivateVaultEekWrapStatusConsumerRejected = 6,
  AncPrivateVaultEekWrapStatusCryptoFailed = 7,
};

@interface AncPrivateVaultEekWrap : NSObject
@property(nonatomic, readonly) NSData *encodedEnvelope;
@property(nonatomic, readonly) NSData *envelopeId;
@property(nonatomic, readonly) NSData *recipientEndpointId;
@property(nonatomic, readonly) NSData *issuerEndpointId;
@property(nonatomic, readonly) NSData *nonce;
@property(nonatomic, readonly) NSData *ciphertext;
@property(nonatomic, readonly) uint64_t epoch;
@property(nonatomic, readonly) uint64_t createdAt;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

FOUNDATION_EXPORT AncPrivateVaultEekWrap *_Nullable
AncPrivateVaultEekWrapVerify(
    NSData *encodedEnvelope, NSData *expectedVaultId,
    NSData *expectedRecipientEndpointId, NSData *expectedIssuerEndpointId,
    uint64_t expectedEpoch, NSData *expectedIssuerSigningPublicKey,
    AncPrivateVaultEekWrapStatus *_Nullable status);

typedef BOOL (^AncPrivateVaultEekConsumer)(
    const uint8_t *_Nonnull epochKey);

/* Opens a verified wrap with a borrowed candidate seed. The derived private
 * key, domain-prefixed plaintext, and EEK are zeroized before return. */
FOUNDATION_EXPORT AncPrivateVaultEekWrapStatus AncPrivateVaultEekWrapOpen(
    NSData *encodedEnvelope, NSData *expectedVaultId,
    NSData *expectedRecipientEndpointId, NSData *expectedIssuerEndpointId,
    uint64_t expectedEpoch, NSData *expectedIssuerSigningPublicKey,
    NSData *expectedIssuerKeyAgreementPublicKey,
    NSData *expectedRecipientKeyAgreementPublicKey,
    const uint8_t *_Nonnull recipientBoxSeed,
    AncPrivateVaultEekConsumer consumer);

NS_ASSUME_NONNULL_END
