import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { defineEventHandler, setResponseStatus } from "h3";
import { streamFile } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  let mediaDir: string;
  try {
    mediaDir = path.resolve(
      import.meta.dirname ?? process.cwd(),
      import.meta.dirname ? "../../../../media" : "media",
    );
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
    return streamFile(createReadStream(filepath));
  } catch {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
});
