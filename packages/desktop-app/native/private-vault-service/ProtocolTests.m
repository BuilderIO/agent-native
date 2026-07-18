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
      PVMakeRequest(PV_PROTOCOL_VERSION, "unlock", "request_4");
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
