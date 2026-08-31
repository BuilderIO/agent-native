import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { InlineMarkdown } from "@agent-native/core/client/markdown";
import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";
import { IconMessageCircle, IconX } from "@tabler/icons-react";
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
  formatRelativeTime,
  type CommentThread,
  useCreateSlideComment,
} from "@/hooks/use-slide-comments";
import { cn } from "@/lib/utils";

interface SlideCommentPinsProps {
  active: boolean;
  canComment: boolean;
  comments: CommentThread[];
  deckId: string | null;
  slideId: string;
  canvasSelector: string;
}

type PendingComment = {
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
      className={cn(
        "size-8 border-2 border-background shadow-sm ring-1 ring-border/60",
        className,
      )}
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
}: {
  thread: CommentThread;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const root = thread.comments[0];
  if (!root || !thread.anchor) return null;

  const authorName = root.author_name || root.author_email.split("@")[0];
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
                <div className="flex gap-2">
                  <CommentAvatar
                    email={root.author_email}
                    name={root.author_name}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">
                        {authorName}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatRelativeTime(root.created_at)}
                      </span>
                    </div>
                    <InlineMarkdown
                      content={root.content}
                      className="mt-1 text-xs leading-relaxed text-foreground/90"
                    />
                  </div>
                </div>
                {thread.comments.length > 1 && (
                  <div className="space-y-2 border-t border-border/70 pt-2">
                    {thread.comments.slice(1).map((reply) => (
                      <div key={reply.id} className="flex gap-2">
                        <CommentAvatar
                          email={reply.author_email}
                          name={reply.author_name}
                          className="size-6"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[11px] font-medium">
                              {reply.author_name ||
                                reply.author_email.split("@")[0]}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {formatRelativeTime(reply.created_at)}
                            </span>
                          </div>
                          <InlineMarkdown
                            content={reply.content}
                            className="mt-0.5 text-[11px] leading-relaxed text-foreground/90"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-end border-t border-border/70 pt-2">
                  <span className="text-[10px] text-muted-foreground">
                    {t("comments.title")}
                  </span>
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
  comments,
  deckId,
  slideId,
  canvasSelector,
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
    const frame = window.requestAnimationFrame(measureCanvas);
    const canvas = document.querySelector<HTMLElement>(canvasSelector);
    const observer =
      typeof ResizeObserver === "undefined" || !canvas
        ? null
        : new ResizeObserver(measureCanvas);
    if (observer && canvas) observer.observe(canvas);
    window.addEventListener("resize", measureCanvas);
    window.addEventListener("scroll", measureCanvas, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
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

  const createAnchor = useCallback(
    (clientX: number, clientY: number): SlideCommentAnchor | null => {
      if (!canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) {
        return null;
      }
      const x = Math.max(
        0,
        Math.min(100, ((clientX - canvasRect.left) / canvasRect.width) * 100),
      );
      const y = Math.max(
        0,
        Math.min(100, ((clientY - canvasRect.top) / canvasRect.height) * 100),
      );
      const target = (
        document.elementsFromPoint?.(clientX, clientY) ?? []
      ).find(
        (element) =>
          !element.closest("[data-slide-comment-overlay]") &&
          element.closest(canvasSelector),
      );
      const targetText = target?.textContent?.replace(/\s+/g, " ").trim();
      return {
        x,
        y,
        ...(targetText ? { targetText: targetText.slice(0, 200) } : {}),
      };
    },
    [canvasRect, canvasSelector],
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
      setPending({ anchor });
      setText("");
      setError(null);
    },
    [active, canComment, createAnchor, deckId, slideId],
  );

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || !pending || !deckId || createComment.isPending) return;
    setError(null);
    try {
      await createComment.mutateAsync({
        deckId,
        slideId,
        content: trimmed,
        anchor: pending.anchor,
      });
      setPending(null);
      setText("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("comments.saveCommentFailed"),
      );
    }
  };

  if (!canvasRect || (!active && comments.every((thread) => !thread.anchor))) {
    return null;
  }

  const visibleThreads = comments.filter(
    (thread) => !thread.resolved && thread.anchor,
  );

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
            style={{
              left: `${thread.anchor!.x}%`,
              top: `${thread.anchor!.y}%`,
            }}
          >
            <CommentThreadPopover
              thread={thread}
              open={openThreadId === thread.threadId}
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
