export const MIN_SLIDE_OBJECT_SIZE = 24;

export type ResizeHandle = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";

export type SelectedObjectDragStart = "perimeter" | "body" | null;

/**
 * Resolve a selected freeform object's drag affordance without conflating a
 * normal body click (which still enters inline text editing) with a drag.
 */
export function getSelectedObjectDragStart({
  targetWithinSelectedObject,
  pointerWithinMoveBand,
}: {
  targetWithinSelectedObject: boolean;
  pointerWithinMoveBand: boolean;
}): SelectedObjectDragStart {
  if (pointerWithinMoveBand) return "perimeter";
  return targetWithinSelectedObject ? "body" : null;
}

export interface SlideObjectGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SlideLayoutRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SlideObjectLayoutSnapshot {
  display: string;
  flexGrow: string;
  flexShrink: string;
  flexBasis: string;
  alignSelf: string;
}

export interface ResizeOptions {
  handle: ResizeHandle;
  dx: number;
  dy: number;
  preserveAspectRatio: boolean;
  minSize?: number;
}

export type SlidesSelectionMode =
  | "single"
  | "multi"
  | "image"
  | "editing"
  | "box-selected"
  | "resizing"
  | "canvas";

export type SlidesSelectionTool = "select" | "draw" | "pin" | "text";

export interface SlidesSelectionState<TItem> {
  deckId?: string;
  slideId: string;
  slideIndex: number;
  slideNumber: number;
  mode: SlidesSelectionMode;
  activeTool: SlidesSelectionTool;
  items: TItem[];
}

export interface SlideSelectionIdentity {
  selector: string;
  runtimeSelector?: string;
  objectId?: string;
}

function escapeAttributeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function getSlideSelectionIdentity(
  element: HTMLElement,
  runtimeSelector: string,
): SlideSelectionIdentity {
  const objectId = element.getAttribute("data-slide-object-id");
  if (!objectId) return { selector: runtimeSelector };
  return {
    selector: `[data-slide-object-id="${escapeAttributeValue(objectId)}"]`,
    runtimeSelector,
    objectId,
  };
}

export function getSlideSelectionMode(
  element: { isImage: boolean; isAbsolute: boolean },
  override?: SlidesSelectionMode,
): SlidesSelectionMode {
  if (override) return override;
  if (element.isImage) return "image";
  return element.isAbsolute ? "box-selected" : "single";
}

export function createSlidesSelectionState<TItem>({
  deckId,
  slideId,
  slideIndex,
  mode,
  items,
  drawMode,
  pinMode,
  textBoxMode,
  activeTool,
}: {
  deckId?: string;
  slideId: string;
  slideIndex: number;
  mode: SlidesSelectionMode;
  items: TItem[];
  drawMode: boolean;
  pinMode: boolean;
  textBoxMode: boolean;
  activeTool?: SlidesSelectionTool;
}): SlidesSelectionState<TItem> {
  return {
    deckId,
    slideId,
    slideIndex,
    slideNumber: slideIndex + 1,
    mode,
    activeTool:
      activeTool ??
      (drawMode ? "draw" : pinMode ? "pin" : textBoxMode ? "text" : "select"),
    items,
  };
}

