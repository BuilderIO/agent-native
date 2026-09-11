import { appPath } from "@agent-native/core/client/api-path";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useReactToReviewComment,
  useSetReviewThreadMuted,
  useSetReviewThreadUnread,
} from "@agent-native/core/client/review";
import type {
  ReviewCommentReaction,
  ReviewDiscussionState,
} from "@agent-native/core/review";
import { contentSuggestionPath } from "@shared/suggestion-link";
import { IconDots } from "@tabler/icons-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type DiscussionProps = {
  documentId: string;
  suggestionId: string;
  threadId: string;
  commentId: string;
  discussion: ReviewDiscussionState;
};

const quickReactions = ["👍", "❤️", "🎉", "👀"];

export function ReviewCommentMenu({
  documentId,
  suggestionId,
  threadId,
  commentId,
  discussion,
  alwaysVisible = false,
}: DiscussionProps & { alwaysVisible?: boolean }) {
  const t = useT();
  const react = useReactToReviewComment();
  const unread = useSetReviewThreadUnread();
  const mute = useSetReviewThreadMuted();
  const resource = { resourceType: "document", resourceId: documentId };
  const preferences = discussion.threadPreferences[threadId];
  const reactions = discussion.reactions[commentId] ?? [];
  const reportError = (error: Error) =>
    toast.error(actionErrorMessage(error) ?? t("comments.toolFailed"));
  const isMuted = mute.isPending ? mute.variables!.muted : preferences?.muted;
  const isUnread = unread.isPending
    ? unread.variables!.unread
    : preferences?.unread;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("comments.moreActions")}
          className={cn(
            "ms-auto rounded p-1 text-muted-foreground [@media(hover:none)]:opacity-100 hover:bg-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/comment:opacity-100 group-focus-within/comment:opacity-100",
            !alwaysVisible && "md:opacity-0",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <IconDots size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-comments-sidebar
        align="end"
        onClick={(event) => event.stopPropagation()}
      >
        {discussion.canReact ? (
          <>
            <DropdownMenuLabel>{t("comments.addReaction")}</DropdownMenuLabel>
            <DropdownMenuGroup>
              {quickReactions.map((reaction) => {
                const current = reactions.find(
                  (entry) => entry.reaction === reaction,
                );
                const active =
                  react.isPending && react.variables?.reaction === reaction
                    ? react.variables.active
                    : (current?.reactedByMe ?? false);
                return (
                  <DropdownMenuCheckboxItem
                    key={reaction}
                    checked={active}
                    disabled={react.isPending}
                    onCheckedChange={(checked) =>
                      react.mutate(
                        { ...resource, commentId, reaction, active: checked },
                        { onError: reportError },
                      )
                    }
                  >
                    {reaction}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup>
          {discussion.canSetThreadPreferences && preferences ? (
            <>
              <DropdownMenuItem
                disabled={unread.isPending}
                onSelect={() =>
                  unread.mutate(
                    { ...resource, threadId, unread: !isUnread },
                    { onError: reportError },
                  )
                }
              >
                {isUnread ? t("comments.markRead") : t("comments.markUnread")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={mute.isPending}
                onSelect={() =>
                  mute.mutate(
                    { ...resource, threadId, muted: !isMuted },
                    { onError: reportError },
                  )
                }
              >
                {isMuted ? t("comments.unmute") : t("comments.mute")}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuItem
            onSelect={() => {
              const url = new URL(
                appPath(contentSuggestionPath(documentId, suggestionId)),
                window.location.origin,
              ).href;
              void writeClipboardText(url).then((copied) => {
                if (copied) toast.success(t("comments.linkCopied"));
                else toast.error(t("comments.copyLinkFailed"));
              }, reportError);
            }}
          >
            {t("comments.copyLink")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ReviewReactionList({
  documentId,
  commentId,
  reactions,
  canReact,
}: {
  documentId: string;
  commentId: string;
  reactions: ReviewCommentReaction[];
  canReact: boolean;
}) {
  const t = useT();
  const react = useReactToReviewComment();
  if (!reactions.length) return null;
  return (
    <div
      className="mt-1 flex flex-wrap gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      {reactions.map((entry) => {
        const pending =
          react.isPending && react.variables?.reaction === entry.reaction
            ? react.variables
            : null;
        const active = pending ? pending.active : entry.reactedByMe;
        const count =
          entry.count +
          (pending ? Number(pending.active) - Number(entry.reactedByMe) : 0);
        return (
          <button
            key={entry.reaction}
            type="button"
            aria-pressed={active}
            aria-label={t("comments.reactionCount", {
              reaction: entry.reaction,
              count,
            })}
            disabled={!canReact || react.isPending}
            className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent aria-pressed:bg-accent aria-pressed:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            onClick={() =>
              react.mutate(
                {
                  resourceType: "document",
                  resourceId: documentId,
                  commentId,
                  reaction: entry.reaction,
                  active: !active,
                },
                {
                  onError: (error) =>
                    toast.error(
                      actionErrorMessage(error) ?? t("comments.toolFailed"),
                    ),
                },
              )
            }
          >
            {entry.reaction} {count}
          </button>
        );
      })}
    </div>
  );
}
