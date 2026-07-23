import { describe, expect, it } from "vitest";

import accountDeepDive from "../../actions/account-deep-dive";
import getErrorIssue from "../../actions/get-error-issue";
import getSessionReplaySummary from "../../actions/get-session-replay-summary";
import getSessionReplayTimeline from "../../actions/get-session-replay-timeline";
import gongCalls from "../../actions/gong-calls";
import gongNativeInsights from "../../actions/gong-native-insights";
import listErrorIssues from "../../actions/list-error-issues";
import listSessionRecordings from "../../actions/list-session-recordings";
import queryAgentNativeAnalytics from "../../actions/query-agent-native-analytics";
import { ANALYTICS_CONNECTOR_CATALOG } from "./analytics-connector-catalog";

const CONNECTOR_READ_ACTIONS = {
  "account-deep-dive": accountDeepDive,
  "gong-calls": gongCalls,
  "gong-native-insights": gongNativeInsights,
  "list-session-recordings": listSessionRecordings,
  "get-session-replay-summary": getSessionReplaySummary,
  "get-session-replay-timeline": getSessionReplayTimeline,
  "query-agent-native-analytics": queryAgentNativeAnalytics,
  "list-error-issues": listErrorIssues,
  "get-error-issue": getErrorIssue,
} as const;

type ActionDefinition =
  (typeof CONNECTOR_READ_ACTIONS)[keyof typeof CONNECTOR_READ_ACTIONS];

function parameterNames(action: ActionDefinition): string[] {
  const properties = action.tool.parameters?.properties;
  return properties && typeof properties === "object"
    ? Object.keys(properties)
    : [];
}

describe("Analytics MCP connector catalog", () => {
  it("contains only the bounded authenticated connector reads", () => {
    expect(ANALYTICS_CONNECTOR_CATALOG).toEqual([
      "account-deep-dive",
      "gong-calls",
      "gong-native-insights",
      "list-session-recordings",
      "get-session-replay-summary",
      "get-session-replay-timeline",
      "query-agent-native-analytics",
      "list-error-issues",
      "get-error-issue",
    ]);
    expect(ANALYTICS_CONNECTOR_CATALOG).not.toContain(
      "get-session-replay-events",
    );
    expect(ANALYTICS_CONNECTOR_CATALOG).not.toContain(
      "create-session-replay-agent-link",
    );
    expect(ANALYTICS_CONNECTOR_CATALOG).not.toContain("update-dashboard");
    expect(ANALYTICS_CONNECTOR_CATALOG).not.toContain("save-analysis");
  });

  it("maps one-to-one to authenticated read-only action definitions", () => {
    expect(Object.keys(CONNECTOR_READ_ACTIONS)).toEqual([
      ...ANALYTICS_CONNECTOR_CATALOG,
    ]);

    for (const [name, action] of Object.entries(CONNECTOR_READ_ACTIONS)) {
      if (name === "query-agent-native-analytics") {
        // Raw-SQL action: no HTTP route (SQL must not land in GET query
        // strings/access logs). It is MCP-callable only through this
        // explicit catalog, not the auto-derived authenticated-read policy.
        expect(action.http).toBe(false);
      } else if (name !== "gong-calls" && name !== "gong-native-insights") {
        expect(action.http).toEqual({ method: "GET" });
      }
      expect(action.readOnly).toBe(true);
      expect(action.publicAgent).toEqual({
        expose: true,
        readOnly: true,
        requiresAuth: true,
      });
      expect(action.mcpApp).toBeUndefined();
    }
  });

  it("covers the inputs needed to correlate errors, recordings, events, and replay context", () => {
    expect(parameterNames(listSessionRecordings)).toEqual(
      expect.arrayContaining([
        "query",
        "sessionId",
        "userId",
        "path",
        "from",
        "to",
        "hasErrors",
        "limit",
      ]),
    );
    expect(parameterNames(getSessionReplaySummary)).toEqual(["recordingId"]);
    expect(parameterNames(getSessionReplayTimeline)).toEqual(
      expect.arrayContaining(["recordingId", "eventLimit"]),
    );
    expect(parameterNames(queryAgentNativeAnalytics)).toEqual(["sql"]);
    expect(parameterNames(listErrorIssues)).toEqual(
      expect.arrayContaining([
        "status",
        "query",
        "app",
        "sessionRecordingId",
        "userId",
        "sort",
        "limit",
      ]),
    );
    expect(parameterNames(getErrorIssue)).toEqual(
      expect.arrayContaining(["id", "eventsLimit"]),
    );
  });

  it("keeps replay reads bounded and free of blob/storage inputs", () => {
    expect(getSessionReplaySummary.tool.description).toMatch(
      /scoped summary|raw chunks|storage references/i,
    );
    expect(getSessionReplayTimeline.tool.description).toMatch(
      /bounded|sanitized|raw rrweb|storage references/i,
    );
    expect(queryAgentNativeAnalytics.tool.description).toMatch(
      /session_replay_chunks is intentionally unavailable/i,
    );

    for (const action of [
      getSessionReplaySummary,
      getSessionReplayTimeline,
      queryAgentNativeAnalytics,
    ]) {
      expect(parameterNames(action)).not.toEqual(
        expect.arrayContaining(["storageRef", "inlineData", "blob", "blobUrl"]),
      );
    }
  });
});
