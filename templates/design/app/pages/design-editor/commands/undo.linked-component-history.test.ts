import { readFileSync } from "node:fs";

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
} from "@shared/component-model";
import { sourceContentHash } from "@shared/source-workspace";
import { describe, expect, it, vi } from "vitest";

const shaderWrites = vi.hoisted(() => new Set<string>());
vi.mock("@/components/design/inspector/GlslShaderPanel", () => ({
  isShaderWriteInFlight: (fileId: string | undefined) =>
    Boolean(fileId && shaderWrites.has(fileId)),
}));

import type { ElementInfo } from "@/components/design/types";
import { publishClipboardContentMutation } from "@/lib/clipboard-content-lineage";
import {
  elementInfoFromCodeLayerNode,
  type SelectedLayerTarget,
} from "@/pages/design-editor/code-layer-state";
import { runCommitStylesToSelectedLayers } from "@/pages/design-editor/commands/commit-styles-to-selected-layers";
import { runRecordPendingVisualStyleEdit } from "@/pages/design-editor/commands/record-pending-visual-style-edit";
import { runRedo } from "@/pages/design-editor/commands/redo";
import { runStyleChange } from "@/pages/design-editor/commands/style-change";
import { runStylesChange } from "@/pages/design-editor/commands/styles-change";
import { runUndo, type UndoArgs } from "@/pages/design-editor/commands/undo";
import {
  type ContentHistoryChange,
  contentHistoryEntryFromChanges,
  type GeometryHistoryEntry,
  reserveLinkedComponentContentHistory,
} from "@/pages/design-editor/history";
import {
  pendingVisualStyleGestureIdForPhase,
  type PendingVisualStyleUndoEntry,
} from "@/pages/design-editor/pending-edits";

import {
  createLinkedComponentMutationQueue,
  type LinkedComponentActionResult,
  type LinkedComponentMutationQueueArgs,
} from "./linked-component-mutation";

function liveStyleTargets(source: string): SelectedLayerTarget[] {
  const fileId = "file-a";
  const sourceRef = { kind: "design-file" as const, fileId };
  const projection = buildCodeLayerProjection(source, { source: sourceRef });
  const tree = buildCodeLayerTree(projection);
  return ["main-child", "copy-child"].map((nodeId) => {
    const node = projection.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === nodeId,
    );
    if (!node) throw new Error(`Missing pending-style fixture node ${nodeId}`);
    const baseInfo = elementInfoFromCodeLayerNode(node);
    const initialColor = nodeId === "main-child" ? "red" : "orange";
    const runtimeId = `runtime-${nodeId}`;
    return {
      layerId: node.id,
      fileId,
      node,
      tree,
      elementInfo: {
        ...baseInfo,
        runtimeSelector: `#${runtimeId}`,
        runtimeSourceId: runtimeId,
        boundingRect: { x: 0, y: 0, width: 120, height: 40 },
        inlineStyles: { ...baseInfo.inlineStyles, color: initialColor },
        computedStyles: { ...baseInfo.computedStyles, color: initialColor },
        provenance: {
          framework: "react",
          sourceFile: "/project/src/App.tsx",
          line: nodeId === "main-child" ? 12 : 18,
          column: 3,
          component: "Card",
          method: "data-attribute",
        },
      },
    } satisfies SelectedLayerTarget;
  });
}

