import { pickHomeSuggestions } from "@agent-native/toolkit/app-shell";
import { describe, expect, it, vi } from "vitest";

const trackEvent = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));

import {
  slidesHomeSuggestionPools,
  trackSlidesHomeSuggestionClick,
} from "./home-suggestions";

// oracle-change(templates/slides/actions/generate-home-suggestions.spec.ts): the removed action is covered by fixed-pool selection and click tests.
describe("Slides home suggestion pools", () => {
  it("provides eight stable suggestions for every onboarding role", () => {
    for (const [role, suggestions] of Object.entries(
      slidesHomeSuggestionPools,
    )) {
      expect(suggestions).toHaveLength(8);
      expect(new Set(suggestions.map(({ id }) => id)).size).toBe(8);
      expect(
        suggestions.every(({ key }) =>
          key.startsWith(`home.suggestionPrompts.${role}.`),
        ),
      ).toBe(true);
    }
  });

  it("selects three distinct suggestions from the matching role pool", () => {
    const selected = pickHomeSuggestions(
      slidesHomeSuggestionPools,
      "design",
      () => 0.25,
    );

    expect(selected).toHaveLength(3);
    expect(new Set(selected.map(({ id }) => id)).size).toBe(3);
    expect(selected.every(({ id }) => id.startsWith("slides-design-"))).toBe(
      true,
    );
  });

  it("uses the general pool when a role is missing or unknown", () => {
    for (const role of [undefined, null, "unknown-role"]) {
      const selected = pickHomeSuggestions(
        slidesHomeSuggestionPools,
        role,
        () => 0,
      );

      expect(selected).toHaveLength(3);
      expect(selected.every(({ id }) => id.startsWith("slides-general-"))).toBe(
        true,
      );
    }
  });

  it("tracks a selected prompt with its role, id, and position", () => {
    trackSlidesHomeSuggestionClick({
      appId: "slides",
      role: "developer",
      suggestionId: "slides-developer-api",
      position: 1,
    });

    expect(trackEvent).toHaveBeenCalledExactlyOnceWith(
      "home_suggestion_clicked",
      {
        app_id: "slides",
        role: "developer",
        suggestion_id: "slides-developer-api",
        position: 1,
      },
    );
  });
});
