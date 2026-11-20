import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { commentExcerpt } from "@agent-native/core/review/plain-text";
import {
  CommentBody,
  resolveReviewAgent,
  ReviewAuthorAvatar,
  type ReviewCommentDraft,
} from "@agent-native/toolkit/app/review";
import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";
import {
  IconCheck,
  IconMessageCircle,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useSlideComments,
  type CommentThread,
} from "@/hooks/use-slide-comments";
import {
  slideCommentAnchorAtPoint,
  slideCommentAnchorPosition,
  slideCommentTextRange,
} from "@/lib/slide-comment-anchor";

import {
  SlideCommentComposerBox,
  slideCommentAuthorLabel,
  slideCommentDraftSpot,
  SlideCommentEntry,
  useSlideCommentDraft,
  useSlideCommentKit,
  type SlideCommentKit,
} from "./slide-comment-kit";

interface SlideCommentPinsProps {
  active: boolean;
  canComment: boolean;
  comments: CommentThread[];
  deckId: string | null;
  slideId: string;
  canvasSelector: string;
  currentUserEmail?: string | null;
  onBeforeCommentSubmit?: () => Promise<void>;
  onEnsureObjectId?: (element: HTMLElement) => string;
  onSelectThread?: (threadId: string) => void;
}

type PendingComment = {
  slideId: string;
  anchor: SlideCommentAnchor;
};

type CommentHighlightRegistry = {
  set: (name: string, highlight: object) => unknown;
  delete: (name: string) => unknown;
};

type CommentHighlightConstructor = new (...ranges: Range[]) => object;

const COMMENT_TEXT_HIGHLIGHT = "slide-comment-anchor";

function keepPopoverOpenDuringComposition(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) event.preventDefault();
}

