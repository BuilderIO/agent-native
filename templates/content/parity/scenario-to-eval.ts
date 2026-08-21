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

function analyzePropertyValues(input: unknown): {
  received: Record<string, unknown>;
  invalid: string[];
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { received: {}, invalid: ["tool input is not an object"] };
  }
  const record = input as Record<string, unknown>;
  const hasEntries = record.propertyEntries !== undefined;
  const hasValues = record.propertyValues !== undefined;
  if (hasEntries && hasValues) {
    return {
      received: {},
      invalid: ["propertyEntries and propertyValues were both provided"],
    };
  }
  if (hasValues) {
    if (
      !record.propertyValues ||
      typeof record.propertyValues !== "object" ||
      Array.isArray(record.propertyValues)
    ) {
      return { received: {}, invalid: ["propertyValues is not a record"] };
    }
    return {
      received: record.propertyValues as Record<string, unknown>,
      invalid: [],
    };
  }
  if (!hasEntries || !Array.isArray(record.propertyEntries)) {
    return { received: {}, invalid: ["propertyEntries is not an array"] };
  }

  const received: Record<string, unknown> = {};
  const invalid: string[] = [];
  for (const entry of record.propertyEntries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      invalid.push("propertyEntries contains a non-object entry");
      continue;
    }
    const { propertyId, value } = entry as Record<string, unknown>;
    if (typeof propertyId !== "string" || propertyId.length === 0) {
      invalid.push("propertyEntries contains an invalid propertyId");
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(received, propertyId)) {
      invalid.push(`propertyEntries contains duplicate ID ${propertyId}`);
      continue;
    }
    received[propertyId] = value;
  }
  return { received, invalid };
}

const databaseRowMutationTools = new Set([
  "add-database-item",
  "update-database-item",
  "upsert-database-item-by-key",
  "duplicate-database-items",
  "remove-database-items",
]);

function expectedPropertyValuesScorer(expected: Record<string, unknown>) {
  return createScorer<
    AgentRunOutput,
    {
      received: Record<string, unknown>;
      missing: string[];
      unexpected: string[];
      invalid: string[];
      mutationCalls: string[];
    }
  >({
    name: "expected_property_values",
    analyze(run) {
      const mutationCalls = (run.toolCallDetails ?? [])
        .filter((call) => databaseRowMutationTools.has(call.name))
        .map((call) => call.name);
      const createCalls = (run.toolCallDetails ?? []).filter(
        (call) => call.name === "add-database-item",
      );
      const analysis = analyzePropertyValues(createCalls[0]?.input);
      const invalid = [...analysis.invalid];
      if (createCalls.length !== 1) {
        invalid.push(
          `expected exactly one add-database-item call, received ${createCalls.length}`,
        );
      }
      if (mutationCalls.length !== 1) {
        invalid.push(
          `expected exactly one row mutation, received ${mutationCalls.length}`,
        );
      }
      const received = analysis.received;
      const missing = Object.entries(expected)
        .filter(([propertyId, value]) => received[propertyId] !== value)
        .map(([propertyId]) => propertyId);
      const unexpected = Object.keys(received).filter(
        (propertyId) => !(propertyId in expected),
      );
      return { received, missing, unexpected, invalid, mutationCalls };
    },
    generateScore({ missing, unexpected, invalid }) {
      return missing.length === 0 &&
        unexpected.length === 0 &&
        invalid.length === 0
        ? 1
        : 0;
    },
    generateReason({
      analysis: { received, missing, unexpected, invalid, mutationCalls },
    }) {
      if (
        missing.length === 0 &&
        unexpected.length === 0 &&
        invalid.length === 0
      ) {
        return "Agent preserved every expected property ID and exact value without inventing another property.";
      }
      return `Received propertyValues ${JSON.stringify(received)}; mutations: ${mutationCalls.join(", ") || "none"}; missing or changed: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}; invalid: ${invalid.join("; ") || "none"}`;
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
