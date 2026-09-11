import { describe, expect, it } from "vitest";

import {
  getDesignBottomToolbarMode,
  resolveModeChangeView,
  resolveToolAfterSelection,
  shouldAskOnNewDesignArrival,
  shouldRevealLayersOnFirstCreate,
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
        canCommentDesign: true,
        hasActiveFile: true,
      }),
    ).toBe("editor");
  });

  it("shows a comment-only toolbar to signed-in commenters", () => {
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: true,
        canEditDesign: false,
        canCommentDesign: true,
        hasActiveFile: true,
      }),
    ).toBe("commenter");
  });

  it("gives an editor the tools before any file exists", () => {
    // A new design has no file rows; the draw tools create the first one, so
    // gating the toolbar on a file hid it exactly when it was needed.
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: true,
        canEditDesign: true,
        canCommentDesign: true,
        hasActiveFile: false,
      }),
    ).toBe("editor");
  });

  it("still needs a file before offering comment-only tools", () => {
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: true,
        canEditDesign: false,
        canCommentDesign: true,
        hasActiveFile: false,
      }),
    ).toBe("hidden");
  });

  it("hides the toolbar without a session or active file", () => {
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: false,
        canEditDesign: false,
        canCommentDesign: false,
        hasActiveFile: true,
      }),
    ).toBe("hidden");
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: true,
        canEditDesign: false,
        canCommentDesign: false,
        hasActiveFile: false,
      }),
    ).toBe("hidden");
  });

  it("keeps signed-in viewers read-only", () => {
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: true,
        canEditDesign: false,
        canCommentDesign: false,
        hasActiveFile: true,
      }),
    ).toBe("hidden");
  });
});

describe("resolveToolAfterSelection", () => {
  it("keeps the scale tool armed so a new selection can be scaled too", () => {
    expect(resolveToolAfterSelection("scale")).toBe("scale");
  });

  it.each(["rect", "ellipse", "pen", "text", "hand", "move"] as const)(
    "drops %s back to move once a selection lands",
    (tool) => {
      expect(resolveToolAfterSelection(tool)).toBe("move");
    },
  );
});

describe("shouldAskOnNewDesignArrival", () => {
  const arrival = {
    arrivedFromNewDesign: true,
    alreadyAsked: false,
    canEditDesign: true,
    embedded: false,
    shellMode: false,
  };

  it("asks once on arrival from the New Design button", () => {
    expect(shouldAskOnNewDesignArrival(arrival)).toBe(true);
  });

  it("does not ask again after the first ask", () => {
    expect(
      shouldAskOnNewDesignArrival({ ...arrival, alreadyAsked: true }),
    ).toBe(false);
  });

  it("stays quiet on a design opened any other way", () => {
    expect(
      shouldAskOnNewDesignArrival({
        ...arrival,
        arrivedFromNewDesign: false,
      }),
    ).toBe(false);
  });

  it("waits for edit access rather than asking a viewer", () => {
    expect(
      shouldAskOnNewDesignArrival({ ...arrival, canEditDesign: false }),
    ).toBe(false);
  });

  it.each(["embedded", "shellMode"] as const)(
    "leaves intake to the host in %s mode",
    (key) => {
      expect(shouldAskOnNewDesignArrival({ ...arrival, [key]: true })).toBe(
        false,
      );
    },
  );
});

describe("shouldRevealLayersOnFirstCreate", () => {
  it("reveals the layer tree when the first shape lands from the agent rail", () => {
    expect(
      shouldRevealLayersOnFirstCreate({
        activeLeftPanel: "agent",
        alreadyRevealed: false,
      }),
    ).toBe(true);
  });

  it("leaves the agent rail alone on every later creation", () => {
    expect(
      shouldRevealLayersOnFirstCreate({
        activeLeftPanel: "agent",
        alreadyRevealed: true,
      }),
    ).toBe(false);
  });

  it("does not churn the panel that is already showing layers", () => {
    expect(
      shouldRevealLayersOnFirstCreate({
        activeLeftPanel: "file",
        alreadyRevealed: false,
      }),
    ).toBe(false);
  });
});
