#import "PrivateVaultRotationPreparationRecord.h"

#include <limits.h>
#include <string.h>

enum {
  ANC_PV_ROT_OFF_MAGIC = 0,
  ANC_PV_ROT_OFF_VERSION = 4,
  ANC_PV_ROT_OFF_LENGTH = 6,
  ANC_PV_ROT_OFF_PHASE = 8,
  ANC_PV_ROT_OFF_FLAGS = 9,
  ANC_PV_ROT_OFF_ROLE = 10,
  ANC_PV_ROT_OFF_UNATTENDED = 11,
  ANC_PV_ROT_OFF_PREPARATION_GENERATION = 16,
  ANC_PV_ROT_OFF_VAULT_ID = 24,
  ANC_PV_ROT_OFF_ENDPOINT_ID = 40,
  ANC_PV_ROT_OFF_CEREMONY_ID = 56,
  ANC_PV_ROT_OFF_BASE_CUSTODY_GENERATION = 72,
  ANC_PV_ROT_OFF_BASE_FRAME_DIGEST = 80,
  ANC_PV_ROT_OFF_BASE_SEQUENCE = 112,
  ANC_PV_ROT_OFF_BASE_HEAD = 120,
  ANC_PV_ROT_OFF_BASE_MEMBERSHIP = 152,
  ANC_PV_ROT_OFF_BASE_EPOCH = 184,
  ANC_PV_ROT_OFF_BASE_RECOVERY_GENERATION = 192,
  ANC_PV_ROT_OFF_SIGNING_PUBLIC_KEY = 200,
  ANC_PV_ROT_OFF_AGREEMENT_PUBLIC_KEY = 232,
  ANC_PV_ROT_OFF_ENROLLMENT_REF = 264,
  ANC_PV_ROT_OFF_PENDING_EPOCH = 280,
  ANC_PV_ROT_OFF_PENDING_KEY = 288,
  ANC_PV_ROT_OFF_EXPECTED_SEQUENCE = 320,
  ANC_PV_ROT_OFF_EXPECTED_PREVIOUS_HEAD = 328,
  ANC_PV_ROT_OFF_TRANSCRIPT_DIGEST = 360,
  ANC_PV_ROT_OFF_SIGNED_ENTRY_LENGTH = 392,
  ANC_PV_ROT_OFF_RECOVERY_WRAP_LENGTH = 400,
  ANC_PV_ROT_OFF_ENCRYPTED_SPOOL_DIGEST = 408,
  ANC_PV_ROT_OFF_TAIL_PADDING = 440,
  ANC_PV_ROT_OFF_CHECKSUM = 480,
};

static const uint8_t kAncPrivateVaultRotationPreparationMagic[4] = {'A', 'N',
                                                                    'V', 'R'};
/* The terminating NUL is a frozen byte in the anc/v1 checksum preimage. */
static const uint8_t kAncPrivateVaultRotationPreparationChecksumDomain[] =
    "agent-native/private-vault/rotation-preparation/checksum/anc-v1";
static const uint64_t kAncPrivateVaultMaxSafeInteger = 9007199254740991ULL;
static const uint64_t kAncPrivateVaultSignedEntryMaxBytes = 65536;
static const uint64_t kAncPrivateVaultRecoveryWrapMaxBytes = 1048576;

_Static_assert(ANC_PV_ROT_OFF_CHECKSUM + ANC_PV_HASH_BYTES ==
                   ANC_PV_ROTATION_PREPARATION_RECORD_BYTES,
               "rotation preparation record must remain exactly 512 bytes");

typedef struct AncPrivateVaultMemoryRange {
  const void *pointer;
  size_t length;
} AncPrivateVaultMemoryRange;

static bool anc_pv_rotation_ranges_overlap(AncPrivateVaultMemoryRange left,
                                           AncPrivateVaultMemoryRange right) {
  if (left.pointer == NULL || right.pointer == NULL || left.length == 0 ||
      right.length == 0)
    return false;
  uintptr_t left_start = (uintptr_t)left.pointer;
  uintptr_t right_start = (uintptr_t)right.pointer;
  if (left_start > UINTPTR_MAX - left.length ||
      right_start > UINTPTR_MAX - right.length)
    return true;
  return left_start < right_start + right.length &&
         right_start < left_start + left.length;
}

