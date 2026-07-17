#import <Foundation/Foundation.h>

#import "PrivateVaultRotationPreparationRecord.h"

#include <string.h>

#define CHECK(condition, message)                                              \
  do {                                                                         \
    if (!(condition)) {                                                        \
      fprintf(stderr, "FAIL: %s\n", message);                                  \
      exit(1);                                                                 \
    }                                                                          \
  } while (0)

static const uint8_t kChecksumDomain[] =
    "agent-native/private-vault/rotation-preparation/checksum/anc-v1";
static const uint8_t kDerivationDomain[] =
    "agent-native/private-vault/rotation-preparation/test-derivation/anc-v1";

static NSData *Hex(NSString *value) {
  if (value.length % 2 != 0)
    return nil;
  NSMutableData *data = [NSMutableData dataWithLength:value.length / 2];
  uint8_t *bytes = data.mutableBytes;
  for (NSUInteger index = 0; index < value.length; index += 2) {
    NSString *pair = [value substringWithRange:NSMakeRange(index, 2)];
    NSScanner *scanner = [NSScanner scannerWithString:pair];
    unsigned int byte = 0;
    if (![scanner scanHexInt:&byte] || !scanner.isAtEnd)
      return nil;
    bytes[index / 2] = (uint8_t)byte;
  }
  return data;
}

static void CopyHex(uint8_t *output, size_t length, NSString *value) {
  NSData *data = Hex(value);
  if (data.length == length)
    memcpy(output, data.bytes, length);
}

static void WriteU16(uint8_t *output, uint16_t value) {
  output[0] = (uint8_t)value;
  output[1] = (uint8_t)(value >> 8);
}

static void WriteU64(uint8_t *output, uint64_t value) {
  for (size_t index = 0; index < 8; index += 1)
    output[index] = (uint8_t)(value >> (index * 8));
}

static void ChecksumRecord(uint8_t record[512]) {
  uint8_t preimage[sizeof(kChecksumDomain) + 480];
  uint8_t checksum[32];
  memcpy(preimage, kChecksumDomain, sizeof(kChecksumDomain));
  memcpy(preimage + sizeof(kChecksumDomain), record, 480);
  CHECK(anc_pv_blake2b_256(checksum, preimage, sizeof(preimage)) ==
            ANC_PV_CRYPTO_OK,
        "record checksum");
  memcpy(record + 480, checksum, 32);
  anc_pv_zeroize(preimage, sizeof(preimage));
  anc_pv_zeroize(checksum, sizeof(checksum));
}

static void DerivePendingKey(uint8_t output[32]) {
  static const uint8_t label[] = "pending-epoch-key";
  uint8_t input[sizeof(kDerivationDomain) + sizeof(label) - 1 + 1];
  memcpy(input, kDerivationDomain, sizeof(kDerivationDomain));
  memcpy(input + sizeof(kDerivationDomain), label, sizeof(label) - 1);
  input[sizeof(input) - 1] = 0;
  CHECK(anc_pv_blake2b_256(output, input, sizeof(input)) == ANC_PV_CRYPTO_OK,
        "pending-key derivation");
  anc_pv_zeroize(input, sizeof(input));
}

