import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Content view's snapshot tables on the real first-party query path, in a
// local PGlite database, for an organization whose events sink is BigQuery.

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const bigQuery = vi.hoisted(() => ({ query: vi.fn() }));

const database = vi.hoisted(() => {
  // PGlite has one protocol connection. Keep database operations serial while
  // exercising concurrent Analytics requests and cache-key isolation.
  const state = { queue: Promise.resolve() };
  return {
    client: null as null | {
      query: (
        sql: string,
        args: unknown[],
      ) => Promise<{ rows: unknown[]; affectedRows?: number }>;
      transaction: <T>(
        callback: (tx: {
          query: (
            sql: string,
            args: unknown[],
          ) => Promise<{ rows: unknown[]; affectedRows?: number }>;
        }) => Promise<T>,
      ) => Promise<T>;
    },
    runExclusive: async <T>(operation: () => Promise<T>): Promise<T> => {
      const previous = state.queue;
      let release!: () => void;
      state.queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    },
    waitForOperations: () => state.queue,
  };
});

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({
    execute: async ({ sql, args }: { sql: string; args?: unknown[] }) => {
      const client = database.client;
      if (!client) throw new Error("test database is not open");
      return database.runExclusive(async () => {
        const result = await client.query(sql, args ?? []);
        return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
      });
    },
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const client = database.client;
      if (!client) throw new Error("test database is not open");
      return database.runExclusive(() =>
        client.transaction((tx) =>
          callback({
            execute: async ({
              sql,
              args,
            }: {
              sql: string;
              args?: unknown[];
            }) => {
              const result = await tx.query(sql, args ?? []);
              return {
                rows: result.rows,
                rowsAffected: result.affectedRows ?? 0,
              };
            },
          }),
        ),
      );
    },
  }),
}));
vi.mock("./first-party-analytics-backend.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./first-party-analytics-backend.js")
  >()),
  getFirstPartyAnalyticsBackend: async () => ({
    sink: "bigquery",
    table: "example-project.analytics.first_party_analytics_events_raw",
    backfillCursor: "evt_last",
    backfillCompleted: true,
  }),
  queryFirstPartyAnalyticsInBigQuery: bigQuery.query,
}));
vi.mock("./first-party-analytics-health.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./first-party-analytics-health.js")
  >()),
  recordFirstPartyAnalyticsQueryPressure: async () => {},
}));

import { CONTENT_METRICS_MIGRATION_SQL } from "./content-metrics/migration.js";
import { queryFirstPartyAnalytics } from "./first-party-analytics.js";

const ALICE = { userEmail: "alice@example.test", orgId: "org_a" };
const CAROL = { userEmail: "carol@example.test", orgId: "org_b" };

describe("Content view tables on the first-party source", () => {
  let client: PGliteClient;

  beforeEach(async () => {
    bigQuery.query.mockReset();
    client = await PGlite.create("memory://");
    database.client = client;
    await client.exec(`
      ${CONTENT_METRICS_MIGRATION_SQL.join(";\n")};
      CREATE TABLE first_party_analytics_cache (
        key text PRIMARY KEY,
        sql text NOT NULL,
        result text NOT NULL,
        created_at text NOT NULL,
        expires_at text NOT NULL
      );
      INSERT INTO analytics_content_items (id, tenant_key, owner_email, org_id, source, external_id, title, first_seen_at, updated_at) VALUES
        ('item-a', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'a1', 'Org A post', '2026-10-01', '2026-10-01'),
        ('item-b', 'org:org_b', 'carol@example.test', 'org_b', 'builder_blog', 'b1', 'Org B post', '2026-10-01', '2026-10-01');
      INSERT INTO analytics_content_metric_snapshots (id, tenant_key, owner_email, org_id, item_id, metric_date, metric, value, source, run_id, collected_at) VALUES
        ('snap-a', 'org:org_a', 'alice@example.test', 'org_a', 'item-a', '2026-10-01', 'ga4_pageviews', 12, 'ga4', 'run-a', '2026-10-02'),
        ('snap-b', 'org:org_b', 'carol@example.test', 'org_b', 'item-b', '2026-10-01', 'ga4_pageviews', 99, 'ga4', 'run-b', '2026-10-02');
      INSERT INTO analytics_content_collection_runs (id, tenant_key, owner_email, org_id, step, trigger, status, started_at) VALUES
        ('run-a', 'org:org_a', 'alice@example.test', 'org_a', 'builder_blog', 'scheduled', 'failed', '2026-10-02T07:00:00Z'),
        ('run-b', 'org:org_b', 'carol@example.test', 'org_b', 'builder_blog', 'scheduled', 'succeeded', '2026-10-02T07:00:00Z');
    `);
  });

  afterEach(async () => {
    await database.waitForOperations();
    database.client = null;
    await client?.close();
  });

  it("reads the SQL store, never BigQuery, even when the org's events sink is BigQuery", async () => {
    const result = await queryFirstPartyAnalytics(
      "SELECT i.title, s.value FROM analytics_content_items i JOIN analytics_content_metric_snapshots s ON s.item_id = i.id",
      ALICE,
      { cache: false },
    );

    expect(result.rows).toEqual([{ title: "Org A post", value: 12 }]);
    expect(bigQuery.query).not.toHaveBeenCalled();
  });

  it("keeps each organization's items, snapshots and runs to itself", async () => {
    const runs = await queryFirstPartyAnalytics(
      "SELECT id, status FROM analytics_content_collection_runs",
      CAROL,
      { cache: false },
    );
    expect(runs.rows).toEqual([{ id: "run-b", status: "succeeded" }]);

    const none = await queryFirstPartyAnalytics(
      "SELECT id FROM analytics_content_items",
      { userEmail: "dana@example.test", orgId: null, credentialScope: "org" },
      { cache: false },
    );
    expect(none.rows).toEqual([]);
  });

  it("refuses a join between content tables and the BigQuery event tables", async () => {
    await expect(
      queryFirstPartyAnalytics(
        "SELECT COUNT(*) FROM analytics_content_items JOIN analytics_events ON true",
        ALICE,
        { cache: false },
      ),
    ).rejects.toThrow("Cross-backend joins are not supported");
    expect(bigQuery.query).not.toHaveBeenCalled();
  });
});
