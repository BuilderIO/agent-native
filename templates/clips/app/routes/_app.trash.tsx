import { useActionMutation, useT } from "@agent-native/core/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconArrowBackUp, IconTrash } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/library/empty-state";
import { PageHeader } from "@/components/library/page-header";
import { RecordingCard } from "@/components/library/recording-card";
import { SortMenu, type SortKey } from "@/components/library/sort-menu";
import { useRecordings, type RecordingSummary } from "@/hooks/use-library";
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

export default function TrashRoute() {
  const t = useT();
  const [sort, setSort] = useState<SortKey>("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [singlePurgeId, setSinglePurgeId] = useState<string | null>(null);
  const [isBulkPending, setIsBulkPending] = useState(false);

  const args = useMemo(() => ({ view: "trash" as const, sort }), [sort]);
  const { data, isLoading } = useRecordings(args);
  const recordings = (data?.recordings ?? []) as RecordingSummary[];

  // These actions are owned by other teams and ship with the template.
  const restore = useActionMutation<any, { id: string }>("restore-recording");
  const purge = useActionMutation<any, { id: string }>(
    "delete-recording-permanent",
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
  };

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <PageHeader>
        <h1 className="text-base font-semibold text-foreground">
          {t("trashRoute.title")}
        </h1>
        <div className="ml-auto flex items-center gap-2">
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

      <div className="flex-1 overflow-y-auto p-5">
        {isLoading ? (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} />
            ))}
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
                if (singlePurgeId) purgeAll([singlePurgeId]);
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
