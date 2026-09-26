import type { CodeLayerNode } from "@shared/code-layer";
import { buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import type {
  ElementInfo,
  RuntimeStructureInsertRequest,
} from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  extractLayerPosition,
  getElementOuterHtml,
  insertClonedHtmlLayer,
  insertClonedHtmlLayers,
  planLinkedComponentStructureClone,
  prepareClonedHtmlLayersForLiveInsert,
  type ComponentCloneBatchContext,
  type LinkedComponentStructureClonePlan,
} from "@/pages/design-editor/clone-and-pen-edit";
import {
  codeLayerSelectorAliases,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import type { SelectedCanvasLayerSnapshot } from "@/pages/design-editor/command-types";
import type { ApplyFileContentUpdateResult } from "@/pages/design-editor/commands/apply-file-content-update";
import type { ApplyLocalContentUpdateResult } from "@/pages/design-editor/commands/apply-local-content-update";
import { runRepeatItemEdit } from "@/pages/design-editor/commands/repeat-item-edit";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "@/pages/design-editor/commands/selection-publication";
import { isStandaloneHttpUrl } from "@/pages/design-editor/editor-state";
import type { GeometryHistorySelection } from "@/pages/design-editor/history";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyLinkedComponentEdit } from "./linked-component-structure";

function planLinkedDuplicateSelection(args: {
  content: string;
  group: SelectedCanvasLayerSnapshot[];
  source: {
    kind: "design-file";
    designId?: string;
    fileId: string;
    filename?: string;
  };
  componentLinks: ComponentCloneBatchContext;
  repeatTransform: { dx: number; dy: number } | null;
  onUnsupportedStructure: () => void;
}): LinkedComponentStructureClonePlan | null {
  let content = args.content;
  let targetNodeId: string | null = null;
  const selectionNodeIds: string[] = [];
  const nodeIdMap = new Map<string, string>();
  for (const snapshot of args.group) {
    const projection = buildCodeLayerProjection(content, {
      source: args.source,
    });
    const anchorNode =
      projection.nodes.find(
        (node) =>
          node.id === snapshot.node.id ||
          node.dataAttributes["data-agent-native-node-id"] ===
            snapshot.rootNodeId,
      ) ?? snapshot.node;
    const sourcePosition = extractLayerPosition(snapshot.html);
    const plan = planLinkedComponentStructureClone(content, [snapshot.html], {
      onUnsupportedStructure: args.onUnsupportedStructure,
      targetSelectors: codeLayerSelectorAliases(anchorNode),
      placement: "after",
      stripRootPosition: !sourcePosition,
      positions: sourcePosition
        ? [
            {
              x: sourcePosition.x + (args.repeatTransform?.dx ?? 0),
              y: sourcePosition.y + (args.repeatTransform?.dy ?? 0),
              space: "layout",
            },
          ]
        : undefined,
      componentLinks: args.componentLinks,
    });
    if (!plan) return null;
    targetNodeId ??= plan.targetNodeId;
    if (targetNodeId !== plan.targetNodeId) return null;
    content = plan.mainAfter;
    selectionNodeIds.push(...plan.selectionNodeIds);
    plan.nodeIdMap.forEach((value, key) => nodeIdMap.set(key, value));
  }
  return targetNodeId
    ? {
        mainBefore: args.content,
        mainAfter: content,
        targetNodeId,
        selectionNodeIds,
        rootNodeIds: selectionNodeIds,
        nodeIdMap,
      }
    : null;
}

