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
  isVisualEditHandoffAcknowledged,
  mergePendingLiveNonStyleEdit,
  nextPendingLiveEditTimestamp,
  pendingLiveLayerNameUndoRevertValue,
  relativeOperationsForStyles,
  pendingVisualStyleRouteMatches,
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

describe("relative selected-screen style intent", () => {
  it("keeps only changed properties from a batched relative scrub", () => {
    expect(
      relativeOperationsForStyles(
        { marginLeft: "calc(4px + var(--step))", marginRight: "8px" },
        {
          relativeDelta: 2,
          relativeDeltaProperties: ["marginLeft", "marginRight", "gap"],
        },
      ),
    ).toEqual({
      marginLeft: { kind: "delta", delta: 2 },
      marginRight: { kind: "delta", delta: 2 },
    });
  });

  it("preserves authored expressions rather than recording the DOM result", () => {
    expect(
      relativeOperationsForStyles(
        { width: "248px" },
        {
          relativeExpression: {
            expression: "+8",
            unit: "px",
          },
        },
      ),
    ).toEqual({
      width: { kind: "expression", expression: "+8", unit: "px" },
    });
  });
});

describe("appendPendingVisualStyleUndoEntry", () => {
  it("keeps timestamps strictly ordered within one clock tick", () => {
    const first = nextPendingLiveEditTimestamp(10_000);
    const second = nextPendingLiveEditTimestamp(10_000);
    expect(second).toBeGreaterThan(first);
  });

  it("coalesces explicit gesture ticks and keeps the first revert", () => {
    const stack: Array<{
      edit: PendingVisualStyleEdit;
      revertStyles: Record<string, string>;
    }> = [];
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { color: "blue" }),
      revertStyles: { color: "red" },
      gestureId: "gesture-1",
    });
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { color: "green" }),
      revertStyles: { color: "blue" },
      gestureId: "gesture-1",
    });
    expect(stack).toHaveLength(1);
    expect(stack[0]?.edit.styles).toEqual({ color: "green" });
    expect(stack[0]?.revertStyles).toEqual({ color: "red" });
  });

  it("keeps separate committed ticks for the same target and property", () => {
    const stack: Array<{
      edit: PendingVisualStyleEdit;
      revertStyles: Record<string, string>;
    }> = [];
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { borderRadius: "24px" }),
      revertStyles: { borderRadius: "0px" },
    });
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { borderRadius: "48px" }),
      revertStyles: { borderRadius: "24px" },
    });
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { backgroundColor: "blue" }),
      revertStyles: { backgroundColor: "white" },
    });
    expect(stack.map((entry) => entry.edit.styles)).toEqual([
      { borderRadius: "24px" },
      { borderRadius: "48px" },
      { backgroundColor: "blue" },
    ]);
    expect(stack.map((entry) => entry.revertStyles)).toEqual([
      { borderRadius: "0px" },
      { borderRadius: "24px" },
      { backgroundColor: "white" },
    ]);
  });

  it("keeps adjacent property changes as separate undo steps", () => {
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
    expect(stack).toHaveLength(2);
    expect(stack[0]?.edit.styles).toEqual({ color: "blue" });
    expect(stack[0]?.revertStyles).toEqual({ color: "red" });
    expect(stack[1]?.edit.styles).toEqual({ opacity: "0.5" });
    expect(stack[1]?.revertStyles).toEqual({ opacity: "1" });
  });

  it("does not merge different properties that share a gesture id", () => {
    const stack: Array<{
      edit: PendingVisualStyleEdit;
      revertStyles: Record<string, string>;
      gestureId?: string;
    }> = [];
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { borderRadius: "24px" }),
      revertStyles: { borderRadius: "0px" },
      gestureId: "gesture-1",
    });
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { backgroundColor: "blue" }),
      revertStyles: { backgroundColor: "white" },
      gestureId: "gesture-1",
    });
    expect(stack).toHaveLength(2);
    expect(stack.map((entry) => entry.edit.styles)).toEqual([
      { borderRadius: "24px" },
      { backgroundColor: "blue" },
    ]);
  });

  it("keeps interleaved style edits in strict reverse order", () => {
    const stack: Array<{
      edit: PendingVisualStyleEdit;
      revertStyles: Record<string, string>;
    }> = [];
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { borderRadius: "24px" }),
      revertStyles: { borderRadius: "0px" },
    });
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { backgroundColor: "blue" }),
      revertStyles: { backgroundColor: "white" },
    });
    appendPendingVisualStyleUndoEntry(stack, {
      edit: styleEdit("h1", { borderRadius: "48px" }),
      revertStyles: { borderRadius: "24px" },
    });
    expect(stack.map((entry) => entry.edit.styles)).toEqual([
      { borderRadius: "24px" },
      { backgroundColor: "blue" },
      { borderRadius: "48px" },
    ]);
    expect(stack.map((entry) => entry.revertStyles)).toEqual([
      { borderRadius: "0px" },
      { backgroundColor: "white" },
      { borderRadius: "24px" },
    ]);
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

