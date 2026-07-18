#import "PrivateVaultGenesisPreparationRecord.h"

#include <string.h>
#include <stdint.h>

enum {
  O_PHASE = 10,
  O_FLAGS = 11,
  O_GENERATION = 16,
  O_PREPARED = 24,
  O_EXPIRES = 32,
  O_CONFIRMED = 40,
  O_WRAP_TIME = 48,
  O_ENDPOINT_TIME = 56,
  O_LOG_TIME = 64,
  O_AUTH_TIME = 72,
  O_TERMINAL_TIME = 80,
  O_LOOKUP = 88,
  O_HANDLE_DIGEST = 104,
  O_VAULT = 136,
  O_CEREMONY = 152,
  O_ENDPOINT = 168,
  O_WRAP_ID = 184,
  O_ENDPOINT_ENV_ID = 200,
  O_LOG_ID = 216,
  O_AUTH_ID = 232,
  O_NONCE = 248,
  O_ENDPOINT_SIGN_PUB = 272,
  O_ENDPOINT_AGREE_PUB = 304,
  O_RECOVERY_ID = 336,
  O_RECOVERY_SIGN_PUB = 352,
  O_RECOVERY_AGREE_PUB = 384,
  O_WRAP_HASH = 416,
  O_CONFIRM_HASH = 448,
  O_BOOTSTRAP_DIGEST = 480,
  O_AUTH_DIGEST = 512,
  O_CONTROL_HEAD = 544,
  O_MEMBERSHIP = 576,
  O_SPOOL_DIGEST = 608,
  O_WRAP_LENGTH = 640,
  O_CONFIRM_LENGTH = 648,
  O_BOOTSTRAP_LENGTH = 656,
  O_AUTH_LENGTH = 664,
  O_RECOVERY_ENTROPY = 672,
  O_SIGN_SEED = 704,
  O_AGREE_SEED = 736,
  O_LOCAL_KEY = 768,
  O_EEK = 800,
  O_CUSTODY_DIGEST = 832,
  O_OFFICIAL_DIGEST = 864,
  O_RECEIPT_DIGEST = 896,
  O_RESERVED = 928,
  O_CHECKSUM = 992,
};

static const uint8_t kMagic[8] = {'A', 'N', 'P', 'V', 'G', 'P', '0', '1'};
static const uint8_t kChecksumDomain[] =
    "anc/v1/private-vault/genesis-preparation-record";
static const uint8_t kHandleDomain[] =
    "anc/v1/private-vault/genesis-preparation-handle";
static const uint64_t kMaxSafeInteger = UINT64_C(9007199254740991);

static uint16_t ReadU16(const uint8_t *bytes) {
  return (uint16_t)(bytes[0] | ((uint16_t)bytes[1] << 8));
}

static void WriteU16(uint8_t *bytes, uint16_t value) {
  bytes[0] = (uint8_t)value;
  bytes[1] = (uint8_t)(value >> 8);
}

static uint64_t ReadU64(const uint8_t *bytes) {
  uint64_t value = 0;
  for (size_t index = 0; index < 8; index++) {
    value |= (uint64_t)bytes[index] << (index * 8);
  }
  return value;
}

static void WriteU64(uint8_t *bytes, uint64_t value) {
  for (size_t index = 0; index < 8; index++) {
    bytes[index] = (uint8_t)(value >> (index * 8));
  }
}

static bool IsZero(const uint8_t *bytes, size_t length) {
  uint8_t aggregate = 0;
  for (size_t index = 0; index < length; index++) {
    aggregate |= bytes[index];
  }
  return aggregate == 0;
}

static bool IsEqual(const uint8_t *left, const uint8_t *right, size_t length) {
  return anc_pv_memcmp(left, right, length) == ANC_PV_CRYPTO_OK;
}

static bool RangesOverlap(const void *left, size_t leftLength,
                          const void *right, size_t rightLength) {
  if (left == NULL || right == NULL || leftLength == 0 || rightLength == 0) {
    return false;
  }
  const uintptr_t leftStart = (uintptr_t)left;
  const uintptr_t rightStart = (uintptr_t)right;
  if (leftLength > UINTPTR_MAX - leftStart ||
      rightLength > UINTPTR_MAX - rightStart) {
    return true;
  }
  return leftStart < rightStart + rightLength &&
         rightStart < leftStart + leftLength;
}

static bool AnyRangesOverlap(const void *const *pointers,
                             const size_t *lengths, size_t count) {
  for (size_t left = 0; left < count; left++) {
    for (size_t right = left + 1; right < count; right++) {
      if (RangesOverlap(pointers[left], lengths[left], pointers[right],
                        lengths[right])) {
        return true;
      }
    }
  }
  return false;
}

static bool Hash(uint8_t digest[ANC_PV_HASH_BYTES], const uint8_t *domain,
                 size_t domainLength, const uint8_t *body, size_t bodyLength) {
  return anc_pv_blake2b_256_two_part(digest, domain, domainLength, body,
                                     bodyLength) == ANC_PV_CRYPTO_OK;
}

static bool ConfirmationTupleIsZero(const uint8_t *record) {
  return IsZero(record + O_CONFIRMED, O_TERMINAL_TIME - O_CONFIRMED);
}

