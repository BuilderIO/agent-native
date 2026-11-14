/** The newest save number applied to a file, kept per editing session. */
export type AppliedOperationRevisions = Record<string, number>;

/** The newest sessions kept per file; older receipts are dropped first. */
export const MAX_APPLIED_OPERATION_SOURCES = 128;

/**
 * Null when the stored map cannot be read, so a caller can tell damage from a
 * file that simply has no receipts yet (an empty map).
 */
export function parseAppliedOperationRevisions(
  raw: string | null | undefined,
): AppliedOperationRevisions | null {
  if (raw == null || raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    // coercion-ok: damage returns null, which callers handle apart from an empty map.
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const revisions: AppliedOperationRevisions = {};
  for (const [source, revision] of Object.entries(parsed)) {
    if (
      typeof revision !== "number" ||
      !Number.isSafeInteger(revision) ||
      revision < 0
    ) {
      return null;
    }
    revisions[source] = revision;
  }
  return revisions;
}

/** Whether a save this session numbered `revision` was already applied, even if someone wrote after it. */
export function isOperationApplied(
  revisions: AppliedOperationRevisions,
  source: string,
  revision: number,
): boolean {
  return (revisions[source] ?? 0) >= revision;
}

/**
 * The file's scalar columns hold the last versioned writer's receipt and are
 * overwritten by the next write, so that receipt moves into the map first. A
 * row from before the map existed has only the scalar. Returns the map it was
 * given when it already holds the receipt, so a caller can tell nothing changed.
 */
export function withLegacyOperationReceipt(
  revisions: AppliedOperationRevisions,
  source: string | null | undefined,
  revision: number | null | undefined,
): AppliedOperationRevisions {
  if (
    typeof source !== "string" ||
    source === "" ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    isOperationApplied(revisions, source, revision)
  ) {
    return revisions;
  }
  return withAppliedOperationRevision(revisions, source, revision);
}

export function withAppliedOperationRevision(
  revisions: AppliedOperationRevisions,
  source: string,
  revision: number,
): AppliedOperationRevisions {
  const next = { ...revisions };
  const newest = Math.max(next[source] ?? 0, revision);
  // Re-inserting moves the session to the end, so the oldest is dropped first.
  delete next[source];
  next[source] = newest;
  for (const oldest of Object.keys(next)) {
    if (Object.keys(next).length <= MAX_APPLIED_OPERATION_SOURCES) break;
    delete next[oldest];
  }
  return next;
}
