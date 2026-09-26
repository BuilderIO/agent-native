import { callAction } from "@agent-native/core/client/hooks";
import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrgMembers } from "@agent-native/core/client/org";
import {
  buildReviewThreads,
  ReviewCommentComposer,
  useCreateReviewComment,
  useDeleteReviewComment,
  useReactToReviewComment,
  useReplyReviewComment,
  useResolveReviewThread,
  useReviewComments,
  useSetReviewThreadUnread,
  useUpdateReviewComment,
  isTrustedReviewAttachmentUrl,
  type ReviewThread,
} from "@agent-native/core/client/review";
import { uploadEditorImage } from "@agent-native/core/client/uploads";
import type {
  ReviewComment,
  ReviewCommentReaction,
  ReviewDiscussionState,
  ReviewMention,
} from "@agent-native/core/review";
import { canvasToScreenPoint, screenToCanvasPoint } from "@shared/canvas-math";
import type { NodeRewriteTarget } from "@shared/node-rewrite";
import {
  IconChevronDown,
  IconCircleCheck,
  IconDots,
  IconLink,
  IconMail,
  IconMessageCircle,
  IconMoodSmile,
  IconPaperclip,
  IconSend,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { sendToDesignAgentChatAndConfirm } from "@/lib/agent-chat";
import {
  formatNodeSelectionQuestion,
  formatNodeRepromptSubmission,
  inferNodeRepromptSendMode,
  NODE_REPROMPT_PRESENTED_EVENT,
  NODE_REPROMPT_RESOLVED_EVENT,
  type NodeRepromptSendMode,
} from "@/lib/node-reprompt";
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
  type ReviewCanvasPoint,
} from "../../../shared/review-anchor";
import { SURFACE_PADDING } from "../design/multi-screen/overview-layout";
import {
  getReviewPinPosition,
  getReviewPopoverPlacement,
  placeReviewDraftPin,
  type ReviewDraftPin,
  type ReviewPinPosition,
} from "./review-canvas-state";

export interface RepromptDraftRequest {
  nonce: number;
  fileId: string;
  target: NodeRewriteTarget;
  point?: ReviewAnchorPoint;
}

export interface ReviewFocusRequest {
  nonce: number;
  anchor: unknown;
  targetId?: string | null;
  threadId?: string;
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
  onSendThreadToAgent?: (thread: ReviewThread) => void;
  sendingThreadId?: string | null;
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
const QUICK_REACTIONS = ["👍", "❤️", "🎉", "👀"];
const REVIEW_IDENTITY_SELECTOR =
  "[data-agent-native-node-id],[data-code-layer-id],[data-layer-id],[data-builder-id],[id]";

type ReviewPopoverPlacement = ReturnType<typeof getReviewPopoverPlacement>;

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
    if (escape) {
      return document.querySelector(
        `[data-agent-native-node-id="${escape(nodeId)}"],` +
          `[data-code-layer-id="${escape(nodeId)}"],` +
          `[data-layer-id="${escape(nodeId)}"],` +
          `[data-builder-id="${escape(nodeId)}"],#${escape(nodeId)}`,
      );
    }
    return (
      Array.from(
        document.querySelectorAll(
          "[data-agent-native-node-id],[data-code-layer-id],[data-layer-id],[data-builder-id],[id]",
        ),
      ).find((element) =>
        [
          "data-agent-native-node-id",
          "data-code-layer-id",
          "data-layer-id",
          "data-builder-id",
          "id",
        ].some((attribute) => element.getAttribute(attribute) === nodeId),
      ) ?? null
    );
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

function selectorPoint(
  canvas: HTMLElement,
  selector: string,
): ReviewAnchorPoint | null {
  const iframe = canvas.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  );
  try {
    return elementPoint(
      canvas,
      iframe?.contentDocument?.querySelector(selector) ?? null,
    );
  } catch {
    return null;
  }
}

function structuralSelector(element: Element, document: Document): string {
  if (element === document.body || element === document.documentElement) {
    return "";
  }
  const parts: string[] = [];
  let current: Element | null = element;
  while (
    current &&
    current !== document.body &&
    current !== document.documentElement
  ) {
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(
          (candidate) => candidate.tagName === current?.tagName,
        )
      : [];
    const index = siblings.indexOf(current);
    parts.unshift(
      siblings.length > 1 && index >= 0
        ? `${tag}:nth-of-type(${index + 1})`
        : tag,
    );
    current = current.parentElement;
  }
  return parts.length > 0 ? `body > ${parts.join(" > ")}` : "";
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
    const element = document.elementFromPoint(
      (clientX - iframeRect.left) * scaleX,
      (clientY - iframeRect.top) * scaleY,
    );
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
      anchor.getAttribute("id") ??
      undefined;
    const layerName =
      resolveLayerNameAttribute((attribute) => anchor.getAttribute(attribute))
        ?.value ?? undefined;
    const targetSelector = nodeId
      ? undefined
      : structuralSelector(anchor, document) || undefined;
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

function reviewCommentAttachments(
  comment: ReviewComment,
): ReviewCommentAttachment[] {
  const raw = comment.metadata?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const attachment = value as Record<string, unknown>;
      const url = typeof attachment.url === "string" ? attachment.url : "";
      const contentType =
        typeof attachment.contentType === "string"
          ? attachment.contentType
          : undefined;
      if (
        !url ||
        (contentType && !contentType.startsWith("image/")) ||
        !isTrustedReviewAttachmentUrl(url)
      ) {
        return [];
      }
      return [
        {
          url,
          name:
            typeof attachment.name === "string" && attachment.name.trim()
              ? attachment.name
              : "image",
        },
      ];
    })
    .slice(0, MAX_REVIEW_IMAGE_ATTACHMENTS);
}

