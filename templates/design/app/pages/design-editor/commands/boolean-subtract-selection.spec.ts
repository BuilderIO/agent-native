// @vitest-environment happy-dom

import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  readYjsRedoSelection,
  readYjsUndoSelection,
  type ContentHistoryEntry,
  type GeometryHistorySelection,
} from "@/pages/design-editor/history";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import {
  runBooleanSubtractSelection,
  type BooleanSubtractSelectionArgs,
} from "./boolean-subtract-selection";

const CONTENT = `<main><div data-agent-native-node-id="base" data-agent-native-layer-name="Base" data-an-primitive="rectangle" style="position:absolute;left:0px;top:0px;width:80px;height:80px;background-color:#cc3366"></div><div data-agent-native-node-id="cutter" data-agent-native-layer-name="Cutter" data-an-primitive="ellipse" style="position:absolute;left:20px;top:20px;width:40px;height:40px;background-color:#3366cc"></div></main>`;

function designFile(content = CONTENT) {
  return {
    id: "screen-1",
    filename: "index.html",
    fileType: "html",
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as const;
}

describe("runBooleanSubtractSelection", () => {
  it("writes one editable Boolean group and selects its wrapper", () => {
    const applyLocalContentUpdate = vi.fn<
      BooleanSubtractSelectionArgs["applyLocalContentUpdate"]
    >((content) => ({
      status: "accepted",
      ...prepareCanonicalSourceContent(content, {
        fileId: "screen-1",
        fileType: "html",
      }),
    }));
    const setSelectedElement = vi.fn();
    const setSelectedLayerIdsState = vi.fn();

    runBooleanSubtractSelection({
      activeFile: designFile(),
      applyLocalContentUpdate,
      canEditDesign: true,
      contentHistorySelectionAfterRef: { current: new WeakMap() },
      contentUndoStackRef: { current: [] },
      files: [designFile()],
      getFreshActiveContent: () => CONTENT,
      overviewSelectedScreenIds: [],
      selectedLayerIdsState: ["base", "cutter"],
      setSelectedElement,
      setSelectedLayerIdsState,
      t: (key) => key,
      undoManagerRef: { current: null },
    });

    expect(applyLocalContentUpdate).toHaveBeenCalledTimes(1);
    expect(applyLocalContentUpdate.mock.calls[0]?.[1]).toEqual({
      forcePreviewFullDocument: true,
      selectionBefore: {
        selectedElement: null,
        selectedLayerIds: ["base", "cutter"],
      },
    });
    expect(applyLocalContentUpdate.mock.calls[0]?.[0]).toContain(
      'data-an-primitive="boolean"',
    );
    expect(setSelectedLayerIdsState).toHaveBeenCalledWith([
      expect.not.stringMatching(/^(base|cutter)$/),
    ]);
    expect(setSelectedElement).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("stamps the Boolean result for redo on both history stacks", () => {
    const contentUndoStackRef = {
      current: [] as ContentHistoryEntry[],
    };
    const contentHistorySelectionAfterRef = {
      current: new WeakMap<ContentHistoryEntry, GeometryHistorySelection>(),
    };
    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    ytext.insert(0, CONTENT);
    const origin = {};
    const undoManager = new Y.UndoManager(ytext, {
      trackedOrigins: new Set([origin]),
      captureTimeout: 0,
    });
    const applyLocalContentUpdate = vi.fn((after: string) => {
      const before = ytext.toString();
      const publication = prepareCanonicalSourceContent(after, {
        fileId: "screen-1",
        fileType: "html",
      });
      doc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, publication.content);
      }, origin);
      contentUndoStackRef.current.push({
        fileId: "screen-1",
        before,
        after: publication.content,
      });
      return { status: "accepted" as const, ...publication };
    });

    runBooleanSubtractSelection({
      activeFile: designFile(),
      applyLocalContentUpdate,
      canEditDesign: true,
      contentHistorySelectionAfterRef,
      contentUndoStackRef,
      files: [designFile()],
      getFreshActiveContent: () => CONTENT,
      overviewSelectedScreenIds: ["screen-1"],
      selectedLayerIdsState: ["base", "cutter"],
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: vi.fn(),
      t: (key) => key,
      undoManagerRef: { current: undoManager },
    });

    const entry = contentUndoStackRef.current[0];
    if (!entry || "changes" in entry) {
      throw new Error("Boolean did not create its content-history entry");
    }
    const wrapper = buildCodeLayerProjection(entry.after, {
      source: { kind: "design-file", fileId: entry.fileId },
    }).nodes.find(
      (node) => node.dataAttributes["data-an-primitive"] === "boolean",
    );
    if (!wrapper) throw new Error("Boolean result wrapper is missing");

    expect(contentHistorySelectionAfterRef.current.get(entry)).toMatchObject({
      overviewSelectedScreenIds: ["screen-1"],
      selectedLayerIds: [wrapper.id],
      activeFileId: "screen-1",
      sourceContentByFileId: { "screen-1": entry.after },
    });
    expect(readYjsUndoSelection(undoManager.undoStack[0])).toMatchObject({
      selectedLayerIds: ["base", "cutter"],
    });
    expect(readYjsRedoSelection(undoManager.undoStack[0])).toMatchObject({
      selectedLayerIds: [wrapper.id],
    });

    undoManager.destroy();
    doc.destroy();
  });

  it("reports unsupported selections without writing source", () => {
    const applyLocalContentUpdate = vi.fn();
    const setSelectedElement = vi.fn();
    const setSelectedLayerIdsState = vi.fn();
    const unsupportedContent = CONTENT.replace(
      'style="position:absolute;left:20px;top:20px;width:40px;height:40px;background-color:#3366cc"',
      'style="position:absolute;left:20px;top:20px;width:40px;height:40px;background-color:#3366cc;transform:rotate(10deg)"',
    );
    const activeFile = designFile(unsupportedContent);

    runBooleanSubtractSelection({
      activeFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      contentHistorySelectionAfterRef: { current: new WeakMap() },
      contentUndoStackRef: { current: [] },
      files: [activeFile],
      getFreshActiveContent: () => unsupportedContent,
      overviewSelectedScreenIds: [],
      selectedLayerIdsState: ["base", "cutter"],
      setSelectedElement,
      setSelectedLayerIdsState,
      t: (key) => key,
      undoManagerRef: { current: null },
    });

    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(setSelectedElement).not.toHaveBeenCalled();
    expect(setSelectedLayerIdsState).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.toasts.booleanSubtractUnsupported",
      { duration: 4000 },
    );
  });

  it("rejects a selection that mixes the active screen with another screen", () => {
    const applyLocalContentUpdate = vi.fn();
    const setSelectedElement = vi.fn();
    const setSelectedLayerIdsState = vi.fn();
    const activeFile = designFile();
    const otherFile = {
      ...designFile(),
      id: "screen-2",
      filename: "about.html",
    };

    runBooleanSubtractSelection({
      activeFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      contentHistorySelectionAfterRef: { current: new WeakMap() },
      contentUndoStackRef: { current: [] },
      files: [activeFile, otherFile],
      getFreshActiveContent: () => CONTENT,
      overviewSelectedScreenIds: [],
      selectedLayerIdsState: ["base", "cutter", "screen-2"],
      setSelectedElement,
      setSelectedLayerIdsState,
      t: (key) => key,
      undoManagerRef: { current: null },
    });

    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(setSelectedElement).not.toHaveBeenCalled();
    expect(setSelectedLayerIdsState).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.toasts.booleanSubtractUnsupported",
      { duration: 4000 },
    );
  });
});
