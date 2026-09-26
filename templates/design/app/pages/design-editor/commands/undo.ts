import { useActionMutation } from "@agent-native/core/client/hooks";
import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { type CodeLayerNode } from "@shared/code-layer";
import { sourceContentHash } from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import { isShaderWriteInFlight } from "@/components/design/inspector/GlslShaderPanel";
import type { ElementInfo } from "@/components/design/types";
import type {
  ClipboardContentMutationOrigin,
  ClipboardContentMutationPublication,
} from "@/lib/clipboard-content-lineage";
import {
  refreshElementInfoFromContent,
  refreshSelectedLayerIdsFromContent,
} from "@/pages/design-editor/code-layer-state";
import { writeCollabText } from "@/pages/design-editor/collab-sync";
import type { LiveScreenSnapshot } from "@/pages/design-editor/command-types";
import type { ApplyFileContentUpdateResult } from "@/pages/design-editor/commands/apply-file-content-update";
import type { ApplyLocalContentUpdateResult } from "@/pages/design-editor/commands/apply-local-content-update";
import { prepareContentHistoryReplay } from "@/pages/design-editor/commands/prepare-content-history-replay";
import type { DesignDataOperation } from "@/pages/design-editor/data-operations";
import {
  getCanvasFrameGeometry,
  getDesignDataRecord,
  staleGeometryFrameIds,
  viewportChangedFrameIds,
} from "@/pages/design-editor/design-data-geometry-utils";
import { TAB_ID } from "@/pages/design-editor/editor-session";
import type {
  PreviewContentReplaceResult,
  UndoRedoOrderKind,
} from "@/pages/design-editor/editor-state";
import { previewContentReplaceNeedsRenderFallback } from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryChange,
  ContentHistoryEntry,
  ContentHistorySelectionAfterMap,
  FileCreationHistoryEntry,
  FileDeletionHistoryEntry,
  FileDeletionHistorySnapshot,
  GeometryHistoryEntry,
  GeometryHistorySelection,
  SelectionHistoryEntry,
} from "@/pages/design-editor/history";
import {
  MAX_DESIGN_UNDO_STACK,
  filterFileDeletionHistoryEntry,
  applyGeometryHistoryDiff,
  findLastContentHistoryChangeIndex,
  partitionContentHistoryEntry,
  contentHistoryEntryFromChanges,
  readYjsUndoSelection,
  remapFileDeletionHistoryEntryIds,
  restoreFileContentHistoryOrderToken,
} from "@/pages/design-editor/history";
import {
  prepareDeletedFileRestore,
  remapHistorySelection,
  remapHistoryChange,
  remapContentHistory,
  remapGeometryHistory,
  resolveHistorySelection,
  resolveLocalHistorySelection,
} from "@/pages/design-editor/history-identity";
import type {
  PendingLiveNonStyleEdit,
  PendingLiveNonStyleUndoEntry,
  PendingVisualStyleEdit,
  PendingVisualStyleUndoEntry,
} from "@/pages/design-editor/pending-edits";
import {
  mergePendingLiveNonStyleEdits,
  pendingLiveNonStyleEditsFromUndoStack,
  pendingLiveStructureEditsFromUndoEntry,
  mergePendingVisualStyleEdits,
  pendingVisualStyleEditsFromUndoStack,
  pendingVisualStyleUndoTargets,
} from "@/pages/design-editor/pending-edits";
import { pendingEditTargetsSelectedElement } from "@/pages/design-editor/selection-state";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function variantScreenId(screen: unknown): string | null {
  if (typeof screen === "string") return screen;
  if (isRecord(screen) && typeof screen.id === "string") return screen.id;
  return null;
}

