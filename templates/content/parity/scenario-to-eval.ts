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

function hasExactKeys(
  record: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(record).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function analyzePropertyValues(input: unknown): {
  received: Record<string, unknown>;
  receivedTypes: Record<string, string>;
  invalid: string[];
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      received: {},
      receivedTypes: {},
      invalid: ["tool input is not an object"],
    };
  }
  const record = input as Record<string, unknown>;
  const hasEntries = record.propertyEntries !== undefined;
  const hasValues = record.propertyValues !== undefined;
  if (hasEntries && hasValues) {
    return {
      received: {},
      receivedTypes: {},
      invalid: ["propertyEntries and propertyValues were both provided"],
    };
  }
  if (hasValues) {
    if (
      !record.propertyValues ||
      typeof record.propertyValues !== "object" ||
      Array.isArray(record.propertyValues)
    ) {
      return {
        received: {},
        receivedTypes: {},
        invalid: ["propertyValues is not a record"],
      };
    }
    return {
      received: record.propertyValues as Record<string, unknown>,
      receivedTypes: {},
      invalid: ["propertyValues bypassed the typed agent input"],
    };
  }
  if (!hasEntries || !Array.isArray(record.propertyEntries)) {
    return {
      received: {},
      receivedTypes: {},
      invalid: ["propertyEntries is not an array"],
    };
  }

  const received: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  const receivedTypes: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  const invalid: string[] = [];
  for (const entry of record.propertyEntries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      invalid.push("propertyEntries contains a non-object entry");
      continue;
    }
    const { propertyId, propertyType, value } = entry as Record<
      string,
      unknown
    >;
    if (
      !hasExactKeys(entry as Record<string, unknown>, [
        "propertyId",
        "propertyType",
        "value",
      ])
    ) {
      invalid.push(
        "propertyEntries contains an entry with unrecognized fields",
      );
      continue;
    }
    if (typeof propertyId !== "string" || propertyId.length === 0) {
      invalid.push("propertyEntries contains an invalid propertyId");
      continue;
    }
    if (typeof propertyType !== "string" || propertyType.length === 0) {
      invalid.push(
        `propertyEntries contains an invalid type for ${propertyId}`,
      );
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(received, propertyId)) {
      invalid.push(`propertyEntries contains duplicate ID ${propertyId}`);
      continue;
    }
    received[propertyId] = value;
    receivedTypes[propertyId] = propertyType;
  }
  return { received, receivedTypes, invalid };
}

const databaseRowMutationTools = new Set([
  "add-database-item",
  "update-database-item",
  "upsert-database-item-by-key",
  "duplicate-database-items",
  "remove-database-items",
]);

function matchesCreateEnvelope(
  input: Record<string, unknown>,
  expected: NonNullable<ParityEvalScenario["expectedCreateEnvelope"]>,
): boolean {
  const target = input.target;
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return false;
  }
  const actualTarget = target as Record<string, unknown>;
  return (
    hasExactKeys(input, [
      "target",
      "expectedSchemaRevision",
      "idempotencyKey",
      "title",
      input.propertyEntries === undefined
        ? "propertyValues"
        : "propertyEntries",
    ]) &&
    hasExactKeys(actualTarget, [
      "spaceId",
      "databaseId",
      "databaseDocumentId",
    ]) &&
    actualTarget.spaceId === expected.target.spaceId &&
    actualTarget.databaseId === expected.target.databaseId &&
    actualTarget.databaseDocumentId === expected.target.databaseDocumentId &&
    input.expectedSchemaRevision === expected.expectedSchemaRevision &&
    input.idempotencyKey === expected.idempotencyKey &&
    input.title === expected.title
  );
}

function parseToolResultJson(result: string | undefined): unknown {
  if (!result) return undefined;
  try {
    return JSON.parse(result);
  } catch {
    // coercion-ok: an unparseable tool result fails the same "did not supply
    // the expected target/contract" scorer checks below as a missing one —
    // both are non-passing evidence, not a distinction the eval needs to make.
    return undefined;
  }
}

