/**
 * Bounded sessionStorage copies of successful SQL query results, so a page
 * reload can show the last rows immediately while ONE normal query refreshes
 * them. sessionStorage is a cache, never a source of truth: every read is
 * validated, every failure is a typed status, and the caller falls back to a
 * normal fetch on anything but `hit`.
 *
 * The caller passes the fully serialized query key (it already carries the
 * source, resolved SQL, dashboard and auth scope) plus the validated account
 * scope. Entries are found only by that exact pair; nothing is read across
 * scopes and nothing is stored for a loading or anonymous session.
 *
 * Storage keys are `an-sql-snapshot/v1/<storedAt>/<scope>/<key>` where scope
 * and key are 106-bit fingerprints, so listing and eviction never parse a
 * value and the SQL text is never written to storage. The account scope is
 * also stored verbatim and compared exactly on read; the fingerprints only
 * pick candidates.
 */

export const SQL_QUERY_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SQL_QUERY_SNAPSHOT_MAX_ENTRIES = 48;
/** Serialized length in string code units, not UTF-8 bytes. */
export const SQL_QUERY_SNAPSHOT_MAX_ENTRY_LENGTH = 128 * 1024;
export const SQL_QUERY_SNAPSHOT_MAX_TOTAL_LENGTH = 2 * 1024 * 1024;

const KEY_PREFIX = "an-sql-snapshot/";
const KEY_PATTERN =
  /^an-sql-snapshot\/v1\/([0-9a-z]{1,12})\/([0-9a-f]{28})\/([0-9a-f]{28})$/;
const ENVELOPE_VERSION = 1;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_QUERY_KEY_LENGTH = 100_000;
// Every JSON value costs at least two serialized characters, so a result with
// more nodes than this cannot fit the per-entry bound; stop walking early.
const MAX_RESULT_NODES = SQL_QUERY_SNAPSHOT_MAX_ENTRY_LENGTH / 2;
const MAX_RESULT_DEPTH = 32;
const ACCOUNT_SCOPE_PATTERN = /^[^:\s]{1,128}:[^:\s]{1,128}$/;
const RESERVED_SCOPES = new Set(["session-loading"]);

export interface SqlQuerySnapshotResult {
  rows: Record<string, unknown>[];
  schema?: { name: string; type: string }[];
  cached?: boolean;
  providerCacheHit?: boolean;
  /**
   * `true` marks rows cut short by a server cap; such a result is never
   * stored, so a restored snapshot is always the complete result.
   */
  truncated?: boolean;
  /** ISO timestamp of the original fetch, independent of when it was stored. */
  fetchedAt?: string;
}

/** `SqlQueryResult` fits here; only the fields above are ever persisted. */
export type SqlQuerySnapshotInput = SqlQuerySnapshotResult & { error?: string };

export interface SqlQuerySnapshot {
  result: SqlQuerySnapshotResult;
  /** Epoch ms when this copy was written; separate from `result.fetchedAt`. */
  storedAt: number;
}

export type SqlQuerySnapshotStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

export type SqlQuerySnapshotUnavailableReason =
  | "no-storage"
  | "storage-error"
  | "quota-exceeded"
  | "invalid-account-scope"
  | "invalid-query-key";

export type SqlQuerySnapshotMissReason =
  | "absent"
  | "expired"
  | "future-dated"
  | "corrupt"
  | "oversized"
  | "truncated"
  | "unsupported-version"
  | "scope-mismatch";

export type SqlQuerySnapshotSkipReason =
  | "error-result"
  | "invalid-result"
  | "invalid-fetched-at"
  | "stale"
  | "truncated"
  | "too-large";

export type SqlQuerySnapshotRead =
  | { status: "hit"; snapshot: SqlQuerySnapshot }
  | { status: "miss"; reason: SqlQuerySnapshotMissReason }
  | {
      status: "unavailable";
      reason: SqlQuerySnapshotUnavailableReason;
      errorName?: string;
    };

export type SqlQuerySnapshotWrite =
  | { status: "written"; storedAt: number; length: number; evicted: number }
  | { status: "skipped"; reason: SqlQuerySnapshotSkipReason }
  | {
      status: "unavailable";
      reason: SqlQuerySnapshotUnavailableReason;
      errorName?: string;
    };

