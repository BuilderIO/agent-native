import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  IconChevronRight,
  IconFolder,
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
import { CallCard } from "@/components/library/call-card";
import { CallRow } from "@/components/library/call-row";
import {
  FilterBar,
  EMPTY_FILTER,
  type FilterState,
} from "@/components/library/filter-bar";
import {
  useSetPageTitle,
  useSetHeaderActions,
} from "@/components/layout/HeaderActions";

export function meta() {
  return [{ title: "Folder · Calls" }];
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

interface FolderCrumb {
  id: string;
  name: string;
}

export default function LibraryFolderRoute() {
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sort, setSort] = useState<SortKey>("recent");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTER);

  const query = useMemo(
    () => ({ view: "library" as const, folderId, sort, ...filters }),
    [folderId, sort, filters],
  );

  const { data, isLoading } = useActionQuery<{
    calls: CallSummary[];
    folder?: { id: string; name: string; path: FolderCrumb[] };
  }>("list-calls", query, { enabled: !!folderId });

  const calls = data?.calls ?? [];
  const folder = data?.folder;
  const path = folder?.path ?? [];

  useSetPageTitle(
    <div className="flex items-center gap-2 min-w-0">
      <IconFolder className="h-5 w-5 text-[#625DF5] shrink-0" />
      <nav className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
        <Link to="/library" className="hover:text-foreground">
          Library
        </Link>
        {path.slice(0, -1).map((crumb) => (
          <span key={crumb.id} className="flex items-center gap-1 min-w-0">
            <IconChevronRight className="h-3 w-3 shrink-0" />
            <Link
              to={`/library/folder/${crumb.id}`}
              className="hover:text-foreground truncate"
            >
              {crumb.name}
            </Link>
          </span>
        ))}
        <IconChevronRight className="h-3 w-3 shrink-0" />
      </nav>
      <h1 className="text-base font-semibold tracking-tight truncate">
        {folder?.name ?? "Folder"}
      </h1>
    </div>,
  );

  useSetHeaderActions(
    <Button
      onClick={() => navigate("/upload")}
      className="bg-[#625DF5] hover:bg-[#5049d9] text-white gap-1.5 cursor-pointer"
      size="sm"
    >
      <IconUpload className="h-4 w-4" />
      Upload
    </Button>,
  );

  return (
    <div className="flex flex-col h-full min-h-0">
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
              <IconFolder className="h-8 w-8 text-[#625DF5]" />
            </div>
            <h2 className="text-lg font-semibold mb-1">This folder is empty</h2>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              Move calls here from the Library or upload a new one.
            </p>
            <Button
              onClick={() => navigate("/upload")}
              className="bg-[#625DF5] hover:bg-[#5049d9] text-white gap-1.5"
            >
              <IconUpload className="h-4 w-4" />
              Upload a call
            </Button>
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
