import { callAction } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useOrgMembers } from "@agent-native/core/client/org";
import {
  useCreateReviewComment,
  useDeleteReviewComment,
  useReactToReviewComment,
  useReplyReviewComment,
  useResolveReviewThread,
  useReviewComments,
  useSetReviewThreadUnread,
  useUpdateReviewComment,
} from "@agent-native/core/client/review";
import { uploadEditorImage } from "@agent-native/core/client/uploads";
import type {
  ReviewComment,
  ReviewCommentReaction,
  ReviewDiscussionState,
  ReviewMention,
} from "@agent-native/core/review";
import {
  buildReviewThreads,
  resolveReviewAgent,
  ReviewAuthorAvatar,
  ReviewCommentComposer,
  ReviewCommentItem,
  ReviewThreadCardFrame,
  ReviewThreadMenu,
  type ReviewMentionOption,
  type ReviewThread,
} from "@agent-native/toolkit/app/review";
import { canvasToScreenPoint, screenToCanvasPoint } from "@shared/canvas-math";
import type { NodeRewriteTarget } from "@shared/node-rewrite";
import {
  SOURCE_EQUIVALENT_SELECTOR_PREFIX,
  buildSourceEquivalentSelector,
  isSourceLocationMatch,
  resolveSourceEquivalentSelector,
  resolveSourceEquivalentSelectorResult,
  type SourceEquivalentSelectorStatus,
} from "@shared/source-equivalent-selector";
import { IconMessageCircle, IconPhoto, IconX } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { sendToDesignAgentChatAndConfirm } from "@/lib/agent-chat";
import {
  formatNodeRepromptSubmission,
  NODE_REPROMPT_PREVIEW_FAILED_EVENT,
  NODE_REPROMPT_PRESENTED_EVENT,
  NODE_REPROMPT_RESOLVED_EVENT,
} from "@/lib/node-reprompt";
import {
  useReviewAgent,
  useReviewAgentSurface,
} from "@/lib/review-agent/review-agent-context";
import { firstAgentMention } from "@/lib/review-agent/review-agent-models";
import type { ReviewAgentController } from "@/lib/review-agent/use-review-agent-requests";
import type { ReviewThreadAgentAction } from "@/lib/review-thread-agent-actions";
import { cn } from "@/lib/utils";

import { resolveLayerNameAttribute } from "../../../shared/layer-name";
import {
  parseReviewAnchor,
  resolveReviewAnchor,
  type DesignReviewAnchor,
  type ReviewAnchorWorldPoint,
  type ReviewAnchorWorldRegion,
  type ReviewBoardGeometry,
  type ReviewAnchorRegion,
  type ReviewAnchorPoint,
  type ReviewAnchorSelectorResolution,
  type ReviewCanvasPoint,
} from "../../../shared/review-anchor";
import { forwardReviewOverlayWheel } from "../design/canvas-interactions/review-overlay-interaction";
import { SURFACE_PADDING } from "../design/multi-screen/overview-layout";
import type { ReviewActiveThreadReporter } from "./review-active-thread-reporter";
import {
  getReviewPinPosition,
  getReviewPopoverBox,
  getReviewPopoverPlacement,
  isReviewPointVisible,
  placeReviewDraftPin,
  reviewRegionClipPath,
  type ReviewDraftPin,
  type ReviewPinPosition,
  type ReviewPopoverPlacement,
  type ReviewVisibleRegion,
} from "./review-canvas-state";
import {
  registerReviewOverlayTarget,
  useReviewOverlayTargets,
} from "./review-overlay-targets";
import { ReviewAgentRequestStatus } from "./ReviewAgentRequestStatus";
import {
  type ReviewPinAuthor,
  ReviewPinBadge,
  uniqueReviewPinAuthors,
} from "./ReviewPinBadge";

export interface RepromptDraftRequest {
  nonce: number;
  fileId: string;
  target: NodeRewriteTarget;
  point?: ReviewAnchorPoint;
  /** Preset instruction; with `submit` it is sent without opening the composer for typing. */
  instruction?: string;
  submit?: boolean;
}

export interface ReviewFocusRequest {
  nonce: number;
  anchor: unknown;
  targetId?: string | null;
  threadId?: string;
  /** Called once an overlay has acted on the request, so its owner can retire it. */
  onConsumed?: () => void;
}

export interface ReviewCanvasPinRequest {
  nonce: number;
  canvasPoint: ReviewCanvasPoint;
}

interface ReviewCanvasPinsProps {
  active: boolean;
  hidden?: boolean;
  onClose: () => void;
  canvasSelector?: string;
  showPlacementPlane?: boolean;
  resourceType: string;
  resourceId: string;
  targetId: string | null;
  screenId?: string;
  boardGeometry?: ReviewBoardGeometry | null;
  onFocusBoardPoint?: (point: ReviewAnchorWorldPoint) => boolean | void;
  currentUserEmail?: string | null;
  pinRequest?: ReviewCanvasPinRequest | null;
  canPost: boolean;
  canResolve: boolean;
  focusRequest?: ReviewFocusRequest | null;
  onDispatchCommentToAgent?: (comment: ReviewComment) => void;
  /** Backs the card menu's agent items; only editors get them. */
  onSendThreadToAgent?: (
    thread: ReviewThread,
    action: ReviewThreadAgentAction,
  ) => void;
  /** The thread whose hand-off to the agent is still in flight. */
  sendingThreadId?: string | null;
  /** The open thread's id, or null when no thread card is open. */
  onActiveThreadChange?: ReviewActiveThreadReporter;
  sourceType?: "inline" | "localhost" | "fusion";
  sourceVersionHash?: string;
  repromptDraftRequest?: RepromptDraftRequest | null;
  onRepromptDraftConsumed?: (nonce: number) => void;
}

interface ReviewFrameNodeGeometry {
  rect: { left: number; top: number; width: number; height: number };
  viewportWidth: number;
  viewportHeight: number;
}

interface ReviewSelectorBoxReply {
  box: ReviewFrameNodeGeometry | null;
  selectorStatus: SourceEquivalentSelectorStatus;
}

interface ReviewImageAttachment {
  url: string;
  name: string;
  contentType?: string;
  provider?: string;
}

interface PendingReviewReaction {
  commentId: string;
  reaction: string;
  active: boolean;
}

const MAX_REVIEW_IMAGE_ATTACHMENTS = 5;
const REVIEW_IDENTITY_SELECTOR =
  "[data-agent-native-node-id],[data-code-layer-id],[data-layer-id],[data-builder-id],[data-loc],[id]";

interface ReviewPopoverAnchor {
  clientPoint: ReviewCanvasPoint;
  region: ReviewVisibleRegion;
  preferred: ReviewPopoverPlacement;
}

interface CanvasCameraSnapshot {
  camera: { x: number; y: number; zoom: number };
  surfaceOrigin: { x: number; y: number };
}

function readCanvasCamera(canvas: HTMLElement): CanvasCameraSnapshot | null {
  const world = canvas.querySelector<HTMLElement>(
    "[data-multi-screen-canvas-world]",
  );
  const transform = world?.style.transform ?? "";
  const match = transform.match(
    /translate\(\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)px\s*,\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)px\s*\)\s*scale\(\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*\)/i,
  );
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  const scale = Number(match[3]);
  if (![x, y, scale].every(Number.isFinite) || scale <= 0) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    camera: { x, y, zoom: scale * 100 },
    surfaceOrigin: { x: rect.left, y: rect.top },
  };
}

function canvasPointToClientPoint(
  canvas: HTMLElement,
  point: ReviewCanvasPoint,
): ReviewCanvasPoint | null {
  const snapshot = readCanvasCamera(canvas);
  if (!snapshot) return null;
  return canvasToScreenPoint(
    point,
    snapshot.camera,
    snapshot.surfaceOrigin,
    SURFACE_PADDING,
  );
}

function clientPointToCanvasPoint(
  canvas: HTMLElement,
  point: ReviewCanvasPoint,
): ReviewCanvasPoint | null {
  const snapshot = readCanvasCamera(canvas);
  if (!snapshot) return null;
  return screenToCanvasPoint(
    point,
    snapshot.camera,
    snapshot.surfaceOrigin,
    SURFACE_PADDING,
  );
}

function canvasAnchorAtPoint(
  canvas: HTMLElement,
  canvasPoint: ReviewCanvasPoint,
): { anchor: DesignReviewAnchor; metadata: Record<string, unknown> } {
  const rect = canvas.getBoundingClientRect();
  const clientPoint = canvasPointToClientPoint(canvas, canvasPoint);
  const xPct =
    clientPoint && rect.width > 0
      ? Math.min(
          100,
          Math.max(0, ((clientPoint.x - rect.left) / rect.width) * 100),
        )
      : 50;
  const yPct =
    clientPoint && rect.height > 0
      ? Math.min(
          100,
          Math.max(0, ((clientPoint.y - rect.top) / rect.height) * 100),
        )
      : 50;
  return {
    anchor: { point: { xPct, yPct }, canvasPoint },
    metadata: {},
  };
}

function findNodeElement(canvas: HTMLElement, nodeId: string): Element | null {
  const iframe = canvas.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  );
  try {
    const document = iframe?.contentDocument;
    if (!document) return null;
    const escape = globalThis.CSS?.escape;
    const matches = escape
      ? Array.from(
          document.querySelectorAll(
            `[data-agent-native-node-id="${escape(nodeId)}"],` +
              `[data-code-layer-id="${escape(nodeId)}"],` +
              `[data-layer-id="${escape(nodeId)}"],` +
              `[data-builder-id="${escape(nodeId)}"],` +
              `[data-loc="${escape(nodeId)}"],#${escape(nodeId)}`,
          ),
        )
      : Array.from(
          document.querySelectorAll(
            "[data-agent-native-node-id],[data-code-layer-id],[data-layer-id],[data-builder-id],[data-loc],[id]",
          ),
        ).filter((element) =>
          [
            "data-agent-native-node-id",
            "data-code-layer-id",
            "data-layer-id",
            "data-builder-id",
            "data-loc",
            "id",
          ].some((attribute) => element.getAttribute(attribute) === nodeId),
        );
    // Repeated identities are ambiguous; returning null lets the click-specific selector
    // keep the pin on the instance the bridge actually hit.
    const sourceMatches = matches.filter((element) =>
      isSourceLocationMatch(element, nodeId),
    );
    if (sourceMatches.length > 1) return null;
    if (sourceMatches.length > 0 && matches.length > sourceMatches.length) {
      return null;
    }
    if (matches.length > 1) return null;
    return sourceMatches[0] ?? matches[0] ?? null;
  } catch {
    return null;
  }
}

function elementPoint(
  canvas: HTMLElement,
  element: Element | null,
  frameGeometry?: ReviewFrameNodeGeometry,
): ReviewAnchorPoint | null {
  const iframe = canvas.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  );
  if (!iframe) return null;
  const canvasRect = canvas.getBoundingClientRect();
  const iframeRect = iframe.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;
  const elementRect = element?.getBoundingClientRect() ?? frameGeometry?.rect;
  if (!elementRect) return null;
  const scaleX =
    iframeRect.width /
    Math.max(1, frameGeometry?.viewportWidth ?? iframe.clientWidth);
  const scaleY =
    iframeRect.height /
    Math.max(1, frameGeometry?.viewportHeight ?? iframe.clientHeight);
  return {
    xPct:
      ((iframeRect.left +
        elementRect.left * scaleX +
        (elementRect.width * scaleX) / 2 -
        canvasRect.left) /
        canvasRect.width) *
      100,
    yPct:
      ((iframeRect.top +
        elementRect.top * scaleY +
        (elementRect.height * scaleY) / 2 -
        canvasRect.top) /
        canvasRect.height) *
      100,
  };
}

function nodePoint(
  canvas: HTMLElement,
  nodeId: string,
  frameGeometry?: ReviewFrameNodeGeometry,
): ReviewAnchorPoint | null {
  return elementPoint(canvas, findNodeElement(canvas, nodeId), frameGeometry);
}

interface ReviewClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * What the pointer is over: the node id, the selector that finds the element
 * again, and the box it had when the bridge reported it.
 */
interface ReviewHoverTarget {
  nodeId: string | null;
  selector: string | null;
  box: ReviewFrameNodeGeometry | null;
  selectorStatus?: SourceEquivalentSelectorStatus;
}

function sameHoverTarget(
  left: ReviewHoverTarget | null,
  right: ReviewHoverTarget | null,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.nodeId !== right.nodeId) return false;
  if (left.selector !== right.selector) return false;
  if (left.selectorStatus !== right.selectorStatus) return false;
  if (!left.box || !right.box) return left.box === right.box;
  return (
    left.box.viewportWidth === right.box.viewportWidth &&
    left.box.viewportHeight === right.box.viewportHeight &&
    left.box.rect.left === right.box.rect.left &&
    left.box.rect.top === right.box.rect.top &&
    left.box.rect.width === right.box.rect.width &&
    left.box.rect.height === right.box.rect.height
  );
}

/** The box a bridge reply carries, or null when the element was not found. */
function frameBoxFromPayload(
  payload: Record<string, unknown>,
): ReviewFrameNodeGeometry | null {
  const rect = payload.rect as Record<string, unknown> | undefined;
  if (!rect || typeof rect !== "object") return null;
  const box = {
    left: Number(rect.left),
    top: Number(rect.top),
    width: Number(rect.width),
    height: Number(rect.height),
  };
  const viewportWidth = Number(payload.viewportWidth);
  const viewportHeight = Number(payload.viewportHeight);
  if (
    ![...Object.values(box), viewportWidth, viewportHeight].every(
      Number.isFinite,
    )
  ) {
    return null;
  }
  return { rect: box, viewportWidth, viewportHeight };
}

function hoverTargetFromPayload(
  payload: Record<string, unknown>,
): ReviewHoverTarget | null {
  const nodeId = typeof payload.nodeId === "string" ? payload.nodeId : null;
  const box = frameBoxFromPayload(payload);
  if (!nodeId && !box) return null;
  return {
    nodeId,
    selector:
      typeof payload.hitSelector === "string" ? payload.hitSelector : null,
    box,
  };
}

/** A frame-viewport rect in client coordinates, mapped the same way as elementPoint. */
function frameRectToClient(
  canvas: HTMLElement,
  frameRect: ReviewClientRect,
  viewport?: { width: number; height: number },
): ReviewClientRect | null {
  const iframe = canvas.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  );
  if (!iframe) return null;
  const iframeRect = iframe.getBoundingClientRect();
  const scaleX =
    iframeRect.width / Math.max(1, viewport?.width ?? iframe.clientWidth);
  const scaleY =
    iframeRect.height / Math.max(1, viewport?.height ?? iframe.clientHeight);
  return {
    left: iframeRect.left + frameRect.left * scaleX,
    top: iframeRect.top + frameRect.top * scaleY,
    width: frameRect.width * scaleX,
    height: frameRect.height * scaleY,
  };
}

/** A node's box in client coordinates, from its live element or the last reported frame rect. */
function nodeClientRect(
  canvas: HTMLElement,
  nodeId: string,
  frameGeometry?: ReviewFrameNodeGeometry,
): ReviewClientRect | null {
  const elementRect =
    findNodeElement(canvas, nodeId)?.getBoundingClientRect() ??
    frameGeometry?.rect;
  if (!elementRect) return null;
  return frameRectToClient(
    canvas,
    elementRect,
    frameGeometry
      ? {
          width: frameGeometry.viewportWidth,
          height: frameGeometry.viewportHeight,
        }
      : undefined,
  );
}

/**
 * Where a hover target is drawn. The box is the element the bridge actually hit, so it
 * wins: a node-id lookup returns the first of any repeated clones. The node lookup covers
 * a target that has no box.
 */
function hoverTargetClientRect(
  canvas: HTMLElement,
  target: ReviewHoverTarget,
  nodeGeometry: Record<string, ReviewFrameNodeGeometry>,
): ReviewClientRect | null {
  if (target.box) {
    return frameRectToClient(canvas, target.box.rect, {
      width: target.box.viewportWidth,
      height: target.box.viewportHeight,
    });
  }
  return target.nodeId
    ? nodeClientRect(canvas, target.nodeId, nodeGeometry[target.nodeId])
    : null;
}

