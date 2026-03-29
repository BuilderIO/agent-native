// PostgreSQL client helper
// Runs queries against an external Postgres database
// Requires the `postgres` package: pnpm add postgres

let _sql: any = null;

function getConnectionUrl(): string {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL env var required");
  return url;
}

export async function getPostgresClient(): Promise<any> {
  if (!_sql) {
    try {
      // @ts-expect-error -- postgres is an optional dependency, installed by user
      const pg = await import("postgres");
      const postgres = pg.default;
      _sql = postgres(getConnectionUrl(), {
        max: 5,
        idle_timeout: 30,
        connect_timeout: 10,
      });
    } catch {
      throw new Error("postgres package not installed. Run: pnpm add postgres");
    }
  }
  return _sql;
}

export async function runQuery(
  sql: string,
  params?: unknown[],
): Promise<Record<string, unknown>[]> {
  const client = await getPostgresClient();
  if (params?.length) {
    return client.unsafe(sql, params) as unknown as Record<string, unknown>[];
  }
  return client.unsafe(sql) as unknown as Record<string, unknown>[];
}

export async function testConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const client = await getPostgresClient();
    const result = await client`SELECT 1 as connected`;
    return { ok: result.length > 0 };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
