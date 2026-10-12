import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useSetReviewThreadUnread } from "@agent-native/core/client/review";
import type {
  ReviewComment,
  ReviewThreadPreference,
} from "@agent-native/core/review";
import {
  buildReviewThreads,
  type ReviewThread,
} from "@agent-native/toolkit/app/review";
import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import { parseReviewAnchor } from "@shared/review-anchor";
import { IconMessageCircle, IconPlus, IconSearch } from "@tabler/icons-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { LeftPanelHeader } from "@/components/design/editor/LeftPanelHeader";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { reviewAuthorInitials } from "@/components/visual-editor/ReviewCanvasPins";
import { prettyScreenName } from "@/lib/screen-names";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { resolveOverviewScreenFrameGeometry } from "@/pages/design-editor/selection-state";

type ScreenFrames = Record<
  string,
  ReturnType<typeof resolveOverviewScreenFrameGeometry>
>;

// Board pins carry no targetId, so their screen is whichever frame contains the
// persisted world point (or the centre of the world region). "design" is a
// deliberate board pin; "other" is an anchor that points at nothing we can place.
function resolveThreadGroupKey(
  { root }: ReviewThread,
  screenFrames: ScreenFrames,
): string {
  if (root.targetId)
    return screenFrames[root.targetId] ? root.targetId : "other";
  const parsed = parseReviewAnchor(root.anchor);
  if (!parsed) return "other";
  if (parsed.screenId && screenFrames[parsed.screenId]) return parsed.screenId;
  const { worldPoint, worldRegion } = parsed;
  const point =
    worldPoint ??
    (worldRegion
      ? {
          x: worldRegion.x + worldRegion.width / 2,
          y: worldRegion.y + worldRegion.height / 2,
        }
      : null);
  if (!point) return "design";
  for (const [screenId, frame] of Object.entries(screenFrames)) {
    if (
      point.x >= frame.x &&
      point.x <= frame.x + frame.width &&
      point.y >= frame.y &&
      point.y <= frame.y + frame.height
    ) {
      return screenId;
    }
  }
  return "design";
}

