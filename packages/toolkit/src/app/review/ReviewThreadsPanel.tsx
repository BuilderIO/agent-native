import {
  useReviewComments,
  useSetReviewThreadUnread,
  useSetReviewThreadsUnread,
  type ListReviewCommentsParams,
} from "@agent-native/core/client/review/use-review";
import type {
  ReviewComment,
  ReviewThreadPreference,
} from "@agent-native/core/review/types";
import { Button } from "@agent-native/toolkit/ui/button";
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
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Input } from "@agent-native/toolkit/ui/input";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { cn } from "@agent-native/toolkit/utils";
import { IconFilter, IconPlus, IconSearch } from "@tabler/icons-react";
import {
  Fragment,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { buildReviewThreads, type ReviewThread } from "./ReviewThreadPanel.js";
import {
  ReviewThreadRow,
  type ReviewThreadRowLabels,
} from "./ReviewThreadRow.js";

/** A place threads are grouped under, such as a screen or a slide, in order. */
export interface ReviewThreadGroupTarget {
  id: string;
  name: string;
  /** Muted text after the name, such as a route. */
  detail?: string | null | undefined;
}

export interface ReviewThreadGroup {
  /** Null for threads on no listed target, which are listed last. */
  target: ReviewThreadGroupTarget | null;
  threads: ReviewThread[];
}

export type ReviewThreadSort = "date" | "unread";

export interface ReviewThreadsPanelLabels extends ReviewThreadRowLabels {
  threadsCount: (count: number) => string;
  search: string;
  filter: string;
  filtersActive: string;
  showResolved: string;
  onlyYours: string;
  /** The filter that keeps only the current target's threads. */
  currentTarget: string;
  sort: string;
  sortByDate: string;
  sortByUnread: string;
  markAllRead: string;
  newThread: string;
  loading: string;
  emptyState: string;
  error: string;
  /** Heading for threads on no listed target. */
  ungrouped: string;
}

export interface ReviewThreadsPanelProps {
  /** The review query; share it with the canvas so both read one cache. */
  query: ListReviewCommentsParams;
  canComment: boolean;
  currentUserEmail?: string | null | undefined;
  /** The target the viewer is on; enables the current-target filter. */
  currentTargetId?: string | null | undefined;
  /** Targets in display order. */
  targets: readonly ReviewThreadGroupTarget[];
  /** The target a thread belongs to; defaults to its `targetId`. */
  targetIdForThread?: ((thread: ReviewThread) => string | null) | undefined;
  labels: ReviewThreadsPanelLabels;
  onSelectThread?: ((thread: ReviewThread) => void) | undefined;
  /** Omit where a new thread cannot be started; the + button is then hidden. */
  onNewThread?: (() => void) | undefined;
  activeThreadId?: string | null | undefined;
  /** Shown under the active row, for a thread with nowhere else to open. */
  renderActiveThread?: ((thread: ReviewThread) => ReactNode) | undefined;
  /** Above the header, such as a sign-in prompt. */
  banner?: ReactNode;
  /** After the header's buttons, such as a close button. */
  headerActions?: ReactNode;
  onError?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * Every review thread on a resource as one line each, grouped by the target it
 * is on, with search, filters, sort, unread state and a new-thread button.
 */
export function ReviewThreadsPanel({
  query,
  canComment,
  currentUserEmail,
  currentTargetId,
  targets,
  targetIdForThread,
  labels,
  onSelectThread,
  onNewThread,
  activeThreadId,
  renderActiveThread,
  banner,
  headerActions,
  onError,
  className,
}: ReviewThreadsPanelProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [onlyCurrentTarget, setOnlyCurrentTarget] = useState(false);
  const [sortBy, setSortBy] = useState<ReviewThreadSort>("date");
  const baseId = useId();
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const filtersActive =
    showResolved ||
    onlyMine ||
    onlyUnread ||
    onlyCurrentTarget ||
    sortBy !== "date";
  const setUnread = useSetReviewThreadUnread();
  const setUnreadBulk = useSetReviewThreadsUnread();
  const reviewState = useReviewComments(query);
  const hasCurrentTarget = currentTargetId !== undefined;
  const reviewPreferences = reviewState.data?.discussion.threadPreferences;
  const comments = reviewState.data?.comments;
  const unreadThreadIds = useMemo(
    () => getUnreadReviewThreadIds(comments ?? [], reviewPreferences ?? {}),
    [comments, reviewPreferences],
  );
  const canSetThreadPreferences = Boolean(
    reviewState.data?.discussion.canSetThreadPreferences,
  );
  const normalizedUserEmail = currentUserEmail?.trim().toLowerCase() || null;
  const threads = useMemo(() => buildReviewThreads(comments ?? []), [comments]);
  const targetOf = useCallback(
    (thread: ReviewThread) =>
      targetIdForThread ? targetIdForThread(thread) : thread.root.targetId,
    [targetIdForThread],
  );
  const visibleThreads = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const targetFilter =
      onlyCurrentTarget && hasCurrentTarget ? currentTargetId : undefined;
    return threads
      .filter(
        (thread) =>
          showResolved ||
          thread.root.status !== "resolved" ||
          thread.root.threadId === activeThreadId,
      )
      .filter(
        (thread) => !onlyUnread || unreadThreadIds.has(thread.root.threadId),
      )
      .filter(
        (thread) =>
          targetFilter === undefined ||
          (targetOf(thread) ?? null) === targetFilter,
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
        if (!needle) return true;
        return threadComments(thread)
          .map((comment) => comment.body)
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((left, right) =>
        compareReviewThreads(left, right, sortBy, reviewPreferences ?? {}),
      );
  }, [
    activeThreadId,
    currentTargetId,
    hasCurrentTarget,
    normalizedUserEmail,
    onlyCurrentTarget,
    onlyMine,
    onlyUnread,
    reviewPreferences,
    search,
    showResolved,
    sortBy,
    targetOf,
    threads,
    unreadThreadIds,
  ]);
  const groups = useMemo(
    () => groupReviewThreadsByTarget(visibleThreads, targets, targetOf),
    [targetOf, targets, visibleThreads],
  );

  const pendingPreference = setUnread.isPending || setUnreadBulk.isPending;
  const markThreadRead = useCallback(
    (threadId: string) => {
      if (!canSetThreadPreferences || pendingPreference) return;
      setUnread.mutate(
        {
          resourceType: query.resourceType,
          resourceId: query.resourceId,
          threadId,
          unread: false,
        },
        onError ? { onError } : undefined,
      );
    },
    [
      canSetThreadPreferences,
      onError,
      pendingPreference,
      query.resourceId,
      query.resourceType,
      setUnread,
    ],
  );
  const markAllRead = useCallback(() => {
    if (
      !canSetThreadPreferences ||
      pendingPreference ||
      unreadThreadIds.size === 0
    )
      return;
    setUnreadBulk.mutate(
      {
        resourceType: query.resourceType,
        resourceId: query.resourceId,
        threadIds: [...unreadThreadIds],
        unread: false,
      },
      onError ? { onError } : undefined,
    );
  }, [
    canSetThreadPreferences,
    onError,
    pendingPreference,
    query.resourceId,
    query.resourceType,
    setUnreadBulk,
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

  const loading = reviewState.isLoading;
  const failed = reviewState.isError;

  return (
    <div
      data-review-threads-panel
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      {banner}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border py-2 pl-4 pr-2">
        <span
          role="status"
          className="min-w-0 flex-1 truncate text-[12px] leading-4 text-muted-foreground"
        >
          {loading || failed
            ? null
            : labels.threadsCount(visibleThreads.length)}
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
          aria-label={labels.search}
          aria-pressed={searchOpen}
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
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
                  ? `${labels.filter}, ${labels.filtersActive}`
                  : labels.filter
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
            <DropdownMenuLabel>{labels.filter}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={showResolved}
              onCheckedChange={setShowResolved}
            >
              {labels.showResolved}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={onlyMine}
              onCheckedChange={setOnlyMine}
              disabled={!normalizedUserEmail}
            >
              {labels.onlyYours}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={onlyUnread}
              onCheckedChange={setOnlyUnread}
              disabled={!canSetThreadPreferences}
            >
              {labels.unread}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={onlyCurrentTarget}
              onCheckedChange={setOnlyCurrentTarget}
              disabled={!hasCurrentTarget}
            >
              {labels.currentTarget}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{labels.sort}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sortBy}
              onValueChange={(value) => setSortBy(value as ReviewThreadSort)}
            >
              <DropdownMenuRadioItem value="date">
                {labels.sortByDate}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="unread">
                {labels.sortByUnread}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {canSetThreadPreferences && unreadThreadIds.size ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={markAllRead}>
                  {labels.markAllRead}
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
            aria-label={labels.newThread}
            disabled={!canComment}
            onClick={onNewThread}
          >
            <IconPlus className="size-4" />
          </Button>
        ) : null}
        {headerActions}
      </div>

      {searchOpen ? (
        <div className="relative shrink-0 border-b border-border px-2 py-2">
          <IconSearch className="pointer-events-none absolute start-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              closeSearch();
              // The input unmounts on close; keep focus on the control that opened it.
              searchToggleRef.current?.focus();
            }}
            placeholder={labels.search}
            aria-label={labels.search}
            className="h-7 ps-7 text-xs"
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {failed ? (
          <p
            role="alert"
            className="px-4 py-6 text-center text-xs text-destructive"
          >
            {labels.error}
          </p>
        ) : loading ? (
          <ReviewThreadsSkeleton label={labels.loading} />
        ) : groups.length ? (
          groups.map((group, index) => {
            const headingId = `${baseId}-group-${index}`;
            return (
              <div
                key={group.target?.id ?? "ungrouped"}
                role="group"
                aria-labelledby={headingId}
                className={cn(index > 0 && "border-t border-border")}
              >
                <div className="flex h-10 min-w-0 items-center gap-1 px-4 text-[11px] leading-4 tracking-[0.055px]">
                  <h3
                    id={headingId}
                    className="min-w-0 truncate font-[550] text-foreground"
                  >
                    {group.target?.name ?? labels.ungrouped}
                  </h3>
                  {group.target?.detail ? (
                    <span className="min-w-0 truncate text-muted-foreground">
                      {group.target.detail}
                    </span>
                  ) : null}
                </div>
                <ul className="m-0 list-none p-0">
                  {group.threads.map((thread) => {
                    const active = activeThreadId === thread.root.threadId;
                    return (
                      <Fragment key={thread.root.threadId}>
                        <li>
                          <ReviewThreadRow
                            thread={thread}
                            unread={unreadThreadIds.has(thread.root.threadId)}
                            active={active}
                            labels={labels}
                            onSelect={handleSelectThread}
                          />
                        </li>
                        {active && renderActiveThread ? (
                          <li className="px-2 pb-2">
                            {renderActiveThread(thread)}
                          </li>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </ul>
              </div>
            );
          })
        ) : (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {labels.emptyState}
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
 * Threads grouped by their target, in target order. Targets with no threads
 * are left out; threads on no listed target land in a trailing group.
 */
export function groupReviewThreadsByTarget(
  threads: readonly ReviewThread[],
  targets: readonly ReviewThreadGroupTarget[],
  targetOf: (thread: ReviewThread) => string | null = (thread) =>
    thread.root.targetId,
): ReviewThreadGroup[] {
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const threadsByTarget = new Map<string, ReviewThread[]>();
  const ungrouped: ReviewThread[] = [];
  for (const thread of threads) {
    const targetId = targetOf(thread);
    if (targetId && targetById.has(targetId)) {
      const bucket = threadsByTarget.get(targetId) ?? [];
      bucket.push(thread);
      threadsByTarget.set(targetId, bucket);
    } else {
      ungrouped.push(thread);
    }
  }
  const groups: ReviewThreadGroup[] = [];
  for (const target of targets) {
    const targetThreads = threadsByTarget.get(target.id);
    if (targetThreads) groups.push({ target, threads: targetThreads });
  }
  if (ungrouped.length) groups.push({ target: null, threads: ungrouped });
  return groups;
}

export function getUnreadReviewThreadIds(
  comments: readonly ReviewComment[],
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
