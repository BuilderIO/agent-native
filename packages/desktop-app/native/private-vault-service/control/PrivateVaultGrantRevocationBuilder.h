#import <Foundation/Foundation.h>

#import "PrivateVaultControlLog.h"
#import "PrivateVaultGrantCodec.h"

NS_ASSUME_NONNULL_BEGIN

@interface AncPrivateVaultGrantRevocationBuildResult : NSObject
@property(nonatomic, readonly) NSData *signedEntry;
@property(nonatomic, readonly) NSData *revocationEnvelope;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/// Builds and independently replays one grant-revocation control edge while
/// the attended endpoint signing seed remains inside native custody.
FOUNDATION_EXPORT AncPrivateVaultGrantRevocationBuildResult *_Nullable
AncPrivateVaultBuildGrantRevocation(
    AncPrivateVaultControlLogState *currentState,
    AncPrivateVaultVerifiedGrant *grant, NSData *revocationEnvelopeId,
    NSString *logEnvelopeId, NSString *createdAt, uint64_t revokedAt,
    NSString *reason, const uint8_t *_Nonnull issuerSigningSeed);

NS_ASSUME_NONNULL_END
