import { describe, expect, it } from "vitest";

import { getDesignBottomToolbarMode } from "./tool-state";

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
