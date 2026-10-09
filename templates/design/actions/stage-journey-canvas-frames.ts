import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { pngDimensions } from "../server/lib/png-dimensions.js";
import {
  discardPrivateBlobs,
  resolveReplayScreenshotStorage,
  storeReplayScreenshotBytesAsPrivateBlob,
} from "../server/lib/replay-screenshot-blobs.js";
import {
  deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction,
} from "../server/lib/visual-edit-snapshot-blobs.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";
import {
  JOURNEY_STAGED_REPLAY_MAX_AGE_MS,
  JOURNEY_STAGED_REPLAY_ROW_PREFIX,
} from "../shared/journey-canvas.js";

const MAX_STAGE_FRAMES = 8;
const MAX_STAGE_BODY_BYTES = 5 * 1024 * 1024;
const MAX_STAGE_ENCODED_IMAGE_BYTES = 4_800_000;
const MAX_VIEWPORT_DIMENSION = 8_192;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_STAGED_BYTES_PER_DESIGN = 512 * 1024 * 1024;
const MAX_STAGED_BYTES_PER_IMPORT = 256 * 1024 * 1024;
const MAX_STAGED_FRAMES_PER_DESIGN = 2_000;
const MAX_STAGED_ROWS_TO_INSPECT =
  MAX_STAGED_FRAMES_PER_DESIGN + MAX_STAGE_FRAMES + 1;
const STAGE_APP_PREFIX = "journey-canvas-stage:v2:";
const STAGE_BOARD_FILE_PREFIX = "journey-canvas-stage:";

const frameSchema = z
  .object({
    frameKey: z.string().min(1).max(2_048),
    replayId: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .refine((value) => !value.includes("\u0000")),
    app: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{0,127}$/),
    route: z
      .string()
      .trim()
      .min(1)
      .max(2_048)
      .refine((value) => !value.includes("\u0000")),
    offsetMs: z.number().int().min(0).max(2_147_483_647),
    width: z.number().int().min(1).max(MAX_VIEWPORT_DIMENSION),
    height: z.number().int().min(1).max(MAX_VIEWPORT_DIMENSION),
    capturedAt: z
      .string()
      .max(64)
      .refine(
        (value) =>
          /^\d{4}-\d{2}-\d{2}T/.test(value) &&
          Number.isFinite(Date.parse(value)),
        "Expected an ISO-8601 timestamp.",
      ),
    pngBase64: z.string().min(1).max(14_000_000),
  })
  .strict();

const inputSchema = z
  .object({
    designId: z.string().min(1).max(128),
    importId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    frames: z.array(frameSchema).min(1).max(MAX_STAGE_FRAMES),
    allowEncryptedPublicUploadFallback: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, ctx) => {
    const frameKeys = new Set<string>();
    for (const [index, frame] of input.frames.entries()) {
      if (frameKeys.has(frame.frameKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["frames", index, "frameKey"],
          message: "A staging batch cannot contain the same frameKey twice.",
        });
      }
      frameKeys.add(frame.frameKey);
    }
  });

type StageFrame = z.infer<typeof frameSchema>;

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function utcTimestamp(value: string): string {
  return new Date(Date.parse(value)).toISOString();
}

function decodePng(frame: StageFrame): Uint8Array {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      frame.pngBase64,
    )
  ) {
    fail("pngBase64 must be canonical base64 PNG data.", {
      errorCode: "journey_frame_invalid_base64",
      statusCode: 400,
    });
  }
  const data = Buffer.from(frame.pngBase64, "base64");
  if (data.toString("base64") !== frame.pngBase64) {
    fail("pngBase64 must be canonical base64 PNG data.", {
      errorCode: "journey_frame_invalid_base64",
      statusCode: 400,
    });
  }
  const dimensions = pngDimensions(data, {
    maxDimension: MAX_VIEWPORT_DIMENSION,
    maxPixels: MAX_IMAGE_PIXELS,
  });
  if (!dimensions) {
    fail("Each staged screenshot must be a valid PNG image.", {
      errorCode: "journey_frame_invalid_png",
      statusCode: 400,
    });
  }
  if (dimensions.width !== frame.width || dimensions.height !== frame.height) {
    fail(
      "PNG dimensions must match the frame metadata and fit the supported viewport limits.",
      {
        errorCode: "journey_frame_dimensions_mismatch",
        statusCode: 400,
      },
    );
  }
  return data;
}

function stageRowId(designId: string, importId: string, frameKey: string) {
  return `${JOURNEY_STAGED_REPLAY_ROW_PREFIX}${digest(`${designId}\u0000${importId}\u0000${frameKey}`).slice(0, 40)}`;
}

