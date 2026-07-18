#import "PrivateVaultAuthorityStore.h"

@class AncPrivateVaultControlLogReplayResult;
@class AncPrivateVaultGenesisAuthorizationResult;

NS_ASSUME_NONNULL_BEGIN

/* The sole production constructor for a commit-capable replay result. */
FOUNDATION_EXPORT AncPrivateVaultVerifiedReplayResult *_Nullable
AncPrivateVaultVerifiedReplayResultCreate(
    AncPrivateVaultControlLogReplayResult *replayResult,
    AncPrivateVaultAuthorityCheckpoint *expectedCheckpoint,
    uint64_t targetCustodyGeneration, uint64_t verifiedAtMs,
    AncPrivateVaultCustodyEpochTransition epochTransition);

/* Genesis-only constructor. It accepts only an authenticated, non-idempotent
 * sequence-zero replay and the concrete authorization result that authorized
 * those exact signed bytes. */
FOUNDATION_EXPORT AncPrivateVaultVerifiedReplayResult *_Nullable
AncPrivateVaultVerifiedGenesisReplayResultCreate(
    AncPrivateVaultControlLogReplayResult *replayResult,
    AncPrivateVaultGenesisAuthorizationResult *authorizationResult,
    uint64_t verifiedAtMs);

#if ANC_PRIVATE_VAULT_TESTING
@interface AncPrivateVaultVerifiedReplayResult (TestingInternal)
+ (instancetype)
    testResultWithExpectedCheckpoint:
        (AncPrivateVaultAuthorityCheckpoint *_Nullable)checkpoint
                        nextSnapshot:
                            (AncPrivateVaultAuthoritySnapshot *)snapshot
                     epochTransition:
                         (AncPrivateVaultCustodyEpochTransition)transition;
+ (instancetype)testGenesisResultWithSnapshot:
                    (AncPrivateVaultAuthoritySnapshot *)snapshot
                                  ceremonyId:(NSString *)ceremonyId
                                  endpointId:(NSString *)endpointId
                            endpointSigningKey:(NSData *)endpointSigningKey
                          endpointAgreementKey:(NSData *)endpointAgreementKey
                     bootstrapTranscriptDigest:(NSData *)bootstrapTranscriptDigest;
@end
#endif

NS_ASSUME_NONNULL_END
