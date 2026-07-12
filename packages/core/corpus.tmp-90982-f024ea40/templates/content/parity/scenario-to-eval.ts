import {
  contains,
  createScorer,
  defineEval,
  type AgentRunOutput,
  type Eval,
} from "@agent-native/core/eval";

import type { ParityEvalScenario } from "./eval-scenarios.ts";

function expectedToolScorer(expectedTools: string[]) {
  return createScorer<AgentRunOutput, { used: string[]; missing: string[] }>({
    name: "expected_tools",
    analyze(run) {
      const usedTools = new Set(run.toolCalls);
      return {
        used: expectedTools.filter((tool) => usedTools.has(tool)),
        missing: expectedTools.filter((tool) => !usedTools.has(tool)),
      };
    },
    generateScore({ missing }) {
      return expectedTools.length === 0 || missing.length === 0 ? 1 : 0;
    },
    generateReason({ analysis: { used, missing } }) {
      if (missing.length === 0) {
        return `Agent called all expected tool(s): ${used.join(", ")}`;
      }
      return `Called expected tool(s): ${used.join(", ") || "none"}; missing: ${missing.join(", ")}`;
    },
  });
}

export function scenarioToEval(scenario: ParityEvalScenario): Eval {
  const name = `content-parity:${scenario.id}`;

  if (!process.env[scenario.gateEnv]) {
    return defineEval({
      name,
      input: { prompt: scenario.prompt },
      threshold: 1,
      skipReason: `Skipped because ${scenario.gateEnv} is unset`,
      scorers: [],
    });
  }

  return defineEval({
    name,
    input: { prompt: scenario.prompt },
    threshold: 0.6,
    scorers: [
      contains(scenario.successSignals),
      ...(scenario.expectedTools?.length
        ? [expectedToolScorer(scenario.expectedTools)]
        : []),
    ],
  });
}
