import type { ReviewCommentObservation } from "./pr-babysit.js";

export type BabysitThreadDisposition =
  | "required-fixed"
  | "required-not-fixing"
  | "optional-skipping"
  | "unrecognized";

export type BabysitCoverageEntry = {
  threadKey: string;
  disposition: BabysitThreadDisposition;
  detail: string;
};

const COVERAGE_LINE =
  /^Thread\s+(.+?)\s+—\s+(Required — fixed|Required — not fixing|Optional — skipping)\s*:\s*(.*)$/i;

const DISPOSITION_BY_LABEL: Record<string, BabysitThreadDisposition> = {
  "required — fixed": "required-fixed",
  "required — not fixing": "required-not-fixing",
  "optional — skipping": "optional-skipping",
};

export function parseCoverageCommentLines(
  body: string,
): BabysitCoverageEntry[] {
  const entries: BabysitCoverageEntry[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = COVERAGE_LINE.exec(line.trim());
    if (!match) continue;
    const label = match[2]?.trim().toLowerCase() ?? "";
    entries.push({
      threadKey: match[1]?.trim() ?? "",
      disposition: DISPOSITION_BY_LABEL[label] ?? "unrecognized",
      detail: match[3]?.trim() ?? "",
    });
  }
  return entries;
}

export function parseInlineDisposition(
  body: string,
): BabysitThreadDisposition | null {
  const trimmed = body.trim();
  if (/^Required — fixed\b/i.test(trimmed)) return "required-fixed";
  if (/^Required — not fixing\b/i.test(trimmed)) return "required-not-fixing";
  if (/^Optional — skipping\b/i.test(trimmed)) return "optional-skipping";
  return null;
}

function normalizeThreadKey(value: string): string {
  return value.trim().toLowerCase();
}

function threadMatchesKey(
  comment: ReviewCommentObservation,
  threadKey: string,
): boolean {
  const normalized = normalizeThreadKey(threadKey);
  if (!normalized) return false;
  if (comment.threadId && normalizeThreadKey(comment.threadId) === normalized) {
    return true;
  }
  if (comment.id === threadKey.trim()) return true;
  if (comment.path && comment.line !== undefined) {
    const pathLine = `${comment.path}:${comment.line}`;
    if (normalizeThreadKey(pathLine) === normalized) return true;
  }
  if (normalized.startsWith("#discussion_r")) {
    return comment.id.endsWith(normalized.replace("#discussion_r", ""));
  }
  return false;
}

export function coverageEntriesForThreads(
  comments: readonly ReviewCommentObservation[],
  issueCommentBodies: readonly string[],
): Map<string, BabysitCoverageEntry> {
  const byKey = new Map<string, BabysitCoverageEntry>();
  for (const body of issueCommentBodies) {
    for (const entry of parseCoverageCommentLines(body)) {
      byKey.set(normalizeThreadKey(entry.threadKey), entry);
    }
  }
  const mapped = new Map<string, BabysitCoverageEntry>();
  for (const comment of comments) {
    if (comment.inReplyToId !== null) continue;
    for (const [key, entry] of byKey.entries()) {
      if (
        threadMatchesKey(comment, key) ||
        threadMatchesKey(comment, entry.threadKey)
      ) {
        mapped.set(comment.id, entry);
      }
    }
  }
  return mapped;
}
