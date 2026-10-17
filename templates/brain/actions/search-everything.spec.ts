import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SOURCE_ANSWER_POLICY } from "../server/lib/source-policy.js";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  policies: new Map<string, Record<string, unknown>>(),
  loadPolicies: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: ({
    view,
    params,
  }: {
    view: string;
    params: Record<string, string>;
  }) => `/brain?view=${view}&id=${Object.values(params)[0]}`,
}));

vi.mock("../server/lib/brain.js", () => ({
  readBrainAgentGuidance: vi.fn(async () => ({
    guidance: {
      retrieval: { sourcePolicy: "balanced" },
      response: {},
    },
  })),
}));

vi.mock("../server/lib/search.js", () => ({
  buildFederatedSearchCoverage: vi.fn(async () => ({
    mode: "brain-index-plus-delegation-hints",
  })),
  searchEverythingWithLanes: vi.fn(async () => ({
    rows: mocks.rows,
    lanes: { fts: { status: "ok" }, semantic: { status: "ok" } },
  })),
}));

vi.mock("../server/lib/source-policy.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/source-policy.js")>();
  return {
    ...actual,
    loadAccessibleSourcePolicySnapshots: mocks.loadPolicies,
  };
});

import searchEverythingAction from "./search-everything.js";

const action = searchEverythingAction as unknown as {
  run: (args: {
    query: string;
    type: "all";
    limit: number;
  }) => Promise<{ results: Array<Record<string, unknown>> }>;
};

function capture(id: string, sourceId: string) {
  return {
    type: "capture",
    id,
    title: `Capture ${id}`,
    snippet: "Pricing stays annual.",
    summary: null,
    status: "active",
    provider: "slack",
    source: { id: sourceId, title: sourceId, provider: "slack", status: "ok" },
    sourceUrl: null,
    citation: null,
    confidence: null,
    updatedAt: new Date().toISOString(),
    score: 1,
  };
}

function policy(sourceId: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceId,
    provider: "slack",
    lastSyncedAt: null,
    updatedAt: new Date().toISOString(),
    ...DEFAULT_SOURCE_ANSWER_POLICY,
    ...overrides,
  };
}

describe("search-everything", () => {
  beforeEach(() => {
    mocks.rows = [];
    mocks.policies = new Map();
    mocks.loadPolicies.mockReset();
    mocks.loadPolicies.mockImplementation(async (sourceIds: string[]) => {
      return new Map(
        sourceIds.flatMap((sourceId) => {
          const snapshot = mocks.policies.get(sourceId);
          return snapshot ? [[sourceId, snapshot]] : [];
        }),
      );
    });
  });

  it("annotates captures with the source answer policy without dropping ineligible ones", async () => {
    mocks.rows = [
      capture("capture-eligible", "source-ok"),
      capture("capture-blocked", "source-blocked"),
      {
        ...capture("knowledge-1", "source-ok"),
        type: "knowledge",
      },
    ];
    mocks.policies.set("source-ok", policy("source-ok"));
    mocks.policies.set(
      "source-blocked",
      policy("source-blocked", { answerEligible: false }),
    );

    const { results } = await action.run({
      query: "pricing",
      type: "all",
      limit: 25,
    });

    expect(mocks.loadPolicies).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(3);
    const byId = new Map(results.map((result) => [result.id, result]));
    expect(byId.get("capture-eligible")).toMatchObject({
      answerEligible: true,
      answerExclusionReasons: [],
    });
    const blocked = byId.get("capture-blocked");
    expect(blocked?.answerEligible).toBe(false);
    expect(blocked?.answerExclusionReasons).toEqual(
      expect.arrayContaining(["answer-ineligible"]),
    );
    expect(byId.get("knowledge-1")).not.toHaveProperty("answerEligible");
    expect(byId.get("knowledge-1")).not.toHaveProperty(
      "answerExclusionReasons",
    );
  });

  it("skips the policy lookup when there are no captures", async () => {
    mocks.rows = [
      { ...capture("knowledge-1", "source-ok"), type: "knowledge" },
    ];

    await action.run({ query: "pricing", type: "all", limit: 25 });

    expect(mocks.loadPolicies).not.toHaveBeenCalled();
  });
});
