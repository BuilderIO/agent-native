import { z } from "zod";

import {
  boundedProtocolTokenSchema,
  contentFreeAccessEventSchema,
  disclosureEnvelopeSchema,
  E2EE_CONTRACT_VERSION,
  encryptedJobStateSchema,
  endpointPublicIdentitySchema,
  endpointStateSchema,
  opaqueAlgorithmIdSchema,
  opaqueIdSchema,
  opaqueProtocolPayloadSchema,
  opaqueRevisionSchema,
  protocolTimestampSchema,
  wrappedKeyEnvelopeSchema,
} from "./contracts.js";

/** Concrete hosted fields admitted by the personal-vault v1 metadata budget. */
export const PERSONAL_VAULT_V1_HOSTED_FIELDS = [
  "version",
  "accountId",
  "workspaceId",
  "vaultId",
  "vaultState",
  "objectId",
  "objectType",
  "objectState",
  "endpointId",
  "endpointState",
  "endpointPublicIdentity",
  "jobId",
  "jobHash",
  "grantId",
  "keyEpoch",
  "keyEpochState",
  "wrappedKeyEnvelope",
  "algorithmId",
  "ciphertext",
  "ciphertextByteLength",
  "opaqueRevision",
  "serverReceivedAt",
  "issuedAt",
  "expiresAt",
  "jobState",
  "leaseExpiresAt",
  "retryAt",
  "retryCount",
  "healthState",
  "accessEvent",
  "disclosureEnvelope",
] as const;

export const hostedProtectedFieldSchema = z.enum(
  PERSONAL_VAULT_V1_HOSTED_FIELDS,
);

export type HostedProtectedField = z.infer<typeof hostedProtectedFieldSchema>;

const hostedFieldValueSchemas = {
  version: z.literal(E2EE_CONTRACT_VERSION),
  accountId: opaqueIdSchema,
  workspaceId: opaqueIdSchema,
  vaultId: opaqueIdSchema,
  vaultState: z.enum(["active", "locked", "deleting", "deleted"]),
  objectId: opaqueIdSchema,
  objectType: boundedProtocolTokenSchema,
  objectState: z.enum(["active", "delete_pending", "deleted"]),
  endpointId: opaqueIdSchema,
  endpointState: endpointStateSchema,
  endpointPublicIdentity: endpointPublicIdentitySchema,
  jobId: opaqueIdSchema,
  jobHash: opaqueIdSchema,
  grantId: opaqueIdSchema,
  keyEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  keyEpochState: z.enum(["active", "retired", "revoked"]),
  wrappedKeyEnvelope: wrappedKeyEnvelopeSchema,
  algorithmId: opaqueAlgorithmIdSchema,
  ciphertext: opaqueProtocolPayloadSchema,
  ciphertextByteLength: z
    .number()
    .int()
    .nonnegative()
    .max(1024 * 1024 * 1024),
  opaqueRevision: opaqueRevisionSchema,
  serverReceivedAt: protocolTimestampSchema,
  issuedAt: protocolTimestampSchema,
  expiresAt: protocolTimestampSchema,
  jobState: encryptedJobStateSchema,
  leaseExpiresAt: protocolTimestampSchema.nullable(),
  retryAt: protocolTimestampSchema.nullable(),
  retryCount: z.number().int().nonnegative().max(100),
  healthState: z.enum(["healthy", "degraded", "offline", "unknown"]),
  accessEvent: contentFreeAccessEventSchema,
  disclosureEnvelope: disclosureEnvelopeSchema,
} satisfies Record<HostedProtectedField, z.ZodType>;

export const retentionRuleSchema = z
  .object({
    fields: z.array(hostedProtectedFieldSchema).min(1).max(32),
    liveRetention: z.enum([
      "while_vault_exists",
      "while_resource_exists",
      "while_endpoint_enrolled",
      "until_job_terminal",
      "fixed_days",
    ]),
    liveRetentionDays: z.number().int().positive().max(3650).nullable(),
    deletionTrigger: z.enum([
      "vault_deleted",
      "resource_deleted",
      "endpoint_removed",
      "job_terminal",
      "retention_elapsed",
    ]),
    activePurgeWithinDays: z.number().int().nonnegative().max(90),
    backupPurgeWithinDays: z.number().int().nonnegative().max(180),
  })
  .strict()
  .superRefine((value, ctx) => {
    const shouldHaveDays = value.liveRetention === "fixed_days";
    if (shouldHaveDays !== (value.liveRetentionDays !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["liveRetentionDays"],
        message: "Only fixed_days retention may specify liveRetentionDays",
      });
    }
  });

export const resourcePrivacyManifestSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    resourceType: z.string().min(1).max(120),
    protectedFields: z.array(z.string().min(1).max(160)).min(1).max(512),
    hostedFields: z.array(hostedProtectedFieldSchema).min(1).max(32),
    executionPlacement: z.enum(["trusted_endpoint", "enrolled_broker"]),
    egress: z
      .object({
        default: z.literal("deny"),
        requiresCapabilityGrant: z.literal(true),
        providerBound: z.literal(true),
        destinationBound: z.literal(true),
      })
      .strict(),
    admittedLeakage: z
      .array(
        z.enum([
          "ciphertext_sizes",
          "coarse_timing",
          "network_metadata",
          "opaque_access_patterns",
        ]),
      )
      .max(4),
    retention: z.array(retentionRuleSchema).min(1).max(32),
    failClosedFeatures: z.array(z.string().min(1).max(120)).min(1).max(128),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const allowed = new Set(manifest.hostedFields);
    if (allowed.size !== manifest.hostedFields.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hostedFields"],
        message: "Hosted fields must be unique",
      });
    }
    const retained = new Set<HostedProtectedField>();
    for (const rule of manifest.retention) {
      for (const field of rule.fields) {
        if (!allowed.has(field)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["retention"],
            message: `Retention field ${field} is not admitted by hostedFields`,
          });
        }
        if (retained.has(field)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["retention"],
            message: `Retention field ${field} has more than one rule`,
          });
        }
        retained.add(field);
      }
    }
    for (const field of allowed) {
      if (!retained.has(field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["retention"],
          message: `Hosted field ${field} has no retention and deletion rule`,
        });
      }
    }
  });

