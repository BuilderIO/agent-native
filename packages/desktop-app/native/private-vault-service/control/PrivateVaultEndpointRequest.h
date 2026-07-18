#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSString *const AncPrivateVaultControlLogAppendPath;
FOUNDATION_EXPORT NSString *const AncPrivateVaultControlLogAppendContentType;
FOUNDATION_EXPORT NSString *const AncPrivateVaultGenesisAdmissionPath;
FOUNDATION_EXPORT NSString *const AncPrivateVaultGenesisAdmissionContentType;

typedef NS_ENUM(NSInteger, AncPrivateVaultEndpointRequestStatus) {
  AncPrivateVaultEndpointRequestStatusOK = 0,
  AncPrivateVaultEndpointRequestStatusInvalid = 1,
  AncPrivateVaultEndpointRequestStatusTooLarge = 2,
  AncPrivateVaultEndpointRequestStatusCryptoFailed = 3,
  AncPrivateVaultEndpointRequestStatusIdentityMismatch = 4,
};

/* Canonical anc/v1 binary body for the one hosted rotation-append route. */
FOUNDATION_EXPORT NSData
    *_Nullable AncPrivateVaultControlLogAppendRequestEncode(
        NSData *signedEntry, NSData *recoveryWrap,
        AncPrivateVaultEndpointRequestStatus *_Nullable status);

/* Canonical anc/v1 body for the recovery append route variant. */
FOUNDATION_EXPORT NSData
    *_Nullable AncPrivateVaultControlLogRecoveryAppendRequestEncode(
        NSData *signedEntry, NSData *recoveryWrap, NSData *currentSnapshot,
        NSData *recoveryAuthorization,
        AncPrivateVaultEndpointRequestStatus *_Nullable status);

/* Returns canonical unpadded base64url(JSON) for X-ANC-Endpoint-Request-Proof.
 * The signing seed remains caller-owned and is borrowed only for this call. */
FOUNDATION_EXPORT NSString
    *_Nullable AncPrivateVaultControlLogAppendProofHeaderCreate(
        NSString *vaultId, NSString *endpointId, NSData *body,
        NSString *issuedAt, NSString *nonce,
        const uint8_t *_Nonnull signingSeed, NSData *expectedSigningPublicKey,
        AncPrivateVaultEndpointRequestStatus *_Nullable status);

FOUNDATION_EXPORT NSString
    *_Nullable AncPrivateVaultGenesisAdmissionProofHeaderCreate(
        NSString *vaultId, NSString *endpointId, NSData *body,
        NSString *issuedAt, NSString *nonce,
        const uint8_t *_Nonnull signingSeed, NSData *expectedSigningPublicKey,
        AncPrivateVaultEndpointRequestStatus *_Nullable status);

NS_ASSUME_NONNULL_END
