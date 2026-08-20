import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  CHANGELOG_HEADER,
  DEFAULT_CHANGELOG_RELEASE_LIMIT,
  compactChangelog,
  parsePendingEntry,
} from "../packages/core/src/changelog/parse.ts";

const rootDir = path.resolve(import.meta.dirname, "..");
const packageArchiveNote =
  "For the full list of releases, see the [changelog archive](./changelog/archive/CHANGELOG.md).";
const legacyPackageArchiveNotes = [
  "Older releases are archived in [changelog/archive/](./changelog/archive/).",
  "Older releases are archived in [changelog/archive/CHANGELOG.md](./changelog/archive/CHANGELOG.md).",
];

type Mode = "check" | "write";

function readFolderEntries(folder: string) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter(
      (file) => file.endsWith(".md") && file.toLowerCase() !== "readme.md",
    )
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

function stripPackageArchiveNotes(markdown: string): string {
  return [packageArchiveNote, ...legacyPackageArchiveNotes]
    .reduce((value, note) => value.replaceAll(note, ""), markdown)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "");
}

function releaseSectionTitle(section: string): string | undefined {
  return section.match(/^##\s+(?!#)(.+?)\s*$/m)?.[1]?.trim();
}

function releaseSectionDate(section: string): string | undefined {
  return releaseSectionTitle(section)?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
}

type ReleaseVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
};

function releaseSectionVersion(section: string): ReleaseVersion | undefined {
  const title = releaseSectionTitle(section);
  const match = title?.match(/^\[?v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  };
}

function comparePrerelease(
  a: string | undefined,
  b: string | undefined,
): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const aParts = a.split(".");
  const bParts = b.split(".");
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index++) {
    const aPart = aParts[index];
    const bPart = bParts[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;

    const aNumber = /^\d+$/.test(aPart) ? Number(aPart) : undefined;
    const bNumber = /^\d+$/.test(bPart) ? Number(bPart) : undefined;
    if (aNumber !== undefined && bNumber !== undefined) {
      return aNumber > bNumber ? 1 : -1;
    }
    if (aNumber !== undefined) return -1;
    if (bNumber !== undefined) return 1;
    return aPart.localeCompare(bPart);
  }
  return 0;
}

function compareReleaseVersions(a: ReleaseVersion, b: ReleaseVersion): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

function uniqueNewestFirst(sections: string[]): string[] {
  const seen = new Set<string>();
  return sections
    .map((section, index) => ({
      section,
      index,
      title: releaseSectionTitle(section),
      date: releaseSectionDate(section),
      version: releaseSectionVersion(section),
    }))
    .filter(({ title }) => {
      if (!title || seen.has(title)) return false;
      seen.add(title);
      return true;
    })
    .sort((a, b) => {
      if (a.version && b.version) {
        const versionOrder = compareReleaseVersions(b.version, a.version);
        if (versionOrder !== 0) return versionOrder;
      }
      if (a.version && !b.version) return -1;
      if (!a.version && b.version) return 1;
      if (a.date && b.date && a.date !== b.date) {
        return b.date.localeCompare(a.date);
      }
      if (a.date && !b.date) return -1;
      if (!a.date && b.date) return 1;
      return (a.title ?? "").localeCompare(b.title ?? "") || a.index - b.index;
    })
    .map(({ section }) => section);
}

function compactApp(root: string, mode: Mode): boolean {
  const changelogPath = path.join(root, "CHANGELOG.md");
  const rawExisting = existsSync(changelogPath)
    ? readFileSync(changelogPath, "utf8")
    : CHANGELOG_HEADER;
  const hasPackageArchiveNote = [
    packageArchiveNote,
    ...legacyPackageArchiveNotes,
  ].some((note) => rawExisting.includes(note));
  const existing = hasPackageArchiveNote
    ? stripPackageArchiveNotes(rawExisting)
    : rawExisting;
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
  const normalizedExisting = stripPackageArchiveNotes(existing);
  const { header, sections } = splitReleaseSections(normalizedExisting);
  const cleanHeader = header.replace(/\n{3,}/g, "\n\n").trim();
  const archiveDir = path.join(root, "changelog", "archive");
  const archiveFile = path.join(archiveDir, "CHANGELOG.md");
  const existingArchiveText = existsSync(archiveFile)
    ? readFileSync(archiveFile, "utf8")
    : "";
  const existingArchive = splitReleaseSections(
    stripPackageArchiveNotes(existingArchiveText),
  ).sections;
  const allSections = uniqueNewestFirst([...sections, ...existingArchive]);
  const recent = allSections.slice(0, DEFAULT_CHANGELOG_RELEASE_LIMIT);
  const older = allSections.slice(DEFAULT_CHANGELOG_RELEASE_LIMIT);
  const archiveReminder = older.length > 0 ? `\n\n${packageArchiveNote}` : "";
  const next = `${cleanHeader || "# Changelog"}\n\n${recent.join("\n\n")}${archiveReminder}\n`;
  const nextArchive = older.length > 0 ? `${older.join("\n\n")}\n` : "";
  const archiveChanged = nextArchive !== existingArchiveText;
  const rootChanged = next !== existing;

  if (mode === "write") {
    writeFileSync(changelogPath, next, "utf8");
    if (older.length > 0 || existsSync(archiveFile)) {
      mkdirSync(archiveDir, { recursive: true });
      writeFileSync(archiveFile, nextArchive, "utf8");
    }
  }
  return rootChanged || archiveChanged;
}

function run(mode: Mode): string[] {
  const changed: string[] = [];
  const appRoots = [
    ...["templates", "examples", "apps"].flatMap(listRoots),
    path.join(rootDir, "packages", "docs"),
  ];
  const appRootSet = new Set(appRoots);
  for (const root of appRoots) {
    if (existsSync(path.join(root, "changelog"))) {
      if (compactApp(root, mode)) changed.push(path.relative(rootDir, root));
    }
  }
  for (const root of listRoots("packages").filter(
    (packageRoot) => !appRootSet.has(packageRoot),
  )) {
    if (compactPackage(root, mode)) changed.push(path.relative(rootDir, root));
  }
  return changed;
}

const mode: Mode = process.argv.includes("--write") ? "write" : "check";
const changed = run(mode);

if (changed.length > 0) {
  const verb = mode === "write" ? "Updated" : "Would update";
  console.log(
    `${verb} changelogs:\n${changed.map((item) => `- ${item}`).join("\n")}`,
  );
}

if (mode === "check" && changed.length > 0) {
  process.exitCode = 1;
}
