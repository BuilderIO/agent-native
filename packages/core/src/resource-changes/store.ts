/**
 * The app resource change feed: a durable note that one of an app's
 * resources changed, kept once for every consumer that asked to hear about
 * that resource type.
 *
 * Producers call one SQL function, `agent_native_app_resource_changed`, in the
 * writer's own transaction, so nothing is recorded unless the write commits.
 * Today the producers are row triggers that core generates for a registered
 * table. They catch every writer: actions, sync jobs, raw SQL, and deletes.
 * If core later gains a data layer that every write goes through, it calls the
 * same function and the triggers retire; consumers don't change.
 *
 * Each (consumer, resource) pair is one row. Repeated changes update that row
 * rather than adding rows, so autosave doesn't grow the feed. Every change
 * takes a new value from one sequence, taken after the row lock, so for any
 * one resource a larger `seq` always means a later committed change. Consumers
 * use it to reject stale work and to delete only what they processed.
 *
 * A change that fails is retried with backoff, and after its last allowed
 * attempt it is marked failed but still retried every few minutes. It stays
 * pending the whole time, so a consumer that reports freshness never treats
 * it as done.
 *
 * Consumers never poll. They process changes only where the database is
 * already awake: before a read that needs fresh data, right after a write, or
 * inside the framework's recurring sweep. See docs/search-architecture.md.
 */
import { getDbExec, type DbExec } from "../db/client.js";
import {
  ensureIndexExists,
  ensureSchemaObject,
  ensureTableExists,
  runGuardedDdl,
} from "../db/ddl-guard.js";

export const RESOURCE_CHANGES_TABLE = "app_resource_changes";
export const RESOURCE_CHANGE_CONSUMERS_TABLE = "app_resource_change_consumers";
export const RESOURCE_CHANGE_SEQUENCE = "app_resource_change_seq";
export const RESOURCE_CHANGED_FUNCTION = "agent_native_app_resource_changed";

/** After this many attempts a change is marked failed. */
export const RESOURCE_CHANGE_MAX_ATTEMPTS = 5;
const CLAIM_LEASE_SECONDS = 60;
/** The longest wait between retries of a failing change. */
const MAX_RETRY_SECONDS = 300;
/**
 * Caps the exponent: a failing change keeps being retried, and
 * `power(2, attempts)` overflows after about a thousand attempts.
 */
const MAX_BACKOFF_DOUBLINGS = 10;

const RESOURCE_CHANGE_CONSUMERS_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS ${RESOURCE_CHANGE_CONSUMERS_TABLE} (
    app TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    consumer TEXT NOT NULL,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (app, resource_type, consumer)
  )
`;

const RESOURCE_CHANGES_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS ${RESOURCE_CHANGES_TABLE} (
    consumer TEXT NOT NULL,
    app TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    seq BIGINT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    attempts INTEGER NOT NULL DEFAULT 0,
    failed_at TIMESTAMPTZ,
    PRIMARY KEY (consumer, app, resource_type, resource_id)
  )
`;

const RESOURCE_CHANGES_ORDER_INDEX_SQL = `CREATE INDEX IF NOT EXISTS app_resource_changes_seq_idx ON ${RESOURCE_CHANGES_TABLE} (consumer, app, resource_type, seq)`;

// Failed changes are rare, so a partial index keeps "is anything failing?"
// instant even while a large backlog is pending.
const RESOURCE_CHANGES_FAILED_INDEX_SQL = `CREATE INDEX IF NOT EXISTS app_resource_changes_failed_idx ON ${RESOURCE_CHANGES_TABLE} (consumer, app, resource_type) WHERE failed_at IS NOT NULL`;

const RESOURCE_CHANGE_SEQUENCE_SQL = `CREATE SEQUENCE IF NOT EXISTS ${RESOURCE_CHANGE_SEQUENCE}`;

