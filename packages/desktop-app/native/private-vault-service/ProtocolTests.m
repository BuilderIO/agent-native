#import <xpc/xpc.h>
#import <Security/Security.h>

#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "Protocol.h"
#include "PrivateVaultServiceIdentity.h"

static xpc_object_t PVMakeRequest(int64_t version, const char *operation,
                                  const char *requestID) {
    xpc_object_t request = xpc_dictionary_create(NULL, NULL, 0);
    xpc_dictionary_set_int64(request, "version", version);
    xpc_dictionary_set_string(request, "operation", operation);
    xpc_dictionary_set_string(request, "requestId", requestID);
    return request;
}

int main(void) {
    PVRequest parsed = {0};

    SecRequirementRef clientRequirement = NULL;
    assert(SecRequirementCreateWithString(
               (__bridge CFStringRef)@PV_CLIENT_REQUIREMENT,
               kSecCSDefaultFlags, &clientRequirement) == errSecSuccess);
    assert(clientRequirement != NULL);
    CFRelease(clientRequirement);

    xpc_object_t health = PVMakeRequest(1, "health", "request_1");
    assert(PVParseRequest(health, &parsed) == PVRequestValid);
    assert(strcmp(parsed.operation, "health") == 0);
    xpc_release(health);

    xpc_object_t lock = PVMakeRequest(1, "lock", "request-2");
    assert(PVParseRequest(lock, &parsed) == PVRequestValid);
    xpc_release(lock);

    xpc_object_t wrongVersion = PVMakeRequest(2, "health", "request_3");
    assert(PVParseRequest(wrongVersion, &parsed) ==
           PVRequestUnsupportedVersion);
    xpc_release(wrongVersion);

    xpc_object_t unknown = PVMakeRequest(1, "unlock", "request_4");
    assert(PVParseRequest(unknown, &parsed) ==
           PVRequestUnsupportedOperation);
    xpc_release(unknown);

    xpc_object_t extra = PVMakeRequest(1, "health", "request_5");
    xpc_dictionary_set_data(extra, "payload", "secret", 6);
    assert(PVParseRequest(extra, &parsed) == PVRequestInvalid);
    xpc_release(extra);

    xpc_object_t missing = xpc_dictionary_create(NULL, NULL, 0);
    xpc_dictionary_set_int64(missing, "version", 1);
    xpc_dictionary_set_string(missing, "operation", "health");
    assert(PVParseRequest(missing, &parsed) == PVRequestInvalid);
    xpc_release(missing);

    xpc_object_t wrongType = xpc_dictionary_create(NULL, NULL, 0);
    xpc_dictionary_set_string(wrongType, "version", "1");
    xpc_dictionary_set_string(wrongType, "operation", "health");
    xpc_dictionary_set_string(wrongType, "requestId", "request_6");
    assert(PVParseRequest(wrongType, &parsed) == PVRequestInvalid);
    xpc_release(wrongType);

    char oversizedOperation[PV_MAXIMUM_OPERATION_BYTES + 2];
    memset(oversizedOperation, 'a', sizeof(oversizedOperation) - 1);
    oversizedOperation[sizeof(oversizedOperation) - 1] = '\0';
    xpc_object_t longOperation =
        PVMakeRequest(1, oversizedOperation, "request_7");
    assert(PVParseRequest(longOperation, &parsed) == PVRequestInvalid);
    xpc_release(longOperation);

    char oversizedID[PV_MAXIMUM_REQUEST_ID_BYTES + 2];
    memset(oversizedID, 'a', sizeof(oversizedID) - 1);
    oversizedID[sizeof(oversizedID) - 1] = '\0';
    xpc_object_t longID = PVMakeRequest(1, "health", oversizedID);
    assert(PVParseRequest(longID, &parsed) == PVRequestInvalid);
    xpc_release(longID);

    xpc_object_t invalidID = PVMakeRequest(1, "health", "not allowed");
    assert(PVParseRequest(invalidID, &parsed) == PVRequestInvalid);
    xpc_release(invalidID);

    assert(PVParseRequest(XPC_BOOL_TRUE, &parsed) == PVRequestInvalid);
    xpc_object_t nullTarget = PVMakeRequest(1, "health", "request_8");
    assert(PVParseRequest(nullTarget, NULL) == PVRequestInvalid);
    xpc_release(nullTarget);

    puts("private-vault-service protocol tests passed");
    return 0;
}
