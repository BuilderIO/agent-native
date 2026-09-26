// @vitest-environment happy-dom

import { buildCodeLayerProjection } from "@shared/code-layer";
import { annotateScreenHtmlForPersist } from "@shared/screen-annotation";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentLineage } from "@/lib/clipboard-content-lineage";
import { elementInfoFromCodeLayerNode } from "@/pages/design-editor/code-layer-state";
import { runDeleteFiles } from "@/pages/design-editor/commands/delete-files";
import { runDuplicateSelection } from "@/pages/design-editor/commands/duplicate-selection";
import { runGetSelectedLayerSnapshots } from "@/pages/design-editor/commands/get-selected-layer-snapshots";
import { runPublishCanonicalContent } from "@/pages/design-editor/commands/publish-canonical-content";
import { runRedo } from "@/pages/design-editor/commands/redo";
import type { RedoArgs } from "@/pages/design-editor/commands/redo";
import { runUndo } from "@/pages/design-editor/commands/undo";
import type { UndoArgs } from "@/pages/design-editor/commands/undo";
import type { UndoRedoOrderKind } from "@/pages/design-editor/editor-state";
import type { GeometryHistoryEntry } from "@/pages/design-editor/history";
import type {
  ContentHistoryChange,
  ContentHistoryEntry,
  ContentHistorySelectionAfterMap,
  FileDeletionHistoryEntry,
  FileDeletionHistorySnapshot,
  GeometryHistorySelection,
  SelectionHistoryEntry,
} from "@/pages/design-editor/history";
import { getContentHistoryChanges } from "@/pages/design-editor/history";
import * as historyIdentity from "@/pages/design-editor/history-identity";
import { captureHistorySelectionSources } from "@/pages/design-editor/history-identity";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

const ref = <T>(current: T) => ({ current });
function acceptFixture(fileId: string, content: string) {
  const prepared = prepareCanonicalSourceContent(content, {
    fileId,
    fileType: "html",
  });
  return {
    status: "accepted" as const,
    content: prepared.content,
    nodeIdMap: prepared.nodeIdMap,
  };
}
type DesignFileWithGeometry = DesignFile & {
  geometry: NonNullable<FileDeletionHistorySnapshot["geometry"]>;
};
const applySetter = <T>(
  target: { current: T },
  update: T | ((previous: T) => T),
) => {
  target.current =
    typeof update === "function"
      ? (update as (previous: T) => T)(target.current)
      : update;
};

function noteParagraphs(content: string, fileId: string) {
  return buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId },
  }).nodes.filter((node) => node.tag === "p" && node.textSnippet === "Note");
}

