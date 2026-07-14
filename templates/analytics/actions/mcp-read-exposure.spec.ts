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

  it("keeps query-agent-native-analytics off HTTP and on the explicit connector catalog", () => {
    // Raw SQL must never mount a GET route (SQL would land in query strings
    // and access logs). The action is not auto-derived as an authenticated
    // read; it stays MCP-callable only via the explicit connector catalog.
    expect(queryAgentNativeAnalytics.http).toBe(false);
    expect(queryAgentNativeAnalytics.readOnly).toBe(true);
    expect(queryAgentNativeAnalytics.publicAgent).toEqual({
      expose: true,
      readOnly: true,
      requiresAuth: true,
    });
    expect(queryAgentNativeAnalytics.mcpApp).toBeUndefined();
    expect(ANALYTICS_CONNECTOR_CATALOG).toContain(
      "query-agent-native-analytics",
    );
  });
});
