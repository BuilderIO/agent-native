import { useT } from "@agent-native/core/client/i18n";
import {
  useReviewComments,
  useSetReviewThreadUnread,
  useSetReviewThreadsUnread,
} from "@agent-native/core/client/review";
import type {
  ReviewComment,
  ReviewThreadPreference,
} from "@agent-native/core/review";
import {
  buildReviewThreads,
  type ReviewThread,
} from "@agent-native/toolkit/app/review";
import { IconFilter, IconPlus, IconSearch } from "@tabler/icons-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { ReviewThreadRow } from "./ReviewThreadRow";

export interface ReviewCommentsPanelScreen {
  id: string;
  name: string;
  /** Set only for a localhost or live-URL screen, e.g. `/home`. */
  route?: string | null | undefined;
}

export interface ReviewCommentsPanelProps {
  designId: string;
  canComment: boolean;
  currentUserEmail?: string | null;
  currentTargetId?: string | null;
  /** Canvas order. Threads on any other id are listed under the board group. */
  screens: ReviewCommentsPanelScreen[];
  signInHref?: string;
  onSelectThread?: (thread: ReviewThread) => void;
  /** Omit where the comment tool cannot be started; the New thread button is then hidden. */
  onNewThread?: () => void;
  activeThreadId?: string | null;
  className?: string;
}

export type ReviewThreadSort = "date" | "unread";

export interface ReviewThreadGroup {
  /** Null for board-level threads, which are listed last. */
  screen: ReviewCommentsPanelScreen | null;
  threads: ReviewThread[];
}

