import type { ActionEntry } from "@agent-native/core/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../.generated/actions-registry.js", () => ({ default: {} }));

import {
  applyAnalyticsPlanModePolicy,
  PLAN_MODE_ACT_ONLY_TOOLS,
  INITIAL_TOOL_NAMES,
} from "../lib/agent-chat-plan-mode";
import {
  analyticsDataDictionaryRoutingContext,
  analyticsSourceGuidanceOpening,
  SIMPLE_TIME_BOUNDED_METRIC_FAST_PATH_GUIDANCE,
} from "./agent-chat";

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
  it("injects the simple, time-bounded metric fast path into source guidance", () => {
    const guidance = analyticsSourceGuidanceOpening();

    expect(guidance).toContain("<data-source-guidance>");
    expect(guidance).toContain(SIMPLE_TIME_BOUNDED_METRIC_FAST_PATH_GUIDANCE);
    expect(guidance).toContain("run one bounded aggregate");
    expect(guidance).toContain("Once it returns a valid result");
    expect(guidance).toContain("does not waive the real-data requirement");
  });

  it("routes data-dictionary lookup on demand with compact guidance", () => {
    const context = analyticsDataDictionaryRoutingContext();

    expect(context).toContain("available on demand");
    expect(context).toContain("`list-data-dictionary`");
    expect(context).toContain("focused `search` or `department` filter");
    expect(context).toContain("approved entries as canonical");
    expect(context.length).toBeLessThan(1_000);
  });

  it("marks substantive data-analysis tools as Act-only without changing lightweight planning tools", () => {
    const actions = applyAnalyticsPlanModePolicy({
      "data-source-status": action(),
      "search-bigquery-schema": action(),
      bigquery: action(),
      "provider-api-request": action(),
      "query-staged-dataset": action(),
      "hubspot-deals": action(),
      "hubspot-pipelines": action(),
      "github-repo-files": action(),
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
    expect(
      (actions["hubspot-pipelines"] as PlanModePolicyEntry).allowInPlanMode,
    ).toBe(false);
    expect(
      (actions["github-repo-files"] as PlanModePolicyEntry).allowInPlanMode,
    ).toBe(false);
  });

  it("documents the complete Analytics Act-only Plan mode tool set", () => {
    expect([...PLAN_MODE_ACT_ONLY_TOOLS].sort()).toEqual([
      "account-deep-dive",
      "bigquery",
      "github-repo-files",
      "gong-calls",
      "hubspot-deals",
      "hubspot-pipelines",
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

  it("keeps corpus and provider reduction tools in the initial tool surface", () => {
    expect(INITIAL_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        "provider-api-catalog",
        "provider-api-docs",
        "provider-api-request",
        "provider-corpus-job",
        "query-staged-dataset",
        "run-code",
        "get-code-execution",
        "hubspot-pipelines",
        "github-repo-files",
      ]),
    );
  });
});
