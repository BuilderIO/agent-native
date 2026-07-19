#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <xpc/xpc.h>

#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "PrivateVaultServiceIdentity.h"
#include "Protocol.h"
#include "PrivateVaultCrypto.h"
#import "PrivateVaultCustodyRepository.h"
#import "PrivateVaultSession.h"
#import "PrivateVaultAuthorityStore.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultControlLogInternal.h"
#import "PrivateVaultEnrollmentChallenge.h"
#import "PrivateVaultEnrollmentAuthorizer.h"
#import "PrivateVaultEnrollmentAuthorization.h"
#import "PrivateVaultGenesisBootstrap.h"
#import "PrivateVaultGenesisAccountAdmission.h"
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
#import "PrivateVaultResultSpool.h"
#import "PrivateVaultRotationPreparationStore.h"
#import "PrivateVaultStateRoot.h"
#import "PrivateVaultHostedAppendCandidateIndex.h"
#import "PrivateVaultHostedAppendRetryCoordinator.h"
#import "PrivateVaultHostedAppendRetryStore.h"
#import "PrivateVaultHostedAppendTransport.h"
#import "PrivateVaultBootstrapFrame.h"
#import "PrivateVaultBootstrapReplay.h"
#import "PrivateVaultTrustedTimeStore.h"
#import "PrivateVaultMnemonic.h"
#import "PrivateVaultRecoveryCoordinator.h"
#import "PrivateVaultRecoveryPreparationStore.h"
#import "PrivateVaultGrantIndex.h"
#import "PrivateVaultJobProcessor.h"
#import "PrivateVaultEnrollmentOfferArtifactStore.h"
#import "PrivateVaultEnrollmentSasReceiptStore.h"
#import "PrivateVaultEnrollmentCoordinator.h"
#import "PrivateVaultObjectRevision.h"

static SecRequirementRef gClientRequirement = NULL;
static AncPrivateVaultCustodyRepository *gCustodyRepository = nil;
static AncPrivateVaultCustodyRepository *gBrokerCustodyRepository = nil;
static AncPrivateVaultSession *gSession = nil;
static AncPrivateVaultGenesisCoordinator *gGenesisCoordinator = nil;
static AncPrivateVaultBootstrapReplay *gBootstrapReplay = nil;
static NSLock *gBootstrapReplayLock = nil;
static AncPrivateVaultRotationCoordinator *gRotationCoordinator = nil;
static AncPrivateVaultHostedAppendTransport *gHostedAppendTransport = nil;
static AncPrivateVaultHostedAppendCandidateIndex *gHostedAppendCandidates = nil;
static AncPrivateVaultHostedAppendRetryCoordinator *gHostedAppendRetry = nil;
static AncPrivateVaultRecoveryCoordinator *gRecoveryCoordinator = nil;
static NSMutableDictionary<NSString *, NSString *> *gRecoveryStatuses = nil;
static NSLock *gRecoveryStatusLock = nil;
static bool gStartupComplete = false;
static AncPrivateVaultGrantIndex *gGrantIndex = nil;
static AncPrivateVaultJobProcessor *gJobProcessor = nil;
static AncPrivateVaultAuthorityStore *gEndpointAuthorityStore = nil;
static AncPrivateVaultControlLog *gControlLog = nil;
static AncPrivateVaultEnrollmentOfferArtifactStore *gEnrollmentArtifactStore =
    nil;
static AncPrivateVaultEnrollmentSasReceiptStore *gEnrollmentReceiptStore = nil;
static AncPrivateVaultEnrollmentCoordinator *gEnrollmentCoordinator = nil;
static id<AncPrivateVaultGenesisTrustedClock> gTrustedClock = nil;
static NSMutableDictionary<NSString *, id> *gEnrollmentInspections = nil;
static NSLock *gEnrollmentInspectionLock = nil;

@interface PVEnrollmentInspection : NSObject
@property(nonatomic) NSString *vaultId;
@property(nonatomic) AncPrivateVaultEnrollmentChallengeResult *challenge;
@property(nonatomic) uint64_t expiresAt;
@end
@implementation PVEnrollmentInspection
@end

static const char *PVRotationAckState(void);

static void PVSetRecoveryStatus(NSString *vaultID, NSString *state) {
    if (vaultID.length != 32 || state.length == 0) return;
    [gRecoveryStatusLock lock];
    gRecoveryStatuses[vaultID] = state;
    [gRecoveryStatusLock unlock];
}

static NSString *PVRecoveryStatus(NSString *vaultID) {
    [gRecoveryStatusLock lock];
    NSString *state = [gRecoveryStatuses[vaultID] copy];
    [gRecoveryStatusLock unlock];
    return state;
}

static void PVRecoveryFinished(AncPrivateVaultRecoveryCoordinatorStatus status,
                               NSString *vaultID) {
    NSString *state =
        status == AncPrivateVaultRecoveryCoordinatorStatusOK
            ? @"recovered"
        : status == AncPrivateVaultRecoveryCoordinatorStatusNetworkFailed ||
                status == AncPrivateVaultRecoveryCoordinatorStatusStorageFailed
            ? @"retryable"
            : @"failed";
    PVSetRecoveryStatus(vaultID, state);
}

static void PVResumeRecovery(NSString *vaultID) {
    if (gRecoveryCoordinator == nil || vaultID.length != 32) return;
    PVSetRecoveryStatus(vaultID, @"committing");
    [gRecoveryCoordinator
        resumeVaultId:vaultID
           completion:^(AncPrivateVaultRecoveryCoordinatorStatus status,
                        NSString *completedVaultID) {
             PVRecoveryFinished(status, completedVaultID);
           }];
}

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

static xpc_object_t PVCreateReply(xpc_object_t message,
                                  const PVRequest *request) {
    xpc_object_t reply = xpc_dictionary_create_reply(message);
    if (reply != NULL) {
        xpc_dictionary_set_int64(reply, "version", PV_PROTOCOL_VERSION);
        xpc_dictionary_set_bool(reply, "ok", true);
        xpc_dictionary_set_string(reply, "requestId", request->requestID);
    }
    return reply;
}

static NSData *PVLookupIDData(const char *lookupID) {
    uint8_t bytes[16] = {0};
    if (!PVDecodeVaultID(lookupID, bytes)) {
        return nil;
    }
    NSData *result = [NSData dataWithBytes:bytes length:sizeof bytes];
    memset(bytes, 0, sizeof bytes);
    return result;
}

static NSData *PVHashData(const char *hex) {
    if (hex == NULL || strlen(hex) != 64) return nil;
    NSMutableData *data = [NSMutableData dataWithLength:32];
    for (size_t index = 0; index < 32; index += 1) {
        unsigned int byte = 0;
        NSString *pair = [[NSString alloc]
            initWithBytes:hex + index * 2 length:2
                 encoding:NSUTF8StringEncoding];
        NSScanner *scanner = [NSScanner scannerWithString:pair];
        if (![scanner scanHexInt:&byte] || !scanner.isAtEnd) return nil;
        ((uint8_t *)data.mutableBytes)[index] = (uint8_t)byte;
    }
    return data;
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
        bool available = gGenesisCoordinator != nil && gSession != nil &&
                         gRotationCoordinator != nil &&
                         gHostedAppendRetry != nil && gGrantIndex != nil &&
                         gJobProcessor != nil;
        const char *state = !available
                                ? "unavailable"
                            : gSession.isUnlocked ? "unlocked"
                                                  : "locked";
        xpc_dictionary_set_string(reply, "state", state);
        xpc_dictionary_set_bool(reply, "available", available);
        xpc_dictionary_set_string(reply, "rotationAckState",
                                  PVRotationAckState());
    } else {
        xpc_dictionary_set_string(reply, "state", "locked");
    }

    xpc_connection_send_message(peer, reply);
}

static void PVUnlock(xpc_connection_t peer, xpc_object_t message,
                     const PVRequest *request) {
    if (gSession == nil || request->vaultID == NULL) {
        PVSendError(peer, message, "unlock_failed");
        return;
    }
    NSString *vaultID = [NSString stringWithUTF8String:request->vaultID];
    if (vaultID.length != 32 ||
        [gSession unlockVaultId:vaultID] != AncPrivateVaultSessionStatusOK) {
        PVSendError(peer, message, "unlock_failed");
        return;
    }
    xpc_object_t reply = PVCreateReply(message, request);
    if (reply == NULL) return;
    xpc_dictionary_set_string(reply, "state", "unlocked");
    xpc_connection_send_message(peer, reply);
}

static void PVLock(xpc_connection_t peer, xpc_object_t message,
                   const PVRequest *request) {
    if (gSession == nil ||
        [gSession lock] != AncPrivateVaultSessionStatusOK) {
        PVSendError(peer, message, "lock_failed");
        return;
    }
    xpc_object_t reply = PVCreateReply(message, request);
    if (reply == NULL) return;
    xpc_dictionary_set_string(reply, "state", "locked");
    xpc_connection_send_message(peer, reply);
}

