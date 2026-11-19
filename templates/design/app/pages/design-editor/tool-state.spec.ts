// oracle-change(templates/design/app/components/design/design-canvas/annotation-snapshot.test.ts): the Annotate feature it covered was removed from Design
// oracle-change(templates/design/app/components/design/design-canvas/annotation-submit.test.ts): the Annotate feature it covered was removed from Design
// oracle-change(templates/design/app/components/visual-editor/DrawOverlay.test.tsx): the Annotate feature it covered was removed from Design
// oracle-change(templates/design/app/pages/DesignEditor.annotate-lab.test.ts): the Annotate feature it covered was removed from Design
// oracle-change(templates/design/app/pages/design-editor/annotation-hotkeys.test.tsx): the Annotate feature it covered was removed from Design
// oracle-change(templates/design/app/pages/design-editor/overview-annotation-context.spec.ts): the Annotate feature it covered was removed from Design
// oracle-change(templates/design/e2e/annotate-lab.spec.ts): the Annotate feature it covered was removed from Design
// oracle-change: Annotate and the Draw tool were removed from Design, so their assertions are gone
import { describe, expect, it } from "vitest";

import {
  getDesignToolActivationState,
  normalizeDesignMode,
  DESIGN_EDITOR_TOOLS,
  areCommentPinsHidden,
  commentModeReturnOptions,
  getDesignBottomToolbarMode,
  normalizeDesignLeftPanel,
  normalizeDesignTool,
  resolveModeChangeView,
  resolveSpaceForwardTransition,
  resolveToolAfterSelection,
  resolveCommentModeExit,
  shouldAskOnNewDesignArrival,
  shouldRevealLayersOnFirstCreate,
} from "./tool-state";
import type { DesignTool } from "./types";

describe("resolveModeChangeView", () => {
  it("routes Interact from the canvas into the focused screen", () => {
    expect(
      resolveModeChangeView({ next: "interact", viewMode: "overview" }),
    ).toBe("enter-single-interact");
  });

  it.each(["edit", "comment"] as const)(
    "returns to the canvas when %s is chosen from a focused screen",
    (next) => {
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
      resolveModeChangeView({ next: "interact", viewMode: "single" }),
    ).toBe("stay");
  });
});

describe("commentModeReturnOptions", () => {
  it("restores the screen and device when comments are opened from Interact", () => {
    expect(commentModeReturnOptions("interact", "screen-1")).toEqual({
      targetFileId: "screen-1",
      keepInteractDevice: true,
    });
  });

  it("returns to Design for comments opened from other modes", () => {
    expect(commentModeReturnOptions("edit", "screen-1")).toBeNull();
    expect(commentModeReturnOptions("comment", "screen-1")).toBeNull();
    expect(commentModeReturnOptions("interact", null)).toBeNull();
  });
});