static bool ConfirmationTupleIsValid(const uint8_t *record, uint64_t prepared,
                                     uint64_t expires) {
  const uint64_t confirmed = ReadU64(record + O_CONFIRMED);
  const uint64_t createdSeconds = ReadU64(record + O_WRAP_TIME);
  if (confirmed < prepared || confirmed > expires ||
      confirmed > kMaxSafeInteger ||
      createdSeconds > kMaxSafeInteger / 1000) {
    return false;
  }
  return createdSeconds == confirmed / 1000 &&
         ReadU64(record + O_ENDPOINT_TIME) == createdSeconds &&
         ReadU64(record + O_LOG_TIME) == createdSeconds &&
         ReadU64(record + O_AUTH_TIME) == createdSeconds;
}

static bool ArtifactCommitmentsAreValid(const uint8_t *record) {
  const int digestOffsets[] = {
      O_WRAP_HASH,       O_CONFIRM_HASH, O_BOOTSTRAP_DIGEST, O_AUTH_DIGEST,
      O_CONTROL_HEAD,    O_MEMBERSHIP,   O_SPOOL_DIGEST,
  };
  for (size_t index = 0;
       index < sizeof(digestOffsets) / sizeof(digestOffsets[0]); index++) {
    if (IsZero(record + digestOffsets[index], ANC_PV_HASH_BYTES)) {
      return false;
    }
  }

  const uint64_t wrapLength = ReadU64(record + O_WRAP_LENGTH);
  const uint64_t confirmationLength = ReadU64(record + O_CONFIRM_LENGTH);
  const uint64_t bootstrapLength = ReadU64(record + O_BOOTSTRAP_LENGTH);
  const uint64_t authorizationLength = ReadU64(record + O_AUTH_LENGTH);
  return wrapLength > 0 && wrapLength <= 1048576 && confirmationLength > 0 &&
         confirmationLength <= 65536 && bootstrapLength > 0 &&
         bootstrapLength <= 4096 && authorizationLength > 0 &&
         authorizationLength <= 262144;
}

