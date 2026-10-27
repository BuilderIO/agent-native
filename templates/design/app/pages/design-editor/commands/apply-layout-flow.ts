import { applyVisualEdit, type CodeLayerSource } from "@shared/code-layer";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import type {
  ApplyLayoutFlowOutcome,
  LayoutNodePatches,
} from "@/components/design/edit-panel/style-change-types";
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
  source?: CodeLayerSource;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runApplyLayoutFlow(
  {
    applyLocalContentUpdate,
    canEditDesign,
    getFreshActiveContent,
    source,
    t,
  }: ApplyLayoutFlowArgs,
  nodeIds: readonly string[],
  containerStyles: Record<string, string>,
  nodePatches?: LayoutNodePatches,
): ApplyLayoutFlowOutcome {
  const appliesFlow = Object.keys(containerStyles).length > 0;
  if (!canEditDesign || (appliesFlow && nodeIds.length === 0)) {
    return "unsupported";
  }
  const baseContent = getFreshActiveContent();
  if (!baseContent) return "unsupported";

  let content = baseContent;
  let applied = 0;
  let failed = 0;
  const fail = (message: string | undefined) => {
    failed += 1;
    toast.error(
      codeLayerPatchMessage(message, t("designEditor.toasts.layerMoveFailed")),
      { duration: 4000 },
    );
  };
  for (const nodeId of appliesFlow ? nodeIds : []) {
    const patch = applyVisualEdit(
      content,
      {
        kind: "autoLayout",
        targetId: nodeId,
        enabled: true,
        containerStyles,
      },
      {
        ...(source ? { source } : {}),
      },
    );
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
    if (patch.result.status !== "conflict") fail(patch.result.message);
  }

  // A frame and the children its change freezes land together or not at all:
  // half of a Hug edit leaves the circular sizing it exists to prevent.
  if (failed === 0 && nodePatches) {
    let patched = content;
    for (const [nodeId, styles] of nodePatches) {
      for (const [property, value] of Object.entries(styles)) {
        const edit = applyVisualEdit(
          patched,
          value === null
            ? {
                kind: "style",
                operation: "remove",
                target: { nodeId },
                property,
              }
            : { kind: "style", target: { nodeId }, property, value },
          { ...(source ? { source } : {}) },
        );
        if (edit.result.status !== "applied") {
          trace("structure", "layout-patch-refused", {
            nodeId,
            property,
            status: edit.result.status,
          });
          fail(edit.result.message);
          return "failed";
        }
        patched = edit.content;
      }
    }
    content = patched;
  }

  if ((failed === 0 || applied > 0) && content !== baseContent) {
    applyLocalContentUpdate(content, { forcePreviewFullDocument: true });
  }
  if (failed > 0) return "failed";
  if (!appliesFlow) return "applied";
  return applied === nodeIds.length ? "applied" : "unsupported";
}
