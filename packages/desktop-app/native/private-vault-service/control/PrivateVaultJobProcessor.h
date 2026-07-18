#import <Foundation/Foundation.h>

#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultGrantIndex.h"
#import "PrivateVaultJobCodec.h"
#import "PrivateVaultSession.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultJobProcessorStatus) {
  AncPrivateVaultJobProcessorStatusOK = 0,
  AncPrivateVaultJobProcessorStatusInvalid = 1,
  AncPrivateVaultJobProcessorStatusLocked = 2,
  AncPrivateVaultJobProcessorStatusStaleAuthority = 3,
  AncPrivateVaultJobProcessorStatusUnauthorized = 4,
  AncPrivateVaultJobProcessorStatusReplay = 5,
  AncPrivateVaultJobProcessorStatusCryptoFailed = 6,
  AncPrivateVaultJobProcessorStatusStorageFailed = 7,
};

@interface AncPrivateVaultAuthorizedJob : NSObject
@property(nonatomic, readonly) NSData *body;
@property(nonatomic, readonly) NSData *jobHash;
@end

/** Signed-native semantic job boundary. Plaintext never enters hosted code. */
@interface AncPrivateVaultJobProcessor : NSObject
- (instancetype)initWithSession:(AncPrivateVaultSession *)session
                  authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
                      grantIndex:(AncPrivateVaultGrantIndex *)grantIndex
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

- (AncPrivateVaultJobProcessorStatus)
    openJobEnvelope:(NSData *)jobEnvelope
            vaultId:(NSString *)vaultId
               jobId:(NSData *)jobId
          nowSeconds:(uint64_t)nowSeconds
              result:(AncPrivateVaultAuthorizedJob *_Nullable *_Nullable)result;
@end

NS_ASSUME_NONNULL_END
