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

function normalizePropertyValues(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const propertyValues = (input as Record<string, unknown>).propertyValues;
  if (!propertyValues) return {};
  if (!Array.isArray(propertyValues)) {
    return typeof propertyValues === "object"
      ? (propertyValues as Record<string, unknown>)
      : {};
  }
  return Object.fromEntries(
    propertyValues.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const { propertyId, value } = entry as Record<string, unknown>;
      return typeof propertyId === "string" ? [[propertyId, value]] : [];
    }),
  );
}

function expectedPropertyValuesScorer(expected: Record<string, unknown>) {
  return createScorer<
    AgentRunOutput,
    {
      received: Record<string, unknown>;
      missing: string[];
      unexpected: string[];
    }
  >({
    name: "expected_property_values",
    analyze(run) {
      const detail = run.toolCallDetails?.find(
        (call) => call.name === "add-database-item",
      );
      const received = normalizePropertyValues(detail?.input);
      const missing = Object.entries(expected)
        .filter(([propertyId, value]) => received[propertyId] !== value)
        .map(([propertyId]) => propertyId);
      const unexpected = Object.keys(received).filter(
        (propertyId) => !(propertyId in expected),
      );
      return { received, missing, unexpected };
    },
    generateScore({ missing, unexpected }) {
      return missing.length === 0 && unexpected.length === 0 ? 1 : 0;
    },
    generateReason({ analysis: { received, missing, unexpected } }) {
      if (missing.length === 0 && unexpected.length === 0) {
        return "Agent preserved every expected property ID and exact value without inventing another property.";
      }
      return `Received propertyValues ${JSON.stringify(received)}; missing or changed: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`;
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
      ...(scenario.expectedPropertyValues
        ? [expectedPropertyValuesScorer(scenario.expectedPropertyValues)]
        : []),
    ],
  });
}
