import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { getSession, streamFile } from "@agent-native/core/server";
import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";

import {
  decodeLocalImportedAssetToken,
  isLocalImportAssetFallbackAvailable,
} from "../../../lib/import-asset-storage.js";
import { tenantFileKey } from "../../../lib/tenant-files.js";

export default defineEventHandler(async (event) => {
  if (!isLocalImportAssetFallbackAvailable()) {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }

  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const rawToken = getRouterParam(event, "token") ?? "";
  let token = rawToken;
  try {
    token = decodeURIComponent(rawToken);
  } catch {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
  let descriptor;
  try {
    descriptor = decodeLocalImportedAssetToken(token);
  } catch {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }

  if (descriptor.ownerKey !== tenantFileKey(session.email)) {
    setResponseStatus(event, 403);
    return { error: "Forbidden" };
  }

  const directory = path.resolve(
    process.cwd(),
    "data",
    "import-assets",
    descriptor.ownerKey,
  );
  const filename = `${descriptor.id}-${descriptor.filename}`;
  const filepath = path.resolve(directory, filename);
  if (!filepath.startsWith(directory + path.sep)) {
    setResponseStatus(event, 403);
    return { error: "Forbidden" };
  }

  try {
    await stat(filepath);
  } catch {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }

  event.node?.res?.setHeader("Content-Type", descriptor.mimeType);
  event.node?.res?.setHeader("Cache-Control", "private, max-age=3600");
  return streamFile(createReadStream(filepath));
});
