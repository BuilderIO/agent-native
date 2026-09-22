import { describe, expect, it } from "vitest";

import {
  createEmptyAiPriorityCache,
  mergePriorityCache,
  type AiPriorityCacheEntry,
} from "./ai-priority.js";

function entry(
  emailId: string,
  instructionKey: string,
  evaluatedAt: number,
): AiPriorityCacheEntry {
  return {
    emailId,
    score: 0.8,
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
});
