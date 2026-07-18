#import <Foundation/Foundation.h>

#import "PrivateVaultCustodyRecord.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultSessionStatus) {
  AncPrivateVaultSessionStatusOK = 0,
  AncPrivateVaultSessionStatusInvalid = 1,
  AncPrivateVaultSessionStatusNotFound = 2,
  AncPrivateVaultSessionStatusRejected = 3,
  AncPrivateVaultSessionStatusConflict = 4,
  AncPrivateVaultSessionStatusEvictionFailed = 5,
  AncPrivateVaultSessionStatusFailed = 6,
};

@protocol AncPrivateVaultSessionCustodyHandle <NSObject>
@property(nonatomic, readonly, getter=isClosed) BOOL closed;
- (NSInteger)borrow:(BOOL (^)(const AncPrivateVaultCustodySecretInputs *))block;
- (NSInteger)close;
@end

@protocol AncPrivateVaultSessionCustodyRepository <NSObject>
- (NSInteger)readVaultId:(NSString *)vaultId
                snapshot:(AncPrivateVaultCustodySnapshot *)snapshot
                  handle:(id<AncPrivateVaultSessionCustodyHandle> _Nullable
                              *_Nullable)handle;
@end

typedef BOOL (^AncPrivateVaultSessionBorrowBlock)(
    const AncPrivateVaultCustodySnapshot *snapshot,
    const AncPrivateVaultCustodySecretInputs *secrets);

/**
 * Serial, guarded custody session owned by the signed XPC service. Secret
 * pointers are valid only inside `borrowVaultId:block:` and never cross XPC.
 */
@interface AncPrivateVaultSession : NSObject

- (instancetype)initWithRepository:
    (id<AncPrivateVaultSessionCustodyRepository>)repository
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

@property(nonatomic, readonly, getter=isUnlocked) BOOL unlocked;

- (AncPrivateVaultSessionStatus)unlockVaultId:(NSString *)vaultId;
- (AncPrivateVaultSessionStatus)lock;
- (AncPrivateVaultSessionStatus)
    borrowVaultId:(NSString *)vaultId
             block:(AncPrivateVaultSessionBorrowBlock)block;

@end

NS_ASSUME_NONNULL_END
