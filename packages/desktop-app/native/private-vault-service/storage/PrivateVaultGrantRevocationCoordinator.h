#import <Foundation/Foundation.h>

#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultGrantIndex.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultGrantRevocationCoordinatorStatus) {
  AncPrivateVaultGrantRevocationCoordinatorStatusOK = 0,
  AncPrivateVaultGrantRevocationCoordinatorStatusInvalid = 1,
  AncPrivateVaultGrantRevocationCoordinatorStatusNotFound = 2,
  AncPrivateVaultGrantRevocationCoordinatorStatusConflict = 3,
  AncPrivateVaultGrantRevocationCoordinatorStatusUnauthorized = 4,
  AncPrivateVaultGrantRevocationCoordinatorStatusStorageFailed = 5,
  AncPrivateVaultGrantRevocationCoordinatorStatusReceiptRejected = 6,
};

@interface AncPrivateVaultPreparedGrantRevocation : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) NSData *grantRef;
@property(nonatomic, readonly) NSData *signedEntry;
@property(nonatomic, readonly) NSData *requestBody;
@property(nonatomic, readonly) NSString *proofHeader;
@property(nonatomic, readonly) NSString *entryId;
@property(nonatomic, readonly) uint64_t sequence;
@property(nonatomic, readonly) NSData *headHash;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultGrantRevocationCoordinator : NSObject
- (instancetype)initWithGrantIndex:(AncPrivateVaultGrantIndex *)grantIndex
                    authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
                        controlLog:(id)controlLog NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

- (AncPrivateVaultGrantRevocationCoordinatorStatus)
    prepareVaultId:(NSString *)vaultId
          grantRef:(NSData *)grantRef
revocationEnvelopeId:(NSData *)revocationEnvelopeId
       logEnvelopeId:(NSString *)logEnvelopeId
           createdAt:(NSString *)createdAt
       revokedAtSeconds:(uint64_t)revokedAtSeconds
             reason:(NSString *)reason
              nonce:(NSString *)nonce
         endpointId:(NSString *)endpointId
        signingSeed:(const uint8_t *_Nonnull)signingSeed
expectedSigningPublicKey:(NSData *)expectedSigningPublicKey
             result:(AncPrivateVaultPreparedGrantRevocation
                          *_Nullable *_Nullable)result;

- (AncPrivateVaultGrantRevocationCoordinatorStatus)
    finalizeVaultId:(NSString *)vaultId
             receipt:(NSData *)receipt
        verifiedAtMs:(uint64_t)verifiedAtMs;
@end

NS_ASSUME_NONNULL_END
