#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

enum {
  ANC_PV_GENESIS_HOSTED_APPEND_RECEIPT_MAX_BYTES = 1024,
  ANC_PV_GENESIS_HOSTED_APPEND_REQUEST_MAX_BYTES = 1310976,
};

@interface AncPrivateVaultGenesisHostedAppendReceipt : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) NSString *entryId;
@property(nonatomic, readonly) uint64_t sequence;
@property(nonatomic, readonly) NSData *headHash;
@property(nonatomic, readonly) NSData *recoveryWrapHash;
@property(nonatomic, readonly) uint64_t recoveryWrapByteLength;
@end

@interface AncPrivateVaultRecoveryHostedAppendReceipt : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) NSString *entryId;
@property(nonatomic, readonly) uint64_t sequence;
@property(nonatomic, readonly) NSData *headHash;
@property(nonatomic, readonly) NSData *recoveryWrapHash;
@property(nonatomic, readonly) uint64_t recoveryWrapByteLength;
@end

FOUNDATION_EXPORT AncPrivateVaultGenesisHostedAppendReceipt *_Nullable
AncPrivateVaultGenesisHostedAppendReceiptDecode(NSData *encoded);

FOUNDATION_EXPORT AncPrivateVaultRecoveryHostedAppendReceipt *_Nullable
AncPrivateVaultRecoveryHostedAppendReceiptDecode(NSData *encoded);

/* Constructs only the fixed canonical public-artifact request. Network origin,
 * path, authentication proof, and receipt handling remain separate native
 * capabilities. */
FOUNDATION_EXPORT NSData *_Nullable
AncPrivateVaultGenesisHostedAppendRequestEncode(NSData *signedGenesisEntry,
                                                NSData *recoveryWrap);

NS_ASSUME_NONNULL_END