export interface DuplicateSelectionArgs {
  activeFile: DesignFile;
  applyLinkedComponentEdit?: ApplyLinkedComponentEdit;
  designId: string | undefined;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyFileContentUpdateResult;
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
  canEditDesign: boolean;
  canEditLiveScreen?: boolean;
  files: DesignFile[];
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
  getSelectedLayerSnapshots: () => SelectedCanvasLayerSnapshot[];
  handleDuplicateScreen: (
    screenId: string,
    request?: { canvasPosition?: { x: number; y: number } },
  ) => void;
  lastDuplicateTransformRef: RefObject<{
    rootNodeIds: string[];
    dx: number;
    dy: number;
  } | null>;
  overviewSelectedScreenIds: string[];
  remapMotionTracksForClone: (
    nodeIdMap: Map<string, string>,
    targetFileId: string,
  ) => void;
  runtimeStructureInsertRevisionRef?: RefObject<number>;
  selectionBefore?: GeometryHistorySelection;
  selectedCanvasSelector: string;
  selectedElement: ElementInfo | null;
  selectedLayerIdsState: string[];
  setRuntimeStructureInsertRequest?: Dispatch<
    SetStateAction<
      (RuntimeStructureInsertRequest & { screenId: string }) | null
    >
  >;
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  undoManagerRef: RefObject<Y.UndoManager | null>;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runDuplicateSelection({
  activeFile,
  applyLinkedComponentEdit,
  designId,
  applyFileContentUpdate,
  applyLocalContentUpdate,
  canEditDesign,
  canEditLiveScreen = false,
  files,
  getFreshActiveContent,
  getScreenContent,
  getSelectedLayerSnapshots,
  handleDuplicateScreen,
  lastDuplicateTransformRef,
  overviewSelectedScreenIds,
  remapMotionTracksForClone,
  runtimeStructureInsertRevisionRef,
  selectionBefore,
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
}: DuplicateSelectionArgs) {
  trace("structure", "duplicate-selection", {
    canEdit: canEditDesign || canEditLiveScreen,
    selectedLayers: selectedLayerIdsState.length,
  });
  let structureUnsupported = false;
  const onUnsupportedStructure = () => {
    structureUnsupported = true;
    toast.error(
      t("designEditor.componentInstances.linkedStructureUnsupported"),
    );
  };
  const snapshots = getSelectedLayerSnapshots();
  const liveScreenSelection =
    canEditLiveScreen &&
    Boolean(
      activeFile &&
      isStandaloneHttpUrl(activeFile.content ?? "") &&
      snapshots.length > 0 &&
      snapshots.every((snapshot) => snapshot.sourceFileId === activeFile.id),
    );
  if (!canEditDesign && !liveScreenSelection) return;
  undoManagerRef.current?.stopCapturing();
  if (canEditDesign && activeFile && selectedElement?.repeat) {
    const edit = runRepeatItemEdit({
      content: getFreshActiveContent(),
      target: selectedElement.repeat,
      operation: { kind: "duplicate" },
    });
    if (edit.status === "written") {
      applyLocalContentUpdate(edit.content, {
        forcePreviewFullDocument: true,
      });
      return;
    }
    if (edit.status === "refused") {
      trace("structure", "repeat-item-refused", {
        operation: "duplicate",
        reason: edit.reason,
      });
      toast.error(
        t(
          edit.refusal === "no-item"
            ? "designEditor.toasts.repeatRowPickOnCanvas"
            : "designEditor.toasts.repeatListNotEditable",
        ),
      );
      return;
    }
  }
  if (snapshots.length > 0) {
    const currentSourceIds = snapshots
      .map((snapshot) => snapshot.rootNodeId ?? snapshot.node.id)
      .sort();
    const repeatTransform =
      lastDuplicateTransformRef.current &&
      lastDuplicateTransformRef.current.rootNodeIds.length ===
        currentSourceIds.length &&
      lastDuplicateTransformRef.current.rootNodeIds.every(
        (id, index) => id === currentSourceIds[index],
      )
        ? lastDuplicateTransformRef.current
        : null;
    const nextDuplicateRootNodeIds: string[] = [];

    if (liveScreenSelection) {
      const sourcePositions = snapshots.map((snapshot) =>
        extractLayerPosition(snapshot.html),
      );
      const prepared = prepareClonedHtmlLayersForLiveInsert(
        activeFile!.content ?? "",
        snapshots.map((snapshot) => snapshot.html),
        {
          stripRootPosition: true,
          positions: sourcePositions.map((position) =>
            position
              ? {
                  x: position.x + (repeatTransform?.dx ?? 0),
                  y: position.y + (repeatTransform?.dy ?? 0),
                  space: "layout" as const,
                }
              : undefined,
          ),
        },
      );
      if (
        prepared &&
        runtimeStructureInsertRevisionRef &&
        setRuntimeStructureInsertRequest
      ) {
        const anchorSelector =
          selectedElement?.runtimeSelector ??
          selectedCanvasSelector ??
          selectedElement?.selector;
        const anchorSourceId =
          selectedElement?.runtimeSourceId ??
          selectedElement?.sourceId ??
          (snapshots.length === 1
            ? (snapshots[0]!.rootNodeId ?? snapshots[0]!.node.id)
            : undefined);
        const hasAnchor = Boolean(anchorSelector);
        runtimeStructureInsertRevisionRef.current += 1;
        setRuntimeStructureInsertRequest({
          requestId: runtimeStructureInsertRevisionRef.current,
          screenId: activeFile!.id,
          html: prepared.htmlFragments[0]!,
          additionalHtml: prepared.htmlFragments.slice(1),
          anchor: hasAnchor
            ? { selector: anchorSelector!, sourceId: anchorSourceId }
            : { selector: "body" },
          placement: hasAnchor ? "after" : "inside",
        });
        lastDuplicateTransformRef.current = {
          rootNodeIds: [...prepared.rootNodeIds].sort(),
          dx: repeatTransform?.dx ?? 0,
          dy: repeatTransform?.dy ?? 0,
        };
        return;
      }
    }

    const componentDocuments = files.map((file) => ({
      source: {
        kind: "design-file" as const,
        designId,
        fileId: file.id,
        filename: file.filename,
      },
      content: getScreenContent(file.id),
    }));
    const selectedIds: string[] = [];
    const selectedScreenIds: string[] = [];
    let lastActiveNode: CodeLayerNode | null = null;

    if (!canEditDesign) return;

    const sortedSnapshotsByFile = new Map(
      files.map((file) => [
        file.id,
        snapshots
          .filter((snapshot) => snapshot.sourceFileId === file.id)
          .sort((a, b) => b.sourceIndex - a.sourceIndex),
      ]),
    );
    const linkedGroups = [...sortedSnapshotsByFile.values()].filter(
      (group) => group.length > 0,
    );
    if (applyLinkedComponentEdit && linkedGroups.length === 1) {
      const group = linkedGroups[0]!;
      const file = files.find(
        (candidate) => candidate.id === group[0]!.sourceFileId,
      );
      if (file) {
        const source = {
          kind: "design-file" as const,
          designId,
          fileId: file.id,
          filename: file.filename,
        };
        const componentLinks: ComponentCloneBatchContext = {
          sourceFileIds: group.map((snapshot) => snapshot.sourceFileId),
          targetSource: source,
          documents: componentDocuments,
        };
        const plan = planLinkedDuplicateSelection({
          content: getScreenContent(file.id),
          group,
          source,
          componentLinks,
          repeatTransform,
          onUnsupportedStructure,
        });
        if (plan) {
          applyLinkedComponentEdit(
            file.id,
            plan.targetNodeId,
            {
              kind: "structure",
              before: plan.mainBefore,
              after: plan.mainAfter,
              selectionNodeIds: plan.selectionNodeIds,
            },
            selectionBefore,
            () => remapMotionTracksForClone(plan.nodeIdMap, file.id),
          );
          return;
        }
      }
    }

    for (const file of files) {
      const group = sortedSnapshotsByFile.get(file.id) ?? [];
      if (group.length === 0) continue;
      let content = getScreenContent(file.id);
      const source = {
        kind: "design-file" as const,
        designId,
        fileId: file.id,
        filename: file.filename,
      };
      const insertedRootNodeIds: string[] = [];
      for (const snapshot of group) {
        const projection = buildCodeLayerProjection(content, { source });
        const anchorNode =
          projection.nodes.find(
            (node) =>
              node.id === snapshot.node.id ||
              node.dataAttributes["data-agent-native-node-id"] ===
                snapshot.rootNodeId,
          ) ?? snapshot.node;
        const sourcePosition = extractLayerPosition(snapshot.html);
        const result = insertClonedHtmlLayers(content, [snapshot.html], {
          onUnsupportedStructure,
          targetSelectors: codeLayerSelectorAliases(anchorNode),
          placement: "after",
          stripRootPosition: !sourcePosition,
          positions: sourcePosition
            ? [
                {
                  x: sourcePosition.x + (repeatTransform?.dx ?? 0),
                  y: sourcePosition.y + (repeatTransform?.dy ?? 0),
                  space: "layout",
                },
              ]
            : undefined,
          componentLinks: {
            sourceFileIds: group.map((snapshot) => snapshot.sourceFileId),
            targetSource: source,
            documents: componentDocuments,
          },
        });
        if (structureUnsupported) return;
        if (!result) continue;
        content = result.content;
        insertedRootNodeIds.unshift(...result.rootNodeIds);
        remapMotionTracksForClone(result.nodeIdMap, file.id);
      }
      if (insertedRootNodeIds.length === 0) continue;
      const submittedProjection = buildCodeLayerProjection(content, { source });
      const publication = applyFileContentUpdate(file.id, content, {
        forcePreviewFullDocument: true,
        refreshPreview: false,
      });
      if (publication.status !== "accepted") continue;
      selectedScreenIds.push(file.id);
      const finalProjection = projectAcceptedSource(publication, source);
      insertedRootNodeIds.forEach((rootNodeId) => {
        const submittedNode = submittedProjection.nodes.find(
          (node) =>
            node.id === rootNodeId ||
            node.dataAttributes["data-agent-native-node-id"] === rootNodeId,
        );
        const insertedNode = mapAcceptedSelectionNode(
          publication,
          finalProjection,
          submittedNode,
        );
        if (!insertedNode) return;
        selectedIds.push(insertedNode.id);
        nextDuplicateRootNodeIds.push(
          insertedNode.dataAttributes["data-agent-native-node-id"] ??
            insertedNode.id,
        );
        if (file.id === activeFile?.id) lastActiveNode = insertedNode;
      });
    }

    if (selectedIds.length > 0) {
      setSelectedLayerIdsState(selectedIds);
      setSelectedElement(
        lastActiveNode ? elementInfoFromCodeLayerNode(lastActiveNode) : null,
      );
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds(selectedScreenIds);
      }
      lastDuplicateTransformRef.current = {
        rootNodeIds: [...nextDuplicateRootNodeIds].sort(),
        dx: repeatTransform?.dx ?? 0,
        dy: repeatTransform?.dy ?? 0,
      };
      return;
    }
  }

