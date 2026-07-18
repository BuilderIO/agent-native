#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

enum {
  ANC_PV_BOOTSTRAP_PAGE_MAX_ENTRIES = 8,
  ANC_PV_BOOTSTRAP_FRAME_MAX_BYTES = 26746884,
};

typedef NS_ENUM(NSInteger, AncPrivateVaultBootstrapFrameStatus) {
  AncPrivateVaultBootstrapFrameStatusOK = 0,
  AncPrivateVaultBootstrapFrameStatusInvalid = 1,
  AncPrivateVaultBootstrapFrameStatusTooLarge = 2,
  AncPrivateVaultBootstrapFrameStatusBounds = 3,
};

@interface AncPrivateVaultBootstrapFrame : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) int64_t afterSequence;
@property(nonatomic, readonly) int64_t throughSequence;
@property(nonatomic, readonly) uint64_t headSequence;
@property(nonatomic, readonly) NSString *headHash;
@property(nonatomic, readonly) BOOL complete;
@property(nonatomic, readonly) NSArray<NSData *> *entries;
@property(nonatomic, readonly) NSArray<id> *entryRecoveryWraps;
@property(nonatomic, readonly) NSArray<id> *entryEvidenceKinds;
@property(nonatomic, readonly) NSArray<id> *entryEvidence;
@property(nonatomic, readonly, nullable) NSString *recoveryWrapHash;
@property(nonatomic, readonly, nullable) NSData *recoveryWrap;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

FOUNDATION_EXPORT AncPrivateVaultBootstrapFrame *_Nullable
AncPrivateVaultBootstrapFrameDecode(
    NSData *encoded, AncPrivateVaultBootstrapFrameStatus *_Nullable status);

NS_ASSUME_NONNULL_END