// `nextval` in DO UPDATE runs after the conflicting row is locked, so a later
// writer to the same resource always gets a larger seq than the one it waited
// on. Resetting `available_at` makes a leased row claimable again, and the
// seq check on delete keeps the earlier claimant from dropping it.
const RESOURCE_CHANGED_FUNCTION_SQL = `
  CREATE OR REPLACE FUNCTION ${RESOURCE_CHANGED_FUNCTION}(
    p_app TEXT, p_resource_type TEXT, p_resource_id TEXT, p_reason TEXT
  ) RETURNS void LANGUAGE sql AS $an_resource_changed$
    INSERT INTO ${RESOURCE_CHANGES_TABLE} AS existing
      (consumer, app, resource_type, resource_id, reason, seq, changed_at, available_at, attempts, failed_at)
    SELECT consumer, p_app, p_resource_type, p_resource_id, p_reason,
      nextval('${RESOURCE_CHANGE_SEQUENCE}'), clock_timestamp(), clock_timestamp(), 0, NULL
    FROM ${RESOURCE_CHANGE_CONSUMERS_TABLE}
    WHERE app = p_app AND resource_type = p_resource_type
    ON CONFLICT (consumer, app, resource_type, resource_id) DO UPDATE SET
      reason = EXCLUDED.reason,
      seq = nextval('${RESOURCE_CHANGE_SEQUENCE}'),
      changed_at = EXCLUDED.changed_at,
      available_at = EXCLUDED.available_at,
      attempts = 0,
      failed_at = NULL
  $an_resource_changed$
`;

let ensured: Promise<void> | undefined;

/**
 * Creates the feed's tables, sequence, and producer function. Listed in
 * `server/release-schema.ts`; trigger installation calls it too, so the
 * function a trigger calls always exists before the trigger does.
 */
export function ensureResourceChangeTables(
  injectedClient?: DbExec,
): Promise<void> {
  if (injectedClient) return ensureAll(injectedClient);
  ensured ??= ensureAll().catch((error) => {
    ensured = undefined;
    throw error;
  });
  return ensured;
}

async function ensureAll(injectedClient?: DbExec): Promise<void> {
  const options = { injectedClient };
  await ensureTableExists(
    RESOURCE_CHANGE_CONSUMERS_TABLE,
    RESOURCE_CHANGE_CONSUMERS_CREATE_SQL,
    options,
  );
  await ensureTableExists(
    RESOURCE_CHANGES_TABLE,
    RESOURCE_CHANGES_CREATE_SQL,
    options,
  );
  await ensureIndexExists(
    "app_resource_changes_seq_idx",
    RESOURCE_CHANGES_ORDER_INDEX_SQL,
    options,
  );
  await ensureIndexExists(
    "app_resource_changes_failed_idx",
    RESOURCE_CHANGES_FAILED_INDEX_SQL,
    options,
  );
  await ensureSchemaObject({
    probe: () =>
      catalogHas(
        `SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = ?`,
        RESOURCE_CHANGE_SEQUENCE,
        injectedClient,
      ),
    ddl: RESOURCE_CHANGE_SEQUENCE_SQL,
    label: `sequence ${RESOURCE_CHANGE_SEQUENCE}`,
    injectedClient,
  });
  await ensureSchemaObject({
    probe: () =>
      catalogHas(
        `SELECT 1 FROM pg_proc WHERE proname = ?`,
        RESOURCE_CHANGED_FUNCTION,
        injectedClient,
      ),
    ddl: RESOURCE_CHANGED_FUNCTION_SQL,
    label: `function ${RESOURCE_CHANGED_FUNCTION}`,
    injectedClient,
  });
}

async function catalogHas(
  sql: string,
  name: string,
  injectedClient?: DbExec,
): Promise<boolean | undefined> {
  try {
    const { rows } = await (injectedClient ?? getDbExec()).execute({
      sql,
      args: [name],
    });
    return rows.length > 0;
  } catch {
    // coercion-ok: an unreadable catalog is not evidence of absence;
    // ensureSchemaObject fails closed on undefined.
    return undefined;
  }
}