static bool
anc_pv_rotation_any_overlap(const AncPrivateVaultMemoryRange *ranges,
                            size_t count) {
  for (size_t left = 0; left < count; left += 1) {
    for (size_t right = left + 1; right < count; right += 1) {
      if (anc_pv_rotation_ranges_overlap(ranges[left], ranges[right]))
        return true;
    }
  }
  return false;
}

static uint16_t anc_pv_rotation_read_u16(const uint8_t *input) {
  return (uint16_t)((uint16_t)input[0] | ((uint16_t)input[1] << 8));
}

static void anc_pv_rotation_write_u16(uint8_t *output, uint16_t value) {
  output[0] = (uint8_t)value;
  output[1] = (uint8_t)(value >> 8);
}

static uint64_t anc_pv_rotation_read_u64(const uint8_t *input) {
  uint64_t value = 0;
  for (size_t index = 0; index < 8; index += 1)
    value |= (uint64_t)input[index] << (index * 8);
  return value;
}

static void anc_pv_rotation_write_u64(uint8_t *output, uint64_t value) {
  for (size_t index = 0; index < 8; index += 1)
    output[index] = (uint8_t)(value >> (index * 8));
}

static bool anc_pv_rotation_is_zero(const uint8_t *value, size_t length) {
  uint8_t aggregate = 0;
  for (size_t index = 0; index < length; index += 1)
    aggregate |= value[index];
  return aggregate == 0;
}

static bool anc_pv_rotation_equal(const uint8_t *left, const uint8_t *right,
                                  size_t length) {
  return anc_pv_memcmp(left, right, length) == ANC_PV_CRYPTO_OK;
}

static bool anc_pv_rotation_checksum(uint8_t output[ANC_PV_HASH_BYTES],
                                     const uint8_t *record) {
  uint8_t preimage[sizeof(kAncPrivateVaultRotationPreparationChecksumDomain) +
                   ANC_PV_ROT_OFF_CHECKSUM];
  memcpy(preimage, kAncPrivateVaultRotationPreparationChecksumDomain,
         sizeof(kAncPrivateVaultRotationPreparationChecksumDomain));
  memcpy(preimage + sizeof(kAncPrivateVaultRotationPreparationChecksumDomain),
         record, ANC_PV_ROT_OFF_CHECKSUM);
  bool ok = anc_pv_blake2b_256(output, preimage, sizeof(preimage)) ==
            ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(preimage, sizeof(preimage));
  return ok;
}

