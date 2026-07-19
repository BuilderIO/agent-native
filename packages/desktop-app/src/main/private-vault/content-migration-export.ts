import { createHash, randomBytes } from "node:crypto";

import { E2EE_SIZE_LIMITS } from "@agent-native/core/e2ee";
import { z } from "zod";

import { decodePrivateVaultContentDocument } from "./content-document-codec.js";
import type {
  MigrationSnapshot,
  PrivateVaultMigrationHostedClient,
  PrivateVaultMigrationObjectGateway,
} from "./content-migration-runtime.js";

export const PRIVATE_VAULT_CONTENT_MIGRATION_EXPORT_FORMAT =
  "agent-native-content-private-vault-export";
export const PRIVATE_VAULT_CONTENT_MIGRATION_EXPORT_VERSION = 1;

const opaqueIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
const revisionIdSchema = z.string().regex(/^[0-9a-f]{64}$/);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });
const sourceDocumentIdSchema = z.string().min(1).max(256);
const boundedTextSchema = z.string().max(1024 * 1024);

export const privateVaultContentMigrationExportDocumentSchema = z
  .object({
    sourceDocumentId: sourceDocumentIdSchema,
    parentSourceDocumentId: sourceDocumentIdSchema.nullable(),
    objectId: opaqueIdSchema,
    sourceDigest: digestSchema,
    sealedRevisionId: revisionIdSchema,
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

export const privateVaultContentMigrationExportPayloadSchema = z
  .object({
    format: z.literal(PRIVATE_VAULT_CONTENT_MIGRATION_EXPORT_FORMAT),
    version: z.literal(PRIVATE_VAULT_CONTENT_MIGRATION_EXPORT_VERSION),
    vaultId: opaqueIdSchema,
    migrationId: opaqueIdSchema,
    sourceSnapshotHash: digestSchema,
    cutoverManifestObjectId: opaqueIdSchema,
    cutoverManifestRevisionId: revisionIdSchema,
    cutoverManifestCiphertextHash: digestSchema,
    createdAt: timestampSchema,
    documents: z
      .array(privateVaultContentMigrationExportDocumentSchema)
      .min(1)
      .max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    const sourceIds = new Set(
      value.documents.map((document) => document.sourceDocumentId),
    );
    const objectIds = new Set(
      value.documents.map((document) => document.objectId),
    );
    if (
      sourceIds.size !== value.documents.length ||
      objectIds.size !== value.documents.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["documents"],
        message: "Migration export identifiers must be unique",
      });
      return;
    }
    const parentBySource = new Map(
      value.documents.map((document) => [
        document.sourceDocumentId,
        document.parentSourceDocumentId,
      ]),
    );
    for (const [index, document] of value.documents.entries()) {
      if (
        document.parentSourceDocumentId &&
        !sourceIds.has(document.parentSourceDocumentId)
      )
        context.addIssue({
          code: "custom",
          path: ["documents", index, "parentSourceDocumentId"],
          message: "Migration export parent is unavailable",
        });
      const seen = new Set<string>();
      let cursor: string | null = document.sourceDocumentId;
      while (cursor) {
        if (seen.has(cursor)) {
          context.addIssue({
            code: "custom",
            path: ["documents", index, "parentSourceDocumentId"],
            message: "Migration export hierarchy must be acyclic",
          });
          break;
        }
        seen.add(cursor);
        cursor = parentBySource.get(cursor) ?? null;
      }
    }
  });

export type PrivateVaultContentMigrationExportPayload = z.infer<
  typeof privateVaultContentMigrationExportPayloadSchema
>;

export class PrivateVaultContentMigrationExportError extends Error {
  constructor() {
    super("Private Content migration export unavailable");
    this.name = "PrivateVaultContentMigrationExportError";
  }
}

function fail(): never {
  throw new PrivateVaultContentMigrationExportError();
}

