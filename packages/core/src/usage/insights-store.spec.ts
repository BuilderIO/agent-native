import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

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
const { insertTraceSpan } = await import("../observability/store.js");
const { getUsageInsights, getUsageRun } = await import("./insights-store.js");
const { calculateCost } = await import("./store.js");

const OWNER = "owner@example.com";
const ACCESS = { ownerEmail: OWNER, orgId: null, app: "design" };
const MODEL = "claude-sonnet-5";

async function seedUsage(row: {
  id: number;
  runId: string | null;
  threadId: string;
  owner?: string;
  model?: string;
  costX100?: number;
  input: number;
  output: number;
  read: number;
  write: number;
}) {
  await pglite.exec(`INSERT INTO token_usage
    (id, owner_email, input_tokens, output_tokens, cache_read_tokens,
     cache_write_tokens, cost_cents_x100, model, app, run_id, thread_id, created_at)
    VALUES (${row.id}, '${row.owner ?? OWNER}', ${row.input}, ${row.output},
     ${row.read}, ${row.write}, ${row.costX100 ?? 100}, '${row.model ?? MODEL}',
     'design', ${row.runId === null ? "NULL" : `'${row.runId}'`},
     '${row.threadId}', ${Date.now()})`);
}

let spanSeq = 0;
async function seedSpan(
  runId: string,
  spanType: "agent_run" | "llm_call" | "tool_call",
  name: string,
  tokens: { input?: number; read?: number; write?: number } = {},
  status: "success" | "error" = "success",
  createdAt?: number,
) {
  spanSeq += 1;
  await insertTraceSpan({
    id: `span-${spanSeq}`,
    runId,
    threadId: "thread-1",
    userId: OWNER,
    parentSpanId: null,
    spanType,
    name,
    inputTokens: tokens.input ?? 0,
    outputTokens: 0,
    cacheReadTokens: tokens.read ?? 0,
    cacheWriteTokens: tokens.write ?? 0,
    costCentsX100: 0,
    durationMs: 10,
    status,
    errorMessage: null,
    metadata: null,
    createdAt: createdAt ?? 1_000_000 + spanSeq * 1000,
  });
}

// One database for the file: the observability store caches that its tables exist.
beforeAll(async () => {
  resetAppConfigForTests();
  vi.stubEnv("AGENT_NATIVE_APP_ID", "design");
  pglite = await createTestPglite();
  await pglite.exec(`CREATE TABLE token_usage (
    id BIGINT PRIMARY KEY, owner_email TEXT NOT NULL,
    input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_tokens BIGINT NOT NULL DEFAULT 0, cache_write_tokens BIGINT NOT NULL DEFAULT 0,
    cost_cents_x100 BIGINT NOT NULL DEFAULT 0, model TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT 'chat', app TEXT NOT NULL DEFAULT '', org_id TEXT,
    run_id TEXT, thread_id TEXT, created_at BIGINT NOT NULL)`);
  await pglite.exec(
    `CREATE TABLE chat_threads (id TEXT PRIMARY KEY, preview TEXT, thread_data TEXT)`,
  );
  await pglite.exec(`CREATE TABLE org_members (org_id TEXT NOT NULL,
    email TEXT NOT NULL, role TEXT NOT NULL, federation_removal_pending_at BIGINT)`);
});

afterAll(async () => {
  resetAppConfigForTests();
  vi.unstubAllEnvs();
  await pglite.close();
});

