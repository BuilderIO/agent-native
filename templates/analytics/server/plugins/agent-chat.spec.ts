import { readFileSync } from "node:fs";

import type { AgentLoopFinalResponseGuardContext } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const adhocAnalysisSkill = readFileSync(
  new URL("../../.agents/skills/adhoc-analysis/SKILL.md", import.meta.url),
  "utf8",
);
const accountHealthSkill = readFileSync(
  new URL("../../.agents/skills/account-health/SKILL.md", import.meta.url),
  "utf8",
);
const readMarkdown = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8").replace(
    /\s+/g,
    " ",
  );
const agentsGuide = readMarkdown("../../AGENTS.md");
const dashboardSkill = readMarkdown(
  "../../.agents/skills/dashboard-management/SKILL.md",
);
const customBlocksSkill = readMarkdown(
  "../../.agents/skills/custom-blocks/SKILL.md",
);
const incidentSkill = readMarkdown(
  "../../.agents/skills/incident-investigation/SKILL.md",
);
const analysisWorkspaceSkill = readMarkdown(
  "../../.agents/skills/analysis-workspace/SKILL.md",
);

const {
  agentChatPluginOptions,
  getRequestRunContext,
  getRequestUserEmail,
  getRequestOrgId,
  enqueueAnalyticsMemoryCapture,
  representativeAnalyticsActions,
  retrieveAnalyticsPromptReferences,
  summarizeAnalyticsRun,
  track,
} = vi.hoisted(() => ({
  agentChatPluginOptions: [] as Array<Record<string, unknown>>,
  getRequestRunContext: vi.fn((): Record<string, any> | null => null),
  getRequestUserEmail: vi.fn(() => "owner@example.test"),
  getRequestOrgId: vi.fn(() => null),
  enqueueAnalyticsMemoryCapture: vi.fn(async () => true),
  retrieveAnalyticsPromptReferences: vi.fn(),
  summarizeAnalyticsRun: vi.fn(
    (input: { preloadedReferenceCount: number }) => ({
      preloaded_reference_count: input.preloadedReferenceCount,
    }),
  ),
  track: vi.fn(),
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
    "get-monitor": {
      readOnly: true,
      grounding: true,
      tool: { description: "Get monitor configuration", parameters: {} },
      run: async () => "ok",
    },
    "list-connected-database-tables": {
      readOnly: true,
      grounding: true,
      tool: { description: "Inspect database schema", parameters: {} },
      run: async () => "ok",
    },
    "test-custom-api-connection": {
      readOnly: true,
      grounding: true,
      tool: { description: "Test a provider connection", parameters: {} },
      run: async () => "ok",
    },
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
}));

vi.mock("../lib/analytics-agent-context", () => ({
  retrieveAnalyticsPromptReferences,
  summarizeAnalyticsRun,
}));
vi.mock("../lib/analytics-memory-capture.js", () => ({
  enqueueAnalyticsMemoryCapture,
}));

vi.mock("@agent-native/core/tracking", () => ({ track }));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...original,
    getRequestRunContext: () => getRequestRunContext(),
    getRequestUserEmail: () => getRequestUserEmail(),
    getRequestOrgId: () => getRequestOrgId(),
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
  stripInjectedAnalyticsGuardContext,
} from "../lib/real-data-actions";
import {
  ANALYTICS_BACKGROUND_RUN_NO_PROGRESS_TIMEOUT_MS,
  ANALYTICS_PROMPT_RULES,
  analyticsExtraContext,
  NON_ANALYTICS_FALLBACK_FINAL_MESSAGE,
  NON_ANALYTICS_FALLBACK_RETRY_MESSAGE,
  realDataFinalGuard,
} from "./agent-chat";

