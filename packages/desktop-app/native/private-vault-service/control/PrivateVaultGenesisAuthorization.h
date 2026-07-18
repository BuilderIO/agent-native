#import <Foundation/Foundation.h>

#import "PrivateVaultControlLog.h"
#import "PrivateVaultGenesisBootstrap.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultGenesisAuthorizationStatus) {
  AncPrivateVaultGenesisAuthorizationStatusOK = 0,
  AncPrivateVaultGenesisAuthorizationStatusInvalidCanonical,
  AncPrivateVaultGenesisAuthorizationStatusMissingField,
  AncPrivateVaultGenesisAuthorizationStatusUnknownField,
  AncPrivateVaultGenesisAuthorizationStatusWrongType,
  AncPrivateVaultGenesisAuthorizationStatusWrongLiteral,
  AncPrivateVaultGenesisAuthorizationStatusWrongLength,
  AncPrivateVaultGenesisAuthorizationStatusOutOfRange,
  AncPrivateVaultGenesisAuthorizationStatusConfirmationTooLarge,
  AncPrivateVaultGenesisAuthorizationStatusAuthorizationTooLarge,
  AncPrivateVaultGenesisAuthorizationStatusEndpointTooLarge,
  AncPrivateVaultGenesisAuthorizationStatusCommitTooLarge,
  AncPrivateVaultGenesisAuthorizationStatusEndpointInvalidCanonical,
  AncPrivateVaultGenesisAuthorizationStatusEndpointMissingField,
  AncPrivateVaultGenesisAuthorizationStatusEndpointUnknownField,
  AncPrivateVaultGenesisAuthorizationStatusEndpointWrongType,
  AncPrivateVaultGenesisAuthorizationStatusEndpointWrongLiteral,
  AncPrivateVaultGenesisAuthorizationStatusEndpointWrongLength,
  AncPrivateVaultGenesisAuthorizationStatusEndpointOutOfRange,
  AncPrivateVaultGenesisAuthorizationStatusEndpointRole,
  AncPrivateVaultGenesisAuthorizationStatusVaultBinding,
  AncPrivateVaultGenesisAuthorizationStatusRecoveryConfirmationBinding,
  AncPrivateVaultGenesisAuthorizationStatusCeremonyBinding,
  AncPrivateVaultGenesisAuthorizationStatusEndpointBinding,
  AncPrivateVaultGenesisAuthorizationStatusRecoveryBinding,
  AncPrivateVaultGenesisAuthorizationStatusBootstrapBinding,
  AncPrivateVaultGenesisAuthorizationStatusCommitBinding,
  AncPrivateVaultGenesisAuthorizationStatusTimeBinding,
  AncPrivateVaultGenesisAuthorizationStatusOrderBinding,
  AncPrivateVaultGenesisAuthorizationStatusHeadBinding,
  AncPrivateVaultGenesisAuthorizationStatusRoleBinding,
  AncPrivateVaultGenesisAuthorizationStatusMemberBinding,
  AncPrivateVaultGenesisAuthorizationStatusEndpointSignature,
  AncPrivateVaultGenesisAuthorizationStatusCommitSignature,
  AncPrivateVaultGenesisAuthorizationStatusAuthorizationSignature,
  AncPrivateVaultGenesisAuthorizationStatusCryptoDomain,
};

/** Immutable public-only result of a complete local genesis authorization. */
@interface AncPrivateVaultGenesisAuthorizationResult : NSObject
@property(nonatomic, readonly) NSData *vaultId;
@property(nonatomic, readonly) NSData *ceremonyId;
@property(nonatomic, readonly) NSData *endpointId;
@property(nonatomic, readonly) NSData *endpointSigningPublicKey;
@property(nonatomic, readonly) NSData *endpointKeyAgreementPublicKey;
@property(nonatomic, readonly) NSData *enrollmentRef;
@property(nonatomic, readonly) NSData *recoveryId;
@property(nonatomic, readonly) NSData *recoverySigningPublicKey;
@property(nonatomic, readonly) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readonly) NSData *recoveryWrapHash;
@property(nonatomic, readonly) NSData *authorizationDigest;
@property(nonatomic, readonly) NSData *signedGenesisCommit;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/** Strictly decodes and checks the exact local recovery confirmation. */
FOUNDATION_EXPORT BOOL AncPrivateVaultGenesisAuthorizationDecodeConfirmation(
    NSData *recoveryConfirmation, NSData *expectedVaultId,
    AncPrivateVaultGenesisAuthorizationStatus *_Nullable status);

/** Strict structural decode of the exact canonical authorization envelope. */
FOUNDATION_EXPORT BOOL AncPrivateVaultGenesisAuthorizationDecode(
    NSData *authorization, NSData *expectedVaultId,
    AncPrivateVaultGenesisAuthorizationStatus *_Nullable status);

/**
 * Production verifier for the hardened control-log genesis callback. The
 * constructor snapshots every caller-owned byte string and binds the supplied
 * already-verified bootstrap result to those snapshots.
 */
@interface AncPrivateVaultGenesisAuthorizationVerifier
    : NSObject <AncPrivateVaultControlLogAuthorizationVerifier>
@property(nonatomic, readonly, nullable)
    AncPrivateVaultGenesisAuthorizationResult *result;
@property(nonatomic, readonly) AncPrivateVaultGenesisAuthorizationStatus status;

- (nullable instancetype)
    initWithAuthorization:(NSData *)authorization
     recoveryConfirmation:(NSData *)recoveryConfirmation
       bootstrapTranscript:(NSData *)bootstrapTranscript
            bootstrapResult:(AncPrivateVaultGenesisBootstrapResult *)bootstrapResult
                    status:(AncPrivateVaultGenesisAuthorizationStatus *_Nullable)status
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

FOUNDATION_EXPORT NSString *AncPrivateVaultGenesisAuthorizationCategory(
    AncPrivateVaultGenesisAuthorizationStatus status);

NS_ASSUME_NONNULL_END
