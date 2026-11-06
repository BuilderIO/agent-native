import {
  ActionContractError,
  defineAction,
  defineActionErrors,
} from "@agent-native/core/action";
import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { designChangeResource } from "../server/lib/design-change-resource.js";
import {
  designSourceMutationLockKey,
  lockDesignFilesTable,
} from "../server/source-workspace.js";
import { designOutputWriteReceipt } from "../shared/generation-output-receipt.js";
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

const errors = defineActionErrors(
  "invalid_filename",
  "screen_not_found",
  "design_not_found",
  "screen_not_renameable",
  "invalid_content_override",
  "filename_taken",
  "screen_changed",
);

class ScreenRenameConflictError extends ActionContractError {
  constructor(message = "Screen content changed during rename. Please retry.") {
    super(message, { errorCode: "screen_changed", statusCode: 409 });
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
  return code === "40001" || code === "40P01";
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
    return errors.noWrite(
      "Invalid filename: use a plain name without path segments",
      "invalid_filename",
    );
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
  errors,
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

    const scopedFiles = await db
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
    const scopedFile = scopedFiles.length > 0 ? scopedFiles[0] : undefined;
    if (!scopedFile) {
      return errors.noWrite(`Screen not found: ${id}`, "screen_not_found", {
        statusCode: 404,
      });
    }

    await assertAccess("design", scopedFile.designId, "editor");

    const overrideIds = new Set<string>();
    for (const override of contentOverrides) {
      if (overrideIds.has(override.fileId)) {
        return errors.noWrite(
          `Duplicate content override: ${override.fileId}`,
          "invalid_content_override",
        );
      }
      overrideIds.add(override.fileId);
    }

    const result = await withScreenRenameLock(scopedFile.designId, async () => {
      for (let attempt = 0; attempt < MAX_RENAME_ATTEMPTS; attempt += 1) {
        try {
          return await db.transaction(async (tx) => {
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(hashtextextended(${designSourceMutationLockKey(scopedFile.designId)}, 0::bigint))`,
            );
            await lockDesignFilesTable(tx);

            const [design] = await tx
              .select({ updatedAt: schema.designs.updatedAt })
              .from(schema.designs)
              .where(eq(schema.designs.id, scopedFile.designId))
              .limit(1);
            if (!design) {
              return errors.noWrite(
                `Design not found: ${scopedFile.designId}`,
                "design_not_found",
                { statusCode: 404 },
              );
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
              .where(eq(schema.designFiles.designId, scopedFile.designId))
              .for("update");
            const target = currentFiles.find((file) => file.id === id);
            if (!target) {
              return errors.noWrite(
                `Screen not found: ${id}`,
                "screen_not_found",
                {
                  statusCode: 404,
                },
              );
            }
            if (target.fileType !== "html") {
              return errors.noWrite(
                `File is not a renameable HTML screen: ${id}`,
                "screen_not_renameable",
              );
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
              return errors.noWrite(
                `File "${nextFilename}" already exists in design ${scopedFile.designId}`,
                "filename_taken",
                { statusCode: 409 },
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
                return errors.noWrite(
                  `Content override does not belong to this design: ${override.fileId}`,
                  "invalid_content_override",
                );
              }
              if (file.fileType !== "html") {
                return errors.noWrite(
                  `Content overrides are only supported for HTML screens: ${override.fileId}`,
                  "invalid_content_override",
                );
              }
              if (
                file.content !== override.content &&
                !isProbablyHtmlDocumentContent(file.content)
              ) {
                return errors.noWrite(
                  `URL-backed screen "${file.filename}" cannot be replaced with inline HTML during rename.`,
                  "invalid_content_override",
                );
              }
              const persistedHash = sourceContentHash(file.content);
              if (
                file.content !== override.content &&
                persistedHash !== override.expectedVersionHash
              ) {
                return errors.noWrite(
                  `Screen "${file.filename}" changed before the rename. Refresh and retry.`,
                  "screen_changed",
                  { statusCode: 409 },
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

    return {
      ...result,
      collabReconcilePending,
      _receipt: designOutputWriteReceipt(result.designId, result.files.length),
    };
  },
  changeResource: (_p, result) =>
    designChangeResource(result?.designId, result),
});
