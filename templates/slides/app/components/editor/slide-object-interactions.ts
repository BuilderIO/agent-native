export const MIN_SLIDE_OBJECT_SIZE = 24;

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

export interface SlideObjectGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResizeOptions {
  handle: ResizeHandle;
  dx: number;
  dy: number;
  preserveAspectRatio: boolean;
  minSize?: number;
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
  return clone;
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
  const fromWest = handle === "nw" || handle === "sw";
  const fromNorth = handle === "nw" || handle === "ne";
  let width = start.width + (fromWest ? -dx : dx);
  let height = start.height + (fromNorth ? -dy : dy);

  if (preserveAspectRatio && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    const horizontalScale = width / start.width;
    const verticalScale = height / start.height;
    const scale = Math.abs(horizontalScale - 1) >= Math.abs(verticalScale - 1)
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
