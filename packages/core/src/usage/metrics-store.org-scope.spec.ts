import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { runWithRequestContext } from "../server/request-context.js";

// Real in-memory PGlite behind getDbExec so recordUsage writes and
// listAppUsageMetrics reads exercise the genuine SQL scoping, which is where
// the "0 usage despite heavy activity" bug lived.
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

const { recordUsage } = await import("./store.js");
const { listAppUsageMetrics } = await import("./metrics-store.js");

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS token_usage (
  id BIGINT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens BIGINT NOT NULL DEFAULT 0,
  cache_write_tokens BIGINT NOT NULL DEFAULT 0,
  cost_cents_x100 BIGINT NOT NULL DEFAULT 0,
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

beforeEach(async () => {
  // recordUsage derives its primary key from Date.now()*1000 + random(0..999),
  // which collides inside a tight loop. Make it monotonic for the test only.
  let randomCursor = 0;
  vi.spyOn(Math, "random").mockImplementation(() => {
    randomCursor = (randomCursor + 1) % 1000;
    return randomCursor / 1000;
  });

  pglite = await createTestPglite();
  await pglite.exec(TABLE_SQL);
  await pglite.exec(ORG_MEMBERS_SQL);
  for (const [orgId, email, role] of [
    ["org-1", "a@example.com", "owner"],
    ["org-1", "peer@example.com", "member"],
    // `peer@example.com` also belongs to org-2, so their unattributed rows
    // cannot be shown to belong to org-1.
    ["org-2", "peer@example.com", "member"],
  ] as const) {
    await pglite
      .prepare(`INSERT INTO org_members (org_id, email, role) VALUES (?, ?, ?)`)
      .run(orgId, email, role);
  }
  for (const key of [
    "AGENT_NATIVE_APP_ID",
    "APP_ID",
    "AGENT_APP",
    "APP_NAME",
  ]) {
    delete process.env[key];
  }
});

afterEach(async () => {
  await pglite.close();
  vi.restoreAllMocks();
});

function recordInOrg(orgId: string, inputTokens: number) {
  return runWithRequestContext({ userEmail: "a@example.com", orgId }, () =>
    recordUsage({
      ownerEmail: "a@example.com",
      inputTokens,
      outputTokens: 50,
      model: "claude-sonnet-4-5",
    }),
  );
}

describe("listAppUsageMetrics organization scoping", () => {
  it("counts usage recorded with no request organization context", async () => {
    // recordUsage fills org_id from the active request context, so recurring
    // jobs, automations, and every row written before that column started
    // being populated land NULL. An `org_id = ?` read filter dropped all of
    // it and the dashboard reported 0 spend / 0 calls / 0 tokens.
    await recordUsage({
      ownerEmail: "a@example.com",
      inputTokens: 400,
      outputTokens: 100,
      model: "claude-sonnet-4-5",
      label: "recurring-job:digest",
    });
    await recordInOrg("org-1", 200);

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      { ownerEmail: "a@example.com", orgId: "org-1", app: "" },
    );

    expect(metrics.totals).toMatchObject({
      calls: 2,
      inputTokens: 600,
      outputTokens: 150,
    });
    expect(metrics.totals.costCents).toBeGreaterThan(0);
    expect(metrics.daily).not.toHaveLength(0);
    expect(metrics.recent).toHaveLength(2);
  });

  it("still excludes usage attributed to another organization", async () => {
    await recordInOrg("org-1", 200);
    await recordInOrg("org-2", 900);

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      { ownerEmail: "a@example.com", orgId: "org-1", app: "" },
    );

    expect(metrics.totals).toMatchObject({
      calls: 1,
      inputTokens: 200,
      outputTokens: 50,
    });
  });

  it("never counts another owner's unattributed usage", async () => {
    await recordUsage({
      ownerEmail: "stranger@example.com",
      inputTokens: 5_000,
      outputTokens: 5_000,
      model: "claude-sonnet-4-5",
    });
    await recordInOrg("org-1", 200);

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      { ownerEmail: "a@example.com", orgId: "org-1", app: "" },
    );

    expect(metrics.totals).toMatchObject({ calls: 1, inputTokens: 200 });
  });
});

describe("listAppUsageMetrics workspace scope", () => {
  it("does not claim another member's unattributed usage for the workspace", async () => {
    // org_id IS NULL means the organization is unknown, and `peer` belongs to
    // org-1 and org-2. Admitting the row into an org-1 roll-up would report
    // another organization's spend — and expose its prompt text — to an org-1
    // admin.
    await recordUsage({
      ownerEmail: "peer@example.com",
      inputTokens: 5_000,
      outputTokens: 5_000,
      model: "claude-sonnet-4-5",
      label: "recurring-job:digest",
    });
    await recordInOrg("org-1", 200);

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace" },
      { ownerEmail: "a@example.com", orgId: "org-1", app: "" },
    );

    expect(metrics.totals).toMatchObject({
      calls: 1,
      inputTokens: 200,
      outputTokens: 50,
    });
    expect(metrics.recent.map((row) => row.ownerEmail)).toEqual([
      "a@example.com",
    ]);
  });

  it("still shows an admin their own unattributed usage in workspace scope", async () => {
    await recordUsage({
      ownerEmail: "a@example.com",
      inputTokens: 400,
      outputTokens: 100,
      model: "claude-sonnet-4-5",
      label: "recurring-job:digest",
    });
    await recordInOrg("org-1", 200);

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace", userEmail: "a@example.com" },
      { ownerEmail: "a@example.com", orgId: "org-1", app: "" },
    );

    expect(metrics.totals).toMatchObject({ calls: 2, inputTokens: 600 });
  });

  it("does not admit unattributed rows when an admin selects another member", async () => {
    await recordUsage({
      ownerEmail: "peer@example.com",
      inputTokens: 5_000,
      outputTokens: 5_000,
      model: "claude-sonnet-4-5",
    });

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace", userEmail: "peer@example.com" },
      { ownerEmail: "a@example.com", orgId: "org-1", app: "" },
    );

    expect(metrics.totals).toMatchObject({ calls: 0, inputTokens: 0 });
  });
});

describe("listAppUsageMetrics self-scope classification", () => {
  it("counts a solo owner's unattributed usage in the default workspace view", async () => {
    // A one-member organization selects no user, so `selectedUserEmail` is
    // null — but the effective owner list is still exactly the viewer, which
    // makes the read self-scoped. Classifying it as a roll-up kept a solo
    // user's own unattributed spend hidden, which is the original bug.
    await pglite.exec(`DELETE FROM org_members`);
    await pglite
      .prepare(`INSERT INTO org_members (org_id, email, role) VALUES (?, ?, ?)`)
      .run("org-1", "a@example.com", "owner");
    await recordUsage({
      ownerEmail: "a@example.com",
      inputTokens: 400,
      outputTokens: 100,
      model: "claude-sonnet-4-5",
      label: "recurring-job:digest",
    });
    await recordInOrg("org-1", 200);

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "workspace" },
      { ownerEmail: "a@example.com", orgId: "org-1", app: "" },
    );

    expect(metrics.selectedUserEmail).toBeNull();
    expect(metrics.totals).toMatchObject({ calls: 2, inputTokens: 600 });
  });
});
