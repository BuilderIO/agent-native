#import "PrivateVaultCustodyRepository.h"

NS_ASSUME_NONNULL_BEGIN

@interface AncPrivateVaultCustodyRepository (EnrollmentInternal)

/* Exact offer-pending broker g1 -> terminal cancelled-enrollment g2 CAS.
 * Candidate secrets are replaced with zero buffers and cannot be recovered. */
- (AncPrivateVaultCustodyRepositoryStatus)
    cancelPendingEnrollmentVaultId:(NSString *)vaultId
                  expectedOfferHash:(NSData *)expectedOfferHash
                      cancelledAtMs:(uint64_t)cancelledAtMs;

@end

NS_ASSUME_NONNULL_END
