import {
  buildReviewThreads,
  ReviewCommentComposer,
  useCreateReviewComment,
  useReplyReviewComment,
  useResolveReviewThread,
  useReviewComments,
  useT,
  type ReviewThread,
} from "@agent-native/core/client";
import type { ReviewComment } from "@agent-native/core/review";
import {
  IconArrowUp,
  IconCircleCheck,
  IconMessageCircle,
  IconRobot,
  IconX,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import {
  resolveReviewAnchor,
  type DesignReviewAnchor,
  type ReviewAnchorPoint,
} from "../../../shared/review-anchor";
import {
  getReviewPopoverPlacement,
  placeReviewDraftPin,
  type ReviewDraftPin,
} from "./review-canvas-state";

export interface ReviewFocusRequest {
  nonce: number;
  anchor: unknown;
  targetId?: string;
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
  focusRequest?: ReviewFocusRequest | null;
  onDispatchCommentToAgent?: (comment: ReviewComment) => void;
  onSendThreadToAgent?: (thread: ReviewThread) => void;
  sendingThreadId?: string | null;
}

interface PinPosition {
  point: ReviewAnchorPoint;
  source: "node" | "point";
}

interface ReviewFrameNodeGeometry {
  rect: { left: number; top: number; width: number; height: number };
  viewportWidth: number;
  viewportHeight: number;
}

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

function nodePoint(
  canvas: HTMLElement,
  nodeId: string,
  frameGeometry?: ReviewFrameNodeGeometry,
): ReviewAnchorPoint | null {
  const element = findNodeElement(canvas, nodeId);
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

function elementAnchorAtPoint(
  canvas: HTMLElement,
  clientX: number,
  clientY: number,
): { nodeId?: string; layerName?: string; tagName?: string } {
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
    const anchor = element?.closest(
      "[data-agent-native-node-id],[data-code-layer-id],[data-layer-id],[data-builder-id],[id]",
    );
    if (!anchor) return {};
    const nodeId =
      anchor.getAttribute("data-agent-native-node-id") ??
      anchor.getAttribute("data-code-layer-id") ??
      anchor.getAttribute("data-layer-id") ??
      anchor.getAttribute("data-builder-id") ??
      anchor.getAttribute("id") ??
      undefined;
    const layerName =
      anchor.getAttribute("data-agent-native-layer-name") ?? undefined;
    return {
      ...(nodeId ? { nodeId } : {}),
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
      point: { xPct, yPct },
    },
    metadata: {
      ...(element.layerName ? { layerName: element.layerName } : {}),
      ...(element.tagName ? { tagName: element.tagName } : {}),
    },
  };
}

function resolvePinPosition(
  canvas: HTMLElement,
  anchor: unknown,
  frameGeometry: Record<string, ReviewFrameNodeGeometry>,
): PinPosition | null {
  const resolved = resolveReviewAnchor(anchor, (nodeId) =>
    nodePoint(canvas, nodeId, frameGeometry[nodeId]),
  );
  return resolved ? { point: resolved.point, source: resolved.source } : null;
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
  focusRequest,
  onDispatchCommentToAgent,
  onSendThreadToAgent,
  sendingThreadId,
}: ReviewCanvasPinsProps) {
  const t = useT();
  const comments = useReviewComments(
    {
      resourceType,
      resourceId,
      targetId,
      includeResolved: false,
      limit: 500,
    },
    {
      enabled: Boolean(!hidden && resourceType && resourceId && targetId),
    },
  );
  const createComment = useCreateReviewComment();
  const replyComment = useReplyReviewComment();
  const resolveThread = useResolveReviewThread();
  const [canvas, setCanvas] = useState<HTMLElement | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const [draftPin, setDraftPin] = useState<ReviewDraftPin | null>(null);
  const [draftComposerOpen, setDraftComposerOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [frameNodeGeometry, setFrameNodeGeometry] = useState<
    Record<string, ReviewFrameNodeGeometry>
  >({});
  const lastFocusNonceRef = useRef<number | null>(null);
  const pendingFocusNonceRef = useRef<number | null>(null);
  const frameCallbacksRef = useRef<
    Map<string, (payload: Record<string, unknown>) => void>
  >(new Map());

  const cancelDraft = useCallback(() => {
    setDraftPin(null);
    setDraftComposerOpen(false);
  }, []);

  const threads = useMemo(
    () => buildReviewThreads(comments.data?.comments ?? []),
    [comments.data?.comments],
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
      const resolved = resolveReviewAnchor(anchor, (nodeId) =>
        nodePoint(canvas, nodeId, frameNodeGeometry[nodeId]),
      );
      if (!resolved) return true;
      if (resolved.anchor.nodeId) {
        const element = findNodeElement(canvas, resolved.anchor.nodeId);
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
    if (focusAnchor(focusRequest.anchor, focusRequest.nonce)) {
      lastFocusNonceRef.current = focusRequest.nonce;
    }
  }, [focusAnchor, focusRequest, layoutTick, targetId]);

  useEffect(() => {
    if (!active) cancelDraft();
  }, [active, cancelDraft]);

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
    setFrameNodeGeometry({});
    frameCallbacksRef.current.clear();
    pendingFocusNonceRef.current = null;
  }, [cancelDraft, resourceId, targetId]);

  useEffect(() => {
    if (!hidden) return;
    cancelDraft();
    setActiveThreadId(null);
    setReplyDraft("");
    if (active) onClose();
  }, [active, cancelDraft, hidden, onClose]);

  const dropPin = useCallback(
    (clientX: number, clientY: number) => {
      if (!canvas || !canPost) return;
      const next = anchorAtPoint(canvas, clientX, clientY);
      if (!next) return;
      setActiveThreadId(null);
      setReplyDraft("");
      setDraftPin((current) =>
        placeReviewDraftPin(current, {
          id: crypto.randomUUID(),
          anchor: next.anchor,
          metadata: next.metadata,
        }),
      );
      setDraftComposerOpen(true);

      if (next.anchor.nodeId) return;
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
        const layerName =
          typeof payload.layerName === "string" ? payload.layerName : undefined;
        const tagName =
          typeof payload.tagName === "string" ? payload.tagName : undefined;
        if (!nodeId && !layerName && !tagName) return;
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
              point: current.anchor.point,
            },
            metadata: {
              ...current.metadata,
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
    [canPost, canvas],
  );

  const postDraft = useCallback(
    (pin: ReviewDraftPin) => {
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
          metadata: pin.metadata,
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

  if (hidden || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  void layoutTick;

  const openThreads = threads.filter(
    (thread) => thread.root.status === "open" && thread.root.anchor,
  );
  const draftPinPosition = draftPin
    ? resolvePinPosition(canvas, draftPin.anchor, frameNodeGeometry)
    : null;

  return (
    <>
      {active && canPost ? (
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
      {active && canPost ? (
        <div className="pointer-events-none fixed left-1/2 top-16 z-[45] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-popover px-3 py-1.5 text-xs shadow-lg">
          <IconMessageCircle className="size-3.5 text-primary" />
          {t("review.clickToPin")}
          <span className="text-[10px] text-muted-foreground">
            {t("review.escToExit")}
          </span>
        </div>
      ) : null}
      {openThreads.map((thread, index) => {
        const position = resolvePinPosition(
          canvas,
          thread.root.anchor,
          frameNodeGeometry,
        );
        if (!position) return null;
        return (
          <ReviewPin
            key={thread.root.threadId}
            index={index}
            canvasRect={rect}
            point={position.point}
            onClick={() => {
              if (!draftPin?.draft.trim()) setDraftPin(null);
              setDraftComposerOpen(false);
              setReplyDraft("");
              setActiveThreadId(thread.root.threadId);
            }}
            active={activeThreadId === thread.root.threadId}
          >
            {activeThreadId === thread.root.threadId ? (
              <ReviewThreadPopover
                thread={thread}
                canResolve={canResolve}
                sending={sendingThreadId === thread.root.threadId}
                canReply={canPost}
                placement={getReviewPopoverPlacement(position.point)}
                replyDraft={replyDraft}
                onReplyDraftChange={setReplyDraft}
                onClose={() => {
                  setActiveThreadId(null);
                  setReplyDraft("");
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
                    },
                    {
                      onSuccess: () => setReplyDraft(""),
                      onError: () => toast.error(t("review.replyFailed")),
                    },
                  );
                }}
                onResolve={() =>
                  resolveThread.mutate(
                    {
                      resourceType,
                      resourceId,
                      threadId: thread.root.threadId,
                    },
                    {
                      onSuccess: () => setActiveThreadId(null),
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
          index={openThreads.length}
          canvasRect={rect}
          point={draftPinPosition.point}
          draft
          onClick={() => {
            setActiveThreadId(null);
            setReplyDraft("");
            setDraftComposerOpen(true);
          }}
          active={draftComposerOpen}
        >
          {draftComposerOpen ? (
            <DraftComposer
              value={draftPin.draft}
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
                postDraft({ ...draftPin, resolutionTarget });
              }}
              resolutionTarget={draftPin.resolutionTarget}
              showAgentAction={Boolean(onDispatchCommentToAgent)}
              placement={getReviewPopoverPlacement(draftPinPosition.point)}
              submitting={createComment.isPending}
            />
          ) : null}
        </ReviewPin>
      ) : null}
    </>
  );
}

function ReviewPin({
  index,
  point,
  canvasRect,
  active,
  draft = false,
  onClick,
  children,
}: {
  index: number;
  point: ReviewAnchorPoint;
  canvasRect: DOMRect;
  active: boolean;
  draft?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div
      data-review-popover
      className="fixed z-[45]"
      style={{
        left: canvasRect.left + (point.xPct / 100) * canvasRect.width,
        top: canvasRect.top + (point.yPct / 100) * canvasRect.height,
      }}
    >
      <button
        type="button"
        data-review-pin
        className={cn(
          "flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full rounded-bl-none border text-[10px] font-semibold shadow-md transition-transform hover:scale-110",
          draft
            ? "border-primary bg-primary text-primary-foreground"
            : "border-amber-200 bg-amber-400 text-amber-950",
          active && "ring-2 ring-primary/40",
        )}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        aria-label={t("review.commentNumber", { count: index + 1 })}
      >
        {index + 1}
      </button>
      {children}
    </div>
  );
}

function DraftComposer({
  value,
  onChange,
  onCancel,
  onSubmit,
  resolutionTarget,
  showAgentAction,
  placement,
  submitting,
}: {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (target: "agent" | "human") => void;
  resolutionTarget: "agent" | "human";
  showAgentAction: boolean;
  placement: ReviewPopoverPlacement;
  submitting: boolean;
}) {
  const t = useT();
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
        <span className="text-sm font-medium">{t("review.newComment")}</span>
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
      <ReviewCommentComposer
        className="px-3 pb-3"
        autoFocus
        value={value}
        disabled={submitting}
        onChange={onChange}
        onSubmit={onSubmit}
        submittingTarget={submitting ? resolutionTarget : null}
        showAgentAction={showAgentAction}
        placeholder={t("review.placeholder")}
        commentLabel={t("review.commentMode")}
        agentLabel={t("review.sendToAgent")}
        submitOnEnter
        onEscape={onCancel}
      />
    </div>
  );
}

function ReviewThreadPopover({
  thread,
  canResolve,
  sending,
  replying,
  resolving,
  canReply,
  placement,
  replyDraft,
  onReplyDraftChange,
  onClose,
  onReply,
  onResolve,
  onSendToAgent,
}: {
  thread: ReviewThread;
  canResolve: boolean;
  sending: boolean;
  replying: boolean;
  resolving: boolean;
  canReply: boolean;
  placement: ReviewPopoverPlacement;
  replyDraft: string;
  onReplyDraftChange: (value: string) => void;
  onClose: () => void;
  onReply: () => void;
  onResolve: () => void;
  onSendToAgent?: () => void;
}) {
  const t = useT();
  const rootAuthor = reviewAuthorLabel(thread.root, t("review.reviewer"));
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
          <AvatarFallback className="text-[10px] font-semibold text-muted-foreground">
            {reviewAuthorInitials(rootAuthor)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-muted-foreground">
            {rootAuthor}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-foreground">
            {thread.root.body}
          </p>
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
                {reply.body}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {canReply || (canResolve && thread.root.status === "open") ? (
        <div className="border-t border-border bg-muted/25 p-2.5">
          {canReply ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={replyDraft}
                disabled={replying || resolving}
                onChange={(event) =>
                  onReplyDraftChange(event.currentTarget.value)
                }
                placeholder={t("review.replyPlaceholder")}
                className="h-8 min-w-0 flex-1 bg-background text-xs"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && replyDraft.trim() && !replying) {
                    event.preventDefault();
                    onReply();
                  }
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    event.preventDefault();
                    onClose();
                  }
                }}
              />
              <Button
                type="button"
                size="icon"
                className="size-8 shrink-0"
                disabled={!replyDraft.trim() || replying}
                onClick={onReply}
                aria-label={t("review.reply")}
              >
                {replying ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <IconArrowUp className="size-3.5" />
                )}
              </Button>
            </div>
          ) : null}
          {canResolve && thread.root.status === "open" ? (
            <div className="mt-2 flex items-center gap-1">
              {onSendToAgent ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs text-primary hover:text-primary"
                  disabled={sending || resolving}
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
                disabled={resolving || sending}
                onClick={onResolve}
              >
                {resolving ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <IconCircleCheck className="size-3.5" />
                )}
                {resolving ? t("review.resolving") : t("review.resolve")}
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
