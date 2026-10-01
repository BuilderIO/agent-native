import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type {
  AgentLoopOutcome,
  AgentLoopUsage,
} from "../agent/production-agent.js";
import { observabilityConfig } from "../app-config/observability.js";
import {
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "../tracking/registry.js";
import type { TrackingEvent } from "../tracking/types.js";
import type { ObservabilityConfig } from "./types.js";

const holder = vi.hoisted(() => ({
  pg: null as null | Awaited<ReturnType<typeof createTestPglite>>,
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    execute: async (q: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof q === "string" ? q : q.sql;
      const args = typeof q === "string" ? [] : (q.args ?? []);
      const result = await holder.pg!.query(sql, args);
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
  }),
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn(async () => {}),
  ensureIndexExists: vi.fn(async () => {}),
  ensureTableExists: vi.fn(async () => {}),
}));

const { instrumentAgentLoop } = await import("./traces.js");
const { getTraceSpansForRun } = await import("./store.js");

const BASE_CONFIG: ObservabilityConfig = {
  ...observabilityConfig.parse({}),
  enabled: true,
  inferredSentimentEnabled: false,
  inferredSentimentSampleRate: 0,
};

const USAGE: AgentLoopUsage = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  model: "claude-test",
};

const loopOpts: any = {
  engine: { name: "anthropic" },
  model: "claude-test",
  systemPrompt: "",
  tools: [],
  messages: [],
  actions: {},
  send: () => {},
  signal: new AbortController().signal,
};

type LoopArgs = {
  send: (event: any) => void;
  onOutcome: (outcome: AgentLoopOutcome) => void;
};

let runCounter = 0;

async function trace(
  script: (args: LoopArgs) => void,
  config: Partial<ObservabilityConfig> = {},
) {
  const runId = `run-${++runCounter}`;
  await instrumentAgentLoop({
    runAgentLoop: async (args: any) => {
      script(args);
      return USAGE;
    },
    loopOpts,
    runId,
    threadId: null,
    userId: null,
    config: { ...BASE_CONFIG, ...config },
  });
  // writeTraceData is fire-and-forget; wait for the parent span, written last.
  for (let attempt = 0; attempt < 200; attempt++) {
    const spans = await getTraceSpansForRun(runId);
    if (spans.some((span) => span.spanType === "agent_run")) return spans;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`spans for ${runId} were never persisted`);
}

function toolSpan(spans: Awaited<ReturnType<typeof trace>>) {
  const span = spans.find((s) => s.spanType === "tool_call");
  if (!span) throw new Error("no tool_call span");
  return span;
}

function runSpan(spans: Awaited<ReturnType<typeof trace>>) {
  const span = spans.find((s) => s.spanType === "agent_run");
  if (!span) throw new Error("no agent_run span");
  return span;
}

function failTool(result: string) {
  return ({ send }: LoopArgs) => {
    send({ type: "tool_start", id: "t1", tool: "fetch", input: {} });
    send({
      type: "tool_done",
      id: "t1",
      tool: "fetch",
      result,
      isError: true,
    });
  };
}

beforeAll(async () => {
  holder.pg = await createTestPglite();
  await holder.pg.exec(`
    CREATE TABLE agent_trace_spans (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, thread_id TEXT, user_id TEXT,
      org_id TEXT, parent_span_id TEXT, span_type TEXT NOT NULL, name TEXT NOT NULL,
      input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0,
      cache_read_tokens BIGINT NOT NULL DEFAULT 0, cache_write_tokens BIGINT NOT NULL DEFAULT 0,
      cost_cents_x100 BIGINT NOT NULL DEFAULT 0, duration_ms BIGINT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'success', error_message TEXT, metadata TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE agent_trace_summaries (
      run_id TEXT PRIMARY KEY, thread_id TEXT, user_id TEXT, org_id TEXT,
      total_spans BIGINT NOT NULL DEFAULT 0, llm_calls BIGINT NOT NULL DEFAULT 0,
      tool_calls BIGINT NOT NULL DEFAULT 0, successful_tools BIGINT NOT NULL DEFAULT 0,
      failed_tools BIGINT NOT NULL DEFAULT 0, total_duration_ms BIGINT NOT NULL DEFAULT 0,
      total_cost_cents_x100 BIGINT NOT NULL DEFAULT 0, total_input_tokens BIGINT NOT NULL DEFAULT 0,
      total_output_tokens BIGINT NOT NULL DEFAULT 0, model TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );
  `);
});

