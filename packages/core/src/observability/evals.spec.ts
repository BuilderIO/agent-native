import { describe, it, expect, beforeEach, vi } from "vitest";

import type { AgentEngine } from "../agent/engine/types.js";
import type { TraceSummary, EvalCriteria } from "./types.js";

const store = vi.hoisted(() => ({
  getTraceSummary: vi.fn(),
  insertEvalResult: vi.fn(),
  getEvalDataset: vi.fn(),
}));
const runStore = vi.hoisted(() => ({
  getRunById: vi.fn(),
  getRunEventsSince: vi.fn(),
}));
const engineMod = vi.hoisted(() => ({
  resolveEngine: vi.fn(),
  getStoredModelForEngine: vi.fn(),
  normalizeModelForEngine: vi.fn(
    (engine: { defaultModel?: string }, model?: string | null) =>
      model ?? engine.defaultModel,
  ),
}));

vi.mock("./store.js", () => ({
  getTraceSummary: (...a: unknown[]) => store.getTraceSummary(...a),
  insertEvalResult: (...a: unknown[]) => store.insertEvalResult(...a),
  getEvalDataset: (...a: unknown[]) => store.getEvalDataset(...a),
}));
vi.mock("../agent/run-store.js", () => ({
  getRunById: (...a: unknown[]) => runStore.getRunById(...a),
  getRunEventsSince: (...a: unknown[]) => runStore.getRunEventsSince(...a),
}));
vi.mock("../agent/engine/index.js", () => ({
  resolveEngine: (...a: unknown[]) => engineMod.resolveEngine(...a),
  getStoredModelForEngine: (...a: unknown[]) =>
    engineMod.getStoredModelForEngine(...a),
  normalizeModelForEngine: (...a: unknown[]) =>
    engineMod.normalizeModelForEngine(...a),
}));

const { runAutomatedEvals, runLlmJudgeEval, runDatasetEval, evaluateRun } =
  await import("./evals.js");

function summary(over: Partial<TraceSummary> = {}): TraceSummary {
  return {
    runId: "run-1",
    threadId: "thread-1",
    userId: "alice",
    totalSpans: 0,
    llmCalls: 0,
    toolCalls: 0,
    successfulTools: 0,
    failedTools: 0,
    totalDurationMs: 0,
    totalCostCentsX100: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    model: "test-model",
    createdAt: 0,
    ...over,
  };
}

function fakeEngine(responseText: string): AgentEngine {
  return {
    name: "fake",
    label: "Fake",
    defaultModel: "fake-model",
    supportedModels: ["fake-model"],
    capabilities: {} as any,
    async *stream() {
      yield { type: "text-delta", text: responseText } as any;
    },
  } as AgentEngine;
}

function byCriteria(results: { criteria: string }[]) {
  return Object.fromEntries(results.map((r) => [r.criteria, r])) as Record<
    string,
    any
  >;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [
    ...Object.values(store),
    ...Object.values(runStore),
    ...Object.values(engineMod),
  ])
    fn.mockReset();
  store.insertEvalResult.mockResolvedValue(undefined);
});