function expectedPropertyValuesScorer(
  expected: Record<string, unknown>,
  expectedTypes: Record<string, string> | undefined,
  expectedEnvelope?: ParityEvalScenario["expectedCreateEnvelope"],
) {
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
      const orderedCalls = run.toolCalls;
      const listIndex = orderedCalls.indexOf("list-content-databases");
      const inspectIndex = orderedCalls.indexOf("get-content-database");
      const createIndex = orderedCalls.indexOf("add-database-item");
      if (
        listIndex < 0 ||
        inspectIndex <= listIndex ||
        createIndex <= inspectIndex
      ) {
        invalid.push("database discovery did not precede the create mutation");
      }
      const listCall = (run.toolCallDetails ?? []).find(
        (call) => call.name === "list-content-databases",
      );
      const inspectCall = (run.toolCallDetails ?? []).find(
        (call) => call.name === "get-content-database",
      );
      const createCall = createCalls[0];
      const listInput = listCall?.input as Record<string, unknown> | undefined;
      const inspectInput = inspectCall?.input as
        | Record<string, unknown>
        | undefined;
      if (
        expectedEnvelope &&
        (listInput?.title !== "PR #3314 feedback" ||
          inspectInput?.databaseId !== expectedEnvelope.target.databaseId)
      ) {
        invalid.push(
          "discovery did not resolve the requested title to the exact create target",
        );
      }
      if (
        !listCall?.completed ||
        listCall.isError ||
        !inspectCall?.completed ||
        inspectCall.isError
      ) {
        invalid.push("database discovery calls did not complete successfully");
      }
      if (
        listCall?.completedAtEventIndex === undefined ||
        inspectCall?.startedAtEventIndex === undefined ||
        listCall.completedAtEventIndex >= inspectCall.startedAtEventIndex ||
        inspectCall.completedAtEventIndex === undefined ||
        createCall?.startedAtEventIndex === undefined ||
        inspectCall.completedAtEventIndex >= createCall.startedAtEventIndex
      ) {
        invalid.push(
          "database discovery results were not available before dependent calls started",
        );
      }
      if (expectedEnvelope) {
        const listResult = parseToolResultJson(listCall?.result) as
          | { databases?: Array<Record<string, unknown>> }
          | undefined;
        const discoveredDatabase = listResult?.databases?.find(
          (database) =>
            database.databaseId === expectedEnvelope.target.databaseId,
        );
        const discoveredDocumentId =
          discoveredDatabase?.documentId ??
          discoveredDatabase?.databaseDocumentId;
        if (
          !discoveredDatabase ||
          discoveredDocumentId !== expectedEnvelope.target.databaseDocumentId ||
          discoveredDatabase.spaceId !== expectedEnvelope.target.spaceId
        ) {
          invalid.push(
            "list-content-databases result did not supply the expected create target",
          );
        }
        const inspectResult = parseToolResultJson(inspectCall?.result) as
          | {
              mutationContract?: {
                target?: Record<string, unknown>;
                schemaRevision?: string;
                expectedSchemaRevision?: string;
                properties?: Array<Record<string, unknown>>;
              };
            }
          | undefined;
        const contractTarget = inspectResult?.mutationContract?.target;
        const contractSchemaRevision =
          inspectResult?.mutationContract?.schemaRevision ??
          inspectResult?.mutationContract?.expectedSchemaRevision;
        if (
          !contractTarget ||
          contractTarget.spaceId !== expectedEnvelope.target.spaceId ||
          contractTarget.databaseId !== expectedEnvelope.target.databaseId ||
          contractTarget.databaseDocumentId !==
            expectedEnvelope.target.databaseDocumentId ||
          contractSchemaRevision !== expectedEnvelope.expectedSchemaRevision
        ) {
          invalid.push(
            "get-content-database result did not supply the expected mutation contract",
          );
        }
        const discoveredProperties = new Map(
          (inspectResult?.mutationContract?.properties ?? []).map(
            (property) => [property.id, property],
          ),
        );
        for (const [propertyId, expectedType] of Object.entries(
          expectedTypes ?? {},
        )) {
          const property = discoveredProperties.get(propertyId);
          if (
            property?.type !== expectedType ||
            property.writable !== true ||
            property.sourceManaged === true
          ) {
            invalid.push(
              `discovery did not supply writable property ${propertyId} with type ${expectedType}`,
            );
          }
        }
      }
      for (const [propertyId, expectedType] of Object.entries(
        expectedTypes ?? {},
      )) {
        if (analysis.receivedTypes[propertyId] !== expectedType) {
          invalid.push(
            `property ${propertyId} did not declare discovered type ${expectedType}`,
          );
        }
      }
      const createInput = createCalls[0]?.input;
      if (
        expectedEnvelope &&
        (!createInput ||
          typeof createInput !== "object" ||
          Array.isArray(createInput) ||
          !matchesCreateEnvelope(
            createInput as Record<string, unknown>,
            expectedEnvelope,
          ))
      ) {
        invalid.push(
          "create target, schema revision, idempotency key, or title did not match the fixture",
        );
      }
      if (
        !createCalls[0]?.completed ||
        createCalls[0]?.completedSideEffect !== true ||
        createCalls[0]?.isError
      ) {
        invalid.push("add-database-item did not complete successfully");
      }
      if (!run.ok) {
        invalid.push("agent run did not complete successfully");
      }
      const received = analysis.received;
      const missing = Object.entries(expected)
        .filter(([propertyId, value]) => received[propertyId] !== value)
        .map(([propertyId]) => propertyId);
      const unexpected = Object.keys(received).filter(
        (propertyId) =>
          !Object.prototype.hasOwnProperty.call(expected, propertyId),
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
        ? [
            expectedPropertyValuesScorer(
              scenario.expectedPropertyValues,
              scenario.expectedPropertyTypes,
              scenario.expectedCreateEnvelope,
            ),
          ]
        : []),
    ],
  });
}
