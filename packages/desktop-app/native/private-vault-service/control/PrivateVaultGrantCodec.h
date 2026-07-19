#import <Foundation/Foundation.h>

#import "PrivateVaultCrypto.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultGrantCodecStatus) {
  AncPrivateVaultGrantCodecStatusOK = 0,
  AncPrivateVaultGrantCodecStatusInvalid = 1,
  AncPrivateVaultGrantCodecStatusExpired = 2,
  AncPrivateVaultGrantCodecStatusSignature = 3,
  AncPrivateVaultGrantCodecStatusCrypto = 4,
};

@interface AncPrivateVaultVerifiedGrant : NSObject
@property(nonatomic, readonly) NSData *vaultId;
@property(nonatomic, readonly) NSData *grantRef;
@property(nonatomic, readonly) NSData *grantId;
@property(nonatomic, readonly) NSData *issuerEndpointId;
@property(nonatomic, readonly) NSData *subjectAccountId;
@property(nonatomic, readonly) NSData *subjectEndpointId;
@property(nonatomic, readonly, nullable) NSData *subjectAgentId;
@property(nonatomic, readonly) NSArray<NSData *> *resourceIds;
@property(nonatomic, readonly) NSArray<NSString *> *operations;
@property(nonatomic, readonly) NSArray<NSString *> *providers;
@property(nonatomic, readonly) uint64_t issuedAt;
@property(nonatomic, readonly) uint64_t expiresAt;
@property(nonatomic, readonly) NSData *revocationRef;
@end

@interface AncPrivateVaultVerifiedGrantRevocation : NSObject
@property(nonatomic, readonly) NSData *grantRef;
@property(nonatomic, readonly) NSData *revocationRef;
@property(nonatomic, readonly) uint64_t revokedAt;
@property(nonatomic, readonly) NSString *reason;
@property(nonatomic, readonly) NSData *issuerEndpointId;
@end

FOUNDATION_EXPORT NSData *_Nullable AncPrivateVaultSealGrantEnvelope(
    NSData *vaultId, NSData *envelopeId, uint64_t createdAt, NSData *grantId,
    NSData *issuerEndpointId, NSData *subjectAccountId,
    NSData *subjectEndpointId, NSData *_Nullable subjectAgentId,
    NSArray<NSData *> *resourceIds, NSArray<NSString *> *operations,
    NSArray<NSString *> *providers, uint64_t issuedAt, uint64_t expiresAt,
    NSData *revocationRef,
    const uint8_t *_Nonnull issuerSigningSeed,
    AncPrivateVaultGrantCodecStatus *status);

FOUNDATION_EXPORT AncPrivateVaultVerifiedGrant *_Nullable
AncPrivateVaultVerifyGrantEnvelope(
    NSData *envelope, NSData *expectedVaultId, uint64_t nowSeconds,
    NSData *expectedIssuerEndpointId,
    const uint8_t *_Nonnull issuerSigningPublicKey,
    AncPrivateVaultGrantCodecStatus *status);

FOUNDATION_EXPORT AncPrivateVaultVerifiedGrantRevocation *_Nullable
AncPrivateVaultVerifyGrantRevocationEnvelope(
    NSData *envelope, NSData *expectedVaultId,
    AncPrivateVaultVerifiedGrant *expectedGrant,
    const uint8_t *_Nonnull issuerSigningPublicKey,
    AncPrivateVaultGrantCodecStatus *status);

NS_ASSUME_NONNULL_END
