#import <Foundation/Foundation.h>

#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultCustodyRepository.h"
#import "PrivateVaultEnrollmentAuthorization.h"
#import "PrivateVaultEnrollmentOfferArtifactStore.h"
#import "PrivateVaultEnrollmentSasReceiptStore.h"

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
                          (AncPrivateVaultEnrollmentOfferArtifactStore *)
                              artifactStore
                    sasReceiptStore:(AncPrivateVaultEnrollmentSasReceiptStore *)
                                        sasReceiptStore
                     authorityStore:
                         (AncPrivateVaultAuthorityStore *)authorityStore;
- (instancetype)
    initWithBrokerCustodyRepository:
        (AncPrivateVaultCustodyRepository *)brokerCustodyRepository
                      artifactStore:
                          (AncPrivateVaultEnrollmentOfferArtifactStore *)
                              artifactStore;
- (instancetype)init NS_UNAVAILABLE;

/* Creates or resumes the one local broker candidate for this vault. The
 * result is public ceremony material only. All candidate secrets remain in
 * broker-domain native custody. */
- (AncPrivateVaultEnrollmentCoordinatorStatus)
    prepareBrokerVaultId:(NSData *)vaultId
              nowSeconds:(uint64_t)nowSeconds
               candidate:
                   (AncPrivateVaultEnrollmentCandidate *_Nullable *_Nonnull)
                       candidate;

/* Builds and durably fences the exact trusted-UI decision using the candidate
 * signing seed without releasing that seed from native custody. */
- (AncPrivateVaultEnrollmentCoordinatorStatus)
    recordSasDecisionForChallenge:
        (AncPrivateVaultEnrollmentChallengeResult *)challenge
                        receiptId:(NSData *)receiptId
                        decidedAt:(uint64_t)decidedAt
                         decision:(AncPrivateVaultEnrollmentSasDecision)decision
                          receipt:(AncPrivateVaultEnrollmentSasReceipt
                                       *_Nullable *_Nonnull)receipt;

/* Rereads the durable confirmed SAS receipt, opens the EEK only inside native
 * custody, advances offer g1 to authorization-bound g2, commits the sealed
 * enrollment replay, and returns only after official g3 authority reread. */
- (AncPrivateVaultEnrollmentCoordinatorStatus)
    activateAuthorization:
        (AncPrivateVaultEnrollmentAuthorizationResult *)authorization
             verifiedAtMs:(uint64_t)verifiedAtMs
               checkpoint:
                   (AncPrivateVaultAuthorityCheckpoint *_Nullable *_Nonnull)
                       checkpoint;
@end

NS_ASSUME_NONNULL_END
