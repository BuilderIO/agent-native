import type { CodeLayerSource } from "@shared/code-layer";
import { applyVisualEdit } from "@shared/code-layer";
import { readLayoutModel } from "@agent-native/toolkit/canvas-interactions/layout-model";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import { codeLayerPatchMessage } from "@/pages/design-editor/code-layer-state";
import type {
  FrameMeasurement,
  MeasuredFrame,
} from "@/pages/design-editor/measure-child-rects";

import type { ApplyLocalContentUpdateResult } from "./apply-local-content-update";

export interface RemoveAutoLayoutArgs {
  applyLocalContentUpdate: (
    nextContent: string,
    options?: { forcePreviewFullDocument?: boolean },
  ) => ApplyLocalContentUpdateResult;
  baseContent: string;
  measure: (nodeId: string) => FrameMeasurement;
  nodeIds: readonly string[];
  source: CodeLayerSource;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function laysOut(frame: MeasuredFrame): boolean {
  return (
    readLayoutModel({
      node: { id: null, styles: { display: frame.display } },
      parent: null,
      children: { status: "unreadable", childCount: null, hasText: null },
    }).frame.mode !== "none"
  );
}

/**
 * Freezes every selected auto layout frame's children where they render, so
 * they can be moved by hand. Every frame is measured before any is patched:
 * the preview still shows the pre-removal layout until the batch publishes.
 */
export function runRemoveAutoLayout({
  applyLocalContentUpdate,
  baseContent,
  measure,
  nodeIds,
  source,
  t,
}: RemoveAutoLayoutArgs): "applied" | "nothing" | "failed" {
  const targets: Array<{ nodeId: string; frame: MeasuredFrame }> = [];
  for (const nodeId of nodeIds) {
    const frame = measure(nodeId);
    // A child nothing can address would stay in flow inside a block frame,
    // so a frame that is not fully measured is refused, not half frozen.
    if (frame.status !== "measured" || frame.unidentifiedChildren > 0) {
      trace("structure", "freeform-refused", {
        nodeId,
        reason:
          frame.status === "measured" ? "unidentified-children" : frame.reason,
      });
      toast.error(t("designEditor.toasts.layoutUnmeasurable"), {
        duration: 4000,
      });
      return "failed";
    }
    if (laysOut(frame)) targets.push({ nodeId, frame });
  }
  if (targets.length === 0) return "nothing";

  let nextContent = baseContent;
  for (const { nodeId, frame } of targets) {
    const patch = applyVisualEdit(
      nextContent,
      {
        kind: "autoLayout",
        targetId: nodeId,
        enabled: false,
        childRects: Object.fromEntries(
          frame.children.map((child) => [child.id, child.rect]),
        ),
        containerRect: frame.size,
      },
      { source },
    );
    trace("structure", "freeform", {
      nodeId,
      measuredChildren: frame.children.length,
      status: patch.result.status,
    });
    if (patch.result.status !== "applied") {
      toast.error(
        codeLayerPatchMessage(
          patch.result.message,
          t("designEditor.toasts.removeAutoLayoutFailed"),
        ),
        { duration: 4000 },
      );
      return "failed";
    }
    nextContent = patch.content;
  }
  applyLocalContentUpdate(nextContent, { forcePreviewFullDocument: true });
  return "applied";
}
