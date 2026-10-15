import {
  buildDynamicAgentSuggestions,
  type AgentDynamicSuggestionContext,
} from "@agent-native/core/client/agent-chat";
import {
  buildCodeLayerProjection,
  cachedCodeLayerNodeById,
  cachedCodeLayerTree,
  type CodeLayerNode,
  type CodeLayerProjection,
  type CodeLayerTreeNode,
} from "@shared/code-layer";
import { useState, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";

import {
  type LayersPanelFile,
  type LayersPanelNode,
} from "@/components/design/LayersPanel";
import { getCanonicalScreenStack } from "@/components/design/multi-screen/frame-geometry";
import { prettyScreenName } from "@/lib/screen-names";

import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerSourceNodeIdAttrs,
  codeLayerSelectorAliases,
  previewCodeLayerTreeMove,
  cachedCodeLayerTreeToPanelNodes,
  CodeLayerOwnerIndex,
  collectEffectiveCodeLayerState,
  type EffectiveCodeLayerState,
  elementInfoForOwnedCodeLayerNode,
  remapLegacyCodeLayerNodeId,
  resolveCodeLayerNodeFromBridge,
  resolveCodeLayerNodeFromElementInfo,
  type SelectedLayerTarget,
} from "../code-layer-state";
import type { ShareExportFormat } from "../command-types";
import {
  buildNeededLayerModels,
  nextRecentLayerModelFileIds,
  screenBodyHasElements,
} from "../derive/layer-model-coverage";
import { NO_SELECTORS } from "../design-editor-shared";
import { withMeasuredGeometry } from "../editor-helpers";
import { getDesignEditorStateUrlSearch } from "../editor-state";
import { layerStateIdsForScreen } from "../layer-state-scope";
import {
  shouldPreferRuntimeLayerProjection,
  shouldUseRuntimeLayerProjection,
} from "../pending-edits";
import { findDesignFileByScreenTarget } from "../screen-command-utils";
import { resolveEffectiveSelectedLayerIds } from "../selection-state";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorContentAndComponents } from "./use-editor-content-and-components";
import type { EditorCore } from "./use-editor-core";
import type { EditorExportAndHandoff } from "./use-editor-export-and-handoff";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import type { EditorLiveEditsAndPresence } from "./use-editor-live-edits-and-presence";
import type { EditorSelectionAndStyles } from "./use-editor-selection-and-styles";

type CodeLayerFileModel = {
  fileId: string;
  projection: CodeLayerProjection;
  sourceProjection: CodeLayerProjection;
  sourceContent: string;
  sourceNodeIdAttrs: ReadonlySet<string>;
  runtimeOnly: boolean;
  structurePreviewKey: string;
  tree: CodeLayerTreeNode[];
  nodeById: ReadonlyMap<string, CodeLayerNode>;
};

