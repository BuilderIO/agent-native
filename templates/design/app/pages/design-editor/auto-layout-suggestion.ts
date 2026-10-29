import { inferFlowArrangement } from "@agent-native/toolkit/canvas-interactions/layout-model";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  type CodeLayerSource,
} from "@shared/code-layer";

import type { AlignableRect } from "./layout-operations";

export interface AutoLayoutInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface AutoLayoutSuggestion {
  containerId: string;
  direction: "row" | "column";
  orderedChildIds: string[];
  gap: number;
  padding: AutoLayoutInsets;
  alignItems: "flex-start" | "center" | "flex-end" | "stretch";
  justifyContent: "flex-start" | "space-between";
  horizontalSizing: "fixed" | "hug";
  verticalSizing: "fixed" | "hug";
  confidence: number;
  safeToApply: boolean;
  warnings: Array<"overlap" | "irregular" | "transformed">;
}

export interface SuggestionRect extends AlignableRect {
  transformed?: boolean;
}

export function hasMeaningfulCssTransform(styles: {
  transform?: string;
  rotate?: string;
  scale?: string;
  classes?: readonly string[];
}): boolean {
  const transform = styles.transform?.trim().toLowerCase();
  const rotate = styles.rotate?.trim().toLowerCase();
  const scale = styles.scale?.trim().toLowerCase();
  const hasTransformUtility = (styles.classes ?? []).some((className) => {
    const classParts = className.split(":");
    const utility = classParts[classParts.length - 1] ?? className;
    return /^(?:-?(?:rotate|scale|skew|translate)(?:-[xy])?-.+|transform-(?:gpu|cpu))$/.test(
      utility,
    );
  });
  return Boolean(
    (transform && transform !== "none") ||
    (rotate && rotate !== "none" && rotate !== "0deg" && rotate !== "0") ||
    (scale && scale !== "none" && scale !== "1" && scale !== "1 1") ||
    hasTransformUtility,
  );
}

export function isExistingFlowLayout(args: {
  display?: string;
  computedDisplay?: string | null;
  classes?: readonly string[];
}): boolean {
  const display = (args.computedDisplay || args.display || "")
    .trim()
    .toLowerCase();
  if (["flex", "inline-flex", "grid", "inline-grid"].includes(display)) {
    return true;
  }
  return (args.classes ?? []).some((className) =>
    /(?:^|:)(?:inline-)?(?:flex|grid)$/.test(className),
  );
}

export function inferAutoLayoutSuggestion(args: {
  container: AlignableRect;
  children: readonly SuggestionRect[];
}): AutoLayoutSuggestion | null {
  const arrangement = inferFlowArrangement(
    args.container,
    args.children.map((child) => ({ id: child.id, rect: child })),
  );
  if (!arrangement) return null;
  const arranged = new Set(arrangement.order);
  const transformed = args.children.some(
    (child) => arranged.has(child.id) && child.transformed,
  );
  const { overlaps, irregular } = arrangement;
  const warnings: AutoLayoutSuggestion["warnings"] = [];
  if (overlaps) warnings.push("overlap");
  if (irregular) warnings.push("irregular");
  if (transformed) warnings.push("transformed");
  const confidence = Math.max(
    0,
    Math.min(
      1,
      0.98 -
        (overlaps ? 0.45 : 0) -
        (irregular ? 0.18 : 0) -
        (transformed ? 0.3 : 0),
    ),
  );

  return {
    containerId: args.container.id,
    direction: arrangement.direction === "horizontal" ? "row" : "column",
    orderedChildIds: arrangement.order,
    gap: arrangement.gap,
    padding: arrangement.padding,
    alignItems: arrangement.alignItems,
    justifyContent: arrangement.justifyContent,
    horizontalSizing: arrangement.hugs.horizontal ? "hug" : "fixed",
    verticalSizing: arrangement.hugs.vertical ? "hug" : "fixed",
    confidence,
    safeToApply: !overlaps && !transformed,
    warnings,
  };
}

export type ApplyAutoLayoutSuggestionResult =
  | { status: "applied"; content: string }
  | { status: "conflict" | "failed"; content: string; message?: string };

export function applyAutoLayoutSuggestion(
  content: string,
  suggestion: AutoLayoutSuggestion,
  source?: CodeLayerSource,
): ApplyAutoLayoutSuggestionResult {
  if (!suggestion.safeToApply) {
    return { status: "failed", content, message: "unsafe-suggestion" };
  }
  const initialProjection = buildCodeLayerProjection(content, {
    ...(source ? { source } : {}),
  });
  const container = initialProjection.nodes.find(
    (node) =>
      node.id === suggestion.containerId ||
      node.dataAttributes["data-agent-native-node-id"] ===
        suggestion.containerId,
  );
  if (!container) return { status: "conflict", content };
  const resolveNodeId = (requestedId: string) =>
    initialProjection.nodes.find(
      (node) =>
        node.id === requestedId ||
        node.dataAttributes["data-agent-native-node-id"] === requestedId,
    )?.id;
  const orderedChildIds = suggestion.orderedChildIds.map(resolveNodeId);
  if (orderedChildIds.some((id) => !id)) {
    return { status: "conflict", content, message: "children-changed" };
  }
  const resolvedOrderedChildIds = orderedChildIds as string[];
  const currentChildren = new Set(container.children);
  if (
    currentChildren.size !== resolvedOrderedChildIds.length ||
    resolvedOrderedChildIds.some((id) => !currentChildren.has(id))
  ) {
    return { status: "conflict", content, message: "children-changed" };
  }

  let nextContent = content;
  for (let index = 1; index < resolvedOrderedChildIds.length; index += 1) {
    const moved = applyVisualEdit(
      nextContent,
      {
        kind: "moveNode",
        target: { nodeId: resolvedOrderedChildIds[index]! },
        anchor: { nodeId: resolvedOrderedChildIds[index - 1]! },
        placement: "after",
      },
      {
        ...(source ? { source } : {}),
      },
    );
    if (moved.result.status === "applied") nextContent = moved.content;
    else {
      return { status: "failed", content, message: moved.result.message };
    }
  }

  const autoLayout = applyVisualEdit(
    nextContent,
    {
      kind: "autoLayout",
      targetId: container.id,
      enabled: true,
      direction: suggestion.direction,
      gap: `${suggestion.gap}px`,
    },
    {
      ...(source ? { source } : {}),
    },
  );
  if (autoLayout.result.status !== "applied") {
    return { status: "failed", content, message: autoLayout.result.message };
  }
  nextContent = autoLayout.content;

  const styleValues: Array<[string, string]> = [
    [
      "padding",
      `${suggestion.padding.top}px ${suggestion.padding.right}px ${suggestion.padding.bottom}px ${suggestion.padding.left}px`,
    ],
    ["align-items", suggestion.alignItems],
    ["justify-content", suggestion.justifyContent],
    ...(suggestion.horizontalSizing === "hug"
      ? ([["width", "fit-content"]] as Array<[string, string]>)
      : []),
    ...(suggestion.verticalSizing === "hug"
      ? ([["height", "fit-content"]] as Array<[string, string]>)
      : []),
  ];
  for (const [property, value] of styleValues) {
    const styled = applyVisualEdit(
      nextContent,
      {
        kind: "style",
        target: { nodeId: container.id },
        property,
        value,
      },
      {
        ...(source ? { source } : {}),
      },
    );
    if (styled.result.status === "applied") nextContent = styled.content;
    else {
      return { status: "failed", content, message: styled.result.message };
    }
  }
  return { status: "applied", content: nextContent };
}
