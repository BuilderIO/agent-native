import { createHash } from "node:crypto";

import {
  ancV1BytesToHex,
  ancV1HexToBytes,
  ancV1LifecycleIdFromHex,
  decodeAncV1ControlLogRotationAppendRequest,
  decodeSignedControlLogEntry,
  encodeAncV1ControlLogRotationAppendReceipt,
  hashAncV1RecoveryWrap,
  verifyEndpointRequestProofWithIdentity,
  type EndpointRequestProof,
} from "@agent-native/core/e2ee";
import {
  putProtectedCiphertext,
  readProtectedCiphertextAt,
} from "@agent-native/core/protected-ciphertext";
import { and, eq, or } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  commitPrivateVaultCiphertextStageInTransaction,
  privateVaultCiphertextStagingService,
} from "./private-vault-ciphertext-staging.js";
import {
  privateVaultControlLogService,
  resolveActivePrivateVaultControlScope,
} from "./private-vault-control-log-runtime.js";
import { sqlPrivateVaultEndpointRequestNonceStore } from "./private-vault-endpoint-request-nonces.js";

export const PRIVATE_VAULT_CONTROL_LOG_APPEND_PATH =
  "/api/private-vault/control-log/append";

export class PrivateVaultControlLogAppendError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "not_found"
      | "unauthorized"
      | "conflict"
      | "unavailable",
  ) {
    super("Private Vault control append failed");
    this.name = "PrivateVaultControlLogAppendError";
  }
}

