import { defineAction, fail } from "@agent-native/core/action";
import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import {
  getActivePrivateBlobProviderForRequest,
  isPrivateBlobConfiguredForRequest,
} from "@agent-native/core/private-blob";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, like } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "../server/db/index.js";
import { designChangeResource } from "../server/lib/design-change-resource.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import {
  discardPrivateBlobs,
  storeAttachmentAsPrivateBlob,
  type StoredReplayScreenshotBlob,
} from "../server/lib/replay-screenshot-blobs.js";
import {
  deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction,
} from "../server/lib/visual-edit-snapshot-blobs.js";
import {
  readLiveSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import { BOARD_FILENAME } from "../shared/board-file.js";
import { nextFreeCanvasRowY } from "../shared/canvas-frames.js";
import {
  JOURNEY_FILE_ID_PREFIX,
  JOURNEY_FILENAME_PREFIX,
  JOURNEY_REPLAY_ROW_PREFIX,
  createJourneyCanvasInputSchema,
  planJourneyCanvas,
  replaceJourneyBoardObjects,
} from "../shared/journey-canvas.js";
import createDesign from "./create-design.js";
import deleteDesign from "./delete-design.js";
import migrateBoardObjectsToFile from "./migrate-board-objects-to-file.js";

const MAX_TOTAL_IMAGE_BYTES = 256 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 6;
const INSERT_CHUNK = 100;
/** Distance between the journey canvas and any content already on the design's canvas. */
const EXISTING_CONTENT_GAP = 160;

const likePrefix = (prefix: string) => `${prefix.replace(/[\\%_]/g, "\\$&")}%`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function withoutJourneyEntries(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([id]) => !id.startsWith(JOURNEY_FILE_ID_PREFIX),
    ),
  );
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId, editorView: "overview" },
    to: `/design/${encodeURIComponent(designId)}`,
  });
}

