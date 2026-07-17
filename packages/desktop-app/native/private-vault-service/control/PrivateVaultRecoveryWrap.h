#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultRecoveryWrapStatus) {
  AncPrivateVaultRecoveryWrapStatusOK = 0,
  AncPrivateVaultRecoveryWrapStatusInvalidCanonical,
  AncPrivateVaultRecoveryWrapStatusMissingField,
  AncPrivateVaultRecoveryWrapStatusUnknownField,
  AncPrivateVaultRecoveryWrapStatusWrongType,
  AncPrivateVaultRecoveryWrapStatusWrongLength,
  AncPrivateVaultRecoveryWrapStatusOutOfRange,
  AncPrivateVaultRecoveryWrapStatusTooLarge,
  AncPrivateVaultRecoveryWrapStatusInvalidSignature,
  AncPrivateVaultRecoveryWrapStatusHashMismatch,
  AncPrivateVaultRecoveryWrapStatusControlBinding,
  AncPrivateVaultRecoveryWrapStatusAuthorityBinding,
  AncPrivateVaultRecoveryWrapStatusIssuerBinding,
  AncPrivateVaultRecoveryWrapStatusActivationBinding,
  AncPrivateVaultRecoveryWrapStatusRotationTime,
  AncPrivateVaultRecoveryWrapStatusCurrentTime,
  AncPrivateVaultRecoveryWrapStatusUnsealAuthentication,
  AncPrivateVaultRecoveryWrapStatusUnsealDomain,
  AncPrivateVaultRecoveryWrapStatusUnsealZeroization,
};

@interface AncPrivateVaultRecoveryWrap : NSObject
@property(nonatomic, readonly) NSData *vaultId;
@property(nonatomic, readonly) uint64_t createdAt;
@property(nonatomic, readonly) NSData *envelopeId;
@property(nonatomic, readonly) NSData *ceremonyId;
@property(nonatomic, readonly) uint64_t recoveryGeneration;
@property(nonatomic, readonly) NSData *recoveryId;
@property(nonatomic, readonly) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readonly) uint64_t epoch;
@property(nonatomic, readonly) NSData *issuerEndpointId;
@property(nonatomic, readonly) uint64_t activationControlSequence;
@property(nonatomic, readonly) NSData *activationPreviousHead;
@property(nonatomic, readonly) NSData *activationPreviousMembershipHash;
@property(nonatomic, readonly) NSData *nonce;
@property(nonatomic, readonly) NSData *ciphertext;
@property(nonatomic, readonly) NSData *signature;
@end

FOUNDATION_EXPORT AncPrivateVaultRecoveryWrap
    *_Nullable AncPrivateVaultRecoveryWrapDecode(
        NSData *encoded, NSData *expectedVaultId,
        AncPrivateVaultRecoveryWrapStatus *status);
FOUNDATION_EXPORT NSData *_Nullable AncPrivateVaultRecoveryWrapEncodeUnsigned(
    AncPrivateVaultRecoveryWrap *wrap,
    AncPrivateVaultRecoveryWrapStatus *status);
FOUNDATION_EXPORT AncPrivateVaultRecoveryWrap
    *_Nullable AncPrivateVaultRecoveryWrapVerify(
        NSData *encoded, NSData *expectedVaultId,
        NSData *issuerSigningPublicKey,
        AncPrivateVaultRecoveryWrapStatus *status);
FOUNDATION_EXPORT NSData *_Nullable AncPrivateVaultRecoveryWrapHash(
    NSData *encoded, NSData *expectedVaultId,
    AncPrivateVaultRecoveryWrapStatus *status);

/* Binding dictionaries are frozen internal projections of the already
 * verified control state, membership commit, and signed entry. They never
 * contain secret material. */
FOUNDATION_EXPORT AncPrivateVaultRecoveryWrap
    *_Nullable AncPrivateVaultRecoveryWrapVerifyRotation(
        NSData *encoded, NSDictionary *currentState, NSDictionary *commit,
        NSDictionary *entry, AncPrivateVaultRecoveryWrapStatus *status);
FOUNDATION_EXPORT AncPrivateVaultRecoveryWrap
    *_Nullable AncPrivateVaultRecoveryWrapVerifyCurrent(
        NSData *encoded, NSDictionary *currentState, uint64_t now,
        AncPrivateVaultRecoveryWrapStatus *status);

typedef BOOL (^AncPrivateVaultRecoveryEEKConsumer)(const uint8_t *_Nonnull eek);
FOUNDATION_EXPORT AncPrivateVaultRecoveryWrapStatus
AncPrivateVaultRecoveryWrapUnseal(
    NSData *encoded, NSData *expectedVaultId, NSData *issuerSigningPublicKey,
    NSData *issuerKeyAgreementPublicKey,
    const uint8_t *_Nonnull recoveryKeyAgreementPrivateKey,
    AncPrivateVaultRecoveryEEKConsumer consumer);

FOUNDATION_EXPORT NSString *
AncPrivateVaultRecoveryWrapCategory(AncPrivateVaultRecoveryWrapStatus status);

#if ANC_PRIVATE_VAULT_TESTING
typedef void (^AncPrivateVaultRecoveryWrapZeroizationHook)(BOOL cleared);
FOUNDATION_EXPORT void AncPrivateVaultRecoveryWrapSetZeroizationHookForTesting(
    AncPrivateVaultRecoveryWrapZeroizationHook _Nullable hook);
#endif

NS_ASSUME_NONNULL_END
