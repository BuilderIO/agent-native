#import <Foundation/Foundation.h>

#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultDisclosureCodec.h"
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
@property(nonatomic, readonly) NSData *resourceId;
@property(nonatomic, readonly) NSString *operation;
@end

@interface AncPrivateVaultPendingResult : NSObject
@property(nonatomic, readonly) NSData *jobId;
@property(nonatomic, readonly) NSData *jobHash;
@property(nonatomic, readonly) NSString *state;
@property(nonatomic, readonly) uint64_t epoch;
@property(nonatomic, readonly) uint64_t retryCount;
@property(nonatomic, readonly) NSString *algorithmId;
@property(nonatomic, readonly) NSData *resultEnvelope;
@property(nonatomic, readonly) NSData *disclosureEnvelope;
@property(nonatomic, readonly) NSData *disclosureId;
@property(nonatomic, readonly) NSData *grantId;
@property(nonatomic, readonly) NSData *grantRef;
@property(nonatomic, readonly) NSData *resourceId;
@property(nonatomic, readonly) NSString *operation;
@property(nonatomic, readonly) NSString *providerId;
@property(nonatomic, readonly) NSString *destination;
@property(nonatomic, readonly) NSData *scopeHash;
@property(nonatomic, readonly) uint64_t issuedAt;
@property(nonatomic, readonly) uint64_t expiresAt;
@end

@interface AncPrivateVaultSealedResult : NSObject
@property(nonatomic, readonly) NSData *resultEnvelope;
@property(nonatomic, readonly) NSData *disclosureEnvelope;
@property(nonatomic, readonly) NSData *disclosureId;
@property(nonatomic, readonly) NSData *grantRef;
@property(nonatomic, readonly) NSString *providerId;
@property(nonatomic, readonly) NSString *destination;
@property(nonatomic, readonly) NSData *scopeHash;
@property(nonatomic, readonly) uint64_t issuedAt;
@property(nonatomic, readonly) uint64_t expiresAt;
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
          hostedEpoch:(uint64_t)hostedEpoch
     hostedRetryCount:(uint64_t)hostedRetryCount
     hostedAlgorithmId:(NSString *)hostedAlgorithmId
          nowSeconds:(uint64_t)nowSeconds
              result:(AncPrivateVaultAuthorizedJob *_Nullable *_Nullable)result;

- (AncPrivateVaultJobProcessorStatus)
    sealResultPayload:(NSData *)payload
                 state:(NSString *)state
               vaultId:(NSString *)vaultId
                  jobId:(NSData *)jobId
                 jobHash:(NSData *)jobHash
              nowSeconds:(uint64_t)nowSeconds
                  result:(AncPrivateVaultSealedResult *_Nullable *_Nullable)result;

- (AncPrivateVaultJobProcessorStatus)
    acknowledgeHostedResultForVaultId:(NSString *)vaultId
                                  jobId:(NSData *)jobId
                                 jobHash:(NSData *)jobHash
                                    state:(NSString *)state;

/** Returns one exact encrypted result that must be idempotently resubmitted. */
- (AncPrivateVaultJobProcessorStatus)
    recoverPendingHostedResultForVaultId:(NSString *)vaultId
                              nowSeconds:(uint64_t)nowSeconds
                                    result:
                                        (AncPrivateVaultPendingResult *_Nullable
                                             *_Nullable)result;

/** Signs one canonical broker-route proof after independently binding it to
 * the fresh single-broker authority and currently unlocked native identity. */
- (AncPrivateVaultJobProcessorStatus)
    signEndpointRequestProof:(NSData *)unsignedProof
                   nowSeconds:(uint64_t)nowSeconds
                       result:(NSData *_Nullable *_Nullable)result;
@end

#if ANC_PRIVATE_VAULT_TESTING
typedef BOOL (^AncPrivateVaultJobProcessorAfterSpoolFaultHook)(void);
FOUNDATION_EXPORT void AncPrivateVaultJobProcessorSetAfterSpoolFaultHookForTesting(
    AncPrivateVaultJobProcessorAfterSpoolFaultHook _Nullable hook);
#endif

NS_ASSUME_NONNULL_END
