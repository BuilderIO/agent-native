import { createHash } from "node:crypto";

import {
  ancV1BytesToHex,
  ancV1HexToBytes,
  ancV1LifecycleIdFromHex,
  CONTROL_LOG_ZERO_HASH,
  decodeAncV1ControlLogGenesisAppendRequest,
  decodeAncV1ControlLogGrantRevocationAppendRequest,
  decodeAncV1ControlLogRotationAppendRequest,
  decodeAncV1ControlLogRecoveryAppendRequest,
  decodeSignedControlLogEntry,
  encodeAncV1ControlLogGenesisAppendReceipt,
  encodeAncV1ControlLogGrantRevocationAppendReceipt,
  encodeAncV1ControlLogRotationAppendReceipt,
  encodeAncV1ControlLogRecoveryAppendReceipt,
  encodeAncV1RecoveryControlEvidence,
  hashAncV1RecoveryWrap,
  verifyEndpointRequestProofWithIdentity,
  verifyAncV1RecoveryWrap,
  verifyAncV1RecoveryAuthorizationPublicEvidence,
  type EndpointRequestProof,
} from "@agent-native/core/e2ee";
import {
  putProtectedCiphertext,
  readProtectedCiphertextAt,
} from "@agent-native/core/protected-ciphertext";
import { and, eq, inArray, or } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  commitPrivateVaultCiphertextStageInTransaction,
  privateVaultCiphertextStagingService,
} from "./private-vault-ciphertext-staging.js";
import {
  privateVaultControlEvidenceHash,
  privateVaultRecoveryNonceDigest,
} from "./private-vault-control-evidence.js";
import {
  authorizePrivateVaultGenesisCandidate,
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

function evidenceBindingId(vaultId: string, entryId: string): string {
  return createHash("sha256")
    .update("anc/v1/content-control-evidence-binding\0")
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

async function requireExactCommittedEvidence(input: {
  ownerEmail: string;
  orgId: string;
  vaultId: string;
  entryId: string;
  evidenceHash: string;
  evidence: Uint8Array;
}) {
  const [binding] = await getDb()
    .select()
    .from(schema.contentEncryptedVaultControlEvidence)
    .where(
      and(
        eq(
          schema.contentEncryptedVaultControlEvidence.ownerEmail,
          input.ownerEmail,
        ),
        eq(schema.contentEncryptedVaultControlEvidence.orgId, input.orgId),
        eq(schema.contentEncryptedVaultControlEvidence.vaultId, input.vaultId),
        eq(
          schema.contentEncryptedVaultControlEvidence.controlEntryId,
          input.entryId,
        ),
      ),
    )
    .limit(1);
  if (!binding) return false;
  if (
    binding.evidenceKind !== "recovery" ||
    binding.evidenceHash !== input.evidenceHash ||
    binding.evidenceByteLength !== input.evidence.byteLength
  ) {
    throw new PrivateVaultControlLogAppendError("conflict");
  }
  const stored = await readProtectedCiphertextAt({
    kind: "control-evidence",
    vaultId: input.vaultId,
    evidenceKind: "recovery",
    evidenceHash: input.evidenceHash,
  });
  if (
    stored.byteLength !== input.evidence.byteLength ||
    !equalBytes(stored.ciphertext, input.evidence)
  ) {
    throw new PrivateVaultControlLogAppendError("conflict");
  }
  return true;
}

function endpointPublicIdentityJson(member: {
  endpointId: string;
  role: "endpoint" | "broker";
  unattended: boolean;
  signingPublicKey: string;
  keyAgreementPublicKey: string;
  enrollmentRef: string;
}): string {
  const publicIdentity = Buffer.from(
    JSON.stringify({
      endpointId: member.endpointId,
      role: member.role,
      unattended: member.unattended,
      signingPublicKey: member.signingPublicKey,
      keyAgreementPublicKey: member.keyAgreementPublicKey,
      enrollmentRef: member.enrollmentRef,
    }),
  ).toString("base64url");
  return JSON.stringify({
    algorithmId: "anc/v1-control-log-member",
    publicIdentity,
  });
}

async function requireExactEndpointProjection(input: {
  ownerEmail: string;
  orgId: string;
  vaultId: string;
  endpointId: string;
  publicIdentityJson: string;
}) {
  const [endpoint] = await getDb()
    .select({
      endpointId: schema.contentEncryptedVaultEndpoints.endpointId,
      vaultId: schema.contentEncryptedVaultEndpoints.vaultId,
      ownerEmail: schema.contentEncryptedVaultEndpoints.ownerEmail,
      orgId: schema.contentEncryptedVaultEndpoints.orgId,
      version: schema.contentEncryptedVaultEndpoints.version,
      endpointState: schema.contentEncryptedVaultEndpoints.endpointState,
      publicIdentityJson:
        schema.contentEncryptedVaultEndpoints.publicIdentityJson,
      healthState: schema.contentEncryptedVaultEndpoints.healthState,
    })
    .from(schema.contentEncryptedVaultEndpoints)
    .where(
      eq(schema.contentEncryptedVaultEndpoints.endpointId, input.endpointId),
    )
    .limit(1);
  if (!endpoint) return false;
  if (!endpointProjectionMatches(endpoint, input)) {
    throw new PrivateVaultControlLogAppendError("conflict");
  }
  return true;
}

function endpointProjectionMatches(
  endpoint: {
    endpointId: string;
    vaultId: string;
    ownerEmail: string;
    orgId: string;
    version: number;
    endpointState: string;
    publicIdentityJson: string;
    healthState: string;
  },
  expected: {
    endpointId: string;
    vaultId: string;
    ownerEmail: string;
    orgId: string;
    publicIdentityJson: string;
  },
) {
  return (
    endpoint.endpointId === expected.endpointId &&
    endpoint.vaultId === expected.vaultId &&
    endpoint.ownerEmail === expected.ownerEmail &&
    endpoint.orgId === expected.orgId &&
    endpoint.version === 1 &&
    endpoint.endpointState === "online" &&
    endpoint.publicIdentityJson === expected.publicIdentityJson &&
    endpoint.healthState === "healthy"
  );
}

async function verifiedRotationReceipt(input: {
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

async function verifiedGenesisReceipt(input: {
  scope: { ownerEmail: string; orgId: string; vaultId: string };
  signedEntry: Uint8Array;
  entryId: string;
  recoveryWrapHash: string;
  recoveryWrap: Uint8Array;
}): Promise<Uint8Array> {
  const verified = await privateVaultControlLogService.loadVerifiedEntry(
    input.scope,
    input.signedEntry,
  );
  if (
    verified.prior !== null ||
    verified.entry.envelopeId !== input.entryId ||
    verified.entry.sequence !== 0 ||
    verified.state.sequence !== 0 ||
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
  return encodeAncV1ControlLogGenesisAppendReceipt({
    version: 1,
    suite: "anc/v1",
    type: "control-log-genesis-append-receipt",
    vaultId: input.scope.vaultId,
    entryId: input.entryId,
    sequence: 0,
    headHash: verified.entryHash,
    recoveryWrapHash: input.recoveryWrapHash,
    recoveryWrapByteLength: input.recoveryWrap.byteLength,
  });
}

async function verifiedGrantRevocationReceipt(input: {
  scope: { ownerEmail: string; orgId: string; vaultId: string };
  signedEntry: Uint8Array;
  entryId: string;
  sequence: number;
}): Promise<Uint8Array> {
  const verified = await privateVaultControlLogService.loadVerifiedEntry(
    input.scope,
    input.signedEntry,
  );
  if (
    verified.entry.envelopeId !== input.entryId ||
    verified.entry.innerEnvelope.type !== "grant_revocation" ||
    verified.state.sequence !== input.sequence ||
    verified.state.headHash !== verified.entryHash
  ) {
    throw new PrivateVaultControlLogAppendError("unavailable");
  }
  return encodeAncV1ControlLogGrantRevocationAppendReceipt({
    version: 1,
    suite: "anc/v1",
    type: "control-log-grant-revocation-append-receipt",
    vaultId: input.scope.vaultId,
    entryId: input.entryId,
    sequence: input.sequence,
    headHash: verified.entryHash,
  });
}

async function verifiedRecoveryReceipt(input: {
  scope: { ownerEmail: string; orgId: string; vaultId: string };
  signedEntry: Uint8Array;
  entryId: string;
  sequence: number;
  recoveryWrapHash: string;
  recoveryWrap: Uint8Array;
  evidenceHash: string;
  evidence: Uint8Array;
}): Promise<Uint8Array> {
  const verified = await privateVaultControlLogService.loadVerifiedEntry(
    input.scope,
    input.signedEntry,
  );
  if (
    verified.entry.envelopeId !== input.entryId ||
    verified.entry.innerEnvelope.type !== "membership_commit" ||
    verified.entry.innerEnvelope.ceremonyKind !== "recovery" ||
    verified.state.sequence !== input.sequence ||
    verified.state.headHash !== verified.entryHash ||
    verified.state.recoveryWrapHash !== input.recoveryWrapHash ||
    !(await requireExactCommittedBinding({
      ...input.scope,
      recoveryWrapHash: input.recoveryWrapHash,
      entryId: input.entryId,
      recoveryWrap: input.recoveryWrap,
    })) ||
    !(await requireExactCommittedEvidence({
      ...input.scope,
      entryId: input.entryId,
      evidenceHash: input.evidenceHash,
      evidence: input.evidence,
    }))
  ) {
    throw new PrivateVaultControlLogAppendError("unavailable");
  }
  return encodeAncV1ControlLogRecoveryAppendReceipt({
    version: 1,
    suite: "anc/v1",
    type: "control-log-recovery-append-receipt",
    vaultId: input.scope.vaultId,
    entryId: input.entryId,
    sequence: input.sequence,
    headHash: verified.entryHash,
    recoveryWrapHash: input.recoveryWrapHash,
    recoveryWrapByteLength: input.recoveryWrap.byteLength,
  });
}

export async function appendPrivateVaultControlLogGenesis(input: {
  body: Uint8Array;
  proof: EndpointRequestProof;
  now?: Date;
}): Promise<Uint8Array> {
  let request: ReturnType<typeof decodeAncV1ControlLogGenesisAppendRequest>;
  let entry: ReturnType<typeof decodeSignedControlLogEntry>;
  try {
    request = decodeAncV1ControlLogGenesisAppendRequest(input.body);
    entry = decodeSignedControlLogEntry(request.signedEntry);
  } catch {
    throw new PrivateVaultControlLogAppendError("invalid_request");
  }
  if (
    entry.sequence !== 0 ||
    entry.previousHash !== CONTROL_LOG_ZERO_HASH ||
    entry.innerEnvelope.type !== "membership_commit" ||
    entry.innerEnvelope.ceremonyKind !== "first_device" ||
    entry.innerEnvelope.activeMembers.length !== 1 ||
    entry.innerEnvelope.activeMembers[0]?.role !== "endpoint" ||
    entry.innerEnvelope.activeMembers[0].endpointId !== entry.signerEndpointId
  ) {
    throw new PrivateVaultControlLogAppendError("invalid_request");
  }
  const commit = entry.innerEnvelope;
  const signer = commit.activeMembers[0];
  const scope = await resolveActivePrivateVaultControlScope(entry.vaultId);
  if (!scope) throw new PrivateVaultControlLogAppendError("not_found");
  if (
    !(await authorizePrivateVaultGenesisCandidate({
      scope,
      entry,
      entryBytes: request.signedEntry,
    }).catch(() => false))
  ) {
    throw new PrivateVaultControlLogAppendError("unauthorized");
  }

  let recoveryWrapHash: string;
  try {
    const vaultId = ancV1LifecycleIdFromHex(entry.vaultId);
    const verifiedWrap = await verifyAncV1RecoveryWrap(request.recoveryWrap, {
      expectedVaultId: vaultId,
      issuerSigningPublicKey: Uint8Array.from(
        ancV1HexToBytes(signer.signingPublicKey),
      ),
    });
    recoveryWrapHash = ancV1BytesToHex(
      await hashAncV1RecoveryWrap(request.recoveryWrap, vaultId),
    );
    const signedAt = Date.parse(entry.createdAt) / 1_000;
    if (
      recoveryWrapHash !== commit.recoveryWrapHash ||
      !equalBytes(
        verifiedWrap.ceremonyId,
        ancV1LifecycleIdFromHex(commit.ceremonyId),
      ) ||
      verifiedWrap.recoveryGeneration !== commit.recoveryGeneration ||
      ancV1BytesToHex(verifiedWrap.recoveryId) !== commit.recoveryId ||
      ancV1BytesToHex(verifiedWrap.recoveryKeyAgreementPublicKey) !==
        commit.recoveryKeyAgreementPublicKey ||
      verifiedWrap.epoch !== 1 ||
      ancV1BytesToHex(verifiedWrap.issuerEndpointId) !== signer.endpointId ||
      verifiedWrap.activationControlSequence !== 0 ||
      ancV1BytesToHex(verifiedWrap.activationPreviousHead) !==
        CONTROL_LOG_ZERO_HASH ||
      ancV1BytesToHex(verifiedWrap.activationPreviousMembershipHash) !==
        CONTROL_LOG_ZERO_HASH ||
      !Number.isFinite(signedAt) ||
      verifiedWrap.createdAt > signedAt
    ) {
      throw new Error("genesis recovery wrap binding mismatch");
    }
  } catch {
    throw new PrivateVaultControlLogAppendError("invalid_request");
  }

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

  const publicIdentityJson = endpointPublicIdentityJson(signer);
  const receiptInput = {
    scope,
    signedEntry: request.signedEntry,
    entryId: entry.envelopeId,
    recoveryWrapHash,
    recoveryWrap: request.recoveryWrap,
  };
  const current = await privateVaultControlLogService.loadVerifiedState(scope);
  if (current) {
    const committed = await privateVaultControlLogService
      .loadVerifiedEntry(scope, request.signedEntry)
      .catch(() => null);
    if (!committed) throw new PrivateVaultControlLogAppendError("conflict");
    return verifiedGenesisReceipt(receiptInput);
  }
  if (
    (await requireExactCommittedBinding({
      ...scope,
      recoveryWrapHash,
      entryId: entry.envelopeId,
      recoveryWrap: request.recoveryWrap,
    })) ||
    (await requireExactEndpointProjection({
      ...scope,
      endpointId: signer.endpointId,
      publicIdentityJson,
    }))
  ) {
    throw new PrivateVaultControlLogAppendError("conflict");
  }

  const coordinate = {
    kind: "recovery-wrap" as const,
    vaultId: scope.vaultId,
    recoveryWrapHash,
  };
  const stage = await privateVaultCiphertextStagingService
    .stage(scope, coordinate)
    .catch(() => null);
  if (!stage) {
    return verifiedGenesisReceipt(receiptInput).catch(() => {
      throw new PrivateVaultControlLogAppendError("conflict");
    });
  }

  try {
    await putProtectedCiphertext({
      coordinate,
      ciphertext: request.recoveryWrap,
      expectedByteLength: request.recoveryWrap.byteLength,
    });
    await privateVaultControlLogService.append(scope, {
      entryBytes: request.signedEntry,
      expectedHead: { sequence: null, hash: null },
      onVerifiedAppend: async ({ tx, serverReceivedAt }) => {
        await tx.insert(schema.contentEncryptedVaultRecoveryWraps).values({
          bindingId: bindingId(scope.vaultId, entry.envelopeId),
          ...scope,
          recoveryWrapHash,
          controlEntryId: entry.envelopeId,
          ciphertextByteLength: request.recoveryWrap.byteLength,
          serverReceivedAt,
        });
        await tx
          .insert(schema.contentEncryptedVaultEndpoints)
          .values({
            ...scope,
            endpointId: signer.endpointId,
            endpointState: "online",
            publicIdentityJson,
            healthState: "healthy",
            serverReceivedAt,
          })
          .onConflictDoNothing();
        const [endpoint] = await tx
          .select({
            endpointId: schema.contentEncryptedVaultEndpoints.endpointId,
            vaultId: schema.contentEncryptedVaultEndpoints.vaultId,
            ownerEmail: schema.contentEncryptedVaultEndpoints.ownerEmail,
            orgId: schema.contentEncryptedVaultEndpoints.orgId,
            version: schema.contentEncryptedVaultEndpoints.version,
            endpointState: schema.contentEncryptedVaultEndpoints.endpointState,
            publicIdentityJson:
              schema.contentEncryptedVaultEndpoints.publicIdentityJson,
            healthState: schema.contentEncryptedVaultEndpoints.healthState,
          })
          .from(schema.contentEncryptedVaultEndpoints)
          .where(
            eq(
              schema.contentEncryptedVaultEndpoints.endpointId,
              signer.endpointId,
            ),
          )
          .limit(1);
        if (
          !endpoint ||
          !endpointProjectionMatches(endpoint, {
            ...scope,
            endpointId: signer.endpointId,
            publicIdentityJson,
          })
        ) {
          throw new PrivateVaultControlLogAppendError("conflict");
        }
        await commitPrivateVaultCiphertextStageInTransaction(
          tx,
          stage,
          serverReceivedAt,
        );
      },
    });
  } catch {
    return verifiedGenesisReceipt(receiptInput).catch(() => {
      throw new PrivateVaultControlLogAppendError("conflict");
    });
  }
  return verifiedGenesisReceipt(receiptInput);
}

export async function appendPrivateVaultControlLogGrantRevocation(input: {
  body: Uint8Array;
  proof: EndpointRequestProof;
  now?: Date;
}): Promise<Uint8Array> {
  let request: ReturnType<
    typeof decodeAncV1ControlLogGrantRevocationAppendRequest
  >;
  let entry: ReturnType<typeof decodeSignedControlLogEntry>;
  try {
    request = decodeAncV1ControlLogGrantRevocationAppendRequest(input.body);
    entry = decodeSignedControlLogEntry(request.signedEntry);
  } catch {
    throw new PrivateVaultControlLogAppendError("invalid_request");
  }
  if (entry.sequence < 1 || entry.innerEnvelope.type !== "grant_revocation") {
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
  if (!committed && entry.sequence !== current.sequence + 1) {
    throw new PrivateVaultControlLogAppendError("conflict");
  }
  const signerAuthority = committed?.prior ?? current;
  const signer = signerAuthority?.activeMembers.find(
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
    if (authenticated.endpointId !== entry.signerEndpointId) throw new Error();
  } catch {
    throw new PrivateVaultControlLogAppendError("unauthorized");
  }

  if (!committed) {
    const expectedRevocation = entry.innerEnvelope.revocationEnvelope;
    await privateVaultControlLogService.append(scope, {
      entryBytes: request.signedEntry,
      expectedHead: {
        sequence: entry.sequence - 1,
        hash: entry.previousHash,
      },
      verifyGrantRevocationAuthorization: async ({
        entry: verifiedEntry,
        current: verifiedCurrent,
        revocationEnvelope,
      }) =>
        verifiedEntry.envelopeId === entry.envelopeId &&
        verifiedCurrent.sequence === entry.sequence - 1 &&
        verifiedCurrent.headHash === entry.previousHash &&
        revocationEnvelope === expectedRevocation,
    });
  }
  return verifiedGrantRevocationReceipt({
    scope,
    signedEntry: request.signedEntry,
    entryId: entry.envelopeId,
    sequence: entry.sequence,
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
    return verifiedRotationReceipt({
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
  return verifiedRotationReceipt({
    scope,
    signedEntry: request.signedEntry,
    entryId: entry.envelopeId,
    sequence: entry.sequence,
    recoveryWrapHash,
    recoveryWrap: request.recoveryWrap,
  });
}

export async function appendPrivateVaultControlLogRecovery(input: {
  body: Uint8Array;
  proof: EndpointRequestProof;
  now?: Date;
}): Promise<Uint8Array> {
  let request: ReturnType<typeof decodeAncV1ControlLogRecoveryAppendRequest>;
  let entry: ReturnType<typeof decodeSignedControlLogEntry>;
  try {
    request = decodeAncV1ControlLogRecoveryAppendRequest(input.body);
    entry = decodeSignedControlLogEntry(request.signedEntry);
  } catch {
    throw new PrivateVaultControlLogAppendError("invalid_request");
  }
  if (
    entry.sequence < 1 ||
    entry.innerEnvelope.type !== "membership_commit" ||
    entry.innerEnvelope.ceremonyKind !== "recovery" ||
    entry.innerEnvelope.activeMembers.length !== 1 ||
    !entry.innerEnvelope.rotationCompleted
  ) {
    throw new PrivateVaultControlLogAppendError("invalid_request");
  }
  const scope = await resolveActivePrivateVaultControlScope(entry.vaultId);
  if (!scope) throw new PrivateVaultControlLogAppendError("not_found");
  const evidence = encodeAncV1RecoveryControlEvidence({
    suite: "anc/v1",
    version: 1,
    type: "recovery-control-evidence",
    currentSnapshot: request.currentSnapshot,
    recoveryAuthorization: request.recoveryAuthorization,
  });
  const evidenceHash = privateVaultControlEvidenceHash("recovery", evidence);
  const recoveryWrapHash = ancV1BytesToHex(
    await hashAncV1RecoveryWrap(
      request.recoveryWrap,
      ancV1LifecycleIdFromHex(entry.vaultId),
    ),
  );
  const receiptInput = {
    scope,
    signedEntry: request.signedEntry,
    entryId: entry.envelopeId,
    sequence: entry.sequence,
    recoveryWrapHash,
    recoveryWrap: request.recoveryWrap,
    evidenceHash,
    evidence,
  };
  const current = await privateVaultControlLogService.loadVerifiedState(scope);
  if (!current) throw new PrivateVaultControlLogAppendError("not_found");
  if (entry.sequence <= current.sequence) {
    return verifiedRecoveryReceipt(receiptInput).catch(() => {
      throw new PrivateVaultControlLogAppendError("conflict");
    });
  }
  if (
    entry.sequence !== current.sequence + 1 ||
    entry.previousHash !== current.headHash ||
    entry.innerEnvelope.epoch !== current.epoch + 1 ||
    entry.innerEnvelope.recoveryWrapHash !== recoveryWrapHash
  ) {
    throw new PrivateVaultControlLogAppendError("conflict");
  }
  const currentWrap = await readProtectedCiphertextAt({
    kind: "recovery-wrap",
    vaultId: scope.vaultId,
    recoveryWrapHash: current.recoveryWrapHash,
  }).catch(() => null);
  if (!currentWrap) throw new PrivateVaultControlLogAppendError("unavailable");
  let nonceClaim:
    | {
        ceremonyId: string;
        confirmationEnvelopeId: string;
        confirmationNonce: Uint8Array;
        priorRecoveryGeneration: number;
        replacementRecoveryGeneration: number;
      }
    | undefined;
  let projection: Awaited<
    ReturnType<typeof verifyAncV1RecoveryAuthorizationPublicEvidence>
  >;
  try {
    projection = await verifyAncV1RecoveryAuthorizationPublicEvidence(
      request.recoveryAuthorization,
      {
        currentRecoveryWrap: currentWrap.ciphertext,
        currentSnapshot: request.currentSnapshot,
        verifiedControlState: current,
        commit: entry.innerEnvelope,
        entry,
        now: Math.floor((input.now ?? new Date()).getTime() / 1000),
        isConfirmationNonceAvailable: async (claim) => {
          const digest = privateVaultRecoveryNonceDigest(
            claim.confirmationNonce,
          );
          const [existing] = await getDb()
            .select({
              claimId: schema.contentEncryptedVaultRecoveryNonceClaims.claimId,
            })
            .from(schema.contentEncryptedVaultRecoveryNonceClaims)
            .where(
              and(
                eq(
                  schema.contentEncryptedVaultRecoveryNonceClaims.vaultId,
                  scope.vaultId,
                ),
                or(
                  eq(
                    schema.contentEncryptedVaultRecoveryNonceClaims
                      .confirmationNonceDigest,
                    digest,
                  ),
                  eq(
                    schema.contentEncryptedVaultRecoveryNonceClaims
                      .controlEntryId,
                    entry.envelopeId,
                  ),
                ),
              ),
            )
            .limit(1);
          if (existing) return false;
          nonceClaim = {
            ...claim,
            confirmationNonce: claim.confirmationNonce.slice(),
          };
          return true;
        },
      },
    );
  } catch {
    throw new PrivateVaultControlLogAppendError("unauthorized");
  }
  if (
    !nonceClaim ||
    projection.next.recoveryWrapHash !== recoveryWrapHash ||
    projection.next.soleEndpointId !== entry.signerEndpointId
  ) {
    throw new PrivateVaultControlLogAppendError("invalid_request");
  }
  const member = entry.innerEnvelope.activeMembers[0]!;
  if (
    member.endpointId !== projection.next.soleEndpointId ||
    member.signingPublicKey !== projection.next.soleEndpointSigningPublicKey ||
    member.keyAgreementPublicKey !==
      projection.next.soleEndpointKeyAgreementPublicKey
  ) {
    throw new PrivateVaultControlLogAppendError("invalid_request");
  }
  try {
    const authenticated = await verifyEndpointRequestProofWithIdentity({
      proof: input.proof,
      expectedMethod: "POST",
      expectedPath: PRIVATE_VAULT_CONTROL_LOG_APPEND_PATH,
      body: input.body,
      now: input.now ?? new Date(),
      resolveAuthorizedEndpoint: async ({ vaultId, endpointId }) =>
        vaultId === scope.vaultId && endpointId === member.endpointId
          ? {
              vaultId,
              endpointId,
              state: "active" as const,
              signingPublicKey: Uint8Array.from(
                ancV1HexToBytes(member.signingPublicKey),
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
    if (authenticated.endpointId !== member.endpointId) throw new Error();
  } catch {
    throw new PrivateVaultControlLogAppendError("unauthorized");
  }

  const wrapCoordinate = {
    kind: "recovery-wrap" as const,
    vaultId: scope.vaultId,
    recoveryWrapHash,
  };
  const evidenceCoordinate = {
    kind: "control-evidence" as const,
    vaultId: scope.vaultId,
    evidenceKind: "recovery" as const,
    evidenceHash,
  };
  const [wrapStage, evidenceStage] = await Promise.all([
    privateVaultCiphertextStagingService.stage(scope, wrapCoordinate),
    privateVaultCiphertextStagingService.stage(scope, evidenceCoordinate),
  ]).catch(() => []);
  if (!wrapStage || !evidenceStage) {
    return verifiedRecoveryReceipt(receiptInput).catch(() => {
      throw new PrivateVaultControlLogAppendError("conflict");
    });
  }
  try {
    await Promise.all([
      putProtectedCiphertext({
        coordinate: wrapCoordinate,
        ciphertext: request.recoveryWrap,
        expectedByteLength: request.recoveryWrap.byteLength,
      }),
      putProtectedCiphertext({
        coordinate: evidenceCoordinate,
        ciphertext: evidence,
        expectedByteLength: evidence.byteLength,
      }),
    ]);
    const exactNonceClaim = nonceClaim;
    await privateVaultControlLogService.append(scope, {
      entryBytes: request.signedEntry,
      expectedHead: {
        sequence: projection.expectedCurrent.sequence,
        hash: projection.expectedCurrent.headHash,
      },
      verifyRecoveryAuthorization: async ({ current: verifiedCurrent }) =>
        verifiedCurrent.sequence === projection.expectedCurrent.sequence &&
        verifiedCurrent.headHash === projection.expectedCurrent.headHash &&
        verifiedCurrent.membershipHash ===
          projection.expectedCurrent.membershipHash &&
        verifiedCurrent.recoveryId ===
          projection.consumedAuthority.recoveryId &&
        verifiedCurrent.recoveryGeneration ===
          projection.consumedAuthority.recoveryGeneration,
      onVerifiedAppend: async ({ tx, serverReceivedAt }) => {
        await tx.insert(schema.contentEncryptedVaultRecoveryWraps).values({
          bindingId: bindingId(scope.vaultId, entry.envelopeId),
          ...scope,
          recoveryWrapHash,
          controlEntryId: entry.envelopeId,
          ciphertextByteLength: request.recoveryWrap.byteLength,
          serverReceivedAt,
        });
        await tx.insert(schema.contentEncryptedVaultControlEvidence).values({
          bindingId: evidenceBindingId(scope.vaultId, entry.envelopeId),
          ...scope,
          controlEntryId: entry.envelopeId,
          evidenceKind: "recovery",
          evidenceHash,
          evidenceByteLength: evidence.byteLength,
          serverReceivedAt,
        });
        await tx
          .insert(schema.contentEncryptedVaultRecoveryNonceClaims)
          .values({
            claimId: createHash("sha256")
              .update("anc/v1/content-recovery-nonce-claim\0")
              .update(scope.vaultId)
              .update("\0")
              .update(entry.envelopeId)
              .digest("hex"),
            ...scope,
            controlEntryId: entry.envelopeId,
            ceremonyId: exactNonceClaim.ceremonyId,
            confirmationEnvelopeId: exactNonceClaim.confirmationEnvelopeId,
            confirmationNonceDigest: privateVaultRecoveryNonceDigest(
              exactNonceClaim.confirmationNonce,
            ),
            priorRecoveryGeneration: exactNonceClaim.priorRecoveryGeneration,
            replacementRecoveryGeneration:
              exactNonceClaim.replacementRecoveryGeneration,
            claimedAt: serverReceivedAt,
          });
        await tx
          .update(schema.contentEncryptedVaultEndpoints)
          .set({ endpointState: "revoked", healthState: "revoked" })
          .where(
            and(
              eq(schema.contentEncryptedVaultEndpoints.vaultId, scope.vaultId),
              inArray(
                schema.contentEncryptedVaultEndpoints.endpointId,
                projection.next.removedEndpointIds,
              ),
            ),
          );
        await tx.insert(schema.contentEncryptedVaultEndpoints).values({
          ...scope,
          endpointId: member.endpointId,
          endpointState: "online",
          publicIdentityJson: endpointPublicIdentityJson(member),
          healthState: "healthy",
          serverReceivedAt,
        });
        await commitPrivateVaultCiphertextStageInTransaction(
          tx,
          wrapStage,
          serverReceivedAt,
        );
        await commitPrivateVaultCiphertextStageInTransaction(
          tx,
          evidenceStage,
          serverReceivedAt,
        );
      },
    });
  } catch {
    return verifiedRecoveryReceipt(receiptInput).catch(() => {
      throw new PrivateVaultControlLogAppendError("conflict");
    });
  } finally {
    nonceClaim.confirmationNonce.fill(0);
  }
  return verifiedRecoveryReceipt(receiptInput);
}
