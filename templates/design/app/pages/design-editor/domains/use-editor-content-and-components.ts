import { useActionQuery, callAction } from "@agent-native/core/client/hooks";
import { reportWriteFailure } from "@agent-native/core/client/write-failure";
import {
  buildCodeLayerProjection,
  type CodeLayerProjection,
} from "@shared/code-layer";
import { linkedComponentRootForNode } from "@shared/component-links";
import {
  isComponentInstance,
  isComponentInstanceForInstanceActions,
  propNameToDataAttribute,
} from "@shared/component-model";
import { readLiteralJsxPropsAtAnchor } from "@shared/local-jsx-visual-edit";
import { sourcePositionPrecision } from "@shared/source-mode";
import { sourceContentHash } from "@shared/source-workspace";
import { useState, useCallback, useRef, useMemo } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { inspectCodeDataForElement } from "@/components/design/edit-panel/inspect-code-source";
import { type InspectCodeData } from "@/components/design/EditPanel";
import { type LocalhostWriteConsentPayload } from "@/components/design/LocalhostWriteConsentDialog";
import type { ScreenProjectionNodeIdentity } from "@/components/design/multi-screen/types";
import {
  waitForShaderWriteToSettle,
  type ShaderSourceTransform,
} from "@/components/design/shader-source-coordination";
import {
  acknowledgeClipboardContentMutation,
  type ClipboardContentMutationPublication,
} from "@/lib/clipboard-content-lineage";

import { getElementOuterHtml } from "../clone-and-pen-edit";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerNodeLooksLikeComponent,
  codeLayerSelectorAliases,
  elementInfoFromCodeLayerNode,
  resolveCodeLayerNodeFromElementInfo,
} from "../code-layer-state";
import { runApplyFileContentUpdate } from "../commands/apply-file-content-update";
import { runApplyLocalContentUpdate } from "../commands/apply-local-content-update";
import {
  createComponentActionChange,
  runCreateComponent,
  type CreateComponentActionResult,
} from "../commands/create-component";
import { runDetachInstanceMenuAction } from "../commands/detach-instance-menu-action";
import {
  createLinkedComponentMutationQueue,
  projectLinkedComponentPropertyEdit,
  type LinkedComponentActionResult,
  type LinkedComponentMutationQueueArgs,
} from "../commands/linked-component-mutation";
import { resolveLinkedComponentSelection } from "../commands/linked-component-structure";
import { runOverviewPrimitiveReparent } from "../commands/overview-primitive-reparent";
import { runShaderSourceEdit } from "../commands/shader-source-edit";
import { runtimeMultiplicityForElementProvenance } from "../editor-helpers";
import { createPersistedContentHostSyncHandler } from "../editor-state";
import {
  type ContentHistorySelectionAfterMap,
  reserveLinkedComponentContentHistory,
} from "../history";
import {
  isLocalhostWriteConsentError,
  type LocalhostWriteConsentRequestOutcome,
} from "../localhost-consent-request";
import { projectRelativeSourcePath } from "../pending-edits";
import { isScreenRootElementInfo } from "../selection-state";
import { SOURCE_HYDRATION_MAX_BYTES } from "../source-hydration";
import {
  resolveSourceBaseForPublication,
  prepareCanonicalSourceContent,
} from "../source-publication";
import type { EditorActiveScreenAndGeometry } from "./use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "./use-editor-canvas-and-screens";
import type { EditorCore } from "./use-editor-core";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";
import type { EditorLiveEditsAndPresence } from "./use-editor-live-edits-and-presence";

type RequestLocalhostWrite = (opts: {
  connectionId?: string;
  files: string[];
  onGranted: LocalhostWriteConsentPayload["onGranted"];
  onCancel?: () => void;
  onError?: LocalhostWriteConsentPayload["onError"];
}) => LocalhostWriteConsentRequestOutcome;

type LinkedComponentQueueRuntime = Omit<
  LinkedComponentMutationQueueArgs,
  "fileSaveChainsRef" | "pendingFileSavesRef"
>;

class LinkedSourceSizeLimitError extends Error {}

