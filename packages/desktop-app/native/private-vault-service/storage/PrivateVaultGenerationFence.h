#import <Foundation/Foundation.h>

#import "PrivateVaultCrypto.h"
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
@property(nonatomic, readonly) NSData *recordDigest;
@end

@interface AncPrivateVaultGenerationFence : NSObject

- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init;

- (AncPrivateVaultFenceStatus)
    beginGeneration:(uint64_t)generation
       recordDigest:(NSData *)recordDigest
            vaultId:(NSString *)vaultId
           recordId:(NSString *)recordId;

- (AncPrivateVaultFenceStatus)
    commitGeneration:(uint64_t)generation
        recordDigest:(NSData *)recordDigest
             vaultId:(NSString *)vaultId
            recordId:(NSString *)recordId;

- (AncPrivateVaultFenceStatus)readVaultId:(NSString *)vaultId
                                  recordId:(NSString *)recordId
                                  snapshot:
                                      (AncPrivateVaultFenceSnapshot *_Nullable
                                           *_Nullable)snapshot;

@end

// v2 binds generation and exact custody-record digest in both independently
// stored frames. Same-generation digest disagreement is corruption/rollback,
// never an idempotent transition. Neither item has a deletion API.

NS_ASSUME_NONNULL_END
