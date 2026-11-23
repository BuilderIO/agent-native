import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { ensureAnalyticsDatabase } from "./database.js";
import { mutateDbtQueryOperation } from "./dbt-query-operation-store.js";
import {
  coordinateDbtQuery,
  type DbtQueryBinding,
} from "./dbt-query-operation.js";

const directory = mkdtempSync(join(tmpdir(), "qa-dbt-operation-"));
// guard:allow-env-credential Disposable local DB only; restore without logging.
const previous = process.env.DATABASE_URL;
beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(directory, "database")}`;
  await runMigrations(
    ORG_MIGRATIONS.map(({ version, sql }) => ({ version, sql })),
    { table: "qa_dbt_operation_org" },
  )(null);
  await ensureAnalyticsDatabase();
});
afterAll(async () => {
  await closeDbExec();
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
  rmSync(directory, { recursive: true, force: true });
});
const binding = (): DbtQueryBinding => ({
  ownerEmail: "qa@example.invalid",
  orgId: "qa-org",
  projectId: randomUUID(),
  cellId: randomUUID(),
  connectionId: "qa-connection",
  revision: "qa-revision",
  selection: { metrics: [{ name: "orders" }] },
});
const client = () => ({
  startQuery: vi.fn(async () => ({ queryId: "provider-query" })),
  readQueryPage: vi.fn(
    async ({ pageNum }: { queryId: string; pageNum: number }) => ({
      queryId: "provider-query",
      status: "SUCCESSFUL" as const,
      pageNum,
      totalPages: 2,
      sql: null,
      fields: [{ name: "orders", type: "INTEGER" }],
      rows: [{ orders: pageNum }],
    }),
  ),
});
it("persists create/page acknowledgment and replays the last page through a new authorizer", async () => {
  const saved = binding(),
    provider = client();
  const authorize = async () => ({ binding: saved, client: provider });
  const operation = await coordinateDbtQuery({ mode: "start" }, authorize);
  const first = await coordinateDbtQuery(
    { mode: "read", operationId: operation.operationId, pageNum: 1 },
    authorize,
  );
  const resumed = await coordinateDbtQuery(
    { mode: "read", operationId: operation.operationId, pageNum: 1 },
    async () => ({ binding: structuredClone(saved), client: provider }),
  );
  expect(resumed).toEqual(first);
  expect(provider.startQuery).toHaveBeenCalledTimes(1);
  expect(provider.readQueryPage).toHaveBeenCalledTimes(1);
  const final = await coordinateDbtQuery(
    { mode: "read", operationId: operation.operationId, pageNum: 2 },
    authorize,
  );
  expect(final.status).toBe("complete");
  expect(final.page?.rows).toEqual([{ orders: 2 }]);
});
it("real concurrent reservations permit one POST and refuse the other", async () => {
  const saved = binding(),
    provider = client();
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      coordinateDbtQuery({ mode: "start" }, async () => ({
        binding: saved,
        client: provider,
      })),
    ),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  expect(provider.startQuery).toHaveBeenCalledTimes(1);
});
it("an actor/org cannot overwrite or read another scope's stored operation through a colliding key", async () => {
  const saved = binding(),
    key = randomUUID();
  await mutateDbtQueryOperation(saved, key, () => ({ marker: "original" }));
  let observed: unknown = "unset";
  await expect(
    mutateDbtQueryOperation({ ...saved, orgId: "other-org" }, key, (old) => {
      observed = old;
      return { marker: "replacement" };
    }),
  ).rejects.toMatchObject({ errorCode: "dbt_query_operation_changed" });
  expect(observed).toBeNull();
  expect(await mutateDbtQueryOperation(saved, key, (old) => old!)).toEqual({
    marker: "original",
  });
});
it("uncertain POST survives new request handlers and prevents a new create", async () => {
  const saved = binding(),
    provider = client();
  provider.startQuery.mockRejectedValueOnce(
    Object.assign(new Error("safe timeout"), {
      errorCode: "dbt_semantic_timeout",
      details: { queryOutcome: "unknown" },
    }),
  );
  await expect(
    coordinateDbtQuery({ mode: "start" }, async () => ({
      binding: saved,
      client: provider,
    })),
  ).rejects.toMatchObject({ errorCode: "dbt_semantic_timeout" });
  await expect(
    coordinateDbtQuery({ mode: "start" }, async () => ({
      binding: structuredClone(saved),
      client: provider,
    })),
  ).rejects.toMatchObject({ errorCode: "dbt_query_operation_changed" });
  expect(provider.startQuery).toHaveBeenCalledTimes(1);
});
