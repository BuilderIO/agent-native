import type {
  ActionEntry,
  AgentLoopFinalResponseGuardContext,
} from "@agent-native/core/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../.generated/actions-registry.js", () => ({ default: {} }));

import {
  applyAnalyticsPlanModePolicy,
  PLAN_MODE_ACT_ONLY_TOOLS,
  INITIAL_TOOL_NAMES,
} from "../lib/agent-chat-plan-mode";
import {
  GENERIC_NO_DATA_FALLBACK_MESSAGE,
  looksLikeAnalyticsDataRequest,
} from "../lib/real-data-actions";
import {
  analyticsDataDictionaryRoutingContext,
  analyticsSourceGuidanceOpening,
  ANALYTICS_OBSERVABILITY_INCIDENT_GUIDANCE,
  NON_ANALYTICS_FALLBACK_FINAL_MESSAGE,
  NON_ANALYTICS_FALLBACK_RETRY_MESSAGE,
  NON_ANALYTICS_REQUEST_GUIDANCE,
  realDataFinalGuard,
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
    expect(guidance).toContain(ANALYTICS_OBSERVABILITY_INCIDENT_GUIDANCE);
    expect(guidance).toContain(NON_ANALYTICS_REQUEST_GUIDANCE);
    expect(guidance).toContain("run one bounded aggregate");
    expect(guidance).toContain("Once it returns a valid result");
    expect(guidance).toContain("does not waive the real-data requirement");
  });

  it("discovers incident sessions without requiring a JavaScript error count", () => {
    expect(ANALYTICS_OBSERVABILITY_INCIDENT_GUIDANCE).toContain(
      "Do not require hasErrors=true for this initial lookup",
    );
    expect(ANALYTICS_OBSERVABILITY_INCIDENT_GUIDANCE).toContain(
      "agent_chat_stuck_detected",
    );
    expect(ANALYTICS_OBSERVABILITY_INCIDENT_GUIDANCE).toContain(
      "create-session-replay-agent-link first",
    );
    expect(ANALYTICS_OBSERVABILITY_INCIDENT_GUIDANCE).toContain(
      "detailed error text, stacks, request metadata",
    );
    expect(ANALYTICS_OBSERVABILITY_INCIDENT_GUIDANCE).toContain(
      "In Plan mode, query-agent-native-analytics is intentionally unavailable",
    );
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

  it("keeps named-session incident evidence on the initial tool surface", () => {
    expect(INITIAL_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        "create-session-replay-agent-link",
        "get-session-replay-events",
        "get-error-issue",
        "get-session-replay-summary",
        "get-session-replay-timeline",
        "list-error-issues",
        "list-session-recordings",
      ]),
    );
  });
});

function userMessage(
  text: string,
): AgentLoopFinalResponseGuardContext["messages"][number] {
  return { role: "user", content: [{ type: "text", text }] };
}

function guardContext(params: {
  userText: string;
  draftText: string;
  toolResults?: AgentLoopFinalResponseGuardContext["toolResults"];
  executionMode?: AgentLoopFinalResponseGuardContext["executionMode"];
}): AgentLoopFinalResponseGuardContext {
  return {
    messages: [userMessage(params.userText)],
    assistantContent: [],
    text: params.draftText,
    toolCalls: [],
    toolResults: params.toolResults ?? [],
    retryCount: 0,
    executionMode: params.executionMode ?? "act",
  };
}

describe("realDataFinalGuard", () => {
  it("retries a casual greeting that drafted the canned no-grounded-data fallback, without repeating that sentence in the fallback", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "hows it going",
        draftText: GENERIC_NO_DATA_FALLBACK_MESSAGE,
      }),
    );

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      retryMessage: NON_ANALYTICS_FALLBACK_RETRY_MESSAGE,
      fallbackMessage: NON_ANALYTICS_FALLBACK_FINAL_MESSAGE,
    });
    expect((result as { fallbackMessage: string }).fallbackMessage).not.toBe(
      GENERIC_NO_DATA_FALLBACK_MESSAGE,
    );
  });

  it("passes through a casual greeting answered normally", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "hows it going",
        draftText: "Pretty good! What can I help you dig into?",
      }),
    );

    expect(result).toBeNull();
  });

  it("retries a data question that drafted the canned fallback with no tool results", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "what was our signup conversion last week",
        draftText: GENERIC_NO_DATA_FALLBACK_MESSAGE,
      }),
    );

    expect(result).not.toBeNull();
  });

  it("passes through a data question backed by a successful data query attempt", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "what was our signup conversion last week",
        draftText: "Signup conversion last week was 4.2%.",
        toolResults: [{ name: "bigquery", isError: false, content: "{}" }],
      }),
    );

    expect(result).toBeNull();
  });

  it("does not let the guard's own non-analytics retry turn re-trigger the analytics retry path", () => {
    expect(
      looksLikeAnalyticsDataRequest(NON_ANALYTICS_FALLBACK_RETRY_MESSAGE),
    ).toBe(false);

    const result = realDataFinalGuard(
      guardContext({
        userText: NON_ANALYTICS_FALLBACK_RETRY_MESSAGE,
        draftText: GENERIC_NO_DATA_FALLBACK_MESSAGE,
      }),
    );

    expect(result).not.toBeNull();
    expect((result as { retryMessage: string }).retryMessage).toBe(
      NON_ANALYTICS_FALLBACK_RETRY_MESSAGE,
    );
  });

  it("never engages the guard in plan mode, even with a canned-fallback draft", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "what was our signup conversion last week",
        draftText: GENERIC_NO_DATA_FALLBACK_MESSAGE,
        executionMode: "plan",
      }),
    );

    expect(result).toBeNull();
  });
});
