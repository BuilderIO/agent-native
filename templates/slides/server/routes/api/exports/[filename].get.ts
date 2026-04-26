import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { streamFile } from "@agent-native/core/server";

const exportsDir = path.resolve(process.cwd(), "data/exports");

const CONTENT_TYPES: Record<string, string> = {
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".html": "text/html",
  ".pdf": "application/pdf",
};

export default defineEventHandler(async (event) => {
  const filename = getRouterParam(event, "filename") ?? "";

  // Reject path traversal attempts
  if (!filename || filename.includes("/") || filename.includes("..")) {
    setResponseStatus(event, 400);
    return { error: "Invalid filename" };
  }

  const filepath = path.resolve(exportsDir, filename);

  // Double-check resolved path stays inside exportsDir
  if (!filepath.startsWith(exportsDir + path.sep)) {
    setResponseStatus(event, 403);
    return { error: "Forbidden" };
  }

  try {
    await stat(filepath);
  } catch {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }

  const ext = path.extname(filename).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  event.node.res.setHeader("Content-Type", contentType);
  event.node.res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );

  return streamFile(createReadStream(filepath));
});