export function ReviewCommentsPanel({
  designId,
  canComment,
  currentUserEmail,
  currentTargetId,
  screens,
  signInHref,
  onSelectThread,
  onNewThread,
  activeThreadId,
  className,
}: ReviewCommentsPanelProps) {
  const t = useT();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [onlyCurrentPage, setOnlyCurrentPage] = useState(false);
  const [sortBy, setSortBy] = useState<ReviewThreadSort>("date");
  const baseId = useId();
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const filtersActive =
    showResolved ||
    onlyMine ||
    onlyUnread ||
    onlyCurrentPage ||
    sortBy !== "date";
  const setUnread = useSetReviewThreadUnread();
  const setUnreadBulk = useSetReviewThreadsUnread();
  const reviewState = useReviewComments({
    resourceType: "design",
    resourceId: designId,
    includeResolved: true,
    newestFirst: true,
    limit: 500,
  });
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
  const threads = useMemo(
    () => buildReviewThreads(reviewState.data?.comments ?? []),
    [reviewState.data?.comments],
  );
  const visibleThreads = useMemo(() => {
    const query = search.trim().toLowerCase();
    const pageTargetId =
      onlyCurrentPage && hasCurrentTarget ? currentTargetId : undefined;
    return threads
      .filter((thread) => showResolved || thread.root.status !== "resolved")
      .filter(
        (thread) => !onlyUnread || unreadThreadIds.has(thread.root.threadId),
      )
      .filter(
        (thread) =>
          pageTargetId === undefined ||
          (thread.root.targetId ?? null) === pageTargetId,
      )
      .filter((thread) => {
        if (!onlyMine) return true;
        if (!normalizedUserEmail) return false;
        return threadComments(thread).some(
          (comment) =>
            comment.authorEmail?.trim().toLowerCase() === normalizedUserEmail,
        );
      })
      .filter((thread) => {
        if (!query) return true;
        return threadComments(thread)
          .map((comment) => comment.body)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((left, right) =>
        compareReviewThreads(left, right, sortBy, reviewPreferences ?? {}),
      );
  }, [
    currentTargetId,
    hasCurrentTarget,
    normalizedUserEmail,
    onlyCurrentPage,
    onlyMine,
    onlyUnread,
    reviewPreferences,
    search,
    showResolved,
    sortBy,
    threads,
    unreadThreadIds,
  ]);
  const groups = useMemo(
    () => groupReviewThreadsByScreen(visibleThreads, screens),
    [screens, visibleThreads],
  );

  const markThreadRead = useCallback(
    (threadId: string) => {
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
          threadId,
          unread: false,
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
  const handleSelectThread = useCallback(
    (thread: ReviewThread) => {
      if (unreadThreadIds.has(thread.root.threadId)) {
        markThreadRead(thread.root.threadId);
      }
      onSelectThread?.(thread);
    },
    [markThreadRead, onSelectThread, unreadThreadIds],
  );
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearch("");
  }, []);
  const toggleSearch = useCallback(() => {
    if (searchOpen) closeSearch();
    else setSearchOpen(true);
  }, [closeSearch, searchOpen]);

  const loading = reviewState.isLoading;
  const failed = reviewState.isError;

  return (
    <div
      data-review-comments-panel
      className={cn(
        "design-sidebar-comments flex min-h-0 flex-1 flex-col",
        className,
      )}
    >
      {!canComment && !normalizedUserEmail && signInHref ? (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="mx-2 mt-2 min-h-[var(--design-row-height)] shrink-0"
        >
          <a href={signInHref}>{t("review.signInToComment")}</a>
        </Button>
      ) : null}

      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border py-2 pl-4 pr-2">
        {/* `text-xs` here would be shrunk to 10px by `.design-sidebar-comments .text-xs` in global.css. */}
        <span
          role="status"
          className="min-w-0 flex-1 truncate text-[12px] leading-4 text-muted-foreground"
        >
          {loading || failed
            ? null
            : t("review.threadsCount", { count: visibleThreads.length })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            "shrink-0 rounded-[10px]",
            searchOpen && "bg-secondary",
          )}
          ref={searchToggleRef}
          aria-label={t("review.search")}
          aria-pressed={searchOpen}
          onClick={toggleSearch}
        >
          <IconSearch className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="relative shrink-0 rounded-[10px]"
              aria-label={
                filtersActive
                  ? `${t("review.filter")}, ${t("review.filtersActive")}`
                  : t("review.filter")
              }
            >
              <IconFilter className="size-4" />
              {filtersActive ? (
                <span
                  aria-hidden="true"
                  className="absolute end-1.5 top-1.5 size-1.5 rounded-full bg-primary"
                />
              ) : null}
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
            {canSetThreadPreferences && unreadThreadIds.size ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={markAllRead}>
                  {t("review.markAllRead")}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {onNewThread ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 rounded-[10px]"
            aria-label={t("review.newThread")}
            disabled={!canComment}
            onClick={onNewThread}
          >
            <IconPlus className="size-4" />
          </Button>
        ) : null}
      </div>

      {searchOpen ? (
        <div className="relative shrink-0 border-b border-border px-2 py-2">
          <IconSearch className="pointer-events-none absolute start-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            size="sm"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              closeSearch();
              // The input unmounts on close; keep focus on the control that opened it.
              searchToggleRef.current?.focus();
            }}
            placeholder={t("review.search")}
            aria-label={t("review.search")}
            className="ps-7 text-xs"
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {failed ? (
          <p
            role="alert"
            className="px-4 py-6 text-center text-xs text-destructive"
          >
            {t("common.genericError")}
          </p>
        ) : loading ? (
          <ReviewThreadsSkeleton label={t("review.loading")} />
        ) : groups.length ? (
          groups.map((group, index) => {
            const headingId = `${baseId}-group-${index}`;
            return (
              <div
                key={group.screen?.id ?? "board"}
                role="group"
                aria-labelledby={headingId}
                className={cn(index > 0 && "border-t border-border")}
              >
                <div className="flex h-10 min-w-0 items-center gap-1 px-4 text-[11px] leading-4 tracking-[0.055px]">
                  <h3
                    id={headingId}
                    className="min-w-0 truncate font-[550] text-foreground"
                  >
                    {group.screen?.name ?? t("review.boardGroup")}
                  </h3>
                  {group.screen?.route ? (
                    <span className="min-w-0 truncate text-muted-foreground">
                      {group.screen.route}
                    </span>
                  ) : null}
                </div>
                <ul className="m-0 list-none p-0">
                  {group.threads.map((thread) => (
                    <li key={thread.root.threadId}>
                      <ReviewThreadRow
                        thread={thread}
                        unread={unreadThreadIds.has(thread.root.threadId)}
                        active={activeThreadId === thread.root.threadId}
                        onSelect={handleSelectThread}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        ) : (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t("review.emptyState")}
          </p>
        )}
      </div>
    </div>
  );
}

function ReviewThreadsSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex h-8 items-center gap-2 px-4">
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-10 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function threadComments(thread: ReviewThread): ReviewComment[] {
  return [thread.root, ...thread.replies];
}

/**
 * Threads grouped by the screen they target, in canvas order. Groups with no
 * threads are left out. A thread whose target is not one of `screens` is a
 * board-level thread, so it lands in the trailing board group.
 */
export function groupReviewThreadsByScreen(
  threads: readonly ReviewThread[],
  screens: readonly ReviewCommentsPanelScreen[],
): ReviewThreadGroup[] {
  const screenById = new Map(screens.map((screen) => [screen.id, screen]));
  const threadsByScreenId = new Map<string, ReviewThread[]>();
  const boardThreads: ReviewThread[] = [];
  for (const thread of threads) {
    const targetId = thread.root.targetId;
    if (targetId && screenById.has(targetId)) {
      const bucket = threadsByScreenId.get(targetId) ?? [];
      bucket.push(thread);
      threadsByScreenId.set(targetId, bucket);
    } else {
      boardThreads.push(thread);
    }
  }
  const groups: ReviewThreadGroup[] = [];
  for (const screen of screens) {
    const screenThreads = threadsByScreenId.get(screen.id);
    if (screenThreads) groups.push({ screen, threads: screenThreads });
  }
  if (boardThreads.length) groups.push({ screen: null, threads: boardThreads });
  return groups;
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
