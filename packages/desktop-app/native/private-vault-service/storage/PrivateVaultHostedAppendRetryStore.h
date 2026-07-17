#import <Foundation/Foundation.h>

#include <stdint.h>

NS_ASSUME_NONNULL_BEGIN

enum {
  ANC_PV_HOSTED_APPEND_RETRY_VAULT_ID_BYTES = 16,
  ANC_PV_HOSTED_APPEND_RETRY_MAX_CANDIDATES = 256,
};

typedef NS_ENUM(NSInteger, AncPrivateVaultHostedAppendRetryStoreStatus) {
  AncPrivateVaultHostedAppendRetryStoreStatusOK = 0,
  AncPrivateVaultHostedAppendRetryStoreStatusInvalid = 1,
  AncPrivateVaultHostedAppendRetryStoreStatusCorrupt = 2,
  AncPrivateVaultHostedAppendRetryStoreStatusStorageFailed = 3,
};

/*
 * Stores only a content-free restart hint. Each durable marker contains the
 * fixed 16-byte vault identifier and a domain-separated integrity checksum;
 * it never contains request material, secrets, timestamps, URLs, receipts, or
 * ceremony identifiers.
 */
@interface AncPrivateVaultHostedAppendRetryStore : NSObject

/* stateRootURL is an already-approved owner-only 0700 trust anchor. */
- (instancetype)initWithStateRootURL:(NSURL *)stateRootURL
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

- (AncPrivateVaultHostedAppendRetryStoreStatus)addVaultId:
    (const uint8_t *)vaultId;
- (AncPrivateVaultHostedAppendRetryStoreStatus)removeVaultId:
    (const uint8_t *)vaultId;

/* Returns copied immutable, unique, 16-byte NSData values only. */
- (AncPrivateVaultHostedAppendRetryStoreStatus)listVaultIds:
    (NSArray<NSData *> *_Nullable *_Nonnull)vaultIds;

@end

typedef NS_ENUM(NSInteger, AncPrivateVaultHostedAppendRetryStoreFaultPoint) {
  AncPrivateVaultHostedAppendRetryStoreFaultAfterTemporaryFsync = 1,
  AncPrivateVaultHostedAppendRetryStoreFaultAfterRenameBeforeReadback = 2,
  AncPrivateVaultHostedAppendRetryStoreFaultAfterRemoveRename = 3,
  AncPrivateVaultHostedAppendRetryStoreFaultBeforeDirectoryReopen = 4,
  AncPrivateVaultHostedAppendRetryStoreFaultDirectoryListing = 5,
};

#if ANC_PRIVATE_VAULT_TESTING
typedef BOOL (^AncPrivateVaultHostedAppendRetryStoreFaultHook)(
    AncPrivateVaultHostedAppendRetryStoreFaultPoint point);
FOUNDATION_EXPORT void
    AncPrivateVaultHostedAppendRetryStoreSetFaultHookForTesting(
        AncPrivateVaultHostedAppendRetryStoreFaultHook _Nullable hook);
#endif

NS_ASSUME_NONNULL_END
