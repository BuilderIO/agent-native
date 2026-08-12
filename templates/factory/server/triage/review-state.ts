export interface TriageReviewSnapshot {
  title?: string | null;
  summary?: string | null;
  sourceUrl?: string | null;
  coverage?: string | null;
  lastSeenAt?: string | null;
  headSha?: string | null;
}

/** Reopen an item only when the provider evidence changed since the last poll. */
export function hasTriageSourceChanged(
  existing: TriageReviewSnapshot | undefined,
  next: TriageReviewSnapshot,
): boolean {
  if (!existing) return true;
  return (
    (next.title !== undefined && existing.title !== next.title) ||
    (next.summary !== undefined && existing.summary !== next.summary) ||
    (next.sourceUrl !== undefined && existing.sourceUrl !== next.sourceUrl) ||
    (next.coverage !== undefined && existing.coverage !== next.coverage) ||
    (next.lastSeenAt !== undefined &&
      existing.lastSeenAt !== next.lastSeenAt) ||
    (next.headSha !== undefined && existing.headSha !== next.headSha)
  );
}

export function statusAfterTriageSourceUpdate(
  existingStatus: string | undefined,
  sourceChanged: boolean,
  reviewStatus: string,
): string {
  return sourceChanged ? reviewStatus : (existingStatus ?? reviewStatus);
}