afterAll(async () => {
  await holder.pg?.close();
});

afterEach(() => {
  unregisterTrackingProvider("error-observability");
});

describe("failed tool calls are never recorded without a reason", () => {
  it("keeps a redacted signature when captureToolResults is off, and says the full text was withheld", async () => {
    const spans = await trace(
      failTool(
        "Error running fetch: upstream said no\nstack line two\nAuthorization: Bearer abcdef123456",
      ),
      { captureToolResults: false },
    );
    const span = toolSpan(spans);
    expect(span.status).toBe("error");
    expect(span.errorMessage).toBe("Error running fetch: upstream said no");
    expect(span.errorDetail).toBe("signature");
    expect(JSON.stringify(span)).not.toContain("stack line two");
    expect(JSON.stringify(span)).not.toContain("abcdef123456");
  });

  it("redacts credentials before choosing the signature line", async () => {
    const spans = await trace(
      failTool(
        'Error: bad config client_secret="first-line-secret\nsecond-line-secret" key=sk-not-a-real-key-000000000',
      ),
      { captureToolResults: false },
    );
    const span = toolSpan(spans);
    expect(span.errorMessage).toContain("[REDACTED]");
    expect(span.errorMessage).not.toContain("first-line-secret");
    expect(span.errorMessage).not.toContain("second-line-secret");
    expect(span.errorMessage).not.toContain("sk-not-a-real-key");
  });

  it("bounds the signature", async () => {
    const spans = await trace(failTool(`Error: ${"x".repeat(2000)}`), {
      captureToolResults: false,
    });
    expect(toolSpan(spans).errorMessage!.length).toBeLessThanOrEqual(501);
  });

  it("keeps the whole sanitized text when captureToolResults is on", async () => {
    const spans = await trace(failTool("Error: first\nsecond line kept"), {
      captureToolResults: true,
    });
    const span = toolSpan(spans);
    expect(span.errorMessage).toBe("Error: first\nsecond line kept");
    expect(span.errorDetail).toBe("full");
  });

  it("does not let an empty error result read as no error text", async () => {
    const spans = await trace(failTool(""), { captureToolResults: false });
    const span = toolSpan(spans);
    expect(span.errorMessage).toBeTruthy();
    expect(span.errorDetail).toBe("signature");
  });

  it("records interrupted tool calls with the reason even when capture is off", async () => {
    const runId = `run-interrupted-${++runCounter}`;
    await expect(
      instrumentAgentLoop({
        runAgentLoop: async ({ send }: any) => {
          send({ type: "tool_start", id: "hung", tool: "fetch", input: {} });
          throw new Error("provider disconnected");
        },
        loopOpts,
        runId,
        threadId: null,
        userId: null,
        config: { ...BASE_CONFIG, captureToolResults: false },
      }),
    ).rejects.toThrow("provider disconnected");
    let spans = await getTraceSpansForRun(runId);
    for (let attempt = 0; attempt < 200 && spans.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      spans = await getTraceSpansForRun(runId);
    }
    const span = toolSpan(spans);
    expect(span.errorMessage).toBe("Tool call interrupted before completion");
    expect(span.errorDetail).toBe("full");
  });

  it("tells a signature-only row, a legacy withheld row, and an empty row apart on read", async () => {
    const insert = (
      id: string,
      errorMessage: string | null,
      metadata: Record<string, unknown> | null,
    ) =>
      holder.pg!.query(
        `INSERT INTO agent_trace_spans (id, run_id, span_type, name, status, error_message, metadata, created_at)
         VALUES (?, 'run-legacy', 'tool_call', 'fetch', 'error', ?, ?, 1)`,
        [id, errorMessage, metadata ? JSON.stringify(metadata) : null],
      );
    await insert("sig", "Error: nope", { __tool_error_detail: "signature" });
    await insert("full", "Error: nope\nmore", {
      __tool_error_detail: "full",
      input: { q: 1 },
    });
    await insert("v1", "Error: nope v1", { __tool_error_capture_version: 1 });
    await insert("raw", "Error: raw legacy text", null);
    await insert("empty", null, null);
    await insert("blank", "", null);

    const byId = new Map(
      (await getTraceSpansForRun("run-legacy")).map((s) => [s.id, s]),
    );
    expect(byId.get("sig")).toMatchObject({
      errorMessage: "Error: nope",
      errorDetail: "signature",
    });
    expect(byId.get("full")).toMatchObject({
      errorMessage: "Error: nope\nmore",
      errorDetail: "full",
      metadata: { input: { q: 1 } },
    });
    expect(byId.get("v1")).toMatchObject({
      errorMessage: "Error: nope v1",
      errorDetail: "full",
    });
    expect(byId.get("raw")).toMatchObject({
      errorMessage: null,
      errorDetail: "withheld",
    });
    expect(byId.get("empty")).toMatchObject({
      errorMessage: null,
      errorDetail: "unrecorded",
    });
    expect(byId.get("blank")).toMatchObject({
      errorMessage: null,
      errorDetail: "unrecorded",
    });
    expect(byId.get("sig")!.metadata).toEqual({});
  });
});

