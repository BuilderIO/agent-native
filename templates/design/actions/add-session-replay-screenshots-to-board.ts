import {
  ActionContractError,
  defineAction,
  fail,
  isActionContractError,
} from "@agent-native/core/action";
import {
  ATTACHMENT_REF_MAX_CHARS,
  deletePrivateBlob,
  isPrivateBlobConfiguredForRequest,
  putPrivateBlob,
  resolveAttachment,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  attachmentFailureMessage,
  detectImageMimeType,
} from "../server/lib/replay-screenshot-blobs.js";
import {
  deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanup,
  queueVisualEditSnapshotBlobCleanupInTransaction,
} from "../server/lib/visual-edit-snapshot-blobs.js";
import {
  readLiveSourceFile,
  withDesignSourceMutationTransaction,
  writeInlineSourceFile,
} from "../server/source-workspace.js";
import { BOARD_FILENAME } from "../shared/board-file.js";
import createDesign from "./create-design.js";
import deleteDesign from "./delete-design.js";
import migrateBoardObjectsToFile from "./migrate-board-objects-to-file.js";

const MAX_SCREENSHOTS = 9;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_BYTES = 40 * 1024 * 1024;
const MAX_VIEWPORT_DIMENSION = 16_384;

const screenshotInputSchema = z
  .object({
    attachmentRef: z
      .string()
      .min(1)
      .max(ATTACHMENT_REF_MAX_CHARS)
      .describe("Personal owner-bound attachment reference for the image."),
    replayId: z.string().trim().min(1).max(256),
    capturedAt: z
      .string()
      .max(40)
      .refine(
        (value) =>
          /^\d{4}-\d{2}-\d{2}T/.test(value) &&
          Number.isFinite(Date.parse(value)),
        "Expected an ISO timestamp.",
      ),
    app: z.string().trim().min(1).max(128),
    route: z.string().trim().min(1).max(2_048),
    offsetMs: z.number().int().min(0).max(2_147_483_647),
    viewportWidth: z.number().int().min(1).max(MAX_VIEWPORT_DIMENSION),
    viewportHeight: z.number().int().min(1).max(MAX_VIEWPORT_DIMENSION),
    eventCount: z.number().int().min(0).max(2_147_483_647),
  })
  .strict();

const inputSchema = z
  .object({
    designId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    cohortTotal: z.number().int().min(0).max(2_147_483_647).optional(),
    selectedReplayCount: z.number().int().min(0).max(2_147_483_647).optional(),
    screenshots: z.array(screenshotInputSchema).min(1).max(MAX_SCREENSHOTS),
  })
  .strict();

type ScreenshotInput = z.infer<typeof screenshotInputSchema>;

interface UploadedScreenshot {
  id: string;
  screenshot: ScreenshotInput;
  blobHandle: PrivateBlobHandle;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
}

interface BoardWrite {
  designId: string;
  file: {
    id: string;
    designId: string;
    filename: string;
    fileType: string;
    content: string;
    createdAt: string | null;
    updatedAt: string | null;
  };
  previousContent: string;
  versionHash: string;
}

function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId, editorView: "overview" },
    to: `/design/${encodeURIComponent(designId)}`,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function screenshotLabel(screenshot: ScreenshotInput): string {
  return `${screenshot.app} · ${screenshot.route} · replay ${screenshot.replayId} · ${screenshot.capturedAt} · +${screenshot.offsetMs} ms · ${screenshot.eventCount} events · ${screenshot.viewportWidth}×${screenshot.viewportHeight}`;
}

function screenshotCaption(screenshot: ScreenshotInput): string {
  const date = screenshot.capturedAt.slice(0, 10);
  const seconds = (screenshot.offsetMs / 1_000).toFixed(1).replace(/\.0$/, "");
  return `${screenshot.app} · ${screenshot.route} · ${date} · +${seconds}s`;
}

