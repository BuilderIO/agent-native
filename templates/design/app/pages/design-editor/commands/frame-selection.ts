import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  codeLayerPatchMessage,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import { setCodeLayerAttributeInHtml } from "@/pages/design-editor/html-layer-positioning";
import { buildActiveFileNodeIdSet } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

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
    },
  ) => void;
  canEditDesign: boolean;
  files: DesignFile[];
  getFreshActiveContent: () => string;
  selectedLayerIdsState: string[];
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runFrameSelection({
  activeFile,
  applyLocalContentUpdate,
  canEditDesign,
  files,
  getFreshActiveContent,
  selectedLayerIdsState,
  setSelectedElement,
  setSelectedLayerIdsState,
  t,
}: FrameSelectionArgs) {
  if (!canEditDesign || !activeFile) return;
  const baseContent = getFreshActiveContent();
  const fileIds = new Set(files.map((f) => f.id));
  const activeNodeIdSet = buildActiveFileNodeIdSet(
    buildCodeLayerProjection(baseContent),
  );
  const nodeIds = selectedLayerIdsState.filter(
    (id) => !id.startsWith("__") && !fileIds.has(id) && activeNodeIdSet.has(id),
  );
  if (nodeIds.length < 1) return;
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
  applyLocalContentUpdate(nextContent, { forcePreviewFullDocument: true });
  if (wrapperNode) {
    setSelectedLayerIdsState([wrapperNode.id]);
    setSelectedElement(elementInfoFromCodeLayerNode(wrapperNode));
  }
}