function sameStringList(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function fileDeletionMetadataRestoreChanges(
  entry: FileDeletionHistoryEntry,
  recreatedEntry: FileDeletionHistoryEntry,
  currentDesignData: Record<string, unknown>,
  missingFileIds: ReadonlySet<string> = new Set(),
): { changes: ContentHistoryChange[]; skippedVariantMemberships: boolean } {
  const changes: ContentHistoryChange[] = [];
  const retainedIds = new Set(
    entry.files
      .filter((file, index) => file.id === recreatedEntry.files[index]?.id)
      .map((file) => file.id),
  );
  const deletedIds = new Set([
    ...entry.files
      .filter((file) => !retainedIds.has(file.id))
      .map((file) => file.id),
    ...missingFileIds,
  ]);
  const currentScreenMetadata = getDesignDataRecord(
    currentDesignData,
    "screenMetadata",
  );
  const currentLocalhostScreens = getDesignDataRecord(
    currentDesignData,
    "localhostScreens",
  );
  const variantGroups = new Map<
    string,
    {
      originalScreenIds: string[];
      set: Record<string, unknown>;
      memberships: Array<{ oldId: string; screen: unknown; index: number }>;
      conflict: boolean;
    }
  >();
  let skippedVariantMemberships = false;

  entry.files.forEach((file, index) => {
    const recreatedFile = recreatedEntry.files[index];
    if (!recreatedFile) return;
    const operations: DesignDataOperation[] = [];
    if (
      !retainedIds.has(file.id) &&
      Object.prototype.hasOwnProperty.call(currentScreenMetadata, file.id)
    ) {
      operations.push({ op: "delete", path: ["screenMetadata", file.id] });
    }
    if (
      !retainedIds.has(file.id) &&
      Object.prototype.hasOwnProperty.call(currentLocalhostScreens, file.id)
    ) {
      operations.push({ op: "delete", path: ["localhostScreens", file.id] });
    }
    if (file.screenMetadata) {
      operations.push({
        op: "set",
        path: ["screenMetadata", recreatedFile.id],
        value:
          retainedIds.has(file.id) &&
          Object.prototype.hasOwnProperty.call(currentScreenMetadata, file.id)
            ? currentScreenMetadata[file.id]
            : file.screenMetadata,
      });
    }
    if (file.localhostScreen) {
      operations.push({
        op: "set",
        path: ["localhostScreens", recreatedFile.id],
        value:
          retainedIds.has(file.id) &&
          Object.prototype.hasOwnProperty.call(currentLocalhostScreens, file.id)
            ? currentLocalhostScreens[file.id]
            : file.localhostScreen,
      });
    }
    if (operations.length > 0) {
      changes.push({
        fileId: recreatedFile.id,
        before: file.content,
        after: file.content,
        designDataChange: { undo: operations, redo: [] },
      });
    }

    file.variantMemberships?.forEach((membership, membershipIndex) => {
      const recreatedMembership =
        recreatedFile.variantMemberships?.[membershipIndex];
      if (!recreatedMembership) {
        skippedVariantMemberships = true;
        return;
      }
      const group = variantGroups.get(membership.setId);
      if (!group) {
        variantGroups.set(membership.setId, {
          originalScreenIds: membership.originalScreenIds,
          set: membership.set,
          memberships: [
            {
              oldId: file.id,
              screen: recreatedMembership.screen,
              index: membership.index,
            },
          ],
          conflict: false,
        });
      } else {
        if (
          !sameStringList(group.originalScreenIds, membership.originalScreenIds)
        ) {
          group.conflict = true;
        }
        group.memberships.push({
          oldId: file.id,
          screen: recreatedMembership.screen,
          index: membership.index,
        });
      }
    });
  });

  const variantSets = getDesignDataRecord(
    currentDesignData,
    "designVariantSets",
  );
  const variantOperations: DesignDataOperation[] = [];
  for (const [setId, group] of variantGroups) {
    const currentSet = variantSets[setId];
    if (group.conflict) {
      skippedVariantMemberships = true;
      continue;
    }
    const expectedCurrentIds = group.originalScreenIds.filter(
      (screenId) => !deletedIds.has(screenId),
    );
    if (currentSet === undefined) {
      if (
        expectedCurrentIds.filter((screenId) => !retainedIds.has(screenId))
          .length <= 1 &&
        Array.isArray(group.set.screens)
      ) {
        const recreatedScreensByOldId = new Map(
          group.memberships.map((membership) => [
            membership.oldId,
            membership.screen,
          ]),
        );
        const screens = group.set.screens
          .filter(
            (screen) => !missingFileIds.has(variantScreenId(screen) ?? ""),
          )
          .map((screen) => {
            const oldId = variantScreenId(screen);
            return oldId
              ? (recreatedScreensByOldId.get(oldId) ?? screen)
              : screen;
          });
        if (screens.length > 1) {
          variantOperations.push({
            op: "set",
            path: ["designVariantSets", setId],
            value: { ...group.set, screens },
          });
        }
      } else {
        skippedVariantMemberships = true;
      }
      continue;
    }
    if (!isRecord(currentSet) || !Array.isArray(currentSet.screens)) {
      skippedVariantMemberships = true;
      continue;
    }
    const currentScreenIds = currentSet.screens.map(variantScreenId);
    if (currentScreenIds.some((screenId) => screenId === null)) {
      skippedVariantMemberships = true;
      continue;
    }

    const currentIds = currentScreenIds as string[];
    const recreatedScreensByOldId = new Map(
      group.memberships.map((membership) => [
        membership.oldId,
        membership.screen,
      ]),
    );
    let nextScreens: unknown[];
    if (sameStringList(currentIds, expectedCurrentIds)) {
      nextScreens = [...currentSet.screens];
      for (const membership of group.memberships.sort(
        (left, right) => left.index - right.index,
      )) {
        if (currentIds.includes(variantScreenId(membership.screen) ?? ""))
          continue;
        if (variantScreenId(membership.screen) === null) {
          skippedVariantMemberships = true;
          continue;
        }
        const index = Math.max(
          0,
          Math.min(
            group.originalScreenIds
              .slice(0, membership.index)
              .filter((screenId) => !missingFileIds.has(screenId)).length,
            nextScreens.length,
          ),
        );
        nextScreens.splice(index, 0, membership.screen);
      }
    } else if (sameStringList(currentIds, group.originalScreenIds)) {
      nextScreens = currentSet.screens
        .filter((screen) => !missingFileIds.has(variantScreenId(screen) ?? ""))
        .map((screen) => {
          const oldId = variantScreenId(screen);
          return oldId
            ? (recreatedScreensByOldId.get(oldId) ?? screen)
            : screen;
        });
    } else {
      skippedVariantMemberships = true;
      continue;
    }

    if (expectedCurrentIds.length <= 1) {
      variantOperations.push({
        op: "set",
        path: ["designVariantSets", setId],
        value: { ...currentSet, screens: nextScreens },
      });
    } else {
      variantOperations.push({
        op: "set",
        path: ["designVariantSets", setId, "screens"],
        value: nextScreens,
      });
    }
  }

  if (variantOperations.length > 0) {
    const firstFile = recreatedEntry.files[0];
    if (firstFile) {
      changes.push({
        fileId: firstFile.id,
        before: firstFile.content,
        after: firstFile.content,
        designDataChange: { undo: variantOperations, redo: [] },
      });
    }
  }

  return { changes, skippedVariantMemberships };
}

export interface UndoArgs {
  activeEditorDragRef: RefObject<boolean>;
  activeFile: DesignFile;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyFileContentUpdateResult;
  applyGeometryHistoryContentChanges?: (
    changes: readonly ContentHistoryChange[],
    direction: "undo" | "redo",
  ) => void;
  applyLocalContentUpdate: (
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      immediateSave?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyLocalContentUpdateResult;
  applyDesignDataHistoryChanges?: (
    changes: readonly ContentHistoryChange[],
    direction: "undo" | "redo",
  ) => boolean;
  canEditDesign: boolean;
  allowPendingLiveEdits?: boolean;
  clipboardPasteRedoStackRef: RefObject<ContentHistoryChange[]>;
  clipboardPasteUndoStackRef: RefObject<ContentHistoryChange[]>;
  /** Flat ownership map (DesignEditor.tsx's `codeLayerOwnerByNodeIdRef`) used
   * only to derive the on-canvas `selectedElement` a restored selection-only
   * entry implies — see `elementInfoForSelectionSnapshot`'s doc comment. */
  codeLayerOwnerByNodeIdRef: RefObject<Map<string, { node: CodeLayerNode }>>;
  contentHistorySelectionAfterRef: RefObject<ContentHistorySelectionAfterMap>;
  contentRedoSelectionStackRef: RefObject<
    (GeometryHistorySelection | undefined)[]
  >;
  contentRedoStackRef: RefObject<ContentHistoryEntry[]>;
  contentUndoSelectionStackRef: RefObject<
    (GeometryHistorySelection | undefined)[]
  >;
  contentUndoStackRef: RefObject<ContentHistoryEntry[]>;
  createFileMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "create-file">
  >;
  optimisticallyInsertCreatedFile?: (args: {
    fileId: string;
    filename: string;
    fileType: DesignFile["fileType"];
    content: string;
    result?: Record<string, unknown> | null;
  }) => void;
  deleteFileMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "delete-file">
  >;
  designDataJsonRef: RefObject<Record<string, unknown>>;
  fileCreationRedoStackRef: RefObject<FileCreationHistoryEntry[]>;
  fileCreationUndoStackRef: RefObject<FileCreationHistoryEntry[]>;
  fileDeletionRedoStackRef: RefObject<FileDeletionHistoryEntry[]>;
  fileDeletionUndoStackRef: RefObject<FileDeletionHistoryEntry[]>;
  fileHistoryMutationPendingRef: RefObject<boolean>;
  clearPendingHistory?: () => void;
  files: DesignFile[];
  filesRef?: RefObject<DesignFile[]>;
  geometryRedoStackRef: RefObject<GeometryHistoryEntry[]>;
  geometryUndoStackRef: RefObject<GeometryHistoryEntry[]>;
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
  historyOrderRef: RefObject<(UndoRedoOrderKind | "selection")[]>;
  id: string | undefined;
  isSynced: boolean;
  lastLocalContentRef: RefObject<string | null>;
  resetGeometryCommitCoalescing?: () => void;
  liveFrameGeometryRef: RefObject<CanvasFrameGeometryById>;
  liveScreenSnapshotsById: Record<string, LiveScreenSnapshot>;
  localContentRedoStackRef: RefObject<ContentHistoryChange[]>;
  localContentUndoStackRef: RefObject<ContentHistoryChange[]>;
  markPendingLocalFileContent: (
    fileId: string,
    content: string,
    baseUpdatedAt?: string | null,
  ) => void;
  pendingLiveNonStyleEditsRef: RefObject<PendingLiveNonStyleEdit[]>;
  pendingLiveNonStyleRedoStackRef: RefObject<PendingLiveNonStyleUndoEntry[]>;
  pendingLiveNonStyleUndoStackRef: RefObject<PendingLiveNonStyleUndoEntry[]>;
  pendingLocalFileContentsRef: RefObject<
    Map<
      string,
      { content: string; startedAt: number; baseUpdatedAt?: string | null }
    >
  >;
  pendingVisualStyleEditsRef: RefObject<PendingVisualStyleEdit[]>;
  pendingVisualStyleRedoStackRef: RefObject<PendingVisualStyleUndoEntry[]>;
  pendingVisualStyleUndoStackRef: RefObject<PendingVisualStyleUndoEntry[]>;
  performDeleteFiles: (
    filesToDelete: DesignFile[],
    options?: {
      skipFileCreationRedoPrune?: boolean;
      recordDeletionHistory?: boolean;
      preserveHistory?: boolean;
      onMutationSettled?: (
        deletedFiles: DesignFile[],
        failedFiles: DesignFile[],
        deletedFileSnapshots: FileDeletionHistorySnapshot[],
      ) => void;
    },
  ) => void;
  publishAuthoritativeClipboardMutation: (args: {
    fileId: string;
    baseContent: string;
    nextContent: string;
    origin: ClipboardContentMutationOrigin;
    baseSource?: "lineage" | "document";
  }) => ClipboardContentMutationPublication | null;
  queryClient: QueryClient;
  queueFileContentSave: (
    fileId: string,
    content: string,
    options: {
      expectedVersionHash: string;
      syncCollab?: boolean;
      immediate?: boolean;
    },
  ) => void;
  redoOrderRef: RefObject<(UndoRedoOrderKind | "selection")[]>;
  replacePreviewContent: (
    nextContent: string,
    selector?: string | null,
    options?: { forceFullDocument?: boolean },
  ) => PreviewContentReplaceResult;
  requestPendingLiveNonStyleRevert: (
    edits: readonly PendingLiveNonStyleEdit[],
  ) => void;
  requestPendingVisualStyleRevert: (
    edits: readonly PendingVisualStyleEdit[],
  ) => void;
  restoreSelectionSnapshot: (
    selection: GeometryHistorySelection | undefined,
  ) => void;
  selectionRedoStackRef: RefObject<SelectionHistoryEntry[]>;
  selectionUndoStackRef: RefObject<SelectionHistoryEntry[]>;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setContentRenderRevision: Dispatch<SetStateAction<number>>;
  setHoveredElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setPendingLiveNonStyleEdits: Dispatch<
    SetStateAction<PendingLiveNonStyleEdit[]>
  >;
  setPendingVisualStyleEdits: Dispatch<
    SetStateAction<PendingVisualStyleEdit[]>
  >;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  suppressContentHistoryRef: RefObject<boolean>;
  syncLiveScreenSnapshotPreview: (screenId: string, html: string) => void;
  syncUndoRedoState: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  undoManagerRef: RefObject<Y.UndoManager | null>;
  updateLiveScreenSnapshotContent: (
    screenId: string,
    html: string,
    options?: { recordHistory?: boolean },
  ) => boolean;
  viewModeRef: RefObject<"single" | "overview">;
  writeFrameGeometrySnapshot: (
    geometryById: CanvasFrameGeometryById,
    options?: {
      replacePendingGeometrySave?: boolean;
      syncViewportFrameIds?: string[];
      pinHeightFrameIds?: string[];
    },
  ) => void;
  ydoc: Y.Doc | null;
}

export function runUndo({
  activeEditorDragRef,
  activeFile,
  applyFileContentUpdate,
  applyGeometryHistoryContentChanges,
  applyLocalContentUpdate,
  applyDesignDataHistoryChanges,
  canEditDesign,
  allowPendingLiveEdits,
  clipboardPasteRedoStackRef,
  clipboardPasteUndoStackRef,
  codeLayerOwnerByNodeIdRef,
  contentHistorySelectionAfterRef,
  contentRedoSelectionStackRef,
  contentRedoStackRef,
  contentUndoSelectionStackRef,
  contentUndoStackRef,
  createFileMutation,
  optimisticallyInsertCreatedFile,
  deleteFileMutation,
  designDataJsonRef,
  fileCreationRedoStackRef,
  fileCreationUndoStackRef,
  fileDeletionRedoStackRef,
  fileDeletionUndoStackRef,
  fileHistoryMutationPendingRef,
  clearPendingHistory,
  files,
  filesRef,
  geometryRedoStackRef,
  geometryUndoStackRef,
  getFreshActiveContent,
  getScreenContent,
  historyOrderRef,
  id,
  isSynced,
  lastLocalContentRef,
  resetGeometryCommitCoalescing,
  liveFrameGeometryRef,
  liveScreenSnapshotsById,
  localContentRedoStackRef,
  localContentUndoStackRef,
  markPendingLocalFileContent,
  pendingLiveNonStyleEditsRef,
  pendingLiveNonStyleRedoStackRef,
  pendingLiveNonStyleUndoStackRef,
  pendingLocalFileContentsRef,
  pendingVisualStyleEditsRef,
  pendingVisualStyleRedoStackRef,
  pendingVisualStyleUndoStackRef,
  performDeleteFiles,
  publishAuthoritativeClipboardMutation,
  queryClient,
  queueFileContentSave,
  redoOrderRef,
  replacePreviewContent,
  requestPendingLiveNonStyleRevert,
  requestPendingVisualStyleRevert,
  restoreSelectionSnapshot,
  selectionRedoStackRef,
  selectionUndoStackRef,
  setActiveFileId,
  setContentRenderRevision,
  setHoveredElement,
  setOverviewSelectedScreenIds,
  setPendingLiveNonStyleEdits,
  setPendingVisualStyleEdits,
  setSelectedElement,
  setSelectedLayerIdsState,
  suppressContentHistoryRef,
  syncLiveScreenSnapshotPreview,
  syncUndoRedoState,
  t,
  undoManagerRef,
  updateLiveScreenSnapshotContent,
  viewModeRef,
  writeFrameGeometrySnapshot,
  ydoc,
}: UndoArgs) {
  const restoreHistorySelection = (
    selection: GeometryHistorySelection | undefined,
    replaySources: Record<string, string> = {},
  ) => {
    const currentFiles = filesRef?.current ?? files;
    const actualSources = Object.fromEntries(
      currentFiles.map((file) => [
        file.id,
        replaySources[file.id] ?? getScreenContent(file.id),
      ]),
    );
    const resolved = resolveHistorySelection(
      selection,
      actualSources,
      replaySources,
    );
    restoreSelectionSnapshot(resolved.selection);
    if (selection) setSelectedElement(resolved.element);
  };
  trace("history", "undo", {});
  if (!canEditDesign && !allowPendingLiveEdits) return;
  // U10: an in-progress drag hasn't been committed yet (onGeometryCommit /
  // the content update fires on drag END), so undoing mid-drag would pop a
  // PRIOR entry while the live-but-uncommitted drag is still moving the
  // element — the drag's eventual commit would then stomp the undo. Block
  // until the drag finishes (or is cancelled).
  if (activeEditorDragRef.current) return;
  if (fileHistoryMutationPendingRef.current) return;
  resetGeometryCommitCoalescing?.();
  const pendingStyleUndoStack = pendingVisualStyleUndoStackRef.current;
  const pendingStyleUndo =
    pendingStyleUndoStack[pendingStyleUndoStack.length - 1];
  const pendingNonStyleUndoStack = pendingLiveNonStyleUndoStackRef.current;
  const pendingNonStyleUndo =
    pendingNonStyleUndoStack[pendingNonStyleUndoStack.length - 1];
  const pendingHistoryKind =
    historyOrderRef.current[historyOrderRef.current.length - 1];
  const pendingUndoKind =
    pendingHistoryKind === "pending-style" ||
    pendingHistoryKind === "pending-live"
      ? pendingHistoryKind
      : undefined;
  if (!canEditDesign && !pendingStyleUndo && !pendingNonStyleUndo) return;
  if (
    (pendingUndoKind === "pending-style" && !pendingStyleUndo) ||
    (pendingUndoKind === "pending-live" && !pendingNonStyleUndo)
  ) {
    return;
  }
  const consumePendingUndoOrder = (kind: "pending-style" | "pending-live") => {
    if (historyOrderRef.current[historyOrderRef.current.length - 1] !== kind) {
      return;
    }
    historyOrderRef.current = historyOrderRef.current.slice(0, -1);
    redoOrderRef.current = [
      ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      kind,
    ];
  };
  if (
    pendingNonStyleUndo &&
    (pendingUndoKind === "pending-live" ||
      (pendingHistoryKind === undefined &&
        (!pendingStyleUndo ||
          pendingNonStyleUndo.edit.updatedAt >
            pendingStyleUndo.edit.updatedAt)))
  ) {
    const nextUndoStack = pendingNonStyleUndoStack.slice(0, -1);
    pendingLiveNonStyleUndoStackRef.current = nextUndoStack;
    const nextPending = mergePendingLiveNonStyleEdits(
      pendingLiveNonStyleEditsFromUndoStack(nextUndoStack),
    );
    pendingLiveNonStyleEditsRef.current = nextPending;
    pendingLiveNonStyleRedoStackRef.current = [
      ...pendingLiveNonStyleRedoStackRef.current,
      pendingNonStyleUndo,
    ];
    requestPendingLiveNonStyleRevert(
      pendingNonStyleUndo.kind === "text"
        ? [
            {
              ...pendingNonStyleUndo.edit,
              originalValue: pendingNonStyleUndo.revertValue,
              originalHtml: pendingNonStyleUndo.revertHtml,
            },
          ]
        : pendingNonStyleUndo.kind === "layer-state"
          ? [
              {
                ...pendingNonStyleUndo.edit,
                originalEnabled: pendingNonStyleUndo.revertEnabled,
              },
            ]
          : pendingNonStyleUndo.kind === "layer-name"
            ? [
                {
                  ...pendingNonStyleUndo.edit,
                  originalName: pendingNonStyleUndo.revertName,
                },
              ]
            : pendingLiveStructureEditsFromUndoEntry(pendingNonStyleUndo),
    );
    setPendingLiveNonStyleEdits(nextPending);
    // Bug fix — undo reverted the DOM via requestPendingLiveNonStyleRevert
    // above but never resynced the inspector panel's selectedElement, so
    // the right panel kept showing pre-undo text until deselect/reselect.
    // Mirrors recordPendingVisualStyleEdit's direct object-patch resync
    // (~line 9514): a plain merge of the revert payload already on this
    // undo entry, not a DOM re-query or content-string rebuild (those
    // don't exist for pending live edits, which never touch
    // ydoc/activeFile.content).
    if (
      pendingNonStyleUndo.kind === "text" &&
      pendingNonStyleUndo.edit.screenId === activeFile?.id
    ) {
      const { sourceId: revertedSourceId, selector: revertedSelector } =
        pendingNonStyleUndo.edit;
      const { revertValue, revertHtml } = pendingNonStyleUndo;
      setSelectedElement((prev) => {
        if (!prev) return prev;
        if (
          !pendingEditTargetsSelectedElement({
            editSourceId: revertedSourceId,
            editSelector: revertedSelector,
            selectedSourceId: prev.sourceId,
            selectedSelector: prev.selector,
          })
        ) {
          return prev;
        }
        return {
          ...prev,
          textContent: revertValue,
          htmlContent: revertHtml ?? prev.htmlContent,
        };
      });
    }
    consumePendingUndoOrder("pending-live");
    syncUndoRedoState();
    return;
  }
  if (
    pendingStyleUndo &&
    (pendingUndoKind === "pending-style" || pendingHistoryKind === undefined)
  ) {
    const nextUndoStack = pendingStyleUndoStack.slice(0, -1);
    pendingVisualStyleUndoStackRef.current = nextUndoStack;
    const nextPending = mergePendingVisualStyleEdits(
      pendingVisualStyleEditsFromUndoStack(nextUndoStack),
    );
    pendingVisualStyleEditsRef.current = nextPending;
    pendingVisualStyleRedoStackRef.current = [
      ...pendingVisualStyleRedoStackRef.current,
      pendingStyleUndo,
    ];
    const revertedTargets = pendingVisualStyleUndoTargets(pendingStyleUndo);
    requestPendingVisualStyleRevert(
      revertedTargets.map(({ edit, revertStyles }) => ({
        ...edit,
        originalStyles: revertStyles,
      })),
    );
    setPendingVisualStyleEdits(nextPending);
    // Bug fix — same stale-inspector-panel issue as the pendingNonStyleUndo
    // branch above, for style undo. Merge the reverted style values
    // (already computed as pendingStyleUndo.revertStyles) into
    // selectedElement.computedStyles, guarded to the currently-selected
    // element so an undo on a different/background screen doesn't
    // clobber the panel for whatever the user has selected right now.
    setSelectedElement((prev) => {
      if (!prev) return prev;
      const revertedTarget = revertedTargets.find(
        ({ edit }) =>
          edit.screenId === activeFile?.id &&
          pendingEditTargetsSelectedElement({
            editSourceId: edit.sourceId,
            editSelector: edit.selector,
            selectedSourceId: prev.sourceId,
            selectedSelector: prev.selector,
          }),
      );
      if (!revertedTarget) return prev;
      const { edit, revertStyles } = revertedTarget;
      const revertedStyles = edit.interactionState
        ? Object.fromEntries(
            Object.entries(revertStyles).map(([property, value]) => [
              property,
              value || edit.baseStyles?.[property] || "",
            ]),
          )
        : revertStyles;
      return {
        ...prev,
        computedStyles: {
          ...prev.computedStyles,
          ...revertedStyles,
        },
      };
    });
    consumePendingUndoOrder("pending-style");
    syncUndoRedoState();
    return;
  }
  const undoClipboardPaste = () => {
    if (
      historyOrderRef.current[historyOrderRef.current.length - 1] !==
      "clipboard-paste"
    ) {
      return false;
    }
    const clipboardPasteUndo =
      clipboardPasteUndoStackRef.current[
        clipboardPasteUndoStackRef.current.length - 1
      ];
    if (!clipboardPasteUndo) return false;
    const currentContent =
      pendingLocalFileContentsRef.current.get(clipboardPasteUndo.fileId)
        ?.content ??
      (clipboardPasteUndo.fileId === activeFile?.id
        ? getFreshActiveContent()
        : (getScreenContent(clipboardPasteUndo.fileId) ?? ""));
    // A newer history token stays ahead of this paste; if the current
    // document no longer matches it, keep this top token intact.
    if (currentContent !== clipboardPasteUndo.after) return false;
    if (isShaderWriteInFlight(clipboardPasteUndo.fileId)) {
      toast.error(t("designEditor.toasts.saveConflict"), {
        id: `design-source-shader-conflict:${clipboardPasteUndo.fileId}`,
      });
      return false;
    }
    const clipboardMutation = publishAuthoritativeClipboardMutation({
      fileId: clipboardPasteUndo.fileId,
      baseContent: clipboardPasteUndo.after,
      nextContent: clipboardPasteUndo.before,
      origin: "clipboard-undo",
      baseSource: "document",
    });
    if (!clipboardMutation) return false;
    const writeResult =
      clipboardPasteUndo.fileId === activeFile?.id
        ? applyLocalContentUpdate(clipboardPasteUndo.before, {
            recordHistory: false,
            forcePreviewFullDocument: true,
            immediateSave: true,
            clipboardMutation,
          })
        : applyFileContentUpdate(
            clipboardPasteUndo.fileId,
            clipboardPasteUndo.before,
            {
              recordHistory: false,
              forcePreviewFullDocument: true,
              clipboardMutation,
            },
          );
    if (writeResult.status !== "accepted") return false;
    clipboardPasteUndoStackRef.current =
      clipboardPasteUndoStackRef.current.slice(0, -1);
    clipboardPasteRedoStackRef.current = [
      ...clipboardPasteRedoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      clipboardPasteUndo,
    ];
    historyOrderRef.current = historyOrderRef.current.slice(0, -1);
    redoOrderRef.current = [
      ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "clipboard-paste",
    ];
    if (clipboardPasteUndo.fileId === activeFile.id) {
      const selection = clipboardPasteUndo.selectionBefore
        ? resolveLocalHistorySelection(
            clipboardPasteUndo.selectionBefore,
            clipboardPasteUndo.fileId,
            clipboardPasteUndo.before,
          )
        : undefined;
      const source = {
        kind: "design-file" as const,
        fileId: clipboardPasteUndo.fileId,
      };
      setSelectedElement((previous) =>
        selection
          ? selection.selectedElement
          : previous
            ? refreshElementInfoFromContent(
                clipboardPasteUndo.before,
                previous,
                source,
              )
            : previous,
      );
      setSelectedLayerIdsState((previous) =>
        selection
          ? selection.selectedLayerIds
          : refreshSelectedLayerIdsFromContent(
              clipboardPasteUndo.before,
              previous,
              source,
            ),
      );
    }
    return true;
  };
  const um = undoManagerRef.current;
  const canUseOverviewHistory = viewModeRef.current === "overview";
  let prunedUndoHistory = 0;
  let contentReplayRefused = false;
  const undoContent = (scope: "any" | "local" | "global" = "any") => {
    if (scope !== "global" && um?.canUndo()) {
      const beforeUndoContent = ydoc?.getText("content").toJSON() ?? null;
      const poppedItem = um.undo();
      // Figma-parity undo selection restore: a gesture (see
      // stampYjsUndoSelection) stamps the selection it started with onto
      // this exact stack item. When present it overrides the
      // refresh-from-content heuristic below, which can only ever keep or
      // drop whatever is CURRENTLY selected — for a delete or an alt-drag
      // duplicate, that's the very node undo just removed, so the heuristic
      // alone always lands on empty, never back on the original selection.
      const restoredSelection = readYjsUndoSelection(poppedItem);
      if (ydoc && activeFile && beforeUndoContent !== null) {
        const ytext = ydoc.getText("content");
        const rawNext = ytext.toJSON();
        let next = rawNext;
        try {
          next = prepareCanonicalSourceContent(rawNext, {
            fileId: activeFile.id,
            fileType: activeFile.fileType,
          }).content;
        } catch {
          toast.error(t("common.genericError"), {
            id: `design-source-identity:${activeFile.id}`,
          });
          return false;
        }
        if (next !== rawNext) writeCollabText(ydoc, ytext, next, TAB_ID);
        markPendingLocalFileContent(activeFile.id, next, activeFile.updatedAt);
        lastLocalContentRef.current = next;
        queueFileContentSave(activeFile.id, next, {
          expectedVersionHash: sourceContentHash(beforeUndoContent),
          syncCollab: !(ydoc && isSynced),
        });
        // Holistic flash pipeline: only fall back to a full srcdoc rebuild
        // (real iframe reload) when the live in-place patch genuinely
        // failed — replaceRuntimeDocument's forceFullDocument branch already
        // swaps content inside the SAME live iframe (no navigation), so
        // bumping contentRenderRevision unconditionally right after a
        // successful in-place replace was a redundant second reload and the
        // dominant cause of "undo/redo flashes heavily".
        if (
          previewContentReplaceNeedsRenderFallback(
            replacePreviewContent(next, null, {
              forceFullDocument: true,
            }),
          )
        ) {
          setContentRenderRevision((revision) => revision + 1);
        }
        // Clear stale selection if the undo removed the selected element.
        setSelectedElement((prev) => {
          if (restoredSelection)
            return resolveLocalHistorySelection(
              restoredSelection,
              activeFile.id,
              next,
            ).selectedElement;
          if (!prev) return prev;
          return refreshElementInfoFromContent(next, prev, {
            kind: "design-file",
            fileId: activeFile.id,
          });
        });
        setHoveredElement((prev) => {
          if (!prev) return prev;
          return refreshElementInfoFromContent(next, prev, {
            kind: "design-file",
            fileId: activeFile.id,
          });
        });
        // U18: keep the layers-panel highlight in sync too.
        setSelectedLayerIdsState((prev) =>
          restoredSelection
            ? resolveLocalHistorySelection(
                restoredSelection,
                activeFile.id,
                next,
              ).selectedLayerIds
            : refreshSelectedLayerIdsFromContent(next, prev, {
                kind: "design-file",
                fileId: activeFile.id,
              }),
        );
      }
      // Drop the matching local fallback mirror (see U3) so it can't be
      // replayed a second time via the fallthrough path below once the Yjs
      // UndoManager for this file is later torn down.
      const mirroredIndex = findLastContentHistoryChangeIndex(
        localContentUndoStackRef.current,
        activeFile?.id,
      );
      if (mirroredIndex !== -1) {
        localContentUndoStackRef.current =
          localContentUndoStackRef.current.filter(
            (_, index) => index !== mirroredIndex,
          );
      }
      redoOrderRef.current = [
        ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "content",
      ];
      return true;
    }

    if (!canUseOverviewHistory && scope !== "global" && activeFile?.id) {
      const localIndex = findLastContentHistoryChangeIndex(
        localContentUndoStackRef.current,
        activeFile.id,
      );
      if (localIndex !== -1) {
        const [entry] = localContentUndoStackRef.current.splice(localIndex, 1);
        if (entry) {
          localContentRedoStackRef.current = [
            ...localContentRedoStackRef.current.slice(
              -(MAX_DESIGN_UNDO_STACK - 1),
            ),
            entry,
          ];
          redoOrderRef.current = [
            ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
            "content",
          ];
          // U20: route a live-snapshot screen's replay through
          // updateLiveScreenSnapshotContent — see the matching note above.
          if (liveScreenSnapshotsById[entry.fileId]) {
            updateLiveScreenSnapshotContent(entry.fileId, entry.before, {
              recordHistory: false,
            });
            syncLiveScreenSnapshotPreview(entry.fileId, entry.before);
          } else {
            applyLocalContentUpdate(entry.before, {
              refreshPreview: false,
              forcePreviewFullDocument: true,
              immediateSave: true,
              recordHistory: false,
            });
          }
          // Figma-parity undo selection restore: same need as the Yjs
          // branch above — a gesture recorded on THIS (non-Yjs) stack can
          // stamp its pre-gesture selection via ContentHistoryChange.
          // selectionBefore, which overrides the refresh-from-content
          // heuristic below for the same reason (delete/duplicate leave the
          // heuristic nothing to recover the ORIGINAL selection from).
          setSelectedElement((prev) => {
            if (entry.selectionBefore)
              return resolveLocalHistorySelection(
                entry.selectionBefore,
                entry.fileId,
                entry.before,
              ).selectedElement;
            if (!prev) return prev;
            return refreshElementInfoFromContent(entry.before, prev, {
              kind: "design-file",
              fileId: entry.fileId,
            });
          });
          setHoveredElement((prev) => {
            if (!prev) return prev;
            return refreshElementInfoFromContent(entry.before, prev, {
              kind: "design-file",
              fileId: entry.fileId,
            });
          });
          // U18: keep the layers-panel highlight in sync too.
          setSelectedLayerIdsState((prev) =>
            entry.selectionBefore
              ? resolveLocalHistorySelection(
                  entry.selectionBefore,
                  entry.fileId,
                  entry.before,
                ).selectedLayerIds
              : refreshSelectedLayerIdsFromContent(entry.before, prev, {
                  kind: "design-file",
                  fileId: entry.fileId,
                }),
          );
          return true;
        }
      }
    }

    if (scope === "local") return false;
    const entry =
      contentUndoStackRef.current[contentUndoStackRef.current.length - 1];
    if (!entry) return false;
    const linkedComponent =
      "linkedComponent" in entry && entry.linkedComponent === true;
    if (!canUseOverviewHistory && !linkedComponent) return false;
    const entrySelection =
      contentUndoSelectionStackRef.current[
        contentUndoSelectionStackRef.current.length - 1
      ];
    const { available: changes, remainder } = partitionContentHistoryEntry(
      entry,
      files.map((file) => file.id),
      activeFile?.id,
    );
    if (changes.length === 0) {
      contentUndoStackRef.current.pop();
      contentUndoSelectionStackRef.current.pop();
      prunedUndoHistory += 1;
      return false;
    }
    const preparedReplay = prepareContentHistoryReplay({
      activeFile,
      changes,
      direction: "undo",
      files,
      getFreshActiveContent,
      getScreenContent,
      liveScreenSnapshotsById,
      t,
    });
    if (!preparedReplay) {
      contentReplayRefused = true;
      return false;
    }
    const acceptedContents = new Map<string, string>();
    let replayAccepted = true;
    suppressContentHistoryRef.current = true;
    try {
      for (const change of changes) {
        if (change.before === change.after) continue;
        // U20: a live-snapshot (URL-backed/localhost) screen's visible
        // content lives in liveScreenSnapshotsById, not DesignFile.content
        // — route replay there instead of the regular content path, which
        // that screen's edits never actually write to.
        if (liveScreenSnapshotsById[change.fileId]) {
          acceptedContents.set(change.fileId, change.before);
          updateLiveScreenSnapshotContent(change.fileId, change.before, {
            recordHistory: false,
          });
          syncLiveScreenSnapshotPreview(change.fileId, change.before);
        } else {
          const prepared = preparedReplay.get(change.fileId);
          if (!prepared) {
            replayAccepted = false;
            break;
          }
          const result =
            change.fileId === activeFile?.id
              ? applyLocalContentUpdate(change.before, {
                  historyBeforeContent: prepared.historyBeforeContent,
                  refreshPreview: false,
                  forcePreviewFullDocument: true,
                  immediateSave: true,
                  recordHistory: false,
                })
              : applyFileContentUpdate(change.fileId, change.before, {
                  historyBeforeContent: prepared.historyBeforeContent,
                  recordHistory: false,
                  refreshPreview: false,
                });
          if (result.status !== "accepted") {
            replayAccepted = false;
            break;
          }
          acceptedContents.set(change.fileId, result.content);
        }
      }
    } finally {
      suppressContentHistoryRef.current = false;
    }
    if (!replayAccepted) {
      contentReplayRefused = true;
      return false;
    }
    const replayedChanges = changes.map((change) => {
      const prepared = preparedReplay.get(change.fileId);
      const acceptedContent = acceptedContents.get(change.fileId);
      return prepared && acceptedContent !== undefined
        ? {
            ...change,
            before: acceptedContent,
            after: prepared.historyBeforeContent,
          }
        : change;
    });

    contentUndoStackRef.current.pop();
    contentUndoSelectionStackRef.current.pop();
    const remainderEntry = contentHistoryEntryFromChanges(
      remainder,
      linkedComponent,
    );
    if (remainderEntry) {
      contentUndoStackRef.current.push(remainderEntry);
      contentUndoSelectionStackRef.current.push(entrySelection);
      restoreFileContentHistoryOrderToken(historyOrderRef.current, true);
    }
    const appliedEntry = contentHistoryEntryFromChanges(
      replayedChanges,
      linkedComponent,
    )!;
    const stampedAfter = contentHistorySelectionAfterRef.current.get(entry);
    if (stampedAfter)
      contentHistorySelectionAfterRef.current.set(appliedEntry, stampedAfter);
    contentRedoStackRef.current = [
      ...contentRedoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      appliedEntry,
    ];
    contentRedoSelectionStackRef.current = [
      ...contentRedoSelectionStackRef.current.slice(
        -(MAX_DESIGN_UNDO_STACK - 1),
      ),
      entrySelection,
    ];
    redoOrderRef.current = [
      ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "file-content",
    ];
    applyDesignDataHistoryChanges?.(changes, "undo");
    const activeChange = replayedChanges.find(
      (change) =>
        change.fileId === activeFile?.id && change.before !== change.after,
    );
    if (activeChange) {
      setSelectedElement((prev) => {
        if (!prev) return prev;
        return refreshElementInfoFromContent(activeChange.before, prev, {
          kind: "design-file",
          fileId: activeChange.fileId,
        });
      });
      setHoveredElement((prev) => {
        if (!prev) return prev;
        return refreshElementInfoFromContent(activeChange.before, prev, {
          kind: "design-file",
          fileId: activeChange.fileId,
        });
      });
      // U18: keep the layers-panel highlight in sync too.
      setSelectedLayerIdsState((prev) =>
        refreshSelectedLayerIdsFromContent(activeChange.before, prev, {
          kind: "design-file",
          fileId: activeChange.fileId,
        }),
      );
    }
    restoreHistorySelection(
      entrySelection,
      Object.fromEntries(
        replayedChanges.map((change) => [change.fileId, change.before]),
      ),
    );
    return true;
  };
  const undoGeometry = () => {
    if (!canUseOverviewHistory) return false;
    const entry = geometryUndoStackRef.current.pop();
    if (!entry) return false;
    // Freshness guard: this entry last wrote `entry.after`. If a peer/agent
    // has since moved any of the frames it touched, replaying `entry.before`
    // would silently clobber their change — drop this entry instead. The pop
    // above already removed it, so undo skips forward to the next entry.
    const stale = staleGeometryFrameIds(
      entry,
      liveFrameGeometryRef.current,
      entry.after,
    );
    if (stale.length > 0) {
      console.debug(
        "[design] skipping stale geometry undo; frames changed since capture:",
        stale,
      );
      toast.info(t("designEditor.toasts.undoSkippedConcurrentEdit"));
      // Try the next undo entry rather than swallowing the whole gesture.
      return undoGeometry();
    }
    geometryRedoStackRef.current = [
      ...geometryRedoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      entry,
    ];
    redoOrderRef.current = [
      ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "geometry",
    ];
    // U11: merge only this entry's per-frame diff onto the CURRENT live
    // map (read fresh from the ref) instead of replacing the whole board
    // with the entry's stale whole-board snapshot — otherwise a frame
    // created after this entry was recorded has no key in entry.before
    // and would be wiped out by a full-map replace.
    writeFrameGeometrySnapshot(
      applyGeometryHistoryDiff(
        getCanvasFrameGeometry(designDataJsonRef.current),
        entry,
        "undo",
      ),
      {
        replacePendingGeometrySave: true,
        syncViewportFrameIds: viewportChangedFrameIds(
          entry.after,
          entry.before,
        ),
      },
    );
    // Figma parity: undo re-selects whatever was selected when this
    // gesture's change was originally made.
    if (entry.linkedContentChanges?.length) {
      applyGeometryHistoryContentChanges?.(entry.linkedContentChanges, "undo");
    }
    restoreHistorySelection(
      entry.selectionBefore,
      Object.fromEntries(
        (entry.linkedContentChanges ?? []).map((change) => [
          change.fileId,
          change.before,
        ]),
      ),
    );
    return true;
  };
  // Figma parity (ground-truth Round 4): undo a plain selection change (no
  // document edit) — see SelectionHistoryEntry's doc comment. Restores the
  // pre-selection-change snapshot, including the on-canvas selection overlay
  // (elementInfoForSelectionSnapshot), which restoreSelectionSnapshot alone
  // cannot derive.
  const undoSelection = () => {
    if (!canUseOverviewHistory) return false;
    const entry = selectionUndoStackRef.current.pop();
    if (!entry) return false;
    selectionRedoStackRef.current = [
      ...selectionRedoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      entry,
    ];
    redoOrderRef.current = [
      ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "selection",
    ];
    restoreHistorySelection(entry.before);
    return true;
  };
  // U12: undo a screen create/duplicate by soft-deleting the file it
  // created (performDeleteFiles already prunes any content/geometry undo
  // entries for that file, mirroring U2's screen-deletion cleanup).
  // Resolved by filename at undo time (filenames are unique) since the
  // entry itself doesn't carry the id assigned by the create mutation.
  const undoFileCreation = () => {
    if (!canUseOverviewHistory) return false;
    const stack = fileCreationUndoStackRef.current;
    const entry = stack[stack.length - 1];
    if (!entry) return false;
    let batchStart = stack.length - 1;
    while (
      batchStart > 0 &&
      entry.historyBatchId &&
      stack[batchStart - 1]?.historyBatchId === entry.historyBatchId
    ) {
      batchStart -= 1;
    }
    const entries = stack.slice(batchStart);
    const createdFiles = entries.map((item) =>
      files.find((file) => file.filename === item.filename),
    );
    if (createdFiles.some((file) => !file)) return false;
    stack.splice(batchStart, entries.length);
    fileCreationRedoStackRef.current = [
      ...fileCreationRedoStackRef.current.slice(
        -(MAX_DESIGN_UNDO_STACK - entries.length),
      ),
      ...entries,
    ];
    redoOrderRef.current = [
      ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
      "file-created",
    ];
    // skipFileCreationRedoPrune: the entry was just pushed onto the redo
    // stack above for this exact filename — without this flag
    // performDeleteFiles' filename-keyed redo prune would immediately pop
    // it back off, leaving redo permanently empty after this undo.
    performDeleteFiles(
      createdFiles.filter((file): file is DesignFile => Boolean(file)),
      {
        skipFileCreationRedoPrune: true,
        onMutationSettled: (deletedFiles, failedFiles) => {
          const duplicateStack = entries.find(
            (item) => item.duplicateStack,
          )?.duplicateStack;
          if (
            !duplicateStack ||
            failedFiles.length > 0 ||
            deletedFiles.length !== createdFiles.length
          ) {
            return;
          }
          const restoredGeometry = {
            ...getCanvasFrameGeometry(designDataJsonRef.current),
          };
          for (const [frameId, geometry] of Object.entries(
            duplicateStack.before,
          )) {
            if (geometry) restoredGeometry[frameId] = geometry;
            else delete restoredGeometry[frameId];
          }
          writeFrameGeometrySnapshot(restoredGeometry, {
            replacePendingGeometrySave: true,
          });
        },
      },
    );
    return true;
  };
  const undoFileDeletion = () => {
    if (!canUseOverviewHistory || !id) return false;
    const entry = fileDeletionUndoStackRef.current.pop();
    if (!entry) return false;

    const remapRestoredHistory = (
      fileIds: ReadonlyMap<string, string>,
      restoredFilesById: ReadonlyMap<string, FileDeletionHistorySnapshot>,
    ) => {
      const remapSelectionEntry = (item: SelectionHistoryEntry) => ({
        ...item,
        before: remapHistorySelection(item.before, fileIds),
        after: remapHistorySelection(item.after, fileIds),
      });
      selectionUndoStackRef.current =
        selectionUndoStackRef.current.map(remapSelectionEntry);
      selectionRedoStackRef.current =
        selectionRedoStackRef.current.map(remapSelectionEntry);
      const undoHistory = remapContentHistory(
        contentUndoStackRef.current,
        contentUndoSelectionStackRef.current,
        contentHistorySelectionAfterRef.current,
        fileIds,
      );
      contentUndoStackRef.current = undoHistory.stack;
      contentUndoSelectionStackRef.current = undoHistory.selections;
      const redoHistory = remapContentHistory(
        contentRedoStackRef.current,
        contentRedoSelectionStackRef.current,
        contentHistorySelectionAfterRef.current,
        fileIds,
      );
      contentRedoStackRef.current = redoHistory.stack;
      contentRedoSelectionStackRef.current = redoHistory.selections;
      geometryUndoStackRef.current = geometryUndoStackRef.current.map((item) =>
        remapGeometryHistory(item, fileIds),
      );
      geometryRedoStackRef.current = geometryRedoStackRef.current.map((item) =>
        remapGeometryHistory(item, fileIds),
      );
      localContentUndoStackRef.current = localContentUndoStackRef.current.map(
        (item) => remapHistoryChange(item, fileIds),
      );
      localContentRedoStackRef.current = localContentRedoStackRef.current.map(
        (item) => remapHistoryChange(item, fileIds),
      );
      clipboardPasteUndoStackRef.current =
        clipboardPasteUndoStackRef.current.map((item) =>
          remapHistoryChange(item, fileIds),
        );
      clipboardPasteRedoStackRef.current =
        clipboardPasteRedoStackRef.current.map((item) =>
          remapHistoryChange(item, fileIds),
        );
      const remapDeletionEntry = (other: FileDeletionHistoryEntry) => {
        const remapped = remapFileDeletionHistoryEntryIds(
          other,
          other.files.map((file) => fileIds.get(file.id) ?? file.id),
          fileIds,
        );
        if (remapped.restoredFiles) {
          remapped.restoredFiles = remapped.restoredFiles.map((file) => {
            const restored = restoredFilesById.get(file.id);
            return restored
              ? {
                  ...file,
                  content: restored.content,
                  screenMetadata: restored.screenMetadata,
                  localhostScreen: restored.localhostScreen,
                  geometry: restored.geometry,
                }
              : file;
          });
        }
        return remapped;
      };
      fileDeletionUndoStackRef.current =
        fileDeletionUndoStackRef.current.map(remapDeletionEntry);
      fileDeletionRedoStackRef.current =
        fileDeletionRedoStackRef.current.map(remapDeletionEntry);
    };
    const restoreMetadataAndGeometry = (
      original: FileDeletionHistoryEntry,
      restored: FileDeletionHistoryEntry,
      missingFileIds?: ReadonlySet<string>,
    ) => {
      const metadataRestore = fileDeletionMetadataRestoreChanges(
        original,
        restored,
        designDataJsonRef.current,
        missingFileIds,
      );
      if (
        metadataRestore.changes.length > 0 &&
        (!applyDesignDataHistoryChanges ||
          applyDesignDataHistoryChanges(metadataRestore.changes, "undo") ===
            false)
      ) {
        throw new Error(t("common.genericError"));
      }
      const nextGeometry = {
        ...getCanvasFrameGeometry(designDataJsonRef.current),
      };
      restored.files.forEach((file, index) => {
        if (
          file.geometry &&
          (original.files[index]?.id !== file.id || !nextGeometry[file.id])
        ) {
          nextGeometry[file.id] = file.geometry;
        }
      });
      writeFrameGeometrySnapshot(nextGeometry);
      return metadataRestore;
    };
    fileHistoryMutationPendingRef.current = true;
    syncUndoRedoState();
    void (async () => {
      const recreatedIds: string[] = [];
      let preparedFiles: ReturnType<typeof prepareDeletedFileRestore>[] = [];
      try {
        preparedFiles = entry.files.map((file) => {
          try {
            return prepareDeletedFileRestore(file);
          } catch (error) {
            console.error("Unable to prove restored Screen identity", error);
            throw new Error(t("common.genericError"));
          }
        });
        for (const [index, file] of entry.files.entries()) {
          const result = (await createFileMutation.mutateAsync({
            designId: id,
            filename: file.filename,
            content: preparedFiles[index]!.content,
            fileType: file.fileType,
          } as any)) as { id?: string };
          if (!result.id) {
            throw new Error(`Failed to restore "${file.filename}"`);
          }
          recreatedIds.push(result.id);
        }

        const restoreEntry = {
          files: [...entry.files, ...(entry.restoredFiles ?? [])],
        };
        const recreatedEntry = remapFileDeletionHistoryEntryIds(restoreEntry, [
          ...recreatedIds,
          ...(entry.restoredFiles ?? []).map((file) => file.id),
        ]);
        recreatedEntry.files = recreatedEntry.files.map((file, index) => ({
          ...file,
          content: preparedFiles[index]?.content ?? file.content,
        }));
        entry.files.forEach((file, index) => {
          const recreatedFile = recreatedEntry.files[index];
          const prepared = preparedFiles[index];
          if (!recreatedFile || !prepared) return;
          optimisticallyInsertCreatedFile?.({
            fileId: recreatedFile.id,
            filename: file.filename,
            fileType: file.fileType,
            content: prepared.content,
          });
        });
        const metadataRestore = restoreMetadataAndGeometry(
          restoreEntry,
          recreatedEntry,
        );

        // Retained screens may have been edited while creation was retryable.
        // Keep those current values in the snapshot used by the next redo.
        for (const file of recreatedEntry.files) {
          if (!entry.restoredFiles?.some((retained) => retained.id === file.id))
            continue;
          const screenMetadata = getDesignDataRecord(
            designDataJsonRef.current,
            "screenMetadata",
          )[file.id];
          if (isRecord(screenMetadata)) file.screenMetadata = screenMetadata;
          else delete file.screenMetadata;
          const localhostScreen = getDesignDataRecord(
            designDataJsonRef.current,
            "localhostScreens",
          )[file.id];
          if (isRecord(localhostScreen)) file.localhostScreen = localhostScreen;
          else delete file.localhostScreen;
          const geometry = getCanvasFrameGeometry(designDataJsonRef.current)[
            file.id
          ];
          if (geometry) file.geometry = geometry;
          else delete file.geometry;
        }

        // Historical source is replayed byte-for-byte, in the recreated file's namespace.
        const fileIds = new Map(
          entry.files.map((file, index) => [file.id, recreatedIds[index]!]),
        );
        preparedFiles.forEach((prepared, index) =>
          prepared.mapNodeIds(recreatedIds[index]!),
        );
        remapRestoredHistory(
          fileIds,
          new Map(
            recreatedEntry.files
              .slice(0, entry.files.length)
              .map((file) => [file.id, file]),
          ),
        );
        fileDeletionRedoStackRef.current = [
          ...fileDeletionRedoStackRef.current.slice(
            -(MAX_DESIGN_UNDO_STACK - 1),
          ),
          recreatedEntry,
        ];
        redoOrderRef.current = [
          ...redoOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
          "file-deleted",
        ];
        if (metadataRestore.skippedVariantMemberships) {
          toast.info(t("designEditor.toasts.undoSkippedConcurrentEdit"));
        }
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });

        const firstRestoredId = recreatedEntry.files[0]?.id;
        if (firstRestoredId) {
          setActiveFileId(firstRestoredId);
          setOverviewSelectedScreenIds(
            recreatedEntry.files.map((file) => file.id),
          );
          setSelectedLayerIdsState(recreatedEntry.files.map((file) => file.id));
        }
      } catch (error) {
        clearPendingHistory?.();
        const cleanupResults = await Promise.allSettled(
          recreatedIds.map((fileId) =>
            deleteFileMutation.mutateAsync({
              id: fileId,
              allowLockedLayers: true,
            } as any),
          ),
        );
        const cleanupFailedFileIds = new Set<string>();
        cleanupResults.forEach((result, index) => {
          const file = entry.files[index];
          if (result.status === "rejected" && file) {
            cleanupFailedFileIds.add(file.id);
          }
        });
        const survivorIds = new Map(
          entry.files.flatMap((file, index) =>
            cleanupFailedFileIds.has(file.id)
              ? [[file.id, recreatedIds[index]!]]
              : [],
          ),
        );
        const survivorEntry = {
          files: [
            ...entry.files.filter((file) => cleanupFailedFileIds.has(file.id)),
            ...(entry.restoredFiles ?? []),
          ],
        };
        const restoredSurvivors = remapFileDeletionHistoryEntryIds(
          survivorEntry,
          survivorEntry.files.map(
            (file) => survivorIds.get(file.id) ?? file.id,
          ),
          survivorIds,
        );
        const restoredContentById = new Map(
          entry.files.flatMap((file, index) => {
            const restoredId = survivorIds.get(file.id);
            return restoredId
              ? [[restoredId, preparedFiles[index]!.content]]
              : [];
          }),
        );
        restoredSurvivors.files = restoredSurvivors.files.map((file) => ({
          ...file,
          content: restoredContentById.get(file.id) ?? file.content,
        }));
        // Keep survivor identity and metadata until the whole retry succeeds.
        if (survivorIds.size > 0) {
          remapRestoredHistory(
            survivorIds,
            new Map(
              restoredSurvivors.files
                .filter((file) => restoredContentById.has(file.id))
                .map((file) => [file.id, file]),
            ),
          );
        }
        const retryableEntry = filterFileDeletionHistoryEntry(
          remapFileDeletionHistoryEntryIds(
            entry,
            entry.files.map((file) => survivorIds.get(file.id) ?? file.id),
            survivorIds,
          ),
          new Set(
            entry.files
              .filter((file) => !cleanupFailedFileIds.has(file.id))
              .map((file) => file.id),
          ),
        );
        if (restoredSurvivors.files.length > 0) {
          retryableEntry.restoredFiles = restoredSurvivors.files;
        }
        if (
          retryableEntry.files.length > 0 ||
          retryableEntry.restoredFiles?.length
        ) {
          fileDeletionUndoStackRef.current = [
            ...fileDeletionUndoStackRef.current.slice(
              -(MAX_DESIGN_UNDO_STACK - 1),
            ),
            retryableEntry,
          ];
          historyOrderRef.current = [
            ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
            "file-deleted",
          ];
        }
        if (restoredSurvivors.files.length > 0) {
          try {
            restoreMetadataAndGeometry(
              survivorEntry,
              restoredSurvivors,
              new Set(retryableEntry.files.map((file) => file.id)),
            );
          } catch {
            // The retained entry retries metadata without creating survivors again.
          }
        }
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });
        toast.error(
          cleanupFailedFileIds.size > 0 || !(error instanceof Error)
            ? t("common.genericError")
            : error.message,
        );
      } finally {
        fileHistoryMutationPendingRef.current = false;
        syncUndoRedoState();
      }
    })();
    return true;
  };

  const tryUndoActions = (...actions: Array<() => boolean>) => {
    for (const action of actions) {
      if (action()) return true;
      if (contentReplayRefused) return false;
    }
    return false;
  };
  const undoByOrder = (preferred?: UndoRedoOrderKind | "selection") => {
    if (preferred === "clipboard-paste") return undoClipboardPaste();
    if (preferred === "selection") {
      return tryUndoActions(undoSelection, undoContent, undoGeometry);
    }
    if (preferred === "file-deleted") {
      return tryUndoActions(
        undoFileDeletion,
        undoFileCreation,
        undoContent,
        undoGeometry,
      );
    }
    if (preferred === "file-created")
      return tryUndoActions(
        undoFileCreation,
        undoFileDeletion,
        undoContent,
        undoGeometry,
      );
    if (preferred === "geometry")
      return tryUndoActions(undoGeometry, undoContent);
    if (preferred === "file-content") {
      const prunedBefore = prunedUndoHistory;
      if (undoContent("global")) return true;
      if (contentReplayRefused || prunedUndoHistory > prunedBefore)
        return false;
      return undoGeometry();
    }
    if (preferred === "content") {
      const prunedBefore = prunedUndoHistory;
      if (undoContent("local")) return true;
      if (contentReplayRefused) return false;
      if (undoContent("global")) return true;
      if (contentReplayRefused || prunedUndoHistory > prunedBefore)
        return false;
      return undoGeometry();
    }
    return tryUndoActions(undoFileDeletion, undoContent, undoGeometry);
  };
  let didUndo = false;
  if (canUseOverviewHistory) {
    while (!didUndo) {
      const preferred =
        historyOrderRef.current[historyOrderRef.current.length - 1];
      if (preferred === "clipboard-paste") {
        didUndo = undoClipboardPaste();
        break;
      }
      historyOrderRef.current.pop();
      didUndo = undoByOrder(preferred);
      if (contentReplayRefused) {
        if (preferred !== undefined) historyOrderRef.current.push(preferred);
        break;
      }
      if (didUndo || preferred === undefined) break;
    }
  } else {
    const preferred =
      historyOrderRef.current[historyOrderRef.current.length - 1];
    const linkedEntry =
      contentUndoStackRef.current[contentUndoStackRef.current.length - 1];
    const canUndoLinkedEntry =
      !!linkedEntry &&
      "linkedComponent" in linkedEntry &&
      linkedEntry.linkedComponent === true;
    if (preferred === "clipboard-paste") {
      didUndo = undoClipboardPaste();
    } else if (preferred === "file-content" && canUndoLinkedEntry) {
      historyOrderRef.current.pop();
      didUndo = undoContent("global");
      if (!didUndo && prunedUndoHistory === 0)
        historyOrderRef.current.push(preferred);
    } else if (preferred === "content") {
      historyOrderRef.current.pop();
      didUndo = undoContent("local");
      if (!didUndo) historyOrderRef.current.push(preferred);
    } else if (preferred === undefined) {
      didUndo = undoContent("local");
    }
  }
  if (didUndo || prunedUndoHistory > 0) {
    syncUndoRedoState();
  }
}
