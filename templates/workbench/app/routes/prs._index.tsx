import { useMemo, useState } from "react";
import { useActionQuery } from "@agent-native/core/client";
import {
  IconAdjustments,
  IconChecks,
  IconGitPullRequest,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Link } from "react-router";
import { RoomHeader } from "@/components/room-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
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
import { PRListCard, type PRListItem } from "@/components/pr/pr-list-card";

export function meta() {
  return [
    { title: "Workbench — Pull Requests" },
    {
      name: "description",
      content: "Multi-repo PR review queue with AI summaries and risk badges.",
    },
  ];
}

type FilterValue = "open" | "needs-review" | "drafts" | "closed" | "all";
type SortValue = "priority" | "oldest" | "newest";

const FILTER_LABELS: Record<FilterValue, string> = {
  open: "Open",
  "needs-review": "Needs review",
  drafts: "Drafts",
  closed: "Closed",
  all: "All",
};

interface ListPRsResponse {
  prs: PRListItem[];
  total: number;
  connected: boolean;
  connectHint?: string;
  connectUrl?: string;
  errors?: { repo: string; error: string }[];
}

/**
 * PR list room.
 *
 * Aggregates pull requests across every repo the user has added to
 * `workbench_repos`, with the same card shape the Attention Queue renders.
 * Filter and sort controls live in a single dropdown to keep the header
 * clean — progressive disclosure means we hide the rare options under one
 * "Filter" button rather than spreading three pickers across the toolbar.
 *
 * Multi-select is the scaffold for bulk actions ("approve all green-CI PRs
 * by trusted authors" lands in v1.1) — we render the checkbox + selection
 * count today and stub the bulk Approve button so the UX is visible.
 */
