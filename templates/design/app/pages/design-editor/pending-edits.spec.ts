import { describe, expect, it } from "vitest";

import type {
  PendingLiveLayerNameEdit,
  PendingLiveStructureEdit,
  PendingLiveTextEdit,
  PendingVisualStyleEdit,
} from "./pending-edits";
import {
  appendPendingLiveNonStyleUndoEntry,
  appendPendingVisualStyleUndoEntry,
  formatPendingVisualStylePrompt,
  formatVisualEditClipboardPrompt,
  mergePendingLiveNonStyleEdit,
  pendingLiveLayerNameUndoRevertValue,
  pendingVisualStyleGestureIdForPhase,
  resolveOverviewScreenSourceType,
} from "./pending-edits";

function styleEdit(
  selector: string,
  styles: Record<string, string>,
): PendingVisualStyleEdit {
  return {
    screenId: "home",
    filename: "index.html",
    screenName: "Home",
    selector,
    classes: [],
    styles,
    originalStyles: { color: "red" },
    updatedAt: 1,
  };
}

function textEdit(value: string): PendingLiveTextEdit {
  return {
    kind: "text",
    screenId: "home",
    filename: "index.html",
    screenName: "Home",
    selector: "h1",
    classes: [],
    value,
    originalValue: "Hello",
    updatedAt: 1,
  };
}

function layerNameEdit(name: string): PendingLiveLayerNameEdit {
  return {
    kind: "layer-name",
    screenId: "home",
    filename: "index.html",
    screenName: "Home",
    layerId: "hero",
    selector: '[data-agent-native-node-id="hero"]',
    sourceId: "hero",
    sourceAnchor: {
      sourceFile: "app/Clips.tsx",
      line: 18,
      column: 3,
      component: "Clips",
    },
    tagName: "section",
    classes: ["hero"],
    name,
    originalName: "Hero",
    updatedAt: 1,
  };
}

function structureEdit(
  overrides: Partial<PendingLiveStructureEdit> = {},
): PendingLiveStructureEdit {
  return {
    kind: "structure",
    screenId: "home",
    filename: "index.html",
    screenName: "Home",
    selector: "[data-agent-native-node-id=hero]",
    sourceId: "hero",
    anchorSelector: "body",
    placement: "inside",
    updatedAt: 1,
    ...overrides,
  };
}

describe("resolveOverviewScreenSourceType", () => {
  it("recognizes a bridged screen when sourceType is absent", () => {
    expect(
      resolveOverviewScreenSourceType({ bridgeUrl: "http://localhost:7331" }),
    ).toBe("localhost");
  });

  it("prefers an explicit source type over bridge metadata", () => {
    expect(
      resolveOverviewScreenSourceType({
        sourceType: "inline",
        bridgeUrl: "http://localhost:7331",
      }),
    ).toBe("inline");
  });
});

describe("appendPendingVisualStyleUndoEntry", () => {
  it("coalesces consecutive ticks on the same target and keeps the first revert", () => {
    const stack: Array<{
      edit: PendingVisualStyleEdit;
      revertStyles: Record<string, string>;
    }> = [];
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { color: "blue" }),
      revertStyles: { color: "red" },
    });
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { color: "green" }),
      revertStyles: { color: "blue" },
    });
    expect(stack).toHaveLength(1);
    expect(stack[0]?.edit.styles).toEqual({ color: "green" });
    expect(stack[0]?.revertStyles).toEqual({ color: "red" });
  });

  it("merges later properties into the same-target entry instead of replacing it", () => {
    const stack: Array<{
      edit: PendingVisualStyleEdit;
      revertStyles: Record<string, string>;
    }> = [];
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { color: "blue" }),
      revertStyles: { color: "red" },
    });
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { opacity: "0.5" }),
      revertStyles: { opacity: "1" },
    });
    expect(stack).toHaveLength(1);
    expect(stack[0]?.edit.styles).toEqual({ color: "blue", opacity: "0.5" });
    expect(stack[0]?.revertStyles).toEqual({ color: "red", opacity: "1" });
  });

  it("keeps distinct selectors as separate undo steps", () => {
    const stack: Array<{
      edit: PendingVisualStyleEdit;
      revertStyles: Record<string, string>;
    }> = [];
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { color: "blue" }),
      revertStyles: { color: "red" },
    });
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("p", { color: "green" }),
      revertStyles: { color: "black" },
    });
    expect(stack).toHaveLength(2);
  });

  it("groups scrub ticks by phase and gives the next gesture a new id", () => {
    const state = { sequence: 0, activeId: null as string | null };
    const firstPreview = pendingVisualStyleGestureIdForPhase(
      state,
      "preview",
      true,
    );
    expect(pendingVisualStyleGestureIdForPhase(state, "preview", true)).toBe(
      firstPreview,
    );
    expect(pendingVisualStyleGestureIdForPhase(state, "commit", true)).toBe(
      firstPreview,
    );
    const nextPreview = pendingVisualStyleGestureIdForPhase(
      state,
      "preview",
      true,
    );
    expect(nextPreview).not.toBe(firstPreview);
    expect(pendingVisualStyleGestureIdForPhase(state, "cancel", true)).toBe(
      undefined,
    );
    expect(state.activeId).toBeNull();
    expect(
      pendingVisualStyleGestureIdForPhase(state, undefined, true),
    ).not.toBe(nextPreview);
  });
});

