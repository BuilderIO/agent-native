import {
  getPgliteClient,
  isPgliteUrl,
  toPostgresParams,
} from "../../db/client.js";

export interface PostgresScriptRows extends Array<Record<string, unknown>> {
  count?: number;
}

export interface PostgresScriptQueryOptions {
  /**
   * Have the server refuse text with more than one statement. Set it for
   * agent-written SQL, so the database enforces what the guards checked.
   */
  singleStatement?: boolean;
}

export interface PostgresScriptClient {
  unsafe(
    sql: string,
    args?: unknown[],
    options?: PostgresScriptQueryOptions,
  ): Promise<PostgresScriptRows>;
  begin<T>(fn: (tx: PostgresScriptClient) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

function rowsResult(
  rows: unknown[] | undefined,
  affectedRows: number | undefined,
): PostgresScriptRows {
  const records = (rows ?? []) as Record<string, unknown>[];
  const result = records as PostgresScriptRows;
  result.count = affectedRows ?? 0;
  return result;
}

// PGlite's query() always uses the extended protocol, which runs one
// statement, so singleStatement needs no handling here.
function pgliteClient(client: any): PostgresScriptClient {
  return {
    async unsafe(sql, args) {
      const result =
        args === undefined
          ? await client.query(toPostgresParams(sql))
          : await client.query(toPostgresParams(sql), args);
      return rowsResult(result.rows, result.affectedRows ?? result.rowCount);
    },
    async begin<T>(fn: (tx: PostgresScriptClient) => Promise<T>): Promise<T> {
      return client.transaction((tx: any) =>
        fn(pgliteClient(tx)),
      ) as Promise<T>;
    },
    async end() {},
  };
}

export async function createPostgresScriptClient(
  url: string,
): Promise<PostgresScriptClient> {
  if (isPgliteUrl(url)) {
    const client = await getPgliteClient(url);
    return pgliteClient(client);
  }

  if (!/^postgres(?:ql)?:\/\//i.test(url)) {
    throw new Error("Database URL must be a PostgreSQL URL or a pglite: URL.");
  }

  const { default: postgres } = await import("postgres");
  const client = postgres(url);
  return {
    ...postgresJsQueries(client),
    async begin<T>(fn: (tx: PostgresScriptClient) => Promise<T>): Promise<T> {
      return client.begin((tx: any) =>
        fn({
          ...postgresJsQueries(tx),
          begin: () => {
            throw new Error("Nested transactions are not supported.");
          },
          end: async () => {},
        }),
      ) as Promise<T>;
    },
    end() {
      return client.end();
    },
  };
}

function postgresJsQueries(sql: any): Pick<PostgresScriptClient, "unsafe"> {
  return {
    unsafe(query, args, options) {
      // postgres.js uses the simple protocol when there are no arguments, and
      // that protocol runs every statement in the text. The extended protocol
      // runs one.
      return sql.unsafe(
        query,
        args ?? [],
        options?.singleStatement ? { simple: false } : undefined,
      ) as Promise<PostgresScriptRows>;
    },
  };
}
