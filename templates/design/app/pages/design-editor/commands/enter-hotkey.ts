import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import { buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { getOverviewEnterTarget } from "@/pages/design-editor/selection-state";
import { scheduleBeginTextEditForScreen } from "@/pages/design-editor/text-edit-utils";
import type { DesignFile } from "@/pages/design-editor/types";

export interface EnterHotkeyArgs {
  SINGLE_MODE_TEXT_TAGS: Set<string>;
  activeFile: DesignFile;
  activeFileId: string | null;
  boardFileId: string | undefined;
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
  enterVectorEditForSelection: (owner: {
    fileId: string;
    node: CodeLayerNode;
  }) => boolean;
  getProjectionContentForScreen: (screenId: string) => string;
  overviewSelectedScreenIds: string[];
  selectCodeLayerNodesForHotkey: (
    fileId: string,
    nodes: CodeLayerNode[],
    expandedIds?: readonly string[],
  ) => boolean;
  selectedLayerIdsState: string[];
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  viewMode: "single" | "overview";
}

export function runEnterHotkey({
  SINGLE_MODE_TEXT_TAGS,
  activeFile,
  activeFileId,
  boardFileId,
  codeLayerOwnerByNodeIdRef,
  enterVectorEditForSelection,
  getProjectionContentForScreen,
  overviewSelectedScreenIds,
  selectCodeLayerNodesForHotkey,
  selectedLayerIdsState,
  setActiveFileId,
  setSelectedLayerIdsState,
  viewMode,
}: EnterHotkeyArgs) {
  if (viewMode !== "overview") {
    if (selectedLayerIdsState.length === 1) {
      const layerId = selectedLayerIdsState[0]!;
      const owner = codeLayerOwnerByNodeIdRef.current.get(layerId);
      if (owner && owner.fileId === (activeFile?.id ?? activeFileId)) {
        const isTextNode =
          SINGLE_MODE_TEXT_TAGS.has(owner.node.tag) ||
          owner.node.dataAttributes["data-an-primitive"] === "text";
        if (isTextNode) {
          const nodeAttrId =
            owner.node.dataAttributes["data-agent-native-node-id"] ??
            owner.node.id;
          scheduleBeginTextEditForScreen(owner.fileId, nodeAttrId, {
            boardFileId,
          });
          return;
        }
        const childNodes = owner.node.children
          .map(
            (childId) => codeLayerOwnerByNodeIdRef.current.get(childId)?.node,
          )
          .filter((node): node is CodeLayerNode => Boolean(node));
        if (
          selectCodeLayerNodesForHotkey(owner.fileId, childNodes, [
            owner.node.id,
          ])
        ) {
          return;
        }
      }
    }
    return;
  }
  // P5/vector-edit: Enter on a single selected committed pen path (has
  // data-an-pen-nodes — see setPenNodesAttributeOnElement) enters vector
  // edit mode instead of drilling into the owning screen. Vector edit's
  // overlay only exists on MultiScreenCanvas (overview), so this
  // deliberately only fires here — see enterVectorEditForSelection's doc
  // comment for the single-screen deferral.
  if (selectedLayerIdsState.length === 1) {
    const layerId = selectedLayerIdsState[0]!;
    const owner = codeLayerOwnerByNodeIdRef.current.get(layerId);
    const penNodesAttr = owner?.node.dataAttributes["data-an-pen-nodes"];
    if (owner && penNodesAttr && enterVectorEditForSelection(owner)) {
      return;
    }
    // Figma parity: Enter on a selected TEXT layer always begins inline
    // text editing, in overview mode too — not just single-screen mode
    // (see the T22 branch above). Reuses the exact same owner lookup /
    // SINGLE_MODE_TEXT_TAGS / data-an-primitive==="text" classification
    // and scheduleBeginTextEditForScreen path; only the screen-drill
    // fallback below is skipped when the selected layer is text.
    if (owner) {
      const isTextNode =
        SINGLE_MODE_TEXT_TAGS.has(owner.node.tag) ||
        owner.node.dataAttributes["data-an-primitive"] === "text";
      if (isTextNode) {
        const nodeAttrId =
          owner.node.dataAttributes["data-agent-native-node-id"] ??
          owner.node.id;
        scheduleBeginTextEditForScreen(owner.fileId, nodeAttrId, {
          boardFileId,
        });
        return;
      }
      const childNodes = owner.node.children
        .map((childId) => codeLayerOwnerByNodeIdRef.current.get(childId)?.node)
        .filter((node): node is CodeLayerNode => Boolean(node));
      if (
        selectCodeLayerNodesForHotkey(owner.fileId, childNodes, [owner.node.id])
      ) {
        return;
      }
    }
  }
  const target = getOverviewEnterTarget({
    activeFileId: activeFile?.id ?? activeFileId,
    overviewSelectedScreenIds,
  });
  if (!target) return;
  // Ground-truth Figma: Enter on a screen/container selects ALL of its
  // direct children (not just the first) in addition to drilling in.
  // rootNodeIds from the screen's own code-layer projection are exactly
  // its direct children (nodes with no parent, i.e. direct children of
  // <body>) — the same ids setSelectedLayerIdsState already accepts
  // elsewhere (e.g. after insert/paste).
  const targetProjection = buildCodeLayerProjection(
    getProjectionContentForScreen(target),
  );
  if (targetProjection.rootNodeIds.length > 0) {
    setSelectedLayerIdsState(targetProjection.rootNodeIds);
  }
  // Drill-in selects the screen's children and stays on the infinite canvas.
  // It used to also switch to a focused single-screen view — that view no
  // longer exists (the only two views are the canvas and the responsive
  // interactive one), and routing this through the focused view now would
  // land the user in Interact, where there is no selection at all.
  setActiveFileId(target);
}