export function encodePrivateVaultContentMigrationExport(
  input: PrivateVaultContentMigrationExportPayload,
): Uint8Array {
  let parsed: PrivateVaultContentMigrationExportPayload;
  try {
    parsed = privateVaultContentMigrationExportPayloadSchema.parse(input);
  } catch {
    fail();
  }
  const canonical: PrivateVaultContentMigrationExportPayload = {
    format: PRIVATE_VAULT_CONTENT_MIGRATION_EXPORT_FORMAT,
    version: PRIVATE_VAULT_CONTENT_MIGRATION_EXPORT_VERSION,
    vaultId: parsed.vaultId,
    migrationId: parsed.migrationId,
    sourceSnapshotHash: parsed.sourceSnapshotHash,
    cutoverManifestObjectId: parsed.cutoverManifestObjectId,
    cutoverManifestRevisionId: parsed.cutoverManifestRevisionId,
    cutoverManifestCiphertextHash: parsed.cutoverManifestCiphertextHash,
    createdAt: parsed.createdAt,
    documents: [...parsed.documents].sort((left, right) =>
      left.sourceDocumentId < right.sourceDocumentId
        ? -1
        : left.sourceDocumentId > right.sourceDocumentId
          ? 1
          : 0,
    ),
  };
  const encoded = new TextEncoder().encode(JSON.stringify(canonical));
  if (
    encoded.byteLength === 0 ||
    encoded.byteLength > E2EE_SIZE_LIMITS.exportPlaintextBytes
  ) {
    encoded.fill(0);
    fail();
  }
  return encoded;
}

interface NativeExportSealer {
  sealExportArchive(input: {
    readonly vaultId: string;
    readonly exportId: string;
    readonly createdAt: number;
    readonly sourceSnapshotHash: string;
    readonly objectCount: number;
    readonly plaintext: Uint8Array;
  }): Promise<{
    readonly vaultId: string;
    readonly exportId: string;
    readonly archive: Uint8Array;
  }>;
}

export interface PrivateVaultMigrationArchiveWriter {
  save(input: {
    readonly suggestedName: string;
    readonly archive: Uint8Array;
  }): Promise<void>;
}

export class PrivateVaultContentMigrationExportRuntime {
  readonly #hosted: Pick<PrivateVaultMigrationHostedClient, "status">;
  readonly #objects: Pick<
    PrivateVaultMigrationObjectGateway,
    "downloadAndOpen"
  >;
  readonly #native: NativeExportSealer;
  readonly #writer: PrivateVaultMigrationArchiveWriter;
  readonly #now: () => Date;
  readonly #exportId: () => string;

  constructor(input: {
    hosted: Pick<PrivateVaultMigrationHostedClient, "status">;
    objects: Pick<PrivateVaultMigrationObjectGateway, "downloadAndOpen">;
    native: NativeExportSealer;
    writer: PrivateVaultMigrationArchiveWriter;
    now?: () => Date;
    exportId?: () => string;
  }) {
    this.#hosted = input.hosted;
    this.#objects = input.objects;
    this.#native = input.native;
    this.#writer = input.writer;
    this.#now = input.now ?? (() => new Date());
    this.#exportId = input.exportId ?? (() => randomBytes(16).toString("hex"));
  }

