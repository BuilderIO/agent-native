import { getSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  getRequestHeader,
  readMultipartFormData,
  setResponseStatus,
} from "h3";

import {
  MAX_FIG_BYTES,
  parseSlidesFigDesignSystem,
} from "../lib/fig-design-system.js";

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

function requestContentLength(event: Parameters<typeof getRequestHeader>[0]) {
  const raw = getRequestHeader(event, "content-length");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export const importFigmaSystem = defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const contentLength = requestContentLength(event);
  if (
    contentLength !== null &&
    contentLength > MAX_FIG_BYTES + MULTIPART_OVERHEAD_BYTES
  ) {
    setResponseStatus(event, 413);
    return {
      error: `File too large (max ${Math.round(MAX_FIG_BYTES / 1024 / 1024)} MB).`,
    };
  }

  let parts;
  try {
    parts = await readMultipartFormData(event);
  } catch {
    setResponseStatus(event, 413);
    return { error: "Upload too large or malformed." };
  }

  const part = parts?.find(
    (p) => (p.name === "file" || p.name === "fig") && p.data,
  );
  if (!part) {
    setResponseStatus(event, 400);
    return {
      error: "No .fig file uploaded (expected multipart field 'file').",
    };
  }

  try {
    return parseSlidesFigDesignSystem({
      data: part.data,
      filename: part.filename,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid .fig file";
    setResponseStatus(event, message.startsWith("File too large") ? 413 : 422);
    return { error: message };
  }
});
