import { beforeEach, describe, expect, it, vi } from "vitest";

const { findCandidates, getJevKey } = vi.hoisted(() => ({
  findCandidates: vi.fn(),
  getJevKey: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getOwnerJevApiKey: getJevKey,
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
  getJevKey.mockResolvedValue("test-only-key");
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

describe("find-crm-duplicates Jev review", () => {
  it("leaves ordinary deterministic checks local", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const result = await action.run({ recordIds: ["seed"] }, ctx);
    expect(result.records[0].candidates).toHaveLength(2);
    expect(getJevKey).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reviews only ambiguous returned pairs and keeps low probabilities", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        answers: { candidate_0: { type: "noul", noul: 0.12 } },
      }),
    );
    const result = await action.run(
      { recordIds: ["seed"], semanticReview: true, candidatesPerRecord: 10 },
      ctx,
    );
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.model).toBe("jev-latest");
    expect(body.state.candidates).toHaveLength(1);
    expect(body.state.candidates[0].name).toBe("Acme possible");
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

  it("reports no candidates without contacting Jev", async () => {
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
    const fetch = vi.spyOn(globalThis, "fetch");
    const result = await action.run(
      { recordIds: ["seed"], semanticReview: true },
      ctx,
    );
    expect(result.cleanRecordIds).toEqual(["seed"]);
    expect(getJevKey).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send unreadable records or more than five pairs", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    findCandidates.mockResolvedValueOnce([]);
    const unreadable = await action.run(
      { recordIds: ["hidden"], semanticReview: true },
      ctx,
    );
    expect(unreadable.unreadableRecordIds).toEqual(["hidden"]);
    expect(fetch).not.toHaveBeenCalled();

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
    fetch.mockResolvedValueOnce(
      Response.json({
        answers: Object.fromEntries(
          Array.from({ length: 5 }, (_, index) => [
            `candidate_${index}`,
            { type: "noul", noul: 0.5 },
          ]),
        ),
      }),
    );
    const result = await action.run(
      { recordIds: ["seed"], semanticReview: true, candidatesPerRecord: 10 },
      ctx,
    );
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.state.candidates).toHaveLength(5);
    expect(result.records[0].candidates).toHaveLength(6);
    expect(result.records[0].candidates[5].semanticReview).toBeUndefined();
  });

  it("rejects automatic scans but preserves candidates on incomplete Jev answers", async () => {
    await expect(action.run({ semanticReview: true }, ctx)).rejects.toThrow(
      "exactly one explicit recordId",
    );
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ answers: {} }));
    const result = await action.run(
      { recordIds: ["seed"], semanticReview: true },
      ctx,
    );
    expect(result.semanticReviewUnavailable).toBe(true);
    expect(result.records[0].candidates).toHaveLength(2);
    expect(result.records[0].candidates[1].semanticReview).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves deterministic candidates when the Jev request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"));

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
