import { describe, expect, it } from "vitest";

import { ANALYTICS_CONNECTOR_CATALOG } from "./analytics-connector-catalog";

describe("Analytics MCP connector catalog", () => {
  it("contains only the incident-focused read actions", () => {
    expect(ANALYTICS_CONNECTOR_CATALOG).toEqual([
      "list-session-recordings",
      "query-agent-native-analytics",
      "list-error-issues",
      "get-error-issue",
    ]);

    expect(ANALYTICS_CONNECTOR_CATALOG).not.toContain(
      "get-session-replay-events",
    );
    expect(ANALYTICS_CONNECTOR_CATALOG).not.toContain("update-dashboard");
    expect(ANALYTICS_CONNECTOR_CATALOG).not.toContain("save-analysis");
  });
});