static AncPrivateVaultRotationPreparationSnapshot
Snapshot(NSDictionary *checkpoint, uint8_t phase, uint8_t flags) {
  AncPrivateVaultRotationPreparationSnapshot value = {0};
  value.phase = (AncPrivateVaultRotationPreparationPhase)phase;
  value.flags = flags;
  value.role = (AncPrivateVaultRotationPreparationRole)
      [checkpoint[@"role"] unsignedCharValue];
  value.unattended = [checkpoint[@"unattended"] unsignedCharValue];
  value.preparation_generation = 7;
  CopyHex(value.vault_id, 16, checkpoint[@"vaultIdHex"]);
  CopyHex(value.endpoint_id, 16, checkpoint[@"endpointIdHex"]);
  CopyHex(value.ceremony_id, 16, checkpoint[@"ceremonyIdHex"]);
  value.base_custody_generation =
      [checkpoint[@"baseCustodyGeneration"] unsignedLongLongValue];
  CopyHex(value.base_frame_digest, 32, checkpoint[@"baseFrameDigestHex"]);
  value.base_sequence = [checkpoint[@"baseSequence"] unsignedLongLongValue];
  CopyHex(value.base_head, 32, checkpoint[@"baseHeadHex"]);
  CopyHex(value.base_membership, 32, checkpoint[@"baseMembershipHex"]);
  value.base_epoch = [checkpoint[@"baseEpoch"] unsignedLongLongValue];
  value.base_recovery_generation =
      [checkpoint[@"baseRecoveryGeneration"] unsignedLongLongValue];
  CopyHex(value.signing_public_key, 32, checkpoint[@"signingPublicKeyHex"]);
  CopyHex(value.agreement_public_key, 32, checkpoint[@"agreementPublicKeyHex"]);
  CopyHex(value.enrollment_ref, 16, checkpoint[@"enrollmentRefHex"]);
  if (phase < 6)
    value.pending_epoch = [checkpoint[@"pendingEpoch"] unsignedLongLongValue];
  if (phase == 4 || phase == 5) {
    value.expected_sequence = value.base_sequence + 1;
    memcpy(value.expected_previous_head, value.base_head, 32);
    CopyHex(value.transcript_digest, 32, checkpoint[@"transcriptHex"]);
    value.signed_entry_length = 97;
    value.recovery_wrap_length = 193;
    memset(value.encrypted_spool_digest, 0x77, 32);
  }
  return value;
}

