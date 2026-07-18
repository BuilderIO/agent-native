#include <node_api.h>

#include <dispatch/dispatch.h>
#include <xpc/xpc.h>

#include <cstring>
#include <memory>
#include <mutex>
#include <uuid/uuid.h>
#include <vector>

#include "RequestGate.h"
#include "TrustedGenesisUI.h"

#define PV_SERVICE_IDENTIFIER "com.agentnative.desktop.private-vault-service"
#define PV_SERVICE_TEAM_IDENTIFIER "W3PMF2T3MW"
#define PV_SERVICE_REQUIREMENT                                                 \
  "anchor apple generic and identifier \"" PV_SERVICE_IDENTIFIER               \
  "\" and certificate leaf[subject.OU] = \"" PV_SERVICE_TEAM_IDENTIFIER "\""
#define PV_PROTOCOL_VERSION 3
#define PV_MAXIMUM_REPLY_FIELDS 12
#define PV_MAXIMUM_REPLY_STRING_BYTES 64
#define PV_GENESIS_CONFIRMATION_MAXIMUM_BYTES (64 * 1024)
#define PV_GENESIS_TRANSCRIPT_MAXIMUM_BYTES (4 * 1024)
#define PV_GENESIS_AUTHORIZATION_MAXIMUM_BYTES (256 * 1024)
#define PV_GENESIS_MNEMONIC_MAXIMUM_BYTES 512
#define PV_GENESIS_CANDIDATE_MAXIMUM_BYTES 1315072
#define PV_GENESIS_CHALLENGE_MAXIMUM_BYTES 2048
#define PV_GENESIS_RECEIPT_MAXIMUM_BYTES 2048
#define PV_GENESIS_REQUEST_MAXIMUM_BYTES 1317376
#define PV_GENESIS_APPEND_MAXIMUM_BYTES (64 * 1024 + 1024 * 1024 + 256)
#define PV_BOOTSTRAP_FRAME_MAXIMUM_BYTES 26746884
#define PV_REQUEST_TIMEOUT_NANOSECONDS (2LL * NSEC_PER_SEC)

namespace {

PVRequestGate gRequestGate;

enum class PVOperation {
  Health,
  Lock,
  ResumeRotation,
  CommitGenesis,
  CreateGenesis,
  ListGenesis,
  AuthorizeAdmission,
  AcceptAdmission,
  FinalizeGenesis,
  AcceptBootstrap,
  RecoverBegin,
  RecoverPage,
  RecoverStatus,
};
enum class PVFailure {
  None,
  UnsupportedOperation,
  Connection,
  Timeout,
  MalformedReply,
  ServiceError,
};

void PVClearBytes(std::vector<uint8_t> &value) {
  volatile uint8_t *bytes = value.data();
  for (size_t index = 0; index < value.size(); index += 1)
    bytes[index] = 0;
}

struct PVCandidate {
  char lookupID[33] = {0};
  char vaultID[33] = {0};
  std::vector<uint8_t> candidate;
};

struct PVParsedReply {
  PVFailure failure = PVFailure::Connection;
  bool available = false;
  char state[16] = {0};
  char rotationAckState[16] = {0};
  char vaultID[33] = {0};
  char headHash[65] = {0};
  char membershipHash[65] = {0};
  char recoveryWrapHash[65] = {0};
  char lookupID[33] = {0};
  char accountID[161] = {0};
  char workspaceID[161] = {0};
  char endpointID[33] = {0};
  char proofHeader[8193] = {0};
  uint64_t custodyGeneration = 0;
  uint64_t activeEpoch = 0;
  uint64_t sequence = 0;
  uint64_t recoveryGeneration = 0;
  uint64_t throughSequence = 0;
  uint64_t headSequence = 0;
  bool complete = false;
  std::vector<uint8_t> body;
  std::vector<PVCandidate> candidates;
};

class PVReplyState {
public:
  PVReplyState() : semaphore_(dispatch_semaphore_create(0)) {}

  ~PVReplyState() {
    std::lock_guard<std::mutex> guard(mutex_);
    if (reply_ != nullptr)
      xpc_release(reply_);
    dispatch_release(semaphore_);
  }

  dispatch_semaphore_t semaphore() const { return semaphore_; }

  void complete(xpc_object_t reply) {
    {
      std::lock_guard<std::mutex> guard(mutex_);
      if (completed_)
        return;
      if (reply != nullptr)
        reply_ = xpc_retain(reply);
      completed_ = true;
    }
    dispatch_semaphore_signal(semaphore_);
  }

  xpc_object_t copyReply() {
    std::lock_guard<std::mutex> guard(mutex_);
    return reply_ == nullptr ? nullptr : xpc_retain(reply_);
  }

private:
  dispatch_semaphore_t semaphore_;
  std::mutex mutex_;
  xpc_object_t reply_ = nullptr;
  bool completed_ = false;
};

xpc_object_t PVCopySynchronousReply(xpc_object_t message) {
  dispatch_queue_t queue =
      dispatch_queue_create("com.agentnative.desktop.private-vault-xpc-client",
                            DISPATCH_QUEUE_SERIAL);
  xpc_connection_t connection =
      xpc_connection_create_mach_service(PV_SERVICE_IDENTIFIER, queue, 0);
  if (connection == nullptr) {
    dispatch_release(queue);
    return nullptr;
  }
  const int requirementStatus =
      xpc_connection_set_peer_code_signing_requirement(connection,
                                                       PV_SERVICE_REQUIREMENT);
  if (requirementStatus != 0) {
    xpc_connection_cancel(connection);
    xpc_release(connection);
    dispatch_release(queue);
    return nullptr;
  }
  auto state = std::make_shared<PVReplyState>();
  xpc_connection_set_event_handler(connection, ^(xpc_object_t event) {
    if (xpc_get_type(event) == XPC_TYPE_ERROR)
      state->complete(event);
  });
  xpc_connection_resume(connection);
  xpc_connection_send_message_with_reply(connection, message, queue,
                                         ^(xpc_object_t reply) {
                                           state->complete(reply);
                                         });
  const long waitResult = dispatch_semaphore_wait(
      state->semaphore(),
      dispatch_time(DISPATCH_TIME_NOW, PV_REQUEST_TIMEOUT_NANOSECONDS));
  xpc_object_t reply = waitResult == 0 ? state->copyReply() : nullptr;
  xpc_connection_cancel(connection);
  xpc_release(connection);
  dispatch_release(queue);
  return reply;
}

struct PVAsyncRequest {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  PVOperation operation = PVOperation::Health;
  PVFailure failure = PVFailure::Connection;
  bool available = false;
  char state[16] = {0};
  char rotationAckState[16] = {0};
  char vaultID[33] = {0};
  char headHash[65] = {0};
  char membershipHash[65] = {0};
  char recoveryWrapHash[65] = {0};
  char lookupID[33] = {0};
  char accountID[161] = {0};
  char workspaceID[161] = {0};
  char endpointID[33] = {0};
  char proofHeader[8193] = {0};
  uint64_t custodyGeneration = 0;
  uint64_t activeEpoch = 0;
  uint64_t sequence = 0;
  uint64_t recoveryGeneration = 0;
  uint64_t throughSequence = 0;
  uint64_t headSequence = 0;
  bool complete = false;
  std::vector<uint8_t> recoveryConfirmation;
  std::vector<uint8_t> bootstrapTranscript;
  std::vector<uint8_t> authorization;
  std::vector<uint8_t> recoveryMnemonic;
  std::vector<uint8_t> challenge;
  std::vector<uint8_t> receipt;
  std::vector<uint8_t> body;
  std::vector<uint8_t> bootstrapFrame;
  std::vector<PVCandidate> candidates;

