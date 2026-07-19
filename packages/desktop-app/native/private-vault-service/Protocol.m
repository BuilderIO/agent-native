#import "Protocol.h"

#include <stdbool.h>
#include <string.h>

static bool PVIsAllowedRequestID(const char *value) {
    if (value == NULL) {
        return false;
    }

    size_t length = strnlen(value, PV_MAXIMUM_REQUEST_ID_BYTES + 1);
    if (length == 0 || length > PV_MAXIMUM_REQUEST_ID_BYTES) {
        return false;
    }

    for (size_t index = 0; index < length; index += 1) {
        char byte = value[index];
        bool allowed = (byte >= 'a' && byte <= 'z') ||
                       (byte >= 'A' && byte <= 'Z') ||
                       (byte >= '0' && byte <= '9') || byte == '-' ||
                       byte == '_';
        if (!allowed) {
            return false;
        }
    }
    return true;
}

static bool PVIsContentObjectType(const char *value) {
    return value != NULL &&
           (strcmp(value,
                   "application/vnd.agent-native.content-document+json") ==
                0 ||
            strcmp(value,
                   "application/vnd.agent-native.content-vault-manifest+json") ==
                0);
}

static bool PVHasOnlyProtocolKeys(xpc_object_t message,
                                  size_t *outputFieldCount) {
    __block size_t count = 0;
    __block bool allowed = true;

    xpc_dictionary_apply(message, ^bool(const char *key, xpc_object_t value) {
        (void)value;
        count += 1;
        if (count > PV_MAXIMUM_REQUEST_FIELDS) {
            allowed = false;
            return false;
        }

        if (strcmp(key, "version") != 0 && strcmp(key, "operation") != 0 &&
            strcmp(key, "requestId") != 0 && strcmp(key, "vaultId") != 0 &&
            strcmp(key, "recoveryConfirmation") != 0 &&
            strcmp(key, "bootstrapTranscript") != 0 &&
            strcmp(key, "authorization") != 0 &&
            strcmp(key, "lookupId") != 0 &&
            strcmp(key, "recoveryMnemonic") != 0 &&
            strcmp(key, "challenge") != 0 && strcmp(key, "receipt") != 0 &&
            strcmp(key, "bootstrapFrame") != 0) {
            if (strcmp(key, "jobId") == 0 ||
                strcmp(key, "jobEnvelope") == 0 ||
                strcmp(key, "jobHash") == 0 || strcmp(key, "state") == 0 ||
                strcmp(key, "resultPayload") == 0 ||
                strcmp(key, "epoch") == 0 ||
                strcmp(key, "retryCount") == 0 ||
                strcmp(key, "algorithmId") == 0 ||
                strcmp(key, "grantRef") == 0 ||
                strcmp(key, "recipientEndpointId") == 0 ||
                strcmp(key, "subjectAgentId") == 0 ||
                strcmp(key, "senderEndpointId") == 0 ||
                strcmp(key, "expiresAt") == 0 ||
                strcmp(key, "jobPayload") == 0 ||
                strcmp(key, "objectId") == 0 ||
                strcmp(key, "revision") == 0 ||
                strcmp(key, "contentType") == 0 ||
                strcmp(key, "objectPayload") == 0 ||
                strcmp(key, "exportId") == 0 ||
                strcmp(key, "createdAt") == 0 ||
                strcmp(key, "sourceSnapshotHash") == 0 ||
                strcmp(key, "objectCount") == 0 ||
                strcmp(key, "exportPlaintext") == 0) {
                return true;
            }
            if (strcmp(key, "unsignedProof") == 0) return true;
            if (strcmp(key, "offer") == 0 ||
                strcmp(key, "candidateKeyProof") == 0 ||
                strcmp(key, "sasDecision") == 0)
                return true;
            if (strcmp(key, "ceremonyToken") == 0 ||
                strcmp(key, "decision") == 0)
                return true;
            allowed = false;
            return false;
        }
        return true;
    });

    if (outputFieldCount != NULL) {
        *outputFieldCount = count;
    }
    return allowed;
}

static bool PVIsLowerHex(const char *value, size_t length) {
    if (value == NULL || strnlen(value, length + 1) != length) {
        return false;
    }
    for (size_t index = 0; index < length; index += 1) {
        char byte = value[index];
        if (!((byte >= '0' && byte <= '9') ||
              (byte >= 'a' && byte <= 'f'))) {
            return false;
        }
    }
    return true;
}

