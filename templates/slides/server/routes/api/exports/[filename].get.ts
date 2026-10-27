import { createReadStream } from "fs";
import { readFile, stat } from "fs/promises";
import path from "path";

import { isActionContractError } from "@agent-native/core";
import { runWithRequestContext, streamFile } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
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
import {
  HOSTED_PPTX_EXPORT_TTL_MS,
  PPTX_DECK_BINDING_FILE_SUFFIX,
  deckBindingFromPptxFilename,
  isHostedSlidesRuntime,
  pptxDeckBindingKey,
  pptxDeckBindingPath,
  tenantExportDir,
} from "../../../lib/tenant-files.js";

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
    filename.endsWith(PPTX_DECK_BINDING_FILE_SUFFIX) ||
    !/^[a-zA-Z0-9_.-]+$/.test(filename)
  ) {
    setResponseStatus(event, 400);
    return { error: "Invalid filename" };
  }

  const exportsDir = path.resolve(tenantExportDir(session.email));
  const filepath = path.resolve(exportsDir, filename);
  const query = getQuery(event);
  const ext = path.extname(filename).toLowerCase();
  const deckId = typeof query.deckId === "string" ? query.deckId : "";
  const exportRevision =
    typeof query.exportRevision === "string" ? query.exportRevision : "";
  const pptxDeckBinding =
    ext === ".pptx" ? deckBindingFromPptxFilename(filename) : null;

  if (ext === ".pptx") {
    if (!deckId || !pptxDeckBinding) {
      setResponseStatus(event, 404);
      return { error: "Not found" };
    }
    if (pptxDeckBinding !== pptxDeckBindingKey(deckId)) {
      setResponseStatus(event, 404);
      return { error: "Not found" };
    }
    if (!/^[a-f0-9]{64}$/i.test(exportRevision)) {
      setResponseStatus(event, 409);
      return { error: "Export revision is missing. Export the deck again." };
    }
  }

  if (!filepath.startsWith(exportsDir + path.sep)) {
    setResponseStatus(event, 403);
    return { error: "Forbidden" };
  }

  const regeneratePptx = async (persistFilename: string) => {
    try {
      const actionContext = {
        caller: "http" as const,
        userEmail: session.email,
        orgId: session.orgId,
        slidesPptxDownload: true as const,
        slidesPptxDownloadFilename: persistFilename,
        slidesPptxDownloadPersist: true as const,
        slidesPptxDownloadExpectedRevision: exportRevision,
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
      if (result.filename !== persistFilename) {
        throw new Error("PPTX export did not repair the requested cache file");
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
  };

  let cachedFile: Awaited<ReturnType<typeof stat>> | undefined;
  try {
    cachedFile = await stat(filepath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      setResponseStatus(event, 500);
      return { error: "Could not read cached export." };
    }
  }

  if (!cachedFile) {
    if (ext !== ".pptx") {
      setResponseStatus(event, 404);
      return { error: "Not found" };
    }
    return regeneratePptx(filename);
  }

  if (ext === ".pptx") {
    if (isHostedSlidesRuntime()) {
      const modifiedAt = Number(cachedFile.mtimeMs);
      if (!Number.isFinite(modifiedAt)) {
        setResponseStatus(event, 500);
        return { error: "Could not verify cached export expiry." };
      }
      if (Date.now() - modifiedAt > HOSTED_PPTX_EXPORT_TTL_MS) {
        return regeneratePptx(filename);
      }
    }

    let cachedExportRevision: string;
    try {
      cachedExportRevision = await readFile(
        pptxDeckBindingPath(exportsDir, filename),
        "utf8",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return regeneratePptx(filename);
      }
      setResponseStatus(event, 500);
      return { error: "Could not verify cached export binding." };
    }
    if (cachedExportRevision !== exportRevision) {
      return regeneratePptx(filename);
    }

    try {
      const access = await runWithRequestContext(
        { userEmail: session.email, orgId: session.orgId },
        () => resolveAccess("deck", deckId),
      );
      if (!access) {
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }
    } catch {
      setResponseStatus(event, 500);
      return { error: "Could not verify deck access." };
    }
  }

  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  setResponseHeader(event, "Content-Type", contentType);
  setResponseHeader(
    event,
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );

  return streamFile(createReadStream(filepath));
});
