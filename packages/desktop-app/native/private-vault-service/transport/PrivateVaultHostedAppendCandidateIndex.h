#import <Foundation/Foundation.h>

#import "PrivateVaultHostedAppendRetryCoordinator.h"
#import "PrivateVaultHostedAppendRetryStore.h"
#import "PrivateVaultRotationPreparationSpool.h"

NS_ASSUME_NONNULL_BEGIN

/* Content-free discovery adapter. Spool filenames and retry markers are only
 * hints; every attempt still passes through the authenticated coordinator. */
@interface AncPrivateVaultHostedAppendCandidateIndex
    : NSObject <AncPrivateVaultHostedAppendCandidateSource>
- (instancetype)
    initWithSpool:(AncPrivateVaultRotationPreparationSpoolStore *)spool
       retryStore:(AncPrivateVaultHostedAppendRetryStore *)retryStore
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@end

NS_ASSUME_NONNULL_END
