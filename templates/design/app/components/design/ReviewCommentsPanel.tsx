import { useT } from "@agent-native/core/client/i18n";
import { useOrgMembers } from "@agent-native/core/client/org";
import {
  ReviewThreadPanel,
  useResolveReviewThread,
  useReviewComments,
  useSetReviewThreadUnread,
  useSetReviewThreadsUnread,
  type ReviewThread,
} from "@agent-native/core/client/review";
import type {
  ReviewComment,
  ReviewMention,
  ReviewThreadPreference,
} from "@agent-native/core/review";
import {
  IconAdjustmentsHorizontal,
  IconMail,
  IconSearch,
  IconSend,
} from "@tabler/icons-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface ReviewCommentsPanelProps {
  designId: string;
  canComment: boolean;
  currentUserEmail?: string | null;
  currentTargetId?: string | null;
  /** Caller-derived editor capability for resolving threads. */
  canResolve?: boolean;
  /** Caller authorization for deleting a specific root comment. */
  canDeleteComment?: (comment: ReviewComment, thread: ReviewThread) => boolean;
  signInHref?: string;
  onSelectThread?: (thread: ReviewThread) => void;
  canDispatchToAgent?: boolean;
  sendingThreadId?: string | null;
  onSendThreadToAgent?: (thread: ReviewThread) => void;
  className?: string;
}

export type ReviewThreadSort = "date" | "unread";

