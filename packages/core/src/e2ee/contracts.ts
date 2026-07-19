import { z } from "zod";

import { E2EE_SIZE_LIMITS } from "./suite.js";

/**
 * Wire contracts for an end-to-end encrypted personal vault.
 *
 * These contracts intentionally treat algorithms and cryptographic payloads as
 * opaque, versioned values. They select no primitive and perform no
 * cryptography; that decision belongs to the separately reviewed crypto layer.
 */

export const E2EE_CONTRACT_VERSION = 1 as const;

export const opaqueIdSchema = z
  .string()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const boundedLabel = z.string().min(1).max(120);
export const boundedProtocolTokenSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9._:-]*$/);
export const protocolTimestampSchema = z.string().datetime({ offset: true });
export const opaqueProtocolPayloadSchema = z
  .string()
  .min(1)
  .max(8 * 1024 * 1024);

function boundedOpaquePayloadSchema(maxBytes: number) {
  return z
    .string()
    .min(1)
    .max(maxBytes)
    .superRefine((value, ctx) => {
      if (new TextEncoder().encode(value).byteLength > maxBytes) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Opaque payload exceeds ${maxBytes} bytes`,
        });
      }
    });
}

/** Wire-only ciphertext bodies. Persist large bodies in protected blob storage. */
export const opaqueObjectCiphertextSchema = boundedOpaquePayloadSchema(
  E2EE_SIZE_LIMITS.objectPlaintextBytes,
);
export const opaqueJobCiphertextSchema = boundedOpaquePayloadSchema(
  E2EE_SIZE_LIMITS.jobEnvelopeBytes,
);
export const opaqueResultCiphertextSchema = boundedOpaquePayloadSchema(
  E2EE_SIZE_LIMITS.resultEnvelopeBytes,
);
export const opaqueAlgorithmIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/);

export const encryptionDomainSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    kind: z.literal("personal_vault"),
    vaultId: opaqueIdSchema,
    ownerIdentityId: opaqueIdSchema,
    accountId: opaqueIdSchema,
    workspaceId: opaqueIdSchema,
    createdAt: protocolTimestampSchema,
    state: z.enum(["active", "locked", "deleting", "deleted"]),
  })
  .strict();

export const endpointPublicIdentitySchema = z
  .object({
    algorithmId: opaqueAlgorithmIdSchema,
    publicIdentity: opaqueProtocolPayloadSchema.max(32 * 1024),
  })
  .strict();

export const endpointIdentitySchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    endpointId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    identityId: opaqueIdSchema,
    kind: z.enum([
      "desktop",
      "recovery_device",
      "personal_node",
      "user_cloud_broker",
    ]),
    publicIdentity: endpointPublicIdentitySchema,
    softwareIdentity: z
      .object({
        product: boundedLabel,
        version: boundedLabel,
        buildId: opaqueIdSchema,
      })
      .strict(),
    enrolledAt: protocolTimestampSchema,
  })
  .strict();

export const endpointStateSchema = z.enum([
  "online",
  "offline",
  "revoked",
  "removed",
]);

export const endpointStatusSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    endpointId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    state: endpointStateSchema,
    serverReceivedAt: protocolTimestampSchema,
    lastIntegrityAt: protocolTimestampSchema.nullable(),
  })
  .strict();

export const keyEpochSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    vaultId: opaqueIdSchema,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    state: z.enum(["active", "retired", "revoked"]),
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict();

export const wrappedKeyEnvelopeSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    envelopeId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    senderEndpointId: opaqueIdSchema,
    recipientEndpointId: opaqueIdSchema,
    algorithmId: opaqueAlgorithmIdSchema,
    wrappedKey: opaqueProtocolPayloadSchema.max(256 * 1024),
    serverReceivedAt: protocolTimestampSchema,
    expiresAt: protocolTimestampSchema.nullable(),
  })
  .strict();

export const capabilityResourceSchema = z
  .object({
    resourceType: boundedProtocolTokenSchema,
    resourceId: opaqueIdSchema,
  })
  .strict();

export const capabilityProviderSchema = z
  .object({
    providerId: opaqueIdSchema,
    destinationId: opaqueIdSchema.nullable(),
  })
  .strict();

export const capabilityGrantSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    grantId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    issuerIdentityId: opaqueIdSchema,
    subject: z
      .object({
        identityId: opaqueIdSchema,
        endpointId: opaqueIdSchema,
        agentId: opaqueIdSchema.nullable(),
      })
      .strict(),
    resources: z.array(capabilityResourceSchema).min(1).max(256),
    operations: z.array(boundedProtocolTokenSchema).min(1).max(128),
    providers: z.array(capabilityProviderSchema).min(1).max(64),
    issuedAt: protocolTimestampSchema,
    expiresAt: protocolTimestampSchema,
    revokedAt: protocolTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((grant, ctx) => {
    const issuedAt = Date.parse(grant.issuedAt);
    if (Date.parse(grant.expiresAt) <= issuedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Capability expiry must be later than issuance",
      });
    }
    if (grant.revokedAt !== null && Date.parse(grant.revokedAt) < issuedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["revokedAt"],
        message: "Capability revocation cannot predate issuance",
      });
    }
    const resourceKeys = grant.resources.map(
      (resource) => `${resource.resourceType}\u0000${resource.resourceId}`,
    );
    if (new Set(resourceKeys).size !== resourceKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resources"],
        message: "Capability resources must be unique",
      });
    }
    if (new Set(grant.operations).size !== grant.operations.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operations"],
        message: "Capability operations must be unique",
      });
    }
    const providerKeys = grant.providers.map(
      (provider) =>
        `${provider.providerId}\u0000${provider.destinationId ?? ""}`,
    );
    if (new Set(providerKeys).size !== providerKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providers"],
        message: "Capability providers and destinations must be unique",
      });
    }
  });

export const disclosureEnvelopeSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    disclosureId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    grantId: opaqueIdSchema,
    identityId: opaqueIdSchema,
    endpointId: opaqueIdSchema,
    agentId: opaqueIdSchema.nullable(),
    resources: z.array(capabilityResourceSchema).min(1).max(256),
    operation: boundedProtocolTokenSchema,
    provider: capabilityProviderSchema.nullable(),
    occurredAt: protocolTimestampSchema,
    outcome: z.enum(["allowed", "denied", "cancelled", "failed"]),
    sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    previousDigest: opaqueIdSchema.nullable(),
    envelopeDigest: opaqueIdSchema,
  })
  .strict();

export const contentFreeAccessEventSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    accessEventId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    identityId: opaqueIdSchema,
    endpointId: opaqueIdSchema,
    resource: capabilityResourceSchema,
    operation: boundedProtocolTokenSchema,
    occurredAt: protocolTimestampSchema,
    outcome: z.enum(["allowed", "denied"]),
  })
  .strict();

export const opaqueRevisionSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    vaultId: opaqueIdSchema,
    objectId: opaqueIdSchema,
    revisionId: opaqueIdSchema,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    parentRevisionIds: z.array(opaqueIdSchema).max(32),
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    ciphertextByteLength: z
      .number()
      .int()
      .nonnegative()
      .max(1024 * 1024 * 1024),
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict();

export const ciphertextObjectSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    accountId: opaqueIdSchema,
    workspaceId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    objectId: opaqueIdSchema,
    objectType: boundedProtocolTokenSchema,
    opaqueRevision: opaqueRevisionSchema,
    algorithmId: opaqueAlgorithmIdSchema,
    ciphertext: opaqueObjectCiphertextSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.opaqueRevision.vaultId !== value.vaultId ||
      value.opaqueRevision.objectId !== value.objectId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Revision identity must match its ciphertext object",
      });
    }
    if (
      new TextEncoder().encode(value.ciphertext).byteLength !==
      value.opaqueRevision.ciphertextByteLength
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ciphertext"],
        message: "Ciphertext byte length must match the opaque revision",
      });
    }
  });

export const encryptedJobEnvelopeSchema = z
  .object({
    algorithmId: opaqueAlgorithmIdSchema,
    ciphertext: opaqueJobCiphertextSchema,
    ciphertextByteLength: z
      .number()
      .int()
      .nonnegative()
      .max(E2EE_SIZE_LIMITS.jobEnvelopeBytes),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new TextEncoder().encode(value.ciphertext).byteLength !==
      value.ciphertextByteLength
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ciphertextByteLength"],
        message: "Job ciphertext byte length does not match the payload",
      });
    }
  });

export const encryptedResultEnvelopeSchema = z
  .object({
    algorithmId: opaqueAlgorithmIdSchema,
    ciphertext: opaqueResultCiphertextSchema,
    ciphertextByteLength: z
      .number()
      .int()
      .nonnegative()
      .max(E2EE_SIZE_LIMITS.resultEnvelopeBytes),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new TextEncoder().encode(value.ciphertext).byteLength !==
      value.ciphertextByteLength
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ciphertextByteLength"],
        message: "Result ciphertext byte length does not match the payload",
      });
    }
  });

export const encryptedJobStateSchema = z.enum([
  "queued",
  "leased",
  "acknowledged",
  "retry_wait",
  "cancelled",
  "completed",
  "failed",
]);

export const encryptedQueuedJobSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    jobId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    grantId: opaqueIdSchema,
    recipientEndpointId: opaqueIdSchema,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    request: encryptedJobEnvelopeSchema,
    issuedAt: protocolTimestampSchema,
    expiresAt: protocolTimestampSchema,
    state: encryptedJobStateSchema,
    serverReceivedAt: protocolTimestampSchema,
    leaseExpiresAt: protocolTimestampSchema.nullable(),
    retryAt: protocolTimestampSchema.nullable(),
    retryCount: z.number().int().nonnegative().max(100),
  })
  .strict()
  .superRefine((job, ctx) => {
    if (Date.parse(job.expiresAt) <= Date.parse(job.issuedAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Encrypted job expiry must be later than issuance",
      });
    }
    if (job.retryAt !== null && job.state !== "retry_wait") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["retryAt"],
        message: "Only retry_wait jobs may carry retryAt",
      });
    }
  });

export const encryptedJobResultSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    jobId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    recipientEndpointId: opaqueIdSchema,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    jobHash: opaqueIdSchema,
    result: encryptedResultEnvelopeSchema,
    state: z.enum(["completed", "failed"]),
    serverReceivedAt: protocolTimestampSchema,
  })
  .strict();

export type EncryptionDomain = z.infer<typeof encryptionDomainSchema>;
export type EndpointIdentity = z.infer<typeof endpointIdentitySchema>;
export type EndpointStatus = z.infer<typeof endpointStatusSchema>;
export type KeyEpoch = z.infer<typeof keyEpochSchema>;
export type WrappedKeyEnvelope = z.infer<typeof wrappedKeyEnvelopeSchema>;
export type CapabilityGrant = z.infer<typeof capabilityGrantSchema>;
export type DisclosureEnvelope = z.infer<typeof disclosureEnvelopeSchema>;
export type ContentFreeAccessEvent = z.infer<
  typeof contentFreeAccessEventSchema
>;
export type OpaqueRevision = z.infer<typeof opaqueRevisionSchema>;
export type CiphertextObject = z.infer<typeof ciphertextObjectSchema>;
export type EncryptedQueuedJob = z.infer<typeof encryptedQueuedJobSchema>;
export type EncryptedJobResult = z.infer<typeof encryptedJobResultSchema>;