describe("a pause for the user is not an error", () => {
  const pause: AgentLoopOutcome = {
    state: "input_required",
    code: "awaiting_user_input",
    message: "Waiting for your answer before continuing.",
  };

  it("records the run as paused, with the reason, and no error text", async () => {
    const events: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "error-observability",
      track(event) {
        events.push(event);
      },
    });
    const spans = await trace(({ send, onOutcome }) => {
      send({ type: "model_stream", status: "start" });
      send({ type: "model_stream", status: "end", reason: "tool_use" });
      onOutcome(pause);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const run = runSpan(spans);
    expect(run.status).toBe("paused");
    expect(run.errorMessage).toBeNull();
    expect(run.metadata).toMatchObject({
      terminal_state: "input_required",
      terminal_code: "awaiting_user_input",
    });
    expect(spans.filter((s) => s.status === "error")).toEqual([]);

    const traceEvent = events.find((e) => e.name === "$ai_trace");
    expect(traceEvent?.properties?.["$ai_is_error"]).toBe(false);
    expect(traceEvent?.properties?.["status"]).toBe("paused");
    for (const generation of events.filter(
      (e) => e.name === "$ai_generation",
    )) {
      expect(generation.properties?.["status"]).toBe("success");
    }
  });

  it("records an approval pause the same way", async () => {
    const spans = await trace(({ onOutcome }) =>
      onOutcome({
        state: "input_required",
        code: "needs_approval",
        message: "Waiting for your approval to run send-email.",
      }),
    );
    expect(runSpan(spans)).toMatchObject({
      status: "paused",
      errorMessage: null,
    });
  });

  it("still counts a real error that follows the pause", async () => {
    const spans = await trace(({ send, onOutcome }) => {
      onOutcome(pause);
      send({ type: "error", error: "provider exploded" });
    });
    expect(runSpan(spans)).toMatchObject({
      status: "error",
      errorMessage: "provider exploded",
    });
  });

  it("keeps failed and canceled outcomes as errors", async () => {
    const failed = await trace(({ onOutcome }) =>
      onOutcome({
        state: "failed",
        code: "loop_limit",
        retryable: false,
        message: "Agent stopped after 80 iterations.",
      }),
    );
    expect(runSpan(failed)).toMatchObject({
      status: "error",
      errorMessage: "Agent stopped after 80 iterations.",
    });
    const canceled = await trace(({ onOutcome }) =>
      onOutcome({ state: "canceled", message: "Agent run was aborted." }),
    );
    expect(runSpan(canceled).status).toBe("error");
  });

  it("does not let a tool failure hide behind the pause", async () => {
    const spans = await trace(({ send, onOutcome }) => {
      failTool("Error running fetch: 500")({ send, onOutcome });
      onOutcome(pause);
    });
    expect(runSpan(spans).status).toBe("paused");
    expect(toolSpan(spans).status).toBe("error");
  });
});
