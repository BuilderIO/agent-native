#include <node_api.h>

#include <dispatch/dispatch.h>
#include <xpc/xpc.h>

#include <cstring>
#include <cmath>
#include <memory>
#include <mutex>
#include <uuid/uuid.h>
#include <vector>

#include "RequestGate.h"
#include "TrustedGenesisUI.h"
#include "TrustedEnrollmentUI.h"

#define PV_SERVICE_IDENTIFIER "com.agentnative.desktop.private-vault-service"
#define PV_SERVICE_TEAM_IDENTIFIER "W3PMF2T3MW"
#define PV_SERVICE_REQUIREMENT                                                 \
  "anchor apple generic and identifier \"" PV_SERVICE_IDENTIFIER               \
  "\" and certificate leaf[subject.OU] = \"" PV_SERVICE_TEAM_IDENTIFIER "\""
#define PV_PROTOCOL_VERSION 3
#define PV_MAXIMUM_REPLY_FIELDS 24
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
#define PV_JOB_ENVELOPE_MAXIMUM_BYTES (16 * 1024 * 1024 + 64 * 1024)
#define PV_JOB_PAYLOAD_MAXIMUM_BYTES (16 * 1024 * 1024)
#define PV_ENROLLMENT_CHALLENGE_MAXIMUM_BYTES (64 * 1024)
#define PV_ENROLLMENT_AUTHORIZATION_MAXIMUM_BYTES (256 * 1024)
#define PV_OBJECT_PLAINTEXT_MAXIMUM_BYTES (1024 * 1024)
#define PV_OBJECT_REVISION_MAXIMUM_BYTES (1024 * 1024 + 64 * 1024)
#define PV_EXPORT_PLAINTEXT_MAXIMUM_BYTES (256 * 1024 * 1024)
#define PV_EXPORT_ARCHIVE_MAXIMUM_BYTES                                        \
  (PV_EXPORT_PLAINTEXT_MAXIMUM_BYTES + 64 * 1024)
#define PV_REQUEST_TIMEOUT_NANOSECONDS (2LL * NSEC_PER_SEC)

