import {
  actionErrorMessage,
  useAvatarUrl,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
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

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  emailToColor,
  type CommentThread,
  useDeleteSlideComment,
  useCreateSlideComment,
  useResolveSlideComment,
} from "@/hooks/use-slide-comments";
import {
  slideCommentAnchorAtPoint,
  slideCommentAnchorPosition,
} from "@/lib/slide-comment-anchor";
import { cn } from "@/lib/utils";

import { CommentItem, ReplyInput } from "./SlideCommentsPanel";

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
}

type PendingComment = {
  slideId: string;
  anchor: SlideCommentAnchor;
};

function initials(name: string | null | undefined, email: string) {
  return (name || email)
    .split(/[@.\s]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
    .slice(0, 2);
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

function CommentAvatar({
  email,
  name,
  className,
}: {
  email: string;
  name: string | null | undefined;
  className?: string;
}) {
  const avatarUrl = useAvatarUrl(email);
  return (
    <Avatar
      className={cn("size-8 border border-background shadow-sm", className)}
      title={name || email}
    >
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name || email} /> : null}
      <AvatarFallback
        className="text-[10px] font-semibold text-primary-foreground"
        style={{ backgroundColor: emailToColor(email) }}
      >
        {initials(name, email)}
      </AvatarFallback>
    </Avatar>
  );
}

