/**
 * linked-screen-preview.test.ts
 *
 * BUG-UNDO-LINKED-BREAKPOINT — a base (main) style edit updates every linked
 * breakpoint iframe for the same screen, but undo used to call only the
 * active canvas's `__designCanvasReplaceContent` bridge helper. Sibling
 * `::bp-*` frames kept the edited DOM while the main frame reverted.
 *
 * The linked-preview registry lets the active bridge fan out replace/style
 * calls to every mounted frame that shares the screen id.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getBreakpointIframeId } from "./iframe-targeting";
import {
  __clearLinkedScreenPreviewHandlersForTests,
  __linkedScreenPreviewHandlerCountForTests,
  isLinkedScreenPreviewFrameId,
  linkedScreenPreviewFrameIds,
  registerLinkedScreenPreviewHandlers,
  replaceLinkedScreenPreviewContent,
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
    // Old undo path: only the active (primary) bridge replace ran.
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
    // Unrelated screen untouched.
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
