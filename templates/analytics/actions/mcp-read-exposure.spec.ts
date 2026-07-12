import { describe, expect, it } from "vitest";

import getErrorIssue from "./get-error-issue";
import getSessionReplayEvents from "./get-session-replay-events";
import getSessionReplaySummary from "./get-session-replay-summary";
import listErrorIssues from "./list-error-issues";
import listSessionRecordings from "./list-session-recordings";
import queryAgentNativeAnalytics from "./query-agent-native-analytics";

describe("Analytics authenticated MCP read actions", () => {
  it.each([
    ["list-session-recordings", listSessionRecordings],
    ["get-session-replay-summary", getSessionReplaySummary],
    ["get-session-replay-events", getSessionReplayEvents],
    ["query-agent-native-analytics", queryAgentNativeAnalytics],
    ["list-error-issues", listErrorIssues],
    ["get-error-issue", getErrorIssue],
  ])("opts %s into authenticated read exposure", (_name, action) => {
    expect(action.http).toEqual({ method: "GET" });
    expect(action.readOnly).toBe(true);
    expect(action.publicAgent).toEqual({
      expose: true,
      readOnly: true,
      requiresAuth: true,
    });
    expect(action.mcpApp).toBeUndefined();
  });
});
