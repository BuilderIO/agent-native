#import <Foundation/Foundation.h>

#import "PrivateVaultGenesisPreparationRecord.h"

#include <string.h>

#define CHECK(condition, message)                                              \
  do {                                                                         \
    if (!(condition)) {                                                        \
      fprintf(stderr, "FAIL: %s\n", message);                                 \
      exit(1);                                                                 \
    }                                                                          \
  } while (0)

static void Fill(uint8_t *bytes, size_t length, uint8_t value) {
  memset(bytes, value, length);
}

static AncPrivateVaultGenesisPreparationSnapshot BaseSnapshot(void) {
  AncPrivateVaultGenesisPreparationSnapshot snapshot = {0};
  snapshot.phase = ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED;
  snapshot.generation = 1;
  snapshot.prepared_at_ms = 100000;
  snapshot.expires_at_ms = 200000;
  Fill(snapshot.preparation_lookup_id, 16, 1);
  Fill(snapshot.handle_digest, 32, 2);
  Fill(snapshot.vault_id, 16, 3);
  Fill(snapshot.ceremony_id, 16, 4);
  Fill(snapshot.endpoint_id, 16, 5);
  Fill(snapshot.recovery_wrap_envelope_id, 16, 6);
  Fill(snapshot.endpoint_envelope_id, 16, 7);
  Fill(snapshot.log_entry_envelope_id, 16, 8);
  Fill(snapshot.authorization_envelope_id, 16, 9);
  Fill(snapshot.recovery_wrap_nonce, 24, 10);
  Fill(snapshot.endpoint_signing_public_key, 32, 11);
  Fill(snapshot.endpoint_agreement_public_key, 32, 12);
  Fill(snapshot.recovery_id, 16, 13);
  Fill(snapshot.recovery_signing_public_key, 32, 14);
  Fill(snapshot.recovery_agreement_public_key, 32, 15);
  return snapshot;
}

static void BindArtifacts(AncPrivateVaultGenesisPreparationSnapshot *snapshot) {
  Fill(snapshot->recovery_wrap_hash, 32, 21);
  Fill(snapshot->recovery_confirmation_hash, 32, 22);
  Fill(snapshot->bootstrap_transcript_digest, 32, 23);
  Fill(snapshot->authorization_digest, 32, 24);
  Fill(snapshot->genesis_control_head_hash, 32, 25);
  Fill(snapshot->membership_hash, 32, 26);
  Fill(snapshot->artifact_spool_digest, 32, 27);
  snapshot->recovery_wrap_length = 100;
  snapshot->confirmation_length = 101;
  snapshot->bootstrap_length = 102;
  snapshot->authorization_length = 103;
}

static AncPrivateVaultGenesisPreparationSecretInputs SecretInputs(
    const uint8_t secrets[5][32]) {
  AncPrivateVaultGenesisPreparationSecretInputs inputs = {
      .recovery_entropy = secrets[0],
      .endpoint_signing_seed = secrets[1],
      .endpoint_agreement_seed = secrets[2],
      .local_state_key = secrets[3],
      .epoch_one_eek = secrets[4],
  };
  return inputs;
}

static void Encode(const AncPrivateVaultGenesisPreparationSnapshot *snapshot,
                   const uint8_t secrets[5][32], uint8_t record[1024]) {
  AncPrivateVaultGenesisPreparationSecretInputs inputs = SecretInputs(secrets);
  AncPrivateVaultGenesisPreparationRecordStatus status =
      anc_pv_genesis_preparation_record_encode(snapshot, &inputs, record, 1024);
  if (status != ANC_PV_GENESIS_PREPARATION_OK) {
    fprintf(stderr, "encode status: %s phase=%u flags=%u generation=%llu\n",
            anc_pv_genesis_preparation_status_category(status), snapshot->phase,
            snapshot->flags, snapshot->generation);
  }
  CHECK(status == ANC_PV_GENESIS_PREPARATION_OK, "encode record");
}

