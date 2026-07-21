import { describe, expect, it } from "vitest";

import {
  MAX_A2A_CORRELATION_VALUE_CHARS,
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
      }),
    ).toEqual({
      callerApp: "agent-native-slides",
      callerThreadId: "thread-1720000000000-a1b2c3",
      parentRunId: "run-task-09ad2418-c1",
      parentTurnId: "turn-550e8400-e29b-41d4-a716-446655440000",
      invocationId: "550e8400-e29b-41d4-a716-446655440000",
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
      }),
    ).toEqual({});
  });
});
