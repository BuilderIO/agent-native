import { applyVisualEdit } from "@shared/code-layer";

import { trace } from "@/components/design/design-trace";

export interface ApplyLayoutFlowArgs {
  applyLocalContentUpdate: (
    nextContent: string,
    options?: {
      forcePreviewFullDocument?: boolean;
    },
  ) => void;
  canEditDesign: boolean;
  getFreshActiveContent: () => string;
}

/**
 * Turn a container into a flex or grid layout, reflowing its children the way
 * Shift+A does. Returns false when the node is not editable inline source
 * (runtime-backed screens, another file's node) so the caller can fall back to
 * writing the container styles alone.
 */
export function runApplyLayoutFlow(
  {
    applyLocalContentUpdate,
    canEditDesign,
    getFreshActiveContent,
  }: ApplyLayoutFlowArgs,
  nodeId: string,
  containerStyles: Record<string, string>,
): boolean {
  if (!canEditDesign) return false;
  const baseContent = getFreshActiveContent();
  if (!baseContent) return false;
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
  if (patch.result.status !== "applied") return false;
  if (patch.content !== baseContent) {
    applyLocalContentUpdate(patch.content, { forcePreviewFullDocument: true });
  }
  return true;
}
