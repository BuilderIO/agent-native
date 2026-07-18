#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultResultSpoolStatus) {
  AncPrivateVaultResultSpoolStatusOK = 0,
  AncPrivateVaultResultSpoolStatusNotFound = 1,
  AncPrivateVaultResultSpoolStatusInvalid = 2,
  AncPrivateVaultResultSpoolStatusCorrupt = 3,
  AncPrivateVaultResultSpoolStatusStorageFailed = 4,
  AncPrivateVaultResultSpoolStatusConflict = 5,
};

/**
 * Crash-safe storage for an exact requester-encrypted result envelope.
 * stateRootURL must already be an owner-only 0700 directory. The trust anchor
 * is pinned and never created, chmodded, or followed through a symlink.
 */
@interface AncPrivateVaultResultSpool : NSObject
- (instancetype)initWithStateRootURL:(NSURL *)stateRootURL
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

- (AncPrivateVaultResultSpoolStatus)storeEnvelope:(NSData *)envelope
                                          vaultId:(NSData *)vaultId
                                             jobId:(NSData *)jobId;
- (AncPrivateVaultResultSpoolStatus)loadEnvelopeForVaultId:(NSData *)vaultId
                                                     jobId:(NSData *)jobId
                                                    result:(NSData *_Nullable *_Nullable)result;
/** Deletes only when the live file still equals expectedEnvelope. */
- (AncPrivateVaultResultSpoolStatus)deleteEnvelope:(NSData *)expectedEnvelope
                                           vaultId:(NSData *)vaultId
                                              jobId:(NSData *)jobId;
@end

NS_ASSUME_NONNULL_END
