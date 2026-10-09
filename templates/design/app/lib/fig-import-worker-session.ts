import { decodeFig } from "../../server/lib/fig-file-decoder.js";
import type { DecodedFig } from "../../server/lib/fig-file-decoder.js";
import { BROWSER_FIG_LIMITS } from "../../server/lib/fig-file-limits.js";
import {
  assertEmbeddedImageBudget,
  inspectDecodedFig,
  MAX_FIG_FRAME_HTML_BYTES,
  renderFigImport,
  type FigImportSummary,
  type RenderedFigImport,
} from "../../shared/fig-to-frames.js";

export const MAX_CLIENT_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_CLIENT_FIG_BYTES = BROWSER_FIG_LIMITS.fileBytes;

export interface RenderedBrowserFigImport extends RenderedFigImport {
  skippedEmbeddedImageCount: number;
}

export interface FigImportSession {
  prepare(file: File): Promise<FigImportSummary>;
  render(selection?: ReadonlySet<string>): RenderedBrowserFigImport;
}

export function assertBrowserFigSize(file: Pick<File, "size">): void {
  if (file.size > MAX_CLIENT_FIG_BYTES) {
    throw new Error(
      `.fig file is too large for browser import (max ${MAX_CLIENT_FIG_BYTES / 1024 / 1024 / 1024} GB).`,
    );
  }
}

export function createFigImportSession(): FigImportSession {
  let decoded: DecodedFig | null = null;
  return {
    async prepare(file) {
      assertBrowserFigSize(file);
      decoded = decodeFig(new Uint8Array(await file.arrayBuffer()), {
        limits: BROWSER_FIG_LIMITS,
      });
      assertEmbeddedImageBudget(decoded.images, BROWSER_FIG_LIMITS);
      return inspectDecodedFig(decoded, BROWSER_FIG_LIMITS);
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
          {
            maxFrameHtmlBytes: MAX_FIG_FRAME_HTML_BYTES,
            selection,
            limits: BROWSER_FIG_LIMITS,
          },
        ),
        skippedEmbeddedImageCount: decoded.images.length - images.length,
      };
    },
  };
}
