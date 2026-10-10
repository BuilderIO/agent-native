import {
  isAssistantChatHistoryVersion,
  type AssistantChatHistoryVersion,
} from "@agent-native/core/client/agent-chat";
import { useSession } from "@agent-native/core/client/hooks";
import {
  getBuilderParentOrigin,
  isEmbedAuthActive,
} from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import {
  useIsMcpAppWidgetEmbed,
  useIsMcpDirectoryWidgetReadOnlyEmbed,
} from "@agent-native/core/client/mcp-app-host";
import { useFileUploadStatus } from "@agent-native/core/client/uploads";
import { useExternalAgentHost } from "@agent-native/toolkit/app/chat";
import { type AssistantChatHistoryConfig } from "@agent-native/toolkit/app/chat/chat/history-types";
import { useQueryClient } from "@tanstack/react-query";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useParams, useLocation } from "react-router";
import { toast } from "sonner";

import { formatShortcutLabel } from "@/components/design/keyboard-shortcuts";
import type {
  ElementInfo,
  RuntimeStructureInsertRequest,
  TextEditingState,
} from "@/components/design/types";
import { useDetectedFigmaComposerLink } from "@/components/editor/FigmaLinkComposerBubble";
import { useApplePlatform } from "@/hooks/use-shortcut-label";
import {
  builderSelectionChip,
  sendBuilderSelectionContext,
} from "@/lib/builder-host-chat";
import { isBuilderHostEmbed } from "@/lib/builder-host-origin";
import { isEmbedChromeRequested } from "@/lib/embed-chrome";
import { SHELL_DESIGN_ID } from "@/lib/shell-design";

import type {
  PendingStructureVerificationSession,
  PendingStructureVerificationStatus,
  RuntimeLayerSnapshot,
} from "../command-types";
import {
  DESIGN_EDITOR_DEBUG_LOGS,
  HOST_CHAT_SLOT_MESSAGE,
} from "../editor-constants";
import { describeSelectionForHost } from "../editor-helpers";
import {
  clearPendingEditSessionMarker,
  readPendingEditSessionMarker,
  type PendingEditSessionMarkerResult,
} from "../pending-edit-session-marker";
import {
  buildPendingVisualStyleRevertPatches,
  pendingLiveStructureEditsFromEdit,
  type PendingLiveLayerNameEdit,
  type PendingLiveLayerStateEdit,
  type PendingLiveNonStyleEdit,
  type PendingLiveStructureEdit,
  type PendingLiveTextEdit,
  type PendingVisualStyleEdit,
  replayPendingVisualStyleRuntimePatch,
  type VisualEditHandoffPublicationState,
} from "../pending-edits";
import { usePerformanceBufferGuard } from "../performance-buffer-guard";
import { endedTextEditClosesActiveSession } from "../text-edit-utils";
import { type DesignTool, type EditorMode } from "../types";

