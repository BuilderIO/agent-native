#import <Foundation/Foundation.h>

#import "PrivateVaultGuardedMemory.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultGenesisBuilderStatus) {
  AncPrivateVaultGenesisBuilderStatusOK = 0,
  AncPrivateVaultGenesisBuilderStatusInvalidArgument,
  AncPrivateVaultGenesisBuilderStatusTimestampOrder,
  AncPrivateVaultGenesisBuilderStatusMemoryFailed,
  AncPrivateVaultGenesisBuilderStatusCryptoFailed,
  AncPrivateVaultGenesisBuilderStatusEncodingFailed,
  AncPrivateVaultGenesisBuilderStatusVerificationFailed,
  AncPrivateVaultGenesisBuilderStatusCleanupFailed,
};

/** Immutable copies of the only artifacts allowed to leave native genesis. */
@interface AncPrivateVaultPreparedGenesisArtifacts : NSObject
@property(nonatomic, readonly) NSData *recoveryWrap;
@property(nonatomic, readonly) NSData *recoveryConfirmation;
@property(nonatomic, readonly) NSData *bootstrapTranscript;
@property(nonatomic, readonly) NSData *authorization;
@property(nonatomic, readonly) NSData *bootstrapTranscriptDigest;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/**
 * Builds the frozen anc/v1 first-device genesis artifacts entirely inside the
 * native trust boundary. All four guarded inputs remain caller-owned and are
 * only borrowed synchronously. All byte inputs are bounded and snapshotted
 * before use without invoking caller-controlled copy methods.
 */
FOUNDATION_EXPORT AncPrivateVaultPreparedGenesisArtifacts *_Nullable
AncPrivateVaultBuildGenesisArtifacts(
    AncPrivateVaultGuardedMemory *recoveryEntropy,
    AncPrivateVaultGuardedMemory *endpointSigningSeed,
    AncPrivateVaultGuardedMemory *endpointKeyAgreementSeed,
    AncPrivateVaultGuardedMemory *epochOneEEK, NSData *vaultId,
    NSData *ceremonyId, NSData *endpointId, NSData *recoveryWrapEnvelopeId,
    NSData *authorizationEnvelopeId, NSData *endpointEnvelopeId,
    NSData *logEntryEnvelopeId, NSData *recoveryWrapNonce,
    uint64_t recoveryWrapCreatedAt, uint64_t confirmedAt,
    uint64_t endpointCreatedAt, uint64_t logEntryCreatedAt,
    uint64_t authorizationCreatedAt,
    AncPrivateVaultGenesisBuilderStatus *_Nullable status);

FOUNDATION_EXPORT NSString *AncPrivateVaultGenesisBuilderCategory(
    AncPrivateVaultGenesisBuilderStatus status);

NS_ASSUME_NONNULL_END
