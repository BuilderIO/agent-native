import { useMemo, useState } from "react";
import { IconArchive, IconGridDots, IconLayoutList } from "@tabler/icons-react";
import { useActionQuery } from "@agent-native/core/client";
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
import { FilterBar } from "@/components/library/filter-bar";

export function meta() {
  return [{ title: "Archive · Calls" }];
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
}

export default function ArchiveRoute() {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sort, setSort] = useState<SortKey>("recent");
  const [filters, setFilters] = useState<Record<string, unknown>>({});

  const query = useMemo(
    () => ({ view: "archive" as const, sort, ...filters }),
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
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <IconArchive className="h-6 w-6 text-[#625DF5]" />
            Archive
          </h1>
          <p className="text-xs text-muted-foreground">
            Calls you've archived
          </p>
        </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-video w-full rounded-md" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-16 w-16 rounded-full bg-[#625DF5]/10 flex items-center justify-center mb-4">
              <IconArchive className="h-8 w-8 text-[#625DF5]" />
            </div>
            <h2 className="text-lg font-semibold mb-1">Archive is empty</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Calls you archive will appear here. Archived calls stay searchable
              but are hidden from the Library.
            </p>
          </div>
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