export function useEditorCore() {
  const t = useT();
  const fileUploadStatus = useFileUploadStatus();
  const externalAgentHost = useExternalAgentHost();
  const applePlatform = useApplePlatform();
  const shortcut = (binding: string) =>
    formatShortcutLabel(binding, applePlatform);
  const { id } = useParams<{ id: string }>();
  const { session, isLoading: sessionLoading } = useSession();
  const isSignedIn = Boolean(session?.email);
  const sessionResolved = !sessionLoading;
  const location = useLocation();
  usePerformanceBufferGuard();
  const initialEditorUrlRef = useRef<{
    designId: string | undefined;
    searchParams: URLSearchParams;
  } | null>(null);
  const initialRouteScreenGuardRef = useRef<string | null>(null);
  if (
    !initialEditorUrlRef.current ||
    initialEditorUrlRef.current.designId !== id
  ) {
    const nextSearchParams = new URLSearchParams(location.search);
    initialEditorUrlRef.current = {
      designId: id,
      searchParams: nextSearchParams,
    };
    initialRouteScreenGuardRef.current =
      nextSearchParams.get("screen") ??
      nextSearchParams.get("fileId") ??
      nextSearchParams.get("filename");
  }
  const initialSearchParams = initialEditorUrlRef.current.searchParams;
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const reviewPreview = searchParams.get("reviewPreview") === "1";
  const queryClient = useQueryClient();
  const shellMode = id === SHELL_DESIGN_ID;
  const embedded = shellMode || isEmbedAuthActive();
  const isVisualEditSurface = location.pathname.startsWith("/visual-edit/");
  const isLiveCanvasShareLink =
    isVisualEditSurface && searchParams.get("share") === "1";
  const embedChromeRequested = isEmbedChromeRequested();
  // An MCP App host owns navigation and chat, not the editor: the widget keeps
  // the canvas, tools, and inspector as floating controls instead of going bare.
  const widgetEmbed = useIsMcpAppWidgetEmbed();
  const readOnlyWidget = useIsMcpDirectoryWidgetReadOnlyEmbed();
  const hostOwnsChrome =
    embedded && !shellMode && !embedChromeRequested && !widgetEmbed;
  const [builderHostConfirmed, setBuilderHostConfirmed] = useState(() =>
    isBuilderHostEmbed(),
  );
  const hostEmbeddedEditor =
    embedded && !hostOwnsChrome && builderHostConfirmed;
  const hostChatSlotRef = useRef<HTMLDivElement | null>(null);
  const hostChatSlotObserverRef = useRef<ResizeObserver | null>(null);
  const postHostChatSlotRect = useCallback(() => {
    if (!hostEmbeddedEditor) return;
    const box = hostChatSlotRef.current?.getBoundingClientRect();
    const rect =
      box && box.width > 0 && box.height > 0
        ? {
            x: Math.round(box.left),
            y: Math.round(box.top),
            width: Math.round(box.width),
            height: Math.round(box.height),
          }
        : null;
    window.parent.postMessage(
      { type: HOST_CHAT_SLOT_MESSAGE, data: { rect } },
      getBuilderParentOrigin() ?? "*",
    );
  }, [hostEmbeddedEditor]);
  const attachHostChatSlot = useCallback(
    (node: HTMLDivElement | null) => {
      hostChatSlotRef.current = node;
      hostChatSlotObserverRef.current?.disconnect();
      hostChatSlotObserverRef.current = null;
      if (node && typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => postHostChatSlotRect());
        observer.observe(node);
        hostChatSlotObserverRef.current = observer;
      }
      postHostChatSlotRect();
    },
    [postHostChatSlotRect],
  );
  useEffect(() => {
    if (!hostEmbeddedEditor) return;
    window.addEventListener("resize", postHostChatSlotRect);
    return () => {
      window.removeEventListener("resize", postHostChatSlotRect);
      window.parent.postMessage(
        { type: HOST_CHAT_SLOT_MESSAGE, data: { rect: null } },
        getBuilderParentOrigin() ?? "*",
      );
    };
  }, [hostEmbeddedEditor, postHostChatSlotRect]);

  const designChatScope = useMemo(
    () => (id ? ({ type: "design" as const, id } as const) : null),
    [id],
  );
  const designChatHistory = useMemo<
    AssistantChatHistoryConfig | undefined
  >(() => {
    if (!designChatScope) return undefined;
    const designId = designChatScope.id;
    return {
      list: {
        action: "list-design-versions",
        args: (threadId) => ({
          designId,
          limit: 100,
          ...(threadId ? { threadId } : {}),
        }),
        getVersions: (result: unknown) => {
          const versions =
            result && typeof result === "object"
              ? (result as { versions?: unknown }).versions
              : undefined;
          return Array.isArray(versions)
            ? versions.filter(isAssistantChatHistoryVersion)
            : null;
        },
      },
      restore: {
        action: "restore-design-version",
        args: (version: AssistantChatHistoryVersion) => ({
          designId,
          versionId: version.id,
        }),
      },
    };
  }, [designChatScope]);
  const {
    link: detectedFigmaComposerLink,
    onComposerTextChange: handleComposerTextChange,
  } = useDetectedFigmaComposerLink();

  const [mode, setMode] = useState<EditorMode>("edit");
  const [overviewInteractScreenId, setOverviewInteractScreenId] = useState<
    string | null
  >(null);
  const overviewInteractScreenIdRef = useRef(overviewInteractScreenId);
  useEffect(() => {
    overviewInteractScreenIdRef.current = overviewInteractScreenId;
  }, [overviewInteractScreenId]);
  const [activeTool, setActiveTool] = useState<DesignTool>("move");
  const activeToolRef = useRef(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  const measuredScreenHeightByIdRef = useRef<Record<string, number>>({});
  const handleOverviewPrimaryContentHeightChange = useCallback(
    (screenId: string, heightPx: number) => {
      measuredScreenHeightByIdRef.current = {
        ...measuredScreenHeightByIdRef.current,
        [screenId]: heightPx,
      };
    },
    [],
  );
  const [viewMode, setViewMode] = useState<"single" | "overview">("overview");
  useEffect(() => {
    if (viewMode !== "single" || mode !== "interact") {
      setOverviewInteractScreenId(null);
    }
  }, [mode, viewMode]);
  const viewModeRef = useRef<"single" | "overview">("overview");
  const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(
    null,
  );
  const hostSelectionChipRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hostEmbeddedEditor) return;
    if (!selectedElement) {
      hostSelectionChipRef.current = null;
      return;
    }
    const chip = builderSelectionChip(
      describeSelectionForHost(selectedElement),
    );
    if (hostSelectionChipRef.current === chip) return;
    hostSelectionChipRef.current = chip;
    sendBuilderSelectionContext(describeSelectionForHost(selectedElement));
  }, [hostEmbeddedEditor, selectedElement]);
  const selectedElementRef = useRef(selectedElement);
  selectedElementRef.current = selectedElement;
  const [
    pendingVisualEditPublicationFailed,
    setPendingVisualEditPublicationFailed,
  ] = useState(false);
  const [
    pendingVisualEditRecoveryVisible,
    setPendingVisualEditRecoveryVisible,
  ] = useState(false);
  const [pendingEditSessionMarker, setPendingEditSessionMarker] =
    useState<PendingEditSessionMarkerResult>({ status: "absent" });
  const [
    pendingEditSessionRecoveryMarker,
    setPendingEditSessionRecoveryMarker,
  ] = useState<PendingEditSessionMarkerResult>({ status: "absent" });
  const pendingEditSessionDesignIdRef = useRef<string | null>(null);
  useEffect(() => {
    pendingEditSessionDesignIdRef.current = null;
    const marker = readPendingEditSessionMarker(id);
    setPendingEditSessionMarker(marker);
    setPendingEditSessionRecoveryMarker(marker);
  }, [id]);
  const clearPendingEditSessionRecovery = useCallback(() => {
    if (!id) return;
    pendingEditSessionDesignIdRef.current = null;
    const result = clearPendingEditSessionMarker(id);
    const nextState: PendingEditSessionMarkerResult =
      result.status === "cleared"
        ? { status: "absent" }
        : { status: "unavailable", reason: result.reason };
    setPendingEditSessionMarker(nextState);
    setPendingEditSessionRecoveryMarker(nextState);
  }, [id]);
  const clearPendingEditSessionRecoveryRef = useRef(
    clearPendingEditSessionRecovery,
  );
  useEffect(() => {
    clearPendingEditSessionRecoveryRef.current =
      clearPendingEditSessionRecovery;
  }, [clearPendingEditSessionRecovery]);
  const [pendingVisualStyleRevertRequest, setPendingVisualStyleRevertRequest] =
    useState<{
      requestId: number;
      patches: ReturnType<typeof buildPendingVisualStyleRevertPatches>;
    } | null>(null);
  const [pendingTextRevertRequest, setPendingTextRevertRequest] = useState<{
    requestId: number;
    patches: Array<{
      screenId: string;
      selector: string;
      sourceId?: string | null;
      value: string;
      html?: string;
      routePath?: string;
    }>;
  } | null>(null);
  const [pendingLayerStateReplayRequest, setPendingLayerStateReplayRequest] =
    useState<{
      requestId: number;
      patches: Array<{
        screenId: string;
        layerId: string;
        state: "hidden" | "locked";
        enabled: boolean;
        routePath?: string;
      }>;
    } | null>(null);
  const [pendingLayerNameReplayRequest, setPendingLayerNameReplayRequest] =
    useState<{
      requestId: number;
      patches: Array<{
        screenId: string;
        selector: string;
        sourceId?: string | null;
        name: string;
        routePath?: string;
      }>;
    } | null>(null);
  const [pendingStructureAckRequest, setPendingStructureAckRequest] = useState<{
    requestId: number;
    acks: Array<{
      screenId: string;
      requestId: string;
      applied: boolean;
      routePath?: string;
    }>;
  } | null>(null);
  const [runtimeStructureInsertRequest, setRuntimeStructureInsertRequestState] =
    useState<(RuntimeStructureInsertRequest & { screenId: string }) | null>(
      null,
    );
  const runtimeStructurePendingTransactionRef = useRef<string | null>(null);
  const setRuntimeStructureInsertRequest = useCallback<
    Dispatch<
      SetStateAction<
        (RuntimeStructureInsertRequest & { screenId: string }) | null
      >
    >
  >((next) => {
    if (typeof next !== "function" && next) {
      const pendingTransactionId =
        runtimeStructurePendingTransactionRef.current;
      if (pendingTransactionId && next.transactionId !== pendingTransactionId) {
        if (DESIGN_EDITOR_DEBUG_LOGS) {
          console.warn("[design] runtime structure insert admission refused", {
            pendingTransactionId,
            requestTransactionId: next.transactionId ?? null,
          });
        }
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
        return;
      }
    }
    setRuntimeStructureInsertRequestState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      if (resolved === current) return current;
      const pendingTransactionId =
        runtimeStructurePendingTransactionRef.current;
      if (
        resolved &&
        pendingTransactionId &&
        resolved.transactionId !== pendingTransactionId
      ) {
        if (DESIGN_EDITOR_DEBUG_LOGS) {
          console.warn("[design] runtime structure insert admission refused", {
            pendingTransactionId,
            requestTransactionId: resolved.transactionId ?? null,
          });
        }
        return current;
      }
      if (resolved?.transactionId) {
        runtimeStructurePendingTransactionRef.current = resolved.transactionId;
      }
      return resolved;
    });
  }, []);
  const [liveRoutePathsByScreenId, setLiveRoutePathsByScreenId] = useState<
    Record<string, string>
  >({});
  const liveRoutePathsByScreenIdRef = useRef<Record<string, string>>({});
  const handleLiveRoutePathChange = useCallback(
    (screenId: string | undefined, routePath: string) => {
      if (!screenId || !routePath) return;
      liveRoutePathsByScreenIdRef.current[screenId] = routePath;
      setLiveRoutePathsByScreenId((current) =>
        current[screenId] === routePath
          ? current
          : { ...current, [screenId]: routePath },
      );
    },
    [],
  );
  const [
    runtimeStructureVerificationRequest,
    setRuntimeStructureVerificationRequest,
  ] = useState<{
    requestId: number;
    screenIds: string[];
  } | null>(null);
  const [
    pendingStructureVerificationStatus,
    setPendingStructureVerificationStatus,
  ] = useState<PendingStructureVerificationStatus>("idle");
  const pendingStructureVerificationSessionRef = useRef<
    PendingStructureVerificationSession | undefined
  >(undefined);
  const pendingStructureVerificationSnapshotsRef = useRef<
    Map<number, Record<string, RuntimeLayerSnapshot>>
  >(new Map());
  const [
    pendingVisualStyleBaselineResetRequest,
    setPendingVisualStyleBaselineResetRequest,
  ] = useState<number | null>(null);
  const pendingVisualEditPublicationRevisionRef = useRef(0);
  const pendingVisualEditBridgeRevisionSyncKeyRef = useRef<string | null>(null);
  const pendingVisualEditPublisherIdRef = useRef(crypto.randomUUID());
  const pendingVisualEditClearRequestedRef = useRef<string | null>(null);
  const pendingVisualEditHadPendingRef = useRef<string | null>(null);
  const pendingVisualEditHandoffPublicationRef =
    useRef<VisualEditHandoffPublicationState | null>(null);
  const [
    pendingVisualEditHandoffServerRevision,
    setPendingVisualEditHandoffServerRevision,
  ] = useState<{
    designId: string;
    publicationRevision: number;
    serverRevision: number;
  } | null>(null);
  const pendingVisualEditReloadedHandoffRef =
    useRef<VisualEditHandoffPublicationState | null>(null);
  useEffect(() => {
    pendingVisualEditPublicationRevisionRef.current = 0;
    pendingVisualEditBridgeRevisionSyncKeyRef.current = null;
    pendingVisualEditPublisherIdRef.current = crypto.randomUUID();
    pendingVisualEditClearRequestedRef.current = null;
    pendingVisualEditHadPendingRef.current = null;
    pendingVisualEditHandoffPublicationRef.current = null;
    setPendingVisualEditHandoffServerRevision(null);
    pendingVisualEditReloadedHandoffRef.current = null;
    setPendingVisualEditPublicationFailed(false);
    setPendingVisualEditRecoveryVisible(false);
  }, [id]);
  const pendingStructureRedoReplayTimerRef = useRef<number | undefined>(
    undefined,
  );
  const cancelPendingStructureVerification = useCallback(
    (nextStatus: PendingStructureVerificationStatus = "idle") => {
      const session = pendingStructureVerificationSessionRef.current;
      if (!session && nextStatus !== "idle") return;
      if (session) {
        session.cancelled = true;
        session.abortController.abort();
      }
      pendingStructureVerificationSessionRef.current = undefined;
      pendingStructureVerificationSnapshotsRef.current.clear();
      setRuntimeStructureVerificationRequest(null);
      setPendingStructureVerificationStatus(nextStatus);
    },
    [],
  );
  useEffect(() => {
    setPendingStructureVerificationStatus("idle");
    setRuntimeStructureVerificationRequest(null);
    return () => {
      const session = pendingStructureVerificationSessionRef.current;
      if (session) {
        session.cancelled = true;
        session.abortController.abort();
      }
      pendingStructureVerificationSessionRef.current = undefined;
      pendingStructureVerificationSnapshotsRef.current.clear();
    };
  }, [id]);
  useEffect(
    () => () => {
      if (pendingStructureRedoReplayTimerRef.current !== undefined) {
        window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
      }
    },
    [],
  );
  const requestPendingVisualStyleRevert = useCallback(
    (edits: readonly PendingVisualStyleEdit[]) => {
      const patches = buildPendingVisualStyleRevertPatches(edits);
      if (patches.length === 0) return;
      const requestId = Date.now() + Math.random();
      const sendStyleForScreen = (window as any)
        .__designCanvasSendStyleForScreen;
      const fallbackPatches =
        typeof sendStyleForScreen === "function"
          ? patches.filter(
              (patch) =>
                !replayPendingVisualStyleRuntimePatch(
                  patch,
                  sendStyleForScreen,
                ),
            )
          : patches;
      if (fallbackPatches.length > 0) {
        setPendingVisualStyleRevertRequest({
          requestId,
          patches: fallbackPatches,
        });
      }
      setPendingVisualStyleBaselineResetRequest(requestId);
    },
    [],
  );
  const replayPendingVisualStyleRuntime = useCallback(
    (edits: readonly PendingVisualStyleEdit[]) => {
      const patches = edits
        .map((edit) => ({
          screenId: edit.screenId,
          selector: edit.selector,
          sourceId: edit.sourceId,
          ...(edit.runtimeSelector
            ? { runtimeSelector: edit.runtimeSelector }
            : {}),
          ...(edit.runtimeSourceId
            ? { runtimeSourceId: edit.runtimeSourceId }
            : {}),
          routePath: edit.routePath,
          styles: edit.styles,
          ...(edit.interactionState
            ? { interactionState: edit.interactionState }
            : {}),
        }))
        .filter((patch) => Object.keys(patch.styles).length > 0);
      if (patches.length === 0) return undefined;
      const requestId = Date.now() + Math.random();
      const sendStyleForScreen = (window as any)
        .__designCanvasSendStyleForScreen;
      const fallbackPatches =
        typeof sendStyleForScreen === "function"
          ? patches.filter(
              (patch) =>
                !replayPendingVisualStyleRuntimePatch(
                  patch,
                  sendStyleForScreen,
                ),
            )
          : patches;
      if (fallbackPatches.length > 0) {
        setPendingVisualStyleRevertRequest({
          requestId,
          patches: fallbackPatches,
        });
      }
      return requestId;
    },
    [],
  );
  const requestPendingLiveNonStyleRevert = useCallback(
    (edits: readonly PendingLiveNonStyleEdit[]) => {
      const requestId = Date.now() + Math.random();
      const textPatches = edits
        .filter((edit): edit is PendingLiveTextEdit => edit.kind === "text")
        .map((edit) => ({
          screenId: edit.screenId,
          selector: edit.selector,
          sourceId: edit.sourceId,
          value: edit.originalValue,
          html: edit.originalHtml,
          routePath: edit.routePath,
        }));
      const structureAcks = edits
        .filter(
          (edit): edit is PendingLiveStructureEdit => edit.kind === "structure",
        )
        .flatMap((edit) =>
          pendingLiveStructureEditsFromEdit(edit)
            .filter((member) => Boolean(member.requestId))
            .map((member) => ({
              screenId: member.screenId,
              requestId: member.requestId!,
              applied: false,
              routePath: member.routePath,
            })),
        );
      const layerStatePatches = edits
        .filter(
          (edit): edit is PendingLiveLayerStateEdit =>
            edit.kind === "layer-state",
        )
        .map((edit) => ({
          screenId: edit.screenId,
          layerId: edit.layerId,
          state: edit.state,
          enabled: edit.originalEnabled,
          routePath: edit.routePath,
        }));
      const layerNamePatches = edits
        .filter(
          (edit): edit is PendingLiveLayerNameEdit =>
            edit.kind === "layer-name",
        )
        .map((edit) => ({
          screenId: edit.screenId,
          selector: edit.selector,
          sourceId: edit.sourceId,
          name: edit.originalName,
          routePath: edit.routePath,
        }));
      if (textPatches.length > 0) {
        setPendingTextRevertRequest({ requestId, patches: textPatches });
      }
      if (structureAcks.length > 0) {
        setPendingStructureAckRequest({ requestId, acks: structureAcks });
      }
      if (layerStatePatches.length > 0) {
        setPendingLayerStateReplayRequest({
          requestId,
          patches: layerStatePatches,
        });
      }
      if (layerNamePatches.length > 0) {
        setPendingLayerNameReplayRequest({
          requestId,
          patches: layerNamePatches,
        });
      }
    },
    [],
  );
  const [textEditingState, setTextEditingState] = useState<TextEditingState>({
    active: false,
  });
  const activeTextEditingSessionRef = useRef<{
    screenId: string;
    sourceId?: string;
  } | null>(null);
  const handleTextEditingStateChangeForScreen = useCallback(
    (screenId: string, state: Omit<TextEditingState, "screenId">) => {
      const screenState = { ...state, screenId };
      if (state.active || state.hasRange) {
        activeTextEditingSessionRef.current = {
          screenId,
          sourceId: state.sourceId,
        };
        setTextEditingState(screenState);
        return;
      }
      if (
        !endedTextEditClosesActiveSession(activeTextEditingSessionRef.current, {
          screenId,
          sourceId: state.sourceId,
        })
      ) {
        return;
      }
      activeTextEditingSessionRef.current = null;
      setTextEditingState(screenState);
    },
    [],
  );
  const [hoveredElement, setHoveredElement] = useState<ElementInfo | null>(
    null,
  );
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const activeFileIdRef = useRef(activeFileId);
  activeFileIdRef.current = activeFileId;
  const minimalUiByDefault =
    widgetEmbed || (embedded && !hostOwnsChrome && !embedChromeRequested);
  const handleScreenRuntimeVerificationSnapshot = useCallback(
    (
      screenId: string,
      snapshot: RuntimeLayerSnapshot & { requestId: number },
    ) => {
      const session = pendingStructureVerificationSessionRef.current;
      if (
        !session ||
        session.cancelled ||
        session.requestId !== snapshot.requestId
      ) {
        return;
      }
      const byRequest = pendingStructureVerificationSnapshotsRef.current;
      const current = byRequest.get(snapshot.requestId) ?? {};
      byRequest.set(snapshot.requestId, {
        ...current,
        [screenId]: snapshot,
      });
    },
    [],
  );

  return {
    t,
    fileUploadStatus,
    externalAgentHost,
    shortcut,
    id,
    session,
    isSignedIn,
    sessionResolved,
    location,
    initialRouteScreenGuardRef,
    initialSearchParams,
    searchParams,
    reviewPreview,
    queryClient,
    shellMode,
    embedded,
    isVisualEditSurface,
    isLiveCanvasShareLink,
    embedChromeRequested,
    widgetEmbed,
    readOnlyWidget,
    hostOwnsChrome,
    setBuilderHostConfirmed,
    hostEmbeddedEditor,
    attachHostChatSlot,
    designChatScope,
    designChatHistory,
    detectedFigmaComposerLink,
    handleComposerTextChange,
    mode,
    setMode,
    overviewInteractScreenId,
    setOverviewInteractScreenId,
    overviewInteractScreenIdRef,
    activeTool,
    setActiveTool,
    activeToolRef,
    measuredScreenHeightByIdRef,
    handleOverviewPrimaryContentHeightChange,
    viewMode,
    setViewMode,
    viewModeRef,
    selectedElement,
    setSelectedElement,
    selectedElementRef,
    pendingVisualEditPublicationFailed,
    setPendingVisualEditPublicationFailed,
    pendingVisualEditRecoveryVisible,
    setPendingVisualEditRecoveryVisible,
    pendingEditSessionMarker,
    setPendingEditSessionMarker,
    pendingEditSessionRecoveryMarker,
    pendingEditSessionDesignIdRef,
    clearPendingEditSessionRecovery,
    clearPendingEditSessionRecoveryRef,
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
    runtimeStructureInsertRequest,
    runtimeStructurePendingTransactionRef,
    setRuntimeStructureInsertRequest,
    liveRoutePathsByScreenId,
    setLiveRoutePathsByScreenId,
    liveRoutePathsByScreenIdRef,
    handleLiveRoutePathChange,
    runtimeStructureVerificationRequest,
    setRuntimeStructureVerificationRequest,
    pendingStructureVerificationStatus,
    setPendingStructureVerificationStatus,
    pendingStructureVerificationSessionRef,
    pendingStructureVerificationSnapshotsRef,
    pendingVisualStyleBaselineResetRequest,
    setPendingVisualStyleBaselineResetRequest,
    pendingVisualEditPublicationRevisionRef,
    pendingVisualEditBridgeRevisionSyncKeyRef,
    pendingVisualEditPublisherIdRef,
    pendingVisualEditClearRequestedRef,
    pendingVisualEditHadPendingRef,
    pendingVisualEditHandoffPublicationRef,
    pendingVisualEditHandoffServerRevision,
    setPendingVisualEditHandoffServerRevision,
    pendingVisualEditReloadedHandoffRef,
    pendingStructureRedoReplayTimerRef,
    cancelPendingStructureVerification,
    requestPendingVisualStyleRevert,
    replayPendingVisualStyleRuntime,
    requestPendingLiveNonStyleRevert,
    textEditingState,
    handleTextEditingStateChangeForScreen,
    hoveredElement,
    setHoveredElement,
    activeFileId,
    setActiveFileId,
    activeFileIdRef,
    minimalUiByDefault,
    handleScreenRuntimeVerificationSnapshot,
  };
}

export type EditorCore = ReturnType<typeof useEditorCore>;
