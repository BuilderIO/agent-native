import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  availableEmbeddingFamilies: vi.fn(),
  getActiveEmbeddingSet: vi.fn(),
  searchAnalyticsDictionaryCatalog: vi.fn(),
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
// Only the catalog read is faked: tokenizing and ranking are the real ones, so
// the relevance bar is tested on the terms and matches production produces.
vi.mock("./analytics-query-catalog", async (importActual) => ({
  ...(await importActual<typeof import("./analytics-query-catalog")>()),
  searchAnalyticsDictionaryCatalog: mocks.searchAnalyticsDictionaryCatalog,
  searchAnalyticsQueryCatalog: mocks.searchAnalyticsQueryCatalog,
}));

import {
  retrieveAnalyticsPromptReferences,
  summarizeAnalyticsRun,
} from "./analytics-agent-context";
import {
  rankAnalyticsQueryCatalog,
  type AnalyticsQueryCatalogCandidate,
} from "./analytics-query-catalog";

const candidates: AnalyticsQueryCatalogCandidate[] = [
  {
    kind: "data-dictionary",
    origin: "data-dictionary",
    score: 100,
    matchedTerms: ["active", "user"],
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
    kind: "data-dictionary",
    origin: "data-dictionary",
    score: 50,
    matchedTerms: ["activation", "cohort"],
    id: "activation-cohort",
    metric: "Activation by cohort",
    definition: "Activation rate by signup cohort.",
    source: "bigquery",
    table: "activation_cohorts",
    queryTemplate:
      "SELECT cohort_month, activation_rate FROM activation_cohorts",
    approved: true,
  },
  {
    kind: "data-dictionary",
    origin: "data-dictionary",
    score: 20,
    matchedTerms: ["support", "ticket", "volume"],
    id: "support-ticket-volume",
    metric: "Support ticket volume",
    definition: "The count of created HubSpot tickets.",
    source: "hubspot",
    table: "tickets",
    queryTemplate:
      "SELECT created_at, COUNT(*) FROM tickets GROUP BY created_at",
    approved: false,
    aiGenerated: false,
  },
];

describe("retrieveAnalyticsPromptReferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
      candidates: [candidates[1], candidates[0], candidates[2]],
      searched: 3,
      of: 3,
      truncated: false,
      nextPage: null,
      searchedDictionaryEntryCount: 3,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "available",
      sourceIndexStatus: "available",
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

    expect(mocks.searchAnalyticsDictionaryCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "How many active users were there last month?",
        email: "owner@example.com",
        orgId: "org-analytics",
        limit: 24,
        signal: expect.anything(),
      }),
    );
    expect(mocks.searchAnalyticsQueryCatalog).not.toHaveBeenCalled();
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
    expect(result.prefetchStatus).toBe("ok");
    // Only the reference that clears the similarity bar may be injected unranked.
    expect(result.jevFallbackCandidateIds).toEqual(["analytics-reference-1"]);
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
      id: "tie-stronger",
      metric: "Tie stronger metric",
      definition: "Unique stronger summary",
      score: 90,
    };
    mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
      candidates: [weaker, stronger],
      searched: 2,
      of: 2,
      truncated: false,
      nextPage: null,
      searchedDictionaryEntryCount: 2,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "available",
      sourceIndexStatus: "available",
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
      "Data dictionary: Tie stronger metric",
    );
  });

  it("uses one transitive trust ordering across candidate kinds", async () => {
    const approved: AnalyticsQueryCatalogCandidate = {
      kind: "data-dictionary",
      origin: "data-dictionary",
      matchedTerms: ["scope", "neutral"],
      exactMatchedTerms: ["scope", "neutral"],
      id: "approved-truth",
      metric: "Approved truth",
      definition: "Approved source of truth.",
      score: 100,
      semanticScope: "unknown",
      approved: true,
    };
    const dbt: AnalyticsQueryCatalogCandidate = {
      kind: "data-dictionary",
      origin: "source-index",
      matchedTerms: ["scope", "neutral"],
      exactMatchedTerms: ["scope", "neutral"],
      id: "dbt-truth",
      metric: "dbt truth",
      definition: "Generated from a dbt model.",
      approved: false,
      aiGenerated: false,
      sourceKind: "dbt",
      score: 100,
      semanticScope: "unknown",
    };
    const certifiedPanel = {
      kind: "dashboard-panel",
      origin: "saved-dashboard",
      score: 100,
      matchedTerms: ["scope", "neutral"],
      exactMatchedTerms: ["scope", "neutral"],
      dashboardId: "dashboard-certified",
      dashboardTitle: "Certified truth",
      panelId: "panel-certified",
      panelTitle: "Reference panel",
      panelDescription: "Certified reference panel.",
      query: "SELECT 1",
      dashboardCertified: true,
    } satisfies AnalyticsQueryCatalogCandidate;
    const expectedNames = [
      "Data dictionary: Approved truth",
      "Certified truth: Reference panel",
      "Source index: dbt truth",
    ];
    const permutations = [
      [approved, dbt, certifiedPanel],
      [approved, certifiedPanel, dbt],
      [dbt, approved, certifiedPanel],
      [dbt, certifiedPanel, approved],
      [certifiedPanel, approved, dbt],
      [certifiedPanel, dbt, approved],
    ];
    mocks.embed.mockImplementation(
      async (inputs: { text?: string }[], purpose: string) => {
        if (purpose === "query") return inputs.map(() => [1, 0]);
        return inputs.map(({ text }) => {
          if (text?.includes("Approved truth")) return [0.2, Math.sqrt(0.96)];
          if (text?.includes("dbt truth")) return [0.9, Math.sqrt(0.19)];
          if (text?.includes("Certified truth")) return [0.5, Math.sqrt(0.75)];
          return [0, 1];
        });
      },
    );

    for (const permutation of permutations) {
      mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
        candidates: permutation,
        searched: permutation.length,
        of: permutation.length,
        truncated: false,
        nextPage: null,
        searchedDictionaryEntryCount: permutation.length,
        dictionarySearchTruncated: false,
        dictionarySearchStatus: "available",
        sourceIndexStatus: "available",
      });

      const result = await retrieveAnalyticsPromptReferences({
        request: "scope neutral",
        email: "owner@example.com",
        orgId: null,
      });

      expect(result.jevPromptCandidates.map(({ name }) => name)).toEqual(
        expectedNames,
      );
    }
  });

  it("keeps generated dbt truth above an uncertified partial dashboard match", async () => {
    const dbt: AnalyticsQueryCatalogCandidate = {
      kind: "data-dictionary",
      origin: "source-index",
      matchedTerms: ["scope", "neutral"],
      exactMatchedTerms: ["scope", "neutral"],
      id: "dbt-truth",
      metric: "dbt truth",
      definition: "Generated from a dbt model.",
      approved: false,
      aiGenerated: false,
      sourceKind: "dbt",
      score: 100,
      semanticScope: "unknown",
    };
    const partialPanel = {
      kind: "dashboard-panel",
      origin: "saved-dashboard",
      score: 100,
      matchedTerms: ["scope", "neutral"],
      exactMatchedTerms: ["scope"],
      dashboardId: "dashboard-unverified",
      dashboardTitle: "Unverified dashboard",
      panelId: "panel-partial",
      panelTitle: "Partial reference panel",
      panelDescription: "An unverified partial match.",
      query: "SELECT 1",
      dashboardCertified: false,
    } satisfies AnalyticsQueryCatalogCandidate;
    mocks.embed.mockImplementation(
      async (inputs: { text?: string }[], purpose: string) => {
        if (purpose === "query") return inputs.map(() => [1, 0]);
        return inputs.map(({ text }) =>
          text?.includes("dbt truth")
            ? [0.4, Math.sqrt(0.84)]
            : [0.99, Math.sqrt(0.0199)],
        );
      },
    );

    for (const permutation of [
      [dbt, partialPanel],
      [partialPanel, dbt],
    ]) {
      mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
        candidates: permutation,
        searched: permutation.length,
        of: permutation.length,
        truncated: false,
        nextPage: null,
        searchedDictionaryEntryCount: permutation.length,
        dictionarySearchTruncated: false,
        dictionarySearchStatus: "available",
        sourceIndexStatus: "available",
      });

      const result = await retrieveAnalyticsPromptReferences({
        request: "scope neutral",
        email: "owner@example.com",
        orgId: null,
      });

      expect(result.jevPromptCandidates[0]?.name).toBe(
        "Source index: dbt truth",
      );
    }
  });

  it("labels stale generated entries as discovery leads in the prompt", async () => {
    const stale: AnalyticsQueryCatalogCandidate = {
      kind: "data-dictionary",
      origin: "source-index",
      matchedTerms: ["workspace", "member", "role"],
      exactMatchedTerms: ["workspace", "member", "role"],
      id: "stale-workspace-member-roles",
      metric: "Workspace member roles",
      definition:
        "One row per user-workspace membership, including the assigned role.",
      table: "workspace_member_role_bridge",
      columnsUsed: "user_id, workspace_id, role",
      grain: "One row per user-workspace membership",
      semanticScope: "membership",
      sourceKind: "dbt",
      sourceIndexStale: true,
      sourceIndexAgeDays: 104,
      sourceIndexStaleAfterDays: 90,
      approved: false,
      aiGenerated: true,
      score: 100,
    };
    mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
      candidates: [stale],
      searched: 1,
      of: 1,
      truncated: false,
      nextPage: null,
      searchedDictionaryEntryCount: 1,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "available",
      sourceIndexStatus: "available",
    });
    mocks.embed.mockImplementation(async (inputs: { text?: string }[]) =>
      inputs.map(() => [1, 0]),
    );

    const result = await retrieveAnalyticsPromptReferences({
      request: "current workspace member roles",
      email: "owner@example.com",
      orgId: "org-analytics",
    });

    expect(result.jevPromptCandidates[0]?.content).toContain(
      "Stale generated metadata (104 days old; refresh threshold 90 days)",
    );
    expect(result.jevPromptCandidates[0]?.content).toContain(
      "Treat this entry only as a search lead",
    );
    expect(result.jevPromptCandidates[0]?.content).toContain(
      "Unverified scope claim from stale source-index metadata",
    );
  });

  it("keeps a row-level dbt membership bridge above an approved monthly aggregate", async () => {
    const dbtBridge: AnalyticsQueryCatalogCandidate = {
      kind: "data-dictionary",
      origin: "source-index",
      matchedTerms: ["workspace", "membership"],
      exactMatchedTerms: ["workspace", "membership"],
      id: "workspace-membership-bridge",
      metric: "Workspace membership bridge",
      definition:
        "One row per user-workspace membership, including the assigned role.",
      table: "workspace_member_role_bridge",
      columnsUsed: "user_id, workspace_id, role",
      grain: "One row per user-workspace membership",
      semanticScope: "membership",
      approved: false,
      aiGenerated: true,
      sourceKind: "dbt",
      score: 100,
    };
    const approvedMonthlyAggregate: AnalyticsQueryCatalogCandidate = {
      kind: "data-dictionary",
      origin: "data-dictionary",
      matchedTerms: ["workspace", "membership"],
      exactMatchedTerms: ["workspace", "membership"],
      id: "approved-monthly-workspace-user-count",
      metric: "Monthly workspace user count",
      definition: "Month-end count of users by workspace.",
      table: "workspace_user_monthly_rollup",
      columnsUsed: "workspace_id, month, user_count",
      grain: "One row per workspace per month",
      semanticScope: "membership",
      approved: true,
      score: 100,
    };
    mocks.embed.mockImplementation(
      async (inputs: { text?: string }[], purpose: string) => {
        if (purpose === "query") return inputs.map(() => [1, 0]);
        return inputs.map(({ text }) =>
          text?.includes("Monthly workspace user count")
            ? [0.99, Math.sqrt(0.0199)]
            : [0.4, Math.sqrt(0.84)],
        );
      },
    );

    for (const permutation of [
      [approvedMonthlyAggregate, dbtBridge],
      [dbtBridge, approvedMonthlyAggregate],
    ]) {
      mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
        candidates: permutation,
        searched: permutation.length,
        of: permutation.length,
        truncated: false,
        nextPage: null,
        searchedDictionaryEntryCount: permutation.length,
        dictionarySearchTruncated: false,
        dictionarySearchStatus: "available",
        sourceIndexStatus: "available",
      });

      const result = await retrieveAnalyticsPromptReferences({
        request: "workspace membership",
        email: "owner@example.com",
        orgId: null,
      });

      expect(result.jevPromptCandidates[0]?.name).toBe(
        "Source index: Workspace membership bridge",
      );
    }
  });

  it("breaks equal-name candidate ties by stable source identity", async () => {
    const alpha: AnalyticsQueryCatalogCandidate = {
      kind: "data-dictionary",
      origin: "data-dictionary",
      matchedTerms: ["scope", "neutral"],
      exactMatchedTerms: ["scope", "neutral"],
      id: "alpha-source",
      metric: "Same-named reference",
      definition: "Identity alpha.",
      score: 100,
      semanticScope: "unknown",
    };
    const zeta: AnalyticsQueryCatalogCandidate = {
      kind: "data-dictionary",
      origin: "data-dictionary",
      matchedTerms: ["scope", "neutral"],
      exactMatchedTerms: ["scope", "neutral"],
      id: "zeta-source",
      metric: "Same-named reference",
      definition: "Identity zeta.",
      score: 100,
      semanticScope: "unknown",
    };
    mocks.embed.mockImplementation(async (inputs: { text?: string }[]) =>
      inputs.map(() => [1, 0]),
    );

    for (const permutation of [
      [zeta, alpha],
      [alpha, zeta],
    ] satisfies AnalyticsQueryCatalogCandidate[][]) {
      mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
        candidates: permutation,
        searched: permutation.length,
        of: permutation.length,
        truncated: false,
        nextPage: null,
        searchedDictionaryEntryCount: permutation.length,
        dictionarySearchTruncated: false,
        dictionarySearchStatus: "available",
        sourceIndexStatus: "available",
      });

      const result = await retrieveAnalyticsPromptReferences({
        request: "scope neutral candidate order",
        email: "owner@example.com",
        orgId: null,
      });

      expect(result.jevPromptCandidates[0]?.content).toContain(
        "Identity alpha.",
      );
      expect(result.jevPromptCandidates[1]?.content).toContain(
        "Identity zeta.",
      );
    }
  });

  it("keeps initial prefetch dictionary-only and leaves saved query search on demand", async () => {
    mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
      candidates: [candidates[0]],
      searched: 1,
      of: 1,
      truncated: false,
      nextPage: null,
      searchedDictionaryEntryCount: 1,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "available",
      sourceIndexStatus: "not-configured",
    });

    const result = await retrieveAnalyticsPromptReferences({
      request: "which user model should I query?",
      email: "owner@example.com",
      orgId: null,
    });

    expect(result.jevPromptCandidates).toHaveLength(1);
    expect(result.jevPromptCandidates[0]?.metadata.referenceType).toBe(
      "data-dictionary",
    );
    expect(mocks.searchAnalyticsQueryCatalog).not.toHaveBeenCalled();
  });

  it("uses the lexical catalog order when no embedding family is connected", async () => {
    mocks.availableEmbeddingFamilies.mockResolvedValue([]);
    mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
      candidates: [
        candidates[1],
        { ...candidates[2]!, matchedTerms: ["ticket", "volume"] },
      ],
      searched: 2,
      of: 2,
      truncated: false,
      nextPage: null,
      searchedDictionaryEntryCount: 2,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "available",
      sourceIndexStatus: "available",
    });

    const result = await retrieveAnalyticsPromptReferences({
      request: "support ticket volume",
      email: "owner@example.com",
      orgId: null,
    });

    expect(result.jevPromptCandidates[0]?.name).toBe(
      "Data dictionary: Activation by cohort",
    );
    // A reference that matched none of the request's terms is not injected.
    expect(result.jevFallbackCandidateIds).toEqual(["analytics-reference-2"]);
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it("injects nothing unranked when no reference clears the relevance bar", async () => {
    // Opposite to every document vector, whatever an earlier test cached.
    mocks.embed.mockImplementation(
      async (inputs: { text?: string }[], purpose: string) =>
        inputs.map(() => (purpose === "query" ? [-1, -1] : [0, 1])),
    );

    const result = await retrieveAnalyticsPromptReferences({
      request: "an unrelated request about nothing in the catalog",
      email: "owner@example.com",
      orgId: null,
    });

    expect(result.prefetchStatus).toBe("ok");
    expect(result.jevFallbackCandidateIds).toEqual([]);
  });

  describe("without embeddings, over a catalog ranked by the real ranker", () => {
    const dictionaryEntries = [
      {
        id: "nrr",
        metric: "Net revenue retention (NRR)",
        definition:
          "Revenue kept from existing customers over twelve months, including expansion and churn.",
        commonQuestions: "What is our NRR?",
        source: "bigquery",
        table: "account_revenue_monthly",
        queryTemplate: "SELECT SUM(arr) FROM account_revenue_monthly",
        approved: true,
      },
      {
        id: "bookings",
        metric: "Bookings",
        definition: "Closed-won deal amount by close date.",
        commonQuestions: "What were Q3 bookings?",
        source: "bigquery",
        table: "deals",
        queryTemplate: "SELECT SUM(amount) FROM deals WHERE stage = 'won'",
        approved: true,
      },
      {
        id: "renewals",
        metric: "Renewal list",
        definition: "Accounts whose contract ends in the next quarter.",
        source: "bigquery",
        table: "contracts",
        queryTemplate: "SELECT account_id FROM contracts",
        approved: true,
      },
      {
        id: "churned-logos",
        metric: "Churned logos",
        definition: "Customers whose last subscription ended in the quarter.",
        source: "bigquery",
        table: "subscriptions",
        queryTemplate: "SELECT COUNT(*) FROM subscriptions",
        approved: true,
      },
    ];
    async function injectedFor(request: string): Promise<string[]> {
      mocks.availableEmbeddingFamilies.mockResolvedValue([]);
      mocks.searchAnalyticsDictionaryCatalog.mockImplementation(
        async ({ search, limit }: { search: string; limit: number }) => {
          const rankedCandidates = rankAnalyticsQueryCatalog({
            search,
            limit,
            dashboards: [],
            dictionaryEntries,
          });
          return {
            candidates: rankedCandidates,
            searched: dictionaryEntries.length,
            of: rankedCandidates.length,
            truncated: false,
            nextPage: null,
            searchedDictionaryEntryCount: dictionaryEntries.length,
            dictionarySearchTruncated: false,
            dictionarySearchStatus: "available",
            sourceIndexStatus: "not-configured",
          };
        },
      );
      const result = await retrieveAnalyticsPromptReferences({
        request,
        email: "owner@example.com",
        orgId: null,
      });
      return result.jevPromptCandidates
        .filter((candidate) =>
          result.jevFallbackCandidateIds.includes(candidate.id),
        )
        .map((candidate) => candidate.name);
    }

    it.each([
      ["what's our NRR", "Data dictionary: Net revenue retention (NRR)"],
      ["Q3 bookings", "Data dictionary: Bookings"],
      ["renewal list for Q4", "Data dictionary: Renewal list"],
      ["churned logos last quarter", "Data dictionary: Churned logos"],
    ])("injects the matching reference for %j", async (request, name) => {
      expect(await injectedFor(request)).toContain(name);
    });

    it.each([
      "what is this app",
      "the page is broken",
      "why is this panel empty",
      "ok do it",
      "translate this to Spanish",
      "how do I share a dashboard",
      // Retrieval runs for these artifact edits; the relevance bar, not the
      // turn gate, keeps the catalog out of them.
      "make it blue",
      "rename this chart",
      "remove the legend from this panel",
      "resize the chart by 20%",
      "make the chart bigger for mobile",
      "rename the chart to Revenue Overview",
      "move the legend by 10px",
    ])("injects nothing for the non-data ask %j", async (request) => {
      expect(await injectedFor(request)).toEqual([]);
    });
  });

  it("searches on the ask, not on the framing labels around recent turns", async () => {
    await retrieveAnalyticsPromptReferences({
      request:
        "Recent user requests:\nUser: pipeline by stage\n\nCurrent request:\nwhat about EMEA?",
      email: "owner@example.com",
      orgId: null,
    });

    expect(mocks.searchAnalyticsDictionaryCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "pipeline by stage\nwhat about EMEA?",
      }),
    );
  });

  it("reports an empty lookup as empty without a note", async () => {
    mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
      candidates: [],
      searched: 1,
      of: 0,
      truncated: false,
      nextPage: null,
      searchedDictionaryEntryCount: 1,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "available",
      sourceIndexStatus: "not-configured",
    });

    await expect(
      retrieveAnalyticsPromptReferences({
        request: "who owns Acme",
        email: "owner@example.com",
        orgId: null,
      }),
    ).resolves.toEqual({
      jevPromptCandidates: [],
      jevFallbackCandidateIds: [],
      prefetchStatus: "empty",
    });
  });

  it("does not report a catalog that could not be read as an empty one", async () => {
    mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
      candidates: [],
      searched: 0,
      of: 0,
      truncated: true,
      nextPage: null,
      searchedDictionaryEntryCount: 1,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "unavailable",
      sourceIndexStatus: "unavailable",
    });

    const result = await retrieveAnalyticsPromptReferences({
      request: "who owns Acme",
      email: "owner@example.com",
      orgId: null,
    });

    expect(result.prefetchStatus).toBe("failed");
  });

  describe("when dictionary sources are unavailable, partial, or truncated", () => {
    const complete = {
      searched: 1,
      of: 1,
      truncated: false,
      nextPage: null,
      searchedDictionaryEntryCount: 1,
      dictionarySearchTruncated: false,
      dictionarySearchStatus: "available",
      sourceIndexStatus: "available",
    };
    const retrieve = () =>
      retrieveAnalyticsPromptReferences({
        request: "How many active users were there last month?",
        email: "owner@example.com",
        orgId: null,
      });

    it("reports complete sources with hits as ok", async () => {
      mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
        ...complete,
        candidates: [candidates[0]],
      });

      const result = await retrieve();

      expect(result.prefetchStatus).toBe("ok");
      expect(result.jevPromptCandidates).toHaveLength(1);
    });

    it("does not confuse an unconfigured index with an incomplete dictionary lookup", async () => {
      mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
        ...complete,
        candidates: [],
        of: 0,
        sourceIndexStatus: "not-configured",
      });

      const result = await retrieve();

      expect(result.prefetchStatus).toBe("empty");
      expect(result.jevPromptCandidates).toEqual([]);
    });

    it("reports a partial dictionary with no hits as failed, not empty", async () => {
      mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
        ...complete,
        candidates: [],
        dictionarySearchStatus: "partial",
      });

      const result = await retrieve();

      expect(result.prefetchStatus).toBe("failed");
      expect(result.jevPromptCandidates).toEqual([]);
    });

    it("keeps the hits but reports failed when a dictionary scope failed to load", async () => {
      mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
        ...complete,
        candidates: [candidates[0]],
        dictionarySearchStatus: "partial",
      });

      const result = await retrieve();

      expect(result.prefetchStatus).toBe("failed");
      expect(result.jevPromptCandidates).toHaveLength(1);
    });

    it.each([
      ["dictionary source cap", { dictionarySearchTruncated: true }],
      ["dictionary page", { truncated: true }],
    ])(
      "preserves hits but reports a truncated %s search as failed",
      async (_source, truncation) => {
        mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
          ...complete,
          ...truncation,
          candidates: [candidates[0]],
        });
        const withHits = await retrieve();
        expect(withHits.prefetchStatus).toBe("failed");
        expect(withHits.jevPromptCandidates).toHaveLength(1);

        mocks.searchAnalyticsDictionaryCatalog.mockResolvedValue({
          ...complete,
          ...truncation,
          candidates: [],
        });
        expect((await retrieve()).prefetchStatus).toBe("failed");
      },
    );
  });

  it("reports a catalog lookup that outlives the budget as timed out", async () => {
    mocks.searchAnalyticsDictionaryCatalog.mockImplementation(
      () => new Promise(() => {}),
    );

    const result = await retrieveAnalyticsPromptReferences({
      request: "How many active users last month?",
      email: "owner@example.com",
      orgId: null,
      deadlineAt: Date.now() + 50,
    });

    expect(result).toEqual({
      jevPromptCandidates: [],
      jevFallbackCandidateIds: [],
      prefetchStatus: "timed_out",
    });
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
      "Data dictionary: Activation by cohort",
      "Data dictionary: Monthly active users",
      "Data dictionary: Support ticket volume",
    ]);
    expect(result.jevFallbackCandidateIds).toEqual(["analytics-reference-2"]);
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

      expect(mocks.searchAnalyticsDictionaryCatalog).toHaveBeenCalledOnce();
      expect(mocks.availableEmbeddingFamilies).not.toHaveBeenCalled();
      expect(mocks.embed).not.toHaveBeenCalled();
      expect(result.jevPromptCandidates[0]?.name).toBe(
        "Data dictionary: Activation by cohort",
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
        "Data dictionary: Activation by cohort",
      );
    } finally {
      now.mockRestore();
    }
  });

  it("fails open with a typed status when catalog retrieval fails", async () => {
    mocks.searchAnalyticsDictionaryCatalog.mockRejectedValue(
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
      prefetchStatus: "failed",
    });
  });
});

