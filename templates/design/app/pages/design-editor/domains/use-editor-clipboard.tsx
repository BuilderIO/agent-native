import { callAction } from "@agent-native/core/client/hooks";
import {
  getElementWorldBoundsForZoomFit,
  getFrameGroupBounds,
  type FrameBounds,
  type FrameEntry,
} from "@shared/canvas-math";
import {
  buildCodeLayerProjection,
  type CodeLayerNode,
} from "@shared/code-layer";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

import { type CanvasContextMenuPoint } from "@/components/design/CanvasContextMenu";
import type {
  IframeFigmaClipboardPastePayload,
  IframeImagePastePayload,
} from "@/components/design/design-canvas/iframe-events";
import { DESIGN_FILE_STORAGE_REQUIRED_EVENT } from "@/components/design/editor/DesignBottomToolbar";
import { FigmaPasteImagesNotice } from "@/components/design/FigmaPasteImagesNotice";
import { getCurrentBoardSelectionWorldBounds } from "@/components/design/multi-screen/overview-layout";
import type {
  MultiScreenCanvasProps,
  Point,
  VisibleCanvasRect,
} from "@/components/design/multi-screen/types";
import type { ElementInfo } from "@/components/design/types";
import {
  getDesignClipboardLayerEntries,
  readDesignClipboardPayloadFromSystem,
  readSystemClipboard,
} from "@/lib/design-clipboard";
import {
  type DesignClipboardPayload,
  type DesignClipboardScreenEntry,
  isAttemptedFigmaPaste,
} from "@/lib/design-import";
import { uploadDesignVideoFile } from "@/lib/design-media-upload";
import {
  dismissFigmaPasteImageNotice,
  figmaPasteImageNoticeDismissed,
} from "@/lib/figma-paste-image-notice";

import {
  bridgeSourceIdForCodeLayerNode,
  elementInfoFromCodeLayerNode,
} from "../code-layer-state";
import type { CanvasLayerClipboardEntry } from "../command-types";
import { runCopySelection } from "../commands/copy-selection";
import { runDeleteSelection } from "../commands/delete-selection";
import { runDuplicateSelection } from "../commands/duplicate-selection";
import { runEditorPaste } from "../commands/editor-paste";
import { runGetSelectedLayerSnapshots } from "../commands/get-selected-layer-snapshots";
import { runGroupSelection } from "../commands/group-selection";
import {
  runImportFigmaClipboardIntoDesign,
  type FigmaPasteLayerInsert,
} from "../commands/import-figma-clipboard-into-design";
import { runInsertFigmaPasteLayers } from "../commands/insert-figma-paste-layers";
import { runPasteCopiedScreens } from "../commands/paste-copied-screens";
import { runPasteOverSelection } from "../commands/paste-over-selection";
import { runPasteSelection } from "../commands/paste-selection";
import { runPastedSvgLayer } from "../commands/paste-svg-layer";
import { runPasteToReplace } from "../commands/paste-to-replace";
import {
  runPastedImageFiles,
  type PastedImageFilesClientAnchor,
  type PastedImageFilesTarget,
} from "../commands/pasted-image-files";
import { runSendRuntimeLayerSemanticHandoff } from "../commands/send-runtime-layer-semantic-handoff";
import {
  runContextMenuPaste,
  runSystemPasteToReplace,
} from "../commands/system-clipboard-paste";
import { runUngroupSelection } from "../commands/ungroup-selection";
import { withMeasuredGeometry } from "../editor-helpers";
import { resolveFigmaPasteScene } from "../figma-paste-scene";
import {
  autoHeightScreenIds,
  getAllScreenFrameEntries,
  pinnedHeightScreenIds,
  withMeasuredFrameHeights,
  getBoardSelectionFitBounds,
} from "../overview-camera";
import { resolvePastePlacementForSelection } from "../paste-placement";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorContentAndComponents } from "./use-editor-content-and-components";
import type { EditorCore } from "./use-editor-core";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import type { EditorLiveEditsAndPresence } from "./use-editor-live-edits-and-presence";
import type { EditorScreenChangeHandlers } from "./use-editor-screen-change-handlers";
import type { EditorSelectionAndStyles } from "./use-editor-selection-and-styles";
import type { EditorToolsAndVectors } from "./use-editor-tools-and-vectors";

