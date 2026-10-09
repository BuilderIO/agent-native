import {
  isPrivateBlobError,
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
} from "h3";

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
  setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
  setResponseHeader(event, "Pragma", "no-cache");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "Cross-Origin-Resource-Policy", "same-origin");

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
          designId: schema.designBoardReplayScreenshots.designId,
          blobHandle: schema.designBoardReplayScreenshots.blobHandle,
          mimeType: schema.designBoardReplayScreenshots.mimeType,
          sizeBytes: schema.designBoardReplayScreenshots.sizeBytes,
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

      await assertAccess("design", screenshot.designId, "viewer");
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
