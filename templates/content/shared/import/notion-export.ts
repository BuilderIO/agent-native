import { isMarkdownFilePath } from "./paths";
import type { ImportNoteKind } from "./types";

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

export function isNotionExport(paths: Iterable<string>): boolean {
  for (const path of paths) {
    if (isMarkdownFilePath(path) && notionName(path)) return true;
  }
  return false;
}

export function notionFileTitle(path: string): string {
  const name = notionName(path);
  if (name?.title) return name.title;
  const file = path.slice(path.lastIndexOf("/") + 1);
  return withoutExtension(file) || "Untitled";
}

export interface NotionDatabase {
  name: string;
  csvPath: string;
  keptCsvPath: string;
  rows: string[];
}

export interface NotionExportPlan {
  databaseFiles: Set<string>;
  databases: NotionDatabase[];
  csvAliases: Map<string, string>;
  parentCandidates: Map<string, string[]>;
}

export function planNotionExport(paths: readonly string[]): NotionExportPlan {
  const pages = paths.filter(
    (path) => isMarkdownFilePath(path) && notionName(path),
  );
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

const NOTION_ICON_IMG_RE =
  /^(\s*)<img\b[^>]*\bsrc="https:\/\/www\.notion\.so\/icons\/[^"]*"[^>]*>\s*/i;
const BOOKMARK_RE = /(^|[^!\]\\])\[\]\((https?:\/\/[^()\s]+)\)/g;

export function prepareNotionMarkdown(text: string): {
  text: string;
  notes: Array<{ kind: ImportNoteKind; sample?: string }>;
} {
  const notes: Array<{ kind: ImportNoteKind; sample?: string }> = [];
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

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
      const next = lines[index + 1] ?? "";
      if (NOTION_ICON_IMG_RE.test(next)) {
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
