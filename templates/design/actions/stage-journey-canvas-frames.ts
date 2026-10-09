import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { pngDimensions } from "../server/lib/png-dimensions.js";
import {
  discardPrivateBlobs,
  resolveReplayScreenshotStorage,
  storeReplayScreenshotBytesAsPrivateBlob,
} from "../server/lib/replay-screenshot-blobs.js";
import { JOURNEY_STAGED_REPLAY_ROW_PREFIX } from "../shared/journey-canvas.js";

const MAX_STAGE_FRAMES = 8;
const MAX_STAGE_BODY_BYTES = 5 * 1024 * 1024;
const MAX_STAGE_ENCODED_IMAGE_BYTES = 4_800_000;
const MAX_VIEWPORT_DIMENSION = 8_192;
const MAX_IMAGE_PIXELS = 16_000_000;
const STAGE_APP_PREFIX = "journey-canvas-stage:v2:";

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

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export default defineAction({
  description:
    "Stage up to 8 native PNG frames for a Design journey storyboard. Use a stable importId and frameKey (`nodeKey` + NUL + `exampleIndex`) for resumable retries; the action stores only private blob handles and metadata, never PNG bytes in SQL. Each batch stays within 5 MiB, and the returned stagedFrameId is passed to create-journey-canvas for a zero-copy consume.",
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
    const db = getDb();
    const stagedFrames: Array<{
      frameKey: string;
      stagedFrameId: string;
      sizeBytes: number;
      width: number;
      height: number;
    }> = [];

    for (const batch of chunks(input.frames, 4)) {
      const results = await Promise.allSettled(
        batch.map(async (frame) => {
          const data = decodePng(frame);
          const capturedAt = utcTimestamp(frame.capturedAt);
          const id = stageRowId(input.designId, input.importId, frame.frameKey);
          const marker = stageMarker(frame, input.importId, data);
          const [existing] = await db
            .select({
              id: schema.designBoardReplayScreenshots.id,
              app: schema.designBoardReplayScreenshots.app,
              route: schema.designBoardReplayScreenshots.route,
              replayId: schema.designBoardReplayScreenshots.replayId,
              capturedAt: schema.designBoardReplayScreenshots.capturedAt,
              offsetMs: schema.designBoardReplayScreenshots.offsetMs,
              viewportWidth: schema.designBoardReplayScreenshots.viewportWidth,
              viewportHeight:
                schema.designBoardReplayScreenshots.viewportHeight,
              sizeBytes: schema.designBoardReplayScreenshots.sizeBytes,
            })
            .from(schema.designBoardReplayScreenshots)
            .where(
              and(
                eq(schema.designBoardReplayScreenshots.id, id),
                eq(
                  schema.designBoardReplayScreenshots.designId,
                  input.designId,
                ),
              ),
            )
            .limit(1);
          if (existing) {
            if (
              existing.app !== marker ||
              existing.route !== frame.route ||
              existing.replayId !== frame.replayId ||
              existing.capturedAt !== capturedAt ||
              existing.offsetMs !== frame.offsetMs ||
              existing.viewportWidth !== frame.width ||
              existing.viewportHeight !== frame.height ||
              existing.sizeBytes !== data.byteLength
            ) {
              fail(
                "A staged frame key already exists with different screenshot data or provenance. Use a new importId for changed frames.",
                {
                  errorCode: "journey_frame_idempotency_conflict",
                  statusCode: 409,
                },
              );
            }
            return {
              frameKey: frame.frameKey,
              stagedFrameId: id,
              sizeBytes: existing.sizeBytes,
              width: existing.viewportWidth,
              height: existing.viewportHeight,
            };
          }

          const storage = await resolveStorage();
          const stored = await storeReplayScreenshotBytesAsPrivateBlob({
            data,
            blobOwnerEmail: design.ownerEmail,
            providerId:
              storage.kind === "private-provider"
                ? storage.providerId
                : undefined,
            rowId: id,
            designId: input.designId,
            replayId: frame.replayId,
          });
          let insertedRow = false;
          try {
            const inserted = await db
              .insert(schema.designBoardReplayScreenshots)
              .values({
                id,
                designId: input.designId,
                boardFileId: `journey-canvas-stage:${input.importId}`,
                replayId: frame.replayId,
                capturedAt,
                app: marker,
                route: frame.route,
                offsetMs: frame.offsetMs,
                viewportWidth: frame.width,
                viewportHeight: frame.height,
                eventCount: 0,
                mimeType: stored.mimeType,
                sizeBytes: stored.sizeBytes,
                blobHandle: JSON.stringify(stored.blobHandle),
                visibility: design.visibility,
                ownerEmail: design.ownerEmail,
                orgId: design.orgId,
              })
              .onConflictDoNothing()
              .returning({ id: schema.designBoardReplayScreenshots.id });
            insertedRow = inserted.length > 0;
            if (!insertedRow) await discardPrivateBlobs([stored.blobHandle]);
          } catch (error) {
            try {
              const [persistedAfterError] = await db
                .select({
                  blobHandle: schema.designBoardReplayScreenshots.blobHandle,
                })
                .from(schema.designBoardReplayScreenshots)
                .where(
                  and(
                    eq(schema.designBoardReplayScreenshots.id, id),
                    eq(
                      schema.designBoardReplayScreenshots.designId,
                      input.designId,
                    ),
                  ),
                )
                .limit(1);
              if (
                persistedAfterError?.blobHandle !==
                JSON.stringify(stored.blobHandle)
              ) {
                await discardPrivateBlobs([stored.blobHandle]);
              }
            } catch {
              // Keep the handle when the insert outcome cannot be verified.
            }
            throw error;
          }
          const [persisted] = await db
            .select({
              app: schema.designBoardReplayScreenshots.app,
              route: schema.designBoardReplayScreenshots.route,
              replayId: schema.designBoardReplayScreenshots.replayId,
              capturedAt: schema.designBoardReplayScreenshots.capturedAt,
              offsetMs: schema.designBoardReplayScreenshots.offsetMs,
              viewportWidth: schema.designBoardReplayScreenshots.viewportWidth,
              viewportHeight:
                schema.designBoardReplayScreenshots.viewportHeight,
              sizeBytes: schema.designBoardReplayScreenshots.sizeBytes,
            })
            .from(schema.designBoardReplayScreenshots)
            .where(
              and(
                eq(schema.designBoardReplayScreenshots.id, id),
                eq(
                  schema.designBoardReplayScreenshots.designId,
                  input.designId,
                ),
              ),
            )
            .limit(1);
          if (
            !persisted ||
            persisted.app !== marker ||
            persisted.route !== frame.route ||
            persisted.replayId !== frame.replayId ||
            persisted.capturedAt !== capturedAt ||
            persisted.offsetMs !== frame.offsetMs ||
            persisted.viewportWidth !== frame.width ||
            persisted.viewportHeight !== frame.height ||
            persisted.sizeBytes !== data.byteLength
          ) {
            if (insertedRow) {
              fail(
                "The staged frame was stored, but its committed row could not be verified. Retry the same batch to recover it.",
                {
                  errorCode: "journey_frame_stage_verification_failed",
                  statusCode: 503,
                },
              );
            }
            fail(
              "The staged frame could not be committed idempotently. Retry the same batch.",
              {
                errorCode: "journey_frame_stage_conflict",
                statusCode: 409,
              },
            );
          }
          return {
            frameKey: frame.frameKey,
            stagedFrameId: id,
            sizeBytes: stored.sizeBytes,
            width: frame.width,
            height: frame.height,
          };
        }),
      );
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") throw rejected.reason;
      stagedFrames.push(
        ...results.map((result) => {
          if (result.status !== "fulfilled") {
            // guard:allow-bare-error — invariant: the rejection check above must have thrown before mapping.
            throw new Error("A staging batch settled without a result.");
          }
          return result.value;
        }),
      );
    }

    return { designId: input.designId, importId: input.importId, stagedFrames };
  },
});
