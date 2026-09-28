import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";

type Rect = Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">;

function toPercent(value: number, extent: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(extent) || extent <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (value / extent) * 100));
}

export function slideCommentAnchorAtPoint({
  clientX,
  clientY,
  slideRect,
  objectId,
  objectRect,
  targetText,
}: {
  clientX: number;
  clientY: number;
  slideRect: Rect;
  objectId?: string | null;
  objectRect?: Rect | null;
  targetText?: string;
}): SlideCommentAnchor {
  return {
    x: toPercent(clientX - slideRect.left, slideRect.width),
    y: toPercent(clientY - slideRect.top, slideRect.height),
    ...(targetText ? { targetText: targetText.slice(0, 200) } : {}),
    ...(objectId && objectRect && objectRect.width > 0 && objectRect.height > 0
      ? {
          objectId,
          objectX: toPercent(clientX - objectRect.left, objectRect.width),
          objectY: toPercent(clientY - objectRect.top, objectRect.height),
        }
      : {}),
  };
}

export function slideCommentAnchorFromRange({
  range,
  slideRect,
  objectId,
  objectRect,
  targetText,
}: {
  range: Pick<Range, "getBoundingClientRect">;
  slideRect: Rect;
  objectId?: string | null;
  objectRect?: Rect | null;
  targetText?: string;
}): SlideCommentAnchor {
  const rect = range.getBoundingClientRect();
  return slideCommentAnchorAtPoint({
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    slideRect,
    objectId,
    objectRect,
    targetText,
  });
}

export function slideCommentAnchorPosition(
  anchor: SlideCommentAnchor,
  slideRect: Rect,
  objectRect?: Rect | null,
): { x: number; y: number } {
  if (
    !anchor.objectId ||
    anchor.objectX === undefined ||
    anchor.objectY === undefined ||
    !objectRect ||
    objectRect.width <= 0 ||
    objectRect.height <= 0
  ) {
    return { x: anchor.x, y: anchor.y };
  }

  return {
    x: toPercent(
      objectRect.left +
        (objectRect.width * anchor.objectX) / 100 -
        slideRect.left,
      slideRect.width,
    ),
    y: toPercent(
      objectRect.top +
        (objectRect.height * anchor.objectY) / 100 -
        slideRect.top,
      slideRect.height,
    ),
  };
}
