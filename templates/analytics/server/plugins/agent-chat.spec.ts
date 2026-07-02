import type { ActionEntry } from "@agent-native/core/server";
import { describe, expect, it } from "vitest";

import {
  applyAnalyticsPlanModePolicy,
  PLAN_MODE_ACT_ONLY_TOOLS,
} from "../lib/agent-chat-plan-mode";

type PlanModePolicyEntry = ActionEntry & { allowInPlanMode?: boolean };

function action(readOnly = true): ActionEntry {
  return {
    readOnly,
    tool: {
      description: "test action",
      parameters: { type: "object", properties: {} },
    },
    run: async () => "ok",
  };
}

describe("Analytics agent Plan mode policy", () => {
  it("marks substantive data-analysis tools as Act-only without changing lightweight planning tools", () => {
    const actions = applyAnalyticsPlanModePolicy({
      "data-source-status": action(),
      "search-bigquery-schema": action(),
      bigquery: action(),
      "provider-api-request": action(),
      "query-staged-dataset": action(),
      "hubspot-deals": action(),
    });

    expect(
      (actions["data-source-status"] as PlanModePolicyEntry).allowInPlanMode,
    ).toBeUndefined();
    expect(
      (actions["search-bigquery-schema"] as PlanModePolicyEntry)
        .allowInPlanMode,
    ).toBeUndefined();
    expect((actions.bigquery as PlanModePolicyEntry).allowInPlanMode).toBe(
      false,
    );
    expect(
      (actions["provider-api-request"] as PlanModePolicyEntry).allowInPlanMode,
    ).toBe(false);
    expect(
      (actions["query-staged-dataset"] as PlanModePolicyEntry).allowInPlanMode,
    ).toBe(false);
    expect(
      (actions["hubspot-deals"] as PlanModePolicyEntry).allowInPlanMode,
    ).toBe(false);
  });

  it("documents the complete Analytics Act-only Plan mode tool set", () => {
    expect([...PLAN_MODE_ACT_ONLY_TOOLS].sort()).toEqual([
      "account-deep-dive",
      "bigquery",
      "gong-calls",
      "hubspot-deals",
      "hubspot-records",
      "jira-search",
      "provider-api-request",
      "provider-corpus-job",
      "query-agent-native-analytics",
      "query-staged-dataset",
      "sentry",
      "slack-messages",
    ]);
  });
});
