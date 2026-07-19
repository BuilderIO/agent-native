#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT BOOL AncPrivateVaultObjectJobScopeAllows(
    NSData *resourceId, NSString *operation, NSString *provider,
    NSString *status, BOOL resultRecorded, BOOL receiptAcknowledged,
    NSData *vaultId, NSData *objectId, NSString *_Nullable contentType);

NS_ASSUME_NONNULL_END