describe("getUsageRun", () => {
  it("prices a context restart after a tool lookup and groups tools with their errors", async () => {
    await seedUsage({
      id: 1,
      runId: "run-1",
      threadId: "thread-1",
      input: 150_000,
      output: 1_000,
      read: 40_000,
      write: 110_000,
    });
    await seedSpan("run-1", "llm_call", MODEL, {
      input: 50_000,
      read: 40_000,
      write: 10_000,
    });
    await seedSpan("run-1", "tool_call", "tool-search");
    await seedSpan("run-1", "llm_call", MODEL, {
      input: 100_000,
      read: 0,
      write: 100_000,
    });
    await seedSpan("run-1", "tool_call", "export-html", {}, "error");

    const run = await getUsageRun({ runId: "run-1" }, ACCESS);

    expect(run!.turns.map((turn) => turn.restart?.cause ?? null)).toEqual([
      null,
      "tool-lookup",
    ]);
    expect(run!.restarts.byCause["tool-lookup"].count).toBe(1);
    expect(run!.restarts.cents).toBeGreaterThan(0);
    expect(run!.turns[1]!.toolCalls.map((call) => call.name)).toEqual([
      "export-html",
    ]);
    expect(run!.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "export-html", failed: 1 }),
        expect.objectContaining({ name: "tool-search", calls: 1 }),
      ]),
    );
  });

  it("treats a cache that expired after an idle gap as expected, not a restart", async () => {
    await seedUsage({
      id: 5,
      runId: "run-idle",
      threadId: "thread-3",
      input: 150_000,
      output: 1_000,
      read: 40_000,
      write: 110_000,
    });
    await seedSpan(
      "run-idle",
      "llm_call",
      MODEL,
      { input: 50_000, read: 40_000, write: 10_000 },
      "success",
      10_000_000,
    );
    await seedSpan(
      "run-idle",
      "llm_call",
      MODEL,
      { input: 100_000, read: 0, write: 100_000 },
      "success",
      10_000_000 + 6 * 60_000,
    );

    const run = await getUsageRun({ runId: "run-idle" }, ACCESS);

    expect(run!.turns[1]!.cacheExpired).toBe(true);
    expect(run!.restarts.count).toBe(0);
  });

  it("counts time saved by overlapping tool calls and errors the run recovered from", async () => {
    await seedUsage({
      id: 7,
      runId: "run-parallel",
      threadId: "thread-5",
      input: 2_000,
      output: 10,
      read: 0,
      write: 0,
    });
    await seedSpan("run-parallel", "agent_run", "agent_run");
    await seedSpan(
      "run-parallel",
      "llm_call",
      MODEL,
      { input: 1_000 },
      "success",
      20_000_000,
    );
    await seedSpan(
      "run-parallel",
      "tool_call",
      "search-docs",
      {},
      "success",
      20_001_000,
    );
    await seedSpan(
      "run-parallel",
      "tool_call",
      "read-file",
      {},
      "error",
      20_001_000,
    );
    await seedSpan(
      "run-parallel",
      "llm_call",
      MODEL,
      { input: 1_000 },
      "success",
      20_002_000,
    );

    const run = await getUsageRun({ runId: "run-parallel" }, ACCESS);

    expect(run!.parallel).toEqual({ calls: 2, savedMs: 10 });
    expect(run!.recoveredErrors).toBe(1);
  });

  it("does not flag a miss that cost less than half a cent", async () => {
    await seedUsage({
      id: 6,
      runId: "run-small",
      threadId: "thread-4",
      input: 3_000,
      output: 10,
      read: 1_000,
      write: 0,
    });
    await seedSpan("run-small", "llm_call", MODEL, {
      input: 1_000,
      read: 500,
      write: 0,
    });
    await seedSpan("run-small", "llm_call", MODEL, {
      input: 2_000,
      read: 0,
      write: 0,
    });

    const run = await getUsageRun({ runId: "run-small" }, ACCESS);

    expect(run!.restarts.count).toBe(0);
  });

  it("prices each model in a run at its own rate and reports the recorded spend", async () => {
    await seedUsage({
      id: 20,
      runId: "run-mixed",
      threadId: "thread-6",
      model: MODEL,
      costX100: 100,
      input: 100_000,
      output: 1_000,
      read: 0,
      write: 0,
    });
    await seedUsage({
      id: 21,
      runId: "run-mixed",
      threadId: "thread-6",
      model: "gpt-5",
      costX100: 300,
      input: 100_000,
      output: 1_000,
      read: 0,
      write: 0,
    });

    const run = await getUsageRun({ runId: "run-mixed" }, ACCESS);

    expect(run!.cost.totalCents).toBe(4);
    expect(run!.cost.estimatedCents).toBeCloseTo(
      (calculateCost(100_000, 1_000, MODEL) +
        calculateCost(100_000, 1_000, "gpt-5")) /
        100,
      2,
    );
  });

  it("reports an unknown outcome when the run has no trace", async () => {
    await seedUsage({
      id: 22,
      runId: "run-untraced",
      threadId: "thread-7",
      input: 1_000,
      output: 10,
      read: 0,
      write: 0,
    });

    const run = await getUsageRun({ runId: "run-untraced" }, ACCESS);

    expect(run!.status).toBe("unknown");
    expect(run!.modelCalls).toBe(0);
  });

  it("does not diagnose restarts for a provider that never reports cache tokens", async () => {
    await seedUsage({
      id: 23,
      runId: "run-nocache",
      threadId: "thread-8",
      input: 200_000,
      output: 10,
      read: 0,
      write: 0,
    });
    await seedSpan("run-nocache", "llm_call", MODEL, { input: 100_000 });
    await seedSpan("run-nocache", "tool_call", "tool-search");
    await seedSpan("run-nocache", "llm_call", MODEL, { input: 100_000 });

    const run = await getUsageRun({ runId: "run-nocache" }, ACCESS);

    expect(run!.restarts.count).toBe(0);
  });

  it("returns nothing for a run outside the caller's usage scope", async () => {
    await seedUsage({
      id: 2,
      runId: "run-other",
      threadId: "thread-2",
      owner: "someone-else@example.com",
      input: 1_000,
      output: 10,
      read: 0,
      write: 0,
    });
    await seedSpan("run-other", "llm_call", MODEL, { input: 1_000 });

    expect(await getUsageRun({ runId: "run-other" }, ACCESS)).toBeNull();
  });
});

