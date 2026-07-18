#import <Foundation/Foundation.h>

#import "PrivateVaultGuardedMemory.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultRecoveryAuthorityStatus) {
  AncPrivateVaultRecoveryAuthorityStatusOK = 0,
  AncPrivateVaultRecoveryAuthorityStatusInvalidArgument = 1,
  AncPrivateVaultRecoveryAuthorityStatusOutOfRange = 2,
  AncPrivateVaultRecoveryAuthorityStatusMemoryFailed = 3,
  AncPrivateVaultRecoveryAuthorityStatusCryptoFailed = 4,
};

@interface AncPrivateVaultRecoveryAuthority : NSObject
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@property(nonatomic, readonly) uint64_t recoveryGeneration;
@property(nonatomic, readonly) NSData *recoveryId;
@property(nonatomic, readonly) NSData *signingPublicKey;
@property(nonatomic, readonly) NSData *keyAgreementPublicKey;
@property(nonatomic, readonly) AncPrivateVaultGuardedMemory *signingPrivateKey;
@property(nonatomic, readonly)
    AncPrivateVaultGuardedMemory *keyAgreementPrivateKey;
@end

FOUNDATION_EXPORT AncPrivateVaultRecoveryAuthority
    *_Nullable AncPrivateVaultDeriveRecoveryAuthority(
        AncPrivateVaultGuardedMemory *recoveryEntropy, NSData *vaultId,
        uint64_t recoveryGeneration,
        AncPrivateVaultRecoveryAuthorityStatus *status);

NS_ASSUME_NONNULL_END
