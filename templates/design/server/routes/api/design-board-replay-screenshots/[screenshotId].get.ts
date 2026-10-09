import {
  isPrivateBlobError,
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import {
  createError,
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseHeader,
} from "h3";

import {
  JOURNEY_STAGED_REPLAY_MAX_AGE_MS,
  JOURNEY_STAGED_REPLAY_ROW_PREFIX,
} from "../../../../shared/journey-canvas.js";
import { getDb, schema } from "../../../db/index.js";
import { isValidReplayScreenshotBlobHandle } from "../../../lib/replay-screenshot-private-blob.js";

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function parsePrivateBlobHandle(value: string): PrivateBlobHandle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw createError({
      statusCode: 404,
      statusMessage: "Screenshot not found",
    });
  }
  if (!isValidReplayScreenshotBlobHandle(parsed)) {
    throw createError({
      statusCode: 404,
      statusMessage: "Screenshot not found",
    });
  }
  return parsed;
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cross-Origin-Resource-Policy", "same-origin");
  setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
  setResponseHeader(event, "Pragma", "no-cache");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");

  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const screenshotId = getRouterParam(event, "screenshotId");
  if (!screenshotId) {
    throw createError({
      statusCode: 404,
      statusMessage: "Screenshot not found",
    });
  }

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      const [screenshot] = await getDb()
        .select({
          id: schema.designBoardReplayScreenshots.id,
          designId: schema.designBoardReplayScreenshots.designId,
          blobHandle: schema.designBoardReplayScreenshots.blobHandle,
          mimeType: schema.designBoardReplayScreenshots.mimeType,
          sizeBytes: schema.designBoardReplayScreenshots.sizeBytes,
          createdAt: schema.designBoardReplayScreenshots.createdAt,
        })
        .from(schema.designBoardReplayScreenshots)
        .where(eq(schema.designBoardReplayScreenshots.id, screenshotId))
        .limit(1);
      if (!screenshot) {
        throw createError({
          statusCode: 404,
          statusMessage: "Screenshot not found",
        });
      }

      const requestedDesignId = getQuery(event).designId;
      if (
        requestedDesignId !== undefined &&
        (typeof requestedDesignId !== "string" ||
          requestedDesignId !== screenshot.designId)
      ) {
        throw createError({
          statusCode: 404,
          statusMessage: "Screenshot not found",
        });
      }

      const staged = screenshot.id.startsWith(JOURNEY_STAGED_REPLAY_ROW_PREFIX);
      try {
        await assertAccess(
          "design",
          screenshot.designId,
          staged ? "editor" : "viewer",
        );
      } catch (error) {
        if (error instanceof ForbiddenError) {
          throw createError({
            statusCode: 403,
            statusMessage: "Forbidden",
          });
        }
        throw error;
      }
      if (staged) {
        const createdAtMs = screenshot.createdAt
          ? Date.parse(screenshot.createdAt)
          : Number.NaN;
        if (
          !Number.isFinite(createdAtMs) ||
          Date.now() - createdAtMs >= JOURNEY_STAGED_REPLAY_MAX_AGE_MS
        ) {
          throw createError({
            statusCode: 404,
            statusMessage: "Screenshot not found",
          });
        }
      }
      if (!IMAGE_MIME_TYPES.has(screenshot.mimeType)) {
        throw createError({
          statusCode: 404,
          statusMessage: "Screenshot not found",
        });
      }

      const handle = parsePrivateBlobHandle(screenshot.blobHandle);
      let blob;
      try {
        blob = await readPrivateBlob(handle);
      } catch (error) {
        if (isPrivateBlobError(error)) {
          if (error.kind === "not_found" || error.kind === "gone") {
            throw createError({
              statusCode: 404,
              statusMessage: "Screenshot not found",
            });
          }
          throw createError({
            statusCode: 503,
            statusMessage: "Screenshot storage is unavailable",
          });
        }
        throw error;
      }

      if (
        blob.data.byteLength !== screenshot.sizeBytes ||
        (blob.mimeType && blob.mimeType !== screenshot.mimeType)
      ) {
        throw createError({
          statusCode: 502,
          statusMessage: "Stored screenshot failed integrity checks",
        });
      }

      setResponseHeader(event, "Content-Type", screenshot.mimeType);
      setResponseHeader(event, "Content-Length", String(blob.data.byteLength));
      setResponseHeader(
        event,
        "Content-Disposition",
        `inline; filename="session-replay-screenshot.${screenshot.mimeType === "image/jpeg" ? "jpg" : screenshot.mimeType.slice(6)}"`,
      );
      return Buffer.from(blob.data);
    },
  );
});
