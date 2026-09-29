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