static AncPrivateVaultGenesisPreparationRecordStatus
ValidateRecord(const uint8_t *record, size_t recordLength) {
  if (record == NULL) {
    return ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  }
  if (recordLength != ANC_PV_GENESIS_PREPARATION_RECORD_BYTES) {
    return ANC_PV_GENESIS_PREPARATION_WIRE_LENGTH;
  }
  if (memcmp(record, kMagic, sizeof(kMagic)) != 0) {
    return ANC_PV_GENESIS_PREPARATION_WIRE_MAGIC;
  }
  if (ReadU16(record + 8) != ANC_PV_GENESIS_PREPARATION_VERSION ||
      ReadU16(record + 12) != ANC_PV_GENESIS_PREPARATION_RECORD_BYTES) {
    return ANC_PV_GENESIS_PREPARATION_WIRE_VERSION;
  }

  const uint8_t phase = record[O_PHASE];
  const uint8_t flags = record[O_FLAGS];
  const uint8_t allowedFlags =
      ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND |
      ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE |
      ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND |
      ANC_PV_GENESIS_PREPARATION_FLAG_OFFICIAL_AUTHORITY_BOUND |
      ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED |
      ANC_PV_GENESIS_PREPARATION_FLAG_HOSTED_RECEIPT_BOUND;
  if (phase < ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED ||
      phase > ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED) {
    return ANC_PV_GENESIS_PREPARATION_WIRE_PHASE;
  }
  if ((flags & ~allowedFlags) != 0) {
    return ANC_PV_GENESIS_PREPARATION_WIRE_FLAGS;
  }
  if (ReadU16(record + 14) != 0 ||
      !IsZero(record + O_RESERVED, O_CHECKSUM - O_RESERVED)) {
    return ANC_PV_GENESIS_PREPARATION_WIRE_RESERVED;
  }

  const uint64_t generation = ReadU64(record + O_GENERATION);
  const uint64_t prepared = ReadU64(record + O_PREPARED);
  const uint64_t expires = ReadU64(record + O_EXPIRES);
  const uint64_t terminal = ReadU64(record + O_TERMINAL_TIME);
  if (generation == 0) {
    return ANC_PV_GENESIS_PREPARATION_RANGE_GENERATION;
  }
  if (prepared == 0 || prepared > kMaxSafeInteger || expires <= prepared ||
      expires > kMaxSafeInteger || expires - prepared > 600000 ||
      terminal > kMaxSafeInteger ||
      (terminal != 0 && terminal < prepared)) {
    return ANC_PV_GENESIS_PREPARATION_RANGE_TIMESTAMP;
  }

  const int identityOffsets[] = {O_LOOKUP, O_VAULT, O_CEREMONY, O_ENDPOINT,
                                 O_WRAP_ID, O_ENDPOINT_ENV_ID, O_LOG_ID,
                                 O_AUTH_ID, O_RECOVERY_ID};
  for (size_t index = 0;
       index < sizeof(identityOffsets) / sizeof(identityOffsets[0]); index++) {
    if (IsZero(record + identityOffsets[index], 16)) {
      return ANC_PV_GENESIS_PREPARATION_BINDING_IDENTITY;
    }
  }
  if (IsZero(record + O_HANDLE_DIGEST, ANC_PV_HASH_BYTES)) {
    return ANC_PV_GENESIS_PREPARATION_BINDING_HANDLE;
  }
  if (IsZero(record + O_NONCE, 24) ||
      IsZero(record + O_ENDPOINT_SIGN_PUB, 32) ||
      IsZero(record + O_ENDPOINT_AGREE_PUB, 32) ||
      IsZero(record + O_RECOVERY_SIGN_PUB, 32) ||
      IsZero(record + O_RECOVERY_AGREE_PUB, 32)) {
    return ANC_PV_GENESIS_PREPARATION_BINDING_IDENTITY;
  }

  const bool tupleZero = ConfirmationTupleIsZero(record);
  const bool tupleValid = ConfirmationTupleIsValid(record, prepared, expires);
  if (phase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED ||
      phase == ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED) {
    if (!tupleZero) {
      return ANC_PV_GENESIS_PREPARATION_RANGE_TIMESTAMP;
    }
  } else if (phase == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED) {
    if (!tupleZero && !tupleValid) {
      return ANC_PV_GENESIS_PREPARATION_RANGE_TIMESTAMP;
    }
  } else if (!tupleValid) {
    return ANC_PV_GENESIS_PREPARATION_RANGE_TIMESTAMP;
  }
  const uint64_t confirmed = ReadU64(record + O_CONFIRMED);
  if ((tupleValid && terminal != 0 && terminal < confirmed) ||
      (phase == ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED &&
       terminal <= expires) ||
      (phase == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED && tupleZero &&
       terminal > expires)) {
    return ANC_PV_GENESIS_PREPARATION_RANGE_TIMESTAMP;
  }

  const bool terminalPhase =
      phase >= ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED;
  const bool secretsZero = IsZero(record + O_RECOVERY_ENTROPY, 160);
  if (!terminalPhase) {
    if (terminal != 0 || secretsZero) {
      return ANC_PV_GENESIS_PREPARATION_BINDING_TERMINAL;
    }
    for (int offset = O_RECOVERY_ENTROPY; offset <= O_EEK; offset += 32) {
      if (IsZero(record + offset, 32)) {
        return ANC_PV_GENESIS_PREPARATION_BINDING_SECRET;
      }
    }
  } else if (terminal == 0 || !secretsZero) {
    return ANC_PV_GENESIS_PREPARATION_BINDING_TERMINAL;
  }

  const bool artifactsBound =
      (flags & ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND) != 0;
  const bool artifactsLive =
      (flags & ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) != 0;
  const bool artifactsCleaned =
      (flags & ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED) != 0;
  const bool commitmentsZero =
      IsZero(record + O_WRAP_HASH, O_RECOVERY_ENTROPY - O_WRAP_HASH);
  if (artifactsBound) {
    const bool stagedConfirmation =
        phase == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED &&
        !artifactsLive && !artifactsCleaned;
    if ((!stagedConfirmation && artifactsLive == artifactsCleaned) ||
        !ArtifactCommitmentsAreValid(record)) {
      return ANC_PV_GENESIS_PREPARATION_BINDING_ARTIFACTS;
    }
  } else if (artifactsLive || !commitmentsZero) {
    return ANC_PV_GENESIS_PREPARATION_BINDING_ARTIFACTS;
  }

  const bool custody =
      (flags & ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND) != 0;
  const bool official =
      (flags & ANC_PV_GENESIS_PREPARATION_FLAG_OFFICIAL_AUTHORITY_BOUND) != 0;
  const bool receipt =
      (flags & ANC_PV_GENESIS_PREPARATION_FLAG_HOSTED_RECEIPT_BOUND) != 0;
  if (custody != !IsZero(record + O_CUSTODY_DIGEST, 32)) {
    return ANC_PV_GENESIS_PREPARATION_BINDING_CUSTODY;
  }
  if (official != !IsZero(record + O_OFFICIAL_DIGEST, 32) ||
      receipt != !IsZero(record + O_RECEIPT_DIGEST, 32)) {
    return ANC_PV_GENESIS_PREPARATION_BINDING_OFFICIAL;
  }

  switch ((AncPrivateVaultGenesisPreparationPhase)phase) {
  case ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED:
    if (flags != 0 || !commitmentsZero || custody || official || receipt) {
      return ANC_PV_GENESIS_PREPARATION_WIRE_FLAGS;
    }
    break;
  case ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED:
    if (flags != ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND &&
        flags != (ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND |
                  ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE)) {
      return ANC_PV_GENESIS_PREPARATION_WIRE_FLAGS;
    }
    break;
  case ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING:
    if (!artifactsBound || !artifactsLive || artifactsCleaned || official ||
        receipt || (flags & ~(ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND |
                             ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE |
                             ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND))) {
      return ANC_PV_GENESIS_PREPARATION_WIRE_FLAGS;
    }
    break;
  case ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED:
    if (!artifactsBound || !custody || !official ||
        (artifactsCleaned && (artifactsLive || !receipt)) ||
        (!artifactsCleaned && !artifactsLive)) {
      return ANC_PV_GENESIS_PREPARATION_WIRE_FLAGS;
    }
    break;
  case ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED:
    if (official || receipt) {
      return ANC_PV_GENESIS_PREPARATION_WIRE_FLAGS;
    }
    if (!artifactsBound) {
      if (flags != ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED ||
          custody || !tupleZero) {
        return ANC_PV_GENESIS_PREPARATION_WIRE_FLAGS;
      }
    } else if ((!artifactsLive && !artifactsCleaned) ||
               (artifactsLive && artifactsCleaned) || tupleZero ||
               (flags & ~(ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND |
                          ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE |
                          ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND |
                          ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED))) {
      return ANC_PV_GENESIS_PREPARATION_WIRE_FLAGS;
    }
    break;
  case ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED:
    if (flags != ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED || custody ||
        official || receipt || !commitmentsZero) {
      return ANC_PV_GENESIS_PREPARATION_WIRE_FLAGS;
    }
    break;
  }

  uint8_t checksum[ANC_PV_HASH_BYTES] = {0};
  const bool checksumValid =
      Hash(checksum, kChecksumDomain, sizeof(kChecksumDomain), record,
           O_CHECKSUM) &&
      IsEqual(checksum, record + O_CHECKSUM, ANC_PV_HASH_BYTES);
  anc_pv_zeroize(checksum, sizeof(checksum));
  return checksumValid ? ANC_PV_GENESIS_PREPARATION_OK
                       : ANC_PV_GENESIS_PREPARATION_CRYPTO_CHECKSUM;
}

