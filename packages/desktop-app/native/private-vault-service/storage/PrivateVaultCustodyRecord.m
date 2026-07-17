#import "PrivateVaultCustodyRecord.h"

#import <Foundation/Foundation.h>

#include <limits.h>
#include <string.h>

enum {
  ANC_PV_OFF_MAGIC = 0,
  ANC_PV_OFF_VERSION = 4,
  ANC_PV_OFF_LENGTH = 6,
  ANC_PV_OFF_LIFECYCLE = 8,
  ANC_PV_OFF_ROLE = 9,
  ANC_PV_OFF_PENDING_KIND = 10,
  ANC_PV_OFF_ROTATION_PHASE = 11,
  ANC_PV_OFF_ENROLLMENT_PHASE = 12,
  ANC_PV_OFF_FLAGS = 13,
  ANC_PV_OFF_CUSTODY_GENERATION = 16,
  ANC_PV_OFF_VAULT_ID = 24,
  ANC_PV_OFF_ENDPOINT_ID = 184,
  ANC_PV_OFF_CEREMONY_ID = 344,
  ANC_PV_OFF_SIGNING_SEED = 504,
  ANC_PV_OFF_SIGNING_PUBLIC_KEY = 536,
  ANC_PV_OFF_BOX_SEED = 568,
  ANC_PV_OFF_BOX_PUBLIC_KEY = 600,
  ANC_PV_OFF_LOCAL_STATE_KEY = 632,
  ANC_PV_OFF_ACTIVE_EPOCH = 664,
  ANC_PV_OFF_ACTIVE_EPOCH_KEY = 672,
  ANC_PV_OFF_PENDING_EPOCH = 704,
  ANC_PV_OFF_PENDING_EPOCH_KEY = 712,
  ANC_PV_OFF_RECOVERY_GENERATION = 744,
  ANC_PV_OFF_ANCHORED_SEQUENCE = 752,
  ANC_PV_OFF_ANCHORED_HEAD = 760,
  ANC_PV_OFF_MEMBERSHIP_DIGEST = 792,
  ANC_PV_OFF_SIGNED_AT = 824,
  ANC_PV_OFF_SNAPSHOT_DIGEST = 832,
  ANC_PV_OFF_FRESHNESS = 864,
  ANC_PV_OFF_EXPECTED_NEXT_SEQUENCE = 872,
  ANC_PV_OFF_EXPECTED_PREVIOUS_HEAD = 880,
  ANC_PV_OFF_PENDING_TRANSCRIPT = 912,
  ANC_PV_OFF_REMOVAL_SEQUENCE = 944,
  ANC_PV_OFF_REMOVAL_HEAD = 952,
  ANC_PV_OFF_REMOVAL_AUTHORIZATION = 984,
  ANC_PV_OFF_REMOVAL_TIME = 1016,
  ANC_PV_OFF_RESERVED = 1024,
  ANC_PV_OFF_CHECKSUM = 1056,
};

static const uint8_t kAncPrivateVaultCustodyMagic[4] = {'A', 'N', 'V', 'C'};
/* The terminating NUL is a frozen byte in the anc/v1 checksum preimage. */
static const uint8_t kAncPrivateVaultCustodyChecksumDomain[] =
    "agent-native/private-vault/custody-record/checksum/anc-v1";
static const uint64_t kAncPrivateVaultMaxSafeInteger = 9007199254740991ULL;

_Static_assert(ANC_PV_OFF_CHECKSUM + ANC_PV_CUSTODY_CHECKSUM_BYTES ==
                   ANC_PV_CUSTODY_RECORD_BYTES,
               "custody record layout must remain exactly 1088 bytes");

static void anc_pv_write_u16(uint8_t *output, uint16_t value) {
  output[0] = (uint8_t)(value >> 8);
  output[1] = (uint8_t)value;
}

static uint16_t anc_pv_read_u16(const uint8_t *input) {
  return (uint16_t)(((uint16_t)input[0] << 8) | input[1]);
}

static void anc_pv_write_u64(uint8_t *output, uint64_t value) {
  for (size_t index = 0; index < 8; index += 1) {
    output[index] = (uint8_t)(value >> (56 - (index * 8)));
  }
}

static uint64_t anc_pv_read_u64(const uint8_t *input) {
  uint64_t value = 0;
  for (size_t index = 0; index < 8; index += 1) {
    value = (value << 8) | input[index];
  }
  return value;
}

static int anc_pv_is_zero(const uint8_t *value, size_t length) {
  uint8_t aggregate = 0;
  for (size_t index = 0; index < length; index += 1) aggregate |= value[index];
  return aggregate == 0;
}

static int anc_pv_is_nonzero(const uint8_t *value, size_t length) {
  return !anc_pv_is_zero(value, length);
}

typedef struct AncPrivateVaultMemoryRange {
  const void *pointer;
  size_t length;
} AncPrivateVaultMemoryRange;

static int anc_pv_ranges_overlap(AncPrivateVaultMemoryRange left,
                                 AncPrivateVaultMemoryRange right) {
  if (left.pointer == NULL || right.pointer == NULL || left.length == 0 ||
      right.length == 0) {
    return 0;
  }
  const uintptr_t left_start = (uintptr_t)left.pointer;
  const uintptr_t right_start = (uintptr_t)right.pointer;
  if (left_start > UINTPTR_MAX - left.length ||
      right_start > UINTPTR_MAX - right.length) {
    return 1;
  }
  return left_start < right_start + right.length &&
         right_start < left_start + left.length;
}

