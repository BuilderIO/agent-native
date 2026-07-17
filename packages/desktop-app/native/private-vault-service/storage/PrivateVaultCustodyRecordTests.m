#import <Foundation/Foundation.h>

#import "PrivateVaultCustodyRecord.h"
#import "PrivateVaultGuardedMemory.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(condition)                                                       \
  do {                                                                         \
    if (!(condition)) {                                                        \
      fprintf(stderr, "CHECK failed at %s:%d: %s\n", __FILE__, __LINE__,       \
              #condition);                                                     \
      return 1;                                                                \
    }                                                                          \
  } while (0)

typedef struct TestSecrets {
  uint8_t signing_seed[32];
  uint8_t box_seed[32];
  uint8_t local_state_key[32];
  uint8_t active_epoch_key[32];
  uint8_t pending_epoch_key[32];
} TestSecrets;

static void fill(uint8_t *output, size_t length, uint8_t start) {
  for (size_t index = 0; index < length; index += 1)
    output[index] = (uint8_t)(start + index);
}

static void set_id(uint8_t output[ANC_PV_CUSTODY_ID_BYTES], size_t *length,
                   const char *value) {
  *length = strlen(value);
  memset(output, 0, ANC_PV_CUSTODY_ID_BYTES);
  memcpy(output, value, *length);
}

static AncPrivateVaultCustodySecretInputs inputs(TestSecrets *secrets) {
  return (AncPrivateVaultCustodySecretInputs){
      .signing_seed = secrets->signing_seed,
      .box_seed = secrets->box_seed,
      .local_state_key = secrets->local_state_key,
      .active_epoch_key = secrets->active_epoch_key,
      .pending_epoch_key = secrets->pending_epoch_key,
  };
}

static AncPrivateVaultCustodySecretOutputs outputs(TestSecrets *secrets) {
  return (AncPrivateVaultCustodySecretOutputs){
      .signing_seed = secrets->signing_seed,
      .box_seed = secrets->box_seed,
      .local_state_key = secrets->local_state_key,
      .active_epoch_key = secrets->active_epoch_key,
      .pending_epoch_key = secrets->pending_epoch_key,
  };
}

static int make_active(AncPrivateVaultCustodySnapshot *snapshot,
                       TestSecrets *secrets) {
  memset(snapshot, 0, sizeof *snapshot);
  memset(secrets, 0, sizeof *secrets);
  snapshot->record_version = ANC_PV_CUSTODY_VERSION;
  snapshot->authority_anchor_present = 1;
  snapshot->lifecycle = ANC_PV_CUSTODY_LIFECYCLE_ACTIVE;
  snapshot->role = ANC_PV_CUSTODY_ROLE_ENDPOINT;
  snapshot->pending_kind = ANC_PV_CUSTODY_PENDING_NONE;
  snapshot->rotation_phase = ANC_PV_CUSTODY_ROTATION_NONE;
  snapshot->custody_generation = 0x010203040506ULL;
  set_id(snapshot->vault_id, &snapshot->vault_id_length, "vault-alpha");
  set_id(snapshot->endpoint_id, &snapshot->endpoint_id_length,
         "endpoint-macbook");
  fill(secrets->signing_seed, 32, 1);
  fill(secrets->box_seed, 32, 33);
  fill(secrets->local_state_key, 32, 65);
  fill(secrets->active_epoch_key, 32, 97);
  uint8_t signing_private[64] = {0};
  uint8_t box_private[32] = {0};
  CHECK(anc_pv_ed25519_seed_keypair(snapshot->signing_public_key,
                                    signing_private,
                                    secrets->signing_seed) == ANC_PV_CRYPTO_OK);
  CHECK(anc_pv_box_seed_keypair(snapshot->box_public_key, box_private,
                                secrets->box_seed) == ANC_PV_CRYPTO_OK);
  anc_pv_zeroize(signing_private, sizeof signing_private);
  anc_pv_zeroize(box_private, sizeof box_private);
  snapshot->active_epoch = 7;
  snapshot->recovery_generation = 3;
  snapshot->anchored_sequence = 9;
  fill(snapshot->anchored_head, 32, 129);
  fill(snapshot->membership_digest, 32, 161);
  snapshot->signed_at_ms = 1700000000123ULL;
  fill(snapshot->snapshot_digest, 32, 193);
  snapshot->freshness_ms = 1700000000999ULL;
  return 0;
}

static int recompute_checksum(uint8_t record[ANC_PV_CUSTODY_RECORD_BYTES]) {
  static const uint8_t domain[] =
      "agent-native/private-vault/custody-record/checksum/anc-v1";
  uint8_t input[sizeof domain + 1056];
  CHECK(domain[sizeof domain - 1] == 0);
  memcpy(input, domain, sizeof domain);
  memcpy(input + sizeof domain, record, 1056);
  CHECK(anc_pv_blake2b_256(record + 1056, input, sizeof input) ==
        ANC_PV_CRYPTO_OK);
  anc_pv_zeroize(input, sizeof input);
  return 0;
}

static int test_golden_layout_and_round_trip(void) {
  AncPrivateVaultCustodySnapshot snapshot;
  TestSecrets secrets;
  CHECK(make_active(&snapshot, &secrets) == 0);
  AncPrivateVaultCustodySecretInputs source = inputs(&secrets);
  uint8_t record[ANC_PV_CUSTODY_RECORD_BYTES] = {0};
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, record,
                                     sizeof record) == ANC_PV_CUSTODY_OK);
  CHECK(sizeof record == 1088);
  CHECK(memcmp(record, "ANVC", 4) == 0);
  CHECK(record[4] == 0 && record[5] == 2);
  CHECK(record[6] == 0x04 && record[7] == 0x40);
  CHECK(record[8] == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE);
  CHECK(record[9] == ANC_PV_CUSTODY_ROLE_ENDPOINT);
  CHECK(record[10] == 0 && record[11] == 0 && record[12] == 0);
  CHECK(record[13] == ANC_PV_CUSTODY_FLAG_AUTHORITY_ANCHOR_PRESENT &&
        record[14] == 0 && record[15] == 0);
  CHECK(record[16] == 0 && record[17] == 0 && record[18] == 1 &&
        record[19] == 2 && record[20] == 3 && record[21] == 4 &&
        record[22] == 5 && record[23] == 6);
  CHECK(memcmp(record + 24, "vault-alpha", 11) == 0);
  CHECK(record[24 + 11] == 0);
  CHECK(memcmp(record + 184, "endpoint-macbook", 16) == 0);
  CHECK(memcmp(record + 504, secrets.signing_seed, 32) == 0);
  CHECK(memcmp(record + 536, snapshot.signing_public_key, 32) == 0);
  CHECK(memcmp(record + 568, secrets.box_seed, 32) == 0);
  CHECK(memcmp(record + 632, secrets.local_state_key, 32) == 0);
  CHECK(record[671] == 7);
  CHECK(memcmp(record + 672, secrets.active_epoch_key, 32) == 0);
  CHECK(record[751] == 3 && record[759] == 9);
  for (size_t index = 1024; index < 1056; index += 1)
    CHECK(record[index] == 0);

  AncPrivateVaultCustodySnapshot decoded;
  TestSecrets decoded_secrets;
  memset(&decoded_secrets, 0xa5, sizeof decoded_secrets);
  AncPrivateVaultCustodySecretOutputs destination = outputs(&decoded_secrets);
  CHECK(anc_pv_custody_record_decode(record, sizeof record, &decoded,
                                     &destination) == ANC_PV_CUSTODY_OK);
  CHECK(decoded.lifecycle == snapshot.lifecycle);
  CHECK(decoded.custody_generation == snapshot.custody_generation);
  CHECK(decoded.vault_id_length == snapshot.vault_id_length);
  CHECK(memcmp(decoded.vault_id, snapshot.vault_id, snapshot.vault_id_length) ==
        0);
  CHECK(memcmp(&decoded_secrets, &secrets, sizeof secrets) == 0);

  uint8_t second[ANC_PV_CUSTODY_RECORD_BYTES] = {0};
  CHECK(anc_pv_custody_record_encode(&decoded, &source, second,
                                     sizeof second) == ANC_PV_CUSTODY_OK);
  CHECK(memcmp(record, second, sizeof record) == 0);
  anc_pv_custody_snapshot_zero(&decoded);
  CHECK(memcmp(&decoded, &(AncPrivateVaultCustodySnapshot){0},
               sizeof decoded) == 0);
  return 0;
}

