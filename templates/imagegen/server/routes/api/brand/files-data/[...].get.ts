import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { defineEventHandler, sendStream, setResponseStatus } from "h3";

const brandDir = path.resolve(process.cwd(), "data", "brand");

export default defineEventHandler(async (event) => {
  const filename = event.path.replace("/api/brand/files/", "");
  const filepath = path.resolve(brandDir, filename);
  if (!filepath.startsWith(brandDir + path.sep)) {
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
