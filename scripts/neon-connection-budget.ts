#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const WARM_REQUESTS = 5;
const SITE_NAME = "neon-query-budget-probe";
const DATABASE_APPLICATION_NAME = `agent-native:${SITE_NAME}`;

class QueryBudgetExceededError extends Error {}

interface PostgresClient {
  <T extends Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  end(options?: { timeout?: number }): Promise<void>;
}

function fail(message: string): never {
  throw new Error(message);
}

async function run(): Promise<void> {
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.NETLIFY !== "true" ||
    !process.env.NETLIFY_FUNCTION_NAME
  ) {
    fail("run with NODE_ENV=production and Netlify function markers");
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) fail("DATABASE_URL is required for the Postgres probe");

  process.env.SITE_NAME = SITE_NAME;
  const core = (await import("../packages/core/dist/db/client.js")) as {
    closeDbExec: () => Promise<void>;
    getDbExec: () => {
      execute: (sql: string) => Promise<{ rows: unknown[] }>;
    };
  };
  const coreRequire = createRequire(path.resolve("packages/core/package.json"));
  const postgresPath = coreRequire.resolve("postgres");
  const postgresModule = (await import(pathToFileURL(postgresPath).href)) as {
    default: (url: string, options: Record<string, unknown>) => PostgresClient;
  };
  const observer = postgresModule.default(databaseUrl, {
    max: 1,
    connection: { application_name: "neon-query-budget-observer" },
  });

  try {
    const readStats = async () => {
      const [sessionRow] = await observer<{ sessions: string | number }>`
        SELECT sessions
        FROM pg_stat_database
        WHERE datname = current_database()
      `;
      const [connectionRow] = await observer<{ count: string | number }>`
        SELECT count(*) AS count
        FROM pg_stat_activity
        WHERE application_name = ${DATABASE_APPLICATION_NAME}
      `;
      if (!sessionRow || !connectionRow) {
        fail("PostgreSQL did not return session and connection statistics");
      }
      return {
        sessions: Number(sessionRow.sessions),
        openConnections: Number(connectionRow.count),
      };
    };

    const baseline = await readStats();
    const observedSessionCounts: number[] = [];
    const observedOpenConnections: number[] = [];
    for (let request = 0; request < WARM_REQUESTS + 1; request += 1) {
      await core.getDbExec().execute("SELECT 1 AS query_budget_probe");
      const stats = await readStats();
      observedSessionCounts.push(stats.sessions - baseline.sessions);
      observedOpenConnections.push(stats.openConnections);
    }

    const newConnections = Math.max(...observedSessionCounts);
    const maxOpenConnections = Math.max(...observedOpenConnections);
    const report = {
      coldRequests: 1,
      warmRequests: WARM_REQUESTS,
      observedNewConnectionsByRequest: observedSessionCounts,
      maxOpenConnections,
      newConnections,
      poolMax: 1,
    };
    console.log(JSON.stringify(report));
    if (newConnections > 1 || maxOpenConnections > 1) {
      throw new QueryBudgetExceededError(
        `serverless Postgres connection budget exceeded: ${JSON.stringify(report)}`,
      );
    }
  } finally {
    await core.closeDbExec();
    await observer.end({ timeout: 5 });
  }
}

run().catch((error) => {
  console.error(
    `[neon-connection-budget] could not run: ${String((error as Error)?.stack ?? error)}`,
  );
  process.exitCode = error instanceof QueryBudgetExceededError ? 1 : 2;
});
