#import <Foundation/Foundation.h>

#import "PrivateVaultGuardedMemory.h"
#import "PrivateVaultKeychain.h"

NS_ASSUME_NONNULL_BEGIN

enum {
  ANC_PV_RECOVERY_PREPARATION_ID_BYTES = 16,
  ANC_PV_RECOVERY_PREPARATION_HASH_BYTES = 32,
};

FOUNDATION_EXPORT NSString *const AncPrivateVaultRecoveryPreparationService;
FOUNDATION_EXPORT NSString *const AncPrivateVaultRecoveryPreparationRecordId;

typedef NS_ENUM(NSInteger, AncPrivateVaultRecoveryPreparationStoreStatus) {
  AncPrivateVaultRecoveryPreparationStoreStatusOK = 0,
  AncPrivateVaultRecoveryPreparationStoreStatusNotFound,
  AncPrivateVaultRecoveryPreparationStoreStatusInvalid,
  AncPrivateVaultRecoveryPreparationStoreStatusConflict,
  AncPrivateVaultRecoveryPreparationStoreStatusCorrupt,
  AncPrivateVaultRecoveryPreparationStoreStatusInaccessible,
  AncPrivateVaultRecoveryPreparationStoreStatusFailed,
};

typedef struct AncPrivateVaultRecoveryPreparationSecretInputs {
  const uint8_t *endpoint_signing_seed;
  const uint8_t *endpoint_box_seed;
  const uint8_t *local_state_key;
  const uint8_t *eek;
} AncPrivateVaultRecoveryPreparationSecretInputs;

typedef struct AncPrivateVaultRecoveryPreparationSnapshot {
  uint8_t vault_id[ANC_PV_RECOVERY_PREPARATION_ID_BYTES];
  uint8_t lookup_id[ANC_PV_RECOVERY_PREPARATION_ID_BYTES];
  uint8_t ceremony_id[ANC_PV_RECOVERY_PREPARATION_ID_BYTES];
  uint8_t candidate_endpoint_id[ANC_PV_RECOVERY_PREPARATION_ID_BYTES];
  uint8_t artifact_digest[ANC_PV_RECOVERY_PREPARATION_HASH_BYTES];
  uint64_t verified_at_ms;
  uint64_t next_epoch;
  uint64_t replacement_recovery_generation;
  uint64_t expected_next_sequence;
  uint8_t expected_previous_head[ANC_PV_RECOVERY_PREPARATION_HASH_BYTES];
  uint8_t recovery_authorization_hash
      [ANC_PV_RECOVERY_PREPARATION_HASH_BYTES];
  uint8_t entry_id[ANC_PV_RECOVERY_PREPARATION_ID_BYTES];
  uint8_t entry_hash[ANC_PV_RECOVERY_PREPARATION_HASH_BYTES];
  uint8_t recovery_wrap_hash[ANC_PV_RECOVERY_PREPARATION_HASH_BYTES];
  uint8_t candidate_signing_public_key
      [ANC_PV_RECOVERY_PREPARATION_HASH_BYTES];
  uint8_t candidate_key_agreement_public_key
      [ANC_PV_RECOVERY_PREPARATION_HASH_BYTES];
  uint64_t recovery_wrap_byte_length;
  uint8_t artifact_commitment[ANC_PV_RECOVERY_PREPARATION_HASH_BYTES];
} AncPrivateVaultRecoveryPreparationSnapshot;

typedef BOOL (^AncPrivateVaultRecoveryPreparationSecretsBorrowBlock)(
    const AncPrivateVaultRecoveryPreparationSecretInputs *secrets);

@interface AncPrivateVaultRecoveryPreparationSecretsHandle : NSObject
@property(nonatomic, readonly, getter=isClosed) BOOL closed;
- (AncPrivateVaultRecoveryPreparationStoreStatus)
    borrow:(AncPrivateVaultRecoveryPreparationSecretsBorrowBlock)block;
- (AncPrivateVaultRecoveryPreparationStoreStatus)close;
@end

/* Opaque proof that the fixed preparation record was authenticated from the
 * native Keychain. Its public fields are intentionally available only through
 * the internal evidence bridge. */
@interface AncPrivateVaultRecoveryPreparationEvidence : NSObject
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultRecoveryPreparationStore : NSObject
- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

- (AncPrivateVaultRecoveryPreparationStoreStatus)
    createSnapshot:(const AncPrivateVaultRecoveryPreparationSnapshot *)snapshot
            secrets:
                (const AncPrivateVaultRecoveryPreparationSecretInputs *)secrets;

- (AncPrivateVaultRecoveryPreparationStoreStatus)
    readVaultId:(NSString *)vaultId
       snapshot:(AncPrivateVaultRecoveryPreparationSnapshot *)snapshot
         handle:(AncPrivateVaultRecoveryPreparationSecretsHandle *_Nullable
                     *_Nullable)handle;

- (AncPrivateVaultRecoveryPreparationStoreStatus)
    readEvidenceVaultId:(NSString *)vaultId
               evidence:(AncPrivateVaultRecoveryPreparationEvidence *_Nullable
                             *_Nonnull)evidence
                 handle:(AncPrivateVaultRecoveryPreparationSecretsHandle
                             *_Nullable *_Nullable)handle;

- (AncPrivateVaultRecoveryPreparationStoreStatus)deleteVaultId:
    (NSString *)vaultId;
@end

NS_ASSUME_NONNULL_END
