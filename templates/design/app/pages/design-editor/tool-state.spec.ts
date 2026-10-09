import { describe, expect, it } from "vitest";

import {
  commandRequestsAnnotate,
  getDesignBottomToolbarMode,
  normalizeDesignTool,
  resolveDrawStateWithoutLab,
  resolveModeChangeView,
  resolveModeForAnnotateLab,
  resolveSpaceForwardTransition,
  resolveToolAfterSelection,
  resolveAvailableTool,
  shouldAskOnNewDesignArrival,
  shouldRevealLayersOnFirstCreate,
  toCanvasTool,
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

describe("Agent and Comment tools", () => {
  it("accepts agent as a tool alongside the rest", () => {
    expect(normalizeDesignTool("agent")).toBe("agent");
    expect(normalizeDesignTool("comment")).toBe("comment");
    expect(normalizeDesignTool("nope")).toBeNull();
  });

  it("lands a request for the hidden Comment tool on Move, and shows it when it is shown", () => {
    expect(resolveAvailableTool("comment", "on")).toBe("move");
    expect(resolveAvailableTool("comment", "off", false)).toBe("move");
    expect(resolveAvailableTool("comment", "off", true)).toBe("comment");
  });

  it("keeps the Agent tool armed through a selection, like Scale, and resets the rest", () => {
    expect(resolveToolAfterSelection("agent")).toBe("agent");
    expect(resolveToolAfterSelection("scale")).toBe("scale");
    for (const tool of [
      "move",
      "frame",
      "rect",
      "text",
      "pen",
      "hand",
    ] as const) {
      expect(resolveToolAfterSelection(tool)).toBe("move");
    }
  });

  it("gives the canvas Move behavior under the Agent tool and leaves other tools alone", () => {
    expect(toCanvasTool("agent")).toBe("move");
    for (const tool of [
      "move",
      "frame",
      "rect",
      "text",
      "pen",
      "hand",
      "scale",
    ] as const) {
      expect(toCanvasTool(tool)).toBe(tool);
    }
  });
});

describe("Annotate lab gate", () => {
  it("keeps Annotate and Draw while the lab is on", () => {
    expect(resolveModeForAnnotateLab("annotate", "on")).toBe("annotate");
    expect(resolveAvailableTool("draw", "on")).toBe("draw");
  });

  it.each(["off", "loading"] as const)(
    "lands Annotate on Design and Draw on Move while the lab is %s",
    (lab) => {
      expect(resolveModeForAnnotateLab("annotate", lab)).toBe("edit");
      expect(resolveAvailableTool("draw", lab)).toBe("move");
    },
  );

  it.each(["on", "off", "loading"] as const)(
    "leaves every other mode and tool alone while the lab is %s",
    (lab) => {
      expect(resolveModeForAnnotateLab("edit", lab)).toBe("edit");
      expect(resolveModeForAnnotateLab("interact", lab)).toBe("interact");
      for (const tool of [
        "move",
        "pen",
        "text",
        "hand",
        "scale",
        "agent",
      ] as const) {
        expect(resolveAvailableTool(tool, lab)).toBe(tool);
      }
    },
  );

  it("clears a leftover Draw state only once the lab is known to be off", () => {
    const drawing = {
      activeTool: "draw",
      drawMode: true,
      pinMode: false,
    } as const;
    expect(
      resolveDrawStateWithoutLab({ ...drawing, annotateLab: "off" }),
    ).toEqual({ dropAnnotateMode: true });
    expect(
      resolveDrawStateWithoutLab({ ...drawing, annotateLab: "on" }),
    ).toBeNull();
    expect(
      resolveDrawStateWithoutLab({ ...drawing, annotateLab: "loading" }),
    ).toBeNull();
  });

  it("leaves Annotate mode to a comment pin and ignores an editor that is not drawing", () => {
    expect(
      resolveDrawStateWithoutLab({
        annotateLab: "off",
        activeTool: "draw",
        drawMode: true,
        pinMode: true,
      }),
    ).toEqual({ dropAnnotateMode: false });
    expect(
      resolveDrawStateWithoutLab({
        annotateLab: "off",
        activeTool: "comment",
        drawMode: false,
        pinMode: true,
      }),
    ).toBeNull();
    expect(
      resolveDrawStateWithoutLab({
        annotateLab: "off",
        activeTool: "move",
        drawMode: false,
        pinMode: false,
      }),
    ).toBeNull();
  });

  it("recognises a command that asks for Annotate or Draw", () => {
    expect(commandRequestsAnnotate({ mode: "annotate" })).toBe(true);
    expect(commandRequestsAnnotate({ tool: "draw" })).toBe(true);
    expect(commandRequestsAnnotate({ mode: "edit", tool: "rect" })).toBe(false);
    expect(commandRequestsAnnotate({ tool: "comment" })).toBe(false);
    expect(commandRequestsAnnotate({})).toBe(false);
    expect(commandRequestsAnnotate({ mode: 3, tool: ["draw"] })).toBe(false);
  });
});
