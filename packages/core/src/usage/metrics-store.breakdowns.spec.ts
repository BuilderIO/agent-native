import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

// Real in-memory PGlite behind getDbExec so the day grouping, feature CASE,
// folding into "other", and the trace-span scoping run the genuine SQL.
let pglite: Awaited<ReturnType<typeof createTestPglite>>;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
}));

const ensureObservabilityTables = vi.fn(async () => {
  await pglite.exec(SPANS_SQL);
});

vi.mock("../observability/store.js", () => ({
  ensureObservabilityTables: () => ensureObservabilityTables(),
}));

const { resetAppConfigForTests } = await import("../app-config/index.js");
const { ALL_USAGE_APPS, listAppUsageMetrics, USAGE_OTHER_BREAKDOWN_KEY } =
  await import("./metrics-store.js");

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS token_usage (
  id BIGINT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens BIGINT NOT NULL DEFAULT 0,
  cache_write_tokens BIGINT NOT NULL DEFAULT 0,
  cost_cents_x100 BIGINT NOT NULL DEFAULT 0,
  builder_credits_used NUMERIC,
  engine_name TEXT,
  cost_source TEXT NOT NULL DEFAULT 'estimated',
  model TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT 'chat',
  app TEXT NOT NULL DEFAULT '',
  ref_id TEXT NOT NULL DEFAULT '',
  org_id TEXT,
  run_id TEXT,
  thread_id TEXT,
  task_id TEXT,
  integration_scope_id TEXT,
  source_platform TEXT,
  source_id TEXT,
  created_at BIGINT NOT NULL
)`;

const ORG_MEMBERS_SQL = `CREATE TABLE IF NOT EXISTS org_members (
  org_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  federation_removal_pending_at BIGINT
)`;

const THREADS_SQL = `CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  preview TEXT NOT NULL DEFAULT '',
  thread_data TEXT NOT NULL DEFAULT '{}'
)`;

const SPANS_SQL = `CREATE TABLE IF NOT EXISTS agent_trace_spans (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  thread_id TEXT,
  user_id TEXT,
  org_id TEXT,
  span_type TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at BIGINT NOT NULL
)`;

const DAY_MS = 86_400_000;
const ENV_KEYS = ["AGENT_NATIVE_APP_ID", "APP_ID", "AGENT_APP", "APP_NAME"];

let nextId = 1;

async function insertUsage(row: {
  owner: string;
  app?: string;
  costX100?: number;
  label?: string;
  model?: string;
  sourcePlatform?: string | null;
  threadId?: string | null;
  runId?: string | null;
  daysAgo?: number;
}) {
  await pglite
    .prepare(
      `INSERT INTO token_usage
        (id, owner_email, input_tokens, output_tokens, cost_cents_x100, model,
         label, app, org_id, run_id, thread_id, source_platform, created_at)
       VALUES (?, ?, 100, 10, ?, ?, ?, ?, 'org-1', ?, ?, ?, ?)`,
    )
    .run(
      nextId++,
      row.owner,
      row.costX100 ?? 1_000,
      row.model ?? "claude-sonnet-4-5",
      row.label ?? "chat",
      row.app ?? "clips",
      row.runId ?? null,
      row.threadId ?? null,
      row.sourcePlatform ?? null,
      Date.now() - (row.daysAgo ?? 0) * DAY_MS - 1_000,
    );
}

async function insertToolSpan(row: {
  user: string;
  name: string;
  runId: string;
  orgId?: string;
  spanType?: string;
}) {
  await pglite
    .prepare(
      `INSERT INTO agent_trace_spans (id, run_id, user_id, org_id, span_type, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `span-${nextId++}`,
      row.runId,
      row.user,
      row.orgId ?? "org-1",
      row.spanType ?? "tool_call",
      row.name,
      Date.now() - 1_000,
    );
}

function sumByDate(rows: Array<{ date: string; calls: number }>) {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.date] = (out[row.date] ?? 0) + row.calls;
  return out;
}

const workspace = {
  ownerEmail: "owner@example.com",
  orgId: "org-1",
  app: ALL_USAGE_APPS,
} as const;

