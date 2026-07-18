#import <Foundation/Foundation.h>

#import "PrivateVaultCustodyRepository.h"
#import "PrivateVaultEnrollmentOfferArtifactStore.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultEnrollmentCoordinatorStatus) {
  AncPrivateVaultEnrollmentCoordinatorStatusOK = 0,
  AncPrivateVaultEnrollmentCoordinatorStatusInvalid = 1,
  AncPrivateVaultEnrollmentCoordinatorStatusConflict = 2,
  AncPrivateVaultEnrollmentCoordinatorStatusCorrupt = 3,
  AncPrivateVaultEnrollmentCoordinatorStatusInaccessible = 4,
  AncPrivateVaultEnrollmentCoordinatorStatusFailed = 5,
};

@interface AncPrivateVaultEnrollmentCandidate : NSObject
@property(nonatomic, readonly) NSData *vaultId;
@property(nonatomic, readonly) NSData *endpointId;
@property(nonatomic, readonly) NSData *ceremonyId;
@property(nonatomic, readonly) NSData *encodedOffer;
@property(nonatomic, readonly) NSData *offerHash;
@property(nonatomic, readonly) NSData *candidateKeyProof;
@property(nonatomic, readonly) NSData *signingPublicKey;
@property(nonatomic, readonly) NSData *keyAgreementPublicKey;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultEnrollmentCoordinator : NSObject
- (instancetype)
    initWithBrokerCustodyRepository:
        (AncPrivateVaultCustodyRepository *)brokerCustodyRepository
                    artifactStore:
                        (AncPrivateVaultEnrollmentOfferArtifactStore *)artifactStore
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

/* Creates or resumes the one local broker candidate for this vault. The
 * result is public ceremony material only. All candidate secrets remain in
 * broker-domain native custody. */
- (AncPrivateVaultEnrollmentCoordinatorStatus)
    prepareBrokerVaultId:(NSData *)vaultId
            nowSeconds:(uint64_t)nowSeconds
             candidate:
                 (AncPrivateVaultEnrollmentCandidate *_Nullable *_Nonnull)candidate;
@end

NS_ASSUME_NONNULL_END
