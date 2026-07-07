import path from "node:path";

import { getSession } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import {
  defineEventHandler,
  getQuery,
  getRequestHeader,
  readMultipartFormData,
  setResponseStatus,
} from "h3";

import {
  normalizeImportedHtmlDocument,
  saveImportedDesignFiles,
} from "../lib/import-design-files.js";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const TOTAL_BODY_LIMIT = MAX_HTML_BYTES + 1024 * 1024;

function fieldText(
  parts: Awaited<ReturnType<typeof readMultipartFormData>>,
  name: string,
) {
  const part = parts?.find((candidate) => candidate.name === name);
  return part?.data
    ? Buffer.from(part.data).toString("utf8").trim()
    : undefined;
}

function statusForError(message: string): number {
  if (/unauthorized/i.test(message)) return 401;
  if (/access|permission|not allowed/i.test(message)) return 403;
  if (/too large|max/i.test(message)) return 413;
  return 400;
}

export const importDesignFile = defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const rawContentLength = getRequestHeader(event, "content-length");
  const contentLength = Number(rawContentLength);
  if (!rawContentLength || !Number.isFinite(contentLength)) {
    setResponseStatus(event, 411);
    return { error: "Content-Length header is required" };
  }
  if (contentLength > TOTAL_BODY_LIMIT) {
    setResponseStatus(event, 413);
    return { error: "Request body too large" };
  }

  try {
    const query = getQuery(event);
    const queryDesignId =
      typeof query.designId === "string" ? query.designId.trim() : undefined;
    let accessChecked = false;
    if (queryDesignId) {
      await assertAccess("design", queryDesignId, "editor");
      accessChecked = true;
    }

    const parts = await readMultipartFormData(event);
    const bodyDesignId = fieldText(parts, "designId");
    if (queryDesignId && bodyDesignId && bodyDesignId !== queryDesignId) {
      setResponseStatus(event, 400);
      return { error: "Mismatched designId" };
    }
    const designId = queryDesignId ?? bodyDesignId;
    const filePart = parts?.find((part) => part.name === "file" && part.data);
    if (!designId) {
      setResponseStatus(event, 400);
      return { error: "Missing designId" };
    }
    if (!accessChecked) {
      await assertAccess("design", designId, "editor");
    }
    if (!filePart?.data) {
      setResponseStatus(event, 400);
      return { error: "No file uploaded" };
    }

    const originalName = filePart.filename || "import";
    const ext = path.extname(originalName).toLowerCase();
    const data = Buffer.from(filePart.data);

    if (ext === ".html" || ext === ".htm") {
      if (data.length > MAX_HTML_BYTES) {
        throw new Error("HTML file is too large (max 2 MB).");
      }
      const saved = await saveImportedDesignFiles({
        designId,
        sourceType: "html-upload",
        files: [
          {
            filename: originalName,
            fileType: "html",
            content: normalizeImportedHtmlDocument(
              data.toString("utf8"),
              "uploaded HTML file",
            ),
            source: { sourceType: "html-upload", originalName },
          },
        ],
      });
      return {
        importKind: "html",
        ...saved,
        stats: { sourceKind: "html-upload", frameCount: saved.files.length },
      };
    }

    if (ext === ".fig") {
      throw new Error(
        "Use Design system setup to send .fig files through Builder indexing. This import route only accepts HTML.",
      );
    }

    throw new Error("Unsupported file type. Upload .html or .htm.");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "File import failed.";
    setResponseStatus(event, statusForError(message));
    return { error: message };
  }
});