export default defineAction({
  description:
    "Create or refresh an onboarding-journey storyboard on a Design canvas in one call: a left-to-right tree of step cards with real session screenshots, arrows between them, a percent label on every fork, and a 'No later step observed' stub for sessions whose last observed step was a node. These counts do not prove that a session exited. " +
    "Pass the journey tree from Analytics `get-onboarding-journey` as `tree` and one captured frame per example as `frames` ({ nodeKey, exampleIndex, width, height, capturedAt } plus exactly one of `imageUrl` (https only; data: URLs are rejected) or `attachmentRef` (a personal private attachment, copied into encrypted private blob storage and served only to people who can view the design)). Private providers and the configured encrypted public-upload fallback are supported. " +
    "Each card shows the journey example's event date, recording id, and replay offset separately from the screenshot capture date. " +
    "Cards are sized from each frame's real aspect ratio; extra examples (up to `maxExamplesPerNode`, default 3) stack behind the front card. A step with no frame is left off and listed in `skippedNodes` unless `includeScreenshotless` is true. " +
    "Omit `designId` to create a new design; pass one to replace the storyboard this action drew earlier in that design (only its own screens and board objects are replaced, everything else on the canvas is left alone). " +
    "Returns { designId, url, nodeCount, frameCount, skippedNodes, collabSyncPending }; `collabSyncPending` lists file ids that are saved but whose open editors could not be updated live (empty when all synced). When it is not empty, call again with the same `designId` to retry the live sync; until then an open editor can still show the previous version.",
  requiresAuth: true,
  maxBodyBytes: 4 * 1024 * 1024,
  schema: createJourneyCanvasInputSchema,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    // With designId, the screens and screenshot rows drawn earlier are deleted and replaced.
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (input, context) => {
    const requesterEmail = getRequestUserEmail();
    if (!requesterEmail) {
      fail("A signed-in user is required.", { statusCode: 401 });
    }

    const existingAccess = input.designId
      ? await assertAccess("design", input.designId, "editor")
      : undefined;
    const designId = input.designId ?? nanoid();

    const plan = planJourneyCanvas(input, designId);
    if (plan.screens.length === 0) {
      fail(
        "No node has a screenshot, so there is nothing to draw. Pass frames, or set includeScreenshotless to draw labelled placeholder cards.",
        {
          errorCode: "journey_canvas_empty",
          statusCode: 400,
          details: { skippedNodes: plan.skippedNodes },
        },
      );
    }

    const attachmentScreens = plan.screens.filter(
      (screen) => screen.attachment,
    );
    const storageConfigured = attachmentScreens.length
      ? await isPrivateBlobConfiguredForRequest()
      : false;
    if (attachmentScreens.length && !storageConfigured) {
      fail(
        "Design requires configured private blob storage or the encrypted upload fallback to store attachmentRef screenshots. Pass https imageUrl frames instead, or configure private storage.",
        { errorCode: "private_blob_provider_required", statusCode: 503 },
      );
    }
    const provider = storageConfigured
      ? await getActivePrivateBlobProviderForRequest()
      : null;

    const stored = new Map<string, StoredReplayScreenshotBlob>();
    let createdDesignId: string | undefined;
    let mutationStarted = false;
    try {
      const blobOwnerEmail =
        existingAccess?.resource.ownerEmail ?? requesterEmail;
      for (const batch of chunks(attachmentScreens, UPLOAD_CONCURRENCY)) {
        const results = await Promise.allSettled(
          batch.map(async ({ attachment }) => {
            const blob = await storeAttachmentAsPrivateBlob({
              attachmentRef: attachment!.ref,
              requesterEmail,
              blobOwnerEmail,
              providerId: provider?.id,
              rowId: attachment!.rowId,
              designId,
              replayId: attachment!.replayId,
            });
            stored.set(attachment!.rowId, blob);
          }),
        );
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected) throw rejected.reason;
        const totalBytes = [...stored.values()].reduce(
          (sum, blob) => sum + blob.sizeBytes,
          0,
        );
        if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
          fail("The journey screenshots exceed 256 MiB in total.", {
            errorCode: "journey_screenshots_too_large",
            statusCode: 413,
          });
        }
      }

      if (!input.designId) {
        const created = await createDesign.run(
          {
            id: designId,
            title: input.title,
            description: `Onboarding journey for ${input.tree.app}, ${input.tree.window.from} to ${input.tree.window.to}.`,
            projectType: "prototype",
            designSystemId: null,
          },
          context,
        );
        if (created.id !== designId) {
          // guard:allow-bare-error — invariant: a create action must return its requested ID.
          throw new Error("Design creation returned an unexpected ID.");
        }
        createdDesignId = created.id;
      }

      const access = await assertAccess("design", designId, "editor");
      const design = access.resource as typeof schema.designs.$inferSelect;
      const board = await migrateBoardObjectsToFile.run({ designId }, context);
      const db = getDb();
      const [boardFile] = await db
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
            eq(schema.designFiles.designId, designId),
            eq(schema.designFiles.filename, BOARD_FILENAME),
          ),
        )
        .limit(1);
      if (!boardFile) {
        // guard:allow-bare-error — invariant: board migration must return a persisted board file.
        throw new Error("The Design board file was not created.");
      }
      const liveBoard = await readLiveSourceFile(
        boardFile as SourceWorkspaceFile,
      );

      let origin = { x: 0, y: 0 };
      let nextBoardContent = liveBoard.content;
      let lockedBoardContent = liveBoard.content;
      let removedBlobHandles: string[] = [];
      const ownBlobHandles = new Set(
        [...stored.values()].map((blob) => JSON.stringify(blob.blobHandle)),
      );
      const now = new Date().toISOString();
      mutationStarted = true;
      await mutateDesignData({
        designId,
        lockSourceMutation: true,
        mutate: (current) => {
          const frames = withoutJourneyEntries(current.canvasFrames);
          // A refresh redraws in place; only a first draw goes below existing content.
          const previous = current.journeyCanvasOrigin;
          origin =
            isRecord(previous) &&
            typeof previous.x === "number" &&
            typeof previous.y === "number"
              ? { x: previous.x, y: previous.y }
              : {
                  x: 0,
                  y: nextFreeCanvasRowY(frames, EXISTING_CONTENT_GAP),
                };
          const placedFrames = Object.fromEntries(
            plan.screens.map((screen) => [
              screen.fileId,
              {
                x: screen.frame.x + origin.x,
                y: screen.frame.y + origin.y,
                width: screen.frame.width,
                height: screen.frame.height,
                z: screen.frame.z,
              },
            ]),
          );
          const metadata = Object.fromEntries(
            plan.screens.map((screen) => [
              screen.fileId,
              {
                title: screen.title,
                width: screen.frame.width,
                height: screen.frame.height,
                breakpointWidths: [],
                heightPinned: true,
                heightMode: "fixed",
                ...(screen.provenance
                  ? { journeyExample: screen.provenance }
                  : {}),
              },
            ]),
          );
          return {
            ...current,
            journeyCanvasOrigin: origin,
            canvasFrames: { ...frames, ...placedFrames },
            screenMetadata: {
              ...withoutJourneyEntries(current.screenMetadata),
              ...metadata,
            },
          };
        },
        mutateFiles: (_current, _next, { files }) => {
          const lockedBoard = files.find((file) => file.id === boardFile.id);
          if (!lockedBoard) {
            // guard:allow-bare-error — invariant: the board file was just read from this design.
            throw new Error(
              "The Design board file disappeared before the write.",
            );
          }
          lockedBoardContent = lockedBoard.content;
          nextBoardContent = replaceJourneyBoardObjects(
            liveBoard.content,
            plan.boardFragments(origin),
          );
          return [{ fileId: boardFile.id, content: nextBoardContent }];
        },
        mutateInTransaction: async (tx) => {
          // The replacement board was built from the pre-lock read; an edit
          // committed since then would be lost, so refuse instead of writing.
          const lockedLive = await readLiveSourceFile({
            ...boardFile,
            content: lockedBoardContent,
          } as SourceWorkspaceFile);
          if (lockedLive.content !== liveBoard.content) {
            fail(
              "The Design board changed while the journey was being drawn. No journey content was written; run the action again.",
              { errorCode: "journey_board_changed", statusCode: 409 },
            );
          }
          const staleFiles = await tx
            .select({ id: schema.designFiles.id })
            .from(schema.designFiles)
            .where(
              and(
                eq(schema.designFiles.designId, designId),
                like(schema.designFiles.id, likePrefix(JOURNEY_FILE_ID_PREFIX)),
                like(
                  schema.designFiles.filename,
                  likePrefix(JOURNEY_FILENAME_PREFIX),
                ),
              ),
            );
          const staleRows = await tx
            .select({
              id: schema.designBoardReplayScreenshots.id,
              blobHandle: schema.designBoardReplayScreenshots.blobHandle,
            })
            .from(schema.designBoardReplayScreenshots)
            .where(
              and(
                eq(schema.designBoardReplayScreenshots.designId, designId),
                like(
                  schema.designBoardReplayScreenshots.id,
                  likePrefix(JOURNEY_REPLAY_ROW_PREFIX),
                ),
              ),
            );
          // A retried attempt finds this run's own rows; their blobs stay.
          removedBlobHandles = staleRows
            .map((row) => row.blobHandle)
            .filter((handle) => !ownBlobHandles.has(handle));
          await queueVisualEditSnapshotBlobCleanupInTransaction(
            tx,
            removedBlobHandles,
          );
          if (staleRows.length) {
            await tx.delete(schema.designBoardReplayScreenshots).where(
              and(
                eq(schema.designBoardReplayScreenshots.designId, designId),
                inArray(
                  schema.designBoardReplayScreenshots.id,
                  staleRows.map((row) => row.id),
                ),
              ),
            );
          }
          if (staleFiles.length) {
            await tx.delete(schema.designFiles).where(
              and(
                eq(schema.designFiles.designId, designId),
                inArray(
                  schema.designFiles.id,
                  staleFiles.map((file) => file.id),
                ),
              ),
            );
          }
          for (const batch of chunks(plan.screens, INSERT_CHUNK)) {
            await tx.insert(schema.designFiles).values(
              batch.map((screen) => ({
                id: screen.fileId,
                designId,
                filename: screen.filename,
                fileType: "html",
                content: screen.html,
                contentOperationSource: null,
                contentOperationRevision: null,
                contentOperationResultHash: null,
                createdAt: now,
                updatedAt: now,
              })),
            );
          }
          for (const batch of chunks(attachmentScreens, INSERT_CHUNK)) {
            await tx.insert(schema.designBoardReplayScreenshots).values(
              batch.map(({ attachment }) => {
                const blob = stored.get(attachment!.rowId)!;
                return {
                  id: attachment!.rowId,
                  designId,
                  boardFileId: boardFile.id,
                  replayId: attachment!.replayId,
                  capturedAt: attachment!.capturedAt,
                  app: input.tree.app,
                  route: attachment!.route,
                  offsetMs: attachment!.offsetMs,
                  viewportWidth: attachment!.width,
                  viewportHeight: attachment!.height,
                  eventCount: 0,
                  mimeType: blob.mimeType,
                  sizeBytes: blob.sizeBytes,
                  blobHandle: JSON.stringify(blob.blobHandle),
                  createdAt: now,
                  visibility: design.visibility,
                  ownerEmail: design.ownerEmail,
                  orgId: design.orgId,
                };
              }),
            );
          }
        },
        isApplied: (persistedData) => {
          const frames = isRecord(persistedData.canvasFrames)
            ? persistedData.canvasFrames
            : {};
          return plan.screens.every((screen) => {
            const frame = frames[screen.fileId];
            return isRecord(frame) && frame.width === screen.frame.width;
          });
        },
      });

      const collabSyncPending = await reconcileCollaboration({
        boardFileId: boardFile.id,
        previousBoardContent: liveBoard.content,
        nextBoardContent,
        screens: plan.screens,
      });
      if (removedBlobHandles.length) {
        try {
          await deleteVisualEditSnapshotBlobs(removedBlobHandles);
        } catch (error) {
          console.warn(
            "[design-journey-canvas] Replaced screenshot cleanup remains queued:",
            error,
          );
        }
      }

      return {
        designId,
        url: designDeepLink(designId),
        nodeCount: plan.nodeCount,
        frameCount: plan.frameCount,
        skippedNodes: plan.skippedNodes,
        collabSyncPending,
      };
    } catch (error) {
      const mayHaveLanded =
        mutationStarted &&
        (await writeMayHaveLanded({
          designId,
          isNewDesign: Boolean(createdDesignId),
          blobHandles: [...stored.values()].map((blob) =>
            JSON.stringify(blob.blobHandle),
          ),
        }));
      if (!mayHaveLanded) {
        if (createdDesignId) {
          try {
            await deleteDesign.run({ id: createdDesignId }, context);
          } catch (cleanupError) {
            console.warn(
              "[design-journey-canvas] Newly created Design cleanup failed:",
              cleanupError,
            );
          }
        }
        await discardPrivateBlobs(
          [...stored.values()].map((blob) => blob.blobHandle),
        );
      }
      throw error;
    }
  },
  changeResource: (_input, result) =>
    designChangeResource((result as { designId?: string }).designId, result),
  link: ({ result }) => {
    const { url } = (result ?? {}) as { url?: string };
    return url
      ? { url, label: "Open journey storyboard", view: "editor" }
      : null;
  },
});

