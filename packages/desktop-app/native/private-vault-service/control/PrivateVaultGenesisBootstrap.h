#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultGenesisBootstrapStatus) {
  AncPrivateVaultGenesisBootstrapStatusOK = 0,
  AncPrivateVaultGenesisBootstrapStatusInvalidCanonical,
  AncPrivateVaultGenesisBootstrapStatusMissingField,
  AncPrivateVaultGenesisBootstrapStatusUnknownField,
  AncPrivateVaultGenesisBootstrapStatusWrongType,
  AncPrivateVaultGenesisBootstrapStatusWrongLiteral,
  AncPrivateVaultGenesisBootstrapStatusWrongLength,
  AncPrivateVaultGenesisBootstrapStatusOutOfRange,
  AncPrivateVaultGenesisBootstrapStatusTranscriptTooLarge,
  AncPrivateVaultGenesisBootstrapStatusVaultBinding,
  AncPrivateVaultGenesisBootstrapStatusConfirmationVaultBinding,
  AncPrivateVaultGenesisBootstrapStatusConfirmationCeremonyBinding,
  AncPrivateVaultGenesisBootstrapStatusConfirmationEndpointBinding,
  AncPrivateVaultGenesisBootstrapStatusConfirmationBinding,
  AncPrivateVaultGenesisBootstrapStatusConfirmationHashBinding,
  AncPrivateVaultGenesisBootstrapStatusCryptoDomain,
};

/** The public fields of a strict anc/v1 genesis recovery confirmation. */
@interface AncPrivateVaultGenesisRecoveryConfirmation : NSObject
@property(nonatomic, readonly) NSData *vaultId;
@property(nonatomic, readonly) NSData *ceremonyId;
@property(nonatomic, readonly) NSData *endpointId;
@property(nonatomic, readonly) NSData *recoveryId;
@property(nonatomic, readonly) NSData *recoverySigningPublicKey;
@property(nonatomic, readonly) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readonly) NSData *recoveryWrapHash;
@property(nonatomic, readonly) uint64_t confirmedAt;
@property(nonatomic, readonly) uint64_t recoveryGeneration;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/** A frozen public-only anc/v1 genesis bootstrap transcript. */
@interface AncPrivateVaultGenesisBootstrapTranscript : NSObject
@property(nonatomic, readonly) NSData *vaultId;
@property(nonatomic, readonly) NSData *ceremonyId;
@property(nonatomic, readonly) NSData *endpointId;
@property(nonatomic, readonly) NSData *endpointSigningPublicKey;
@property(nonatomic, readonly) NSData *endpointKeyAgreementPublicKey;
@property(nonatomic, readonly) NSData *enrollmentRef;
@property(nonatomic, readonly) NSData *recoveryId;
@property(nonatomic, readonly) NSData *recoverySigningPublicKey;
@property(nonatomic, readonly) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readonly) uint64_t recoveryGeneration;
@property(nonatomic, readonly) uint64_t epoch;
@property(nonatomic, readonly) NSData *recoveryWrapHash;
@property(nonatomic, readonly) NSData *recoveryConfirmationHash;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/** A verified public-only transcript and its domain-separated digest. */
@interface AncPrivateVaultGenesisBootstrapResult : NSObject
@property(nonatomic, readonly)
    AncPrivateVaultGenesisBootstrapTranscript *transcript;
@property(nonatomic, readonly) NSData *digest;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

FOUNDATION_EXPORT AncPrivateVaultGenesisRecoveryConfirmation
    *_Nullable AncPrivateVaultGenesisRecoveryConfirmationDecode(
        NSData *encoded, NSData *expectedVaultId,
        AncPrivateVaultGenesisBootstrapStatus *_Nullable status);

FOUNDATION_EXPORT NSData
    *_Nullable AncPrivateVaultGenesisRecoveryConfirmationEncode(
        AncPrivateVaultGenesisRecoveryConfirmation *confirmation,
        AncPrivateVaultGenesisBootstrapStatus *_Nullable status);

FOUNDATION_EXPORT NSData
    *_Nullable AncPrivateVaultGenesisRecoveryConfirmationHash(
        NSData *encoded, NSData *expectedVaultId,
        AncPrivateVaultGenesisBootstrapStatus *_Nullable status);

FOUNDATION_EXPORT AncPrivateVaultGenesisBootstrapTranscript
    *_Nullable AncPrivateVaultGenesisBootstrapDecode(
        NSData *encoded, NSData *_Nullable expectedVaultId,
        AncPrivateVaultGenesisBootstrapStatus *_Nullable status);

FOUNDATION_EXPORT NSData *_Nullable AncPrivateVaultGenesisBootstrapEncode(
    AncPrivateVaultGenesisBootstrapTranscript *transcript,
    AncPrivateVaultGenesisBootstrapStatus *_Nullable status);

FOUNDATION_EXPORT NSData *_Nullable AncPrivateVaultGenesisBootstrapHash(
    NSData *encoded, NSData *_Nullable expectedVaultId,
    AncPrivateVaultGenesisBootstrapStatus *_Nullable status);

/** Verifies the canonical recovery confirmation and every transcript binding.
 */
FOUNDATION_EXPORT AncPrivateVaultGenesisBootstrapResult
    *_Nullable AncPrivateVaultGenesisBootstrapVerify(
        NSData *encoded, NSData *recoveryConfirmation,
        NSData *_Nullable expectedVaultId,
        AncPrivateVaultGenesisBootstrapStatus *_Nullable status);

/** Fails with crypto.domain when the supplied digest is not the anc/v1 digest.
 */
FOUNDATION_EXPORT NSData *_Nullable AncPrivateVaultGenesisBootstrapVerifyDigest(
    NSData *encoded, NSData *_Nullable expectedVaultId, NSData *expectedDigest,
    AncPrivateVaultGenesisBootstrapStatus *_Nullable status);

FOUNDATION_EXPORT NSString *AncPrivateVaultGenesisBootstrapCategory(
    AncPrivateVaultGenesisBootstrapStatus status);

NS_ASSUME_NONNULL_END