static AncPrivateVaultRotationPreparationStatus
anc_pv_rotation_validate_record(const uint8_t *record, size_t record_length) {
  if (record == NULL)
    return ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT;
  if (record_length < ANC_PV_ROTATION_PREPARATION_RECORD_BYTES)
    return ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_TRUNCATION;
  if (record_length > ANC_PV_ROTATION_PREPARATION_RECORD_BYTES)
    return ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_EXTRA_BYTES;
  if (memcmp(record + ANC_PV_ROT_OFF_MAGIC,
             kAncPrivateVaultRotationPreparationMagic,
             sizeof(kAncPrivateVaultRotationPreparationMagic)) != 0)
    return ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_MAGIC;
  if (anc_pv_rotation_read_u16(record + ANC_PV_ROT_OFF_VERSION) !=
      ANC_PV_ROTATION_PREPARATION_VERSION)
    return ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_VERSION;
  if (anc_pv_rotation_read_u16(record + ANC_PV_ROT_OFF_LENGTH) !=
      ANC_PV_ROTATION_PREPARATION_RECORD_BYTES)
    return ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_LENGTH;

  uint8_t phase = record[ANC_PV_ROT_OFF_PHASE];
  uint8_t flags = record[ANC_PV_ROT_OFF_FLAGS];
  uint8_t role = record[ANC_PV_ROT_OFF_ROLE];
  if (phase < ANC_PV_ROTATION_PREPARATION_PHASE_PREPARED ||
      phase > ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED)
    return ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_PHASE;
  uint8_t expected_flags =
      phase == ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT ||
              phase == ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED
          ? ANC_PV_ROTATION_PREPARATION_FLAG_EDGE_BOUND |
                ANC_PV_ROTATION_PREPARATION_FLAG_SPOOL_DURABLE
          : 0;
  if ((flags & ~(ANC_PV_ROTATION_PREPARATION_FLAG_EDGE_BOUND |
                 ANC_PV_ROTATION_PREPARATION_FLAG_SPOOL_DURABLE)) != 0 ||
      flags != expected_flags)
    return ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_FLAGS;
  if (role != ANC_PV_ROTATION_PREPARATION_ROLE_ENDPOINT &&
      role != ANC_PV_ROTATION_PREPARATION_ROLE_BROKER)
    return ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_ROLE;
  if (record[ANC_PV_ROT_OFF_UNATTENDED] !=
      (role == ANC_PV_ROTATION_PREPARATION_ROLE_BROKER ? 1 : 0))
    return ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_UNATTENDED_ROLE;
  if (!anc_pv_rotation_is_zero(record + 12, 4) ||
      !anc_pv_rotation_is_zero(record + ANC_PV_ROT_OFF_TAIL_PADDING,
                               ANC_PV_ROT_OFF_CHECKSUM -
                                   ANC_PV_ROT_OFF_TAIL_PADDING))
    return ANC_PV_ROTATION_PREPARATION_RECORD_WIRE_ZERO_PADDING;

  uint64_t preparation_generation =
      anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_PREPARATION_GENERATION);
  uint64_t base_custody_generation =
      anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_BASE_CUSTODY_GENERATION);
  uint64_t recovery_generation = anc_pv_rotation_read_u64(
      record + ANC_PV_ROT_OFF_BASE_RECOVERY_GENERATION);
  if (preparation_generation == 0 || base_custody_generation == 0 ||
      recovery_generation == 0)
    return ANC_PV_ROTATION_PREPARATION_RECORD_RANGE_GENERATION;
  uint64_t base_sequence =
      anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_BASE_SEQUENCE);
  if (base_sequence > kAncPrivateVaultMaxSafeInteger)
    return ANC_PV_ROTATION_PREPARATION_RECORD_RANGE_SEQUENCE;
  uint64_t base_epoch =
      anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_BASE_EPOCH);
  if (base_epoch == 0)
    return ANC_PV_ROTATION_PREPARATION_RECORD_RANGE_EPOCH;
  uint64_t pending_epoch =
      anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_PENDING_EPOCH);
  if (phase < ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED &&
      (base_epoch == UINT64_MAX || pending_epoch != base_epoch + 1))
    return ANC_PV_ROTATION_PREPARATION_RECORD_BINDING_PENDING_EPOCH;

  bool pending_key_is_zero =
      anc_pv_rotation_is_zero(record + ANC_PV_ROT_OFF_PENDING_KEY,
                              ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES);
  if (phase < ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED && pending_key_is_zero)
    return ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_PENDING_KEY;
  if (phase >= ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED &&
      !pending_key_is_zero)
    return phase == ANC_PV_ROTATION_PREPARATION_PHASE_CONSUMED
               ? ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_PENDING_KEY
               : ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_CLEANED;

  if (phase < ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT) {
    if (!anc_pv_rotation_is_zero(record + ANC_PV_ROT_OFF_EXPECTED_SEQUENCE,
                                 ANC_PV_ROT_OFF_SIGNED_ENTRY_LENGTH -
                                     ANC_PV_ROT_OFF_EXPECTED_SEQUENCE))
      return ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_EDGE_FIELDS;
    if (!anc_pv_rotation_is_zero(record + ANC_PV_ROT_OFF_SIGNED_ENTRY_LENGTH,
                                 ANC_PV_ROT_OFF_TAIL_PADDING -
                                     ANC_PV_ROT_OFF_SIGNED_ENTRY_LENGTH))
      return ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_ARTIFACT_FIELDS;
  } else if (phase < ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED) {
    uint64_t expected_sequence =
        anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_EXPECTED_SEQUENCE);
    if (base_sequence == kAncPrivateVaultMaxSafeInteger ||
        expected_sequence != base_sequence + 1)
      return ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_EXPECTED_SEQUENCE;
    if (!anc_pv_rotation_equal(record + ANC_PV_ROT_OFF_EXPECTED_PREVIOUS_HEAD,
                               record + ANC_PV_ROT_OFF_BASE_HEAD,
                               ANC_PV_HASH_BYTES))
      return ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_PREVIOUS_HEAD;
    if (anc_pv_rotation_is_zero(record + ANC_PV_ROT_OFF_TRANSCRIPT_DIGEST,
                                ANC_PV_HASH_BYTES))
      return ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_TRANSCRIPT;
    uint64_t signed_length =
        anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_SIGNED_ENTRY_LENGTH);
    uint64_t wrap_length =
        anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_RECOVERY_WRAP_LENGTH);
    if (signed_length == 0 ||
        signed_length > kAncPrivateVaultSignedEntryMaxBytes ||
        wrap_length == 0 || wrap_length > kAncPrivateVaultRecoveryWrapMaxBytes)
      return ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_ARTIFACT_LENGTH;
    if (anc_pv_rotation_is_zero(record + ANC_PV_ROT_OFF_ENCRYPTED_SPOOL_DIGEST,
                                ANC_PV_HASH_BYTES))
      return ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_SPOOL_DIGEST;
  } else if (!anc_pv_rotation_is_zero(record + ANC_PV_ROT_OFF_PENDING_EPOCH,
                                      ANC_PV_ROT_OFF_TAIL_PADDING -
                                          ANC_PV_ROT_OFF_PENDING_EPOCH)) {
    return ANC_PV_ROTATION_PREPARATION_RECORD_PHASE_CLEANED;
  }

  uint8_t expected_checksum[ANC_PV_HASH_BYTES] = {0};
  bool checksum_ok =
      anc_pv_rotation_checksum(expected_checksum, record) &&
      anc_pv_rotation_equal(expected_checksum, record + ANC_PV_ROT_OFF_CHECKSUM,
                            ANC_PV_HASH_BYTES);
  anc_pv_zeroize(expected_checksum, sizeof(expected_checksum));
  return checksum_ok ? ANC_PV_ROTATION_PREPARATION_OK
                     : ANC_PV_ROTATION_PREPARATION_RECORD_CRYPTO_CHECKSUM;
}

