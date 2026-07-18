#import <Foundation/Foundation.h>

#import "PrivateVaultBootstrapReplay.h"
#import "PrivateVaultGuardedMemory.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultRecoveryBuilderStatus) {
  AncPrivateVaultRecoveryBuilderStatusOK = 0,
  AncPrivateVaultRecoveryBuilderStatusInvalidArgument,
  AncPrivateVaultRecoveryBuilderStatusTimestamp,
  AncPrivateVaultRecoveryBuilderStatusCrypto,
  AncPrivateVaultRecoveryBuilderStatusEncoding,
  AncPrivateVaultRecoveryBuilderStatusVerification,
  AncPrivateVaultRecoveryBuilderStatusCleanup,
};

/** Immutable public artifacts emitted only after native authorization replay. */
@interface AncPrivateVaultPreparedRecoveryArtifacts : NSObject
@property(nonatomic, readonly) NSData *signedEntry;
@property(nonatomic, readonly) NSData *recoveryWrap;
@property(nonatomic, readonly) NSData *currentSnapshot;
@property(nonatomic, readonly) NSData *recoveryAuthorization;
@property(nonatomic, readonly) NSData *entryHash;
@property(nonatomic, readonly) NSData *authorizationHash;
@property(nonatomic, readonly) NSData *snapshotHash;
@property(nonatomic, readonly) NSData *candidateEndpointId;
@property(nonatomic, readonly) NSData *candidateSigningPublicKey;
@property(nonatomic, readonly) NSData *candidateKeyAgreementPublicKey;
@property(nonatomic, readonly) NSData *ceremonyId;
@property(nonatomic, readonly) AncPrivateVaultControlLogState *nextState;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/**
 * Builds the forced recovery edge from one completed, mnemonic-proven replay.
 * Guarded endpoint seeds remain caller-owned and are borrowed synchronously.
 * Every public artifact is replayed through the production verifier before it
 * can leave this function.
 */
FOUNDATION_EXPORT AncPrivateVaultPreparedRecoveryArtifacts *_Nullable
AncPrivateVaultBuildRecoveryArtifacts(
    AncPrivateVaultBootstrapReplay *replay,
    AncPrivateVaultGuardedMemory *endpointSigningSeed,
    AncPrivateVaultGuardedMemory *endpointKeyAgreementSeed, NSData *ceremonyId,
    NSData *candidateEndpointId, NSData *candidateEnvelopeId,
    NSData *replacementWrapEnvelopeId, NSData *confirmationEnvelopeId,
    NSData *authorizationEnvelopeId, NSData *logEntryEnvelopeId,
    NSData *replacementWrapNonce, NSData *confirmationNonce,
    uint64_t trustedNowMilliseconds,
    AncPrivateVaultRecoveryBuilderStatus *_Nullable status);

FOUNDATION_EXPORT NSString *AncPrivateVaultRecoveryBuilderCategory(
    AncPrivateVaultRecoveryBuilderStatus status);

NS_ASSUME_NONNULL_END
