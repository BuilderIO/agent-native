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
 * Consumers never poll. They process changes only where the database is
 * already awake: before a read that needs fresh data, right after a write, or
 * inside the framework's recurring sweep. See docs/search-architecture.md.
 */
import { getDbExec, type DbExec } from "../db/client.js";
import {
  ensureIndexExists,
  ensureSchemaObject,
  ensureTableExists,
} from "../db/ddl-guard.js";

export const RESOURCE_CHANGES_TABLE = "app_resource_changes";
export const RESOURCE_CHANGE_CONSUMERS_TABLE = "app_resource_change_consumers";
export const RESOURCE_CHANGE_SEQUENCE = "app_resource_change_seq";
export const RESOURCE_CHANGED_FUNCTION = "agent_native_app_resource_changed";

/** A change is retried this many times before it is parked as failed. */
export const RESOURCE_CHANGE_MAX_ATTEMPTS = 5;
const CLAIM_LEASE_SECONDS = 60;

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

/** Names of the function and triggers generated for one source. */
export function resourceChangeTriggerNames(source: ResourceChangeSource) {
  const table = assertIdentifier(source.table, "Resource table");
  const base =
    `an_rc_${table}__${assertResourceKey(source.resourceType, "Resource type").replace(/-/g, "_")}`.slice(
      0,
      56,
    );
  return {
    function: base,
    insertDeleteTrigger: `${base}_iud`,
    updateTrigger: `${base}_upd`,
  };
}

/**
 * SQL that makes every committed insert, update, and delete on the source
 * table call the producer function. An update that changes nothing is
 * skipped. An update that changes the id reports both ids.
 */
export function resourceChangeTriggerSql(
  source: ResourceChangeSource,
): string[] {
  const table = assertIdentifier(source.table, "Resource table");
  const id = assertIdentifier(source.idColumn, "Resource id column");
  const app = assertResourceKey(source.app, "App");
  const type = assertResourceKey(source.resourceType, "Resource type");
  const names = resourceChangeTriggerNames(source);
  const changed = (row: "NEW" | "OLD", reason: string) =>
    `PERFORM ${RESOURCE_CHANGED_FUNCTION}('${app}', '${type}', ${row}."${id}"::text, '${reason}');`;
  return [
    `CREATE OR REPLACE FUNCTION "${names.function}"() RETURNS trigger LANGUAGE plpgsql AS $an_rc$
BEGIN
  IF TG_OP = 'INSERT' THEN
    ${changed("NEW", "insert")}
  ELSIF TG_OP = 'DELETE' THEN
    ${changed("OLD", "delete")}
  ELSE
    IF OLD."${id}" IS DISTINCT FROM NEW."${id}" THEN
      ${changed("OLD", "delete")}
    END IF;
    ${changed("NEW", "update")}
  END IF;
  RETURN NULL;
END
$an_rc$`,
    `DROP TRIGGER IF EXISTS "${names.insertDeleteTrigger}" ON "${table}"`,
    `CREATE TRIGGER "${names.insertDeleteTrigger}" AFTER INSERT OR DELETE ON "${table}" FOR EACH ROW EXECUTE FUNCTION "${names.function}"()`,
    `DROP TRIGGER IF EXISTS "${names.updateTrigger}" ON "${table}"`,
    `CREATE TRIGGER "${names.updateTrigger}" AFTER UPDATE ON "${table}" FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION "${names.function}"()`,
  ];
}

/**
 * Installs change capture for a source and subscribes a consumer to it.
 * Apps call this from a named migration, so the triggers ship with the app's
 * schema rather than being created on a request path.
 */