static bool PVIsVaultID(const char *value) {
    return PVIsLowerHex(value, PV_VAULT_ID_BYTES);
}

static bool PVReadBoundedDataRange(xpc_object_t message, const char *key,
                                   size_t minimumLength, size_t maximumLength,
                                   const void **bytes, size_t *length) {
    xpc_object_t value = xpc_dictionary_get_value(message, key);
    if (value == NULL || xpc_get_type(value) != XPC_TYPE_DATA) {
        return false;
    }
    size_t actualLength = xpc_data_get_length(value);
    const void *actualBytes = xpc_data_get_bytes_ptr(value);
    if (actualLength < minimumLength || actualLength > maximumLength ||
        (actualLength > 0 && actualBytes == NULL)) {
        return false;
    }
    *bytes = actualBytes;
    *length = actualLength;
    return true;
}

static bool PVReadBoundedData(xpc_object_t message, const char *key,
                              size_t maximumLength, const void **bytes,
                              size_t *length) {
    return PVReadBoundedDataRange(message, key, 1, maximumLength, bytes,
                                  length);
}

PVRequestResult PVParseRequest(xpc_object_t message, PVRequest *request) {
    size_t fieldCount = 0;
    if (xpc_get_type(message) != XPC_TYPE_DICTIONARY || request == NULL ||
        !PVHasOnlyProtocolKeys(message, &fieldCount)) {
        return PVRequestInvalid;
    }
    memset(request, 0, sizeof(*request));

    xpc_object_t versionValue = xpc_dictionary_get_value(message, "version");
    xpc_object_t operationValue =
        xpc_dictionary_get_value(message, "operation");
    xpc_object_t requestIDValue =
        xpc_dictionary_get_value(message, "requestId");
    if (versionValue == NULL || xpc_get_type(versionValue) != XPC_TYPE_INT64 ||
        operationValue == NULL ||
        xpc_get_type(operationValue) != XPC_TYPE_STRING ||
        requestIDValue == NULL ||
        xpc_get_type(requestIDValue) != XPC_TYPE_STRING) {
        return PVRequestInvalid;
    }

    if (xpc_dictionary_get_int64(message, "version") != PV_PROTOCOL_VERSION) {
        return PVRequestUnsupportedVersion;
    }

    const char *operation =
        xpc_dictionary_get_string(message, "operation");
    const char *requestID =
        xpc_dictionary_get_string(message, "requestId");
    size_t operationLength = operation == NULL
                                 ? 0
                                 : strnlen(operation,
                                           PV_MAXIMUM_OPERATION_BYTES + 1);
    if (operationLength == 0 || operationLength > PV_MAXIMUM_OPERATION_BYTES ||
        !PVIsAllowedRequestID(requestID)) {
        return PVRequestInvalid;
    }

    bool unlock = strcmp(operation, "unlock") == 0;
    bool resumeRotation = strcmp(operation, "resume_rotation") == 0;
    bool commitGenesis = strcmp(operation, "commit_genesis") == 0;
    bool prepareGenesis = strcmp(operation, "prepare_genesis") == 0;
    bool confirmGenesis = strcmp(operation, "confirm_genesis") == 0;
    bool listGenesis = strcmp(operation, "list_genesis") == 0;
    bool inspectAdmission = strcmp(operation, "inspect_admit") == 0;
    bool authorizeAdmission = strcmp(operation, "authorize_admit") == 0;
    bool acceptAdmission = strcmp(operation, "accept_admit") == 0;
    bool finalizeGenesis = strcmp(operation, "finalize_genesis") == 0;
    bool acceptBootstrap = strcmp(operation, "accept_bootstrap") == 0;
    bool recoverBegin = strcmp(operation, "recover_begin") == 0;
    bool recoverPage = strcmp(operation, "recover_page") == 0;
    bool recoverStatus = strcmp(operation, "recover_status") == 0;
    bool openJob = strcmp(operation, "open_job") == 0;
    bool createGrant = strcmp(operation, "create_grant") == 0;
    bool listGrants = strcmp(operation, "list_grants") == 0;
    bool listMembers = strcmp(operation, "list_members") == 0;
    bool revokeGrant = strcmp(operation, "revoke_grant") == 0;
    bool sealJob = strcmp(operation, "seal_job") == 0;
    bool openResult = strcmp(operation, "open_result") == 0;
    bool sealResult = strcmp(operation, "seal_result") == 0;
    bool completeResult = strcmp(operation, "complete_result") == 0;
    bool pendingResult = strcmp(operation, "pending_result") == 0;
    bool signRequest = strcmp(operation, "sign_request") == 0;
    bool prepareEnrollment = strcmp(operation, "prepare_enroll") == 0;
    bool challengeEnrollment = strcmp(operation, "challenge_enroll") == 0;
    bool inspectEnrollment = strcmp(operation, "inspect_enroll") == 0;
    bool decideEnrollment = strcmp(operation, "decide_enroll") == 0;
    bool authorizeEnrollment = strcmp(operation, "authorize_enroll") == 0;
    bool activateEnrollment = strcmp(operation, "activate_enroll") == 0;
    bool enrollmentBootstrap = strcmp(operation, "enroll_page") == 0;
    bool sealObject = strcmp(operation, "seal_object") == 0;
    bool openObject = strcmp(operation, "open_object") == 0;
    bool sealJobObject = strcmp(operation, "seal_job_object") == 0;
    bool openJobObject = strcmp(operation, "open_job_object") == 0;
    bool sealExport = strcmp(operation, "seal_export") == 0;
    if (strcmp(operation, "health") != 0 && strcmp(operation, "lock") != 0 &&
        !unlock && !resumeRotation && !commitGenesis && !prepareGenesis &&
        !confirmGenesis && !listGenesis && !inspectAdmission &&
        !authorizeAdmission && !acceptAdmission && !finalizeGenesis &&
        !acceptBootstrap && !recoverBegin && !recoverPage && !recoverStatus &&
        !openJob && !createGrant && !listGrants && !listMembers &&
        !revokeGrant && !sealJob && !openResult && !sealResult &&
        !completeResult && !pendingResult &&
        !signRequest && !prepareEnrollment && !challengeEnrollment &&
        !inspectEnrollment && !decideEnrollment && !authorizeEnrollment &&
        !activateEnrollment && !enrollmentBootstrap && !sealObject &&
        !openObject && !sealJobObject &&
        !openJobObject && !sealExport) {
        return PVRequestUnsupportedOperation;
    }

    xpc_object_t vaultIDValue = xpc_dictionary_get_value(message, "vaultId");
    xpc_object_t lookupIDValue = xpc_dictionary_get_value(message, "lookupId");
    if (sealExport) {
        xpc_object_t exportIDValue =
            xpc_dictionary_get_value(message, "exportId");
        xpc_object_t createdAtValue =
            xpc_dictionary_get_value(message, "createdAt");
        xpc_object_t snapshotValue =
            xpc_dictionary_get_value(message, "sourceSnapshotHash");
        xpc_object_t objectCountValue =
            xpc_dictionary_get_value(message, "objectCount");
        const char *exportID =
            exportIDValue != NULL &&
                    xpc_get_type(exportIDValue) == XPC_TYPE_STRING
                ? xpc_dictionary_get_string(message, "exportId")
                : NULL;
        const char *snapshot =
            snapshotValue != NULL &&
                    xpc_get_type(snapshotValue) == XPC_TYPE_STRING
                ? xpc_dictionary_get_string(message, "sourceSnapshotHash")
                : NULL;
        uint64_t createdAt =
            createdAtValue != NULL &&
                    xpc_get_type(createdAtValue) == XPC_TYPE_UINT64
                ? xpc_dictionary_get_uint64(message, "createdAt")
                : 0;
        uint64_t objectCount =
            objectCountValue != NULL &&
                    xpc_get_type(objectCountValue) == XPC_TYPE_UINT64
                ? xpc_dictionary_get_uint64(message, "objectCount")
                : 0;
        if (fieldCount != 10 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId")) ||
            !PVIsVaultID(exportID) || !PVIsLowerHex(snapshot, 64) ||
            createdAt == 0 || createdAt > UINT64_C(9007199254740991) ||
            objectCount == 0 ||
            objectCount > UINT64_C(9007199254740991) ||
            !PVReadBoundedData(message, "recoveryMnemonic",
                               PV_GENESIS_MNEMONIC_MAXIMUM_BYTES,
                               &request->recoveryMnemonic,
                               &request->recoveryMnemonicLength) ||
            !PVReadBoundedData(message, "exportPlaintext",
                               PV_EXPORT_PLAINTEXT_MAXIMUM_BYTES,
                               &request->exportPlaintext,
                               &request->exportPlaintextLength)) {
            return PVRequestInvalid;
        }
        request->exportID = exportID;
        request->sourceSnapshotHash = snapshot;
        request->exportCreatedAt = createdAt;
        request->exportObjectCount = objectCount;
    } else if (openResult) {
        xpc_object_t jobIDValue = xpc_dictionary_get_value(message, "jobId");
        xpc_object_t senderValue =
            xpc_dictionary_get_value(message, "senderEndpointId");
        const char *sender =
            senderValue != NULL && xpc_get_type(senderValue) == XPC_TYPE_STRING
                ? xpc_dictionary_get_string(message, "senderEndpointId")
                : NULL;
        if (fieldCount != 8 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId")) ||
            jobIDValue == NULL || xpc_get_type(jobIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "jobId")) ||
            !PVIsLowerHex(xpc_dictionary_get_string(message, "jobHash"), 64) ||
            !PVIsLowerHex(sender, 32) ||
            !PVReadBoundedData(message, "resultPayload",
                               PV_JOB_ENVELOPE_MAXIMUM_BYTES,
                               &request->resultPayload,
                               &request->resultPayloadLength)) {
            return PVRequestInvalid;
        }
        request->jobID = xpc_dictionary_get_string(message, "jobId");
        request->jobHash = xpc_dictionary_get_string(message, "jobHash");
        request->senderEndpointID = sender;
    } else if (listGrants || listMembers) {
        if (fieldCount != 4 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId"))) {
            return PVRequestInvalid;
        }
    } else if (revokeGrant) {
        xpc_object_t grantValue =
            xpc_dictionary_get_value(message, "grantRef");
        const char *grantRef =
            grantValue != NULL && xpc_get_type(grantValue) == XPC_TYPE_STRING
                ? xpc_dictionary_get_string(message, "grantRef")
                : NULL;
        if (fieldCount != 5 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId")) ||
            !PVIsLowerHex(grantRef, 64)) {
            return PVRequestInvalid;
        }
        request->grantRef = grantRef;
    } else if (createGrant) {
        xpc_object_t recipientValue =
            xpc_dictionary_get_value(message, "recipientEndpointId");
        xpc_object_t expiresValue =
            xpc_dictionary_get_value(message, "expiresAt");
        xpc_object_t agentValue =
            xpc_dictionary_get_value(message, "subjectAgentId");
        const char *recipient =
            recipientValue != NULL &&
                    xpc_get_type(recipientValue) == XPC_TYPE_STRING
                ? xpc_dictionary_get_string(message, "recipientEndpointId")
                : NULL;
        int64_t expires =
            expiresValue != NULL && xpc_get_type(expiresValue) == XPC_TYPE_INT64
                ? xpc_dictionary_get_int64(message, "expiresAt")
                : 0;
        const char *agent =
            agentValue != NULL && xpc_get_type(agentValue) == XPC_TYPE_STRING
                ? xpc_dictionary_get_string(message, "subjectAgentId")
                : NULL;
        if (fieldCount != 7 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId")) ||
            !PVIsLowerHex(recipient, 32) || !PVIsLowerHex(agent, 32) ||
            expires <= 0 ||
            expires > INT64_C(9007199254740991)) {
            return PVRequestInvalid;
        }
        request->recipientEndpointID = recipient;
        request->subjectAgentID = agent;
        request->expiresAt = (uint64_t)expires;
    } else if (sealJob) {
        xpc_object_t jobIDValue = xpc_dictionary_get_value(message, "jobId");
        xpc_object_t grantValue = xpc_dictionary_get_value(message, "grantRef");
        xpc_object_t recipientValue =
            xpc_dictionary_get_value(message, "recipientEndpointId");
        xpc_object_t expiresValue =
            xpc_dictionary_get_value(message, "expiresAt");
        const char *grantRef =
            grantValue != NULL && xpc_get_type(grantValue) == XPC_TYPE_STRING
                ? xpc_dictionary_get_string(message, "grantRef")
                : NULL;
        const char *recipient =
            recipientValue != NULL &&
                    xpc_get_type(recipientValue) == XPC_TYPE_STRING
                ? xpc_dictionary_get_string(message, "recipientEndpointId")
                : NULL;
        int64_t expires =
            expiresValue != NULL && xpc_get_type(expiresValue) == XPC_TYPE_INT64
                ? xpc_dictionary_get_int64(message, "expiresAt")
                : 0;
        if (fieldCount != 9 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId")) ||
            jobIDValue == NULL || xpc_get_type(jobIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "jobId")) ||
            !PVIsLowerHex(grantRef, 64) || !PVIsLowerHex(recipient, 32) ||
            expires <= 0 || expires > INT64_C(9007199254740991) ||
            !PVReadBoundedDataRange(message, "jobPayload", 0,
                                    PV_JOB_PAYLOAD_MAXIMUM_BYTES,
                                    &request->jobPayload,
                                    &request->jobPayloadLength)) {
            return PVRequestInvalid;
        }
        request->jobID = xpc_dictionary_get_string(message, "jobId");
        request->grantRef = grantRef;
        request->recipientEndpointID = recipient;
        request->expiresAt = (uint64_t)expires;
    } else if (sealObject || openObject || sealJobObject || openJobObject) {
        bool sealing = sealObject || sealJobObject;
        bool jobBound = sealJobObject || openJobObject;
        xpc_object_t objectIDValue =
            xpc_dictionary_get_value(message, "objectId");
        xpc_object_t revisionValue =
            xpc_dictionary_get_value(message, "revision");
        xpc_object_t contentTypeValue =
            xpc_dictionary_get_value(message, "contentType");
        const char *objectID =
            objectIDValue != NULL &&
                    xpc_get_type(objectIDValue) == XPC_TYPE_STRING
                ? xpc_dictionary_get_string(message, "objectId")
                : NULL;
        int64_t revision =
            revisionValue != NULL &&
                    xpc_get_type(revisionValue) == XPC_TYPE_INT64
                ? xpc_dictionary_get_int64(message, "revision")
                : 0;
        const char *contentType =
            contentTypeValue != NULL &&
                    xpc_get_type(contentTypeValue) == XPC_TYPE_STRING
                ? xpc_dictionary_get_string(message, "contentType")
                : NULL;
        xpc_object_t jobIDValue = xpc_dictionary_get_value(message, "jobId");
        xpc_object_t jobHashValue =
            xpc_dictionary_get_value(message, "jobHash");
        const char *jobHash =
            jobHashValue != NULL &&
                    xpc_get_type(jobHashValue) == XPC_TYPE_STRING
                ? xpc_dictionary_get_string(message, "jobHash")
                : NULL;
        size_t maximum = sealing ? PV_OBJECT_PLAINTEXT_MAXIMUM_BYTES
                                 : PV_OBJECT_REVISION_MAXIMUM_BYTES;
        if (fieldCount != (sealing ? (jobBound ? 10 : 8)
                                    : (jobBound ? 9 : 7)) ||
            vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId")) ||
            !PVIsLowerHex(objectID, 32) || revision <= 0 ||
            revision > INT64_C(9007199254740991) ||
            (sealing && !PVIsContentObjectType(contentType)) ||
            (!sealing && contentTypeValue != NULL) ||
            (jobBound &&
             (jobIDValue == NULL ||
              xpc_get_type(jobIDValue) != XPC_TYPE_STRING ||
              !PVIsVaultID(xpc_dictionary_get_string(message, "jobId")) ||
              !PVIsLowerHex(jobHash, 64))) ||
            (!jobBound && (jobIDValue != NULL || jobHashValue != NULL)) ||
            !PVReadBoundedData(message, "objectPayload", maximum,
                               &request->objectPayload,
                               &request->objectPayloadLength)) {
            return PVRequestInvalid;
        }
        request->objectID = objectID;
        request->objectRevision = (uint64_t)revision;
        request->objectContentType = contentType;
        if (jobBound) {
            request->jobID = xpc_dictionary_get_string(message, "jobId");
            request->jobHash = jobHash;
        }
    } else if (prepareEnrollment) {
        if (fieldCount != 4 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId"))) {
            return PVRequestInvalid;
        }
    } else if (challengeEnrollment) {
        if (fieldCount != 6 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId")) ||
            !PVReadBoundedData(message, "offer",
                               PV_ENROLLMENT_OFFER_MAXIMUM_BYTES,
                               &request->enrollmentOffer,
                               &request->enrollmentOfferLength) ||
            !PVReadBoundedDataRange(
                message, "candidateKeyProof",
                PV_ENROLLMENT_CANDIDATE_PROOF_BYTES,
                PV_ENROLLMENT_CANDIDATE_PROOF_BYTES,
                &request->enrollmentCandidateKeyProof,
                &request->enrollmentCandidateKeyProofLength)) {
            return PVRequestInvalid;
        }
    } else if (inspectEnrollment) {
        if (fieldCount != 5 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId")) ||
            !PVReadBoundedData(message, "challenge",
                               PV_ENROLLMENT_CHALLENGE_MAXIMUM_BYTES,
                               &request->enrollmentChallenge,
                               &request->enrollmentChallengeLength)) {
            return PVRequestInvalid;
        }
    } else if (authorizeEnrollment) {
        if (fieldCount != 7 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId")) ||
            !PVReadBoundedData(message, "offer",
                               PV_ENROLLMENT_OFFER_MAXIMUM_BYTES,
                               &request->enrollmentOffer,
                               &request->enrollmentOfferLength) ||
            !PVReadBoundedData(message, "challenge",
                               PV_ENROLLMENT_CHALLENGE_MAXIMUM_BYTES,
                               &request->enrollmentChallenge,
                               &request->enrollmentChallengeLength) ||
            !PVReadBoundedData(message, "sasDecision",
                               PV_ENROLLMENT_SAS_DECISION_MAXIMUM_BYTES,
                               &request->enrollmentSasDecision,
                               &request->enrollmentSasDecisionLength)) {
            return PVRequestInvalid;
        }
    } else if (decideEnrollment) {
        xpc_object_t tokenValue =
            xpc_dictionary_get_value(message, "ceremonyToken");
        xpc_object_t decisionValue =
            xpc_dictionary_get_value(message, "decision");
        const char *token =
            tokenValue != NULL && xpc_get_type(tokenValue) == XPC_TYPE_STRING
                ? xpc_dictionary_get_string(message, "ceremonyToken")
                : NULL;
        const char *decision =
            decisionValue != NULL &&
                    xpc_get_type(decisionValue) == XPC_TYPE_STRING
                ? xpc_dictionary_get_string(message, "decision")
                : NULL;
        if (fieldCount != 5 || vaultIDValue != NULL ||
            !PVIsLowerHex(token, 32) || decision == NULL ||
            (strcmp(decision, "confirmed") != 0 &&
             strcmp(decision, "mismatch") != 0)) {
            return PVRequestInvalid;
        }
        request->ceremonyToken = token;
        request->decision = decision;
    } else if (activateEnrollment) {
        if (fieldCount != 6 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId")) ||
            !PVReadBoundedData(message, "challenge",
                               PV_ENROLLMENT_CHALLENGE_MAXIMUM_BYTES,
                               &request->enrollmentChallenge,
                               &request->enrollmentChallengeLength) ||
            !PVReadBoundedData(message, "authorization",
                               PV_ENROLLMENT_AUTHORIZATION_MAXIMUM_BYTES,
                               &request->enrollmentAuthorization,
                               &request->enrollmentAuthorizationLength)) {
            return PVRequestInvalid;
        }
    } else if (signRequest) {
        if (fieldCount != 4 || vaultIDValue != NULL ||
            !PVReadBoundedData(message, "unsignedProof",
                               PV_ENDPOINT_PROOF_MAXIMUM_BYTES,
                               &request->unsignedProof,
                               &request->unsignedProofLength)) {
            return PVRequestInvalid;
        }
    } else if (sealResult || completeResult) {
        xpc_object_t jobIDValue = xpc_dictionary_get_value(message, "jobId");
        xpc_object_t jobHashValue = xpc_dictionary_get_value(message, "jobHash");
        xpc_object_t stateValue = xpc_dictionary_get_value(message, "state");
        const char *hash = jobHashValue != NULL &&
                                  xpc_get_type(jobHashValue) == XPC_TYPE_STRING
                              ? xpc_dictionary_get_string(message, "jobHash")
                              : NULL;
        const char *state = stateValue != NULL &&
                                   xpc_get_type(stateValue) == XPC_TYPE_STRING
                               ? xpc_dictionary_get_string(message, "state")
                               : NULL;
        size_t expectedFields = completeResult ? 7 : 8;
        if (fieldCount != expectedFields || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId")) ||
            jobIDValue == NULL || xpc_get_type(jobIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "jobId")) ||
            !PVIsLowerHex(hash, 64) || state == NULL ||
            (strcmp(state, "completed") != 0 && strcmp(state, "failed") != 0) ||
            (!completeResult &&
             !PVReadBoundedDataRange(message, "resultPayload", 0,
                                     16 * 1024 * 1024,
                                     &request->resultPayload,
                                     &request->resultPayloadLength)))
            return PVRequestInvalid;
        request->jobID = xpc_dictionary_get_string(message, "jobId");
        request->jobHash = hash;
        request->resultState = state;
    } else if (openJob) {
        xpc_object_t jobIDValue = xpc_dictionary_get_value(message, "jobId");
        xpc_object_t epochValue = xpc_dictionary_get_value(message, "epoch");
        xpc_object_t retryValue =
            xpc_dictionary_get_value(message, "retryCount");
        xpc_object_t algorithmValue =
            xpc_dictionary_get_value(message, "algorithmId");
        const char *algorithm =
            algorithmValue != NULL &&
                    xpc_get_type(algorithmValue) == XPC_TYPE_STRING
                ? xpc_dictionary_get_string(message, "algorithmId")
                : NULL;
        int64_t epoch = epochValue != NULL &&
                                xpc_get_type(epochValue) == XPC_TYPE_INT64
                            ? xpc_dictionary_get_int64(message, "epoch")
                            : 0;
        int64_t retry = retryValue != NULL &&
                                xpc_get_type(retryValue) == XPC_TYPE_INT64
                            ? xpc_dictionary_get_int64(message, "retryCount")
                            : -1;
        if (fieldCount != 9 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId")) ||
            jobIDValue == NULL ||
            xpc_get_type(jobIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "jobId")) ||
            epoch <= 0 || retry < 0 || retry > 100 || algorithm == NULL ||
            strnlen(algorithm, 161) == 0 || strnlen(algorithm, 161) > 160 ||
            !PVReadBoundedData(message, "jobEnvelope",
                               PV_JOB_ENVELOPE_MAXIMUM_BYTES,
                               &request->jobEnvelope,
                               &request->jobEnvelopeLength)) {
            return PVRequestInvalid;
        }
        request->jobID = xpc_dictionary_get_string(message, "jobId");
        request->hostedEpoch = (uint64_t)epoch;
        request->hostedRetryCount = (uint64_t)retry;
        request->algorithmID = algorithm;
    } else if (unlock || resumeRotation || recoverStatus || pendingResult) {
        if (fieldCount != 4 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId"))) {
            return PVRequestInvalid;
        }
    } else if (commitGenesis) {
        if (fieldCount != 6 || vaultIDValue != NULL ||
            !PVReadBoundedData(message, "recoveryConfirmation",
                               PV_GENESIS_CONFIRMATION_MAXIMUM_BYTES,
                               &request->recoveryConfirmation,
                               &request->recoveryConfirmationLength) ||
            !PVReadBoundedData(message, "bootstrapTranscript",
                               PV_GENESIS_TRANSCRIPT_MAXIMUM_BYTES,
                               &request->bootstrapTranscript,
                               &request->bootstrapTranscriptLength) ||
            !PVReadBoundedData(message, "authorization",
                               PV_GENESIS_AUTHORIZATION_MAXIMUM_BYTES,
                               &request->authorization,
                               &request->authorizationLength)) {
            return PVRequestInvalid;
        }
    } else if (confirmGenesis) {
        if (fieldCount != 5 || vaultIDValue != NULL || lookupIDValue == NULL ||
            xpc_get_type(lookupIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "lookupId")) ||
            !PVReadBoundedData(message, "recoveryMnemonic",
                               PV_GENESIS_MNEMONIC_MAXIMUM_BYTES,
                               &request->recoveryMnemonic,
                               &request->recoveryMnemonicLength)) {
            return PVRequestInvalid;
        }
    } else if (inspectAdmission || authorizeAdmission) {
        if (fieldCount != 5 || vaultIDValue != NULL || lookupIDValue == NULL ||
            xpc_get_type(lookupIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "lookupId")) ||
            !PVReadBoundedData(message, "challenge",
                               PV_GENESIS_CHALLENGE_MAXIMUM_BYTES,
                               &request->challenge,
                               &request->challengeLength)) {
            return PVRequestInvalid;
        }
    } else if (acceptAdmission) {
        if (fieldCount != 6 || vaultIDValue != NULL || lookupIDValue == NULL ||
            xpc_get_type(lookupIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "lookupId")) ||
            !PVReadBoundedData(message, "challenge",
                               PV_GENESIS_CHALLENGE_MAXIMUM_BYTES,
                               &request->challenge,
                               &request->challengeLength) ||
            !PVReadBoundedData(message, "receipt",
                               PV_GENESIS_RECEIPT_MAXIMUM_BYTES,
                               &request->receipt, &request->receiptLength)) {
            return PVRequestInvalid;
        }
    } else if (finalizeGenesis) {
        if (fieldCount != 5 || vaultIDValue != NULL || lookupIDValue == NULL ||
            xpc_get_type(lookupIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "lookupId")) ||
            !PVReadBoundedData(message, "receipt",
                               PV_GENESIS_RECEIPT_MAXIMUM_BYTES,
                               &request->receipt, &request->receiptLength)) {
            return PVRequestInvalid;
        }
    } else if (enrollmentBootstrap) {
        if (fieldCount != 5 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId")) ||
            !PVReadBoundedData(message, "bootstrapFrame",
                               PV_BOOTSTRAP_FRAME_MAXIMUM_BYTES,
                               &request->bootstrapFrame,
                               &request->bootstrapFrameLength)) {
            return PVRequestInvalid;
        }
    } else if (acceptBootstrap) {
        if (fieldCount != 4 || vaultIDValue != NULL || lookupIDValue != NULL ||
            !PVReadBoundedData(message, "bootstrapFrame",
                               PV_BOOTSTRAP_FRAME_MAXIMUM_BYTES,
                               &request->bootstrapFrame,
                               &request->bootstrapFrameLength)) {
            return PVRequestInvalid;
        }
    } else if (recoverBegin) {
        if (fieldCount != 5 || vaultIDValue != NULL || lookupIDValue != NULL ||
            !PVReadBoundedData(message, "bootstrapFrame",
                               PV_BOOTSTRAP_FRAME_MAXIMUM_BYTES,
                               &request->bootstrapFrame,
                               &request->bootstrapFrameLength) ||
            !PVReadBoundedData(message, "recoveryMnemonic",
                               PV_GENESIS_MNEMONIC_MAXIMUM_BYTES,
                               &request->recoveryMnemonic,
                               &request->recoveryMnemonicLength)) {
            return PVRequestInvalid;
        }
    } else if (recoverPage) {
        if (fieldCount != 4 || vaultIDValue != NULL || lookupIDValue != NULL ||
            !PVReadBoundedData(message, "bootstrapFrame",
                               PV_BOOTSTRAP_FRAME_MAXIMUM_BYTES,
                               &request->bootstrapFrame,
                               &request->bootstrapFrameLength)) {
            return PVRequestInvalid;
        }
    } else if (fieldCount != 3 || vaultIDValue != NULL ||
               lookupIDValue != NULL) {
        return PVRequestInvalid;
    }

    request->operation = operation;
    request->requestID = requestID;
    request->vaultID =
        unlock || resumeRotation || recoverStatus || openJob || createGrant ||
                sealJob || openResult || sealResult ||
                completeResult || pendingResult || prepareEnrollment ||
                challengeEnrollment || inspectEnrollment ||
                authorizeEnrollment || activateEnrollment ||
                enrollmentBootstrap || listGrants || listMembers ||
                revokeGrant || sealObject ||
                openObject || sealExport
            ? xpc_dictionary_get_string(message, "vaultId")
            : NULL;
    request->lookupID =
        confirmGenesis || inspectAdmission || authorizeAdmission ||
                acceptAdmission || finalizeGenesis
            ? xpc_dictionary_get_string(message, "lookupId")
            : NULL;
    return PVRequestValid;
}

bool PVRequestCanRun(const PVRequest *request, bool startupComplete) {
    return startupComplete && request != NULL && request->operation != NULL &&
           request->requestID != NULL;
}
