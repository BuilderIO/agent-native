import {
  usePresence,
  useFollowUser,
  useRecentEdits,
  type CollabUser,
  type AttributedRecentEdit,
  type OtherPresence,
} from "@agent-native/core/client/collab";
import { useLab } from "@agent-native/core/client/labs";
import { resolveSourceCapabilities } from "@shared/capability-resolver";
import {
  buildCodeLayerProjection,
  type CodeLayerNode,
} from "@shared/code-layer";
import {
  componentNodeIdMatches,
  isComponentInstance,
} from "@shared/component-model";
import {
  DESIGN_CAPABILITY_NAMES,
  hasCapability,
} from "@shared/design-source-capabilities";
import { readFusionApp } from "@shared/full-app";
import { DESIGN_REVIEW_TOOLS_LAB, FULL_APP_BUILDING_LAB } from "@shared/labs";
import { countLockedLayersAcrossFiles } from "@shared/locked-layers";
import { normalizeDesignSourceType } from "@shared/source-mode";
import { useTheme } from "next-themes";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import type { MotionTrackWire } from "@/components/design/design-canvas/motion-types";
import { componentInstanceHasLocalOverrides } from "@/components/design/edit-panel/component-section";
import { type MotionDockTrack } from "@/components/design/MotionDock";
import { findCanvasIframeForScreen } from "@/components/design/multi-screen/iframe-targeting";

import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerSelectorAliases,
  resolveSelectedCodeLayerNode,
} from "../code-layer-state";
import type { RuntimeLayerSnapshot } from "../command-types";
import { isRadixOverlayOpen } from "../dom-guards";
import { LOCAL_EDIT_ORIGIN } from "../editor-session";
import {
  isStandaloneHttpUrl,
  previewContentReplaceNeedsRenderFallback,
  removeUndoRedoOrderKind,
  type PreviewContentReplaceResult,
} from "../editor-state";
import { runAdoptDbFileContent } from "../effects/adopt-db-file-content";
import { runObserveCollabText } from "../effects/observe-collab-text";
import { runSeedCollabContent } from "../effects/seed-collab-content";
import { useSyncLatestActiveContent } from "../effects/sync-latest-active-content";
import { forwardYjsUndoStackItemMeta, MAX_DESIGN_UNDO_STACK } from "../history";
import {
  hydrateMotionDockTracks,
  motionTimelineFingerprint,
} from "../motion-state";
import {
  computeIframeLocalCanvasPoint,
  readOverviewZoomPercentFromTransform,
  resolveScreenDropPoint,
} from "../overview-camera";
import {
  resolveOverviewScreenSourceType,
  shouldUseRuntimeLayerProjection,
} from "../pending-edits";
import {
  designStatePreviewHtml,
  type DesignStatePreviewRow,
} from "../screen-command-utils";
import { shouldLimitEditorChromeUntilContentReady } from "../selection-state";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorCore } from "./use-editor-core";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";