static int all_zero(const void *bytes, size_t length) {
  const uint8_t *value = bytes;
  uint8_t aggregate = 0;
  for (size_t index = 0; index < length; index += 1)
    aggregate |= value[index];
  return aggregate == 0;
}

static int test_v2_presence_and_v1_compatibility(void) {
  AncPrivateVaultCustodySnapshot snapshot;
  TestSecrets secrets;
  CHECK(make_active(&snapshot, &secrets) == 0);
  snapshot.anchored_sequence = 0;
  AncPrivateVaultCustodySecretInputs source = inputs(&secrets);
  uint8_t record[ANC_PV_CUSTODY_RECORD_BYTES] = {0};
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, record,
                                     sizeof record) == ANC_PV_CUSTODY_OK);
  CHECK(record[13] == ANC_PV_CUSTODY_FLAG_AUTHORITY_ANCHOR_PRESENT);

  AncPrivateVaultCustodySnapshot decoded;
  TestSecrets decoded_secrets = {0};
  AncPrivateVaultCustodySecretOutputs destination = outputs(&decoded_secrets);
  CHECK(anc_pv_custody_record_decode(record, sizeof record, &decoded,
                                     &destination) == ANC_PV_CUSTODY_OK);
  CHECK(decoded.record_version == ANC_PV_CUSTODY_VERSION);
  CHECK(decoded.authority_anchor_present && decoded.anchored_sequence == 0);

  record[13] |= 0x80;
  CHECK(recompute_checksum(record) == 0);
  CHECK(anc_pv_custody_record_decode(record, sizeof record, &decoded,
                                     &destination) ==
        ANC_PV_CUSTODY_INVALID_RECORD);
  record[13] &= 0x03;
  record[14] = 1;
  CHECK(recompute_checksum(record) == 0);
  CHECK(anc_pv_custody_record_decode(record, sizeof record, &decoded,
                                     &destination) ==
        ANC_PV_CUSTODY_INVALID_RECORD);

  CHECK(make_active(&snapshot, &secrets) == 0);
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, record,
                                     sizeof record) == ANC_PV_CUSTODY_OK);
  record[4] = 0;
  record[5] = ANC_PV_CUSTODY_LEGACY_VERSION;
  record[13] = 0;
  CHECK(recompute_checksum(record) == 0);
  CHECK(anc_pv_custody_record_decode(record, sizeof record, &decoded,
                                     &destination) == ANC_PV_CUSTODY_OK);
  CHECK(decoded.record_version == ANC_PV_CUSTODY_LEGACY_VERSION);
  CHECK(decoded.authority_anchor_present && !decoded.expected_edge_present);

  memset(record + 752, 0, 8);
  CHECK(recompute_checksum(record) == 0);
  CHECK(anc_pv_custody_record_decode(record, sizeof record, &decoded,
                                     &destination) ==
        ANC_PV_CUSTODY_INVALID_RECORD);

  CHECK(make_active(&snapshot, &secrets) == 0);
  snapshot.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  snapshot.pending_kind = ANC_PV_CUSTODY_PENDING_GENESIS;
  snapshot.rotation_phase = ANC_PV_CUSTODY_ROTATION_PREPARED;
  set_id(snapshot.ceremony_id, &snapshot.ceremony_id_length, "ceremony-1");
  snapshot.active_epoch = 0;
  memset(secrets.active_epoch_key, 0, 32);
  snapshot.pending_epoch = 1;
  fill(secrets.pending_epoch_key, 32, 0xd1);
  snapshot.recovery_generation = 0;
  snapshot.authority_anchor_present = 0;
  snapshot.anchored_sequence = 0;
  memset(snapshot.anchored_head, 0, 32);
  memset(snapshot.membership_digest, 0, 32);
  snapshot.signed_at_ms = 0;
  memset(snapshot.snapshot_digest, 0, 32);
  snapshot.freshness_ms = 0;
  snapshot.expected_edge_present = 1;
  snapshot.expected_next_sequence = 0;
  memset(snapshot.expected_previous_head, 0, 32);
  fill(snapshot.pending_transcript_digest, 32, 0xe1);
  source = inputs(&secrets);
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, record,
                                     sizeof record) == ANC_PV_CUSTODY_OK);
  CHECK(record[13] == ANC_PV_CUSTODY_FLAG_EXPECTED_EDGE_PRESENT);
  CHECK(anc_pv_custody_record_decode(record, sizeof record, &decoded,
                                     &destination) == ANC_PV_CUSTODY_OK);
  CHECK(!decoded.authority_anchor_present && decoded.expected_edge_present &&
        decoded.expected_next_sequence == 0);
  return 0;
}

