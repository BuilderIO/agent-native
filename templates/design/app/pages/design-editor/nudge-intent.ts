import {
  DEFAULT_BIG_NUDGE_PX,
  DEFAULT_SMALL_NUDGE_PX,
} from "@shared/canvas-math";
import {
  buildCodeLayerProjection,
  type CodeLayerSource,
} from "@shared/code-layer";

import type { ElementInfo } from "@/components/design/types";

import { resolveCodeLayerNodeFromElementInfo } from "./code-layer-state";

export type NudgeDirection = "up" | "right" | "down" | "left";

export interface NudgeAmounts {
  small: number;
  big: number;
}

export const DEFAULT_NUDGE_AMOUNTS: NudgeAmounts = {
  small: DEFAULT_SMALL_NUDGE_PX,
  big: DEFAULT_BIG_NUDGE_PX,
};

export type FlowAxis = "horizontal" | "vertical";

export interface FlowContainerInfo {
  kind: "flex" | "grid" | "block" | "none";
  axis: FlowAxis;
  reversed: boolean;
  wraps: boolean;
  lineLength: number | null;
}

export const BLOCK_FLOW_CONTAINER: FlowContainerInfo = {
  kind: "block",
  axis: "vertical",
  reversed: false,
  wraps: false,
  lineLength: null,
};

export const NO_FLOW_CONTAINER: FlowContainerInfo = {
  kind: "none",
  axis: "horizontal",
  reversed: false,
  wraps: false,
  lineLength: null,
};

export type NudgeIntent =
  | { kind: "translate"; dx: number; dy: number }
  | { kind: "reorder"; fromIndex: number; toIndex: number }
  | { kind: "none" };

export interface FlowContainerStyleSource {
  style: Partial<Record<string, string>>;
  classes?: readonly string[];
}

function toPositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function utilitySet(classes: readonly string[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const raw of classes ?? []) {
    const token = raw.trim();
    if (!token || token.includes(":")) continue;
    set.add(token);
  }
  return set;
}

export function countGridTracks(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none") return null;
  let count = 0;
  let depth = 0;
  let token = "";
  let unresolved = false;
  const flush = () => {
    const item = token.trim();
    token = "";
    if (!item) return;
    const repeat = /^repeat\(\s*([^,]+?)\s*,(.*)\)$/is.exec(item);
    if (repeat) {
      const times = Number.parseInt(repeat[1]!, 10);
      if (!Number.isSafeInteger(times) || times <= 0) {
        unresolved = true;
        return;
      }
      count += times * (countGridTracks(repeat[2]) ?? 1);
      return;
    }
    count += 1;
  };
  for (const char of trimmed) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && /\s/.test(char)) {
      flush();
      continue;
    }
    token += char;
  }
  flush();
  if (unresolved) return null;
  return count > 0 ? count : null;
}

