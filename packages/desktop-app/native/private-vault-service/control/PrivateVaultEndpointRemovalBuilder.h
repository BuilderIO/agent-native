#import <Foundation/Foundation.h>

#import "PrivateVaultControlLog.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultEndpointRemovalBuilderStatus) {
  AncPrivateVaultEndpointRemovalBuilderStatusOK = 0,
  AncPrivateVaultEndpointRemovalBuilderStatusInvalidArgument,
  AncPrivateVaultEndpointRemovalBuilderStatusTargetRejected,
  AncPrivateVaultEndpointRemovalBuilderStatusCryptoFailed,
  AncPrivateVaultEndpointRemovalBuilderStatusEncodingFailed,
  AncPrivateVaultEndpointRemovalBuilderStatusVerificationFailed,
};

@interface AncPrivateVaultPreparedEndpointRemoval : NSObject
@property(nonatomic, readonly) NSData *signedEntry;
@property(nonatomic, readonly) NSData *recoveryWrap;
@property(nonatomic, readonly) NSData *transcriptDigest;
@property(nonatomic, readonly) AncPrivateVaultControlLogState *nextState;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/* Builds and independently replays one attended endpoint-removal edge. The
 * current endpoint's seeds and the fresh pending EEK are borrowed only for the
 * call and are never retained by the result. */
FOUNDATION_EXPORT AncPrivateVaultPreparedEndpointRemoval *_Nullable
AncPrivateVaultBuildEndpointRemoval(
    AncPrivateVaultControlLogState *currentState, NSData *targetEndpointId,
    NSData *ceremonyId, NSData *wrapEnvelopeId, NSData *entryEnvelopeId,
    NSData *wrapNonce, uint64_t createdAtSeconds,
    const uint8_t *_Nonnull pendingEpochKey,
    const uint8_t *_Nonnull issuerSigningSeed,
    const uint8_t *_Nonnull issuerAgreementSeed,
    AncPrivateVaultEndpointRemovalBuilderStatus *_Nullable status);

NS_ASSUME_NONNULL_END
