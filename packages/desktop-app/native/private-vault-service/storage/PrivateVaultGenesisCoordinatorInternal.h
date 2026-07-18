#import "PrivateVaultGenesisCoordinator.h"
#import "PrivateVaultGenesisPreparationStore.h"
#import "PrivateVaultGuardedMemory.h"
#import "PrivateVaultTrustedTimeStore.h"

NS_ASSUME_NONNULL_BEGIN

@protocol AncPrivateVaultGenesisTrustedClock <NSObject>
- (BOOL)readNowMilliseconds:(uint64_t *)milliseconds;
@end

@interface AncPrivateVaultGenesisSystemTrustedClock
    : NSObject <AncPrivateVaultGenesisTrustedClock>
@end

@interface AncPrivateVaultGenesisPersistedTrustedClock
    : NSObject <AncPrivateVaultGenesisTrustedClock>
- (instancetype)
    initWithStore:(AncPrivateVaultTrustedTimeStore *)store
      systemClock:(id<AncPrivateVaultGenesisTrustedClock>)systemClock
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@end

@interface AncPrivateVaultGenesisPreparationResult : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) uint64_t expiresAtMs;
@property(nonatomic, readonly)
    AncPrivateVaultGuardedMemory *preparationHandle;
@property(nonatomic, readonly) AncPrivateVaultGuardedMemory *recoveryMnemonic;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultGenesisCoordinator (PreparationInternal)
- (instancetype)
    initWithArtifactStore:(AncPrivateVaultGenesisArtifactStore *)artifactStore
           authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
        custodyRepository:(AncPrivateVaultCustodyRepository *)custodyRepository
               controlLog:(AncPrivateVaultControlLog *)controlLog
         preparationStore:
             (AncPrivateVaultGenesisPreparationStore *)preparationStore
    preparationArtifactStore:
        (AncPrivateVaultGenesisPreparationArtifactStore *)preparationArtifactStore
             trustedClock:(id<AncPrivateVaultGenesisTrustedClock>)trustedClock;

/* Creates only a PREPARED record. The two guarded outputs are native-only and
 * caller-owned; closing them is mandatory. No custody or authority state is
 * created before explicit confirmation. */
- (AncPrivateVaultGenesisCoordinatorStatus)
    prepareWithResult:
        (AncPrivateVaultGenesisPreparationResult *_Nullable *_Nullable)result;

/* The trusted native UI supplies the complete decoded recovery entropy, never
 * mnemonic text. Exact confirmation advances through pending g1 and official
 * g2, and is safe to retry with the same guarded handle. */
- (AncPrivateVaultGenesisCoordinatorStatus)
    confirmPreparationHandle:(AncPrivateVaultGuardedMemory *)handle
        confirmedRecoveryEntropy:
            (AncPrivateVaultGuardedMemory *)confirmedRecoveryEntropy
                         result:
                             (AncPrivateVaultGenesisCoordinatorResult *_Nullable
                                  *_Nullable)result;

/* User-authorized cancellation. The handle stays native-only; cancellation
 * proves that no official authority exists and durably erases preparation and
 * custody secrets before returning success. */
- (AncPrivateVaultGenesisCoordinatorStatus)
    cancelPreparationHandle:(AncPrivateVaultGuardedMemory *)handle;

/* Trusted lifecycle expiry. Only a still-PREPARED ceremony strictly beyond
 * its durable deadline can expire. */
- (AncPrivateVaultGenesisCoordinatorStatus)
    expirePreparationHandle:(AncPrivateVaultGuardedMemory *)handle;

/* Trusted startup resumption by durable lookup id. PREPARED remains pending
 * until its deadline, then expires; explicitly confirmed phases reconstruct a
 * native-only derived handle and finish the same proof-bound coordinator path.
 * No bearer or secret leaves the service. */
- (AncPrivateVaultGenesisCoordinatorStatus)
    resumePreparationLookupId:(NSData *)lookupId;

/* Performs the persisted trusted-time observation required before the XPC
 * request surface opens, even when no genesis work is pending. */
- (AncPrivateVaultGenesisCoordinatorStatus)validateTrustedTimeForStartup;
@end

#if ANC_PRIVATE_VAULT_TESTING
@interface AncPrivateVaultGenesisCoordinator (TestingInternal)
- (instancetype)
    initWithArtifactStore:(AncPrivateVaultGenesisArtifactStore *)artifactStore
           authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
        custodyRepository:(AncPrivateVaultCustodyRepository *)custodyRepository
               controlLog:(AncPrivateVaultControlLog *)controlLog
             trustedClock:(id<AncPrivateVaultGenesisTrustedClock>)trustedClock;
@end
#endif

NS_ASSUME_NONNULL_END
