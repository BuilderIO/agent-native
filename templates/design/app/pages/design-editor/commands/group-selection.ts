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

export interface GroupSelectionArgs {
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

export function runGroupSelection({
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
}: GroupSelectionArgs) {
  trace("structure", "group", { layers: selectedLayerIdsState.length });
  if (!canEditDesign || !activeFile) return;
  const selectedRuntimeLayerIds = selectedLayerIdsState.filter(
    (layerId) => codeLayerOwnerByNodeIdRef.current.get(layerId)?.runtimeOnly,
  );
  if (selectedRuntimeLayerIds.length > 0) {
    sendRuntimeLayerSemanticHandoff("group", selectedRuntimeLayerIds);
    return;
  }
  const baseContent = getFreshActiveContent();
  // Collect the DOM-node layer ids that belong to the active screen.
  // Build a set of ids present in the active content so stale ids from
  // other files (which can persist in selectedLayerIdsState after a
  // cross-screen layers-panel selection) are excluded before wrapNodes
  // runs against activeContent. Without this filter, cross-file ids
  // cause wrapNodes to return "conflict" even for a valid same-file
  // selection.
  const fileIds = new Set(files.map((f) => f.id));
  const activeNodeIdSet = buildActiveFileNodeIdSet(
    buildCodeLayerProjection(baseContent),
  );
  const nodeIds = selectedLayerIdsState.filter(
    (id) => !id.startsWith("__") && !fileIds.has(id) && activeNodeIdSet.has(id),
  );
  if (nodeIds.length < 2) return;
  const patch = applyVisualEdit(baseContent, {
    kind: "wrapNodes",
    targetIds: nodeIds,
    autoLayout: false,
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
  applyLocalContentUpdate(patch.content, { forcePreviewFullDocument: true });
  // Select the new wrapper node if the substrate reported its id.
  const wrapperId = patch.result.wrapperNodeId;
  if (wrapperId) {
    // Find the projection node whose data-agent-native-node-id matches.
    const wrapperNode = patch.projection.nodes.find(
      (n) => n.dataAttributes["data-agent-native-node-id"] === wrapperId,
    );
    if (wrapperNode) {
      setSelectedLayerIdsState([wrapperNode.id]);
      setSelectedElement(elementInfoFromCodeLayerNode(wrapperNode));
    }
  }
}
