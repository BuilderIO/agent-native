import {
  useCollaborativeDoc,
  emailToColor,
  emailToName,
  type CollabUser,
  type AttributedRecentEdit,
} from "@agent-native/core/client/collab";
import {
  readClientAppState,
  setClientAppState,
} from "@agent-native/core/client/hooks";
import { type CanvasFrameGeometryById } from "@shared/canvas-frames";
import { getFrameGroupBounds } from "@shared/canvas-math";
import type { A11yFinding } from "@shared/design-review";
import type { InteractionState } from "@shared/interaction-states";
import { annotateScreenHtmlForPersist } from "@shared/screen-annotation";
import { sourceContentHash } from "@shared/source-workspace";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { toast } from "sonner";

import {
  type EditorDragStateChange,
  type RuntimeLayerSnapshotReadiness,
} from "@/components/design/DesignCanvas";
import { getBoardSurfaceContentBounds } from "@/components/design/multi-screen/board-surface-html";
import type {
  DuplicateMode,
  FrameGeometry,
} from "@/components/design/multi-screen/types";
import type { ElementInfo } from "@/components/design/types";
import {
  designEditorCommandKey,
  type DesignEditorCommand,
} from "@/hooks/use-navigation-state";
import { prettyScreenName } from "@/lib/screen-names";

import {
  bridgeSourceIdForCodeLayerNode,
  elementInfoFromCodeLayerNode,
  preferredCodeLayerSelector,
} from "../code-layer-state";
import type {
  DesignCanvasEmbeddedFrame,
  RuntimeLayerSnapshot,
} from "../command-types";
import { runAddScreen } from "../commands/add-screen";
import { runCreateScreenFrame } from "../commands/create-screen-frame";
import { runDuplicateScreen } from "../commands/duplicate-screen";
import { runRecordPendingLiveLayerStateEdit } from "../commands/record-pending-live-layer-state-edit";
import { runRecordPendingLiveTextEdit } from "../commands/record-pending-live-text-edit";
import { runRecordPendingVisualStyleEdit } from "../commands/record-pending-visual-style-edit";
import { runSendRuntimeLayerMoveSemanticHandoff } from "../commands/send-runtime-layer-move-semantic-handoff";
import { getCreatedScreenNavigationPlan } from "../created-screen-navigation";
import { shouldAcceptEditorDragStateEvent } from "../editor-drag-state";
import { runtimeMultiplicityForElementProvenance } from "../editor-helpers";
import { TAB_ID } from "../editor-session";
import {
  getFreshActiveFileContent,
  getFreshScreenContent,
} from "../editor-state";
import { MAX_DESIGN_UNDO_STACK } from "../history";
import {
  autoHeightScreenIds,
  getAllScreenFrameEntries,
  pinnedHeightScreenIds,
  withMeasuredFrameHeights,
} from "../overview-camera";
import {
  appendPendingLiveNonStyleUndoEntry,
  mergePendingLiveNonStyleEdit,
  pendingLiveLayerNameUndoRevertValue,
  nextPendingLiveEditTimestamp,
  reactSourceAnchorForPendingEdit,
  type PendingLiveLayerNameEdit,
  type PendingRelativeStyleOperation,
  resolveOverviewScreenSourceType,
} from "../pending-edits";
import type { ReactGridPlacement } from "../react-semantic-handoff";
import { designEditorCommandFromSearchParams } from "../screen-command-utils";
import { prepareCanonicalSourceContent } from "../source-publication";
import { type DesignFile } from "../types";
import { useViewerPresence } from "../use-viewer-presence";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCore } from "./use-editor-core";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";

type LayerStructurePreview = {
  sourceId: string;
  anchorId: string;
  placement: "before" | "after" | "inside";
  insert: boolean;
};

