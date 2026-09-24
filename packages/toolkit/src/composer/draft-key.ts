const BASE_COMPOSER_DRAFT_KEY = "an-composer-draft";

export function getComposerDraftKey(scope?: string | null): string {
  const trimmed = scope?.trim();
  if (!trimmed) return BASE_COMPOSER_DRAFT_KEY;
  return `${BASE_COMPOSER_DRAFT_KEY}:${encodeURIComponent(trimmed)}`;
}
