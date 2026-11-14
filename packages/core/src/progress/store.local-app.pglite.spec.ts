import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

let db: Awaited<ReturnType<typeof createTestPglite>>;
let provenanceMigrationApplied = false;
let existingRowAfterMigration: Record<string, unknown> | undefined;
const config = vi.hoisted(() => ({
  app: { id: "app-a" } as Record<string, string>,
}));
vi.mock("../app-config/index.js", () => ({ getAppConfig: () => config }));
vi.mock("../server/auth.js", () => ({
  getSession: async () => ({ email: "owner@example.test" }),
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getMethod: (event: { method: string }) => event.method,
  getQuery: (event: { url: URL }) =>
    Object.fromEntries(event.url.searchParams.entries()),
  setResponseStatus: (event: { status: number }, status: number) => {
    event.status = status;
  },
}));
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    execute: async (input: string | { sql: string; args?: unknown[] }) => {
      if (typeof input === "string") {
        await db.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await db.query(input.sql, input.args ?? []);
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
  }),
  isUniqueViolation: () => false,
  safeJsonParse: (value: string, fallback: unknown) => {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  },
}));
vi.mock("../db/store-registry.js", () => ({
  defineStore: (definition: {
    migrations: Array<{
      run?: () => Promise<void>;
      sql?: string | readonly string[];
    }>;
  }) => ({
    ...definition,
    ready: async () => {
      for (const migration of definition.migrations) {
        if (migration.run) await migration.run();
        for (const sql of typeof migration.sql === "string"
          ? [migration.sql]
          : (migration.sql ?? []))
          await db.exec(sql);
      }
    },
  }),
}));
vi.mock("../db/ddl-guard.js", () => ({
  ensureTableExists: async (_name: string, sql: string) => {
    await db.exec(sql);
    return true;
  },
  ensureIndexExists: async (_name: string, sql: string) => {
    await db.exec(sql);
    return true;
  },
  ensureColumnExists: async (_table: string, _column: string, sql: string) => {
    await db.exec(sql);
    return true;
  },
}));
vi.mock("../server/poll.js", () => ({ recordChange: vi.fn() }));

const {
  insertRun,
  getRun,
  listRuns,
  deleteRun,
  setProgressPreListHook,
  ensureTable,
} = await import("./store.js");
const { createProgressHandler } = await import("./routes.js");
const localA = { sourceAppId: "app-a" };

beforeAll(async () => {
  db = await createTestPglite();
  await db.exec(`CREATE TABLE progress_runs (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL,
    step TEXT, percent BIGINT, status TEXT NOT NULL DEFAULT 'running',
    metadata TEXT, started_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    completed_at BIGINT
  )`);
  await db.query(
    "INSERT INTO progress_runs (id, owner, title, status, metadata, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      "existing",
      "owner@example.test",
      "Existing run",
      "succeeded",
      '{"retained":true}',
      1,
      2,
    ],
  );
  await ensureTable();
  provenanceMigrationApplied =
    (
      await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'progress_runs' AND column_name = 'source_app_id'",
      )
    ).rows.length === 1;
  // Keep the isolation counterexample executable even on the pre-migration implementation.
  await db.exec(
    "ALTER TABLE progress_runs ADD COLUMN IF NOT EXISTS source_app_id TEXT",
  );
  existingRowAfterMigration = (
    await db.query("SELECT * FROM progress_runs WHERE id = 'existing'")
  ).rows[0];
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("DELETE FROM progress_runs");
  config.app = { id: "app-a" };
  setProgressPreListHook(undefined);
});

async function row(
  id: string,
  sourceAppId: string | null,
  owner = "owner@example.test",
  startedAt = 1,
  status = "succeeded",
) {
  await db.query(
    "INSERT INTO progress_runs (id, owner, title, status, source_app_id, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, owner, id, status, sourceAppId, startedAt, 1],
  );
}

