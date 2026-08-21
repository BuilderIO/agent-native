import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";

import { streamFile } from "@agent-native/core/server";
import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";

import { resolveSlidesRequestAuth } from "../../../handlers/request-auth-context.js";
import { tenantExportDir } from "../../../lib/tenant-files.js";

const CONTENT_TYPES: Record<string, string> = {
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".html": "text/html",
  ".pdf": "application/pdf",
};

export default defineEventHandler(async (event) => {
  const auth = await resolveSlidesRequestAuth(event);
  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { error: auth.error };
  }
  const session = auth.context;
  if (!session.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const filename = getRouterParam(event, "filename") ?? "";

  // Reject path traversal attempts
  if (
    !filename ||
    filename.includes("/") ||
    filename.includes("..") ||
    !/^[a-zA-Z0-9_.-]+$/.test(filename)
  ) {
    setResponseStatus(event, 400);
    return { error: "Invalid filename" };
  }

  const exportsDir = path.resolve(tenantExportDir(session.email));
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

  event.node!.res!.setHeader("Content-Type", contentType);
  event.node!.res!.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );

  return streamFile(createReadStream(filepath));
});