  ~PVAsyncRequest() {
    if (!recoveryConfirmation.empty())
      PVClearBytes(recoveryConfirmation);
    if (!bootstrapTranscript.empty())
      PVClearBytes(bootstrapTranscript);
    if (!authorization.empty())
      PVClearBytes(authorization);
    if (!recoveryMnemonic.empty())
      PVClearBytes(recoveryMnemonic);
    if (!challenge.empty())
      PVClearBytes(challenge);
    if (!receipt.empty())
      PVClearBytes(receipt);
    if (!body.empty())
      PVClearBytes(body);
    if (!bootstrapFrame.empty())
      PVClearBytes(bootstrapFrame);
    for (auto &candidate : candidates)
      PVClearBytes(candidate.candidate);
  }
};

bool PVStringIsBounded(const char *value, size_t maximumBytes) {
  if (value == nullptr)
    return false;
  const size_t length = strnlen(value, maximumBytes + 1);
  return length > 0 && length <= maximumBytes;
}

bool PVIsLowerHex(const char *value, size_t exactBytes) {
  if (value == nullptr || strnlen(value, exactBytes + 1) != exactBytes)
    return false;
  for (size_t index = 0; index < exactBytes; index++) {
    const char byte = value[index];
    if (!((byte >= '0' && byte <= '9') || (byte >= 'a' && byte <= 'f')))
      return false;
  }
  return true;
}

bool PVIsOpaqueID(const char *value) {
  if (!PVStringIsBounded(value, 160))
    return false;
  const size_t length = strlen(value);
  if (length < 8)
    return false;
  for (size_t index = 0; index < length; index += 1) {
    const char byte = value[index];
    const bool alphaNumeric =
        (byte >= 'a' && byte <= 'z') || (byte >= 'A' && byte <= 'Z') ||
        (byte >= '0' && byte <= '9');
    if (!alphaNumeric &&
        (index == 0 || (byte != '.' && byte != '_' && byte != ':' &&
                        byte != '-')))
      return false;
  }
  return true;
}

bool PVCopyBoundedData(xpc_object_t dictionary, const char *key,
                       size_t maximum, std::vector<uint8_t> &output) {
  xpc_object_t value = xpc_dictionary_get_value(dictionary, key);
  if (value == nullptr || xpc_get_type(value) != XPC_TYPE_DATA)
    return false;
  const size_t length = xpc_data_get_length(value);
  const void *bytes = xpc_data_get_bytes_ptr(value);
  if (bytes == nullptr || length == 0 || length > maximum)
    return false;
  try {
    const auto *start = static_cast<const uint8_t *>(bytes);
    output.assign(start, start + length);
    return true;
  } catch (...) {
    output.clear();
    return false;
  }
}

bool PVHasExactKeys(xpc_object_t dictionary, const char *const *keys,
                    size_t keyCount) {
  if (xpc_get_type(dictionary) != XPC_TYPE_DICTIONARY ||
      keyCount > PV_MAXIMUM_REPLY_FIELDS) {
    return false;
  }

  __block size_t fieldCount = 0;
  __block bool valid = true;
  xpc_dictionary_apply(dictionary, ^bool(const char *key, xpc_object_t value) {
    (void)value;
    fieldCount += 1;
    if (fieldCount > keyCount) {
      valid = false;
      return false;
    }
    bool found = false;
    for (size_t index = 0; index < keyCount; index += 1) {
      if (strcmp(key, keys[index]) == 0) {
        found = true;
        break;
      }
    }
    if (!found) {
      valid = false;
      return false;
    }
    return true;
  });
  return valid && fieldCount == keyCount;
}

const char *PVGetString(xpc_object_t dictionary, const char *key) {
  if (dictionary == nullptr || xpc_get_type(dictionary) != XPC_TYPE_DICTIONARY)
    return nullptr;
  xpc_object_t value = xpc_dictionary_get_value(dictionary, key);
  return value != nullptr && xpc_get_type(value) == XPC_TYPE_STRING
             ? xpc_dictionary_get_string(dictionary, key)
             : nullptr;
}

bool PVRequestIDMatches(xpc_object_t reply, const char *requestID) {
  xpc_object_t value = xpc_dictionary_get_value(reply, "requestId");
  if (value == nullptr || xpc_get_type(value) != XPC_TYPE_STRING)
    return false;
  const char *received = PVGetString(reply, "requestId");
  return PVStringIsBounded(received, PV_MAXIMUM_REPLY_STRING_BYTES) &&
         strcmp(received, requestID) == 0;
}

bool PVGenerateRequestID(char requestID[37]) {
  uuid_t value;
  uuid_generate_random(value);
  uuid_unparse_lower(value, requestID);
  return requestID[0] != '\0';
}

PVParsedReply PVParseReply(xpc_object_t reply, PVOperation operation,
                           const char *requestID,
                           const char *expectedVaultID);

bool PVPrepareTrustedGenesis(PVAsyncRequest *request) {
  char requestID[37] = {0};
  if (request == nullptr || !PVGenerateRequestID(requestID))
    return false;
  xpc_object_t message = xpc_dictionary_create(nullptr, nullptr, 0);
  xpc_dictionary_set_int64(message, "version", PV_PROTOCOL_VERSION);
  xpc_dictionary_set_string(message, "operation", "prepare_genesis");
  xpc_dictionary_set_string(message, "requestId", requestID);
  xpc_object_t reply = PVCopySynchronousReply(message);
  xpc_release(message);
  if (reply == nullptr || xpc_get_type(reply) != XPC_TYPE_DICTIONARY) {
    if (reply != nullptr)
      xpc_release(reply);
    return false;
  }
  const char *const keys[] = {"version",  "ok",          "requestId",
                              "state",    "lookupId",    "vaultId",
                              "expiresAtMs", "recoveryMnemonic"};
  const char *state = PVGetString(reply, "state");
  const char *lookupID = PVGetString(reply, "lookupId");
  const char *vaultID = PVGetString(reply, "vaultId");
  xpc_object_t version = xpc_dictionary_get_value(reply, "version");
  xpc_object_t ok = xpc_dictionary_get_value(reply, "ok");
  xpc_object_t expires = xpc_dictionary_get_value(reply, "expiresAtMs");
  const bool valid = PVHasExactKeys(reply, keys, 8) &&
                     version != nullptr &&
                     xpc_get_type(version) == XPC_TYPE_INT64 &&
                     xpc_dictionary_get_int64(reply, "version") ==
                         PV_PROTOCOL_VERSION &&
                     ok != nullptr && xpc_get_type(ok) == XPC_TYPE_BOOL &&
                     xpc_dictionary_get_bool(reply, "ok") &&
                     PVRequestIDMatches(reply, requestID) && state != nullptr &&
                     strcmp(state, "prepared") == 0 &&
                     PVIsLowerHex(lookupID, 32) && PVIsLowerHex(vaultID, 32) &&
                     expires != nullptr &&
                     xpc_get_type(expires) == XPC_TYPE_UINT64 &&
                     xpc_dictionary_get_uint64(reply, "expiresAtMs") > 0 &&
                     PVCopyBoundedData(reply, "recoveryMnemonic", 215,
                                       request->body);
  if (valid) {
    memcpy(request->lookupID, lookupID, 33);
    memcpy(request->vaultID, vaultID, 33);
  }
  xpc_release(reply);
  return valid;
}

bool PVInspectTrustedAdmission(PVAsyncRequest *request) {
  char requestID[37] = {0};
  if (request == nullptr || !PVIsLowerHex(request->lookupID, 32) ||
      request->challenge.empty() ||
      request->challenge.size() > PV_GENESIS_CHALLENGE_MAXIMUM_BYTES ||
      !PVGenerateRequestID(requestID))
    return false;
  xpc_object_t message = xpc_dictionary_create(nullptr, nullptr, 0);
  xpc_dictionary_set_int64(message, "version", PV_PROTOCOL_VERSION);
  xpc_dictionary_set_string(message, "operation", "inspect_admit");
  xpc_dictionary_set_string(message, "requestId", requestID);
  xpc_dictionary_set_string(message, "lookupId", request->lookupID);
  xpc_dictionary_set_data(message, "challenge", request->challenge.data(),
                          request->challenge.size());
  xpc_object_t reply = PVCopySynchronousReply(message);
  xpc_release(message);
  if (reply == nullptr || xpc_get_type(reply) != XPC_TYPE_DICTIONARY) {
    if (reply != nullptr)
      xpc_release(reply);
    return false;
  }
  const char *const keys[] = {"version", "ok",       "requestId",
                              "state",   "accountId", "workspaceId"};
  const char *state = PVGetString(reply, "state");
  const char *accountID = PVGetString(reply, "accountId");
  const char *workspaceID = PVGetString(reply, "workspaceId");
  xpc_object_t version = xpc_dictionary_get_value(reply, "version");
  xpc_object_t ok = xpc_dictionary_get_value(reply, "ok");
  const bool valid = PVHasExactKeys(reply, keys, 6) &&
                     version != nullptr &&
                     xpc_get_type(version) == XPC_TYPE_INT64 &&
                     xpc_dictionary_get_int64(reply, "version") ==
                         PV_PROTOCOL_VERSION &&
                     ok != nullptr && xpc_get_type(ok) == XPC_TYPE_BOOL &&
                     xpc_dictionary_get_bool(reply, "ok") &&
                     PVRequestIDMatches(reply, requestID) && state != nullptr &&
                     strcmp(state, "inspected") == 0 &&
                     PVIsOpaqueID(accountID) && PVIsOpaqueID(workspaceID);
  if (valid) {
    memcpy(request->accountID, accountID, strlen(accountID) + 1);
    memcpy(request->workspaceID, workspaceID, strlen(workspaceID) + 1);
  }
  xpc_release(reply);
  return valid;
}

bool PVInspectTrustedBootstrap(PVAsyncRequest *request) {
  char requestID[37] = {0};
  if (request == nullptr || request->bootstrapFrame.empty() ||
      request->bootstrapFrame.size() > PV_BOOTSTRAP_FRAME_MAXIMUM_BYTES ||
      !PVGenerateRequestID(requestID))
    return false;
  xpc_object_t message = xpc_dictionary_create(nullptr, nullptr, 0);
  xpc_dictionary_set_int64(message, "version", PV_PROTOCOL_VERSION);
  xpc_dictionary_set_string(message, "operation", "accept_bootstrap");
  xpc_dictionary_set_string(message, "requestId", requestID);
  xpc_dictionary_set_data(message, "bootstrapFrame",
                          request->bootstrapFrame.data(),
                          request->bootstrapFrame.size());
  xpc_object_t reply = PVCopySynchronousReply(message);
  xpc_release(message);
  if (reply == nullptr || xpc_get_type(reply) != XPC_TYPE_DICTIONARY) {
    if (reply != nullptr)
      xpc_release(reply);
    return false;
  }
  PVParsedReply parsed = PVParseReply(reply, PVOperation::AcceptBootstrap,
                                      requestID, nullptr);
  xpc_release(reply);
  if (parsed.failure != PVFailure::None)
    return false;
  memcpy(request->vaultID, parsed.vaultID, sizeof(request->vaultID));
  return true;
}

PVParsedReply PVParseReply(xpc_object_t reply, PVOperation operation,
                           const char *requestID, const char *expectedVaultID) {
  PVParsedReply parsed;
  if (reply == nullptr || xpc_get_type(reply) == XPC_TYPE_ERROR)
    return parsed;
  if (xpc_get_type(reply) != XPC_TYPE_DICTIONARY) {
    parsed.failure = PVFailure::MalformedReply;
    return parsed;
  }

  xpc_object_t version = xpc_dictionary_get_value(reply, "version");
  xpc_object_t ok = xpc_dictionary_get_value(reply, "ok");
  if (version == nullptr || xpc_get_type(version) != XPC_TYPE_INT64 ||
      xpc_dictionary_get_int64(reply, "version") != PV_PROTOCOL_VERSION ||
      ok == nullptr || xpc_get_type(ok) != XPC_TYPE_BOOL) {
    parsed.failure = PVFailure::MalformedReply;
    return parsed;
  }

  if (!xpc_dictionary_get_bool(reply, "ok")) {
    const char *const errorKeys[] = {"version", "ok", "error"};
    xpc_object_t error = xpc_dictionary_get_value(reply, "error");
    if (!PVHasExactKeys(reply, errorKeys, 3) || error == nullptr ||
        xpc_get_type(error) != XPC_TYPE_STRING ||
        !PVStringIsBounded(PVGetString(reply, "error"),
                           PV_MAXIMUM_REPLY_STRING_BYTES)) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    parsed.failure = PVFailure::ServiceError;
    return parsed;
  }

  if (operation == PVOperation::CreateGenesis) {
    const char *const keys[] = {"version",  "ok",      "requestId",
                                "state",    "lookupId", "vaultId",
                                "candidate"};
    const char *state = PVGetString(reply, "state");
    const char *lookupID = PVGetString(reply, "lookupId");
    const char *vaultID = PVGetString(reply, "vaultId");
    if (!PVHasExactKeys(reply, keys, 7) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, "committed") != 0 || !PVIsLowerHex(lookupID, 32) ||
        !PVIsLowerHex(vaultID, 32) ||
        !PVCopyBoundedData(reply, "candidate",
                           PV_GENESIS_CANDIDATE_MAXIMUM_BYTES, parsed.body)) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.lookupID, lookupID, 33);
    memcpy(parsed.vaultID, vaultID, 33);
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::ListGenesis) {
    const char *const keys[] = {"version", "ok", "requestId", "state",
                                "candidates"};
    const char *state = PVGetString(reply, "state");
    xpc_object_t values = xpc_dictionary_get_value(reply, "candidates");
    if (!PVHasExactKeys(reply, keys, 5) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, "pending") != 0 || values == nullptr ||
        xpc_get_type(values) != XPC_TYPE_ARRAY || xpc_array_get_count(values) > 64) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    const size_t count = xpc_array_get_count(values);
    try {
      parsed.candidates.reserve(count);
    } catch (...) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    for (size_t index = 0; index < count; index += 1) {
      xpc_object_t value = xpc_array_get_value(values, index);
      const char *const candidateKeys[] = {"lookupId", "vaultId", "candidate"};
      PVCandidate candidate;
      if (value == nullptr || xpc_get_type(value) != XPC_TYPE_DICTIONARY ||
          !PVHasExactKeys(value, candidateKeys, 3)) {
        parsed.failure = PVFailure::MalformedReply;
        return parsed;
      }
      const char *lookupID = PVGetString(value, "lookupId");
      const char *vaultID = PVGetString(value, "vaultId");
      if (!PVIsLowerHex(lookupID, 32) || !PVIsLowerHex(vaultID, 32) ||
          !PVCopyBoundedData(value, "candidate",
                             PV_GENESIS_CANDIDATE_MAXIMUM_BYTES,
                             candidate.candidate)) {
        parsed.failure = PVFailure::MalformedReply;
        return parsed;
      }
      memcpy(candidate.lookupID, lookupID, 33);
      memcpy(candidate.vaultID, vaultID, 33);
      parsed.candidates.push_back(std::move(candidate));
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::AuthorizeAdmission ||
      operation == PVOperation::AcceptAdmission) {
    const char *const keys[] = {
        "version",   "ok",       "requestId", "state", "accountId",
        "workspaceId", "vaultId", "endpointId", "body", "proofHeader"};
    const char *state = PVGetString(reply, "state");
    const char *accountID = PVGetString(reply, "accountId");
    const char *workspaceID =
        PVGetString(reply, "workspaceId");
    const char *vaultID = PVGetString(reply, "vaultId");
    const char *endpointID = PVGetString(reply, "endpointId");
    const char *proofHeader =
        PVGetString(reply, "proofHeader");
    const bool authorized = operation == PVOperation::AuthorizeAdmission;
    const size_t bodyMaximum = authorized ? PV_GENESIS_REQUEST_MAXIMUM_BYTES
                                          : PV_GENESIS_APPEND_MAXIMUM_BYTES;
    if (!PVHasExactKeys(reply, keys, 10) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, authorized ? "authorized" : "accepted") != 0 ||
        !PVIsOpaqueID(accountID) || !PVIsOpaqueID(workspaceID) ||
        !PVIsLowerHex(vaultID, 32) || !PVIsLowerHex(endpointID, 32) ||
        !PVStringIsBounded(proofHeader, 8192) ||
        !PVCopyBoundedData(reply, "body", bodyMaximum, parsed.body)) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.accountID, accountID, strlen(accountID) + 1);
    memcpy(parsed.workspaceID, workspaceID, strlen(workspaceID) + 1);
    memcpy(parsed.vaultID, vaultID, 33);
    memcpy(parsed.endpointID, endpointID, 33);
    memcpy(parsed.proofHeader, proofHeader, strlen(proofHeader) + 1);
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::FinalizeGenesis) {
    const char *const keys[] = {"version", "ok", "requestId", "state",
                                "lookupId"};
    const char *state = PVGetString(reply, "state");
    const char *lookupID = PVGetString(reply, "lookupId");
    if (!PVHasExactKeys(reply, keys, 5) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, "cleaned") != 0 || expectedVaultID == nullptr ||
        !PVIsLowerHex(lookupID, 32) || strcmp(lookupID, expectedVaultID) != 0) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.lookupID, lookupID, 33);
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::RecoverStatus) {
    const char *const keys[] = {"version", "ok", "requestId", "state",
                                "vaultId"};
    const char *state = PVGetString(reply, "state");
    const char *vaultID = PVGetString(reply, "vaultId");
    if (!PVHasExactKeys(reply, keys, 5) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        expectedVaultID == nullptr ||
        !PVIsLowerHex(vaultID, 32) || strcmp(vaultID, expectedVaultID) != 0 ||
        (strcmp(state, "committing") != 0 &&
         strcmp(state, "recovered") != 0 && strcmp(state, "failed") != 0)) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.vaultID, vaultID, 33);
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::AcceptBootstrap ||
      operation == PVOperation::RecoverBegin ||
      operation == PVOperation::RecoverPage) {
    const char *const keys[] = {
        "version",       "ok",           "requestId",
        "state",         "vaultId",      "throughSequence",
        "headSequence",  "headHash",     "complete",
    };
    const char *state = PVGetString(reply, "state");
    const char *vaultID = PVGetString(reply, "vaultId");
    const char *headHash = PVGetString(reply, "headHash");
    xpc_object_t through =
        xpc_dictionary_get_value(reply, "throughSequence");
    xpc_object_t head = xpc_dictionary_get_value(reply, "headSequence");
    xpc_object_t complete = xpc_dictionary_get_value(reply, "complete");
    const bool recovery = operation == PVOperation::RecoverBegin ||
                          operation == PVOperation::RecoverPage;
    if (!PVHasExactKeys(reply, keys, 9) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        !PVIsLowerHex(vaultID, 32) ||
        !PVIsLowerHex(headHash, 64) || through == nullptr ||
        xpc_get_type(through) != XPC_TYPE_UINT64 || head == nullptr ||
        xpc_get_type(head) != XPC_TYPE_UINT64 || complete == nullptr ||
        xpc_get_type(complete) != XPC_TYPE_BOOL ||
        xpc_dictionary_get_uint64(reply, "throughSequence") >
            UINT64_C(9007199254740991) ||
        xpc_dictionary_get_uint64(reply, "headSequence") >
            UINT64_C(9007199254740991) ||
        xpc_dictionary_get_uint64(reply, "throughSequence") >
            xpc_dictionary_get_uint64(reply, "headSequence")) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    const bool completeValue = xpc_dictionary_get_bool(reply, "complete");
    const char *expectedState =
        recovery ? (completeValue ? "committing" : "accepted") : "parsed";
    if (strcmp(state, expectedState) != 0) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.vaultID, vaultID, 33);
    memcpy(parsed.headHash, headHash, 65);
    parsed.throughSequence =
        xpc_dictionary_get_uint64(reply, "throughSequence");
    parsed.headSequence = xpc_dictionary_get_uint64(reply, "headSequence");
    parsed.complete = completeValue;
    if ((recovery && parsed.complete !=
                         (parsed.throughSequence == parsed.headSequence)) ||
        (!recovery && parsed.complete &&
         parsed.throughSequence != parsed.headSequence)) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    parsed.failure = PVFailure::None;
    return parsed;
  }

  const char *const healthKeys[] = {"version", "ok", "requestId",
                                    "state",   "available",
                                    "rotationAckState"};
  const char *const lockKeys[] = {"version", "ok", "requestId", "state"};
  const char *const rotationKeys[] = {
      "version",           "ok",       "requestId",
      "state",             "vaultId",  "custodyGeneration",
      "activeEpoch",       "sequence", "headHash",
  };
  const char *const genesisKeys[] = {
      "version",        "ok",                 "requestId",
      "state",          "vaultId",            "custodyGeneration",
      "activeEpoch",    "sequence",           "headHash",
      "membershipHash", "recoveryGeneration", "recoveryWrapHash",
  };
  const bool validKeys =
      operation == PVOperation::Health
          ? PVHasExactKeys(reply, healthKeys, 6)
      : operation == PVOperation::Lock
          ? PVHasExactKeys(reply, lockKeys, 4)
      : operation == PVOperation::CommitGenesis
          ? PVHasExactKeys(reply, genesisKeys, 12)
          : PVHasExactKeys(reply, rotationKeys, 9);
  xpc_object_t stateValue = xpc_dictionary_get_value(reply, "state");
  if (!validKeys || !PVRequestIDMatches(reply, requestID) ||
      stateValue == nullptr || xpc_get_type(stateValue) != XPC_TYPE_STRING) {
    parsed.failure = PVFailure::MalformedReply;
    return parsed;
  }

  const char *state = PVGetString(reply, "state");
  if (!PVStringIsBounded(state, sizeof(parsed.state) - 1)) {
    parsed.failure = PVFailure::MalformedReply;
    return parsed;
  }

  if (operation == PVOperation::Health) {
    xpc_object_t availableValue = xpc_dictionary_get_value(reply, "available");
    xpc_object_t rotationAckValue =
        xpc_dictionary_get_value(reply, "rotationAckState");
    const char *rotationAckState =
        rotationAckValue == nullptr ||
                xpc_get_type(rotationAckValue) != XPC_TYPE_STRING
            ? nullptr
            : PVGetString(reply, "rotationAckState");
    if (availableValue == nullptr ||
        xpc_get_type(availableValue) != XPC_TYPE_BOOL ||
        !PVStringIsBounded(rotationAckState,
                           sizeof(parsed.rotationAckState) - 1) ||
        (strcmp(rotationAckState, "unavailable") != 0 &&
         strcmp(rotationAckState, "idle") != 0 &&
         strcmp(rotationAckState, "pending") != 0 &&
         strcmp(rotationAckState, "retrying") != 0 &&
         strcmp(rotationAckState, "attention") != 0) ||
        (strcmp(state, "unavailable") != 0 &&
         strcmp(state, "uninitialized") != 0 && strcmp(state, "locked") != 0 &&
         strcmp(state, "unlocked") != 0 && strcmp(state, "closed") != 0)) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    parsed.available = xpc_dictionary_get_bool(reply, "available");
    if (parsed.available != (strcmp(state, "unavailable") != 0) ||
        ((strcmp(state, "unavailable") == 0) !=
         (strcmp(rotationAckState, "unavailable") == 0))) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.rotationAckState, rotationAckState,
           strlen(rotationAckState) + 1);
  } else if (operation == PVOperation::Lock) {
    if (strcmp(state, "locked") != 0) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
  } else if (operation == PVOperation::ResumeRotation) {
    xpc_object_t vault = xpc_dictionary_get_value(reply, "vaultId");
    xpc_object_t custody =
        xpc_dictionary_get_value(reply, "custodyGeneration");
    xpc_object_t epoch = xpc_dictionary_get_value(reply, "activeEpoch");
    xpc_object_t sequence = xpc_dictionary_get_value(reply, "sequence");
    xpc_object_t head = xpc_dictionary_get_value(reply, "headHash");
    const char *vaultID = vault == nullptr ||
                                  xpc_get_type(vault) != XPC_TYPE_STRING
                              ? nullptr
                              : PVGetString(reply, "vaultId");
    const char *headHash =
        head == nullptr || xpc_get_type(head) != XPC_TYPE_STRING
            ? nullptr
            : PVGetString(reply, "headHash");
    if (strcmp(state, "consumed") != 0 || expectedVaultID == nullptr ||
        !PVIsLowerHex(vaultID, 32) || strcmp(vaultID, expectedVaultID) != 0 ||
        !PVIsLowerHex(headHash, 64) || custody == nullptr ||
        xpc_get_type(custody) != XPC_TYPE_UINT64 || epoch == nullptr ||
        xpc_get_type(epoch) != XPC_TYPE_UINT64 || sequence == nullptr ||
        xpc_get_type(sequence) != XPC_TYPE_UINT64 ||
        xpc_dictionary_get_uint64(reply, "custodyGeneration") == 0 ||
        xpc_dictionary_get_uint64(reply, "activeEpoch") == 0) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.vaultID, vaultID, 33);
    memcpy(parsed.headHash, headHash, 65);
    parsed.custodyGeneration =
        xpc_dictionary_get_uint64(reply, "custodyGeneration");
    parsed.activeEpoch = xpc_dictionary_get_uint64(reply, "activeEpoch");
    parsed.sequence = xpc_dictionary_get_uint64(reply, "sequence");
  } else {
    xpc_object_t vault = xpc_dictionary_get_value(reply, "vaultId");
    xpc_object_t custody =
        xpc_dictionary_get_value(reply, "custodyGeneration");
    xpc_object_t epoch = xpc_dictionary_get_value(reply, "activeEpoch");
    xpc_object_t sequence = xpc_dictionary_get_value(reply, "sequence");
    xpc_object_t head = xpc_dictionary_get_value(reply, "headHash");
    xpc_object_t membership =
        xpc_dictionary_get_value(reply, "membershipHash");
    xpc_object_t recoveryGeneration =
        xpc_dictionary_get_value(reply, "recoveryGeneration");
    xpc_object_t recoveryWrap =
        xpc_dictionary_get_value(reply, "recoveryWrapHash");
    const char *vaultID =
        vault != nullptr && xpc_get_type(vault) == XPC_TYPE_STRING
            ? PVGetString(reply, "vaultId")
            : nullptr;
    const char *headHash =
        head != nullptr && xpc_get_type(head) == XPC_TYPE_STRING
            ? PVGetString(reply, "headHash")
            : nullptr;
    const char *membershipHash =
        membership != nullptr && xpc_get_type(membership) == XPC_TYPE_STRING
            ? PVGetString(reply, "membershipHash")
            : nullptr;
    const char *recoveryWrapHash =
        recoveryWrap != nullptr && xpc_get_type(recoveryWrap) == XPC_TYPE_STRING
            ? PVGetString(reply, "recoveryWrapHash")
            : nullptr;
    if (strcmp(state, "committed") != 0 || !PVIsLowerHex(vaultID, 32) ||
        !PVIsLowerHex(headHash, 64) || !PVIsLowerHex(membershipHash, 64) ||
        !PVIsLowerHex(recoveryWrapHash, 64) || custody == nullptr ||
        xpc_get_type(custody) != XPC_TYPE_UINT64 || epoch == nullptr ||
        xpc_get_type(epoch) != XPC_TYPE_UINT64 || sequence == nullptr ||
        xpc_get_type(sequence) != XPC_TYPE_UINT64 ||
        recoveryGeneration == nullptr ||
        xpc_get_type(recoveryGeneration) != XPC_TYPE_UINT64 ||
        xpc_dictionary_get_uint64(reply, "custodyGeneration") != 2 ||
        xpc_dictionary_get_uint64(reply, "activeEpoch") != 1 ||
        xpc_dictionary_get_uint64(reply, "sequence") != 0 ||
        xpc_dictionary_get_uint64(reply, "recoveryGeneration") != 1) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.vaultID, vaultID, 33);
    memcpy(parsed.headHash, headHash, 65);
    memcpy(parsed.membershipHash, membershipHash, 65);
    memcpy(parsed.recoveryWrapHash, recoveryWrapHash, 65);
    parsed.custodyGeneration =
        xpc_dictionary_get_uint64(reply, "custodyGeneration");
    parsed.activeEpoch = xpc_dictionary_get_uint64(reply, "activeEpoch");
    parsed.sequence = xpc_dictionary_get_uint64(reply, "sequence");
    parsed.recoveryGeneration =
        xpc_dictionary_get_uint64(reply, "recoveryGeneration");
  }

  memcpy(parsed.state, state, strlen(state) + 1);
  parsed.failure = PVFailure::None;
  return parsed;
}

