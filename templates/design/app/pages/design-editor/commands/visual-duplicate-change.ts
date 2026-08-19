import { buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import { insertClonedHtmlLayer } from "@/pages/design-editor/clone-and-pen-edit";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerSelectorAliases,
  elementInfoFromCodeLayerNode,
  preferredCodeLayerSelector,
  resolveCodeLayerNodeFromBridge,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface VisualDuplicateChangeArgs {
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
  getFreshActiveContent: () => string;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runVisualDuplicateChange(
  {
    activeFile,
    applyLocalContentUpdate,
    canEditDesign,
    getFreshActiveContent,
    setSelectedElement,
    setSelectedLayerIdsState,
    t,
  }: VisualDuplicateChangeArgs,
  selector: string,
  cloneHtml: string,
  elementInfo?: ElementInfo,
  details?: {
    sourceId?: string;
    anchorSelector?: string;
    anchorSourceId?: string;
    placement?: "before" | "after" | "inside";
  },
) {
  if (!canEditDesign) return false;
  if (!activeFile) return false;
  const baseContent = getFreshActiveContent();
  const projection = buildCodeLayerProjection(baseContent);
  const targetInfo = elementInfo
    ? {
        ...elementInfo,
        selector,
        sourceId: details?.sourceId ?? elementInfo.sourceId,
      }
    : null;
  const targetNode = targetInfo
    ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
    : resolveCodeLayerNodeFromBridge(projection, selector, details?.sourceId);
  const anchorNode = resolveCodeLayerNodeFromBridge(
    projection,
    details?.anchorSelector,
    details?.anchorSourceId,
  );
  const nextContent = insertClonedHtmlLayer(baseContent, cloneHtml, {
    targetSelectors: targetNode
      ? codeLayerSelectorAliases(targetNode)
      : [selector],
    anchorSelectors: anchorNode
      ? codeLayerSelectorAliases(anchorNode)
      : details?.anchorSelector
        ? [details.anchorSelector]
        : undefined,
    placement: details?.placement ?? "after",
  });
  if (!nextContent) {
    toast.error(t("designEditor.toasts.layerMoveFailed"), {
      duration: 4000,
    });
    return false;
  }
  // Structural insert: a selector-scoped push matches the live clone but
  // not the re-keyed copy in the new source, and the bridge deletes what
  // it cannot match.
  applyLocalContentUpdate(nextContent, {
    refreshPreview: false,
    forcePreviewFullDocument: true,
  });
  const nextProjection = buildCodeLayerProjection(nextContent);
  const nextNode = elementInfo
    ? resolveCodeLayerNodeFromElementInfo(nextProjection, elementInfo)
    : null;
  if (nextNode) {
    setSelectedLayerIdsState([nextNode.id]);
    setSelectedElement({
      ...(elementInfo ?? elementInfoFromCodeLayerNode(nextNode)),
      sourceId: bridgeSourceIdForCodeLayerNode(nextNode),
      selector: preferredCodeLayerSelector(nextNode),
    });
  } else if (elementInfo) {
    setSelectedElement(elementInfo);
  }
  return true;
}
