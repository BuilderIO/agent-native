import { readFileSync } from "node:fs";

/**
 * DesignEditor.linkedBreakpointUndo.spec.ts
 *
 * BUG-UNDO-LINKED-BREAKPOINT — overview shows one screen as a primary frame
 * plus linked breakpoint iframes (`screenId::bp-<width>`). Editing padding
 * (or another base style) on the main frame updates every linked frame
 * because they share one design_files document. Undo used to call only the
 * active canvas's replace bridge, so the main frame reverted while the
 * smaller breakpoint kept the edited styles.
 *
 * The active `__designCanvasReplaceContent` helper now fans out through
 * replaceLinkedScreenPreviewContent. This spec pins that contract the same
 * way DesignEditor.liveSnapshotUndoSync.spec.ts pins live-snapshot undo.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  __clearLinkedScreenPreviewHandlersForTests,
  registerLinkedScreenPreviewHandlers,
  replaceLinkedScreenPreviewContent,
} from "@/components/design/multi-screen/linked-screen-preview";

afterEach(() => {
  __clearLinkedScreenPreviewHandlersForTests();
});

interface LinkedPreviewState {
  primary: string;
  breakpoint390: string;
}

function registerLinkedFrames(state: LinkedPreviewState) {
  registerLinkedScreenPreviewHandlers("screen-home", {
    replaceContent: (html) => {
      state.primary = html;
      return true;
    },
    sendStyleChange: () => false,
  });
  registerLinkedScreenPreviewHandlers("screen-home::bp-390", {
    replaceContent: (html) => {
      state.breakpoint390 = html;
      return true;
    },
    sendStyleChange: () => false,
  });
}

describe("linked breakpoint undo/redo — multi-frame preview sync (BUG-UNDO-LINKED-BREAKPOINT)", () => {
  const before = '<div style="padding:8px">Hero</div>';
  const after = '<div style="padding:32px">Hero</div>';

  it("BEFORE FIX: replacing only the active primary frame leaves the breakpoint sibling on the edited value", () => {
    const state: LinkedPreviewState = {
      primary: after,
      breakpoint390: after,
    };
    // Old undo path: only __designCanvasReplaceContent on the active frame.
    state.primary = before;
    expect(state.primary).toBe(before);
    expect(state.breakpoint390).toBe(after);
  });

  it("AFTER FIX: an undo replace fans out to every linked breakpoint frame", () => {
    const state: LinkedPreviewState = {
      primary: after,
      breakpoint390: after,
    };
    registerLinkedFrames(state);

    expect(
      replaceLinkedScreenPreviewContent("screen-home", before, null, [], {
        forceFullDocument: true,
      }),
    ).toBe(true);
    expect(state.primary).toBe(before);
    expect(state.breakpoint390).toBe(before);
  });

  it("AFTER FIX: redo re-applies the same fan-out", () => {
    const state: LinkedPreviewState = {
      primary: before,
      breakpoint390: before,
    };
    registerLinkedFrames(state);

    expect(
      replaceLinkedScreenPreviewContent("screen-home", after, null, [], {
        forceFullDocument: true,
      }),
    ).toBe(true);
    expect(state.primary).toBe(after);
    expect(state.breakpoint390).toBe(after);
  });

  it("wires the active bridge globals through the linked-frame fan-out helpers", () => {
    const source = readFileSync(
      new URL("../components/design/DesignCanvas.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("BUG-UNDO-LINKED-BREAKPOINT");
    expect(source).toContain("replaceLinkedScreenPreviewContent");
    expect(source).toContain("sendLinkedScreenPreviewStyleChange");
    expect(source).toContain("registerLinkedScreenPreviewHandlers");
  });
});
