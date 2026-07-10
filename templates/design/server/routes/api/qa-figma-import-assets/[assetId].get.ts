import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { getSession, streamFile } from "@agent-native/core/server";
import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";

import {
  isLocalFigmaQaUploadEnabled,
  localFigmaQaAssetMimeType,
  localFigmaQaAssetPath,
} from "../../../lib/local-figma-qa-upload.js";

export default defineEventHandler(async (event) => {
  if (!isLocalFigmaQaUploadEnabled()) {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const assetId = getRouterParam(event, "assetId") ?? "";
  const filepath = localFigmaQaAssetPath(session.email, assetId);
  const mimeType = localFigmaQaAssetMimeType(assetId);
  if (!filepath || !mimeType) {
    setResponseStatus(event, 400);
    return { error: "Invalid asset id" };
  }
  try {
    const info = await stat(filepath);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }

  event.node!.res!.setHeader("Content-Type", mimeType);
  event.node!.res!.setHeader(
    "Cache-Control",
    "private, max-age=31536000, immutable",
  );
  event.node!.res!.setHeader("X-Content-Type-Options", "nosniff");
  return streamFile(createReadStream(filepath));
});
