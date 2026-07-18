#include <node_api.h>

#include <dispatch/dispatch.h>
#include <xpc/xpc.h>

#include <cstring>
#include <memory>
#include <mutex>
#include <uuid/uuid.h>
#include <vector>

#include "RequestGate.h"

#define PV_SERVICE_IDENTIFIER "com.agentnative.desktop.private-vault-service"
#define PV_SERVICE_TEAM_IDENTIFIER "W3PMF2T3MW"
#define PV_SERVICE_REQUIREMENT                                                 \
  "anchor apple generic and identifier \"" PV_SERVICE_IDENTIFIER               \
  "\" and certificate leaf[subject.OU] = \"" PV_SERVICE_TEAM_IDENTIFIER "\""
#define PV_PROTOCOL_VERSION 2
#define PV_MAXIMUM_REPLY_FIELDS 12
#define PV_MAXIMUM_REPLY_STRING_BYTES 64
#define PV_GENESIS_CONFIRMATION_MAXIMUM_BYTES (64 * 1024)
#define PV_GENESIS_TRANSCRIPT_MAXIMUM_BYTES (4 * 1024)
#define PV_GENESIS_AUTHORIZATION_MAXIMUM_BYTES (256 * 1024)
#define PV_REQUEST_TIMEOUT_NANOSECONDS (2LL * NSEC_PER_SEC)

namespace {

PVRequestGate gRequestGate;

enum class PVOperation { Health, Lock, ResumeRotation, CommitGenesis };
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

struct PVParsedReply {
  PVFailure failure = PVFailure::Connection;
  bool available = false;
  char state[16] = {0};
  char rotationAckState[16] = {0};
  char vaultID[33] = {0};
  char headHash[65] = {0};
  char membershipHash[65] = {0};
  char recoveryWrapHash[65] = {0};
  uint64_t custodyGeneration = 0;
  uint64_t activeEpoch = 0;
  uint64_t sequence = 0;
  uint64_t recoveryGeneration = 0;
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
  uint64_t custodyGeneration = 0;
  uint64_t activeEpoch = 0;
  uint64_t sequence = 0;
  uint64_t recoveryGeneration = 0;
  std::vector<uint8_t> recoveryConfirmation;
  std::vector<uint8_t> bootstrapTranscript;
  std::vector<uint8_t> authorization;

  ~PVAsyncRequest() {
    if (!recoveryConfirmation.empty())
      PVClearBytes(recoveryConfirmation);
    if (!bootstrapTranscript.empty())
      PVClearBytes(bootstrapTranscript);
    if (!authorization.empty())
      PVClearBytes(authorization);
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

bool PVRequestIDMatches(xpc_object_t reply, const char *requestID) {
  xpc_object_t value = xpc_dictionary_get_value(reply, "requestId");
  if (value == nullptr || xpc_get_type(value) != XPC_TYPE_STRING)
    return false;
  const char *received = xpc_dictionary_get_string(reply, "requestId");
  return PVStringIsBounded(received, PV_MAXIMUM_REPLY_STRING_BYTES) &&
         strcmp(received, requestID) == 0;
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
        !PVStringIsBounded(xpc_dictionary_get_string(reply, "error"),
                           PV_MAXIMUM_REPLY_STRING_BYTES)) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    parsed.failure = PVFailure::ServiceError;
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

  const char *state = xpc_dictionary_get_string(reply, "state");
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
            : xpc_dictionary_get_string(reply, "rotationAckState");
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
                              : xpc_dictionary_get_string(reply, "vaultId");
    const char *headHash =
        head == nullptr || xpc_get_type(head) != XPC_TYPE_STRING
            ? nullptr
            : xpc_dictionary_get_string(reply, "headHash");
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
            ? xpc_dictionary_get_string(reply, "vaultId")
            : nullptr;
    const char *headHash =
        head != nullptr && xpc_get_type(head) == XPC_TYPE_STRING
            ? xpc_dictionary_get_string(reply, "headHash")
            : nullptr;
    const char *membershipHash =
        membership != nullptr && xpc_get_type(membership) == XPC_TYPE_STRING
            ? xpc_dictionary_get_string(reply, "membershipHash")
            : nullptr;
    const char *recoveryWrapHash =
        recoveryWrap != nullptr && xpc_get_type(recoveryWrap) == XPC_TYPE_STRING
            ? xpc_dictionary_get_string(reply, "recoveryWrapHash")
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
                              : "commit_genesis";

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
  if (request->operation == PVOperation::ResumeRotation)
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
    const PVParsedReply parsed =
        PVParseReply(reply, request->operation, requestID,
                     request->operation == PVOperation::ResumeRotation
                         ? request->vaultID
                         : nullptr);
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
    request->custodyGeneration = parsed.custodyGeneration;
    request->activeEpoch = parsed.activeEpoch;
    request->sequence = parsed.sequence;
    request->recoveryGeneration = parsed.recoveryGeneration;
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
                    : "commit_genesis");
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
  } else {
    delete request;
    napi_throw_type_error(env, nullptr,
                          "Private Vault native service request failed");
    return nullptr;
  }
  const size_t expectedArgumentCount =
      request->operation == PVOperation::ResumeRotation
          ? 2
      : request->operation == PVOperation::CommitGenesis ? 4
                                                         : 1;
  if (argc != expectedArgumentCount) {
    delete request;
    napi_throw_type_error(env, nullptr,
                          "Private Vault native service request failed");
    return nullptr;
  }
  if (request->operation == PVOperation::ResumeRotation) {
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
