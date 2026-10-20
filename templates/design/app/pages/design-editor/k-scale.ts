import {
  applyVisualEdit,
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
  | { status: "unresolved"; selector: string }
  | { status: "failed"; selector: string; reason: string };

const BOX_SHORTHAND_LONGHANDS: Record<string, readonly string[]> = {
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  gap: ["row-gap", "column-gap"],
  "border-radius": [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ],
};

// K writes every side of a box it scales; the shorthand it leaves behind is dead text.
function removeSupersededShorthands(
  content: string,
  scaled: ReadonlyArray<{ nodeId: string; properties: readonly string[] }>,
  source: CodeLayerSource,
): string {
  let next = content;
  for (const { nodeId, properties } of scaled) {
    const written = new Set(
      properties.map((property) =>
        property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      ),
    );
    for (const [shorthand, longhands] of Object.entries(
      BOX_SHORTHAND_LONGHANDS,
    )) {
      if (!longhands.every((longhand) => written.has(longhand))) continue;
      const removed = applyVisualEdit(
        next,
        {
          kind: "style",
          operation: "remove",
          target: { nodeId },
          property: shorthand,
        },
        { source },
      );
      if (removed.result.status === "applied") next = removed.content;
    }
  }
  return next;
}

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
      return { status: "unresolved", selector: change.selector };
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
    return {
      status: "applied",
      content: removeSupersededShorthands(
        batch.content,
        scaledNodes(batchEdits),
        source,
      ),
    };
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
  const scaled: Array<{ nodeId: string; properties: string[] }> = [];
  for (const change of activeChanges) {
    const currentProjection = buildCodeLayerProjection(nextContent, { source });
    const resolved = resolveCodeLayerTargetFromBridge(
      currentProjection,
      change.selector,
      change.sourceId,
    );
    if (resolved.status !== "resolved") {
      return { status: "unresolved", selector: change.selector };
    }

    scaled.push({
      nodeId: resolved.node.id,
      properties: Object.keys(change.styles),
    });
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

  return {
    status: "applied",
    content: removeSupersededShorthands(nextContent, scaled, source),
  };
}

function scaledNodes(
  edits: ReadonlyArray<{ target: { nodeId: string }; property: string }>,
) {
  const byNode = new Map<string, string[]>();
  for (const { target, property } of edits) {
    byNode.set(target.nodeId, [...(byNode.get(target.nodeId) ?? []), property]);
  }
  return [...byNode].map(([nodeId, properties]) => ({ nodeId, properties }));
}
