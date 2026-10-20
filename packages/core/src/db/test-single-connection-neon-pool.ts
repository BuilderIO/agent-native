export const SINGLE_CONNECTION_NEON_URL =
  "postgres://user:password@ep-test-pooler.us-east-1.aws.neon.tech/neondb";

/**
 * A Neon pool of exactly one connection, the size `databasePoolMax()` gives
 * every serverless host, backed by PGlite so real SQL runs. `connect()` queues
 * behind the holder the way pg-pool does: a caller that needs a second
 * connection while the first is checked out waits until something releases it.
 *
 * Seed it with `sharedDbPool("neon", url, () => pool)` before anything opens a
 * database handle, so `getDbExec()`, `createGetDb()` and Better Auth all share
 * it as they do in production.
 */
export async function createSingleConnectionNeonPool() {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const { Pool } = await import("@neondatabase/serverless");
  // drizzle's neon driver reads timestamps back as strings.
  const identity = (value: string) => value;
  const pglite = await PGlite.create({
    parsers: {
      [types.TIMESTAMP]: identity,
      [types.TIMESTAMPTZ]: identity,
      [types.DATE]: identity,
    },
  });

  let holder: object | undefined;
  const waiters: Array<(client: object) => void> = [];
  const stats = { checkouts: 0, maxWaiting: 0 };

  const checkout = (): object => {
    stats.checkouts += 1;
    return {
      async query(
        config:
          | string
          | { text: string; rowMode?: "array"; values?: unknown[] },
        values?: unknown[],
      ) {
        const text = typeof config === "string" ? config : config.text;
        const rowMode = typeof config === "string" ? undefined : config.rowMode;
        const params =
          values ?? (typeof config === "string" ? [] : config.values) ?? [];
        if (params.length === 0 && /;\s*\S/.test(text)) {
          await pglite.exec(text);
          return { rows: [], rowCount: 0, fields: [] };
        }
        const result = await pglite.query(
          text,
          params,
          rowMode ? { rowMode } : undefined,
        );
        return {
          rows: result.rows,
          rowCount: result.affectedRows ?? result.rows.length,
          fields: result.fields,
        };
      },
      release() {
        holder = undefined;
        const next = waiters.shift();
        if (!next) return;
        holder = checkout();
        next(holder);
      },
    };
  };

  class SingleConnectionPool extends Pool {
    constructor() {
      super({ connectionString: SINGLE_CONNECTION_NEON_URL, max: 1 });
    }
    connect(): Promise<any> {
      if (!holder) {
        holder = checkout();
        return Promise.resolve(holder);
      }
      return new Promise((resolve) => {
        waiters.push(resolve);
        stats.maxWaiting = Math.max(stats.maxWaiting, waiters.length);
      });
    }
    end(): Promise<void> {
      return Promise.resolve();
    }
  }

  return { pool: new SingleConnectionPool(), pglite, stats };
}
