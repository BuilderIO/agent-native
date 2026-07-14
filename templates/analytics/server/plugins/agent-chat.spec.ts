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
  BUILT_IN_FIRST_PARTY_SOURCE_GUIDANCE,
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
    expect(guidance).toContain(BUILT_IN_FIRST_PARTY_SOURCE_GUIDANCE);
    expect(guidance).toContain(NON_ANALYTICS_REQUEST_GUIDANCE);
    expect(guidance).toContain("run one bounded aggregate");
    expect(guidance).toContain("Once it returns a valid result");
    expect(guidance).toContain("does not waive the real-data requirement");
    expect(guidance).toContain(
      "This does not replace or restrict external sources",
    );
    expect(guidance).toContain("When the user names an external provider");
  });

  it("routes built-in product metrics to the first-party query action", () => {
    expect(BUILT_IN_FIRST_PARTY_SOURCE_GUIDANCE).toContain(
      "query-agent-native-analytics",
    );
    expect(BUILT_IN_FIRST_PARTY_SOURCE_GUIDANCE).toContain(
      "Do not report the first-party source as disconnected",
    );
    expect(BUILT_IN_FIRST_PARTY_SOURCE_GUIDANCE).toContain("analytics_events");
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
        "bigquery",
        "provider-api-catalog",
        "provider-api-docs",
        "provider-api-request",
        "provider-corpus-job",
        "query-staged-dataset",
        "run-code",
        "get-code-execution",
        "hubspot-deals",
        "hubspot-records",
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

  it("keeps the first-party query action on the initial tool surface", () => {
    expect(INITIAL_TOOL_NAMES).toContain("query-agent-native-analytics");
  });
});

function userMessage(
  text: string,
): AgentLoopFinalResponseGuardContext["messages"][number] {
  return { role: "user", content: [{ type: "text", text }] };
}

function guardContext(params: {
  userText: string;
  requestText?: string;
  draftText: string;
  toolResults?: AgentLoopFinalResponseGuardContext["toolResults"];
  executionMode?: AgentLoopFinalResponseGuardContext["executionMode"];
}): AgentLoopFinalResponseGuardContext {
  const context: AgentLoopFinalResponseGuardContext & {
    requestText?: string;
  } = {
    messages: [userMessage(params.userText)],
    requestText: params.requestText ?? params.userText,
    assistantContent: [],
    text: params.draftText,
    toolCalls: [],
    toolResults: params.toolResults ?? [],
    retryCount: 0,
    executionMode: params.executionMode ?? "act",
  };
  return context;
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

  it("classifies a recovered greeting from the stable request instead of the synthetic continuation", () => {
    const internalContinuation =
      "Continue from where you left off. Internal note: The previous LLM call reached the model output-token cap before the response finished.";

    expect(looksLikeAnalyticsDataRequest(internalContinuation)).toBe(true);

    const result = realDataFinalGuard(
      guardContext({
        userText: internalContinuation,
        requestText: "hello",
        draftText: "Hi! What can I help you with?",
      }),
    );

    expect(result).toBeNull();
  });

  it("still retries a real analytics request after a synthetic continuation", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Continue from where you left off. Internal note: The previous LLM call reached the model output-token cap before the response finished.",
        requestText: "what was our signup conversion last week",
        draftText: GENERIC_NO_DATA_FALLBACK_MESSAGE,
      }),
    );

    expect(result).toMatchObject({
      maxRetries: 2,
      expandToolSurface: true,
    });
  });

  it("retries a data question that drafted the canned fallback with no tool results", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "what was our signup conversion last week",
        draftText: GENERIC_NO_DATA_FALLBACK_MESSAGE,
      }),
    );

    expect(result).toMatchObject({
      maxRetries: 2,
      expandToolSurface: true,
    });
  });

  it("routes a data question to first-party Analytics after built-in status succeeds", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "how many Builder signups did we get last week",
        draftText: GENERIC_NO_DATA_FALLBACK_MESSAGE,
        toolResults: [
          {
            name: "data-source-status",
            isError: false,
            content: JSON.stringify({
              configuredDataSources: [
                {
                  provider: "first-party",
                  label: "First-party Analytics",
                  via: "built-in",
                  queryAction: "query-agent-native-analytics",
                },
              ],
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("First-party Analytics"),
      fallbackMessage: expect.stringContaining("First-party Analytics"),
    });
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
