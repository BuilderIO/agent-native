import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useState, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";

import {
  rewriteSelectionFillStyles,
  selectionColorTargets,
} from "@/components/design/edit-panel/document-colors";
import {
  type SelectionColorScope,
  type ScreenGeometrySelection,
  type ScreenSourceSelection,
  type StyleChangeMeta,
} from "@/components/design/EditPanel";
import { getInitialFrameGeometry } from "@/components/design/multi-screen/frame-geometry";
import { getBreakpointIframeId } from "@/components/design/multi-screen/iframe-targeting";
import { readSubtreeColorStyles } from "@/components/design/multi-screen/read-portable-style-snapshot";
import {
  resolveScreenHeightMode,
  type ScreenHeightMode,
} from "@/components/design/multi-screen/screen-height";
import {
  clampScreenDimension,
  readScreenSizeConstraints,
} from "@/components/design/multi-screen/screen-sizing";
import type { ElementInfo } from "@/components/design/types";
import {
  externalPreviewUrlForContent,
  fullPreviewHtml,
} from "@/pages/design-editor/preview-html";

import {
  bridgeSourceIdForCodeLayerNode,
  collectCodeLayerAncestors,
  elementInfoForOwnedCodeLayerNode,
  elementInfoFromCodeLayerNode,
} from "../code-layer-state";
import { runInvalidateVisualEditSnapshotPublication } from "../commands/publish-visual-edit-snapshot";
import {
  restoreSelectionColorPreview,
  runSelectionColorChange,
  type SelectionColorPreviewHistoryEntry,
  type SelectionColorPickerSessionEntry,
  setSelectionColorPickerSession,
} from "../commands/selection-color-change";
import {
  applyDesignDataOperations,
  getDesignCanvasBackground,
  invertDesignDataOperations,
  sanitizeCanvasBackground,
  type DesignDataOperation,
} from "../data-operations";
import {
  getCanvasFrameGeometry,
  getDesignDataRecord,
  parseDesignDataJson,
} from "../design-data-geometry-utils";
import { MIN_FRAME_SIZE_PX } from "../editor-constants";
import { getFreshActiveFileContent } from "../editor-state";
import { type ContentHistoryChange } from "../history";
import {
  screenRootFrameRenderingOptions,
  setScreenRootDefaultHeightMode,
  setBodyInlineStyles,
  setScreenRootFrameRenderingStyles,
} from "../html-layer-positioning";
import { resolveOverviewScreenSourceType } from "../pending-edits";
import { openPreviewUrl } from "../preview-navigation";
import { DEFAULT_STATES_PANEL_BREAKPOINTS } from "../screen-command-utils";
import { getSelectedScreenGeometryForInspector } from "../selection-state";
import { prepareCanonicalSourceContent } from "../source-publication";
import { type DesignFile } from "../types";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorClipboard } from "./use-editor-clipboard";
import type { EditorContentAndComponents } from "./use-editor-content-and-components";
import type { EditorCore } from "./use-editor-core";
import type { EditorEditCommands } from "./use-editor-edit-commands";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import type { EditorLayerModels } from "./use-editor-layer-models";
import type { EditorLiveEditsAndPresence } from "./use-editor-live-edits-and-presence";
import type { EditorSelectionAndStyles } from "./use-editor-selection-and-styles";
import type { EditorToolsAndVectors } from "./use-editor-tools-and-vectors";

