/**
 * Keeps `search_resources` in step with registered tables by draining the
 * resource change feed. It never starts on its own: drains run before a
 * search, right after a write, and inside the recurring sweep, which are all
 * moments when the database is already awake.
 */
import { getAppConfig } from "../app-config/index.js";
import { getDbExec, type DbExec } from "../db/client.js";
import {
  claimResourceChanges,
  completeResourceChanges,
  enqueueAllResourceChanges,
  failResourceChanges,
  hasPendingResourceChanges,
  resourceChangeCaptureInstalled,
  subscribeResourceChangeConsumer,
  type ClaimedResourceChange,
  type ResourceChangeFeed,
} from "../resource-changes/store.js";
import {
  SEARCH_INDEX_STATE_TABLE,
  SEARCH_RESOURCES_TABLE,
} from "./index-store.js";
import {
  SEARCH_CHANGE_CONSUMER,
  listSearchableResources,
  searchableResourceSource,
  type SearchableResourceDocument,
  type SearchableResourceRegistration,
} from "./registry.js";
import { buildSearchVector, normalizeSearchText } from "./tokenize.js";

const CLAIM_BATCH = 50;
const MAX_WRITE_BYTES = 1_500_000;
const REBUILD_ENQUEUE_RETRY_MS = 120_000;
const CAPTURE_RECHECK_MS = 60_000;

export type SearchIndexNotReadyReason =
  | "capture-missing"
  | "rebuilding"
  | "backlog"
  | "outdated-registration"
  | "unavailable";

export interface SearchIndexStatus {
  ready: boolean;
  reason?: SearchIndexNotReadyReason;
}

interface IndexState {
  targetVersion: number;
  indexVersion: number | null;
  rebuildHighSeq: string | null;
  rebuildStartedAt: number | null;
  rebuildCompleted: boolean;
}

interface RegistrationRuntime {
  captureVerifiedAt?: number;
  captureInstalled?: boolean;
  readyVersion?: number;
  inFlight?: Promise<SearchIndexStatus>;
}

const runtimes = new Map<string, RegistrationRuntime>();

function runtimeFor(registration: SearchableResourceRegistration) {
  const key = `${registration.app}:${registration.type}`;
  let runtime = runtimes.get(key);
  if (!runtime) {
    runtime = {};
    runtimes.set(key, runtime);
  }
  return runtime;
}

/** Forgets per-process memos. Tests use it between databases. */
export function resetSearchIndexRuntime(): void {
  runtimes.clear();
}

function feedFor(
  registration: SearchableResourceRegistration,
): ResourceChangeFeed {
  return {
    consumer: SEARCH_CHANGE_CONSUMER,
    app: registration.app,
    resourceType: registration.type,
  };
}

/**
 * Drains pending changes for one registration until `deadline` and reports
 * whether the index is complete and current, meaning a search can trust it.
 * Concurrent calls in one process share a single drain.
 */
export function drainSearchIndex(
  registration: SearchableResourceRegistration,
  deadline: number,
): Promise<SearchIndexStatus> {
  const runtime = runtimeFor(registration);
  if (runtime.inFlight) return runtime.inFlight;
  const run = drain(registration, runtime, deadline).finally(() => {
    if (runtime.inFlight === run) runtime.inFlight = undefined;
  });
  runtime.inFlight = run;
  return run;
}

function configuredBudgetMs(): number {
  const budget = getAppConfig().runtime.searchDrainBudgetMs;
  // Zero or less means no limit: tests and evals index everything first.
  return budget <= 0 ? Number.POSITIVE_INFINITY : budget;
}

/**
 * Call before searching. Processes pending changes within a small budget so
 * the caller sees committed writes, then reports whether the index can
 * answer. When it can't (first build, a large backlog, missing capture),
 * use the app's fallback search for this request.
 */
export async function prepareSearchIndex(
  registration: SearchableResourceRegistration,
  options: { budgetMs?: number } = {},
): Promise<SearchIndexStatus> {
  const budget = options.budgetMs ?? configuredBudgetMs();
  try {
    return await drainSearchIndex(registration, Date.now() + budget);
  } catch (error) {
    console.error(
      `[search] Preparing the ${registration.app}/${registration.type} index failed:`,
      error instanceof Error ? error.message : String(error),
    );
    return { ready: false, reason: "unavailable" };
  }
}

/** Drains every registration, in turn, until `deadline`. */
export async function drainAllSearchIndexes(deadline: number): Promise<void> {
  for (const registration of listSearchableResources()) {
    if (Date.now() >= deadline) return;
    await drainSearchIndex(registration, deadline).catch((error: unknown) => {
      console.error(
        `[search] Draining the ${registration.app}/${registration.type} index failed:`,
        error instanceof Error ? error.message : String(error),
      );
    });
  }
}

