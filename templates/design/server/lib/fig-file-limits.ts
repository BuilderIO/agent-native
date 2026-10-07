export interface FigImportLimits {
  fileBytes: number;
  zipEntries: number;
  inflatedBytes: number;
  inflatedChunkBytes: number;
  decodeReads: number;
  decodedObjects: number;
  collectionLength: number;
  collectionItems: number;
  binaryBytes: number;
  binaryFieldBytes: number;
  stringBytes: number;
  nodes: number;
  renderedNodes: number;
  images: number;
  imageBytes: number;
  frames: number;
  totalHtmlBytes: number;
}

export const SERVER_FIG_LIMITS: FigImportLimits = {
  fileBytes: 50 * 1024 * 1024,
  zipEntries: 2_048,
  inflatedBytes: 96 * 1024 * 1024,
  inflatedChunkBytes: 48 * 1024 * 1024,
  decodeReads: 64 * 1024 * 1024,
  decodedObjects: 8_000_000,
  collectionLength: 2_000_000,
  collectionItems: 24_000_000,
  binaryBytes: 32 * 1024 * 1024,
  binaryFieldBytes: 4 * 1024 * 1024,
  stringBytes: 32 * 1024 * 1024,
  nodes: 75_000,
  renderedNodes: 250_000,
  images: 1_024,
  imageBytes: 64 * 1024 * 1024,
  frames: 300,
  totalHtmlBytes: 24 * 1024 * 1024,
};

// The browser decodes in a worker that shares the tab's renderer process, so
// these stay below what crashes the tab: running out of memory there kills the
// whole page instead of failing the import.
export const BROWSER_FIG_LIMITS: FigImportLimits = {
  fileBytes: 2 * 1024 * 1024 * 1024,
  zipEntries: 20_480,
  inflatedBytes: 768 * 1024 * 1024,
  inflatedChunkBytes: 512 * 1024 * 1024,
  decodeReads: 1024 * 1024 * 1024,
  decodedObjects: 40_000_000,
  collectionLength: 8_000_000,
  collectionItems: 120_000_000,
  binaryBytes: 384 * 1024 * 1024,
  binaryFieldBytes: 32 * 1024 * 1024,
  stringBytes: 256 * 1024 * 1024,
  nodes: 1_500_000,
  renderedNodes: 4_000_000,
  images: 20_000,
  imageBytes: 2 * 1024 * 1024 * 1024,
  frames: 2_000,
  totalHtmlBytes: 256 * 1024 * 1024,
};

export const MAX_FIG_FILE_BYTES = SERVER_FIG_LIMITS.fileBytes;