type UpdateScreenSourceActionResult = {
  fileId: string;
  sourceType: "static" | "url";
  url: string | null;
  path: string | null;
  connectionId: string | null;
  content: string;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export function useEditorScreenInspector({
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
  editorClipboard,
  editorEditCommands,
  editorLayerModels,
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
  editorClipboard: EditorClipboard;
  editorEditCommands: EditorEditCommands;
  editorLayerModels: EditorLayerModels;
}) {
  const {
    t,
    id,
    queryClient,
    setMode,
    setActiveTool,
    viewMode,
    setViewMode,
    viewModeRef,
    selectedElement,
    setSelectedElement,
    setLiveRoutePathsByScreenId,
    liveRoutePathsByScreenIdRef,
    setActiveFileId,
  } = editorCore;
  const {
    builderPreviewUrl,
    setExpandedLayerIds,
    setSelectedLayerIdsState,
    overviewSelectedScreenIds,
    setOverviewSelectedScreenIds,
    activeBreakpointWidthState,
    setActiveBreakpointWidthState,
    activeBreakpointWidthStateRef,
    explicitOverviewScreenSelectionRef,
    recordContentHistoryEntry,
  } = editorHistory;
  const {
    recordSelectionHistoryAroundChange,
    canEditDesign,
    visualEditSnapshotPublicationState,
    canEditPublicLiveScreenUrl,
    canEditDesignRef,
    updateScreenSourceMutation,
  } = editorGenerationAndAccess;
  const {
    locallyPinnedHeightIdsRef,
    codeLayerSourceForScreen,
    liveScreenSnapshotsById,
    runtimeLayerSnapshotsById,
    screenRootComputedStylesById,
    setScreenRootComputedStylesById,
    screenRootComputedStylesByIdRef,
    designDataJson,
    designSourceType,
    designDataJsonRef,
    canvasFrameGeometryById,
    overviewScreens,
    boardFileId,
  } = editorFilesAndSaving;
  const {
    responsiveEditScopeRef,
    persistActiveBreakpoint,
    screenContentNaturalHeightByIdRef,
    screenContentNaturalHeights,
    enqueueFrameGeometryDataSave,
    flushPendingFrameGeometrySave,
    handleGeometryCommit,
    activeFile,
    activeScreenSnapshotOnly,
  } = editorActiveScreenAndGeometry;
  const {
    setCollabContent,
    setCollabContentFileId,
    lastLocalContentRef,
    latestActiveContentRef,
    activeContent,
    getScreenContent,
    getProjectionContentForScreen,
  } = editorCanvasAndScreens;
  const { selectedStateId, handleDesignStateSelect, canEditLiveScreen } =
    editorLiveEditsAndPresence;
  const { applyFileContentUpdate } = editorContentAndComponents;
  const { canvasBackgroundRef } = editorToolsAndVectors;
  const { getCodeLayerProjectionForScreen } = editorSelectionAndStyles;
  const { handleZoomToSelectionFit } = editorClipboard;
  const { handleDeleteOverviewSelection } = editorEditCommands;
  const {
    codeLayerOwnerByNodeId,
    selectedLayerTargets,
    selectedInspectorElements,
  } = editorLayerModels;

  const commitOverviewScreenStylesRef = useRef<
    (screenIds: string[], patch: Record<string, string>) => void
  >(() => {});
  const selectedScreenGeometry = useMemo<ScreenGeometrySelection | null>(() => {
    return getSelectedScreenGeometryForInspector({
      selectedInspectorElementCount: selectedInspectorElements.length,
      selectedScreenIds:
        viewMode === "overview" ? overviewSelectedScreenIds : [],
      overviewScreens,
      canvasFrameGeometryById,
      naturalHeightsById: screenContentNaturalHeights,
      screenRootComputedStylesById,
    });
  }, [
    canvasFrameGeometryById,
    overviewSelectedScreenIds,
    overviewScreens,
    screenContentNaturalHeights,
    screenRootComputedStylesById,
    selectedInspectorElements.length,
    viewMode,
  ]);
  const selectedScreenSource = useMemo<ScreenSourceSelection | null>(() => {
    if (!selectedScreenGeometry) return null;
    const screen = overviewScreens.find(
      (candidate) => candidate.id === selectedScreenGeometry.id,
    );
    if (!screen) return null;
    const sourceType = resolveOverviewScreenSourceType(
      screen,
      designSourceType,
    );
    return sourceType === "localhost"
      ? {
          sourceType: "url",
          url: screen.url ?? screen.previewUrl ?? screen.content,
          connectionId: screen.connectionId,
        }
      : { sourceType: "static" };
  }, [designSourceType, overviewScreens, selectedScreenGeometry]);
  const handleRemoveSelectedScreen = useCallback(() => {
    const screenId = selectedScreenGeometry?.id;
    if (!screenId) return;
    handleDeleteOverviewSelection([screenId], true);
  }, [handleDeleteOverviewSelection, selectedScreenGeometry?.id]);

  const handleScreenSourceChange = useCallback(
    (
      screenId: string,
      next: {
        sourceType: "static" | "url";
        url?: string;
        connectionId?: string;
      },
      onSettled?: () => void,
    ) => {
      const publicLiveUrlEdit =
        !canEditDesign &&
        next.sourceType === "url" &&
        canEditPublicLiveScreenUrl &&
        canEditLiveScreen(screenId) &&
        overviewScreens.some(
          (screen) =>
            screen.id === screenId &&
            resolveOverviewScreenSourceType(screen, designSourceType) ===
              "localhost",
        );
      if (!id || (!canEditDesign && !publicLiveUrlEdit)) {
        onSettled?.();
        return;
      }
      const snapshotHtml =
        next.sourceType === "static"
          ? (runtimeLayerSnapshotsById[screenId]?.html ??
            liveScreenSnapshotsById[screenId]?.html)
          : undefined;
      updateScreenSourceMutation.mutate(
        {
          designId: id,
          fileId: screenId,
          sourceType: next.sourceType,
          ...(next.url ? { url: next.url } : {}),
          ...(next.connectionId ? { connectionId: next.connectionId } : {}),
          ...(snapshotHtml ? { snapshotHtml } : {}),
        } as never,
        {
          onSuccess: (rawResult) => {
            const result = rawResult as UpdateScreenSourceActionResult;
            if (next.sourceType === "url") {
              delete liveRoutePathsByScreenIdRef.current[screenId];
              setLiveRoutePathsByScreenId((current) => {
                if (!(screenId in current)) return current;
                const nextRoutes = { ...current };
                delete nextRoutes[screenId];
                return nextRoutes;
              });
            }
            if (next.sourceType === "static") {
              runInvalidateVisualEditSnapshotPublication(
                visualEditSnapshotPublicationState,
                screenId,
              );
            }
            queryClient.setQueryData(
              ["action", "get-design", { id }],
              (old: any) => {
                if (!old || typeof old !== "object") return old;
                const currentData = parseDesignDataJson(old.data);
                const nextData = {
                  ...currentData,
                  screenMetadata: {
                    ...getDesignDataRecord(currentData, "screenMetadata"),
                    [screenId]: result.metadata,
                  },
                  localhostScreens: {
                    ...getDesignDataRecord(currentData, "localhostScreens"),
                    [screenId]: result.metadata,
                  },
                };
                return {
                  ...old,
                  data: JSON.stringify(nextData),
                  files: Array.isArray(old.files)
                    ? old.files.map((file: DesignFile) =>
                        file.id === screenId
                          ? {
                              ...file,
                              content: result.content,
                              ...(result.updatedAt
                                ? { updatedAt: result.updatedAt }
                                : {}),
                            }
                          : file,
                      )
                    : old.files,
                };
              },
            );
            if (viewMode === "single" && activeFile?.id === screenId) {
              setCollabContent(result.content);
              setCollabContentFileId(screenId);
            }
            void queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
            toast.success(t("designEditor.toasts.screenSourceUpdated"));
          },
          onError: (error) => {
            toast.error(
              actionErrorMessage(error) ??
                (error instanceof Error && error.message
                  ? error.message
                  : t("designEditor.toasts.screenSourceUpdateFailed")),
            );
          },
          onSettled,
        },
      );
    },
    [
      canEditLiveScreen,
      canEditDesign,
      designSourceType,
      canEditPublicLiveScreenUrl,
      id,
      activeFile?.id,
      liveScreenSnapshotsById,
      overviewScreens,
      queryClient,
      runtimeLayerSnapshotsById,
      setCollabContent,
      setCollabContentFileId,
      t,
      updateScreenSourceMutation,
      viewMode,
    ],
  );
  const handleScreenUrlChange = useCallback(
    (screenId: string, url: string) =>
      handleScreenSourceChange(screenId, { sourceType: "url", url }),
    [handleScreenSourceChange],
  );
  const selectedScreenOwnsItsMarkup = useMemo(() => {
    const screenId = selectedScreenGeometry?.id;
    if (!screenId) return false;
    return externalPreviewUrlForContent(getScreenContent(screenId)) === null;
  }, [getScreenContent, selectedScreenGeometry]);
  const screenStylePreviewRef = useRef<
    Map<string, { before: string; after: string }>
  >(new Map());
  const commitSelectedScreenStyles = useCallback(
    (
      screenId: string,
      patch: Record<string, string>,
      meta?: StyleChangeMeta,
    ) => {
      if (!screenId || !canEditDesignRef.current) return;
      const previewOnly = meta?.phase === "preview";
      const content = getScreenContent(screenId);
      if (!content || externalPreviewUrlForContent(content) !== null) return;
      const preview = screenStylePreviewRef.current.get(screenId);
      if (preview && preview.after !== content) {
        screenStylePreviewRef.current.delete(screenId);
      }
      const rootStyles = {
        ...screenRootComputedStylesByIdRef.current[screenId],
        ...patch,
      };
      if (patch.borderRadius !== undefined) {
        rootStyles.borderTopLeftRadius = patch.borderRadius;
        rootStyles.borderTopRightRadius = patch.borderRadius;
        rootStyles.borderBottomRightRadius = patch.borderRadius;
        rootStyles.borderBottomLeftRadius = patch.borderRadius;
      }
      const screenMetadata = getDesignDataRecord(
        getDesignDataRecord(designDataJsonRef.current, "screenMetadata"),
        screenId,
      );
      const nextBodyStyles = setBodyInlineStyles(content, patch);
      if (nextBodyStyles === null) return;
      setScreenRootComputedStylesById((current) => ({
        ...current,
        [screenId]: rootStyles,
      }));
      const next = setScreenRootFrameRenderingStyles(
        nextBodyStyles,
        screenRootFrameRenderingOptions(
          rootStyles,
          screenMetadata.heightPinned === true,
        ),
      );
      const historyBeforeContent =
        screenStylePreviewRef.current.get(screenId)?.before;
      if (
        next === content &&
        (previewOnly || historyBeforeContent === undefined)
      )
        return;
      if (previewOnly) {
        screenStylePreviewRef.current.set(screenId, {
          before: historyBeforeContent ?? content,
          after: next,
        });
      } else {
        screenStylePreviewRef.current.delete(screenId);
      }
      applyFileContentUpdate(screenId, next, {
        immediateSave: !previewOnly,
        persist: !previewOnly,
        recordHistory: !previewOnly,
        historyBeforeContent: previewOnly ? undefined : historyBeforeContent,
      });
    },
    [applyFileContentUpdate, getScreenContent],
  );
  const commitSelectedScreenStylesRef = useRef(commitSelectedScreenStyles);
  commitSelectedScreenStylesRef.current = commitSelectedScreenStyles;
  const commitOverviewScreenStyles = useCallback(
    (screenIds: string[], patch: Record<string, string>) => {
      if (
        !canEditDesignRef.current ||
        viewModeRef.current !== "overview" ||
        screenIds.length < 2
      ) {
        return;
      }
      const changes: ContentHistoryChange[] = [];
      const computedStylesByScreen: Record<string, Record<string, string>> = {};
      for (const screenId of new Set(screenIds)) {
        const content = getProjectionContentForScreen(screenId);
        if (!content || externalPreviewUrlForContent(content) !== null)
          continue;
        const nextBodyStyles = setBodyInlineStyles(content, patch);
        if (nextBodyStyles === null) continue;
        const rootStyles = {
          ...screenRootComputedStylesById[screenId],
          ...patch,
        };
        if (patch.borderRadius !== undefined) {
          rootStyles.borderTopLeftRadius = patch.borderRadius;
          rootStyles.borderTopRightRadius = patch.borderRadius;
          rootStyles.borderBottomRightRadius = patch.borderRadius;
          rootStyles.borderBottomLeftRadius = patch.borderRadius;
        }
        const screenMetadata = getDesignDataRecord(
          getDesignDataRecord(designDataJson, "screenMetadata"),
          screenId,
        );
        const next = setScreenRootFrameRenderingStyles(
          nextBodyStyles,
          screenRootFrameRenderingOptions(
            rootStyles,
            screenMetadata.heightPinned === true,
          ),
        );
        if (next === content) continue;
        computedStylesByScreen[screenId] = rootStyles;
        applyFileContentUpdate(screenId, next, {
          persist: true,
          recordHistory: false,
        });
        changes.push({ fileId: screenId, before: content, after: next });
      }
      if (Object.keys(computedStylesByScreen).length > 0) {
        setScreenRootComputedStylesById((current) => ({
          ...current,
          ...computedStylesByScreen,
        }));
      }
      if (changes.length > 0) recordContentHistoryEntry({ changes });
    },
    [
      applyFileContentUpdate,
      designDataJson,
      getProjectionContentForScreen,
      recordContentHistoryEntry,
      screenRootComputedStylesById,
    ],
  );
  commitOverviewScreenStylesRef.current = commitOverviewScreenStyles;
  const handleSelectedScreenStyleChange = useCallback(
    (property: string, value: string, meta?: StyleChangeMeta) => {
      const screenId = selectedScreenGeometry?.id;
      if (!screenId) return;
      commitSelectedScreenStylesRef.current(
        screenId,
        { [property]: value },
        meta,
      );
    },
    [selectedScreenGeometry?.id],
  );
  const handleSelectedScreenStylesChange = useCallback(
    (styles: Record<string, string>, meta?: StyleChangeMeta) => {
      const screenId = selectedScreenGeometry?.id;
      if (!screenId) return;
      commitSelectedScreenStylesRef.current(screenId, styles, meta);
    },
    [selectedScreenGeometry?.id],
  );
  const persistedCanvasBackground = useMemo(
    () => getDesignCanvasBackground(designDataJson),
    [designDataJson],
  );
  const [canvasBackgroundDraft, setCanvasBackgroundDraft] = useState<
    string | null
  >(null);
  const canvasBackground = canvasBackgroundDraft ?? persistedCanvasBackground;
  const [themedCanvasBackground, setThemedCanvasBackground] = useState<
    string | null
  >(null);
  canvasBackgroundRef.current = canvasBackground ?? themedCanvasBackground;
  const handleCanvasBackgroundChange = useCallback(
    (value: string, meta?: { phase?: "preview" | "commit" | "cancel" }) => {
      if (!id || !canEditDesignRef.current) return;
      if (meta?.phase === "cancel") {
        setCanvasBackgroundDraft(null);
        return;
      }
      if (meta?.phase === "preview") {
        setCanvasBackgroundDraft(sanitizeCanvasBackground(value));
        return;
      }
      setCanvasBackgroundDraft(null);
      const trimmed = value.trim();
      const operations: DesignDataOperation[] = [
        trimmed
          ? { op: "set", path: ["canvasBackground"], value: trimmed }
          : { op: "delete", path: ["canvasBackground"] },
      ];
      const nextData = applyDesignDataOperations(
        designDataJsonRef.current,
        operations,
      );
      designDataJsonRef.current = nextData;
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object") return old;
        return { ...old, data: JSON.stringify(nextData) };
      });
      enqueueFrameGeometryDataSave(operations);
    },
    [enqueueFrameGeometryDataSave, id, queryClient],
  );

  const handleScreenGeometryChange = useCallback(
    (
      screenId: string,
      next: Partial<{ x: number; y: number; width: number; height: number }>,
    ) => {
      const before = getCanvasFrameGeometry(designDataJsonRef.current);
      const screenIndex = overviewScreens.findIndex(
        (screen) => screen.id === screenId,
      );
      const screen =
        screenIndex >= 0 ? overviewScreens[screenIndex] : undefined;
      if (!screen) return;
      const current = {
        ...getInitialFrameGeometry(screenIndex, {
          width: screen.width ?? 1280,
          height: screen.height ?? 2560,
        }),
        ...(before[screenId] ?? canvasFrameGeometryById[screenId] ?? {}),
      };
      const after = {
        ...before,
        [screenId]: {
          ...current,
          ...(next.x !== undefined ? { x: next.x } : {}),
          ...(next.y !== undefined ? { y: next.y } : {}),
          ...(next.width !== undefined
            ? {
                width: Math.max(
                  MIN_FRAME_SIZE_PX,
                  clampScreenDimension(
                    next.width,
                    "width",
                    readScreenSizeConstraints(
                      screenRootComputedStylesById[screenId],
                    ),
                  ),
                ),
              }
            : {}),
          ...(next.height !== undefined
            ? {
                height: Math.max(
                  MIN_FRAME_SIZE_PX,
                  clampScreenDimension(
                    next.height,
                    "height",
                    readScreenSizeConstraints(
                      screenRootComputedStylesById[screenId],
                    ),
                  ),
                ),
              }
            : {}),
        },
      };
      handleGeometryCommit(before, after);
    },
    [
      canvasFrameGeometryById,
      handleGeometryCommit,
      overviewScreens,
      screenRootComputedStylesById,
    ],
  );

  const handleScreenHeightModeChange = useCallback(
    (screenId: string, mode: ScreenHeightMode) => {
      if (!canEditDesignRef.current) return;
      flushPendingFrameGeometrySave();
      const designData = designDataJsonRef.current;
      const screenMetadata = getDesignDataRecord(
        getDesignDataRecord(designData, "screenMetadata"),
        screenId,
      );
      const previousMode = resolveScreenHeightMode(
        screenMetadata.heightMode,
        screenMetadata.heightPinned === true,
        screenMetadata.sourceType,
      );
      const operations: DesignDataOperation[] = [];
      if (mode === "auto") {
        if (screenMetadata.heightMode !== "auto") {
          operations.push({
            op: "set",
            path: ["screenMetadata", screenId, "heightMode"],
            value: "auto",
          });
        }
      } else if (screenMetadata.heightMode !== mode) {
        operations.push({
          op: "set",
          path: ["screenMetadata", screenId, "heightMode"],
          value: mode,
        });
      }
      const heightPinned = mode === "fixed";
      if (screenMetadata.heightPinned !== heightPinned) {
        operations.push({
          op: "set",
          path: ["screenMetadata", screenId, "heightPinned"],
          value: heightPinned,
        });
      }
      const screenIndex = overviewScreens.findIndex(
        (candidate) => candidate.id === screenId,
      );
      const screen =
        screenIndex >= 0 ? overviewScreens[screenIndex] : undefined;
      const naturalHeight = screenContentNaturalHeightByIdRef.current[screenId];
      if (
        previousMode === "hug" &&
        mode === "fixed" &&
        screen &&
        typeof naturalHeight === "number" &&
        naturalHeight > 0
      ) {
        const persistedGeometry = getCanvasFrameGeometry(designData)[screenId];
        const currentGeometry =
          canvasFrameGeometryById[screenId] ??
          persistedGeometry ??
          getInitialFrameGeometry(screenIndex, {
            width: screen.width ?? 1280,
            height: screen.height ?? 2560,
          });
        const nextGeometry = {
          ...currentGeometry,
          height: clampScreenDimension(
            naturalHeight,
            "height",
            readScreenSizeConstraints(screenRootComputedStylesById[screenId]),
          ),
        };
        if (
          !persistedGeometry ||
          JSON.stringify(persistedGeometry) !== JSON.stringify(nextGeometry)
        ) {
          operations.push({
            op: "set",
            path: ["canvasFrames", screenId],
            value: nextGeometry,
          });
        }
      }

      const undoOperations = invertDesignDataOperations(designData, operations);
      if (operations.length > 0) {
        const nextData = applyDesignDataOperations(designData, operations);
        designDataJsonRef.current = nextData;
        queryClient.setQueryData(
          ["action", "get-design", { id }],
          (old: any) => {
            if (!old || typeof old !== "object") return old;
            return { ...old, data: JSON.stringify(nextData) };
          },
        );
        enqueueFrameGeometryDataSave(operations);
      }
      if (heightPinned) locallyPinnedHeightIdsRef.current.add(screenId);
      else locallyPinnedHeightIdsRef.current.delete(screenId);

      let historyBefore = "";
      let historyAfter = "";
      if (
        screen &&
        externalPreviewUrlForContent(getScreenContent(screenId)) === null
      ) {
        const content = getProjectionContentForScreen(screenId);
        historyBefore = content;
        const rootStyles = screenRootComputedStylesById[screenId] ?? {};
        const withHeightMode = setScreenRootDefaultHeightMode(content, mode);
        const next = setScreenRootFrameRenderingStyles(
          withHeightMode,
          screenRootFrameRenderingOptions(rootStyles, heightPinned),
        );
        historyAfter = next;
        if (next !== content) {
          applyFileContentUpdate(screenId, next, {
            persist: true,
            recordHistory: false,
          });
        }
      }
      if (historyBefore !== historyAfter || operations.length > 0) {
        recordContentHistoryEntry({
          fileId: screenId,
          before: historyBefore,
          after: historyAfter,
          ...(operations.length > 0
            ? {
                designDataChange: {
                  undo: undoOperations,
                  redo: operations,
                },
              }
            : {}),
        });
      }
    },
    [
      applyFileContentUpdate,
      canvasFrameGeometryById,
      enqueueFrameGeometryDataSave,
      flushPendingFrameGeometrySave,
      getProjectionContentForScreen,
      getScreenContent,
      id,
      overviewScreens,
      queryClient,
      recordContentHistoryEntry,
      screenRootComputedStylesById,
    ],
  );
  const selectedScreenElement = useMemo(() => {
    const screenId = selectedScreenGeometry?.id;
    if (!screenId || !selectedScreenOwnsItsMarkup) return null;
    const projection = getCodeLayerProjectionForScreen(screenId);
    const body = projection?.nodes.find((node) => node.tag === "body");
    if (!body) return null;
    const element = elementInfoFromCodeLayerNode(body);
    const styleSnapshotKey =
      activeBreakpointWidthState === undefined
        ? screenId
        : getBreakpointIframeId(screenId, activeBreakpointWidthState);
    const authoredBackgroundImage = element.computedStyles.backgroundImage;
    return {
      ...element,
      ...(authoredBackgroundImage !== undefined
        ? {
            inlineStyles: {
              ...element.inlineStyles,
              backgroundImage: authoredBackgroundImage,
            },
          }
        : {}),
      computedStyles: {
        ...element.computedStyles,
        ...screenRootComputedStylesById[styleSnapshotKey],
        ...(authoredBackgroundImage !== undefined
          ? { backgroundImage: authoredBackgroundImage }
          : {}),
      },
    };
  }, [
    activeBreakpointWidthState,
    getBreakpointIframeId,
    getCodeLayerProjectionForScreen,
    screenRootComputedStylesById,
    selectedScreenGeometry,
    selectedScreenOwnsItsMarkup,
  ]);

  const selectionColorPreviewHistoryRef = useRef(
    new Map<string, SelectionColorPreviewHistoryEntry>(),
  );
  const selectionColorPickerSessionRef = useRef(
    new Map<string, SelectionColorPickerSessionEntry>(),
  );

  const selectionColorScopes = useMemo<SelectionColorScope[]>(() => {
    const sourceIsInline = (fileId: string, content: string) =>
      resolveOverviewScreenSourceType(
        overviewScreens.find((screen) => screen.id === fileId),
        designSourceType,
      ) === "inline" &&
      externalPreviewUrlForContent(getScreenContent(fileId)) === null &&
      externalPreviewUrlForContent(content) === null;

    const projectionOf = (fileId: string, content: string) =>
      content === getProjectionContentForScreen(fileId)
        ? (getCodeLayerProjectionForScreen(fileId) ?? undefined)
        : undefined;

    if (selectedLayerTargets.length > 0) {
      return selectedLayerTargets.flatMap((target) => {
        const content =
          target.fileId === activeFile?.id
            ? activeContent
            : getScreenContent(target.fileId);
        return sourceIsInline(target.fileId, content)
          ? [
              {
                fileId: target.fileId,
                content,
                projection: projectionOf(target.fileId, content),
                source: codeLayerSourceForScreen(target.fileId),
                sourceId: bridgeSourceIdForCodeLayerNode(target.node),
                selector: target.node.selector,
              },
            ]
          : [];
      });
    }
    if (selectedElement && activeFile?.id) {
      if (!sourceIsInline(activeFile.id, activeContent)) return [];
      return [
        {
          fileId: activeFile.id,
          content: activeContent,
          projection: projectionOf(activeFile.id, activeContent),
          source: codeLayerSourceForScreen(activeFile.id),
          sourceId: selectedElement.sourceId,
          selector: selectedElement.selector,
        },
      ];
    }
    if (viewMode !== "overview") return [];
    return overviewSelectedScreenIds.flatMap((screenId) => {
      const content = getProjectionContentForScreen(screenId);
      return content && sourceIsInline(screenId, content)
        ? [
            {
              fileId: screenId,
              content,
              projection: projectionOf(screenId, content),
              source: codeLayerSourceForScreen(screenId),
              wholeDocument: true,
            },
          ]
        : [];
    });
  }, [
    activeContent,
    codeLayerSourceForScreen,
    designSourceType,
    activeFile?.id,
    getCodeLayerProjectionForScreen,
    getProjectionContentForScreen,
    getScreenContent,
    overviewScreens,
    overviewSelectedScreenIds,
    selectedElement,
    selectedLayerTargets,
    viewMode,
  ]);

  const readSelectionSubtreeColorStyles = useCallback(
    (element: ElementInfo): Array<Record<string, string>> => {
      const screenId = element.sourceLayerIdentity?.screenId ?? activeFile?.id;
      if (!screenId || !element.selector) return [];
      const read = readSubtreeColorStyles(
        screenId,
        element.selector,
        viewModeRef.current === "overview"
          ? activeBreakpointWidthStateRef.current
          : undefined,
        boardFileId,
      );
      return read.status === "captured" ? read.nodes : [];
    },
    [activeFile?.id, boardFileId],
  );

  const selectionColorScopeIdentity = JSON.stringify(
    selectionColorScopes.map(
      ({ fileId, sourceId, selector, wholeDocument }) => ({
        fileId,
        sourceId,
        selector,
        wholeDocument,
      }),
    ),
  );

  const getFreshSelectionColorScopes = useCallback(
    () =>
      selectionColorScopes.map((scope) => ({
        ...scope,
        content:
          scope.fileId === activeFile?.id
            ? getFreshActiveFileContent({
                activeContent,
                latestContent: latestActiveContentRef.current,
                lastLocalContent: lastLocalContentRef.current,
              })
            : getScreenContent(scope.fileId),
      })),
    [activeContent, activeFile?.id, getScreenContent, selectionColorScopes],
  );

  const handleSelectionColorChange = useCallback(
    (from: string, to: string, meta?: StyleChangeMeta) => {
      const result = runSelectionColorChange(
        {
          activeFileId: activeFile?.id,
          applyFileContentUpdate,
          canEditDesign,
          recordContentHistoryEntry,
          scopes: getFreshSelectionColorScopes(),
          previewHistoryRef: selectionColorPreviewHistoryRef,
          pickerSessionRef: selectionColorPickerSessionRef,
        },
        from,
        to,
        meta,
      );
      if (result.status === "refused" && meta?.phase !== "cancel") {
        toast.error(t("designEditor.toasts.groupFillApplyFailed"), {
          duration: 4000,
          id: "selection-color-apply-failed",
        });
      }
      return result.status === "refused" ? false : undefined;
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      getFreshSelectionColorScopes,
      recordContentHistoryEntry,
      t,
    ],
  );

  const handleSelectionColorPickerOpenChange = useCallback(
    (from: string, open: boolean) => {
      setSelectionColorPickerSession(
        {
          pickerSessionRef: selectionColorPickerSessionRef,
          previewHistoryRef: selectionColorPreviewHistoryRef,
          scopes: getFreshSelectionColorScopes(),
        },
        from,
        open,
      );
    },
    [getFreshSelectionColorScopes],
  );

  const canSelectSelectionColorTarget = useCallback(
    (color: string) =>
      selectionColorTargets(getFreshSelectionColorScopes(), color).length > 0,
    [getFreshSelectionColorScopes],
  );

  const handleGroupFillStylesChange = useCallback(
    (styles: Record<string, string>, meta?: StyleChangeMeta) => {
      if (!canEditDesign) return false;
      for (const [fileId, session] of selectionColorPickerSessionRef.current) {
        selectionColorPickerSessionRef.current.set(fileId, {
          ...session,
          invalidated: true,
        });
        if (selectionColorPreviewHistoryRef.current.get(fileId)?.from) {
          selectionColorPreviewHistoryRef.current.delete(fileId);
        }
      }
      if (meta?.phase === "cancel") {
        const scopesByFile = new Map<
          string,
          ReturnType<typeof getFreshSelectionColorScopes>
        >();
        for (const scope of getFreshSelectionColorScopes()) {
          scopesByFile.set(scope.fileId, [
            ...(scopesByFile.get(scope.fileId) ?? []),
            scope,
          ]);
        }
        let restored = true;
        for (const [scopeFileId, scopes] of scopesByFile) {
          if (!selectionColorPreviewHistoryRef.current.has(scopeFileId))
            continue;
          const content = scopes[0]?.content;
          const result = restoreSelectionColorPreview(
            {
              activeFileId: activeFile?.id,
              applyFileContentUpdate,
              previewHistoryRef: selectionColorPreviewHistoryRef,
            },
            scopeFileId,
            scopes.every((scope) => scope.content === content)
              ? content
              : undefined,
          );
          if (result !== "accepted") restored = false;
        }
        return restored;
      }
      const currentScopes = getFreshSelectionColorScopes();
      const result = rewriteSelectionFillStyles(currentScopes, styles);
      if (result.status !== "applied") {
        toast.error(t("designEditor.toasts.groupFillApplyFailed"), {
          duration: 4000,
        });
        console.warn("Group Fill update was refused:", result.message);
        return false;
      }

      const previewOnly = meta?.phase === "preview";
      for (const update of result.updates) {
        const beforeContent = currentScopes.find(
          (scope) => scope.fileId === update.fileId,
        )?.content;
        if (beforeContent === undefined) continue;

        const previousPreview = selectionColorPreviewHistoryRef.current.get(
          update.fileId,
        );
        if (previousPreview && previousPreview.after !== beforeContent) {
          selectionColorPreviewHistoryRef.current.delete(update.fileId);
        }
        const activePreview = selectionColorPreviewHistoryRef.current.get(
          update.fileId,
        );
        const applyResult = applyFileContentUpdate(
          update.fileId,
          update.content,
          {
            forcePreviewFullDocument: update.fileId === activeFile?.id,
            persist: !previewOnly,
            recordHistory: !previewOnly,
            historyBeforeContent: previewOnly
              ? undefined
              : activePreview?.before,
          },
        );
        if (
          previewOnly &&
          (applyResult?.status === "accepted" ||
            applyResult?.status === "deferred")
        ) {
          selectionColorPreviewHistoryRef.current.set(update.fileId, {
            before: activePreview?.before ?? beforeContent,
            after:
              applyResult.status === "accepted"
                ? applyResult.content
                : prepareCanonicalSourceContent(update.content, {
                    fileId: update.fileId,
                  }).content,
          });
        } else if (
          !previewOnly &&
          (applyResult?.status === "accepted" ||
            applyResult?.status === "deferred")
        ) {
          selectionColorPreviewHistoryRef.current.delete(update.fileId);
        }
      }
      return true;
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      getFreshSelectionColorScopes,
      t,
    ],
  );

  const handleSelectionColorTarget = useCallback(
    (color: string) => {
      const targets = selectionColorTargets(
        getFreshSelectionColorScopes(),
        color,
      );
      if (targets.length === 0) return;

      recordSelectionHistoryAroundChange(() => {
        const nextLayerIds: string[] = [];
        const nextScreenIds: string[] = [];
        const addUnique = (ids: string[], id: string) => {
          if (!ids.includes(id)) ids.push(id);
        };
        const ownerForTarget = (target: (typeof targets)[number]) =>
          codeLayerOwnerByNodeId.get(target.nodeId) ??
          Array.from(codeLayerOwnerByNodeId.values()).find(
            (candidate) =>
              candidate.fileId === target.fileId &&
              candidate.node.tag === target.tag &&
              candidate.node.selector === target.selector,
          );

        for (const target of targets) {
          if (target.tag === "html" || target.tag === "body") {
            addUnique(nextScreenIds, target.fileId);
          } else {
            addUnique(nextLayerIds, target.nodeId);
          }
          const owner = ownerForTarget(target);
          if (owner) {
            addUnique(nextLayerIds, owner.node.id);
            addUnique(nextScreenIds, owner.fileId);
          }
        }

        explicitOverviewScreenSelectionRef.current = targets.some(
          (target) => target.tag !== "html" && target.tag !== "body",
        )
          ? []
          : [...nextScreenIds];

        if (viewModeRef.current === "overview") {
          const nextActiveFileId = nextScreenIds[0] ?? targets[0]?.fileId;
          if (nextActiveFileId) setActiveFileId(nextActiveFileId);
          setOverviewSelectedScreenIds(nextScreenIds);
          setSelectedLayerIdsState(
            nextScreenIds.length > 0
              ? [...nextScreenIds, ...nextLayerIds]
              : nextLayerIds,
          );
        } else {
          const fileId = targets[0]?.fileId;
          if (fileId) setActiveFileId(fileId);
          setOverviewSelectedScreenIds([]);
          setSelectedLayerIdsState(nextLayerIds);
        }

        const lastLayerTarget = [...targets]
          .reverse()
          .find((target) => target.tag !== "html" && target.tag !== "body");
        const lastOwner = lastLayerTarget
          ? ownerForTarget(lastLayerTarget)
          : null;
        const lastRootTarget = [...targets]
          .reverse()
          .find((target) => target.tag === "html" || target.tag === "body");
        const selectedOwner =
          lastOwner ?? (lastRootTarget ? ownerForTarget(lastRootTarget) : null);
        if (selectedOwner) {
          setSelectedElement(
            elementInfoForOwnedCodeLayerNode({
              info: selectedElement,
              node: selectedOwner.node,
              ownerFileId: selectedOwner.fileId,
            }),
          );
        } else if (lastRootTarget) {
          setSelectedElement((current) => current);
        } else {
          setSelectedElement(null);
        }
        setActiveTool("move");
        setMode("edit");
        setExpandedLayerIds((current) => {
          const currentIds = new Set(current);
          const next = new Set(currentIds);
          for (const target of targets) {
            const owner = ownerForTarget(target);
            if (!owner) continue;
            next.add(owner.fileId);
            collectCodeLayerAncestors(owner.tree, owner.node.id).forEach(
              (ancestorId) => next.add(ancestorId),
            );
          }
          return next.size === currentIds.size ? current : Array.from(next);
        });
        if (viewModeRef.current === "overview") {
          window.requestAnimationFrame(() => handleZoomToSelectionFit());
        }
      });
    },
    [
      codeLayerOwnerByNodeId,
      getFreshSelectionColorScopes,
      handleZoomToSelectionFit,
      recordSelectionHistoryAroundChange,
      selectedElement,
    ],
  );

  const activeScreenPreviewUrl = useMemo(() => {
    if (activeScreenSnapshotOnly) return undefined;
    if (builderPreviewUrl) return builderPreviewUrl;
    const screen = overviewScreens.find((item) => item.id === activeFile?.id);
    return (
      screen?.url ||
      screen?.previewUrl ||
      externalPreviewUrlForContent(activeContent)
    );
  }, [
    activeContent,
    activeFile?.id,
    activeScreenSnapshotOnly,
    builderPreviewUrl,
    overviewScreens,
  ]);

  const statesPanelBreakpoints = useMemo<
    Array<{ id: string; label: string; widthPx: number }>
  >(() => {
    try {
      const raw = (designDataJson as Record<string, unknown>)?.breakpointSet;
      if (
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        Array.isArray((raw as Record<string, unknown>).breakpoints)
      ) {
        const bps = (
          raw as {
            breakpoints: Array<{
              id: string;
              widthPx: number;
              label?: string;
            }>;
          }
        ).breakpoints;
        return bps.map((bp) => ({
          id: bp.id,
          widthPx: bp.widthPx,
          label:
            bp.label ??
            (bp.widthPx >= 1024
              ? "Desktop"
              : bp.widthPx >= 600
                ? "Tablet"
                : "Mobile"),
        }));
      }
      // coercion-ok: an unreadable breakpointSet means "none configured", which the empty list already expresses to the caller.
    } catch {
      // ignore
    }
    return [];
  }, [designDataJson]);

  const statesPanelActiveBreakpointId = useMemo<string>(() => {
    if (activeBreakpointWidthState == null) return "auto";
    const match = statesPanelBreakpoints.find(
      (bp) => bp.widthPx === activeBreakpointWidthState,
    );
    if (match) return match.id;
    const defaultMatch = DEFAULT_STATES_PANEL_BREAKPOINTS.find(
      (bp) => bp.widthPx === activeBreakpointWidthState,
    );
    return defaultMatch?.id ?? "auto";
  }, [activeBreakpointWidthState, statesPanelBreakpoints]);

  const handleStatesPanelBreakpointSelect = useCallback(
    (breakpointId: string) => {
      if (breakpointId === "auto") {
        activeBreakpointWidthStateRef.current = undefined;
        setActiveBreakpointWidthState(undefined);
        if (id) {
          persistActiveBreakpoint("auto", responsiveEditScopeRef.current);
        }
        return;
      }
      const bp =
        statesPanelBreakpoints.find((b) => b.id === breakpointId) ??
        DEFAULT_STATES_PANEL_BREAKPOINTS.find((b) => b.id === breakpointId);
      if (!bp) return;
      activeBreakpointWidthStateRef.current = bp.widthPx;
      setActiveBreakpointWidthState(bp.widthPx);
      if (id) {
        persistActiveBreakpoint(breakpointId, responsiveEditScopeRef.current);
      }
    },
    [id, persistActiveBreakpoint, statesPanelBreakpoints],
  );

  const handleStatesPanelAddBreakpoint = useCallback(() => {
    if (viewMode !== "overview") {
      viewModeRef.current = "overview";
      setViewMode("overview");
    }
  }, [viewMode]);

  const statesPanelProps = useMemo(() => {
    if (!id) return undefined;
    return {
      activeStateId: selectedStateId,
      activeBreakpointId: statesPanelActiveBreakpointId,
      breakpoints: statesPanelBreakpoints,
      onStateSelect: handleDesignStateSelect,
      onBreakpointSelect: handleStatesPanelBreakpointSelect,
      onAddBreakpoint: handleStatesPanelAddBreakpoint,
    };
  }, [
    id,
    selectedStateId,
    statesPanelActiveBreakpointId,
    statesPanelBreakpoints,
    handleDesignStateSelect,
    handleStatesPanelBreakpointSelect,
    handleStatesPanelAddBreakpoint,
  ]);

  const handleOpenDesignPreview = useCallback(() => {
    if (activeScreenSnapshotOnly) return;
    let previewUrl = activeScreenPreviewUrl;
    let blobUrl: string | null = null;
    if (!previewUrl) {
      if (!activeContent.trim()) return;
      blobUrl = URL.createObjectURL(
        new Blob([fullPreviewHtml(activeContent)], { type: "text/html" }),
      );
      previewUrl = blobUrl;
    }

    openPreviewUrl(
      previewUrl,
      (url, target) => window.open(url, target),
      (url) => window.location.assign(url),
    );
    if (blobUrl) {
      window.setTimeout(() => URL.revokeObjectURL(blobUrl!), 60_000);
    }
  }, [activeContent, activeScreenPreviewUrl, activeScreenSnapshotOnly]);

  return {
    commitOverviewScreenStylesRef,
    selectedScreenGeometry,
    selectedScreenSource,
    handleRemoveSelectedScreen,
    handleScreenSourceChange,
    handleScreenUrlChange,
    handleSelectedScreenStyleChange,
    handleSelectedScreenStylesChange,
    canvasBackground,
    themedCanvasBackground,
    setThemedCanvasBackground,
    handleCanvasBackgroundChange,
    handleScreenGeometryChange,
    handleScreenHeightModeChange,
    selectedScreenElement,
    selectionColorPreviewHistoryRef,
    selectionColorPickerSessionRef,
    selectionColorScopes,
    selectionColorScopeIdentity,
    readSelectionSubtreeColorStyles,
    handleSelectionColorChange,
    handleSelectionColorPickerOpenChange,
    canSelectSelectionColorTarget,
    handleGroupFillStylesChange,
    handleSelectionColorTarget,
    activeScreenPreviewUrl,
    statesPanelProps,
    handleOpenDesignPreview,
  };
}

export type EditorScreenInspector = ReturnType<typeof useEditorScreenInspector>;
