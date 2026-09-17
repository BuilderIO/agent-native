import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";

import { streamFile } from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  getRequestURL,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { getAnalyticsMediaDir } from "../../../lib/media-dir.js";
import {
  mediaFilenameFromPath,
  readSignedSvgMediaPayload,
} from "../../../lib/signed-media.js";

export default defineEventHandler(async (event) => {
  let mediaDir: string;
  try {
    mediaDir = getAnalyticsMediaDir();
  } catch {
    setResponseStatus(event, 501);
    return { error: "Media serving not available in this environment" };
  }
  const filename = mediaFilenameFromPath(getRequestURL(event).pathname);
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
    if (path.extname(filepath).toLowerCase() === ".svg") {
      const query = getQuery(event);
      const signedSvg = readSignedSvgMediaPayload(
        filename,
        query.svg,
        query.sig,
      );
      if (signedSvg) {
        setResponseHeader(
          event,
          "content-type",
          "image/svg+xml; charset=utf-8",
        );
        setResponseHeader(event, "cache-control", "private, max-age=31536000");
        return signedSvg;
      }
    }
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
});
