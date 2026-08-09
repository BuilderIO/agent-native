import {
  open,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  closeDbExec,
  getDbExec,
  withMigrationRuntime,
} from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";

import { output, parseArgs } from "../actions/helpers.js";
import {
  acquireDedicatedFirstPartyAnalyticsBackfillLease,
  getFirstPartyAnalyticsBigQueryBackfillJob,
} from "../server/jobs/analytics-bigquery-backfill.js";
import {
  createFirstPartyAnalyticsInserter,
  FIRST_PARTY_ANALYTICS_BACKFILL_COLUMNS,
  getFirstPartyAnalyticsBackend,
  saveFirstPartyAnalyticsBackend,
  type FirstPartyAnalyticsScope,
} from "../server/lib/first-party-analytics-backend.js";

const DEFAULT_BATCH_SIZE = 1_000;
const MAX_BATCH_SIZE = 2_500;
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 4;
const DEFAULT_MAX_BATCHES = 1_000;
const MAX_MAX_BATCHES = 10_000;
const DEFAULT_CHECKPOINT_PATH = ".analytics-first-party-bigquery-backfill.json";
const DEFAULT_LOOKBACK_DAYS = 60;
const MIN_LOOKBACK_DAYS = 30;
const MAX_LOOKBACK_DAYS = 60;
const DEFAULT_EXCLUDED_EVENT_NAMES = ["http.response"];
const MAX_EXCLUDED_EVENT_NAMES = 32;
const QUERY_TIMEOUT_MS = 30_000;
const MAX_HYDRATION_IDS = 500;
const JOB_TABLE = "analytics_bigquery_backfill_jobs";
const FINALIZE_ALLOW_ENV =
  "AGENT_NATIVE_ANALYTICS_BIGQUERY_BACKFILL_FINALIZE_ALLOW";
const FINALIZE_QUIESCENT_ENV =
  "AGENT_NATIVE_ANALYTICS_BIGQUERY_BACKFILL_QUIESCENT";

type BranchName = "org" | "legacy";

export interface BackfillCursor {
  receivedAt: string;
  id: string;
}

export interface BranchCheckpoint {
  cutoff: BackfillCursor | null;
  cursor: BackfillCursor | null;
  copied: number;
  complete: boolean;
}

export interface DedicatedBackfillCheckpoint {
  version: 1 | 2;
  scope: {
    userEmail: string;
    orgId: string;
  };
  table: string | null;
  branches: Record<BranchName, BranchCheckpoint>;
  lookbackDays?: number;
  lookbackStart?: string | null;
  excludedEventNames?: string[];
  updatedAt: string;
}

export interface DedicatedBackfillOptions {
  scope: FirstPartyAnalyticsScope & { orgId: string };
  table: string | null;
  batchSize: number;
  concurrency: number;
  maxBatches: number;
  checkpointPath: string;
  lookbackDays?: number;
  excludedEventNames?: string[];
}

export interface FinalizeResult {
  mode: "finalize";
  copied: number;
  cursor: BackfillCursor | null;
  jobId: string;
  status: "completed";
}

interface DbQuery {
  sql: string;
  args: unknown[];
  timeoutMs: number;
  maxAttempts: 1;
}

interface DbExecutor {
  execute(query: DbQuery): Promise<{ rows: unknown[] }>;
}

export interface CheckpointStore {
  load(): Promise<DedicatedBackfillCheckpoint | null>;
  save(checkpoint: DedicatedBackfillCheckpoint): Promise<void>;
}

export interface DedicatedBackfillDependencies {
  db: DbExecutor;
  upload: (rows: Array<Record<string, unknown>>) => Promise<number>;
  checkpointStore: CheckpointStore;
  now?: () => string;
  onProgress?: (progress: {
    branch: BranchName;
    batches: number;
    copiedThisRun: number;
    copiedTotal: number;
  }) => void;
}

export interface DedicatedBackfillResult {
  batches: number;
  copiedThisRun: number;
  copiedTotal: number;
  complete: boolean;
  checkpoint: DedicatedBackfillCheckpoint;
}

interface BranchSpec {
  name: BranchName;
  predicate: string;
  predicateArgs: string[];
  lookbackStart?: string | null;
  excludedEventNames?: string[];
}