static int anc_pv_any_range_overlap(const AncPrivateVaultMemoryRange *ranges,
                                    size_t count) {
  for (size_t left = 0; left < count; left += 1) {
    for (size_t right = left + 1; right < count; right += 1) {
      if (anc_pv_ranges_overlap(ranges[left], ranges[right])) return 1;
    }
  }
  return 0;
}

static int anc_pv_safe_integer(uint64_t value) {
  return value <= kAncPrivateVaultMaxSafeInteger;
}

static int anc_pv_valid_id(const uint8_t *value, size_t length,
                           int required) {
  if (length > ANC_PV_CUSTODY_ID_BYTES || (required && length == 0)) return 0;
  for (size_t index = length; index < ANC_PV_CUSTODY_ID_BYTES; index += 1) {
    if (value[index] != 0) return 0;
  }
  if (length == 0) return 1;
  if (memchr(value, 0, length) != NULL) return 0;
  @autoreleasepool {
    NSData *data = [NSData dataWithBytes:value length:length];
    NSString *string = [[NSString alloc] initWithData:data
                                             encoding:NSUTF8StringEncoding];
    return string != nil && [string dataUsingEncoding:NSUTF8StringEncoding].length ==
                                length;
  }
}

static int anc_pv_decode_id(const uint8_t *field, uint8_t *output,
                            size_t *output_length, int required) {
  size_t length = 0;
  while (length < ANC_PV_CUSTODY_ID_BYTES && field[length] != 0) length += 1;
  for (size_t index = length; index < ANC_PV_CUSTODY_ID_BYTES; index += 1) {
    if (field[index] != 0) return 0;
  }
  if (!anc_pv_valid_id(field, length, required)) return 0;
  memset(output, 0, ANC_PV_CUSTODY_ID_BYTES);
  memcpy(output, field, length);
  *output_length = length;
  return 1;
}

static int anc_pv_valid_enums(const AncPrivateVaultCustodySnapshot *snapshot) {
  return snapshot->lifecycle >= ANC_PV_CUSTODY_LIFECYCLE_PENDING &&
         snapshot->lifecycle <= ANC_PV_CUSTODY_LIFECYCLE_REMOVED &&
         snapshot->role >= ANC_PV_CUSTODY_ROLE_ENDPOINT &&
         snapshot->role <= ANC_PV_CUSTODY_ROLE_BROKER &&
         snapshot->pending_kind >= ANC_PV_CUSTODY_PENDING_NONE &&
         snapshot->pending_kind <= ANC_PV_CUSTODY_PENDING_RECOVERY &&
         snapshot->rotation_phase >= ANC_PV_CUSTODY_ROTATION_NONE &&
         snapshot->rotation_phase <=
             ANC_PV_CUSTODY_ROTATION_AWAITING_CONTROL_COMMIT &&
         snapshot->enrollment_phase >= ANC_PV_CUSTODY_ENROLLMENT_NONE &&
         snapshot->enrollment_phase <=
             ANC_PV_CUSTODY_ENROLLMENT_AUTHORIZATION_RECEIVED;
}

static int anc_pv_valid_numbers(const AncPrivateVaultCustodySnapshot *snapshot) {
  const uint64_t values[] = {
      snapshot->custody_generation,
      snapshot->active_epoch,
      snapshot->pending_epoch,
      snapshot->recovery_generation,
      snapshot->anchored_sequence,
      snapshot->signed_at_ms,
      snapshot->freshness_ms,
      snapshot->expected_next_sequence,
      snapshot->removal_sequence,
      snapshot->removal_time_ms,
  };
  for (size_t index = 0; index < sizeof values / sizeof values[0]; index += 1) {
    if (!anc_pv_safe_integer(values[index])) return 0;
  }
  return snapshot->custody_generation > 0;
}

static int anc_pv_valid_public_state(
    const AncPrivateVaultCustodySnapshot *snapshot) {
  if (!anc_pv_valid_enums(snapshot) || !anc_pv_valid_numbers(snapshot) ||
      !anc_pv_valid_id(snapshot->vault_id, snapshot->vault_id_length, 1) ||
      !anc_pv_valid_id(snapshot->endpoint_id, snapshot->endpoint_id_length, 1) ||
      !anc_pv_valid_id(snapshot->ceremony_id, snapshot->ceremony_id_length,
                       snapshot->pending_kind != ANC_PV_CUSTODY_PENDING_NONE)) {
    return 0;
  }
  if (snapshot->anchored_sequence == 0) {
    if (anc_pv_is_nonzero(snapshot->anchored_head, ANC_PV_HASH_BYTES)) return 0;
  } else if (anc_pv_is_zero(snapshot->anchored_head, ANC_PV_HASH_BYTES)) {
    return 0;
  }
  if (snapshot->anchored_sequence == 0) {
    if (anc_pv_is_nonzero(snapshot->membership_digest, ANC_PV_HASH_BYTES) ||
        snapshot->signed_at_ms != 0 ||
        anc_pv_is_nonzero(snapshot->snapshot_digest, ANC_PV_HASH_BYTES) ||
        snapshot->freshness_ms != 0) {
      return 0;
    }
  } else if (anc_pv_is_zero(snapshot->membership_digest, ANC_PV_HASH_BYTES) ||
             snapshot->signed_at_ms == 0 ||
             anc_pv_is_zero(snapshot->snapshot_digest, ANC_PV_HASH_BYTES) ||
             snapshot->freshness_ms == 0) {
    return 0;
  }
  return 1;
}

