/**
 * The CPU-heavy half of a browser `.fig` import: decode, inspect, render.
 *
 * It runs inside `fig-import-worker.ts`, or inline where there is no Worker.
 * The decoded document stays here either way: structured-cloning it across a
 * Worker boundary costs about a second in each direction, so only the summary
 * and the rendered frames ever leave.
 */

import { decodeFig } from "../../server/lib/fig-file-decoder.js";
import type { DecodedFig } from "../../server/lib/fig-file-decoder.js";
import {
  assertEmbeddedImageBudget,
  inspectDecodedFig,
  MAX_FIG_FRAME_HTML_BYTES,
  renderFigImport,
  type FigImportSummary,
  type RenderedFigImport,
} from "../../shared/fig-to-frames.js";

/** Base64 plus action JSON must stay below the serverless request ceiling. */
export const MAX_CLIENT_IMAGE_BYTES = 4 * 1024 * 1024;
/** Finite browser allocation ceiling; this is far above the old 50 MB upload cap. */
export const MAX_CLIENT_FIG_BYTES = 512 * 1024 * 1024;

export interface RenderedBrowserFigImport extends RenderedFigImport {
  /** Embedded images too large for one `upload-image` request. */
  skippedEmbeddedImageCount: number;
}

export interface FigImportSession {
  prepare(file: File): Promise<FigImportSummary>;
  render(selection?: ReadonlySet<string>): RenderedBrowserFigImport;
}

export function assertBrowserFigSize(file: Pick<File, "size">): void {
  if (file.size > MAX_CLIENT_FIG_BYTES) {
    throw new Error(
      `.fig file is too large for browser import (max ${MAX_CLIENT_FIG_BYTES / 1024 / 1024} MB).`,
    );
  }
}

export function createFigImportSession(): FigImportSession {
  let decoded: DecodedFig | null = null;
  return {
    async prepare(file) {
      assertBrowserFigSize(file);
      // The file never crosses the network on this path. Keep the decoder's
      // decompression, node, image, and generated-HTML budgets, but remove the
      // server-only raw upload ceiling.
      decoded = decodeFig(new Uint8Array(await file.arrayBuffer()), {
        maxFileBytes: MAX_CLIENT_FIG_BYTES,
      });
      assertEmbeddedImageBudget(decoded.images);
      return inspectDecodedFig(decoded);
    },
    render(selection) {
      if (!decoded) throw new Error("The .fig file has not been decoded yet.");
      const images = decoded.images.filter(
        (image) => image.bytes.byteLength <= MAX_CLIENT_IMAGE_BYTES,
      );
      return {
        ...renderFigImport(
          images.length === decoded.images.length
            ? decoded
            : { ...decoded, images },
          { maxFrameHtmlBytes: MAX_FIG_FRAME_HTML_BYTES, selection },
        ),
        skippedEmbeddedImageCount: decoded.images.length - images.length,
      };
    },
  };
}
