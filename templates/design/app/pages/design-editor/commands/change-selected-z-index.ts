import type {
  CodeLayerNode,
  CodeLayerTreeNode,
  MoveNodeEditIntent,
} from "@shared/code-layer";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  elementInfoFromCodeLayerNode,
  findCodeLayerSiblingOrder,
} from "@/pages/design-editor/code-layer-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface ChangeSelectedZIndexArgs {
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
  codeLayerOwnerByNodeIdRef: RefObject<
    Map<
      string,
      {
        fileId: string;
        node: CodeLayerNode;
        tree: CodeLayerTreeNode[];
        runtimeOnly: boolean;
      }
    >
  >;
  commitVisualStyles: (
    selector: string,
    styles: Record<string, string>,
    options?: {
      runtimeApplied?: boolean;
      elementInfo?: ElementInfo;
      originalStyles?: Record<string, string>;
    },
  ) => void;
  getFreshActiveContent: () => string;
  selectedElement: ElementInfo | null;
  selectedLayerIdsState: string[];
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
}

export function runChangeSelectedZIndex(
  {
    activeFile,
    applyLocalContentUpdate,
    canEditDesign,
    codeLayerOwnerByNodeIdRef,
    commitVisualStyles,
    getFreshActiveContent,
    selectedElement,
    selectedLayerIdsState,
    setSelectedElement,
  }: ChangeSelectedZIndexArgs,
  mode: "forward" | "front" | "backward" | "back",
) {
  if (!canEditDesign) return;
  const selector = selectedElement?.selector;
  if (!selector) return;
  const currentSelectedElement = selectedElement;

  const zIndexFallback = () => {
    const current = Number.parseInt(
      currentSelectedElement.computedStyles.zIndex || "0",
      10,
    );
    const base = Number.isFinite(current) ? current : 0;
    const next =
      mode === "front"
        ? 999
        : mode === "back"
          ? 0
          : mode === "forward"
            ? base + 1
            : Math.max(0, base - 1);
    commitVisualStyles(selector, {
      position:
        currentSelectedElement.computedStyles.position === "static"
          ? "relative"
          : currentSelectedElement.computedStyles.position || "relative",
      zIndex: String(next),
    });
  };

  const targetId =
    selectedLayerIdsState.length === 1 ? selectedLayerIdsState[0] : undefined;
  if (!targetId || !activeFile) {
    zIndexFallback();
    return;
  }
  const owner = codeLayerOwnerByNodeIdRef.current.get(targetId);
  if (!owner || owner.fileId !== activeFile.id) {
    zIndexFallback();
    return;
  }
  const baseContent = getFreshActiveContent();
  const tree = buildCodeLayerTree(buildCodeLayerProjection(baseContent));
  const siblingOrder = findCodeLayerSiblingOrder(tree, targetId);
  if (!siblingOrder || siblingOrder.siblingIds.length < 2) {
    // Nothing to reorder against (only child, or unresolved) — z-index
    // is the only lever left.
    zIndexFallback();
    return;
  }
  const { siblingIds, index, parentId } = siblingOrder;
  const lastIndex = siblingIds.length - 1;

  // Already at the requested end of the stack — no-op.
  if (
    (mode === "front" && index === lastIndex) ||
    (mode === "back" && index === 0) ||
    (mode === "forward" && index === lastIndex) ||
    (mode === "backward" && index === 0)
  ) {
    return;
  }

  let editIntent: MoveNodeEditIntent | null = null;
  if (mode === "forward") {
    // Move DOM-after the next sibling (paints one step higher).
    const nextSiblingId = siblingIds[index + 1];
    if (nextSiblingId) {
      editIntent = {
        kind: "moveNode",
        target: { nodeId: targetId },
        anchor: { nodeId: nextSiblingId },
        placement: "after",
      };
    }
  } else if (mode === "backward") {
    // Move DOM-before the previous sibling (paints one step lower).
    const prevSiblingId = siblingIds[index - 1];
    if (prevSiblingId) {
      editIntent = {
        kind: "moveNode",
        target: { nodeId: targetId },
        anchor: { nodeId: prevSiblingId },
        placement: "before",
      };
    }
  } else if (mode === "front") {
    if (parentId) {
      editIntent = {
        kind: "moveNode",
        target: { nodeId: targetId },
        anchor: { nodeId: parentId },
        placement: "inside",
      };
    } else {
      const lastSiblingId = siblingIds[lastIndex];
      if (lastSiblingId) {
        editIntent = {
          kind: "moveNode",
          target: { nodeId: targetId },
          anchor: { nodeId: lastSiblingId },
          placement: "after",
        };
      }
    }
  } else {
    const firstSiblingId = siblingIds[0];
    if (firstSiblingId) {
      editIntent = {
        kind: "moveNode",
        target: { nodeId: targetId },
        anchor: { nodeId: firstSiblingId },
        placement: "before",
      };
    }
  }

  if (!editIntent) {
    zIndexFallback();
    return;
  }

  const patch = applyVisualEdit(baseContent, editIntent);
  if (patch.result.status !== "applied") {
    zIndexFallback();
    return;
  }
  applyLocalContentUpdate(patch.content, { skipPreview: true });
  const movedNode = patch.projection.nodes.find(
    (n) =>
      n.dataAttributes["data-agent-native-node-id"] === targetId ||
      n.id === targetId,
  );
  if (movedNode) {
    setSelectedElement(elementInfoFromCodeLayerNode(movedNode));
  }
}
