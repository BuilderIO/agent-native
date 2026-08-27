import { applyVisualEdit } from "@shared/code-layer";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import type { ApplyLayoutFlowOutcome } from "@/components/design/edit-panel/style-change-types";
import { codeLayerPatchMessage } from "@/pages/design-editor/code-layer-state";

export interface ApplyLayoutFlowArgs {
  applyLocalContentUpdate: (
    nextContent: string,
    options?: {
      forcePreviewFullDocument?: boolean;
    },
  ) => void;
  canEditDesign: boolean;
  getFreshActiveContent: () => string;
  t: (key: string, options?: Record<string, unknown>) => string;
}

/**
 * Turn a container into a flex or grid layout, reflowing its children the way
 * Shift+A does.
 */
export function runApplyLayoutFlow(
  {
    applyLocalContentUpdate,
    canEditDesign,
    getFreshActiveContent,
    t,
  }: ApplyLayoutFlowArgs,
  nodeId: string,
  containerStyles: Record<string, string>,
): ApplyLayoutFlowOutcome {
  if (!canEditDesign) return "unsupported";
  const baseContent = getFreshActiveContent();
  if (!baseContent) return "unsupported";
  const patch = applyVisualEdit(baseContent, {
    kind: "autoLayout",
    targetId: nodeId,
    enabled: true,
    containerStyles,
  });
  trace("structure", "layout-flow", {
    nodeId,
    properties: Object.keys(containerStyles).join(","),
    status: patch.result.status,
  });
  if (patch.result.status === "applied") {
    if (patch.content !== baseContent) {
      applyLocalContentUpdate(patch.content, {
        forcePreviewFullDocument: true,
      });
    }
    return "applied";
  }
  // "conflict" is the only status that means "not this file's node".
  if (patch.result.status === "conflict") return "unsupported";
  toast.error(
    codeLayerPatchMessage(
      patch.result.message,
      t("designEditor.toasts.layerMoveFailed"),
    ),
    { duration: 4000 },
  );
  return "failed";
}
