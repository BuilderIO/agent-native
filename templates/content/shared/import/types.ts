import type { PMDoc } from "../nfm";

/**
 * How a piece of the source arrived on the page. `converted` content is all
 * there in a different form; `kept` content is retained with the import
 * record but not shown on the page; `lost` content is gone.
 */
export type ImportNoteSeverity = "converted" | "kept" | "lost";

export const IMPORT_NOTE_SEVERITY = {
  "footnotes-moved-to-end": "converted",
  "github-alert-to-callout": "converted",
  "html-formatting-converted": "converted",
  "html-tag-removed": "converted",
  "html-block-flattened": "converted",
  "inline-image-moved-to-own-line": "converted",
  "ordered-task-list-unnumbered": "converted",
  "title-formatting-removed": "converted",
  "frontmatter-not-shown": "kept",
  "frontmatter-unreadable": "kept",
  "asset-missing": "lost",
  "link-target-not-imported": "lost",
  "link-removed": "lost",
  "image-title-dropped": "lost",
  "link-title-dropped": "lost",
  "code-block-info-dropped": "lost",
  "hidden-html-dropped": "lost",
  "unsupported-markdown": "lost",
  "text-not-landed": "lost",
  "structure-changed-on-save": "lost",
} as const satisfies Record<string, ImportNoteSeverity>;

export type ImportNoteKind = keyof typeof IMPORT_NOTE_SEVERITY;

export interface ImportNote {
  kind: ImportNoteKind;
  severity: ImportNoteSeverity;
  count: number;
  /** Short excerpts naming what was affected, at most a few per note. */
  samples: string[];
}

export type ImportPageStatus = "preserved" | "converted" | "lost";

export interface ImportTextCoverage {
  /** Letters and digits in the source that a reader would see. */
  sourceCharacters: number;
  /** Source letters and digits that appear nowhere on the imported page. */
  missingCharacters: number;
  /** Source words that do not appear on the page, for the report. */
  missingSample: string[];
}

/**
 * `markdown` is read as CommonMark with GitHub extensions. `nfm` is Content's
 * own stored Markdown, recognized by constructs only it writes, and read by
 * the same parser the editor uses so Content exports round-trip.
 */
export type MarkdownDialect = "markdown" | "nfm";

export type ImportAssetRequest =
  | {
      kind: "file";
      /** Path relative to the import root, `/`-separated, never escaping it. */
      path: string;
      /** The reference as written in the source. */
      reference: string;
    }
  | {
      kind: "data-url";
      mediaType: string;
      dataUrl: string;
      reference: string;
    };

export type ImportAssetResolution =
  | { status: "resolved"; url: string }
  /** Preview only: the file is part of the import but not uploaded yet. */
  | { status: "available" }
  | { status: "missing" };

export interface ImportResolvers {
  asset?: (request: ImportAssetRequest) => ImportAssetResolution;
  /** Maps a relative link to another imported file onto its new page URL. */
  link?: (path: string) => string | null;
}

export type ImportFinalizeMode = "preview" | "apply";

export interface ImportFrontmatter {
  /** Fields with no page equivalent, kept with the import record. */
  unmapped: Record<string, unknown> | null;
  /** Raw frontmatter that could not be parsed, kept with the import record. */
  unreadable: string | null;
}

export interface ImportedPageReport {
  status: ImportPageStatus;
  notes: ImportNote[];
  coverage: ImportTextCoverage;
}

export interface ImportedPage {
  sourceName: string;
  dialect: MarkdownDialect;
  title: string;
  titleSource: "frontmatter" | "heading" | "filename";
  description: string | null;
  icon: string | null;
  frontmatter: ImportFrontmatter;
  /** Stored NFM body, ready for the one writable copy. */
  content: string;
  /** The editor document `content` loads as. */
  doc: PMDoc;
  assets: Array<{ reference: string; status: ImportAssetResolution["status"] }>;
  report: ImportedPageReport;
}
