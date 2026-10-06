import type { CSSProperties } from "react";

import type { PortableStyleSnapshot } from "../types";
import { screenLocalRectToBoardGeometry } from "./coordinate-transforms";
import { geometryContainsPoint } from "./frame-geometry";
import { SURFACE_PADDING } from "./overview-layout";
import type {
  CrossScreenDropAxis,
  CrossScreenDropGuide,
  CrossScreenDropMode,
  CrossScreenDropPlacement,
  CrossScreenHitTestAnchorRect,
  CrossScreenHitTestResult,
  FrameGeometry,
  Point,
} from "./types";

export interface CrossScreenPathFrameHit {
  sessionId: string;
  screenId: string;
  hit: CrossScreenHitTestResult;
  parentHits?: CrossScreenHitTestResult[];
}

export interface CrossScreenPathFrameHitRequest {
  requestSeq: number;
  sessionId: string;
  screenId: string;
  ignoreAutoLayout: boolean;
  hit: Promise<CrossScreenHitTestResult>;
}

export interface CrossScreenPathFrameHitRequestSnapshot {
  releaseRequestSeq: number;
  screenId: string;
  sessionId: string;
  pathFrame: CrossScreenPathFrameHit | null;
  requests: CrossScreenPathFrameHitRequest[];
}

interface TrackedCrossScreenPathFrameHitRequest {
  requestSeq: number;
  ignoreAutoLayout: boolean;
  pendingHit: Promise<CrossScreenHitTestResult> | null;
  settledHit?: CrossScreenHitTestResult;
  settled: boolean;
}

interface CrossScreenPathFrameHitScreenState {
  sessionId: string;
  screenId: string;
  pathFrame: CrossScreenPathFrameHit | null;
  pending: TrackedCrossScreenPathFrameHitRequest[];
}

function isCrossScreenPathFrameHitRequestAtOrBeforeRelease(
  request: CrossScreenPathFrameHitRequest,
  releaseRequestSeq: number,
) {
  return request.requestSeq <= releaseRequestSeq;
}

export class CrossScreenPathFrameHitTracker {
  private generation = 0;
  private readonly screenStates = new Map<
    string,
    CrossScreenPathFrameHitScreenState
  >();

  add(request: CrossScreenPathFrameHitRequest) {
    let state = this.screenStates.get(request.screenId);
    if (!state || state.sessionId !== request.sessionId) {
      state = {
        sessionId: request.sessionId,
        screenId: request.screenId,
        pathFrame: null,
        pending: [],
      };
      this.screenStates.set(request.screenId, state);
    }

    const generation = this.generation;
    const trackedRequest: TrackedCrossScreenPathFrameHitRequest = {
      requestSeq: request.requestSeq,
      ignoreAutoLayout: request.ignoreAutoLayout,
      pendingHit: request.hit,
      settled: false,
    };
    state.pending.push(trackedRequest);
    void request.hit.then((hit) => {
      if (
        generation !== this.generation ||
        this.screenStates.get(request.screenId) !== state
      ) {
        return;
      }
      trackedRequest.pendingHit = null;
      trackedRequest.settledHit = hit;
      trackedRequest.settled = true;
      this.compactSettledRequests(state);
    });
  }

  snapshot(
    releaseRequestSeq: number,
    screenId: string,
    sessionId: string,
  ): CrossScreenPathFrameHitRequestSnapshot {
    const state = this.screenStates.get(screenId);
    const matchingState = state?.sessionId === sessionId ? state : undefined;
    return {
      releaseRequestSeq,
      screenId,
      sessionId,
      pathFrame: matchingState?.pathFrame ?? null,
      requests: (matchingState?.pending ?? [])
        .filter(({ requestSeq }) => requestSeq <= releaseRequestSeq)
        .map(({ requestSeq, ignoreAutoLayout, pendingHit, settledHit }) => ({
          requestSeq,
          screenId,
          sessionId,
          ignoreAutoLayout,
          hit: pendingHit ?? Promise.resolve(settledHit ?? {}),
        })),
    };
  }

  clear() {
    this.generation += 1;
    this.screenStates.clear();
  }

  private compactSettledRequests(state: CrossScreenPathFrameHitScreenState) {
    while (state.pending[0]?.settled) {
      const [{ ignoreAutoLayout, settledHit }] = state.pending.splice(0, 1);
      if (settledHit) {
        state.pathFrame = rememberCrossScreenPathFrameHit({
          previous: state.pathFrame,
          next: {
            sessionId: state.sessionId,
            screenId: state.screenId,
            hit: settledHit,
          },
          ignoreAutoLayout,
        });
      }
    }
  }
}

