import { useT } from "@agent-native/core/client";
import { IconHistory, IconLoader2, IconRotate } from "@tabler/icons-react";
import { useState } from "react";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  type DashboardRevision,
  useDashboardRevisions,
  useRestoreDashboardRevision,
} from "@/hooks/use-dashboard-revisions";

function formatRelativeTime(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return dateStr;
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

interface DashboardHistoryPanelProps {
  dashboardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRestore?: boolean;
}

export function DashboardHistoryPanel({
  dashboardId,
  open,
  onOpenChange,
  canRestore = true,
}: DashboardHistoryPanelProps) {
  const t = useT();
  const { data: revisions, isLoading } = useDashboardRevisions(
    open ? dashboardId : null,
  );
  const restoreRevision = useRestoreDashboardRevision(dashboardId);
  const [pendingRestore, setPendingRestore] =
    useState<DashboardRevision | null>(null);

  const doRestore = async (revision: DashboardRevision) => {
    try {
      await restoreRevision.mutateAsync({
        dashboardId,
        revisionId: revision.id,
      });
      toast.success(t("dashboard.historyRestored"));
      setPendingRestore(null);
      onOpenChange(false);
    } catch {
      toast.error(t("dashboard.historyRestoreFailed"));
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[85vw] max-w-[420px] p-0">
          <SheetHeader className="px-4 pb-0 pt-4">
            <SheetTitle className="flex items-center gap-2 text-sm font-medium">
              <IconHistory size={16} />
              {t("dashboard.historyTitle")}
            </SheetTitle>
            <SheetDescription>
              {t("dashboard.historyDescription")}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-3 border-t border-border" />

          <div className="h-[calc(100%-96px)] overflow-y-auto p-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <IconLoader2
                  size={16}
                  className="animate-spin text-muted-foreground"
                />
              </div>
            ) : !revisions?.length ? (
              <div className="px-6 py-12 text-center text-xs text-muted-foreground">
                {t("dashboard.historyEmpty")}
              </div>
            ) : (
              <div className="space-y-1">
                {revisions.map((revision) => (
                  <div
                    key={revision.id}
                    className="rounded-lg border border-border bg-card p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">
                          {revision.title || t("common.untitledDashboard")}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {formatRelativeTime(revision.createdAt)}
                          {revision.createdBy
                            ? ` by ${revision.createdBy}`
                            : ""}
                        </p>
                      </div>
                      {canRestore ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 px-2 text-[11px]"
                          onClick={() => setPendingRestore(revision)}
                          disabled={restoreRevision.isPending}
                        >
                          {restoreRevision.isPending ? (
                            <IconLoader2 size={13} className="animate-spin" />
                          ) : (
                            <IconRotate size={13} />
                          )}
                          <span className="ml-1">
                            {t("dashboard.historyRestore")}
                          </span>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={pendingRestore !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingRestore(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dashboard.historyRestoreQuestion")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dashboard.historyRestoreWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRestore) void doRestore(pendingRestore);
              }}
            >
              {t("dashboard.historyRestore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
