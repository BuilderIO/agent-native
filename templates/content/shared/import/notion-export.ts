import { isMarkdownFilePath } from "./paths";
import type { ImportNoteKind } from "./types";

/**
 * Notion's "Markdown & CSV" export names each page `Title <32-hex id>.md`
 * and puts its subpages in a folder beside it: `Title/` in current exports,
 * `Title <id>/` in older ones. A database is `Name <id>.csv`, an
 * `Name <id>_all.csv` with every row whatever the view showed, and a folder
 * of row pages.
 */
const NOTION_NAME_RE = /^(.*?) ([0-9a-f]{32})(_all)?$/i;

interface NotionName {
  title: string;
  id: string;
  all: boolean;
}

function notionName(path: string): NotionName | null {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const base = file.replace(/\.[^./]+$/, "");
  const match = NOTION_NAME_RE.exec(base);
  if (!match) return null;
  const [, title = "", id = "", all] = match;
  return { title: title.trim(), id: id.toLowerCase(), all: Boolean(all) };
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function withoutExtension(path: string): string {
  return path.replace(/\.[^./]+$/, "");
}

/** Whether the files are a Notion export: some page carries Notion's id. */
export function isNotionExport(paths: Iterable<string>): boolean {
  for (const path of paths) {
    if (isMarkdownFilePath(path) && notionName(path)) return true;
  }
  return false;
}

/** A page's title from its exported file name, without Notion's id. */
export function notionFileTitle(path: string): string {
  const name = notionName(path);
  if (name?.title) return name.title;
  const file = path.slice(path.lastIndexOf("/") + 1);
  return withoutExtension(file) || "Untitled";
}

export interface NotionDatabase {
  name: string;
  /** The CSV the export links from the page holding the database. */
  csvPath: string;
  /** The CSV kept for it: every row when the export has that file. */
  keptCsvPath: string;
  /** Row pages, directly in the database's folder. */
  rows: string[];
}

export interface NotionExportPlan {
  /** Database row pages and their files, which slice 5 imports. */
  databaseFiles: Set<string>;
  databases: NotionDatabase[];
  /** A CSV path to the one kept in its place, `Name <id>_all.csv`. */
  csvAliases: Map<string, string>;
  /**
   * Pages that could hold each page as a subpage. Usually one; current
   * exports name both folders `Title/` when two sibling pages share a title
   * and both have subpages.
   */
  parentCandidates: Map<string, string[]>;
}

/** Reads the shape of a Notion export from its file paths alone. */
export function planNotionExport(paths: readonly string[]): NotionExportPlan {
  const pages = paths.filter(
    (path) => isMarkdownFilePath(path) && notionName(path),
  );
  // Folder a page's subpages sit in → the pages it could belong to.
  const pageFolders = new Map<string, string[]>();
  for (const page of pages) {
    const name = notionName(page);
    if (!name) continue;
    const folder = folderOf(page);
    for (const key of new Set([
      withoutExtension(page),
      joinPath(folder, name.title),
    ])) {
      const owners = pageFolders.get(key) ?? [];
      owners.push(page);
      pageFolders.set(key, owners);
    }
  }

  const databases: NotionDatabase[] = [];
  const csvAliases = new Map<string, string>();
  const databaseFolders: string[] = [];
  const csvs = paths.filter((path) => /\.csv$/i.test(path) && notionName(path));
  const csvSet = new Set(csvs);
  for (const csv of csvs) {
    const name = notionName(csv);
    if (!name || name.all) continue;
    const folder = folderOf(csv);
    const all = joinPath(folder, `${name.title} ${name.id}_all.csv`);
    const allPath = [...csvSet].find(
      (candidate) => candidate.toLowerCase() === all.toLowerCase(),
    );
    if (allPath) csvAliases.set(csv, allPath);
    // A page with the same title beside it owns a `Title/` folder first.
    const rowFolders = [
      withoutExtension(csv),
      joinPath(folder, name.title),
    ].filter((key) => !pageFolders.has(key));
    databaseFolders.push(...rowFolders);
    databases.push({
      name: name.title || notionFileTitle(csv),
      csvPath: csv,
      keptCsvPath: allPath ?? csv,
      rows: pages.filter((page) => rowFolders.includes(folderOf(page))),
    });
  }
  // An `_all` CSV whose view CSV is missing still names a database.
  for (const csv of csvs) {
    const name = notionName(csv);
    if (!name?.all || [...csvAliases.values()].includes(csv)) continue;
    const folder = folderOf(csv);
    const rowFolders = [
      joinPath(folder, `${name.title} ${name.id}`),
      joinPath(folder, name.title),
    ].filter((key) => !pageFolders.has(key));
    databaseFolders.push(...rowFolders);
    databases.push({
      name: name.title || notionFileTitle(csv),
      csvPath: csv,
      keptCsvPath: csv,
      rows: pages.filter((page) => rowFolders.includes(folderOf(page))),
    });
  }

  const databaseFiles = new Set<string>();
  for (const path of paths) {
    if (
      databaseFolders.some((folder) => path.startsWith(`${folder}/`)) ||
      (csvSet.has(path) && databases.some((db) => isDatabaseCsv(db, path)))
    ) {
      databaseFiles.add(path);
    }
  }

  const parentCandidates = new Map<string, string[]>();
  for (const page of pages) {
    if (databaseFiles.has(page)) continue;
    let folder = folderOf(page);
    let owners: string[] = [];
    // A folder no page owns, such as the one a workspace export wraps
    // everything in, is passed through to the nearest page above it.
    while (folder) {
      owners = (pageFolders.get(folder) ?? []).filter(
        (owner) => owner !== page && !databaseFiles.has(owner),
      );
      if (owners.length) break;
      folder = folderOf(folder);
    }
    parentCandidates.set(page, owners);
  }
  return { databaseFiles, databases, csvAliases, parentCandidates };
}

function isDatabaseCsv(database: NotionDatabase, path: string): boolean {
  return database.csvPath === path || database.keptCsvPath === path;
}

function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

/** `Key: value` as Notion writes a property under a page's title. */
const PROPERTY_LINE_RE = /^([^\s#>|*+`[!<\-\d][^:\n]{0,99}):(?: (.*))?$/;
const NOTION_ICON_IMG_RE =
  /^(\s*)<img\b[^>]*\bsrc="https:\/\/www\.notion\.so\/icons\/[^"]*"[^>]*>\s*/i;
/** A bookmark, which Notion exports as a link with no text: `[](url)`. */
const BOOKMARK_RE = /(^|[^!\]\\])\[\]\((https?:\/\/[^()\s]+)\)/g;

/**
 * Rewrites a Notion page's Markdown into what the importer reads:
 *
 * - The `Key: value` lines Notion writes under a database row's title are
 *   its properties. Content shows properties only in databases, so they come
 *   off the page and are named in the report; the original file keeps them.
 * - `<aside>` and `</aside>` lines get a blank line inside each, so the
 *   callout's first line is Markdown rather than part of an HTML block.
 * - A callout's custom icon, an image from Notion's icon set, gives way to
 *   the default; an emoji icon is kept.
 * - A bookmark's link shows its URL, since Notion leaves its text empty and
 *   an empty link shows nothing.
 */
export function prepareNotionMarkdown(text: string): {
  text: string;
  notes: Array<{ kind: ImportNoteKind; sample?: string }>;
} {
  const notes: Array<{ kind: ImportNoteKind; sample?: string }> = [];
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  if (/^# \S/.test(lines[0] ?? "") && lines[1] === "") {
    let end = 2;
    while (end < lines.length && PROPERTY_LINE_RE.test(lines[end] ?? "")) end++;
    const count = end - 2;
    // One `Word: text` line under a title is as likely a sentence as a
    // property, so it stays on the page.
    if (count >= 2 && (end === lines.length || lines[end] === "")) {
      for (const line of lines.slice(2, end)) {
        notes.push({
          kind: "properties-not-shown",
          sample: PROPERTY_LINE_RE.exec(line)?.[1]?.trim() ?? line,
        });
      }
      lines.splice(2, end === lines.length ? count : count + 1);
    }
  }

  const out: string[] = [];
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const run = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (run?.startsWith(fence)) fence = null;
      out.push(line);
      continue;
    }
    if (run) {
      fence = run;
      out.push(line);
      continue;
    }
    if (/^\s*<aside>\s*$/i.test(line)) {
      out.push(line, "");
      const next = lines[index + 1];
      if (next !== undefined && NOTION_ICON_IMG_RE.test(next)) {
        notes.push({ kind: "callout-icon-replaced" });
        const rest = next.replace(NOTION_ICON_IMG_RE, "$1");
        lines[index + 1] = rest.trim() ? rest : "";
      }
      continue;
    }
    if (/^\s*<\/aside>\s*$/i.test(line)) {
      if (out[out.length - 1]?.trim()) out.push("");
      out.push(line);
      continue;
    }
    out.push(line.replace(BOOKMARK_RE, "$1[$2]($2)"));
  }
  return { text: out.join("\n"), notes };
}
