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
 * serverless transport cap while the `.fig` container itself stays uncapped.
 *
 * The server route stays for callers that are not a browser (the agent, A2A,
 * the fidelity harness) and as the fallback when decoding here fails.
 */

import { callAction } from "@agent-native/core/client/hooks";

import { decodeFig } from "../../server/lib/fig-file-decoder.js";
import { bytesToBase64 } from "../../shared/fig-bytes.js";
import {
  assertEmbeddedImageBudget,
  convertDecodedFigToEditableHtml,
} from "../../shared/fig-to-frames.js";
import type { ImportResult } from "./design-import";

/** Base64 plus action JSON must stay below the serverless request ceiling. */
export const MAX_CLIENT_IMAGE_BYTES = 4 * 1024 * 1024;

export interface FigClientImportProgress {
  phase: "decoding" | "images" | "saving";
  /** 0-1 within the current phase, when it is countable. */
  ratio?: number;
}

export interface FigClientImportOptions {
  designId: string;
  file: File;
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

function mimeForExt(ext: string): string {
  if (ext === "jpg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

/**
 * Decode, upload the embedded images one request each, then save each frame in
 * its own request. Returns the same shape the server route returns so the
 * caller's success and warning handling is unchanged.
 */
export async function importFigInBrowser(
  options: FigClientImportOptions,
): Promise<ImportResult> {
  const { designId, file, onProgress } = options;
  onProgress?.({ phase: "decoding" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  // The file never crosses the network on this path. Keep the decoder's
  // decompression, node, image, and generated-HTML budgets, but remove the
  // server-only raw upload ceiling.
  const decoded = decodeFig(bytes, { maxFileBytes: null });
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
  let converted;
  try {
    converted = await convertDecodedFigToEditableHtml(decodedForBrowserImport, {
      originalName: file.name,
      // The upload action resolves the owner from the session; this value is only
      // read by the server-side uploader this path replaces.
      ownerEmail: "",
      // The action wraps the document; nothing to do here.
      normalizeHtml: (content: string) => content,
      uploader: async ({ data, filename, mimeType }) => {
        remoteMutationStarted = true;
        const url = (await callAction("upload-image", {
          data: `data:${mimeType ?? mimeForExt("")};base64,${bytesToBase64(
            data instanceof Uint8Array
              ? data
              : new Uint8Array(data as ArrayBuffer),
          )}`,
          filename,
        })) as { url?: string };
        uploaded += 1;
        onProgress?.({
          phase: "images",
          ratio: total ? uploaded / total : 1,
        });
        // A null result means storage is unavailable; the converter rejects the
        // import rather than persisting frames with missing images.
        return url?.url ? { url: url.url } : null;
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
    for (const frame of converted.files) {
      onProgress?.({
        phase: "saving",
        ratio: converted.files.length ? index / converted.files.length : 1,
      });
      // Do not fall back after this point: the action may have committed even
      // if the browser lost its response.
      remoteMutationStarted = true;
      const result = (await callAction("import-design-source", {
        designId,
        sourceType: "fig-frame",
        content: frame.content,
        originalName: frame.filename,
        frameTitle: frame.preferredFrame?.title,
        frameWidth: frame.preferredFrame?.width,
        frameHeight: frame.preferredFrame?.height,
      })) as ImportResult;
      if (result.error) throw new Error(result.error);
      saved.designId = result.designId ?? saved.designId;
      saved.files = [...(saved.files ?? []), ...(result.files ?? [])];
      savedFileIds.push(...(result.files ?? []).map((file) => file.id));
      index += 1;
    }
  } catch (error) {
    const cleanup = await Promise.allSettled(
      savedFileIds.map((id) =>
        callAction("delete-file", { id, allowLockedLayers: true }),
      ),
    );
    const cleanupFailures = cleanup.filter(
      (result) => result.status === "rejected",
    ).length;
    const message = error instanceof Error ? error.message : String(error);
    throw new FigClientImportError(
      cleanupFailures > 0
        ? `${message} Cleanup failed for ${cleanupFailures} partially imported screen${cleanupFailures === 1 ? "" : "s"}.`
        : message,
      remoteMutationStarted,
    );
  }
  return {
    ...saved,
    unresolvedImageRefCount: converted.stats.unresolvedImageRefCount,
  };
}
