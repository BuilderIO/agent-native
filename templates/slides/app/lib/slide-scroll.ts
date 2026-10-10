/**
 * Geometry for the editor canvas when it is one vertical scroll through every
 * slide. All positions are client coordinates, so the same numbers work no
 * matter how far the scroller has moved.
 */
export interface SlideScrollGeometry {
  currentIndex: number;
  count: number;
  currentTop: number;
  currentHeight: number;
  /** Distance between the tops of two neighbouring slides. */
  pitch: number;
  viewTop: number;
  viewHeight: number;
  scrollTop: number;
  maxScrollTop: number;
}

/** The share of the current slide that has to show for it to count as in view. */
const IN_VIEW_AT = 0.5;

/** Breathing room left above a slide that is scrolled to the top of the pane. */
const REVEAL_MARGIN_PX = 16;

function currentSlideIsInView(g: SlideScrollGeometry): boolean {
  const visible =
    Math.min(g.currentTop + g.currentHeight, g.viewTop + g.viewHeight) -
    Math.max(g.currentTop, g.viewTop);
  return visible >= Math.min(g.currentHeight, g.viewHeight) * IN_VIEW_AT;
}

/**
 * The index of the slide the scroll position points at: the one nearest a
 * reading line that moves from the top of the pane at the start of the scroll
 * to its bottom at the end, so the first and last slides can be reached even
 * when several slides share the pane.
 */
export function slideNearReadingLine(g: SlideScrollGeometry): number {
  const progress =
    g.maxScrollTop > 0
      ? Math.min(1, Math.max(0, g.scrollTop / g.maxScrollTop))
      : 0;
  const line = g.viewTop + progress * g.viewHeight;
  const currentCenter = g.currentTop + g.currentHeight / 2;
  const index = g.currentIndex + Math.round((line - currentCenter) / g.pitch);
  return Math.min(g.count - 1, Math.max(0, index));
}

/**
 * How far to scroll so the current slide shows, for a slide that was chosen
 * somewhere else (the rail, a shortcut, a new slide). Zero when it already does.
 */
export function slideRevealDelta(g: SlideScrollGeometry): number {
  if (currentSlideIsInView(g)) return 0;
  return g.currentTop - g.viewTop - REVEAL_MARGIN_PX;
}
