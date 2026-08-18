import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  hasScopedLayerState,
  layerStateIdsForScreen,
  scopedLayerStateId,
} from "./layer-state-scope";
import {
  buildPendingVisualStyleRevertPatches,
  formatPendingVisualStylePrompt,
  getPendingVisualEditCount,
  mergePendingLiveNonStyleEdits,
  type PendingLiveLayerStateEdit,
  pendingLiveLayerStateUndoRevertValue,
  type PendingVisualStyleEdit,
  replayPendingVisualStyleRuntimePatch,
  shouldRedoPendingLiveNonStyleBeforeStyle,
} from "./pending-edits";

const editorSource = readFileSync(
  new URL("../DesignEditor.tsx", import.meta.url),
  "utf8",
);

function layerStateEdit(
  state: "hidden" | "locked",
  enabled: boolean,
  originalEnabled: boolean,
  updatedAt = 1,
): PendingLiveLayerStateEdit {
  return {
    kind: "layer-state",
    screenId: "screen-home",
    filename: "Home",
    screenName: "Home",
    layerId: "layer-card",
    selector: "#card",
    sourceId: "card",
    tagName: "div",
    classes: ["card"],
    state,
    enabled,
    originalEnabled,
    updatedAt,
  };
}

describe("live style runtime history", () => {
  it("uses one screen-targeted per-property channel for forward, undo, and redo without touching the route URL", () => {
    const routeUrl = "http://localhost:5173/home";
    const send = vi.fn(() => true);
    const patch = {
      screenId: "screen-home",
      selector: "#card",
      sourceId: "card",
      styles: { color: "red", borderRadius: "16px" },
    };

    expect(replayPendingVisualStyleRuntimePatch(patch, send)).toBe(true);
    expect(
      replayPendingVisualStyleRuntimePatch(
        { ...patch, styles: { color: "blue", borderRadius: "4px" } },
        send,
      ),
    ).toBe(true);
    expect(replayPendingVisualStyleRuntimePatch(patch, send)).toBe(true);

    expect(send).toHaveBeenCalledTimes(6);
    expect(send).toHaveBeenNthCalledWith(
      1,
      "screen-home",
      "#card",
      "color",
      "red",
      {
        selectorCandidates: ["#card", '[data-agent-native-node-id="card"]'],
        nodeId: "card",
      },
    );
    expect(routeUrl).toBe("http://localhost:5173/home");
  });

  it("routes localhost forward styles and undo/redo through the shared targeted helper", () => {
    const forwardSection = editorSource.slice(
      editorSource.indexOf(
        "if (isRunningAppSourceType(activeCanvasSourceType))",
      ),
      editorSource.indexOf(
        "// Base every patch off the freshest known content",
      ),
    );
    const undoReplaySection = editorSource.slice(
      editorSource.indexOf(
        "const requestPendingVisualStyleRevert = useCallback(",
      ),
      editorSource.indexOf(
        "const requestPendingLiveNonStyleRevert = useCallback(",
      ),
    );

    expect(forwardSection).toContain("replayPendingVisualStyleRuntimePatch(");
    expect(forwardSection).not.toContain("updateLiveScreenSnapshotContent");
    expect(undoReplaySection).toContain(
      "replayPendingVisualStyleRuntimePatch(",
    );
    expect(undoReplaySection).not.toContain("replacePreviewContent");
  });

  it("reverts a localhost style edit through the runtime node-id namespace, not the source projection", () => {
    // A localhost screen's selection is canonicalized onto the host's own
    // source projection, so selector/sourceId name nodes the live document has
    // never carried. Reverting against them resolves nothing and the bridge
    // returns silently — the reported undo-does-not-revert bug.
    const canonicalized: PendingVisualStyleEdit = {
      screenId: "screen-home",
      filename: "http://localhost:8210/",
      screenName: "Home",
      selector: '[data-agent-native-node-id="an-source-1"]',
      sourceId: "an-source-1",
      runtimeSelector: '[data-agent-native-node-id="runtime-live-1"]',
      runtimeSourceId: "runtime-live-1",
      classes: [],
      styles: { fontSize: "48px" },
      originalStyles: { fontSize: "16px" },
      updatedAt: 1,
    };

    const [patch] = buildPendingVisualStyleRevertPatches([canonicalized]);
    expect(patch).toMatchObject({
      runtimeSelector: '[data-agent-native-node-id="runtime-live-1"]',
      runtimeSourceId: "runtime-live-1",
    });

    const send = vi.fn(() => true);
    expect(replayPendingVisualStyleRuntimePatch(patch!, send)).toBe(true);
    expect(send).toHaveBeenCalledWith(
      "screen-home",
      '[data-agent-native-node-id="runtime-live-1"]',
      "fontSize",
      "16px",
      {
        selectorCandidates: [
          '[data-agent-native-node-id="runtime-live-1"]',
          '[data-agent-native-node-id="an-source-1"]',
        ],
        nodeId: "runtime-live-1",
      },
    );
  });

  it("reports an unaddressable revert instead of letting the bridge restyle its own selection", () => {
    const send = vi.fn(() => true);

    expect(
      replayPendingVisualStyleRuntimePatch(
        {
          screenId: "screen-home",
          selector: "",
          sourceId: null,
          styles: { color: "red" },
        },
        send,
      ),
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("pending live layer state history", () => {
  it("counts and coalesces hide/lock updates, including a net-zero toggle", () => {
    const hidden = layerStateEdit("hidden", true, false);
    const locked = layerStateEdit("locked", true, false, 2);
    const pending = mergePendingLiveNonStyleEdits([hidden, locked]);

    expect(pending).toHaveLength(2);
    expect(getPendingVisualEditCount([], pending)).toBe(2);
    expect(
      pendingLiveLayerStateUndoRevertValue(pending, {
        ...hidden,
        enabled: false,
        originalEnabled: true,
        updatedAt: 3,
      }),
    ).toBe(true);
    expect(
      mergePendingLiveNonStyleEdits([
        hidden,
        { ...hidden, enabled: false, originalEnabled: true, updatedAt: 3 },
      ]),
    ).toEqual([]);
  });

  it("includes durable hide/lock metadata in the Apply handoff", () => {
    const prompt = formatPendingVisualStylePrompt({
      designId: "design-1",
      edits: [],
      liveEdits: [layerStateEdit("hidden", true, false)],
    });

    expect(prompt).toContain('"kind": "layer-state"');
    expect(prompt).toContain('"state": "hidden"');
    expect(prompt).toContain('"enabled": true');
    expect(prompt).toContain('"attributeName": "data-agent-native-hidden"');
  });

  it("queues localhost layer state before any snapshot-document write", () => {
    const section = editorSource.slice(
      editorSource.indexOf("const handleToggleLayerLocked"),
      editorSource.indexOf("const handleToggleLayerHidden"),
    );
    const localhostBranch = section.slice(
      section.indexOf("resolveOverviewScreenSourceType"),
      section.indexOf("if (owner?.runtimeOnly)"),
    );

    expect(localhostBranch).toContain("recordPendingLiveLayerStateEdit(");
    expect(localhostBranch).toContain(
      'applyLayerStatePreview(layerScreenId, layerId, "locked", locked)',
    );
    expect(localhostBranch).toContain("return;");
    expect(localhostBranch).not.toContain("updateLiveScreenSnapshotContent");
  });

  it("keeps identical live node ids isolated to their owning screens", () => {
    const state = new Set([scopedLayerStateId("screen-a", "shared-node")]);

    expect(hasScopedLayerState(state, "screen-a", "shared-node")).toBe(true);
    expect(hasScopedLayerState(state, "screen-b", "shared-node")).toBe(false);
    expect(layerStateIdsForScreen(state, "screen-a")).toEqual(
      new Set(["shared-node"]),
    );
    expect(layerStateIdsForScreen(state, "screen-b")).toEqual(new Set());
  });
});

describe("pending live redo chronology", () => {
  const style = (updatedAt: number) => ({ edit: { updatedAt } });
  const text = (updatedAt: number) => ({
    kind: "text" as const,
    edit: { updatedAt },
  });
  const structure = (updatedAt: number) => ({
    kind: "structure" as const,
    edit: { updatedAt },
  });

  it("redoes style A before later text B after both were undone", () => {
    expect(shouldRedoPendingLiveNonStyleBeforeStyle(style(1), text(2))).toBe(
      false,
    );
    expect(shouldRedoPendingLiveNonStyleBeforeStyle(undefined, text(2))).toBe(
      true,
    );
  });

  it("redoes style A before later structure B after both were undone", () => {
    expect(
      shouldRedoPendingLiveNonStyleBeforeStyle(style(10), structure(20)),
    ).toBe(false);
    expect(
      shouldRedoPendingLiveNonStyleBeforeStyle(undefined, structure(20)),
    ).toBe(true);
  });
});