function commandArgs() {
  const beforeA =
    '<main><div data-agent-native-node-id="layer-a">before A</div></main>';
  const afterA =
    '<main><div data-agent-native-node-id="layer-a">after A</div></main>';
  const localBeforeA =
    '<main><div data-agent-native-node-id="layer-a">local before A</div></main>';
  const beforeB = "<main>before B</main>";
  const afterB = "<main>after B</main>";
  const layerId = buildCodeLayerProjection(beforeA, {
    source: { kind: "design-file", fileId: "file-a" },
  }).nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "layer-a",
  )!.id;
  const selection = {
    activeFileId: "file-a",
    overviewSelectedScreenIds: [],
    selectedLayerIds: [layerId],
    sourceContentByFileId: { "file-a": beforeA },
    sourceFileIdByFileId: { "file-a": "file-a" },
  };
  const content = new Map([
    ["file-a", afterA],
    ["file-b", afterB],
  ]);
  const contentUndoStackRef = {
    current: [
      contentHistoryEntryFromChanges(
        [
          { fileId: "file-a", before: beforeA, after: afterA },
          { fileId: "file-b", before: beforeB, after: afterB },
        ],
        true,
      )!,
    ],
  };
  const contentRedoStackRef = { current: [] as any[] };
  const contentHistorySelectionAfterRef = { current: new WeakMap() };
  const historyOrderRef = { current: ["content", "file-content"] as string[] };
  const redoOrderRef = { current: [] as string[] };
  const contentUndoSelectionStackRef: UndoArgs["contentUndoSelectionStackRef"] =
    {
      current: [selection],
    };
  const viewModeRef: UndoArgs["viewModeRef"] = { current: "single" };
  const applyLocalContentUpdate = vi.fn((next: string) => {
    content.set("file-a", next);
    return { status: "accepted" as const, content: next, nodeIdMap: new Map() };
  });
  const applyFileContentUpdate = vi.fn((fileId: string, next: string) => {
    content.set(fileId, next);
    return { status: "accepted" as const, content: next, nodeIdMap: new Map() };
  });
  const localContentRedoStackRef = { current: [] as any[] };
  const localContentUndoStackRef = {
    current: [{ fileId: "file-a", before: localBeforeA, after: beforeA }],
  };
  const setSelectedLayerIdsState = vi.fn();
  const restoreSelectionSnapshot = vi.fn((snapshot: any) => {
    if (snapshot) setSelectedLayerIdsState(snapshot.selectedLayerIds);
  });
  const args = {
    activeEditorDragRef: { current: false },
    activeFile: { id: "file-a", fileType: "html", updatedAt: null },
    applyFileContentUpdate,
    applyLocalContentUpdate,
    canEditDesign: true,
    clipboardPasteRedoStackRef: { current: [] as ContentHistoryChange[] },
    clipboardPasteUndoStackRef: { current: [] as ContentHistoryChange[] },
    codeLayerOwnerByNodeIdRef: { current: new Map() },
    contentHistorySelectionAfterRef,
    contentRedoSelectionStackRef: { current: [undefined] },
    contentRedoStackRef,
    contentUndoSelectionStackRef,
    contentUndoStackRef,
    createFileMutation: { mutateAsync: vi.fn() },
    deleteFileMutation: { mutateAsync: vi.fn() },
    deleteRuntimeElement: vi.fn(),
    designDataJsonRef: { current: {} },
    fileCreationRedoStackRef: { current: [] },
    fileCreationUndoStackRef: { current: [] },
    fileDeletionRedoStackRef: { current: [] },
    fileDeletionUndoStackRef: { current: [] },
    fileHistoryMutationPendingRef: { current: false },
    files: [{ id: "file-a" }, { id: "file-b" }],
    focusCreatedScreen: vi.fn(),
    geometryRedoStackRef: { current: [] },
    geometryUndoStackRef: { current: [] },
    getFreshActiveContent: () => content.get("file-a") ?? "",
    getScreenContent: (fileId: string) => content.get(fileId) ?? "",
    historyOrderRef,
    id: "design-1",
    isSynced: true,
    lastLocalContentRef: { current: null },
    latestClipboardMutationContentRef: { current: new Map() },
    liveFrameGeometryRef: { current: {} },
    liveScreenSnapshotsById: {},
    localContentRedoStackRef,
    localContentUndoStackRef,
    markPendingLocalFileContent: vi.fn(),
    optimisticallyInsertCreatedFile: vi.fn(),
    overviewScreens: [],
    pendingLiveNonStyleEditsRef: { current: [] },
    pendingLiveNonStyleRedoStackRef: { current: [] },
    pendingLiveNonStyleUndoStackRef: { current: [] },
    pendingLocalFileContentsRef: { current: new Map() },
    pendingStructureRedoReplayRef: { current: undefined },
    pendingStructureRedoReplayTimerRef: { current: undefined },
    pendingVisualStyleEditsRef: { current: [] },
    pendingVisualStyleRedoStackRef: { current: [] },
    pendingVisualStyleUndoStackRef: { current: [] },
    performDeleteFiles: vi.fn(),
    publishAuthoritativeClipboardMutation: vi.fn(),
    queryClient: { invalidateQueries: vi.fn(), setQueryData: vi.fn() },
    queueFileContentSave: vi.fn(),
    recordLocalContentHistoryChangeFallback: vi.fn(),
    redoOrderRef,
    replacePreviewContent: vi.fn(() => "applied"),
    requestPendingLiveNonStyleRevert: vi.fn(),
    requestPendingVisualStyleRevert: vi.fn(),
    restoreSelectionSnapshot,
    runtimeStructureInsertRevisionRef: { current: 0 },
    runtimeStructureMoveRevisionRef: { current: 0 },
    selectionRedoStackRef: { current: [] },
    selectionUndoStackRef: { current: [] },
    setActiveFileId: vi.fn(),
    setContentRenderRevision: vi.fn(),
    setHoveredElement: vi.fn(),
    setOverviewSelectedScreenIds: vi.fn(),
    setPendingLayerStateReplayRequest: vi.fn(),
    setPendingLiveNonStyleEdits: vi.fn(),
    setPendingTextRevertRequest: vi.fn(),
    setPendingVisualStyleEdits: vi.fn(),
    setPendingVisualStyleRevertRequest: vi.fn(),
    setRuntimeStructureInsertRequest: vi.fn(),
    setRuntimeStructureMoveRequest: vi.fn(),
    setSelectedElement: vi.fn(),
    setSelectedLayerIdsState,
    suppressContentHistoryRef: { current: false },
    syncLiveScreenSnapshotPreview: vi.fn(),
    syncUndoRedoState: vi.fn(),
    t: (key: string) => key,
    undoManagerRef: { current: null },
    updateLiveScreenSnapshotContent: vi.fn(),
    viewModeRef,
    writeFrameGeometrySnapshot: vi.fn(),
    ydoc: null,
  };
  return {
    args,
    applyFileContentUpdate,
    applyLocalContentUpdate,
    content,
    contentHistorySelectionAfterRef,
    contentRedoStackRef,
    contentUndoStackRef,
    historyOrderRef,
    localContentRedoStackRef,
    localContentUndoStackRef,
    redoOrderRef,
    setSelectedLayerIdsState,
    layerId,
    localBeforeA,
  };
}

