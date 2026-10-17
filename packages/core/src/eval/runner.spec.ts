import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { AgentEngine } from "../agent/engine/types.js";
import type { AgentChatEvent } from "../agent/types.js";
import type { AgentRunner } from "./agent-runner.js";
import type { AgentRunOutput } from "./types.js";

const productionMod = vi.hoisted(() => ({
  actionsToEngineTools: vi.fn((actions: Record<string, unknown> = {}) =>
    Object.keys(actions).map((name) => ({
      name,
      description: `${name} action`,
      inputSchema: { type: "object", properties: {} },
    })),
  ),
  runAgentLoop: vi.fn(),
}));
vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: (...a: unknown[]) =>
    productionMod.actionsToEngineTools(...a),
  runAgentLoop: (...a: unknown[]) => productionMod.runAgentLoop(...a),
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
const { scoreEval, runEvals, runEvalSuite, loadProductionEvalContext } =
  await import("./runner.js");
const { formatReport } = await import("./report.js");
const { createAgentRunner } = await import("./agent-runner.js");
const { attachToolSearch } = await import("../agent/tool-search.js");

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

function testProductionContext() {
  return {
    actions: { search: { readOnly: true } as never },
    systemPrompt: "production prompt",
    finalResponseGuard: (() => null) as never,
    ownerEmail: "eval@example.com",
    orgId: "org-eval",
  };
}