static void CopySnapshot(
    const uint8_t *record,
    AncPrivateVaultGenesisPreparationSnapshot *snapshot) {
  memset(snapshot, 0, sizeof(*snapshot));
  snapshot->phase = (AncPrivateVaultGenesisPreparationPhase)record[O_PHASE];
  snapshot->flags = record[O_FLAGS];
  snapshot->generation = ReadU64(record + O_GENERATION);
  snapshot->prepared_at_ms = ReadU64(record + O_PREPARED);
  snapshot->expires_at_ms = ReadU64(record + O_EXPIRES);
  snapshot->confirmed_at_ms = ReadU64(record + O_CONFIRMED);
  snapshot->recovery_wrap_created_at_seconds = ReadU64(record + O_WRAP_TIME);
  snapshot->endpoint_created_at_seconds = ReadU64(record + O_ENDPOINT_TIME);
  snapshot->log_entry_created_at_seconds = ReadU64(record + O_LOG_TIME);
  snapshot->authorization_created_at_seconds = ReadU64(record + O_AUTH_TIME);
  snapshot->terminal_at_ms = ReadU64(record + O_TERMINAL_TIME);
#define COPY_FIELD(field, offset)                                             \
  memcpy(snapshot->field, record + offset, sizeof(snapshot->field))
  COPY_FIELD(preparation_lookup_id, O_LOOKUP);
  COPY_FIELD(handle_digest, O_HANDLE_DIGEST);
  COPY_FIELD(vault_id, O_VAULT);
  COPY_FIELD(ceremony_id, O_CEREMONY);
  COPY_FIELD(endpoint_id, O_ENDPOINT);
  COPY_FIELD(recovery_wrap_envelope_id, O_WRAP_ID);
  COPY_FIELD(endpoint_envelope_id, O_ENDPOINT_ENV_ID);
  COPY_FIELD(log_entry_envelope_id, O_LOG_ID);
  COPY_FIELD(authorization_envelope_id, O_AUTH_ID);
  COPY_FIELD(recovery_wrap_nonce, O_NONCE);
  COPY_FIELD(endpoint_signing_public_key, O_ENDPOINT_SIGN_PUB);
  COPY_FIELD(endpoint_agreement_public_key, O_ENDPOINT_AGREE_PUB);
  COPY_FIELD(recovery_id, O_RECOVERY_ID);
  COPY_FIELD(recovery_signing_public_key, O_RECOVERY_SIGN_PUB);
  COPY_FIELD(recovery_agreement_public_key, O_RECOVERY_AGREE_PUB);
  COPY_FIELD(recovery_wrap_hash, O_WRAP_HASH);
  COPY_FIELD(recovery_confirmation_hash, O_CONFIRM_HASH);
  COPY_FIELD(bootstrap_transcript_digest, O_BOOTSTRAP_DIGEST);
  COPY_FIELD(authorization_digest, O_AUTH_DIGEST);
  COPY_FIELD(genesis_control_head_hash, O_CONTROL_HEAD);
  COPY_FIELD(membership_hash, O_MEMBERSHIP);
  COPY_FIELD(artifact_spool_digest, O_SPOOL_DIGEST);
  COPY_FIELD(custody_record_digest, O_CUSTODY_DIGEST);
  COPY_FIELD(official_authority_g2_frame_digest, O_OFFICIAL_DIGEST);
  COPY_FIELD(hosted_recovery_receipt_digest, O_RECEIPT_DIGEST);
#undef COPY_FIELD
  snapshot->recovery_wrap_length = ReadU64(record + O_WRAP_LENGTH);
  snapshot->confirmation_length = ReadU64(record + O_CONFIRM_LENGTH);
  snapshot->bootstrap_length = ReadU64(record + O_BOOTSTRAP_LENGTH);
  snapshot->authorization_length = ReadU64(record + O_AUTH_LENGTH);
}

static bool SecretInputsAreComplete(
    const AncPrivateVaultGenesisPreparationSecretInputs *secrets) {
  return secrets != NULL && secrets->recovery_entropy != NULL &&
         secrets->endpoint_signing_seed != NULL &&
         secrets->endpoint_agreement_seed != NULL &&
         secrets->local_state_key != NULL && secrets->epoch_one_eek != NULL;
}

static bool SecretOutputsAreComplete(
    const AncPrivateVaultGenesisPreparationSecretOutputs *secrets) {
  return secrets != NULL && secrets->recovery_entropy != NULL &&
         secrets->endpoint_signing_seed != NULL &&
         secrets->endpoint_agreement_seed != NULL &&
         secrets->local_state_key != NULL && secrets->epoch_one_eek != NULL;
}

static void ClearSecretOutputs(
    const AncPrivateVaultGenesisPreparationSecretOutputs *secrets) {
  if (secrets == NULL) {
    return;
  }
  uint8_t *const outputs[] = {
      secrets->recovery_entropy, secrets->endpoint_signing_seed,
      secrets->endpoint_agreement_seed, secrets->local_state_key,
      secrets->epoch_one_eek,
  };
  for (size_t index = 0; index < sizeof(outputs) / sizeof(outputs[0]); index++) {
    if (outputs[index] != NULL) {
      anc_pv_zeroize(outputs[index], ANC_PV_GENESIS_PREPARATION_SECRET_BYTES);
    }
  }
}

