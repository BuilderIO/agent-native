import {
  buildCodeLayerProjection,
  type CodeLayerSource,
} from "@shared/code-layer";

import type { KScaleStyleChange } from "@/components/design/multi-screen/types";
import { resolveCodeLayerTargetFromBridge } from "@/pages/design-editor/code-layer-state";
import {
  applyScopedVisualStyleBatch,
  applyScopedVisualStyleEdit,
} from "@/pages/design-editor/pending-edits";

export type KScaleStylePatchResult =
  | { status: "applied"; content: string }
  | { status: "failed"; selector: string; reason: string };

export function applyKScaleStyleChanges(
  content: string,
  changes: readonly KScaleStyleChange[],
  source: CodeLayerSource = { kind: "inline-html" },
): KScaleStylePatchResult {
  const activeChanges = changes.filter(
    (change) => Object.keys(change.styles).length > 0,
  );
  if (activeChanges.length === 0) return { status: "applied", content };

  const projection = buildCodeLayerProjection(content, { source });
  const batchEdits: Array<{
    target: { nodeId: string };
    property: string;
    value: string;
    selector: string;
  }> = [];

  for (const change of activeChanges) {
    const resolved = resolveCodeLayerTargetFromBridge(
      projection,
      change.selector,
      change.sourceId,
    );
    if (resolved.status !== "resolved") {
      return {
        status: "failed",
        selector: change.selector,
        reason: resolved.status,
      };
    }
    for (const [property, value] of Object.entries(change.styles)) {
      batchEdits.push({
        target: { nodeId: resolved.node.id },
        property,
        value,
        selector: change.selector,
      });
    }
  }

  const batch = applyScopedVisualStyleBatch({
    content,
    source,
    edits: batchEdits.map(({ target, property, value }) => ({
      target,
      property,
      value,
    })),
  });
  if (batch.status === "applied") {
    return { status: "applied", content: batch.content };
  }
  if (batch.status === "failed") {
    return {
      status: "failed",
      selector:
        batchEdits[batch.editIndex]?.selector ?? activeChanges[0]!.selector,
      reason: batch.reason,
    };
  }

  // Semantic SVG/Boolean edits keep the established per-style dispatcher. Start
  // from the original gesture source so fallback cannot retain a partial batch.
  // ponytail: mixed semantic gestures reparse per property; batching their
  // specialized serializers removes that ceiling.
  let nextContent = content;
  for (const change of activeChanges) {
    const currentProjection = buildCodeLayerProjection(nextContent, { source });
    const resolved = resolveCodeLayerTargetFromBridge(
      currentProjection,
      change.selector,
      change.sourceId,
    );
    if (resolved.status !== "resolved") {
      return {
        status: "failed",
        selector: change.selector,
        reason: resolved.status,
      };
    }

    for (const [property, value] of Object.entries(change.styles)) {
      const patch = applyScopedVisualStyleEdit({
        content: nextContent,
        target: { nodeId: resolved.node.id },
        property,
        value,
        source,
        upperBoundPx: null,
      });
      if (patch.result.status !== "applied") {
        return {
          status: "failed",
          selector: change.selector,
          reason: patch.result.message ?? "style edit rejected",
        };
      }
      nextContent = patch.content;
    }
  }

  return { status: "applied", content: nextContent };
}
