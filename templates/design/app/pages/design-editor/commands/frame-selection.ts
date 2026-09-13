import {
  applyVisualEdit,
  buildCodeLayerProjection,
  type CodeLayerProjection,
} from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import type * as Y from "yjs";

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
function collectLiveSizeHints(
  nodeIds: string[],
  projection: CodeLayerProjection,
): Record<string, { width: number; height: number }> {
  const hints: Record<string, { width: number; height: number }> = {};
  if (typeof document === "undefined") return hints;
  const iframeDocs = Array.from(
    document.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    ),
  )
    .map((iframe) => iframe.contentDocument)
    .filter((doc): doc is Document => !!doc);
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
    for (const doc of iframeDocs) {
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
      break;
    }
  }
  return hints;
}

export interface FrameSelectionArgs {
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
  activeFile,
  applyLocalContentUpdate,
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
  const sizeHints = collectLiveSizeHints(nodeIds, baseProjection);
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
