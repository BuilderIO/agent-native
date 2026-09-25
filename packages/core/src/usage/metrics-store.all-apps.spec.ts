import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

// Real in-memory PGlite behind getDbExec so the all-apps and per-app queries
// run the genuine SQL, including the app-key expression and GROUP BY.
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

const { resetAppConfigForTests } = await import("../app-config/index.js");
const { ForbiddenError } = await import("../sharing/access.js");
const { ALL_USAGE_APPS, listAppUsageMetrics } =
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

const ENV_KEYS = [
  "AGENT_NATIVE_APP_ID",
  "APP_ID",
  "AGENT_APP",
  "APP_NAME",
  "AGENT_ENGINE",
];

let nextId = 1;

async function insertUsage(row: {
  owner: string;
  app: string;
  orgId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costX100?: number;
  engine?: string | null;
  builderCredits?: number | null;
  label?: string;
  model?: string;
}) {
  await pglite
    .prepare(
      `INSERT INTO token_usage
        (id, owner_email, input_tokens, output_tokens, cost_cents_x100,
         builder_credits_used, engine_name, model, label, app, org_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      nextId++,
      row.owner,
      row.inputTokens ?? 100,
      row.outputTokens ?? 10,
      row.costX100 ?? 1_000,
      row.builderCredits ?? null,
      row.engine ?? null,
      row.model ?? "claude-sonnet-4-5",
      row.label ?? "chat",
      row.app,
      row.orgId === undefined ? "org-1" : row.orgId,
      Date.now() - 1_000,
    );
}

function sumBuckets(
  buckets: Array<{
    calls: number;
    costCents: number;
    inputTokens: number;
    outputTokens: number;
  }>,
) {
  return buckets.reduce(
    (sum, bucket) => ({
      calls: sum.calls + bucket.calls,
      costCents: sum.costCents + bucket.costCents,
      inputTokens: sum.inputTokens + bucket.inputTokens,
      outputTokens: sum.outputTokens + bucket.outputTokens,
    }),
    { calls: 0, costCents: 0, inputTokens: 0, outputTokens: 0 },
  );
}

beforeEach(async () => {
  nextId = 1;
  pglite = await createTestPglite();
  await pglite.exec(TABLE_SQL);
  await pglite.exec(ORG_MEMBERS_SQL);
  for (const [email, role] of [
    ["owner@example.com", "owner"],
    ["admin@example.com", "admin"],
    ["member@example.com", "member"],
  ] as const) {
    await pglite
      .prepare(`INSERT INTO org_members (org_id, email, role) VALUES (?, ?, ?)`)
      .run("org-1", email, role);
  }
  for (const key of ENV_KEYS) delete process.env[key];
  vi.stubEnv("AGENT_NATIVE_APP_ID", "clips");
  vi.stubEnv("AGENT_APP", "legacy-clips");
  resetAppConfigForTests();
});

afterEach(async () => {
  await pglite.close();
  vi.unstubAllEnvs();
  for (const key of ENV_KEYS) delete process.env[key];
  resetAppConfigForTests();
  vi.restoreAllMocks();
});

async function seedWorkspace() {
  await insertUsage({ owner: "owner@example.com", app: "clips" });
  await insertUsage({
    owner: "owner@example.com",
    app: "legacy-clips",
    inputTokens: 200,
  });
  await insertUsage({
    owner: "owner@example.com",
    app: "agent-native-mail",
    inputTokens: 300,
    costX100: 3_000,
  });
  await insertUsage({
    owner: "member@example.com",
    app: "mail",
    inputTokens: 400,
    costX100: 4_000,
  });
  await insertUsage({
    owner: "member@example.com",
    app: "",
    inputTokens: 500,
    costX100: 500,
  });
  await insertUsage({
    owner: "admin@example.com",
    app: "slides",
    inputTokens: 600,
    costX100: 6_000,
  });
}

describe("listAppUsageMetrics all apps", () => {
  it("totals every app, and the per-app buckets sum to the totals", async () => {
    await seedWorkspace();

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace" },
      { ownerEmail: "owner@example.com", orgId: "org-1", app: ALL_USAGE_APPS },
    );

    expect(metrics.appScope).toBe("all");
    expect(metrics.appKey).toBeNull();
    expect(metrics.currentAppKey).toBe("clips");
    expect(metrics.totals).toMatchObject({
      calls: 6,
      inputTokens: 2_100,
      costCents: 155,
      activeUsers: 3,
    });
    expect(sumBuckets(metrics.byApp)).toEqual({
      calls: metrics.totals.calls,
      costCents: metrics.totals.costCents,
      inputTokens: metrics.totals.inputTokens,
      outputTokens: metrics.totals.outputTokens,
    });
    // The configured app's legacy identity folds into its current key, and
    // the agent-native- prefix and empty app normalize like the app filter.
    expect(
      Object.fromEntries(metrics.byApp.map((b) => [b.key, b.calls])),
    ).toEqual({ clips: 2, mail: 2, slides: 1, unattributed: 1 });
    expect(metrics.apps.map((option) => option.key)).toEqual([
      "clips",
      "mail",
      "slides",
      "unattributed",
    ]);
    expect(metrics.recent).toHaveLength(6);
  });

  it("filters to one app while still listing every app with usage", async () => {
    await seedWorkspace();

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace" },
      { ownerEmail: "owner@example.com", orgId: "org-1", app: "mail" },
    );

    expect(metrics.appScope).toBe("app");
    expect(metrics.appKey).toBe("mail");
    expect(metrics.totals).toMatchObject({ calls: 2, inputTokens: 700 });
    expect(metrics.byApp).toHaveLength(1);
    expect(metrics.byApp[0]).toMatchObject({
      key: "mail",
      calls: 2,
      inputTokens: 700,
    });
    expect(metrics.apps.map((option) => option.key)).toEqual([
      "clips",
      "mail",
      "slides",
      "unattributed",
    ]);
    expect(metrics.recent.every((row) => /mail$/.test(row.app))).toBe(true);
  });

  it("selects every per-app bucket's rows when that key is the filter", async () => {
    await seedWorkspace();
    const access = { ownerEmail: "owner@example.com", orgId: "org-1" };
    const all = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace" },
      { ...access, app: ALL_USAGE_APPS },
    );

    for (const option of all.apps) {
      const filtered = await listAppUsageMetrics(
        { sinceDays: 30, scope: "workspace" },
        { ...access, app: option.key },
      );
      const bucket = all.byApp.find((b) => b.key === option.key);
      expect(filtered.totals.calls, option.key).toBe(bucket?.calls);
      expect(filtered.totals.costCents, option.key).toBe(bucket?.costCents);
    }
  });

  it("matches a legacy identity of the configured app to its per-app bucket", async () => {
    await seedWorkspace();

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace" },
      { ownerEmail: "owner@example.com", orgId: "org-1", app: "legacy-clips" },
    );

    expect(metrics.totals).toMatchObject({ calls: 2, inputTokens: 300 });
    expect(metrics.byApp.map((b) => [b.key, b.calls])).toEqual([["clips", 2]]);
  });

  it("shows a member only their own usage across every app", async () => {
    await seedWorkspace();

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      { ownerEmail: "member@example.com", orgId: "org-1", app: ALL_USAGE_APPS },
    );

    expect(metrics.totals).toMatchObject({
      calls: 2,
      inputTokens: 900,
      activeUsers: 1,
    });
    expect(new Set(metrics.recent.map((row) => row.ownerEmail))).toEqual(
      new Set(["member@example.com"]),
    );
    expect(metrics.apps.map((option) => option.key)).toEqual([
      "mail",
      "unattributed",
    ]);
  });

  it("refuses the workspace view across all apps for a member", async () => {
    await seedWorkspace();

    await expect(
      listAppUsageMetrics(
        { sinceDays: 30, scope: "workspace" },
        {
          ownerEmail: "member@example.com",
          orgId: "org-1",
          app: ALL_USAGE_APPS,
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets an admin switch between Everyone and just themselves", async () => {
    await seedWorkspace();
    const access = {
      ownerEmail: "admin@example.com",
      orgId: "org-1",
      app: ALL_USAGE_APPS,
    };

    const everyone = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace" },
      access,
    );
    const justMe = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      access,
    );

    expect(everyone.access.canViewWorkspace).toBe(true);
    expect(everyone.totals.calls).toBe(6);
    expect(justMe.totals).toMatchObject({ calls: 1, inputTokens: 600 });
  });

  it("keeps other organizations' rows out of the all-apps workspace view", async () => {
    await seedWorkspace();
    await insertUsage({
      owner: "member@example.com",
      app: "mail",
      orgId: "org-2",
      inputTokens: 9_000,
    });

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace" },
      { ownerEmail: "owner@example.com", orgId: "org-1", app: ALL_USAGE_APPS },
    );

    expect(metrics.totals.inputTokens).toBe(2_100);
  });
});

describe("listAppUsageMetrics all apps billing unit", () => {
  it("reports Builder.io credits when the agent runs on Builder.io", async () => {
    process.env.AGENT_ENGINE = "builder";
    resetAppConfigForTests();
    await insertUsage({ owner: "owner@example.com", app: "clips" });
    await insertUsage({ owner: "owner@example.com", app: "mail" });

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      { ownerEmail: "owner@example.com", orgId: "org-1", app: ALL_USAGE_APPS },
    );

    expect(metrics.billing.unit).toBe("builder-credits");
  });

  it("reports estimated dollars on any other engine", async () => {
    process.env.AGENT_ENGINE = "ai-sdk:openai";
    resetAppConfigForTests();
    await insertUsage({ owner: "owner@example.com", app: "clips" });

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      { ownerEmail: "owner@example.com", orgId: "org-1", app: ALL_USAGE_APPS },
    );

    expect(metrics.billing.unit).toBe("usd");
  });

  it("follows each row's engine when exact Builder credit reporting is on", async () => {
    await insertUsage({
      owner: "owner@example.com",
      app: "clips",
      engine: "builder",
      builderCredits: 1.5,
    });
    await insertUsage({
      owner: "owner@example.com",
      app: "mail",
      engine: "builder",
      builderCredits: 2.25,
    });

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me", builderCreditsEnabled: true },
      { ownerEmail: "owner@example.com", orgId: "org-1", app: ALL_USAGE_APPS },
    );

    expect(metrics.billing.unit).toBe("builder-credits");
    expect(metrics.totals.builderCredits).toBe(3.75);
    expect(
      metrics.byApp.reduce((sum, b) => sum + (b.builderCredits ?? 0), 0),
    ).toBe(3.75);
  });
});
