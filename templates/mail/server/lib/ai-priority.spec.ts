import { describe, expect, it } from "vitest";

import {
  createEmptyAiPriorityCache,
  getCachedPriorityScores,
  mergePriorityCache,
  type AiPriorityCacheEntry,
} from "./ai-priority.js";

function entry(
  emailId: string,
  instructionKey: string,
  evaluatedAt: number,
  accountEmail?: string,
  score = 0.8,
): AiPriorityCacheEntry {
  return {
    emailId,
    ...(accountEmail ? { accountEmail } : {}),
    score,
    fingerprint: "f".repeat(64),
    instructionKey: instructionKey.repeat(64),
    evaluatedAt,
  };
}

describe("AI priority cache", () => {
  it("does not mix scores from an older Important instruction", () => {
    const cache = {
      ...createEmptyAiPriorityCache(),
      entries: [entry("old", "a", 1)],
    };

    const merged = mergePriorityCache(cache, [entry("new", "b", 2)], {
      engine: "typesafe",
      model: "jev-latest",
    });

    expect(merged.entries.map(({ emailId }) => emailId)).toEqual(["new"]);
  });

  it("keeps matching message IDs separate across accounts", () => {
    const cache = {
      ...createEmptyAiPriorityCache(),
      entries: [
        entry("shared", "a", 1, "first@example.test", 0.2),
        entry("shared", "a", 2, "second@example.test", 0.9),
      ],
    };

    const scores = getCachedPriorityScores(
      cache,
      [
        {
          id: "shared",
          accountEmail: "first@example.test",
          fingerprint: "f".repeat(64),
        },
        {
          id: "shared",
          accountEmail: "second@example.test",
          fingerprint: "f".repeat(64),
        },
      ],
      "a".repeat(64),
      "jev",
      "jev-latest",
    );

    expect([...scores.values()].map(({ score }) => score)).toEqual([0.2, 0.9]);
    expect(
      mergePriorityCache(
        {
          ...createEmptyAiPriorityCache(),
          entries: [entry("shared", "a", 1, "first@example.test")],
        },
        [entry("shared", "a", 2, "second@example.test")],
        null,
      ).entries,
    ).toHaveLength(2);
  });

  it("keeps legacy entries Jev-only and separates provider/model caches", () => {
    const cache = {
      ...createEmptyAiPriorityCache(),
      entries: [
        entry("legacy", "a", 1, undefined, 0.7),
        {
          ...entry("current", "b", 2, undefined, 0.9),
          provider: "openai" as const,
          model: "gpt-6-luna",
        },
      ],
    };
    const emailKeys = [
      { id: "legacy", fingerprint: "f".repeat(64) },
      { id: "current", fingerprint: "f".repeat(64) },
    ];

    const jevScores = getCachedPriorityScores(
      cache,
      emailKeys,
      "a".repeat(64),
      "jev",
      "jev-latest",
    );
    const openAiScores = getCachedPriorityScores(
      cache,
      emailKeys,
      "b".repeat(64),
      "openai",
      "gpt-6-luna",
    );

    expect([...jevScores.values()].map(({ emailId }) => emailId)).toEqual([
      "legacy",
    ]);
    expect([...openAiScores.values()].map(({ emailId }) => emailId)).toEqual([
      "current",
    ]);
  });
});
