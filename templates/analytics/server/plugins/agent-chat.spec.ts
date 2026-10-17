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
const dataQueryingSkill = readMarkdown(
  "../../.agents/skills/data-querying/SKILL.md",
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

const { dbtProviderReadiness, getOrgContext, listWorkspaceConnectionsForApp } =
  vi.hoisted(() => ({
    dbtProviderReadiness: vi.fn(async (): Promise<string> => "ready"),
    getOrgContext: vi.fn(async () => ({ orgId: "org_test" })),
    listWorkspaceConnectionsForApp: vi.fn(async () => []),
  }));

vi.mock("@agent-native/core/org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/org")>()),
  getOrgContext,
}));
vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/workspace-connections")
  >()),
  listWorkspaceConnectionsForApp,
  resolveWorkspaceConnectionsForApp: listWorkspaceConnectionsForApp,
}));
vi.mock("../lib/dbt-readiness", () => ({ dbtProviderReadiness }));

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

  it("hands the plugin the same rules as extraContext plus one dbt readiness line", async () => {
    const extraContext = agentChatPluginOptions[0]?.extraContext as
      | ((event: unknown, owner: string) => Promise<string>)
      | undefined;

    expect(await extraContext?.({}, "owner@example.test")).toBe(
      analyticsExtraContext("dbt Semantic Layer: ready."),
    );
  });

  it("names the dbt readiness reason in guidance, and unknown when the lookup fails", async () => {
    const extraContext = agentChatPluginOptions[0]?.extraContext as
      | ((event: unknown, owner: string) => Promise<string>)
      | undefined;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    dbtProviderReadiness.mockResolvedValueOnce("token_missing");
    const notReady = await extraContext?.({}, "owner@example.test");
    expect(notReady).toContain(
      "dbt Semantic Layer: not ready (token_missing). The dbt Semantic Layer token is not saved. Setup: [Semantic Layer](",
    );

    dbtProviderReadiness.mockRejectedValueOnce(
      new Error("unreadable environment id"),
    );
    const unknown = await extraContext?.({}, "owner@example.test");
    expect(unknown).toContain(
      "dbt Semantic Layer: unknown (the readiness check failed).",
    );
    expect(unknown).not.toContain("not ready");
    warn.mockRestore();
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
    expect(ruleText("real-data")).toContain(
      "Matching totals do not prove exclusions",
    );
    expect(ruleText("sources")).toContain("authoritative for the turn");
    expect(ruleText("sources")).toContain("load `data-source-status`");
    expect(ruleText("sources")).toContain(
      "`connectionHealth` (stored workspace state)",
    );
    expect(ruleText("sources")).toContain(
      "use `tool-search` to load `query-dbt-semantic-metric`",
    );
    expect(ruleText("sources")).toContain("configured query-path hint");
    expect(ruleText("sources")).toContain("not a live health check");
    expect(ruleText("sources")).toContain(
      "A connected provider tool does not prove the workspace connection is healthy",
    );
    expect(ruleText("understand-the-ask")).toContain(
      "Builder product activity, Builder.io organization membership, or Agent-Native app opens",
    );
    expect(ruleText("understand-the-ask")).toContain(
      "never combine or silently substitute them",
    );
  });

  it("keeps event families, exclusion rules, and bounded absence claims evidence-based", () => {
    expect(dataQueryingSkill).toContain(
      "grouped MetricFlow queries require an inclusive `timeRange`",
    );
    expect(dataQueryingSkill).toContain(
      "keep the populations separate and ask which one the user intends",
    );
    expect(dataQueryingSkill).toContain(
      "Keep event families separate unless the dbt metric or exact saved query defines their union",
    );
    expect(dataQueryingSkill).toContain(
      "Similar aggregate totals do not prove that a model excludes staff",
    );
    expect(dataQueryingSkill).toContain("does not establish absence elsewhere");
    expect(dataQueryingSkill).toContain(
      "distinguish configured credentials from a healthy workspace connection",
    );
  });

  it("keeps every clause of the understand-the-ask rule", () => {
    const rule = ruleText("understand-the-ask");

    for (const clause of [
      '"this", "that", and "it"',
      "`selected-object`",
      "keep its source and business logic and change only filters and window",
      "certified over favorite over unmarked",
      'An unqualified "active users" request may mean Builder product activity, Builder.io organization membership, or Agent-Native app opens',
      "Ask which population they mean before querying; never combine or silently substitute them",
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

  it("routes named dbt metrics through tool discovery", () => {
    expect(ruleText("sources")).toContain(
      "For a named dbt metric, use `tool-search` to load `query-dbt-semantic-metric`.",
    );
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
      "query-dbt-semantic-metric",
      "data-source-status",
    ]) {
      expect(INITIAL_TOOL_NAMES).not.toContain(lazy);
    }
  });

  it("explicitly keeps extension creation enabled for Analytics Custom Blocks", async () => {
    const { readFile } = await import("node:fs/promises");
    const [agentChatSource, coreRoutesSource] = await Promise.all([
      // source-read-ok: this test protects app-level capability wiring at the plugin boundary.
      readFile(new URL("./agent-chat.ts", import.meta.url), "utf8"),
      // source-read-ok: this test protects app-level capability wiring at the plugin boundary.
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
  toolCalls?: AgentLoopFinalResponseGuardContext["toolCalls"];
  toolResults?: AgentLoopFinalResponseGuardContext["toolResults"];
  runStartedAt?: number;
  executionMode?: AgentLoopFinalResponseGuardContext["executionMode"];
  retryCount?: number;
}): AgentLoopFinalResponseGuardContext {
  const context: AgentLoopFinalResponseGuardContext & {
    requestText?: string;
  } = {
    messages: [userMessage(params.userText)],
    requestText: params.requestText ?? params.userText,
    runStartedAt: params.runStartedAt,
    assistantContent: [],
    text: params.draftText,
    toolCalls: params.toolCalls ?? [],
    toolResults: params.toolResults ?? [],
    retryCount: params.retryCount ?? 0,
    executionMode: params.executionMode ?? "act",
  };
  return context;
}

describe("realDataFinalGuard dbt fallback disclosure", () => {
  const dbtNotFound = {
    name: "query-dbt-semantic-metric",
    isError: false,
    content: JSON.stringify({ status: "not_found" }),
  };
  const dbtSuccess = {
    name: "query-dbt-semantic-metric",
    isError: false,
    content: JSON.stringify({ status: "success" }),
  };
  const bigQueryOk = {
    name: "bigquery",
    isError: false,
    // The production result: runQuery's rows and metadata, with no query_status.
    content: JSON.stringify({
      rows: [{ n: 10 }],
      totalRows: 1,
      bytesProcessed: 0,
      cached: false,
      truncated: false,
    }),
  };
  // bigquery throws on timeout, so the tool result is an error, not a rows payload.
  const bigQueryTimedOut = {
    name: "bigquery",
    isError: true,
    content: JSON.stringify({ error: "BigQuery query timed out" }),
  };
  const dbtNotReadyStatus = {
    name: "data-source-status",
    isError: false,
    content: JSON.stringify({
      workspaceConnections: {
        appId: "analytics",
        available: true,
        providers: [
          {
            id: "dbt",
            label: "dbt Cloud",
            grantState: "connected",
            dbtReadiness: "token_missing",
          },
        ],
      },
    }),
  };
  const draft = "Active accounts were 10 last month.";
  const disclosed =
    "Active accounts were 10 last month. This figure is warehouse-derived from BigQuery, not the owner-approved Semantic Layer definition, because the dbt metric query did not complete.";

  it("asks once for a disclosure when a failed dbt metric falls back to a successful BigQuery answer", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What were active accounts last month?",
        draftText: draft,
        toolResults: [dbtNotFound, bigQueryOk],
      }),
    );

    expect(result).toMatchObject({
      maxRetries: 1,
      retryMessage: expect.stringContaining("warehouse-derived"),
      exhaustedDraftPrefix: expect.stringContaining(
        "not the owner-approved Semantic Layer definition",
      ),
    });
  });

  it("does not force a disclosure retry on a readiness status alone, without a dbt metric attempt", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What were active accounts last month?",
        draftText: draft,
        toolResults: [dbtNotReadyStatus, bigQueryOk],
      }),
    );

    expect(result).toBeNull();
  });

  it("accepts the fallback answer once it discloses the source", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What were active accounts last month?",
        draftText: disclosed,
        toolResults: [dbtNotFound, bigQueryOk],
      }),
    );

    expect(result).toBeNull();
  });

  it("does not force a retry on a BigQuery answer that never asked dbt", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "How many sessions did we record yesterday?",
        draftText: draft,
        toolResults: [bigQueryOk],
      }),
    );

    expect(result).toBeNull();
  });

  it("does not treat a successful dbt answer as a fallback", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What were active accounts last month?",
        draftText: draft,
        toolResults: [dbtSuccess, bigQueryOk],
      }),
    );

    expect(result).toBeNull();
  });

  it("asks for a correction when a 'not approved' clause does not cover a later approval claim", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What were active accounts last month?",
        draftText:
          "This figure is warehouse-derived from BigQuery, not the owner-approved Semantic Layer definition, but the approved value is 10.",
        toolResults: [dbtNotFound, bigQueryOk],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("warehouse-derived"),
    });
  });

  it("withholds the figure on an exhausted retry when the draft still claims approval", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What were active accounts last month?",
        draftText:
          "The approved value is 10 from BigQuery. It is warehouse-derived and not the owner-approved Semantic Layer definition.",
        toolResults: [dbtNotFound, bigQueryOk],
      }),
    );

    expect(result).toMatchObject({
      fallbackMessage: expect.stringContaining("no owner-approved figure"),
    });
    expect(result).not.toMatchObject({
      fallbackMessage: expect.stringMatching(/this figure/i),
    });
    expect(result).not.toHaveProperty("exhaustedDraftPrefix");
  });

  it("asks for a correction when a draft disclaims approval and then calls the figure approved", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What were active accounts last month?",
        draftText:
          "The figure is warehouse-derived from BigQuery and is not the approved Semantic Layer definition. Call it the owner-approved value: 10.",
        toolResults: [dbtNotFound, bigQueryOk],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("warehouse-derived"),
    });
  });

  it("asks for a correction when the draft discloses the source but also claims approval", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What were active accounts last month?",
        draftText:
          "The approved value is 10 from BigQuery. It is warehouse-derived and not the owner-approved Semantic Layer definition.",
        toolResults: [dbtNotFound, bigQueryOk],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("warehouse-derived"),
    });
  });

  it("does not force the disclosure on an empty draft", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What were active accounts last month?",
        draftText: "   ",
        toolResults: [dbtNotFound, bigQueryOk],
      }),
    );

    expect(JSON.stringify(result ?? null)).not.toContain("warehouse-derived");
  });

  it("does not use a later BigQuery read when the first read after the dbt failure errored", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What were active accounts last month?",
        draftText: draft,
        toolResults: [dbtNotFound, bigQueryTimedOut, bigQueryOk],
      }),
    );

    expect(JSON.stringify(result ?? null)).not.toContain("warehouse-derived");
  });

  it("does not count an empty BigQuery result as the fallback answer", () => {
    const emptyRead = {
      name: "bigquery",
      isError: false,
      content: JSON.stringify({ rows: [], totalRows: 0 }),
    };
    const result = realDataFinalGuard(
      guardContext({
        userText: "What were active accounts last month?",
        draftText: draft,
        toolResults: [dbtNotFound, emptyRead],
      }),
    );

    expect(JSON.stringify(result ?? null)).not.toContain("warehouse-derived");
  });

  it("does not count a BigQuery answer that ran before the dbt failure", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What were active accounts last month?",
        draftText: draft,
        toolResults: [bigQueryOk, dbtNotFound],
      }),
    );

    expect(JSON.stringify(result ?? null)).not.toContain("warehouse-derived");
  });

  it("does not count a structured BigQuery failure as the fallback answer", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What were active accounts last month?",
        draftText: draft,
        toolResults: [dbtNotFound, bigQueryTimedOut],
      }),
    );

    expect(JSON.stringify(result ?? null)).not.toContain("warehouse-derived");
  });
});

