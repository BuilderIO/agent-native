import { geometryContainsPoint } from "./frame-geometry";
import type { CanvasLayerMarqueeCandidate, Point } from "./types";

/** Stable identity for one drill-in step. `sourceId` is the durable node id
 *  when the screen has one; `selector` is the bridge's structural fallback for
 *  id-less AI-generated markup. Both can be absent on the same payload, so the
 *  geometry is folded in to keep sibling boxes distinguishable. */
export function drillInCandidateKey(
  candidate: CanvasLayerMarqueeCandidate,
): string {
  const { info, geometry } = candidate;
  const identity = info.sourceId || info.pendingNodeId || info.selector || "";
  return `${candidate.screenId} ${identity} ${geometry.x},${geometry.y},${geometry.width},${geometry.height}`;
}

function selectorDepth(selector: string | undefined): number {
  if (!selector) return 0;
  return selector.split(/[>\s]+/).filter(Boolean).length;
}

function boxArea(candidate: CanvasLayerMarqueeCandidate): number {
  return Math.max(0, candidate.geometry.width * candidate.geometry.height);
}

/** Orders the containment chain under the pointer outermost → innermost.
 *  The selectable-rects bridge reports no explicit tree depth, so ordering is
 *  derived from the boxes themselves: a child's box sits inside its parent's,
 *  so larger area means shallower. Selector segment count only breaks ties,
 *  because a child that exactly fills its parent has identical area. */
export function compareDrillInDepth(
  a: CanvasLayerMarqueeCandidate,
  b: CanvasLayerMarqueeCandidate,
): number {
  const areaDelta = boxArea(b) - boxArea(a);
  if (areaDelta !== 0) return areaDelta;
  return selectorDepth(a.info.selector) - selectorDepth(b.info.selector);
}

/** The candidates containing `point`, ordered outermost → innermost. */
export function drillInChainAtPoint(args: {
  candidates: readonly CanvasLayerMarqueeCandidate[];
  screenId: string;
  point: Point;
}): CanvasLayerMarqueeCandidate[] {
  return args.candidates
    .filter((candidate) => candidate.screenId === args.screenId)
    .filter((candidate) =>
      geometryContainsPoint(candidate.geometry, args.point),
    )
    .sort(compareDrillInDepth);
}

/** A candidate that fills its own frame is the screen's full-bleed wrapper, not
 *  something the user aimed at. */
function fillsItsFrame(candidate: CanvasLayerMarqueeCandidate): boolean {
  const frame = candidate.frameGeometry;
  return (
    candidate.geometry.width >= frame.width * 0.98 &&
    candidate.geometry.height >= frame.height * 0.98
  );
}

/**
 * Resolves what a single click on an already-selected frame's body should
 * select: the same layer a click that reached the content would have picked —
 * the innermost candidate under the pointer. Returns null when only
 * frame-filling wrappers sit there, so the caller leaves the frame selected.
 */
export function resolvePickTargetAtPoint(args: {
  candidates: readonly CanvasLayerMarqueeCandidate[];
  screenId: string;
  point: Point;
}): CanvasLayerMarqueeCandidate | null {
  const chain = drillInChainAtPoint(args).filter(
    (candidate) => !fillsItsFrame(candidate),
  );
  return chain[chain.length - 1] ?? null;
}

/**
 * Resolves which layer a double-click should select, Figma-style: the first
 * double-click on a frame selects its outermost child under the pointer, and
 * each further double-click descends one more level along the same containment
 * chain until it bottoms out.
 *
 * Returns `null` only when nothing selectable sits under the pointer — callers
 * must leave the frame selected in that case rather than substituting some
 * other gesture, which is the bug this replaced (double-click used to switch
 * the editor into Interact, where there is no selection at all).
 */
export function resolveDrillInTarget(args: {
  candidates: readonly CanvasLayerMarqueeCandidate[];
  screenId: string;
  point: Point;
  /** Key of the layer the previous double-click on this screen landed on. */
  previousKey?: string | null;
}): CanvasLayerMarqueeCandidate | null {
  const chain = drillInChainAtPoint(args);
  if (chain.length === 0) return null;
  const previousIndex = args.previousKey
    ? chain.findIndex(
        (candidate) => drillInCandidateKey(candidate) === args.previousKey,
      )
    : -1;
  // Already at the deepest level: stay there instead of wrapping back to the
  // outermost child, which would make repeated double-clicks cycle.
  return chain[previousIndex + 1] ?? chain[chain.length - 1] ?? null;
}
