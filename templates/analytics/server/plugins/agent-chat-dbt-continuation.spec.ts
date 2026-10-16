import type { AgentLoopFinalResponseGuardContext } from "@agent-native/core/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../register-secrets.js", () => ({}));
vi.mock("../lib/sigma-setup-secret-sweep.js", () => ({}));
vi.mock("@agent-native/core/org", () => ({
  getOrgContext: vi.fn(async () => ({ orgId: null })),
}));
vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(),
  createAgentChatPlugin: vi.fn(() => () => undefined),
  getRequestContext: vi.fn(() => ({})),
  getRequestOrgId: vi.fn(() => null),
  getRequestRunContext: vi.fn(() => null),
  getRequestUserEmail: vi.fn(() => null),
  loadActionsFromStaticRegistry: vi.fn(() => ({})),
}));
vi.mock("../../.generated/actions-registry.js", () => ({
  default: {
    "query-dbt-semantic-metric": {
      readOnly: true,
      grounding: true,
      tool: { description: "Query a dbt metric", parameters: {} },
      run: vi.fn(),
    },
  },
}));
vi.mock("../lib/analytics-agent-context", () => ({
  retrieveAnalyticsPromptReferences: vi.fn(),
  summarizeAnalyticsRun: vi.fn(() => ({})),
}));
vi.mock("../lib/analytics-mcp", () => ({ ANALYTICS_MCP: {} }));
vi.mock("../lib/analytics-memory-capture.js", () => ({
  enqueueAnalyticsMemoryCapture: vi.fn(),
}));
vi.mock("../lib/credential-keys", () => ({ credentialProviderConfigs: [] }));
vi.mock("../lib/production-serverless-runtime.js", () => ({
  isProductionServerlessRuntime: vi.fn(() => false),
}));

import { realDataFinalGuard } from "./agent-chat";

const range = { startDate: "2026-10-05", endDate: "2026-10-11" };
const groupBy = [
  { name: "metric_time", grain: "WEEK" },
  { name: "organization_id" },
];
const querySpec = { groupBy, timeRange: range };
const metric = {
  name: "activation_rate",
  dimensionsCount: 2,
  dimensionsTruncated: false,
  queryableGranularities: ["WEEK"],
  dimensions: [
    { name: "organization_id", description: "Owning organization" },
    {
      name: "metric_time",
      queryableGranularities: ["WEEK"],
    },
  ],
};
const nextPage = `metric-results-v5.AA.${"A".repeat(43)}`;
const differentPage = `metric-results-v5.BB.${"B".repeat(43)}`;

function context(
  continuation: {
    queryId?: string;
    querySpec?: Record<string, unknown>;
    initialQuerySpec?: Record<string, unknown>;
    initialMetric?: Record<string, unknown> | null;
    continuationMetric?: Record<string, unknown> | null;
    requestText?: string;
  } = {},
): AgentLoopFinalResponseGuardContext {
  const initialQuerySpec = continuation.initialQuerySpec ?? querySpec;
  const requestText =
    continuation.requestText ??
    "What was activation rate from 2026-10-05 to 2026-10-11 by organization by week?";
  const initialCall = {
    toolCallId: "initial-call",
    name: "query-dbt-semantic-metric",
    input: { metricName: "activation_rate", ...initialQuerySpec },
  };
  const continuationCall = {
    toolCallId: "continuation-call",
    name: "query-dbt-semantic-metric",
    input: {
      metricName: "activation_rate",
      queryId: "query-1",
      nextPage,
      limit: 20,
    },
  };
  const result = (
    toolCallId: string,
    outputQueryId: string,
    outputQuerySpec: Record<string, unknown> = querySpec,
    outputMetric: Record<string, unknown> | null | undefined = metric,
  ) => ({
    toolCallId,
    name: "query-dbt-semantic-metric",
    isError: false,
    content: JSON.stringify({
      status: "success",
      metricName: "activation_rate",
      ...(outputMetric ? { metric: outputMetric } : {}),
      queryId: outputQueryId,
      querySpec: outputQuerySpec,
      ...(toolCallId === "initial-call" ? { nextPage } : {}),
      rows: [{ activation_rate: 42, organization_id: "org-1" }],
    }),
  });

  return {
    messages: [
      { role: "user", content: [{ type: "text", text: requestText }] },
    ],
    requestText,
    runStartedAt: Date.UTC(2026, 9, 16),
    assistantContent: [],
    text: "The activation rate was 42% by organization, grouped by week.",
    toolCalls: [initialCall, continuationCall],
    toolResults: [
      result(
        "initial-call",
        "query-1",
        initialQuerySpec,
        continuation.initialMetric,
      ),
      result(
        "continuation-call",
        continuation.queryId ?? "query-1",
        continuation.querySpec ?? querySpec,
        continuation.continuationMetric,
      ),
    ],
    retryCount: 0,
    executionMode: "act",
  } as AgentLoopFinalResponseGuardContext;
}

