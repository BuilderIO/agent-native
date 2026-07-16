import {
  assertHostedFieldsAllowed,
  boundedProtocolTokenSchema,
  contentFreeAccessEventSchema,
  disclosureEnvelopeSchema,
  E2EE_CONTRACT_VERSION,
  E2EE_SIZE_LIMITS,
  encryptedJobStateSchema,
  endpointPublicIdentitySchema,
  endpointStateSchema,
  keyEpochSchema,
  KNOWN_PLAINTEXT_SENTINEL,
  opaqueAlgorithmIdSchema,
  opaqueIdSchema,
  opaqueRevisionSchema,
  protocolTimestampSchema,
} from "@agent-native/core/e2ee";
import { z } from "zod";

import { CONTENT_PRIVATE_VAULT_V1_PRIVACY_MANIFEST } from "./private-vault-privacy-manifest";

const authScopeShape = {
  ownerEmail: z.string().email().max(320),
  orgId: z.string().max(160),
};
const versionShape = { version: z.literal(E2EE_CONTRACT_VERSION) };
const byteLength = (maximum: number) =>
  z.number().int().nonnegative().max(maximum);

export const privateVaultStateSchema = z.enum([
  "active",
  "locked",
  "deleting",
  "deleted",
]);
export const privateVaultObjectStateSchema = z.enum([
  "active",
  "delete_pending",
  "deleted",
]);
export const privateVaultHealthStateSchema = z.enum([
  "healthy",
  "degraded",
  "offline",
  "unknown",
]);

export interface PrivateVaultAuthScope {
  ownerEmail: string;
  orgId: string;
}

export interface ValidatedPrivateVaultHostedRecord {
  scope: PrivateVaultAuthScope;
  logical: Record<string, unknown>;
}

function validateLogical(
  scope: PrivateVaultAuthScope,
  logical: Record<string, unknown>,
): ValidatedPrivateVaultHostedRecord {
  assertHostedFieldsAllowed(CONTENT_PRIVATE_VAULT_V1_PRIVACY_MANIFEST, logical);
  if (JSON.stringify(logical).includes(KNOWN_PLAINTEXT_SENTINEL)) {
    throw new Error("Known protected plaintext reached a hosted record");
  }
  return { scope, logical };
}

function exactJson<T>(raw: string, schema: z.ZodType<T>, label: string): T {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  const parsed = schema.parse(decoded);
  if (JSON.stringify(parsed) !== raw) {
    throw new Error(`${label} must use the exact canonical JSON round trip`);
  }
  return parsed;
}

function splitScope<T extends PrivateVaultAuthScope>(
  value: T,
): {
  scope: PrivateVaultAuthScope;
  rest: Omit<T, keyof PrivateVaultAuthScope>;
} {
  const { ownerEmail, orgId, ...rest } = value;
  return { scope: { ownerEmail, orgId }, rest };
}