interface ReviewCommentAttachment {
  url: string;
  name: string;
}

function ReviewCommentAttachmentStrip({
  comment,
  compact = false,
}: {
  comment: ReviewComment;
  compact?: boolean;
}) {
  const attachments = reviewCommentAttachments(comment);
  if (!attachments.length) return null;
  return (
    <div
      className={cn(
        "mt-2 flex flex-wrap gap-1.5",
        compact ? "max-w-56" : "max-w-64",
      )}
      data-review-comment-attachments
    >
      {attachments.map((attachment) => (
        <a
          key={attachment.url}
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          className="block size-16 overflow-hidden rounded-md border border-border bg-muted"
        >
          <img
            src={attachment.url}
            alt={attachment.name}
            loading="lazy"
            className="size-full object-cover"
          />
        </a>
      ))}
    </div>
  );
}

function displayReviewCommentBody(body: string): string {
  return body.replace(/@\[([^\]]+)\]\(mailto:[^)]+\)/g, "@$1");
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
  const mentionOptions = useMemo<ReviewMention[]>(
    () =>
      (organizationMembers?.members ?? []).map((member) => ({
        label:
          member.name?.trim() || member.email.split("@")[0] || member.email,
        email: member.email,
      })),
    [organizationMembers?.members],
  );
  const createComment = useCreateReviewComment();
  const deleteComment = useDeleteReviewComment();
  const reactToComment = useReactToReviewComment();
  const replyComment = useReplyReviewComment();
  const resolveThread = useResolveReviewThread();
  const setUnread = useSetReviewThreadUnread();
  const updateComment = useUpdateReviewComment();
  const [canvas, setCanvas] = useState<HTMLElement | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const [draftPin, setDraftPin] = useState<ReviewDraftPin | null>(null);
  const [draftAttachments, setDraftAttachments] = useState<
    ReviewImageAttachment[]
  >([]);
  const [draftComposerOpen, setDraftComposerOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
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
  const lastFocusNonceRef = useRef<number | null>(null);
  const pendingFocusNonceRef = useRef<number | null>(null);
  const migratedBoardAnchorIdsRef = useRef<Set<string>>(new Set());
  const migrationInFlightRef = useRef(false);
  const lastRepromptDraftNonceRef = useRef<number | null>(null);
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
    return () => {
      window.removeEventListener(
        NODE_REPROMPT_PRESENTED_EVENT,
        onRepromptSettled,
      );
      window.removeEventListener(
        NODE_REPROMPT_RESOLVED_EVENT,
        onRepromptSettled,
      );
    };
  }, [cancelDraft, onClose, pendingRepromptId]);

  const threads = useMemo(
    () => buildReviewThreads(comments.data?.comments ?? []),
    [comments.data?.comments],
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
        const element = parsed.nodeId
          ? findNodeElement(canvas, parsed.nodeId)
          : parsed.selector
            ? (() => {
                const iframe = canvas.querySelector<HTMLIFrameElement>(
                  "iframe[data-design-preview-iframe]",
                );
                try {
                  return (
                    iframe?.contentDocument?.querySelector(parsed.selector) ??
                    null
                  );
                  // coercion-ok: cross-origin preview frames make selector lookup unavailable.
                } catch {
                  return null;
                }
              })()
            : null;
        const point = relativeElementCanvasPoint(
          canvas,
          element,
          parsed.relativePoint,
          parsed.nodeId ? frameNodeGeometry[parsed.nodeId] : undefined,
        );
        if (point) {
          return {
            point,
            source: parsed.nodeId ? ("node" as const) : ("selector" as const),
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
  const closeActiveThread = useCallback(() => {
    setActiveThreadId(null);
    setReplyDraft("");
    setReplyAttachments([]);
    setReplyMentions([]);
    setEditCandidate(null);
    setEditDraft("");
    setEditMentions([]);
  }, []);
  const copyThreadLink = useCallback(
    async (thread: ReviewThread) => {
      if (!navigator.clipboard) {
        toast.error(t("review.postFailed"));
        return;
      }
      const link = new URL(window.location.href);
      link.hash = `comment=${encodeURIComponent(thread.root.threadId)}`;
      try {
        await navigator.clipboard.writeText(link.toString());
        toast.success(t("review.linkCopied"));
      } catch {
        toast.error(t("review.postFailed"));
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
    const bump = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        setLayoutTick((current) => current + 1);
      });
    };
    const resizeObserver = new ResizeObserver(bump);
    resizeObserver.observe(canvas);
    const iframe = canvas.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
    if (iframe) resizeObserver.observe(iframe);
    const frameShell = canvas.closest<HTMLElement>("[data-frame-shell]");
    if (frameShell) resizeObserver.observe(frameShell);
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
    return [...nodeIds].sort();
  }, [draftPin, threads]);

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
            // Keep the local anchor for stable rendering, but allow a later
            // review refresh to retry persistence after a transient failure.
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
            // Keep the local anchor until a later refresh can reconcile it.
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
    (anchor: unknown, nonce: number): boolean => {
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
        const element = resolved.anchor.nodeId
          ? findNodeElement(canvas, resolved.anchor.nodeId)
          : (() => {
              const iframe = canvas.querySelector<HTMLIFrameElement>(
                "iframe[data-design-preview-iframe]",
              );
              try {
                return (
                  iframe?.contentDocument?.querySelector(
                    resolved.anchor.selector!,
                  ) ?? null
                );
              } catch {
                return null;
              }
            })();
        if (element instanceof HTMLElement || element instanceof SVGElement) {
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
    if (focusAnchor(focusRequest.anchor, focusRequest.nonce)) {
      lastFocusNonceRef.current = focusRequest.nonce;
      if (focusRequest.threadId) {
        setActiveThreadId(focusRequest.threadId);
      }
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
    setDraftPin({
      id: crypto.randomUUID(),
      anchor: {
        ...(nodeId ? { nodeId } : {}),
        point,
      },
      draft: "",
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

  useEffect(() => {
    if (!active && !activeThreadId && !draftComposerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (draftComposerOpen && draftPin) {
        cancelDraft();
        return;
      }
      if (activeThreadId) {
        setActiveThreadId(null);
        setReplyDraft("");
        setReplyAttachments([]);
        setReplyMentions([]);
        return;
      }
      if (active) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    active,
    activeThreadId,
    cancelDraft,
    draftComposerOpen,
    draftPin,
    onClose,
  ]);

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
    if (active) onClose();
  }, [active, cancelDraft, hidden, onClose]);

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
        if (!nodeId && !targetSelector && !layerName && !tagName) return;
        setDraftPin((current) => {
          if (
            !current ||
            current.anchor.point.xPct !== next.anchor.point.xPct ||
            current.anchor.point.yPct !== next.anchor.point.yPct
          ) {
            return current;
          }
          return {
            ...current,
            anchor: {
              ...current.anchor,
              ...(nodeId ? { nodeId } : {}),
              ...(targetSelector ? { selector: targetSelector } : {}),
              point: current.anchor.point,
            },
            metadata: {
              ...current.metadata,
              ...(layerName ? { layerName } : {}),
              ...(tagName ? { tagName } : {}),
              ...(targetSelector ? { targetSelector } : {}),
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
      const isRegion =
        Math.abs(event.clientX - start.startX) > 6 ||
        Math.abs(event.clientY - start.startY) > 6;
      const region = isRegion
        ? regionBetween(
            canvas.getBoundingClientRect(),
            { x: start.startX, y: start.startY },
            { x: event.clientX, y: event.clientY },
          )
        : null;
      if (region) {
        dropPin(
          start.startX + (event.clientX - start.startX) / 2,
          start.startY + (event.clientY - start.startY) / 2,
          region,
        );
      } else {
        dropPin(event.clientX, event.clientY);
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
          : undefined;
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
      if (!element && targetSelector) {
        const iframe = canvas?.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        );
        try {
          element =
            iframe?.contentDocument?.querySelector(targetSelector) ?? null;
        } catch {
          element = null;
        }
      }
      setAgentSubmitting(true);
      try {
        await callAction("begin-node-rewrite-request", pending);
        const submission = formatNodeRepromptSubmission({
          ...pending,
          subtreeHtml:
            element instanceof HTMLElement || element instanceof SVGElement
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
        setDraftMode("reprompt");
        setPendingRepromptId(repromptId);
        setDraftComposerOpen(false);
        toast.success(t("designEditor.nodeRewrite.sent"));
      } catch (error) {
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

  const submitSelectionQuestion = useCallback(
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
          : undefined;
      if (
        !instruction.trim() ||
        (!nodeId && !targetSelector) ||
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
      let element = nodeId ? findNodeElement(canvas!, nodeId) : null;
      if (!element && targetSelector) {
        const iframe = canvas?.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        );
        try {
          element =
            iframe?.contentDocument?.querySelector(targetSelector) ?? null;
        } catch {
          element = null;
        }
      }
      setAgentSubmitting(true);
      try {
        const submission = formatNodeSelectionQuestion({
          designId: resourceId,
          fileId: targetId,
          target,
          instruction,
          subtreeHtml:
            element instanceof HTMLElement || element instanceof SVGElement
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
          throw new Error(delivery.reason ?? "Question was not delivered.");
        }
        cancelDraft();
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : t("designEditor.nodeRewrite.sendFailed"),
        );
      } finally {
        setAgentSubmitting(false);
      }
    },
    [agentSubmitting, cancelDraft, canvas, resourceId, sourceType, t, targetId],
  );

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
        const element = parsed.nodeId
          ? findNodeElement(canvas, parsed.nodeId)
          : null;
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

  if (hidden || !canvas) return null;
  // Every live editor mounts one of these; reading the canvas rect during
  // render forces a synchronous layout of the whole board on each commit.
  if (
    !active &&
    !draftPin &&
    !deleteCandidate &&
    !threads.some((thread) => thread.root.anchor)
  ) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  void layoutTick;

  const visibleThreads = threads.filter((thread) => thread.root.anchor);
  const positionedThreads = visibleThreads
    .flatMap((thread) => {
      const position = pinPositionFor(thread.root.threadId, thread.root.anchor);
      return position ? [{ thread, position }] : [];
    })
    .map((entry, index) => ({ ...entry, index }));
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
  const pinPlacementEnabled = active && canPost && !pendingRepromptId;
  const placementPlaneVisible = pinPlacementEnabled && showPlacementPlane;
  const placementHintVisible =
    placementPlaneVisible &&
    !draftComposerOpen &&
    !activeThreadId &&
    !repromptDraftRequest;

  return createPortal(
    <>
      {placementPlaneVisible ? (
        <div
          data-review-click-plane
          data-review-click-plane-target={
            screenAnchorId ?? (boardGeometry ? "board" : undefined)
          }
          className="fixed z-40 cursor-crosshair"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
          onPointerDown={handlePlacementPointerDown}
          onPointerMove={(event) =>
            updateRegionPreview(event.clientX, event.clientY)
          }
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
        <div className="pointer-events-none fixed left-1/2 top-16 z-[45] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-popover px-3 py-1.5 text-xs shadow-lg">
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
              count={group.entries.length}
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
        return group.entries.map(({ thread, index, position }) => {
          const clientPoint = position.canvasPoint
            ? canvasPointToClientPoint(canvas, position.canvasPoint)
            : null;
          const popoverPoint = clientPoint ?? {
            x: rect.left + (position.point.xPct / 100) * rect.width,
            y: rect.top + (position.point.yPct / 100) * rect.height,
          };
          return (
            <ReviewPin
              key={thread.root.threadId}
              index={index}
              canvasRect={rect}
              point={position.point}
              clientPoint={clientPoint}
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
                    reactToComment.isPending && reactToComment.variables
                      ? reactToComment.variables
                      : null
                  }
                  sending={sendingThreadId === thread.root.threadId}
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
                  placement={getReviewPopoverPlacement(
                    position.point,
                    popoverPoint,
                    viewport,
                  )}
                  replyDraft={replyDraft}
                  replyMentions={replyMentions}
                  mentionOptions={mentionOptions}
                  replyAttachments={replyAttachments}
                  onReplyAttachmentsChange={setReplyAttachments}
                  onReplyDraftChange={setReplyDraft}
                  onReplyMentionsChange={setReplyMentions}
                  onClose={closeActiveThread}
                  onReply={() => {
                    const body = replyDraft.trim();
                    if (!body) return;
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
                        onSuccess: () => {
                          setReplyDraft("");
                          setReplyAttachments([]);
                          setReplyMentions([]);
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
                          setActiveThreadId(null);
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
                  onSendToAgent={
                    onSendThreadToAgent &&
                    (thread.root.resolutionTarget === "human" ||
                      Boolean(thread.root.consumedAt))
                      ? () => onSendThreadToAgent(thread)
                      : undefined
                  }
                  replying={replyComment.isPending}
                  resolving={resolveThread.isPending}
                />
              ) : null}
            </ReviewPin>
          );
        });
      })}
      {draftPin && draftPinPosition ? (
        <ReviewPin
          key={draftPin.id}
          index={visibleThreads.length}
          canvasRect={rect}
          point={draftPinPosition.point}
          clientPoint={
            draftPinPosition.canvasPoint
              ? canvasPointToClientPoint(canvas, draftPinPosition.canvasPoint)
              : null
          }
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
              mentionOptions={mentionOptions}
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
              onCancel={cancelDraft}
              onSubmit={(resolutionTarget) => {
                setDraftPin((current) =>
                  current ? { ...current, resolutionTarget } : current,
                );
                postDraft(
                  { ...draftPin, resolutionTarget },
                  draftAttachments,
                  draftMentions,
                );
              }}
              onSmartSubmit={(mode) => {
                if (mode === "preview")
                  void submitReprompt(draftPin, draftAttachments);
                else void submitSelectionQuestion(draftPin, draftAttachments);
              }}
              resolutionTarget={draftPin.resolutionTarget}
              showAgentAction={
                Boolean(onDispatchCommentToAgent) || draftMode === "reprompt"
              }
              smartAgentAvailable={
                sourceType === "inline" &&
                Boolean(
                  resolveReviewAnchor(draftPin.anchor, () => null)?.anchor
                    .nodeId || draftPin.metadata.targetSelector,
                )
              }
              initialAgentMode={draftMode === "reprompt" ? "preview" : "auto"}
              placement={getReviewPopoverPlacement(
                draftPinPosition.point,
                draftPinPosition.canvasPoint
                  ? canvasPointToClientPoint(
                      canvas,
                      draftPinPosition.canvasPoint,
                    )
                  : {
                      x:
                        rect.left +
                        (draftPinPosition.point.xPct / 100) * rect.width,
                      y:
                        rect.top +
                        (draftPinPosition.point.yPct / 100) * rect.height,
                    },
                viewport,
              )}
              commentSubmitting={createComment.isPending}
              agentSubmitting={agentSubmitting}
            />
          ) : null}
        </ReviewPin>
      ) : null}
      <AlertDialog
        open={Boolean(deleteCandidate)}
        onOpenChange={(open) => {
          if (!open && !deleteComment.isPending) setDeleteCandidate(null);
        }}
      >
        <AlertDialogContent>
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
                deleteComment.mutate(
                  { resourceType, resourceId, commentId: candidate.id },
                  {
                    onSuccess: () => {
                      setDeleteCandidate(null);
                      closeActiveThread();
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
    </>,
    document.body,
  );
}

function ReviewPin({
  index,
  point,
  canvasRect,
  clientPoint,
  active,
  draft = false,
  pending = false,
  resolved = false,
  unread = false,
  region,
  canMove = false,
  onMove,
  onClick,
  children,
}: {
  index: number;
  point: ReviewAnchorPoint;
  canvasRect: DOMRect;
  clientPoint?: ReviewCanvasPoint | null;
  active: boolean;
  draft?: boolean;
  pending?: boolean;
  resolved?: boolean;
  unread?: boolean;
  region?: ReviewAnchorRegion;
  canMove?: boolean;
  onMove?: (point: ReviewAnchorPoint) => void;
  onClick: () => void;
  children?: ReactNode;
}) {
  const t = useT();
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
      className="fixed z-[45]"
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
      <button
        type="button"
        data-review-pin
        data-review-unread={unread ? "true" : undefined}
        className={cn(
          "flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full rounded-bl-none border text-[10px] font-semibold shadow-md transition-transform hover:scale-110",
          draft
            ? "border-primary bg-primary text-primary-foreground"
            : resolved
              ? "border-muted-foreground/50 bg-muted text-muted-foreground"
              : "border-amber-200 bg-amber-400 text-amber-950",
          active && "ring-2 ring-primary/40",
          unread && "ring-2 ring-foreground/70",
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
        aria-label={t("review.commentNumber", { count: index + 1 })}
        aria-keyshortcuts={
          canMove ? "ArrowUp ArrowDown ArrowLeft ArrowRight" : undefined
        }
      >
        {pending ? <Spinner className="size-3" /> : index + 1}
      </button>
      {children}
    </div>
  );
}

function ReviewPinCluster({
  count,
  point,
  canvasRect,
  onClick,
}: {
  count: number;
  point: ReviewAnchorPoint;
  canvasRect: DOMRect;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      data-review-pin-cluster
      className="fixed z-[45] flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-primary bg-primary text-xs font-semibold text-primary-foreground shadow-lg hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        left: canvasRect.left + (point.xPct / 100) * canvasRect.width,
        top: canvasRect.top + (point.yPct / 100) * canvasRect.height,
      }}
      aria-label={t("review.commentsInCluster", { count })}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {count}
    </button>
  );
}

function ReviewImageAttachments({
  attachments,
  disabled = false,
  onChange,
  onUploadingChange,
  className,
}: {
  attachments: ReviewImageAttachment[];
  disabled?: boolean;
  onChange: (attachments: ReviewImageAttachment[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
  className?: string;
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
    onUploadingChange?.(true);
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
    onUploadingChange?.(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div
      data-review-attachments
      className={cn("flex flex-wrap items-center gap-1.5 px-3 pb-2", className)}
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
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-review-attachment-button
        className="text-muted-foreground"
        disabled={
          disabled ||
          uploading ||
          attachments.length >= MAX_REVIEW_IMAGE_ATTACHMENTS
        }
        onClick={() => inputRef.current?.click()}
        aria-label={t("review.attachImage")}
      >
        {uploading ? (
          <Spinner className="size-3.5" />
        ) : (
          <IconPaperclip className="size-3.5" />
        )}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        data-review-attachment-input
        className="sr-only"
        onChange={(event) => void handleFiles(event.currentTarget.files)}
      />
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
  onSmartSubmit,
  resolutionTarget,
  showAgentAction,
  smartAgentAvailable,
  initialAgentMode,
  placement,
  commentSubmitting,
  agentSubmitting,
}: {
  value: string;
  mentions: readonly ReviewMention[];
  mentionOptions: readonly ReviewMention[];
  onMentionsChange: (mentions: ReviewMention[]) => void;
  attachments: ReviewImageAttachment[];
  onAttachmentsChange: (attachments: ReviewImageAttachment[]) => void;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (target: "agent" | "human") => void;
  onSmartSubmit: (mode: NodeRepromptSendMode) => void;
  resolutionTarget: "agent" | "human";
  showAgentAction: boolean;
  smartAgentAvailable: boolean;
  initialAgentMode: "auto" | NodeRepromptSendMode;
  placement: ReviewPopoverPlacement;
  commentSubmitting: boolean;
  agentSubmitting: boolean;
}) {
  const t = useT();
  const [engaged, setEngaged] = useState(false);
  const [attachmentsUploading, setAttachmentsUploading] = useState(false);
  const [modeOverride, setModeOverride] = useState<
    "auto" | NodeRepromptSendMode
  >(initialAgentMode);
  const inferredMode = inferNodeRepromptSendMode(value, {
    hasEditableTarget: smartAgentAvailable,
  });
  const sendMode = modeOverride === "auto" ? inferredMode : modeOverride;
  const submitting = commentSubmitting || agentSubmitting;
  const busy = submitting || attachmentsUploading;
  const revealTools =
    engaged || Boolean(value.trim()) || attachments.length > 0;
  const agentLabel =
    modeOverride === "auto"
      ? t("review.sendToAgent")
      : sendMode === "preview"
        ? t("designEditor.nodeRewrite.modeRegenerate")
        : t("designEditor.nodeRewrite.modeAsk");
  const agentAction = smartAgentAvailable ? (
    <div className="flex w-full min-w-0 @2xs/review:flex-1">
      <Button
        type="button"
        size="sm"
        variant={initialAgentMode === "preview" ? "default" : "outline"}
        className="min-w-0 flex-1 gap-1.5 rounded-e-none"
        disabled={busy || !value.trim()}
        onClick={() => onSmartSubmit(sendMode)}
      >
        {agentSubmitting ? (
          <Spinner className="size-3.5" />
        ) : (
          <IconSend className="size-3.5" />
        )}
        <span className="truncate">{agentLabel}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant={initialAgentMode === "preview" ? "default" : "outline"}
            className="shrink-0 rounded-s-none border-s-0 px-2"
            disabled={busy}
            aria-label={t("designEditor.nodeRewrite.agentModeOptions")}
          >
            <IconChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-review-popover
          data-review-mode-menu
          align="end"
          className="w-56"
        >
          <DropdownMenuRadioGroup
            value={modeOverride}
            onValueChange={(nextMode) =>
              setModeOverride(nextMode as "auto" | NodeRepromptSendMode)
            }
          >
            <DropdownMenuRadioItem value="auto">
              {t("designEditor.nodeRewrite.modeAuto")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="ask">
              {t("designEditor.nodeRewrite.modeAsk")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="preview">
              {t("designEditor.nodeRewrite.modeRegenerate")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : undefined;
  return (
    <div
      data-review-popover
      className={cn(
        "absolute z-[260] w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-xl",
        placement.horizontal === "end" ? "right-3" : "left-3",
        placement.vertical === "above" ? "bottom-3" : "top-1",
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="text-sm font-medium">
          {initialAgentMode === "preview"
            ? t("designEditor.nodeRewrite.composerTitle")
            : t("review.newComment")}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            disabled={submitting}
            onClick={onCancel}
            aria-label={t("designEditor.close")}
          >
            <IconX className="size-3.5" />
          </Button>
        </div>
      </div>
      <ReviewCommentComposer
        className="px-3 pb-3"
        autoFocus
        value={value}
        mentions={mentions}
        onMentionsChange={onMentionsChange}
        mentionOptions={mentionOptions}
        showCommentTools={revealTools}
        emojiLabel={t("review.addEmoji")}
        mentionLabel={t("review.mention")}
        noMentionsLabel={t("review.noMentions")}
        commentToolsEnd={
          revealTools ? (
            <ReviewImageAttachments
              attachments={attachments}
              disabled={busy}
              onUploadingChange={setAttachmentsUploading}
              onChange={(next) => {
                setEngaged(true);
                onAttachmentsChange(next);
              }}
              className="flex-nowrap p-0"
            />
          ) : undefined
        }
        disabled={busy}
        onChange={(next) => {
          setEngaged(true);
          onChange(next);
        }}
        onSubmit={(target) => {
          if (target === "agent" && smartAgentAvailable) {
            onSmartSubmit(sendMode);
            return;
          }
          onSubmit(target);
        }}
        submittingTarget={commentSubmitting ? resolutionTarget : null}
        showCommentAction={initialAgentMode !== "preview"}
        showAgentAction={showAgentAction}
        agentAction={agentAction}
        placeholder={t("review.placeholder")}
        commentLabel={t("review.commentMode")}
        agentLabel={t("review.sendToAgent")}
        contextLabel={
          smartAgentAvailable && (modeOverride !== "auto" || value.trim())
            ? sendMode === "preview"
              ? t("designEditor.nodeRewrite.willPreview")
              : t("designEditor.nodeRewrite.willAsk")
            : undefined
        }
        submitOnEnter
        enterSubmitTarget={initialAgentMode === "preview" ? "agent" : "human"}
        onEscape={onCancel}
      />
    </div>
  );
}

function ReviewReactionControls({
  commentId,
  reactions,
  canReact,
  onReact,
  pendingReaction,
}: {
  commentId: string;
  reactions: ReviewCommentReaction[];
  canReact: boolean;
  onReact: (commentId: string, reaction: string, active: boolean) => void;
  pendingReaction: PendingReviewReaction | null;
}) {
  const t = useT();
  const pendingForComment =
    pendingReaction?.commentId === commentId ? pendingReaction : null;
  const displayedReactions = [
    ...reactions,
    ...(pendingForComment?.active &&
    !reactions.some((entry) => entry.reaction === pendingForComment.reaction)
      ? [
          {
            reaction: pendingForComment.reaction,
            count: 0,
            reactedByMe: false,
          },
        ]
      : []),
  ];
  if (!displayedReactions.length && !canReact) return null;

  return (
    <div
      data-review-reactions
      className="mt-1 flex flex-wrap items-center gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      {displayedReactions.map((entry) => {
        const active =
          pendingForComment?.reaction === entry.reaction
            ? pendingForComment.active
            : entry.reactedByMe;
        const count =
          entry.count +
          (pendingForComment?.reaction === entry.reaction
            ? Number(pendingForComment.active) - Number(entry.reactedByMe)
            : 0);
        return (
          <button
            key={entry.reaction}
            type="button"
            data-review-reaction={entry.reaction}
            aria-pressed={active}
            disabled={!canReact || Boolean(pendingReaction)}
            className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent aria-pressed:bg-accent aria-pressed:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            onClick={() => onReact(commentId, entry.reaction, !active)}
          >
            {entry.reaction} {Math.max(0, count)}
          </button>
        );
      })}
      {canReact ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-review-reaction-picker
              className="size-7 text-muted-foreground"
              disabled={Boolean(pendingReaction)}
              aria-label={t("review.addReaction")}
            >
              <IconMoodSmile className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-review-reaction-menu
            align="end"
            onClick={(event) => event.stopPropagation()}
          >
            {QUICK_REACTIONS.map((reaction) => {
              const current = displayedReactions.find(
                (entry) => entry.reaction === reaction,
              );
              const active =
                pendingForComment?.reaction === reaction
                  ? pendingForComment.active
                  : (current?.reactedByMe ?? false);
              return (
                <DropdownMenuCheckboxItem
                  key={reaction}
                  checked={active}
                  disabled={Boolean(pendingReaction)}
                  onCheckedChange={(checked) =>
                    onReact(commentId, reaction, checked)
                  }
                >
                  {reaction}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function ReviewThreadPopover({
  thread,
  canResolve,
  discussion,
  onReact,
  pendingReaction,
  sending,
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
  placement,
  replyDraft,
  replyMentions,
  mentionOptions,
  replyAttachments,
  onReplyAttachmentsChange,
  onReplyDraftChange,
  onReplyMentionsChange,
  onClose,
  onReply,
  onStatusChange,
  onSendToAgent,
}: {
  thread: ReviewThread;
  canResolve: boolean;
  discussion?: ReviewDiscussionState;
  onReact: (commentId: string, reaction: string, active: boolean) => void;
  pendingReaction: PendingReviewReaction | null;
  sending: boolean;
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
  placement: ReviewPopoverPlacement;
  replyDraft: string;
  replyMentions: readonly ReviewMention[];
  mentionOptions: readonly ReviewMention[];
  replyAttachments: ReviewImageAttachment[];
  onReplyAttachmentsChange: (attachments: ReviewImageAttachment[]) => void;
  onReplyDraftChange: (value: string) => void;
  onReplyMentionsChange: (mentions: ReviewMention[]) => void;
  onClose: () => void;
  onReply: () => void;
  onStatusChange: () => void;
  onSendToAgent?: () => void;
}) {
  const t = useT();
  const rootAuthor = reviewAuthorLabel(thread.root, t("review.reviewer"));
  const avatarUrl = useAvatarUrl(thread.root.authorEmail);
  const [replyUploading, setReplyUploading] = useState(false);
  return (
    <div
      data-review-popover
      className={cn(
        "absolute z-[260] w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-xl",
        placement.horizontal === "end" ? "right-3" : "left-3",
        placement.vertical === "above" ? "bottom-3" : "top-1",
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start gap-2.5 p-3">
        <Avatar className="size-7 shrink-0">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={rootAuthor} /> : null}
          <AvatarFallback className="text-[10px] font-semibold text-muted-foreground">
            {reviewAuthorInitials(rootAuthor)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="truncate text-xs font-medium text-muted-foreground">
              {rootAuthor}
            </div>
            {unread ? (
              <span
                data-review-unread
                className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
              >
                {t("review.markUnread")}
              </span>
            ) : null}
          </div>
          {editing ? (
            <ReviewCommentComposer
              className="mt-2 p-0"
              value={editDraft}
              mentions={editMentions}
              onMentionsChange={onEditMentionsChange}
              mentionOptions={mentionOptions}
              showCommentTools
              emojiLabel={t("review.addEmoji")}
              mentionLabel={t("review.mention")}
              noMentionsLabel={t("review.noMentions")}
              textareaProps={{ "aria-label": t("review.editComment") }}
              disabled={updating}
              onChange={onEditDraftChange}
              onSubmit={() => onEditSubmit()}
              commentLabel={t("review.save")}
              placeholder={t("review.editComment")}
              submitOnEnter
              onEscape={onEditCancel}
            />
          ) : (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-foreground">
              {displayReviewCommentBody(thread.root.body)}
            </p>
          )}
          <ReviewCommentAttachmentStrip comment={thread.root} />
          {thread.root.status === "resolved" &&
          reviewResolutionNote(thread.root) ? (
            <div
              data-review-resolution-note
              className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground"
            >
              {reviewResolutionNote(thread.root)}
            </div>
          ) : null}
          <ReviewReactionControls
            commentId={thread.root.id}
            reactions={discussion?.reactions[thread.root.id] ?? []}
            canReact={discussion?.canReact ?? false}
            onReact={onReact}
            pendingReaction={pendingReaction}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-mt-1 size-7 shrink-0 text-muted-foreground"
              aria-label={t("review.moreActions")}
            >
              <IconDots className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent data-review-popover align="end" className="w-44">
            {canEdit ? (
              <DropdownMenuItem onSelect={onEdit}>
                {t("review.editComment")}
              </DropdownMenuItem>
            ) : null}
            {discussion?.canSetThreadPreferences ? (
              <DropdownMenuItem onSelect={() => onSetUnread(!unread)}>
                <IconMail className="size-4" />
                {t(unread ? "review.markRead" : "review.markUnread")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={onCopyLink}>
              <IconLink className="size-4" />
              {t("review.copyLink")}
            </DropdownMenuItem>
            {canDelete ? (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={onDelete}
              >
                <IconTrash className="size-4" />
                {t("review.deleteComment")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          className="-me-1 -mt-1 size-7 shrink-0 text-muted-foreground"
          onClick={onClose}
          aria-label={t("designEditor.close")}
        >
          <IconX className="size-3.5" />
        </Button>
      </div>
      {thread.replies.length ? (
        <div className="ms-12 me-3 mb-3 flex flex-col gap-2 border-s border-border ps-3">
          {thread.replies.map((reply) => (
            <div key={reply.id} className="min-w-0">
              <div className="truncate text-[10px] font-medium text-muted-foreground">
                {reviewAuthorLabel(reply, t("review.reviewer"))}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-5 text-foreground/90">
                {displayReviewCommentBody(reply.body)}
              </p>
              <ReviewCommentAttachmentStrip comment={reply} compact />
              <ReviewReactionControls
                commentId={reply.id}
                reactions={discussion?.reactions[reply.id] ?? []}
                canReact={discussion?.canReact ?? false}
                onReact={onReact}
                pendingReaction={pendingReaction}
              />
            </div>
          ))}
        </div>
      ) : null}
      {canReply ||
      (canResolve &&
        (thread.root.status === "open" ||
          thread.root.status === "resolved")) ? (
        <div className="border-t border-border bg-muted/25 p-2.5">
          {canReply ? (
            <>
              <ReviewCommentComposer
                className="p-0"
                value={replyDraft}
                mentions={replyMentions}
                onMentionsChange={onReplyMentionsChange}
                mentionOptions={mentionOptions}
                showCommentTools
                commentToolsEnd={
                  <ReviewImageAttachments
                    attachments={replyAttachments}
                    disabled={replying || resolving || replyUploading}
                    onChange={onReplyAttachmentsChange}
                    onUploadingChange={setReplyUploading}
                    className="flex-nowrap p-0"
                  />
                }
                emojiLabel={t("review.addEmoji")}
                mentionLabel={t("review.mention")}
                noMentionsLabel={t("review.noMentions")}
                textareaProps={{ "data-review-reply-input": true }}
                disabled={replying || resolving || replyUploading}
                onChange={onReplyDraftChange}
                onSubmit={() => onReply()}
                commentLabel={t("review.reply")}
                placeholder={t("review.replyPlaceholder")}
                submitOnEnter
                onEscape={onClose}
              />
            </>
          ) : null}
          {canResolve &&
          (thread.root.status === "open" ||
            thread.root.status === "resolved") ? (
            <div className="mt-2 flex items-center gap-1">
              {thread.root.status === "open" && onSendToAgent ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs text-primary hover:text-primary"
                  disabled={sending || resolving || replyUploading}
                  onClick={onSendToAgent}
                >
                  {sending ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <IconSend className="size-3.5" />
                  )}
                  {sending
                    ? t("review.sendingToAgent")
                    : t("review.sendToAgent")}
                </Button>
              ) : null}
              <div className="min-w-0 flex-1" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                disabled={resolving || sending || replyUploading}
                onClick={onStatusChange}
                aria-label={
                  thread.root.status === "open"
                    ? t("review.resolve")
                    : t("review.reopen")
                }
              >
                {resolving ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <IconCircleCheck className="size-3.5" />
                )}
                {resolving
                  ? t("review.resolving")
                  : thread.root.status === "open"
                    ? t("review.resolve")
                    : t("review.reopen")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function reviewAuthorLabel(comment: ReviewComment, fallback: string): string {
  return comment.authorName ?? comment.authorEmail ?? fallback;
}

function reviewAuthorInitials(value: string): string {
  const localPart = value.split("@")[0]?.trim() ?? "";
  const initials = localPart
    .split(/[\s._+-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "R";
}

function reviewResolutionNote(comment: ReviewComment): string | null {
  const direct = comment.resolutionNote;
  const metadata = comment.metadata;
  const metadataNote =
    typeof direct === "string"
      ? direct
      : typeof metadata?.resolutionNote === "string"
        ? metadata.resolutionNote
        : typeof metadata?.resolvedNote === "string"
          ? metadata.resolvedNote
          : typeof metadata?.note === "string"
            ? metadata.note
            : null;
  const note = metadataNote?.trim();
  return note || null;
}