export async function installResourceChangeCapture(
  exec: DbExec,
  source: ResourceChangeSource,
  consumer: string,
): Promise<void> {
  await ensureResourceChangeTables(exec);
  await subscribeResourceChangeConsumer(exec, source, consumer);
  for (const statement of resourceChangeTriggerSql(source)) {
    await exec.execute(statement);
  }
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

/** True when both generated triggers exist on the source table. */
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
          WHERE n.nspname = 'public' AND c.relname = ? AND t.tgname IN (?, ?) AND NOT t.tgisinternal`,
    args: [source.table, names.insertDeleteTrigger, names.updateTrigger],
  });
  return rows.length === 2;
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
 * Leases up to `limit` ready changes, oldest first. Rows another claimant is
 * locking right now are skipped, and the lease expires on its own if this
 * process dies, so there is nothing to clean up.
 */
export async function claimResourceChanges(
  exec: DbExec,
  feed: ResourceChangeFeed,
  limit: number,
): Promise<ClaimedResourceChange[]> {
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
                AND failed_at IS NULL AND available_at <= clock_timestamp()
              ORDER BY seq
              LIMIT ?
              FOR UPDATE SKIP LOCKED
            ))
          RETURNING c.resource_id, c.seq::text AS seq, c.attempts`,
    args: [
      feed.consumer,
      feed.app,
      feed.resourceType,
      feed.consumer,
      feed.app,
      feed.resourceType,
      limit,
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
): Promise<void> {
  if (!changes.length) return;
  const values = valuesList(changes);
  await exec.execute({
    sql: `DELETE FROM ${RESOURCE_CHANGES_TABLE} AS c
          USING (VALUES ${values.sql}) AS done (resource_id, seq)
          WHERE c.consumer = ? AND c.app = ? AND c.resource_type = ?
            AND c.resource_id IN (${values.ids})
            AND c.resource_id = done.resource_id AND c.seq = done.seq`,
    args: [
      ...values.args,
      feed.consumer,
      feed.app,
      feed.resourceType,
      ...values.idArgs,
    ],
  });
}

/**
 * Backs off failed changes. After the last attempt a change is parked with
 * `failed_at` so one bad row can't hold the rest of the feed hostage; a
 * later write to the same resource clears it.
 */
export async function failResourceChanges(
  exec: DbExec,
  feed: ResourceChangeFeed,
  changes: readonly ClaimedResourceChange[],
): Promise<void> {
  if (!changes.length) return;
  const values = valuesList(changes);
  await exec.execute({
    sql: `UPDATE ${RESOURCE_CHANGES_TABLE} AS c
          SET available_at = clock_timestamp() + make_interval(secs => least(300, 5 * power(2, c.attempts))),
              failed_at = CASE WHEN c.attempts >= ${RESOURCE_CHANGE_MAX_ATTEMPTS} THEN clock_timestamp() ELSE NULL END
          FROM (VALUES ${values.sql}) AS failed (resource_id, seq)
          WHERE c.consumer = ? AND c.app = ? AND c.resource_type = ?
            AND c.resource_id IN (${values.ids})
            AND c.resource_id = failed.resource_id AND c.seq = failed.seq`,
    args: [
      ...values.args,
      feed.consumer,
      feed.app,
      feed.resourceType,
      ...values.idArgs,
    ],
  });
}

/** True while any unparked change is waiting or leased for this feed. */
export async function hasPendingResourceChanges(
  exec: DbExec,
  feed: ResourceChangeFeed,
  options: { atOrBelowSeq?: string } = {},
): Promise<boolean> {
  const bound =
    options.atOrBelowSeq === undefined ? "" : " AND seq <= ?::bigint";
  const { rows } = await exec.execute({
    sql: `SELECT 1 FROM ${RESOURCE_CHANGES_TABLE}
          WHERE consumer = ? AND app = ? AND resource_type = ? AND failed_at IS NULL${bound}
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
 * only, and returns a seq at or above every one it assigned. Existing rows
 * keep their place. Consumers use it to rebuild from scratch.
 */
export async function enqueueAllResourceChanges(
  exec: DbExec,
  source: ResourceChangeSource,
  consumer: string,
  reason: string,
): Promise<string> {
  const table = assertIdentifier(source.table, "Resource table");
  const id = assertIdentifier(source.idColumn, "Resource id column");
  await exec.execute({
    sql: `INSERT INTO ${RESOURCE_CHANGES_TABLE} (consumer, app, resource_type, resource_id, reason, seq)
          SELECT ?, ?, ?, "${id}"::text, ?, nextval('${RESOURCE_CHANGE_SEQUENCE}') FROM "${table}"
          ON CONFLICT (consumer, app, resource_type, resource_id) DO NOTHING`,
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
