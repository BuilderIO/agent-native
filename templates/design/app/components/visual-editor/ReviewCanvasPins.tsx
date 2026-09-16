import { callAction } from "@agent-native/core/client/hooks";
import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  buildReviewThreads,
  ReviewCommentComposer,
  useReactToReviewComment,
  useCreateReviewComment,
  useReplyReviewComment,
  useResolveReviewThread,
  useUpdateReviewCommentAnchor,
  useReviewComments,
  isTrustedReviewAttachmentUrl,
  type ReviewThread,
} from "@agent-native/core/client/review";
import { uploadEditorImage } from "@agent-native/core/client/uploads";
import type { ReviewComment } from "@agent-native/core/review";
import type {
  ReviewCommentReaction,
  ReviewDiscussionState,
} from "@agent-native/core/review";
import { useMentionSearch } from "@agent-native/toolkit/composer/use-mention-search";
import type { NodeRewriteTarget } from "@shared/node-rewrite";
import {
  IconChevronDown,
  IconCircleCheck,
  IconMessageCircle,
  IconMoodSmile,
  IconPaperclip,
  IconRobot,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
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

import {
  resolveReviewAnchor,
  type DesignReviewAnchor,
  type ReviewAnchorPoint,
} from "../../../shared/review-anchor";
import {
  getReviewPinPosition,
  getReviewPopoverPlacement,
  placeReviewDraftPin,
  type ReviewDraftPin,
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
  targetId?: string;
  threadId?: string;
}

interface ReviewCanvasPinsProps {
  active: boolean;
  hidden?: boolean;
  onClose: () => void;
  canvasSelector?: string;
  resourceType: string;
  resourceId: string;
  targetId: string;
  canPost: boolean;
  canResolve: boolean;
  currentUserEmail?: string | null;
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
}

const MAX_REVIEW_IMAGE_ATTACHMENTS = 4;

type ReviewPopoverPlacement = ReturnType<typeof getReviewPopoverPlacement>;

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
    const identifiedAncestor = element?.closest(
      "[data-agent-native-node-id],[data-code-layer-id],[data-layer-id],[data-builder-id],[id]",
    );
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
      anchor.getAttribute("data-agent-native-layer-name") ||
      anchor.getAttribute("data-layer-name") ||
      undefined;
    const targetSelector = nodeId
      ? undefined
      : structuralSelector(anchor, document) || undefined;
    return {
      ...(nodeId ? { nodeId } : {}),
      ...(targetSelector ? { targetSelector } : {}),
      ...(layerName ? { layerName } : {}),
      tagName: anchor.tagName.toLowerCase(),
    };
  } catch {
    return {};
  }
}

