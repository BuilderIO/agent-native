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
const DEFAULT_RESPONSE_HEADERS = {
  "Cache-Control": "private, max-age=0, no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
};

function screenshotError(statusCode: number, statusMessage: string) {
  return createError({
    statusCode,
    statusMessage,
    headers: DEFAULT_RESPONSE_HEADERS,
  });
}

function parsePrivateBlobHandle(value: string): PrivateBlobHandle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw screenshotError(404, "Screenshot not found");
  }
  if (!isValidReplayScreenshotBlobHandle(parsed)) {
    throw screenshotError(404, "Screenshot not found");
  }
  return parsed;
}

export default defineEventHandler(async (event) => {
  for (const [name, value] of Object.entries(DEFAULT_RESPONSE_HEADERS)) {
    setResponseHeader(event, name, value);
    // H3 builds thrown-error responses from errHeaders, not regular headers.
    event.res.errHeaders.set(name, value);
  }

  const session = await getSession(event);
  if (!session?.email) {
    throw screenshotError(401, "Unauthorized");
  }

  const screenshotId = getRouterParam(event, "screenshotId");
  if (!screenshotId) {
    throw screenshotError(404, "Screenshot not found");
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
        throw screenshotError(404, "Screenshot not found");
      }

      const requestedDesignId = getQuery(event).designId;
      if (
        requestedDesignId !== undefined &&
        (typeof requestedDesignId !== "string" ||
          requestedDesignId !== screenshot.designId)
      ) {
        throw screenshotError(404, "Screenshot not found");
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
          throw screenshotError(403, "Forbidden");
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
          throw screenshotError(404, "Screenshot not found");
        }
      }
      if (!IMAGE_MIME_TYPES.has(screenshot.mimeType)) {
        throw screenshotError(404, "Screenshot not found");
      }

      const handle = parsePrivateBlobHandle(screenshot.blobHandle);
      let blob;
      try {
        blob = await readPrivateBlob(handle);
      } catch (error) {
        if (isPrivateBlobError(error)) {
          if (error.kind === "not_found" || error.kind === "gone") {
            throw screenshotError(404, "Screenshot not found");
          }
          throw screenshotError(503, "Screenshot storage is unavailable");
        }
        throw error;
      }

      if (
        blob.data.byteLength !== screenshot.sizeBytes ||
        (blob.mimeType && blob.mimeType !== screenshot.mimeType)
      ) {
        throw screenshotError(502, "Stored screenshot failed integrity checks");
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
