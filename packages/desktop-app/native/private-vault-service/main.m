#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <xpc/xpc.h>

#include <stdlib.h>
#include <string.h>
#include "PrivateVaultServiceIdentity.h"
#include "Protocol.h"
#include "PrivateVaultCrypto.h"
#import "PrivateVaultCustodyRepository.h"
#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultGenesisBootstrap.h"
#import "PrivateVaultKeychain.h"
#import "PrivateVaultGenesisArtifactStore.h"
#import "PrivateVaultGenesisCoordinator.h"
#import "PrivateVaultGenesisCoordinatorInternal.h"
#import "PrivateVaultGenesisPreparationArtifactStore.h"
#import "PrivateVaultGenesisPreparationStore.h"
#import "PrivateVaultGenerationFence.h"
#import "PrivateVaultGenesisStartup.h"
#import "PrivateVaultRotationCoordinator.h"
#import "PrivateVaultRotationPreparationSpool.h"
#import "PrivateVaultRotationPreparationStore.h"
#import "PrivateVaultStateRoot.h"
#import "PrivateVaultHostedAppendCandidateIndex.h"
#import "PrivateVaultHostedAppendRetryCoordinator.h"
#import "PrivateVaultHostedAppendRetryStore.h"
#import "PrivateVaultHostedAppendTransport.h"
#import "PrivateVaultTrustedTimeStore.h"

static SecRequirementRef gClientRequirement = NULL;
static AncPrivateVaultCustodyRepository *gCustodyRepository = nil;
static AncPrivateVaultGenesisCoordinator *gGenesisCoordinator = nil;
static AncPrivateVaultRotationCoordinator *gRotationCoordinator = nil;
static AncPrivateVaultHostedAppendTransport *gHostedAppendTransport = nil;
static AncPrivateVaultHostedAppendCandidateIndex *gHostedAppendCandidates = nil;
static AncPrivateVaultHostedAppendRetryCoordinator *gHostedAppendRetry = nil;
static bool gStartupComplete = false;

static const char *PVRotationAckState(void);

static NSURL *PVStateRootURL(void) {
    NSArray<NSString *> *roots =
        NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory,
                                            NSUserDomainMask, YES);
    if (roots.firstObject.length == 0) {
        return nil;
    }
    return AncPrivateVaultPrepareStateRoot(
        [NSURL fileURLWithPath:roots.firstObject isDirectory:YES]);
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

static NSString *PVVaultIDHex(NSData *data) {
    if (data.length != 16) {
        return nil;
    }
    NSMutableString *value = [NSMutableString stringWithCapacity:32];
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
        if (gHostedAppendRetry != nil) {
            [gHostedAppendRetry wake];
        }
        bool available = gGenesisCoordinator != nil &&
                         gRotationCoordinator != nil &&
                         gHostedAppendRetry != nil;
        xpc_dictionary_set_string(reply, "state",
                                  available ? "locked" : "unavailable");
        xpc_dictionary_set_bool(reply, "available", available);
        xpc_dictionary_set_string(reply, "rotationAckState",
                                  PVRotationAckState());
    } else {
        xpc_dictionary_set_string(reply, "state", "locked");
    }

    xpc_connection_send_message(peer, reply);
}

