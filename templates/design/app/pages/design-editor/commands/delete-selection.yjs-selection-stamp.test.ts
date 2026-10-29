// @vitest-environment happy-dom
import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import type { SelectedCanvasLayerSnapshot } from "@/pages/design-editor/command-types";
import { readYjsUndoSelection } from "@/pages/design-editor/history";

import { runDeleteSelection } from "./delete-selection";

function acceptedContentUpdate() {
  return {
    status: "accepted" as const,
    content: "",
    nodeIdMap: new Map<string, string>(),
  };
}

function baseDeleteArgs(overrides: {
  undoManagerRef: { current: { stopCapturing: () => void; undoStack: any[] } };
  applyLocalContentUpdate: ReturnType<typeof vi.fn>;
  setSelectedElement?: ReturnType<typeof vi.fn>;
  setSelectedLayerIdsState?: ReturnType<typeof vi.fn>;
}) {
  const selectedElement = {
    selector: "#box-a",
    sourceId: "box-a",
  } as unknown as ElementInfo;
  return {
    selectedElement,
    args: {
      t: (key: string) => key,
      activeBreakpointUpperBoundPx: null,
      activeBreakpointWidthStateRef: { current: undefined },
      activeCanvasSourceType: "inline",
      activeFile: { id: "file-1" },
      applyFileContentUpdate: vi.fn(),
      applyLocalContentUpdate: overrides.applyLocalContentUpdate,
      canEditDesign: true,
      codeLayerOwnerByNodeIdRef: { current: new Map() },
      deleteRuntimeElement: vi.fn(() => true),
      files: [{ id: "file-1" }],
      getFreshActiveContent: () =>
        `<!doctype html><html><body><div id="box-a"></div></body></html>`,
      getScreenContent: () => "",
      getSelectedLayerSnapshots: () => [],
      liveScreenSnapshotsById: {},
      previousMotionFileIdRef: { current: null },
      pruneMotionTracksByNodeId: vi.fn(),
      recordPendingLiveStructureEdit: vi.fn(),
      responsiveEditScopeRef: { current: "all" },
      selectedElement,
      selectedLayerIdsState: ["box-a"],
      setOverviewSelectedScreenIds: vi.fn(),
      setSelectedElement: overrides.setSelectedElement ?? vi.fn(),
      setSelectedLayerIdsState: overrides.setSelectedLayerIdsState ?? vi.fn(),
      syncLiveScreenSnapshotPreview: vi.fn(),
      undoManagerRef: overrides.undoManagerRef,
      updateLiveScreenSnapshotContent: vi.fn(),
      viewModeRef: { current: "single" },
    } as unknown as Parameters<typeof runDeleteSelection>[0],
  };
}

