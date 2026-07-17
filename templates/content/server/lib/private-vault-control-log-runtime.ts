import {
  ancV1BytesToHex,
  ancV1Hash,
  verifyAncV1RecoveryWrapRotation,
} from "@agent-native/core/e2ee";
import { readProtectedCiphertextAt } from "@agent-native/core/protected-ciphertext";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
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

export const privateVaultControlLogService =
  createPrivateVaultControlLogService({
    authorizeGenesis: async ({ scope, entry, entryBytes }) => {
      const entryHash = ancV1BytesToHex(
        await ancV1Hash("log-entry", entryBytes),
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
              scope.vaultId,
            ),
            eq(
              schema.contentEncryptedVaultGenesisAdmissions.ownerEmail,
              scope.ownerEmail,
            ),
            eq(
              schema.contentEncryptedVaultGenesisAdmissions.orgId,
              scope.orgId,
            ),
            eq(
              schema.contentEncryptedVaultGenesisAdmissions.controlEntryId,
              entry.envelopeId,
            ),
            eq(
              schema.contentEncryptedVaultGenesisAdmissions.controlEntryHash,
              entryHash,
            ),
            eq(
              schema.contentEncryptedVaultGenesisAdmissions.signerEndpointId,
              entry.signerEndpointId,
            ),
          ),
        )
        .limit(1);
      return Boolean(admission);
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
