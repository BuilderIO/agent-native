export const PLAYBACK_COMMENT_VISIBLE_MS = 4_000;

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
): PlaybackComment[] {
  if (!comments?.length || !Number.isFinite(currentMs) || currentMs < 0) {
    return [];
  }

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
        currentMs < timestamp + PLAYBACK_COMMENT_VISIBLE_MS
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
}: {
  comments: PlaybackComment[] | undefined;
  currentMs: number;
}) {
  const activeComments = getActivePlaybackComments(comments, currentMs);
  if (activeComments.length === 0) return null;

  return (
    <div
      data-player-ui
      className="pointer-events-none absolute inset-x-3 bottom-[5.25rem] z-20 flex justify-center sm:inset-x-6"
      aria-live="polite"
    >
      <div className="flex w-full max-w-xl flex-col items-center gap-2">
        {activeComments.map((comment) => {
          const author = displayAuthor(comment);
          return (
            <div
              key={comment.id}
              className="animate-in fade-in slide-in-from-bottom-2 flex max-w-full items-start gap-2.5 rounded-xl bg-black/85 px-3 py-2.5 text-white shadow-2xl ring-1 ring-white/15 backdrop-blur-md duration-200"
            >
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-[10px] font-semibold text-white"
              >
                {initials(author)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white/80">
                  {author}
                </p>
                <p className="line-clamp-3 break-words text-sm leading-5 text-white">
                  {comment.content}
                </p>
              </div>
            </div>
          );
        })}
      </div>
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
