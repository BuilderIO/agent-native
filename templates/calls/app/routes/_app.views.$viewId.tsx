import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  IconBookmark,
  IconGridDots,
  IconLayoutList,
  IconUpload,
} from "@tabler/icons-react";
import { useActionQuery } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSetHeaderActions } from "@/components/layout/HeaderActions";
import { CallCard } from "@/components/library/call-card";
import { CallRow } from "@/components/library/call-row";
import {
  EMPTY_FILTER,
  FilterBar,
  type FilterState,
} from "@/components/library/filter-bar";

export function meta() {
  return [{ title: "Saved View · Calls" }];
}

type ViewMode = "grid" | "list";
type SortKey = "recent" | "oldest" | "longest" | "most-viewed" | "title";

interface CallSummary {
  id: string;
  title: string;
  status: string;
  durationMs: number;
  createdAt: string;
  thumbnailUrl?: string | null;
  accountId?: string | null;
  folderId?: string | null;
}

interface SavedViewItem {
  id: string;
  name: string;
  filters?: Record<string, unknown>;
}

function filtersFromSavedView(view: SavedViewItem | undefined): FilterState {
  return { ...EMPTY_FILTER, ...(view?.filters ?? {}) } as FilterState;
}

export default function SavedViewRoute() {
  const navigate = useNavigate();
  const { viewId } = useParams<{ viewId: string }>();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sort, setSort] = useState<SortKey>("recent");
  const [localFilters, setLocalFilters] = useState<FilterState | null>(null);

  const { data: savedViewsData } = useActionQuery<{ views?: SavedViewItem[] }>(
    "list-saved-views",
    undefined,
    {},
  );

  const savedView = (savedViewsData?.views ?? []).find((v) => v.id === viewId);
  const savedFilters = useMemo(
    () => filtersFromSavedView(savedView),
    [savedView],
  );
  const filters = localFilters ?? savedFilters;

  const query = useMemo(
    () => ({ view: "library" as const, sort, ...filters }),
    [sort, filters],
  );

  const { data, isLoading } = useActionQuery<{ calls: CallSummary[] }>(
    "list-calls",
    query,
    { enabled: !!viewId },
  );

  const calls = data?.calls ?? [];

  useSetHeaderActions(
    <Button
      onClick={() => navigate("/upload")}
      className="gap-1.5 cursor-pointer"
      size="sm"
    >
      <IconUpload className="h-4 w-4" />
      New call
    </Button>,
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-6 py-3 border-b border-border shrink-0 flex items-center gap-3 flex-wrap">
        <div className="flex min-w-0 items-center gap-2">
          <IconBookmark className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate">
              {savedView?.name ?? "Saved view"}
            </h1>
            <p className="text-xs text-muted-foreground">
              Saved library filters
            </p>
          </div>
        </div>
        <FilterBar value={filters} onChange={setLocalFilters} />
        <div className="ml-auto flex items-center gap-2">
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-[160px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Most recent</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="longest">Longest</SelectItem>
              <SelectItem value="most-viewed">Most viewed</SelectItem>
              <SelectItem value="title">Title</SelectItem>
            </SelectContent>
          </Select>
          <ViewToggle value={viewMode} onChange={setViewMode} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {isLoading ? (
          <LibrarySkeleton viewMode={viewMode} />
        ) : calls.length === 0 ? (
          <EmptyState />
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {calls.map((c) => (
              <CallCard key={c.id} call={c} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-md border border-border overflow-hidden">
            {calls.map((c) => (
              <CallRow key={c.id} call={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5">
      <button
        type="button"
        aria-label="Grid view"
        onClick={() => onChange("grid")}
        className={
          "p-1.5 rounded " +
          (value === "grid"
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:text-foreground")
        }
      >
        <IconGridDots className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="List view"
        onClick={() => onChange("list")}
        className={
          "p-1.5 rounded " +
          (value === "list"
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:text-foreground")
        }
      >
        <IconLayoutList className="h-4 w-4" />
      </button>
    </div>
  );
}

function LibrarySkeleton({ viewMode }: { viewMode: ViewMode }) {
  const items = Array.from({ length: viewMode === "grid" ? 8 : 10 });
  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {items.map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="aspect-video w-full rounded-md" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-md" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <IconBookmark className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold mb-1">No calls match this view</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Calls matching the saved filters will appear here.
      </p>
    </div>
  );
}
