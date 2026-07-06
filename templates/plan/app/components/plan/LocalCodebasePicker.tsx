import { setClientAppState, useT } from "@agent-native/core/client";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import {
  IconAlertCircle,
  IconCircleCheck,
  IconFolderOpen,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  chooseLocalCodebase,
  clearLocalCodebaseSelection,
  collectLocalCodebaseSnapshot,
  deleteLocalCodebaseResources,
  localCodebaseAppState,
  rememberLocalCodebaseSelection,
  restoreLocalCodebaseSelection,
  supportsLocalCodebasePicker,
  syncLocalCodebaseSnapshot,
  type LocalCodebaseSummary,
} from "@/lib/local-codebase-context";
import {
  deleteLocalControlResources,
  syncLocalControlResources,
} from "@/lib/local-control-resources";
import { cn } from "@/lib/utils";

type RestoredLocalCodebase = NonNullable<
  Awaited<ReturnType<typeof restoreLocalCodebaseSelection>>
>;

type SyncState =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const APP_STATE_SOURCE = "plan-local-codebase";

function fileCountLabel(summary: LocalCodebaseSummary) {
  return `${summary.capturedFileCount}/${summary.indexedFileCount} files`;
}

function updatedLabel(summary: LocalCodebaseSummary) {
  return new Date(summary.updatedAt).toLocaleString();
}

function statusClasses(kind: SyncState["kind"]) {
  if (kind === "error") return "text-destructive";
  if (kind === "success") return "text-emerald-600 dark:text-emerald-400";
  return "text-muted-foreground";
}