export function describeFlowContainer(
  source: FlowContainerStyleSource | null | undefined,
): FlowContainerInfo {
  if (!source) return NO_FLOW_CONTAINER;
  const style = source.style ?? {};
  const classes = utilitySet(source.classes);

  const display =
    style.display ??
    (classes.has("flex")
      ? "flex"
      : classes.has("inline-flex")
        ? "inline-flex"
        : classes.has("grid")
          ? "grid"
          : classes.has("inline-grid")
            ? "inline-grid"
            : undefined);

  if (display === "flex" || display === "inline-flex") {
    const direction =
      style["flex-direction"] ??
      (classes.has("flex-row-reverse")
        ? "row-reverse"
        : classes.has("flex-col-reverse")
          ? "column-reverse"
          : classes.has("flex-col")
            ? "column"
            : classes.has("flex-row")
              ? "row"
              : "row");
    const wrap =
      style["flex-wrap"] ??
      (classes.has("flex-wrap-reverse")
        ? "wrap-reverse"
        : classes.has("flex-wrap")
          ? "wrap"
          : classes.has("flex-nowrap")
            ? "nowrap"
            : "nowrap");
    return {
      kind: "flex",
      axis: direction.startsWith("column") ? "vertical" : "horizontal",
      reversed: direction.endsWith("-reverse"),
      wraps: wrap === "wrap" || wrap === "wrap-reverse",
      lineLength: null,
    };
  }

  if (display === "grid" || display === "inline-grid") {
    const autoFlow = style["grid-auto-flow"] ?? "";
    const columnFlow =
      autoFlow.includes("column") || classes.has("grid-flow-col");
    const templateColumns =
      style["grid-template-columns"] ??
      gridTemplateFromUtilities(classes, "grid-cols-");
    const templateRows =
      style["grid-template-rows"] ??
      gridTemplateFromUtilities(classes, "grid-rows-");
    return {
      kind: "grid",
      axis: columnFlow ? "vertical" : "horizontal",
      reversed: false,
      wraps: true,
      lineLength: columnFlow
        ? countGridTracks(templateRows)
        : countGridTracks(templateColumns),
    };
  }

  return NO_FLOW_CONTAINER;
}

function gridTemplateFromUtilities(
  classes: Set<string>,
  prefix: string,
): string | undefined {
  for (const token of classes) {
    if (!token.startsWith(prefix)) continue;
    const count = toPositiveInteger(token.slice(prefix.length));
    if (count) return `repeat(${count}, 1fr)`;
  }
  return undefined;
}

const GRID_PLACEMENT_PROPERTIES = [
  "grid-row",
  "grid-column",
  "grid-area",
  "grid-row-start",
  "grid-column-start",
];

const GRID_PLACEMENT_UTILITY_PREFIXES = [
  "col-span-",
  "row-span-",
  "col-start-",
  "row-start-",
  "col-end-",
  "row-end-",
];

export function hasExplicitGridPlacement(
  source: FlowContainerStyleSource,
): boolean {
  if (GRID_PLACEMENT_PROPERTIES.some((property) => source.style?.[property])) {
    return true;
  }
  for (const token of utilitySet(source.classes)) {
    if (GRID_PLACEMENT_UTILITY_PREFIXES.some((p) => token.startsWith(p))) {
      return true;
    }
  }
  return false;
}

