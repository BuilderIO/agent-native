#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void *_Nullable (*AncPrivateVaultGuardedMalloc)(size_t size);
typedef int (*AncPrivateVaultGuardedMemoryOperation)(void *memory,
                                                      size_t size);
typedef void (*AncPrivateVaultGuardedMemzero)(void *memory, size_t size);
typedef void (*AncPrivateVaultGuardedFree)(void *memory);

typedef struct AncPrivateVaultGuardedMemoryFunctions {
  AncPrivateVaultGuardedMalloc malloc_fn;
  AncPrivateVaultGuardedMemoryOperation mlock_fn;
  AncPrivateVaultGuardedMemoryOperation mprotect_noaccess_fn;
  AncPrivateVaultGuardedMemoryOperation mprotect_readwrite_fn;
  AncPrivateVaultGuardedMemzero memzero_fn;
  AncPrivateVaultGuardedFree free_fn;
} AncPrivateVaultGuardedMemoryFunctions;

/*
 * An injected free_fn must securely dispose of an allocation even when a
 * failed protection transition makes an explicit memzero unsafe. sodium_free
 * provides that production fallback; ordinary free is test-only.
 */

typedef NS_ENUM(NSInteger, AncPrivateVaultGuardedMemoryStatus) {
  AncPrivateVaultGuardedMemoryStatusOK = 0,
  AncPrivateVaultGuardedMemoryStatusInvalid = 1,
  AncPrivateVaultGuardedMemoryStatusAllocationFailed = 2,
  AncPrivateVaultGuardedMemoryStatusProtectionFailed = 3,
  AncPrivateVaultGuardedMemoryStatusCallbackFailed = 4,
  AncPrivateVaultGuardedMemoryStatusClosed = 5,
};

typedef BOOL (^AncPrivateVaultGuardedMemoryBorrowBlock)(uint8_t *bytes,
                                                        size_t length);

@interface AncPrivateVaultGuardedMemory : NSObject

+ (nullable instancetype)memoryWithLength:(size_t)length
                                   status:
                                       (AncPrivateVaultGuardedMemoryStatus *)status;

+ (nullable instancetype)
    memoryWithLength:(size_t)length
           functions:(const AncPrivateVaultGuardedMemoryFunctions *)functions
              status:(AncPrivateVaultGuardedMemoryStatus *)status;

@property(nonatomic, readonly) size_t length;
@property(nonatomic, readonly, getter=isClosed) BOOL closed;

/*
 * The pointer is valid only during the callback and must not be retained. Each
 * borrow is serialized and restores noaccess even if the callback returns NO
 * or raises an Objective-C exception.
 */
- (AncPrivateVaultGuardedMemoryStatus)
    borrow:(AncPrivateVaultGuardedMemoryBorrowBlock)block;

/* Zeroizes before free when readwrite protection can be established. */
- (AncPrivateVaultGuardedMemoryStatus)close;

@end

NS_ASSUME_NONNULL_END