static int test_rejections_and_zeroization(void) {
  AncPrivateVaultCustodySnapshot snapshot;
  TestSecrets secrets;
  CHECK(make_active(&snapshot, &secrets) == 0);
  AncPrivateVaultCustodySecretInputs source = inputs(&secrets);
  uint8_t record[1088] = {0};
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, record,
                                     sizeof record) == ANC_PV_CUSTODY_OK);
  AncPrivateVaultCustodySnapshot decoded;
  TestSecrets decoded_secrets;
  AncPrivateVaultCustodySecretOutputs destination = outputs(&decoded_secrets);

  uint8_t corrupt[1088];
  memcpy(corrupt, record, sizeof corrupt);
  corrupt[800] ^= 1;
  memset(&decoded, 0xa5, sizeof decoded);
  memset(&decoded_secrets, 0xa5, sizeof decoded_secrets);
  CHECK(anc_pv_custody_record_decode(corrupt, sizeof corrupt, &decoded,
                                     &destination) ==
        ANC_PV_CUSTODY_CHECKSUM_FAILED);
  CHECK(all_zero(&decoded, sizeof decoded));
  CHECK(all_zero(&decoded_secrets, sizeof decoded_secrets));

  memcpy(corrupt, record, sizeof corrupt);
  corrupt[35] = 0;
  corrupt[36] = 'x';
  CHECK(recompute_checksum(corrupt) == 0);
  CHECK(anc_pv_custody_record_decode(corrupt, sizeof corrupt, &decoded,
                                     &destination) ==
        ANC_PV_CUSTODY_INVALID_RECORD);
  memcpy(corrupt, record, sizeof corrupt);
  corrupt[24] = 0xc0;
  corrupt[25] = 0xaf;
  CHECK(recompute_checksum(corrupt) == 0);
  CHECK(anc_pv_custody_record_decode(corrupt, sizeof corrupt, &decoded,
                                     &destination) ==
        ANC_PV_CUSTODY_INVALID_RECORD);
  memcpy(corrupt, record, sizeof corrupt);
  corrupt[12] = 1;
  CHECK(recompute_checksum(corrupt) == 0);
  CHECK(anc_pv_custody_record_decode(corrupt, sizeof corrupt, &decoded,
                                     &destination) ==
        ANC_PV_CUSTODY_INVALID_RECORD);
  memcpy(corrupt, record, sizeof corrupt);
  corrupt[1030] = 1;
  CHECK(recompute_checksum(corrupt) == 0);
  CHECK(anc_pv_custody_record_decode(corrupt, sizeof corrupt, &decoded,
                                     &destination) ==
        ANC_PV_CUSTODY_INVALID_RECORD);
  memcpy(corrupt, record, sizeof corrupt);
  corrupt[8] = 99;
  CHECK(recompute_checksum(corrupt) == 0);
  CHECK(anc_pv_custody_record_decode(corrupt, sizeof corrupt, &decoded,
                                     &destination) ==
        ANC_PV_CUSTODY_INVALID_RECORD);
  const size_t invalid_header_or_enum_offsets[] = {0, 5, 7, 9, 10, 11, 12};
  for (size_t index = 0; index < sizeof invalid_header_or_enum_offsets /
                                     sizeof invalid_header_or_enum_offsets[0];
       index += 1) {
    memcpy(corrupt, record, sizeof corrupt);
    corrupt[invalid_header_or_enum_offsets[index]] = 0xff;
    CHECK(recompute_checksum(corrupt) == 0);
    CHECK(anc_pv_custody_record_decode(corrupt, sizeof corrupt, &decoded,
                                       &destination) ==
          ANC_PV_CUSTODY_INVALID_RECORD);
  }
  CHECK(anc_pv_custody_record_decode(record, sizeof record - 1, &decoded,
                                     &destination) ==
        ANC_PV_CUSTODY_INVALID_ARGUMENT);

  snapshot.signing_public_key[0] ^= 1;
  uint8_t failed_output[1088];
  memset(failed_output, 0xa5, sizeof failed_output);
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, failed_output,
                                     sizeof failed_output) ==
        ANC_PV_CUSTODY_INVALID_RECORD);
  CHECK(all_zero(failed_output, sizeof failed_output));
  return 0;
}

