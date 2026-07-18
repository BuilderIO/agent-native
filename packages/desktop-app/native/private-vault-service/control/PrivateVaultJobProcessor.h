#import <Foundation/Foundation.h>

#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultGrantIndex.h"
#import "PrivateVaultJobCodec.h"
#import "PrivateVaultResultSpool.h"
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
                     resultSpool:(AncPrivateVaultResultSpool *)resultSpool
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

- (AncPrivateVaultJobProcessorStatus)
    openJobEnvelope:(NSData *)jobEnvelope
            vaultId:(NSString *)vaultId
               jobId:(NSData *)jobId
          nowSeconds:(uint64_t)nowSeconds
              result:(AncPrivateVaultAuthorizedJob *_Nullable *_Nullable)result;

- (AncPrivateVaultJobProcessorStatus)
    sealResultPayload:(NSData *)payload
                 state:(NSString *)state
               vaultId:(NSString *)vaultId
                  jobId:(NSData *)jobId
                 jobHash:(NSData *)jobHash
              nowSeconds:(uint64_t)nowSeconds
                  result:(NSData *_Nullable *_Nullable)result;

- (AncPrivateVaultJobProcessorStatus)
    acknowledgeHostedResultForVaultId:(NSString *)vaultId
                                  jobId:(NSData *)jobId
                                 jobHash:(NSData *)jobHash
                                    state:(NSString *)state;
@end

#if ANC_PRIVATE_VAULT_TESTING
typedef BOOL (^AncPrivateVaultJobProcessorAfterSpoolFaultHook)(void);
FOUNDATION_EXPORT void AncPrivateVaultJobProcessorSetAfterSpoolFaultHookForTesting(
    AncPrivateVaultJobProcessorAfterSpoolFaultHook _Nullable hook);
#endif

NS_ASSUME_NONNULL_END
