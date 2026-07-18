#import <Foundation/Foundation.h>

#import "PrivateVaultKeychain.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultEnrollmentOfferArtifactStatus) {
  AncPrivateVaultEnrollmentOfferArtifactStatusOK = 0,
  AncPrivateVaultEnrollmentOfferArtifactStatusNotFound = 1,
  AncPrivateVaultEnrollmentOfferArtifactStatusInvalid = 2,
  AncPrivateVaultEnrollmentOfferArtifactStatusConflict = 3,
  AncPrivateVaultEnrollmentOfferArtifactStatusCorrupt = 4,
  AncPrivateVaultEnrollmentOfferArtifactStatusInaccessible = 5,
  AncPrivateVaultEnrollmentOfferArtifactStatusFailed = 6,
};

@interface AncPrivateVaultEnrollmentOfferArtifact : NSObject
@property(nonatomic, readonly) NSData *vaultId;
@property(nonatomic, readonly) NSData *endpointId;
@property(nonatomic, readonly) NSData *ceremonyId;
@property(nonatomic, readonly) NSString *membershipRole;
@property(nonatomic, readonly) NSData *signingPublicKey;
@property(nonatomic, readonly) NSData *keyAgreementPublicKey;
@property(nonatomic, readonly) NSData *encodedOffer;
@property(nonatomic, readonly) NSData *offerHash;
@property(nonatomic, readonly) NSData *candidateKeyProof;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/* Public-only, exact-resume artifact. Keychain supplies atomic durability; the
 * store independently revalidates canonical bytes, domain hash, candidate
 * proof, and vault binding on every read. */
@interface AncPrivateVaultEnrollmentOfferArtifactStore : NSObject
- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain
                         recordId:(NSString *)recordId
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
- (AncPrivateVaultEnrollmentOfferArtifactStatus)
    storeVaultId:(NSData *)vaultId
     encodedOffer:(NSData *)encodedOffer
         offerHash:(NSData *)offerHash
  candidateKeyProof:(NSData *)candidateKeyProof;
- (AncPrivateVaultEnrollmentOfferArtifactStatus)
    readVaultId:(NSData *)vaultId
       artifact:
           (AncPrivateVaultEnrollmentOfferArtifact *_Nullable *_Nonnull)artifact;
- (AncPrivateVaultEnrollmentOfferArtifactStatus)
    deleteVaultId:(NSData *)vaultId expectedOfferHash:(NSData *)offerHash;
@end

NS_ASSUME_NONNULL_END
