import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { AgentEngine } from "../agent/engine/types.js";
import type { AgentChatEvent } from "../agent/types.js";
import type { AgentRunner } from "./agent-runner.js";
import type { AgentRunOutput } from "./types.js";

const productionMod = vi.hoisted(() => ({
  actionsToEngineTools: vi.fn(() => [
    {
      name: "search",
      description: "Search data",
      inputSchema: { type: "object", properties: {} },
    },
  ]),
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

function testProductionChatPath() {
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
          chatHandlerInvoked: true as const,
          requestPreparationInvoked: true as const,
          systemPromptBuilt: true as const,
          finalResponseGuardInstalled: true as const,
          finalResponseGuardApplied: true as const,
          usageCaptured: true as const,
          prefetchStatus: "ok" as const,
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
    ).rejects.toThrow("invokes the production chat handler");
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
        identity: { ownerEmail: "eval@example.com", orgId: "org-eval" },
        model: "fake-model",
        signal: expect.any(AbortSignal),
        onUsage: expect.any(Function),
      }),
    );
  });

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
  it("writes one row per (eval x scorer) when persist is on", async () => {
    const e = defineEval({
      name: "persisted",
      input: { prompt: "x" },
      scorers: [contains("a"), exactMatch("a")],
    });
    await runEvals([e], fakeRunner({ text: "a" }), { persist: true });
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
  it("does not persist eval results by default", async () => {
    const e = defineEval({
      name: "local-only",
      input: { prompt: "x" },
      scorers: [contains("ok")],
    });

    await runEvalSuite({
      evals: [e],
      runner: fakeRunner({ text: "ok" }),
    });

    expect(storeMod.insertEvalResult).not.toHaveBeenCalled();
  });

  it("creates a runner for custom evals because run(ctx) may call runAgent", async () => {
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

    const result = await runEvalSuite({
      evals: [e],
      productionContext: {
        ...testProductionContext(),
        productionChatPath: testProductionChatPath(),
      },
      persist: false,
    });

    expect(result.report.failed).toBe(0);
    expect(engineMod.resolveEngine).toHaveBeenCalled();
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
    ).rejects.toThrow("does not invoke the production chat handler");
    expect(engineMod.resolveEngine).not.toHaveBeenCalled();
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
