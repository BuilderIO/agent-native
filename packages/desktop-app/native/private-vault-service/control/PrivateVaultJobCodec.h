#import <Foundation/Foundation.h>

#import "PrivateVaultCrypto.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultJobCodecStatus) {
  AncPrivateVaultJobCodecStatusOK = 0,
  AncPrivateVaultJobCodecStatusInvalid = 1,
  AncPrivateVaultJobCodecStatusExpired = 2,
  AncPrivateVaultJobCodecStatusSignature = 3,
  AncPrivateVaultJobCodecStatusCrypto = 4,
  AncPrivateVaultJobCodecStatusTooLarge = 5,
};

@interface AncPrivateVaultOpenedJob : NSObject
@property(nonatomic, readonly) NSData *payload;
@property(nonatomic, readonly) NSData *grantRef;
@property(nonatomic, readonly) NSData *jobHash;
- (instancetype)initWithPayload:(NSData *)payload
                       grantRef:(NSData *)grantRef
                         jobHash:(NSData *)jobHash NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@end

FOUNDATION_EXPORT AncPrivateVaultOpenedJob *_Nullable
AncPrivateVaultOpenJobEnvelope(
    NSData *envelope, NSData *expectedVaultId, NSData *expectedJobId,
    NSData *expectedRecipientEndpointId, uint64_t nowSeconds,
    const uint8_t *_Nonnull senderSigningPublicKey,
    const uint8_t *_Nonnull senderBoxPublicKey,
    const uint8_t *_Nonnull recipientBoxPrivateKey,
    AncPrivateVaultJobCodecStatus *status);

FOUNDATION_EXPORT NSData *_Nullable AncPrivateVaultSealResultEnvelope(
    NSData *vaultId, NSData *envelopeId, uint64_t createdAt, NSData *jobId,
    NSData *jobHash, NSData *recipientEndpointId, NSString *state,
    NSData *payload, NSData *nonce,
    const uint8_t *_Nonnull senderSigningSeed,
    const uint8_t *_Nonnull senderBoxPrivateKey,
    const uint8_t *_Nonnull recipientBoxPublicKey,
    AncPrivateVaultJobCodecStatus *status);

NS_ASSUME_NONNULL_END
