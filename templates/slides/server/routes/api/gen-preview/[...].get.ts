import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { defineEventHandler, sendStream, setResponseStatus } from "h3";
const genPreviewDir = path.resolve(process.cwd(), "public/generated");
export default defineEventHandler(async (event) => {
  const filename = event.path.replace("/api/gen-preview/", "");
  const filepath = path.resolve(genPreviewDir, filename);
  if (!filepath.startsWith(genPreviewDir + path.sep)) { setResponseStatus(event, 403); return { error: "Forbidden" }; }
  try { await stat(filepath); return sendStream(event, createReadStream(filepath)); }
  catch { setResponseStatus(event, 404); return { error: "Not found" }; }
});
