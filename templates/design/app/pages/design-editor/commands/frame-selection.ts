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
  for (const requestedId of nodeIds) {
    let node = projection.nodes.find(
      (candidate) => candidate.id === requestedId,
    );
    if (!node) {
      const rawIdMatches = projection.nodes.filter(
        (candidate) =>
          candidate.dataAttributes["data-agent-native-node-id"] === requestedId,
      );
      // Raw source IDs are only a safe fallback when the projection has
      // exactly one owner. Duplicate legacy IDs must not collapse multiple
      // nodes onto whichever attribute selector happens to match first.
      if (rawIdMatches.length !== 1) continue;
      node = rawIdMatches[0];
    }
    if (!node) continue;

    const rawId = node.dataAttributes["data-agent-native-node-id"];
    const sameRawIdNodes = rawId
      ? projection.nodes.filter(
          (candidate) =>
            candidate.dataAttributes["data-agent-native-node-id"] === rawId,
        )
      : [];
    // The stable-attribute alias is ambiguous for legacy duplicate IDs; use
    // only this node's positional path. If that exact path is absent from the
    // live iframe, do not fall through to an alias that could now identify a
    // surviving sibling instead.
    const selectors =
      sameRawIdNodes.length > 1 ? [node.path] : codeLayerSelectorAliases(node);
    const element = queryFirstSelector(doc, selectors);
    const iframeWindow = doc.defaultView;
    if (
      !element ||
      !iframeWindow ||
      !(element instanceof iframeWindow.HTMLElement)
    ) {
      continue;
    }
    // offsetWidth/offsetHeight preserve the element's layout border box.
    // getBoundingClientRect includes transforms and iframe scaling, which
    // would inflate the source-space frame geometry for rotated/scaled nodes.
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (width > 0 && height > 0) {
      hints[node.id] = { width, height };
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
  ) => ApplyLocalContentUpdateResult;
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
  const source = { kind: "design-file" as const, fileId: activeFile.id };
  const fileIds = new Set(files.map((f) => f.id));
  const baseProjection = buildCodeLayerProjection(baseContent, { source });
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
