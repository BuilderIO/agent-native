import { useState } from "react";
import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  useDocumentSyncStatus,
  useResolveDocumentSyncConflict,
} from "@/hooks/use-notion";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { toast } from "sonner";

interface NotionConflictBannerProps {
  documentId: string;
}

export function NotionConflictBanner({
  documentId,
}: NotionConflictBannerProps) {
  // Share autoSync state (and React Query cache) with DocumentToolbar.
  const [autoSync] = useLocalStorage(`notion-auto-sync:${documentId}`, false);
  const { data: syncStatus } = useDocumentSyncStatus(documentId, { autoSync });
  const resolveConflict = useResolveDocumentSyncConflict(documentId);
  const [direction, setDirection] = useState<"pull" | "push" | null>(null);

  if (!syncStatus?.hasConflict) return null;

  const handleResolve = async (dir: "pull" | "push") => {
    setDirection(dir);
    try {
      await resolveConflict.mutateAsync({ direction: dir });
      toast.success(
        dir === "pull"
          ? "Resolved — pulled from Notion."
          : "Resolved — pushed local version.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Resolve failed.");
    } finally {
      setDirection(null);
    }
  };

  const isWorking = resolveConflict.isPending;

  return (
    <div className="shrink-0 border-b border-amber-500/40 bg-amber-100/80 dark:bg-amber-500/10">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-8 md:px-16">
        <IconAlertTriangle
          size={18}
          className="shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div className="mr-auto min-w-0">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            Notion sync paused — conflict detected
          </p>
          <p className="text-xs text-amber-800/80 dark:text-amber-200/80">
            Both this document and the Notion page changed since the last sync.
            Pick which version to keep.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="bg-white text-amber-900 hover:bg-amber-50 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/40 dark:border-amber-700"
            onClick={() => handleResolve("pull")}
            disabled={isWorking}
          >
            {direction === "pull" ? (
              <IconLoader2 size={14} className="mr-1.5 animate-spin" />
            ) : null}
            Use Notion version
          </Button>
          <Button
            size="sm"
            className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
            onClick={() => handleResolve("push")}
            disabled={isWorking}
          >
            {direction === "push" ? (
              <IconLoader2 size={14} className="mr-1.5 animate-spin" />
            ) : null}
            Use local version
          </Button>
        </div>
      </div>
    </div>
  );
}
