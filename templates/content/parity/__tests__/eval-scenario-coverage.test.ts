import { runEvals, scoreEval } from "@agent-native/core/eval";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parityEvalScenarios } from "../eval-scenarios";
import { parityMatrix } from "../matrix";
import { scenarioToEval } from "../scenario-to-eval";

const OLD_GATE = process.env.CONTENT_PARITY_EVALS;

function successfulCreateCall(
  scenario: (typeof parityEvalScenarios)[number],
  propertyInput: Record<string, unknown>,
) {
  return {
    name: "add-database-item",
    input: {
      ...scenario.expectedCreateEnvelope,
      ...propertyInput,
    },
    completed: true,
    completedSideEffect: true,
    isError: false,
    result: '{"fixtureOnly":true}',
  };
}

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

  it("keeps the bundled gated scenarios explicit", () => {
    expect(parityEvalScenarios.map((scenario) => scenario.id).sort()).toEqual([
      "builder-source-review-readonly",
      "database-bulk-row-reliability",
      "database-create-property-preservation",
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
    expect(report.skipped).toBe(6);
    expect(report.results.every((row) => row.status === "skipped")).toBe(true);
  });

  it("runs scorer-backed evals when the gate is set", async () => {
    process.env.CONTENT_PARITY_EVALS = "1";

    const scenario = parityEvalScenarios.find(
      (candidate) => candidate.id === "database-source-scope",
    )!;
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
    expect(expectedToolsScore?.reason).toContain("remove-database-items");
    expect(row.status).toBe("failed");
  });

  it("fails when database creation drops explicitly requested properties", async () => {
    process.env.CONTENT_PARITY_EVALS = "1";
    const scenario = parityEvalScenarios.find(
      (candidate) => candidate.id === "database-create-property-preservation",
    )!;
    const evalCase = scenarioToEval(scenario);
    const row = await scoreEval(evalCase, {
      runAgent: vi.fn(async () => ({
        text: scenario.successSignals.join("\n"),
        toolCalls: ["add-database-item"],
        toolCallDetails: [
          successfulCreateCall(scenario, { propertyValues: {} }),
        ],
        ok: true,
        runId: "content-parity:empty-property-values",
        durationMs: 1,
      })),
      engine: {} as never,
      model: "test-model",
      analyzeContext: vi.fn(),
    });

    expect(
      row.scores.find((score) => score.scorer === "expected_property_values"),
    ).toMatchObject({ passed: false, score: 0 });
    expect(row.status).toBe("failed");
  });

  it("accepts exact database creation properties without extras", async () => {
    process.env.CONTENT_PARITY_EVALS = "1";
    const scenario = parityEvalScenarios.find(
      (candidate) => candidate.id === "database-create-property-preservation",
    )!;
    const evalCase = scenarioToEval(scenario);
    const row = await scoreEval(evalCase, {
      runAgent: vi.fn(async () => ({
        text: scenario.successSignals.join("\n"),
        toolCalls: ["add-database-item"],
        toolCallDetails: [
          successfulCreateCall(scenario, {
            propertyValues: scenario.expectedPropertyValues,
          }),
        ],
        ok: true,
        runId: "content-parity:exact-property-values",
        durationMs: 1,
      })),
      engine: {} as never,
      model: "test-model",
      analyzeContext: vi.fn(),
    });

    expect(
      row.scores.find((score) => score.scorer === "expected_property_values"),
    ).toMatchObject({ passed: true, score: 1 });
    expect(row.status).toBe("passed");
  });

  it.each([
    (scenario: (typeof parityEvalScenarios)[number]) => ({
      name: "duplicate property entries",
      toolCallDetails: [
        successfulCreateCall(scenario, {
          propertyEntries: [
            { propertyId: "parity-text-property-id", value: "preserve me" },
            { propertyId: "parity-text-property-id", value: "preserve me" },
            { propertyId: "parity-status-property-id", value: "ready" },
          ],
        }),
      ],
    }),
    (scenario: (typeof parityEvalScenarios)[number]) => ({
      name: "ambiguous property formats",
      toolCallDetails: [
        successfulCreateCall(scenario, {
          propertyEntries: [
            { propertyId: "parity-text-property-id", value: "preserve me" },
            { propertyId: "parity-status-property-id", value: "ready" },
          ],
          propertyValues: {
            "parity-text-property-id": "preserve me",
            "parity-status-property-id": "ready",
          },
        }),
      ],
    }),
    (scenario: (typeof parityEvalScenarios)[number]) => ({
      name: "an extra row mutation",
      toolCallDetails: [
        successfulCreateCall(scenario, {
          propertyEntries: [
            { propertyId: "parity-text-property-id", value: "preserve me" },
            { propertyId: "parity-status-property-id", value: "ready" },
          ],
        }),
        {
          name: "update-database-item",
          input: {},
          completed: true,
          isError: false,
          result: "{}",
        },
      ],
    }),
  ])("rejects invalid property behavior", async (buildCase) => {
    process.env.CONTENT_PARITY_EVALS = "1";
    const scenario = parityEvalScenarios.find(
      (candidate) => candidate.id === "database-create-property-preservation",
    )!;
    const { toolCallDetails } = buildCase(scenario);
    const evalCase = scenarioToEval(scenario);
    const row = await scoreEval(evalCase, {
      runAgent: vi.fn(async () => ({
        text: scenario.successSignals.join("\n"),
        toolCalls: toolCallDetails.map((call) => call.name),
        toolCallDetails,
        ok: true,
        runId: "content-parity:invalid-property-input",
        durationMs: 1,
      })),
      engine: {} as never,
      model: "test-model",
      analyzeContext: vi.fn(),
    });

    expect(
      row.scores.find((score) => score.scorer === "expected_property_values"),
    ).toMatchObject({ passed: false, score: 0 });
    expect(row.status).toBe("failed");
  });

  it.each([
    {
      name: "wrong target",
      mutate(call: ReturnType<typeof successfulCreateCall>) {
        return {
          ...call,
          input: {
            ...(call.input as Record<string, unknown>),
            target: {
              ...((call.input as Record<string, unknown>).target as Record<
                string,
                unknown
              >),
              databaseId: "wrong-database",
            },
          },
        };
      },
    },
    {
      name: "failed execution",
      mutate(call: ReturnType<typeof successfulCreateCall>) {
        return { ...call, isError: true, result: "fixture rejected" };
      },
    },
    {
      name: "skipped side effect",
      mutate(call: ReturnType<typeof successfulCreateCall>) {
        return { ...call, completedSideEffect: false };
      },
    },
    {
      name: "an extra top-level field",
      mutate(call: ReturnType<typeof successfulCreateCall>) {
        return {
          ...call,
          input: {
            ...(call.input as Record<string, unknown>),
            hallucinated: true,
          },
        };
      },
    },
    {
      name: "an extra target field",
      mutate(call: ReturnType<typeof successfulCreateCall>) {
        const input = call.input as Record<string, unknown>;
        return {
          ...call,
          input: {
            ...input,
            target: {
              ...(input.target as Record<string, unknown>),
              hallucinated: true,
            },
          },
        };
      },
    },
    {
      name: "an extra authority field",
      mutate(call: ReturnType<typeof successfulCreateCall>) {
        const input = call.input as Record<string, unknown>;
        const target = input.target as Record<string, unknown>;
        return {
          ...call,
          input: {
            ...input,
            target: {
              ...target,
              authorityScope: {
                ...(target.authorityScope as Record<string, unknown>),
                hallucinated: true,
              },
            },
          },
        };
      },
    },
    {
      name: "an extra property-entry field",
      mutate(call: ReturnType<typeof successfulCreateCall>) {
        const input = call.input as Record<string, unknown>;
        const { propertyValues, ...withoutPropertyValues } = input;
        return {
          ...call,
          input: {
            ...withoutPropertyValues,
            propertyEntries: Object.entries(
              propertyValues as Record<string, unknown>,
            ).map(([propertyId, value]) => ({
              propertyId,
              value,
              hallucinated: true,
            })),
          },
        };
      },
    },
  ])("rejects $name", async ({ mutate }) => {
    process.env.CONTENT_PARITY_EVALS = "1";
    const scenario = parityEvalScenarios.find(
      (candidate) => candidate.id === "database-create-property-preservation",
    )!;
    const call = mutate(
      successfulCreateCall(scenario, {
        propertyValues: scenario.expectedPropertyValues,
      }),
    );
    const evalCase = scenarioToEval(scenario);
    const row = await scoreEval(evalCase, {
      runAgent: vi.fn(async () => ({
        text: scenario.successSignals.join("\n"),
        toolCalls: ["add-database-item"],
        toolCallDetails: [call],
        ok: true,
        runId: "content-parity:rejected-create",
        durationMs: 1,
      })),
      engine: {} as never,
      model: "test-model",
      analyzeContext: vi.fn(),
    });

    expect(
      row.scores.find((score) => score.scorer === "expected_property_values"),
    ).toMatchObject({ passed: false, score: 0 });
    expect(row.status).toBe("failed");
  });
});
