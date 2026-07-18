#import <Foundation/Foundation.h>

#import "PrivateVaultGrantCodec.h"
#import "PrivateVaultKeychain.h"
#import "PrivateVaultSession.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultGrantIndexStatus) {
  AncPrivateVaultGrantIndexStatusOK = 0,
  AncPrivateVaultGrantIndexStatusNotFound = 1,
  AncPrivateVaultGrantIndexStatusUnauthorized = 2,
  AncPrivateVaultGrantIndexStatusInvalid = 3,
  AncPrivateVaultGrantIndexStatusConflict = 4,
  AncPrivateVaultGrantIndexStatusRollbackDetected = 5,
  AncPrivateVaultGrantIndexStatusCorrupt = 6,
  AncPrivateVaultGrantIndexStatusStorageFailed = 7,
  AncPrivateVaultGrantIndexStatusCustodyUnavailable = 8,
  AncPrivateVaultGrantIndexStatusReplay = 9,
};

@interface AncPrivateVaultGrantIndexSnapshot : NSObject
@property(nonatomic, readonly) uint64_t generation;
@property(nonatomic, readonly) NSUInteger grantCount;
@property(nonatomic, readonly) NSUInteger revocationCount;
@property(nonatomic, readonly) NSUInteger jobCount;
@end

@interface AncPrivateVaultGrantContext : NSObject
@property(nonatomic, readonly) NSData *grantRef;
@property(nonatomic, readonly) NSData *subjectAccountId;
@property(nonatomic, readonly) NSData *subjectEndpointId;
@property(nonatomic, readonly, nullable) NSData *subjectAgentId;
@end

@interface AncPrivateVaultJobContext : NSObject
@property(nonatomic, readonly) NSData *jobId;
@property(nonatomic, readonly) NSData *jobHash;
@property(nonatomic, readonly) NSData *subjectEndpointId;
@property(nonatomic, readonly) NSData *requesterBoxPublicKey;
@property(nonatomic, readonly) BOOL resultRecorded;
@property(nonatomic, readonly) BOOL receiptAcknowledged;
@property(nonatomic, readonly, nullable) NSString *resultState;
@property(nonatomic, readonly, nullable) NSData *resultHash;
@property(nonatomic, readonly) uint64_t hostedEpoch;
@property(nonatomic, readonly) uint64_t hostedRetryCount;
@property(nonatomic, readonly, nullable) NSString *hostedAlgorithmId;
@end

@interface AncPrivateVaultGrantIndex : NSObject
- (instancetype)initWithStateRootURL:(NSURL *)stateRootURL
                             session:(AncPrivateVaultSession *)session
                            keychain:(AncPrivateVaultKeychain *)keychain
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

- (AncPrivateVaultGrantIndexStatus)
    loadVaultId:(NSString *)vaultId
       snapshot:(AncPrivateVaultGrantIndexSnapshot *_Nullable *_Nullable)snapshot;

- (AncPrivateVaultGrantIndexStatus)
    storeGrantEnvelope:(NSData *)grantEnvelope
               vaultId:(NSString *)vaultId
            nowSeconds:(uint64_t)nowSeconds
       issuerEndpointId:(NSData *)issuerEndpointId
 issuerControlEndpointId:(NSString *)issuerControlEndpointId
issuerSigningPublicKey:(NSData *)issuerSigningPublicKey;

- (AncPrivateVaultGrantIndexStatus)
    applyRevocationEnvelope:(NSData *)revocationEnvelope
                    vaultId:(NSString *)vaultId
    signerControlEndpointId:(NSString *)signerControlEndpointId
     signerSigningPublicKey:(NSData *)signerSigningPublicKey;

- (AncPrivateVaultGrantIndexStatus)
    authorizeGrantRef:(NSData *)grantRef
              vaultId:(NSString *)vaultId
           nowSeconds:(uint64_t)nowSeconds
     subjectAccountId:(NSData *)subjectAccountId
    subjectEndpointId:(NSData *)subjectEndpointId
       subjectAgentId:(NSData *_Nullable)subjectAgentId
           resourceId:(NSData *)resourceId
            operation:(NSString *)operation
             provider:(NSString *)provider;

/** Resolves only a currently valid, unrevoked grant; it conveys no key material. */
- (AncPrivateVaultGrantIndexStatus)
    resolveGrantRef:(NSData *)grantRef
            vaultId:(NSString *)vaultId
         nowSeconds:(uint64_t)nowSeconds
            context:(AncPrivateVaultGrantContext *_Nullable *_Nullable)context;

/** Atomically authorizes the grant and claims one unexpired random job id. */
- (AncPrivateVaultGrantIndexStatus)
    claimJobId:(NSData *)jobId
        jobHash:(NSData *)jobHash
        grantRef:(NSData *)grantRef
         vaultId:(NSString *)vaultId
      nowSeconds:(uint64_t)nowSeconds
  expiresAtSeconds:(uint64_t)expiresAtSeconds
subjectAccountId:(NSData *)subjectAccountId
subjectEndpointId:(NSData *)subjectEndpointId
   subjectAgentId:(NSData *_Nullable)subjectAgentId
requesterSigningPublicKey:(NSData *)requesterSigningPublicKey
 requesterBoxPublicKey:(NSData *)requesterBoxPublicKey
       resourceId:(NSData *)resourceId
        operation:(NSString *)operation
         provider:(NSString *)provider
         hostedEpoch:(uint64_t)hostedEpoch
    hostedRetryCount:(uint64_t)hostedRetryCount
    hostedAlgorithmId:(NSString *)hostedAlgorithmId;

/** Binds the locally sealed result to the claimed job before hosted release. */
- (AncPrivateVaultGrantIndexStatus)
    recordResultHash:(NSData *)resultHash
               state:(NSString *)state
               jobId:(NSData *)jobId
              jobHash:(NSData *)jobHash
               vaultId:(NSString *)vaultId;

/** Marks the exact hosted result receipt durable before spool deletion. */
- (AncPrivateVaultGrantIndexStatus)
    acknowledgeResultHash:(NSData *)resultHash
                    state:(NSString *)state
                    jobId:(NSData *)jobId
                   jobHash:(NSData *)jobHash
                    vaultId:(NSString *)vaultId;

- (AncPrivateVaultGrantIndexStatus)
    resolveJobId:(NSData *)jobId
          jobHash:(NSData *)jobHash
           vaultId:(NSString *)vaultId
           context:(AncPrivateVaultJobContext *_Nullable *_Nullable)context;

/** Returns one requester-encrypted result awaiting hosted reconciliation. */
- (AncPrivateVaultGrantIndexStatus)
    nextPendingResultForVaultId:(NSString *)vaultId
                         context:(AncPrivateVaultJobContext *_Nullable *_Nullable)context;
@end

NS_ASSUME_NONNULL_END