static void anc_pv_rotation_decode_snapshot(
    const uint8_t *record,
    AncPrivateVaultRotationPreparationSnapshot *snapshot) {
  memset(snapshot, 0, sizeof(*snapshot));
  snapshot->phase =
      (AncPrivateVaultRotationPreparationPhase)record[ANC_PV_ROT_OFF_PHASE];
  snapshot->flags = record[ANC_PV_ROT_OFF_FLAGS];
  snapshot->role =
      (AncPrivateVaultRotationPreparationRole)record[ANC_PV_ROT_OFF_ROLE];
  snapshot->unattended = record[ANC_PV_ROT_OFF_UNATTENDED];
  snapshot->preparation_generation =
      anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_PREPARATION_GENERATION);
  memcpy(snapshot->vault_id, record + ANC_PV_ROT_OFF_VAULT_ID,
         sizeof(snapshot->vault_id));
  memcpy(snapshot->endpoint_id, record + ANC_PV_ROT_OFF_ENDPOINT_ID,
         sizeof(snapshot->endpoint_id));
  memcpy(snapshot->ceremony_id, record + ANC_PV_ROT_OFF_CEREMONY_ID,
         sizeof(snapshot->ceremony_id));
  snapshot->base_custody_generation =
      anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_BASE_CUSTODY_GENERATION);
  memcpy(snapshot->base_frame_digest, record + ANC_PV_ROT_OFF_BASE_FRAME_DIGEST,
         sizeof(snapshot->base_frame_digest));
  snapshot->base_sequence =
      anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_BASE_SEQUENCE);
  memcpy(snapshot->base_head, record + ANC_PV_ROT_OFF_BASE_HEAD,
         sizeof(snapshot->base_head));
  memcpy(snapshot->base_membership, record + ANC_PV_ROT_OFF_BASE_MEMBERSHIP,
         sizeof(snapshot->base_membership));
  snapshot->base_epoch =
      anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_BASE_EPOCH);
  snapshot->base_recovery_generation = anc_pv_rotation_read_u64(
      record + ANC_PV_ROT_OFF_BASE_RECOVERY_GENERATION);
  memcpy(snapshot->signing_public_key,
         record + ANC_PV_ROT_OFF_SIGNING_PUBLIC_KEY,
         sizeof(snapshot->signing_public_key));
  memcpy(snapshot->agreement_public_key,
         record + ANC_PV_ROT_OFF_AGREEMENT_PUBLIC_KEY,
         sizeof(snapshot->agreement_public_key));
  memcpy(snapshot->enrollment_ref, record + ANC_PV_ROT_OFF_ENROLLMENT_REF,
         sizeof(snapshot->enrollment_ref));
  snapshot->pending_epoch =
      anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_PENDING_EPOCH);
  snapshot->expected_sequence =
      anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_EXPECTED_SEQUENCE);
  memcpy(snapshot->expected_previous_head,
         record + ANC_PV_ROT_OFF_EXPECTED_PREVIOUS_HEAD,
         sizeof(snapshot->expected_previous_head));
  memcpy(snapshot->transcript_digest, record + ANC_PV_ROT_OFF_TRANSCRIPT_DIGEST,
         sizeof(snapshot->transcript_digest));
  snapshot->signed_entry_length =
      anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_SIGNED_ENTRY_LENGTH);
  snapshot->recovery_wrap_length =
      anc_pv_rotation_read_u64(record + ANC_PV_ROT_OFF_RECOVERY_WRAP_LENGTH);
  memcpy(snapshot->encrypted_spool_digest,
         record + ANC_PV_ROT_OFF_ENCRYPTED_SPOOL_DIGEST,
         sizeof(snapshot->encrypted_spool_digest));
}

