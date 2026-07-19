#import <Security/Security.h>
#import <xpc/xpc.h>

#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "PrivateVaultServiceIdentity.h"
#include "Protocol.h"

static xpc_object_t PVMakeRequest(int64_t version, const char *operation,
                                  const char *requestID) {
  xpc_object_t request = xpc_dictionary_create(NULL, NULL, 0);
  xpc_dictionary_set_int64(request, "version", version);
  xpc_dictionary_set_string(request, "operation", operation);
  xpc_dictionary_set_string(request, "requestId", requestID);
  return request;
}

static xpc_object_t PVMakeGenesisRequest(const void *confirmation,
                                         size_t confirmationLength,
                                         const void *transcript,
                                         size_t transcriptLength,
                                         const void *authorization,
                                         size_t authorizationLength) {
  xpc_object_t request =
      PVMakeRequest(PV_PROTOCOL_VERSION, "commit_genesis", "request-boundary");
  xpc_dictionary_set_data(request, "recoveryConfirmation", confirmation,
                          confirmationLength);
  xpc_dictionary_set_data(request, "bootstrapTranscript", transcript,
                          transcriptLength);
  xpc_dictionary_set_data(request, "authorization", authorization,
                          authorizationLength);
  return request;
}

int main(void) {
  PVRequest parsed = {0};

  SecRequirementRef clientRequirement = NULL;
  assert(SecRequirementCreateWithString(
             (__bridge CFStringRef) @PV_CLIENT_REQUIREMENT, kSecCSDefaultFlags,
             &clientRequirement) == errSecSuccess);
  assert(clientRequirement != NULL);
  CFRelease(clientRequirement);

  xpc_object_t health =
      PVMakeRequest(PV_PROTOCOL_VERSION, "health", "request_1");
  assert(PVParseRequest(health, &parsed) == PVRequestValid);
  assert(strcmp(parsed.operation, "health") == 0);
  assert(!PVRequestCanRun(&parsed, false));
  assert(PVRequestCanRun(&parsed, true));
  xpc_release(health);

  xpc_object_t lock = PVMakeRequest(PV_PROTOCOL_VERSION, "lock", "request-2");
  assert(PVParseRequest(lock, &parsed) == PVRequestValid);
  assert(!PVRequestCanRun(&parsed, false));
  assert(PVRequestCanRun(&parsed, true));
  xpc_release(lock);

  xpc_object_t unlock =
      PVMakeRequest(PV_PROTOCOL_VERSION, "unlock", "request-unlock");
  xpc_dictionary_set_string(unlock, "vaultId",
                            "00112233445566778899aabbccddeeff");
  assert(PVParseRequest(unlock, &parsed) == PVRequestValid);
  assert(strcmp(parsed.operation, "unlock") == 0);
  assert(strcmp(parsed.vaultID, "00112233445566778899aabbccddeeff") == 0);
  xpc_release(unlock);

  const uint8_t jobBytes[] = {0xa1, 0x01, 0x01};
  xpc_object_t openJob =
      PVMakeRequest(PV_PROTOCOL_VERSION, "open_job", "request-open-job");
  xpc_dictionary_set_string(openJob, "vaultId",
                            "00112233445566778899aabbccddeeff");
  xpc_dictionary_set_string(openJob, "jobId",
                            "ffeeddccbbaa99887766554433221100");
  xpc_dictionary_set_int64(openJob, "epoch", 7);
  xpc_dictionary_set_int64(openJob, "retryCount", 2);
  xpc_dictionary_set_string(openJob, "algorithmId", "anc-v1-job");
  xpc_dictionary_set_data(openJob, "jobEnvelope", jobBytes,
                          sizeof jobBytes);
  assert(PVParseRequest(openJob, &parsed) == PVRequestValid);
  assert(strcmp(parsed.vaultID, "00112233445566778899aabbccddeeff") == 0);
  assert(strcmp(parsed.jobID, "ffeeddccbbaa99887766554433221100") == 0);
  assert(parsed.jobEnvelopeLength == sizeof jobBytes);
  assert(parsed.hostedEpoch == 7 && parsed.hostedRetryCount == 2 &&
         strcmp(parsed.algorithmID, "anc-v1-job") == 0);
  assert(!PVRequestCanRun(&parsed, false) && PVRequestCanRun(&parsed, true));
  xpc_release(openJob);

  xpc_object_t createGrant =
      PVMakeRequest(PV_PROTOCOL_VERSION, "create_grant", "request-grant");
  xpc_dictionary_set_string(createGrant, "vaultId",
                            "00112233445566778899aabbccddeeff");
  xpc_dictionary_set_string(createGrant, "recipientEndpointId",
                            "11112222333344445555666677778888");
  xpc_dictionary_set_string(createGrant, "subjectAgentId",
                            "9999aaaabbbbccccddddeeeeffff0000");
  xpc_dictionary_set_int64(createGrant, "expiresAt", 1721114711);
  assert(PVParseRequest(createGrant, &parsed) == PVRequestValid &&
         strcmp(parsed.recipientEndpointID,
                "11112222333344445555666677778888") == 0 &&
         strcmp(parsed.subjectAgentID,
                "9999aaaabbbbccccddddeeeeffff0000") == 0 &&
         parsed.expiresAt == 1721114711);
  xpc_release(createGrant);

  xpc_object_t revokeGrant =
      PVMakeRequest(PV_PROTOCOL_VERSION, "revoke_grant", "request-revoke");
  xpc_dictionary_set_string(revokeGrant, "vaultId",
                            "00112233445566778899aabbccddeeff");
  xpc_dictionary_set_string(
      revokeGrant, "grantRef",
      "abababababababababababababababababababababababababababababababab");
  assert(PVParseRequest(revokeGrant, &parsed) == PVRequestValid &&
         strcmp(parsed.grantRef,
                "abababababababababababababababababababababababababababababababab") ==
             0);
  xpc_release(revokeGrant);

  xpc_object_t listGrants =
      PVMakeRequest(PV_PROTOCOL_VERSION, "list_grants", "request-list-grants");
  xpc_dictionary_set_string(listGrants, "vaultId",
                            "00112233445566778899aabbccddeeff");
  assert(PVParseRequest(listGrants, &parsed) == PVRequestValid &&
         strcmp(parsed.vaultID, "00112233445566778899aabbccddeeff") == 0);
  xpc_release(listGrants);

  xpc_object_t listMembers =
      PVMakeRequest(PV_PROTOCOL_VERSION, "list_members", "request-list-members");
  xpc_dictionary_set_string(listMembers, "vaultId",
                            "00112233445566778899aabbccddeeff");
  assert(PVParseRequest(listMembers, &parsed) == PVRequestValid &&
         strcmp(parsed.vaultID, "00112233445566778899aabbccddeeff") == 0);
  xpc_release(listMembers);

  xpc_object_t brokerKey =
      PVMakeRequest(PV_PROTOCOL_VERSION, "broker_key", "request-broker-key");
  xpc_dictionary_set_string(brokerKey, "vaultId",
                            "00112233445566778899aabbccddeeff");
  assert(PVParseRequest(brokerKey, &parsed) == PVRequestValid &&
         strcmp(parsed.vaultID, "00112233445566778899aabbccddeeff") == 0);
  xpc_release(brokerKey);

  xpc_object_t sealExport =
      PVMakeRequest(PV_PROTOCOL_VERSION, "seal_export", "request-seal-export");
  xpc_dictionary_set_string(sealExport, "vaultId",
                            "00112233445566778899aabbccddeeff");
  xpc_dictionary_set_string(sealExport, "exportId",
                            "ffeeddccbbaa99887766554433221100");
  xpc_dictionary_set_uint64(sealExport, "createdAt", UINT64_C(1800000000000));
  xpc_dictionary_set_string(
      sealExport, "sourceSnapshotHash",
      "1111111111111111111111111111111111111111111111111111111111111111");
  xpc_dictionary_set_uint64(sealExport, "objectCount", 2);
  xpc_dictionary_set_data(sealExport, "recoveryMnemonic", "phrase", 6);
  xpc_dictionary_set_data(sealExport, "exportPlaintext", "{}", 2);
  assert(PVParseRequest(sealExport, &parsed) == PVRequestValid &&
         strcmp(parsed.exportID, "ffeeddccbbaa99887766554433221100") == 0 &&
         parsed.exportCreatedAt == UINT64_C(1800000000000) &&
         parsed.exportObjectCount == 2 && parsed.exportPlaintextLength == 2 &&
         parsed.recoveryMnemonicLength == 6);
  xpc_release(sealExport);

  xpc_object_t openExport =
      PVMakeRequest(PV_PROTOCOL_VERSION, "open_export", "request-open-export");
  xpc_dictionary_set_string(openExport, "vaultId",
                            "00112233445566778899aabbccddeeff");
  xpc_dictionary_set_data(openExport, "recoveryMnemonic", "phrase", 6);
  xpc_dictionary_set_data(openExport, "exportArchive", "archive", 7);
  assert(PVParseRequest(openExport, &parsed) == PVRequestValid &&
         strcmp(parsed.vaultID, "00112233445566778899aabbccddeeff") == 0 &&
         parsed.exportArchiveLength == 7 &&
         parsed.recoveryMnemonicLength == 6);
  xpc_release(openExport);

  const uint8_t requesterPayload[] = {'{', '}', '\n'};
  xpc_object_t sealJob =
      PVMakeRequest(PV_PROTOCOL_VERSION, "seal_job", "request-seal-job");
  xpc_dictionary_set_string(sealJob, "vaultId",
                            "00112233445566778899aabbccddeeff");
  xpc_dictionary_set_string(sealJob, "jobId",
                            "ffeeddccbbaa99887766554433221100");
  xpc_dictionary_set_string(
      sealJob, "grantRef",
      "abababababababababababababababababababababababababababababababab");
  xpc_dictionary_set_string(sealJob, "recipientEndpointId",
                            "11112222333344445555666677778888");
  xpc_dictionary_set_int64(sealJob, "expiresAt", 1721111711);
  xpc_dictionary_set_data(sealJob, "jobPayload", requesterPayload,
                          sizeof requesterPayload);
  assert(PVParseRequest(sealJob, &parsed) == PVRequestValid &&
         strcmp(parsed.jobID, "ffeeddccbbaa99887766554433221100") == 0 &&
         strcmp(parsed.grantRef,
                "abababababababababababababababababababababababababababababababab") == 0 &&
         parsed.jobPayloadLength == sizeof requesterPayload &&
         parsed.expiresAt == 1721111711);
  xpc_dictionary_set_string(sealJob, "grantRef",
                            "ABABABABABABABABABABABABABABABABABABABABABABABABABABABABABABABAB");
  assert(PVParseRequest(sealJob, &parsed) == PVRequestInvalid);
  xpc_release(sealJob);

  xpc_object_t openResult =
      PVMakeRequest(PV_PROTOCOL_VERSION, "open_result", "request-open-result");
  xpc_dictionary_set_string(openResult, "vaultId",
                            "00112233445566778899aabbccddeeff");
  xpc_dictionary_set_string(openResult, "jobId",
                            "ffeeddccbbaa99887766554433221100");
  xpc_dictionary_set_string(
      openResult, "jobHash",
      "abababababababababababababababababababababababababababababababab");
  xpc_dictionary_set_string(openResult, "senderEndpointId",
                            "11112222333344445555666677778888");
  xpc_dictionary_set_data(openResult, "resultPayload", requesterPayload,
                          sizeof requesterPayload);
  assert(PVParseRequest(openResult, &parsed) == PVRequestValid &&
         strcmp(parsed.senderEndpointID,
                "11112222333344445555666677778888") == 0 &&
         parsed.resultPayloadLength == sizeof requesterPayload);
  xpc_release(openResult);

  xpc_object_t sealResult =
      PVMakeRequest(PV_PROTOCOL_VERSION, "seal_result", "request-seal-result");
  xpc_dictionary_set_string(sealResult, "vaultId",
                            "00112233445566778899aabbccddeeff");
  xpc_dictionary_set_string(sealResult, "jobId",
                            "ffeeddccbbaa99887766554433221100");
  xpc_dictionary_set_string(sealResult, "jobHash",
                            "abababababababababababababababababababababababababababababababab");
  xpc_dictionary_set_string(sealResult, "state", "completed");
  xpc_dictionary_set_data(sealResult, "resultPayload", jobBytes,
                          sizeof jobBytes);
  assert(PVParseRequest(sealResult, &parsed) == PVRequestValid);
  assert(strcmp(parsed.resultState, "completed") == 0 &&
         parsed.resultPayloadLength == sizeof jobBytes);
  xpc_release(sealResult);

  xpc_object_t emptyResult =
      PVMakeRequest(PV_PROTOCOL_VERSION, "seal_result", "request-empty-result");
  xpc_dictionary_set_string(emptyResult, "vaultId",
                            "00112233445566778899aabbccddeeff");
  xpc_dictionary_set_string(emptyResult, "jobId",
                            "ffeeddccbbaa99887766554433221100");
  xpc_dictionary_set_string(emptyResult, "jobHash",
                            "abababababababababababababababababababababababababababababababab");
  xpc_dictionary_set_string(emptyResult, "state", "completed");
  xpc_dictionary_set_data(emptyResult, "resultPayload", jobBytes, 0);
  assert(PVParseRequest(emptyResult, &parsed) == PVRequestValid &&
         parsed.resultPayloadLength == 0);
  xpc_release(emptyResult);

  xpc_object_t completeResult = PVMakeRequest(
      PV_PROTOCOL_VERSION, "complete_result", "request-complete-result");
  xpc_dictionary_set_string(completeResult, "vaultId",
                            "00112233445566778899aabbccddeeff");
  xpc_dictionary_set_string(completeResult, "jobId",
                            "ffeeddccbbaa99887766554433221100");
  xpc_dictionary_set_string(completeResult, "jobHash",
                            "abababababababababababababababababababababababababababababababab");
  xpc_dictionary_set_string(completeResult, "state", "completed");
  assert(PVParseRequest(completeResult, &parsed) == PVRequestValid);
  assert(strcmp(parsed.operation, "complete_result") == 0 &&
         strcmp(parsed.resultState, "completed") == 0 &&
         parsed.resultPayload == NULL && parsed.resultPayloadLength == 0);
  xpc_dictionary_set_data(completeResult, "resultPayload", jobBytes,
                          sizeof jobBytes);
  assert(PVParseRequest(completeResult, &parsed) == PVRequestInvalid);
  xpc_release(completeResult);

  xpc_object_t pendingResult =
      PVMakeRequest(PV_PROTOCOL_VERSION, "pending_result", "request-pending");
  xpc_dictionary_set_string(pendingResult, "vaultId",
                            "00112233445566778899aabbccddeeff");
  assert(PVParseRequest(pendingResult, &parsed) == PVRequestValid &&
         strcmp(parsed.operation, "pending_result") == 0);
  xpc_release(pendingResult);

  xpc_object_t signRequest =
      PVMakeRequest(PV_PROTOCOL_VERSION, "sign_request", "request-sign");
  xpc_dictionary_set_data(signRequest, "unsignedProof", jobBytes,
                          sizeof jobBytes);
  assert(PVParseRequest(signRequest, &parsed) == PVRequestValid &&
         strcmp(parsed.operation, "sign_request") == 0 &&
         parsed.unsignedProofLength == sizeof jobBytes &&
         memcmp(parsed.unsignedProof, jobBytes, sizeof jobBytes) == 0);
  xpc_dictionary_set_string(signRequest, "vaultId",
                            "00112233445566778899aabbccddeeff");
  assert(PVParseRequest(signRequest, &parsed) == PVRequestInvalid);
  xpc_release(signRequest);

  xpc_object_t openJobMissing =
      PVMakeRequest(PV_PROTOCOL_VERSION, "open_job", "request-open-missing");
  xpc_dictionary_set_string(openJobMissing, "vaultId",
                            "00112233445566778899aabbccddeeff");
  xpc_dictionary_set_string(openJobMissing, "jobId",
                            "ffeeddccbbaa99887766554433221100");
  assert(PVParseRequest(openJobMissing, &parsed) == PVRequestInvalid);
  xpc_release(openJobMissing);

  xpc_object_t unlockWithoutVault =
      PVMakeRequest(PV_PROTOCOL_VERSION, "unlock", "request-unlock-missing");
  assert(PVParseRequest(unlockWithoutVault, &parsed) == PVRequestInvalid);
  xpc_release(unlockWithoutVault);

  xpc_object_t resume =
      PVMakeRequest(PV_PROTOCOL_VERSION, "resume_rotation", "request-rotate");
  xpc_dictionary_set_string(resume, "vaultId",
                            "00112233445566778899aabbccddeeff");
  assert(PVParseRequest(resume, &parsed) == PVRequestValid);
  assert(strcmp(parsed.operation, "resume_rotation") == 0);
  assert(strcmp(parsed.vaultID, "00112233445566778899aabbccddeeff") == 0);
  assert(!PVRequestCanRun(&parsed, false));
  assert(PVRequestCanRun(&parsed, true));
  xpc_release(resume);

  const uint8_t bootstrapBytes[] = {0x00, 0x00, 0x00, 0x02, '{', '}'};
  xpc_object_t bootstrap = PVMakeRequest(
      PV_PROTOCOL_VERSION, "accept_bootstrap", "request-bootstrap");
  xpc_dictionary_set_data(bootstrap, "bootstrapFrame", bootstrapBytes,
                          sizeof bootstrapBytes);
  assert(PVParseRequest(bootstrap, &parsed) == PVRequestValid);
  assert(strcmp(parsed.operation, "accept_bootstrap") == 0);
  assert(parsed.bootstrapFrameLength == sizeof bootstrapBytes);
  assert(memcmp(parsed.bootstrapFrame, bootstrapBytes,
                sizeof bootstrapBytes) == 0);
  assert(!PVRequestCanRun(&parsed, false));
  assert(PVRequestCanRun(&parsed, true));
  xpc_release(bootstrap);

  const uint8_t recoveryMnemonicBytes[] = {'a', 'b', 'a', 'n',
                                            'd', 'o', 'n'};
  xpc_object_t recoverBegin = PVMakeRequest(
      PV_PROTOCOL_VERSION, "recover_begin", "request-recover-begin");
  xpc_dictionary_set_data(recoverBegin, "bootstrapFrame", bootstrapBytes,
                          sizeof bootstrapBytes);
  xpc_dictionary_set_data(recoverBegin, "recoveryMnemonic",
                          recoveryMnemonicBytes,
                          sizeof recoveryMnemonicBytes);
  assert(PVParseRequest(recoverBegin, &parsed) == PVRequestValid);
  assert(strcmp(parsed.operation, "recover_begin") == 0);
  assert(parsed.bootstrapFrameLength == sizeof bootstrapBytes);
  assert(parsed.recoveryMnemonicLength == sizeof recoveryMnemonicBytes);
  assert(!PVRequestCanRun(&parsed, false));
  assert(PVRequestCanRun(&parsed, true));
  xpc_release(recoverBegin);

  xpc_object_t recoverPage = PVMakeRequest(
      PV_PROTOCOL_VERSION, "recover_page", "request-recover-page");
  xpc_dictionary_set_data(recoverPage, "bootstrapFrame", bootstrapBytes,
                          sizeof bootstrapBytes);
  assert(PVParseRequest(recoverPage, &parsed) == PVRequestValid);
  assert(strcmp(parsed.operation, "recover_page") == 0);
  assert(parsed.bootstrapFrameLength == sizeof bootstrapBytes);
  assert(parsed.recoveryMnemonic == NULL);
  assert(!PVRequestCanRun(&parsed, false));
  assert(PVRequestCanRun(&parsed, true));
  xpc_release(recoverPage);

  xpc_object_t recoveryStatus = PVMakeRequest(
      PV_PROTOCOL_VERSION, "recover_status", "request-recover-status");
  xpc_dictionary_set_string(recoveryStatus, "vaultId",
                            "31313131313131313131313131313131");
  assert(PVParseRequest(recoveryStatus, &parsed) == PVRequestValid);
  assert(strcmp(parsed.operation, "recover_status") == 0);
  assert(strcmp(parsed.vaultID, "31313131313131313131313131313131") == 0);
  xpc_release(recoveryStatus);

  xpc_object_t missingRecoveryPhrase = PVMakeRequest(
      PV_PROTOCOL_VERSION, "recover_begin", "request-recover-missing");
  xpc_dictionary_set_data(missingRecoveryPhrase, "bootstrapFrame",
                          bootstrapBytes, sizeof bootstrapBytes);
  assert(PVParseRequest(missingRecoveryPhrase, &parsed) == PVRequestInvalid);
  xpc_release(missingRecoveryPhrase);

  xpc_object_t extraRecoveryPhrase = PVMakeRequest(
      PV_PROTOCOL_VERSION, "recover_page", "request-recover-extra");
  xpc_dictionary_set_data(extraRecoveryPhrase, "bootstrapFrame",
                          bootstrapBytes, sizeof bootstrapBytes);
  xpc_dictionary_set_data(extraRecoveryPhrase, "recoveryMnemonic",
                          recoveryMnemonicBytes,
                          sizeof recoveryMnemonicBytes);
  assert(PVParseRequest(extraRecoveryPhrase, &parsed) == PVRequestInvalid);
  xpc_release(extraRecoveryPhrase);

  xpc_object_t missingBootstrap = PVMakeRequest(
      PV_PROTOCOL_VERSION, "accept_bootstrap", "request-bootstrap-missing");
  assert(PVParseRequest(missingBootstrap, &parsed) == PVRequestInvalid);
  xpc_release(missingBootstrap);

  xpc_object_t wrongBootstrap = PVMakeRequest(
      PV_PROTOCOL_VERSION, "accept_bootstrap", "request-bootstrap-type");
  xpc_dictionary_set_string(wrongBootstrap, "bootstrapFrame", "wrong");
  assert(PVParseRequest(wrongBootstrap, &parsed) == PVRequestInvalid);
  xpc_release(wrongBootstrap);

  uint8_t *oversizedBootstrap =
      calloc(PV_BOOTSTRAP_FRAME_MAXIMUM_BYTES + 1, sizeof(uint8_t));
  assert(oversizedBootstrap != NULL);
  xpc_object_t oversizedBootstrapRequest = PVMakeRequest(
      PV_PROTOCOL_VERSION, "accept_bootstrap", "request-bootstrap-large");
  xpc_dictionary_set_data(oversizedBootstrapRequest, "bootstrapFrame",
                          oversizedBootstrap,
                          PV_BOOTSTRAP_FRAME_MAXIMUM_BYTES + 1);
  assert(PVParseRequest(oversizedBootstrapRequest, &parsed) ==
         PVRequestInvalid);
  xpc_release(oversizedBootstrapRequest);
  free(oversizedBootstrap);

  const uint8_t confirmationBytes[] = {0x01};
  const uint8_t transcriptBytes[] = {0x02};
  const uint8_t authorizationBytes[] = {0x03};
  xpc_object_t genesis =
      PVMakeRequest(PV_PROTOCOL_VERSION, "commit_genesis", "request-genesis");
  xpc_dictionary_set_data(genesis, "recoveryConfirmation", confirmationBytes,
                          sizeof confirmationBytes);
  xpc_dictionary_set_data(genesis, "bootstrapTranscript", transcriptBytes,
                          sizeof transcriptBytes);
  xpc_dictionary_set_data(genesis, "authorization", authorizationBytes,
                          sizeof authorizationBytes);
  assert(PVParseRequest(genesis, &parsed) == PVRequestValid);
  assert(strcmp(parsed.operation, "commit_genesis") == 0);
  assert(parsed.recoveryConfirmationLength == 1);
  assert(parsed.bootstrapTranscriptLength == 1);
  assert(parsed.authorizationLength == 1);
  assert(memcmp(parsed.recoveryConfirmation, confirmationBytes, 1) == 0);
  assert(!PVRequestCanRun(&parsed, false));
  assert(PVRequestCanRun(&parsed, true));
  xpc_release(genesis);

  xpc_object_t prepareGenesis = PVMakeRequest(
      PV_PROTOCOL_VERSION, "prepare_genesis", "request-prepare-genesis");
  assert(PVParseRequest(prepareGenesis, &parsed) == PVRequestValid);
  xpc_release(prepareGenesis);
  xpc_object_t listGenesis = PVMakeRequest(
      PV_PROTOCOL_VERSION, "list_genesis", "request-list-genesis");
  assert(PVParseRequest(listGenesis, &parsed) == PVRequestValid);
  xpc_release(listGenesis);

  const char *lookupID = "11223344556677889900aabbccddeeff";
  const uint8_t mnemonicBytes[] = "abandon abandon abandon";
  const uint8_t challengeBytes[] = {0xa1, 0x01, 0x01};
  const uint8_t receiptBytes[] = {0xa1, 0x01, 0x02};
  xpc_object_t confirmGenesis = PVMakeRequest(
      PV_PROTOCOL_VERSION, "confirm_genesis", "request-confirm-genesis");
  xpc_dictionary_set_string(confirmGenesis, "lookupId", lookupID);
  xpc_dictionary_set_data(confirmGenesis, "recoveryMnemonic", mnemonicBytes,
                          sizeof mnemonicBytes - 1);
  assert(PVParseRequest(confirmGenesis, &parsed) == PVRequestValid);
  assert(strcmp(parsed.lookupID, lookupID) == 0 &&
         parsed.recoveryMnemonicLength == sizeof mnemonicBytes - 1);
  xpc_release(confirmGenesis);

  const char *challengeOperations[] = {"inspect_admit", "authorize_admit"};
  for (size_t index = 0; index < 2; index += 1) {
    xpc_object_t challengeRequest =
        PVMakeRequest(PV_PROTOCOL_VERSION, challengeOperations[index],
                      "request-admission-challenge");
    xpc_dictionary_set_string(challengeRequest, "lookupId", lookupID);
    xpc_dictionary_set_data(challengeRequest, "challenge", challengeBytes,
                            sizeof challengeBytes);
    assert(PVParseRequest(challengeRequest, &parsed) == PVRequestValid);
    assert(strcmp(parsed.lookupID, lookupID) == 0 &&
           parsed.challengeLength == sizeof challengeBytes);
    xpc_release(challengeRequest);
  }

  xpc_object_t acceptAdmission = PVMakeRequest(
      PV_PROTOCOL_VERSION, "accept_admit", "request-accept-admission");
  xpc_dictionary_set_string(acceptAdmission, "lookupId", lookupID);
  xpc_dictionary_set_data(acceptAdmission, "challenge", challengeBytes,
                          sizeof challengeBytes);
  xpc_dictionary_set_data(acceptAdmission, "receipt", receiptBytes,
                          sizeof receiptBytes);
  assert(PVParseRequest(acceptAdmission, &parsed) == PVRequestValid);
  assert(parsed.challengeLength == sizeof challengeBytes &&
         parsed.receiptLength == sizeof receiptBytes);
  xpc_release(acceptAdmission);

  xpc_object_t finalizeGenesis = PVMakeRequest(
      PV_PROTOCOL_VERSION, "finalize_genesis", "request-finalize-genesis");
  xpc_dictionary_set_string(finalizeGenesis, "lookupId", lookupID);
  xpc_dictionary_set_data(finalizeGenesis, "receipt", receiptBytes,
                          sizeof receiptBytes);
  assert(PVParseRequest(finalizeGenesis, &parsed) == PVRequestValid);
  assert(parsed.receiptLength == sizeof receiptBytes);
  xpc_release(finalizeGenesis);

  const char *enrollmentVault = "00112233445566778899aabbccddeeff";
  const char *ceremonyToken = "ffeeddccbbaa00998877665544332211";
  const uint8_t enrollmentOffer[] = {0xa1, 0x01, 0x01};
  const uint8_t enrollmentCandidateKeyProof[64] = {0x02};
  const uint8_t enrollmentChallenge[] = {0xa1, 0x01, 0x03};
  const uint8_t enrollmentSasDecision[] = {0xa1, 0x01, 0x05};
  const uint8_t enrollmentAuthorization[] = {0xa1, 0x01, 0x04};
  xpc_object_t prepareEnrollment = PVMakeRequest(
      PV_PROTOCOL_VERSION, "prepare_enroll", "request-prepare-enroll");
  xpc_dictionary_set_string(prepareEnrollment, "vaultId", enrollmentVault);
  assert(PVParseRequest(prepareEnrollment, &parsed) == PVRequestValid &&
         strcmp(parsed.vaultID, enrollmentVault) == 0);
  xpc_release(prepareEnrollment);

  xpc_object_t enrollmentBootstrap = PVMakeRequest(
      PV_PROTOCOL_VERSION, "enroll_page", "request-enroll-page");
  xpc_dictionary_set_string(enrollmentBootstrap, "vaultId", enrollmentVault);
  xpc_dictionary_set_data(enrollmentBootstrap, "bootstrapFrame",
                          bootstrapBytes, sizeof bootstrapBytes);
  assert(PVParseRequest(enrollmentBootstrap, &parsed) == PVRequestValid &&
         strcmp(parsed.operation, "enroll_page") == 0 &&
         strcmp(parsed.vaultID, enrollmentVault) == 0 &&
         parsed.bootstrapFrameLength == sizeof bootstrapBytes);
  assert(!PVRequestCanRun(&parsed, false));
  assert(PVRequestCanRun(&parsed, true));
  xpc_release(enrollmentBootstrap);

  xpc_object_t challengeEnrollment = PVMakeRequest(
      PV_PROTOCOL_VERSION, "challenge_enroll", "request-challenge-enroll");
  xpc_dictionary_set_string(challengeEnrollment, "vaultId", enrollmentVault);
  xpc_dictionary_set_data(challengeEnrollment, "offer", enrollmentOffer,
                          sizeof enrollmentOffer);
  xpc_dictionary_set_data(challengeEnrollment, "candidateKeyProof",
                          enrollmentCandidateKeyProof,
                          sizeof enrollmentCandidateKeyProof);
  assert(PVParseRequest(challengeEnrollment, &parsed) == PVRequestValid &&
         strcmp(parsed.vaultID, enrollmentVault) == 0 &&
         parsed.enrollmentOfferLength == sizeof enrollmentOffer &&
         parsed.enrollmentCandidateKeyProofLength ==
             sizeof enrollmentCandidateKeyProof);
  xpc_release(challengeEnrollment);

  xpc_object_t inspectEnrollment = PVMakeRequest(
      PV_PROTOCOL_VERSION, "inspect_enroll", "request-inspect-enroll");
  xpc_dictionary_set_string(inspectEnrollment, "vaultId", enrollmentVault);
  xpc_dictionary_set_data(inspectEnrollment, "challenge",
                          enrollmentChallenge,
                          sizeof enrollmentChallenge);
  assert(PVParseRequest(inspectEnrollment, &parsed) == PVRequestValid &&
         parsed.enrollmentChallengeLength == sizeof enrollmentChallenge);
  xpc_release(inspectEnrollment);

  xpc_object_t authorizeEnrollment = PVMakeRequest(
      PV_PROTOCOL_VERSION, "authorize_enroll", "request-authorize-enroll");
  xpc_dictionary_set_string(authorizeEnrollment, "vaultId", enrollmentVault);
  xpc_dictionary_set_data(authorizeEnrollment, "offer", enrollmentOffer,
                          sizeof enrollmentOffer);
  xpc_dictionary_set_data(authorizeEnrollment, "challenge",
                          enrollmentChallenge,
                          sizeof enrollmentChallenge);
  xpc_dictionary_set_data(authorizeEnrollment, "sasDecision",
                          enrollmentSasDecision,
                          sizeof enrollmentSasDecision);
  assert(PVParseRequest(authorizeEnrollment, &parsed) == PVRequestValid &&
         parsed.enrollmentChallengeLength == sizeof enrollmentChallenge &&
         parsed.enrollmentSasDecisionLength == sizeof enrollmentSasDecision);
  xpc_release(authorizeEnrollment);

  for (size_t index = 0; index < 2; index += 1) {
    xpc_object_t decideEnrollment = PVMakeRequest(
        PV_PROTOCOL_VERSION, "decide_enroll", "request-decide-enroll");
    xpc_dictionary_set_string(decideEnrollment, "ceremonyToken",
                              ceremonyToken);
    xpc_dictionary_set_string(decideEnrollment, "decision",
                              index == 0 ? "confirmed" : "mismatch");
    assert(PVParseRequest(decideEnrollment, &parsed) == PVRequestValid &&
           strcmp(parsed.ceremonyToken, ceremonyToken) == 0);
    xpc_release(decideEnrollment);
  }

  xpc_object_t activateEnrollment = PVMakeRequest(
      PV_PROTOCOL_VERSION, "activate_enroll", "request-activate-enroll");
  xpc_dictionary_set_string(activateEnrollment, "vaultId", enrollmentVault);
  xpc_dictionary_set_data(activateEnrollment, "challenge",
                          enrollmentChallenge,
                          sizeof enrollmentChallenge);
  xpc_dictionary_set_data(activateEnrollment, "authorization",
                          enrollmentAuthorization,
                          sizeof enrollmentAuthorization);
  assert(PVParseRequest(activateEnrollment, &parsed) == PVRequestValid &&
         parsed.enrollmentAuthorizationLength ==
             sizeof enrollmentAuthorization);
  xpc_release(activateEnrollment);

  const char *objectID = "11223344556677889900aabbccddeeff";
  const char *contentType =
      "application/vnd.agent-native.content-document+json";
  const uint8_t objectPlaintext[] = {'{', '}', '\n'};
  const uint8_t objectCiphertext[] = {0xa4, 0x01, 0x02, 0x03};
  xpc_object_t sealObject =
      PVMakeRequest(PV_PROTOCOL_VERSION, "seal_object", "request-seal-object");
  xpc_dictionary_set_string(sealObject, "vaultId", enrollmentVault);
  xpc_dictionary_set_string(sealObject, "objectId", objectID);
  xpc_dictionary_set_int64(sealObject, "revision", 4);
  xpc_dictionary_set_string(sealObject, "contentType", contentType);
  xpc_dictionary_set_data(sealObject, "objectPayload", objectPlaintext,
                          sizeof objectPlaintext);
  assert(PVParseRequest(sealObject, &parsed) == PVRequestValid &&
         strcmp(parsed.objectID, objectID) == 0 &&
         parsed.objectRevision == 4 &&
         strcmp(parsed.objectContentType, contentType) == 0 &&
         parsed.objectPayloadLength == sizeof objectPlaintext);
  xpc_release(sealObject);

  const char *manifestContentType =
      "application/vnd.agent-native.content-vault-manifest+json";
  xpc_object_t sealManifest =
      PVMakeRequest(PV_PROTOCOL_VERSION, "seal_object", "request-seal-manifest");
  xpc_dictionary_set_string(sealManifest, "vaultId", enrollmentVault);
  xpc_dictionary_set_string(sealManifest, "objectId", objectID);
  xpc_dictionary_set_int64(sealManifest, "revision", 5);
  xpc_dictionary_set_string(sealManifest, "contentType", manifestContentType);
  xpc_dictionary_set_data(sealManifest, "objectPayload", objectPlaintext,
                          sizeof objectPlaintext);
  assert(PVParseRequest(sealManifest, &parsed) == PVRequestValid &&
         strcmp(parsed.objectContentType, manifestContentType) == 0);
  xpc_release(sealManifest);

  xpc_object_t openObject =
      PVMakeRequest(PV_PROTOCOL_VERSION, "open_object", "request-open-object");
  xpc_dictionary_set_string(openObject, "vaultId", enrollmentVault);
  xpc_dictionary_set_string(openObject, "objectId", objectID);
  xpc_dictionary_set_int64(openObject, "revision", 4);
  xpc_dictionary_set_data(openObject, "objectPayload", objectCiphertext,
                          sizeof objectCiphertext);
  assert(PVParseRequest(openObject, &parsed) == PVRequestValid &&
         strcmp(parsed.objectID, objectID) == 0 &&
         parsed.objectRevision == 4 &&
         parsed.objectContentType == NULL &&
         parsed.objectPayloadLength == sizeof objectCiphertext);
  xpc_release(openObject);

  const char *objectJobID = "ffeeddccbbaa99887766554433221100";
  const char *objectJobHash =
      "abababababababababababababababababababababababababababababababab";
  xpc_object_t sealJobObject = PVMakeRequest(
      PV_PROTOCOL_VERSION, "seal_job_object", "request-seal-job-object");
  xpc_dictionary_set_string(sealJobObject, "vaultId", enrollmentVault);
  xpc_dictionary_set_string(sealJobObject, "jobId", objectJobID);
  xpc_dictionary_set_string(sealJobObject, "jobHash", objectJobHash);
  xpc_dictionary_set_string(sealJobObject, "objectId", objectID);
  xpc_dictionary_set_int64(sealJobObject, "revision", 5);
  xpc_dictionary_set_string(sealJobObject, "contentType", contentType);
  xpc_dictionary_set_data(sealJobObject, "objectPayload", objectPlaintext,
                          sizeof objectPlaintext);
  assert(PVParseRequest(sealJobObject, &parsed) == PVRequestValid &&
         strcmp(parsed.jobID, objectJobID) == 0 &&
         strcmp(parsed.jobHash, objectJobHash) == 0 &&
         parsed.objectRevision == 5);
  xpc_release(sealJobObject);

  xpc_object_t openJobObject = PVMakeRequest(
      PV_PROTOCOL_VERSION, "open_job_object", "request-open-job-object");
  xpc_dictionary_set_string(openJobObject, "vaultId", enrollmentVault);
  xpc_dictionary_set_string(openJobObject, "jobId", objectJobID);
  xpc_dictionary_set_string(openJobObject, "jobHash", objectJobHash);
  xpc_dictionary_set_string(openJobObject, "objectId", objectID);
  xpc_dictionary_set_int64(openJobObject, "revision", 5);
  xpc_dictionary_set_data(openJobObject, "objectPayload", objectCiphertext,
                          sizeof objectCiphertext);
  assert(PVParseRequest(openJobObject, &parsed) == PVRequestValid &&
         strcmp(parsed.jobID, objectJobID) == 0 &&
         strcmp(parsed.jobHash, objectJobHash) == 0 &&
         parsed.objectContentType == NULL);
  xpc_release(openJobObject);

  xpc_object_t missingJobHash = PVMakeRequest(
      PV_PROTOCOL_VERSION, "open_job_object", "request-job-object-hash");
  xpc_dictionary_set_string(missingJobHash, "vaultId", enrollmentVault);
  xpc_dictionary_set_string(missingJobHash, "jobId", objectJobID);
  xpc_dictionary_set_string(missingJobHash, "objectId", objectID);
  xpc_dictionary_set_int64(missingJobHash, "revision", 5);
  xpc_dictionary_set_data(missingJobHash, "objectPayload", objectCiphertext,
                          sizeof objectCiphertext);
  assert(PVParseRequest(missingJobHash, &parsed) == PVRequestInvalid);
  xpc_release(missingJobHash);

  xpc_object_t forgedObjectType =
      PVMakeRequest(PV_PROTOCOL_VERSION, "seal_object", "request-object-type");
  xpc_dictionary_set_string(forgedObjectType, "vaultId", enrollmentVault);
  xpc_dictionary_set_string(forgedObjectType, "objectId", objectID);
  xpc_dictionary_set_int64(forgedObjectType, "revision", 1);
  xpc_dictionary_set_string(forgedObjectType, "contentType", "text/plain");
  xpc_dictionary_set_data(forgedObjectType, "objectPayload", objectPlaintext,
                          sizeof objectPlaintext);
  assert(PVParseRequest(forgedObjectType, &parsed) == PVRequestInvalid);
  xpc_release(forgedObjectType);

  xpc_object_t openObjectWithType = PVMakeRequest(
      PV_PROTOCOL_VERSION, "open_object", "request-open-object-type");
  xpc_dictionary_set_string(openObjectWithType, "vaultId", enrollmentVault);
  xpc_dictionary_set_string(openObjectWithType, "objectId", objectID);
  xpc_dictionary_set_int64(openObjectWithType, "revision", 1);
  xpc_dictionary_set_string(openObjectWithType, "contentType", contentType);
  xpc_dictionary_set_data(openObjectWithType, "objectPayload", objectCiphertext,
                          sizeof objectCiphertext);
  assert(PVParseRequest(openObjectWithType, &parsed) == PVRequestInvalid);
  xpc_release(openObjectWithType);

  xpc_object_t unsafeObjectRevision = PVMakeRequest(
      PV_PROTOCOL_VERSION, "open_object", "request-unsafe-object-revision");
  xpc_dictionary_set_string(unsafeObjectRevision, "vaultId", enrollmentVault);
  xpc_dictionary_set_string(unsafeObjectRevision, "objectId", objectID);
  xpc_dictionary_set_int64(unsafeObjectRevision, "revision",
                           INT64_C(9007199254740992));
  xpc_dictionary_set_data(unsafeObjectRevision, "objectPayload",
                          objectCiphertext, sizeof objectCiphertext);
  assert(PVParseRequest(unsafeObjectRevision, &parsed) == PVRequestInvalid);
  xpc_release(unsafeObjectRevision);

  xpc_object_t uppercaseObject = PVMakeRequest(
      PV_PROTOCOL_VERSION, "seal_object", "request-uppercase-object");
  xpc_dictionary_set_string(uppercaseObject, "vaultId", enrollmentVault);
  xpc_dictionary_set_string(uppercaseObject, "objectId",
                            "11223344556677889900AABBCCDDEEFF");
  xpc_dictionary_set_int64(uppercaseObject, "revision", 1);
  xpc_dictionary_set_string(uppercaseObject, "contentType", contentType);
  xpc_dictionary_set_data(uppercaseObject, "objectPayload", objectPlaintext,
                          sizeof objectPlaintext);
  assert(PVParseRequest(uppercaseObject, &parsed) == PVRequestInvalid);
  xpc_release(uppercaseObject);

  xpc_object_t emptyObject =
      PVMakeRequest(PV_PROTOCOL_VERSION, "seal_object", "request-empty-object");
  xpc_dictionary_set_string(emptyObject, "vaultId", enrollmentVault);
  xpc_dictionary_set_string(emptyObject, "objectId", objectID);
  xpc_dictionary_set_int64(emptyObject, "revision", 1);
  xpc_dictionary_set_string(emptyObject, "contentType", contentType);
  xpc_dictionary_set_data(emptyObject, "objectPayload", objectPlaintext, 0);
  assert(PVParseRequest(emptyObject, &parsed) == PVRequestInvalid);
  xpc_release(emptyObject);

  xpc_object_t forgedDecision = PVMakeRequest(
      PV_PROTOCOL_VERSION, "decide_enroll", "request-forged-enroll");
  xpc_dictionary_set_string(forgedDecision, "ceremonyToken", ceremonyToken);
  xpc_dictionary_set_string(forgedDecision, "decision", "confirmed-ish");
  assert(PVParseRequest(forgedDecision, &parsed) == PVRequestInvalid);
  xpc_release(forgedDecision);

  xpc_object_t missingAdmissionReceipt = PVMakeRequest(
      PV_PROTOCOL_VERSION, "accept_admit", "request-missing-receipt");
  xpc_dictionary_set_string(missingAdmissionReceipt, "lookupId", lookupID);
  xpc_dictionary_set_data(missingAdmissionReceipt, "challenge", challengeBytes,
                          sizeof challengeBytes);
  assert(PVParseRequest(missingAdmissionReceipt, &parsed) == PVRequestInvalid);
  xpc_release(missingAdmissionReceipt);

  xpc_object_t missingGenesisBlob =
      PVMakeRequest(PV_PROTOCOL_VERSION, "commit_genesis", "request-missing");
  xpc_dictionary_set_data(missingGenesisBlob, "recoveryConfirmation",
                          confirmationBytes, sizeof confirmationBytes);
  xpc_dictionary_set_data(missingGenesisBlob, "bootstrapTranscript",
                          transcriptBytes, sizeof transcriptBytes);
  assert(PVParseRequest(missingGenesisBlob, &parsed) == PVRequestInvalid);
  xpc_release(missingGenesisBlob);

  xpc_object_t wrongGenesisType =
      PVMakeRequest(PV_PROTOCOL_VERSION, "commit_genesis", "request-type");
  xpc_dictionary_set_string(wrongGenesisType, "recoveryConfirmation", "x");
  xpc_dictionary_set_data(wrongGenesisType, "bootstrapTranscript",
                          transcriptBytes, sizeof transcriptBytes);
  xpc_dictionary_set_data(wrongGenesisType, "authorization",
                          authorizationBytes, sizeof authorizationBytes);
  assert(PVParseRequest(wrongGenesisType, &parsed) == PVRequestInvalid);
  xpc_release(wrongGenesisType);

  struct {
    const char *field;
    size_t maximumLength;
  } genesisBoundaries[] = {
      {"recoveryConfirmation", PV_GENESIS_CONFIRMATION_MAXIMUM_BYTES},
      {"bootstrapTranscript", PV_GENESIS_TRANSCRIPT_MAXIMUM_BYTES},
      {"authorization", PV_GENESIS_AUTHORIZATION_MAXIMUM_BYTES},
  };
  for (size_t index = 0;
       index < sizeof genesisBoundaries / sizeof genesisBoundaries[0];
       index += 1) {
    const size_t maximum = genesisBoundaries[index].maximumLength;
    uint8_t *boundaryBytes = calloc(maximum + 1, sizeof(uint8_t));
    assert(boundaryBytes != NULL);

    const void *fields[] = {confirmationBytes, transcriptBytes,
                            authorizationBytes};
    size_t lengths[] = {sizeof confirmationBytes, sizeof transcriptBytes,
                        sizeof authorizationBytes};
    fields[index] = boundaryBytes;
    lengths[index] = 0;
    xpc_object_t zero = PVMakeGenesisRequest(
        fields[0], lengths[0], fields[1], lengths[1], fields[2], lengths[2]);
    assert(PVParseRequest(zero, &parsed) == PVRequestInvalid);
    xpc_release(zero);

    lengths[index] = 1;
    xpc_object_t wrongType = PVMakeGenesisRequest(
        fields[0], lengths[0], fields[1], lengths[1], fields[2], lengths[2]);
    xpc_dictionary_set_string(wrongType, genesisBoundaries[index].field,
                              "wrong-type");
    assert(PVParseRequest(wrongType, &parsed) == PVRequestInvalid);
    xpc_release(wrongType);

    lengths[index] = maximum;
    xpc_object_t exactMaximum = PVMakeGenesisRequest(
        fields[0], lengths[0], fields[1], lengths[1], fields[2], lengths[2]);
    assert(PVParseRequest(exactMaximum, &parsed) == PVRequestValid);
    xpc_release(exactMaximum);

    lengths[index] = maximum + 1;
    xpc_object_t oversized = PVMakeGenesisRequest(
        fields[0], lengths[0], fields[1], lengths[1], fields[2], lengths[2]);
    assert(PVParseRequest(oversized, &parsed) == PVRequestInvalid);
    xpc_release(oversized);

    free(boundaryBytes);
  }

  xpc_object_t genesisWithVault =
      PVMakeRequest(PV_PROTOCOL_VERSION, "commit_genesis", "request-vault");
  xpc_dictionary_set_data(genesisWithVault, "recoveryConfirmation",
                          confirmationBytes, sizeof confirmationBytes);
  xpc_dictionary_set_data(genesisWithVault, "bootstrapTranscript",
                          transcriptBytes, sizeof transcriptBytes);
  xpc_dictionary_set_data(genesisWithVault, "authorization",
                          authorizationBytes, sizeof authorizationBytes);
  xpc_dictionary_set_string(genesisWithVault, "vaultId",
                            "00112233445566778899aabbccddeeff");
  assert(PVParseRequest(genesisWithVault, &parsed) == PVRequestInvalid);
  xpc_release(genesisWithVault);

  xpc_object_t missingVault = PVMakeRequest(
      PV_PROTOCOL_VERSION, "resume_rotation", "request-missing-vault");
  assert(PVParseRequest(missingVault, &parsed) == PVRequestInvalid);
  xpc_release(missingVault);

  xpc_object_t invalidVault = PVMakeRequest(
      PV_PROTOCOL_VERSION, "resume_rotation", "request-invalid-vault");
  xpc_dictionary_set_string(invalidVault, "vaultId",
                            "00112233445566778899AABBCCDDEEFF");
  assert(PVParseRequest(invalidVault, &parsed) == PVRequestInvalid);
  xpc_release(invalidVault);

  xpc_object_t healthWithVault =
      PVMakeRequest(PV_PROTOCOL_VERSION, "health", "request-extra-vault");
  xpc_dictionary_set_string(healthWithVault, "vaultId",
                            "00112233445566778899aabbccddeeff");
  assert(PVParseRequest(healthWithVault, &parsed) == PVRequestInvalid);
  xpc_release(healthWithVault);

  xpc_object_t wrongVersion = PVMakeRequest(1, "health", "request_3");
  assert(PVParseRequest(wrongVersion, &parsed) == PVRequestUnsupportedVersion);
  xpc_release(wrongVersion);

  xpc_object_t unknown =
      PVMakeRequest(PV_PROTOCOL_VERSION, "derive_key", "request_4");
  assert(PVParseRequest(unknown, &parsed) == PVRequestUnsupportedOperation);
  xpc_release(unknown);

  xpc_object_t extra =
      PVMakeRequest(PV_PROTOCOL_VERSION, "health", "request_5");
  xpc_dictionary_set_data(extra, "payload", "secret", 6);
  assert(PVParseRequest(extra, &parsed) == PVRequestInvalid);
  xpc_release(extra);

  xpc_object_t missing = xpc_dictionary_create(NULL, NULL, 0);
  xpc_dictionary_set_int64(missing, "version", PV_PROTOCOL_VERSION);
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
      PVMakeRequest(PV_PROTOCOL_VERSION, oversizedOperation, "request_7");
  assert(PVParseRequest(longOperation, &parsed) == PVRequestInvalid);
  xpc_release(longOperation);

  char oversizedID[PV_MAXIMUM_REQUEST_ID_BYTES + 2];
  memset(oversizedID, 'a', sizeof(oversizedID) - 1);
  oversizedID[sizeof(oversizedID) - 1] = '\0';
  xpc_object_t longID =
      PVMakeRequest(PV_PROTOCOL_VERSION, "health", oversizedID);
  assert(PVParseRequest(longID, &parsed) == PVRequestInvalid);
  xpc_release(longID);

  xpc_object_t invalidID =
      PVMakeRequest(PV_PROTOCOL_VERSION, "health", "not allowed");
  assert(PVParseRequest(invalidID, &parsed) == PVRequestInvalid);
  xpc_release(invalidID);

  assert(PVParseRequest(XPC_BOOL_TRUE, &parsed) == PVRequestInvalid);
  xpc_object_t nullTarget =
      PVMakeRequest(PV_PROTOCOL_VERSION, "health", "request_8");
  assert(PVParseRequest(nullTarget, NULL) == PVRequestInvalid);
  assert(!PVRequestCanRun(NULL, true));
  xpc_release(nullTarget);

  puts("private-vault-service protocol tests passed");
  return 0;
}
