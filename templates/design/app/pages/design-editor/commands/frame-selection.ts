import {
  applyVisualEdit,
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerProjection,
  type WrapNodeSizeHint,
} from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import type * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import {
  findCanvasIframeForScreen,
  getBreakpointIframeId,
} from "@/components/design/multi-screen/iframe-targeting";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import { queryFirstSelector } from "@/pages/design-editor/clone-and-pen-edit";
import {
  codeLayerPatchMessage,
  codeLayerSelectorAliases,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import type { ApplyLocalContentUpdateResult } from "@/pages/design-editor/commands/apply-local-content-update";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "@/pages/design-editor/commands/selection-publication";
import {
  captureContentUndoStackTop,
  captureYjsUndoStackTop,
  type ContentHistoryEntry,
  type ContentHistoryChange,
  type ContentHistorySelectionAfterMap,
  stampContentHistorySelectionAfter,
  stampLocalContentHistorySelectionAfter,
  stampYjsUndoSelection,
  stampYjsUndoSelectionAfter,
  type YjsUndoSelectionSnapshot,
} from "@/pages/design-editor/history";
import { setCodeLayerAttributeInHtml } from "@/pages/design-editor/html-layer-positioning";
import { buildActiveFileNodeIdSet } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

import {
  dispatchLinkedComponentStructure,
  type ApplyLinkedComponentEdit,
} from "./linked-component-structure";

export interface LiveSizeHints {
  hints: Record<string, WrapNodeSizeHint>;
  /**
   * Layers the preview could not measure. Wrapping keeps their authored
   * geometry, which callers that need a rendered box must refuse instead.
   */
  unmeasured: Array<{ nodeId: string; reason: "no-preview" | "not-found" }>;
}

export function collectLiveSizeHints(
  nodeIds: string[],
  projection: CodeLayerProjection,
  activeIframeId: string,
  boardFileId: string | undefined,
): LiveSizeHints {
  const hints: Record<string, WrapNodeSizeHint> = {};
  const unmeasured: LiveSizeHints["unmeasured"] = [];
  const doc =
    typeof document === "undefined"
      ? null
      : findCanvasIframeForScreen(document.body, activeIframeId, boardFileId)
          ?.contentDocument;
  if (!doc) {
    return {
      hints,
      unmeasured: nodeIds.map((nodeId) => ({ nodeId, reason: "no-preview" })),
    };
  }
  for (const requestedId of nodeIds) {
    let node = projection.nodes.find(
      (candidate) => candidate.id === requestedId,
    );
    if (!node) {
      const rawIdMatches = projection.nodes.filter(
        (candidate) =>
          candidate.dataAttributes["data-agent-native-node-id"] === requestedId,
      );
      node = rawIdMatches.length === 1 ? rawIdMatches[0] : undefined;
    }
    if (!node) {
      unmeasured.push({ nodeId: requestedId, reason: "not-found" });
      continue;
    }

    const rawId = node.dataAttributes["data-agent-native-node-id"];
    const sameRawIdNodes = rawId
      ? projection.nodes.filter(
          (candidate) =>
            candidate.dataAttributes["data-agent-native-node-id"] === rawId,
        )
      : [];
    const selectors =
      sameRawIdNodes.length > 1 ? [node.path] : codeLayerSelectorAliases(node);
    const element = queryFirstSelector(doc, selectors);
    const iframeWindow = doc.defaultView;
    if (
      !element ||
      !iframeWindow ||
      !(element instanceof iframeWindow.HTMLElement)
    ) {
      unmeasured.push({ nodeId: node.id, reason: "not-found" });
      continue;
    }
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (width > 0 && height > 0) {
      const computedPosition = iframeWindow.getComputedStyle(element).position;
      const computedOutOfFlow =
        computedPosition === "absolute" || computedPosition === "fixed";
      if (isOutOfFlowHintTarget(node) || computedOutOfFlow) {
        // Layout offsets, not client rects: the pinned child keeps its own
        // transform inside the wrapper, so its painted box stays put.
        const origin =
          computedPosition === "absolute" && element.offsetParent
            ? { left: element.offsetLeft, top: element.offsetTop }
            : {};
        hints[node.id] = { width, height, ...origin, outOfFlow: true };
        continue;
      }
      if (hasUnsupportedMeasuredFlowAncestry(element, iframeWindow)) {
        hints[node.id] = { width, height };
        continue;
      }
      const position = measureParentRelativePosition(element, iframeWindow);
      hints[node.id] = position
        ? {
            width: position.width,
            height: position.height,
            left: position.left,
            top: position.top,
          }
        : { width, height };
    }
  }
  return { hints, unmeasured };
}

function hasUnsupportedMeasuredFlowAncestry(
  element: HTMLElement,
  iframeWindow: Window,
): boolean {
  let isTarget = true;
  for (
    let current: HTMLElement | null = element;
    current;
    current = current.parentElement
  ) {
    const style = iframeWindow.getComputedStyle(current);
    if (
      (style.perspective && style.perspective !== "none") ||
      hasNonIdentityScale(
        style.scale ||
          style.getPropertyValue("scale") ||
          current.style.getPropertyValue("scale"),
      ) ||
      (style.rotate &&
        style.rotate !== "none" &&
        style.rotate !== "0deg" &&
        style.rotate !== "0") ||
      (style.zoom && style.zoom !== "normal" && style.zoom !== "1")
    ) {
      return true;
    }
    if (style.transform && style.transform !== "none") {
      if (
        isTarget ||
        !isTranslationOnlyTransform(style.transform, iframeWindow)
      ) {
        return true;
      }
    }
    if (
      isTarget &&
      hasNonZeroTranslate(
        style.translate ||
          style.getPropertyValue("translate") ||
          current.style.getPropertyValue("translate"),
      )
    ) {
      return true;
    }
    isTarget = false;
  }
  return false;
}

function hasNonIdentityScale(value: string | undefined): boolean {
  const scale = (value ?? "").trim().toLowerCase();
  if (!scale || scale === "none") return false;
  return scale.split(/\s+/).some((part) => Number(part) !== 1);
}

function hasNonZeroTranslate(value: string | undefined): boolean {
  const translate = (value ?? "").trim().toLowerCase();
  if (!translate || translate === "none") return false;
  return translate
    .split(/\s+/)
    .some((part) => !/^[-+]?0(?:\.0+)?(?:[a-z%]+)?$/.test(part));
}

function isTranslationOnlyTransform(
  transform: string,
  iframeWindow: Window,
): boolean {
  const Matrix = (
    iframeWindow as Window & {
      DOMMatrixReadOnly?: typeof DOMMatrixReadOnly;
    }
  ).DOMMatrixReadOnly;
  if (!Matrix) return false;
  try {
    const matrix = new Matrix(transform);
    return (
      matrix.is2D &&
      Math.abs(matrix.a - 1) <= 0.001 &&
      Math.abs(matrix.b) <= 0.001 &&
      Math.abs(matrix.c) <= 0.001 &&
      Math.abs(matrix.d - 1) <= 0.001
    );
    // coercion-ok: false keeps transformed viewport geometry out of source.
  } catch {
    return false;
  }
}

function isOutOfFlowHintTarget(node: CodeLayerNode): boolean {
  const position = node.style.position?.toLowerCase();
  if (position) return position === "absolute" || position === "fixed";
  return node.classes.some((token) => {
    const parts = token.split(":");
    const utility = parts[parts.length - 1]?.replace(/^!/, "");
    return utility === "absolute" || utility === "fixed";
  });
}

function measureParentRelativePosition(
  element: HTMLElement,
  iframeWindow: Window,
): { left: number; top: number; width: number; height: number } | null {
  const parent = element.offsetParent ?? element.parentElement;
  if (!parent) return null;
  const childRect = element.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  if (
    childRect.width <= 0 ||
    childRect.height <= 0 ||
    ![childRect.left, childRect.top, parentRect.left, parentRect.top].every(
      Number.isFinite,
    )
  ) {
    return null;
  }
  const parentStyle = iframeWindow.getComputedStyle(parent);
  const borderLeft = Number.parseFloat(parentStyle.borderLeftWidth || "0");
  const borderTop = Number.parseFloat(parentStyle.borderTopWidth || "0");
  let scrollLeft = 0;
  let scrollTop = 0;
  for (
    let ancestor = element.parentElement;
    ancestor && ancestor !== parent;
    ancestor = ancestor.parentElement
  ) {
    scrollLeft += ancestor.scrollLeft;
    scrollTop += ancestor.scrollTop;
  }
  scrollLeft += parent.scrollLeft;
  scrollTop += parent.scrollTop;
  const left =
    childRect.left +
    scrollLeft -
    parentRect.left -
    (Number.isFinite(borderLeft) ? borderLeft : 0);
  const top =
    childRect.top +
    scrollTop -
    parentRect.top -
    (Number.isFinite(borderTop) ? borderTop : 0);
  return Number.isFinite(left) &&
    Number.isFinite(childRect.width) &&
    Number.isFinite(childRect.height) &&
    childRect.width > 0 &&
    childRect.height > 0
    ? { left, top, width: childRect.width, height: childRect.height }
    : null;
}

export interface FrameSelectionArgs {
  applyLinkedComponentEdit?: ApplyLinkedComponentEdit;
  activeBreakpointWidthState: number | undefined;
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
      selectionBefore?: YjsUndoSelectionSnapshot;
    },
  ) => ApplyLocalContentUpdateResult;
  boardFileId: string | undefined;
  canEditDesign: boolean;
  contentHistorySelectionAfterRef: RefObject<ContentHistorySelectionAfterMap>;
  contentUndoStackRef: RefObject<ContentHistoryEntry[]>;
  localContentUndoStackRef: RefObject<ContentHistoryChange[]>;
  files: DesignFile[];
  getFreshActiveContent: () => string;
  overviewSelectedScreenIds: string[];
  selectedLayerIdsState: string[];
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  undoManagerRef: RefObject<Y.UndoManager | null>;
}

