// PostgreSQL client helper
// Runs queries against an external Postgres database
// Requires the `postgres` package: pnpm add postgres

import { resolveCredential } from "./credentials";
import {
  credentialCacheScope,
  requireRequestCredentialContext,
} from "./credentials-context";
import { createHash } from "crypto";

const clients = new Map<string, any>();

async function getConnectionUrl(): Promise<string> {
  const ctx = requireRequestCredentialContext("POSTGRES_URL");
  const url = await resolveCredential("POSTGRES_URL", ctx);
  if (!url) throw new Error("POSTGRES_URL not configured");
  return url;
}

export async function getPostgresClient(): Promise<any> {
  const url = await getConnectionUrl();
  const urlHash = createHash("sha256").update(url).digest("hex");
  const clientKey = `${credentialCacheScope("POSTGRES_URL")}:${urlHash}`;
  const cached = clients.get(clientKey);
  if (cached) return cached;
  {
    try {
      // @ts-expect-error -- postgres is an optional dependency, installed by user
      const pg = await import("postgres");
      const postgres = pg.default;
      const client = postgres(url, {
        max: 5,
        idle_timeout: 30,
        connect_timeout: 10,
      });
      clients.set(clientKey, client);
      return client;
    } catch {
      throw new Error("postgres package not installed. Run: pnpm add postgres");
    }
  }
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