static int anc_pv_valid_state_matrix(
    const AncPrivateVaultCustodySnapshot *snapshot,
    const AncPrivateVaultCustodySecretInputs *secrets) {
  const int has_signing_seed = anc_pv_is_nonzero(secrets->signing_seed, 32);
  const int has_box_seed = anc_pv_is_nonzero(secrets->box_seed, 32);
  const int has_local_key = anc_pv_is_nonzero(secrets->local_state_key, 32);
  const int has_active_key = anc_pv_is_nonzero(secrets->active_epoch_key, 32);
  const int has_pending_key = anc_pv_is_nonzero(secrets->pending_epoch_key, 32);
  const int has_public_keys =
      anc_pv_is_nonzero(snapshot->signing_public_key, 32) &&
      anc_pv_is_nonzero(snapshot->box_public_key, 32);
  const int pending = snapshot->pending_kind != ANC_PV_CUSTODY_PENDING_NONE;
  const int has_removal =
      snapshot->removal_sequence > 0 &&
      anc_pv_is_nonzero(snapshot->removal_head, ANC_PV_HASH_BYTES) &&
      anc_pv_is_nonzero(snapshot->removal_authorization_digest,
                        ANC_PV_HASH_BYTES) &&
      snapshot->removal_time_ms > 0;
  const int no_removal =
      snapshot->removal_sequence == 0 &&
      anc_pv_is_zero(snapshot->removal_head, ANC_PV_HASH_BYTES) &&
      anc_pv_is_zero(snapshot->removal_authorization_digest,
                     ANC_PV_HASH_BYTES) &&
      snapshot->removal_time_ms == 0;

  if (snapshot->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVING ||
      snapshot->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED) {
    return !pending &&
           snapshot->rotation_phase == ANC_PV_CUSTODY_ROTATION_NONE &&
           snapshot->enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_NONE &&
           snapshot->ceremony_id_length == 0 && !has_signing_seed &&
           !has_box_seed && !has_local_key && !has_active_key &&
           !has_pending_key && snapshot->active_epoch == 0 &&
           snapshot->pending_epoch == 0 && has_public_keys && has_removal &&
           snapshot->expected_next_sequence == 0 &&
           anc_pv_is_zero(snapshot->expected_previous_head,
                          ANC_PV_HASH_BYTES) &&
           anc_pv_is_zero(snapshot->pending_transcript_digest,
                          ANC_PV_HASH_BYTES);
  }

  if (!has_signing_seed || !has_box_seed || !has_local_key ||
      !has_public_keys || !no_removal) {
    return 0;
  }
  if (!pending) {
    return snapshot->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
           snapshot->rotation_phase == ANC_PV_CUSTODY_ROTATION_NONE &&
           snapshot->enrollment_phase == ANC_PV_CUSTODY_ENROLLMENT_NONE &&
           snapshot->ceremony_id_length == 0 &&
           snapshot->active_epoch > 0 && has_active_key &&
           snapshot->anchored_sequence > 0 &&
           snapshot->pending_epoch == 0 && !has_pending_key &&
           snapshot->expected_next_sequence == 0 &&
           anc_pv_is_zero(snapshot->expected_previous_head,
                          ANC_PV_HASH_BYTES) &&
           anc_pv_is_zero(snapshot->pending_transcript_digest,
                          ANC_PV_HASH_BYTES);
  }
  if (snapshot->lifecycle != ANC_PV_CUSTODY_LIFECYCLE_PENDING) {
    return 0;
  }
  if (snapshot->pending_kind == ANC_PV_CUSTODY_PENDING_ADD_DEVICE ||
      snapshot->pending_kind == ANC_PV_CUSTODY_PENDING_ADD_BROKER) {
    const int role_matches =
        (snapshot->pending_kind == ANC_PV_CUSTODY_PENDING_ADD_DEVICE &&
         snapshot->role == ANC_PV_CUSTODY_ROLE_ENDPOINT) ||
        (snapshot->pending_kind == ANC_PV_CUSTODY_PENDING_ADD_BROKER &&
         snapshot->role == ANC_PV_CUSTODY_ROLE_BROKER);
    if (!role_matches ||
        snapshot->rotation_phase != ANC_PV_CUSTODY_ROTATION_NONE ||
        snapshot->pending_epoch != 0 || has_pending_key) {
      return 0;
    }
    if (snapshot->enrollment_phase ==
        ANC_PV_CUSTODY_ENROLLMENT_OFFER_PENDING) {
      return snapshot->active_epoch == 0 && !has_active_key &&
             snapshot->recovery_generation == 0 &&
             snapshot->anchored_sequence == 0 &&
             snapshot->expected_next_sequence == 0 &&
             anc_pv_is_zero(snapshot->expected_previous_head,
                            ANC_PV_HASH_BYTES) &&
             anc_pv_is_zero(snapshot->pending_transcript_digest,
                            ANC_PV_HASH_BYTES);
    }
    if (snapshot->enrollment_phase !=
            ANC_PV_CUSTODY_ENROLLMENT_AUTHORIZATION_RECEIVED ||
        snapshot->active_epoch == 0 || !has_active_key ||
        snapshot->anchored_sequence == 0 ||
        snapshot->expected_next_sequence != snapshot->anchored_sequence + 1 ||
        anc_pv_is_zero(snapshot->pending_transcript_digest,
                       ANC_PV_HASH_BYTES)) {
      return 0;
    }
    return anc_pv_memcmp(snapshot->expected_previous_head,
                         snapshot->anchored_head, ANC_PV_HASH_BYTES) ==
           ANC_PV_CRYPTO_OK;
  }
  if (snapshot->enrollment_phase != ANC_PV_CUSTODY_ENROLLMENT_NONE ||
      snapshot->expected_next_sequence == 0 ||
      snapshot->expected_next_sequence != snapshot->anchored_sequence + 1 ||
      anc_pv_is_zero(snapshot->pending_transcript_digest, ANC_PV_HASH_BYTES)) {
    return 0;
  }
  if (snapshot->anchored_sequence == 0) {
    if (anc_pv_is_nonzero(snapshot->expected_previous_head,
                          ANC_PV_HASH_BYTES)) {
      return 0;
    }
  } else if (anc_pv_memcmp(snapshot->expected_previous_head,
                           snapshot->anchored_head, ANC_PV_HASH_BYTES) !=
             ANC_PV_CRYPTO_OK) {
    return 0;
  }
  if (snapshot->pending_kind == ANC_PV_CUSTODY_PENDING_GENESIS) {
    return snapshot->rotation_phase != ANC_PV_CUSTODY_ROTATION_NONE &&
           snapshot->role == ANC_PV_CUSTODY_ROLE_ENDPOINT &&
           snapshot->active_epoch == 0 && !has_active_key &&
           snapshot->pending_epoch == 1 && has_pending_key &&
           snapshot->anchored_sequence == 0 &&
           snapshot->recovery_generation == 0;
  }
  if (snapshot->pending_kind == ANC_PV_CUSTODY_PENDING_RECOVERY) {
    return snapshot->rotation_phase != ANC_PV_CUSTODY_ROTATION_NONE &&
           snapshot->role == ANC_PV_CUSTODY_ROLE_ENDPOINT &&
           snapshot->active_epoch > 0 && !has_active_key &&
           snapshot->pending_epoch == snapshot->active_epoch + 1 &&
           has_pending_key && snapshot->anchored_sequence > 0 &&
           snapshot->recovery_generation > 0;
  }
  return 0;
}