export function runFrameSelection({
  activeBreakpointWidthState,
  applyLinkedComponentEdit,
  activeFile,
  applyLocalContentUpdate,
  boardFileId,
  canEditDesign,
  contentHistorySelectionAfterRef,
  contentUndoStackRef,
  localContentUndoStackRef,
  files,
  getFreshActiveContent,
  overviewSelectedScreenIds,
  selectedLayerIdsState,
  setSelectedElement,
  setSelectedLayerIdsState,
  t,
  undoManagerRef,
}: FrameSelectionArgs) {
  if (!canEditDesign || !activeFile) return;
  const baseContent = getFreshActiveContent();
  const source = { kind: "design-file" as const, fileId: activeFile.id };
  const fileIds = new Set(files.map((f) => f.id));
  const baseProjection = buildCodeLayerProjection(baseContent, { source });
  const activeNodeIdSet = buildActiveFileNodeIdSet(baseProjection);
  const nodeIds = selectedLayerIdsState.filter(
    (id) => !id.startsWith("__") && !fileIds.has(id) && activeNodeIdSet.has(id),
  );
  if (nodeIds.length < 1) return;
  const activeIframeId =
    activeBreakpointWidthState !== undefined
      ? getBreakpointIframeId(activeFile.id, activeBreakpointWidthState)
      : activeFile.id;
  const { hints: sizeHints, unmeasured } = collectLiveSizeHints(
    nodeIds,
    baseProjection,
    activeIframeId,
    boardFileId,
  );
  if (unmeasured.length > 0) {
    trace("structure", "frame-unmeasured", { unmeasured });
  }
  if (
    dispatchLinkedComponentStructure({
      content: baseContent,
      source,
      intents: [
        {
          kind: "wrapNodes",
          targetIds: nodeIds,
          autoLayout: false,
          wrapperKind: "frame",
          sizeHints,
        },
      ],
      applyLinkedComponentEdit,
    })
  )
    return;
  const patch = applyVisualEdit(
    baseContent,
    {
      kind: "wrapNodes",
      targetIds: nodeIds,
      autoLayout: false,
      wrapperKind: "frame",
      sizeHints,
    },
    { source },
  );
  if (patch.result.status !== "applied") {
    toast.error(
      codeLayerPatchMessage(
        patch.result.message,
        t("designEditor.toasts.layerMoveFailed"),
        t,
      ),
      { duration: 4000 },
    );
    return;
  }
  let nextContent = patch.content;
  let wrapperNode = patch.result.wrapperNodeId
    ? patch.projection.nodes.find(
        (n) =>
          n.dataAttributes["data-agent-native-node-id"] ===
          patch.result.wrapperNodeId,
      )
    : undefined;
  if (wrapperNode) {
    const renamed = setCodeLayerAttributeInHtml(
      nextContent,
      wrapperNode,
      "data-agent-native-layer-name",
      "Frame",
    );
    if (renamed) nextContent = renamed;
    wrapperNode =
      buildCodeLayerProjection(nextContent, { source }).nodes.find(
        (n) =>
          n.dataAttributes["data-agent-native-node-id"] ===
          patch.result.wrapperNodeId,
      ) ?? wrapperNode;
  }
  const selectionBeforeFrame = {
    selectedElement:
      nodeIds.length === 1
        ? (() => {
            const soleNode = baseProjection.nodes.find(
              (node) => node.id === nodeIds[0],
            );
            return soleNode ? elementInfoFromCodeLayerNode(soleNode) : null;
          })()
        : null,
    selectedLayerIds: nodeIds,
  };
  const undoStackTopBeforeFrame = captureYjsUndoStackTop(
    undoManagerRef.current,
  );
  const contentUndoStackTopBeforeFrame = captureContentUndoStackTop(
    contentUndoStackRef.current,
  );
  const localContentUndoStackTopBeforeFrame =
    localContentUndoStackRef.current[
      localContentUndoStackRef.current.length - 1
    ];
  const initialWrapperNode = wrapperNode;
  const submittedProjection = buildCodeLayerProjection(nextContent, { source });
  const submittedWrapper = initialWrapperNode
    ? submittedProjection.nodes.find(
        (candidate) => candidate.id === initialWrapperNode.id,
      )
    : undefined;
  const publication = applyLocalContentUpdate(nextContent, {
    forcePreviewFullDocument: true,
    selectionBefore: selectionBeforeFrame,
  });
  if (publication.status !== "accepted") return;
  const acceptedProjection = projectAcceptedSource(publication, source);
  wrapperNode =
    mapAcceptedSelectionNode(
      publication,
      acceptedProjection,
      submittedWrapper,
    ) ?? undefined;
  stampYjsUndoSelection(
    undoManagerRef.current,
    undoStackTopBeforeFrame,
    selectionBeforeFrame,
  );
  if (wrapperNode) {
    setSelectedLayerIdsState([wrapperNode.id]);
    setSelectedElement(elementInfoFromCodeLayerNode(wrapperNode));
    stampYjsUndoSelectionAfter(
      undoManagerRef.current,
      publication.yjsHistoryRecorded === true,
      {
        selectedElement: elementInfoFromCodeLayerNode(wrapperNode),
        selectedLayerIds: [wrapperNode.id],
      },
    );
    stampContentHistorySelectionAfter(
      contentUndoStackRef.current,
      contentHistorySelectionAfterRef.current,
      contentUndoStackTopBeforeFrame,
      {
        overviewSelectedScreenIds,
        selectedLayerIds: [wrapperNode.id],
        activeFileId: activeFile.id,
      },
    );
    stampLocalContentHistorySelectionAfter(
      localContentUndoStackRef.current,
      localContentUndoStackTopBeforeFrame,
      {
        selectedElement: elementInfoFromCodeLayerNode(wrapperNode),
        selectedLayerIds: [wrapperNode.id],
      },
    );
  }
}
