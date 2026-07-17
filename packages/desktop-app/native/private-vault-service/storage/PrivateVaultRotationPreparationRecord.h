#ifndef AGENT_NATIVE_PRIVATE_VAULT_ROTATION_PREPARATION_RECORD_H
#define AGENT_NATIVE_PRIVATE_VAULT_ROTATION_PREPARATION_RECORD_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "PrivateVaultCrypto.h"

#ifdef __cplusplus
extern "C" {
#endif

enum {
  ANC_PV_ROTATION_PREPARATION_RECORD_BYTES = 512,
  ANC_PV_ROTATION_PREPARATION_ID_BYTES = 16,
  ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES = 32,
  ANC_PV_ROTATION_PREPARATION_VERSION = 1,
  ANC_PV_ROTATION_PREPARATION_FLAG_EDGE_BOUND = 1 << 0,
  ANC_PV_ROTATION_PREPARATION_FLAG_SPOOL_DURABLE = 1 << 1,
};

typedef enum AncPrivateVaultRotationPreparationPhase {
  ANC_PV_ROTATION_PREPARATION_PHASE_PREPARED = 1,
  ANC_PV_ROTATION_PREPARATION_PHASE_REWRAPPED = 2,
  ANC_PV_ROTATION_PREPARATION_PHASE_ACKNOWLEDGED = 3,
  ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT = 4,
  ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED = 5,
  ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED = 6,
} AncPrivateVaultRotationPreparationPhase;

typedef enum AncPrivateVaultRotationPreparationRole {
  ANC_PV_ROTATION_PREPARATION_ROLE_ENDPOINT = 1,
  ANC_PV_ROTATION_PREPARATION_ROLE_BROKER = 2,
} AncPrivateVaultRotationPreparationRole;

/*
 * Values map one-to-one to the frozen anc/v1 record category vocabulary.
 * The category name function returns the exact wire-contract spelling.
 */
typedef enum AncPrivateVaultRotationPreparationStatus {
  ANC_PV_ROTATION_PREPARATION_OK = 0,
  ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT,
  ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_MAGIC,
  ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_VERSION,
  ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_LENGTH,
  ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_PHASE,
  ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_FLAGS,
  ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_ROLE,
  ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_UNATTENDED_ROLE,
  ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_ZERO_PADDING,
  ANC_PV_ROTATION_PREPARATION_RECORD_RANGE_GENERATION,
  ANC_PV_ROTATION_PREPARATION_RECORD_RANGE_SEQUENCE,
  ANC_PV_ROTATION_PREPARATION_RECORD_RANGE_EPOCH,
  ANC_PV_ROTATION_PREPARATION_RECORD_BINDING_PENDING_EPOCH,
  ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_EDGE_FIELDS,
  ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_ARTIFACT_FIELDS,
  ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_EXPECTED_SEQUENCE,
  ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_PREVIOUS_HEAD,
  ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_TRANSCRIPT,
  ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_ARTIFACT_LENGTH,
  ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_SPOOL_DIGEST,
  ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_PENDING_KEY,
  ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_CLEANED,
  ANC_PV_ROTATION_PREPARATION_RECORD_TRANSITION_GENERATION,
  ANC_PV_ROTATION_PREPARATION_RECORD_CRYPTO_CHECKSUM,
  ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_TRUNCATION,
  ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_EXTRA_BYTES,
  ANC_PV_ROTATION_PREPARATION_RECORD_BINDING_SUBSTITUTION,
} AncPrivateVaultRotationPreparationStatus;

/* Immutable-by-convention public state. The pending epoch key is absent. */
typedef struct AncPrivateVaultRotationPreparationSnapshot {
  AncPrivateVaultRotationPreparationPhase phase;
  uint8_t flags;
  AncPrivateVaultRotationPreparationRole role;
  uint8_t unattended;
  uint64_t preparation_generation;
  uint8_t vault_id[ANC_PV_ROTATION_PREPARATION_ID_BYTES];
  uint8_t endpoint_id[ANC_PV_ROTATION_PREPARATION_ID_BYTES];
  uint8_t ceremony_id[ANC_PV_ROTATION_PREPARATION_ID_BYTES];
  uint64_t base_custody_generation;
  uint8_t base_frame_digest[ANC_PV_HASH_BYTES];
  uint64_t base_sequence;
  uint8_t base_head[ANC_PV_HASH_BYTES];
  uint8_t base_membership[ANC_PV_HASH_BYTES];
  uint64_t base_epoch;
  uint64_t base_recovery_generation;
  uint8_t signing_public_key[ANC_PV_SIGN_PUBLIC_KEY_BYTES];
  uint8_t agreement_public_key[ANC_PV_BOX_PUBLIC_KEY_BYTES];
  uint8_t enrollment_ref[ANC_PV_ROTATION_PREPARATION_ID_BYTES];
  uint64_t pending_epoch;
  uint64_t expected_sequence;
  uint8_t expected_previous_head[ANC_PV_HASH_BYTES];
  uint8_t transcript_digest[ANC_PV_HASH_BYTES];
  uint64_t signed_entry_length;
  uint64_t recovery_wrap_length;
  uint8_t encrypted_spool_digest[ANC_PV_HASH_BYTES];
} AncPrivateVaultRotationPreparationSnapshot;

/*
 * Secret material is borrowed from or written into exact, caller-controlled
 * 32-byte buffers only for the duration of a call. It is never exposed by the
 * public snapshot or an Objective-C object. Decode clears both outputs after
 * any validated-disjoint failure. Alias rejection happens before inspection,
 * so potentially overlapping outputs remain untouched. All input/output
 * regions must be pairwise disjoint.
 */
AncPrivateVaultRotationPreparationStatus
anc_pv_rotation_preparation_record_encode(
    const AncPrivateVaultRotationPreparationSnapshot *snapshot,
    const uint8_t
        pending_epoch_key[ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES],
    uint8_t record[ANC_PV_ROTATION_PREPARATION_RECORD_BYTES],
    size_t record_length);

AncPrivateVaultRotationPreparationStatus
anc_pv_rotation_preparation_record_decode(
    const uint8_t *record, size_t record_length,
    AncPrivateVaultRotationPreparationSnapshot *snapshot,
    uint8_t pending_epoch_key[ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES]);

bool anc_pv_rotation_preparation_phase_transition_allowed(
    AncPrivateVaultRotationPreparationPhase from,
    AncPrivateVaultRotationPreparationPhase to);

/*
 * Validates both records plus the phase-local, record-contained CAS bindings:
 * stable preparation identity/key, key removal, tombstone cleanup, and the
 * CLEANED(g) -> PREPARED(g+1) fence. Store must separately gate transitions on
 * verified spool replay, official-custody promotion, durable hosted ack,
 * physical spool deletion/fsync, and the next authoritative checkpoint; none
 * of those facts can be proven by this fixed record alone.
 */
AncPrivateVaultRotationPreparationStatus
anc_pv_rotation_preparation_transition_validate(const uint8_t *from_record,
                                                size_t from_length,
                                                const uint8_t *to_record,
                                                size_t to_length);

const char *anc_pv_rotation_preparation_status_category(
    AncPrivateVaultRotationPreparationStatus status);

void anc_pv_rotation_preparation_snapshot_zero(
    AncPrivateVaultRotationPreparationSnapshot *snapshot);

#ifdef __cplusplus
}
#endif

#endif