describe("runAutomatedEvals deterministic scorers", () => {
  it("returns [] (and writes nothing) when no trace summary exists", async () => {
    store.getTraceSummary.mockResolvedValue(null);
    runStore.getRunById.mockResolvedValue(null);

    const results = await runAutomatedEvals("run-1");
    expect(results).toEqual([]);
    expect(store.insertEvalResult).not.toHaveBeenCalled();
  });

  it("scores a perfect tool run: success rate 1, full efficiency, recovers", async () => {
    store.getTraceSummary.mockResolvedValue(
      summary({
        toolCalls: 3,
        successfulTools: 3,
        failedTools: 0,
        llmCalls: 3,
        totalDurationMs: 0,
        totalCostCentsX100: 0,
      }),
    );
    runStore.getRunById.mockResolvedValue({
      id: "run-1",
      threadId: "thread-1",
      status: "completed",
      startedAt: 0,
    });

    const r = byCriteria(await runAutomatedEvals("run-1"));
    expect(r.tool_success_rate.score).toBe(1);
    expect(r.step_efficiency.score).toBe(1);
    expect(r.latency_score.score).toBe(1);
    expect(r.cost_efficiency.score).toBe(1);
    expect(r.error_recovery.score).toBe(1);
  });

  it("tool_success_rate is failedTools-aware and is 1.0 for a no-tool run", async () => {
    store.getTraceSummary.mockResolvedValue(
      summary({ toolCalls: 4, successfulTools: 1, failedTools: 3 }),
    );
    runStore.getRunById.mockResolvedValue(null);
    let r = byCriteria(await runAutomatedEvals("run-1"));
    expect(r.tool_success_rate.score).toBe(0.25);
    expect(r.tool_success_rate.metadata).toMatchObject({
      totalTools: 4,
      successfulTools: 1,
      failedTools: 3,
    });

    store.getTraceSummary.mockResolvedValue(summary({ toolCalls: 0 }));
    r = byCriteria(await runAutomatedEvals("run-1"));
    expect(r.tool_success_rate.score).toBe(1);
    expect(r.step_efficiency.score).toBe(1);
  });

  it("step_efficiency penalizes many LLM iterations per tool call", async () => {
    store.getTraceSummary.mockResolvedValue(
      summary({ toolCalls: 2, llmCalls: 8 }),
    );
    runStore.getRunById.mockResolvedValue(null);
    const r = byCriteria(await runAutomatedEvals("run-1"));
    expect(r.step_efficiency.score).toBe(0.25);
  });

  it("latency_score clamps to 0 when the run vastly exceeds the baseline", async () => {
    store.getTraceSummary.mockResolvedValue(
      summary({ toolCalls: 0, totalDurationMs: 50_000 }),
    );
    runStore.getRunById.mockResolvedValue(null);
    const r = byCriteria(await runAutomatedEvals("run-1"));
    expect(r.latency_score.score).toBe(0);
    expect(r.latency_score.metadata).toMatchObject({
      actualMs: 50_000,
      expectedMs: 10_000,
    });
  });

  it("cost_efficiency clamps to 0 when cost exceeds the per-tool budget", async () => {
    store.getTraceSummary.mockResolvedValue(
      summary({ toolCalls: 0, totalCostCentsX100: 200 }),
    );
    runStore.getRunById.mockResolvedValue(null);
    const r = byCriteria(await runAutomatedEvals("run-1"));
    expect(r.cost_efficiency.score).toBe(0);
  });

  it("error_recovery: failures + a non-completed run scores 0", async () => {
    store.getTraceSummary.mockResolvedValue(
      summary({ toolCalls: 2, successfulTools: 1, failedTools: 1 }),
    );
    runStore.getRunById.mockResolvedValue({
      id: "run-1",
      threadId: "thread-1",
      status: "failed",
      startedAt: 0,
    });
    const r = byCriteria(await runAutomatedEvals("run-1"));
    expect(r.error_recovery.score).toBe(0);
    expect(r.error_recovery.metadata).toMatchObject({
      hadErrors: true,
      runStatus: "failed",
    });
  });

  it("error_recovery: failures + a truncated run scores 0, not the 1 it scored when truncations were stored as completed", async () => {
    store.getTraceSummary.mockResolvedValue(
      summary({ toolCalls: 2, successfulTools: 1, failedTools: 1 }),
    );
    runStore.getRunById.mockResolvedValue({
      id: "run-1",
      threadId: "thread-1",
      status: "truncated",
      startedAt: 0,
    });
    const r = byCriteria(await runAutomatedEvals("run-1"));
    expect(r.error_recovery.score).toBe(0);
    expect(r.error_recovery.metadata).toMatchObject({
      hadErrors: true,
      runStatus: "truncated",
    });
  });

  it("error_recovery: failures but a completed run still scores 1 (recovered)", async () => {
    store.getTraceSummary.mockResolvedValue(
      summary({ toolCalls: 2, successfulTools: 1, failedTools: 1 }),
    );
    runStore.getRunById.mockResolvedValue({
      id: "run-1",
      threadId: "thread-1",
      status: "completed",
      startedAt: 0,
    });
    const r = byCriteria(await runAutomatedEvals("run-1"));
    expect(r.error_recovery.score).toBe(1);
  });

  it("falls back to 'unknown' run status when the run row is missing", async () => {
    store.getTraceSummary.mockResolvedValue(
      summary({ toolCalls: 1, successfulTools: 0, failedTools: 1 }),
    );
    runStore.getRunById.mockResolvedValue(null);
    const r = byCriteria(await runAutomatedEvals("run-1"));
    expect(r.error_recovery.score).toBe(0);
    expect(r.error_recovery.metadata).toMatchObject({ runStatus: "unknown" });
  });

  it("carries the trace summary's userId onto every eval row (scoping)", async () => {
    store.getTraceSummary.mockResolvedValue(summary({ userId: "carol" }));
    runStore.getRunById.mockResolvedValue(null);
    const results = await runAutomatedEvals("run-1");
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.userId === "carol")).toBe(true);
    expect(results.every((r) => r.evalType === "automated")).toBe(true);
  });
});