static int anc_pv_valid_secret_pointers(
    const AncPrivateVaultCustodySecretInputs *secrets) {
  return secrets != NULL && secrets->signing_seed != NULL &&
         secrets->box_seed != NULL && secrets->local_state_key != NULL &&
         secrets->active_epoch_key != NULL &&
         secrets->pending_epoch_key != NULL;
}

static int anc_pv_valid_output_pointers(
    const AncPrivateVaultCustodySecretOutputs *secrets) {
  return secrets != NULL && secrets->signing_seed != NULL &&
         secrets->box_seed != NULL && secrets->local_state_key != NULL &&
         secrets->active_epoch_key != NULL &&
         secrets->pending_epoch_key != NULL;
}

static void anc_pv_clear_secret_outputs(
    const AncPrivateVaultCustodySecretOutputs *secrets) {
  if (secrets == NULL) return;
  if (secrets->signing_seed != NULL) anc_pv_zeroize(secrets->signing_seed, 32);
  if (secrets->box_seed != NULL) anc_pv_zeroize(secrets->box_seed, 32);
  if (secrets->local_state_key != NULL)
    anc_pv_zeroize(secrets->local_state_key, 32);
  if (secrets->active_epoch_key != NULL)
    anc_pv_zeroize(secrets->active_epoch_key, 32);
  if (secrets->pending_epoch_key != NULL)
    anc_pv_zeroize(secrets->pending_epoch_key, 32);
}

static void anc_pv_clear_disjoint_decode_outputs(
    AncPrivateVaultCustodySnapshot *snapshot,
    const AncPrivateVaultCustodySecretOutputs *secrets,
    AncPrivateVaultMemoryRange source) {
  if (snapshot != NULL &&
      !anc_pv_ranges_overlap(source,
                             (AncPrivateVaultMemoryRange){snapshot,
                                                          sizeof *snapshot})) {
    anc_pv_custody_snapshot_zero(snapshot);
  }
  if (secrets == NULL) return;
  uint8_t *outputs[] = {
      secrets->signing_seed,      secrets->box_seed,
      secrets->local_state_key,  secrets->active_epoch_key,
      secrets->pending_epoch_key,
  };
  for (size_t index = 0; index < sizeof outputs / sizeof outputs[0];
       index += 1) {
    if (outputs[index] != NULL &&
        !anc_pv_ranges_overlap(
            source, (AncPrivateVaultMemoryRange){outputs[index], 32})) {
      anc_pv_zeroize(outputs[index], 32);
    }
  }
}