export function ReviewCommentsPanel({
  designId,
  canComment,
  currentUserEmail,
  currentTargetId,
  canResolve,
  canDeleteComment,
  signInHref,
  onSelectThread,
  canDispatchToAgent = false,
  sendingThreadId,
  onSendThreadToAgent,
  className,
}: ReviewCommentsPanelProps) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [onlyCurrentPage, setOnlyCurrentPage] = useState(false);
  const [sortBy, setSortBy] = useState<ReviewThreadSort>("date");
  const setUnread = useSetReviewThreadUnread();
  const setUnreadBulk = useSetReviewThreadsUnread();
  const resolveThread = useResolveReviewThread();
  const reviewState = useReviewComments({
    resourceType: "design",
    resourceId: designId,
    includeResolved: true,
    newestFirst: true,
    limit: 500,
  });
  const { data: organizationMembers } = useOrgMembers();
  const hasCurrentTarget = currentTargetId !== undefined;
  const reviewPreferences = reviewState.data?.discussion?.threadPreferences;
  const unreadThreadIds = useMemo(
    () =>
      getUnreadReviewThreadIds(
        reviewState.data?.comments ?? [],
        reviewPreferences ?? {},
      ),
    [reviewPreferences, reviewState.data?.comments],
  );
  const canSetThreadPreferences = Boolean(
    reviewState.data?.discussion?.canSetThreadPreferences,
  );
  const normalizedUserEmail = currentUserEmail?.trim().toLowerCase() || null;
  const mentionOptions =
    organizationMembers?.members?.map<ReviewMention>((member) => ({
      label: member.name?.trim() || member.email.split("@")[0] || member.email,
      email: member.email,
    })) ?? [];
  const canEditComment = useCallback(
    (comment: ReviewComment) =>
      Boolean(
        canComment &&
        normalizedUserEmail &&
        comment.authorEmail?.trim().toLowerCase() === normalizedUserEmail,
      ),
    [canComment, normalizedUserEmail],
  );
  const threadFilter = useCallback(
    (thread: ReviewThread) => {
      const query = search.trim().toLowerCase();
      if (query) {
        const searchable = [
          thread.root.body,
          ...thread.replies.map((reply) => reply.body),
        ]
          .join(" ")
          .toLowerCase();
        if (!searchable.includes(query)) return false;
      }
      if (!onlyMine) return true;
      if (!normalizedUserEmail) return false;
      return [thread.root, ...thread.replies].some(
        (comment) =>
          comment.authorEmail?.trim().toLowerCase() === normalizedUserEmail,
      );
    },
    [normalizedUserEmail, onlyMine, search],
  );
  const copyThreadLink = useCallback(
    async (thread: ReviewThread) => {
      if (!navigator.clipboard) {
        toast.error(t("common.genericError"));
        return;
      }
      const link = new URL(window.location.href);
      link.hash = `comment=${encodeURIComponent(thread.root.threadId)}`;
      try {
        await navigator.clipboard.writeText(link.toString());
        toast.success(t("review.linkCopied"));
      } catch {
        toast.error(t("common.genericError"));
      }
    },
    [t],
  );
  const setThreadUnread = useCallback(
    (thread: ReviewThread, unread: boolean) => {
      if (
        !canSetThreadPreferences ||
        setUnread.isPending ||
        setUnreadBulk.isPending
      )
        return;
      setUnread.mutate(
        {
          resourceType: "design",
          resourceId: designId,
          threadId: thread.root.threadId,
          unread,
        },
        { onError: () => toast.error(t("common.genericError")) },
      );
    },
    [canSetThreadPreferences, designId, setUnread, setUnreadBulk, t],
  );
  const markAllRead = useCallback(() => {
    if (
      !canSetThreadPreferences ||
      setUnread.isPending ||
      setUnreadBulk.isPending ||
      unreadThreadIds.size === 0
    )
      return;
    setUnreadBulk.mutate(
      {
        resourceType: "design",
        resourceId: designId,
        threadIds: [...unreadThreadIds],
        unread: false,
      },
      { onError: () => toast.error(t("common.genericError")) },
    );
  }, [
    canSetThreadPreferences,
    designId,
    setUnread,
    setUnreadBulk,
    t,
    unreadThreadIds,
  ]);
  const threadSort = useCallback(
    (left: ReviewThread, right: ReviewThread) =>
      compareReviewThreads(left, right, sortBy, reviewPreferences ?? {}),
    [reviewPreferences, sortBy],
  );
  const handleSelectThread = useCallback(
    (thread: ReviewThread) => {
      if (unreadThreadIds.has(thread.root.threadId)) {
        setThreadUnread(thread, false);
      }
      onSelectThread?.(thread);
    },
    [onSelectThread, setThreadUnread, unreadThreadIds],
  );
  const handleResolved = useCallback(
    (thread: ReviewThread) => {
      toast.success(t("review.resolved"), {
        action: {
          label: t("review.undo"),
          onClick: () =>
            resolveThread.mutate({
              resourceType: "design",
              resourceId: designId,
              threadId: thread.root.threadId,
              status: "open",
            }),
        },
      });
    },
    [designId, resolveThread, t],
  );

  return (
    <div
      data-review-comments-panel
      className={cn(
        "design-sidebar-comments flex min-h-0 flex-1 flex-col",
        className,
      )}
    >
      {!canComment && signInHref ? (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="mx-2 mt-2 min-h-[var(--design-row-height)] shrink-0"
        >
          <a href={signInHref}>{t("review.signInToComment")}</a>
        </Button>
      ) : null}

      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-2">
        <div className="relative min-w-0 flex-1">
          <IconSearch className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            size="sm"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder={t("review.search")}
            aria-label={t("review.search")}
            className="ps-7 text-xs"
          />
        </div>
        {canSetThreadPreferences && unreadThreadIds.size ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label={t("review.markAllRead")}
            onClick={markAllRead}
          >
            <IconMail className="size-4" />
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              aria-label={t("review.filter")}
            >
              <IconAdjustmentsHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>{t("review.filter")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={showResolved}
              onCheckedChange={setShowResolved}
            >
              {t("review.showResolved")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={onlyMine}
              onCheckedChange={setOnlyMine}
              disabled={!normalizedUserEmail}
            >
              {t("review.onlyYours")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={onlyUnread}
              onCheckedChange={setOnlyUnread}
              disabled={!canSetThreadPreferences}
            >
              {t("review.unread")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={onlyCurrentPage}
              onCheckedChange={setOnlyCurrentPage}
              disabled={!hasCurrentTarget}
            >
              {t("review.currentPage")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("review.sort")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sortBy}
              onValueChange={(value) => setSortBy(value as ReviewThreadSort)}
            >
              <DropdownMenuRadioItem value="date">
                {t("review.sortByDate")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="unread">
                {t("review.sortByUnread")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ReviewThreadPanel
          resourceType="design"
          resourceId={designId}
          {...getReviewThreadTargetFilter(onlyCurrentPage, currentTargetId)}
          title={t("review.panelTitle")}
          emptyState={t("review.emptyState")}
          loadingLabel={t("review.loading")}
          replyLabel={t("review.reply")}
          replyPlaceholder={t("review.replyPlaceholder")}
          cancelReplyLabel={t("review.cancelReply")}
          resolveLabel={t("review.resolve")}
          deleteLabel={t("review.deleteComment")}
          moreActionsLabel={t("review.moreActions")}
          resolvedLabel={t("review.resolved")}
          reviewerLabel={t("review.reviewer")}
          includeResolved={showResolved}
          newestFirst
          limit={500}
          unreadOnly={onlyUnread}
          showHeader={false}
          variant="plain"
          className="design-sidebar-comments"
          showComposer={false}
          canReply={canComment}
          canResolve={canResolve ?? false}
          canDeleteComment={canDeleteComment}
          threadFilter={threadFilter}
          threadSort={threadSort}
          showReactions
          onReactionError={() => toast.error(t("common.genericError"))}
          onCopyThreadLink={copyThreadLink}
          onSetThreadUnread={
            canSetThreadPreferences ? setThreadUnread : undefined
          }
          copyLinkLabel={t("review.copyLink")}
          markUnreadLabel={t("review.markUnread")}
          markReadLabel={t("review.markRead")}
          addReactionLabel={t("review.addReaction")}
          mentionOptions={mentionOptions}
          showComposerTools
          canEditComment={canEditComment}
          editLabel={t("review.editComment")}
          saveEditLabel={t("review.save")}
          cancelEditLabel={t("review.cancel")}
          onThreadResolved={handleResolved}
          reopenLabel={t("review.reopen")}
          reopeningLabel={t("review.reopening")}
          confirmDeleteTitle={t("review.deleteCommentTitle")}
          confirmDeleteDescription={t("review.deleteCommentDescription")}
          confirmDeleteLabel={t("review.deleteComment")}
          cancelDeleteLabel={t("review.cancel")}
          showComposerTargetPicker={false}
          onSelectThread={handleSelectThread}
          renderThreadActions={
            canDispatchToAgent && onSendThreadToAgent
              ? (thread) => {
                  if (thread.root.status !== "open") return null;
                  const alreadyQueued =
                    thread.root.resolutionTarget !== "human" &&
                    !thread.root.consumedAt;
                  if (alreadyQueued) return null;
                  const sending = sendingThreadId === thread.root.threadId;
                  const dispatchPending = Boolean(sendingThreadId);
                  return (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="design-sidebar-control-text h-7 gap-1.5 px-2"
                      disabled={dispatchPending}
                      aria-busy={sending}
                      aria-label={t("review.sendToAgent")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSendThreadToAgent(thread);
                      }}
                    >
                      {sending ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <IconSend className="size-3.5" />
                      )}
                      <span className="hidden @xs/review:inline">
                        {sending
                          ? t("review.sendingToAgent")
                          : t("review.sendToAgent")}
                      </span>
                    </Button>
                  );
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

export function getUnreadReviewThreadIds(
  comments: ReviewComment[],
  preferences: Record<string, ReviewThreadPreference>,
): Set<string> {
  return new Set(
    comments
      .filter(
        (comment) =>
          comment.parentCommentId === null &&
          preferences[comment.threadId]?.unread,
      )
      .map((comment) => comment.threadId),
  );
}

export function getReviewThreadTargetFilter(
  onlyCurrentPage: boolean,
  currentTargetId: string | null | undefined,
): { targetId?: string | null } {
  return onlyCurrentPage && currentTargetId !== undefined
    ? { targetId: currentTargetId }
    : {};
}

export function compareReviewThreads(
  left: ReviewThread,
  right: ReviewThread,
  sortBy: ReviewThreadSort,
  preferences: Record<string, ReviewThreadPreference>,
): number {
  if (sortBy === "unread") {
    const leftUnread = Boolean(preferences[left.root.threadId]?.unread);
    const rightUnread = Boolean(preferences[right.root.threadId]?.unread);
    if (leftUnread !== rightUnread) return leftUnread ? -1 : 1;
  }
  return Date.parse(right.root.createdAt) - Date.parse(left.root.createdAt);
}