function bindingId(vaultId: string, entryId: string): string {
  return createHash("sha256")
    .update("anc/v1/content-recovery-wrap-binding\0")
    .update(vaultId)
    .update("\0")
    .update(entryId)
    .digest("hex");
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

async function loadBinding(input: {
  ownerEmail: string;
  orgId: string;
  vaultId: string;
  recoveryWrapHash: string;
  entryId: string;
}) {
  const bindings = await getDb()
    .select()
    .from(schema.contentEncryptedVaultRecoveryWraps)
    .where(
      and(
        eq(
          schema.contentEncryptedVaultRecoveryWraps.ownerEmail,
          input.ownerEmail,
        ),
        eq(schema.contentEncryptedVaultRecoveryWraps.orgId, input.orgId),
        eq(schema.contentEncryptedVaultRecoveryWraps.vaultId, input.vaultId),
        or(
          eq(
            schema.contentEncryptedVaultRecoveryWraps.recoveryWrapHash,
            input.recoveryWrapHash,
          ),
          eq(
            schema.contentEncryptedVaultRecoveryWraps.controlEntryId,
            input.entryId,
          ),
        ),
      ),
    )
    .limit(2);
  if (bindings.length > 1) {
    throw new PrivateVaultControlLogAppendError("conflict");
  }
  return bindings[0] ?? null;
}

async function requireExactCommittedBinding(input: {
  ownerEmail: string;
  orgId: string;
  vaultId: string;
  recoveryWrapHash: string;
  entryId: string;
  recoveryWrap: Uint8Array;
}) {
  const binding = await loadBinding(input);
  if (!binding) return false;
  if (
    binding.recoveryWrapHash !== input.recoveryWrapHash ||
    binding.controlEntryId !== input.entryId ||
    binding.ciphertextByteLength !== input.recoveryWrap.byteLength
  ) {
    throw new PrivateVaultControlLogAppendError("conflict");
  }
  const stored = await readProtectedCiphertextAt({
    kind: "recovery-wrap",
    vaultId: input.vaultId,
    recoveryWrapHash: input.recoveryWrapHash,
  });
  if (
    stored.byteLength !== input.recoveryWrap.byteLength ||
    !equalBytes(stored.ciphertext, input.recoveryWrap)
  ) {
    throw new PrivateVaultControlLogAppendError("conflict");
  }
  return true;
}

async function verifiedReceipt(input: {
  scope: { ownerEmail: string; orgId: string; vaultId: string };
  signedEntry: Uint8Array;
  entryId: string;
  sequence: number;
  recoveryWrapHash: string;
  recoveryWrap: Uint8Array;
}): Promise<Uint8Array> {
  const verified = await privateVaultControlLogService.loadVerifiedEntry(
    input.scope,
    input.signedEntry,
  );
  if (
    verified.entry.envelopeId !== input.entryId ||
    verified.state.sequence !== input.sequence ||
    verified.state.headHash !== verified.entryHash ||
    verified.state.recoveryWrapHash !== input.recoveryWrapHash ||
    !(await requireExactCommittedBinding({
      ...input.scope,
      recoveryWrapHash: input.recoveryWrapHash,
      entryId: input.entryId,
      recoveryWrap: input.recoveryWrap,
    }))
  ) {
    throw new PrivateVaultControlLogAppendError("unavailable");
  }
  return encodeAncV1ControlLogRotationAppendReceipt({
    version: 1,
    suite: "anc/v1",
    type: "control-log-rotation-append-receipt",
    vaultId: input.scope.vaultId,
    entryId: input.entryId,
    sequence: input.sequence,
    headHash: verified.entryHash,
    recoveryWrapHash: input.recoveryWrapHash,
    recoveryWrapByteLength: input.recoveryWrap.byteLength,
  });
}

export async function appendPrivateVaultControlLogRotation(input: {
  body: Uint8Array;
  proof: EndpointRequestProof;
  now?: Date;
}): Promise<Uint8Array> {
  let request: ReturnType<typeof decodeAncV1ControlLogRotationAppendRequest>;
  let entry: ReturnType<typeof decodeSignedControlLogEntry>;
  try {
    request = decodeAncV1ControlLogRotationAppendRequest(input.body);
    entry = decodeSignedControlLogEntry(request.signedEntry);
  } catch {
    throw new PrivateVaultControlLogAppendError("invalid_request");
  }
  if (
    entry.sequence < 1 ||
    entry.innerEnvelope.type !== "membership_commit" ||
    !(
      entry.innerEnvelope.ceremonyKind === "remove_device" ||
      entry.innerEnvelope.ceremonyKind === "remove_broker" ||
      entry.innerEnvelope.ceremonyKind === "broker_replacement"
    ) ||
    !entry.innerEnvelope.rotationCompleted
  ) {
    throw new PrivateVaultControlLogAppendError("invalid_request");
  }

  const scope = await resolveActivePrivateVaultControlScope(entry.vaultId);
  if (!scope) throw new PrivateVaultControlLogAppendError("not_found");
  const current = await privateVaultControlLogService.loadVerifiedState(scope);
  if (!current) throw new PrivateVaultControlLogAppendError("not_found");
  const committed =
    entry.sequence <= current.sequence
      ? await privateVaultControlLogService
          .loadVerifiedEntry(scope, request.signedEntry)
          .catch(() => null)
      : null;
  if (entry.sequence <= current.sequence && !committed) {
    throw new PrivateVaultControlLogAppendError("conflict");
  }
  if (
    (!committed && entry.sequence !== current.sequence + 1) ||
    (!committed && entry.innerEnvelope.epoch !== current.epoch + 1) ||
    (!committed &&
      entry.innerEnvelope.recoveryWrapHash === current.recoveryWrapHash)
  ) {
    throw new PrivateVaultControlLogAppendError("conflict");
  }
  const signerAuthority = committed?.prior ?? current;
  const signer = signerAuthority.activeMembers.find(
    (member) =>
      member.endpointId === entry.signerEndpointId &&
      member.role === "endpoint",
  );
  if (!signer) throw new PrivateVaultControlLogAppendError("unauthorized");

  try {
    const authenticated = await verifyEndpointRequestProofWithIdentity({
      proof: input.proof,
      expectedMethod: "POST",
      expectedPath: PRIVATE_VAULT_CONTROL_LOG_APPEND_PATH,
      body: input.body,
      now: input.now ?? new Date(),
      resolveAuthorizedEndpoint: async ({ vaultId, endpointId }) =>
        vaultId === scope.vaultId && endpointId === signer.endpointId
          ? {
              vaultId,
              endpointId,
              state: "active" as const,
              signingPublicKey: Uint8Array.from(
                ancV1HexToBytes(signer.signingPublicKey),
              ),
            }
          : null,
      claimNonce: ({ vaultId, endpointId, nonce, expiresAt }) =>
        sqlPrivateVaultEndpointRequestNonceStore.claimAuthorizedControlRequest({
          ...scope,
          vaultId,
          endpointId,
          nonce,
          expiresAt,
        }),
    });
    if (authenticated.endpointId !== entry.signerEndpointId) {
      throw new Error("signer mismatch");
    }
  } catch {
    throw new PrivateVaultControlLogAppendError("unauthorized");
  }

  let recoveryWrapHash: string;
  try {
    recoveryWrapHash = ancV1BytesToHex(
      await hashAncV1RecoveryWrap(
        request.recoveryWrap,
        ancV1LifecycleIdFromHex(entry.vaultId),
      ),
    );
  } catch {
    throw new PrivateVaultControlLogAppendError("invalid_request");
  }
  if (entry.innerEnvelope.recoveryWrapHash !== recoveryWrapHash) {
    throw new PrivateVaultControlLogAppendError("invalid_request");
  }

  const exact = {
    ...scope,
    recoveryWrapHash,
    entryId: entry.envelopeId,
    recoveryWrap: request.recoveryWrap,
  };
  if (committed) {
    if (
      committed.state.recoveryWrapHash !== recoveryWrapHash ||
      !(await requireExactCommittedBinding(exact))
    ) {
      throw new PrivateVaultControlLogAppendError("conflict");
    }
    return verifiedReceipt({
      scope,
      signedEntry: request.signedEntry,
      entryId: entry.envelopeId,
      sequence: entry.sequence,
      recoveryWrapHash,
      recoveryWrap: request.recoveryWrap,
    });
  }
  if (!(await requireExactCommittedBinding(exact))) {
    const coordinate = {
      kind: "recovery-wrap" as const,
      vaultId: scope.vaultId,
      recoveryWrapHash,
    };
    const stage = await privateVaultCiphertextStagingService
      .stage(scope, coordinate)
      .catch(() => null);
    if (!stage) {
      if (!(await requireExactCommittedBinding(exact))) {
        throw new PrivateVaultControlLogAppendError("conflict");
      }
    } else {
      try {
        await putProtectedCiphertext({
          coordinate,
          ciphertext: request.recoveryWrap,
          expectedByteLength: request.recoveryWrap.byteLength,
        });
        await privateVaultControlLogService.append(scope, {
          entryBytes: request.signedEntry,
          expectedHead: {
            sequence: entry.sequence - 1,
            hash: entry.previousHash,
          },
          onVerifiedAppend: async ({ tx, serverReceivedAt }) => {
            await tx.insert(schema.contentEncryptedVaultRecoveryWraps).values({
              bindingId: bindingId(scope.vaultId, entry.envelopeId),
              ...scope,
              recoveryWrapHash,
              controlEntryId: entry.envelopeId,
              ciphertextByteLength: request.recoveryWrap.byteLength,
              serverReceivedAt,
            });
            await commitPrivateVaultCiphertextStageInTransaction(
              tx,
              stage,
              serverReceivedAt,
            );
          },
        });
      } catch {
        if (!(await requireExactCommittedBinding(exact).catch(() => false))) {
          throw new PrivateVaultControlLogAppendError("conflict");
        }
      }
    }
  }
  return verifiedReceipt({
    scope,
    signedEntry: request.signedEntry,
    entryId: entry.envelopeId,
    sequence: entry.sequence,
    recoveryWrapHash,
    recoveryWrap: request.recoveryWrap,
  });
}