static int test_state_matrices_and_boundaries(void) {
  AncPrivateVaultCustodySnapshot snapshot;
  TestSecrets secrets;
  CHECK(make_active(&snapshot, &secrets) == 0);
  AncPrivateVaultCustodySecretInputs source = inputs(&secrets);
  uint8_t record[1088] = {0};

  snapshot.pending_kind = ANC_PV_CUSTODY_PENDING_ADD_DEVICE;
  snapshot.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  snapshot.rotation_phase = ANC_PV_CUSTODY_ROTATION_NONE;
  snapshot.enrollment_phase = ANC_PV_CUSTODY_ENROLLMENT_OFFER_PENDING;
  set_id(snapshot.ceremony_id, &snapshot.ceremony_id_length, "ceremony-1");
  snapshot.active_epoch = 0;
  anc_pv_zeroize(secrets.active_epoch_key, 32);
  snapshot.anchored_sequence = 0;
  snapshot.authority_anchor_present = 0;
  anc_pv_zeroize(snapshot.anchored_head, 32);
  anc_pv_zeroize(snapshot.membership_digest, 32);
  snapshot.signed_at_ms = 0;
  anc_pv_zeroize(snapshot.snapshot_digest, 32);
  snapshot.freshness_ms = 0;
  CHECK(snapshot.recovery_generation != 0);
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);
  snapshot.recovery_generation = 0;
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, record,
                                     sizeof record) == ANC_PV_CUSTODY_OK);
  AncPrivateVaultCustodySnapshot offer_after_crash;
  TestSecrets offer_secrets_after_crash;
  AncPrivateVaultCustodySecretOutputs offer_outputs =
      outputs(&offer_secrets_after_crash);
  CHECK(anc_pv_custody_record_decode(record, sizeof record, &offer_after_crash,
                                     &offer_outputs) == ANC_PV_CUSTODY_OK);
  CHECK(offer_after_crash.enrollment_phase ==
        ANC_PV_CUSTODY_ENROLLMENT_OFFER_PENDING);
  CHECK(memcmp(offer_secrets_after_crash.signing_seed, secrets.signing_seed,
               32) == 0);
  CHECK(memcmp(offer_secrets_after_crash.box_seed, secrets.box_seed, 32) == 0);
  CHECK(memcmp(offer_secrets_after_crash.local_state_key,
               secrets.local_state_key, 32) == 0);

  CHECK(make_active(&snapshot, &secrets) == 0);
  source = inputs(&secrets);
  snapshot.pending_kind = ANC_PV_CUSTODY_PENDING_ADD_DEVICE;
  snapshot.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  snapshot.rotation_phase = ANC_PV_CUSTODY_ROTATION_NONE;
  snapshot.enrollment_phase = ANC_PV_CUSTODY_ENROLLMENT_AUTHORIZATION_RECEIVED;
  set_id(snapshot.ceremony_id, &snapshot.ceremony_id_length, "ceremony-1");
  snapshot.expected_next_sequence = snapshot.anchored_sequence + 1;
  snapshot.expected_edge_present = 1;
  memcpy(snapshot.expected_previous_head, snapshot.anchored_head, 32);
  fill(snapshot.pending_transcript_digest, 32, 17);
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, record,
                                     sizeof record) == ANC_PV_CUSTODY_OK);
  CHECK(snapshot.active_epoch == 7);
  snapshot.role = ANC_PV_CUSTODY_ROLE_BROKER;
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);
  snapshot.pending_kind = ANC_PV_CUSTODY_PENDING_ADD_BROKER;
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, record,
                                     sizeof record) == ANC_PV_CUSTODY_OK);
  snapshot.pending_kind = ANC_PV_CUSTODY_PENDING_ADD_DEVICE;
  snapshot.role = ANC_PV_CUSTODY_ROLE_ENDPOINT;
  snapshot.pending_epoch = snapshot.active_epoch + 1;
  fill(secrets.pending_epoch_key, 32, 222);
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);
  snapshot.pending_epoch = 0;
  anc_pv_zeroize(secrets.pending_epoch_key, 32);
  snapshot.rotation_phase = ANC_PV_CUSTODY_ROTATION_PREPARED;
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);

  CHECK(make_active(&snapshot, &secrets) == 0);
  source = inputs(&secrets);
  snapshot.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  snapshot.pending_kind = ANC_PV_CUSTODY_PENDING_RECOVERY;
  snapshot.rotation_phase = ANC_PV_CUSTODY_ROTATION_PREPARED;
  set_id(snapshot.ceremony_id, &snapshot.ceremony_id_length, "recovery-1");
  anc_pv_zeroize(secrets.active_epoch_key, 32);
  snapshot.pending_epoch = snapshot.active_epoch + 1;
  fill(secrets.pending_epoch_key, 32, 222);
  snapshot.expected_next_sequence = snapshot.anchored_sequence + 1;
  snapshot.expected_edge_present = 1;
  memcpy(snapshot.expected_previous_head, snapshot.anchored_head, 32);
  fill(snapshot.pending_transcript_digest, 32, 18);
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, record,
                                     sizeof record) == ANC_PV_CUSTODY_OK);
  snapshot.role = ANC_PV_CUSTODY_ROLE_BROKER;
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);
  snapshot.role = ANC_PV_CUSTODY_ROLE_ENDPOINT;
  secrets.active_epoch_key[0] = 1;
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);

  CHECK(make_active(&snapshot, &secrets) == 0);
  source = inputs(&secrets);
  snapshot.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
  snapshot.pending_kind = ANC_PV_CUSTODY_PENDING_GENESIS;
  snapshot.rotation_phase = ANC_PV_CUSTODY_ROTATION_PREPARED;
  set_id(snapshot.ceremony_id, &snapshot.ceremony_id_length, "genesis-1");
  snapshot.active_epoch = 0;
  anc_pv_zeroize(secrets.active_epoch_key, 32);
  snapshot.pending_epoch = 1;
  fill(secrets.pending_epoch_key, 32, 223);
  snapshot.anchored_sequence = 0;
  snapshot.authority_anchor_present = 0;
  anc_pv_zeroize(snapshot.anchored_head, 32);
  anc_pv_zeroize(snapshot.membership_digest, 32);
  snapshot.signed_at_ms = 0;
  anc_pv_zeroize(snapshot.snapshot_digest, 32);
  snapshot.freshness_ms = 0;
  snapshot.expected_edge_present = 1;
  snapshot.expected_next_sequence = 0;
  anc_pv_zeroize(snapshot.expected_previous_head, 32);
  fill(snapshot.pending_transcript_digest, 32, 19);
  snapshot.recovery_generation = 0;
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, record,
                                     sizeof record) == ANC_PV_CUSTODY_OK);
  snapshot.expected_edge_present = 0;
  anc_pv_zeroize(snapshot.pending_transcript_digest, 32);
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);
  snapshot.expected_edge_present = 1;
  fill(snapshot.pending_transcript_digest, 32, 19);
  snapshot.role = ANC_PV_CUSTODY_ROLE_BROKER;
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);
  snapshot.role = ANC_PV_CUSTODY_ROLE_ENDPOINT;

  CHECK(make_active(&snapshot, &secrets) == 0);
  source = inputs(&secrets);
  snapshot.custody_generation = 9007199254740992ULL;
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);
  snapshot.custody_generation = 1;
  memset(snapshot.vault_id, 'v', sizeof snapshot.vault_id);
  snapshot.vault_id_length = sizeof snapshot.vault_id;
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, record,
                                     sizeof record) == ANC_PV_CUSTODY_OK);
  snapshot.vault_id[159] = 0;
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);
  snapshot.vault_id[159] = 'v';
  snapshot.vault_id_length = 159;
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);

  CHECK(make_active(&snapshot, &secrets) == 0);
  source = inputs(&secrets);
  snapshot.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_REMOVING;
  snapshot.active_epoch = 0;
  anc_pv_zeroize(secrets.signing_seed, 32);
  anc_pv_zeroize(secrets.box_seed, 32);
  anc_pv_zeroize(secrets.local_state_key, 32);
  anc_pv_zeroize(secrets.active_epoch_key, 32);
  snapshot.removal_sequence = 10;
  fill(snapshot.removal_head, 32, 44);
  fill(snapshot.removal_authorization_digest, 32, 88);
  snapshot.removal_time_ms = 1700000001999ULL;
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, record,
                                     sizeof record) == ANC_PV_CUSTODY_OK);
  snapshot.expected_next_sequence = 1;
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);
  snapshot.expected_next_sequence = 0;
  snapshot.expected_previous_head[0] = 1;
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);
  snapshot.expected_previous_head[0] = 0;
  snapshot.pending_transcript_digest[0] = 1;
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);
  snapshot.pending_transcript_digest[0] = 0;
  snapshot.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_REMOVED;
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, record,
                                     sizeof record) == ANC_PV_CUSTODY_OK);
  secrets.local_state_key[0] = 1;
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);
  return 0;
}