AncPrivateVaultGenesisPreparationRecordStatus
anc_pv_genesis_preparation_record_encode(
    const AncPrivateVaultGenesisPreparationSnapshot *snapshot,
    const AncPrivateVaultGenesisPreparationSecretInputs *secrets,
    uint8_t *record, size_t recordLength) {
  if (snapshot == NULL || record == NULL || secrets == NULL ||
      recordLength != ANC_PV_GENESIS_PREPARATION_RECORD_BYTES) {
    return ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  }
  if (RangesOverlap(secrets, sizeof(*secrets), record,
                    ANC_PV_GENESIS_PREPARATION_RECORD_BYTES) ||
      RangesOverlap(secrets, sizeof(*secrets), snapshot, sizeof(*snapshot))) {
    return ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  }
  if (!SecretInputsAreComplete(secrets)) {
    return ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  }
  const void *const buffers[] = {
      record,
      snapshot,
      secrets,
      secrets->recovery_entropy,
      secrets->endpoint_signing_seed,
      secrets->endpoint_agreement_seed,
      secrets->local_state_key,
      secrets->epoch_one_eek,
  };
  const size_t lengths[] = {
      ANC_PV_GENESIS_PREPARATION_RECORD_BYTES,
      sizeof(*snapshot),
      sizeof(*secrets),
      32,
      32,
      32,
      32,
      32,
  };
  if (AnyRangesOverlap(buffers, lengths,
                       sizeof(buffers) / sizeof(buffers[0]))) {
    return ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  }

  memset(record, 0, recordLength);
  memcpy(record, kMagic, sizeof(kMagic));
  WriteU16(record + 8, ANC_PV_GENESIS_PREPARATION_VERSION);
  record[O_PHASE] = snapshot->phase;
  record[O_FLAGS] = snapshot->flags;
  WriteU16(record + 12, ANC_PV_GENESIS_PREPARATION_RECORD_BYTES);
  WriteU64(record + O_GENERATION, snapshot->generation);
  WriteU64(record + O_PREPARED, snapshot->prepared_at_ms);
  WriteU64(record + O_EXPIRES, snapshot->expires_at_ms);
  WriteU64(record + O_CONFIRMED, snapshot->confirmed_at_ms);
  WriteU64(record + O_WRAP_TIME,
           snapshot->recovery_wrap_created_at_seconds);
  WriteU64(record + O_ENDPOINT_TIME, snapshot->endpoint_created_at_seconds);
  WriteU64(record + O_LOG_TIME, snapshot->log_entry_created_at_seconds);
  WriteU64(record + O_AUTH_TIME, snapshot->authorization_created_at_seconds);
  WriteU64(record + O_TERMINAL_TIME, snapshot->terminal_at_ms);
#define COPY_FIELD(field, offset)                                             \
  memcpy(record + offset, snapshot->field, sizeof(snapshot->field))
  COPY_FIELD(preparation_lookup_id, O_LOOKUP);
  COPY_FIELD(handle_digest, O_HANDLE_DIGEST);
  COPY_FIELD(vault_id, O_VAULT);
  COPY_FIELD(ceremony_id, O_CEREMONY);
  COPY_FIELD(endpoint_id, O_ENDPOINT);
  COPY_FIELD(recovery_wrap_envelope_id, O_WRAP_ID);
  COPY_FIELD(endpoint_envelope_id, O_ENDPOINT_ENV_ID);
  COPY_FIELD(log_entry_envelope_id, O_LOG_ID);
  COPY_FIELD(authorization_envelope_id, O_AUTH_ID);
  COPY_FIELD(recovery_wrap_nonce, O_NONCE);
  COPY_FIELD(endpoint_signing_public_key, O_ENDPOINT_SIGN_PUB);
  COPY_FIELD(endpoint_agreement_public_key, O_ENDPOINT_AGREE_PUB);
  COPY_FIELD(recovery_id, O_RECOVERY_ID);
  COPY_FIELD(recovery_signing_public_key, O_RECOVERY_SIGN_PUB);
  COPY_FIELD(recovery_agreement_public_key, O_RECOVERY_AGREE_PUB);
  COPY_FIELD(recovery_wrap_hash, O_WRAP_HASH);
  COPY_FIELD(recovery_confirmation_hash, O_CONFIRM_HASH);
  COPY_FIELD(bootstrap_transcript_digest, O_BOOTSTRAP_DIGEST);
  COPY_FIELD(authorization_digest, O_AUTH_DIGEST);
  COPY_FIELD(genesis_control_head_hash, O_CONTROL_HEAD);
  COPY_FIELD(membership_hash, O_MEMBERSHIP);
  COPY_FIELD(artifact_spool_digest, O_SPOOL_DIGEST);
  COPY_FIELD(custody_record_digest, O_CUSTODY_DIGEST);
  COPY_FIELD(official_authority_g2_frame_digest, O_OFFICIAL_DIGEST);
  COPY_FIELD(hosted_recovery_receipt_digest, O_RECEIPT_DIGEST);
#undef COPY_FIELD
  WriteU64(record + O_WRAP_LENGTH, snapshot->recovery_wrap_length);
  WriteU64(record + O_CONFIRM_LENGTH, snapshot->confirmation_length);
  WriteU64(record + O_BOOTSTRAP_LENGTH, snapshot->bootstrap_length);
  WriteU64(record + O_AUTH_LENGTH, snapshot->authorization_length);
  memcpy(record + O_RECOVERY_ENTROPY, secrets->recovery_entropy, 32);
  memcpy(record + O_SIGN_SEED, secrets->endpoint_signing_seed, 32);
  memcpy(record + O_AGREE_SEED, secrets->endpoint_agreement_seed, 32);
  memcpy(record + O_LOCAL_KEY, secrets->local_state_key, 32);
  memcpy(record + O_EEK, secrets->epoch_one_eek, 32);

  uint8_t checksum[ANC_PV_HASH_BYTES] = {0};
  if (!Hash(checksum, kChecksumDomain, sizeof(kChecksumDomain), record,
            O_CHECKSUM)) {
    anc_pv_zeroize(record, recordLength);
    return ANC_PV_GENESIS_PREPARATION_CRYPTO_CHECKSUM;
  }
  memcpy(record + O_CHECKSUM, checksum, sizeof(checksum));
  anc_pv_zeroize(checksum, sizeof(checksum));

  const AncPrivateVaultGenesisPreparationRecordStatus status =
      ValidateRecord(record, recordLength);
  if (status != ANC_PV_GENESIS_PREPARATION_OK) {
    anc_pv_zeroize(record, recordLength);
  }
  return status;
}

