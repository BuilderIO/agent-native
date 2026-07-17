#import <Foundation/Foundation.h>

#import "PrivateVaultCustodyRecord.h"
#import "PrivateVaultGenerationFence.h"
#import "PrivateVaultGuardedMemory.h"
#import "PrivateVaultKeychain.h"

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSString *const AncPrivateVaultCustodyRecordId;

typedef NS_ENUM(NSInteger, AncPrivateVaultCustodyRepositoryStatus) {
  AncPrivateVaultCustodyRepositoryStatusOK = 0,
  AncPrivateVaultCustodyRepositoryStatusNotFound = 1,
  AncPrivateVaultCustodyRepositoryStatusInvalid = 2,
  AncPrivateVaultCustodyRepositoryStatusConflict = 3,
  AncPrivateVaultCustodyRepositoryStatusRollbackDetected = 4,
  AncPrivateVaultCustodyRepositoryStatusCorrupt = 5,
  AncPrivateVaultCustodyRepositoryStatusInaccessible = 6,
  AncPrivateVaultCustodyRepositoryStatusFailed = 7,
};

typedef BOOL (^AncPrivateVaultCustodyHandleBorrowBlock)(
    const AncPrivateVaultCustodySecretInputs *secrets);

@interface AncPrivateVaultCustodyHandle : NSObject
@property(nonatomic, readonly, getter=isClosed) BOOL closed;
- (AncPrivateVaultCustodyRepositoryStatus)
    borrow:(AncPrivateVaultCustodyHandleBorrowBlock)block;
- (AncPrivateVaultCustodyRepositoryStatus)close;
@end

@interface AncPrivateVaultCustodyRepository : NSObject

- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init;

- (AncPrivateVaultCustodyRepositoryStatus)
    storeSnapshot:(const AncPrivateVaultCustodySnapshot *)snapshot
           secrets:(const AncPrivateVaultCustodySecretInputs *)secrets
           vaultId:(NSString *)vaultId;

- (AncPrivateVaultCustodyRepositoryStatus)
    readVaultId:(NSString *)vaultId
       snapshot:(AncPrivateVaultCustodySnapshot *)snapshot
          handle:(AncPrivateVaultCustodyHandle *_Nullable *_Nullable)handle;

@end

#if ANC_PRIVATE_VAULT_TESTING
typedef void (^AncPrivateVaultCustodyBeforeHandleCloseTestHook)(
    AncPrivateVaultCustodyHandle *handle);
FOUNDATION_EXPORT void AncPrivateVaultCustodySetBeforeHandleCloseForTesting(
    AncPrivateVaultCustodyBeforeHandleCloseTestHook _Nullable hook);
#endif

// Keychain necessarily materializes a short-lived pageable CFData copy. The
// repository bounds it to the fixed 1088-byte record, validates exact readback,
// and imports the five 32-byte secrets into a guarded 160-byte allocation.

NS_ASSUME_NONNULL_END