describe("appendPendingLiveNonStyleUndoEntry", () => {
  it("coalesces consecutive text edits on the same node", () => {
    const stack: Array<{
      kind: "text";
      edit: PendingLiveTextEdit;
      revertValue: string;
    }> = [];
    appendPendingLiveNonStyleUndoEntry(stack, {
      kind: "text",
      edit: textEdit("Hel"),
      revertValue: "Hello",
    });
    appendPendingLiveNonStyleUndoEntry(stack, {
      kind: "text",
      edit: textEdit("Help"),
      revertValue: "Hel",
    });
    expect(stack).toHaveLength(1);
    expect(stack[0]?.edit.value).toBe("Help");
    expect(stack[0]?.revertValue).toBe("Hello");
  });

  it("coalesces live layer renames and removes the edit when reverted", () => {
    const first = layerNameEdit("Hero copy");
    const second = { ...layerNameEdit("Hero final"), updatedAt: 2 };
    const merged = mergePendingLiveNonStyleEdit([], first);
    const updated = mergePendingLiveNonStyleEdit(merged, second);

    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      kind: "layer-name",
      name: "Hero final",
    });
    expect(pendingLiveLayerNameUndoRevertValue(updated, second)).toBe(
      "Hero final",
    );
    expect(
      mergePendingLiveNonStyleEdit(updated, {
        ...layerNameEdit("Hero"),
        updatedAt: 3,
      }),
    ).toEqual([]);
  });

  it("keeps identical live selectors separate after route navigation", () => {
    const library = structureEdit({ routePath: "/library" });
    const settings = structureEdit({ routePath: "/settings", updatedAt: 2 });

    expect(mergePendingLiveNonStyleEdit([library], settings)).toHaveLength(2);
  });

  it("groups the two sides of a live move into one transaction", () => {
    const inserted = structureEdit({
      screenId: "settings",
      routePath: "/settings",
      sourceId: "copy",
      insertedHtml: '<div data-agent-native-node-id="copy"></div>',
      transactionId: "move-1",
    });
    const removed = structureEdit({
      screenId: "library",
      routePath: "/library",
      sourceId: "hero",
      removed: true,
      transactionId: "move-1",
      updatedAt: 2,
    });

    const merged = mergePendingLiveNonStyleEdit([inserted], removed);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      kind: "structure",
      transactionId: "move-1",
      groupedEdits: expect.arrayContaining([
        expect.objectContaining({ insertedHtml: expect.any(String) }),
        expect.objectContaining({ removed: true }),
      ]),
    });
  });
});

describe("formatVisualEditClipboardPrompt", () => {
  it("uses the page-local WebMCP handoff inside supported hosts", () => {
    const prompt = "Apply the exact source edits from this canvas.";
    expect(formatVisualEditClipboardPrompt(prompt, "chatgpt")).toContain(
      "get-visual-edit-prompt",
    );
    expect(formatVisualEditClipboardPrompt(prompt, "claude")).toContain(
      "get-visual-edit-prompt",
    );
    expect(formatVisualEditClipboardPrompt(prompt, "webmcp")).toContain(
      "get-visual-edit-prompt",
    );
  });

  it("keeps the detailed prompt for ordinary clipboard use", () => {
    expect(formatVisualEditClipboardPrompt("Apply these edits.", null)).toBe(
      "Apply these edits.",
    );
  });
});

describe("formatPendingVisualStylePrompt", () => {
  it("returns an empty WebMCP prompt when the canvas has no pending edits", () => {
    expect(
      formatPendingVisualStylePrompt({
        designId: "design-1",
        edits: [],
        liveEdits: [],
      }),
    ).toBe("");
  });

  it("describes multi-operation handoff as source edits with provenance and before/after", () => {
    const prompt = formatPendingVisualStylePrompt({
      audience: "coding-agent",
      screenRoutes: { home: "/clips" },
      edits: [
        {
          ...styleEdit("h1", { color: "blue" }),
          sourceAnchor: {
            sourceFile: "app/Clips.tsx",
            line: 12,
            column: 3,
            component: "Clips",
          },
        },
      ],
      liveEdits: [
        {
          ...textEdit("Updated"),
          sourceAnchor: {
            sourceFile: "app/Clips.tsx",
            line: 14,
            column: 5,
            component: "Clips",
          },
        },
      ],
    });

    expect(prompt).toContain('"operation": "update-style"');
    expect(prompt).toContain('"operation": "update-text"');
    expect(prompt).toContain('"before": {');
    expect(prompt).toContain('"after": {');
    expect(prompt).toContain('"provenance":');
    expect(prompt).toContain("never hand off inline-style mutations");
    expect(prompt).not.toContain('style="color: blue"');
    expect(prompt).toContain('"screen": "/clips"');
  });

  it("hands live layer renames off as metadata with source provenance", () => {
    const prompt = formatPendingVisualStylePrompt({
      audience: "coding-agent",
      edits: [],
      liveEdits: [layerNameEdit("Library hero")],
    });

    expect(prompt).toContain('"operation": "metadata"');
    expect(prompt).toContain('"metadata": "data-agent-native-layer-name"');
    expect(prompt).toContain('"before": "Hero"');
    expect(prompt).toContain('"after": "Library hero"');
    expect(prompt).toContain('"sourceFile": "app/Clips.tsx"');
  });
});