static int test_independent_random_material(void) {
  AncPrivateVaultCustodySnapshot first;
  AncPrivateVaultCustodySnapshot second;
  TestSecrets first_secrets;
  TestSecrets second_secrets;
  CHECK(make_active(&first, &first_secrets) == 0);
  CHECK(make_active(&second, &second_secrets) == 0);
  CHECK(anc_pv_random(second_secrets.signing_seed, 32) == ANC_PV_CRYPTO_OK);
  CHECK(anc_pv_random(second_secrets.box_seed, 32) == ANC_PV_CRYPTO_OK);
  CHECK(anc_pv_random(second_secrets.local_state_key, 32) == ANC_PV_CRYPTO_OK);
  CHECK(anc_pv_random(second_secrets.active_epoch_key, 32) == ANC_PV_CRYPTO_OK);
  uint8_t signing_private[64] = {0};
  uint8_t box_private[32] = {0};
  CHECK(anc_pv_ed25519_seed_keypair(second.signing_public_key, signing_private,
                                    second_secrets.signing_seed) ==
        ANC_PV_CRYPTO_OK);
  CHECK(anc_pv_box_seed_keypair(second.box_public_key, box_private,
                                second_secrets.box_seed) == ANC_PV_CRYPTO_OK);
  anc_pv_zeroize(signing_private, sizeof signing_private);
  anc_pv_zeroize(box_private, sizeof box_private);
  AncPrivateVaultCustodySecretInputs first_inputs = inputs(&first_secrets);
  AncPrivateVaultCustodySecretInputs second_inputs = inputs(&second_secrets);
  uint8_t first_record[1088] = {0};
  uint8_t second_record[1088] = {0};
  CHECK(anc_pv_custody_record_encode(&first, &first_inputs, first_record,
                                     sizeof first_record) == ANC_PV_CUSTODY_OK);
  CHECK(anc_pv_custody_record_encode(&second, &second_inputs, second_record,
                                     sizeof second_record) ==
        ANC_PV_CUSTODY_OK);
  CHECK(memcmp(first_record, second_record, sizeof first_record) != 0);
  return 0;
}

