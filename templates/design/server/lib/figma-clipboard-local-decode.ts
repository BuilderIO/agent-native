import {
  decodeFigmaClipboardFrames,
  MAX_CLIPBOARD_BUFFER_BYTES,
} from "../../shared/figma-clipboard-decode.js";
import {
  normalizeImportedHtmlDocument,
  type ImportedDesignFile,
} from "./import-design-files.js";

const MAX_TOTAL_HTML_BYTES = 24 * 1024 * 1024;

export interface ClipboardLayerPlacement {
  wrapsLooseNode: boolean;
  origin: { x: number; y: number };
  sourceOffset: { x: number; y: number } | null;
}

export interface ClipboardLocalDecodeResult {
  files: ImportedDesignFile[];
  layers: ClipboardLayerPlacement[];
  warnings: string[];
  unresolvedImageRefs: string[];
  stats: {
    sourceKind: "figma-clipboard-local-kiwi";
    format: "kiwi" | "zip";
    version?: number;
    frameCount: number;
    nodeCount: number;
    unresolvedImageCount: number;
  };
}

export async function importFigmaClipboardFromBuffer(options: {
  bufferBase64: string;
  fileKey: string;
  originalName?: string;
}): Promise<ClipboardLocalDecodeResult> {
  const { bufferBase64, fileKey, originalName = "figma-paste" } = options;
  const bufferBytes = Buffer.from(bufferBase64, "base64");
  if (bufferBytes.length > MAX_CLIPBOARD_BUFFER_BYTES) {
    throw new Error(
      `Figma clipboard buffer is too large for local decode (max 8 MB). Use a Figma access token for direct REST import instead.`,
    );
  }
  const decoded = decodeFigmaClipboardFrames(bufferBytes);
  const layers: ClipboardLayerPlacement[] = decoded.frames.map((frame) => ({
    wrapsLooseNode: frame.wrapsLooseNode,
    origin: { x: frame.x, y: frame.y },
    sourceOffset: frame.sourceOffset,
  }));

  let totalHtmlBytes = 0;
  const files: ImportedDesignFile[] = decoded.frames.map((frame) => {
    const content = normalizeImportedHtmlDocument(
      frame.html,
      `figma clipboard local-kiwi decode ${originalName}`,
    );
    totalHtmlBytes += Buffer.byteLength(content, "utf8");
    if (totalHtmlBytes > MAX_TOTAL_HTML_BYTES) {
      throw new Error(
        "Figma clipboard import generated too much HTML (max 24 MB). Import a smaller selection.",
      );
    }
    return {
      filename: frame.fileName,
      fileType: "html" as const,
      content,
      source: {
        sourceType: "figma-clipboard-local-kiwi",
        figmaFileKey: fileKey,
        figmaNodeName: frame.frameName,
        figFormat: decoded.format,
        ...(decoded.version !== undefined
          ? { figVersion: decoded.version }
          : {}),
        ...(decoded.unresolvedImageRefs.length > 0
          ? { unresolvedImageRefs: decoded.unresolvedImageRefs }
          : {}),
      },
      preferredFrame: {
        title: frame.frameName,
        ...(frame.width !== undefined ? { width: frame.width } : {}),
        ...(frame.height !== undefined ? { height: frame.height } : {}),
      },
    } satisfies ImportedDesignFile;
  });

  return {
    files,
    layers,
    warnings: decoded.warnings,
    unresolvedImageRefs: decoded.unresolvedImageRefs,
    stats: {
      sourceKind: "figma-clipboard-local-kiwi",
      format: decoded.format,
      ...(decoded.version !== undefined ? { version: decoded.version } : {}),
      frameCount: decoded.frames.length,
      nodeCount: decoded.nodeCount,
      unresolvedImageCount: decoded.unresolvedImageRefs.length,
    },
  };
}
