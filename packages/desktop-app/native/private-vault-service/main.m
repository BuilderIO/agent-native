#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <xpc/xpc.h>

#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "PrivateVaultServiceIdentity.h"
#include "Protocol.h"
#include "PrivateVaultCrypto.h"
#import "PrivateVaultCustodyRepository.h"
#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultKeychain.h"
#import "PrivateVaultRotationCoordinator.h"
#import "PrivateVaultRotationPreparationSpool.h"
#import "PrivateVaultRotationPreparationStore.h"

static SecRequirementRef gClientRequirement = NULL;
static AncPrivateVaultCustodyRepository *gCustodyRepository = nil;
static AncPrivateVaultRotationCoordinator *gRotationCoordinator = nil;

static NSURL *PVStateRootURL(void) {
    NSArray<NSString *> *roots =
        NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory,
                                            NSUserDomainMask, YES);
    if (roots.firstObject.length == 0) {
        return nil;
    }
    NSString *path = [[roots.firstObject
        stringByAppendingPathComponent:@"AgentNative"]
        stringByAppendingPathComponent:@"PrivateVault"];
    NSError *error = nil;
    if (![[NSFileManager defaultManager]
            createDirectoryAtPath:path
      withIntermediateDirectories:YES
                       attributes:@{NSFilePosixPermissions : @0700}
                            error:&error] ||
        error != nil || chmod(path.fileSystemRepresentation, 0700) != 0) {
        return nil;
    }
    struct stat state;
    if (lstat(path.fileSystemRepresentation, &state) != 0 ||
        !S_ISDIR(state.st_mode) || S_ISLNK(state.st_mode) ||
        state.st_uid != getuid() || (state.st_mode & 0777) != 0700) {
        return nil;
    }
    return [NSURL fileURLWithPath:path isDirectory:YES];
}

static bool PVDecodeVaultID(const char *hex, uint8_t output[16]) {
    if (hex == NULL || output == NULL || strlen(hex) != 32) {
        return false;
    }
    for (size_t index = 0; index < 16; index += 1) {
        uint8_t value = 0;
        for (size_t nibble = 0; nibble < 2; nibble += 1) {
            char byte = hex[index * 2 + nibble];
            uint8_t digit = byte >= '0' && byte <= '9'
                                ? (uint8_t)(byte - '0')
                                : byte >= 'a' && byte <= 'f'
                                      ? (uint8_t)(byte - 'a' + 10)
                                      : UINT8_MAX;
            if (digit == UINT8_MAX) {
                memset(output, 0, 16);
                return false;
            }
            value = (uint8_t)((value << 4) | digit);
        }
        output[index] = value;
    }
    return true;
}

static NSString *PVHex(NSData *data) {
    if (data.length != 32) {
        return nil;
    }
    NSMutableString *value = [NSMutableString stringWithCapacity:64];
    const uint8_t *bytes = data.bytes;
    for (NSUInteger index = 0; index < data.length; index += 1) {
        [value appendFormat:@"%02x", bytes[index]];
    }
    return value;
}

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
        bool available = gRotationCoordinator != nil;
        xpc_dictionary_set_string(reply, "state",
                                  available ? "locked" : "unavailable");
        xpc_dictionary_set_bool(reply, "available", available);
    } else {
        xpc_dictionary_set_string(reply, "state", "locked");
    }

    xpc_connection_send_message(peer, reply);
}

static void PVResumeRotation(xpc_connection_t peer, xpc_object_t message,
                             const PVRequest *request) {
    uint8_t vaultID[16] = {0};
    if (gRotationCoordinator == nil ||
        !PVDecodeVaultID(request->vaultID, vaultID)) {
        PVSendError(peer, message, "rotation_unavailable");
        return;
    }
    AncPrivateVaultRotationCoordinatorResult *result = nil;
    AncPrivateVaultRotationCoordinatorStatus status =
        [gRotationCoordinator resumeVaultId:vaultID result:&result];
    memset(vaultID, 0, sizeof vaultID);
    NSString *headHash = result == nil ? nil : PVHex(result.headHash);
    if (status != AncPrivateVaultRotationCoordinatorStatusOK || result == nil ||
        headHash.length != 64 ||
        ![result.vaultId
            isEqualToString:[NSString stringWithUTF8String:request->vaultID]]) {
        PVSendError(peer, message, "rotation_failed");
        return;
    }
    xpc_object_t reply = xpc_dictionary_create_reply(message);
    if (reply == NULL) {
        return;
    }
    xpc_dictionary_set_int64(reply, "version", PV_PROTOCOL_VERSION);
    xpc_dictionary_set_bool(reply, "ok", true);
    xpc_dictionary_set_string(reply, "requestId", request->requestID);
    xpc_dictionary_set_string(reply, "state", "consumed");
    xpc_dictionary_set_string(reply, "vaultId", request->vaultID);
    xpc_dictionary_set_uint64(reply, "custodyGeneration",
                              result.custodyGeneration);
    xpc_dictionary_set_uint64(reply, "activeEpoch", result.activeEpoch);
    xpc_dictionary_set_uint64(reply, "sequence", result.sequence);
    xpc_dictionary_set_string(reply, "headHash", headHash.UTF8String);
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
            if (strcmp(request.operation, "resume_rotation") == 0) {
                PVResumeRotation(peer, message, &request);
                return;
            }
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
        if (anc_pv_crypto_init() != ANC_PV_CRYPTO_OK) {
            return EXIT_FAILURE;
        }
        NSURL *stateRoot = PVStateRootURL();
        AncPrivateVaultKeychain *keychain =
            [[AncPrivateVaultKeychain alloc] init];
        gCustodyRepository = [[AncPrivateVaultCustodyRepository alloc]
            initWithKeychain:keychain];
        AncPrivateVaultRotationPreparationSpoolStore *spool =
            [[AncPrivateVaultRotationPreparationSpoolStore alloc]
                initWithStateRootURL:stateRoot];
        AncPrivateVaultRotationPreparationStore *preparation =
            [[AncPrivateVaultRotationPreparationStore alloc]
                initWithKeychain:keychain
                           spool:spool];
        AncPrivateVaultAuthorityStore *authority =
            [[AncPrivateVaultAuthorityStore alloc]
                initWithStateRootURL:stateRoot
                   custodyRepository:gCustodyRepository];
        AncPrivateVaultControlLog *controlLog =
            [[AncPrivateVaultControlLog alloc] init];
        gRotationCoordinator = [[AncPrivateVaultRotationCoordinator alloc]
            initWithPreparationStore:preparation
                      authorityStore:authority
                   custodyRepository:gCustodyRepository
                          controlLog:controlLog];
        if (stateRoot == nil || keychain == nil || gCustodyRepository == nil ||
            spool == nil || preparation == nil || authority == nil ||
            controlLog == nil || gRotationCoordinator == nil) {
            return EXIT_FAILURE;
        }
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