static int test_alias_rejections(void) {
  AncPrivateVaultCustodySnapshot snapshot;
  TestSecrets secrets;
  CHECK(make_active(&snapshot, &secrets) == 0);
  AncPrivateVaultCustodySecretInputs source = inputs(&secrets);
  uint8_t record[1088];

  memset(record, 0xa5, sizeof record);
  uint8_t record_sentinel[1088];
  memcpy(record_sentinel, record, sizeof record_sentinel);
  source.signing_seed = record + 64;
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);
  CHECK(memcmp(record, record_sentinel, sizeof record) == 0);

  source = inputs(&secrets);
  source.box_seed = source.signing_seed;
  memset(record, 0xa5, sizeof record);
  CHECK(
      anc_pv_custody_record_encode(&snapshot, &source, record, sizeof record) ==
      ANC_PV_CUSTODY_INVALID_ARGUMENT);
  CHECK(all_zero(record, sizeof record));
  CHECK(!all_zero(secrets.signing_seed, 32));

  uint8_t aliased_snapshot_storage[1088];
  memset(aliased_snapshot_storage, 0xa5, sizeof aliased_snapshot_storage);
  uint8_t aliased_snapshot_sentinel[1088];
  memcpy(aliased_snapshot_sentinel, aliased_snapshot_storage,
         sizeof aliased_snapshot_sentinel);
  AncPrivateVaultCustodySnapshot *aliased_snapshot =
      (AncPrivateVaultCustodySnapshot *)(void *)(aliased_snapshot_storage + 16);
  source = inputs(&secrets);
  CHECK(anc_pv_custody_record_encode(aliased_snapshot, &source,
                                     aliased_snapshot_storage,
                                     sizeof aliased_snapshot_storage) ==
        ANC_PV_CUSTODY_INVALID_ARGUMENT);
  CHECK(memcmp(aliased_snapshot_storage, aliased_snapshot_sentinel,
               sizeof aliased_snapshot_storage) == 0);

  source = inputs(&secrets);
  CHECK(anc_pv_custody_record_encode(&snapshot, &source, record,
                                     sizeof record) == ANC_PV_CUSTODY_OK);
  uint8_t pristine[1088];
  memcpy(pristine, record, sizeof pristine);

  AncPrivateVaultCustodySnapshot decoded;
  TestSecrets decoded_secrets;
  memset(&decoded, 0xa5, sizeof decoded);
  memset(&decoded_secrets, 0xa5, sizeof decoded_secrets);
  AncPrivateVaultCustodySecretOutputs destination = outputs(&decoded_secrets);
  destination.signing_seed = record + 100;
  CHECK(anc_pv_custody_record_decode(record, sizeof record, &decoded,
                                     &destination) ==
        ANC_PV_CUSTODY_INVALID_ARGUMENT);
  CHECK(all_zero(&decoded, sizeof decoded));
  CHECK(memcmp(record, pristine, sizeof record) == 0);
  CHECK(all_zero(decoded_secrets.box_seed, 32));
  CHECK(all_zero(decoded_secrets.local_state_key, 32));

  memcpy(record, pristine, sizeof record);
  memset(&decoded_secrets, 0xa5, sizeof decoded_secrets);
  destination = outputs(&decoded_secrets);
  aliased_snapshot = (AncPrivateVaultCustodySnapshot *)(void *)(record + 16);
  CHECK(anc_pv_custody_record_decode(record, sizeof record, aliased_snapshot,
                                     &destination) ==
        ANC_PV_CUSTODY_INVALID_ARGUMENT);
  CHECK(memcmp(record, pristine, sizeof record) == 0);
  CHECK(all_zero(&decoded_secrets, sizeof decoded_secrets));

  memcpy(record, pristine, sizeof record);
  memset(&decoded, 0xa5, sizeof decoded);
  AncPrivateVaultCustodySecretOutputs *descriptor_in_record =
      (AncPrivateVaultCustodySecretOutputs *)(void *)(record + 64);
  CHECK(anc_pv_custody_record_decode(record, sizeof record, &decoded,
                                     descriptor_in_record) ==
        ANC_PV_CUSTODY_INVALID_ARGUMENT);
  CHECK(memcmp(record, pristine, sizeof record) == 0);
  CHECK(all_zero(&decoded, sizeof decoded));

  memcpy(record, pristine, sizeof record);
  memset(&decoded, 0xa5, sizeof decoded);
  memset(&decoded_secrets, 0xa5, sizeof decoded_secrets);
  destination = outputs(&decoded_secrets);
  destination.box_seed = destination.signing_seed;
  CHECK(anc_pv_custody_record_decode(record, sizeof record, &decoded,
                                     &destination) ==
        ANC_PV_CUSTODY_INVALID_ARGUMENT);
  CHECK(all_zero(&decoded, sizeof decoded));
  CHECK(all_zero(decoded_secrets.signing_seed, 32));
  CHECK(all_zero(decoded_secrets.local_state_key, 32));
  CHECK(all_zero(decoded_secrets.active_epoch_key, 32));
  CHECK(all_zero(decoded_secrets.pending_epoch_key, 32));
  CHECK(memcmp(record, pristine, sizeof record) == 0);

  memcpy(record, pristine, sizeof record);
  memset(&decoded, 0xa5, sizeof decoded);
  memset(&decoded_secrets, 0xa5, sizeof decoded_secrets);
  destination = outputs(&decoded_secrets);
  destination.signing_seed = decoded.vault_id;
  CHECK(anc_pv_custody_record_decode(record, sizeof record, &decoded,
                                     &destination) ==
        ANC_PV_CUSTODY_INVALID_ARGUMENT);
  CHECK(all_zero(&decoded, sizeof decoded));
  CHECK(all_zero(decoded_secrets.box_seed, 32));
  CHECK(memcmp(record, pristine, sizeof record) == 0);
  return 0;
}

