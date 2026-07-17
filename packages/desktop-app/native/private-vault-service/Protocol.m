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
            strcmp(key, "requestId") != 0 && strcmp(key, "vaultId") != 0) {
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

PVRequestResult PVParseRequest(xpc_object_t message, PVRequest *request) {
    size_t fieldCount = 0;
    if (xpc_get_type(message) != XPC_TYPE_DICTIONARY || request == NULL ||
        !PVHasOnlyProtocolKeys(message, &fieldCount)) {
        return PVRequestInvalid;
    }

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

    bool resumeRotation = strcmp(operation, "resume_rotation") == 0;
    if (strcmp(operation, "health") != 0 && strcmp(operation, "lock") != 0 &&
        !resumeRotation) {
        return PVRequestUnsupportedOperation;
    }

    xpc_object_t vaultIDValue = xpc_dictionary_get_value(message, "vaultId");
    if (resumeRotation) {
        if (fieldCount != 4 || vaultIDValue == NULL ||
            xpc_get_type(vaultIDValue) != XPC_TYPE_STRING ||
            !PVIsVaultID(xpc_dictionary_get_string(message, "vaultId"))) {
            return PVRequestInvalid;
        }
    } else if (fieldCount != 3 || vaultIDValue != NULL) {
        return PVRequestInvalid;
    }

    request->operation = operation;
    request->requestID = requestID;
    request->vaultID =
        resumeRotation ? xpc_dictionary_get_string(message, "vaultId") : NULL;
    return PVRequestValid;
}
