import { describe, expect, it } from "vitest";

import { ANALYTICS_CONNECTOR_CATALOG } from "../server/lib/analytics-connector-catalog";
import getErrorIssue from "./get-error-issue";
import getSessionReplaySummary from "./get-session-replay-summary";
import getSessionReplayTimeline from "./get-session-replay-timeline";
import listErrorIssues from "./list-error-issues";
import listSessionRecordings from "./list-session-recordings";
import queryAgentNativeAnalytics from "./query-agent-native-analytics";

describe("Analytics authenticated MCP read actions", () => {
  it.each([
    ["list-session-recordings", listSessionRecordings],
    ["get-session-replay-summary", getSessionReplaySummary],
    ["get-session-replay-timeline", getSessionReplayTimeline],
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

  it("keeps query-agent-native-analytics internal to the Analytics agent", () => {
    // Raw SQL must never mount a GET route or appear in the direct connector
    // catalog. Sibling agents ask Analytics, which owns the schema and query.
    expect(queryAgentNativeAnalytics.http).toBe(false);
    expect(queryAgentNativeAnalytics.readOnly).toBe(true);
    expect(queryAgentNativeAnalytics.publicAgent).toEqual({
      expose: true,
      readOnly: true,
      requiresAuth: true,
    });
    expect(queryAgentNativeAnalytics.mcpApp).toBeUndefined();
    expect(ANALYTICS_CONNECTOR_CATALOG).not.toContain(
      "query-agent-native-analytics",
    );
  });
});
