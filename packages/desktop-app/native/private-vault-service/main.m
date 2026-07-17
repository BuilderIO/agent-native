#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <xpc/xpc.h>

#include <stdlib.h>
#include <string.h>

#include "PrivateVaultServiceIdentity.h"
#include "Protocol.h"

static SecRequirementRef gClientRequirement = NULL;

static bool PVAuthenticateMessage(xpc_object_t message) {
    if (xpc_get_type(message) != XPC_TYPE_DICTIONARY ||
        gClientRequirement == NULL) {
        return false;
    }

    // This derives the sender directly from this message's kernel audit token.
    // It deliberately does not trust a PID, executable path, or caller field.
    SecCodeRef sender = NULL;
    OSStatus createStatus = SecCodeCreateWithXPCMessage(
        message, kSecCSDefaultFlags, &sender);
    if (createStatus != errSecSuccess || sender == NULL) {
        return false;
    }

    OSStatus validityStatus = SecCodeCheckValidity(
        sender, kSecCSStrictValidate, gClientRequirement);
    CFRelease(sender);
    return validityStatus == errSecSuccess;
}

static void PVSendError(xpc_connection_t peer, xpc_object_t message,
                        const char *code) {
    xpc_object_t reply = xpc_dictionary_create_reply(message);
    if (reply == NULL) {
        return;
    }
    xpc_dictionary_set_int64(reply, "version", PV_PROTOCOL_VERSION);
    xpc_dictionary_set_bool(reply, "ok", false);
    xpc_dictionary_set_string(reply, "error", code);
    xpc_connection_send_message(peer, reply);
}

static void PVSendSuccess(xpc_connection_t peer, xpc_object_t message,
                          const PVRequest *request) {
    xpc_object_t reply = xpc_dictionary_create_reply(message);
    if (reply == NULL) {
        return;
    }
    xpc_dictionary_set_int64(reply, "version", PV_PROTOCOL_VERSION);
    xpc_dictionary_set_bool(reply, "ok", true);
    xpc_dictionary_set_string(reply, "requestId", request->requestID);

    if (strcmp(request->operation, "health") == 0) {
        // Phase 1A has intentionally not activated key or crypto operations.
        xpc_dictionary_set_string(reply, "state", "unavailable");
        xpc_dictionary_set_bool(reply, "available", false);
    } else {
        xpc_dictionary_set_string(reply, "state", "locked");
    }

    xpc_connection_send_message(peer, reply);
}

static void PVHandleMessage(xpc_connection_t peer, xpc_object_t message) {
    if (xpc_get_type(message) == XPC_TYPE_ERROR) {
        return;
    }
    if (xpc_get_type(message) != XPC_TYPE_DICTIONARY) {
        // XPC reply objects can only be created from request dictionaries.
        return;
    }
    if (!PVAuthenticateMessage(message)) {
        PVSendError(peer, message, "unauthorized");
        return;
    }

    PVRequest request = {0};
    switch (PVParseRequest(message, &request)) {
        case PVRequestValid:
            PVSendSuccess(peer, message, &request);
            return;
        case PVRequestUnsupportedVersion:
            PVSendError(peer, message, "unsupported_version");
            return;
        case PVRequestUnsupportedOperation:
            PVSendError(peer, message, "unsupported_operation");
            return;
        case PVRequestInvalid:
        default:
            PVSendError(peer, message, "invalid_request");
            return;
    }
}

static void PVAcceptPeer(xpc_connection_t peer) {
    int requirementStatus = xpc_connection_set_peer_code_signing_requirement(
        peer, PV_CLIENT_REQUIREMENT);
    if (requirementStatus != 0) {
        xpc_connection_cancel(peer);
        return;
    }

    xpc_connection_set_event_handler(peer, ^(xpc_object_t message) {
        PVHandleMessage(peer, message);
    });
    xpc_connection_resume(peer);
}

static void PVConnectionHandler(xpc_connection_t peer) {
    PVAcceptPeer(peer);
}

int main(void) {
    @autoreleasepool {
        OSStatus status = SecRequirementCreateWithString(
            (__bridge CFStringRef)@PV_CLIENT_REQUIREMENT,
            kSecCSDefaultFlags, &gClientRequirement);
        if (status != errSecSuccess || gClientRequirement == NULL) {
            return EXIT_FAILURE;
        }

        xpc_main(PVConnectionHandler);
    }
    return EXIT_FAILURE;
}