export default function PRsIndex() {
  const [filter, setFilter] = useState<FilterValue>("open");
  const [sort, setSort] = useState<SortValue>("priority");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const query = useActionQuery<ListPRsResponse>(
    "list-prs" as any,
    { filter, sort, limit: 100 } as any,
    { retry: 1 },
  );

  const cards = query.data?.prs ?? [];
  const connected = query.data?.connected ?? true;
  const selectedCount = selected.size;

  const visibleSelected = useMemo(
    () => cards.filter((card) => selected.has(card.itemKey)),
    [cards, selected],
  );

  function toggleSelect(itemKey: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function bulkApprove() {
    // v1: surface as a toast — wired in v1.1 with auto-detect of trusted
    // authors + green CI, per PRD.
    toast("Bulk approve lands in v1.1", {
      description: `${visibleSelected.length} PR(s) selected.`,
    });
  }

  return (
    <div className="flex h-full flex-col">
      <RoomHeader
        title="Pull Requests"
        subtitle="Multi-repo PR review with AI summaries, risk badges, and bulk actions."
        meta={
          query.data ? (
            <>
              <Badge variant="secondary" className="font-mono">
                {cards.length}
              </Badge>
              <span>{FILTER_LABELS[filter]}</span>
            </>
          ) : undefined
        }
        right={
          <div className="flex items-center gap-2">
            {selectedCount > 0 ? (
              <>
                <Badge variant="secondary">{selectedCount} selected</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearSelection}
                  className="cursor-pointer"
                  aria-label="Clear selection"
                >
                  <IconX size={14} aria-hidden />
                  Clear
                </Button>
                <Button
                  size="sm"
                  onClick={bulkApprove}
                  className="cursor-pointer"
                >
                  <IconChecks size={14} aria-hidden />
                  Approve selected
                </Button>
              </>
            ) : null}
            <FilterMenu
              filter={filter}
              sort={sort}
              onFilter={setFilter}
              onSort={setSort}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => query.refetch()}
                  aria-label="Refresh pull requests"
                  className="size-8 cursor-pointer"
                  disabled={query.isFetching}
                >
                  {query.isFetching ? (
                    <Spinner className="size-4" />
                  ) : (
                    <IconRefresh size={14} aria-hidden />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </div>
        }
      />
      <div className="flex-1 overflow-auto px-6 py-6">
        <Content
          query={query}
          cards={cards}
          connected={connected}
          selected={selected}
          onToggleSelect={toggleSelect}
        />
      </div>
    </div>
  );
}

function Content({
  query,
  cards,
  connected,
  selected,
  onToggleSelect,
}: {
  query: ReturnType<typeof useActionQuery<ListPRsResponse>>;
  cards: PRListItem[];
  connected: boolean;
  selected: Set<string>;
  onToggleSelect: (itemKey: string) => void;
}) {
  if (query.isPending) {
    return <PRListSkeleton />;
  }
  if (query.error) {
    return (
      <EmptyState
        icon={IconGitPullRequest}
        title="Couldn't load pull requests"
        description={
          query.error instanceof Error
            ? query.error.message
            : "Something went wrong fetching PRs."
        }
        action={
          <Button onClick={() => query.refetch()} className="cursor-pointer">
            Try again
          </Button>
        }
      />
    );
  }
  if (!connected) {
    return (
      <EmptyState
        icon={IconGitPullRequest}
        title="Connect GitHub to see PRs"
        description={
          query.data?.connectHint ??
          "Connect GitHub once in Dispatch and grant Workbench access to populate this room."
        }
        action={
          query.data?.connectUrl ? (
            <Button asChild className="cursor-pointer">
              <a href={query.data.connectUrl}>Connect via Dispatch</a>
            </Button>
          ) : (
            <Button asChild className="cursor-pointer">
              <Link to="/settings">Open Settings</Link>
            </Button>
          )
        }
      />
    );
  }
  if (cards.length === 0) {
    return (
      <EmptyState
        icon={IconGitPullRequest}
        title="No PRs in scope"
        description="Add repos in Settings, or widen the filter to see closed or draft PRs."
        action={
          <Button asChild variant="outline" className="cursor-pointer">
            <Link to="/settings">Add a repo</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-2">
      {query.data?.errors?.map((err) => (
        <div
          key={err.repo}
          role="alert"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <span className="font-medium">{err.repo}</span>: {err.error}
        </div>
      ))}
      {cards.map((pr) => (
        <PRListCard
          key={pr.itemKey}
          pr={pr}
          selected={selected.has(pr.itemKey)}
          onToggleSelect={() => onToggleSelect(pr.itemKey)}
        />
      ))}
    </div>
  );
}

function PRListSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-2" aria-busy>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-4">
            <div className="size-5 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="h-4 w-72 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-40 animate-pulse rounded bg-muted/70" />
                </div>
                <div className="h-5 w-20 animate-pulse rounded-full bg-muted/70" />
              </div>
              <div className="flex gap-2 pt-1">
                <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
                <div className="h-8 w-20 animate-pulse rounded-md bg-muted/70" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FilterMenu({
  filter,
  sort,
  onFilter,
  onSort,
}: {
  filter: FilterValue;
  sort: SortValue;
  onFilter: (next: FilterValue) => void;
  onSort: (next: SortValue) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="cursor-pointer gap-1.5">
          <IconAdjustments size={14} aria-hidden />
          Filter
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        <FilterCheckbox
          value="open"
          current={filter}
          label="Open"
          onSelect={onFilter}
        />
        <FilterCheckbox
          value="needs-review"
          current={filter}
          label="Needs review"
          onSelect={onFilter}
        />
        <FilterCheckbox
          value="drafts"
          current={filter}
          label="Drafts"
          onSelect={onFilter}
        />
        <FilterCheckbox
          value="closed"
          current={filter}
          label="Closed"
          onSelect={onFilter}
        />
        <FilterCheckbox
          value="all"
          current={filter}
          label="All"
          onSelect={onFilter}
        />
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Sort</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sort}
          onValueChange={(v) => onSort(v as SortValue)}
        >
          <DropdownMenuRadioItem value="priority" className="cursor-pointer">
            Priority
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="oldest" className="cursor-pointer">
            Oldest updated
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="newest" className="cursor-pointer">
            Newest updated
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterCheckbox({
  value,
  current,
  label,
  onSelect,
}: {
  value: FilterValue;
  current: FilterValue;
  label: string;
  onSelect: (next: FilterValue) => void;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={current === value}
      onSelect={(e) => {
        e.preventDefault();
        onSelect(value);
      }}
      className="cursor-pointer"
    >
      {label}
    </DropdownMenuCheckboxItem>
  );
}
