/**
 * Decode a `.fig` in the browser and save it a frame at a time.
 *
 * The server route exists because the decoder used to be Node-only. It is not
 * any more (`shared/fig-bytes.ts`), and decoding here removes the upload
 * entirely: a Netlify function request is capped at ~6MB while real `.fig`
 * files run to tens of megabytes, which is why the server route has to chunk.
 * Nothing large crosses the network on this path — embedded images go up one
 * at a time through `upload-image`, and each frame's HTML is its own request.
 * The individual image budget below keeps base64 action requests under the
 * serverless transport cap while the `.fig` container itself can exceed the
 * old 50 MB server upload ceiling up to a finite browser safety limit.
 *
 * The server route stays for callers that are not a browser (the agent, A2A,
 * the fidelity harness) and as the fallback when decoding here fails.
 */

import { callAction } from "@agent-native/core/client/hooks";

import { decodeFig } from "../../server/lib/fig-file-decoder.js";
import type { DecodedFig } from "../../server/lib/fig-file-decoder.js";
import { bytesToBase64 } from "../../shared/fig-bytes.js";
import {
  assertEmbeddedImageBudget,
  convertDecodedFigToEditableHtml,
  MAX_FIG_FRAME_HTML_BYTES,
  inspectDecodedFig,
  shouldWarnForFigImport,
  type FigImportSummary,
} from "../../shared/fig-to-frames.js";
import type { ImportResult } from "./design-import";

/** Base64 plus action JSON must stay below the serverless request ceiling. */
export const MAX_CLIENT_IMAGE_BYTES = 4 * 1024 * 1024;
/** Finite browser allocation ceiling; this is far above the old 50 MB upload cap. */
export const MAX_CLIENT_FIG_BYTES = 512 * 1024 * 1024;

export interface FigClientImportProgress {
  phase: "decoding" | "images" | "saving";
  /** 0-1 within the current phase, when it is countable. */
  ratio?: number;
}

export interface FigClientImportOptions {
  designId: string;
  file: File;
  decoded?: DecodedFig;
  selection?: ReadonlySet<string>;
  onProgress?: (progress: FigClientImportProgress) => void;
}

export class FigClientImportError extends Error {
  constructor(
    message: string,
    readonly remoteMutationStarted: boolean,
  ) {
    super(message);
    this.name = "FigClientImportError";
  }
}

export interface PreparedFigImport {
  file: File;
  decoded: DecodedFig;
  summary: FigImportSummary;
}

export { shouldWarnForFigImport };