describe("Analytics prompt-reference preparation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips catalog and embedding retrieval before background dispatch", async () => {
    const prepareRequest = agentChatPluginOptions[0]?.prepareRequest as (
      details: Record<string, unknown>,
    ) => Promise<unknown>;

    await prepareRequest({
      ownerEmail: "owner@example.test",
      requestContext: "Current request: count active users",
      contextPrefetchDeadlineAt: Date.now() + 1_300,
      dispatchToBackground: true,
    });

    expect(retrieveAnalyticsPromptReferences).not.toHaveBeenCalled();
  });

  it.each([
    ["durable worker", { isBackgroundWorker: true }],
    [
      "server continuation",
      { isBackgroundWorker: true, internalContinuation: true },
    ],
  ] as const)(
    "retrieves Analytics references in a %s request",
    async (_, requestOptions) => {
      const candidate = {
        id: "analytics-reference-1",
        description: "Active users definition",
        metadata: { kind: "analytics-reference" },
        name: "Active users",
        scope: "analytics-catalog",
        content: "Metric: active users.",
      };
      vi.mocked(retrieveAnalyticsPromptReferences).mockResolvedValue({
        jevPromptCandidates: [candidate],
        jevFallbackCandidateIds: [candidate.id],
        prefetchStatus: "ok",
      });
      const prepareRequest = agentChatPluginOptions[0]?.prepareRequest as (
        details: Record<string, unknown>,
      ) => Promise<unknown>;

      const result = await prepareRequest({
        ownerEmail: "owner@example.test",
        message: "count active users",
        requestContext: "Current request: count active users",
        contextPrefetchDeadlineAt: Date.now() + 1_300,
        dispatchToBackground: false,
        ...requestOptions,
      });

      expect(retrieveAnalyticsPromptReferences).toHaveBeenCalledOnce();
      expect(result).toEqual({
        jevPromptCandidates: [candidate],
        jevFallbackCandidateIds: [candidate.id],
        status: "ok",
      });
    },
  );

  it("uses the bounded recent-user request and shared deadline for retrieval", async () => {
    const prepareRequest = agentChatPluginOptions[0]?.prepareRequest as (
      details: Record<string, unknown>,
    ) => Promise<unknown>;
    const contextPrefetchDeadlineAt = Date.now() + 1_300;

    vi.mocked(retrieveAnalyticsPromptReferences).mockResolvedValue({
      jevPromptCandidates: [],
      jevFallbackCandidateIds: [],
      prefetchStatus: "empty",
    });

    await prepareRequest({
      ownerEmail: "owner@example.test",
      message: "count active users",
      requestContext:
        "Recent user requests:\nUser: prior question\n\nCurrent request: count active users",
      contextPrefetchDeadlineAt,
      dispatchToBackground: false,
    });

    expect(retrieveAnalyticsPromptReferences).toHaveBeenCalledWith({
      request:
        "Recent user requests:\nUser: prior question\n\nCurrent request: count active users",
      email: "owner@example.test",
      orgId: null,
      deadlineAt: contextPrefetchDeadlineAt,
    });
  });

  it.each(["hello", "thanks!", "👍", "?"])(
    "does not spend the preload budget on the trivial turn %j",
    async (message) => {
      const prepareRequest = agentChatPluginOptions[0]?.prepareRequest as (
        details: Record<string, unknown>,
      ) => Promise<unknown>;

      await expect(
        prepareRequest({
          ownerEmail: "owner@example.test",
          message,
          requestContext: `Current request:\n${message}`,
          contextPrefetchDeadlineAt: Date.now() + 1_300,
          dispatchToBackground: false,
        }),
      ).resolves.toBeUndefined();

      expect(retrieveAnalyticsPromptReferences).not.toHaveBeenCalled();
    },
  );

  it.each([
    "what's our NRR",
    "Q3 bookings",
    "pull the renewal list for Q4",
    "churned logos last quarter",
    "who owns Acme",
    "same but for last quarter",
    "what about EMEA?",
    "split it by owner",
    "change it to last quarter",
    "ok",
    // An artifact edit may still change what is measured; the relevance bar
    // keeps unrelated references out.
    "make it blue",
    "rename this chart",
    "Remove the legend from this panel",
    "resize the chart by 20%",
    "change this chart to paid signups",
    "switch this panel to net revenue",
    "set the chart to EMEA",
    "update the chart to use the orders table",
    "remove test accounts from this chart",
    "turn off bot traffic on this chart",
    "make it ARR",
    "make this chart about retention",
    "fix the revenue numbers on this chart",
    "update the dashboard with the latest numbers",
    "add revenue panel to this dashboard",
    "change the dashboard to show page views",
    "switch the chart to page views",
  ])("retrieves references for %j", async (message) => {
    vi.mocked(retrieveAnalyticsPromptReferences).mockResolvedValue({
      jevPromptCandidates: [],
      jevFallbackCandidateIds: [],
      prefetchStatus: "empty",
    });
    const prepareRequest = agentChatPluginOptions[0]?.prepareRequest as (
      details: Record<string, unknown>,
    ) => Promise<unknown>;

    await prepareRequest({
      ownerEmail: "owner@example.test",
      message,
      requestContext: `Current request:\n${message}`,
      contextPrefetchDeadlineAt: Date.now() + 1_300,
      dispatchToBackground: false,
    });

    expect(retrieveAnalyticsPromptReferences).toHaveBeenCalledOnce();
  });

  it.each(["timed_out", "failed", "empty"] as const)(
    "reports a %s preload to core instead of returning it as nothing relevant",
    async (prefetchStatus) => {
      vi.mocked(retrieveAnalyticsPromptReferences).mockResolvedValue({
        jevPromptCandidates: [],
        jevFallbackCandidateIds: [],
        prefetchStatus,
      });
      const prepareRequest = agentChatPluginOptions[0]?.prepareRequest as (
        details: Record<string, unknown>,
      ) => Promise<unknown>;

      const result = await prepareRequest({
        ownerEmail: "owner@example.test",
        message: "what's our NRR",
        requestContext: "Current request:\nwhat's our NRR",
        contextPrefetchDeadlineAt: Date.now() + 1_300,
        dispatchToBackground: false,
      });

      expect(result).toEqual({
        jevPromptCandidates: [],
        jevFallbackCandidateIds: [],
        status: prefetchStatus,
      });
    },
  );

  it("does not let a context note core adds to the turn change how the ask is classified", () => {
    const note =
      "<context-note>Preloaded references were unavailable this turn.</context-note>";

    expect(
      stripInjectedAnalyticsGuardContext(`what's our NRR\n\n${note}`),
    ).toBe("what's our NRR");
  });

  it.each(["ok", "empty", "timed_out", "failed"] as const)(
    "reports a %s preload on the outcome event",
    async (prefetch) => {
      getRequestRunContext.mockReturnValue({
        isBackgroundWorker: true,
        contextStatus: { prefetch },
      });
      const onAgentRunComplete = agentChatPluginOptions[0]
        ?.onAgentRunComplete as (
        scope: unknown,
        run: { threadId: string; events: unknown[] },
      ) => Promise<void>;

      await onAgentRunComplete(null, { threadId: "thread-1", events: [] });

      expect(summarizeAnalyticsRun).toHaveBeenCalledWith(
        expect.objectContaining({ prefetchStatus: prefetch }),
      );
    },
  );

  it("marks a run that reported no preload status instead of calling it empty", async () => {
    getRequestRunContext.mockReturnValue({ isBackgroundWorker: true });
    const onAgentRunComplete = agentChatPluginOptions[0]
      ?.onAgentRunComplete as (
      scope: unknown,
      run: { threadId: string; events: unknown[] },
    ) => Promise<void>;

    await onAgentRunComplete(null, { threadId: "thread-1", events: [] });

    expect(summarizeAnalyticsRun).toHaveBeenCalledWith(
      expect.objectContaining({ prefetchStatus: "unrecorded" }),
    );
  });

  it("does not spend the preload budget in the foreground before background dispatch", async () => {
    const prepareRequest = agentChatPluginOptions[0]?.prepareRequest as (
      details: Record<string, unknown>,
    ) => Promise<unknown>;

    await prepareRequest({
      ownerEmail: "owner@example.test",
      requestContext: "Current request: count active users",
      contextPrefetchDeadlineAt: Date.now() + 1_300,
      dispatchToBackground: true,
    });

    expect(retrieveAnalyticsPromptReferences).not.toHaveBeenCalled();
  });

  it("reports preloaded references in the worker completion event", async () => {
    const context = {
      isBackgroundWorker: true,
      analyticsJevPrefetch: { preloadedReferenceCount: 2 },
    };
    getRequestRunContext.mockReturnValue(context);
    const onAgentRunComplete = agentChatPluginOptions[0]
      ?.onAgentRunComplete as (
      scope: unknown,
      run: { events: unknown[] },
    ) => Promise<void>;
    const run = { threadId: "thread-1", events: [] };

    await onAgentRunComplete(null, run);

    expect(track).toHaveBeenCalledWith("analytics_agent_run_outcome", {
      preloaded_reference_count: 2,
      memory_capture_queued: 1,
    });
    expect(enqueueAnalyticsMemoryCapture).toHaveBeenCalledWith({
      owner: "owner@example.test",
      orgId: null,
      threadId: "thread-1",
    });
    expect(summarizeAnalyticsRun).toHaveBeenCalledWith({
      events: run.events,
      groundingActionNames: expect.any(Array),
      preloadedReferenceCount: 2,
      prefetchStatus: "unrecorded",
    });
  });
});

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

  it("renders every always-on rule inside one guidance block", () => {
    const context = analyticsExtraContext();

    expect(context.startsWith("<data-source-guidance>")).toBe(true);
    expect(context.endsWith("</data-source-guidance>")).toBe(true);
    for (const rule of ANALYTICS_PROMPT_RULES) {
      expect(context).toContain(rule.text);
    }
    expect(new Set(ANALYTICS_PROMPT_RULES.map((rule) => rule.id)).size).toBe(
      ANALYTICS_PROMPT_RULES.length,
    );
  });

  it("keeps Analytics feedback acknowledgments brief", () => {
    expect(ruleText("acknowledgments")).toContain(
      "at most one brief acknowledgment",
    );
    expect(ruleText("acknowledgments")).toContain("Avoid stacked compliments");
    expect(ruleText("acknowledgments")).toContain(
      "address the feedback directly",
    );
  });

  it("hands the plugin the same rules as extraContext", async () => {
    const extraContext = agentChatPluginOptions[0]?.extraContext as
      | (() => Promise<string> | string)
      | undefined;

    expect(await extraContext?.()).toBe(analyticsExtraContext());
  });

  const ruleText = (id: string) => {
    const rule = ANALYTICS_PROMPT_RULES.find((entry) => entry.id === id);
    if (!rule) throw new Error(`missing prompt rule ${id}`);
    return rule.text;
  };

  it("keeps ordinary lookups on one authoritative source", () => {
    expect(ruleText("references")).toContain("find-data");
    expect(ruleText("references")).toContain(
      "do not by themselves make a question a corpus investigation",
    );
    expect(ruleText("failed-calls")).toContain(
      "never repeat an identical failed call",
    );
    expect(ruleText("real-data")).toContain("live data-source query");
    expect(ruleText("sources")).toContain("authoritative for the turn");
  });

  it("keeps every clause of the understand-the-ask rule", () => {
    const rule = ruleText("understand-the-ask");

    for (const clause of [
      '"this", "that", and "it"',
      "`selected-object`",
      "keep its source and business logic and change only filters and window",
      "certified over favorite over unmarked",
      "ask exactly one `ask-question` with a recommended default",
      "pick the default and label it",
      '"Reading this as: <metric definition>, <window>, <filters>, <source>"',
      '"Changing <panel title> on <dashboard>"',
      "A source the user names wins",
      "Never ask the user for dataset, table, column, or SQL identifiers",
    ]) {
      expect(rule).toContain(clause);
    }
  });

  it("keeps export delivery and the deferred-tool shortcut in the skills rule", () => {
    const skills = ruleText("skills");

    expect(skills).toContain("Download CSV on compact tables");
    expect(skills).toContain("never finish with only a path");
    for (const tool of [
      "update-dashboard",
      "compose-dashboard",
      "generate-chart",
      "show-workspace-file",
      "provider-api-request",
    ]) {
      expect(skills).toContain(`\`${tool}\``);
    }
    expect(skills).toContain("one `tool-search` call");
  });

  it("tells a small panel edit to skip the skill read everywhere it is stated", () => {
    expect(ruleText("skills")).toContain(
      "a small edit of one existing panel needs no skill",
    );
    expect(agentsGuide).toContain("no skill read is needed");
    expect(dashboardSkill).toContain(
      "a small edit of one existing panel needs no skill",
    );
  });

  it("does not send a lean-path agent to a block that is never injected", () => {
    for (const text of [
      dashboardSkill,
      readMarkdown("../../.agents/skills/cross-source-analysis/SKILL.md"),
      readMarkdown("../../.agents/skills/adhoc-analysis/SKILL.md"),
    ]) {
      expect(text).not.toContain("injected `<data-dictionary>`");
    }
  });

  it("routes built-in product metrics to the first-party query action", () => {
    expect(ruleText("sources")).toContain("query-agent-native-analytics");
    expect(ruleText("sources")).toContain("never call it disconnected");
    expect(ruleText("sources")).toContain("[Connect data sources](");
  });

  it("routes internal usage and sibling-app questions without user-supplied SQL", () => {
    const routing = ruleText("workspace-routing");

    expect(routing).toContain("agent-native signups");
    expect(routing).toContain("built-in source and query catalog");
    expect(routing).toContain("list-dispatch-usage-metrics");
    expect(routing).toContain(
      "Do not ask for a user export or BigQuery schema",
    );
    expect(routing).toContain("never substitute workspace metrics");
    expect(routing).toContain("`call-agent` with agent `brain`");
    expect(routing).toContain("Brain is not in `list-extensions`");
    expect(
      looksLikeAnalyticsDataRequest(
        "Pull AI credit usage and branch creation data by user for each month",
      ),
    ).toBe(true);
  });

  it("tells explicit dashboard requests to finish non-destructive build steps", () => {
    const builds = ruleText("dashboard-builds");

    expect(builds).toContain("Do not ask 'want me to proceed?'");
    expect(builds).toContain("its dashboard id is authoritative");
  });

  it("routes each moved procedure to a skill the runtime agent can read", () => {
    const skills = ruleText("skills");

    for (const skill of [
      "dashboard-management",
      "custom-blocks",
      "account-health",
      "incident-investigation",
      "analysis-workspace",
    ]) {
      expect(skills).toContain(`\`${skill}\``);
    }
  });

  it("states the dashboard verification invariant once, in AGENTS.md", () => {
    expect(agentsGuide).toContain(
      "A dashboard edit is done only when `mutate-dashboard` returns `verified: true`.",
    );
    expect(agentsGuide).toContain("call `inspect-dashboard-panel`");
    expect(analyticsExtraContext()).not.toContain("verified: true");
    expect(agentsGuide).not.toMatch(/run it once,? and stop/i);
    expect(dashboardSkill).toContain("only `verified: true` is");
  });

  it("keeps the dashboard procedures in the dashboard-management skill", () => {
    expect(dashboardSkill).toContain('`panelIds: ["panel-id"]`');
    expect(dashboardSkill).toContain("Ignored missing result columns");
    expect(dashboardSkill).toContain("`config.yKeys`");
    expect(dashboardSkill).toContain('`chartType: "combo"`');
    expect(dashboardSkill).toContain("remove `pivot`");
    expect(dashboardSkill).toContain(
      "Replicating Or Adapting Another Dashboard",
    );
    expect(dashboardSkill).not.toContain("reliable-mutations");
  });

  it("moves Custom Block rules into a skill and keeps native panels first", () => {
    expect(customBlocksSkill).toContain(
      "native dashboard panels and Data Programs first",
    );
    expect(customBlocksSkill).toContain("only actions that are HTTP-mounted");
    expect(customBlocksSkill).toContain(
      "never call `query-agent-native-analytics`",
    );
    expect(customBlocksSkill).toContain("canonical `bigquery` action");
    expect(customBlocksSkill).toContain("only when the user explicitly asks");
    expect(customBlocksSkill).toContain("intended scope is this dashboard");
    expect(customBlocksSkill).toContain("nativeGapReason");
    expect(customBlocksSkill).toContain("never put prompt text, customer data");
    expect(customBlocksSkill).toContain("call `connect-builder`");
    expect(customBlocksSkill).toContain("preserve the existing Custom Block");
    expect(customBlocksSkill).not.toContain("automatically create");
  });

  it("guards named account health against scope and metric-definition drift", () => {
    const normalized = accountHealthSkill.replace(/\s+/g, " ");
    for (const phrase of [
      "lookup key, not as proof",
      "mixed organization IDs",
      "deprecated or retired",
      "current partial-period snapshot",
      "total distinct contracted/eligible users",
      "utilization at or above 100%",
      "each requested product or feature dimension separately",
    ]) {
      expect(normalized).toContain(phrase);
    }
  });

  it("keeps account-health guidance organization- and provider-neutral", () => {
    expect(accountHealthSkill).not.toMatch(
      /Builder|Fusion|enterprise_pageview_utilization|monthly_pageviews_and_bandwidth_by_org/i,
    );
  });

  it("discovers incident sessions without requiring a JavaScript error count", () => {
    for (const phrase of [
      "Do not require `hasErrors=true` for this initial lookup",
      "agent_chat_stuck_detected",
      "call `create-session-replay-agent-link` first",
      "detailed error text, stacks, request metadata",
      "remain available in Plan mode",
      "run the query instead of deferring it",
    ]) {
      expect(incidentSkill).toContain(phrase);
    }
  });

  it("delivers requested files in the same turn through the workspace skill", () => {
    expect(analysisWorkspaceSkill).toContain("`show-workspace-file`");
    expect(analysisWorkspaceSkill).toContain(
      "never an error or failed response",
    );
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

  it("hands the plugin the receipt-aware guard", () => {
    expect(agentChatPluginOptions[0]?.finalResponseGuard).toBe(
      realDataFinalGuard,
    );
  });

  it("starts with the core dashboard and query tools, leaving heavyweights lazy", () => {
    expect(INITIAL_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        "get-sql-dashboard",
        "mutate-dashboard",
        "inspect-dashboard-panel",
        "search-dashboard-references",
        "find-data",
        "query-agent-native-analytics",
        "bigquery",
        "search-bigquery-schema",
        "view-screen",
        "call-agent",
      ]),
    );
    for (const lazy of [
      "provider-api-request",
      "provider-corpus-job",
      "query-staged-dataset",
      "update-dashboard",
      "compose-dashboard",
      "generate-chart",
      "create-extension",
      "update-extension",
      "show-workspace-file",
      "list-session-recordings",
      "list-error-issues",
      "run-code",
      "provider-api-catalog",
      "account-deep-dive",
      "gong-calls",
    ]) {
      expect(INITIAL_TOOL_NAMES).not.toContain(lazy);
    }
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

  it("retries a schema request through configured discovery instead of asking the user for table names", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Pull AI credit usage and branch creation data by user for each month",
        draftText:
          "Could you provide the BigQuery dataset name, table names, column names, or the exact SQL query?",
      }),
    );

    expect(result).toMatchObject({
      maxRetries: 2,
      expandToolSurface: true,
      retryMessage: expect.stringContaining("search-bigquery-schema"),
    });
    expect((result as { retryMessage: string }).retryMessage).toContain(
      "Do not ask the user for warehouse schema identifiers",
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

  it("lets a data question through when the draft makes no analytics claim and no tool ran", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was our signup conversion last week?",
        draftText:
          "I'd want to double check the exact denominator before stating a rate here.",
      }),
    );

    expect(result).toBeNull();
  });

  it("still retries a data question with a numeric claim and no tool, carrying an unverified draft prefix", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was our signup conversion last week?",
        draftText: "Signup conversion was 4.2% last week.",
      }),
    );

    expect(result).toMatchObject({
      maxRetries: 2,
      expandToolSurface: true,
      exhaustedDraftPrefix: expect.stringContaining("Unverified"),
    });
  });

  it("drops an unscoped absence claim after corpus retries are exhausted", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          'Find any closed won deal in HubSpot where products = "fusion", then for all those deals look through all Gong call transcripts after close and let me know if you surface anything around Figma MCP.',
        draftText: "I found zero mentions.",
        toolResults: [{ name: "bigquery", isError: false, content: "[]" }],
      }),
    );

    expect(result).toMatchObject({
      maxRetries: 2,
      expandToolSurface: true,
      fallbackMessage: expect.stringContaining("exact inspected count"),
    });
    expect(result).not.toHaveProperty("exhaustedDraftPrefix");
  });

  it("treats a completed catalog/dashboard-reference search as discovery, not a dead end", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was our signup conversion last week?",
        draftText: "Signup conversion was 4.2% last week.",
        toolResults: [
          {
            name: "search-analytics-query-catalog",
            isError: false,
            content: '[{"id":"conversion-dashboard"}]',
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      maxRetries: 2,
      expandToolSurface: true,
      retryMessage: expect.stringContaining(
        "You already ran data-reference discovery",
      ),
      exhaustedDraftPrefix: expect.stringContaining("Unverified"),
    });
    const { retryMessage, fallbackMessage, exhaustedDraftPrefix } = result as {
      retryMessage: string;
      fallbackMessage: string;
      exhaustedDraftPrefix: string;
    };
    expect(retryMessage).not.toMatch(/no match|nothing (was )?found/i);
    expect(fallbackMessage).not.toContain("[connect data sources](");
    expect(fallbackMessage).not.toContain("Connect data sources");
    expect(exhaustedDraftPrefix).not.toContain("connect the missing source");
  });

  it("does not send a completed create-extension turn into the template-clone retry", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Create an extension showing weekly signups by plan.",
        draftText:
          "Done — I created the extension and embedded it as a panel on the Growth dashboard.",
        toolResults: [
          {
            name: "create-extension",
            isError: false,
            content: '{"id":"ext-weekly-signups"}',
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("does not discard a completed extension-update summary as an ungrounded analytics answer", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "How many signups did we get this week?",
        draftText:
          "Done — I switched the extension display window from 7 days to 30 days.",
        toolResults: [
          {
            name: "update-extension",
            isError: false,
            content: '{"id":"signups-panel"}',
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("still retries a mutation-turn draft that also states an invented metric", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "How many signups did we get this week?",
        draftText:
          "Done — I updated the extension; it now shows 1,204 signups this week.",
        toolResults: [
          {
            name: "update-extension",
            isError: false,
            content: '{"id":"signups-panel"}',
          },
        ],
      }),
    );

    expect(result).not.toBeNull();
  });

  const groundedPriorTurnMessages = (
    followUp: string,
  ): AgentLoopFinalResponseGuardContext["messages"] => [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "What was our signup count last week from BigQuery?",
        },
      ],
    },
    {
      role: "assistant",
      content: [{ type: "tool-call", id: "tc1", name: "bigquery", input: {} }],
    },
    {
      role: "user",
      content: [
        {
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "bigquery",
          toolInput: "{}",
          content: '{"rows":[{"count":532}]}',
        },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Signup count last week was 532, from BigQuery.",
        },
      ],
    },
    {
      role: "user",
      content: [{ type: "text", text: followUp }],
    },
  ];

  it("treats a follow-up that restates an earlier turn's grounded figures as evidence, not a new ungrounded claim", () => {
    const followUp = "Was that 532 for the full week?";
    const result = realDataFinalGuard({
      messages: groundedPriorTurnMessages(followUp),
      requestText: followUp,
      assistantContent: [],
      text: "Yes — the 532 signups cover the full week, from BigQuery.",
      toolCalls: [],
      toolResults: [],
      retryCount: 0,
      executionMode: "act",
    });

    expect(result).toBeNull();
  });

  it("does not let an earlier turn's query ground a new figure the draft invents this turn", () => {
    const followUp = "How many signups was that the week before?";
    const result = realDataFinalGuard({
      messages: groundedPriorTurnMessages(followUp),
      requestText: followUp,
      assistantContent: [],
      text: "The week before that, signups were 480.",
      toolCalls: [],
      toolResults: [],
      retryCount: 0,
      executionMode: "act",
    });

    expect(result?.retryMessage).toMatch(/no real source query ran/);
    expect(result?.exhaustedDraftPrefix).toMatch(/^Unverified/);
  });

  it("does not let a figure from three turns back ground a current answer", () => {
    const followUp = "So signups were 532 last week, right?";
    const result = realDataFinalGuard({
      messages: [
        ...groundedPriorTurnMessages("Thanks!"),
        {
          role: "assistant",
          content: [{ type: "text", text: "You're welcome." }],
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Which dashboard should I use for this?" },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Try the Growth dashboard." }],
        },
        { role: "user", content: [{ type: "text", text: followUp }] },
      ],
      requestText: followUp,
      assistantContent: [],
      text: "Yes — signups were 532 last week.",
      toolCalls: [],
      toolResults: [],
      retryCount: 0,
      executionMode: "act",
    });

    expect(result?.retryMessage).toMatch(/no real source query ran/);
  });

  it("does not let an earlier turn's figure be re-attributed to a metric that turn never queried", () => {
    const followUp = "And how many paying customers this month?";
    const result = realDataFinalGuard({
      messages: groundedPriorTurnMessages(followUp),
      requestText: followUp,
      assistantContent: [],
      text: "Paying customers were 532 this month.",
      toolCalls: [],
      toolResults: [],
      retryCount: 0,
      executionMode: "act",
    });

    expect(result?.retryMessage).toMatch(/no real source query ran/);
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

function threadContext(params: {
  earlier: string[];
  userText: string;
  draftText: string;
  toolResults?: AgentLoopFinalResponseGuardContext["toolResults"];
}): AgentLoopFinalResponseGuardContext {
  const messages: AgentLoopFinalResponseGuardContext["messages"] = [];
  for (const text of params.earlier) {
    messages.push(userMessage(text), {
      role: "assistant",
      content: [{ type: "text", text: "Here you go." }],
    });
  }
  messages.push(userMessage(params.userText));
  return {
    ...guardContext({
      userText: params.userText,
      draftText: params.draftText,
      toolResults: params.toolResults,
    }),
    messages,
  };
}

const UNGROUNDED_FIGURES =
  "Net revenue retention was 112% and 41 customers churned last quarter.";

describe("realDataFinalGuard turn classification", () => {
  it.each([
    "what's our NRR",
    "Q3 bookings",
    "pull the renewal list for Q4",
    "churned logos last quarter",
    "who owns Acme",
    "how many seats does Globex have",
    "what's our win rate",
    "who are our top reps",
    "median time to close",
    "are we on track for the quarter",
    "rank sales reps by closed won",
    "biggest drop in activation last week",
    "update me on page views",
    "update me on tab usage",
    "先月のサインアップ数は？",
    "Сколько регистраций за прошлую неделю?",
  ])("judges an unqueried draft of figures for %j", (userText) => {
    expect(
      realDataFinalGuard(
        guardContext({ userText, draftText: UNGROUNDED_FIGURES }),
      ),
    ).toMatchObject({ retryMessage: expect.any(String) });
  });

  const PIPELINE_THREAD = [
    "pipeline by stage for Q3",
    "what about EMEA?",
    "and APAC?",
    "and LATAM?",
  ];

  it.each([
    ["what about EMEA?", ["show me pipeline by stage for Q3"]],
    ["same but for APAC", ["what's our NRR"]],
    ["and APAC?", ["Q3 bookings by region", "what about EMEA?"]],
    // Past the fourth consecutive short follow-up the root ask is out of reach.
    ["and the UK?", PIPELINE_THREAD],
    ["remove EMEA from this", ["show me pipeline by stage for Q3"]],
    ["switch to the EMEA region", ["show me pipeline by stage for Q3"]],
    ["set the window to 30 days", ["show me pipeline by stage for Q3"]],
    [
      "can you do the same for enterprise only",
      ["show me pipeline by stage for Q3"],
    ],
  ])("judges an unqueried draft for the follow-up %j", (userText, earlier) => {
    expect(
      realDataFinalGuard(
        threadContext({ earlier, userText, draftText: UNGROUNDED_FIGURES }),
      ),
    ).toMatchObject({ retryMessage: expect.any(String) });
  });

  it.each([
    ["what about winter?", ["write me a haiku about autumn"]],
    ["what about winter?", []],
    ["and the UK?", [...PIPELINE_THREAD, ...PIPELINE_THREAD, "and MENA?"]],
  ])(
    "judges an unqueried draft for %j whatever the thread before it",
    (userText, earlier) => {
      expect(
        realDataFinalGuard(
          threadContext({ earlier, userText, draftText: UNGROUNDED_FIGURES }),
        ),
      ).toMatchObject({ retryMessage: expect.any(String) });
    },
  );

  // A destructive or navigational artifact ask names a metric inside the
  // artifact's name; its confirmation may quote counts of what it touched.
  it.each([
    "open the revenue dashboard",
    "go to the pipeline dashboard",
    "share the churn dashboard with Sam",
    "delete the old signups dashboard",
    "favorite the customers dashboard",
    "fix the layout of the accounts page",
    "the route for tickets is broken",
    "update the code that handles signups",
    "open the data sources page",
    "add the revenue dashboard to my favorites",
  ])("does not retry a confirmation of %j that quotes counts", (userText) => {
    expect(
      realDataFinalGuard(
        guardContext({
          userText,
          draftText:
            "Done. The old Signups dashboard had 7 panels, and 2 accounts had access.",
        }),
      ),
    ).toBeNull();
  });

  // An edit of how an artifact looks quotes nothing measured, even when its
  // size, device, or new name carries a figure or a metric word.
  it.each([
    ["move the legend to the left", "Done. The legend now lists 2 accounts."],
    [
      "change the chart title to Overview",
      "Done. The legend now lists 2 accounts.",
    ],
    [
      "make the chart show the legend",
      "Done. The legend now lists 2 accounts.",
    ],
    [
      "resize the chart to full width",
      "Done. The legend now lists 2 accounts.",
    ],
    ["resize the chart by 20%", "Done. The chart is now 20% wider."],
    ["resize the chart by 20%", "Resized the chart by 20%."],
    [
      "move the legend by 10px",
      "Done. Moved the legend by 10px; it now lists 2 accounts.",
    ],
    [
      "make the chart bigger for mobile",
      "Done. The chart is now 40% taller on mobile.",
    ],
    [
      "rename the chart to Revenue Overview",
      "Renamed the chart to Revenue Overview; it still shows 2 accounts.",
    ],
    [
      "rename the chart to Revenue by Region",
      "Renamed the chart to Revenue by Region; it still shows 2 accounts.",
    ],
    ["remove the legend", "Done. The legend now lists 2 accounts."],
    [
      "remove the legend completely",
      "Done. I removed the legend; the chart still shows 2 accounts.",
    ],
    [
      "delete the chart called Revenue",
      "Done. I deleted the chart; the dashboard still lists 2 accounts.",
    ],
    ["hide the gridlines", "Done. The chart still shows 2 accounts."],
    ["delete this panel", "Done. The dashboard still lists 2 accounts."],
    ["remove this chart", "Done. The dashboard still lists 2 accounts."],
    ["delete the old dashboard", "Done. Deleted it; 2 accounts had access."],
    [
      "remove the x-axis",
      "Done. I removed the x-axis; the chart still shows 2 accounts.",
    ],
    ["hide the y-axis", "Done. The chart still shows 2 accounts."],
    [
      "remove the shadow from the panel",
      "Done. The panel still lists 2 accounts.",
    ],
    [
      "remove the footer from this dashboard",
      "Done. The dashboard still lists 2 accounts.",
    ],
    [
      "remove the margin around the chart",
      "Done. The chart still shows 2 accounts.",
    ],
    [
      "turn off the animation on this chart",
      "Done. The chart still shows 2 accounts.",
    ],
    [
      "disable animations on the dashboard",
      "Done. The dashboard still lists 2 accounts.",
    ],
    [
      "remove everything from this page",
      "Done. The page is empty; it listed 2 accounts.",
    ],
    [
      "move this chart to another tab",
      "Done. Moved the chart to the Overview tab; it still shows 2 accounts.",
    ],
    [
      "move this panel into a new section",
      "Done. Moved the panel into the Growth section; it still lists 2 accounts.",
    ],
  ])(
    "does not retry a confirmation of the look edit %j",
    (userText, draftText) => {
      expect(
        realDataFinalGuard(guardContext({ userText, draftText })),
      ).toBeNull();
    },
  );

  // An edit that changes what a chart measures is a data turn: figures in the
  // reply need a query, however the ask is worded.
  it.each([
    "change this chart to show revenue by region",
    "make this chart show signups by plan",
    "add a series for churn to this chart",
    "add ARR to this panel",
    "add a line for MRR to the chart",
    "change the chart to exclude trial accounts",
    "change this chart to revenue",
    "turn this chart into a funnel",
    "change this chart for mobile users",
    "change this chart for 2024",
    "remove EMEA from this chart",
    "remove EMEA from chart",
    "remove refunds from chart",
    "hide churn on dashboard",
    "remove page views from this chart",
    "remove views from this chart",
    "remove tab views from this chart",
    "remove label clicks from this chart",
    "remove test accounts from this chart",
    "remove internal users from the dashboard",
    "hide trial accounts on this dashboard",
    "delete the churned customers from this panel",
    "exclude refunds from this chart",
    "turn off bot traffic on this chart",
    "make the chart ignore test accounts",
    "update the dashboard to ignore refunds",
    "remove users who opened the settings page from this chart",
    "delete sessions that reached the checkout page",
    "add a tab about retention",
  ])(
    "judges an unqueried draft of figures for the data edit %j",
    (userText) => {
      expect(
        realDataFinalGuard(
          guardContext({ userText, draftText: UNGROUNDED_FIGURES }),
        ),
      ).toMatchObject({ retryMessage: expect.any(String) });
    },
  );

  it.each([
    "write me a haiku about autumn",
    "explain how a left join works",
    "can you review my PR",
    "how do I connect HubSpot",
    "what does MRR mean",
    "the chat keeps typing long messages that disappear",
  ])("passes a draft with no figures for the general ask %j", (userText) => {
    expect(
      realDataFinalGuard(
        guardContext({ userText, draftText: "Here is a short answer." }),
      ),
    ).toBeNull();
  });

  it("judges a draft once the turn has started catalog discovery, whatever the wording", () => {
    expect(
      realDataFinalGuard(
        guardContext({
          userText: "make the chart show signups by plan",
          draftText: "Free has 1,200 signups and Pro has 340 customers.",
          toolResults: [
            {
              name: "search-analytics-query-catalog",
              isError: false,
              content: '{"candidates":[]}',
            },
          ],
        }),
      ),
    ).toMatchObject({ retryMessage: expect.any(String) });
  });

  // Jason's 2026-08-17 reports: the canned no-grounded-data sentence replied to
  // theme and extension edits.
  it.each([
    "add a dark mode toggle to the theme settings",
    "switch the theme to dark",
    "make the extension header blue",
    "rename this chart",
    "make it blue",
    "update the extension to add a copy button to each row",
    "edit the extension so the header is sticky",
  ])("never answers the UI ask %j with the no-data sentence", (userText) => {
    const result = realDataFinalGuard(
      guardContext({ userText, draftText: GENERIC_NO_DATA_FALLBACK_MESSAGE }),
    );

    expect(
      (result as { fallbackMessage?: string } | null)?.fallbackMessage,
    ).not.toBe(GENERIC_NO_DATA_FALLBACK_MESSAGE);
    expect(result).not.toMatchObject({
      retryMessage: expect.stringContaining("no real source query ran"),
    });
  });

  it.each([
    "add a dark mode toggle to the theme settings",
    "switch the theme to dark",
    "make it blue",
    "rename this chart",
  ])(
    "retries the canned sentence on %j as ordinary conversation",
    (userText) => {
      expect(
        realDataFinalGuard(
          guardContext({
            userText,
            draftText: GENERIC_NO_DATA_FALLBACK_MESSAGE,
          }),
        ),
      ).toMatchObject({
        retryMessage: NON_ANALYTICS_FALLBACK_RETRY_MESSAGE,
        fallbackMessage: NON_ANALYTICS_FALLBACK_FINAL_MESSAGE,
      });
    },
  );

  it("does not demand a query for a greeting that mentions a number", () => {
    expect(
      realDataFinalGuard(
        guardContext({
          userText: "hello",
          draftText: "Hi! I found 3 things I can help with today.",
        }),
      ),
    ).toBeNull();
  });
});