int main(void) {
  @autoreleasepool {
    uint8_t secrets[5][32];
    memset(secrets, 0x44, sizeof(secrets));
    uint8_t zeroSecrets[5][32] = {{0}};

    AncPrivateVaultGenesisPreparationSnapshot prepared = BaseSnapshot();
    uint8_t preparedRecord[1024] = {0};
    Encode(&prepared, secrets, preparedRecord);

    AncPrivateVaultGenesisPreparationSnapshot decoded = {0};
    CHECK(anc_pv_genesis_preparation_record_decode_public(
              preparedRecord, sizeof(preparedRecord), &decoded) ==
              ANC_PV_GENESIS_PREPARATION_OK &&
              decoded.phase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED,
          "public-only decode");

    AncPrivateVaultGenesisPreparationSnapshot confirmed = prepared;
    confirmed.phase = ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED;
    confirmed.flags = ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND;
    confirmed.generation = 2;
    confirmed.confirmed_at_ms = 150000;
    confirmed.recovery_wrap_created_at_seconds = 150;
    confirmed.endpoint_created_at_seconds = 150;
    confirmed.log_entry_created_at_seconds = 150;
    confirmed.authorization_created_at_seconds = 150;
    BindArtifacts(&confirmed);
    uint8_t confirmedRecord[1024] = {0};
    Encode(&confirmed, secrets, confirmedRecord);
    CHECK(anc_pv_genesis_preparation_transition_validate(
              preparedRecord, 1024, confirmedRecord, 1024) ==
              ANC_PV_GENESIS_PREPARATION_OK,
          "prepared to confirmed");

    AncPrivateVaultGenesisPreparationSnapshot live = confirmed;
    live.flags |= ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE;
    live.generation = 3;
    uint8_t liveRecord[1024] = {0};
    Encode(&live, secrets, liveRecord);
    CHECK(anc_pv_genesis_preparation_transition_validate(
              confirmedRecord, 1024, liveRecord, 1024) ==
              ANC_PV_GENESIS_PREPARATION_OK,
          "confirmed promotion transition");

    AncPrivateVaultGenesisPreparationSnapshot committing = live;
    committing.phase = ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING;
    committing.generation = 4;
    uint8_t committingRecord[1024] = {0};
    Encode(&committing, secrets, committingRecord);

    AncPrivateVaultGenesisPreparationSnapshot custody = committing;
    custody.flags |= ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND;
    custody.generation = 5;
    Fill(custody.custody_record_digest, 32, 31);
    uint8_t custodyRecord[1024] = {0};
    Encode(&custody, secrets, custodyRecord);
    CHECK(anc_pv_genesis_preparation_transition_validate(
              committingRecord, 1024, custodyRecord, 1024) ==
              ANC_PV_GENESIS_PREPARATION_OK,
          "committing custody bind");

    AncPrivateVaultGenesisPreparationSnapshot cancelled = custody;
    cancelled.phase = ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED;
    cancelled.generation = 6;
    cancelled.terminal_at_ms = 160000;
    Fill(cancelled.custody_record_digest, 32, 32);
    uint8_t cancelledRecord[1024] = {0};
    Encode(&cancelled, zeroSecrets, cancelledRecord);
    CHECK(anc_pv_genesis_preparation_transition_validate(
              custodyRecord, 1024, cancelledRecord, 1024) ==
              ANC_PV_GENESIS_PREPARATION_OK,
          "cancellation replaces pending custody with tombstone");

    AncPrivateVaultGenesisPreparationSnapshot retainedCustody = cancelled;
    retainedCustody.generation = 6;
    memcpy(retainedCustody.custody_record_digest,
           custody.custody_record_digest, 32);
    uint8_t retainedCustodyRecord[1024] = {0};
    Encode(&retainedCustody, zeroSecrets, retainedCustodyRecord);
    CHECK(anc_pv_genesis_preparation_transition_validate(
              custodyRecord, 1024, retainedCustodyRecord, 1024) ==
              ANC_PV_GENESIS_PREPARATION_SUBSTITUTION,
          "cancellation cannot retain pending custody digest");

    AncPrivateVaultGenesisPreparationSnapshot committed = custody;
    committed.phase = ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED;
    committed.flags |=
        ANC_PV_GENESIS_PREPARATION_FLAG_OFFICIAL_AUTHORITY_BOUND;
    committed.generation = 6;
    committed.terminal_at_ms = 160000;
    Fill(committed.official_authority_g2_frame_digest, 32, 33);
    uint8_t committedRecord[1024] = {0};
    Encode(&committed, zeroSecrets, committedRecord);

    AncPrivateVaultGenesisPreparationSnapshot receipt = committed;
    receipt.flags |= ANC_PV_GENESIS_PREPARATION_FLAG_HOSTED_RECEIPT_BOUND;
    receipt.generation = 7;
    Fill(receipt.hosted_recovery_receipt_digest, 32, 34);
    uint8_t receiptRecord[1024] = {0};
    Encode(&receipt, zeroSecrets, receiptRecord);
    CHECK(anc_pv_genesis_preparation_transition_validate(
              committedRecord, 1024, receiptRecord, 1024) ==
              ANC_PV_GENESIS_PREPARATION_OK,
          "receipt binds while artifacts remain live");

    AncPrivateVaultGenesisPreparationSnapshot rewrittenTerminal = receipt;
    rewrittenTerminal.generation = 8;
    rewrittenTerminal.terminal_at_ms++;
    uint8_t rewrittenTerminalRecord[1024] = {0};
    Encode(&rewrittenTerminal, zeroSecrets, rewrittenTerminalRecord);
    CHECK(anc_pv_genesis_preparation_transition_validate(
              receiptRecord, 1024, rewrittenTerminalRecord, 1024) ==
              ANC_PV_GENESIS_PREPARATION_SUBSTITUTION,
          "terminal timestamp immutable");

    AncPrivateVaultGenesisPreparationSnapshot invalidTerminal = committed;
    invalidTerminal.terminal_at_ms = invalidTerminal.confirmed_at_ms - 1;
    uint8_t invalidRecord[1024];
    memset(invalidRecord, 0x5a, sizeof(invalidRecord));
    AncPrivateVaultGenesisPreparationSecretInputs zeroInputs =
        SecretInputs(zeroSecrets);
    CHECK(anc_pv_genesis_preparation_record_encode(
              &invalidTerminal, &zeroInputs, invalidRecord, 1024) ==
              ANC_PV_GENESIS_PREPARATION_RANGE_TIMESTAMP,
          "terminal cannot precede confirmation");
    CHECK(memcmp(invalidRecord, (uint8_t[1024]){0}, 1024) == 0,
          "failed encode clears disjoint output");

    AncPrivateVaultGenesisPreparationSnapshot expired = prepared;
    expired.phase = ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED;
    expired.flags = ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED;
    expired.generation = 2;
    expired.terminal_at_ms = expired.expires_at_ms;
    CHECK(anc_pv_genesis_preparation_record_encode(
              &expired, &zeroInputs, invalidRecord, 1024) ==
              ANC_PV_GENESIS_PREPARATION_RANGE_TIMESTAMP,
          "expiry must occur after deadline");

    uint8_t encodeSentinel[1024];
    memset(encodeSentinel, 0x5a, sizeof(encodeSentinel));
    AncPrivateVaultGenesisPreparationSecretInputs aliasInputs =
        SecretInputs(secrets);
    aliasInputs.recovery_entropy = encodeSentinel + 64;
    CHECK(anc_pv_genesis_preparation_record_encode(
              &prepared, &aliasInputs, encodeSentinel, 1024) ==
              ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT &&
              encodeSentinel[0] == 0x5a,
          "encode alias rejected before output write");

    _Alignas(AncPrivateVaultGenesisPreparationSecretInputs)
        uint8_t descriptorRecord[1024];
    memset(descriptorRecord, 0x5a, sizeof(descriptorRecord));
    AncPrivateVaultGenesisPreparationSecretInputs *inputDescriptorInRecord =
        (AncPrivateVaultGenesisPreparationSecretInputs *)(descriptorRecord + 64);
    *inputDescriptorInRecord = SecretInputs(secrets);
    NSData *descriptorRecordOriginal =
        [NSData dataWithBytes:descriptorRecord length:sizeof(descriptorRecord)];
    CHECK(anc_pv_genesis_preparation_record_encode(
              &prepared, inputDescriptorInRecord, descriptorRecord,
              sizeof(descriptorRecord)) ==
                  ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT &&
              memcmp(descriptorRecord, descriptorRecordOriginal.bytes,
                     sizeof(descriptorRecord)) == 0,
          "input descriptor inside record rejected untouched");

    AncPrivateVaultGenesisPreparationSnapshot descriptorSnapshot = prepared;
    AncPrivateVaultGenesisPreparationSecretInputs *inputDescriptorInSnapshot =
        (AncPrivateVaultGenesisPreparationSecretInputs *)(void *)
            descriptorSnapshot.recovery_wrap_hash;
    *inputDescriptorInSnapshot = SecretInputs(secrets);
    AncPrivateVaultGenesisPreparationSnapshot descriptorSnapshotOriginal =
        descriptorSnapshot;
    CHECK(anc_pv_genesis_preparation_record_encode(
              &descriptorSnapshot, inputDescriptorInSnapshot, encodeSentinel,
              sizeof(encodeSentinel)) ==
                  ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT &&
              memcmp(&descriptorSnapshot, &descriptorSnapshotOriginal,
                     sizeof(descriptorSnapshot)) == 0,
          "input descriptor inside snapshot rejected untouched");

    NSMutableData *aliasRecord =
        [NSMutableData dataWithBytes:preparedRecord length:1024];
    NSData *aliasOriginal = [aliasRecord copy];
    uint8_t outputSecrets[5][32];
    memset(outputSecrets, 0x5a, sizeof(outputSecrets));
    AncPrivateVaultGenesisPreparationSecretOutputs outputs = {
        .recovery_entropy = aliasRecord.mutableBytes,
        .endpoint_signing_seed = outputSecrets[1],
        .endpoint_agreement_seed = outputSecrets[2],
        .local_state_key = outputSecrets[3],
        .epoch_one_eek = outputSecrets[4],
    };
    AncPrivateVaultGenesisPreparationSnapshot aliasSnapshot;
    memset(&aliasSnapshot, 0x5a, sizeof(aliasSnapshot));
    CHECK(anc_pv_genesis_preparation_record_decode(
              aliasRecord.bytes, 1024, &aliasSnapshot, &outputs) ==
              ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT &&
              [aliasRecord isEqualToData:aliasOriginal] &&
              ((uint8_t *)&aliasSnapshot)[0] == 0x5a &&
              outputSecrets[1][0] == 0x5a,
          "decode alias leaves all destinations untouched");

    _Alignas(AncPrivateVaultGenesisPreparationSecretOutputs)
        uint8_t decodeDescriptorRecord[1024];
    memcpy(decodeDescriptorRecord, preparedRecord,
           sizeof(decodeDescriptorRecord));
    AncPrivateVaultGenesisPreparationSecretOutputs *outputDescriptorInRecord =
        (AncPrivateVaultGenesisPreparationSecretOutputs *)(
            decodeDescriptorRecord + 400);
    *outputDescriptorInRecord = (AncPrivateVaultGenesisPreparationSecretOutputs){
        .recovery_entropy = outputSecrets[0],
        .endpoint_signing_seed = outputSecrets[1],
        .endpoint_agreement_seed = outputSecrets[2],
        .local_state_key = outputSecrets[3],
        .epoch_one_eek = outputSecrets[4],
    };
    NSData *decodeDescriptorOriginal = [NSData
        dataWithBytes:decodeDescriptorRecord
               length:sizeof(decodeDescriptorRecord)];
    memset(&aliasSnapshot, 0x5a, sizeof(aliasSnapshot));
    CHECK(anc_pv_genesis_preparation_record_decode(
              decodeDescriptorRecord, sizeof(decodeDescriptorRecord),
              &aliasSnapshot, outputDescriptorInRecord) ==
                  ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT &&
              memcmp(decodeDescriptorRecord, decodeDescriptorOriginal.bytes,
                     sizeof(decodeDescriptorRecord)) == 0 &&
              ((uint8_t *)&aliasSnapshot)[0] == 0x5a,
          "output descriptor inside record rejected untouched");

    memset(&aliasSnapshot, 0x5a, sizeof(aliasSnapshot));
    AncPrivateVaultGenesisPreparationSecretOutputs *outputDescriptorInSnapshot =
        (AncPrivateVaultGenesisPreparationSecretOutputs *)(void *)
            aliasSnapshot.recovery_wrap_hash;
    *outputDescriptorInSnapshot =
        (AncPrivateVaultGenesisPreparationSecretOutputs){
            .recovery_entropy = outputSecrets[0],
            .endpoint_signing_seed = outputSecrets[1],
            .endpoint_agreement_seed = outputSecrets[2],
            .local_state_key = outputSecrets[3],
            .epoch_one_eek = outputSecrets[4],
        };
    AncPrivateVaultGenesisPreparationSnapshot aliasSnapshotOriginal =
        aliasSnapshot;
    CHECK(anc_pv_genesis_preparation_record_decode(
              preparedRecord, sizeof(preparedRecord), &aliasSnapshot,
              outputDescriptorInSnapshot) ==
                  ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT &&
              memcmp(&aliasSnapshot, &aliasSnapshotOriginal,
                     sizeof(aliasSnapshot)) == 0,
          "output descriptor inside snapshot rejected untouched");

    uint8_t handle[48];
    memset(handle, 0x55, sizeof(handle));
    CHECK(anc_pv_genesis_preparation_handle_digest(
              handle, sizeof(handle), handle + 8) ==
              ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT &&
              handle[8] == 0x55,
          "handle digest alias rejected untouched");
  }
  fprintf(stdout, "PASS: genesis preparation record tests\n");
  return 0;
}