static AncPrivateVaultCustodyRecordStatus anc_pv_checksum(
    uint8_t output[ANC_PV_HASH_BYTES], const uint8_t *record) {
  uint8_t input[sizeof kAncPrivateVaultCustodyChecksumDomain +
                ANC_PV_OFF_CHECKSUM];
  memcpy(input, kAncPrivateVaultCustodyChecksumDomain,
         sizeof kAncPrivateVaultCustodyChecksumDomain);
  memcpy(input + sizeof kAncPrivateVaultCustodyChecksumDomain, record,
         ANC_PV_OFF_CHECKSUM);
  const AncPrivateVaultCryptoStatus status =
      anc_pv_blake2b_256(output, input, sizeof input);
  anc_pv_zeroize(input, sizeof input);
  if (status != ANC_PV_CRYPTO_OK) {
    anc_pv_zeroize(output, ANC_PV_HASH_BYTES);
    return ANC_PV_CUSTODY_CRYPTO_FAILED;
  }
  return ANC_PV_CUSTODY_OK;
}

static AncPrivateVaultCustodyRecordStatus anc_pv_validate_derived_keys(
    const AncPrivateVaultCustodySnapshot *snapshot,
    const AncPrivateVaultCustodySecretInputs *secrets) {
  uint8_t signing_public[32] = {0};
  uint8_t signing_private[64] = {0};
  uint8_t box_public[32] = {0};
  uint8_t box_private[32] = {0};
  AncPrivateVaultCustodyRecordStatus result = ANC_PV_CUSTODY_CRYPTO_FAILED;
  if (snapshot->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVING ||
      snapshot->lifecycle == ANC_PV_CUSTODY_LIFECYCLE_REMOVED) {
    return ANC_PV_CUSTODY_OK;
  }
  if (anc_pv_ed25519_seed_keypair(signing_public, signing_private,
                                  secrets->signing_seed) != ANC_PV_CRYPTO_OK ||
      anc_pv_box_seed_keypair(box_public, box_private, secrets->box_seed) !=
          ANC_PV_CRYPTO_OK) {
    goto cleanup;
  }
  result = anc_pv_memcmp(signing_public, snapshot->signing_public_key, 32) ==
                       ANC_PV_CRYPTO_OK &&
                   anc_pv_memcmp(box_public, snapshot->box_public_key, 32) ==
                       ANC_PV_CRYPTO_OK
               ? ANC_PV_CUSTODY_OK
               : ANC_PV_CUSTODY_INVALID_RECORD;
cleanup:
  anc_pv_zeroize(signing_public, sizeof signing_public);
  anc_pv_zeroize(signing_private, sizeof signing_private);
  anc_pv_zeroize(box_public, sizeof box_public);
  anc_pv_zeroize(box_private, sizeof box_private);
  return result;
}

void anc_pv_custody_snapshot_zero(AncPrivateVaultCustodySnapshot *snapshot) {
  if (snapshot != NULL) anc_pv_zeroize(snapshot, sizeof *snapshot);
}

