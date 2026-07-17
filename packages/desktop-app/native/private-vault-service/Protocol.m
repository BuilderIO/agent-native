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

static bool PVHasOnlyProtocolKeys(xpc_object_t message) {
    __block size_t fieldCount = 0;
    __block bool allowed = true;

    xpc_dictionary_apply(message, ^bool(const char *key, xpc_object_t value) {
        (void)value;
        fieldCount += 1;
        if (fieldCount > PV_MAXIMUM_REQUEST_FIELDS) {
            allowed = false;
            return false;
        }

        if (strcmp(key, "version") != 0 && strcmp(key, "operation") != 0 &&
            strcmp(key, "requestId") != 0) {
            allowed = false;
            return false;
        }
        return true;
    });

    return allowed && fieldCount == PV_MAXIMUM_REQUEST_FIELDS;
}

PVRequestResult PVParseRequest(xpc_object_t message, PVRequest *request) {
    if (xpc_get_type(message) != XPC_TYPE_DICTIONARY || request == NULL ||
        !PVHasOnlyProtocolKeys(message)) {
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

    if (strcmp(operation, "health") != 0 && strcmp(operation, "lock") != 0) {
        return PVRequestUnsupportedOperation;
    }

    request->operation = operation;
    request->requestID = requestID;
    return PVRequestValid;
}
