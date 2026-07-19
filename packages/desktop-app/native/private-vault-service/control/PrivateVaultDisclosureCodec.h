#import <Foundation/Foundation.h>

#import "PrivateVaultCrypto.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultDisclosureCodecStatus) {
  AncPrivateVaultDisclosureCodecStatusOK = 0,
  AncPrivateVaultDisclosureCodecStatusInvalid = 1,
  AncPrivateVaultDisclosureCodecStatusExpired = 2,
  AncPrivateVaultDisclosureCodecStatusSignature = 3,
  AncPrivateVaultDisclosureCodecStatusCrypto = 4,
};

@interface AncPrivateVaultVerifiedDisclosure : NSObject
@property(nonatomic, readonly) NSData *vaultId;
@property(nonatomic, readonly) NSData *disclosureId;
@property(nonatomic, readonly) NSData *grantRef;
@property(nonatomic, readonly) NSString *providerId;
@property(nonatomic, readonly) NSString *destination;
@property(nonatomic, readonly) NSData *scopeHash;
@property(nonatomic, readonly) uint64_t issuedAt;
@property(nonatomic, readonly) uint64_t expiresAt;
@end

FOUNDATION_EXPORT NSData *_Nullable AncPrivateVaultSealDisclosureEnvelope(
    NSData *vaultId, NSData *disclosureId, uint64_t createdAt,
    NSData *grantRef, NSString *providerId, NSString *destination,
    NSData *scopeHash, uint64_t issuedAt, uint64_t expiresAt,
    const uint8_t *_Nonnull brokerSigningSeed,
    AncPrivateVaultDisclosureCodecStatus *_Nullable status);

FOUNDATION_EXPORT AncPrivateVaultVerifiedDisclosure *_Nullable
AncPrivateVaultVerifyDisclosureEnvelope(
    NSData *envelope, NSData *expectedVaultId, NSData *expectedGrantRef,
    uint64_t nowSeconds,
    const uint8_t *_Nonnull brokerSigningPublicKey,
    AncPrivateVaultDisclosureCodecStatus *_Nullable status);

NS_ASSUME_NONNULL_END