describe("pendingVisualStyleRouteMatches", () => {
  it("does not replay a history patch into a different or unknown live route", () => {
    expect(
      pendingVisualStyleRouteMatches({ routePath: "/library" }, "/record"),
    ).toBe(false);
    expect(
      pendingVisualStyleRouteMatches({ routePath: "/library" }, null),
    ).toBe(false);
    expect(pendingVisualStyleRouteMatches({}, "/record")).toBe(true);
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

  it("keeps a text edit after an interleaved global history entry", () => {
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
    appendPendingLiveNonStyleUndoEntry(
      stack,
      {
        kind: "text",
        edit: textEdit("Help"),
        revertValue: "Hel",
      },
      false,
    );
    expect(stack).toHaveLength(2);
    expect(stack.map((entry) => entry.edit.value)).toEqual(["Hel", "Help"]);
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
  it("uses the hosted MCP handoff across detected and unknown hosts", () => {
    const prompt = "Apply the exact source edits from this canvas.";
    for (const host of [
      "chatgpt",
      "claude",
      "codex",
      "webmcp",
      null,
      undefined,
    ] as const) {
      const copied = formatVisualEditClipboardPrompt(
        prompt,
        host,
        false,
        "design-1",
      );
      expect(copied).toContain("get-visual-edit-pending");
      expect(copied).toContain('{ designId: "design-1" }');
      expect(copied).toContain("acknowledge-visual-edit-pending");
      const browserToolIndex = copied.indexOf("get-visual-edit-prompt");
      if (browserToolIndex !== -1) {
        expect(copied.indexOf("get-visual-edit-pending")).toBeLessThan(
          browserToolIndex,
        );
      }
    }
  });

  it("keeps page-local WebMCP as a fallback when no MCP server is available", () => {
    const copied = formatVisualEditClipboardPrompt(
      "Apply edits.",
      "webmcp",
      false,
      "design-1",
    );
    expect(copied).toContain("get-visual-edit-pending");
    expect(copied).toContain('{ designId: "design-1" }');
    expect(copied).toContain("get-visual-edit-prompt");
    expect(copied).toContain("If you cannot access the Design MCP server");
  });

  it("uses the design id from the URL when it is not passed", () => {
    const copied = formatVisualEditClipboardPrompt("Apply these edits.", null);
    expect(copied).toContain("get-visual-edit-pending");
    expect(copied).toContain("using the design ID from this URL");
  });

  it("copies full implementation instructions and the detailed handoff", () => {
    const prompt = "Apply these exact edits to the connected app source.";
    const copied = formatVisualEditClipboardPrompt(
      prompt,
      "webmcp",
      true,
      "design-1",
    );
    expect(copied).toContain("Design ID: design-1");
    expect(copied).toContain("idiomatic code changes");
    expect(copied).toContain("Verify the running app after HMR");
    expect(copied).toContain("get-visual-edit-pending");
    expect(copied).toContain(prompt);
    expect(copied).not.toContain("If you cannot access the Design MCP server");
  });
});

describe("isVisualEditHandoffAcknowledged", () => {
  it("clears only the exact locally pending revision", () => {
    const base = {
      currentRevision: 8,
      pendingEditCount: 3,
      status: "empty",
      revision: 8,
    } as const;

    expect(isVisualEditHandoffAcknowledged(base)).toBe(true);
    expect(isVisualEditHandoffAcknowledged({ ...base, revision: 7 })).toBe(
      false,
    );
    expect(isVisualEditHandoffAcknowledged({ ...base, status: "ready" })).toBe(
      false,
    );
    expect(
      isVisualEditHandoffAcknowledged({ ...base, pendingEditCount: 0 }),
    ).toBe(false);
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

  it("makes relative CSS intent authoritative over an absolute live preview value", () => {
    const prompt = formatPendingVisualStylePrompt({
      audience: "coding-agent",
      edits: [
        {
          ...styleEdit(".card", { width: "248px" }),
          originalStyles: { width: "calc(100% - var(--gutter))" },
          relativeOperations: {
            width: {
              kind: "expression",
              expression: "+8",
              unit: "px",
            },
          },
        },
      ],
    });

    expect(prompt).toContain('"width": "calc(100% - var(--gutter))"');
    expect(prompt).toContain('"width": "248px"');
    expect(prompt).toContain('"kind": "expression"');
    expect(prompt).toContain('"expression": "+8"');
    expect(prompt).toContain(
      "relativeOperations entry is the authoritative source intent",
    );
    expect(prompt).toContain("do not replace calc(), var()");
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
