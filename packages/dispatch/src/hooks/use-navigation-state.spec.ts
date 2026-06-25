import { describe, expect, it } from "vitest";

import { buildDispatchNavigationState } from "./use-navigation-state.js";

describe("buildDispatchNavigationState", () => {
  it("recognizes the full-page chat route", () => {
    expect(buildDispatchNavigationState("/chat")).toEqual({
      view: "chat",
      path: "/chat",
    });
  });

  it("exposes the current extension id from extension routes", () => {
    expect(
      buildDispatchNavigationState("/extensions/ext-1/github-stars-over-time"),
    ).toEqual({
      view: "extensions",
      path: "/extensions/ext-1/github-stars-over-time",
      extensionId: "ext-1",
      extensionSlug: "github-stars-over-time",
    });
  });

  it("preserves dreams query context", () => {
    expect(
      buildDispatchNavigationState(
        "/dreams",
        "?dreamId=dream-1&sourceId=src-1&query=focus",
      ),
    ).toEqual({
      view: "dreams",
      path: "/dreams",
      dreamId: "dream-1",
      sourceId: "src-1",
      query: "focus",
    });
  });
});
