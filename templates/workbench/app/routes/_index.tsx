import { useEffect, useMemo, useState } from "react";
import {
  IconFilter,
  IconAdjustments,
  IconArrowsSort,
  IconRefresh,
} from "@tabler/icons-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { RoomHeader } from "@/components/room-header";
import { PrCard } from "@/components/queue/pr-card";
import { RunCard } from "@/components/queue/run-card";
import { ErrorCard } from "@/components/queue/error-card";
import { QueueEmptyState } from "@/components/queue/queue-empty-state";
import {
  useAttentionQueue,
  useQueueCardActions,
  type QueueCard as QueueCardData,
  type QueueCardType,
} from "@/hooks/use-queue";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";

export function meta() {
  return [
    { title: "Workbench — Attention Queue" },
    {
      name: "description",
      content:
        "A unified inbox for PRs, agent runs, and errors that need your attention.",
    },
  ];
}

const TYPE_FILTERS: ReadonlyArray<{ id: QueueCardType; label: string }> = [
  { id: "pr-to-review", label: "PRs to review" },
  { id: "my-pr-status-change", label: "My PR status updates" },
  { id: "my-pr-ci-failure", label: "My PR CI failures" },
  { id: "run-needs-input", label: "Agent runs" },
  { id: "error-new", label: "New errors" },
];

const SORT_OPTIONS = [
  { id: "priority", label: "Priority (default)" },
  { id: "oldest", label: "Oldest first" },
  { id: "newest", label: "Newest first" },
  { id: "risk", label: "Risk" },
] as const;
type SortMode = (typeof SORT_OPTIONS)[number]["id"];

const RISK_RANK: Record<NonNullable<QueueCardData["meta"]["risk"]>, number> = {
  high: 3,
  med: 2,
  low: 1,
};

/**
 * Attention Queue — the Workbench home. Aggregates PRs, runs, and (later)
 * errors into a unified ranked inbox, with type/repo filters, sort, and
 * inbox-zero gestures (snooze / dismiss / done / mute) wired through
 * `use-queue` so each click feels instant.
 */