function anchorAtPoint(
  canvas: HTMLElement,
  clientX: number,
  clientY: number,
): { anchor: DesignReviewAnchor; metadata: Record<string, unknown> } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const xPct = ((clientX - rect.left) / rect.width) * 100;
  const yPct = ((clientY - rect.top) / rect.height) * 100;
  if (xPct < 0 || xPct > 100 || yPct < 0 || yPct > 100) return null; // i18n-ignore canvas coordinate guard
  const element = elementAnchorAtPoint(canvas, clientX, clientY);
  return {
    anchor: {
      ...(element.nodeId ? { nodeId: element.nodeId } : {}),
      ...(element.targetSelector ? { selector: element.targetSelector } : {}),
      point: { xPct, yPct },
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

export function ReviewCanvasPins({
  active,
  hidden = false,
  onClose,
  canvasSelector,
  resourceType,
  resourceId,
  targetId,
  canPost,
  canResolve,
  currentUserEmail,
  focusRequest,
  onDispatchCommentToAgent,
  onSendThreadToAgent,
  sendingThreadId,
  sourceType = "inline",
  sourceVersionHash,
  repromptDraftRequest,
  onRepromptDraftConsumed,
}: ReviewCanvasPinsProps) {
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
      enabled: Boolean(!hidden && resourceType && resourceId && targetId),
    },
  );
  const createComment = useCreateReviewComment();
  const replyComment = useReplyReviewComment();
  const resolveThread = useResolveReviewThread();
  const reactToComment = useReactToReviewComment();
  const updateAnchor = useUpdateReviewCommentAnchor();
  const [canvas, setCanvas] = useState<HTMLElement | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const [draftPin, setDraftPin] = useState<ReviewDraftPin | null>(null);
  const [draftComposerOpen, setDraftComposerOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<
    ReviewImageAttachment[]
  >([]);
  const [draftAttachments, setDraftAttachments] = useState<
    ReviewImageAttachment[]
  >([]);
  const [pendingReaction, setPendingReaction] = useState<string | null>(null);
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
  const lastRepromptDraftNonceRef = useRef<number | null>(null);
  const frameCallbacksRef = useRef<
    Map<string, (payload: Record<string, unknown>) => void>
  >(new Map());

  const cancelDraft = useCallback(() => {
    setDraftPin(null);
    setDraftAttachments([]);
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

  const canMoveThreadPin = useCallback(
    (thread: ReviewThread) => {
      if (canResolve) return true;
      const email = currentUserEmail?.trim().toLowerCase();
      return Boolean(
        email && thread.root.authorEmail?.trim().toLowerCase() === email,
      );
    },
    [canResolve, currentUserEmail],
  );

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
    const observer = new MutationObserver(findCanvas);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
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
    window.addEventListener("resize", bump);
    window.addEventListener("scroll", bump, { capture: true, passive: true });
    iframe?.addEventListener("load", bump);
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
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

  const focusAnchor = useCallback(
    (anchor: unknown, nonce: number): boolean => {
      if (!canvas) return false;
      const resolved = resolveReviewAnchor(
        anchor,
        (nodeId) => nodePoint(canvas, nodeId, frameNodeGeometry[nodeId]),
        (selector) => selectorPoint(canvas, selector),
      );
      if (!resolved) return true;
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
    [canvas, frameNodeGeometry],
  );

  useEffect(() => {
    if (
      !focusRequest ||
      focusRequest.nonce === lastFocusNonceRef.current ||
      (focusRequest.targetId && focusRequest.targetId !== targetId)
    )
      return;
    const requestedThread = focusRequest.threadId
      ? threads.find(
          (thread) =>
            thread.root.threadId === focusRequest.threadId ||
            thread.root.id === focusRequest.threadId,
        )
      : null;
    if (requestedThread) setActiveThreadId(requestedThread.root.threadId);
    if (focusAnchor(focusRequest.anchor, focusRequest.nonce)) {
      lastFocusNonceRef.current = focusRequest.nonce;
    }
  }, [focusAnchor, focusRequest, layoutTick, targetId, threads]);

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
    setFrameNodeGeometry({});
    frameCallbacksRef.current.clear();
    pendingFocusNonceRef.current = null;
  }, [cancelDraft, resourceId, targetId]);

  useEffect(() => {
    if (!hidden) return;
    cancelDraft();
    setActiveThreadId(null);
    setReplyDraft("");
    setReplyAttachments([]);
    if (active) onClose();
  }, [active, cancelDraft, hidden, onClose]);

  const dropPin = useCallback(
    (clientX: number, clientY: number) => {
      if (!canvas || !canPost) return;
      const next = anchorAtPoint(canvas, clientX, clientY);
      if (!next) return;
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
    [canPost, canvas],
  );

  const postDraft = useCallback(
    (pin: ReviewDraftPin, attachments: ReviewImageAttachment[] = []) => {
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
          metadata: {
            ...pin.metadata,
            ...(attachments.length ? { attachments } : {}),
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
    async (pin: ReviewDraftPin) => {
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
        !sourceVersionHash ||
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
    async (pin: ReviewDraftPin) => {
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

  const moveThreadPin = useCallback(
    (thread: ReviewThread, point: ReviewAnchorPoint) =>
      new Promise<void>((resolve, reject) => {
        const anchor =
          thread.root.anchor &&
          typeof thread.root.anchor === "object" &&
          !Array.isArray(thread.root.anchor)
            ? (thread.root.anchor as Record<string, unknown>)
            : {};
        updateAnchor.mutate(
          {
            resourceType,
            resourceId,
            commentId: thread.root.id,
            anchor: { ...anchor, point },
          },
          {
            onSuccess: () => resolve(),
            onError: (error) => {
              toast.error(t("review.moveFailed"));
              reject(error);
            },
          },
        );
      }),
    [resourceId, resourceType, t, updateAnchor],
  );

  if (hidden || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  void layoutTick;

  const visibleThreads = threads.filter((thread) => thread.root.anchor);
  const draftPinPosition = draftPin
    ? getReviewPinPosition(draftPin.anchor)
    : null;
  const pinPlacementEnabled = active && canPost && !pendingRepromptId;
  const placementHintVisible =
    pinPlacementEnabled &&
    !draftComposerOpen &&
    !activeThreadId &&
    !repromptDraftRequest;

  return createPortal(
    <>
      {pinPlacementEnabled ? (
        <div
          data-review-click-plane
          className="fixed z-40 cursor-crosshair"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            dropPin(event.clientX, event.clientY);
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
      {visibleThreads.map((thread, index) => {
        const position = getReviewPinPosition(thread.root.anchor);
        if (!position) return null;
        return (
          <ReviewPin
            key={thread.root.threadId}
            index={index}
            canvasRect={rect}
            point={position.point}
            resolved={thread.root.status === "resolved"}
            onDragEnd={
              canMoveThreadPin(thread)
                ? (point) => moveThreadPin(thread, point)
                : undefined
            }
            onClick={() => {
              if (!draftPin?.draft.trim()) setDraftPin(null);
              setDraftComposerOpen(false);
              setReplyDraft("");
              setReplyAttachments([]);
              setActiveThreadId(thread.root.threadId);
            }}
            active={activeThreadId === thread.root.threadId}
          >
            {activeThreadId === thread.root.threadId ? (
              <ReviewThreadPopover
                thread={thread}
                canResolve={canResolve}
                discussion={comments.data?.discussion}
                pendingReaction={pendingReaction}
                onReact={(commentId, reaction, active) => {
                  if (reactToComment.isPending) return;
                  setPendingReaction(`${commentId}:${reaction}`);
                  reactToComment.mutate(
                    {
                      resourceType,
                      resourceId,
                      commentId,
                      reaction,
                      active,
                    },
                    {
                      onError: () => toast.error(t("review.reactionFailed")),
                      onSettled: () => setPendingReaction(null),
                    },
                  );
                }}
                sending={sendingThreadId === thread.root.threadId}
                canReply={canPost}
                placement={getReviewPopoverPlacement(position.point)}
                replyDraft={replyDraft}
                replyAttachments={replyAttachments}
                onReplyAttachmentsChange={setReplyAttachments}
                onReplyDraftChange={setReplyDraft}
                onClose={() => {
                  setActiveThreadId(null);
                  setReplyDraft("");
                  setReplyAttachments([]);
                }}
                onReply={() => {
                  const body = replyDraft.trim();
                  if (!body) return;
                  replyComment.mutate(
                    {
                      resourceType,
                      resourceId,
                      commentId: thread.root.id,
                      body,
                      ...(replyAttachments.length
                        ? { metadata: { attachments: replyAttachments } }
                        : {}),
                    },
                    {
                      onSuccess: () => {
                        setReplyDraft("");
                        setReplyAttachments([]);
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
                      onSuccess: (result) => {
                        setActiveThreadId(null);
                        if (result.status === "resolved") {
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
      })}
      {draftPin && draftPinPosition ? (
        <ReviewPin
          key={draftPin.id}
          index={visibleThreads.length}
          canvasRect={rect}
          point={draftPinPosition.point}
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
              attachments={draftAttachments}
              onAttachmentsChange={setDraftAttachments}
              onChange={(value) =>
                setDraftPin((current) =>
                  current ? { ...current, draft: value } : current,
                )
              }
              onCancel={cancelDraft}
              onSubmit={(resolutionTarget) => {
                setDraftPin((current) =>
                  current ? { ...current, resolutionTarget } : current,
                );
                postDraft({ ...draftPin, resolutionTarget }, draftAttachments);
              }}
              onSmartSubmit={(mode) => {
                if (mode === "preview") void submitReprompt(draftPin);
                else void submitSelectionQuestion(draftPin);
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
              placement={getReviewPopoverPlacement(draftPinPosition.point)}
              commentSubmitting={createComment.isPending}
              agentSubmitting={agentSubmitting}
            />
          ) : null}
        </ReviewPin>
      ) : null}
    </>,
    document.body,
  );
}

function ReviewPin({
  index,
  point,
  canvasRect,
  active,
  draft = false,
  pending = false,
  resolved = false,
  onClick,
  onDragEnd,
  children,
}: {
  index: number;
  point: ReviewAnchorPoint;
  canvasRect: DOMRect;
  active: boolean;
  draft?: boolean;
  pending?: boolean;
  resolved?: boolean;
  onClick: () => void;
  onDragEnd?: (point: ReviewAnchorPoint) => Promise<void> | void;
  children?: ReactNode;
}) {
  const t = useT();
  const [dragPoint, setDragPoint] = useState(point);
  const pointRef = useRef(point);
  pointRef.current = point;
  const dragRef = useRef<{
    pointerId: number;
    moved: boolean;
    origin: ReviewAnchorPoint;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const pendingDragRef = useRef<{
    next: ReviewAnchorPoint;
    origin: ReviewAnchorPoint;
    settled: boolean;
  } | null>(null);
  useEffect(() => {
    const pendingDrag = pendingDragRef.current;
    if (!pendingDrag) {
      setDragPoint(point);
      return;
    }
    if (pendingDrag.settled && sameReviewAnchorPoint(point, pendingDrag.next)) {
      pendingDragRef.current = null;
      setDragPoint(point);
    }
  }, [point]);
  const pointToCanvas = (event: PointerEvent): ReviewAnchorPoint => ({
    xPct: Math.min(
      100,
      Math.max(
        0,
        ((event.clientX - canvasRect.left) / Math.max(1, canvasRect.width)) *
          100,
      ),
    ),
    yPct: Math.min(
      100,
      Math.max(
        0,
        ((event.clientY - canvasRect.top) / Math.max(1, canvasRect.height)) *
          100,
      ),
    ),
  });
  return (
    <div
      data-review-popover
      className="fixed z-[45]"
      style={{
        left: canvasRect.left + (dragPoint.xPct / 100) * canvasRect.width,
        top: canvasRect.top + (dragPoint.yPct / 100) * canvasRect.height,
      }}
    >
      <button
        type="button"
        data-review-pin
        className={cn(
          "flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full rounded-bl-none border text-[10px] font-semibold shadow-md transition-transform hover:scale-110",
          draft
            ? "border-primary bg-primary text-primary-foreground"
            : resolved
              ? "border-muted-foreground/50 bg-muted text-muted-foreground"
              : "border-amber-200 bg-amber-400 text-amber-950",
          active && "ring-2 ring-primary/40",
        )}
        onClick={(event) => {
          event.stopPropagation();
          if (suppressClickRef.current || dragRef.current?.moved) {
            suppressClickRef.current = false;
            dragRef.current = null;
            return;
          }
          onClick();
        }}
        onPointerDown={(event) => {
          if (draft || pending || !onDragEnd || pendingDragRef.current) return;
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            moved: false,
            origin: dragPoint,
          };
        }}
        onPointerMove={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          const next = pointToCanvas(event);
          if (
            Math.abs(next.xPct - dragRef.current.origin.xPct) > 0.2 ||
            Math.abs(next.yPct - dragRef.current.origin.yPct) > 0.2
          ) {
            dragRef.current.moved = true;
          }
          if (dragRef.current.moved) setDragPoint(next);
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          const next = pointToCanvas(event);
          const drag = dragRef.current;
          const moved = drag.moved;
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (moved) {
            suppressClickRef.current = true;
            pendingDragRef.current = {
              next,
              origin: drag.origin,
              settled: false,
            };
            setDragPoint(next);
            void Promise.resolve()
              .then(() => onDragEnd?.(next))
              .then(
                () => {
                  const pendingDrag = pendingDragRef.current;
                  if (pendingDrag?.next !== next) return;
                  pendingDrag.settled = true;
                  if (sameReviewAnchorPoint(pointRef.current, next)) {
                    pendingDragRef.current = null;
                  }
                },
                () => {
                  const pendingDrag = pendingDragRef.current;
                  if (pendingDrag?.next !== next) return;
                  pendingDragRef.current = null;
                  setDragPoint(pendingDrag.origin);
                },
              );
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          suppressClickRef.current = false;
          if (!pendingDragRef.current) setDragPoint(point);
        }}
        style={{ touchAction: onDragEnd ? "none" : undefined }}
        aria-label={t("review.commentNumber", { count: index + 1 })}
      >
        {pending ? <Spinner className="size-3" /> : index + 1}
      </button>
      {children}
    </div>
  );
}

function sameReviewAnchorPoint(
  first: ReviewAnchorPoint,
  second: ReviewAnchorPoint,
): boolean {
  return first.xPct === second.xPct && first.yPct === second.yPct;
}

function ReviewImageAttachments({
  attachments,
  disabled,
  onChange,
  onUploadingChange,
}: {
  attachments: ReviewImageAttachment[];
  disabled: boolean;
  onChange: (attachments: ReviewImageAttachment[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const mountedRef = useRef(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleFiles = async (files: FileList | null) => {
    const selected = Array.from(files ?? [])
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, MAX_REVIEW_IMAGE_ATTACHMENTS - attachmentsRef.current.length);
    if (!selected.length) return;
    setUploading(true);
    onUploadingChange?.(true);
    const results = await Promise.allSettled(
      selected.map(async (file) => {
        const uploaded = await uploadEditorImage(file);
        if (!uploaded.src || uploaded.src.startsWith("data:")) {
          throw new Error("Image upload did not return a durable URL.");
        }
        return {
          url: uploaded.src,
          name: file.name || "image",
          contentType: file.type || undefined,
        } satisfies ReviewImageAttachment;
      }),
    );
    const uploaded = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (mountedRef.current && uploaded.length) {
      onChange(
        [...attachmentsRef.current, ...uploaded].slice(
          0,
          MAX_REVIEW_IMAGE_ATTACHMENTS,
        ),
      );
    }
    if (
      mountedRef.current &&
      results.some((result) => result.status === "rejected")
    ) {
      toast.error(t("review.postFailed"));
    }
    if (mountedRef.current) {
      setUploading(false);
      onUploadingChange?.(false);
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div
      data-review-attachments
      className="flex flex-wrap items-center gap-1.5 px-3 pb-2"
    >
      {attachments.map((attachment, index) => (
        <div
          key={`${attachment.url}-${index}`}
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
        size="icon"
        className="size-8 text-muted-foreground"
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
        className="sr-only"
        onChange={(event) => void handleFiles(event.currentTarget.files)}
      />
    </div>
  );
}

function DraftComposer({
  value,
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
  const [uploading, setUploading] = useState(false);
  const [modeOverride, setModeOverride] = useState<
    "auto" | NodeRepromptSendMode
  >(initialAgentMode);
  const inferredMode = inferNodeRepromptSendMode(value, {
    hasEditableTarget: smartAgentAvailable,
  });
  const sendMode = modeOverride === "auto" ? inferredMode : modeOverride;
  const submitting = commentSubmitting || agentSubmitting;
  const busy = submitting || uploading;
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
        className="h-8 min-w-0 flex-1 gap-1.5 rounded-e-none"
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
            className="h-8 shrink-0 rounded-s-none border-s-0 px-2"
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
            disabled={busy}
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
        disabled={busy}
        onChange={onChange}
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
      <ReviewMentionSuggestions value={value} onChange={onChange} />
      <ReviewImageAttachments
        attachments={attachments}
        disabled={busy}
        onChange={onAttachmentsChange}
        onUploadingChange={setUploading}
      />
    </div>
  );
}

function ReviewReactionControls({
  commentId,
  reactions,
  canReact,
  pendingReaction,
  onReact,
}: {
  commentId: string;
  reactions: ReviewCommentReaction[];
  canReact: boolean;
  pendingReaction: string | null;
  onReact: (commentId: string, reaction: string, active: boolean) => void;
}) {
  const t = useT();
  const choices = ["👍", "❤️", "🎉", "👀"];
  return (
    <div
      data-review-reactions
      className="mt-2 flex flex-wrap items-center gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      {reactions.map((item) => (
        <button
          key={item.reaction}
          type="button"
          disabled={!canReact || Boolean(pendingReaction)}
          aria-pressed={item.reactedByMe}
          className="inline-flex h-6 items-center gap-1 rounded-full border border-border px-2 text-xs hover:bg-muted aria-pressed:bg-primary/10"
          onClick={() => onReact(commentId, item.reaction, !item.reactedByMe)}
        >
          <span aria-hidden="true">{item.reaction}</span>
          <span>{item.count}</span>
        </button>
      ))}
      {canReact ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 rounded-full text-muted-foreground"
              disabled={Boolean(pendingReaction)}
              aria-label={t("review.addReaction")}
            >
              <IconMoodSmile className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="flex w-auto gap-0.5 p-1"
          >
            {choices.map((reaction) => (
              <DropdownMenuItem
                key={reaction}
                className="size-8 justify-center p-0 text-base"
                onSelect={() => onReact(commentId, reaction, true)}
              >
                <span aria-hidden="true">{reaction}</span>
                <span className="sr-only">{reaction}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function ReviewMentionSuggestions({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const match = value.match(/(?:^|\s)@([\w.-]*)$/);
  const query = match?.[1] ?? "";
  const { items, isLoading } = useMentionSearch(query, Boolean(match));
  if (!match || (!items.length && !isLoading)) return null;
  return (
    <div
      data-review-mention-menu
      role="listbox"
      aria-label={t("review.mention")}
      className="mx-3 mb-2 max-h-40 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
    >
      {isLoading ? (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {t("review.searching")}
        </div>
      ) : (
        items.slice(0, 6).map((item) => (
          <button
            key={item.id}
            type="button"
            role="option"
            className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const emailCandidate =
                item.refId ??
                (typeof item.metadata?.email === "string"
                  ? item.metadata.email
                  : undefined);
              const replacement = emailCandidate?.includes("@")
                ? `@[${item.label}](mailto:${emailCandidate}) `
                : `@${item.label} `;
              const start = value.lastIndexOf("@");
              onChange(`${value.slice(0, start)}${replacement}`);
            }}
          >
            {item.label}
          </button>
        ))
      )}
    </div>
  );
}

function ReviewThreadPopover({
  thread,
  canResolve,
  discussion,
  pendingReaction,
  onReact,
  sending,
  replying,
  resolving,
  canReply,
  placement,
  replyDraft,
  replyAttachments,
  onReplyAttachmentsChange,
  onReplyDraftChange,
  onClose,
  onReply,
  onStatusChange,
  onSendToAgent,
}: {
  thread: ReviewThread;
  canResolve: boolean;
  discussion?: ReviewDiscussionState;
  pendingReaction: string | null;
  onReact: (commentId: string, reaction: string, active: boolean) => void;
  sending: boolean;
  replying: boolean;
  resolving: boolean;
  canReply: boolean;
  placement: ReviewPopoverPlacement;
  replyDraft: string;
  replyAttachments: ReviewImageAttachment[];
  onReplyAttachmentsChange: (attachments: ReviewImageAttachment[]) => void;
  onReplyDraftChange: (value: string) => void;
  onClose: () => void;
  onReply: () => void;
  onStatusChange: () => void;
  onSendToAgent?: () => void;
}) {
  const t = useT();
  const [replyUploading, setReplyUploading] = useState(false);
  const rootAuthor = reviewAuthorLabel(thread.root, t("review.reviewer"));
  const avatarUrl = useAvatarUrl(thread.root.authorEmail);
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
          <div className="truncate text-xs font-medium text-muted-foreground">
            {rootAuthor}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-foreground">
            {displayReviewCommentBody(thread.root.body)}
          </p>
          <ReviewCommentAttachmentStrip comment={thread.root} />
          <ReviewReactionControls
            commentId={thread.root.id}
            reactions={discussion?.reactions[thread.root.id] ?? []}
            canReact={discussion?.canReact ?? false}
            pendingReaction={pendingReaction}
            onReact={onReact}
          />
        </div>
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
                pendingReaction={pendingReaction}
                onReact={onReact}
              />
            </div>
          ))}
        </div>
      ) : null}
      {(canReply && thread.root.status === "open") ||
      (canResolve && thread.root.status !== "deleted") ? (
        <div className="border-t border-border bg-muted/25 p-2.5">
          {canReply && thread.root.status === "open" ? (
            <>
              <ReviewCommentComposer
                value={replyDraft}
                disabled={replying || resolving || replyUploading}
                onChange={onReplyDraftChange}
                onSubmit={() => onReply()}
                submittingTarget={replying ? "human" : null}
                placeholder={t("review.replyPlaceholder")}
                commentLabel={t("review.reply")}
                submitOnEnter
                onEscape={onClose}
              />
              <ReviewMentionSuggestions
                value={replyDraft}
                onChange={onReplyDraftChange}
              />
              <ReviewImageAttachments
                attachments={replyAttachments}
                disabled={replying || resolving || replyUploading}
                onChange={onReplyAttachmentsChange}
                onUploadingChange={setReplyUploading}
              />
            </>
          ) : null}
          {canResolve &&
          (thread.root.status === "open" ||
            thread.root.status === "resolved") ? (
            <div className="mt-2 flex items-center gap-1">
              {onSendToAgent ? (
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
                    <IconRobot className="size-3.5" />
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

interface ReviewCommentAttachment {
  url: string;
  name: string;
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
        !/^https?:\/\//i.test(url) ||
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
