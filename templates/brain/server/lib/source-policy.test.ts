import { describe, expect, it } from "vitest";

import {
  DEFAULT_SOURCE_ANSWER_POLICY,
  compareEvaluatedSourcePolicies,
  evaluateSourceAnswerPolicy,
  normalizeSourceAnswerPolicy,
  withSourceAnswerPolicy,
  type SourcePolicySnapshot,
} from "./source-policy.js";

function snapshot(
  overrides: Partial<SourcePolicySnapshot> = {},
): SourcePolicySnapshot {
  return {
    sourceId: "source-1",
    provider: "generic",
    lastSyncedAt: null,
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...DEFAULT_SOURCE_ANSWER_POLICY,
    ...overrides,
  };
}

describe("source answer policy", () => {
  it("keeps legacy sources answer eligible with standard authority", () => {
    expect(normalizeSourceAnswerPolicy(undefined)).toEqual(
      DEFAULT_SOURCE_ANSWER_POLICY,
    );
    expect(
      evaluateSourceAnswerPolicy({
        sourceIds: ["legacy-source"],
        sourcePolicies: new Map(),
        contentUpdatedAt: "2026-07-29T00:00:00.000Z",
        resultType: "knowledge",
        reviewed: true,
        now: new Date("2026-07-30T00:00:00.000Z"),
      }),
    ).toMatchObject({
      trustTier: "standard",
      answerEligible: true,
      authority: 50,
      eligible: true,
      freshness: "not-configured",
    });
  });

  it("defaults newly untrusted sources to ineligible and review-required", () => {
    expect(normalizeSourceAnswerPolicy({ trustTier: "untrusted" })).toEqual({
      ...DEFAULT_SOURCE_ANSWER_POLICY,
      trustTier: "untrusted",
      answerEligible: false,
      reviewRequired: true,
    });
  });

  it("merges partial updates without dropping existing policy fields", () => {
    expect(
      withSourceAnswerPolicy(
        {
          endpoint: "https://docs.example.test/export",
          answerPolicy: {
            trustTier: "blessed",
            answerEligible: true,
            authority: 95,
            freshnessWindowDays: 30,
            reviewRequired: true,
            conflictBehavior: "require-review",
          },
        },
        { freshnessWindowDays: 14 },
      ),
    ).toEqual({
      endpoint: "https://docs.example.test/export",
      answerPolicy: {
        trustTier: "blessed",
        answerEligible: true,
        authority: 95,
        freshnessWindowDays: 14,
        reviewRequired: true,
        conflictBehavior: "require-review",
      },
    });
  });

  it("excludes stale results but not unreviewed captures from legacy reviewRequired", () => {
    const policies = new Map([
      [
        "source-1",
        snapshot({
          trustTier: "blessed",
          freshnessWindowDays: 7,
          reviewRequired: true,
        }),
      ],
    ]);

    expect(
      evaluateSourceAnswerPolicy({
        sourceIds: ["source-1"],
        sourcePolicies: policies,
        contentUpdatedAt: "2026-07-01T00:00:00.000Z",
        resultType: "knowledge",
        reviewed: true,
        now: new Date("2026-07-30T00:00:00.000Z"),
      }),
    ).toMatchObject({
      eligible: false,
      freshness: "stale",
      exclusionReasons: ["stale"],
    });
    expect(
      evaluateSourceAnswerPolicy({
        sourceIds: ["source-1"],
        sourcePolicies: policies,
        contentUpdatedAt: "2026-07-29T00:00:00.000Z",
        resultType: "capture",
        reviewed: false,
        now: new Date("2026-07-30T00:00:00.000Z"),
      }),
    ).toMatchObject({
      eligible: true,
      freshness: "fresh",
      exclusionReasons: [],
    });
  });

  it("keeps an unreviewed capture eligible when its source has reviewRequired", () => {
    const result = evaluateSourceAnswerPolicy({
      sourceIds: ["source-1"],
      sourcePolicies: new Map([
        ["source-1", snapshot({ reviewRequired: true })],
      ]),
      contentUpdatedAt: "2026-07-29T00:00:00.000Z",
      resultType: "capture",
      reviewed: false,
      now: new Date("2026-07-30T00:00:00.000Z"),
    });

    expect(result.eligible).toBe(true);
    expect(result.exclusionReasons).not.toContain("review-required");
  });

  it("still excludes unreviewed captures when conflicts require review", () => {
    expect(
      evaluateSourceAnswerPolicy({
        sourceIds: ["source-1"],
        sourcePolicies: new Map([
          ["source-1", snapshot({ conflictBehavior: "require-review" })],
        ]),
        contentUpdatedAt: "2026-07-29T00:00:00.000Z",
        resultType: "capture",
        reviewed: false,
        now: new Date("2026-07-30T00:00:00.000Z"),
      }),
    ).toMatchObject({
      eligible: false,
      exclusionReasons: ["review-required"],
    });
  });

  it("ranks blessed and higher-authority policies first", () => {
    const standard = evaluateSourceAnswerPolicy({
      sourceIds: ["standard"],
      sourcePolicies: new Map([
        ["standard", snapshot({ sourceId: "standard", authority: 100 })],
      ]),
      contentUpdatedAt: "2026-07-29T00:00:00.000Z",
      resultType: "knowledge",
      reviewed: true,
    });
    const blessed = evaluateSourceAnswerPolicy({
      sourceIds: ["blessed"],
      sourcePolicies: new Map([
        [
          "blessed",
          snapshot({
            sourceId: "blessed",
            trustTier: "blessed",
            authority: 80,
          }),
        ],
      ]),
      contentUpdatedAt: "2026-07-29T00:00:00.000Z",
      resultType: "knowledge",
      reviewed: true,
    });

    expect(
      [standard, blessed].sort(compareEvaluatedSourcePolicies)[0]?.trustTier,
    ).toBe("blessed");
  });
});
