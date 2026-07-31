import { describe, expect, it } from "vitest";

import {
  MAX_A2A_CORRELATION_VALUE_CHARS,
  MAX_A2A_DELEGATION_HOPS,
  sanitizeA2ACorrelationId,
  sanitizeA2ACorrelationMetadata,
} from "./correlation.js";

describe("A2A correlation metadata", () => {
  it("keeps bounded opaque identifiers", () => {
    expect(
      sanitizeA2ACorrelationMetadata({
        callerApp: "agent-native-slides",
        callerThreadId: "thread-1720000000000-a1b2c3",
        parentRunId: "run-task-09ad2418-c1",
        parentTurnId: "turn-550e8400-e29b-41d4-a716-446655440000",
        invocationId: "550e8400-e29b-41d4-a716-446655440000",
        delegationDepth: 2,
        visitedApps: ["dispatch", "slides"],
      }),
    ).toEqual({
      callerApp: "agent-native-slides",
      callerThreadId: "thread-1720000000000-a1b2c3",
      parentRunId: "run-task-09ad2418-c1",
      parentTurnId: "turn-550e8400-e29b-41d4-a716-446655440000",
      invocationId: "550e8400-e29b-41d4-a716-446655440000",
      delegationDepth: 2,
      visitedApps: ["dispatch", "slides"],
    });
    expect(sanitizeA2ACorrelationId("realtime:call_tab")).toBe(
      "realtime:call_tab",
    );
  });

  it("drops values that could carry arbitrary content", () => {
    expect(
      sanitizeA2ACorrelationMetadata({
        callerApp: "slides customer secret",
        callerThreadId: "thread-id\nprivate text",
        parentRunId: '{"prompt":"private"}',
        parentTurnId: "run/customer/private",
        invocationId: "x".repeat(MAX_A2A_CORRELATION_VALUE_CHARS + 1),
        delegationDepth: MAX_A2A_DELEGATION_HOPS + 1,
        visitedApps: ["slides", "bad app", "analytics"],
      }),
    ).toEqual({
      delegationDepth: MAX_A2A_DELEGATION_HOPS,
      visitedApps: ["slides", "analytics"],
    });
  });

  it("filters damaged path entries before applying the lineage bound", () => {
    expect(
      sanitizeA2ACorrelationMetadata({
        visitedApps: [
          "bad app 1",
          "bad app 2",
          "bad app 3",
          "bad app 4",
          "analytics",
          "slides",
        ],
      }),
    ).toEqual({
      delegationDepth: 2,
      visitedApps: ["analytics", "slides"],
    });
  });
});