export function ReviewThreadsSidebar({
  comments,
  screens,
  canvasFrameGeometryById,
  loading,
  error,
  threadPreferences,
  canSetThreadPreferences,
  onSelectThread,
  onAddThread,
}: {
  comments: ReviewComment[];
  screens: OverviewScreen[];
  canvasFrameGeometryById: CanvasFrameGeometryById;
  loading: boolean;
  error: boolean;
  threadPreferences: Record<string, ReviewThreadPreference>;
  canSetThreadPreferences: boolean;
  onSelectThread: (thread: ReviewThread) => void;
  onAddThread?: () => void;
}) {
  const t = useT();
  const setUnread = useSetReviewThreadUnread();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const threads = useMemo(
    () =>
      buildReviewThreads(comments)
        .filter(({ root }) => root.status === "open")
        .sort(
          (left, right) =>
            new Date(right.root.createdAt).getTime() -
            new Date(left.root.createdAt).getTime(),
        ),
    [comments],
  );
  const handleSelectThread = useCallback(
    (thread: ReviewThread) => {
      if (
        canSetThreadPreferences &&
        threadPreferences[thread.root.threadId]?.unread
      ) {
        setUnread.mutate(
          {
            resourceType: "design",
            resourceId: thread.root.resourceId,
            threadId: thread.root.threadId,
            unread: false,
          },
          { onError: () => toast.error(t("common.genericError")) },
        );
      }
      onSelectThread(thread);
    },
    [canSetThreadPreferences, onSelectThread, setUnread, t, threadPreferences],
  );
  const screenFrames = useMemo<ScreenFrames>(
    () =>
      Object.fromEntries(
        screens.map((screen, screenIndex) => [
          screen.id,
          resolveOverviewScreenFrameGeometry({
            screen,
            screenIndex,
            canvasFrameGeometryById,
          }),
        ]),
      ),
    [canvasFrameGeometryById, screens],
  );
  const groups = useMemo(() => {
    const buckets = [
      {
        key: "design",
        label: { title: t("review.designBoard"), path: undefined },
        threads: [] as ReviewThread[],
      },
      ...screens.map((screen, index) => ({
        key: screen.id,
        label: {
          title: t("review.screenNumber", { count: index + 1 }),
          path: prettyScreenName(screen.filename),
        },
        threads: [] as ReviewThread[],
      })),
      {
        key: "other",
        label: { title: t("review.otherScreens"), path: undefined },
        threads: [] as ReviewThread[],
      },
    ];
    const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    const query = search.trim().toLocaleLowerCase();
    for (const thread of threads) {
      if (
        query &&
        ![thread.root.body, ...thread.replies.map((reply) => reply.body)]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)
      ) {
        continue;
      }
      bucketByKey
        .get(resolveThreadGroupKey(thread, screenFrames))
        ?.threads.push(thread);
    }
    return buckets.filter((bucket) => bucket.threads.length);
  }, [screenFrames, screens, search, t, threads]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <LeftPanelHeader
        title={
          <span className="font-normal text-muted-foreground">
            {t("review.threadCount", { count: threads.length })}
          </span>
        }
      >
        {searchOpen ? (
          <Input
            autoFocus
            size="sm"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder={t("review.search")}
            aria-label={t("review.search")}
            className="min-w-0 flex-1 text-xs"
          />
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label={t("review.search")}
          aria-expanded={searchOpen}
          onClick={() => {
            setSearchOpen((open) => !open);
            if (searchOpen) setSearch("");
          }}
        >
          <IconSearch className="size-4" />
        </Button>
        {onAddThread ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label={t("review.newComment")}
            title={t("review.newComment")}
            onClick={onAddThread}
          >
            <IconPlus className="size-4" />
          </Button>
        ) : null}
      </LeftPanelHeader>
      {error ? (
        <p role="alert" className="p-3 text-xs text-muted-foreground">
          {t("common.genericError")}
        </p>
      ) : loading ? (
        <div className="space-y-3 p-3" aria-hidden="true">
          {[0, 1, 2].map((item) => (
            <div key={item} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ) : groups.length ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.map((group) => (
            <section
              key={group.key}
              className="border-t border-border first:border-t-0"
            >
              <h4 className="flex h-10 items-center gap-1 px-4 text-[11px] leading-4">
                <span className="shrink-0 font-[550] text-foreground">
                  {group.label.title}
                </span>
                {group.label.path ? (
                  <span className="min-w-0 truncate text-muted-foreground">
                    /{group.label.path}
                  </span>
                ) : null}
              </h4>
              <div>
                {group.threads.map((thread) => (
                  <ThreadSummary
                    key={thread.root.threadId}
                    thread={thread}
                    onSelect={handleSelectThread}
                    unread={Boolean(
                      threadPreferences[thread.root.threadId]?.unread,
                    )}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          {search.trim()
            ? t("review.noThreadsFound")
            : t("review.emptyThreads")}
        </div>
      )}
    </div>
  );
}

function ThreadSummary({
  thread,
  onSelect,
  unread,
}: {
  thread: ReviewThread;
  onSelect: (thread: ReviewThread) => void;
  unread: boolean;
}) {
  const t = useT();
  const formatters = useFormatters();
  const { formatNumber } = formatters;
  const author =
    thread.root.authorName?.trim() ||
    thread.root.authorEmail?.trim() ||
    t("review.reviewer");
  const avatarUrl = useAvatarUrl(thread.root.authorEmail);
  return (
    <button
      type="button"
      aria-label={`${author}: ${thread.root.body}`}
      data-review-thread-summary={thread.root.threadId}
      className="flex h-8 w-full min-w-0 items-center gap-2 px-4 text-start text-[11px] leading-4 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--design-editor-accent-color)]"
      onClick={() => onSelect(thread)}
    >
      <Avatar className="size-4 shrink-0">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback className="bg-primary text-[8px] font-medium text-primary-foreground">
          {reviewAuthorInitials(author)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate text-foreground">
        {thread.root.body}
      </span>
      {unread ? (
        <span
          aria-label={t("review.unread")}
          className="size-1.5 shrink-0 rounded-full bg-primary"
        />
      ) : null}
      {thread.replies.length ? (
        <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
          <IconMessageCircle className="size-3" />
          {formatNumber(thread.replies.length)}
        </span>
      ) : null}
      <time
        className="shrink-0 text-muted-foreground"
        dateTime={thread.root.createdAt}
      >
        {formatThreadDate(thread.root.createdAt, formatters)}
      </time>
    </button>
  );
}

const RELATIVE_UNITS = [
  [60_000, "second", 1_000],
  [3_600_000, "minute", 60_000],
  [86_400_000, "hour", 3_600_000],
  [7 * 86_400_000, "day", 86_400_000],
] as const;

function formatThreadDate(
  value: string,
  formatters: ReturnType<typeof useFormatters>,
) {
  const date = new Date(value);
  const elapsedMs = Date.now() - date.getTime();
  if (!Number.isFinite(elapsedMs)) return value;
  for (const [limit, unit, size] of RELATIVE_UNITS) {
    if (Math.abs(elapsedMs) < limit) {
      return formatters.formatRelativeTime(
        -Math.round(elapsedMs / size),
        unit,
        {
          numeric: "auto",
        },
      );
    }
  }
  return formatters.formatDate(date, { month: "short", day: "numeric" });
}
