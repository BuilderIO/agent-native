// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import { readYjsUndoSelection } from "@/pages/design-editor/history";

import { runDeleteSelection } from "./delete-selection";

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
    const applyLocalContentUpdate = vi.fn();

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
});