function maxBoardBottom(html: string): number {
  let bottom = 0;
  const styleAttributes = html.matchAll(/\bstyle\s*=\s*(["'])(.*?)\1/gis);
  for (const match of styleAttributes) {
    const style = match[2] ?? "";
    const top = /(?:^|;)\s*top\s*:\s*(-?\d+(?:\.\d+)?)px/i.exec(style);
    const height = /(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)px/i.exec(style);
    if (!top) continue;
    const topPx = Number(top[1]);
    const heightPx = height ? Number(height[1]) : 0;
    if (Number.isFinite(topPx) && Number.isFinite(heightPx)) {
      bottom = Math.max(bottom, topPx + heightPx);
    }
  }
  return Math.max(0, Math.ceil(bottom));
}

function screenshotMarkup(
  screenshots: readonly UploadedScreenshot[],
  initialTop: number,
): string {
  const columnCount = 3;
  const columnWidth = 420;
  const rowGap = 80;
  const renderSize = (screenshot: ScreenshotInput) => {
    const scale = Math.min(
      1,
      360 / screenshot.viewportWidth,
      640 / screenshot.viewportHeight,
    );
    return {
      width: Math.max(1, Math.round(screenshot.viewportWidth * scale)),
      height: Math.max(1, Math.round(screenshot.viewportHeight * scale)),
    };
  };
  const rowHeights = Array.from(
    { length: Math.ceil(screenshots.length / columnCount) },
    (_, row) =>
      Math.max(
        ...screenshots
          .slice(row * columnCount, (row + 1) * columnCount)
          .map(({ screenshot }) => renderSize(screenshot).height),
      ) + 56,
  );
  const rowTops = rowHeights.map((_, row) =>
    rowHeights
      .slice(0, row)
      .reduce((total, height) => total + height + rowGap, initialTop),
  );

  return screenshots
    .map(({ id, screenshot }, index) => {
      const label = screenshotLabel(screenshot);
      const captionText = screenshotCaption(screenshot);
      const labelNodeId = `${id}-label`;
      const layerName = `Replay ${screenshot.replayId}`;
      const size = renderSize(screenshot);
      const column = index % columnCount;
      const row = Math.floor(index / columnCount);
      const left = column * columnWidth;
      const captionTop = rowTops[row]!;
      const imageTop = captionTop + 48;
      const image = `<img data-agent-native-node-id="${id}" data-agent-native-layer-name="${escapeHtml(layerName)}" data-an-primitive="image" data-session-replay-id="${escapeHtml(screenshot.replayId)}" data-session-replay-captured-at="${escapeHtml(screenshot.capturedAt)}" data-session-replay-app="${escapeHtml(screenshot.app)}" data-session-replay-route="${escapeHtml(screenshot.route)}" data-session-replay-offset-ms="${screenshot.offsetMs}" data-session-replay-event-count="${screenshot.eventCount}" data-session-replay-viewport-width="${screenshot.viewportWidth}" data-session-replay-viewport-height="${screenshot.viewportHeight}" alt="${escapeHtml(label)}" title="${escapeHtml(label)}" width="${size.width}" height="${size.height}" loading="lazy" decoding="async" src="/api/design-board-replay-screenshots/${id}" style="position:absolute;left:${left}px;top:${imageTop}px;width:${size.width}px;height:${size.height}px;object-fit:contain" />`;
      const caption = `<div data-agent-native-node-id="${labelNodeId}" data-agent-native-layer-name="${escapeHtml(layerName)} label" data-an-primitive="text" title="${escapeHtml(label)}" style="position:absolute;left:${left}px;top:${captionTop}px;width:360px;height:40px;overflow:hidden;white-space:pre-wrap;font:12px/18px sans-serif;color:inherit">${escapeHtml(captionText)}</div>`;
      return `${caption}\n${image}`;
    })
    .join("\n");
}

function appendToBoard(html: string, markup: string): string {
  const closingBody = /<\/body\s*>/i;
  if (!closingBody.test(html)) {
    // guard:allow-bare-error — invariant: generated board HTML must contain its body.
    throw new Error("The Design board HTML has no closing body tag.");
  }
  return html.replace(closingBody, `${markup}\n</body>`);
}

async function cleanupUploadedScreenshots(
  handles: readonly PrivateBlobHandle[],
): Promise<{ pending: boolean; failed: boolean; unknown: boolean }> {
  const complete = { pending: false, failed: false, unknown: false };
  if (handles.length === 0) return complete;
  const pendingHandles = (
    await Promise.all(
      handles.map(async (handle) => {
        try {
          const result = await deletePrivateBlob(handle);
          return result.deleted ? null : handle;
        } catch {
          return handle;
        }
      }),
    )
  ).filter((handle): handle is PrivateBlobHandle => handle !== null);
  if (pendingHandles.length === 0) return complete;
  try {
    const pending = await deleteVisualEditSnapshotBlobs(
      pendingHandles.map((handle) => JSON.stringify(handle)),
    );
    return { pending, failed: false, unknown: false };
  } catch (error) {
    console.warn(
      "[design-replay-screenshots] Private blob cleanup remains pending:",
      error,
    );
    const remainingHandles = (
      await Promise.all(
        pendingHandles.map(async (handle) => {
          try {
            const result = await deletePrivateBlob(handle);
            return result.deleted ? null : handle;
          } catch {
            return handle;
          }
        }),
      )
    ).filter((handle): handle is PrivateBlobHandle => handle !== null);
    if (!remainingHandles.length) return complete;
    try {
      await queueVisualEditSnapshotBlobCleanup(
        remainingHandles.map((handle) => JSON.stringify(handle)),
      );
      return { pending: true, failed: false, unknown: false };
    } catch (queueError) {
      console.warn(
        "[design-replay-screenshots] Could not queue screenshot cleanup for retry:",
        queueError,
      );
      try {
        const values = [
          ...new Set(remainingHandles.map((handle) => JSON.stringify(handle))),
        ];
        const table = schema.designVisualEditSnapshotBlobCleanup;
        const queued = await getDb()
          .select({ blobHandle: table.blobHandle })
          .from(table)
          .where(inArray(table.blobHandle, values))
          .limit(values.length);
        const queuedHandles = new Set(
          queued.map(({ blobHandle }) => blobHandle),
        );
        return {
          pending: queuedHandles.size > 0,
          failed: queuedHandles.size < values.length,
          unknown: false,
        };
      } catch (readError) {
        console.warn(
          "[design-replay-screenshots] Could not verify queued screenshot cleanup:",
          readError,
        );
        return { pending: false, failed: false, unknown: true };
      }
    }
  }
}

async function removeUploadedScreenshotMetadata(
  designId: string,
  screenshots: readonly Pick<UploadedScreenshot, "id" | "blobHandle">[],
): Promise<string[]> {
  if (screenshots.length === 0) return [];
  const screenshotIds = screenshots.map(({ id }) => id);
  const rows = await withDesignSourceMutationTransaction(
    designId,
    async (tx) => {
      const persisted = await tx
        .select({
          id: schema.designBoardReplayScreenshots.id,
          blobHandle: schema.designBoardReplayScreenshots.blobHandle,
        })
        .from(schema.designBoardReplayScreenshots)
        .where(
          and(
            inArray(schema.designBoardReplayScreenshots.id, [...screenshotIds]),
            eq(schema.designBoardReplayScreenshots.designId, designId),
          ),
        )
        .for("update");

      const persistedIds = new Set(persisted.map(({ id }) => id));
      const blobHandles = [
        ...persisted.map(({ blobHandle }) => blobHandle),
        ...screenshots
          .filter(({ id }) => !persistedIds.has(id))
          .map(({ blobHandle }) => JSON.stringify(blobHandle)),
      ];
      await queueVisualEditSnapshotBlobCleanupInTransaction(tx, blobHandles);
      if (persisted.length > 0) {
        await tx
          .delete(schema.designBoardReplayScreenshots)
          .where(
            and(
              inArray(schema.designBoardReplayScreenshots.id, [
                ...screenshotIds,
              ]),
              eq(schema.designBoardReplayScreenshots.designId, designId),
            ),
          );
      }
      return blobHandles;
    },
  );
  return rows;
}

async function rollbackBoardWrite(write: BoardWrite): Promise<void> {
  await writeInlineSourceFile({
    designId: write.designId,
    file: write.file,
    content: write.previousContent,
    expectedVersionHash: write.versionHash,
  });
}

function actionFailureWithRollbackState(
  error: unknown,
  state: {
    cleanupFailed?: true;
    cleanupPending?: true;
    cleanupUnknown?: true;
    saveOutcomeUnknown?: true;
  },
): ActionContractError {
  const failure =
    error && typeof error === "object"
      ? (error as {
          data?: unknown;
          details?: unknown;
          errorCode?: unknown;
          message?: unknown;
          statusCode?: unknown;
          statusMessage?: unknown;
        })
      : {};
  const existingDetails = isActionContractError(error)
    ? (error.details ?? {})
    : failure.data && typeof failure.data === "object"
      ? (failure.data as Record<string, unknown>)
      : failure.details && typeof failure.details === "object"
        ? (failure.details as Record<string, unknown>)
        : {};
  const wrapped = new ActionContractError(
    typeof failure.statusMessage === "string"
      ? failure.statusMessage
      : typeof failure.message === "string"
        ? failure.message
        : "Design screenshot action failed",
    {
      errorCode: isActionContractError(error)
        ? error.errorCode
        : typeof failure.errorCode === "string"
          ? failure.errorCode
          : "action_failed",
      statusCode:
        typeof failure.statusCode === "number"
          ? failure.statusCode
          : isActionContractError(error)
            ? error.statusCode
            : 500,
      details: { ...existingDetails, ...state },
    },
  );
  Object.defineProperty(wrapped, "cause", { value: error, configurable: true });
  return wrapped;
}

export default defineAction({
  description:
    "Add up to nine private Analytics session-replay screenshots to a Design board. Each image is copied to configured private storage, including the encrypted upload fallback when available. Replay metadata is stored separately, and board HTML references only authenticated image routes. Pass a Design ID to append to an existing board, or omit it to create a Design.",
  requiresAuth: true,
  maxBodyBytes: MAX_SCREENSHOTS * (ATTACHMENT_REF_MAX_CHARS + 3_200) + 16_384,
  schema: inputSchema,
  run: async (
    {
      designId: requestedDesignId,
      title,
      cohortTotal,
      selectedReplayCount,
      screenshots,
    },
    context,
  ) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) fail("A signed-in user is required.", { statusCode: 401 });

    const targetDesignId = requestedDesignId ?? nanoid();
    const initialDesignAccess = requestedDesignId
      ? await assertAccess("design", requestedDesignId, "editor")
      : undefined;
    const blobOwnerEmail =
      initialDesignAccess?.resource.ownerEmail ?? ownerEmail;
    if (!(await isPrivateBlobConfiguredForRequest())) {
      fail(
        "Design requires configured private storage for replay screenshots.",
        {
          errorCode: "private_blob_provider_required",
          statusCode: 503,
        },
      );
    }

    const uploaded: UploadedScreenshot[] = [];
    let storageProviderId: string | undefined;
    let totalBytes = 0;
    let createdDesignId: string | undefined;
    let screenshotMetadataInsertAttempted = false;
    let boardWrite: BoardWrite | undefined;

    try {
      for (const screenshot of screenshots) {
        const resolved = await resolveAttachment(screenshot.attachmentRef, {
          ownerEmail,
          orgId: null,
        });
        if (resolved.status !== "ok") {
          fail(attachmentFailureMessage(resolved.status), {
            errorCode: `attachment_${resolved.status}`,
            statusCode:
              resolved.status === "forbiddenScope"
                ? 403
                : resolved.status === "storageUnavailable"
                  ? 503
                  : 400,
            details: {
              attachmentStatus: resolved.status,
              reason: resolved.reason,
              retryable: resolved.status === "storageUnavailable",
            },
          });
        }

        const mimeType = detectImageMimeType(resolved.file.data);
        if (!mimeType) {
          fail(
            "Screenshot attachments must contain PNG, JPEG, or WebP image bytes.",
            {
              errorCode: "invalid_replay_screenshot_image",
              statusCode: 400,
            },
          );
        }
        const sizeBytes = resolved.file.data.byteLength;
        if (sizeBytes === 0 || sizeBytes > MAX_SCREENSHOT_BYTES) {
          fail("Each replay screenshot must be 10 MiB or smaller.", {
            errorCode: "replay_screenshot_too_large",
            statusCode: 413,
          });
        }
        totalBytes += sizeBytes;
        if (totalBytes > MAX_BATCH_BYTES) {
          fail("The replay screenshot batch exceeds 40 MiB.", {
            errorCode: "replay_screenshot_batch_too_large",
            statusCode: 413,
          });
        }

        const id = nanoid();
        const blobHandle = await putPrivateBlob({
          data: resolved.file.data,
          filename: `session-replay-${id}.${mimeType === "image/jpeg" ? "jpg" : mimeType.slice(6)}`,
          mimeType,
          ownerEmail: blobOwnerEmail,
          metadata: {
            designId: targetDesignId,
            replayId: screenshot.replayId,
          },
        });
        if (!blobHandle) {
          fail(
            "The private blob provider could not store a replay screenshot.",
            {
              errorCode: "private_blob_write_failed",
              statusCode: 503,
            },
          );
        }
        uploaded.push({ id, screenshot, blobHandle, mimeType, sizeBytes });
        const usesPublicUploadFallback =
          blobHandle.id.startsWith("public-upload:v1:") ||
          blobHandle.provider.startsWith("public-upload:");
        const validHandle =
          blobHandle.opaque === true &&
          (usesPublicUploadFallback
            ? blobHandle.id.startsWith("public-upload:v1:") &&
              blobHandle.provider.startsWith("public-upload:") &&
              blobHandle.encrypted === true
            : !blobHandle.id.startsWith("public-upload:v1:") &&
              !blobHandle.provider.startsWith("public-upload:"));
        if (!validHandle) {
          fail(
            "Replay screenshots must use an opaque private storage handle.",
            {
              errorCode: "private_blob_provider_mismatch",
              statusCode: 503,
            },
          );
        }
        if (storageProviderId && blobHandle.provider !== storageProviderId) {
          fail(
            "Replay screenshots in one batch must use the same private storage provider.",
            {
              errorCode: "private_blob_provider_mismatch",
              statusCode: 503,
            },
          );
        }
        storageProviderId = blobHandle.provider;
      }

      if (!requestedDesignId) {
        const firstScreenshot = screenshots[0]!;
        const created = await createDesign.run(
          {
            id: targetDesignId,
            title:
              title ?? `Session replay screenshots — ${firstScreenshot.app}`,
            description:
              cohortTotal === undefined
                ? "Private screenshots captured from an Analytics session replay."
                : `Private screenshots from a cohort of ${cohortTotal} sessions; ${selectedReplayCount ?? screenshots.length} replay(s) selected.`,
            projectType: "prototype",
          },
          context,
        );
        if (created.id !== targetDesignId) {
          // guard:allow-bare-error — invariant: a create action must return its requested ID.
          throw new Error("Design creation returned an unexpected ID.");
        }
        createdDesignId = created.id;
      }

      const access = await assertAccess("design", targetDesignId, "editor");
      const design = access.resource as typeof schema.designs.$inferSelect;
      const board = await migrateBoardObjectsToFile.run(
        { designId: targetDesignId },
        context,
      );
      const db = getDb();
      const [file] = await db
        .select({
          id: schema.designFiles.id,
          designId: schema.designFiles.designId,
          filename: schema.designFiles.filename,
          fileType: schema.designFiles.fileType,
          content: schema.designFiles.content,
          createdAt: schema.designFiles.createdAt,
          updatedAt: schema.designFiles.updatedAt,
        })
        .from(schema.designFiles)
        .where(
          and(
            eq(schema.designFiles.id, board.boardFileId),
            eq(schema.designFiles.designId, targetDesignId),
            eq(schema.designFiles.filename, BOARD_FILENAME),
          ),
        )
        .limit(1);
      if (!file) {
        // guard:allow-bare-error — invariant: board migration must return a persisted board file.
        throw new Error("The Design board file was not created.");
      }

      const live = await readLiveSourceFile(file);
      const markup = screenshotMarkup(
        uploaded,
        maxBoardBottom(live.content) + 96,
      );
      const nextContent = appendToBoard(live.content, markup);
      const write = await writeInlineSourceFile({
        designId: targetDesignId,
        file,
        content: nextContent,
        expectedVersionHash: live.versionHash,
      });
      boardWrite = {
        designId: targetDesignId,
        file,
        previousContent: live.content,
        versionHash: write.versionHash,
      };

      const now = new Date().toISOString();
      const metadataRows = uploaded.map(
        ({ id, screenshot, blobHandle, mimeType, sizeBytes }) => ({
          id,
          designId: targetDesignId,
          boardFileId: board.boardFileId,
          replayId: screenshot.replayId,
          capturedAt: screenshot.capturedAt,
          app: screenshot.app,
          route: screenshot.route,
          offsetMs: screenshot.offsetMs,
          viewportWidth: screenshot.viewportWidth,
          viewportHeight: screenshot.viewportHeight,
          eventCount: screenshot.eventCount,
          mimeType,
          sizeBytes,
          blobHandle: JSON.stringify(blobHandle),
          createdAt: now,
          visibility: design.visibility,
          ownerEmail: design.ownerEmail,
          orgId: design.orgId,
        }),
      );
      screenshotMetadataInsertAttempted = true;
      await db.insert(schema.designBoardReplayScreenshots).values(metadataRows);

      return {
        designId: targetDesignId,
        boardFileId: board.boardFileId,
        boardUrl: designDeepLink(targetDesignId),
        summary: {
          screenshotCount: uploaded.length,
          cohortTotal: cohortTotal ?? null,
          selectedReplayCount: selectedReplayCount ?? uploaded.length,
        },
      };
    } catch (error) {
      let createdDesignDeleted = false;
      let screenshotMetadataRollbackCommitted =
        !screenshotMetadataInsertAttempted;
      let rollbackQueuedBlobHandles: string[] = [];
      let cleanupPending = false;
      let cleanupFailed = false;
      let cleanupUnknown = false;
      let saveOutcomeUnknown = false;

      if (uploaded.length && screenshotMetadataInsertAttempted) {
        try {
          const cleanup = await removeUploadedScreenshotMetadata(
            targetDesignId,
            uploaded,
          );
          screenshotMetadataRollbackCommitted = true;
          rollbackQueuedBlobHandles = cleanup;
        } catch (cleanupError) {
          console.warn(
            "[design-replay-screenshots] Screenshot metadata rollback failed:",
            cleanupError,
          );
          try {
            const cleanup = await removeUploadedScreenshotMetadata(
              targetDesignId,
              uploaded,
            );
            screenshotMetadataRollbackCommitted = true;
            rollbackQueuedBlobHandles = cleanup;
          } catch (retryError) {
            console.warn(
              "[design-replay-screenshots] Screenshot metadata rollback retry failed:",
              retryError,
            );
            cleanupUnknown = true;
            saveOutcomeUnknown = true;
          }
        }
        if (
          screenshotMetadataRollbackCommitted &&
          rollbackQueuedBlobHandles.length > 0
        ) {
          try {
            cleanupPending =
              (await deleteVisualEditSnapshotBlobs(
                rollbackQueuedBlobHandles,
              )) || cleanupPending;
          } catch (cleanupError) {
            cleanupPending = true;
            console.warn(
              "[design-replay-screenshots] Queued screenshot cleanup remains pending:",
              cleanupError,
            );
          }
        }
      }

      if (createdDesignId && screenshotMetadataRollbackCommitted) {
        try {
          const result = await deleteDesign.run(
            { id: createdDesignId },
            context,
          );
          createdDesignDeleted = result?.deleted === true;
        } catch (cleanupError) {
          console.warn(
            "[design-replay-screenshots] Newly created Design cleanup failed:",
            cleanupError,
          );
        }
        if (!createdDesignDeleted) {
          try {
            const [remainingDesign] = await getDb()
              .select({ id: schema.designs.id })
              .from(schema.designs)
              .where(eq(schema.designs.id, createdDesignId))
              .limit(1);
            createdDesignDeleted = !remainingDesign;
            if (remainingDesign) saveOutcomeUnknown = true;
            if (remainingDesign && rollbackQueuedBlobHandles.length > 0) {
              cleanupPending =
                (await deleteVisualEditSnapshotBlobs(
                  rollbackQueuedBlobHandles,
                )) || cleanupPending;
            }
          } catch (cleanupError) {
            saveOutcomeUnknown = true;
            if (rollbackQueuedBlobHandles.length > 0) cleanupPending = true;
            console.warn(
              "[design-replay-screenshots] Could not verify newly created Design cleanup:",
              cleanupError,
            );
          }
        }
      }
      if (createdDesignId && !screenshotMetadataRollbackCommitted) {
        cleanupUnknown = true;
        saveOutcomeUnknown = true;
      }
      if (boardWrite && !createdDesignDeleted) {
        try {
          await rollbackBoardWrite(boardWrite);
        } catch (rollbackError) {
          saveOutcomeUnknown = true;
          console.warn(
            "[design-replay-screenshots] Board rollback failed after screenshot persistence failed:",
            rollbackError,
          );
        }
      }
      if (uploaded.length && !screenshotMetadataInsertAttempted) {
        try {
          const cleanupState = await cleanupUploadedScreenshots(
            uploaded.map(({ blobHandle }) => blobHandle),
          );
          cleanupPending = cleanupState.pending || cleanupPending;
          cleanupFailed = cleanupState.failed || cleanupFailed;
          cleanupUnknown = cleanupState.unknown || cleanupUnknown;
        } catch (cleanupError) {
          cleanupUnknown = true;
          console.warn(
            "[design-replay-screenshots] Uploaded screenshot cleanup could not be confirmed:",
            cleanupError,
          );
        }
      }
      if (
        cleanupPending ||
        cleanupFailed ||
        cleanupUnknown ||
        saveOutcomeUnknown
      ) {
        throw actionFailureWithRollbackState(error, {
          ...(cleanupFailed ? { cleanupFailed: true as const } : {}),
          ...(cleanupPending ? { cleanupPending: true as const } : {}),
          ...(cleanupUnknown ? { cleanupUnknown: true as const } : {}),
          ...(saveOutcomeUnknown ? { saveOutcomeUnknown: true as const } : {}),
        });
      }
      throw error;
    }
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const { designId, boardUrl } = result as {
      designId?: string;
      boardUrl?: string;
    };
    if (!designId || !boardUrl) return null;
    return { url: boardUrl, label: "Open Design board", view: "editor" };
  },
});
