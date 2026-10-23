import { InlineMarkdown } from "@agent-native/toolkit/app/review";
import type { ClipCommentMarker } from "@shared/clips-peer-contract";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export const COMMENT_PREVIEW_WIDTH_PX = 320;

// Copied from Clips' `playback-comment-overlay.tsx` CommentPreview. A
// signed-out reader's markers carry no author, so the avatar goes with it.
export function CommentPreview({
  comment,
  className,
}: {
  comment: ClipCommentMarker;
  className?: string;
}) {
  const author = comment.authorName?.trim() ?? "";

  return (
    <div
      data-player-comment-preview
      className={cn(
        "flex w-80 max-w-full flex-col gap-1.5 rounded-xl bg-foreground/95 px-3 py-2.5 text-left text-background shadow-2xl ring-1 ring-background/15 backdrop-blur-md dark:bg-background/95 dark:text-foreground dark:ring-foreground/15",
        className,
      )}
    >
      <div className="flex max-w-full items-start gap-2.5">
        {author ? (
          <Avatar aria-hidden="true" className="size-7 shrink-0">
            <AvatarFallback className="bg-background/15 text-[10px] font-semibold text-background dark:bg-foreground/15 dark:text-foreground">
              {initials(author)}
            </AvatarFallback>
          </Avatar>
        ) : null}
        <div className="min-w-0">
          {author ? (
            <p className="truncate text-xs font-semibold text-background/80 dark:text-foreground/80">
              {author}
            </p>
          ) : null}
          <InlineMarkdown
            content={comment.content}
            className="line-clamp-3 text-sm leading-5 text-background dark:text-foreground"
            linkClassName="text-background underline decoration-background/60 hover:decoration-background dark:text-foreground dark:decoration-foreground/60 dark:hover:decoration-foreground"
            codeClassName="bg-background/15 text-background dark:bg-foreground/15 dark:text-foreground"
          />
        </div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
