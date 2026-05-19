import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { streamFile } from "@agent-native/core/server";
import { getAnalyticsMediaDir } from "../../../lib/media-dir.js";

export default defineEventHandler(async (event) => {
  let mediaDir: string;
  try {
    mediaDir = getAnalyticsMediaDir();
  } catch {
    setResponseStatus(event, 501);
    return { error: "Media serving not available in this environment" };
  }
  const filename = event.path.replace("/api/media/", "");
  const filepath = path.resolve(mediaDir, filename);
  if (!filepath.startsWith(mediaDir + path.sep)) {
    setResponseStatus(event, 403);
    return { error: "Forbidden" };
  }
  try {
    await stat(filepath);
    const ext = path.extname(filepath).toLowerCase();
    if (ext === ".svg") {
      setResponseHeader(event, "content-type", "image/svg+xml; charset=utf-8");
    } else if (ext === ".png") {
      setResponseHeader(event, "content-type", "image/png");
    }
    return streamFile(createReadStream(filepath));
  } catch {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
});
