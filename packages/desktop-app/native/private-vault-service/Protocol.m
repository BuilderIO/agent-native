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

static bool PVIsVaultID(const char *value) {
    if (value == NULL || strnlen(value, PV_VAULT_ID_BYTES + 1) !=
                             PV_VAULT_ID_BYTES) {
        return false;
    }
    for (size_t index = 0; index < PV_VAULT_ID_BYTES; index += 1) {
        char byte = value[index];
        if (!((byte >= '0' && byte <= '9') ||
              (byte >= 'a' && byte <= 'f'))) {
            return false;
        }
    }
    return true;
}

static bool PVReadBoundedData(xpc_object_t message, const char *key,
                              size_t maximumLength, const void **bytes,
                              size_t *length) {
    xpc_object_t value = xpc_dictionary_get_value(message, key);
    if (value == NULL || xpc_get_type(value) != XPC_TYPE_DATA) {
        return false;
    }
    size_t actualLength = xpc_data_get_length(value);
    const void *actualBytes = xpc_data_get_bytes_ptr(value);
    if (actualBytes == NULL || actualLength == 0 ||
        actualLength > maximumLength) {
        return false;
    }
    *bytes = actualBytes;
    *length = actualLength;
    return true;
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
    if (strcmp(operation, "health") != 0 && strcmp(operation, "lock") != 0 &&
        !unlock && !resumeRotation && !commitGenesis && !prepareGenesis &&
        !confirmGenesis && !listGenesis && !inspectAdmission &&
        !authorizeAdmission && !acceptAdmission && !finalizeGenesis &&
        !acceptBootstrap && !recoverBegin && !recoverPage && !recoverStatus) {
        return PVRequestUnsupportedOperation;
    }

    xpc_object_t vaultIDValue = xpc_dictionary_get_value(message, "vaultId");
    xpc_object_t lookupIDValue = xpc_dictionary_get_value(message, "lookupId");
    if (unlock || resumeRotation || recoverStatus) {
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
        unlock || resumeRotation || recoverStatus
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
