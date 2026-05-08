export function normalizeMailLabel(value: string): string {
  return value.trim().replace(/_/g, " ").toLowerCase();
}

export function shortMailLabel(value: string): string {
  const normalized = normalizeMailLabel(value);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

export function mailLabelMatches(candidate: string, target: string): boolean {
  const normalizedCandidate = normalizeMailLabel(candidate);
  const normalizedTarget = normalizeMailLabel(target);
  return (
    normalizedCandidate === normalizedTarget ||
    shortMailLabel(normalizedCandidate) === normalizedTarget ||
    normalizedCandidate === shortMailLabel(normalizedTarget)
  );
}

const INBOX_SCOPED_APP_LABEL_IDS = new Set([
  "important",
  "note-to-self",
  "personal",
  "social",
  "updates",
  "promotions",
  "forums",
]);

export function isInboxScopedAppLabel(
  label: string | null | undefined,
): boolean {
  if (!label) return false;
  return INBOX_SCOPED_APP_LABEL_IDS.has(normalizeMailLabel(label));
}