/**
 * The overlay portals to body but is a React child of the design frame, so its
 * mouse-down and click would bubble into the frame's select handlers. Only
 * those two: stopping native propagation for mouse move or up would starve the
 * window listeners that finish a canvas pan started over the plane.
 */
function stopReviewOverlayEvent(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

/**
 * Preview-frame elements belong to another realm, so instanceof against this window's
 * HTMLElement or SVGElement is false for them. Check the shape instead.
 */
function isRenderedElement(value: unknown): value is HTMLElement | SVGElement {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Element).nodeType === 1 &&
    typeof (value as HTMLElement).style === "object"
  );
}

/**
 * Resolves versioned source paths with their matching sibling rules and leaves
 * unversioned persisted selectors on their original native CSS semantics.
 */
function selectorElement(
  canvas: HTMLElement,
  selector: string,
): Element | null {
  const iframe = canvas.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  );
  const doc = iframe?.contentDocument;
  if (!doc) return null;
  try {
    return resolveSourceEquivalentSelector(doc, selector);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "SyntaxError"
    ) {
      return null;
    }
    throw error;
  }
}

function selectorPoint(
  canvas: HTMLElement,
  selector: string,
): ReviewAnchorSelectorResolution {
  const iframe = canvas.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  );
  const doc = iframe?.contentDocument;
  if (!doc) return { status: "unavailable" };
  const resolution = resolveSourceEquivalentSelectorResult(doc, selector);
  if (resolution.status !== "matched") {
    return { status: resolution.status };
  }
  const point = elementPoint(canvas, resolution.element);
  return point ? { status: "matched", point } : { status: "unavailable" };
}

function elementAnchorAtPoint(
  canvas: HTMLElement,
  clientX: number,
  clientY: number,
): {
  nodeId?: string;
  targetSelector?: string;
  layerName?: string;
  tagName?: string;
  element?: Element;
} {
  const iframe = canvas.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  );
  try {
    const document = iframe?.contentDocument;
    const iframeRect = iframe?.getBoundingClientRect();
    if (!document || !iframe || !iframeRect) return {};
    const scaleX = iframe.clientWidth / Math.max(1, iframeRect.width);
    const scaleY = iframe.clientHeight / Math.max(1, iframeRect.height);
    const element =
      document
        .elementsFromPoint(
          (clientX - iframeRect.left) * scaleX,
          (clientY - iframeRect.top) * scaleY,
        )
        .find(
          (candidate) => !candidate.closest("[data-agent-native-edit-overlay]"),
        ) ?? null;
    let identifiedAncestor: Element | null = null;
    for (
      let current = element;
      current &&
      current !== document.body &&
      current !== document.documentElement;
      current = current.parentElement
    ) {
      if (current.matches(REVIEW_IDENTITY_SELECTOR)) {
        identifiedAncestor = current;
        break;
      }
    }
    const anchor =
      identifiedAncestor &&
      identifiedAncestor !== document.body &&
      identifiedAncestor !== document.documentElement
        ? identifiedAncestor
        : element;
    if (
      !anchor ||
      anchor === document.body ||
      anchor === document.documentElement
    ) {
      return {};
    }
    const nodeId =
      anchor.getAttribute("data-agent-native-node-id") ??
      anchor.getAttribute("data-code-layer-id") ??
      anchor.getAttribute("data-layer-id") ??
      anchor.getAttribute("data-builder-id") ??
      anchor.getAttribute("data-loc") ??
      anchor.getAttribute("id") ??
      undefined;
    const layerName =
      resolveLayerNameAttribute((attribute) => anchor.getAttribute(attribute))
        ?.value ?? undefined;
    const targetSelector = nodeId
      ? undefined
      : buildSourceEquivalentSelector(anchor) || undefined;
    return {
      ...(nodeId ? { nodeId } : {}),
      ...(targetSelector ? { targetSelector } : {}),
      ...(layerName ? { layerName } : {}),
      tagName: anchor.tagName.toLowerCase(),
      element: anchor,
    };
  } catch {
    return {};
  }
}

function anchorAtPoint(
  canvas: HTMLElement,
  clientX: number,
  clientY: number,
  boardGeometry?: ReviewBoardGeometry | null,
  screenId?: string | null,
): { anchor: DesignReviewAnchor; metadata: Record<string, unknown> } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const xPct = ((clientX - rect.left) / rect.width) * 100;
  const yPct = ((clientY - rect.top) / rect.height) * 100;
  if (xPct < 0 || xPct > 100 || yPct < 0 || yPct > 100) return null; // i18n-ignore canvas coordinate guard
  const element = elementAnchorAtPoint(canvas, clientX, clientY);
  const relativePoint = element.element
    ? elementRelativePoint(canvas, element.element, clientX, clientY)
    : null;
  const worldPoint = boardGeometry
    ? boardWorldPointFromCanvasPoint({ xPct, yPct }, boardGeometry)
    : null;
  return {
    anchor: {
      ...(element.nodeId ? { nodeId: element.nodeId } : {}),
      ...(element.targetSelector ? { selector: element.targetSelector } : {}),
      ...(screenId ? { screenId, screenPoint: { xPct, yPct } } : {}),
      point: { xPct, yPct },
      ...(relativePoint && (element.nodeId || element.targetSelector)
        ? { relativePoint }
        : {}),
      ...(worldPoint ? { worldPoint } : {}),
    },
    metadata: {
      ...(element.layerName ? { layerName: element.layerName } : {}),
      ...(element.tagName ? { tagName: element.tagName } : {}),
      ...(element.targetSelector
        ? { targetSelector: element.targetSelector }
        : {}),
    },
  };
}

function elementScreenRect(
  canvas: HTMLElement,
  element: Element | null,
  frameGeometry?: ReviewFrameNodeGeometry,
): { left: number; top: number; width: number; height: number } | null {
  const iframe = canvas.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  );
  if (!iframe) return null;
  const iframeRect = iframe.getBoundingClientRect();
  const rect = element?.getBoundingClientRect() ?? frameGeometry?.rect;
  if (!rect || iframeRect.width <= 0 || iframeRect.height <= 0) return null;
  const scaleX =
    iframeRect.width /
    Math.max(1, frameGeometry?.viewportWidth ?? iframe.clientWidth);
  const scaleY =
    iframeRect.height /
    Math.max(1, frameGeometry?.viewportHeight ?? iframe.clientHeight);
  return {
    left: iframeRect.left + rect.left * scaleX,
    top: iframeRect.top + rect.top * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

function elementRelativePoint(
  canvas: HTMLElement,
  element: Element,
  clientX: number,
  clientY: number,
): ReviewAnchorPoint | null {
  const rect = elementScreenRect(canvas, element);
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    xPct: clampPercent(((clientX - rect.left) / rect.width) * 100),
    yPct: clampPercent(((clientY - rect.top) / rect.height) * 100),
  };
}

function relativeElementCanvasPoint(
  canvas: HTMLElement,
  element: Element | null,
  relativePoint: ReviewAnchorPoint,
  frameGeometry?: ReviewFrameNodeGeometry,
): ReviewAnchorPoint | null {
  const rect = elementScreenRect(canvas, element, frameGeometry);
  if (!rect) return null;
  const canvasRect = canvas.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;
  return {
    xPct: clampPercent(
      ((rect.left + (rect.width * relativePoint.xPct) / 100 - canvasRect.left) /
        canvasRect.width) *
        100,
    ),
    yPct: clampPercent(
      ((rect.top + (rect.height * relativePoint.yPct) / 100 - canvasRect.top) /
        canvasRect.height) *
        100,
    ),
  };
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function boardWorldPointFromCanvasPoint(
  point: ReviewAnchorPoint,
  geometry: ReviewBoardGeometry,
): ReviewAnchorWorldPoint | null {
  if (
    !Number.isFinite(geometry.x) ||
    !Number.isFinite(geometry.y) ||
    !Number.isFinite(geometry.width) ||
    !Number.isFinite(geometry.height) ||
    geometry.width <= 0 ||
    geometry.height <= 0
  ) {
    return null;
  }
  return {
    x: geometry.x + (point.xPct / 100) * geometry.width,
    y: geometry.y + (point.yPct / 100) * geometry.height,
  };
}

function canvasPointFromBoardWorldPoint(
  point: ReviewAnchorWorldPoint,
  geometry: ReviewBoardGeometry,
): ReviewAnchorPoint | null {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    geometry.width <= 0 ||
    geometry.height <= 0
  ) {
    return null;
  }
  return {
    xPct: clampPercent(((point.x - geometry.x) / geometry.width) * 100),
    yPct: clampPercent(((point.y - geometry.y) / geometry.height) * 100),
  };
}

function boardWorldRegionFromCanvasRegion(
  region: ReviewAnchorRegion,
  geometry: ReviewBoardGeometry,
): ReviewAnchorWorldRegion | null {
  if (geometry.width <= 0 || geometry.height <= 0) return null;
  return {
    x: geometry.x + (region.xPct / 100) * geometry.width,
    y: geometry.y + (region.yPct / 100) * geometry.height,
    width: (region.widthPct / 100) * geometry.width,
    height: (region.heightPct / 100) * geometry.height,
  };
}

function canvasRegionFromBoardWorldRegion(
  region: ReviewAnchorWorldRegion,
  geometry: ReviewBoardGeometry,
): ReviewAnchorRegion | null {
  if (geometry.width <= 0 || geometry.height <= 0) return null;
  const xPct = clampPercent(((region.x - geometry.x) / geometry.width) * 100);
  const yPct = clampPercent(((region.y - geometry.y) / geometry.height) * 100);
  const widthPct = Math.min(
    100 - xPct,
    Math.max(0, (region.width / geometry.width) * 100),
  );
  const heightPct = Math.min(
    100 - yPct,
    Math.max(0, (region.height / geometry.height) * 100),
  );
  return widthPct > 0 && heightPct > 0
    ? { xPct, yPct, widthPct, heightPct }
    : null;
}

export function materializeBoardReviewAnchor(
  anchor: unknown,
  geometry: ReviewBoardGeometry | null | undefined,
): DesignReviewAnchor | null {
  const parsed = parseReviewAnchor(anchor);
  if (!parsed || !geometry) return parsed;
  const next = { ...parsed };
  if (!next.worldPoint) {
    const worldPoint = boardWorldPointFromCanvasPoint(next.point, geometry);
    if (worldPoint) next.worldPoint = worldPoint;
  }
  if (next.region && !next.worldRegion) {
    const worldRegion = boardWorldRegionFromCanvasRegion(next.region, geometry);
    if (worldRegion) next.worldRegion = worldRegion;
  }
  return next;
}

function regionBetween(
  canvasRect: DOMRect,
  start: { x: number; y: number },
  end: { x: number; y: number },
): ReviewAnchorRegion | null {
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;
  const left = clampPercent(
    ((Math.min(start.x, end.x) - canvasRect.left) / canvasRect.width) * 100,
  );
  const top = clampPercent(
    ((Math.min(start.y, end.y) - canvasRect.top) / canvasRect.height) * 100,
  );
  const right = clampPercent(
    ((Math.max(start.x, end.x) - canvasRect.left) / canvasRect.width) * 100,
  );
  const bottom = clampPercent(
    ((Math.max(start.y, end.y) - canvasRect.top) / canvasRect.height) * 100,
  );
  const widthPct = right - left;
  const heightPct = bottom - top;
  if (widthPct <= 0 || heightPct <= 0) return null;
  return { xPct: left, yPct: top, widthPct, heightPct };
}

function reviewAttachmentMetadata(
  attachments: readonly ReviewImageAttachment[],
): Record<string, unknown>[] {
  return attachments.map(({ url, name, contentType, provider }) => ({
    url,
    name,
    ...(contentType ? { contentType } : {}),
    ...(provider ? { provider } : {}),
  }));
}

function reviewAgentAttachments(attachments: readonly ReviewImageAttachment[]) {
  return attachments.map(({ url, name, contentType }) => ({
    type: "image",
    name,
    url,
    ...(contentType ? { contentType } : {}),
  }));
}

// Everything here is portaled to <body> above the editor's stacking context,
// so sidebars, the top bar and the bottom toolbar that overlap the canvas
// would otherwise be painted over.
const WORKING_AREA_CHROME_SELECTOR =
  '[data-design-chrome-region="left-shell"], [data-design-chrome-region="right-panel"], [data-design-chrome-region="top-bar"]';
const BOTTOM_TOOLBAR_SELECTOR = "[data-design-bottom-toolbar]";
// The Pin comment tool, which the label cannot find: it is translated.
const COMMENT_TOOL_SELECTOR = `${BOTTOM_TOOLBAR_SELECTOR} [data-design-toolbar-group="comment"] button`;
const MAIN_SURFACE_SELECTOR =
  ".agent-sidebar-main-surface, .agent-layout-main-surface";
const OPEN_REVIEW_OVERLAY_SELECTOR =
  '[data-review-popover][role="menu"][data-state="open"], [role="alertdialog"][data-state="open"]';
// Shared by every mounted surface, which all hear the same keydown.
const overlayEscapes = new WeakSet<Event>();
const ownedEscapes = new WeakSet<Event>();

// Where focus goes once the card or draft that held it is gone.
interface ReviewFocusReturn {
  // The pin the card belongs to; null for a draft, which has no pin yet.
  threadId: string | null;
  // The overlay's pins in DOM order when the card closed. A deleted thread's
  // pin is already unmounted by the time focus moves, so its neighbors are
  // read from here.
  pinOrder: readonly string[];
}

function pinThreadIdsInDomOrder(
  pins: ReadonlyMap<string, HTMLElement>,
): string[] {
  return [...pins]
    .sort(([, a], [, b]) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )
    .map(([threadId]) => threadId);
}

// The next pin after the dismissed one, else the previous. A draft sits after
// every pin, so it lands on the last.
function nearestPin(
  { threadId, pinOrder }: ReviewFocusReturn,
  pins: ReadonlyMap<string, HTMLElement>,
): HTMLElement | null {
  const at = threadId === null ? -1 : pinOrder.indexOf(threadId);
  const after = at === -1 ? [] : pinOrder.slice(at + 1);
  const before = (at === -1 ? [...pinOrder] : pinOrder.slice(0, at)).reverse();
  for (const id of [...after, ...before]) {
    const pin = pins.get(id);
    if (pin) return pin;
  }
  return null;
}

// Focus that the dismissed card or its confirmation dialog left on a control
// about to unmount is lost; focus anywhere else is the user's own.
function focusIsLost(active: Element | null): boolean {
  return (
    active === null ||
    active === document.body ||
    active.closest('[role="alertdialog"]') !== null
  );
}