  if (selectedElement?.selector) {
    const baseContent = getFreshActiveContent();
    const html = getElementOuterHtml(baseContent, selectedElement.selector);
    if (!html) {
      toast.error(t("designEditor.toasts.duplicateElementFailed"));
      return;
    }
    const selector = selectedCanvasSelector ?? selectedElement.selector;
    const strippedHtml = (() => {
      try {
        const parser = new DOMParser();
        const tmp = parser.parseFromString(
          `<template>${html}</template>`,
          "text/html",
        );
        const root =
          tmp.querySelector("template")?.content.firstElementChild ??
          tmp.body.firstElementChild;
        if (root && root instanceof HTMLElement) {
          root.style.position = "";
          root.style.left = "";
          root.style.top = "";
          root.style.right = "";
          root.style.bottom = "";
        }
        return root?.outerHTML ?? html;
      } catch {
        return html;
      }
    })();
    const nextContent = insertClonedHtmlLayer(baseContent, strippedHtml, {
      onUnsupportedStructure,
      targetSelectors: [selector],
      placement: "after",
      componentLinks: activeFile
        ? {
            sourceFileIds: [activeFile.id],
            targetSource: {
              kind: "design-file",
              designId,
              fileId: activeFile.id,
              filename: activeFile.filename,
            },
            documents: files.map((file) => ({
              source: {
                kind: "design-file" as const,
                designId,
                fileId: file.id,
                filename: file.filename,
              },
              content: getScreenContent(file.id),
            })),
          }
        : undefined,
    });
    if (structureUnsupported) return;
    if (nextContent) {
      applyLocalContentUpdate(nextContent, {
        forcePreviewFullDocument: true,
      });
    } else {
      toast.error(t("designEditor.toasts.duplicateElementFailed"));
    }
    return;
  }
  const screenIdsToDuplicate =
    viewModeRef.current === "overview" && overviewSelectedScreenIds.length > 1
      ? overviewSelectedScreenIds
      : activeFile
        ? [activeFile.id]
        : [];
  screenIdsToDuplicate.forEach((screenId) => handleDuplicateScreen(screenId));
}
