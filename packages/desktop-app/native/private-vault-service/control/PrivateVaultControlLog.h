#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultControlLogStatus) {
  AncPrivateVaultControlLogStatusOK = 0,
  AncPrivateVaultControlLogStatusInvalidEntry = 1,
  AncPrivateVaultControlLogStatusInvalidSignature = 2,
  AncPrivateVaultControlLogStatusInvalidGenesis = 3,
  AncPrivateVaultControlLogStatusInvalidTransition = 4,
  AncPrivateVaultControlLogStatusUnauthorizedSigner = 5,
  AncPrivateVaultControlLogStatusCandidateSelfEnrollment = 6,
  AncPrivateVaultControlLogStatusRollback = 7,
  AncPrivateVaultControlLogStatusGap = 8,
  AncPrivateVaultControlLogStatusFork = 9,
  AncPrivateVaultControlLogStatusGenesisAuthorizationRequired = 10,
  AncPrivateVaultControlLogStatusRecoveryAuthorizationRequired = 11,
  AncPrivateVaultControlLogStatusRecoveryWrapRotationRequired = 12,
  AncPrivateVaultControlLogStatusCeremonyAbortAuthorizationRequired = 13,
  AncPrivateVaultControlLogStatusGrantRevocationAuthorizationRequired = 14,
  AncPrivateVaultControlLogStatusFailed = 15,
  AncPrivateVaultControlLogStatusEnrollmentAuthorizationRequired = 16,
};

@interface AncPrivateVaultControlLogMember : NSObject
@property(nonatomic, readonly) NSString *endpointId;
@property(nonatomic, readonly) NSString *role;
@property(nonatomic, readonly) BOOL unattended;
@property(nonatomic, readonly) NSData *signingPublicKey;
@property(nonatomic, readonly) NSData *keyAgreementPublicKey;
@property(nonatomic, readonly) NSString *enrollmentRef;
@end

@interface AncPrivateVaultControlLogState : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) uint64_t sequence;
@property(nonatomic, readonly) NSData *headHash;
@property(nonatomic, readonly) NSData *membershipHash;
@property(nonatomic, readonly) NSString *signedAt;
@property(nonatomic, readonly) NSArray<AncPrivateVaultControlLogMember *> *activeMembers;
@property(nonatomic, readonly) NSArray<NSString *> *removedEndpointIds;
@property(nonatomic, readonly) uint64_t epoch;
@property(nonatomic, readonly) uint64_t recoveryGeneration;
@property(nonatomic, readonly) NSString *recoveryId;
@property(nonatomic, readonly) NSData *recoverySigningPublicKey;
@property(nonatomic, readonly) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readonly) NSData *recoveryWrapHash;
@property(nonatomic, readonly) NSString *freshnessMode;
@end

@interface AncPrivateVaultControlLogMembershipCommit : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) NSString *ceremonyId;
@property(nonatomic, readonly) NSString *ceremonyKind;
@property(nonatomic, readonly) uint64_t epoch;
@property(nonatomic, readonly, nullable) NSData *previousMembershipHash;
@property(nonatomic, readonly) NSArray<AncPrivateVaultControlLogMember *> *activeMembers;
@property(nonatomic, readonly) NSArray<NSString *> *removedEndpointIds;
@property(nonatomic, readonly) BOOL rotationCompleted;
@property(nonatomic, readonly) BOOL outstandingJobsResolved;
@property(nonatomic, readonly, nullable) NSData *recoverySnapshotHash;
@property(nonatomic, readonly, nullable) NSData *recoveryAuthorizationHash;
@property(nonatomic, readonly) uint64_t recoveryGeneration;
@property(nonatomic, readonly) NSString *recoveryId;
@property(nonatomic, readonly) NSData *recoverySigningPublicKey;
@property(nonatomic, readonly) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readonly) NSData *recoveryWrapHash;
@end

@interface AncPrivateVaultControlLogSignedEntry : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) NSString *createdAt;
@property(nonatomic, readonly) NSString *envelopeId;
@property(nonatomic, readonly) uint64_t sequence;
@property(nonatomic, readonly) NSData *previousHash;
@property(nonatomic, readonly) NSData *innerEnvelopeBytes;
@property(nonatomic, readonly) NSString *signerEndpointId;
@property(nonatomic, readonly) NSData *signature;
@end

