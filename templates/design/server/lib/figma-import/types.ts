export type ImportedDesignFileType = "html" | "css" | "jsx" | "asset";

export interface FigmaClipboardMeta {
  fileKey?: string;
  pasteID?: number | string;
  dataType?: string;
  environment?: string;
  selectedNodeData?: string;
  selectedNodeId?: string;
  raw?: Record<string, unknown>;
}

export interface ParsedFigmaClipboardHtml {
  meta: FigmaClipboardMeta | null;
  buffer?: Buffer;
  hasFigmaBuffer: boolean;
  fallbackHtml?: string;
}

export interface DecodedFigImage {
  /** SHA1 of the image bytes. Figma image refs use the same hex hash. */
  hash: string;
  ext: "png" | "jpg" | "webp" | "gif";
  bytes: Buffer;
}

export interface DecodedFig {
  format: "kiwi" | "zip";
  version?: number;
  document: unknown;
  images: DecodedFigImage[];
  thumbnail: Buffer | null;
  blobs: Buffer[];
}

export interface FigmaImportSelection {
  nodeId?: string;
}

export interface ImportedFigmaHtmlFile {
  filename: string;
  content: string;
  width?: number;
  height?: number;
  source?: Record<string, unknown>;
}

export interface FigmaImportStats {
  sourceKind: "figma-paste" | "fig-file";
  format?: "kiwi" | "zip" | "html-fallback";
  frameCount: number;
  imageCount: number;
  selectedNodeId?: string;
}

export interface FigmaImportResult {
  files: ImportedFigmaHtmlFile[];
  warnings: string[];
  stats: FigmaImportStats;
}
