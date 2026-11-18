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
  parentSourceName: string | null;
  alreadyImportedAt: string | null;
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
  databases: ImportContentDatabaseResult[];
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

export interface ImportContentDatabaseResult {
  name: string;
  sourceName: string;
  rows: number;
  csvKept: boolean;
}

export interface UndoContentImportResult {
  importId: string;
  trashedIds: string[];
  message: string;
}