export function useEditorLayerModels({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorLiveEditsAndPresence,
  editorContentAndComponents,
  editorSelectionAndStyles,
  editorExportAndHandoff,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorCanvasAndScreens: EditorCanvasAndScreens;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorContentAndComponents: EditorContentAndComponents;
  editorSelectionAndStyles: EditorSelectionAndStyles;
  editorExportAndHandoff: EditorExportAndHandoff;
}) {
  const {
    t,
    location,
    initialSearchParams,
    mode,
    activeTool,
    viewMode,
    selectedElement,
    activeFileId,
  } = editorCore;
  const {
    setActiveLeftPanel,
    expandedLayerIds,
    selectedLayerIdsState,
    codeLayerOwnerByNodeIdRef,
    overviewSelectedScreenIds,
    createdOverviewLayerSelection,
    pendingOverviewScreenSelectionRef,
    pendingOverviewLayerSelectionRef,
    lockedLayerIds,
    hiddenLayerIds,
  } = editorHistory;
  const { design } = editorGenerationAndAccess;
  const {
    navigate,
    files,
    codeLayerSourceForScreen,
    runtimeLayerSnapshotsById,
    designSourceType,
    canvasFrameGeometryById,
    boardFileId,
    overviewScreens,
    editorShareUrl,
  } = editorFilesAndSaving;
  const { activeFile } = editorActiveScreenAndGeometry;
  const {
    layerStructurePreviewByFileId,
    getScreenContent,
    getProjectionContentForScreen,
  } = editorCanvasAndScreens;
  const {
    zoom,
    activeCodeLayerProjection,
    selectedElementLayerId,
    selectedCanvasSelectorCandidates,
    canEditLiveScreen,
  } = editorLiveEditsAndPresence;
  const { runtimeProjectionCacheRef, getRuntimeCodeLayerProjection } =
    editorContentAndComponents;
  const {
    commitStylesToSelectedLayersRef,
    commitCapturedStyleTargetsRef,
    effectiveCodeLayerStateRef,
    nonActiveProjectionCacheRef,
    getCodeLayerProjectionForScreen,
  } = editorSelectionAndStyles;
  const {
    codingHandoffResult,
    codingHandoffError,
    codingHandoffLoading,
    getCodingHandoffClipboardText,
  } = editorExportAndHandoff;

  const initialRouteScreenTarget =
    initialSearchParams.get("screen") ??
    initialSearchParams.get("fileId") ??
    initialSearchParams.get("filename");
  const initialRouteSelectionId = initialSearchParams.get("selection") || null;
  const [layersSearchQuery, setLayersSearchQuery] = useState("");

  const [shareExportFormat, setShareExportFormat] =
    useState<ShareExportFormat>("html");
  const codingHandoffPreviewFallback = [
    "Copy this prompt into your agent to import this design:",
    editorShareUrl,
    "",
    `Implement: ${activeFile?.filename ?? design?.title ?? "current design"}`,
  ].join("\n");
  const codingHandoffPreviewText =
    getCodingHandoffClipboardText(codingHandoffResult) ||
    (codingHandoffError
      ? `Unable to create agent prompt: ${codingHandoffError}`
      : codingHandoffLoading
        ? "Preparing agent prompt..."
        : codingHandoffPreviewFallback);
  const activeCodeLayerTree = useMemo(
    () => cachedCodeLayerTree(activeCodeLayerProjection),
    [activeCodeLayerProjection],
  );
  const activeCodeLayerNodeById = cachedCodeLayerNodeById(
    activeCodeLayerProjection,
  );
  const overviewScreenById = useMemo(
    () => new Map(overviewScreens.map((screen) => [screen.id, screen])),
    [overviewScreens],
  );
  const codeLayerModelCacheRef = useRef<Map<string, CodeLayerFileModel>>(
    new Map(),
  );
  const codeLayerModelsArrayRef = useRef<CodeLayerFileModel[]>([]);
  const recentLayerModelFileIdsRef = useRef<string[]>([]);
  const [coveredLayerModelFileIds, setCoveredLayerModelFileIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const layerModelsCoverAll = files.every((file) =>
    coveredLayerModelFileIds.has(file.id),
  );
  const layerModelDemand = useMemo(
    () =>
      layerModelsCoverAll
        ? null
        : {
            boardFileId,
            expandedIds: new Set(expandedLayerIds),
            lockedLayerIds,
            hiddenLayerIds,
            routeSelectionFileId:
              initialRouteSelectionId && initialRouteScreenTarget
                ? findDesignFileByScreenTarget(files, initialRouteScreenTarget)
                    ?.id
                : undefined,
            selectedLayerIds: [
              ...selectedLayerIdsState,
              createdOverviewLayerSelection?.layerId,
              initialRouteSelectionId,
            ],
            activeStoredContent: activeFile?.content ?? "",
          },
    [
      activeFile?.content,
      boardFileId,
      createdOverviewLayerSelection?.layerId,
      expandedLayerIds,
      files,
      hiddenLayerIds,
      initialRouteScreenTarget,
      initialRouteSelectionId,
      layerModelsCoverAll,
      lockedLayerIds,
      selectedLayerIdsState,
    ],
  );
  const sourceLayerStateByFileIdRef = useRef(
    new Map<string, { content: string; present: boolean }>(),
  );
  const codeLayerModelsByFile = useMemo(() => {
    const cache = codeLayerModelCacheRef.current;
    const liveFileIds = new Set(files.map((file) => file.id));
    const demand = layerModelDemand;
    const sourceLayerStates = sourceLayerStateByFileIdRef.current;
    const hasSourceLayerState = (fileId: string) => {
      const content = getProjectionContentForScreen(fileId);
      const known = sourceLayerStates.get(fileId);
      if (known?.content === content) return known.present;
      const present =
        content.includes("data-agent-native-locked") ||
        content.includes("data-agent-native-hidden");
      sourceLayerStates.set(fileId, { content, present });
      return present;
    };
    const isFocused = (fileId: string) =>
      fileId === activeFile?.id ||
      fileId === demand?.boardFileId ||
      fileId === demand?.routeSelectionFileId ||
      Boolean(demand?.expandedIds.has(fileId)) ||
      Boolean(layerStructurePreviewByFileId[fileId]);
    const recentFileIds = nextRecentLayerModelFileIds(
      recentLayerModelFileIdsRef.current,
      files.map((file) => file.id).filter(isFocused),
    );
    recentLayerModelFileIdsRef.current = recentFileIds;
    // Every other screen's model is rebuilt on demand: keeping each one a
    // session touched grew a large board's heap past a gigabyte.
    const isNeeded = (fileId: string) =>
      !demand ||
      coveredLayerModelFileIds.has(fileId) ||
      isFocused(fileId) ||
      recentFileIds.includes(fileId) ||
      demand.lockedLayerIds.has(fileId) ||
      demand.hiddenLayerIds.has(fileId) ||
      hasSourceLayerState(fileId);
    const buildModel = (file: (typeof files)[number]): CodeLayerFileModel => {
      const sourceContent = getScreenContent(file.id);
      const cached = cache.get(file.id);
      const structurePreview = layerStructurePreviewByFileId[file.id];
      const structurePreviewKey = structurePreview
        ? `${structurePreview.sourceId}:${structurePreview.anchorId}:${structurePreview.placement}:${structurePreview.insert}`
        : "";
      const projectionContent = getProjectionContentForScreen(file.id);
      const sourceProjection =
        getCodeLayerProjectionForScreen(file.id) ??
        buildCodeLayerProjection(projectionContent, {
          source: codeLayerSourceForScreen(file.id),
        });
      const sourceNodeIdAttrs =
        cached?.sourceContent === sourceContent
          ? cached.sourceNodeIdAttrs
          : codeLayerSourceNodeIdAttrs(
              projectionContent === sourceContent
                ? sourceProjection
                : sourceContent,
            );
      const runtimeSnapshot = runtimeLayerSnapshotsById[file.id];
      const runtimeProjectionEligible = shouldUseRuntimeLayerProjection({
        screen: overviewScreenById.get(file.id),
        fallbackSourceType: designSourceType,
        content: file.content,
      });
      const runtimeProjection =
        runtimeSnapshot && runtimeProjectionEligible
          ? getRuntimeCodeLayerProjection(file.id, runtimeSnapshot.html)
          : null;
      const useRuntimeProjection = shouldPreferRuntimeLayerProjection({
        eligible: runtimeProjectionEligible,
        runtimeNodeCount: runtimeProjection?.nodes.length ?? 0,
        sourceNodeCount: sourceProjection.nodes.length,
      });
      const projection = useRuntimeProjection
        ? runtimeProjection!
        : sourceProjection;
      if (
        cached &&
        cached.projection === projection &&
        cached.sourceProjection === sourceProjection &&
        cached.sourceContent === sourceContent &&
        cached.runtimeOnly === useRuntimeProjection &&
        cached.structurePreviewKey === structurePreviewKey
      ) {
        return cached;
      }
      const baseTree = useRuntimeProjection
        ? cachedCodeLayerTree(projection)
        : file.id === activeFile?.id
          ? activeCodeLayerTree
          : cachedCodeLayerTree(projection);
      const tree = structurePreview
        ? (() => {
            const sourceNode = resolveCodeLayerNodeFromBridge(
              projection,
              undefined,
              structurePreview.sourceId,
            );
            const anchorNode = resolveCodeLayerNodeFromBridge(
              projection,
              undefined,
              structurePreview.anchorId,
            );
            return sourceNode && anchorNode
              ? (previewCodeLayerTreeMove(baseTree, {
                  ...structurePreview,
                  sourceId: sourceNode.id,
                  anchorId: anchorNode.id,
                }) ?? baseTree)
              : baseTree;
          })()
        : baseTree;
      const model: CodeLayerFileModel = {
        fileId: file.id,
        projection,
        sourceProjection,
        sourceContent,
        sourceNodeIdAttrs,
        runtimeOnly: useRuntimeProjection,
        structurePreviewKey,
        tree,
        nodeById: cachedCodeLayerNodeById(projection),
      };
      cache.set(file.id, model);
      return model;
    };
    const models = buildNeededLayerModels({
      files,
      isNeeded,
      contentLength: (fileId) => getProjectionContentForScreen(fileId).length,
      buildModel,
      namesUnbuiltLayer: (built) => {
        let activeStoredNodeIds: Set<string> | undefined;
        const ownedByActiveFile = (layerId: string) => {
          const activeId = activeFile?.id;
          if (!activeId) return false;
          activeStoredNodeIds ??= new Set(
            buildCodeLayerProjection(demand?.activeStoredContent ?? "", {
              source: codeLayerSourceForScreen(activeId),
            }).nodes.map((node) => node.id),
          );
          return activeStoredNodeIds.has(layerId);
        };
        return [
          ...(demand?.selectedLayerIds ?? []),
          pendingOverviewLayerSelectionRef.current,
        ].some(
          (layerId) =>
            layerId &&
            !liveFileIds.has(layerId) &&
            !built.some((model) => model.nodeById.has(layerId)) &&
            !ownedByActiveFile(layerId),
        );
      },
    });
    const builtFileIds = new Set(models.map((model) => model.fileId));
    for (const fileId of cache.keys()) {
      if (!builtFileIds.has(fileId)) cache.delete(fileId);
    }
    for (const fileId of sourceLayerStates.keys()) {
      if (!liveFileIds.has(fileId)) sourceLayerStates.delete(fileId);
    }
    for (const fileId of runtimeProjectionCacheRef.current.keys()) {
      if (!builtFileIds.has(fileId)) {
        runtimeProjectionCacheRef.current.delete(fileId);
      }
    }
    for (const fileId of nonActiveProjectionCacheRef.current.keys()) {
      if (!builtFileIds.has(fileId)) {
        nonActiveProjectionCacheRef.current.delete(fileId);
      }
    }
    const previousModels = codeLayerModelsArrayRef.current;
    if (
      previousModels.length === models.length &&
      models.every((model, index) => model === previousModels[index])
    ) {
      return previousModels;
    }
    codeLayerModelsArrayRef.current = models;
    return models;
  }, [
    activeCodeLayerTree,
    activeFile?.id,
    codeLayerSourceForScreen,
    coveredLayerModelFileIds,
    designSourceType,
    files,
    getCodeLayerProjectionForScreen,
    getProjectionContentForScreen,
    getRuntimeCodeLayerProjection,
    getScreenContent,
    layerModelDemand,
    overviewScreenById,
    runtimeLayerSnapshotsById,
    layerStructurePreviewByFileId,
  ]);
  const getCodeLayerProjectionForScreenRef = useRef(
    getCodeLayerProjectionForScreen,
  );
  getCodeLayerProjectionForScreenRef.current = getCodeLayerProjectionForScreen;
  const getProjectionContentForScreenRef = useRef(
    getProjectionContentForScreen,
  );
  getProjectionContentForScreenRef.current = getProjectionContentForScreen;
  const coveredLayerModelFileIdsRef = useRef(coveredLayerModelFileIds);
  coveredLayerModelFileIdsRef.current = coveredLayerModelFileIds;
  const layersSearchQueryRef = useRef(layersSearchQuery);
  layersSearchQueryRef.current = layersSearchQuery;
  const codeLayerModelByFileId = useMemo(
    () => new Map(codeLayerModelsByFile.map((model) => [model.fileId, model])),
    [codeLayerModelsByFile],
  );
  const codeLayerOwnerIndexRef = useRef<CodeLayerOwnerIndex | null>(null);
  const codeLayerOwnerByNodeId = useMemo(
    () =>
      (codeLayerOwnerIndexRef.current ??= new CodeLayerOwnerIndex()).sync(
        codeLayerModelsByFile,
      ),
    [codeLayerModelsByFile],
  );
  const resolvedInitialRouteSelectionId = useMemo(() => {
    if (!initialRouteSelectionId) return null;
    const targetFile = initialRouteScreenTarget
      ? findDesignFileByScreenTarget(files, initialRouteScreenTarget)
      : null;
    if (initialRouteScreenTarget && !targetFile) return null;
    const directOwner = codeLayerOwnerByNodeId.get(initialRouteSelectionId);
    if (directOwner && (!targetFile || directOwner.fileId === targetFile.id)) {
      return initialRouteSelectionId;
    }
    if (!targetFile) return null;
    const model = codeLayerModelByFileId.get(targetFile.id);
    if (!model) return null;

    const runtimeHtml = runtimeLayerSnapshotsById[targetFile.id]?.html;
    const legacyProjections = [
      buildCodeLayerProjection(getProjectionContentForScreen(targetFile.id)),
      ...(runtimeHtml ? [buildCodeLayerProjection(runtimeHtml)] : []),
    ];
    const mappedIds = new Set<string>();
    for (const legacyProjection of legacyProjections) {
      const mappedId = remapLegacyCodeLayerNodeId(
        legacyProjection,
        model.projection,
        initialRouteSelectionId,
      );
      if (mappedId) mappedIds.add(mappedId);
    }
    const sourceProjectionId = model.sourceProjection.nodes.find(
      (node) => node.id === initialRouteSelectionId,
    );
    if (sourceProjectionId) {
      const mappedId = remapLegacyCodeLayerNodeId(
        model.sourceProjection,
        model.projection,
        initialRouteSelectionId,
      );
      if (mappedId) mappedIds.add(mappedId);
    }
    return mappedIds.size === 1 ? [...mappedIds][0]! : null;
  }, [
    codeLayerModelByFileId,
    codeLayerOwnerByNodeId,
    files,
    getProjectionContentForScreen,
    initialRouteScreenTarget,
    initialRouteSelectionId,
    runtimeLayerSnapshotsById,
  ]);
  codeLayerOwnerByNodeIdRef.current = codeLayerOwnerByNodeId;
  commitCapturedStyleTargetsRef.current = (
    styles,
    capturedTargets,
    interactionState,
  ) => {
    const scope = capturedTargets[0];
    const failClosed = () => {
      toast.error(t("designEditor.patchProof.selectorMissing"));
    };
    if (!scope || capturedTargets.length === 0) {
      failClosed();
      return;
    }

    const ownerByNodeId = codeLayerOwnerByNodeIdRef.current;
    const resolvedTargets: SelectedLayerTarget[] = [];
    for (const captured of capturedTargets) {
      const identity = captured.elementInfo.sourceLayerIdentity;
      if (
        !captured.fileId ||
        !captured.layerId ||
        identity?.screenId !== captured.fileId ||
        identity.nodeId !== captured.layerId ||
        captured.upperBoundPx !== scope.upperBoundPx ||
        captured.lowerBoundPx !== scope.lowerBoundPx
      ) {
        failClosed();
        return;
      }

      let owner = ownerByNodeId.get(captured.layerId);
      if (owner?.fileId !== captured.fileId) owner = undefined;
      if (!owner) {
        const fileNodes = [...ownerByNodeId.values()]
          .filter((candidate) => candidate.fileId === captured.fileId)
          .map((candidate) => candidate.node);
        const resolvedNode = resolveCodeLayerNodeFromElementInfo(
          {
            nodes: fileNodes,
            source: { fileId: captured.fileId },
          },
          captured.elementInfo,
        );
        owner = resolvedNode ? ownerByNodeId.get(resolvedNode.id) : undefined;
        if (owner?.fileId !== captured.fileId) owner = undefined;
      }
      if (!owner) {
        failClosed();
        return;
      }
      resolvedTargets.push({
        layerId: owner.node.id,
        fileId: owner.fileId,
        node: owner.node,
        tree: owner.tree,
        elementInfo: elementInfoForOwnedCodeLayerNode({
          info: captured.elementInfo,
          node: owner.node,
          ownerFileId: owner.fileId,
        }),
      });
    }

    const applied = commitStylesToSelectedLayersRef.current(
      styles,
      resolvedTargets,
      {
        capturedTargetIds: resolvedTargets.map((target) => target.layerId),
        interactionState,
        scope: {
          upperBoundPx: scope.upperBoundPx,
          lowerBoundPx: scope.lowerBoundPx,
        },
      },
    );
    if (!applied) failClosed();
  };
  const effectiveCodeLayerState = useMemo(() => {
    const state: EffectiveCodeLayerState = {
      lockedIds: new Set(),
      hiddenIds: new Set(),
    };
    codeLayerModelsByFile.forEach((model) => {
      const fileLocked = lockedLayerIds.has(model.fileId);
      const fileHidden = hiddenLayerIds.has(model.fileId);
      const fileLockedLayerIds = layerStateIdsForScreen(
        lockedLayerIds,
        model.fileId,
      );
      const fileHiddenLayerIds = layerStateIdsForScreen(
        hiddenLayerIds,
        model.fileId,
      );
      if (fileLocked) state.lockedIds.add(model.fileId);
      if (fileHidden) state.hiddenIds.add(model.fileId);
      collectEffectiveCodeLayerState(
        model.tree,
        fileLockedLayerIds,
        fileHiddenLayerIds,
        fileLocked,
        fileHidden,
        state,
      );
    });
    return state;
  }, [codeLayerModelsByFile, hiddenLayerIds, lockedLayerIds]);
  effectiveCodeLayerStateRef.current = effectiveCodeLayerState;
  const lockedLayerSelectors = useMemo(() => {
    const activeLayerIds = activeFile?.id
      ? layerStateIdsForScreen(lockedLayerIds, activeFile.id)
      : new Set<string>();
    const selectors = Array.from(activeLayerIds)
      .flatMap((layerId) =>
        codeLayerSelectorAliases(activeCodeLayerNodeById.get(layerId)),
      )
      .filter(Boolean);
    if (activeFile?.id && lockedLayerIds.has(activeFile.id)) {
      selectors.push("body");
    }
    return Array.from(new Set(selectors));
  }, [activeCodeLayerNodeById, activeFile?.id, lockedLayerIds]);
  const hiddenLayerSelectors = useMemo(() => {
    const activeLayerIds = activeFile?.id
      ? layerStateIdsForScreen(hiddenLayerIds, activeFile.id)
      : new Set<string>();
    const selectors = Array.from(activeLayerIds)
      .flatMap((layerId) =>
        codeLayerSelectorAliases(activeCodeLayerNodeById.get(layerId)),
      )
      .filter(Boolean);
    if (activeFile?.id && hiddenLayerIds.has(activeFile.id)) {
      selectors.push("body");
    }
    return Array.from(new Set(selectors));
  }, [activeCodeLayerNodeById, activeFile?.id, hiddenLayerIds]);
  const layerSelectorsCacheRef = useRef(
    new WeakMap<
      Set<string>,
      Map<string, { modelRef: unknown; value: string[] }>
    >(),
  );
  const getLayerSelectorsForFile = useCallback(
    (fileId: string, layerIds: Set<string>) => {
      const model = codeLayerModelByFileId.get(fileId);
      let cache = layerSelectorsCacheRef.current.get(layerIds);
      if (!cache) {
        cache = new Map();
        layerSelectorsCacheRef.current.set(layerIds, cache);
      }
      const cached = cache.get(fileId);
      if (cached && cached.modelRef === model) return cached.value;
      const fileLayerIds = layerStateIdsForScreen(layerIds, fileId);
      const selectors = Array.from(fileLayerIds)
        .flatMap((layerId) =>
          codeLayerSelectorAliases(model?.nodeById.get(layerId)),
        )
        .filter(Boolean);
      if (fileLayerIds.has(fileId)) selectors.push("body");
      const value =
        selectors.length > 0 ? Array.from(new Set(selectors)) : NO_SELECTORS;
      cache.set(fileId, { modelRef: model, value });
      return value;
    },
    [codeLayerModelByFileId],
  );
  const visualScreenFileIds = useMemo(
    () => new Set(overviewScreens.map((screen) => screen.id)),
    [overviewScreens],
  );
  const canonicalOverviewScreenIds = useMemo(
    () => getCanonicalScreenStack(overviewScreens, canvasFrameGeometryById),
    [canvasFrameGeometryById, overviewScreens],
  );
  const canonicalVisualFiles = useMemo(() => {
    const visualFileById = new Map(
      files
        .filter((file) => visualScreenFileIds.has(file.id))
        .map((file) => [file.id, file] as const),
    );
    return canonicalOverviewScreenIds
      .map((screenId) => visualFileById.get(screenId))
      .filter((file): file is (typeof files)[number] => Boolean(file));
  }, [canonicalOverviewScreenIds, files, visualScreenFileIds]);
  const layerPanelFiles = useMemo<LayersPanelFile[]>(
    () =>
      canonicalVisualFiles.map((file) => ({
        id: file.id,
        name: prettyScreenName(file.filename),
        filename: file.filename,
        fileType: file.fileType,
        detail: file.filename,
        locked: lockedLayerIds.has(file.id),
        hidden: hiddenLayerIds.has(file.id),
        lockable: true,
        hideable: true,
        renamable: true,
      })),
    [canonicalVisualFiles, hiddenLayerIds, lockedLayerIds],
  );
  const overviewLayerPanelFiles = useMemo<LayersPanelFile[]>(
    () =>
      canonicalVisualFiles.map((file) => {
        const model = codeLayerModelByFileId.get(file.id);
        return {
          id: file.id,
          name: prettyScreenName(file.filename),
          filename: file.filename,
          fileType: file.fileType,
          detail: file.filename,
          locked: lockedLayerIds.has(file.id),
          hidden: hiddenLayerIds.has(file.id),
          lockable: true,
          hideable: true,
          renamable: true,
          childrenPending: !model && screenBodyHasElements(file.content ?? ""),
          layers: cachedCodeLayerTreeToPanelNodes(
            model?.tree ?? [],
            layerStateIdsForScreen(lockedLayerIds, file.id),
            layerStateIdsForScreen(hiddenLayerIds, file.id),
          ),
        };
      }),
    [
      canonicalVisualFiles,
      codeLayerModelByFileId,
      hiddenLayerIds,
      lockedLayerIds,
    ],
  );

  const boardElements = useMemo<LayersPanelNode[] | undefined>(() => {
    if (!boardFileId) return undefined;
    const model = codeLayerModelByFileId.get(boardFileId);
    if (!model?.tree?.length) return undefined;
    const nodes = cachedCodeLayerTreeToPanelNodes(
      model.tree,
      layerStateIdsForScreen(lockedLayerIds, boardFileId),
      layerStateIdsForScreen(hiddenLayerIds, boardFileId),
    );
    return nodes.length > 0 ? nodes : undefined;
  }, [boardFileId, codeLayerModelByFileId, lockedLayerIds, hiddenLayerIds]);

  const designIsEmpty = useMemo(
    () => overviewScreens.length === 0 && (boardElements?.length ?? 0) === 0,
    [boardElements, overviewScreens.length],
  );
  const [chatMessageCount, setChatMessageCount] = useState(0);

  const designAgentSuggestions = useMemo(
    () => [
      t("chat.suggestionLandingPage"),
      t("chat.suggestionBrandMatch"),
      t("chat.suggestionMobile"),
    ],
    [t],
  );
  const designAgentSuggestionConfig = useMemo(
    () => ({
      getSuggestions: (context: AgentDynamicSuggestionContext) =>
        designIsEmpty
          ? designAgentSuggestions
          : buildDynamicAgentSuggestions(context),
    }),
    [designAgentSuggestions, designIsEmpty],
  );

  const activeLayerPanelNodes = useMemo<LayersPanelNode[]>(() => {
    const activeTree = activeFile?.id
      ? (codeLayerModelByFileId.get(activeFile.id)?.tree ?? activeCodeLayerTree)
      : activeCodeLayerTree;
    return cachedCodeLayerTreeToPanelNodes(
      activeTree,
      activeFile?.id
        ? layerStateIdsForScreen(lockedLayerIds, activeFile.id)
        : new Set(),
      activeFile?.id
        ? layerStateIdsForScreen(hiddenLayerIds, activeFile.id)
        : new Set(),
    );
  }, [
    activeCodeLayerTree,
    activeFile?.id,
    codeLayerModelByFileId,
    hiddenLayerIds,
    lockedLayerIds,
  ]);

  const singleBlankScreenLayerPanelFiles = useMemo<
    LayersPanelFile[] | undefined
  >(() => {
    if (viewMode === "overview" || activeLayerPanelNodes.length > 0) {
      return undefined;
    }
    const active = layerPanelFiles.find((file) => file.id === activeFile?.id);
    return active ? [{ ...active, layers: [] }] : undefined;
  }, [activeFile?.id, activeLayerPanelNodes.length, layerPanelFiles, viewMode]);

  const selectedLayerIds = useMemo(() => {
    const activeNodeById = activeFile?.id
      ? codeLayerModelByFileId.get(activeFile.id)?.nodeById
      : undefined;
    const isProjectedLayerId = (layerId: string) =>
      viewMode === "overview"
        ? codeLayerModelsByFile.some((model) => model.nodeById.has(layerId))
        : activeNodeById
          ? activeNodeById.has(layerId)
          : activeCodeLayerProjection.nodes.some((node) => node.id === layerId);
    const extraValidIds = new Set<string>();
    const fileIds = new Set(files.map((file) => file.id));
    const pendingOverviewScreenId = pendingOverviewScreenSelectionRef.current;
    const pendingOverviewLayerId = pendingOverviewLayerSelectionRef.current;
    if (pendingOverviewScreenId) {
      extraValidIds.add(pendingOverviewScreenId);
      fileIds.add(pendingOverviewScreenId);
    }
    if (pendingOverviewLayerId) {
      extraValidIds.add(pendingOverviewLayerId);
    }
    if (createdOverviewLayerSelection) {
      extraValidIds.add(createdOverviewLayerSelection.layerId);
    }
    if (selectedElementLayerId) extraValidIds.add(selectedElementLayerId);
    const validIds = {
      has: (layerId: string) =>
        extraValidIds.has(layerId) ||
        fileIds.has(layerId) ||
        isProjectedLayerId(layerId),
    };
    const selectedStateIds = selectedLayerIdsState.filter((layerId) =>
      validIds.has(layerId),
    );
    const hasOverviewCodeLayerSelection =
      viewMode === "overview" &&
      selectedStateIds.some((layerId) => !fileIds.has(layerId));
    const hasOverviewFileSelection =
      viewMode === "overview" &&
      selectedStateIds.some((layerId) => fileIds.has(layerId));
    const baseSelection =
      viewMode === "overview" && createdOverviewLayerSelection
        ? [createdOverviewLayerSelection.layerId]
        : viewMode === "overview" && !hasOverviewCodeLayerSelection
          ? overviewSelectedScreenIds.length > 0 || !hasOverviewFileSelection
            ? overviewSelectedScreenIds
            : selectedLayerIdsState
          : selectedLayerIdsState;
    const filtered = baseSelection.filter((layerId) => validIds.has(layerId));
    return resolveEffectiveSelectedLayerIds(filtered, selectedElementLayerId);
  }, [
    activeCodeLayerProjection.nodes,
    activeFile?.id,
    codeLayerModelByFileId,
    codeLayerModelsByFile,
    createdOverviewLayerSelection,
    files,
    overviewSelectedScreenIds,
    selectedElementLayerId,
    selectedLayerIdsState,
    viewMode,
  ]);
  const getSingleSelectedRenamableLayerId = useCallback((): string | null => {
    return selectedLayerIds.length === 1 ? selectedLayerIds[0]! : null;
  }, [selectedLayerIds]);
  const selectedLiveLayerIds = useMemo(
    () =>
      selectedLayerIds.filter((layerId) => {
        const owner = codeLayerOwnerByNodeId.get(layerId);
        return Boolean(owner && canEditLiveScreen(owner.fileId));
      }),
    [canEditLiveScreen, codeLayerOwnerByNodeId, selectedLayerIds],
  );
  const canEditSelectedLiveLayer = selectedLiveLayerIds.length > 0;
  const canEditSingleSelectedLiveLayer =
    selectedLiveLayerIds.length === 1 && selectedLayerIds.length === 1;

  const selectedUrlSelectionId = useMemo(
    () =>
      selectedElementLayerId ??
      [...selectedLayerIds]
        .reverse()
        .find((layerId) => codeLayerOwnerByNodeId.has(layerId)) ??
      null,
    [codeLayerOwnerByNodeId, selectedElementLayerId, selectedLayerIds],
  );

  const handleShaderEditCode = useCallback(
    (_shaderId: string) => {
      const targetFileId = activeFile?.id ?? activeFileId;
      if (!targetFileId) return;
      setActiveLeftPanel("code");
      const nextSearch = getDesignEditorStateUrlSearch({
        currentSearch: location.search,
        viewMode,
        screenId: activeFile?.id ?? activeFileId ?? undefined,
        leftPanel: "code",
        codeFileId: targetFileId,
        selectionId: selectedUrlSelectionId,
        zoom,
        tool: activeTool,
        mode,
      });
      if (nextSearch === location.search) return;
      void navigate(
        {
          pathname: location.pathname,
          search: nextSearch,
          hash: location.hash,
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [
      activeFile?.id,
      activeFileId,
      activeTool,
      location.hash,
      location.pathname,
      location.search,
      navigate,
      selectedUrlSelectionId,
      mode,
      viewMode,
      zoom,
    ],
  );
  const selectedLayerIdsRef = useRef<string[]>(selectedLayerIds);

  const selectedElementScreenId = useMemo(() => {
    const ownerFileIds = selectedLayerIds
      .map((layerId) => codeLayerOwnerByNodeId.get(layerId)?.fileId)
      .filter((fileId): fileId is string => Boolean(fileId));
    const first = ownerFileIds[0];
    return first && ownerFileIds.every((fileId) => fileId === first)
      ? first
      : null;
  }, [codeLayerOwnerByNodeId, selectedLayerIds]);

  const selectedLayerTargets = useMemo<SelectedLayerTarget[]>(
    () =>
      selectedLayerIds
        .map((layerId) => {
          const owner = codeLayerOwnerByNodeId.get(layerId);
          if (!owner) return null;
          return {
            layerId,
            fileId: owner.fileId,
            node: owner.node,
            tree: owner.tree,
            elementInfo: elementInfoForOwnedCodeLayerNode({
              info: selectedElement,
              node: owner.node,
              ownerFileId: owner.fileId,
            }),
          };
        })
        .filter((target): target is SelectedLayerTarget => Boolean(target)),
    [
      codeLayerOwnerByNodeId,
      selectedElement,
      selectedElementScreenId,
      selectedLayerIds,
    ],
  );

  const selectedBoardCanvasSelectorCandidates = useMemo(() => {
    const boardTarget = [...selectedLayerTargets]
      .reverse()
      .find((target) => target.fileId === boardFileId);
    return boardTarget
      ? codeLayerSelectorAliases(boardTarget.node)
      : activeFileId === boardFileId
        ? selectedCanvasSelectorCandidates
        : [];
  }, [
    activeFileId,
    boardFileId,
    selectedCanvasSelectorCandidates,
    selectedLayerTargets,
  ]);
  const selectedBoardCanvasSourceId = useMemo(() => {
    const boardTarget = [...selectedLayerTargets]
      .reverse()
      .find((target) => target.fileId === boardFileId);
    return boardTarget
      ? bridgeSourceIdForCodeLayerNode(boardTarget.node)
      : activeFileId === boardFileId
        ? (selectedElement?.runtimeSourceId ??
          selectedElement?.sourceId ??
          null)
        : null;
  }, [
    activeFileId,
    boardFileId,
    selectedElement?.runtimeSourceId,
    selectedElement?.sourceId,
    selectedLayerTargets,
  ]);

  const selectedLayerSelectorGroupsByScreen = useMemo(() => {
    const groupsByScreen: Record<string, string[][]> = {};
    selectedLayerTargets.forEach((target) => {
      const selectorGroup = codeLayerSelectorAliases(target.node);
      if (selectorGroup.length === 0) return;
      groupsByScreen[target.fileId] = [
        ...(groupsByScreen[target.fileId] ?? []),
        selectorGroup,
      ];
    });
    return groupsByScreen;
  }, [selectedLayerTargets]);

  const selectedInspectorElements = useMemo(
    () =>
      selectedLayerTargets.length > 0
        ? selectedLayerTargets.map((target) =>
            withMeasuredGeometry(target.elementInfo, target.fileId),
          )
        : selectedElement
          ? [withMeasuredGeometry(selectedElement, activeFile?.id)]
          : [],
    [selectedElement, selectedLayerTargets],
  );

  const layerPanelSelectedIds = useMemo(
    () =>
      viewMode === "overview" && createdOverviewLayerSelection
        ? [createdOverviewLayerSelection.layerId]
        : selectedLayerIds,
    [createdOverviewLayerSelection, selectedLayerIds, viewMode],
  );

  return {
    initialRouteScreenTarget,
    initialRouteSelectionId,
    layersSearchQuery,
    setLayersSearchQuery,
    shareExportFormat,
    setShareExportFormat,
    codingHandoffPreviewText,
    activeCodeLayerTree,
    recentLayerModelFileIdsRef,
    setCoveredLayerModelFileIds,
    layerModelsCoverAll,
    codeLayerModelsByFile,
    getCodeLayerProjectionForScreenRef,
    getProjectionContentForScreenRef,
    coveredLayerModelFileIdsRef,
    layersSearchQueryRef,
    codeLayerOwnerByNodeId,
    resolvedInitialRouteSelectionId,
    effectiveCodeLayerState,
    lockedLayerSelectors,
    hiddenLayerSelectors,
    getLayerSelectorsForFile,
    visualScreenFileIds,
    canonicalOverviewScreenIds,
    layerPanelFiles,
    overviewLayerPanelFiles,
    boardElements,
    designIsEmpty,
    chatMessageCount,
    setChatMessageCount,
    designAgentSuggestions,
    designAgentSuggestionConfig,
    activeLayerPanelNodes,
    singleBlankScreenLayerPanelFiles,
    selectedLayerIds,
    getSingleSelectedRenamableLayerId,
    canEditSelectedLiveLayer,
    canEditSingleSelectedLiveLayer,
    selectedUrlSelectionId,
    handleShaderEditCode,
    selectedLayerIdsRef,
    selectedElementScreenId,
    selectedLayerTargets,
    selectedBoardCanvasSelectorCandidates,
    selectedBoardCanvasSourceId,
    selectedLayerSelectorGroupsByScreen,
    selectedInspectorElements,
    layerPanelSelectedIds,
  };
}

export type EditorLayerModels = ReturnType<typeof useEditorLayerModels>;
