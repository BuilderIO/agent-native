import { useActionQuery, useDbSync } from "@agent-native/core/client/hooks";
import { IconAlertCircle } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";

import { Button } from "@/components/ui/button";
import { TAB_ID } from "@/lib/tab-id";
import { cn } from "@/lib/utils";

import { useItemsStrings } from "../items-strings";
import { classifyReadError, type ReadFailure } from "./read-failure";
import type { WorkflowListData, WorkflowOption } from "./read-types";

/**
 * Ticks so "5 min ago" stays true while a view stays open. One timer per
 * view, not one per row.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

// The Factory tabs sit behind sign-in. A route outside them never opens the
// transport.
function isPrivateFactoryRoute(pathname: string): boolean {
  return pathname === "/factory" || pathname.startsWith("/factory/");
}

/**
 * Items, runs, and hand-offs change while a view is open without this user
 * doing anything: a schedule ticks, a teammate dismisses an item. The view
 * opts in to the shared sync transport for that reason and nothing else; it
 * pauses while the tab is hidden.
 */
export function useWorkflowReadSync(): void {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  useDbSync({
    queryClient,
    ignoreSource: TAB_ID,
    pauseWhenHidden: true,
    realtime: isPrivateFactoryRoute(pathname)
      ? {
          reason:
            "workflow runs, items, and hand-offs change on a schedule and from teammates while this view is open",
        }
      : undefined,
  });
}

export function useWorkflowOptions(factoryId: string): {
  options: WorkflowOption[];
  isLoading: boolean;
  failure: ReadFailure | null;
  refetch: () => void;
} {
  const query = useActionQuery<WorkflowListData>("list-factory-workflows", {
    factoryId,
    limit: 50,
  });
  const options = useMemo(
    () =>
      (query.data?.workflows ?? []).map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
      })),
    [query.data],
  );
  return {
    options,
    isLoading: query.isPending,
    failure: query.isError ? classifyReadError(query.error) : null,
    refetch: () => void query.refetch(),
  };
}

export function ReadErrorState({
  failure,
  action,
  onRetry,
  onStartOver,
  className,
}: {
  failure: ReadFailure;
  /** The action that failed, named when the route is missing. */
  action?: string;
  onRetry?: () => void;
  onStartOver?: () => void;
  className?: string;
}) {
  const s = useItemsStrings();

  const detail =
    failure.kind === "action_unavailable"
      ? s.error.detail.action_unavailable(action ?? "this action")
      : failure.kind === "bad_cursor"
        ? s.error.detail.bad_cursor
        : failure.kind === "stored_record_unreadable"
          ? (failure.message ?? s.error.detail.stored_record_unreadable)
          : failure.message;
  const showRetry =
    onRetry !== undefined &&
    failure.kind !== "bad_cursor" &&
    failure.kind !== "workflow_item_not_found" &&
    failure.kind !== "workflow_node_not_found" &&
    failure.kind !== "workflow_not_found" &&
    failure.kind !== "factory_not_found";
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3",
        className,
      )}
    >
      <IconAlertCircle
        className="mt-0.5 size-4 shrink-0 text-destructive"
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium text-foreground">
          {s.error.title[failure.kind]}
        </p>
        {detail ? (
          <p className="break-words text-sm text-muted-foreground">{detail}</p>
        ) : null}
        {failure.code && failure.kind === "generic" ? (
          <p className="font-mono text-xs text-muted-foreground">
            {s.error.codeLabel(failure.code)}
          </p>
        ) : null}
      </div>
      {failure.kind === "bad_cursor" && onStartOver ? (
        <Button variant="outline" size="sm" onClick={onStartOver}>
          {s.error.startOver}
        </Button>
      ) : showRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {s.error.retry}
        </Button>
      ) : null}
    </div>
  );
}

interface PageShape {
  hasMore: boolean;
  nextCursor: string | null;
}

interface PageReport {
  count: number;
  hasMore: boolean;
}

interface PagesShared<TPage extends PageShape, TCarry> {
  action: string;
  params: Record<string, unknown>;
  countOf: (page: TPage) => number;
  renderPage: (
    page: TPage,
    carry: TCarry | undefined,
  ) => { node: ReactNode; carry: TCarry | undefined };
  skeleton: ReactNode;
  loadMoreLabel: string;
  autoLimit: number;
  report: (index: number, report: PageReport) => void;
  restart: () => void;
}

/**
 * A list read one page at a time. Each page is its own action query, so a
 * refresh refetches every page already open and a failure shows on the page
 * that failed. `renderPage` returns what to draw and a `carry` handed to the
 * next page (a day heading needs to know the previous page's last day).
 *
 * The next page opens when its sentinel scrolls into view, or when the
 * viewer clicks. A page can come back short while `hasMore` is true, so a
 * sentinel that is still in view opens the next one too, but only
 * `autoLimit` pages in a row without a click: a feed that keeps returning
 * short pages stops there and offers the button.
 */