async function drain(
  registration: SearchableResourceRegistration,
  runtime: RegistrationRuntime,
  deadline: number,
): Promise<SearchIndexStatus> {
  const exec = getDbExec();
  const feed = feedFor(registration);
  if (!(await captureInstalled(exec, registration, runtime))) {
    return { ready: false, reason: "capture-missing" };
  }

  let state: IndexState | null = null;
  if (runtime.readyVersion !== registration.version) {
    state = await readState(exec, registration);
    if (state && state.targetVersion > registration.version) {
      // A newer deploy owns the index; this process serves the old path.
      return { ready: false, reason: "outdated-registration" };
    }
    state = await ensureRebuildStarted(exec, registration, state);
  }

  // Checking before claiming keeps the usual case, nothing pending, to one
  // round trip before every search.
  let pending = await hasPendingResourceChanges(exec, feed);
  while (pending && Date.now() < deadline) {
    const claimed = await claimResourceChanges(exec, feed, CLAIM_BATCH);
    if (claimed.length) await processBatch(exec, registration, feed, claimed);
    pending = await hasPendingResourceChanges(exec, feed);
    // What's left is leased by another drain.
    if (!claimed.length) break;
  }

  if (state && !state.rebuildCompleted) {
    state = await completeRebuildIfDone(exec, registration, state);
    if (!state.rebuildCompleted) return { ready: false, reason: "rebuilding" };
  }
  if (state?.rebuildCompleted && state.indexVersion === registration.version) {
    runtime.readyVersion = registration.version;
  }
  return pending ? { ready: false, reason: "backlog" } : { ready: true };
}

async function captureInstalled(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  runtime: RegistrationRuntime,
): Promise<boolean> {
  if (runtime.captureInstalled) return true;
  if (
    runtime.captureVerifiedAt !== undefined &&
    Date.now() - runtime.captureVerifiedAt < CAPTURE_RECHECK_MS
  ) {
    return false;
  }
  runtime.captureVerifiedAt = Date.now();
  const source = searchableResourceSource(registration);
  const installed = await resourceChangeCaptureInstalled(exec, source).catch(
    () => false,
  );
  if (!installed) {
    console.error(
      `[search] Change capture for ${registration.app}/${registration.type} is not installed on table "${source.table}". ` +
        "Add searchIndexMigration() for it to the app's runMigrations list. Search is using the app's fallback until it is.",
    );
    return false;
  }
  await subscribeResourceChangeConsumer(exec, source, SEARCH_CHANGE_CONSUMER);
  runtime.captureInstalled = true;
  return true;
}

async function readState(
  exec: DbExec,
  registration: SearchableResourceRegistration,
): Promise<IndexState | null> {
  const { rows } = await exec.execute({
    sql: `SELECT target_version, index_version, rebuild_high_seq::text AS rebuild_high_seq,
                 rebuild_started_at, rebuild_completed_at
          FROM ${SEARCH_INDEX_STATE_TABLE} WHERE app = ? AND resource_type = ?`,
    args: [registration.app, registration.type],
  });
  const row = rows[0];
  if (!row) return null;
  return {
    targetVersion: Number(row.target_version),
    indexVersion: row.index_version == null ? null : Number(row.index_version),
    rebuildHighSeq:
      row.rebuild_high_seq == null ? null : String(row.rebuild_high_seq),
    rebuildStartedAt: row.rebuild_started_at
      ? new Date(row.rebuild_started_at).getTime()
      : null,
    rebuildCompleted: row.rebuild_completed_at != null,
  };
}

/**
 * A registration whose version is newer than the index state starts a
 * rebuild: every source row is queued once. Only one process wins the
 * version bump; a process that died before queueing is retried later.
 */
async function ensureRebuildStarted(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  state: IndexState | null,
): Promise<IndexState> {
  if (!state || state.targetVersion < registration.version) {
    const { rows } = await exec.execute({
      sql: `INSERT INTO ${SEARCH_INDEX_STATE_TABLE} (app, resource_type, target_version, rebuild_started_at)
            VALUES (?, ?, ?, now())
            ON CONFLICT (app, resource_type) DO UPDATE SET
              target_version = EXCLUDED.target_version,
              rebuild_started_at = EXCLUDED.rebuild_started_at,
              rebuild_high_seq = NULL,
              rebuild_completed_at = NULL
            WHERE ${SEARCH_INDEX_STATE_TABLE}.target_version < EXCLUDED.target_version
            RETURNING target_version`,
      args: [registration.app, registration.type, registration.version],
    });
    if (rows.length) return queueRebuild(exec, registration, state);
    return (await readState(exec, registration))!;
  }
  if (
    !state.rebuildCompleted &&
    state.rebuildHighSeq === null &&
    (state.rebuildStartedAt ?? 0) < Date.now() - REBUILD_ENQUEUE_RETRY_MS
  ) {
    return queueRebuild(exec, registration, state);
  }
  return state;
}

