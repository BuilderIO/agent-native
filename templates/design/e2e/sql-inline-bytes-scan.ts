import type { TestInfo } from "@playwright/test";

/** One SQL cell whose text looks like inline file bytes. */
export type InlineBytesHit = {
  table: string;
  column: string;
  row: string;
  digest: string;
  sample: string;
};

export type InlineBytesScan = {
  tables: string[];
  columnCount: number;
  hits: InlineBytesHit[];
};

export type ChatRows = {
  threads: Array<{ id: string; thread_data: string }>;
  runs: Array<Record<string, unknown>>;
  events: Array<{ run_id: string; seq: number; event_data: string }>;
};

/** One `application_state` canary per scanner pattern, keyed by row key. */
export const CANARY_SESSION_ID = "e2e-inline-bytes-canary";
export const INLINE_BYTES_CANARIES: Record<string, string> = {
  "uppercase-base64-marker": '{"note":"BASE64,QUJD"}',
  "unencoded-image-data-url": '{"src":"Data:Image/svg+xml,<svg/>"}',
  "pdf-data-url": '{"src":"data:application/pdf,%25PDF"}',
  "bare-png-base64-body": '{"body":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"}',
};
const THREAD_CANARY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

type ServerRequestInput =
  | { kind: "scan" }
  | { kind: "chat-rows"; marker: string }
  | {
      kind: "poisoned-scan";
      threadId: string;
      sessionId: string;
      canaries: Record<string, string>;
      threadCanary: string;
    };
type ServerRequest = ServerRequestInput & { databaseUrl: string };

// Evaluated inside the Design API server process, so it must not reference
// anything outside its own body. Running there is what lets one path read
// both CI's Postgres and the local PGlite directory, which admits only the
// process that already holds it open.
async function inDesignServer(request: ServerRequest): Promise<unknown> {
  if (process.env.DATABASE_URL !== request.databaseUrl) {
    throw new Error(
      `The inspector reached a process using ${process.env.DATABASE_URL ?? "no database"}, not the E2E database ${request.databaseUrl}.`,
    );
  }
  const { createRequire } = process.getBuiltinModule(
    "node:module",
  ) as typeof import("node:module");
  const { createDbExec } = createRequire(`${process.cwd()}/package.json`)(
    "@agent-native/core/db",
  ) as typeof import("@agent-native/core/db");
  type Exec = Awaited<ReturnType<typeof createDbExec>>;
  const db = await createDbExec({ url: request.databaseUrl });
  const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
  const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const inList = (values: unknown[]) => values.map(() => "?").join(", ");

  async function scan(exec: Exec): Promise<InlineBytesScan> {
    const { rows: columns } = await exec.execute(`
      SELECT c.table_schema, c.table_name, c.column_name, c.data_type
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE t.table_type = 'BASE TABLE'
        AND c.table_schema <> 'information_schema'
        AND left(c.table_schema, 3) <> 'pg_'
        AND c.data_type IN ('text', 'character varying', 'character', 'json',
          'jsonb', 'xml', 'ARRAY', 'USER-DEFINED', 'bytea')
      ORDER BY c.table_schema, c.table_name, c.ordinal_position`);
    const { rows: keyColumns } = await exec.execute(`
      SELECT k.table_schema, k.table_name, k.column_name
      FROM information_schema.table_constraints c
      JOIN information_schema.key_column_usage k
        ON k.constraint_schema = c.constraint_schema
        AND k.constraint_name = c.constraint_name
      WHERE c.constraint_type = 'PRIMARY KEY'
      ORDER BY k.ordinal_position`);
    type Table = {
      schema: string;
      name: string;
      cells: string[];
      keys: string[];
    };
    const tables = new Map<string, Table>();
    for (const column of columns) {
      const id = `${column.table_schema}.${column.table_name}`;
      const table: Table = tables.get(id) ?? {
        schema: column.table_schema,
        name: column.table_name,
        cells: [],
        keys: [],
      };
      const value =
        column.data_type === "bytea"
          ? `encode(t.${quote(column.column_name)}, 'escape')`
          : `t.${quote(column.column_name)}::text`;
      table.cells.push(`(${literal(column.column_name)}, ${value})`);
      tables.set(id, table);
    }
    for (const key of keyColumns) {
      tables
        .get(`${key.table_schema}.${key.table_name}`)
        ?.keys.push(`t.${quote(key.column_name)}::text`);
    }

    const hits: InlineBytesHit[] = [];
    for (const table of tables.values()) {
      const rowKey = table.keys.length
        ? `concat_ws('|', ${table.keys.join(", ")})`
        : "t.ctid::text";
      const { rows } = await exec.execute({
        sql: `SELECT ${rowKey} AS row_key, cell.column_name, cell.cell_value,
            md5(cell.cell_value) AS digest
          FROM ${quote(table.schema)}.${quote(table.name)} AS t
          CROSS JOIN LATERAL (VALUES ${table.cells.join(", ")})
            AS cell(column_name, cell_value)
          WHERE cell.cell_value ~* ? OR strpos(cell.cell_value, ?) > 0`,
        // The PNG signature's base64 is case-sensitive; the URL markers are not.
        args: ["base64,|data:image|data:application/pdf", "iVBORw0KGgo"],
      });
      for (const row of rows) {
        const value = String(row.cell_value);
        const at = Math.max(
          0,
          value.search(/base64,|data:image|data:application\/pdf|iVBORw0KGgo/i),
        );
        hits.push({
          table:
            table.schema === "public"
              ? table.name
              : `${table.schema}.${table.name}`,
          column: String(row.column_name),
          row: String(row.row_key),
          digest: String(row.digest),
          sample: value.slice(Math.max(0, at - 40), at + 80),
        });
      }
    }
    return {
      tables: [...tables.values()].map((table) => table.name),
      columnCount: columns.length,
      hits,
    };
  }

  try {
    if (request.kind === "scan") return await scan(db);

    if (request.kind === "chat-rows") {
      const { rows: threads } = await db.execute({
        sql: "SELECT id, thread_data FROM chat_threads WHERE strpos(thread_data, ?) > 0",
        args: [request.marker],
      });
      const threadIds = threads.map((thread) => thread.id);
      const { rows: runs } = threadIds.length
        ? await db.execute({
            sql: `SELECT * FROM agent_runs WHERE thread_id IN (${inList(threadIds)})`,
            args: threadIds,
          })
        : { rows: [] };
      const runIds = runs.map((run) => run.id);
      const { rows: events } = runIds.length
        ? await db.execute({
            sql: `SELECT run_id, seq, event_data FROM agent_run_events WHERE run_id IN (${inList(runIds)}) ORDER BY run_id, seq`,
            args: runIds,
          })
        : { rows: [] };
      return { threads, runs, events };
    }

    const rollback = new Error("roll back the poisoned rows");
    let poisoned: InlineBytesScan | undefined;
    try {
      await db.transaction!(async (tx) => {
        for (const [key, value] of Object.entries(request.canaries)) {
          await tx.execute({
            sql: "INSERT INTO application_state (session_id, key, value, updated_at) VALUES (?, ?, ?, ?)",
            args: [request.sessionId, key, value, Date.now()],
          });
        }
        const thread = await tx.execute({
          sql: "UPDATE chat_threads SET thread_data = thread_data || ? WHERE id = ?",
          args: [request.threadCanary, request.threadId],
        });
        if (thread.rowsAffected !== 1) {
          throw new Error(
            `Poisoning chat thread ${request.threadId} changed ${thread.rowsAffected} rows.`,
          );
        }
        poisoned = await scan(tx);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    return { poisoned, afterRollback: await scan(db) };
  } finally {
    await db.close?.();
  }
}

async function evaluateInDesignServer<T>(
  testInfo: TestInfo,
  input: ServerRequestInput,
): Promise<T> {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (process.env.E2E_BASE_URL || !databaseUrl) {
    throw new Error(
      "The SQL scan reads the database through the inspector of the dev server Playwright starts; it cannot scan an E2E_BASE_URL server.",
    );
  }
  const request: ServerRequest = { ...input, databaseUrl };
  const port = testInfo.config.metadata.serverInspectPort as number;
  const targets = (await (
    await fetch(
      `http://127.0.0.1:${port}/json/list`, // e2e-harness-ignore: the dev server's Node inspector, not the Design base URL.
    )
  ).json()) as Array<{ webSocketDebuggerUrl?: string }>;
  const debuggerUrl = targets[0]?.webSocketDebuggerUrl;
  if (targets.length !== 1 || !debuggerUrl) {
    throw new Error(
      `Expected the Design API server as the only inspector target on port ${port}, found ${targets.length}.`,
    );
  }

  const socket = new WebSocket(debuggerUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () =>
        reject(new Error(`Could not open the inspector on port ${port}.`));
    });
    const reply = await new Promise<{
      error?: { message: string };
      result?: {
        result?: { value?: unknown };
        exceptionDetails?: {
          text: string;
          exception?: { description?: string };
        };
      };
    }>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error("The in-server SQL scan did not answer in 60s.")),
        60_000,
      );
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) return;
        clearTimeout(timer);
        resolve(message);
      };
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression: `(${inDesignServer.toString()})(${JSON.stringify(request)})`,
            awaitPromise: true,
            returnByValue: true,
          },
        }),
      );
    });
    if (reply.error) throw new Error(reply.error.message);
    const exception = reply.result?.exceptionDetails;
    if (exception) {
      throw new Error(exception.exception?.description ?? exception.text);
    }
    return reply.result?.result?.value as T;
  } finally {
    socket.close();
  }
}

