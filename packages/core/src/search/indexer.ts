/**
 * Keeps `search_resources` in step with registered tables by draining the
 * resource change feed. It never starts on its own: drains run before a
 * search, right after a write, and inside the recurring sweep, which are all
 * moments when the database is already awake.
 *
 * Every drain is fenced to its registration's version. When a newer deploy
 * raises the version, statements from older processes stop matching the
 * index state, so they can't claim, write, or complete anything the newer
 * version's rebuild queued.
 */
import { getAppConfig } from "../app-config/index.js";
import { getDbExec, type DbExec } from "../db/client.js";
import {
  RESOURCE_CHANGE_MAX_ATTEMPTS,
  claimResourceChanges,
  completeResourceChanges,
  enqueueAllResourceChanges,
  failResourceChanges,
  hasPendingResourceChanges,
  resourceChangeBacklogColumns,
  resourceChangeCaptureInstalled,
  subscribeResourceChangeConsumer,
  type ClaimedResourceChange,
  type ResourceChangeFeed,
  type ResourceChangeFence,
} from "../resource-changes/store.js";
import { getRequestRunContext } from "../server/request-context.js";
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
  | "failed-changes"
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

/** The index state and the change backlog, read in one round trip. */
interface IndexSnapshot {
  state: IndexState | null;
  pending: boolean;
  failing: boolean;
}