async function queueRebuild(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  previous: IndexState | null,
): Promise<IndexState> {
  const highSeq = await enqueueAllResourceChanges(
    exec,
    searchableResourceSource(registration),
    SEARCH_CHANGE_CONSUMER,
    "rebuild",
  );
  await exec.execute({
    sql: `UPDATE ${SEARCH_INDEX_STATE_TABLE} SET rebuild_high_seq = ?::bigint
          WHERE app = ? AND resource_type = ? AND target_version = ?`,
    args: [highSeq, registration.app, registration.type, registration.version],
  });
  return {
    targetVersion: registration.version,
    indexVersion: previous?.indexVersion ?? null,
    rebuildHighSeq: highSeq,
    rebuildStartedAt: Date.now(),
    rebuildCompleted: false,
  };
}

async function completeRebuildIfDone(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  state: IndexState,
): Promise<IndexState> {
  if (state.rebuildHighSeq === null) return state;
  const pending = await hasPendingResourceChanges(exec, feedFor(registration), {
    atOrBelowSeq: state.rebuildHighSeq,
  });
  if (pending) return state;
  await exec.execute({
    sql: `UPDATE ${SEARCH_INDEX_STATE_TABLE}
          SET index_version = target_version, rebuild_completed_at = now()
          WHERE app = ? AND resource_type = ? AND target_version = ? AND rebuild_completed_at IS NULL`,
    args: [registration.app, registration.type, state.targetVersion],
  });
  // Rows left at an older version whose source row is gone were missed
  // deletes; drop them. Rows whose rebuild failed keep their old entry.
  const source = searchableResourceSource(registration);
  await exec.execute({
    sql: `DELETE FROM ${SEARCH_RESOURCES_TABLE} AS sr
          WHERE sr.app = ? AND sr.resource_type = ? AND sr.index_version <> ?
            AND NOT EXISTS (SELECT 1 FROM "${source.table}" AS src WHERE src."${source.idColumn}"::text = sr.resource_id)`,
    args: [registration.app, registration.type, state.targetVersion],
  });
  return {
    ...state,
    indexVersion: state.targetVersion,
    rebuildCompleted: true,
  };
}

interface IndexRow {
  change: ClaimedResourceChange;
  document: SearchableResourceDocument;
  hash: string;
}

