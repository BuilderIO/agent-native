import { fileURLToPath } from "node:url";

import {
  discoverEvalFiles,
  runEvals,
  type AgentRunOutput,
  type AgentRunner,
  type Eval,
} from "@agent-native/core/eval";
import { describe, expect, it } from "vitest";

import evals, { sourceContracts } from "./production-source-cases.eval.js";

const cases = evals as Eval[];

function outputFor(
  contract: (typeof sourceContracts)[keyof typeof sourceContracts],
  overrides: Partial<AgentRunOutput> = {},
): AgentRunOutput {
  const expectedText = [
    ...contract.required,
    ...contract.requireAny.map((group) => group.alternatives[0]),
    ...contract.concepts,
  ].join(" ");
  return {
    text: expectedText,
    toolCalls: ["search-bigquery-schema"],
    ok: true,
    runId: "eval:synthetic-fixture",
    durationMs: 0,
    ...overrides,
  };
}

function runnerFor(output: AgentRunOutput): AgentRunner {
  return {
    engine: {} as AgentRunner["engine"],
    model: "synthetic-fixture",
    runAgent: async () => output,
    analyzeContext: () => ({}) as ReturnType<AgentRunner["analyzeContext"]>,
  };
}

describe("Analytics synthetic production source evals", () => {
  it("keeps all cases synthetic, runner-discoverable, and free of custom run callbacks", async () => {
    const files = await discoverEvalFiles(
      fileURLToPath(new URL("..", import.meta.url)),
      "production-source-cases",
    );

    expect(files.map((file) => file.split("/").at(-1))).toContain(
      "production-source-cases.eval.ts",
    );
    expect(cases.map((evalCase) => evalCase.name)).toHaveLength(4);
    expect(
      cases.every((evalCase) => evalCase.name.startsWith("SYNTHETIC:")),
    ).toBe(true);
    expect(cases.every((evalCase) => evalCase.run === undefined)).toBe(true);
    expect(
      cases.map((evalCase) => evalCase.input.prompt).join("\n"),
    ).not.toMatch(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  });

  it("accepts the expected source and grain contracts using metadata tools only", async () => {
    const contracts = Object.values(sourceContracts);
    let contractIndex = 0;
    const report = await runEvals(
      cases,
      {
        engine: {} as AgentRunner["engine"],
        model: "synthetic-fixture",
        runAgent: async (_input) => {
          const contract = contracts[contractIndex++];
          if (!contract) throw new Error("Synthetic eval contract is missing.");
          return outputFor(contract);
        },
        analyzeContext: () => ({}) as ReturnType<AgentRunner["analyzeContext"]>,
      } as AgentRunner,
      { persist: false },
    );

    expect(report).toMatchObject({ total: 4, passed: 4, failed: 0 });
  });

  it("fails closed on an aborted or failed production run, even with matching text", async () => {
    const report = await runEvals(
      [cases[0]!],
      runnerFor(
        outputFor(sourceContracts.builderUsersByOrganization, {
          ok: false,
          error: "Agent run timed out.",
        }),
      ),
      { persist: false },
    );

    expect(report).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(report.results[0]?.status).toBe("failed");
    expect(report.results[0]?.scores[0]?.score).toBe(0);
  });

  it("fails if an eval reads event or product rows instead of metadata", async () => {
    const report = await runEvals(
      [cases[2]!],
      runnerFor(
        outputFor(sourceContracts.agentNativeUsersAndEvents, {
          toolCalls: ["query-agent-native-analytics"],
        }),
      ),
      { persist: false },
    );

    expect(report).toMatchObject({ total: 1, passed: 0, failed: 1 });
  });
});