AncPrivateVaultGenesisPreparationRecordStatus
anc_pv_genesis_preparation_record_decode_public(
    const uint8_t *record, size_t recordLength,
    AncPrivateVaultGenesisPreparationSnapshot *snapshot) {
  if (record == NULL || snapshot == NULL) {
    if (snapshot != NULL) {
      memset(snapshot, 0, sizeof(*snapshot));
    }
    return ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  }
  if (RangesOverlap(record, ANC_PV_GENESIS_PREPARATION_RECORD_BYTES, snapshot,
                    sizeof(*snapshot))) {
    return ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  }
  const AncPrivateVaultGenesisPreparationRecordStatus status =
      ValidateRecord(record, recordLength);
  if (status != ANC_PV_GENESIS_PREPARATION_OK) {
    memset(snapshot, 0, sizeof(*snapshot));
    return status;
  }
  CopySnapshot(record, snapshot);
  return ANC_PV_GENESIS_PREPARATION_OK;
}

AncPrivateVaultGenesisPreparationRecordStatus
anc_pv_genesis_preparation_record_decode(
    const uint8_t *record, size_t recordLength,
    AncPrivateVaultGenesisPreparationSnapshot *snapshot,
    const AncPrivateVaultGenesisPreparationSecretOutputs *secrets) {
  if (secrets != NULL &&
      ((record != NULL &&
        RangesOverlap(secrets, sizeof(*secrets), record,
                      ANC_PV_GENESIS_PREPARATION_RECORD_BYTES)) ||
       (snapshot != NULL &&
        RangesOverlap(secrets, sizeof(*secrets), snapshot,
                      sizeof(*snapshot))))) {
    return ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  }
  if (secrets != NULL) {
    const void *const possibleBuffers[] = {
        record,
        snapshot,
        secrets,
        secrets->recovery_entropy,
        secrets->endpoint_signing_seed,
        secrets->endpoint_agreement_seed,
        secrets->local_state_key,
        secrets->epoch_one_eek,
    };
    const size_t possibleLengths[] = {
        ANC_PV_GENESIS_PREPARATION_RECORD_BYTES,
        sizeof(*snapshot),
        sizeof(*secrets),
        32,
        32,
        32,
        32,
        32,
    };
    if (AnyRangesOverlap(possibleBuffers, possibleLengths,
                         sizeof(possibleBuffers) /
                             sizeof(possibleBuffers[0]))) {
      return ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
    }
  } else if (record != NULL && snapshot != NULL &&
             RangesOverlap(record, ANC_PV_GENESIS_PREPARATION_RECORD_BYTES,
                           snapshot, sizeof(*snapshot))) {
    return ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  }
  if (record == NULL || snapshot == NULL ||
      !SecretOutputsAreComplete(secrets)) {
    if (snapshot != NULL) {
      memset(snapshot, 0, sizeof(*snapshot));
    }
    ClearSecretOutputs(secrets);
    return ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  }
  ClearSecretOutputs(secrets);
  const AncPrivateVaultGenesisPreparationRecordStatus status =
      anc_pv_genesis_preparation_record_decode_public(record, recordLength,
                                                      snapshot);
  if (status != ANC_PV_GENESIS_PREPARATION_OK) {
    return status;
  }
  memcpy(secrets->recovery_entropy, record + O_RECOVERY_ENTROPY, 32);
  memcpy(secrets->endpoint_signing_seed, record + O_SIGN_SEED, 32);
  memcpy(secrets->endpoint_agreement_seed, record + O_AGREE_SEED, 32);
  memcpy(secrets->local_state_key, record + O_LOCAL_KEY, 32);
  memcpy(secrets->epoch_one_eek, record + O_EEK, 32);
  return ANC_PV_GENESIS_PREPARATION_OK;
}

bool anc_pv_genesis_preparation_phase_transition_allowed(
    AncPrivateVaultGenesisPreparationPhase from,
    AncPrivateVaultGenesisPreparationPhase to) {
  switch (from) {
  case ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED:
    return to == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED ||
           to == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED ||
           to == ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED;
  case ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED:
    return to == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED ||
           to == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING ||
           to == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED;
  case ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING:
    return to == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING ||
           to == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED ||
           to == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED;
  case ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED:
  case ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED:
  case ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED:
    return from == to;
  }
  return false;
}

