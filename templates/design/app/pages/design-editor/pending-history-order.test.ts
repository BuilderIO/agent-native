import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { runRecordPendingLiveTextEdit } from "./commands/record-pending-live-text-edit";
import { runRedo } from "./commands/redo";
import { runUndo } from "./commands/undo";
import {
  formatPendingVisualStylePrompt,
  formatVisualEditClipboardPrompt,
} from "./pending-edits";

const ref = <T>(current: T) => ({ current });

describe("pending live history order", () => {
  it("records range-formatted text and relative intent for the coding-agent handoff", () => {
    const pendingLiveNonStyleEditsRef = ref<any[]>([]);
    const pendingLiveNonStyleUndoStackRef = ref<any[]>([]);
    const historyOrderRef = ref<string[]>([]);
    const args = {
      activeFile: { id: "library", filename: "library.html" },
      canEditDesign: true,
      cancelPendingStructureVerification: vi.fn(),
      files: [{ id: "library", filename: "library.html" }],
      historyOrderRef,
      localhostConnectionRootPathByIdRef: ref(new Map()),
      overviewScreens: [],
      pendingLiveNonStyleEditsRef,
      pendingLiveNonStyleRedoStackRef: ref<any[]>([]),
      pendingLiveNonStyleUndoStackRef,
      pendingStructureRedoReplayRef: ref(undefined),
      pendingStructureRedoReplayTimerRef: ref(undefined),
      pendingVisualStyleRedoStackRef: ref<any[]>([]),
      runtimeLayerSnapshotsById: {},
      recordPendingHistoryEntry: vi.fn((kind: string) => {
        historyOrderRef.current.push(kind);
      }),
      selectedElement: null,
      setPendingLiveNonStyleEdits: vi.fn(),
    } as any;

    runRecordPendingLiveTextEdit(
      args,
      "library",
      "p.description",
      "before selected after",
      {
        selector: "p.description",
        sourceId: "description",
        tagName: "p",
        classes: ["description"],
        computedStyles: {},
        textContent: "before selected after",
        htmlContent: "before selected after",
        boundingRect: { x: 0, y: 0, width: 200, height: 24 },
        isFlexChild: false,
        isFlexContainer: false,
        provenance: {
          sourceFile: "src/Library.tsx",
          line: 42,
          column: 7,
        },
      } satisfies ElementInfo,
      {
        originalValue: "before selected after",
        originalHtml: "before selected after",
        html: 'before <span style="font-size: 22px">selected</span> after',
        relativeOperations: {
          fontSize: {
            kind: "expression",
            expression: "+2",
            unit: "px",
          },
        },
      },
    );

    const [edit] = pendingLiveNonStyleEditsRef.current;
    expect(edit.html).toContain(
      '<span style="font-size: 22px">selected</span>',
    );
    expect(edit.html).toContain("before ");
    expect(edit.html).toContain(" after");
    expect(edit.relativeOperations).toEqual({
      fontSize: {
        kind: "expression",
        expression: "+2",
        unit: "px",
      },
    });
    expect(pendingLiveNonStyleUndoStackRef.current).toHaveLength(1);
    expect(pendingLiveNonStyleUndoStackRef.current[0]).toMatchObject({
      kind: "text",
      revertValue: "before selected after",
      revertHtml: "before selected after",
    });
    expect(historyOrderRef.current).toEqual(["pending-live"]);
    const prompt = formatPendingVisualStylePrompt({
      audience: "coding-agent",
      edits: [],
      liveEdits: [edit],
    });
    expect(prompt).toContain('"operation": "update-text"');
    expect(prompt).toContain('"sourceFile": "src/Library.tsx"');
    expect(prompt).toContain('"line": 42');
    expect(prompt).toContain('"relativeOperations"');
    expect(prompt).toContain('"expression": "+2"');
    expect(prompt).toContain('"beforeHtml": "before selected after"');
    expect(prompt).toContain(
      '"afterHtml": "before <span style=\\"font-size: 22px\\">selected</span> after"',
    );
    expect(prompt).toContain("preserve its relative semantics");
    const fullPrompt = formatVisualEditClipboardPrompt(
      prompt,
      "codex",
      true,
      "design-1",
    );
    expect(fullPrompt).toContain('"expression": "+2"');
    expect(fullPrompt).toContain('"sourceFile": "src/Library.tsx"');

    const requestPendingLiveNonStyleRevert = vi.fn();
    const pendingLiveNonStyleRedoStackRef = ref<any[]>([]);
    const redoOrderRef = ref<string[]>([]);
    runUndo({
      activeEditorDragRef: ref(false),
      activeFile: { id: "library" },
      allowPendingLiveEdits: true,
      canEditDesign: false,
      fileHistoryMutationPendingRef: ref(false),
      historyOrderRef,
      pendingLiveNonStyleEditsRef,
      pendingLiveNonStyleRedoStackRef,
      pendingLiveNonStyleUndoStackRef,
      pendingVisualStyleEditsRef: ref<any[]>([]),
      pendingVisualStyleRedoStackRef: ref<any[]>([]),
      pendingVisualStyleUndoStackRef: ref<any[]>([]),
      requestPendingLiveNonStyleRevert,
      redoOrderRef,
      setPendingLiveNonStyleEdits: vi.fn(),
      setSelectedElement: vi.fn(),
      syncUndoRedoState: vi.fn(),
      resetGeometryCommitCoalescing: vi.fn(),
    } as unknown as Parameters<typeof runUndo>[0]);

    expect(requestPendingLiveNonStyleRevert).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: "text",
        originalValue: "before selected after",
        originalHtml: "before selected after",
      }),
    ]);
    expect(pendingLiveNonStyleUndoStackRef.current).toHaveLength(0);
  });

  it("does not coalesce text across an interleaved style history entry", () => {
    const historyOrderRef = ref<string[]>([]);
    const pendingLiveNonStyleUndoStackRef = ref<any[]>([]);
    const pendingLiveNonStyleRedoStackRef = ref<any[]>([]);
    const pendingVisualStyleRedoStackRef = ref<any[]>([]);
    const pendingLiveNonStyleEditsRef = ref<any[]>([]);
    const recordPendingHistoryEntry = vi.fn((kind: string) => {
      historyOrderRef.current.push(kind);
    });
    const args = {
      activeFile: { id: "home", filename: "index.html" },
      canEditDesign: true,
      cancelPendingStructureVerification: vi.fn(),
      files: [{ id: "home", filename: "index.html" }],
      localhostConnectionRootPathByIdRef: ref(new Map()),
      overviewScreens: [],
      pendingLiveNonStyleEditsRef,
      pendingLiveNonStyleRedoStackRef,
      pendingLiveNonStyleUndoStackRef,
      pendingStructureRedoReplayRef: ref(undefined),
      pendingStructureRedoReplayTimerRef: ref(undefined),
      pendingVisualStyleRedoStackRef,
      recordPendingHistoryEntry,
      canCoalescePendingLiveEdit: () =>
        historyOrderRef.current[historyOrderRef.current.length - 1] ===
        "pending-live",
      runtimeLayerSnapshotsById: {},
      selectedElement: null,
      setPendingLiveNonStyleEdits: vi.fn(),
    } as any;
    const record = (value: string) =>
      runRecordPendingLiveTextEdit(args, "home", "#title", value, undefined, {
        originalValue: "Original",
      });

    record("Hel");
    record("Help");
    historyOrderRef.current.push("pending-style");
    record("Helper");

    expect(pendingLiveNonStyleUndoStackRef.current).toHaveLength(2);
    expect(
      pendingLiveNonStyleUndoStackRef.current.map((entry) => entry.edit.value),
    ).toEqual(["Help", "Helper"]);
    expect(recordPendingHistoryEntry).toHaveBeenCalledTimes(2);
    expect(historyOrderRef.current).toEqual([
      "pending-live",
      "pending-style",
      "pending-live",
    ]);
  });

  it("undoes and redoes interleaved style and text edits in strict LIFO order", () => {
    const radius24Edit = {
      screenId: "home",
      filename: "index.html",
      screenName: "Home",
      selector: "#card",
      sourceId: "card",
      classes: [],
      styles: { borderRadius: "24px" },
      originalStyles: { borderRadius: "0px" },
      updatedAt: 1,
    };
    const radius48Edit = {
      ...radius24Edit,
      styles: { borderRadius: "48px" },
      originalStyles: { borderRadius: "24px" },
      updatedAt: 2,
    };
    const fillEdit = {
      screenId: "home",
      filename: "index.html",
      screenName: "Home",
      selector: "#card",
      sourceId: "card",
      classes: [],
      styles: { backgroundColor: "blue" },
      originalStyles: { backgroundColor: "white" },
      updatedAt: 3,
    };
    const textEdit = {
      kind: "text" as const,
      screenId: "home",
      selector: "#title",
      sourceId: "title",
      value: "Updated",
      originalValue: "Original",
      updatedAt: 4,
    };
    const pendingStyleUndoStackRef = ref([
      { edit: radius24Edit, revertStyles: { borderRadius: "0px" } },
      { edit: radius48Edit, revertStyles: { borderRadius: "24px" } },
      { edit: fillEdit, revertStyles: { backgroundColor: "white" } },
    ]);
    const pendingLiveNonStyleUndoStackRef = ref([
      { kind: "text" as const, edit: textEdit, revertValue: "Original" },
    ]);
    const pendingStyleRedoStackRef = ref<any[]>([]);
    const pendingLiveRedoStackRef = ref<any[]>([]);
    const historyOrderRef = ref<any[]>([
      "pending-style",
      "pending-style",
      "pending-style",
      "pending-live",
    ]);
    const redoOrderRef = ref<any[]>([]);
    const undoArgs = {
      activeEditorDragRef: ref(false),
      activeFile: { id: "home" },
      canEditDesign: true,
      fileHistoryMutationPendingRef: ref(false),
      historyOrderRef,
      pendingLiveNonStyleEditsRef: ref([textEdit]),
      pendingLiveNonStyleRedoStackRef: pendingLiveRedoStackRef,
      pendingLiveNonStyleUndoStackRef,
      pendingVisualStyleEditsRef: ref([radius24Edit, radius48Edit, fillEdit]),
      pendingVisualStyleRedoStackRef: pendingStyleRedoStackRef,
      pendingVisualStyleUndoStackRef: pendingStyleUndoStackRef,
      redoOrderRef,
      requestPendingLiveNonStyleRevert: vi.fn(),
      requestPendingVisualStyleRevert: vi.fn(),
      resetGeometryCommitCoalescing: vi.fn(),
      setPendingLiveNonStyleEdits: vi.fn(),
      setPendingVisualStyleEdits: vi.fn(),
      setSelectedElement: vi.fn(),
      syncUndoRedoState: vi.fn(),
    } as any;

    runUndo(undoArgs);
    expect(undoArgs.requestPendingLiveNonStyleRevert).toHaveBeenCalledTimes(1);
    expect(undoArgs.requestPendingVisualStyleRevert).not.toHaveBeenCalled();
    expect(historyOrderRef.current).toEqual([
      "pending-style",
      "pending-style",
      "pending-style",
    ]);
    expect(redoOrderRef.current).toEqual(["pending-live"]);

    runUndo(undoArgs);
    expect(undoArgs.requestPendingVisualStyleRevert).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({ styles: { backgroundColor: "blue" } })],
    );
    runUndo(undoArgs);
    expect(undoArgs.requestPendingVisualStyleRevert).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({ styles: { borderRadius: "48px" } })],
    );
    runUndo(undoArgs);
    expect(undoArgs.requestPendingVisualStyleRevert).toHaveBeenNthCalledWith(
      3,
      [expect.objectContaining({ styles: { borderRadius: "24px" } })],
    );
    expect(historyOrderRef.current).toEqual([]);
    expect(redoOrderRef.current).toEqual([
      "pending-live",
      "pending-style",
      "pending-style",
      "pending-style",
    ]);

    const redoArgs = {
      ...undoArgs,
      setPendingTextRevertRequest: vi.fn(),
      setPendingVisualStyleBaselineResetRequest: vi.fn(),
      setPendingVisualStyleRevertRequest: vi.fn(),
      replayPendingVisualStyleRuntime: vi.fn(() => 42),
    } as any;
    runRedo(redoArgs);
    expect(redoArgs.replayPendingVisualStyleRuntime).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({ styles: { borderRadius: "24px" } })],
    );

    runRedo(redoArgs);
    expect(redoArgs.replayPendingVisualStyleRuntime).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({ styles: { borderRadius: "48px" } })],
    );
    runRedo(redoArgs);
    expect(redoArgs.replayPendingVisualStyleRuntime).toHaveBeenNthCalledWith(
      3,
      [expect.objectContaining({ styles: { backgroundColor: "blue" } })],
    );
    expect(
      redoArgs.setPendingVisualStyleBaselineResetRequest,
    ).toHaveBeenCalledTimes(3);
    expect(
      redoArgs.setPendingVisualStyleBaselineResetRequest,
    ).toHaveBeenNthCalledWith(1, 42);
    runRedo(redoArgs);
    expect(redoArgs.setPendingTextRevertRequest).toHaveBeenCalledTimes(1);
    expect(historyOrderRef.current).toEqual([
      "pending-style",
      "pending-style",
      "pending-style",
      "pending-live",
    ]);
    expect(redoOrderRef.current).toEqual([]);

    const fallbackBaselineReset = vi.fn();
    redoArgs.replayPendingVisualStyleRuntime = undefined;
    redoArgs.setPendingVisualStyleBaselineResetRequest = fallbackBaselineReset;
    redoArgs.pendingVisualStyleRedoStackRef.current = [
      { edit: radius24Edit, revertStyles: { borderRadius: "0px" } },
    ];
    redoArgs.redoOrderRef.current = ["pending-style"];
    runRedo(redoArgs);
    expect(fallbackBaselineReset).toHaveBeenCalledWith(expect.any(Number));

    const emptyFallbackRevert = vi.fn();
    redoArgs.setPendingVisualStyleRevertRequest = emptyFallbackRevert;
    redoArgs.pendingVisualStyleRedoStackRef.current = [
      { edit: { ...radius24Edit, styles: {} }, revertStyles: {} },
    ];
    redoArgs.redoOrderRef.current = ["pending-style"];
    runRedo(redoArgs);
    expect(emptyFallbackRevert).not.toHaveBeenCalled();
    expect(fallbackBaselineReset).toHaveBeenCalledTimes(1);
  });
});