/**
 * `mutateDesignData` can reject after its transaction committed, and deleting
 * the design or blobs then would break rows that reference them. When the
 * database cannot answer, assume the write landed.
 */
async function writeMayHaveLanded(args: {
  designId: string;
  isNewDesign: boolean;
  blobHandles: readonly string[];
}): Promise<boolean> {
  try {
    await assertAccess("design", args.designId, "editor");
    const db = getDb();
    if (args.blobHandles.length) {
      const rows = await db
        .select({ blobHandle: schema.designBoardReplayScreenshots.blobHandle })
        .from(schema.designBoardReplayScreenshots)
        .where(
          and(
            eq(schema.designBoardReplayScreenshots.designId, args.designId),
            like(
              schema.designBoardReplayScreenshots.id,
              likePrefix(JOURNEY_REPLAY_ROW_PREFIX),
            ),
          ),
        );
      if (rows.some((row) => args.blobHandles.includes(row.blobHandle))) {
        return true;
      }
    }
    if (!args.isNewDesign) return false;
    const files = await db
      .select({ id: schema.designFiles.id })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.designId, args.designId),
          like(schema.designFiles.id, likePrefix(JOURNEY_FILE_ID_PREFIX)),
        ),
      )
      .limit(1);
    return files.length > 0;
  } catch (error) {
    console.warn(
      "[design-journey-canvas] Could not tell whether the write landed; keeping the design and screenshots:",
      error,
    );
    return true;
  }
}

