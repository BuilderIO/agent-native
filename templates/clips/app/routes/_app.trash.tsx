import { useMemo, useState } from "react";
import { toast } from "sonner";
import { IconArrowBackUp, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
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
import { RecordingCard } from "@/components/library/recording-card";
import { EmptyState } from "@/components/library/empty-state";
import { SortMenu, type SortKey } from "@/components/library/sort-menu";
import { PageHeader } from "@/components/library/page-header";
import { useRecordings, type RecordingSummary } from "@/hooks/use-library";
import { useActionMutation } from "@agent-native/core/client";

export function meta() {
  return [{ title: "Trash · Clips" }];
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
  const [sort, setSort] = useState<SortKey>("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmPurge, setConfirmPurge] = useState(false);

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

  const restoreAll = (ids: string[]) => {
    for (const id of ids) {
      restore.mutate(
        { id },
        {
          onSuccess: () => toast.success("Restored"),
          onError: (err: any) => toast.error(err?.message ?? "Restore failed"),
        },
      );
    }
    setSelected(new Set());
  };

  const purgeAll = (ids: string[]) => {
    for (const id of ids) {
      purge.mutate(
        { id },
        {
          onSuccess: () => toast.success("Permanently deleted"),
          onError: (err: any) => toast.error(err?.message ?? "Delete failed"),
        },
      );
    }
    setSelected(new Set());
    setConfirmPurge(false);
  };

  const selectedIds = Array.from(selected);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <PageHeader>
        <div>
          <h1 className="text-base font-semibold text-foreground">Trash</h1>
          <p className="text-xs text-muted-foreground">
            Recordings are permanently removed after 30 days
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {selectedIds.length > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => restoreAll(selectedIds)}
              >
                <IconArrowBackUp className="h-3.5 w-3.5" /> Restore
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="gap-1.5"
                onClick={() => setConfirmPurge(true)}
              >
                <IconTrash className="h-3.5 w-3.5" /> Delete forever
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
                onTrash={() => purgeAll([r.id])}
              />
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={confirmPurge} onOpenChange={setConfirmPurge}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete forever?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedIds.length} recording
              {selectedIds.length === 1 ? "" : "s"} will be permanently removed.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => purgeAll(selectedIds)}
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
