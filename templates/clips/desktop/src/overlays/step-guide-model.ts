// The step guide as `step_capture/guide.rs` stores it in `guide.json`, plus
// the frame math the PDF uses, so the editor shows each step exactly as it
// will be exported.

export interface PxPoint {
  x: number;
  y: number;
}

export interface PxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GuideCursor {
  fileName: string;
  width: number;
  height: number;
  hotspot: PxPoint;
}

export interface GuideImage {
  fileName: string;
  width: number;
  height: number;
  crop: PxRect;
  click: PxPoint;
  dragTo?: PxPoint;
  cursor?: GuideCursor;
  zoom: number;
}

export type GuideItem =
  | { kind: "step"; id: string; text: string; image: GuideImage | null }
  | { kind: "note"; id: string; text: string };

export interface StepGuide {
  schemaVersion: number;
  sessionId: string;
  title: string;
  author: string;
  date: string;
  duration: string;
  items: GuideItem[];
}

export interface LoadedGuide {
  directory: string;
  guide: StepGuide;
}

/** The step frame on the PDF page, in points. */
export const FRAME_WIDTH = 500.4;
export const FRAME_HEIGHT = 278.0;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
const MIN_VISIBLE_WIDTH = 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The part of the crop a step's frame shows: mirrors `guide::visible_rect`. */
export function visibleRect(image: GuideImage): PxRect {
  const { crop } = image;
  const aspect = FRAME_WIDTH / FRAME_HEIGHT;
  const zoom = clamp(image.zoom, MIN_ZOOM, MAX_ZOOM);
  const baseWidth =
    crop.width / crop.height > aspect ? crop.height * aspect : crop.width;
  const width = Math.max(
    baseWidth / zoom,
    Math.min(MIN_VISIBLE_WIDTH, baseWidth),
  );
  const height = width / aspect;
  return {
    x: clamp(image.click.x - width / 2, crop.x, crop.x + crop.width - width),
    y: clamp(image.click.y - height / 2, crop.y, crop.y + crop.height - height),
    width,
    height,
  };
}

/** Step numbers skip notes, as in the PDF. */
export function stepNumbers(items: GuideItem[]): Map<string, number> {
  const numbers = new Map<string, number>();
  let next = 1;
  for (const item of items) {
    if (item.kind === "step") numbers.set(item.id, next++);
  }
  return numbers;
}

export function moveItem(
  items: GuideItem[],
  index: number,
  offset: number,
): GuideItem[] {
  const target = index + offset;
  if (target < 0 || target >= items.length) return items;
  const next = items.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export function setZoom(item: GuideItem, zoom: number): GuideItem {
  if (item.kind !== "step" || !item.image) return item;
  return {
    ...item,
    image: { ...item.image, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) },
  };
}