/** Every text-like column of every base table, read through the app's own database handle. */
export function scanSqlForInlineBytes(
  testInfo: TestInfo,
): Promise<InlineBytesScan> {
  return evaluateInDesignServer(testInfo, { kind: "scan" });
}

/**
 * Scans inside a transaction that first writes `INLINE_BYTES_CANARIES` and
 * appends a data URL to `threadId`'s snapshot, then rolls back and scans
 * again, so a scanner that cannot see a planted row cannot pass.
 */
export function scanSqlWithPoisonedRows(
  testInfo: TestInfo,
  threadId: string,
): Promise<{ poisoned: InlineBytesScan; afterRollback: InlineBytesScan }> {
  return evaluateInDesignServer(testInfo, {
    kind: "poisoned-scan",
    threadId,
    sessionId: CANARY_SESSION_ID,
    canaries: INLINE_BYTES_CANARIES,
    threadCanary: THREAD_CANARY,
  });
}

/** The chat threads whose snapshot contains `marker`, with their runs and run events. */
export function readChatRows(
  testInfo: TestInfo,
  marker: string,
): Promise<ChatRows> {
  return evaluateInDesignServer(testInfo, { kind: "chat-rows", marker });
}

export function newInlineBytesHits(
  before: InlineBytesScan,
  after: InlineBytesScan,
): InlineBytesHit[] {
  const key = (hit: InlineBytesHit) =>
    `${hit.table}.${hit.column}#${hit.row}@${hit.digest}`;
  const existing = new Set(before.hits.map(key));
  return after.hits.filter((hit) => !existing.has(key(hit)));
}
