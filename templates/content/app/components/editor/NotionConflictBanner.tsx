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
    <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b border-amber-500/40 bg-amber-100/80 dark:bg-amber-500/10 sm:px-8 md:px-16">
      <IconAlertTriangle
        size={14}
        className="shrink-0 text-amber-600 dark:text-amber-400"
      />
      <span className="text-xs text-amber-900 dark:text-amber-100 mr-auto">
        Notion sync conflict — both sides changed
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs text-amber-900 hover:bg-amber-200/60 dark:text-amber-100 dark:hover:bg-amber-800/40"
        onClick={() => handleResolve("pull")}
        disabled={isWorking}
      >
        {direction === "pull" ? (
          <IconLoader2 size={12} className="mr-1 animate-spin" />
        ) : null}
        Use Notion
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs text-amber-900 hover:bg-amber-200/60 dark:text-amber-100 dark:hover:bg-amber-800/40"
        onClick={() => handleResolve("push")}
        disabled={isWorking}
      >
        {direction === "push" ? (
          <IconLoader2 size={12} className="mr-1 animate-spin" />
        ) : null}
        Use local
      </Button>
    </div>
  );
}