typedef struct GuardedTestState {
  int fail_malloc;
  int fail_mlock;
  int fail_noaccess_at;
  int fail_readwrite_at;
  int noaccess_calls;
  int readwrite_calls;
  int memzero_calls;
  int free_calls;
  int free_saw_zero;
  int free_ended_zero;
  size_t mlock_size;
  void *memory;
  size_t memory_size;
} GuardedTestState;

static GuardedTestState g_guarded;

static void reset_guarded(void) { memset(&g_guarded, 0, sizeof g_guarded); }

static void *test_malloc(size_t size) {
  if (g_guarded.fail_malloc)
    return NULL;
  g_guarded.memory = malloc(size);
  g_guarded.memory_size = size;
  memset(g_guarded.memory, 0xa5, size);
  return g_guarded.memory;
}

static int test_mlock(void *memory, size_t size) {
  CHECK(memory == g_guarded.memory);
  g_guarded.mlock_size = size;
  return g_guarded.fail_mlock ? -1 : 0;
}

static int test_noaccess(void *memory, __unused size_t size) {
  CHECK(memory == g_guarded.memory);
  g_guarded.noaccess_calls += 1;
  return g_guarded.fail_noaccess_at == g_guarded.noaccess_calls ? -1 : 0;
}

static int test_readwrite(void *memory, __unused size_t size) {
  CHECK(memory == g_guarded.memory);
  g_guarded.readwrite_calls += 1;
  return g_guarded.fail_readwrite_at == g_guarded.readwrite_calls ? -1 : 0;
}

static void test_memzero(void *memory, size_t size) {
  if (memory != g_guarded.memory)
    abort();
  g_guarded.memzero_calls += 1;
  memset(memory, 0, size);
}

static void test_free(void *memory) {
  if (memory != g_guarded.memory)
    abort();
  g_guarded.free_calls += 1;
  g_guarded.free_saw_zero = all_zero(memory, g_guarded.memory_size);
  if (!g_guarded.free_saw_zero)
    memset(memory, 0, g_guarded.memory_size);
  g_guarded.free_ended_zero = all_zero(memory, g_guarded.memory_size);
  free(memory);
  g_guarded.memory = NULL;
}

static AncPrivateVaultGuardedMemoryFunctions test_functions(void) {
  return (AncPrivateVaultGuardedMemoryFunctions){
      .malloc_fn = test_malloc,
      .mlock_fn = test_mlock,
      .mprotect_noaccess_fn = test_noaccess,
      .mprotect_readwrite_fn = test_readwrite,
      .memzero_fn = test_memzero,
      .free_fn = test_free,
  };
}

