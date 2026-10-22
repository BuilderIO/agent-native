import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SLIDE_DESIGN_TOKENS,
  slideDesignTokensSchema,
} from "../../../shared/slide-design-tokens";
import { shuffleSlideDesignTokens } from "./design-token-presets";

afterEach(() => vi.restoreAllMocks());

describe("shuffleSlideDesignTokens", () => {
  it("shuffles the complete validated theme, not only its palette", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const result = shuffleSlideDesignTokens(DEFAULT_SLIDE_DESIGN_TOKENS);

    expect(slideDesignTokensSchema.safeParse(result).success).toBe(true);
    expect(result).not.toEqual(DEFAULT_SLIDE_DESIGN_TOKENS);
    expect(result.displayFont).not.toBe(
      DEFAULT_SLIDE_DESIGN_TOKENS.displayFont,
    );
    expect(result.bodyScale).not.toBe(DEFAULT_SLIDE_DESIGN_TOKENS.bodyScale);
  });

  it("does not select the same preset again", () => {
    const current = {
      background: "#f7f5f0",
      text: "#1a1814",
      accent: "#6d4cff",
      displayFont: "Georgia",
      bodyFont: "system-ui",
      heroScale: 1,
      bodyScale: 1,
      radius: 12,
    } as const;
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = shuffleSlideDesignTokens(current);

    expect(result).not.toEqual(current);
    expect(slideDesignTokensSchema.safeParse(result).success).toBe(true);
  });
});
