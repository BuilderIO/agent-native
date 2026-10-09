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
const MAX_STAGE_BATCH_PIXELS = 32_000_000;
const MAX_VIEWPORT_DIMENSION = 8_192;
const MAX_IMAGE_PIXELS = 16_000_000;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
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
type StageRow = {
  id: string;
  boardFileId: string;
  app: string;
  route: string;
  replayId: string;
  capturedAt: string;
  offsetMs: number;
  viewportWidth: number;
  viewportHeight: number;
  sizeBytes: number;
  blobHandle: string;
  createdAt: string | null;
};
type PreparedStageFrame = {
  frame: StageFrame;
  data: Uint8Array;
  capturedAt: string;
  id: string;
  marker: string;
};

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function utcTimestamp(value: string): string {
  return new Date(Date.parse(value)).toISOString();
}

function decodePngBytes(frame: StageFrame): Uint8Array {
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
  return data;
}

function pngHeaderDimensions(
  data: Uint8Array,
): { width: number; height: number } | null {
  const png = Buffer.from(data);
  if (
    png.byteLength < 33 ||
    !png.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE) ||
    png.readUInt32BE(8) !== 13 ||
    png.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_VIEWPORT_DIMENSION ||
    height > MAX_VIEWPORT_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    return null;
  }
  return { width, height };
}

