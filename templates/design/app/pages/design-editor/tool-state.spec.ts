import { describe, expect, it } from "vitest";

import {
  getDesignBottomToolbarMode,
  resolveModeChangeView,
} from "./tool-state";

describe("resolveModeChangeView", () => {
  it("routes Interact from the canvas into the focused screen", () => {
    expect(
      resolveModeChangeView({ next: "interact", viewMode: "overview" }),
    ).toBe("enter-single-interact");
  });

  it.each(["edit", "annotate"] as const)(
    "returns to the canvas when %s is chosen from a focused screen",
    (next) => {
      // overview -> Interact -> %s must land back on the infinite canvas, not
      // leave the screen focused in a single-screen editing state.
      expect(resolveModeChangeView({ next, viewMode: "single" })).toBe(
        "enter-overview",
      );
    },
  );

  it("leaves the view alone when the mode already matches it", () => {
    expect(resolveModeChangeView({ next: "edit", viewMode: "overview" })).toBe(
      "stay",
    );
    expect(
      resolveModeChangeView({ next: "annotate", viewMode: "overview" }),
    ).toBe("stay");
    expect(
      resolveModeChangeView({ next: "interact", viewMode: "single" }),
    ).toBe("stay");
  });
});

describe("getDesignBottomToolbarMode", () => {
  it("keeps all tools for editors", () => {
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: true,
        canEditDesign: true,
        hasActiveFile: true,
      }),
    ).toBe("editor");
  });

  it("shows a comment-only toolbar to signed-in viewers", () => {
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: true,
        canEditDesign: false,
        hasActiveFile: true,
      }),
    ).toBe("commenter");
  });

  it("hides the toolbar without a session or active file", () => {
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: false,
        canEditDesign: false,
        hasActiveFile: true,
      }),
    ).toBe("hidden");
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: true,
        canEditDesign: false,
        hasActiveFile: false,
      }),
    ).toBe("hidden");
  });
});
