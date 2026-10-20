import { describe, expect, it } from "vitest";

import {
  AI_FILTER_LABEL,
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
});