export type SqlQuerySnapshotClear =
  | { status: "cleared"; removed: number }
  | {
      status: "unavailable";
      reason: SqlQuerySnapshotUnavailableReason;
      errorName?: string;
    };

type StorageOptions = {
  /** Test seam; defaults to `window.sessionStorage`. */
  storage?: SqlQuerySnapshotStorage;
  now?: number;
};

type Identity = { accountScope: string; scopeId: string; keyId: string };

type EntryName = {
  name: string;
  storedAt: number;
  scopeId: string;
  keyId: string;
};

type Unavailable = {
  status: "unavailable";
  reason: SqlQuerySnapshotUnavailableReason;
  errorName?: string;
};

export function readSqlQuerySnapshot(
  options: StorageOptions & { accountScope: string; queryKey: string },
): SqlQuerySnapshotRead {
  const identity = resolveIdentity(options.accountScope, options.queryKey);
  if ("status" in identity) return identity;
  const storage = resolveStorage(options.storage);
  if ("status" in storage) return storage;
  const now = options.now ?? Date.now();

  try {
    const candidates = listEntries(storage).entries.filter(
      (entry) =>
        entry.scopeId === identity.scopeId && entry.keyId === identity.keyId,
    );
    if (candidates.length === 0) return { status: "miss", reason: "absent" };
    const newest = candidates.reduce((a, b) =>
      b.storedAt > a.storedAt ? b : a,
    );

    const drop = (reason: SqlQuerySnapshotMissReason): SqlQuerySnapshotRead => {
      storage.removeItem(newest.name);
      return { status: "miss", reason };
    };
    const nameAge = now - newest.storedAt;
    if (nameAge < -FUTURE_SKEW_MS) return drop("future-dated");
    if (nameAge > SQL_QUERY_SNAPSHOT_MAX_AGE_MS) return drop("expired");

    const raw = storage.getItem(newest.name);
    if (raw === null) return { status: "miss", reason: "absent" };
    // Checked before parsing: a tampered entry must not cost a huge parse.
    if (raw.length > SQL_QUERY_SNAPSHOT_MAX_ENTRY_LENGTH) {
      return drop("oversized");
    }
    const parsed = parseEnvelope(raw);
    if (parsed === null) return drop("corrupt");
    if (parsed === "truncated") return drop(parsed);
    if (parsed === "unsupported-version") return drop(parsed);
    if (parsed.accountScope !== identity.accountScope) {
      return { status: "miss", reason: "scope-mismatch" };
    }
    if (
      parsed.storedAt !== newest.storedAt ||
      parsed.keyLength !== options.queryKey.length
    ) {
      return drop("corrupt");
    }
    const fetchedAtMs =
      parsed.result.fetchedAt === undefined
        ? undefined
        : Date.parse(parsed.result.fetchedAt);
    if (fetchedAtMs !== undefined) {
      if (now - fetchedAtMs < -FUTURE_SKEW_MS) return drop("future-dated");
      if (now - fetchedAtMs > SQL_QUERY_SNAPSHOT_MAX_AGE_MS) {
        return drop("expired");
      }
    }
    return {
      status: "hit",
      snapshot: { result: parsed.result, storedAt: parsed.storedAt },
    };
  } catch (error) {
    return storageFailure(error);
  }
}

