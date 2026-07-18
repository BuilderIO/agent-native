#ifndef AGENT_NATIVE_PRIVATE_VAULT_GENESIS_PREPARATION_RECORD_H
#define AGENT_NATIVE_PRIVATE_VAULT_GENESIS_PREPARATION_RECORD_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "PrivateVaultCrypto.h"

enum {
  ANC_PV_GENESIS_PREPARATION_RECORD_BYTES = 1024,
  ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES = 48,
  ANC_PV_GENESIS_PREPARATION_LOOKUP_ID_BYTES = 16,
  ANC_PV_GENESIS_PREPARATION_SECRET_BYTES = 32,
  ANC_PV_GENESIS_PREPARATION_VERSION = 1,
  ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND = 1 << 0,
  ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE = 1 << 1,
  ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND = 1 << 2,
  ANC_PV_GENESIS_PREPARATION_FLAG_OFFICIAL_AUTHORITY_BOUND = 1 << 3,
  ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED = 1 << 4,
  ANC_PV_GENESIS_PREPARATION_FLAG_HOSTED_RECEIPT_BOUND = 1 << 5,
};

typedef enum AncPrivateVaultGenesisPreparationPhase {
  ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED = 1,
  ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED = 2,
  ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING = 3,
  ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED = 4,
  ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED = 5,
  ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED = 6,
} AncPrivateVaultGenesisPreparationPhase;

typedef enum AncPrivateVaultGenesisPreparationRecordStatus {
  ANC_PV_GENESIS_PREPARATION_OK = 0,
  ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT,
  ANC_PV_GENESIS_PREPARATION_WIRE_LENGTH,
  ANC_PV_GENESIS_PREPARATION_WIRE_MAGIC,
  ANC_PV_GENESIS_PREPARATION_WIRE_VERSION,
  ANC_PV_GENESIS_PREPARATION_WIRE_PHASE,
  ANC_PV_GENESIS_PREPARATION_WIRE_FLAGS,
  ANC_PV_GENESIS_PREPARATION_WIRE_RESERVED,
  ANC_PV_GENESIS_PREPARATION_RANGE_GENERATION,
  ANC_PV_GENESIS_PREPARATION_RANGE_TIMESTAMP,
  ANC_PV_GENESIS_PREPARATION_BINDING_IDENTITY,
  ANC_PV_GENESIS_PREPARATION_BINDING_HANDLE,
  ANC_PV_GENESIS_PREPARATION_BINDING_ARTIFACTS,
  ANC_PV_GENESIS_PREPARATION_BINDING_CUSTODY,
  ANC_PV_GENESIS_PREPARATION_BINDING_OFFICIAL,
  ANC_PV_GENESIS_PREPARATION_BINDING_SECRET,
  ANC_PV_GENESIS_PREPARATION_BINDING_TERMINAL,
  ANC_PV_GENESIS_PREPARATION_CRYPTO_CHECKSUM,
  ANC_PV_GENESIS_PREPARATION_TRANSITION,
  ANC_PV_GENESIS_PREPARATION_SUBSTITUTION,
} AncPrivateVaultGenesisPreparationRecordStatus;

