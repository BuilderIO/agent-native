import {
  ANC_V1_VAULT_BOOTSTRAP_PAGE_MAX_ENTRIES,
  type AncV1VaultBootstrapRequest,
  encodeAncV1VaultBootstrapResponse,
} from "@agent-native/core/e2ee";
import { readProtectedCiphertextAt } from "@agent-native/core/protected-ciphertext";
import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { privateVaultControlLogService } from "./private-vault-control-log-runtime.js";
import type { PrivateVaultControlLogScope } from "./private-vault-control-log.js";

export class PrivateVaultBootstrapError extends Error {
  constructor(readonly code: "not_found" | "conflict" | "unavailable") {
    super("Private Vault bootstrap is unavailable");
    this.name = "PrivateVaultBootstrapError";
  }
}

function sameHead(
  left: { sequence: number; headHash: string },
  right: { sequence: number; headHash: string },
) {
  return left.sequence === right.sequence && left.headHash === right.headHash;
}

export async function readPrivateVaultBootstrapPage(input: {
  scope: PrivateVaultControlLogScope;
  request: AncV1VaultBootstrapRequest;
}): Promise<Uint8Array> {
  try {
    const snapshot = await privateVaultControlLogService.loadVerifiedSnapshot(
      input.scope,
    );
    const state = snapshot.state;
    if (!state) throw new PrivateVaultBootstrapError("not_found");
    if (
      input.request.expectedHead &&
      (input.request.expectedHead.sequence !== state.sequence ||
        input.request.expectedHead.hash !== state.headHash)
    ) {
      throw new PrivateVaultBootstrapError("conflict");
    }
    if (input.request.afterSequence > state.sequence) {
      throw new PrivateVaultBootstrapError("conflict");
    }

    const firstSequence = input.request.afterSequence + 1;
    const page = snapshot.entries.slice(
      firstSequence,
      firstSequence + ANC_V1_VAULT_BOOTSTRAP_PAGE_MAX_ENTRIES,
    );
    if (page.some((entry, index) => entry.sequence !== firstSequence + index)) {
      throw new PrivateVaultBootstrapError("unavailable");
    }
    const throughSequence = input.request.afterSequence + page.length;
    const complete = throughSequence === state.sequence;
    let recoveryWrap: Uint8Array | null = null;
    const entryRecoveryWraps: Array<Uint8Array | null> = [];
    try {
      const pageEntryIds = page.map((entry) => entry.entryId);
      const pageBindings =
        pageEntryIds.length === 0
          ? []
          : await getDb()
              .select({
                controlEntryId:
                  schema.contentEncryptedVaultRecoveryWraps.controlEntryId,
                recoveryWrapHash:
                  schema.contentEncryptedVaultRecoveryWraps.recoveryWrapHash,
                ciphertextByteLength:
                  schema.contentEncryptedVaultRecoveryWraps
                    .ciphertextByteLength,
              })
              .from(schema.contentEncryptedVaultRecoveryWraps)
              .where(
                and(
                  eq(
                    schema.contentEncryptedVaultRecoveryWraps.ownerEmail,
                    input.scope.ownerEmail,
                  ),
                  eq(
                    schema.contentEncryptedVaultRecoveryWraps.orgId,
                    input.scope.orgId,
                  ),
                  eq(
                    schema.contentEncryptedVaultRecoveryWraps.vaultId,
                    input.scope.vaultId,
                  ),
                  inArray(
                    schema.contentEncryptedVaultRecoveryWraps.controlEntryId,
                    pageEntryIds,
                  ),
                ),
              );
      if (
        pageBindings.some(
          (binding) => !pageEntryIds.includes(binding.controlEntryId),
        ) ||
        new Set(pageBindings.map((binding) => binding.controlEntryId)).size !==
          pageBindings.length
      ) {
        throw new PrivateVaultBootstrapError("unavailable");
      }
      for (const entry of page) {
        const binding = pageBindings.find(
          (candidate) => candidate.controlEntryId === entry.entryId,
        );
        if (!binding) {
          entryRecoveryWraps.push(null);
          continue;
        }
        const stored = await readProtectedCiphertextAt({
          kind: "recovery-wrap",
          vaultId: input.scope.vaultId,
          recoveryWrapHash: binding.recoveryWrapHash,
        });
        const wrap = Uint8Array.from(stored.ciphertext);
        if (binding.ciphertextByteLength !== wrap.byteLength) {
          wrap.fill(0);
          throw new PrivateVaultBootstrapError("unavailable");
        }
        entryRecoveryWraps.push(wrap);
      }

      if (complete) {
        const [binding] = await getDb()
          .select({
            recoveryWrapHash:
              schema.contentEncryptedVaultRecoveryWraps.recoveryWrapHash,
            ciphertextByteLength:
              schema.contentEncryptedVaultRecoveryWraps.ciphertextByteLength,
          })
          .from(schema.contentEncryptedVaultRecoveryWraps)
          .where(
            and(
              eq(
                schema.contentEncryptedVaultRecoveryWraps.ownerEmail,
                input.scope.ownerEmail,
              ),
              eq(
                schema.contentEncryptedVaultRecoveryWraps.orgId,
                input.scope.orgId,
              ),
              eq(
                schema.contentEncryptedVaultRecoveryWraps.vaultId,
                input.scope.vaultId,
              ),
              eq(
                schema.contentEncryptedVaultRecoveryWraps.recoveryWrapHash,
                state.recoveryWrapHash,
              ),
            ),
          )
          .limit(1);
        if (!binding) throw new PrivateVaultBootstrapError("unavailable");
        const stored = await readProtectedCiphertextAt({
          kind: "recovery-wrap",
          vaultId: input.scope.vaultId,
          recoveryWrapHash: state.recoveryWrapHash,
        });
        recoveryWrap = Uint8Array.from(stored.ciphertext);
        if (
          binding.recoveryWrapHash !== state.recoveryWrapHash ||
          binding.ciphertextByteLength !== recoveryWrap.byteLength
        ) {
          throw new PrivateVaultBootstrapError("unavailable");
        }
      }

      const current = await privateVaultControlLogService.loadVerifiedState(
        input.scope,
      );
      if (!current || !sameHead(state, current)) {
        throw new PrivateVaultBootstrapError("conflict");
      }
      return encodeAncV1VaultBootstrapResponse({
        metadata: {
          version: 1,
          suite: "anc/v1",
          type: "vault-bootstrap-response",
          vaultId: input.scope.vaultId,
          afterSequence: input.request.afterSequence,
          throughSequence,
          head: { sequence: state.sequence, hash: state.headHash },
          complete,
          recoveryWrapHash: complete ? state.recoveryWrapHash : null,
        },
        entries: page.map((entry) => entry.entryBytes),
        entryRecoveryWraps,
        recoveryWrap,
      });
    } finally {
      for (const wrap of entryRecoveryWraps) wrap?.fill(0);
      recoveryWrap?.fill(0);
    }
  } catch (error) {
    if (error instanceof PrivateVaultBootstrapError) throw error;
    throw new PrivateVaultBootstrapError("unavailable");
  }
}
