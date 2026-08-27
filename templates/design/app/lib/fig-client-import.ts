/**
 * Decode a `.fig` in the browser and save it a frame at a time.
 *
 * The server route exists because the decoder used to be Node-only. It is not
 * any more (`shared/fig-bytes.ts`), and decoding here removes the upload
 * entirely: a Netlify function request is capped at ~6MB while real `.fig`
 * files run to tens of megabytes, which is why the server route has to chunk.
 * Nothing large crosses the network on this path — embedded images go up one
 * at a time through `upload-image`, and each frame's HTML is its own request,
 * so no single request approaches the cap however big the file was.
 *
 * The server route stays for callers that are not a browser (the agent, A2A,
 * the fidelity harness) and as the fallback when decoding here fails.
 */

import { callAction } from "@agent-native/core/client/hooks";

import { decodeFig } from "../../server/lib/fig-file-decoder.js";
import { bytesToBase64 } from "../../shared/fig-bytes.js";
import { convertDecodedFigToEditableHtml } from "../../shared/fig-to-frames.js";
import type { ImportResult } from "./design-import";

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
  const decoded = decodeFig(bytes);

  let uploaded = 0;
  const total = decoded.images.length;
  const converted = await convertDecodedFigToEditableHtml(decoded, {
    originalName: file.name,
    // The upload action resolves the owner from the session; this value is only
    // read by the server-side uploader this path replaces.
    ownerEmail: "",
    // The action wraps the document; nothing to do here.
    normalizeHtml: (content: string) => content,
    uploader: async ({ data, filename, mimeType }) => {
      const url = (await callAction("upload-image", {
        data: `data:${mimeType ?? mimeForExt("")};base64,${bytesToBase64(
          data instanceof Uint8Array
            ? data
            : new Uint8Array(data as ArrayBuffer),
        )}`,
        filename,
      })) as { url?: string };
      uploaded += 1;
      onProgress?.({ phase: "images", ratio: total ? uploaded / total : 1 });
      // A null result is the "storage unavailable" signal the converter already
      // handles: it leaves the placeholder in place and warns about it, rather
      // than persisting a data URL.
      return url?.url ? { url: url.url } : null;
    },
  });

  const saved: ImportResult = { files: [], warnings: [...converted.warnings] };
  let index = 0;
  for (const frame of converted.files) {
    onProgress?.({
      phase: "saving",
      ratio: converted.files.length ? index / converted.files.length : 1,
    });
    const result = (await callAction("import-design-source", {
      designId,
      sourceType: "fig-frame",
      content: frame.content,
      originalName: frame.filename,
      frameTitle: frame.preferredFrame?.title,
      frameWidth: frame.preferredFrame?.width,
      frameHeight: frame.preferredFrame?.height,
    })) as ImportResult;
    saved.designId = result.designId ?? saved.designId;
    saved.files = [...(saved.files ?? []), ...(result.files ?? [])];
    index += 1;
  }
  return {
    ...saved,
    unresolvedImageRefCount: converted.stats.unresolvedImageRefCount,
  };
}