export function useEditorCanvasAndScreens({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
}) {
  const {
    t,
    id,
    session,
    isSignedIn,
    initialSearchParams,
    queryClient,
    setMode,
    setActiveTool,
    measuredScreenHeightByIdRef,
    viewMode,
    setViewMode,
    viewModeRef,
    selectedElement,
    setSelectedElement,
    liveRoutePathsByScreenIdRef,
    pendingStructureRedoReplayTimerRef,
    cancelPendingStructureVerification,
    setHoveredElement,
    activeFileId,
    setActiveFileId,
    handleScreenRuntimeVerificationSnapshot,
  } = editorCore;
  const {
    setPendingVisualStyleEdits,
    setPendingLiveNonStyleEdits,
    pendingVisualStyleEditsRef,
    pendingLiveNonStyleEditsRef,
    pendingVisualStyleUndoStackRef,
    pendingVisualStyleRedoStackRef,
    pendingLiveNonStyleUndoStackRef,
    pendingLiveNonStyleRedoStackRef,
    pendingStructureRedoReplayRef,
    setActiveLeftPanel,
    setSelectedLayerIdsState,
    codeLayerOwnerByNodeIdRef,
    setOverviewSelectedScreenIds,
    setCreatedOverviewLayerSelection,
    pendingOverviewScreenSelectionRef,
    pendingOverviewLayerSelectionRef,
    clearPendingOverviewLayerSelectionTimer,
    clipboardPasteRedoStackRef,
    activeBreakpointWidthState,
    linkedComponentMutationQueueRef,
    explicitOverviewScreenSelectionRef,
    pendingDuplicateGeometriesRef,
    pendingDuplicateFilenamesRef,
    duplicateInFlightRef,
    duplicateRecoveryRef,
    historyOrderRef,
    redoOrderRef,
    clearRedoStacks,
    historySourceReaderRef,
    syncUndoRedoState,
    clearLocalUndoRedoStacks,
    recordFileCreationHistoryEntry,
  } = editorHistory;
  const {
    browserTabId,
    currentUserAvatarUrl,
    designEditorCommandVersion,
    designAccessRole,
    canEditDesign,
    rawServerFilesByIdRef,
    historyFilesRef,
    pendingLocalFileContentsRef,
    createFileMutation,
    createFileAsync,
    deleteFileMutation,
    updateDesignAsync,
    pendingLocalFileContentsSnapshot,
  } = editorGenerationAndAccess;
  const {
    locallyPinnedHeightIdsRef,
    setOptimisticFrameGeometryById,
    setPatchProof,
    latestFileSaveForUnloadRef,
    publishCanonicalContent,
    serverFiles,
    files,
    liveScreenSnapshotsById,
    runtimeLayerSnapshotsById,
    designDataJsonRef,
    displayedCanvasFrameGeometryById,
    liveFrameGeometryRef,
    boardFileId,
    overviewScreens,
    designSourceType,
    handleScreenRuntimeLayerSnapshot,
  } = editorFilesAndSaving;
  const {
    setCameraCommand,
    cameraCommandNonceRef,
    setExplicitOverviewCanvasZoom,
    responsiveEditScopeRef,
    exportCanvasFrameGeometryById,
    boardFileContent,
    writeFrameGeometrySnapshot,
    activeFile,
    activeRuntimeLayerReadinessScreenIdRef,
    activeBreakpointUpperBoundPx,
    applyDesignEditorCommand,
  } = editorActiveScreenAndGeometry;

  const [suppressLineupRecenter, setSuppressLineupRecenter] = useState<{
    fromCount: number;
    addedCount: number;
    nonce: number;
  } | null>(null);
  const suppressLineupRecenterNonceRef = useRef(0);
  const localhostConnectionRootPathByIdRef = useRef<Map<string, string>>(
    new Map(),
  );
  const [hoveredElementScreenId, setHoveredElementScreenId] = useState<
    string | null
  >(null);
  const initialSearchCommandAppliedForIdRef = useRef<string | null>(null);
  const [overviewClearSelectionRequest, setOverviewClearSelectionRequest] =
    useState(0);
  const recordPendingHistoryEntry = useCallback(
    (kind: "pending-style" | "pending-live", replayedRedo = false) => {
      if (replayedRedo) {
        if (redoOrderRef.current[redoOrderRef.current.length - 1] === kind) {
          redoOrderRef.current = redoOrderRef.current.slice(0, -1);
        }
      } else {
        clearRedoStacks();
      }
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        kind,
      ];
    },
    [clearRedoStacks],
  );
  const exportPreviewScreenIdRef = useRef<string | null>(null);
  const currentUser: CollabUser | undefined = useMemo(
    () =>
      session?.email
        ? {
            name: session.name?.trim() || emailToName(session.email),
            email: session.email,
            color: emailToColor(session.email),
            ...(currentUserAvatarUrl
              ? { avatarUrl: currentUserAvatarUrl }
              : {}),
          }
        : undefined,
    [session?.email, session?.name, currentUserAvatarUrl],
  );
  const canEditLiveScreenIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [runtimeLayerSnapshotReadiness, setRuntimeLayerSnapshotReadiness] =
    useState<{
      screenId: string;
      readiness: RuntimeLayerSnapshotReadiness;
    } | null>(null);
  const runtimeLayerSnapshotReadinessByIdRef = useRef<
    Record<string, RuntimeLayerSnapshotReadiness>
  >({});

  const boardContentBounds = useMemo(
    () => getBoardSurfaceContentBounds(boardFileContent),
    [boardFileContent],
  );

  useEffect(() => {
    if (!id) return;
    if (initialSearchCommandAppliedForIdRef.current === id) return;
    const command = designEditorCommandFromSearchParams(
      id,
      initialSearchParams,
    );
    if (!command) {
      initialSearchCommandAppliedForIdRef.current = id;
      return;
    }
    const applied = applyDesignEditorCommand(command);
    if (applied) {
      initialSearchCommandAppliedForIdRef.current = id;
    }
  }, [applyDesignEditorCommand, id, initialSearchParams]);

  useEffect(() => {
    if (!id || !canEditDesign) return;
    let cancelled = false;
    const keys = browserTabId
      ? [designEditorCommandKey(browserTabId), designEditorCommandKey()]
      : [designEditorCommandKey()];

    void (async () => {
      for (const key of keys) {
        // coercion-ok: an absent command is equivalent to no queued command.
        const command = await readClientAppState<DesignEditorCommand>(
          key,
          // coercion-ok: an absent command is equivalent to no queued command.
        ).catch(() => null);
        if (cancelled || !command || command.designId !== id) continue;
        const applied = applyDesignEditorCommand(command);
        if (!applied) return;
        // coercion-ok: command cleanup is best effort after applying it.
        await setClientAppState(key, null).catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    designEditorCommandVersion,
    applyDesignEditorCommand,
    browserTabId,
    canEditDesign,
    id,
  ]);

  const optimisticallyInsertCreatedFile = useCallback(
    (args: {
      fileId: string;
      filename: string;
      fileType: DesignFile["fileType"];
      content: string;
      result?: Record<string, unknown> | null;
    }) => {
      if (!id) return;
      const now = new Date().toISOString();
      const optimisticFile: DesignFile = {
        id: args.fileId,
        filename: args.filename,
        fileType: args.fileType,
        content: annotateScreenHtmlForPersist(args.content, args.fileType),
        createdAt:
          typeof args.result?.createdAt === "string"
            ? args.result.createdAt
            : now,
        updatedAt:
          typeof args.result?.updatedAt === "string"
            ? args.result.updatedAt
            : now,
      };
      historyFilesRef.current = historyFilesRef.current.some(
        (file) => file.id === args.fileId,
      )
        ? historyFilesRef.current.map((file) =>
            file.id === args.fileId ? optimisticFile : file,
          )
        : [...historyFilesRef.current, optimisticFile];
      void queryClient.cancelQueries({
        queryKey: ["action", "get-design", { id }],
        exact: true,
      });
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
          return old;
        }
        return {
          ...old,
          files: old.files.some((file: DesignFile) => file.id === args.fileId)
            ? old.files.map((file: DesignFile) =>
                file.id === args.fileId ? optimisticFile : file,
              )
            : [...old.files, optimisticFile],
        };
      });
    },
    [id, queryClient],
  );

  const focusCreatedScreen = useCallback(
    (
      screenId: string,
      geometry: FrameGeometry,
      options?: {
        preserveCamera?: boolean;
        suppressLineupRecenter?: boolean;
      },
    ) => {
      const plan = getCreatedScreenNavigationPlan({ screenId, geometry });
      setOptimisticFrameGeometryById((current) => ({
        ...current,
        [screenId]: geometry,
      }));
      pendingOverviewScreenSelectionRef.current = screenId;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      setActiveFileId(plan.activeFileId);
      setSelectedElement(null);
      setSelectedLayerIdsState(plan.selectedLayerIds);
      explicitOverviewScreenSelectionRef.current = plan.selectedScreenIds;
      setOverviewSelectedScreenIds(plan.selectedScreenIds);
      setActiveTool("move");
      setMode("edit");
      viewModeRef.current = plan.viewMode;
      setViewMode(plan.viewMode);
      if (options?.suppressLineupRecenter) {
        const nonce = ++suppressLineupRecenterNonceRef.current;
        setSuppressLineupRecenter((current) => {
          const sameBatch = current?.fromCount === overviewScreens.length;
          return {
            fromCount: sameBatch ? current.fromCount : overviewScreens.length,
            addedCount: sameBatch ? current.addedCount + 1 : 1,
            nonce,
          };
        });
      }
      if (!options?.preserveCamera) {
        cameraCommandNonceRef.current += 1;
        setCameraCommand({
          ...plan.camera,
          nonce: cameraCommandNonceRef.current,
        });
      }
    },
    [clearPendingOverviewLayerSelectionTimer, overviewScreens.length],
  );

  const handleDuplicateScreen = useCallback(
    (
      screenId: string,
      request?: {
        mode?: DuplicateMode;
        canvasPosition?: { x: number; y: number };
        canvasFrameGeometryById?: CanvasFrameGeometryById;
        preserveCamera?: boolean;
        historyBatchId?: string;
        duplicateStackSourceIds?: string[];
      },
    ) => {
      return runDuplicateScreen(
        {
          canEditDesign,
          createFileAsync,
          deleteFileAsync: deleteFileMutation.mutateAsync,
          designDataJsonRef,
          duplicateRecoveryRef,
          displayedCanvasFrameGeometryById,
          files,
          getCurrentScreenContentForDuplicate: (targetScreenId) => {
            const sourceType = resolveOverviewScreenSourceType(
              overviewScreens.find((screen) => screen.id === targetScreenId),
              designSourceType,
            );
            if (sourceType !== "inline") {
              return files.find((file) => file.id === targetScreenId)?.content;
            }
            return historySourceReaderRef.current(targetScreenId);
          },
          focusCreatedScreen,
          id,
          liveFrameGeometryRef,
          optimisticallyInsertCreatedFile,
          overviewScreens,
          pendingDuplicateGeometriesRef,
          pendingDuplicateFilenamesRef,
          duplicateInFlightRef,
          queryClient,
          recordFileCreationHistoryEntry,
          t,
          updateDesignAsync,
          writeFrameGeometrySnapshot,
        },
        screenId,
        request,
      );
    },
    [
      canEditDesign,
      createFileAsync,
      deleteFileMutation,
      displayedCanvasFrameGeometryById,
      designSourceType,
      files,
      focusCreatedScreen,
      recordFileCreationHistoryEntry,
      id,
      optimisticallyInsertCreatedFile,
      overviewScreens,
      queryClient,
      t,
      updateDesignAsync,
      writeFrameGeometrySnapshot,
    ],
  );

  const handleAddScreen = useCallback(
    () =>
      runAddScreen({
        boardContentBounds,
        boardFileId,
        canEditDesign,
        createFileMutation,
        designDataJsonRef,
        files,
        focusCreatedScreen,
        id,
        optimisticallyInsertCreatedFile,
        overviewScreens,
        queryClient,
        recordFileCreationHistoryEntry,
        t,
        writeFrameGeometrySnapshot,
      }),
    [
      canEditDesign,
      boardContentBounds,
      boardFileId,
      createFileMutation,
      files,
      focusCreatedScreen,
      id,
      optimisticallyInsertCreatedFile,
      overviewScreens,
      queryClient,
      recordFileCreationHistoryEntry,
      t,
      writeFrameGeometrySnapshot,
    ],
  );

  const handleCreateScreenFrame = useCallback(
    (geometry: { x: number; y: number; width: number; height: number }) =>
      runCreateScreenFrame(
        {
          canEditDesign,
          createFileMutation,
          designDataJsonRef,
          files,
          focusCreatedScreen,
          id,
          locallyPinnedHeightIdsRef,
          optimisticallyInsertCreatedFile,
          queryClient,
          recordFileCreationHistoryEntry,
          t,
          writeFrameGeometrySnapshot,
        },
        geometry,
      ),
    [
      canEditDesign,
      createFileMutation,
      files,
      focusCreatedScreen,
      id,
      optimisticallyInsertCreatedFile,
      queryClient,
      recordFileCreationHistoryEntry,
      t,
      writeFrameGeometrySnapshot,
    ],
  );

  const handleCreateScreenFromPreset = useCallback(
    (preset: { name: string; width: number; height: number }) => {
      const frames = getAllScreenFrameEntries({
        overviewScreens,
        canvasFrameGeometryById: exportCanvasFrameGeometryById,
        boardContentBounds,
        boardFileId,
        includeResponsivePreviews: true,
      });
      const bounds = getFrameGroupBounds(frames);
      const gap = 56;
      const geometry = bounds
        ? {
            x: bounds.right + gap,
            y: bounds.top,
            width: preset.width,
            height: preset.height,
          }
        : { x: 0, y: 0, width: preset.width, height: preset.height };
      handleCreateScreenFrame(geometry);
    },
    [
      boardFileId,
      boardContentBounds,
      exportCanvasFrameGeometryById,
      handleCreateScreenFrame,
      overviewScreens,
    ],
  );

  const { ydoc, awareness, isSynced, activeUsers, agentPresent, agentActive } =
    useCollaborativeDoc({
      docId:
        isSignedIn && canEditDesign && viewMode === "single"
          ? activeFileId
          : null,
      activityResource: id
        ? { resourceType: "design", resourceId: id }
        : undefined,
      requestSource: TAB_ID,
      user: currentUser,
    });

  const overviewPresenceFileId =
    viewMode === "overview"
      ? (activeFileId ?? overviewScreens[0]?.id ?? null)
      : null;
  const {
    awareness: overviewAwareness,
    ydoc: overviewYdoc,
    isSynced: overviewIsSynced,
    activeUsers: overviewActiveUsers,
    agentPresent: overviewAgentPresent,
    agentActive: overviewAgentActive,
  } = useCollaborativeDoc({
    docId:
      isSignedIn && canEditDesign && overviewPresenceFileId
        ? overviewPresenceFileId
        : null,
    activityResource: id
      ? { resourceType: "design", resourceId: id }
      : undefined,
    requestSource: TAB_ID,
    user: currentUser,
  });

  useViewerPresence({
    designId: id ?? null,
    isSignedIn,
    canEditDesign,
    accessRole: designAccessRole,
    fileId: viewMode === "single" ? activeFileId : overviewPresenceFileId,
    requestSource: TAB_ID,
    user: currentUser,
  });

  const [collabContent, setCollabContent] = useState<string | null>(null);
  const [collabContentFileId, setCollabContentFileId] = useState<string | null>(
    null,
  );
  const previousDesignIdForHistoryRef = useRef<string | null>(null);
  const prevActiveFileIdRef = useRef<string | null>(null);
  const lastAppliedFileUpdatedAtRef = useRef<string | null>(null);
  const lastAppliedFileContentRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    for (const file of serverFiles) {
      if (
        viewMode === "single" &&
        isSynced &&
        ydoc &&
        file.id === activeFileId &&
        prevActiveFileIdRef.current === activeFileId &&
        lastAppliedFileUpdatedAtRef.current
      )
        continue;
      const pending = pendingLocalFileContentsRef.current.get(file.id);
      if (pending && pending.identityMigrationSourceContent === undefined)
        continue;
      if (
        pending?.identityMigrationSourceContent !== undefined &&
        file.content !== pending.content &&
        file.content !== pending.identityMigrationSourceContent &&
        pending.identityMigrationStoredContent === (file.content ?? "") &&
        pending.identityMigrationStoredUpdatedAt === (file.updatedAt ?? null)
      )
        continue;
      publishCanonicalContent(file.id, file.content ?? "", file.fileType);
    }
  }, [
    serverFiles,
    publishCanonicalContent,
    canEditDesign,
    isSignedIn,
    activeFileId,
    viewMode,
    isSynced,
    ydoc,
  ]);

  const lastLocalContentRef = useRef<string | null>(null);
  const latestActiveContentRef = useRef<string | null>(null);
  const livePreviewContentRef = useRef<{
    fileId: string;
    content: string;
  } | null>(null);
  const staleAgentCollabRecoveryTimerRef = useRef<number | null>(null);
  const clearStaleAgentCollabRecovery = useCallback(() => {
    if (staleAgentCollabRecoveryTimerRef.current !== null) {
      window.clearTimeout(staleAgentCollabRecoveryTimerRef.current);
      staleAgentCollabRecoveryTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (previousDesignIdForHistoryRef.current === id) return;
    previousDesignIdForHistoryRef.current = id ?? null;
    clearLocalUndoRedoStacks();
    syncUndoRedoState();
  }, [clearLocalUndoRedoStacks, id, syncUndoRedoState]);

  useEffect(() => {
    if (viewMode === "overview") {
      prevActiveFileIdRef.current = activeFileId;
      livePreviewContentRef.current = null;
      setCollabContent(null);
      setCollabContentFileId(null);
      lastAppliedFileUpdatedAtRef.current = null;
      lastAppliedFileContentRef.current = null;
      lastLocalContentRef.current = null;
      latestActiveContentRef.current = null;
      clearStaleAgentCollabRecovery();
      return;
    }
    if (activeFileId !== prevActiveFileIdRef.current) {
      prevActiveFileIdRef.current = activeFileId;
      livePreviewContentRef.current = null;
      setCollabContent(null);
      setCollabContentFileId(null);
      lastAppliedFileUpdatedAtRef.current = null;
      lastAppliedFileContentRef.current = null;
      lastLocalContentRef.current = null;
      latestActiveContentRef.current = null;
      clearStaleAgentCollabRecovery();
    }
  }, [activeFileId, clearStaleAgentCollabRecovery, viewMode]);

  useEffect(() => {
    return clearStaleAgentCollabRecovery;
  }, [clearStaleAgentCollabRecovery]);
  const activeEditorDragRef = useRef(false);
  const activeEditorDragScreenIdRef = useRef<string | null>(null);
  const activeEditorDragIdRef = useRef<string | null>(null);
  const retiredEditorDragIdsRef = useRef(new Set<string>());
  const retiredEditorDragScreenIdsRef = useRef(new Set<string>());
  const latestEditorDragEventAtRef = useRef(new Map<string, number>());
  const [layerStructurePreviewByFileId, setLayerStructurePreviewByFileId] =
    useState<Record<string, LayerStructurePreview>>({});

  const canvasIframeRef = useMemo<React.RefObject<HTMLIFrameElement | null>>(
    () => ({
      get current() {
        const iframes = Array.from(
          document.querySelectorAll<HTMLIFrameElement>(
            "iframe[data-design-preview-iframe]",
          ),
        );
        if (!activeFile?.id) return iframes[0] ?? null;
        return (
          iframes.find(
            (iframe) => iframe.dataset.screenIframeId === activeFile.id,
          ) ??
          iframes[0] ??
          null
        );
      },
    }),
    [activeFile?.id],
  );

  const handleEditorDragStateChange = useCallback(
    (state: EditorDragStateChange) => {
      const dragId = state.dragId;
      const activeDragId = activeEditorDragIdRef.current;
      const previousScreenId = activeEditorDragScreenIdRef.current;
      if (
        !shouldAcceptEditorDragStateEvent(state, {
          dragId: activeDragId,
          retiredDragIds: retiredEditorDragIdsRef.current,
          retiredScreenIds: retiredEditorDragScreenIdsRef.current,
          latestEventAt: dragId
            ? latestEditorDragEventAtRef.current.get(dragId)
            : undefined,
        })
      )
        return;
      if (dragId && typeof state.eventAt === "number") {
        latestEditorDragEventAtRef.current.set(dragId, state.eventAt);
        if (latestEditorDragEventAtRef.current.size > 32) {
          const oldest = latestEditorDragEventAtRef.current.keys().next().value;
          if (oldest) latestEditorDragEventAtRef.current.delete(oldest);
        }
      }
      const screenId = state.screenId;
      const retiredScreenClear =
        state.active &&
        dragId === activeDragId &&
        screenId &&
        retiredEditorDragScreenIdsRef.current.has(screenId) &&
        state.preview?.phase === "clear";
      if (state.active && dragId && activeDragId && dragId !== activeDragId) {
        retiredEditorDragIdsRef.current.add(activeDragId);
        retiredEditorDragScreenIdsRef.current.clear();
        if (retiredEditorDragIdsRef.current.size > 32) {
          const oldest = retiredEditorDragIdsRef.current.values().next().value;
          if (oldest) retiredEditorDragIdsRef.current.delete(oldest);
        }
      }
      if (
        state.active &&
        dragId &&
        dragId === activeDragId &&
        previousScreenId &&
        screenId &&
        previousScreenId !== screenId
      ) {
        retiredEditorDragScreenIdsRef.current.add(previousScreenId);
      }
      if (state.active && dragId) activeEditorDragIdRef.current = dragId;
      if (!state.active) activeEditorDragIdRef.current = null;
      if (!state.active) retiredEditorDragScreenIdsRef.current.clear();
      if (retiredScreenClear && screenId) {
        setLayerStructurePreviewByFileId((current) => {
          if (!current[screenId]) return current;
          const next = { ...current };
          delete next[screenId];
          return next;
        });
        return;
      }
      activeEditorDragRef.current = state.active;
      activeEditorDragScreenIdRef.current = state.active
        ? (screenId ?? null)
        : null;
      const screenChanged =
        previousScreenId && previousScreenId !== (screenId ?? null);
      if (!screenId) {
        if (!previousScreenId) return;
        setLayerStructurePreviewByFileId((current) => {
          if (!current[previousScreenId]) return current;
          const next = { ...current };
          delete next[previousScreenId];
          return next;
        });
        return;
      }
      setLayerStructurePreviewByFileId((current) => {
        const preview = state.preview;
        const next = screenChanged ? { ...current } : current;
        if (screenChanged) delete next[previousScreenId];
        if (
          !state.active ||
          preview?.phase === "clear" ||
          !preview?.sourceId ||
          !preview.anchorId ||
          !preview.placement
        ) {
          if (!next[screenId]) return next;
          const cleared = { ...next };
          delete cleared[screenId];
          return cleared;
        }
        return {
          ...next,
          [screenId]: {
            sourceId: preview.sourceId,
            anchorId: preview.anchorId,
            placement: preview.placement,
            insert: preview.insert !== false,
          },
        };
      });
    },
    [],
  );

  const cancelActiveEditorDrag = useCallback(() => {
    if (!activeEditorDragRef.current) return false;
    activeEditorDragRef.current = false;
    if (typeof document === "undefined") return true;
    const pressedAt = Date.now();
    document
      .querySelectorAll<HTMLIFrameElement>("iframe[data-design-preview-iframe]")
      .forEach((iframe) => {
        iframe.contentWindow?.postMessage(
          { type: "agent-native:cancel-active-drag", pressedAt },
          "*",
        );
      });
    return true;
  }, []);

  const handleReviewFindingClick = useCallback(
    (finding: A11yFinding) => {
      const selector =
        finding.selector ??
        (finding.nodeId
          ? `[data-agent-native-node-id="${finding.nodeId.replace(/"/g, '\\"')}"]`
          : null);
      if (!selector) return;
      explicitOverviewScreenSelectionRef.current = [];
      canvasIframeRef.current?.contentWindow?.postMessage(
        {
          type: "select-element",
          selector,
          nodeId: finding.nodeId ?? undefined,
        },
        "*",
      );
      if (finding.nodeId) setSelectedLayerIdsState([finding.nodeId]);
    },
    [canvasIframeRef],
  );

  const handleCanvasBackgroundClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (viewModeRef.current === "overview") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(".design-canvas-iframe-wrapper")) return;
      if (
        target?.closest(
          "button, a, input, textarea, select, [role='menu'], [role='menuitem'], [role='dialog'], [data-radix-popper-content-wrapper]",
        )
      ) {
        return;
      }
      setSelectedElement(null);
      setHoveredElement(null);
      setHoveredElementScreenId(null);
      setSelectedLayerIdsState([]);
      setOverviewClearSelectionRequest((request) => request + 1);
    },
    [],
  );

  const mapIframeRectToViewport = useCallback(
    (iframe: HTMLIFrameElement, rect: DOMRect): DOMRect | null => {
      const frameRect = iframe.getBoundingClientRect();
      if (frameRect.width === 0 || frameRect.height === 0) return null;
      const layoutWidth = iframe.clientWidth || frameRect.width;
      const layoutHeight = iframe.clientHeight || frameRect.height;
      const scaleX = layoutWidth ? frameRect.width / layoutWidth : 1;
      const scaleY = layoutHeight ? frameRect.height / layoutHeight : 1;
      return new DOMRect(
        frameRect.left + rect.left * scaleX,
        frameRect.top + rect.top * scaleY,
        rect.width * scaleX,
        rect.height * scaleY,
      );
    },
    [],
  );

  const resolveSelectorRectInIframe = useCallback(
    (iframe: HTMLIFrameElement | null, selector: string): DOMRect | null => {
      if (!iframe) return null;
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
        // coercion-ok: cross-origin iframe access is an expected absent-geometry result.
      } catch {
        return null; // cross-origin — cannot inspect
      }
      if (!doc) return null;
      let el: Element | null = null;
      try {
        el = doc.querySelector(selector);
        // coercion-ok: an invalid selector has no inspectable geometry.
      } catch {
        return null; // invalid selector
      }
      if (!el) return null;
      return mapIframeRectToViewport(iframe, el.getBoundingClientRect());
    },
    [mapIframeRectToViewport],
  );

  const resolveTextQuoteRectInIframe = useCallback(
    (iframe: HTMLIFrameElement | null, quote: string): DOMRect | null => {
      const needle = quote.trim();
      if (!needle) return null;
      if (!iframe) return null;
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
        // coercion-ok: cross-origin iframe access is an expected absent-geometry result.
      } catch {
        return null;
      }
      if (!doc?.body) return null;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node: Node | null = walker.nextNode();
      while (node) {
        const text = node.nodeValue ?? "";
        const idx = text.indexOf(needle);
        if (idx !== -1 && node.parentElement) {
          try {
            const range = doc.createRange();
            range.setStart(node, idx);
            range.setEnd(node, idx + needle.length);
            const rect = range.getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0) {
              return mapIframeRectToViewport(iframe, rect);
            }
            // coercion-ok: a range can become invalid during DOM mutation; use the parent rect.
          } catch {
            // fall back to the parent element rect below
          }
          return mapIframeRectToViewport(
            iframe,
            node.parentElement.getBoundingClientRect(),
          );
        }
        node = walker.nextNode();
      }
      return null;
    },
    [mapIframeRectToViewport],
  );

  const resolveSelectorRect = useCallback(
    (selector: string): DOMRect | null =>
      resolveSelectorRectInIframe(canvasIframeRef.current, selector),
    [canvasIframeRef, resolveSelectorRectInIframe],
  );

  const resolveTextQuoteRect = useCallback(
    (quote: string): DOMRect | null =>
      resolveTextQuoteRectInIframe(canvasIframeRef.current, quote),
    [canvasIframeRef, resolveTextQuoteRectInIframe],
  );

  const resolveSelectionRect = useCallback(
    (descriptor: string): DOMRect | null => resolveSelectorRect(descriptor),
    [resolveSelectorRect],
  );

  const resolveRecentEditRect = useCallback(
    (edit: AttributedRecentEdit): DOMRect | null => {
      const d = edit.descriptor;
      if (d.kind === "selector" && typeof d.selector === "string") {
        return resolveSelectorRect(d.selector);
      }
      if (d.kind === "text" && typeof d.quote === "string") {
        return resolveTextQuoteRect(d.quote);
      }
      return null;
    },
    [resolveSelectorRect, resolveTextQuoteRect],
  );

  const activeCollabFileReady =
    viewMode === "single" && activeFileId === prevActiveFileIdRef.current;
  const pendingActiveFileContent = activeFile?.id
    ? pendingLocalFileContentsSnapshot.get(activeFile.id)?.content
    : undefined;
  const activeContentSource =
    pendingActiveFileContent ??
    (activeCollabFileReady &&
    collabContentFileId === activeFile?.id &&
    collabContent !== null
      ? collabContent
      : (activeFile?.content ?? ""));
  const rawActiveContent =
    typeof activeContentSource === "string" ? activeContentSource : "";
  const canonicalFileId = activeFile?.id;
  const canonicalFileType = activeFile?.fileType;
  const activeContent = useMemo(
    () =>
      canonicalFileId
        ? prepareCanonicalSourceContent(rawActiveContent, {
            fileId: canonicalFileId,
            fileType: canonicalFileType,
          }).content
        : rawActiveContent,
    [canonicalFileId, canonicalFileType, rawActiveContent],
  );
  const fileContentById = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of files) {
      map.set(file.id, typeof file.content === "string" ? file.content : "");
    }
    return map;
  }, [files]);
  const getUnprojectedScreenContent = useCallback(
    (screenId: string) =>
      prepareCanonicalSourceContent(
        getFreshScreenContent({
          screenId,
          activeFileId: activeFile?.id,
          freshActiveContentFileId: activeFile?.id,
          freshActiveContent: getFreshActiveFileContent({
            activeContent,
            pendingContent: activeFile?.id
              ? (latestFileSaveForUnloadRef.current[activeFile.id]?.content ??
                pendingLocalFileContentsRef.current.get(activeFile.id)?.content)
              : null,
            latestContent: latestActiveContentRef.current,
            lastLocalContent: lastLocalContentRef.current,
          }),
          fileContentById,
          pendingContent:
            latestFileSaveForUnloadRef.current[screenId]?.content ??
            pendingLocalFileContentsRef.current.get(screenId)?.content ??
            null,
        }),
        {
          fileId: screenId,
          fileType: rawServerFilesByIdRef.current.get(screenId)?.fileType,
        },
      ).content,
    [activeContent, activeFile?.id, fileContentById],
  );
  const getScreenContent = useCallback(
    (screenId: string) => {
      const current = getUnprojectedScreenContent(screenId);
      const linkedQueue = linkedComponentMutationQueueRef.current;
      const projected =
        linkedQueue && linkedQueue.designId === id
          ? linkedQueue.queue.getProjectedContent(screenId)
          : undefined;
      if (projected === undefined) return current;
      const pendingSave = latestFileSaveForUnloadRef.current[screenId];
      return pendingSave?.expectedVersionHash === sourceContentHash(projected)
        ? current
        : projected;
    },
    [getUnprojectedScreenContent, id],
  );
  const getProjectionContentForScreen = useCallback(
    (screenId: string) => {
      const sourceType = resolveOverviewScreenSourceType(
        overviewScreens.find((screen) => screen.id === screenId),
        designSourceType,
      );
      return sourceType === "inline"
        ? getScreenContent(screenId)
        : (liveScreenSnapshotsById[screenId]?.html ??
            getScreenContent(screenId));
    },
    [
      designSourceType,
      getScreenContent,
      liveScreenSnapshotsById,
      overviewScreens,
    ],
  );

  historySourceReaderRef.current = getProjectionContentForScreen;

  const embeddedFrameCacheRef = useRef<
    Map<string, { key: string; value: DesignCanvasEmbeddedFrame }>
  >(new Map());
  const getEmbeddedFrame = useCallback(
    (screenId: string, width: number, height: number) => {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      const key = `${w}x${h}`;
      const cache = embeddedFrameCacheRef.current;
      const cached = cache.get(screenId);
      if (cached && cached.key === key) return cached.value;
      const value: DesignCanvasEmbeddedFrame = {
        viewportWidth: w,
        viewportHeight: h,
        displayWidth: w,
        displayHeight: h,
        fluid: true,
      };
      cache.set(screenId, { key, value });
      return value;
    },
    [],
  );
  const runtimeLayerSnapshotCallbacksRef = useRef<
    Map<string, (snapshot: RuntimeLayerSnapshot) => void>
  >(new Map());
  const getRuntimeLayerSnapshotCallback = useCallback(
    (screenId: string) => {
      const cache = runtimeLayerSnapshotCallbacksRef.current;
      const cached = cache.get(screenId);
      if (cached) return cached;
      const callback = (snapshot: RuntimeLayerSnapshot) =>
        handleScreenRuntimeLayerSnapshot(screenId, snapshot);
      cache.set(screenId, callback);
      return callback;
    },
    [handleScreenRuntimeLayerSnapshot],
  );
  const runtimeLayerSnapshotReadinessCallbacksRef = useRef(
    new Map<string, (readiness: RuntimeLayerSnapshotReadiness) => void>(),
  );
  const getRuntimeLayerSnapshotReadinessCallback = useCallback(
    (screenId: string) => {
      const cache = runtimeLayerSnapshotReadinessCallbacksRef.current;
      const cached = cache.get(screenId);
      if (cached) return cached;
      const callback = (readiness: RuntimeLayerSnapshotReadiness) => {
        if (
          activeRuntimeLayerReadinessScreenIdRef.current !== screenId &&
          exportPreviewScreenIdRef.current !== screenId
        ) {
          return;
        }
        runtimeLayerSnapshotReadinessByIdRef.current[screenId] = readiness;
        if (activeRuntimeLayerReadinessScreenIdRef.current === screenId) {
          setRuntimeLayerSnapshotReadiness({ screenId, readiness });
        }
      };
      cache.set(screenId, callback);
      return callback;
    },
    [],
  );
  const runtimeVerificationSnapshotCallbacksRef = useRef<
    Map<
      string,
      (snapshot: RuntimeLayerSnapshot & { requestId: number }) => void
    >
  >(new Map());
  const getRuntimeVerificationSnapshotCallback = useCallback(
    (screenId: string) => {
      const cache = runtimeVerificationSnapshotCallbacksRef.current;
      const cached = cache.get(screenId);
      if (cached) return cached;
      const callback = (
        snapshot: RuntimeLayerSnapshot & { requestId: number },
      ) => handleScreenRuntimeVerificationSnapshot(screenId, snapshot);
      cache.set(screenId, callback);
      return callback;
    },
    [handleScreenRuntimeVerificationSnapshot],
  );
  const recordPendingVisualStyleEdit = useCallback(
    (
      screenId: string,
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
      metadata?: {
        originalStyles?: Record<string, string>;
        interactionState?: InteractionState;
        pendingUndoGestureId?: string;
        preserveSelection?: boolean;
        routePath?: string;
        relativeOperations?: Record<string, PendingRelativeStyleOperation>;
      },
    ) =>
      runRecordPendingVisualStyleEdit(
        {
          activeBreakpointUpperBoundPx,
          activeBreakpointWidthState,
          activeFile,
          canEditDesign,
          canEditLiveScreens: canEditLiveScreenIdsRef.current,
          cancelPendingStructureVerification,
          clipboardPasteRedoStackRef,
          files,
          getProjectionContentForScreen,
          localhostConnectionRootPathByIdRef,
          overviewScreens,
          pendingLiveNonStyleRedoStackRef,
          pendingStructureRedoReplayRef,
          pendingStructureRedoReplayTimerRef,
          pendingVisualStyleEditsRef,
          pendingVisualStyleRedoStackRef,
          pendingVisualStyleUndoStackRef,
          recordPendingHistoryEntry,
          responsiveEditScopeRef,
          runtimeLayerSnapshotsById,
          selectedElement,
          onNoRenderedBox: () =>
            toast.error(t("designEditor.patchProof.noRenderedBox"), {
              id: "design-no-rendered-box",
              duration: 4000,
            }),
          setPatchProof,
          setPendingVisualStyleEdits,
          setSelectedElement,
          setSelectedLayerIdsState,
        },
        screenId,
        selector,
        styles,
        elementInfo,
        metadata,
      ),
    [
      activeBreakpointUpperBoundPx,
      activeBreakpointWidthState,
      activeFile?.id,
      canEditDesign,
      cancelPendingStructureVerification,
      files,
      getProjectionContentForScreen,
      overviewScreens,
      recordPendingHistoryEntry,
      runtimeLayerSnapshotsById,
      selectedElement?.computedStyles,
      selectedElement?.inlineStyles,
      selectedElement?.sourceId,
    ],
  );

  const recordPendingLiveTextEdit = useCallback(
    (
      screenId: string,
      selector: string,
      value: string,
      elementInfo?: ElementInfo,
      details?: {
        html?: string;
        originalValue?: string;
        originalHtml?: string;
        routePath?: string;
        relativeOperations?: Record<string, PendingRelativeStyleOperation>;
      },
    ) =>
      runRecordPendingLiveTextEdit(
        {
          activeFile,
          canEditDesign,
          canEditLiveScreens: canEditLiveScreenIdsRef.current,
          cancelPendingStructureVerification,
          files,
          localhostConnectionRootPathByIdRef,
          overviewScreens,
          pendingLiveNonStyleEditsRef,
          pendingLiveNonStyleRedoStackRef,
          pendingLiveNonStyleUndoStackRef,
          pendingStructureRedoReplayRef,
          pendingStructureRedoReplayTimerRef,
          pendingVisualStyleRedoStackRef,
          recordPendingHistoryEntry,
          canCoalescePendingLiveEdit: () =>
            historyOrderRef.current[historyOrderRef.current.length - 1] ===
            "pending-live",
          runtimeLayerSnapshotsById,
          selectedElement,
          setPendingLiveNonStyleEdits,
        },
        screenId,
        selector,
        value,
        elementInfo,
        details,
      ),
    [
      activeFile?.id,
      canEditDesign,
      cancelPendingStructureVerification,
      files,
      overviewScreens,
      recordPendingHistoryEntry,
      runtimeLayerSnapshotsById,
      selectedElement?.htmlContent,
      selectedElement?.sourceId,
      selectedElement?.textContent,
    ],
  );

  const recordPendingLiveLayerStateEdit = useCallback(
    (
      layerId: string,
      state: "hidden" | "locked",
      enabled: boolean,
      originalEnabled: boolean,
    ) =>
      runRecordPendingLiveLayerStateEdit(
        {
          canEditDesign,
          canEditLiveScreens: canEditLiveScreenIdsRef.current,
          cancelPendingStructureVerification,
          clipboardPasteRedoStackRef,
          codeLayerOwnerByNodeIdRef,
          files,
          localhostConnectionRootPathByIdRef,
          overviewScreens,
          pendingLiveNonStyleEditsRef,
          pendingLiveNonStyleRedoStackRef,
          pendingLiveNonStyleUndoStackRef,
          pendingVisualStyleRedoStackRef,
          recordPendingHistoryEntry,
          runtimeLayerSnapshotsById,
          setPendingLiveNonStyleEdits,
        },
        layerId,
        state,
        enabled,
        originalEnabled,
        liveRoutePathsByScreenIdRef.current[
          codeLayerOwnerByNodeIdRef.current.get(layerId)?.fileId ?? ""
        ],
      ),
    [
      canEditDesign,
      cancelPendingStructureVerification,
      files,
      overviewScreens,
      recordPendingHistoryEntry,
      runtimeLayerSnapshotsById,
    ],
  );
  const recordPendingLiveLayerNameEdit = useCallback(
    (
      layerId: string,
      name: string,
      originalName?: string,
      routePath?: string,
    ) => {
      const owner = codeLayerOwnerByNodeIdRef.current.get(layerId);
      if (!owner || !canEditLiveScreenIdsRef.current.has(owner.fileId)) {
        return false;
      }
      const screen = overviewScreens.find(
        (candidate) => candidate.id === owner.fileId,
      );
      if (resolveOverviewScreenSourceType(screen) !== "localhost") {
        return false;
      }
      const info = elementInfoFromCodeLayerNode(owner.node);
      const sourceId = bridgeSourceIdForCodeLayerNode(owner.node);
      const selector = preferredCodeLayerSelector(owner.node);
      const fallbackName =
        files.find((file) => file.id === owner.fileId)?.filename ??
        owner.fileId;
      const nextEdit: PendingLiveLayerNameEdit = {
        kind: "layer-name",
        screenId: owner.fileId,
        filename: fallbackName,
        screenName: prettyScreenName(fallbackName),
        layerId,
        selector,
        sourceId,
        ...(routePath || liveRoutePathsByScreenIdRef.current[owner.fileId]
          ? {
              routePath:
                routePath ?? liveRoutePathsByScreenIdRef.current[owner.fileId],
            }
          : {}),
        sourceAnchor: reactSourceAnchorForPendingEdit({
          info,
          id: sourceId,
          rootPath: screen?.connectionId
            ? localhostConnectionRootPathByIdRef.current.get(
                screen.connectionId,
              )
            : undefined,
          runtimeMultiplicity: runtimeMultiplicityForElementProvenance(
            runtimeLayerSnapshotsById,
            info,
          ),
          reason: `Pending live layer rename for ${layerId} in screen ${owner.fileId}.`,
        }),
        tagName: info.tagName ?? null,
        classes: info.classes ?? [],
        name,
        originalName:
          originalName ??
          owner.node.dataAttributes["data-agent-native-layer-name"] ??
          "",
        updatedAt: nextPendingLiveEditTimestamp(),
      };
      const revertName = pendingLiveLayerNameUndoRevertValue(
        pendingLiveNonStyleEditsRef.current,
        nextEdit,
      );
      cancelPendingStructureVerification("conflict");
      pendingLiveNonStyleRedoStackRef.current = [];
      pendingVisualStyleRedoStackRef.current = [];
      clipboardPasteRedoStackRef.current = [];
      const previousUndoLength = pendingLiveNonStyleUndoStackRef.current.length;
      appendPendingLiveNonStyleUndoEntry(
        pendingLiveNonStyleUndoStackRef.current,
        { kind: "layer-name", edit: nextEdit, revertName },
        historyOrderRef.current[historyOrderRef.current.length - 1] ===
          "pending-live",
      );
      if (pendingLiveNonStyleUndoStackRef.current.length > previousUndoLength) {
        recordPendingHistoryEntry("pending-live");
      }
      const nextPending = mergePendingLiveNonStyleEdit(
        pendingLiveNonStyleEditsRef.current,
        nextEdit,
      );
      pendingLiveNonStyleEditsRef.current = nextPending;
      setPendingLiveNonStyleEdits(nextPending);
      return true;
    },
    [
      cancelPendingStructureVerification,
      files,
      overviewScreens,
      recordPendingHistoryEntry,
      runtimeLayerSnapshotsById,
    ],
  );

  const sendRuntimeLayerMoveSemanticHandoff = useCallback(
    (
      subjectLayerId: string,
      targetLayerId: string,
      placement: "before" | "after" | "inside",
      gridPlacement?: ReactGridPlacement,
    ): boolean =>
      runSendRuntimeLayerMoveSemanticHandoff(
        {
          codeLayerOwnerByNodeIdRef,
          localhostConnectionRootPathByIdRef,
          overviewScreens,
          runtimeLayerSnapshotsById,
          setActiveLeftPanel,
          t,
        },
        subjectLayerId,
        targetLayerId,
        placement,
        gridPlacement,
      ),
    [overviewScreens, runtimeLayerSnapshotsById, t],
  );

  const handleZoomToFit = useCallback(() => {
    viewModeRef.current = "overview";
    setViewMode("overview");
    setActiveTool("move");
    const frames = withMeasuredFrameHeights(
      getAllScreenFrameEntries({
        overviewScreens,
        canvasFrameGeometryById: exportCanvasFrameGeometryById,
        boardContentBounds,
        boardFileId,
      }),
      measuredScreenHeightByIdRef.current,
      pinnedHeightScreenIds(overviewScreens),
      autoHeightScreenIds(overviewScreens),
    );
    const bounds = getFrameGroupBounds(frames);
    if (!bounds) {
      setExplicitOverviewCanvasZoom(100);
      return;
    }
    cameraCommandNonceRef.current += 1;
    setCameraCommand({
      fitBounds: bounds,
      nonce: cameraCommandNonceRef.current,
    });
  }, [
    boardFileId,
    boardContentBounds,
    exportCanvasFrameGeometryById,
    overviewScreens,
  ]);

  const handleLayerLeave = useCallback((_layerId: string) => {
    setHoveredElement(null);
    setHoveredElementScreenId(null);
  }, []);

  return {
    suppressLineupRecenter,
    localhostConnectionRootPathByIdRef,
    hoveredElementScreenId,
    setHoveredElementScreenId,
    overviewClearSelectionRequest,
    setOverviewClearSelectionRequest,
    recordPendingHistoryEntry,
    exportPreviewScreenIdRef,
    currentUser,
    canEditLiveScreenIdsRef,
    runtimeLayerSnapshotReadiness,
    runtimeLayerSnapshotReadinessByIdRef,
    boardContentBounds,
    optimisticallyInsertCreatedFile,
    focusCreatedScreen,
    handleDuplicateScreen,
    handleAddScreen,
    handleCreateScreenFrame,
    handleCreateScreenFromPreset,
    ydoc,
    awareness,
    isSynced,
    activeUsers,
    agentPresent,
    agentActive,
    overviewPresenceFileId,
    overviewAwareness,
    overviewYdoc,
    overviewIsSynced,
    overviewActiveUsers,
    overviewAgentPresent,
    overviewAgentActive,
    collabContent,
    setCollabContent,
    collabContentFileId,
    setCollabContentFileId,
    lastAppliedFileUpdatedAtRef,
    lastAppliedFileContentRef,
    lastLocalContentRef,
    latestActiveContentRef,
    livePreviewContentRef,
    staleAgentCollabRecoveryTimerRef,
    clearStaleAgentCollabRecovery,
    activeEditorDragRef,
    activeEditorDragScreenIdRef,
    layerStructurePreviewByFileId,
    setLayerStructurePreviewByFileId,
    canvasIframeRef,
    handleEditorDragStateChange,
    cancelActiveEditorDrag,
    handleReviewFindingClick,
    handleCanvasBackgroundClick,
    resolveSelectorRectInIframe,
    resolveTextQuoteRectInIframe,
    resolveSelectorRect,
    resolveSelectionRect,
    resolveRecentEditRect,
    rawActiveContent,
    activeContent,
    fileContentById,
    getUnprojectedScreenContent,
    getScreenContent,
    getProjectionContentForScreen,
    getEmbeddedFrame,
    getRuntimeLayerSnapshotCallback,
    getRuntimeLayerSnapshotReadinessCallback,
    getRuntimeVerificationSnapshotCallback,
    recordPendingVisualStyleEdit,
    recordPendingLiveTextEdit,
    recordPendingLiveLayerStateEdit,
    recordPendingLiveLayerNameEdit,
    sendRuntimeLayerMoveSemanticHandoff,
    handleZoomToFit,
    handleLayerLeave,
  };
}

export type EditorCanvasAndScreens = ReturnType<
  typeof useEditorCanvasAndScreens
>;