function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, "\\$&")}%`;
}

function expiredStageRow(createdAt: string | null, now: number): boolean {
  const createdAtMs = createdAt ? Date.parse(createdAt) : Number.NaN;
  return (
    !Number.isFinite(createdAtMs) ||
    now - createdAtMs >= JOURNEY_STAGED_REPLAY_MAX_AGE_MS
  );
}

function matchesStageFrame(
  row: {
    app: string;
    route: string;
    replayId: string;
    capturedAt: string;
    offsetMs: number;
    viewportWidth: number;
    viewportHeight: number;
    sizeBytes: number;
  },
  frame: StageFrame,
  marker: string,
  capturedAt: string,
  sizeBytes: number,
): boolean {
  return (
    row.app === marker &&
    row.route === frame.route &&
    row.replayId === frame.replayId &&
    row.capturedAt === capturedAt &&
    row.offsetMs === frame.offsetMs &&
    row.viewportWidth === frame.width &&
    row.viewportHeight === frame.height &&
    row.sizeBytes === sizeBytes
  );
}

function stageMarker(frame: StageFrame, importId: string, data: Uint8Array) {
  return `${STAGE_APP_PREFIX}${Buffer.from(
    JSON.stringify({
      importId,
      frameKeyHash: digest(frame.frameKey),
      imageSha256: digest(data),
      app: frame.app,
    }),
  ).toString("base64url")}`;
}

export default defineAction({
  description:
    "Stage up to 8 native PNG frames for a Design journey storyboard. Use a stable importId and frameKey (`nodeKey` + NUL + `exampleIndex`) for resumable retries; the action stores only private blob handles and metadata, never PNG bytes in SQL. Each batch stays within 5 MiB, each import is capped at 256 MiB, and each Design at 512 MiB or 2,000 staged frames. Unpromoted frames expire after 7 days. The returned stagedFrameId is passed to create-journey-canvas for a zero-copy consume.",
  requiresAuth: true,
  maxBodyBytes: MAX_STAGE_BODY_BYTES,
  schema: inputSchema,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input) => {
    const encodedImageBytes = input.frames.reduce(
      (total, frame) => total + Buffer.byteLength(frame.pngBase64, "utf8"),
      0,
    );
    const requestBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
    if (requestBytes > MAX_STAGE_BODY_BYTES) {
      fail(
        "The staging request exceeds 5 MiB; split the batch before retrying.",
        {
          errorCode: "journey_stage_batch_too_large",
          statusCode: 413,
        },
      );
    }
    if (encodedImageBytes > MAX_STAGE_ENCODED_IMAGE_BYTES) {
      const oversizedFrame = input.frames.find(
        (frame) =>
          Buffer.byteLength(frame.pngBase64, "utf8") >
          MAX_STAGE_ENCODED_IMAGE_BYTES,
      );
      fail(
        oversizedFrame
          ? "A single frame exceeds the 4.8 MB encoded image limit. Re-export that PNG at a smaller file size and retry with the same frame key."
          : "Encoded screenshot data exceeds 4.8 MB; split the batch before retrying.",
        {
          errorCode: oversizedFrame
            ? "journey_frame_payload_too_large"
            : "journey_stage_batch_too_large",
          statusCode: 413,
        },
      );
    }
    const requesterEmail = getRequestUserEmail();
    if (!requesterEmail) {
      fail("A signed-in user is required.", { statusCode: 401 });
    }
    const access = await assertAccess("design", input.designId, "editor");
    const design = access.resource as typeof schema.designs.$inferSelect;
    let storagePromise:
      | ReturnType<typeof resolveReplayScreenshotStorage>
      | undefined;
    const resolveStorage = () =>
      (storagePromise ??= resolveReplayScreenshotStorage(
        input.allowEncryptedPublicUploadFallback,
      ));
    const preparedFrames = input.frames.map((frame) => {
      const data = decodePng(frame);
      return {
        frame,
        data,
        capturedAt: utcTimestamp(frame.capturedAt),
        id: stageRowId(input.designId, input.importId, frame.frameKey),
        marker: stageMarker(frame, input.importId, data),
      };
    });
    const db = getDb();
    const newlyStored: Array<{ id: string; blobHandle: string }> = [];
    let outcome: {
      expiredHandles: string[];
      stagedFrames: Array<{
        frameKey: string;
        stagedFrameId: string;
        sizeBytes: number;
        width: number;
        height: number;
      }>;
      expiredInput: boolean;
      quotaExceeded: boolean;
    };

    try {
      outcome = await withDesignSourceMutationTransaction(
        input.designId,
        async (tx) => {
          const table = schema.designBoardReplayScreenshots;
          const now = Date.now();
          const cutoff = now - JOURNEY_STAGED_REPLAY_MAX_AGE_MS;
          const stagedScope = and(
            eq(table.designId, input.designId),
            like(table.id, likePrefix(JOURNEY_STAGED_REPLAY_ROW_PREFIX)),
            like(table.boardFileId, likePrefix(STAGE_BOARD_FILE_PREFIX)),
            like(table.app, likePrefix(STAGE_APP_PREFIX)),
          );
          const requestedIds = preparedFrames.map(({ id }) => id);
          const [requestedRows, stagedRows] = await Promise.all([
            tx
              .select({
                id: table.id,
                boardFileId: table.boardFileId,
                app: table.app,
                route: table.route,
                replayId: table.replayId,
                capturedAt: table.capturedAt,
                offsetMs: table.offsetMs,
                viewportWidth: table.viewportWidth,
                viewportHeight: table.viewportHeight,
                sizeBytes: table.sizeBytes,
                blobHandle: table.blobHandle,
                createdAt: table.createdAt,
              })
              .from(table)
              .where(and(stagedScope, inArray(table.id, requestedIds)))
              .for("update"),
            tx
              .select({
                id: table.id,
                boardFileId: table.boardFileId,
                app: table.app,
                route: table.route,
                replayId: table.replayId,
                capturedAt: table.capturedAt,
                offsetMs: table.offsetMs,
                viewportWidth: table.viewportWidth,
                viewportHeight: table.viewportHeight,
                sizeBytes: table.sizeBytes,
                blobHandle: table.blobHandle,
                createdAt: table.createdAt,
              })
              .from(table)
              .where(stagedScope)
              .orderBy(table.createdAt)
              .for("update")
              .limit(MAX_STAGED_ROWS_TO_INSPECT),
          ]);

          const expiredById = new Map<
            string,
            { id: string; blobHandle: string }
          >();
          for (const row of [...stagedRows, ...requestedRows]) {
            if (expiredStageRow(row.createdAt, now)) {
              expiredById.set(row.id, {
                id: row.id,
                blobHandle: row.blobHandle,
              });
            }
          }
          const expiredRows = [...expiredById.values()];
          const expiredHandles = expiredRows.map((row) => row.blobHandle);
          if (expiredRows.length) {
            await queueVisualEditSnapshotBlobCleanupInTransaction(
              tx,
              expiredHandles,
            );
            await tx.delete(table).where(
              and(
                eq(table.designId, input.designId),
                inArray(
                  table.id,
                  expiredRows.map((row) => row.id),
                ),
              ),
            );
          }

          const expiredInput = requestedIds.some((id) => expiredById.has(id));
          const activeById = new Map<string, (typeof stagedRows)[number]>();
          for (const row of [...stagedRows, ...requestedRows]) {
            if (!expiredById.has(row.id)) activeById.set(row.id, row);
          }
          const activeRows = [...activeById.values()];
          const newFrames = preparedFrames.filter(
            ({ id }) => !activeById.has(id),
          );

          if (expiredInput) {
            return {
              expiredHandles,
              stagedFrames: [],
              expiredInput: true,
              quotaExceeded: false,
            };
          }

          for (const prepared of preparedFrames) {
            const existing = activeById.get(prepared.id);
            if (
              existing &&
              !matchesStageFrame(
                existing,
                prepared.frame,
                prepared.marker,
                prepared.capturedAt,
                prepared.data.byteLength,
              )
            ) {
              fail(
                "A staged frame key already exists with different screenshot data or provenance. Use a new importId for changed frames.",
                {
                  errorCode: "journey_frame_idempotency_conflict",
                  statusCode: 409,
                },
              );
            }
          }

          const designBytes = activeRows.reduce(
            (total, row) => total + row.sizeBytes,
            0,
          );
          const importBoardFileId = STAGE_BOARD_FILE_PREFIX + input.importId;
          const importRows = activeRows.filter(
            (row) => row.boardFileId === importBoardFileId,
          );
          const importBytes = importRows.reduce(
            (total, row) => total + row.sizeBytes,
            0,
          );
          const addedBytes = newFrames.reduce(
            (total, frame) => total + frame.data.byteLength,
            0,
          );
          const quotaExceeded =
            stagedRows.length === MAX_STAGED_ROWS_TO_INSPECT ||
            activeRows.length + newFrames.length >
              MAX_STAGED_FRAMES_PER_DESIGN ||
            designBytes + addedBytes > MAX_STAGED_BYTES_PER_DESIGN ||
            importBytes + addedBytes > MAX_STAGED_BYTES_PER_IMPORT;
          if (quotaExceeded) {
            return {
              expiredHandles,
              stagedFrames: [],
              expiredInput: false,
              quotaExceeded: true,
            };
          }

          const storage = newFrames.length ? await resolveStorage() : null;
          const stagedFrames: Array<{
            frameKey: string;
            stagedFrameId: string;
            sizeBytes: number;
            width: number;
            height: number;
          }> = [];
          for (const prepared of preparedFrames) {
            const existing = activeById.get(prepared.id);
            if (existing) {
              stagedFrames.push({
                frameKey: prepared.frame.frameKey,
                stagedFrameId: prepared.id,
                sizeBytes: existing.sizeBytes,
                width: existing.viewportWidth,
                height: existing.viewportHeight,
              });
              continue;
            }

            const stored = await storeReplayScreenshotBytesAsPrivateBlob({
              data: prepared.data,
              blobOwnerEmail: design.ownerEmail,
              providerId:
                storage?.kind === "private-provider"
                  ? storage.providerId
                  : undefined,
              rowId: prepared.id,
              designId: input.designId,
              replayId: prepared.frame.replayId,
            });
            const blobHandle = JSON.stringify(stored.blobHandle);
            newlyStored.push({ id: prepared.id, blobHandle });
            const inserted = await tx
              .insert(table)
              .values({
                id: prepared.id,
                designId: input.designId,
                boardFileId: importBoardFileId,
                replayId: prepared.frame.replayId,
                capturedAt: prepared.capturedAt,
                app: prepared.marker,
                route: prepared.frame.route,
                offsetMs: prepared.frame.offsetMs,
                viewportWidth: prepared.frame.width,
                viewportHeight: prepared.frame.height,
                eventCount: 0,
                mimeType: stored.mimeType,
                sizeBytes: stored.sizeBytes,
                blobHandle,
                visibility: design.visibility,
                ownerEmail: design.ownerEmail,
                orgId: design.orgId,
                createdAt: new Date().toISOString(),
              })
              .onConflictDoNothing()
              .returning({ id: table.id });
            if (!inserted.length) {
              newlyStored.pop();
              await discardPrivateBlobs([stored.blobHandle]);
              fail(
                "A staged frame changed while the batch was being stored. Retry the same batch.",
                {
                  errorCode: "journey_frame_stage_conflict",
                  statusCode: 409,
                },
              );
            }

            const [persisted] = await tx
              .select({
                app: table.app,
                route: table.route,
                replayId: table.replayId,
                capturedAt: table.capturedAt,
                offsetMs: table.offsetMs,
                viewportWidth: table.viewportWidth,
                viewportHeight: table.viewportHeight,
                sizeBytes: table.sizeBytes,
              })
              .from(table)
              .where(
                and(
                  eq(table.id, prepared.id),
                  eq(table.designId, input.designId),
                ),
              )
              .limit(1);
            if (
              !persisted ||
              !matchesStageFrame(
                persisted,
                prepared.frame,
                prepared.marker,
                prepared.capturedAt,
                prepared.data.byteLength,
              )
            ) {
              fail(
                "The staged frame was stored, but its row could not be verified. Retry the same batch to recover it.",
                {
                  errorCode: "journey_frame_stage_verification_failed",
                  statusCode: 503,
                },
              );
            }
            stagedFrames.push({
              frameKey: prepared.frame.frameKey,
              stagedFrameId: prepared.id,
              sizeBytes: stored.sizeBytes,
              width: prepared.frame.width,
              height: prepared.frame.height,
            });
          }

          return {
            expiredHandles,
            stagedFrames,
            expiredInput: false,
            quotaExceeded: false,
          };
        },
      );
    } catch (error) {
      if (newlyStored.length) {
        try {
          const persistedRows = await db
            .select({
              id: schema.designBoardReplayScreenshots.id,
              blobHandle: schema.designBoardReplayScreenshots.blobHandle,
            })
            .from(schema.designBoardReplayScreenshots)
            .where(
              and(
                eq(
                  schema.designBoardReplayScreenshots.designId,
                  input.designId,
                ),
                inArray(
                  schema.designBoardReplayScreenshots.id,
                  newlyStored.map((row) => row.id),
                ),
              ),
            );
          const persistedHandles = new Map(
            persistedRows.map((row) => [row.id, row.blobHandle]),
          );
          const orphaned = newlyStored
            .filter((row) => persistedHandles.get(row.id) !== row.blobHandle)
            .map((row) => JSON.parse(row.blobHandle));
          if (orphaned.length) await discardPrivateBlobs(orphaned);
        } catch {
          // Keep blobs when a failed transaction's commit outcome cannot be read.
        }
      }
      throw error;
    }

    await deleteVisualEditSnapshotBlobs(outcome.expiredHandles);
    if (outcome.expiredInput) {
      fail(
        "This staged import expired after 7 days. Start a new importId and restage its frames.",
        { errorCode: "journey_staged_frame_expired", statusCode: 410 },
      );
    }
    if (outcome.quotaExceeded) {
      fail(
        "Staged screenshots reached this Design's storage limit. Discard an unused import or retry after expired frames are cleaned up.",
        { errorCode: "journey_staging_quota_exceeded", statusCode: 413 },
      );
    }
    return {
      designId: input.designId,
      importId: input.importId,
      stagedFrames: outcome.stagedFrames,
    };
  },
});
