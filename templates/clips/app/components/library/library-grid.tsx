import {
  getBrowserTabId,
  setClientAppState,
  useT,
} from "@agent-native/core/client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ShareRecordingDialog } from "@/components/player/share-dialog";
import {
  useFolders,
  useRecordings,
  useTrashRecording,
  useArchiveRecording,
  useRestoreRecording,
  useMoveRecording,
  type ListRecordingsArgs,
  type RecordingSummary,
} from "@/hooks/use-library";

import { BulkActionToolbar, type BulkMoveTarget } from "./bulk-action-toolbar";
import { EmptyState } from "./empty-state";
import { FilterChips, type FilterChip } from "./filter-chips";
import { PageHeader } from "./page-header";
import { RecordingCard } from "./recording-card";
import { SortMenu, type SortKey } from "./sort-menu";

interface LibraryGridProps {
  view: "library" | "space" | "archive" | "trash" | "all";
  folderId?: string | null;
  spaceId?: string | null;
  /** What empty-state illustration to render. Defaults from `view`. */
  emptyKind?: "library" | "folder" | "space" | "archive" | "trash";
  title?: string;
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

interface FolderTargetRow {
  id: string;
  parentId: string | null;
  name: string;
}

function buildMoveTargets(
  folders: FolderTargetRow[],
  currentFolderId: string | null,
  rootLabel: string,
): BulkMoveTarget[] {
  const byParent = new Map<string | null, FolderTargetRow[]>();
  for (const folder of folders) {
    const parentId = folder.parentId ?? null;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), folder]);
  }

  const targets: BulkMoveTarget[] = [{ id: null, name: rootLabel }];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of byParent.get(parentId) ?? []) {
      targets.push({
        id: folder.id,
        name: folder.name,
        depth,
        disabled: folder.id === currentFolderId,
      });
      walk(folder.id, depth + 1);
    }
  };

  walk(null, 0);
  return targets;
}