/** Where a registered resource lives, for generating its triggers. */
export interface ResourceChangeSource {
  app: string;
  resourceType: string;
  table: string;
  idColumn: string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEY = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function assertIdentifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a plain SQL identifier, got "${value}".`);
  }
  return value;
}

export function assertResourceKey(value: string, label: string): string {
  if (!KEY.test(value)) {
    throw new Error(
      `${label} must be lowercase letters, numbers, "-" or "_", got "${value}".`,
    );
  }
  return value;
}

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const UINT64 = 0xffffffffffffffffn;

/** 64-bit FNV-1a, as 16 hex digits. */
function shortHash(value: string): string {
  let hash = FNV64_OFFSET;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * FNV64_PRIME) & UINT64;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Names of the function and triggers generated for one source. Functions are
 * schema-wide and the readable part is shortened to fit Postgres's 63
 * characters, so a hash of the app, table, and type keeps every source's
 * names distinct. Installing a source replaces whatever has its names, so
 * the hash is wide enough that two sources never share them.
 */
export function resourceChangeTriggerNames(source: ResourceChangeSource) {
  const table = assertIdentifier(source.table, "Resource table");
  const app = assertResourceKey(source.app, "App");
  const type = assertResourceKey(source.resourceType, "Resource type");
  const readable = `an_rc_${table}__${type.replace(/-/g, "_")}`.slice(0, 42);
  const base = `${readable}_${shortHash(`${app}\u0000${table}\u0000${type}`)}`;
  return {
    function: base,
    insertDeleteTrigger: `${base}_iud`,
    updateTrigger: `${base}_upd`,
    truncateTrigger: `${base}_trn`,
  };
}

/**
 * SQL that makes every committed insert, update, delete, and truncate on the
 * source table call the producer function. An update that changes nothing is
 * skipped. An update that changes the id reports both ids. A truncate
 * reports every row it removes as deleted.
 *
 * "Changes nothing" compares the rows' stored bytes (`*<>`), not their
 * values: a `json` or `point` column has no equality operator, and comparing
 * such rows by value would make every update on the table fail.
 *
 * Triggers are replaced in place, never dropped and recreated: a write
 * committed between a drop and a create would never be recorded.
 */
export function resourceChangeTriggerSql(
  source: ResourceChangeSource,
): string[] {
  const table = assertIdentifier(source.table, "Resource table");
  const id = assertIdentifier(source.idColumn, "Resource id column");
  const app = assertResourceKey(source.app, "App");
  const type = assertResourceKey(source.resourceType, "Resource type");
  const names = resourceChangeTriggerNames(source);
  const changed = (row: string, reason: string) =>
    `${RESOURCE_CHANGED_FUNCTION}('${app}', '${type}', ${row}."${id}"::text, '${reason}')`;
  return [
    `CREATE OR REPLACE FUNCTION "${names.function}"() RETURNS trigger LANGUAGE plpgsql AS $an_rc$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    PERFORM ${changed("truncated", "delete")} FROM "${table}" AS truncated;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM ${changed("NEW", "insert")};
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM ${changed("OLD", "delete")};
  ELSE
    IF OLD."${id}" IS DISTINCT FROM NEW."${id}" THEN
      PERFORM ${changed("OLD", "delete")};
    END IF;
    PERFORM ${changed("NEW", "update")};
  END IF;
  RETURN NULL;
END
$an_rc$`,
    `CREATE OR REPLACE TRIGGER "${names.insertDeleteTrigger}" AFTER INSERT OR DELETE ON "${table}" FOR EACH ROW EXECUTE FUNCTION "${names.function}"()`,
    `CREATE OR REPLACE TRIGGER "${names.updateTrigger}" AFTER UPDATE ON "${table}" FOR EACH ROW WHEN (OLD *<> NEW) EXECUTE FUNCTION "${names.function}"()`,
    `CREATE OR REPLACE TRIGGER "${names.truncateTrigger}" BEFORE TRUNCATE ON "${table}" FOR EACH STATEMENT EXECUTE FUNCTION "${names.function}"()`,
  ];
}

/** A hash of the capture SQL for a source, which changes whenever it does. */
export function resourceChangeCaptureFingerprint(
  source: ResourceChangeSource,
): string {
  return shortHash(resourceChangeTriggerSql(source).join("\n"));
}

/**
 * Installs change capture for a source and subscribes a consumer to it.
 * Apps call this from a named migration, so the triggers ship with the app's
 * schema rather than being created on a request path.
 *
 * Creating a trigger waits for every open transaction on the table, and
 * queues the table's writes behind it while it waits, so each waits at most
 * a few seconds. Returns false when one gave up; the caller retries later.
 */
export async function installResourceChangeCapture(
  exec: DbExec,
  source: ResourceChangeSource,
  consumer: string,
): Promise<boolean> {
  await ensureResourceChangeTables(exec);
  await subscribeResourceChangeConsumer(exec, source, consumer);
  for (const statement of resourceChangeTriggerSql(source)) {
    const applied = await runGuardedDdl(statement, {
      lockTimeout: "3s",
      injectedClient: exec,
    });
    if (!applied) return false;
  }
  return true;
}

export async function subscribeResourceChangeConsumer(
  exec: DbExec,
  source: Pick<ResourceChangeSource, "app" | "resourceType">,
  consumer: string,
): Promise<void> {
  await exec.execute({
    sql: `INSERT INTO ${RESOURCE_CHANGE_CONSUMERS_TABLE} (app, resource_type, consumer) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
    args: [source.app, source.resourceType, consumer],
  });
}