describe("local progress provenance", () => {
  it("adds provenance without replacing the original progress schema", () => {
    expect(provenanceMigrationApplied).toBe(true);
    expect(existingRowAfterMigration).toMatchObject({
      id: "existing",
      title: "Existing run",
      metadata: '{"retained":true}',
      status: "succeeded",
      source_app_id: null,
    });
  });
  it("stamps the trusted app identity and ignores metadata attribution", async () => {
    await insertRun({
      id: "new",
      owner: "owner@example.test",
      title: "New run",
      metadata: { sourceAppId: "app-b" },
    });
    expect(
      (
        await db.query(
          "SELECT source_app_id FROM progress_runs WHERE id = 'new'",
        )
      ).rows,
    ).toEqual([{ source_app_id: "app-a" }]);
    expect(
      (await listRuns("owner@example.test", localA)).map((run) => run.id),
    ).toEqual(["new"]);
  });

  it("uses the server app identity fallback chain and leaves missing identity unbound", async () => {
    for (const [index, app] of [
      { template: "from-template" },
      { workspaceId: "from-workspace" },
      { packageName: "from-package" },
      {},
    ].entries()) {
      config.app = app;
      await insertRun({
        id: `fallback-${index}`,
        owner: "owner@example.test",
        title: "Fallback",
      });
    }
    expect(
      (await db.query("SELECT source_app_id FROM progress_runs ORDER BY id"))
        .rows,
    ).toEqual([
      { source_app_id: "from-template" },
      { source_app_id: "from-workspace" },
      { source_app_id: "from-package" },
      { source_app_id: null },
    ]);
  });

  it("filters before limit while keeping aggregate callers and owner isolation", async () => {
    await row("local-old", "app-a", "owner@example.test", 1);
    for (let i = 0; i < 205; i++)
      await row(`foreign-${i}`, "app-b", "owner@example.test", i + 10);
    await row("unbound", null, "owner@example.test", 999);
    await row("other-owner", "app-a", "other@example.test", 1000);
    expect(
      (await listRuns("owner@example.test", { ...localA, limit: 1 })).map(
        (run) => run.id,
      ),
    ).toEqual(["local-old"]);
    expect(
      await getRun("local-old", "owner@example.test", localA),
    ).toMatchObject({ id: "local-old" });
    for (const id of ["foreign-0", "unbound", "other-owner"]) {
      expect(await getRun(id, "owner@example.test", localA)).toBeNull();
      expect(await deleteRun(id, "owner@example.test", localA)).toBe(false);
    }
    expect(
      (await listRuns("owner@example.test", { limit: 2 })).map((run) => run.id),
    ).toEqual(["unbound", "foreign-204"]);
    expect(await getRun("foreign-0", "owner@example.test")).toMatchObject({
      id: "foreign-0",
    });
    expect(await deleteRun("local-old", "owner@example.test", localA)).toBe(
      true,
    );
    expect(await getRun("local-old", "owner@example.test")).toBeNull();
    expect(await deleteRun("foreign-0", "owner@example.test")).toBe(true);
  });

  it("fails closed for empty or unknown local attribution without mutating rows", async () => {
    await row("known", "app-a");
    await row("legacy", null);
    for (const sourceAppId of [null, undefined, "", "   "]) {
      const scope = { sourceAppId };
      expect(await listRuns("owner@example.test", scope)).toEqual([]);
      expect(await getRun("known", "owner@example.test", scope)).toBeNull();
      expect(await deleteRun("known", "owner@example.test", scope)).toBe(false);
    }
    expect(
      (await listRuns("owner@example.test")).map((run) => run.id).sort(),
    ).toEqual(["known", "legacy"]);
  });

  it("scopes stale cancellation and never invokes an aggregate pre-list reconciler", async () => {
    await row("stale-local", "app-a", "stale-owner@example.test", 1, "running");
    await row(
      "stale-foreign",
      "app-b",
      "stale-owner@example.test",
      2,
      "running",
    );
    await row("stale-unbound", null, "stale-owner@example.test", 3, "running");
    const hook = vi.fn();
    setProgressPreListHook(hook);
    await listRuns("stale-owner@example.test", { ...localA, activeOnly: true });
    expect(hook).not.toHaveBeenCalled();
    expect(
      (await db.query("SELECT id, status FROM progress_runs ORDER BY id")).rows,
    ).toEqual([
      { id: "stale-foreign", status: "running" },
      { id: "stale-local", status: "cancelled" },
      { id: "stale-unbound", status: "running" },
    ]);
    await listRuns("stale-owner@example.test");
    expect(hook).toHaveBeenCalledOnce();
    expect(
      (await getRun("stale-foreign", "stale-owner@example.test"))?.status,
    ).toBe("cancelled");
  });

  it("keeps the HTTP list, open and dismiss paths on the trusted app despite forged query selectors", async () => {
    await row("local", "app-a");
    await row("foreign", "app-b");
    await row("legacy", null);
    await row("other-owner", "app-a", "other@example.test");
    const handler = createProgressHandler({ localApp: true });
    const event = (path: string, method = "GET") => ({
      url: new URL(`http://app.test${path}`),
      method,
      status: 200,
    });
    const invoke = (request: ReturnType<typeof event>) =>
      handler(request as never);
    expect(
      (
        (await invoke(
          event("/?sourceAppId=app-b&includeExternal=1"),
        )) as Array<{ id: string }>
      ).map((run) => run.id),
    ).toEqual(["local"]);
    expect(await invoke(event("/local"))).toMatchObject({ id: "local" });
    for (const id of ["foreign", "legacy", "other-owner"]) {
      for (const method of ["GET", "DELETE"]) {
        const request = event(`/${id}?sourceAppId=app-b`, method);
        expect(await invoke(request)).toEqual({ error: "Not found" });
        expect(request.status).toBe(404);
      }
    }
    expect(await invoke(event("/local", "DELETE"))).toEqual({ ok: true });
    config.app = {};
    expect(await invoke(event("/"))).toEqual([]);
    const unknown = event("/foreign", "DELETE");
    expect(await invoke(unknown)).toEqual({ error: "Not found" });
    expect(unknown.status).toBe(404);
    expect(await getRun("foreign", "owner@example.test")).toMatchObject({
      id: "foreign",
    });
  });
});