static void anc_pv_rotation_encode_snapshot(
    uint8_t *record, const AncPrivateVaultRotationPreparationSnapshot *snapshot,
    const uint8_t *pending_epoch_key) {
  memset(record, 0, ANC_PV_ROTATION_PREPARATION_RECORD_BYTES);
  memcpy(record + ANC_PV_ROT_OFF_MAGIC,
         kAncPrivateVaultRotationPreparationMagic,
         sizeof(kAncPrivateVaultRotationPreparationMagic));
  anc_pv_rotation_write_u16(record + ANC_PV_ROT_OFF_VERSION,
                            ANC_PV_ROTATION_PREPARATION_VERSION);
  anc_pv_rotation_write_u16(record + ANC_PV_ROT_OFF_LENGTH,
                            ANC_PV_ROTATION_PREPARATION_RECORD_BYTES);
  record[ANC_PV_ROT_OFF_PHASE] = (uint8_t)snapshot->phase;
  record[ANC_PV_ROT_OFF_FLAGS] = snapshot->flags;
  record[ANC_PV_ROT_OFF_ROLE] = (uint8_t)snapshot->role;
  record[ANC_PV_ROT_OFF_UNATTENDED] = snapshot->unattended;
  anc_pv_rotation_write_u64(record + ANC_PV_ROT_OFF_PREPARATION_GENERATION,
                            snapshot->preparation_generation);
  memcpy(record + ANC_PV_ROT_OFF_VAULT_ID, snapshot->vault_id,
         sizeof(snapshot->vault_id));
  memcpy(record + ANC_PV_ROT_OFF_ENDPOINT_ID, snapshot->endpoint_id,
         sizeof(snapshot->endpoint_id));
  memcpy(record + ANC_PV_ROT_OFF_CEREMONY_ID, snapshot->ceremony_id,
         sizeof(snapshot->ceremony_id));
  anc_pv_rotation_write_u64(record + ANC_PV_ROT_OFF_BASE_CUSTODY_GENERATION,
                            snapshot->base_custody_generation);
  memcpy(record + ANC_PV_ROT_OFF_BASE_FRAME_DIGEST, snapshot->base_frame_digest,
         sizeof(snapshot->base_frame_digest));
  anc_pv_rotation_write_u64(record + ANC_PV_ROT_OFF_BASE_SEQUENCE,
                            snapshot->base_sequence);
  memcpy(record + ANC_PV_ROT_OFF_BASE_HEAD, snapshot->base_head,
         sizeof(snapshot->base_head));
  memcpy(record + ANC_PV_ROT_OFF_BASE_MEMBERSHIP, snapshot->base_membership,
         sizeof(snapshot->base_membership));
  anc_pv_rotation_write_u64(record + ANC_PV_ROT_OFF_BASE_EPOCH,
                            snapshot->base_epoch);
  anc_pv_rotation_write_u64(record + ANC_PV_ROT_OFF_BASE_RECOVERY_GENERATION,
                            snapshot->base_recovery_generation);
  memcpy(record + ANC_PV_ROT_OFF_SIGNING_PUBLIC_KEY,
         snapshot->signing_public_key, sizeof(snapshot->signing_public_key));
  memcpy(record + ANC_PV_ROT_OFF_AGREEMENT_PUBLIC_KEY,
         snapshot->agreement_public_key,
         sizeof(snapshot->agreement_public_key));
  memcpy(record + ANC_PV_ROT_OFF_ENROLLMENT_REF, snapshot->enrollment_ref,
         sizeof(snapshot->enrollment_ref));
  anc_pv_rotation_write_u64(record + ANC_PV_ROT_OFF_PENDING_EPOCH,
                            snapshot->pending_epoch);
  memcpy(record + ANC_PV_ROT_OFF_PENDING_KEY, pending_epoch_key,
         ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES);
  anc_pv_rotation_write_u64(record + ANC_PV_ROT_OFF_EXPECTED_SEQUENCE,
                            snapshot->expected_sequence);
  memcpy(record + ANC_PV_ROT_OFF_EXPECTED_PREVIOUS_HEAD,
         snapshot->expected_previous_head,
         sizeof(snapshot->expected_previous_head));
  memcpy(record + ANC_PV_ROT_OFF_TRANSCRIPT_DIGEST, snapshot->transcript_digest,
         sizeof(snapshot->transcript_digest));
  anc_pv_rotation_write_u64(record + ANC_PV_ROT_OFF_SIGNED_ENTRY_LENGTH,
                            snapshot->signed_entry_length);
  anc_pv_rotation_write_u64(record + ANC_PV_ROT_OFF_RECOVERY_WRAP_LENGTH,
                            snapshot->recovery_wrap_length);
  memcpy(record + ANC_PV_ROT_OFF_ENCRYPTED_SPOOL_DIGEST,
         snapshot->encrypted_spool_digest,
         sizeof(snapshot->encrypted_spool_digest));
}

