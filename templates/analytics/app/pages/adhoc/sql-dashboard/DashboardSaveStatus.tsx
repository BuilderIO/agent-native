import {
  dedupeCollabUsersByEmail,
  emailToName,
  type CollabUser,
} from "@agent-native/core/client/collab";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { DashboardChange } from "@shared/dashboard-change-summary";
import { IconLoader2 } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { dashboardChangeLine } from "@/components/dashboard/dashboard-change-text";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { DashboardSaveResult } from "./dashboard-save-queue";

export type DashboardSaveState =
  | { status: "saved" }
  | { status: "saving" }
  | { status: "failed"; message: string | null };

const AGENT_EMAIL = "agent@system";

/** People other than you with the dashboard open; the agent isn't counted. */
export function otherViewerCount(
  activeUsers: CollabUser[],
  currentUserEmail: string | undefined,
): number {
  const self = currentUserEmail?.trim().toLowerCase();
  return dedupeCollabUsersByEmail(activeUsers).filter((user) => {
    const email = user.email.trim().toLowerCase();
    return email !== AGENT_EMAIL && email !== self;
  }).length;
}

/**
 * Tracks the page's own saves: the header status reads `state`, and each save
 * gets one toast, replaced in place from "Saving…" to "Saved" with Undo, and
 * naming what the save changed when the caller passes `changes`.
 * `onUndo` must be stable; the toast calls it after later renders.
 */
export function useDashboardSaveFeedback({
  dashboardId,
  shared,
  otherViewers,
  onUndo,
}: {
  dashboardId: string | undefined;
  shared: boolean;
  otherViewers: number;
  onUndo: () => void;
}) {
  const t = useT();
  const [state, setState] = useState<DashboardSaveState>({ status: "saved" });
  // Read when a save lands, which can be renders after it started.
  const otherViewersRef = useRef(otherViewers);
  useEffect(() => {
    otherViewersRef.current = otherViewers;
  }, [otherViewers]);

  useEffect(() => {
    setState({ status: "saved" });
  }, [dashboardId]);

  const track = useCallback(
    <T extends DashboardSaveResult>(
      save: Promise<T>,
      changes?: DashboardChange[] | null,
    ): Promise<T> => {
      const toastId = `dashboard-save:${dashboardId}`;
      setState({ status: "saving" });
      toast.loading(
        shared
          ? t("dashboardSaveStatus.savingShared")
          : t("dashboardSaveStatus.saving"),
        { id: toastId },
      );
      save.then(
        ({ isLatest }) => {
          if (!isLatest) return;
          setState({ status: "saved" });
          const viewers = otherViewersRef.current;
          toast.success(savedToastTitle(t, shared, changes), {
            id: toastId,
            description:
              viewers === 1
                ? t("dashboardSaveStatus.oneOtherViewer")
                : viewers > 1
                  ? t("dashboardSaveStatus.otherViewers", { count: viewers })
                  : undefined,
            action: { label: t("dashboard.undo"), onClick: onUndo },
            duration: 6000,
          });
        },
        (error: unknown) => {
          setState({
            status: "failed",
            message: error instanceof Error ? error.message : null,
          });
          // The caller reports the failure itself; only the pending toast goes.
          toast.dismiss(toastId);
        },
      );
      return save;
    },
    [dashboardId, onUndo, shared, t],
  );

  return { state, track };
}

function savedToastTitle(
  t: ReturnType<typeof useT>,
  shared: boolean,
  changes: DashboardChange[] | null | undefined,
): string {
  const line = changes ? dashboardChangeLine(changes, 0, t) : null;
  if (!line) {
    return shared
      ? t("dashboardSaveStatus.savedShared")
      : t("dashboardSaveStatus.saved");
  }
  const change =
    line.moreCount > 0
      ? t("dashboardChanges.withMore", {
          change: line.first,
          count: line.moreCount,
        })
      : line.first;
  return shared
    ? t("dashboardSaveStatus.changeSavedShared", { change })
    : t("dashboardSaveStatus.changeSaved", { change });
}

export function DashboardSaveStatus({
  state,
  shared,
  updatedAt,
  updatedBy,
  currentUserEmail,
}: {
  state: DashboardSaveState;
  shared: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  currentUserEmail: string | undefined;
}) {
  const t = useT();
  const formatters = useFormatters();

  if (state.status === "saving") {
    return (
      <StatusPill>
        <IconLoader2 className="h-3 w-3 animate-spin" />
        {shared
          ? t("dashboardSaveStatus.savingShared")
          : t("dashboardSaveStatus.saving")}
      </StatusPill>
    );
  }

  if (state.status === "failed") {
    const pill = (
      <StatusPill className="border-destructive/40 text-destructive">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
        {t("dashboardSaveStatus.failed")}
      </StatusPill>
    );
    if (!state.message) return pill;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{pill}</TooltipTrigger>
        <TooltipContent className="max-w-xs">{state.message}</TooltipContent>
      </Tooltip>
    );
  }

  const when = formatSavedAt(updatedAt, formatters.formatDate);
  const who = updatedBy
    ? updatedBy.trim().toLowerCase() === currentUserEmail?.trim().toLowerCase()
      ? t("dashboardSaveStatus.you")
      : emailToName(updatedBy)
    : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <StatusPill>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-green)]" />
          {shared
            ? t("dashboardSaveStatus.savedShared")
            : t("dashboardSaveStatus.saved")}
          {when ? <span className="hidden sm:inline">· {when}</span> : null}
          {who ? <span className="hidden sm:inline">· {who}</span> : null}
        </StatusPill>
      </TooltipTrigger>
      <TooltipContent>
        {shared
          ? t("dashboardSaveStatus.sharedHint")
          : t("dashboardSaveStatus.privateHint")}
      </TooltipContent>
    </Tooltip>
  );
}

/** Time of day for a save today, otherwise the date. */
function formatSavedAt(
  value: string | null,
  formatDate: (value: string, options: Intl.DateTimeFormatOptions) => string,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatDate(
    value,
    date.toDateString() === new Date().toDateString()
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric" },
  );
}

function StatusPill({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      role="status"
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-normal text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
