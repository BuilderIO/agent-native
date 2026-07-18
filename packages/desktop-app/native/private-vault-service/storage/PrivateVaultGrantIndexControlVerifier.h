#import <Foundation/Foundation.h>

#import "PrivateVaultControlLog.h"
#import "PrivateVaultGrantIndex.h"

NS_ASSUME_NONNULL_BEGIN

/// Adds durable grant-revocation enforcement to an existing control-log
/// verifier without moving grant authority into hosted or JavaScript code.
@interface AncPrivateVaultGrantIndexControlVerifier
    : NSObject <AncPrivateVaultControlLogAuthorizationVerifier>
- (instancetype)initWithGrantIndex:(AncPrivateVaultGrantIndex *)grantIndex
                           fallback:
                               (id<AncPrivateVaultControlLogAuthorizationVerifier>
                                    _Nullable)fallback
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@end

NS_ASSUME_NONNULL_END
