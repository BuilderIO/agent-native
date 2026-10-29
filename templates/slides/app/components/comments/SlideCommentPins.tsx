import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useCreateReviewComment } from "@agent-native/core/client/review";
import type {
  ReviewDiscussionState,
  ReviewMention,
} from "@agent-native/core/review";
import {
  resolveReviewAgent,
  ReviewAuthorAvatar,
  ReviewCommentComposer,
  ReviewThreadCardFrame,
  type ReviewMentionOption,
} from "@agent-native/toolkit/app/review";
import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";
import {
  SLIDE_REVIEW_RESOURCE_TYPE,
  slideReviewAnchor,
} from "@shared/slide-review";
import { IconMessageCircle } from "@tabler/icons-react";
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
  type CommentThread,
  useSlideComments,
} from "@/hooks/use-slide-comments";
import {
  useSlideReviewSurface,
  type SlideReviewSurface,
} from "@/hooks/use-slide-review-surface";
import {
  slideCommentAnchorAtPoint,
  slideCommentAnchorPosition,
  slideCommentTextRange,
} from "@/lib/slide-comment-anchor";

import { SlideReviewThreadCard } from "./SlideReviewThreadCard";

interface SlideCommentPinsProps {
  active: boolean;
  canComment: boolean;
  canEdit?: boolean;
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

function CommentThreadPin({
  thread,
  open,
  onOpenChange,
  canComment,
  canEdit,
  currentUserEmail,
  deckId,
  discussion,
  surface,
  onBeforeCommentSubmit,
}: {
  thread: CommentThread;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canComment: boolean;
  canEdit: boolean;
  currentUserEmail: string | null;
  deckId: string;
  discussion: ReviewDiscussionState | undefined;
  surface: SlideReviewSurface;
  onBeforeCommentSubmit?: (() => Promise<void>) | undefined;
}) {
  const t = useT();
  const root = thread.review.root;
  const count = 1 + thread.review.replies.length;
  const authorName =
    root.authorName?.trim() || root.authorEmail || t("comments.reviewer");
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slide-comment-marker
          data-thread-id={thread.threadId}
          className="pointer-events-auto relative inline-flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full rounded-bl-none bg-popover shadow-2xl shadow-black/35 ring-1 ring-border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t("comments.openThreadBy", { author: authorName })}
          title={root.body}
        >
          <ReviewAuthorAvatar
            name={authorName}
            email={root.authorEmail}
            agent={resolveReviewAgent(root)}
            size={24}
          />
          {count > 1 && (
            <span className="absolute -end-1 -top-1 min-w-4 rounded-full bg-foreground px-1 text-[9px] font-semibold leading-4 text-background">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="z-[270] w-auto border-0 bg-transparent p-0 shadow-none"
        data-slide-comment-popover
        onEscapeKeyDown={keepPopoverOpenDuringComposition}
      >
        <SlideReviewThreadCard
          thread={thread}
          deckId={deckId}
          discussion={discussion}
          canComment={canComment}
          canEdit={canEdit}
          currentUserEmail={currentUserEmail}
          peopleMentionOptions={surface.peopleMentionOptions}
          agent={surface.agent}
          onBeforeCommentSubmit={onBeforeCommentSubmit}
          onClose={() => onOpenChange(false)}
          onResolved={() => onOpenChange(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

export function SlideCommentPins({
  active,
  canComment,
  canEdit = false,
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
  const createComment = useCreateReviewComment();
  const surface = useSlideReviewSurface({ deckId, canEdit });
  const { discussion } = useSlideComments(deckId, slideId);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const [canvasRect, setCanvasRect] = useState<DOMRect | null>(null);
  const [pending, setPending] = useState<PendingComment | null>(null);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<ReviewMention[]>([]);
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

  const clearDraft = useCallback(() => {
    setPending(null);
    setText("");
    setMentions([]);
  }, []);

  useEffect(() => {
    if (!active) {
      clearDraft();
      if (wasActive.current) focusCanvas();
    }
    wasActive.current = active;
  }, [active, clearDraft, focusCanvas]);

  useEffect(() => {
    setPending((current) => (current?.slideId === slideId ? current : null));
    setText("");
    setMentions([]);
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
      setText("");
      setMentions([]);
    },
    [active, canComment, createAnchor, deckId, slideId],
  );

  const submit = async (resolutionTarget: "agent" | "human") => {
    const trimmed = text.trim();
    if (!trimmed || !pending || !deckId || createComment.isPending) return;
    if (pending.slideId !== slideId) {
      clearDraft();
      return;
    }
    const submittedMentions = mentions;
    try {
      await onBeforeCommentSubmit?.();
      const created = await createComment.mutateAsync({
        resourceType: SLIDE_REVIEW_RESOURCE_TYPE,
        resourceId: deckId,
        targetId: slideId,
        anchor: slideReviewAnchor({ slideId, point: pending.anchor }),
        body: trimmed,
        mentions: submittedMentions,
        resolutionTarget,
        clientOperationId: crypto.randomUUID(),
      });
      clearDraft();
      focusCanvas();
      const outcome = await surface.agent.startIfTagged({
        threadId: created.threadId,
        commentId: created.id,
        mentions: submittedMentions,
      });
      if (outcome === "busy") toast.error(t("comments.agentBusy"));
      else if (outcome === "setup-required")
        toast.error(t("comments.agentSetupRequired"));
      else if (outcome === "failed")
        toast.error(t("comments.agentStartFailed"));
    } catch (err) {
      toast.error(actionErrorMessage(err) ?? t("comments.saveCommentFailed"));
    }
  };

  const draftMentionOptions: readonly ReviewMentionOption[] = canEdit
    ? [...surface.peopleMentionOptions, ...surface.agent.mentionOptions]
    : surface.peopleMentionOptions;

  if (!canvasRect || (!active && comments.every((thread) => !thread.anchor))) {
    return null;
  }

  const visibleThreads = comments.filter(
    (thread) => !thread.resolved && thread.anchor,
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
        {visibleThreads.map((thread) => (
          <div
            key={thread.threadId}
            className="pointer-events-auto absolute"
            data-slide-comment-marker-position
            style={(() => {
              const position = positionForAnchor(thread.anchor!);
              return {
                left: `${position.x}%`,
                top: `${position.y}%`,
              };
            })()}
          >
            {deckId ? (
              <CommentThreadPin
                thread={thread}
                open={openThreadId === thread.threadId}
                canComment={canComment}
                canEdit={canEdit}
                currentUserEmail={currentUserEmail}
                deckId={deckId}
                discussion={discussion}
                surface={surface}
                onBeforeCommentSubmit={onBeforeCommentSubmit}
                onOpenChange={(open) => {
                  setOpenThreadId(open ? thread.threadId : null);
                  if (open) onSelectThread?.(thread.threadId);
                  else focusCanvas();
                }}
              />
            ) : null}
          </div>
        ))}

        {pending && (
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
                if (!open) {
                  clearDraft();
                  focusCanvas();
                }
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("comments.addComment")}
                  className="inline-flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full rounded-bl-none bg-primary text-primary-foreground shadow-2xl shadow-black/35 ring-2 ring-background"
                >
                  <IconMessageCircle className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                className="z-[270] w-auto border-0 bg-transparent p-0 shadow-none"
                data-pin-popover
                onEscapeKeyDown={keepPopoverOpenDuringComposition}
              >
                <ReviewThreadCardFrame
                  title={t("comments.addComment")}
                  closeLabel={t("comments.cancel")}
                  onClose={() => {
                    if (createComment.isPending) return;
                    clearDraft();
                    focusCanvas();
                  }}
                >
                  <div className="flex items-start gap-2 px-3 py-4">
                    <ReviewAuthorAvatar
                      className="mt-0.5"
                      name={currentUserEmail ?? t("comments.reviewer")}
                      email={currentUserEmail}
                      size={24}
                    />
                    <ReviewCommentComposer
                      className="min-w-0 flex-1"
                      autoFocus
                      value={text}
                      mentions={mentions}
                      onMentionsChange={setMentions}
                      mentionOptions={draftMentionOptions}
                      agentsLabel={t("comments.agentsSection")}
                      showCommentTools
                      emojiLabel={t("comments.addEmoji")}
                      mentionLabel={t("comments.mention")}
                      noMentionsLabel={t("comments.noMentions")}
                      disabled={createComment.isPending}
                      onChange={setText}
                      onSubmit={(target) => void submit(target)}
                      submittingTarget={
                        createComment.isPending ? "human" : null
                      }
                      placeholder={t("comments.addCommentPlaceholder")}
                      commentLabel={t("comments.comment")}
                      submitOnEnter
                      onEscape={() => {
                        clearDraft();
                        focusCanvas();
                      }}
                    />
                  </div>
                </ReviewThreadCardFrame>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
    </div>
  );
}
