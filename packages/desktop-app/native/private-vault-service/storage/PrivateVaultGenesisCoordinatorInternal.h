#import "PrivateVaultGenesisCoordinator.h"

NS_ASSUME_NONNULL_BEGIN

@protocol AncPrivateVaultGenesisTrustedClock <NSObject>
- (BOOL)readNowMilliseconds:(uint64_t *)milliseconds;
@end

@interface AncPrivateVaultGenesisSystemTrustedClock
    : NSObject <AncPrivateVaultGenesisTrustedClock>
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