export default function QueueIndex() {
  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } =
    useAttentionQueue();
  const reposQuery = useReposCount();

  // Filter state lives in the URL-less local state for v1 — keep the page
  // mountable without a router refactor. Defaults: show everything.
  const [typeFilters, setTypeFilters] = useState<Set<QueueCardType>>(
    () => new Set(TYPE_FILTERS.map((t) => t.id)),
  );
  const [repoFilter, setRepoFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortMode>("priority");

  // Defensive guards: `data` can be undefined on first render and the
  // server contract may evolve. Default every field so the page renders
  // even if the action returns a partial payload.
  const cards = data?.cards ?? [];
  const mutedCardTypes = data?.state?.mutedCardTypes ?? [];
  const githubConnected = data?.state?.githubConnected ?? false;
  const hasRepos = (reposQuery.data?.count ?? 0) > 0;

  // Build the repo filter dropdown from the cards we received — keeps it
  // accurate to "what's actually in your queue today" without a second fetch.
  const repoOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const c of cards) {
      if (c.pr) {
        const slug = `${c.pr.owner}/${c.pr.repo}`;
        seen.add(slug);
      }
    }
    return Array.from(seen).sort();
  }, [cards]);

  const filtered = useMemo(() => {
    let list = cards.filter((c) => typeFilters.has(c.type));
    if (repoFilter !== "all") {
      list = list.filter(
        (c) => c.pr && `${c.pr.owner}/${c.pr.repo}` === repoFilter,
      );
    }
    if (sort === "oldest") {
      list = [...list].sort((a, b) => b.meta.ageSeconds - a.meta.ageSeconds);
    } else if (sort === "newest") {
      list = [...list].sort((a, b) => a.meta.ageSeconds - b.meta.ageSeconds);
    } else if (sort === "risk") {
      list = [...list].sort(
        (a, b) =>
          (b.meta.risk ? RISK_RANK[b.meta.risk] : 0) -
          (a.meta.risk ? RISK_RANK[a.meta.risk] : 0),
      );
    }
    // "priority" keeps the server-side ranking.
    return list;
  }, [cards, typeFilters, repoFilter, sort]);

  const totalCount = data?.counts?.total ?? 0;
  const hasFilteredOut =
    filtered.length === 0 &&
    totalCount > 0 &&
    (typeFilters.size < TYPE_FILTERS.length || repoFilter !== "all");

  const showEmptyState = !isLoading && totalCount === 0 && !hasFilteredOut;

  return (
    <div className="flex h-full flex-col">
      <RoomHeader
        title="Attention Queue"
        subtitle={
          isLoading
            ? "Loading…"
            : totalCount === 0
              ? "Nothing needs your attention right now."
              : totalCount === 1
                ? "1 item needs your attention"
                : `${totalCount} items need your attention`
        }
        meta={
          totalCount > 0 ? (
            <>
              <Badge variant="secondary" className="font-mono">
                {filtered.length}/{totalCount}
              </Badge>
              <LastUpdatedLabel updatedAt={dataUpdatedAt} />
            </>
          ) : undefined
        }
        right={
          <>
            <FilterDropdown
              typeFilters={typeFilters}
              onTypeFiltersChange={setTypeFilters}
              repoFilter={repoFilter}
              onRepoFilterChange={setRepoFilter}
              repoOptions={repoOptions}
            />
            <SortDropdown sort={sort} onSortChange={setSort} />
            <MutedTypesDropdown muted={mutedCardTypes} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 cursor-pointer"
                  onClick={() => refetch()}
                  aria-label="Refresh queue"
                  disabled={isFetching}
                >
                  {isFetching ? <Spinner /> : <IconRefresh size={16} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </>
        }
      />
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-3">
          {error ? (
            <ErrorBanner
              message={
                error instanceof Error
                  ? error.message
                  : "Could not load the queue."
              }
              onRetry={() => refetch()}
            />
          ) : null}
          {isLoading ? (
            <QueueSkeleton />
          ) : showEmptyState ? (
            <QueueEmptyState
              githubConnected={githubConnected}
              hasRepos={hasRepos}
            />
          ) : hasFilteredOut ? (
            <NoMatchesEmpty
              onClear={() => {
                setTypeFilters(new Set(TYPE_FILTERS.map((t) => t.id)));
                setRepoFilter("all");
              }}
            />
          ) : (
            filtered.map((card) => <CardRouter key={card.id} card={card} />)
          )}
          {data?.diagnostics && data.diagnostics.length > 0 ? (
            <Diagnostics diagnostics={data.diagnostics} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CardRouter({ card }: { card: QueueCardData }) {
  const actions = useQueueCardActions(card);
  switch (card.type) {
    case "pr-to-review":
    case "my-pr-status-change":
    case "my-pr-ci-failure":
      return <PrCard card={card} {...actions} />;
    case "run-needs-input":
      return <RunCard card={card} {...actions} />;
    case "error-new":
      return <ErrorCard card={card} {...actions} />;
    default: {
      // Future-proof: render an unknown card type as a plain PR-style
      // shell rather than dropping it.
      return <PrCard card={card} {...actions} />;
    }
  }
}

function FilterDropdown({
  typeFilters,
  onTypeFiltersChange,
  repoFilter,
  onRepoFilterChange,
  repoOptions,
}: {
  typeFilters: Set<QueueCardType>;
  onTypeFiltersChange: (next: Set<QueueCardType>) => void;
  repoFilter: string;
  onRepoFilterChange: (next: string) => void;
  repoOptions: string[];
}) {
  const activeCount =
    (typeFilters.size < TYPE_FILTERS.length ? 1 : 0) +
    (repoFilter !== "all" ? 1 : 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="cursor-pointer">
          <IconFilter size={14} />
          Filter
          {activeCount > 0 ? (
            <Badge
              variant="secondary"
              className="ml-1 h-4 min-w-4 rounded-full px-1 text-[10px]"
            >
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Card types</DropdownMenuLabel>
        {TYPE_FILTERS.map((t) => (
          <DropdownMenuCheckboxItem
            key={t.id}
            checked={typeFilters.has(t.id)}
            onCheckedChange={(checked) => {
              const next = new Set(typeFilters);
              if (checked) next.add(t.id);
              else next.delete(t.id);
              onTypeFiltersChange(next);
            }}
            className="cursor-pointer"
          >
            {t.label}
          </DropdownMenuCheckboxItem>
        ))}
        {repoOptions.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Repository</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={repoFilter}
              onValueChange={onRepoFilterChange}
            >
              <DropdownMenuRadioItem value="all" className="cursor-pointer">
                All repos
              </DropdownMenuRadioItem>
              {repoOptions.map((slug) => (
                <DropdownMenuRadioItem
                  key={slug}
                  value={slug}
                  className="cursor-pointer font-mono text-xs"
                >
                  {slug}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortDropdown({
  sort,
  onSortChange,
}: {
  sort: SortMode;
  onSortChange: (next: SortMode) => void;
}) {
  const current = SORT_OPTIONS.find((o) => o.id === sort);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="cursor-pointer">
          <IconArrowsSort size={14} />
          <span className="hidden sm:inline">
            Sort
            {current && sort !== "priority" ? (
              <span className="ml-1 text-muted-foreground">
                · {current.label.split(" ")[0]}
              </span>
            ) : null}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sort}
          onValueChange={(v) => onSortChange(v as SortMode)}
        >
          {SORT_OPTIONS.map((opt) => (
            <DropdownMenuRadioItem
              key={opt.id}
              value={opt.id}
              className="cursor-pointer"
            >
              {opt.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MutedTypesDropdown({ muted }: { muted: QueueCardType[] }) {
  // Surface the list of muted types so the user can unmute without leaving
  // the page. Wired through `useMuteCardType({ muted: false })` per row.
  const queryClient = useQueryClient();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative size-8 cursor-pointer"
              aria-label={
                muted.length === 0
                  ? "Mute settings"
                  : `Muted card types (${muted.length})`
              }
            >
              <IconAdjustments size={16} />
              {muted.length > 0 ? (
                <span
                  aria-hidden
                  className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-amber-500"
                />
              ) : null}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {muted.length === 0
            ? "Muted card types"
            : `${muted.length} muted card type${muted.length === 1 ? "" : "s"}`}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Muted card types</DropdownMenuLabel>
        {muted.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            Nothing muted. Mute a card type from any card's overflow menu.
          </div>
        ) : (
          muted.map((type) => (
            <UnmuteRow
              key={type}
              type={type}
              onDone={() =>
                queryClient.invalidateQueries({
                  queryKey: ["action", "list-attention-queue"],
                })
              }
            />
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UnmuteRow({
  type,
  onDone,
}: {
  type: QueueCardType;
  onDone: () => void;
}) {
  // Use a tiny local mutation so we don't reach for the full `useMuteCardType`
  // optimistic flow — we just want a fire-and-forget unmute + cache refresh.
  const label = TYPE_FILTERS.find((t) => t.id === type)?.label ?? type;
  return (
    <DropdownMenuCheckboxItem
      checked
      className="cursor-pointer"
      onCheckedChange={async (checked) => {
        if (checked) return;
        try {
          await fetch(
            agentNativePath("/_agent-native/actions/mute-card-type"),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cardType: type, muted: false }),
            },
          );
        } finally {
          onDone();
        }
      }}
    >
      {label}
    </DropdownMenuCheckboxItem>
  );
}

function NoMatchesEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <IconFilter size={18} aria-hidden />
      </div>
      <p className="text-sm font-medium text-foreground">
        No cards match your filters
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Try widening the type or repo filter.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4 cursor-pointer"
        onClick={onClear}
      >
        Clear filters
      </Button>
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <div className="min-w-0 space-y-0.5">
        <div className="font-medium">Could not load the queue</div>
        <div className="break-words text-destructive/80">{message}</div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 cursor-pointer"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}

function Diagnostics({
  diagnostics,
}: {
  diagnostics: Array<{
    source: string;
    level: "info" | "warning" | "error";
    message: string;
  }>;
}) {
  // Surface warnings sparingly — only the ones the user could act on.
  // Info-level entries from the aggregator stay hidden to avoid clutter.
  const actionable = diagnostics.filter(
    (d) => d.level === "warning" || d.level === "error",
  );
  if (actionable.length === 0) return null;
  return (
    <div className="mt-6 space-y-1 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs">
      <div className="font-medium text-foreground">Heads up</div>
      <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
        {actionable.map((d, i) => (
          <li key={i}>{d.message}</li>
        ))}
      </ul>
    </div>
  );
}

/** Skeleton rows that match the actual queue card outline. */
function QueueSkeleton() {
  return (
    <div className="space-y-3" aria-busy aria-label="Loading queue">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-card p-5 ring-1 ring-border/60"
        >
          <div className="mb-3 flex items-center gap-2">
            <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
            <div className="h-5 w-16 animate-pulse rounded-full bg-muted/70" />
            <div className="ml-auto h-7 w-16 animate-pulse rounded-md bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** "Updated 5s ago" label — re-renders every 15s so it stays accurate. */
function LastUpdatedLabel({ updatedAt }: { updatedAt: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  if (!updatedAt) return null;
  const delta = Math.max(0, Date.now() - updatedAt);
  const sec = Math.round(delta / 1000);
  let label: string;
  if (sec < 10) label = "just now";
  else if (sec < 60) label = `${sec}s ago`;
  else if (sec < 3600) label = `${Math.round(sec / 60)}m ago`;
  else label = `${Math.round(sec / 3600)}h ago`;
  return <span className="text-xs text-muted-foreground">Updated {label}</span>;
}

/**
 * The repos count is needed by the empty-state to distinguish "no GitHub
 * connection" from "no repos added yet". A small dedicated GET keeps the
 * queue payload focused.
 */
function useReposCount() {
  return useQuery<{ count: number }>({
    queryKey: ["action", "list-workbench-repos", "count"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/actions/list-workbench-repos"),
        { method: "GET", cache: "no-store" },
      );
      if (!res.ok) return { count: 0 };
      const data = (await res.json()) as
        | { repos?: unknown[]; count?: number }
        | unknown[]
        | null;
      if (Array.isArray(data)) return { count: data.length };
      if (data && typeof data === "object") {
        if (Array.isArray((data as any).repos)) {
          return { count: (data as any).repos.length };
        }
        if (typeof (data as any).count === "number") {
          return { count: (data as any).count };
        }
      }
      return { count: 0 };
    },
    staleTime: 60_000,
    retry: 1,
  });
}
