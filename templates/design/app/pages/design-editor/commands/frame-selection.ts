import {
  applyVisualEdit,
  buildCodeLayerProjection,
  type CodeLayerProjection,
} from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import type * as Y from "yjs";

import {
  findCanvasIframeForScreen,
  getBreakpointIframeId,
} from "@/components/design/multi-screen/iframe-targeting";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  codeLayerPatchMessage,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import {
  captureContentUndoStackTop,
  captureYjsUndoStackTop,
  type ContentHistoryEntry,
  type ContentHistorySelectionAfterMap,
  stampContentHistorySelectionAfter,
  stampYjsUndoSelection,
  stampYjsUndoSelectionAfter,
  type YjsUndoSelectionSnapshot,
} from "@/pages/design-editor/history";
import { setCodeLayerAttributeInHtml } from "@/pages/design-editor/html-layer-positioning";
import { buildActiveFileNodeIdSet } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

/**
 * Live-rendered width/height per target node id, keyed for
 * computeAbsoluteUnionBounds's size-hint fallback. wrapNodes (the
 * code-layer.ts substrate) works purely off the source HTML string, so an
 * absolutely-positioned but auto-sized target (a Text-tool node with no
 * explicit inline width/height) otherwise gets NO computed geometry at all —
 * the resulting frame is a zero-area `position:static` div that doesn't
 * enclose its own content (undraggable/unresizable at its own reported
 * position; see item-2 cross-screen investigation). Only fills a gap the
 * string-only path cannot see — never overrides an explicit style value.
 */
export function collectLiveSizeHints(
  nodeIds: string[],
  projection: CodeLayerProjection,
  activeIframeId: string,
  boardFileId: string | undefined,
): Record<string, { width: number; height: number }> {
  const hints: Record<string, { width: number; height: number }> = {};
  if (typeof document === "undefined") return hints;
  // Only the active file's own iframe can legitimately contain these node
  // ids (they came from parsing the active file's own source) — querying
  // every preview iframe on the canvas and taking the first match risks
  // reading a DIFFERENT screen's DOM when a duplicated Screen has remapped
  // (or not-yet-unique) ids that collide with the active one's. activeIframeId
  // is already the active breakpoint's sub-frame id when one is focused
  // (getActiveScreenIframeId's id shape), since an auto-sized target can be
  // measured only in the iframe it is actually rendered in; boardFileId lets
  // this resolve the dedicated board surface iframe the same way every other
  // findCanvasIframeForScreen caller does.
  const doc = findCanvasIframeForScreen(
    document.body,
    activeIframeId,
    boardFileId,
  )?.contentDocument;
  if (!doc) return hints;
  for (const nodeId of nodeIds) {
    // Mirrors applyWrapNodes's own target resolution: a caller-supplied id
    // can be either the real data-agent-native-node-id attribute or the
    // projection's internal node id — only the attribute value is queryable
    // in the live DOM.
    const node = projection.nodes.find(
      (n) =>
        n.dataAttributes["data-agent-native-node-id"] === nodeId ||
        n.id === nodeId,
    );
    const attrId = node?.dataAttributes["data-agent-native-node-id"];
    if (!attrId) continue;
    const el = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(attrId)}"]`,
    );
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      // Keyed by the real attribute value: computeAbsoluteUnionBounds
      // reads data-agent-native-node-id straight off the parsed element,
      // not the caller's (possibly internal-projection-id) target id.
      hints[attrId] = { width: rect.width, height: rect.height };
    }
  }
  return hints;
}

export interface FrameSelectionArgs {
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
  ) => void;
  boardFileId: string | undefined;
  canEditDesign: boolean;
  contentHistorySelectionAfterRef: RefObject<ContentHistorySelectionAfterMap>;
  contentUndoStackRef: RefObject<ContentHistoryEntry[]>;
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
  activeFile,
  applyLocalContentUpdate,
  boardFileId,
  canEditDesign,
  contentHistorySelectionAfterRef,
  contentUndoStackRef,
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
  const fileIds = new Set(files.map((f) => f.id));
  const baseProjection = buildCodeLayerProjection(baseContent);
  const activeNodeIdSet = buildActiveFileNodeIdSet(baseProjection);
  const nodeIds = selectedLayerIdsState.filter(
    (id) => !id.startsWith("__") && !fileIds.has(id) && activeNodeIdSet.has(id),
  );
  if (nodeIds.length < 1) return;
  // The selected element may live in the active responsive breakpoint's own
  // sub-frame rather than the screen's primary iframe — measure wherever it
  // is actually rendered, or an auto-sized target gets another size's rect.
  const activeIframeId =
    activeBreakpointWidthState !== undefined
      ? getBreakpointIframeId(activeFile.id, activeBreakpointWidthState)
      : activeFile.id;
  const sizeHints = collectLiveSizeHints(
    nodeIds,
    baseProjection,
    activeIframeId,
    boardFileId,
  );
  const patch = applyVisualEdit(baseContent, {
    kind: "wrapNodes",
    targetIds: nodeIds,
    autoLayout: false,
    wrapperKind: "frame",
    sizeHints,
  });
  if (patch.result.status !== "applied") {
    toast.error(
      codeLayerPatchMessage(
        patch.result.message,
        t("designEditor.toasts.layerMoveFailed"),
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
    const taggedProjection = buildCodeLayerProjection(nextContent);
    const taggedNode = taggedProjection.nodes.find(
      (n) =>
        n.dataAttributes["data-agent-native-node-id"] ===
        patch.result.wrapperNodeId,
    );
    if (taggedNode) {
      const tagged = setCodeLayerAttributeInHtml(
        nextContent,
        taggedNode,
        "data-an-primitive",
        "frame",
      );
      if (tagged) nextContent = tagged;
    }
    wrapperNode =
      buildCodeLayerProjection(nextContent).nodes.find(
        (n) =>
          n.dataAttributes["data-agent-native-node-id"] ===
          patch.result.wrapperNodeId,
      ) ?? wrapperNode;
  }
  // Figma-parity undo/redo selection restore: see the identical comment in
  // group-selection.ts. Frame allows a SINGLE selected layer too, so undo
  // must restore that one element rather than clear selection.
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
  applyLocalContentUpdate(nextContent, {
    forcePreviewFullDocument: true,
    selectionBefore: selectionBeforeFrame,
  });
  stampYjsUndoSelection(
    undoManagerRef.current,
    undoStackTopBeforeFrame,
    selectionBeforeFrame,
  );
  if (wrapperNode) {
    setSelectedLayerIdsState([wrapperNode.id]);
    setSelectedElement(elementInfoFromCodeLayerNode(wrapperNode));
    // See the matching comment in group-selection.ts: the write lands on
    // whichever stack is actually tracking it, so both stamps run.
    stampYjsUndoSelectionAfter(
      undoManagerRef.current,
      undoStackTopBeforeFrame,
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
  }
}