function contextAfterRecoverableProviderError(
  retryCursor = nextPage,
): AgentLoopFinalResponseGuardContext {
  const base = context();
  const errorOutput = {
    status: "provider_error",
    metricName: "activation_rate",
    queryId: "query-1",
    nextPage,
    querySpec,
    metric,
    message: "A provider request was interrupted. Retry with the same cursor.",
  };
  const continuationInput = {
    metricName: "activation_rate",
    queryId: "query-1",
    nextPage: retryCursor,
    limit: 20,
  };
  const successOutput = {
    status: "success",
    metricName: "activation_rate",
    queryId: "query-1",
    querySpec,
    metric,
    rows: [{ activation_rate: 42, organization_id: "org-1" }],
  };

  return {
    ...base,
    toolCalls: [
      base.toolCalls[0]!,
      { ...base.toolCalls[1]!, input: continuationInput },
    ],
    toolResults: [
      {
        ...base.toolResults[0]!,
        content: JSON.stringify(errorOutput),
      },
      {
        ...base.toolResults[1]!,
        content: JSON.stringify(successOutput),
      },
    ],
  };
}

describe("dbt Semantic Layer continuation guard", () => {
  it("accepts a cursor-only continuation for the original grouped metric query", () => {
    expect(realDataFinalGuard(context())).toBeNull();
  });

  it("uses the prior complete metric dimensions when continuation metadata is truncated", () => {
    expect(
      realDataFinalGuard(
        context({
          continuationMetric: {
            ...metric,
            dimensionsCount: 3,
            dimensionsTruncated: true,
            dimensions: [],
          },
        }),
      ),
    ).toBeNull();
  });

  it("uses the prior metric dimensions when a later page omits its metric", () => {
    expect(
      realDataFinalGuard(context({ continuationMetric: null })),
    ).toBeNull();
  });

  it("accepts a recoverable provider error after its cursor returns a successful result", () => {
    expect(
      realDataFinalGuard(contextAfterRecoverableProviderError()),
    ).toBeNull();
  });

  it("rejects a recoverable provider error when the successful call uses another cursor", () => {
    expect(
      realDataFinalGuard(contextAfterRecoverableProviderError(differentPage)),
    ).toMatchObject({
      fallbackMessage: expect.stringContaining(
        "does not match the requested date range",
      ),
    });
  });

  it("rejects continuation evidence without metric dimensions", () => {
    expect(
      realDataFinalGuard(
        context({ initialMetric: null, continuationMetric: null }),
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining(
        "same bounded date range and requested grouping",
      ),
    });
  });

  it("accepts a selected dimension when its semantic alias overlaps", () => {
    const definition = {
      ...metric,
      dimensions: [
        ...metric.dimensions,
        { name: "organization_name", description: "Organization name" },
      ],
      dimensionsCount: 3,
    };

    expect(
      realDataFinalGuard(
        context({ initialMetric: definition, continuationMetric: definition }),
      ),
    ).toBeNull();
  });

  it("rejects a root organization breakdown when the request is unqualified", () => {
    const definition = {
      ...metric,
      dimensions: [
        ...metric.dimensions,
        { name: "root_org_id", description: "Organization identifier" },
      ],
      dimensionsCount: 3,
    };
    const rootOrganizationQuery = {
      ...querySpec,
      groupBy: [groupBy[0], { name: "root_org_id" }],
    };

    expect(
      realDataFinalGuard(
        context({
          initialQuerySpec: rootOrganizationQuery,
          querySpec: rootOrganizationQuery,
          initialMetric: definition,
          continuationMetric: definition,
        }),
      ),
    ).toMatchObject({
      retryMessage: expect.stringContaining(
        "same bounded date range and requested grouping",
      ),
    });
  });

  it.each([
    "organization_root_id",
    "rootOrgId",
    "organizationRootId",
    "rootLevelOrgId",
  ])(
    "rejects hierarchy dimensions named %s when the request only says organization",
    (dimensionName) => {
      const definition = {
        ...metric,
        dimensions: [...metric.dimensions, { name: dimensionName }],
        dimensionsCount: 3,
      };
      const organizationQuery = {
        ...querySpec,
        groupBy: [groupBy[0], { name: dimensionName }],
      };

      expect(
        realDataFinalGuard(
          context({
            initialQuerySpec: organizationQuery,
            querySpec: organizationQuery,
            initialMetric: definition,
            continuationMetric: definition,
            requestText:
              "What was activation rate from 2026-10-05 to 2026-10-11 by organization by week?",
          }),
        ),
      ).toMatchObject({
        retryMessage: expect.stringContaining(
          "same bounded date range and requested grouping",
        ),
      });
    },
  );

  it("accepts a root organization breakdown when the request names that grain", () => {
    const definition = {
      ...metric,
      dimensions: [
        ...metric.dimensions,
        { name: "root_org_id", description: "Organization identifier" },
      ],
      dimensionsCount: 3,
    };
    const rootOrganizationQuery = {
      ...querySpec,
      groupBy: [groupBy[0], { name: "root_org_id" }],
    };

    expect(
      realDataFinalGuard(
        context({
          initialQuerySpec: rootOrganizationQuery,
          querySpec: rootOrganizationQuery,
          initialMetric: definition,
          continuationMetric: definition,
          requestText:
            "What was activation rate from 2026-10-05 to 2026-10-11 by root organization by week?",
        }),
      ),
    ).toBeNull();
  });

  it("accepts root-level wording for a camelCase root organization dimension", () => {
    const dimensionName = "rootOrgId";
    const definition = {
      ...metric,
      dimensions: [...metric.dimensions, { name: dimensionName }],
      dimensionsCount: 3,
    };
    const rootOrganizationQuery = {
      ...querySpec,
      groupBy: [groupBy[0], { name: dimensionName }],
    };

    expect(
      realDataFinalGuard(
        context({
          initialQuerySpec: rootOrganizationQuery,
          querySpec: rootOrganizationQuery,
          initialMetric: definition,
          continuationMetric: definition,
          requestText:
            "What was activation rate from 2026-10-05 to 2026-10-11 by root-level organization by week?",
        }),
      ),
    ).toBeNull();
  });

  it.each([
    ["query lineage", { queryId: "different-query" }],
    [
      "query scope",
      {
        querySpec: {
          ...querySpec,
          groupBy: [{ name: "organization_id" }],
        },
      },
    ],
  ] as const)("rejects a continuation with mismatched %s", (_, mismatch) => {
    expect(realDataFinalGuard(context(mismatch))).toMatchObject({
      retryMessage: expect.stringContaining(
        "same bounded date range and requested grouping",
      ),
    });
  });
});