describe("runLlmJudgeEval", () => {
  const criteria: EvalCriteria = {
    name: "helpfulness",
    description: "How helpful the response is",
  };

  beforeEach(() => {
    runStore.getRunEventsSince.mockResolvedValue([
      {
        seq: 1,
        eventData: JSON.stringify({ type: "user-message", text: "hi" }),
      },
      {
        seq: 2,
        eventData: JSON.stringify({ type: "text", text: "hello there" }),
      },
    ]);
    runStore.getRunById.mockResolvedValue({
      id: "run-1",
      threadId: "thread-1",
      status: "completed",
      startedAt: 0,
    });
  });

  it("returns null when the run has no events", async () => {
    runStore.getRunEventsSince.mockResolvedValue([]);
    const out = await runLlmJudgeEval("run-1", criteria, {
      engine: fakeEngine('{"score": 1, "reasoning": "x"}'),
    });
    expect(out).toBeNull();
  });

  it("parses a clean JSON judge response into a [0,1] score", async () => {
    const out = await runLlmJudgeEval("run-1", criteria, {
      engine: fakeEngine('{"score": 0.9, "reasoning": "good answer"}'),
      userId: "alice",
    });
    expect(out).not.toBeNull();
    expect(out!.score).toBe(0.9);
    expect(out!.reasoning).toBe("good answer");
    expect(out!.evalType).toBe("llm_judge");
    expect(out!.userId).toBe("alice");
    expect(out!.criteria).toBe("helpfulness");
  });

  it("includes tool calls and results in the judge transcript", async () => {
    runStore.getRunEventsSince.mockResolvedValue([
      {
        seq: 1,
        eventData: JSON.stringify({ type: "text", text: "working on it" }),
      },
      {
        seq: 2,
        eventData: JSON.stringify({
          type: "tool_start",
          tool: "search",
          input: { q: "hi" },
        }),
      },
      {
        seq: 3,
        eventData: JSON.stringify({
          type: "tool_done",
          tool: "search",
          result: "found 3 results",
        }),
      },
    ]);
    let capturedPrompt = "";
    const capturingEngine = {
      name: "fake",
      label: "Fake",
      defaultModel: "fake-model",
      supportedModels: ["fake-model"],
      capabilities: {} as any,
      async *stream(opts: any) {
        capturedPrompt = opts.messages[0].content[0].text;
        yield {
          type: "text-delta",
          text: '{"score": 1, "reasoning": "ok"}',
        } as any;
      },
    } as AgentEngine;
    await runLlmJudgeEval("run-1", criteria, { engine: capturingEngine });
    expect(capturedPrompt).toContain("[Tool Call: search]");
    expect(capturedPrompt).toContain("[Tool Result]: found 3 results");
  });

  it("normalizes a custom score range to [0,1]", async () => {
    const out = await runLlmJudgeEval(
      "run-1",
      { ...criteria, scoreRange: { min: 1, max: 10 } },
      { engine: fakeEngine('Here you go: {"score": 7, "reasoning": "ok"}') },
    );
    expect(out!.score).toBeCloseTo(6 / 9, 5);
    expect(out!.metadata).toMatchObject({ rawScore: 7 });
  });

  it("extracts the JSON object even when wrapped in prose / markdown", async () => {
    const out = await runLlmJudgeEval("run-1", criteria, {
      engine: fakeEngine(
        'Sure!\n```json\n{"score": 0.5, "reasoning": "mid"}\n```\nDone.',
      ),
    });
    expect(out!.score).toBe(0.5);
  });

  it("returns null when the response contains no JSON object", async () => {
    const out = await runLlmJudgeEval("run-1", criteria, {
      engine: fakeEngine("I cannot evaluate this."),
    });
    expect(out).toBeNull();
  });

  it("returns null (does not throw) on malformed JSON", async () => {
    const out = await runLlmJudgeEval("run-1", criteria, {
      engine: fakeEngine('{"score": oops not valid}'),
    });
    expect(out).toBeNull();
  });

  it("clamps out-of-range judge scores into [0,1]", async () => {
    const over = await runLlmJudgeEval("run-1", criteria, {
      engine: fakeEngine('{"score": 5, "reasoning": "too high"}'),
    });
    expect(over!.score).toBe(1);
    const under = await runLlmJudgeEval("run-1", criteria, {
      engine: fakeEngine('{"score": -3, "reasoning": "too low"}'),
    });
    expect(under!.score).toBe(0);
  });

  it("resolves engine + stored model when none are supplied", async () => {
    const eng = fakeEngine('{"score": 0.7, "reasoning": "auto"}');
    engineMod.resolveEngine.mockResolvedValue(eng);
    engineMod.getStoredModelForEngine.mockResolvedValue("stored-model");

    const out = await runLlmJudgeEval("run-1", criteria);
    expect(engineMod.resolveEngine).toHaveBeenCalled();
    expect(out!.score).toBe(0.7);
    expect(out!.metadata).toMatchObject({ model: "stored-model" });
  });
});