interface RegistrationRuntime {
  captureVerifiedAt?: number;
  captureInstalled?: boolean;
  failingReported?: boolean;
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

/** Holds only while the index still targets this registration's version. */
function versionFence(
  registration: SearchableResourceRegistration,
): ResourceChangeFence {
  return {
    sql: `EXISTS (SELECT 1 FROM ${SEARCH_INDEX_STATE_TABLE} AS fence
            WHERE fence.app = ? AND fence.resource_type = ? AND fence.target_version = ?)`,
    args: [registration.app, registration.type, registration.version],
  };
}

function notReady(reason: SearchIndexNotReadyReason): SearchIndexStatus {
  return { ready: false, reason };
}

/** Reasons a drain can fix, so a search spends its budget draining. */
const DRAINABLE = new Set<SearchIndexNotReadyReason | undefined>([
  "backlog",
  "rebuilding",
]);

/**
 * Drains pending changes for one registration until `deadline` and reports
 * whether the index is complete and current, meaning a search can trust it.
 * Concurrent calls in one process share a single drain, which finishes the
 * batch it is on before stopping.
 */
export function drainSearchIndex(
  registration: SearchableResourceRegistration,
  deadline: number,
): Promise<SearchIndexStatus> {
  return sharedDrain(registration, deadline);
}

function sharedDrain(
  registration: SearchableResourceRegistration,
  deadline: number,
  known?: IndexSnapshot,
): Promise<SearchIndexStatus> {
  const runtime = runtimeFor(registration);
  if (runtime.inFlight) return runtime.inFlight;
  const run = drain(registration, runtime, deadline, known)
    .catch((error: unknown) => {
      console.error(
        `[search] Draining the ${registration.app}/${registration.type} index failed:`,
        error instanceof Error ? error.message : String(error),
      );
      return notReady("unavailable");
    })
    .finally(() => {
      if (runtime.inFlight === run) runtime.inFlight = undefined;
    });
  runtime.inFlight = run;
  return run;
}

/**
 * Call before searching. Reports whether the index can answer: it reflects
 * every change committed before this call and was built by this
 * registration's version. When changes are pending, it spends up to the
 * budget indexing them, and answers by then either way. When the index can't
 * answer (first build, a backlog, a change that keeps failing, missing
 * capture, a newer deploy), use the app's fallback search for this request.
 *
 * `budgetMs` defaults to `runtime.searchDrainBudgetMs`. Zero indexes nothing
 * here and leaves pending changes to the drains that follow writes and the
 * recurring sweep.
 */
export async function prepareSearchIndex(
  registration: SearchableResourceRegistration,
  options: { budgetMs?: number } = {},
): Promise<SearchIndexStatus> {
  try {
    const exec = getDbExec();
    const runtime = runtimeFor(registration);
    if (!(await captureInstalled(exec, registration, runtime))) {
      return notReady("capture-missing");
    }
    const snapshot = await readSnapshot(exec, registration);
    reportFailing(registration, runtime, snapshot);
    const status = statusOf(registration, snapshot);
    const budgetMs =
      options.budgetMs ?? getAppConfig().runtime.searchDrainBudgetMs;
    if (status.ready || budgetMs <= 0 || !DRAINABLE.has(status.reason)) {
      return status;
    }
    const joined = runtime.inFlight !== undefined;
    const drained = sharedDrain(registration, Date.now() + budgetMs, snapshot);
    const settled = await settleWithin(drained, budgetMs);
    if (settled) return settled;
    // A drain this search started stops claiming at the deadline but
    // finishes its batch, so the changes it holds don't wait out their lease.
    if (!joined) getRequestRunContext()?.waitUntil?.(drained);
    return status;
  } catch (error) {
    console.error(
      `[search] Preparing the ${registration.app}/${registration.type} index failed:`,
      error instanceof Error ? error.message : String(error),
    );
    return notReady("unavailable");
  }
}

/** Node fires longer timers at once, so waits this long are unbounded. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** The work's result if it settles within `ms`, otherwise undefined. */
async function settleWithin<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  if (ms >= MAX_TIMER_MS) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Drains every registration, in turn, until `deadline`. */
export async function drainAllSearchIndexes(deadline: number): Promise<void> {
  for (const registration of listSearchableResources()) {
    if (Date.now() >= deadline) return;
    await drainSearchIndex(registration, deadline);
  }
}

function statusOf(
  registration: SearchableResourceRegistration,
  { state, pending, failing }: IndexSnapshot,
): SearchIndexStatus {
  if (state && state.targetVersion > registration.version) {
    // A newer deploy owns the index; this process serves the old path.
    return notReady("outdated-registration");
  }
  if (
    !state ||
    state.targetVersion < registration.version ||
    !state.rebuildCompleted ||
    state.indexVersion !== registration.version
  ) {
    return notReady("rebuilding");
  }
  if (failing) return notReady("failed-changes");
  if (pending) return notReady("backlog");
  return { ready: true };
}

function reportFailing(
  registration: SearchableResourceRegistration,
  runtime: RegistrationRuntime,
  snapshot: IndexSnapshot,
) {
  if (snapshot.failing && !runtime.failingReported) {
    console.error(
      `[search] Some ${registration.app}/${registration.type} changes keep failing to index, so search is using the app's fallback. ` +
        "They are retried every few minutes; the errors logged while indexing them say why.",
    );
  }
  runtime.failingReported = snapshot.failing;
}

async function drain(
  registration: SearchableResourceRegistration,
  runtime: RegistrationRuntime,
  deadline: number,
  known?: IndexSnapshot,
): Promise<SearchIndexStatus> {
  const exec = getDbExec();
  if (!(await captureInstalled(exec, registration, runtime))) {
    return notReady("capture-missing");
  }
  let snapshot = known ?? (await readSnapshot(exec, registration));
  if (rebuildNeedsQueueing(registration, snapshot.state)) {
    await startRebuild(exec, registration, snapshot.state);
    snapshot = await readSnapshot(exec, registration);
  }
  if (statusOf(registration, snapshot).reason === "outdated-registration") {
    return notReady("outdated-registration");
  }

  const feed = feedFor(registration);
  const fence = versionFence(registration);
  while (snapshot.pending && Date.now() < deadline) {
    const claimed = await claimResourceChanges(exec, feed, CLAIM_BATCH, fence);
    if (claimed.length) {
      await processBatch(exec, registration, feed, claimed, fence);
    }
    snapshot = await readSnapshot(exec, registration);
    // Nothing to claim: what's left is leased by another drain, waiting to
    // retry, or queued for a newer version.
    if (!claimed.length) break;
  }

  const { state } = snapshot;
  if (
    state &&
    state.targetVersion === registration.version &&
    !state.rebuildCompleted &&
    (await completeRebuildIfDone(exec, registration, state))
  ) {
    snapshot = await readSnapshot(exec, registration);
  }
  return statusOf(registration, snapshot);
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

function flag(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

async function readSnapshot(
  exec: DbExec,
  registration: SearchableResourceRegistration,
): Promise<IndexSnapshot> {
  const backlog = resourceChangeBacklogColumns(feedFor(registration));
  const { rows } = await exec.execute({
    sql: `SELECT s.target_version, s.index_version, s.rebuild_high_seq::text AS rebuild_high_seq,
                 s.rebuild_started_at, s.rebuild_completed_at, ${backlog.sql}
          FROM (SELECT 1) AS one
          LEFT JOIN ${SEARCH_INDEX_STATE_TABLE} AS s ON s.app = ? AND s.resource_type = ?`,
    args: [...backlog.args, registration.app, registration.type],
  });
  const row = rows[0] ?? {};
  return {
    state:
      row.target_version == null
        ? null
        : {
            targetVersion: Number(row.target_version),
            indexVersion:
              row.index_version == null ? null : Number(row.index_version),
            rebuildHighSeq:
              row.rebuild_high_seq == null
                ? null
                : String(row.rebuild_high_seq),
            rebuildStartedAt: row.rebuild_started_at
              ? new Date(row.rebuild_started_at).getTime()
              : null,
            rebuildCompleted: row.rebuild_completed_at != null,
          },
    pending: flag(row.pending),
    failing: flag(row.failing),
  };
}

/**
 * A registration whose version is newer than the index state starts a
 * rebuild. So does one whose rebuild was started by a process that died
 * before queueing it.
 */
function rebuildNeedsQueueing(
  registration: SearchableResourceRegistration,
  state: IndexState | null,
): boolean {
  if (!state || state.targetVersion < registration.version) return true;
  return (
    state.targetVersion === registration.version &&
    !state.rebuildCompleted &&
    state.rebuildHighSeq === null &&
    (state.rebuildStartedAt ?? 0) < Date.now() - REBUILD_ENQUEUE_RETRY_MS
  );
}

/**
 * Raises the index's target version, then queues every source row once.
 * Only one process wins the version bump, and from then on the fence stops
 * older processes. Queueing replaces changes they already hold, so none of
 * their in-flight work can complete what the rebuild queued.
 */
async function startRebuild(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  state: IndexState | null,
): Promise<void> {
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
    if (!rows.length) return;
  }
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
}

/**
 * Marks the rebuild complete once every change it queued is processed.
 * Returns whether the state may have changed.
 */
async function completeRebuildIfDone(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  state: IndexState,
): Promise<boolean> {
  if (state.rebuildHighSeq === null) return false;
  const pending = await hasPendingResourceChanges(exec, feedFor(registration), {
    atOrBelowSeq: state.rebuildHighSeq,
  });
  if (pending) return false;
  const { rows } = await exec.execute({
    sql: `UPDATE ${SEARCH_INDEX_STATE_TABLE}
          SET index_version = target_version, rebuild_completed_at = now()
          WHERE app = ? AND resource_type = ? AND target_version = ? AND rebuild_completed_at IS NULL
          RETURNING target_version`,
    args: [registration.app, registration.type, state.targetVersion],
  });
  if (rows.length) {
    // Rows left at an older version whose source row is gone were missed
    // deletes; drop them.
    const source = searchableResourceSource(registration);
    await exec.execute({
      sql: `DELETE FROM ${SEARCH_RESOURCES_TABLE} AS sr
            WHERE sr.app = ? AND sr.resource_type = ? AND sr.index_version <> ?
              AND NOT EXISTS (SELECT 1 FROM "${source.table}" AS src WHERE src."${source.idColumn}"::text = sr.resource_id)`,
      args: [registration.app, registration.type, state.targetVersion],
    });
  }
  return true;
}

interface IndexRow {
  change: ClaimedResourceChange;
  document: SearchableResourceDocument;
  hash: string;
}

/**
 * Indexes a claimed batch. A change that has failed before is retried on its
 * own, and when a batch fails, each of its changes is retried alone, so one
 * bad resource only ever holds back itself.
 */
async function processBatch(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  feed: ResourceChangeFeed,
  claimed: ClaimedResourceChange[],
  fence: ResourceChangeFence,
): Promise<void> {
  const fresh = claimed.filter((change) => change.attempts <= 1);
  const retries = claimed.filter((change) => change.attempts > 1);
  if (fresh.length) await indexGroup(exec, registration, feed, fresh, fence);
  for (const change of retries) {
    await indexGroup(exec, registration, feed, [change], fence);
  }
}

async function indexGroup(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  feed: ResourceChangeFeed,
  changes: ClaimedResourceChange[],
  fence: ResourceChangeFence,
): Promise<void> {
  const label = `${registration.app}/${registration.type}`;
  try {
    await indexChanges(exec, registration, feed, changes, fence);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (changes.length > 1) {
      console.warn(
        `[search] Indexing ${changes.length} ${label} changes together failed, so each is retried alone:`,
        message,
      );
      for (const change of changes) {
        await indexGroup(exec, registration, feed, [change], fence);
      }
      return;
    }
    const change = changes[0]!;
    const final = change.attempts >= RESOURCE_CHANGE_MAX_ATTEMPTS;
    console.error(
      `[search] Indexing ${label} "${change.resourceId}" failed on attempt ${change.attempts}` +
        (final ? "; search uses the app's fallback until it succeeds" : "") +
        ":",
      message,
    );
    await failResourceChanges(exec, feed, changes, fence).catch(() => {});
  }
}

async function indexChanges(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  feed: ResourceChangeFeed,
  changes: ClaimedResourceChange[],
  fence: ResourceChangeFence,
): Promise<void> {
  const documents = await registration.load(changes.map((c) => c.resourceId));
  const byId = new Map(documents.map((document) => [document.id, document]));
  const stored = await storedHashes(exec, registration, changes);
  const writes: IndexRow[] = [];
  const unchanged: ClaimedResourceChange[] = [];
  const removed: ClaimedResourceChange[] = [];
  for (const change of changes) {
    const document = byId.get(change.resourceId);
    if (!document) {
      removed.push(change);
      continue;
    }
    const hash = contentHash(registration.version, document);
    if (stored.get(change.resourceId) === hash) unchanged.push(change);
    else writes.push({ change, document, hash });
  }
  await writeRows(exec, registration, writes, fence);
  await bumpSeq(exec, registration, unchanged, fence);
  await removeRows(exec, registration, removed, fence);
  await completeResourceChanges(exec, feed, changes, fence);
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

/**
 * Upserts index rows. A row is only replaced by one from a later change at
 * the same or a newer version, so neither a slow drain nor an older deploy
 * can overwrite newer work.
 */
async function writeRows(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  rows: readonly IndexRow[],
  fence: ResourceChangeFence,
): Promise<void> {
  let batch: { args: unknown[]; bytes: number }[] = [];
  let batchBytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const values = batch
      .map(
        () =>
          "(?, ?, ?, ?, ?, ?, ?::tsvector, ?::boolean, ?::timestamptz, ?, ?::integer, ?::bigint)",
      )
      .join(", ");
    await exec.execute({
      sql: `INSERT INTO ${SEARCH_RESOURCES_TABLE}
              (app, resource_type, resource_id, title, title_norm, summary_norm, doc_vector,
               positions_complete, modified_at, content_hash, index_version, indexed_seq, indexed_at)
            SELECT v.*, now() FROM (VALUES ${values}) AS v
            WHERE ${fence.sql}
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
            WHERE ${SEARCH_RESOURCES_TABLE}.indexed_seq <= EXCLUDED.indexed_seq
              AND ${SEARCH_RESOURCES_TABLE}.index_version <= EXCLUDED.index_version`,
      args: [...batch.flatMap((row) => row.args), ...fence.args],
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
  fence: ResourceChangeFence,
): Promise<void> {
  if (!changes.length) return;
  await exec.execute({
    sql: `UPDATE ${SEARCH_RESOURCES_TABLE} AS sr SET indexed_seq = seen.seq, indexed_at = now()
          FROM (VALUES ${changes.map(() => "(?, ?::bigint)").join(", ")}) AS seen (resource_id, seq)
          WHERE sr.app = ? AND sr.resource_type = ?
            AND sr.resource_id IN (${placeholders(changes.length)})
            AND sr.resource_id = seen.resource_id AND sr.indexed_seq < seen.seq
            AND ${fence.sql}`,
    args: [
      ...changes.flatMap((change) => [change.resourceId, change.seq]),
      registration.app,
      registration.type,
      ...changes.map((change) => change.resourceId),
      ...fence.args,
    ],
  });
}

async function removeRows(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  changes: readonly ClaimedResourceChange[],
  fence: ResourceChangeFence,
): Promise<void> {
  if (!changes.length) return;
  await exec.execute({
    sql: `DELETE FROM ${SEARCH_RESOURCES_TABLE} AS sr
          USING (VALUES ${changes.map(() => "(?, ?::bigint)").join(", ")}) AS gone (resource_id, seq)
          WHERE sr.app = ? AND sr.resource_type = ?
            AND sr.resource_id IN (${placeholders(changes.length)})
            AND sr.resource_id = gone.resource_id AND sr.indexed_seq <= gone.seq
            AND ${fence.sql}`,
    args: [
      ...changes.flatMap((change) => [change.resourceId, change.seq]),
      registration.app,
      registration.type,
      ...changes.map((change) => change.resourceId),
      ...fence.args,
    ],
  });
}
