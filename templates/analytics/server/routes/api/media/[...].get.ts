import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { defineEventHandler, sendStream, setResponseStatus } from "h3";

const mediaDir = path.resolve(import.meta.dirname, "../../../../media");

export default defineEventHandler(async (event) => {
  const filename = event.path.replace("/api/media/", "");
  const filepath = path.resolve(mediaDir, filename);
  if (!filepath.startsWith(mediaDir + path.sep)) {
    setResponseStatus(event, 403);
    return { error: "Forbidden" };
  }
  try {
    await stat(filepath);
    return sendStream(event, createReadStream(filepath));
  } catch {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
});
