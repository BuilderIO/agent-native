#import "PrivateVaultCustodyRepository.h"

NS_ASSUME_NONNULL_BEGIN

/* Secret-free evidence returned only after the repository has reconciled and
 * reread the exact generation-fenced custody record. The record digest is the
 * custody wire-record fence digest, never the authority snapshot digest. */
@interface AncPrivateVaultPendingGenesisCustodyCheckpoint : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) uint64_t custodyGeneration;
@property(nonatomic, readonly) NSData *recordDigest;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultCancelledGenesisCustodyCheckpoint : NSObject
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) uint64_t custodyGeneration;
@property(nonatomic, readonly) NSData *recordDigest;
@property(nonatomic, readonly) NSData *cancellationCommitment;
@property(nonatomic, readonly) uint64_t cancelledAtMs;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultCustodyRepository (GenesisInternal)

/* Creates the one allowed pending-genesis g1 shape from confirmed, authenticated
 * identities. Exact bytes are idempotent; any existing different custody state
 * conflicts. The caller must supply five exact 32-byte secret buffers with an
 * all-zero active key and the epoch-one EEK in pending_epoch_key. */
- (AncPrivateVaultCustodyRepositoryStatus)
    installPendingGenesisVaultId:(NSString *)vaultId
                       endpointId:(NSString *)endpointId
                       ceremonyId:(NSString *)ceremonyId
                  signingPublicKey:(NSData *)signingPublicKey
                       boxPublicKey:(NSData *)boxPublicKey
            bootstrapTranscriptDigest:(NSData *)bootstrapTranscriptDigest
                          secrets:
                              (const AncPrivateVaultCustodySecretInputs *)secrets
                       checkpoint:
                           (AncPrivateVaultPendingGenesisCustodyCheckpoint
                                *_Nullable *_Nullable)checkpoint;

/* Rereads an exact pending-genesis g1 and its generation-fence record digest.
 * This method returns no secret handle. */
- (AncPrivateVaultCustodyRepositoryStatus)
    pendingGenesisCheckpointVaultId:(NSString *)vaultId
                           endpointId:(NSString *)endpointId
                           ceremonyId:(NSString *)ceremonyId
                      signingPublicKey:(NSData *)signingPublicKey
                           boxPublicKey:(NSData *)boxPublicKey
              bootstrapTranscriptDigest:(NSData *)bootstrapTranscriptDigest
                            checkpoint:
                                (AncPrivateVaultPendingGenesisCustodyCheckpoint
                                     *_Nullable *_Nullable)checkpoint;

/* Exact pending-genesis g1 -> terminal cancelled-genesis g2 CAS. The expected
 * digest is the full g1 wire-record fence digest previously bound by the
 * preparation store. No authority anchor is invented and all custody secrets
 * are erased. */
- (AncPrivateVaultCustodyRepositoryStatus)
    cancelPendingGenesisVaultId:(NSString *)vaultId
            expectedRecordDigest:(NSData *)expectedRecordDigest
                   cancelledAtMs:(uint64_t)cancelledAtMs
                      checkpoint:
                          (AncPrivateVaultCancelledGenesisCustodyCheckpoint
                               *_Nullable *_Nullable)checkpoint;

@end

NS_ASSUME_NONNULL_END
