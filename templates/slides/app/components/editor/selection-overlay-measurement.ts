export interface SelectionOverlayMeasurement {
  key: string;
  rect: DOMRect;
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

/**
 * The portal paints in viewport coordinates. Its measurement is only valid
 * for this exact rendered selection and canvas geometry.
 */
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

/** AutoFit only depends on the rendered slide, not editor-only canvas chrome. */
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
