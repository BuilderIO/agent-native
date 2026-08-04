import { useAvatarUrl } from "@agent-native/core/client/hooks";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export const PLAYBACK_COMMENT_VISIBLE_MS = 1_000;

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
  onClick,
}: {
  comments: PlaybackComment[] | undefined;
  currentMs: number;
  playbackRate?: number;
  onClick?: () => void;
}) {
  const activeComments = getActivePlaybackComments(
    comments,
    currentMs,
    playbackRate,
  );
  const avatarUrl = useAvatarUrl(activeComments[0]?.authorEmail);
  if (activeComments.length === 0) return null;

  const [comment, ...rest] = activeComments;
  const author = displayAuthor(comment);
  const Card = (onClick ? "button" : "div") as "button" | "div";

  return (
    <div
      data-player-ui
      className="pointer-events-none absolute inset-x-3 bottom-[5.25rem] z-20 flex justify-center sm:inset-x-6"
      aria-live="polite"
    >
      <Card
        key={comment.id}
        type={onClick ? "button" : undefined}
        onClick={onClick}
        className={cn(
          "animate-in fade-in slide-in-from-bottom-2 flex w-full max-w-xl flex-col gap-1.5 rounded-xl bg-black/85 px-3 py-2.5 text-left text-white shadow-2xl ring-1 ring-white/15 backdrop-blur-md duration-200",
          onClick && "pointer-events-auto cursor-pointer hover:bg-black/95",
        )}
      >
        <div className="flex max-w-full items-start gap-2.5">
          <Avatar aria-hidden="true" className="size-7 shrink-0">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={author} /> : null}
            <AvatarFallback className="bg-white/15 text-[10px] font-semibold text-white">
              {initials(author)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-white/80">
              {author}
            </p>
            <p className="line-clamp-3 break-words text-sm leading-5 text-white">
              {comment.content}
            </p>
          </div>
        </div>
        {rest.length > 0 && (
          <p className="pl-[2.375rem] text-xs text-white/60">
            +{rest.length} other comment{rest.length > 1 ? "s" : ""}
          </p>
        )}
      </Card>
    </div>
  );
}

function displayAuthor(comment: PlaybackComment): string {
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
