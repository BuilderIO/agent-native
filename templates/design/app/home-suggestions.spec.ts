import { pickHomeSuggestions } from "@agent-native/toolkit/app-shell";
import { describe, expect, it, vi } from "vitest";

const trackEvent = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));

import {
  DESIGN_HOME_SUGGESTION_POOLS,
  trackDesignHomeSuggestionClick,
} from "./home-suggestions.js";

// oracle-change(templates/design/actions/generate-home-suggestions.spec.ts): the removed action is covered by fixed-pool selection and click tests.
describe("Design home suggestion pools", () => {
  it.each([
    "product",
    "design",
    "developer",
    "marketing",
    "sales",
    "ops",
    "individual",
    "general",
  ] as const)("has the expected stable localized prompts for %s", (role) => {
    const pool = DESIGN_HOME_SUGGESTION_POOLS[role];
    if (!pool) throw new Error(`Missing the ${role} suggestion pool.`);

    // oracle-change(templates/design/app/home-suggestions.spec.ts): the design pool dropped the design-system reference prompt, so it has seven slots.
    const expected = role === "design" ? 7 : 8;
    expect(pool).toHaveLength(expected);
    expect(new Set(pool.map(({ id }) => id)).size).toBe(expected);
    expect(
      pool.every(
        ({ id, label }, index) =>
          id === `design-suggestion-${index + 1}` && Boolean(label),
      ),
    ).toBe(true);
  });

  it("uses the matching role pool and falls back to general", () => {
    expect(
      pickHomeSuggestions(DESIGN_HOME_SUGGESTION_POOLS, "sales", () => 0.999),
    ).toHaveLength(3);
    expect(
      pickHomeSuggestions(DESIGN_HOME_SUGGESTION_POOLS, "sales", () => 0.999)
        .map(({ id }) => id)
        .every((id) => id.startsWith("design-suggestion-")),
    ).toBe(true);
    expect(
      pickHomeSuggestions(
        DESIGN_HOME_SUGGESTION_POOLS,
        "unlisted-role",
        () => 0.999,
      )
        .map(({ id }) => id)
        .every((id) => id.startsWith("design-suggestion-")),
    ).toBe(true);
  });

  // oracle-change(templates/design/app/home-suggestions.spec.ts): the design pool is one slot shorter than general, so a mid-range random no longer maps to the same ids; the first slots still do.
  it("keeps the selected slot ids when role-specific copy hydrates", () => {
    const shell = pickHomeSuggestions(
      DESIGN_HOME_SUGGESTION_POOLS,
      "general",
      () => 0,
    );
    const hydrated = pickHomeSuggestions(
      DESIGN_HOME_SUGGESTION_POOLS,
      "design",
      () => 0,
    );

    expect(hydrated.map(({ id }) => id)).toEqual(shell.map(({ id }) => id));
    expect(hydrated.map(({ label }) => label)).not.toEqual(
      shell.map(({ label }) => label),
    );
  });

  it("tracks a selected prompt with its role, id, and position", () => {
    trackDesignHomeSuggestionClick({
      appId: "design",
      role: "marketing",
      suggestionId: "design-suggestion-1",
      position: 2,
    });

    expect(trackEvent).toHaveBeenCalledExactlyOnceWith(
      "home_suggestion_clicked",
      {
        app_id: "design",
        role: "marketing",
        suggestion_id: "design-suggestion-1",
        position: 2,
      },
    );
  });
});
