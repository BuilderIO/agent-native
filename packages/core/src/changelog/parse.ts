/**
 * Shared, dependency-free changelog parsing + serialization.
 *
 * Used by BOTH:
 *   - the browser bundle (rendering an app's CHANGELOG.md in the command
 *     menu / settings "What's new" surface), and
 *   - the `agent-native changelog` CLI (rolling pending entry files up into
 *     CHANGELOG.md).
 *
 * Keep this file isomorphic: no Node, no browser, no third-party deps. The
 * markdown shape is the conventional "Keep a Changelog" layout — a top-level
 * `# Changelog` heading followed by one `## <release>` section per release.
 */

/** A single released section of a CHANGELOG.md file. */
export interface ChangelogEntry {
  /** Stable id derived from the heading — used for "unseen" tracking. */
  id: string;
  /** Raw heading text, e.g. `2026-06-23` or `v1.2.0 — 2026-06-23`. */
  title: string;
  /** ISO date (YYYY-MM-DD) extracted from the heading, if present. */
  date?: string;
  /** Version label extracted from the heading, if present. */
  version?: string;
  /** Markdown body beneath the heading (until the next `## ` section). */
  body: string;
}

/** A not-yet-released entry authored as a `changelog/<file>.md` file. */
export interface PendingChangelogEntry {
  /** Category — `added`, `improved`, `fixed`, `changed`, etc. */
  type: ChangelogChangeType;
  /** ISO date the entry was authored (YYYY-MM-DD). */
  date?: string;
  /** User-facing description (markdown, single bullet). */
  text: string;
}

export type ChangelogChangeType =
  | "added"
  | "improved"
  | "fixed"
  | "changed"
  | "removed"
  | "security";

/**
 * Order changes are grouped under a release heading. Anything not listed here
 * falls back to the "changed" group, then renders in insertion order.
 */
export const CHANGELOG_GROUP_ORDER: ChangelogChangeType[] = [
  "added",
  "improved",
  "fixed",
  "changed",
  "removed",
  "security",
];

const GROUP_LABELS: Record<ChangelogChangeType, string> = {
  added: "Added",
  improved: "Improved",
  fixed: "Fixed",
  changed: "Changed",
  removed: "Removed",
  security: "Security",
};

const ISO_DATE = /(\d{4}-\d{2}-\d{2})/;

/** Lowercase, hyphenate, and strip to a URL/id-safe slug. */
export function changelogSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeType(raw: string | undefined): ChangelogChangeType {
  const value = (raw ?? "").trim().toLowerCase();
  if ((CHANGELOG_GROUP_ORDER as string[]).includes(value)) {
    return value as ChangelogChangeType;
  }
  // Friendly aliases.
  if (value === "feature" || value === "new" || value === "add") return "added";
  if (value === "improvement" || value === "enhancement" || value === "perf") {
    return "improved";
  }
  if (value === "fix" || value === "bugfix" || value === "bug") return "fixed";
  if (value === "remove" || value === "deprecated") return "removed";
  return "changed";
}

/**
 * Parse a CHANGELOG.md document into structured release entries.
 *
 * Tolerant by design: an empty or malformed file yields an empty list rather
 * than throwing, so a missing/partial changelog never breaks the UI.
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  if (!markdown || typeof markdown !== "string") return [];

  const lines = markdown.split(/\r?\n/);
  const entries: ChangelogEntry[] = [];
  const seenIds = new Set<string>();

  let currentTitle: string | null = null;
  let bodyLines: string[] = [];

  const flush = () => {
    if (currentTitle === null) return;
    const title = currentTitle.trim();
    const date = title.match(ISO_DATE)?.[1];
    const version = title.match(/v?\d+\.\d+(?:\.\d+)?/)?.[0];
    // Build a stable, unique id from the heading.
    let base = changelogSlug(title) || "entry";
    let id = base;
    let n = 2;
    while (seenIds.has(id)) id = `${base}-${n++}`;
    seenIds.add(id);
    entries.push({
      id,
      title,
      date,
      version: version && version !== date ? version : undefined,
      body: bodyLines.join("\n").trim(),
    });
    currentTitle = null;
    bodyLines = [];
  };

  for (const line of lines) {
    // `## ` (but not `### `) starts a new release section.
    const match = /^##\s+(?!#)(.+?)\s*$/.exec(line);
    if (match) {
      flush();
      currentTitle = stripBrackets(match[1]);
      continue;
    }
    // Skip the top-level `# Changelog` title and anything before the first `##`.
    if (currentTitle === null) continue;
    bodyLines.push(line);
  }
  flush();

  return entries;
}

/** `## [1.2.0]` → `1.2.0`; leaves un-bracketed headings untouched. */
function stripBrackets(title: string): string {
  return title.replace(/^\[(.+?)\]\s*/, "$1 ").trim();
}

/**
 * Parse a pending `changelog/<file>.md` entry: optional `---` frontmatter
 * (`type:` / `date:`) followed by the markdown description body. Callers that
 * know the entry filename can provide its date as a fallback for hand-written
 * entries that omit `date:`.
 */
