import {
  E2EE_SIZE_LIMITS,
  opaqueIdSchema,
  protocolTimestampSchema,
} from "@agent-native/core/e2ee";
import { z } from "zod";

/** Plaintext codecs bundled inside the signed Desktop trust boundary. */
export const PRIVATE_VAULT_CONTENT_TYPE =
  "application/vnd.agent-native.content-document+json";
export const PRIVATE_VAULT_MANIFEST_CONTENT_TYPE =
  "application/vnd.agent-native.content-vault-manifest+json";

const safePositionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const revisionNumberSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const privateVaultContentDocumentSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("content-document"),
    id: opaqueIdSchema,
    parentId: opaqueIdSchema.nullable(),
    title: z.string().max(16_384),
    content: z.string().max(E2EE_SIZE_LIMITS.objectPlaintextBytes),
    description: z.string().max(131_072).nullable(),
    icon: z.string().max(256).nullable(),
    position: safePositionSchema,
    isFavorite: z.boolean(),
    hideFromSearch: z.boolean(),
    createdAt: protocolTimestampSchema,
    updatedAt: protocolTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.parentId === value.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentId"],
        message: "A document cannot contain itself",
      });
    }
    if (value.updatedAt < value.createdAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updatedAt"],
        message: "Document update time cannot precede creation",
      });
    }
  });

export type PrivateVaultContentDocument = z.infer<
  typeof privateVaultContentDocumentSchema
>;

export const privateVaultManifestRevisionSchema = z
  .object({
    revision: revisionNumberSchema,
    revisionId: opaqueIdSchema,
    parentRevisionIds: z.array(opaqueIdSchema).max(32),
  })
  .strict();

export const privateVaultManifestDocumentSchema = z
  .object({
    objectId: opaqueIdSchema,
    parentId: opaqueIdSchema.nullable().optional(),
    position: safePositionSchema.optional(),
    revisions: z.array(privateVaultManifestRevisionSchema).min(1).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    let previous = 0;
    const revisionIds = new Set<string>();
    for (const [index, revision] of value.revisions.entries()) {
      if (revision.revision <= previous) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["revisions", index, "revision"],
          message: "Revision numbers must be strictly increasing",
        });
      }
      if (revisionIds.has(revision.revisionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["revisions", index, "revisionId"],
          message: "Revision identifiers must be unique",
        });
      }
      previous = revision.revision;
      revisionIds.add(revision.revisionId);
    }
  });

export const privateVaultContentManifestSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("content-vault-manifest"),
    vaultId: opaqueIdSchema,
    generation: revisionNumberSchema,
    previousManifest: z
      .object({
        objectId: opaqueIdSchema,
        revisionId: opaqueIdSchema,
      })
      .strict()
      .nullable(),
    documents: z.array(privateVaultManifestDocumentSchema).max(10_000),
    committedAt: protocolTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.generation === 1 && value.previousManifest !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["previousManifest"],
        message: "The first manifest cannot name a predecessor",
      });
    }
    if (value.generation > 1 && value.previousManifest === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["previousManifest"],
        message: "Later manifests must name their predecessor",
      });
    }
    const objectIds = new Set<string>();
    let structuredEntries = 0;
    for (const [index, document] of value.documents.entries()) {
      if (objectIds.has(document.objectId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["documents", index, "objectId"],
          message: "Manifest document identifiers must be unique",
        });
      }
      objectIds.add(document.objectId);
      if (document.parentId !== undefined || document.position !== undefined) {
        structuredEntries += 1;
        if (
          document.parentId === undefined ||
          document.position === undefined
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["documents", index],
            message: "Manifest structure must be complete",
          });
        }
      }
    }
    if (structuredEntries > 0 && structuredEntries !== value.documents.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["documents"],
        message: "Manifest structure cannot be partial",
      });
      return;
    }
    if (structuredEntries === value.documents.length) {
      const byId = new Map(
        value.documents.map(
          (document) => [document.objectId, document] as const,
        ),
      );
      for (const [index, document] of value.documents.entries()) {
        if (document.parentId === undefined || document.position === undefined)
          continue;
        if (
          document.parentId === document.objectId ||
          (document.parentId !== null && !byId.has(document.parentId))
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["documents", index, "parentId"],
            message: "Manifest parent is unavailable",
          });
          continue;
        }
        const visited = new Set<string>([document.objectId]);
        let parentId: string | null = document.parentId;
        while (parentId !== null) {
          if (visited.has(parentId)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["documents", index, "parentId"],
              message: "Manifest structure must be acyclic",
            });
            break;
          }
          visited.add(parentId);
          parentId = byId.get(parentId)?.parentId ?? null;
        }
      }
    }
  });

export type PrivateVaultContentManifest = z.infer<
  typeof privateVaultContentManifestSchema
>;

export const privateVaultLocalManifestHeadSchema = z
  .object({
    version: z.literal(1),
    objectId: opaqueIdSchema,
    revisionId: opaqueIdSchema,
    manifest: privateVaultContentManifestSchema,
  })
  .strict();

export type PrivateVaultLocalManifestHead = z.infer<
  typeof privateVaultLocalManifestHeadSchema
>;

function encodeCanonical<T>(schema: z.ZodType<T>, value: unknown): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(schema.parse(value)));
  if (encoded.byteLength > E2EE_SIZE_LIMITS.objectPlaintextBytes) {
    throw new Error("Private Vault content exceeds the encrypted object limit");
  }
  return encoded;
}

function decodeCanonical<T>(schema: z.ZodType<T>, bytes: Uint8Array): T {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > E2EE_SIZE_LIMITS.objectPlaintextBytes
  ) {
    throw new Error("Private Vault content is unavailable");
  }
  let raw: string;
  let decoded: unknown;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    decoded = JSON.parse(raw);
  } catch {
    throw new Error("Private Vault content is unavailable");
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success || JSON.stringify(parsed.data) !== raw) {
    throw new Error("Private Vault content is unavailable");
  }
  return parsed.data;
}

export function encodePrivateVaultContentDocument(
  value: PrivateVaultContentDocument,
): Uint8Array {
  return encodeCanonical(privateVaultContentDocumentSchema, value);
}

export function decodePrivateVaultContentDocument(
  bytes: Uint8Array,
): PrivateVaultContentDocument {
  return decodeCanonical(privateVaultContentDocumentSchema, bytes);
}

export function encodePrivateVaultContentManifest(
  value: PrivateVaultContentManifest,
): Uint8Array {
  return encodeCanonical(privateVaultContentManifestSchema, value);
}

export function decodePrivateVaultContentManifest(
  bytes: Uint8Array,
): PrivateVaultContentManifest {
  return decodeCanonical(privateVaultContentManifestSchema, bytes);
}

export function encodePrivateVaultLocalManifestHead(
  value: PrivateVaultLocalManifestHead,
): Uint8Array {
  return encodeCanonical(privateVaultLocalManifestHeadSchema, value);
}

export function decodePrivateVaultLocalManifestHead(
  bytes: Uint8Array,
): PrivateVaultLocalManifestHead {
  return decodeCanonical(privateVaultLocalManifestHeadSchema, bytes);
}
