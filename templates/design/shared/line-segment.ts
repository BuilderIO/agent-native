/**
 * A drawn line or arrow is an SVG box over one M…L path. Dragging an end can
 * swap which corner each end sits on, so the editor commits the segment as a
 * pseudo style property next to the box's left/top/width/height. The value is
 * "x1 y1 x2 y2" in whole CSS px from the box's top-left corner; it becomes
 * the path's `d` and a matching viewBox, never an inline style.
 */
export const LINE_SEGMENT_PROPERTY = "--an-line-segment";

export interface LineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const SEGMENT_VALUE = /^(\d+) (\d+) (\d+) (\d+)$/;

export function parseLineSegment(value: string): LineSegment | null {
  const match = SEGMENT_VALUE.exec(value.trim());
  if (!match) return null;
  const [x1, y1, x2, y2] = match.slice(1, 5).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  // Each end sits on the box edge, so the segment's bounds are the box.
  if (Math.min(x1, x2) !== 0 || Math.min(y1, y2) !== 0) return null;
  if (x1 === x2 && y1 === y2) return null;
  return { x1, y1, x2, y2 };
}

export function lineSegmentViewBox(segment: LineSegment): string {
  const width = Math.max(1, Math.abs(segment.x2 - segment.x1));
  const height = Math.max(1, Math.abs(segment.y2 - segment.y1));
  return `0 0 ${width} ${height}`;
}

export function lineSegmentPathData(segment: LineSegment): string {
  return `M ${segment.x1} ${segment.y1} L ${segment.x2} ${segment.y2}`;
}