AncPrivateVaultCustodyRecordStatus anc_pv_custody_record_encode(
    const AncPrivateVaultCustodySnapshot *snapshot,
    const AncPrivateVaultCustodySecretInputs *secrets, uint8_t *record,
    size_t record_length) {
  const int top_level_valid =
      snapshot != NULL && record != NULL && secrets != NULL &&
      record_length == ANC_PV_CUSTODY_RECORD_BYTES;
  AncPrivateVaultCustodySecretInputs captured_inputs = {0};
  if (top_level_valid) {
    const AncPrivateVaultMemoryRange record_range = {record, record_length};
    const AncPrivateVaultMemoryRange snapshot_range = {snapshot,
                                                       sizeof *snapshot};
    const AncPrivateVaultMemoryRange descriptor_range = {secrets,
                                                         sizeof *secrets};
    if (anc_pv_ranges_overlap(record_range, snapshot_range) ||
        anc_pv_ranges_overlap(record_range, descriptor_range)) {
      return ANC_PV_CUSTODY_INVALID_ARGUMENT;
    }
    if (anc_pv_ranges_overlap(snapshot_range, descriptor_range)) {
      anc_pv_zeroize(record, record_length);
      return ANC_PV_CUSTODY_INVALID_ARGUMENT;
    }
    captured_inputs = *secrets;
    /* Never reread the caller-owned descriptor after this immutable capture. */
    if (anc_pv_valid_secret_pointers(&captured_inputs)) {
      const AncPrivateVaultMemoryRange input_ranges[] = {
          {captured_inputs.signing_seed, 32},
          {captured_inputs.box_seed, 32},
          {captured_inputs.local_state_key, 32},
          {captured_inputs.active_epoch_key, 32},
          {captured_inputs.pending_epoch_key, 32},
      };
      for (size_t index = 0;
           index < sizeof input_ranges / sizeof input_ranges[0]; index += 1) {
        if (anc_pv_ranges_overlap(record_range, input_ranges[index])) {
          return ANC_PV_CUSTODY_INVALID_ARGUMENT;
        }
      }
      const AncPrivateVaultMemoryRange non_record_ranges[] = {
          snapshot_range,
          descriptor_range,
          input_ranges[0],
          input_ranges[1],
          input_ranges[2],
          input_ranges[3],
          input_ranges[4],
      };
      if (anc_pv_any_range_overlap(
              non_record_ranges,
              sizeof non_record_ranges / sizeof non_record_ranges[0])) {
        anc_pv_zeroize(record, record_length);
        return ANC_PV_CUSTODY_INVALID_ARGUMENT;
      }
    }
  }
  if (record != NULL && record_length == ANC_PV_CUSTODY_RECORD_BYTES)
    anc_pv_zeroize(record, record_length);
  if (!top_level_valid || !anc_pv_valid_secret_pointers(&captured_inputs) ||
      !anc_pv_valid_public_state(snapshot) ||
      !anc_pv_valid_state_matrix(snapshot, &captured_inputs)) {
    return ANC_PV_CUSTODY_INVALID_ARGUMENT;
  }
  AncPrivateVaultCustodyRecordStatus key_status =
      anc_pv_validate_derived_keys(snapshot, &captured_inputs);
  if (key_status != ANC_PV_CUSTODY_OK) return key_status;

  memcpy(record + ANC_PV_OFF_MAGIC, kAncPrivateVaultCustodyMagic, 4);
  anc_pv_write_u16(record + ANC_PV_OFF_VERSION, ANC_PV_CUSTODY_VERSION);
  anc_pv_write_u16(record + ANC_PV_OFF_LENGTH, ANC_PV_CUSTODY_RECORD_BYTES);
  record[ANC_PV_OFF_LIFECYCLE] = (uint8_t)snapshot->lifecycle;
  record[ANC_PV_OFF_ROLE] = (uint8_t)snapshot->role;
  record[ANC_PV_OFF_PENDING_KIND] = (uint8_t)snapshot->pending_kind;
  record[ANC_PV_OFF_ROTATION_PHASE] = (uint8_t)snapshot->rotation_phase;
  record[ANC_PV_OFF_ENROLLMENT_PHASE] = (uint8_t)snapshot->enrollment_phase;
  anc_pv_write_u64(record + ANC_PV_OFF_CUSTODY_GENERATION,
                   snapshot->custody_generation);
  memcpy(record + ANC_PV_OFF_VAULT_ID, snapshot->vault_id,
         snapshot->vault_id_length);
  memcpy(record + ANC_PV_OFF_ENDPOINT_ID, snapshot->endpoint_id,
         snapshot->endpoint_id_length);
  memcpy(record + ANC_PV_OFF_CEREMONY_ID, snapshot->ceremony_id,
         snapshot->ceremony_id_length);
  memcpy(record + ANC_PV_OFF_SIGNING_SEED, captured_inputs.signing_seed, 32);
  memcpy(record + ANC_PV_OFF_SIGNING_PUBLIC_KEY,
         snapshot->signing_public_key, 32);
  memcpy(record + ANC_PV_OFF_BOX_SEED, captured_inputs.box_seed, 32);
  memcpy(record + ANC_PV_OFF_BOX_PUBLIC_KEY, snapshot->box_public_key, 32);
  memcpy(record + ANC_PV_OFF_LOCAL_STATE_KEY, captured_inputs.local_state_key,
         32);
  anc_pv_write_u64(record + ANC_PV_OFF_ACTIVE_EPOCH, snapshot->active_epoch);
  memcpy(record + ANC_PV_OFF_ACTIVE_EPOCH_KEY,
         captured_inputs.active_epoch_key, 32);
  anc_pv_write_u64(record + ANC_PV_OFF_PENDING_EPOCH, snapshot->pending_epoch);
  memcpy(record + ANC_PV_OFF_PENDING_EPOCH_KEY,
         captured_inputs.pending_epoch_key, 32);
  anc_pv_write_u64(record + ANC_PV_OFF_RECOVERY_GENERATION,
                   snapshot->recovery_generation);
  anc_pv_write_u64(record + ANC_PV_OFF_ANCHORED_SEQUENCE,
                   snapshot->anchored_sequence);
  memcpy(record + ANC_PV_OFF_ANCHORED_HEAD, snapshot->anchored_head, 32);
  memcpy(record + ANC_PV_OFF_MEMBERSHIP_DIGEST, snapshot->membership_digest,
         32);
  anc_pv_write_u64(record + ANC_PV_OFF_SIGNED_AT, snapshot->signed_at_ms);
  memcpy(record + ANC_PV_OFF_SNAPSHOT_DIGEST, snapshot->snapshot_digest, 32);
  anc_pv_write_u64(record + ANC_PV_OFF_FRESHNESS, snapshot->freshness_ms);
  anc_pv_write_u64(record + ANC_PV_OFF_EXPECTED_NEXT_SEQUENCE,
                   snapshot->expected_next_sequence);
  memcpy(record + ANC_PV_OFF_EXPECTED_PREVIOUS_HEAD,
         snapshot->expected_previous_head, 32);
  memcpy(record + ANC_PV_OFF_PENDING_TRANSCRIPT,
         snapshot->pending_transcript_digest, 32);
  anc_pv_write_u64(record + ANC_PV_OFF_REMOVAL_SEQUENCE,
                   snapshot->removal_sequence);
  memcpy(record + ANC_PV_OFF_REMOVAL_HEAD, snapshot->removal_head, 32);
  memcpy(record + ANC_PV_OFF_REMOVAL_AUTHORIZATION,
         snapshot->removal_authorization_digest, 32);
  anc_pv_write_u64(record + ANC_PV_OFF_REMOVAL_TIME,
                   snapshot->removal_time_ms);
  AncPrivateVaultCustodyRecordStatus status =
      anc_pv_checksum(record + ANC_PV_OFF_CHECKSUM, record);
  if (status != ANC_PV_CUSTODY_OK) anc_pv_zeroize(record, record_length);
  return status;
}