namespace {

bool PVIsContentObjectType(const char *value) {
  return value != nullptr &&
         (strcmp(value,
                 "application/vnd.agent-native.content-document+json") == 0 ||
          strcmp(value,
                 "application/vnd.agent-native.content-vault-manifest+json") ==
              0);
}

PVRequestGate gRequestGate;

enum class PVOperation {
  Health,
  Lock,
  Unlock,
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
  EnrollmentBootstrap,
  RecoverStatus,
  CreateGrant,
  ListGrants,
  ListMembers,
  RevokeGrant,
  SealJob,
  OpenResult,
  OpenJob,
  SealResult,
  CompleteResult,
  PendingResult,
  SignRequest,
  PrepareEnrollment,
  ChallengeEnrollment,
  ConfirmEnrollment,
  AuthorizeEnrollment,
  ActivateEnrollment,
  SealObject,
  OpenObject,
  SealJobObject,
  OpenJobObject,
  SealExport,
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

struct PVGrantSummary {
  char grantRef[65] = {0};
  char subjectEndpointID[33] = {0};
  char subjectAgentID[33] = {0};
  uint64_t issuedAt = 0;
  uint64_t expiresAt = 0;
  bool revoked = false;
  bool pendingRevocation = false;
};

struct PVMemberSummary {
  char endpointID[33] = {0};
  char role[9] = {0};
  bool unattended = false;
  bool current = false;
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
  char jobHash[65] = {0};
  char grantRef[65] = {0};
  char recipientEndpointID[33] = {0};
  char subjectAgentID[33] = {0};
  char senderEndpointID[33] = {0};
  char jobID[33] = {0};
  char resultState[10] = {0};
  char algorithmID[161] = {0};
  char operationName[121] = {0};
  char providerID[161] = {0};
  char destination[161] = {0};
  char candidateEndpointID[33] = {0};
  char sasCode[12] = {0};
  char offerHash[65] = {0};
  char objectID[33] = {0};
  char contentType[121] = {0};
  char exportID[33] = {0};
  uint64_t custodyGeneration = 0;
  uint64_t activeEpoch = 0;
  uint64_t sequence = 0;
  uint64_t recoveryGeneration = 0;
  uint64_t throughSequence = 0;
  uint64_t headSequence = 0;
  uint64_t hostedEpoch = 0;
  uint64_t hostedRetryCount = 0;
  uint64_t issuedAt = 0;
  uint64_t expiresAt = 0;
  uint64_t objectRevision = 0;
  uint64_t plaintextLength = 0;
  bool complete = false;
  std::vector<uint8_t> body;
  std::vector<uint8_t> grantID;
  std::vector<uint8_t> grantRefBytes;
  std::vector<uint8_t> resourceID;
  std::vector<uint8_t> disclosureEnvelope;
  std::vector<uint8_t> disclosureID;
  std::vector<uint8_t> disclosureScopeHash;
  std::vector<uint8_t> writerEndpointID;
  std::vector<uint8_t> revisionID;
  std::vector<uint8_t> sasTranscriptHash;
  std::vector<PVCandidate> candidates;
  std::vector<PVGrantSummary> grants;
  std::vector<PVMemberSummary> members;
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
  char jobID[33] = {0};
  char grantRef[65] = {0};
  char recipientEndpointID[33] = {0};
  char subjectAgentID[33] = {0};
  char senderEndpointID[33] = {0};
  char resultState[10] = {0};
  char algorithmID[161] = {0};
  char operationName[121] = {0};
  char providerID[161] = {0};
  char destination[161] = {0};
  char candidateEndpointID[33] = {0};
  char sasCode[12] = {0};
  char offerHash[65] = {0};
  char objectID[33] = {0};
  char contentType[121] = {0};
  char exportID[33] = {0};
  char sourceSnapshotHash[65] = {0};
  char accountID[161] = {0};
  char workspaceID[161] = {0};
  char endpointID[33] = {0};
  char proofHeader[8193] = {0};
  char jobHash[65] = {0};
  uint64_t custodyGeneration = 0;
  uint64_t activeEpoch = 0;
  uint64_t sequence = 0;
  uint64_t recoveryGeneration = 0;
  uint64_t throughSequence = 0;
  uint64_t headSequence = 0;
  uint64_t hostedEpoch = 0;
  uint64_t hostedRetryCount = 0;
  uint64_t issuedAt = 0;
  uint64_t expiresAt = 0;
  uint64_t objectRevision = 0;
  uint64_t plaintextLength = 0;
  uint64_t exportCreatedAt = 0;
  uint64_t exportObjectCount = 0;
  bool complete = false;
  std::vector<uint8_t> recoveryConfirmation;
  std::vector<uint8_t> bootstrapTranscript;
  std::vector<uint8_t> authorization;
  std::vector<uint8_t> recoveryMnemonic;
  std::vector<uint8_t> challenge;
  std::vector<uint8_t> enrollmentOffer;
  std::vector<uint8_t> enrollmentCandidateKeyProof;
  std::vector<uint8_t> enrollmentSasDecision;
  std::vector<uint8_t> receipt;
  std::vector<uint8_t> body;
  std::vector<uint8_t> grantID;
  std::vector<uint8_t> grantRefBytes;
  std::vector<uint8_t> bootstrapFrame;
  std::vector<uint8_t> jobEnvelope;
  std::vector<uint8_t> resultPayload;
  std::vector<uint8_t> resourceID;
  std::vector<uint8_t> disclosureEnvelope;
  std::vector<uint8_t> disclosureID;
  std::vector<uint8_t> disclosureScopeHash;
  std::vector<uint8_t> objectPayload;
  std::vector<uint8_t> exportPlaintext;
  std::vector<uint8_t> writerEndpointID;
  std::vector<uint8_t> revisionID;
  std::vector<uint8_t> sasTranscriptHash;
  std::vector<PVCandidate> candidates;
  std::vector<PVGrantSummary> grants;
  std::vector<PVMemberSummary> members;

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
    if (!enrollmentOffer.empty())
      PVClearBytes(enrollmentOffer);
    if (!enrollmentCandidateKeyProof.empty())
      PVClearBytes(enrollmentCandidateKeyProof);
    if (!enrollmentSasDecision.empty())
      PVClearBytes(enrollmentSasDecision);
    if (!receipt.empty())
      PVClearBytes(receipt);
    if (!body.empty())
      PVClearBytes(body);
    if (!grantID.empty())
      PVClearBytes(grantID);
    if (!grantRefBytes.empty())
      PVClearBytes(grantRefBytes);
    if (!bootstrapFrame.empty())
      PVClearBytes(bootstrapFrame);
    if (!jobEnvelope.empty())
      PVClearBytes(jobEnvelope);
    if (!resultPayload.empty())
      PVClearBytes(resultPayload);
    if (!resourceID.empty())
      PVClearBytes(resourceID);
    if (!disclosureEnvelope.empty())
      PVClearBytes(disclosureEnvelope);
    if (!disclosureID.empty())
      PVClearBytes(disclosureID);
    if (!disclosureScopeHash.empty())
      PVClearBytes(disclosureScopeHash);
    if (!objectPayload.empty())
      PVClearBytes(objectPayload);
    if (!exportPlaintext.empty())
      PVClearBytes(exportPlaintext);
    if (!writerEndpointID.empty())
      PVClearBytes(writerEndpointID);
    if (!revisionID.empty())
      PVClearBytes(revisionID);
    if (!sasTranscriptHash.empty())
      PVClearBytes(sasTranscriptHash);
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

bool PVConfirmTrustedEnrollment(PVAsyncRequest *request) {
  char inspectRequestID[37] = {0};
  if (request == nullptr || !PVIsLowerHex(request->vaultID, 32) ||
      request->challenge.empty() ||
      request->challenge.size() > PV_ENROLLMENT_CHALLENGE_MAXIMUM_BYTES ||
      !PVGenerateRequestID(inspectRequestID))
    return false;

  xpc_object_t inspect = xpc_dictionary_create(nullptr, nullptr, 0);
  xpc_dictionary_set_int64(inspect, "version", PV_PROTOCOL_VERSION);
  xpc_dictionary_set_string(inspect, "operation", "inspect_enroll");
  xpc_dictionary_set_string(inspect, "requestId", inspectRequestID);
  xpc_dictionary_set_string(inspect, "vaultId", request->vaultID);
  xpc_dictionary_set_data(inspect, "challenge", request->challenge.data(),
                          request->challenge.size());
  xpc_object_t inspectReply = PVCopySynchronousReply(inspect);
  xpc_release(inspect);
  if (inspectReply == nullptr ||
      xpc_get_type(inspectReply) != XPC_TYPE_DICTIONARY) {
    if (inspectReply != nullptr)
      xpc_release(inspectReply);
    return false;
  }
  const char *const inspectKeys[] = {
      "version",          "ok",             "requestId", "state",
      "ceremonyToken",    "sasCode",        "candidateEndpointId",
      "membershipRole",   "unattended",     "sasTranscriptHash",
  };
  const char *state = PVGetString(inspectReply, "state");
  const char *token = PVGetString(inspectReply, "ceremonyToken");
  const char *sasCode = PVGetString(inspectReply, "sasCode");
  const char *candidate = PVGetString(inspectReply, "candidateEndpointId");
  const char *role = PVGetString(inspectReply, "membershipRole");
  xpc_object_t version = xpc_dictionary_get_value(inspectReply, "version");
  xpc_object_t ok = xpc_dictionary_get_value(inspectReply, "ok");
  xpc_object_t unattended =
      xpc_dictionary_get_value(inspectReply, "unattended");
  std::vector<uint8_t> transcriptHash;
  const bool inspected =
      PVHasExactKeys(inspectReply, inspectKeys, 10) && version != nullptr &&
      xpc_get_type(version) == XPC_TYPE_INT64 &&
      xpc_dictionary_get_int64(inspectReply, "version") ==
          PV_PROTOCOL_VERSION &&
      ok != nullptr && xpc_get_type(ok) == XPC_TYPE_BOOL &&
      xpc_dictionary_get_bool(inspectReply, "ok") &&
      PVRequestIDMatches(inspectReply, inspectRequestID) && state != nullptr &&
      strcmp(state, "inspected") == 0 && PVIsLowerHex(token, 32) &&
      PVIsLowerHex(candidate, 32) && role != nullptr &&
      strcmp(role, "broker") == 0 && unattended != nullptr &&
      xpc_get_type(unattended) == XPC_TYPE_BOOL &&
      xpc_dictionary_get_bool(inspectReply, "unattended") &&
      PVCopyBoundedData(inspectReply, "sasTranscriptHash", 32,
                        transcriptHash) &&
      transcriptHash.size() == 32 &&
      PVTrustedEnrollmentValidateInput(sasCode, candidate, role, true,
                                       transcriptHash.data(),
                                       transcriptHash.size());
  char tokenCopy[33] = {0};
  char sasCopy[12] = {0};
  char candidateCopy[33] = {0};
  if (inspected) {
    memcpy(tokenCopy, token, sizeof tokenCopy);
    memcpy(sasCopy, sasCode, sizeof sasCopy);
    memcpy(candidateCopy, candidate, sizeof candidateCopy);
  }
  xpc_release(inspectReply);
  if (!inspected) {
    PVClearBytes(transcriptHash);
    return false;
  }

  const PVTrustedEnrollmentDecision decision = PVTrustedEnrollmentConfirmSAS(
      sasCopy, candidateCopy, "broker", true, transcriptHash.data(),
      transcriptHash.size());
  PVClearBytes(transcriptHash);
  if (decision == PVTrustedEnrollmentDecision::Cancelled)
    return false;

  char decideRequestID[37] = {0};
  if (!PVGenerateRequestID(decideRequestID))
    return false;
  const char *decisionName =
      decision == PVTrustedEnrollmentDecision::Confirmed ? "confirmed"
                                                         : "mismatch";
  xpc_object_t decide = xpc_dictionary_create(nullptr, nullptr, 0);
  xpc_dictionary_set_int64(decide, "version", PV_PROTOCOL_VERSION);
  xpc_dictionary_set_string(decide, "operation", "decide_enroll");
  xpc_dictionary_set_string(decide, "requestId", decideRequestID);
  xpc_dictionary_set_string(decide, "ceremonyToken", tokenCopy);
  xpc_dictionary_set_string(decide, "decision", decisionName);
  xpc_object_t decideReply = PVCopySynchronousReply(decide);
  xpc_release(decide);
  if (decideReply == nullptr ||
      xpc_get_type(decideReply) != XPC_TYPE_DICTIONARY) {
    if (decideReply != nullptr)
      xpc_release(decideReply);
    return false;
  }
  const char *const decideKeys[] = {
      "version", "ok", "requestId", "state", "sasDecision",
  };
  const char *decidedState = PVGetString(decideReply, "state");
  version = xpc_dictionary_get_value(decideReply, "version");
  ok = xpc_dictionary_get_value(decideReply, "ok");
  const bool decided =
      PVHasExactKeys(decideReply, decideKeys, 5) && version != nullptr &&
      xpc_get_type(version) == XPC_TYPE_INT64 &&
      xpc_dictionary_get_int64(decideReply, "version") ==
          PV_PROTOCOL_VERSION &&
      ok != nullptr && xpc_get_type(ok) == XPC_TYPE_BOOL &&
      xpc_dictionary_get_bool(decideReply, "ok") &&
      PVRequestIDMatches(decideReply, decideRequestID) &&
      decidedState != nullptr && strcmp(decidedState, decisionName) == 0 &&
      PVCopyBoundedData(decideReply, "sasDecision", 2048, request->body);
  if (decided) {
    memcpy(request->state, decidedState, strlen(decidedState) + 1);
  } else if (!request->body.empty()) {
    PVClearBytes(request->body);
  }
  xpc_release(decideReply);
  return decided;
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

  if (operation == PVOperation::SealExport) {
    const char *const keys[] = {
        "version", "ok", "requestId", "state", "vaultId", "exportId",
        "archive",
    };
    const char *state = PVGetString(reply, "state");
    const char *vaultID = PVGetString(reply, "vaultId");
    const char *exportID = PVGetString(reply, "exportId");
    if (!PVHasExactKeys(reply, keys, 7) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, "sealed") != 0 || !PVIsLowerHex(vaultID, 32) ||
        expectedVaultID == nullptr || strcmp(vaultID, expectedVaultID) != 0 ||
        !PVIsLowerHex(exportID, 32) ||
        !PVCopyBoundedData(reply, "archive", PV_EXPORT_ARCHIVE_MAXIMUM_BYTES,
                           parsed.body)) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.vaultID, vaultID, 33);
    memcpy(parsed.exportID, exportID, 33);
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::CreateGrant) {
    const char *const keys[] = {
        "version", "ok", "requestId", "state", "vaultId",
        "recipientEndpointId", "subjectAgentId", "grantId", "grantRef",
        "issuedAt", "expiresAt", "grantEnvelope",
    };
    const char *state = PVGetString(reply, "state");
    const char *vaultID = PVGetString(reply, "vaultId");
    const char *recipient = PVGetString(reply, "recipientEndpointId");
    const char *subjectAgent = PVGetString(reply, "subjectAgentId");
    xpc_object_t issued = xpc_dictionary_get_value(reply, "issuedAt");
    xpc_object_t expires = xpc_dictionary_get_value(reply, "expiresAt");
    const uint64_t issuedAt =
        issued != nullptr && xpc_get_type(issued) == XPC_TYPE_UINT64
            ? xpc_dictionary_get_uint64(reply, "issuedAt")
            : 0;
    const uint64_t expiresAt =
        expires != nullptr && xpc_get_type(expires) == XPC_TYPE_UINT64
            ? xpc_dictionary_get_uint64(reply, "expiresAt")
            : 0;
    if (!PVHasExactKeys(reply, keys, 12) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, "created") != 0 || !PVIsLowerHex(vaultID, 32) ||
        expectedVaultID == nullptr || strcmp(vaultID, expectedVaultID) != 0 ||
        !PVIsLowerHex(recipient, 32) || !PVIsLowerHex(subjectAgent, 32) ||
        issuedAt == 0 ||
        expiresAt <= issuedAt ||
        expiresAt > UINT64_C(9007199254740991) ||
        !PVCopyBoundedData(reply, "grantId", 16, parsed.grantID) ||
        parsed.grantID.size() != 16 ||
        !PVCopyBoundedData(reply, "grantRef", 32, parsed.grantRefBytes) ||
        parsed.grantRefBytes.size() != 32 ||
        !PVCopyBoundedData(reply, "grantEnvelope", 64 * 1024, parsed.body)) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.vaultID, vaultID, 33);
    memcpy(parsed.recipientEndpointID, recipient, 33);
    memcpy(parsed.subjectAgentID, subjectAgent, 33);
    parsed.issuedAt = issuedAt;
    parsed.expiresAt = expiresAt;
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::RevokeGrant) {
    const char *const keys[] = {
        "version", "ok", "requestId", "state", "vaultId", "grantRef",
    };
    const char *state = PVGetString(reply, "state");
    const char *vaultID = PVGetString(reply, "vaultId");
    const char *grantRef = PVGetString(reply, "grantRef");
    if (!PVHasExactKeys(reply, keys, 6) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, "revoked") != 0 || !PVIsLowerHex(vaultID, 32) ||
        expectedVaultID == nullptr || strcmp(vaultID, expectedVaultID) != 0 ||
        !PVIsLowerHex(grantRef, 64)) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.vaultID, vaultID, 33);
    memcpy(parsed.grantRef, grantRef, 65);
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::ListGrants) {
    const char *const keys[] = {
        "version", "ok", "requestId", "state", "vaultId", "grants",
    };
    const char *state = PVGetString(reply, "state");
    const char *vaultID = PVGetString(reply, "vaultId");
    xpc_object_t grants = xpc_dictionary_get_value(reply, "grants");
    if (!PVHasExactKeys(reply, keys, 6) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, "listed") != 0 || !PVIsLowerHex(vaultID, 32) ||
        expectedVaultID == nullptr || strcmp(vaultID, expectedVaultID) != 0 ||
        grants == nullptr || xpc_get_type(grants) != XPC_TYPE_ARRAY ||
        xpc_array_get_count(grants) > 256) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    const size_t count = xpc_array_get_count(grants);
    try {
      parsed.grants.reserve(count);
    } catch (...) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    for (size_t index = 0; index < count; index += 1) {
      xpc_object_t item = xpc_array_get_value(grants, index);
      const char *grantRef = item == nullptr ? nullptr
                                             : PVGetString(item, "grantRef");
      const char *subjectEndpoint = item == nullptr
          ? nullptr
          : PVGetString(item, "subjectEndpointId");
      const char *subjectAgent = item == nullptr
          ? nullptr
          : PVGetString(item, "subjectAgentId");
      xpc_object_t issued = item == nullptr
          ? nullptr
          : xpc_dictionary_get_value(item, "issuedAt");
      xpc_object_t expires = item == nullptr
          ? nullptr
          : xpc_dictionary_get_value(item, "expiresAt");
      xpc_object_t revoked = item == nullptr
          ? nullptr
          : xpc_dictionary_get_value(item, "revoked");
      xpc_object_t pending = item == nullptr
          ? nullptr
          : xpc_dictionary_get_value(item, "pendingRevocation");
      const char *const baseKeys[] = {
          "grantRef", "subjectEndpointId", "issuedAt", "expiresAt",
          "revoked", "pendingRevocation",
      };
      const char *const agentKeys[] = {
          "grantRef", "subjectEndpointId", "subjectAgentId", "issuedAt",
          "expiresAt", "revoked", "pendingRevocation",
      };
      const bool hasAgent = subjectAgent != nullptr;
      uint64_t issuedAt = issued != nullptr &&
              xpc_get_type(issued) == XPC_TYPE_UINT64
          ? xpc_dictionary_get_uint64(item, "issuedAt")
          : 0;
      uint64_t expiresAt = expires != nullptr &&
              xpc_get_type(expires) == XPC_TYPE_UINT64
          ? xpc_dictionary_get_uint64(item, "expiresAt")
          : 0;
      if (item == nullptr || xpc_get_type(item) != XPC_TYPE_DICTIONARY ||
          !(hasAgent ? PVHasExactKeys(item, agentKeys, 7)
                     : PVHasExactKeys(item, baseKeys, 6)) ||
          !PVIsLowerHex(grantRef, 64) ||
          !PVIsLowerHex(subjectEndpoint, 32) ||
          (hasAgent && !PVIsLowerHex(subjectAgent, 32)) || issuedAt == 0 ||
          issuedAt > UINT64_C(9007199254740991) || expiresAt <= issuedAt ||
          expiresAt > UINT64_C(9007199254740991) || revoked == nullptr ||
          xpc_get_type(revoked) != XPC_TYPE_BOOL || pending == nullptr ||
          xpc_get_type(pending) != XPC_TYPE_BOOL) {
        parsed.failure = PVFailure::MalformedReply;
        parsed.grants.clear();
        return parsed;
      }
      PVGrantSummary summary;
      for (const PVGrantSummary &existing : parsed.grants) {
        if (strcmp(existing.grantRef, grantRef) == 0) {
          parsed.failure = PVFailure::MalformedReply;
          parsed.grants.clear();
          return parsed;
        }
      }
      memcpy(summary.grantRef, grantRef, 65);
      memcpy(summary.subjectEndpointID, subjectEndpoint, 33);
      if (hasAgent) memcpy(summary.subjectAgentID, subjectAgent, 33);
      summary.issuedAt = issuedAt;
      summary.expiresAt = expiresAt;
      summary.revoked = xpc_dictionary_get_bool(item, "revoked");
      summary.pendingRevocation =
          xpc_dictionary_get_bool(item, "pendingRevocation");
      parsed.grants.push_back(summary);
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.vaultID, vaultID, 33);
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::ListMembers) {
    const char *const keys[] = {
        "version", "ok", "requestId", "state", "vaultId", "members",
    };
    const char *state = PVGetString(reply, "state");
    const char *vaultID = PVGetString(reply, "vaultId");
    xpc_object_t members = xpc_dictionary_get_value(reply, "members");
    if (!PVHasExactKeys(reply, keys, 6) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, "listed") != 0 || !PVIsLowerHex(vaultID, 32) ||
        expectedVaultID == nullptr || strcmp(vaultID, expectedVaultID) != 0 ||
        members == nullptr || xpc_get_type(members) != XPC_TYPE_ARRAY ||
        xpc_array_get_count(members) == 0 ||
        xpc_array_get_count(members) > 64) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    const size_t count = xpc_array_get_count(members);
    try {
      parsed.members.reserve(count);
    } catch (...) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    size_t currentCount = 0;
    for (size_t index = 0; index < count; index += 1) {
      xpc_object_t item = xpc_array_get_value(members, index);
      const char *const itemKeys[] = {
          "endpointId", "role", "unattended", "current",
      };
      const char *endpointID =
          item == nullptr ? nullptr : PVGetString(item, "endpointId");
      const char *role = item == nullptr ? nullptr : PVGetString(item, "role");
      xpc_object_t unattended = item == nullptr
          ? nullptr
          : xpc_dictionary_get_value(item, "unattended");
      xpc_object_t current = item == nullptr
          ? nullptr
          : xpc_dictionary_get_value(item, "current");
      const bool isEndpoint = role != nullptr && strcmp(role, "endpoint") == 0;
      const bool isBroker = role != nullptr && strcmp(role, "broker") == 0;
      const bool unattendedValue =
          unattended != nullptr && xpc_get_type(unattended) == XPC_TYPE_BOOL
              ? xpc_dictionary_get_bool(item, "unattended")
              : false;
      const bool currentValue =
          current != nullptr && xpc_get_type(current) == XPC_TYPE_BOOL
              ? xpc_dictionary_get_bool(item, "current")
              : false;
      bool duplicate = false;
      if (endpointID != nullptr)
        for (const PVMemberSummary &existing : parsed.members)
          duplicate =
              duplicate || strcmp(existing.endpointID, endpointID) == 0;
      if (item == nullptr || xpc_get_type(item) != XPC_TYPE_DICTIONARY ||
          !PVHasExactKeys(item, itemKeys, 4) ||
          !PVIsLowerHex(endpointID, 32) || (!isEndpoint && !isBroker) ||
          unattended == nullptr || xpc_get_type(unattended) != XPC_TYPE_BOOL ||
          current == nullptr || xpc_get_type(current) != XPC_TYPE_BOOL ||
          unattendedValue != isBroker || (currentValue && !isEndpoint) ||
          duplicate) {
        parsed.failure = PVFailure::MalformedReply;
        parsed.members.clear();
        return parsed;
      }
      PVMemberSummary summary;
      memcpy(summary.endpointID, endpointID, 33);
      memcpy(summary.role, role, strlen(role) + 1);
      summary.unattended = unattendedValue;
      summary.current = currentValue;
      if (currentValue) currentCount += 1;
      parsed.members.push_back(summary);
    }
    if (currentCount != 1) {
      parsed.failure = PVFailure::MalformedReply;
      parsed.members.clear();
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.vaultID, vaultID, 33);
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::SealJob) {
    const char *const keys[] = {
        "version", "ok", "requestId", "state", "vaultId", "jobId",
        "recipientEndpointId", "epoch", "issuedAt", "expiresAt",
        "algorithmId", "jobEnvelope",
    };
    const char *state = PVGetString(reply, "state");
    const char *vaultID = PVGetString(reply, "vaultId");
    const char *jobID = PVGetString(reply, "jobId");
    const char *recipient = PVGetString(reply, "recipientEndpointId");
    const char *algorithm = PVGetString(reply, "algorithmId");
    xpc_object_t epoch = xpc_dictionary_get_value(reply, "epoch");
    xpc_object_t issued = xpc_dictionary_get_value(reply, "issuedAt");
    xpc_object_t expires = xpc_dictionary_get_value(reply, "expiresAt");
    const uint64_t parsedEpoch =
        epoch != nullptr && xpc_get_type(epoch) == XPC_TYPE_UINT64
            ? xpc_dictionary_get_uint64(reply, "epoch")
            : 0;
    const uint64_t issuedAt =
        issued != nullptr && xpc_get_type(issued) == XPC_TYPE_UINT64
            ? xpc_dictionary_get_uint64(reply, "issuedAt")
            : 0;
    const uint64_t expiresAt =
        expires != nullptr && xpc_get_type(expires) == XPC_TYPE_UINT64
            ? xpc_dictionary_get_uint64(reply, "expiresAt")
            : 0;
    if (!PVHasExactKeys(reply, keys, 12) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, "sealed") != 0 || !PVIsLowerHex(vaultID, 32) ||
        expectedVaultID == nullptr || strcmp(vaultID, expectedVaultID) != 0 ||
        !PVIsLowerHex(jobID, 32) || !PVIsLowerHex(recipient, 32) ||
        parsedEpoch == 0 || parsedEpoch > UINT64_C(9007199254740991) ||
        issuedAt == 0 || expiresAt <= issuedAt ||
        expiresAt > UINT64_C(9007199254740991) || algorithm == nullptr ||
        strcmp(algorithm, "anc/v1") != 0 ||
        !PVCopyBoundedData(reply, "jobEnvelope", PV_JOB_ENVELOPE_MAXIMUM_BYTES,
                           parsed.body)) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.vaultID, vaultID, 33);
    memcpy(parsed.jobID, jobID, 33);
    memcpy(parsed.recipientEndpointID, recipient, 33);
    memcpy(parsed.algorithmID, algorithm, strlen(algorithm) + 1);
    parsed.activeEpoch = parsedEpoch;
    parsed.issuedAt = issuedAt;
    parsed.expiresAt = expiresAt;
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::OpenResult) {
    const char *const keys[] = {
        "version", "ok", "requestId", "state", "vaultId", "jobId",
        "jobHash", "resultPayload",
    };
    const char *state = PVGetString(reply, "state");
    const char *vaultID = PVGetString(reply, "vaultId");
    const char *jobID = PVGetString(reply, "jobId");
    const char *jobHash = PVGetString(reply, "jobHash");
    if (!PVHasExactKeys(reply, keys, 8) ||
        !PVRequestIDMatches(reply, requestID) ||
        (strcmp(state == nullptr ? "" : state, "completed") != 0 &&
         strcmp(state == nullptr ? "" : state, "failed") != 0) ||
        !PVIsLowerHex(vaultID, 32) || expectedVaultID == nullptr ||
        strcmp(vaultID, expectedVaultID) != 0 || !PVIsLowerHex(jobID, 32) ||
        !PVIsLowerHex(jobHash, 64) ||
        !PVCopyBoundedData(reply, "resultPayload", PV_JOB_PAYLOAD_MAXIMUM_BYTES,
                           parsed.body)) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.vaultID, vaultID, 33);
    memcpy(parsed.jobID, jobID, 33);
    memcpy(parsed.jobHash, jobHash, 65);
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::SealObject ||
      operation == PVOperation::OpenObject ||
      operation == PVOperation::SealJobObject ||
      operation == PVOperation::OpenJobObject) {
    const bool sealing = operation == PVOperation::SealObject ||
                         operation == PVOperation::SealJobObject;
    const char *const sealKeys[] = {
        "version", "ok", "requestId", "state", "vaultId", "objectId",
        "revision", "epoch", "revisionId", "contentType",
        "plaintextLength", "objectPayload",
    };
    const char *const openKeys[] = {
        "version", "ok", "requestId", "state", "vaultId", "objectId",
        "revision", "epoch", "revisionId", "writerEndpointId",
        "contentType", "objectPayload",
    };
    const char *state = PVGetString(reply, "state");
    const char *vaultID = PVGetString(reply, "vaultId");
    const char *objectID = PVGetString(reply, "objectId");
    const char *contentType = PVGetString(reply, "contentType");
    xpc_object_t revision = xpc_dictionary_get_value(reply, "revision");
    xpc_object_t epoch = xpc_dictionary_get_value(reply, "epoch");
    xpc_object_t plaintextLength =
        xpc_dictionary_get_value(reply, "plaintextLength");
    const uint64_t parsedRevision =
        revision != nullptr && xpc_get_type(revision) == XPC_TYPE_UINT64
            ? xpc_dictionary_get_uint64(reply, "revision")
            : 0;
    const uint64_t parsedEpoch =
        epoch != nullptr && xpc_get_type(epoch) == XPC_TYPE_UINT64
            ? xpc_dictionary_get_uint64(reply, "epoch")
            : 0;
    const uint64_t parsedPlaintextLength =
        plaintextLength != nullptr &&
                xpc_get_type(plaintextLength) == XPC_TYPE_UINT64
            ? xpc_dictionary_get_uint64(reply, "plaintextLength")
            : 0;
    if (!PVHasExactKeys(reply, sealing ? sealKeys : openKeys, 12) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, sealing ? "sealed" : "opened") != 0 ||
        !PVIsLowerHex(vaultID, 32) || expectedVaultID == nullptr ||
        strcmp(vaultID, expectedVaultID) != 0 ||
        !PVIsLowerHex(objectID, 32) || parsedRevision == 0 ||
        parsedRevision > UINT64_C(9007199254740991) || parsedEpoch == 0 ||
        parsedEpoch > UINT64_C(9007199254740991) ||
        !PVIsContentObjectType(contentType) ||
        (sealing &&
         (parsedPlaintextLength == 0 ||
          parsedPlaintextLength > PV_OBJECT_PLAINTEXT_MAXIMUM_BYTES)) ||
        (!sealing && plaintextLength != nullptr) ||
        !PVCopyBoundedData(reply, "revisionId", 32, parsed.revisionID) ||
        parsed.revisionID.size() != 32 ||
        (!sealing &&
         (!PVCopyBoundedData(reply, "writerEndpointId", 16,
                             parsed.writerEndpointID) ||
          parsed.writerEndpointID.size() != 16)) ||
        !PVCopyBoundedData(reply, "objectPayload",
                           sealing ? PV_OBJECT_REVISION_MAXIMUM_BYTES
                                   : PV_OBJECT_PLAINTEXT_MAXIMUM_BYTES,
                           parsed.body)) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.vaultID, vaultID, 33);
    memcpy(parsed.objectID, objectID, 33);
    memcpy(parsed.contentType, contentType, strlen(contentType) + 1);
    parsed.objectRevision = parsedRevision;
    parsed.activeEpoch = parsedEpoch;
    parsed.plaintextLength =
        sealing ? parsedPlaintextLength : parsed.body.size();
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::PrepareEnrollment) {
    const char *const keys[] = {
        "version", "ok", "requestId", "state", "vaultId",
        "candidateEndpointId", "offerHash", "offer", "candidateKeyProof",
    };
    const char *state = PVGetString(reply, "state");
    const char *vaultID = PVGetString(reply, "vaultId");
    const char *candidate = PVGetString(reply, "candidateEndpointId");
    const char *offerHash = PVGetString(reply, "offerHash");
    if (!PVHasExactKeys(reply, keys, 9) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, "offered") != 0 || !PVIsLowerHex(vaultID, 32) ||
        expectedVaultID == nullptr || strcmp(vaultID, expectedVaultID) != 0 ||
        !PVIsLowerHex(candidate, 32) || !PVIsLowerHex(offerHash, 64) ||
        !PVCopyBoundedData(reply, "offer", 1024, parsed.body) ||
        !PVCopyBoundedData(reply, "candidateKeyProof", 64,
                           parsed.resourceID) ||
        parsed.resourceID.size() != 64) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.vaultID, vaultID, 33);
    memcpy(parsed.candidateEndpointID, candidate, 33);
    memcpy(parsed.offerHash, offerHash, 65);
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::ChallengeEnrollment ||
      operation == PVOperation::AuthorizeEnrollment) {
    const bool challenge = operation == PVOperation::ChallengeEnrollment;
    const char *const challengeKeys[] = {
        "version", "ok", "requestId", "state", "vaultId", "challenge",
        "sasCode", "candidateEndpointId", "sasTranscriptHash",
    };
    const char *const authorizationKeys[] = {
        "version", "ok", "requestId", "state", "vaultId", "authorization",
    };
    const char *state = PVGetString(reply, "state");
    const char *vaultID = PVGetString(reply, "vaultId");
    const char *sasCode = challenge ? PVGetString(reply, "sasCode") : nullptr;
    const char *candidate =
        challenge ? PVGetString(reply, "candidateEndpointId") : nullptr;
    if (!PVHasExactKeys(reply,
                        challenge ? challengeKeys : authorizationKeys,
                        challenge ? 9 : 6) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, challenge ? "challenged" : "authorized") != 0 ||
        !PVIsLowerHex(vaultID, 32) || expectedVaultID == nullptr ||
        strcmp(vaultID, expectedVaultID) != 0 ||
        !PVCopyBoundedData(reply,
                           challenge ? "challenge" : "authorization",
                           challenge ? PV_ENROLLMENT_CHALLENGE_MAXIMUM_BYTES
                                     : PV_ENROLLMENT_AUTHORIZATION_MAXIMUM_BYTES,
                           parsed.body) ||
        (challenge &&
         (!PVCopyBoundedData(reply, "sasTranscriptHash", 32,
                             parsed.sasTranscriptHash) ||
          parsed.sasTranscriptHash.size() != 32 ||
          !PVTrustedEnrollmentValidateInput(
              sasCode, candidate, "broker", true,
              parsed.sasTranscriptHash.data(),
              parsed.sasTranscriptHash.size())))) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.vaultID, vaultID, 33);
    if (challenge) {
      memcpy(parsed.sasCode, sasCode, sizeof(parsed.sasCode));
      memcpy(parsed.candidateEndpointID, candidate,
             sizeof(parsed.candidateEndpointID));
    }
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::ActivateEnrollment) {
    const char *const keys[] = {
        "version", "ok", "requestId", "state", "vaultId",
        "custodyGeneration", "activeEpoch", "sequence", "headHash",
    };
    const char *state = PVGetString(reply, "state");
    const char *vaultID = PVGetString(reply, "vaultId");
    const char *headHash = PVGetString(reply, "headHash");
    xpc_object_t custody =
        xpc_dictionary_get_value(reply, "custodyGeneration");
    xpc_object_t epoch = xpc_dictionary_get_value(reply, "activeEpoch");
    xpc_object_t sequence = xpc_dictionary_get_value(reply, "sequence");
    if (!PVHasExactKeys(reply, keys, 9) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, "active") != 0 || !PVIsLowerHex(vaultID, 32) ||
        expectedVaultID == nullptr || strcmp(vaultID, expectedVaultID) != 0 ||
        !PVIsLowerHex(headHash, 64) || custody == nullptr ||
        xpc_get_type(custody) != XPC_TYPE_UINT64 ||
        xpc_dictionary_get_uint64(reply, "custodyGeneration") != 3 ||
        epoch == nullptr || xpc_get_type(epoch) != XPC_TYPE_UINT64 ||
        xpc_dictionary_get_uint64(reply, "activeEpoch") == 0 ||
        sequence == nullptr || xpc_get_type(sequence) != XPC_TYPE_UINT64) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.vaultID, vaultID, 33);
    memcpy(parsed.headHash, headHash, 65);
    parsed.custodyGeneration =
        xpc_dictionary_get_uint64(reply, "custodyGeneration");
    parsed.activeEpoch = xpc_dictionary_get_uint64(reply, "activeEpoch");
    parsed.sequence = xpc_dictionary_get_uint64(reply, "sequence");
    parsed.failure = PVFailure::None;
    return parsed;
  }

  if (operation == PVOperation::OpenJob) {
    const char *const keys[] = {"version",      "ok",          "requestId",
                                "jobHash",      "jobPayload",  "resourceId",
                                "operationName"};
    const char *jobHash = PVGetString(reply, "jobHash");
    const char *operationName = PVGetString(reply, "operationName");
    if (!PVHasExactKeys(reply, keys, 7) ||
        !PVRequestIDMatches(reply, requestID) ||
        !PVIsLowerHex(jobHash, 64) ||
        !PVIsOpaqueID(operationName) || strlen(operationName) > 120 ||
        !PVCopyBoundedData(reply, "resourceId", 16, parsed.resourceID) ||
        parsed.resourceID.size() != 16 ||
        !PVCopyBoundedData(reply, "jobPayload", PV_JOB_PAYLOAD_MAXIMUM_BYTES,
                           parsed.body)) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.jobHash, jobHash, 65);
    memcpy(parsed.operationName, operationName, strlen(operationName) + 1);
    parsed.failure = PVFailure::None;
    return parsed;
  }
  if (operation == PVOperation::SealResult) {
    const char *const keys[] = {
        "version", "ok", "requestId", "resultEnvelope",
        "disclosureEnvelope", "disclosureId", "grantRef", "providerId",
        "destination", "scopeHash", "issuedAt", "expiresAt"};
    const char *providerID = PVGetString(reply, "providerId");
    const char *destination = PVGetString(reply, "destination");
    xpc_object_t issued = xpc_dictionary_get_value(reply, "issuedAt");
    xpc_object_t expires = xpc_dictionary_get_value(reply, "expiresAt");
    if (!PVHasExactKeys(reply, keys, 12) ||
        !PVRequestIDMatches(reply, requestID) ||
        !PVCopyBoundedData(reply, "resultEnvelope",
                           PV_JOB_ENVELOPE_MAXIMUM_BYTES, parsed.body) ||
        !PVCopyBoundedData(reply, "disclosureEnvelope", 64 * 1024,
                           parsed.disclosureEnvelope) ||
        !PVCopyBoundedData(reply, "disclosureId", 16,
                           parsed.disclosureID) ||
        parsed.disclosureID.size() != 16 ||
        !PVCopyBoundedData(reply, "grantRef", 32, parsed.grantRefBytes) ||
        parsed.grantRefBytes.size() != 32 ||
        !PVStringIsBounded(providerID, 160) ||
        !PVStringIsBounded(destination, 160) ||
        !PVCopyBoundedData(reply, "scopeHash", 32,
                           parsed.disclosureScopeHash) ||
        parsed.disclosureScopeHash.size() != 32 || issued == nullptr ||
        xpc_get_type(issued) != XPC_TYPE_UINT64 ||
        xpc_dictionary_get_uint64(reply, "issuedAt") == 0 ||
        expires == nullptr || xpc_get_type(expires) != XPC_TYPE_UINT64 ||
        xpc_dictionary_get_uint64(reply, "expiresAt") <=
            xpc_dictionary_get_uint64(reply, "issuedAt")) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.providerID, providerID, strlen(providerID) + 1);
    memcpy(parsed.destination, destination, strlen(destination) + 1);
    parsed.issuedAt = xpc_dictionary_get_uint64(reply, "issuedAt");
    parsed.expiresAt = xpc_dictionary_get_uint64(reply, "expiresAt");
    parsed.failure = PVFailure::None;
    return parsed;
  }
  if (operation == PVOperation::SignRequest) {
    const char *const keys[] = {"version", "ok", "requestId", "signature"};
    if (!PVHasExactKeys(reply, keys, 4) ||
        !PVRequestIDMatches(reply, requestID) ||
        !PVCopyBoundedData(reply, "signature", 64, parsed.body) ||
        parsed.body.size() != 64) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    parsed.failure = PVFailure::None;
    return parsed;
  }
  if (operation == PVOperation::CompleteResult) {
    const char *const keys[] = {"version", "ok", "requestId", "state"};
    const char *state = PVGetString(reply, "state");
    if (!PVHasExactKeys(reply, keys, 4) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, "delivered") != 0) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    parsed.failure = PVFailure::None;
    return parsed;
  }
  if (operation == PVOperation::PendingResult) {
    const char *state = PVGetString(reply, "state");
    if (state != nullptr && strcmp(state, "idle") == 0) {
      const char *const keys[] = {"version", "ok", "requestId", "state"};
      if (!PVHasExactKeys(reply, keys, 4) ||
          !PVRequestIDMatches(reply, requestID)) {
        parsed.failure = PVFailure::MalformedReply;
        return parsed;
      }
      memcpy(parsed.state, state, strlen(state) + 1);
      parsed.failure = PVFailure::None;
      return parsed;
    }
    const char *const keys[] = {
        "version", "ok", "requestId", "state", "jobId", "jobHash",
        "resultState", "epoch", "retryCount", "algorithmId",
        "resultEnvelope", "disclosureEnvelope", "disclosureId", "grantId",
        "grantRef", "resourceId", "operationName", "providerId",
        "destination", "scopeHash", "issuedAt", "expiresAt"};
    const char *jobID = PVGetString(reply, "jobId");
    const char *jobHash = PVGetString(reply, "jobHash");
    const char *resultState = PVGetString(reply, "resultState");
    const char *algorithmID = PVGetString(reply, "algorithmId");
    const char *operationName = PVGetString(reply, "operationName");
    const char *providerID = PVGetString(reply, "providerId");
    const char *destination = PVGetString(reply, "destination");
    xpc_object_t epoch = xpc_dictionary_get_value(reply, "epoch");
    xpc_object_t retry = xpc_dictionary_get_value(reply, "retryCount");
    xpc_object_t issued = xpc_dictionary_get_value(reply, "issuedAt");
    xpc_object_t expires = xpc_dictionary_get_value(reply, "expiresAt");
    if (!PVHasExactKeys(reply, keys, 22) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        strcmp(state, "pending") != 0 || !PVIsLowerHex(jobID, 32) ||
        !PVIsLowerHex(jobHash, 64) || resultState == nullptr ||
        (strcmp(resultState, "completed") != 0 &&
         strcmp(resultState, "failed") != 0) ||
        !PVStringIsBounded(algorithmID, 160) || epoch == nullptr ||
        xpc_get_type(epoch) != XPC_TYPE_UINT64 ||
        xpc_dictionary_get_uint64(reply, "epoch") == 0 || retry == nullptr ||
        xpc_get_type(retry) != XPC_TYPE_UINT64 ||
        xpc_dictionary_get_uint64(reply, "retryCount") > 100 ||
        !PVStringIsBounded(operationName, 120) ||
        !PVStringIsBounded(providerID, 160) ||
        !PVStringIsBounded(destination, 160) || issued == nullptr ||
        xpc_get_type(issued) != XPC_TYPE_UINT64 ||
        xpc_dictionary_get_uint64(reply, "issuedAt") == 0 ||
        expires == nullptr || xpc_get_type(expires) != XPC_TYPE_UINT64 ||
        xpc_dictionary_get_uint64(reply, "expiresAt") <=
            xpc_dictionary_get_uint64(reply, "issuedAt") ||
        !PVCopyBoundedData(reply, "resultEnvelope",
                           PV_JOB_ENVELOPE_MAXIMUM_BYTES, parsed.body) ||
        !PVCopyBoundedData(reply, "disclosureEnvelope", 64 * 1024,
                           parsed.disclosureEnvelope) ||
        !PVCopyBoundedData(reply, "disclosureId", 16,
                           parsed.disclosureID) ||
        parsed.disclosureID.size() != 16 ||
        !PVCopyBoundedData(reply, "grantId", 16, parsed.grantID) ||
        parsed.grantID.size() != 16 ||
        !PVCopyBoundedData(reply, "grantRef", 32, parsed.grantRefBytes) ||
        parsed.grantRefBytes.size() != 32 ||
        !PVCopyBoundedData(reply, "resourceId", 16, parsed.resourceID) ||
        parsed.resourceID.size() != 16 ||
        !PVCopyBoundedData(reply, "scopeHash", 32,
                           parsed.disclosureScopeHash) ||
        parsed.disclosureScopeHash.size() != 32) {
      parsed.failure = PVFailure::MalformedReply;
      return parsed;
    }
    memcpy(parsed.state, state, strlen(state) + 1);
    memcpy(parsed.operationName, operationName, strlen(operationName) + 1);
    memcpy(parsed.providerID, providerID, strlen(providerID) + 1);
    memcpy(parsed.destination, destination, strlen(destination) + 1);
    parsed.issuedAt = xpc_dictionary_get_uint64(reply, "issuedAt");
    parsed.expiresAt = xpc_dictionary_get_uint64(reply, "expiresAt");
    memcpy(parsed.jobID, jobID, 33);
    memcpy(parsed.jobHash, jobHash, 65);
    memcpy(parsed.resultState, resultState, strlen(resultState) + 1);
    memcpy(parsed.algorithmID, algorithmID, strlen(algorithmID) + 1);
    parsed.hostedEpoch = xpc_dictionary_get_uint64(reply, "epoch");
    parsed.hostedRetryCount =
        xpc_dictionary_get_uint64(reply, "retryCount");
    parsed.failure = PVFailure::None;
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
      operation == PVOperation::RecoverPage ||
      operation == PVOperation::EnrollmentBootstrap) {
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
    const bool enrollment = operation == PVOperation::EnrollmentBootstrap;
    if (!PVHasExactKeys(reply, keys, 9) ||
        !PVRequestIDMatches(reply, requestID) || state == nullptr ||
        !PVIsLowerHex(vaultID, 32) ||
        (enrollment &&
         (expectedVaultID == nullptr || strcmp(vaultID, expectedVaultID) != 0)) ||
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
    const char *expectedState = recovery
                                    ? (completeValue ? "committing" : "accepted")
                                : enrollment
                                    ? (completeValue ? "verified" : "accepted")
                                    : "parsed";
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
      : operation == PVOperation::Lock || operation == PVOperation::Unlock
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
  } else if (operation == PVOperation::Lock ||
             operation == PVOperation::Unlock) {
    const char *expected =
        operation == PVOperation::Unlock ? "unlocked" : "locked";
    if (strcmp(state, expected) != 0) {
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
  if (request->operation == PVOperation::ConfirmEnrollment) {
    request->failure = PVFailure::None;
    return;
  }
  const char *operation = request->operation == PVOperation::Health
                              ? "health"
                          : request->operation == PVOperation::Lock
                              ? "lock"
                          : request->operation == PVOperation::Unlock
                              ? "unlock"
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
                          : request->operation == PVOperation::EnrollmentBootstrap
                              ? "enroll_page"
                          : request->operation == PVOperation::RecoverStatus
                              ? "recover_status"
                          : request->operation == PVOperation::CreateGrant
                              ? "create_grant"
                          : request->operation == PVOperation::RevokeGrant
                              ? "revoke_grant"
                          : request->operation == PVOperation::ListGrants
                              ? "list_grants"
                          : request->operation == PVOperation::ListMembers
                              ? "list_members"
                          : request->operation == PVOperation::SealJob
                              ? "seal_job"
                          : request->operation == PVOperation::OpenResult
                              ? "open_result"
                          : request->operation == PVOperation::OpenJob
                              ? "open_job"
                          : request->operation == PVOperation::SealResult
                              ? "seal_result"
                          : request->operation == PVOperation::CompleteResult
                              ? "complete_result"
                          : request->operation == PVOperation::PendingResult
                              ? "pending_result"
                          : request->operation == PVOperation::SignRequest
                              ? "sign_request"
                          : request->operation == PVOperation::PrepareEnrollment
                              ? "prepare_enroll"
                          : request->operation == PVOperation::ChallengeEnrollment
                              ? "challenge_enroll"
                          : request->operation == PVOperation::AuthorizeEnrollment
                              ? "authorize_enroll"
                          : request->operation == PVOperation::ActivateEnrollment
                              ? "activate_enroll"
                          : request->operation == PVOperation::SealObject
                              ? "seal_object"
                          : request->operation == PVOperation::OpenObject
                              ? "open_object"
                          : request->operation == PVOperation::SealJobObject
                              ? "seal_job_object"
                          : request->operation == PVOperation::OpenJobObject
                              ? "open_job_object"
                          : request->operation == PVOperation::SealExport
                              ? "seal_export"
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
      request->operation == PVOperation::RecoverStatus ||
      request->operation == PVOperation::Unlock ||
      request->operation == PVOperation::CreateGrant ||
      request->operation == PVOperation::RevokeGrant ||
      request->operation == PVOperation::ListGrants ||
      request->operation == PVOperation::ListMembers ||
      request->operation == PVOperation::SealExport ||
      request->operation == PVOperation::SealJob ||
      request->operation == PVOperation::OpenResult ||
      request->operation == PVOperation::OpenJob ||
      request->operation == PVOperation::SealResult ||
      request->operation == PVOperation::CompleteResult ||
      request->operation == PVOperation::PendingResult ||
      request->operation == PVOperation::PrepareEnrollment ||
      request->operation == PVOperation::ChallengeEnrollment ||
      request->operation == PVOperation::AuthorizeEnrollment ||
      request->operation == PVOperation::ActivateEnrollment ||
      request->operation == PVOperation::SealObject ||
      request->operation == PVOperation::OpenObject ||
      request->operation == PVOperation::SealJobObject ||
      request->operation == PVOperation::OpenJobObject)
    xpc_dictionary_set_string(message, "vaultId", request->vaultID);
  if (request->operation == PVOperation::SealObject ||
      request->operation == PVOperation::OpenObject ||
      request->operation == PVOperation::SealJobObject ||
      request->operation == PVOperation::OpenJobObject) {
    const bool sealing = request->operation == PVOperation::SealObject ||
                         request->operation == PVOperation::SealJobObject;
    const bool jobBound = request->operation == PVOperation::SealJobObject ||
                          request->operation == PVOperation::OpenJobObject;
    if (jobBound) {
      xpc_dictionary_set_string(message, "jobId", request->jobID);
      xpc_dictionary_set_string(message, "jobHash", request->jobHash);
    }
    xpc_dictionary_set_string(message, "objectId", request->objectID);
    xpc_dictionary_set_int64(
        message, "revision", static_cast<int64_t>(request->objectRevision));
    if (sealing)
      xpc_dictionary_set_string(message, "contentType", request->contentType);
    xpc_dictionary_set_data(message, "objectPayload",
                            request->objectPayload.data(),
                            request->objectPayload.size());
  }
  if (request->operation == PVOperation::CreateGrant) {
    xpc_dictionary_set_string(message, "recipientEndpointId",
                              request->recipientEndpointID);
    xpc_dictionary_set_string(message, "subjectAgentId",
                              request->subjectAgentID);
    xpc_dictionary_set_int64(message, "expiresAt",
                             static_cast<int64_t>(request->expiresAt));
  }
  if (request->operation == PVOperation::RevokeGrant)
    xpc_dictionary_set_string(message, "grantRef", request->grantRef);
  if (request->operation == PVOperation::SealExport) {
    xpc_dictionary_set_string(message, "exportId", request->exportID);
    xpc_dictionary_set_uint64(message, "createdAt", request->exportCreatedAt);
    xpc_dictionary_set_string(message, "sourceSnapshotHash",
                              request->sourceSnapshotHash);
    xpc_dictionary_set_uint64(message, "objectCount",
                              request->exportObjectCount);
    xpc_dictionary_set_data(message, "exportPlaintext",
                            request->exportPlaintext.data(),
                            request->exportPlaintext.size());
    xpc_dictionary_set_data(message, "recoveryMnemonic",
                            request->recoveryMnemonic.data(),
                            request->recoveryMnemonic.size());
  }
  if (request->operation == PVOperation::SealJob) {
    static const uint8_t emptyJobPayload = 0;
    xpc_dictionary_set_string(message, "jobId", request->jobID);
    xpc_dictionary_set_string(message, "grantRef", request->grantRef);
    xpc_dictionary_set_string(message, "recipientEndpointId",
                              request->recipientEndpointID);
    xpc_dictionary_set_int64(message, "expiresAt",
                             static_cast<int64_t>(request->expiresAt));
    xpc_dictionary_set_data(message, "jobPayload",
                            request->jobEnvelope.empty()
                                ? &emptyJobPayload
                                : request->jobEnvelope.data(),
                            request->jobEnvelope.size());
  }
  if (request->operation == PVOperation::OpenResult) {
    xpc_dictionary_set_string(message, "jobId", request->jobID);
    xpc_dictionary_set_string(message, "jobHash", request->jobHash);
    xpc_dictionary_set_string(message, "senderEndpointId",
                              request->senderEndpointID);
    xpc_dictionary_set_data(message, "resultPayload",
                            request->resultPayload.data(),
                            request->resultPayload.size());
  }
  if (request->operation == PVOperation::ChallengeEnrollment ||
      request->operation == PVOperation::AuthorizeEnrollment) {
    xpc_dictionary_set_data(message, "offer", request->enrollmentOffer.data(),
                            request->enrollmentOffer.size());
  }
  if (request->operation == PVOperation::ChallengeEnrollment) {
    xpc_dictionary_set_data(message, "candidateKeyProof",
                            request->enrollmentCandidateKeyProof.data(),
                            request->enrollmentCandidateKeyProof.size());
  }
  if (request->operation == PVOperation::AuthorizeEnrollment ||
      request->operation == PVOperation::ActivateEnrollment) {
    xpc_dictionary_set_data(message, "challenge", request->challenge.data(),
                            request->challenge.size());
  }
  if (request->operation == PVOperation::AuthorizeEnrollment) {
    xpc_dictionary_set_data(message, "sasDecision",
                            request->enrollmentSasDecision.data(),
                            request->enrollmentSasDecision.size());
  }
  if (request->operation == PVOperation::ActivateEnrollment) {
    xpc_dictionary_set_data(message, "authorization",
                            request->authorization.data(),
                            request->authorization.size());
  }
  if (request->operation == PVOperation::OpenJob) {
    xpc_dictionary_set_string(message, "jobId", request->jobID);
    xpc_dictionary_set_int64(message, "epoch",
                             static_cast<int64_t>(request->hostedEpoch));
    xpc_dictionary_set_int64(
        message, "retryCount",
        static_cast<int64_t>(request->hostedRetryCount));
    xpc_dictionary_set_string(message, "algorithmId", request->algorithmID);
    xpc_dictionary_set_data(message, "jobEnvelope",
                            request->jobEnvelope.data(),
                            request->jobEnvelope.size());
  }
  if (request->operation == PVOperation::SignRequest) {
    xpc_dictionary_set_data(message, "unsignedProof",
                            request->resultPayload.data(),
                            request->resultPayload.size());
  }
  if (request->operation == PVOperation::SealResult) {
    static const uint8_t emptyPayload = 0;
    xpc_dictionary_set_string(message, "jobId", request->jobID);
    xpc_dictionary_set_string(message, "jobHash", request->jobHash);
    xpc_dictionary_set_string(message, "state", request->resultState);
    xpc_dictionary_set_data(message, "resultPayload",
                            request->resultPayload.empty()
                                ? &emptyPayload
                                : request->resultPayload.data(),
                            request->resultPayload.size());
  }
  if (request->operation == PVOperation::CompleteResult) {
    xpc_dictionary_set_string(message, "jobId", request->jobID);
    xpc_dictionary_set_string(message, "jobHash", request->jobHash);
    xpc_dictionary_set_string(message, "state", request->resultState);
  }
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
      request->operation == PVOperation::RecoverPage ||
      request->operation == PVOperation::EnrollmentBootstrap) {
    xpc_dictionary_set_data(message, "bootstrapFrame",
                            request->bootstrapFrame.data(),
                            request->bootstrapFrame.size());
  }
  if (request->operation == PVOperation::EnrollmentBootstrap)
    xpc_dictionary_set_string(message, "vaultId", request->vaultID);
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

  const int64_t timeout =
      request->operation == PVOperation::SealExport
          ? 60LL * NSEC_PER_SEC
      : request->operation == PVOperation::RevokeGrant
          ? 22LL * NSEC_PER_SEC
          : PV_REQUEST_TIMEOUT_NANOSECONDS;
  const long waitResult = dispatch_semaphore_wait(
      state->semaphore(),
      dispatch_time(DISPATCH_TIME_NOW, timeout));
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
        : request->operation == PVOperation::PrepareEnrollment ||
                request->operation == PVOperation::ChallengeEnrollment ||
                request->operation == PVOperation::AuthorizeEnrollment ||
                request->operation == PVOperation::ActivateEnrollment ||
                request->operation == PVOperation::EnrollmentBootstrap ||
                request->operation == PVOperation::SealObject ||
                request->operation == PVOperation::OpenObject ||
                request->operation == PVOperation::CreateGrant ||
                request->operation == PVOperation::RevokeGrant ||
                request->operation == PVOperation::ListGrants ||
                request->operation == PVOperation::ListMembers ||
                request->operation == PVOperation::SealExport ||
                request->operation == PVOperation::SealJob ||
                request->operation == PVOperation::OpenResult ||
                request->operation == PVOperation::SealJobObject ||
                request->operation == PVOperation::OpenJobObject
            ? request->vaultID
            : nullptr;
    PVParsedReply parsed =
        PVParseReply(reply, request->operation, requestID, expectedID);
    if (reply != nullptr)
      xpc_release(reply);
    if (parsed.failure == PVFailure::None &&
        (request->operation == PVOperation::SealObject ||
         request->operation == PVOperation::OpenObject ||
         request->operation == PVOperation::SealJobObject ||
         request->operation == PVOperation::OpenJobObject) &&
        (strcmp(parsed.objectID, request->objectID) != 0 ||
         parsed.objectRevision != request->objectRevision ||
         ((request->operation == PVOperation::SealObject ||
           request->operation == PVOperation::SealJobObject) &&
          parsed.plaintextLength != request->objectPayload.size())))
      parsed.failure = PVFailure::MalformedReply;
    if (parsed.failure == PVFailure::None &&
        request->operation == PVOperation::CreateGrant &&
        (strcmp(parsed.recipientEndpointID,
                request->recipientEndpointID) != 0 ||
         strcmp(parsed.subjectAgentID, request->subjectAgentID) != 0 ||
         parsed.expiresAt != request->expiresAt))
      parsed.failure = PVFailure::MalformedReply;
    if (parsed.failure == PVFailure::None &&
        request->operation == PVOperation::RevokeGrant &&
        strcmp(parsed.grantRef, request->grantRef) != 0)
      parsed.failure = PVFailure::MalformedReply;
    if (parsed.failure == PVFailure::None &&
        request->operation == PVOperation::SealExport &&
        strcmp(parsed.exportID, request->exportID) != 0)
      parsed.failure = PVFailure::MalformedReply;
    if (parsed.failure == PVFailure::None &&
        request->operation == PVOperation::SealJob &&
        (strcmp(parsed.jobID, request->jobID) != 0 ||
         strcmp(parsed.recipientEndpointID,
                request->recipientEndpointID) != 0 ||
         parsed.expiresAt != request->expiresAt))
      parsed.failure = PVFailure::MalformedReply;
    if (parsed.failure == PVFailure::None &&
        request->operation == PVOperation::OpenResult &&
        (strcmp(parsed.jobID, request->jobID) != 0 ||
         strcmp(parsed.jobHash, request->jobHash) != 0))
      parsed.failure = PVFailure::MalformedReply;
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
    request->resourceID = std::move(parsed.resourceID);
    memcpy(request->jobHash, parsed.jobHash, sizeof(request->jobHash));
    memcpy(request->jobID, parsed.jobID, sizeof(request->jobID));
    memcpy(request->grantRef, parsed.grantRef, sizeof(request->grantRef));
    memcpy(request->recipientEndpointID, parsed.recipientEndpointID,
           sizeof(request->recipientEndpointID));
    memcpy(request->subjectAgentID, parsed.subjectAgentID,
           sizeof(request->subjectAgentID));
    memcpy(request->resultState, parsed.resultState,
           sizeof(request->resultState));
    memcpy(request->algorithmID, parsed.algorithmID,
           sizeof(request->algorithmID));
    memcpy(request->operationName, parsed.operationName,
           sizeof(request->operationName));
    memcpy(request->providerID, parsed.providerID,
           sizeof(request->providerID));
    memcpy(request->destination, parsed.destination,
           sizeof(request->destination));
    memcpy(request->candidateEndpointID, parsed.candidateEndpointID,
           sizeof(request->candidateEndpointID));
    memcpy(request->sasCode, parsed.sasCode, sizeof(request->sasCode));
    memcpy(request->offerHash, parsed.offerHash, sizeof(request->offerHash));
    memcpy(request->objectID, parsed.objectID, sizeof(request->objectID));
    memcpy(request->contentType, parsed.contentType,
           sizeof(request->contentType));
    memcpy(request->exportID, parsed.exportID, sizeof(request->exportID));
    request->hostedEpoch = parsed.hostedEpoch;
    request->hostedRetryCount = parsed.hostedRetryCount;
    request->issuedAt = parsed.issuedAt;
    request->expiresAt = parsed.expiresAt;
    request->objectRevision = parsed.objectRevision;
    request->plaintextLength = parsed.plaintextLength;
    request->revisionID = std::move(parsed.revisionID);
    request->grantID = std::move(parsed.grantID);
    request->grantRefBytes = std::move(parsed.grantRefBytes);
    request->disclosureEnvelope = std::move(parsed.disclosureEnvelope);
    request->disclosureID = std::move(parsed.disclosureID);
    request->disclosureScopeHash = std::move(parsed.disclosureScopeHash);
    request->grants = std::move(parsed.grants);
    request->members = std::move(parsed.members);
    request->sasTranscriptHash = std::move(parsed.sasTranscriptHash);
    request->writerEndpointID = std::move(parsed.writerEndpointID);
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
  if (status == napi_ok && request->failure == PVFailure::None &&
      request->operation == PVOperation::ChallengeEnrollment &&
      !PVTrustedEnrollmentPresentSAS(
          request->sasCode, request->candidateEndpointID, "broker", true,
          request->sasTranscriptHash.data(),
          request->sasTranscriptHash.size()))
    request->failure = PVFailure::ServiceError;
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
                : request->operation == PVOperation::Unlock
                    ? "unlock"
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
                : request->operation == PVOperation::EnrollmentBootstrap
                    ? "enroll_page"
                : request->operation == PVOperation::RecoverStatus
                    ? "recover_status"
                : request->operation == PVOperation::CreateGrant
                    ? "create_grant"
                : request->operation == PVOperation::RevokeGrant
                    ? "revoke_grant"
                : request->operation == PVOperation::ListGrants
                    ? "list_grants"
                : request->operation == PVOperation::ListMembers
                    ? "list_members"
                : request->operation == PVOperation::SealJob
                    ? "seal_job"
                : request->operation == PVOperation::OpenResult
                    ? "open_result"
                : request->operation == PVOperation::OpenJob
                    ? "open_job"
                : request->operation == PVOperation::SealResult
                    ? "seal_result"
                : request->operation == PVOperation::CompleteResult
                    ? "complete_result"
                : request->operation == PVOperation::PendingResult
                    ? "pending_result"
                : request->operation == PVOperation::SignRequest
                    ? "sign_request"
                : request->operation == PVOperation::PrepareEnrollment
                    ? "prepare_enroll"
                : request->operation == PVOperation::ChallengeEnrollment
                    ? "challenge_enroll"
                : request->operation == PVOperation::ConfirmEnrollment
                    ? "confirm_enroll"
                : request->operation == PVOperation::AuthorizeEnrollment
                    ? "authorize_enroll"
                : request->operation == PVOperation::ActivateEnrollment
                    ? "activate_enroll"
                : request->operation == PVOperation::SealObject
                    ? "seal_object"
                : request->operation == PVOperation::OpenObject
                    ? "open_object"
                : request->operation == PVOperation::SealJobObject
                    ? "seal_job_object"
                : request->operation == PVOperation::OpenJobObject
                    ? "open_job_object"
                : request->operation == PVOperation::SealExport
                    ? "seal_export"
                    : "finalize_genesis");
    if (request->operation != PVOperation::OpenJob &&
        request->operation != PVOperation::SealResult &&
        request->operation != PVOperation::SignRequest)
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
    } else if (request->operation == PVOperation::SealExport) {
      PVSetString(env, result, "vaultId", request->vaultID);
      PVSetString(env, result, "exportId", request->exportID);
      if (!PVSetBuffer(env, result, "archive", request->body)) {
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
    } else if (request->operation == PVOperation::CreateGrant) {
      PVSetString(env, result, "vaultId", request->vaultID);
      PVSetString(env, result, "recipientEndpointId",
                  request->recipientEndpointID);
      PVSetString(env, result, "subjectAgentId", request->subjectAgentID);
      PVSetSafeInteger(env, result, "issuedAt", request->issuedAt);
      PVSetSafeInteger(env, result, "expiresAt", request->expiresAt);
      if (!PVSetBuffer(env, result, "grantId", request->grantID) ||
          !PVSetBuffer(env, result, "grantRef", request->grantRefBytes) ||
          !PVSetBuffer(env, result, "grantEnvelope", request->body)) {
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
    } else if (request->operation == PVOperation::RevokeGrant) {
      PVSetString(env, result, "vaultId", request->vaultID);
      PVSetString(env, result, "grantRef", request->grantRef);
    } else if (request->operation == PVOperation::ListGrants) {
      PVSetString(env, result, "vaultId", request->vaultID);
      napi_value grants;
      if (napi_create_array_with_length(env, request->grants.size(),
                                        &grants) != napi_ok) {
        request->failure = PVFailure::ServiceError;
      } else {
        for (size_t index = 0; index < request->grants.size(); index += 1) {
          const PVGrantSummary &summary = request->grants[index];
          napi_value item;
          napi_value revoked;
          napi_value pendingRevocation;
          if (napi_create_object(env, &item) != napi_ok) {
            request->failure = PVFailure::ServiceError;
            break;
          }
          PVSetString(env, item, "grantRef", summary.grantRef);
          PVSetString(env, item, "subjectEndpointId",
                      summary.subjectEndpointID);
          if (summary.subjectAgentID[0] != '\0')
            PVSetString(env, item, "subjectAgentId", summary.subjectAgentID);
          PVSetSafeInteger(env, item, "issuedAt", summary.issuedAt);
          PVSetSafeInteger(env, item, "expiresAt", summary.expiresAt);
          if (napi_get_boolean(env, summary.revoked, &revoked) != napi_ok ||
              napi_set_named_property(env, item, "revoked", revoked) !=
                  napi_ok ||
              napi_get_boolean(env, summary.pendingRevocation,
                               &pendingRevocation) != napi_ok ||
              napi_set_named_property(env, item, "pendingRevocation",
                                      pendingRevocation) != napi_ok ||
              napi_set_element(env, grants, index, item) != napi_ok) {
            request->failure = PVFailure::ServiceError;
            break;
          }
        }
      }
      if (request->failure == PVFailure::None &&
          napi_set_named_property(env, result, "grants", grants) != napi_ok)
        request->failure = PVFailure::ServiceError;
      if (request->failure != PVFailure::None) {
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
    } else if (request->operation == PVOperation::ListMembers) {
      PVSetString(env, result, "vaultId", request->vaultID);
      napi_value members;
      if (napi_create_array_with_length(env, request->members.size(),
                                        &members) != napi_ok) {
        request->failure = PVFailure::ServiceError;
      } else {
        for (size_t index = 0; index < request->members.size(); index += 1) {
          const PVMemberSummary &summary = request->members[index];
          napi_value item;
          napi_value unattended;
          napi_value current;
          if (napi_create_object(env, &item) != napi_ok) {
            request->failure = PVFailure::ServiceError;
            break;
          }
          PVSetString(env, item, "endpointId", summary.endpointID);
          PVSetString(env, item, "role", summary.role);
          if (napi_get_boolean(env, summary.unattended, &unattended) !=
                  napi_ok ||
              napi_set_named_property(env, item, "unattended", unattended) !=
                  napi_ok ||
              napi_get_boolean(env, summary.current, &current) != napi_ok ||
              napi_set_named_property(env, item, "current", current) !=
                  napi_ok ||
              napi_set_element(env, members, index, item) != napi_ok) {
            request->failure = PVFailure::ServiceError;
            break;
          }
        }
      }
      if (request->failure == PVFailure::None &&
          napi_set_named_property(env, result, "members", members) != napi_ok)
        request->failure = PVFailure::ServiceError;
      if (request->failure != PVFailure::None) {
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
    } else if (request->operation == PVOperation::SealJob) {
      PVSetString(env, result, "vaultId", request->vaultID);
      PVSetString(env, result, "jobId", request->jobID);
      PVSetString(env, result, "recipientEndpointId",
                  request->recipientEndpointID);
      PVSetString(env, result, "algorithmId", request->algorithmID);
      PVSetSafeInteger(env, result, "epoch", request->activeEpoch);
      PVSetSafeInteger(env, result, "issuedAt", request->issuedAt);
      PVSetSafeInteger(env, result, "expiresAt", request->expiresAt);
      if (!PVSetBuffer(env, result, "jobEnvelope", request->body)) {
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
    } else if (request->operation == PVOperation::OpenResult) {
      PVSetString(env, result, "vaultId", request->vaultID);
      PVSetString(env, result, "jobId", request->jobID);
      PVSetString(env, result, "jobHash", request->jobHash);
      if (!PVSetBuffer(env, result, "resultPayload", request->body)) {
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
    } else if (request->operation == PVOperation::PrepareEnrollment) {
      PVSetString(env, result, "vaultId", request->vaultID);
      PVSetString(env, result, "candidateEndpointId",
                  request->candidateEndpointID);
      PVSetString(env, result, "offerHash", request->offerHash);
      if (!PVSetBuffer(env, result, "offer", request->body) ||
          !PVSetBuffer(env, result, "candidateKeyProof",
                       request->resourceID)) {
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
    } else if (request->operation == PVOperation::ChallengeEnrollment ||
               request->operation == PVOperation::AuthorizeEnrollment) {
      PVSetString(env, result, "vaultId", request->vaultID);
      if (!PVSetBuffer(env, result,
                       request->operation == PVOperation::ChallengeEnrollment
                           ? "challenge"
                           : "authorization",
                       request->body)) {
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
    } else if (request->operation == PVOperation::ConfirmEnrollment) {
      if (!PVSetBuffer(env, result, "sasDecision", request->body)) {
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
    } else if (request->operation == PVOperation::ActivateEnrollment) {
      PVSetString(env, result, "vaultId", request->vaultID);
      PVSetString(env, result, "headHash", request->headHash);
      PVSetSafeInteger(env, result, "custodyGeneration",
                       request->custodyGeneration);
      PVSetSafeInteger(env, result, "activeEpoch", request->activeEpoch);
      PVSetSafeInteger(env, result, "sequence", request->sequence);
    } else if (request->operation == PVOperation::SealObject ||
               request->operation == PVOperation::OpenObject ||
               request->operation == PVOperation::SealJobObject ||
               request->operation == PVOperation::OpenJobObject) {
      const bool opening = request->operation == PVOperation::OpenObject ||
                           request->operation == PVOperation::OpenJobObject;
      PVSetString(env, result, "vaultId", request->vaultID);
      PVSetString(env, result, "objectId", request->objectID);
      PVSetString(env, result, "contentType", request->contentType);
      PVSetSafeInteger(env, result, "revision", request->objectRevision);
      PVSetSafeInteger(env, result, "epoch", request->activeEpoch);
      PVSetSafeInteger(env, result, "plaintextLength",
                       request->plaintextLength);
      if (!PVSetBuffer(env, result, "revisionId", request->revisionID) ||
          !PVSetBuffer(env, result, "objectPayload", request->body) ||
          (opening &&
           !PVSetBuffer(env, result, "writerEndpointId",
                        request->writerEndpointID))) {
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
    } else if (request->operation == PVOperation::OpenJob) {
      PVSetString(env, result, "jobHash", request->jobHash);
      PVSetString(env, result, "operationName", request->operationName);
      if (!PVSetBuffer(env, result, "jobPayload", request->body) ||
          !PVSetBuffer(env, result, "resourceId", request->resourceID)) {
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
    } else if (request->operation == PVOperation::SealResult) {
      PVSetString(env, result, "providerId", request->providerID);
      PVSetString(env, result, "destination", request->destination);
      PVSetSafeInteger(env, result, "issuedAt", request->issuedAt);
      PVSetSafeInteger(env, result, "expiresAt", request->expiresAt);
      if (!PVSetBuffer(env, result, "resultEnvelope", request->body) ||
          !PVSetBuffer(env, result, "disclosureEnvelope",
                       request->disclosureEnvelope) ||
          !PVSetBuffer(env, result, "disclosureId", request->disclosureID) ||
          !PVSetBuffer(env, result, "grantRef", request->grantRefBytes) ||
          !PVSetBuffer(env, result, "scopeHash",
                       request->disclosureScopeHash)) {
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
    } else if (request->operation == PVOperation::SignRequest) {
      if (!PVSetBuffer(env, result, "signature", request->body)) {
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
    } else if (request->operation == PVOperation::PendingResult &&
               strcmp(request->state, "pending") == 0) {
      PVSetString(env, result, "jobId", request->jobID);
      PVSetString(env, result, "jobHash", request->jobHash);
      PVSetString(env, result, "resultState", request->resultState);
      PVSetSafeInteger(env, result, "epoch", request->hostedEpoch);
      PVSetSafeInteger(env, result, "retryCount", request->hostedRetryCount);
      PVSetString(env, result, "algorithmId", request->algorithmID);
      PVSetString(env, result, "operationName", request->operationName);
      PVSetString(env, result, "providerId", request->providerID);
      PVSetString(env, result, "destination", request->destination);
      PVSetSafeInteger(env, result, "issuedAt", request->issuedAt);
      PVSetSafeInteger(env, result, "expiresAt", request->expiresAt);
      if (!PVSetBuffer(env, result, "resultEnvelope", request->body) ||
          !PVSetBuffer(env, result, "disclosureEnvelope",
                       request->disclosureEnvelope) ||
          !PVSetBuffer(env, result, "disclosureId", request->disclosureID) ||
          !PVSetBuffer(env, result, "grantId", request->grantID) ||
          !PVSetBuffer(env, result, "grantRef", request->grantRefBytes) ||
          !PVSetBuffer(env, result, "resourceId", request->resourceID) ||
          !PVSetBuffer(env, result, "scopeHash",
                       request->disclosureScopeHash)) {
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
               request->operation == PVOperation::RecoverPage ||
               request->operation == PVOperation::EnrollmentBootstrap) {
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
  size_t argc = 7;
  napi_value argv[7];
  napi_value promise;
  auto *request = new PVAsyncRequest();
  const uint8_t *genesisInputs[3] = {nullptr, nullptr, nullptr};
  size_t genesisInputLengths[3] = {0, 0, 0};
  const uint8_t *ceremonyInputs[2] = {nullptr, nullptr};
  size_t ceremonyInputLengths[2] = {0, 0};

  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      argc < 1 || argc > 7) {
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
  } else if (strcmp(operation, "unlock") == 0) {
    request->operation = PVOperation::Unlock;
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
  } else if (strcmp(operation, "enroll_page") == 0) {
    request->operation = PVOperation::EnrollmentBootstrap;
  } else if (strcmp(operation, "recover_status") == 0) {
    request->operation = PVOperation::RecoverStatus;
  } else if (strcmp(operation, "create_grant") == 0) {
    request->operation = PVOperation::CreateGrant;
  } else if (strcmp(operation, "revoke_grant") == 0) {
    request->operation = PVOperation::RevokeGrant;
  } else if (strcmp(operation, "list_grants") == 0) {
    request->operation = PVOperation::ListGrants;
  } else if (strcmp(operation, "list_members") == 0) {
    request->operation = PVOperation::ListMembers;
  } else if (strcmp(operation, "seal_job") == 0) {
    request->operation = PVOperation::SealJob;
  } else if (strcmp(operation, "open_result") == 0) {
    request->operation = PVOperation::OpenResult;
  } else if (strcmp(operation, "open_job") == 0) {
    request->operation = PVOperation::OpenJob;
  } else if (strcmp(operation, "seal_result") == 0) {
    request->operation = PVOperation::SealResult;
  } else if (strcmp(operation, "complete_result") == 0) {
    request->operation = PVOperation::CompleteResult;
  } else if (strcmp(operation, "pending_result") == 0) {
    request->operation = PVOperation::PendingResult;
  } else if (strcmp(operation, "sign_request") == 0) {
    request->operation = PVOperation::SignRequest;
  } else if (strcmp(operation, "prepare_enroll") == 0) {
    request->operation = PVOperation::PrepareEnrollment;
  } else if (strcmp(operation, "challenge_enroll") == 0) {
    request->operation = PVOperation::ChallengeEnrollment;
  } else if (strcmp(operation, "confirm_enroll") == 0) {
    request->operation = PVOperation::ConfirmEnrollment;
  } else if (strcmp(operation, "authorize_enroll") == 0) {
    request->operation = PVOperation::AuthorizeEnrollment;
  } else if (strcmp(operation, "activate_enroll") == 0) {
    request->operation = PVOperation::ActivateEnrollment;
  } else if (strcmp(operation, "seal_object") == 0) {
    request->operation = PVOperation::SealObject;
  } else if (strcmp(operation, "open_object") == 0) {
    request->operation = PVOperation::OpenObject;
  } else if (strcmp(operation, "seal_job_object") == 0) {
    request->operation = PVOperation::SealJobObject;
  } else if (strcmp(operation, "open_job_object") == 0) {
    request->operation = PVOperation::OpenJobObject;
  } else if (strcmp(operation, "seal_export") == 0) {
    request->operation = PVOperation::SealExport;
  } else {
    delete request;
    napi_throw_type_error(env, nullptr,
                          "Private Vault native service request failed");
    return nullptr;
  }
  const size_t expectedArgumentCount =
      request->operation == PVOperation::Unlock ||
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
      : request->operation == PVOperation::EnrollmentBootstrap ? 3
      : request->operation == PVOperation::CreateGrant ? 5
      : request->operation == PVOperation::RevokeGrant ? 3
      : request->operation == PVOperation::ListGrants ? 2
      : request->operation == PVOperation::ListMembers ? 2
      : request->operation == PVOperation::SealJob ? 7
      : request->operation == PVOperation::OpenResult ? 6
      : request->operation == PVOperation::OpenJob ? 7
      : request->operation == PVOperation::SealResult ? 6
      : request->operation == PVOperation::CompleteResult ? 5
      : request->operation == PVOperation::PendingResult ? 2
      : request->operation == PVOperation::SignRequest ? 2
      : request->operation == PVOperation::PrepareEnrollment ? 2
      : request->operation == PVOperation::ChallengeEnrollment ? 4
      : request->operation == PVOperation::ConfirmEnrollment ? 3
      : request->operation == PVOperation::AuthorizeEnrollment ? 5
      : request->operation == PVOperation::ActivateEnrollment ? 4
      : request->operation == PVOperation::SealObject ? 6
      : request->operation == PVOperation::OpenObject ? 5
      : request->operation == PVOperation::SealJobObject ? 8
      : request->operation == PVOperation::OpenJobObject ? 7
      : request->operation == PVOperation::SealExport ? 7
          : 1;
  if (argc != expectedArgumentCount) {
    delete request;
    napi_throw_type_error(env, nullptr,
                          "Private Vault native service request failed");
    return nullptr;
  }
  if (request->operation == PVOperation::Unlock ||
      request->operation == PVOperation::ResumeRotation ||
      request->operation == PVOperation::RecoverStatus ||
      request->operation == PVOperation::EnrollmentBootstrap ||
      request->operation == PVOperation::CreateGrant ||
      request->operation == PVOperation::RevokeGrant ||
      request->operation == PVOperation::ListGrants ||
      request->operation == PVOperation::ListMembers ||
      request->operation == PVOperation::SealJob ||
      request->operation == PVOperation::OpenResult ||
      request->operation == PVOperation::OpenJob ||
      request->operation == PVOperation::SealResult ||
      request->operation == PVOperation::CompleteResult ||
      request->operation == PVOperation::PendingResult ||
      request->operation == PVOperation::PrepareEnrollment ||
      request->operation == PVOperation::ChallengeEnrollment ||
      request->operation == PVOperation::ConfirmEnrollment ||
      request->operation == PVOperation::AuthorizeEnrollment ||
      request->operation == PVOperation::ActivateEnrollment ||
      request->operation == PVOperation::SealObject ||
      request->operation == PVOperation::OpenObject ||
      request->operation == PVOperation::SealJobObject ||
      request->operation == PVOperation::OpenJobObject ||
      request->operation == PVOperation::SealExport) {
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
  const uint8_t *exportPlaintext = nullptr;
  size_t exportPlaintextLength = 0;
  if (request->operation == PVOperation::SealExport) {
    size_t exportIDLength = 0, snapshotLength = 0;
    double createdAt = 0, objectCount = 0;
    void *bytes = nullptr;
    bool isBuffer = false;
    if (napi_typeof(env, argv[2], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[2], request->exportID,
                                   sizeof(request->exportID),
                                   &exportIDLength) != napi_ok ||
        exportIDLength != 32 || !PVIsLowerHex(request->exportID, 32) ||
        napi_get_value_double(env, argv[3], &createdAt) != napi_ok ||
        !std::isfinite(createdAt) || std::floor(createdAt) != createdAt ||
        createdAt < 1 || createdAt > 9007199254740991.0 ||
        napi_typeof(env, argv[4], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(
            env, argv[4], request->sourceSnapshotHash,
            sizeof(request->sourceSnapshotHash), &snapshotLength) != napi_ok ||
        snapshotLength != 64 ||
        !PVIsLowerHex(request->sourceSnapshotHash, 64) ||
        napi_get_value_double(env, argv[5], &objectCount) != napi_ok ||
        !std::isfinite(objectCount) || std::floor(objectCount) != objectCount ||
        objectCount < 1 || objectCount > 9007199254740991.0 ||
        napi_is_buffer(env, argv[6], &isBuffer) != napi_ok || !isBuffer ||
        napi_get_buffer_info(env, argv[6], &bytes, &exportPlaintextLength) !=
            napi_ok ||
        bytes == nullptr || exportPlaintextLength == 0 ||
        exportPlaintextLength > PV_EXPORT_PLAINTEXT_MAXIMUM_BYTES) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
    request->exportCreatedAt = static_cast<uint64_t>(createdAt);
    request->exportObjectCount = static_cast<uint64_t>(objectCount);
    exportPlaintext = static_cast<const uint8_t *>(bytes);
  }
  const uint8_t *sealedJobPayload = nullptr;
  size_t sealedJobPayloadLength = 0;
  if (request->operation == PVOperation::RevokeGrant) {
    size_t grantRefLength = 0;
    if (napi_typeof(env, argv[2], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[2], request->grantRef,
                                   sizeof(request->grantRef),
                                   &grantRefLength) != napi_ok ||
        grantRefLength != 64 || !PVIsLowerHex(request->grantRef, 64)) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
  }
  if (request->operation == PVOperation::CreateGrant ||
      request->operation == PVOperation::SealJob) {
    const size_t recipientIndex =
        request->operation == PVOperation::CreateGrant ? 2 : 4;
    const size_t expiresIndex =
        request->operation == PVOperation::CreateGrant ? 4 : 5;
    size_t recipientLength = 0;
    double expiresAt = 0;
    bool valid =
        napi_typeof(env, argv[recipientIndex], &argumentType) == napi_ok &&
        argumentType == napi_string &&
        napi_get_value_string_utf8(
            env, argv[recipientIndex], request->recipientEndpointID,
            sizeof(request->recipientEndpointID), &recipientLength) == napi_ok &&
        recipientLength == 32 &&
        PVIsLowerHex(request->recipientEndpointID, 32) &&
        napi_get_value_double(env, argv[expiresIndex], &expiresAt) == napi_ok &&
        std::isfinite(expiresAt) && std::floor(expiresAt) == expiresAt &&
        expiresAt >= 1 && expiresAt <= 9007199254740991.0;
    if (valid && request->operation == PVOperation::CreateGrant) {
      size_t agentLength = 0;
      valid = napi_typeof(env, argv[3], &argumentType) == napi_ok &&
              argumentType == napi_string &&
              napi_get_value_string_utf8(
                  env, argv[3], request->subjectAgentID,
                  sizeof(request->subjectAgentID), &agentLength) == napi_ok &&
              agentLength == 32 && PVIsLowerHex(request->subjectAgentID, 32);
    }
    if (valid && request->operation == PVOperation::SealJob) {
      size_t jobLength = 0, grantRefLength = 0;
      void *bytes = nullptr;
      bool isBuffer = false;
      valid = napi_typeof(env, argv[2], &argumentType) == napi_ok &&
              argumentType == napi_string &&
              napi_get_value_string_utf8(env, argv[2], request->jobID,
                                         sizeof(request->jobID),
                                         &jobLength) == napi_ok &&
              jobLength == 32 && PVIsLowerHex(request->jobID, 32) &&
              napi_typeof(env, argv[3], &argumentType) == napi_ok &&
              argumentType == napi_string &&
              napi_get_value_string_utf8(env, argv[3], request->grantRef,
                                         sizeof(request->grantRef),
                                         &grantRefLength) == napi_ok &&
              grantRefLength == 64 && PVIsLowerHex(request->grantRef, 64) &&
              napi_is_buffer(env, argv[6], &isBuffer) == napi_ok && isBuffer &&
              napi_get_buffer_info(env, argv[6], &bytes,
                                   &sealedJobPayloadLength) == napi_ok &&
              (sealedJobPayloadLength == 0 || bytes != nullptr) &&
              sealedJobPayloadLength <= PV_JOB_PAYLOAD_MAXIMUM_BYTES;
      sealedJobPayload = static_cast<const uint8_t *>(bytes);
    }
    if (!valid) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
    request->expiresAt = static_cast<uint64_t>(expiresAt);
  }
  const uint8_t *openedResultEnvelope = nullptr;
  size_t openedResultEnvelopeLength = 0;
  if (request->operation == PVOperation::OpenResult) {
    size_t jobLength = 0, hashLength = 0, senderLength = 0;
    void *bytes = nullptr;
    bool isBuffer = false;
    if (napi_typeof(env, argv[2], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[2], request->jobID,
                                   sizeof(request->jobID), &jobLength) !=
            napi_ok ||
        jobLength != 32 || !PVIsLowerHex(request->jobID, 32) ||
        napi_typeof(env, argv[3], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[3], request->jobHash,
                                   sizeof(request->jobHash), &hashLength) !=
            napi_ok ||
        hashLength != 64 || !PVIsLowerHex(request->jobHash, 64) ||
        napi_typeof(env, argv[4], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[4], request->senderEndpointID,
                                   sizeof(request->senderEndpointID),
                                   &senderLength) != napi_ok ||
        senderLength != 32 || !PVIsLowerHex(request->senderEndpointID, 32) ||
        napi_is_buffer(env, argv[5], &isBuffer) != napi_ok || !isBuffer ||
        napi_get_buffer_info(env, argv[5], &bytes,
                             &openedResultEnvelopeLength) != napi_ok ||
        bytes == nullptr || openedResultEnvelopeLength == 0 ||
        openedResultEnvelopeLength > PV_JOB_ENVELOPE_MAXIMUM_BYTES) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
    openedResultEnvelope = static_cast<const uint8_t *>(bytes);
  }
  const uint8_t *objectPayload = nullptr;
  size_t objectPayloadLength = 0;
  if (request->operation == PVOperation::SealObject ||
      request->operation == PVOperation::OpenObject ||
      request->operation == PVOperation::SealJobObject ||
      request->operation == PVOperation::OpenJobObject) {
    const bool sealing = request->operation == PVOperation::SealObject ||
                         request->operation == PVOperation::SealJobObject;
    const bool jobBound = request->operation == PVOperation::SealJobObject ||
                          request->operation == PVOperation::OpenJobObject;
    const size_t objectIndex = jobBound ? 4 : 2;
    const size_t revisionIndex = objectIndex + 1;
    const size_t contentTypeIndex = revisionIndex + 1;
    const size_t payloadIndex = sealing ? contentTypeIndex + 1
                                        : revisionIndex + 1;
    size_t objectLength = 0;
    double revision = 0;
    void *bytes = nullptr;
    bool isBuffer = false;
    const size_t maximum = sealing ? PV_OBJECT_PLAINTEXT_MAXIMUM_BYTES
                                   : PV_OBJECT_REVISION_MAXIMUM_BYTES;
    bool valid =
        napi_typeof(env, argv[objectIndex], &argumentType) == napi_ok &&
        argumentType == napi_string &&
        napi_get_value_string_utf8(env, argv[objectIndex], request->objectID,
                                   sizeof(request->objectID),
                                   &objectLength) == napi_ok &&
        objectLength == 32 && PVIsLowerHex(request->objectID, 32) &&
        napi_get_value_double(env, argv[revisionIndex], &revision) == napi_ok &&
        std::isfinite(revision) && std::floor(revision) == revision &&
        revision >= 1 && revision <= 9007199254740991.0;
    if (valid && jobBound) {
      size_t jobLength = 0, hashLength = 0;
      valid = napi_typeof(env, argv[2], &argumentType) == napi_ok &&
              argumentType == napi_string &&
              napi_get_value_string_utf8(env, argv[2], request->jobID,
                                         sizeof(request->jobID),
                                         &jobLength) == napi_ok &&
              jobLength == 32 && PVIsLowerHex(request->jobID, 32) &&
              napi_typeof(env, argv[3], &argumentType) == napi_ok &&
              argumentType == napi_string &&
              napi_get_value_string_utf8(env, argv[3], request->jobHash,
                                         sizeof(request->jobHash),
                                         &hashLength) == napi_ok &&
              hashLength == 64 && PVIsLowerHex(request->jobHash, 64);
    }
    if (valid && sealing) {
      size_t contentTypeLength = 0;
      valid = napi_typeof(env, argv[contentTypeIndex], &argumentType) == napi_ok &&
              argumentType == napi_string &&
              napi_get_value_string_utf8(
                  env, argv[contentTypeIndex], request->contentType,
                  sizeof(request->contentType), &contentTypeLength) == napi_ok &&
              PVIsContentObjectType(request->contentType);
    }
    valid = valid &&
            napi_is_buffer(env, argv[payloadIndex], &isBuffer) == napi_ok &&
            isBuffer &&
            napi_get_buffer_info(env, argv[payloadIndex], &bytes,
                                 &objectPayloadLength) == napi_ok &&
            bytes != nullptr && objectPayloadLength > 0 &&
            objectPayloadLength <= maximum;
    if (!valid) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
    request->objectRevision = static_cast<uint64_t>(revision);
    objectPayload = static_cast<const uint8_t *>(bytes);
  }
  const uint8_t *jobEnvelope = nullptr;
  size_t jobEnvelopeLength = 0;
  if (request->operation == PVOperation::OpenJob) {
    size_t jobLength = 0;
    size_t algorithmLength = 0;
    double epoch = 0, retryCount = 0;
    void *bytes = nullptr;
    bool isBuffer = false;
    if (napi_typeof(env, argv[2], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[2], request->jobID,
                                   sizeof(request->jobID), &jobLength) != napi_ok ||
        jobLength != 32 || !PVIsLowerHex(request->jobID, 32) ||
        napi_is_buffer(env, argv[3], &isBuffer) != napi_ok || !isBuffer ||
        napi_get_buffer_info(env, argv[3], &bytes, &jobEnvelopeLength) != napi_ok ||
        bytes == nullptr || jobEnvelopeLength == 0 ||
        jobEnvelopeLength > PV_JOB_ENVELOPE_MAXIMUM_BYTES ||
        napi_get_value_double(env, argv[4], &epoch) != napi_ok ||
        !std::isfinite(epoch) || std::floor(epoch) != epoch || epoch < 1 ||
        epoch > 9007199254740991.0 ||
        napi_get_value_double(env, argv[5], &retryCount) != napi_ok ||
        !std::isfinite(retryCount) || std::floor(retryCount) != retryCount ||
        retryCount < 0 || retryCount > 100 ||
        napi_typeof(env, argv[6], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[6], request->algorithmID,
                                   sizeof(request->algorithmID),
                                   &algorithmLength) != napi_ok ||
        algorithmLength == 0 || algorithmLength > 160) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
    jobEnvelope = static_cast<const uint8_t *>(bytes);
    request->hostedEpoch = static_cast<uint64_t>(epoch);
    request->hostedRetryCount = static_cast<uint64_t>(retryCount);
  }
  if (request->operation == PVOperation::SealJob) {
    try {
      if (sealedJobPayloadLength > 0)
        request->jobEnvelope.assign(
            sealedJobPayload, sealedJobPayload + sealedJobPayloadLength);
    } catch (...) {
      delete request;
      napi_throw_error(env, nullptr,
                       "Private Vault native service request failed");
      return nullptr;
    }
  }
  if (request->operation == PVOperation::OpenResult) {
    try {
      request->resultPayload.assign(
          openedResultEnvelope,
          openedResultEnvelope + openedResultEnvelopeLength);
    } catch (...) {
      delete request;
      napi_throw_error(env, nullptr,
                       "Private Vault native service request failed");
      return nullptr;
    }
  }
  const uint8_t *resultPayload = nullptr;
  size_t resultPayloadLength = 0;
  if (request->operation == PVOperation::SealResult) {
    size_t jobLength = 0, hashLength = 0, stateLength = 0;
    void *bytes = nullptr;
    bool isBuffer = false;
    if (napi_typeof(env, argv[2], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[2], request->jobID,
                                   sizeof(request->jobID), &jobLength) != napi_ok ||
        jobLength != 32 || !PVIsLowerHex(request->jobID, 32) ||
        napi_typeof(env, argv[3], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[3], request->jobHash,
                                   sizeof(request->jobHash), &hashLength) != napi_ok ||
        hashLength != 64 || !PVIsLowerHex(request->jobHash, 64) ||
        napi_typeof(env, argv[4], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[4], request->resultState,
                                   sizeof(request->resultState), &stateLength) != napi_ok ||
        (strcmp(request->resultState, "completed") != 0 &&
         strcmp(request->resultState, "failed") != 0) ||
        napi_is_buffer(env, argv[5], &isBuffer) != napi_ok || !isBuffer ||
        napi_get_buffer_info(env, argv[5], &bytes, &resultPayloadLength) != napi_ok ||
        (resultPayloadLength > 0 && bytes == nullptr) ||
        resultPayloadLength > PV_JOB_PAYLOAD_MAXIMUM_BYTES) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
    resultPayload = static_cast<const uint8_t *>(bytes);
  }
  const uint8_t *enrollmentChallenge = nullptr;
  size_t enrollmentChallengeLength = 0;
  const uint8_t *enrollmentOffer = nullptr;
  size_t enrollmentOfferLength = 0;
  const uint8_t *enrollmentCandidateKeyProof = nullptr;
  size_t enrollmentCandidateKeyProofLength = 0;
  const uint8_t *enrollmentSasDecision = nullptr;
  size_t enrollmentSasDecisionLength = 0;
  const uint8_t *enrollmentAuthorization = nullptr;
  size_t enrollmentAuthorizationLength = 0;
  if (request->operation == PVOperation::ChallengeEnrollment ||
      request->operation == PVOperation::AuthorizeEnrollment) {
    void *offerBytes = nullptr;
    bool offerIsBuffer = false;
    if (napi_is_buffer(env, argv[2], &offerIsBuffer) != napi_ok ||
        !offerIsBuffer ||
        napi_get_buffer_info(env, argv[2], &offerBytes,
                             &enrollmentOfferLength) != napi_ok ||
        offerBytes == nullptr || enrollmentOfferLength == 0 ||
        enrollmentOfferLength > 1024) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
    enrollmentOffer = static_cast<const uint8_t *>(offerBytes);
  }
  if (request->operation == PVOperation::ChallengeEnrollment) {
    void *proofBytes = nullptr;
    bool proofIsBuffer = false;
    if (napi_is_buffer(env, argv[3], &proofIsBuffer) != napi_ok ||
        !proofIsBuffer ||
        napi_get_buffer_info(env, argv[3], &proofBytes,
                             &enrollmentCandidateKeyProofLength) != napi_ok ||
        proofBytes == nullptr || enrollmentCandidateKeyProofLength != 64) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
    enrollmentCandidateKeyProof =
        static_cast<const uint8_t *>(proofBytes);
  }
  if (request->operation == PVOperation::ConfirmEnrollment ||
      request->operation == PVOperation::AuthorizeEnrollment ||
      request->operation == PVOperation::ActivateEnrollment) {
    const size_t challengeIndex =
        request->operation == PVOperation::AuthorizeEnrollment ? 3 : 2;
    void *bytes = nullptr;
    bool isBuffer = false;
    if (napi_is_buffer(env, argv[challengeIndex], &isBuffer) != napi_ok ||
        !isBuffer ||
        napi_get_buffer_info(env, argv[challengeIndex], &bytes,
                             &enrollmentChallengeLength) != napi_ok ||
        bytes == nullptr || enrollmentChallengeLength == 0 ||
        enrollmentChallengeLength > PV_ENROLLMENT_CHALLENGE_MAXIMUM_BYTES) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
    enrollmentChallenge = static_cast<const uint8_t *>(bytes);
  }
  if (request->operation == PVOperation::AuthorizeEnrollment) {
    void *decisionBytes = nullptr;
    bool decisionIsBuffer = false;
    if (napi_is_buffer(env, argv[4], &decisionIsBuffer) != napi_ok ||
        !decisionIsBuffer ||
        napi_get_buffer_info(env, argv[4], &decisionBytes,
                             &enrollmentSasDecisionLength) != napi_ok ||
        decisionBytes == nullptr || enrollmentSasDecisionLength == 0 ||
        enrollmentSasDecisionLength > 2048) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
    enrollmentSasDecision = static_cast<const uint8_t *>(decisionBytes);
  }
  if (request->operation == PVOperation::ActivateEnrollment) {
    void *bytes = nullptr;
    bool isBuffer = false;
    if (napi_is_buffer(env, argv[3], &isBuffer) != napi_ok || !isBuffer ||
        napi_get_buffer_info(env, argv[3], &bytes,
                             &enrollmentAuthorizationLength) != napi_ok ||
        bytes == nullptr || enrollmentAuthorizationLength == 0 ||
        enrollmentAuthorizationLength >
            PV_ENROLLMENT_AUTHORIZATION_MAXIMUM_BYTES) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
    enrollmentAuthorization = static_cast<const uint8_t *>(bytes);
  }
  if (request->operation == PVOperation::SignRequest) {
    void *bytes = nullptr;
    bool isBuffer = false;
    if (napi_is_buffer(env, argv[1], &isBuffer) != napi_ok || !isBuffer ||
        napi_get_buffer_info(env, argv[1], &bytes, &resultPayloadLength) !=
            napi_ok ||
        bytes == nullptr || resultPayloadLength == 0 ||
        resultPayloadLength > 64 * 1024) {
      delete request;
      napi_throw_type_error(env, nullptr,
                            "Private Vault native service request failed");
      return nullptr;
    }
    resultPayload = static_cast<const uint8_t *>(bytes);
  }
  if (request->operation == PVOperation::CompleteResult) {
    size_t jobLength = 0, hashLength = 0, stateLength = 0;
    if (napi_typeof(env, argv[2], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[2], request->jobID,
                                   sizeof(request->jobID), &jobLength) != napi_ok ||
        jobLength != 32 || !PVIsLowerHex(request->jobID, 32) ||
        napi_typeof(env, argv[3], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[3], request->jobHash,
                                   sizeof(request->jobHash), &hashLength) != napi_ok ||
        hashLength != 64 || !PVIsLowerHex(request->jobHash, 64) ||
        napi_typeof(env, argv[4], &argumentType) != napi_ok ||
        argumentType != napi_string ||
        napi_get_value_string_utf8(env, argv[4], request->resultState,
                                   sizeof(request->resultState), &stateLength) != napi_ok ||
        (strcmp(request->resultState, "completed") != 0 &&
         strcmp(request->resultState, "failed") != 0)) {
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
      request->operation == PVOperation::RecoverPage ||
      request->operation == PVOperation::EnrollmentBootstrap) {
    void *bytes = nullptr;
    bool isBuffer = false;
    size_t frameIndex = request->operation == PVOperation::EnrollmentBootstrap
                            ? 2
                            : 1;
    if (napi_is_buffer(env, argv[frameIndex], &isBuffer) != napi_ok || !isBuffer ||
        napi_get_buffer_info(env, argv[frameIndex], &bytes, &bootstrapFrameLength) !=
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
  if (request->operation == PVOperation::OpenJob) {
    try {
      request->jobEnvelope.assign(jobEnvelope,
                                  jobEnvelope + jobEnvelopeLength);
    } catch (...) {
      gRequestGate.release();
      delete request;
      napi_throw_error(env, nullptr,
                       "Private Vault native service request failed");
      return nullptr;
    }
  }
  if (request->operation == PVOperation::SealResult ||
      request->operation == PVOperation::SignRequest) {
    try {
      if (resultPayloadLength > 0)
        request->resultPayload.assign(resultPayload,
                                      resultPayload + resultPayloadLength);
    } catch (...) {
      gRequestGate.release();
      delete request;
      napi_throw_error(env, nullptr,
                       "Private Vault native service request failed");
      return nullptr;
    }
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

  if (request->operation == PVOperation::SealObject ||
      request->operation == PVOperation::OpenObject ||
      request->operation == PVOperation::SealJobObject ||
      request->operation == PVOperation::OpenJobObject) {
    try {
      request->objectPayload.assign(objectPayload,
                                    objectPayload + objectPayloadLength);
    } catch (...) {
      gRequestGate.release();
      delete request;
      napi_throw_error(env, nullptr,
                       "Private Vault native service request failed");
      return nullptr;
    }
  }

  if (request->operation == PVOperation::SealExport) {
    try {
      request->exportPlaintext.assign(
          exportPlaintext, exportPlaintext + exportPlaintextLength);
    } catch (...) {
      gRequestGate.release();
      delete request;
      napi_throw_error(env, nullptr,
                       "Private Vault native service request failed");
      return nullptr;
    }
    std::vector<uint8_t> recoveryPhrase;
    const bool collected =
        PVTrustedExportCollectPhrase(request->vaultID, recoveryPhrase);
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

  if (request->operation == PVOperation::ChallengeEnrollment ||
      request->operation == PVOperation::ConfirmEnrollment ||
      request->operation == PVOperation::AuthorizeEnrollment ||
      request->operation == PVOperation::ActivateEnrollment) {
    try {
      if (request->operation == PVOperation::ChallengeEnrollment ||
          request->operation == PVOperation::AuthorizeEnrollment)
        request->enrollmentOffer.assign(
            enrollmentOffer, enrollmentOffer + enrollmentOfferLength);
      if (request->operation == PVOperation::ChallengeEnrollment)
        request->enrollmentCandidateKeyProof.assign(
            enrollmentCandidateKeyProof,
            enrollmentCandidateKeyProof + enrollmentCandidateKeyProofLength);
      if (request->operation != PVOperation::ChallengeEnrollment)
        request->challenge.assign(
            enrollmentChallenge,
            enrollmentChallenge + enrollmentChallengeLength);
      if (request->operation == PVOperation::AuthorizeEnrollment)
        request->enrollmentSasDecision.assign(
            enrollmentSasDecision,
            enrollmentSasDecision + enrollmentSasDecisionLength);
      if (request->operation == PVOperation::ActivateEnrollment)
        request->authorization.assign(
            enrollmentAuthorization,
            enrollmentAuthorization + enrollmentAuthorizationLength);
    } catch (...) {
      gRequestGate.release();
      delete request;
      napi_throw_error(env, nullptr,
                       "Private Vault native service request failed");
      return nullptr;
    }
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
      request->operation == PVOperation::RecoverPage ||
      request->operation == PVOperation::EnrollmentBootstrap) {
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
  if (request->operation == PVOperation::ConfirmEnrollment &&
      !PVConfirmTrustedEnrollment(request)) {
    gRequestGate.release();
    delete request;
    napi_throw_error(env, nullptr,
                     "Private Vault native service request failed");
    return nullptr;
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
