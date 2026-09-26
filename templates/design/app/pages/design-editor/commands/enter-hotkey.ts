import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import { buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { ElementInfo } from "@/components/design/types";
import { getOverviewEnterTarget } from "@/pages/design-editor/selection-state";
import {
  scheduleBeginTextEditForScreen,
  type TextEditRepeatIdentity,
} from "@/pages/design-editor/text-edit-utils";
import type { DesignFile } from "@/pages/design-editor/types";

function textEditRepeatForOwner(
  selectedElement: ElementInfo | null,
  owner: { fileId: string; node: CodeLayerNode },
): TextEditRepeatIdentity | undefined {
  if (
    !selectedElement?.repeat ||
    selectedElement.sourceLayerIdentity?.screenId !== owner.fileId ||
    selectedElement.sourceLayerIdentity.nodeId !== owner.node.id
  ) {
    return undefined;
  }
  return {
    sourceSelector: selectedElement.repeat.sourceSelector,
    itemIndex: selectedElement.repeat.itemIndex,
  };
}

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
  selectedElement: ElementInfo | null;
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
  selectedElement,
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
            reopenExisting: true,
            repeat: textEditRepeatForOwner(selectedElement, owner),
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
  if (selectedLayerIdsState.length === 1) {
    const layerId = selectedLayerIdsState[0]!;
    const owner = codeLayerOwnerByNodeIdRef.current.get(layerId);
    const penNodesAttr = owner?.node.dataAttributes["data-an-pen-nodes"];
    const primitive = owner?.node.dataAttributes["data-an-primitive"];
    if (
      owner &&
      (penNodesAttr ||
        ["ellipse", "rect", "rectangle"].includes(primitive ?? "")) &&
      enterVectorEditForSelection(owner)
    ) {
      return;
    }
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
          reopenExisting: true,
          repeat: textEditRepeatForOwner(selectedElement, owner),
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
  const targetProjection = buildCodeLayerProjection(
    getProjectionContentForScreen(target),
    { source: { kind: "design-file", fileId: target } },
  );
  if (targetProjection.rootNodeIds.length > 0) {
    setSelectedLayerIdsState(targetProjection.rootNodeIds);
  }
  setActiveFileId(target);
}
