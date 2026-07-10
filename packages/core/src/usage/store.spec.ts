import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real in-memory sqlite behind the raw getDbExec client so recordUsage /
// getUserUsageCents / getUsageSummary exercise genuine aggregation + scoping.
// A fresh DB per test keeps the module-level _initPromise (CREATE TABLE IF NOT
// EXISTS) idempotent across tests.
let sqlite: Database.Database;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      sqlite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = sqlite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: stmt.all(...args), rowsAffected: 0 };
    }
    const info = stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

const {
  builderCreditsFromCostCents,
  calculateCost,
  usageBillingForEngine,
  recordUsage,
  getUserUsageCents,
  getUsageSummary,
} = await import("./store.js");

beforeEach(() => {
  // recordUsage derives its primary key from Date.now()*1000 + random(0..999).
  // Under a fast loop Date.now() is constant and the 1000-value random space
  // collides, producing a UNIQUE-constraint failure. Drive Math.random from a
  // monotonic counter so every insert in a test gets a distinct id without
  // touching source behavior. (Real Postgres would not hit this in practice;
  // we are only removing test-induced flakiness.)
  let randomCursor = 0;
  vi.spyOn(Math, "random").mockImplementation(() => {
    randomCursor = (randomCursor + 1) % 1000;
    return randomCursor / 1000;
  });

  sqlite = new Database(":memory:");
  // The store caches CREATE TABLE in a module-level _initPromise that only runs
  // once for the whole file, so create the table per fresh DB ourselves.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS token_usage (
    id INTEGER PRIMARY KEY,
    owner_email TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    cost_cents_x100 INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT 'chat',
    app TEXT NOT NULL DEFAULT '',
    ref_id TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`);
  delete process.env.AGENT_APP;
  delete process.env.APP_NAME;
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

describe("usage billing", () => {
  it("maps Builder hard costs to agent credits with margin", () => {
    expect(builderCreditsFromCostCents(100)).toBe(25);
    expect(builderCreditsFromCostCents(1)).toBe(0.25);
  });

  it("rounds Builder credits up to the same precision as ai-services", () => {
    expect(builderCreditsFromCostCents(0.001)).toBe(0.001);
  });

  it("treats non-positive / non-finite cents as zero credits", () => {
    expect(builderCreditsFromCostCents(0)).toBe(0);
    expect(builderCreditsFromCostCents(-5)).toBe(0);
    expect(builderCreditsFromCostCents(Number.NaN)).toBe(0);
    expect(builderCreditsFromCostCents(Infinity)).toBe(0);
  });

  it("uses Builder credit display only for the Builder engine", () => {
    expect(usageBillingForEngine("builder").unit).toBe("builder-credits");
    expect(usageBillingForEngine("anthropic").unit).toBe("usd");
    expect(usageBillingForEngine(null).unit).toBe("usd");
    expect(usageBillingForEngine(undefined).unit).toBe("usd");
  });
});

describe("calculateCost pricing tiers", () => {
  it("does not round tiny completed calls down to zero spend", () => {
    expect(calculateCost(10, 2, "claude-sonnet-4-5")).toBe(1);
  });

  it("returns 0 for a call with no tokens", () => {
    expect(calculateCost(0, 0, "claude-opus-4")).toBe(0);
  });

  it("prices opus higher than sonnet which is higher than haiku for the same tokens", () => {
    // 1M input + 1M output, centicents.
    const opus = calculateCost(1_000_000, 1_000_000, "claude-opus-4-1");
    const sonnet = calculateCost(1_000_000, 1_000_000, "claude-sonnet-4-5");
    const haiku = calculateCost(1_000_000, 1_000_000, "claude-haiku-4");
    // opus = (1500 + 7500) * 100 = 900000 centicents.
    expect(opus).toBe(900_000);
    // sonnet (default) = (300 + 1500) * 100 = 180000.
    expect(sonnet).toBe(180_000);
    // haiku = (100 + 500) * 100 = 60000.
    expect(haiku).toBe(60_000);
    expect(opus).toBeGreaterThan(sonnet);
    expect(sonnet).toBeGreaterThan(haiku);
  });

  it("falls back to sonnet pricing for unknown models", () => {
    expect(calculateCost(1_000_000, 0, "some-future-model")).toBe(
      calculateCost(1_000_000, 0, "claude-sonnet-4-5"),
    );
  });

  it("prices cache read cheaper than cache write", () => {
    const read = calculateCost(0, 0, "claude-sonnet-4-5", 1_000_000, 0);
    const write = calculateCost(0, 0, "claude-sonnet-4-5", 0, 1_000_000);
    // sonnet cacheRead 30, cacheWrite 375 → centicents.
    expect(read).toBe(3_000);
    expect(write).toBe(37_500);
    expect(write).toBeGreaterThan(read);
  });
});

describe("recordUsage", () => {
  it("skips no-op writes when no tokens flowed", async () => {
    await recordUsage({
      ownerEmail: "a@example.com",
      inputTokens: 0,
      outputTokens: 0,
      model: "claude-sonnet-4-5",
    });
    const inserts = rawClient.execute.mock.calls.filter((c) => {
      const input = c[0] as string | { sql: string };
      const sql = typeof input === "string" ? input : input.sql;
      return /INSERT\s+INTO\s+token_usage/i.test(sql);
    });
    expect(inserts).toHaveLength(0);
  });

  it("persists a row and rolls it into the per-user total", async () => {
    await recordUsage({
      ownerEmail: "a@example.com",
      inputTokens: 1_000_000,
      outputTokens: 0,
      model: "claude-sonnet-4-5",
    });
    // sonnet input 300/M → 30000 centicents = $3.00.
    await expect(getUserUsageCents("a@example.com")).resolves.toBeCloseTo(300);
  });

  it("records a cache-only call (no input/output) instead of skipping it", async () => {
    // The no-op guard checks cache tokens too, so a prompt-cache-heavy call
    // with zero billable input/output must still be persisted and priced.
    await recordUsage({
      ownerEmail: "a@example.com",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
      model: "claude-sonnet-4-5",
    });
    const summary = await getUsageSummary({ ownerEmail: "a@example.com" });
    expect(summary.totalCalls).toBe(1);
    expect(summary.totalCacheReadTokens).toBe(1_000_000);
    // sonnet cacheRead 30/M → 3000 centicents; getUserUsageCents = /100 = 30.
    await expect(getUserUsageCents("a@example.com")).resolves.toBeCloseTo(30);
  });

  it("supports the legacy positional 4-arg signature", async () => {
    await recordUsage("legacy@example.com", 1_000_000, 0, "claude-sonnet-4-5");
    await expect(getUserUsageCents("legacy@example.com")).resolves.toBeCloseTo(
      300,
    );
  });

  it("defaults label to 'chat' and resolves app from AGENT_APP env", async () => {
    process.env.AGENT_APP = "mail";
    await recordUsage({
      ownerEmail: "a@example.com",
      inputTokens: 100,
      outputTokens: 50,
      model: "claude-sonnet-4-5",
    });
    const summary = await getUsageSummary({ ownerEmail: "a@example.com" });
    expect(summary.byLabel.map((b) => b.key)).toContain("chat");
    expect(summary.byApp.map((b) => b.key)).toContain("mail");
  });

  it("explicit label/app override the env fallback", async () => {
    process.env.AGENT_APP = "mail";
    await recordUsage({
      ownerEmail: "a@example.com",
      inputTokens: 100,
      outputTokens: 50,
      model: "claude-sonnet-4-5",
      label: "automation",
      app: "calendar",
    });
    const summary = await getUsageSummary({ ownerEmail: "a@example.com" });
    expect(summary.byLabel.map((b) => b.key)).toEqual(["automation"]);
    expect(summary.byApp.map((b) => b.key)).toEqual(["calendar"]);
  });
});

describe("getUserUsageCents scoping", () => {
  it("never sums another owner's spend into a user's total", async () => {
    await recordUsage({
      ownerEmail: "alice@example.com",
      inputTokens: 1_000_000,
      outputTokens: 0,
      model: "claude-sonnet-4-5",
    });
    await recordUsage({
      ownerEmail: "bob@example.com",
      inputTokens: 1_000_000,
      outputTokens: 0,
      model: "claude-opus-4-1",
    });
    await expect(getUserUsageCents("alice@example.com")).resolves.toBeCloseTo(
      300,
    );
    // Bob's opus spend is far higher and must not leak into Alice's number.
    const bob = await getUserUsageCents("bob@example.com");
    expect(bob).toBeGreaterThan(300);
    await expect(getUserUsageCents("nobody@example.com")).resolves.toBe(0);
  });
});

describe("getUsageSummary", () => {
  it("aggregates totals and buckets and is scoped to the owner", async () => {
    // Alice: two chat calls + one automation call.
    await recordUsage({
      ownerEmail: "alice@example.com",
      inputTokens: 1_000_000,
      outputTokens: 0,
      model: "claude-sonnet-4-5",
      label: "chat",
      app: "mail",
    });
    await recordUsage({
      ownerEmail: "alice@example.com",
      inputTokens: 1_000_000,
      outputTokens: 0,
      model: "claude-sonnet-4-5",
      label: "chat",
      app: "mail",
    });
    await recordUsage({
      ownerEmail: "alice@example.com",
      inputTokens: 1_000_000,
      outputTokens: 0,
      model: "claude-opus-4-1",
      label: "automation",
      app: "calendar",
    });
    // Bob's usage must not appear in Alice's summary.
    await recordUsage({
      ownerEmail: "bob@example.com",
      inputTokens: 5_000_000,
      outputTokens: 0,
      model: "claude-opus-4-1",
      label: "chat",
      app: "mail",
    });

    const summary = await getUsageSummary({ ownerEmail: "alice@example.com" });

    expect(summary.totalCalls).toBe(3);
    expect(summary.totalInputTokens).toBe(3_000_000);

    // byLabel buckets are owner-scoped and ordered by cents desc — automation
    // (opus) outweighs the two sonnet chat calls.
    const labels = Object.fromEntries(summary.byLabel.map((b) => [b.key, b]));
    expect(labels.chat.calls).toBe(2);
    expect(labels.automation.calls).toBe(1);
    expect(summary.byLabel[0].key).toBe("automation");

    // byApp similarly scoped — only Alice's apps.
    expect(summary.byApp.map((b) => b.key).sort()).toEqual([
      "calendar",
      "mail",
    ]);

    // byModel has both models, opus first (more expensive).
    expect(summary.byModel[0].key).toContain("opus");

    // Total cents equals the sum across buckets.
    const labelCentsSum = summary.byLabel.reduce((n, b) => n + b.cents, 0);
    expect(summary.totalCents).toBeCloseTo(labelCentsSum);

    // billing mode defaults to USD.
    expect(summary.billing?.unit).toBe("usd");
  });

  it("filters by sinceMs while recent ignores the window", async () => {
    const now = Date.now();
    // Insert a stale row directly (200 days ago) and a fresh row via the API.
    sqlite.exec(`CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY,
        owner_email TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        cost_cents_x100 INTEGER NOT NULL DEFAULT 0,
        model TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT 'chat',
        app TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )`);
    const oldTs = now - 200 * 86_400_000;
    sqlite
      .prepare(
        `INSERT INTO token_usage
          (id, owner_email, input_tokens, output_tokens, cost_cents_x100, model, label, app, created_at)
         VALUES (1, 'alice@example.com', 1000000, 0, 5000, 'claude-sonnet-4-5', 'chat', 'mail', ?)`,
      )
      .run(oldTs);

    await recordUsage({
      ownerEmail: "alice@example.com",
      inputTokens: 1_000_000,
      outputTokens: 0,
      model: "claude-sonnet-4-5",
    });

    // Default 30-day window excludes the 200-day-old row.
    const windowed = await getUsageSummary({ ownerEmail: "alice@example.com" });
    expect(windowed.totalCalls).toBe(1);
    // recent (no window filter) sees both rows.
    expect(windowed.recent.length).toBe(2);
    expect(windowed.recent[0].createdAt).toBeGreaterThan(
      windowed.recent[1].createdAt,
    );

    // Widening sinceMs to 1 year pulls the old row into the aggregates.
    const wide = await getUsageSummary({
      ownerEmail: "alice@example.com",
      sinceMs: now - 365 * 86_400_000,
    });
    expect(wide.totalCalls).toBe(2);

    // byDay buckets the two rows under their (distinct) UTC dates, ascending —
    // the 200-day-old row sorts before today.
    expect(wide.byDay).toHaveLength(2);
    expect(wide.byDay.map((d) => d.date)).toEqual(
      [...wide.byDay.map((d) => d.date)].sort(),
    );
    expect(wide.byDay[0].date).toBe(new Date(oldTs).toISOString().slice(0, 10));
    expect(wide.byDay.reduce((n, d) => n + d.calls, 0)).toBe(2);
  });

  it("returns empty buckets and zeroed totals for an owner with no usage", async () => {
    const summary = await getUsageSummary({ ownerEmail: "ghost@example.com" });
    expect(summary.totalCalls).toBe(0);
    expect(summary.totalCents).toBe(0);
    expect(summary.byLabel).toEqual([]);
    expect(summary.byModel).toEqual([]);
    expect(summary.byApp).toEqual([]);
    expect(summary.byDay).toEqual([]);
    expect(summary.recent).toEqual([]);
  });
});

describe("recordUsage refId + cost override", () => {
  it("replaces a prior row with the same (label, refId) rather than duplicating", async () => {
    await recordUsage({
      ownerEmail: "u@x.com",
      inputTokens: 100,
      outputTokens: 10,
      model: "gpt-5.6-sol",
      label: "visual-recap",
      refId: "recap-1",
    });
    await recordUsage({
      ownerEmail: "u@x.com",
      inputTokens: 200,
      outputTokens: 20,
      model: "gpt-5.6-sol",
      label: "visual-recap",
      refId: "recap-1",
    });
    const rows = sqlite
      .prepare(
        "SELECT input_tokens FROM token_usage WHERE label = 'visual-recap' AND ref_id = 'recap-1'",
      )
      .all() as Array<{ input_tokens: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].input_tokens).toBe(200);
  });

  it("stores a precomputed costCentsX100 verbatim instead of deriving from tokens", async () => {
    await recordUsage({
      ownerEmail: "u@x.com",
      inputTokens: 1_000_000,
      outputTokens: 0,
      model: "gpt-5.6-sol",
      label: "visual-recap",
      refId: "recap-2",
      costCentsX100: 4242,
    });
    const row = sqlite
      .prepare(
        "SELECT cost_cents_x100 AS c FROM token_usage WHERE ref_id = 'recap-2'",
      )
      .get() as { c: number };
    // Derived cost would be 50000 centicents ($5/1M); the override wins.
    expect(row.c).toBe(4242);
  });

  it("does not dedup rows that carry no refId", async () => {
    await recordUsage({
      ownerEmail: "u@x.com",
      inputTokens: 1,
      outputTokens: 1,
      model: "m",
      label: "chat",
    });
    await recordUsage({
      ownerEmail: "u@x.com",
      inputTokens: 1,
      outputTokens: 1,
      model: "m",
      label: "chat",
    });
    const rows = sqlite
      .prepare("SELECT id FROM token_usage WHERE label = 'chat'")
      .all();
    expect(rows).toHaveLength(2);
  });
});
