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

/** A folder-backed entry authored as a `changelog/<file>.md` file. */
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

export const DEFAULT_CHANGELOG_RELEASE_LIMIT = 100;

export const CHANGELOG_ARCHIVE_NOTE =
  "For the full list of updates, see the [changelog folder](./changelog/).";

const LEGACY_CHANGELOG_ARCHIVE_NOTE =
  'Older updates live in [the changelog folder](./changelog/) and are included in the in-app "What\'s new" view.';

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

function cleanChangelogBody(value: string): string {
  return value.trim();
}

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
    const text = cleanChangelogBody(entry.text);
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

function stripChangelogArchiveNotes(markdown: string): string {
  return markdown
    .replace(CHANGELOG_ARCHIVE_NOTE, "")
    .replace(LEGACY_CHANGELOG_ARCHIVE_NOTE, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "");
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

function normalizedChangelogText(value: string): string {
  return value
    .replace(/^\s*-\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

type ChangelogBodyGroup = {
  title: string;
  body: string;
  headingComments: string[];
  index: number;
};

function stripHtmlComments(
  line: string,
  inComment: boolean,
): { line: string; inComment: boolean; comments: string[] } {
  let cursor = 0;
  let visibleLine = "";
  const comments: string[] = [];
  let inlineCodeMarker: string | undefined;
  while (cursor < line.length) {
    if (inComment) {
      const commentEnd = line.indexOf("-->", cursor);
      if (commentEnd === -1) {
        return { line: visibleLine, inComment: true, comments };
      }
      cursor = commentEnd + 3;
      inComment = false;
      continue;
    }

    if (inlineCodeMarker) {
      const codeEnd = line.indexOf(inlineCodeMarker, cursor);
      if (codeEnd === -1) {
        visibleLine += line.slice(cursor);
        break;
      }
      visibleLine += line.slice(cursor, codeEnd + inlineCodeMarker.length);
      cursor = codeEnd + inlineCodeMarker.length;
      inlineCodeMarker = undefined;
      continue;
    }

    const commentStart = line.indexOf("<!--", cursor);
    const codeStartIndex = line.indexOf("`", cursor);
    if (
      codeStartIndex !== -1 &&
      (commentStart === -1 || codeStartIndex < commentStart)
    ) {
      visibleLine += line.slice(cursor, codeStartIndex);
      const codeStart = /^`+/.exec(line.slice(codeStartIndex))?.[0] ?? "`";
      visibleLine += codeStart;
      cursor = codeStartIndex + codeStart.length;
      inlineCodeMarker = codeStart;
      continue;
    }

    if (commentStart === -1) {
      visibleLine += line.slice(cursor);
      break;
    }

    visibleLine += line.slice(cursor, commentStart);
    const commentEnd = line.indexOf("-->", commentStart + 4);
    if (commentEnd !== -1) {
      comments.push(line.slice(commentStart, commentEnd + 3));
    }
    cursor = commentStart + 4;
    inComment = true;
  }
  return { line: visibleLine, inComment, comments };
}

function splitChangelogBodyGroups(body: string): {
  prefix: string;
  groups: ChangelogBodyGroup[];
} {
  const matches: Array<{
    title: string;
    headingComments: string[];
    start: number;
    headingEnd: number;
  }> = [];
  let offset = 0;
  let fenceMarker: { character: string; length: number } | undefined;
  let htmlComment = false;
  for (const line of body.split(/\r?\n/)) {
    const lineEnd = offset + line.length;
    if (fenceMarker) {
      const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)?.[1];
      const closingFence = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (
        fence &&
        closingFence &&
        fenceMarker.character === fence[0] &&
        closingFence.length >= fenceMarker.length
      ) {
        fenceMarker = undefined;
      }
    } else {
      let visibleLine: string | undefined;
      let headingComments: string[] = [];
      if (!htmlComment) {
        const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)?.[1];
        if (fence) {
          fenceMarker = { character: fence[0], length: fence.length };
        } else {
          const commentResult = stripHtmlComments(line, false);
          htmlComment = commentResult.inComment;
          visibleLine = commentResult.line;
          headingComments = commentResult.comments;
        }
      } else {
        const commentResult = stripHtmlComments(line, true);
        htmlComment = commentResult.inComment;
        visibleLine = commentResult.line;
        headingComments = commentResult.comments;
      }

      if (visibleLine !== undefined && !fenceMarker) {
        const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(visibleLine)?.[1];
        if (fence) {
          fenceMarker = { character: fence[0], length: fence.length };
        } else {
          const heading = /^ {0,3}###\s+(.+?)(?:\s+#+)?\s*$/.exec(visibleLine);
          if (
            heading &&
            CHANGELOG_GROUP_ORDER.some(
              (type) =>
                GROUP_LABELS[type].toLowerCase() ===
                heading[1].trim().toLowerCase(),
            )
          ) {
            matches.push({
              title: heading[1].trim(),
              headingComments,
              start: offset,
              headingEnd: lineEnd,
            });
          }
        }
      }
    }
    const newlineLength = body.startsWith("\r\n", lineEnd)
      ? 2
      : lineEnd < body.length
        ? 1
        : 0;
    offset = lineEnd + newlineLength;
  }
  if (matches.length === 0) return { prefix: body.trim(), groups: [] };

  const prefix = body.slice(0, matches[0].start).trim();
  const groups = matches.map((match, index) => {
    const end = matches[index + 1]?.start ?? body.length;
    return {
      title: match.title,
      headingComments: match.headingComments,
      body: body.slice(match.headingEnd, end).trim(),
      index,
    };
  });
  return { prefix, groups };
}

function changelogBodyGroupOrder(title: string): number {
  const normalizedTitle = title.toLowerCase();
  const index = CHANGELOG_GROUP_ORDER.findIndex(
    (type) => GROUP_LABELS[type].toLowerCase() === normalizedTitle,
  );
  return index === -1 ? CHANGELOG_GROUP_ORDER.length : index;
}

function normalizeChangelogBody(body: string): string {
  const { prefix, groups } = splitChangelogBodyGroups(body);
  if (groups.length < 2) return body.trim();

  const uniqueGroups = new Map<string, ChangelogBodyGroup>();
  for (const group of groups) {
    const key = group.title.toLowerCase();
    const current = uniqueGroups.get(key);
    const headingComments = current
      ? [
          ...current.headingComments,
          ...group.headingComments.filter(
            (comment) => !current.headingComments.includes(comment),
          ),
        ]
      : group.headingComments;
    uniqueGroups.set(key, {
      title: current?.title ?? group.title,
      headingComments,
      body: [current?.body, group.body].filter(Boolean).join("\n"),
      index: current?.index ?? group.index,
    });
  }

  const renderedGroups = [...uniqueGroups.values()]
    .sort(
      (a, b) =>
        changelogBodyGroupOrder(a.title) - changelogBodyGroupOrder(b.title) ||
        a.index - b.index,
    )
    .map(
      (group) =>
        `### ${group.title}${group.headingComments.length ? ` ${group.headingComments.join(" ")}` : ""}\n\n${group.body}`,
    );
  return [prefix, ...renderedGroups].filter(Boolean).join("\n\n");
}

function mergeChangelogBodies(
  pendingBody: string,
  existingBody: string,
): string {
  const pending = splitChangelogBodyGroups(pendingBody);
  const existing = splitChangelogBodyGroups(existingBody);
  if (pending.groups.length === 0) {
    return normalizeChangelogBody(existingBody);
  }
  if (existing.groups.length === 0) {
    return [pendingBody, existingBody]
      .map((body) => body.trim())
      .filter(Boolean)
      .join("\n\n");
  }

  const groups = new Map<string, ChangelogBodyGroup>();
  for (const group of [...pending.groups, ...existing.groups]) {
    const key = group.title.toLowerCase();
    const current = groups.get(key);
    const headingComments = current
      ? [
          ...current.headingComments,
          ...group.headingComments.filter(
            (comment) => !current.headingComments.includes(comment),
          ),
        ]
      : group.headingComments;
    groups.set(key, {
      title: current?.title ?? group.title,
      headingComments,
      body: [current?.body, group.body].filter(Boolean).join("\n"),
      index: current?.index ?? group.index,
    });
  }

  const prefix = [pending.prefix, existing.prefix].filter(Boolean).join("\n\n");
  return normalizeChangelogBody(
    [
      prefix,
      ...[...groups.values()].map(
        (group) =>
          `### ${group.title}${group.headingComments.length ? ` ${group.headingComments.join(" ")}` : ""}\n\n${group.body}`,
      ),
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

/**
 * Render an app-facing changelog that includes both released CHANGELOG.md
 * sections and adjacent folder-backed `changelog/*.md` entries. This is pure
 * and non-destructive, so build/dev bundles can show current product notes
 * without moving or deleting the conflict-free entry files.
 */
export function mergePendingChangelog(
  existing: string,
  pending: PendingChangelogEntry[],
): string {
  const cleanExisting = stripChangelogArchiveNotes(existing);
  const existingEntries = parseChangelog(cleanExisting);
  const pendingSeen = new Set<string>();
  const pendingWithText = pending.filter((entry) => {
    const text = entry.text.trim();
    if (!text) return false;
    const pendingKey = [
      entry.date ?? "",
      entry.type,
      normalizedChangelogText(text),
    ].join("\u0000");
    if (pendingSeen.has(pendingKey)) return false;
    pendingSeen.add(pendingKey);
    return !existingEntries.some((existingEntry) => {
      if (
        entry.date &&
        existingEntry.date &&
        entry.date !== existingEntry.date
      ) {
        return false;
      }
      return normalizedChangelogText(existingEntry.body).includes(
        normalizedChangelogText(text),
      );
    });
  });
  if (pendingWithText.length === 0) {
    const sections = existingEntries
      .map(
        (entry) =>
          `## ${entry.title}\n\n${normalizeChangelogBody(cleanChangelogBody(entry.body))}`,
      )
      .join("\n\n");
    return `${changelogHeader(cleanExisting)}${sections ? `\n\n${sections}` : ""}\n\n${CHANGELOG_ARCHIVE_NOTE}\n`;
  }

  const pendingByTitle = new Map<string, PendingChangelogEntry[]>();

  for (const entry of pendingWithText) {
    const title = pendingSectionTitle(entry);
    pendingByTitle.set(title, [...(pendingByTitle.get(title) ?? []), entry]);
  }

  const sections = existingEntries.map((entry) => ({
    title: entry.title,
    date: entry.date,
    body: normalizeChangelogBody(cleanChangelogBody(entry.body)),
  }));
  for (const title of [...pendingByTitle.keys()].sort(pendingSectionSort)) {
    const body = renderReleaseBody(pendingByTitle.get(title) ?? []);
    if (!body) continue;

    const existingIndex = sections.findIndex((entry) => {
      return entry.date === title || entry.title === title;
    });

    if (existingIndex !== -1) {
      sections[existingIndex].body = mergeChangelogBodies(
        body,
        cleanChangelogBody(sections[existingIndex].body),
      );
      continue;
    }

    const newSection = { title, date: title.match(ISO_DATE)?.[1], body };
    const insertAt = newSection.date
      ? sections.findIndex(
          (entry) => entry.date && entry.date < newSection.date!,
        )
      : 0;
    sections.splice(
      insertAt === -1 ? sections.length : insertAt,
      0,
      newSection,
    );
  }

  return `${changelogHeader(cleanExisting)}\n\n${sections
    .map((entry) => `## ${entry.title}\n\n${cleanChangelogBody(entry.body)}`)
    .join("\n\n")}\n\n${CHANGELOG_ARCHIVE_NOTE}\n`;
}

/**
 * Keep a bounded, human-readable release window in `CHANGELOG.md` while the
 * dated `changelog/*.md` files remain the complete source for app history.
 * The Vite raw-import path can still expand the full folder-backed history.
 */
export function compactChangelog(
  existing: string,
  folderEntries: PendingChangelogEntry[],
  releaseLimit = DEFAULT_CHANGELOG_RELEASE_LIMIT,
): string {
  const merged = mergePendingChangelog(existing, folderEntries);
  const cleanMerged = stripChangelogArchiveNotes(merged);
  const entries = parseChangelog(cleanMerged).slice(
    0,
    Math.max(1, releaseLimit),
  );
  const header = changelogHeader(cleanMerged)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const sections = entries.map((entry) => `## ${entry.title}\n\n${entry.body}`);

  if (sections.length === 0) {
    return `${header || CHANGELOG_HEADER.trim()}\n\n${CHANGELOG_ARCHIVE_NOTE}\n`;
  }

  return `${header || CHANGELOG_HEADER.trim()}\n\n${sections.join("\n\n")}\n\n${CHANGELOG_ARCHIVE_NOTE}\n`;
}

export { CHANGELOG_HEADER, GROUP_LABELS };