describe("screen deletion history identity", () => {
  it("keeps a deletion undoable and shows a localized error when restore proof fails", async () => {
    const deletedFile: DesignFile = {
      id: "screen-proof-failure",
      filename: "proof-failure.html",
      content: "<main><p>Restored content</p></main>",
      fileType: "html",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    };
    const deletionEntry: FileDeletionHistoryEntry = {
      files: [
        {
          ...deletedFile,
          geometry: { x: 10, y: 20, width: 300, height: 600, z: 0 },
        },
      ],
    };
    const fileDeletionUndoStackRef = ref([deletionEntry]);
    const historyOrderRef = ref<Array<any>>(["file-deleted"]);
    const fileHistoryMutationPendingRef = ref(false);
    const createFile = vi.fn(async () => ({ id: "unexpected-restored-id" }));
    const deleteFile = vi.fn(async () => ({ deleted: true }));
    const queryClient = {
      invalidateQueries: vi.fn(),
    } as unknown as QueryClient;
    const genericErrorMessage = "Localized generic error";
    const normalizationProof = vi
      .spyOn(historyIdentity, "prepareDeletedFileRestore")
      .mockImplementation(() => {
        throw new Error("Unable to prove restored Screen identity");
      });
    const errorToast = vi
      .spyOn(toast, "error")
      .mockImplementation(() => "test-toast");

    try {
      runUndo({
        activeEditorDragRef: ref(false),
        activeFile: deletedFile,
        canEditDesign: true,
        clipboardPasteUndoStackRef: ref([]),
        pendingLiveNonStyleUndoStackRef: ref([]),
        pendingVisualStyleUndoStackRef: ref([]),
        createFileMutation: { mutateAsync: createFile } as any,
        deleteFileMutation: { mutateAsync: deleteFile } as any,
        designDataJsonRef: ref({}),
        fileDeletionRedoStackRef: ref([]),
        fileDeletionUndoStackRef,
        fileHistoryMutationPendingRef,
        historyOrderRef,
        id: "design",
        queryClient,
        redoOrderRef: ref([]),
        syncUndoRedoState: vi.fn(),
        t: (key: string) =>
          key === "common.genericError" ? genericErrorMessage : key,
        undoManagerRef: ref(null),
        viewModeRef: ref("overview"),
      } as unknown as UndoArgs);

      await vi.waitFor(() =>
        expect(fileHistoryMutationPendingRef.current).toBe(false),
      );

      expect(normalizationProof).toHaveBeenCalledWith(deletionEntry.files[0]);
      expect(createFile).not.toHaveBeenCalled();
      expect(deleteFile).not.toHaveBeenCalled();
      expect(fileDeletionUndoStackRef.current).toHaveLength(1);
      expect(fileDeletionUndoStackRef.current[0]?.files).toEqual(
        deletionEntry.files,
      );
      expect(historyOrderRef.current).toEqual(["file-deleted"]);
      expect(errorToast).toHaveBeenCalledWith(genericErrorMessage);
      expect(errorToast).not.toHaveBeenCalledWith(
        "Unable to prove restored Screen identity",
      );
    } finally {
      normalizationProof.mockRestore();
      errorToast.mockRestore();
    }
  });

  it("remaps only cleanup-failed recreations and retries the remaining deletion once", async () => {
    const fileA: DesignFileWithGeometry = {
      id: "screen-a-old",
      filename: "a.html",
      content: "<main><p>Screen A</p></main>",
      fileType: "html",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
      geometry: { x: 10, y: 20, width: 300, height: 600, z: 0 },
    };
    const fileB: DesignFileWithGeometry = {
      id: "screen-b-old",
      filename: "b.html",
      content: "<main><p>Screen B</p></main>",
      fileType: "html",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
      geometry: { x: 30, y: 40, width: 300, height: 600, z: 1 },
    };
    const historyA: ContentHistoryChange = {
      fileId: fileA.id,
      before: "<main><p>Before A edit</p></main>",
      after: fileA.content,
    };
    const historyB: ContentHistoryChange = {
      fileId: fileB.id,
      before: "<main><p>Before B edit</p></main>",
      after: fileB.content,
    };
    const fileDeletionUndoStackRef = ref<FileDeletionHistoryEntry[]>([
      {
        files: [
          { ...fileA, geometry: fileA.geometry },
          { ...fileB, geometry: fileB.geometry },
        ],
      },
    ]);
    const historyOrderRef = ref<Array<any>>(["file-deleted"]);
    const redoOrderRef = ref<Array<any>>([]);
    const fileHistoryMutationPendingRef = ref(false);
    const contentUndoStackRef = ref<ContentHistoryEntry[]>([
      historyA,
      historyB,
    ]);
    const contentUndoSelectionStackRef = ref<
      (GeometryHistorySelection | undefined)[]
    >([undefined, undefined]);
    const contentRedoStackRef = ref<ContentHistoryEntry[]>([]);
    const contentRedoSelectionStackRef = ref<
      (GeometryHistorySelection | undefined)[]
    >([]);
    const localContentUndoStackRef = ref([historyA, historyB]);
    const localContentRedoStackRef = ref<ContentHistoryChange[]>([]);
    const geometryUndoStackRef = ref<GeometryHistoryEntry[]>([]);
    const geometryRedoStackRef = ref<GeometryHistoryEntry[]>([]);
    const selectionUndoStackRef = ref<SelectionHistoryEntry[]>([]);
    const selectionRedoStackRef = ref<SelectionHistoryEntry[]>([]);
    const fileDeletionRedoStackRef = ref<FileDeletionHistoryEntry[]>([]);
    const createCalls: string[] = [];
    const createFile = vi.fn(async ({ filename }: { filename: string }) => {
      createCalls.push(filename);
      if (filename === fileA.filename) return { id: "screen-a-restored" };
      if (createCalls.filter((name) => name === fileB.filename).length === 1) {
        throw new Error("second create failed");
      }
      return { id: "screen-b-restored" };
    });
    const deleteFile = vi.fn(async ({ id }: { id: string }) => {
      if (id === "screen-a-restored") throw new Error("cleanup failed");
      return { deleted: true };
    });
    const designDataJsonRef = ref<Record<string, unknown>>({
      canvasFrames: {},
    });
    const queryClient = {
      invalidateQueries: vi.fn(),
    } as unknown as QueryClient;
    const genericErrorMessage = "Localized generic error";
    const errorToast = vi
      .spyOn(toast, "error")
      .mockImplementation(() => "test-toast");
    const runDeletionUndo = () =>
      runUndo({
        activeEditorDragRef: ref(false),
        activeFile: fileA,
        applyFileContentUpdate: vi.fn(),
        applyLocalContentUpdate: vi.fn(),
        canEditDesign: true,
        clipboardPasteRedoStackRef: ref([]),
        clipboardPasteUndoStackRef: ref([]),
        codeLayerOwnerByNodeIdRef: ref(new Map()),
        contentHistorySelectionAfterRef: ref(new WeakMap()),
        contentRedoSelectionStackRef,
        contentRedoStackRef,
        contentUndoSelectionStackRef,
        contentUndoStackRef,
        createFileMutation: { mutateAsync: createFile } as any,
        deleteFileMutation: { mutateAsync: deleteFile } as any,
        designDataJsonRef,
        fileCreationRedoStackRef: ref([]),
        fileCreationUndoStackRef: ref([]),
        fileDeletionRedoStackRef,
        fileDeletionUndoStackRef,
        fileHistoryMutationPendingRef,
        files: [fileA, fileB],
        geometryRedoStackRef,
        geometryUndoStackRef,
        getFreshActiveContent: () => fileA.content,
        getScreenContent: (screenId: string) =>
          screenId === fileA.id ? fileA.content : fileB.content,
        historyOrderRef,
        id: "design",
        isSynced: true,
        lastLocalContentRef: ref(null),
        latestClipboardMutationContentRef: ref(new Map()),
        liveFrameGeometryRef: ref({}),
        liveScreenSnapshotsById: {},
        localContentRedoStackRef,
        localContentUndoStackRef,
        markPendingLocalFileContent: vi.fn(),
        pendingLiveNonStyleEditsRef: ref([]),
        pendingLiveNonStyleRedoStackRef: ref([]),
        pendingLiveNonStyleUndoStackRef: ref([]),
        pendingLocalFileContentsRef: ref(new Map()),
        pendingVisualStyleEditsRef: ref([]),
        pendingVisualStyleRedoStackRef: ref([]),
        pendingVisualStyleUndoStackRef: ref([]),
        performDeleteFiles: vi.fn(),
        publishAuthoritativeClipboardMutation: vi.fn(() => null),
        queryClient,
        queueFileContentSave: vi.fn(),
        redoOrderRef,
        replacePreviewContent: vi.fn(),
        requestPendingLiveNonStyleRevert: vi.fn(),
        requestPendingVisualStyleRevert: vi.fn(),
        restoreSelectionSnapshot: vi.fn(),
        selectionRedoStackRef,
        selectionUndoStackRef,
        setActiveFileId: vi.fn(),
        setContentRenderRevision: vi.fn(),
        setHoveredElement: vi.fn(),
        setOverviewSelectedScreenIds: vi.fn(),
        setPendingLiveNonStyleEdits: vi.fn(),
        setPendingVisualStyleEdits: vi.fn(),
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        suppressContentHistoryRef: ref(false),
        syncLiveScreenSnapshotPreview: vi.fn(),
        syncUndoRedoState: vi.fn(),
        t: (key: string) =>
          key === "common.genericError" ? genericErrorMessage : key,
        undoManagerRef: ref(null),
        updateLiveScreenSnapshotContent: vi.fn(() => false),
        viewModeRef: ref("overview"),
        writeFrameGeometrySnapshot: (geometry: Record<string, unknown>) => {
          designDataJsonRef.current = {
            ...designDataJsonRef.current,
            canvasFrames: geometry,
          };
        },
        ydoc: null,
      } as unknown as UndoArgs);

    try {
      runDeletionUndo();
      await vi.waitFor(() =>
        expect(fileHistoryMutationPendingRef.current).toBe(false),
      );

      expect(createCalls).toEqual([fileA.filename, fileB.filename]);
      expect(
        contentUndoStackRef.current.flatMap((entry) =>
          getContentHistoryChanges(entry).map((change) => change.fileId),
        ),
      ).toEqual(["screen-a-restored", fileB.id]);
      expect(contentUndoStackRef.current[1]).toBe(historyB);
      expect(
        localContentUndoStackRef.current.map((entry) => entry.fileId),
      ).toEqual(["screen-a-restored", fileB.id]);
      expect(localContentUndoStackRef.current[1]).toBe(historyB);
      expect(fileDeletionUndoStackRef.current).toHaveLength(1);
      expect(
        fileDeletionUndoStackRef.current[0]?.files.map((file) => file.id),
      ).toEqual([fileB.id]);
      expect(historyOrderRef.current).toEqual(["file-deleted"]);
      expect(errorToast).toHaveBeenCalledWith(genericErrorMessage);

      runDeletionUndo();
      await vi.waitFor(() =>
        expect(fileHistoryMutationPendingRef.current).toBe(false),
      );

      expect(createCalls).toEqual([
        fileA.filename,
        fileB.filename,
        fileB.filename,
      ]);
      expect(
        contentUndoStackRef.current.flatMap((entry) =>
          getContentHistoryChanges(entry).map((change) => change.fileId),
        ),
      ).toEqual(["screen-a-restored", "screen-b-restored"]);
      expect(fileDeletionUndoStackRef.current).toHaveLength(0);
    } finally {
      errorToast.mockRestore();
    }
  });

  it("keeps a legacy duplicate-ID style edit undoable after screen recreation and restores its exact target", async () => {
    const oldScreenId = "screen-old";
    const restoredScreenId = "screen-restored";
    const survivorScreenId = "screen-survivor";
    const rawBefore =
      '<main><p id="duplicate">Note</p><p id="duplicate">Note</p></main>';
    const rawAfter =
      '<main><p id="duplicate">Note</p><p id="duplicate" style="color: red">Note</p></main>';
    const publicationQueue: Array<{
      fileId: string;
      content: string;
      identityMigrationSourceContent: string;
    }> = [];
    const pendingPublication = ref(new Map());
    const publisherArgs = {
      canEditDesignRef: ref(true),
      pendingLocalFileContentsRef: pendingPublication,
      cancelIdentityMigration: (fileId: string) =>
        pendingPublication.current.delete(fileId),
      queueFileContentSave: (
        fileId: string,
        content: string,
        options: { identityMigrationSourceContent: string },
      ) => {
        publicationQueue.push({
          fileId,
          content,
          identityMigrationSourceContent:
            options.identityMigrationSourceContent,
        });
        pendingPublication.current.set(fileId, {
          content,
          startedAt: Date.now(),
          identityMigrationSourceContent:
            options.identityMigrationSourceContent,
        });
      },
    };
    const before = runPublishCanonicalContent(
      publisherArgs,
      oldScreenId,
      rawBefore,
      "html",
    );
    const after = runPublishCanonicalContent(
      publisherArgs,
      oldScreenId,
      rawAfter,
      "html",
    );
    const publishedDuplicateIds = noteParagraphs(after, oldScreenId).map(
      (node) => node.dataAttributes["data-agent-native-node-id"],
    );
    expect(after.match(/id="duplicate"/g)).toHaveLength(2);
    expect(publishedDuplicateIds.every(Boolean)).toBe(true);
    expect(new Set(publishedDuplicateIds).size).toBe(2);
    expect(
      publicationQueue[publicationQueue.length - 1]
        ?.identityMigrationSourceContent,
    ).toBe(rawAfter);
    const survivorContent = "<main><p>Survivor</p></main>";
    const sourceFile: DesignFile = {
      id: oldScreenId,
      filename: "notes.html",
      content: after,
      fileType: "html",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    };
    const survivorFile: DesignFile = {
      id: survivorScreenId,
      filename: "survivor.html",
      content: survivorContent,
      fileType: "html",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    };
    const oldTargetBefore = noteParagraphs(before, oldScreenId)[1];
    const oldTargetAfter = noteParagraphs(after, oldScreenId)[1];
    const survivorTarget = buildCodeLayerProjection(survivorContent, {
      source: { kind: "design-file", fileId: survivorScreenId },
    }).nodes.find((node) => node.tag === "p");
    if (!oldTargetBefore || !oldTargetAfter || !survivorTarget) {
      throw new Error("missing Note layer");
    }

    const oldSelectedElement = {
      ...elementInfoFromCodeLayerNode(oldTargetBefore),
      sourceLayerIdentity: {
        screenId: oldScreenId,
        nodeId: oldTargetBefore.id,
      },
    } as ElementInfo;
    const beforeSelection = captureHistorySelectionSources(
      {
        overviewSelectedScreenIds: [oldScreenId, survivorScreenId],
        selectedLayerIds: [oldTargetBefore.id],
        activeFileId: oldScreenId,
      },
      { [oldScreenId]: before, [survivorScreenId]: survivorContent },
    );
    const targetContentChange = {
      fileId: oldScreenId,
      before,
      after,
      selectionBefore: {
        selectedElement: oldSelectedElement,
        selectedLayerIds: [oldTargetBefore.id],
        sourceContentByFileId: beforeSelection.sourceContentByFileId,
      },
    } as ContentHistoryChange;
    const contentUndoStackRef = ref<ContentHistoryEntry[]>([
      targetContentChange,
    ]);
    const contentRedoStackRef = ref<ContentHistoryEntry[]>([]);
    const contentUndoSelectionStackRef = ref<
      (GeometryHistorySelection | undefined)[]
    >([beforeSelection]);
    const contentRedoSelectionStackRef = ref<
      (GeometryHistorySelection | undefined)[]
    >([]);
    const contentHistorySelectionAfterRef =
      ref<ContentHistorySelectionAfterMap>(new WeakMap());
    const originalAfterSelection = captureHistorySelectionSources(
      {
        overviewSelectedScreenIds: [oldScreenId, survivorScreenId],
        selectedLayerIds: [oldTargetAfter.id],
        activeFileId: oldScreenId,
      },
      { [oldScreenId]: after, [survivorScreenId]: survivorContent },
    );
    contentHistorySelectionAfterRef.current.set(
      targetContentChange as ContentHistoryEntry,
      originalAfterSelection,
    );

    const survivorSelection = captureHistorySelectionSources(
      {
        overviewSelectedScreenIds: [oldScreenId, survivorScreenId],
        selectedLayerIds: [survivorTarget.id],
        activeFileId: survivorScreenId,
      },
      { [oldScreenId]: after, [survivorScreenId]: survivorContent },
    );
    const geometryUndoEntry: GeometryHistoryEntry = {
      before: {
        [survivorScreenId]: { x: 10, y: 20, width: 400, height: 800, z: 0 },
      },
      after: {
        [survivorScreenId]: { x: 30, y: 40, width: 400, height: 800, z: 0 },
      },
      selectionBefore: survivorSelection,
      selectionAfter: survivorSelection,
    };
    const geometryUndoStackRef = ref<GeometryHistoryEntry[]>([
      geometryUndoEntry,
    ]);
    const geometryRedoStackRef = ref<GeometryHistoryEntry[]>([]);
    const selectionUndoStackRef = ref<SelectionHistoryEntry[]>([
      { before: survivorSelection, after: { ...originalAfterSelection } },
    ]);
    const selectionRedoStackRef = ref<SelectionHistoryEntry[]>([]);

    const fileDeletionUndoStackRef = ref<FileDeletionHistoryEntry[]>([]);
    const fileDeletionRedoStackRef = ref<FileDeletionHistoryEntry[]>([]);
    const fileCreationUndoStackRef = ref([]);
    const fileCreationRedoStackRef = ref([]);
    const historyOrderRef = ref([
      "selection",
      "geometry",
      "file-content",
    ] as Array<any>);
    const redoOrderRef = ref<Array<any>>([]);
    const fileHistoryMutationPendingRef = ref(false);
    const designDataJsonRef = ref<Record<string, unknown>>({
      canvasFrames: {
        [oldScreenId]: { x: 100, y: 100, width: 390, height: 844, z: 0 },
        [survivorScreenId]: geometryUndoEntry.after[survivorScreenId],
      },
    });
    const queryClient = {
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    } as unknown as QueryClient;
    const currentContentByFile = new Map([
      [oldScreenId, after],
      [survivorScreenId, survivorContent],
    ]);
    const currentFiles: DesignFile[] = [sourceFile, survivorFile];
    const selectedElementRef = ref<ElementInfo | null>(oldSelectedElement);
    const selectedLayerIdsRef = ref([oldTargetBefore.id]);
    const activeFileIdRef = ref(oldScreenId);
    const overviewSelectedScreenIdsRef = ref([oldScreenId]);
    const hoveredElementRef = ref<ElementInfo | null>(null);
    const restoredHtmlRef = ref<string | null>(null);
    const noop = vi.fn();
    const writeFrameGeometrySnapshot = vi.fn(
      (geometry: Record<string, unknown>) => {
        designDataJsonRef.current = {
          ...designDataJsonRef.current,
          canvasFrames: geometry,
        };
      },
    );

    runDeleteFiles(
      {
        activeFile: sourceFile,
        canvasFrameGeometryById: designDataJsonRef.current
          .canvasFrames as Record<string, any>,
        clearRedoStacks: noop,
        designDataJsonRef,
        clipboardPasteRedoStackRef: ref([]),
        clipboardPasteUndoStackRef: ref([]),
        contentRedoSelectionStackRef,
        contentRedoStackRef,
        contentUndoSelectionStackRef,
        contentUndoStackRef,
        deleteFileMutation: {
          mutateAsync: vi.fn(async () => ({
            deleted: true,
            id: sourceFile.id,
            deletedFiles: [
              {
                ...sourceFile,
                geometry: (
                  designDataJsonRef.current.canvasFrames as Record<
                    string,
                    unknown
                  >
                )[sourceFile.id],
              },
            ],
          })),
        } as any,
        fileCreationRedoStackRef,
        fileCreationUndoStackRef,
        fileDeletionUndoStackRef,
        fileHistoryMutationPendingRef,
        files: currentFiles,
        geometryRedoStackRef,
        geometryUndoStackRef,
        historyOrderRef,
        id: "design",
        latestClipboardMutationContentRef: ref(new Map()),
        localContentRedoStackRef: ref([]),
        localContentUndoStackRef: ref([]),
        queryClient,
        redoOrderRef,
        setActiveFileId: noop,
        setSelectedElement: noop,
        setSelectedLayerIdsState: noop,
        syncUndoRedoState: noop,
        t: (key: string) => key,
        writeFrameGeometrySnapshot,
      },
      [sourceFile],
      { recordDeletionHistory: true },
    );
    await vi.waitFor(() =>
      expect(fileDeletionUndoStackRef.current).toHaveLength(1),
    );

    const makeUndoArgs = (activeFile: DesignFile, files: DesignFile[]) =>
      ({
        activeEditorDragRef: ref(false),
        activeFile,
        applyFileContentUpdate: (fileId: string, content: string) => {
          currentContentByFile.set(fileId, content);
          return {
            status: "accepted" as const,
            content,
            nodeIdMap: new Map(),
          };
        },
        applyLocalContentUpdate: (content: string) => {
          currentContentByFile.set(activeFile.id, content);
          return {
            status: "accepted" as const,
            content,
            nodeIdMap: new Map(),
          };
        },
        canEditDesign: true,
        clipboardPasteRedoStackRef: ref([]),
        clipboardPasteUndoStackRef: ref([]),
        contentHistorySelectionAfterRef,
        contentRedoSelectionStackRef,
        contentRedoStackRef,
        contentUndoSelectionStackRef,
        contentUndoStackRef,
        createFileMutation: {
          mutateAsync: vi.fn(async ({ content }: { content: string }) => {
            const normalized = annotateScreenHtmlForPersist(content, "html");
            restoredHtmlRef.current = normalized;
            currentContentByFile.set(restoredScreenId, normalized);
            return { id: restoredScreenId, content: normalized };
          }),
        } as any,
        deleteFileMutation: {
          mutateAsync: vi.fn(async () => ({
            deleted: true,
            deletedFiles: [
              {
                ...activeFile,
                geometry: (
                  designDataJsonRef.current.canvasFrames as Record<
                    string,
                    unknown
                  >
                )[activeFile.id],
              },
            ],
          })),
        } as any,
        designDataJsonRef,
        fileDeletionRedoStackRef,
        fileDeletionUndoStackRef,
        fileHistoryMutationPendingRef,
        files,
        geometryRedoStackRef,
        geometryUndoStackRef,
        getFreshActiveContent: () =>
          currentContentByFile.get(activeFile.id) ?? "",
        getScreenContent: (screenId: string) =>
          currentContentByFile.get(screenId) ?? "",
        historyOrderRef,
        id: "design",
        liveScreenSnapshotsById: {},
        localContentRedoStackRef: ref([]),
        localContentUndoStackRef: ref([]),
        pendingLiveNonStyleRedoStackRef: ref([]),
        pendingLiveNonStyleUndoStackRef: ref([]),
        pendingVisualStyleRedoStackRef: ref([]),
        pendingVisualStyleUndoStackRef: ref([]),
        queryClient,
        redoOrderRef,
        restoreSelectionSnapshot: (selection?: GeometryHistorySelection) => {
          if (!selection) return;
          overviewSelectedScreenIdsRef.current =
            selection.overviewSelectedScreenIds;
          activeFileIdRef.current = selection.activeFileId ?? "";
          selectedLayerIdsRef.current = selection.selectedLayerIds;
        },
        selectionRedoStackRef,
        selectionUndoStackRef,
        setActiveFileId: (id: string) => {
          activeFileIdRef.current = id;
        },
        setHoveredElement: (
          value:
            | ElementInfo
            | null
            | ((prev: ElementInfo | null) => ElementInfo | null),
        ) => applySetter(hoveredElementRef, value),
        setOverviewSelectedScreenIds: (
          value: string[] | ((prev: string[]) => string[]),
        ) => applySetter(overviewSelectedScreenIdsRef, value),
        setSelectedElement: (
          value:
            | ElementInfo
            | null
            | ((prev: ElementInfo | null) => ElementInfo | null),
        ) => applySetter(selectedElementRef, value),
        setSelectedLayerIdsState: (
          value: string[] | ((prev: string[]) => string[]),
        ) => applySetter(selectedLayerIdsRef, value),
        suppressContentHistoryRef: ref(false),
        syncUndoRedoState: noop,
        t: (key: string) => key,
        undoManagerRef: ref(null),
        viewModeRef: ref("overview" as const),
        writeFrameGeometrySnapshot,
      }) as unknown as UndoArgs;

    runUndo(makeUndoArgs(survivorFile, [survivorFile]));
    await vi.waitFor(() =>
      expect(fileHistoryMutationPendingRef.current).toBe(false),
    );
    expect(restoredHtmlRef.current).toBe(
      annotateScreenHtmlForPersist(after, "html"),
    );
    expect(fileDeletionRedoStackRef.current).toHaveLength(1);

    expect(contentUndoStackRef.current).toHaveLength(1);
    const restoredChange = contentUndoStackRef
      .current[0] as ContentHistoryChange;
    expect(restoredChange.fileId).toBe(restoredScreenId);
    expect(restoredChange.before).toBe(before);
    expect(restoredChange.after).toBe(after);
    expect(
      restoredChange.selectionBefore?.selectedElement?.sourceLayerIdentity,
    ).toMatchObject({
      screenId: restoredScreenId,
      nodeId: noteParagraphs(before, restoredScreenId)[1]?.id,
    });

    const restoredFile: DesignFile = {
      ...sourceFile,
      id: restoredScreenId,
      content: restoredHtmlRef.current!,
    };
    const recreatedPublishedIds = noteParagraphs(
      restoredFile.content,
      restoredScreenId,
    ).map((node) => node.dataAttributes["data-agent-native-node-id"]);
    expect(recreatedPublishedIds).toEqual(publishedDuplicateIds);
    currentFiles.splice(0, currentFiles.length, restoredFile, survivorFile);
    runUndo(makeUndoArgs(restoredFile, currentFiles));
    expect(currentContentByFile.get(restoredScreenId)).toBe(before);
    const recreatedBeforeTarget = noteParagraphs(before, restoredScreenId)[1];
    expect(selectedLayerIdsRef.current).toEqual([recreatedBeforeTarget?.id]);

    runRedo(makeUndoArgs(restoredFile, currentFiles) as unknown as RedoArgs);
    expect(currentContentByFile.get(restoredScreenId)).toBe(after);
    const recreatedAfterTarget = noteParagraphs(after, restoredScreenId)[1];
    expect(selectedLayerIdsRef.current).toEqual([recreatedAfterTarget?.id]);
    expect(selectedElementRef.current?.sourceLayerIdentity).toMatchObject({
      screenId: restoredScreenId,
      nodeId: recreatedAfterTarget?.id,
    });

    const currentSelectedElement = selectedElementRef.current;
    const layerSnapshots = () =>
      runGetSelectedLayerSnapshots({
        activeFile: restoredFile,
        designSourceType: "inline",
        files: currentFiles,
        getFreshActiveContent: () =>
          currentContentByFile.get(restoredScreenId) ?? "",
        getScreenContent: (screenId) =>
          currentContentByFile.get(screenId) ?? "",
        liveScreenSnapshotsById: {},
        overviewScreens: [],
        runtimeLayerSnapshotsById: {},
        selectedElement: selectedElementRef.current,
        selectedElementLayerId: selectedLayerIdsRef.current[0] ?? null,
        selectedLayerIdsState: selectedLayerIdsRef.current,
      });
    expect(layerSnapshots()).toHaveLength(1);
    expect(layerSnapshots()[0]?.html).toContain('style="color: red"');

    const duplicateScreen = vi.fn();
    runDuplicateSelection({
      activeFile: restoredFile,
      designId: "design-1",
      applyFileContentUpdate: (fileId, content) => {
        const publication = acceptFixture(fileId, content);
        currentContentByFile.set(fileId, publication.content);
        return publication;
      },
      applyLocalContentUpdate: (content) => {
        const publication = acceptFixture(restoredScreenId, content);
        currentContentByFile.set(restoredScreenId, publication.content);
        return publication;
      },
      canEditDesign: true,
      files: currentFiles,
      getFreshActiveContent: () =>
        currentContentByFile.get(restoredScreenId) ?? "",
      getScreenContent: (screenId) => currentContentByFile.get(screenId) ?? "",
      getSelectedLayerSnapshots: layerSnapshots,
      handleDuplicateScreen: duplicateScreen,
      lastDuplicateTransformRef: ref(null),
      overviewSelectedScreenIds: [restoredScreenId],
      remapMotionTracksForClone: noop,
      selectedCanvasSelector: "",
      selectedElement: currentSelectedElement,
      selectedLayerIdsState: selectedLayerIdsRef.current,
      setOverviewSelectedScreenIds: (value) =>
        applySetter(overviewSelectedScreenIdsRef, value),
      setSelectedElement: (value) => applySetter(selectedElementRef, value),
      setSelectedLayerIdsState: (value) =>
        applySetter(selectedLayerIdsRef, value),
      t: (key: string) => key,
      undoManagerRef: ref(null),
      viewModeRef: ref("overview"),
    });
    expect(duplicateScreen).not.toHaveBeenCalled();
    const duplicatedContent = currentContentByFile.get(restoredScreenId)!;
    const duplicatedNotes = noteParagraphs(duplicatedContent, restoredScreenId);
    expect(duplicatedNotes).toHaveLength(3);
    expect(
      duplicatedContent.slice(
        duplicatedNotes[2]!.source!.start,
        duplicatedNotes[2]!.source!.end,
      ),
    ).toContain("color: red");

    expect(geometryUndoStackRef.current[0]?.selectionBefore?.activeFileId).toBe(
      survivorScreenId,
    );
    expect(
      geometryUndoStackRef.current[0]?.selectionBefore?.selectedLayerIds,
    ).toEqual([survivorTarget.id]);
    expect(selectionUndoStackRef.current[0]?.before.selectedLayerIds).toEqual([
      survivorTarget.id,
    ]);
    expect(selectionUndoStackRef.current[0]?.after.selectedLayerIds).toEqual([
      noteParagraphs(after, restoredScreenId)[1]?.id,
    ]);
    expect(
      contentHistorySelectionAfterRef.current.get(
        restoredChange as ContentHistoryEntry,
      ),
    ).toMatchObject({
      activeFileId: restoredScreenId,
      selectedLayerIds: [recreatedAfterTarget?.id],
    });
  });

  it("records only successful original deletes and preserves both screens' earlier history", async () => {
    const deletedScreen: DesignFile = {
      id: "screen-delete-success",
      filename: "success.html",
      content: "<main><p>Success content</p></main>",
      fileType: "html",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    };
    const failedScreen: DesignFile = {
      id: "screen-delete-failed",
      filename: "failed.html",
      content: "<main><p>Current failed content</p></main>",
      fileType: "html",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    };
    const remainingScreen: DesignFile = {
      id: "screen-remaining",
      filename: "remaining.html",
      content: "<main><p>Remaining</p></main>",
      fileType: "html",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    };
    const contentUndoEntries = [
      {
        fileId: deletedScreen.id,
        before: "<main><p>Before success</p></main>",
        after: deletedScreen.content,
      },
      {
        fileId: failedScreen.id,
        before: "<main><p>Before failure</p></main>",
        after: failedScreen.content,
      },
    ] as ContentHistoryChange[];
    const contentRedoEntries = [
      {
        fileId: deletedScreen.id,
        before: "<main><p>Redo before success</p></main>",
        after: deletedScreen.content,
      },
      {
        fileId: failedScreen.id,
        before: "<main><p>Redo before failure</p></main>",
        after: failedScreen.content,
      },
    ] as ContentHistoryChange[];
    const contentUndoSelections = [
      { activeFileId: deletedScreen.id },
      { activeFileId: failedScreen.id },
    ] as GeometryHistorySelection[];
    const contentRedoSelections = [
      { activeFileId: deletedScreen.id },
      { activeFileId: failedScreen.id },
    ] as GeometryHistorySelection[];
    const geometryUndoEntries = [deletedScreen, failedScreen].map((file) => ({
      before: {
        [file.id]: { x: 1, y: 2, width: 300, height: 600, z: 0 },
      },
      after: {
        [file.id]: { x: 3, y: 4, width: 300, height: 600, z: 0 },
      },
    })) as GeometryHistoryEntry[];
    const geometryRedoEntries = [deletedScreen, failedScreen].map((file) => ({
      before: {
        [file.id]: { x: 5, y: 6, width: 300, height: 600, z: 0 },
      },
      after: {
        [file.id]: { x: 7, y: 8, width: 300, height: 600, z: 0 },
      },
    })) as GeometryHistoryEntry[];
    const localUndoEntries = contentUndoEntries.map((entry) => ({ ...entry }));
    const localRedoEntries = contentRedoEntries.map((entry) => ({ ...entry }));
    const historyOrder = [
      "file-content",
      "geometry",
      "file-content",
      "geometry",
    ] as Array<any>;
    const redoOrder = ["file-content", "geometry"] as Array<any>;
    const contentUndoStackRef = ref<ContentHistoryEntry[]>(contentUndoEntries);
    const contentRedoStackRef = ref<ContentHistoryEntry[]>(contentRedoEntries);
    const contentUndoSelectionStackRef = ref(contentUndoSelections);
    const contentRedoSelectionStackRef = ref(contentRedoSelections);
    const geometryUndoStackRef = ref(geometryUndoEntries);
    const geometryRedoStackRef = ref(geometryRedoEntries);
    const localContentUndoStackRef = ref(localUndoEntries);
    const localContentRedoStackRef = ref(localRedoEntries);
    const fileDeletionUndoStackRef = ref<FileDeletionHistoryEntry[]>([]);
    const fileHistoryMutationPendingRef = ref(false);
    const historyOrderRef = ref(historyOrder);
    const redoOrderRef = ref(redoOrder);
    const pendingFailedScreenContent: ClipboardContentLineage = {
      content: failedScreen.content,
      mutationId: 1,
      contentHash: "failed-screen-content-hash",
      origin: "user",
    };
    const latestClipboardMutationContentRef = ref(
      new Map<string, ClipboardContentLineage>([
        [
          deletedScreen.id,
          {
            content: deletedScreen.content,
            mutationId: 1,
            contentHash: "deleted-screen-content-hash",
            origin: "user",
          },
        ],
        [failedScreen.id, pendingFailedScreenContent],
      ]),
    );
    const currentContentByFile = new Map([
      [deletedScreen.id, deletedScreen.content],
      [failedScreen.id, failedScreen.content],
    ]);
    const designDataJsonRef = ref<Record<string, unknown>>({
      canvasFrames: {
        [deletedScreen.id]: { x: 10, y: 20, width: 300, height: 600, z: 0 },
        [failedScreen.id]: { x: 30, y: 40, width: 300, height: 600, z: 1 },
        [remainingScreen.id]: { x: 50, y: 60, width: 300, height: 600, z: 2 },
      },
      screenMetadata: {
        [deletedScreen.id]: { title: "success" },
        [failedScreen.id]: { title: "failed" },
      },
    });
    const initialCanvasFrames = {
      ...(designDataJsonRef.current.canvasFrames as Record<string, unknown>),
    };
    const originalDesignQuery = {
      files: [deletedScreen, failedScreen, remainingScreen],
    };
    const queryClient = {
      getQueryData: vi.fn(() => originalDesignQuery),
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    } as unknown as QueryClient;
    let settleDelete: (
      deleted: DesignFile[],
      failed: DesignFile[],
    ) => void = () => {};
    const settled = new Promise<{
      deleted: DesignFile[];
      failed: DesignFile[];
    }>((resolve) => {
      settleDelete = (deleted, failed) => resolve({ deleted, failed });
    });

    runDeleteFiles(
      {
        activeFile: remainingScreen,
        canvasFrameGeometryById: designDataJsonRef.current
          .canvasFrames as Record<string, any>,
        clearRedoStacks: vi.fn(),
        designDataJsonRef,
        clipboardPasteRedoStackRef: ref([]),
        clipboardPasteUndoStackRef: ref([]),
        contentRedoSelectionStackRef,
        contentRedoStackRef,
        contentUndoSelectionStackRef,
        contentUndoStackRef,
        deleteFileMutation: {
          mutateAsync: vi.fn(
            async ({ id }: { id: string; fileIds?: string[] }) =>
              id === deletedScreen.id
                ? {
                    deleted: true,
                    deletedIds: [deletedScreen.id],
                    deletedFiles: [
                      {
                        ...deletedScreen,
                        geometry: (
                          designDataJsonRef.current.canvasFrames as Record<
                            string,
                            unknown
                          >
                        )[deletedScreen.id],
                        screenMetadata: {
                          title: "success",
                        },
                      },
                    ],
                  }
                : { deleted: false, deletedIds: [] },
          ),
        } as any,
        fileCreationRedoStackRef: ref([]),
        fileCreationUndoStackRef: ref([]),
        fileDeletionUndoStackRef,
        fileHistoryMutationPendingRef,
        files: [deletedScreen, failedScreen, remainingScreen],
        geometryRedoStackRef,
        geometryUndoStackRef,
        historyOrderRef,
        id: "design",
        latestClipboardMutationContentRef,
        localContentRedoStackRef,
        localContentUndoStackRef,
        queryClient,
        redoOrderRef,
        setActiveFileId: vi.fn(),
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        syncUndoRedoState: vi.fn(),
        t: (key: string) => key,
        writeFrameGeometrySnapshot: (geometry: Record<string, unknown>) => {
          designDataJsonRef.current = {
            ...designDataJsonRef.current,
            canvasFrames: geometry,
          };
        },
      },
      [deletedScreen, failedScreen],
      {
        recordDeletionHistory: true,
        onMutationSettled: settleDelete,
      },
    );

    const result = await settled;
    expect(result.deleted.map((file) => file.id)).toEqual([deletedScreen.id]);
    expect(result.failed.map((file) => file.id)).toEqual([failedScreen.id]);
    expect(fileHistoryMutationPendingRef.current).toBe(false);
    expect(designDataJsonRef.current.canvasFrames).toEqual(initialCanvasFrames);
    expect(queryClient.setQueryData).toHaveBeenLastCalledWith(
      ["action", "get-design", { id: "design" }],
      originalDesignQuery,
    );
    expect(fileDeletionUndoStackRef.current).toHaveLength(1);
    expect(
      fileDeletionUndoStackRef.current[0]?.files.map((file) => file.id),
    ).toEqual([deletedScreen.id]);

    expect(contentUndoStackRef.current).toBe(contentUndoEntries);
    expect(contentRedoStackRef.current).toBe(contentRedoEntries);
    expect(contentUndoSelectionStackRef.current).toBe(contentUndoSelections);
    expect(contentRedoSelectionStackRef.current).toBe(contentRedoSelections);
    expect(
      contentUndoStackRef.current.map((entry) =>
        "changes" in entry
          ? entry.changes.map((change) => change.fileId)
          : entry.fileId,
      ),
    ).toEqual([deletedScreen.id, failedScreen.id]);
    expect(localContentUndoStackRef.current).toBe(localUndoEntries);
    expect(localContentRedoStackRef.current).toBe(localRedoEntries);
    expect(geometryUndoStackRef.current).toBe(geometryUndoEntries);
    expect(geometryRedoStackRef.current).toBe(geometryRedoEntries);
    expect(historyOrderRef.current).toEqual([...historyOrder, "file-deleted"]);
    expect(redoOrderRef.current).toBe(redoOrder);

    expect(currentContentByFile.get(failedScreen.id)).toBe(
      failedScreen.content,
    );
    expect(
      latestClipboardMutationContentRef.current.has(deletedScreen.id),
    ).toBe(false);
    expect(latestClipboardMutationContentRef.current.get(failedScreen.id)).toBe(
      pendingFailedScreenContent,
    );
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("restores every local history stack when a non-history delete fails", async () => {
    const file: DesignFile = {
      id: "screen-non-history-failure",
      filename: "non-history-failure.html",
      content: "<main><p>Failure</p></main>",
      fileType: "html",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    };
    const contentChange = {
      fileId: file.id,
      before: "<main><p>Before</p></main>",
      after: file.content,
    } as ContentHistoryChange;
    const selection = {
      activeFileId: file.id,
      overviewSelectedScreenIds: [file.id],
      selectedLayerIds: [],
    } as GeometryHistorySelection;
    const geometryEntry = {
      before: { [file.id]: { x: 1, y: 2, width: 300, height: 600, z: 0 } },
      after: { [file.id]: { x: 3, y: 4, width: 300, height: 600, z: 0 } },
      selectionBefore: selection,
      selectionAfter: selection,
    } as GeometryHistoryEntry;
    const contentUndoStackRef = ref<ContentHistoryEntry[]>([contentChange]);
    const contentRedoStackRef = ref<ContentHistoryEntry[]>([contentChange]);
    const contentUndoSelectionStackRef = ref([selection]);
    const contentRedoSelectionStackRef = ref([selection]);
    const geometryUndoStackRef = ref([geometryEntry]);
    const geometryRedoStackRef = ref([geometryEntry]);
    const localContentUndoStackRef = ref([contentChange]);
    const localContentRedoStackRef = ref([contentChange]);
    const fileCreationEntry = {
      filename: file.filename,
      content: file.content,
      fileType: file.fileType,
    };
    const fileCreationUndoStackRef = ref([fileCreationEntry]);
    const fileCreationRedoStackRef = ref([fileCreationEntry]);
    const fileDeletionEntry = { files: [] } as FileDeletionHistoryEntry;
    const fileDeletionUndoStackRef = ref([fileDeletionEntry]);
    const fileDeletionRedoStackRef = ref([fileDeletionEntry]);
    const historyOrderRef = ref<UndoRedoOrderKind[]>([
      "geometry",
      "file-content",
      "file-created",
    ]);
    const redoOrderRef = ref<UndoRedoOrderKind[]>([
      "geometry",
      "file-content",
      "file-created",
    ]);
    const queryClient = {
      getQueryData: vi.fn(() => ({ files: [file] })),
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    } as unknown as QueryClient;
    const designDataJsonRef = ref<Record<string, unknown>>({
      canvasFrames: {
        [file.id]: { x: 10, y: 20, width: 300, height: 600, z: 0 },
      },
    });
    const initialStacks = {
      contentRedo: contentRedoStackRef.current,
      contentRedoSelection: contentRedoSelectionStackRef.current,
      contentUndo: contentUndoStackRef.current,
      contentUndoSelection: contentUndoSelectionStackRef.current,
      fileCreationRedo: fileCreationRedoStackRef.current,
      fileCreationUndo: fileCreationUndoStackRef.current,
      fileDeletionRedo: fileDeletionRedoStackRef.current,
      fileDeletionUndo: fileDeletionUndoStackRef.current,
      geometryRedo: geometryRedoStackRef.current,
      geometryUndo: geometryUndoStackRef.current,
      historyOrder: historyOrderRef.current,
      localContentRedo: localContentRedoStackRef.current,
      localContentUndo: localContentUndoStackRef.current,
      redoOrder: redoOrderRef.current,
    };

    await runDeleteFiles(
      {
        activeFile: file,
        canvasFrameGeometryById: designDataJsonRef.current
          .canvasFrames as Record<string, any>,
        clearRedoStacks: vi.fn(),
        designDataJsonRef,
        clipboardPasteRedoStackRef: ref([]),
        clipboardPasteUndoStackRef: ref([]),
        contentRedoSelectionStackRef,
        contentRedoStackRef,
        contentUndoSelectionStackRef,
        contentUndoStackRef,
        deleteFileMutation: {
          mutateAsync: vi
            .fn()
            .mockRejectedValue(new Error("temporary failure")),
        } as any,
        fileCreationRedoStackRef,
        fileCreationUndoStackRef,
        fileDeletionUndoStackRef,
        fileHistoryMutationPendingRef: ref(false),
        files: [file],
        geometryRedoStackRef,
        geometryUndoStackRef,
        historyOrderRef,
        id: "design",
        latestClipboardMutationContentRef: ref(new Map()),
        localContentRedoStackRef,
        localContentUndoStackRef,
        queryClient,
        redoOrderRef,
        setActiveFileId: vi.fn(),
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        syncUndoRedoState: vi.fn(),
        t: (key: string) => key,
        writeFrameGeometrySnapshot: vi.fn(),
      },
      [file],
    );

    expect(contentUndoStackRef.current).toBe(initialStacks.contentUndo);
    expect(contentRedoStackRef.current).toBe(initialStacks.contentRedo);
    expect(contentUndoSelectionStackRef.current).toBe(
      initialStacks.contentUndoSelection,
    );
    expect(contentRedoSelectionStackRef.current).toBe(
      initialStacks.contentRedoSelection,
    );
    expect(geometryUndoStackRef.current).toBe(initialStacks.geometryUndo);
    expect(geometryRedoStackRef.current).toBe(initialStacks.geometryRedo);
    expect(localContentUndoStackRef.current).toBe(
      initialStacks.localContentUndo,
    );
    expect(localContentRedoStackRef.current).toBe(
      initialStacks.localContentRedo,
    );
    expect(fileCreationUndoStackRef.current).toBe(
      initialStacks.fileCreationUndo,
    );
    expect(fileCreationRedoStackRef.current).toBe(
      initialStacks.fileCreationRedo,
    );
    expect(fileDeletionUndoStackRef.current).toBe(
      initialStacks.fileDeletionUndo,
    );
    expect(fileDeletionRedoStackRef.current).toBe(
      initialStacks.fileDeletionRedo,
    );
    expect(historyOrderRef.current).toBe(initialStacks.historyOrder);
    expect(redoOrderRef.current).toBe(initialStacks.redoOrder);
  });

  it("preserves unrelated redo history when screen deletion is rejected", async () => {
    const file: DesignFile = {
      id: "screen-delete-rejected",
      filename: "rejected.html",
      content: "<main><p>Rejected</p></main>",
      fileType: "html",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    };
    const contentRedoEntries = [
      {
        fileId: file.id,
        before: "<main><p>Before redo</p></main>",
        after: file.content,
      },
    ] as ContentHistoryChange[];
    const contentRedoSelections = [
      { activeFileId: file.id },
    ] as GeometryHistorySelection[];
    const geometryRedoEntries = [
      {
        before: { [file.id]: { x: 1, y: 2, width: 300, height: 600, z: 0 } },
        after: { [file.id]: { x: 3, y: 4, width: 300, height: 600, z: 0 } },
      },
    ] as GeometryHistoryEntry[];
    const localContentRedoEntries = contentRedoEntries.map((entry) => ({
      ...entry,
    }));
    const redoOrder = ["file-content", "geometry"] as Array<any>;
    const contentRedoStackRef = ref<ContentHistoryEntry[]>(contentRedoEntries);
    const contentRedoSelectionStackRef = ref(contentRedoSelections);
    const geometryRedoStackRef = ref(geometryRedoEntries);
    const localContentRedoStackRef = ref(localContentRedoEntries);
    const fileCreationRedoStackRef = ref([]);
    const clipboardPasteRedoStackRef = ref<ContentHistoryChange[]>([]);
    const redoOrderRef = ref(redoOrder);
    const clearRedoStacks = vi.fn(() => {
      contentRedoStackRef.current = [];
      contentRedoSelectionStackRef.current = [];
      geometryRedoStackRef.current = [];
      fileCreationRedoStackRef.current = [];
      clipboardPasteRedoStackRef.current = [];
      redoOrderRef.current = [];
    });
    const fileHistoryMutationPendingRef = ref(false);
    const previousSelectedElement = {
      selector: "#rejected-screen",
      sourceId: "rejected-screen-layer",
    } as ElementInfo;
    const selectedElementRef = ref<ElementInfo | null>(previousSelectedElement);
    const selectedLayerIdsRef = ref(["rejected-screen-layer"]);
    const overviewSelectedScreenIdsRef = ref([file.id]);
    const designDataJsonRef = ref<Record<string, unknown>>({
      canvasFrames: {
        [file.id]: { x: 10, y: 20, width: 300, height: 600, z: 0 },
      },
    });
    const originalDesignQuery = { files: [file] };
    const queryClient = {
      getQueryData: vi.fn(() => originalDesignQuery),
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    } as unknown as QueryClient;

    await runDeleteFiles(
      {
        activeFile: file,
        canvasFrameGeometryById: designDataJsonRef.current
          .canvasFrames as Record<string, any>,
        clearRedoStacks,
        designDataJsonRef,
        clipboardPasteRedoStackRef,
        clipboardPasteUndoStackRef: ref([]),
        contentRedoSelectionStackRef,
        contentRedoStackRef,
        contentUndoSelectionStackRef: ref([]),
        contentUndoStackRef: ref([]),
        deleteFileMutation: {
          mutateAsync: vi.fn(async () => ({
            deleted: false,
            deletedIds: [],
          })),
        } as any,
        fileCreationRedoStackRef,
        fileCreationUndoStackRef: ref([]),
        fileDeletionUndoStackRef: ref([]),
        fileHistoryMutationPendingRef,
        files: [file],
        geometryRedoStackRef,
        geometryUndoStackRef: ref([]),
        historyOrderRef: ref(["file-content"]),
        id: "design",
        latestClipboardMutationContentRef: ref(new Map()),
        localContentRedoStackRef,
        localContentUndoStackRef: ref([]),
        queryClient,
        redoOrderRef,
        overviewSelectedScreenIds: overviewSelectedScreenIdsRef.current,
        selectedElement: selectedElementRef.current,
        selectedLayerIdsState: selectedLayerIdsRef.current,
        setActiveFileId: vi.fn(),
        setOverviewSelectedScreenIds: (value) =>
          applySetter(overviewSelectedScreenIdsRef, value),
        setSelectedElement: (value) => applySetter(selectedElementRef, value),
        setSelectedLayerIdsState: (value) =>
          applySetter(selectedLayerIdsRef, value),
        syncUndoRedoState: vi.fn(),
        t: (key: string) => key,
        writeFrameGeometrySnapshot: vi.fn(),
      },
      [file],
      { recordDeletionHistory: true },
    );

    expect(clearRedoStacks).not.toHaveBeenCalled();
    expect(contentRedoStackRef.current).toBe(contentRedoEntries);
    expect(contentRedoSelectionStackRef.current).toBe(contentRedoSelections);
    expect(geometryRedoStackRef.current).toBe(geometryRedoEntries);
    expect(localContentRedoStackRef.current).toBe(localContentRedoEntries);
    expect(redoOrderRef.current).toBe(redoOrder);
    expect(fileHistoryMutationPendingRef.current).toBe(false);
    expect(selectedElementRef.current).toBe(previousSelectedElement);
    expect(selectedLayerIdsRef.current).toEqual(["rejected-screen-layer"]);
    expect(overviewSelectedScreenIdsRef.current).toEqual([file.id]);
    expect(queryClient.setQueryData).toHaveBeenLastCalledWith(
      ["action", "get-design", { id: "design" }],
      originalDesignQuery,
    );
  });
});
