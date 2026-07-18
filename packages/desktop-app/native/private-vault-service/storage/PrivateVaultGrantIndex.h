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
         provider:(NSString *)provider;

/** Binds the locally sealed result to the claimed job before hosted release. */
- (AncPrivateVaultGrantIndexStatus)
    recordResultHash:(NSData *)resultHash
               state:(NSString *)state
               jobId:(NSData *)jobId
              jobHash:(NSData *)jobHash
               vaultId:(NSString *)vaultId;
@end

NS_ASSUME_NONNULL_END
