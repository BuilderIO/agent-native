import { z } from "zod";

import { opaqueIdSchema } from "./contracts.js";
import { E2EE_SUITE_ID } from "./suite.js";

export const ANC_V1_MIGRATION_EVIDENCE_MAX_BYTES = 4096;

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const common = {
  version: z.literal(1),
  suite: z.literal(E2EE_SUITE_ID),
  type: z.literal("migration-evidence"),
  vaultId: opaqueIdSchema,
  migrationId: opaqueIdSchema,
  exportId: opaqueIdSchema,
  exportBundleHash: digestSchema,
  plaintextHash: digestSchema,
  sourceSnapshotHash: digestSchema,
  objectCount: z.number().int().positive().max(10_000),
};

export const ancV1MigrationEvidenceSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("export") }).strict(),
  z
    .object({
      ...common,
      kind: z.literal("recovery_drill"),
      recoveryDrillId: opaqueIdSchema,
    })
    .strict(),
]);

export type AncV1MigrationEvidence = z.infer<
  typeof ancV1MigrationEvidenceSchema
>;

export const ancV1MigrationEvidenceResponseSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("migration-evidence-response"),
    kind: z.enum(["export", "recovery_drill"]),
    state: z.literal("stored"),
    migrationId: opaqueIdSchema,
    evidenceId: opaqueIdSchema,
  })
  .strict();

export type AncV1MigrationEvidenceResponse = z.infer<
  typeof ancV1MigrationEvidenceResponseSchema
>;

function encodeCanonical(value: unknown): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  if (
    encoded.byteLength === 0 ||
    encoded.byteLength > ANC_V1_MIGRATION_EVIDENCE_MAX_BYTES
  ) {
    encoded.fill(0);
    throw new Error("Private Vault migration evidence is invalid");
  }
  return encoded;
}

function decodeCanonical<T>(bytes: Uint8Array, schema: z.ZodType<T>): T {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > ANC_V1_MIGRATION_EVIDENCE_MAX_BYTES
  )
    throw new Error("Private Vault migration evidence is invalid");
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = schema.parse(JSON.parse(text));
    if (JSON.stringify(parsed) !== text) throw new Error();
    return parsed;
  } catch {
    throw new Error("Private Vault migration evidence is invalid");
  }
}

export function encodeAncV1MigrationEvidence(
  input: AncV1MigrationEvidence,
): Uint8Array {
  return encodeCanonical(ancV1MigrationEvidenceSchema.parse(input));
}

export function decodeAncV1MigrationEvidence(
  bytes: Uint8Array,
): AncV1MigrationEvidence {
  return decodeCanonical(bytes, ancV1MigrationEvidenceSchema);
}

export function encodeAncV1MigrationEvidenceResponse(
  input: AncV1MigrationEvidenceResponse,
): Uint8Array {
  return encodeCanonical(ancV1MigrationEvidenceResponseSchema.parse(input));
}

export function decodeAncV1MigrationEvidenceResponse(
  bytes: Uint8Array,
): AncV1MigrationEvidenceResponse {
  return decodeCanonical(bytes, ancV1MigrationEvidenceResponseSchema);
}
