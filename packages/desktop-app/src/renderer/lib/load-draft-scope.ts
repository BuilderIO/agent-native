import { getComposerDraftKey } from "@agent-native/toolkit/composer/draft-key";

// The composer persists drafts per scope, and the account is not part of it.
// A scope unique to this renderer load means a window opened later can never
// read this one's draft, so a draft cannot cross an account switch.
export function createLoadDraftScope(
  prefix: string,
  legacyScopes: readonly string[] = [],
): string {
  const scope = `${prefix}${crypto.randomUUID()}`;
  removeEarlierLoadDrafts(prefix, scope, legacyScopes);
  return scope;
}

// Nothing else in this renderer's origin writes the bare draft key, so it is
// safe to drop alongside the drafts of earlier loads and any fixed-key scopes
// the caller used before it moved to per-load scopes.
function removeEarlierLoadDrafts(
  prefix: string,
  currentScope: string,
  legacyScopes: readonly string[],
) {
  try {
    const keep = getComposerDraftKey(currentScope);
    const earlierPrefix = getComposerDraftKey(prefix);
    const fixed = new Set([
      getComposerDraftKey(),
      ...legacyScopes.map((scope) => getComposerDraftKey(scope)),
    ]);
    const stale: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === null || key === keep) continue;
      if (fixed.has(key) || key.startsWith(earlierPrefix)) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {
    // coercion-ok: With no usable storage the composer cannot persist a draft either.
  }
}
