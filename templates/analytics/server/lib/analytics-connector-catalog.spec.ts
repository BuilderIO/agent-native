import { describe, expect, it } from "vitest";

import getErrorIssue from "../../actions/get-error-issue";
import getSessionReplayEvents from "../../actions/get-session-replay-events";
import getSessionReplaySummary from "../../actions/get-session-replay-summary";
import listErrorIssues from "../../actions/list-error-issues";
import listSessionRecordings from "../../actions/list-session-recordings";
import queryAgentNativeAnalytics from "../../actions/query-agent-native-analytics";
import { ANALYTICS_CONNECTOR_CATALOG } from "./analytics-connector-catalog";

const INCIDENT_READ_ACTIONS = {
  "list-session-recordings": listSessionRecordings,
  "get-session-replay-summary": getSessionReplaySummary,
  "get-session-replay-events": getSessionReplayEvents,
  "query-agent-native-analytics": queryAgentNativeAnalytics,
  "list-error-issues": listErrorIssues,
  "get-error-issue": getErrorIssue,
} as const;

type ActionDefinition =
  (typeof INCIDENT_READ_ACTIONS)[keyof typeof INCIDENT_READ_ACTIONS];

function parameterNames(action: ActionDefinition): string[] {
  const properties = action.tool.parameters?.properties;
  return properties && typeof properties === "object"
    ? Object.keys(properties)
    : [];
}

describe("Analytics MCP connector catalog", () => {
  it("contains only the incident-focused read actions", () => {
    expect(ANALYTICS_CONNECTOR_CATALOG).toEqual([
      "list-session-recordings",
      "get-session-replay-summary",
      "get-session-replay-events",
      "query-agent-native-analytics",
      "list-error-issues",
      "get-error-issue",
    ]);
    expect(ANALYTICS_CONNECTOR_CATALOG).not.toContain("update-dashboard");
    expect(ANALYTICS_CONNECTOR_CATALOG).not.toContain("save-analysis");
  });

  it("maps one-to-one to the six authenticated incident-read action definitions", () => {
    expect(Object.keys(INCIDENT_READ_ACTIONS)).toEqual([
      ...ANALYTICS_CONNECTOR_CATALOG,
    ]);

    for (const action of Object.values(INCIDENT_READ_ACTIONS)) {
      expect(action.http).toEqual({ method: "GET" });
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
    expect(parameterNames(getSessionReplayEvents)).toEqual(
      expect.arrayContaining(["recordingId", "startSeq", "endSeq", "limit"]),
    );
    expect(parameterNames(queryAgentNativeAnalytics)).toEqual(["sql"]);
    expect(parameterNames(listErrorIssues)).toEqual(
      expect.arrayContaining(["status", "query", "app", "sort", "limit"]),
    );
    expect(parameterNames(getErrorIssue)).toEqual(
      expect.arrayContaining(["id", "eventsLimit"]),
    );
  });

  it("keeps replay reads bounded and free of blob/storage inputs", () => {
    expect(getSessionReplaySummary.tool.description).toMatch(
      /scoped summary|raw chunks|storage references/i,
    );
    expect(getSessionReplayEvents.tool.description).toMatch(
      /capped|storage provider URLs|raw chunk table access/i,
    );
    expect(queryAgentNativeAnalytics.tool.description).toMatch(
      /session_replay_chunks is intentionally unavailable/i,
    );

    for (const action of [
      getSessionReplaySummary,
      getSessionReplayEvents,
      queryAgentNativeAnalytics,
    ]) {
      expect(parameterNames(action)).not.toEqual(
        expect.arrayContaining(["storageRef", "inlineData", "blob", "blobUrl"]),
      );
    }
  });
});
