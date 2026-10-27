import { beforeEach, describe, expect, it, vi } from "vitest";

const { decide, findCandidates } = vi.hoisted(() => ({
  decide: vi.fn(),
  findCandidates: vi.fn(),
}));

vi.mock("@agent-native/core/decisions", () => ({ decide }));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "owner@example.test",
  getRequestOrgId: () => null,
}));
vi.mock("../server/db/index.js", () => ({ getDb: () => ({}), schema: {} }));
vi.mock("../server/lib/dedupe.js", () => ({
  findCrmDuplicateCandidates: findCandidates,
  CRM_DUPLICATE_MATCH_REASONS: ["email", "domain", "name-and-location"],
}));

import action from "./find-crm-duplicates.js";

const ctx = {
  caller: "frontend" as const,
  userEmail: "owner@example.test",
  orgId: null,
};

function candidate(id: string, reason: "email" | "domain") {
  return {
    recordId: id,
    displayName: id === "exact" ? "Acme Inc" : `Acme ${id}`,
    objectType: "companies",
    kind: "account",
    connectionId: "native",
    confidence: reason === "email" ? 0.95 : 0.7,
    signals: [{ reason, value: "acme.example", confidence: 0.7 }],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  decide.mockResolvedValue({
    status: "ok",
    provider: "openai",
    model: "gpt-6-luna",
    answers: {
      candidate_0: {
        type: "predicate",
        name: "candidate_0",
        probability: 0.5,
      },
    },
  });
  findCandidates.mockResolvedValue([
    {
      recordId: "seed",
      displayName: "Acme",
      objectType: "companies",
      kind: "account",
      connectionId: "native",
      candidates: [
        candidate("exact", "email"),
        candidate("possible", "domain"),
      ],
    },
  ]);
});

describe("find-crm-duplicates semantic review", () => {
  it("leaves ordinary deterministic checks local", async () => {
    const result = await action.run({ recordIds: ["seed"] }, ctx);
    expect(result.records[0].candidates).toHaveLength(2);
    expect(decide).not.toHaveBeenCalled();
  });

  it("reviews only ambiguous returned pairs and keeps low probabilities", async () => {
    decide.mockResolvedValueOnce({
      status: "ok",
      provider: "openai",
      model: "gpt-6-luna",
      answers: {
        candidate_0: {
          type: "predicate",
          name: "candidate_0",
          probability: 0.12,
        },
      },
    });
    const result = await action.run(
      { recordIds: ["seed"], semanticReview: true, candidatesPerRecord: 10 },
      ctx,
    );
    const request = decide.mock.calls[0][0];
    expect(request.ownerEmail).toBe("owner@example.test");
    expect(request.input[0].value.candidates).toHaveLength(1);
    expect(request.input[0].value.candidates[0].name).toBe("Acme possible");
    expect(request.questions).toEqual([
      expect.objectContaining({ type: "predicate", name: "candidate_0" }),
    ]);
    expect(request.options).toEqual({ timeoutMs: 12_000 });
    expect(findCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, recordIds: ["seed"] }),
    );
    expect(result.records[0].candidates[0].semanticReview).toBeUndefined();
    expect(result.records[0].candidates[1].semanticReview).toEqual({
      sameEntityProbability: 0.12,
    });
    expect(result.records[0].candidates[1].confidence).toBe(0.7);
    expect(result.semanticReviewUnavailable).toBe(false);
  });

  it("reports no candidates without requesting a decision", async () => {
    findCandidates.mockResolvedValue([
      {
        recordId: "seed",
        displayName: "Acme",
        objectType: "companies",
        kind: "account",
        connectionId: "native",
        candidates: [],
      },
    ]);
    const result = await action.run(
      { recordIds: ["seed"], semanticReview: true },
      ctx,
    );
    expect(result.cleanRecordIds).toEqual(["seed"]);
    expect(decide).not.toHaveBeenCalled();
  });

  it("does not send unreadable records or more than five pairs", async () => {
    findCandidates.mockResolvedValueOnce([]);
    const unreadable = await action.run(
      { recordIds: ["hidden"], semanticReview: true },
      ctx,
    );
    expect(unreadable.unreadableRecordIds).toEqual(["hidden"]);
    expect(decide).not.toHaveBeenCalled();

    findCandidates.mockResolvedValueOnce([
      {
        recordId: "seed",
        displayName: "Acme",
        objectType: "companies",
        kind: "account",
        connectionId: "native",
        candidates: Array.from({ length: 6 }, (_, index) =>
          candidate(`possible_${index}`, "domain"),
        ),
      },
    ]);
    decide.mockResolvedValueOnce({
      status: "ok",
      provider: "openai",
      model: "gpt-6-luna",
      answers: Object.fromEntries(
        Array.from({ length: 5 }, (_, index) => [
          `candidate_${index}`,
          {
            type: "predicate",
            name: `candidate_${index}`,
            probability: 0.5,
          },
        ]),
      ),
    });
    const result = await action.run(
      { recordIds: ["seed"], semanticReview: true, candidatesPerRecord: 10 },
      ctx,
    );
    expect(decide.mock.calls[0][0].input[0].value.candidates).toHaveLength(5);
    expect(result.records[0].candidates).toHaveLength(6);
    expect(result.records[0].candidates[5].semanticReview).toBeUndefined();
  });

  it("rejects automatic scans but preserves candidates on incomplete answers", async () => {
    await expect(action.run({ semanticReview: true }, ctx)).rejects.toThrow(
      "exactly one explicit recordId",
    );
    decide.mockResolvedValueOnce({
      status: "ok",
      provider: "openai",
      model: "gpt-6-luna",
      answers: {},
      questionFailures: { candidate_0: "invalid_response" },
    });
    const result = await action.run(
      { recordIds: ["seed"], semanticReview: true },
      ctx,
    );
    expect(result.semanticReviewUnavailable).toBe(true);
    expect(result.records[0].candidates).toHaveLength(2);
    expect(result.records[0].candidates[1].semanticReview).toBeUndefined();
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("preserves deterministic candidates when the decision fails", async () => {
    decide.mockResolvedValueOnce({
      status: "failed",
      reason: "timeout",
      provider: "openai",
    });

    const result = await action.run(
      { recordIds: ["seed"], semanticReview: true },
      ctx,
    );

    expect(result.semanticReviewUnavailable).toBe(true);
    expect(result.records[0].candidates).toHaveLength(2);
    expect(
      result.records[0].candidates.every(
        (candidate) => !candidate.semanticReview,
      ),
    ).toBe(true);
  });
});
