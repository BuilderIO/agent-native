import { describe, expect, it } from "vitest";

import {
  AI_FILTER_LABEL,
  AI_FILTER_DEFAULT_THRESHOLD,
  AI_FILTER_THRESHOLDS_BY_PROVIDER,
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
      labelName: AI_FILTER_LABEL,
    });
    expect(state).not.toHaveProperty("autoFilterThreshold");
    expect(state).not.toHaveProperty("suggestionThreshold");
    expect(getAiFilterThreshold("jev", "auto")).toBe(0.92);
    expect(getAiFilterThreshold("jev", "suggestion")).toBe(0.72);
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

  it("uses provider defaults only when a threshold is unset", () => {
    expect(getAiFilterThreshold("openai", "auto")).toBe(
      AI_FILTER_THRESHOLDS_BY_PROVIDER.openai.auto,
    );
    const openAiThresholds =
      AI_FILTER_THRESHOLDS_BY_PROVIDER.openai as unknown as {
        auto: number;
      };
    const autoThreshold = openAiThresholds.auto;
    openAiThresholds.auto = AI_FILTER_THRESHOLDS_BY_PROVIDER.openai.match;
    try {
      expect(
        getAiFilterThreshold("openai", "auto", AI_FILTER_DEFAULT_THRESHOLD),
      ).toBe(AI_FILTER_DEFAULT_THRESHOLD);
    } finally {
      openAiThresholds.auto = autoThreshold;
    }
  });
});
