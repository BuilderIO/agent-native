#ifndef AGENT_NATIVE_PRIVATE_VAULT_SERVICE_PROTOCOL_H
#define AGENT_NATIVE_PRIVATE_VAULT_SERVICE_PROTOCOL_H

#include <xpc/xpc.h>
#include <stdbool.h>

#define PV_PROTOCOL_VERSION 3
#define PV_MAXIMUM_REQUEST_FIELDS 8
#define PV_MAXIMUM_OPERATION_BYTES 16
#define PV_MAXIMUM_REQUEST_ID_BYTES 64
#define PV_VAULT_ID_BYTES 32
#define PV_GENESIS_CONFIRMATION_MAXIMUM_BYTES (64 * 1024)
#define PV_GENESIS_TRANSCRIPT_MAXIMUM_BYTES (4 * 1024)
#define PV_GENESIS_AUTHORIZATION_MAXIMUM_BYTES (256 * 1024)
#define PV_GENESIS_MNEMONIC_MAXIMUM_BYTES 512
#define PV_GENESIS_CHALLENGE_MAXIMUM_BYTES 2048
#define PV_GENESIS_RECEIPT_MAXIMUM_BYTES 2048
#define PV_BOOTSTRAP_FRAME_MAXIMUM_BYTES 26746884
#define PV_JOB_ENVELOPE_MAXIMUM_BYTES (16 * 1024 * 1024 + 64 * 1024)

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
    const char *lookupID;
    const char *jobID;
    const char *jobHash;
    const char *resultState;
    const void *recoveryConfirmation;
    size_t recoveryConfirmationLength;
    const void *bootstrapTranscript;
    size_t bootstrapTranscriptLength;
    const void *authorization;
    size_t authorizationLength;
    const void *recoveryMnemonic;
    size_t recoveryMnemonicLength;
    const void *challenge;
    size_t challengeLength;
    const void *receipt;
    size_t receiptLength;
    const void *bootstrapFrame;
    size_t bootstrapFrameLength;
    const void *jobEnvelope;
    size_t jobEnvelopeLength;
    const void *resultPayload;
    size_t resultPayloadLength;
} PVRequest;

PVRequestResult PVParseRequest(xpc_object_t message, PVRequest *request);
/* Every parsed operation remains closed until private startup recovery has
 * reached a proven fixed point. */
bool PVRequestCanRun(const PVRequest *request, bool startupComplete);

#endif