void PVExecute(napi_env env, void *data) {
  (void)env;
  auto *request = static_cast<PVAsyncRequest *>(data);
  const char *operation = request->operation == PVOperation::Health
                              ? "health"
                          : request->operation == PVOperation::Lock
                              ? "lock"
                          : request->operation == PVOperation::ResumeRotation
                              ? "resume_rotation"
                          : request->operation == PVOperation::CommitGenesis
                              ? "commit_genesis"
                          : request->operation == PVOperation::CreateGenesis
                              ? "confirm_genesis"
                          : request->operation == PVOperation::ListGenesis
                              ? "list_genesis"
                          : request->operation == PVOperation::AuthorizeAdmission
                              ? "authorize_admit"
                          : request->operation == PVOperation::AcceptAdmission
                              ? "accept_admit"
                          : request->operation == PVOperation::AcceptBootstrap
                              ? "accept_bootstrap"
                          : request->operation == PVOperation::RecoverBegin
                              ? "recover_begin"
                          : request->operation == PVOperation::RecoverPage
                              ? "recover_page"
                          : request->operation == PVOperation::RecoverStatus
                              ? "recover_status"
                              : "finalize_genesis";

  uuid_t requestUUID;
  char requestID[37] = {0};
  uuid_generate_random(requestUUID);
  uuid_unparse_lower(requestUUID, requestID);

  dispatch_queue_t queue =
      dispatch_queue_create("com.agentnative.desktop.private-vault-xpc-client",
                            DISPATCH_QUEUE_SERIAL);
  xpc_connection_t connection =
      xpc_connection_create_mach_service(PV_SERVICE_IDENTIFIER, queue, 0);
  if (connection == nullptr) {
    dispatch_release(queue);
    request->failure = PVFailure::Connection;
    return;
  }

  const int requirementStatus =
      xpc_connection_set_peer_code_signing_requirement(connection,
                                                       PV_SERVICE_REQUIREMENT);
  if (requirementStatus != 0) {
    xpc_connection_cancel(connection);
    xpc_release(connection);
    dispatch_release(queue);
    request->failure = PVFailure::Connection;
    return;
  }

  auto state = std::make_shared<PVReplyState>();
  xpc_connection_set_event_handler(connection, ^(xpc_object_t event) {
    if (xpc_get_type(event) == XPC_TYPE_ERROR)
      state->complete(event);
  });
  xpc_connection_resume(connection);

  xpc_object_t message = xpc_dictionary_create(nullptr, nullptr, 0);
  xpc_dictionary_set_int64(message, "version", PV_PROTOCOL_VERSION);
  xpc_dictionary_set_string(message, "operation", operation);
  xpc_dictionary_set_string(message, "requestId", requestID);
  if (request->operation == PVOperation::ResumeRotation ||
      request->operation == PVOperation::RecoverStatus)
    xpc_dictionary_set_string(message, "vaultId", request->vaultID);
  if (request->operation == PVOperation::CommitGenesis) {
    xpc_dictionary_set_data(message, "recoveryConfirmation",
                            request->recoveryConfirmation.data(),
                            request->recoveryConfirmation.size());
    xpc_dictionary_set_data(message, "bootstrapTranscript",
                            request->bootstrapTranscript.data(),
                            request->bootstrapTranscript.size());
    xpc_dictionary_set_data(message, "authorization",
                            request->authorization.data(),
                            request->authorization.size());
  }
  if (request->operation == PVOperation::CreateGenesis) {
    xpc_dictionary_set_string(message, "lookupId", request->lookupID);
    xpc_dictionary_set_data(message, "recoveryMnemonic",
                            request->recoveryMnemonic.data(),
                            request->recoveryMnemonic.size());
  }
  if (request->operation == PVOperation::AuthorizeAdmission ||
      request->operation == PVOperation::AcceptAdmission) {
    xpc_dictionary_set_string(message, "lookupId", request->lookupID);
    xpc_dictionary_set_data(message, "challenge", request->challenge.data(),
                            request->challenge.size());
  }
  if (request->operation == PVOperation::AcceptAdmission ||
      request->operation == PVOperation::FinalizeGenesis) {
    xpc_dictionary_set_string(message, "lookupId", request->lookupID);
    xpc_dictionary_set_data(message, "receipt", request->receipt.data(),
                            request->receipt.size());
  }
  if (request->operation == PVOperation::AcceptBootstrap ||
      request->operation == PVOperation::RecoverBegin ||
      request->operation == PVOperation::RecoverPage) {
    xpc_dictionary_set_data(message, "bootstrapFrame",
                            request->bootstrapFrame.data(),
                            request->bootstrapFrame.size());
  }
  if (request->operation == PVOperation::RecoverBegin) {
    xpc_dictionary_set_data(message, "recoveryMnemonic",
                            request->recoveryMnemonic.data(),
                            request->recoveryMnemonic.size());
  }
  xpc_connection_send_message_with_reply(connection, message, queue,
                                         ^(xpc_object_t reply) {
                                           state->complete(reply);
                                         });
  xpc_release(message);

  const long waitResult = dispatch_semaphore_wait(
      state->semaphore(),
      dispatch_time(DISPATCH_TIME_NOW, PV_REQUEST_TIMEOUT_NANOSECONDS));
  if (waitResult != 0) {
    request->failure = PVFailure::Timeout;
  } else {
    xpc_object_t reply = state->copyReply();
    const char *expectedID =
        request->operation == PVOperation::ResumeRotation
            ? request->vaultID
        : request->operation == PVOperation::RecoverStatus
            ? request->vaultID
        : request->operation == PVOperation::FinalizeGenesis
            ? request->lookupID
            : nullptr;
    PVParsedReply parsed =
        PVParseReply(reply, request->operation, requestID, expectedID);
    if (reply != nullptr)
      xpc_release(reply);
    request->failure = parsed.failure;
    request->available = parsed.available;
    memcpy(request->state, parsed.state, sizeof(request->state));
    memcpy(request->rotationAckState, parsed.rotationAckState,
           sizeof(request->rotationAckState));
    memcpy(request->vaultID, parsed.vaultID, sizeof(request->vaultID));
    memcpy(request->headHash, parsed.headHash, sizeof(request->headHash));
    memcpy(request->membershipHash, parsed.membershipHash,
           sizeof(request->membershipHash));
    memcpy(request->recoveryWrapHash, parsed.recoveryWrapHash,
           sizeof(request->recoveryWrapHash));
    memcpy(request->lookupID, parsed.lookupID, sizeof(request->lookupID));
    memcpy(request->accountID, parsed.accountID, sizeof(request->accountID));
    memcpy(request->workspaceID, parsed.workspaceID,
           sizeof(request->workspaceID));
    memcpy(request->endpointID, parsed.endpointID,
           sizeof(request->endpointID));
    memcpy(request->proofHeader, parsed.proofHeader,
           sizeof(request->proofHeader));
    request->custodyGeneration = parsed.custodyGeneration;
    request->activeEpoch = parsed.activeEpoch;
    request->sequence = parsed.sequence;
    request->recoveryGeneration = parsed.recoveryGeneration;
    request->throughSequence = parsed.throughSequence;
    request->headSequence = parsed.headSequence;
    request->complete = parsed.complete;
    request->body = std::move(parsed.body);
    request->candidates = std::move(parsed.candidates);
  }

  xpc_connection_cancel(connection);
  xpc_release(connection);
  dispatch_release(queue);
}

