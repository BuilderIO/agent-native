import { buildCodeLayerProjection } from "@shared/code-layer";

import type { ElementInfo } from "@/components/design/types";

import { resolveCodeLayerNodeFromElementInfo } from "./code-layer-state";

/**
 * Figma parity — an arrow key reorders a flow child and translates everything
 * else. Writing left/top on a flow child is the wrong operation: under
 * `position: static` it does nothing, and under `relative` it detaches the
 * element from its neighbours instead of moving through them.
 */

export type NudgeDirection = "up" | "right" | "down" | "left";

export interface NudgeAmounts {
  small: number;
  big: number;
}

export const DEFAULT_NUDGE_AMOUNTS: NudgeAmounts = { small: 1, big: 10 };

export type FlowAxis = "horizontal" | "vertical";

export interface FlowContainerInfo {
  kind: "flex" | "grid" | "none";
  /** The axis DOM order advances along. */
  axis: FlowAxis;
  /** Visual order runs opposite to DOM order (`*-reverse`). */
  reversed: boolean;
  wraps: boolean;
  /** Items per line when statically knowable (grid tracks); null otherwise. */
  lineLength: number | null;
}

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

/** Tailwind utilities only count unprefixed: `md:flex` is conditional on a
 * breakpoint we are not resolving here, so treating it as the current layout
 * would reorder against a container shape the user cannot see. */
function utilitySet(classes: readonly string[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const raw of classes ?? []) {
    const token = raw.trim();
    if (!token || token.includes(":")) continue;
    set.add(token);
  }
  return set;
}

/**
 * `grid-template-columns: repeat(4, minmax(0,1fr))` and
 * `grid-template-columns: 1fr 1fr 1fr` both describe three-or-four column
 * tracks; counting top-level tokens (with `repeat(n, …)` expanded to n) is
 * enough for reorder arithmetic and never needs layout.
 */
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
      // `auto-fit`/`auto-fill` resolve against the container's width, so the
      // track count is only knowable from layout. Counting the repeat as one
      // track would make a cross-axis arrow move one sibling, not one row.
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

/** Read the flow shape of a would-be parent from its authored styles and
 * Tailwind utilities. Accepts anything shaped like a `CodeLayerNode` or an
 * `ElementInfo`'s computed styles. */
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
      // A grid always continues onto the next track line; there is no
      // grid equivalent of `flex-wrap: nowrap`.
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

/** A declared flex/grid `order`, or null when the child leaves it at the
 * default. Tailwind's `order-first`/`order-last` map to the sentinels the
 * utility generates. */
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

/** Explicit grid placement opts a child out of auto-placement, so moving it in
 * the DOM leaves it in the same cell. */
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

/** `position: absolute|fixed` takes a child out of its parent's flow — Figma
 * calls the same escape hatch "Ignore auto layout". `sticky` and `relative`
 * still occupy a flow slot, so they keep reordering. */
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
  /** The selected node's own `position`. */
  position?: string | null;
  /** Its 0-based index among its siblings in DOM order. */
  siblingIndex?: number;
  /** How many siblings share the container, including the selection. */
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

/** Translate a `reorder` intent into the anchor sibling + placement the
 * `moveNode` visual edit takes. Moving later must anchor AFTER the sibling
 * currently at the destination index, and moving earlier BEFORE it — the
 * moved node vacates its own slot, so anchoring on the wrong side lands it
 * one position short. */
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
      /** The snapshot the node ids below were resolved against — the caller
       * must apply its `moveNode` edit to THIS string, not re-read the file,
       * or the ids can address a document that has since changed. */
      content: string;
      targetNodeId: string;
      anchorNodeId: string;
      placement: "before" | "after";
    }
  | { kind: "none" };

/** Rendered `display` from the canvas bridge (`getComputedStyle`), which sees
 * stylesheet rules and the active breakpoint that authored-style parsing
 * cannot. */
function isRenderedFlowDisplay(display: string | null | undefined): boolean {
  return (
    display === "flex" ||
    display === "inline-flex" ||
    display === "grid" ||
    display === "inline-grid"
  );
}

export interface ResolveElementNudgeIntentArgs {
  content: string;
  selectedElement: ElementInfo;
  direction: NudgeDirection;
  largeStep: boolean;
  amounts?: NudgeAmounts;
}

/** Resolve an arrow key against a selected element's real position in its
 * source document. Falls back to a plain translate whenever the document or
 * the node cannot be resolved (live/localhost screens have no authored source
 * here), so an unreadable projection never silently swallows the keypress. */
export function resolveElementNudgeIntent(
  args: ResolveElementNudgeIntentArgs,
): ElementNudgeIntent {
  const translate = resolveNudgeIntent({
    direction: args.direction,
    largeStep: args.largeStep,
    amounts: args.amounts,
  }) as { kind: "translate"; dx: number; dy: number };

  if (!args.content) return translate;
  const projection = buildCodeLayerProjection(args.content);
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

  const container = describeFlowContainer(parent);
  // Flex/grid paint children by `order` and explicit grid placement, not DOM
  // position, so moving the node would write a source change that produces no
  // visible movement.
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

  // A `.row { display: flex }` parent parses as no container. Translating
  // would write left/top onto a flex child and detach it from its
  // neighbours, so do nothing rather than corrupt the layout.
  if (
    container.kind === "none" &&
    !escapesFlow(position) &&
    isRenderedFlowDisplay(args.selectedElement.parentDisplay)
  ) {
    return { kind: "none" };
  }

  // Rendered `order` from the bridge sees stylesheet rules that the authored
  // styles above cannot.
  const renderedOrder = args.selectedElement.computedStyles?.order;
  if (
    container.kind !== "none" &&
    renderedOrder !== undefined &&
    renderedOrder !== "" &&
    renderedOrder !== "0"
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