AncPrivateVaultRotationPreparationStatus
anc_pv_rotation_preparation_record_encode(
    const AncPrivateVaultRotationPreparationSnapshot *snapshot,
    const uint8_t
        pending_epoch_key[ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES],
    uint8_t record[ANC_PV_ROTATION_PREPARATION_RECORD_BYTES],
    size_t record_length) {
  if (snapshot == NULL || pending_epoch_key == NULL || record == NULL ||
      record_length != ANC_PV_ROTATION_PREPARATION_RECORD_BYTES)
    return ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT;
  const AncPrivateVaultMemoryRange ranges[] = {
      {snapshot, sizeof(*snapshot)},
      {pending_epoch_key, ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES},
      {record, record_length},
  };
  if (anc_pv_rotation_any_overlap(ranges, sizeof(ranges) / sizeof(ranges[0])))
    return ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT;

  uint8_t encoded[ANC_PV_ROTATION_PREPARATION_RECORD_BYTES] = {0};
  uint8_t checksum[ANC_PV_HASH_BYTES] = {0};
  anc_pv_rotation_encode_snapshot(encoded, snapshot, pending_epoch_key);
  AncPrivateVaultRotationPreparationStatus status;
  if (!anc_pv_rotation_checksum(checksum, encoded)) {
    status = ANC_PV_ROTATION_PREPARATION_RECORD_CRYPTO_CHECKSUM;
  } else {
    memcpy(encoded + ANC_PV_ROT_OFF_CHECKSUM, checksum, sizeof(checksum));
    status = anc_pv_rotation_validate_record(encoded, sizeof(encoded));
    if (status == ANC_PV_ROTATION_PREPARATION_OK)
      memcpy(record, encoded, sizeof(encoded));
  }
  anc_pv_zeroize(checksum, sizeof(checksum));
  anc_pv_zeroize(encoded, sizeof(encoded));
  return status;
}