describe("getUsageInsights", () => {
  it("leaves usage that isn't tied to a prompt out of the prompt totals", async () => {
    const before = await getUsageInsights({ sinceDays: 30 }, ACCESS);
    await seedUsage({
      id: 30,
      runId: null,
      threadId: "thread-9",
      costX100: 50_000,
      input: 1_000,
      output: 10,
      read: 0,
      write: 0,
    });

    const after = await getUsageInsights({ sinceDays: 30 }, ACCESS);

    expect(after.current.cost.totalCents).toBe(before.current.cost.totalCents);
    expect(after.current.runs).toBe(before.current.runs);
  });

  it("labels each run with its own prompt, without the hidden context block", async () => {
    await pglite.exec(`INSERT INTO chat_threads (id, preview, thread_data) VALUES (
      'thread-1', 'first prompt', '${JSON.stringify({
        messages: [
          { message: { role: "user", content: "first prompt" } },
          {
            message: {
              role: "assistant",
              content: "ok",
              metadata: { runId: "run-a" },
            },
          },
          {
            message: {
              role: "user",
              content:
                "second prompt\n\n<context>\nhidden app state\n</context>",
            },
          },
          {
            message: {
              role: "assistant",
              content: "done",
              metadata: { custom: { foldedRunIds: ["run-b"] } },
            },
          },
        ],
      })}')`);
    await seedUsage({
      id: 3,
      runId: "run-a",
      threadId: "thread-1",
      input: 10,
      output: 1,
      read: 0,
      write: 0,
    });
    await seedUsage({
      id: 4,
      runId: "run-b",
      threadId: "thread-1",
      input: 10,
      output: 1,
      read: 0,
      write: 0,
    });

    const insights = await getUsageInsights({ sinceDays: 30 }, ACCESS);

    const prompts = Object.fromEntries(
      insights.runs.map((run) => [run.runId, run.prompt]),
    );
    expect(prompts["run-a"]).toBe("first prompt");
    expect(prompts["run-b"]).toBe("second prompt");
  });
});
