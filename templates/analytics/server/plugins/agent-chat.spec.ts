import { readFileSync } from "node:fs";

import type { AgentLoopFinalResponseGuardContext } from "@agent-native/core/server";
import { describe, expect, it, vi } from "vitest";

const adhocAnalysisSkill = readFileSync(
  new URL("../../.agents/skills/adhoc-analysis/SKILL.md", import.meta.url),
  "utf8",
);

const { agentChatPluginOptions, representativeAnalyticsActions } = vi.hoisted(
  () => ({
    agentChatPluginOptions: [] as Array<Record<string, unknown>>,
    representativeAnalyticsActions: {
      "query-agent-native-analytics": {
        readOnly: true,
        grounding: true,
        tool: {
          description: "Query first-party analytics",
          parameters: { type: "object", properties: {} },
        },
        run: async () => "ok",
      },
      bigquery: {
        readOnly: true,
        grounding: true,
        tool: {
          description: "Query BigQuery",
          parameters: { type: "object", properties: {} },
        },
        run: async () => "ok",
      },
      "hubspot-records": {
        readOnly: true,
        grounding: true,
        tool: {
          description: "Read HubSpot records",
          parameters: { type: "object", properties: {} },
        },
        run: async () => "ok",
      },
      // A shipped source action the guard's retired name list never named.
      prometheus: {
        readOnly: true,
        grounding: true,
        tool: {
          description: "Query Prometheus",
          parameters: { type: "object", properties: {} },
        },
        run: async () => "ok",
      },
      "list-data-dictionary": {
        readOnly: true,
        tool: {
          description: "Browse metric definitions",
          parameters: { type: "object", properties: {} },
        },
        run: async () => "ok",
      },
    },
  }),
);

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...original,
    createAgentChatPlugin: (options: Record<string, unknown>) => {
      agentChatPluginOptions.push(options);
      return () => {};
    },
  };
});

vi.mock("../../.generated/actions-registry.js", () => ({
  default: representativeAnalyticsActions,
}));

import { INITIAL_TOOL_NAMES } from "../lib/agent-chat-plan-mode";
import {
  GENERIC_NO_DATA_FALLBACK_MESSAGE,
  looksLikeAnalyticsDataRequest,
} from "../lib/real-data-actions";
import {
  analyticsDataDictionaryRoutingContext,
  analyticsSourceGuidanceOpening,
  ANALYTICS_OBSERVABILITY_INCIDENT_GUIDANCE,
  ANALYTICS_CROSS_APP_ROUTING_GUIDANCE,
  ANALYTICS_CUSTOM_BLOCK_GUIDANCE,
  ANALYTICS_BACKGROUND_RUN_NO_PROGRESS_TIMEOUT_MS,
  BOUNDED_STRUCTURED_LOOKUP_GUIDANCE,
  DASHBOARD_REFERENCE_GUIDANCE,
  BUILT_IN_FIRST_PARTY_SOURCE_GUIDANCE,
  NON_ANALYTICS_FALLBACK_FINAL_MESSAGE,
  NON_ANALYTICS_FALLBACK_RETRY_MESSAGE,
  NON_ANALYTICS_REQUEST_GUIDANCE,
  realDataFinalGuard,
} from "./agent-chat";