static bool StableExceptGenerationFlagsChecksum(const uint8_t *from,
                                                const uint8_t *to) {
  return IsEqual(from, to, O_PHASE) && from[O_PHASE] == to[O_PHASE] &&
         IsEqual(from + 12, to + 12, O_GENERATION - 12) &&
         IsEqual(from + O_PREPARED, to + O_PREPARED,
                 O_CHECKSUM - O_PREPARED);
}

static bool TerminalizedSecrets(const uint8_t *to) {
  return IsZero(to + O_RECOVERY_ENTROPY, 160) &&
         ReadU64(to + O_TERMINAL_TIME) != 0;
}

static bool ValidateExactTransition(const uint8_t *from, const uint8_t *to) {
  const AncPrivateVaultGenesisPreparationPhase fromPhase =
      (AncPrivateVaultGenesisPreparationPhase)from[O_PHASE];
  const AncPrivateVaultGenesisPreparationPhase toPhase =
      (AncPrivateVaultGenesisPreparationPhase)to[O_PHASE];
  const uint8_t fromFlags = from[O_FLAGS];
  const uint8_t toFlags = to[O_FLAGS];

  if (!IsEqual(from + O_PREPARED, to + O_PREPARED, 16) ||
      !IsEqual(from + O_LOOKUP, to + O_LOOKUP, O_WRAP_HASH - O_LOOKUP)) {
    return false;
  }
  if (fromPhase >= ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED &&
      !IsEqual(from + O_CONFIRMED, to + O_CONFIRMED,
               O_TERMINAL_TIME - O_CONFIRMED)) {
    return false;
  }
  if (fromPhase >= ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED &&
      ReadU64(from + O_TERMINAL_TIME) != ReadU64(to + O_TERMINAL_TIME)) {
    return false;
  }
  if (fromPhase >= ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED &&
      !IsEqual(from + O_WRAP_HASH, to + O_WRAP_HASH,
               O_RECOVERY_ENTROPY - O_WRAP_HASH)) {
    return false;
  }

  if (fromPhase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED &&
      toPhase == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED) {
    return toFlags == ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND &&
           IsEqual(from + O_RECOVERY_ENTROPY, to + O_RECOVERY_ENTROPY, 160) &&
           IsZero(to + O_CUSTODY_DIGEST, 96);
  }
  if (fromPhase == ANC_PV_GENESIS_PREPARATION_PHASE_PREPARED &&
      (toPhase == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED ||
       toPhase == ANC_PV_GENESIS_PREPARATION_PHASE_EXPIRED)) {
    return toFlags == ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED &&
           TerminalizedSecrets(to) && IsZero(to + O_CUSTODY_DIGEST, 96);
  }
  if (fromPhase == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED &&
      toPhase == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED) {
    return fromFlags == ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND &&
           toFlags == (ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND |
                       ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) &&
           StableExceptGenerationFlagsChecksum(from, to);
  }
  if (fromPhase == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED &&
      toPhase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING) {
    return fromFlags == (ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND |
                         ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) &&
           toFlags == fromFlags &&
           IsEqual(from + O_RECOVERY_ENTROPY, to + O_RECOVERY_ENTROPY, 256);
  }
  if (fromPhase == ANC_PV_GENESIS_PREPARATION_PHASE_CONFIRMED &&
      toPhase == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED) {
    return fromFlags == (ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND |
                         ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) &&
           toFlags == fromFlags && TerminalizedSecrets(to) &&
           IsZero(to + O_CUSTODY_DIGEST, 96);
  }
  if (fromPhase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING &&
      toPhase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING) {
    return fromFlags == (ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_BOUND |
                         ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) &&
           toFlags == (fromFlags |
                       ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND) &&
           !IsZero(to + O_CUSTODY_DIGEST, 32) &&
           IsEqual(from + O_RECOVERY_ENTROPY, to + O_RECOVERY_ENTROPY, 160) &&
           IsEqual(from + O_OFFICIAL_DIGEST, to + O_OFFICIAL_DIGEST, 64);
  }
  if (fromPhase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING &&
      toPhase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED) {
    return (fromFlags & ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND) !=
               0 &&
           toFlags == (fromFlags |
                       ANC_PV_GENESIS_PREPARATION_FLAG_OFFICIAL_AUTHORITY_BOUND) &&
           TerminalizedSecrets(to) &&
           IsEqual(from + O_CUSTODY_DIGEST, to + O_CUSTODY_DIGEST, 32) &&
           !IsZero(to + O_OFFICIAL_DIGEST, 32) &&
           IsZero(to + O_RECEIPT_DIGEST, 32);
  }
  if (fromPhase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTING &&
      toPhase == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED) {
    const bool fromHasCustody =
        (fromFlags & ANC_PV_GENESIS_PREPARATION_FLAG_CUSTODY_RECORD_BOUND) != 0;
    return toFlags == fromFlags && TerminalizedSecrets(to) &&
           (fromHasCustody ? (!IsZero(to + O_CUSTODY_DIGEST, 32) &&
                              !IsEqual(from + O_CUSTODY_DIGEST,
                                       to + O_CUSTODY_DIGEST, 32))
                           : IsZero(to + O_CUSTODY_DIGEST, 32)) &&
           IsZero(to + O_OFFICIAL_DIGEST, 64);
  }
  if (fromPhase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED &&
      toPhase == ANC_PV_GENESIS_PREPARATION_PHASE_COMMITTED) {
    if ((fromFlags & ANC_PV_GENESIS_PREPARATION_FLAG_HOSTED_RECEIPT_BOUND) ==
        0) {
      return toFlags ==
                 (fromFlags |
                  ANC_PV_GENESIS_PREPARATION_FLAG_HOSTED_RECEIPT_BOUND) &&
             IsEqual(from + O_CUSTODY_DIGEST, to + O_CUSTODY_DIGEST, 64) &&
             !IsZero(to + O_RECEIPT_DIGEST, 32);
    }
    return (fromFlags & ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) != 0 &&
           toFlags ==
               ((fromFlags &
                 ~ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) |
                ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED) &&
           IsEqual(from + O_CUSTODY_DIGEST, to + O_CUSTODY_DIGEST, 96);
  }
  if (fromPhase == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED &&
      toPhase == ANC_PV_GENESIS_PREPARATION_PHASE_CANCELLED) {
    return (fromFlags & ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) != 0 &&
           (fromFlags & ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED) == 0 &&
           toFlags ==
               ((fromFlags &
                 ~ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_LIVE) |
                ANC_PV_GENESIS_PREPARATION_FLAG_ARTIFACTS_CLEANED) &&
           IsEqual(from + O_CUSTODY_DIGEST, to + O_CUSTODY_DIGEST, 96);
  }
  return false;
}