  async export(vaultId: string, migrationId: string) {
    const snapshot = await this.#hosted.status(vaultId, migrationId);
    this.#validate(snapshot, vaultId, migrationId);
    const sourceByObject = new Map(
      snapshot.items.map((item) => [item.objectId, item.sourceDocumentId]),
    );
    const documents = [];
    for (const item of snapshot.items) {
      const revisionId = item.sealedRevisionId!;
      const opened = await this.#objects.downloadAndOpen({
        vaultId,
        objectId: item.objectId,
        revisionId,
      });
      try {
        if (opened.metadata.objectType !== "document") fail();
        const document = decodePrivateVaultContentDocument(opened.plaintext);
        const parentSourceDocumentId = document.parentId
          ? sourceByObject.get(document.parentId)
          : null;
        if (
          document.id !== item.objectId ||
          (document.parentId && !parentSourceDocumentId) ||
          parentSourceDocumentId !== item.parentSourceDocumentId ||
          document.description === null
        )
          fail();
        documents.push({
          sourceDocumentId: item.sourceDocumentId,
          parentSourceDocumentId,
          objectId: item.objectId,
          sourceDigest: item.sourceDigest,
          sealedRevisionId: revisionId,
          sealedCiphertextHash: item.sealedCiphertextHash!,
          title: document.title,
          content: document.content,
          description: document.description,
          icon: document.icon,
          position: document.position,
          isFavorite: document.isFavorite,
          hideFromSearch: document.hideFromSearch,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        });
      } finally {
        opened.plaintext.fill(0);
      }
    }
    const created = this.#now();
    const createdAt = created.getTime();
    if (!Number.isSafeInteger(createdAt) || createdAt <= 0) fail();
    const plaintext = encodePrivateVaultContentMigrationExport({
      format: PRIVATE_VAULT_CONTENT_MIGRATION_EXPORT_FORMAT,
      version: PRIVATE_VAULT_CONTENT_MIGRATION_EXPORT_VERSION,
      vaultId,
      migrationId,
      sourceSnapshotHash: snapshot.ledger.sourceSnapshotHash,
      cutoverManifestObjectId: snapshot.ledger.cutoverManifestObjectId!,
      cutoverManifestRevisionId: snapshot.ledger.cutoverManifestRevisionId!,
      cutoverManifestCiphertextHash:
        snapshot.ledger.cutoverManifestCiphertextHash!,
      createdAt: created.toISOString(),
      documents,
    });
    const plaintextSha256 = createHash("sha256")
      .update(plaintext)
      .digest("hex");
    const exportId = this.#exportId();
    let archive: Uint8Array | undefined;
    try {
      const sealed = await this.#native.sealExportArchive({
        vaultId,
        exportId,
        createdAt,
        sourceSnapshotHash: snapshot.ledger.sourceSnapshotHash,
        objectCount: documents.length,
        plaintext,
      });
      if (sealed.vaultId !== vaultId || sealed.exportId !== exportId) fail();
      archive = sealed.archive;
      const archiveSha256 = createHash("sha256").update(archive).digest("hex");
      await this.#writer.save({
        suggestedName: `private-content-${created.toISOString().slice(0, 10)}-${exportId.slice(0, 8)}.anpvault`,
        archive,
      });
      return Object.freeze({
        exportId,
        plaintextSha256,
        archiveSha256,
        objectCount: documents.length,
      });
    } catch (error) {
      if (error instanceof PrivateVaultContentMigrationExportError) throw error;
      fail();
    } finally {
      plaintext.fill(0);
      archive?.fill(0);
    }
  }

  #validate(snapshot: MigrationSnapshot, vaultId: string, migrationId: string) {
    if (
      snapshot.ledger.vaultId !== vaultId ||
      snapshot.ledger.migrationId !== migrationId ||
      snapshot.ledger.state !== "cutover" ||
      !snapshot.ledger.cutoverManifestObjectId ||
      !snapshot.ledger.cutoverManifestRevisionId ||
      !snapshot.ledger.cutoverManifestCiphertextHash ||
      snapshot.ledger.sourceCount !== snapshot.items.length ||
      snapshot.ledger.verifiedCount !== snapshot.items.length ||
      snapshot.items.some(
        (item) =>
          item.migrationId !== migrationId ||
          item.state !== "verified" ||
          !item.sealedRevisionId ||
          !item.sealedCiphertextHash,
      ) ||
      new Set(snapshot.items.map((item) => item.objectId)).size !==
        snapshot.items.length ||
      new Set(snapshot.items.map((item) => item.sourceDocumentId)).size !==
        snapshot.items.length
    )
      fail();
  }
}
