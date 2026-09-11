import path from "node:path";

import {
  deleteAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import {
  deletePrivateBlob,
  putPrivateBlob,
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import {
  defineEventHandler,
  getQuery,
  getRequestHeader,
  readMultipartFormData,
  readRawBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import { MAX_FIG_FILE_BYTES } from "../lib/fig-file-limits.js";
import {
  normalizeImportedHtmlDocument,
  saveImportedDesignFiles,
} from "../lib/import-design-files.js";
import {
  MAX_UPLOAD_BYTES,
  TOTAL_BODY_LIMIT,
} from "../lib/request-body-limits.js";

const MAX_HTML_BYTES = 2 * 1024 * 1024;

// Matches the local-kiwi clipboard frame cap so a token-free .fig hydration of
// a multi-frame paste can fill every imported screen in one upload.
const MAX_HYDRATE_FILES = 50;

export const MAX_FIG_CHUNK_BYTES = 3 * 1024 * 1024;
const MAX_FIG_CHUNKS = 64;
const FIG_UPLOAD_SESSION_TTL_MS = 60 * 60 * 1000;
const FIG_UPLOAD_SESSION_PREFIX = "design-fig-upload-";

export const MAX_FIG_UPLOAD_MB = Math.round(MAX_FIG_FILE_BYTES / 1024 / 1024);

interface FigUploadSession {
  designId: string;
  filename: string;
  declaredSize: number;
  ownerEmail: string;
  hydrateFileIds: string;
  chunks: Record<string, PrivateBlobHandle>;
  chunkSizes: Record<string, number>;
  expiresAt: string;
}

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

function queryText(query: Record<string, unknown>, name: string) {
  const value = query[name];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Runs the `.fig` side of an import once the whole file is in memory, whether
 * it arrived as one multipart body or was reassembled from chunks. Both
 * transports must produce identical results, so neither owns this logic.
 */
async function importFigBuffer({
  data,
  designId,
  hydrateFileIdsRaw,
  originalName,
  ownerEmail,
}: {
  data: Buffer;
  designId: string;
  hydrateFileIdsRaw: string | undefined;
  originalName: string;
  ownerEmail: string;
}) {
  if (data.length > MAX_FIG_FILE_BYTES) {
    throw new Error(
      `.fig file is too large (max ${MAX_FIG_UPLOAD_MB} MB). In Figma, copy just the frame you want into a new file and export that as .fig.`,
    );
  }

  // Token-free hydration: fill the image placeholders left by a no-token
  // clipboard paste using the SAME .fig's embedded image bytes. No Figma
  // token, no REST call — the .fig `images/` entries are keyed by the
  // same SHA-1 hash the paste stamped into data-figma-image-ref.
  if (hydrateFileIdsRaw) {
    const fileIds = hydrateFileIdsRaw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (fileIds.length === 0) {
      throw new Error("No screen ids provided to hydrate.");
    }
    if (fileIds.length > MAX_HYDRATE_FILES) {
      throw new Error(
        `Too many screens to hydrate at once (max ${MAX_HYDRATE_FILES}).`,
      );
    }
    const { hydrateFileImagesFromFig, indexFigImages } =
      await import("../lib/figma-image-hydration.js");
    // Decode + index the uploaded .fig once, then reuse across screens.
    const figImages = indexFigImages(data);
    const results = [];
    let totalResolved = 0;
    let totalMissing = 0;
    for (const fileId of fileIds) {
      const result = await hydrateFileImagesFromFig({
        fileId,
        figImages,
        ownerEmail,
      });
      results.push(result);
      totalResolved += result.resolved;
      totalMissing += result.missing;
    }
    return {
      importKind: "fig-hydrate" as const,
      designId,
      results,
      totalResolved,
      totalMissing,
    };
  }

  // Keep Kiwi/Zstd and the sizeable editable renderer off the normal HTML
  // upload path. They are loaded only for an actual `.fig` request.
  const { importFigFileToEditableHtml } =
    await import("../lib/fig-file-import.js");
  const converted = await importFigFileToEditableHtml({
    data,
    originalName,
    ownerEmail,
  });
  const saved = await saveImportedDesignFiles({
    designId,
    sourceType: "fig-upload",
    files: converted.files,
    warnings: converted.warnings,
  });
  return {
    importKind: "fig",
    ...saved,
    stats: converted.stats,
    unresolvedImageRefCount: converted.stats.unresolvedImageRefCount,
  };
}

const sessionKey = (uploadId: string) =>
  `${FIG_UPLOAD_SESSION_PREFIX}${uploadId}`;

async function readFigUploadSession(
  uploadId: string,
): Promise<FigUploadSession | null> {
  const raw = await readAppState(sessionKey(uploadId));
  if (!raw || typeof raw !== "object") return null;
  return raw as unknown as FigUploadSession;
}

async function discardFigUploadSession(
  uploadId: string,
  session: FigUploadSession,
): Promise<void> {
  const results = await Promise.all(
    Object.values(session.chunks).map((handle) =>
      deletePrivateBlob(handle).catch((error) => ({
        deleted: false,
        reason: error instanceof Error ? error.message : String(error),
      })),
    ),
  );
  const orphaned = results.filter((result) => !result.deleted).length;
  if (orphaned > 0) {
    // Leaving parked chunks behind must not fail the import, but it must not
    // be invisible either — these are real bytes nobody will clean up later.
    console.warn("[design-fig-upload] chunk cleanup incomplete", {
      uploadId,
      orphaned,
    });
  }
  await deleteAppState(sessionKey(uploadId));
}

/**
 * Chunked `.fig` transport. Netlify base64-encodes a function body into a 6 MB
 * payload, so a real Figma export (routinely 10-50 MB) can never arrive as one
 * multipart request — the platform 413s with an empty body before any handler
 * runs. Each chunk is parked in private blob storage and the final request
 * reassembles them, so the file bytes never exceed the wire cap in one hop.
 *
 * The upload id is client-generated; the session records the owner so a guessed
 * id cannot append to, read, or complete somebody else's upload.
 */
async function handleFigUploadChunk(
  event: H3Event,
  query: Record<string, unknown>,
  ownerEmail: string,
) {
  const uploadId = queryText(query, "uploadId");
  const index = Number(queryText(query, "index") || "-1");
  const isFinal = queryText(query, "isFinal") === "1";

  if (!/^[A-Za-z0-9_-]{8,64}$/.test(uploadId)) {
    setResponseStatus(event, 400);
    return { error: "Invalid uploadId" };
  }
  if (!Number.isInteger(index) || index < 0 || index >= MAX_FIG_CHUNKS) {
    setResponseStatus(event, 400);
    return { error: "Invalid chunk index" };
  }

  const rawContentLength = getRequestHeader(event, "content-length");
  const contentLength = Number(rawContentLength);
  if (!rawContentLength || !Number.isInteger(contentLength)) {
    setResponseStatus(event, 411);
    return { error: "Content-Length header is required" };
  }
  if (contentLength <= 0) {
    setResponseStatus(event, 400);
    return { error: "Empty chunk body" };
  }
  if (contentLength > MAX_FIG_CHUNK_BYTES) {
    setResponseStatus(event, 413);
    return { error: "Chunk too large" };
  }

  let session = await readFigUploadSession(uploadId);
  if (session && Date.parse(session.expiresAt) <= Date.now()) {
    await discardFigUploadSession(uploadId, session);
    session = null;
  }

  if (index === 0 && !session) {
    const declaredSize = Number(queryText(query, "declaredSize"));
    const filename = queryText(query, "filename") || "import.fig";
    if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0) {
      setResponseStatus(event, 400);
      return { error: "declaredSize must be a positive integer" };
    }
    if (declaredSize > MAX_FIG_FILE_BYTES) {
      setResponseStatus(event, 413);
      return {
        error: `.fig file is too large (max ${MAX_FIG_UPLOAD_MB} MB). In Figma, copy just the frame you want into a new file and export that as .fig.`,
      };
    }
    session = {
      designId: queryText(query, "designId"),
      filename,
      declaredSize,
      ownerEmail,
      hydrateFileIds: queryText(query, "hydrateFileIds"),
      chunks: {},
      chunkSizes: {},
      expiresAt: new Date(Date.now() + FIG_UPLOAD_SESSION_TTL_MS).toISOString(),
    };
  }

  if (!session) {
    setResponseStatus(event, 404);
    return { error: "Upload session not found or expired. Start over." };
  }
  if (session.ownerEmail !== ownerEmail) {
    setResponseStatus(event, 403);
    return { error: "This upload belongs to a different account." };
  }

  const raw = await readRawBody(event, false);
  const bytes = raw ? Buffer.from(raw) : Buffer.alloc(0);
  if (bytes.byteLength !== contentLength) {
    setResponseStatus(event, 400);
    return { error: "Chunk size does not match Content-Length" };
  }

  const chunkKey = String(index);
  const receivedBefore = Object.entries(session.chunkSizes).reduce(
    (total, [key, size]) => (key === chunkKey ? total : total + size),
    0,
  );
  if (receivedBefore + bytes.byteLength > session.declaredSize) {
    await discardFigUploadSession(uploadId, session);
    setResponseStatus(event, 413);
    return { error: "Uploaded bytes exceed the declared file size" };
  }

  const previous = session.chunks[chunkKey];
  if (previous) await deletePrivateBlob(previous).catch(() => undefined);

  const handle = await putPrivateBlob({
    data: bytes,
    filename: `${uploadId}-${index}.figpart`,
    mimeType: "application/octet-stream",
    ownerEmail,
  });
  if (!handle) {
    await discardFigUploadSession(uploadId, session);
    setResponseStatus(event, 503);
    // The client falls back to the single-request multipart upload on this
    // flag: without blob storage there is nowhere to park chunks, and a
    // silent empty success here would look like a completed import.
    return {
      error:
        "Chunked upload needs configured file storage. Configure blob storage to import .fig files larger than the request body limit.",
      storageUnavailable: true,
    };
  }
  session.chunks[chunkKey] = handle;
  session.chunkSizes[chunkKey] = bytes.byteLength;
  await writeAppState(
    sessionKey(uploadId),
    session as unknown as Record<string, unknown>,
  );

  if (!isFinal) {
    return { uploadId, received: receivedBefore + bytes.byteLength };
  }

  const indices = Object.keys(session.chunks)
    .map(Number)
    .sort((a, b) => a - b);
  const received = Object.values(session.chunkSizes).reduce(
    (total, size) => total + size,
    0,
  );
  if (
    indices.length === 0 ||
    indices.some((value, i) => value !== i) ||
    received !== session.declaredSize
  ) {
    await discardFigUploadSession(uploadId, session);
    setResponseStatus(event, 400);
    return { error: "Upload is incomplete or has an invalid size" };
  }

  try {
    const parts: Buffer[] = [];
    for (const chunkIndex of indices) {
      const read = await readPrivateBlob(session.chunks[String(chunkIndex)]!);
      parts.push(Buffer.from(read.data));
    }
    const data = Buffer.concat(parts);
    if (data.byteLength !== session.declaredSize) {
      throw new Error("Reassembled upload size does not match declaredSize");
    }
    const result = await importFigBuffer({
      data,
      designId: session.designId,
      hydrateFileIdsRaw: session.hydrateFileIds || undefined,
      originalName: session.filename,
      ownerEmail,
    });
    await discardFigUploadSession(uploadId, session);
    return result;
  } catch (error) {
    await discardFigUploadSession(uploadId, session);
    const message =
      error instanceof Error ? error.message : "File import failed.";
    setResponseStatus(event, statusForError(message));
    return { error: message };
  }
}

export const importDesignFile = defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }
  const ownerEmail = session.email;

  return runWithRequestContext(
    { userEmail: ownerEmail, orgId: session.orgId },
    async () => {
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

      const query = getQuery(event);
      const queryDesignId = queryText(query, "designId") || undefined;
      if (queryDesignId) await assertAccess("design", queryDesignId, "editor");

      if (queryText(query, "uploadId")) {
        if (!queryDesignId) {
          setResponseStatus(event, 400);
          return { error: "Missing designId" };
        }
        return handleFigUploadChunk(event, query, ownerEmail);
      }

      try {
        const parts = await readMultipartFormData(event);
        const bodyDesignId = fieldText(parts, "designId");
        if (queryDesignId && bodyDesignId && bodyDesignId !== queryDesignId) {
          setResponseStatus(event, 400);
          return { error: "Mismatched designId" };
        }
        const designId = queryDesignId ?? bodyDesignId;
        const filePart = parts?.find(
          (part) => part.name === "file" && part.data,
        );
        if (!designId) {
          setResponseStatus(event, 400);
          return { error: "Missing designId" };
        }
        if (!queryDesignId) {
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
            stats: {
              sourceKind: "html-upload",
              frameCount: saved.files.length,
            },
          };
        }

        if (ext === ".fig") {
          // A single multipart body still cannot exceed the wire cap; larger
          // files must arrive through the chunked transport above.
          if (data.length > MAX_UPLOAD_BYTES) {
            throw new Error(
              `.fig upload exceeded the single-request limit. Retry the import so it uploads in chunks.`,
            );
          }
          return importFigBuffer({
            data,
            designId,
            hydrateFileIdsRaw: fieldText(parts, "hydrateFileIds"),
            originalName,
            ownerEmail,
          });
        }

        throw new Error("Unsupported file type. Upload .html, .htm, or .fig.");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "File import failed.";
        setResponseStatus(event, statusForError(message));
        return { error: message };
      }
    },
  );
});