/**
 * True when every generated trigger exists on the source table and fires.
 * A disabled trigger (`ALTER TABLE ... DISABLE TRIGGER`) records nothing, so
 * it counts as missing.
 */
export async function resourceChangeCaptureInstalled(
  exec: DbExec,
  source: ResourceChangeSource,
): Promise<boolean> {
  const names = resourceChangeTriggerNames(source);
  const { rows } = await exec.execute({
    sql: `SELECT t.tgname
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = ? AND t.tgname IN (?, ?, ?)
            AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')`,
    args: [
      source.table,
      names.insertDeleteTrigger,
      names.updateTrigger,
      names.truncateTrigger,
    ],
  });
  return rows.length === 3;
}

export interface ResourceChangeFeed {
  consumer: string;
  app: string;
  resourceType: string;
}

export interface ClaimedResourceChange {
  resourceId: string;
  seq: string;
  attempts: number;
}

/**
 * A condition a consumer attaches to its claim, complete, and fail
 * statements. It is checked inside each statement, so once it stops holding,
 * those statements change nothing. Search uses it so a process running an
 * older index version can't consume changes queued for a newer one.
 */
export interface ResourceChangeFence {
  sql: string;
  args: unknown[];
}

function fenced(fence: ResourceChangeFence | undefined) {
  return fence
    ? { sql: ` AND ${fence.sql}`, args: fence.args }
    : { sql: "", args: [] };
}

/**
 * Leases up to `limit` ready changes, oldest first. Rows another claimant is
 * locking right now are skipped, and the lease expires on its own if this
 * process dies, so there is nothing to clean up.
 */
export async function claimResourceChanges(
  exec: DbExec,
  feed: ResourceChangeFeed,
  limit: number,
  fence?: ResourceChangeFence,
): Promise<ClaimedResourceChange[]> {
  const guard = fenced(fence);
  // The pick is an uncorrelated ARRAY(...) sub-select, which Postgres runs
  // once, and the update then finds each row by its full primary key. Two
  // other shapes go wrong: a subquery in FROM can be rescanned inside a
  // nested loop, and each rescan skips the rows it already locked and takes
  // the next ones, claiming far past the limit; and any join back to this
  // table depends on statistics, which PGlite never gathers, so it can
  // compare every pending row against every picked one.
  const { rows } = await exec.execute({
    sql: `UPDATE ${RESOURCE_CHANGES_TABLE} AS c
          SET available_at = clock_timestamp() + interval '${CLAIM_LEASE_SECONDS} seconds',
              attempts = c.attempts + 1
          WHERE c.consumer = ? AND c.app = ? AND c.resource_type = ?
            AND c.resource_id = ANY (ARRAY(
              SELECT resource_id FROM ${RESOURCE_CHANGES_TABLE}
              WHERE consumer = ? AND app = ? AND resource_type = ?
                AND available_at <= clock_timestamp()
              ORDER BY seq
              LIMIT ?
              FOR UPDATE SKIP LOCKED
            ))${guard.sql}
          RETURNING c.resource_id, c.seq::text AS seq, c.attempts`,
    args: [
      feed.consumer,
      feed.app,
      feed.resourceType,
      feed.consumer,
      feed.app,
      feed.resourceType,
      limit,
      ...guard.args,
    ],
  });
  return rows
    .map((row) => ({
      resourceId: String(row.resource_id),
      seq: String(row.seq),
      attempts: Number(row.attempts),
    }))
    .sort((a, b) => compareSeq(a.seq, b.seq));
}

