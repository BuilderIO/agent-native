#ifndef AGENT_NATIVE_PRIVATE_VAULT_SERVICE_PROTOCOL_H
#define AGENT_NATIVE_PRIVATE_VAULT_SERVICE_PROTOCOL_H

#include <xpc/xpc.h>
#include <stdbool.h>

#define PV_PROTOCOL_VERSION 3
#define PV_MAXIMUM_REQUEST_FIELDS 10
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
#define PV_JOB_PAYLOAD_MAXIMUM_BYTES (16 * 1024 * 1024)
#define PV_ENDPOINT_PROOF_MAXIMUM_BYTES (64 * 1024)
#define PV_ENROLLMENT_OFFER_MAXIMUM_BYTES 1024
#define PV_ENROLLMENT_CANDIDATE_PROOF_BYTES 64
#define PV_ENROLLMENT_CHALLENGE_MAXIMUM_BYTES (64 * 1024)
#define PV_ENROLLMENT_SAS_DECISION_MAXIMUM_BYTES 2048
#define PV_ENROLLMENT_AUTHORIZATION_MAXIMUM_BYTES (256 * 1024)
#define PV_OBJECT_PLAINTEXT_MAXIMUM_BYTES (1024 * 1024)
#define PV_OBJECT_REVISION_MAXIMUM_BYTES (1024 * 1024 + 64 * 1024)
#define PV_EXPORT_PLAINTEXT_MAXIMUM_BYTES (256 * 1024 * 1024)

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
    const char *grantRef;
    const char *recipientEndpointID;
    const char *subjectAgentID;
    const char *senderEndpointID;
    const char *algorithmID;
    const char *resultState;
    const char *decision;
    const char *ceremonyToken;
    const char *objectID;
    const char *objectContentType;
    const char *exportID;
    const char *sourceSnapshotHash;
    uint64_t objectRevision;
    uint64_t exportCreatedAt;
    uint64_t exportObjectCount;
    uint64_t hostedEpoch;
    uint64_t hostedRetryCount;
    uint64_t expiresAt;
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
    const void *jobPayload;
    size_t jobPayloadLength;
    const void *resultPayload;
    size_t resultPayloadLength;
    const void *unsignedProof;
    size_t unsignedProofLength;
    const void *enrollmentChallenge;
    size_t enrollmentChallengeLength;
    const void *enrollmentOffer;
    size_t enrollmentOfferLength;
    const void *enrollmentCandidateKeyProof;
    size_t enrollmentCandidateKeyProofLength;
    const void *enrollmentSasDecision;
    size_t enrollmentSasDecisionLength;
    const void *enrollmentAuthorization;
    size_t enrollmentAuthorizationLength;
    const void *objectPayload;
    size_t objectPayloadLength;
    const void *exportPlaintext;
    size_t exportPlaintextLength;
    const void *exportArchive;
    size_t exportArchiveLength;
} PVRequest;

PVRequestResult PVParseRequest(xpc_object_t message, PVRequest *request);
/* Every parsed operation remains closed until private startup recovery has
 * reached a proven fixed point. */
bool PVRequestCanRun(const PVRequest *request, bool startupComplete);

#endif
