import {
  ancV1BytesToHex,
  ancV1Hash,
  type SignedControlLogEntry,
  decodeAncV1RecoveryControlEvidence,
  verifyAncV1RecoveryAuthorizationPublicEvidence,
  verifyAncV1RecoveryWrapRotation,
} from "@agent-native/core/e2ee";
import { readProtectedCiphertextAt } from "@agent-native/core/protected-ciphertext";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  privateVaultControlEvidenceHash,
  privateVaultRecoveryNonceDigest,
} from "./private-vault-control-evidence.js";
import {
  createPrivateVaultControlLogService,
  type PrivateVaultControlLogScope,
} from "./private-vault-control-log.js";

export async function resolveActivePrivateVaultControlScope(
  vaultId: string,
): Promise<PrivateVaultControlLogScope | null> {
  const [vault] = await getDb()
    .select({
      vaultId: schema.contentEncryptedVaults.vaultId,
      ownerEmail: schema.contentEncryptedVaults.ownerEmail,
      orgId: schema.contentEncryptedVaults.orgId,
    })
    .from(schema.contentEncryptedVaults)
    .where(
      and(
        eq(schema.contentEncryptedVaults.vaultId, vaultId),
        eq(schema.contentEncryptedVaults.vaultState, "active"),
      ),
    )
    .limit(1);
  return vault ?? null;
}

/**
 * Reuses the immutable account ceremony as the sole hosted trust anchor for
 * sequence zero. Callers must still verify the signed entry itself; this only
 * proves that these exact public bytes were admitted for this physical scope.
 */
export async function authorizePrivateVaultGenesisCandidate(input: {
  scope: PrivateVaultControlLogScope;
  entry: SignedControlLogEntry;
  entryBytes: Uint8Array;
}): Promise<boolean> {
  const entryHash = ancV1BytesToHex(
    await ancV1Hash("log-entry", input.entryBytes),
  );
  const [admission] = await getDb()
    .select({
      vaultId: schema.contentEncryptedVaultGenesisAdmissions.vaultId,
    })
    .from(schema.contentEncryptedVaultGenesisAdmissions)
    .where(
      and(
        eq(
          schema.contentEncryptedVaultGenesisAdmissions.vaultId,
          input.scope.vaultId,
        ),
        eq(
          schema.contentEncryptedVaultGenesisAdmissions.ownerEmail,
          input.scope.ownerEmail,
        ),
        eq(
          schema.contentEncryptedVaultGenesisAdmissions.orgId,
          input.scope.orgId,
        ),
        eq(
          schema.contentEncryptedVaultGenesisAdmissions.controlEntryId,
          input.entry.envelopeId,
        ),
        eq(
          schema.contentEncryptedVaultGenesisAdmissions.controlEntryHash,
          entryHash,
        ),
        eq(
          schema.contentEncryptedVaultGenesisAdmissions.signerEndpointId,
          input.entry.signerEndpointId,
        ),
      ),
    )
    .limit(1);
  return Boolean(admission);
}

export const privateVaultControlLogService =
  createPrivateVaultControlLogService({
    authorizeGenesis: authorizePrivateVaultGenesisCandidate,
    // The host authenticates the active endpoint and ordered outer edge. It
    // deliberately cannot authenticate the nested grant against plaintext
    // capability scope; enrolled native clients do that before accepting the
    // resulting head. Persisted replay therefore admits the already-committed,
    // schema-bounded opaque envelope without pretending the server can read it.
    verifyGrantRevocationAuthorization: async () => true,
    verifyRecoveryAuthorization: async ({ scope, commit, entry, current }) => {
      try {
        const [binding] = await getDb()
          .select()
          .from(schema.contentEncryptedVaultControlEvidence)
          .where(
            and(
              eq(
                schema.contentEncryptedVaultControlEvidence.ownerEmail,
                scope.ownerEmail,
              ),
              eq(
                schema.contentEncryptedVaultControlEvidence.orgId,
                scope.orgId,
              ),
              eq(
                schema.contentEncryptedVaultControlEvidence.vaultId,
                scope.vaultId,
              ),
              eq(
                schema.contentEncryptedVaultControlEvidence.controlEntryId,
                entry.envelopeId,
              ),
              eq(
                schema.contentEncryptedVaultControlEvidence.evidenceKind,
                "recovery",
              ),
            ),
          )
          .limit(1);
        if (!binding) return false;
        const storedEvidence = await readProtectedCiphertextAt({
          kind: "control-evidence",
          vaultId: scope.vaultId,
          evidenceKind: "recovery",
          evidenceHash: binding.evidenceHash,
        });
        if (
          storedEvidence.byteLength !== binding.evidenceByteLength ||
          privateVaultControlEvidenceHash(
            "recovery",
            storedEvidence.ciphertext,
          ) !== binding.evidenceHash
        ) {
          return false;
        }
        const evidence = decodeAncV1RecoveryControlEvidence(
          storedEvidence.ciphertext,
        );
        const currentWrap = await readProtectedCiphertextAt({
          kind: "recovery-wrap",
          vaultId: scope.vaultId,
          recoveryWrapHash: current.recoveryWrapHash,
        });
        await verifyAncV1RecoveryAuthorizationPublicEvidence(
          evidence.recoveryAuthorization,
          {
            currentRecoveryWrap: currentWrap.ciphertext,
            currentSnapshot: evidence.currentSnapshot,
            verifiedControlState: current,
            commit,
            entry,
            now: Date.parse(entry.createdAt) / 1000,
            isConfirmationNonceAvailable: async (claim) => {
              const [storedClaim] = await getDb()
                .select({
                  controlEntryId:
                    schema.contentEncryptedVaultRecoveryNonceClaims
                      .controlEntryId,
                })
                .from(schema.contentEncryptedVaultRecoveryNonceClaims)
                .where(
                  and(
                    eq(
                      schema.contentEncryptedVaultRecoveryNonceClaims.vaultId,
                      scope.vaultId,
                    ),
                    eq(
                      schema.contentEncryptedVaultRecoveryNonceClaims
                        .controlEntryId,
                      entry.envelopeId,
                    ),
                    eq(
                      schema.contentEncryptedVaultRecoveryNonceClaims
                        .ceremonyId,
                      claim.ceremonyId,
                    ),
                    eq(
                      schema.contentEncryptedVaultRecoveryNonceClaims
                        .confirmationEnvelopeId,
                      claim.confirmationEnvelopeId,
                    ),
                    eq(
                      schema.contentEncryptedVaultRecoveryNonceClaims
                        .confirmationNonceDigest,
                      privateVaultRecoveryNonceDigest(claim.confirmationNonce),
                    ),
                    eq(
                      schema.contentEncryptedVaultRecoveryNonceClaims
                        .priorRecoveryGeneration,
                      claim.priorRecoveryGeneration,
                    ),
                    eq(
                      schema.contentEncryptedVaultRecoveryNonceClaims
                        .replacementRecoveryGeneration,
                      claim.replacementRecoveryGeneration,
                    ),
                  ),
                )
                .limit(1);
              return Boolean(storedClaim);
            },
          },
        );
        return true;
      } catch {
        return false;
      }
    },
    verifyRecoveryWrapRotation: async ({ scope, commit, entry, current }) => {
      try {
        const stored = await readProtectedCiphertextAt({
          kind: "recovery-wrap",
          vaultId: scope.vaultId,
          recoveryWrapHash: commit.recoveryWrapHash,
        });
        await verifyAncV1RecoveryWrapRotation(stored.ciphertext, {
          commit,
          entry,
          current,
        });
        return true;
      } catch {
        return false;
      }
    },
  });