export function useEditorContentAndComponents({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorLiveEditsAndPresence,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorCanvasAndScreens: EditorCanvasAndScreens;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
}) {
  const {
    t,
    id,
    queryClient,
    setMode,
    viewModeRef,
    selectedElement,
    setSelectedElement,
    hoveredElement,
    activeFileId,
    activeFileIdRef,
  } = editorCore;
  const {
    setActiveLeftPanel,
    setMinimalUi,
    setSelectedLayerIdsState,
    invalidateRenderedElementInfo,
    overviewSelectedScreenIds,
    pendingOverviewLayerSelectionRef,
    latestClipboardMutationContentRef,
    activeBreakpointWidthState,
    undoManagerRef,
    linkedComponentMutationQueueRef,
    contentUndoStackRef,
    contentUndoSelectionStackRef,
    historyOrderRef,
    clearRedoStacks,
    captureCurrentSelection,
    syncUndoRedoState,
    recordContentHistoryEntry,
    recordLocalContentHistoryEntry,
    recordLocalContentHistoryChangeFallback,
  } = editorHistory;
  const {
    restoreSelectionSnapshot,
    sourceMetadata,
    sourceLoader,
    leaseSources,
    canEditDesign,
    canEditDesignRef,
    rawServerFilesByIdRef,
    pendingLocalFileContentsRef,
    markPendingLocalFileContent,
    clearPendingLocalFileContent,
    goToMainComponentMutation,
    detachComponentInstanceMutation,
  } = editorGenerationAndAccess;
  const {
    pendingFileSavesRef,
    fileSaveChainsRef,
    latestFileSaveForUnloadRef,
    fileSaveTimersRef,
    cancelQueuedFileContentSave,
    queueFileContentSave,
    flushPendingFileContentSavesForBackground,
    files,
    codeLayerSourceForScreen,
    runtimeLayerSnapshotsById,
    boardFileId,
    overviewScreens,
  } = editorFilesAndSaving;
  const { activeFile, activeOverviewScreen, activeCanvasSourceType } =
    editorActiveScreenAndGeometry;
  const {
    localhostConnectionRootPathByIdRef,
    ydoc,
    isSynced,
    overviewPresenceFileId,
    overviewYdoc,
    overviewIsSynced,
    setCollabContent,
    setCollabContentFileId,
    lastLocalContentRef,
    latestActiveContentRef,
    activeContent,
    getUnprojectedScreenContent,
    getScreenContent,
  } = editorCanvasAndScreens;
  const {
    setContentRenderRevision,
    collabContentRef,
    collabContentFileIdRef,
    activeCodeLayerProjection,
    selectedCodeLayerNode,
    selectedElementLayerId,
    selectedCanvasSelector,
    replacePreviewContent,
  } = editorLiveEditsAndPresence;
  const requestLocalhostWriteRef = useRef<RequestLocalhostWrite | null>(null);
  const [uiHidden, setUiHidden] = useState(false);
  const contentHistorySelectionAfterRef =
    useRef<ContentHistorySelectionAfterMap>(new WeakMap());
  const suppressContentHistoryRef = useRef(false);
  const [componentSwapPickerRequest, setComponentSwapPickerRequest] =
    useState(0);

  const canApplyContentEdit = useCallback(
    (fileId: string) => {
      const linkedQueue = linkedComponentMutationQueueRef.current;
      if (
        !linkedQueue ||
        linkedQueue.designId !== id ||
        !linkedQueue.queue.blocksLocalContentEdits()
      ) {
        return true;
      }
      toast.info(t("visualEditor.saving"), {
        id: `design-source-linked-edit-pending:${fileId}`,
      });
      return false;
    },
    [id, t],
  );
  const selectedInstanceActionNodeId = useMemo(() => {
    if (!selectedCodeLayerNode) return undefined;
    return isComponentInstanceForInstanceActions(selectedCodeLayerNode)
      ? bridgeSourceIdForCodeLayerNode(selectedCodeLayerNode)
      : undefined;
  }, [selectedCodeLayerNode]);
  const selectedElementAlreadyComponent = useMemo(() => {
    if (!selectedElement) return false;
    if (
      selectedElement.runtimeComponent &&
      !(selectedCodeLayerNode && isComponentInstance(selectedCodeLayerNode))
    ) {
      return false;
    }
    if (selectedElement.componentAnnotation?.trim()) return true;
    if (selectedElement.componentName?.trim()) return true;
    return codeLayerNodeLooksLikeComponent(selectedCodeLayerNode);
  }, [selectedCodeLayerNode, selectedElement]);
  const selectedElementInsideComponent = useMemo(() => {
    if (!selectedCodeLayerNode) return false;
    const root = linkedComponentRootForNode(
      selectedCodeLayerNode,
      activeCodeLayerProjection,
    );
    return Boolean(root && root.id !== selectedCodeLayerNode.id);
  }, [activeCodeLayerProjection, selectedCodeLayerNode]);

  const defaultComponentName = useMemo(() => {
    if (selectedCodeLayerNode?.layerName)
      return selectedCodeLayerNode.layerName;
    if (selectedElement?.tagName) {
      const tag = selectedElement.tagName;
      return tag.charAt(0).toUpperCase() + tag.slice(1);
    }
    return "Component";
  }, [selectedCodeLayerNode?.layerName, selectedElement?.tagName]);

  const selectedComponentLocalSourceAnchor = useMemo(() => {
    if (
      activeCanvasSourceType !== "localhost" ||
      selectedElement?.runtimeComponent?.writeCapability !==
        "authored-jsx-literal"
    ) {
      return undefined;
    }
    const connectionId =
      (activeOverviewScreen as { connectionId?: string } | undefined)
        ?.connectionId ?? "";
    const runtimeComponent = selectedElement.runtimeComponent;
    const sourcePath = projectRelativeSourcePath({
      sourceFile: runtimeComponent.sourceFile,
      rootPath: connectionId
        ? localhostConnectionRootPathByIdRef.current.get(connectionId)
        : undefined,
    });
    if (
      !connectionId ||
      !sourcePath ||
      !runtimeComponent.line ||
      !runtimeComponent.column
    )
      return undefined;
    const runtimeMultiplicity = runtimeMultiplicityForElementProvenance(
      runtimeLayerSnapshotsById,
      selectedElement,
    );
    return {
      connectionId,
      path: sourcePath,
      line: runtimeComponent.line,
      column: runtimeComponent.column,
      positionPrecision: sourcePositionPrecision(runtimeComponent.method),
      runtimeMultiplicity,
      scope:
        runtimeMultiplicity === 1
          ? ("single-instance" as const)
          : ("repeated-render" as const),
    };
  }, [
    activeCanvasSourceType,
    activeOverviewScreen,
    runtimeLayerSnapshotsById,
    selectedElement,
  ]);

  const { data: selectedComponentSource } = useActionQuery<{
    versionHash?: string;
    content?: string;
  }>(
    "read-local-file",
    {
      designId: id ?? "",
      connectionId: selectedComponentLocalSourceAnchor?.connectionId ?? "",
      path: selectedComponentLocalSourceAnchor?.path ?? "",
    },
    {
      enabled: Boolean(
        id && selectedComponentLocalSourceAnchor && canEditDesign,
      ),
      refetchOnMount: "always",
    },
  );

  const selectedComponentLiteralProps = useMemo(() => {
    if (
      !selectedComponentLocalSourceAnchor ||
      typeof selectedComponentSource?.content !== "string"
    ) {
      return undefined;
    }
    const literalProps = readLiteralJsxPropsAtAnchor({
      content: selectedComponentSource.content,
      anchor: selectedComponentLocalSourceAnchor,
    });
    return literalProps?.filter(
      ({ name }) =>
        !name.startsWith("data-agent-native-") &&
        name !== "style" &&
        name !== "className",
    );
  }, [selectedComponentLocalSourceAnchor, selectedComponentSource?.content]);

  const selectedComponentLocalSource = useMemo(() => {
    if (!selectedComponentLocalSourceAnchor) return undefined;
    const expectedVersionHash = selectedComponentSource?.versionHash;
    if (!expectedVersionHash) return undefined;
    const propStamps = (selectedComponentLiteralProps ?? []).map(
      ({ name, value }) => ({
        name: propNameToDataAttribute(name),
        value,
      }),
    );
    return {
      ...selectedComponentLocalSourceAnchor,
      expectedVersionHash,
      ...(propStamps.length > 0 ? { propStamps } : {}),
    };
  }, [
    selectedComponentLocalSourceAnchor,
    selectedComponentSource?.versionHash,
    selectedComponentLiteralProps,
  ]);

  const inspectCodeData = useMemo<InspectCodeData | undefined>(() => {
    if (!selectedElement) return undefined;
    const selector = selectedElement.selector;
    let html: string | null | undefined;
    // Parses the whole screen; only the open code popover and Code tab read it.
    return {
      ...inspectCodeDataForElement(selectedElement, undefined),
      get html() {
        if (html === undefined) {
          html = selector ? getElementOuterHtml(activeContent, selector) : null;
        }
        return html;
      },
    };
  }, [activeContent, selectedElement]);

  const handleCreateComponent = useCallback(
    (name: string) => {
      if (
        !canEditDesign ||
        !id ||
        !activeFileId ||
        !selectedElement ||
        selectedElementInsideComponent
      )
        return;
      if (
        activeCanvasSourceType === "localhost" &&
        selectedElement.runtimeComponent?.writeCapability ===
          "authored-jsx-literal" &&
        !selectedComponentLocalSource
      ) {
        toast.error(t("designEditor.toasts.componentCreateFailed"));
        return;
      }
      const current = linkedComponentMutationQueueRef.current;
      if (current?.designId !== id) return;
      const nodeId = selectedElementLayerId ?? undefined;
      const selector = selectedCanvasSelector ?? selectedElement.selector;
      const run = (retriedAfterConsent = false) =>
        runCreateComponent(
          {
            canEditDesign,
            designId: id,
            fileId: activeFileId,
            selectionBefore: captureCurrentSelection(),
            createComponent: (request) =>
              callAction<CreateComponentActionResult>(
                "create-component",
                request,
              ),
            mutationTransaction: {
              enqueue: (request) =>
                current.queue.enqueueSourceMutation({
                  ...request,
                  validate: createComponentActionChange,
                }),
            },
          },
          {
            nodeId,
            selector,
            name,
            ...(selectedComponentLocalSource
              ? { source: { local: selectedComponentLocalSource } }
              : {}),
          },
        )
          .then((outcome) => {
            if (!outcome) return;
            const source = outcome.result.source;
            if (source) {
              queryClient.setQueryData(
                [
                  "action",
                  "read-local-file",
                  {
                    designId: id,
                    connectionId: source.connectionId,
                    path: source.path,
                  },
                ],
                (previous: { versionHash?: string } | undefined) => ({
                  ...previous,
                  versionHash: source.versionHash,
                }),
              );
            }
            if (!outcome.historyRecorded) {
              toast.error(t("designEditor.toasts.componentCreateFailed"));
              return;
            }
            if (outcome.hostSync === "accepted") {
              toast.success(t("designEditor.toasts.componentCreated"));
            }
          })
          .catch((error: unknown) => {
            if (
              !retriedAfterConsent &&
              selectedComponentLocalSource &&
              isLocalhostWriteConsentError(error)
            ) {
              requestLocalhostWriteRef.current?.({
                files: [selectedComponentLocalSource.path],
                onGranted: () => run(true),
              });
              return;
            }
            reportWriteFailure(error, {
              label: t("designEditor.toasts.componentCreateFailed"),
            });
          });
      void run();
    },
    [
      canEditDesign,
      activeCanvasSourceType,
      captureCurrentSelection,
      id,
      selectedElement,
      selectedElementLayerId,
      selectedCanvasSelector,
      activeFileId,
      selectedElementInsideComponent,
      selectedComponentLocalSource,
      queryClient,
      t,
    ],
  );

  const handleCreateComponentHotkey = useCallback(() => {
    if (
      !canEditDesign ||
      !id ||
      !selectedElement ||
      selectedElementAlreadyComponent ||
      selectedElementInsideComponent
    ) {
      return;
    }
    handleCreateComponent(defaultComponentName);
  }, [
    canEditDesign,
    id,
    selectedElement,
    selectedElementAlreadyComponent,
    selectedElementInsideComponent,
    handleCreateComponent,
    defaultComponentName,
  ]);

  const hoveredCodeLayerNode = useMemo(() => {
    if (!hoveredElement) return null;
    if (isScreenRootElementInfo(hoveredElement)) return null;
    return resolveCodeLayerNodeFromElementInfo(
      activeCodeLayerProjection,
      hoveredElement,
    );
  }, [activeCodeLayerProjection, hoveredElement]);
  const hoveredCanvasSelectorCandidates = useMemo(() => {
    const runtimeSelector = hoveredElement?.runtimeSelector?.trim();
    const runtimeCandidates = runtimeSelector ? [runtimeSelector] : [];
    if (isScreenRootElementInfo(hoveredElement)) return [];
    if (hoveredCodeLayerNode) {
      return Array.from(
        new Set([
          ...runtimeCandidates,
          ...codeLayerSelectorAliases(hoveredCodeLayerNode),
        ]),
      );
    }
    return runtimeCandidates.concat(
      hoveredElement?.selector && hoveredElement.selector !== runtimeSelector
        ? [hoveredElement.selector]
        : [],
    );
  }, [hoveredCodeLayerNode, hoveredElement]);
  const hoveredCanvasSelector = hoveredCanvasSelectorCandidates[0] ?? null;
  const runtimeProjectionCacheRef = useRef<
    Map<string, { contentRef: string; projection: CodeLayerProjection }>
  >(new Map());
  const getRuntimeCodeLayerProjection = useCallback(
    (screenId: string, content: string): CodeLayerProjection => {
      const cache = runtimeProjectionCacheRef.current;
      const cached = cache.get(screenId);
      if (cached && cached.contentRef === content) return cached.projection;
      const projection = buildCodeLayerProjection(content, {
        source: codeLayerSourceForScreen(screenId, "inline-html"),
      });
      cache.set(screenId, { contentRef: content, projection });
      return projection;
    },
    [codeLayerSourceForScreen],
  );

  const acknowledgeAuthoritativeClipboardMutation = useCallback(
    (args: {
      fileId: string;
      nextContent: string;
      publication?: ClipboardContentMutationPublication;
    }) => {
      const nextLineage = acknowledgeClipboardContentMutation({
        current: latestClipboardMutationContentRef.current.get(args.fileId),
        nextContent: args.nextContent,
        nextContentHash: sourceContentHash(args.nextContent),
        publication: args.publication,
      });
      if (nextLineage) {
        latestClipboardMutationContentRef.current.set(args.fileId, nextLineage);
      }
    },
    [],
  );

  const sourceBaseForPublication = useCallback(
    (fileId: string, beforeContent: string) => {
      const pending = pendingLocalFileContentsRef.current.get(fileId);
      return resolveSourceBaseForPublication({
        fileId,
        fileType: rawServerFilesByIdRef.current.get(fileId)?.fileType,
        pending,
        collabContent:
          collabContentFileIdRef.current === fileId
            ? collabContentRef.current
            : null,
        persistedContent: rawServerFilesByIdRef.current.get(fileId)?.content,
        beforeContent,
      });
    },
    [],
  );

  const applyLocalContentUpdate = useCallback(
    (
      nextContent: string,
      options: {
        refreshPreview?: boolean;
        skipPreview?: boolean;
        forcePreviewFullDocument?: boolean;
        allowPreviewNodeSwap?: boolean;
        immediateSave?: boolean;
        awaitSave?: boolean;
        persist?: boolean;
        previewOnly?: boolean;
        recordHistory?: boolean;
        historyBeforeContent?: string;
        sourceBaseContent?: string;
        identityMigrationSourceContent?: string;
        shaderWriteCompletion?: true;
        updatedAt?: string;
        clipboardMutation?: ClipboardContentMutationPublication;
        serverAccepted?: boolean;
      } = {},
    ) => {
      if (!activeFile) return { status: "refused" as const };
      if (options.persist !== false && !canApplyContentEdit(activeFile.id)) {
        return { status: "refused" as const };
      }
      const result = runApplyLocalContentUpdate(
        {
          acknowledgeAuthoritativeClipboardMutation,
          activeFile,
          canEditDesignRef,
          cancelQueuedFileContentSave,
          clearPendingLocalFileContent,
          collabContentFileIdRef,
          collabContentRef,
          id,
          isSynced,
          lastLocalContentRef,
          latestActiveContentRef,
          markPendingLocalFileContent,
          primeAcceptedSource: (fileId, source) =>
            sourceLoader?.prime(fileId, source),
          queryClient,
          queueFileContentSave,
          recordContentHistoryEntry,
          recordLocalContentHistoryChangeFallback,
          recordLocalContentHistoryEntry,
          replacePreviewContent,
          setCollabContent,
          setCollabContentFileId,
          setContentRenderRevision,
          suppressContentHistoryRef,
          t,
          undoManagerRef,
          viewModeRef,
          ydoc,
        },
        nextContent,
        {
          ...options,
          sourceBaseContent:
            options.sourceBaseContent ??
            sourceBaseForPublication(
              activeFile.id,
              options.historyBeforeContent ?? getScreenContent(activeFile.id),
            ),
        },
      );
      if (result.status === "accepted") invalidateRenderedElementInfo();
      return result;
    },
    [
      sourceBaseForPublication,
      canApplyContentEdit,
      getScreenContent,
      activeFile,
      acknowledgeAuthoritativeClipboardMutation,
      cancelQueuedFileContentSave,
      clearPendingLocalFileContent,
      id,
      isSynced,
      markPendingLocalFileContent,
      sourceLoader,
      queryClient,
      queueFileContentSave,
      replacePreviewContent,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      recordLocalContentHistoryChangeFallback,
      syncUndoRedoState,
      t,
      ydoc,
      invalidateRenderedElementInfo,
    ],
  );

  const applyFileContentUpdate = useCallback(
    (
      fileId: string,
      nextContent: string,
      options: {
        refreshPreview?: boolean;
        skipPreview?: boolean;
        forcePreviewFullDocument?: boolean;
        immediateSave?: boolean;
        awaitSave?: boolean;
        persist?: boolean;
        previewOnly?: boolean;
        recordHistory?: boolean;
        historyBeforeContent?: string;
        sourceBaseContent?: string;
        identityMigrationSourceContent?: string;
        deferWhenLinkedMutationPending?: boolean;
        shaderWriteCompletion?: true;
        updatedAt?: string;
        clipboardMutation?: ClipboardContentMutationPublication;
        serverAccepted?: boolean;
      } = {},
    ) => {
      if (!activeFile) return { status: "refused" as const };
      if (options.persist !== false && !canApplyContentEdit(fileId)) {
        return options.deferWhenLinkedMutationPending
          ? { status: "deferred" as const }
          : { status: "refused" as const };
      }
      const result = runApplyFileContentUpdate(
        {
          acknowledgeAuthoritativeClipboardMutation,
          activeFile,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          canEditDesignRef,
          cancelQueuedFileContentSave,
          clearPendingLocalFileContent,
          files,
          getScreenContent,
          id,
          markPendingLocalFileContent,
          primeAcceptedSource: (fileId, source) =>
            sourceLoader?.prime(fileId, source),
          overviewIsSynced,
          overviewPresenceFileId,
          overviewYdoc,
          queryClient,
          queueFileContentSave,
          recordContentHistoryEntry,
          suppressContentHistoryRef,
          t,
        },
        fileId,
        nextContent,
        {
          ...options,
          sourceBaseContent:
            options.sourceBaseContent ??
            sourceBaseForPublication(
              fileId,
              options.historyBeforeContent ?? getScreenContent(fileId),
            ),
        },
      );
      if (result.status === "accepted") invalidateRenderedElementInfo();
      return result;
    },
    [
      sourceBaseForPublication,
      canApplyContentEdit,
      getScreenContent,
      activeFile?.id,
      acknowledgeAuthoritativeClipboardMutation,
      applyLocalContentUpdate,
      cancelQueuedFileContentSave,
      clearPendingLocalFileContent,
      files,
      id,
      markPendingLocalFileContent,
      sourceLoader,
      overviewIsSynced,
      overviewPresenceFileId,
      overviewYdoc,
      queryClient,
      queueFileContentSave,
      recordContentHistoryEntry,
      t,
      invalidateRenderedElementInfo,
    ],
  );

  const applyFileContentUpdateRef = useRef(applyFileContentUpdate);
  applyFileContentUpdateRef.current = applyFileContentUpdate;
  const getScreenContentRef = useRef(getScreenContent);
  getScreenContentRef.current = getScreenContent;
  const linkedComponentQueueRuntimeRef =
    useRef<LinkedComponentQueueRuntime | null>(null);
  linkedComponentQueueRuntimeRef.current = id
    ? {
        designId: id,
        sourceSetChangedMessage: t("common.genericError"),
        fileIds: () =>
          sourceMetadata
            .filter((file) => file.fileType === "html")
            .map((file) => file.id),
        canProject: (fileIds) => {
          const readyIds = new Set(files.map((file) => file.id));
          return fileIds.every((fileId) => readyIds.has(fileId));
        },
        prepareSources: async (fileIds) => {
          if (!sourceLoader) throw new Error(t("common.genericError"));
          const metadata = await callAction<{
            files: Array<{ id: string; contentBytes?: number | null }>;
          }>(
            "get-design",
            { id, includeFileContent: false },
            { method: "GET" },
          );
          const sizes = new Map(
            metadata.files.map((file) => [file.id, file.contentBytes]),
          );
          const encoder = new TextEncoder();
          let estimatedBytes = 0;
          for (const fileId of fileIds) {
            const size = sizes.get(fileId);
            if (
              typeof size !== "number" ||
              !Number.isSafeInteger(size) ||
              size < 0
            )
              throw new Error(t("common.genericError"));
            const pending = pendingLocalFileContentsRef.current.get(fileId);
            const state = sourceLoader.get(fileId);
            const known =
              pending?.content ??
              (state.status === "ready" ? state.content : undefined);
            estimatedBytes += Math.max(
              size,
              known === undefined ? 0 : encoder.encode(known).byteLength,
            );
          }
          if (estimatedBytes > SOURCE_HYDRATION_MAX_BYTES)
            throw new LinkedSourceSizeLimitError(
              t("common.linkedSourceSizeLimit"),
            );
          let release: (() => void) | undefined;
          try {
            release = await leaseSources(fileIds);
            let actualBytes = 0;
            for (const fileId of fileIds) {
              const state = sourceLoader.get(fileId);
              if (state.status !== "ready")
                throw new Error(t("common.genericError"));
              const pending = pendingLocalFileContentsRef.current.get(fileId);
              actualBytes += encoder.encode(
                pending?.content ?? state.content,
              ).byteLength;
              if (actualBytes > SOURCE_HYDRATION_MAX_BYTES)
                throw new LinkedSourceSizeLimitError(
                  t("common.linkedSourceSizeLimit"),
                );
            }
            return release;
          } catch (error) {
            release?.();
            throw Object.assign(
              new Error(
                error instanceof LinkedSourceSizeLimitError
                  ? error.message
                  : t("common.genericError"),
              ),
              {
                cause: error,
              },
            );
          }
        },
        getContent: getUnprojectedScreenContent,
        getSourceBaseContent: (fileId) =>
          sourceBaseForPublication(fileId, getUnprojectedScreenContent(fileId)),
        projectEdit: (fileId, nodeId, edit, contentByFileId) =>
          projectLinkedComponentPropertyEdit({
            documents: files
              .filter((file) => file.fileType === "html")
              .map((file) => ({
                source: {
                  kind: "design-file" as const,
                  designId: id,
                  fileId: file.id,
                  filename: file.filename,
                },
                content: contentByFileId.get(file.id) ?? "",
              })),
            fileId,
            nodeId,
            edit,
          }),
        canonicalizeSourceContent: (fileId, content) =>
          prepareCanonicalSourceContent(content, {
            fileId,
            fileType: rawServerFilesByIdRef.current.get(fileId)?.fileType,
          }).content,
        flushPendingSaves: flushPendingFileContentSavesForBackground,
        hasPendingSave: (fileId) =>
          Boolean(
            pendingFileSavesRef.current[fileId] ||
            fileSaveTimersRef.current[fileId],
          ),
        getPendingSave: (fileId) => latestFileSaveForUnloadRef.current[fileId],
        invokeAction: (payload) =>
          callAction<LinkedComponentActionResult>(
            "apply-component-prop-edit",
            payload as any,
          ),
        applyFileContentUpdate: (fileId, content, options) =>
          applyFileContentUpdate(fileId, content, options),
        applySelection: (selection) => applyLinkedComponentSelection(selection),
        getCurrentSelection: captureCurrentSelection,
        reserveContentHistory: (selectionBefore) => {
          undoManagerRef.current?.stopCapturing();
          const reservation = reserveLinkedComponentContentHistory({
            stack: contentUndoStackRef,
            selections: contentUndoSelectionStackRef,
            order: historyOrderRef,
            selection: selectionBefore ?? captureCurrentSelection(),
            after: contentHistorySelectionAfterRef,
            clearRedoStacks,
          });
          syncUndoRedoState();
          return reservation;
        },
        waitForHostWrites: async (fileIds) => {
          await Promise.all(fileIds.map(waitForShaderWriteToSettle));
        },
        syncUndoRedoState,
        refreshAfterConflict: () =>
          queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          }),
        reportFailure: (message) =>
          toast.error(message, {
            id: `linked-component:${id}`,
            duration: 4000,
          }),
      }
    : null;
  if (id && linkedComponentMutationQueueRef.current?.designId !== id) {
    const currentRuntime = (): LinkedComponentQueueRuntime => {
      const runtime = linkedComponentQueueRuntimeRef.current;
      if (!runtime || runtime.designId !== id) {
        throw new Error(
          "The design changed while this component edit was running.",
        );
      }
      return runtime;
    };
    const currentRuntimeIfActive = (): LinkedComponentQueueRuntime | null => {
      const runtime = linkedComponentQueueRuntimeRef.current;
      return runtime?.designId === id ? runtime : null;
    };
    linkedComponentMutationQueueRef.current = {
      designId: id,
      queue: createLinkedComponentMutationQueue({
        designId: id,
        sourceSetChangedMessage: t("common.genericError"),
        fileIds: () => currentRuntime().fileIds(),
        canProject: (fileIds) => currentRuntime().canProject?.(fileIds) ?? true,
        prepareSources: (fileIds) => {
          const prepare = currentRuntime().prepareSources;
          if (!prepare) throw new Error(t("common.genericError"));
          return prepare(fileIds);
        },
        getContent: (fileId) => currentRuntime().getContent(fileId),
        getSourceBaseContent: (fileId) =>
          currentRuntime().getSourceBaseContent(fileId),
        projectEdit: (fileId, nodeId, edit, contentByFileId) =>
          currentRuntime().projectEdit?.(
            fileId,
            nodeId,
            edit,
            contentByFileId,
          ) ?? null,
        canonicalizeSourceContent: (fileId, content) =>
          currentRuntime().canonicalizeSourceContent(fileId, content),
        flushPendingSaves: () => currentRuntime().flushPendingSaves(),
        hasPendingSave: (fileId) => currentRuntime().hasPendingSave(fileId),
        getPendingSave: (fileId) => currentRuntime().getPendingSave(fileId),
        fileSaveChainsRef,
        pendingFileSavesRef,
        invokeAction: (payload) => currentRuntime().invokeAction(payload),
        applyFileContentUpdate: (fileId, content, options) =>
          currentRuntime().applyFileContentUpdate(fileId, content, options),
        applySelection: (selection) =>
          currentRuntime().applySelection?.(selection),
        getCurrentSelection: () => currentRuntime().getCurrentSelection(),
        reserveContentHistory: (selectionBefore) =>
          currentRuntime().reserveContentHistory(selectionBefore),
        waitForHostWrites: (fileIds) =>
          currentRuntime().waitForHostWrites(fileIds),
        syncUndoRedoState: () => currentRuntimeIfActive()?.syncUndoRedoState(),
        refreshAfterConflict: () =>
          currentRuntimeIfActive()?.refreshAfterConflict(),
        reportFailure: (message) =>
          currentRuntimeIfActive()?.reportFailure(message),
      }),
    };
  }

  const handleComponentPropApplied = useMemo(
    () =>
      createPersistedContentHostSyncHandler({
        activeFileIdRef,
        applyFileContentUpdateRef,
      }),
    [],
  );
  const handleShaderSourceApplied = useMemo(
    () =>
      createPersistedContentHostSyncHandler({
        activeFileIdRef,
        applyFileContentUpdateRef,
        shaderWriteCompletion: true,
      }),
    [],
  );
  // The board cannot go through the source actions the picker uses for
  // screens, so a shader edit on a frame drawn there is made here.
  const handleShaderSourceEdit = useCallback(
    (fileId: string, transform: ShaderSourceTransform) =>
      runShaderSourceEdit(
        {
          getScreenContent: (id) => getScreenContentRef.current(id),
          applyFileContentUpdate: (id, content, options) =>
            applyFileContentUpdateRef.current(id, content, options),
          saveFailedMessage: t("editPanel.shaders.saveFailed"),
        },
        fileId,
        transform,
      ),
    [t],
  );

  const applyLinkedComponentSelection = useCallback(
    (
      selection: { fileId: string; nodeIds: string[] },
      hydratedContent?: string,
    ) => {
      const file = files.find((candidate) => candidate.id === selection.fileId);
      if (
        (!file || file.sourceState === "error") &&
        hydratedContent === undefined
      ) {
        throw new Error(t("common.genericError"));
      }
      const content =
        file && file.sourceState !== "error"
          ? getScreenContent(selection.fileId)
          : hydratedContent;
      if (content === undefined) throw new Error(t("common.genericError"));
      const { snapshot, nodes } = resolveLinkedComponentSelection({
        ...selection,
        content,
        previous: captureCurrentSelection(),
      });
      flushSync(() => {
        restoreSelectionSnapshot(snapshot);
        setSelectedElement(
          nodes.length === 1 ? elementInfoFromCodeLayerNode(nodes[0]!) : null,
        );
        pendingOverviewLayerSelectionRef.current =
          nodes.length === 1 ? nodes[0]!.id : null;
      });
      return snapshot;
    },
    [
      captureCurrentSelection,
      id,
      pendingOverviewLayerSelectionRef,
      files,
      getScreenContent,
      t,
      restoreSelectionSnapshot,
      setSelectedElement,
    ],
  );

  const selectLinkedComponentNode = useCallback(
    async (target: { fileId: string; nodeId: string }) => {
      const releaseSource = sourceLoader?.lease(target.fileId);
      try {
        await sourceLoader?.request(target.fileId);
        const state = sourceLoader?.get(target.fileId);
        if (state?.status !== "ready" || state.refreshError)
          throw new Error(t("common.genericError"));
        applyLinkedComponentSelection(
          { fileId: target.fileId, nodeIds: [target.nodeId] },
          state.content,
        );
      } catch {
        toast.error(t("designEditor.componentInstances.resolveMainFailed"));
      } finally {
        releaseSource?.();
      }
    },
    [applyLinkedComponentSelection, sourceLoader, t],
  );

  const handleOpenLibraryComponent = selectLinkedComponentNode;

  const handleGoToMainComponentMenuAction = useCallback(() => {
    if (!id || !selectedInstanceActionNodeId) return;
    goToMainComponentMutation.mutate(
      {
        designId: id,
        nodeId: selectedInstanceActionNodeId,
        fileId: activeFileId ?? undefined,
      },
      {
        onSuccess: async (result: {
          isMain?: boolean;
          ctaRequired?: boolean;
          ctaMessage?: string;
          note?: string;
          main?: { fileId: string; nodeId: string };
        }) => {
          if (result.ctaRequired) {
            toast.error(
              result.ctaMessage ??
                t("designEditor.componentInstances.goToMainUnavailable"),
            );
            return;
          }
          if (result.isMain) {
            toast(
              result.note ??
                t("designEditor.componentInstances.onlyKnownInstance"),
            );
            return;
          }
          // The action's navigation request only moves the camera; the
          // selection has to be applied here.
          if (!result.main) {
            toast.error(t("designEditor.componentInstances.resolveMainFailed"));
            return;
          }
          await selectLinkedComponentNode(result.main);
        },
        onError: () =>
          toast.error(t("designEditor.componentInstances.resolveMainFailed")),
      },
    );
  }, [
    activeFileId,
    goToMainComponentMutation,
    id,
    selectLinkedComponentNode,
    selectedInstanceActionNodeId,
    sourceLoader,
    t,
  ]);

  const handleDetachInstanceMenuAction = useCallback(() => {
    if (!activeFile) return;
    return runDetachInstanceMenuAction({
      activeContent,
      activeFile,
      activeFileId,
      detachComponentInstanceMutation,
      handleComponentPropApplied,
      id,
      selectedComponentNodeId: selectedInstanceActionNodeId,
      t,
    });
  }, [
    activeFileId,
    activeContent,
    activeFile?.updatedAt,
    detachComponentInstanceMutation,
    handleComponentPropApplied,
    id,
    selectedInstanceActionNodeId,
    t,
  ]);

  const handleSwapInstanceMenuAction = useCallback(() => {
    if (!id || !selectedInstanceActionNodeId) return;
    setUiHidden(false);
    setMode("edit");
    setComponentSwapPickerRequest((request) => request + 1);
  }, [id, selectedInstanceActionNodeId]);

  const handleToggleMinimalUi = useCallback(() => {
    setMinimalUi((current) => !current);
    setUiHidden(false);
  }, []);

  const handleOverviewPrimitiveReparent = useCallback(
    (arg0: {
      sourceNodeId: string;
      sourceScreenId: string;
      targetNodeId: string;
      targetScreenId: string;
      targetIdentity?: ScreenProjectionNodeIdentity;
      preparedTargetNodeId?: string;
      placement?: "before" | "after" | "inside";
    }) =>
      runOverviewPrimitiveReparent(
        {
          activeBreakpointWidthState,
          activeFileId,
          overviewSelectedScreenIds,
          contentUndoStackRef,
          contentHistorySelectionAfterRef,
          applyFileContentUpdate,
          boardFileId,
          canEditDesign,
          getScreenContent,
          overviewScreens,
          recordContentHistoryEntry,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
        },
        arg0,
      ),
    [
      activeFileId,
      overviewSelectedScreenIds,
      activeBreakpointWidthState,
      applyFileContentUpdate,
      boardFileId,
      canEditDesign,
      getScreenContent,
      overviewScreens,
      recordContentHistoryEntry,
      t,
    ],
  );

  const handleShowAssetsPanel = useCallback(() => {
    setMinimalUi(false);
    setUiHidden(false);
    setActiveLeftPanel("assets");
  }, []);

  return {
    requestLocalhostWriteRef,
    uiHidden,
    setUiHidden,
    contentHistorySelectionAfterRef,
    suppressContentHistoryRef,
    componentSwapPickerRequest,
    canApplyContentEdit,
    selectedInstanceActionNodeId,
    selectedElementAlreadyComponent,
    selectedElementInsideComponent,
    defaultComponentName,
    selectedComponentLiteralProps,
    selectedComponentLocalSource,
    inspectCodeData,
    handleCreateComponent,
    handleCreateComponentHotkey,
    hoveredCodeLayerNode,
    hoveredCanvasSelectorCandidates,
    hoveredCanvasSelector,
    runtimeProjectionCacheRef,
    getRuntimeCodeLayerProjection,
    applyLocalContentUpdate,
    applyFileContentUpdate,
    handleComponentPropApplied,
    handleShaderSourceApplied,
    handleShaderSourceEdit,
    handleGoToMainComponentMenuAction,
    handleOpenLibraryComponent,
    handleDetachInstanceMenuAction,
    handleSwapInstanceMenuAction,
    handleToggleMinimalUi,
    handleOverviewPrimitiveReparent,
    handleShowAssetsPanel,
  };
}

export type EditorContentAndComponents = ReturnType<
  typeof useEditorContentAndComponents
>;