export function useEditorClipboard({
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
  editorScreenChangeHandlers,
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
  editorScreenChangeHandlers: EditorScreenChangeHandlers;
}) {
  const {
    t,
    fileUploadStatus,
    id,
    queryClient,
    hostOwnsChrome,
    setMode,
    setActiveTool,
    measuredScreenHeightByIdRef,
    setViewMode,
    viewModeRef,
    selectedElement,
    setSelectedElement,
    setRuntimeStructureInsertRequest,
    setActiveFileId,
  } = editorCore;
  const {
    setActiveLeftPanel,
    selectedLayerIdsState,
    setSelectedLayerIdsState,
    renderedElementInfoByLayerKeyRef,
    codeLayerOwnerByNodeIdRef,
    overviewSelectedScreenIds,
    setOverviewSelectedScreenIds,
    setCreatedOverviewLayerSelection,
    pendingOverviewScreenSelectionRef,
    pendingOverviewLayerSelectionRef,
    clearPendingOverviewLayerSelectionTimer,
    latestClipboardMutationContentRef,
    clipboardPasteUndoStackRef,
    clipboardPasteRedoStackRef,
    activeBreakpointWidthState,
    activeBreakpointWidthStateRef,
    undoManagerRef,
    contentUndoStackRef,
    explicitOverviewScreenSelectionRef,
    historyOrderRef,
    clearRedoStacks,
    captureCurrentSelection,
    syncUndoRedoState,
  } = editorHistory;
  const {
    canEditDesign,
    pendingLocalFileContentsRef,
    createFileMutation,
    publishAuthoritativeClipboardMutation,
  } = editorGenerationAndAccess;
  const {
    navigate,
    files,
    codeLayerSourceForScreen,
    liveScreenSnapshotsById,
    runtimeLayerSnapshotsById,
    designSourceType,
    canvasFrameGeometryById,
    boardFileId,
    overviewScreens,
    updateLiveScreenSnapshotContent,
  } = editorFilesAndSaving;
  const {
    setCameraCommand,
    cameraCommandNonceRef,
    responsiveEditScopeRef,
    exportCanvasFrameGeometryById,
    queueFrameGeometrySave,
    activeFile,
    activeBreakpointUpperBoundPx,
    setZoom,
    activeCanvasSourceType,
  } = editorActiveScreenAndGeometry;
  const {
    localhostConnectionRootPathByIdRef,
    boardContentBounds,
    handleDuplicateScreen,
    livePreviewContentRef,
    getScreenContent,
  } = editorCanvasAndScreens;
  const {
    previousMotionFileIdRef,
    zoom,
    canvasContainerRef,
    selectedElementLayerId,
    selectedCanvasSelector,
    canEditLiveScreen,
    replacePreviewContent,
    syncLiveScreenSnapshotPreview,
    deleteRuntimeElement,
    remapMotionTracksForClone,
  } = editorLiveEditsAndPresence;
  const {
    contentHistorySelectionAfterRef,
    pruneMotionTracksByNodeId,
    applyLocalContentUpdate,
    applyFileContentUpdate,
  } = editorContentAndComponents;
  const { runtimeStructureInsertRevisionRef } = editorToolsAndVectors;
  const {
    selectedLayerTargetsRef,
    lastDuplicateTransformRef,
    canEditActiveVisualScreen,
    applyLinkedComponentEdit,
    getFreshActiveContent,
  } = editorSelectionAndStyles;
  const { recordPendingLiveStructureEdit } = editorScreenChangeHandlers;

  const canUploadDesignMedia =
    fileUploadStatus.isSuccess && fileUploadStatus.data.configured === true;
  const requestFileStorageSetup = useCallback(() => {
    window.dispatchEvent(new Event(DESIGN_FILE_STORAGE_REQUIRED_EVENT));
  }, []);
  const boardSelectionWorldBoundsRef = useRef<{
    screenId: string;
    selector: string;
    memberSelectors?: readonly string[];
    memberSourceIds?: readonly string[];
    worldBounds: FrameBounds;
  } | null>(null);
  const [hasCanvasClipboard, setHasCanvasClipboard] = useState(false);
  const menuClipboardFilesRef = useRef<File[]>([]);
  const copiedLayerEntriesRef = useRef<CanvasLayerClipboardEntry[]>([]);
  const copiedLayerHtmlRef = useRef<string | null>(null);
  const copiedScreenEntriesRef = useRef<DesignClipboardPayload["screens"]>([]);
  const lastWrittenClipboardMarkerRef = useRef<string | null>(null);
  const lastWrittenClipboardPlainTextRef = useRef<string | null>(null);
  const pasteCascadeRef = useRef(0);
  const figmaPasteImportingRef = useRef(false);
  const [figmaHydrationOpen, setFigmaHydrationOpen] = useState(false);
  const [figmaHydrationFileIds, setFigmaHydrationFileIds] = useState<string[]>(
    [],
  );
  const visibleCanvasRectRef = useRef<(() => VisibleCanvasRect | null) | null>(
    null,
  );
  const getFreshActivePreviewContent = useCallback(
    () =>
      livePreviewContentRef.current?.fileId === activeFile?.id
        ? livePreviewContentRef.current.content
        : null,
    [activeFile?.id],
  );

  const getSelectedLayerSnapshots = useCallback(
    (
      selectedElementOverride?: ElementInfo | null,
      selectedElementsByLayerId?: ReadonlyMap<string, ElementInfo>,
    ) => {
      const renderedInfos = new Map(
        selectedLayerTargetsRef.current.map((target) => [
          target.layerId,
          renderedElementInfoByLayerKeyRef.current.get(
            `${target.fileId}:${target.layerId}`,
          ) ?? target.elementInfo,
        ]),
      );
      if (selectedElementLayerId && selectedElement) {
        renderedInfos.set(selectedElementLayerId, selectedElement);
      }
      return runGetSelectedLayerSnapshots({
        activeFile,
        designSourceType,
        files,
        getFreshActiveContent,
        getScreenContent,
        layerOwnerFileId: (layerId) =>
          codeLayerOwnerByNodeIdRef.current.get(layerId)?.fileId,
        liveScreenSnapshotsById,
        overviewScreens,
        runtimeLayerSnapshotsById,
        selectedElement:
          selectedElementOverride === undefined
            ? selectedElement
            : selectedElementOverride,
        selectedElementsByLayerId: selectedElementsByLayerId ?? renderedInfos,
        selectedElementLayerId,
        selectedLayerIdsState,
      });
    },
    [
      activeFile,
      designSourceType,
      files,
      getFreshActiveContent,
      getScreenContent,
      liveScreenSnapshotsById,
      overviewScreens,
      runtimeLayerSnapshotsById,
      selectedElement,
      selectedElementLayerId,
      selectedLayerIdsState,
    ],
  );

  const getCanvasClipboardEntries = useCallback(() => {
    return getDesignClipboardLayerEntries({
      copiedEntries: copiedLayerEntriesRef.current,
      copiedScreens: copiedScreenEntriesRef.current,
      fallbackHtml: copiedLayerHtmlRef.current,
      sourceFileId: activeFile?.id ?? "",
    });
  }, [activeFile?.id]);

  const getCanvasScreenClipboardEntries = useCallback(() => {
    return copiedScreenEntriesRef.current ?? [];
  }, []);

  const adoptDesignClipboardPayload = useCallback(
    (
      payload: DesignClipboardPayload,
      markerText: string,
      plainText?: string,
    ) => {
      copiedLayerEntriesRef.current = payload.entries;
      copiedLayerHtmlRef.current = markerText;
      copiedScreenEntriesRef.current = payload.screens ?? [];
      lastWrittenClipboardMarkerRef.current = markerText;
      if (plainText !== undefined) {
        lastWrittenClipboardPlainTextRef.current = plainText;
      }
      setHasCanvasClipboard(
        payload.entries.length > 0 || (payload.screens?.length ?? 0) > 0,
      );
    },
    [],
  );

  const refreshClipboardFromSystemClipboard = useCallback(async () => {
    const result = await readDesignClipboardPayloadFromSystem();
    if (
      result.status !== "found" ||
      result.value.markerText === lastWrittenClipboardMarkerRef.current
    ) {
      return;
    }
    adoptDesignClipboardPayload(
      result.value.payload,
      result.value.markerText,
      result.value.plainText,
    );
  }, [adoptDesignClipboardPayload]);

  const selectInsertedLayers = useCallback(
    (screenId: string, content: string, rootNodeIds: string[]) => {
      const projection = buildCodeLayerProjection(content, {
        source: codeLayerSourceForScreen(screenId),
      });
      const insertedNodes = rootNodeIds
        .map((rootNodeId) =>
          projection.nodes.find(
            (node) =>
              node.id === rootNodeId ||
              node.dataAttributes["data-agent-native-node-id"] === rootNodeId,
          ),
        )
        .filter((node): node is CodeLayerNode => Boolean(node));
      if (insertedNodes.length === 0) return;
      explicitOverviewScreenSelectionRef.current = [];
      const lastNode = insertedNodes[insertedNodes.length - 1];
      if (lastNode) {
        pendingOverviewScreenSelectionRef.current =
          screenId === boardFileId ? null : screenId;
        pendingOverviewLayerSelectionRef.current = lastNode.id;
        clearPendingOverviewLayerSelectionTimer();
        setCreatedOverviewLayerSelection({
          screenId,
          layerId: lastNode.id,
        });
      }
      setActiveFileId(screenId);
      setSelectedLayerIdsState(insertedNodes.map((node) => node.id));
      setSelectedElement(
        lastNode ? elementInfoFromCodeLayerNode(lastNode) : null,
      );
      setActiveTool("move");
      setMode("edit");
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds(
          screenId === boardFileId ? [] : [screenId],
        );
      }
    },
    [
      boardFileId,
      clearPendingOverviewLayerSelectionTimer,
      codeLayerSourceForScreen,
    ],
  );

  const handleCopySelection = useCallback(
    async () =>
      runCopySelection({
        canvasFrameGeometryById,
        copiedLayerEntriesRef,
        copiedLayerHtmlRef,
        copiedScreenEntriesRef,
        designSourceType,
        files,
        getScreenContent,
        getSelectedLayerSnapshots,
        lastWrittenClipboardMarkerRef,
        lastWrittenClipboardPlainTextRef,
        liveScreenSnapshotsById,
        overviewScreens,
        overviewSelectedScreenIds,
        pasteCascadeRef,
        runtimeLayerSnapshotsById,
        setHasCanvasClipboard,
        t,
        viewModeRef,
      }),
    [
      canvasFrameGeometryById,
      designSourceType,
      files,
      getScreenContent,
      getSelectedLayerSnapshots,
      liveScreenSnapshotsById,
      overviewSelectedScreenIds,
      overviewScreens,
      runtimeLayerSnapshotsById,
      t,
    ],
  );

  const pasteCopiedScreens = useCallback(
    (
      screens: DesignClipboardScreenEntry[],
      position?: { x: number; y: number },
    ) =>
      runPasteCopiedScreens(
        {
          canEditDesign,
          canvasFrameGeometryById,
          createFileMutation,
          files,
          id,
          pasteCascadeRef,
          queryClient,
          queueFrameGeometrySave,
          setActiveFileId,
          setActiveTool,
          setOverviewSelectedScreenIds,
          setSelectedElement,
          setSelectedLayerIdsState,
          setViewMode,
          t,
          viewModeRef,
        },
        screens,
        position,
      ),
    [
      canEditDesign,
      canvasFrameGeometryById,
      createFileMutation,
      files,
      id,
      queryClient,
      queueFrameGeometrySave,
      t,
    ],
  );

  const handlePasteSelection = useCallback(
    async (position?: { x: number; y: number }) =>
      runPasteSelection(
        {
          activeFile,
          applyLinkedComponentEdit,
          selectionBefore: captureCurrentSelection(),
          designId: id,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          boardFileId,
          canEditDesign,
          canvasContainerRef,
          clearRedoStacks,
          clipboardPasteRedoStackRef,
          clipboardPasteUndoStackRef,
          files,
          getCanvasClipboardEntries,
          getCanvasScreenClipboardEntries,
          getFreshActiveContent,
          getScreenContent,
          historyOrderRef,
          latestClipboardMutationContentRef,
          pasteCascadeRef,
          pasteCopiedScreens,
          pendingLocalFileContentsRef,
          publishAuthoritativeClipboardMutation,
          refreshClipboardFromSystemClipboard,
          remapMotionTracksForClone,
          runtimeStructureInsertRevisionRef,
          selectInsertedLayers,
          selectedCanvasSelector,
          selectedElement,
          setRuntimeStructureInsertRequest,
          syncUndoRedoState,
          t,
          undoManagerRef,
          viewModeRef,
          zoom,
        },
        position,
      ),
    [
      applyLinkedComponentEdit,
      activeFile,
      id,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      canEditLiveScreen,
      getCanvasClipboardEntries,
      getCanvasScreenClipboardEntries,
      getFreshActiveContent,
      getScreenContent,
      historyOrderRef,
      files,
      pasteCopiedScreens,
      publishAuthoritativeClipboardMutation,
      refreshClipboardFromSystemClipboard,
      remapMotionTracksForClone,
      selectInsertedLayers,
      selectedCanvasSelector,
      selectedElement,
      t,
      clearRedoStacks,
      syncUndoRedoState,
      zoom,
    ],
  );

  const resolveFigmaPasteSceneForEditor = useCallback(() => {
    const selectedNodeId =
      selectedElement?.runtimeSourceId ?? selectedElement?.sourceId ?? null;
    return resolveFigmaPasteScene({
      viewMode: viewModeRef.current,
      activeFileId: activeFile?.id,
      boardFileId,
      overviewSelectedScreenIds,
      selectedNodeId,
      selectedIsContainer:
        Boolean(selectedNodeId && activeFile) &&
        resolvePastePlacementForSelection({
          content: getScreenContent(activeFile!.id),
          selectedElement,
        })?.placement === "inside",
      canvasRoot: canvasContainerRef.current,
      screens: getAllScreenFrameEntries({
        overviewScreens,
        canvasFrameGeometryById,
      })
        .filter((entry) => entry.id !== boardFileId)
        .map((entry) => ({ fileId: entry.id, ...entry.geometry })),
      visibleCanvasRect: visibleCanvasRectRef.current?.() ?? null,
    });
  }, [
    activeFile,
    boardFileId,
    canvasFrameGeometryById,
    getScreenContent,
    overviewScreens,
    overviewSelectedScreenIds,
    selectedElement,
  ]);

  const insertFigmaPasteLayers = useCallback(
    (
      fileId: string,
      selector: string | null,
      layers: FigmaPasteLayerInsert[],
    ) =>
      runInsertFigmaPasteLayers(
        {
          activeFile,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          canvasContainerRef,
          getFreshActiveContent,
          getScreenContent,
          pendingLocalFileContentsRef,
          selectInsertedLayers,
          viewModeRef,
        },
        fileId,
        selector,
        layers,
      ),
    [
      activeFile,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      getFreshActiveContent,
      getScreenContent,
      selectInsertedLayers,
    ],
  );

  const getScreenContentRef = useRef(getScreenContent);
  getScreenContentRef.current = getScreenContent;
  const uploadImageFileForHtmlRef = useRef<(file: File) => Promise<string>>(
    async () => "",
  );

  const showPastedImagesNotice = useCallback(
    ({ count, fileIds }: { count: number; fileIds: string[] }) => {
      if (figmaPasteImageNoticeDismissed()) return;
      toast.custom(
        (toastId) => (
          <FigmaPasteImagesNotice
            count={count}
            designId={id ?? ""}
            fileIds={fileIds}
            getScreenContent={(fileId) => getScreenContentRef.current(fileId)}
            uploadImage={(file) => uploadImageFileForHtmlRef.current(file)}
            onConnect={() => {
              setFigmaHydrationFileIds(fileIds);
              setFigmaHydrationOpen(true);
            }}
            onDismissForever={dismissFigmaPasteImageNotice}
            onHydrated={() => {
              void queryClient.invalidateQueries({ queryKey: ["action"] });
            }}
            onClose={() => toast.dismiss(toastId)}
          />
        ),
        { duration: Infinity },
      );
    },
    [id, queryClient],
  );

  const importFigmaClipboardIntoDesign = useCallback(
    async (content: string) =>
      runImportFigmaClipboardIntoDesign(
        {
          boardFileId,
          canEditDesign,
          figmaPasteImportingRef,
          id,
          insertPasteLayers: insertFigmaPasteLayers,
          navigate,
          queryClient,
          resolvePasteScene: resolveFigmaPasteSceneForEditor,
          showPastedImagesNotice,
          t,
        },
        content,
      ),
    [
      boardFileId,
      canEditDesign,
      id,
      insertFigmaPasteLayers,
      navigate,
      queryClient,
      resolveFigmaPasteSceneForEditor,
      t,
    ],
  );

  const handlePastedSvg = useCallback(
    (source: string, sourceScreenId?: string) => {
      return runPastedSvgLayer(
        {
          activeFileId: activeFile?.id,
          applyLinkedComponentEdit,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          boardFileId,
          canEditDesign,
          canvasContainerRef,
          canvasFrameGeometryById,
          designId: id,
          files,
          getFreshActiveContent,
          getFreshActivePreviewContent,
          getScreenContent,
          overviewScreens,
          overviewSelectedScreenIds,
          replacePreviewContent,
          selectedElement,
          selectedLayerTargets: selectedLayerTargetsRef.current,
          selectionBefore: captureCurrentSelection(),
          selectInsertedLayers,
          t,
          viewModeRef,
          zoom,
        },
        source,
        sourceScreenId,
      );
    },
    [
      activeFile?.id,
      applyLinkedComponentEdit,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      canvasContainerRef,
      canvasFrameGeometryById,
      captureCurrentSelection,
      files,
      getFreshActiveContent,
      getFreshActivePreviewContent,
      getScreenContent,
      id,
      overviewScreens,
      overviewSelectedScreenIds,
      replacePreviewContent,
      selectedElement,
      selectedLayerTargetsRef,
      selectInsertedLayers,
      t,
      viewModeRef,
      zoom,
    ],
  );

  const handleCanvasFigmaClipboardPaste = useCallback(
    ({
      content,
      sourceScreenId,
      svg,
      svgFileError,
      html,
      text,
    }: IframeFigmaClipboardPastePayload) => {
      if (svgFileError) {
        if (canEditDesign) toast.error(t("common.genericError"));
        return;
      }
      if (content) {
        void importFigmaClipboardIntoDesign(content);
        return;
      }
      if (svg) {
        handlePastedSvg(svg, sourceScreenId);
        return;
      }
      const relayed = {
        getData: (type: string) =>
          type === "text/html"
            ? (html ?? "")
            : type === "text/plain"
              ? (text ?? "")
              : "",
      };
      if (!isAttemptedFigmaPaste(relayed)) return;
      toast.error(t("designEditor.import.errors.figmaPasteFailed"), {
        description: t("designEditor.import.figmaPasteUnreadable"),
      });
    },
    [canEditDesign, handlePastedSvg, importFigmaClipboardIntoDesign, t],
  );

  const readFileAsDataUrl = useCallback((file: File) => {
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(typeof reader.result === "string" ? reader.result : "");
      };
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  }, []);

  const uploadImageFileForHtml = useCallback(
    async (file: File) => {
      if (!canUploadDesignMedia) {
        requestFileStorageSetup();
        return "";
      }
      const dataUrl = await readFileAsDataUrl(file);
      if (!dataUrl) {
        toast.error(t("designEditor.import.errors.uploadFailed"));
        return "";
      }
      const result = (await callAction("upload-image", {
        data: dataUrl,
        filename: file.name,
      })) as { url?: string; error?: string };
      if (result.url) return result.url;
      toast.error(t("common.genericError"), {
        description:
          result.error ||
          "File storage is not configured. Connect an upload provider before inserting local images.",
      });
      return "";
    },
    [canUploadDesignMedia, readFileAsDataUrl, requestFileStorageSetup, t],
  );
  uploadImageFileForHtmlRef.current = uploadImageFileForHtml;

  const uploadMediaFileForHtml = useCallback(
    (file: File) =>
      file.type.toLowerCase().startsWith("video/")
        ? uploadDesignVideoFile(file)
        : uploadImageFileForHtml(file),
    [uploadImageFileForHtml],
  );

  const handlePastedImageFiles = useCallback(
    (
      files: File[],
      target?: PastedImageFilesTarget | PastedImageFilesClientAnchor,
    ) => {
      if (files.length === 0) return false;
      if (!canUploadDesignMedia) {
        requestFileStorageSetup();
        return false;
      }
      return runPastedImageFiles(
        {
          activeFile,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          boardFileId,
          canEditDesign,
          canvasContainerRef,
          getVisibleCanvasRect: () => visibleCanvasRectRef.current?.() ?? null,
          canvasFrameGeometryById,
          getFreshActiveContent,
          getFreshActivePreviewContent,
          getScreenContent,
          overviewScreens,
          overviewSelectedScreenIds,
          pasteCascadeRef,
          replacePreviewContent,
          selectInsertedLayers,
          t,
          uploadMediaFileForHtml,
          viewModeRef,
          zoom,
        },
        files,
        target,
      );
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      canUploadDesignMedia,
      canvasFrameGeometryById,
      getFreshActiveContent,
      getFreshActivePreviewContent,
      getScreenContent,
      overviewScreens,
      overviewSelectedScreenIds,
      replacePreviewContent,
      selectInsertedLayers,
      t,
      requestFileStorageSetup,
      uploadMediaFileForHtml,
      zoom,
    ],
  );

  const handleCanvasImagePaste = useCallback(
    ({ files, screenId }: IframeImagePastePayload) => {
      if (files.length === 0 || !canEditDesign) return;
      const fileObjects = files.map(({ dataUrl, type, name }) => {
        const comma = dataUrl.indexOf(",");
        const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        return new File(
          [new Blob([bytes], { type })],
          name || "pasted-image.png",
          { type },
        );
      });
      const frame = screenId ? canvasFrameGeometryById[screenId] : undefined;
      const screen = screenId
        ? overviewScreens.find((candidate) => candidate.id === screenId)
        : undefined;
      handlePastedImageFiles(
        fileObjects,
        screenId
          ? {
              fileId: screenId,
              point: {
                x: (frame?.width ?? screen?.width ?? 0) / 2,
                y: (frame?.height ?? screen?.height ?? 0) / 2,
              },
            }
          : undefined,
      );
    },
    [
      canEditDesign,
      canvasFrameGeometryById,
      handlePastedImageFiles,
      overviewScreens,
    ],
  );

  const insertDroppedImageFiles = useCallback(
    (
      files: File[],
      targetFileId: string,
      localPoint: { x: number; y: number },
    ) => {
      if (files.length === 0) return;
      if (!canUploadDesignMedia) {
        requestFileStorageSetup();
        return;
      }
      return runPastedImageFiles(
        {
          activeFile,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          boardFileId,
          canEditDesign,
          canvasContainerRef,
          getVisibleCanvasRect: () => visibleCanvasRectRef.current?.() ?? null,
          canvasFrameGeometryById,
          getFreshActiveContent,
          getFreshActivePreviewContent,
          getScreenContent,
          overviewScreens,
          overviewSelectedScreenIds,
          pasteCascadeRef,
          replacePreviewContent,
          selectInsertedLayers,
          t,
          uploadMediaFileForHtml,
          viewModeRef,
          zoom,
        },
        files,
        { fileId: targetFileId, point: localPoint },
      );
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      canUploadDesignMedia,
      canvasContainerRef,
      canvasFrameGeometryById,
      getFreshActiveContent,
      getFreshActivePreviewContent,
      getScreenContent,
      overviewScreens,
      overviewSelectedScreenIds,
      replacePreviewContent,
      selectInsertedLayers,
      t,
      requestFileStorageSetup,
      uploadMediaFileForHtml,
      viewModeRef,
      zoom,
    ],
  );

  const handleDesignMediaFiles = useCallback(
    async (files: File[]) => {
      const imageAndVideoFiles: File[] = [];
      for (const file of files) {
        const isSvg =
          file.name.toLowerCase().endsWith(".svg") ||
          file.type.toLowerCase() === "image/svg+xml";
        if (isSvg) {
          if (file.size > 1_000_000) {
            toast.error(t("common.genericError"));
            continue;
          }

          let source: string;
          try {
            source = await file.text();
          } catch {
            toast.error(t("common.genericError"));
            continue;
          }

          if (handlePastedSvg(source)) continue;
          toast.error(t("common.genericError"));
          continue;
        }
        imageAndVideoFiles.push(file);
      }
      handlePastedImageFiles(imageAndVideoFiles);
    },
    [handlePastedImageFiles, handlePastedSvg],
  );

  const handleOverviewDropFiles = useCallback(
    (files: File[], target: { canvasPoint: Point; frameId?: string }) => {
      if (!boardFileId) return;
      if (target.frameId) {
        const frame = getAllScreenFrameEntries({
          overviewScreens,
          canvasFrameGeometryById,
        }).find((entry) => entry.id === target.frameId);
        if (frame) {
          insertDroppedImageFiles(files, target.frameId, {
            x: target.canvasPoint.x - frame.geometry.x,
            y: target.canvasPoint.y - frame.geometry.y,
          });
          return;
        }
      }
      insertDroppedImageFiles(files, boardFileId, target.canvasPoint);
    },
    [
      boardFileId,
      canvasFrameGeometryById,
      insertDroppedImageFiles,
      overviewScreens,
    ],
  );

  const handleSingleScreenDropFiles = useCallback(
    (
      files: File[],
      target: { screenContentPoint: Point; screenId?: string },
    ) => {
      const targetFileId = target.screenId ?? activeFile?.id;
      if (!targetFileId) return;
      insertDroppedImageFiles(files, targetFileId, target.screenContentPoint);
    },
    [activeFile?.id, insertDroppedImageFiles],
  );

  const handleEditorPaste = useCallback(
    (event: ClipboardEvent) =>
      runEditorPaste(
        {
          adoptDesignClipboardPayload,
          canEditDesign,
          handlePasteSelection,
          handlePastedFiles: handleDesignMediaFiles,
          handlePastedSvg,
          hasCanvasClipboard,
          importFigmaClipboardIntoDesign,
          lastWrittenClipboardMarkerRef,
          lastWrittenClipboardPlainTextRef,
          t,
        },
        event,
      ),
    [
      adoptDesignClipboardPayload,
      canEditDesign,
      handlePasteSelection,
      handleDesignMediaFiles,
      handlePastedSvg,
      hasCanvasClipboard,
      importFigmaClipboardIntoDesign,
      t,
    ],
  );

  useEffect(() => {
    if (hostOwnsChrome) return;
    document.addEventListener("paste", handleEditorPaste, true);
    return () => {
      document.removeEventListener("paste", handleEditorPaste, true);
    };
  }, [handleEditorPaste, hostOwnsChrome]);

  const handlePasteOverSelection = useCallback(
    () =>
      runPasteOverSelection({
        activeFile,
        applyLocalContentUpdate,
        getCanvasClipboardEntries,
        getFreshActiveContent,
        handlePasteSelection,
        selectedElement,
        selectInsertedLayers,
        t,
      }),
    [
      activeFile,
      applyLocalContentUpdate,
      getCanvasClipboardEntries,
      getFreshActiveContent,
      handlePasteSelection,
      selectInsertedLayers,
      selectedElement,
      t,
    ],
  );

  const handleContextMenuPaste = useCallback(
    (point?: CanvasContextMenuPoint) =>
      runContextMenuPaste(
        {
          canEditDesign,
          clipboardFiles: menuClipboardFilesRef.current,
          handlePasteSelection,
          handlePastedImageFiles,
          insertDroppedImageFiles,
        },
        point,
      ),
    [
      canEditDesign,
      handlePasteSelection,
      handlePastedImageFiles,
      insertDroppedImageFiles,
    ],
  );

  const handlePasteToReplace = useCallback(
    async (menuClipboardFiles?: File[]) => {
      const replace = (externalLayerHtml?: string) =>
        runPasteToReplace(
          {
            activeFile,
            applyLocalContentUpdate,
            canEditDesign,
            getCanvasClipboardEntries,
            getFreshActiveContent,
            runtimeStructureInsertRevisionRef,
            selectInsertedLayers,
            selectedCanvasSelector,
            selectedElement,
            setRuntimeStructureInsertRequest,
            t,
          },
          externalLayerHtml,
        );
      let clipboardFiles: File[] | null;
      if (menuClipboardFiles !== undefined) {
        clipboardFiles = menuClipboardFiles;
      } else {
        const clipboardContents = await readSystemClipboard();
        clipboardFiles =
          clipboardContents === null ? null : clipboardContents.files;
      }
      await runSystemPasteToReplace({
        clipboardFiles,
        replaceWithLayerCopy: () => replace(),
        replaceWithHtml: replace,
        t,
        uploadImageFileForHtml,
      });
    },
    [
      activeFile,
      applyLocalContentUpdate,
      canEditDesign,
      uploadImageFileForHtml,
      getCanvasClipboardEntries,
      getFreshActiveContent,
      selectedCanvasSelector,
      selectInsertedLayers,
      selectedElement?.boundingRect,
      selectedElement?.runtimeSelector,
      selectedElement?.runtimeSourceId,
      selectedElement?.selector,
      selectedElement?.sourceId,
      t,
    ],
  );

  const handleDuplicateSelection = useCallback(
    () =>
      runDuplicateSelection({
        activeFile,
        applyLinkedComponentEdit,
        selectionBefore: captureCurrentSelection(),
        designId: id,
        applyFileContentUpdate,
        applyLocalContentUpdate,
        canEditDesign,
        canEditLiveScreen: canEditActiveVisualScreen,
        files,
        getFreshActiveContent,
        getScreenContent,
        getSelectedLayerSnapshots,
        handleDuplicateScreen,
        clearExplicitOverviewScreenSelection: () => {
          explicitOverviewScreenSelectionRef.current = [];
        },
        lastDuplicateTransformRef,
        overviewSelectedScreenIds,
        remapMotionTracksForClone,
        runtimeStructureInsertRevisionRef,
        selectedCanvasSelector,
        selectedElement,
        selectedLayerIdsState,
        setRuntimeStructureInsertRequest,
        setOverviewSelectedScreenIds,
        setSelectedElement,
        setSelectedLayerIdsState,
        t,
        undoManagerRef,
        viewModeRef,
      }),
    [
      applyLinkedComponentEdit,
      activeFile,
      id,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      canEditDesign,
      canEditActiveVisualScreen,
      files,
      getFreshActiveContent,
      getScreenContent,
      getSelectedLayerSnapshots,
      handleDuplicateScreen,
      overviewSelectedScreenIds,
      remapMotionTracksForClone,
      runtimeStructureInsertRevisionRef,
      selectedCanvasSelector,
      selectedElement,
      t,
    ],
  );

  const handleDeleteSelection = useCallback(
    () =>
      runDeleteSelection({
        applyLinkedComponentEdit,
        t,
        activeBreakpointUpperBoundPx,
        activeBreakpointWidthStateRef,
        activeCanvasSourceType,
        activeFile,
        boardFileId,
        boardSelectionWorldBounds: boardSelectionWorldBoundsRef.current,
        applyFileContentUpdate,
        applyLocalContentUpdate,
        canEditDesign,
        canEditLiveScreen: canEditActiveVisualScreen,
        codeLayerOwnerByNodeIdRef,
        deleteRuntimeElement,
        files,
        getFreshActiveContent,
        getScreenContent,
        getSelectedLayerSnapshots,
        liveScreenSnapshotsById,
        previousMotionFileIdRef,
        pruneMotionTracksByNodeId,
        recordPendingLiveStructureEdit,
        responsiveEditScopeRef,
        selectedElement,
        selectedLayerIdsState,
        setOverviewSelectedScreenIds,
        setSelectedElement,
        setSelectedLayerIdsState,
        syncLiveScreenSnapshotPreview,
        undoManagerRef,
        updateLiveScreenSnapshotContent,
        viewModeRef,
      }),
    [
      applyLinkedComponentEdit,
      activeBreakpointUpperBoundPx,
      activeCanvasSourceType,
      activeFile,
      boardFileId,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      canEditDesign,
      canEditActiveVisualScreen,
      deleteRuntimeElement,
      recordPendingLiveStructureEdit,
      files,
      getFreshActiveContent,
      getScreenContent,
      getSelectedLayerSnapshots,
      liveScreenSnapshotsById,
      pruneMotionTracksByNodeId,
      selectedElement,
      selectedLayerIdsState,
      syncLiveScreenSnapshotPreview,
      updateLiveScreenSnapshotContent,
    ],
  );

  const sendRuntimeLayerSemanticHandoff = useCallback(
    (
      operation: "group" | "ungroup" | "auto-layout",
      layerIds: readonly string[],
      options: {
        desiredChange?: string;
        description?: string;
        commandContext?: string;
      } = {},
    ): boolean =>
      runSendRuntimeLayerSemanticHandoff(
        {
          codeLayerOwnerByNodeIdRef,
          localhostConnectionRootPathByIdRef,
          overviewScreens,
          runtimeLayerSnapshotsById,
          setActiveLeftPanel,
          t,
        },
        operation,
        layerIds,
        options,
      ),
    [overviewScreens, runtimeLayerSnapshotsById, t],
  );

  const handleGroupSelection = useCallback(
    () =>
      runGroupSelection({
        activeBreakpointWidthState,
        activeFile,
        applyLinkedComponentEdit,
        applyLocalContentUpdate,
        boardFileId,
        canEditDesign,
        codeLayerOwnerByNodeIdRef,
        contentHistorySelectionAfterRef,
        contentUndoStackRef,
        files,
        getFreshActiveContent,
        overviewSelectedScreenIds,
        selectedLayerIdsState,
        sendRuntimeLayerSemanticHandoff,
        setSelectedElement,
        setSelectedLayerIdsState,
        t,
        undoManagerRef,
      }),
    [
      activeBreakpointWidthState,
      activeFile,
      applyLinkedComponentEdit,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      files,
      getFreshActiveContent,
      overviewSelectedScreenIds,
      selectedLayerIdsState,
      sendRuntimeLayerSemanticHandoff,
      t,
    ],
  );

  const handleUngroupSelection = useCallback(
    () =>
      runUngroupSelection({
        activeFile,
        applyLinkedComponentEdit,
        applyLocalContentUpdate,
        canEditDesign,
        codeLayerOwnerByNodeIdRef,
        files,
        getFreshActiveContent,
        selectedLayerIdsState,
        sendRuntimeLayerSemanticHandoff,
        setSelectedElement,
        setSelectedLayerIdsState,
        t,
      }),
    [
      activeFile,
      applyLinkedComponentEdit,
      applyLocalContentUpdate,
      canEditDesign,
      files,
      getFreshActiveContent,
      selectedLayerIdsState,
      sendRuntimeLayerSemanticHandoff,
      t,
    ],
  );

  const handleCutSelection = useCallback(async () => {
    const copied = await handleCopySelection();
    if (!copied) return;
    handleDeleteSelection();
  }, [handleCopySelection, handleDeleteSelection]);

  const handleZoomToSelectionFit = useCallback(() => {
    const allFrames = withMeasuredFrameHeights(
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
    const layerTargets = selectedLayerTargetsRef.current;
    const screenFileIds = new Set(overviewScreens.map((screen) => screen.id));
    const selectedIds = new Set(
      layerTargets.length > 0
        ? selectedLayerIdsState.filter((layerId) => screenFileIds.has(layerId))
        : overviewSelectedScreenIds,
    );
    const selectedLayerFrames: FrameEntry[] = [];
    for (const target of layerTargets) {
      if (target.fileId === boardFileId) continue;
      const ownerFrame = allFrames.find((frame) => frame.id === target.fileId);
      const localRect = withMeasuredGeometry(
        target.elementInfo,
        target.fileId,
      ).boundingRect;
      if (
        !ownerFrame ||
        !localRect ||
        localRect.width <= 0 ||
        localRect.height <= 0
      ) {
        return;
      }
      const bounds = getElementWorldBoundsForZoomFit(
        ownerFrame.geometry,
        localRect,
      );
      selectedLayerFrames.push({
        id: target.layerId,
        geometry: {
          x: bounds.left,
          y: bounds.top,
          width: bounds.width,
          height: bounds.height,
        },
      });
    }
    const boardTargets = layerTargets.filter(
      (target) => target.fileId === boardFileId,
    );
    const boardTarget = boardTargets[boardTargets.length - 1];

    if (boardTarget && boardFileId) {
      const currentSelectors = [
        boardTarget.elementInfo.runtimeSelector,
        boardTarget.elementInfo.selector,
      ].filter((selector): selector is string => Boolean(selector));
      const boardWorldBounds = getCurrentBoardSelectionWorldBounds({
        selection: boardSelectionWorldBoundsRef.current,
        boardFileId,
        ownerFileId: boardTarget.fileId,
        selectedLayerId: boardTarget.layerId,
        sourceLayerIdentity: boardTarget.elementInfo.sourceLayerIdentity,
        currentSelectors,
        currentSourceIds: boardTargets.map((target) =>
          bridgeSourceIdForCodeLayerNode(target.node),
        ),
      });
      if (!boardWorldBounds) return;
      const boardBounds = getBoardSelectionFitBounds({
        selectedFrameEntries: allFrames,
        selectedScreenIds: selectedIds,
        boardFileId,
        boardBounds: boardWorldBounds,
      });
      if (!boardBounds) return;
      const bounds = getFrameGroupBounds([
        {
          id: boardFileId,
          geometry: {
            x: boardBounds.left,
            y: boardBounds.top,
            width: boardBounds.width,
            height: boardBounds.height,
          },
        },
        ...selectedLayerFrames,
      ]);
      if (!bounds) return;
      cameraCommandNonceRef.current += 1;
      setCameraCommand({
        fitBounds: bounds,
        nonce: cameraCommandNonceRef.current,
      });
      return;
    }
    const hasSelection = selectedIds.size > 0 || layerTargets.length > 0;
    const selectedFrames = allFrames.filter((frame) =>
      selectedIds.has(frame.id),
    );
    const bounds = getFrameGroupBounds(
      hasSelection ? [...selectedFrames, ...selectedLayerFrames] : allFrames,
    );
    if (!bounds) {
      if (hasSelection) return;
      setZoom(150);
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
    overviewSelectedScreenIds,
    selectedLayerIdsState,
    setZoom,
  ]);
  const handleBoardSelectionWorldBoundsChange = useCallback<
    NonNullable<MultiScreenCanvasProps["onBoardSelectionWorldBoundsChange"]>
  >((selection) => {
    boardSelectionWorldBoundsRef.current = selection;
  }, []);

  return {
    hasCanvasClipboard,
    menuClipboardFilesRef,
    lastWrittenClipboardMarkerRef,
    figmaHydrationOpen,
    setFigmaHydrationOpen,
    figmaHydrationFileIds,
    visibleCanvasRectRef,
    getCanvasClipboardEntries,
    adoptDesignClipboardPayload,
    handleCopySelection,
    handlePasteSelection,
    showPastedImagesNotice,
    handleCanvasFigmaClipboardPaste,
    handleCanvasImagePaste,
    handleDesignMediaFiles,
    handleOverviewDropFiles,
    handleSingleScreenDropFiles,
    handlePasteOverSelection,
    handleContextMenuPaste,
    handlePasteToReplace,
    handleDuplicateSelection,
    handleDeleteSelection,
    sendRuntimeLayerSemanticHandoff,
    handleGroupSelection,
    handleUngroupSelection,
    handleCutSelection,
    handleZoomToSelectionFit,
    handleBoardSelectionWorldBoundsChange,
  };
}

export type EditorClipboard = ReturnType<typeof useEditorClipboard>;
