import { afterEach, describe, expect, it, vi } from "vitest";

import { getBreakpointIframeId } from "./iframe-targeting";
import {
  __clearLinkedScreenPreviewHandlersForTests,
  __linkedScreenPreviewHandlerCountForTests,
  isLinkedScreenPreviewFrameId,
  linkedScreenPreviewFrameIds,
  registerLinkedScreenPreviewHandlers,
  replaceLinkedScreenPreviewContent,
  sendLinkedScreenPreviewCancelPendingDelete,
  sendLinkedScreenPreviewPendingDelete,
  sendLinkedScreenPreviewInteractionStateStyle,
  sendLinkedScreenPreviewStyleChange,
} from "./linked-screen-preview";

afterEach(() => {
  __clearLinkedScreenPreviewHandlersForTests();
});

describe("linked screen preview frame ids", () => {
  it("treats the primary id and ::bp-* siblings as linked, and rejects other screens", () => {
    expect(isLinkedScreenPreviewFrameId("screen-a", "screen-a")).toBe(true);
    expect(
      isLinkedScreenPreviewFrameId(
        "screen-a",
        getBreakpointIframeId("screen-a", 390),
      ),
    ).toBe(true);
    expect(isLinkedScreenPreviewFrameId("screen-a", "screen-a-extra")).toBe(
      false,
    );
    expect(isLinkedScreenPreviewFrameId("screen-a", "screen-b")).toBe(false);
    expect(
      isLinkedScreenPreviewFrameId(
        "screen-a",
        getBreakpointIframeId("screen-b", 390),
      ),
    ).toBe(false);
  });

  it("lists primary plus each breakpoint width", () => {
    expect(linkedScreenPreviewFrameIds("screen-a", [390, 768])).toEqual([
      "screen-a",
      "screen-a::bp-390",
      "screen-a::bp-768",
    ]);
  });
});

