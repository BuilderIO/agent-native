export interface SlideCommentAnchor {
  x: number;
  y: number;
  targetText?: string;
}

export function parseSlideCommentAnchor(
  value: string | null | undefined,
): SlideCommentAnchor | null {
  if (!value) return null;

  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid slide comment anchor");
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.x !== "number" ||
    !Number.isFinite(candidate.x) ||
    candidate.x < 0 ||
    candidate.x > 100 ||
    typeof candidate.y !== "number" ||
    !Number.isFinite(candidate.y) ||
    candidate.y < 0 ||
    candidate.y > 100
  ) {
    throw new Error("invalid slide comment anchor coordinates");
  }

  if (
    candidate.targetText !== undefined &&
    (typeof candidate.targetText !== "string" ||
      candidate.targetText.length > 200)
  ) {
    throw new Error("invalid slide comment anchor text");
  }

  return {
    x: candidate.x,
    y: candidate.y,
    ...(candidate.targetText ? { targetText: candidate.targetText } : {}),
  };
}

export function serializeSlideCommentAnchor(
  anchor: SlideCommentAnchor | null | undefined,
): string | null {
  return anchor ? JSON.stringify(anchor) : null;
}
