import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  availableEmbeddingFamilies: vi.fn(),
  getActiveEmbeddingSet: vi.fn(),
  searchAnalyticsQueryCatalog: vi.fn(),
  embed: vi.fn(),
}));

vi.mock("@agent-native/core/embeddings", () => ({
  availableEmbeddingFamilies: mocks.availableEmbeddingFamilies,
  defaultEmbeddingFamily: (families: unknown[]) =>
    families.length === 1 ? families[0] : null,
}));
vi.mock("@agent-native/creative-context/store", () => ({
  getActiveEmbeddingSet: mocks.getActiveEmbeddingSet,
}));
vi.mock("./analytics-query-catalog", () => ({
  candidateTrustTier: (candidate: AnalyticsQueryCatalogCandidate) =>
    candidate.kind === "dashboard-panel"
      ? candidate.dashboardCertified
        ? 2
        : candidate.favorite
          ? 1
          : 0
      : 0,
  searchAnalyticsQueryCatalog: mocks.searchAnalyticsQueryCatalog,
}));

import {
  retrieveAnalyticsPromptReferences,
  summarizeAnalyticsRun,
} from "./analytics-agent-context";
import type { AnalyticsQueryCatalogCandidate } from "./analytics-query-catalog";

const candidates: AnalyticsQueryCatalogCandidate[] = [
  {
    kind: "data-dictionary",
    origin: "data-dictionary",
    score: 100,
    matchedTerms: ["active", "users"],
    id: "dictionary-private-id",
    metric: "Monthly active users",
    definition: "Distinct users with an activity event during the month.",
    source: "bigquery",
    action: "bigquery",
    table: "user_day_rollups",
    columnsUsed: "user_id, activity_date",
    queryTemplate: "SELECT COUNT(DISTINCT user_id) ...",
    approved: true,
  },
  {
    kind: "dashboard-panel",
    origin: "saved-dashboard",
    score: 50,
    matchedTerms: [],
    dashboardId: "private-dashboard-id",
    dashboardTitle: "Activation health",
    panelId: "private-panel-id",
    panelTitle: "Activation by cohort",
    source: "bigquery",
    query: "SELECT cohort_month, activation_rate FROM activation_cohorts",
    dashboardCertified: false,
  },
  {
    kind: "dashboard-panel",
    origin: "saved-dashboard",
    score: 20,
    matchedTerms: [],
    dashboardId: "another-private-id",
    dashboardTitle: "Support trends",
    panelId: "another-private-panel",
    panelTitle: "Ticket volume",
    source: "hubspot",
    query: "SELECT created_at, COUNT(*) FROM tickets GROUP BY created_at",
    dashboardCertified: false,
  },
];

describe("retrieveAnalyticsPromptReferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchAnalyticsQueryCatalog.mockResolvedValue({
      candidates: [candidates[1], candidates[0], candidates[2]],
      searchedDashboardCount: 2,
      dashboardSearchTruncated: false,
      dashboardSearchStatus: "available",
      searchedDictionaryEntryCount: 1,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "available",
    });
    mocks.availableEmbeddingFamilies.mockResolvedValue([
      {
        id: "builder",
        model: "builder-multimodal-embedding",
        version: "1",
        dimensions: 2,
        embed: mocks.embed,
      },
    ]);
    mocks.getActiveEmbeddingSet.mockResolvedValue({
      family: "builder",
      model: "builder-multimodal-embedding",
      version: "1",
      dimensions: 2,
    });
    mocks.embed.mockImplementation(async (inputs: { text?: string }[]) =>
      inputs.map(({ text }) =>
        text?.includes("Monthly active users") ||
        text?.includes("How many active users")
          ? [1, 0]
          : [0, 1],
      ),
    );
  });

  it("uses configured embeddings to rank bounded references and keeps Jev metadata private", async () => {
    const result = await retrieveAnalyticsPromptReferences({
      request: "How many active users were there last month?",
      email: "owner@example.com",
      orgId: "org-analytics",
    });

    expect(mocks.searchAnalyticsQueryCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "How many active users were there last month?",
        email: "owner@example.com",
        orgId: "org-analytics",
        limit: 24,
        signal: expect.anything(),
      }),
    );
    expect(result.jevPromptCandidates[0]).toMatchObject({
      id: "analytics-reference-1",
      name: "Data dictionary: Monthly active users",
      scope: "analytics-catalog",
      content: expect.stringContaining("COUNT(DISTINCT user_id)"),
    });
    expect(result.jevPromptCandidates[0]?.description).toContain(
      "Monthly active users",
    );
    expect(result.jevPromptCandidates[0]?.description).toContain(
      "Distinct users with an activity event during the month.",
    );
    expect(result.jevPromptCandidates[0]?.description).not.toContain("SELECT");
    expect(result.jevPromptCandidates[0]?.content).toContain(
      "BigQuery GoogleSQL; use STRING, not TEXT, and avoid ILIKE.",
    );
    expect(result.jevPromptCandidates[0]?.content).toContain(
      "Query action: bigquery",
    );
    expect(
      result.jevPromptCandidates.some((candidate) =>
        candidate.description.includes("Activation by cohort"),
      ),
    ).toBe(true);
    expect(result.jevPromptCandidates[0]?.metadata).not.toHaveProperty(
      "private-dashboard-id",
    );
    expect(result.jevFallbackCandidateIds).toEqual([
      "analytics-reference-1",
      "analytics-reference-2",
    ]);
    expect(mocks.embed).toHaveBeenCalledWith(
      [{ text: "How many active users were there last month?" }],
      "query",
      { signal: expect.anything() },
    );
    const documentEmbedding = mocks.embed.mock.calls.find(
      ([, purpose]) => purpose === "document",
    );
    expect(documentEmbedding?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining("Monthly active users"),
        }),
      ]),
    );
    expect(JSON.stringify(documentEmbedding?.[0])).not.toContain("SELECT");
  });

  it("uses lexical relevance to break equal embedding scores", async () => {
    const weaker = {
      ...candidates[0]!,
      id: "tie-weaker",
      metric: "Tie weaker metric",
      definition: "Unique weaker summary",
      score: 10,
    };
    const stronger = {
      ...candidates[1]!,
      dashboardTitle: "Tie stronger dashboard",
      panelTitle: "Tie stronger panel",
      query: "SELECT tie_stronger_metric",
      score: 90,
    };
    mocks.searchAnalyticsQueryCatalog.mockResolvedValue({
      candidates: [weaker, stronger],
      searchedDashboardCount: 2,
      dashboardSearchTruncated: false,
      dashboardSearchStatus: "available",
      searchedDictionaryEntryCount: 0,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "available",
    });
    mocks.embed.mockImplementation(async (inputs: { text?: string }[]) =>
      inputs.map(() => [1, 0]),
    );

    const result = await retrieveAnalyticsPromptReferences({
      request: "tie ranking request",
      email: "owner@example.com",
      orgId: null,
    });

    expect(result.jevPromptCandidates[0]?.name).toBe(
      "Tie stronger dashboard: Tie stronger panel",
    );
  });

  it("keeps certified dashboards ahead of more similar ordinary panels", async () => {
    const ordinary = {
      ...candidates[1]!,
      dashboardTitle: "Ordinary dashboard",
      panelTitle: "Ordinary panel",
      score: 200,
    };
    const certified = {
      ...candidates[2]!,
      dashboardTitle: "Certified dashboard",
      panelTitle: "Certified panel",
      dashboardCertified: true,
      score: 10,
    };
    mocks.searchAnalyticsQueryCatalog.mockResolvedValue({
      candidates: [ordinary, certified],
      searchedDashboardCount: 2,
      dashboardSearchTruncated: false,
      dashboardSearchStatus: "available",
      searchedDictionaryEntryCount: 0,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "available",
    });
    mocks.embed.mockImplementation(async (inputs: { text?: string }[]) =>
      inputs.map(({ text }) => (text?.includes("Certified") ? [0, 1] : [1, 0])),
    );

    const result = await retrieveAnalyticsPromptReferences({
      request: "certified dashboard request",
      email: "owner@example.com",
      orgId: null,
    });

    expect(result.jevPromptCandidates[0]?.name).toBe(
      "Certified dashboard: Certified panel",
    );
  });

  it("uses the lexical catalog order when no embedding family is connected", async () => {
    mocks.availableEmbeddingFamilies.mockResolvedValue([]);

    const result = await retrieveAnalyticsPromptReferences({
      request: "support ticket volume",
      email: "owner@example.com",
      orgId: null,
    });

    expect(result.jevPromptCandidates[0]?.name).toBe(
      "Activation health: Activation by cohort",
    );
    expect(result.jevFallbackCandidateIds).toEqual([
      "analytics-reference-1",
      "analytics-reference-2",
    ]);
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it("returns catalog-order references when an embedding request hangs", async () => {
    const signals: AbortSignal[] = [];
    mocks.embed.mockImplementation(
      (
        _inputs: unknown,
        _purpose: unknown,
        options?: { signal?: AbortSignal },
      ) => {
        if (options?.signal) signals.push(options.signal);
        return new Promise(() => {});
      },
    );

    const result = await retrieveAnalyticsPromptReferences({
      request: "How many active users last month?",
      email: "owner@example.com",
      orgId: "org-analytics",
      deadlineAt: Date.now() + 100,
    });

    expect(
      result.jevPromptCandidates.map((candidate) => candidate.name),
    ).toEqual([
      "Activation health: Activation by cohort",
      "Data dictionary: Monthly active users",
      "Support trends: Ticket volume",
    ]);
    expect(result.jevFallbackCandidateIds).toEqual([
      "analytics-reference-1",
      "analytics-reference-2",
    ]);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("does not start embedding requests after catalog lookup exhausts the budget", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockImplementationOnce(() => 1_000)
      .mockImplementation(() => 2_000);

    try {
      const result = await retrieveAnalyticsPromptReferences({
        request: "How many active users last month?",
        email: "owner@example.com",
        orgId: null,
        deadlineAt: 1_500,
      });

      expect(mocks.searchAnalyticsQueryCatalog).toHaveBeenCalledOnce();
      expect(mocks.availableEmbeddingFamilies).not.toHaveBeenCalled();
      expect(mocks.embed).not.toHaveBeenCalled();
      expect(result.jevPromptCandidates[0]?.name).toBe(
        "Activation health: Activation by cohort",
      );
    } finally {
      now.mockRestore();
    }
  });

  it("does not start embedding requests when family resolution exceeds the deadline", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    mocks.getActiveEmbeddingSet.mockImplementation(async () => {
      now.mockReturnValue(2_000);
      return {
        family: "builder",
        model: "builder-multimodal-embedding",
        version: "1",
        dimensions: 2,
      };
    });

    try {
      const result = await retrieveAnalyticsPromptReferences({
        request: "How many active users last month?",
        email: "owner@example.com",
        orgId: null,
        deadlineAt: 1_500,
      });

      expect(mocks.availableEmbeddingFamilies).toHaveBeenCalledOnce();
      expect(mocks.getActiveEmbeddingSet).toHaveBeenCalledOnce();
      expect(mocks.embed).not.toHaveBeenCalled();
      expect(result.jevPromptCandidates[0]?.name).toBe(
        "Activation health: Activation by cohort",
      );
    } finally {
      now.mockRestore();
    }
  });

  it("fails open when catalog retrieval fails", async () => {
    mocks.searchAnalyticsQueryCatalog.mockRejectedValue(
      new Error("catalog unavailable"),
    );

    await expect(
      retrieveAnalyticsPromptReferences({
        request: "How many active users last month?",
        email: "owner@example.com",
        orgId: "org-analytics",
      }),
    ).resolves.toEqual({
      jevPromptCandidates: [],
      jevFallbackCandidateIds: [],
    });
  });
});

