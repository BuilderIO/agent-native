import { decodeFig, isFigKiwiBuffer, isZipBuffer } from "./decode.js";
import { renderFigmaHtml } from "./render-html.js";
import type {
  FigmaClipboardMeta,
  FigmaImportResult,
  FigmaImportSelection,
} from "./types.js";

const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_GENERATED_HTML_BYTES = 25 * 1024 * 1024;

export interface ImportFigmaBufferInput {
  buffer: Buffer;
  filename: string;
  sourceKind: "figma-paste" | "fig-file";
  selection?: FigmaImportSelection;
  meta?: FigmaClipboardMeta | Record<string, unknown> | null;
}

function metaRecord(
  meta: FigmaClipboardMeta | Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!meta) return {};
  const raw =
    "raw" in meta && meta.raw && typeof meta.raw === "object"
      ? meta.raw
      : undefined;
  return {
    ...(raw as Record<string, unknown> | undefined),
    ...meta,
  };
}

function mimeForExt(ext: string): string {
  if (ext === "jpg") return "image/jpeg";
  return `image/${ext}`;
}

function imageMapFromDecoded(decoded: ReturnType<typeof decodeFig>): {
  imageMap: Map<string, string>;
  warnings: string[];
} {
  let totalBytes = 0;
  const imageMap = new Map<string, string>();
  const warnings: string[] = [];
  for (const image of decoded.images) {
    totalBytes += image.bytes.length;
    if (totalBytes > MAX_INLINE_IMAGE_BYTES) {
      throw new Error(
        "The Figma file contains more than 20 MB of inline image assets. Export fewer frames or remove large raster images and try again.",
      );
    }
    imageMap.set(
      image.hash,
      `data:${mimeForExt(image.ext)};base64,${image.bytes.toString("base64")}`,
    );
  }
  if (decoded.images.length === 0) {
    warnings.push(
      "No raster image blobs were found in the Figma payload. Vector and text layers were imported; image fills may be missing.",
    );
  }
  return { imageMap, warnings };
}

export async function importFigmaBuffer(
  input: ImportFigmaBufferInput,
): Promise<FigmaImportResult> {
  if (!isFigKiwiBuffer(input.buffer) && !isZipBuffer(input.buffer)) {
    throw new Error(
      "The uploaded file is not a supported .fig or fig-kiwi file.",
    );
  }

  const decoded = decodeFig(input.buffer);
  if (!decoded.document) {
    throw new Error(
      "The Figma file decoded, but its document structure could not be read.",
    );
  }

  const { imageMap, warnings } = imageMapFromDecoded(decoded);
  const render = renderFigmaHtml({
    filename: input.filename,
    document: decoded.document,
    imageMap,
    selectionNodeId: input.selection?.nodeId,
    meta: {
      ...metaRecord(input.meta),
      sourceKind: input.sourceKind,
      format: decoded.format,
      version: decoded.version,
    },
  });
  const totalHtmlBytes = render.files.reduce(
    (total, file) => total + Buffer.byteLength(file.content, "utf8"),
    0,
  );
  if (totalHtmlBytes > MAX_GENERATED_HTML_BYTES) {
    throw new Error(
      "The Figma import generated more than 25 MB of HTML. Export fewer frames or simplify large layers and try again.",
    );
  }

  return {
    files: render.files,
    warnings: [...warnings, ...render.warnings],
    stats: {
      sourceKind: input.sourceKind,
      format: decoded.format,
      frameCount: render.files.length,
      imageCount: decoded.images.length,
      selectedNodeId: input.selection?.nodeId,
    },
  };
}