const vaultRowSchema = z
  .object({
    ...authScopeShape,
    ...versionShape,
    accountId: opaqueIdSchema,
    workspaceId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    vaultState: privateVaultStateSchema,
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict();

export function validatePrivateVaultRow(
  input: unknown,
): ValidatedPrivateVaultHostedRecord {
  const { scope, rest } = splitScope(vaultRowSchema.parse(input));
  return validateLogical(scope, rest);
}

const endpointRowSchema = z
  .object({
    ...authScopeShape,
    ...versionShape,
    vaultId: opaqueIdSchema,
    endpointId: opaqueIdSchema,
    endpointState: endpointStateSchema,
    publicIdentityJson: z
      .string()
      .min(2)
      .max(40 * 1024),
    healthState: privateVaultHealthStateSchema,
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict();

export function validatePrivateVaultEndpointRow(
  input: unknown,
): ValidatedPrivateVaultHostedRecord {
  const parsed = endpointRowSchema.parse(input);
  const { scope, rest } = splitScope(parsed);
  const { publicIdentityJson, ...coordinates } = rest;
  return validateLogical(scope, {
    ...coordinates,
    endpointPublicIdentity: exactJson(
      publicIdentityJson,
      endpointPublicIdentitySchema,
      "publicIdentityJson",
    ),
  });
}

const keyEpochRowSchema = z
  .object({
    ...authScopeShape,
    ...versionShape,
    id: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    state: z.enum(["active", "retired", "revoked"]),
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict();

export function validatePrivateVaultKeyEpochRow(
  input: unknown,
): ValidatedPrivateVaultHostedRecord {
  const parsed = keyEpochRowSchema.parse(input);
  if (parsed.id !== `${parsed.vaultId}:${parsed.epoch}`) {
    throw new Error("Key-epoch surrogate does not match its vault and epoch");
  }
  keyEpochSchema.parse({
    version: parsed.version,
    vaultId: parsed.vaultId,
    epoch: parsed.epoch,
    state: parsed.state,
    serverReceivedAt: parsed.serverReceivedAt,
  });
  const { scope, rest } = splitScope(parsed);
  const { id: _id, epoch, state, ...coordinates } = rest;
  return validateLogical(scope, {
    ...coordinates,
    keyEpoch: epoch,
    keyEpochState: state,
  });
}

const keyEnvelopeRowSchema = z
  .object({
    ...authScopeShape,
    ...versionShape,
    envelopeId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    senderEndpointId: opaqueIdSchema,
    recipientEndpointId: opaqueIdSchema,
    algorithmId: opaqueAlgorithmIdSchema,
    ciphertextByteLength: byteLength(256 * 1024),
    expiresAt: protocolTimestampSchema.nullable(),
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict();

export function validatePrivateVaultKeyEnvelopeRow(
  input: unknown,
): ValidatedPrivateVaultHostedRecord {
  const parsed = keyEnvelopeRowSchema.parse(input);
  const { scope, rest } = splitScope(parsed);
  const {
    envelopeId: _envelopeId,
    senderEndpointId: _senderEndpointId,
    recipientEndpointId,
    epoch,
    ...coordinates
  } = rest;
  return validateLogical(scope, {
    ...coordinates,
    endpointId: recipientEndpointId,
    keyEpoch: epoch,
  });
}

const grantRowSchema = z
  .object({
    ...authScopeShape,
    ...versionShape,
    grantId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    recipientEndpointId: opaqueIdSchema,
    algorithmId: opaqueAlgorithmIdSchema,
    ciphertextByteLength: byteLength(E2EE_SIZE_LIMITS.controlEnvelopeBytes),
    issuedAt: protocolTimestampSchema,
    expiresAt: protocolTimestampSchema,
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Grant expiry must be later than issuance",
      });
    }
  });

export function validatePrivateVaultGrantRow(
  input: unknown,
): ValidatedPrivateVaultHostedRecord {
  const parsed = grantRowSchema.parse(input);
  const { scope, rest } = splitScope(parsed);
  const { recipientEndpointId, ...coordinates } = rest;
  return validateLogical(scope, {
    ...coordinates,
    endpointId: recipientEndpointId,
  });
}

const disclosureRowSchema = z
  .object({
    ...authScopeShape,
    ...versionShape,
    disclosureId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    grantId: opaqueIdSchema,
    endpointId: opaqueIdSchema,
    disclosureEnvelopeJson: z
      .string()
      .min(2)
      .max(64 * 1024),
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict();

export function validatePrivateVaultDisclosureRow(
  input: unknown,
): ValidatedPrivateVaultHostedRecord {
  const parsed = disclosureRowSchema.parse(input);
  const envelope = exactJson(
    parsed.disclosureEnvelopeJson,
    disclosureEnvelopeSchema,
    "disclosureEnvelopeJson",
  );
  if (
    envelope.disclosureId !== parsed.disclosureId ||
    envelope.vaultId !== parsed.vaultId ||
    envelope.grantId !== parsed.grantId ||
    envelope.endpointId !== parsed.endpointId
  ) {
    throw new Error(
      "Disclosure envelope does not match its hosted coordinates",
    );
  }
  const { scope, rest } = splitScope(parsed);
  const {
    disclosureEnvelopeJson: _disclosureEnvelopeJson,
    disclosureId: _disclosureId,
    endpointId: _endpointId,
    ...coordinates
  } = rest;
  return validateLogical(scope, {
    ...coordinates,
    disclosureEnvelope: envelope,
  });
}

const objectRowSchema = z
  .object({
    ...authScopeShape,
    ...versionShape,
    vaultId: opaqueIdSchema,
    objectId: opaqueIdSchema,
    objectType: boundedProtocolTokenSchema,
    objectState: privateVaultObjectStateSchema,
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict();

export function validatePrivateVaultObjectRow(
  input: unknown,
): ValidatedPrivateVaultHostedRecord {
  const { scope, rest } = splitScope(objectRowSchema.parse(input));
  return validateLogical(scope, rest);
}

const revisionRowSchema = z
  .object({
    ...authScopeShape,
    ...versionShape,
    vaultId: opaqueIdSchema,
    objectId: opaqueIdSchema,
    revisionId: opaqueIdSchema,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    algorithmId: opaqueAlgorithmIdSchema,
    ciphertextByteLength: byteLength(E2EE_SIZE_LIMITS.objectPlaintextBytes),
    opaqueRevisionJson: z
      .string()
      .min(2)
      .max(64 * 1024),
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict();

export function validatePrivateVaultRevisionRow(
  input: unknown,
): ValidatedPrivateVaultHostedRecord {
  const parsed = revisionRowSchema.parse(input);
  const revision = exactJson(
    parsed.opaqueRevisionJson,
    opaqueRevisionSchema,
    "opaqueRevisionJson",
  );
  if (
    revision.vaultId !== parsed.vaultId ||
    revision.objectId !== parsed.objectId ||
    revision.revisionId !== parsed.revisionId ||
    revision.epoch !== parsed.epoch ||
    revision.ciphertextByteLength !== parsed.ciphertextByteLength ||
    revision.serverReceivedAt !== parsed.serverReceivedAt
  ) {
    throw new Error("Opaque revision does not match its hosted coordinates");
  }
  const { scope, rest } = splitScope(parsed);
  const {
    revisionId: _revisionId,
    epoch,
    opaqueRevisionJson: _opaqueRevisionJson,
    ...coordinates
  } = rest;
  return validateLogical(scope, {
    ...coordinates,
    keyEpoch: epoch,
    opaqueRevision: revision,
  });
}

const syncEventRowSchema = z
  .object({
    ...authScopeShape,
    ...versionShape,
    eventId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    objectId: opaqueIdSchema.nullable(),
    eventType: boundedProtocolTokenSchema,
    opaqueRevisionJson: z
      .string()
      .min(2)
      .max(64 * 1024)
      .nullable(),
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict();

export function validatePrivateVaultSyncEventRow(
  input: unknown,
): ValidatedPrivateVaultHostedRecord {
  const parsed = syncEventRowSchema.parse(input);
  const revision = parsed.opaqueRevisionJson
    ? exactJson(
        parsed.opaqueRevisionJson,
        opaqueRevisionSchema,
        "opaqueRevisionJson",
      )
    : null;
  if (
    revision &&
    (parsed.objectId === null ||
      revision.vaultId !== parsed.vaultId ||
      revision.objectId !== parsed.objectId)
  ) {
    throw new Error(
      "Sync-event revision does not match its hosted coordinates",
    );
  }
  const { scope, rest } = splitScope(parsed);
  const {
    eventId: _eventId,
    eventType,
    opaqueRevisionJson: _opaqueRevisionJson,
    objectId,
    ...coordinates
  } = rest;
  return validateLogical(scope, {
    ...coordinates,
    ...(objectId ? { objectId } : {}),
    objectType: eventType,
    ...(revision ? { opaqueRevision: revision } : {}),
  });
}

const jobRowSchema = z
  .object({
    ...authScopeShape,
    ...versionShape,
    jobId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    grantId: opaqueIdSchema,
    recipientEndpointId: opaqueIdSchema,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    algorithmId: opaqueAlgorithmIdSchema,
    ciphertextByteLength: byteLength(E2EE_SIZE_LIMITS.jobPayloadBytes),
    issuedAt: protocolTimestampSchema,
    expiresAt: protocolTimestampSchema,
    jobState: encryptedJobStateSchema,
    retryCount: z.number().int().nonnegative().max(100),
    retryAt: protocolTimestampSchema.nullable(),
    leaseExpiresAt: protocolTimestampSchema.nullable(),
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Job expiry must be later than issuance",
      });
    }
    if (value.retryAt !== null && value.jobState !== "retry_wait") {
      ctx.addIssue({
        code: "custom",
        path: ["retryAt"],
        message: "Only retry_wait jobs may carry retryAt",
      });
    }
    if (value.leaseExpiresAt !== null && value.jobState !== "leased") {
      ctx.addIssue({
        code: "custom",
        path: ["leaseExpiresAt"],
        message: "Only leased jobs may carry leaseExpiresAt",
      });
    }
  });

export function validatePrivateVaultJobRow(
  input: unknown,
): ValidatedPrivateVaultHostedRecord {
  const parsed = jobRowSchema.parse(input);
  const { scope, rest } = splitScope(parsed);
  const { recipientEndpointId, epoch, ...coordinates } = rest;
  return validateLogical(scope, {
    ...coordinates,
    endpointId: recipientEndpointId,
    keyEpoch: epoch,
  });
}

const resultRowSchema = z
  .object({
    ...authScopeShape,
    ...versionShape,
    jobId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    endpointId: opaqueIdSchema,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    jobHash: opaqueIdSchema,
    algorithmId: opaqueAlgorithmIdSchema,
    ciphertextByteLength: byteLength(E2EE_SIZE_LIMITS.resultPayloadBytes),
    jobState: z.enum(["completed", "failed", "cancelled"]),
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict();

export function validatePrivateVaultJobResultRow(
  input: unknown,
): ValidatedPrivateVaultHostedRecord {
  const parsed = resultRowSchema.parse(input);
  const { scope, rest } = splitScope(parsed);
  const { epoch, ...coordinates } = rest;
  return validateLogical(scope, {
    ...coordinates,
    keyEpoch: epoch,
  });
}

const accessEventRowSchema = z
  .object({
    ...authScopeShape,
    ...versionShape,
    accessEventId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    accessEventJson: z
      .string()
      .min(2)
      .max(64 * 1024),
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict();

export function validatePrivateVaultAccessEventRow(
  input: unknown,
): ValidatedPrivateVaultHostedRecord {
  const parsed = accessEventRowSchema.parse(input);
  const event = exactJson(
    parsed.accessEventJson,
    contentFreeAccessEventSchema,
    "accessEventJson",
  );
  if (
    event.accessEventId !== parsed.accessEventId ||
    event.vaultId !== parsed.vaultId
  ) {
    throw new Error("Access event does not match its hosted coordinates");
  }
  const { scope, rest } = splitScope(parsed);
  const {
    accessEventId: _accessEventId,
    accessEventJson: _accessEventJson,
    ...coordinates
  } = rest;
  return validateLogical(scope, { ...coordinates, accessEvent: event });
}