export function ReadPages<TPage extends PageShape, TCarry = undefined>({
  action,
  params,
  countOf,
  renderPage,
  skeleton,
  empty,
  loadMoreLabel,
  autoLimit = 4,
}: {
  action: string;
  params: Record<string, unknown>;
  countOf: (page: TPage) => number;
  renderPage: PagesShared<TPage, TCarry>["renderPage"];
  skeleton: ReactNode;
  /** Shown when every page came back and none held anything. */
  empty: ReactNode;
  loadMoreLabel: string;
  autoLimit?: number;
}) {
  const [reports, setReports] = useState<Record<number, PageReport>>({});
  const [restartKey, setRestartKey] = useState(0);
  const report = useMemo(
    () => (index: number, next: PageReport) =>
      setReports((previous) => {
        const current = previous[index];
        return current?.count === next.count && current.hasMore === next.hasMore
          ? previous
          : { ...previous, [index]: next };
      }),
    [],
  );
  const shared: PagesShared<TPage, TCarry> = {
    action,
    params,
    countOf,
    renderPage,
    skeleton,
    loadMoreLabel,
    autoLimit,
    report,
    restart: () => {
      setReports({});
      setRestartKey((key) => key + 1);
    },
  };
  const indexes = Object.keys(reports).map(Number);
  const last = indexes.length === 0 ? -1 : Math.max(...indexes);
  const everyPageIn = last >= 0 && indexes.length === last + 1;
  const settled = everyPageIn && reports[last]?.hasMore === false;
  const total = indexes.reduce((sum, i) => sum + (reports[i]?.count ?? 0), 0);
  return (
    <>
      <PageChain
        key={restartKey}
        shared={shared}
        index={0}
        cursor={undefined}
        carry={undefined}
        autoDepth={0}
      />
      {settled && total === 0 ? empty : null}
    </>
  );
}

function PageChain<TPage extends PageShape, TCarry>({
  shared,
  index,
  cursor,
  carry,
  autoDepth,
}: {
  shared: PagesShared<TPage, TCarry>;
  index: number;
  cursor: string | undefined;
  carry: TCarry | undefined;
  autoDepth: number;
}) {
  const s = useItemsStrings();

  const { action, params, countOf, renderPage, report } = shared;
  const query = useActionQuery<TPage>(
    action,
    cursor === undefined ? params : { ...params, cursor },
  );
  const page = query.data;
  const promised = page?.hasMore === true;
  const dangling = promised && page.nextCursor === null;

  useEffect(() => {
    if (!page) return;
    report(index, { count: countOf(page), hasMore: promised && !dangling });
  }, [page, index, countOf, report, promised, dangling]);

  if (!page) {
    if (query.isError) {
      const failure = classifyReadError(query.error);
      return (
        <ReadErrorState
          failure={failure}
          action={action}
          onRetry={() => void query.refetch()}
          onStartOver={shared.restart}
          className="my-3"
        />
      );
    }
    return <>{shared.skeleton}</>;
  }

  const drawn = renderPage(page, carry);
  return (
    <>
      {query.isError ? (
        <ReadErrorState
          failure={classifyReadError(query.error)}
          action={action}
          onRetry={() => void query.refetch()}
          onStartOver={shared.restart}
          className="my-3"
        />
      ) : null}
      {drawn.node}
      {dangling ? (
        <ReadErrorState
          failure={{
            kind: "generic",
            code: null,
            status: null,
            message: s.error.dangling,
          }}
          className="my-3"
        />
      ) : promised && page.nextCursor !== null ? (
        <LoadMore
          shared={shared}
          index={index + 1}
          cursor={page.nextCursor}
          carry={drawn.carry}
          autoDepth={autoDepth}
        />
      ) : null}
    </>
  );
}

function LoadMore<TPage extends PageShape, TCarry>({
  shared,
  index,
  cursor,
  carry,
  autoDepth,
}: {
  shared: PagesShared<TPage, TCarry>;
  index: number;
  cursor: string;
  carry: TCarry | undefined;
  autoDepth: number;
}) {
  const [opened, setOpened] = useState<"auto" | "user" | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const capped = autoDepth >= shared.autoLimit;

  useEffect(() => {
    if (opened || capped) return;
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setOpened("auto");
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [opened, capped]);

  if (opened) {
    return (
      <PageChain
        shared={shared}
        index={index}
        cursor={cursor}
        carry={carry}
        autoDepth={opened === "auto" ? autoDepth + 1 : 0}
      />
    );
  }
  return (
    <div ref={sentinel} className="flex justify-center py-3">
      <Button variant="ghost" size="sm" onClick={() => setOpened("user")}>
        {shared.loadMoreLabel}
      </Button>
    </div>
  );
}
