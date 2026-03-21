import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { defineEventHandler, sendStream, setResponseStatus } from "h3";
const generatedDir = path.resolve(process.cwd(), "public/assets/generated");
export default defineEventHandler(async (event) => {
  const filename = event.path.replace("/api/generated/", "");
  const filepath = path.resolve(generatedDir, filename);
  if (!filepath.startsWith(generatedDir + path.sep)) { setResponseStatus(event, 403); return { error: "Forbidden" }; }
  try { await stat(filepath); return sendStream(event, createReadStream(filepath)); }
  catch { setResponseStatus(event, 404); return { error: "Not found" }; }
});