function mimeForExt(ext: string): string {
  if (ext === "jpg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

function browserImportId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `fig-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

async function callWithOneRetry<T>(
  action: string,
  input: Record<string, unknown>,
): Promise<T> {
  try {
    return (await callAction(action, input)) as T;
  } catch (firstError) {
    try {
      return (await callAction(action, input)) as T;
    } catch {
      throw firstError;
    }
  }
}

/**
 * Decode, upload the embedded images one request each, then save each frame in
 * its own request. Returns the same shape the server route returns so the
 * caller's success and warning handling is unchanged.
 */
export async function importFigInBrowser(
  options: FigClientImportOptions,
): Promise<ImportResult> {
  const { designId, file, onProgress, selection } = options;
  if (file.size > MAX_CLIENT_FIG_BYTES) {
    throw new Error(
      `.fig file is too large for browser import (max ${MAX_CLIENT_FIG_BYTES / 1024 / 1024} MB).`,
    );
  }
  let decoded = options.decoded;
  if (!decoded) {
    onProgress?.({ phase: "decoding" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    // The file never crosses the network on this path. Keep the decoder's
    // decompression, node, image, and generated-HTML budgets, but remove the
    // server-only raw upload ceiling.
    decoded = decodeFig(bytes, { maxFileBytes: MAX_CLIENT_FIG_BYTES });
  }
  assertEmbeddedImageBudget(decoded.images);
  const oversizedImages = decoded.images.filter(
    (image) => image.bytes.byteLength > MAX_CLIENT_IMAGE_BYTES,
  );
  const decodedForBrowserImport =
    oversizedImages.length > 0
      ? {
          ...decoded,
          images: decoded.images.filter(
            (image) => image.bytes.byteLength <= MAX_CLIENT_IMAGE_BYTES,
          ),
        }
      : decoded;
  let remoteMutationStarted = false;
  let uploaded = 0;
  const total = decodedForBrowserImport.images.length;
  const importId = browserImportId();
  let converted;
  try {
    converted = await convertDecodedFigToEditableHtml(decodedForBrowserImport, {
      originalName: file.name,
      // The upload action resolves the owner from the session; this value is only
      // read by the server-side uploader this path replaces.
      ownerEmail: "",
      // The action wraps the document; nothing to do here.
      normalizeHtml: (content: string) => content,
      maxFrameHtmlBytes: MAX_FIG_FRAME_HTML_BYTES,
      selection,
      uploader: async ({ data, filename, mimeType }) => {
        remoteMutationStarted = true;
        const idempotencyKey = `${importId}:${filename}`;
        const uploadInput = {
          data: `data:${mimeType ?? mimeForExt("")};base64,${bytesToBase64(
            data instanceof Uint8Array
              ? data
              : new Uint8Array(data as ArrayBuffer),
          )}`,
          filename,
          idempotencyKey,
        };
        const url = await callWithOneRetry<{ url?: string }>(
          "upload-image",
          uploadInput,
        );
        uploaded += 1;
        onProgress?.({
          phase: "images",
          ratio: total ? uploaded / total : 1,
        });
        // A null result means storage is unavailable; the converter rejects the
        // import rather than persisting frames with missing images.
        if (!url?.url) return null;
        return {
          url: url.url,
          cleanup: async () => {
            const result = await callWithOneRetry<{
              alreadyMissing?: boolean;
              committed?: boolean;
              deleted?: boolean;
            }>("upload-image", { idempotencyKey, cleanup: "delete" });
            return (
              result.deleted === true ||
              result.alreadyMissing === true ||
              result.committed === true
            );
          },
          finalize: async () => {
            const result = await callWithOneRetry<{
              alreadyMissing?: boolean;
              released?: boolean;
            }>("upload-image", { idempotencyKey, cleanup: "release" });
            return result.released === true || result.alreadyMissing === true;
          },
        };
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FigClientImportError(message, remoteMutationStarted);
  }

  const saved: ImportResult = {
    files: [],
    warnings: converted.warnings,
    skippedEmbeddedImageCount: oversizedImages.length || undefined,
  };
  let index = 0;
  const savedFileIds: string[] = [];
  try {
    for (const [frameIndex, frame] of converted.files.entries()) {
      onProgress?.({
        phase: "saving",
        ratio: converted.files.length ? index / converted.files.length : 1,
      });
      // Do not fall back after this point: the action may have committed even
      // if the browser lost its response.
      remoteMutationStarted = true;
      const result = await callWithOneRetry<ImportResult>(
        "import-design-source",
        {
          designId,
          sourceType: "fig-frame",
          content: frame.content,
          originalName: frame.filename,
          frameTitle: frame.preferredFrame?.title,
          frameWidth: frame.preferredFrame?.width,
          frameHeight: frame.preferredFrame?.height,
          clientImportId: `${importId}:frame:${frameIndex}`,
          clientImportBatchId: importId,
          clientImportFinalFrame: frameIndex === converted.files.length - 1,
        },
      );
      if (result.error) throw new Error(result.error);
      saved.designId = result.designId ?? saved.designId;
      saved.files = [...(saved.files ?? []), ...(result.files ?? [])];
      savedFileIds.push(...(result.files ?? []).map((file) => file.id));
      index += 1;
    }
    // Receipt release is best-effort after all frames are saved. A partial
    // release must not roll back valid frames; the server-side receipt sweep
    // expires abandoned staged receipts.
    await converted.finalize?.();
  } catch (error) {
    const cleanup = await Promise.allSettled(
      savedFileIds.map((id) =>
        callAction("delete-file", { id, allowLockedLayers: true }),
      ),
    );
    const cleanupFailures = cleanup.filter(
      (result) => result.status === "rejected",
    ).length;
    const imageCleanupFailures = (await converted.cleanup?.()) ?? 0;
    const message = error instanceof Error ? error.message : String(error);
    const cleanupMessage = [
      cleanupFailures > 0
        ? `Cleanup failed for ${cleanupFailures} partially imported screen${cleanupFailures === 1 ? "" : "s"}.`
        : "",
      imageCleanupFailures > 0
        ? `Storage cleanup failed for ${imageCleanupFailures} uploaded image${imageCleanupFailures === 1 ? "" : "s"}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    throw new FigClientImportError(
      cleanupMessage ? `${message} ${cleanupMessage}` : message,
      remoteMutationStarted,
    );
  }
  return {
    ...saved,
    unresolvedImageRefCount: converted.stats.unresolvedImageRefCount,
  };
}

export async function prepareFigImport(
  file: File,
  onProgress?: (progress: FigClientImportProgress) => void,
): Promise<PreparedFigImport> {
  if (file.size > MAX_CLIENT_FIG_BYTES) {
    throw new Error(
      `.fig file is too large for browser import (max ${MAX_CLIENT_FIG_BYTES / 1024 / 1024} MB).`,
    );
  }
  onProgress?.({ phase: "decoding" });
  const decoded = decodeFig(new Uint8Array(await file.arrayBuffer()), {
    maxFileBytes: MAX_CLIENT_FIG_BYTES,
  });
  assertEmbeddedImageBudget(decoded.images);
  return { file, decoded, summary: inspectDecodedFig(decoded) };
}
