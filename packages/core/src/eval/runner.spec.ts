import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AgentEngine } from "../agent/engine/types.js";
import type { AgentChatEvent } from "../agent/types.js";
import type { AgentRunner } from "./agent-runner.js";
import type { AgentRunOutput } from "./types.js";

// The runner has two halves:
//  1. Pure orchestration (scoreEval/runEvals) over an injected AgentRunner —
//     fully testable with NO model and NO real agent loop.
//  2. createAgentRunner, which wraps the real runAgentLoop. We mock
//     production-agent + the engine registry + the observability store so we
//     can drive it end-to-end (incl. the LLM-judge path) without a model.

// Mock production-agent: actionsToEngineTools is a no-op, runAgentLoop is
// injected per-test via the runLoop seam so this default is never hit.
vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: () => [],
  runAgentLoop: vi.fn(),
}));

const engineMod = vi.hoisted(() => ({
  resolveEngine: vi.fn(),
  getStoredModelForEngine: vi.fn(),
  normalizeModelForEngine: vi.fn(
    (engine: { defaultModel?: string }, model?: string | null) =>
      model ?? engine.defaultModel,
  ),
}));
vi.mock("../agent/engine/index.js", () => ({
  resolveEngine: (...a: unknown[]) => engineMod.resolveEngine(...a),
  getStoredModelForEngine: (...a: unknown[]) =>
    engineMod.getStoredModelForEngine(...a),
  normalizeModelForEngine: (...a: unknown[]) =>
    engineMod.normalizeModelForEngine(...a),
}));

const storeMod = vi.hoisted(() => ({ insertEvalResult: vi.fn() }));
vi.mock("../observability/store.js", () => ({
  insertEvalResult: (...a: unknown[]) => storeMod.insertEvalResult(...a),
}));

const { defineEval } = await import("./define-eval.js");
const { contains, exactMatch, usesTool, llmJudge, createScorer } =
  await import("./scorer.js");
const { scoreEval, runEvals } = await import("./runner.js");
const { createAgentRunner } = await import("./agent-runner.js");

