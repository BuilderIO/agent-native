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
  /** The imported file this page goes under; null for the destination. */
  parentSourceName: string | null;
  /**
   * When a page with this file's exact text was last imported and is still
   * out of Trash. Dry runs only; importing again makes new pages anyway.
   */
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
  /** Notion databases in the import, which aren't imported yet. */
  databases: ImportContentDatabaseResult[];
  /**
   * File names, as given, of the images and files the pages use, such as a
   * PDF or a database's CSV a page links to; the UI uploads these.
   */
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
  /** The database's CSV in the import. */
  sourceName: string;
  /** Row pages the export holds for it. */
  rows: number;
  /**
   * Whether its CSV is kept as a file a page links to. A database no
   * imported page links to keeps only its listing here.
   */
  csvKept: boolean;
}

export interface UndoContentImportResult {
  importId: string;
  trashedIds: string[];
  message: string;
}
