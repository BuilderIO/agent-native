import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  codeLayerPatchMessage,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import { buildActiveFileNodeIdSet } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface UngroupSelectionArgs {
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
  files: DesignFile[];
  getFreshActiveContent: () => string;
  selectedLayerIdsState: string[];
  sendRuntimeLayerSemanticHandoff: (
    operation: "group" | "ungroup" | "auto-layout",
    layerIds: readonly string[],
    options?: {
      desiredChange?: string;
      description?: string;
      commandContext?: string;
    },
  ) => boolean;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runUngroupSelection({
  activeFile,
  applyLocalContentUpdate,
  canEditDesign,
  codeLayerOwnerByNodeIdRef,
  files,
  getFreshActiveContent,
  selectedLayerIdsState,
  sendRuntimeLayerSemanticHandoff,
  setSelectedElement,
  setSelectedLayerIdsState,
  t,
}: UngroupSelectionArgs) {
  trace("structure", "ungroup", { layers: selectedLayerIdsState.length });
  if (!canEditDesign || !activeFile) return;
  const selectedRuntimeLayerIds = selectedLayerIdsState.filter(
    (layerId) => codeLayerOwnerByNodeIdRef.current.get(layerId)?.runtimeOnly,
  );
  if (selectedRuntimeLayerIds.length > 0) {
    sendRuntimeLayerSemanticHandoff("ungroup", selectedRuntimeLayerIds);
    return;
  }
  const initialContent = getFreshActiveContent();
  // Filter to active-file nodes only (mirrors handleGroupSelection fix).
  // A stale id from another file must not be passed to unwrap or it will
  // fail with "conflict" even though the actual selection is valid.
  const fileIds = new Set(files.map((f) => f.id));
  const activeNodeIdSet = buildActiveFileNodeIdSet(
    buildCodeLayerProjection(initialContent),
  );
  const targetIds = selectedLayerIdsState.filter(
    (id) => !id.startsWith("__") && !fileIds.has(id) && activeNodeIdSet.has(id),
  );
  if (targetIds.length === 0) return;

  let content = initialContent;
  let anySucceeded = false;
  let lastFailureMessage: string | null = null;
  const releasedChildAttrIds = new Set<string>();
  for (const targetId of targetIds) {
    // Resolve the container's current child data-attribute ids from a
    // fresh projection of the running content so ids stay accurate across
    // multiple sequential unwraps in this same loop.
    const runningProjection = buildCodeLayerProjection(content);
    const containerNode = runningProjection.nodes.find(
      (n) =>
        n.dataAttributes["data-agent-native-node-id"] === targetId ||
        n.id === targetId,
    );
    const childNodeIds = containerNode?.children ?? [];
    const childAttrIds = childNodeIds
      .map(
        (childId) =>
          runningProjection.nodes.find((n) => n.id === childId)?.dataAttributes[
            "data-agent-native-node-id"
          ],
      )
      .filter((attrId): attrId is string => Boolean(attrId));

    const patch = applyVisualEdit(content, {
      kind: "unwrap",
      targetId,
    });
    if (patch.result.status !== "applied") {
      lastFailureMessage = patch.result.message ?? lastFailureMessage;
      continue;
    }
    content = patch.content;
    anySucceeded = true;
    childAttrIds.forEach((attrId) => releasedChildAttrIds.add(attrId));
  }

  if (!anySucceeded) {
    toast.error(
      codeLayerPatchMessage(
        lastFailureMessage,
        t("designEditor.toasts.layerMoveFailed"),
      ),
      { duration: 4000 },
    );
    return;
  }
  if (lastFailureMessage) {
    toast.error(
      codeLayerPatchMessage(
        lastFailureMessage,
        t("designEditor.toasts.layerMoveFailed"),
      ),
      { duration: 4000 },
    );
  }

  applyLocalContentUpdate(content, { forcePreviewFullDocument: true });

  const finalProjection = buildCodeLayerProjection(content);
  const releasedNodes = finalProjection.nodes.filter((n) => {
    const attrId = n.dataAttributes["data-agent-native-node-id"];
    return attrId ? releasedChildAttrIds.has(attrId) : false;
  });
  if (releasedNodes.length > 0) {
    setSelectedLayerIdsState(releasedNodes.map((n) => n.id));
    const lastReleasedNode = releasedNodes[releasedNodes.length - 1];
    if (lastReleasedNode) {
      setSelectedElement(elementInfoFromCodeLayerNode(lastReleasedNode));
    }
  } else {
    setSelectedElement(null);
    setSelectedLayerIdsState([]);
  }
}