export function getCrossScreenPreviewTimeoutResult(args: {
  requestSeq: number;
  generation: number;
  cached?: {
    requestSeq: number;
    generation: number;
    result: CrossScreenHitTestResult;
  };
}): CrossScreenHitTestResult {
  const { requestSeq, generation, cached } = args;
  return cached?.requestSeq === requestSeq && cached.generation === generation
    ? cached.result
    : {};
}

function isCrossScreenPathFrameHit(hit: CrossScreenHitTestResult): boolean {
  return Boolean(
    hit.anchorNodeId &&
    hit.anchorParentNodeId &&
    hit.placement === "inside" &&
    hit.dropMode === "absolute-container" &&
    !hit.gridPlacement,
  );
}

export function rememberCrossScreenPathFrameHit(args: {
  previous: CrossScreenPathFrameHit | null;
  next: CrossScreenPathFrameHit;
  ignoreAutoLayout?: boolean;
}): CrossScreenPathFrameHit | null {
  const { previous, next, ignoreAutoLayout = false } = args;
  if (ignoreAutoLayout) return null;
  if (!next.sessionId || !isCrossScreenPathFrameHit(next.hit)) {
    return previous;
  }
  if (
    previous?.sessionId === next.sessionId &&
    previous.screenId === next.screenId
  ) {
    const pathHits = [previous.hit, ...(previous.parentHits ?? [])];
    const existingHitIndex = pathHits.findIndex(
      (hit) => hit.anchorNodeId === next.hit.anchorNodeId,
    );
    if (existingHitIndex >= 0) {
      return {
        ...previous,
        parentHits: pathHits.slice(1, existingHitIndex + 1),
      };
    }
    if (
      pathHits[pathHits.length - 1]?.anchorParentNodeId ===
      next.hit.anchorNodeId
    ) {
      return {
        ...previous,
        parentHits: [...(previous.parentHits ?? []), next.hit],
      };
    }
  }
  return next;
}

export async function resolveCrossScreenPathFrameHitAtRelease(args: {
  requests: readonly CrossScreenPathFrameHitRequest[];
  releaseRequestSeq: number;
  sessionId: string;
  screenId: string;
  pathFrame?: CrossScreenPathFrameHit | null;
  releaseHit: CrossScreenHitTestResult;
  ignoreAutoLayout?: boolean;
}): Promise<CrossScreenPathFrameHit | null> {
  const {
    requests,
    releaseRequestSeq,
    sessionId,
    screenId,
    pathFrame: previousPathFrame = null,
    releaseHit,
    ignoreAutoLayout = false,
  } = args;
  if (ignoreAutoLayout) return null;

  const precedingRequests = requests
    .filter(
      (request) =>
        isCrossScreenPathFrameHitRequestAtOrBeforeRelease(
          request,
          releaseRequestSeq,
        ) &&
        request.sessionId === sessionId &&
        request.screenId === screenId,
    )
    .sort((a, b) => a.requestSeq - b.requestSeq);
  const resolvedHits = await Promise.all(
    precedingRequests.map(async (request) => ({
      request,
      hit: await request.hit,
    })),
  );

  let pathFrame =
    previousPathFrame?.sessionId === sessionId &&
    previousPathFrame.screenId === screenId
      ? previousPathFrame
      : null;
  for (const { request, hit } of resolvedHits) {
    pathFrame = rememberCrossScreenPathFrameHit({
      previous: pathFrame,
      next: {
        sessionId: request.sessionId,
        screenId: request.screenId,
        hit,
      },
      ignoreAutoLayout: request.ignoreAutoLayout,
    });
  }
  return rememberCrossScreenPathFrameHit({
    previous: pathFrame,
    next: { sessionId, screenId, hit: releaseHit },
  });
}