bool PVCreateString(napi_env env, const char *value, napi_value *result) {
  return napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, result) ==
         napi_ok;
}

void PVSetString(napi_env env, napi_value object, const char *key,
                 const char *value) {
  napi_value property;
  if (PVCreateString(env, value, &property)) {
    napi_set_named_property(env, object, key, property);
  }
}

void PVSetSafeInteger(napi_env env, napi_value object, const char *key,
                      uint64_t value) {
  napi_value property;
  if (value <= UINT64_C(9007199254740991) &&
      napi_create_double(env, static_cast<double>(value), &property) ==
          napi_ok)
    napi_set_named_property(env, object, key, property);
}

bool PVSetBuffer(napi_env env, napi_value object, const char *key,
                 const std::vector<uint8_t> &value) {
  if (value.empty())
    return false;
  napi_value property;
  void *copied = nullptr;
  if (napi_create_buffer_copy(env, value.size(), value.data(), &copied,
                              &property) != napi_ok ||
      copied == nullptr ||
      napi_set_named_property(env, object, key, property) != napi_ok)
    return false;
  return true;
}

void PVComplete(napi_env env, napi_status status, void *data) {
  auto *request = static_cast<PVAsyncRequest *>(data);
  gRequestGate.release();
  if (status != napi_ok || request->failure != PVFailure::None) {
    napi_value message;
    napi_value error;
    PVCreateString(env, "Private Vault native service request failed",
                   &message);
    napi_create_error(env, nullptr, message, &error);
    napi_reject_deferred(env, request->deferred, error);
  } else {
    napi_value result;
    napi_create_object(env, &result);
    napi_value version;
    napi_create_int32(env, PV_PROTOCOL_VERSION, &version);
    napi_set_named_property(env, result, "version", version);
    PVSetString(env, result, "operation",
                request->operation == PVOperation::Health
                    ? "health"
                : request->operation == PVOperation::Lock
                    ? "lock"
                : request->operation == PVOperation::ResumeRotation
                    ? "resume_rotation"
                : request->operation == PVOperation::CommitGenesis
                    ? "commit_genesis"
                : request->operation == PVOperation::CreateGenesis
                    ? "create_genesis"
                : request->operation == PVOperation::ListGenesis
                    ? "list_genesis"
                : request->operation == PVOperation::AuthorizeAdmission
                    ? "authorize_admit"
                : request->operation == PVOperation::AcceptAdmission
                    ? "accept_admit"
                : request->operation == PVOperation::AcceptBootstrap
                    ? "accept_bootstrap"
                : request->operation == PVOperation::RecoverBegin
                    ? "recover_begin"
                : request->operation == PVOperation::RecoverPage
                    ? "recover_page"
                : request->operation == PVOperation::RecoverStatus
                    ? "recover_status"
                    : "finalize_genesis");
    PVSetString(env, result, "state", request->state);
    if (request->operation == PVOperation::Health) {
      napi_value available;
      napi_get_boolean(env, request->available, &available);
      napi_set_named_property(env, result, "available", available);
      PVSetString(env, result, "rotationAckState",
                  request->rotationAckState);
    } else if (request->operation == PVOperation::ResumeRotation) {
      PVSetString(env, result, "vaultId", request->vaultID);
      PVSetString(env, result, "headHash", request->headHash);
      PVSetSafeInteger(env, result, "custodyGeneration",
                       request->custodyGeneration);
      PVSetSafeInteger(env, result, "activeEpoch", request->activeEpoch);
      PVSetSafeInteger(env, result, "sequence", request->sequence);
    } else if (request->operation == PVOperation::RecoverStatus) {
      PVSetString(env, result, "vaultId", request->vaultID);
    } else if (request->operation == PVOperation::CommitGenesis) {
      PVSetString(env, result, "vaultId", request->vaultID);
      PVSetString(env, result, "headHash", request->headHash);
      PVSetString(env, result, "membershipHash", request->membershipHash);
      PVSetString(env, result, "recoveryWrapHash", request->recoveryWrapHash);
      PVSetSafeInteger(env, result, "custodyGeneration",
                       request->custodyGeneration);
      PVSetSafeInteger(env, result, "activeEpoch", request->activeEpoch);
      PVSetSafeInteger(env, result, "sequence", request->sequence);
      PVSetSafeInteger(env, result, "recoveryGeneration",
                       request->recoveryGeneration);
    } else if (request->operation == PVOperation::CreateGenesis) {
      PVSetString(env, result, "lookupId", request->lookupID);
      PVSetString(env, result, "vaultId", request->vaultID);
      if (!PVSetBuffer(env, result, "candidate", request->body)) {
        napi_value message;
        napi_value error;
        PVCreateString(env, "Private Vault native service request failed",
                       &message);
        napi_create_error(env, nullptr, message, &error);
        napi_reject_deferred(env, request->deferred, error);
        napi_delete_async_work(env, request->work);
        delete request;
        return;
      }
    } else if (request->operation == PVOperation::ListGenesis) {
      napi_value candidates;
      napi_create_array_with_length(env, request->candidates.size(),
                                    &candidates);
      bool valid = true;
      for (size_t index = 0; index < request->candidates.size(); index += 1) {
        napi_value candidate;
        napi_create_object(env, &candidate);
        PVSetString(env, candidate, "lookupId",
                    request->candidates[index].lookupID);
        PVSetString(env, candidate, "vaultId",
                    request->candidates[index].vaultID);
        valid = valid && PVSetBuffer(env, candidate, "candidate",
                                    request->candidates[index].candidate) &&
                napi_set_element(env, candidates, index, candidate) == napi_ok;
      }
      if (!valid || napi_set_named_property(env, result, "candidates",
                                            candidates) != napi_ok) {
        napi_value message;
        napi_value error;
        PVCreateString(env, "Private Vault native service request failed",
                       &message);
        napi_create_error(env, nullptr, message, &error);
        napi_reject_deferred(env, request->deferred, error);
        napi_delete_async_work(env, request->work);
        delete request;
        return;
      }
    } else if (request->operation == PVOperation::AuthorizeAdmission ||
               request->operation == PVOperation::AcceptAdmission) {
      PVSetString(env, result, "accountId", request->accountID);
      PVSetString(env, result, "workspaceId", request->workspaceID);
      PVSetString(env, result, "vaultId", request->vaultID);
      PVSetString(env, result, "endpointId", request->endpointID);
      PVSetString(env, result, "proofHeader", request->proofHeader);
      if (!PVSetBuffer(env, result, "body", request->body)) {
        napi_value message;
        napi_value error;
        PVCreateString(env, "Private Vault native service request failed",
                       &message);
        napi_create_error(env, nullptr, message, &error);
        napi_reject_deferred(env, request->deferred, error);
        napi_delete_async_work(env, request->work);
        delete request;
        return;
      }
    } else if (request->operation == PVOperation::FinalizeGenesis) {
      PVSetString(env, result, "lookupId", request->lookupID);
    } else if (request->operation == PVOperation::AcceptBootstrap ||
               request->operation == PVOperation::RecoverBegin ||
               request->operation == PVOperation::RecoverPage) {
      PVSetString(env, result, "vaultId", request->vaultID);
      PVSetSafeInteger(env, result, "throughSequence",
                       request->throughSequence);
      PVSetSafeInteger(env, result, "headSequence", request->headSequence);
      PVSetString(env, result, "headHash", request->headHash);
      napi_value complete;
      napi_get_boolean(env, request->complete, &complete);
      napi_set_named_property(env, result, "complete", complete);
    }
    napi_resolve_deferred(env, request->deferred, result);
  }
  napi_delete_async_work(env, request->work);
  delete request;
}

