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
  nodeIds: readonly string[],
  containerStyles: Record<string, string>,
): ApplyLayoutFlowOutcome {
  if (!canEditDesign || nodeIds.length === 0) return "unsupported";
  const baseContent = getFreshActiveContent();
  if (!baseContent) return "unsupported";

  // One accumulating content string, one update: a multi-selection conversion
  // is a single undo step, like every other batched layer commit.
  let content = baseContent;
  let applied = 0;
  let failed = 0;
  for (const nodeId of nodeIds) {
    const patch = applyVisualEdit(content, {
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
      content = patch.content;
      applied += 1;
      continue;
    }
    // "conflict" is the only status that means "not this file's node".
    if (patch.result.status !== "conflict") {
      failed += 1;
      toast.error(
        codeLayerPatchMessage(
          patch.result.message,
          t("designEditor.toasts.layerMoveFailed"),
        ),
        { duration: 4000 },
      );
    }
  }

  if (applied > 0 && content !== baseContent) {
    applyLocalContentUpdate(content, { forcePreviewFullDocument: true });
  }
  if (failed > 0) return "failed";
  return applied === nodeIds.length ? "applied" : "unsupported";
}
