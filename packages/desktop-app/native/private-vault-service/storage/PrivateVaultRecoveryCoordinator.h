#import <Foundation/Foundation.h>

@class AncPrivateVaultAuthorityStore;
@class AncPrivateVaultBootstrapReplay;
@class AncPrivateVaultCustodyRepository;
@class AncPrivateVaultGenesisPreparationArtifactStore;
@class AncPrivateVaultHostedAppendRetryStore;
@class AncPrivateVaultHostedAppendTransport;
@class AncPrivateVaultRecoveryPreparationStore;

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultRecoveryCoordinatorStatus) {
  AncPrivateVaultRecoveryCoordinatorStatusOK = 0,
  AncPrivateVaultRecoveryCoordinatorStatusNotFound,
  AncPrivateVaultRecoveryCoordinatorStatusInvalid,
  AncPrivateVaultRecoveryCoordinatorStatusConflict,
  AncPrivateVaultRecoveryCoordinatorStatusStorageFailed,
  AncPrivateVaultRecoveryCoordinatorStatusProtectionFailed,
  AncPrivateVaultRecoveryCoordinatorStatusNetworkFailed,
  AncPrivateVaultRecoveryCoordinatorStatusReceiptInvalid,
  AncPrivateVaultRecoveryCoordinatorStatusVerificationFailed,
};

typedef void (^AncPrivateVaultRecoveryCoordinatorCompletion)(
    AncPrivateVaultRecoveryCoordinatorStatus status, NSString *vaultId);

@interface AncPrivateVaultRecoveryCoordinator : NSObject
- (instancetype)
    initWithPreparationStore:
        (AncPrivateVaultRecoveryPreparationStore *)preparationStore
              artifactStore:
                  (AncPrivateVaultGenesisPreparationArtifactStore *)artifactStore
                 retryStore:
                     (AncPrivateVaultHostedAppendRetryStore *)retryStore
          custodyRepository:
              (AncPrivateVaultCustodyRepository *)custodyRepository
              authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
                   transport:
                       (AncPrivateVaultHostedAppendTransport *)transport
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

/* Consumes a complete mnemonic-proven replay into durable preparation before
 * dispatching the hosted append. Completion fires only after exact receipt,
 * local authority/custody commit, and durable cleanup. */
- (void)beginWithReplay:(AncPrivateVaultBootstrapReplay *)replay
             completion:(AncPrivateVaultRecoveryCoordinatorCompletion)completion;

/* Restarts one content-free retry marker after process death. */
- (void)resumeVaultId:(NSString *)vaultId
           completion:(AncPrivateVaultRecoveryCoordinatorCompletion)completion;
@end

NS_ASSUME_NONNULL_END