function validatePng(frame: StageFrame, data: Uint8Array): void {
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

function stageScope(designId: string) {
  const table = schema.designBoardReplayScreenshots;
  return and(
    eq(table.designId, designId),
    like(table.id, likePrefix(JOURNEY_STAGED_REPLAY_ROW_PREFIX)),
    like(table.boardFileId, likePrefix(STAGE_BOARD_FILE_PREFIX)),
    like(table.app, likePrefix(STAGE_APP_PREFIX)),
  );
}

function stageColumns() {
  const table = schema.designBoardReplayScreenshots;
  return {
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
  };
}

async function readStageRows(
  db: ReturnType<typeof getDb>,
  designId: string,
  requestedIds: string[],
) {
  const table = schema.designBoardReplayScreenshots;
  const scope = stageScope(designId);
  const columns = stageColumns();
  return Promise.all([
    db
      .select(columns)
      .from(table)
      .where(and(scope, inArray(table.id, requestedIds))),
    db
      .select(columns)
      .from(table)
      .where(scope)
      .orderBy(table.createdAt)
      .limit(MAX_STAGED_ROWS_TO_INSPECT),
  ]);
}

function activeStageRows(
  requestedRows: StageRow[],
  stagedRows: StageRow[],
  now: number,
): StageRow[] {
  const byId = new Map<string, StageRow>();
  for (const row of [...stagedRows, ...requestedRows]) {
    if (!expiredStageRow(row.createdAt, now)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

function exceedsStageQuota(args: {
  activeRows: StageRow[];
  newFrames: PreparedStageFrame[];
  importBoardFileId: string;
  inspectedRows: number;
}): boolean {
  const designBytes = args.activeRows.reduce(
    (total, row) => total + row.sizeBytes,
    0,
  );
  const importBytes = args.activeRows
    .filter((row) => row.boardFileId === args.importBoardFileId)
    .reduce((total, row) => total + row.sizeBytes, 0);
  const addedBytes = args.newFrames.reduce(
    (total, frame) => total + frame.data.byteLength,
    0,
  );
  return (
    args.inspectedRows === MAX_STAGED_ROWS_TO_INSPECT ||
    args.activeRows.length + args.newFrames.length >
      MAX_STAGED_FRAMES_PER_DESIGN ||
    designBytes + addedBytes > MAX_STAGED_BYTES_PER_DESIGN ||
    importBytes + addedBytes > MAX_STAGED_BYTES_PER_IMPORT
  );
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
    const encodedFrames = input.frames.map((frame) => ({
      frame,
      data: decodePngBytes(frame),
    }));
    const headerDimensions = encodedFrames.map(({ frame, data }) => {
      const dimensions = pngHeaderDimensions(data);
      if (!dimensions) {
        fail("Each staged screenshot must be a valid PNG image.", {
          errorCode: "journey_frame_invalid_png",
          statusCode: 400,
        });
      }
      if (
        dimensions.width !== frame.width ||
        dimensions.height !== frame.height
      ) {
        fail(
          "PNG dimensions must match the frame metadata and fit the supported viewport limits.",
          {
            errorCode: "journey_frame_dimensions_mismatch",
            statusCode: 400,
          },
        );
      }
      return dimensions;
    });
    const batchPixels = headerDimensions.reduce(
      (total, dimensions) => total + dimensions.width * dimensions.height,
      0,
    );
    if (batchPixels > MAX_STAGE_BATCH_PIXELS) {
      fail(
        "A staging batch may contain at most 32 million decoded pixels; split the batch and retry.",
        {
          errorCode: "journey_stage_pixel_work_too_large",
          statusCode: 413,
        },
      );
    }
    const preparedFrames = encodedFrames.map(({ frame, data }) => {
      validatePng(frame, data);
      return {
        frame,
        data,
        capturedAt: utcTimestamp(frame.capturedAt),
        id: stageRowId(input.designId, input.importId, frame.frameKey),
        marker: stageMarker(frame, input.importId, data),
      };
    });
    const db = getDb();
    const table = schema.designBoardReplayScreenshots;
    const requestedIds = preparedFrames.map(({ id }) => id);
    const importBoardFileId = STAGE_BOARD_FILE_PREFIX + input.importId;
    const [preflightRequestedRows, preflightStagedRows] = await readStageRows(
      db,
      input.designId,
      requestedIds,
    );
    const preflightNow = Date.now();
    const preflightHasExpiredRows = [
      ...preflightRequestedRows,
      ...preflightStagedRows,
    ].some((row) => expiredStageRow(row.createdAt, preflightNow));
    const preflightHasExpiredInput = preflightRequestedRows.some((row) =>
      expiredStageRow(row.createdAt, preflightNow),
    );
    const preflightRows = activeStageRows(
      preflightRequestedRows,
      preflightStagedRows,
      preflightNow,
    );
    const preflightById = new Map(preflightRows.map((row) => [row.id, row]));
    const assertIdempotentFrames = (rowsById: Map<string, StageRow>) => {
      for (const prepared of preparedFrames) {
        const existing = rowsById.get(prepared.id);
        if (
          existing &&
          (existing.boardFileId !== importBoardFileId ||
            !matchesStageFrame(
              existing,
              prepared.frame,
              prepared.marker,
              prepared.capturedAt,
              prepared.data.byteLength,
            ))
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
    };
    assertIdempotentFrames(preflightById);
    const preflightNewFrames = preparedFrames.filter(
      ({ id }) => !preflightById.has(id),
    );
    const preflightExceedsQuota = exceedsStageQuota({
      activeRows: preflightRows,
      newFrames: preflightNewFrames,
      importBoardFileId,
      inspectedRows: preflightStagedRows.length,
    });
    if (!preflightHasExpiredRows && preflightExceedsQuota) {
      fail(
        "Staged screenshots reached this Design's storage limit. Discard an unused import or retry after expired frames are cleaned up.",
        { errorCode: "journey_staging_quota_exceeded", statusCode: 413 },
      );
    }

    const preflightAtInspectionCap =
      preflightStagedRows.length === MAX_STAGED_ROWS_TO_INSPECT;
    const shouldUploadFrames =
      preflightNewFrames.length > 0 &&
      !preflightExceedsQuota &&
      !preflightHasExpiredInput &&
      !preflightAtInspectionCap;
    const storage = shouldUploadFrames ? await resolveStorage() : null;
    type StoredStageBlob = Awaited<
      ReturnType<typeof storeReplayScreenshotBytesAsPrivateBlob>
    >;
    const uploadedById = new Map<
      string,
      { serializedHandle: string; stored: StoredStageBlob }
    >();
    const uploadResults = await Promise.allSettled(
      !shouldUploadFrames
        ? []
        : preflightNewFrames.map(async (prepared) => {
            const stored = await storeReplayScreenshotBytesAsPrivateBlob({
              data: prepared.data,
              blobOwnerEmail: design.ownerEmail,
              providerId:
                storage?.kind === "private-provider"
                  ? storage.providerId
                  : undefined,
              rowId: prepared.id + "-" + digest(prepared.data).slice(0, 16),
              designId: input.designId,
              replayId: prepared.frame.replayId,
            });
            if (stored.sizeBytes !== prepared.data.byteLength) {
              await discardPrivateBlobs([stored.blobHandle]);
              fail(
                "Private screenshot storage returned a different byte count than the validated PNG.",
                {
                  errorCode: "private_blob_write_failed",
                  statusCode: 503,
                },
              );
            }
            uploadedById.set(prepared.id, {
              serializedHandle: JSON.stringify(stored.blobHandle),
              stored,
            });
          }),
    );
    const uploadFailure = uploadResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    const cleanupUnreferencedUploads = async () => {
      if (uploadedById.size === 0) return true;
      try {
        const serializedHandles = [...uploadedById.values()].map(
          ({ serializedHandle }) => serializedHandle,
        );
        const referencedRows = await db
          .select({ blobHandle: table.blobHandle })
          .from(table)
          .where(inArray(table.blobHandle, serializedHandles));
        const referencedHandles = new Set(
          referencedRows.map((row) => row.blobHandle),
        );
        const orphaned = [...uploadedById.values()]
          .filter(
            ({ serializedHandle }) => !referencedHandles.has(serializedHandle),
          )
          .map(({ stored }) => stored.blobHandle);
        if (orphaned.length) await discardPrivateBlobs(orphaned);
        return true;
      } catch (error) {
        // Preserve blobs when SQL cannot confirm whether a committed row references them.
        console.warn(
          "[design-journey-canvas] Could not verify staged screenshot references; keeping uploaded blobs.",
          error,
        );
        return false;
      }
    };
    if (uploadFailure) {
      await cleanupUnreferencedUploads();
      throw uploadFailure.reason;
    }

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
      retryRequired: boolean;
    };
    try {
      outcome = await withDesignSourceMutationTransaction(
        input.designId,
        async (tx) => {
          const now = Date.now();
          const [requestedRows, stagedRows] = await Promise.all([
            tx
              .select(stageColumns())
              .from(table)
              .where(
                and(
                  stageScope(input.designId),
                  inArray(table.id, requestedIds),
                ),
              )
              .for("update"),
            tx
              .select(stageColumns())
              .from(table)
              .where(stageScope(input.designId))
              .orderBy(table.createdAt)
              .for("update")
              .limit(MAX_STAGED_ROWS_TO_INSPECT),
          ]);
          const expiredById = new Map<string, StageRow>();
          for (const row of [...stagedRows, ...requestedRows]) {
            if (expiredStageRow(row.createdAt, now))
              expiredById.set(row.id, row);
          }
          const expiredIds = [...expiredById.keys()];
          const expiredHandles = [
            ...new Set([...expiredById.values()].map((row) => row.blobHandle)),
          ];
          if (expiredIds.length) {
            await tx
              .delete(table)
              .where(
                and(
                  eq(table.designId, input.designId),
                  inArray(table.id, expiredIds),
                ),
              );
          }
          const expiredInput = requestedIds.some((id) => expiredById.has(id));
          const finishExpiredCleanup = async () => {
            if (expiredHandles.length === 0) return [];
            const references = await tx
              .select({ blobHandle: table.blobHandle })
              .from(table)
              .where(inArray(table.blobHandle, expiredHandles));
            const referencedHandles = new Set(
              references.map((row) => row.blobHandle),
            );
            const orphanedHandles = expiredHandles.filter(
              (handle) => !referencedHandles.has(handle),
            );
            if (orphanedHandles.length) {
              await queueVisualEditSnapshotBlobCleanupInTransaction(
                tx,
                orphanedHandles,
              );
            }
            return orphanedHandles;
          };
          if (expiredInput) {
            return {
              expiredHandles: await finishExpiredCleanup(),
              stagedFrames: [],
              expiredInput: true,
              quotaExceeded: false,
              retryRequired: false,
            };
          }

          const activeRows = activeStageRows(requestedRows, stagedRows, now);
          const activeById = new Map(activeRows.map((row) => [row.id, row]));
          assertIdempotentFrames(activeById);
          const newFrames = preparedFrames.filter(
            ({ id }) => !activeById.has(id),
          );
          if (
            exceedsStageQuota({
              activeRows,
              newFrames,
              importBoardFileId,
              inspectedRows: stagedRows.length,
            })
          ) {
            return {
              expiredHandles: await finishExpiredCleanup(),
              stagedFrames: [],
              expiredInput: false,
              quotaExceeded: true,
              retryRequired: false,
            };
          }
          if (newFrames.some(({ id }) => !uploadedById.has(id))) {
            return {
              expiredHandles: await finishExpiredCleanup(),
              stagedFrames: [],
              expiredInput: false,
              quotaExceeded: false,
              retryRequired: true,
            };
          }

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

            const uploaded = uploadedById.get(prepared.id)!;
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
                mimeType: uploaded.stored.mimeType,
                sizeBytes: uploaded.stored.sizeBytes,
                blobHandle: uploaded.serializedHandle,
                visibility: design.visibility,
                ownerEmail: design.ownerEmail,
                orgId: design.orgId,
                createdAt: new Date().toISOString(),
              })
              .onConflictDoNothing()
              .returning({ id: table.id });
            const [persisted] = await tx
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
              persisted.boardFileId !== importBoardFileId ||
              !matchesStageFrame(
                persisted,
                prepared.frame,
                prepared.marker,
                prepared.capturedAt,
                prepared.data.byteLength,
              )
            ) {
              fail(
                inserted.length
                  ? "The staged frame was stored, but its row could not be verified. Retry the same batch to recover it."
                  : "A staged frame key changed while the batch was being stored. Retry the same batch.",
                {
                  errorCode: inserted.length
                    ? "journey_frame_stage_verification_failed"
                    : "journey_frame_stage_conflict",
                  statusCode: inserted.length ? 503 : 409,
                },
              );
            }
            stagedFrames.push({
              frameKey: prepared.frame.frameKey,
              stagedFrameId: prepared.id,
              sizeBytes: persisted.sizeBytes,
              width: prepared.frame.width,
              height: prepared.frame.height,
            });
          }

          return {
            expiredHandles: await finishExpiredCleanup(),
            stagedFrames,
            expiredInput: false,
            quotaExceeded: false,
            retryRequired: false,
          };
        },
      );
    } catch (error) {
      await cleanupUnreferencedUploads();
      throw error;
    }

    if (!(await cleanupUnreferencedUploads())) {
      fail(
        "The staged screenshots could not be checked for safe cleanup. Retry the same batch to verify it.",
        {
          errorCode: "journey_frame_stage_cleanup_unverified",
          statusCode: 503,
        },
      );
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
    if (outcome.retryRequired) {
      fail(
        "Staged frame state changed while this batch was uploading. Retry the same batch without changing its importId or frame keys.",
        {
          errorCode: "journey_frame_stage_retry_required",
          statusCode: 409,
        },
      );
    }
    return {
      designId: input.designId,
      importId: input.importId,
      stagedFrames: outcome.stagedFrames,
    };
  },
});
