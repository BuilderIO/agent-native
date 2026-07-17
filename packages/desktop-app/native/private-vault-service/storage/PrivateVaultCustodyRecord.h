#ifndef AGENT_NATIVE_PRIVATE_VAULT_CUSTODY_RECORD_H
#define AGENT_NATIVE_PRIVATE_VAULT_CUSTODY_RECORD_H

#include <stddef.h>
#include <stdint.h>

#include "PrivateVaultCrypto.h"

#ifdef __cplusplus
extern "C" {
#endif

enum {
  ANC_PV_CUSTODY_RECORD_BYTES = 1088,
  ANC_PV_CUSTODY_ID_BYTES = 160,
  ANC_PV_CUSTODY_CHECKSUM_BYTES = ANC_PV_HASH_BYTES,
  ANC_PV_CUSTODY_VERSION = 1,
};

typedef enum AncPrivateVaultCustodyRecordStatus {
  ANC_PV_CUSTODY_OK = 0,
  ANC_PV_CUSTODY_INVALID_ARGUMENT = 1,
  ANC_PV_CUSTODY_INVALID_RECORD = 2,
  ANC_PV_CUSTODY_CHECKSUM_FAILED = 3,
  ANC_PV_CUSTODY_CRYPTO_FAILED = 4,
} AncPrivateVaultCustodyRecordStatus;

typedef enum AncPrivateVaultCustodyLifecycle {
  ANC_PV_CUSTODY_LIFECYCLE_PENDING = 1,
  ANC_PV_CUSTODY_LIFECYCLE_ACTIVE = 2,
  ANC_PV_CUSTODY_LIFECYCLE_REMOVING = 3,
  ANC_PV_CUSTODY_LIFECYCLE_REMOVED = 4,
} AncPrivateVaultCustodyLifecycle;

typedef enum AncPrivateVaultCustodyRole {
  ANC_PV_CUSTODY_ROLE_ENDPOINT = 1,
  ANC_PV_CUSTODY_ROLE_BROKER = 2,
} AncPrivateVaultCustodyRole;

typedef enum AncPrivateVaultCustodyPendingKind {
  ANC_PV_CUSTODY_PENDING_NONE = 0,
  ANC_PV_CUSTODY_PENDING_GENESIS = 1,
  ANC_PV_CUSTODY_PENDING_ADD_DEVICE = 2,
  ANC_PV_CUSTODY_PENDING_ADD_BROKER = 3,
  ANC_PV_CUSTODY_PENDING_RECOVERY = 4,
} AncPrivateVaultCustodyPendingKind;

typedef enum AncPrivateVaultCustodyRotationPhase {
  ANC_PV_CUSTODY_ROTATION_NONE = 0,
  ANC_PV_CUSTODY_ROTATION_PREPARED = 1,
  ANC_PV_CUSTODY_ROTATION_REWRAPPED = 2,
  ANC_PV_CUSTODY_ROTATION_ACKNOWLEDGED = 3,
  ANC_PV_CUSTODY_ROTATION_AWAITING_CONTROL_COMMIT = 4,
} AncPrivateVaultCustodyRotationPhase;

typedef enum AncPrivateVaultCustodyEnrollmentPhase {
  ANC_PV_CUSTODY_ENROLLMENT_NONE = 0,
  ANC_PV_CUSTODY_ENROLLMENT_OFFER_PENDING = 1,
  ANC_PV_CUSTODY_ENROLLMENT_AUTHORIZATION_RECEIVED = 2,
} AncPrivateVaultCustodyEnrollmentPhase;

/*
 * Public, copyable record state. Secret byte arrays are intentionally absent.
 * Identifier lengths are authoritative; bytes after each length must be zero.
 */
typedef struct AncPrivateVaultCustodySnapshot {
  AncPrivateVaultCustodyLifecycle lifecycle;
  AncPrivateVaultCustodyRole role;
  AncPrivateVaultCustodyPendingKind pending_kind;
  AncPrivateVaultCustodyRotationPhase rotation_phase;
  AncPrivateVaultCustodyEnrollmentPhase enrollment_phase;
  uint64_t custody_generation;
  uint8_t vault_id[ANC_PV_CUSTODY_ID_BYTES];
  size_t vault_id_length;
  uint8_t endpoint_id[ANC_PV_CUSTODY_ID_BYTES];
  size_t endpoint_id_length;
  uint8_t ceremony_id[ANC_PV_CUSTODY_ID_BYTES];
  size_t ceremony_id_length;
  uint8_t signing_public_key[ANC_PV_SIGN_PUBLIC_KEY_BYTES];
  uint8_t box_public_key[ANC_PV_BOX_PUBLIC_KEY_BYTES];
  uint64_t active_epoch;
  uint64_t pending_epoch;
  uint64_t recovery_generation;
  uint64_t anchored_sequence;
  uint8_t anchored_head[ANC_PV_HASH_BYTES];
  uint8_t membership_digest[ANC_PV_HASH_BYTES];
  uint64_t signed_at_ms;
  uint8_t snapshot_digest[ANC_PV_HASH_BYTES];
  uint64_t freshness_ms;
  uint64_t expected_next_sequence;
  uint8_t expected_previous_head[ANC_PV_HASH_BYTES];
  uint8_t pending_transcript_digest[ANC_PV_HASH_BYTES];
  uint64_t removal_sequence;
  uint8_t removal_head[ANC_PV_HASH_BYTES];
  uint8_t removal_authorization_digest[ANC_PV_HASH_BYTES];
  uint64_t removal_time_ms;
} AncPrivateVaultCustodySnapshot;

/*
 * All pointers name exact 32-byte controlled buffers. Encode borrows const
 * inputs only for the call. Decode writes into caller-owned buffers and clears
 * every output on failure. Callers must zero and release those buffers.
 * Record, snapshot, descriptor, and every 32-byte region must be pairwise
 * disjoint. Alias rejection happens before parsing or copying. A destination
 * that aliases the borrowed record is left untouched with that source; only
 * disjoint destinations are cleared. Likewise, encode cannot clear a record
 * that aliases one of its const inputs. The descriptor itself must be disjoint
 * before decode can inspect it, so unknown destinations cannot be cleared.
 */
typedef struct AncPrivateVaultCustodySecretInputs {
  const uint8_t *signing_seed;
  const uint8_t *box_seed;
  const uint8_t *local_state_key;
  const uint8_t *active_epoch_key;
  const uint8_t *pending_epoch_key;
} AncPrivateVaultCustodySecretInputs;

typedef struct AncPrivateVaultCustodySecretOutputs {
  uint8_t *signing_seed;
  uint8_t *box_seed;
  uint8_t *local_state_key;
  uint8_t *active_epoch_key;
  uint8_t *pending_epoch_key;
} AncPrivateVaultCustodySecretOutputs;

AncPrivateVaultCustodyRecordStatus anc_pv_custody_record_encode(
    const AncPrivateVaultCustodySnapshot *snapshot,
    const AncPrivateVaultCustodySecretInputs *secrets, uint8_t *record,
    size_t record_length);

AncPrivateVaultCustodyRecordStatus anc_pv_custody_record_decode(
    const uint8_t *record, size_t record_length,
    AncPrivateVaultCustodySnapshot *snapshot,
    const AncPrivateVaultCustodySecretOutputs *secrets);

void anc_pv_custody_snapshot_zero(AncPrivateVaultCustodySnapshot *snapshot);

#ifdef __cplusplus
}
#endif

#endif
