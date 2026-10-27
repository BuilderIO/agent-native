import { describe, expect, it } from "vitest";

import {
  AI_FILTER_LABEL,
  getAiFilterThreshold,
  createDefaultAiFilterState,
  aiFilterStateSchema,
} from "./ai-filter.js";

describe("Mail AI filter state", () => {
  it("starts enabled with a conservative auto-filter threshold", () => {
    const state = createDefaultAiFilterState();

    expect(aiFilterStateSchema.parse(state)).toMatchObject({
      enabled: true,
      autoFilter: true,
      autoFilterThreshold: 0.92,
      suggestionThreshold: 0.72,
      labelName: AI_FILTER_LABEL,
    });
  });

  it("only accepts the shared Gmail-visible label", () => {
    const state = createDefaultAiFilterState();

    expect(
      aiFilterStateSchema.safeParse({ ...state, labelName: "Spam" }).success,
    ).toBe(false);
  });

  it("keeps provider defaults equal and preserves user-configured thresholds", () => {
    expect(getAiFilterThreshold("jev", "match")).toBe(0.5);
    expect(getAiFilterThreshold("openai", "match")).toBe(0.5);
    expect(getAiFilterThreshold("jev", "suggestion")).toBe(0.72);
    expect(getAiFilterThreshold("openai", "suggestion")).toBe(0.72);
    expect(getAiFilterThreshold("jev", "auto")).toBe(0.92);
    expect(getAiFilterThreshold("openai", "auto")).toBe(0.92);
    expect(getAiFilterThreshold("openai", "suggestion", 0.81)).toBe(0.81);
  });
});
