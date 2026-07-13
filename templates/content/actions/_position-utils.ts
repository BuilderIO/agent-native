// Serializes "read MAX(position) among siblings, then insert/update at
// MAX+1" sequences so two concurrent writers (agent + human, two browser
// tabs, an import job racing a manual add) never read the same MAX and
// persist duplicate `position` values. `position` columns in this app have
// no unique/sequence constraint (see templates/content/server/db/schema.ts),
// so ordering is only as stable as the read-then-insert stays atomic.
//
// Mirrors the per-deck lock in templates/slides/actions/patch-deck.ts: an
// in-process, globalThis-keyed promise chain per scope key. This only
// serializes writers within THIS process, but that is sufficient here
// because every write path already goes through the app's own action/route
// layer in the same server process — it is not a substitute for a DB-level
// unique constraint, but it closes the read-then-write race that produces
// duplicate positions today.
//
// Sites that already compute MAX(position) and insert inside the SAME
// `db.transaction()` (e.g. submit-content-database-form.ts,
// add-content-database-source-field-property.ts) do not need this helper —
// wrap new sites in the lock instead of introducing a second mechanism.

const LOCK_KEY = "__contentPositionLocks" as const;
type GlobalWithLocks = typeof globalThis & {
  [LOCK_KEY]?: Map<string, Promise<unknown>>;
};
const globalRef = globalThis as GlobalWithLocks;
if (!globalRef[LOCK_KEY]) {
  globalRef[LOCK_KEY] = new Map<string, Promise<unknown>>();
}
const positionLocks: Map<string, Promise<unknown>> = globalRef[LOCK_KEY]!;

/** Run `fn` serialized against any other call using the same `scopeKey`. */
export function withPositionLock<T>(
  scopeKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = positionLocks.get(scopeKey) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  positionLocks.set(scopeKey, next);
  next
    .finally(() => {
      if (positionLocks.get(scopeKey) === next) positionLocks.delete(scopeKey);
    })
    .catch(() => {});
  return next;
}

/**
 * Lock scope for `documents.position` siblings under one owner + parent
 * (or one owner's root level when `parentId` is null/undefined). Every call
 * site that computes MAX(position) over `documents` scoped by
 * (ownerEmail, parentId) should share this key so concurrent inserts under
 * the same parent — regardless of which action/route triggers them — are
 * serialized against each other.
 */
export function documentsPositionScope(
  ownerEmail: string,
  parentId: string | null | undefined,
): string {
  return `documents:${ownerEmail}:${parentId ?? "root"}`;
}

/**
 * Lock scope for `content_database_items.position` rows within one
 * database.
 */
export function databaseItemsPositionScope(databaseId: string): string {
  return `contentDatabaseItems:${databaseId}`;
}

/**
 * Lock scope for `document_property_definitions.position` rows within one
 * database.
 */
export function propertyDefinitionsPositionScope(databaseId: string): string {
  return `documentPropertyDefinitions:${databaseId}`;
}
