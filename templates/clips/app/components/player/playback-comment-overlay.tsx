import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { InlineMarkdown } from "@agent-native/core/client/markdown";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import { timelineMarkerMs } from "./scrubber-position";

export const PLAYBACK_COMMENT_VISIBLE_MS = 3_000;

export function getPlaybackCommentVisibleMs(playbackRate = 1): number {
  const safePlaybackRate =
    Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  return PLAYBACK_COMMENT_VISIBLE_MS * safePlaybackRate;
}

export interface PlaybackComment {
  id: string;
  content: string;
  videoTimestampMs: number;
  authorEmail?: string | null;
  authorName?: string | null;
  parentId?: string | null;
  resolved?: boolean;
}

export type CommentPreviewData = Pick<
  PlaybackComment,
  "id" | "content" | "authorEmail" | "authorName"
>;

export function getActivePlaybackComments(
  comments: PlaybackComment[] | undefined,
  currentMs: number,
  playbackRate = 1,
): PlaybackComment[] {
  if (!comments?.length || !Number.isFinite(currentMs) || currentMs < 0) {
    return [];
  }

  const visibleMs = getPlaybackCommentVisibleMs(playbackRate);

  return comments
    .filter((comment) => {
      const timestamp = comment.videoTimestampMs;
      return (
        comment.parentId == null &&
        comment.resolved !== true &&
        comment.content.trim().length > 0 &&
        Number.isFinite(timestamp) &&
        timestamp >= 0 &&
        currentMs >= timestamp &&
        currentMs < timestamp + visibleMs
      );
    })
    .sort(
      (a, b) =>
        a.videoTimestampMs - b.videoTimestampMs || a.id.localeCompare(b.id),
    );
}

export function PlaybackCommentOverlay({
  comments,
  currentMs,
  playbackRate = 1,
  durationMs,
  getTimelinePositionMs,
  getTimelineLane,
  onClick,
}: {
  comments: PlaybackComment[] | undefined;
  currentMs: number;
  playbackRate?: number;
  durationMs?: number;
  getTimelinePositionMs?: (
    comment: PlaybackComment,
  ) => number | null | undefined;
  getTimelineLane?: (comment: PlaybackComment) => number | null | undefined;
  onClick?: () => void;
}) {
  const activeComments = getActivePlaybackComments(
    comments,
    currentMs,
    playbackRate,
  );
  if (activeComments.length === 0) return null;

  const [comment, ...rest] = activeComments;
  const timelinePositionMs = getTimelinePositionMs?.(comment);
  const positionMs = getTimelinePositionMs
    ? (timelinePositionMs ?? Number.NaN)
    : comment.videoTimestampMs;
  const safeDurationMs = durationMs ?? 0;
  const markerMs = Number.isFinite(positionMs)
    ? timelineMarkerMs(positionMs)
    : positionMs;
  const timelineLane = getTimelineLane?.(comment);
  const markerLane = timelineLane === 1 ? 1 : 0;
  const positionPercent =
    Number.isFinite(safeDurationMs) &&
    safeDurationMs > 0 &&
    Number.isFinite(markerMs)
      ? Math.min(100, Math.max(0, (markerMs / safeDurationMs) * 100))
      : 50;
  const positionAlignment =
    positionPercent <= 0 ? "start" : positionPercent >= 100 ? "end" : "center";

  return (
    <div
      data-player-ui
      data-player-playback-comment
      className="pointer-events-none absolute inset-x-3 bottom-[6.5rem] z-40 h-0"
      aria-live="polite"
    >
      <div
        className={cn(
          "absolute bottom-0",
          positionAlignment === "start"
            ? "left-0"
            : positionAlignment === "end"
              ? "right-0"
              : "-translate-x-1/2",
        )}
        style={{
          ...(positionAlignment === "start"
            ? { left: "0%" }
            : positionAlignment === "end"
              ? { right: "0%" }
              : { left: positionPercent + "%" }),
          bottom: markerLane ? "1.75rem" : "0",
        }}
      >
        <CommentPreview
          comment={comment}
          restCount={rest.length}
          onClick={onClick}
          className="animate-in fade-in slide-in-from-bottom-2 duration-200"
        />
      </div>
    </div>
  );
}

export function CommentPreview({
  comment,
  restCount = 0,
  onClick,
  className,
}: {
  comment: CommentPreviewData;
  restCount?: number;
  onClick?: () => void;
  className?: string;
}) {
  const avatarUrl = useAvatarUrl(comment.authorEmail);
  const author = displayAuthor(comment);
  const Card = (onClick ? "button" : "div") as "button" | "div";

  return (
    <Card
      data-player-comment-preview
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-fit max-w-[min(36rem,calc(100vw-1.5rem))] flex-col gap-1.5 rounded-xl bg-foreground/95 px-3 py-2.5 text-left text-background shadow-2xl ring-1 ring-background/15 backdrop-blur-md dark:bg-background/95 dark:text-foreground dark:ring-foreground/15",
        onClick &&
          "pointer-events-auto cursor-pointer hover:bg-foreground dark:hover:bg-background",
        className,
      )}
    >
      <div className="flex max-w-full items-start gap-2.5">
        <Avatar aria-hidden="true" className="size-7 shrink-0">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={author} /> : null}
          <AvatarFallback className="bg-background/15 text-[10px] font-semibold text-background dark:bg-foreground/15 dark:text-foreground">
            {initials(author)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-background/80 dark:text-foreground/80">
            {author}
          </p>
          <InlineMarkdown
            content={comment.content}
            className="line-clamp-3 text-sm leading-5 text-background dark:text-foreground"
            linkClassName="text-background underline decoration-background/60 hover:decoration-background dark:text-foreground dark:decoration-foreground/60 dark:hover:decoration-foreground"
            codeClassName="bg-background/15 text-background dark:bg-foreground/15 dark:text-foreground"
          />
        </div>
      </div>
      {restCount > 0 && (
        <p className="pl-[2.375rem] text-xs text-background/60 dark:text-foreground/60">
          +{restCount} other comment{restCount > 1 ? "s" : ""}
        </p>
      )}
    </Card>
  );
}

function displayAuthor(comment: CommentPreviewData): string {
  const name = comment.authorName?.trim();
  if (name) return name;
  const emailName = comment.authorEmail?.split("@")[0]?.trim();
  return emailName || comment.authorEmail?.trim() || "";
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