export function writeSqlQuerySnapshot(
  options: StorageOptions & {
    accountScope: string;
    queryKey: string;
    result: SqlQuerySnapshotInput;
  },
): SqlQuerySnapshotWrite {
  const identity = resolveIdentity(options.accountScope, options.queryKey);
  if ("status" in identity) return identity;
  const storage = resolveStorage(options.storage);
  if ("status" in storage) return storage;
  const now = options.now ?? Date.now();

  try {
    const { entries, malformed } = listEntries(storage);
    for (const name of malformed) {
      storage.removeItem(name);
    }
    const survivors: EntryName[] = [];
    for (const entry of entries) {
      const sameIdentity =
        entry.scopeId === identity.scopeId && entry.keyId === identity.keyId;
      const age = now - entry.storedAt;
      if (
        sameIdentity ||
        age > SQL_QUERY_SNAPSHOT_MAX_AGE_MS ||
        age < -FUTURE_SKEW_MS
      ) {
        storage.removeItem(entry.name);
      } else {
        survivors.push(entry);
      }
    }

    // Any write attempt supersedes the previous copy, including a skipped
    // one: after a reload it would show rows older than the latest fetch.
    const prepared = prepareResult(options.result, now);
    if ("skipped" in prepared) {
      return { status: "skipped", reason: prepared.skipped };
    }
    const value = JSON.stringify({
      v: ENVELOPE_VERSION,
      scope: identity.accountScope,
      keyLength: options.queryKey.length,
      storedAt: now,
      result: prepared.result,
    });
    if (value.length > SQL_QUERY_SNAPSHOT_MAX_ENTRY_LENGTH) {
      return { status: "skipped", reason: "too-large" };
    }

    const name = entryName(now, identity);
    const sized = survivors
      .map((entry) => ({
        entry,
        length: entry.name.length + (storage.getItem(entry.name)?.length ?? 0),
      }))
      .sort(
        (a, b) =>
          a.entry.storedAt - b.entry.storedAt ||
          a.entry.name.localeCompare(b.entry.name),
      );
    let total = sized.reduce((sum, item) => sum + item.length, 0);
    const length = name.length + value.length;
    let evicted = 0;
    const evictOldest = (): boolean => {
      const oldest = sized.shift();
      if (!oldest) return false;
      storage.removeItem(oldest.entry.name);
      total -= oldest.length;
      evicted += 1;
      return true;
    };
    while (
      sized.length >= SQL_QUERY_SNAPSHOT_MAX_ENTRIES ||
      total + length > SQL_QUERY_SNAPSHOT_MAX_TOTAL_LENGTH
    ) {
      if (!evictOldest()) break;
    }

    for (;;) {
      try {
        storage.setItem(name, value);
        return { status: "written", storedAt: now, length, evicted };
      } catch (error) {
        if (!isQuotaError(error)) throw error;
        if (!evictOldest()) {
          return {
            status: "unavailable",
            reason: "quota-exceeded",
            errorName: errorName(error),
          };
        }
      }
    }
  } catch (error) {
    return storageFailure(error);
  }
}

/**
 * Drops snapshots for logout or an account/org switch. With
 * `exceptAccountScope` it keeps only that scope's entries; without a valid
 * scope to keep it clears everything.
 */
export function clearSqlQuerySnapshots(
  options: Pick<StorageOptions, "storage"> & {
    exceptAccountScope?: string;
  } = {},
): SqlQuerySnapshotClear {
  const storage = resolveStorage(options.storage);
  if ("status" in storage) return storage;
  const keepScopeId =
    options.exceptAccountScope !== undefined &&
    isValidAccountScope(options.exceptAccountScope)
      ? fingerprint(options.exceptAccountScope)
      : null;

  try {
    const { entries, malformed } = listEntries(storage);
    let removed = 0;
    for (const name of malformed) {
      storage.removeItem(name);
      removed += 1;
    }
    for (const entry of entries) {
      if (entry.scopeId === keepScopeId) continue;
      storage.removeItem(entry.name);
      removed += 1;
    }
    return { status: "cleared", removed };
  } catch (error) {
    return storageFailure(error);
  }
}

function resolveIdentity(
  accountScope: string,
  queryKey: string,
): Identity | Unavailable {
  if (!isValidAccountScope(accountScope)) {
    return { status: "unavailable", reason: "invalid-account-scope" };
  }
  if (
    typeof queryKey !== "string" ||
    queryKey.length === 0 ||
    queryKey.length > MAX_QUERY_KEY_LENGTH
  ) {
    return { status: "unavailable", reason: "invalid-query-key" };
  }
  return {
    accountScope,
    scopeId: fingerprint(accountScope),
    keyId: fingerprint(queryKey),
  };
}

/**
 * Accepts only the `user:org` shape `dashboardCacheScope` produces for an
 * authenticated session. The loading placeholder and the anonymous principal
 * are rejected so they can never name a snapshot.
 */
function isValidAccountScope(accountScope: unknown): accountScope is string {
  if (typeof accountScope !== "string") return false;
  if (RESERVED_SCOPES.has(accountScope)) return false;
  if (!ACCOUNT_SCOPE_PATTERN.test(accountScope)) return false;
  return !accountScope.startsWith("anonymous:");
}

