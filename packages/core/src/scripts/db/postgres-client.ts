import {
  getPgliteClient,
  isPgliteUrl,
  toPostgresParams,
} from "../../db/client.js";

export interface PostgresScriptRows extends Array<Record<string, unknown>> {
  count?: number;
}

export interface PostgresScriptClient {
  unsafe(sql: string, args?: unknown[]): Promise<PostgresScriptRows>;
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
    unsafe(sql, args) {
      return args === undefined
        ? (client.unsafe(sql) as Promise<PostgresScriptRows>)
        : (client.unsafe(sql, args as any[]) as Promise<PostgresScriptRows>);
    },
    async begin<T>(fn: (tx: PostgresScriptClient) => Promise<T>): Promise<T> {
      return client.begin((tx: any) =>
        fn(tx as PostgresScriptClient),
      ) as Promise<T>;
    },
    end() {
      return client.end();
    },
  };
}
