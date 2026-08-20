import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  CHANGELOG_HEADER,
  DEFAULT_CHANGELOG_RELEASE_LIMIT,
  compactChangelog,
  parsePendingEntry,
} from "../packages/core/src/changelog/parse.ts";

const rootDir = path.resolve(import.meta.dirname, "..");
const legacyPackageArchiveNote =
  "Older releases are archived in [changelog/archive/](./changelog/archive/).";
const packageArchiveNote =
  "Older releases are archived in [changelog/archive/CHANGELOG.md](./changelog/archive/CHANGELOG.md).";

type Mode = "check" | "write";

function readFolderEntries(folder: string) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((file) => file.endsWith(".md") && file.toLowerCase() !== "readme.md")
    .sort()
    .map((file) => {
      const filenameDate = file.match(/^(\d{4}-\d{2}-\d{2})(?:-|\.md$)/)?.[1];
      return parsePendingEntry(
        readFileSync(path.join(folder, file), "utf8"),
        filenameDate,
      );
    });
}

function listRoots(parent: string): string[] {
  const directory = path.join(rootDir, parent);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function splitReleaseSections(markdown: string): {
  header: string;
  sections: string[];
} {
  const matches = [...markdown.matchAll(/^##\s+(?!#).+$/gm)];
  if (matches.length === 0) {
    return { header: markdown.trim(), sections: [] };
  }

  const header = markdown.slice(0, matches[0].index).trim();
  const sections = matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? markdown.length;
    return markdown.slice(start, end).trim();
  });
  return { header, sections };
}

function compactApp(root: string, mode: Mode): boolean {
  const changelogPath = path.join(root, "CHANGELOG.md");
  const existing = existsSync(changelogPath)
    ? readFileSync(changelogPath, "utf8")
    : CHANGELOG_HEADER;
  const next = compactChangelog(
    existing,
    readFolderEntries(path.join(root, "changelog")),
  );

  if (next === existing) return false;
  if (mode === "write") writeFileSync(changelogPath, next, "utf8");
  return true;
}

function compactPackage(root: string, mode: Mode): boolean {
  const changelogPath = path.join(root, "CHANGELOG.md");
  if (!existsSync(changelogPath)) return false;

  const existing = readFileSync(changelogPath, "utf8");
  const normalizedExisting = existing.replace(
    legacyPackageArchiveNote,
    packageArchiveNote,
  );
  const { header, sections } = splitReleaseSections(normalizedExisting);
  if (sections.length <= DEFAULT_CHANGELOG_RELEASE_LIMIT) {
    if (mode === "write" && normalizedExisting !== existing) {
      writeFileSync(changelogPath, normalizedExisting, "utf8");
    }
    return normalizedExisting !== existing;
  }

  const recent = sections.slice(0, DEFAULT_CHANGELOG_RELEASE_LIMIT);
  const older = sections.slice(DEFAULT_CHANGELOG_RELEASE_LIMIT);
  const cleanHeader = header
    .replace(packageArchiveNote, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const next = `${cleanHeader}\n\n${packageArchiveNote}\n\n${recent.join("\n\n")}\n`;
  const archiveDir = path.join(root, "changelog", "archive");
  const archiveFile = path.join(archiveDir, "CHANGELOG.md");
  const existingArchive = existsSync(archiveFile)
    ? splitReleaseSections(readFileSync(archiveFile, "utf8")).sections
    : [];
  const archiveTitles = new Set<string>();
  const archiveSections = [...older, ...existingArchive].filter((section) => {
    const title = section.match(/^##\s+(.+?)\s*$/m)?.[1]?.trim();
    if (!title || archiveTitles.has(title)) return false;
    archiveTitles.add(title);
    return true;
  });

  if (mode === "write") {
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(changelogPath, next, "utf8");
    writeFileSync(archiveFile, `${archiveSections.join("\n\n")}\n`, "utf8");
  }
  return true;
}

function run(mode: Mode): string[] {
  const changed: string[] = [];
  const appRoots = [
    ...["templates", "examples", "apps"].flatMap(listRoots),
    path.join(rootDir, "packages", "docs"),
  ];
  for (const root of appRoots) {
    if (existsSync(path.join(root, "changelog"))) {
      if (compactApp(root, mode)) changed.push(path.relative(rootDir, root));
    }
  }
  for (const root of listRoots("packages")) {
    if (compactPackage(root, mode)) changed.push(path.relative(rootDir, root));
  }
  return changed;
}

const mode: Mode = process.argv.includes("--write") ? "write" : "check";
const changed = run(mode);

if (changed.length > 0) {
  const verb = mode === "write" ? "Updated" : "Would update";
  console.log(`${verb} changelogs:\n${changed.map((item) => `- ${item}`).join("\n")}`);
}

if (mode === "check" && changed.length > 0) {
  process.exitCode = 1;
}