static void PVCommitGenesis(xpc_connection_t peer, xpc_object_t message,
                            const PVRequest *request) {
    @autoreleasepool {
        if (gGenesisCoordinator == nil ||
            request->recoveryConfirmation == NULL ||
            request->bootstrapTranscript == NULL ||
            request->authorization == NULL) {
            PVSendError(peer, message, "genesis_unavailable");
            return;
        }
        NSData *recoveryConfirmation =
            [NSData dataWithBytes:request->recoveryConfirmation
                           length:request->recoveryConfirmationLength];
        NSData *bootstrapTranscript =
            [NSData dataWithBytes:request->bootstrapTranscript
                           length:request->bootstrapTranscriptLength];
        NSData *authorization =
            [NSData dataWithBytes:request->authorization
                           length:request->authorizationLength];
        AncPrivateVaultGenesisBootstrapStatus decodeStatus =
            AncPrivateVaultGenesisBootstrapStatusInvalidCanonical;
        AncPrivateVaultGenesisBootstrapTranscript *decoded =
            AncPrivateVaultGenesisBootstrapDecode(bootstrapTranscript, nil,
                                                   &decodeStatus);
        if (decoded == nil || decoded.vaultId.length != 16) {
            PVSendError(peer, message, "genesis_failed");
            return;
        }
        uint8_t vaultID[16] = {0};
        [decoded.vaultId getBytes:vaultID length:sizeof vaultID];
        NSString *expectedVaultID = PVVaultIDHex(decoded.vaultId);
        AncPrivateVaultGenesisCoordinatorResult *result = nil;
        AncPrivateVaultGenesisCoordinatorStatus status =
            [gGenesisCoordinator
                     commitVaultId:vaultID
                bootstrapTranscript:bootstrapTranscript
                recoveryConfirmation:recoveryConfirmation
                      authorization:authorization
                             result:&result];
        memset(vaultID, 0, sizeof vaultID);
        if (status != AncPrivateVaultGenesisCoordinatorStatusOK ||
            result == nil) {
            PVSendError(peer, message, "genesis_failed");
            return;
        }
        NSString *headHash = PVHex(result.headHash);
        NSString *membershipHash = PVHex(result.membershipHash);
        NSString *recoveryWrapHash = PVHex(result.recoveryWrapHash);
        if (expectedVaultID.length != 32 ||
            ![result.vaultId isEqualToString:expectedVaultID] ||
            headHash.length != 64 ||
            membershipHash.length != 64 || recoveryWrapHash.length != 64 ||
            result.custodyGeneration != 2 || result.activeEpoch != 1 ||
            result.sequence != 0 || result.recoveryGeneration != 1) {
            PVSendError(peer, message, "genesis_failed");
            return;
        }
        xpc_object_t reply = xpc_dictionary_create_reply(message);
        if (reply == NULL) {
            return;
        }
        xpc_dictionary_set_int64(reply, "version", PV_PROTOCOL_VERSION);
        xpc_dictionary_set_bool(reply, "ok", true);
        xpc_dictionary_set_string(reply, "requestId", request->requestID);
        xpc_dictionary_set_string(reply, "state", "committed");
        xpc_dictionary_set_string(reply, "vaultId", result.vaultId.UTF8String);
        xpc_dictionary_set_uint64(reply, "custodyGeneration",
                                  result.custodyGeneration);
        xpc_dictionary_set_uint64(reply, "activeEpoch", result.activeEpoch);
        xpc_dictionary_set_uint64(reply, "sequence", result.sequence);
        xpc_dictionary_set_string(reply, "headHash", headHash.UTF8String);
        xpc_dictionary_set_string(reply, "membershipHash",
                                  membershipHash.UTF8String);
        xpc_dictionary_set_uint64(reply, "recoveryGeneration",
                                  result.recoveryGeneration);
        xpc_dictionary_set_string(reply, "recoveryWrapHash",
                                  recoveryWrapHash.UTF8String);
        xpc_connection_send_message(peer, reply);
    }
}

static const char *PVRotationAckState(void) {
    if (gHostedAppendRetry == nil) {
        return "unavailable";
    }
    AncPrivateVaultHostedAppendRetrySnapshot *snapshot =
        [gHostedAppendRetry snapshot];
    if (snapshot.blockedCount > 0 ||
        snapshot.lastFailureCategory ==
            AncPrivateVaultHostedAppendRetryFailureIntegrityBlocked ||
        snapshot.lastFailureCategory ==
            AncPrivateVaultHostedAppendRetryFailureInvalidBlocked ||
        snapshot.lastFailureCategory ==
            AncPrivateVaultHostedAppendRetryFailureProtectionBlocked) {
        return "attention";
    }
    if (snapshot.inFlightCount > 0 || snapshot.scheduledCount > 0) {
        return "retrying";
    }
    if (snapshot.pendingCount > 0) {
        return "pending";
    }
    return "idle";
}