static void PVOpenJob(xpc_connection_t peer, xpc_object_t message,
                      const PVRequest *request) {
    @autoreleasepool {
        if (gJobProcessor == nil || request->vaultID == NULL ||
            request->jobID == NULL || request->jobEnvelope == NULL) {
            PVSendError(peer, message, "job_denied");
            return;
        }
        NSString *vaultID = [NSString stringWithUTF8String:request->vaultID];
        NSData *jobID = PVLookupIDData(request->jobID);
        NSData *envelope = [NSData dataWithBytes:request->jobEnvelope
                                          length:request->jobEnvelopeLength];
        AncPrivateVaultAuthorizedJob *opened = nil;
        uint64_t now = (uint64_t)floor(NSDate.date.timeIntervalSince1970);
        AncPrivateVaultJobProcessorStatus status =
            [gJobProcessor openJobEnvelope:envelope vaultId:vaultID
                                     jobId:jobID
                                hostedEpoch:request->hostedEpoch
                           hostedRetryCount:request->hostedRetryCount
                           hostedAlgorithmId:
                               [NSString stringWithUTF8String:
                                   request->algorithmID]
                                nowSeconds:now result:&opened];
        NSString *jobHash = PVHex(opened.jobHash);
        if (status != AncPrivateVaultJobProcessorStatusOK || opened == nil ||
            jobHash.length != 64 || opened.body.length > 16 * 1024 * 1024) {
            PVSendError(peer, message,
                        status == AncPrivateVaultJobProcessorStatusReplay
                            ? "job_replay" : "job_denied");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL) return;
        xpc_dictionary_set_string(reply, "jobHash", jobHash.UTF8String);
        xpc_dictionary_set_data(reply, "jobPayload", opened.body.bytes,
                                opened.body.length);
        xpc_dictionary_set_data(reply, "resourceId", opened.resourceId.bytes,
                                opened.resourceId.length);
        xpc_dictionary_set_string(reply, "operationName",
                                  opened.operation.UTF8String);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVSealResult(xpc_connection_t peer, xpc_object_t message,
                         const PVRequest *request) {
    @autoreleasepool {
        NSString *vaultID = request->vaultID == NULL ? nil :
            [NSString stringWithUTF8String:request->vaultID];
        NSData *jobID = PVLookupIDData(request->jobID);
        NSData *jobHash = PVHashData(request->jobHash);
        NSString *state = request->resultState == NULL ? nil :
            [NSString stringWithUTF8String:request->resultState];
        NSData *payload = [NSData dataWithBytes:request->resultPayload
                                         length:request->resultPayloadLength];
        NSData *sealed = nil;
        AncPrivateVaultJobProcessorStatus status = [gJobProcessor
            sealResultPayload:payload state:state vaultId:vaultID jobId:jobID
                       jobHash:jobHash
                    nowSeconds:(uint64_t)floor(NSDate.date.timeIntervalSince1970)
                        result:&sealed];
        if (status != AncPrivateVaultJobProcessorStatusOK || sealed.length == 0) {
            PVSendError(peer, message, "result_denied");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL) return;
        xpc_dictionary_set_data(reply, "resultEnvelope", sealed.bytes,
                                sealed.length);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVCompleteResult(xpc_connection_t peer, xpc_object_t message,
                             const PVRequest *request) {
    @autoreleasepool {
        NSString *vaultID = request->vaultID == NULL ? nil :
            [NSString stringWithUTF8String:request->vaultID];
        NSData *jobID = PVLookupIDData(request->jobID);
        NSData *jobHash = PVHashData(request->jobHash);
        NSString *state = request->resultState == NULL ? nil :
            [NSString stringWithUTF8String:request->resultState];
        AncPrivateVaultJobProcessorStatus status = [gJobProcessor
            acknowledgeHostedResultForVaultId:vaultID jobId:jobID
                                       jobHash:jobHash state:state];
        if (status != AncPrivateVaultJobProcessorStatusOK) {
            PVSendError(peer, message, "result_receipt_denied");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL) return;
        xpc_dictionary_set_string(reply, "state", "delivered");
        xpc_connection_send_message(peer, reply);
    }
}

static void PVPendingResult(xpc_connection_t peer, xpc_object_t message,
                            const PVRequest *request) {
    @autoreleasepool {
        NSString *vaultID = request->vaultID == NULL ? nil :
            [NSString stringWithUTF8String:request->vaultID];
        AncPrivateVaultPendingResult *pending = nil;
        AncPrivateVaultJobProcessorStatus status = [gJobProcessor
            recoverPendingHostedResultForVaultId:vaultID result:&pending];
        if (status != AncPrivateVaultJobProcessorStatusOK) {
            PVSendError(peer, message, "pending_result_denied");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL) return;
        if (pending == nil) {
            xpc_dictionary_set_string(reply, "state", "idle");
        } else {
            NSString *jobID = PVHex(pending.jobId);
            NSString *jobHash = PVHex(pending.jobHash);
            if (jobID.length != 32 || jobHash.length != 64 ||
                pending.resultEnvelope.length == 0) {
                PVSendError(peer, message, "pending_result_denied");
                return;
            }
            xpc_dictionary_set_string(reply, "state", "pending");
            xpc_dictionary_set_string(reply, "jobId", jobID.UTF8String);
            xpc_dictionary_set_string(reply, "jobHash", jobHash.UTF8String);
            xpc_dictionary_set_string(reply, "resultState",
                                      pending.state.UTF8String);
            xpc_dictionary_set_uint64(reply, "epoch", pending.epoch);
            xpc_dictionary_set_uint64(reply, "retryCount", pending.retryCount);
            xpc_dictionary_set_string(reply, "algorithmId",
                                      pending.algorithmId.UTF8String);
            xpc_dictionary_set_data(reply, "resultEnvelope",
                                    pending.resultEnvelope.bytes,
                                    pending.resultEnvelope.length);
        }
        xpc_connection_send_message(peer, reply);
    }
}

static void PVSignEndpointRequest(xpc_connection_t peer, xpc_object_t message,
                                  const PVRequest *request) {
    @autoreleasepool {
        if (gJobProcessor == nil || request->unsignedProof == NULL ||
            request->unsignedProofLength == 0) {
            PVSendError(peer, message, "sign_request_denied");
            return;
        }
        NSData *proof = [NSData dataWithBytes:request->unsignedProof
                                       length:request->unsignedProofLength];
        NSData *signature = nil;
        AncPrivateVaultJobProcessorStatus status = [gJobProcessor
            signEndpointRequestProof:proof
                         nowSeconds:
                             (uint64_t)floor(NSDate.date.timeIntervalSince1970)
                             result:&signature];
        if (status != AncPrivateVaultJobProcessorStatusOK ||
            signature.length != 64) {
            PVSendError(peer, message, "sign_request_denied");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL) return;
        xpc_dictionary_set_data(reply, "signature", signature.bytes,
                                signature.length);
        xpc_connection_send_message(peer, reply);
    }
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

static void PVAcceptBootstrap(xpc_connection_t peer, xpc_object_t message,
                              const PVRequest *request) {
    @autoreleasepool {
        if (request->bootstrapFrame == NULL ||
            request->bootstrapFrameLength == 0) {
            PVSendError(peer, message, "bootstrap_invalid");
            return;
        }
        NSData *encoded =
            [NSData dataWithBytes:request->bootstrapFrame
                           length:request->bootstrapFrameLength];
        AncPrivateVaultBootstrapFrameStatus status =
            AncPrivateVaultBootstrapFrameStatusInvalid;
        AncPrivateVaultBootstrapFrame *frame =
            AncPrivateVaultBootstrapFrameDecode(encoded, &status);
        if (frame == nil || status != AncPrivateVaultBootstrapFrameStatusOK ||
            frame.throughSequence < 0) {
            PVSendError(peer, message, "bootstrap_invalid");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL) return;
        xpc_dictionary_set_string(reply, "state", "parsed");
        xpc_dictionary_set_string(reply, "vaultId", frame.vaultId.UTF8String);
        xpc_dictionary_set_uint64(reply, "throughSequence",
                                  (uint64_t)frame.throughSequence);
        xpc_dictionary_set_uint64(reply, "headSequence", frame.headSequence);
        xpc_dictionary_set_string(reply, "headHash", frame.headHash.UTF8String);
        xpc_dictionary_set_bool(reply, "complete", frame.complete);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVRecoverBootstrap(xpc_connection_t peer, xpc_object_t message,
                               const PVRequest *request, BOOL begin) {
    @autoreleasepool {
        NSData *encoded =
            request->bootstrapFrame == NULL
                ? nil
                : [NSData dataWithBytes:request->bootstrapFrame
                                 length:request->bootstrapFrameLength];
        AncPrivateVaultBootstrapFrameStatus frameStatus;
        AncPrivateVaultBootstrapFrame *frame =
            AncPrivateVaultBootstrapFrameDecode(encoded, &frameStatus);
        if (frame == nil || frameStatus != AncPrivateVaultBootstrapFrameStatusOK) {
            PVSendError(peer, message, "recovery_failed");
            return;
        }
        [gBootstrapReplayLock lock];
        BOOL accepted = NO;
        AncPrivateVaultBootstrapReplay *completedReplay = nil;
        AncPrivateVaultBootstrapReplayStatus replayStatus;
        @try {
            if (begin) {
                [gBootstrapReplay invalidate];
                gBootstrapReplay = nil;
                if (frame.afterSequence != -1 ||
                    request->recoveryMnemonic == NULL ||
                    request->recoveryMnemonicLength == 0) {
                    accepted = NO;
                } else {
                    NSData *mnemonic = [NSData
                        dataWithBytesNoCopy:(void *)request->recoveryMnemonic
                                    length:request->recoveryMnemonicLength
                              freeWhenDone:NO];
                    AncPrivateVaultMnemonicStatus mnemonicStatus;
                    AncPrivateVaultGuardedMemory *entropy =
                        AncPrivateVaultMnemonicDecode(mnemonic, &mnemonicStatus);
                    AncPrivateVaultBootstrapReplay *candidate =
                        entropy == nil
                            ? nil
                            : [[AncPrivateVaultBootstrapReplay alloc]
                                  initWithOwnedRecoveryEntropy:entropy
                                        trustedNowMilliseconds:
                                            (uint64_t)llround(
                                                NSDate.date.timeIntervalSince1970 *
                                                1000.0)
                                                        status:&replayStatus];
                    accepted = candidate != nil &&
                               [candidate consumeFrame:frame status:&replayStatus];
                    if (accepted) {
                        gBootstrapReplay = candidate;
                    } else {
                        [candidate invalidate];
                        if (candidate == nil)
                            [entropy close];
                    }
                }
            } else {
                accepted = gBootstrapReplay != nil &&
                           [gBootstrapReplay consumeFrame:frame
                                                   status:&replayStatus];
            }
            if (!accepted && gBootstrapReplay != nil) {
                [gBootstrapReplay invalidate];
                gBootstrapReplay = nil;
            } else if (accepted && frame.complete) {
                completedReplay = gBootstrapReplay;
                gBootstrapReplay = nil;
            }
        } @finally {
            [gBootstrapReplayLock unlock];
        }
        if (!accepted) {
            PVSendError(peer, message, "recovery_failed");
            return;
        }
        if (frame.complete) {
            if (completedReplay == nil || gRecoveryCoordinator == nil) {
                [completedReplay invalidate];
                PVSendError(peer, message, "recovery_failed");
                return;
            }
            PVSetRecoveryStatus(frame.vaultId, @"committing");
            [gRecoveryCoordinator
                beginWithReplay:completedReplay
                     completion:^(
                         AncPrivateVaultRecoveryCoordinatorStatus status,
                         NSString *completedVaultID) {
                       PVRecoveryFinished(status, completedVaultID);
                     }];
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL) return;
        xpc_dictionary_set_string(reply, "state",
                                  frame.complete ? "committing" : "accepted");
        xpc_dictionary_set_string(reply, "vaultId", frame.vaultId.UTF8String);
        xpc_dictionary_set_uint64(reply, "throughSequence",
                                  (uint64_t)frame.throughSequence);
        xpc_dictionary_set_uint64(reply, "headSequence", frame.headSequence);
        xpc_dictionary_set_string(reply, "headHash", frame.headHash.UTF8String);
        xpc_dictionary_set_bool(reply, "complete", frame.complete);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVRecoverStatus(xpc_connection_t peer, xpc_object_t message,
                            const PVRequest *request) {
    @autoreleasepool {
        NSString *vaultID = request->vaultID == NULL
                                ? nil
                                : [NSString stringWithUTF8String:
                                                request->vaultID];
        NSString *state = PVRecoveryStatus(vaultID);
        if ([state isEqualToString:@"retryable"]) {
            PVResumeRecovery(vaultID);
            state = @"committing";
        }
        if (state == nil) state = @"failed";
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL) return;
        xpc_dictionary_set_string(reply, "state", state.UTF8String);
        xpc_dictionary_set_string(reply, "vaultId", vaultID.UTF8String);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVPrepareGenesis(xpc_connection_t peer, xpc_object_t message,
                             const PVRequest *request) {
    @autoreleasepool {
        AncPrivateVaultGenesisPreparationResult *prepared = nil;
        if (gGenesisCoordinator == nil ||
            [gGenesisCoordinator prepareWithResult:&prepared] !=
                AncPrivateVaultGenesisCoordinatorStatusOK ||
            prepared == nil) {
            PVSendError(peer, message, "genesis_failed");
            return;
        }
        __block NSData *lookupID = nil;
        __block xpc_object_t reply = PVCreateReply(message, request);
        __block bool copied = reply != NULL;
        if (copied) {
            copied = [prepared.preparationHandle
                         borrow:^BOOL(uint8_t *bytes, size_t length) {
                if (length != ANC_PV_GENESIS_PREPARATION_HANDLE_BYTES)
                    return NO;
                lookupID = [NSData dataWithBytes:bytes length:16];
                return lookupID.length == 16;
            }] == AncPrivateVaultGuardedMemoryStatusOK;
        }
        NSString *lookupHex = copied ? PVVaultIDHex(lookupID) : nil;
        if (copied && lookupHex.length == 32) {
            copied = [prepared.recoveryMnemonic
                         borrow:^BOOL(uint8_t *bytes, size_t length) {
                if (length == 0 ||
                    length > ANC_PV_MNEMONIC_MAX_CANONICAL_UTF8_BYTES)
                    return NO;
                xpc_dictionary_set_data(reply, "recoveryMnemonic", bytes,
                                        length);
                return true;
            }] == AncPrivateVaultGuardedMemoryStatusOK;
        } else {
            copied = false;
        }
        if (copied) {
            xpc_dictionary_set_string(reply, "state", "prepared");
            xpc_dictionary_set_string(reply, "lookupId", lookupHex.UTF8String);
            xpc_dictionary_set_string(reply, "vaultId",
                                      prepared.vaultId.UTF8String);
            xpc_dictionary_set_uint64(reply, "expiresAtMs",
                                      prepared.expiresAtMs);
        }
        BOOL closed = [prepared.preparationHandle close] ==
                          AncPrivateVaultGuardedMemoryStatusOK &&
                      [prepared.recoveryMnemonic close] ==
                          AncPrivateVaultGuardedMemoryStatusOK;
        if (!copied || !closed) {
            PVSendError(peer, message, "genesis_failed");
            return;
        }
        xpc_connection_send_message(peer, reply);
    }
}

static AncPrivateVaultGenesisAdmissionCandidateResult *
PVAdmissionCandidate(NSData *lookupID) {
    NSArray<AncPrivateVaultGenesisAdmissionCandidateResult *> *candidates = nil;
    if ([gGenesisCoordinator
            listPendingGenesisAdmissionCandidates:&candidates] !=
        AncPrivateVaultGenesisCoordinatorStatusOK)
        return nil;
    for (AncPrivateVaultGenesisAdmissionCandidateResult *candidate in
         candidates) {
        if ([candidate.lookupId isEqualToData:lookupID])
            return candidate;
    }
    return nil;
}

static void PVConfirmGenesis(xpc_connection_t peer, xpc_object_t message,
                             const PVRequest *request) {
    @autoreleasepool {
        NSData *lookupID = PVLookupIDData(request->lookupID);
        NSData *mnemonic = request->recoveryMnemonic == NULL
                               ? nil
                               : [NSData dataWithBytesNoCopy:
                                             (void *)request->recoveryMnemonic
                                                        length:request
                                                                   ->recoveryMnemonicLength
                                                  freeWhenDone:NO];
        AncPrivateVaultMnemonicStatus mnemonicStatus;
        AncPrivateVaultGuardedMemory *entropy =
            mnemonic == nil ? nil
                            : AncPrivateVaultMnemonicDecode(mnemonic,
                                                            &mnemonicStatus);
        AncPrivateVaultGenesisCoordinatorResult *confirmed = nil;
        AncPrivateVaultGenesisCoordinatorStatus status =
            entropy == nil || lookupID == nil
                ? AncPrivateVaultGenesisCoordinatorStatusInvalid
                : [gGenesisCoordinator
                      confirmPreparationLookupId:lookupID
                          confirmedRecoveryEntropy:entropy
                                           result:&confirmed];
        BOOL closed = entropy == nil ||
                      [entropy close] == AncPrivateVaultGuardedMemoryStatusOK;
        AncPrivateVaultGenesisAdmissionCandidateResult *candidate =
            status == AncPrivateVaultGenesisCoordinatorStatusOK && closed
                ? PVAdmissionCandidate(lookupID)
                : nil;
        if (candidate == nil || confirmed == nil) {
            PVSendError(peer, message, "genesis_failed");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL)
            return;
        xpc_dictionary_set_string(reply, "state", "committed");
        xpc_dictionary_set_string(reply, "lookupId", request->lookupID);
        xpc_dictionary_set_string(reply, "vaultId", confirmed.vaultId.UTF8String);
        xpc_dictionary_set_data(reply, "candidate", candidate.candidate.bytes,
                                candidate.candidate.length);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVListGenesis(xpc_connection_t peer, xpc_object_t message,
                          const PVRequest *request) {
    @autoreleasepool {
        NSArray<AncPrivateVaultGenesisAdmissionCandidateResult *> *candidates =
            nil;
        if ([gGenesisCoordinator
                listPendingGenesisAdmissionCandidates:&candidates] !=
            AncPrivateVaultGenesisCoordinatorStatusOK) {
            PVSendError(peer, message, "genesis_failed");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        xpc_object_t values = xpc_array_create(NULL, 0);
        if (reply == NULL || values == NULL) {
            return;
        }
        bool valid = candidates.count <= 64;
        for (AncPrivateVaultGenesisAdmissionCandidateResult *candidate in
             candidates) {
            NSString *lookupHex = PVVaultIDHex(candidate.lookupId);
            if (!valid || lookupHex.length != 32 ||
                candidate.candidate.length == 0 ||
                candidate.candidate.length >
                    ANC_PV_GENESIS_ADMISSION_CANDIDATE_MAX_BYTES) {
                valid = false;
                break;
            }
            xpc_object_t value = xpc_dictionary_create(NULL, NULL, 0);
            xpc_dictionary_set_string(value, "lookupId", lookupHex.UTF8String);
            xpc_dictionary_set_string(value, "vaultId",
                                      candidate.vaultId.UTF8String);
            xpc_dictionary_set_data(value, "candidate",
                                    candidate.candidate.bytes,
                                    candidate.candidate.length);
            xpc_array_append_value(values, value);
        }
        if (!valid) {
            PVSendError(peer, message, "genesis_failed");
            return;
        }
        xpc_dictionary_set_string(reply, "state", "pending");
        xpc_dictionary_set_value(reply, "candidates", values);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVInspectAdmission(xpc_connection_t peer, xpc_object_t message,
                               const PVRequest *request) {
    @autoreleasepool {
        NSData *lookupID = PVLookupIDData(request->lookupID);
        NSData *challenge = request->challenge == NULL
                                ? nil
                                : [NSData dataWithBytes:request->challenge
                                                 length:request->challengeLength];
        NSString *accountID = nil;
        NSString *workspaceID = nil;
        if (lookupID == nil || challenge == nil ||
            [gGenesisCoordinator
                inspectGenesisAdmissionLookupId:lookupID
                                      challenge:challenge
                                      accountId:&accountID
                                    workspaceId:&workspaceID] !=
                AncPrivateVaultGenesisCoordinatorStatusOK) {
            PVSendError(peer, message, "admission_failed");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL)
            return;
        xpc_dictionary_set_string(reply, "state", "inspected");
        xpc_dictionary_set_string(reply, "accountId", accountID.UTF8String);
        xpc_dictionary_set_string(reply, "workspaceId", workspaceID.UTF8String);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVAuthorizeAdmission(xpc_connection_t peer, xpc_object_t message,
                                 const PVRequest *request) {
    @autoreleasepool {
        NSData *lookupID = PVLookupIDData(request->lookupID);
        NSData *challenge = request->challenge == NULL
                                ? nil
                                : [NSData dataWithBytes:request->challenge
                                                 length:request->challengeLength];
        AncPrivateVaultGenesisAdmissionAuthorizationResult *authorized = nil;
        if (lookupID == nil || challenge == nil ||
            [gGenesisCoordinator
                authorizeGenesisAdmissionLookupId:lookupID
                                         challenge:challenge
                                            result:&authorized] !=
                AncPrivateVaultGenesisCoordinatorStatusOK ||
            authorized == nil) {
            PVSendError(peer, message, "admission_failed");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL)
            return;
        xpc_dictionary_set_string(reply, "state", "authorized");
        xpc_dictionary_set_string(reply, "accountId",
                                  authorized.accountId.UTF8String);
        xpc_dictionary_set_string(reply, "workspaceId",
                                  authorized.workspaceId.UTF8String);
        xpc_dictionary_set_string(reply, "vaultId",
                                  authorized.request.vaultId.UTF8String);
        xpc_dictionary_set_string(reply, "endpointId",
                                  authorized.request.endpointId.UTF8String);
        xpc_dictionary_set_data(reply, "body", authorized.request.body.bytes,
                                authorized.request.body.length);
        xpc_dictionary_set_string(reply, "proofHeader",
                                  authorized.request.proofHeader.UTF8String);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVAcceptAdmission(xpc_connection_t peer, xpc_object_t message,
                              const PVRequest *request) {
    @autoreleasepool {
        NSData *lookupID = PVLookupIDData(request->lookupID);
        NSData *challenge = request->challenge == NULL
                                ? nil
                                : [NSData dataWithBytes:request->challenge
                                                 length:request->challengeLength];
        NSData *receipt = request->receipt == NULL
                              ? nil
                              : [NSData dataWithBytes:request->receipt
                                               length:request->receiptLength];
        AncPrivateVaultGenesisAdmissionAcceptanceResult *accepted = nil;
        if (lookupID == nil || challenge == nil || receipt == nil ||
            [gGenesisCoordinator acceptGenesisAdmissionLookupId:lookupID
                                                       challenge:challenge
                                                         receipt:receipt
                                                          result:&accepted] !=
                AncPrivateVaultGenesisCoordinatorStatusOK ||
            accepted == nil) {
            PVSendError(peer, message, "admission_failed");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL)
            return;
        xpc_dictionary_set_string(reply, "state", "accepted");
        xpc_dictionary_set_string(reply, "accountId",
                                  accepted.accountId.UTF8String);
        xpc_dictionary_set_string(reply, "workspaceId",
                                  accepted.workspaceId.UTF8String);
        xpc_dictionary_set_string(reply, "vaultId",
                                  accepted.appendRequest.vaultId.UTF8String);
        xpc_dictionary_set_string(reply, "endpointId",
                                  accepted.appendRequest.endpointId.UTF8String);
        xpc_dictionary_set_data(reply, "body",
                                accepted.appendRequest.body.bytes,
                                accepted.appendRequest.body.length);
        xpc_dictionary_set_string(reply, "proofHeader",
                                  accepted.appendRequest.proofHeader.UTF8String);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVFinalizeGenesis(xpc_connection_t peer, xpc_object_t message,
                              const PVRequest *request) {
    @autoreleasepool {
        NSData *lookupID = PVLookupIDData(request->lookupID);
        NSData *receipt = request->receipt == NULL
                              ? nil
                              : [NSData dataWithBytes:request->receipt
                                               length:request->receiptLength];
        if (lookupID == nil || receipt == nil ||
            [gGenesisCoordinator
                finalizeHostedGenesisAppendLookupId:lookupID
                                             receipt:receipt] !=
                AncPrivateVaultGenesisCoordinatorStatusOK) {
            PVSendError(peer, message, "genesis_failed");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL)
            return;
        xpc_dictionary_set_string(reply, "state", "cleaned");
        xpc_dictionary_set_string(reply, "lookupId", request->lookupID);
        xpc_connection_send_message(peer, reply);
    }
}

static NSString *PVEnrollmentToken(void) {
    uint8_t bytes[16] = {0};
    if (SecRandomCopyBytes(kSecRandomDefault, sizeof bytes, bytes) !=
        errSecSuccess) {
        return nil;
    }
    NSMutableString *token = [NSMutableString stringWithCapacity:32];
    for (size_t index = 0; index < sizeof bytes; index += 1) {
        [token appendFormat:@"%02x", bytes[index]];
    }
    anc_pv_zeroize(bytes, sizeof bytes);
    return token;
}

static BOOL PVEnrollmentContext(
    NSString *vaultId, AncPrivateVaultEnrollmentOfferArtifact **artifact,
    AncPrivateVaultControlLogState **state, uint64_t *signedAtSeconds) {
    if (vaultId.length != 32 || artifact == NULL || state == NULL ||
        signedAtSeconds == NULL || gEnrollmentArtifactStore == nil ||
        gEndpointAuthorityStore == nil) {
        return NO;
    }
    *artifact = nil;
    *state = nil;
    *signedAtSeconds = 0;
    NSData *vaultBytes = PVLookupIDData(vaultId.UTF8String);
    AncPrivateVaultEnrollmentOfferArtifact *stored = nil;
    AncPrivateVaultAuthorityCheckpoint *checkpoint = nil;
    if (vaultBytes == nil ||
        [gEnrollmentArtifactStore readVaultId:vaultBytes artifact:&stored] !=
            AncPrivateVaultEnrollmentOfferArtifactStatusOK ||
        stored == nil ||
        [gEndpointAuthorityStore loadVaultId:vaultId
                                  checkpoint:&checkpoint
                                       error:nil] !=
            AncPrivateVaultAuthorityStoreStatusOK ||
        checkpoint == nil || checkpoint.snapshot.signedAtMs == 0) {
        return NO;
    }
    AncPrivateVaultControlLogState *authenticated =
        AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(
            checkpoint);
    if (authenticated == nil ||
        ![authenticated.vaultId isEqualToString:vaultId]) {
        return NO;
    }
    *artifact = stored;
    *state = authenticated;
    *signedAtSeconds = checkpoint.snapshot.signedAtMs / 1000;
    return *signedAtSeconds > 0;
}

static NSData *PVEnrollmentRandom(NSUInteger length) {
    NSMutableData *value = [NSMutableData dataWithLength:length];
    if (value == nil ||
        SecRandomCopyBytes(kSecRandomDefault, length, value.mutableBytes) !=
            errSecSuccess) {
        if (value != nil) anc_pv_zeroize(value.mutableBytes, value.length);
        return nil;
    }
    return [NSData dataWithData:value];
}

static BOOL PVEnrollmentEndpointSecrets(
    NSString *vaultId, uint64_t expectedEpoch, BOOL includeEpoch,
    AncPrivateVaultGuardedMemory **signingSeed,
    AncPrivateVaultGuardedMemory **agreementSeed,
    AncPrivateVaultGuardedMemory **epochKey) {
    if (signingSeed == NULL || agreementSeed == NULL || epochKey == NULL ||
        vaultId.length != 32 || gCustodyRepository == nil) {
        return NO;
    }
    *signingSeed = nil;
    *agreementSeed = nil;
    *epochKey = nil;
    AncPrivateVaultCustodySnapshot snapshot = {0};
    AncPrivateVaultCustodyHandle *handle = nil;
    if ([gCustodyRepository readVaultId:vaultId
                                snapshot:&snapshot
                                  handle:&handle] !=
            AncPrivateVaultCustodyRepositoryStatusOK ||
        handle == nil ||
        snapshot.lifecycle != ANC_PV_CUSTODY_LIFECYCLE_ACTIVE ||
        snapshot.role != ANC_PV_CUSTODY_ROLE_ENDPOINT ||
        snapshot.pending_kind != ANC_PV_CUSTODY_PENDING_NONE ||
        snapshot.active_epoch != expectedEpoch) {
        if (handle != nil) [handle close];
        anc_pv_custody_snapshot_zero(&snapshot);
        return NO;
    }
    AncPrivateVaultGuardedMemoryStatus memoryStatus;
    AncPrivateVaultGuardedMemory *signing =
        [AncPrivateVaultGuardedMemory memoryWithLength:32 status:&memoryStatus];
    AncPrivateVaultGuardedMemory *agreement =
        [AncPrivateVaultGuardedMemory memoryWithLength:32 status:&memoryStatus];
    AncPrivateVaultGuardedMemory *epoch =
        includeEpoch
            ? [AncPrivateVaultGuardedMemory memoryWithLength:32
                                                     status:&memoryStatus]
            : nil;
    __block BOOL copied = NO;
    AncPrivateVaultCustodyRepositoryStatus borrowed =
        signing == nil || agreement == nil || (includeEpoch && epoch == nil)
            ? AncPrivateVaultCustodyRepositoryStatusFailed
            : [handle borrow:^BOOL(
                          const AncPrivateVaultCustodySecretInputs *secrets) {
                return [signing borrow:^BOOL(uint8_t *bytes, size_t length) {
                    if (length != 32) return NO;
                    memcpy(bytes, secrets->signing_seed, 32);
                    return [agreement
                               borrow:^BOOL(uint8_t *agreementBytes,
                                            size_t agreementLength) {
                        if (agreementLength != 32) return NO;
                        memcpy(agreementBytes, secrets->box_seed, 32);
                        if (!includeEpoch) {
                            copied = YES;
                            return YES;
                        }
                        return [epoch
                                   borrow:^BOOL(uint8_t *epochBytes,
                                                size_t epochLength) {
                            if (epochLength != 32) return NO;
                            memcpy(epochBytes, secrets->active_epoch_key, 32);
                            copied = YES;
                            return YES;
                        }] == AncPrivateVaultGuardedMemoryStatusOK && copied;
                    }] == AncPrivateVaultGuardedMemoryStatusOK && copied;
                }] == AncPrivateVaultGuardedMemoryStatusOK && copied;
            }];
    AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
    anc_pv_custody_snapshot_zero(&snapshot);
    if (borrowed != AncPrivateVaultCustodyRepositoryStatusOK || !copied ||
        closed != AncPrivateVaultCustodyRepositoryStatusOK) {
        if (signing != nil) [signing close];
        if (agreement != nil) [agreement close];
        if (epoch != nil) [epoch close];
        return NO;
    }
    *signingSeed = signing;
    *agreementSeed = agreement;
    *epochKey = epoch;
    return YES;
}

static AncPrivateVaultControlLogMember *PVObjectActiveEndpoint(
    AncPrivateVaultControlLogState *state,
    const AncPrivateVaultCustodySnapshot *snapshot) {
    if (state == nil || snapshot == NULL || snapshot->endpoint_id_length != 16)
        return nil;
    NSData *endpointId =
        [NSData dataWithBytes:snapshot->endpoint_id length:16];
    NSMutableString *endpointHex = [NSMutableString stringWithCapacity:32];
    const uint8_t *bytes = endpointId.bytes;
    for (NSUInteger index = 0; index < endpointId.length; index += 1)
        [endpointHex appendFormat:@"%02x", bytes[index]];
    AncPrivateVaultControlLogMember *match = nil;
    for (AncPrivateVaultControlLogMember *member in state.activeMembers) {
        if ([member.endpointId isEqualToString:endpointHex]) {
            if (match != nil) return nil;
            match = member;
        }
    }
    NSData *snapshotSigning =
        [NSData dataWithBytes:snapshot->signing_public_key length:32];
    return match != nil && [match.role isEqualToString:@"endpoint"] &&
                   !match.unattended &&
                   [match.signingPublicKey isEqualToData:snapshotSigning]
               ? match
               : nil;
}

static BOOL PVObjectEndpointContext(
    NSString *vaultId, AncPrivateVaultControlLogState **state,
    NSData **writerEndpointId, AncPrivateVaultGuardedMemory **signingSeed,
    AncPrivateVaultGuardedMemory **epochKey) {
    if (vaultId.length != 32 || state == NULL || writerEndpointId == NULL ||
        signingSeed == NULL || epochKey == NULL ||
        gEndpointAuthorityStore == nil || gCustodyRepository == nil) {
        return NO;
    }
    *state = nil;
    *writerEndpointId = nil;
    *signingSeed = nil;
    *epochKey = nil;
    AncPrivateVaultAuthorityCheckpoint *checkpoint = nil;
    if ([gEndpointAuthorityStore loadVaultId:vaultId
                                  checkpoint:&checkpoint
                                       error:nil] !=
            AncPrivateVaultAuthorityStoreStatusOK ||
        checkpoint == nil) {
        return NO;
    }
    AncPrivateVaultControlLogState *authenticated =
        AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(
            checkpoint);
    AncPrivateVaultCustodySnapshot snapshot = {0};
    AncPrivateVaultCustodyHandle *handle = nil;
    if (authenticated == nil ||
        ![authenticated.vaultId isEqualToString:vaultId] ||
        [gCustodyRepository readVaultId:vaultId
                              snapshot:&snapshot
                                handle:&handle] !=
            AncPrivateVaultCustodyRepositoryStatusOK ||
        handle == nil) {
        if (handle != nil) [handle close];
        anc_pv_custody_snapshot_zero(&snapshot);
        return NO;
    }
    NSData *vaultBytes = PVLookupIDData(vaultId.UTF8String);
    NSData *anchoredHead =
        [NSData dataWithBytes:snapshot.anchored_head length:32];
    NSData *membership =
        [NSData dataWithBytes:snapshot.membership_digest length:32];
    AncPrivateVaultControlLogMember *member =
        PVObjectActiveEndpoint(authenticated, &snapshot);
    BOOL publicStateOkay =
        snapshot.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
        snapshot.role == ANC_PV_CUSTODY_ROLE_ENDPOINT &&
        snapshot.pending_kind == ANC_PV_CUSTODY_PENDING_NONE &&
        snapshot.rotation_phase == ANC_PV_CUSTODY_ROTATION_NONE &&
        snapshot.authority_anchor_present == 1 &&
        snapshot.vault_id_length == 16 && vaultBytes != nil &&
        anc_pv_memcmp(snapshot.vault_id, vaultBytes.bytes, 16) == 0 &&
        snapshot.active_epoch == authenticated.epoch &&
        snapshot.anchored_sequence == authenticated.sequence &&
        [anchoredHead isEqualToData:authenticated.headHash] &&
        [membership isEqualToData:authenticated.membershipHash] && member != nil;
    AncPrivateVaultGuardedMemoryStatus memoryStatus;
    AncPrivateVaultGuardedMemory *signing =
        publicStateOkay
            ? [AncPrivateVaultGuardedMemory memoryWithLength:32
                                                     status:&memoryStatus]
            : nil;
    AncPrivateVaultGuardedMemory *epoch =
        publicStateOkay
            ? [AncPrivateVaultGuardedMemory memoryWithLength:32
                                                     status:&memoryStatus]
            : nil;
    __block BOOL copied = NO;
    AncPrivateVaultCustodyRepositoryStatus borrowed =
        signing == nil || epoch == nil
            ? AncPrivateVaultCustodyRepositoryStatusFailed
            : [handle borrow:^BOOL(
                          const AncPrivateVaultCustodySecretInputs *secrets) {
                return [signing borrow:^BOOL(uint8_t *signingBytes,
                                             size_t signingLength) {
                    if (signingLength != 32) return NO;
                    memcpy(signingBytes, secrets->signing_seed, 32);
                    return [epoch borrow:^BOOL(uint8_t *epochBytes,
                                               size_t epochLength) {
                        if (epochLength != 32) return NO;
                        memcpy(epochBytes, secrets->active_epoch_key, 32);
                        copied = YES;
                        return YES;
                    }] == AncPrivateVaultGuardedMemoryStatusOK && copied;
                }] == AncPrivateVaultGuardedMemoryStatusOK && copied;
            }];
    AncPrivateVaultCustodyRepositoryStatus closed = [handle close];
    NSData *endpointId =
        [NSData dataWithBytes:snapshot.endpoint_id length:16];
    anc_pv_custody_snapshot_zero(&snapshot);
    if (!publicStateOkay ||
        borrowed != AncPrivateVaultCustodyRepositoryStatusOK || !copied ||
        closed != AncPrivateVaultCustodyRepositoryStatusOK) {
        if (signing != nil) [signing close];
        if (epoch != nil) [epoch close];
        return NO;
    }
    *state = authenticated;
    *writerEndpointId = endpointId;
    *signingSeed = signing;
    *epochKey = epoch;
    return YES;
}

static void PVSealObject(xpc_connection_t peer, xpc_object_t message,
                         const PVRequest *request) {
    @autoreleasepool {
        NSString *vaultId = [NSString stringWithUTF8String:request->vaultID];
        NSData *vaultBytes = PVLookupIDData(request->vaultID);
        NSData *objectId = PVLookupIDData(request->objectID);
        NSMutableData *plaintext =
            request->objectPayload == NULL
                ? nil
                : [NSMutableData dataWithBytes:request->objectPayload
                                        length:request->objectPayloadLength];
        AncPrivateVaultControlLogState *state = nil;
        NSData *writerEndpointId = nil;
        AncPrivateVaultGuardedMemory *signing = nil;
        AncPrivateVaultGuardedMemory *epoch = nil;
        uint64_t nowMilliseconds = 0;
        BOOL contextOkay =
            vaultBytes != nil && objectId != nil && plaintext != nil &&
            [gTrustedClock readNowMilliseconds:&nowMilliseconds] &&
            nowMilliseconds >= 1000 &&
            nowMilliseconds / 1000 <= UINT64_C(9007199254740991) &&
            PVObjectEndpointContext(vaultId, &state, &writerEndpointId,
                                    &signing, &epoch);
        NSData *dekEnvelopeId = contextOkay ? PVEnrollmentRandom(16) : nil;
        NSData *headerEnvelopeId = contextOkay ? PVEnrollmentRandom(16) : nil;
        NSData *chunkEnvelopeId = contextOkay ? PVEnrollmentRandom(16) : nil;
        NSData *dekNonce = contextOkay ? PVEnrollmentRandom(24) : nil;
        AncPrivateVaultObjectRevisionStatus status;
        AncPrivateVaultSealedObjectRevision *sealed =
            dekEnvelopeId == nil || headerEnvelopeId == nil ||
                    chunkEnvelopeId == nil || dekNonce == nil
                ? nil
                : AncPrivateVaultSealObjectRevision(
                      vaultBytes, objectId, writerEndpointId,
                      request->objectRevision, state.epoch,
                      [NSString stringWithUTF8String:request->objectContentType],
                      plaintext, nowMilliseconds / 1000, dekEnvelopeId,
                      headerEnvelopeId, chunkEnvelopeId, dekNonce, state,
                      signing, epoch, &status);
        if (plaintext != nil)
            anc_pv_zeroize(plaintext.mutableBytes, plaintext.length);
        BOOL signingClosed =
            signing != nil &&
            [signing close] == AncPrivateVaultGuardedMemoryStatusOK;
        BOOL epochClosed =
            epoch != nil && [epoch close] == AncPrivateVaultGuardedMemoryStatusOK;
        if (sealed == nil || !signingClosed || !epochClosed) {
            PVSendError(peer, message, "object_seal_failed");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL) return;
        xpc_dictionary_set_string(reply, "state", "sealed");
        xpc_dictionary_set_string(reply, "vaultId", request->vaultID);
        xpc_dictionary_set_string(reply, "objectId", request->objectID);
        xpc_dictionary_set_uint64(reply, "revision", sealed.revision);
        xpc_dictionary_set_uint64(reply, "epoch", sealed.epoch);
        xpc_dictionary_set_data(reply, "revisionId", sealed.revisionId.bytes,
                                sealed.revisionId.length);
        xpc_dictionary_set_string(reply, "contentType",
                                  sealed.contentType.UTF8String);
        xpc_dictionary_set_int64(reply, "plaintextLength",
                                 (int64_t)sealed.plaintextLength);
        xpc_dictionary_set_data(reply, "objectPayload",
                                sealed.encodedRevision.bytes,
                                sealed.encodedRevision.length);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVOpenObject(xpc_connection_t peer, xpc_object_t message,
                         const PVRequest *request) {
    @autoreleasepool {
        NSString *vaultId = [NSString stringWithUTF8String:request->vaultID];
        NSData *vaultBytes = PVLookupIDData(request->vaultID);
        NSData *objectId = PVLookupIDData(request->objectID);
        NSData *encoded =
            request->objectPayload == NULL
                ? nil
                : [NSData dataWithBytes:request->objectPayload
                                 length:request->objectPayloadLength];
        AncPrivateVaultControlLogState *state = nil;
        NSData *unusedWriter = nil;
        AncPrivateVaultGuardedMemory *signing = nil;
        AncPrivateVaultGuardedMemory *epoch = nil;
        BOOL contextOkay =
            vaultBytes != nil && objectId != nil && encoded != nil &&
            PVObjectEndpointContext(vaultId, &state, &unusedWriter, &signing,
                                    &epoch);
        AncPrivateVaultObjectRevisionStatus status;
        AncPrivateVaultOpenedObjectRevision *opened =
            contextOkay ? AncPrivateVaultOpenObjectRevision(
                              encoded, vaultBytes, objectId, state, epoch,
                              &status)
                        : nil;
        BOOL signingClosed =
            signing != nil &&
            [signing close] == AncPrivateVaultGuardedMemoryStatusOK;
        BOOL epochClosed =
            epoch != nil && [epoch close] == AncPrivateVaultGuardedMemoryStatusOK;
        if (opened == nil || opened.revision != request->objectRevision ||
            opened.epoch != state.epoch ||
            ![opened.contentType isEqualToString:
                @"application/vnd.agent-native.content-document+json"] ||
            !signingClosed || !epochClosed) {
            PVSendError(peer, message, "object_open_failed");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL) return;
        xpc_dictionary_set_string(reply, "state", "opened");
        xpc_dictionary_set_string(reply, "vaultId", request->vaultID);
        xpc_dictionary_set_string(reply, "objectId", request->objectID);
        xpc_dictionary_set_uint64(reply, "revision", opened.revision);
        xpc_dictionary_set_uint64(reply, "epoch", opened.epoch);
        xpc_dictionary_set_data(reply, "revisionId", opened.revisionId.bytes,
                                opened.revisionId.length);
        xpc_dictionary_set_data(reply, "writerEndpointId",
                                opened.writerEndpointId.bytes,
                                opened.writerEndpointId.length);
        xpc_dictionary_set_string(reply, "contentType",
                                  opened.contentType.UTF8String);
        xpc_dictionary_set_data(reply, "objectPayload", opened.plaintext.bytes,
                                opened.plaintext.length);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVChallengeEnrollment(xpc_connection_t peer, xpc_object_t message,
                                  const PVRequest *request) {
    @autoreleasepool {
        NSString *vaultId = [NSString stringWithUTF8String:request->vaultID];
        AncPrivateVaultEnrollmentOfferArtifact *artifact = nil;
        AncPrivateVaultControlLogState *state = nil;
        uint64_t signedAt = 0;
        uint64_t now = (uint64_t)floor(NSDate.date.timeIntervalSince1970);
        AncPrivateVaultGuardedMemory *signing = nil, *agreement = nil,
                                             *unusedEpoch = nil;
        NSData *envelope = PVEnrollmentRandom(16);
        NSData *nonce = PVEnrollmentRandom(32);
        uint64_t expires = now > UINT64_MAX - 600 ? 0 : now + 600;
        if (!PVEnrollmentContext(vaultId, &artifact, &state, &signedAt)) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        if (signedAt <= UINT64_MAX - 900 && expires > signedAt + 900)
            expires = signedAt + 900;
        if (now == 0 || expires <= now || envelope == nil || nonce == nil ||
            !PVEnrollmentEndpointSecrets(vaultId, state.epoch, NO, &signing,
                                         &agreement, &unusedEpoch)) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        AncPrivateVaultEnrollmentAuthorizerStatus status;
        AncPrivateVaultPreparedEnrollmentChallenge *prepared =
            AncPrivateVaultBuildEnrollmentChallenge(
                artifact.encodedOffer, artifact.candidateKeyProof, state,
                signing, agreement, envelope, nonce, signedAt, now, expires,
                &status);
        BOOL signingClosed =
            [signing close] == AncPrivateVaultGuardedMemoryStatusOK;
        BOOL agreementClosed =
            [agreement close] == AncPrivateVaultGuardedMemoryStatusOK;
        BOOL closed = signingClosed && agreementClosed;
        if (prepared == nil || !closed) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL) return;
        xpc_dictionary_set_string(reply, "state", "challenged");
        xpc_dictionary_set_string(reply, "vaultId", request->vaultID);
        xpc_dictionary_set_data(reply, "challenge",
                                prepared.encodedChallenge.bytes,
                                prepared.encodedChallenge.length);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVAuthorizeEnrollment(xpc_connection_t peer, xpc_object_t message,
                                  const PVRequest *request) {
    @autoreleasepool {
        NSString *vaultId = [NSString stringWithUTF8String:request->vaultID];
        NSData *challengeBytes =
            request->enrollmentChallenge == NULL
                ? nil
                : [NSData dataWithBytes:request->enrollmentChallenge
                                  length:request->enrollmentChallengeLength];
        AncPrivateVaultEnrollmentOfferArtifact *artifact = nil;
        AncPrivateVaultControlLogState *state = nil;
        uint64_t signedAt = 0;
        uint64_t now = (uint64_t)floor(NSDate.date.timeIntervalSince1970);
        AncPrivateVaultEnrollmentChallengeStatus challengeStatus;
        AncPrivateVaultEnrollmentChallengeResult *challenge = nil;
        if (!PVEnrollmentContext(vaultId, &artifact, &state, &signedAt) ||
            challengeBytes == nil || now == 0 ||
            gEnrollmentReceiptStore == nil) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        challenge = AncPrivateVaultEnrollmentChallengeVerify(
            artifact.encodedOffer, challengeBytes, state, signedAt, now,
            &challengeStatus);
        AncPrivateVaultEnrollmentSasReceipt *receipt = nil;
        if (challenge == nil ||
            [gEnrollmentReceiptStore readChallenge:challenge
                                            receipt:&receipt] !=
                AncPrivateVaultEnrollmentSasReceiptStoreStatusOK ||
            receipt.decision != AncPrivateVaultEnrollmentSasDecisionConfirmed) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        AncPrivateVaultGuardedMemory *signing = nil, *agreement = nil,
                                             *epoch = nil;
        if (!PVEnrollmentEndpointSecrets(vaultId, state.epoch, YES, &signing,
                                         &agreement, &epoch)) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        NSData *authorizationId = PVEnrollmentRandom(16);
        NSData *endpointId = PVEnrollmentRandom(16);
        NSData *wrapId = PVEnrollmentRandom(16);
        NSData *wrapNonce = PVEnrollmentRandom(24);
        NSData *entryId = PVEnrollmentRandom(16);
        uint64_t expires = now > UINT64_MAX - 600 ? 0 : now + 600;
        if (signedAt <= UINT64_MAX - 900 && expires > signedAt + 900) {
            expires = signedAt + 900;
        }
        AncPrivateVaultEnrollmentAuthorizerStatus status;
        AncPrivateVaultPreparedEnrollmentAuthorization *prepared =
            authorizationId == nil || endpointId == nil || wrapId == nil ||
                    wrapNonce == nil || entryId == nil || expires <= now
                ? nil
                : AncPrivateVaultBuildEnrollmentAuthorization(
                      artifact.encodedOffer, challenge, receipt, state, signing,
                      agreement, epoch, authorizationId, endpointId, wrapId,
                      wrapNonce, entryId, now, signedAt, now, expires, &status);
        BOOL signingClosed =
            [signing close] == AncPrivateVaultGuardedMemoryStatusOK;
        BOOL agreementClosed =
            [agreement close] == AncPrivateVaultGuardedMemoryStatusOK;
        BOOL epochClosed = [epoch close] == AncPrivateVaultGuardedMemoryStatusOK;
        BOOL closed = signingClosed && agreementClosed && epochClosed;
        if (prepared == nil || !closed) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL) return;
        xpc_dictionary_set_string(reply, "state", "authorized");
        xpc_dictionary_set_string(reply, "vaultId", request->vaultID);
        xpc_dictionary_set_data(reply, "authorization",
                                prepared.encodedAuthorization.bytes,
                                prepared.encodedAuthorization.length);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVPrepareEnrollment(xpc_connection_t peer, xpc_object_t message,
                                const PVRequest *request) {
    @autoreleasepool {
        NSData *vaultBytes = PVLookupIDData(request->vaultID);
        AncPrivateVaultEnrollmentCandidate *candidate = nil;
        uint64_t now = (uint64_t)floor(NSDate.date.timeIntervalSince1970);
        if (vaultBytes == nil || gEnrollmentCoordinator == nil || now == 0 ||
            [gEnrollmentCoordinator prepareBrokerVaultId:vaultBytes
                                              nowSeconds:now
                                               candidate:&candidate] !=
                AncPrivateVaultEnrollmentCoordinatorStatusOK ||
            candidate == nil) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        NSString *candidateId = PVVaultIDHex(candidate.endpointId);
        NSString *offerHash = PVHex(candidate.offerHash);
        if (candidateId.length != 32 || offerHash.length != 64) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL)
            return;
        xpc_dictionary_set_string(reply, "state", "offered");
        xpc_dictionary_set_string(reply, "vaultId", request->vaultID);
        xpc_dictionary_set_string(reply, "candidateEndpointId",
                                  candidateId.UTF8String);
        xpc_dictionary_set_string(reply, "offerHash", offerHash.UTF8String);
        xpc_dictionary_set_data(reply, "offer", candidate.encodedOffer.bytes,
                                candidate.encodedOffer.length);
        xpc_dictionary_set_data(reply, "candidateKeyProof",
                                candidate.candidateKeyProof.bytes,
                                candidate.candidateKeyProof.length);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVInspectEnrollment(xpc_connection_t peer, xpc_object_t message,
                                const PVRequest *request) {
    @autoreleasepool {
        NSString *vaultId = [NSString stringWithUTF8String:request->vaultID];
        AncPrivateVaultEnrollmentOfferArtifact *artifact = nil;
        AncPrivateVaultControlLogState *state = nil;
        uint64_t signedAt = 0;
        uint64_t now = (uint64_t)floor(NSDate.date.timeIntervalSince1970);
        NSData *challengeBytes =
            request->enrollmentChallenge == NULL
                ? nil
                : [NSData dataWithBytes:request->enrollmentChallenge
                                  length:request->enrollmentChallengeLength];
        AncPrivateVaultEnrollmentChallengeStatus status;
        AncPrivateVaultEnrollmentChallengeResult *challenge = nil;
        if (!PVEnrollmentContext(vaultId, &artifact, &state, &signedAt) ||
            challengeBytes == nil || now == 0) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        challenge = AncPrivateVaultEnrollmentChallengeVerify(
            artifact.encodedOffer, challengeBytes, state, signedAt, now,
            &status);
        NSString *candidateId = PVVaultIDHex(challenge.candidateEndpointId);
        if (challenge == nil || candidateId.length != 32 ||
            ![challenge.targetMembershipRole isEqualToString:@"broker"] ||
            challenge.sasTranscriptHash.length != 32) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        NSString *token = PVEnrollmentToken();
        if (token == nil) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        PVEnrollmentInspection *inspection = [PVEnrollmentInspection new];
        inspection.vaultId = vaultId;
        inspection.challenge = challenge;
        inspection.expiresAt = challenge.expiresAt;
        [gEnrollmentInspectionLock lock];
        @try {
            NSArray<NSString *> *keys = gEnrollmentInspections.allKeys;
            for (NSString *key in keys) {
                PVEnrollmentInspection *existing = gEnrollmentInspections[key];
                if (existing.expiresAt < now)
                    [gEnrollmentInspections removeObjectForKey:key];
            }
            if (gEnrollmentInspections.count >= 16) {
                token = nil;
            } else {
                gEnrollmentInspections[token] = inspection;
            }
        } @finally {
            [gEnrollmentInspectionLock unlock];
        }
        if (token == nil) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL)
            return;
        xpc_dictionary_set_string(reply, "state", "inspected");
        xpc_dictionary_set_string(reply, "ceremonyToken", token.UTF8String);
        xpc_dictionary_set_string(reply, "sasCode",
                                  challenge.sasCode.UTF8String);
        xpc_dictionary_set_string(reply, "candidateEndpointId",
                                  candidateId.UTF8String);
        xpc_dictionary_set_string(reply, "membershipRole", "broker");
        xpc_dictionary_set_bool(reply, "unattended", true);
        xpc_dictionary_set_data(reply, "sasTranscriptHash",
                                challenge.sasTranscriptHash.bytes,
                                challenge.sasTranscriptHash.length);
        xpc_connection_send_message(peer, reply);
    }
}

static void PVDecideEnrollment(xpc_connection_t peer, xpc_object_t message,
                               const PVRequest *request) {
    @autoreleasepool {
        NSString *token =
            [NSString stringWithUTF8String:request->ceremonyToken];
        uint64_t now = (uint64_t)floor(NSDate.date.timeIntervalSince1970);
        [gEnrollmentInspectionLock lock];
        PVEnrollmentInspection *inspection = gEnrollmentInspections[token];
        [gEnrollmentInspectionLock unlock];
        if (inspection == nil || now == 0 || now > inspection.expiresAt) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        uint8_t receiptBytes[16] = {0};
        if (SecRandomCopyBytes(kSecRandomDefault, sizeof receiptBytes,
                              receiptBytes) != errSecSuccess) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        NSData *receiptId = [NSData dataWithBytes:receiptBytes
                                          length:sizeof receiptBytes];
        anc_pv_zeroize(receiptBytes, sizeof receiptBytes);
        BOOL confirmed = strcmp(request->decision, "confirmed") == 0;
        AncPrivateVaultEnrollmentSasReceipt *receipt = nil;
        AncPrivateVaultEnrollmentCoordinatorStatus status =
            [gEnrollmentCoordinator
                recordSasDecisionForChallenge:inspection.challenge
                                  receiptId:receiptId
                                  decidedAt:now
                                   decision:confirmed
                                                ? AncPrivateVaultEnrollmentSasDecisionConfirmed
                                                : AncPrivateVaultEnrollmentSasDecisionMismatch
                                    receipt:&receipt];
        if (status != AncPrivateVaultEnrollmentCoordinatorStatusOK ||
            receipt == nil) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        [gEnrollmentInspectionLock lock];
        if (gEnrollmentInspections[token] == inspection)
            [gEnrollmentInspections removeObjectForKey:token];
        [gEnrollmentInspectionLock unlock];
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL)
            return;
        xpc_dictionary_set_string(reply, "state",
                                  confirmed ? "confirmed" : "mismatch");
        xpc_connection_send_message(peer, reply);
    }
}

static void PVActivateEnrollment(xpc_connection_t peer, xpc_object_t message,
                                 const PVRequest *request) {
    @autoreleasepool {
        NSString *vaultId = [NSString stringWithUTF8String:request->vaultID];
        AncPrivateVaultEnrollmentOfferArtifact *artifact = nil;
        AncPrivateVaultControlLogState *state = nil;
        uint64_t signedAt = 0;
        uint64_t now = (uint64_t)floor(NSDate.date.timeIntervalSince1970);
        NSData *challenge =
            request->enrollmentChallenge == NULL
                ? nil
                : [NSData dataWithBytes:request->enrollmentChallenge
                                  length:request->enrollmentChallengeLength];
        NSData *authorization =
            request->enrollmentAuthorization == NULL
                ? nil
                : [NSData dataWithBytes:request->enrollmentAuthorization
                                  length:request->enrollmentAuthorizationLength];
        if (!PVEnrollmentContext(vaultId, &artifact, &state, &signedAt) ||
            challenge == nil || authorization == nil || now == 0) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        AncPrivateVaultEnrollmentAuthorizationStatus verifyStatus;
        AncPrivateVaultEnrollmentAuthorizationResult *verified =
            AncPrivateVaultEnrollmentAuthorizationVerify(
                artifact.encodedOffer, challenge, authorization, state,
                signedAt, now, gControlLog, &verifyStatus);
        AncPrivateVaultAuthorityCheckpoint *checkpoint = nil;
        if (verified == nil ||
            [gEnrollmentCoordinator activateAuthorization:verified
                                              verifiedAtMs:now * 1000
                                                checkpoint:&checkpoint] !=
                AncPrivateVaultEnrollmentCoordinatorStatusOK ||
            checkpoint == nil) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        NSString *headHash = PVHex(checkpoint.snapshot.headHash);
        if (headHash.length != 64) {
            PVSendError(peer, message, "enrollment_failed");
            return;
        }
        xpc_object_t reply = PVCreateReply(message, request);
        if (reply == NULL)
            return;
        xpc_dictionary_set_string(reply, "state", "active");
        xpc_dictionary_set_string(reply, "vaultId", request->vaultID);
        xpc_dictionary_set_uint64(reply, "custodyGeneration",
                                  checkpoint.custodyGeneration);
        xpc_dictionary_set_uint64(reply, "activeEpoch",
                                  checkpoint.snapshot.epoch);
        xpc_dictionary_set_uint64(reply, "sequence",
                                  checkpoint.snapshot.sequence);
        xpc_dictionary_set_string(reply, "headHash", headHash.UTF8String);
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
            if (strcmp(request.operation, "unlock") == 0) {
                PVUnlock(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "lock") == 0) {
                PVLock(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "resume_rotation") == 0) {
                PVResumeRotation(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "prepare_genesis") == 0) {
                PVPrepareGenesis(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "confirm_genesis") == 0) {
                PVConfirmGenesis(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "list_genesis") == 0) {
                PVListGenesis(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "inspect_admit") == 0) {
                PVInspectAdmission(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "authorize_admit") == 0) {
                PVAuthorizeAdmission(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "accept_admit") == 0) {
                PVAcceptAdmission(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "finalize_genesis") == 0) {
                PVFinalizeGenesis(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "prepare_enroll") == 0) {
                PVPrepareEnrollment(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "challenge_enroll") == 0) {
                PVChallengeEnrollment(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "inspect_enroll") == 0) {
                PVInspectEnrollment(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "decide_enroll") == 0) {
                PVDecideEnrollment(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "authorize_enroll") == 0) {
                PVAuthorizeEnrollment(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "activate_enroll") == 0) {
                PVActivateEnrollment(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "seal_object") == 0) {
                PVSealObject(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "open_object") == 0) {
                PVOpenObject(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "accept_bootstrap") == 0) {
                PVAcceptBootstrap(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "recover_begin") == 0) {
                PVRecoverBootstrap(peer, message, &request, YES);
                return;
            }
            if (strcmp(request.operation, "recover_page") == 0) {
                PVRecoverBootstrap(peer, message, &request, NO);
                return;
            }
            if (strcmp(request.operation, "recover_status") == 0) {
                PVRecoverStatus(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "open_job") == 0) {
                PVOpenJob(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "seal_result") == 0) {
                PVSealResult(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "complete_result") == 0) {
                PVCompleteResult(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "pending_result") == 0) {
                PVPendingResult(peer, message, &request);
                return;
            }
            if (strcmp(request.operation, "sign_request") == 0) {
                PVSignEndpointRequest(peer, message, &request);
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
        gBootstrapReplayLock = [NSLock new];
        gRecoveryStatusLock = [NSLock new];
        gRecoveryStatuses = [NSMutableDictionary dictionary];
        gEnrollmentInspectionLock = [NSLock new];
        gEnrollmentInspections = [NSMutableDictionary dictionary];
        NSURL *stateRoot = PVStateRootURL();
        NSURL *recoveryStateRoot =
            AncPrivateVaultPrepareRecoveryStateRoot(stateRoot);
        NSURL *brokerStateRoot =
            AncPrivateVaultPrepareBrokerStateRoot(stateRoot);
        AncPrivateVaultKeychain *keychain =
            [[AncPrivateVaultKeychain alloc] init];
        gCustodyRepository = [[AncPrivateVaultCustodyRepository alloc]
            initWithKeychain:keychain
                     recordId:AncPrivateVaultEndpointCustodyRecordId];
        gBrokerCustodyRepository = [[AncPrivateVaultCustodyRepository alloc]
            initWithKeychain:keychain
                     recordId:AncPrivateVaultBrokerCustodyRecordId];
        gSession = [[AncPrivateVaultSession alloc]
            initWithRepository:
                (id<AncPrivateVaultSessionCustodyRepository>)
                    gBrokerCustodyRepository];
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
        AncPrivateVaultAuthorityStore *brokerAuthority =
            [[AncPrivateVaultAuthorityStore alloc]
                initWithStateRootURL:brokerStateRoot
                   custodyRepository:gBrokerCustodyRepository];
        gGrantIndex = [[AncPrivateVaultGrantIndex alloc]
            initWithStateRootURL:brokerStateRoot
                         session:gSession
                        keychain:keychain];
        AncPrivateVaultResultSpool *resultSpool =
            [[AncPrivateVaultResultSpool alloc]
                initWithStateRootURL:brokerStateRoot];
        gJobProcessor = [[AncPrivateVaultJobProcessor alloc]
            initWithSession:gSession authorityStore:brokerAuthority
                 grantIndex:gGrantIndex resultSpool:resultSpool];
        AncPrivateVaultControlLog *controlLog =
            [[AncPrivateVaultControlLog alloc] init];
        gEndpointAuthorityStore = authority;
        gControlLog = controlLog;
        gEnrollmentArtifactStore =
            [[AncPrivateVaultEnrollmentOfferArtifactStore alloc]
                initWithKeychain:keychain
                         recordId:@"broker-enrollment-offer-v1"];
        AncPrivateVaultEnrollmentSasReceiptStore *enrollmentReceiptStore =
            [[AncPrivateVaultEnrollmentSasReceiptStore alloc]
                initWithKeychain:keychain
                         recordId:@"broker-enrollment-sas-v1"];
        gEnrollmentReceiptStore = enrollmentReceiptStore;
        gEnrollmentCoordinator = [[AncPrivateVaultEnrollmentCoordinator alloc]
            initWithBrokerCustodyRepository:gBrokerCustodyRepository
                               artifactStore:gEnrollmentArtifactStore
                             sasReceiptStore:enrollmentReceiptStore
                              authorityStore:brokerAuthority];
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
        gTrustedClock = genesisTrustedClock;
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
        AncPrivateVaultHostedAppendRetryStore *recoveryRetryStore =
            [[AncPrivateVaultHostedAppendRetryStore alloc]
                initWithStateRootURL:recoveryStateRoot];
        AncPrivateVaultGenesisPreparationArtifactStore
            *recoveryArtifactStore =
                [[AncPrivateVaultGenesisPreparationArtifactStore alloc]
                    initWithStateRootURL:recoveryStateRoot];
        AncPrivateVaultRecoveryPreparationStore *recoveryPreparationStore =
            [[AncPrivateVaultRecoveryPreparationStore alloc]
                initWithKeychain:keychain];
        gRecoveryCoordinator = [[AncPrivateVaultRecoveryCoordinator alloc]
            initWithPreparationStore:recoveryPreparationStore
                        artifactStore:recoveryArtifactStore
                           retryStore:recoveryRetryStore
                    custodyRepository:gCustodyRepository
                        authorityStore:authority
                             transport:gHostedAppendTransport];
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
        if (stateRoot == nil || recoveryStateRoot == nil ||
            brokerStateRoot == nil || keychain == nil ||
            gCustodyRepository == nil || gBrokerCustodyRepository == nil ||
            gSession == nil ||
            spool == nil || preparation == nil || authority == nil ||
            brokerAuthority == nil || gGrantIndex == nil ||
            gJobProcessor == nil ||
            gEndpointAuthorityStore == nil || gControlLog == nil ||
            gEnrollmentArtifactStore == nil || enrollmentReceiptStore == nil ||
            gEnrollmentCoordinator == nil || gEnrollmentInspectionLock == nil ||
            gEnrollmentInspections == nil ||
            controlLog == nil || genesisArtifacts == nil ||
            genesisPreparationArtifacts == nil ||
            genesisPreparationStore == nil ||
            trustedTimeStore == nil || genesisTrustedClock == nil ||
            gGenesisCoordinator == nil || gRotationCoordinator == nil ||
            gHostedAppendTransport == nil || retryStore == nil ||
            recoveryRetryStore == nil || recoveryArtifactStore == nil ||
            recoveryPreparationStore == nil || gRecoveryCoordinator == nil ||
            gRecoveryStatusLock == nil || gRecoveryStatuses == nil ||
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
        NSArray<NSData *> *recoveryVaultIDs = nil;
        if ([recoveryRetryStore listVaultIds:&recoveryVaultIDs] !=
            AncPrivateVaultHostedAppendRetryStoreStatusOK) {
            return EXIT_FAILURE;
        }
        for (NSData *vaultID in recoveryVaultIDs) {
            NSString *vaultIDHex = PVVaultIDHex(vaultID);
            if (vaultIDHex.length != 32) return EXIT_FAILURE;
            PVResumeRecovery(vaultIDHex);
        }
        gStartupComplete = true;

        xpc_main(PVConnectionHandler);
    }
    return EXIT_FAILURE;
}
