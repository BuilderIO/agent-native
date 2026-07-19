#import <Foundation/Foundation.h>

#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultKeychain.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultContinuityCoordinatorStatus) {
  AncPrivateVaultContinuityCoordinatorStatusOK = 0,
  AncPrivateVaultContinuityCoordinatorStatusInvalid = 1,
  AncPrivateVaultContinuityCoordinatorStatusNotFound = 2,
  AncPrivateVaultContinuityCoordinatorStatusConflict = 3,
  AncPrivateVaultContinuityCoordinatorStatusUnauthorized = 4,
  AncPrivateVaultContinuityCoordinatorStatusStorageFailed = 5,
  AncPrivateVaultContinuityCoordinatorStatusReceiptRejected = 6,
};

@interface AncPrivateVaultPreparedContinuity : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) NSData *signedEntry;
@property(nonatomic, readonly) NSData *requestBody;
@property(nonatomic, readonly) NSString *proofHeader;
@property(nonatomic, readonly) NSString *entryId;
@property(nonatomic, readonly) uint64_t sequence;
@property(nonatomic, readonly) NSData *headHash;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultContinuityCoordinator : NSObject
- (instancetype)initWithAuthorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
                              keychain:(AncPrivateVaultKeychain *)keychain
                            controlLog:(id)controlLog NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

- (AncPrivateVaultContinuityCoordinatorStatus)
    prepareVaultId:(NSString *)vaultId
       logEnvelopeId:(NSString *)logEnvelopeId
      entryCreatedAt:(NSString *)entryCreatedAt
       proofIssuedAt:(NSString *)proofIssuedAt
               nonce:(NSString *)nonce
          endpointId:(NSString *)endpointId
         signingSeed:(const uint8_t *_Nonnull)signingSeed
expectedSigningPublicKey:(NSData *)expectedSigningPublicKey
              result:(AncPrivateVaultPreparedContinuity *_Nullable *_Nullable)result;

- (AncPrivateVaultContinuityCoordinatorStatus)
    finalizeVaultId:(NSString *)vaultId
             receipt:(NSData *)receipt
        verifiedAtMs:(uint64_t)verifiedAtMs;
@end

NS_ASSUME_NONNULL_END