export function compareSeq(a: string, b: string): number {
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Claimed changes as a VALUES list for seq-guarded statements, plus an id
 * list. The id list lets Postgres find the rows by primary key; without it,
 * a join against VALUES can scan every pending row when the table has no
 * statistics, as in PGlite.
 */
function valuesList(changes: readonly ClaimedResourceChange[]) {
  return {
    sql: changes.map(() => "(?, ?::bigint)").join(", "),
    args: changes.flatMap((change) => [change.resourceId, change.seq]),
    ids: changes.map(() => "?").join(", "),
    idArgs: changes.map((change) => change.resourceId),
  };
}

/**
 * Deletes processed changes, but only rows whose seq is still the one that
 * was claimed. A change recorded meanwhile stays for the next pass.
 */
export async function completeResourceChanges(
  exec: DbExec,
  feed: ResourceChangeFeed,
  changes: readonly ClaimedResourceChange[],
  fence?: ResourceChangeFence,
): Promise<void> {
  if (!changes.length) return;
  const values = valuesList(changes);
  const guard = fenced(fence);
  await exec.execute({
    sql: `DELETE FROM ${RESOURCE_CHANGES_TABLE} AS c
          USING (VALUES ${values.sql}) AS done (resource_id, seq)
          WHERE c.consumer = ? AND c.app = ? AND c.resource_type = ?
            AND c.resource_id IN (${values.ids})
            AND c.resource_id = done.resource_id AND c.seq = done.seq${guard.sql}`,
    args: [
      ...values.args,
      feed.consumer,
      feed.app,
      feed.resourceType,
      ...values.idArgs,
      ...guard.args,
    ],
  });
}

/**
 * Backs off failed changes, doubling the wait up to five minutes. After the
 * last allowed attempt a change is also marked failed, which a consumer can
 * report, but it keeps being retried: a failure that was only temporary
 * clears itself, and a later write to the resource starts it fresh.
 */
export async function failResourceChanges(
  exec: DbExec,
  feed: ResourceChangeFeed,
  changes: readonly ClaimedResourceChange[],
  fence?: ResourceChangeFence,
): Promise<void> {
  if (!changes.length) return;
  const values = valuesList(changes);
  const guard = fenced(fence);
  await exec.execute({
    sql: `UPDATE ${RESOURCE_CHANGES_TABLE} AS c
          SET available_at = clock_timestamp() + make_interval(secs => least(${MAX_RETRY_SECONDS}, 5 * power(2, least(c.attempts, ${MAX_BACKOFF_DOUBLINGS})))),
              failed_at = CASE WHEN c.attempts >= ${RESOURCE_CHANGE_MAX_ATTEMPTS} THEN coalesce(c.failed_at, clock_timestamp()) ELSE c.failed_at END
          FROM (VALUES ${values.sql}) AS failed (resource_id, seq)
          WHERE c.consumer = ? AND c.app = ? AND c.resource_type = ?
            AND c.resource_id IN (${values.ids})
            AND c.resource_id = failed.resource_id AND c.seq = failed.seq${guard.sql}`,
    args: [
      ...values.args,
      feed.consumer,
      feed.app,
      feed.resourceType,
      ...values.idArgs,
      ...guard.args,
    ],
  });
}

/**
 * Two boolean columns for a caller's own SELECT, so checking the feed costs
 * no extra round trip: `pending` while any change is waiting, leased, or
 * backing off, and `failing` while any has used up its attempts.
 */
export function resourceChangeBacklogColumns(feed: ResourceChangeFeed): {
  sql: string;
  args: unknown[];
} {
  const where = `consumer = ? AND app = ? AND resource_type = ?`;
  const args = [feed.consumer, feed.app, feed.resourceType];
  return {
    sql: `EXISTS (SELECT 1 FROM ${RESOURCE_CHANGES_TABLE} WHERE ${where}) AS pending,
          EXISTS (SELECT 1 FROM ${RESOURCE_CHANGES_TABLE} WHERE ${where} AND failed_at IS NOT NULL) AS failing`,
    args: [...args, ...args],
  };
}

/** True while any change at or below `seq` is still pending for this feed. */
export async function hasPendingResourceChanges(
  exec: DbExec,
  feed: ResourceChangeFeed,
  options: { atOrBelowSeq?: string } = {},
): Promise<boolean> {
  const bound =
    options.atOrBelowSeq === undefined ? "" : " AND seq <= ?::bigint";
  const { rows } = await exec.execute({
    sql: `SELECT 1 FROM ${RESOURCE_CHANGES_TABLE}
          WHERE consumer = ? AND app = ? AND resource_type = ?${bound}
          LIMIT 1`,
    args: [
      feed.consumer,
      feed.app,
      feed.resourceType,
      ...(options.atOrBelowSeq === undefined ? [] : [options.atOrBelowSeq]),
    ],
  });
  return rows.length > 0;
}

/**
 * Records a change for every row of the source table, for this consumer
 * only, and returns a seq at or above every one it assigned. Consumers use
 * it to rebuild from scratch.
 *
 * A change already queued is replaced by a fresh one, even if another
 * process has it leased or it has failed: that work was done for the old
 * consumer state, so it must not complete what the rebuild queued.
 */
export async function enqueueAllResourceChanges(
  exec: DbExec,
  source: ResourceChangeSource,
  consumer: string,
  reason: string,
): Promise<string> {
  const table = assertIdentifier(source.table, "Resource table");
  const id = assertIdentifier(source.idColumn, "Resource id column");
  // As in the producer function, the replacement seq is taken after the
  // row lock, so it is newer than any change a writer committed meanwhile.
  await exec.execute({
    sql: `INSERT INTO ${RESOURCE_CHANGES_TABLE} (consumer, app, resource_type, resource_id, reason, seq)
          SELECT ?, ?, ?, "${id}"::text, ?, nextval('${RESOURCE_CHANGE_SEQUENCE}') FROM "${table}"
          ON CONFLICT (consumer, app, resource_type, resource_id) DO UPDATE SET
            reason = EXCLUDED.reason,
            seq = nextval('${RESOURCE_CHANGE_SEQUENCE}'),
            changed_at = clock_timestamp(),
            available_at = clock_timestamp(),
            attempts = 0,
            failed_at = NULL`,
    args: [consumer, source.app, source.resourceType, reason],
  });
  const { rows } = await exec.execute(
    `SELECT nextval('${RESOURCE_CHANGE_SEQUENCE}')::text AS seq`,
  );
  return String(rows[0]?.seq);
}

type DrainHook = () => Promise<unknown>;
const afterWriteDrains = new Map<string, DrainHook>();

/**
 * Registers work to run right after a request that changed data, while the
 * database is known to be awake. Returns an unregister function.
 */
export function registerAfterWriteDrain(
  id: string,
  drain: DrainHook,
): () => void {
  afterWriteDrains.set(id, drain);
  return () => {
    if (afterWriteDrains.get(id) === drain) afterWriteDrains.delete(id);
  };
}

/**
 * Runs registered after-write drains without delaying the caller. On
 * serverless the request's `waitUntil` keeps the function alive for them.
 */
export function runAfterWriteDrains(
  waitUntil?: (promise: Promise<unknown>) => void,
): void {
  if (afterWriteDrains.size === 0) return;
  const work = Promise.allSettled(
    [...afterWriteDrains.entries()].map(async ([id, drain]) => {
      try {
        await drain();
      } catch (error) {
        console.warn(
          `[resource-changes] after-write drain ${id} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }),
  );
  if (waitUntil) waitUntil(work);
  else void work;
}
