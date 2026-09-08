import type { CodeLayerNode } from "@shared/code-layer";
import { buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  extractLayerPosition,
  getElementOuterHtml,
  insertClonedHtmlLayer,
  insertClonedHtmlLayers,
} from "@/pages/design-editor/clone-and-pen-edit";
import {
  codeLayerSelectorAliases,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import type { SelectedCanvasLayerSnapshot } from "@/pages/design-editor/command-types";
import type { DesignFile } from "@/pages/design-editor/types";

export interface DuplicateSelectionArgs {
  activeFile: DesignFile;
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
  ) => void;
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
  ) => void;
  canEditDesign: boolean;
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
  selectedCanvasSelector: string;
  selectedElement: ElementInfo | null;
  selectedLayerIdsState: string[];
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  undoManagerRef: RefObject<Y.UndoManager | null>;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runDuplicateSelection({
  activeFile,
  applyFileContentUpdate,
  applyLocalContentUpdate,
  canEditDesign,
  files,
  getFreshActiveContent,
  getScreenContent,
  getSelectedLayerSnapshots,
  handleDuplicateScreen,
  lastDuplicateTransformRef,
  overviewSelectedScreenIds,
  remapMotionTracksForClone,
  selectedCanvasSelector,
  selectedElement,
  selectedLayerIdsState,
  setOverviewSelectedScreenIds,
  setSelectedElement,
  setSelectedLayerIdsState,
  t,
  undoManagerRef,
  viewModeRef,
}: DuplicateSelectionArgs) {
  trace("structure", "duplicate-selection", {
    canEdit: canEditDesign,
    selectedLayers: selectedLayerIdsState.length,
  });
  if (!canEditDesign) return;
  // U19: duplicate is a discrete one-shot action — see the matching note
  // in handlePasteSelection.
  undoManagerRef.current?.stopCapturing();
  const snapshots = getSelectedLayerSnapshots();
  if (snapshots.length > 0) {
    const selectedIds: string[] = [];
    const selectedScreenIds: string[] = [];
    let lastActiveNode: CodeLayerNode | null = null;

    // U7: replay the last recorded move delta when duplicating the exact
    // same selection again (e.g. dup, drag it, dup again repeats the same
    // offset — matching Figma). Otherwise an absolutely-positioned source
    // duplicates with zero offset (lands exactly in place) instead of the
    // previous unconditional stripRootPosition cascade.
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

    for (const file of files) {
      const group = snapshots.filter(
        (snapshot) => snapshot.sourceFileId === file.id,
      );
      if (group.length === 0) continue;
      let content = getScreenContent(file.id);
      const insertedRootNodeIds: string[] = [];
      for (const snapshot of [...group].sort(
        (a, b) => b.sourceIndex - a.sourceIndex,
      )) {
        const projection = buildCodeLayerProjection(content);
        const anchorNode =
          projection.nodes.find(
            (node) =>
              node.id === snapshot.node.id ||
              node.dataAttributes["data-agent-native-node-id"] ===
                snapshot.rootNodeId,
          ) ?? snapshot.node;
        const sourcePosition = extractLayerPosition(snapshot.html);
        const result = insertClonedHtmlLayers(content, [snapshot.html], {
          targetSelectors: codeLayerSelectorAliases(anchorNode),
          placement: "after",
          // Absolutely-positioned board items land exactly in place (or at
          // the replayed delta); only in-flow elements (no left/top) use
          // stripRootPosition so they join the document as a plain sibling.
          stripRootPosition: !sourcePosition,
          positions: sourcePosition
            ? [
                {
                  x: sourcePosition.x + (repeatTransform?.dx ?? 0),
                  y: sourcePosition.y + (repeatTransform?.dy ?? 0),
                },
              ]
            : undefined,
        });
        if (!result) continue;
        content = result.content;
        insertedRootNodeIds.unshift(...result.rootNodeIds);
        // U14: duplicate keeps the clone's animation.
        remapMotionTracksForClone(result.nodeIdMap, file.id);
      }
      if (insertedRootNodeIds.length === 0) continue;
      applyFileContentUpdate(file.id, content, {
        forcePreviewFullDocument: true,
        refreshPreview: false,
      });
      selectedScreenIds.push(file.id);
      const finalProjection = buildCodeLayerProjection(content);
      insertedRootNodeIds.forEach((rootNodeId) => {
        const insertedNode = finalProjection.nodes.find(
          (node) =>
            node.id === rootNodeId ||
            node.dataAttributes["data-agent-native-node-id"] === rootNodeId,
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
      // Track this duplicate as the new "last duplicate" so a subsequent
      // drag-then-Cmd+D can record/replay a delta against it. Preserve the
      // previous delta across repeated Cmd+D so chained duplicates (no drag
      // in between) keep applying the same recorded offset, matching Figma.
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
    // B7 fix: duplicate inserts the clone as an in-flow sibling right AFTER
    // the original — not as an absolutely-positioned body child.  Strip
    // position/left/top so it joins normal document flow.
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
      targetSelectors: [selector],
      placement: "after",
    });
    if (nextContent) {
      applyLocalContentUpdate(nextContent, {
        forcePreviewFullDocument: true,
      });
    } else {
      toast.error(t("designEditor.toasts.duplicateElementFailed"));
    }
    return;
  }
  // U17: duplicate every selected screen, not just the active one — a
  // multi-screen overview selection (no deeper layer focus) previously
  // silently duplicated only activeFile.id and dropped the rest.
  const screenIdsToDuplicate =
    viewModeRef.current === "overview" && overviewSelectedScreenIds.length > 1
      ? overviewSelectedScreenIds
      : activeFile
        ? [activeFile.id]
        : [];
  screenIdsToDuplicate.forEach((screenId) => handleDuplicateScreen(screenId));
}
