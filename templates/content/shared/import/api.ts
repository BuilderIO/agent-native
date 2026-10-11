import type { ImportSkippedFile } from "./plan";
import type {
  ImportedPage,
  ImportNote,
  ImportPageStatus,
  ImportTextCoverage,
} from "./types";

export interface ImportContentFileInput {
  name: string;
  text?: string;
  url?: string;
}

export interface ImportContentArgs {
  files: ImportContentFileInput[];
  parentId?: string | null;
  spaceId?: string;
  spaceName?: string;
  dryRun: boolean;
  idempotencyKey?: string;
}

export interface ImportContentPageResult {
  /** Null on a dry run. */
  id: string | null;
  urlPath: string | null;
  sourceName: string;
  title: string;
  titleSource: ImportedPage["titleSource"];
  status: ImportPageStatus;
  notes: ImportNote[];
  coverage: ImportTextCoverage;
}

export interface ImportContentResult {
  importId: string;
  dryRun: boolean;
  destination: {
    parentId: string | null;
    spaceId: string;
    title: string | null;
  };
  /** False when applying would fail because file storage is not set up. */
  storageReady: boolean;
  pages: ImportContentPageResult[];
  skipped: ImportSkippedFile[];
  /** File names, as given, of the images the pages use; the UI uploads these. */
  uploads: string[];
  counts: {
    pages: number;
    preserved: number;
    converted: number;
    lost: number;
    skipped: number;
  };
  message: string;
}

export interface UndoContentImportResult {
  importId: string;
  trashedIds: string[];
  message: string;
}
