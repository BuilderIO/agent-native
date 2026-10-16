import { restoreSlideObjectStyle } from "./slide-object-interactions";

/** Smallest font a scale gesture may produce; the gesture holds there. */
export const MIN_SCALED_FONT_PX = 6;

const SCALED_PROPERTIES = [
  "font-size",
  "line-height",
  "letter-spacing",
  "row-gap",
  "column-gap",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
] as const;

const SCALED_MARGIN_PROPERTIES = [
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
] as const;

const SCALED_DESCENDANT_PROPERTIES = [
  ...SCALED_PROPERTIES,
  ...SCALED_MARGIN_PROPERTIES,
] as const;

const PX_VALUE = /^-?\d+(?:\.\d+)?px$/;

export interface ScaleContentSnapshot {
  element: HTMLElement;
  style: string | null;
  values: Array<[property: string, px: number]>;
}

function readPxValues(
  element: HTMLElement,
  properties: readonly string[],
): Array<[string, number]> {
  const computed = getComputedStyle(element);
  const values: Array<[string, number]> = [];
  for (const property of properties) {
    // `normal`, `auto` and percentages have no px size to multiply.
    const raw = computed.getPropertyValue(property).trim();
    if (!PX_VALUE.test(raw)) continue;
    const px = Number.parseFloat(raw);
    if (px !== 0) values.push([property, px]);
  }
  return values;
}

/**
 * Records every px size a proportional scale must multiply, for the roots and
 * all their descendants. A root's own box and margins belong to the geometry
 * gesture, so only its inner metrics are read.
 */
export function captureScaleContent(
  roots: readonly HTMLElement[],
): ScaleContentSnapshot[] {
  const rootSet = new Set(roots);
  const elements = new Set<HTMLElement>();
  for (const root of roots) {
    elements.add(root);
    for (const node of Array.from(root.querySelectorAll("*"))) {
      if (node instanceof HTMLElement) elements.add(node);
    }
  }
  return Array.from(elements, (element) => ({
    element,
    style: element.getAttribute("style"),
    values: readPxValues(
      element,
      rootSet.has(element) ? SCALED_PROPERTIES : SCALED_DESCENDANT_PROPERTIES,
    ),
  }));
}

export function applyScaleContent(
  snapshots: readonly ScaleContentSnapshot[],
  factor: number,
): void {
  for (const { element, values } of snapshots) {
    for (const [property, px] of values) {
      element.style.setProperty(
        property,
        `${Math.round(px * factor * 100) / 100}px`,
      );
    }
  }
}

export function restoreScaleContent(
  snapshots: readonly ScaleContentSnapshot[],
): void {
  for (const { element, style } of snapshots) {
    restoreSlideObjectStyle(element, style);
  }
}

/** The factor below which the smallest scaled font would drop under the floor. */
export function minScaleContentFactor(
  snapshots: readonly ScaleContentSnapshot[],
): number {
  let smallestFont = Infinity;
  for (const { values } of snapshots) {
    for (const [property, px] of values) {
      if (property === "font-size" && px < smallestFont) smallestFont = px;
    }
  }
  return Number.isFinite(smallestFont) ? MIN_SCALED_FONT_PX / smallestFont : 0;
}

/**
 * Applies only the newest value once per animation frame. A gesture that
 * fires several pointer events per frame then pays for one DOM write and one
 * selection measure, and a slow frame can never apply a stale value late.
 */
export function createLatestFrame<T>(apply: (value: T) => void) {
  let pending: { value: T } | null = null;
  let frame = 0;
  const run = () => {
    frame = 0;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    apply(value);
  };
  return {
    push(value: T) {
      pending = { value };
      if (!frame) frame = requestAnimationFrame(run);
    },
    /** Applies the newest pending value now, before the gesture commits. */
    flush() {
      if (frame) cancelAnimationFrame(frame);
      run();
    },
    cancel() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pending = null;
    },
  };
}
