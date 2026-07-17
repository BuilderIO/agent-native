#import "PrivateVaultControlLog.h"
#import "PrivateVaultRecoveryWrap.h"

NS_ASSUME_NONNULL_BEGIN

/* Typed adapter used by authenticated control replay. It converts the frozen
 * typed replay projections to the recovery-wrap verifier's canonical binding
 * shape and records no authorization state until every binding verifies. */
@interface AncPrivateVaultRecoveryWrapRotationVerifier
    : NSObject <AncPrivateVaultControlLogAuthorizationVerifier>
@property(nonatomic, readonly, getter=isVerified) BOOL verified;
@property(nonatomic, readonly, nullable) NSData *verifiedWrapHash;
@property(nonatomic, readonly, nullable) NSString *verifiedCeremonyId;
- (instancetype)initWithEncodedWrap:(NSData *)encodedWrap
            trustedNowMilliseconds:(uint64_t)trustedNowMilliseconds
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@end

/* Retry-only verifier for an already committed successor authority state. */
FOUNDATION_EXPORT BOOL AncPrivateVaultRecoveryWrapVerifyCommittedSuccessor(
    NSData *encodedWrap, AncPrivateVaultControlLogState *successorState,
    uint64_t nowMilliseconds, NSData *_Nullable *_Nullable wrapHash,
    NSString *_Nullable *_Nullable ceremonyId);

NS_ASSUME_NONNULL_END
