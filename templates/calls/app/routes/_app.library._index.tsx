import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  IconGridDots,
  IconLayoutList,
  IconMicrophone,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react";
import { useActionQuery } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { useSetHeaderActions } from "@/components/layout/HeaderActions";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CallCard } from "@/components/library/call-card";
import { CallRow } from "@/components/library/call-row";
import {
  FilterBar,
  EMPTY_FILTER,
  type FilterState,
} from "@/components/library/filter-bar";

export function meta() {
  return [{ title: "Library · Calls" }];
}

type ViewMode = "grid" | "list";
type SortKey = "recent" | "oldest" | "duration" | "title";

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

export default function LibraryIndexRoute() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sort, setSort] = useState<SortKey>("recent");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTER);

  const query = useMemo(
    () => ({ view: "library" as const, sort, ...filters }),
    [sort, filters],
  );

  const { data, isLoading } = useActionQuery<{ calls: CallSummary[] }>(
    "list-calls",
    query,
  );

  const calls = data?.calls ?? [];

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold">Library</h1>
          <p className="text-xs text-muted-foreground">
            Your sales calls, recordings, and meetings
          </p>
        </div>
        <Button
          onClick={() => navigate("/upload")}
          className="gap-1.5"
          size="sm"
        >
          <IconUpload className="h-4 w-4" />
          New call
        </Button>
      </header>

      <div className="px-6 py-3 border-b border-border shrink-0 flex items-center gap-3 flex-wrap">
        <FilterBar value={filters} onChange={setFilters} />
        <div className="ml-auto flex items-center gap-2">
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-[160px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Most recent</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="duration">Longest</SelectItem>
              <SelectItem value="title">Title</SelectItem>
            </SelectContent>
          </Select>
          <div className="inline-flex rounded-md border border-border p-0.5">
            <button
              type="button"
              aria-label="Grid view"
              onClick={() => setViewMode("grid")}
              className={
                "p-1.5 rounded " +
                (viewMode === "grid"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <IconGridDots className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="List view"
              onClick={() => setViewMode("list")}
              className={
                "p-1.5 rounded " +
                (viewMode === "list"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <IconLayoutList className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {isLoading ? (
          <LibrarySkeleton viewMode={viewMode} />
        ) : calls.length === 0 ? (
          <EmptyState onUpload={() => navigate("/upload")} />
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

function LibrarySkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
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
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-md" />
      ))}
    </div>
  );
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <IconVideo className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold mb-1">No calls yet</h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-1">
        Upload a recording, record one in the browser, or invite a bot to your
        next Zoom / Meet / Teams call.
      </p>
      <p className="text-xs text-muted-foreground max-w-sm mb-6">
        First-time setup: paste a Deepgram key in Settings — that unlocks
        transcription, summaries, and trackers.
      </p>
      <div className="flex gap-2">
        <Button onClick={onUpload} className="gap-1.5">
          <IconUpload className="h-4 w-4" />
          Upload a call
        </Button>
        <Button variant="outline" onClick={onUpload} className="gap-1.5">
          <IconMicrophone className="h-4 w-4" />
          Record one
        </Button>
      </div>
    </div>
  );
}
