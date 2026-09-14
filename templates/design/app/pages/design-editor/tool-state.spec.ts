import { describe, expect, it } from "vitest";

import {
  getDesignBottomToolbarMode,
  resolveModeChangeView,
  resolveSpaceForwardTransition,
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

describe("resolveSpaceForwardTransition", () => {
  // Figma parity (unique-paths): Space held mid-drag is forwarded into the
  // preview iframes so the bridge keeps the dragged node's parent. The
  // release path is the one that regressed — the drag is already over by the
  // time Space comes up, so a keyup that re-checks "is a drag running" never
  // sends held:false and the NEXT drag starts with reparenting still
  // suppressed.
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

  it("stays armed (no broadcast) when a keydown lands after the drag already ended mid-hold", () => {
    // The drag that armed forwarding is over (mouseup cleared dragActive)
    // but Space is still down — `armed` must stay true with nothing new to
    // broadcast, distinct from a fresh, never-armed keydown which also gets
    // broadcast: null but with armed: false.
    expect(resolveSpaceForwardTransition("keydown", true, false)).toEqual({
      armed: true,
      broadcast: null,
    });
  });

  // Regression: keydown-during-drag -> mouseup -> a duplicate keydown
  // (repeat: false, e.g. a second physical key event while held) -> keyup.
  // A caller that treats `broadcast !== null` as the sole "this is mine"
  // signal misses the duplicate keydown above (armed: true, broadcast:
  // null) and falls through to arming the temporary hand tool mid-hold,
  // which then never gets un-armed because the matching keyup takes the
  // forward-release branch instead of the hand-tool-restore branch. This
  // mirrors DesignEditor.tsx's keydown/keyup wiring closely enough to catch
  // that caller bug directly, since the wiring itself isn't unit-testable.
  it("event order: keydown-during-drag -> mouseup -> duplicate keydown -> keyup never arms the hand tool", () => {
    let armed = false;
    let dragActive = true;
    let tool: "move" | "hand" = "move";
    let stashedTool: "move" | "hand" | null = null;
    const broadcasts: boolean[] = [];

    function keydown() {
      const result = resolveSpaceForwardTransition(
        "keydown",
        armed,
        dragActive,
      );
      if (result.armed) {
        armed = true;
        if (result.broadcast !== null) broadcasts.push(result.broadcast);
        return;
      }
      if (stashedTool !== null) return;
      stashedTool = tool;
      tool = "hand";
    }
    function keyup() {
      const result = resolveSpaceForwardTransition("keyup", armed, dragActive);
      if (result.broadcast !== null) {
        armed = result.armed;
        broadcasts.push(result.broadcast);
        return;
      }
      if (stashedTool === null) return;
      tool = stashedTool;
      stashedTool = null;
    }

    keydown(); // Space lands during the drag: forwarding arms
    dragActive = false; // mouseup ends the drag while Space stays held
    keydown(); // duplicate keydown mid-hold (repeat: false)
    keyup(); // Space released

    expect(tool).toBe("move"); // never armed the temporary hand tool
    expect(stashedTool).toBeNull();
    expect(broadcasts).toEqual([true, false]); // armed once, released once
  });
});
