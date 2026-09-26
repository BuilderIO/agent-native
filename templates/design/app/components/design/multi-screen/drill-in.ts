import { geometryContainsPoint } from "./frame-geometry";
import type { CanvasLayerMarqueeCandidate, Point } from "./types";

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

export function compareDrillInDepth(
  a: CanvasLayerMarqueeCandidate,
  b: CanvasLayerMarqueeCandidate,
): number {
  const areaDelta = boxArea(b) - boxArea(a);
  if (areaDelta !== 0) return areaDelta;
  return selectorDepth(a.info.selector) - selectorDepth(b.info.selector);
}

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

function fillsItsFrame(candidate: CanvasLayerMarqueeCandidate): boolean {
  const frame = candidate.frameGeometry;
  return (
    candidate.geometry.width >= frame.width * 0.98 &&
    candidate.geometry.height >= frame.height * 0.98
  );
}

export function resolvePickTargetAtPoint(args: {
  candidates: readonly CanvasLayerMarqueeCandidate[];
  screenId: string;
  point: Point;
}): CanvasLayerMarqueeCandidate | null {
  const chain = drillInChainAtPoint(args).filter(
    (candidate) => !fillsItsFrame(candidate),
  );
  return chain[0] ?? null;
}

export function resolveDrillInTarget(args: {
  candidates: readonly CanvasLayerMarqueeCandidate[];
  screenId: string;
  point: Point;
  previousKey?: string | null;
}): CanvasLayerMarqueeCandidate | null {
  const chain = drillInChainAtPoint(args);
  if (chain.length === 0) return null;
  const previousIndex = args.previousKey
    ? chain.findIndex(
        (candidate) => drillInCandidateKey(candidate) === args.previousKey,
      )
    : -1;
  return chain[previousIndex + 1] ?? chain[chain.length - 1] ?? null;
}