/**
 * The SQL rows are already committed; this brings the live Yjs documents in
 * line with them. A failure here is logged and returned as the file ids still
 * pending, never thrown: the storyboard is saved and the editor reseeds an
 * unseeded document from SQL on open.
 */
async function reconcileCollaboration(args: {
  boardFileId: string;
  previousBoardContent: string;
  nextBoardContent: string;
  screens: readonly { fileId: string; html: string }[];
}): Promise<string[]> {
  const pending: string[] = [];
  try {
    if (await hasCollabState(args.boardFileId)) {
      await applyText(
        args.boardFileId,
        args.nextBoardContent,
        "content",
        "agent",
        {
          validateBase: (base) => {
            if (base !== args.previousBoardContent) {
              // guard:allow-bare-error — invariant: refuse to merge into a board edited since we read it.
              throw new Error(
                "Live board content changed before the journey canvas was written.",
              );
            }
          },
        },
      );
    } else {
      await seedFromText(args.boardFileId, args.nextBoardContent);
    }
  } catch (error) {
    pending.push(args.boardFileId);
    console.warn(
      "[design-journey-canvas] Board saved but collaboration reconcile is pending:",
      error,
    );
  }
  for (const batch of chunks(args.screens, UPLOAD_CONCURRENCY)) {
    const results = await Promise.allSettled(
      // Refresh reuses screen ids, and seedFromText skips a document that
      // already has state, so a live document must be updated in place.
      batch.map(async (screen) => {
        if (await hasCollabState(screen.fileId)) {
          await applyText(screen.fileId, screen.html, "content", "agent");
        } else {
          await seedFromText(screen.fileId, screen.html);
        }
      }),
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        pending.push(batch[index]!.fileId);
        console.warn(
          "[design-journey-canvas] Screen saved but collaboration sync is pending:",
          result.reason,
        );
      }
    });
  }
  return pending;
}
