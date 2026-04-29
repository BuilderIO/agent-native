import { useMemo, useState } from "react";
import { IconRestore, IconTrash, IconTrashX } from "@tabler/icons-react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { toast } from "sonner";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  FilterBar,
  EMPTY_FILTER,
  type FilterState,
} from "@/components/library/filter-bar";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

export function meta() {
  return [{ title: "Trash · Calls" }];
}

interface CallSummary {
  id: string;
  title: string;
  status: string;
  durationMs: number;
  createdAt: string;
  deletedAt?: string | null;
}

export default function TrashRoute() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTER);
  const [pendingDelete, setPendingDelete] = useState<CallSummary | null>(null);

  const query = useMemo(
    () => ({ view: "trash" as const, ...filters }),
    [filters],
  );
  const { data, isLoading, refetch } = useActionQuery<{ calls: CallSummary[] }>(
    "list-calls",
    query,
  );
  const calls = data?.calls ?? [];

  const restoreCall = useActionMutation<any, { id: string }>("restore-call");
  const deletePerm = useActionMutation<any, { id: string }>(
    "delete-call-permanent",
  );

  async function handleRestore(id: string) {
    try {
      await restoreCall.mutateAsync({ id });
      toast.success("Call restored");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to restore");
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    try {
      await deletePerm.mutateAsync({ id: pendingDelete.id });
      toast.success("Call permanently deleted");
      setPendingDelete(null);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  useSetPageTitle(
    <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2 truncate">
      <IconTrash className="h-5 w-5 text-[#625DF5]" />
      Trash
    </h1>,
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-6 py-3 border-b border-border shrink-0 flex items-center gap-3 flex-wrap">
        <FilterBar value={filters} onChange={setFilters} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-md" />
            ))}
          </div>
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-16 w-16 rounded-full bg-[#625DF5]/10 flex items-center justify-center mb-4">
              <IconTrash className="h-8 w-8 text-[#625DF5]" />
            </div>
            <h2 className="text-lg font-semibold mb-1">Trash is empty</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Deleted calls will appear here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-md border border-border overflow-hidden">
            {calls.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 p-3 hover:bg-accent/40"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{c.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.deletedAt
                      ? `Deleted ${new Date(c.deletedAt).toLocaleDateString()}`
                      : "Deleted"}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestore(c.id)}
                  disabled={restoreCall.isPending}
                  className="gap-1.5"
                >
                  <IconRestore className="h-4 w-4" />
                  Restore
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingDelete(c)}
                  className="gap-1.5 text-destructive hover:text-destructive"
                >
                  <IconTrashX className="h-4 w-4" />
                  Delete permanently
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this call permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove "{pendingDelete?.title}", including
              its transcript, comments, and shared links. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
