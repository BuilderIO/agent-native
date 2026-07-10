import { defineAction } from "@agent-native/core";
import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import { isPostgres } from "@agent-native/core/db";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isProbablyHtmlDocumentContent } from "../shared/html-content.js";
import {
  renameFilenamePreservingExtension,
  replaceDataScreenReferences,
} from "../shared/screen-rename.js";
import { sourceContentHash } from "../shared/source-workspace.js";

const MAX_RENAME_ATTEMPTS = 5;
const MAX_CONTENT_OVERRIDE_BYTES = 2_000_000;
const MAX_TOTAL_CONTENT_OVERRIDE_BYTES = 4_000_000;
const renameLocks = new Map<string, Promise<unknown>>();

class ScreenRenameConflictError extends Error {
  constructor(message = "Screen content changed during rename. Please retry.") {
    super(message);
    this.name = "ScreenRenameConflictError";
  }
}

function withScreenRenameLock<T>(
  designId: string,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = renameLocks.get(designId) ?? Promise.resolve();
  const next = previous.then(callback, callback);
  renameLocks.set(designId, next);
  const cleanup = () => {
    if (renameLocks.get(designId) === next) renameLocks.delete(designId);
  };
  next.then(cleanup, cleanup);
  return next;
}

function nextUpdatedAt(current: string | null, now: Date): string {
  const currentMs = current ? Date.parse(current) : Number.NaN;
  const nextMs = Number.isFinite(currentMs)
    ? Math.max(now.getTime(), currentMs + 1)
    : now.getTime();
  return new Date(nextMs).toISOString();
}

function isRetryableTransactionConflict(error: unknown): boolean {
  if (error instanceof ScreenRenameConflictError) return true;
  const rawCode =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  const code =
    typeof rawCode === "string" || typeof rawCode === "number"
      ? String(rawCode)
      : "";
  return (
    code === "SQLITE_BUSY" ||
    code === "SQLITE_LOCKED" ||
    code === "40001" ||
    code === "40P01"
  );
}

function assertValidFilename(filename: string): void {
  let containsControlCharacter = false;
  for (let index = 0; index < filename.length; index += 1) {
    const codeUnit = filename.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      containsControlCharacter = true;
      break;
    }
  }
  if (
    !filename ||
    filename.length > 255 ||
    filename === "." ||
    filename === ".." ||
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    containsControlCharacter
  ) {
    throw new Error("Invalid filename: use a plain name without path segments");
  }
}

const contentOverrideSchema = z.object({
  fileId: z.string().min(1).max(256),
  content: z.string().max(MAX_CONTENT_OVERRIDE_BYTES),
  expectedVersionHash: z.string().min(1).max(256),
});

type RenamedFileResult = {
  id: string;
  filename: string;
  content: string;
  updatedAt: string;
  contentChanged: boolean;
  referenceRewritten: boolean;
};

