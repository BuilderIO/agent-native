import { runEvals, scoreEval } from "@agent-native/core/eval";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parityEvalScenarios } from "../eval-scenarios";
import { parityMatrix } from "../matrix";
import { scenarioToEval } from "../scenario-to-eval";

const OLD_GATE = process.env.CONTENT_PARITY_EVALS;

afterEach(() => {
  if (OLD_GATE === undefined) {
    delete process.env.CONTENT_PARITY_EVALS;
  } else {
    process.env.CONTENT_PARITY_EVALS = OLD_GATE;
  }
});

describe("Content parity eval scenarios", () => {
  it("map to real matrix capabilities and require no private credentials", () => {
    const rowIds = new Set(parityMatrix.map((row) => row.id));
    const invalid = parityEvalScenarios.flatMap((scenario) => {
      const problems: string[] = [];
      if (scenario.requiresPrivateCredentials !== false) {
        problems.push(`${scenario.id}: requires private credentials`);
      }
      if (scenario.gateEnv !== "CONTENT_PARITY_EVALS") {
        problems.push(`${scenario.id}: unexpected gate ${scenario.gateEnv}`);
      }
      for (const capabilityId of scenario.capabilityIds) {
        if (!rowIds.has(capabilityId)) {
          problems.push(`${scenario.id}: unknown capability ${capabilityId}`);
        }
      }
      return problems;
    });

    expect(invalid).toEqual([]);
  });

  it("keeps PR 2.5 capped to the five bundled gated scenarios", () => {
    expect(parityEvalScenarios.map((scenario) => scenario.id).sort()).toEqual([
      "builder-source-review-readonly",
      "database-bulk-row-reliability",
      "database-source-scope",
      "document-search-edit",
      "local-file-source-truth",
    ]);
  });

  it("skips without calling the agent when the gate is unset", async () => {
    delete process.env.CONTENT_PARITY_EVALS;
    const evalCase = scenarioToEval(parityEvalScenarios[0]);
    const runAgent = vi.fn();

    const row = await scoreEval(evalCase, {
      runAgent,
      engine: {} as never,
      model: "test-model",
      analyzeContext: vi.fn(),
    });

    expect(runAgent).not.toHaveBeenCalled();
    expect(row.passed).toBe(true);
    expect(row.status).toBe("skipped");
    expect(row.skipReason).toBe(
      "Skipped because CONTENT_PARITY_EVALS is unset",
    );
    expect(row.scores).toEqual([]);
  });

  it("reports unset gated scenarios as skipped in the aggregate report", async () => {
    delete process.env.CONTENT_PARITY_EVALS;

    const report = await runEvals(
      parityEvalScenarios.map((scenario) => scenarioToEval(scenario)),
      {
        runAgent: vi.fn(),
        engine: {} as never,
        model: "test-model",
        analyzeContext: vi.fn(),
      },
      { persist: false },
    );

    expect(report.failed).toBe(0);
    expect(report.skipped).toBe(5);
    expect(report.results.every((row) => row.status === "skipped")).toBe(true);
  });

  it("runs scorer-backed evals when the gate is set", async () => {
    process.env.CONTENT_PARITY_EVALS = "1";

    const scenario = parityEvalScenarios[0];
    const evalCase = scenarioToEval(scenario);
    const row = await scoreEval(evalCase, {
      runAgent: vi.fn(async () => ({
        text: scenario.successSignals.join("\n"),
        toolCalls: scenario.expectedTools ?? [],
        ok: true,
        runId: "content-parity:gate-on-test",
        durationMs: 1,
      })),
      engine: {} as never,
      model: "test-model",
      analyzeContext: vi.fn(),
    });

    expect(evalCase.skipReason).toBeUndefined();
    expect(evalCase.scorers.map((scorer) => scorer.name)).toContain("contains");
    expect(row.status).toBe("passed");
    expect(row.scores.every((score) => score.passed)).toBe(true);
  });

  it("requires every expected tool for multi-action parity scenarios", async () => {
    process.env.CONTENT_PARITY_EVALS = "1";

    const scenario = parityEvalScenarios.find(
      (candidate) => candidate.id === "database-bulk-row-reliability",
    )!;
    const evalCase = scenarioToEval(scenario);
    const row = await scoreEval(evalCase, {
      runAgent: vi.fn(async () => ({
        text: scenario.successSignals.join("\n"),
        toolCalls: ["duplicate-database-items"],
        ok: true,
        runId: "content-parity:missing-tool-test",
        durationMs: 1,
      })),
      engine: {} as never,
      model: "test-model",
      analyzeContext: vi.fn(),
    });

    const expectedToolsScore = row.scores.find(
      (score) => score.scorer === "expected_tools",
    );
    expect(expectedToolsScore).toMatchObject({
      passed: false,
      score: 0,
    });
    expect(expectedToolsScore?.reason).toContain("delete-database-items");
    expect(row.status).toBe("failed");
  });
});
