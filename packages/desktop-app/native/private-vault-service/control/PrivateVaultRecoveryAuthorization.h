#import <Foundation/Foundation.h>

#import "PrivateVaultControlLog.h"
#import "PrivateVaultRecoveryAuthority.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultRecoveryAuthorizationStatus) {
  AncPrivateVaultRecoveryAuthorizationStatusOK = 0,
  AncPrivateVaultRecoveryAuthorizationStatusInvalidArgument,
  AncPrivateVaultRecoveryAuthorizationStatusInvalidCanonical,
  AncPrivateVaultRecoveryAuthorizationStatusBinding,
  AncPrivateVaultRecoveryAuthorizationStatusSignature,
  AncPrivateVaultRecoveryAuthorizationStatusTime,
  AncPrivateVaultRecoveryAuthorizationStatusCurrentWrap,
  AncPrivateVaultRecoveryAuthorizationStatusReplacementWrap,
  AncPrivateVaultRecoveryAuthorizationStatusEEKContinuity,
};

/** Immutable public result retained only after the complete recovery edge,
 * both mnemonic-derived authorities, both wraps, and their shared EEK verify. */
@interface AncPrivateVaultRecoveryAuthorizationResult : NSObject
@property(nonatomic, readonly) NSData *authorizationHash;
@property(nonatomic, readonly) NSData *snapshotHash;
@property(nonatomic, readonly) NSData *confirmationNonce;
@property(nonatomic, readonly) NSData *confirmationEnvelopeId;
@property(nonatomic, readonly) NSData *ceremonyId;
@property(nonatomic, readonly) NSData *candidateEndpointId;
@property(nonatomic, readonly) NSData *replacementWrapHash;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/**
 * Trusted recovery verifier. Both authorities must have been derived locally
 * from the user-confirmed mnemonic for the current and next generations. The
 * verifier snapshots public evidence at construction and never exposes an EEK
 * or private key through its result.
 */
@interface AncPrivateVaultRecoveryAuthorizationVerifier
    : NSObject <AncPrivateVaultControlLogAuthorizationVerifier>
@property(nonatomic, readonly, nullable)
    AncPrivateVaultRecoveryAuthorizationResult *result;
@property(nonatomic, readonly) AncPrivateVaultRecoveryAuthorizationStatus status;

- (nullable instancetype)
       initWithAuthorization:(NSData *)authorization
             currentSnapshot:(NSData *)currentSnapshot
         currentRecoveryWrap:(NSData *)currentRecoveryWrap
           consumedAuthority:
               (AncPrivateVaultRecoveryAuthority *)consumedAuthority
        replacementAuthority:
            (AncPrivateVaultRecoveryAuthority *)replacementAuthority
     trustedNowMilliseconds:(uint64_t)trustedNowMilliseconds
                       status:
                           (AncPrivateVaultRecoveryAuthorizationStatus *_Nullable)
                               status NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/** Public-history verifier for a device that has no recovery entropy. */
@interface AncPrivateVaultRecoveryPublicEvidenceVerifier
    : NSObject <AncPrivateVaultControlLogAuthorizationVerifier>
@property(nonatomic, readonly, nullable)
    AncPrivateVaultRecoveryAuthorizationResult *result;
@property(nonatomic, readonly) AncPrivateVaultRecoveryAuthorizationStatus status;

- (nullable instancetype)
       initWithAuthorization:(NSData *)authorization
             currentSnapshot:(NSData *)currentSnapshot
         currentRecoveryWrap:(NSData *)currentRecoveryWrap
     trustedNowMilliseconds:(uint64_t)trustedNowMilliseconds
                       status:
                           (AncPrivateVaultRecoveryAuthorizationStatus *_Nullable)
                               status NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

FOUNDATION_EXPORT NSString *AncPrivateVaultRecoveryAuthorizationCategory(
    AncPrivateVaultRecoveryAuthorizationStatus status);

NS_ASSUME_NONNULL_END