describe("summarizeAnalyticsRun", () => {
  it("counts source reads but excludes operational and metadata actions", () => {
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
        prefetchStatus: "empty",
        groundingActionNames: [
          "list-session-recordings",
          "get-session-replay-events",
          "get-session-replay-summary",
          "get-session-replay-timeline",
          "get-monitor",
          "list-monitors",
          "get-monitor-stats",
          "run-monitor-check",
          "list-connected-database-tables",
          "test-custom-api-connection",
          "content-calendar-schema",
          "hubspot-pipelines",
        ],
        events,
      }),
    ).toEqual({
      preloaded_reference_count: 0,
      prefetch_status: "empty",
      tool_search_calls: 0,
      catalog_calls: 0,
      query_calls: 4,
    });
  });

  it("counts started calls and reads the first query error from its completion event", () => {
    const properties = summarizeAnalyticsRun({
      preloadedReferenceCount: 2,
      prefetchStatus: "ok",
      groundingActionNames: [
        "hubspot-records",
        "prometheus",
        "jira-search",
        "gong-calls",
        "sentry",
        "get-monitor",
        "list-connected-database-tables",
        "test-custom-api-connection",
        "content-calendar-schema",
        "hubspot-pipelines",
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
          "get-explorer-dashboard",
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
            isError: true,
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
            isError: false,
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
      prefetch_status: "ok",
      tool_search_calls: 1,
      catalog_calls: 5,
      query_calls: 7,
      first_query_errored: false,
    });
    expect(JSON.stringify(properties)).not.toMatch(/private|SELECT|rows/i);
  });

  it("leaves the first query error unknown when no completion was recorded", () => {
    expect(
      summarizeAnalyticsRun({
        preloadedReferenceCount: 0,
        prefetchStatus: "timed_out",
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
      prefetch_status: "timed_out",
      tool_search_calls: 0,
      catalog_calls: 0,
      query_calls: 1,
    });
  });

  it("tracks provider read errors from the matching completion event", () => {
    expect(
      summarizeAnalyticsRun({
        preloadedReferenceCount: 0,
        prefetchStatus: "unrecorded",
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
      prefetch_status: "unrecorded",
      tool_search_calls: 0,
      catalog_calls: 0,
      query_calls: 1,
      first_query_errored: true,
    });
  });
});
