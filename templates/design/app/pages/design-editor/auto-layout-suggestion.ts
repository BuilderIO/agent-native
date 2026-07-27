import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";

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

const round = (value: number) => Math.max(0, Math.round(value));
const FLEX_ALIGN_STRETCH = "stretch"; // i18n-ignore CSS keyword
const FLEX_ALIGN_END = "flex-end"; // i18n-ignore CSS keyword
const FLEX_ALIGN_START = "flex-start"; // i18n-ignore CSS keyword
const FLEX_ALIGN_CENTER = "center"; // i18n-ignore CSS keyword

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function relativeVariance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (Math.abs(average) < 1) return 0;
  return (
    values.reduce((sum, value) => sum + Math.abs(value - average), 0) /
    values.length /
    Math.abs(average)
  );
}

/**
 * Infer a reversible flex layout from measured, direct-child geometry.
 * This intentionally refuses grid-like/overlapping arrangements instead of
 * silently flattening a design that a one-dimensional flex layout cannot
 * faithfully reproduce.
 */
export function inferAutoLayoutSuggestion(args: {
  container: AlignableRect;
  children: readonly SuggestionRect[];
}): AutoLayoutSuggestion | null {
  const children = args.children.filter(
    (child) =>
      Number.isFinite(child.x) &&
      Number.isFinite(child.y) &&
      Number.isFinite(child.width) &&
      Number.isFinite(child.height) &&
      child.width >= 0 &&
      child.height >= 0,
  );
  if (children.length === 0) return null;

  const minX = Math.min(...children.map((child) => child.x));
  const maxX = Math.max(...children.map((child) => child.x + child.width));
  const minY = Math.min(...children.map((child) => child.y));
  const maxY = Math.max(...children.map((child) => child.y + child.height));
  const spreadX = maxX - minX;
  const spreadY = maxY - minY;
  const direction: "row" | "column" =
    children.length === 1 ? "column" : spreadX >= spreadY ? "row" : "column";
  const primaryStart = (child: SuggestionRect) =>
    direction === "row" ? child.x : child.y;
  const primarySize = (child: SuggestionRect) =>
    direction === "row" ? child.width : child.height;
  const crossStart = (child: SuggestionRect) =>
    direction === "row" ? child.y : child.x;
  const crossSize = (child: SuggestionRect) =>
    direction === "row" ? child.height : child.width;
  const ordered = [...children].sort(
    (a, b) => primaryStart(a) - primaryStart(b) || a.id.localeCompare(b.id),
  );
  const rawGaps = ordered.slice(1).map((child, index) => {
    const previous = ordered[index]!;
    return (
      primaryStart(child) - (primaryStart(previous) + primarySize(previous))
    );
  });
  const overlaps = rawGaps.some((gap) => gap < -1);
  const positiveGaps = rawGaps.filter((gap) => gap >= 0);
  const gap =
    children.length === 1
      ? 10
      : round(median(positiveGaps.length ? positiveGaps : [0]));
  const irregular = relativeVariance(positiveGaps) > 0.35;
  const transformed = children.some((child) => child.transformed);

  const padding = {
    top: round(minY - args.container.y),
    right: round(args.container.x + args.container.width - maxX),
    bottom: round(args.container.y + args.container.height - maxY),
    left: round(minX - args.container.x),
  };

  const crossContainerStart =
    direction === "row" ? args.container.y : args.container.x;
  const crossContainerSize =
    direction === "row" ? args.container.height : args.container.width;
  const crossCenters = children.map(
    (child) => crossStart(child) + crossSize(child) / 2,
  );
  const averageCrossCenter =
    crossCenters.reduce((sum, value) => sum + value, 0) / crossCenters.length;
  const normalizedCross =
    crossContainerSize > 0
      ? (averageCrossCenter - crossContainerStart) / crossContainerSize
      : 0;
  const innerCrossSize = Math.max(
    0,
    crossContainerSize -
      (direction === "row"
        ? padding.top + padding.bottom
        : padding.left + padding.right),
  );
  const stretches = children.every(
    (child) => Math.abs(crossSize(child) - innerCrossSize) <= 2,
  );
  const alignItems = stretches
    ? FLEX_ALIGN_STRETCH
    : normalizedCross > 0.58 // i18n-ignore geometry threshold, no visible copy
      ? FLEX_ALIGN_END
      : normalizedCross < 0.42
        ? FLEX_ALIGN_START
        : FLEX_ALIGN_CENTER;

  const primaryLeading = direction === "row" ? padding.left : padding.top;
  const primaryTrailing = direction === "row" ? padding.right : padding.bottom;
  const justifyContent =
    children.length > 2 &&
    relativeVariance(positiveGaps) <= 0.08 &&
    Math.abs(primaryLeading - primaryTrailing) <= 2
      ? "space-between"
      : "flex-start";
  const tightWidth =
    Math.abs(args.container.width - (spreadX + padding.left + padding.right)) <=
    2;
  const tightHeight =
    Math.abs(
      args.container.height - (spreadY + padding.top + padding.bottom),
    ) <= 2;

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
    direction,
    orderedChildIds: ordered.map((child) => child.id),
    gap,
    padding,
    alignItems,
    justifyContent,
    horizontalSizing: tightWidth ? "hug" : "fixed",
    verticalSizing: tightHeight ? "hug" : "fixed",
    confidence,
    safeToApply: !overlaps && !transformed,
    warnings,
  };
}

export type ApplyAutoLayoutSuggestionResult =
  | { status: "applied"; content: string }
  | { status: "conflict" | "failed"; content: string; message?: string };

/** Apply the reviewed proposal atomically from the caller's perspective. */
export function applyAutoLayoutSuggestion(
  content: string,
  suggestion: AutoLayoutSuggestion,
): ApplyAutoLayoutSuggestionResult {
  if (!suggestion.safeToApply) {
    return { status: "failed", content, message: "unsafe-suggestion" };
  }
  const initialProjection = buildCodeLayerProjection(content);
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
    const moved = applyVisualEdit(nextContent, {
      kind: "moveNode",
      target: { nodeId: resolvedOrderedChildIds[index]! },
      anchor: { nodeId: resolvedOrderedChildIds[index - 1]! },
      placement: "after",
    });
    if (moved.result.status === "applied") nextContent = moved.content;
    else {
      return { status: "failed", content, message: moved.result.message };
    }
  }

  const autoLayout = applyVisualEdit(nextContent, {
    kind: "autoLayout",
    targetId: container.id,
    enabled: true,
    direction: suggestion.direction,
    gap: `${suggestion.gap}px`,
  });
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
    const styled = applyVisualEdit(nextContent, {
      kind: "style",
      target: { nodeId: container.id },
      property,
      value,
    });
    if (styled.result.status === "applied") nextContent = styled.content;
    else {
      return { status: "failed", content, message: styled.result.message };
    }
  }
  return { status: "applied", content: nextContent };
}
