#import <Foundation/Foundation.h>

#import "PrivateVaultKeychain.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(uint8_t, AncPrivateVaultFenceState) {
  AncPrivateVaultFenceStateAbsent = 0,
  AncPrivateVaultFenceStatePending = 1,
  AncPrivateVaultFenceStateStable = 2,
};

typedef NS_ENUM(NSInteger, AncPrivateVaultFenceStatus) {
  AncPrivateVaultFenceStatusOK = 0,
  AncPrivateVaultFenceStatusInvalid = 1,
  AncPrivateVaultFenceStatusConflict = 2,
  AncPrivateVaultFenceStatusRollbackDetected = 3,
  AncPrivateVaultFenceStatusCorrupt = 4,
  AncPrivateVaultFenceStatusInaccessible = 5,
  AncPrivateVaultFenceStatusFailed = 6,
};

@interface AncPrivateVaultFenceSnapshot : NSObject
@property(nonatomic, readonly) AncPrivateVaultFenceState state;
@property(nonatomic, readonly) uint64_t generation;
@end

@interface AncPrivateVaultGenerationFence : NSObject

- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init;

// Starts exactly generation 1 for a new fence, or exactly stable + 1. Repeating
// the same pending target is idempotent. No API permits caller-directed rewind
// or deletion.
- (AncPrivateVaultFenceStatus)beginGeneration:(uint64_t)generation
                                      vaultId:(NSString *)vaultId
                                     recordId:(NSString *)recordId;

// Commits only the exact pending generation. Repeating the same stable commit
// is idempotent.
- (AncPrivateVaultFenceStatus)commitGeneration:(uint64_t)generation
                                       vaultId:(NSString *)vaultId
                                      recordId:(NSString *)recordId;

- (AncPrivateVaultFenceStatus)readVaultId:(NSString *)vaultId
                                  recordId:(NSString *)recordId
                                  snapshot:
                                      (AncPrivateVaultFenceSnapshot *_Nullable
                                           *_Nullable)snapshot;

@end

// Security boundary: with the companion record intact and current, deletion or
// generation rewind of either single record is detected. The
// pending(1)+missing-fence first-create seam is recoverable. Coordinated
// mutation or restoration of both records (including restoring pending(1)
// while deleting the fence), whole-access-group deletion, and root restore are
// outside what two co-resident Keychain items can prove. Authenticated
// whole-vault removal and a stronger external root are outside this slice.

NS_ASSUME_NONNULL_END