export function parsePendingEntry(
  content: string,
  fallbackDate?: string,
): PendingChangelogEntry {
  let type: string | undefined;
  let date: string | undefined;
  let body = content;

  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (fm) {
    for (const raw of fm[1].split(/\r?\n/)) {
      const kv = /^([a-zA-Z]+)\s*:\s*(.+?)\s*$/.exec(raw);
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      const value = kv[2].replace(/^["']|["']$/g, "").trim();
      if (key === "type") type = value;
      else if (key === "date") date = value.match(ISO_DATE)?.[1] ?? value;
    }
    body = content.slice(fm[0].length);
  }

  return {
    type: normalizeType(type),
    date: date?.match(ISO_DATE)?.[1] ?? fallbackDate?.match(ISO_DATE)?.[1],
    text: body.trim(),
  };
}

/**
 * Render a set of pending entries as a single dated release section (the body
 * that goes beneath a `## <date>` heading). Groups bullets by type.
 */
export function renderReleaseBody(entries: PendingChangelogEntry[]): string {
  const groups = new Map<ChangelogChangeType, string[]>();
  for (const entry of entries) {
    const text = entry.text.trim();
    if (!text) continue;
    const bullet = text.includes("\n")
      ? // Preserve multi-line bodies, indenting continuation lines.
        text
          .split(/\r?\n/)
          .map((l, i) => (i === 0 ? `- ${l}` : `  ${l}`))
          .join("\n")
      : `- ${text}`;
    const list = groups.get(entry.type) ?? [];
    list.push(bullet);
    groups.set(entry.type, list);
  }

  const sections: string[] = [];
  for (const type of CHANGELOG_GROUP_ORDER) {
    const list = groups.get(type);
    if (!list?.length) continue;
    sections.push(`### ${GROUP_LABELS[type]}\n\n${list.join("\n")}`);
  }
  return sections.join("\n\n");
}

const CHANGELOG_HEADER =
  "# Changelog\n\n" +
  "All notable user-facing changes to this app are documented here.\n";

/**
 * Roll a batch of pending entries into an existing CHANGELOG.md document,
 * prepending a new `## <date>` section above the most recent release. Returns
 * the full updated document. Pure — the CLI handles file IO and deletion.
 */
export function rollupChangelog(
  existing: string,
  pending: PendingChangelogEntry[],
  releaseDate: string,
): string {
  const body = renderReleaseBody(pending);
  if (!body) return existing || `${CHANGELOG_HEADER}`;

  const section = `## ${releaseDate}\n\n${body}\n`;

  const doc = (existing || CHANGELOG_HEADER).replace(/\s+$/, "");
  // Insert the new section immediately before the first existing `## ` release
  // so the header/intro stays on top and releases stay newest-first.
  const firstRelease = doc.search(/^##\s+(?!#)/m);
  if (firstRelease === -1) {
    return `${doc}\n\n${section}\n`;
  }
  const head = doc.slice(0, firstRelease).replace(/\s+$/, "");
  const rest = doc.slice(firstRelease);
  return `${head}\n\n${section}\n${rest}\n`;
}

function changelogHeader(markdown: string): string {
  const doc = (markdown || CHANGELOG_HEADER).replace(/\s+$/, "");
  const firstRelease = doc.search(/^##\s+(?!#)/m);
  const header =
    (firstRelease === -1 ? doc : doc.slice(0, firstRelease)).replace(
      /\s+$/,
      "",
    ) || CHANGELOG_HEADER.trim();
  return header;
}

function pendingSectionTitle(entry: PendingChangelogEntry): string {
  return entry.date?.match(ISO_DATE)?.[1] ?? "Unreleased";
}

function pendingSectionSort(a: string, b: string): number {
  const aDate = a.match(ISO_DATE)?.[1];
  const bDate = b.match(ISO_DATE)?.[1];
  if (aDate && bDate) return bDate.localeCompare(aDate);
  if (!aDate && bDate) return -1;
  if (aDate && !bDate) return 1;
  return a.localeCompare(b);
}

/**
 * Render an app-facing changelog that includes both released CHANGELOG.md
 * sections and adjacent pending `changelog/*.md` entries. Unlike `release`,
 * this is pure and non-destructive, so build/dev bundles can show current
 * product notes without deleting the conflict-free pending files.
 */
export function mergePendingChangelog(
  existing: string,
  pending: PendingChangelogEntry[],
): string {
  const pendingWithText = pending.filter((entry) => entry.text.trim());
  if (pendingWithText.length === 0) return existing || CHANGELOG_HEADER;

  const existingEntries = parseChangelog(existing);
  const usedExistingIndexes = new Set<number>();
  const pendingByTitle = new Map<string, PendingChangelogEntry[]>();

  for (const entry of pendingWithText) {
    const title = pendingSectionTitle(entry);
    pendingByTitle.set(title, [...(pendingByTitle.get(title) ?? []), entry]);
  }

  const sections: string[] = [];
  for (const title of [...pendingByTitle.keys()].sort(pendingSectionSort)) {
    const body = renderReleaseBody(pendingByTitle.get(title) ?? []);
    if (!body) continue;

    const existingIndex = existingEntries.findIndex((entry, index) => {
      if (usedExistingIndexes.has(index)) return false;
      return entry.date === title || entry.title === title;
    });

    if (existingIndex === -1) {
      sections.push(`## ${title}\n\n${body}`);
      continue;
    }

    usedExistingIndexes.add(existingIndex);
    const existingEntry = existingEntries[existingIndex];
    sections.push(
      `## ${existingEntry.title}\n\n${[body, existingEntry.body]
        .filter(Boolean)
        .join("\n\n")}`,
    );
  }

  existingEntries.forEach((entry, index) => {
    if (usedExistingIndexes.has(index)) return;
    sections.push(`## ${entry.title}\n\n${entry.body}`);
  });

  return `${changelogHeader(existing)}\n\n${sections.join("\n\n")}\n`;
}

export { CHANGELOG_HEADER, GROUP_LABELS };
