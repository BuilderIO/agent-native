import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";

import { isActionContractError } from "@agent-native/core";
import { runWithRequestContext, streamFile } from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import exportPptxAction from "../../../../actions/export-pptx.js";
import { resolveSlidesRequestAuth } from "../../../handlers/request-auth-context.js";
import { asPptxDownloadRegeneration } from "../../../lib/deck-export-tracking.js";
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
  const query = getQuery(event);

  if (!filepath.startsWith(exportsDir + path.sep)) {
    setResponseStatus(event, 403);
    return { error: "Forbidden" };
  }

  try {
    await stat(filepath);
  } catch {
    const deckId = typeof query.deckId === "string" ? query.deckId : "";
    if (path.extname(filename).toLowerCase() !== ".pptx" || !deckId) {
      setResponseStatus(event, 404);
      return { error: "Not found" };
    }

    try {
      const actionContext = {
        caller: "http" as const,
        userEmail: session.email,
        orgId: session.orgId,
        slidesPptxDownload: true as const,
        slidesPptxDownloadFilename: filename,
        slidesPptxDownloadPersist: true as const,
      };
      const result = await runWithRequestContext(
        { userEmail: session.email, orgId: session.orgId },
        () =>
          asPptxDownloadRegeneration(
            async () =>
              await exportPptxAction.run(
                {
                  deckId,
                  includeNotes: query.includeNotes !== "false",
                },
                actionContext,
              ),
          ),
      );

      if (!result.buffer) {
        throw new Error("PPTX export did not produce downloadable bytes");
      }

      return new Response(new Uint8Array(result.buffer), {
        headers: {
          "Content-Type": CONTENT_TYPES[".pptx"],
          "Content-Disposition": `attachment; filename="${path.basename(
            result.filename,
          )}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if (isActionContractError(error)) {
        setResponseStatus(event, error.statusCode);
        return { error: error.message, errorCode: error.errorCode };
      }
      const message =
        error instanceof Error ? error.message : "Could not export PPTX.";
      setResponseStatus(
        event,
        message.startsWith("Deck not found") ? 404 : 500,
      );
      return { error: message };
    }
  }

  const ext = path.extname(filename).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  setResponseHeader(event, "Content-Type", contentType);
  setResponseHeader(
    event,
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );

  return streamFile(createReadStream(filepath));
});