describe("runDatasetEval aggregation", () => {
  it("returns an empty result when the dataset is missing", async () => {
    store.getEvalDataset.mockResolvedValue(null);
    const out = await runDatasetEval("ds-1", {
      engine: fakeEngine('{"score":1,"reasoning":"x"}'),
    });
    expect(out).toEqual({
      datasetId: "ds-1",
      totalCases: 0,
      avgScore: 0,
      results: [],
    });
  });

  it("averages judge scores across every test case (default single criterion)", async () => {
    store.getEvalDataset.mockResolvedValue({
      id: "ds-1",
      name: "n",
      description: "",
      entries: [{ input: "case A" }, { input: "case B", expectedOutput: "B!" }],
      createdAt: 0,
      updatedAt: 0,
    });

    const out = await runDatasetEval("ds-1", {
      engine: fakeEngine('{"score": 0.8, "reasoning": "fine"}'),
    });

    expect(out.totalCases).toBe(2);
    expect(out.results).toHaveLength(2);
    expect(out.avgScore).toBeCloseTo(0.8, 5);
    expect(out.results.every((r) => r.userId === null)).toBe(true);
    expect(out.results.every((r) => r.runId.startsWith("dataset:ds-1:"))).toBe(
      true,
    );
  });

  it("runs each supplied criterion against each case (cross product)", async () => {
    store.getEvalDataset.mockResolvedValue({
      id: "ds-1",
      name: "n",
      description: "",
      entries: [{ input: "only case" }],
      createdAt: 0,
      updatedAt: 0,
    });

    const out = await runDatasetEval("ds-1", {
      engine: fakeEngine('{"score": 0.5, "reasoning": "ok"}'),
      criteria: [
        { name: "accuracy", description: "a" },
        { name: "tone", description: "t" },
      ],
    });
    expect(out.results).toHaveLength(2);
    expect(new Set(out.results.map((r) => r.criteria))).toEqual(
      new Set(["accuracy", "tone"]),
    );
  });

  it("skips unparseable judge responses (avgScore ignores them)", async () => {
    store.getEvalDataset.mockResolvedValue({
      id: "ds-1",
      name: "n",
      description: "",
      entries: [{ input: "a" }, { input: "b" }],
      createdAt: 0,
      updatedAt: 0,
    });
    const out = await runDatasetEval("ds-1", {
      engine: fakeEngine("nope, no json here"),
    });
    expect(out.results).toHaveLength(0);
    expect(out.avgScore).toBe(0);
    expect(out.totalCases).toBe(2);
  });
});

describe("evaluateRun orchestrator", () => {
  beforeEach(() => {
    store.getTraceSummary.mockResolvedValue(
      summary({ toolCalls: 1, successfulTools: 1, userId: "alice" }),
    );
    runStore.getRunById.mockResolvedValue({
      id: "run-1",
      threadId: "thread-1",
      status: "completed",
      startedAt: 0,
    });
  });

  it("runs only the 5 automated evals when sampleRate is 0 (no judge)", async () => {
    const results = await evaluateRun("run-1", { sampleRate: 0 });
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.evalType === "automated")).toBe(true);
  });

  it("appends judge evals when the sample roll passes", async () => {
    engineMod.resolveEngine.mockResolvedValue(
      fakeEngine('{"score": 0.9, "reasoning": "great"}'),
    );
    engineMod.getStoredModelForEngine.mockResolvedValue("m");
    runStore.getRunEventsSince.mockResolvedValue([
      {
        seq: 1,
        eventData: JSON.stringify({ type: "user-message", text: "hi" }),
      },
      { seq: 2, eventData: JSON.stringify({ type: "text", text: "hello" }) },
    ]);

    const results = await evaluateRun("run-1", { sampleRate: 1 });
    expect(results).toHaveLength(7);
    const judge = results.filter((r) => r.evalType === "llm_judge");
    expect(judge).toHaveLength(2);
    expect(judge.every((r) => r.userId === "alice")).toBe(true);
  });
});
