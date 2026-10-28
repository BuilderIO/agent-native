import {
  dedupeCollabUsersByEmail,
  type CollabUser,
} from "@agent-native/core/client/collab";
import { useT } from "@agent-native/core/client/i18n";
import type { DashboardChangeSummary } from "@shared/dashboard-change-summary";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import { dashboardChangeLine } from "@/components/dashboard/dashboard-change-text";

import type { DashboardSaveOutcome } from "./dashboard-save-queue";

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

/** What the toast's Undo takes back: one write, by the revision it left. */
export type DashboardSaveUndo = {
  revisionId: string;
  /** The version the write made; once someone saves over it, Undo fails. */
  updatedAt: string;
};

/**
 * Gives the page's saves one toast, replaced in place from "Saving…" to
 * "Saved" with Undo. Only the newest save on the open dashboard updates it,
 * and it offers Undo only when a save it covers changed the dashboard, even if
 * the newest one then failed or changed nothing. The toast names that write's
 * changes as history records them, and `onUndo` gets its revision and
 * version, so it undoes exactly that write, and a newer save by someone else
 * makes it fail instead of taking their change back. It must be stable; the
 * toast calls it after later renders.
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
  onUndo: (write: DashboardSaveUndo) => void;
}) {
  const t = useT();
  // Read when a save lands, which can be renders after it started.
  const otherViewersRef = useRef(otherViewers);
  useEffect(() => {
    otherViewersRef.current = otherViewers;
  }, [otherViewers]);
  const newestSaveRef = useRef(0);
  // After saves that changed nothing, Undo would take back an earlier edit.
  // The open toast covers saves from `firstCoveredSaveRef` (0 when none is
  // pending) through the newest.
  const firstCoveredSaveRef = useRef(0);
  const newestWriteRef = useRef<{
    save: number;
    undo: DashboardSaveUndo;
    changes: DashboardChangeSummary | null;
  } | null>(null);

  // Undo restores a revision of the open dashboard, so a toast must not
  // outlive its dashboard, and a save that lands after leaving it must not
  // bring the toast back.
  useEffect(() => {
    if (!dashboardId) return;
    return () => {
      newestSaveRef.current += 1;
      firstCoveredSaveRef.current = 0;
      toast.dismiss(`dashboard-save:${dashboardId}`);
    };
  }, [dashboardId]);

  return useCallback(
    <T extends DashboardSaveOutcome>(save: Promise<T>): Promise<T> => {
      if (!dashboardId) return save;
      const toastId = `dashboard-save:${dashboardId}`;
      const saveNumber = ++newestSaveRef.current;
      const isNewest = () => newestSaveRef.current === saveNumber;
      if (firstCoveredSaveRef.current === 0) {
        firstCoveredSaveRef.current = saveNumber;
      }
      toast.loading(
        shared
          ? t("dashboardSaveStatus.savingShared")
          : t("dashboardSaveStatus.saving"),
        { id: toastId },
      );
      // Runs once the newest save settles, whether or not it succeeded.
      const settle = () => {
        const write = newestWriteRef.current;
        const wrote = !!write && write.save >= firstCoveredSaveRef.current;
        firstCoveredSaveRef.current = 0;
        if (!write || !wrote) {
          toast.dismiss(toastId);
          return;
        }
        const viewers = otherViewersRef.current;
        // Named from the write Undo takes back, not the newest save, which
        // may have changed nothing or failed.
        toast.success(savedToastTitle(t, shared, write.changes), {
          id: toastId,
          description:
            viewers === 1
              ? t("dashboardSaveStatus.oneOtherViewer")
              : viewers > 1
                ? t("dashboardSaveStatus.otherViewers", { count: viewers })
                : undefined,
          action: {
            label: t("dashboard.undo"),
            onClick: () => onUndo(write.undo),
          },
          duration: 6000,
        });
      };
      save.then(
        ({ changed, updatedAt, revisionId, changes, omittedChanges }) => {
          if (changed && updatedAt && revisionId) {
            newestWriteRef.current = {
              save: saveNumber,
              undo: { revisionId, updatedAt },
              changes:
                changes && omittedChanges !== undefined
                  ? { changes, omitted: omittedChanges }
                  : null,
            };
          }
          if (isNewest()) settle();
        },
        () => {
          // The caller reports the failure itself.
          if (isNewest()) settle();
        },
      );
      return save;
    },
    [dashboardId, onUndo, shared, t],
  );
}

function savedToastTitle(
  t: ReturnType<typeof useT>,
  shared: boolean,
  summary: DashboardChangeSummary | null,
): string {
  const line = summary
    ? dashboardChangeLine(summary.changes, summary.omitted, t)
    : null;
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
