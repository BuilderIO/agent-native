import type { LayoutRect } from "@shared/layout-model";

import { hasMeaningfulCssTransform } from "./auto-layout-suggestion";

export interface MeasuredFrameChild {
  /** The child's `data-agent-native-node-id`. */
  id: string;
  /** Relative to the frame's padding box, where absolute offsets resolve. */
  rect: LayoutRect;
  position: string;
  transformed: boolean;
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
      reason: "no-preview" | "not-found" | "not-rendered";
    };

const NON_RENDERED_TAGS = new Set(["script", "style", "template", "link"]);

/** Measures a rendered frame and its direct children in one coordinate space. */
export function measureFrameElement(
  container: Element,
): MeasuredFrame | { status: "unmeasurable"; reason: "not-rendered" } {
  const view = container.ownerDocument.defaultView;
  if (!view) return { status: "unmeasurable", reason: "not-rendered" };
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
    const rect = child.getBoundingClientRect();
    children.push({
      id,
      rect: {
        x: rect.left - originLeft,
        y: rect.top - originTop,
        width: rect.width,
        height: rect.height,
      },
      position: childStyles.position,
      transformed: hasMeaningfulCssTransform({
        transform: childStyles.transform,
        rotate: childStyles.rotate,
        scale: childStyles.scale,
      }),
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

function edgeWidth(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}