typedef struct AncPrivateVaultGenesisPreparationSnapshot {
  AncPrivateVaultGenesisPreparationPhase phase;
  uint8_t flags;
  uint64_t generation;
  uint64_t prepared_at_ms;
  uint64_t expires_at_ms;
  uint64_t confirmed_at_ms;
  uint64_t recovery_wrap_created_at_seconds;
  uint64_t endpoint_created_at_seconds;
  uint64_t log_entry_created_at_seconds;
  uint64_t authorization_created_at_seconds;
  uint64_t terminal_at_ms;
  uint8_t preparation_lookup_id[16];
  uint8_t handle_digest[32];
  uint8_t vault_id[16];
  uint8_t ceremony_id[16];
  uint8_t endpoint_id[16];
  uint8_t recovery_wrap_envelope_id[16];
  uint8_t endpoint_envelope_id[16];
  uint8_t log_entry_envelope_id[16];
  uint8_t authorization_envelope_id[16];
  uint8_t recovery_wrap_nonce[24];
  uint8_t endpoint_signing_public_key[32];
  uint8_t endpoint_agreement_public_key[32];
  uint8_t recovery_id[16];
  uint8_t recovery_signing_public_key[32];
  uint8_t recovery_agreement_public_key[32];
  uint8_t recovery_wrap_hash[32];
  uint8_t recovery_confirmation_hash[32];
  uint8_t bootstrap_transcript_digest[32];
  uint8_t authorization_digest[32];
  uint8_t genesis_control_head_hash[32];
  uint8_t membership_hash[32];
  uint8_t artifact_spool_digest[32];
  uint64_t recovery_wrap_length;
  uint64_t confirmation_length;
  uint64_t bootstrap_length;
  uint64_t authorization_length;
  uint8_t custody_record_digest[32];
  uint8_t official_authority_g2_frame_digest[32];
  uint8_t hosted_recovery_receipt_digest[32];
} AncPrivateVaultGenesisPreparationSnapshot;

typedef struct AncPrivateVaultGenesisPreparationSecretInputs {
  const uint8_t *recovery_entropy;
  const uint8_t *endpoint_signing_seed;
  const uint8_t *endpoint_agreement_seed;
  const uint8_t *local_state_key;
  const uint8_t *epoch_one_eek;
} AncPrivateVaultGenesisPreparationSecretInputs;

typedef struct AncPrivateVaultGenesisPreparationSecretOutputs {
  uint8_t *recovery_entropy;
  uint8_t *endpoint_signing_seed;
  uint8_t *endpoint_agreement_seed;
  uint8_t *local_state_key;
  uint8_t *epoch_one_eek;
} AncPrivateVaultGenesisPreparationSecretOutputs;

// Codec buffers must be pairwise disjoint. Encode rejects aliases without
// touching the output record. Decode rejects aliases without touching any
// potentially overlapping region; other decode failures clear all outputs.

AncPrivateVaultGenesisPreparationRecordStatus
anc_pv_genesis_preparation_record_encode(
    const AncPrivateVaultGenesisPreparationSnapshot *snapshot,
    const AncPrivateVaultGenesisPreparationSecretInputs *secrets,
    uint8_t *record, size_t record_length);

AncPrivateVaultGenesisPreparationRecordStatus
anc_pv_genesis_preparation_record_decode(
    const uint8_t *record, size_t record_length,
    AncPrivateVaultGenesisPreparationSnapshot *snapshot,
    const AncPrivateVaultGenesisPreparationSecretOutputs *secrets);

AncPrivateVaultGenesisPreparationRecordStatus
anc_pv_genesis_preparation_record_decode_public(
    const uint8_t *record, size_t record_length,
    AncPrivateVaultGenesisPreparationSnapshot *snapshot);

AncPrivateVaultGenesisPreparationRecordStatus
anc_pv_genesis_preparation_transition_validate(
    const uint8_t *from_record, size_t from_length, const uint8_t *to_record,
    size_t to_length);

bool anc_pv_genesis_preparation_phase_transition_allowed(
    AncPrivateVaultGenesisPreparationPhase from,
    AncPrivateVaultGenesisPreparationPhase to);

void anc_pv_genesis_preparation_snapshot_zero(
    AncPrivateVaultGenesisPreparationSnapshot *snapshot);
const char *anc_pv_genesis_preparation_status_category(
    AncPrivateVaultGenesisPreparationRecordStatus status);
AncPrivateVaultGenesisPreparationRecordStatus
anc_pv_genesis_preparation_handle_digest(
    const uint8_t handle[ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES],
    size_t handle_length,
    uint8_t digest[ANC_PV_HASH_BYTES]);
// The digest output must not overlap the 48-byte handle and remains untouched
// when that alias contract is violated.
bool anc_pv_genesis_preparation_handle_verify(
    const uint8_t handle[ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES],
    size_t handle_length,
    const uint8_t expected_lookup_id[ANC_PV_GENESIS_PREPARATION_LOOKUP_ID_BYTES],
    const uint8_t expected_digest[ANC_PV_HASH_BYTES]);

#endif