function CommentThreadPopover({
  thread,
  open,
  onOpenChange,
  canComment,
  canEdit,
  currentUserEmail,
  deckId,
  onBeforeCommentSubmit,
  slideId,
}: {
  thread: CommentThread;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canComment: boolean;
  canEdit: boolean;
  currentUserEmail: string | null;
  deckId: string | null;
  onBeforeCommentSubmit?: () => Promise<void>;
  slideId: string;
}) {
  const t = useT();
  const [replyOpen, setReplyOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveComment = useResolveSlideComment();
  const deleteComment = useDeleteSlideComment();
  const root = thread.comments[0];
  if (!root || !thread.anchor) return null;

  const canManageRoot =
    canEdit ||
    root.author_email.trim().toLowerCase() ===
      currentUserEmail?.trim().toLowerCase();
  const handleResolve = () => {
    if (!deckId) return;
    setError(null);
    resolveComment.mutate(
      { id: root.id, deckId, resolved: !thread.resolved },
      {
        onError: (caught) =>
          setError(actionErrorMessage(caught) ?? t("comments.updateFailed")),
      },
    );
  };
  const handleDelete = () => {
    if (!deckId) return;
    setError(null);
    deleteComment.mutate(
      { id: root.id, deckId },
      {
        onError: (caught) =>
          setError(actionErrorMessage(caught) ?? t("comments.deleteFailed")),
      },
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
                aria-label={root.content}
              >
                <CommentAvatar
                  email={root.author_email}
                  name={root.author_name}
                />
                {thread.comments.length > 1 && (
                  <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-foreground px-1 text-[9px] font-semibold leading-4 text-background">
                    {thread.comments.length > 99
                      ? "99+"
                      : thread.comments.length}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="right"
              align="start"
              className="z-[300] w-80 p-3"
              data-slide-comment-popover
            >
              <div className="space-y-3">
                <CommentItem
                  comment={root}
                  deckId={deckId ?? ""}
                  onDelete={handleDelete}
                  canManage={canManageRoot}
                  canReact={canComment}
                />
                {thread.comments.length > 1 && (
                  <div className="space-y-2 border-t border-border/70 pt-2">
                    {thread.comments.slice(1).map((reply) => (
                      <CommentItem
                        key={reply.id}
                        comment={reply}
                        deckId={deckId ?? ""}
                        onDelete={() => {
                          if (!deckId) return;
                          deleteComment.mutate(
                            { id: reply.id, deckId },
                            {
                              onError: (caught) =>
                                setError(
                                  actionErrorMessage(caught) ??
                                    t("comments.deleteFailed"),
                                ),
                            },
                          );
                        }}
                        canManage={
                          canEdit ||
                          reply.author_email.trim().toLowerCase() ===
                            currentUserEmail?.trim().toLowerCase()
                        }
                        canReact={canComment}
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
                {replyOpen && canComment && deckId && (
                  <ReplyInput
                    deckId={deckId}
                    slideId={slideId}
                    threadId={thread.threadId}
                    parentId={root.id}
                    onBeforeSubmit={onBeforeCommentSubmit}
                    onDone={() => setReplyOpen(false)}
                  />
                )}
                <div className="flex items-center justify-between border-t border-border/70 pt-2">
                  {canComment && (
                    <button
                      type="button"
                      aria-label={
                        thread.resolved
                          ? t("comments.reopenThread")
                          : t("comments.resolveThread")
                      }
                      onClick={handleResolve}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
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
                  {error && (
                    <span role="alert" className="text-[10px] text-destructive">
                      {error}
                    </span>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        {root.content}
      </TooltipContent>
    </Tooltip>
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
}: SlideCommentPinsProps) {
  const t = useT();
  const createComment = useCreateSlideComment();
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const [canvasRect, setCanvasRect] = useState<DOMRect | null>(null);
  const [pending, setPending] = useState<PendingComment | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
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

  useEffect(() => {
    if (!active) {
      setPending(null);
      setText("");
      setError(null);
      if (wasActive.current) focusCanvas();
    }
    wasActive.current = active;
  }, [active, focusCanvas]);

  useEffect(() => {
    setPending((current) => (current?.slideId === slideId ? current : null));
    setText("");
    setError(null);
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
      setError(null);
    },
    [active, canComment, createAnchor, deckId, slideId],
  );

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || !pending || !deckId || createComment.isPending) return;
    if (pending.slideId !== slideId) {
      setPending(null);
      setText("");
      return;
    }
    setError(null);
    try {
      await onBeforeCommentSubmit?.();
      await createComment.mutateAsync({
        deckId,
        slideId,
        content: trimmed,
        anchor: pending.anchor,
      });
      setPending(null);
      setText("");
    } catch (err) {
      setError(actionErrorMessage(err) ?? t("comments.saveCommentFailed"));
    }
  };

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
            <CommentThreadPopover
              thread={thread}
              open={openThreadId === thread.threadId}
              canComment={canComment}
              canEdit={canEdit}
              currentUserEmail={currentUserEmail}
              deckId={deckId}
              onBeforeCommentSubmit={onBeforeCommentSubmit}
              slideId={slideId}
              onOpenChange={(open) => {
                setOpenThreadId(open ? thread.threadId : null);
                if (!open) focusCanvas();
              }}
            />
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
                  setPending(null);
                  focusCanvas();
                }
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
                className="z-[300] w-80 p-3"
                data-pin-popover
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
                      onClick={() => {
                        setPending(null);
                        focusCanvas();
                      }}
                    >
                      <IconX className="size-3.5" />
                    </button>
                  </div>
                  <Textarea
                    autoFocus
                    value={text}
                    onChange={(event) => {
                      setText(event.target.value);
                      if (error) setError(null);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        (event.metaKey || event.ctrlKey)
                      ) {
                        event.preventDefault();
                        void submit();
                      }
                      if (event.key === "Escape") {
                        setPending(null);
                        focusCanvas();
                      }
                    }}
                    placeholder={t("comments.addCommentPlaceholder")}
                    rows={3}
                    className="resize-none text-xs"
                  />
                  {error && (
                    <p className="text-[11px] text-destructive">{error}</p>
                  )}
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPending(null);
                        focusCanvas();
                      }}
                      className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {t("comments.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void submit()}
                      disabled={!text.trim() || createComment.isPending}
                      className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
                    >
                      {createComment.isPending
                        ? t("comments.saving")
                        : t("comments.comment")}
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
    </div>
  );
}
