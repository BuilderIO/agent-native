#import <Foundation/Foundation.h>

#import "PrivateVaultControlLog.h"

NS_ASSUME_NONNULL_BEGIN

/// Builds and independently replays one endpoint-witnessed continuity edge.
/// The signing seed remains caller-owned and is borrowed only for this call.
FOUNDATION_EXPORT NSData *_Nullable AncPrivateVaultBuildContinuityCheckpoint(
    AncPrivateVaultControlLogState *currentState, NSString *logEnvelopeId,
    NSString *createdAt, NSString *endpointId,
    const uint8_t *_Nonnull endpointSigningSeed,
    NSData *expectedSigningPublicKey);

NS_ASSUME_NONNULL_END