@protocol AncPrivateVaultControlLogAuthorizationVerifier <NSObject>
@optional
/// Authorizes genesis from immutable typed snapshots and the exact canonical
/// bytes whose signature was authenticated.
- (BOOL)verifyGenesisMembershipCommit:(AncPrivateVaultControlLogMembershipCommit *)commit
                           signedEntry:(AncPrivateVaultControlLogSignedEntry *)entry
                      signedEntryBytes:(NSData *)signedEntryBytes
                    innerEnvelopeBytes:(NSData *)innerEnvelopeBytes;
- (BOOL)verifyRecoverySignedEntry:(NSData *)signedEntry
                    innerEnvelope:(NSData *)innerEnvelope
                      currentState:(AncPrivateVaultControlLogState *)state;
/// Preferred recovery seam. It supplies the same immutable typed projection
/// used by genesis and wrap rotation, plus the authenticated prior state and
/// exact canonical bytes. Implementations must authenticate every projection
/// against the separate recovery evidence before returning YES.
- (BOOL)verifyRecoveryMembershipCommit:
            (AncPrivateVaultControlLogMembershipCommit *)commit
                            signedEntry:
                                (AncPrivateVaultControlLogSignedEntry *)entry
                           currentState:
                               (AncPrivateVaultControlLogState *)state
                       signedEntryBytes:(NSData *)signedEntryBytes
                     innerEnvelopeBytes:(NSData *)innerEnvelopeBytes;
/// Verifies the separate Core-defined recovery-wrap rotation artifact bound to
/// this parsed commit. This callback is an authorization seam, not the wrap
/// artifact codec or verifier itself, and must fail closed until that verifier
/// has authenticated the new wrap hash, epoch, and activation context.
- (BOOL)verifyRecoveryWrapRotationCommit:(AncPrivateVaultControlLogMembershipCommit *)commit
                              signedEntry:(AncPrivateVaultControlLogSignedEntry *)entry
                             currentState:(AncPrivateVaultControlLogState *)state
                         signedEntryBytes:(NSData *)signedEntryBytes
                       innerEnvelopeBytes:(NSData *)innerEnvelopeBytes;
/// Optional exact enrollment seam. Generic authenticated replay remains able
/// to ingest historical add-device/add-broker edges without ceremony bundles;
/// an enrollment activator supplies this callback and requires it to succeed.
- (BOOL)verifyEnrollmentMembershipCommit:
            (AncPrivateVaultControlLogMembershipCommit *)commit
                              signedEntry:
                                  (AncPrivateVaultControlLogSignedEntry *)entry
                             currentState:
                                 (AncPrivateVaultControlLogState *)state
                         signedEntryBytes:(NSData *)signedEntryBytes
                       innerEnvelopeBytes:(NSData *)innerEnvelopeBytes;
- (BOOL)verifyCeremonyAbortSignedEntry:(NSData *)signedEntry
                         innerEnvelope:(NSData *)innerEnvelope
                           currentState:(AncPrivateVaultControlLogState *)state;
/// Applies the exact signed grant-revoke envelope to durable native grant
/// authority before the outer control-log head is allowed to advance.
- (BOOL)verifyGrantRevocationSignedEntry:(NSData *)signedEntry
                           innerEnvelope:(NSData *)innerEnvelope
                      revocationEnvelope:(NSData *)revocationEnvelope
                            currentState:(AncPrivateVaultControlLogState *)state;
@end

@interface AncPrivateVaultControlLogReplayResult : NSObject
@property(nonatomic, readonly) AncPrivateVaultControlLogState *state;
@property(nonatomic, readonly) NSData *entryHash;
@property(nonatomic, readonly) BOOL idempotent;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultControlLog : NSObject
- (AncPrivateVaultControlLogStatus)
    replaySignedEntry:(NSData *)signedEntry
         currentState:(AncPrivateVaultControlLogState *_Nullable)currentState
             verifier:(id<AncPrivateVaultControlLogAuthorizationVerifier> _Nullable)verifier
               result:(AncPrivateVaultControlLogReplayResult *_Nullable *_Nonnull)result;
@end

NS_ASSUME_NONNULL_END
