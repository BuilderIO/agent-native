import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  knowledgeRows: [] as Array<Record<string, unknown>>,
  captures: [] as Array<Record<string, unknown>>,
  policies: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@agent-native/core", () => ({
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
      identity: {
        tone: "direct",
        assistantName: "Brain",
        companyName: "Example",
      },
      retrieval: {
        sourcePolicy: "balanced",
        requireCitations: true,
        rawCaptureFallback: "thin-results",
      },
      response: {
        toneInstruction: "Be direct.",
        citationInstruction: "Cite sources.",
      },
    },
  })),
  safeCitationUrl: (value: unknown) =>
    typeof value === "string" ? value : null,
  searchKnowledgeRows: vi.fn(async () => mocks.knowledgeRows),
  serializeKnowledge: (row: Record<string, unknown>) => ({
    ...row,
    evidence: row.evidence ?? [],
  }),
}));

vi.mock("../server/lib/search.js", () => ({
  buildFederatedSearchCoverage: vi.fn(async () => ({
    mode: "brain-index-plus-delegation-hints",
  })),
  searchEverythingRows: vi.fn(async () => mocks.captures),
}));

vi.mock("../server/lib/source-policy.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/source-policy.js")>();
  return {
    ...actual,
    loadAccessibleSourcePolicySnapshots: vi.fn(async (sourceIds: string[]) => {
      return new Map(
        sourceIds.flatMap((sourceId) => {
          const policy = mocks.policies.get(sourceId);
          return policy ? [[sourceId, policy]] : [];
        }),
      );
    }),
  };
});

import askBrainAction from "./ask-brain.js";

const action = askBrainAction as unknown as {
  run: (args: {
    question: string;
    mode: "cited";
  }) => Promise<Record<string, unknown>>;
};

function knowledge(args: { id: string; sourceId: string; title: string }) {
  return {
    id: args.id,
    sourceId: args.sourceId,
    captureId: `capture-${args.id}`,
    audienceId: "org",
    audienceAclHash: "acl",
    kind: "fact",
    title: args.title,
    body: "Agent Native is a framework for building software around agents.",
    summary: "Agent Native puts agents at the center of product workflows.",
    topic: "agent-native",
    tagsJson: "[]",
    entitiesJson: "[]",
    evidence: [
      {
        captureId: `capture-${args.id}`,
        sourceId: args.sourceId,
        captureTitle: `${args.title} source`,
        quote: "Agent Native puts agents at the center of product workflows.",
        sourceUrl: `https://docs.example.test/${args.id}`,
      },
    ],
    confidence: 95,
    status: "published",
    publishTier: "company",
    visibility: "org",
    createdBy: "owner@example.test",
    publishedAt: "2026-07-29T00:00:00.000Z",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
}

function policy(sourceId: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceId,
    provider: "generic",
    lastSyncedAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    trustTier: "standard",
    answerEligible: true,
    authority: 50,
    freshnessWindowDays: null,
    reviewRequired: false,
    conflictBehavior: "prefer-higher-authority",
    ...overrides,
  };
}

describe("ask-brain source answer policy", () => {
  beforeEach(() => {
    mocks.knowledgeRows = [];
    mocks.captures = [];
    mocks.policies = new Map();
  });

  it("prefers blessed knowledge and excludes answer-ineligible sources", async () => {
    mocks.knowledgeRows = [
      knowledge({
        id: "standard",
        sourceId: "source-standard",
        title: "Agent Native standard",
      }),
      knowledge({
        id: "blessed",
        sourceId: "source-blessed",
        title: "Agent Native blessed",
      }),
      knowledge({
        id: "untrusted",
        sourceId: "source-untrusted",
        title: "Agent Native untrusted",
      }),
    ];
    mocks.policies.set(
      "source-standard",
      policy("source-standard", { authority: 100 }),
    );
    mocks.policies.set(
      "source-blessed",
      policy("source-blessed", {
        trustTier: "blessed",
        authority: 80,
      }),
    );
    mocks.policies.set(
      "source-untrusted",
      policy("source-untrusted", {
        trustTier: "untrusted",
        answerEligible: false,
      }),
    );

    const result = await action.run({
      question: "What is Agent Native?",
      mode: "cited",
    });
    const returnedKnowledge = result.knowledge as Array<{
      id: string;
      answerPolicy: { trustTier: string };
    }>;
    const citations = result.citations as Array<{
      knowledgeId: string;
      sourcePolicy: { trustTier: string };
    }>;

    expect(returnedKnowledge.map((item) => item.id)).toEqual([
      "blessed",
      "standard",
    ]);
    expect(returnedKnowledge[0]?.answerPolicy.trustTier).toBe("blessed");
    expect(citations.map((item) => item.knowledgeId)).toEqual([
      "blessed",
      "standard",
    ]);
    expect(citations[0]?.sourcePolicy.trustTier).toBe("blessed");
    expect(result.sourcePolicy).toMatchObject({
      enforced: true,
      excluded: { knowledge: 1, captures: 0 },
    });
  });

  it("does not let ineligible matches crowd an eligible blessed result out of the candidate set", async () => {
    mocks.knowledgeRows = [
      ...Array.from({ length: 7 }, (_, index) =>
        knowledge({
          id: `ineligible-${index}`,
          sourceId: `source-ineligible-${index}`,
          title: `Agent Native ineligible ${index}`,
        }),
      ),
      knowledge({
        id: "blessed",
        sourceId: "source-blessed",
        title: "Agent Native blessed",
      }),
    ];
    for (let index = 0; index < 7; index += 1) {
      mocks.policies.set(
        `source-ineligible-${index}`,
        policy(`source-ineligible-${index}`, { answerEligible: false }),
      );
    }
    mocks.policies.set(
      "source-blessed",
      policy("source-blessed", {
        trustTier: "blessed",
        authority: 100,
      }),
    );

    const result = await action.run({
      question: "What is Agent Native?",
      mode: "cited",
    });

    expect(
      (result.knowledge as Array<{ id: string }>).map((item) => item.id),
    ).toEqual(["blessed"]);
  });
});
