import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { defineEventHandler, setResponseStatus } from "h3";
import { streamFile } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  const filepath = path.join(process.cwd(), "public/generated/preview.html");
  try {
    await stat(filepath);
    return streamFile(createReadStream(filepath));
  } catch {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
});