describe("single-screen linked component history", () => {
  it("undoes and redoes the group around the earlier local fallback edit", () => {
    const state = commandArgs();
    const entry = state.contentUndoStackRef.current[0]!;
    state.contentHistorySelectionAfterRef.current.set(entry, {
      activeFileId: "file-a",
      overviewSelectedScreenIds: [],
      selectedLayerIds: [state.layerId],
      sourceContentByFileId: {
        "file-a":
          '<main><div data-agent-native-node-id="layer-a">after A</div></main>',
      },
      sourceFileIdByFileId: { "file-a": "file-a" },
    });

    runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);

    expect(state.applyLocalContentUpdate).toHaveBeenCalledWith(
      '<main><div data-agent-native-node-id="layer-a">before A</div></main>',
      expect.objectContaining({
        recordHistory: false,
        historyBeforeContent:
          '<main><div data-agent-native-node-id="layer-a">after A</div></main>',
      }),
    );
    expect(state.applyFileContentUpdate).toHaveBeenCalledWith(
      "file-b",
      "<main>before B</main>",
      expect.objectContaining({
        recordHistory: false,
        historyBeforeContent: "<main>after B</main>",
      }),
    );
    expect(state.setSelectedLayerIdsState).toHaveBeenLastCalledWith([
      state.layerId,
    ]);
    expect(state.content.get("file-a")).toBe(
      '<main><div data-agent-native-node-id="layer-a">before A</div></main>',
    );
    expect(state.content.get("file-b")).toBe("<main>before B</main>");
    expect(state.historyOrderRef.current).toEqual(["content"]);

    runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);
    expect(state.localContentUndoStackRef.current).toHaveLength(0);
    expect(state.applyLocalContentUpdate).toHaveBeenLastCalledWith(
      state.localBeforeA,
      expect.objectContaining({ recordHistory: false }),
    );
    expect(state.redoOrderRef.current).toEqual(["file-content", "content"]);

    runRedo(state.args as unknown as Parameters<typeof runRedo>[0]);
    expect(state.localContentRedoStackRef.current).toHaveLength(0);
    expect(state.applyLocalContentUpdate).toHaveBeenLastCalledWith(
      '<main><div data-agent-native-node-id="layer-a">before A</div></main>',
      expect.objectContaining({ recordHistory: false }),
    );

    runRedo(state.args as unknown as Parameters<typeof runRedo>[0]);
    expect(state.applyLocalContentUpdate).toHaveBeenLastCalledWith(
      '<main><div data-agent-native-node-id="layer-a">after A</div></main>',
      expect.objectContaining({
        recordHistory: false,
        historyBeforeContent:
          '<main><div data-agent-native-node-id="layer-a">before A</div></main>',
      }),
    );
    expect(state.applyFileContentUpdate).toHaveBeenLastCalledWith(
      "file-b",
      "<main>after B</main>",
      expect.objectContaining({
        recordHistory: false,
        historyBeforeContent: "<main>before B</main>",
      }),
    );
    expect(state.setSelectedLayerIdsState).toHaveBeenLastCalledWith([
      state.layerId,
    ]);
    expect(state.content.get("file-a")).toBe(
      '<main><div data-agent-native-node-id="layer-a">after A</div></main>',
    );
    expect(state.content.get("file-b")).toBe("<main>after B</main>");
  });

  it("uses current document content ahead of stale clipboard lineage for linked undo and redo", () => {
    const state = commandArgs();
    const beforeA =
      '<main><div data-agent-native-node-id="layer-a">before A</div></main>';
    const beforeB = "<main>before B</main>";
    const staleClipboardBase =
      '<main><div data-agent-native-node-id="layer-a">clipboard base</div></main>';

    state.args.clipboardPasteUndoStackRef.current = [
      { fileId: "file-b", before: "<main></main>", after: beforeB },
    ];
    state.args.latestClipboardMutationContentRef.current.set("file-b", {
      content: beforeB,
      contentHash: sourceContentHash(beforeB),
      mutationId: 1,
      origin: "clipboard-paste",
    });

    runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);

    expect(state.content.get("file-a")).toBe(beforeA);
    expect(state.content.get("file-b")).toBe(beforeB);
    expect(
      state.args.publishAuthoritativeClipboardMutation,
    ).not.toHaveBeenCalled();
    expect(state.args.clipboardPasteUndoStackRef.current).toHaveLength(1);

    state.args.clipboardPasteRedoStackRef.current = [
      {
        fileId: "file-b",
        before: staleClipboardBase,
        after: "<main>clipboard redo</main>",
      },
    ];
    state.args.latestClipboardMutationContentRef.current.set("file-b", {
      content: staleClipboardBase,
      contentHash: sourceContentHash(staleClipboardBase),
      mutationId: 2,
      origin: "clipboard-undo",
    });

    runRedo(state.args as unknown as Parameters<typeof runRedo>[0]);

    expect(state.content.get("file-a")).toBe(
      '<main><div data-agent-native-node-id="layer-a">after A</div></main>',
    );
    expect(state.content.get("file-b")).toBe("<main>after B</main>");
    expect(
      state.args.publishAuthoritativeClipboardMutation,
    ).not.toHaveBeenCalled();
    expect(state.args.clipboardPasteRedoStackRef.current).toHaveLength(1);
  });

  it("undoes and redoes the current paste from the document when its lineage is stale", () => {
    const state = commandArgs();
    const after = state.content.get("file-b")!;
    const before = "<main></main>";
    const lineage = state.args.latestClipboardMutationContentRef.current;
    lineage.set("file-b", {
      content: "<main>older unrelated content</main>",
      contentHash: sourceContentHash("<main>older unrelated content</main>"),
      mutationId: 7,
      origin: "clipboard-paste",
    });
    state.args.clipboardPasteUndoStackRef.current = [
      { fileId: "file-b", before, after },
    ];
    state.args.historyOrderRef.current = ["clipboard-paste"];
    state.args.publishAuthoritativeClipboardMutation.mockImplementation(
      (
        input: Parameters<
          Parameters<typeof runUndo>[0]["publishAuthoritativeClipboardMutation"]
        >[0],
      ) => {
        const publication = publishClipboardContentMutation({
          ...input,
          current: lineage.get(input.fileId),
          baseContentHash: sourceContentHash(input.baseContent),
        });
        if (publication) lineage.set(input.fileId, publication);
        return publication;
      },
    );
    const linkedEntry = state.contentUndoStackRef.current[0];

    runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);
    expect(state.content.get("file-b")).toBe(before);
    expect(state.args.clipboardPasteUndoStackRef.current).toHaveLength(0);
    expect(state.args.clipboardPasteRedoStackRef.current).toHaveLength(1);
    expect(state.contentUndoStackRef.current[0]).toBe(linkedEntry);
    expect(lineage.get("file-b")?.mutationId).toBe(8);

    runRedo(state.args as unknown as Parameters<typeof runRedo>[0]);
    expect(state.content.get("file-b")).toBe(after);
    expect(state.args.clipboardPasteUndoStackRef.current).toHaveLength(1);
    expect(state.args.clipboardPasteRedoStackRef.current).toHaveLength(0);
    expect(state.contentUndoStackRef.current[0]).toBe(linkedEntry);
    expect(lineage.get("file-b")?.mutationId).toBe(9);
  });

  it("keeps clipboard paste undo and redo in cross-screen chronology across view changes", () => {
    const state = commandArgs();
    const beforeA = "<main>before A</main>";
    const afterA = "<main>after A</main>";
    const beforeB = "<main>before B</main>";
    const afterB = "<main>pasted B</main>";

    state.content.set("file-a", afterA);
    state.content.set("file-b", afterB);
    state.args.viewModeRef.current = "overview";
    state.args.contentUndoStackRef.current = [
      contentHistoryEntryFromChanges([
        { fileId: "file-a", before: beforeA, after: afterA },
      ])!,
    ];
    state.args.contentUndoSelectionStackRef.current = [undefined];
    state.args.contentRedoStackRef.current = [];
    state.args.contentRedoSelectionStackRef.current = [];
    state.args.clipboardPasteUndoStackRef.current = [
      { fileId: "file-b", before: beforeB, after: afterB },
    ];
    state.args.clipboardPasteRedoStackRef.current = [];
    state.args.historyOrderRef.current = ["clipboard-paste", "file-content"];
    state.args.redoOrderRef.current = [];
    state.args.publishAuthoritativeClipboardMutation.mockImplementation(
      ({ nextContent, origin }) => ({
        mutationId: 1,
        contentHash: sourceContentHash(nextContent),
        origin,
      }),
    );

    runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);

    expect(state.content.get("file-a")).toBe(beforeA);
    expect(state.content.get("file-b")).toBe(afterB);
    expect(state.args.clipboardPasteUndoStackRef.current).toHaveLength(1);
    expect(state.historyOrderRef.current).toEqual(["clipboard-paste"]);
    expect(state.redoOrderRef.current).toEqual(["file-content"]);

    state.args.viewModeRef.current = "single";
    runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);

    expect(state.content.get("file-a")).toBe(beforeA);
    expect(state.content.get("file-b")).toBe(beforeB);
    expect(state.args.clipboardPasteUndoStackRef.current).toHaveLength(0);
    expect(state.args.clipboardPasteRedoStackRef.current).toHaveLength(1);
    expect(state.historyOrderRef.current).toEqual([]);
    expect(state.redoOrderRef.current).toEqual([
      "file-content",
      "clipboard-paste",
    ]);

    state.args.viewModeRef.current = "overview";
    runRedo(state.args as unknown as Parameters<typeof runRedo>[0]);

    expect(state.content.get("file-a")).toBe(beforeA);
    expect(state.content.get("file-b")).toBe(afterB);
    expect(state.historyOrderRef.current).toEqual(["clipboard-paste"]);
    expect(state.redoOrderRef.current).toEqual(["file-content"]);

    runRedo(state.args as unknown as Parameters<typeof runRedo>[0]);

    expect(state.content.get("file-a")).toBe(afterA);
    expect(state.content.get("file-b")).toBe(afterB);
    expect(state.historyOrderRef.current).toEqual([
      "clipboard-paste",
      "file-content",
    ]);
    expect(state.redoOrderRef.current).toEqual([]);
  });

  it.each(["refused", "deferred"] as const)(
    "keeps a %s clipboard undo at the top of history",
    (status) => {
      const state = commandArgs();
      const beforeB = "<main>before B</main>";
      const afterB = "<main>pasted B</main>";
      state.content.set("file-b", afterB);
      state.args.clipboardPasteUndoStackRef.current = [
        { fileId: "file-b", before: beforeB, after: afterB },
      ];
      state.args.historyOrderRef.current = ["file-content", "clipboard-paste"];
      state.args.viewModeRef.current = "overview";
      state.args.publishAuthoritativeClipboardMutation.mockImplementation(
        ({ nextContent, origin }) => ({
          mutationId: 1,
          contentHash: sourceContentHash(nextContent),
          origin,
        }),
      );
      state.applyFileContentUpdate.mockImplementation(
        () => ({ status }) as never,
      );

      runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);

      expect(state.content.get("file-a")).toBe(
        '<main><div data-agent-native-node-id="layer-a">after A</div></main>',
      );
      expect(state.content.get("file-b")).toBe(afterB);
      expect(state.args.contentUndoStackRef.current).toHaveLength(1);
      expect(state.applyFileContentUpdate).toHaveBeenCalledOnce();
      expect(
        state.args.publishAuthoritativeClipboardMutation,
      ).toHaveBeenCalledOnce();
      expect(state.args.clipboardPasteUndoStackRef.current).toEqual([
        { fileId: "file-b", before: beforeB, after: afterB },
      ]);
      expect(state.historyOrderRef.current).toEqual([
        "file-content",
        "clipboard-paste",
      ]);
      expect(state.redoOrderRef.current).toEqual([]);
    },
  );

  it.each(["refused", "deferred"] as const)(
    "keeps a %s clipboard redo at the top of history",
    (status) => {
      const state = commandArgs();
      const beforeB = "<main>before B</main>";
      const afterB = "<main>pasted B</main>";
      state.content.set("file-b", beforeB);
      state.args.clipboardPasteRedoStackRef.current = [
        { fileId: "file-b", before: beforeB, after: afterB },
      ];
      state.redoOrderRef.current = ["file-content", "clipboard-paste"];
      state.args.viewModeRef.current = "overview";
      state.args.publishAuthoritativeClipboardMutation.mockImplementation(
        ({ nextContent, origin }) => ({
          mutationId: 1,
          contentHash: sourceContentHash(nextContent),
          origin,
        }),
      );
      state.applyFileContentUpdate.mockImplementation(
        () => ({ status }) as never,
      );

      runRedo(state.args as unknown as Parameters<typeof runRedo>[0]);

      expect(state.content.get("file-a")).toBe(
        '<main><div data-agent-native-node-id="layer-a">after A</div></main>',
      );
      expect(state.content.get("file-b")).toBe(beforeB);
      expect(state.args.contentRedoStackRef.current).toHaveLength(0);
      expect(state.applyFileContentUpdate).toHaveBeenCalledOnce();
      expect(
        state.args.publishAuthoritativeClipboardMutation,
      ).toHaveBeenCalledOnce();
      expect(state.args.clipboardPasteRedoStackRef.current).toEqual([
        { fileId: "file-b", before: beforeB, after: afterB },
      ]);
      expect(state.redoOrderRef.current).toEqual([
        "file-content",
        "clipboard-paste",
      ]);
      expect(state.historyOrderRef.current).toEqual([
        "content",
        "file-content",
      ]);
    },
  );

  it.each(["undo", "redo"] as const)(
    "does not reserve a clipboard %s while the target source is shader-locked",
    (direction) => {
      const state = commandArgs();
      const beforeB = "<main>before B</main>";
      const afterB = "<main>pasted B</main>";
      state.args.viewModeRef.current = "overview";
      shaderWrites.add("file-b");
      try {
        if (direction === "undo") {
          state.content.set("file-b", afterB);
          state.args.clipboardPasteUndoStackRef.current = [
            { fileId: "file-b", before: beforeB, after: afterB },
          ];
          state.args.historyOrderRef.current = [
            "file-content",
            "clipboard-paste",
          ];
          runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);
          expect(state.args.clipboardPasteUndoStackRef.current).toHaveLength(1);
          expect(state.historyOrderRef.current).toEqual([
            "file-content",
            "clipboard-paste",
          ]);
        } else {
          state.content.set("file-b", beforeB);
          state.args.clipboardPasteRedoStackRef.current = [
            { fileId: "file-b", before: beforeB, after: afterB },
          ];
          state.redoOrderRef.current = ["file-content", "clipboard-paste"];
          runRedo(state.args as unknown as Parameters<typeof runRedo>[0]);
          expect(state.args.clipboardPasteRedoStackRef.current).toHaveLength(1);
          expect(state.redoOrderRef.current).toEqual([
            "file-content",
            "clipboard-paste",
          ]);
        }
        expect(
          state.args.publishAuthoritativeClipboardMutation,
        ).not.toHaveBeenCalled();
        expect(state.applyFileContentUpdate).not.toHaveBeenCalled();
      } finally {
        shaderWrites.delete("file-b");
      }
    },
  );

  it.each(["undo", "redo"] as const)(
    "keeps a global %s intact when one target is shader-locked",
    (direction) => {
      const state = commandArgs();
      const entry = state.contentUndoStackRef.current[0]!;
      const geometryEntry = {
        before: {},
        after: {},
      } satisfies GeometryHistoryEntry;
      state.args.viewModeRef.current = "overview";
      state.historyOrderRef.current = ["geometry", "file-content"];
      if (direction === "undo") {
        (
          state.args.geometryUndoStackRef as { current: GeometryHistoryEntry[] }
        ).current = [geometryEntry];
      } else {
        state.content.set(
          "file-a",
          '<main><div data-agent-native-node-id="layer-a">before A</div></main>',
        );
        state.content.set("file-b", "<main>before B</main>");
        state.contentUndoStackRef.current = [];
        state.args.contentUndoSelectionStackRef.current = [];
        state.contentRedoStackRef.current = [entry];
        state.args.contentRedoSelectionStackRef.current = [undefined];
        state.redoOrderRef.current = ["geometry", "file-content"];
        (
          state.args.geometryRedoStackRef as { current: GeometryHistoryEntry[] }
        ).current = [geometryEntry];
      }

      const sourceBefore = new Map(state.content);
      shaderWrites.add("file-b");
      try {
        if (direction === "undo") {
          runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);
          expect(state.contentUndoStackRef.current).toHaveLength(1);
          expect(state.contentRedoStackRef.current).toHaveLength(0);
          expect(state.historyOrderRef.current).toEqual([
            "geometry",
            "file-content",
          ]);
          expect(state.redoOrderRef.current).toEqual([]);
          expect(state.args.geometryUndoStackRef.current).toEqual([
            geometryEntry,
          ]);
        } else {
          runRedo(state.args as unknown as Parameters<typeof runRedo>[0]);
          expect(state.contentRedoStackRef.current).toHaveLength(1);
          expect(state.contentUndoStackRef.current).toHaveLength(0);
          expect(state.redoOrderRef.current).toEqual([
            "geometry",
            "file-content",
          ]);
          expect(state.historyOrderRef.current).toEqual([
            "geometry",
            "file-content",
          ]);
          expect(state.args.geometryRedoStackRef.current).toEqual([
            geometryEntry,
          ]);
        }

        expect(state.content).toEqual(sourceBefore);
        expect(state.applyLocalContentUpdate).not.toHaveBeenCalled();
        expect(state.applyFileContentUpdate).not.toHaveBeenCalled();
        expect(state.args.writeFrameGeometrySnapshot).not.toHaveBeenCalled();
      } finally {
        shaderWrites.delete("file-b");
      }
    },
  );

  it("keeps global undo intact when a historical source fails integrity preflight", () => {
    const state = commandArgs();
    const beforeA =
      '<main><div data-agent-native-node-id="layer-a">before A</div></main>';
    const afterA =
      '<main><div data-agent-native-node-id="layer-a">after A</div></main>';
    const beforeB =
      '<!doctype html><html><head></head><body><button data-agent-native-node-id="moving" x-data="{ open: true }" x-show="open">Move me</button></body></html>';
    const afterB =
      '<!doctype html><html><head></head><body><button data-agent-native-node-id="moving">Move me</button></body></html>';
    const entry = contentHistoryEntryFromChanges(
      [
        { fileId: "file-a", before: beforeA, after: afterA },
        { fileId: "file-b", before: beforeB, after: afterB },
      ],
      true,
    )!;
    state.content.set("file-a", afterA);
    state.content.set("file-b", afterB);
    state.contentUndoStackRef.current = [entry];
    state.args.contentUndoSelectionStackRef.current = [undefined];
    state.args.viewModeRef.current = "overview";
    state.historyOrderRef.current = ["geometry", "file-content"];
    const geometryEntry = { before: {}, after: {} };
    (
      state.args.geometryUndoStackRef as { current: GeometryHistoryEntry[] }
    ).current = [geometryEntry];
    const sourceBefore = new Map(state.content);

    runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);

    expect(state.content).toEqual(sourceBefore);
    expect(state.applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(state.applyFileContentUpdate).not.toHaveBeenCalled();
    expect(state.contentUndoStackRef.current).toEqual([entry]);
    expect(state.contentRedoStackRef.current).toEqual([]);
    expect(state.historyOrderRef.current).toEqual(["geometry", "file-content"]);
    expect(state.args.geometryUndoStackRef.current).toEqual([geometryEntry]);
    expect(state.args.writeFrameGeometrySnapshot).not.toHaveBeenCalled();
  });

  it("does not replay an unmarked global content entry", () => {
    const state = commandArgs();
    state.contentUndoStackRef.current[0] = {
      changes: [
        {
          fileId: "file-a",
          before: "<main>unrelated before</main>",
          after: "<main>unrelated after</main>",
        },
        {
          fileId: "file-b",
          before: "<main>unrelated before B</main>",
          after: "<main>unrelated after B</main>",
        },
      ],
    };
    state.historyOrderRef.current = ["file-content"];

    runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);

    expect(state.applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(state.applyFileContentUpdate).not.toHaveBeenCalled();
    expect(state.contentUndoStackRef.current).toHaveLength(1);
    expect(state.historyOrderRef.current).toEqual(["file-content"]);
  });
});

