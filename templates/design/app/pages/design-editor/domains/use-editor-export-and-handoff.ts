import { callAction } from "@agent-native/core/client/hooks";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { normalizeDesignSourceType } from "@shared/source-mode";
import { useState, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";

import { type ExportSettingsValue } from "@/components/design/inspector";
import { type LayersPanelHandle } from "@/components/design/LayersPanel";
import { getBreakpointIframeId } from "@/components/design/multi-screen/iframe-targeting";
import type { ElementInfo } from "@/components/design/types";
import {
  exportDesignAsFigmaSvg,
  type LiveFigmaSvgSnapshot,
  type LiveFigmaSvgSource,
} from "@/lib/figma-svg-copy";
import {
  canCopyPngToClipboard,
  copyPngPromiseToClipboard,
  PngClipboardError,
} from "@/lib/png-clipboard";

import { elementInfoFromCodeLayerNode } from "../code-layer-state";
import type { CodingHandoffResult } from "../command-types";
import { runApplyPendingVisualStylesWithAgent } from "../commands/apply-pending-visual-styles-with-agent";
import { runCopyAsFigmaSvg } from "../commands/copy-as-figma-svg";
import { runDownloadAllScreensPdf } from "../commands/download-all-screens-pdf";
import { runDownloadPdf } from "../commands/download-pdf";
import { runDownloadSvg } from "../commands/download-svg";
import {
  resolveSelectedScreensExportBounds,
  runRenderPngBlob,
} from "../commands/render-png-blob";
import {
  runSelectAll,
  explicitScreenTargetsAfterSelectAll,
} from "../commands/select-all";
import { getDesignDataRecord } from "../design-data-geometry-utils";
import {
  previewUrlAtLiveRoute,
  pageHasWebMcpHost,
} from "../design-editor-shared";
import { isCurrentRuntimeLayerSnapshot } from "../export-snapshot-frame";
import { NativeExportRenderError } from "../native-export-render";
import {
  formatPendingVisualStylePrompt,
  formatVisualEditClipboardPrompt,
  resolveOverviewScreenSourceType,
  shouldShowPendingVisualStyleApply,
} from "../pending-edits";
import { PngCaptureError, type PngCaptureScope } from "../png-export-render";
import { type VisualEditPromptResult } from "../VisualEditWebMcp";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorContentAndComponents } from "./use-editor-content-and-components";
import type { EditorCore } from "./use-editor-core";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import type { EditorLiveEditsAndPresence } from "./use-editor-live-edits-and-presence";
import type { EditorSelectionAndStyles } from "./use-editor-selection-and-styles";
import type { EditorToolsAndVectors } from "./use-editor-tools-and-vectors";

