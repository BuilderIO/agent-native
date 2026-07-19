import { E2EE_SIZE_LIMITS, opaqueIdSchema } from "@agent-native/core/e2ee";
import { z } from "zod";

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });
const sourceDocumentIdSchema = z.string().min(1).max(256);
const boundedTextSchema = z.string().max(1024 * 1024);

export const PRIVATE_VAULT_MIGRATION_EXPORT_FORMAT =
  "agent-native-content-private-vault-export";
export const PRIVATE_VAULT_MIGRATION_EXPORT_VERSION = 1;

export const privateVaultMigrationExportDocumentSchema = z
  .object({
    sourceDocumentId: sourceDocumentIdSchema,
    parentSourceDocumentId: sourceDocumentIdSchema.nullable(),
    objectId: opaqueIdSchema,
    sourceDigest: digestSchema,
    sealedRevisionId: opaqueIdSchema,
    sealedCiphertextHash: digestSchema,
    title: boundedTextSchema,
    content: boundedTextSchema,
    description: boundedTextSchema,
    icon: z.string().max(16_384).nullable(),
    position: z.number().int().safe(),
    isFavorite: z.boolean(),
    hideFromSearch: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export type PrivateVaultMigrationExportDocument = z.infer<
  typeof privateVaultMigrationExportDocumentSchema
>;

export const privateVaultMigrationExportPayloadSchema = z
  .object({
    format: z.literal(PRIVATE_VAULT_MIGRATION_EXPORT_FORMAT),
    version: z.literal(PRIVATE_VAULT_MIGRATION_EXPORT_VERSION),
    vaultId: opaqueIdSchema,
    migrationId: opaqueIdSchema,
    sourceSnapshotHash: digestSchema,
    cutoverManifestObjectId: opaqueIdSchema,
    cutoverManifestRevisionId: opaqueIdSchema,
    cutoverManifestCiphertextHash: digestSchema,
    createdAt: timestampSchema,
    documents: z
      .array(privateVaultMigrationExportDocumentSchema)
      .min(1)
      .max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    const sourceIds = new Set(
      value.documents.map((item) => item.sourceDocumentId),
    );
    const objectIds = new Set(value.documents.map((item) => item.objectId));
    if (sourceIds.size !== value.documents.length) {
      context.addIssue({
        code: "custom",
        path: ["documents"],
        message: "Migration export source IDs must be unique",
      });
      return;
    }
    if (objectIds.size !== value.documents.length) {
      context.addIssue({
        code: "custom",
        path: ["documents"],
        message: "Migration export object IDs must be unique",
      });
      return;
    }
    const parentBySourceId = new Map(
      value.documents.map((item) => [
        item.sourceDocumentId,
        item.parentSourceDocumentId,
      ]),
    );
    for (let index = 0; index < value.documents.length; index += 1) {
      const parentId = value.documents[index]!.parentSourceDocumentId;
      if (parentId && !sourceIds.has(parentId))
        context.addIssue({
          code: "custom",
          path: ["documents", index, "parentSourceDocumentId"],
          message:
            "Migration export parents must be present in the same bundle",
        });
    }
    for (let index = 0; index < value.documents.length; index += 1) {
      const seen = new Set<string>();
      let cursor: string | null = value.documents[index]!.sourceDocumentId;
      while (cursor) {
        if (seen.has(cursor)) {
          context.addIssue({
            code: "custom",
            path: ["documents", index, "parentSourceDocumentId"],
            message: "Migration export document hierarchy must be acyclic",
          });
          break;
        }
        seen.add(cursor);
        cursor = parentBySourceId.get(cursor) ?? null;
      }
    }
  });

export type PrivateVaultMigrationExportPayload = z.infer<
  typeof privateVaultMigrationExportPayloadSchema
>;

export class PrivateVaultMigrationExportError extends Error {
  constructor() {
    super("Private Vault migration export verification failed");
    this.name = "PrivateVaultMigrationExportError";
  }
}

function compareSourceIds(
  left: PrivateVaultMigrationExportDocument,
  right: PrivateVaultMigrationExportDocument,
): number {
  return left.sourceDocumentId < right.sourceDocumentId
    ? -1
    : left.sourceDocumentId > right.sourceDocumentId
      ? 1
      : 0;
}

/** Encode the one canonical, independently restorable Content export payload. */
export function encodePrivateVaultMigrationExportPayload(
  input: PrivateVaultMigrationExportPayload,
): Uint8Array {
  let parsed: PrivateVaultMigrationExportPayload;
  try {
    parsed = privateVaultMigrationExportPayloadSchema.parse(input);
  } catch {
    throw new PrivateVaultMigrationExportError();
  }
  const canonical: PrivateVaultMigrationExportPayload = {
    format: PRIVATE_VAULT_MIGRATION_EXPORT_FORMAT,
    version: PRIVATE_VAULT_MIGRATION_EXPORT_VERSION,
    vaultId: parsed.vaultId,
    migrationId: parsed.migrationId,
    sourceSnapshotHash: parsed.sourceSnapshotHash,
    cutoverManifestObjectId: parsed.cutoverManifestObjectId,
    cutoverManifestRevisionId: parsed.cutoverManifestRevisionId,
    cutoverManifestCiphertextHash: parsed.cutoverManifestCiphertextHash,
    createdAt: parsed.createdAt,
    documents: [...parsed.documents].sort(compareSourceIds),
  };
  const encoded = new TextEncoder().encode(JSON.stringify(canonical));
  if (
    encoded.byteLength === 0 ||
    encoded.byteLength > E2EE_SIZE_LIMITS.exportPlaintextBytes
  ) {
    encoded.fill(0);
    throw new PrivateVaultMigrationExportError();
  }
  return encoded;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let different = 0;
  for (let index = 0; index < left.byteLength; index += 1)
    different |= left[index]! ^ right[index]!;
  return different === 0;
}

/** Decode only exact canonical bytes; duplicate keys and alternate JSON fail. */
export function decodePrivateVaultMigrationExportPayload(
  encoded: Uint8Array,
): PrivateVaultMigrationExportPayload {
  if (
    !(encoded instanceof Uint8Array) ||
    encoded.byteLength === 0 ||
    encoded.byteLength > E2EE_SIZE_LIMITS.exportPlaintextBytes
  )
    throw new PrivateVaultMigrationExportError();
  let canonical: Uint8Array | undefined;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(encoded);
    const parsed = privateVaultMigrationExportPayloadSchema.parse(
      JSON.parse(text),
    );
    canonical = encodePrivateVaultMigrationExportPayload(parsed);
    if (!equalBytes(encoded, canonical))
      throw new PrivateVaultMigrationExportError();
    return parsed;
  } catch (error) {
    if (error instanceof PrivateVaultMigrationExportError) throw error;
    throw new PrivateVaultMigrationExportError();
  } finally {
    canonical?.fill(0);
  }
}