/** A fake runner that returns a fixed output and supplies a judge stub. */
function fakeRunner(
  out: Partial<AgentRunOutput>,
  judgeText = '{"score": 1, "reasoning": "ok"}',
): AgentRunner {
  const engine = { defaultModel: "fake-model" } as unknown as AgentEngine;
  return {
    engine,
    model: "fake-model",
    async runAgent() {
      return {
        text: "",
        toolCalls: [],
        ok: true,
        runId: "eval:test",
        durationMs: 1,
        ...out,
      };
    },
    analyzeContext() {
      return {
        engine,
        model: "fake-model",
        async judge() {
          return judgeText;
        },
      };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storeMod.insertEvalResult.mockResolvedValue(undefined);
});

describe("scoreEval with a JS scorer", () => {
  it("passes when a contains scorer is satisfied", async () => {
    const e = defineEval({
      name: "says hello",
      input: { prompt: "greet me" },
      scorers: [contains("hello")],
    });
    const row = await scoreEval(e, fakeRunner({ text: "well hello there" }));
    expect(row.passed).toBe(true);
    expect(row.scores).toHaveLength(1);
    expect(row.scores[0].scorer).toBe("contains");
    expect(row.scores[0].score).toBe(1);
    // Stores both the number AND a reason.
    expect(row.scores[0].reason).toContain("present");
    expect(row.avgScore).toBe(1);
  });

  it("fails the case (sub-threshold) and surfaces it as failed in the report", async () => {
    const e = defineEval({
      name: "must mention refunds",
      input: { prompt: "policy?" },
      threshold: 0.5,
      scorers: [contains("refund")],
    });
    const report = await runEvals([e], fakeRunner({ text: "no match here" }));
    expect(report.results[0].passed).toBe(false);
    expect(report.results[0].scores[0].score).toBe(0);
    // This is the CI gate signal the CLI maps to a non-zero exit code.
    expect(report.failed).toBe(1);
    expect(report.passed).toBe(0);
  });

  it("exact_match and uses_tool JS scorers behave as documented", async () => {
    const e = defineEval({
      name: "exact + tool",
      input: { prompt: "x" },
      scorers: [exactMatch("DONE"), usesTool("send-email")],
    });
    const row = await scoreEval(
      e,
      fakeRunner({ text: "  done  ", toolCalls: ["send-email"] }),
    );
    // case-insensitive + trimmed exact match
    expect(row.scores[0].score).toBe(1);
    // tool was used
    expect(row.scores[1].score).toBe(1);
    expect(row.passed).toBe(true);
  });

  it("a run-level error fails the case even if scorers would pass", async () => {
    const e = defineEval({
      name: "errored run",
      input: { prompt: "x" },
      scorers: [contains("anything")],
    });
    const row = await scoreEval(
      e,
      fakeRunner({ text: "anything", ok: false, error: "boom" }),
    );
    expect(row.passed).toBe(false);
    expect(row.error).toBe("boom");
  });

  it("a scorer that throws degrades to score 0, not a crash", async () => {
    const explode = createScorer({
      name: "explode",
      generateScore() {
        throw new Error("scorer bug");
      },
    });
    const e = defineEval({
      name: "bad scorer",
      input: { prompt: "x" },
      scorers: [explode],
    });
    const row = await scoreEval(e, fakeRunner({ text: "hi" }));
    expect(row.scores[0].score).toBe(0);
    expect(row.scores[0].passed).toBe(false);
    expect(row.scores[0].reason).toContain("scorer bug");
  });

  it("honors a global threshold override", async () => {
    const e = defineEval({
      name: "partial contains",
      input: { prompt: "x" },
      // 1 of 2 phrases => score 0.5
      scorers: [contains(["a", "z"])],
    });
    const passing = await scoreEval(e, fakeRunner({ text: "a only" }), {
      thresholdOverride: 0.5,
    });
    expect(passing.scores[0].score).toBe(0.5);
    expect(passing.passed).toBe(true);

    const failing = await scoreEval(e, fakeRunner({ text: "a only" }), {
      thresholdOverride: 0.9,
    });
    expect(failing.passed).toBe(false);
  });
});

describe("llmJudge scorer via the analyze context (mocked engine)", () => {
  it("parses the judge verdict into a normalized score + reason", async () => {
    const e = defineEval({
      name: "judged",
      input: { prompt: "x" },
      threshold: 0.7,
      scorers: [llmJudge({ criteria: "quality" })],
    });
    const row = await scoreEval(
      e,
      fakeRunner({ text: "great" }, '{"score": 0.9, "reasoning": "solid"}'),
    );
    expect(row.scores[0].score).toBe(0.9);
    expect(row.scores[0].reason).toBe("solid");
    expect(row.passed).toBe(true);
  });

  it("normalizes a custom score range and gates correctly", async () => {
    const e = defineEval({
      name: "judged-scale",
      input: { prompt: "x" },
      threshold: 0.8,
      scorers: [llmJudge({ criteria: "q", scoreRange: { min: 0, max: 10 } })],
    });
    const row = await scoreEval(
      e,
      fakeRunner({ text: "x" }, '{"score": 6, "reasoning": "mid"}'),
    );
    expect(row.scores[0].score).toBeCloseTo(0.6, 5);
    expect(row.passed).toBe(false); // 0.6 < 0.8
  });

  it("treats an unparseable judge verdict as score 0", async () => {
    const e = defineEval({
      name: "judged-garbage",
      input: { prompt: "x" },
      scorers: [llmJudge({ criteria: "q" })],
    });
    const row = await scoreEval(
      e,
      fakeRunner({ text: "x" }, "I cannot produce JSON"),
    );
    expect(row.scores[0].score).toBe(0);
    expect(row.scores[0].reason).toContain("parseable");
  });
});

describe("createAgentRunner over a mocked runAgentLoop (no real model)", () => {
  it("collects assistant text + tool calls off the send stream", async () => {
    // Inject a fake loop that emits a couple of text + tool events.
    const runLoop = vi.fn(
      async (opts: { send: (e: AgentChatEvent) => void }) => {
        opts.send({ type: "text", text: "Hello " });
        opts.send({ type: "tool_start", tool: "search", input: {} });
        opts.send({ type: "text", text: "world" });
        return {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "fake-model",
        };
      },
    );

    const engine = { defaultModel: "fake-model" } as unknown as AgentEngine;
    const runner = await createAgentRunner({
      actions: {},
      engine,
      model: "fake-model",
      runLoop: runLoop as never,
    });

    const out = await runner.runAgent({ prompt: "hi" });
    expect(out.text).toBe("Hello world");
    expect(out.toolCalls).toEqual(["search"]);
    expect(out.ok).toBe(true);

    // End-to-end: a contains scorer over the real collected text.
    const e = defineEval({
      name: "e2e",
      input: { prompt: "hi" },
      scorers: [contains("world"), usesTool("search")],
    });
    const row = await scoreEval(e, runner);
    expect(row.passed).toBe(true);
  });

  it("marks the run not-ok when the loop emits an error event", async () => {
    const runLoop = vi.fn(
      async (opts: { send: (e: AgentChatEvent) => void }) => {
        opts.send({ type: "error", error: "model exploded" });
        return {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "fake-model",
        };
      },
    );
    const engine = { defaultModel: "fake-model" } as unknown as AgentEngine;
    const runner = await createAgentRunner({
      actions: {},
      engine,
      model: "fake-model",
      runLoop: runLoop as never,
    });
    const out = await runner.runAgent({ prompt: "hi" });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("model exploded");
  });

  it("resolves engine + model from the registry when not supplied", async () => {
    engineMod.resolveEngine.mockResolvedValue({
      defaultModel: "registry-model",
    });
    engineMod.getStoredModelForEngine.mockResolvedValue(null);
    const runner = await createAgentRunner({
      actions: {},
      runLoop: (async () => ({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "registry-model",
      })) as never,
    });
    expect(engineMod.resolveEngine).toHaveBeenCalled();
    expect(runner.model).toBe("registry-model");
  });
});

describe("persistence to the observability store", () => {
  it("writes one row per (eval x scorer) when persist is on", async () => {
    const e = defineEval({
      name: "persisted",
      input: { prompt: "x" },
      scorers: [contains("a"), exactMatch("a")],
    });
    await runEvals([e], fakeRunner({ text: "a" }), { persist: true });
    // 2 scorers => 2 rows.
    expect(storeMod.insertEvalResult).toHaveBeenCalledTimes(2);
    const firstRow = storeMod.insertEvalResult.mock.calls[0][0];
    expect(firstRow.evalType).toBe("automated");
    expect(firstRow.criteria).toContain("eval:persisted:");
    expect(firstRow.metadata).toMatchObject({ source: "cli-eval" });
  });

  it("does not write when persist is off (default in scoreEval)", async () => {
    const e = defineEval({
      name: "unpersisted",
      input: { prompt: "x" },
      scorers: [contains("a")],
    });
    await runEvals([e], fakeRunner({ text: "a" }), { persist: false });
    expect(storeMod.insertEvalResult).not.toHaveBeenCalled();
  });
});