const PROJECTED_COLUMNS = FIRST_PARTY_ANALYTICS_BACKFILL_COLUMNS.join(", ");

function positiveInteger(
  raw: string | undefined,
  name: string,
  fallback: number,
  maximum: number,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Math.min(value, maximum);
}

function parseLookbackDays(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LOOKBACK_DAYS;
  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value < MIN_LOOKBACK_DAYS ||
    value > MAX_LOOKBACK_DAYS
  ) {
    throw new Error(
      `--lookback-days must be an integer between ${MIN_LOOKBACK_DAYS} and ${MAX_LOOKBACK_DAYS}`,
    );
  }
  return value;
}

function parseExcludedEventNames(raw: string | undefined): string[] {
  if (raw === undefined) return [...DEFAULT_EXCLUDED_EVENT_NAMES];
  const names = [...new Set(raw.split(",").map((name) => name.trim()))].filter(
    Boolean,
  );
  if (names.length > MAX_EXCLUDED_EVENT_NAMES) {
    throw new Error(
      `--skip-events supports at most ${MAX_EXCLUDED_EVENT_NAMES} event names`,
    );
  }
  return names;
}

function lookbackStart(now: string, days: number): string {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid backfill clock value: ${now}`);
  }
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

interface BackfillQueryConfig {
  lookbackDays: number;
  lookbackStart: string | null;
  excludedEventNames: string[];
}

function requiredArg(args: Record<string, string>, name: string): string {
  const value = args[name]?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

export function parseDedicatedBackfillOptions(
  args = parseArgs(),
): DedicatedBackfillOptions & { execute: boolean; finalize: boolean } {
  const userEmail = requiredArg(args, "owner-email");
  const orgId = requiredArg(args, "org-id");
  return {
    scope: { userEmail, orgId },
    table: args.table?.trim() || null,
    batchSize: positiveInteger(
      args["batch-size"],
      "--batch-size",
      DEFAULT_BATCH_SIZE,
      MAX_BATCH_SIZE,
    ),
    concurrency: positiveInteger(
      args.concurrency,
      "--concurrency",
      DEFAULT_CONCURRENCY,
      MAX_CONCURRENCY,
    ),
    maxBatches: positiveInteger(
      args["max-batches"],
      "--max-batches",
      DEFAULT_MAX_BATCHES,
      MAX_MAX_BATCHES,
    ),
    checkpointPath: resolve(args.checkpoint || DEFAULT_CHECKPOINT_PATH),
    lookbackDays: parseLookbackDays(args["lookback-days"]),
    excludedEventNames: parseExcludedEventNames(args["skip-events"]),
    execute: args.execute === "true",
    finalize: args.finalize === "true",
  };
}

function branchSpecs(
  scope: FirstPartyAnalyticsScope & { orgId: string },
  queryConfig: BackfillQueryConfig = {
    lookbackDays: DEFAULT_LOOKBACK_DAYS,
    lookbackStart: null,
    excludedEventNames: [],
  },
): BranchSpec[] {
  return [
    {
      name: "org",
      predicate: "org_id = ?",
      predicateArgs: [scope.orgId],
      ...queryConfig,
    },
    {
      name: "legacy",
      predicate: "org_id IS NULL AND owner_email = ?",
      predicateArgs: [scope.userEmail],
      ...queryConfig,
    },
  ];
}

function sourceFilter(spec: BranchSpec): {
  clauses: string[];
  args: string[];
} {
  const clauses: string[] = [];
  const args: string[] = [];
  if (spec.lookbackStart) {
    clauses.push("received_at >= ?");
    args.push(spec.lookbackStart);
  }
  const excluded = spec.excludedEventNames ?? [];
  if (excluded.length) {
    if (
      excluded.length === DEFAULT_EXCLUDED_EVENT_NAMES.length &&
      excluded[0] === DEFAULT_EXCLUDED_EVENT_NAMES[0]
    ) {
      clauses.push("event_name IS DISTINCT FROM 'http.response'");
    } else {
      clauses.push(
        `(event_name IS NULL OR event_name NOT IN (${excluded.map(() => "?").join(", ")}))`,
      );
      args.push(...excluded);
    }
  }
  return { clauses, args };
}

export function buildHighWaterMarkQuery(spec: BranchSpec): DbQuery {
  const filters = sourceFilter(spec);
  return {
    sql: `SELECT received_at, id
      FROM analytics_events
      WHERE ${spec.predicate}${filters.clauses.length ? `\n        AND ${filters.clauses.join("\n        AND ")}` : ""}
      ORDER BY received_at DESC, id DESC
      LIMIT 1`,
    args: [...spec.predicateArgs, ...filters.args],
    timeoutMs: QUERY_TIMEOUT_MS,
    maxAttempts: 1,
  };
}

export function buildPageKeyQuery(
  spec: BranchSpec,
  state: BranchCheckpoint,
  batchSize: number,
): DbQuery {
  if (!state.cutoff) {
    throw new Error(`Cannot page ${spec.name} without a high-water mark`);
  }
  const filters = sourceFilter(spec);
  const args: unknown[] = [
    ...spec.predicateArgs,
    ...filters.args,
    state.cutoff.receivedAt,
    state.cutoff.id,
  ];
  let cursorClause = "";
  if (state.cursor) {
    cursorClause = " AND (received_at, id) > (?, ?)";
    args.push(state.cursor.receivedAt, state.cursor.id);
  }
  args.push(batchSize);
  return {
    sql: `SELECT received_at, id
      FROM analytics_events
      WHERE ${spec.predicate}
        ${filters.clauses.map((clause) => `AND ${clause}`).join("\n        ")}
        AND (received_at, id) <= (?, ?)${cursorClause}
      ORDER BY received_at ASC, id ASC
      LIMIT ?`,
    args,
    timeoutMs: QUERY_TIMEOUT_MS,
    maxAttempts: 1,
  };
}

export function buildHydrationQuery(ids: string[]): DbQuery {
  if (!ids.length || ids.length > MAX_HYDRATION_IDS) {
    throw new Error(
      `BigQuery backfill hydration requires 1-${MAX_HYDRATION_IDS} ids`,
    );
  }
  return {
    sql: `SELECT ${PROJECTED_COLUMNS}
      FROM analytics_events
      WHERE id IN (${ids.map(() => "?").join(", ")})`,
    args: ids,
    timeoutMs: QUERY_TIMEOUT_MS,
    maxAttempts: 1,
  };
}

function cursorFromRow(row: unknown, description: string): BackfillCursor {
  if (!row || typeof row !== "object") {
    throw new Error(`${description} is not an object`);
  }
  const record = row as Record<string, unknown>;
  const receivedAt = record.received_at;
  const id = record.id;
  if (typeof receivedAt !== "string" || !receivedAt) {
    throw new Error(`${description} is missing received_at`);
  }
  if (typeof id !== "string" || !id) {
    throw new Error(`${description} is missing id`);
  }
  return { receivedAt, id };
}

function assertCheckpointCursor(
  cursor: unknown,
  description: string,
): asserts cursor is BackfillCursor {
  if (!cursor || typeof cursor !== "object") {
    throw new Error(`Backfill checkpoint ${description} is not an object`);
  }
  const record = cursor as Record<string, unknown>;
  if (typeof record.receivedAt !== "string" || !record.receivedAt) {
    throw new Error(`Backfill checkpoint ${description} is missing receivedAt`);
  }
  if (typeof record.id !== "string" || !record.id) {
    throw new Error(`Backfill checkpoint ${description} is missing id`);
  }
}

function emptyBranchCheckpoint(): BranchCheckpoint {
  return { cutoff: null, cursor: null, copied: 0, complete: false };
}

function newCheckpoint(
  options: DedicatedBackfillOptions,
  now: string,
  queryConfig: BackfillQueryConfig,
): DedicatedBackfillCheckpoint {
  return {
    version: 2,
    scope: {
      userEmail: options.scope.userEmail,
      orgId: options.scope.orgId,
    },
    table: options.table,
    branches: {
      org: emptyBranchCheckpoint(),
      legacy: emptyBranchCheckpoint(),
    },
    lookbackDays: queryConfig.lookbackDays,
    lookbackStart: queryConfig.lookbackStart ?? undefined,
    excludedEventNames: queryConfig.excludedEventNames,
    updatedAt: now,
  };
}

function checkpointQueryConfig(
  checkpoint: DedicatedBackfillCheckpoint,
): BackfillQueryConfig {
  return {
    lookbackDays:
      checkpoint.version === 2
        ? (checkpoint.lookbackDays ?? DEFAULT_LOOKBACK_DAYS)
        : DEFAULT_LOOKBACK_DAYS,
    lookbackStart:
      checkpoint.version === 2 ? (checkpoint.lookbackStart ?? null) : null,
    excludedEventNames:
      checkpoint.version === 2 ? (checkpoint.excludedEventNames ?? []) : [],
  };
}

function upgradeCheckpoint(
  checkpoint: DedicatedBackfillCheckpoint,
  queryConfig: BackfillQueryConfig,
): DedicatedBackfillCheckpoint {
  if (checkpoint.version === 2) {
    return checkpoint.lookbackDays === undefined
      ? { ...checkpoint, lookbackDays: queryConfig.lookbackDays }
      : checkpoint;
  }
  for (const branch of ["org", "legacy"] as const) {
    checkpoint.branches[branch].complete = false;
  }
  return {
    ...checkpoint,
    version: 2,
    lookbackDays: queryConfig.lookbackDays,
    lookbackStart: queryConfig.lookbackStart ?? undefined,
    excludedEventNames: queryConfig.excludedEventNames,
  };
}

function assertCheckpointMatches(
  checkpoint: DedicatedBackfillCheckpoint,
  options: DedicatedBackfillOptions,
): void {
  if (checkpoint.version !== 1 && checkpoint.version !== 2) {
    throw new Error(
      `Unsupported backfill checkpoint version: ${checkpoint.version}`,
    );
  }
  if (
    checkpoint.scope.userEmail !== options.scope.userEmail ||
    checkpoint.scope.orgId !== options.scope.orgId
  ) {
    throw new Error(
      "Backfill checkpoint scope does not match --owner-email/--org-id",
    );
  }
  if (checkpoint.table !== options.table) {
    throw new Error(
      "Backfill checkpoint table does not match the current BigQuery table",
    );
  }
  if (checkpoint.version === 2) {
    const lookbackDays = checkpoint.lookbackDays;
    if (
      (checkpoint.lookbackStart !== undefined &&
        typeof checkpoint.lookbackStart !== "string") ||
      typeof lookbackDays !== "number" ||
      !Number.isInteger(lookbackDays) ||
      lookbackDays < MIN_LOOKBACK_DAYS ||
      lookbackDays > MAX_LOOKBACK_DAYS ||
      !Array.isArray(checkpoint.excludedEventNames) ||
      checkpoint.excludedEventNames.some((name) => typeof name !== "string")
    ) {
      throw new Error(
        "Backfill checkpoint has invalid lookback or event filter metadata",
      );
    }
  }
  for (const branch of ["org", "legacy"] as const) {
    const state = checkpoint.branches[branch];
    if (!state)
      throw new Error(`Backfill checkpoint is missing ${branch} state`);
    if (!Number.isInteger(state.copied) || state.copied < 0) {
      throw new Error(`Backfill checkpoint has an invalid ${branch} count`);
    }
    if (state.cutoff) {
      assertCheckpointCursor(state.cutoff, `${branch} cutoff`);
    }
    if (state.cursor) {
      assertCheckpointCursor(state.cursor, `${branch} cursor`);
    }
    if (state.cursor && !state.cutoff) {
      throw new Error(
        `Backfill checkpoint has a ${branch} cursor without a cutoff`,
      );
    }
  }
}

function latestCursor(
  checkpoint: DedicatedBackfillCheckpoint,
): BackfillCursor | null {
  const cursors = [
    checkpoint.branches.org.cursor,
    checkpoint.branches.legacy.cursor,
  ]
    .filter((cursor): cursor is BackfillCursor => cursor !== null)
    .sort(
      (left, right) =>
        left.receivedAt.localeCompare(right.receivedAt) ||
        left.id.localeCompare(right.id),
    );
  return cursors[cursors.length - 1] ?? null;
}

function compareCursors(left: BackfillCursor, right: BackfillCursor): number {
  return (
    left.receivedAt.localeCompare(right.receivedAt) ||
    left.id.localeCompare(right.id)
  );
}

async function hydratePageRows(
  keyRows: Array<Record<string, unknown>>,
  db: DbExecutor,
): Promise<Array<Record<string, unknown>>> {
  const rowsById = new Map<string, Record<string, unknown>>();
  for (let offset = 0; offset < keyRows.length; offset += MAX_HYDRATION_IDS) {
    const ids = keyRows
      .slice(offset, offset + MAX_HYDRATION_IDS)
      .map((row, index) => {
        const cursor = cursorFromRow(row, `backfill key row ${offset + index}`);
        return cursor.id;
      });
    const result = await db.execute(buildHydrationQuery(ids));
    for (const row of result.rows as Array<Record<string, unknown>>) {
      const id = row.id;
      if (typeof id !== "string" || !id) {
        throw new Error("Backfill hydration row is missing id");
      }
      rowsById.set(id, row);
    }
  }

  return keyRows.map((keyRow, index) => {
    const { id } = cursorFromRow(keyRow, `backfill key row ${index}`);
    const row = rowsById.get(id);
    if (!row) {
      throw new Error(`Backfill row ${id} disappeared during hydration`);
    }
    return row;
  });
}

export async function assertSourceAtCheckpoint(
  scope: DedicatedBackfillOptions["scope"],
  checkpoint: DedicatedBackfillCheckpoint,
  db: DbExecutor = getDbExec(),
): Promise<void> {
  for (const spec of branchSpecs(scope, checkpointQueryConfig(checkpoint))) {
    const result = await db.execute(buildHighWaterMarkQuery(spec));
    const latestRow = result.rows[0];
    if (!latestRow) continue;
    const latest = cursorFromRow(
      latestRow,
      `${spec.name} final high-water mark`,
    );
    const cutoff = checkpoint.branches[spec.name].cutoff;
    if (!cutoff || compareCursors(latest, cutoff) > 0) {
      throw new Error(
        `Refusing to finalize: ${spec.name} branch has events after the checkpoint cutoff; quiesce source writes and retry the finalization`,
      );
    }
  }
}

export class JsonCheckpointStore implements CheckpointStore {
  constructor(private readonly path: string) {}

  async load(): Promise<DedicatedBackfillCheckpoint | null> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("checkpoint is not an object");
      }
      return parsed as DedicatedBackfillCheckpoint;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(
        `Unable to read backfill checkpoint ${this.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async save(checkpoint: DedicatedBackfillCheckpoint): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.path);
  }
}