export function declaredFlexOrder(
  source: FlowContainerStyleSource,
): number | null {
  const inline = source.style?.order;
  if (inline !== undefined && inline !== "") {
    const parsed = Number.parseInt(inline, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  for (const token of utilitySet(source.classes)) {
    if (token === "order-first") return -9999;
    if (token === "order-last") return 9999;
    if (token === "order-none") return 0;
    if (!token.startsWith("order-")) continue;
    const parsed = Number.parseInt(token.slice("order-".length), 10);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

export function escapesFlow(
  position: string | null | undefined,
  classes?: readonly string[],
): boolean {
  const value =
    position ??
    (utilitySet(classes).has("absolute")
      ? "absolute"
      : utilitySet(classes).has("fixed")
        ? "fixed"
        : undefined);
  return value === "absolute" || value === "fixed";
}

export interface ResolveNudgeIntentArgs {
  direction: NudgeDirection;
  largeStep: boolean;
  amounts?: NudgeAmounts;
  container?: FlowContainerInfo;
  position?: string | null;
  siblingIndex?: number;
  siblingCount?: number;
}

export function resolveNudgeIntent(args: ResolveNudgeIntentArgs): NudgeIntent {
  const amounts = args.amounts ?? DEFAULT_NUDGE_AMOUNTS;
  const step = args.largeStep ? amounts.big : amounts.small;
  const forward = args.direction === "right" || args.direction === "down";
  const arrowAxis: FlowAxis =
    args.direction === "left" || args.direction === "right"
      ? "horizontal"
      : "vertical";

  const translate = (): NudgeIntent => ({
    kind: "translate",
    dx: arrowAxis === "horizontal" ? (forward ? step : -step) : 0,
    dy: arrowAxis === "vertical" ? (forward ? step : -step) : 0,
  });

  const container = args.container ?? NO_FLOW_CONTAINER;
  if (container.kind === "none" || escapesFlow(args.position)) {
    return translate();
  }

  const fromIndex = args.siblingIndex;
  const siblingCount = args.siblingCount;
  if (
    fromIndex === undefined ||
    siblingCount === undefined ||
    fromIndex < 0 ||
    siblingCount < 2
  ) {
    return { kind: "none" };
  }

  let delta: number;
  if (arrowAxis === container.axis) {
    delta = (forward ? 1 : -1) * (container.reversed ? -1 : 1);
  } else {
    const lineLength = container.lineLength;
    if (!container.wraps || !lineLength || lineLength < 1) {
      return { kind: "none" };
    }
    delta = (forward ? 1 : -1) * lineLength;
  }

  const toIndex = Math.min(Math.max(fromIndex + delta, 0), siblingCount - 1);
  if (toIndex === fromIndex) return { kind: "none" };
  return { kind: "reorder", fromIndex, toIndex };
}

export interface ReorderAnchor {
  anchorIndex: number;
  placement: "before" | "after";
}

export function reorderAnchorFor(intent: {
  fromIndex: number;
  toIndex: number;
}): ReorderAnchor {
  return {
    anchorIndex: intent.toIndex,
    placement: intent.toIndex > intent.fromIndex ? "after" : "before",
  };
}

export type ElementNudgeIntent =
  | { kind: "translate"; dx: number; dy: number }
  | {
      kind: "reorder";
      content: string;
      targetNodeId: string;
      anchorNodeId: string;
      placement: "before" | "after";
    }
  | { kind: "none" };

function isRenderedFlowDisplay(display: string | null | undefined): boolean {
  return (
    display === "flex" ||
    display === "inline-flex" ||
    display === "grid" ||
    display === "inline-grid"
  );
}

function isRenderedBlockDisplay(display: string | null | undefined): boolean {
  return display === "block" || display === "list-item";
}

function hasRenderedGridPlacement(
  computedStyles: Record<string, string> | undefined,
): boolean {
  return [computedStyles?.gridColumn, computedStyles?.gridRow].some((value) => {
    const normalized = value?.trim().replace(/\s+/g, " ").toLowerCase();
    if (!normalized) return false;
    return normalized.split("/").some((line) => {
      const trimmed = line.trim();
      return trimmed !== "auto" && !/^span(?:\s|$)/.test(trimmed);
    });
  });
}

export interface ResolveElementNudgeIntentArgs {
  content: string;
  source?: CodeLayerSource;
  selectedElement: ElementInfo;
  direction: NudgeDirection;
  largeStep: boolean;
  amounts?: NudgeAmounts;
}

export function resolveElementNudgeIntent(
  args: ResolveElementNudgeIntentArgs,
): ElementNudgeIntent {
  const translate = resolveNudgeIntent({
    direction: args.direction,
    largeStep: args.largeStep,
    amounts: args.amounts,
  }) as { kind: "translate"; dx: number; dy: number };

  if (!args.content) return translate;
  const projection = buildCodeLayerProjection(args.content, {
    ...(args.source ? { source: args.source } : {}),
  });
  const node = resolveCodeLayerNodeFromElementInfo(
    projection,
    args.selectedElement,
  );
  if (!node) return translate;

  const parent = node.parentId
    ? (projection.nodes.find((candidate) => candidate.id === node.parentId) ??
      null)
    : null;
  const siblingIds = parent?.children ?? projection.rootNodeIds;
  const siblingIndex = siblingIds.indexOf(node.id);
  if (siblingIndex < 0) return translate;

  const position =
    node.style.position ??
    (escapesFlow(undefined, node.classes) ? "absolute" : undefined) ??
    args.selectedElement.computedStyles?.position;

  const parsedContainer = describeFlowContainer(parent);
  const rendered =
    args.selectedElement.parentDisplay ??
    args.selectedElement.parentLayout?.display;
  const renderedGrid =
    parsedContainer.kind === "none" &&
    !escapesFlow(position) &&
    (rendered === "grid" || rendered === "inline-grid")
      ? describeFlowContainer({
          style: {
            display: rendered,
            ...(args.selectedElement.parentLayout?.gridTemplateColumns
              ? {
                  "grid-template-columns":
                    args.selectedElement.parentLayout.gridTemplateColumns,
                }
              : {}),
            ...(args.selectedElement.parentLayout?.gridTemplateRows
              ? {
                  "grid-template-rows":
                    args.selectedElement.parentLayout.gridTemplateRows,
                }
              : {}),
            ...(args.selectedElement.parentLayout?.gridAutoFlow
              ? {
                  "grid-auto-flow":
                    args.selectedElement.parentLayout.gridAutoFlow,
                }
              : {}),
          },
        })
      : NO_FLOW_CONTAINER;
  if (
    parsedContainer.kind === "none" &&
    !escapesFlow(position) &&
    (rendered === "grid" || rendered === "inline-grid") &&
    (renderedGrid.kind !== "grid" || renderedGrid.lineLength === null)
  ) {
    return { kind: "none" };
  }
  const renderedFlexDirection =
    args.selectedElement.parentLayout?.flexDirection;
  if (
    parsedContainer.kind === "none" &&
    !escapesFlow(position) &&
    (rendered === "flex" || rendered === "inline-flex") &&
    !renderedFlexDirection
  ) {
    return { kind: "none" };
  }
  const container: FlowContainerInfo =
    parsedContainer.kind === "none" && !escapesFlow(position)
      ? renderedGrid.kind === "grid"
        ? renderedGrid
        : isRenderedFlowDisplay(rendered)
          ? {
              ...NO_FLOW_CONTAINER,
              kind: "flex",
              axis: renderedFlexDirection?.startsWith("column")
                ? "vertical"
                : "horizontal",
              reversed: renderedFlexDirection?.endsWith("-reverse") ?? false,
            }
          : isRenderedBlockDisplay(rendered) ||
              (rendered === undefined && parent !== null)
            ? BLOCK_FLOW_CONTAINER
            : parsedContainer
      : parsedContainer;
  if (
    container.kind !== "none" &&
    siblingIds.some((id) => {
      const sibling = projection.nodes.find((candidate) => candidate.id === id);
      if (!sibling) return false;
      const order = declaredFlexOrder(sibling);
      if (order !== null && order !== 0) return true;
      return container.kind === "grid" && hasExplicitGridPlacement(sibling);
    })
  ) {
    return { kind: "none" };
  }

  const renderedOrder = args.selectedElement.computedStyles?.order;
  if (
    container.kind !== "none" &&
    renderedOrder !== undefined &&
    renderedOrder !== "" &&
    renderedOrder !== "0"
  ) {
    return { kind: "none" };
  }
  if (
    container.kind === "grid" &&
    hasRenderedGridPlacement(args.selectedElement.computedStyles)
  ) {
    return { kind: "none" };
  }

  const intent = resolveNudgeIntent({
    direction: args.direction,
    largeStep: args.largeStep,
    amounts: args.amounts,
    container,
    position,
    siblingIndex,
    siblingCount: siblingIds.length,
  });

  if (intent.kind !== "reorder") return intent;
  const anchor = reorderAnchorFor(intent);
  const anchorNodeId = siblingIds[anchor.anchorIndex];
  if (!anchorNodeId) return { kind: "none" };
  return {
    kind: "reorder",
    content: args.content,
    targetNodeId: node.id,
    anchorNodeId,
    placement: anchor.placement,
  };
}
