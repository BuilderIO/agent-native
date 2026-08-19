import { buildCodeLayerProjection } from "@shared/code-layer";
import { toast } from "sonner";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import { insertClonedHtmlLayer } from "@/pages/design-editor/clone-and-pen-edit";
import {
  codeLayerSelectorAliases,
  resolveCodeLayerNodeFromBridge,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface ScreenVisualDuplicateChangeArgs {
  activeFile: DesignFile;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  canEditDesign: boolean;
  getScreenContent: (screenId: string) => string;
  handleVisualDuplicateChange: (
    selector: string,
    cloneHtml: string,
    elementInfo?: ElementInfo,
    details?: {
      sourceId?: string;
      anchorSelector?: string;
      anchorSourceId?: string;
      placement?: "before" | "after" | "inside";
    },
  ) => boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runScreenVisualDuplicateChange(
  {
    activeFile,
    applyFileContentUpdate,
    canEditDesign,
    getScreenContent,
    handleVisualDuplicateChange,
    t,
  }: ScreenVisualDuplicateChangeArgs,
  screenId: string,
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
  if (screenId === activeFile?.id) {
    return (
      handleVisualDuplicateChange(selector, cloneHtml, elementInfo, details) !==
      false
    );
  }
  if (!canEditDesign) return false;
  const baseContent = getScreenContent(screenId);
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
  applyFileContentUpdate(screenId, nextContent, { skipPreview: true });
  return true;
}