describe("summarizeAnalyticsRun", () => {
  it("counts source reads registered by their grounding metadata", () => {
    const events = [
      "list-monitors",
      "get-monitor-stats",
      "list-session-recordings",
      "get-session-replay-events",
      "get-session-replay-summary",
      "get-session-replay-timeline",
    ].map((tool) => ({ event: { type: "tool_start", tool } }));

    expect(
      summarizeAnalyticsRun({
        preloadedReferenceCount: 0,
        groundingActionNames: [
          "list-session-recordings",
          "get-session-replay-events",
          "get-session-replay-summary",
          "get-session-replay-timeline",
          "get-monitor",
        ],
        events,
      }),
    ).toEqual({
      preloaded_reference_count: 0,
      tool_search_calls: 0,
      catalog_calls: 0,
      query_calls: 4,
    });
  });

  it("counts started calls and reads the first query error from its completion event", () => {
    const properties = summarizeAnalyticsRun({
      preloadedReferenceCount: 2,
      groundingActionNames: [
        "hubspot-records",
        "prometheus",
        "jira-search",
        "gong-calls",
        "sentry",
      ],
      events: [
        {
          event: {
            type: "tool_start",
            tool: "tool-search",
            id: "search-1",
            input: { query: "private search input" },
          },
        },
        {
          event: {
            type: "tool_done",
            tool: "tool-search",
            id: "search-1",
            result: "private search result",
          },
        },
        {
          event: {
            type: "tool_start",
            tool: "search-analytics-query-catalog",
            id: "catalog-1",
            input: { search: "private metric" },
          },
        },
        ...[
          "get-sql-dashboard",
          "list-sql-dashboards",
          "list-dashboard-usage-stats",
        ].map((tool, index) => ({
          event: { type: "tool_start", tool, id: `catalog-${index + 2}` },
        })),
        {
          event: {
            type: "tool_start",
            tool: "get-monitor",
            id: "monitor-1",
          },
        },
        {
          event: {
            type: "tool_done",
            tool: "get-monitor",
            id: "monitor-1",
          },
        },
        {
          event: {
            type: "tool_start",
            tool: "list-connected-database-tables",
            id: "schema-1",
          },
        },
        {
          event: {
            type: "tool_done",
            tool: "list-connected-database-tables",
            id: "schema-1",
          },
        },
        {
          event: {
            type: "tool_start",
            tool: "test-custom-api-connection",
            id: "connection-1",
          },
        },
        {
          event: {
            type: "tool_done",
            tool: "test-custom-api-connection",
            id: "connection-1",
          },
        },
        {
          event: {
            type: "tool_start",
            tool: "content-calendar-schema",
            id: "schema-2",
          },
        },
        {
          event: {
            type: "tool_start",
            tool: "get-first-party-analytics-health",
            id: "health-1",
          },
        },
        {
          event: {
            type: "tool_start",
            tool: "hubspot-pipelines",
            id: "metadata-1",
          },
        },
        {
          event: {
            type: "tool_start",
            tool: "provider-corpus-job",
            id: "job-1",
          },
        },
        {
          event: {
            type: "tool_start",
            tool: "bigquery",
            id: "query-1",
            input: { sql: "SELECT private_data" },
          },
        },
        {
          event: {
            type: "tool_done",
            tool: "bigquery",
            id: "query-1",
            result: "private rows",
            isError: true,
          },
        },
        {
          event: {
            type: "tool_start",
            tool: "hubspot-records",
            id: "query-crm-1",
          },
        },
        {
          event: {
            type: "tool_done",
            tool: "hubspot-records",
            id: "query-crm-1",
            isError: false,
          },
        },
        {
          event: {
            type: "tool_start",
            tool: "prometheus",
            id: "query-metrics-1",
          },
        },
        {
          event: {
            type: "tool_done",
            tool: "prometheus",
            id: "query-metrics-1",
            isError: false,
          },
        },
        {
          event: {
            type: "tool_start",
            tool: "jira-search",
            id: "query-jira-1",
          },
        },
        {
          event: {
            type: "tool_done",
            tool: "jira-search",
            id: "query-jira-1",
            isError: false,
          },
        },
        ...["gong-calls", "sentry"].flatMap((tool, index) => [
          { event: { type: "tool_start", tool, id: `provider-${index}` } },
          {
            event: {
              type: "tool_done",
              tool,
              id: `provider-${index}`,
              isError: false,
            },
          },
        ]),
        {
          event: {
            type: "tool_start",
            tool: "query-agent-native-analytics",
            id: "query-2",
            input: { sql: "SELECT other_private_data" },
          },
        },
      ],
    });

    expect(properties).toEqual({
      preloaded_reference_count: 2,
      tool_search_calls: 1,
      catalog_calls: 4,
      query_calls: 7,
      first_query_errored: true,
    });
    expect(JSON.stringify(properties)).not.toMatch(/private|SELECT|rows/i);
  });

  it("leaves the first query error unknown when no completion was recorded", () => {
    expect(
      summarizeAnalyticsRun({
        preloadedReferenceCount: 0,
        groundingActionNames: [],
        events: [
          {
            event: {
              type: "tool_start",
              tool: "bigquery",
              id: "query-1",
              input: { sql: "private" },
            },
          },
        ],
      }),
    ).toEqual({
      preloaded_reference_count: 0,
      tool_search_calls: 0,
      catalog_calls: 0,
      query_calls: 1,
    });
  });

  it("tracks provider read errors from the matching completion event", () => {
    expect(
      summarizeAnalyticsRun({
        preloadedReferenceCount: 0,
        groundingActionNames: ["hubspot-records"],
        events: [
          {
            event: {
              type: "tool_start",
              tool: "hubspot-records",
              id: "provider-1",
            },
          },
          {
            event: {
              type: "tool_done",
              tool: "hubspot-records",
              id: "provider-other",
              isError: false,
            },
          },
          {
            event: {
              type: "tool_done",
              tool: "hubspot-records",
              id: "provider-1",
              isError: true,
            },
          },
        ],
      }),
    ).toEqual({
      preloaded_reference_count: 0,
      tool_search_calls: 0,
      catalog_calls: 0,
      query_calls: 1,
      first_query_errored: true,
    });
  });
});
