import {
  builderPreviewOrigin,
  isBuilderPreviewUrl,
} from "@shared/builder-preview-url";
import type { InteractionState } from "@shared/interaction-states";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as Y from "yjs";

import {
  recordDesignPerformance,
  trace,
} from "@/components/design/design-trace";
import {
  type InspectorTab,
  type StyleChangeMeta,
} from "@/components/design/EditPanel";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import type { ElementInfo } from "@/components/design/types";
import { rememberBuilderHostOrigin } from "@/lib/builder-host-origin";
import { type ClipboardContentLineage } from "@/lib/clipboard-content-lineage";
import { shellContextChanged, type ShellDesignInput } from "@/lib/shell-design";
import {
  captureHistorySelectionSources,
  captureHistorySelectionFromOwners,
} from "@/pages/design-editor/history-identity";

import {
  type CodeLayerOwner,
  collectCodeLayerAncestors,
} from "../code-layer-state";
import { type DuplicateScreenRecoveryEntry } from "../commands/duplicate-screen";
import {
  flushPendingFileCreationHistoryEntries as flushFileCreationHistoryEntries,
  recordFileCreationHistoryEntry as recordFileCreationHistoryEntryCommand,
  type PendingFileCreationHistoryEntry,
} from "../commands/file-creation-history";
import { createLinkedComponentMutationQueue } from "../commands/linked-component-mutation";
import { runStartSidebarResize } from "../commands/start-sidebar-resize";
import {
  MOTION_DOCK_EXIT_FALLBACK_MS,
  MOTION_DOCK_EXIT_SETTLE_MS,
} from "../editor-constants";
import { reloadRunningAppPreviewFrames } from "../editor-helpers";
import {
  removeUndoRedoOrderKind,
  type UndoRedoOrderKind,
} from "../editor-state";
import { focusAgentComposer } from "../effects/focus-agent-composer";
import {
  type ContentHistoryChange,
  type ContentHistoryEntry,
  type FileCreationHistoryEntry,
  type FileDeletionHistoryEntry,
  finalizeTextCreationHistory,
  findLastContentHistoryChangeIndex,
  hasContentHistoryChange,
  contentHistoryScopeForViewMode,
  getContentHistoryChanges,
  type GeometryHistoryEntry,
  type GeometryHistorySelection,
  type PendingTextCreationHistory,
  type SelectionHistoryEntry,
  MAX_DESIGN_UNDO_STACK,
  mergeLocalContentHistoryFallback,
  removeRecentUndoRedoOrderKinds,
} from "../history";
import { scopedLayerStateId } from "../layer-state-scope";
import { DEFAULT_LEFT_SIDEBAR_WIDTH } from "../left-sidebar-width";
import {
  getPendingVisualEditCount,
  pendingLiveEditFrameTargets,
  pendingLiveStructureEditsFromEdit,
  pendingLiveStructureEditsFromUndoEntry,
  shouldFinalizePendingLiveEditReload,
  type PendingLiveNonStyleEdit,
  type PendingLiveNonStyleUndoEntry,
  type PendingLiveStructureEdit,
  type PendingLiveStructureUndoEntry,
  type PendingVisualStyleEdit,
  type PendingVisualStyleUndoEntry,
  shouldClearPendingLiveEditsAfterReload,
} from "../pending-edits";
import { type DesignLeftPanel } from "../types";
import type { EditorCore } from "./use-editor-core";