export type ResourcePrivacyManifest = z.infer<
  typeof resourcePrivacyManifestSchema
>;

export class HostedFieldViolationError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(
      `Protected hosted record contains unadmitted fields: ${fields.join(", ")}`,
    );
    this.name = "HostedFieldViolationError";
    this.fields = fields;
  }
}

export class HostedFieldValueViolationError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(
      `Protected hosted record contains invalid admitted fields: ${fields.join(", ")}`,
    );
    this.name = "HostedFieldValueViolationError";
    this.fields = fields;
  }
}

/**
 * Reject a protected record before it reaches hosted persistence when any
 * top-level field is outside the resource manifest's frozen metadata budget,
 * or an admitted field fails its strict value/container schema. Ciphertext is
 * intentionally treated as opaque bytes; this is structural validation, not
 * recursive key-name scanning or a cryptographic claim.
 */
export function assertHostedFieldsAllowed(
  manifestInput: unknown,
  hostedRecord: Record<string, unknown>,
): asserts manifestInput is ResourcePrivacyManifest {
  const manifest = resourcePrivacyManifestSchema.parse(manifestInput);
  const allowed = new Set<string>(manifest.hostedFields);
  const unexpected = Object.keys(hostedRecord)
    .filter((field) => !allowed.has(field))
    .sort();
  if (unexpected.length > 0) throw new HostedFieldViolationError(unexpected);

  const invalid = Object.entries(hostedRecord)
    .filter(([field, value]) => {
      const schema = hostedFieldValueSchemas[field as HostedProtectedField];
      return !schema.safeParse(value).success;
    })
    .map(([field]) => field)
    .sort();
  if (invalid.length > 0) throw new HostedFieldValueViolationError(invalid);
}

/** Exact v1 retention and deletion budget shared by protected resources. */
export const PERSONAL_VAULT_V1_RETENTION = [
  {
    fields: [
      "version",
      "accountId",
      "workspaceId",
      "vaultId",
      "vaultState",
    ] as HostedProtectedField[],
    liveRetention: "while_vault_exists" as const,
    liveRetentionDays: null,
    deletionTrigger: "vault_deleted" as const,
    activePurgeWithinDays: 30,
    backupPurgeWithinDays: 35,
  },
  {
    fields: [
      "objectId",
      "objectType",
      "objectState",
      "keyEpoch",
      "keyEpochState",
      "wrappedKeyEnvelope",
      "algorithmId",
      "ciphertext",
      "ciphertextByteLength",
      "opaqueRevision",
      "serverReceivedAt",
    ] as HostedProtectedField[],
    liveRetention: "while_resource_exists" as const,
    liveRetentionDays: null,
    deletionTrigger: "resource_deleted" as const,
    activePurgeWithinDays: 30,
    backupPurgeWithinDays: 35,
  },
  {
    fields: [
      "endpointId",
      "endpointState",
      "endpointPublicIdentity",
      "healthState",
    ] as HostedProtectedField[],
    liveRetention: "while_endpoint_enrolled" as const,
    liveRetentionDays: null,
    deletionTrigger: "endpoint_removed" as const,
    activePurgeWithinDays: 30,
    backupPurgeWithinDays: 35,
  },
  {
    fields: [
      "jobId",
      "jobHash",
      "grantId",
      "issuedAt",
      "expiresAt",
      "jobState",
      "leaseExpiresAt",
      "retryAt",
      "retryCount",
    ] as HostedProtectedField[],
    liveRetention: "until_job_terminal" as const,
    liveRetentionDays: null,
    deletionTrigger: "job_terminal" as const,
    activePurgeWithinDays: 30,
    backupPurgeWithinDays: 35,
  },
  {
    fields: ["accessEvent", "disclosureEnvelope"] as HostedProtectedField[],
    liveRetention: "fixed_days" as const,
    liveRetentionDays: 90,
    deletionTrigger: "retention_elapsed" as const,
    activePurgeWithinDays: 7,
    backupPurgeWithinDays: 35,
  },
] satisfies z.input<typeof retentionRuleSchema>[];

export const PERSONAL_VAULT_V1_ADMITTED_LEAKAGE = [
  "ciphertext_sizes",
  "coarse_timing",
  "network_metadata",
  "opaque_access_patterns",
] as const;

/** The exact, versioned M2 hosted metadata and retention/deletion budget. */
export const PERSONAL_VAULT_V1_METADATA_BUDGET = {
  version: E2EE_CONTRACT_VERSION,
  hostedFields: PERSONAL_VAULT_V1_HOSTED_FIELDS,
  admittedLeakage: PERSONAL_VAULT_V1_ADMITTED_LEAKAGE,
  retention: PERSONAL_VAULT_V1_RETENTION,
} as const;