function findCommentObject(
  target: Element | null,
  canvasSelector: string,
): HTMLElement | null {
  const canvas = target?.closest<HTMLElement>(canvasSelector);
  let current = target instanceof HTMLElement ? target : target?.parentElement;
  while (current && current !== canvas) {
    const position =
      current.style.position || window.getComputedStyle(current).position;
    if (
      current.classList.contains("fmd-freeform-object") ||
      current.classList.contains("fmd-text-box") ||
      current.hasAttribute("data-slide-object-id") ||
      position === "absolute" ||
      position === "fixed"
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function CommentThreadPopover({
  kit,
  thread,
  open,
  onOpenChange,
}: {
  kit: SlideCommentKit;
  thread: CommentThread;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, canComment } = kit;
  const [replyOpen, setReplyOpen] = useState(false);
  const replyDraft = useSlideCommentDraft(kit, `reply:${thread.threadId}`);
  const { root, replies } = thread;
  const commentCount = replies.length + 1;

  const handleResolve = () => {
    kit
      .setResolved(thread, !thread.resolved)
      .catch((caught: unknown) =>
        toast.error(actionErrorMessage(caught) ?? t("comments.updateFailed")),
      );
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="pointer-events-auto inline-flex">
          <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-slide-comment-marker
                data-thread-id={thread.threadId}
                className="relative inline-flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-2xl shadow-black/35 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={commentExcerpt(root.body)}
              >
                <ReviewAuthorAvatar
                  name={slideCommentAuthorLabel(root, t("comments.reviewer"))}
                  email={root.authorEmail}
                  agent={resolveReviewAgent(root)}
                  size={32}
                  decorative
                  className="border border-background shadow-sm"
                />
                {commentCount > 1 && (
                  <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-foreground px-1 text-[9px] font-semibold leading-4 text-background">
                    {commentCount > 99 ? "99+" : commentCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="right"
              align="start"
              className="@container/review z-[280] w-80 p-3"
              data-slide-comment-popover
              onEscapeKeyDown={keepPopoverOpenDuringComposition}
            >
              <div className="space-y-3">
                <SlideCommentEntry kit={kit} comment={root} variant="root" />
                {replies.length > 0 && (
                  <div className="border-t border-border/70">
                    {replies.map((reply) => (
                      <SlideCommentEntry
                        key={reply.id}
                        kit={kit}
                        comment={reply}
                        variant="reply"
                      />
                    ))}
                  </div>
                )}
                {canComment && !thread.resolved && !replyOpen && (
                  <button
                    type="button"
                    onClick={() => setReplyOpen(true)}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {t("comments.reply")}
                  </button>
                )}
                {replyOpen && canComment && !thread.resolved && (
                  <SlideCommentComposerBox
                    kit={kit}
                    draft={replyDraft}
                    variant="reply"
                    autoFocus
                    placeholder={t("comments.replyPlaceholder")}
                    commentLabel={t("comments.reply")}
                    ariaLabel={t("comments.reply")}
                    failedLabel={t("comments.saveReplyFailed")}
                    onSubmit={(draft) =>
                      kit.reply(thread, draft).then(() => setReplyOpen(false))
                    }
                    onEscape={() => setReplyOpen(false)}
                    onCancel={() => {
                      replyDraft.clear();
                      setReplyOpen(false);
                    }}
                  />
                )}
                <div className="flex items-center border-t border-border/70 pt-2">
                  {canComment && (
                    <button
                      type="button"
                      aria-label={
                        thread.resolved
                          ? t("comments.reopenThread")
                          : t("comments.resolveThread")
                      }
                      disabled={kit.resolving}
                      onClick={handleResolve}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                      {thread.resolved ? (
                        <IconRefresh className="size-3" />
                      ) : (
                        <IconCheck className="size-3" />
                      )}
                      {thread.resolved
                        ? t("comments.reopenThread")
                        : t("comments.resolveThread")}
                    </button>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        <CommentBody
          compact
          body={root.body}
          mentions={root.mentions}
          className="line-clamp-4"
        />
      </TooltipContent>
    </Tooltip>
  );
}

export function SlideCommentPins({
  active,
  canComment,
  comments,
  deckId,
  slideId,
  canvasSelector,
  currentUserEmail = null,
  onBeforeCommentSubmit,
  onEnsureObjectId,
  onSelectThread,
}: SlideCommentPinsProps) {
  const t = useT();
  const discussion = useSlideComments(deckId, slideId).data?.discussion;
  const kit = useSlideCommentKit({
    deckId: deckId ?? "",
    surface: "pins",
    currentUserEmail,
    canComment,
    discussion,
    onBeforeCommentSubmit,
  });
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const [canvasRect, setCanvasRect] = useState<DOMRect | null>(null);
  const [pending, setPending] = useState<PendingComment | null>(null);
  const pendingDraftKey = pending
    ? `pin:${pending.slideId}@${slideCommentDraftSpot(pending.anchor)}`
    : null;
  const pendingDraft = useSlideCommentDraft(kit, pendingDraftKey);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [textHighlightRects, setTextHighlightRects] = useState<
    Array<{ x: number; y: number; width: number; height: number }>
  >([]);
  const wasActive = useRef(active);
  const focusCanvas = useCallback(() => {
    document
      .querySelector<HTMLElement>("[data-slide-canvas-focus='true']")
      ?.focus({ preventScroll: true });
  }, []);

  const measureCanvas = useCallback(() => {
    const canvas = document.querySelector<HTMLElement>(canvasSelector);
    setCanvasRect(canvas?.getBoundingClientRect() ?? null);
  }, [canvasSelector]);

  useLayoutEffect(() => {
    measureCanvas();
    const initialFrame = window.requestAnimationFrame(measureCanvas);
    const canvas = document.querySelector<HTMLElement>(canvasSelector);
    const observer =
      typeof ResizeObserver === "undefined" || !canvas
        ? null
        : new ResizeObserver(measureCanvas);
    if (observer && canvas) observer.observe(canvas);
    let mutationFrame = 0;
    const mutationObserver =
      typeof MutationObserver === "undefined" || !canvas
        ? null
        : new MutationObserver(() => {
            cancelAnimationFrame(mutationFrame);
            mutationFrame = requestAnimationFrame(measureCanvas);
          });
    if (mutationObserver && canvas) {
      mutationObserver.observe(canvas, {
        attributes: true,
        attributeFilter: ["style", "class"],
        characterData: true,
        childList: true,
        subtree: true,
      });
    }
    window.addEventListener("resize", measureCanvas);
    window.addEventListener("scroll", measureCanvas, true);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.cancelAnimationFrame(mutationFrame);
      observer?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", measureCanvas);
      window.removeEventListener("scroll", measureCanvas, true);
    };
  }, [canvasSelector, comments.length, measureCanvas]);

  useLayoutEffect(() => {
    const canvas = document.querySelector<HTMLElement>(canvasSelector);
    const slideContent = canvas?.querySelector<HTMLElement>(".slide-content");
    const ranges = comments.flatMap((thread) => {
      const anchor = thread.anchor;
      if (thread.resolved || !anchor || !thread.quotedText) return [];
      const object = anchor.objectId
        ? Array.from(
            slideContent?.querySelectorAll<HTMLElement>(
              "[data-slide-object-id]",
            ) ?? [],
          ).find(
            (element) =>
              element.getAttribute("data-slide-object-id") === anchor.objectId,
          )
        : slideContent;
      const range = object
        ? slideCommentTextRange(object, anchor, thread.quotedText)
        : null;
      return range ? [range] : [];
    });
    const css = window.CSS as typeof CSS & {
      highlights?: CommentHighlightRegistry;
    };
    const highlightConstructor = (
      window as Window & { Highlight?: CommentHighlightConstructor }
    ).Highlight;
    const registry = css.highlights;
    if (ranges.length && registry && highlightConstructor) {
      const style = document.createElement("style");
      style.dataset.slideCommentHighlights = "true";
      style.textContent = `/* guard:allow-raw-color -- match Google Slides text comment anchors */
::highlight(${COMMENT_TEXT_HIGHLIGHT}) { background-color: rgba(251, 188, 4, 0.42); }`;
      document.head.append(style);
      registry.set(COMMENT_TEXT_HIGHLIGHT, new highlightConstructor(...ranges));
      setTextHighlightRects([]);
      return () => {
        registry.delete(COMMENT_TEXT_HIGHLIGHT);
        style.remove();
      };
    }

    setTextHighlightRects(
      canvasRect
        ? ranges.flatMap((range) =>
            Array.from(range.getClientRects(), (rect) => ({
              x: rect.left - canvasRect.left,
              y: rect.top - canvasRect.top,
              width: rect.width,
              height: rect.height,
            })),
          )
        : [],
    );
    return () => registry?.delete(COMMENT_TEXT_HIGHLIGHT);
  }, [canvasRect, canvasSelector, comments, slideId]);

  useEffect(() => {
    if (!active) {
      setPending(null);
      if (wasActive.current) focusCanvas();
    }
    wasActive.current = active;
  }, [active, focusCanvas]);

  useEffect(() => {
    setPending((current) => (current?.slideId === slideId ? current : null));
  }, [slideId]);

  const createAnchor = useCallback(
    (clientX: number, clientY: number): SlideCommentAnchor | null => {
      if (!canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) {
        return null;
      }
      const target =
        (document.elementsFromPoint?.(clientX, clientY) ?? []).find(
          (element) =>
            !element.closest("[data-slide-comment-overlay]") &&
            element.closest(canvasSelector),
        ) ?? null;
      const object = findCommentObject(target, canvasSelector);
      const existingObjectId = object
        ?.getAttribute("data-slide-object-id")
        ?.trim();
      const objectId = object
        ? existingObjectId || onEnsureObjectId?.(object)
        : undefined;
      const objectRect = object?.getBoundingClientRect();
      const targetText = target?.textContent?.replace(/\s+/g, " ").trim();
      return slideCommentAnchorAtPoint({
        clientX,
        clientY,
        slideRect: canvasRect,
        objectId,
        objectRect,
        targetText,
      });
    },
    [canvasRect, canvasSelector, onEnsureObjectId],
  );

  const dropComment = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!active || !canComment || !deckId || !slideId) return;
      if (
        pointerStart.current &&
        Math.hypot(
          event.clientX - pointerStart.current.x,
          event.clientY - pointerStart.current.y,
        ) > 4
      ) {
        pointerStart.current = null;
        return;
      }
      pointerStart.current = null;
      const anchor = createAnchor(event.clientX, event.clientY);
      if (!anchor) return;
      setOpenThreadId(null);
      setPending({ slideId, anchor });
    },
    [active, canComment, createAnchor, deckId, slideId],
  );

  const closePending = () => {
    pendingDraft.clear();
    setPending(null);
    focusCanvas();
  };

  const submitPending = async (draft: ReviewCommentDraft) => {
    const sent = pending;
    if (!sent || !deckId) return;
    if (sent.slideId !== slideId) {
      setPending(null);
      return;
    }
    await kit.createThread({ slideId, draft, anchor: sent.anchor });
    setPending((current) => (current === sent ? null : current));
  };

  if (!canvasRect || (!active && comments.every((thread) => !thread.anchor))) {
    return null;
  }

  const visibleThreads = comments.flatMap((thread) =>
    !thread.resolved && thread.anchor
      ? [{ thread, anchor: thread.anchor }]
      : [],
  );
  const positionForAnchor = (anchor: SlideCommentAnchor) => {
    if (
      !anchor.objectId ||
      anchor.objectX === undefined ||
      anchor.objectY === undefined
    ) {
      return { x: anchor.x, y: anchor.y };
    }
    const canvas = document.querySelector<HTMLElement>(canvasSelector);
    const object = Array.from(
      canvas?.querySelectorAll<HTMLElement>("[data-slide-object-id]") ?? [],
    ).find(
      (element) =>
        element.getAttribute("data-slide-object-id") === anchor.objectId,
    );
    if (!canvasRect || !object) return { x: anchor.x, y: anchor.y };
    return slideCommentAnchorPosition(
      anchor,
      canvasRect,
      object.getBoundingClientRect(),
    );
  };

  return (
    <div
      data-slide-comment-overlay
      className="pointer-events-none fixed z-[250]"
      style={{
        left: canvasRect.left,
        top: canvasRect.top,
        width: canvasRect.width,
        height: canvasRect.height,
      }}
    >
      {active && canComment && (
        <div className="pointer-events-none fixed left-1/2 top-16 z-[260] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-popover px-3 py-1.5 shadow-lg">
          <IconMessageCircle className="size-3.5 text-primary" />
          <span className="text-[11px] text-foreground">
            {t("raw.pinDropHint")}
          </span>
          <span className="ml-1 text-[10px] text-muted-foreground">
            {t("raw.escExit")}
          </span>
        </div>
      )}

      {active && canComment && (
        <div
          className="pointer-events-auto absolute inset-0 cursor-crosshair"
          data-slide-comment-click-plane
          onPointerDown={(event) => {
            event.stopPropagation();
            focusCanvas();
            pointerStart.current = { x: event.clientX, y: event.clientY };
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            dropComment(event);
          }}
        />
      )}

      <div className="pointer-events-none absolute inset-0">
        {textHighlightRects.map((rect, index) => (
          <div
            key={index}
            aria-hidden="true"
            className="absolute rounded-[1px] bg-amber-300/40"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
            }}
          />
        ))}
        {visibleThreads.map(({ thread, anchor }) => {
          const position = positionForAnchor(anchor);
          return (
            <div
              key={thread.threadId}
              className="pointer-events-auto absolute"
              data-slide-comment-marker-position
              style={{
                left: `${position.x}%`,
                top: `${position.y}%`,
              }}
            >
              <CommentThreadPopover
                kit={kit}
                thread={thread}
                open={openThreadId === thread.threadId}
                onOpenChange={(open) => {
                  setOpenThreadId(open ? thread.threadId : null);
                  if (open) onSelectThread?.(thread.threadId);
                  else focusCanvas();
                }}
              />
            </div>
          );
        })}

        {pending && deckId && (
          <div
            className="pointer-events-auto absolute"
            style={{
              left: `${pending.anchor.x}%`,
              top: `${pending.anchor.y}%`,
            }}
          >
            <Popover
              open
              onOpenChange={(open) => {
                if (!open) closePending();
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("comments.addComment")}
                  className="inline-flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-2xl shadow-black/35 ring-2 ring-background"
                >
                  <IconMessageCircle className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                className="z-[280] w-80 p-3"
                data-pin-popover
                onEscapeKeyDown={keepPopoverOpenDuringComposition}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">
                      {t("comments.addComment")}
                    </span>
                    <button
                      type="button"
                      aria-label={t("comments.cancel")}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={closePending}
                    >
                      <IconX className="size-3.5" />
                    </button>
                  </div>
                  <SlideCommentComposerBox
                    kit={kit}
                    draft={pendingDraft}
                    autoFocus
                    placeholder={t("comments.addCommentPlaceholder")}
                    commentLabel={t("comments.comment")}
                    ariaLabel={t("comments.addComment")}
                    failedLabel={t("comments.saveCommentFailed")}
                    onSubmit={submitPending}
                    onEscape={closePending}
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
    </div>
  );
}