async function processBatch(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  feed: ResourceChangeFeed,
  claimed: ClaimedResourceChange[],
): Promise<void> {
  try {
    const documents = await registration.load(claimed.map((c) => c.resourceId));
    const byId = new Map(documents.map((document) => [document.id, document]));
    const stored = await storedHashes(exec, registration, claimed);
    const writes: IndexRow[] = [];
    const unchanged: ClaimedResourceChange[] = [];
    const removed: ClaimedResourceChange[] = [];
    for (const change of claimed) {
      const document = byId.get(change.resourceId);
      if (!document) {
        removed.push(change);
        continue;
      }
      const hash = contentHash(registration.version, document);
      if (stored.get(change.resourceId) === hash) unchanged.push(change);
      else writes.push({ change, document, hash });
    }
    await writeRows(exec, registration, writes);
    await bumpSeq(exec, registration, unchanged);
    await removeRows(exec, registration, removed);
    await completeResourceChanges(exec, feed, claimed);
  } catch (error) {
    console.error(
      `[search] Indexing ${claimed.length} ${registration.app}/${registration.type} change(s) failed:`,
      error instanceof Error ? error.message : String(error),
    );
    await failResourceChanges(exec, feed, claimed).catch(() => {});
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

async function storedHashes(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  claimed: readonly ClaimedResourceChange[],
): Promise<Map<string, string>> {
  const { rows } = await exec.execute({
    sql: `SELECT resource_id, content_hash FROM ${SEARCH_RESOURCES_TABLE}
          WHERE app = ? AND resource_type = ? AND resource_id IN (${placeholders(claimed.length)})`,
    args: [
      registration.app,
      registration.type,
      ...claimed.map((c) => c.resourceId),
    ],
  });
  return new Map(
    rows.map((row) => [String(row.resource_id), String(row.content_hash)]),
  );
}

function modifiedAt(
  value: SearchableResourceDocument["modifiedAt"],
): string | null {
  if (value == null || value === "") return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** cyrb53: a fast 53-bit string hash, enough to skip unchanged rewrites. */
function hash53(value: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function contentHash(
  version: number,
  document: SearchableResourceDocument,
): string {
  const text = [
    document.title,
    document.summary ?? "",
    document.body ?? "",
    modifiedAt(document.modifiedAt) ?? "",
  ].join("\u0000");
  return `v${version}:${text.length}:${hash53(text)}`;
}

async function writeRows(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  rows: readonly IndexRow[],
): Promise<void> {
  let batch: { args: unknown[]; bytes: number }[] = [];
  let batchBytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const values = batch
      .map(
        () =>
          "(?, ?, ?, ?, ?, ?, ?::tsvector, ?, ?::timestamptz, ?, ?, ?::bigint, now())",
      )
      .join(", ");
    await exec.execute({
      sql: `INSERT INTO ${SEARCH_RESOURCES_TABLE}
              (app, resource_type, resource_id, title, title_norm, summary_norm, doc_vector,
               positions_complete, modified_at, content_hash, index_version, indexed_seq, indexed_at)
            VALUES ${values}
            ON CONFLICT (app, resource_type, resource_id) DO UPDATE SET
              title = EXCLUDED.title,
              title_norm = EXCLUDED.title_norm,
              summary_norm = EXCLUDED.summary_norm,
              doc_vector = EXCLUDED.doc_vector,
              positions_complete = EXCLUDED.positions_complete,
              modified_at = EXCLUDED.modified_at,
              content_hash = EXCLUDED.content_hash,
              index_version = EXCLUDED.index_version,
              indexed_seq = EXCLUDED.indexed_seq,
              indexed_at = EXCLUDED.indexed_at
            WHERE ${SEARCH_RESOURCES_TABLE}.indexed_seq <= EXCLUDED.indexed_seq`,
      args: batch.flatMap((row) => row.args),
    });
    batch = [];
    batchBytes = 0;
  };
  for (const { change, document, hash } of rows) {
    const vector = buildSearchVector([
      { text: document.title, weight: "A" },
      { text: document.summary, weight: "B" },
      { text: document.body, weight: "C" },
    ]);
    const bytes = vector.literal.length + (document.title?.length ?? 0) * 2;
    if (batch.length && batchBytes + bytes > MAX_WRITE_BYTES) await flush();
    batch.push({
      bytes,
      args: [
        registration.app,
        registration.type,
        change.resourceId,
        document.title ?? "",
        normalizeSearchText(document.title ?? ""),
        normalizeSearchText(document.summary ?? ""),
        vector.literal,
        vector.positionsComplete,
        modifiedAt(document.modifiedAt),
        hash,
        registration.version,
        change.seq,
      ],
    });
    batchBytes += bytes;
  }
  await flush();
}

async function bumpSeq(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  changes: readonly ClaimedResourceChange[],
): Promise<void> {
  if (!changes.length) return;
  await exec.execute({
    sql: `UPDATE ${SEARCH_RESOURCES_TABLE} AS sr SET indexed_seq = seen.seq, indexed_at = now()
          FROM (VALUES ${changes.map(() => "(?, ?::bigint)").join(", ")}) AS seen (resource_id, seq)
          WHERE sr.app = ? AND sr.resource_type = ?
            AND sr.resource_id IN (${placeholders(changes.length)})
            AND sr.resource_id = seen.resource_id AND sr.indexed_seq < seen.seq`,
    args: [
      ...changes.flatMap((change) => [change.resourceId, change.seq]),
      registration.app,
      registration.type,
      ...changes.map((change) => change.resourceId),
    ],
  });
}

async function removeRows(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  changes: readonly ClaimedResourceChange[],
): Promise<void> {
  if (!changes.length) return;
  await exec.execute({
    sql: `DELETE FROM ${SEARCH_RESOURCES_TABLE} AS sr
          USING (VALUES ${changes.map(() => "(?, ?::bigint)").join(", ")}) AS gone (resource_id, seq)
          WHERE sr.app = ? AND sr.resource_type = ?
            AND sr.resource_id IN (${placeholders(changes.length)})
            AND sr.resource_id = gone.resource_id AND sr.indexed_seq <= gone.seq`,
    args: [
      ...changes.flatMap((change) => [change.resourceId, change.seq]),
      registration.app,
      registration.type,
      ...changes.map((change) => change.resourceId),
    ],
  });
}