export function createSlideObjectId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `slide-object-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ensureSlideObjectId(element: HTMLElement): string {
  const existing = element.getAttribute("data-slide-object-id");
  if (existing) return existing;
  const id = createSlideObjectId();
  element.setAttribute("data-slide-object-id", id);
  return id;
}

export function findSlideObjectById(
  root: HTMLElement,
  objectId: string,
): HTMLElement | null {
  return (
    Array.from(
      root.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
    ).find(
      (element) => element.getAttribute("data-slide-object-id") === objectId,
    ) ?? null
  );
}

/**
 * Absolute offsets resolve against the nearest ancestor that establishes a
 * containing block, not necessarily the slide's autofit layer. Keeping the
 * original parent preserves nested layout semantics while this resolver keeps
 * the measured viewport position stable when that child becomes freeform.
 */
export function resolveSlideObjectContainingBlock(
  element: HTMLElement,
  slideLayer: HTMLElement,
): HTMLElement {
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== slideLayer) {
    const style = window.getComputedStyle(ancestor);
    const position = style.position || "static";
    const hasTransform = Boolean(style.transform && style.transform !== "none");
    const hasPerspective = Boolean(
      style.perspective && style.perspective !== "none",
    );
    const hasFilter = Boolean(style.filter && style.filter !== "none");
    const containment = style.contain ?? "";
    const hasContainment = ["layout", "paint", "strict", "content"].some(
      (value) => containment.split(/\s+/).includes(value),
    );

    if (
      position !== "static" ||
      hasTransform ||
      hasPerspective ||
      hasFilter ||
      hasContainment
    ) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
  }
  return slideLayer;
}

export function removeTransientBuilderIds(element: HTMLElement): void {
  element.removeAttribute("data-builder-id");
  element.querySelectorAll("[data-builder-id]").forEach((node) => {
    node.removeAttribute("data-builder-id");
  });
}

export function cloneSlideObject(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  removeTransientBuilderIds(clone);
  clone.setAttribute("data-slide-object-id", createSlideObjectId());
  // Nested freeform objects are independently addressable after a clone. Each
  // one needs a new persisted identity so selector-based edits cannot resolve
  // to the corresponding element in the original object.
  clone
    .querySelectorAll<HTMLElement>("[data-slide-object-id]")
    .forEach((descendant) => {
      descendant.setAttribute("data-slide-object-id", createSlideObjectId());
    });
  return clone;
}

/**
 * Take an in-flow slide element out of layout without pulling the rest of the
 * slide with it. The shallow, hidden copy keeps its original flex/grid slot;
 * the live element can then become an independently movable canvas object.
 */
export function freezeSlideElementForFreeform(
  element: HTMLElement,
  geometry: SlideObjectGeometry,
  layout: SlideObjectLayoutSnapshot,
): HTMLElement {
  const objectId = ensureSlideObjectId(element);
  const spacer = element.cloneNode(false) as HTMLElement;
  removeTransientBuilderIds(spacer);
  spacer.removeAttribute("id");
  spacer.removeAttribute("data-slide-object-id");
  spacer.removeAttribute("contenteditable");
  spacer.removeAttribute("data-editing-block");
  spacer.classList.add("fmd-layout-spacer");
  spacer.setAttribute("data-slide-layout-spacer-for", objectId);
  spacer.setAttribute("aria-hidden", "true");
  spacer.style.visibility = "hidden";
  spacer.style.pointerEvents = "none";
  spacer.style.userSelect = "none";
  spacer.style.boxSizing = "border-box";
  spacer.style.width = `${geometry.width}px`;
  spacer.style.height = `${geometry.height}px`;
  spacer.style.minWidth = "0";
  spacer.style.minHeight = "0";
  spacer.style.maxWidth = "none";
  spacer.style.maxHeight = "none";
  spacer.style.flexGrow = layout.flexGrow;
  spacer.style.flexShrink = layout.flexShrink;
  spacer.style.flexBasis = layout.flexBasis;
  spacer.style.alignSelf = layout.alignSelf;
  // An inline placeholder cannot reserve a measured block's height. Preserve
  // inline text flow with inline-block while retaining block/grid displays.
  spacer.style.display =
    layout.display === "inline" ? "inline-block" : layout.display;

  element.before(spacer);
  element.classList.add("fmd-freeform-object");
  element.style.position = "absolute";
  element.style.left = `${geometry.x}px`;
  element.style.top = `${geometry.y}px`;
  element.style.width = `${geometry.width}px`;
  element.style.height = `${geometry.height}px`;
  element.style.boxSizing = "border-box";
  // left/top describe the visible border box. Leaving flow margins on the
  // absolute element would offset it from the measured pre-freeze rect.
  element.style.margin = "0";
  return spacer;
}

/** Remove a freeform object and the invisible layout slot that anchors it. */
export function removeSlideObjectAndLayoutSpacer(element: HTMLElement): void {
  const objectId = element.getAttribute("data-slide-object-id");
  if (objectId) {
    const owner = element.parentElement ?? element.ownerDocument;
    for (const spacer of Array.from(
      owner.querySelectorAll<HTMLElement>("[data-slide-layout-spacer-for]"),
    )) {
      if (spacer.getAttribute("data-slide-layout-spacer-for") === objectId) {
        spacer.remove();
      }
    }
  }
  element.remove();
}

/** Convert a viewport click into the unscaled fmd-slide coordinate system. */
export function clientPointToSlideCoordinates(
  clientX: number,
  clientY: number,
  rect: SlideLayoutRect,
  slideWidth: number,
  slideHeight: number,
): { x: number; y: number } {
  const x =
    rect.width > 0 ? ((clientX - rect.left) / rect.width) * slideWidth : 0;
  const y =
    rect.height > 0 ? ((clientY - rect.top) / rect.height) * slideHeight : 0;
  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}

export function resizeSlideObject(
  start: SlideObjectGeometry,
  {
    handle,
    dx,
    dy,
    preserveAspectRatio,
    minSize = MIN_SLIDE_OBJECT_SIZE,
  }: ResizeOptions,
): SlideObjectGeometry {
  const fromWest = handle === "nw" || handle === "w" || handle === "sw";
  const fromEast = handle === "ne" || handle === "e" || handle === "se";
  const fromNorth = handle === "nw" || handle === "n" || handle === "ne";
  const fromSouth = handle === "sw" || handle === "s" || handle === "se";
  const resizesHorizontally = fromWest || fromEast;
  const resizesVertically = fromNorth || fromSouth;
  let width = start.width + (fromWest ? -dx : fromEast ? dx : 0);
  let height = start.height + (fromNorth ? -dy : fromSouth ? dy : 0);

  // Midpoint handles intentionally resize a single axis, even with Shift.
  // Their opposing edge remains fixed and no implied perpendicular resize occurs.
  if (
    preserveAspectRatio &&
    resizesHorizontally &&
    resizesVertically &&
    start.width > 0 &&
    start.height > 0
  ) {
    const ratio = start.width / start.height;
    const horizontalScale = width / start.width;
    const verticalScale = height / start.height;
    const scale =
      Math.abs(horizontalScale - 1) >= Math.abs(verticalScale - 1)
        ? horizontalScale
        : verticalScale;
    width = start.width * scale;
    height = width / ratio;
  }

  width = Math.max(minSize, width);
  height = Math.max(minSize, height);
  return {
    width,
    height,
    x: fromWest ? start.x + start.width - width : start.x,
    y: fromNorth ? start.y + start.height - height : start.y,
  };
}

export function escapedEditingSelection<T>(
  editing: T | null,
  selected: T | null,
): { editing: null; selected: T | null } {
  return { editing: null, selected: editing ?? selected };
}