const editorSource = readFileSync(
  new URL("../../DesignEditor.tsx", import.meta.url),
  "utf8",
);
function editorCallback(pattern: RegExp, bindings: Record<string, unknown>) {
  const source = editorSource.match(pattern)?.[1];
  if (!source) throw new Error("Editor history callback not found");
  return new Function(...Object.keys(bindings), `return (${source})`)(
    ...Object.values(bindings),
  );
}

it("clears clipboard redo when a new content edit branches history", () => {
  const state = commandArgs();
  state.args.clipboardPasteRedoStackRef.current = [
    {
      fileId: "file-b",
      before: "<main>before B</main>",
      after: "<main>pasted B</main>",
    },
  ];
  state.redoOrderRef.current = ["clipboard-paste"];

  const clearRedoStacks = editorCallback(
    /const clearRedoStacks = useCallback\((\(\) => \{[\s\S]*?\n  \}), \[\]\);/,
    state.args,
  );
  clearRedoStacks();

  expect(state.args.clipboardPasteRedoStackRef.current).toEqual([]);
  expect(state.redoOrderRef.current).toEqual([]);
});

it.each(["rejected", "no-op", "committed", "intervening edit"])(
  "preserves existing Redo until confirmed nonempty commit: %s",
  async (outcome) => {
    const state = commandArgs();
    const original = new Map(state.content);
    runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);
    expect(state.redoOrderRef.current).toEqual(["file-content"]);
    expect(state.contentRedoStackRef.current).toHaveLength(1);
    const clearRedoStacks = editorCallback(
      /const clearRedoStacks = useCallback\((\(\) => \{[\s\S]*?\n  \}), \[\]\);/,
      state.args,
    );
    const reserveContentHistory = editorCallback(
      /reserveContentHistory: (\([^)]*\) => \{[\s\S]*?\n        \}),\n        waitForHostWrites:/,
      {
        ...state.args,
        reserveLinkedComponentContentHistory,
        captureCurrentSelection: () => ({
          activeFileId: "file-a",
          overviewSelectedScreenIds: [],
          selectedLayerIds: [state.layerId],
          sourceContentByFileId: Object.fromEntries(state.content),
          sourceFileIdByFileId: { "file-a": "file-a", "file-b": "file-b" },
        }),
        clearRedoStacks,
      },
    );
    let resolve!: (result: LinkedComponentActionResult) => void;
    const response = new Promise<LinkedComponentActionResult>((done) => {
      resolve = done;
    });
    const queue = createLinkedComponentMutationQueue({
      designId: "design-1",
      fileIds: () => [...state.content.keys()],
      getContent: (id) => state.content.get(id)!,
      getSourceBaseContent: (id) => state.content.get(id)!,
      canonicalizeSourceContent: (_id, content) => content,
      flushPendingSaves: vi.fn(),
      hasPendingSave: () => false,
      getPendingSave: () => undefined,
      fileSaveChainsRef: { current: {} },
      pendingFileSavesRef: { current: {} },
      invokeAction: () => response,
      applyFileContentUpdate: (id, content) => {
        state.content.set(id, content);
        return {
          status: "accepted",
          content,
          nodeIdMap: new Map(),
        } as ReturnType<
          LinkedComponentMutationQueueArgs["applyFileContentUpdate"]
        >;
      },
      getCurrentSelection: () => ({
        activeFileId: "file-a",
        selectedLayerIds: ["layer-a"],
        overviewSelectedScreenIds: [],
      }),
      reserveContentHistory,
      waitForHostWrites: async () => {},
      syncUndoRedoState: vi.fn(),
      refreshAfterConflict: vi.fn(),
      reportFailure: vi.fn(),
    });
    const mutation = queue.enqueue("file-a", "layer-a", {
      kind: "textContent",
      value: "new",
    });
    expect(state.redoOrderRef.current).toEqual(["file-content"]);
    if (outcome === "intervening edit") clearRedoStacks();
    const committed = outcome === "committed";
    const before = state.content.get("file-a")!;
    const after = before.replace("before A", "new A");
    resolve(
      outcome === "rejected"
        ? { conflict: true, error: "Rejected" }
        : {
            persisted: committed,
            changes: committed
              ? [
                  {
                    fileId: "file-a",
                    before,
                    after,
                    beforeVersionHash: sourceContentHash(before),
                    afterVersionHash: sourceContentHash(after),
                    updatedAt: "saved",
                  },
                ]
              : [],
            sourceBases: [...state.content].map(([fileId, content]) => ({
              fileId,
              versionHash: sourceContentHash(
                committed && fileId === "file-a" ? after : content,
              ),
              updatedAt: "saved",
            })),
          },
    );
    const [settled] = await Promise.allSettled([mutation]);
    expect(settled.status).toBe(
      outcome === "rejected" ? "rejected" : "fulfilled",
    );
    if (committed || outcome === "intervening edit") {
      expect(state.redoOrderRef.current).toEqual([]);
      expect(state.contentRedoStackRef.current).toEqual([]);
    } else {
      expect(state.redoOrderRef.current).toEqual(["file-content"]);
      expect(state.contentRedoStackRef.current).toHaveLength(1);
      runRedo(state.args as unknown as Parameters<typeof runRedo>[0]);
      expect(state.content).toEqual(original);
    }
  },
);