describe("realDataFinalGuard", () => {
  const today = new Date();
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const currentWeekStart = new Date(
    Date.UTC(
      todayUtc.getUTCFullYear(),
      todayUtc.getUTCMonth(),
      todayUtc.getUTCDate() - ((todayUtc.getUTCDay() + 6) % 7),
    ),
  );
  const lastWeekStart = new Date(
    Date.UTC(
      currentWeekStart.getUTCFullYear(),
      currentWeekStart.getUTCMonth(),
      currentWeekStart.getUTCDate() - 7,
    ),
  );
  const activationRateWeek = {
    startDate: lastWeekStart.toISOString().slice(0, 10),
    endDate: new Date(
      Date.UTC(
        lastWeekStart.getUTCFullYear(),
        lastWeekStart.getUTCMonth(),
        lastWeekStart.getUTCDate() + 6,
      ),
    )
      .toISOString()
      .slice(0, 10),
  };

  function dbtMetricCall(
    timeRange: {
      startDate: string;
      endDate: string;
    },
    groupBy: Array<{ name: string; grain?: string }> = [],
    toolCallId?: string,
  ): AgentLoopFinalResponseGuardContext["toolCalls"][number] {
    return {
      ...(toolCallId ? { toolCallId } : {}),
      name: "query-dbt-semantic-metric",
      input: { metricName: "activation_rate", timeRange, groupBy },
    };
  }

  function dbtMetricResult(
    querySpec: Record<string, unknown>,
    rows: Array<Record<string, unknown>> = [{ activation_rate: 42 }],
    extra: Record<string, unknown> = {},
    toolCallId?: string,
  ): AgentLoopFinalResponseGuardContext["toolResults"][number] {
    return {
      ...(toolCallId ? { toolCallId } : {}),
      name: "query-dbt-semantic-metric",
      isError: false,
      content: JSON.stringify({
        status: "success",
        metricName: "activation_rate",
        metric: {
          name: "activation_rate",
          queryableGranularities: ["DAY", "WEEK", "MONTH"],
          dimensions: [
            {
              name: "organization_id",
              description: "Owning organization",
              queryableGranularities: [],
            },
            {
              name: "metric_time",
              queryableGranularities: ["DAY", "WEEK", "MONTH"],
            },
          ],
        },
        querySpec,
        rows,
        ...extra,
      }),
    };
  }

  it("accepts numeric claims only from nonempty successful dbt metric rows", () => {
    const successful = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate last week?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(activationRateWeek)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: activationRateWeek }),
        ],
      }),
    );
    const empty = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate last week?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(activationRateWeek)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: activationRateWeek }, []),
        ],
      }),
    );

    expect(successful).toBeNull();
    expect(empty).toMatchObject({
      retryMessage: expect.stringContaining("returned no metric rows"),
      fallbackMessage: expect.stringContaining(
        "does not mean the metric is zero",
      ),
    });
  });

  it("rejects an all-time dbt result for a period-scoped request", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate last week?",
        draftText: "The activation rate was 42%.",
        toolCalls: [
          {
            name: "query-dbt-semantic-metric",
            input: { metricName: "activation_rate", allTime: true },
          },
        ],
        toolResults: [dbtMetricResult({ groupBy: [], allTime: true })],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("do not use `allTime:true`"),
      fallbackMessage: expect.stringContaining(
        "does not match the requested date range",
      ),
    });
  });

  it("guards annual and natural-language bounded date requests", () => {
    const runStartedAt = Date.UTC(2026, 9, 15, 19, 0);
    const allTimeResult = (userText: string) =>
      realDataFinalGuard(
        guardContext({
          userText,
          draftText: "The activation rate was 42%.",
          runStartedAt,
          toolCalls: [
            {
              name: "query-dbt-semantic-metric",
              input: { metricName: "activation_rate", allTime: true },
            },
          ],
          toolResults: [dbtMetricResult({ groupBy: [], allTime: true })],
        }),
      );

    expect(
      allTimeResult("What was the activation rate for 2025?"),
    ).toMatchObject({
      retryMessage: expect.stringContaining("do not use `allTime:true`"),
    });
    expect(
      allTimeResult(
        "What was the activation rate from March 1, 2025 to March 31, 2025?",
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("do not use `allTime:true`"),
    });
    expect(
      allTimeResult(
        "What was the activation rate from March 1 through March 31?",
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("do not use `allTime:true`"),
    });
    expect(
      allTimeResult("What was the activation rate from Jan 1 to 31 Dec 2026?"),
    ).toMatchObject({
      retryMessage: expect.stringContaining("do not use `allTime:true`"),
    });
    expect(
      allTimeResult(
        "What was the activation rate from Jan 1 to 31st Dec 2026?",
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("do not use `allTime:true`"),
    });
    expect(
      allTimeResult("What was the activation rate from Jan 1 to 31?"),
    ).toMatchObject({
      retryMessage: expect.stringContaining("do not use `allTime:true`"),
    });
    expect(
      allTimeResult(
        "What was the activation rate from 1 Jan 2026 to 31 Jan 2026?",
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("do not use `allTime:true`"),
    });

    const march2025 = { startDate: "2025-03-01", endDate: "2025-03-31" };
    const matchingNamedRange = realDataFinalGuard(
      guardContext({
        userText:
          "What was the activation rate from March 1, 2025 to March 31, 2025?",
        draftText: "The activation rate was 42%.",
        runStartedAt,
        toolCalls: [dbtMetricCall(march2025)],
        toolResults: [dbtMetricResult({ groupBy: [], timeRange: march2025 })],
      }),
    );
    expect(matchingNamedRange).toBeNull();

    const march2026 = { startDate: "2026-03-01", endDate: "2026-03-31" };
    const matchingYearlessRange = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate from March 1 through March 31?",
        draftText: "The activation rate was 42%.",
        runStartedAt,
        toolCalls: [dbtMetricCall(march2026)],
        toolResults: [dbtMetricResult({ groupBy: [], timeRange: march2026 })],
      }),
    );
    expect(matchingYearlessRange).toBeNull();

    const dayFirstRange = { startDate: "2026-01-01", endDate: "2026-12-31" };
    const matchingDayFirstRange = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate from Jan 1 to 31 Dec 2026?",
        draftText: "The activation rate was 42%.",
        runStartedAt,
        toolCalls: [dbtMetricCall(dayFirstRange)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: dayFirstRange }),
        ],
      }),
    );
    expect(matchingDayFirstRange).toBeNull();

    const matchingOrdinalDayFirstRange = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate from Jan 1 to 31st Dec 2026?",
        draftText: "The activation rate was 42%.",
        runStartedAt,
        toolCalls: [dbtMetricCall(dayFirstRange)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: dayFirstRange }),
        ],
      }),
    );
    expect(matchingOrdinalDayFirstRange).toBeNull();

    const januaryRange = { startDate: "2026-01-01", endDate: "2026-01-31" };
    const matchingSameMonthShorthand = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate from Jan 1 to 31?",
        draftText: "The activation rate was 42%.",
        runStartedAt,
        toolCalls: [dbtMetricCall(januaryRange)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: januaryRange }),
        ],
      }),
    );
    expect(matchingSameMonthShorthand).toBeNull();

    const matchingDayFirstNamedRange = realDataFinalGuard(
      guardContext({
        userText:
          "What was the activation rate from 1 Jan 2026 to 31 Jan 2026?",
        draftText: "The activation rate was 42%.",
        runStartedAt,
        toolCalls: [dbtMetricCall(januaryRange)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: januaryRange }),
        ],
      }),
    );
    expect(matchingDayFirstNamedRange).toBeNull();

    const invalidNamedRange = allTimeResult(
      "What was the activation rate from February 30, 2025 to March 2, 2025?",
    );
    expect(invalidNamedRange).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(
      allTimeResult(
        "What was the activation rate from 30 Feb 2025 to 2 Mar 2025?",
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
  });

  it("requires the dbt result range to match its query input and explicit dates", () => {
    const requestedRange = {
      startDate: "2026-10-05",
      endDate: "2026-10-11",
    };
    const mismatchedResult = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate from 2026-10-05 to 2026-10-11?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(requestedRange)],
        toolResults: [
          dbtMetricResult({
            groupBy: [],
            timeRange: { startDate: "2026-10-04", endDate: "2026-10-10" },
          }),
        ],
      }),
    );
    const mismatchedInput = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate from 2026-10-05 to 2026-10-11?",
        draftText: "The activation rate was 42%.",
        toolCalls: [
          dbtMetricCall({ startDate: "2026-10-04", endDate: "2026-10-10" }),
        ],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: requestedRange }),
        ],
      }),
    );
    const matchingWindow = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate from 2026-10-05 to 2026-10-11?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(requestedRange)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: requestedRange }),
        ],
      }),
    );

    expect(mismatchedResult).toMatchObject({
      retryMessage: expect.stringContaining("match explicit dates exactly"),
    });
    expect(mismatchedInput).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(matchingWindow).toBeNull();
  });

  it("rejects a seven-day range from the wrong calendar week", () => {
    const wrongWeekStart = new Date(
      Date.UTC(
        lastWeekStart.getUTCFullYear(),
        lastWeekStart.getUTCMonth(),
        lastWeekStart.getUTCDate() - 7,
      ),
    );
    const wrongRange = {
      startDate: wrongWeekStart.toISOString().slice(0, 10),
      endDate: new Date(
        Date.UTC(
          wrongWeekStart.getUTCFullYear(),
          wrongWeekStart.getUTCMonth(),
          wrongWeekStart.getUTCDate() + 6,
        ),
      )
        .toISOString()
        .slice(0, 10),
    };
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate last week?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(wrongRange)],
        toolResults: [dbtMetricResult({ groupBy: [], timeRange: wrongRange })],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("match explicit dates exactly"),
    });
  });

  it("checks named calendar periods against the requested range", () => {
    const lastMonthStart = new Date(
      Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth() - 1, 1),
    );
    const lastMonthEnd = new Date(
      Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), 0),
    );
    const correctRange = {
      startDate: lastMonthStart.toISOString().slice(0, 10),
      endDate: lastMonthEnd.toISOString().slice(0, 10),
    };
    const wrongRange = {
      startDate: activationRateWeek.startDate,
      endDate: activationRateWeek.endDate,
    };
    const correct = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate last month?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(correctRange)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: correctRange }),
        ],
      }),
    );
    const wrong = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate last month?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(wrongRange)],
        toolResults: [dbtMetricResult({ groupBy: [], timeRange: wrongRange })],
      }),
    );

    expect(correct).toBeNull();
    expect(wrong).toMatchObject({
      retryMessage: expect.stringContaining("match explicit dates exactly"),
    });
  });

  it("checks explicit rolling day counts against the queried date range", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate for the last 30 days?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(activationRateWeek)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: activationRateWeek }),
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
  });

  it("anchors rolling windows to turn start and checks both endpoints", () => {
    const runStartedAt = Date.UTC(2026, 9, 1, 23, 59);
    const expectedRange = {
      startDate: "2026-09-25",
      endDate: "2026-10-01",
    };
    const staleSameLengthRange = {
      startDate: "2026-09-01",
      endDate: "2026-09-07",
    };
    const matching = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate for the last 7 days?",
        draftText: "The activation rate was 42%.",
        runStartedAt,
        toolCalls: [dbtMetricCall(expectedRange)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: expectedRange }),
        ],
      }),
    );
    const stale = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate for the last 7 days?",
        draftText: "The activation rate was 42%.",
        runStartedAt,
        toolCalls: [dbtMetricCall(staleSameLengthRange)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: staleSameLengthRange }),
        ],
      }),
    );

    expect(matching).toBeNull();
    expect(stale).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
  });

  it("checks recent rolling windows and rejects all-time metric results", () => {
    const runStartedAt = Date.UTC(2026, 9, 15, 19, 0);
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate over the most recent 7 days?",
        draftText: "The activation rate was 42%.",
        runStartedAt,
        toolCalls: [
          {
            name: "query-dbt-semantic-metric",
            input: { metricName: "activation_rate", allTime: true },
          },
        ],
        toolResults: [dbtMetricResult({ groupBy: [], allTime: true })],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
  });

  it("checks both dates for a month-day open-ended request", () => {
    const runStartedAt = Date.UTC(2026, 9, 15, 19, 0);
    const correctRange = {
      startDate: "2026-07-01",
      endDate: "2026-10-15",
    };
    const wrongRange = {
      startDate: "2025-07-01",
      endDate: "2026-10-15",
    };
    const correct = realDataFinalGuard(
      guardContext({
        userText: "How many signups since July 1?",
        draftText: "There were 42 signups.",
        runStartedAt,
        toolCalls: [dbtMetricCall(correctRange)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: correctRange }),
        ],
      }),
    );
    const wrong = realDataFinalGuard(
      guardContext({
        userText: "How many signups since July 1?",
        draftText: "There were 42 signups.",
        runStartedAt,
        toolCalls: [dbtMetricCall(wrongRange)],
        toolResults: [dbtMetricResult({ groupBy: [], timeRange: wrongRange })],
      }),
    );

    expect(correct).toBeNull();
    expect(wrong).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
  });

  it("requires both sides of a calendar comparison independent of result order", () => {
    const runStartedAt = Date.UTC(2026, 9, 15, 19, 0);
    const currentWeek = { startDate: "2026-10-12", endDate: "2026-10-15" };
    const lastWeek = { startDate: "2026-10-05", endDate: "2026-10-11" };
    const matching = realDataFinalGuard(
      guardContext({
        userText: "Compare this week to last week for activation rate.",
        draftText: "This week was 42%; last week was 39%.",
        runStartedAt,
        toolCalls: [
          dbtMetricCall(currentWeek, [], "current-week"),
          dbtMetricCall(lastWeek, [], "last-week"),
        ],
        toolResults: [
          dbtMetricResult(
            { groupBy: [], timeRange: lastWeek },
            undefined,
            {},
            "last-week",
          ),
          dbtMetricResult(
            { groupBy: [], timeRange: currentWeek },
            undefined,
            {},
            "current-week",
          ),
        ],
      }),
    );
    const missingSide = realDataFinalGuard(
      guardContext({
        userText: "Compare this week to last week for activation rate.",
        draftText: "This week was 42%; last week was 39%.",
        runStartedAt,
        toolCalls: [dbtMetricCall(currentWeek)],
        toolResults: [dbtMetricResult({ groupBy: [], timeRange: currentWeek })],
      }),
    );
    const reversedResultOrder = realDataFinalGuard(
      guardContext({
        userText: "Compare this week to last week for activation rate.",
        draftText: "This week was 42%; last week was 39%.",
        runStartedAt,
        toolCalls: [
          dbtMetricCall(currentWeek, [], "current-week"),
          dbtMetricCall(lastWeek, [], "last-week"),
        ],
        toolResults: [
          dbtMetricResult(
            { groupBy: [], timeRange: currentWeek },
            undefined,
            {},
            "current-week",
          ),
          dbtMetricResult(
            { groupBy: [], timeRange: lastWeek },
            undefined,
            {},
            "last-week",
          ),
        ],
      }),
    );
    const mixedGrouping = realDataFinalGuard(
      guardContext({
        userText:
          "Compare this week to last week for activation rate by organization.",
        draftText: "This week was 42%; last week was 39% by organization.",
        runStartedAt,
        toolCalls: [
          dbtMetricCall(
            currentWeek,
            [{ name: "organization_id" }],
            "current-week",
          ),
          dbtMetricCall(lastWeek, [], "last-week"),
        ],
        toolResults: [
          dbtMetricResult(
            { groupBy: [], timeRange: lastWeek },
            undefined,
            {},
            "last-week",
          ),
          dbtMetricResult(
            {
              groupBy: [{ name: "organization_id" }],
              timeRange: currentWeek,
            },
            undefined,
            {},
            "current-week",
          ),
        ],
      }),
    );

    expect(matching).toBeNull();
    expect(reversedResultOrder).toBeNull();
    expect(missingSide).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(mixedGrouping).toMatchObject({
      retryMessage: expect.stringContaining("requested grouping"),
    });
  });

  it("checks rolling month windows and supports compare date phrasing", () => {
    const runStartedAt = Date.UTC(2026, 9, 1, 23, 59);
    const threeMonths = {
      startDate: "2026-07-01",
      endDate: "2026-10-01",
    };
    const correct = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate over the last 3 months?",
        draftText: "The activation rate was 42%.",
        runStartedAt,
        toolCalls: [dbtMetricCall(threeMonths)],
        toolResults: [dbtMetricResult({ groupBy: [], timeRange: threeMonths })],
      }),
    );
    const comparedDates = {
      startDate: "2026-07-01",
      endDate: "2026-07-07",
    };
    const compared = realDataFinalGuard(
      guardContext({
        userText: "Compare activation rate from 2026-07-01 to 2026-07-07.",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(comparedDates)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: comparedDates }),
        ],
      }),
    );
    const comparedBareDates = realDataFinalGuard(
      guardContext({
        userText: "Compare 2026-07-01 to 2026-07-07 activation rate.",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(comparedDates)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: comparedDates }),
        ],
      }),
    );

    expect(correct).toBeNull();
    expect(compared).toBeNull();
    expect(comparedBareDates).toBeNull();
  });

  it("matches date ranges without an introductory preposition", () => {
    const range = { startDate: "2026-07-01", endDate: "2026-07-07" };
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate 2026-07-01 through 2026-07-07?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(range)],
        toolResults: [dbtMetricResult({ groupBy: [], timeRange: range })],
      }),
    );

    expect(result).toBeNull();
  });

  it("validates both sides of numeric rolling-window comparisons", () => {
    const runStartedAt = Date.UTC(2026, 9, 1, 23, 59);
    const recent = { startDate: "2026-07-01", endDate: "2026-10-01" };
    const previous = { startDate: "2026-03-30", endDate: "2026-06-30" };
    const recentCall = dbtMetricCall(recent, [], "recent");
    const previousCall = dbtMetricCall(previous, [], "previous");
    const recentResult = dbtMetricResult(
      { groupBy: [], timeRange: recent },
      undefined,
      {},
      "recent",
    );
    const previousResult = dbtMetricResult(
      { groupBy: [], timeRange: previous },
      undefined,
      {},
      "previous",
    );
    const evaluate = (
      toolCalls: AgentLoopFinalResponseGuardContext["toolCalls"],
      toolResults: AgentLoopFinalResponseGuardContext["toolResults"],
      userText = "Compare activation rate over the last 3 months vs the previous 3 months.",
    ) =>
      realDataFinalGuard(
        guardContext({
          userText,
          draftText:
            "The activation rate was 42% in the recent period and 39% before.",
          runStartedAt,
          toolCalls,
          toolResults,
        }),
      );

    expect(
      evaluate([recentCall, previousCall], [recentResult, previousResult]),
    ).toBeNull();
    expect(
      evaluate([previousCall, recentCall], [previousResult, recentResult]),
    ).toBeNull();
    expect(evaluate([recentCall], [recentResult])).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(
      evaluate(
        [recentCall, previousCall],
        [recentResult, previousResult],
        "Compare activation rate over the last 3 months vs the previous 2 months.",
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    const unequalPrevious = {
      startDate: "2026-04-01",
      endDate: "2026-06-30",
    };
    expect(
      evaluate(
        [recentCall, dbtMetricCall(unequalPrevious, [], "unequal-previous")],
        [
          recentResult,
          dbtMetricResult(
            { groupBy: [], timeRange: unequalPrevious },
            undefined,
            {},
            "unequal-previous",
          ),
        ],
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    const equivalentPreviousYear = {
      startDate: "2025-07-01",
      endDate: "2025-10-01",
    };
    const equivalentPreviousCall = dbtMetricCall(
      equivalentPreviousYear,
      [],
      "equivalent-previous-year",
    );
    const equivalentPreviousResult = dbtMetricResult(
      { groupBy: [], timeRange: equivalentPreviousYear },
      undefined,
      {},
      "equivalent-previous-year",
    );
    const equivalentYearText =
      "Compare activation rate over the last 3 months vs the equivalent period one year ago.";
    expect(
      evaluate(
        [recentCall, equivalentPreviousCall],
        [recentResult, equivalentPreviousResult],
        equivalentYearText,
      ),
    ).toBeNull();
    expect(
      evaluate([recentCall], [recentResult], equivalentYearText),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    const threePeriodText =
      "Compare activation rate over the last 3 months vs the previous 3 months and the equivalent period one year ago.";
    expect(
      evaluate(
        [recentCall, previousCall, equivalentPreviousCall],
        [recentResult, previousResult, equivalentPreviousResult],
        threePeriodText,
      ),
    ).toBeNull();
    expect(
      evaluate(
        [recentCall, previousCall],
        [recentResult, previousResult],
        threePeriodText,
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(
      evaluate(
        [recentCall],
        [recentResult],
        "Compare activation rate over the last 3 months vs last year.",
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(
      evaluate(
        [recentCall, previousCall],
        [recentResult, previousResult],
        "Compare activation rate over the last 3 months vs the previous 3 months and prior 3 months.",
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });

    const yearBoundaryNow = Date.UTC(2027, 0, 1, 23, 59);
    const yearBoundaryCurrent = {
      startDate: "2026-10-01",
      endDate: "2027-01-01",
    };
    const yearBoundaryPrevious = {
      startDate: "2026-06-30",
      endDate: "2026-09-30",
    };
    const yearBoundaryResult = realDataFinalGuard(
      guardContext({
        userText:
          "Compare activation rate over the last 3 months vs the previous 3 months.",
        draftText:
          "The activation rate was 42% in the recent period and 39% before.",
        runStartedAt: yearBoundaryNow,
        toolCalls: [
          dbtMetricCall(yearBoundaryCurrent, [], "current-year-boundary"),
          dbtMetricCall(yearBoundaryPrevious, [], "previous-year-boundary"),
        ],
        toolResults: [
          dbtMetricResult(
            { groupBy: [], timeRange: yearBoundaryCurrent },
            undefined,
            {},
            "current-year-boundary",
          ),
          dbtMetricResult(
            { groupBy: [], timeRange: yearBoundaryPrevious },
            undefined,
            {},
            "previous-year-boundary",
          ),
        ],
      }),
    );
    expect(yearBoundaryResult).toBeNull();
  });

  it("validates today and yesterday against their year-ago dates", () => {
    const runStartedAt = Date.UTC(2026, 9, 1, 23, 59);
    const evaluate = (
      userText: string,
      currentRange: { startDate: string; endDate: string },
      priorRange: { startDate: string; endDate: string },
      key: string,
      includePrior = true,
    ) => {
      const currentCall = dbtMetricCall(currentRange, [], `${key}-current`);
      const priorCall = dbtMetricCall(priorRange, [], `${key}-prior`);
      const currentResult = dbtMetricResult(
        { groupBy: [], timeRange: currentRange },
        undefined,
        {},
        `${key}-current`,
      );
      const priorResult = dbtMetricResult(
        { groupBy: [], timeRange: priorRange },
        undefined,
        {},
        `${key}-prior`,
      );
      return realDataFinalGuard(
        guardContext({
          userText,
          draftText: "The activation rate was 42% now and 39% last year.",
          runStartedAt,
          toolCalls: includePrior ? [currentCall, priorCall] : [currentCall],
          toolResults: includePrior
            ? [currentResult, priorResult]
            : [currentResult],
        }),
      );
    };

    expect(
      evaluate(
        "Compare activation rate today vs one year ago.",
        { startDate: "2026-10-01", endDate: "2026-10-01" },
        { startDate: "2025-10-01", endDate: "2025-10-01" },
        "today",
      ),
    ).toBeNull();
    expect(
      evaluate(
        "Compare activation rate today vs one year ago.",
        { startDate: "2026-10-01", endDate: "2026-10-01" },
        { startDate: "2025-10-01", endDate: "2025-10-01" },
        "today-missing-prior",
        false,
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(
      evaluate(
        "Compare activation rate yesterday vs one year ago.",
        { startDate: "2026-09-30", endDate: "2026-09-30" },
        { startDate: "2025-09-30", endDate: "2025-09-30" },
        "yesterday",
      ),
    ).toBeNull();
  });

  it("uses the matching current calendar window for same-period year-ago comparisons", () => {
    const currentMonth = { startDate: "2026-10-01", endDate: "2026-10-15" };
    const priorYearMonth = { startDate: "2025-10-01", endDate: "2025-10-15" };
    const ranges = [currentMonth, priorYearMonth];
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Compare activation rate for this month with the same period last year.",
        draftText: "The activation rate was 42% this month and 39% last year.",
        runStartedAt: Date.UTC(2026, 9, 15, 19, 0),
        toolCalls: ranges.map((range, index) =>
          dbtMetricCall(range, [], `month-year-ago-${index}`),
        ),
        toolResults: ranges.map((range, index) =>
          dbtMetricResult(
            { groupBy: [], timeRange: range },
            undefined,
            {},
            `month-year-ago-${index}`,
          ),
        ),
      }),
    );

    expect(result).toBeNull();
  });

  it("uses the named current quarter for year-ago comparisons", () => {
    const currentQuarter = {
      startDate: "2026-07-01",
      endDate: "2026-09-30",
    };
    const priorYearQuarter = {
      startDate: "2025-07-01",
      endDate: "2025-09-30",
    };
    const currentCall = dbtMetricCall(currentQuarter, [], "quarter-current");
    const priorCall = dbtMetricCall(priorYearQuarter, [], "quarter-prior");
    const currentResult = dbtMetricResult(
      { groupBy: [], timeRange: currentQuarter },
      undefined,
      {},
      "quarter-current",
    );
    const priorResult = dbtMetricResult(
      { groupBy: [], timeRange: priorYearQuarter },
      undefined,
      {},
      "quarter-prior",
    );
    const context = (
      toolCalls: AgentLoopFinalResponseGuardContext["toolCalls"],
      toolResults: AgentLoopFinalResponseGuardContext["toolResults"],
    ) =>
      guardContext({
        userText:
          "Compare activation rate for Q3 2026 with the equivalent period last year.",
        draftText: "The activation rate was 42% in Q3 2026 and 39% in Q3 2025.",
        runStartedAt: Date.UTC(2026, 9, 1, 23, 59),
        toolCalls,
        toolResults,
      });

    expect(
      realDataFinalGuard(
        context([currentCall, priorCall], [currentResult, priorResult]),
      ),
    ).toBeNull();
    expect(
      realDataFinalGuard(context([currentCall], [currentResult])),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(
      realDataFinalGuard(
        guardContext({
          userText: "Compare activation rate for Q3 2026 with last year.",
          draftText: "The activation rate was 42% in Q3 2026.",
          runStartedAt: Date.UTC(2026, 9, 1, 23, 59),
          toolCalls: [currentCall],
          toolResults: [currentResult],
        }),
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
  });

  it("prefers explicit comparison connectors and parses periods introduced by with", () => {
    const january2025 = {
      startDate: "2025-01-01",
      endDate: "2025-01-31",
    };
    const january2024 = {
      startDate: "2024-01-01",
      endDate: "2024-01-31",
    };
    const evaluate = (
      userText: string,
      ranges: Array<{ startDate: string; endDate: string }>,
    ) => {
      const toolCalls = ranges.map((range, index) =>
        dbtMetricCall(range, [], `named-period-${index}`),
      );
      const toolResults = ranges.map((range, index) =>
        dbtMetricResult(
          { groupBy: [], timeRange: range },
          undefined,
          {},
          `named-period-${index}`,
        ),
      );
      return realDataFinalGuard(
        guardContext({
          userText,
          draftText:
            "The activation rate was 42% in the current period and 39% before.",
          runStartedAt: Date.UTC(2026, 9, 1, 23, 59),
          toolCalls,
          toolResults,
        }),
      );
    };

    expect(
      evaluate(
        "Show activation rate with Jan 2025 vs the same period last year.",
        [january2025, january2024],
      ),
    ).toBeNull();
    expect(
      evaluate(
        "Show activation rate with Jan 2025 vs the same period last year.",
        [january2024],
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(
      evaluate("Compare activation rate for Jan 2025 with Jan 2024.", [
        january2025,
        january2024,
      ]),
    ).toBeNull();
    expect(
      evaluate("Compare activation rate for Jan 2025 with Jan 2024.", [
        january2025,
      ]),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(
      evaluate(
        "Compare activation rate for Jan 2025 with Jan 2024 and last quarter.",
        [january2025, january2024],
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(
      evaluate(
        "Compare activation rate for Jan 2025 with Jan 2024, this month vs last month.",
        [
          { startDate: "2026-10-01", endDate: "2026-10-01" },
          { startDate: "2026-09-01", endDate: "2026-09-30" },
        ],
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(
      evaluate(
        "Compare activation rate for Jan 2025, this month vs last month.",
        [
          { startDate: "2026-10-01", endDate: "2026-10-01" },
          { startDate: "2026-09-01", endDate: "2026-09-30" },
        ],
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(
      evaluate(
        "Compare activation rate for Jan 2025 with the equivalent period last year and the full year last year.",
        [january2025, january2024],
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(
      evaluate(
        "Compare activation rate for Jan 2026 with last year and the same period one year ago.",
        [{ startDate: "2026-01-01", endDate: "2026-01-31" }, january2025],
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(
      evaluate("Compare activation rate for Q3 2026 with last year.", [
        { startDate: "2026-07-01", endDate: "2026-09-30" },
      ]),
    ).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
  });

  it("fails closed on invalid explicit dates in a year-ago comparison", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Compare activation rate from 2026-13-01 to 2026-13-07 vs the equivalent period one year ago.",
        draftText: "The activation rate was 42%.",
        runStartedAt: Date.UTC(2026, 9, 1, 23, 59),
        toolCalls: [],
        toolResults: [],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
  });

  it("validates both explicit date ranges in a comparison", () => {
    const recent = { startDate: "2026-07-01", endDate: "2026-07-07" };
    const previous = { startDate: "2026-06-01", endDate: "2026-06-07" };
    const evaluate = (
      toolCalls: AgentLoopFinalResponseGuardContext["toolCalls"],
      toolResults: AgentLoopFinalResponseGuardContext["toolResults"],
    ) =>
      realDataFinalGuard(
        guardContext({
          userText:
            "Compare activation rate 2026-07-01 through 2026-07-07 vs 2026-06-01 through 2026-06-07.",
          draftText: "The activation rate was 42% in July and 39% in June.",
          toolCalls,
          toolResults,
        }),
      );

    const recentCall = dbtMetricCall(recent, [], "explicit-recent");
    const previousCall = dbtMetricCall(previous, [], "explicit-previous");
    const recentResult = dbtMetricResult(
      { groupBy: [], timeRange: recent },
      undefined,
      {},
      "explicit-recent",
    );
    const previousResult = dbtMetricResult(
      { groupBy: [], timeRange: previous },
      undefined,
      {},
      "explicit-previous",
    );

    expect(
      evaluate([recentCall, previousCall], [recentResult, previousResult]),
    ).toBeNull();
    expect(
      evaluate([previousCall, recentCall], [previousResult, recentResult]),
    ).toBeNull();
    expect(evaluate([recentCall], [recentResult])).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
  });

  it("resolves past and within rolling periods and rejects vague or sub-day windows", () => {
    const runStartedAt = Date.UTC(2026, 9, 15, 19, 0);
    const rollingWeek = { startDate: "2026-10-09", endDate: "2026-10-15" };
    const pastWeek = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate for the past week?",
        draftText: "The activation rate was 42%.",
        runStartedAt,
        toolCalls: [dbtMetricCall(rollingWeek)],
        toolResults: [dbtMetricResult({ groupBy: [], timeRange: rollingWeek })],
      }),
    );
    const withinLastSevenDays = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate within last 7 days?",
        draftText: "The activation rate was 42%.",
        runStartedAt,
        toolCalls: [dbtMetricCall(rollingWeek)],
        toolResults: [dbtMetricResult({ groupBy: [], timeRange: rollingWeek })],
      }),
    );
    const subDay = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate in the last 6 hours?",
        draftText: "The activation rate was 42%.",
        runStartedAt,
        toolCalls: [dbtMetricCall(rollingWeek)],
        toolResults: [dbtMetricResult({ groupBy: [], timeRange: rollingWeek })],
      }),
    );
    const vague = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate recently?",
        draftText: "The activation rate was 42%.",
        runStartedAt,
        toolCalls: [dbtMetricCall(rollingWeek)],
        toolResults: [dbtMetricResult({ groupBy: [], timeRange: rollingWeek })],
      }),
    );

    expect(pastWeek).toBeNull();
    expect(withinLastSevenDays).toBeNull();
    expect(subDay).toMatchObject({
      retryMessage: expect.stringContaining("ask for a concrete date range"),
    });
    expect(vague).toMatchObject({
      retryMessage: expect.stringContaining("ask for a concrete date range"),
    });
  });

  it("requires requested dbt breakdowns and matches result grouping to input", () => {
    const range = { startDate: "2026-07-01", endDate: "2026-07-07" };
    const grouped = [{ name: "organization_id" }];
    const scalarForBreakdown = realDataFinalGuard(
      guardContext({
        userText:
          "What was the activation rate from 2026-07-01 to 2026-07-07 by organization?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(range)],
        toolResults: [dbtMetricResult({ groupBy: [], timeRange: range })],
      }),
    );
    const mismatchedInput = realDataFinalGuard(
      guardContext({
        userText:
          "What was the activation rate from 2026-07-01 to 2026-07-07 by organization?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(range)],
        toolResults: [dbtMetricResult({ groupBy: grouped, timeRange: range })],
      }),
    );
    const matchingGroup = realDataFinalGuard(
      guardContext({
        userText:
          "What was the activation rate from 2026-07-01 to 2026-07-07 by organization?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(range, grouped)],
        toolResults: [dbtMetricResult({ groupBy: grouped, timeRange: range })],
      }),
    );

    expect(scalarForBreakdown).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(mismatchedInput).toMatchObject({
      retryMessage: expect.stringContaining("same bounded date range"),
    });
    expect(matchingGroup).toBeNull();

    for (const organizationAlias of ["organizations", "orgs"]) {
      expect(
        realDataFinalGuard(
          guardContext({
            userText: `What was the activation rate from 2026-07-01 to 2026-07-07 by ${organizationAlias}?`,
            draftText: `The activation rate was 42% by ${organizationAlias}.`,
            toolCalls: [dbtMetricCall(range, grouped)],
            toolResults: [
              dbtMetricResult({ groupBy: grouped, timeRange: range }),
            ],
          }),
        ),
      ).toBeNull();
    }
  });

  it("matches custom dbt dimensions exactly and fails closed on ambiguity", () => {
    const range = { startDate: "2026-07-01", endDate: "2026-07-07" };
    const lifecycleDimensions = [
      { name: "lifecycle_stage", description: "Lifecycle stage" },
      { name: "metric_time", queryableGranularities: ["DAY"] },
    ];
    const scalar = realDataFinalGuard(
      guardContext({
        userText:
          "What was activation from 2026-07-01 to 2026-07-07 by lifecycle stage?",
        draftText: "Activation was 42%.",
        runStartedAt: Date.UTC(2026, 6, 8),
        toolCalls: [dbtMetricCall(range)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: range }, undefined, {
            metric: {
              name: "activation_rate",
              dimensions: lifecycleDimensions,
            },
          }),
        ],
      }),
    );
    const grouped = [{ name: "lifecycle_stage" }];
    const correct = realDataFinalGuard(
      guardContext({
        userText:
          "What was activation from 2026-07-01 to 2026-07-07 by lifecycle stage?",
        draftText: "Activation was 42% by lifecycle stage.",
        runStartedAt: Date.UTC(2026, 6, 8),
        toolCalls: [dbtMetricCall(range, grouped)],
        toolResults: [
          dbtMetricResult({ groupBy: grouped, timeRange: range }, undefined, {
            metric: {
              name: "activation_rate",
              dimensions: lifecycleDimensions,
            },
          }),
        ],
      }),
    );
    const ambiguous = realDataFinalGuard(
      guardContext({
        userText:
          "What was activation from 2026-07-01 to 2026-07-07 by organization?",
        draftText: "Activation was 42% by organization.",
        runStartedAt: Date.UTC(2026, 6, 8),
        toolCalls: [dbtMetricCall(range)],
        toolResults: [
          dbtMetricResult({ groupBy: [], timeRange: range }, undefined, {
            metric: {
              name: "activation_rate",
              dimensions: [
                { name: "org_id", description: "Organization ID" },
                {
                  name: "workspace_org_id",
                  description: "Owning organization",
                },
              ],
            },
          }),
        ],
      }),
    );
    const overlappingAlias = realDataFinalGuard(
      guardContext({
        userText:
          "What was activation from 2026-07-01 to 2026-07-07 by organization?",
        draftText: "Activation was 42% by organization.",
        runStartedAt: Date.UTC(2026, 6, 8),
        toolCalls: [dbtMetricCall(range, [{ name: "org_id" }])],
        toolResults: [
          dbtMetricResult(
            { groupBy: [{ name: "org_id" }], timeRange: range },
            undefined,
            {
              metric: {
                name: "activation_rate",
                dimensions: [
                  { name: "org_id", description: "Organization ID" },
                  {
                    name: "workspace_org_id",
                    description: "Owning organization",
                  },
                ],
              },
            },
          ),
        ],
      }),
    );

    expect(scalar).toMatchObject({
      retryMessage: expect.stringContaining("requested grouping"),
    });
    expect(correct).toBeNull();
    expect(overlappingAlias).toBeNull();
    expect(ambiguous).toMatchObject({
      retryMessage: expect.stringContaining("requested grouping"),
    });
  });

  it("does not infer organization hierarchy from unrelated dimension prose", () => {
    const range = { startDate: "2026-07-01", endDate: "2026-07-07" };
    const resultFor = (name: string, description: string) => {
      const groupBy = [{ name }];
      return realDataFinalGuard(
        guardContext({
          userText:
            "What was activation from 2026-07-01 to 2026-07-07 by organization?",
          draftText: "Activation was 42% by organization.",
          runStartedAt: Date.UTC(2026, 6, 8),
          toolCalls: [dbtMetricCall(range, groupBy)],
          toolResults: [
            dbtMetricResult({ groupBy, timeRange: range }, undefined, {
              metric: {
                name: "activation_rate",
                dimensions: [{ name, description }],
              },
            }),
          ],
        }),
      );
    };

    expect(
      resultFor("organization_id", "Top-level tier of each organization"),
    ).toBeNull();
    expect(resultFor("organization_id", "Root or member account")).toBeNull();
    expect(resultFor("root", "Organization")).toBeNull();
  });

  it("uses a validated selected dbt dimension when the definition summary is truncated", () => {
    const range = { startDate: "2026-07-01", endDate: "2026-07-07" };
    const visibleDimensions = Array.from({ length: 30 }, (_, index) => ({
      name: `dimension_${index}`,
      description: `Dimension ${index}`,
    }));
    const metric = {
      name: "activation_rate",
      dimensions: visibleDimensions,
      dimensionsCount: 31,
      dimensionsTruncated: true,
    };
    const groupBy = [{ name: "organization_id" }];
    const valid = realDataFinalGuard(
      guardContext({
        userText:
          "What was activation from 2026-07-01 to 2026-07-07 by organization?",
        draftText: "Activation was 42% by organization.",
        runStartedAt: Date.UTC(2026, 6, 8),
        toolCalls: [dbtMetricCall(range, groupBy)],
        toolResults: [
          dbtMetricResult({ groupBy, timeRange: range }, undefined, { metric }),
        ],
      }),
    );
    const mismatched = realDataFinalGuard(
      guardContext({
        userText:
          "What was activation from 2026-07-01 to 2026-07-07 by organization?",
        draftText: "Activation was 42% by organization.",
        runStartedAt: Date.UTC(2026, 6, 8),
        toolCalls: [dbtMetricCall(range, [{ name: "source_name" }])],
        toolResults: [
          dbtMetricResult(
            { groupBy: [{ name: "source_name" }], timeRange: range },
            undefined,
            { metric },
          ),
        ],
      }),
    );

    expect(valid).toBeNull();
    expect(mismatched).toMatchObject({
      retryMessage: expect.stringContaining("requested grouping"),
    });
  });

  it("checks the requested dbt metric-time grain", () => {
    const range = { startDate: "2026-07-01", endDate: "2026-07-07" };
    const weekly = [{ name: "metric_time", grain: "WEEK" }];
    const daily = [{ name: "metric_time", grain: "DAY" }];
    const missing = realDataFinalGuard(
      guardContext({
        userText:
          "What was the activation rate from 2026-07-01 to 2026-07-07 by week?",
        draftText: "The activation rate was 42% by week.",
        toolCalls: [dbtMetricCall(range)],
        toolResults: [dbtMetricResult({ groupBy: [], timeRange: range })],
      }),
    );
    const wrongGrain = realDataFinalGuard(
      guardContext({
        userText:
          "What was the activation rate from 2026-07-01 to 2026-07-07 by week?",
        draftText: "The activation rate was 42% by week.",
        toolCalls: [dbtMetricCall(range, daily)],
        toolResults: [dbtMetricResult({ groupBy: daily, timeRange: range })],
      }),
    );
    const correct = realDataFinalGuard(
      guardContext({
        userText:
          "What was the activation rate from 2026-07-01 to 2026-07-07 by week?",
        draftText: "The activation rate was 42% by week.",
        toolCalls: [dbtMetricCall(range, weekly)],
        toolResults: [dbtMetricResult({ groupBy: weekly, timeRange: range })],
      }),
    );

    expect(missing).toMatchObject({
      retryMessage: expect.stringContaining("requested grouping"),
    });
    expect(wrongGrain).toMatchObject({
      retryMessage: expect.stringContaining("requested grouping"),
    });
    expect(correct).toBeNull();
  });

  it("uses the latest successful dbt result after an exploratory mismatch", () => {
    const correctRange = { startDate: "2026-07-01", endDate: "2026-07-07" };
    const wrongRange = { startDate: "2026-06-01", endDate: "2026-06-07" };
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate from 2026-07-01 to 2026-07-07?",
        draftText: "The activation rate was 42%.",
        toolCalls: [
          dbtMetricCall(wrongRange, [], "exploratory-query"),
          dbtMetricCall(correctRange, [], "final-query"),
        ],
        toolResults: [
          dbtMetricResult(
            { groupBy: [], timeRange: wrongRange },
            undefined,
            {},
            "exploratory-query",
          ),
          dbtMetricResult(
            { groupBy: [], timeRange: correctRange },
            undefined,
            {},
            "final-query",
          ),
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("does not interpret an origin country as a bounded date request", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was the product revenue from Germany?",
        draftText: "The product revenue was 42.",
        toolCalls: [
          {
            name: "query-dbt-semantic-metric",
            input: { metricName: "product_revenue", allTime: true },
          },
        ],
        toolResults: [
          dbtMetricResult({ groupBy: [], allTime: true }, [{ value: 42 }], {
            metricName: "product_revenue",
            metric: { name: "product_revenue", dimensions: [] },
          }),
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("fails closed when dbt returns malformed result evidence for a bounded request", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate last week?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(activationRateWeek)],
        toolResults: [
          {
            name: "query-dbt-semantic-metric",
            isError: false,
            content: "not valid JSON",
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("no structured metric status"),
    });
  });

  it("uses status-specific dbt recovery guidance instead of accepting a numeric claim", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate last week?",
        draftText: "The activation rate was 42%.",
        toolResults: [
          {
            name: "query-dbt-semantic-metric",
            isError: false,
            content: JSON.stringify({ status: "deployment_not_ready" }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(
        "Wait for a successful dbt deployment run",
      ),
      fallbackMessage: expect.stringContaining(
        "Wait for a successful dbt deployment run",
      ),
    });
  });

  it.each(["query-dbt-semantic-metric", "query_dbt_semantic_metric"])(
    "does not let a safe no-data draft bypass typed dbt status failure from %s",
    (toolName) => {
      const result = realDataFinalGuard(
        guardContext({
          userText: "What was the activation rate last week?",
          draftText:
            "I can't retrieve this metric because the dbt deployment is not ready.",
          toolResults: [
            {
              name: toolName,
              isError: false,
              content: JSON.stringify({ status: "deployment_not_ready" }),
            },
          ],
        }),
      );

      expect(result).toMatchObject({
        retryMessage: expect.stringContaining(
          "Wait for a successful dbt deployment run",
        ),
        fallbackMessage: expect.stringContaining(
          "Wait for a successful dbt deployment run",
        ),
      });
    },
  );

  it("continues paginated dbt metric rows before accepting a complete answer", () => {
    const resultPageRange = {
      startDate: "2026-10-05",
      endDate: "2026-10-11",
    };
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate last week?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(resultPageRange)],
        toolResults: [
          {
            name: "query-dbt-semantic-metric",
            isError: false,
            content: JSON.stringify({
              status: "success",
              metricName: "activation_rate",
              querySpec: { groupBy: [], timeRange: resultPageRange },
              rows: [{ activation_rate: 42 }],
              truncated: true,
              nextPage: "metric-results-v4.cursor.signature",
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(
        "Continue with the same metricName, queryId, and nextPage",
      ),
      fallbackMessage: expect.stringContaining("result page"),
    });
  });

  it("requires partial disclosure when the dbt metric row cap has no cursor", () => {
    const resultPageRange = {
      startDate: "2026-10-05",
      endDate: "2026-10-11",
    };
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was the activation rate last week?",
        draftText: "The activation rate was 42%.",
        toolCalls: [dbtMetricCall(resultPageRange)],
        toolResults: [
          {
            name: "query-dbt-semantic-metric",
            isError: false,
            content: JSON.stringify({
              status: "success",
              metricName: "activation_rate",
              querySpec: { groupBy: [], timeRange: resultPageRange },
              rows: [{ activation_rate: 42 }],
              truncated: true,
              truncationReason: "query_row_cap",
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("1,000-row result cap"),
      fallbackMessage: expect.stringContaining("returned rows as partial"),
    });
  });

  it("preserves safe no-data answers for unrelated provider failures", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "How many signups did we get last week?",
        draftText:
          "I can't retrieve this analytics result because the query failed.",
        toolResults: [
          {
            name: "bigquery",
            isError: false,
            content: JSON.stringify({
              error: "bigquery_query_failed",
              message: "Temporary provider failure.",
            }),
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("keeps cursor-bearing dbt failures on their status-specific recovery path", () => {
    const resultPageRange = {
      startDate: "2026-10-05",
      endDate: "2026-10-11",
    };
    const result = realDataFinalGuard(
      guardContext({
        userText: "Find every account's activation rate for last week.",
        draftText: "All accounts had an activation rate of 42%.",
        toolCalls: [dbtMetricCall(resultPageRange)],
        toolResults: [
          {
            name: "query-dbt-semantic-metric",
            isError: false,
            content: JSON.stringify({
              status: "pending",
              metricName: "activation_rate",
              querySpec: { groupBy: [], timeRange: resultPageRange },
              nextPage: "opaque-cursor",
              message: "The MetricFlow query is still running.",
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("Resume the same MetricFlow query"),
      fallbackMessage: expect.stringContaining(
        "Resume the same MetricFlow query",
      ),
    });
  });

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

  it("judges a question the user wrapped in context tags", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "<context>How many sessions did we record in the last 24 hours?</context>",
        draftText: "We recorded 41,208 sessions in the last 24 hours.",
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

  it("tries first-party Analytics when the only external source has an unhealthy grant", () => {
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
                {
                  provider: "hubspot",
                  label: "HubSpot",
                  via: "workspace-grant",
                  setupLink: "/data-sources?source=hubspot",
                },
              ],
              providers: [
                {
                  provider: "hubspot",
                  label: "HubSpot",
                  configured: true,
                  credentialsConfigured: false,
                  configuredKeys: [],
                  missingRequiredKeys: ["HUBSPOT_PRIVATE_APP_TOKEN"],
                  optionalKeys: [],
                  workspaceConnection: {
                    provider: "hubspot",
                    grantState: "granted",
                    connectionCount: 1,
                    grantedConnectionCount: 1,
                    activeConnectionCount: 0,
                    hasWorkspaceConnection: true,
                    hasGrantedWorkspaceConnection: true,
                    hasActiveWorkspaceConnection: false,
                    statuses: ["needs_reauth"],
                  },
                },
              ],
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("query-agent-native-analytics"),
      maxRetries: 2,
      expandToolSurface: true,
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

  it("continues roster discovery after an empty and incomplete find-data result", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Find the Builder.io user roster by organization and membership roles",
        draftText:
          "I can't confirm a row-grain membership source from the catalog, and the index may not include every source.",
        toolResults: [
          {
            name: "find-data",
            isError: false,
            content: JSON.stringify({
              results: [],
              sourceIndexStatus: "not-configured",
              truncated: true,
              nextPage: null,
              dashboardDetailHydrationTruncated: true,
              dashboardPanelReferenceSearchTruncated: true,
              dashboardPanelReferenceNextPage: "synthetic-dashboard-cursor",
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("search-bigquery-schema"),
      fallbackMessage: expect.stringContaining(
        "does not show that the source is absent",
      ),
      maxRetries: 2,
      expandToolSurface: true,
    });
    expect((result as { retryMessage: string }).retryMessage).toContain(
      "dashboardPanelReferenceNextPage",
    );
  });

  it("continues a partial schema search instead of accepting an unscoped roster absence", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Find the Builder.io user roster by organization and membership roles",
        draftText:
          "No membership table was found, so the user roster source does not exist.",
        toolResults: [
          {
            name: "find-data",
            isError: false,
            content: JSON.stringify({
              results: [],
              sourceIndexStatus: "available",
            }),
          },
          {
            name: "search-bigquery-schema",
            isError: false,
            content: JSON.stringify({
              mode: "table-search",
              search: "organization membership user role",
              searched: 250,
              of: 0,
              tables: [],
              truncated: true,
              nextPage: "synthetic-schema-cursor",
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("search-bigquery-schema"),
      fallbackMessage: expect.stringContaining(
        "does not show that the source is absent",
      ),
    });
  });

  it("requires scoped wording after a complete schema search finds no roster tables", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Find the Builder.io user roster by organization and membership roles",
        draftText:
          "No membership table was found, so the user roster source does not exist.",
        toolResults: [
          {
            name: "find-data",
            isError: false,
            content: JSON.stringify({
              results: [],
              sourceIndexStatus: "available",
            }),
          },
          {
            name: "search-bigquery-schema",
            isError: false,
            content: JSON.stringify({
              mode: "table-search",
              search: "organization membership user role",
              searched: 250,
              of: 0,
              tables: [],
              truncated: false,
              nextPage: null,
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("configured project/schema"),
      fallbackMessage: expect.stringContaining(
        "does not establish that a membership source is absent",
      ),
    });
  });

  it("allows a roster absence statement scoped to the completed schema search", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Find the Builder.io user roster by organization and membership roles",
        draftText:
          "I found no organization membership table in the configured BigQuery project schema search; that result does not rule out a source in another system.",
        toolResults: [
          {
            name: "find-data",
            isError: false,
            content: JSON.stringify({
              results: [],
              sourceIndexStatus: "available",
            }),
          },
          {
            name: "search-bigquery-schema",
            isError: false,
            content: JSON.stringify({
              mode: "table-search",
              search: "organization membership user role",
              searched: 250,
              of: 0,
              tables: [],
              truncated: false,
              nextPage: null,
            }),
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("requires a query after complete schema discovery finds candidate roster tables", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Find the Builder.io user roster by organization and membership roles",
        draftText:
          "I can't report the roster yet because I have not run a query.",
        toolResults: [
          {
            name: "find-data",
            isError: false,
            content: JSON.stringify({
              results: [],
              sourceIndexStatus: "available",
            }),
          },
          {
            name: "search-bigquery-schema",
            isError: false,
            content: JSON.stringify({
              mode: "table-search",
              search: "organization membership user role",
              searched: 250,
              of: 1,
              tables: [
                {
                  datasetId: "synthetic_dataset",
                  tableId: "synthetic_members",
                },
              ],
              truncated: false,
              nextPage: null,
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining("run a bounded live query"),
      fallbackMessage: expect.stringContaining(
        "did not verify their row grain",
      ),
    });
  });

  it("accepts a finished answer that mentions tables and says to tell the agent what else is wrong", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "That cohort table doesn't make any sense",
        draftText:
          "I found and fixed two data bugs in the cohort table. I'm guessing at what looked wrong, so tell me if something else is bothering you. Both panels now render (43 rows in the table, 12 months in the line).\n\n**What was wrong**\n- The query summed `current_month_pageviews`, which holds one frozen figure per account. MagMutual is now 0.06% for the year.",
        toolResults: [
          { name: "bigquery", isError: false, content: '{"rows":[{"n":43}]}' },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("still retries a question asking the user which table to use", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Pull AI credit usage by user for each month",
        draftText: "Which table holds the monthly credit usage?",
      }),
    );

    expect(result).toMatchObject({
      maxRetries: 2,
      retryMessage: expect.stringContaining(
        "Do not ask the user for warehouse schema identifiers",
      ),
    });
  });

  it("does not retry a verified dashboard edit for quoting the rows it rendered", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Add a line chart panel for monthly pageviews",
        draftText:
          "Added the line chart. It renders 12 months and the table shows 43 accounts.",
        toolResults: [
          {
            name: "mutate-dashboard",
            isError: false,
            content: '{"saved":true,"changed":true}',
            receipt: {
              changed: true,
              verified: true,
              summary: "Saved the dashboard.",
              checks: [
                {
                  id: "pageviews-line",
                  ok: true,
                  detail: "renders 12 row(s), columns [month, pageviews]",
                },
              ],
            },
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("still retries figures after a save that only checked a section panel", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Rename the pageviews panel",
        draftText:
          "Renamed the panel. The table shows 43 accounts under 5% utilization.",
        toolResults: [
          {
            name: "mutate-dashboard",
            isError: false,
            content: '{"saved":true,"changed":true}',
            receipt: {
              changed: true,
              verified: true,
              summary:
                "Saved 1 op(s); 1 section/extension panel(s) not data-checked.",
              checks: [
                {
                  id: "intro",
                  ok: true,
                  detail:
                    "is a section panel with no data to run; only its config was checked",
                },
              ],
            },
          },
        ],
      }),
    );

    expect(result).toMatchObject({ maxRetries: 2 });
  });

  it("still retries figures after a save that checked no panel", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Rename the pageviews panel",
        draftText:
          "Renamed the panel. The table shows 43 accounts under 5% utilization.",
        toolResults: [
          {
            name: "mutate-dashboard",
            isError: false,
            content: '{"saved":true,"changed":true}',
            receipt: {
              changed: true,
              verified: true,
              summary:
                "Saved 1 op(s); no panel render was affected, so no panel was checked.",
            },
          },
        ],
      }),
    );

    expect(result).toMatchObject({ maxRetries: 2 });
  });

  it.each([
    "I can provide a table of the results if that helps.",
    "I need the table to reload, so I re-ran the query and it shows 43 accounts.",
    "There are 43 accounts. Want me to show which table this came from?",
    "There are 43 accounts. Would you like me to show which table this came from?",
    "There are 43 accounts. I need to know the table is current before I answer, so I re-ran it.",
    "I fixed both panels, so tell me what else is off:\n- the table now shows 43 rows\n- the column labels are swapped back",
    "I fixed both panels. Tell me what else is off: the table shows 43 rows.",
    "Tell me if anything else is off, since the table still shows 43 rows.",
    "I fixed both panels. Can you tell me what else is off:\n- the table shows 43 rows",
    "Tell me if anything else is off and the table shows 43 rows.",
    "Could you confirm the table has 43 rows?",
    "Could you check the table has 43 rows?",
    "Could you explain what the table represents?",
    "I need the table that has the current data, so I re-ran the query and it shows 43 rows.",
    "I need the table that holds the current figures, so I re-ran the query and it shows 43 rows.",
    "Could you show me the table?",
    "Can you show which table this came from?",
    "There are 43 accounts. Which table rows were excluded from the 43 count?",
    "There are 43 accounts. What is the table size relative to last month?",
    "I fixed both panels. Can you share anything else that's off:\n- the table shows 43 rows",
    "I need you to confirm the table is current, so I re-ran it and it shows 43 rows.",
    "I need to know what the table shows before I answer, so I re-ran it and it has 43 rows.",
    "I need to know what the table name is, so I looked it up and it is usage_monthly.",
    "I need to know which table holds usage, so I searched the catalog and it is usage_monthly.",
    "I need to know which table this came from. I re-ran the query and it shows 43 rows.",
    "I need the table name, so I looked it up and it is usage_monthly.",
    "I need to know which table holds usage. I checked the catalog and it is usage_monthly.",
    "I need the table name, so I looked it up and it is usage_monthly, not usage_daily.",
    "I need the table name. So I've checked the catalog and it is usage_monthly.",
    "I need the table name, so I've looked it up and it is usage_monthly.",
    "I need to know which table holds usage. I checked the catalog and it is usage_monthly, with no other table for this.",
    "I need to know which table holds usage. I checked the catalog and found no other table.",
    "There are 43 accounts. Which row in the table is wrong?",
  ])(
    "does not treat the agent's own narration as a schema request: %s",
    (draftText) => {
      const result = realDataFinalGuard(
        guardContext({
          userText: "How many accounts are under 5% utilization?",
          draftText,
          toolResults: [
            {
              name: "bigquery",
              isError: false,
              content: '{"rows":[{"n":43}]}',
            },
          ],
        }),
      );

      expect(result).toBeNull();
    },
  );

  it("retries a schema ask even after a verified non-data dashboard save", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Rename the pageviews panel",
        draftText:
          "Renamed the panel. Could you provide the BigQuery dataset name?",
        toolResults: [
          {
            name: "mutate-dashboard",
            isError: false,
            content: '{"saved":true,"changed":true}',
            receipt: {
              changed: true,
              verified: true,
              summary: "Saved the dashboard.",
              checks: [{ id: "intro", ok: true, detail: "is a section panel" }],
            },
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(
        "Do not ask the user for warehouse schema identifiers",
      ),
    });
  });

  it("keeps the draft once the schema-request retries are spent", () => {
    const draftText =
      "Could you provide the BigQuery dataset name or the exact SQL query?";
    const context = (retryCount: number) =>
      guardContext({
        userText: "Pull AI credit usage by user for each month",
        draftText,
        retryCount,
      });

    expect(realDataFinalGuard(context(1))).toMatchObject({ maxRetries: 2 });
    expect(realDataFinalGuard(context(2))).toBeNull();
  });

  it("still checks unsupported figures after the schema-request retries are spent", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "How many accounts are under 5% utilization?",
        draftText:
          "Revenue was $4.2M across 43 accounts. Could you provide the BigQuery dataset name?",
        retryCount: 2,
      }),
    );

    expect(result).not.toBeNull();
    expect(
      (result as { retryMessage?: string } | string | null) &&
        typeof result === "object" &&
        (result as { retryMessage: string }).retryMessage,
    ).not.toContain("Do not ask the user for warehouse schema identifiers");
  });

  it.each([
    "I need the table name before I can continue.",
    "I need a table name before I can continue.",
    "I need to know which table holds monthly usage before I can continue.",
    "I need to know the table name before I can continue.",
    "I need to know what the table name is before I can continue.",
    "I need to know what table holds monthly usage before I can continue.",
    "What is the name of the table?",
    "What is the table name?",
    "What is the current table name?",
    "What is the active dataset name?",
    "What is the name of the source table?",
    "I need to know what the current table name is before I can continue.",
    "I need to know which table holds monthly usage so I can write the query.",
    "I need the table name so I can write the query.",
    "I need the table name, so I cannot continue until you send it.",
    "I need the table name so I can write the query. Separately, the account count is ready, so I sent the summary.",
    "I need the table name. Separately, I ran the revenue query and it returned 43 rows.",
    "I need to know which table holds usage. Separately, I checked the revenue dashboard and it shows 43 rows.",
    "I need the table name. I ran into a problem finding it in the catalog.",
    "Which table for monthly usage?",
    "Which dataset for this metric?",
    "Which table to use for monthly usage?",
    "Which source table holds usage?",
    "Which warehouse table for monthly usage?",
    "Which BigQuery dataset should I use?",
    "What is the schema?",
    "What is the SQL query?",
    "What SQL query should I use?",
    "What are the schema details for usage?",
    "I need the table name. I looked in the catalog and found no table matching usage.",
    "I need the table name before I can continue. I searched the catalog, but nothing matched.",
    "I need the table name. I checked the catalog and couldn't find it.",
    "I need to know which table holds usage. I searched the catalog. Nothing matched.",
    "I need the table name. I looked in the catalog and found nothing.",
    "I need the dataset name so I could build the chart.",
    "Do you know which table holds the monthly credit usage?",
    "I need the schema before I can write this query.",
    "I need the column that holds usage before I can continue.",
    "For this metric, which table holds the monthly usage?",
    "I need the name of the table before I can continue.",
    "I need table names before I can continue.",
    "Could you let me know which table holds monthly usage?",
    "Could you clarify which table holds monthly usage?",
    "Could you show me the table name?",
    "Could you show me which table holds monthly usage?",
    "Could you describe which table holds monthly usage?",
    "Could you explain what the dataset name is?",
    "Could you check which table holds monthly usage?",
    "Could you confirm which table holds monthly usage?",
    "Could you verify the dataset name?",
    "Can you check the dataset name?",
    "Would you mind providing the dataset name?",
    "Could you provide the following?\n- the BigQuery dataset name",
    "What table stores monthly credit usage?",
    "To continue, please provide:\n- the dataset name\n- the column that holds usage",
    "To continue, please provide the following:\n\n- the dataset name\n- the column that holds usage",
    "Share the dataset name.",
  ])("retries a request for schema details: %s", (draftText) => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Pull AI credit usage by user for each month",
        draftText,
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(
        "Do not ask the user for warehouse schema identifiers",
      ),
    });
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

  it("reviews an inactive granted source instead of asking to connect it again", () => {
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
                {
                  provider: "hubspot",
                  label: "HubSpot",
                  via: "credentials-and-workspace-grant",
                },
              ],
              providers: [
                {
                  provider: "hubspot",
                  label: "HubSpot",
                  configured: true,
                  credentialsConfigured: false,
                  configuredKeys: [],
                  setupLink: hubspotSetupLink,
                  workspaceConnection: {
                    grantState: "granted",
                    activeConnectionCount: 0,
                  },
                },
              ],
              dataSourcesSetupLink:
                "/_agent-native/open?app=analytics&view=data-sources",
              workspaceConnections: {
                appId: "analytics",
                available: true,
                error: null,
                providers: [
                  {
                    id: "hubspot",
                    label: "HubSpot",
                    grantState: "granted",
                    activeConnectionCount: 0,
                    statuses: ["needs_reauth"],
                  },
                ],
              },
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(
        `[Review HubSpot connection](${hubspotSetupLink})`,
      ),
      fallbackMessage: expect.stringContaining(
        `[Review HubSpot connection](${hubspotSetupLink})`,
      ),
    });
    expect((result as { retryMessage: string }).retryMessage).toContain(
      "already has an Analytics workspace grant, but no healthy connection is active",
    );
    expect((result as { retryMessage: string }).retryMessage).not.toContain(
      `[Connect HubSpot](${hubspotSetupLink})`,
    );
    expect(
      (result as { fallbackMessage: string }).fallbackMessage,
    ).not.toContain(`[Connect HubSpot](${hubspotSetupLink})`);
  });

  it("reviews an inactive BigQuery grant in an older optional-key-only status", () => {
    const bigquerySetupLink =
      "/_agent-native/open?app=analytics&view=data-sources&to=%2Fdata-sources%3Fsource%3Dbigquery%26returnTo%3Dask";
    const result = realDataFinalGuard(
      guardContext({
        userText: "show me our BigQuery usage",
        draftText: "BigQuery is not connected yet.",
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
                {
                  provider: "bigquery",
                  label: "BigQuery",
                  via: "credentials-and-workspace-grant",
                },
              ],
              providers: [
                {
                  provider: "bigquery",
                  label: "BigQuery",
                  configured: true,
                  configuredKeys: ["ANALYTICS_BIGQUERY_EVENTS_TABLE"],
                  optionalKeys: ["ANALYTICS_BIGQUERY_EVENTS_TABLE"],
                  setupLink: bigquerySetupLink,
                  workspaceConnection: {
                    grantState: "granted",
                    activeConnectionCount: 0,
                  },
                },
              ],
              dataSourcesSetupLink:
                "/_agent-native/open?app=analytics&view=data-sources",
              workspaceConnections: {
                appId: "analytics",
                available: true,
                error: null,
                providers: [
                  {
                    id: "bigquery",
                    label: "BigQuery",
                    grantState: "granted",
                    activeConnectionCount: 0,
                    statuses: ["error"],
                  },
                ],
              },
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(
        `[Review BigQuery connection](${bigquerySetupLink})`,
      ),
      fallbackMessage: expect.stringContaining(
        `[Review BigQuery connection](${bigquerySetupLink})`,
      ),
    });
    expect((result as { retryMessage: string }).retryMessage).toContain(
      "already has an Analytics workspace grant, but no healthy connection is active",
    );
    expect((result as { retryMessage: string }).retryMessage).not.toContain(
      `[Connect BigQuery](${bigquerySetupLink})`,
    );
    expect(
      (result as { fallbackMessage: string }).fallbackMessage,
    ).not.toContain(`[Connect BigQuery](${bigquerySetupLink})`);
  });

  it("offers Connect when a legacy needs-grant provider is missing required credentials", () => {
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
                {
                  provider: "hubspot",
                  label: "HubSpot",
                  via: "credentials-and-workspace-grant",
                },
              ],
              providers: [
                {
                  provider: "hubspot",
                  label: "HubSpot",
                  configured: true,
                  credentialsConfigured: false,
                  configuredKeys: [],
                  missingRequiredKeys: ["HUBSPOT_PRIVATE_APP_TOKEN"],
                  optionalKeys: [],
                  setupLink: hubspotSetupLink,
                  workspaceConnection: {
                    grantState: "needs_grant",
                    activeConnectionCount: 0,
                  },
                },
              ],
              workspaceConnections: {
                appId: "analytics",
                available: true,
                error: null,
                providers: [
                  {
                    id: "hubspot",
                    label: "HubSpot",
                    grantState: "needs_grant",
                    activeConnectionCount: 0,
                    statuses: ["error"],
                  },
                ],
              },
              dataSourcesSetupLink:
                "/_agent-native/open?app=analytics&view=data-sources",
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
      "configured sources without a healthy workspace connection: HubSpot",
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

  it("requires BigQuery warning rows to be disclosed as partial", () => {
    const toolResults = [
      {
        name: "bigquery",
        isError: false,
        content: JSON.stringify({
          rows: [{ signups: 42 }],
          partial: true,
          warnings: [{ reason: "other", message: "One shard was unavailable" }],
        }),
      },
    ];

    expect(
      realDataFinalGuard(
        guardContext({
          userText: "How many signups did we get yesterday?",
          draftText: "We got 42 signups yesterday.",
          toolResults,
        }),
      ),
    ).toMatchObject({
      maxRetries: 2,
      retryMessage: expect.stringContaining("result is partial"),
      fallbackMessage: expect.stringContaining(
        "incomplete or its output was truncated",
      ),
    });
    expect(
      realDataFinalGuard(
        guardContext({
          userText: "How many signups did we get yesterday?",
          draftText:
            "The partial result reports 42 signups yesterday; BigQuery warned that one shard was unavailable, so the total may be incomplete.",
          toolResults,
        }),
      ),
    ).toBeNull();
    expect(
      realDataFinalGuard(
        guardContext({
          userText: "How many signups did we get yesterday?",
          draftText:
            "The partial result reports 42 signups yesterday; BigQuery warned that one shard was unavailable, so the total may be incomplete. The returned total is complete.",
          toolResults,
        }),
      ),
    ).toMatchObject({
      maxRetries: 2,
      retryMessage: expect.stringContaining("result is partial"),
    });
    for (const draftText of [
      "The signups were 42 yesterday; a sample dashboard is available here.",
      "BigQuery returned a partial result: 42 signups yesterday.",
    ]) {
      expect(
        realDataFinalGuard(
          guardContext({
            userText: "How many signups did we get yesterday?",
            draftText,
            toolResults,
          }),
        ),
      ).toMatchObject({
        maxRetries: 2,
        fallbackMessage: expect.stringContaining(
          "incomplete or its output was truncated",
        ),
      });
    }
  });

  it("requires a row-cap explanation for a truncated BigQuery answer", () => {
    const toolResults = [
      {
        name: "bigquery",
        isError: false,
        content: JSON.stringify({ rows: [{ signups: 42 }], truncated: true }),
      },
    ];
    const unrelatedSample = realDataFinalGuard(
      guardContext({
        userText: "How many signups did we get yesterday?",
        draftText: "This sample shows 42 signups yesterday.",
        toolResults,
      }),
    );
    const disclosed = realDataFinalGuard(
      guardContext({
        userText: "How many signups did we get yesterday?",
        draftText:
          "BigQuery returned a truncated result with 42 signups; the row cap may omit additional rows.",
        toolResults,
      }),
    );

    expect(unrelatedSample).toMatchObject({
      fallbackMessage: expect.stringContaining(
        "incomplete or its output was truncated",
      ),
    });
    expect(disclosed).toBeNull();
  });

  it("requires disclosure when the production tool-result limit truncates BigQuery metadata", () => {
    const toolResults = [
      {
        name: "bigquery",
        isError: false,
        content:
          '{"rows":[{"signups":42}],"partial":true\n\n...[truncated — full result was 200\u202f000 chars; only first 50\u202f000 shown]',
      },
    ];
    const undisclosed = realDataFinalGuard(
      guardContext({
        userText: "How many signups did we get yesterday?",
        draftText: "We got 42 signups yesterday.",
        toolResults,
      }),
    );
    const disclosed = realDataFinalGuard(
      guardContext({
        userText: "How many signups did we get yesterday?",
        draftText:
          "BigQuery returned 42 signups, but the tool output was truncated, so the displayed rows may omit additional results.",
        toolResults,
      }),
    );

    expect(undisclosed).toMatchObject({
      maxRetries: 2,
      fallbackMessage: expect.stringContaining(
        "incomplete or its output was truncated",
      ),
    });
    expect(disclosed).toBeNull();
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

  it("gives the unverified fallback the dbt readiness reason and does not count a not-ready dbt grant as healthy", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was our signup conversion last week?",
        draftText: "Signup conversion was 4.2% last week.",
        toolResults: [
          {
            name: "data-source-status",
            isError: false,
            content: JSON.stringify({
              workspaceConnections: {
                appId: "analytics",
                available: true,
                providers: [
                  {
                    id: "github",
                    label: "GitHub",
                    grantState: "connected",
                  },
                  {
                    id: "dbt",
                    label: "dbt Cloud",
                    grantState: "connected",
                    dbtReadiness: "token_missing",
                  },
                ],
              },
            }),
          },
        ],
      }),
    );

    const note =
      "The dbt Semantic Layer is not ready: The dbt Semantic Layer token is not saved. Set it up on the [Semantic Layer page](";
    expect(result).toMatchObject({
      exhaustedDraftPrefix: expect.stringContaining(note),
      fallbackMessage: expect.stringContaining(note),
    });
    expect(
      (result as { exhaustedDraftPrefix: string }).exhaustedDraftPrefix,
    ).toContain("healthy workspace connections: GitHub");
    expect(
      (result as { exhaustedDraftPrefix: string }).exhaustedDraftPrefix,
    ).not.toContain("dbt Cloud");
  });

  it("distinguishes configured credentials from healthy workspace connections in guard copy", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was the HubSpot pipeline amount last week?",
        draftText: "HubSpot pipeline was $25,000 last week.",
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
                {
                  provider: "hubspot",
                  label: "HubSpot",
                  via: "credentials-and-workspace-grant",
                },
                { provider: "github", label: "GitHub", via: "workspace" },
              ],
              providers: [
                {
                  provider: "hubspot",
                  label: "HubSpot",
                  configured: true,
                  credentialsConfigured: true,
                  configuredKeys: ["HUBSPOT_PRIVATE_APP_TOKEN"],
                  workspaceConnection: { grantState: "granted" },
                },
                {
                  provider: "github",
                  label: "GitHub",
                  configured: true,
                  configuredKeys: [],
                  workspaceConnection: { grantState: "connected" },
                },
              ],
              workspaceConnections: {
                appId: "analytics",
                available: true,
                providers: [
                  {
                    id: "hubspot",
                    provider: "hubspot",
                    label: "HubSpot",
                    grantState: "granted",
                  },
                  {
                    id: "github",
                    provider: "github",
                    label: "GitHub",
                    grantState: "connected",
                  },
                ],
              },
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      maxRetries: 2,
      retryMessage: expect.stringContaining(
        "configured sources without a healthy workspace connection: HubSpot",
      ),
      fallbackMessage: expect.stringContaining(
        "configured sources without a healthy workspace connection: HubSpot",
      ),
      exhaustedDraftPrefix: expect.stringContaining(
        "healthy workspace connections: GitHub",
      ),
    });
    expect((result as { retryMessage: string }).retryMessage).toContain(
      "healthy workspace connections: GitHub",
    );
    expect((result as { retryMessage: string }).retryMessage).not.toContain(
      "connected sources: HubSpot",
    );
  });

  it("treats granted-but-not-connected workspace sources as configured and unverified", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "What was our GitHub issue volume last week?",
        draftText: "GitHub had 42 issues last week.",
        toolResults: [
          {
            name: "data-source-status",
            isError: false,
            content: JSON.stringify({
              providers: [
                {
                  provider: "github",
                  label: "GitHub",
                  configured: false,
                  setupLink: "/data-sources?source=github",
                  workspaceConnection: { grantState: "granted" },
                },
                {
                  provider: "hubspot",
                  label: "HubSpot",
                  configured: true,
                  workspaceConnection: { grantState: "connected" },
                },
              ],
              workspaceConnections: {
                appId: "analytics",
                available: true,
                providers: [
                  {
                    id: "github",
                    provider: "github",
                    label: "GitHub",
                    grantState: "granted",
                  },
                  {
                    id: "hubspot",
                    provider: "hubspot",
                    label: "HubSpot",
                    grantState: "connected",
                  },
                ],
              },
            }),
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(
        "configured sources without a healthy workspace connection: GitHub",
      ),
      fallbackMessage: expect.stringContaining(
        "configured sources without a healthy workspace connection: GitHub",
      ),
    });
    expect((result as { retryMessage: string }).retryMessage).toContain(
      "healthy workspace connections: HubSpot",
    );
    expect((result as { retryMessage: string }).retryMessage).not.toContain(
      "requested external source is not connected",
    );
    expect((result as { retryMessage: string }).retryMessage).not.toContain(
      "Connect GitHub",
    );
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
