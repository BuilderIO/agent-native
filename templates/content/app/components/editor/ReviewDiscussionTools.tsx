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

import {
  AddReactionButton,
  CommentReactionChips,
  QUICK_REACTIONS,
} from "./CommentReactions";

type DiscussionProps = {
  documentId: string;
  suggestionId: string;
  threadId: string;
  commentId: string;
  discussion: ReviewDiscussionState;
};

const quickReactions = QUICK_REACTIONS;

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
  const pending = react.isPending ? react.variables : null;
  const shown = reactions
    .map((entry) =>
      pending?.reaction === entry.reaction
        ? {
            ...entry,
            reactedByMe: pending.active,
            count:
              entry.count + Number(pending.active) - Number(entry.reactedByMe),
          }
        : entry,
    )
    .filter((entry) => entry.count > 0);
  return (
    <CommentReactionChips
      reactions={shown}
      canReact={canReact && !react.isPending}
      onToggle={(reaction, active) =>
        react.mutate(
          {
            resourceType: "document",
            resourceId: documentId,
            commentId,
            reaction,
            active,
          },
          {
            onError: (error) =>
              toast.error(
                actionErrorMessage(error) ?? t("comments.toolFailed"),
              ),
          },
        )
      }
    />
  );
}

/** The shared 🙂 button for a suggestion discussion comment. */
export function ReviewAddReactionButton({
  documentId,
  commentId,
  reactions,
}: {
  documentId: string;
  commentId: string;
  reactions: ReviewCommentReaction[];
}) {
  const t = useT();
  const react = useReactToReviewComment();
  return (
    <AddReactionButton
      className="opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
      onSelect={(reaction) =>
        react.mutate(
          {
            resourceType: "document",
            resourceId: documentId,
            commentId,
            reaction,
            active: !reactions.find((entry) => entry.reaction === reaction)
              ?.reactedByMe,
          },
          {
            onError: (error) =>
              toast.error(
                actionErrorMessage(error) ?? t("comments.toolFailed"),
              ),
          },
        )
      }
    />
  );
}