async function refreshBranchCutoff(
  spec: BranchSpec,
  state: BranchCheckpoint,
  checkpoint: DedicatedBackfillCheckpoint,
  dependencies: DedicatedBackfillDependencies,
  now: () => string,
): Promise<void> {
  const result = await dependencies.db.execute(buildHighWaterMarkQuery(spec));
  const row = result.rows[0];
  const latest = row
    ? cursorFromRow(row, `${spec.name} high-water mark`)
    : null;
  if (latest && (!state.cutoff || compareCursors(latest, state.cutoff) > 0)) {
    state.cutoff = latest;
    state.complete = false;
  } else {
    state.complete = true;
  }
  checkpoint.updatedAt = now();
  await dependencies.checkpointStore.save(checkpoint);
}

export async function acquireCheckpointLock(
  checkpointPath: string,
): Promise<() => Promise<void>> {
  const lockPath = `${checkpointPath}.lock`;
  await mkdir(dirname(lockPath), { recursive: true });
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Another backfill worker owns ${lockPath}; inspect it before removing the lock`,
      );
    }
    throw error;
  }
  try {
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      "utf8",
    );
  } catch (error) {
    await handle.close();
    await unlink(lockPath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return async () => {
    await unlink(lockPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  };
}

export async function runDedicatedBackfill(
  options: DedicatedBackfillOptions,
  dependencies: DedicatedBackfillDependencies,
): Promise<DedicatedBackfillResult> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const checkpointNow = now();
  const loadedCheckpoint = await dependencies.checkpointStore.load();
  const requestedLookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const requestedExcludedEventNames = options.excludedEventNames ?? [
    ...DEFAULT_EXCLUDED_EVENT_NAMES,
  ];
  const queryConfig: BackfillQueryConfig = loadedCheckpoint
    ? checkpointQueryConfig(loadedCheckpoint)
    : {
        lookbackDays: requestedLookbackDays,
        lookbackStart: lookbackStart(checkpointNow, requestedLookbackDays),
        excludedEventNames: requestedExcludedEventNames,
      };
  const checkpoint = loadedCheckpoint
    ? upgradeCheckpoint(loadedCheckpoint, queryConfig)
    : newCheckpoint(options, checkpointNow, queryConfig);
  assertCheckpointMatches(checkpoint, options);
  if (checkpoint.version === 2) {
    if (checkpoint.lookbackDays !== requestedLookbackDays) {
      throw new Error(
        "Backfill checkpoint lookback window does not match the current --lookback-days setting",
      );
    }
    if (
      JSON.stringify(checkpoint.excludedEventNames) !==
      JSON.stringify(requestedExcludedEventNames)
    ) {
      throw new Error(
        "Backfill checkpoint event filter does not match the current --skip-events setting",
      );
    }
  }
  await dependencies.checkpointStore.save(checkpoint);

  let batches = 0;
  let copiedThisRun = 0;
  let stop = false;
  for (const spec of branchSpecs(options.scope, queryConfig)) {
    const state = checkpoint.branches[spec.name];
    if (state.complete) continue;

    if (!state.cutoff) {
      await refreshBranchCutoff(spec, state, checkpoint, dependencies, now);
      if (state.complete) continue;
    }

    while (!state.complete) {
      if (batches >= options.maxBatches) {
        stop = true;
        break;
      }
      const keyResult = await dependencies.db.execute(
        buildPageKeyQuery(spec, state, options.batchSize),
      );
      const keyRows = keyResult.rows as Array<Record<string, unknown>>;
      if (!keyRows.length) {
        await refreshBranchCutoff(spec, state, checkpoint, dependencies, now);
        if (state.complete) break;
        continue;
      }
      const rows = await hydratePageRows(keyRows, dependencies.db);

      const copied = await dependencies.upload(rows);
      if (copied !== rows.length) {
        throw new Error(
          `BigQuery acknowledged ${copied} of ${rows.length} rows; checkpoint was not advanced`,
        );
      }

      state.cursor = cursorFromRow(rows[rows.length - 1], `${spec.name} page`);
      state.copied += copied;
      copiedThisRun += copied;
      batches += 1;
      state.complete = false;
      checkpoint.updatedAt = now();
      await dependencies.checkpointStore.save(checkpoint);
      dependencies.onProgress?.({
        branch: spec.name,
        batches,
        copiedThisRun,
        copiedTotal: state.copied,
      });
      if (rows.length < options.batchSize) {
        await refreshBranchCutoff(spec, state, checkpoint, dependencies, now);
      }
    }
    if (stop) break;
  }

  return {
    batches,
    copiedThisRun,
    copiedTotal:
      checkpoint.branches.org.copied + checkpoint.branches.legacy.copied,
    complete:
      checkpoint.branches.org.complete && checkpoint.branches.legacy.complete,
    checkpoint,
  };
}

const USAGE = `Dedicated first-party Analytics Neon -> BigQuery backfill

Dry-run (default):
  pnpm backfill:first-party-bigquery --owner-email=<email> --org-id=<org>

Execute only after an explicit production approval:
  AGENT_NATIVE_ANALYTICS_BIGQUERY_BACKFILL_ALLOW=1 pnpm backfill:first-party-bigquery \
    --execute --owner-email=<email> --org-id=<org>

Options:
  --table=<dataset.table>       Optional override, must match the approved table
  --batch-size=<n>              Source page size, default 1000, max 2500
  --concurrency=<n>             BigQuery requests in flight, default 2, max 4
  --max-batches=<n>             Work budget per invocation, default 1000
  --checkpoint=<path>           Atomic local checkpoint path
  --lookback-days=<n>           Source window, 30-60 days, default 60
  --skip-events=<csv>           Event names to skip, default http.response

After the checkpoint is complete, reconcile it into the shipped durable job
after quiescing source event writes and checking the final high-water marks:
  AGENT_NATIVE_ANALYTICS_BIGQUERY_BACKFILL_FINALIZE_ALLOW=1 \
  AGENT_NATIVE_ANALYTICS_BIGQUERY_BACKFILL_QUIESCENT=1 \
  pnpm backfill:first-party-bigquery \
    --finalize --owner-email=<email> --org-id=<org>
`;

async function runApprovedWorker(
  options: DedicatedBackfillOptions,
): Promise<DedicatedBackfillResult> {
  let releaseLock: (() => Promise<void>) | null = null;
  let releaseLease: (() => Promise<void>) | null = null;
  try {
    releaseLock = await acquireCheckpointLock(options.checkpointPath);
    return await withMigrationRuntime(async () =>
      runWithRequestContext(options.scope, async () => {
        const backend = await getFirstPartyAnalyticsBackend(options.scope);
        if (backend.sink !== "dual") {
          throw new Error(
            `Refusing to backfill while the source sink is ${backend.sink}; prepare must establish dual-write first`,
          );
        }
        if (options.table && backend.table && options.table !== backend.table) {
          throw new Error(
            "--table does not match the scoped first-party Analytics backend setting",
          );
        }
        const configuredTable = options.table ?? backend.table;
        if (!configuredTable) {
          throw new Error(
            "Refusing to start the dedicated backfill without a configured BigQuery table",
          );
        }
        const workerOptions = { ...options, table: configuredTable };
        releaseLease = await acquireDedicatedFirstPartyAnalyticsBackfillLease(
          options.scope,
          configuredTable,
        );
        const insertRows = await createFirstPartyAnalyticsInserter(
          configuredTable,
          {
            maxRowsPerRequest: 500,
            maxConcurrentRequests: options.concurrency,
          },
        );
        const result = await runDedicatedBackfill(workerOptions, {
          db: getDbExec(),
          upload: (rows) => insertRows(rows),
          checkpointStore: new JsonCheckpointStore(options.checkpointPath),
          onProgress: (progress) => {
            console.error(JSON.stringify({ type: "progress", ...progress }));
          },
        });
        return result;
      }),
    );
  } finally {
    const leaseToRelease = releaseLease as (() => Promise<void>) | null;
    const lockToRelease = releaseLock as (() => Promise<void>) | null;
    if (leaseToRelease) {
      try {
        await leaseToRelease();
      } finally {
        if (lockToRelease) {
          try {
            await closeDbExec();
          } finally {
            await lockToRelease();
          }
        }
      }
    } else if (lockToRelease) {
      try {
        await closeDbExec();
      } finally {
        await lockToRelease();
      }
    }
  }
}

async function runApprovedFinalize(
  options: DedicatedBackfillOptions,
): Promise<FinalizeResult> {
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await acquireCheckpointLock(options.checkpointPath);
    return await withMigrationRuntime(async () =>
      runWithRequestContext(options.scope, async () => {
        const backend = await getFirstPartyAnalyticsBackend(options.scope);
        if (backend.sink !== "dual") {
          throw new Error(
            `Refusing to finalize while the source sink is ${backend.sink}; prepare must establish dual-write first`,
          );
        }
        const configuredTable = options.table ?? backend.table;
        const finalizeOptions = { ...options, table: configuredTable };
        const checkpoint = await new JsonCheckpointStore(
          options.checkpointPath,
        ).load();
        if (!checkpoint) {
          throw new Error(
            `Backfill checkpoint ${options.checkpointPath} does not exist`,
          );
        }
        assertCheckpointMatches(checkpoint, finalizeOptions);
        if (
          !checkpoint.branches.org.complete ||
          !checkpoint.branches.legacy.complete
        ) {
          throw new Error(
            "Refusing to finalize before both organization and legacy-owner branches are complete",
          );
        }

        const job = await getFirstPartyAnalyticsBigQueryBackfillJob(
          options.scope,
        );
        if (!job) {
          throw new Error(
            "Prepare the organization before reconciling the dedicated backfill checkpoint",
          );
        }
        if (job.table !== checkpoint.table) {
          throw new Error(
            `Durable backfill targets ${job.table}, checkpoint targets ${checkpoint.table}`,
          );
        }
        if (job.status === "completed") {
          return {
            mode: "finalize",
            copied:
              checkpoint.branches.org.copied +
              checkpoint.branches.legacy.copied,
            cursor: latestCursor(checkpoint),
            jobId: job.id,
            status: "completed",
          };
        }
        if (
          job.status === "running" &&
          (!job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) > Date.now())
        ) {
          throw new Error(
            "The shipped backfill worker currently owns the durable job lease; wait for it to stop before finalizing",
          );
        }

        await assertSourceAtCheckpoint(options.scope, checkpoint);

        const cursor = latestCursor(checkpoint);
        const now = new Date().toISOString();
        const update = await getDbExec().execute({
          sql: `UPDATE ${JOB_TABLE}
                  SET status = 'completed', backfill_cursor = ?,
                      copied_count = ?, lease_token = NULL,
                      lease_expires_at = NULL, next_run_at = ?,
                      last_error = NULL, completed_at = ?, updated_at = ?
                WHERE id = ? AND table_ref = ?
                  AND (status = 'pending'
                       OR (status = 'running' AND lease_expires_at IS NOT NULL
                           AND lease_expires_at <= ?))`,
          args: [
            cursor ? JSON.stringify(cursor) : null,
            Math.max(
              job.copied,
              checkpoint.branches.org.copied +
                checkpoint.branches.legacy.copied,
            ),
            now,
            now,
            now,
            job.id,
            checkpoint.table,
            now,
          ],
          timeoutMs: 5_000,
          maxAttempts: 1,
        });
        if (update.rowsAffected !== 1) {
          throw new Error(
            "The durable backfill job changed while it was being finalized; inspect status before retrying",
          );
        }
        await saveFirstPartyAnalyticsBackend(options.scope, {
          ...backend,
          table: checkpoint.table,
          backfillCursor: cursor ? JSON.stringify(cursor) : null,
          backfillCompleted: true,
        });
        return {
          mode: "finalize",
          copied:
            checkpoint.branches.org.copied + checkpoint.branches.legacy.copied,
          cursor,
          jobId: job.id,
          status: "completed",
        };
      }),
    );
  } finally {
    if (releaseLock) {
      try {
        await closeDbExec();
      } finally {
        await releaseLock();
      }
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const options = parseDedicatedBackfillOptions(args);
  if (options.execute && options.finalize) {
    throw new Error("Choose either --execute or --finalize, not both");
  }
  if (!options.execute && !options.finalize) {
    output({
      mode: "dry-run",
      batchSize: options.batchSize,
      concurrency: options.concurrency,
      maxBatches: options.maxBatches,
      lookbackDays: options.lookbackDays,
      excludedEventNames: options.excludedEventNames,
      checkpointPath: options.checkpointPath,
      message:
        "No data was copied. Pass --execute and AGENT_NATIVE_ANALYTICS_BIGQUERY_BACKFILL_ALLOW=1 after production approval.",
    });
    return;
  }
  if (options.finalize) {
    if (process.env[FINALIZE_ALLOW_ENV] !== "1") {
      throw new Error(
        `Checkpoint finalization is disabled. Set ${FINALIZE_ALLOW_ENV}=1 only after explicit production approval.`,
      );
    }
    if (process.env[FINALIZE_QUIESCENT_ENV] !== "1") {
      throw new Error(
        `Checkpoint finalization requires source event writes to be quiesced. Set ${FINALIZE_QUIESCENT_ENV}=1 only after the final high-water check and explicit production approval.`,
      );
    }
    output(await runApprovedFinalize(options));
    return;
  }
  if (process.env.AGENT_NATIVE_ANALYTICS_BIGQUERY_BACKFILL_ALLOW !== "1") {
    throw new Error(
      "Production execution is disabled. Set AGENT_NATIVE_ANALYTICS_BIGQUERY_BACKFILL_ALLOW=1 only after explicit approval.",
    );
  }
  output(await runApprovedWorker(options));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