export function applyCrossScreenPathFrameDropTarget(args: {
  hit: CrossScreenHitTestResult;
  pathFrame: CrossScreenPathFrameHit | null;
  sessionId: string;
  screenId: string;
  ignoreAutoLayout?: boolean;
}): CrossScreenHitTestResult {
  const {
    hit,
    pathFrame,
    sessionId,
    screenId,
    ignoreAutoLayout = false,
  } = args;
  if (
    ignoreAutoLayout ||
    !pathFrame ||
    pathFrame.sessionId !== sessionId ||
    pathFrame.screenId !== screenId ||
    hit.dropMode !== "absolute-container" ||
    hit.placement !== "inside" ||
    hit.gridPlacement ||
    !hit.anchorNodeId
  ) {
    return hit;
  }
  const crossedFrame = [pathFrame.hit, ...(pathFrame.parentHits ?? [])].find(
    (frameHit) =>
      isCrossScreenPathFrameHit(frameHit) &&
      frameHit.anchorParentNodeId === hit.anchorNodeId &&
      frameHit.anchorNodeId !== hit.anchorNodeId,
  );
  if (!crossedFrame) return hit;
  return {
    ...hit,
    targetAnchorProvenance: crossedFrame.targetAnchorProvenance,
    anchorNodeId: crossedFrame.anchorNodeId,
    anchorParentNodeId: crossedFrame.anchorParentNodeId,
    pendingNodeId: crossedFrame.pendingNodeId,
    anchorSelector: crossedFrame.anchorSelector,
    placement: "after",
    guidePlacement: "after",
    dropMode: "absolute-container",
    gridPlacement: undefined,
  };
}

export function getCrossScreenSourceGeometry(args: {
  renderedGeometry?: FrameGeometry;
  persistedGeometry?: FrameGeometry;
}): FrameGeometry | undefined {
  return args.renderedGeometry ?? args.persistedGeometry;
}

export function getBoardDropRoute(args: {
  point: Point;
  viewportGeometry?: FrameGeometry;
  renderGeometry?: FrameGeometry;
  sourceScreenGeometry?: FrameGeometry;
}): "board-hit-test" | "board-root" | null {
  const { point, viewportGeometry, renderGeometry, sourceScreenGeometry } =
    args;
  if (
    !viewportGeometry ||
    !geometryContainsPoint(viewportGeometry, point) ||
    (sourceScreenGeometry && geometryContainsPoint(sourceScreenGeometry, point))
  ) {
    return null;
  }
  return renderGeometry && geometryContainsPoint(renderGeometry, point)
    ? "board-hit-test"
    : "board-root";
}

export function isPointerInsideSourceIframe(args: {
  iframeX: number;
  iframeY: number;
  viewportW: number;
  viewportH: number;
  frameWidth?: number;
  frameHeight?: number;
}): boolean {
  const width = args.frameWidth ?? args.viewportW;
  const height = args.frameHeight ?? args.viewportH;
  const scaleX =
    args.frameWidth !== undefined ? width / Math.max(1, args.viewportW) : 1;
  const scaleY =
    args.frameHeight !== undefined ? height / Math.max(1, args.viewportH) : 1;
  const x = args.iframeX * scaleX;
  const y = args.iframeY * scaleY;
  return x >= 0 && y >= 0 && x <= width && y <= height;
}

export function isFinitePoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function isPortableStyleSnapshot(
  value: unknown,
): value is PortableStyleSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return snapshot.version === 1 && Array.isArray(snapshot.nodes);
}

export function captureCrossScreenSourceHtmlSnapshot(
  sourceDocument: Document | null,
  sourceNodeId: string | undefined,
): string | undefined {
  if (!sourceDocument || !sourceNodeId) return undefined;
  const matches = sourceDocument.querySelectorAll(
    `[data-agent-native-node-id="${CSS.escape(sourceNodeId)}"]`,
  );
  if (matches.length !== 1) return undefined;
  return matches.item(0)?.outerHTML;
}

export function validateCrossScreenSourceHtmlSnapshot(
  snapshot: string,
  sourceNodeId: string,
): string | undefined {
  if (typeof document === "undefined") return undefined;
  const template = document.createElement("template");
  template.innerHTML = snapshot.trim();
  const meaningfulNodes = Array.from(template.content.childNodes).filter(
    (node) => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim(),
  );
  if (
    meaningfulNodes.length !== 1 ||
    meaningfulNodes[0]?.nodeType !== Node.ELEMENT_NODE
  ) {
    return undefined;
  }
  const root = meaningfulNodes[0] as Element;
  if (root.getAttribute("data-agent-native-node-id") !== sourceNodeId) {
    return undefined;
  }
  return root.outerHTML;
}

export function isCrossScreenDropPlacement(
  value: unknown,
): value is CrossScreenDropPlacement {
  return value === "before" || value === "after" || value === "inside";
}

export function isCrossScreenDropAxis(
  value: unknown,
): value is CrossScreenDropAxis {
  return value === "x" || value === "y";
}

export function isCrossScreenDropMode(
  value: unknown,
): value is CrossScreenDropMode {
  return value === "flow-insert" || value === "absolute-container";
}

