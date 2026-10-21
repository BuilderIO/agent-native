import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useLocale } from "@agent-native/core/client/i18n";
import { IconAlertCircle, IconLoader2, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { classifySaveFailure } from "./workflow-errors";
import { useWorkflowStrings } from "./workflow-strings";
import { formatRelativeTime } from "./workflow-time";
import type {
  ListVersionsResult,
  RestoreWorkflowResult,
  WorkflowVersionRow,
} from "./workflow-types";

interface WorkflowVersionsPanelProps {
  factoryId: string;
  workflowId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A version to mark and scroll to, from a link. */
  highlightVersion?: number | null;
  /** The graph on screen has edits that a restore would discard. */
  dirty: boolean;
  enabled: boolean;
  /** Called after a restore is saved, so the page loads that graph. */
  onRestored: (result: RestoreWorkflowResult) => void;
}

/** The saved versions of one workflow, newest first, and a way back to any of them. */
export function WorkflowVersionsPanel({
  factoryId,
  workflowId,
  open,
  onOpenChange,
  highlightVersion = null,
  dirty,
  enabled,
  onRestored,
}: WorkflowVersionsPanelProps) {
  const ws = useWorkflowStrings();
  const { locale } = useLocale();

  const versionsQuery = useActionQuery<ListVersionsResult>(
    "list-factory-workflow-versions",
    { factoryId, workflowId, limit: 50 },
    { enabled: open },
  );
  const restore = useActionMutation<
    RestoreWorkflowResult,
    {
      factoryId: string;
      workflowId: string;
      version: number;
      expectedVersion: number;
    }
  >("restore-factory-workflow-version");
  const [confirming, setConfirming] = useState<WorkflowVersionRow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (open) setNow(Date.now());
  }, [open]);

  const data = versionsQuery.data;

  function runRestore(target: WorkflowVersionRow) {
    if (!data) return;
    restore.mutate(
      {
        factoryId,
        workflowId,
        version: target.version,
        expectedVersion: data.currentVersion,
      },
      {
        onSuccess: (result) => {
          setConfirming(null);
          onOpenChange(false);
          toast.success(ws.versions.restored(result.version));
          onRestored(result);
        },
        onError: (error) => {
          setConfirming(null);
          const failure = classifySaveFailure(error, ws.errors.unknown);
          toast.error(
            failure.kind === "graph_invalid"
              ? ws.versions.restoreInvalid(failure.issueCount)
              : ws.versions.restoreFailed,
            failure.kind === "graph_invalid"
              ? undefined
              : { description: failure.message },
          );
          void versionsQuery.refetch();
        },
      },
    );
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-sm"
          showClose={false}
          aria-describedby={undefined}
        >
          <SheetHeader className="flex-row items-center justify-between space-y-0 border-b border-border px-4 py-3">
            <SheetTitle>{ws.versions.panelTitle}</SheetTitle>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={ws.common.close}
                title={ws.common.close}
              >
                <IconX />
              </Button>
            </SheetClose>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {versionsQuery.isError && !data ? (
              <div className="flex items-center gap-2 p-4 text-sm text-destructive">
                <IconAlertCircle className="size-4 shrink-0" />
                <span>{ws.versions.loadFailed}</span>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => void versionsQuery.refetch()}
                >
                  {ws.versions.retry}
                </Button>
              </div>
            ) : !data ? (
              <div aria-hidden className="divide-y divide-border">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex flex-col gap-2 px-4 py-3">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data.versions.map((row) => (
                  <li
                    key={row.version}
                    ref={
                      row.version === highlightVersion
                        ? (element) =>
                            element?.scrollIntoView({ block: "nearest" })
                        : undefined
                    }
                    aria-current={row.version === highlightVersion || undefined}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3",
                      row.version === highlightVersion && "bg-accent",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {row.summary}
                        </span>
                        {row.current ? (
                          <Badge variant="secondary" className="shrink-0">
                            {ws.versions.current}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[
                          ws.versions.versionLabel(row.version),
                          row.source === "save"
                            ? null
                            : ws.versions.source[row.source],
                          row.createdBy,
                          formatRelativeTime(row.createdAt, now, locale),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    {row.current ? null : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={restore.isPending}
                        onClick={() => setConfirming(row)}
                      >
                        {ws.versions.restore}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next && !restore.isPending) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming ? ws.versions.confirmTitle(confirming.version) : null}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {[
                ws.versions.confirmBody,
                dirty ? ws.versions.confirmDiscards : null,
                enabled ? ws.versions.confirmSwitchesOff : null,
              ]
                .filter(Boolean)
                .join(" ")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restore.isPending}>
              {ws.versions.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={restore.isPending}
              onClick={(event) => {
                // Keep the dialog up until the restore answers.
                event.preventDefault();
                if (confirming) runRestore(confirming);
              }}
            >
              {restore.isPending ? (
                <IconLoader2 className="animate-spin" />
              ) : null}
              {ws.versions.restore}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
