export interface SelectionOverlayFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  transform: string;
  transformOrigin: { x: number; y: number };
}

export interface SelectionOverlayMeasurement {
  key: string;
  rect: DOMRect;
  frame?: SelectionOverlayFrame | null;
}

export interface SelectionOverlayMeasurementIdentity {
  slideId: string;
  content: string;
  objectId: string | null;
  selector: string | null;
  path: number[] | null;
  canvasZoom: number;
  revision: number;
}

export function createSelectionOverlayMeasurementKey({
  slideId,
  content,
  objectId,
  selector,
  path,
  canvasZoom,
  revision,
}: SelectionOverlayMeasurementIdentity): string {
  return JSON.stringify([
    slideId,
    content,
    objectId,
    selector,
    path,
    canvasZoom,
    revision,
  ]);
}

export function createSelectionOverlayAutofitKey(
  slideId: string,
  content: string,
): string {
  return JSON.stringify([slideId, content]);
}

export function currentSelectionOverlayRect(
  measurement: SelectionOverlayMeasurement | null,
  currentKey: string,
): DOMRect | null {
  return measurement?.key === currentKey ? measurement.rect : null;
}

export function currentSelectionOverlayFrame(
  measurement: SelectionOverlayMeasurement | null,
  currentKey: string,
): SelectionOverlayFrame | null {
  return measurement?.key === currentKey ? (measurement.frame ?? null) : null;
}

export function isSelectionOverlayAutofitSettled(
  settledAutofitKey: string | null,
  canvasAutofitKey: string,
): boolean {
  return settledAutofitKey === canvasAutofitKey;
}

export function isSelectionOverlayOnActiveSlide(
  selectedSlideId: string | null,
  activeSlideId: string,
): boolean {
  return selectedSlideId === activeSlideId;
}

function isSameRect(left: DOMRect, right: DOMRect): boolean {
  return (
    left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.height === right.height
  );
}

function isSameFrame(
  left: SelectionOverlayFrame | null | undefined,
  right: SelectionOverlayFrame | null | undefined,
): boolean {
  if (!left || !right) return !left && !right;
  return (
    left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.height === right.height &&
    left.transform === right.transform &&
    left.transformOrigin.x === right.transformOrigin.x &&
    left.transformOrigin.y === right.transformOrigin.y
  );
}

/** Lets a per-frame remeasure skip the render when nothing moved. */
export function isSameSelectionMeasurement(
  current: SelectionOverlayMeasurement | null,
  next: SelectionOverlayMeasurement,
): boolean {
  return (
    current !== null &&
    current.key === next.key &&
    isSameRect(current.rect, next.rect) &&
    isSameFrame(current.frame, next.frame)
  );
}

export interface SelectionOverlayContainer {
  rect: DOMRect;
  frame: SelectionOverlayFrame | null | undefined;
  group: boolean;
}

export function isSameSelectedContainer(
  current: SelectionOverlayContainer | null,
  next: SelectionOverlayContainer | null,
): boolean {
  if (!current || !next) return !current && !next;
  return (
    current.group === next.group &&
    isSameRect(current.rect, next.rect) &&
    isSameFrame(current.frame, next.frame)
  );
}