export function useEditorHistory({ editorCore }: { editorCore: EditorCore }) {
  const {
    id,
    embedChromeRequested,
    hostOwnsChrome,
    hostEmbeddedEditor,
    viewMode,
    viewModeRef,
    selectedElement,
    pendingEditSessionDesignIdRef,
    clearPendingEditSessionRecovery,
    pendingVisualStyleRevertRequest,
    setPendingVisualStyleRevertRequest,
    pendingTextRevertRequest,
    setPendingTextRevertRequest,
    pendingLayerStateReplayRequest,
    setPendingLayerStateReplayRequest,
    pendingLayerNameReplayRequest,
    setPendingLayerNameReplayRequest,
    pendingStructureAckRequest,
    setPendingStructureAckRequest,
    liveRoutePathsByScreenIdRef,
    pendingVisualEditClearRequestedRef,
    pendingVisualEditHadPendingRef,
    pendingVisualEditHandoffPublicationRef,
    pendingVisualEditReloadedHandoffRef,
    pendingStructureRedoReplayTimerRef,
    cancelPendingStructureVerification,
    minimalUiByDefault,
  } = editorCore;

  const hostChatGeneratingRef = useRef(false);

  const isBuilderDesignEmbed = useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      new URLSearchParams(window.location.search).get("design_host") ===
      "builder"
    );
  }, []);
  const [builderPreviewUrl, setBuilderPreviewUrl] = useState<string | null>(
    null,
  );
  const [shellInput, setShellInput] = useState<ShellDesignInput | null>(null);
  const parentOriginRef = useRef<string | null>(null);
  const [pendingVisualStyleEdits, setPendingVisualStyleEdits] = useState<
    PendingVisualStyleEdit[]
  >([]);
  const [pendingLiveNonStyleEdits, setPendingLiveNonStyleEdits] = useState<
    PendingLiveNonStyleEdit[]
  >([]);
  const pendingVisualStyleEditsRef = useRef<PendingVisualStyleEdit[]>([]);
  const pendingLiveNonStyleEditsRef = useRef<PendingLiveNonStyleEdit[]>([]);
  const pendingLiveEditReloadedTargetsRef = useRef<Set<string>>(new Set());
  const liveScreenIdsRef = useRef<ReadonlySet<string>>(new Set());
  const pendingVisualStyleUndoStackRef = useRef<PendingVisualStyleUndoEntry[]>(
    [],
  );
  const pendingVisualStyleRedoStackRef = useRef<PendingVisualStyleUndoEntry[]>(
    [],
  );
  const pendingLiveNonStyleUndoStackRef = useRef<
    PendingLiveNonStyleUndoEntry[]
  >([]);
  const pendingLiveNonStyleRedoStackRef = useRef<
    PendingLiveNonStyleUndoEntry[]
  >([]);
  const pendingStructureRedoReplayRef = useRef<
    PendingLiveStructureUndoEntry | undefined
  >(undefined);
  const stagedSourceHandoffRef = useRef<"idle" | "awaiting-start" | "running">(
    "idle",
  );
  const stagedHandoffStartTimerRef = useRef<number | undefined>(undefined);
  const [applyingViaHost, setApplyingViaHost] = useState(false);
  const [activeInspectorTab, setActiveInspectorTab] =
    useState<InspectorTab>("design");
  const activeInspectorTabRef = useRef(activeInspectorTab);
  activeInspectorTabRef.current = activeInspectorTab;
  const [activeLeftPanel, setActiveLeftPanel] =
    useState<DesignLeftPanel | null>("file");
  const collapseLeftPanel = useCallback(() => setActiveLeftPanel(null), []);
  // The workbench loads Monaco and follows the selection with source reads, so
  // it mounts on first open and then stays mounted to keep its state.
  const codeWorkbenchOpenedRef = useRef(false);
  if (activeLeftPanel === "code") codeWorkbenchOpenedRef.current = true;
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(
    DEFAULT_LEFT_SIDEBAR_WIDTH,
  );
  const [rightSidebarWidth, setRightSidebarWidth] = useState(240);
  const [minimalUi, setMinimalUi] = useState(minimalUiByDefault);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const leftSidebarContentRef = useRef<HTMLDivElement | null>(null);
  const rightSidebarContentRef = useRef<HTMLDivElement | null>(null);
  const [expandedLayerIds, setExpandedLayerIds] = useState<string[]>([]);
  const expandedLayerIdsRef = useRef(expandedLayerIds);
  expandedLayerIdsRef.current = expandedLayerIds;
  // Reveals run after every selection and every edit; setting an unchanged list
  // still re-renders the whole editor, so only a real addition sets state.
  const revealLayerIds = useCallback((ids: Iterable<string>) => {
    const wanted = [...ids];
    const shown = new Set(expandedLayerIdsRef.current);
    if (wanted.every((id) => shown.has(id))) return;
    // Merge in the updater: the ref lags other updates queued this tick.
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      for (const id of wanted) next.add(id);
      return next.size === current.length ? current : Array.from(next);
    });
  }, []);
  const [selectedLayerIdsState, setSelectedLayerIdsState] = useState<string[]>(
    [],
  );
  const selectedScreenStyleChangeRef = useRef<
    | ((
        screenId: string,
        selector: string,
        styles: Record<string, string>,
        elementInfo?: ElementInfo,
        metadata?: StyleChangeMeta,
      ) => void)
    | null
  >(null);
  const renderedElementInfoByLayerKeyRef = useRef<Map<string, ElementInfo>>(
    new Map(),
  );
  const renderedElementInfoRevisionRef = useRef(0);
  const rehydrateRenderedElementInfoRef = useRef<(() => void) | null>(null);
  const renderedInfoRehydratePendingRef = useRef(false);
  const invalidateRenderedElementInfo = useCallback(() => {
    renderedElementInfoByLayerKeyRef.current.clear();
    renderedElementInfoRevisionRef.current += 1;
    renderedInfoRehydratePendingRef.current = true;
  }, []);
  const rehydrateRenderedInfoAfterPreview = useCallback(() => {
    if (!renderedInfoRehydratePendingRef.current) return;
    renderedInfoRehydratePendingRef.current = false;
    queueMicrotask(() => rehydrateRenderedElementInfoRef.current?.());
  }, []);
  const codeLayerOwnerByNodeIdRef = useRef<ReadonlyMap<string, CodeLayerOwner>>(
    new Map(),
  );
  const revealLayer = useCallback(
    (layerId: string) => {
      const owner = codeLayerOwnerByNodeIdRef.current.get(layerId);
      if (!owner) return;
      revealLayerIds([
        owner.fileId,
        ...collectCodeLayerAncestors(owner.tree, layerId),
      ]);
    },
    [revealLayerIds],
  );
  const [overviewSelectedScreenIds, setOverviewSelectedScreenIds] = useState<
    string[]
  >([]);
  const [createdOverviewLayerSelection, setCreatedOverviewLayerSelection] =
    useState<{
      screenId: string;
      layerId: string;
    } | null>(null);
  const pendingOverviewScreenSelectionRef = useRef<string | null>(null);
  const pendingOverviewLayerSelectionRef = useRef<string | null>(null);
  const hasActiveSelectionRef = useRef(false);
  const pendingTextCreationHistoryRef =
    useRef<PendingTextCreationHistory | null>(null);
  const pendingOverviewLayerSelectionClearTimerRef = useRef<number | null>(
    null,
  );

  const clearPendingOverviewLayerSelectionTimer = useCallback(() => {
    if (pendingOverviewLayerSelectionClearTimerRef.current === null) return;
    window.clearTimeout(pendingOverviewLayerSelectionClearTimerRef.current);
    pendingOverviewLayerSelectionClearTimerRef.current = null;
  }, []);
  const schedulePendingOverviewLayerSelectionClear = useCallback(
    (layerId: string) => {
      clearPendingOverviewLayerSelectionTimer();
      pendingOverviewLayerSelectionClearTimerRef.current = window.setTimeout(
        () => {
          if (pendingOverviewLayerSelectionRef.current === layerId) {
            pendingOverviewLayerSelectionRef.current = null;
          }
          setCreatedOverviewLayerSelection((current) =>
            current?.layerId === layerId ? null : current,
          );
          pendingOverviewLayerSelectionClearTimerRef.current = null;
        },
        1800,
      );
    },
    [clearPendingOverviewLayerSelectionTimer],
  );
  const [lockedLayerIds, setLockedLayerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const layerStateOverridesRef = useRef<
    Map<string, { hidden?: boolean; locked?: boolean }>
  >(new Map());
  const applyLayerStatePreview = useCallback(
    (
      screenId: string,
      layerId: string,
      state: "hidden" | "locked",
      enabled: boolean,
    ) => {
      const scopedId = scopedLayerStateId(screenId, layerId);
      layerStateOverridesRef.current.set(scopedId, {
        ...layerStateOverridesRef.current.get(scopedId),
        [state]: enabled,
      });
      const update = (current: Set<string>) => {
        const next = new Set(current);
        if (enabled) next.add(scopedId);
        else next.delete(scopedId);
        return next;
      };
      if (state === "hidden") setHiddenLayerIds(update);
      else setLockedLayerIds(update);
    },
    [],
  );
  const [hasSystemClipboardImages, setHasSystemClipboardImages] =
    useState(false);
  const menuClipboardReadIdRef = useRef(0);
  const latestClipboardMutationContentRef = useRef<
    Map<string, ClipboardContentLineage>
  >(new Map());
  const clipboardPasteUndoStackRef = useRef<ContentHistoryChange[]>([]);
  const clipboardPasteRedoStackRef = useRef<ContentHistoryChange[]>([]);
  const hasSelectedElement = Boolean(selectedElement);

  const [motionDockOpen, setMotionDockOpen] = useState(false);
  const [motionDockMounted, setMotionDockMounted] = useState(false);
  const motionDockUnmountTimerRef = useRef<number | null>(null);
  const motionDockOpenAnimationFrameRef = useRef<number | null>(null);
  const motionAutosaveTimerRef = useRef<number | null>(null);
  const motionAutosaveFlushRef = useRef<(() => void) | null>(null);
  const clearMotionDockUnmountTimer = useCallback(() => {
    if (motionDockUnmountTimerRef.current === null) return;
    window.clearTimeout(motionDockUnmountTimerRef.current);
    motionDockUnmountTimerRef.current = null;
  }, []);
  const clearMotionDockOpenAnimationFrame = useCallback(() => {
    if (
      typeof window === "undefined" ||
      motionDockOpenAnimationFrameRef.current === null
    ) {
      return;
    }
    window.cancelAnimationFrame(motionDockOpenAnimationFrameRef.current);
    motionDockOpenAnimationFrameRef.current = null;
  }, []);
  const clearMotionAutosaveTimer = useCallback(() => {
    motionAutosaveFlushRef.current = null;
    if (motionAutosaveTimerRef.current === null) return;
    window.clearTimeout(motionAutosaveTimerRef.current);
    motionAutosaveTimerRef.current = null;
  }, []);
  const setMotionDockOpenAnimated = useCallback(
    (open: boolean) => {
      clearMotionDockUnmountTimer();
      clearMotionDockOpenAnimationFrame();
      if (open) {
        setMotionDockMounted(true);
        if (typeof window === "undefined") {
          setMotionDockOpen(true);
          return;
        }
        motionDockOpenAnimationFrameRef.current = window.requestAnimationFrame(
          () => {
            motionDockOpenAnimationFrameRef.current =
              window.requestAnimationFrame(() => {
                setMotionDockOpen(true);
                motionDockOpenAnimationFrameRef.current = null;
              });
          },
        );
        return;
      }

      setMotionDockOpen(false);
      if (typeof window === "undefined") {
        setMotionDockMounted(false);
        return;
      }
      motionDockUnmountTimerRef.current = window.setTimeout(() => {
        setMotionDockMounted(false);
        motionDockUnmountTimerRef.current = null;
      }, MOTION_DOCK_EXIT_FALLBACK_MS);
    },
    [clearMotionDockOpenAnimationFrame, clearMotionDockUnmountTimer],
  );
  const handleMotionDockExitComplete = useCallback(() => {
    if (motionDockOpen) return;
    clearMotionDockUnmountTimer();
    if (typeof window === "undefined") {
      setMotionDockMounted(false);
      return;
    }
    motionDockUnmountTimerRef.current = window.setTimeout(() => {
      setMotionDockMounted(false);
      motionDockUnmountTimerRef.current = null;
    }, MOTION_DOCK_EXIT_SETTLE_MS);
  }, [clearMotionDockUnmountTimer, motionDockOpen]);
  const [shaderFillPreview, setShaderFillPreview] = useState<{
    selector?: string;
    nodeId?: string;
    css: string;
  } | null>(null);
  const shaderFillPreviewActiveRef = useRef(false);
  shaderFillPreviewActiveRef.current = shaderFillPreview !== null;

  const [activeBreakpointWidthState, setActiveBreakpointWidthState] = useState<
    number | undefined
  >(undefined);
  const activeBreakpointWidthStateRef = useRef<number | undefined>(undefined);

  const [activeInteractionStateState, setActiveInteractionStateState] =
    useState<InteractionState | null>(null);
  const activeInteractionStateStateRef = useRef(activeInteractionStateState);
  activeInteractionStateStateRef.current = activeInteractionStateState;

  const builderHostProtocolActive = isBuilderDesignEmbed || hostEmbeddedEditor;

  const focusDesignInspectorForSelection = useCallback(() => {
    if (activeInspectorTabRef.current !== "design") {
      setActiveInspectorTab("design");
    }
  }, []);

  const startSidebarResize = useCallback(
    (side: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) =>
      runStartSidebarResize(
        {
          activeLeftPanel,
          leftSidebarContentRef,
          leftSidebarWidth,
          rightSidebarContentRef,
          rightSidebarWidth,
          setLeftSidebarWidth,
          setRightSidebarWidth,
        },
        side,
        event,
      ),
    [activeLeftPanel, leftSidebarWidth, rightSidebarWidth],
  );
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const linkedComponentMutationQueueRef = useRef<{
    designId: string;
    queue: ReturnType<typeof createLinkedComponentMutationQueue>;
  } | null>(null);
  const contentUndoStackRef = useRef<ContentHistoryEntry[]>([]);
  const contentRedoStackRef = useRef<ContentHistoryEntry[]>([]);
  const contentUndoSelectionStackRef = useRef<
    (GeometryHistorySelection | undefined)[]
  >([]);
  const contentRedoSelectionStackRef = useRef<
    (GeometryHistorySelection | undefined)[]
  >([]);
  const localContentUndoStackRef = useRef<ContentHistoryChange[]>([]);
  const localContentRedoStackRef = useRef<ContentHistoryChange[]>([]);
  const activeFileIdForUndoRef = useRef<string | null>(null);
  const geometryUndoStackRef = useRef<GeometryHistoryEntry[]>([]);
  const geometryRedoStackRef = useRef<GeometryHistoryEntry[]>([]);
  const selectedLayerIdsStateRef = useRef<string[]>([]);
  const overviewSelectedScreenIdsRef = useRef<string[]>([]);
  const explicitOverviewScreenSelectionRef = useRef<string[]>([]);
  const fileCreationUndoStackRef = useRef<FileCreationHistoryEntry[]>([]);
  const fileCreationRedoStackRef = useRef<FileCreationHistoryEntry[]>([]);
  const pendingFileCreationHistoryEntriesRef = useRef<
    PendingFileCreationHistoryEntry[]
  >([]);
  const pendingDuplicateGeometriesRef = useRef<Map<string, FrameGeometry>>(
    new Map(),
  );
  const pendingDuplicateFilenamesRef = useRef<Set<string>>(new Set());
  const duplicateInFlightRef = useRef<Set<string>>(new Set());
  const duplicateRecoveryRef = useRef<
    Map<string, DuplicateScreenRecoveryEntry>
  >(new Map());
  const fileDeletionUndoStackRef = useRef<FileDeletionHistoryEntry[]>([]);
  const fileDeletionRedoStackRef = useRef<FileDeletionHistoryEntry[]>([]);
  // Screen creation and deletion history recreate or remove SQL rows asynchronously.
  // Disable history replay while one is in flight so a rapid second Cmd+Z
  // cannot race a create against the pending delete.
  const fileHistoryMutationPendingRef = useRef(false);
  const pendingHistoryDirectionsRef = useRef<Array<"undo" | "redo">>([]);
  const pendingHistoryDrainScheduledRef = useRef(false);
  const replayPendingHistoryRef = useRef<
    ((direction: "undo" | "redo") => void) | null
  >(null);
  const historyOrderRef = useRef<(UndoRedoOrderKind | "selection")[]>([]);
  const redoOrderRef = useRef<(UndoRedoOrderKind | "selection")[]>([]);
  const clearPendingLiveEditState = useCallback(
    (options: { preserveDurableHandoff?: boolean } = {}) => {
      pendingLiveEditReloadedTargetsRef.current.clear();
      if (
        id &&
        (pendingVisualStyleEditsRef.current.length > 0 ||
          pendingLiveNonStyleEditsRef.current.length > 0)
      ) {
        if (
          options.preserveDurableHandoff &&
          pendingVisualEditHandoffPublicationRef.current?.designId === id
        ) {
          pendingVisualEditReloadedHandoffRef.current = {
            ...pendingVisualEditHandoffPublicationRef.current,
          };
          pendingVisualEditClearRequestedRef.current = null;
          pendingVisualEditHadPendingRef.current = null;
        } else {
          pendingVisualEditClearRequestedRef.current = id;
        }
      }
      stagedSourceHandoffRef.current = "idle";
      setApplyingViaHost(false);
      if (pendingEditSessionDesignIdRef.current === id) {
        clearPendingEditSessionRecovery();
      }
      if (stagedHandoffStartTimerRef.current !== undefined) {
        window.clearTimeout(stagedHandoffStartTimerRef.current);
        stagedHandoffStartTimerRef.current = undefined;
      }
      cancelPendingStructureVerification();
      pendingVisualStyleUndoStackRef.current = [];
      pendingVisualStyleRedoStackRef.current = [];
      pendingLiveNonStyleUndoStackRef.current = [];
      pendingLiveNonStyleRedoStackRef.current = [];
      historyOrderRef.current = historyOrderRef.current.filter(
        (kind) => kind !== "pending-style" && kind !== "pending-live",
      );
      redoOrderRef.current = redoOrderRef.current.filter(
        (kind) => kind !== "pending-style" && kind !== "pending-live",
      );
      pendingStructureRedoReplayRef.current = undefined;
      if (pendingStructureRedoReplayTimerRef.current !== undefined) {
        window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
        pendingStructureRedoReplayTimerRef.current = undefined;
      }
      pendingVisualStyleEditsRef.current = [];
      pendingLiveNonStyleEditsRef.current = [];
      setPendingVisualStyleEdits([]);
      setPendingLiveNonStyleEdits([]);
    },
    [cancelPendingStructureVerification, clearPendingEditSessionRecovery, id],
  );
  const clearPendingLiveEditStateRef = useRef(clearPendingLiveEditState);
  useEffect(() => {
    clearPendingLiveEditStateRef.current = clearPendingLiveEditState;
  }, [clearPendingLiveEditState]);
  const clearReloadedPendingLiveEdits = useCallback(() => {
    const pendingTargets = pendingLiveEditFrameTargets(
      pendingVisualStyleEditsRef.current,
      pendingLiveNonStyleEditsRef.current,
    );
    const reloadedTargets = pendingLiveEditReloadedTargetsRef.current;
    const handoff = pendingVisualEditHandoffPublicationRef.current;
    if (
      !shouldFinalizePendingLiveEditReload({
        pendingTargets,
        reloadedTargets,
        handoff,
        designId: id,
      })
    ) {
      return;
    }
    clearPendingLiveEditStateRef.current({
      preserveDurableHandoff:
        handoff !== null &&
        handoff.designId === id &&
        handoff.serverRevision !== null,
    });
  }, [id]);
  const handleLiveScreenRuntimeReload = useCallback(
    (screenId: string, frameId: string) => {
      const pendingTargets = pendingLiveEditFrameTargets(
        pendingVisualStyleEditsRef.current,
        pendingLiveNonStyleEditsRef.current,
      );
      // HMR only resets URL-backed previews; it must not discard static edits.
      if (
        !pendingTargets.has(screenId) ||
        Array.from(pendingTargets.keys()).some(
          (pendingScreenId) => !liveScreenIdsRef.current.has(pendingScreenId),
        )
      ) {
        return;
      }
      const reloadedTargets = pendingLiveEditReloadedTargetsRef.current;
      reloadedTargets.add(`${screenId}\0${frameId}`);
      if (
        shouldClearPendingLiveEditsAfterReload(
          pendingTargets,
          reloadedTargets,
          screenId,
          frameId,
        )
      ) {
        clearReloadedPendingLiveEdits();
      }
    },
    [clearReloadedPendingLiveEdits, id],
  );
  useEffect(() => {
    if (!pendingVisualStyleRevertRequest) return;
    const timeout = window.setTimeout(() => {
      setPendingVisualStyleRevertRequest(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pendingVisualStyleRevertRequest]);
  useEffect(() => {
    if (!pendingTextRevertRequest) return;
    const timeout = window.setTimeout(() => {
      setPendingTextRevertRequest(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pendingTextRevertRequest]);
  useEffect(() => {
    if (!pendingStructureAckRequest) return;
    const timeout = window.setTimeout(() => {
      setPendingStructureAckRequest(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pendingStructureAckRequest]);
  useEffect(() => {
    if (!pendingLayerStateReplayRequest) return;
    const timeout = window.setTimeout(() => {
      setPendingLayerStateReplayRequest(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pendingLayerStateReplayRequest]);
  useEffect(() => {
    setMinimalUi(minimalUiByDefault);
  }, [minimalUiByDefault, embedChromeRequested, hostOwnsChrome]);
  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobileViewport(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    hasActiveSelectionRef.current =
      selectedElement !== null || selectedLayerIdsState.length > 0;
    trace("select", "selection-changed", {
      layers: selectedLayerIdsState,
      element: selectedElement?.selector ?? null,
      hasSelection: hasActiveSelectionRef.current,
    });
  }, [selectedElement, selectedLayerIdsState]);

  useEffect(() => {
    const openAgentPanel = () => {
      setActiveLeftPanel("agent");
      focusAgentComposer();
    };
    const toggleAgentPanel = () =>
      setActiveLeftPanel((current) => {
        const next = current === "agent" ? "file" : "agent";
        if (next === "agent") focusAgentComposer();
        return next;
      });
    window.addEventListener("agent-panel:open", openAgentPanel);
    window.addEventListener("agent-panel:toggle", toggleAgentPanel);
    return () => {
      window.removeEventListener("agent-panel:open", openAgentPanel);
      window.removeEventListener("agent-panel:toggle", toggleAgentPanel);
    };
  }, []);
  useEffect(
    () => clearPendingOverviewLayerSelectionTimer,
    [clearPendingOverviewLayerSelectionTimer],
  );
  useEffect(() => {
    if (!pendingLayerStateReplayRequest) return;
    pendingLayerStateReplayRequest.patches.forEach((patch) => {
      if (
        patch.routePath &&
        patch.routePath !== liveRoutePathsByScreenIdRef.current[patch.screenId]
      ) {
        return;
      }
      applyLayerStatePreview(
        patch.screenId,
        patch.layerId,
        patch.state,
        patch.enabled,
      );
    });
  }, [applyLayerStatePreview, pendingLayerStateReplayRequest]);
  useEffect(() => {
    if (!pendingLayerNameReplayRequest) return;
    const timeout = window.setTimeout(() => {
      setPendingLayerNameReplayRequest(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pendingLayerNameReplayRequest]);
  useEffect(
    () => () => {
      clearMotionDockUnmountTimer();
      clearMotionDockOpenAnimationFrame();
    },
    [clearMotionDockOpenAnimationFrame, clearMotionDockUnmountTimer],
  );
  useEffect(
    () => () => {
      const flushPendingMotionAutosave = motionAutosaveFlushRef.current;
      if (flushPendingMotionAutosave) {
        flushPendingMotionAutosave();
        return;
      }
      clearMotionAutosaveTimer();
    },
    [clearMotionAutosaveTimer],
  );
  useEffect(() => {
    activeBreakpointWidthStateRef.current = activeBreakpointWidthState;
    invalidateRenderedElementInfo();
  }, [activeBreakpointWidthState, invalidateRenderedElementInfo]);
  useEffect(() => {
    if (!builderHostProtocolActive) return;
    window.parent.postMessage({ type: "agentNative.appReady" }, "*");

    function handleDesignHostMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      const origin = event.origin ?? "";
      try {
        const hostname = new URL(origin).hostname.toLowerCase();
        const trusted =
          hostname === "builder.io" ||
          hostname.endsWith(".builder.io") ||
          hostname === "builder.my" ||
          hostname.endsWith(".builder.my") ||
          hostname === "localhost" ||
          hostname === "127.0.0.1";
        if (!trusted) return;
      } catch {
        return;
      }

      const data = event.data;
      if (!data || typeof data.type !== "string") return;

      if (data.type === "design:init") {
        if (!parentOriginRef.current) {
          parentOriginRef.current = origin;
        }
        rememberBuilderHostOrigin(origin);
        const { previewUrl, routes, context } = data.data ?? {};
        if (typeof previewUrl === "string" && isBuilderPreviewUrl(previewUrl)) {
          setBuilderPreviewUrl(previewUrl);
          const nextShellInput: ShellDesignInput = {
            previewOrigin: builderPreviewOrigin(previewUrl),
            routes: Array.isArray(routes)
              ? routes.flatMap((route: unknown) => {
                  const path = (route as { path?: unknown })?.path;
                  return typeof path === "string" && path ? [{ path }] : [];
                })
              : [],
            projectId: context?.projectId,
            branchName: context?.branchName,
            builderOrgId: context?.builderOrgId,
            contentId: context?.contentId ?? undefined,
          };
          setShellInput((current) => {
            if (
              current &&
              JSON.stringify(current) === JSON.stringify(nextShellInput)
            ) {
              return current;
            }
            if (current && shellContextChanged(current, nextShellInput)) {
              clearPendingLiveEditStateRef.current();
            }
            return nextShellInput;
          });
        }
      }

      if (data.type === "design:previewUrlChanged") {
        const nextPreviewUrl = data.data?.previewUrl;
        if (
          typeof nextPreviewUrl === "string" &&
          isBuilderPreviewUrl(nextPreviewUrl)
        ) {
          setBuilderPreviewUrl(nextPreviewUrl);
          const previewOrigin = builderPreviewOrigin(nextPreviewUrl);
          setShellInput((current) => {
            if (!current || current.previewOrigin === previewOrigin) {
              return current;
            }
            clearPendingLiveEditStateRef.current();
            return { ...current, previewOrigin };
          });
        }
      }

      if (data.type === "design:showChat") {
        setActiveLeftPanel("agent");
      }

      if (data.type === "design:chatState") {
        const next = data.data?.state;
        if (
          next === "generating" &&
          stagedSourceHandoffRef.current === "awaiting-start"
        ) {
          stagedSourceHandoffRef.current = "running";
          if (stagedHandoffStartTimerRef.current !== undefined) {
            window.clearTimeout(stagedHandoffStartTimerRef.current);
            stagedHandoffStartTimerRef.current = undefined;
          }
        }
        if (hostChatGeneratingRef.current && next !== "generating") {
          reloadRunningAppPreviewFrames();
          if (stagedSourceHandoffRef.current === "running") {
            stagedSourceHandoffRef.current = "idle";
            setApplyingViaHost(false);
            if (next === "idle") clearPendingLiveEditStateRef.current();
          }
        }
        hostChatGeneratingRef.current = next === "generating";
      }
    }

    window.addEventListener("message", handleDesignHostMessage);
    return () => window.removeEventListener("message", handleDesignHostMessage);
  }, [builderHostProtocolActive]);

  useEffect(() => {
    if (hasSelectedElement) focusDesignInspectorForSelection();
  }, [focusDesignInspectorForSelection, hasSelectedElement]);
  const selectionUndoStackRef = useRef<SelectionHistoryEntry[]>([]);
  const selectionRedoStackRef = useRef<SelectionHistoryEntry[]>([]);
  const clearRedoStacks = useCallback(() => {
    contentRedoStackRef.current = [];
    contentRedoSelectionStackRef.current = [];
    localContentRedoStackRef.current = [];
    geometryRedoStackRef.current = [];
    fileCreationRedoStackRef.current = [];
    fileDeletionRedoStackRef.current = [];
    pendingVisualStyleRedoStackRef.current = [];
    pendingLiveNonStyleRedoStackRef.current = [];
    clipboardPasteRedoStackRef.current = [];
    pendingStructureRedoReplayRef.current = undefined;
    selectionRedoStackRef.current = [];
    if (pendingStructureRedoReplayTimerRef.current !== undefined) {
      window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
      pendingStructureRedoReplayTimerRef.current = undefined;
    }
    redoOrderRef.current = [];
    undoManagerRef.current?.clear(false, true);
  }, []);
  const clearPendingHistoryDirections = useCallback(() => {
    pendingHistoryDirectionsRef.current = [];
    pendingHistoryDrainScheduledRef.current = false;
  }, []);
  const historySourceReaderRef = useRef<(screenId: string) => string>(() => {
    throw new Error("History source reader is not initialized");
  });
  const captureCurrentSelection = (): GeometryHistorySelection => {
    recordDesignPerformance("captureCurrentSelection");
    return captureHistorySelectionFromOwners(
      {
        overviewSelectedScreenIds: [...overviewSelectedScreenIdsRef.current],
        selectedLayerIds: [...selectedLayerIdsStateRef.current],
        activeFileId: activeFileIdForUndoRef.current,
        explicitOverviewScreenIds: [
          ...explicitOverviewScreenSelectionRef.current,
        ],
      },
      codeLayerOwnerByNodeIdRef.current,
      (screenId) => historySourceReaderRef.current(screenId),
    );
  };
  // Runs after every history push; same-value sets right after a commit still
  // re-render the whole editor, so only real changes are published.
  const publishedUndoRedoRef = useRef({ canUndo: false, canRedo: false });
  const publishUndoRedo = useCallback(
    (nextCanUndo: boolean, nextCanRedo: boolean) => {
      const published = publishedUndoRedoRef.current;
      if (published.canUndo !== nextCanUndo) setCanUndo(nextCanUndo);
      if (published.canRedo !== nextCanRedo) setCanRedo(nextCanRedo);
      publishedUndoRedoRef.current = {
        canUndo: nextCanUndo,
        canRedo: nextCanRedo,
      };
    },
    [],
  );
  const syncUndoRedoState = useCallback(() => {
    if (fileHistoryMutationPendingRef.current) {
      publishUndoRedo(false, false);
      return;
    }
    if (
      pendingHistoryDirectionsRef.current.length > 0 &&
      !pendingHistoryDrainScheduledRef.current
    ) {
      pendingHistoryDrainScheduledRef.current = true;
      queueMicrotask(function drainPendingHistory() {
        if (fileHistoryMutationPendingRef.current) {
          pendingHistoryDrainScheduledRef.current = false;
          return;
        }
        const direction = pendingHistoryDirectionsRef.current.shift();
        if (!direction) {
          pendingHistoryDrainScheduledRef.current = false;
          return;
        }
        replayPendingHistoryRef.current?.(direction);
        if (fileHistoryMutationPendingRef.current) {
          pendingHistoryDrainScheduledRef.current = false;
          return;
        }
        if (pendingHistoryDirectionsRef.current.length > 0) {
          queueMicrotask(drainPendingHistory);
        } else {
          pendingHistoryDrainScheduledRef.current = false;
        }
      });
    }
    const undoManager = undoManagerRef.current;
    const canUseOverviewHistory = viewModeRef.current === "overview";
    const activeHistoryFileId = activeFileIdForUndoRef.current;
    const hasLocalUndo =
      !canUseOverviewHistory &&
      findLastContentHistoryChangeIndex(
        localContentUndoStackRef.current,
        activeHistoryFileId,
      ) !== -1;
    const hasLocalRedo =
      !canUseOverviewHistory &&
      findLastContentHistoryChangeIndex(
        localContentRedoStackRef.current,
        activeHistoryFileId,
      ) !== -1;
    publishUndoRedo(
      Boolean(linkedComponentMutationQueueRef.current?.queue.hasPending()) ||
        contentUndoStackRef.current.some(
          (entry) => "linkedComponent" in entry && entry.linkedComponent,
        ) ||
        pendingVisualStyleEditsRef.current.length > 0 ||
        pendingLiveNonStyleUndoStackRef.current.length > 0 ||
        Boolean(undoManager?.canUndo()) ||
        hasLocalUndo ||
        clipboardPasteUndoStackRef.current.length > 0 ||
        (canUseOverviewHistory &&
          (contentUndoStackRef.current.length > 0 ||
            geometryUndoStackRef.current.length > 0 ||
            fileCreationUndoStackRef.current.length > 0 ||
            fileDeletionUndoStackRef.current.length > 0 ||
            selectionUndoStackRef.current.length > 0)),
      contentRedoStackRef.current.some(
        (entry) => "linkedComponent" in entry && entry.linkedComponent,
      ) ||
        pendingVisualStyleRedoStackRef.current.length > 0 ||
        pendingLiveNonStyleRedoStackRef.current.length > 0 ||
        Boolean(undoManager?.canRedo()) ||
        hasLocalRedo ||
        clipboardPasteRedoStackRef.current.length > 0 ||
        (canUseOverviewHistory &&
          (contentRedoStackRef.current.length > 0 ||
            geometryRedoStackRef.current.length > 0 ||
            fileCreationRedoStackRef.current.length > 0 ||
            fileDeletionRedoStackRef.current.length > 0 ||
            selectionRedoStackRef.current.length > 0)),
    );
  }, [publishUndoRedo]);
  useEffect(() => {
    pendingVisualStyleEditsRef.current = pendingVisualStyleEdits;
    pendingLiveEditReloadedTargetsRef.current.clear();
    syncUndoRedoState();
  }, [pendingVisualStyleEdits, syncUndoRedoState]);
  useEffect(() => {
    pendingLiveNonStyleEditsRef.current = pendingLiveNonStyleEdits;
    pendingLiveEditReloadedTargetsRef.current.clear();
    syncUndoRedoState();
  }, [pendingLiveNonStyleEdits, syncUndoRedoState]);
  const recordContentHistoryEntry = useCallback(
    (entry: ContentHistoryEntry, selectedLayerIdsOverride?: string[]) => {
      const changes = getContentHistoryChanges(entry).filter(
        hasContentHistoryChange,
      );
      if (changes.length === 0) return;
      const activeHistoryFileId = activeFileIdForUndoRef.current;
      if (
        activeHistoryFileId &&
        changes.some((change) => change.fileId === activeHistoryFileId)
      ) {
        undoManagerRef.current?.clear(true, false);
        localContentUndoStackRef.current =
          localContentUndoStackRef.current.filter(
            (change) => change.fileId !== activeHistoryFileId,
          );
        localContentRedoStackRef.current =
          localContentRedoStackRef.current.filter(
            (change) => change.fileId !== activeHistoryFileId,
          );
        historyOrderRef.current = removeUndoRedoOrderKind(
          historyOrderRef.current,
          "content",
        );
        redoOrderRef.current = removeUndoRedoOrderKind(
          redoOrderRef.current,
          "content",
        );
      }
      contentUndoStackRef.current = [
        ...contentUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        changes.length === 1 ? changes[0] : { changes },
      ];
      const selection = captureCurrentSelection();
      contentUndoSelectionStackRef.current = [
        ...contentUndoSelectionStackRef.current.slice(
          -(MAX_DESIGN_UNDO_STACK - 1),
        ),
        captureHistorySelectionSources(
          {
            ...selection,
            ...(selectedLayerIdsOverride
              ? { selectedLayerIds: selectedLayerIdsOverride }
              : {}),
          },
          {
            ...selection.sourceContentByFileId,
            ...Object.fromEntries(
              changes.map((change) => [change.fileId, change.before]),
            ),
          },
        ),
      ];
      clearRedoStacks();
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "file-content",
      ];
      syncUndoRedoState();
    },
    [clearRedoStacks, syncUndoRedoState],
  );
  const recordLocalContentHistoryEntry = useCallback(
    (change: ContentHistoryChange) => {
      if (change.before === change.after) return;
      localContentUndoStackRef.current = [
        ...localContentUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        change,
      ];
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "content",
      ];
      clearRedoStacks();
      syncUndoRedoState();
    },
    [clearRedoStacks, syncUndoRedoState],
  );
  const recordLocalContentHistoryChangeFallback = useCallback(
    (change: ContentHistoryChange) => {
      if (
        historyOrderRef.current.lastIndexOf("file-content") >
        historyOrderRef.current.lastIndexOf("content")
      ) {
        localContentUndoStackRef.current = [
          ...localContentUndoStackRef.current.slice(
            -(MAX_DESIGN_UNDO_STACK - 1),
          ),
          change,
        ];
        return;
      }
      localContentUndoStackRef.current = mergeLocalContentHistoryFallback(
        localContentUndoStackRef.current,
        change,
      );
    },
    [],
  );
  const prepareTextCreationFinalization = useCallback(
    (
      fileId: string,
      nodeIds: readonly (string | null | undefined)[],
      finalContent: string,
    ) => {
      const pending = pendingTextCreationHistoryRef.current;
      if (
        !pending ||
        pending.fileId !== fileId ||
        !nodeIds.some((nodeId) => nodeId === pending.nodeId)
      ) {
        return {
          isCreationCommit: false,
          historyHandled: false,
          confirm: () => {},
        };
      }
      const consumePending = () => {
        if (pendingTextCreationHistoryRef.current !== pending) return false;
        pendingTextCreationHistoryRef.current = null;
        return true;
      };
      const result = finalizeTextCreationHistory(
        contentUndoStackRef.current,
        pending,
        finalContent,
      );
      if (result.status === "stale") {
        return {
          isCreationCommit: true,
          historyHandled: false,
          confirm: consumePending,
        };
      }
      return {
        isCreationCommit: true,
        historyHandled: true,
        confirm: () => {
          if (!consumePending()) return;
          contentUndoStackRef.current = result.stack;
          if (result.status === "rolled-back") {
            contentUndoSelectionStackRef.current =
              contentUndoSelectionStackRef.current.slice(0, -1);
            historyOrderRef.current = removeRecentUndoRedoOrderKinds(
              historyOrderRef.current,
              "file-content",
              1,
            );
          }
          syncUndoRedoState();
        },
      };
    },
    [syncUndoRedoState],
  );
  const recordExternalContentHistoryCheckpoint = useCallback(
    (change: ContentHistoryChange) => {
      if (change.before === change.after) return;
      const record = () => {
        if (contentHistoryScopeForViewMode(viewModeRef.current) === "global") {
          recordContentHistoryEntry(change);
          return;
        }
        undoManagerRef.current?.clear(true, false);
        recordLocalContentHistoryChangeFallback({
          ...change,
          isCheckpoint: true,
        });
        clearRedoStacks();
        syncUndoRedoState();
      };
      if (
        linkedComponentMutationQueueRef.current?.queue.interceptExternalCheckpoint(
          change,
          record,
        )
      )
        return;
      record();
    },
    [
      clearRedoStacks,
      recordContentHistoryEntry,
      recordLocalContentHistoryChangeFallback,
      syncUndoRedoState,
    ],
  );
  const clearLocalUndoRedoStacks = useCallback(() => {
    contentUndoStackRef.current = [];
    contentRedoStackRef.current = [];
    contentUndoSelectionStackRef.current = [];
    contentRedoSelectionStackRef.current = [];
    localContentUndoStackRef.current = [];
    localContentRedoStackRef.current = [];
    geometryUndoStackRef.current = [];
    geometryRedoStackRef.current = [];
    fileCreationUndoStackRef.current = [];
    fileCreationRedoStackRef.current = [];
    pendingFileCreationHistoryEntriesRef.current = [];
    pendingDuplicateGeometriesRef.current.clear();
    pendingDuplicateFilenamesRef.current.clear();
    duplicateInFlightRef.current.clear();
    duplicateRecoveryRef.current.clear();
    fileDeletionUndoStackRef.current = [];
    fileDeletionRedoStackRef.current = [];
    fileHistoryMutationPendingRef.current = false;
    clearPendingHistoryDirections();
    selectionUndoStackRef.current = [];
    selectionRedoStackRef.current = [];
    clipboardPasteUndoStackRef.current = [];
    clipboardPasteRedoStackRef.current = [];
    latestClipboardMutationContentRef.current.clear();
    historyOrderRef.current = [];
    redoOrderRef.current = [];
  }, [clearPendingHistoryDirections]);
  const recordFileCreationHistoryEntry = useCallback(
    (entry: FileCreationHistoryEntry) => {
      recordFileCreationHistoryEntryCommand({
        designId: id,
        entry,
        fileHistoryMutationPendingRef,
        pendingFileCreationHistoryEntriesRef,
        fileCreationUndoStackRef,
        historyOrderRef,
        clearRedoStacks,
        syncUndoRedoState,
      });
    },
    [clearRedoStacks, id, syncUndoRedoState],
  );
  const flushPendingFileCreationHistoryEntries = useCallback(() => {
    flushFileCreationHistoryEntries({
      designId: id,
      fileHistoryMutationPendingRef,
      pendingFileCreationHistoryEntriesRef,
      fileCreationUndoStackRef,
      historyOrderRef,
      clearRedoStacks,
      syncUndoRedoState,
    });
  }, [clearRedoStacks, id, syncUndoRedoState]);
  selectedLayerIdsStateRef.current = selectedLayerIdsState;
  overviewSelectedScreenIdsRef.current = overviewSelectedScreenIds;

  const discardPendingLiveStructureTransaction = useCallback(
    (transactionId: string) => {
      const matchesTransaction = (edit: PendingLiveStructureEdit) =>
        pendingLiveStructureEditsFromEdit(edit).some(
          (member) => member.transactionId === transactionId,
        );
      const nextPending = pendingLiveNonStyleEditsRef.current.filter(
        (edit) => edit.kind !== "structure" || !matchesTransaction(edit),
      );
      const nextUndo = pendingLiveNonStyleUndoStackRef.current.filter(
        (entry) =>
          entry.kind !== "structure" ||
          !pendingLiveStructureEditsFromUndoEntry(entry).some(
            (edit) => edit.transactionId === transactionId,
          ),
      );
      const nextRedo = pendingLiveNonStyleRedoStackRef.current.filter(
        (entry) =>
          entry.kind !== "structure" ||
          !pendingLiveStructureEditsFromUndoEntry(entry).some(
            (edit) => edit.transactionId === transactionId,
          ),
      );
      pendingLiveNonStyleEditsRef.current = nextPending;
      pendingLiveNonStyleUndoStackRef.current = nextUndo;
      pendingLiveNonStyleRedoStackRef.current = nextRedo;
      setPendingLiveNonStyleEdits(nextPending);
      syncUndoRedoState();
    },
    [syncUndoRedoState],
  );

  const hasPendingVisualStyleEdits =
    pendingVisualStyleEdits.length > 0 || pendingLiveNonStyleEdits.length > 0;

  const pendingVisualEditCount = useMemo(
    () =>
      getPendingVisualEditCount(
        pendingVisualStyleEdits,
        pendingLiveNonStyleEdits,
      ),
    [pendingLiveNonStyleEdits, pendingVisualStyleEdits],
  );
  const hasLocalPendingVisualEdits =
    pendingVisualStyleEdits.length > 0 || pendingLiveNonStyleEdits.length > 0;

  const layerPanelExpandedIds = useMemo(() => {
    if (viewMode !== "overview" || !createdOverviewLayerSelection) {
      return expandedLayerIds;
    }
    const next = new Set(expandedLayerIds);
    next.add(createdOverviewLayerSelection.screenId);
    return Array.from(next);
  }, [createdOverviewLayerSelection, expandedLayerIds, viewMode]);
  const handleInteractionStateChange = useCallback(
    (next: InteractionState | null) => {
      if (activeInteractionStateStateRef.current !== next) {
        setActiveInteractionStateState(next);
      }
    },
    [],
  );

  return {
    isBuilderDesignEmbed,
    builderPreviewUrl,
    shellInput,
    parentOriginRef,
    pendingVisualStyleEdits,
    setPendingVisualStyleEdits,
    pendingLiveNonStyleEdits,
    setPendingLiveNonStyleEdits,
    pendingVisualStyleEditsRef,
    pendingLiveNonStyleEditsRef,
    liveScreenIdsRef,
    pendingVisualStyleUndoStackRef,
    pendingVisualStyleRedoStackRef,
    pendingLiveNonStyleUndoStackRef,
    pendingLiveNonStyleRedoStackRef,
    pendingStructureRedoReplayRef,
    stagedSourceHandoffRef,
    stagedHandoffStartTimerRef,
    applyingViaHost,
    setApplyingViaHost,
    clearPendingLiveEditState,
    clearPendingLiveEditStateRef,
    clearReloadedPendingLiveEdits,
    handleLiveScreenRuntimeReload,
    activeInspectorTab,
    setActiveInspectorTab,
    activeLeftPanel,
    setActiveLeftPanel,
    collapseLeftPanel,
    codeWorkbenchOpenedRef,
    leftSidebarWidth,
    rightSidebarWidth,
    minimalUi,
    setMinimalUi,
    isMobileViewport,
    leftSidebarContentRef,
    rightSidebarContentRef,
    expandedLayerIds,
    setExpandedLayerIds,
    revealLayerIds,
    selectedLayerIdsState,
    setSelectedLayerIdsState,
    selectedScreenStyleChangeRef,
    renderedElementInfoByLayerKeyRef,
    renderedElementInfoRevisionRef,
    rehydrateRenderedElementInfoRef,
    invalidateRenderedElementInfo,
    rehydrateRenderedInfoAfterPreview,
    codeLayerOwnerByNodeIdRef,
    revealLayer,
    overviewSelectedScreenIds,
    setOverviewSelectedScreenIds,
    createdOverviewLayerSelection,
    setCreatedOverviewLayerSelection,
    pendingOverviewScreenSelectionRef,
    pendingOverviewLayerSelectionRef,
    hasActiveSelectionRef,
    pendingTextCreationHistoryRef,
    clearPendingOverviewLayerSelectionTimer,
    schedulePendingOverviewLayerSelectionClear,
    lockedLayerIds,
    setLockedLayerIds,
    hiddenLayerIds,
    setHiddenLayerIds,
    layerStateOverridesRef,
    applyLayerStatePreview,
    hasSystemClipboardImages,
    setHasSystemClipboardImages,
    menuClipboardReadIdRef,
    latestClipboardMutationContentRef,
    clipboardPasteUndoStackRef,
    clipboardPasteRedoStackRef,
    motionDockOpen,
    setMotionDockOpen,
    motionDockMounted,
    setMotionDockMounted,
    motionAutosaveTimerRef,
    motionAutosaveFlushRef,
    clearMotionDockUnmountTimer,
    clearMotionAutosaveTimer,
    setMotionDockOpenAnimated,
    handleMotionDockExitComplete,
    shaderFillPreview,
    setShaderFillPreview,
    shaderFillPreviewActiveRef,
    activeBreakpointWidthState,
    setActiveBreakpointWidthState,
    activeBreakpointWidthStateRef,
    activeInteractionStateState,
    focusDesignInspectorForSelection,
    startSidebarResize,
    canUndo,
    canRedo,
    undoManagerRef,
    linkedComponentMutationQueueRef,
    contentUndoStackRef,
    contentRedoStackRef,
    contentUndoSelectionStackRef,
    contentRedoSelectionStackRef,
    localContentUndoStackRef,
    localContentRedoStackRef,
    activeFileIdForUndoRef,
    geometryUndoStackRef,
    geometryRedoStackRef,
    selectedLayerIdsStateRef,
    overviewSelectedScreenIdsRef,
    explicitOverviewScreenSelectionRef,
    fileCreationUndoStackRef,
    fileCreationRedoStackRef,
    pendingDuplicateGeometriesRef,
    pendingDuplicateFilenamesRef,
    duplicateInFlightRef,
    duplicateRecoveryRef,
    fileDeletionUndoStackRef,
    fileDeletionRedoStackRef,
    fileHistoryMutationPendingRef,
    pendingHistoryDirectionsRef,
    replayPendingHistoryRef,
    historyOrderRef,
    redoOrderRef,
    selectionUndoStackRef,
    selectionRedoStackRef,
    clearRedoStacks,
    clearPendingHistoryDirections,
    historySourceReaderRef,
    captureCurrentSelection,
    syncUndoRedoState,
    recordContentHistoryEntry,
    recordLocalContentHistoryEntry,
    recordLocalContentHistoryChangeFallback,
    prepareTextCreationFinalization,
    recordExternalContentHistoryCheckpoint,
    clearLocalUndoRedoStacks,
    recordFileCreationHistoryEntry,
    flushPendingFileCreationHistoryEntries,
    discardPendingLiveStructureTransaction,
    hasPendingVisualStyleEdits,
    pendingVisualEditCount,
    hasLocalPendingVisualEdits,
    layerPanelExpandedIds,
    handleInteractionStateChange,
  };
}

export type EditorHistory = ReturnType<typeof useEditorHistory>;
