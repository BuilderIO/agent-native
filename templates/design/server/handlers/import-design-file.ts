import path from "node:path";

import { getSession } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import {
  defineEventHandler,
  getRequestHeader,
  readMultipartFormData,
  setResponseStatus,
} from "h3";

import { isFigKiwiBuffer, isZipBuffer } from "../lib/figma-import/decode.js";
import { importFigmaBuffer } from "../lib/figma-import/processor.js";
import {
  normalizeImportedHtmlDocument,
  saveImportedDesignFiles,
  type ImportedDesignFile,
} from "../lib/import-design-files.js";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_FIG_BYTES = 50 * 1024 * 1024;
const TOTAL_BODY_LIMIT = MAX_FIG_BYTES + 1024 * 1024;

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

  const contentLength = Number(
    getRequestHeader(event, "content-length") ?? "0",
  );
  if (contentLength > TOTAL_BODY_LIMIT) {
    setResponseStatus(event, 413);
    return { error: "Request body too large" };
  }

  const parts = await readMultipartFormData(event);
  const designId = fieldText(parts, "designId");
  const filePart = parts?.find((part) => part.name === "file" && part.data);
  if (!designId) {
    setResponseStatus(event, 400);
    return { error: "Missing designId" };
  }
  if (!filePart?.data) {
    setResponseStatus(event, 400);
    return { error: "No file uploaded" };
  }

  const originalName = filePart.filename || "import";
  const ext = path.extname(originalName).toLowerCase();
  const data = Buffer.from(filePart.data);

  try {
    await assertAccess("design", designId, "editor");

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

    if (ext !== ".fig") {
      throw new Error("Unsupported file type. Upload .fig, .html, or .htm.");
    }
    if (data.length > MAX_FIG_BYTES) {
      throw new Error("Figma file is too large (max 50 MB).");
    }
    if (!isFigKiwiBuffer(data) && !isZipBuffer(data)) {
      throw new Error(
        "Figma file contents do not match .fig or fig-kiwi format.",
      );
    }

    const imported = await importFigmaBuffer({
      buffer: data,
      filename: originalName,
      sourceKind: "fig-file",
    });
    const files: ImportedDesignFile[] = imported.files.map((file) => ({
      filename: file.filename,
      fileType: "html",
      content: file.content,
      source: { ...file.source, originalName },
      preferredFrame: {
        title:
          typeof file.source?.frameName === "string"
            ? file.source.frameName
            : undefined,
        width: file.width,
        height: file.height,
      },
    }));
    const saved = await saveImportedDesignFiles({
      designId,
      sourceType: "fig-file",
      files,
      warnings: imported.warnings,
    });
    return {
      importKind: "fig",
      ...saved,
      stats: imported.stats,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "File import failed.";
    setResponseStatus(event, statusForError(message));
    return { error: message };
  }
});
