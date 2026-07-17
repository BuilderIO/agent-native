#import "PrivateVaultAuthorityStore.h"

@class AncPrivateVaultControlLogReplayResult;

NS_ASSUME_NONNULL_BEGIN

/* The sole production constructor for a commit-capable replay result. */
FOUNDATION_EXPORT AncPrivateVaultVerifiedReplayResult *_Nullable
AncPrivateVaultVerifiedReplayResultCreate(
    AncPrivateVaultControlLogReplayResult *replayResult,
    AncPrivateVaultAuthorityCheckpoint *expectedCheckpoint,
    uint64_t targetCustodyGeneration, uint64_t verifiedAtMs,
    AncPrivateVaultCustodyEpochTransition epochTransition);

#if ANC_PRIVATE_VAULT_TESTING
@interface AncPrivateVaultVerifiedReplayResult (TestingInternal)
+ (instancetype)
    testResultWithExpectedCheckpoint:
        (AncPrivateVaultAuthorityCheckpoint *_Nullable)checkpoint
                        nextSnapshot:
                            (AncPrivateVaultAuthoritySnapshot *)snapshot
                     epochTransition:
                         (AncPrivateVaultCustodyEpochTransition)transition;
@end
#endif

NS_ASSUME_NONNULL_END
