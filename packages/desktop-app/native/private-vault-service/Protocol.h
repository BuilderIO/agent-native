#ifndef AGENT_NATIVE_PRIVATE_VAULT_SERVICE_PROTOCOL_H
#define AGENT_NATIVE_PRIVATE_VAULT_SERVICE_PROTOCOL_H

#include <xpc/xpc.h>

#define PV_PROTOCOL_VERSION 2
#define PV_MAXIMUM_REQUEST_FIELDS 4
#define PV_MAXIMUM_OPERATION_BYTES 16
#define PV_MAXIMUM_REQUEST_ID_BYTES 64
#define PV_VAULT_ID_BYTES 32

typedef enum {
    PVRequestValid = 0,
    PVRequestInvalid,
    PVRequestUnsupportedVersion,
    PVRequestUnsupportedOperation,
} PVRequestResult;

typedef struct {
    const char *operation;
    const char *requestID;
    const char *vaultID;
} PVRequest;

PVRequestResult PVParseRequest(xpc_object_t message, PVRequest *request);

#endif
