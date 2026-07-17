import { describe, expect, it } from "vitest";

import {
  CREATIVE_CONTEXT_GOLD_DOCUMENTS,
  CREATIVE_CONTEXT_GOLD_TASKS,
} from "./fixtures.js";

describe("creative context gold corpus", () => {
  it("covers every retrieval task class plus leakage and revision cases", () => {
    expect(
      new Set(CREATIVE_CONTEXT_GOLD_DOCUMENTS.map((item) => item.kind)),
    ).toEqual(
      new Set(["slide", "figma-frame", "notion-section", "web-page", "image"]),
    );
    expect(
      CREATIVE_CONTEXT_GOLD_DOCUMENTS.some((item) => item.revisionOf),
    ).toBe(true);
    expect(
      CREATIVE_CONTEXT_GOLD_DOCUMENTS.some(
        (item) => item.owner === "other-organization",
      ),
    ).toBe(true);
    expect(
      CREATIVE_CONTEXT_GOLD_TASKS.every((task) => task.forbiddenKeys?.length),
    ).toBe(true);
    expect(
      CREATIVE_CONTEXT_GOLD_DOCUMENTS.some((document) => document.imageBase64),
    ).toBe(true);
    expect(
      CREATIVE_CONTEXT_GOLD_TASKS.some((task) => task.query.images?.length),
    ).toBe(true);
    expect(
      CREATIVE_CONTEXT_GOLD_TASKS.some((task) =>
        task.id.includes("text-to-image"),
      ),
    ).toBe(true);
    expect(
      CREATIVE_CONTEXT_GOLD_DOCUMENTS.some(
        (document) => document.text.length > 500,
      ),
    ).toBe(true);
  });
});