export function LibraryGrid({
  view,
  folderId = null,
  spaceId = null,
  emptyKind,
  title,
  tagFilter,
  onClearTag,
  extraActions,
}: LibraryGridProps) {
  const t = useT();
  const [sort, setSort] = useState<SortKey>("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectionMode = selected.size > 0;
  const [sharingRec, setSharingRec] = useState<RecordingSummary | null>(null);
  const [isBulkPending, setIsBulkPending] = useState(false);
  const selectionStateKey = useMemo(() => `selection:${getBrowserTabId()}`, []);

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

  const trashRecording = useTrashRecording();
  const archiveRecording = useArchiveRecording();
  const restoreRecording = useRestoreRecording();
  const moveRecording = useMoveRecording();
  const canMoveSelection = view === "library" || view === "space";
  const { data: scopedFolders } = useFolders(
    {
      spaceId: view === "space" ? (spaceId ?? null) : null,
    },
    {
      enabled: canMoveSelection && (view !== "space" || Boolean(spaceId)),
    },
  );
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const moveTargets = useMemo(
    () =>
      canMoveSelection
        ? buildMoveTargets(
            ((scopedFolders?.folders ?? []) as FolderTargetRow[]).map(
              (folder) => ({
                id: folder.id,
                parentId: folder.parentId ?? null,
                name: folder.name,
              }),
            ),
            folderId ?? null,
            view === "space"
              ? t("libraryGrid.spaceRoot")
              : t("libraryGrid.libraryRoot"),
          )
        : [],
    [canMoveSelection, folderId, scopedFolders, t, view],
  );

  useEffect(() => {
    const state =
      selectedIds.length > 0
        ? {
            type: "recordings",
            recordingIds: selectedIds,
            view,
            folderId: folderId ?? null,
            spaceId: spaceId ?? null,
          }
        : null;

    void setClientAppState(selectionStateKey, state, {
      keepalive: true,
      requestSource: "clips-library-selection",
    }).catch(() => {});
  }, [folderId, selectedIds, selectionStateKey, spaceId, view]);

  useEffect(() => {
    return () => {
      void setClientAppState(selectionStateKey, null, {
        keepalive: true,
        requestSource: "clips-library-selection",
      }).catch(() => {});
    };
  }, [selectionStateKey]);

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
  };

  const moveSelected = async (targetFolderId: string | null) => {
    if (selectedIds.length === 0) return;
    setIsBulkPending(true);
    try {
      await moveRecording.mutateAsync({
        ids: selectedIds,
        folderId: targetFolderId,
      });
      toast.success(t("libraryGrid.clipsMoved", { count: selectedIds.length }));
      clearSelection();
    } catch (err: any) {
      toast.error(err?.message ?? t("libraryGrid.moveFailed"));
    } finally {
      setIsBulkPending(false);
    }
  };

  const moveSingle = async (
    rec: RecordingSummary,
    targetFolderId: string | null,
  ) => {
    try {
      await moveRecording.mutateAsync({
        id: rec.id,
        folderId: targetFolderId,
      });
      toast.success(t("libraryGrid.clipsMoved", { count: 1 }));
    } catch (err: any) {
      toast.error(err?.message ?? t("libraryGrid.moveFailed"));
    }
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
      {/* Share dialog — programmatically opened from the card context menu */}
      {sharingRec && (
        <ShareRecordingDialog
          recordingId={sharingRec.id}
          recordingTitle={sharingRec.title}
          open={!!sharingRec}
          onOpenChange={(open) => {
            if (!open) setSharingRec(null);
          }}
        />
      )}

      {/* Page header — rendered into the top app bar */}
      <PageHeader>
        <div className="min-w-0 flex-1">
          {title && (
            <h1 className="text-base font-semibold text-foreground truncate">
              {title}
            </h1>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {extraActions}
          <SortMenu value={sort} onChange={setSort} />
        </div>
      </PageHeader>

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
            <EmptyState
              kind={resolvedEmptyKind}
              spaceId={spaceId}
              folderId={folderId}
            />
          ) : (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              {recordings.map((r: RecordingSummary) => (
                <RecordingCard
                  key={r.id}
                  recording={r}
                  selected={selected.has(r.id)}
                  selectionMode={selectionMode}
                  onToggleSelect={toggleSelect}
                  onShare={(rec) => setSharingRec(rec)}
                  moveTargets={moveTargets}
                  onMove={canMoveSelection ? moveSingle : undefined}
                  isMovePending={moveRecording.isPending}
                  onTrash={(rec) => {
                    trashRecording.mutate(
                      { id: rec.id },
                      {
                        onSuccess: () =>
                          toast.success(t("libraryGrid.movedToTrash")),
                      },
                    );
                  }}
                  onArchive={(rec) => {
                    if (rec.archivedAt) {
                      restoreRecording.mutate(
                        { id: rec.id },
                        {
                          onSuccess: () =>
                            toast.success(t("libraryGrid.restoredFromArchive")),
                        },
                      );
                    } else {
                      archiveRecording.mutate(
                        { id: rec.id },
                        {
                          onSuccess: () =>
                            toast.success(t("libraryGrid.archived")),
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
                moveTargets={moveTargets}
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
                        t("libraryGrid.clipsArchived", {
                          count: succeededIds.length,
                        }),
                      );
                      setSelected((prev) => {
                        const next = new Set(prev);
                        succeededIds.forEach((id) => next.delete(id));
                        return next;
                      });
                    }
                    if (failed > 0) {
                      toast.error(
                        t("libraryGrid.clipsArchiveFailed", { count: failed }),
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
                        t("libraryGrid.clipsMovedToTrash", {
                          count: succeededIds.length,
                        }),
                      );
                      setSelected((prev) => {
                        const next = new Set(prev);
                        succeededIds.forEach((id) => next.delete(id));
                        return next;
                      });
                    }
                    if (failed > 0) {
                      toast.error(
                        t("libraryGrid.clipsTrashFailed", { count: failed }),
                      );
                    }
                  } finally {
                    setIsBulkPending(false);
                  }
                }}
                onMove={canMoveSelection ? moveSelected : undefined}
                onClear={clearSelection}
                isPending={isBulkPending || moveRecording.isPending}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