export function useEditorExportAndHandoff({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorLiveEditsAndPresence,
  editorContentAndComponents,
  editorToolsAndVectors,
  editorSelectionAndStyles,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorCanvasAndScreens: EditorCanvasAndScreens;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorContentAndComponents: EditorContentAndComponents;
  editorToolsAndVectors: EditorToolsAndVectors;
  editorSelectionAndStyles: EditorSelectionAndStyles;
}) {
  const {
    t,
    externalAgentHost,
    id,
    setMode,
    setActiveTool,
    viewMode,
    setViewMode,
    viewModeRef,
    selectedElement,
    setSelectedElement,
    pendingEditSessionMarker,
    pendingEditSessionRecoveryMarker,
    setPendingVisualStyleRevertRequest,
    setPendingStructureAckRequest,
    liveRoutePathsByScreenIdRef,
    setRuntimeStructureVerificationRequest,
    pendingStructureVerificationStatus,
    setPendingStructureVerificationStatus,
    pendingStructureVerificationSessionRef,
    pendingStructureVerificationSnapshotsRef,
    setPendingVisualStyleBaselineResetRequest,
    cancelPendingStructureVerification,
  } = editorCore;
  const {
    pendingVisualStyleEdits,
    pendingLiveNonStyleEdits,
    setPendingLiveNonStyleEdits,
    pendingLiveNonStyleEditsRef,
    stagedSourceHandoffRef,
    stagedHandoffStartTimerRef,
    setApplyingViaHost,
    clearPendingLiveEditState,
    setActiveLeftPanel,
    setMinimalUi,
    selectedLayerIdsState,
    setSelectedLayerIdsState,
    overviewSelectedScreenIds,
    setOverviewSelectedScreenIds,
    activeBreakpointWidthState,
    explicitOverviewScreenSelectionRef,
    pendingVisualEditCount,
  } = editorHistory;
  const {
    setRuntimeLayerSnapshotRequest,
    recordSelectionHistoryAroundChange,
    setDrawMode,
    setPinMode,
    design,
    canEditDesign,
    exportHtmlMutation,
    exportZipMutation,
  } = editorGenerationAndAccess;
  const {
    files,
    codeLayerSourceForScreen,
    liveScreenSnapshotsById,
    runtimeLayerSnapshotsById,
    runtimeLayerSnapshotsByIdRef,
    designDataJson,
    designSourceType,
    boardFileId,
    overviewScreens,
  } = editorFilesAndSaving;
  const {
    exportCanvasFrameGeometryById,
    activeFile,
    activeRuntimeLayerReadinessScreenIdRef,
    activeScreenBaseWidthPx,
    activeOverviewScreenId,
    activeOverviewScreen,
    activeCanvasSourceType,
  } = editorActiveScreenAndGeometry;
  const {
    exportPreviewScreenIdRef,
    runtimeLayerSnapshotReadinessByIdRef,
    canvasIframeRef,
  } = editorCanvasAndScreens;
  const { activeCodeLayerProjection, selectedElementLayerId } =
    editorLiveEditsAndPresence;
  const { setUiHidden } = editorContentAndComponents;
  const { selectionRevisionRef, selectedScreenIds } = editorToolsAndVectors;
  const { getFreshActiveContent } = editorSelectionAndStyles;

  const [pendingAgentHandoffBusy, setPendingAgentHandoffBusy] = useState(false);
  const pendingAgentHandoffBusyRef = useRef(false);
  const pendingStructureVerificationRevisionRef = useRef(0);
  const pendingVisualEditPublicationQueueRef = useRef<Promise<void>>(
    Promise.resolve(),
  );
  const [overviewSelectAllRequest, setOverviewSelectAllRequest] = useState(0);
  const [pngExporting, setPngExporting] = useState(false);
  const [exportPreviewScreenId, setExportPreviewScreenId] = useState<
    string | null
  >(null);
  const [svgExporting, setSvgExporting] = useState(false);
  const [figmaSvgExporting, setFigmaSvgExporting] = useState(false);
  const pngExportingRef = useRef(false);
  const figmaSvgExportingRef = useRef(false);
  const [codingHandoffResult, setCodingHandoffResult] =
    useState<CodingHandoffResult | null>(null);
  const [codingHandoffError, setCodingHandoffError] = useState<string | null>(
    null,
  );
  const [codingHandoffLoading, setCodingHandoffLoading] = useState(false);
  const layersPanelRef = useRef<LayersPanelHandle | null>(null);

  const handleSelectAllFrames = useCallback(() => {
    recordSelectionHistoryAroundChange(() => {
      const projection = activeFile
        ? buildCodeLayerProjection(getFreshActiveContent(), {
            source: codeLayerSourceForScreen(activeFile.id),
          })
        : null;
      const decision = projection
        ? runSelectAll({
            tree: buildCodeLayerTree(projection),
            selectedLayerIds: selectedLayerIdsState,
            nonLayerIds: new Set(files.map((file) => file.id)),
            fallback:
              viewModeRef.current === "single" ? "top-level-layers" : "screens",
          })
        : ({ kind: "screens" } as const);
      if (projection && decision.kind === "layers") {
        selectionRevisionRef.current += 1;
        explicitOverviewScreenSelectionRef.current =
          explicitScreenTargetsAfterSelectAll(
            decision,
            explicitOverviewScreenSelectionRef.current,
          );
        setSelectedLayerIdsState(decision.layerIds);
        const lastId = decision.layerIds[decision.layerIds.length - 1];
        const lastNode = projection.nodes.find((n) => n.id === lastId);
        if (lastNode)
          setSelectedElement(elementInfoFromCodeLayerNode(lastNode));
        return;
      }
      if (!overviewScreens.length) return;
      selectionRevisionRef.current += 1;
      setDrawMode(false);
      setPinMode(false);
      setMode("edit");
      setActiveTool("move");
      viewModeRef.current = "overview";
      setViewMode("overview");
      const selectedScreenIds = overviewScreens.map((screen) => screen.id);
      explicitOverviewScreenSelectionRef.current = selectedScreenIds;
      setOverviewSelectedScreenIds(selectedScreenIds);
      setOverviewSelectAllRequest((request) => request + 1);
    });
  }, [
    activeFile,
    codeLayerSourceForScreen,
    files,
    getFreshActiveContent,
    overviewScreens,
    recordSelectionHistoryAroundChange,
    selectedLayerIdsState,
  ]);

  const handleShowLayersPanel = useCallback(() => {
    setMinimalUi(false);
    setUiHidden(false);
    setActiveLeftPanel("file");
  }, []);

  const handleFindLayers = useCallback(() => {
    handleShowLayersPanel();
    window.requestAnimationFrame(() => layersPanelRef.current?.focusSearch());
  }, [handleShowLayersPanel]);

  const ensureCodingHandoff = useCallback(
    async (options?: { refresh?: boolean; silent?: boolean }) => {
      if (!id) return null;
      if (!options?.refresh && codingHandoffResult) return codingHandoffResult;
      try {
        setCodingHandoffError(null);
        setCodingHandoffLoading(true);
        const result = await callAction<CodingHandoffResult>(
          "export-coding-handoff",
          {
            id,
            origin: window.location.origin,
            format: "markdown",
          } as any,
        );
        setCodingHandoffResult(result);
        return result;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t("designEditor.toasts.codingHandoffError");
        setCodingHandoffError(message);
        if (!options?.silent) toast.error(message);
        return null;
      } finally {
        setCodingHandoffLoading(false);
      }
    },
    [codingHandoffResult, id, t],
  );

  const getCodingHandoffClipboardText = useCallback(
    (result: CodingHandoffResult | null) => {
      return typeof result?.clipboardText === "string"
        ? result.clipboardText
        : typeof result?.prompt === "string"
          ? result.prompt
          : "";
    },
    [],
  );

  const handleCopyCodingHandoff = useCallback(async () => {
    const result = await ensureCodingHandoff({ refresh: true });
    const text = getCodingHandoffClipboardText(result);
    if (!text) {
      toast.error(t("designEditor.toasts.codingHandoffError"));
      return;
    }
    try {
      if (!(await writeClipboardText(text))) {
        toast.error(t("designEditor.toasts.clipboardBlocked"));
        return;
      }
      toast.success(t("designEditor.toasts.codingHandoffCopied"));
    } catch {
      toast.error(t("designEditor.toasts.clipboardBlocked"));
    }
  }, [ensureCodingHandoff, getCodingHandoffClipboardText, t]);
  const pendingVisualStyleScreenSourceTypes = useMemo(
    () =>
      new Map<string, unknown>(
        overviewScreens.map((screen) => [
          screen.id,
          resolveOverviewScreenSourceType(screen, designSourceType),
        ]),
      ),
    [designSourceType, overviewScreens],
  );
  const screenRoutesById = useMemo(() => {
    const metadataByFileId = getDesignDataRecord(
      designDataJson,
      "screenMetadata",
    );
    const routes: Record<string, string> = {};
    for (const [fileId, entry] of Object.entries(metadataByFileId ?? {})) {
      const path = (entry as { path?: unknown })?.path;
      if (typeof path === "string" && path) routes[fileId] = path;
    }
    return routes;
  }, [designDataJson]);
  const showPendingVisualStyleApply = useMemo(
    () =>
      shouldShowPendingVisualStyleApply({
        edits: pendingVisualStyleEdits,
        liveEdits: pendingLiveNonStyleEdits,
        screenSourceTypes: pendingVisualStyleScreenSourceTypes,
        fallbackSourceType: activeCanvasSourceType ?? designSourceType,
      }),
    [
      activeCanvasSourceType,
      designSourceType,
      pendingLiveNonStyleEdits,
      pendingVisualStyleEdits,
      pendingVisualStyleScreenSourceTypes,
    ],
  );
  const pendingVisualStylePrompt = useMemo(
    () =>
      formatPendingVisualStylePrompt({
        designId: id,
        designTitle: design?.title,
        activeFileId: activeFile?.id,
        activeFilename: activeFile?.filename,
        localhostConnectionId: activeOverviewScreen?.connectionId,
        edits: pendingVisualStyleEdits,
        liveEdits: pendingLiveNonStyleEdits,
        audience: "coding-agent",
        screenRoutes: screenRoutesById,
      }),
    [
      activeFile?.filename,
      activeFile?.id,
      activeOverviewScreen?.connectionId,
      design?.title,
      id,
      pendingLiveNonStyleEdits,
      pendingVisualStyleEdits,
      screenRoutesById,
    ],
  );
  const visualEditPromptResult = useCallback<
    () => VisualEditPromptResult
  >(() => {
    if (pendingVisualEditCount > 0) {
      return {
        designId: id ?? null,
        pendingEditCount: pendingVisualEditCount,
        status: "ready",
        prompt: pendingVisualStylePrompt,
      };
    }
    const recoveryMarker = pendingEditSessionRecoveryMarker;
    if (recoveryMarker.status === "present") {
      const count = recoveryMarker.marker.count;
      return {
        designId: id ?? null,
        pendingEditCount: count,
        status: "session-ended",
        prompt: `The previous visual-edit session ended with ${count} pending edit${count === 1 ? "" : "s"}. Those live edits are no longer recoverable; recreate them in the canvas before asking the agent to apply source changes.`,
      };
    }
    if (recoveryMarker.status === "unavailable") {
      return {
        designId: id ?? null,
        pendingEditCount: 0,
        status: "unknown",
        prompt: `The previous visual-edit session marker could not be read (${recoveryMarker.reason}). Do not treat an empty prompt as proof that no edits were lost; inspect the source and recreate the intended canvas changes before applying.`,
      };
    }
    if (pendingEditSessionMarker.status === "unavailable") {
      return {
        designId: id ?? null,
        pendingEditCount: 0,
        status: "unknown",
        prompt: `The current visual-edit session marker could not be read (${pendingEditSessionMarker.reason}). Do not treat an empty prompt as proof that no edits were lost; inspect the source and recreate the intended canvas changes before applying.`,
      };
    }
    return {
      designId: id ?? null,
      pendingEditCount: 0,
      status: "empty",
      prompt: pendingVisualStylePrompt,
    };
  }, [
    id,
    pendingEditSessionMarker,
    pendingEditSessionRecoveryMarker,
    pendingVisualEditCount,
    pendingVisualStylePrompt,
  ]);
  const handleApplyPendingVisualStylesWithAgent = useCallback(
    async (promptOverride?: string) =>
      runApplyPendingVisualStylesWithAgent({
        cancelPendingStructureVerification,
        clearPendingLiveEditState,
        id,
        overviewScreens,
        pendingAgentHandoffBusyRef,
        pendingLiveNonStyleEdits,
        stagedHandoffStartTimerRef,
        stagedSourceHandoffRef,
        pendingStructureVerificationRevisionRef,
        pendingStructureVerificationSessionRef,
        pendingStructureVerificationSnapshotsRef,
        pendingLiveNonStyleEditsRef,
        pendingStructureVerificationStatus,
        pendingVisualStyleEdits,
        pendingVisualStylePrompt: promptOverride ?? pendingVisualStylePrompt,
        allowPromptOnly: promptOverride !== undefined,
        setActiveLeftPanel,
        setApplyingViaHost,
        setPendingAgentHandoffBusy,
        setPendingLiveNonStyleEdits,
        setPendingStructureAckRequest,
        setPendingStructureVerificationStatus,
        setPendingVisualStyleBaselineResetRequest,
        setPendingVisualStyleRevertRequest,
        setRuntimeStructureVerificationRequest,
        t,
      }),
    [
      cancelPendingStructureVerification,
      clearPendingLiveEditState,
      id,
      overviewScreens,
      pendingLiveNonStyleEdits,
      pendingStructureVerificationStatus,
      pendingVisualStyleEdits,
      pendingVisualStylePrompt,
      t,
    ],
  );
  const handleCopyPendingVisualStylePrompt = useCallback(
    async (promptOverride?: string, fullPrompt = true) => {
      if (
        promptOverride === undefined &&
        pendingVisualStyleEdits.length === 0 &&
        pendingLiveNonStyleEdits.length === 0
      ) {
        return;
      }
      try {
        await pendingVisualEditPublicationQueueRef.current;
        const host =
          externalAgentHost?.id === "chatgpt" ||
          externalAgentHost?.id === "claude"
            ? externalAgentHost.id
            : pageHasWebMcpHost()
              ? "webmcp"
              : null;
        const clipboardPrompt = formatVisualEditClipboardPrompt(
          promptOverride ?? pendingVisualStylePrompt,
          host,
          fullPrompt,
          id,
        );
        if (!(await writeClipboardText(clipboardPrompt))) {
          toast.error(t("designEditor.toasts.clipboardBlocked"));
          return;
        }
        toast.success(t("designEditor.pendingVisualStyles.copiedToast"), {
          description: t(
            "designEditor.pendingVisualStyles.copiedToastDescription",
          ),
        });
      } catch {
        toast.error(t("designEditor.toasts.clipboardBlocked"));
      }
    },
    [
      pendingLiveNonStyleEdits.length,
      pendingVisualStyleEdits.length,
      pendingVisualStylePrompt,
      externalAgentHost,
      id,
      t,
    ],
  );

  const triggerBlobDownload = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, []);

  const fallbackExportName = useCallback(
    (extension: string, suffix = "") => {
      const safeTitle =
        design?.title?.replace(/[^a-zA-Z0-9_-]/g, "-") || "design";
      const safeSuffix = suffix.trim().replace(/[^a-zA-Z0-9@._-]/g, "-");
      return `${safeTitle}${safeSuffix ? `-${safeSuffix}` : ""}.${extension}`;
    },
    [design?.title],
  );

  const handleDownloadHtml = useCallback(() => {
    if (!id) return;
    exportHtmlMutation.mutate({ id } as any, {
      onSuccess: (result: any) => {
        if (typeof result?.html !== "string") {
          toast.error(t("designEditor.toasts.htmlCreateError"));
          return;
        }
        triggerBlobDownload(
          new Blob([result.html], { type: "text/html;charset=utf-8" }),
          result.filename || fallbackExportName("html"),
        );
        toast.success(t("designEditor.toasts.htmlDownloaded"));
      },
      onError: (error) => {
        toast.error(error.message || t("designEditor.toasts.htmlExportError"));
      },
    });
  }, [exportHtmlMutation, fallbackExportName, id, t, triggerBlobDownload]);

  const handleDownloadZip = useCallback(() => {
    if (!id) return;
    exportZipMutation.mutate({ id } as any, {
      onSuccess: (result: any) => {
        if (typeof result?.zipBase64 !== "string") {
          toast.error(t("designEditor.toasts.zipCreateError"));
          return;
        }
        const binary = window.atob(result.zipBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        triggerBlobDownload(
          new Blob([bytes], { type: "application/zip" }),
          result.filename || fallbackExportName("zip"),
        );
        toast.success(t("designEditor.toasts.zipDownloaded"));
      },
      onError: (error) => {
        toast.error(error.message || t("designEditor.toasts.zipExportError"));
      },
    });
  }, [exportZipMutation, fallbackExportName, id, t, triggerBlobDownload]);

  const pngSelectedElements = useMemo(() => {
    const selectedIds = new Set(selectedLayerIdsState);
    const projected = activeCodeLayerProjection.nodes
      .filter((node) => selectedIds.has(node.id))
      .map((node) => ({
        ...elementInfoFromCodeLayerNode(node),
        ...(activeCodeLayerProjection.source?.fileId
          ? {
              sourceLayerIdentity: {
                screenId: activeCodeLayerProjection.source.fileId,
                nodeId: node.id,
              },
            }
          : {}),
      }));
    return projected.length > 0
      ? projected
      : selectedElement
        ? [selectedElement]
        : [];
  }, [activeCodeLayerProjection.nodes, selectedElement, selectedLayerIdsState]);

  const resolveSnapshotExportSource = useCallback(
    async (screenId: string) => {
      const screen = overviewScreens.find(
        (candidate) => candidate.id === screenId,
      );
      if (!screen) return null;
      const deadline = window.performance.now() + 15_000;
      while (window.performance.now() < deadline) {
        const snapshot = runtimeLayerSnapshotsByIdRef.current[screenId];
        const baseUrl =
          liveScreenSnapshotsById[screenId]?.url ??
          previewUrlAtLiveRoute(
            screen.url ?? screen.previewUrl,
            liveRoutePathsByScreenIdRef.current[screenId],
          );
        if (
          snapshot?.html &&
          baseUrl &&
          isCurrentRuntimeLayerSnapshot(
            snapshot,
            runtimeLayerSnapshotReadinessByIdRef.current[screenId],
          )
        ) {
          return { html: snapshot.html, baseUrl };
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
      }
      return null;
    },
    [liveScreenSnapshotsById, overviewScreens],
  );
  const markScreenForExport = useCallback(
    (screenId: string) => {
      if (exportPreviewScreenIdRef.current !== screenId) {
        runtimeLayerSnapshotReadinessByIdRef.current[screenId] = {
          status: "loading",
        };
        if (activeRuntimeLayerReadinessScreenIdRef.current === screenId) {
          setRuntimeLayerSnapshotRequest(Date.now() + Math.random());
        }
      }
      exportPreviewScreenIdRef.current = screenId;
      setExportPreviewScreenId(screenId);
    },
    [setExportPreviewScreenId],
  );
  const prepareSelectedScreenForExport = useCallback(
    async (screenId: string) => {
      const screen = overviewScreens.find(
        (candidate) => candidate.id === screenId,
      );
      const sourceType =
        normalizeDesignSourceType(screen?.sourceType) ?? activeCanvasSourceType;
      if (sourceType === "inline") return null;
      markScreenForExport(screenId);
      return await resolveSnapshotExportSource(screenId);
    },
    [
      activeCanvasSourceType,
      markScreenForExport,
      overviewScreens,
      resolveSnapshotExportSource,
    ],
  );
  const releaseScreenFromExport = useCallback(() => {
    exportPreviewScreenIdRef.current = null;
    setExportPreviewScreenId(null);
  }, [setExportPreviewScreenId]);

  const resolvePngCaptureTarget = useCallback(
    async (scope: PngCaptureScope, requestedScreenId?: string) => {
      let iframe = canvasIframeRef.current;
      let cropSelection: ElementInfo | readonly ElementInfo[] | null =
        viewMode === "single" || scope === "element"
          ? pngSelectedElements.length > 0
            ? pngSelectedElements
            : selectedElement
          : null;

      if (scope === "screens" && viewMode === "overview") {
        const screenId =
          requestedScreenId ??
          (selectedScreenIds.length === 1 ? selectedScreenIds[0] : null);
        iframe = screenId
          ? document.querySelector<HTMLIFrameElement>(
              `iframe[data-screen-iframe-id="${CSS.escape(screenId)}"]`,
            )
          : null;
        cropSelection = null;
      } else if (scope === "element" && viewMode === "overview") {
        const ownerFileId =
          pngSelectedElements[0]?.sourceLayerIdentity?.screenId ??
          selectedElement?.sourceLayerIdentity?.screenId ??
          activeFile?.id;
        iframe =
          ownerFileId === boardFileId
            ? document.querySelector<HTMLIFrameElement>(
                "[data-board-surface-layer] iframe[data-design-preview-iframe]",
              )
            : ownerFileId
              ? document.querySelector<HTMLIFrameElement>(
                  `iframe[data-screen-iframe-id="${CSS.escape(ownerFileId)}"]`,
                )
              : null;
      }

      if (!iframe) throw new PngCaptureError("no-preview");

      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
        if (!doc?.documentElement) doc = null;
      } catch {
        doc = null;
      }
      if (!doc) {
        const sourceType =
          normalizeDesignSourceType(iframe.dataset.designSourceType) ??
          activeCanvasSourceType;
        if (sourceType !== "inline") {
          const screenId =
            requestedScreenId ??
            pngSelectedElements[0]?.sourceLayerIdentity?.screenId ??
            selectedElement?.sourceLayerIdentity?.screenId ??
            (selectedScreenIds.length === 1 ? selectedScreenIds[0] : null) ??
            activeFile?.id;
          const snapshotSource = screenId
            ? await prepareSelectedScreenForExport(screenId)
            : null;
          const screen = screenId
            ? overviewScreens.find((candidate) => candidate.id === screenId)
            : undefined;
          if (snapshotSource) {
            return {
              cropSelection,
              doc: null,
              iframe,
              snapshotSource,
              snapshotWidth: screen?.width ?? iframe.clientWidth,
              snapshotHeight: screen?.height ?? iframe.clientHeight,
            };
          }
          throw new PngCaptureError("external-preview");
        }
        if (!canEditDesign) {
          throw new PngCaptureError("read-only-preview");
        }
        throw new PngCaptureError("no-preview");
      }

      return { cropSelection, doc, iframe };
    },
    [
      activeCanvasSourceType,
      canEditDesign,
      canvasIframeRef,
      activeFile?.id,
      boardFileId,
      overviewScreens,
      prepareSelectedScreenForExport,
      pngSelectedElements,
      selectedElement,
      selectedScreenIds,
      viewMode,
    ],
  );

  const resolveSelectedScreensBounds = useCallback(() => {
    if (viewMode !== "overview") return null;
    const iframeSizeById = new Map(
      selectedScreenIds.flatMap((screenId) => {
        const iframe = document.querySelector<HTMLIFrameElement>(
          `iframe[data-screen-iframe-id="${CSS.escape(screenId)}"]`,
        );
        return iframe
          ? [
              [
                screenId,
                { width: iframe.clientWidth, height: iframe.clientHeight },
              ] as const,
            ]
          : [];
      }),
    );
    return resolveSelectedScreensExportBounds({
      selectedScreenIds,
      overviewScreens,
      canvasFrameGeometryById: exportCanvasFrameGeometryById,
      iframeSizeById,
    });
  }, [
    exportCanvasFrameGeometryById,
    overviewScreens,
    selectedScreenIds,
    viewMode,
  ]);

  const renderPngBlob = useCallback(
    async (arg0: {
      scope: PngCaptureScope;
      settings?: Partial<ExportSettingsValue>;
      format?: "png" | "jpg" | "webp";
    }): Promise<Blob> =>
      runRenderPngBlob(
        {
          activeCanvasSourceType,
          canEditDesign,
          canvasFrameGeometryById: exportCanvasFrameGeometryById,
          overviewScreens,
          releaseScreenFromExport,
          resolvePngCaptureTarget,
          selectedScreenIds,
          viewMode,
        },
        arg0,
      ),
    [
      activeCanvasSourceType,
      canEditDesign,
      exportCanvasFrameGeometryById,
      overviewScreens,
      prepareSelectedScreenForExport,
      releaseScreenFromExport,
      resolvePngCaptureTarget,
      selectedScreenIds,
      viewMode,
    ],
  );

  const showRasterCaptureError = useCallback(
    (error: unknown, format: "png" | "pdf" = "png") => {
      if (error instanceof PngCaptureError) {
        console.error(`${format.toUpperCase()} capture failed:`, error);
        if (format === "pdf") {
          toast.error(t("designEditor.toasts.pdfExportError"));
          return;
        }
        const copy = {
          externalPreview: "designEditor.toasts.pngExportError" as const,
          readOnlyPreview:
            "designEditor.toasts.pngReadOnlyUnavailable" as const,
          selectionUnresolved: "designEditor.toasts.pngCreateError" as const,
          blobFailed: "designEditor.toasts.pngCreateError" as const,
          noPreview: "designEditor.toasts.openScreenPng" as const,
        };
        const key =
          error.code === "external-preview"
            ? copy.externalPreview
            : error.code === "read-only-preview"
              ? copy.readOnlyPreview
              : error.code === "blob-failed"
                ? copy.blobFailed
                : error.code === "selection-unresolved"
                  ? copy.selectionUnresolved
                  : copy.noPreview;
        toast.error(t(key));
        return;
      }
      console.error(`${format.toUpperCase()} capture failed:`, error);
      const exportErrorToastKeys = {
        export_too_large: "designEditor.toasts.exportTooLarge",
        export_resources_unavailable:
          "designEditor.toasts.exportResourcesUnavailable",
        export_render_timeout: "designEditor.toasts.exportTimedOut",
        export_render_busy: "designEditor.toasts.exportBusy",
        export_chromium_unavailable:
          "designEditor.toasts.exportChromiumUnavailable",
      } as const;
      const errorCode =
        error instanceof NativeExportRenderError ? error.code : undefined;
      const errorKey =
        errorCode && errorCode in exportErrorToastKeys
          ? exportErrorToastKeys[errorCode as keyof typeof exportErrorToastKeys]
          : format === "pdf"
            ? "designEditor.toasts.pdfExportError"
            : "designEditor.toasts.pngExportError";
      toast.error(t(errorKey));
    },
    [t],
  );

  const handleDownloadPng = useCallback(
    async (
      settings?: Partial<ExportSettingsValue>,
      format: "png" | "jpg" | "webp" = "png",
      scope: PngCaptureScope = "document",
    ) => {
      if (pngExportingRef.current) return;
      pngExportingRef.current = true;
      setPngExporting(true);
      try {
        const blob = await renderPngBlob({
          scope,
          settings,
          format,
        });
        triggerBlobDownload(blob, fallbackExportName(format, settings?.suffix));
        toast.success(t("designEditor.toasts.pngDownloaded"));
      } catch (error) {
        showRasterCaptureError(error);
      } finally {
        pngExportingRef.current = false;
        setPngExporting(false);
      }
    },
    [
      fallbackExportName,
      renderPngBlob,
      showRasterCaptureError,
      t,
      triggerBlobDownload,
    ],
  );

  const handleDownloadPdf = useCallback(
    async (
      settings?: Partial<ExportSettingsValue>,
      scope: PngCaptureScope = "document",
    ) =>
      runDownloadPdf(
        {
          fallbackExportName,
          pngExportingRef,
          renderPngBlob,
          resolveSelectedScreensBounds,
          resolvePngCaptureTarget,
          releaseScreenFromExport,
          setPngExporting,
          showRasterCaptureError,
          t,
          triggerBlobDownload,
        },
        settings,
        scope,
      ),
    [
      fallbackExportName,
      renderPngBlob,
      resolveSelectedScreensBounds,
      resolvePngCaptureTarget,
      releaseScreenFromExport,
      t,
      triggerBlobDownload,
    ],
  );

  const handleDownloadAllScreensPdf = useCallback(
    async () =>
      runDownloadAllScreensPdf({
        activeCanvasSourceType,
        canEditDesign,
        canvasFrameGeometryById: exportCanvasFrameGeometryById,
        fallbackExportName,
        overviewScreens,
        prepareScreenForExport: markScreenForExport,
        resolveSnapshotExportSource,
        releaseScreenFromExport,
        pngExportingRef,
        setPngExporting,
        showRasterCaptureError,
        t,
        triggerBlobDownload,
      }),
    [
      activeCanvasSourceType,
      canEditDesign,
      exportCanvasFrameGeometryById,
      fallbackExportName,
      overviewScreens,
      markScreenForExport,
      resolveSnapshotExportSource,
      releaseScreenFromExport,
      showRasterCaptureError,
      t,
      triggerBlobDownload,
    ],
  );

  const handleCopyAsPng = useCallback(async () => {
    if (pngExportingRef.current) return;
    if (!canCopyPngToClipboard()) {
      toast.error(t("designEditor.toasts.pngClipboardUnsupported"));
      return;
    }

    pngExportingRef.current = true;
    setPngExporting(true);
    try {
      const pngBlob = renderPngBlob({ scope: "screens" });
      await copyPngPromiseToClipboard(pngBlob);
      toast.success(t("designEditor.toasts.pngCopied"));
    } catch (error) {
      if (error instanceof PngClipboardError) {
        const key =
          error.code === "blocked"
            ? "designEditor.toasts.pngClipboardBlocked"
            : error.code === "unsupported"
              ? "designEditor.toasts.pngClipboardUnsupported"
              : "designEditor.toasts.pngClipboardWriteError";
        toast.error(t(key));
      } else {
        showRasterCaptureError(error);
      }
    } finally {
      pngExportingRef.current = false;
      setPngExporting(false);
    }
  }, [renderPngBlob, showRasterCaptureError, t]);

  const resolveLiveFigmaSvgSource = useCallback(
    (targetFileId: string | undefined): LiveFigmaSvgSource | null => {
      const iframe =
        (targetFileId
          ? document.querySelector<HTMLIFrameElement>(
              `iframe[data-design-preview-iframe][data-screen-iframe-id="${CSS.escape(targetFileId)}"]`,
            )
          : null) ?? canvasIframeRef.current;
      if (!iframe) return null;
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
        if (!doc?.documentElement) doc = null;
      } catch {
        doc = null;
      }
      if (!doc) return null;
      const screen = targetFileId
        ? overviewScreens.find((candidate) => candidate.id === targetFileId)
        : null;
      const geometry = targetFileId
        ? exportCanvasFrameGeometryById[targetFileId]
        : undefined;
      return {
        document: doc,
        title: design?.title ?? activeFile?.filename ?? null,
        width: selectedElementLayerId
          ? null
          : (geometry?.width ?? screen?.width ?? activeScreenBaseWidthPx),
        height: selectedElementLayerId
          ? null
          : (geometry?.height ?? screen?.height ?? null),
      };
    },
    [
      activeFile?.filename,
      activeScreenBaseWidthPx,
      exportCanvasFrameGeometryById,
      canvasIframeRef,
      design?.title,
      overviewScreens,
      selectedElementLayerId,
    ],
  );

  const resolveLiveFigmaSvgSnapshot = useCallback(
    (targetFileId: string | undefined): LiveFigmaSvgSnapshot | null => {
      if (!targetFileId) return null;
      const snapshot = runtimeLayerSnapshotsById[targetFileId];
      if (
        !snapshot?.html ||
        !isCurrentRuntimeLayerSnapshot(
          snapshot,
          runtimeLayerSnapshotReadinessByIdRef.current[targetFileId],
        )
      ) {
        return null;
      }
      const screen = overviewScreens.find(
        (candidate) => candidate.id === targetFileId,
      );
      const geometry = exportCanvasFrameGeometryById[targetFileId];
      return {
        html: snapshot.html,
        title: design?.title ?? activeFile?.filename ?? null,
        width: selectedElementLayerId
          ? null
          : (geometry?.width ?? screen?.width ?? activeScreenBaseWidthPx),
        height: selectedElementLayerId
          ? null
          : (geometry?.height ?? screen?.height ?? null),
      };
    },
    [
      activeFile?.filename,
      activeScreenBaseWidthPx,
      exportCanvasFrameGeometryById,
      design?.title,
      overviewScreens,
      runtimeLayerSnapshotsById,
      selectedElementLayerId,
    ],
  );

  const handleCopyAsFigmaSvg = useCallback(
    async () =>
      runCopyAsFigmaSvg({
        activeFile,
        figmaSvgExportingRef,
        id,
        resolveLiveFigmaSvgSnapshot,
        resolveLiveFigmaSvgSource,
        selectedElementLayerId,
        selectedScreenIds,
        setFigmaSvgExporting,
        t,
      }),
    [
      activeFile?.id,
      id,
      resolveLiveFigmaSvgSource,
      resolveLiveFigmaSvgSnapshot,
      selectedElementLayerId,
      selectedScreenIds,
      t,
    ],
  );

  const handleDownloadFigmaSvg = useCallback(async () => {
    if (figmaSvgExportingRef.current) return;
    const targetFileId = activeFile?.id ?? selectedScreenIds[0] ?? undefined;
    if (!targetFileId) {
      toast.error(t("designEditor.toasts.openScreenSvg"));
      return;
    }
    figmaSvgExportingRef.current = true;
    setFigmaSvgExporting(true);
    try {
      const result = await exportDesignAsFigmaSvg(
        {
          designId: id,
          fileId: targetFileId,
          nodeId: selectedElementLayerId ?? undefined,
        },
        {
          liveSource: resolveLiveFigmaSvgSource(targetFileId),
          liveSnapshot: resolveLiveFigmaSvgSnapshot(targetFileId),
        },
      );
      triggerBlobDownload(
        new Blob([result.svg], { type: "image/svg+xml;charset=utf-8" }),
        result.filename || fallbackExportName("svg", "figma"),
      );
      toast.success(t("designEditor.toasts.figmaSvgDownloaded"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("designEditor.toasts.figmaSvgExportError"),
      );
    } finally {
      figmaSvgExportingRef.current = false;
      setFigmaSvgExporting(false);
    }
  }, [
    activeFile?.id,
    fallbackExportName,
    id,
    resolveLiveFigmaSvgSource,
    resolveLiveFigmaSvgSnapshot,
    selectedElementLayerId,
    selectedScreenIds,
    t,
    triggerBlobDownload,
  ]);

  const handleDownloadSvg = useCallback(
    async (settings?: Partial<ExportSettingsValue>) => {
      const exportScreenId =
        viewMode === "overview" && overviewSelectedScreenIds.length === 1
          ? (overviewSelectedScreenIds[0] ?? activeOverviewScreenId)
          : activeOverviewScreenId;
      const exportScreen = overviewScreens.find(
        (screen) => screen.id === exportScreenId,
      );
      const activePreviewFrameId =
        exportScreenId &&
        activeBreakpointWidthState !== undefined &&
        exportScreen?.breakpointWidths?.includes(activeBreakpointWidthState)
          ? getBreakpointIframeId(exportScreenId, activeBreakpointWidthState)
          : exportScreenId;
      return runDownloadSvg(
        {
          activePreviewFrameId,
          design,
          fallbackExportName,
          selectedElement,
          setSvgExporting,
          t,
          triggerBlobDownload,
        },
        settings,
      );
    },
    [
      activeBreakpointWidthState,
      activeOverviewScreenId,
      design?.title,
      fallbackExportName,
      overviewScreens,
      overviewSelectedScreenIds,
      selectedElement,
      t,
      triggerBlobDownload,
      viewMode,
    ],
  );

  const inspectorRasterScope: PngCaptureScope =
    pngSelectedElements.length > 0
      ? "element"
      : viewMode === "overview" && overviewSelectedScreenIds.length > 0
        ? "screens"
        : "document";

  const handleRenderExportPreview = useCallback(
    () =>
      renderPngBlob({ scope: inspectorRasterScope, settings: { scale: 1 } }),
    [inspectorRasterScope, renderPngBlob],
  );

  const handleInspectorExport = useCallback(
    async (settingsList: ExportSettingsValue[]) => {
      for (const settings of settingsList) {
        if (settings.format === "svg") {
          await handleDownloadSvg(settings);
        } else if (settings.format === "pdf") {
          await handleDownloadPdf(settings, inspectorRasterScope);
        } else if (settings.format === "jpg" || settings.format === "webp") {
          await handleDownloadPng(
            settings,
            settings.format,
            inspectorRasterScope,
          );
        } else {
          await handleDownloadPng(settings, "png", inspectorRasterScope);
        }
      }
    },
    [
      handleDownloadPdf,
      handleDownloadPng,
      handleDownloadSvg,
      inspectorRasterScope,
    ],
  );

  return {
    pendingAgentHandoffBusy,
    pendingVisualEditPublicationQueueRef,
    overviewSelectAllRequest,
    pngExporting,
    exportPreviewScreenId,
    svgExporting,
    figmaSvgExporting,
    codingHandoffResult,
    codingHandoffError,
    codingHandoffLoading,
    layersPanelRef,
    handleSelectAllFrames,
    handleShowLayersPanel,
    handleFindLayers,
    getCodingHandoffClipboardText,
    handleCopyCodingHandoff,
    showPendingVisualStyleApply,
    pendingVisualStylePrompt,
    visualEditPromptResult,
    handleApplyPendingVisualStylesWithAgent,
    handleCopyPendingVisualStylePrompt,
    handleDownloadHtml,
    handleDownloadZip,
    handleDownloadPng,
    handleDownloadAllScreensPdf,
    handleCopyAsPng,
    handleCopyAsFigmaSvg,
    handleDownloadFigmaSvg,
    handleDownloadSvg,
    handleRenderExportPreview,
    handleInspectorExport,
  };
}

export type EditorExportAndHandoff = ReturnType<
  typeof useEditorExportAndHandoff
>;