function testProductionChatPath(
  prefetchStatus: "ok" | "empty" | "timed_out" | "failed" = "ok",
) {
  return {
    async run({
      input,
      identity,
      onUsage,
    }: {
      input: { prompt: string };
      identity: { ownerEmail: string; orgId: string };
      onUsage(usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        model: string;
      }): void;
    }) {
      onUsage({
        inputTokens: 4,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "fake-model",
      });
      return {
        output: {
          text: `production: ${input.prompt}`,
          toolCalls: ["search"],
          ok: true,
          runId: "run-production",
          durationMs: 1,
          usage: {
            inputTokens: 4,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            usageReported: true,
            model: "fake-model",
          },
        },
        receipt: {
          productionAgentLoopInvoked: true,
          requestPreparationInvoked: true as const,
          systemPromptBuilt: true as const,
          finalResponseGuardInstalled: true as const,
          finalResponseGuardApplied: true as const,
          usageCaptured: true as const,
          prefetchStatus,
          ownerEmail: identity.ownerEmail,
          orgId: identity.orgId,
          initialToolNames: ["search"],
          availableActionNames: ["search"],
          readOnlyActionNames: ["search"],
        },
      };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storeMod.insertEvalResult.mockResolvedValue(undefined);
  engineMod.resolveEngine.mockResolvedValue({
    defaultModel: "fake-model",
  });
  engineMod.getStoredModelForEngine.mockResolvedValue(null);
  productionMod.runAgentLoop.mockResolvedValue({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model: "fake-model",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("scoreEval with a JS scorer", () => {
  it("rejects custom callbacks in lower-level APIs with a production-context runner", async () => {
    const productionChatPath = testProductionChatPath();
    const adapterRun = vi.spyOn(productionChatPath, "run");
    const customRun = vi.fn(async (ctx) => ({
      ...(await ctx.runAgent(ctx.input)),
      text: "fabricated production answer",
      ok: true,
    }));
    const evalCase = defineEval({
      name: "custom-production-callback",
      input: { prompt: "find active users" },
      run: customRun,
      scorers: [contains("fabricated")],
    });
    const runner = await createAgentRunner({
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
    });
    const wrappedRunner: AgentRunner = { ...runner };
    const forwardingRunner: AgentRunner = {
      ...runner,
      runAgent: (input, options) => runner.runAgent(input, options),
    };
    const reconstructedRunner: AgentRunner = {
      runAgent: (input, options) => runner.runAgent(input, options),
      analyzeContext: runner.analyzeContext,
      engine: runner.engine,
      model: runner.model,
    };
    const reconstructedRunnerWithForwarders: AgentRunner = {
      runAgent: (input, options) => runner.runAgent(input, options),
      analyzeContext: () => runner.analyzeContext(),
      engine: runner.engine,
      model: runner.model,
    };
    const reconstructedWithFreshEngine: AgentRunner = {
      runAgent: (input, options) => runner.runAgent(input, options),
      analyzeContext: () => ({
        ...runner.analyzeContext(),
        engine: new Proxy({ ...runner.engine }, {}),
      }),
      engine: new Proxy({ ...runner.engine }, {}),
      model: runner.model,
    };

    await expect(scoreEval(evalCase, runner)).rejects.toThrow(
      "cannot define custom run callbacks",
    );
    await expect(scoreEval(evalCase, wrappedRunner)).rejects.toThrow(
      "cannot define custom run callbacks",
    );
    await expect(scoreEval(evalCase, forwardingRunner)).rejects.toThrow(
      "cannot define custom run callbacks",
    );
    await expect(scoreEval(evalCase, reconstructedRunner)).rejects.toThrow(
      "cannot define custom run callbacks",
    );
    await expect(
      scoreEval(evalCase, reconstructedRunnerWithForwarders),
    ).rejects.toThrow("cannot define custom run callbacks");
    await expect(
      scoreEval(evalCase, reconstructedWithFreshEngine, {
        productionPath: true,
      }),
    ).rejects.toThrow("cannot define custom run callbacks");
    await expect(
      runEvals([evalCase], runner, { persist: false }),
    ).rejects.toThrow("cannot define custom run callbacks");
    await expect(
      runEvals([evalCase], wrappedRunner, { persist: false }),
    ).rejects.toThrow("cannot define custom run callbacks");
    await expect(
      runEvals([evalCase], forwardingRunner, { persist: false }),
    ).rejects.toThrow("cannot define custom run callbacks");
    await expect(
      runEvals([evalCase], reconstructedWithFreshEngine, {
        persist: false,
        productionPath: true,
      }),
    ).rejects.toThrow("cannot define custom run callbacks");

    expect(customRun).not.toHaveBeenCalled();
    expect(adapterRun).not.toHaveBeenCalled();
  });

  it("rejects a replaced runAgent on a production-context runner", async () => {
    const runner = await createAgentRunner({
      productionContext: {
        ...testProductionContext(),
        productionChatPath: testProductionChatPath(),
      },
    });
    const runAgent = vi.fn(async () => ({
      text: "fabricated production answer",
      toolCalls: [],
      ok: true,
      runId: "fabricated-run",
      durationMs: 1,
    }));
    const overriddenRunner: AgentRunner = { ...runner, runAgent };
    const evalCase = defineEval({
      name: "overridden-production-runner",
      input: { prompt: "find active users" },
      scorers: [contains("fabricated")],
    });

    await expect(scoreEval(evalCase, overriddenRunner)).rejects.toThrow(
      "cannot override production runner methods",
    );
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("rejects a replaced analyzeContext on a production-context runner", async () => {
    const runner = await createAgentRunner({
      productionContext: {
        ...testProductionContext(),
        productionChatPath: testProductionChatPath(),
      },
    });
    const analyzeContext = vi.fn(() => runner.analyzeContext());
    const overriddenRunner: AgentRunner = { ...runner, analyzeContext };
    const analyze = vi.fn((run: { text: string }) => run.text);
    const evalCase = defineEval({
      name: "overridden-production-analyze-context",
      input: { prompt: "find active users" },
      scorers: [{ name: "context", analyze, generateScore: () => 1 }],
    });

    await expect(scoreEval(evalCase, overriddenRunner)).rejects.toThrow(
      "cannot override production runner methods",
    );
    expect(analyzeContext).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });

  it("preserves production provenance through bound runner methods", async () => {
    const runner = await createAgentRunner({
      productionContext: {
        ...testProductionContext(),
        productionChatPath: testProductionChatPath(),
      },
    });
    const boundRunner: AgentRunner = {
      runAgent: runner.runAgent.bind(runner),
      analyzeContext: runner.analyzeContext.bind(runner),
      engine: runner.engine,
      model: runner.model,
    };
    const customRun = vi.fn(async () => ({
      text: "fabricated production answer",
      toolCalls: [],
      ok: true,
      runId: "fabricated-run",
      durationMs: 1,
    }));
    const evalCase = defineEval({
      name: "bound-production-runner-callback",
      input: { prompt: "find active users" },
      run: customRun,
      scorers: [contains("fabricated")],
    });

    await expect(scoreEval(evalCase, boundRunner)).rejects.toThrow(
      "cannot define custom run callbacks",
    );
    expect(customRun).not.toHaveBeenCalled();
  });

  it("rejects production methods mixed across runners", async () => {
    const firstRunner = await createAgentRunner({
      productionContext: {
        ...testProductionContext(),
        productionChatPath: testProductionChatPath(),
      },
    });
    const secondRunner = await createAgentRunner({
      productionContext: {
        ...testProductionContext(),
        productionChatPath: testProductionChatPath(),
      },
    });
    const mixedRunner: AgentRunner = {
      ...firstRunner,
      runAgent: secondRunner.runAgent,
    };
    const generateScore = vi.fn(() => 1);
    const evalCase = defineEval({
      name: "mixed-production-runner-methods",
      input: { prompt: "find active users" },
      scorers: [{ name: "always-pass", generateScore }],
    });

    await expect(scoreEval(evalCase, mixedRunner)).rejects.toThrow(
      "cannot override production runner methods",
    );
    expect(generateScore).not.toHaveBeenCalled();
  });

  it("isolates output observers from the scored production output", async () => {
    const runner = await createAgentRunner({
      productionContext: {
        ...testProductionContext(),
        productionChatPath: testProductionChatPath(),
      },
    });
    const onRunOutput = vi.fn((output: AgentRunOutput) => {
      Reflect.set(output, "text", "fabricated output");
      Reflect.set(output, "ok", false);
      if (output.usage) Reflect.set(output.usage, "inputTokens", 100);
    });
    const evalCase = defineEval({
      name: "isolated-production-output-observer",
      input: { prompt: "find active users" },
      scorers: [contains("production: find active users")],
    });

    const row = await scoreEval(evalCase, runner, { onRunOutput });

    expect(row).toMatchObject({
      status: "passed",
      passed: true,
      usage: { inputTokens: 4 },
    });
    expect(onRunOutput).toHaveBeenCalledWith(
      expect.objectContaining({ text: "fabricated output", ok: false }),
    );
  });

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
    expect(row.scores[0].score).toBe(1);
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

  it("passes the eval's action allowlist to the runner", async () => {
    const e = defineEval({
      name: "metadata-only",
      input: { prompt: "find a source" },
      actionAllowlist: ["find-data", "tool-search"],
      scorers: [contains("source")],
    });
    const runner = fakeRunner({ text: "source" });
    const runSpy = vi.spyOn(runner, "runAgent");

    await scoreEval(e, runner);

    expect(runSpy).toHaveBeenCalledWith(e.input, {
      actionAllowlist: ["find-data", "tool-search"],
    });
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

  it("reports skipped evals without running the agent or scorers", async () => {
    const e = defineEval({
      name: "gated nightly",
      input: { prompt: "x" },
      skipReason: "Skipped because NIGHTLY_EVALS is unset",
      scorers: [],
    });
    const runner = fakeRunner({ text: "should not run" });
    const runSpy = vi.spyOn(runner, "runAgent");

    const row = await scoreEval(e, runner);

    expect(runSpy).not.toHaveBeenCalled();
    expect(row).toMatchObject({
      eval: "gated nightly",
      status: "skipped",
      skipReason: "Skipped because NIGHTLY_EVALS is unset",
      passed: true,
      avgScore: 0,
      scores: [],
    });
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
    expect(row.passed).toBe(false);
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
  it("resolves the production engine and model inside the caller org context", async () => {
    const context = {
      ...testProductionContext(),
      appId: "analytics",
      productionChatPath: testProductionChatPath(),
    };
    const { getRequestContext } = await import("../server/request-context.js");
    const engine = { defaultModel: "fake-model" } as unknown as AgentEngine;
    engineMod.resolveEngine.mockImplementation(async (config) => {
      expect(config).toEqual({ appId: "analytics" });
      expect(getRequestContext()).toMatchObject({
        userEmail: "eval@example.com",
        orgId: "org-eval",
        isSyntheticTraffic: true,
      });
      return engine;
    });
    engineMod.getStoredModelForEngine.mockImplementation(
      async (_engine, options) => {
        expect(options).toEqual({ appId: "analytics" });
        expect(getRequestContext()).toMatchObject({
          userEmail: "eval@example.com",
          orgId: "org-eval",
          isSyntheticTraffic: true,
        });
        return null;
      },
    );

    await createAgentRunner({ productionContext: context });

    expect(engineMod.resolveEngine).toHaveBeenCalledWith({
      appId: "analytics",
    });
    expect(engineMod.getStoredModelForEngine).toHaveBeenCalledWith(engine, {
      appId: "analytics",
    });
  });

  it("supports the legacy actions and systemPrompt runner options", async () => {
    const actions = { search: { readOnly: true } as never };
    const engine = { defaultModel: "fake-model" } as unknown as AgentEngine;
    const runner = await createAgentRunner({
      actions,
      systemPrompt: "legacy eval prompt",
      engine,
    });

    await runner.runAgent({ prompt: "legacy request" });

    expect(productionMod.runAgentLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        actions,
        systemPrompt: "legacy eval prompt",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "legacy request" }],
          },
        ],
      }),
    );
  });

  it("filters action tools and tool-search before the model loop", async () => {
    const rowQueryRun = vi.fn();
    const actions = attachToolSearch({
      "search-bigquery-schema": {
        readOnly: true,
        tool: {
          description: "Search schema metadata",
          parameters: { type: "object", properties: {} },
        },
        run: vi.fn(),
      } as never,
      bigquery: {
        readOnly: true,
        tool: {
          description: "Query BigQuery rows",
          parameters: { type: "object", properties: {} },
        },
        run: rowQueryRun,
      } as never,
    });
    const runLoop = vi.fn(async (options: { actions: Record<string, any> }) => {
      expect(Object.keys(options.actions).sort()).toEqual([
        "search-bigquery-schema",
        "tool-search",
      ]);
      const search = await options.actions["tool-search"].run(
        { names: ["bigquery"] },
        { caller: "tool" },
      );
      expect(
        search.results.map((result: { name: string }) => result.name),
      ).not.toContain("bigquery");
      return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "fake-model",
      };
    });
    const runner = await createAgentRunner({
      actions,
      engine: { defaultModel: "fake-model" } as unknown as AgentEngine,
      model: "fake-model",
      runLoop: runLoop as never,
    });

    const output = await runner.runAgent(
      { prompt: "describe available metadata" },
      { actionAllowlist: ["search-bigquery-schema", "tool-search"] },
    );

    expect(output.ok).toBe(true);
    expect(runLoop).toHaveBeenCalledOnce();
    expect(rowQueryRun).not.toHaveBeenCalled();
    expect(productionMod.actionsToEngineTools).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ bigquery: expect.anything() }),
    );
  });

  it("collects assistant text + tool calls off the send stream", async () => {
    const runLoop = vi.fn(
      async (opts: { send: (e: AgentChatEvent) => void }) => {
        opts.send({ type: "text", text: "Hello " });
        opts.send({
          type: "tool_start",
          tool: "search",
          id: "search-1",
          input: {},
        });
        opts.send({
          type: "tool_done",
          tool: "search",
          id: "search-1",
          result: '{"ok":true}',
          completedSideEffect: true,
        });
        opts.send({
          type: "tool_start",
          tool: "update",
          id: "update-1",
          input: {},
        });
        opts.send({
          type: "tool_done",
          tool: "update",
          id: "update-1",
          result: '{"ok":false}',
          completedSideEffect: false,
        });
        opts.send({ type: "text", text: "world" });
        return {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "fake-model",
          usageReported: true,
        };
      },
    );

    const engine = { defaultModel: "fake-model" } as unknown as AgentEngine;
    const runner = await createAgentRunner({
      productionContext: {
        ...testProductionContext(),
        appId: "analytics",
        initialToolNames: ["search"],
      },
      engine,
      model: "fake-model",
      runLoop: runLoop as never,
    });

    const out = await runner.runAgent({ prompt: "hi" });
    expect(out.text).toBe("Hello world");
    expect(out.toolCalls).toEqual(["search", "update"]);
    expect(out.toolCallDetails).toEqual([
      {
        name: "search",
        input: {},
        startedAtEventIndex: 1,
        completedAtEventIndex: 2,
        completed: true,
        completedSideEffect: true,
        isError: false,
        result: '{"ok":true}',
      },
      {
        name: "update",
        input: {},
        startedAtEventIndex: 3,
        completedAtEventIndex: 4,
        completed: true,
        completedSideEffect: false,
        isError: false,
        result: '{"ok":false}',
      },
    ]);
    expect(out.ok).toBe(true);
    expect(runLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: "production prompt",
        ownerEmail: "eval@example.com",
        orgId: "org-eval",
        appId: "analytics",
        actionCaller: "tool",
        finalResponseGuard: expect.any(Function),
        finalResponseGuardRequestText: "hi",
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "search" }),
        ]),
        availableTools: expect.arrayContaining([
          expect.objectContaining({ name: "search" }),
        ]),
      }),
    );

    const e = defineEval({
      name: "e2e",
      input: { prompt: "hi" },
      scorers: [contains("world"), usesTool("search")],
    });
    const row = await scoreEval(e, runner);
    expect(row.passed).toBe(true);
    expect(row.usage).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      usageReported: true,
    });
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
      productionContext: testProductionContext(),
      engine,
      model: "fake-model",
      runLoop: runLoop as never,
    });
    const out = await runner.runAgent({ prompt: "hi" });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("model exploded");
  });

  it("disables reasoning for bounded LLM judge calls", async () => {
    const stream = vi.fn(async function* () {
      yield { type: "text-delta", text: '{"score":1,"reasoning":"ok"}' };
    });
    const engine = {
      defaultModel: "fake-model",
      stream,
    } as unknown as AgentEngine;
    const runner = await createAgentRunner({
      productionContext: testProductionContext(),
      engine,
      model: "fake-model",
      runLoop: (async () => ({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "fake-model",
      })) as never,
    });

    const scorerEngine = runner.analyzeContext().engine;
    expect(Reflect.set(scorerEngine, "stream", vi.fn())).toBe(false);
    expect(engine.stream).toBe(stream);

    await runner.analyzeContext().judge({ prompt: "Score this" });

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningEffort: "none" }),
    );
  });

  it("resolves engine + model from the registry when not supplied", async () => {
    engineMod.resolveEngine.mockResolvedValue({
      defaultModel: "registry-model",
    });
    engineMod.getStoredModelForEngine.mockResolvedValue(null);
    const runner = await createAgentRunner({
      productionContext: testProductionContext(),
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

  it("rejects a production eval that has only the direct agent loop", async () => {
    const engine = { defaultModel: "fake-model" } as unknown as AgentEngine;
    await expect(
      createAgentRunner({ productionContext: testProductionContext(), engine }),
    ).rejects.toThrow("invokes the shared production agent loop");
  });

  it("uses the production chat adapter and validates its request setup receipt", async () => {
    const productionChatPath = testProductionChatPath();
    const run = vi.spyOn(productionChatPath, "run");
    const runner = await createAgentRunner({
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
      engine: { defaultModel: "fake-model" } as unknown as AgentEngine,
      model: "fake-model",
    });

    const output = await runner.runAgent({ prompt: "find active users" });

    expect(output).toMatchObject({
      text: "production: find active users",
      ok: true,
      usage: { inputTokens: 4, outputTokens: 2, usageReported: true },
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { prompt: "find active users" },
        actionAllowlist: ["search"],
        identity: { ownerEmail: "eval@example.com", orgId: "org-eval" },
        model: "fake-model",
        signal: expect.any(AbortSignal),
        onUsage: expect.any(Function),
      }),
    );
  });

  it("distinguishes failed agent runs from missing adapter usage", async () => {
    const productionChatPath = testProductionChatPath();
    productionChatPath.run = async ({ identity }) => ({
      output: {
        text: "",
        toolCalls: [],
        ok: false,
        error: "provider failure details",
        runId: "run-without-usage",
        durationMs: 1,
      },
      receipt: {
        productionAgentLoopInvoked: true,
        requestPreparationInvoked: true,
        systemPromptBuilt: true,
        finalResponseGuardInstalled: true,
        finalResponseGuardApplied: false,
        usageCaptured: false,
        prefetchStatus: "ok",
        ownerEmail: identity.ownerEmail,
        orgId: identity.orgId,
        initialToolNames: ["search"],
        availableActionNames: ["search"],
        readOnlyActionNames: ["search"],
      },
    });
    const runner = await createAgentRunner({
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
      engine: { defaultModel: "fake-model" } as unknown as AgentEngine,
      model: "fake-model",
    });

    const output = await runner.runAgent({ prompt: "find active users" });

    expect(output.ok).toBe(false);
    expect(output.error).toBe(
      "Production agent run failed before usage was captured.",
    );
    expect(output.error).not.toContain("provider failure details");
  });

  it("accepts an empty production prefetch result", async () => {
    const runner = await createAgentRunner({
      productionContext: {
        ...testProductionContext(),
        productionChatPath: testProductionChatPath("empty"),
      },
      engine: { defaultModel: "fake-model" } as unknown as AgentEngine,
      model: "fake-model",
    });

    const output = await runner.runAgent({ prompt: "find active users" });

    expect(output.ok).toBe(true);
  });

  it.each(["timed_out", "failed"] as const)(
    "scores the production run when prefetch status is %s",
    async (prefetchStatus) => {
      const runner = await createAgentRunner({
        productionContext: {
          ...testProductionContext(),
          productionChatPath: testProductionChatPath(prefetchStatus),
        },
        engine: { defaultModel: "fake-model" } as unknown as AgentEngine,
        model: "fake-model",
      });

      const output = await runner.runAgent({ prompt: "find active users" });

      expect(output.ok).toBe(true);
    },
  );

  it("fails a production path whose advertised action surface includes writes", async () => {
    const productionChatPath = testProductionChatPath();
    productionChatPath.run = async (args) => {
      const result = await testProductionChatPath().run(args);
      return {
        ...result,
        receipt: {
          ...result.receipt,
          availableActionNames: ["search", "mutate"],
        },
      };
    };
    const runner = await createAgentRunner({
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
      engine: { defaultModel: "fake-model" } as unknown as AgentEngine,
      model: "fake-model",
    });

    const output = await runner.runAgent({ prompt: "find active users" });

    expect(output.ok).toBe(false);
    expect(output.error).toContain("non-read-only action surface");
  });

  it("aborts and fails a production chat adapter that times out", async () => {
    let signal: AbortSignal | undefined;
    const runner = await createAgentRunner({
      productionContext: {
        ...testProductionContext(),
        productionChatPath: {
          async run(args) {
            signal = args.signal;
            args.onUsage({
              inputTokens: 3,
              outputTokens: 1,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              model: "fake-model",
            });
            return new Promise<never>(() => {});
          },
        },
      },
      engine: { defaultModel: "fake-model" } as unknown as AgentEngine,
      model: "fake-model",
      timeoutMs: 5,
    });

    const output = await runner.runAgent({ prompt: "find active users" });

    expect(signal?.aborted).toBe(true);
    expect(output.ok).toBe(false);
    expect(output.error).toBe("Agent run timed out after 5 ms.");
    expect(output.usage).toMatchObject({
      inputTokens: 3,
      outputTokens: 1,
      usageReported: true,
    });
  });

  it("fails closed on timeout and keeps usage reported before abort", async () => {
    const runLoop = vi.fn(
      (opts: {
        onUsage: (usage: {
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheWriteTokens: number;
          model: string;
        }) => void;
      }) => {
        opts.onUsage({
          inputTokens: 20,
          outputTokens: 5,
          cacheReadTokens: 3,
          cacheWriteTokens: 1,
          model: "fake-model",
        });
        return new Promise<never>(() => {});
      },
    );
    const engine = { defaultModel: "fake-model" } as unknown as AgentEngine;
    const runner = await createAgentRunner({
      productionContext: testProductionContext(),
      engine,
      model: "fake-model",
      timeoutMs: 5,
      runLoop: runLoop as never,
    });

    const out = await runner.runAgent({ prompt: "hi" });

    expect(out.ok).toBe(false);
    expect(out.error).toBe("Agent run timed out after 5 ms.");
    expect(out.text).toBe("");
    expect(out.usage).toMatchObject({
      inputTokens: 20,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
      usageReported: true,
    });
  });

  it("requires a non-empty production prompt before creating a runner", async () => {
    const engine = { defaultModel: "fake-model" } as unknown as AgentEngine;
    await expect(
      createAgentRunner({
        productionContext: {
          ...testProductionContext(),
          systemPrompt: " ",
        },
        engine,
        model: "fake-model",
      }),
    ).rejects.toThrow("non-empty production system prompt");
  });
});

describe("persistence to the observability store", () => {
  it("persists one row per (eval x scorer) by default", async () => {
    const e = defineEval({
      name: "persisted",
      input: { prompt: "x" },
      scorers: [contains("a"), exactMatch("a")],
    });
    await runEvals([e], fakeRunner({ text: "a" }));
    expect(storeMod.insertEvalResult).toHaveBeenCalledTimes(2);
    const firstRow = storeMod.insertEvalResult.mock.calls[0][0];
    expect(firstRow.evalType).toBe("automated");
    expect(firstRow.criteria).toContain("eval:persisted:");
    expect(firstRow.metadata).toMatchObject({ source: "cli-eval" });
  });

  it("does not write when persist is explicitly off", async () => {
    const e = defineEval({
      name: "unpersisted",
      input: { prompt: "x" },
      scorers: [contains("a")],
    });
    await runEvals([e], fakeRunner({ text: "a" }), { persist: false });
    expect(storeMod.insertEvalResult).not.toHaveBeenCalled();
  });

  it("does not persist skipped rows", async () => {
    const e = defineEval({
      name: "skipped-persist",
      input: { prompt: "x" },
      skipReason: "No eval secrets configured",
      scorers: [],
    });
    await runEvals([e], fakeRunner({ text: "unused" }), { persist: true });
    expect(storeMod.insertEvalResult).not.toHaveBeenCalled();
  });
});

describe("runEvalSuite runner creation", () => {
  it("rejects custom callbacks in a production-required suite before invoking them", async () => {
    const productionChatPath = testProductionChatPath();
    const adapterRun = vi.spyOn(productionChatPath, "run");
    const customRun = vi.fn(async () => ({
      text: "fabricated production answer",
      toolCalls: [],
      ok: true,
      runId: "eval:fake",
      durationMs: 1,
    }));
    const evalCase = defineEval({
      name: "custom-production-bypass",
      input: { prompt: "find active users" },
      run: customRun,
      scorers: [contains("fabricated")],
    });

    await expect(
      runEvalSuite({
        evals: [evalCase],
        productionContext: {
          ...testProductionContext(),
          productionChatPath,
        },
        requireProductionChatPath: true,
        persist: false,
      }),
    ).rejects.toThrow("cannot define custom run callbacks");

    expect(customRun).not.toHaveBeenCalled();
    expect(adapterRun).not.toHaveBeenCalled();
    expect(engineMod.resolveEngine).not.toHaveBeenCalled();
    expect(productionMod.runAgentLoop).not.toHaveBeenCalled();
  });

  it.each([undefined, { receipt: {} }])(
    "reports missing production adapter output as a receipt error (%s)",
    async (result) => {
      const evalCase = defineEval({
        name: "production-adapter-output",
        input: { prompt: "find active users" },
        scorers: [contains("active users")],
      });
      const productionContext = {
        ...testProductionContext(),
        productionChatPath: {
          async run() {
            return result as never;
          },
        },
      };

      const suite = await runEvalSuite({
        evals: [evalCase],
        productionContext,
        requireProductionChatPath: true,
        persist: false,
      });

      expect(suite.report.results[0]).toMatchObject({
        status: "failed",
        error: "Production chat eval adapter returned no run output.",
      });
    },
  );

  it("does not expose thrown production adapter errors in eval reports", async () => {
    const evalCase = defineEval({
      name: "aborted-production-adapter",
      input: { prompt: "find active users" },
      scorers: [contains("active users")],
    });
    const productionChatPath = testProductionChatPath();
    const adapterError = Object.assign(
      new Error("token=sk-test-example; customer=example.customer@example.com"),
      { name: "ABCD1234", code: "sk-test-example", status: 401 },
    );
    productionChatPath.run = async () => {
      throw adapterError;
    };
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const suite = await runEvalSuite({
      evals: [evalCase],
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
      requireProductionChatPath: true,
      persist: false,
    });

    expect(suite.report).toMatchObject({
      total: 1,
      passed: 0,
      failed: 1,
      results: [
        {
          status: "failed",
          passed: false,
          error: "Production chat eval failed.",
        },
      ],
    });
    expect(JSON.stringify(suite.report)).not.toContain("sk-test-example");
    expect(JSON.stringify(suite.report)).not.toContain(
      "example.customer@example.com",
    );
    expect(errorLog).toHaveBeenCalledWith(
      "[eval] Production chat eval adapter failed",
      {
        errorType: "Error",
        statusCode: 401,
      },
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "sk-test-example",
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "example.customer@example.com",
    );
    errorLog.mockRestore();
  });

  it("keeps observed partial usage when the adapter returns malformed usage", async () => {
    const evalCase = defineEval({
      name: "malformed-production-adapter-usage",
      input: { prompt: "find active users" },
      scorers: [contains("active users")],
    });
    const productionChatPath = testProductionChatPath();
    productionChatPath.run = async (args) => {
      const result = await testProductionChatPath().run(args);
      return {
        ...result,
        output: {
          ...result.output,
          usage: {
            inputTokens: "malformed",
            outputTokens: 999,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            model: "untrusted-adapter-model",
            unexpected: "untrusted adapter field",
          } as never,
        },
      };
    };

    const suite = await runEvalSuite({
      evals: [evalCase],
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
      requireProductionChatPath: true,
      persist: false,
    });

    expect(suite.report.results[0]).toMatchObject({
      status: "passed",
      usage: {
        inputTokens: 4,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "fake-model",
        llmCalls: 1,
        usageReported: true,
      },
    });
    expect(JSON.stringify(suite.report)).not.toContain(
      "untrusted adapter field",
    );
  });

  it("rejects partial usage after a malformed callback and omits malformed returned usage", async () => {
    const evalCase = defineEval({
      name: "malformed-production-adapter-usage-callback",
      input: { prompt: "find active users" },
      scorers: [contains("active users")],
    });
    const productionChatPath = testProductionChatPath();
    const malformedUsage = {
      inputTokens: "customer@example.com",
      outputTokens: Number.NaN,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: "token=adapter-secret",
    };
    productionChatPath.run = async (args) => {
      const result = await testProductionChatPath().run({
        ...args,
        onUsage: () => {},
      });
      args.onUsage({
        inputTokens: 2,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "fake-model",
      });
      args.onUsage(malformedUsage as never);
      return {
        ...result,
        output: { ...result.output, usage: malformedUsage as never },
      };
    };

    const suite = await runEvalSuite({
      evals: [evalCase],
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
      requireProductionChatPath: true,
      persist: false,
    });

    expect(suite.report.results[0]).toMatchObject({
      status: "failed",
      error: "Production chat eval adapter did not return or report usage.",
    });
    expect(suite.report.results[0].usage).toBeUndefined();
    expect(JSON.stringify(suite.report)).not.toContain("customer@example.com");
    expect(JSON.stringify(suite.report)).not.toContain("adapter-secret");
  });

  it("omits malformed usage from failed outputs when no usage callback ran", async () => {
    const evalCase = defineEval({
      name: "malformed-production-adapter-usage-without-callback",
      input: { prompt: "find active users" },
      scorers: [contains("active users")],
    });
    const productionChatPath = testProductionChatPath();
    productionChatPath.run = async (args) => {
      const result = await testProductionChatPath().run({
        ...args,
        onUsage: () => {},
      });
      return {
        ...result,
        output: {
          ...result.output,
          ok: false,
          error: "token=adapter-secret; customer=example.customer@example.com",
          usage: {
            inputTokens: "malformed",
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            model: "untrusted-adapter-model",
          } as never,
        },
      };
    };

    const suite = await runEvalSuite({
      evals: [evalCase],
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
      requireProductionChatPath: true,
      persist: false,
    });

    expect(suite.report.results[0]).toMatchObject({
      status: "failed",
      error: "Production agent run failed before usage was captured.",
    });
    expect(suite.report.results[0].usage).toBeUndefined();
    expect(JSON.stringify(suite.report)).not.toContain("adapter-secret");
    expect(JSON.stringify(suite.report)).not.toContain(
      "example.customer@example.com",
    );
    expect(JSON.stringify(suite.report)).not.toContain(
      "untrusted-adapter-model",
    );
  });

  it("uses observed counts instead of unreported adapter placeholders", async () => {
    const evalCase = defineEval({
      name: "unreported-production-adapter-usage",
      input: { prompt: "find active users" },
      scorers: [contains("active users")],
    });
    const productionChatPath = testProductionChatPath();
    productionChatPath.run = async (args) => {
      const result = await testProductionChatPath().run(args);
      return {
        ...result,
        output: {
          ...result.output,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            usageReported: false,
            model: "untrusted-placeholder-model",
          },
        },
      };
    };

    const suite = await runEvalSuite({
      evals: [evalCase],
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
      requireProductionChatPath: true,
      persist: false,
    });

    expect(suite.report.results[0]).toMatchObject({
      status: "passed",
      usage: {
        inputTokens: 4,
        outputTokens: 2,
        usageReported: true,
        model: "fake-model",
      },
    });
  });

  it("does not report unflagged adapter usage without an observed usage event", async () => {
    const evalCase = defineEval({
      name: "unflagged-production-adapter-usage",
      input: { prompt: "find active users" },
      scorers: [contains("active users")],
    });
    const productionChatPath = testProductionChatPath();
    productionChatPath.run = async (args) => {
      const result = await testProductionChatPath().run({
        ...args,
        onUsage: () => {},
      });
      return {
        ...result,
        output: {
          ...result.output,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            model: "fake-model",
          },
        },
      };
    };

    const suite = await runEvalSuite({
      evals: [evalCase],
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
      requireProductionChatPath: true,
      persist: false,
    });

    expect(suite.report.results[0]).toMatchObject({
      status: "failed",
      error: "Production chat eval adapter did not return or report usage.",
    });
    expect(suite.report.results[0].usage).toBeUndefined();
  });

  it.each(["text", "toolCalls", "runId", "durationMs"] as const)(
    "fails closed when successful adapter output is missing %s",
    async (missingField) => {
      const analyze = vi.fn((run: { text: string }) => run.text);
      const evalCase = defineEval({
        name: `malformed-production-output-without-${missingField}`,
        input: { prompt: "find active users" },
        scorers: [{ name: "sentinel", analyze, generateScore: () => 1 }],
      });
      const productionChatPath = testProductionChatPath();
      productionChatPath.run = async (args) => {
        const result = await testProductionChatPath().run(args);
        const output = { ...result.output } as Record<string, unknown>;
        delete output[missingField];
        return { ...result, output: output as never };
      };

      const suite = await runEvalSuite({
        evals: [evalCase],
        productionContext: {
          ...testProductionContext(),
          productionChatPath,
        },
        requireProductionChatPath: true,
        persist: false,
      });

      expect(suite.report.results[0]).toMatchObject({
        status: "failed",
        error: "Production chat eval adapter returned malformed run output.",
        scores: [],
      });
      expect(analyze).not.toHaveBeenCalled();
    },
  );

  it("does not score a production adapter response without run output", async () => {
    const analyze = vi.fn((run: { text: string }) => run.text);
    const evalCase = defineEval({
      name: "missing-production-run-output",
      input: { prompt: "find active users" },
      scorers: [{ name: "sentinel", analyze, generateScore: () => 1 }],
    });
    const productionChatPath = testProductionChatPath();
    productionChatPath.run = async (args) => {
      const result = await testProductionChatPath().run(args);
      return { ...result, output: undefined as never };
    };

    const suite = await runEvalSuite({
      evals: [evalCase],
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
      requireProductionChatPath: true,
      persist: false,
    });

    expect(suite.report.results[0]).toMatchObject({
      status: "failed",
      error: "Production chat eval adapter returned no run output.",
      scores: [],
    });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("does not let a production adapter disable scoring", async () => {
    const analyze = vi.fn((run: { text: string }) => run.text);
    const evalCase = defineEval({
      name: "adapter-scoreable-flag-is-ignored",
      input: { prompt: "find active users" },
      scorers: [{ name: "sentinel", analyze, generateScore: () => 1 }],
    });
    const productionChatPath = testProductionChatPath();
    productionChatPath.run = async (args) => {
      const result = await testProductionChatPath().run(args);
      return {
        ...result,
        output: { ...result.output, scoreable: false } as never,
      };
    };

    const suite = await runEvalSuite({
      evals: [evalCase],
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
      requireProductionChatPath: true,
      persist: false,
    });

    expect(analyze).toHaveBeenCalledOnce();
    expect(suite.report.results[0]).toMatchObject({
      status: "passed",
      scores: [{ scorer: "sentinel", score: 1, passed: true }],
    });
  });

  it("fails closed when an adapter returns a truthy non-boolean ok value", async () => {
    const evalCase = defineEval({
      name: "malformed-production-adapter-ok",
      input: { prompt: "find active users" },
      scorers: [contains("active users")],
    });
    const productionChatPath = testProductionChatPath();
    productionChatPath.run = async (args) => {
      const result = await testProductionChatPath().run(args);
      return {
        ...result,
        output: {
          ...result.output,
          ok: "false" as never,
          error: "token=adapter-secret",
        },
      };
    };

    const suite = await runEvalSuite({
      evals: [evalCase],
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
      requireProductionChatPath: true,
      persist: false,
    });

    expect(suite.report.results[0]).toMatchObject({
      status: "failed",
      error: "Production chat eval adapter returned malformed run output.",
    });
    expect(JSON.stringify(suite.report)).not.toContain("adapter-secret");
  });

  it("uses resolved model identifiers instead of adapter metadata", async () => {
    const evalCase = defineEval({
      name: "untrusted-production-adapter-identifiers",
      input: { prompt: "find active users" },
      scorers: [contains("active users")],
    });
    engineMod.resolveEngine.mockResolvedValue({
      name: "resolved-engine",
      defaultModel: "fake-model",
    } as never);
    const productionChatPath = testProductionChatPath();
    const adapterModel = "example.customer@example.com".repeat(20);
    const adapterEngine = `token=${"x".repeat(300)}`;
    productionChatPath.run = async (args) => {
      const result = await testProductionChatPath().run(args);
      return {
        ...result,
        output: {
          ...result.output,
          usage: {
            ...result.output.usage,
            model: adapterModel,
            engineName: adapterEngine,
          },
        },
      };
    };

    const suite = await runEvalSuite({
      evals: [evalCase],
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
      requireProductionChatPath: true,
      persist: false,
    });

    expect(suite.report.results[0]).toMatchObject({
      status: "passed",
      usage: {
        model: "fake-model",
        engineName: "resolved-engine",
      },
    });
    expect(JSON.stringify(suite.report)).not.toContain(adapterModel);
    expect(JSON.stringify(suite.report)).not.toContain(adapterEngine);
  });

  it("does not score or expose returned production adapter failure output", async () => {
    const sentinel = "adapter-failure-sentinel";
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const analyze = vi.fn((run: { text: string }) => run.text);
    const evalCase = defineEval({
      name: "returned-production-adapter-error",
      input: { prompt: "find active users" },
      scorers: [{ name: "sentinel", analyze, generateScore: () => 1 }],
    });
    const productionChatPath = testProductionChatPath();
    productionChatPath.run = async (args) => {
      const result = await testProductionChatPath().run(args);
      return {
        ...result,
        output: {
          ...result.output,
          text: sentinel,
          toolCalls: [sentinel],
          untrustedFailureDetails: sentinel,
          ok: false,
          error: "token=sk-test-example; customer=example.customer@example.com",
        } as never,
      };
    };

    const suite = await runEvalSuite({
      evals: [evalCase],
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
      requireProductionChatPath: true,
    });

    expect(suite.report).toMatchObject({
      total: 1,
      passed: 0,
      failed: 1,
      results: [
        {
          status: "failed",
          error: "Production chat eval failed.",
          usage: { inputTokens: 4, outputTokens: 2, usageReported: true },
          scores: [],
        },
      ],
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(JSON.stringify(suite.report)).not.toContain(sentinel);
    expect(JSON.stringify(suite.report)).not.toContain("sk-test-example");
    expect(JSON.stringify(suite.report)).not.toContain(
      "example.customer@example.com",
    );
    expect(errorLog).toHaveBeenCalledWith(
      "[eval] Production chat eval adapter returned a failed run",
      { failureType: "returned_run_failure" },
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(sentinel);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "sk-test-example",
    );
    expect(storeMod.insertEvalResult).toHaveBeenCalledTimes(1);
    const persistedResult = storeMod.insertEvalResult.mock.calls[0][0];
    expect(persistedResult).toMatchObject({
      criteria: "eval:returned-production-adapter-error:run",
      score: 0,
      reasoning: "Eval run failed before scoring.",
      metadata: { source: "cli-eval", passed: false, status: "failed" },
    });
    expect(JSON.stringify(persistedResult)).not.toContain(sentinel);
    expect(JSON.stringify(persistedResult)).not.toContain("sk-test-example");
    errorLog.mockRestore();
  });

  it("captures copied production failures before skipping scorers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const analyze = vi.fn((run: { text: string }) => run.text);
    const evalCase = defineEval({
      name: "copied-production-adapter-error",
      input: { prompt: "find active users" },
      scorers: [{ name: "sentinel", analyze, generateScore: () => 1 }],
    });
    const productionChatPath = testProductionChatPath();
    const onRunOutput = vi.fn();
    productionChatPath.run = async (args) => {
      const result = await testProductionChatPath().run(args);
      return {
        ...result,
        output: {
          ...result.output,
          ok: false,
          error: "Production chat eval failed.",
        } as never,
      };
    };
    const runner = await createAgentRunner({
      productionContext: {
        ...testProductionContext(),
        productionChatPath,
      },
    });
    const report = await runEvals([evalCase], runner, {
      persist: false,
      onRunOutput,
    });
    const row = report.results[0]!;

    expect(row).toMatchObject({
      status: "failed",
      passed: false,
      error: "Production chat eval failed.",
      scores: [],
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(onRunOutput).toHaveBeenCalledTimes(1);
    expect(onRunOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: "Production chat eval failed.",
      }),
    );
  });

  it("persists eval results by default", async () => {
    const e = defineEval({
      name: "local-only",
      input: { prompt: "x" },
      scorers: [contains("ok")],
    });

    await runEvalSuite({
      evals: [e],
      runner: fakeRunner({ text: "ok" }),
    });

    expect(storeMod.insertEvalResult).toHaveBeenCalledTimes(1);
  });

  it("supports legacy actions and systemPrompt options", async () => {
    const actions = { search: { readOnly: true } as never };
    const e = defineEval({
      name: "legacy-options",
      input: { prompt: "x" },
      run: (ctx) => ctx.runAgent(ctx.input),
      scorers: [
        createScorer({
          name: "always_pass",
          generateScore() {
            return 1;
          },
        }),
      ],
    });

    await runEvalSuite({
      evals: [e],
      actions,
      systemPrompt: "legacy suite prompt",
      persist: false,
    });

    expect(productionMod.runAgentLoop).toHaveBeenCalledWith(
      expect.objectContaining({ actions, systemPrompt: "legacy suite prompt" }),
    );
  });

  it("rejects custom run callbacks with a production context when strict mode is omitted", async () => {
    const productionChatPath = testProductionChatPath();
    const adapterRun = vi.spyOn(productionChatPath, "run");
    const e = defineEval({
      name: "custom-run-calls-agent",
      input: { prompt: "x" },
      run: (ctx) => ctx.runAgent(ctx.input),
      scorers: [
        createScorer({
          name: "always_pass",
          generateScore() {
            return 1;
          },
        }),
      ],
    });

    await expect(
      runEvalSuite({
        evals: [e],
        productionContext: {
          ...testProductionContext(),
          productionChatPath,
        },
        persist: false,
      }),
    ).rejects.toThrow("cannot define custom run callbacks");

    expect(adapterRun).not.toHaveBeenCalled();
    expect(engineMod.resolveEngine).not.toHaveBeenCalled();
    expect(productionMod.runAgentLoop).not.toHaveBeenCalled();
  });

  it("refuses direct-loop contexts even when supplied by the caller", async () => {
    const e = defineEval({
      name: "must-use-production-chat",
      input: { prompt: "x" },
      scorers: [contains("x")],
    });

    await expect(
      runEvalSuite({
        evals: [e],
        productionContext: testProductionContext(),
        persist: false,
      }),
    ).rejects.toThrow("does not invoke the shared production agent loop");
    expect(engineMod.resolveEngine).not.toHaveBeenCalled();
  });

  it("requires a production chat adapter when requested, even with a runner", async () => {
    const e = defineEval({
      name: "must-use-production-chat",
      input: { prompt: "x" },
      scorers: [contains("x")],
    });

    await expect(
      runEvalSuite({
        evals: [e],
        runner: fakeRunner({ text: "x" }),
        productionContext: testProductionContext(),
        requireProductionChatPath: true,
        persist: false,
      }),
    ).rejects.toThrow("does not invoke the shared production agent loop");
  });

  it.each([true, false])(
    "rejects an injected runner with a production context (strict mode: %s)",
    async (requireProductionChatPath) => {
      const e = defineEval({
        name: "must-use-production-chat",
        input: { prompt: "x" },
        scorers: [contains("x")],
      });

      await expect(
        runEvalSuite({
          evals: [e],
          runner: fakeRunner({ text: "x" }),
          productionContext: {
            ...testProductionContext(),
            productionChatPath: testProductionChatPath(),
          },
          requireProductionChatPath,
          persist: false,
        }),
      ).rejects.toThrow("injected runner");
    },
  );

  it("checks for a production adapter before accepting an empty suite", async () => {
    await expect(
      runEvalSuite({
        cwd: "/tmp/no-production-eval-adapter",
        evals: [],
        identity: { ownerEmail: "eval@example.com", orgId: "org-eval" },
        requireProductionChatPath: true,
        persist: false,
      }),
    ).rejects.toThrow("Production eval adapter is missing");
  });

  it("registers the app TypeScript loader before importing production eval files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-native-eval-adapter-"));
    const evalDir = join(cwd, "evals");
    const tsxApiDir = join(cwd, "node_modules", "tsx", "esm");
    const loaderRegistered = join(cwd, "loader-registered");
    try {
      await mkdir(evalDir, { recursive: true });
      await mkdir(tsxApiDir, { recursive: true });
      const realTsxApiPath = createRequire(import.meta.url).resolve(
        "tsx/esm/api",
      );
      await writeFile(
        join(cwd, "node_modules", "tsx", "package.json"),
        JSON.stringify({
          name: "tsx",
          type: "module",
          exports: { "./esm/api": "./esm/api.mjs" },
        }),
      );
      await writeFile(
        join(tsxApiDir, "api.mjs"),
        [
          'import { createRequire } from "node:module";',
          'import { writeFileSync } from "node:fs";',
          `const realApi = createRequire(import.meta.url)(${JSON.stringify(realTsxApiPath)});`,
          "export function register() {",
          `  writeFileSync(${JSON.stringify(loaderRegistered)}, "registered");`,
          "  realApi.register();",
          "}",
        ].join("\n"),
      );
      await writeFile(
        join(evalDir, "context-value.ts"),
        'export const contextValue = "loaded-through-tsx";\n',
      );
      await writeFile(
        join(evalDir, "production-context.ts"),
        [
          'import { contextValue } from "./context-value.js";',
          "export function resolveProductionEvalContext(identity) {",
          "  return {",
          "    actions: { search: { readOnly: true } },",
          "    systemPrompt: contextValue,",
          "    finalResponseGuard: () => null,",
          "    ownerEmail: identity.ownerEmail,",
          "    orgId: identity.orgId,",
          "    productionChatPath: {",
          "      async run({ identity, onUsage }) {",
          '        onUsage({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, model: "fake-model" });',
          "        return {",
          '          output: { text: contextValue, toolCalls: [], ok: true, runId: "eval:loader-order", durationMs: 1 },',
          "          receipt: {",
          "            productionAgentLoopInvoked: true,",
          "            requestPreparationInvoked: true,",
          "            systemPromptBuilt: true,",
          "            finalResponseGuardInstalled: true,",
          "            finalResponseGuardApplied: true,",
          "            usageCaptured: true,",
          '            prefetchStatus: "ok",',
          "            ownerEmail: identity.ownerEmail,",
          "            orgId: identity.orgId,",
          '            initialToolNames: ["search"],',
          '            availableActionNames: ["search"],',
          '            readOnlyActionNames: ["search"],',
          "          },",
          "        };",
          "      },",
          "    },",
          "  };",
          "}",
        ].join("\n"),
      );
      await writeFile(
        join(evalDir, "loader-order.eval.ts"),
        [
          'import { readFileSync } from "node:fs";',
          'import { contextValue } from "./context-value.js";',
          `if (readFileSync(${JSON.stringify(loaderRegistered)}, "utf8") !== "registered") {`,
          '  throw new Error("The app TypeScript loader was not registered before eval import.");',
          "}",
          "export const loaderOrderEval = {",
          '  name: "loader-order",',
          '  input: { prompt: "load app context" },',
          '  scorers: [{ name: "context-loaded", generateScore(output) { return output.text === contextValue ? 1 : 0; } }],',
          "};",
        ].join("\n"),
      );

      const result = await runEvalSuite({
        cwd,
        identity: { ownerEmail: "eval@example.com", orgId: "org-eval" },
        requireProductionChatPath: true,
        persist: false,
      });

      expect(result.report).toMatchObject({ total: 1, passed: 1, failed: 0 });
      expect(result.files).toContain(join(evalDir, "loader-order.eval.ts"));
      await expect(readFile(loaderRegistered, "utf8")).resolves.toBe(
        "registered",
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects empty and skipped production suites after adapter validation", async () => {
    const productionContext = {
      ...testProductionContext(),
      productionChatPath: testProductionChatPath(),
    };
    await expect(
      runEvalSuite({
        evals: [],
        productionContext,
        requireProductionChatPath: true,
        persist: false,
      }),
    ).rejects.toThrow("at least one eval case");

    const skipped = defineEval({
      name: "skipped-production-case",
      input: { prompt: "x" },
      skipReason: "disabled",
      scorers: [],
    });
    await expect(
      runEvalSuite({
        evals: [skipped],
        productionContext,
        requireProductionChatPath: true,
        persist: false,
      }),
    ).rejects.toThrow("cannot contain skipped cases");
  });

  it("requires the app production adapter instead of guessing a prompt or identity", async () => {
    await expect(
      loadProductionEvalContext("/tmp/no-production-eval-adapter", {
        ownerEmail: "eval@example.com",
        orgId: "org-eval",
      }),
    ).rejects.toThrow("Production eval adapter is missing");
  });

  it("does not infer eval identity from environment variables", async () => {
    vi.stubEnv("AGENT_USER_EMAIL", "ambient@example.com");
    vi.stubEnv("AGENT_ORG_ID", "ambient-org");

    await expect(
      loadProductionEvalContext("/tmp/no-production-eval-adapter"),
    ).rejects.toThrow("explicit ownerEmail and orgId");
  });

  it("does not resolve an engine or discover actions when all evals are skipped", async () => {
    const e = defineEval({
      name: "skipped",
      input: { prompt: "x" },
      skipReason: "Manual gate is disabled",
      scorers: [],
    });

    const result = await runEvalSuite({ evals: [e], persist: false });

    expect(result.report).toMatchObject({
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 1,
    });
    expect(result.report.results[0]).toMatchObject({
      status: "skipped",
      skipReason: "Manual gate is disabled",
    });
    expect(engineMod.resolveEngine).not.toHaveBeenCalled();
  });
});

describe("formatReport", () => {
  it("distinguishes skipped rows from passed rows", async () => {
    const skipped = defineEval({
      name: "skipped",
      input: { prompt: "x" },
      skipReason: "Missing eval gate",
      scorers: [],
    });
    const passed = defineEval({
      name: "passed",
      input: { prompt: "x" },
      scorers: [contains("ok")],
    });
    const report = await runEvals(
      [skipped, passed],
      fakeRunner({ text: "ok" }),
      { persist: false },
    );

    const formatted = formatReport(report);

    expect(formatted).toContain("- skipped  (skipped)");
    expect(formatted).toContain("reason: Missing eval gate");
    expect(formatted).toContain("PASS: 1/1 evals passed, 1 skipped");
  });

  it("does not label fully skipped reports as passing", async () => {
    const skipped = defineEval({
      name: "skipped",
      input: { prompt: "x" },
      skipReason: "Missing eval gate",
      scorers: [],
    });
    const report = await runEvals([skipped], fakeRunner({ text: "ok" }), {
      persist: false,
    });

    const formatted = formatReport(report);

    expect(formatted).toContain("SKIPPED: 0/0 evals passed, 1 skipped");
  });
});