AncPrivateVaultCustodyRecordStatus anc_pv_custody_record_decode(
    const uint8_t *record, size_t record_length,
    AncPrivateVaultCustodySnapshot *snapshot,
    const AncPrivateVaultCustodySecretOutputs *secret_outputs) {
  const int top_level_valid =
      record != NULL && snapshot != NULL && secret_outputs != NULL &&
      record_length == ANC_PV_CUSTODY_RECORD_BYTES;
  if (!top_level_valid) {
    const AncPrivateVaultMemoryRange source = {record, record_length};
    const AncPrivateVaultMemoryRange snapshot_range = {snapshot,
                                                       sizeof *snapshot};
    const AncPrivateVaultMemoryRange descriptor_range = {
        secret_outputs,
        secret_outputs == NULL ? 0 : sizeof *secret_outputs,
    };
    if (anc_pv_ranges_overlap(source, descriptor_range) ||
        anc_pv_ranges_overlap(snapshot_range, descriptor_range)) {
      if (snapshot != NULL &&
          !anc_pv_ranges_overlap(source, snapshot_range)) {
        anc_pv_custody_snapshot_zero(snapshot);
      }
      return ANC_PV_CUSTODY_INVALID_ARGUMENT;
    }
    AncPrivateVaultCustodySecretOutputs captured_outputs = {0};
    if (secret_outputs != NULL) captured_outputs = *secret_outputs;
    anc_pv_clear_disjoint_decode_outputs(snapshot, &captured_outputs, source);
    return ANC_PV_CUSTODY_INVALID_ARGUMENT;
  }
  const AncPrivateVaultMemoryRange source = {record, record_length};
  const AncPrivateVaultMemoryRange snapshot_range = {snapshot,
                                                     sizeof *snapshot};
  const AncPrivateVaultMemoryRange descriptor_range = {
      secret_outputs, sizeof *secret_outputs};
  if (anc_pv_ranges_overlap(source, descriptor_range)) {
    if (!anc_pv_ranges_overlap(source, snapshot_range))
      anc_pv_custody_snapshot_zero(snapshot);
    return ANC_PV_CUSTODY_INVALID_ARGUMENT;
  }
  if (anc_pv_ranges_overlap(snapshot_range, descriptor_range)) {
    if (!anc_pv_ranges_overlap(source, snapshot_range))
      anc_pv_custody_snapshot_zero(snapshot);
    return ANC_PV_CUSTODY_INVALID_ARGUMENT;
  }
  const AncPrivateVaultCustodySecretOutputs captured_outputs = *secret_outputs;
  /* Never reread the caller-owned descriptor after this immutable capture. */
  if (!anc_pv_valid_output_pointers(&captured_outputs)) {
    anc_pv_clear_disjoint_decode_outputs(snapshot, &captured_outputs, source);
    return ANC_PV_CUSTODY_INVALID_ARGUMENT;
  }
  const AncPrivateVaultMemoryRange ranges[] = {
      source,
      snapshot_range,
      descriptor_range,
      {captured_outputs.signing_seed, 32},
      {captured_outputs.box_seed, 32},
      {captured_outputs.local_state_key, 32},
      {captured_outputs.active_epoch_key, 32},
      {captured_outputs.pending_epoch_key, 32},
  };
  if (anc_pv_any_range_overlap(ranges, sizeof ranges / sizeof ranges[0])) {
    anc_pv_clear_disjoint_decode_outputs(snapshot, &captured_outputs, source);
    return ANC_PV_CUSTODY_INVALID_ARGUMENT;
  }
  anc_pv_custody_snapshot_zero(snapshot);
  anc_pv_clear_secret_outputs(&captured_outputs);
  if (memcmp(record + ANC_PV_OFF_MAGIC, kAncPrivateVaultCustodyMagic, 4) != 0 ||
      anc_pv_read_u16(record + ANC_PV_OFF_VERSION) != ANC_PV_CUSTODY_VERSION ||
      anc_pv_read_u16(record + ANC_PV_OFF_LENGTH) !=
          ANC_PV_CUSTODY_RECORD_BYTES ||
      !anc_pv_is_zero(record + ANC_PV_OFF_FLAGS, 3) ||
      !anc_pv_is_zero(record + ANC_PV_OFF_RESERVED, 32)) {
    return ANC_PV_CUSTODY_INVALID_RECORD;
  }
  uint8_t checksum[32] = {0};
  AncPrivateVaultCustodyRecordStatus checksum_status =
      anc_pv_checksum(checksum, record);
  if (checksum_status != ANC_PV_CUSTODY_OK) return checksum_status;
  if (anc_pv_memcmp(checksum, record + ANC_PV_OFF_CHECKSUM, 32) !=
      ANC_PV_CRYPTO_OK) {
    anc_pv_zeroize(checksum, sizeof checksum);
    return ANC_PV_CUSTODY_CHECKSUM_FAILED;
  }
  anc_pv_zeroize(checksum, sizeof checksum);

  snapshot->lifecycle = record[ANC_PV_OFF_LIFECYCLE];
  snapshot->role = record[ANC_PV_OFF_ROLE];
  snapshot->pending_kind = record[ANC_PV_OFF_PENDING_KIND];
  snapshot->rotation_phase = record[ANC_PV_OFF_ROTATION_PHASE];
  snapshot->enrollment_phase = record[ANC_PV_OFF_ENROLLMENT_PHASE];
  snapshot->custody_generation =
      anc_pv_read_u64(record + ANC_PV_OFF_CUSTODY_GENERATION);
  if (!anc_pv_decode_id(record + ANC_PV_OFF_VAULT_ID, snapshot->vault_id,
                        &snapshot->vault_id_length, 1) ||
      !anc_pv_decode_id(record + ANC_PV_OFF_ENDPOINT_ID, snapshot->endpoint_id,
                        &snapshot->endpoint_id_length, 1) ||
      !anc_pv_decode_id(record + ANC_PV_OFF_CEREMONY_ID,
                        snapshot->ceremony_id, &snapshot->ceremony_id_length,
                        snapshot->pending_kind != ANC_PV_CUSTODY_PENDING_NONE)) {
    goto invalid;
  }
  memcpy(captured_outputs.signing_seed, record + ANC_PV_OFF_SIGNING_SEED, 32);
  memcpy(snapshot->signing_public_key,
         record + ANC_PV_OFF_SIGNING_PUBLIC_KEY, 32);
  memcpy(captured_outputs.box_seed, record + ANC_PV_OFF_BOX_SEED, 32);
  memcpy(snapshot->box_public_key, record + ANC_PV_OFF_BOX_PUBLIC_KEY, 32);
  memcpy(captured_outputs.local_state_key,
         record + ANC_PV_OFF_LOCAL_STATE_KEY, 32);
  snapshot->active_epoch = anc_pv_read_u64(record + ANC_PV_OFF_ACTIVE_EPOCH);
  memcpy(captured_outputs.active_epoch_key,
         record + ANC_PV_OFF_ACTIVE_EPOCH_KEY, 32);
  snapshot->pending_epoch = anc_pv_read_u64(record + ANC_PV_OFF_PENDING_EPOCH);
  memcpy(captured_outputs.pending_epoch_key,
         record + ANC_PV_OFF_PENDING_EPOCH_KEY, 32);
  snapshot->recovery_generation =
      anc_pv_read_u64(record + ANC_PV_OFF_RECOVERY_GENERATION);
  snapshot->anchored_sequence =
      anc_pv_read_u64(record + ANC_PV_OFF_ANCHORED_SEQUENCE);
  memcpy(snapshot->anchored_head, record + ANC_PV_OFF_ANCHORED_HEAD, 32);
  memcpy(snapshot->membership_digest, record + ANC_PV_OFF_MEMBERSHIP_DIGEST,
         32);
  snapshot->signed_at_ms = anc_pv_read_u64(record + ANC_PV_OFF_SIGNED_AT);
  memcpy(snapshot->snapshot_digest, record + ANC_PV_OFF_SNAPSHOT_DIGEST, 32);
  snapshot->freshness_ms = anc_pv_read_u64(record + ANC_PV_OFF_FRESHNESS);
  snapshot->expected_next_sequence =
      anc_pv_read_u64(record + ANC_PV_OFF_EXPECTED_NEXT_SEQUENCE);
  memcpy(snapshot->expected_previous_head,
         record + ANC_PV_OFF_EXPECTED_PREVIOUS_HEAD, 32);
  memcpy(snapshot->pending_transcript_digest,
         record + ANC_PV_OFF_PENDING_TRANSCRIPT, 32);
  snapshot->removal_sequence =
      anc_pv_read_u64(record + ANC_PV_OFF_REMOVAL_SEQUENCE);
  memcpy(snapshot->removal_head, record + ANC_PV_OFF_REMOVAL_HEAD, 32);
  memcpy(snapshot->removal_authorization_digest,
         record + ANC_PV_OFF_REMOVAL_AUTHORIZATION, 32);
  snapshot->removal_time_ms =
      anc_pv_read_u64(record + ANC_PV_OFF_REMOVAL_TIME);

  AncPrivateVaultCustodySecretInputs inputs = {
      .signing_seed = captured_outputs.signing_seed,
      .box_seed = captured_outputs.box_seed,
      .local_state_key = captured_outputs.local_state_key,
      .active_epoch_key = captured_outputs.active_epoch_key,
      .pending_epoch_key = captured_outputs.pending_epoch_key,
  };
  if (!anc_pv_valid_public_state(snapshot) ||
      !anc_pv_valid_state_matrix(snapshot, &inputs)) {
    goto invalid;
  }
  AncPrivateVaultCustodyRecordStatus key_status =
      anc_pv_validate_derived_keys(snapshot, &inputs);
  if (key_status != ANC_PV_CUSTODY_OK) {
    anc_pv_custody_snapshot_zero(snapshot);
    anc_pv_clear_secret_outputs(&captured_outputs);
    return key_status;
  }
  return ANC_PV_CUSTODY_OK;

invalid:
  anc_pv_custody_snapshot_zero(snapshot);
  anc_pv_clear_secret_outputs(&captured_outputs);
  return ANC_PV_CUSTODY_INVALID_RECORD;
}
