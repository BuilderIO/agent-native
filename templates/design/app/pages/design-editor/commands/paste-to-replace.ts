import {
  applyVisualEdit,
  buildCodeLayerProjection,
  type CodeLayerNode,
} from "@shared/code-layer";
import { INLINE_TEXT_TAGS } from "@shared/text-layer-rule";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type {
  ElementInfo,
  PortableStyleSnapshot,
  RuntimeStructureInsertRequest,
} from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import type { DesignClipboardManagedStyleSnapshot } from "@/lib/design-clipboard-managed-styles";
import {
  insertClonedHtmlLayers,
  prepareClonedHtmlLayersForLiveInsert,
  portableStyleSnapshotForPasteTarget,
} from "@/pages/design-editor/clone-and-pen-edit";
import {
  codeLayerPatchMessage,
  preferredCodeLayerSelector,
} from "@/pages/design-editor/code-layer-state";
import type { CanvasLayerClipboardEntry } from "@/pages/design-editor/command-types";
import { isStandaloneHttpUrl } from "@/pages/design-editor/editor-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface PasteToReplaceArgs {
  activeFile: DesignFile;
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
  getCanvasClipboardEntries: () => CanvasLayerClipboardEntry[];
  getFreshActiveContent: () => string;
  getRenderedElementInfoForSelector?: (
    selector: string,
  ) => ElementInfo | null | undefined;
  getPreparedCloneVisualOffset?: (
    selector: string,
    layerHtml: string,
    styleSnapshot?: PortableStyleSnapshot,
    managedStyleSnapshot?: DesignClipboardManagedStyleSnapshot,
    sourceFileId?: string,
  ) =>
    | { x: number; y: number; styleSnapshot?: PortableStyleSnapshot }
    | null
    | undefined;
  runtimeStructureInsertRevisionRef: RefObject<number>;
  selectInsertedLayers: (
    screenId: string,
    content: string,
    rootNodeIds: string[],
  ) => void;
  selectedCanvasSelector: string;
  selectedElement: ElementInfo | null;
  setRuntimeStructureInsertRequest: Dispatch<
    SetStateAction<
      (RuntimeStructureInsertRequest & { screenId: string }) | null
    >
  >;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function pixelLength(value: string | undefined): number | null {
  const raw = (value ?? "").trim();
  if (raw === "0") return 0;
  const match = /^(-?[\d.]+)px$/.exec(raw);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function onlyInlineTextDescendants(
  node: CodeLayerNode,
  nodesById: ReadonlyMap<string, CodeLayerNode>,
): boolean {
  const pending = [...node.children];
  while (pending.length > 0) {
    const child = nodesById.get(pending.pop()!);
    if (!child || !INLINE_TEXT_TAGS.has(child.tag.toLowerCase())) return false;
    pending.push(...child.children);
  }
  return true;
}

export function runPasteToReplace(
  {
    activeFile,
    applyLocalContentUpdate,
    canEditDesign,
    getCanvasClipboardEntries,
    getFreshActiveContent,
    getRenderedElementInfoForSelector,
    getPreparedCloneVisualOffset,
    runtimeStructureInsertRevisionRef,
    selectInsertedLayers,
    selectedCanvasSelector,
    selectedElement,
    setRuntimeStructureInsertRequest,
    t,
  }: PasteToReplaceArgs,
  externalLayerHtml?: string,
) {
  if (!canEditDesign || !activeFile) return;
  const entries = externalLayerHtml ? [] : getCanvasClipboardEntries();
  if (!externalLayerHtml && entries.length !== 1) return;
  const layerHtml = externalLayerHtml ?? entries[0]!.html;
  const targetSelector = selectedElement?.selector;
  const targetPosition = selectedElement?.boundingRect;
  if (!targetSelector || !targetPosition) return;
  const styleSnapshot = externalLayerHtml
    ? undefined
    : portableStyleSnapshotForPasteTarget(entries[0]!, activeFile.id);
  if (styleSnapshot === null) {
    toast.error(t("designEditor.toasts.layerMoveFailed"), {
      duration: 4000,
    });
    return;
  }
  const baseContent = getFreshActiveContent();
  const targetStoredContent = activeFile.content ?? baseContent;
  if (isStandaloneHttpUrl(targetStoredContent)) {
    const renderedTarget = getRenderedElementInfoForSelector?.(targetSelector);
    const livePosition =
      renderedTarget === undefined
        ? { x: targetPosition.x, y: targetPosition.y }
        : (renderedTarget?.absoluteSiblingVisualOrigin ?? null);
    const visualOffset = getPreparedCloneVisualOffset?.(
      targetSelector,
      layerHtml,
      styleSnapshot ?? undefined,
      entries[0]?.managedStyleSnapshot,
      entries[0]?.sourceFileId,
    );
    if (
      !livePosition ||
      (getPreparedCloneVisualOffset !== undefined && visualOffset === null)
    ) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    const prepared = prepareClonedHtmlLayersForLiveInsert(
      targetStoredContent,
      [layerHtml],
      {
        positions: [
          {
            ...livePosition,
            space: "visual",
            ...(visualOffset
              ? { visualOffset: { x: visualOffset.x, y: visualOffset.y } }
              : {}),
          },
        ],
        styleSnapshots: [visualOffset?.styleSnapshot ?? styleSnapshot],
      },
    );
    const html = prepared?.htmlFragments[0];
    if (!prepared || !html) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    runtimeStructureInsertRevisionRef.current += 1;
    setRuntimeStructureInsertRequest({
      requestId: runtimeStructureInsertRevisionRef.current,
      screenId: activeFile.id,
      html,
      replaceAnchor: true,
      anchor: {
        selector:
          selectedElement.runtimeSelector ??
          selectedCanvasSelector ??
          targetSelector,
        sourceId:
          selectedElement.runtimeSourceId ??
          selectedElement.sourceId ??
          undefined,
      },
      placement: "before",
    });
    return;
  }
  const projection = buildCodeLayerProjection(baseContent, {
    source: { kind: "design-file", fileId: activeFile.id },
  });
  const selectedNode = projection.nodes.find((node) =>
    node.selectors.includes(targetSelector),
  );
  const failed = () =>
    toast.error(t("designEditor.toasts.pasteReplaceFailed"), {
      duration: 4000,
    });
  if (!selectedNode) {
    failed();
    return;
  }
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  let targetNode = selectedNode;
  let parentNode = targetNode.parentId
    ? nodesById.get(targetNode.parentId)
    : undefined;
  while (
    parentNode &&
    (parentNode.wholeTextStyleRoot === true ||
      (selectedElement?.wholeTextStyleRoot === true &&
        parentNode.dataAttributes["data-agent-native-group"] !== "true" &&
        parentNode.dataAttributes["data-an-primitive"] !== "frame" &&
        parentNode.textSnippet !== null &&
        onlyInlineTextDescendants(parentNode, nodesById)))
  ) {
    targetNode = parentNode;
    parentNode = targetNode.parentId
      ? nodesById.get(targetNode.parentId)
      : undefined;
  }
  const replacementSelector =
    targetNode.id === selectedNode.id
      ? targetSelector
      : preferredCodeLayerSelector(targetNode);
  const authoredLeft = pixelLength(targetNode.style.left);
  const authoredTop = pixelLength(targetNode.style.top);
  const hasAuthoredPosition = authoredLeft !== null && authoredTop !== null;
  const targetGeometry =
    getRenderedElementInfoForSelector?.(replacementSelector);
  const cloneVisualOffset = getPreparedCloneVisualOffset?.(
    replacementSelector,
    layerHtml,
    styleSnapshot ?? undefined,
    entries[0]?.managedStyleSnapshot,
    entries[0]?.sourceFileId,
  );
  const useLiveGeometry = getRenderedElementInfoForSelector !== undefined;
  const useAbsoluteAuthoredPosition =
    !useLiveGeometry &&
    targetNode.style.position === "absolute" &&
    hasAuthoredPosition;
  const position = useLiveGeometry
    ? (targetGeometry?.absoluteSiblingVisualOrigin ?? null)
    : useAbsoluteAuthoredPosition
      ? { x: authoredLeft, y: authoredTop }
      : null;
  if (
    !position ||
    (getPreparedCloneVisualOffset !== undefined && cloneVisualOffset === null)
  ) {
    failed();
    return;
  }
  const inserted = insertClonedHtmlLayers(baseContent, [layerHtml], {
    anchorSelectors: [replacementSelector],
    placement: "after",
    positions: [
      {
        ...position,
        space: useAbsoluteAuthoredPosition ? "layout" : "visual",
        ...(cloneVisualOffset
          ? {
              visualOffset: {
                x: cloneVisualOffset.x,
                y: cloneVisualOffset.y,
              },
            }
          : {}),
      },
    ],
    styleSnapshots: [cloneVisualOffset?.styleSnapshot ?? styleSnapshot],
    managedStyleSnapshots: [entries[0]?.managedStyleSnapshot],
  });
  if (!inserted) {
    failed();
    return;
  }
  const insertedProjection = buildCodeLayerProjection(inserted.content, {
    source: projection.source,
  });
  const staleTarget = insertedProjection.nodes.find((node) =>
    node.selectors.includes(replacementSelector),
  );
  if (!staleTarget) {
    failed();
    return;
  }
  const removal = applyVisualEdit(
    inserted.content,
    { kind: "deleteNode", target: { nodeId: staleTarget.id } },
    { source: insertedProjection.source },
  );
  if (removal.result.status !== "applied") {
    toast.error(
      codeLayerPatchMessage(
        removal.result.message,
        t("designEditor.toasts.layerMoveFailed"),
        t,
      ),
    );
    return;
  }
  applyLocalContentUpdate(removal.content, { forcePreviewFullDocument: true });
  selectInsertedLayers(activeFile.id, removal.content, inserted.rootNodeIds);
}
