import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useRecordings,
  useMoveRecording,
  useTrashRecording,
  useArchiveRecording,
  useRestoreRecording,
  useRenameRecording,
  type ListRecordingsArgs,
  type RecordingSummary,
} from "@/hooks/use-library";
import { RecordingCard } from "./recording-card";
import { EmptyState } from "./empty-state";
import { SortMenu, type SortKey } from "./sort-menu";
import { FilterChips, type FilterChip } from "./filter-chips";
import { BulkActionToolbar } from "./bulk-action-toolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { IconChecks } from "@tabler/icons-react";

interface LibraryGridProps {
  view: "library" | "space" | "archive" | "trash" | "all";
  folderId?: string | null;
  spaceId?: string | null;
  /** What empty-state illustration to render. Defaults from `view`. */
  emptyKind?: "library" | "folder" | "space" | "archive" | "trash";
  title?: string;
  subtitle?: string;
  tagFilter?: string | null;
  onClearTag?: () => void;
  extraActions?: React.ReactNode;
}

function Skeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="aspect-video bg-muted" />
      <div className="p-3 space-y-2">
        <div className="h-3.5 w-3/4 rounded bg-muted" />
        <div className="h-3 w-1/2 rounded bg-muted" />
      </div>
    </div>
  );
}

export function LibraryGrid({
  view,
  folderId = null,
  spaceId = null,
  emptyKind,
  title,
  subtitle,
  tagFilter,
  onClearTag,
  extraActions,
}: LibraryGridProps) {
  const [sort, setSort] = useState<SortKey>("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [renamingRec, setRenamingRec] = useState<RecordingSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [isBulkPending, setIsBulkPending] = useState(false);

  const args: ListRecordingsArgs = useMemo(
    () => ({
      view,
      folderId: folderId ?? null,
      spaceId: spaceId ?? null,
      tag: tagFilter ?? null,
      sort,
    }),
    [view, folderId, spaceId, tagFilter, sort],
  );

  const { data, isLoading } = useRecordings(args);
  const recordings = data?.recordings ?? [];

  const moveRecording = useMoveRecording();
  const trashRecording = useTrashRecording();
  const archiveRecording = useArchiveRecording();
  const restoreRecording = useRestoreRecording();
  const renameRecording = useRenameRecording();

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setSelectionMode(false);
  };

  const openRenameDialog = (rec: RecordingSummary) => {
    setRenamingRec(rec);
    setRenameValue(rec.title ?? "");
    // Focus the input after dialog opens
    setTimeout(() => renameInputRef.current?.select(), 50);
  };

  const submitRename = () => {
    if (!renamingRec) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast.error("Title cannot be empty");
      return;
    }
    renameRecording.mutate(
      { id: renamingRec.id, title: trimmed },
      {
        onSuccess: () => {
          toast.success("Clip renamed");
          setRenamingRec(null);
        },
        onError: () => toast.error("Failed to rename clip"),
      },
    );
  };

  const chips: FilterChip[] = [];
  if (tagFilter) {
    chips.push({
      key: `tag:${tagFilter}`,
      label: `#${tagFilter}`,
      active: true,
      onRemove: onClearTag,
    });
  }

  const resolvedEmptyKind =
    emptyKind ??
    (view === "archive"
      ? "archive"
      : view === "trash"
        ? "trash"
        : view === "space"
          ? "space"
          : folderId
            ? "folder"
            : "library");

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Rename dialog */}
      <Dialog
        open={!!renamingRec}
        onOpenChange={(open) => {
          if (!open) setRenamingRec(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename clip</DialogTitle>
          </DialogHeader>
          <Input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
            }}
            placeholder="Clip title"
            className="mt-1"
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenamingRec(null)}
              disabled={renameRecording.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={submitRename}
              disabled={renameRecording.isPending || !renameValue.trim()}
            >
              {renameRecording.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          {title && (
            <h1 className="text-base font-semibold text-foreground truncate">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {extraActions}
          <Button
            variant={selectionMode ? "default" : "outline"}
            size="sm"
            className={cn(
              "h-8 gap-1.5",
              selectionMode &&
                "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
            onClick={() => {
              setSelectionMode((v) => !v);
              if (selectionMode) setSelected(new Set());
            }}
          >
            <IconChecks className="h-3.5 w-3.5" />
            Select
          </Button>
          <SortMenu value={sort} onChange={setSort} />
        </div>
      </div>

      {chips.length > 0 && (
        <div className="border-b border-border px-5 py-2">
          <FilterChips chips={chips} />
        </div>
      )}

      {/* Grid body */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-5">
          {isLoading ? (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} />
              ))}
            </div>
          ) : recordings.length === 0 ? (
            <EmptyState kind={resolvedEmptyKind} />
          ) : (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              {recordings.map((r: RecordingSummary) => (
                <RecordingCard
                  key={r.id}
                  recording={r}
                  selected={selected.has(r.id)}
                  selectionMode={selectionMode}
                  onToggleSelect={toggleSelect}
                  onRename={openRenameDialog}
                  onMove={(rec) => {
                    moveRecording.mutate(
                      { id: rec.id, folderId: null },
                      {
                        onSuccess: () => toast.success("Moved to library root"),
                      },
                    );
                  }}
                  onTrash={(rec) => {
                    trashRecording.mutate(
                      { id: rec.id },
                      {
                        onSuccess: () => toast.success("Moved to trash"),
                      },
                    );
                  }}
                  onArchive={(rec) => {
                    if (rec.archivedAt) {
                      restoreRecording.mutate(
                        { id: rec.id },
                        {
                          onSuccess: () =>
                            toast.success("Restored from archive"),
                        },
                      );
                    } else {
                      archiveRecording.mutate(
                        { id: rec.id },
                        {
                          onSuccess: () => toast.success("Archived"),
                        },
                      );
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Sticky bulk-action toolbar */}
        {selected.size > 0 && (
          <div className="pointer-events-none sticky bottom-0 flex justify-center pb-4">
            <div className="pointer-events-auto">
              <BulkActionToolbar
                count={selected.size}
                onMove={() => toast.info("Move: implement via shadcn dialog")}
                onAddToSpace={() =>
                  toast.info("Add to space: implement via shadcn dialog")
                }
                onTag={() => toast.info("Tag: implement via shadcn dialog")}
                onArchive={async () => {
                  setIsBulkPending(true);
                  try {
                    const ids = Array.from(selected);
                    const results = await Promise.allSettled(
                      ids.map((id) => archiveRecording.mutateAsync({ id })),
                    );
                    const succeededIds = ids.filter(
                      (_, i) => results[i].status === "fulfilled",
                    );
                    const failed = ids.length - succeededIds.length;
                    if (succeededIds.length > 0) {
                      toast.success(
                        `${succeededIds.length} clip${succeededIds.length === 1 ? "" : "s"} archived`,
                      );
                      setSelected((prev) => {
                        const next = new Set(prev);
                        succeededIds.forEach((id) => next.delete(id));
                        return next;
                      });
                    }
                    if (failed > 0) {
                      toast.error(
                        `${failed} clip${failed === 1 ? "" : "s"} could not be archived`,
                      );
                    }
                  } finally {
                    setIsBulkPending(false);
                  }
                }}
                onTrash={async () => {
                  setIsBulkPending(true);
                  try {
                    const ids = Array.from(selected);
                    const results = await Promise.allSettled(
                      ids.map((id) => trashRecording.mutateAsync({ id })),
                    );
                    const succeededIds = ids.filter(
                      (_, i) => results[i].status === "fulfilled",
                    );
                    const failed = ids.length - succeededIds.length;
                    if (succeededIds.length > 0) {
                      toast.success(
                        `${succeededIds.length} clip${succeededIds.length === 1 ? "" : "s"} moved to trash`,
                      );
                      setSelected((prev) => {
                        const next = new Set(prev);
                        succeededIds.forEach((id) => next.delete(id));
                        return next;
                      });
                    }
                    if (failed > 0) {
                      toast.error(
                        `${failed} clip${failed === 1 ? "" : "s"} could not be moved to trash`,
                      );
                    }
                  } finally {
                    setIsBulkPending(false);
                  }
                }}
                onClear={clearSelection}
                isPending={isBulkPending}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