function workingAreaRect(
  bounds: Pick<DOMRect, "left" | "top" | "right" | "bottom">,
): Pick<DOMRect, "left" | "top" | "width" | "height"> {
  let left = bounds.left;
  let top = bounds.top;
  let right = bounds.right;
  const bottom = bounds.bottom;
  document.querySelectorAll(WORKING_AREA_CHROME_SELECTOR).forEach((el) => {
    // Popovers tagged as inspector content float beside the panel, not in it.
    if (el.closest("[data-radix-popper-content-wrapper]")) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const region = el.getAttribute("data-design-chrome-region");
    if (region === "top-bar") top = Math.max(top, r.bottom);
    else if (region === "left-shell") left = Math.max(left, r.right);
    else if (region === "right-panel") right = Math.min(right, r.left);
  });
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

// The canvas element can be a single screen frame, so the region is bounded by
// the app's main surface (which excludes the agent sidebar), not the canvas.
function reviewVisibleRegion(canvas: HTMLElement): ReviewVisibleRegion {
  const surface = canvas.closest(MAIN_SURFACE_SELECTOR);
  const area = workingAreaRect(
    surface
      ? surface.getBoundingClientRect()
      : {
          left: 0,
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
        },
  );
  const toolbar = document
    .querySelector(BOTTOM_TOOLBAR_SELECTOR)
    ?.getBoundingClientRect();
  return {
    ...area,
    bottomNotch:
      toolbar && toolbar.width > 0 && toolbar.height > 0
        ? { left: toolbar.left, right: toolbar.right, top: toolbar.top }
        : null,
  };
}

export function ReviewCanvasPins({
  active,
  hidden = false,
  onClose,
  canvasSelector,
  showPlacementPlane = true,
  resourceType,
  resourceId,
  targetId,
  screenId,
  boardGeometry,
  onFocusBoardPoint,
  currentUserEmail,
  pinRequest,
  canPost,
  canResolve,
  focusRequest,
  onDispatchCommentToAgent,
  onSendThreadToAgent,
  sendingThreadId,
  onActiveThreadChange,
  sourceType = "inline",
  sourceVersionHash,
  repromptDraftRequest,
  onRepromptDraftConsumed,
}: ReviewCanvasPinsProps) {
  const screenAnchorId =
    targetId !== null && !boardGeometry ? (screenId ?? targetId) : null;
  const t = useT();
  const comments = useReviewComments(
    {
      resourceType,
      resourceId,
      targetId,
      includeResolved: true,
      newestFirst: true,
      limit: 500,
    },
    {
      enabled: Boolean(!hidden && resourceType && resourceId),
    },
  );
  const { data: organizationMembers } = useOrgMembers();
  const reviewAgentController = useReviewAgent();
  // Only editors get agent features; the server refuses everyone else too.
  const reviewAgent =
    canResolve && reviewAgentController?.enabled ? reviewAgentController : null;
  const peopleMentionOptions = useMemo<ReviewMention[]>(
    () =>
      (organizationMembers?.members ?? []).map((member) => ({
        label:
          member.name?.trim() || member.email.split("@")[0] || member.email,
        email: member.email,
      })),
    [organizationMembers?.members],
  );
  const mentionOptions = useMemo<readonly ReviewMentionOption[]>(
    () => [...peopleMentionOptions, ...(reviewAgent?.mentionOptions ?? [])],
    [peopleMentionOptions, reviewAgent?.mentionOptions],
  );
  const createComment = useCreateReviewComment();
  const deleteComment = useDeleteReviewComment();
  const reactToComment = useReactToReviewComment();
  const replyComment = useReplyReviewComment();
  const resolveThread = useResolveReviewThread();
  const setUnread = useSetReviewThreadUnread();
  const updateComment = useUpdateReviewComment();
  const [canvas, setCanvas] = useState<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [layoutTick, setLayoutTick] = useState(0);
  const [draftPin, setDraftPin] = useState<ReviewDraftPin | null>(null);
  const [draftAttachments, setDraftAttachments] = useState<
    ReviewImageAttachment[]
  >([]);
  const [draftComposerOpen, setDraftComposerOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const onActiveThreadChangeRef = useRef(onActiveThreadChange);
  onActiveThreadChangeRef.current = onActiveThreadChange;
  const emittedThreadIdRef = useRef<string | null>(null);
  useReviewAgentSurface(
    Boolean(reviewAgent) &&
      !hidden &&
      (active || draftComposerOpen || activeThreadId !== null),
  );
  const reporterId = useId();
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;
  const pinElementsRef = useRef(new Map<string, HTMLButtonElement>());
  const focusFallbackRef = useRef<HTMLSpanElement | null>(null);
  const focusReturnRef = useRef<ReviewFocusReturn | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [draftMentions, setDraftMentions] = useState<ReviewMention[]>([]);
  const [replyAttachments, setReplyAttachments] = useState<
    ReviewImageAttachment[]
  >([]);
  const [replyMentions, setReplyMentions] = useState<ReviewMention[]>([]);
  const [editCandidate, setEditCandidate] = useState<ReviewComment | null>(
    null,
  );
  const [editDraft, setEditDraft] = useState("");
  const [editMentions, setEditMentions] = useState<ReviewMention[]>([]);
  const [deleteCandidate, setDeleteCandidate] = useState<ReviewComment | null>(
    null,
  );
  const [optimisticAnchors, setOptimisticAnchors] = useState<
    Record<string, DesignReviewAnchor>
  >({});
  const [optimisticUnread, setOptimisticUnread] = useState<
    Record<string, boolean>
  >({});
  const [regionPreview, setRegionPreview] = useState<ReviewAnchorRegion | null>(
    null,
  );
  const [expandedClusterKey, setExpandedClusterKey] = useState<string | null>(
    null,
  );
  const [draftMode, setDraftMode] = useState<"comment" | "reprompt">("comment");
  const [pendingRepromptId, setPendingRepromptId] = useState<string | null>(
    null,
  );
  const [agentSubmitting, setAgentSubmitting] = useState(false);
  const [frameNodeGeometry, setFrameNodeGeometry] = useState<
    Record<string, ReviewFrameNodeGeometry>
  >({});
  const [hoverTarget, setHoverTarget] = useState<ReviewHoverTarget | null>(
    null,
  );
  const hoverTargetRef = useRef<ReviewHoverTarget | null>(null);
  const hoverPointerRef = useRef<{ x: number; y: number } | null>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const hoverRequestRef = useRef(0);
  const selectorRequestRef = useRef(0);
  const lastFocusNonceRef = useRef<number | null>(null);
  const pendingFocusNonceRef = useRef<number | null>(null);
  const migratedBoardAnchorIdsRef = useRef<Set<string>>(new Set());
  const migrationInFlightRef = useRef(false);
  const lastRepromptDraftNonceRef = useRef<number | null>(null);
  const autoSubmitRepromptPinIdRef = useRef<string | null>(null);
  const lastPinRequestNonceRef = useRef<number | null>(null);
  const frameCallbacksRef = useRef<
    Map<string, (payload: Record<string, unknown>) => void>
  >(new Map());
  const placementDragRef = useRef<{
    startX: number;
    startY: number;
  } | null>(null);
  const suppressPlacementClickRef = useRef(false);

  const cancelDraft = useCallback(() => {
    setDraftPin(null);
    setDraftAttachments([]);
    setDraftMentions([]);
    setRegionPreview(null);
    placementDragRef.current = null;
    setDraftComposerOpen(false);
    setDraftMode("comment");
    setPendingRepromptId(null);
  }, []);

  useEffect(() => {
    const onRepromptSettled = (event: Event) => {
      const detail = (event as CustomEvent<{ repromptId?: string }>).detail;
      if (!pendingRepromptId || detail?.repromptId !== pendingRepromptId)
        return;
      cancelDraft();
      onClose();
    };
    window.addEventListener(NODE_REPROMPT_PRESENTED_EVENT, onRepromptSettled);
    window.addEventListener(NODE_REPROMPT_RESOLVED_EVENT, onRepromptSettled);
    const onRepromptPreviewFailed = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          fileId?: string;
          reason?: string;
          repromptId?: string;
        }>
      ).detail;
      if (
        detail?.repromptId !== pendingRepromptId ||
        detail.fileId !== targetId
      ) {
        return;
      }
      setPendingRepromptId(null);
      toast.error(
        t(
          detail.reason === "target-unresolved"
            ? "designEditor.nodeRewrite.previewTargetUnavailable"
            : "designEditor.nodeRewrite.previewFailed",
        ),
      );
    };
    window.addEventListener(
      NODE_REPROMPT_PREVIEW_FAILED_EVENT,
      onRepromptPreviewFailed,
    );
    return () => {
      window.removeEventListener(
        NODE_REPROMPT_PRESENTED_EVENT,
        onRepromptSettled,
      );
      window.removeEventListener(
        NODE_REPROMPT_RESOLVED_EVENT,
        onRepromptSettled,
      );
      window.removeEventListener(
        NODE_REPROMPT_PREVIEW_FAILED_EVENT,
        onRepromptPreviewFailed,
      );
    };
  }, [cancelDraft, onClose, pendingRepromptId, t, targetId]);

  const coveredTargets = useReviewOverlayTargets();
  useEffect(() => {
    if (targetId === null || hidden || !canvas) return;
    return registerReviewOverlayTarget(targetId);
  }, [canvas, hidden, targetId]);
  // A null `targetId` is dropped from the GET query, so the board's list arrives
  // with every screen's threads. A screen with its own overlay draws its own
  // threads; the board draws only the rest, or each pin would show twice.
  const threads = useMemo(
    () =>
      buildReviewThreads(
        (comments.data?.comments ?? []).filter((comment) =>
          targetId === null
            ? comment.targetId === null || !coveredTargets.has(comment.targetId)
            : comment.targetId === targetId,
        ),
      ),
    [comments.data?.comments, coveredTargets, targetId],
  );
  const discussion = comments.data?.discussion;
  const normalizedCurrentUserEmail =
    currentUserEmail?.trim().toLowerCase() || null;
  const threadIsUnread = useCallback(
    (threadId: string) =>
      optimisticUnread[threadId] ??
      discussion?.threadPreferences[threadId]?.unread ??
      false,
    [discussion?.threadPreferences, optimisticUnread],
  );
  const pinPositionFor = useCallback(
    (threadId: string | null, anchor: unknown): ReviewPinPosition | null => {
      const effectiveAnchor =
        (threadId && optimisticAnchors[threadId]) || anchor;
      const parsed =
        targetId === null && boardGeometry
          ? materializeBoardReviewAnchor(effectiveAnchor, boardGeometry)
          : parseReviewAnchor(effectiveAnchor);
      if (parsed?.relativePoint && canvas) {
        const nodeId = parsed.nodeId;
        const nodeElement = nodeId ? findNodeElement(canvas, nodeId) : null;
        // A repeated data-loc resolves to no node element; the saved selector names this instance.
        const element =
          nodeElement ??
          (parsed.selector ? selectorElement(canvas, parsed.selector) : null);
        const point = relativeElementCanvasPoint(
          canvas,
          element,
          parsed.relativePoint,
          nodeElement && nodeId ? frameNodeGeometry[nodeId] : undefined,
        );
        if (point) {
          return {
            point,
            source: nodeElement ? ("node" as const) : ("selector" as const),
          };
        }
      }
      if (parsed?.worldPoint && boardGeometry) {
        const point = canvasPointFromBoardWorldPoint(
          parsed.worldPoint,
          boardGeometry,
        );
        if (point) return { point, source: "point" };
      }
      return getReviewPinPosition(effectiveAnchor, screenAnchorId);
    },
    [
      boardGeometry,
      canvas,
      frameNodeGeometry,
      optimisticAnchors,
      screenAnchorId,
      targetId,
    ],
  );
  const react = useCallback(
    (commentId: string, reaction: string, active: boolean) => {
      if (!discussion?.canReact || reactToComment.isPending) return;
      reactToComment.mutate(
        {
          resourceType,
          resourceId,
          commentId,
          reaction,
          active,
        },
        { onError: () => toast.error(t("review.replyFailed")) },
      );
    },
    [discussion?.canReact, reactToComment, resourceId, resourceType, t],
  );
  // Several overlays can be mounted at once and share one callback, so every
  // report carries this overlay's id: closing or unmounting here withdraws only
  // this overlay's thread, never one another overlay has open.
  useEffect(() => {
    if (emittedThreadIdRef.current === activeThreadId) return;
    emittedThreadIdRef.current = activeThreadId;
    onActiveThreadChangeRef.current?.(activeThreadId, reporterId);
  }, [activeThreadId, reporterId]);
  useEffect(
    () => () => {
      if (emittedThreadIdRef.current === null) return;
      emittedThreadIdRef.current = null;
      onActiveThreadChangeRef.current?.(null, reporterId);
    },
    [reporterId],
  );
  const closeActiveThread = useCallback(() => {
    setActiveThreadId(null);
    setReplyDraft("");
    setReplyAttachments([]);
    setReplyMentions([]);
    setEditCandidate(null);
    setEditDraft("");
    setEditMentions([]);
  }, []);
  const focusReturnTo = useCallback(
    (threadId: string | null): ReviewFocusReturn => ({
      threadId,
      pinOrder: pinThreadIdsInDomOrder(pinElementsRef.current),
    }),
    [],
  );
  // Closing from the card itself (close button, Escape, delete, resolve) hands
  // focus back to the pin it belongs to; clicking elsewhere leaves focus there.
  const dismissActiveThread = useCallback(() => {
    if (activeThreadIdRef.current !== null) {
      focusReturnRef.current = focusReturnTo(activeThreadIdRef.current);
    }
    closeActiveThread();
  }, [closeActiveThread, focusReturnTo]);
  const dismissDraft = useCallback(() => {
    focusReturnRef.current = focusReturnTo(null);
    cancelDraft();
  }, [cancelDraft, focusReturnTo]);
  // The card or draft is unmounted by the time this runs, so focus is not
  // dropped to <body>. A deleted thread has no pin left and a draft never had
  // one: focus moves to the nearest pin, else the overlay's fallback target,
  // else the Pin comment tool once the overlay has unmounted with its last pin,
  // unless the user already put focus somewhere else.
  useEffect(() => {
    if (activeThreadId !== null || draftComposerOpen) return;
    const target = focusReturnRef.current;
    focusReturnRef.current = null;
    if (!target) return;
    const pins = pinElementsRef.current;
    const pin =
      target.threadId === null ? undefined : pins.get(target.threadId);
    if (pin) {
      pin.focus({ preventScroll: true });
      return;
    }
    if (!focusIsLost(document.activeElement)) return;
    (
      nearestPin(target, pins) ??
      focusFallbackRef.current ??
      document.querySelector<HTMLElement>(COMMENT_TOOL_SELECTOR)
    )?.focus({ preventScroll: true });
  }, [activeThreadId, draftComposerOpen]);
  const copyThreadLink = useCallback(
    async (thread: ReviewThread) => {
      if (!navigator.clipboard) {
        toast.error(t("review.copyLinkFailed"));
        return;
      }
      const link = new URL(window.location.href);
      link.hash = `comment=${encodeURIComponent(thread.root.threadId)}`;
      try {
        await navigator.clipboard.writeText(link.toString());
        toast.success(t("review.linkCopied"));
      } catch {
        toast.error(t("review.copyLinkFailed"));
      }
    },
    [t],
  );
  const setThreadUnread = useCallback(
    (thread: ReviewThread, unread: boolean) => {
      if (!discussion?.canSetThreadPreferences || setUnread.isPending) return;
      const threadId = thread.root.threadId;
      const previousOptimisticUnread = optimisticUnread[threadId];
      setOptimisticUnread((current) => ({ ...current, [threadId]: unread }));
      setUnread.mutate(
        {
          resourceType,
          resourceId,
          threadId,
          unread,
        },
        {
          onSuccess: () => {
            setOptimisticUnread((current) => {
              if (!(threadId in current)) return current;
              const next = { ...current };
              delete next[threadId];
              return next;
            });
          },
          onError: () => {
            setOptimisticUnread((current) => {
              if (previousOptimisticUnread !== undefined) {
                return { ...current, [threadId]: previousOptimisticUnread };
              }
              const next = { ...current };
              delete next[threadId];
              return next;
            });
            toast.error(t("review.postFailed"));
          },
        },
      );
    },
    [
      discussion?.canSetThreadPreferences,
      resourceId,
      resourceType,
      setUnread,
      optimisticUnread,
      t,
    ],
  );
  const submitEdit = useCallback(() => {
    const comment = editCandidate;
    const body = editDraft.trim();
    if (!comment || !body || updateComment.isPending) return;
    updateComment.mutate(
      {
        resourceType,
        resourceId,
        commentId: comment.id,
        body,
        mentions: editMentions,
      },
      {
        onSuccess: () => {
          setEditCandidate(null);
          setEditDraft("");
          setEditMentions([]);
        },
        onError: () => toast.error(t("review.postFailed")),
      },
    );
  }, [
    editCandidate,
    editDraft,
    editMentions,
    resourceId,
    resourceType,
    t,
    updateComment,
  ]);

  useEffect(() => {
    if (!activeThreadId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-review-popover]"))
        return;
      closeActiveThread();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [activeThreadId, closeActiveThread]);

  useEffect(() => {
    if (!canvasSelector) {
      setCanvas(null);
      return;
    }
    const findCanvas = () => {
      setCanvas(document.querySelector(canvasSelector) as HTMLElement | null);
    };
    findCanvas();
    const timer = window.setTimeout(findCanvas, 60);
    return () => window.clearTimeout(timer);
  }, [canvasSelector, targetId]);

  useEffect(() => {
    if (!canvas) return;
    let animationFrame = 0;
    const resizeObserver = new ResizeObserver(() => bump());
    // Chrome that mounted after the last pass is picked up on the next bump.
    const observeChrome = () => {
      document
        .querySelectorAll(
          `${WORKING_AREA_CHROME_SELECTOR}, ${BOTTOM_TOOLBAR_SELECTOR}`,
        )
        .forEach((region) => resizeObserver.observe(region));
      const surface = canvas.closest(MAIN_SURFACE_SELECTOR);
      if (surface) resizeObserver.observe(surface);
    };
    const bump = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        observeChrome();
        setLayoutTick((current) => current + 1);
      });
    };
    resizeObserver.observe(canvas);
    const iframe = canvas.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
    if (iframe) resizeObserver.observe(iframe);
    const frameShell = canvas.closest<HTMLElement>("[data-frame-shell]");
    if (frameShell) resizeObserver.observe(frameShell);
    observeChrome();
    const layoutOwners = new Set<HTMLElement>();
    for (const owner of [
      canvas.querySelector<HTMLElement>("[data-multi-screen-canvas-world]"),
      canvas.closest<HTMLElement>("[data-multi-screen-canvas-world]"),
      frameShell,
    ]) {
      if (owner) layoutOwners.add(owner);
    }
    const mutationObservers = [...layoutOwners].map((owner) => {
      const observer = new MutationObserver(bump);
      observer.observe(owner, {
        attributes: true,
        attributeFilter: ["style"],
      });
      return observer;
    });
    window.addEventListener("resize", bump);
    window.addEventListener("scroll", bump, { capture: true, passive: true });
    iframe?.addEventListener("load", bump);
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      mutationObservers.forEach((observer) => observer.disconnect());
      window.removeEventListener("resize", bump);
      window.removeEventListener("scroll", bump, true);
      iframe?.removeEventListener("load", bump);
    };
  }, [canvas]);

  useEffect(() => {
    if (!canvas) return;
    const iframe = canvas.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
    if (!iframe) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow || !event.data) return;
      if (event.data.type === "agent-native:review-layout") {
        setLayoutTick((current) => current + 1);
        return;
      }
      if (event.data.type === "agent-native:review-node-rects-result") {
        const viewportWidth = Number(event.data.viewportWidth);
        const viewportHeight = Number(event.data.viewportHeight);
        const rects = event.data.rects;
        if (
          !rects ||
          typeof rects !== "object" ||
          !Number.isFinite(viewportWidth) ||
          !Number.isFinite(viewportHeight)
        ) {
          return;
        }
        const next: Record<string, ReviewFrameNodeGeometry> = {};
        for (const [nodeId, rawRect] of Object.entries(rects)) {
          if (!rawRect || typeof rawRect !== "object") continue;
          const rect = rawRect as Record<string, unknown>;
          const left = Number(rect.left);
          const top = Number(rect.top);
          const width = Number(rect.width);
          const height = Number(rect.height);
          if (![left, top, width, height].every(Number.isFinite)) continue;
          next[nodeId] = {
            rect: { left, top, width, height },
            viewportWidth,
            viewportHeight,
          };
        }
        setFrameNodeGeometry(next);
        return;
      }
      const correlationId = event.data.correlationId;
      if (typeof correlationId !== "string") return;
      const callback = frameCallbacksRef.current.get(correlationId);
      if (!callback) return;
      frameCallbacksRef.current.delete(correlationId);
      callback(event.data as Record<string, unknown>);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [canvas]);

  // An open composer or thread keeps its element highlighted; otherwise the highlight follows the pointer.
  const popoverNodeId = useMemo(() => {
    if (draftPin) {
      return (
        resolveReviewAnchor(draftPin.anchor, () => null)?.anchor.nodeId ?? null
      );
    }
    const thread = threads.find(
      (candidate) => candidate.root.threadId === activeThreadId,
    );
    return thread
      ? (resolveReviewAnchor(thread.root.anchor, () => null)?.anchor.nodeId ??
          null)
      : null;
  }, [activeThreadId, draftPin, threads]);
  const popoverKey = draftPin
    ? `draft:${draftPin.id}`
    : activeThreadId
      ? `thread:${activeThreadId}`
      : null;
  const popoverOpen = popoverKey !== null;
  // The pointer moves onto the popover, which clears the hover; keep what it was over when this popover opened.
  const [popoverHover, setPopoverHover] = useState<{
    key: string;
    target: ReviewHoverTarget | null;
  } | null>(null);
  // The popover is about its anchor, so a stored selector wins over the pointer; the
  // hover is the fallback for a draft that has not saved one yet.
  const popoverAnchorSelector = draftPin
    ? (draftPin.anchor.selector ?? null)
    : (() => {
        const thread = threads.find(
          (candidate) => candidate.root.threadId === activeThreadId,
        );
        return thread
          ? (resolveReviewAnchor(thread.root.anchor, () => null)?.anchor
              .selector ?? null)
          : null;
      })();
  useEffect(() => {
    // Closing drops the snapshot, so reopening the same thread takes a fresh one.
    if (!popoverKey) {
      setPopoverHover(null);
      return;
    }
    // A bridge-corrected anchor selector replaces the snapshot's, so the highlight re-measures from it.
    setPopoverHover((current) =>
      current?.key === popoverKey &&
      (!popoverAnchorSelector ||
        current.target?.selector === popoverAnchorSelector)
        ? current
        : {
            key: popoverKey,
            target: popoverAnchorSelector
              ? { nodeId: null, selector: popoverAnchorSelector, box: null }
              : hoverTargetRef.current,
          },
    );
  }, [popoverAnchorSelector, popoverKey]);
  const popoverSnapshot =
    popoverHover?.key === popoverKey ? popoverHover.target : null;
  // A layout change re-measures the snapshot's box from this selector.
  const snapshotSelector = popoverSnapshot?.selector ?? null;
  const highlightTarget: ReviewHoverTarget | null = popoverOpen
    ? popoverNodeId
      ? {
          nodeId: popoverNodeId,
          selector: snapshotSelector,
          // Node IDs can be shared by repeated instances, so only a selector identifies this box's instance.
          box:
            popoverSnapshot &&
            popoverAnchorSelector !== null &&
            popoverSnapshot.selector === popoverAnchorSelector
              ? popoverSnapshot.box
              : null,
        }
      : popoverSnapshot
    : hoverTarget;
  const highlightNodeId = highlightTarget?.nodeId ?? null;
  const highlightHasBox = Boolean(highlightTarget?.box);

  const anchoredNodeIds = useMemo(() => {
    const nodeIds = new Set<string>();
    for (const thread of threads) {
      const resolved = resolveReviewAnchor(thread.root.anchor, () => null);
      if (resolved?.anchor.nodeId) nodeIds.add(resolved.anchor.nodeId);
    }
    const draft = draftPin
      ? resolveReviewAnchor(draftPin.anchor, () => null)
      : null;
    if (draft?.anchor.nodeId) nodeIds.add(draft.anchor.nodeId);
    // A box already measured for the highlight needs no node rect, and asking for one re-renders on every hover.
    if (highlightNodeId && !highlightHasBox) nodeIds.add(highlightNodeId);
    return [...nodeIds].sort();
  }, [draftPin, highlightHasBox, highlightNodeId, threads]);

  useEffect(() => {
    if (!canvas || anchoredNodeIds.length === 0) {
      setFrameNodeGeometry((current) =>
        Object.keys(current).length > 0 ? {} : current,
      );
      return;
    }
    const iframe = canvas.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
    iframe?.contentWindow?.postMessage(
      {
        type: "agent-native:review-node-rects",
        correlationId: crypto.randomUUID(),
        nodeIds: anchoredNodeIds,
      },
      "*",
    );
  }, [anchoredNodeIds, canvas, layoutTick, targetId]);

  useEffect(() => {
    if (
      !canvas ||
      targetId !== null ||
      !boardGeometry ||
      migrationInFlightRef.current
    )
      return;
    const migrations: Array<{
      threadId: string;
      commentId: string;
      anchor: DesignReviewAnchor;
    }> = [];
    const staleOptimisticThreadIds: string[] = [];
    for (const thread of threads) {
      const threadId = thread.root.threadId;
      const parsed = parseReviewAnchor(thread.root.anchor);
      const hasPersistedWorldAnchor = Boolean(
        parsed?.worldPoint && (!parsed.region || parsed.worldRegion),
      );
      if (!parsed || hasPersistedWorldAnchor) {
        if (hasPersistedWorldAnchor) staleOptimisticThreadIds.push(threadId);
        continue;
      }
      if (migratedBoardAnchorIdsRef.current.has(threadId)) continue;
      const nextAnchor = materializeBoardReviewAnchor(parsed, boardGeometry);
      if (!nextAnchor) continue;
      setOptimisticAnchors((current) => ({
        ...current,
        [threadId]: nextAnchor,
      }));
      if (canPost && thread.root.canDelete)
        migrations.push({
          threadId,
          commentId: thread.root.id,
          anchor: nextAnchor,
        });
    }
    if (staleOptimisticThreadIds.length) {
      setOptimisticAnchors((current) => {
        const next = { ...current };
        for (const threadId of staleOptimisticThreadIds) delete next[threadId];
        return next;
      });
    }
    if (!migrations.length) return;
    migrationInFlightRef.current = true;
    void (async () => {
      const successfulThreadIds: string[] = [];
      try {
        for (const migration of migrations) {
          migratedBoardAnchorIdsRef.current.add(migration.threadId);
          try {
            await callAction("update-review-comment", {
              resourceType,
              resourceId,
              commentId: migration.commentId,
              anchor: migration.anchor,
            });
            successfulThreadIds.push(migration.threadId);
          } catch {
            migratedBoardAnchorIdsRef.current.delete(migration.threadId);
          }
        }
        if (successfulThreadIds.length && comments.refetch) {
          try {
            await comments.refetch();
            setOptimisticAnchors((current) => {
              const next = { ...current };
              for (const threadId of successfulThreadIds) delete next[threadId];
              return next;
            });
          } catch (error) {
            console.warn(
              "[ReviewCanvasPins] board-anchor refresh failed",
              error,
            );
          }
        }
      } finally {
        migrationInFlightRef.current = false;
      }
    })();
  }, [
    boardGeometry,
    canPost,
    canvas,
    comments.refetch,
    resourceId,
    resourceType,
    targetId,
    threads,
  ]);

  const focusAnchor = useCallback(
    (
      anchor: unknown,
      nonce: number,
      onConsumed: (() => void) | undefined,
    ): boolean => {
      if (!canvas) return false;
      const resolved = resolveReviewAnchor(
        anchor,
        (nodeId) => nodePoint(canvas, nodeId, frameNodeGeometry[nodeId]),
        (selector) => selectorPoint(canvas, selector),
        screenAnchorId,
      );
      if (!resolved) return true;
      if (targetId === null && boardGeometry) {
        const boardAnchor = materializeBoardReviewAnchor(anchor, boardGeometry);
        if (boardAnchor?.worldPoint) {
          return onFocusBoardPoint?.(boardAnchor.worldPoint) === false
            ? false
            : true;
        }
      }
      if (resolved.anchor.nodeId || resolved.anchor.selector) {
        // A repeated data-loc resolves to no node; the saved selector names the instance.
        const element =
          (resolved.anchor.nodeId
            ? findNodeElement(canvas, resolved.anchor.nodeId)
            : null) ??
          (resolved.anchor.selector
            ? selectorElement(canvas, resolved.anchor.selector)
            : null);
        if (isRenderedElement(element)) {
          element.scrollIntoView({ block: "center", inline: "center" });
          const previousBoxShadow = element.style.boxShadow;
          element.style.boxShadow =
            "0 0 0 2px var(--design-editor-accent-color, #2563eb)";
          window.setTimeout(() => {
            element.style.boxShadow = previousBoxShadow;
          }, 700);
          return true;
        }
        if (!resolved.anchor.nodeId) return true;
        if (pendingFocusNonceRef.current === nonce) return false;
        const iframe = canvas.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        );
        if (!iframe?.contentWindow) return false;
        const correlationId = crypto.randomUUID();
        pendingFocusNonceRef.current = nonce;
        frameCallbacksRef.current.set(correlationId, (payload) => {
          pendingFocusNonceRef.current = null;
          if (payload.focused === true) {
            lastFocusNonceRef.current = nonce;
            onConsumed?.();
            setLayoutTick((current) => current + 1);
          }
        });
        iframe.contentWindow.postMessage(
          {
            type: "agent-native:review-focus",
            correlationId,
            nodeId: resolved.anchor.nodeId,
          },
          "*",
        );
        return false;
      }
      return true;
    },
    [
      boardGeometry,
      canvas,
      frameNodeGeometry,
      onFocusBoardPoint,
      screenAnchorId,
      targetId,
    ],
  );

  useEffect(() => {
    if (
      !focusRequest ||
      focusRequest.nonce === lastFocusNonceRef.current ||
      (focusRequest.targetId !== undefined &&
        focusRequest.targetId !== targetId)
    )
      return;
    if (
      focusAnchor(
        focusRequest.anchor,
        focusRequest.nonce,
        focusRequest.onConsumed,
      )
    ) {
      lastFocusNonceRef.current = focusRequest.nonce;
      // A thread without an anchor has no pin to hold its card, and opening it
      // would report a thread nobody can see.
      if (focusRequest.threadId && parseReviewAnchor(focusRequest.anchor)) {
        setActiveThreadId(focusRequest.threadId);
      }
      focusRequest.onConsumed?.();
    }
  }, [focusAnchor, focusRequest, layoutTick, targetId]);

  useEffect(() => {
    if (!active) cancelDraft();
  }, [active, cancelDraft]);

  useEffect(() => {
    if (
      !active ||
      hidden ||
      !canvas ||
      !repromptDraftRequest ||
      repromptDraftRequest.fileId !== targetId ||
      repromptDraftRequest.nonce === lastRepromptDraftNonceRef.current
    ) {
      return;
    }
    lastRepromptDraftNonceRef.current = repromptDraftRequest.nonce;
    const nodeId = repromptDraftRequest.target.nodeId;
    const point = repromptDraftRequest.point ??
      (nodeId
        ? nodePoint(canvas, nodeId, frameNodeGeometry[nodeId])
        : null) ?? { xPct: 50, yPct: 50 };
    setActiveThreadId(null);
    setReplyDraft("");
    setReplyAttachments([]);
    setReplyMentions([]);
    setDraftAttachments([]);
    setDraftMentions([]);
    setPendingRepromptId(null);
    setDraftMode("reprompt");
    const draftPinId = crypto.randomUUID();
    autoSubmitRepromptPinIdRef.current = repromptDraftRequest.submit
      ? draftPinId
      : null;
    setDraftPin({
      id: draftPinId,
      anchor: {
        ...(nodeId ? { nodeId } : {}),
        point,
      },
      draft: repromptDraftRequest.instruction ?? "",
      resolutionTarget: "agent",
      metadata: {
        mode: "reprompt",
        ...(repromptDraftRequest.target.selector
          ? { targetSelector: repromptDraftRequest.target.selector }
          : {}),
      },
    });
    setDraftComposerOpen(true);
    onRepromptDraftConsumed?.(repromptDraftRequest.nonce);
  }, [
    active,
    canvas,
    frameNodeGeometry,
    hidden,
    onRepromptDraftConsumed,
    repromptDraftRequest,
    targetId,
  ]);

  // The listeners below subscribe once and read the latest state through this
  // ref. Other Escape handlers (Design's hotkeys, a Radix menu closing)
  // re-render this component between the two phases of one keydown, and a
  // listener re-subscribed in that gap is skipped or loses what capture saw.
  const escapeRef = useRef({ owns: false, close: () => {} });
  escapeRef.current = {
    owns: Boolean(draftComposerOpen && draftPin) || Boolean(activeThreadId),
    close: () => {
      if (draftComposerOpen && draftPin) {
        dismissDraft();
        return;
      }
      if (activeThreadId) {
        focusReturnRef.current = focusReturnTo(activeThreadId);
        setActiveThreadId(null);
        setReplyDraft("");
        setReplyAttachments([]);
        setReplyMentions([]);
        return;
      }
      if (active) onClose();
    },
  };
  useEffect(() => {
    // Capture runs before Radix closes an open menu or dialog, and before any
    // review surface acts, so it records whose Escape this is: an overlay's, or
    // the draft or thread of whichever surface owns one. Design's hotkeys call
    // preventDefault() on every Escape, so defaultPrevented cannot tell.
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(OPEN_REVIEW_OVERLAY_SELECTOR)) {
        overlayEscapes.add(event);
      } else if (escapeRef.current.owns) {
        ownedEscapes.add(event);
      }
    };
    // Bubble, so the composer's own Escape (which stops propagation) is
    // handled by the composer alone. The board and overview surfaces are both
    // mounted in comment mode: one that owns nothing leaves comment mode only
    // when no other surface used this Escape to close its draft or thread.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || overlayEscapes.has(event)) return;
      const { owns, close } = escapeRef.current;
      if (!owns && ownedEscapes.has(event)) return;
      close();
    };
    window.addEventListener("keydown", onKeyDownCapture, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDownCapture, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    cancelDraft();
    setActiveThreadId(null);
    setReplyDraft("");
    setReplyAttachments([]);
    setReplyMentions([]);
    setExpandedClusterKey(null);
    setFrameNodeGeometry({});
    setOptimisticAnchors({});
    setOptimisticUnread({});
    migratedBoardAnchorIdsRef.current.clear();
    frameCallbacksRef.current.clear();
    pendingFocusNonceRef.current = null;
  }, [cancelDraft, resourceId, screenAnchorId, targetId]);

  useEffect(() => {
    if (!hidden) return;
    cancelDraft();
    setActiveThreadId(null);
    setReplyDraft("");
    setReplyAttachments([]);
    setReplyMentions([]);
    setExpandedClusterKey(null);
    if (active) onCloseRef.current();
  }, [active, cancelDraft, hidden]);

  const dropCanvasPin = useCallback(
    (canvasPoint: ReviewCanvasPoint) => {
      if (!canvas || !canPost) return;
      const next = canvasAnchorAtPoint(canvas, canvasPoint);
      setActiveThreadId(null);
      setReplyDraft("");
      setDraftMode("comment");
      setPendingRepromptId(null);
      setDraftPin((current) =>
        placeReviewDraftPin(current, {
          id: crypto.randomUUID(),
          anchor: next.anchor,
          metadata: next.metadata,
        }),
      );
      setDraftComposerOpen(true);
    },
    [canPost, canvas],
  );

  const dropPin = useCallback(
    (clientX: number, clientY: number, region?: ReviewAnchorRegion | null) => {
      if (!canvas || !canPost) return;
      if (targetId === null && !boardGeometry) {
        const canvasPoint = clientPointToCanvasPoint(canvas, {
          x: clientX,
          y: clientY,
        });
        if (canvasPoint) dropCanvasPin(canvasPoint);
        return;
      }
      const pointAnchor = anchorAtPoint(
        canvas,
        clientX,
        clientY,
        boardGeometry,
        screenAnchorId,
      );
      const next = pointAnchor
        ? {
            ...pointAnchor,
            anchor: {
              ...pointAnchor.anchor,
              ...(region ? { region } : {}),
              ...(region && boardGeometry
                ? (() => {
                    const worldRegion = boardWorldRegionFromCanvasRegion(
                      region,
                      boardGeometry,
                    );
                    return worldRegion ? { worldRegion } : {};
                  })()
                : {}),
            },
          }
        : null;
      if (!next) return;
      setActiveThreadId(null);
      setReplyDraft("");
      setReplyAttachments([]);
      setReplyMentions([]);
      setDraftMentions([]);
      setDraftMode("comment");
      setPendingRepromptId(null);
      setDraftPin((current) =>
        placeReviewDraftPin(current, {
          id: crypto.randomUUID(),
          anchor: next.anchor,
          metadata: next.metadata,
        }),
      );
      setDraftComposerOpen(true);

      const iframe = canvas.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      const iframeRect = iframe?.getBoundingClientRect();
      if (!iframe?.contentWindow || !iframeRect?.width || !iframeRect.height) {
        return;
      }
      const correlationId = crypto.randomUUID();
      frameCallbacksRef.current.set(correlationId, (payload) => {
        const nodeId =
          typeof payload.nodeId === "string" ? payload.nodeId : undefined;
        const targetSelector =
          typeof payload.targetSelector === "string"
            ? payload.targetSelector
            : undefined;
        const layerName =
          typeof payload.layerName === "string" ? payload.layerName : undefined;
        const tagName =
          typeof payload.tagName === "string" ? payload.tagName : undefined;
        // The bridge's hit selector is the one that re-finds this element, so it replaces
        // the parent's structural guess made when the pin was dropped.
        const hitSelector =
          typeof payload.hitSelector === "string"
            ? payload.hitSelector
            : undefined;
        const bridgeSelector = hitSelector ?? targetSelector;
        // Source-location IDs can become repeated after a render, so retain the hit path as their
        // instance discriminator. Plain IDs remain anchored by their unique identity.
        const nodeElement =
          canvas && nodeId ? findNodeElement(canvas, nodeId) : null;
        const nodeFoundById = Boolean(nodeElement);
        const anchorSelector = nodeFoundById
          ? nodeElement &&
            nodeId &&
            isSourceLocationMatch(nodeElement, nodeId) &&
            bridgeSelector?.startsWith(SOURCE_EQUIVALENT_SELECTOR_PREFIX)
            ? bridgeSelector
            : undefined
          : (hitSelector ?? targetSelector);
        if (!nodeId && !anchorSelector && !layerName && !tagName) return;
        setDraftPin((current) => {
          if (
            !current ||
            current.anchor.point.xPct !== next.anchor.point.xPct ||
            current.anchor.point.yPct !== next.anchor.point.yPct
          ) {
            return current;
          }
          const anchor = { ...current.anchor, point: current.anchor.point };
          const cannotResolveNodeIdentity = Boolean(
            nodeId && !nodeFoundById && !anchorSelector,
          );
          const sourceSelectorKeepsIdentity = Boolean(
            nodeId === current.anchor.nodeId &&
            anchorSelector?.startsWith(SOURCE_EQUIVALENT_SELECTOR_PREFIX),
          );
          if (nodeFoundById && nodeId) {
            anchor.nodeId = nodeId;
            if (anchorSelector) anchor.selector = anchorSelector;
            else delete anchor.selector;
          } else if (anchorSelector) {
            if (nodeId) anchor.nodeId = nodeId;
            else delete anchor.nodeId;
            anchor.selector = anchorSelector;
          } else if (cannotResolveNodeIdentity && nodeId) {
            anchor.nodeId = nodeId;
            delete anchor.selector;
            delete anchor.relativePoint;
          }
          if (
            anchor.nodeId !== current.anchor.nodeId ||
            anchor.selector !== current.anchor.selector
          ) {
            if (!sourceSelectorKeepsIdentity) delete anchor.relativePoint;
          }
          const metadata = { ...current.metadata };
          if (nodeFoundById) delete metadata.targetSelector;
          else if (anchorSelector) metadata.targetSelector = anchorSelector;
          else if (cannotResolveNodeIdentity) delete metadata.targetSelector;
          return {
            ...current,
            anchor,
            metadata: {
              ...metadata,
              ...(layerName ? { layerName } : {}),
              ...(tagName ? { tagName } : {}),
            },
          };
        });
      });
      window.setTimeout(
        () => frameCallbacksRef.current.delete(correlationId),
        2_000,
      );
      iframe.contentWindow.postMessage(
        {
          type: "agent-native:review-anchor-at-point",
          correlationId,
          x:
            (clientX - iframeRect.left) *
            (iframe.clientWidth / iframeRect.width),
          y:
            (clientY - iframeRect.top) *
            (iframe.clientHeight / iframeRect.height),
        },
        "*",
      );
    },
    [boardGeometry, canPost, canvas, dropCanvasPin, screenAnchorId, targetId],
  );

  const updateRegionPreview = useCallback(
    (clientX: number, clientY: number) => {
      if (!canvas || !placementDragRef.current) return;
      const { startX, startY } = placementDragRef.current;
      setRegionPreview(
        regionBetween(
          canvas.getBoundingClientRect(),
          { x: startX, y: startY },
          { x: clientX, y: clientY },
        ),
      );
    },
    [canvas],
  );

  const clearHoverNode = useCallback(() => {
    hoverRequestRef.current += 1;
    if (hoverFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = null;
    }
    hoverPointerRef.current = null;
    hoverTargetRef.current = null;
    setHoverTarget(null);
  }, []);

  // The click plane covers the frame, so the frame never gets hover of its own;
  // ask the bridge which node is under the pointer instead.
  const scheduleHoverNode = useCallback(
    (clientX: number, clientY: number) => {
      hoverPointerRef.current = { x: clientX, y: clientY };
      if (hoverFrameRef.current !== null) return;
      hoverFrameRef.current = window.requestAnimationFrame(() => {
        hoverFrameRef.current = null;
        const point = hoverPointerRef.current;
        const iframe = canvas?.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        );
        const iframeRect = iframe?.getBoundingClientRect();
        if (!point || !iframe?.contentWindow || !iframeRect?.width) return;
        const correlationId = crypto.randomUUID();
        const request = ++hoverRequestRef.current;
        frameCallbacksRef.current.set(correlationId, (payload) => {
          // A newer move or a leave has superseded this reply.
          if (request !== hoverRequestRef.current) return;
          const target = hoverTargetFromPayload(payload);
          const unchanged = sameHoverTarget(hoverTargetRef.current, target);
          hoverTargetRef.current = target;
          if (unchanged) return;
          setHoverTarget(target);
        });
        window.setTimeout(
          () => frameCallbacksRef.current.delete(correlationId),
          2_000,
        );
        iframe.contentWindow.postMessage(
          {
            type: "agent-native:review-anchor-at-point",
            correlationId,
            x:
              (point.x - iframeRect.left) *
              (iframe.clientWidth / iframeRect.width),
            y:
              (point.y - iframeRect.top) *
              (iframe.clientHeight / iframeRect.height),
          },
          "*",
        );
      });
    },
    [canvas],
  );

  const requestSelectorBox = useCallback(
    (selector: string, onBox: (reply: ReviewSelectorBoxReply) => void) => {
      const iframe = canvas?.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      if (!iframe?.contentWindow) return;
      const correlationId = crypto.randomUUID();
      const request = ++selectorRequestRef.current;
      frameCallbacksRef.current.set(correlationId, (payload) => {
        // A newer layout change has re-measured since this request went out.
        if (request !== selectorRequestRef.current) return;
        const rawStatus = payload.selectorStatus;
        const selectorStatus: SourceEquivalentSelectorStatus =
          rawStatus === "matched" ||
          rawStatus === "not-found" ||
          rawStatus === "invalid-selector"
            ? rawStatus
            : payload.rect
              ? "matched"
              : "not-found";
        onBox({ box: frameBoxFromPayload(payload), selectorStatus });
      });
      window.setTimeout(
        () => frameCallbacksRef.current.delete(correlationId),
        2_000,
      );
      iframe.contentWindow.postMessage(
        { type: "agent-native:review-selector-rects", correlationId, selector },
        "*",
      );
    },
    [canvas],
  );

  // Panning or zooming moves what sits under a still pointer, and moves the boxes
  // already reported: re-measure both on every layout change.
  const layoutTickRef = useRef(layoutTick);
  useEffect(() => {
    const layoutMoved = layoutTickRef.current !== layoutTick;
    layoutTickRef.current = layoutTick;
    const point = hoverPointerRef.current;
    if (point) scheduleHoverNode(point.x, point.y);
    if (!popoverKey) return;
    if (!snapshotSelector) {
      // A box with no selector cannot be measured again. Once the layout has moved, drop it
      // rather than draw it where the element used to be.
      if (layoutMoved) {
        setPopoverHover((current) =>
          current?.key === popoverKey && current.target?.box
            ? { key: popoverKey, target: { ...current.target, box: null } }
            : current,
        );
      }
      return;
    }
    requestSelectorBox(snapshotSelector, (reply) => {
      setPopoverHover((current) => {
        if (current?.key !== popoverKey || !current.target) return current;
        const target = {
          ...current.target,
          box: reply.box,
          selectorStatus: reply.selectorStatus,
        };
        return sameHoverTarget(current.target, target)
          ? current
          : { key: popoverKey, target };
      });
    });
  }, [
    layoutTick,
    popoverKey,
    requestSelectorBox,
    scheduleHoverNode,
    snapshotSelector,
  ]);

  const handlePlacementPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !canvas || !canPost) return;
      placementDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
      };
      suppressPlacementClickRef.current = false;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [canPost, canvas],
  );

  const handlePlacementPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = placementDragRef.current;
      if (!start || !canvas) return;
      placementDragRef.current = null;
      suppressPlacementClickRef.current = true;
      const area = workingAreaRect(canvas.getBoundingClientRect());
      const endX = Math.min(
        Math.max(event.clientX, area.left),
        area.left + area.width,
      );
      const endY = Math.min(
        Math.max(event.clientY, area.top),
        area.top + area.height,
      );
      const isRegion =
        Math.abs(endX - start.startX) > 6 || Math.abs(endY - start.startY) > 6;
      const region = isRegion
        ? regionBetween(
            canvas.getBoundingClientRect(),
            { x: start.startX, y: start.startY },
            { x: endX, y: endY },
          )
        : null;
      if (region) {
        dropPin(
          start.startX + (endX - start.startX) / 2,
          start.startY + (endY - start.startY) / 2,
          region,
        );
      } else {
        dropPin(endX, endY);
      }
      setRegionPreview(null);
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    },
    [canvas, dropPin],
  );
  useEffect(() => {
    if (
      !active ||
      hidden ||
      !canvas ||
      !canPost ||
      !pinRequest ||
      pinRequest.nonce === lastPinRequestNonceRef.current
    ) {
      return;
    }
    lastPinRequestNonceRef.current = pinRequest.nonce;
    dropCanvasPin(pinRequest.canvasPoint);
  }, [active, canPost, canvas, dropCanvasPin, hidden, pinRequest]);

  // Runs after the comment is saved, so a failed start never loses it.
  const startAgentFromComment = useCallback(
    (comment: ReviewComment, mentions: readonly ReviewMention[]) => {
      const chip = firstAgentMention(mentions);
      if (!chip || !reviewAgent) return;
      const selection = reviewAgent.resolveMention(chip);
      if (!selection) {
        toast.error(t("review.agent.startFailed"));
        return;
      }
      void reviewAgent.start({
        threadId: comment.threadId,
        mode: "auto",
        triggerCommentId: comment.id,
        selection,
      });
    },
    [reviewAgent, t],
  );

  const postDraft = useCallback(
    (
      pin: ReviewDraftPin,
      attachments: readonly ReviewImageAttachment[],
      mentions: readonly ReviewMention[],
    ) => {
      const body = pin.draft.trim();
      if (!body || createComment.isPending) return;
      createComment.mutate(
        {
          resourceType,
          resourceId,
          targetId,
          kind: "annotation",
          anchor: pin.anchor,
          body,
          resolutionTarget: pin.resolutionTarget,
          ...(mentions.length ? { mentions: [...mentions] } : {}),
          metadata: {
            ...pin.metadata,
            ...(attachments.length
              ? { attachments: reviewAttachmentMetadata(attachments) }
              : {}),
          },
        },
        {
          onSuccess: (comment) => {
            cancelDraft();
            if (pin.resolutionTarget === "agent") {
              onDispatchCommentToAgent?.(comment);
            }
            startAgentFromComment(comment, mentions);
          },
          onError: () => toast.error(t("review.postFailed")),
        },
      );
    },
    [
      cancelDraft,
      createComment,
      onDispatchCommentToAgent,
      resourceId,
      resourceType,
      startAgentFromComment,
      t,
      targetId,
    ],
  );

  const submitReprompt = useCallback(
    async (
      pin: ReviewDraftPin,
      attachments: readonly ReviewImageAttachment[],
    ) => {
      const instruction = pin.draft;
      const resolved = resolveReviewAnchor(pin.anchor, () => null);
      const nodeId = resolved?.anchor.nodeId;
      const targetSelector =
        typeof pin.metadata.targetSelector === "string"
          ? pin.metadata.targetSelector
          : resolved?.anchor.selector;
      if (
        !instruction.trim() ||
        (!nodeId && !targetSelector) ||
        !targetId ||
        !sourceVersionHash ||
        !targetId ||
        sourceType !== "inline" ||
        agentSubmitting
      ) {
        return;
      }
      const target: NodeRewriteTarget = {
        ...(nodeId ? { nodeId } : {}),
        ...(targetSelector ? { selector: targetSelector } : {}),
      };
      const repromptId = crypto.randomUUID();
      const pending = {
        repromptId,
        designId: resourceId,
        fileId: targetId,
        target,
        baseVersionHash: sourceVersionHash,
        instruction,
        createdAt: new Date().toISOString(),
      };
      let element = nodeId ? findNodeElement(canvas!, nodeId) : null;
      if (!element && targetSelector && canvas) {
        element = selectorElement(canvas, targetSelector);
      }
      setAgentSubmitting(true);
      try {
        await callAction("begin-node-rewrite-request", pending);
        setDraftMode("reprompt");
        setPendingRepromptId(repromptId);
        const submission = formatNodeRepromptSubmission({
          ...pending,
          subtreeHtml: isRenderedElement(element)
            ? element.outerHTML
            : undefined,
        });
        const delivery = await sendToDesignAgentChatAndConfirm(
          {
            ...submission,
            submit: true,
            openSidebar: true,
            ...(attachments.length
              ? { attachments: reviewAgentAttachments(attachments) }
              : {}),
          },
          { timeoutMs: 10_000 },
        );
        if (!delivery.delivered) {
          throw new Error(delivery.reason ?? "Reprompt was not delivered.");
        }
        setDraftComposerOpen(false);
        toast.success(t("designEditor.nodeRewrite.sent"));
      } catch (error) {
        setPendingRepromptId(null);
        setDraftMode("comment");
        await callAction("cancel-node-rewrite-request", {
          designId: resourceId,
          fileId: targetId,
          repromptId,
        }).catch(() => {});
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : t("designEditor.nodeRewrite.sendFailed"),
        );
      } finally {
        setAgentSubmitting(false);
      }
    },
    [
      canvas,
      agentSubmitting,
      resourceId,
      sourceType,
      sourceVersionHash,
      t,
      targetId,
    ],
  );

  // A preset that cannot submit (stale source, busy agent) leaves its
  // instruction in the open composer for the user to send.
  useEffect(() => {
    if (!draftPin || autoSubmitRepromptPinIdRef.current !== draftPin.id) return;
    autoSubmitRepromptPinIdRef.current = null;
    void submitReprompt(draftPin, []);
  }, [draftPin, submitReprompt]);

  const moveThread = useCallback(
    (thread: ReviewThread, point: ReviewAnchorPoint) => {
      if (
        !canPost ||
        thread.root.canDelete !== true ||
        !canvas ||
        updateComment.isPending
      )
        return;
      const parsed = parseReviewAnchor(thread.root.anchor);
      if (!parsed) return;
      const nextAnchor: DesignReviewAnchor = { ...parsed, point };
      if (screenAnchorId) {
        nextAnchor.screenId = screenAnchorId;
        nextAnchor.screenPoint = point;
      }
      if (targetId === null && boardGeometry) {
        const nextWorldPoint = boardWorldPointFromCanvasPoint(
          point,
          boardGeometry,
        );
        if (nextWorldPoint) {
          const previousWorldPoint =
            parsed.worldPoint ??
            boardWorldPointFromCanvasPoint(parsed.point, boardGeometry);
          nextAnchor.worldPoint = nextWorldPoint;
          if (parsed.worldRegion && previousWorldPoint) {
            nextAnchor.worldRegion = {
              ...parsed.worldRegion,
              x: parsed.worldRegion.x + nextWorldPoint.x - previousWorldPoint.x,
              y: parsed.worldRegion.y + nextWorldPoint.y - previousWorldPoint.y,
            };
          }
        }
      }
      if (parsed.relativePoint) {
        const canvasRect = canvas.getBoundingClientRect();
        const clientX = canvasRect.left + (point.xPct / 100) * canvasRect.width;
        const clientY = canvasRect.top + (point.yPct / 100) * canvasRect.height;
        // A repeated source location has no node element; the saved selector still names the instance.
        const element =
          (parsed.nodeId ? findNodeElement(canvas, parsed.nodeId) : null) ??
          (parsed.selector ? selectorElement(canvas, parsed.selector) : null);
        const relativePoint = element
          ? elementRelativePoint(canvas, element, clientX, clientY)
          : null;
        if (relativePoint) nextAnchor.relativePoint = relativePoint;
        else delete nextAnchor.relativePoint;
      }
      setOptimisticAnchors((current) => ({
        ...current,
        [thread.root.threadId]: nextAnchor,
      }));
      updateComment.mutate(
        {
          resourceType,
          resourceId,
          commentId: thread.root.id,
          anchor: nextAnchor,
        },
        {
          onSuccess: async () => {
            const refreshed = await comments.refetch();
            if (refreshed.error) return;
            setOptimisticAnchors((current) => {
              if (!(thread.root.threadId in current)) return current;
              const next = { ...current };
              delete next[thread.root.threadId];
              return next;
            });
          },
          onError: () => {
            setOptimisticAnchors((current) => {
              const next = { ...current };
              delete next[thread.root.threadId];
              return next;
            });
            toast.error(t("review.updateFailed"));
          },
        },
      );
    },
    [
      boardGeometry,
      canPost,
      canvas,
      comments.refetch,
      resourceId,
      resourceType,
      screenAnchorId,
      targetId,
      t,
      updateComment,
    ],
  );

  // Native, not onWheel: React attaches wheel passively, which cannot cancel a pinch.
  const overlayRootRef = useCallback(
    (root: HTMLDivElement | null) => {
      if (!root) return;
      const handleWheel = (event: WheelEvent) =>
        forwardReviewOverlayWheel(event, canvas);
      root.addEventListener("wheel", handleWheel, { passive: false });
      return () => root.removeEventListener("wheel", handleWheel);
    },
    [canvas],
  );

  // Unmounting the plane fires no pointerleave, so a hover from before would survive toggling pin mode back on.
  const planeMounted =
    Boolean(canvas) &&
    !hidden &&
    active &&
    canPost &&
    !pendingRepromptId &&
    showPlacementPlane;
  useEffect(() => {
    if (!planeMounted) clearHoverNode();
  }, [clearHoverNode, planeMounted]);

  if (hidden || !canvas) return null;
  if (
    !active &&
    !draftPin &&
    !deleteCandidate &&
    !threads.some((thread) => thread.root.anchor)
  ) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const region = reviewVisibleRegion(canvas);
  void layoutTick;

  const positionClientPoint = (
    position: ReviewPinPosition,
  ): ReviewCanvasPoint =>
    (position.canvasPoint
      ? canvasPointToClientPoint(canvas, position.canvasPoint)
      : null) ?? {
      x: rect.left + (position.point.xPct / 100) * rect.width,
      y: rect.top + (position.point.yPct / 100) * rect.height,
    };
  const popoverAnchorFor = (
    point: ReviewAnchorPoint,
    clientPoint: ReviewCanvasPoint,
  ): ReviewPopoverAnchor => ({
    clientPoint,
    region,
    preferred: getReviewPopoverPlacement(
      point,
      { x: clientPoint.x - region.left, y: clientPoint.y - region.top },
      { width: region.width, height: region.height },
    ),
  });

  const visibleThreads = threads.filter((thread) => thread.root.anchor);
  const positionedThreads = visibleThreads
    .flatMap((thread) => {
      const position = pinPositionFor(thread.root.threadId, thread.root.anchor);
      return position ? [{ thread, position }] : [];
    })
    .map((entry) => ({
      ...entry,
      clientPoint: positionClientPoint(entry.position),
    }))
    .filter((entry) => isReviewPointVisible(region, entry.clientPoint));
  // ponytail: bounded review lists make this simple O(n²) cluster scan preferable to a spatial index.
  const pinGroups: Array<{
    key: string;
    point: ReviewAnchorPoint;
    entries: typeof positionedThreads;
  }> = [];
  for (const entry of positionedThreads) {
    const group = pinGroups.find((candidate) => {
      const dx = candidate.point.xPct - entry.position.point.xPct;
      const dy = candidate.point.yPct - entry.position.point.yPct;
      return Math.hypot((dx / 100) * rect.width, (dy / 100) * rect.height) < 32;
    });
    if (group) {
      group.entries.push(entry);
      group.point = {
        xPct:
          group.entries.reduce(
            (sum, item) => sum + item.position.point.xPct,
            0,
          ) / group.entries.length,
        yPct:
          group.entries.reduce(
            (sum, item) => sum + item.position.point.yPct,
            0,
          ) / group.entries.length,
      };
    } else {
      pinGroups.push({
        key: entry.thread.root.threadId,
        point: entry.position.point,
        entries: [entry],
      });
    }
  }
  const draftPinPosition = draftPin
    ? pinPositionFor(null, draftPin.anchor)
    : null;
  const draftClientPoint = draftPinPosition
    ? positionClientPoint(draftPinPosition)
    : null;
  const pinPlacementEnabled = active && canPost && !pendingRepromptId;
  const placementPlaneVisible = pinPlacementEnabled && showPlacementPlane;
  const placementRect = placementPlaneVisible ? workingAreaRect(rect) : rect;
  const placementHintVisible =
    placementPlaneVisible &&
    !draftComposerOpen &&
    !activeThreadId &&
    !repromptDraftRequest;
  const highlightRect =
    placementPlaneVisible && canvas && highlightTarget
      ? hoverTargetClientRect(canvas, highlightTarget, frameNodeGeometry)
      : null;

  return createPortal(
    <div
      ref={overlayRootRef}
      data-review-overlay-root
      className="contents"
      onMouseDown={stopReviewOverlayEvent}
      onClick={stopReviewOverlayEvent}
    >
      {/* Focus lands here when the pin it was on is gone. The root is
          `display: contents`, which cannot take focus, and this empty span
          needs the real box `sr-only` gives it. */}
      <span
        ref={focusFallbackRef}
        tabIndex={-1}
        data-review-focus-fallback
        className="sr-only"
      />
      {placementPlaneVisible ? (
        <div
          data-review-click-plane
          data-review-click-plane-target={
            screenAnchorId ?? (boardGeometry ? "board" : undefined)
          }
          className="fixed z-40 cursor-crosshair"
          style={{
            left: placementRect.left,
            top: placementRect.top,
            width: placementRect.width,
            height: placementRect.height,
          }}
          onPointerDown={handlePlacementPointerDown}
          onPointerMove={(event) => {
            updateRegionPreview(event.clientX, event.clientY);
            scheduleHoverNode(event.clientX, event.clientY);
          }}
          onPointerLeave={clearHoverNode}
          onPointerUp={handlePlacementPointerUp}
          onPointerCancel={handlePlacementPointerUp}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (suppressPlacementClickRef.current) {
              suppressPlacementClickRef.current = false;
              return;
            }
            dropPin(event.clientX, event.clientY);
          }}
        />
      ) : null}
      <div
        data-review-layer
        className="pointer-events-none fixed inset-0 z-[45]"
        style={{ clipPath: reviewRegionClipPath(region) }}
      >
        {highlightRect ? (
          <div
            data-review-hover-highlight
            className="pointer-events-none fixed z-[41] border-2 border-primary bg-primary/10"
            style={{
              left: highlightRect.left,
              top: highlightRect.top,
              width: highlightRect.width,
              height: highlightRect.height,
            }}
          />
        ) : null}
        {pinPlacementEnabled && regionPreview ? (
          <div
            data-review-region-preview
            className="pointer-events-none fixed z-[41] border-2 border-primary bg-primary/10"
            style={{
              left: rect.left + (regionPreview.xPct / 100) * rect.width,
              top: rect.top + (regionPreview.yPct / 100) * rect.height,
              width: (regionPreview.widthPct / 100) * rect.width,
              height: (regionPreview.heightPct / 100) * rect.height,
            }}
          />
        ) : null}
        {placementHintVisible ? (
          <div
            className="pointer-events-none fixed top-16 z-[45] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-popover px-3 py-1.5 text-xs shadow-lg"
            style={{ left: region.left + region.width / 2 }}
          >
            <IconMessageCircle className="size-3.5 text-primary" />
            {t("review.clickToPin")}
            <span className="text-[10px] text-muted-foreground">
              {t("review.escToExit")}
            </span>
          </div>
        ) : null}
        {pinGroups.map((group) => {
          if (group.entries.length > 1 && expandedClusterKey !== group.key) {
            return (
              <ReviewPinCluster
                key={group.key}
                threads={group.entries.map(({ thread }) => thread)}
                canvasRect={rect}
                point={group.point}
                onClick={() => {
                  setExpandedClusterKey(group.key);
                  const thread = group.entries[0]!.thread;
                  if (threadIsUnread(thread.root.threadId)) {
                    setThreadUnread(thread, false);
                  }
                  setActiveThreadId(thread.root.threadId);
                }}
              />
            );
          }
          return group.entries.map(({ thread, position, clientPoint }) => (
            <ReviewPin
              key={thread.root.threadId}
              canvasRect={rect}
              point={position.point}
              clientPoint={clientPoint}
              authors={threadPinAuthors(thread)}
              commentCount={thread.replies.length + 1}
              pinRef={(element) => {
                if (element) {
                  pinElementsRef.current.set(thread.root.threadId, element);
                } else {
                  pinElementsRef.current.delete(thread.root.threadId);
                }
              }}
              onClick={() => {
                if (!draftPin?.draft.trim()) setDraftPin(null);
                setDraftComposerOpen(false);
                setReplyDraft("");
                setReplyAttachments([]);
                setReplyMentions([]);
                setEditCandidate(null);
                setEditDraft("");
                setEditMentions([]);
                if (threadIsUnread(thread.root.threadId)) {
                  setThreadUnread(thread, false);
                }
                setActiveThreadId(thread.root.threadId);
              }}
              active={activeThreadId === thread.root.threadId}
              resolved={thread.root.status === "resolved"}
              unread={threadIsUnread(thread.root.threadId)}
              region={(() => {
                const parsed = parseReviewAnchor(
                  optimisticAnchors[thread.root.threadId] ?? thread.root.anchor,
                );
                return parsed?.worldRegion && boardGeometry
                  ? (canvasRegionFromBoardWorldRegion(
                      parsed.worldRegion,
                      boardGeometry,
                    ) ?? parsed.region)
                  : parsed?.region;
              })()}
              canMove={
                canPost &&
                thread.root.canDelete === true &&
                !updateComment.isPending
              }
              onMove={(point) => moveThread(thread, point)}
            >
              {activeThreadId === thread.root.threadId ? (
                <ReviewThreadPopover
                  thread={thread}
                  canResolve={canResolve}
                  discussion={discussion}
                  onReact={react}
                  pendingReaction={
                    reactToComment.isPending ? reactToComment.variables : null
                  }
                  currentUserEmail={currentUserEmail}
                  canReply={canPost && thread.root.status === "open"}
                  canEdit={Boolean(
                    canPost &&
                    normalizedCurrentUserEmail &&
                    thread.root.authorEmail?.trim().toLowerCase() ===
                      normalizedCurrentUserEmail,
                  )}
                  editing={editCandidate?.id === thread.root.id}
                  editDraft={editDraft}
                  editMentions={editMentions}
                  updating={updateComment.isPending}
                  onEdit={() => {
                    setEditCandidate(thread.root);
                    setEditDraft(thread.root.body);
                    setEditMentions([...thread.root.mentions]);
                  }}
                  onEditDraftChange={setEditDraft}
                  onEditMentionsChange={setEditMentions}
                  onEditCancel={() => {
                    setEditCandidate(null);
                    setEditDraft("");
                    setEditMentions([]);
                  }}
                  onEditSubmit={submitEdit}
                  unread={threadIsUnread(thread.root.threadId)}
                  onCopyLink={() => void copyThreadLink(thread)}
                  onSetUnread={(unread) => setThreadUnread(thread, unread)}
                  onDelete={() => setDeleteCandidate(thread.root)}
                  canDelete={canPost && (thread.root.canDelete ?? false)}
                  onAgentAction={
                    onSendThreadToAgent &&
                    canResolve &&
                    thread.root.status === "open"
                      ? (action) => onSendThreadToAgent(thread, action)
                      : undefined
                  }
                  agentItems={{
                    suggest: Boolean(reviewAgent),
                    reply: Boolean(reviewAgent),
                    // The server re-checks; this hides the item for a board
                    // thread or a screen an agent cannot edit.
                    apply:
                      Boolean(reviewAgent) &&
                      thread.root.targetId != null &&
                      sourceType === "inline",
                  }}
                  agentActionsDisabled={
                    Boolean(sendingThreadId) ||
                    Boolean(reviewAgent?.isThreadBusy(thread.root.threadId))
                  }
                  reviewAgent={reviewAgent}
                  anchor={popoverAnchorFor(position.point, clientPoint)}
                  replyDraft={replyDraft}
                  replyMentions={replyMentions}
                  mentionOptions={mentionOptions}
                  editMentionOptions={peopleMentionOptions}
                  replyAttachments={replyAttachments}
                  onReplyAttachmentsChange={setReplyAttachments}
                  onReplyDraftChange={setReplyDraft}
                  onReplyMentionsChange={setReplyMentions}
                  onClose={dismissActiveThread}
                  onReply={() => {
                    const body = replyDraft.trim();
                    if (!body) return;
                    const sentMentions = replyMentions;
                    replyComment.mutate(
                      {
                        resourceType,
                        resourceId,
                        commentId: thread.root.id,
                        body,
                        ...(replyMentions.length
                          ? { mentions: [...replyMentions] }
                          : {}),
                        ...(replyAttachments.length
                          ? {
                              metadata: {
                                attachments:
                                  reviewAttachmentMetadata(replyAttachments),
                              },
                            }
                          : {}),
                      },
                      {
                        onSuccess: (comment) => {
                          setReplyDraft("");
                          setReplyAttachments([]);
                          setReplyMentions([]);
                          startAgentFromComment(comment, sentMentions);
                        },
                        onError: () => toast.error(t("review.replyFailed")),
                      },
                    );
                  }}
                  onStatusChange={() =>
                    resolveThread.mutate(
                      {
                        resourceType,
                        resourceId,
                        threadId: thread.root.threadId,
                        status:
                          thread.root.status === "open" ? "resolved" : "open",
                      },
                      {
                        onSuccess: () => {
                          // The user may have opened another thread while this
                          // request was in flight; that one stays open.
                          if (
                            activeThreadIdRef.current === thread.root.threadId
                          ) {
                            focusReturnRef.current = focusReturnTo(
                              thread.root.threadId,
                            );
                            setActiveThreadId(null);
                          }
                          if (thread.root.status === "open") {
                            toast.success(t("review.resolved"), {
                              action: {
                                label: t("review.undo"),
                                onClick: () =>
                                  resolveThread.mutate({
                                    resourceType,
                                    resourceId,
                                    threadId: thread.root.threadId,
                                    status: "open",
                                  }),
                              },
                            });
                          } else {
                            toast.success(t("review.reopen"));
                          }
                        },
                        onError: () => toast.error(t("review.resolveFailed")),
                      },
                    )
                  }
                  replying={replyComment.isPending}
                  resolving={resolveThread.isPending}
                />
              ) : null}
            </ReviewPin>
          ));
        })}
        {draftPin &&
        draftPinPosition &&
        draftClientPoint &&
        isReviewPointVisible(region, draftClientPoint) ? (
          <ReviewPin
            key={draftPin.id}
            canvasRect={rect}
            point={draftPinPosition.point}
            clientPoint={draftClientPoint}
            authors={[
              currentUserEmail !== undefined ? { email: currentUserEmail } : {},
            ]}
            draft
            pending={Boolean(pendingRepromptId)}
            onClick={() => {
              if (pendingRepromptId) return;
              setActiveThreadId(null);
              setReplyDraft("");
              setReplyAttachments([]);
              setDraftComposerOpen(true);
            }}
            active={draftComposerOpen}
          >
            {draftComposerOpen ? (
              <DraftComposer
                value={draftPin.draft}
                mentions={draftMentions}
                mentionOptions={
                  draftMode === "reprompt"
                    ? peopleMentionOptions
                    : mentionOptions
                }
                onMentionsChange={setDraftMentions}
                attachments={draftAttachments}
                onAttachmentsChange={setDraftAttachments}
                onChange={(value) => {
                  setDraftPin((current) =>
                    current ? { ...current, draft: value } : current,
                  );
                  setDraftMentions((current) =>
                    current.filter((mention) =>
                      value.includes(`@${mention.label}`),
                    ),
                  );
                }}
                onCancel={dismissDraft}
                onSubmit={() => {
                  if (draftMode === "reprompt") {
                    if (sourceType !== "inline") {
                      toast.error(t("designEditor.nodeRewrite.sendFailed"));
                      return;
                    }
                    void submitReprompt(draftPin, draftAttachments);
                    return;
                  }
                  postDraft(
                    { ...draftPin, resolutionTarget: "human" },
                    draftAttachments,
                    draftMentions,
                  );
                }}
                reprompt={draftMode === "reprompt"}
                currentUserEmail={currentUserEmail}
                anchor={popoverAnchorFor(
                  draftPinPosition.point,
                  draftClientPoint,
                )}
                submitting={createComment.isPending || agentSubmitting}
              />
            ) : null}
          </ReviewPin>
        ) : null}
      </div>
      <AlertDialog
        open={Boolean(deleteCandidate)}
        onOpenChange={(open) => {
          if (!open && !deleteComment.isPending) setDeleteCandidate(null);
        }}
      >
        <AlertDialogContent
          data-review-popover
          overlayProps={{
            "data-review-popover": "",
            "data-review-confirmation-overlay": "",
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("review.deleteCommentTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("review.deleteCommentDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteComment.isPending}>
              {t("review.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!deleteCandidate || deleteComment.isPending}
              onClick={(event) => {
                event.preventDefault();
                const candidate = deleteCandidate;
                if (!candidate) return;
                // The optimistic delete unmounts the pin before this succeeds.
                const returnTo = focusReturnTo(candidate.threadId);
                deleteComment.mutate(
                  { resourceType, resourceId, commentId: candidate.id },
                  {
                    onSuccess: () => {
                      setDeleteCandidate(null);
                      if (activeThreadIdRef.current === candidate.threadId) {
                        focusReturnRef.current = returnTo;
                        closeActiveThread();
                      }
                    },
                    onError: () => toast.error(t("review.postFailed")),
                  },
                );
              }}
            >
              {t("review.deleteComment")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>,
    document.body,
  );
}

function reviewPinAuthor(comment: ReviewComment): ReviewPinAuthor {
  return {
    name: comment.authorName,
    email: comment.authorEmail,
    agent: resolveReviewAgent({
      createdBy: comment.createdBy,
      authorName: comment.authorName,
    }),
  };
}

function threadPinAuthors(thread: ReviewThread): ReviewPinAuthor[] {
  return [thread.root, ...thread.replies].map(reviewPinAuthor);
}

const MAX_NAMED_PIN_AUTHORS = 2;

// What the pin shows: who is in the thread, how many comments, and its state.
function reviewThreadPinLabel({
  t,
  formatList,
  authors,
  count,
  unread,
  resolved,
}: {
  t: ReturnType<typeof useT>;
  formatList: ReturnType<typeof useFormatters>["formatList"];
  authors: ReviewPinAuthor[];
  count: number;
  unread: boolean;
  resolved: boolean;
}): string {
  const names = uniqueReviewPinAuthors(authors).map((author) =>
    author.agent
      ? author.name?.trim() || t("review.agentBadge")
      : author.name?.trim() || author.email?.trim() || t("review.reviewer"),
  );
  const named = names.slice(0, MAX_NAMED_PIN_AUTHORS);
  const others = names.length - named.length;
  const summary = t("review.pin.thread", {
    authors: formatList(
      others > 0
        ? [...named, t("review.pin.authorsOther", { count: others })]
        : named,
    ),
    count,
  });
  const states: string[] = [];
  if (unread) states.push(t("review.pin.unread"));
  if (resolved) states.push(t("review.pin.resolved"));
  return states.length
    ? formatList([summary, formatList(states)], { type: "unit" })
    : summary;
}

function ReviewPin({
  point,
  canvasRect,
  clientPoint,
  active,
  authors,
  commentCount,
  draft = false,
  pending = false,
  resolved = false,
  unread = false,
  region,
  canMove = false,
  onMove,
  onClick,
  pinRef,
  children,
}: {
  point: ReviewAnchorPoint;
  canvasRect: DOMRect;
  clientPoint?: ReviewCanvasPoint | null | undefined;
  /** This pin's card is open. */
  active: boolean;
  authors: ReviewPinAuthor[];
  commentCount?: number;
  /** The pin of a comment that is not posted yet; it reads as "Draft comment". */
  draft?: boolean;
  pending?: boolean;
  resolved?: boolean;
  unread?: boolean;
  region?: ReviewAnchorRegion | undefined;
  canMove?: boolean;
  onMove?: (point: ReviewAnchorPoint) => void;
  onClick: () => void;
  pinRef?: Ref<HTMLButtonElement> | undefined;
  children?: ReactNode;
}) {
  const t = useT();
  const { formatList } = useFormatters();
  const movedRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragPointRef = useRef<ReviewAnchorPoint | null>(null);
  const pointerMoveHandlerRef = useRef<((event: PointerEvent) => void) | null>(
    null,
  );
  const pointerUpHandlerRef = useRef<(() => void) | null>(null);
  const stopPointerTracking = useCallback(() => {
    const pointerMoveHandler = pointerMoveHandlerRef.current;
    const pointerUpHandler = pointerUpHandlerRef.current;
    if (pointerMoveHandler)
      window.removeEventListener("pointermove", pointerMoveHandler);
    if (pointerUpHandler) {
      window.removeEventListener("pointerup", pointerUpHandler);
      window.removeEventListener("pointercancel", pointerUpHandler);
    }
    pointerMoveHandlerRef.current = null;
    pointerUpHandlerRef.current = null;
  }, []);
  const handlePointerMove = (event: PointerEvent) => {
    const start = pointerStartRef.current;
    if (!start || !onMove) return;
    if (
      Math.abs(event.clientX - start.x) > 3 ||
      Math.abs(event.clientY - start.y) > 3
    ) {
      movedRef.current = true;
    }
    if (!movedRef.current) return;
    const xPct = clampPercent(
      ((event.clientX - canvasRect.left) / canvasRect.width) * 100,
    );
    const yPct = clampPercent(
      ((event.clientY - canvasRect.top) / canvasRect.height) * 100,
    );
    dragPointRef.current = { xPct, yPct };
  };
  const handlePointerUp = () => {
    if (movedRef.current && dragPointRef.current)
      onMove?.(dragPointRef.current);
    pointerStartRef.current = null;
    dragPointRef.current = null;
    stopPointerTracking();
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canMove || event.button !== 0 || !onMove) return;
    event.preventDefault();
    event.stopPropagation();
    movedRef.current = false;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    dragPointRef.current = null;
    pointerMoveHandlerRef.current = handlePointerMove;
    pointerUpHandlerRef.current = handlePointerUp;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };
  useEffect(
    () => () => {
      stopPointerTracking();
      pointerStartRef.current = null;
      dragPointRef.current = null;
    },
    [stopPointerTracking],
  );
  return (
    <div
      data-review-popover
      className="pointer-events-auto fixed z-[45]"
      style={{
        left:
          clientPoint?.x ??
          canvasRect.left + (point.xPct / 100) * canvasRect.width,
        top:
          clientPoint?.y ??
          canvasRect.top + (point.yPct / 100) * canvasRect.height,
      }}
    >
      {region ? (
        <div
          data-review-region
          className="pointer-events-none fixed z-[44] border-2 border-primary/60 bg-primary/10"
          style={{
            left: canvasRect.left + (region.xPct / 100) * canvasRect.width,
            top: canvasRect.top + (region.yPct / 100) * canvasRect.height,
            width: (region.widthPct / 100) * canvasRect.width,
            height: (region.heightPct / 100) * canvasRect.height,
          }}
        />
      ) : null}
      <ReviewPinBadge
        data-review-pin
        data-review-unread={unread ? "true" : undefined}
        authors={authors}
        {...(commentCount !== undefined ? { count: commentCount } : {})}
        ref={pinRef}
        selected={active}
        resolved={resolved}
        unread={unread}
        pending={pending}
        className={cn(
          "-translate-x-1/2 -translate-y-1/2 hover:scale-110",
          unread && !active && "ring-2 ring-foreground/70",
          canMove && "cursor-grab active:cursor-grabbing",
        )}
        onClick={(event) => {
          event.stopPropagation();
          if (movedRef.current) {
            movedRef.current = false;
            event.preventDefault();
            return;
          }
          onClick();
        }}
        onPointerDown={handlePointerDown}
        onKeyDown={(event) => {
          if (!canMove || !onMove || !event.key.startsWith("Arrow")) return;
          const step = event.shiftKey ? 5 : 1;
          const delta =
            event.key === "ArrowLeft"
              ? { xPct: -step, yPct: 0 }
              : event.key === "ArrowRight"
                ? { xPct: step, yPct: 0 }
                : event.key === "ArrowUp"
                  ? { xPct: 0, yPct: -step }
                  : { xPct: 0, yPct: step };
          event.preventDefault();
          event.stopPropagation();
          onMove({
            xPct: clampPercent(point.xPct + delta.xPct),
            yPct: clampPercent(point.yPct + delta.yPct),
          });
        }}
        ariaLabel={
          draft
            ? t("review.pin.draft")
            : reviewThreadPinLabel({
                t,
                formatList,
                authors,
                count: commentCount ?? 1,
                unread,
                resolved,
              })
        }
        aria-expanded={active}
        aria-haspopup="dialog"
        aria-keyshortcuts={
          canMove ? "ArrowUp ArrowDown ArrowLeft ArrowRight" : undefined
        }
      />
      {children}
    </div>
  );
}

function ReviewPinCluster({
  threads,
  point,
  canvasRect,
  onClick,
}: {
  threads: ReviewThread[];
  point: ReviewAnchorPoint;
  canvasRect: DOMRect;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <ReviewPinBadge
      data-review-pin-cluster
      authors={threads.map(({ root }) => reviewPinAuthor(root))}
      count={threads.length}
      className="pointer-events-auto fixed z-[45] -translate-x-1/2 -translate-y-1/2 hover:scale-110"
      style={{
        left: canvasRect.left + (point.xPct / 100) * canvasRect.width,
        top: canvasRect.top + (point.yPct / 100) * canvasRect.height,
      }}
      ariaLabel={t("review.commentsInCluster", { count: threads.length })}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    />
  );
}

function useReviewImageAttachments({
  attachments,
  disabled = false,
  onChange,
}: {
  attachments: ReviewImageAttachment[];
  disabled?: boolean;
  onChange: (attachments: ReviewImageAttachment[]) => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const mountedRef = useRef(true);
  const [uploading, setUploading] = useState(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const handleFiles = async (files: FileList | null) => {
    const remaining =
      MAX_REVIEW_IMAGE_ATTACHMENTS - attachmentsRef.current.length;
    const selected = Array.from(files ?? [])
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, Math.max(0, remaining));
    if (!selected.length) return;

    setUploading(true);
    const results = await Promise.allSettled(
      selected.map(async (file) => {
        const uploaded = await uploadEditorImage(file);
        const url = uploaded.src.trim();
        if (!url || /^data:/i.test(url)) {
          throw new Error("Image upload did not return a durable URL.");
        }
        return {
          url,
          name: file.name || "image",
          contentType: file.type || undefined,
          ...(uploaded.provider ? { provider: uploaded.provider } : {}),
        } satisfies ReviewImageAttachment;
      }),
    );
    const uploaded = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (!mountedRef.current) return;
    if (uploaded.length) {
      onChange(
        [...attachmentsRef.current, ...uploaded].slice(
          0,
          MAX_REVIEW_IMAGE_ATTACHMENTS,
        ),
      );
    }
    if (results.some((result) => result.status === "rejected")) {
      toast.error(t("review.postFailed"));
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const toolsEnd = (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-review-attachment-button
        className="size-7 rounded-full text-muted-foreground"
        disabled={
          disabled ||
          uploading ||
          attachments.length >= MAX_REVIEW_IMAGE_ATTACHMENTS
        }
        onClick={() => inputRef.current?.click()}
        aria-label={t("review.attachImage")}
      >
        {uploading ? (
          <Spinner className="size-4" />
        ) : (
          <IconPhoto className="size-4" />
        )}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        data-review-attachment-input
        // Out of the accessibility tree: the image button above is the one
        // named, tabbable control, and it clicks this input.
        tabIndex={-1}
        className="hidden"
        onChange={(event) => void handleFiles(event.currentTarget.files)}
      />
    </>
  );

  const strip = attachments.length ? (
    <div
      data-review-attachments
      className="flex flex-wrap items-center gap-1.5"
    >
      {attachments.map((attachment, index) => (
        <div
          key={`${attachment.url}-${index}`}
          data-review-attachment
          className="group relative size-10 overflow-hidden rounded-md border border-border bg-muted"
        >
          <img
            src={attachment.url}
            alt={attachment.name}
            className="size-full object-cover"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute right-0.5 top-0.5 size-5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            disabled={disabled || uploading}
            onClick={() =>
              onChange(
                attachments.filter(
                  (_, attachmentIndex) => attachmentIndex !== index,
                ),
              )
            }
            aria-label={t("designEditor.close")}
          >
            <IconX className="size-3" />
          </Button>
        </div>
      ))}
    </div>
  ) : undefined;

  return { uploading, toolsEnd, strip };
}

// Placement depends on the popover's own height, which is only known once its
// content has rendered, so the frame measures itself before the first paint.
function ReviewPopoverFrame({
  anchor,
  children,
}: {
  anchor: ReviewPopoverAnchor;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    // scrollHeight is the full content height even while maxHeight scrolls it.
    setHeight(
      element.scrollHeight + element.offsetHeight - element.clientHeight,
    );
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);
  const box = getReviewPopoverBox(
    anchor.clientPoint,
    anchor.region,
    anchor.preferred,
    height,
  );
  return (
    <div
      ref={ref}
      data-review-popover
      className="absolute z-[260] overflow-y-auto overflow-x-hidden rounded-xl shadow-xl"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        maxHeight: box.maxHeight,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

function DraftComposer({
  value,
  mentions,
  mentionOptions,
  onMentionsChange,
  attachments,
  onAttachmentsChange,
  onChange,
  onCancel,
  onSubmit,
  reprompt,
  currentUserEmail,
  anchor,
  submitting,
}: {
  value: string;
  mentions: readonly ReviewMention[];
  mentionOptions: readonly ReviewMentionOption[];
  onMentionsChange: (mentions: ReviewMention[]) => void;
  attachments: ReviewImageAttachment[];
  onAttachmentsChange: (attachments: ReviewImageAttachment[]) => void;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  reprompt: boolean;
  currentUserEmail?: string | null;
  anchor: ReviewPopoverAnchor;
  submitting: boolean;
}) {
  const t = useT();
  const images = useReviewImageAttachments({
    attachments,
    disabled: submitting,
    onChange: onAttachmentsChange,
  });
  const busy = submitting || images.uploading;
  return (
    <ReviewPopoverFrame anchor={anchor}>
      <ReviewThreadCardFrame
        className="w-full"
        title={
          reprompt
            ? t("designEditor.nodeRewrite.composerTitle")
            : t("review.threadTitle")
        }
        closeLabel={t("designEditor.close")}
        onClose={() => {
          if (!submitting) onCancel();
        }}
      >
        <div className="flex items-start gap-2 px-3 py-4">
          <ReviewAuthorAvatar
            className="mt-0.5"
            name={reviewUserLabel(currentUserEmail, t("review.reviewer"))}
            email={currentUserEmail}
            size={24}
          />
          <ReviewCommentComposer
            className="min-w-0 flex-1"
            autoFocus
            value={value}
            mentions={mentions}
            onMentionsChange={onMentionsChange}
            mentionOptions={mentionOptions}
            agentsLabel={t("review.agent.sectionLabel")}
            showCommentTools
            emojiLabel={t("review.addEmoji")}
            mentionLabel={t("review.mention")}
            noMentionsLabel={t("review.noMentions")}
            commentToolsEnd={images.toolsEnd}
            attachments={images.strip}
            disabled={busy}
            onChange={onChange}
            onSubmit={onSubmit}
            submittingTarget={submitting ? "human" : null}
            placeholder={t("review.placeholder")}
            commentLabel={t("review.commentMode")}
            contextLabel={
              reprompt ? t("designEditor.nodeRewrite.willPreview") : undefined
            }
            onEscape={onCancel}
          />
        </div>
      </ReviewThreadCardFrame>
    </ReviewPopoverFrame>
  );
}

// A reaction in flight shows on the chip before the server confirms it.
function reactionsWithPending(
  reactions: readonly ReviewCommentReaction[],
  commentId: string,
  pending: PendingReviewReaction | null,
): ReviewCommentReaction[] {
  if (pending?.commentId !== commentId) return [...reactions];
  const known = reactions.some((entry) => entry.reaction === pending.reaction);
  return [
    ...reactions,
    ...(!known && pending.active
      ? [{ reaction: pending.reaction, count: 0, reactedByMe: false }]
      : []),
  ]
    .map((entry) =>
      entry.reaction === pending.reaction
        ? {
            ...entry,
            count:
              entry.count + Number(pending.active) - Number(entry.reactedByMe),
            reactedByMe: pending.active,
          }
        : entry,
    )
    .filter((entry) => entry.count > 0);
}

function ReviewThreadPopover({
  thread,
  canResolve,
  discussion,
  onReact,
  pendingReaction,
  replying,
  resolving,
  canReply,
  canEdit,
  editing,
  editDraft,
  editMentions,
  updating,
  onEdit,
  onEditDraftChange,
  onEditMentionsChange,
  onEditCancel,
  onEditSubmit,
  unread,
  onCopyLink,
  onSetUnread,
  onDelete,
  canDelete,
  onAgentAction,
  agentItems,
  agentActionsDisabled,
  reviewAgent,
  anchor,
  currentUserEmail,
  replyDraft,
  replyMentions,
  mentionOptions,
  editMentionOptions,
  replyAttachments,
  onReplyAttachmentsChange,
  onReplyDraftChange,
  onReplyMentionsChange,
  onClose,
  onReply,
  onStatusChange,
}: {
  thread: ReviewThread;
  canResolve: boolean;
  discussion?: ReviewDiscussionState | undefined;
  onReact: (commentId: string, reaction: string, active: boolean) => void;
  pendingReaction: PendingReviewReaction | null;
  replying: boolean;
  resolving: boolean;
  canReply: boolean;
  canEdit: boolean;
  editing: boolean;
  editDraft: string;
  editMentions: readonly ReviewMention[];
  updating: boolean;
  onEdit: () => void;
  onEditDraftChange: (value: string) => void;
  onEditMentionsChange: (mentions: ReviewMention[]) => void;
  onEditCancel: () => void;
  onEditSubmit: () => void;
  unread: boolean;
  onCopyLink: () => void;
  onSetUnread: (unread: boolean) => void;
  onDelete: () => void;
  canDelete: boolean;
  /** Set only for editors on an open thread; it backs the agent menu items. */
  onAgentAction: ((action: ReviewThreadAgentAction) => void) | undefined;
  /** Send to agent always shows; the review-agent items need a connected controller. */
  agentItems: { suggest: boolean; reply: boolean; apply: boolean };
  agentActionsDisabled: boolean;
  reviewAgent: ReviewAgentController | null;
  anchor: ReviewPopoverAnchor;
  currentUserEmail?: string | null | undefined;
  replyDraft: string;
  replyMentions: readonly ReviewMention[];
  mentionOptions: readonly ReviewMentionOption[];
  /** A comment edit never starts a run, so it offers people only. */
  editMentionOptions: readonly ReviewMention[];
  replyAttachments: ReviewImageAttachment[];
  onReplyAttachmentsChange: (attachments: ReviewImageAttachment[]) => void;
  onReplyDraftChange: (value: string) => void;
  onReplyMentionsChange: (mentions: ReviewMention[]) => void;
  onClose: () => void;
  onReply: () => void;
  onStatusChange: () => void;
}) {
  const t = useT();
  const cardRef = useRef<HTMLDivElement>(null);
  // The card takes focus when it opens, and again once an edit ends. The reply
  // field stays collapsed until the user goes there, and an edit focuses its own editor.
  useEffect(() => {
    if (!editing) cardRef.current?.focus({ preventScroll: true });
  }, [editing]);
  const replyImages = useReviewImageAttachments({
    attachments: replyAttachments,
    disabled: replying || resolving,
    onChange: onReplyAttachmentsChange,
  });
  const resolvedStatus = thread.root.status === "resolved";
  const canToggleResolution =
    canResolve && (thread.root.status === "open" || resolvedStatus);
  const agentRequest = reviewAgent?.requestForThread(thread.root.threadId);
  const itemLabels = {
    reviewerLabel: t("review.reviewer"),
    agentBadgeLabel: t("review.agentBadge"),
    resolvedLabel: t("review.resolved"),
    unreadLabel: t("review.unread"),
    addReactionLabel: t("review.addReaction"),
    reactionLabel: ({
      emoji,
      count,
      includesYou,
    }: {
      emoji: string;
      count: number;
      includesYou: boolean;
    }) =>
      t(includesYou ? "review.reaction.labelMine" : "review.reaction.label", {
        emoji,
        count,
      }),
  };
  const commentItem = (comment: ReviewComment, variant: "root" | "reply") => (
    <ReviewCommentItem
      key={comment.id}
      comment={comment}
      variant={variant}
      {...itemLabels}
      unread={variant === "root" && unread}
      showReactions
      reactions={reactionsWithPending(
        discussion?.reactions[comment.id] ?? [],
        comment.id,
        pendingReaction,
      )}
      canReact={discussion?.canReact ?? false}
      onReact={(target, reaction, active) =>
        onReact(target.id, reaction, active)
      }
      editor={
        variant === "root" && editing ? (
          <ReviewCommentComposer
            value={editDraft}
            mentions={editMentions}
            onMentionsChange={onEditMentionsChange}
            mentionOptions={editMentionOptions}
            showCommentTools
            emojiLabel={t("review.addEmoji")}
            mentionLabel={t("review.mention")}
            noMentionsLabel={t("review.noMentions")}
            textareaProps={{ "aria-label": t("review.editComment") }}
            autoFocus
            disabled={updating}
            onChange={onEditDraftChange}
            onSubmit={() => onEditSubmit()}
            commentLabel={t("review.save")}
            placeholder={t("review.editComment")}
            onEscape={onEditCancel}
          />
        ) : undefined
      }
    />
  );
  return (
    <ReviewPopoverFrame anchor={anchor}>
      <ReviewThreadCardFrame
        ref={cardRef}
        className="w-full"
        title={t("review.threadTitle")}
        menu={
          <ReviewThreadMenu
            moreActionsLabel={t("review.moreActions")}
            sendToAgentLabel={t("review.sendToAgent")}
            suggestChangesLabel={t("review.suggestChanges")}
            replyInThreadLabel={t("review.replyInThread")}
            applyAndResolveLabel={t("review.applyChangesAndResolve")}
            copyLinkLabel={t("review.copyLink")}
            linkCopiedLabel={t("review.linkCopied")}
            copyLinkFailedLabel={t("review.copyLinkFailed")}
            editLabel={t("review.editComment")}
            deleteLabel={t("review.deleteComment")}
            onSendToAgent={onAgentAction && (() => onAgentAction("send"))}
            onSuggestChanges={
              onAgentAction && agentItems.suggest
                ? () => onAgentAction("suggest")
                : undefined
            }
            onReplyInThread={
              onAgentAction && agentItems.reply
                ? () => onAgentAction("reply")
                : undefined
            }
            onApplyAndResolve={
              onAgentAction && agentItems.apply
                ? () => onAgentAction("apply")
                : undefined
            }
            agentActionsDisabled={agentActionsDisabled}
            canEdit={canEdit}
            onEdit={onEdit}
            onCopyLink={onCopyLink}
            onDelete={canDelete ? onDelete : undefined}
          />
        }
        resolved={resolvedStatus}
        onResolve={canToggleResolution ? onStatusChange : undefined}
        onReopen={canToggleResolution ? onStatusChange : undefined}
        resolving={resolving}
        resolveLabel={t("review.resolve")}
        reopenLabel={t("review.reopen")}
        onClose={onClose}
        closeLabel={t("review.closeThread")}
      >
        <div className={cn("flex flex-col", !canReply && "pb-3")}>
          {commentItem(thread.root, "root")}
          {thread.replies.map((reply) => commentItem(reply, "reply"))}
        </div>
        {reviewAgent ? (
          <ReviewAgentRequestStatus
            className={cn(!canReply && "pb-3")}
            request={agentRequest}
            thread={thread}
            starting={reviewAgent.startingThreadIds.has(thread.root.threadId)}
            startingAgentName={reviewAgent.startingAgentName(
              thread.root.threadId,
            )}
            stopping={
              agentRequest !== undefined &&
              reviewAgent.stoppingRequestIds.has(agentRequest.requestId)
            }
            onStop={(request) => void reviewAgent.stop(request)}
            onOpen={reviewAgent.open}
            onRetry={(request) => void reviewAgent.retry(request)}
          />
        ) : null}
        {canReply ? (
          <div className="group/reply flex items-start gap-2 px-3 py-4">
            <div className="mt-2 shrink-0 group-has-data-expanded/reply:mt-0.5">
              <ReviewAuthorAvatar
                name={reviewUserLabel(currentUserEmail, t("review.reviewer"))}
                email={currentUserEmail}
                size={24}
              />
            </div>
            <ReviewCommentComposer
              className="min-w-0 flex-1"
              variant="reply"
              value={replyDraft}
              mentions={replyMentions}
              onMentionsChange={onReplyMentionsChange}
              mentionOptions={mentionOptions}
              agentsLabel={t("review.agent.sectionLabel")}
              showCommentTools
              commentToolsEnd={replyImages.toolsEnd}
              attachments={replyImages.strip}
              emojiLabel={t("review.addEmoji")}
              mentionLabel={t("review.mention")}
              noMentionsLabel={t("review.noMentions")}
              textareaProps={{ "data-review-reply-input": true }}
              disabled={replying || resolving || replyImages.uploading}
              onChange={onReplyDraftChange}
              onSubmit={() => onReply()}
              submittingTarget={replying ? "human" : null}
              commentLabel={t("review.reply")}
              placeholder={t("review.reply")}
              onEscape={onClose}
            />
          </div>
        ) : null}
      </ReviewThreadCardFrame>
    </ReviewPopoverFrame>
  );
}

function reviewUserLabel(email: string | null | undefined, fallback: string) {
  return email?.trim() || fallback;
}