static int Encode(NSDictionary *checkpoint, uint8_t phase, uint8_t flags,
                  uint64_t generation, const uint8_t pending[32],
                  uint8_t output[512]) {
  AncPrivateVaultRotationPreparationSnapshot snapshot =
      Snapshot(checkpoint, phase, flags);
  snapshot.preparation_generation = generation;
  uint8_t zero[32] = {0};
  const uint8_t *key = phase >= 5 ? zero : pending;
  return anc_pv_rotation_preparation_record_encode(
             &snapshot, key, output, 512) == ANC_PV_ROTATION_PREPARATION_OK;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    CHECK(argc == 2, "fixture path argument");
    NSData *json = [NSData dataWithContentsOfFile:@(argv[1])];
    NSDictionary *fixture = [NSJSONSerialization JSONObjectWithData:json
                                                            options:0
                                                              error:nil];
    CHECK([fixture[@"schema"]
              isEqualToString:@"anc/v1-native-rotation-preparation-vectors@2"],
          "frozen fixture schema");
    CHECK([fixture[@"recordLayout"][@"bytes"] unsignedIntegerValue] == 512,
          "frozen record size");

    uint8_t pending[32] = {0};
    DerivePendingKey(pending);
    uint8_t commitment[32] = {0};
    CHECK(anc_pv_blake2b_256(commitment, pending, 32) == ANC_PV_CRYPTO_OK,
          "pending-key commitment");
    CHECK(
        [Hex(
            fixture[@"syntheticDerivation"][@"commitments"][@"pendingEpochKey"])
            isEqualToData:[NSData dataWithBytes:commitment length:32]],
        "frozen pending-key commitment parity");

    NSMutableDictionary<NSNumber *, NSMutableData *> *endpointRecords =
        [NSMutableDictionary dictionary];
    for (NSDictionary *shape in fixture[@"positiveCases"]) {
      NSDictionary *checkpoint = [shape[@"role"] unsignedCharValue] == 1
                                     ? fixture[@"externalCheckpoint"]
                                     : fixture[@"brokerCheckpoint"];
      uint8_t record[512] = {0};
      uint8_t phase = [shape[@"phase"] unsignedCharValue];
      CHECK(Encode(checkpoint, phase, [shape[@"flags"] unsignedCharValue], 7,
                   pending, record),
            [shape[@"name"] UTF8String]);
      AncPrivateVaultRotationPreparationSnapshot decoded = {0};
      uint8_t decodedKey[32] = {0};
      CHECK(anc_pv_rotation_preparation_record_decode(record, 512, &decoded,
                                                      decodedKey) ==
                ANC_PV_ROTATION_PREPARATION_OK,
            "positive decode");
      CHECK(decoded.phase == phase &&
                decoded.role == [shape[@"role"] unsignedCharValue],
            "positive snapshot parity");
      CHECK((phase < 5 &&
             anc_pv_memcmp(decodedKey, pending, 32) == ANC_PV_CRYPTO_OK) ||
                (phase >= 5 && memcmp(decodedKey, (uint8_t[32]){0}, 32) == 0),
            "phase-scoped pending key");
      if ([shape[@"role"] unsignedCharValue] == 1)
        endpointRecords[@(phase)] = [NSMutableData dataWithBytes:record
                                                          length:512];
      anc_pv_zeroize(decodedKey, sizeof(decodedKey));
      anc_pv_rotation_preparation_snapshot_zero(&decoded);
      anc_pv_zeroize(record, sizeof(record));
    }

    for (NSDictionary *testCase in fixture[@"negativeCases"]) {
      if (![testCase[@"target"] isEqualToString:@"record"])
        continue;
      NSString *name = testCase[@"name"];
      uint8_t basePhase = [name hasPrefix:@"record_phase1"]   ? 1
                          : [name hasPrefix:@"record_phase5"] ? 5
                          : [name hasPrefix:@"record_phase6"] ? 6
                                                              : 4;
      NSMutableData *mutated = [endpointRecords[@(basePhase)] mutableCopy];
      NSDictionary *mutation = testCase[@"mutation"];
      NSString *op = mutation[@"op"];
      NSInteger offset = [mutation[@"offset"] integerValue];
      uint8_t *bytes = mutated.mutableBytes;
      if ([op isEqualToString:@"flip"])
        bytes[offset] ^= 1;
      else if ([op isEqualToString:@"zero"])
        memset(bytes + offset, 0, [mutation[@"length"] unsignedIntegerValue]);
      else if ([op isEqualToString:@"set_u8"])
        bytes[offset] = [mutation[@"value"] unsignedCharValue];
      else if ([op isEqualToString:@"set_u16"])
        WriteU16(bytes + offset, [mutation[@"value"] unsignedShortValue]);
      else if ([op isEqualToString:@"set_u64"])
        WriteU64(bytes + offset, [mutation[@"value"] unsignedLongLongValue]);
      else if ([op isEqualToString:@"truncate"])
        [mutated setLength:mutated.length -
                           [mutation[@"bytes"] unsignedIntegerValue]];
      else if ([op isEqualToString:@"append"])
        [mutated appendData:Hex(mutation[@"hex"])];
      if (![testCase[@"category"] hasPrefix:@"record.crypto"] &&
          ![testCase[@"category"] hasPrefix:@"record.wire.truncation"] &&
          ![testCase[@"category"] hasPrefix:@"record.wire.extra"])
        ChecksumRecord(mutated.mutableBytes);
      AncPrivateVaultRotationPreparationSnapshot decoded = {0};
      uint8_t decodedKey[32];
      memset(decodedKey, 0x5a, sizeof(decodedKey));
      AncPrivateVaultRotationPreparationStatus status =
          anc_pv_rotation_preparation_record_decode(
              mutated.bytes, mutated.length, &decoded, decodedKey);
      CHECK(
          [[NSString
              stringWithUTF8String:anc_pv_rotation_preparation_status_category(
                                       status)]
              isEqualToString:testCase[@"category"]],
          [name UTF8String]);
      CHECK(memcmp(decodedKey, (uint8_t[32]){0}, 32) == 0,
            "negative decode clears secret output");
      anc_pv_zeroize(mutated.mutableBytes, mutated.length);
    }

    /* Alias rejection happens before writes; disjoint validation failures
     * clear both destinations. Exercise each output/source pairing. */
    NSMutableData *aliasRecord = [endpointRecords[@1] mutableCopy];
    NSData *aliasOriginal = [aliasRecord copy];
    uint8_t aliasKey[32];
    memset(aliasKey, 0x5a, sizeof aliasKey);
    CHECK(anc_pv_rotation_preparation_record_decode(
              aliasRecord.bytes, aliasRecord.length,
              (AncPrivateVaultRotationPreparationSnapshot *)
                  aliasRecord.mutableBytes,
              aliasKey) == ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT,
          "record/snapshot alias rejected");
    CHECK([aliasRecord isEqualToData:aliasOriginal] && aliasKey[0] == 0x5a,
          "record/snapshot alias remains untouched");

    AncPrivateVaultRotationPreparationSnapshot aliasSnapshot;
    memset(&aliasSnapshot, 0x5a, sizeof aliasSnapshot);
    AncPrivateVaultRotationPreparationSnapshot aliasSnapshotOriginal =
        aliasSnapshot;
    CHECK(anc_pv_rotation_preparation_record_decode(
              aliasRecord.bytes, aliasRecord.length, &aliasSnapshot,
              (uint8_t *)aliasRecord.mutableBytes + 288) ==
              ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT,
          "record/key alias rejected");
    CHECK([aliasRecord isEqualToData:aliasOriginal] &&
              memcmp(&aliasSnapshot, &aliasSnapshotOriginal,
                     sizeof aliasSnapshot) == 0,
          "record/key alias remains untouched");

    _Alignas(AncPrivateVaultRotationPreparationSnapshot)
        uint8_t destinationOverlap[sizeof(
            AncPrivateVaultRotationPreparationSnapshot)] = {0};
    memset(destinationOverlap, 0x5a, sizeof destinationOverlap);
    uint8_t destinationOriginal[sizeof destinationOverlap];
    memcpy(destinationOriginal, destinationOverlap, sizeof destinationOverlap);
    CHECK(anc_pv_rotation_preparation_record_decode(
              aliasRecord.bytes, aliasRecord.length,
              (AncPrivateVaultRotationPreparationSnapshot *)destinationOverlap,
              destinationOverlap + 8) ==
              ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT,
          "snapshot/key alias rejected");
    CHECK(memcmp(destinationOverlap, destinationOriginal,
                 sizeof destinationOverlap) == 0,
          "snapshot/key alias remains untouched");

    _Alignas(AncPrivateVaultRotationPreparationSnapshot)
        uint8_t encodeOverlap[512] = {0};
    AncPrivateVaultRotationPreparationSnapshot *encodeSnapshot =
        (AncPrivateVaultRotationPreparationSnapshot *)encodeOverlap;
    *encodeSnapshot = Snapshot(fixture[@"externalCheckpoint"], 1, 0);
    uint8_t encodeOriginal[sizeof encodeOverlap];
    memcpy(encodeOriginal, encodeOverlap, sizeof encodeOverlap);
    CHECK(anc_pv_rotation_preparation_record_encode(
              encodeSnapshot, pending, encodeOverlap, sizeof encodeOverlap) ==
              ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT,
          "encode snapshot/record alias rejected");
    CHECK(memcmp(encodeOverlap, encodeOriginal, sizeof encodeOverlap) == 0,
          "encode alias remains untouched");

    AncPrivateVaultRotationPreparationSnapshot disjointEncodeSnapshot =
        Snapshot(fixture[@"externalCheckpoint"], 1, 0);
    uint8_t keyRecordOverlap[512];
    memset(keyRecordOverlap, 0x5a, sizeof keyRecordOverlap);
    uint8_t keyRecordOriginal[sizeof keyRecordOverlap];
    memcpy(keyRecordOriginal, keyRecordOverlap, sizeof keyRecordOverlap);
    CHECK(anc_pv_rotation_preparation_record_encode(
              &disjointEncodeSnapshot, keyRecordOverlap + 288, keyRecordOverlap,
              sizeof keyRecordOverlap) ==
              ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT,
          "encode key/record alias rejected");
    CHECK(memcmp(keyRecordOverlap, keyRecordOriginal,
                 sizeof keyRecordOverlap) == 0,
          "encode key/record alias remains untouched");

    _Alignas(AncPrivateVaultRotationPreparationSnapshot)
        uint8_t snapshotKeyOverlap[sizeof(
            AncPrivateVaultRotationPreparationSnapshot)] = {0};
    AncPrivateVaultRotationPreparationSnapshot *snapshotKey =
        (AncPrivateVaultRotationPreparationSnapshot *)snapshotKeyOverlap;
    *snapshotKey = Snapshot(fixture[@"externalCheckpoint"], 1, 0);
    uint8_t snapshotKeyOriginal[sizeof snapshotKeyOverlap];
    memcpy(snapshotKeyOriginal, snapshotKeyOverlap, sizeof snapshotKeyOverlap);
    uint8_t disjointRecord[512];
    memset(disjointRecord, 0x5a, sizeof disjointRecord);
    uint8_t disjointRecordOriginal[sizeof disjointRecord];
    memcpy(disjointRecordOriginal, disjointRecord, sizeof disjointRecord);
    CHECK(anc_pv_rotation_preparation_record_encode(
              snapshotKey, snapshotKeyOverlap + 8, disjointRecord,
              sizeof disjointRecord) ==
              ANC_PV_ROTATION_PREPARATION_INVALID_ARGUMENT,
          "encode snapshot/key alias rejected");
    CHECK(memcmp(snapshotKeyOverlap, snapshotKeyOriginal,
                 sizeof snapshotKeyOverlap) == 0 &&
              memcmp(disjointRecord, disjointRecordOriginal,
                     sizeof disjointRecord) == 0,
          "encode snapshot/key alias remains untouched");

    NSMutableData *malformed = [aliasRecord mutableCopy];
    ((uint8_t *)malformed.mutableBytes)[0] ^= 1;
    memset(&aliasSnapshot, 0x5a, sizeof aliasSnapshot);
    memset(aliasKey, 0x5a, sizeof aliasKey);
    CHECK(anc_pv_rotation_preparation_record_decode(
              malformed.bytes, malformed.length, &aliasSnapshot, aliasKey) !=
              ANC_PV_ROTATION_PREPARATION_OK,
          "disjoint malformed record rejected");
    CHECK(memcmp(&aliasSnapshot,
                 &(AncPrivateVaultRotationPreparationSnapshot){0},
                 sizeof aliasSnapshot) == 0 &&
              memcmp(aliasKey, (uint8_t[32]){0}, sizeof aliasKey) == 0,
          "disjoint malformed record clears outputs");
    anc_pv_zeroize(aliasRecord.mutableBytes, aliasRecord.length);
    anc_pv_zeroize(malformed.mutableBytes, malformed.length);
    anc_pv_zeroize(destinationOverlap, sizeof destinationOverlap);
    anc_pv_zeroize(destinationOriginal, sizeof destinationOriginal);
    anc_pv_zeroize(encodeOverlap, sizeof encodeOverlap);
    anc_pv_zeroize(encodeOriginal, sizeof encodeOriginal);
    anc_pv_zeroize(keyRecordOverlap, sizeof keyRecordOverlap);
    anc_pv_zeroize(keyRecordOriginal, sizeof keyRecordOriginal);
    anc_pv_zeroize(&disjointEncodeSnapshot, sizeof disjointEncodeSnapshot);
    anc_pv_zeroize(snapshotKeyOverlap, sizeof snapshotKeyOverlap);
    anc_pv_zeroize(snapshotKeyOriginal, sizeof snapshotKeyOriginal);
    anc_pv_zeroize(disjointRecord, sizeof disjointRecord);
    anc_pv_zeroize(disjointRecordOriginal, sizeof disjointRecordOriginal);

    for (NSDictionary *transition in fixture[@"transitionCases"]) {
      uint8_t from = [transition[@"from"] unsignedCharValue];
      uint8_t to = [transition[@"to"] unsignedCharValue];
      BOOL expected = [transition[@"expectedStatus"] isEqualToString:@"accept"];
      CHECK(anc_pv_rotation_preparation_phase_transition_allowed(from, to) ==
                expected,
            [transition[@"name"] UTF8String]);
    }
    for (uint8_t phase = 1; phase < 6; phase += 1) {
      CHECK(anc_pv_rotation_preparation_transition_validate(
                endpointRecords[@(phase)].bytes, 512,
                endpointRecords[@(phase + 1)].bytes,
                512) == ANC_PV_ROTATION_PREPARATION_OK,
            "sequential record transition");
    }
    uint8_t nextPrepared[512] = {0};
    CHECK(
        Encode(fixture[@"externalCheckpoint"], 1, 0, 8, pending, nextPrepared),
        "next prepared encode");
    CHECK(anc_pv_rotation_preparation_transition_validate(
              endpointRecords[@6].bytes, 512, nextPrepared, 512) ==
              ANC_PV_ROTATION_PREPARATION_OK,
          "cleaned to next-generation prepared");
    CHECK(anc_pv_rotation_preparation_transition_validate(
              endpointRecords[@6].bytes, 512, endpointRecords[@1].bytes, 512) ==
              ANC_PV_ROTATION_PREPARATION_RECORD_TRANSITION_GENERATION,
          "cleaned to same-generation prepared rejection");

    anc_pv_zeroize(nextPrepared, sizeof(nextPrepared));
    anc_pv_zeroize(pending, sizeof(pending));
    anc_pv_zeroize(commitment, sizeof(commitment));
    for (NSMutableData *record in endpointRecords.allValues)
      anc_pv_zeroize(record.mutableBytes, record.length);
    puts("PrivateVaultRotationPreparationRecordTests: PASS");
  }
  return 0;
}
