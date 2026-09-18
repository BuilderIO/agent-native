export function normalizeMailLabel(value: string): string {
  // Gmail's search UI encodes a label's spaces as hyphens in `label:` query
  // tokens (e.g. "Automated Notifications" -> `label:automated-notifications`).
  // Folding both `_` and `-` to spaces here means a query token and a stored
  // label id compare equal regardless of which separator either side used.
  return value.trim().replace(/[_-]/g, " ").toLowerCase();
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

export function mailLabelsInclude(
  candidates: readonly string[],
  target: string,
): boolean {
  return candidates.some((candidate) => mailLabelMatches(candidate, target));
}

export function mailLabelsIncludeAny(
  candidates: readonly string[],
  targets: readonly string[],
): boolean {
  return targets.some((target) => mailLabelsInclude(candidates, target));
}

// Pre-normalized (normalizeMailLabel folds "-" to " ") since this set is
// checked against a normalized value below.
const INBOX_SCOPED_APP_LABEL_IDS = new Set([
  "important",
  "note to self",
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
