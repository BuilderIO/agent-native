#import "PrivateVaultGenesisAuthorizationInternal.h"
#import "PrivateVaultRecoveryBuilderInternal.h"

/* Rotation-only test binaries link AuthorityStore but never exercise genesis
 * or recovery evidence construction. Keep those unrelated, large ceremony
 * graphs out of this focused binary while preserving fail-closed behavior. */
BOOL AncPrivateVaultGenesisAuthorizationResultCopyEvidence(
    AncPrivateVaultGenesisAuthorizationResult *result,
    NSData **vaultId, NSData **ceremonyId, NSData **endpointId,
    NSData **endpointSigningPublicKey, NSData **endpointKeyAgreementPublicKey,
    NSData **enrollmentRef, NSData **recoveryId,
    NSData **recoverySigningPublicKey,
    NSData **recoveryKeyAgreementPublicKey, NSData **recoveryWrapHash,
    NSData **authorizationDigest, NSData **signedGenesisCommit,
    NSData **bootstrapTranscriptDigest) {
  (void)result;
  *vaultId = nil;
  *ceremonyId = nil;
  *endpointId = nil;
  *endpointSigningPublicKey = nil;
  *endpointKeyAgreementPublicKey = nil;
  *enrollmentRef = nil;
  *recoveryId = nil;
  *recoverySigningPublicKey = nil;
  *recoveryKeyAgreementPublicKey = nil;
  *recoveryWrapHash = nil;
  *authorizationDigest = nil;
  *signedGenesisCommit = nil;
  *bootstrapTranscriptDigest = nil;
  return NO;
}

BOOL AncPrivateVaultPreparedRecoveryArtifactsCopyEvidence(
    AncPrivateVaultPreparedRecoveryArtifacts *artifacts,
    AncPrivateVaultControlLogState **currentState,
    AncPrivateVaultControlLogState **nextState, NSData **entryHash,
    NSData **authorizationHash, NSData **ceremonyId,
    NSData **candidateEndpointId, NSData **candidateSigningPublicKey,
    NSData **candidateKeyAgreementPublicKey) {
  (void)artifacts;
  if (currentState != NULL)
    *currentState = nil;
  if (nextState != NULL)
    *nextState = nil;
  if (entryHash != NULL)
    *entryHash = nil;
  if (authorizationHash != NULL)
    *authorizationHash = nil;
  if (ceremonyId != NULL)
    *ceremonyId = nil;
  if (candidateEndpointId != NULL)
    *candidateEndpointId = nil;
  if (candidateSigningPublicKey != NULL)
    *candidateSigningPublicKey = nil;
  if (candidateKeyAgreementPublicKey != NULL)
    *candidateKeyAgreementPublicKey = nil;
  return NO;
}