AncPrivateVaultGenesisPreparationRecordStatus
anc_pv_genesis_preparation_transition_validate(
    const uint8_t *fromRecord, size_t fromLength, const uint8_t *toRecord,
    size_t toLength) {
  AncPrivateVaultGenesisPreparationRecordStatus status =
      ValidateRecord(fromRecord, fromLength);
  if (status != ANC_PV_GENESIS_PREPARATION_OK) {
    return status;
  }
  status = ValidateRecord(toRecord, toLength);
  if (status != ANC_PV_GENESIS_PREPARATION_OK) {
    return status;
  }
  const AncPrivateVaultGenesisPreparationPhase fromPhase =
      (AncPrivateVaultGenesisPreparationPhase)fromRecord[O_PHASE];
  const AncPrivateVaultGenesisPreparationPhase toPhase =
      (AncPrivateVaultGenesisPreparationPhase)toRecord[O_PHASE];
  const uint64_t fromGeneration = ReadU64(fromRecord + O_GENERATION);
  if (!anc_pv_genesis_preparation_phase_transition_allowed(fromPhase, toPhase) ||
      fromGeneration == UINT64_MAX ||
      ReadU64(toRecord + O_GENERATION) != fromGeneration + 1) {
    return ANC_PV_GENESIS_PREPARATION_TRANSITION;
  }
  return ValidateExactTransition(fromRecord, toRecord)
             ? ANC_PV_GENESIS_PREPARATION_OK
             : ANC_PV_GENESIS_PREPARATION_SUBSTITUTION;
}

void anc_pv_genesis_preparation_snapshot_zero(
    AncPrivateVaultGenesisPreparationSnapshot *snapshot) {
  if (snapshot != NULL) {
    anc_pv_zeroize(snapshot, sizeof(*snapshot));
  }
}

const char *anc_pv_genesis_preparation_status_category(
    AncPrivateVaultGenesisPreparationRecordStatus status) {
  static const char *const categories[] = {
      "ok",                 "input.invalid",       "wire.length",
      "wire.magic",         "wire.version",        "wire.phase",
      "wire.flags",         "wire.reserved",       "range.generation",
      "range.timestamp",    "binding.identity",    "binding.handle",
      "binding.artifacts",  "binding.custody",     "binding.official",
      "binding.secret",     "binding.terminal",    "crypto.checksum",
      "transition.invalid", "binding.substitution",
  };
  return status >= 0 && status < (int)(sizeof(categories) / sizeof(categories[0]))
             ? categories[status]
             : "unknown";
}

AncPrivateVaultGenesisPreparationRecordStatus
anc_pv_genesis_preparation_handle_digest(
    const uint8_t handle[ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES],
    size_t handleLength, uint8_t digest[ANC_PV_HASH_BYTES]) {
  if (handle == NULL ||
      handleLength != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES ||
      digest == NULL) {
    return ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  }
  if (RangesOverlap(handle, ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES, digest,
                    ANC_PV_HASH_BYTES)) {
    return ANC_PV_GENESIS_PREPARATION_INVALID_ARGUMENT;
  }
  if (!Hash(digest, kHandleDomain, sizeof(kHandleDomain), handle,
            ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES)) {
    anc_pv_zeroize(digest, ANC_PV_HASH_BYTES);
    return ANC_PV_GENESIS_PREPARATION_CRYPTO_CHECKSUM;
  }
  return ANC_PV_GENESIS_PREPARATION_OK;
}

bool anc_pv_genesis_preparation_handle_verify(
    const uint8_t handle[ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES],
    size_t handleLength,
    const uint8_t expectedLookupId[ANC_PV_GENESIS_PREPARATION_LOOKUP_ID_BYTES],
    const uint8_t expectedDigest[ANC_PV_HASH_BYTES]) {
  if (handle == NULL ||
      handleLength != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES ||
      expectedLookupId == NULL || expectedDigest == NULL ||
      !IsEqual(handle, expectedLookupId,
               ANC_PV_GENESIS_PREPARATION_LOOKUP_ID_BYTES)) {
    return false;
  }
  uint8_t digest[ANC_PV_HASH_BYTES] = {0};
  const bool valid =
      anc_pv_genesis_preparation_handle_digest(handle, handleLength, digest) ==
          ANC_PV_GENESIS_PREPARATION_OK &&
      IsEqual(digest, expectedDigest, ANC_PV_HASH_BYTES);
  anc_pv_zeroize(digest, sizeof(digest));
  return valid;
}
