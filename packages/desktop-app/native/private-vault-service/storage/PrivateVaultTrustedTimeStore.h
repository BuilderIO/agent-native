#import <Foundation/Foundation.h>

#import "PrivateVaultKeychain.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultTrustedTimeStatus) {
  AncPrivateVaultTrustedTimeStatusOK = 0,
  AncPrivateVaultTrustedTimeStatusInvalid,
  AncPrivateVaultTrustedTimeStatusRollbackDetected,
  AncPrivateVaultTrustedTimeStatusCorrupt,
  AncPrivateVaultTrustedTimeStatusInaccessible,
  AncPrivateVaultTrustedTimeStatusFailed,
};

/* Device/storage-domain-wide monotonic Unix-time floor. Both independently
 * stored authenticated frames advance through pending -> stable. A lower wall
 * clock is reported as rollback and never substituted with the stored floor. */
@interface AncPrivateVaultTrustedTimeStore : NSObject
- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init;
- (AncPrivateVaultTrustedTimeStatus)
    observeSystemMilliseconds:(uint64_t)systemMilliseconds
         trustedMilliseconds:(uint64_t *)trustedMilliseconds;
@end

NS_ASSUME_NONNULL_END
