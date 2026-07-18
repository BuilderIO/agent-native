#import "PrivateVaultAuthorityStore.h"

@class AncPrivateVaultControlLogReplayResult;
@class AncPrivateVaultEnrollmentAuthorizationResult;
@class AncPrivateVaultEnrollmentSasReceipt;
@class AncPrivateVaultGenesisAuthorizationResult;
@class AncPrivateVaultPreparedRecoveryArtifacts;

NS_ASSUME_NONNULL_BEGIN

/* The sole production constructor for a commit-capable replay result. */
FOUNDATION_EXPORT AncPrivateVaultVerifiedReplayResult
    *_Nullable AncPrivateVaultVerifiedReplayResultCreate(
        AncPrivateVaultControlLogReplayResult *replayResult,
        AncPrivateVaultAuthorityCheckpoint *expectedCheckpoint,
        uint64_t targetCustodyGeneration, uint64_t verifiedAtMs,
        AncPrivateVaultCustodyEpochTransition epochTransition);

/* Genesis-only constructor. It accepts only an authenticated, non-idempotent
 * sequence-zero replay and the concrete authorization result that authorized
 * those exact signed bytes. */
FOUNDATION_EXPORT AncPrivateVaultVerifiedReplayResult
    *_Nullable AncPrivateVaultVerifiedGenesisReplayResultCreate(
        AncPrivateVaultControlLogReplayResult *replayResult,
        AncPrivateVaultGenesisAuthorizationResult *authorizationResult,
        uint64_t verifiedAtMs);

/* Fresh-device recovery constructor. It accepts only the immutable artifact
 * bundle emitted by the production recovery builder. The result has no prior
 * local authority checkpoint: its authenticated prior state is carried by the
 * builder registry and is committed only against matching pending custody. */
FOUNDATION_EXPORT AncPrivateVaultVerifiedReplayResult
    *_Nullable AncPrivateVaultVerifiedRecoveryBootstrapResultCreate(
        AncPrivateVaultPreparedRecoveryArtifacts *artifacts,
        uint64_t verifiedAtMs);

/* Ordinary enrollment constructor. It joins registry-backed authorization
 * evidence to one confirmed candidate-signed SAS receipt and the exact
 * authenticated membership replay. */
FOUNDATION_EXPORT AncPrivateVaultVerifiedReplayResult
    *_Nullable AncPrivateVaultVerifiedEnrollmentBootstrapResultCreate(
        AncPrivateVaultEnrollmentAuthorizationResult *authorization,
        AncPrivateVaultEnrollmentSasReceipt *sasReceipt, uint64_t verifiedAtMs);

@interface AncPrivateVaultAuthorityStore (GenesisAbsenceInternal)
/* Returns NotFound only when both exact live and staged authority paths are
 * absent under the same hardened directory and per-vault operation lock.
 * It intentionally does not consult custody, whose pending g1 is valid during
 * an uncommitted genesis cancellation. */
- (AncPrivateVaultAuthorityStoreStatus)proveAuthorityAbsentVaultId:
    (NSString *)vaultId;
@end

#if ANC_PRIVATE_VAULT_TESTING
@interface AncPrivateVaultVerifiedReplayResult (TestingInternal)
+ (instancetype)
    testResultWithExpectedCheckpoint:
        (AncPrivateVaultAuthorityCheckpoint *_Nullable)checkpoint
                        nextSnapshot:
                            (AncPrivateVaultAuthoritySnapshot *)snapshot
                     epochTransition:
                         (AncPrivateVaultCustodyEpochTransition)transition;
+ (instancetype)
    testGenesisResultWithSnapshot:(AncPrivateVaultAuthoritySnapshot *)snapshot
                       ceremonyId:(NSString *)ceremonyId
                       endpointId:(NSString *)endpointId
               endpointSigningKey:(NSData *)endpointSigningKey
             endpointAgreementKey:(NSData *)endpointAgreementKey
        bootstrapTranscriptDigest:(NSData *)bootstrapTranscriptDigest;
+ (instancetype)
    testEnrollmentResultWithSnapshot:
        (AncPrivateVaultAuthoritySnapshot *)snapshot
                 authorizationDigest:(NSData *)authorizationDigest
                          ceremonyId:(NSString *)ceremonyId
                 candidateEndpointId:(NSString *)candidateEndpointId
           candidateSigningPublicKey:(NSData *)candidateSigningPublicKey
         candidateAgreementPublicKey:(NSData *)candidateAgreementPublicKey
                 priorMembershipHash:(NSData *)priorMembershipHash;
@end
#endif

NS_ASSUME_NONNULL_END