describe("resolveCommentModeExit", () => {
  const returnOptions = {
    targetFileId: "screen-1",
    keepInteractDevice: true,
  } as const;

  it("returns to the saved Interact screen while it still exists", () => {
    expect(
      resolveCommentModeExit(
        returnOptions,
        new Set(["screen-1"]),
        new Set(["screen-1"]),
      ),
    ).toEqual({ mode: "interact", options: returnOptions });
  });

  it.each([
    [new Set<string>(), new Set(["screen-1"])],
    [new Set(["screen-1"]), new Set<string>()],
  ])(
    "falls back to Design when the saved screen was removed",
    (screens, files) => {
      expect(resolveCommentModeExit(returnOptions, screens, files)).toEqual({
        mode: "edit",
      });
    },
  );

  it("returns to Design when Comments did not come from Interact", () => {
    expect(resolveCommentModeExit(null, new Set(), new Set())).toEqual({
      mode: "edit",
    });
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
        scopedWidget: false,
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
        scopedWidget: false,
      }),
    ).toBe("commenter");
  });

  it("gives an editor the tools before any file exists", () => {
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: true,
        canEditDesign: true,
        canCommentDesign: true,
        hasActiveFile: false,
        scopedWidget: false,
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
        scopedWidget: false,
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
        scopedWidget: false,
      }),
    ).toBe("hidden");
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: true,
        canEditDesign: false,
        canCommentDesign: false,
        hasActiveFile: false,
        scopedWidget: false,
      }),
    ).toBe("hidden");
  });

  it("gives a scoped widget editor the toolbar without a signed-in session", () => {
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: false,
        canEditDesign: true,
        canCommentDesign: false,
        hasActiveFile: true,
        scopedWidget: true,
      }),
    ).toBe("editor");
  });

  it("does not let a widget without a write ticket borrow the toolbar", () => {
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: false,
        canEditDesign: false,
        canCommentDesign: false,
        hasActiveFile: true,
        scopedWidget: true,
      }),
    ).toBe("hidden");
  });

  it("still hides the toolbar from a signed-out editor outside a widget", () => {
    expect(
      getDesignBottomToolbarMode({
        isSignedIn: false,
        canEditDesign: true,
        canCommentDesign: false,
        hasActiveFile: true,
        scopedWidget: false,
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
        scopedWidget: false,
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

describe("resolveSpaceForwardTransition", () => {
  it("arms and forwards held:true when Space lands during a drag", () => {
    expect(resolveSpaceForwardTransition("keydown", false, true)).toEqual({
      armed: true,
      broadcast: true,
    });
  });

  it("leaves Space to the hand tool when no drag is running", () => {
    expect(resolveSpaceForwardTransition("keydown", false, false)).toEqual({
      armed: false,
      broadcast: null,
    });
  });

  it("forwards held:false on keyup even though mouseup already ended the drag", () => {
    expect(resolveSpaceForwardTransition("keyup", true, false)).toEqual({
      armed: false,
      broadcast: false,
    });
  });

  it("forwards held:false on blur mid-hold", () => {
    expect(resolveSpaceForwardTransition("blur", true, false)).toEqual({
      armed: false,
      broadcast: false,
    });
  });

  it("does not forward a release it never armed", () => {
    expect(resolveSpaceForwardTransition("keyup", false, true)).toEqual({
      armed: false,
      broadcast: null,
    });
    expect(resolveSpaceForwardTransition("blur", false, false)).toEqual({
      armed: false,
      broadcast: null,
    });
  });
});

describe("normalizeDesignLeftPanel", () => {
  it("accepts the Threads panel and rejects an unknown one", () => {
    expect(normalizeDesignLeftPanel("threads")).toBe("threads");
    expect(normalizeDesignLeftPanel("comments")).toBeUndefined();
  });
});

describe("normalizeDesignTool", () => {
  it("accepts the tools the editor knows and rejects the rest", () => {
    expect(normalizeDesignTool("comment")).toBe("comment");
    expect(normalizeDesignTool("pen")).toBe("pen");
    expect(normalizeDesignTool("nope")).toBeNull();
    expect(normalizeDesignTool(undefined)).toBeNull();
  });

  it("lands the retired Agent tool on Move", () => {
    expect(DESIGN_EDITOR_TOOLS.has("agent" as DesignTool)).toBe(false);
    expect(normalizeDesignTool("agent")).toBe("move");
  });
});

describe("Retired Draw tool and Annotate mode", () => {
  it("lands a stale Draw request on Move", () => {
    expect(DESIGN_EDITOR_TOOLS.has("draw" as DesignTool)).toBe(false);
    expect(normalizeDesignTool("draw")).toBe("move");
  });

  it("does not accept Annotate by name, since only the comment tool enters it", () => {
    expect(normalizeDesignMode("comment")).toBeNull();
    expect(getDesignToolActivationState("comment")).toEqual({
      mode: "comment",
      pinMode: true,
    });
  });
});

describe("comment pins", () => {
  it("hides comment pins in Interact even when comments are shown", () => {
    expect(
      areCommentPinsHidden({ commentsHidden: false, mode: "interact" }),
    ).toBe(true);
    expect(
      areCommentPinsHidden({ commentsHidden: true, mode: "interact" }),
    ).toBe(true);
  });

  it.each(["edit", "comment"] as const)(
    "follows the show-comments setting in %s mode",
    (mode) => {
      expect(areCommentPinsHidden({ commentsHidden: false, mode })).toBe(false);
      expect(areCommentPinsHidden({ commentsHidden: true, mode })).toBe(true);
    },
  );
});