beforeEach(async () => {
  nextId = 1;
  pglite = await createTestPglite();
  await pglite.exec(TABLE_SQL);
  await pglite.exec(ORG_MEMBERS_SQL);
  for (const [email, role] of [
    ["owner@example.com", "owner"],
    ["member@example.com", "member"],
  ] as const) {
    await pglite
      .prepare(`INSERT INTO org_members (org_id, email, role) VALUES (?, ?, ?)`)
      .run("org-1", email, role);
  }
  ensureObservabilityTables.mockImplementation(async () => {
    await pglite.exec(SPANS_SQL);
  });
  for (const key of ENV_KEYS) delete process.env[key];
  vi.stubEnv("AGENT_NATIVE_APP_ID", "clips");
  resetAppConfigForTests();
});

afterEach(async () => {
  await pglite.close();
  vi.unstubAllEnvs();
  for (const key of ENV_KEYS) delete process.env[key];
  resetAppConfigForTests();
});

describe("listAppUsageMetrics daily breakdowns", () => {
  it("splits each day by feature, app, model, and surface, summing to daily", async () => {
    await insertUsage({ owner: "owner@example.com", label: "chat" });
    await insertUsage({
      owner: "owner@example.com",
      label: "automation:digest",
      app: "mail",
      daysAgo: 2,
    });
    await insertUsage({
      owner: "member@example.com",
      label: "agent-team:researcher",
      model: "claude-haiku-4-5",
    });
    await insertUsage({
      owner: "member@example.com",
      label: "integration:slack",
      sourcePlatform: "slack",
      daysAgo: 2,
    });
    await insertUsage({
      owner: "member@example.com",
      label: "observability:human-review-summary",
    });

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace" },
      workspace,
    );

    const dailyCalls = Object.fromEntries(
      metrics.daily.map((day) => [day.date, day.calls]),
    );
    for (const dimension of ["feature", "app", "model", "surface"] as const) {
      expect(sumByDate(metrics.dailyBy[dimension]), dimension).toEqual(
        dailyCalls,
      );
    }
    expect(new Set(metrics.dailyBy.feature.map((row) => row.key))).toEqual(
      new Set([
        "chat",
        "automations",
        "sub-agents",
        "integration:slack",
        USAGE_OTHER_BREAKDOWN_KEY,
      ]),
    );
    expect(new Set(metrics.dailyBy.surface.map((row) => row.key))).toEqual(
      new Set(["app", "slack"]),
    );
    expect(new Set(metrics.dailyBy.app.map((row) => row.key))).toEqual(
      new Set(["clips", "mail"]),
    );
    const costTotal = metrics.dailyBy.app.reduce(
      (sum, row) => sum + row.costCents,
      0,
    );
    expect(costTotal).toBe(metrics.totals.costCents);
  });

  it("folds models past the top five into other, keeping the day totals", async () => {
    for (let index = 0; index < 7; index++) {
      await insertUsage({
        owner: "owner@example.com",
        model: `model-${index}`,
        costX100: 1_000 * (index + 1),
      });
    }

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      workspace,
    );

    const keys = metrics.dailyBy.model.map((row) => row.key);
    expect(keys).toHaveLength(6);
    expect(keys).toContain(USAGE_OTHER_BREAKDOWN_KEY);
    expect(keys).not.toContain("model-0");
    expect(keys).not.toContain("model-1");
    const other = metrics.dailyBy.model.find(
      (row) => row.key === USAGE_OTHER_BREAKDOWN_KEY,
    );
    expect(other).toMatchObject({ calls: 2, costCents: 30 });
    expect(metrics.dailyBy.model.reduce((sum, row) => sum + row.calls, 0)).toBe(
      7,
    );
  });

  it("carries Builder credit amounts on breakdown rows when reporting is on", async () => {
    await insertUsage({ owner: "owner@example.com", costX100: 10_000 });

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me", builderCreditsEnabled: true },
      workspace,
    );

    expect(metrics.dailyBy.app[0]).toMatchObject({
      key: "clips",
      costCents: 100,
      builderCredits: 0,
      otherCostCents: 100,
    });
  });
});