napi_value PVRequest(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4];
  napi_value promise;
  auto *request = new PVAsyncRequest();
  const uint8_t *genesisInputs[3] = {nullptr, nullptr, nullptr};
  size_t genesisInputLengths[3] = {0, 0, 0};
  const uint8_t *ceremonyInputs[2] = {nullptr, nullptr};
  size_t ceremonyInputLengths[2] = {0, 0};

  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      argc < 1 || argc > 4) {
    delete request;
    napi_throw_type_error(env, nullptr,
                          "Private Vault native service request failed");
    return nullptr;
  }

  napi_valuetype argumentType;
  size_t length = 0;
  if (napi_typeof(env, argv[0], &argumentType) != napi_ok ||
      argumentType != napi_string ||
      napi_get_value_string_utf8(env, argv[0], nullptr, 0, &length) !=
          napi_ok ||
      length == 0 || length > 16) {
    delete request;
    napi_throw_type_error(env, nullptr,
                          "Private Vault native service request failed");
    return nullptr;
  }

  char operation[17] = {0};
  if (napi_get_value_string_utf8(env, argv[0], operation, sizeof(operation),
                                 &length) != napi_ok) {
    delete request;
    napi_throw_type_error(env, nullptr,
                          "Private Vault native service request failed");
    return nullptr;
  }
  if (strcmp(operation, "health") == 0) {
    request->operation = PVOperation::Health;
  } else if (strcmp(operation, "lock") == 0) {
    request->operation = PVOperation::Lock;
  } else if (strcmp(operation, "resume_rotation") == 0) {
    request->operation = PVOperation::ResumeRotation;
  } else if (strcmp(operation, "commit_genesis") == 0) {
    request->operation = PVOperation::CommitGenesis;
  } else if (strcmp(operation, "create_genesis") == 0) {
    request->operation = PVOperation::CreateGenesis;
  } else if (strcmp(operation, "list_genesis") == 0) {
    request->operation = PVOperation::ListGenesis;
  } else if (strcmp(operation, "authorize_admit") == 0) {
    request->operation = PVOperation::AuthorizeAdmission;
  } else if (strcmp(operation, "accept_admit") == 0) {
    request->operation = PVOperation::AcceptAdmission;
  } else if (strcmp(operation, "finalize_genesis") == 0) {
    request->operation = PVOperation::FinalizeGenesis;
  } else if (strcmp(operation, "accept_bootstrap") == 0) {
    request->operation = PVOperation::AcceptBootstrap;
  } else if (strcmp(operation, "recover_begin") == 0) {
    request->operation = PVOperation::RecoverBegin;
  } else if (strcmp(operation, "recover_page") == 0) {
    request->operation = PVOperation::RecoverPage;
  } else if (strcmp(operation, "recover_status") == 0) {
    request->operation = PVOperation::RecoverStatus;
  } else {
    delete request;
    napi_throw_type_error(env, nullptr,
                          "Private Vault native service request failed");
    return nullptr;
  }
  const size_t expectedArgumentCount =
      request->operation == PVOperation::ResumeRotation ||
              request->operation == PVOperation::RecoverStatus
          ? 2
      : request->operation == PVOperation::CommitGenesis ? 4
      : request->operation == PVOperation::AuthorizeAdmission
          ? 3
      : request->operation == PVOperation::AcceptAdmission ? 4
      : request->operation == PVOperation::FinalizeGenesis ? 3
      : request->operation == PVOperation::AcceptBootstrap ||
              request->operation == PVOperation::RecoverBegin ||
              request->operation == PVOperation::RecoverPage
          ? 2
          : 1;
  if (argc != expectedArgumentCount) {
    delete request;
    napi_throw_type_error(env, nullptr,
                          "Private Vault native service request failed");
    return nullptr;
  }
  if (request->operation == PVOperation::ResumeRotation ||
      request->operation == PVOperation::RecoverStatus) {
    size_t vaultLength = 0;
    if (napi_typeof(env, argv[1], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[1], request->vaultID,
                                   sizeof(request->vaultID),
                                   &vaultLength) != napi_ok ||
        vaultLength != 32 || !PVIsLowerHex(request->vaultID, 32)) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
  }
  if (request->operation == PVOperation::CommitGenesis) {
    const size_t maximumLengths[] = {
        PV_GENESIS_CONFIRMATION_MAXIMUM_BYTES,
        PV_GENESIS_TRANSCRIPT_MAXIMUM_BYTES,
        PV_GENESIS_AUTHORIZATION_MAXIMUM_BYTES,
    };
    for (size_t index = 0; index < 3; index += 1) {
      void *bytes = nullptr;
      size_t byteLength = 0;
      bool isBuffer = false;
      if (napi_is_buffer(env, argv[index + 1], &isBuffer) != napi_ok ||
          !isBuffer ||
          napi_get_buffer_info(env, argv[index + 1], &bytes, &byteLength) !=
              napi_ok ||
          bytes == nullptr || byteLength == 0 ||
          byteLength > maximumLengths[index]) {
        delete request;
        napi_throw_type_error(env, nullptr,
                              "Private Vault native service request failed");
        return nullptr;
      }
      genesisInputs[index] = static_cast<const uint8_t *>(bytes);
      genesisInputLengths[index] = byteLength;
    }
  }
  const uint8_t *bootstrapFrame = nullptr;
  size_t bootstrapFrameLength = 0;
  if (request->operation == PVOperation::AcceptBootstrap ||
      request->operation == PVOperation::RecoverBegin ||
      request->operation == PVOperation::RecoverPage) {
    void *bytes = nullptr;
    bool isBuffer = false;
    if (napi_is_buffer(env, argv[1], &isBuffer) != napi_ok || !isBuffer ||
        napi_get_buffer_info(env, argv[1], &bytes, &bootstrapFrameLength) !=
            napi_ok ||
        bytes == nullptr || bootstrapFrameLength == 0 ||
        bootstrapFrameLength > PV_BOOTSTRAP_FRAME_MAXIMUM_BYTES) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
    bootstrapFrame = static_cast<const uint8_t *>(bytes);
  }
  if (request->operation == PVOperation::AuthorizeAdmission ||
      request->operation == PVOperation::AcceptAdmission ||
      request->operation == PVOperation::FinalizeGenesis) {
    size_t lookupLength = 0;
    if (napi_typeof(env, argv[1], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[1], request->lookupID,
                                   sizeof(request->lookupID),
                                   &lookupLength) != napi_ok ||
        lookupLength != 32 || !PVIsLowerHex(request->lookupID, 32)) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
    const size_t inputCount =
        request->operation == PVOperation::AcceptAdmission ? 2 : 1;
    for (size_t index = 0; index < inputCount; index += 1) {
      void *bytes = nullptr;
      size_t byteLength = 0;
      bool isBuffer = false;
      const size_t maximum =
          request->operation == PVOperation::FinalizeGenesis || index == 1
              ? PV_GENESIS_RECEIPT_MAXIMUM_BYTES
              : PV_GENESIS_CHALLENGE_MAXIMUM_BYTES;
      if (napi_is_buffer(env, argv[index + 2], &isBuffer) != napi_ok ||
          !isBuffer ||
          napi_get_buffer_info(env, argv[index + 2], &bytes, &byteLength) !=
              napi_ok ||
          bytes == nullptr || byteLength == 0 || byteLength > maximum) {
        delete request;
        napi_throw_type_error(env, nullptr,
                              "Private Vault native service request failed");
        return nullptr;
      }
      ceremonyInputs[index] = static_cast<const uint8_t *>(bytes);
      ceremonyInputLengths[index] = byteLength;
    }
  }

  // Acquire before a work item enters libuv. A hostile caller can therefore
  // occupy at most one shared worker, while every concurrent request receives
  // an immediate bounded rejection instead of becoming another two-second job.
  if (!gRequestGate.tryAcquire()) {
    napi_deferred deferred;
    napi_value message;
    napi_value error;
    if (napi_create_promise(env, &deferred, &promise) != napi_ok) {
      delete request;
      return nullptr;
    }
    PVCreateString(env, "Private Vault native service request failed",
                   &message);
    napi_create_error(env, nullptr, message, &error);
    napi_reject_deferred(env, deferred, error);
    delete request;
    return promise;
  }

  if (request->operation == PVOperation::CommitGenesis) {
    std::vector<uint8_t> *outputs[] = {
        &request->recoveryConfirmation,
        &request->bootstrapTranscript,
        &request->authorization,
    };
    try {
      for (size_t index = 0; index < 3; index += 1) {
        outputs[index]->assign(genesisInputs[index],
                               genesisInputs[index] +
                                   genesisInputLengths[index]);
      }
    } catch (...) {
      gRequestGate.release();
      delete request;
      napi_throw_error(env, nullptr,
                       "Private Vault native service request failed");
      return nullptr;
    }
  }
  if (request->operation == PVOperation::AcceptBootstrap ||
      request->operation == PVOperation::RecoverBegin ||
      request->operation == PVOperation::RecoverPage) {
    try {
      request->bootstrapFrame.assign(
          bootstrapFrame, bootstrapFrame + bootstrapFrameLength);
    } catch (...) {
      gRequestGate.release();
      delete request;
      napi_throw_error(env, nullptr,
                       "Private Vault native service request failed");
      return nullptr;
    }
  }
  if (request->operation == PVOperation::RecoverBegin) {
    std::vector<uint8_t> recoveryPhrase;
    const bool collected = PVInspectTrustedBootstrap(request) &&
                           PVTrustedRecoveryCollectPhrase(request->vaultID,
                                                          recoveryPhrase);
    if (!collected || recoveryPhrase.empty() ||
        recoveryPhrase.size() > PV_GENESIS_MNEMONIC_MAXIMUM_BYTES) {
      if (!recoveryPhrase.empty())
        PVClearBytes(recoveryPhrase);
      gRequestGate.release();
      delete request;
      napi_throw_error(env, nullptr,
                       "Private Vault native service request failed");
      return nullptr;
    }
    request->recoveryMnemonic = std::move(recoveryPhrase);
  }
  if (request->operation == PVOperation::AuthorizeAdmission ||
      request->operation == PVOperation::AcceptAdmission ||
      request->operation == PVOperation::FinalizeGenesis) {
    try {
      if (request->operation == PVOperation::FinalizeGenesis) {
        request->receipt.assign(
            ceremonyInputs[0], ceremonyInputs[0] + ceremonyInputLengths[0]);
      } else {
        request->challenge.assign(
            ceremonyInputs[0], ceremonyInputs[0] + ceremonyInputLengths[0]);
        if (request->operation == PVOperation::AcceptAdmission)
          request->receipt.assign(
              ceremonyInputs[1], ceremonyInputs[1] + ceremonyInputLengths[1]);
      }
    } catch (...) {
      gRequestGate.release();
      delete request;
      napi_throw_error(env, nullptr,
                       "Private Vault native service request failed");
      return nullptr;
    }
  }
  if (request->operation == PVOperation::CreateGenesis) {
    const bool prepared = PVPrepareTrustedGenesis(request);
    std::vector<uint8_t> confirmation;
    const bool confirmed =
        prepared &&
        PVTrustedGenesisCollectFullPhrase(request->body, confirmation);
    if (!request->body.empty())
      PVClearBytes(request->body);
    request->body.clear();
    if (!confirmed || confirmation.empty() ||
        confirmation.size() > PV_GENESIS_MNEMONIC_MAXIMUM_BYTES) {
      if (!confirmation.empty())
        PVClearBytes(confirmation);
      gRequestGate.release();
      delete request;
      napi_throw_error(env, nullptr,
                       "Private Vault native service request failed");
      return nullptr;
    }
    request->recoveryMnemonic = std::move(confirmation);
  }
  if (request->operation == PVOperation::AuthorizeAdmission &&
      (!PVInspectTrustedAdmission(request) ||
       !PVTrustedGenesisConfirmAdmission(request->accountID,
                                         request->workspaceID))) {
    gRequestGate.release();
    delete request;
    napi_throw_error(env, nullptr,
                     "Private Vault native service request failed");
    return nullptr;
  }

  if (napi_create_promise(env, &request->deferred, &promise) != napi_ok) {
    gRequestGate.release();
    delete request;
    return nullptr;
  }
  napi_value resourceName;
  PVCreateString(env, "private-vault-xpc-request", &resourceName);
  if (napi_create_async_work(env, nullptr, resourceName, PVExecute, PVComplete,
                             request, &request->work) != napi_ok ||
      napi_queue_async_work(env, request->work) != napi_ok) {
    napi_value message;
    napi_value error;
    PVCreateString(env, "Private Vault native service request failed",
                   &message);
    napi_create_error(env, nullptr, message, &error);
    napi_reject_deferred(env, request->deferred, error);
    if (request->work != nullptr)
      napi_delete_async_work(env, request->work);
    gRequestGate.release();
    delete request;
  }
  return promise;
}

napi_value PVInitialize(napi_env env, napi_value exports) {
  napi_value request;
  if (napi_create_function(env, "request", NAPI_AUTO_LENGTH, PVRequest, nullptr,
                           &request) != napi_ok) {
    return nullptr;
  }
  napi_set_named_property(env, exports, "request", request);
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, PVInitialize)