static int test_guarded_memory(void) {
  AncPrivateVaultGuardedMemoryFunctions functions = test_functions();
  AncPrivateVaultGuardedMemoryStatus status;

  reset_guarded();
  g_guarded.fail_malloc = 1;
  CHECK([AncPrivateVaultGuardedMemory memoryWithLength:32
                                             functions:&functions
                                                status:&status] == nil);
  CHECK(status == AncPrivateVaultGuardedMemoryStatusAllocationFailed);

  reset_guarded();
  g_guarded.fail_mlock = 1;
  CHECK([AncPrivateVaultGuardedMemory memoryWithLength:32
                                             functions:&functions
                                                status:&status] == nil);
  CHECK(status == AncPrivateVaultGuardedMemoryStatusProtectionFailed);
  CHECK(g_guarded.memzero_calls == 1 && g_guarded.free_saw_zero &&
        g_guarded.free_ended_zero);

  reset_guarded();
  g_guarded.fail_noaccess_at = 1;
  CHECK([AncPrivateVaultGuardedMemory memoryWithLength:32
                                             functions:&functions
                                                status:&status] == nil);
  CHECK(status == AncPrivateVaultGuardedMemoryStatusProtectionFailed);
  CHECK(g_guarded.memzero_calls == 0 && !g_guarded.free_saw_zero &&
        g_guarded.free_ended_zero);

  reset_guarded();
  AncPrivateVaultGuardedMemory *memory =
      [AncPrivateVaultGuardedMemory memoryWithLength:32
                                           functions:&functions
                                              status:&status];
  CHECK(memory != nil && status == AncPrivateVaultGuardedMemoryStatusOK);
  CHECK(g_guarded.mlock_size == 32 && g_guarded.noaccess_calls == 1);
  CHECK([memory borrow:^BOOL(uint8_t *bytes, size_t length) {
          CHECK(length == 32);
          fill(bytes, length, 10);
          return YES;
        }] == AncPrivateVaultGuardedMemoryStatusOK);
  CHECK(g_guarded.readwrite_calls == 1 && g_guarded.noaccess_calls == 2);
  CHECK([memory borrow:^BOOL(__unused uint8_t *bytes, __unused size_t length) {
          return NO;
        }] == AncPrivateVaultGuardedMemoryStatusCallbackFailed);
  CHECK(g_guarded.noaccess_calls == 3);
  CHECK([memory borrow:^BOOL(__unused uint8_t *bytes, __unused size_t length) {
          @throw [NSException exceptionWithName:@"test"
                                         reason:@"test"
                                       userInfo:nil];
        }] == AncPrivateVaultGuardedMemoryStatusCallbackFailed);
  CHECK(g_guarded.noaccess_calls == 4);
  CHECK([memory close] == AncPrivateVaultGuardedMemoryStatusOK);
  CHECK(g_guarded.memzero_calls == 1 && g_guarded.free_saw_zero &&
        g_guarded.free_calls == 1);
  CHECK([memory close] == AncPrivateVaultGuardedMemoryStatusOK);
  CHECK([memory borrow:^BOOL(__unused uint8_t *bytes, __unused size_t length) {
          return YES;
        }] == AncPrivateVaultGuardedMemoryStatusClosed);

  reset_guarded();
  g_guarded.fail_readwrite_at = 1;
  memory = [AncPrivateVaultGuardedMemory memoryWithLength:16
                                                functions:&functions
                                                   status:&status];
  CHECK([memory borrow:^BOOL(__unused uint8_t *bytes, __unused size_t length) {
          return YES;
        }] == AncPrivateVaultGuardedMemoryStatusProtectionFailed);
  CHECK(memory.closed && g_guarded.free_calls == 1 &&
        g_guarded.memzero_calls == 0 && !g_guarded.free_saw_zero &&
        g_guarded.free_ended_zero);

  reset_guarded();
  g_guarded.fail_noaccess_at = 2;
  memory = [AncPrivateVaultGuardedMemory memoryWithLength:16
                                                functions:&functions
                                                   status:&status];
  CHECK([memory borrow:^BOOL(uint8_t *bytes, size_t length) {
          fill(bytes, length, 1);
          return YES;
        }] == AncPrivateVaultGuardedMemoryStatusProtectionFailed);
  CHECK(memory.closed && g_guarded.free_calls == 1 &&
        g_guarded.memzero_calls == 1 && g_guarded.free_saw_zero);

  reset_guarded();
  g_guarded.fail_noaccess_at = 2;
  g_guarded.fail_readwrite_at = 2;
  memory = [AncPrivateVaultGuardedMemory memoryWithLength:16
                                                functions:&functions
                                                   status:&status];
  CHECK([memory borrow:^BOOL(__unused uint8_t *bytes, __unused size_t length) {
          @throw [NSException exceptionWithName:@"test"
                                         reason:@"test"
                                       userInfo:nil];
        }] == AncPrivateVaultGuardedMemoryStatusProtectionFailed);
  CHECK(memory.closed && g_guarded.free_calls == 1 &&
        g_guarded.memzero_calls == 0 && !g_guarded.free_saw_zero &&
        g_guarded.free_ended_zero);

  reset_guarded();
  g_guarded.fail_readwrite_at = 1;
  memory = [AncPrivateVaultGuardedMemory memoryWithLength:16
                                                functions:&functions
                                                   status:&status];
  CHECK([memory close] == AncPrivateVaultGuardedMemoryStatusProtectionFailed);
  CHECK(memory.closed && g_guarded.free_calls == 1 &&
        g_guarded.memzero_calls == 0 && !g_guarded.free_saw_zero &&
        g_guarded.free_ended_zero);

  reset_guarded();
  @autoreleasepool {
    AncPrivateVaultGuardedMemory *doomed =
        [AncPrivateVaultGuardedMemory memoryWithLength:16
                                             functions:&functions
                                                status:&status];
    CHECK(doomed != nil);
    g_guarded.fail_readwrite_at = 1;
    doomed = nil;
  }
  CHECK(g_guarded.free_calls == 1 && g_guarded.memzero_calls == 0 &&
        g_guarded.free_ended_zero);
  return 0;
}

static int test_real_guarded_memory(void) {
  AncPrivateVaultGuardedMemoryStatus status;
  AncPrivateVaultGuardedMemory *memory =
      [AncPrivateVaultGuardedMemory memoryWithLength:64 status:&status];
  CHECK(memory != nil && status == AncPrivateVaultGuardedMemoryStatusOK);
  CHECK([memory borrow:^BOOL(uint8_t *bytes, size_t length) {
          CHECK(length == 64);
          fill(bytes, length, 7);
          return YES;
        }] == AncPrivateVaultGuardedMemoryStatusOK);
  CHECK([memory close] == AncPrivateVaultGuardedMemoryStatusOK);
  CHECK(memory.closed);
  return 0;
}

int main(void) {
  @autoreleasepool {
    CHECK(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    CHECK(test_golden_layout_and_round_trip() == 0);
    CHECK(test_v2_presence_and_v1_compatibility() == 0);
    CHECK(test_rejections_and_zeroization() == 0);
    CHECK(test_state_matrices_and_boundaries() == 0);
    CHECK(test_independent_random_material() == 0);
    CHECK(test_alias_rejections() == 0);
    CHECK(test_guarded_memory() == 0);
    CHECK(test_real_guarded_memory() == 0);
    puts("private-vault custody codec and guarded-memory tests passed");
  }
  return 0;
}
