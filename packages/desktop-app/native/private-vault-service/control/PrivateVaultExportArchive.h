#import <Foundation/Foundation.h>

#import "PrivateVaultGuardedMemory.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultExportArchiveStatus) {
  AncPrivateVaultExportArchiveStatusOK = 0,
  AncPrivateVaultExportArchiveStatusInvalid = 1,
  AncPrivateVaultExportArchiveStatusEncoding = 2,
  AncPrivateVaultExportArchiveStatusCrypto = 3,
  AncPrivateVaultExportArchiveStatusAuthentication = 4,
  AncPrivateVaultExportArchiveStatusCleanup = 5,
};

@interface AncPrivateVaultExportArchiveMetadata : NSObject
@property(nonatomic, readonly) NSData *vaultId;
@property(nonatomic, readonly) NSData *exportId;
@property(nonatomic, readonly) uint64_t createdAt;
@property(nonatomic, readonly) NSData *sourceSnapshotHash;
@property(nonatomic, readonly) uint64_t objectCount;
@property(nonatomic, readonly) NSData *plaintextHash;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultSealedExportArchive : NSObject
@property(nonatomic, readonly) NSData *encodedArchive;
@property(nonatomic, readonly) AncPrivateVaultExportArchiveMetadata *metadata;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultOpenedExportArchive : NSObject
@property(nonatomic, readonly) NSData *plaintext;
@property(nonatomic, readonly) AncPrivateVaultExportArchiveMetadata *metadata;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/* Recovery material remains in guarded native memory. The archive is bound to
 * exact migration evidence and is independently decryptable without a server. */
FOUNDATION_EXPORT AncPrivateVaultSealedExportArchive *_Nullable
AncPrivateVaultSealExportArchive(
    NSData *vaultId, NSData *exportId, uint64_t createdAt,
    NSData *sourceSnapshotHash, uint64_t objectCount, NSData *plaintext,
    AncPrivateVaultGuardedMemory *recoveryRoot, NSData *nonce,
    AncPrivateVaultExportArchiveStatus *_Nullable status);

/* This public inspection surface returns coordinates only, never ciphertext
 * plaintext, recovery material, or a derived export key. */
FOUNDATION_EXPORT AncPrivateVaultExportArchiveMetadata *_Nullable
AncPrivateVaultInspectExportArchive(
    NSData *encodedArchive,
    AncPrivateVaultExportArchiveStatus *_Nullable status);

FOUNDATION_EXPORT AncPrivateVaultOpenedExportArchive *_Nullable
AncPrivateVaultOpenExportArchive(
    NSData *encodedArchive, NSData *expectedVaultId,
    AncPrivateVaultGuardedMemory *recoveryRoot,
    AncPrivateVaultExportArchiveStatus *_Nullable status);

FOUNDATION_EXPORT NSString *AncPrivateVaultExportArchiveCategory(
    AncPrivateVaultExportArchiveStatus status);

NS_ASSUME_NONNULL_END