describe("listAppUsageMetrics top people and chats", () => {
  it("ranks people only in the organization view", async () => {
    await insertUsage({ owner: "owner@example.com", costX100: 1_000 });
    await insertUsage({ owner: "Member@Example.com", costX100: 5_000 });

    const everyone = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace" },
      workspace,
    );
    expect(everyone.byUser.map((bucket) => bucket.key)).toEqual([
      "member@example.com",
      "owner@example.com",
    ]);

    const oneMember = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace", userEmail: "member@example.com" },
      workspace,
    );
    expect(oneMember.byUser).toEqual([]);

    const justMe = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      workspace,
    );
    expect(justMe.byUser).toEqual([]);
  });

  it("ranks chats by spend with their titles", async () => {
    await pglite.exec(THREADS_SQL);
    await pglite
      .prepare(
        `INSERT INTO chat_threads (id, owner_email, title, preview) VALUES (?, ?, ?, ?)`,
      )
      .run("thread-a", "owner@example.com", "Q3 planning recap", "");
    await pglite
      .prepare(
        `INSERT INTO chat_threads (id, owner_email, title, preview) VALUES (?, ?, ?, ?)`,
      )
      .run("thread-b", "member@example.com", "", "Pull the objections");
    await insertUsage({
      owner: "owner@example.com",
      threadId: "thread-a",
      costX100: 1_000,
    });
    await insertUsage({
      owner: "owner@example.com",
      threadId: "thread-a",
      costX100: 1_000,
    });
    await insertUsage({
      owner: "member@example.com",
      threadId: "thread-b",
      app: "mail",
      costX100: 5_000,
    });
    await insertUsage({ owner: "member@example.com", costX100: 9_000 });

    const everyone = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace" },
      workspace,
    );
    expect(
      everyone.topChats.map(({ threadId, title, titleSource, app, calls }) => ({
        threadId,
        title,
        titleSource,
        app,
        calls,
      })),
    ).toEqual([
      {
        threadId: "thread-b",
        title: "Pull the objections",
        titleSource: "thread-preview",
        app: "mail",
        calls: 1,
      },
      {
        threadId: "thread-a",
        title: "Q3 planning recap",
        titleSource: "thread",
        app: "clips",
        calls: 2,
      },
    ]);

    const member = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      { ...workspace, ownerEmail: "member@example.com" },
    );
    expect(member.topChats.map((chat) => chat.threadId)).toEqual(["thread-b"]);
  });

  it("marks chat titles unavailable when the threads can't be read", async () => {
    await insertUsage({ owner: "owner@example.com", threadId: "thread-a" });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      workspace,
    );

    expect(metrics.topChats).toEqual([
      expect.objectContaining({
        threadId: "thread-a",
        title: null,
        titleSource: "unavailable",
      }),
    ]);
  });
});

describe("listAppUsageMetrics tool calls", () => {
  it("counts the viewer's tool calls, filtered to runs in the selected app", async () => {
    await insertUsage({ owner: "owner@example.com", runId: "run-clips" });
    await insertUsage({
      owner: "owner@example.com",
      runId: "run-mail",
      app: "mail",
    });
    await pglite.exec(SPANS_SQL);
    await insertToolSpan({
      user: "owner@example.com",
      name: "navigate",
      runId: "run-clips",
    });
    await insertToolSpan({
      user: "owner@example.com",
      name: "navigate",
      runId: "run-mail",
    });
    await insertToolSpan({
      user: "owner@example.com",
      name: "web-fetch",
      runId: "run-mail",
    });
    await insertToolSpan({
      user: "owner@example.com",
      name: "llm",
      runId: "run-mail",
      spanType: "llm_call",
    });
    await insertToolSpan({
      user: "member@example.com",
      name: "navigate",
      runId: "run-member",
    });
    await insertToolSpan({
      user: "owner@example.com",
      name: "navigate",
      runId: "run-elsewhere",
      orgId: "org-2",
    });

    const all = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      workspace,
    );
    expect(all.toolCalls.status).toBe("ok");
    if (all.toolCalls.status !== "ok") return;
    expect(
      Object.fromEntries(
        all.toolCalls.daily.map((row) => [row.key, row.calls]),
      ),
    ).toEqual({ navigate: 2, "web-fetch": 1 });

    const clips = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      { ...workspace, app: "clips" },
    );
    expect(clips.toolCalls).toEqual({
      status: "ok",
      daily: [expect.objectContaining({ key: "navigate", calls: 1 })],
    });

    const everyone = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace" },
      workspace,
    );
    expect(
      everyone.toolCalls.status === "ok"
        ? everyone.toolCalls.daily.reduce((sum, row) => sum + row.calls, 0)
        : null,
    ).toBe(4);
  });

  it("reports tool calls unavailable when the traces can't be read", async () => {
    await insertUsage({ owner: "owner@example.com" });
    ensureObservabilityTables.mockRejectedValueOnce(new Error("no traces"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      workspace,
    );

    expect(metrics.toolCalls).toEqual({ status: "unavailable" });
    expect(metrics.totals.calls).toBe(1);
  });
});
