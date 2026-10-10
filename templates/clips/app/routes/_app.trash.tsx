import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/library/empty-state";
import { PageBreadcrumb, PageHeader } from "@/components/library/page-header";
import { RecordingCard } from "@/components/library/recording-card";
import { SortMenu, type SortKey } from "@/components/library/sort-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  useInfiniteRecordings,
  useRecordingsCount,
  type RecordingSummary,
} from "@/hooks/use-library";
import enMessages from "@/i18n/en-US";

export function meta() {
  return [{ title: enMessages.clipsFinalRaw.trashPageTitle }];
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

const PAGE_SIZE = 20;

export default function TrashRoute() {
  const t = useT();
  const [sort, setSort] = useState<SortKey>("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [singlePurgeId, setSinglePurgeId] = useState<string | null>(null);
  const [isBulkPending, setIsBulkPending] = useState(false);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const nextPageInFlightRef = useRef<string | null>(null);
  const initialPreloadRequestRef = useRef<string | null>(null);
  const [isLargeViewport, setIsLargeViewport] = useState(false);

  const countArgs = useMemo(() => ({ view: "trash" as const }), []);
  const { data: totalCount } = useRecordingsCount(countArgs);

  useEffect(() => {
    setSelected(new Set());
    setLastSelectedId(null);
  }, [sort]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsLargeViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const args = useMemo(
    () => ({
      view: "trash" as const,
      sort,
      limit: PAGE_SIZE,
    }),
    [sort],
  );
  const totalKnown = typeof totalCount === "number";
  const {
    data,
    isLoading,
    isError,
    isFetching,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = useInfiniteRecordings(args, totalKnown ? totalCount : undefined);
  const recordings = useMemo(
    () =>
      (data?.pages.flatMap((page) => page.recordings) ??
        []) as RecordingSummary[],
    [data?.pages],
  );
  const requestKey = JSON.stringify(args);
  const fetchNextPageIfIdle = useCallback(() => {
    if (nextPageInFlightRef.current === requestKey) return;
    nextPageInFlightRef.current = requestKey;
    const releaseRequest = () => {
      if (nextPageInFlightRef.current === requestKey) {
        nextPageInFlightRef.current = null;
      }
    };
    void fetchNextPage().then(releaseRequest, releaseRequest);
  }, [fetchNextPage, requestKey]);

  useEffect(() => {
    if (
      !isLargeViewport ||
      isLoading ||
      !hasNextPage ||
      isFetchingNextPage ||
      data?.pages.length !== 1 ||
      initialPreloadRequestRef.current === requestKey
    ) {
      return;
    }
    initialPreloadRequestRef.current = requestKey;
    fetchNextPageIfIdle();
  }, [
    data?.pages.length,
    fetchNextPageIfIdle,
    hasNextPage,
    isFetchingNextPage,
    isLargeViewport,
    isLoading,
    requestKey,
  ]);

  useEffect(() => {
    const root = scrollRootRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (
      !root ||
      !sentinel ||
      !hasNextPage ||
      isFetchingNextPage ||
      isFetchNextPageError ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          fetchNextPageIfIdle();
        }
      },
      { root, rootMargin: "320px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    data?.pages.length,
    fetchNextPageIfIdle,
    hasNextPage,
    isFetchNextPageError,
    isFetchingNextPage,
  ]);

  const restore = useActionMutation<any, { id: string }>("restore-recording");
  const purge = useActionMutation<any, { id: string }>(
    "delete-recording-permanent",
  );

  const toggleSelect = (id: string, shiftKey = false) => {
    setSelected((prev) => {
      if (shiftKey && lastSelectedId && lastSelectedId !== id) {
        const ids = recordings.map((r) => r.id);
        const fromIndex = ids.indexOf(lastSelectedId);
        const toIndex = ids.indexOf(id);
        if (fromIndex !== -1 && toIndex !== -1) {
          const [start, end] =
            fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
          const next = new Set(prev);
          for (let i = start; i <= end; i++) next.add(ids[i]);
          return next;
        }
      }
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastSelectedId(id);
  };

  const restoreAll = async (ids: string[]) => {
    if (ids.length === 0) return;
    setIsBulkPending(true);
    try {
      if (ids.length === 1) {
        try {
          await restore.mutateAsync({ id: ids[0] });
          toast.success(t("trashRoute.restored"));
          setSelected((prev) => {
            const next = new Set(prev);
            next.delete(ids[0]);
            return next;
          });
        } catch (err: any) {
          toast.error(err?.message ?? t("trashRoute.restoreFailed"));
        }
        return;
      }

      const results = await Promise.allSettled(
        ids.map((id) => restore.mutateAsync({ id })),
      );
      const succeededIds = ids.filter(
        (_, i) => results[i].status === "fulfilled",
      );
      const failed = ids.length - succeededIds.length;
      if (succeededIds.length > 0) {
        toast.success(
          t("trashRoute.clipsRestored", { count: succeededIds.length }),
        );
        setSelected((prev) => {
          const next = new Set(prev);
          succeededIds.forEach((id) => next.delete(id));
          return next;
        });
      }
      if (failed > 0) {
        toast.error(t("trashRoute.clipsRestoreFailed", { count: failed }));
      }
    } finally {
      setIsBulkPending(false);
    }
  };

  const purgeAll = async (ids: string[]) => {
    if (ids.length === 0) return;
    setIsBulkPending(true);
    try {
      if (ids.length === 1) {
        try {
          await purge.mutateAsync({ id: ids[0] });
          toast.success(t("trashRoute.permanentlyDeleted"));
          setSelected((prev) => {
            const next = new Set(prev);
            next.delete(ids[0]);
            return next;
          });
        } catch (err: any) {
          toast.error(err?.message ?? t("trashRoute.deleteFailed"));
        }
        return;
      }

      const results = await Promise.allSettled(
        ids.map((id) => purge.mutateAsync({ id })),
      );
      const succeededIds = ids.filter(
        (_, i) => results[i].status === "fulfilled",
      );
      const failed = ids.length - succeededIds.length;
      if (succeededIds.length > 0) {
        toast.success(
          t("trashRoute.clipsPermanentlyDeleted", {
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
        toast.error(t("trashRoute.clipsDeleteFailed", { count: failed }));
      }
    } finally {
      setIsBulkPending(false);
      setConfirmPurge(false);
    }
  };

  const selectedIds = Array.from(selected);
  const allSelected =
    recordings.length > 0 && selected.size === recordings.length;

  const toggleSelectAll = () => {
    setSelected((prev) =>
      prev.size === recordings.length
        ? new Set()
        : new Set(recordings.map((r) => r.id)),
    );
    setLastSelectedId(null);
  };

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <PageHeader>
        <PageBreadcrumb items={[{ label: t("trashRoute.title") }]} />
        <div className="ms-auto flex items-center gap-2">
          {selectedIds.length > 0 && (
            <>
              <span className="text-sm text-muted-foreground">
                {t("trashRoute.selected", { count: selectedIds.length })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5"
                onClick={toggleSelectAll}
              >
                {allSelected
                  ? t("trashRoute.deselectAll")
                  : t("trashRoute.selectAll")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={isBulkPending}
                onClick={() => restoreAll(selectedIds)}
              >
                <IconArrowBackUp className="h-3.5 w-3.5" />{" "}
                {t("trashRoute.restore")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="gap-1.5"
                disabled={isBulkPending}
                onClick={() => setConfirmPurge(true)}
              >
                <IconTrash className="h-3.5 w-3.5" />{" "}
                {t("trashRoute.deleteForever")}
              </Button>
            </>
          )}
          <SortMenu value={sort} onChange={setSort} />
        </div>
      </PageHeader>

      <div
        ref={scrollRootRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5"
      >
        {isLoading ? (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} />
            ))}
          </div>
        ) : isError && recordings.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-8 py-20 text-center">
            <IconAlertTriangle className="size-10 text-destructive" />
            <h2 className="text-base font-semibold">
              {t("libraryGrid.loadFailedTitle")}
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t("libraryGrid.loadFailedBody")}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {t("libraryGrid.retry")}
            </Button>
          </div>
        ) : recordings.length === 0 ? (
          <EmptyState kind="trash" />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {recordings.map((r) => (
              <RecordingCard
                key={r.id}
                recording={r}
                selected={selected.has(r.id)}
                selectionMode
                onToggleSelect={toggleSelect}
                onArchive={() => restoreAll([r.id])}
                onTrash={() => setSinglePurgeId(r.id)}
              />
            ))}
          </div>
        )}
        {isFetchingNextPage && (
          <div
            className="grid gap-4 pt-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]"
            role="status"
          >
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} />
            ))}
          </div>
        )}
        {isFetchNextPageError && (
          <div className="flex justify-center pt-4">
            <Button size="sm" variant="outline" onClick={fetchNextPageIfIdle}>
              {t("libraryGrid.retry")}
            </Button>
          </div>
        )}
        {hasNextPage && <div ref={loadMoreSentinelRef} className="h-px" />}
      </div>

      <AlertDialog open={confirmPurge} onOpenChange={setConfirmPurge}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("trashRoute.deleteForeverTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("trashRoute.bulkDeleteDescription", {
                count: selectedIds.length,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => purgeAll(selectedIds)}
            >
              {t("trashRoute.deleteForever")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!singlePurgeId}
        onOpenChange={(open) => {
          if (!open) setSinglePurgeId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("trashRoute.deleteForeverTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("trashRoute.singleDeleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (singlePurgeId) void purgeAll([singlePurgeId]);
                setSinglePurgeId(null);
              }}
            >
              {t("trashRoute.deleteForever")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