static void PVResumeRotation(xpc_connection_t peer, xpc_object_t message,
                             const PVRequest *request) {
    uint8_t vaultID[16] = {0};
    if (gRotationCoordinator == nil ||
        !PVDecodeVaultID(request->vaultID, vaultID)) {
        PVSendError(peer, message, "rotation_unavailable");
        return;
    }
    NSData *vaultBytes = [NSData dataWithBytes:vaultID length:sizeof vaultID];
    if (gHostedAppendCandidates == nil || gHostedAppendRetry == nil) {
        memset(vaultID, 0, sizeof vaultID);
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
    if ([gHostedAppendCandidates markPendingVaultId:vaultBytes] !=
        AncPrivateVaultHostedAppendCandidateStatusOK) {
        PVSendError(peer, message, "rotation_unavailable");
        return;
    }
    xpc_object_t reply = xpc_dictionary_create_reply(message);
    if (reply == NULL) {
        [gHostedAppendRetry admitResumedVaultId:vaultBytes];
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
    [gHostedAppendRetry admitResumedVaultId:vaultBytes];
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
            if (!PVRequestCanRun(&request, gStartupComplete)) {
                PVSendError(peer, message, "startup_incomplete");
                return;
            }
            if (strcmp(request.operation, "commit_genesis") == 0) {
                PVCommitGenesis(peer, message, &request);
                return;
            }
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
        AncPrivateVaultGenesisArtifactStore *genesisArtifacts =
            [[AncPrivateVaultGenesisArtifactStore alloc]
                initWithStateRootURL:stateRoot];
        AncPrivateVaultGenesisPreparationArtifactStore
            *genesisPreparationArtifacts =
                [[AncPrivateVaultGenesisPreparationArtifactStore alloc]
                    initWithStateRootURL:stateRoot];
        AncPrivateVaultGenesisPreparationStore *genesisPreparationStore =
            [[AncPrivateVaultGenesisPreparationStore alloc]
                initWithKeychain:keychain
                           fence:[[AncPrivateVaultGenerationFence alloc]
                                     initWithKeychain:keychain]
                   artifactStore:genesisPreparationArtifacts];
        AncPrivateVaultTrustedTimeStore *trustedTimeStore =
            [[AncPrivateVaultTrustedTimeStore alloc]
                initWithKeychain:keychain];
        AncPrivateVaultGenesisPersistedTrustedClock *genesisTrustedClock =
            [[AncPrivateVaultGenesisPersistedTrustedClock alloc]
                initWithStore:trustedTimeStore
                  systemClock:
                      [AncPrivateVaultGenesisSystemTrustedClock new]];
        gGenesisCoordinator = [[AncPrivateVaultGenesisCoordinator alloc]
            initWithArtifactStore:genesisArtifacts
                  authorityStore:authority
               custodyRepository:gCustodyRepository
                      controlLog:controlLog
                preparationStore:genesisPreparationStore
           preparationArtifactStore:genesisPreparationArtifacts
                    trustedClock:genesisTrustedClock];
        gRotationCoordinator = [[AncPrivateVaultRotationCoordinator alloc]
            initWithPreparationStore:preparation
                      authorityStore:authority
                   custodyRepository:gCustodyRepository
                          controlLog:controlLog];
        gHostedAppendTransport =
            [[AncPrivateVaultHostedAppendTransport alloc] init];
        AncPrivateVaultHostedAppendRetryStore *retryStore =
            [[AncPrivateVaultHostedAppendRetryStore alloc]
                initWithStateRootURL:stateRoot];
        gHostedAppendCandidates =
            [[AncPrivateVaultHostedAppendCandidateIndex alloc]
                initWithSpool:spool
                   retryStore:retryStore];
        dispatch_queue_t retryQueue = dispatch_queue_create(
            "com.agentnative.private-vault.hosted-append-retry",
            DISPATCH_QUEUE_SERIAL);
        AncPrivateVaultHostedAppendDispatchScheduler *retryScheduler =
            [[AncPrivateVaultHostedAppendDispatchScheduler alloc]
                initWithQueue:retryQueue];
        gHostedAppendRetry =
            [[AncPrivateVaultHostedAppendRetryCoordinator alloc]
                initWithCandidateSource:gHostedAppendCandidates
                       rotationOperator:
                           (id<AncPrivateVaultHostedAppendRotationOperator>)
                               gRotationCoordinator
                              transport:
                                  (id<AncPrivateVaultHostedAppendTransporting>)
                                      gHostedAppendTransport
                              scheduler:retryScheduler];
        if (stateRoot == nil || keychain == nil || gCustodyRepository == nil ||
            spool == nil || preparation == nil || authority == nil ||
            controlLog == nil || genesisArtifacts == nil ||
            genesisPreparationArtifacts == nil ||
            genesisPreparationStore == nil ||
            trustedTimeStore == nil || genesisTrustedClock == nil ||
            gGenesisCoordinator == nil || gRotationCoordinator == nil ||
            gHostedAppendTransport == nil || retryStore == nil ||
            gHostedAppendCandidates == nil || retryScheduler == nil ||
            gHostedAppendRetry == nil) {
            return EXIT_FAILURE;
        }
        OSStatus status = SecRequirementCreateWithString(
            (__bridge CFStringRef)@PV_CLIENT_REQUIREMENT,
            kSecCSDefaultFlags, &gClientRequirement);
        if (status != errSecSuccess || gClientRequirement == NULL) {
            return EXIT_FAILURE;
        }

        if (AncPrivateVaultResumePendingGenesisState(
                genesisArtifacts, genesisPreparationStore,
                gGenesisCoordinator) !=
            AncPrivateVaultGenesisStartupStatusOK) {
            return EXIT_FAILURE;
        }

        [gHostedAppendRetry start];
        gStartupComplete = true;

        xpc_main(PVConnectionHandler);
    }
    return EXIT_FAILURE;
}