function resolveStorage(
  storage: SqlQuerySnapshotStorage | undefined,
): SqlQuerySnapshotStorage | Unavailable {
  if (storage) return storage;
  try {
    if (typeof window === "undefined") {
      return { status: "unavailable", reason: "no-storage" };
    }
    // Reading `sessionStorage` itself throws when storage is blocked.
    const sessionStorage = window.sessionStorage;
    return sessionStorage
      ? sessionStorage
      : { status: "unavailable", reason: "no-storage" };
  } catch (error) {
    return storageFailure(error);
  }
}

function storageFailure(error: unknown): Unavailable {
  return {
    status: "unavailable",
    reason: "storage-error",
    errorName: errorName(error),
  };
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    code === 22 ||
    code === 1014
  );
}

function listEntries(storage: SqlQuerySnapshotStorage): {
  entries: EntryName[];
  malformed: string[];
} {
  const names: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const name = storage.key(index);
    if (name !== null && name.startsWith(KEY_PREFIX)) names.push(name);
  }
  const entries: EntryName[] = [];
  const malformed: string[] = [];
  for (const name of names) {
    const match = KEY_PATTERN.exec(name);
    const storedAt = match ? Number.parseInt(match[1], 36) : Number.NaN;
    if (!match || !Number.isSafeInteger(storedAt)) {
      malformed.push(name);
      continue;
    }
    entries.push({ name, storedAt, scopeId: match[2], keyId: match[3] });
  }
  return { entries, malformed };
}

function entryName(storedAt: number, identity: Identity): string {
  return `${KEY_PREFIX}v1/${storedAt.toString(36)}/${identity.scopeId}/${identity.keyId}`;
}

/** Two independent 53-bit hashes; collisions are not an attack surface here. */
function fingerprint(input: string): string {
  return `${cyrb53(input, 0)}${cyrb53(input, 0x9e3779b9)}`;
}

function cyrb53(input: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, "0");
}

function prepareResult(
  input: SqlQuerySnapshotInput,
  now: number,
):
  | { result: SqlQuerySnapshotResult }
  | { skipped: SqlQuerySnapshotSkipReason } {
  if (!isPlainObject(input)) return { skipped: "invalid-result" };
  // Each field is read once so the checked value is the stored value.
  const {
    error,
    rows,
    schema,
    cached,
    providerCacheHit,
    truncated,
    fetchedAt,
  } = input;
  if (error !== undefined && error !== "") return { skipped: "error-result" };
  if (truncated !== undefined && typeof truncated !== "boolean") {
    return { skipped: "invalid-result" };
  }
  if (truncated === true) return { skipped: "truncated" };
  const budget = { nodes: 0 };
  const rowsVerdict = checkJson(rows, budget, 0);
  if (rowsVerdict === "too-large") return { skipped: "too-large" };
  if (rowsVerdict === "invalid" || !isRowArray(rows)) {
    return { skipped: "invalid-result" };
  }
  if (schema !== undefined) {
    const schemaVerdict = checkJson(schema, budget, 0);
    if (schemaVerdict === "too-large") return { skipped: "too-large" };
    if (schemaVerdict === "invalid" || !isSchema(schema)) {
      return { skipped: "invalid-result" };
    }
  }
  if (
    (cached !== undefined && typeof cached !== "boolean") ||
    (providerCacheHit !== undefined && typeof providerCacheHit !== "boolean")
  ) {
    return { skipped: "invalid-result" };
  }
  if (fetchedAt !== undefined) {
    const fetchedAtMs =
      typeof fetchedAt === "string" ? Date.parse(fetchedAt) : NaN;
    if (!Number.isFinite(fetchedAtMs) || fetchedAtMs - now > FUTURE_SKEW_MS) {
      return { skipped: "invalid-fetched-at" };
    }
    if (now - fetchedAtMs > SQL_QUERY_SNAPSHOT_MAX_AGE_MS) {
      return { skipped: "stale" };
    }
  }
  const result: SqlQuerySnapshotResult = { rows };
  if (schema !== undefined) result.schema = schema;
  if (cached !== undefined) result.cached = cached;
  if (providerCacheHit !== undefined)
    result.providerCacheHit = providerCacheHit;
  if (truncated !== undefined) result.truncated = truncated;
  if (fetchedAt !== undefined) result.fetchedAt = fetchedAt;
  return { result };
}