describe("BUG-UNDO-LINKED-BREAKPOINT — fan-out replace/style", () => {
  it("BEFORE FIX: replacing only the active frame leaves the breakpoint sibling stale", () => {
    const previews = {
      "screen-a": '<div style="padding:24px">Card</div>',
      "screen-a::bp-390": '<div style="padding:24px">Card</div>',
    };
    previews["screen-a"] = '<div style="padding:8px">Card</div>';
    expect(previews["screen-a"]).toContain("padding:8px");
    expect(previews["screen-a::bp-390"]).toContain("padding:24px");
  });

  it("AFTER FIX: replaceLinkedScreenPreviewContent updates primary and breakpoint frames", () => {
    const previews: Record<string, string> = {
      "screen-a": '<div style="padding:24px">Card</div>',
      "screen-a::bp-390": '<div style="padding:24px">Card</div>',
      "screen-b": '<div style="padding:24px">Other</div>',
    };
    for (const frameId of Object.keys(previews)) {
      registerLinkedScreenPreviewHandlers(frameId, {
        replaceContent: (html) => {
          previews[frameId] = html;
          return true;
        },
        sendStyleChange: () => false,
      });
    }

    const before = '<div style="padding:8px">Card</div>';
    expect(
      replaceLinkedScreenPreviewContent("screen-a", before, null, [], {
        forceFullDocument: true,
      }),
    ).toBe(true);

    expect(previews["screen-a"]).toBe(before);
    expect(previews["screen-a::bp-390"]).toBe(before);
    expect(previews["screen-b"]).toContain("padding:24px");
  });

  it("AFTER FIX: sendLinkedScreenPreviewStyleChange fans out base style commits", () => {
    const paddingByFrame: Record<string, string> = {
      "screen-a": "8px",
      "screen-a::bp-390": "8px",
    };
    for (const frameId of Object.keys(paddingByFrame)) {
      registerLinkedScreenPreviewHandlers(frameId, {
        replaceContent: () => false,
        sendStyleChange: (_selector, property, value) => {
          if (property === "padding") paddingByFrame[frameId] = value;
          return true;
        },
      });
    }

    expect(
      sendLinkedScreenPreviewStyleChange(
        "screen-a",
        "#card",
        "padding",
        "24px",
        { nodeId: "card" },
      ),
    ).toBe(true);
    expect(paddingByFrame["screen-a"]).toBe("24px");
    expect(paddingByFrame["screen-a::bp-390"]).toBe("24px");
  });

  it("targets the selected screen when inspector selection switches frames", () => {
    const opacityByFrame = { library: "1", settings: "1" };
    for (const screenId of Object.keys(opacityByFrame) as Array<
      keyof typeof opacityByFrame
    >) {
      registerLinkedScreenPreviewHandlers(screenId, {
        replaceContent: () => false,
        sendStyleChange: (_selector, property, value) => {
          if (property === "opacity") opacityByFrame[screenId] = value;
          return true;
        },
      });
    }

    sendLinkedScreenPreviewStyleChange(
      "library",
      "#library-title",
      "opacity",
      "0.5",
    );
    expect(opacityByFrame).toEqual({ library: "0.5", settings: "1" });

    sendLinkedScreenPreviewStyleChange(
      "settings",
      "#settings-title",
      "opacity",
      "0.25",
    );
    expect(opacityByFrame).toEqual({ library: "0.5", settings: "0.25" });
  });

  it("conceals every linked source frame before a cross-screen insert", () => {
    const concealed: string[] = [];
    for (const frameId of ["library", "library::bp-390", "settings"]) {
      registerLinkedScreenPreviewHandlers(frameId, {
        replaceContent: () => false,
        sendStyleChange: () => false,
        pendingDelete: ({ requestId }) => {
          concealed.push(`${frameId}:${requestId}`);
          return true;
        },
      });
    }

    expect(
      sendLinkedScreenPreviewPendingDelete("library", {
        selector: "#source",
        selectorCandidates: ["#source"],
        requestId: "move-1:source",
        transactionId: "move-1",
      }),
    ).toBe(true);
    expect(concealed).toEqual([
      "library:move-1:source",
      "library::bp-390:move-1:source",
    ]);
  });

  it("cancels pending delete only in the requested screen's linked frames", () => {
    const cancelPrimary = vi.fn(() => true);
    const cancelBreakpoint = vi.fn(() => true);
    const cancelOtherScreen = vi.fn(() => true);
    for (const [frameId, cancelPendingDelete] of [
      ["library", cancelPrimary],
      ["library::bp-390", cancelBreakpoint],
      ["settings", cancelOtherScreen],
    ] as const) {
      registerLinkedScreenPreviewHandlers(frameId, {
        replaceContent: () => false,
        sendStyleChange: () => false,
        cancelPendingDelete,
      });
    }

    const args = { requestId: "move-1:source", transactionId: "move-1" };
    expect(sendLinkedScreenPreviewCancelPendingDelete("library", args)).toBe(
      true,
    );
    expect(cancelPrimary).toHaveBeenCalledExactlyOnceWith(args);
    expect(cancelBreakpoint).toHaveBeenCalledExactlyOnceWith(args);
    expect(cancelOtherScreen).not.toHaveBeenCalled();
  });

  it("routes interaction-state previews to the linked screen only", () => {
    const statesByFrame: Record<string, string[]> = {
      "screen-a": [],
      "screen-a::bp-390": [],
      "screen-b": [],
    };
    for (const frameId of Object.keys(statesByFrame)) {
      registerLinkedScreenPreviewHandlers(frameId, {
        replaceContent: () => false,
        sendStyleChange: () => false,
        sendInteractionStatePreviewStyle: ({ state, routePath }) => {
          if (routePath !== "/library") return false;
          statesByFrame[frameId]!.push(state);
          return true;
        },
      });
    }

    expect(
      sendLinkedScreenPreviewInteractionStateStyle("screen-a", {
        selector: "#card",
        state: "hover",
        styles: { color: "red" },
        routePath: "/library",
      }),
    ).toBe(true);
    expect(statesByFrame["screen-a"]).toEqual(["hover"]);
    expect(statesByFrame["screen-a::bp-390"]).toEqual(["hover"]);
    expect(statesByFrame["screen-b"]).toEqual([]);
  });

  it("unregisters handlers on dispose so a remount cannot double-apply", () => {
    const replace = vi.fn(() => true);
    const dispose = registerLinkedScreenPreviewHandlers("screen-a", {
      replaceContent: replace,
      sendStyleChange: () => false,
    });
    expect(__linkedScreenPreviewHandlerCountForTests()).toBe(1);
    dispose();
    expect(__linkedScreenPreviewHandlerCountForTests()).toBe(0);
    expect(replaceLinkedScreenPreviewContent("screen-a", "<div/>")).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});