export function LocalCodebasePicker() {
  const t = useT();
  const queryClient = useQueryClient();
  const supported = useMemo(supportsLocalCodebasePicker, []);
  const [active, setActive] = useState<RestoredLocalCodebase | null>(null);
  const [summary, setSummary] = useState<LocalCodebaseSummary | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({ kind: "idle" });

  const syncAppState = useCallback(
    async (next: LocalCodebaseSummary | null) => {
      await setClientAppState("local-codebase", localCodebaseAppState(next), {
        requestSource: APP_STATE_SOURCE,
      }).catch(() => {
        // Best-effort context: chat still works, but view-screen may not mention it.
      });
    },
    [],
  );

  const cleanupLocalResources = useCallback(
    async (selection: Pick<RestoredLocalCodebase, "id" | "name">) => {
      const results = await Promise.allSettled([
        deleteLocalCodebaseResources({ id: selection.id }),
        deleteLocalControlResources({
          folderId: selection.id,
          folderName: selection.name,
        }),
      ]);
      const removedCount = results.reduce((count, result) => {
        if (result.status === "rejected") return count;
        return count + result.value.count;
      }, 0);

      for (const result of results) {
        if (result.status === "rejected") {
          console.warn(
            "[plan] local codebase resource cleanup failed",
            result.reason,
          );
        }
      }

      if (removedCount > 0) {
        await queryClient.invalidateQueries({ queryKey: ["resources"] });
      }
    },
    [queryClient],
  );

  useEffect(() => {
    let cancelled = false;
    restoreLocalCodebaseSelection()
      .then((restored) => {
        if (cancelled || !restored) return;
        setActive(restored);
        setSummary(restored.latest);
        void syncAppState(restored.latest);
      })
      .catch(() => {
        // Ignore restore failures; the user can choose the folder again.
      });
    return () => {
      cancelled = true;
    };
  }, [syncAppState]);

  const syncSelection = useCallback(
    async (selection: RestoredLocalCodebase) => {
      setSyncState({ kind: "syncing" });
      const snapshot = await collectLocalCodebaseSnapshot(selection);
      const { summary: nextSummary } =
        await syncLocalCodebaseSnapshot(snapshot);

      try {
        await syncLocalControlResources({
          folderId: selection.id,
          folderName: selection.name,
          files: snapshot.controlResources,
        });
      } catch (err) {
        console.warn("[plan] local control resource sync failed", err);
      }

      await rememberLocalCodebaseSelection({
        id: selection.id,
        name: selection.name,
        handle: selection.handle,
        latest: nextSummary,
      });
      setActive({ ...selection, latest: nextSummary });
      setSummary(nextSummary);
      await syncAppState(nextSummary);
      await queryClient.invalidateQueries({ queryKey: ["resources"] });
      setSyncState({
        kind: "success",
        message: t("raw.localCodebase.filesSynced", {
          count: fileCountLabel(nextSummary),
        }),
      });
      toast.success(t("raw.localCodebase.codebaseSynced"), {
        description: `${selection.name} is ready for Ask Plan.`,
      });
    },
    [queryClient, syncAppState],
  );

  const chooseFolder = useCallback(async () => {
    const chosen = await chooseLocalCodebase();
    if (chosen.ok === false) {
      if (!chosen.canceled) {
        setSyncState({ kind: "error", message: chosen.error });
        toast.error(t("raw.localCodebase.chooseFolderFailed"), {
          description: chosen.error,
        });
      }
      return;
    }

    const selection = {
      id: chosen.id,
      name: chosen.name,
      handle: chosen.handle,
      latest: null,
    };
    if (active && active.id !== selection.id) {
      await cleanupLocalResources(active);
    }
    setActive(selection);
    try {
      await syncSelection(selection);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("raw.localCodebase.syncLocalFailed");
      setSyncState({ kind: "error", message });
      toast.error(t("raw.localCodebase.codebaseSyncFailed"), {
        description: message,
      });
    }
  }, [active, cleanupLocalResources, syncSelection]);

  const clearSelection = useCallback(async () => {
    const previous = active;
    await clearLocalCodebaseSelection();
    setActive(null);
    setSummary(null);
    setSyncState({ kind: "idle" });
    await syncAppState(null);
    if (previous) {
      await cleanupLocalResources(previous);
    }
    toast(t("raw.localCodebase.codebaseUnlinked"));
  }, [active, cleanupLocalResources, syncAppState]);

  const resync = useCallback(async () => {
    if (!active) return;
    try {
      await syncSelection(active);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("raw.localCodebase.syncLocalFailed");
      setSyncState({ kind: "error", message });
      toast.error(t("raw.localCodebase.codebaseSyncFailed"), {
        description: message,
      });
    }
  }, [active, syncSelection]);

  if (!supported && !summary) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-2 rounded-md"
              disabled
            >
              <IconFolderOpen className="size-4" />
              {t("raw.localCodebase.chooseCodebase")}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t("raw.localCodebase.folderUnavailable")}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex min-h-8 max-w-full flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant={summary ? "outline" : "secondary"}
          size="sm"
          className="h-8 max-w-full gap-2 rounded-md"
          onClick={chooseFolder}
          disabled={syncState.kind === "syncing"}
        >
          <IconFolderOpen className="size-4 shrink-0" />
          <span className="truncate">
            {summary ? summary.name : t("raw.localCodebase.chooseCodebase")}
          </span>
        </Button>

        {summary && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="secondary"
                  className="h-8 max-w-[220px] gap-1.5 rounded-md px-2.5 font-normal"
                >
                  <IconCircleCheck className="size-3.5 shrink-0" />
                  <span className="truncate">{fileCountLabel(summary)}</span>
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {t("raw.localCodebase.lastSynced", {
                  date: updatedLabel(summary),
                })}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-md"
                  onClick={resync}
                  disabled={syncState.kind === "syncing"}
                  aria-label={t("raw.localCodebase.syncCodebase")}
                >
                  <IconRefresh
                    className={cn(
                      "size-4",
                      syncState.kind === "syncing" && "animate-spin",
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("raw.localCodebase.syncCodebase")}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-md"
                  onClick={clearSelection}
                  aria-label={t("raw.localCodebase.clearCodebase")}
                >
                  <IconX className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("raw.localCodebase.clearCodebase")}
              </TooltipContent>
            </Tooltip>
          </>
        )}

        {syncState.kind === "error" && (
          <span
            className={cn(
              "inline-flex min-h-8 max-w-[280px] items-center gap-1.5 truncate text-xs",
              statusClasses(syncState.kind),
            )}
          >
            <IconAlertCircle className="size-3.5 shrink-0" />
            <span className="truncate">{syncState.message}</span>
          </span>
        )}
      </div>
    </TooltipProvider>
  );
}