AncPrivateVaultRotationPreparationStatus
anc_pv_rotation_preparation_record_decode(
    const uint8_t *record, size_t record_length,
    AncPrivateVaultRotationPreparationSnapshot *snapshot,
    uint8_t pending_epoch_key[ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES]) {
  if (record == NULL || snapshot == NULL || pending_epoch_key == NULL)
    return ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT;
  const AncPrivateVaultMemoryRange ranges[] = {
      {record, record_length},
      {snapshot, sizeof(*snapshot)},
      {pending_epoch_key, ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES},
  };
  if (anc_pv_rotation_any_overlap(ranges, sizeof(ranges) / sizeof(ranges[0])))
    return ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT;

  AncPrivateVaultRotationPreparationSnapshot decoded = {0};
  uint8_t decoded_key[ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES] = {0};
  AncPrivateVaultRotationPreparationStatus status =
      anc_pv_rotation_validate_record(record, record_length);
  if (status == ANC_PV_ROTATION_PREPARATION_OK) {
    anc_pv_rotation_decode_snapshot(record, &decoded);
    memcpy(decoded_key, record + ANC_PV_ROT_OFF_PENDING_KEY,
           sizeof(decoded_key));
    memcpy(snapshot, &decoded, sizeof(decoded));
    memcpy(pending_epoch_key, decoded_key, sizeof(decoded_key));
  } else {
    anc_pv_rotation_preparation_snapshot_zero(snapshot);
    anc_pv_zeroize(pending_epoch_key,
                   ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES);
  }
  anc_pv_zeroize(&decoded, sizeof(decoded));
  anc_pv_zeroize(decoded_key, sizeof(decoded_key));
  return status;
}

bool anc_pv_rotation_preparation_phase_transition_allowed(
    AncPrivateVaultRotationPreparationPhase from,
    AncPrivateVaultRotationPreparationPhase to) {
  return (from >= ANC_PV_ROTATION_PREPARATION_PHASE_PREPARED &&
          from < ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED && to == from + 1) ||
         (from == ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED &&
          to == ANC_PV_ROTATION_PREPARATION_PHASE_PREPARED);
}