export default defineAction({
  description:
    "Atomically rename one Design screen and rewrite exact data-screen links in every HTML screen.",
  agentTool: false,
  schema: z
    .object({
      id: z.string().min(1).max(256).describe("design_files.id to rename"),
      name: z
        .string()
        .max(255)
        .describe(
          "New screen display name; the existing extension is preserved",
        ),
      requestSource: z
        .string()
        .min(1)
        .max(256)
        .optional()
        .describe(
          "Stable browser tab id used for collaboration echo suppression",
        ),
      contentOverrides: z
        .array(contentOverrideSchema)
        .max(100)
        .optional()
        .default([])
        .describe(
          "Fresh unsaved HTML snapshots from this client, guarded by their persisted base hashes.",
        ),
    })
    .superRefine((value, ctx) => {
      const encoder = new TextEncoder();
      const totalBytes = value.contentOverrides.reduce(
        (sum, override) => sum + encoder.encode(override.content).byteLength,
        0,
      );
      if (totalBytes > MAX_TOTAL_CONTENT_OVERRIDE_BYTES) {
        ctx.addIssue({
          code: "custom",
          message: "Screen rename content overrides exceed the 4 MB limit.",
          path: ["contentOverrides"],
        });
      }
    }),
  run: async ({ id, name, requestSource, contentOverrides }) => {
    const db = getDb();

    const [scopedFile] = await db
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(
        and(
          eq(schema.designFiles.id, id),
          accessFilter(schema.designs, schema.designShares),
        ),
      )
      .limit(1);
    if (!scopedFile) throw new Error(`Screen not found: ${id}`);

    await assertAccess("design", scopedFile.designId, "editor");

    const overrideIds = new Set<string>();
    for (const override of contentOverrides) {
      if (overrideIds.has(override.fileId)) {
        throw new Error(`Duplicate content override: ${override.fileId}`);
      }
      overrideIds.add(override.fileId);
    }

    const result = await withScreenRenameLock(scopedFile.designId, async () => {
      for (let attempt = 0; attempt < MAX_RENAME_ATTEMPTS; attempt += 1) {
        try {
          return await db.transaction(async (tx) => {
            if (isPostgres()) {
              await (
                tx as unknown as {
                  execute: (query: unknown) => Promise<unknown>;
                }
              ).execute(
                sql`LOCK TABLE design_files IN SHARE ROW EXCLUSIVE MODE`,
              );
            }

            const [design] = await tx
              .select({ updatedAt: schema.designs.updatedAt })
              .from(schema.designs)
              .where(eq(schema.designs.id, scopedFile.designId))
              .limit(1);
            if (!design) {
              throw new Error(`Design not found: ${scopedFile.designId}`);
            }

            const currentFiles = await tx
              .select({
                id: schema.designFiles.id,
                designId: schema.designFiles.designId,
                filename: schema.designFiles.filename,
                content: schema.designFiles.content,
                fileType: schema.designFiles.fileType,
                updatedAt: schema.designFiles.updatedAt,
              })
              .from(schema.designFiles)
              .where(eq(schema.designFiles.designId, scopedFile.designId));
            const target = currentFiles.find((file) => file.id === id);
            if (!target) throw new Error(`Screen not found: ${id}`);
            if (target.fileType !== "html") {
              throw new Error(`File is not a renameable HTML screen: ${id}`);
            }

            const nextFilename = renameFilenamePreservingExtension(
              target.filename,
              name,
            );
            assertValidFilename(nextFilename);
            const collision = currentFiles.find(
              (file) => file.id !== id && file.filename === nextFilename,
            );
            if (collision) {
              throw new Error(
                `File "${nextFilename}" already exists in design ${scopedFile.designId}`,
              );
            }

            const fileById = new Map(
              currentFiles.map((file) => [file.id, file]),
            );
            const overrides = new Map(
              contentOverrides.map((override) => [override.fileId, override]),
            );
            for (const override of contentOverrides) {
              const file = fileById.get(override.fileId);
              if (!file) {
                throw new Error(
                  `Content override does not belong to this design: ${override.fileId}`,
                );
              }
              if (file.fileType !== "html") {
                throw new Error(
                  `Content overrides are only supported for HTML screens: ${override.fileId}`,
                );
              }
              if (
                file.content !== override.content &&
                !isProbablyHtmlDocumentContent(file.content)
              ) {
                throw new Error(
                  `URL-backed screen "${file.filename}" cannot be replaced with inline HTML during rename.`,
                );
              }
              const persistedHash = sourceContentHash(file.content);
              if (
                file.content !== override.content &&
                persistedHash !== override.expectedVersionHash
              ) {
                throw new Error(
                  `Screen "${file.filename}" changed before the rename. Refresh and retry.`,
                );
              }
            }

            const now = new Date();
            const updatedFiles: RenamedFileResult[] = [];
            const orderedFiles = [
              target,
              ...currentFiles.filter((file) => file.id !== target.id),
            ];
            for (const file of orderedFiles) {
              const override = overrides.get(file.id);
              const baseContent = override?.content ?? file.content;
              const nextContent =
                file.fileType === "html"
                  ? replaceDataScreenReferences(
                      baseContent,
                      target.filename,
                      nextFilename,
                    )
                  : baseContent;
              const contentChanged = nextContent !== file.content;
              const referenceRewritten = nextContent !== baseContent;
              const filenameChanged =
                file.id === id && nextFilename !== file.filename;
              if (!contentChanged && !filenameChanged) continue;

              const updatedAt = nextUpdatedAt(file.updatedAt, now);
              const updates: Record<string, unknown> = { updatedAt };
              if (filenameChanged) updates.filename = nextFilename;
              if (contentChanged) {
                updates.content = nextContent;
                // This atomic server write starts a new content lineage. A
                // late browser save may not use pre-rename revision metadata
                // as proof that no intervening writer changed the document.
                updates.contentOperationSource = null;
                updates.contentOperationRevision = null;
                updates.contentOperationResultHash = null;
              }

              await tx
                .update(schema.designFiles)
                .set(updates)
                .where(
                  and(
                    eq(schema.designFiles.id, file.id),
                    eq(schema.designFiles.designId, scopedFile.designId),
                    eq(schema.designFiles.filename, file.filename),
                    eq(schema.designFiles.content, file.content),
                    file.updatedAt === null
                      ? isNull(schema.designFiles.updatedAt)
                      : eq(schema.designFiles.updatedAt, file.updatedAt),
                  ),
                );

              const [confirmed] = await tx
                .select({
                  filename: schema.designFiles.filename,
                  content: schema.designFiles.content,
                  updatedAt: schema.designFiles.updatedAt,
                })
                .from(schema.designFiles)
                .where(eq(schema.designFiles.id, file.id))
                .limit(1);
              if (
                !confirmed ||
                confirmed.filename !==
                  (filenameChanged ? nextFilename : file.filename) ||
                confirmed.content !== nextContent ||
                confirmed.updatedAt !== updatedAt
              ) {
                throw new ScreenRenameConflictError();
              }

              updatedFiles.push({
                id: file.id,
                filename: filenameChanged ? nextFilename : file.filename,
                content: nextContent,
                updatedAt,
                contentChanged,
                referenceRewritten,
              });
            }

            const designUpdatedAt = nextUpdatedAt(design.updatedAt, now);
            await tx
              .update(schema.designs)
              .set({ updatedAt: designUpdatedAt })
              .where(eq(schema.designs.id, scopedFile.designId));

            return {
              id,
              designId: scopedFile.designId,
              previousFilename: target.filename,
              filename: nextFilename,
              renamed: nextFilename !== target.filename,
              updatedAt: designUpdatedAt,
              files: updatedFiles,
              rewrittenFileIds: updatedFiles
                .filter((file) => file.referenceRewritten)
                .map((file) => file.id),
            };
          });
        } catch (error) {
          if (
            !isRetryableTransactionConflict(error) ||
            attempt === MAX_RENAME_ATTEMPTS - 1
          ) {
            throw error;
          }
        }
      }
      throw new ScreenRenameConflictError(
        "Screen content kept changing during rename. Please retry.",
      );
    });

    // SQL is the atomic durable source of truth. Reconcile the same committed
    // snapshots through the existing diff-based Yjs primitive after commit so
    // open peers update without replacing their document or undoing unrelated
    // CRDT operations. If that transport is unavailable, the file/design
    // updatedAt bump and normal get-design invalidation remain the durable
    // reconciliation fallback; never report the committed transaction as a
    // rollback after it has succeeded.
    const collabReconcilePending: string[] = [];
    await Promise.all(
      result.files
        .filter((file) => file.contentChanged)
        .map(async (file) => {
          try {
            if (await hasCollabState(file.id)) {
              await applyText(
                file.id,
                file.content,
                "content",
                requestSource ?? "server",
              );
            } else {
              await seedFromText(file.id, file.content);
            }
          } catch (error) {
            collabReconcilePending.push(file.id);
            console.warn(
              `[design] screen rename committed but collab reconcile is pending for ${file.id}:`,
              error,
            );
          }
        }),
    );

    return { ...result, collabReconcilePending };
  },
});