describe("pending live multi-target style gestures", () => {
  it("does not queue a style edit for a boxless layer", () => {
    const setPatchProof = vi.fn();
    const setPendingVisualStyleEdits = vi.fn();
    const onNoRenderedBox = vi.fn();

    runRecordPendingVisualStyleEdit(
      {
        activeBreakpointUpperBoundPx: null,
        activeBreakpointWidthState: undefined,
        activeFile: { id: "file-a" } as any,
        canEditDesign: true,
        files: [{ id: "file-a", filename: "index.html" }] as any,
        overviewScreens: [],
        pendingVisualStyleEditsRef: { current: [] },
        pendingVisualStyleRedoStackRef: { current: [] },
        pendingVisualStyleUndoStackRef: { current: [] },
        runtimeLayerSnapshotsById: {},
        selectedElement: null,
        onNoRenderedBox,
        setPatchProof,
        setPendingVisualStyleEdits,
      } as any,
      "file-a",
      "#provider",
      { borderRadius: "12px" },
      { boundingRect: { width: 0, height: 0 } } as any,
    );

    expect(onNoRenderedBox).toHaveBeenCalledOnce();
    expect(setPatchProof).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: "designEditor.patchProof.noRenderedBox",
      }),
    );
    expect(setPendingVisualStyleEdits).not.toHaveBeenCalled();
  });

  it("records scrub ticks as one target group and replays the group through Undo and Redo", () => {
    const state = commandArgs();
    const source = `<main><section data-agent-native-node-id="main-root" data-agent-native-component="Card" ${COMPONENT_ID_ATTR}="card"><div data-agent-native-node-id="main-child" style="color: red">Main</div></section><section data-agent-native-node-id="copy-root" ${COMPONENT_REF_ATTR}="card"><div data-agent-native-node-id="copy-child" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-child" style="color: orange">Copy</div></section></main>`;
    state.content.set("file-a", source);
    const originalSourceContent = state.content.get("file-a");
    const targets = liveStyleTargets(source);
    const selectedElement = targets[0]!.elementInfo;
    let selectedElementState: ElementInfo | null = selectedElement;
    const setSelectedElement = vi.fn((next: unknown) => {
      selectedElementState =
        typeof next === "function"
          ? (next as (previous: ElementInfo | null) => ElementInfo | null)(
              selectedElementState,
            )
          : (next as ElementInfo | null);
    });
    (state.args as any).setSelectedElement = setSelectedElement;
    (state.args as any).activeFile.id = "file-a";

    const recordingArgs = {
      activeBreakpointUpperBoundPx: null,
      activeBreakpointWidthState: undefined,
      activeFile: state.args.activeFile,
      canEditDesign: true,
      cancelPendingStructureVerification: vi.fn(),
      clipboardPasteRedoStackRef: state.args.clipboardPasteRedoStackRef,
      files: state.args.files,
      getProjectionContentForScreen: () => source,
      localhostConnectionRootPathByIdRef: {
        current: new Map([["connection-a", "/project"]]),
      },
      overviewScreens: [{ id: "file-a", connectionId: "connection-a" }],
      pendingLiveNonStyleRedoStackRef:
        state.args.pendingLiveNonStyleRedoStackRef,
      pendingStructureRedoReplayRef: state.args.pendingStructureRedoReplayRef,
      pendingStructureRedoReplayTimerRef:
        state.args.pendingStructureRedoReplayTimerRef,
      pendingVisualStyleEditsRef: state.args.pendingVisualStyleEditsRef,
      pendingVisualStyleRedoStackRef: state.args.pendingVisualStyleRedoStackRef,
      pendingVisualStyleUndoStackRef: state.args.pendingVisualStyleUndoStackRef,
      recordPendingHistoryEntry: (kind: string) =>
        state.args.historyOrderRef.current.push(kind),
      responsiveEditScopeRef: { current: "cascade-smaller" as const },
      runtimeLayerSnapshotsById: {},
      selectedElement,
      setPatchProof: vi.fn(),
      setPendingVisualStyleEdits: vi.fn(),
      setSelectedElement,
      setSelectedLayerIdsState: state.setSelectedLayerIdsState,
    } as any;
    const liveGestureState = { sequence: 0, activeId: null as string | null };
    const commitVisualStyles = vi.fn(
      (
        selector: string,
        styles: Record<string, string>,
        options?: {
          elementInfo?: ElementInfo;
          pendingUndoGestureId?: string;
          preserveSelection?: boolean;
          originalStyles?: Record<string, string>;
        },
      ) =>
        runRecordPendingVisualStyleEdit(
          recordingArgs,
          "file-a",
          selector,
          styles,
          options?.elementInfo,
          {
            originalStyles: options?.originalStyles,
            pendingUndoGestureId: options?.pendingUndoGestureId,
            preserveSelection: options?.preserveSelection,
          },
        ),
    );
    const applyFileContentUpdate = vi.fn();
    const applyLinkedComponentEdit = vi.fn();
    const commitArgs = {
      activeCanvasSourceType: "localhost",
      activeBreakpointUpperBoundPx: null,
      activeBreakpointWidthStateRef: { current: undefined },
      activeContent: source,
      activeFile: state.args.activeFile,
      applyFileContentUpdate,
      applyLinkedComponentEdit,
      commitVisualStyles,
      canEditDesign: true,
      effectiveCodeLayerStateRef: {
        current: { lockedIds: new Set(), hiddenIds: new Set() },
      },
      getScreenContent: (fileId: string) => state.content.get(fileId) ?? "",
      getProjectionContentForScreen: () => source,
      lastLocalContentRef: { current: null },
      latestActiveContentRef: { current: null },
      responsiveEditScopeRef: { current: "cascade-smaller" as const },
      selectedLayerTargetsRef: { current: targets },
      selectedLayerIdsStateRef: {
        current: targets.map((target) => target.layerId),
      },
      reportLinkedEditUnavailable: vi.fn(),
      setSelectedElement,
    } as any;
    const commitTargets = (
      styles: Record<string, string>,
      phase?: "preview" | "commit" | "cancel",
    ) =>
      runCommitStylesToSelectedLayers(
        commitArgs,
        styles,
        undefined,
        undefined,
        pendingVisualStyleGestureIdForPhase(liveGestureState, phase, true),
      );
    const styleChangeArgs = {
      commitInteractionStateStyles: vi.fn(() => false),
      commitRelativeStyleDeltaToSelectedLayers: vi.fn(() => false),
      commitStylesToSelectedLayers: commitTargets,
      commitCapturedStyleTargets: vi.fn(),
      commitVisualStyles: vi.fn(),
      handleClearBreakpointOverride: vi.fn(() => false),
      previewInteractionStateStyles: vi.fn(),
      selectedCanvasSelectorCandidates: [selectedElement.selector ?? ""],
      selectedElement,
      selectedLayerTargetsRef: { current: targets },
      textEditingState: { active: false, hasRange: false },
    } as any;
    const phaseProbeState = { sequence: 0, activeId: null as string | null };
    const phaseProbe: Array<{
      phase: "preview" | "commit" | "cancel" | undefined;
      id: string | undefined;
    }> = [];
    const phaseProbeArgs = {
      ...styleChangeArgs,
      commitStylesToSelectedLayers: (
        _styles: Record<string, string>,
        phase?: "preview" | "commit" | "cancel",
      ) => {
        phaseProbe.push({
          phase,
          id: pendingVisualStyleGestureIdForPhase(phaseProbeState, phase, true),
        });
        return true;
      },
    };
    runStyleChange(phaseProbeArgs, "color", "blue", { phase: "preview" });
    runStyleChange(phaseProbeArgs, "color", "purple", { phase: "preview" });
    runStyleChange(phaseProbeArgs, "color", "red", { phase: "cancel" });
    runStyleChange(phaseProbeArgs, "color", "green", { phase: "commit" });
    runStyleChange(phaseProbeArgs, "color", "orange");
    runStyleChange(phaseProbeArgs, "color", "black");
    expect(phaseProbe[0]?.id).toBe(phaseProbe[1]?.id);
    expect(phaseProbe[2]).toEqual({ phase: "cancel", id: undefined });
    expect(phaseProbe[3]?.id).not.toBe(phaseProbe[0]?.id);
    expect(phaseProbe[4]?.id).not.toBe(phaseProbe[5]?.id);

    runStyleChange(styleChangeArgs, "color", "blue", { phase: "preview" });
    runStyleChange(styleChangeArgs, "color", "purple", { phase: "preview" });
    runStyleChange(styleChangeArgs, "color", "purple", { phase: "commit" });
    const pendingStyleUndoStack = () =>
      state.args.pendingVisualStyleUndoStackRef
        .current as PendingVisualStyleUndoEntry[];
    const firstGesture = pendingStyleUndoStack()[0]!;
    expect(pendingStyleUndoStack()).toHaveLength(1);
    expect(firstGesture.groupedTargets).toHaveLength(1);
    expect(firstGesture.edit.styles).toEqual({ color: "purple" });
    expect(firstGesture.revertStyles).toEqual({ color: "red" });
    expect(firstGesture.groupedTargets?.[0]).toMatchObject({
      edit: {
        styles: { color: "purple" },
        runtimeSelector: "#runtime-copy-child",
        runtimeSourceId: "runtime-copy-child",
        sourceAnchor: { sourceFile: "/project/src/App.tsx", line: 18 },
      },
      revertStyles: { color: "orange" },
    });
    expect(state.setSelectedLayerIdsState).not.toHaveBeenCalled();
    expect(selectedElementState?.sourceId).toBe("main-child");

    runStylesChange(styleChangeArgs, { color: "green" }, { phase: "preview" });
    runStylesChange(styleChangeArgs, { color: "green" }, { phase: "commit" });
    expect(pendingStyleUndoStack()).toHaveLength(2);
    expect(pendingStyleUndoStack()[0]?.gestureId).not.toBe(
      pendingStyleUndoStack()[1]?.gestureId,
    );
    expect(applyLinkedComponentEdit).not.toHaveBeenCalled();
    expect(applyFileContentUpdate).not.toHaveBeenCalled();
    expect(state.content.get("file-a")).toBe(originalSourceContent);

    runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);
    expect(state.args.requestPendingVisualStyleRevert).toHaveBeenCalledOnce();
    expect(state.args.requestPendingVisualStyleRevert).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          sourceId: "main-child",
          runtimeSourceId: "runtime-main-child",
          runtimeSelector: "#runtime-main-child",
          originalStyles: { color: "purple" },
        }),
        expect.objectContaining({
          sourceId: "copy-child",
          runtimeSourceId: "runtime-copy-child",
          runtimeSelector: "#runtime-copy-child",
          originalStyles: { color: "purple" },
        }),
      ],
    );
    expect(pendingStyleUndoStack()).toHaveLength(1);

    runRedo(state.args as unknown as Parameters<typeof runRedo>[0]);
    const redoRequest = (
      state.args.setPendingVisualStyleRevertRequest as any
    ).mock.calls.at(-1)?.[0];
    expect(redoRequest.patches).toHaveLength(2);
    expect(redoRequest.patches.map((patch: any) => patch.styles)).toEqual([
      { color: "green" },
      { color: "green" },
    ]);
    expect(
      redoRequest.patches.map((patch: any) => patch.runtimeSourceId),
    ).toEqual(["runtime-main-child", "runtime-copy-child"]);
    expect(pendingStyleUndoStack()).toHaveLength(2);

    runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);
    runUndo(state.args as unknown as Parameters<typeof runUndo>[0]);
    expect(state.args.requestPendingVisualStyleRevert).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          sourceId: "main-child",
          originalStyles: { color: "red" },
        }),
        expect.objectContaining({
          sourceId: "copy-child",
          originalStyles: { color: "orange" },
        }),
      ],
    );
    runRedo(state.args as unknown as Parameters<typeof runRedo>[0]);
    expect(
      (state.args.setPendingVisualStyleRevertRequest as any).mock.calls.at(
        -1,
      )?.[0].patches,
    ).toHaveLength(2);
    expect(state.content.get("file-a")).toBe(originalSourceContent);
  });
});
