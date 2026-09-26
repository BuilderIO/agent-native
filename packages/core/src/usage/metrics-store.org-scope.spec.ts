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
    if (/^\s*(?:select|with)\b/i.test(input.sql)) {
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

const { builderCreditsFromCostCents, recordUsage } = await import("./store.js");
const { canViewWorkspaceUsage, listAppUsageMetrics } =
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

const CHAT_THREADS_SQL = `CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  preview TEXT,
  thread_data TEXT
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
  await pglite.exec(CHAT_THREADS_SQL);
  for (const [orgId, email, role] of [
    ["org-1", "a@example.com", "owner"],
    ["org-1", "admin@example.com", "admin"],
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
    "AGENT_ENGINE",
  ]) {
    delete process.env[key];
  }
});

afterEach(async () => {
  await pglite.close();
  vi.restoreAllMocks();
});

describe("workspace credit usage access", () => {
  it("allows only organization owners and admins", async () => {
    await expect(
      canViewWorkspaceUsage({ ownerEmail: "A@EXAMPLE.COM", orgId: "org-1" }),
    ).resolves.toBe(true);
    await expect(
      canViewWorkspaceUsage({
        ownerEmail: "admin@example.com",
        orgId: "org-1",
      }),
    ).resolves.toBe(true);
    await expect(
      canViewWorkspaceUsage({ ownerEmail: "peer@example.com", orgId: "org-1" }),
    ).resolves.toBe(false);
    await expect(
      canViewWorkspaceUsage({ ownerEmail: "peer@example.com", orgId: null }),
    ).resolves.toBe(false);
  });
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
  it("shows one recent prompt per turn while preserving repeated submissions", async () => {
    const now = Date.now();
    const messages = [
      {
        message: {
          id: "user-1",
          createdAt: new Date(now - 60_000).toISOString(),
          role: "user",
          content: [{ type: "text", text: "same prompt" }],
        },
      },
      {
        message: {
          id: "assistant-1",
          createdAt: new Date(now - 50_000).toISOString(),
          role: "assistant",
          content: [{ type: "text", text: "first answer" }],
          metadata: { custom: { turnId: "turn-1" } },
        },
      },
      {
        message: {
          id: "user-2",
          createdAt: new Date(now - 40_000).toISOString(),
          role: "user",
          content: [{ type: "text", text: "second prompt" }],
        },
      },
      {
        message: {
          id: "assistant-2",
          createdAt: new Date(now - 30_000).toISOString(),
          role: "assistant",
          content: [{ type: "text", text: "second answer" }],
          metadata: { custom: { turnId: "turn-2" } },
        },
      },
      {
        message: {
          id: "user-3",
          createdAt: new Date(now - 20_000).toISOString(),
          role: "user",
          content: [{ type: "text", text: "same prompt" }],
        },
      },
      {
        message: {
          id: "assistant-3",
          createdAt: new Date(now - 10_000).toISOString(),
          role: "assistant",
          content: [{ type: "text", text: "third answer" }],
          metadata: { custom: { turnId: "turn-3" } },
        },
      },
    ];
    await pglite
      .prepare(
        `INSERT INTO chat_threads (id, preview, thread_data) VALUES (?, ?, ?)`,
      )
      .run("thread-1", "same prompt", JSON.stringify({ messages }));

    const usageRows = [
      [1, "turn-1", "chat", now - 3_000],
      [2, "turn-1", "custom-agent:research", now - 2_000],
      [3, "turn-2", "chat", now - 1_500],
      [4, "turn-3", "chat", now - 1_000],
    ] as const;
    for (const [id, taskId, label, createdAt] of usageRows) {
      await pglite
        .prepare(
          `INSERT INTO token_usage (id, owner_email, label, app, thread_id, task_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, "a@example.com", label, "", "thread-1", taskId, createdAt);
    }

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      { ownerEmail: "a@example.com", orgId: "org-1", app: "" },
    );

    expect(metrics.recent).toHaveLength(3);
    expect(metrics.recent.map(({ prompt }) => prompt)).toEqual([
      "same prompt",
      "second prompt",
      "same prompt",
    ]);
    expect(metrics.recent.map(({ id }) => id)).toEqual([4, 3, 2]);
  });

  it("keeps older distinct turns after deduplicating legacy usage rows", async () => {
    const now = Date.now();
    const messages = Array.from({ length: 13 }, (_, index) => ({
      message: {
        id: `user-${index}`,
        createdAt: new Date(now - 130_000 + index * 10_000).toISOString(),
        role: "user",
        content: [{ type: "text", text: `prompt ${index}` }],
      },
    }));
    await pglite
      .prepare(
        `INSERT INTO chat_threads (id, preview, thread_data) VALUES (?, ?, ?)`,
      )
      .run("legacy-thread", "prompt 12", JSON.stringify({ messages }));

    for (let index = 0; index < 13; index += 1) {
      await pglite
        .prepare(
          `INSERT INTO token_usage (id, owner_email, label, app, thread_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          index + 1,
          "a@example.com",
          "chat",
          "",
          "legacy-thread",
          now - 129_000 + index * 10_000,
        );
    }
    for (let index = 0; index < 40; index += 1) {
      await pglite
        .prepare(
          `INSERT INTO token_usage (id, owner_email, label, app, thread_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          100 + index,
          "a@example.com",
          "chat",
          "",
          "legacy-thread",
          now - 4_000 + index * 80,
        );
    }

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      { ownerEmail: "a@example.com", orgId: "org-1", app: "" },
    );

    expect(metrics.recent).toHaveLength(12);
    expect(metrics.recent[0]?.prompt).toBe("prompt 12");
    expect(metrics.recent[11]?.prompt).toBe("prompt 1");
  });

  it("bounds recent prompt hydration to the result size", async () => {
    const now = Date.now();
    for (let index = 0; index < 13; index += 1) {
      const threadId = `thread-${index}`;
      await pglite
        .prepare(
          `INSERT INTO chat_threads (id, preview, thread_data) VALUES (?, ?, ?)`,
        )
        .run(threadId, "", JSON.stringify({ messages: [] }));
      await pglite
        .prepare(
          `INSERT INTO token_usage (id, owner_email, app, thread_id, task_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          index + 1,
          "a@example.com",
          "",
          threadId,
          `turn-${index}`,
          now - index,
        );
    }

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      { ownerEmail: "a@example.com", orgId: "org-1", app: "" },
    );

    expect(metrics.recent).toHaveLength(12);
    const threadQueries = rawClient.execute.mock.calls
      .map(([input]) => input)
      .filter(
        (input) =>
          typeof input !== "string" &&
          input.sql.startsWith("SELECT id, thread_data FROM chat_threads"),
      );
    const threadQuery = threadQueries[threadQueries.length - 1];
    expect(threadQuery).toBeDefined();
    if (!threadQuery || typeof threadQuery === "string") {
      throw new Error("Expected a chat thread prompt lookup");
    }
    expect(threadQuery.args).toHaveLength(12);
  });

  it("uses the sole legacy prompt when persisted messages have no timestamps", async () => {
    await pglite
      .prepare(
        `INSERT INTO chat_threads (id, preview, thread_data) VALUES (?, ?, ?)`,
      )
      .run(
        "timestampless-thread",
        "legacy prompt",
        JSON.stringify({
          messages: [
            {
              message: {
                id: "legacy-user",
                role: "user",
                content: [{ type: "text", text: "legacy prompt" }],
              },
            },
          ],
        }),
      );
    await pglite
      .prepare(
        `INSERT INTO token_usage (id, owner_email, label, app, thread_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(1, "a@example.com", "chat", "", "timestampless-thread", Date.now());

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      { ownerEmail: "a@example.com", orgId: "org-1", app: "" },
    );

    expect(metrics.recent[0]?.prompt).toBe("legacy prompt");
    expect(metrics.recent[0]?.promptSource).toBe("thread");
  });

  it("does not attribute a textless user turn to an earlier prompt", async () => {
    const now = Date.now();
    const messages = [
      {
        message: {
          id: "earlier-user",
          createdAt: new Date(now - 20_000).toISOString(),
          role: "user",
          content: [{ type: "text", text: "earlier prompt" }],
        },
      },
      {
        message: {
          id: "textless-user",
          createdAt: new Date(now - 10_000).toISOString(),
          role: "user",
          content: [{ type: "image" }],
        },
      },
      {
        message: {
          id: "textless-assistant",
          role: "assistant",
          metadata: { custom: { turnId: "textless-turn" } },
          content: [{ type: "text", text: "image analyzed" }],
        },
      },
    ];
    await pglite
      .prepare(
        `INSERT INTO chat_threads (id, preview, thread_data) VALUES (?, ?, ?)`,
      )
      .run("textless-thread", "earlier prompt", JSON.stringify({ messages }));
    await pglite
      .prepare(
        `INSERT INTO token_usage (id, owner_email, label, app, thread_id, task_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        1,
        "a@example.com",
        "chat",
        "",
        "textless-thread",
        "textless-turn",
        now,
      );

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me" },
      { ownerEmail: "a@example.com", orgId: "org-1", app: "" },
    );

    expect(metrics.recent[0]?.prompt).toBeNull();
    expect(metrics.recent[0]?.promptSource).toBe("not-captured");
  });

  it("keeps estimated Builder credits visible while exact reporting is disabled", async () => {
    process.env.AGENT_ENGINE = "builder";
    await runWithRequestContext(
      { userEmail: "a@example.com", orgId: "org-1" },
      () =>
        recordUsage({
          ownerEmail: "a@example.com",
          inputTokens: 10_000,
          outputTokens: 1_000,
          engineName: "builder",
          model: "claude-sonnet-4-5",
        }),
    );

    const metrics = await listAppUsageMetrics(
      { sinceDays: 30, scope: "me", builderCreditsEnabled: false },
      { ownerEmail: "a@example.com", orgId: "org-1", app: "" },
    );

    expect(metrics.billing.unit).toBe("builder-credits");
    expect(metrics.currentDay.credits).toBe(
      builderCreditsFromCostCents(metrics.currentDay.costCents),
    );
    expect(metrics.currentDay.credits).toBeGreaterThan(0);
  });

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