export function useEditorLiveEditsAndPresence({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorCanvasAndScreens: EditorCanvasAndScreens;
}) {
  const {
    t,
    id,
    setBuilderHostConfirmed,
    viewMode,
    selectedElement,
    setSelectedElement,
    setHoveredElement,
    activeFileId,
    setActiveFileId,
    handleScreenRuntimeVerificationSnapshot,
  } = editorCore;
  const {
    liveScreenIdsRef,
    activeInspectorTab,
    setActiveInspectorTab,
    setActiveLeftPanel,
    motionDockOpen,
    motionAutosaveFlushRef,
    clearMotionAutosaveTimer,
    undoManagerRef,
    historyOrderRef,
    redoOrderRef,
    clearRedoStacks,
    syncUndoRedoState,
    recordExternalContentHistoryCheckpoint,
  } = editorHistory;
  const {
    generating,
    pendingGenerationActive,
    canEditDesign,
    canEditLiveScreens,
    publicVisualEdit,
    tweaksEnabled,
    rawServerFilesByIdRef,
    pendingLocalFileContentsRef,
    pendingLocalFileContentsRevision,
    pendingLocalFileContentsSnapshot,
  } = editorGenerationAndAccess;
  const {
    setShowTweakPrompt,
    publishCanonicalContent,
    files,
    codeLayerSourceForScreen,
    runtimeLayerSnapshotsById,
    designDataJson,
    designSourceType,
    boardFileId,
    overviewScreens,
    handleScreenRuntimeLayerSnapshot,
  } = editorFilesAndSaving;
  const {
    screenZoom,
    activeFile,
    motionTimelineResult,
    overviewCanvasZoom,
    overviewZoom,
    setZoom,
    activeCanvasSourceType,
  } = editorActiveScreenAndGeometry;
  const {
    canEditLiveScreenIdsRef,
    runtimeLayerSnapshotReadiness,
    ydoc,
    awareness,
    isSynced,
    agentActive,
    overviewPresenceFileId,
    overviewAwareness,
    overviewYdoc,
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
    setLayerStructurePreviewByFileId,
    resolveSelectorRectInIframe,
    resolveTextQuoteRectInIframe,
    resolveSelectorRect,
    resolveRecentEditRect,
    rawActiveContent,
    activeContent,
    getScreenContent,
    getProjectionContentForScreen,
  } = editorCanvasAndScreens;

  const [contentRenderRevision, setContentRenderRevision] = useState(0);
  const [motionTimelineId, setMotionTimelineId] = useState<string | null>(null);
  const [motionTracks, setMotionTracks] = useState<MotionDockTrack[]>([]);
  const [motionDurationMs, setMotionDurationMs] = useState(2000);
  const [motionDefaultEase, setMotionDefaultEase] = useState<string>("ease");
  const [motionPlayhead, setMotionPlayhead] = useState(0);
  const [motionAutoKeyframeEnabled, setMotionAutoKeyframeEnabled] =
    useState(false);
  const [motionTracksDirty, setMotionTracksDirty] = useState(false);
  const [motionAutosaveRevision, setMotionAutosaveRevision] = useState(0);
  const [motionHydrationFingerprint, setMotionHydrationFingerprint] = useState<
    string | null
  >(null);
  const motionAutosaveRevisionRef = useRef(0);
  const motionAutosaveFailedRevisionRef = useRef<number | null>(null);
  const lastScheduledMotionAutosaveRevisionRef = useRef(0);
  const previousMotionFileIdRef = useRef<string | null>(null);

  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const activePendingSource = activeFile
    ? pendingLocalFileContentsRef.current.get(activeFile.id)
    : undefined;
  const activeReconcileFile =
    activePendingSource &&
    activePendingSource.identityMigrationSourceContent === undefined
      ? activeFile
      : (rawServerFilesByIdRef.current.get(activeFile?.id ?? "") ?? activeFile);
  const zoom = viewMode === "overview" ? overviewZoom : screenZoom;
  const documentFileUpdatedAtRef = useRef<string | null>(null);
  const documentFileContentRef = useRef<string | null>(null);
  const collabContentRef = useRef<string | null>(null);
  const collabContentFileIdRef = useRef<string | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  const cursorRafRef = useRef<number | null>(null);

  const [inspectorPopoverOpen, setInspectorPopoverOpen] = useState(false);

  const viewportRafRef = useRef<number | null>(null);

  const [followingEmail, setFollowingEmail] = useState<string | null>(null);
  const initialGenerationChromeLimited =
    shouldLimitEditorChromeUntilContentReady({
      fileCount: files.length,
      generating,
      hasActiveCanvasContent: Boolean(activeFile && activeContent.trim()),
      pendingGenerationActive,
    });
  const lastDurableLockedLayerCountRef = useRef(0);
  const activeRuntimeProjectionEligible = useMemo(() => {
    const fileId = activeFile?.id;
    if (!fileId) return false;
    return shouldUseRuntimeLayerProjection({
      screen: overviewScreens.find((screen) => screen.id === fileId),
      fallbackSourceType:
        normalizeDesignSourceType(designDataJson.sourceType as unknown) ??
        normalizeDesignSourceType(designDataJson.sourceMode as unknown) ??
        "inline",
      content: files.find((file) => file.id === fileId)?.content ?? "",
    });
  }, [activeFile?.id, designDataJson, files, overviewScreens]);
  const activeRuntimeCodeLayerProjection = useMemo(() => {
    const fileId = activeFile?.id;
    if (!fileId) return null;
    const snapshot = runtimeLayerSnapshotsById[fileId];
    if (!snapshot || !activeRuntimeProjectionEligible) return null;
    const projection = buildCodeLayerProjection(snapshot.html, {
      source: codeLayerSourceForScreen(fileId, "inline-html"),
    });
    return projection.nodes.length > 0 ? projection : null;
  }, [
    activeFile?.id,
    activeRuntimeProjectionEligible,
    codeLayerSourceForScreen,
    runtimeLayerSnapshotsById,
  ]);

  useEffect(
    () =>
      runSeedCollabContent({
        publishCanonicalContent,
        activeFile: activeReconcileFile,
        activeFileId,
        collabContentFileIdRef,
        isSynced,
        lastAppliedFileUpdatedAtRef,
        lastAppliedFileContentRef,
        lastLocalContentRef,
        latestActiveContentRef,
        pendingLocalFileContentsRef,
        replacePreviewContent,
        setCollabContent,
        setCollabContentFileId,
        setContentRenderRevision,
        ydoc,
      }),
    [
      canEditDesign,
      publishCanonicalContent,
      ydoc,
      isSynced,
      activeFileId,
      activeReconcileFile?.content,
      activeReconcileFile?.fileType,
      activeReconcileFile?.updatedAt,
      pendingLocalFileContentsRevision,
    ],
  );

  useEffect(() => {
    documentFileUpdatedAtRef.current = activeReconcileFile?.updatedAt ?? null;
    documentFileContentRef.current = activeReconcileFile?.content ?? null;
  }, [activeReconcileFile?.content, activeReconcileFile?.updatedAt]);

  useEffect(() => {
    collabContentRef.current = collabContent;
    collabContentFileIdRef.current = collabContentFileId;
  }, [collabContent, collabContentFileId]);

  useEffect(
    () =>
      runObserveCollabText({
        publishCanonicalContent,
        activeFileId,
        fileType: activeFile?.fileType,
        agentActive,
        documentFileContentRef,
        documentFileUpdatedAtRef,
        isSynced,
        lastAppliedFileUpdatedAtRef,
        lastAppliedFileContentRef,
        lastLocalContentRef,
        latestActiveContentRef,
        pendingLocalFileContentsRef,
        recordExternalContentHistoryCheckpoint,
        replacePreviewContent,
        setCollabContent,
        setCollabContentFileId,
        setContentRenderRevision,
        setHoveredElement,
        setSelectedElement,
        undoManagerRef,
        ydoc,
      }),
    [
      publishCanonicalContent,
      activeFileId,
      activeFile?.fileType,
      agentActive,
      isSynced,
      recordExternalContentHistoryCheckpoint,
      ydoc,
    ],
  );

  useEffect(() => {
    if (!ydoc || !isSynced) {
      undoManagerRef.current?.destroy();
      undoManagerRef.current = null;
      historyOrderRef.current = removeUndoRedoOrderKind(
        historyOrderRef.current,
        "content",
      );
      redoOrderRef.current = removeUndoRedoOrderKind(
        redoOrderRef.current,
        "content",
      );
      syncUndoRedoState();
      return;
    }
    const ytext = ydoc.getText("content");
    const um = new Y.UndoManager(ytext, {
      trackedOrigins: new Set([LOCAL_EDIT_ORIGIN]),
      captureTimeout: 800,
    });

    const syncState = () => syncUndoRedoState();
    const handleStackItemAdded = (event: {
      origin?: unknown;
      type?: "undo" | "redo";
    }) => {
      if (event.origin !== LOCAL_EDIT_ORIGIN || event.type !== "undo") {
        syncUndoRedoState();
        return;
      }
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "content",
      ];
      clearRedoStacks();
      syncUndoRedoState();
    };
    const handleStackItemPopped = (event: {
      stackItem: { meta: Map<unknown, unknown> };
      type?: "undo" | "redo";
    }) => {
      const oppositeStack = event.type === "undo" ? um.redoStack : um.undoStack;
      forwardYjsUndoStackItemMeta(
        event.stackItem,
        oppositeStack[oppositeStack.length - 1],
      );
      syncUndoRedoState();
    };
    um.on("stack-item-added", handleStackItemAdded);
    um.on("stack-item-updated", syncState);
    um.on("stack-item-popped", handleStackItemPopped);
    um.on("stack-cleared", syncState);

    undoManagerRef.current = um;
    syncState();

    return () => {
      um.off("stack-item-added", handleStackItemAdded);
      um.off("stack-item-updated", syncState);
      um.off("stack-item-popped", handleStackItemPopped);
      um.off("stack-cleared", syncState);
      um.destroy();
      undoManagerRef.current = null;
      historyOrderRef.current = removeUndoRedoOrderKind(
        historyOrderRef.current,
        "content",
      );
      redoOrderRef.current = removeUndoRedoOrderKind(
        redoOrderRef.current,
        "content",
      );
      syncUndoRedoState();
    };
  }, [clearRedoStacks, ydoc, isSynced, syncUndoRedoState]);

  useEffect(
    () =>
      runAdoptDbFileContent({
        publishCanonicalContent,
        activeFile: activeReconcileFile,
        agentActive,
        clearStaleAgentCollabRecovery,
        collabContent,
        collabContentFileId,
        collabContentFileIdRef,
        collabContentRef,
        documentFileContentRef,
        documentFileUpdatedAtRef,
        isSynced,
        lastAppliedFileUpdatedAtRef,
        lastAppliedFileContentRef,
        lastLocalContentRef,
        latestActiveContentRef,
        recordExternalContentHistoryCheckpoint,
        replacePreviewContent,
        setCollabContent,
        setCollabContentFileId,
        setContentRenderRevision,
        staleAgentCollabRecoveryTimerRef,
      }),
    [
      canEditDesign,
      publishCanonicalContent,
      activeReconcileFile,
      agentActive,
      clearStaleAgentCollabRecovery,
      collabContent,
      collabContentFileId,
      isSynced,
      recordExternalContentHistoryCheckpoint,
    ],
  );

  useEffect(() => {
    if (awareness && activeFileId) {
      awareness.setLocalStateField("activeFileId", activeFileId);
    }
  }, [awareness, activeFileId]);

  const { others, setPresence } = usePresence(
    awareness,
    ydoc?.clientID ?? null,
  );
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const dragScreenId = activeEditorDragScreenIdRef.current;
    if (!dragScreenId || dragScreenId === activeFile?.id) return;
    activeEditorDragScreenIdRef.current = null;
    activeEditorDragRef.current = false;
    setLayerStructurePreviewByFileId((current) => {
      if (!current[dragScreenId]) return current;
      const next = { ...current };
      delete next[dragScreenId];
      return next;
    });
  }, [activeFile?.id]);
  useEffect(() => {
    return () => {
      if (cursorRafRef.current !== null) {
        cancelAnimationFrame(cursorRafRef.current);
      }
    };
  }, []);
  useEffect(() => {
    const ATTR = "data-radix-popper-content-wrapper";
    // Every editor commit mutates the body; setting an unchanged value here
    // still re-renders the editor, which mutates the body again.
    let open: boolean | null = null;
    const update = () => {
      const wrappers = document.body.querySelectorAll(`[${ATTR}]`);
      const next = Array.from(wrappers).some((wrapper) =>
        isRadixOverlayOpen(wrapper),
      );
      if (next === open) return;
      open = next;
      setInspectorPopoverOpen(next);
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setPresence({ selection: selectedElement?.selector ?? null });
  }, [selectedElement?.selector, setPresence]);
  useEffect(() => {
    return () => {
      if (viewportRafRef.current !== null) {
        cancelAnimationFrame(viewportRafRef.current);
      }
    };
  }, []);
  useEffect(() => {
    if (viewportRafRef.current !== null) {
      cancelAnimationFrame(viewportRafRef.current);
    }
    viewportRafRef.current = requestAnimationFrame(() => {
      viewportRafRef.current = null;
      setPresence({
        viewport: { fileId: activeFileId ?? undefined, zoom },
      });
    });
    return () => {
      if (viewportRafRef.current !== null) {
        cancelAnimationFrame(viewportRafRef.current);
        viewportRafRef.current = null;
      }
    };
  }, [activeFileId, zoom, setPresence]);

  const recentEdits = useRecentEdits(others);

  const { others: overviewOthers } = usePresence(
    overviewAwareness,
    overviewYdoc?.clientID ?? null,
  );

  const overviewAgentOthers = useMemo<OtherPresence[]>(
    () => overviewOthers.filter((o) => o.isAgent),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overviewOthers, overviewCanvasZoom],
  );
  const overviewRecentEdits = useRecentEdits(overviewAgentOthers);
  const followingId = useMemo(() => {
    if (!followingEmail) return null;
    const lc = followingEmail.trim().toLowerCase();
    const match = others.find((o) => o.user.email.trim().toLowerCase() === lc);
    return match?.clientId ?? null;
  }, [followingEmail, others]);

  const { stopFollowing } = useFollowUser({
    others,
    followingId,
    viewportKey: "viewport",
    onViewport: (vp) => {
      if (vp.fileId && vp.fileId !== activeFileId) {
        setActiveFileId(vp.fileId);
      }
      if (typeof vp.zoom === "number") {
        setZoom(vp.zoom);
      }
    },
  });
  useLayoutEffect(() => {
    if (activeFile?.id && rawActiveContent !== activeContent)
      publishCanonicalContent(
        activeFile.id,
        rawActiveContent,
        activeFile.fileType,
      );
  }, [
    activeFile?.id,
    activeFile?.fileType,
    rawActiveContent,
    activeContent,
    publishCanonicalContent,
    canEditDesign,
  ]);
  useSyncLatestActiveContent({
    activeContent,
    activeFile,
    latestActiveContentRef,
    pendingLocalFileContents: pendingLocalFileContentsRef.current,
  });
  const activeProjectionContent =
    activeFile?.id !== undefined
      ? getProjectionContentForScreen(activeFile.id)
      : activeContent;
  const activeCodeLayerProjection = useMemo(
    () =>
      buildCodeLayerProjection(activeProjectionContent, {
        source: activeFile?.id
          ? codeLayerSourceForScreen(activeFile.id)
          : undefined,
      }),
    [activeFile?.id, activeProjectionContent, codeLayerSourceForScreen],
  );

  const selectedCodeLayerNode = useMemo(
    () =>
      resolveSelectedCodeLayerNode({
        selectedElement,
        sourceProjection: activeCodeLayerProjection,
        runtimeProjection: activeRuntimeCodeLayerProjection,
      }),
    [
      activeCodeLayerProjection,
      activeRuntimeCodeLayerProjection,
      selectedElement,
    ],
  );
  const selectedCanvasSelectorCandidates = useMemo(() => {
    const runtimeSelector = selectedElement?.runtimeSelector?.trim();
    const runtimeCandidates = runtimeSelector ? [runtimeSelector] : [];
    if (selectedCodeLayerNode) {
      return Array.from(
        new Set([
          ...runtimeCandidates,
          ...codeLayerSelectorAliases(selectedCodeLayerNode),
        ]),
      );
    }
    return runtimeCandidates.concat(
      selectedElement?.selector && selectedElement.selector !== runtimeSelector
        ? [selectedElement.selector]
        : [],
    );
  }, [
    selectedCodeLayerNode,
    selectedElement?.runtimeSelector,
    selectedElement?.selector,
  ]);
  const selectedCanvasSelector = selectedCanvasSelectorCandidates[0] ?? null;

  const replacePreviewContent = useCallback(
    (
      nextContent: string,
      selector?: string | null,
      options: {
        forceFullDocument?: boolean;
        allowSourceNodeSwap?: boolean;
      } = {},
    ): PreviewContentReplaceResult => {
      if (isStandaloneHttpUrl(nextContent)) {
        return "skipped-live-route";
      }
      const replaceContent = (window as any).__designCanvasReplaceContent;
      if (typeof replaceContent !== "function") return "unavailable";
      const replaced = replaceContent(
        nextContent,
        selector ?? selectedCanvasSelector,
        selectedCanvasSelectorCandidates,
        {
          forceFullDocument: options.forceFullDocument === true,
          allowSourceNodeSwap: options.allowSourceNodeSwap === true,
        },
      );
      if (replaced && activeFile?.id) {
        livePreviewContentRef.current = {
          fileId: activeFile.id,
          content: nextContent,
        };
      }
      return replaced ? "applied" : "unavailable";
    },
    [
      activeFile?.id,
      selectedCanvasSelector,
      selectedCanvasSelectorCandidates,
      selectedElement,
    ],
  );

  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = canvasContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      pendingCursorRef.current = {
        x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
      };
      if (cursorRafRef.current !== null) return;
      cursorRafRef.current = requestAnimationFrame(() => {
        cursorRafRef.current = null;
        const cursor = pendingCursorRef.current;
        if (cursor) setPresence({ cursor });
      });
    },
    [setPresence],
  );

  const othersForOverlays = useMemo<OtherPresence[]>(
    () => others.slice(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [others, zoom],
  );
  const recentEditsForOverlays = useMemo<AttributedRecentEdit[]>(
    () => recentEdits.slice(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recentEdits, zoom],
  );

  const othersWithAgentCursor = useMemo<OtherPresence[]>(() => {
    const container = canvasContainerRef.current;
    if (
      !container ||
      !othersForOverlays.some(
        (other) => other.isAgent && !other.presence.cursor,
      )
    ) {
      return othersForOverlays;
    }
    const containerRect = container.getBoundingClientRect();
    if (containerRect.width === 0 || containerRect.height === 0) {
      return othersForOverlays;
    }
    return othersForOverlays.map((other) => {
      if (!other.isAgent || other.presence.cursor) return other;
      let rect: DOMRect | null = null;
      const selection = other.presence.selection as
        | string
        | { selector?: string }
        | null
        | undefined;
      const selector =
        typeof selection === "string" ? selection : selection?.selector;
      if (selector) rect = resolveSelectorRect(selector);
      if (!rect) {
        const ring = other.presence.recentEdits;
        if (Array.isArray(ring)) {
          for (let i = ring.length - 1; i >= 0 && !rect; i--) {
            const entry = ring[i] as AttributedRecentEdit;
            if (entry?.descriptor) {
              rect = resolveRecentEditRect({
                ...entry,
                clientId: other.clientId,
                user: other.user,
                isAgent: true,
              });
            }
          }
        }
      }
      if (!rect) return other;
      const cx = rect.left + rect.width / 2 - containerRect.left;
      const cy = rect.top + rect.height / 2 - containerRect.top;
      return {
        ...other,
        presence: {
          ...other.presence,
          cursor: {
            x: Math.max(0, Math.min(1, cx / containerRect.width)),
            y: Math.max(0, Math.min(1, cy / containerRect.height)),
          },
        },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    othersForOverlays,
    resolveSelectorRect,
    resolveRecentEditRect,
    canvasContainerRef,
    zoom,
  ]);

  const getOverviewFrameIframe = useCallback(
    (fileId: string | null): HTMLIFrameElement | null => {
      if (!fileId) return null;
      const container = canvasContainerRef.current;
      if (!container) return null;
      const escaped =
        typeof CSS !== "undefined" && CSS.escape ? CSS.escape(fileId) : fileId;
      return (
        findCanvasIframeForScreen(container, fileId, boardFileId) ??
        container.querySelector<HTMLIFrameElement>(
          `iframe[data-screen-iframe-id^="${escaped}::bp-"]`,
        ) ??
        null
      );
    },
    [boardFileId, canvasContainerRef],
  );

  const resolveOverviewSelectionRect = useCallback(
    (descriptor: string): DOMRect | null =>
      resolveSelectorRectInIframe(
        getOverviewFrameIframe(overviewPresenceFileId),
        descriptor,
      ),
    [
      getOverviewFrameIframe,
      overviewPresenceFileId,
      resolveSelectorRectInIframe,
    ],
  );
  const resolveOverviewRecentEditRect = useCallback(
    (edit: AttributedRecentEdit): DOMRect | null => {
      const iframe = getOverviewFrameIframe(overviewPresenceFileId);
      if (!iframe) return null;
      const d = edit.descriptor;
      if (d.kind === "selector" && typeof d.selector === "string") {
        return resolveSelectorRectInIframe(iframe, d.selector);
      }
      if (d.kind === "text" && typeof d.quote === "string") {
        return resolveTextQuoteRectInIframe(iframe, d.quote);
      }
      return null;
    },
    [
      getOverviewFrameIframe,
      overviewPresenceFileId,
      resolveSelectorRectInIframe,
      resolveTextQuoteRectInIframe,
    ],
  );
  const overviewRecentEditsForOverlays = useMemo<AttributedRecentEdit[]>(
    () => overviewRecentEdits.slice(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overviewRecentEdits, overviewCanvasZoom],
  );

  const handleAvatarClick = useCallback(
    (user: CollabUser | null) => {
      const email = user?.email ?? "agent@system";
      const lc = email.trim().toLowerCase();
      if (followingEmail?.trim().toLowerCase() === lc) {
        setFollowingEmail(null);
        stopFollowing();
      } else {
        setFollowingEmail(email);
      }
    },
    [followingEmail, stopFollowing],
  );
  useEffect(() => {
    if (!initialGenerationChromeLimited) return;
    setActiveLeftPanel("agent");
  }, [initialGenerationChromeLimited]);
  const durableLockedLayerCount = useMemo(
    () =>
      saveTemplateOpen
        ? countLockedLayersAcrossFiles(
            files.map((file) => ({ content: getScreenContent(file.id) })),
          )
        : lastDurableLockedLayerCountRef.current,
    [files, getScreenContent, saveTemplateOpen],
  );
  lastDurableLockedLayerCountRef.current = durableLockedLayerCount;
  const activeRuntimeSourceLocationUnavailable = useMemo(() => {
    const fileId = activeFile?.id;
    const snapshot = fileId ? runtimeLayerSnapshotsById[fileId] : undefined;
    if (
      !fileId ||
      !snapshot ||
      !activeRuntimeProjectionEligible ||
      runtimeLayerSnapshotReadiness?.screenId !== fileId ||
      runtimeLayerSnapshotReadiness.readiness.status !== "ready" ||
      runtimeLayerSnapshotReadiness.readiness.documentId !== snapshot.documentId
    ) {
      return false;
    }
    const projection = buildCodeLayerProjection(snapshot.html, {
      source: codeLayerSourceForScreen(fileId, "inline-html"),
    });
    return !projection.nodes.some((node) =>
      node.dataAttributes["data-source-file"]?.trim(),
    );
  }, [
    activeFile?.id,
    activeRuntimeProjectionEligible,
    codeLayerSourceForScreen,
    runtimeLayerSnapshotReadiness,
    runtimeLayerSnapshotsById,
  ]);
  const activeMotionTimeline = motionTimelineResult?.timelines?.[0] ?? null;
  const activeMotionHydrationFingerprint = activeFile?.id
    ? motionTimelineFingerprint(activeFile.id, activeMotionTimeline)
    : null;

  useEffect(() => {
    const fileId = activeFile?.id ?? null;
    if (previousMotionFileIdRef.current === fileId) return;
    previousMotionFileIdRef.current = fileId;
    const flushPendingMotionAutosave = motionAutosaveFlushRef.current;
    motionAutosaveFlushRef.current = null;
    if (flushPendingMotionAutosave) flushPendingMotionAutosave();
    clearMotionAutosaveTimer();
    motionAutosaveRevisionRef.current = 0;
    motionAutosaveFailedRevisionRef.current = null;
    lastScheduledMotionAutosaveRevisionRef.current = 0;
    setMotionTimelineId(null);
    setMotionTracks([]);
    setMotionDurationMs(2000);
    setMotionDefaultEase("ease");
    setMotionPlayhead(0);
    setMotionAutoKeyframeEnabled(false);
    setMotionTracksDirty(false);
    setMotionAutosaveRevision(0);
    setMotionHydrationFingerprint(null);
  }, [activeFile?.id, clearMotionAutosaveTimer]);

  useEffect(() => {
    if (!activeFile?.id || !activeMotionHydrationFingerprint) return;
    if (motionTracksDirty) return;
    if (motionHydrationFingerprint === activeMotionHydrationFingerprint) return;

    const hydratedTracks = activeMotionTimeline
      ? hydrateMotionDockTracks(
          activeMotionTimeline.tracks,
          activeCodeLayerProjection,
        )
      : [];

    setMotionTimelineId(activeMotionTimeline?.id ?? null);
    setMotionTracks(hydratedTracks);
    setMotionDurationMs(activeMotionTimeline?.durationMs ?? 2000);
    setMotionDefaultEase(activeMotionTimeline?.defaultEase ?? "ease");
    setMotionHydrationFingerprint(activeMotionHydrationFingerprint);
  }, [
    activeCodeLayerProjection,
    activeFile?.id,
    activeMotionHydrationFingerprint,
    activeMotionTimeline,
    motionHydrationFingerprint,
    motionTracksDirty,
  ]);
  const selectedElementLayerId = selectedCodeLayerNode?.id ?? null;
  const selectedMotionTargetNodeId =
    selectedCodeLayerNode?.dataAttributes[
      "data-agent-native-node-id"
    ]?.trim() ??
    selectedElement?.sourceId ??
    null;
  const selectedElementHasMotionTrack = useMemo(() => {
    if (!selectedMotionTargetNodeId) return false;
    return motionTracks.some(
      (track) => track.targetNodeId === selectedMotionTargetNodeId,
    );
  }, [motionTracks, selectedMotionTargetNodeId]);
  const motionKeyframeState = useMemo(() => {
    if (motionTracks.length === 0) return undefined;
    const keyframedProperties = selectedMotionTargetNodeId
      ? motionTracks
          .filter((track) => track.targetNodeId === selectedMotionTargetNodeId)
          .map((track) => track.property)
      : [];
    return { hasTimeline: true, keyframedProperties };
  }, [motionTracks, selectedMotionTargetNodeId]);

  const handleDesignStateSelect = useCallback(
    (stateId: string | null, row?: DesignStatePreviewRow) => {
      if (isStandaloneHttpUrl(activeContent)) {
        toast.error(t("designEditor.toasts.designStateLiveScreen"), {
          duration: 5000,
        });
        return;
      }
      setSelectedStateId(stateId);
      const content =
        stateId === null ? activeContent : designStatePreviewHtml(row);
      if (!content) return;
      // Through the canvas, so a later node swap diffs against what its frame shows.
      const replaceContent = (window as any).__designCanvasReplaceContent;
      if (typeof replaceContent !== "function") return;
      replaceContent(content, null, [], { forceFullDocument: true });
    },
    [activeContent],
  );
  const liveScreenIds = useMemo(
    () =>
      new Set(
        overviewScreens
          .filter(
            (screen) =>
              resolveOverviewScreenSourceType(screen, designSourceType) ===
              "localhost",
          )
          .map((screen) => screen.id),
      ),
    [designSourceType, overviewScreens],
  );
  liveScreenIdsRef.current = liveScreenIds;
  canEditLiveScreenIdsRef.current = canEditLiveScreens
    ? new Set([
        ...liveScreenIds,
        ...(publicVisualEdit && boardFileId ? [boardFileId] : []),
      ])
    : new Set();
  const canEditLiveScreen = useCallback(
    (screenId: string | null | undefined) =>
      canEditLiveScreens && Boolean(screenId && liveScreenIds.has(screenId)),
    [canEditLiveScreens, liveScreenIds],
  );
  const sourceCapabilities = useMemo(() => {
    const caps = resolveSourceCapabilities(designSourceType);
    return DESIGN_CAPABILITY_NAMES.filter((name) => hasCapability(caps, name));
  }, [designSourceType]);

  const fusionApp = useMemo(
    () => readFusionApp(designDataJson),
    [designDataJson],
  );
  useEffect(() => {
    if (fusionApp?.source !== "builder-host") return;
    setBuilderHostConfirmed(true);
  }, [fusionApp?.source]);

  const fullAppBuildingEnabled = useLab(FULL_APP_BUILDING_LAB);
  const designReviewPanelEnabled = useLab(DESIGN_REVIEW_TOOLS_LAB);

  useEffect(() => {
    if (!tweaksEnabled && activeInspectorTab === "tweaks") {
      setActiveInspectorTab("design");
    }
    if (!tweaksEnabled) setShowTweakPrompt(false);
  }, [activeInspectorTab, tweaksEnabled]);

  const designFusionUrl = useMemo(() => {
    const raw = (designDataJson as { fusionUrl?: unknown }).fusionUrl;
    if (typeof raw === "string" && raw) return raw;
    return fusionApp?.previewUrl;
  }, [designDataJson, fusionApp]);

  const handleActiveRuntimeLayerSnapshot = useCallback(
    (snapshot: RuntimeLayerSnapshot) => {
      if (!activeFile?.id) return;
      handleScreenRuntimeLayerSnapshot(activeFile.id, snapshot);
    },
    [activeFile?.id, handleScreenRuntimeLayerSnapshot],
  );
  const handleActiveRuntimeVerificationSnapshot = useCallback(
    (snapshot: RuntimeLayerSnapshot & { requestId: number }) => {
      if (!activeFile?.id) return;
      handleScreenRuntimeVerificationSnapshot(activeFile.id, snapshot);
    },
    [activeFile?.id, handleScreenRuntimeVerificationSnapshot],
  );

  const selectedComponentNodeId = useMemo(() => {
    if (selectedCodeLayerNode && isComponentInstance(selectedCodeLayerNode)) {
      return bridgeSourceIdForCodeLayerNode(selectedCodeLayerNode);
    }
    const runtimeComponent = selectedElement?.runtimeComponent;
    if (
      activeCanvasSourceType === "localhost" &&
      (selectedElement?.componentAnnotation?.trim() ||
        selectedElement?.componentName?.trim()) &&
      runtimeComponent?.componentId?.trim() &&
      runtimeComponent.instanceId?.trim() &&
      runtimeComponent.name?.trim() &&
      selectedElement?.provenance?.component?.trim()
    ) {
      return runtimeComponent.instanceId;
    }
    return undefined;
  }, [activeCanvasSourceType, selectedCodeLayerNode, selectedElement]);
  const acceptedActiveFile = activeFile?.id
    ? rawServerFilesByIdRef.current.get(activeFile.id)
    : undefined;
  const pendingActiveFileEntry = activeFile?.id
    ? pendingLocalFileContentsSnapshot.get(activeFile.id)
    : undefined;
  const acceptedActiveContent = pendingActiveFileEntry
    ? pendingActiveFileEntry.baseContent
    : acceptedActiveFile?.content;
  const hasSelectedComponent = Boolean(
    selectedComponentNodeId &&
    ((selectedCodeLayerNode && isComponentInstance(selectedCodeLayerNode)) ||
      (selectedElement?.runtimeComponent?.componentId?.trim() &&
        selectedElement.runtimeComponent.instanceId?.trim() &&
        selectedElement.runtimeComponent.name?.trim() &&
        selectedElement.provenance?.component?.trim())),
  );
  const acceptedComponentProjection = useMemo(() => {
    if (
      !hasSelectedComponent ||
      !acceptedActiveFile ||
      typeof acceptedActiveContent !== "string"
    ) {
      return undefined;
    }
    return buildCodeLayerProjection(acceptedActiveContent, {
      source: {
        kind: "design-file",
        ...(id ? { designId: id } : {}),
        fileId: acceptedActiveFile.id,
        ...(acceptedActiveFile.filename
          ? { filename: acceptedActiveFile.filename }
          : {}),
      },
    });
  }, [
    acceptedActiveContent,
    acceptedActiveFile?.filename,
    acceptedActiveFile?.id,
    hasSelectedComponent,
    id,
  ]);
  const componentDetailsReady = useMemo(() => {
    const matchesSelectedComponent = (node: CodeLayerNode) =>
      selectedComponentNodeId !== undefined &&
      isComponentInstance(node) &&
      componentNodeIdMatches(node, selectedComponentNodeId);
    const selectedNodeIsOptimistic = Boolean(
      selectedComponentNodeId &&
      activeCodeLayerProjection.nodes.some(matchesSelectedComponent),
    );
    if (!hasSelectedComponent || !selectedNodeIsOptimistic) return true;
    if (pendingActiveFileEntry && !acceptedComponentProjection) return false;
    if (!acceptedComponentProjection) return true;
    return acceptedComponentProjection.nodes.some(matchesSelectedComponent);
  }, [
    acceptedComponentProjection,
    activeCodeLayerProjection,
    hasSelectedComponent,
    pendingActiveFileEntry,
    selectedComponentNodeId,
  ]);
  const selectedComponentHasLocalOverrides = useMemo(
    () =>
      activeCanvasSourceType === "inline" &&
      componentInstanceHasLocalOverrides(
        activeCodeLayerProjection,
        selectedCodeLayerNode,
      ),
    [activeCanvasSourceType, activeCodeLayerProjection, selectedCodeLayerNode],
  );

  const motionSelectedTarget = useMemo<{
    nodeId: string;
    label: string;
  } | null>(() => {
    if (!selectedCodeLayerNode) return null;
    const nodeId =
      selectedCodeLayerNode.dataAttributes["data-agent-native-node-id"]?.trim();
    if (!nodeId) return null;
    const label =
      selectedCodeLayerNode.layerName ||
      selectedElement?.tagName ||
      "Selected element";
    return { nodeId, label };
  }, [selectedCodeLayerNode, selectedElement?.tagName]);

  const motionTracksWire = useMemo<MotionTrackWire[]>(() => {
    if (!motionDockOpen || motionTracks.length === 0) return [];
    return motionTracks.map(({ label: _label, ...track }) => track);
  }, [motionDockOpen, motionTracks]);

  const syncLiveScreenSnapshotPreview = useCallback(
    (screenId: string, html: string) => {
      if (screenId !== activeFile?.id) return;
      if (
        previewContentReplaceNeedsRenderFallback(
          replacePreviewContent(html, null, { forceFullDocument: true }),
        )
      ) {
        setContentRenderRevision((revision) => revision + 1);
      }
    },
    [activeFile?.id, replacePreviewContent],
  );

  const deleteRuntimeElement = useCallback(
    (
      selector?: string | null,
      candidates?: readonly string[],
      requestId?: string,
    ) => {
      const deleteElement = (window as any).__designCanvasDeleteElement;
      if (typeof deleteElement !== "function") return false;
      return Boolean(
        deleteElement(
          selector ?? selectedCanvasSelector,
          candidates ?? selectedCanvasSelectorCandidates,
          requestId,
        ),
      );
    },
    [selectedCanvasSelector, selectedCanvasSelectorCandidates],
  );

  const remapMotionTracksForClone = useCallback(
    (nodeIdMap: Map<string, string>, targetFileId: string) => {
      if (nodeIdMap.size === 0) return;
      if (previousMotionFileIdRef.current !== targetFileId) return;
      setMotionTracks((current) => {
        const cloned = current
          .filter((track) => nodeIdMap.has(track.targetNodeId))
          .map((track) => ({
            ...track,
            targetNodeId: nodeIdMap.get(track.targetNodeId)!,
          }));
        if (cloned.length === 0) return current;
        return [...current, ...cloned];
      });
      setMotionTracksDirty(true);
    },
    [],
  );

  const resolveAssetScreenPoint = useCallback(
    ({ clientX, clientY }: { clientX: number; clientY: number }) => {
      const container = canvasContainerRef.current;
      if (!container) return null;

      if (viewMode === "single") {
        const iframe = container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        );
        return resolveScreenDropPoint({
          clientX,
          clientY,
          screenId: activeFile?.id,
          iframeRect: iframe?.getBoundingClientRect(),
          zoomPercent: zoom,
        });
      }

      const frameShell = document
        .elementsFromPoint(clientX, clientY)
        .map((element) => element.closest<HTMLElement>("[data-frame-id]"))
        .find((element): element is HTMLElement => Boolean(element));
      const screenId = frameShell?.dataset.frameId;
      const iframe = Array.from(
        frameShell?.querySelectorAll<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        ) ?? [],
      ).find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        );
      });
      const liveOverviewZoom = readOverviewZoomPercentFromTransform(
        container.querySelector<HTMLElement>("[data-multi-screen-canvas-world]")
          ?.style.transform,
        overviewCanvasZoom,
      );
      return resolveScreenDropPoint({
        clientX,
        clientY,
        screenId,
        iframeRect: iframe?.getBoundingClientRect(),
        zoomPercent: liveOverviewZoom,
      });
    },
    [activeFile?.id, overviewCanvasZoom, viewMode, zoom],
  );

  const getContextCanvasPoint = useCallback(
    ({ clientX, clientY }: { clientX: number; clientY: number }) => {
      if (viewMode === "single") {
        const iframe = canvasContainerRef.current?.querySelector<HTMLElement>(
          "[data-design-preview-iframe]",
        );
        const point = computeIframeLocalCanvasPoint({
          clientX,
          clientY,
          iframeRect: iframe?.getBoundingClientRect() ?? null,
          zoomPercent: zoom,
        });
        if (point) return point;
      }
      const rect = canvasContainerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 120, y: 120 };
      return {
        x: Math.max(0, clientX - rect.left),
        y: Math.max(0, clientY - rect.top),
      };
    },
    [zoom, viewMode],
  );

  return {
    contentRenderRevision,
    setContentRenderRevision,
    motionTimelineId,
    setMotionTimelineId,
    motionTracks,
    setMotionTracks,
    motionDurationMs,
    setMotionDurationMs,
    motionDefaultEase,
    motionPlayhead,
    setMotionPlayhead,
    motionAutoKeyframeEnabled,
    setMotionAutoKeyframeEnabled,
    motionTracksDirty,
    setMotionTracksDirty,
    motionAutosaveRevision,
    setMotionAutosaveRevision,
    setMotionHydrationFingerprint,
    motionAutosaveRevisionRef,
    motionAutosaveFailedRevisionRef,
    lastScheduledMotionAutosaveRevisionRef,
    previousMotionFileIdRef,
    selectedStateId,
    saveTemplateOpen,
    setSaveTemplateOpen,
    zoom,
    collabContentRef,
    collabContentFileIdRef,
    others,
    canvasContainerRef,
    resolvedTheme,
    handleCanvasPointerMove,
    inspectorPopoverOpen,
    othersForOverlays,
    recentEditsForOverlays,
    othersWithAgentCursor,
    getOverviewFrameIframe,
    resolveOverviewSelectionRect,
    resolveOverviewRecentEditRect,
    overviewAgentOthers,
    overviewRecentEditsForOverlays,
    followingEmail,
    handleAvatarClick,
    initialGenerationChromeLimited,
    durableLockedLayerCount,
    activeProjectionContent,
    activeCodeLayerProjection,
    activeRuntimeProjectionEligible,
    activeRuntimeSourceLocationUnavailable,
    selectedCodeLayerNode,
    selectedElementLayerId,
    selectedMotionTargetNodeId,
    selectedElementHasMotionTrack,
    motionKeyframeState,
    selectedCanvasSelectorCandidates,
    selectedCanvasSelector,
    handleDesignStateSelect,
    liveScreenIds,
    canEditLiveScreen,
    sourceCapabilities,
    fusionApp,
    fullAppBuildingEnabled,
    designReviewPanelEnabled,
    designFusionUrl,
    handleActiveRuntimeLayerSnapshot,
    handleActiveRuntimeVerificationSnapshot,
    selectedComponentNodeId,
    componentDetailsReady,
    selectedComponentHasLocalOverrides,
    motionSelectedTarget,
    motionTracksWire,
    replacePreviewContent,
    syncLiveScreenSnapshotPreview,
    deleteRuntimeElement,
    remapMotionTracksForClone,
    resolveAssetScreenPoint,
    getContextCanvasPoint,
  };
}

export type EditorLiveEditsAndPresence = ReturnType<
  typeof useEditorLiveEditsAndPresence
>;
