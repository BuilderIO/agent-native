import { describe, expect, it } from "vitest";

import getUsageAlerts from "./get-usage-alerts.js";
import getUsageInsights from "./get-usage-insights.js";
import getUsageRun from "./get-usage-run.js";
import manageUsageAlert from "./manage-usage-alert.js";

describe("usage actions over MCP", () => {
  it.each([
    ["get-usage-alerts", getUsageAlerts],
    ["get-usage-insights", getUsageInsights],
    ["get-usage-run", getUsageRun],
    ["manage-usage-alert", manageUsageAlert],
  ] as const)("keeps %s in the app, off MCP", (_name, action) => {
    expect(action.mcpTool).toBe(false);
  });
});