AncPrivateVaultRotationPreparationStatus
anc_pv_rotation_preparation_transition_validate(const uint8_t *from_record,
                                                size_t from_length,
                                                const uint8_t *to_record,
                                                size_t to_length) {
  if (from_record == NULL || to_record == NULL ||
      anc_pv_rotation_ranges_overlap(
          (AncPrivateVaultMemoryRange){from_record, from_length},
          (AncPrivateVaultMemoryRange){to_record, to_length}))
    return ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT;
  AncPrivateVaultRotationPreparationStatus status =
      anc_pv_rotation_validate_record(from_record, from_length);
  if (status != ANC_PV_ROTATION_PREPARATION_OK)
    return status;
  status = anc_pv_rotation_validate_record(to_record, to_length);
  if (status != ANC_PV_ROTATION_PREPARATION_OK)
    return status;

  AncPrivateVaultRotationPreparationPhase from =
      (AncPrivateVaultRotationPreparationPhase)
          from_record[ANC_PV_ROT_OFF_PHASE];
  AncPrivateVaultRotationPreparationPhase to =
      (AncPrivateVaultRotationPreparationPhase)to_record[ANC_PV_ROT_OFF_PHASE];
  if (!anc_pv_rotation_preparation_phase_transition_allowed(from, to))
    return ANC_PV_ROTATION_PREPARATION_RECORD_BINDING_SUBSTITUTION;
  uint64_t from_generation = anc_pv_rotation_read_u64(
      from_record + ANC_PV_ROT_OFF_PREPARATION_GENERATION);
  uint64_t to_generation = anc_pv_rotation_read_u64(
      to_record + ANC_PV_ROT_OFF_PREPARATION_GENERATION);

  if (from == ANC_PV_ROTATION_PREPARATION_PHASE_CLEANED) {
    if (from_generation == UINT64_MAX || to_generation != from_generation + 1)
      return ANC_PV_ROTATION_PREPARATION_RECORD_TRANSITION_GENERATION;
    return ANC_PV_ROTATION_PREPARATION_OK;
  }
  if (from_generation != to_generation)
    return ANC_PV_ROTATION_PREPARATION_RECORD_TRANSITION_GENERATION;

  if (from <= ANC_PV_ROTATION_PREPARATION_PHASE_ACKNOWLEDGED) {
    if (!anc_pv_rotation_equal(from_record + ANC_PV_ROT_OFF_VAULT_ID,
                               to_record + ANC_PV_ROT_OFF_VAULT_ID,
                               ANC_PV_ROT_OFF_PENDING_KEY -
                                   ANC_PV_ROT_OFF_VAULT_ID) ||
        !anc_pv_rotation_equal(from_record + ANC_PV_ROT_OFF_PENDING_KEY,
                               to_record + ANC_PV_ROT_OFF_PENDING_KEY,
                               ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES))
      return ANC_PV_ROTATION_PREPARATION_RECORD_BINDING_SUBSTITUTION;
  } else if (from ==
             ANC_PV_ROTATION_PREPARATION_PHASE_AWAITING_CONTROL_COMMIT) {
    if (!anc_pv_rotation_equal(from_record + ANC_PV_ROT_OFF_VAULT_ID,
                               to_record + ANC_PV_ROT_OFF_VAULT_ID,
                               ANC_PV_ROT_OFF_PENDING_KEY -
                                   ANC_PV_ROT_OFF_VAULT_ID) ||
        !anc_pv_rotation_is_zero(
            to_record + ANC_PV_ROT_OFF_PENDING_KEY,
            ANC_PV_ROTATION_PREPARATION_PENDING_KEY_BYTES) ||
        !anc_pv_rotation_equal(from_record + ANC_PV_ROT_OFF_EXPECTED_SEQUENCE,
                               to_record + ANC_PV_ROT_OFF_EXPECTED_SEQUENCE,
                               ANC_PV_ROT_OFF_TAIL_PADDING -
                                   ANC_PV_ROT_OFF_EXPECTED_SEQUENCE))
      return ANC_PV_ROTATION_PREPARATION_RECORD_BINDING_SUBSTITUTION;
  } else {
    if (!anc_pv_rotation_equal(from_record + ANC_PV_ROT_OFF_VAULT_ID,
                               to_record + ANC_PV_ROT_OFF_VAULT_ID,
                               ANC_PV_ROT_OFF_PENDING_EPOCH -
                                   ANC_PV_ROT_OFF_VAULT_ID))
      return ANC_PV_ROTATION_PREPARATION_RECORD_BINDING_SUBSTITUTION;
  }
  return ANC_PV_ROTATION_PREPARATION_OK;
}

const char *anc_pv_rotation_preparation_status_category(
    AncPrivateVaultRotationPreparationStatus status) {
  static const char *const categories[] = {
      NULL,
      "invalid_argument",
      "record.wire.magic",
      "record.wire.version",
      "record.wire.length",
      "record.wire.phase",
      "record.wire.flags",
      "record.wire.role",
      "record.wire.unattended_role",
      "record.wire.zero_padding",
      "record.range.generation",
      "record.range.sequence",
      "record.range.epoch",
      "record.binding.pending_epoch",
      "record.phase.edge_fields",
      "record.phase.artifact_fields",
      "record.phase.expected_sequence",
      "record.phase.previous_head",
      "record.phase.transcript",
      "record.phase.artifact_length",
      "record.phase.spool_digest",
      "record.phase.pending_key",
      "record.phase.cleaned",
      "record.transition.generation",
      "record.crypto.checksum",
      "record.wire.truncation",
      "record.wire.extra_bytes",
      "record.binding.substitution",
  };
  if (status < ANC_PV_ROTATION_PREPARATION_OK ||
      (size_t)status >= sizeof(categories) / sizeof(categories[0]))
    return "invalid_argument";
  return categories[status];
}

void anc_pv_rotation_preparation_snapshot_zero(
    AncPrivateVaultRotationPreparationSnapshot *snapshot) {
  if (snapshot != NULL)
    anc_pv_zeroize(snapshot, sizeof(*snapshot));
}