describe("Analytics agent Plan mode policy", () => {
  it("routes one-off stacked charts through the live embed path", () => {
    expect(adhocAnalysisSkill).toMatch(/use the live\s+`\/chart` embed/);
    expect(adhocAnalysisSkill).toMatch(
      /Do not call\s+`generate-chart` for a one-off chat result/,
    );
    expect(adhocAnalysisSkill).toContain("config.stacked: true");
    expect(adhocAnalysisSkill).not.toContain(
      "call `generate-chart` before formatting the report",
    );
  });

  it("recovers a silent background dashboard run before the long chunk timeout", () => {
    expect(ANALYTICS_BACKGROUND_RUN_NO_PROGRESS_TIMEOUT_MS).toBe(3 * 60_000);
  });

  it("injects the bounded structured lookup fast path into source guidance", () => {
    const guidance = analyticsSourceGuidanceOpening();

    expect(guidance).toContain("<data-source-guidance>");
    expect(guidance).toContain(BOUNDED_STRUCTURED_LOOKUP_GUIDANCE);
    expect(guidance).toContain(ANALYTICS_OBSERVABILITY_INCIDENT_GUIDANCE);
    expect(guidance).toContain(ANALYTICS_CROSS_APP_ROUTING_GUIDANCE);
    expect(guidance).toContain(BUILT_IN_FIRST_PARTY_SOURCE_GUIDANCE);
    expect(guidance).toContain(NON_ANALYTICS_REQUEST_GUIDANCE);
    expect(guidance).toContain("run one bounded query");
    expect(guidance).toContain("Once the query succeeds");
    expect(guidance).toContain("does not waive the real-data requirement");
    expect(guidance).toContain(
      "This does not replace or restrict external sources",
    );
    expect(guidance).toContain("When the user names an external provider");
    expect(guidance).toContain("[Connect data sources](");
    expect(guidance).toContain(
      "Chat remains available when no external data source is connected",
    );
  });

  it("keeps ordinary structured lookups on one authoritative source", () => {
    expect(BOUNDED_STRUCTURED_LOOKUP_GUIDANCE).toContain(
      "search-analytics-query-catalog",
    );
    expect(BOUNDED_STRUCTURED_LOOKUP_GUIDANCE).toContain(
      "run one bounded query",
    );
    expect(BOUNDED_STRUCTURED_LOOKUP_GUIDANCE).toContain(
      "do not by themselves make it a corpus investigation",
    );
    expect(BOUNDED_STRUCTURED_LOOKUP_GUIDANCE).toContain(
      "Never repeat an identical invalid or failed tool call",
    );
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

  it("advertises Analytics as the owner for curated first-party product metrics", () => {
    expect(ANALYTICS_CROSS_APP_ROUTING_GUIDANCE).toContain(
      "agent-native signups",
    );
    expect(ANALYTICS_CROSS_APP_ROUTING_GUIDANCE).toContain(
      "built-in first-party source and query catalog",
    );
    expect(ANALYTICS_CROSS_APP_ROUTING_GUIDANCE).toContain("call-agent");
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
      "read-only investigation tools remain available in Plan mode",
    );
    expect(ANALYTICS_OBSERVABILITY_INCIDENT_GUIDANCE).toContain(
      "run the query instead of deferring it",
    );
  });

  it("routes data-dictionary lookup on demand with compact guidance", () => {
    const context = analyticsDataDictionaryRoutingContext();

    expect(context).toContain("available through");
    expect(context).toContain("`list-data-dictionary`");
    expect(context).toContain(
      "Call `list-data-dictionary` separately only when the user asks",
    );
    expect(context).toContain("approved entries as canonical");
    expect(context.length).toBeLessThan(1_000);
  });

  it("leaves representative read-only Analytics tools available to the shared Plan-mode policy", () => {
    const pluginActions = agentChatPluginOptions[0]?.actions as Record<
      string,
      Record<string, unknown>
    >;

    for (const name of Object.keys(representativeAnalyticsActions)) {
      expect(pluginActions[name]?.readOnly).toBe(true);
      expect(pluginActions[name]).not.toHaveProperty("allowInPlanMode", false);
    }
  });
  it("keeps bulk corpus tools on the initial tool surface", () => {
    expect(INITIAL_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        "bigquery",
        "search-analytics-query-catalog",
        "search-bigquery-schema",
        "list-data-dictionary",
        "provider-api-request",
        "provider-corpus-job",
        "query-staged-dataset",
      ]),
    );
    expect(INITIAL_TOOL_NAMES).not.toEqual(
      expect.arrayContaining([
        "provider-api-catalog",
        "provider-api-docs",
        "run-code",
        "get-code-execution",
        "account-deep-dive",
        "gong-calls",
        "gong-native-insights",
        "github-repo-files",
        "hubspot-deals",
        "hubspot-records",
        "hubspot-pipelines",
        "jira-search",
        "slack-messages",
        "sentry",
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

  it("keeps dashboard replication discovery bounded and reference-only", async () => {
    expect(INITIAL_TOOL_NAMES).toContain("search-dashboard-references");
    expect(DASHBOARD_REFERENCE_GUIDANCE).toContain(
      "search-dashboard-references",
    );
    expect(DASHBOARD_REFERENCE_GUIDANCE).toContain(
      "not as proof that its source is authoritative",
    );
    const context = await (
      agentChatPluginOptions[0]?.extraContext as () => Promise<string>
    )?.();
    expect(context).toContain("DASHBOARD REFERENCE DISCOVERY");
  });

  it("keeps Brain handoff tools on the initial tool surface", async () => {
    expect(INITIAL_TOOL_NAMES).toEqual(
      expect.arrayContaining(["describe-workspace-apps", "call-agent"]),
    );

    const extraContext = agentChatPluginOptions[0]?.extraContext as
      | (() => Promise<string>)
      | undefined;
    const context = await extraContext?.();
    expect(context).toContain("Brain is the sibling app");
    expect(context).toContain("Do not use `list-extensions` to find Brain");
    expect(context).toContain("use `call-agent` with agent `brain`");
  });

  it("keeps the complete dashboard build path on the initial tool surface", () => {
    expect(INITIAL_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        "update-dashboard",
        "mutate-dashboard",
        "compose-dashboard",
        "create-extension",
        "extension-data-set",
      ]),
    );
  });

  it("tells explicit dashboard requests to finish non-destructive build steps", async () => {
    const extraContext = agentChatPluginOptions[0]?.extraContext as
      | (() => Promise<string>)
      | undefined;
    expect(extraContext).toBeDefined();
    const context = await extraContext?.();
    expect(context).toContain("EXECUTION CONTINUITY");
    expect(context).toContain("Do not ask 'want me to proceed?'");
    expect(context).toContain("APPROVED MUTATION CONTINUITY");
    expect(context).toContain("saved: true");
    expect(context).toContain("changed: true");
  });

  it("makes Custom Blocks a deliberate one-off exception to native dashboards", () => {
    expect(ANALYTICS_CUSTOM_BLOCK_GUIDANCE).toContain(
      "native dashboard panels and Data Programs first",
    );
    expect(ANALYTICS_CUSTOM_BLOCK_GUIDANCE).toContain(
      "only actions that are HTTP-mounted",
    );
    expect(ANALYTICS_CUSTOM_BLOCK_GUIDANCE).toContain(
      "never call `query-agent-native-analytics`",
    );
    expect(ANALYTICS_CUSTOM_BLOCK_GUIDANCE).toContain(
      "canonical `bigquery` action",
    );
    expect(ANALYTICS_CUSTOM_BLOCK_GUIDANCE).toContain(
      "only when the user explicitly asks",
    );
    expect(ANALYTICS_CUSTOM_BLOCK_GUIDANCE).toContain(
      "intended scope is this dashboard",
    );
    expect(ANALYTICS_CUSTOM_BLOCK_GUIDANCE).toContain("nativeGapReason");
    expect(ANALYTICS_CUSTOM_BLOCK_GUIDANCE).toContain(
      "never put prompt text, customer data",
    );
    expect(ANALYTICS_CUSTOM_BLOCK_GUIDANCE).toContain("call `connect-builder`");
    expect(ANALYTICS_CUSTOM_BLOCK_GUIDANCE).toContain(
      "preserve the existing Custom Block",
    );
    expect(ANALYTICS_CUSTOM_BLOCK_GUIDANCE).not.toContain(
      "automatically create",
    );
  });

  it("explicitly keeps extension creation enabled for Analytics Custom Blocks", async () => {
    const { readFile } = await import("node:fs/promises");
    const [agentChatSource, coreRoutesSource] = await Promise.all([
      readFile(new URL("./agent-chat.ts", import.meta.url), "utf8"),
      readFile(new URL("./core-routes.ts", import.meta.url), "utf8"),
    ]);

    expect(agentChatSource).toContain("extensionTools: true");
    expect(coreRoutesSource).toContain("extensionTools: true");
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
  it("accepts a grounded answer from a source action no name list ever enumerated", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "How many sessions did we record in the last 24 hours?",
        draftText:
          "We recorded 41,208 sessions in the last 24 hours, from Prometheus (24h range, 1m step).",
        toolResults: [
          {
            name: "prometheus",
            isError: false,
            content:
              '{"resultType":"matrix","data":{"result":[{"values":[]}]}}',
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("still rejects a metric answer whose only tool call was a metadata read", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "How many sessions did we record in the last 24 hours?",
        draftText: "We recorded 41,208 sessions in the last 24 hours.",
        toolResults: [
          {
            name: "list-data-dictionary",
            isError: false,
            content: '{"entries":[{"name":"p95_latency"}]}',
          },
        ],
      }),
    );

    expect(result).not.toBeNull();
  });

  it("retries a dashboard build that pauses after creating an extension shell", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Build a dashboard for Intuit Fusion errors",
        draftText:
          "I created the dashboard shell. The table is empty until the users are seeded. Want me to proceed with seeding the 981 users now?",
        toolResults: [
          {
            name: "create-extension",
            isError: false,
            content: '{"id":"fusion-errors"}',
          },
          {
            name: "bigquery",
            isError: false,
            content: '{"rows":[{"user":"a"}]}',
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      expandToolSurface: true,
      maxRetries: 2,
      retryMessage: expect.stringContaining("same turn"),
    });
  });

  it("does not turn a completed dashboard save into another build pass", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Build a dashboard for Intuit Fusion errors",
        draftText:
          "The dashboard is saved with its requested panels. Would you like me to add another view?",
        toolResults: [
          {
            name: "update-dashboard",
            isError: false,
            content: '{"dashboardId":"fusion-errors"}',
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

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

  it("does not let A2A transport hints trigger corpus or dashboard fallbacks", () => {
    const request =
      "Choose one useful current customer metric and return its value.";
    const transportHint =
      "If you create a dashboard, return a concise answer instead of full transcripts.";
    const tagged = `${request}\n\n<a2a-caller-hint>\n${transportHint}\n</a2a-caller-hint>`;
    const legacy = `${request}\n\n[Note: this request comes from another app via A2A. ${transportHint}]`;

    for (const userText of [tagged, legacy]) {
      const result = realDataFinalGuard(
        guardContext({
          userText,
          draftText:
            "Daily active customers: 123 for 2026-07-29 UTC. Source: HubSpot. This is a bounded current metric.",
          toolResults: [
            {
              name: "hubspot-records",
              isError: false,
              content: '{"records":[{"count":123}]}',
            },
          ],
        }),
      );

      expect(result).toBeNull();
    }
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
      fallbackMessage: expect.stringContaining("[connect data sources]("),
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

  it("does not mistake the built-in source for an external connection", () => {
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
      retryMessage: expect.stringContaining("query-agent-native-analytics"),
      fallbackMessage: expect.not.stringContaining("Connect data sources"),
    });
  });

  it("does not demand a connect-sources link when data-source-status never ran", () => {
    // A draft that ends in a question counts as a safe no-data response, and
    // this turn only saved a panel. Nothing here shows a source is missing, so
    // the guard must not instruct the model to say one is unavailable — the
    // model recognizes that instruction as a prompt injection and refuses it
    // out loud to the user.
    const result = realDataFinalGuard(
      guardContext({
        userText: "yes add conversion rate",
        draftText:
          "Which denominator do you want for that rate — all visitors, or only the AN-tagged ones?",
      }),
    );

    expect(result).toBeNull();
  });

  it("still reports a real query failure without inventing a missing source", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "what was our signup conversion last week",
        draftText: "Signup conversion was 4.2% last week.",
        toolResults: [
          {
            name: "bigquery",
            isError: true,
            content: "Syntax error at [3:9]",
          },
        ],
      }),
    );

    expect((result as { retryMessage: string }).retryMessage).toContain(
      "Syntax error",
    );
    expect((result as { retryMessage: string }).retryMessage).not.toContain(
      "which external source is missing",
    );
  });

  it("accepts the action's string setup link without overwriting it with the settings path", () => {
    const setupLink = "/_agent-native/open?app=analytics&view=data-sources";
    const result = realDataFinalGuard(
      guardContext({
        userText: "what were our Stripe payments last week",
        draftText:
          "I can't retrieve Stripe payments because that source is not configured yet.",
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
                },
              ],
              dataSourcesSetupLink: setupLink,
              settingsPath: "/data-sources",
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(setupLink),
      fallbackMessage: expect.stringContaining(setupLink),
    });
  });

  it("guides a missing-external-source response to the real data-source setup link", () => {
    const setupLink = "/_agent-native/open?app=analytics&view=data-sources";
    const result = realDataFinalGuard(
      guardContext({
        userText: "what were our Stripe payments last week",
        draftText:
          "I can't retrieve Stripe payments because that source is not configured yet.",
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
                },
              ],
              dataSourcesLink: {
                url: setupLink,
                label: "Connect data sources",
              },
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(setupLink),
      fallbackMessage: expect.stringContaining(setupLink),
    });
  });

  it("uses a focused native HubSpot setup link instead of the generic integrations page", () => {
    const genericSetupLink =
      "/_agent-native/open?app=analytics&view=data-sources";
    const hubspotSetupLink =
      "/_agent-native/open?app=analytics&view=data-sources&to=%2Fdata-sources%3Fsource%3Dhubspot%26returnTo%3Dask";
    const result = realDataFinalGuard(
      guardContext({
        userText: "show me our HubSpot pipeline",
        draftText: "HubSpot is not connected yet.",
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
                },
              ],
              providers: [
                {
                  provider: "hubspot",
                  label: "HubSpot",
                  configured: false,
                  setupLink: hubspotSetupLink,
                },
              ],
              dataSourcesSetupLink: genericSetupLink,
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(
        `[Connect HubSpot](${hubspotSetupLink})`,
      ),
      fallbackMessage: expect.stringContaining(
        `[Connect HubSpot](${hubspotSetupLink})`,
      ),
    });
    expect((result as { retryMessage: string }).retryMessage).not.toContain(
      `[Connect data sources](${genericSetupLink})`,
    );
  });

  it("does not claim an unreadable provider is disconnected", () => {
    const hubspotSetupLink =
      "/_agent-native/open?app=analytics&view=data-sources&to=%2Fdata-sources%3Fsource%3Dhubspot%26returnTo%3Dask";
    const result = realDataFinalGuard(
      guardContext({
        userText: "show me our HubSpot pipeline",
        draftText: "I can't verify HubSpot because its status is unreadable.",
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
                },
              ],
              providers: [
                {
                  provider: "hubspot",
                  label: "HubSpot",
                  configured: null,
                  setupLink: hubspotSetupLink,
                },
              ],
              workspaceConnections: {
                appId: "analytics",
                available: true,
                error: null,
                providers: [],
              },
            }),
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("uses the most specific matching source that has a focused setup link", () => {
    const genericSetupLink =
      "/_agent-native/open?app=analytics&view=data-sources";
    const hubspotCrmSetupLink =
      "/_agent-native/open?app=analytics&view=data-sources&to=%2Fdata-sources%3Fsource%3Dhubspot-crm";
    const result = realDataFinalGuard(
      guardContext({
        userText: "show me our HubSpot CRM pipeline",
        draftText: "HubSpot CRM is not connected yet.",
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
                },
              ],
              providers: [
                {
                  provider: "hubspot",
                  label: "HubSpot",
                  configured: false,
                },
                {
                  provider: "hubspot-crm",
                  label: "HubSpot CRM",
                  configured: false,
                  setupLink: hubspotCrmSetupLink,
                },
              ],
              dataSourcesSetupLink: genericSetupLink,
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(
        `[Connect HubSpot CRM](${hubspotCrmSetupLink})`,
      ),
      fallbackMessage: expect.stringContaining(
        `[Connect HubSpot CRM](${hubspotCrmSetupLink})`,
      ),
    });
  });

  it("does not demand a connect-sources link when the status result could not be read", () => {
    // A failed workspace-connection lookup hides exactly the workspace-held
    // connections it would take to prove a provider is missing, so the empty
    // provider list is "we could not look", not "nothing is connected".
    const result = realDataFinalGuard(
      guardContext({
        userText: "what were our HubSpot deals last week",
        draftText:
          "I can't retrieve HubSpot deals because that source is not configured yet.",
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
                },
              ],
              workspaceConnections: {
                appId: "analytics",
                available: false,
                error: "org_members lookup failed",
                providers: [],
              },
            }),
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("accepts a contextual missing-source response when it includes the setup link", () => {
    const setupLink = "/_agent-native/open?app=analytics&view=data-sources";
    const result = realDataFinalGuard(
      guardContext({
        userText: "what were our Stripe payments last week",
        draftText: `Stripe is not connected yet. [Connect data sources](${setupLink}) and I can pull those payments in.`,
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
                },
              ],
              dataSourcesLink: { url: setupLink },
            }),
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("requires setup guidance when the requested provider is missing alongside another connection", () => {
    const setupLink = "/_agent-native/open?app=analytics&view=data-sources";
    const result = realDataFinalGuard(
      guardContext({
        userText: "what were our Stripe payments last week",
        draftText:
          "I can't retrieve Stripe payments because that source is not configured yet.",
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
                },
                { provider: "hubspot", label: "HubSpot", via: "oauth" },
              ],
              dataSourcesSetupLink: setupLink,
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(setupLink),
      fallbackMessage: expect.stringContaining(setupLink),
    });
  });

  it("recognizes providers from the complete source status catalog", () => {
    const setupLink = "/_agent-native/open?app=analytics&view=data-sources";
    const result = realDataFinalGuard(
      guardContext({
        userText: "how many GitHub issues did we close last week",
        draftText: "GitHub is not connected yet.",
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
                },
                { provider: "hubspot", label: "HubSpot", via: "oauth" },
              ],
              providers: [
                { provider: "first-party", configured: true },
                { provider: "github", label: "GitHub", configured: false },
                { provider: "hubspot", label: "HubSpot", configured: true },
              ],
              dataSourcesSetupLink: setupLink,
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(setupLink),
      fallbackMessage: expect.stringContaining(setupLink),
    });
  });

  it("does not accept a bare data-sources route instead of the generated setup link", () => {
    const setupLink = "/_agent-native/open?app=analytics&view=data-sources";
    const result = realDataFinalGuard(
      guardContext({
        userText: "what were our Stripe payments last week",
        draftText:
          "Stripe is not connected yet. [Connect data sources](/data-sources)",
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
                },
              ],
              dataSourcesSetupLink: setupLink,
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(setupLink),
      fallbackMessage: expect.stringContaining(setupLink),
    });
  });

  it("rejects a foreign markdown destination that only contains the setup link", () => {
    const setupLink = "/_agent-native/open?app=analytics&view=data-sources";
    const result = realDataFinalGuard(
      guardContext({
        userText: "what were our Stripe payments last week",
        draftText: `Stripe is not connected yet. [Connect data sources](https://evil.example/?next=${setupLink})`,
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
                },
              ],
              dataSourcesSetupLink: setupLink,
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(setupLink),
      fallbackMessage: expect.stringContaining(setupLink),
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