/**
 * Walks a value that must survive `JSON.stringify` unchanged. `undefined`,
 * non-finite numbers, bigint, dates, class instances, sparse holes and
 * accessors would be rewritten, dropped or re-evaluated by serialization,
 * which would restore different rows than were shown.
 *
 * The walk is in place and charges the node budget before each member is
 * touched, so a wide or hostile value fails after at most `MAX_RESULT_NODES`
 * reads and never has a getter invoked.
 */
function checkJson(
  value: unknown,
  budget: { nodes: number },
  depth: number,
): "ok" | "invalid" | "too-large" {
  budget.nodes += 1;
  if (budget.nodes > MAX_RESULT_NODES) return "too-large";
  if (depth > MAX_RESULT_DEPTH) return "invalid";
  if (value === null) return "ok";
  switch (typeof value) {
    case "string":
    case "boolean":
      return "ok";
    case "number":
      return Number.isFinite(value) ? "ok" : "invalid";
    case "object":
      break;
    default:
      return "invalid";
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_RESULT_NODES - budget.nodes) return "too-large";
    for (let index = 0; index < value.length; index += 1) {
      const verdict = checkMember(value, String(index), true, budget, depth);
      if (verdict !== "ok") return verdict;
    }
    return "ok";
  }
  if (!isPlainObject(value)) return "invalid";
  for (const key in value) {
    if (budget.nodes >= MAX_RESULT_NODES) return "too-large";
    const verdict = checkMember(value, key, false, budget, depth);
    if (verdict !== "ok") return verdict;
  }
  return "ok";
}

function checkMember(
  owner: object,
  key: string,
  required: boolean,
  budget: { nodes: number },
  depth: number,
): "ok" | "invalid" | "too-large" {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  // An inherited enumerable key is not serialized; a hole or accessor is
  // invalid because serialization would not reproduce it.
  if (!descriptor) return required ? "invalid" : "ok";
  if (!("value" in descriptor)) return "invalid";
  return checkJson(descriptor.value, budget, depth + 1);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRowArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isPlainObject);
}

function isSchema(value: unknown): value is { name: string; type: string }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (column) =>
        isPlainObject(column) &&
        typeof column.name === "string" &&
        typeof column.type === "string",
    )
  );
}

function parseEnvelope(raw: string):
  | {
      accountScope: string;
      keyLength: number;
      storedAt: number;
      result: SqlQuerySnapshotResult;
    }
  | "unsupported-version"
  | "truncated"
  | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // coercion-ok: null is the typed "unreadable" value; the caller drops the entry as corrupt, never serves it
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const { v, scope, keyLength, storedAt, result } = parsed;
  if (typeof v !== "number") return null;
  // Other versions may change every other field, so read nothing else.
  if (v !== ENVELOPE_VERSION) return "unsupported-version";
  if (
    typeof scope !== "string" ||
    typeof keyLength !== "number" ||
    typeof storedAt !== "number" ||
    !Number.isSafeInteger(storedAt) ||
    !isPlainObject(result) ||
    !isRowArray(result.rows)
  ) {
    return null;
  }
  const clean: SqlQuerySnapshotResult = { rows: result.rows };
  if (result.schema !== undefined) {
    if (!isSchema(result.schema)) return null;
    clean.schema = result.schema;
  }
  // Truncated rows are never written; one found here was altered or came
  // from code that did not know about the flag, and is not a complete result.
  if (result.truncated !== undefined) {
    if (typeof result.truncated !== "boolean") return null;
    if (result.truncated) return "truncated";
    clean.truncated = false;
  }
  for (const flag of ["cached", "providerCacheHit"] as const) {
    if (result[flag] !== undefined) {
      if (typeof result[flag] !== "boolean") return null;
      clean[flag] = result[flag];
    }
  }
  if (result.fetchedAt !== undefined) {
    if (
      typeof result.fetchedAt !== "string" ||
      !Number.isFinite(Date.parse(result.fetchedAt))
    ) {
      return null;
    }
    clean.fetchedAt = result.fetchedAt;
  }
  if (result.error !== undefined) return null;
  return {
    accountScope: scope,
    keyLength,
    storedAt,
    result: clean,
  };
}
