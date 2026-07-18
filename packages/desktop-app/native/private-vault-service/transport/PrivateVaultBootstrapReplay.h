#import <Foundation/Foundation.h>

#import "PrivateVaultBootstrapFrame.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultGuardedMemory.h"
#import "PrivateVaultRecoveryAuthority.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultBootstrapReplayStatus) {
  AncPrivateVaultBootstrapReplayStatusOK = 0,
  AncPrivateVaultBootstrapReplayStatusInvalidArgument,
  AncPrivateVaultBootstrapReplayStatusPagePin,
  AncPrivateVaultBootstrapReplayStatusEvidence,
  AncPrivateVaultBootstrapReplayStatusControlLog,
  AncPrivateVaultBootstrapReplayStatusAuthority,
  AncPrivateVaultBootstrapReplayStatusRecoveryWrap,
  AncPrivateVaultBootstrapReplayStatusEEKContinuity,
  AncPrivateVaultBootstrapReplayStatusFinalWrap,
  AncPrivateVaultBootstrapReplayStatusComplete,
};

/**
 * Stateful signed-native bootstrap replay. The initializer takes ownership of
 * the guarded recovery entropy. A successful final page closes that entropy
 * after deriving the current generation authority; failure closes every held
 * secret. Parsed frames never become state except through this reducer.
 */
@interface AncPrivateVaultBootstrapReplay : NSObject
@property(nonatomic, readonly, nullable) AncPrivateVaultControlLogState *state;
@property(nonatomic, readonly, nullable) NSData *currentRecoveryWrap;
@property(nonatomic, readonly, nullable) AncPrivateVaultGuardedMemory *verifiedEEK;
@property(nonatomic, readonly, nullable)
    AncPrivateVaultRecoveryAuthority *currentRecoveryAuthority;
@property(nonatomic, readonly, nullable)
    AncPrivateVaultRecoveryAuthority *replacementRecoveryAuthority;
@property(nonatomic, readonly, getter=isComplete) BOOL complete;
@property(nonatomic, readonly) AncPrivateVaultBootstrapReplayStatus status;

- (nullable instancetype)
    initWithOwnedRecoveryEntropy:(AncPrivateVaultGuardedMemory *)recoveryEntropy
          trustedNowMilliseconds:(uint64_t)trustedNowMilliseconds
                          status:
                              (AncPrivateVaultBootstrapReplayStatus *_Nullable)
                                  status NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;

- (BOOL)consumeFrame:(AncPrivateVaultBootstrapFrame *)frame
               status:(AncPrivateVaultBootstrapReplayStatus *_Nullable)status;
- (void)invalidate;
@end

FOUNDATION_EXPORT NSString *AncPrivateVaultBootstrapReplayCategory(
    AncPrivateVaultBootstrapReplayStatus status);

NS_ASSUME_NONNULL_END