describe("runDeleteSelection — stamps the pre-delete selection for undo", () => {
  it("stamps selectedElement + selectedLayerIds onto a NEW undo-stack item before clearing selection", () => {
    const priorItem = { meta: new Map<unknown, unknown>() };
    const undoManagerRef = {
      current: { stopCapturing: vi.fn(), undoStack: [priorItem] },
    };
    const applyLocalContentUpdate = vi.fn(() => {
      undoManagerRef.current.undoStack.push({ meta: new Map() });
      return acceptedContentUpdate();
    });
    const setSelectedElement = vi.fn();
    const setSelectedLayerIdsState = vi.fn();

    const { selectedElement, args } = baseDeleteArgs({
      undoManagerRef,
      applyLocalContentUpdate,
      setSelectedElement,
      setSelectedLayerIdsState,
    });

    runDeleteSelection(args);

    const newItem = undoManagerRef.current.undoStack[1]!;
    expect(readYjsUndoSelection(newItem)).toEqual({
      selectedElement,
      selectedLayerIds: ["box-a"],
    });
    expect(readYjsUndoSelection(priorItem)).toBeUndefined();
    expect(setSelectedElement).toHaveBeenCalledWith(null);
    expect(setSelectedLayerIdsState).toHaveBeenCalledWith([]);
  });

  it("does not stamp (or touch the existing stamp) when the write pushes no new stack item", () => {
    const priorItem = { meta: new Map<unknown, unknown>() };
    priorItem.meta.set("design-editor-selection-before", "earlier-gesture");
    const undoManagerRef = {
      current: { stopCapturing: vi.fn(), undoStack: [priorItem] },
    };
    const applyLocalContentUpdate = vi.fn(() => acceptedContentUpdate());

    const { args } = baseDeleteArgs({
      undoManagerRef,
      applyLocalContentUpdate,
    });

    runDeleteSelection(args);

    expect(undoManagerRef.current.undoStack).toHaveLength(1);
    expect(readYjsUndoSelection(priorItem)).toBe("earlier-gesture");
  });

  it("also stamps the pre-delete selection for a repeat-row delete", () => {
    const TODOS = `<body x-data="app()">
      <ul>
        <template x-for="t in todos" :key="t.text">
          <li><span x-text="t.text"></span></li>
        </template>
      </ul>
      <script>
        function app() {
          return { todos: [{text:'Walk dog'},{text:'Buy milk'}] };
        }
      </script>
    </body>`;
    const priorItem = { meta: new Map<unknown, unknown>() };
    const undoManagerRef = {
      current: { stopCapturing: vi.fn(), undoStack: [priorItem] },
    };
    const applyLocalContentUpdate = vi.fn(() => {
      undoManagerRef.current.undoStack.push({ meta: new Map() });
      return acceptedContentUpdate();
    });
    const { selectedElement, args } = baseDeleteArgs({
      undoManagerRef,
      applyLocalContentUpdate,
    });
    const repeatSelectedElement = {
      ...selectedElement,
      repeat: { xFor: "t in todos", itemIndex: 0 },
    } as unknown as ElementInfo;

    runDeleteSelection({
      ...args,
      getFreshActiveContent: () => TODOS,
      selectedElement: repeatSelectedElement,
    });

    const newItem = undoManagerRef.current.undoStack[1]!;
    expect(readYjsUndoSelection(newItem)).toEqual({
      selectedElement: repeatSelectedElement,
      selectedLayerIds: ["box-a"],
    });
  });

  it("notifies pending media pastes after a structural selection delete", () => {
    const undoManagerRef = {
      current: { stopCapturing: vi.fn(), undoStack: [] },
    };
    const applyLocalContentUpdate = vi.fn(() => acceptedContentUpdate());
    const { args } = baseDeleteArgs({
      undoManagerRef,
      applyLocalContentUpdate,
    });
    const onPendingPastedMediaDelete = vi.fn();
    args.onPendingPastedMediaDelete = onPendingPastedMediaDelete;

    runDeleteSelection(args);

    expect(onPendingPastedMediaDelete).toHaveBeenCalledWith("file-1", "box-a");
  });

  it("does not cancel pending media when a structural delete is refused", () => {
    const undoManagerRef = {
      current: { stopCapturing: vi.fn(), undoStack: [] },
    };
    const applyLocalContentUpdate = vi.fn(() => ({
      status: "refused" as const,
    }));
    const { args } = baseDeleteArgs({
      undoManagerRef,
      applyLocalContentUpdate,
    });
    const onPendingPastedMediaDelete = vi.fn();
    args.onPendingPastedMediaDelete = onPendingPastedMediaDelete;

    runDeleteSelection(args);

    expect(applyLocalContentUpdate).toHaveBeenCalledOnce();
    expect(onPendingPastedMediaDelete).not.toHaveBeenCalled();
  });

  it("does not alter live state when a single-element delete is refused", () => {
    const undoManagerRef = {
      current: { stopCapturing: vi.fn(), undoStack: [] },
    };
    const applyLocalContentUpdate = vi.fn(() => ({
      status: "refused" as const,
    }));
    const { args } = baseDeleteArgs({
      undoManagerRef,
      applyLocalContentUpdate,
    });
    const deleteRuntimeElement = vi.fn(() => true);
    const pruneMotionTracksByNodeId = vi.fn();
    args.getFreshActiveContent = () =>
      `<!doctype html><html><body><div id="box-a" data-agent-native-node-id="box-a"></div></body></html>`;
    args.deleteRuntimeElement = deleteRuntimeElement;
    args.previousMotionFileIdRef = { current: "file-1" };
    args.pruneMotionTracksByNodeId = pruneMotionTracksByNodeId;

    runDeleteSelection(args);

    expect(applyLocalContentUpdate).toHaveBeenCalledOnce();
    expect(pruneMotionTracksByNodeId).not.toHaveBeenCalled();
    expect(deleteRuntimeElement).not.toHaveBeenCalled();
    expect(args.setSelectedElement).not.toHaveBeenCalled();
    expect(args.setSelectedLayerIdsState).not.toHaveBeenCalled();
  });

  it("keeps refused layers selected when a multi-screen delete partially succeeds", () => {
    const undoManagerRef = {
      current: { stopCapturing: vi.fn(), undoStack: [] },
    };
    const applyLocalContentUpdate = vi.fn(() => acceptedContentUpdate());
    const { args } = baseDeleteArgs({
      undoManagerRef,
      applyLocalContentUpdate,
    });
    const contents = new Map([
      [
        "file-1",
        '<!doctype html><html><body><div id="box-a" data-agent-native-node-id="box-a"></div></body></html>',
      ],
      [
        "file-2",
        '<!doctype html><html><body><div id="box-b" data-agent-native-node-id="box-b"></div></body></html>',
      ],
    ]);
    const snapshots = Array.from(contents, ([fileId, content]) => {
      const projection = buildCodeLayerProjection(content, {
        source: { kind: "design-file", fileId },
      });
      const node = projection.nodes.find(
        (candidate) =>
          candidate.dataAttributes["data-agent-native-node-id"] ===
          (fileId === "file-1" ? "box-a" : "box-b"),
      );
      if (!node?.source) throw new Error("selection fixture node is missing");
      const rootNodeId = node.dataAttributes["data-agent-native-node-id"];
      if (!rootNodeId) throw new Error("selection fixture node has no id");
      return {
        html: content.slice(node.source.start, node.source.end),
        rootNodeId,
        sourceFileId: fileId,
        node,
        sourceIndex: node.source.start,
        tree: buildCodeLayerTree(projection),
      } satisfies SelectedCanvasLayerSnapshot;
    });
    const setSelectedElement = vi.fn();
    const setSelectedLayerIdsState = vi.fn();
    const activeContent = contents.get("file-1");
    if (!activeContent) throw new Error("active selection fixture is missing");
    const refusedSnapshot = snapshots.find(
      (snapshot) => snapshot.sourceFileId === "file-2",
    );
    if (!refusedSnapshot)
      throw new Error("refused selection fixture is missing");
    args.activeFile = { id: "file-1" } as never;
    args.files = [{ id: "file-1" }, { id: "file-2" }] as never;
    args.getFreshActiveContent = () => activeContent;
    args.getScreenContent = (fileId) => contents.get(fileId) ?? "";
    args.getSelectedLayerSnapshots = () => snapshots;
    args.applyFileContentUpdate = vi.fn((fileId: string) =>
      fileId === "file-1"
        ? acceptedContentUpdate()
        : { status: "refused" as const },
    );
    args.selectedLayerIdsState = ["box-a", "box-b"];
    args.setSelectedElement = setSelectedElement;
    args.setSelectedLayerIdsState = setSelectedLayerIdsState;
    args.viewModeRef = { current: "overview" } as never;

    runDeleteSelection(args);

    expect(args.applyFileContentUpdate).toHaveBeenCalledTimes(2);
    expect(setSelectedElement).toHaveBeenCalledWith(null);
    expect(setSelectedLayerIdsState).toHaveBeenCalledWith([
      refusedSnapshot.node.id,
    ]);
    expect(args.setOverviewSelectedScreenIds).not.toHaveBeenCalled();
  });

  it.each([
    { status: "accepted", shouldCancel: true },
    { status: "refused", shouldCancel: false },
  ] as const)(
    "applies multi-layer delete side effects only after publication is $status",
    ({ status, shouldCancel }) => {
      const undoManagerRef = {
        current: { stopCapturing: vi.fn(), undoStack: [] },
      };
      const applyLocalContentUpdate = vi.fn(() => acceptedContentUpdate());
      const { args } = baseDeleteArgs({
        undoManagerRef,
        applyLocalContentUpdate,
      });
      const content = `<!doctype html><html><body>
      <div id="box-a" data-agent-native-node-id="box-a" data-agent-native-layer-name="Box">Box</div>
    </body></html>`;
      const source = {
        kind: "design-file" as const,
        fileId: "file-1",
        filename: "index.html",
      };
      const projection = buildCodeLayerProjection(content, { source });
      const node = projection.nodes.find(
        (candidate) =>
          candidate.dataAttributes["data-agent-native-node-id"] === "box-a",
      );
      expect(node?.source).toBeTruthy();
      if (!node?.source) return;
      const snapshot: SelectedCanvasLayerSnapshot = {
        html: content.slice(node.source.start, node.source.end),
        rootNodeId: "box-a",
        sourceFileId: "file-1",
        node,
        sourceIndex: 0,
        tree: buildCodeLayerTree(projection),
      };
      args.getSelectedLayerSnapshots = () => [snapshot];
      args.getScreenContent = () => content;
      args.previousMotionFileIdRef = { current: "file-1" };
      args.applyFileContentUpdate = vi.fn(() =>
        status === "accepted" ? acceptedContentUpdate() : { status },
      );
      const onPendingPastedMediaDelete = vi.fn();
      args.onPendingPastedMediaDelete = onPendingPastedMediaDelete;

      runDeleteSelection(args);

      expect(args.applyFileContentUpdate).toHaveBeenCalledOnce();
      if (shouldCancel) {
        expect(onPendingPastedMediaDelete).toHaveBeenCalledWith(
          "file-1",
          "box-a",
        );
      } else {
        expect(onPendingPastedMediaDelete).not.toHaveBeenCalled();
        expect(args.pruneMotionTracksByNodeId).not.toHaveBeenCalled();
        expect(args.deleteRuntimeElement).not.toHaveBeenCalled();
        expect(args.setSelectedElement).not.toHaveBeenCalled();
        expect(args.setSelectedLayerIdsState).not.toHaveBeenCalled();
      }
    },
  );
});
