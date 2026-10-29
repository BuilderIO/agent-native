import type { LayoutBoxModel, LayoutRect } from "@agent-native/toolkit/canvas-interactions/layout-model";

import { hasMeaningfulCssTransform } from "./auto-layout-suggestion";

export interface MeasuredFrameChild {
  /** The child's `data-agent-native-node-id`. */
  id: string;
  /** Relative to the frame's padding box, where absolute offsets resolve. */
  rect: LayoutRect;
  position: string;
  transformed: boolean;
  box: LayoutBoxModel;
}

export interface MeasuredFrame {
  status: "measured";
  display: string;
  boxSizing: string;
  /** The frame's own width/height, the box its min-width and width size. */
  size: { width: number; height: number };
  /** The padding box children are measured in. */
  paddingBox: { width: number; height: number };
  children: MeasuredFrameChild[];
  /** Rendered element children with no node id, which no edit can address. */
  unidentifiedChildren: number;
}

export type FrameMeasurement =
  | MeasuredFrame
  | {
      status: "unmeasurable";
      nodeId: string;
      reason: "no-preview" | "not-found" | "not-rendered" | "transformed";
    };

const NON_RENDERED_TAGS = new Set(["script", "style", "template", "link"]);

/** Measures a rendered frame and its direct children in one coordinate space. */
export function measureFrameElement(
  container: Element,
):
  | MeasuredFrame
  | { status: "unmeasurable"; reason: "not-rendered" | "transformed" } {
  const view = container.ownerDocument.defaultView;
  if (!view) return { status: "unmeasurable", reason: "not-rendered" };
  // Client rects come back scaled or rotated by any transform on the way up,
  // while the frame's width, height and padding box do not, so the two would
  // describe different spaces. A translation moves both alike.
  for (
    let current: Element | null = container;
    current;
    current = current.parentElement
  ) {
    if (!isTranslationOnly(view.getComputedStyle(current))) {
      return { status: "unmeasurable", reason: "transformed" };
    }
  }
  const styles = view.getComputedStyle(container);
  const width = Number.parseFloat(styles.width);
  const height = Number.parseFloat(styles.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { status: "unmeasurable", reason: "not-rendered" };
  }
  const origin = container.getBoundingClientRect();
  const originLeft =
    origin.left + edgeWidth(styles.borderLeftWidth) - container.scrollLeft;
  const originTop =
    origin.top + edgeWidth(styles.borderTopWidth) - container.scrollTop;
  const children: MeasuredFrameChild[] = [];
  let unidentifiedChildren = 0;
  for (const child of Array.from(container.children)) {
    if (NON_RENDERED_TAGS.has(child.tagName.toLowerCase())) continue;
    if (child.closest("[data-agent-native-edit-overlay]")) continue;
    const id = child.getAttribute("data-agent-native-node-id");
    if (!id) {
      unidentifiedChildren += 1;
      continue;
    }
    const childStyles = view.getComputedStyle(child);
    const transformed = hasMeaningfulCssTransform({
      transform: childStyles.transform,
      rotate: childStyles.rotate,
      scale: childStyles.scale,
    });
    // A client rect is the transformed box's bounds; frozen as left/top/width/
    // height with the transform kept, it would be moved and resized twice.
    const layout = transformed ? layoutBox(child, container) : null;
    if (transformed && !layout) {
      return { status: "unmeasurable", reason: "transformed" };
    }
    const rect = child.getBoundingClientRect();
    children.push({
      id,
      rect: layout ?? {
        x: rect.left - originLeft,
        y: rect.top - originTop,
        width: rect.width,
        height: rect.height,
      },
      position: childStyles.position,
      transformed,
      box: {
        sizing:
          childStyles.boxSizing === "border-box" ? "border-box" : "content-box",
        edges: {
          width:
            edgeWidth(childStyles.paddingLeft) +
            edgeWidth(childStyles.paddingRight) +
            edgeWidth(childStyles.borderLeftWidth) +
            edgeWidth(childStyles.borderRightWidth),
          height:
            edgeWidth(childStyles.paddingTop) +
            edgeWidth(childStyles.paddingBottom) +
            edgeWidth(childStyles.borderTopWidth) +
            edgeWidth(childStyles.borderBottomWidth),
        },
      },
    });
  }
  return {
    status: "measured",
    display: styles.display,
    boxSizing: styles.boxSizing,
    size: { width, height },
    paddingBox: {
      width: container.clientWidth,
      height: container.clientHeight,
    },
    children,
    unidentifiedChildren,
  };
}

/** The untransformed border box, relative to the container's padding box. */
function layoutBox(child: Element, container: Element): LayoutRect | null {
  const el = child as HTMLElement;
  const frame = container as HTMLElement;
  if (typeof el.offsetWidth !== "number") return null;
  const size = { width: el.offsetWidth, height: el.offsetHeight };
  if (el.offsetParent === frame) {
    return { x: el.offsetLeft, y: el.offsetTop, ...size };
  }
  if (el.offsetParent && el.offsetParent === frame.offsetParent) {
    return {
      x: el.offsetLeft - frame.offsetLeft - frame.clientLeft,
      y: el.offsetTop - frame.offsetTop - frame.clientTop,
      ...size,
    };
  }
  return null;
}

function isTranslationOnly(styles: CSSStyleDeclaration): boolean {
  const idle = (value: string | undefined, ...identity: string[]) => {
    const trimmed = (value ?? "").trim().toLowerCase();
    return !trimmed || trimmed === "none" || identity.includes(trimmed);
  };
  if (!idle(styles.rotate, "0deg", "0")) return false;
  if (!idle(styles.scale, "1", "1 1")) return false;
  if (!idle(styles.zoom, "1", "normal")) return false;
  const transform = (styles.transform ?? "").trim().toLowerCase();
  if (!transform || transform === "none") return true;
  const matrix = /^matrix\(([^)]*)\)$/.exec(transform);
  if (matrix) {
    const [a, b, c, d] = matrix[1]!.split(",").map((part) => Number(part));
    return (
      Math.abs(a! - 1) < 1e-6 &&
      Math.abs(b!) < 1e-6 &&
      Math.abs(c!) < 1e-6 &&
      Math.abs(d! - 1) < 1e-6
    );
  }
  return /^(?:translate(?:x|y|3d)?\([^)]*\)\s*)+$/.test(transform);
}

function edgeWidth(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}
