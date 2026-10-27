import { describe, expect, it } from "vitest";

import {
  createHomeSuggestionRandom,
  normalizeHomeSuggestionRole,
  pickHomeSuggestions,
  type HomeSuggestionPools,
  type HomeSuggestionPrompt,
} from "./home-suggestions.js";

function pool(prefix: string): HomeSuggestionPrompt[] {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    label: `${prefix} prompt ${index + 1}`,
  }));
}

const pools: HomeSuggestionPools<HomeSuggestionPrompt> = {
  product: pool("product"),
  design: pool("design"),
  developer: pool("developer"),
  marketing: pool("marketing"),
  sales: pool("sales"),
  ops: pool("ops"),
  individual: pool("individual"),
  general: pool("general"),
};

describe("home suggestion selection", () => {
  it("selects from the matching role pool", () => {
    expect(
      pickHomeSuggestions(pools, "design", () => 0.999).map(({ id }) => id),
    ).toEqual(["design-1", "design-2", "design-3"]);
  });

  it("returns three distinct suggestions", () => {
    const suggestions = pickHomeSuggestions(pools, "marketing", () => 0.42);
    expect(suggestions).toHaveLength(3);
    expect(new Set(suggestions.map(({ id }) => id)).size).toBe(3);
  });

  it("keeps the same suggestions and order when the shell hydrates", () => {
    const shellSelection = pickHomeSuggestions(
      pools,
      "general",
      createHomeSuggestionRandom(123456),
    );
    const hydratedSelection = pickHomeSuggestions(
      pools,
      "general",
      createHomeSuggestionRandom(123456),
    );

    expect(hydratedSelection).toEqual(shellSelection);
  });

  it("uses the general pool when no role is known", () => {
    expect(
      pickHomeSuggestions(pools, null, () => 0.999).map(({ id }) => id),
    ).toEqual(["general-1", "general-2", "general-3"]);
    expect(normalizeHomeSuggestionRole("unlisted role")).toBe("general");
  });

  it("falls back to general when a role has no prompts", () => {
    const emptyDesignPool = { ...pools, design: [] };
    expect(
      pickHomeSuggestions(emptyDesignPool, "design", () => 0.999).map(
        ({ id }) => id,
      ),
    ).toEqual(["general-1", "general-2", "general-3"]);
  });
});