export function isCrossScreenHitTestAnchorRect(
  value: unknown,
): value is CrossScreenHitTestAnchorRect {
  if (!value || typeof value !== "object") return false;
  const rect = value as Record<string, unknown>;
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

export function isCrossScreenGridPlacement(
  value: unknown,
): value is { column: number; columnEnd: number; row: number; rowEnd: number } {
  if (!value || typeof value !== "object") return false;
  const placement = value as Record<string, unknown>;
  return (
    Number.isInteger(placement.column) &&
    Number.isInteger(placement.columnEnd) &&
    Number.isInteger(placement.row) &&
    Number.isInteger(placement.rowEnd) &&
    Number(placement.column) > 0 &&
    Number(placement.row) > 0 &&
    Number(placement.columnEnd) > Number(placement.column) &&
    Number(placement.rowEnd) > Number(placement.row)
  );
}

export function getCrossScreenDropGuideForHitTest(args: {
  hit: CrossScreenHitTestResult;
  targetGeometry: FrameGeometry;
  targetMetadata: { width: number; height: number };
}): CrossScreenDropGuide | null {
  const rect = args.hit.guideRect ?? args.hit.anchorRect;
  if (!rect) return null;
  const placement = args.hit.placement ?? "inside";
  const axis = args.hit.axis ?? "y";
  return {
    placement,
    guidePlacement: args.hit.guidePlacement ?? placement,
    axis,
    boardRect: screenLocalRectToBoardGeometry(
      rect,
      args.targetGeometry,
      args.targetMetadata,
    ),
  };
}

export function getCrossScreenDropGuideStyle(args: {
  guide: CrossScreenDropGuide;
  pan: Point;
  scale: number;
}): CSSProperties {
  const { boardRect, placement, axis } = args.guide;
  const guidePlacement = args.guide.guidePlacement ?? placement;
  const left = args.pan.x + (SURFACE_PADDING + boardRect.x) * args.scale;
  const top = args.pan.y + (SURFACE_PADDING + boardRect.y) * args.scale;
  const width = Math.max(1, boardRect.width * args.scale);
  const height = Math.max(1, boardRect.height * args.scale);
  const rotation = boardRect.rotation ?? 0;

  if (placement === "inside") {
    return {
      left,
      top,
      width,
      height,
      border: "2px solid var(--design-editor-accent-color)",
      background:
        "color-mix(in srgb, var(--design-editor-accent-color) 14%, transparent)",
      borderRadius: 2,
      boxShadow: "none",
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
    };
  }

  if (axis === "x") {
    const x = guidePlacement === "before" ? left : left + width;
    const lineLeft = x - 1;
    return {
      left: lineLeft,
      top,
      width: 2,
      height: Math.max(8, height),
      background: "var(--design-editor-accent-color)",
      borderRadius: 999,
      boxShadow: "0 0 0 1px var(--design-editor-accent-color)",
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
      transformOrigin: rotation
        ? `${left + width / 2 - lineLeft}px ${height / 2}px`
        : undefined,
    };
  }

  const y = guidePlacement === "before" ? top : top + height;
  const lineTop = y - 1;
  return {
    left,
    top: lineTop,
    width: Math.max(8, width),
    height: 2,
    background: "var(--design-editor-accent-color)",
    borderRadius: 999,
    boxShadow: "0 0 0 1px var(--design-editor-accent-color)",
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
    transformOrigin: rotation
      ? `${width / 2}px ${top + height / 2 - lineTop}px`
      : undefined,
  };
}

export const COMPACT_CROSS_SCREEN_GHOST_PX = 16;

export function getCrossScreenGhostStyle(args: {
  ghost: { boardX: number; boardY: number; width?: number; height?: number };
  pan: Point;
  scale: number;
}): CSSProperties {
  const { boardX, boardY, width: boardWidth, height: boardHeight } = args.ghost;
  const width = boardWidth
    ? Math.max(1, boardWidth * args.scale)
    : COMPACT_CROSS_SCREEN_GHOST_PX;
  const height = boardHeight
    ? Math.max(1, boardHeight * args.scale)
    : COMPACT_CROSS_SCREEN_GHOST_PX;
  return {
    left:
      args.pan.x +
      (SURFACE_PADDING + boardX) * args.scale -
      (boardWidth ? 0 : width / 2),
    top:
      args.pan.y +
      (SURFACE_PADDING + boardY) * args.scale -
      (boardHeight ? 0 : height / 2),
    width,
    height,
  };
}
