import {
  dedupeCollabUsersByEmail,
  type CollabUser,
} from "@agent-native/core/client/collab";
import { useT } from "@agent-native/core/client/i18n";
import type { DashboardChange } from "@shared/dashboard-change-summary";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import { dashboardChangeLine } from "@/components/dashboard/dashboard-change-text";

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
 * Gives the page's saves one toast, replaced in place from "Saving…" to
 * "Saved" with Undo, naming what the save changed when the caller passes
 * `changes`. Only the newest save on the open dashboard updates it, and it
 * offers Undo only when a save it covers changed the dashboard, even if the
 * newest one then failed. `onUndo` gets the version that write left, so a
 * newer save by someone else makes the undo fail instead of taking their
 * change back. It must be stable; the toast calls it after later renders.
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
  onUndo: (savedUpdatedAt: string) => void;
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
  const newestWriteRef = useRef<{ save: number; updatedAt: string } | null>(
    null,
  );

  // Undo restores the open dashboard's newest revision, so a toast must not
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
    <T extends { changed: boolean; updatedAt?: string }>(
      save: Promise<T>,
      changes?: DashboardChange[] | null,
    ): Promise<T> => {
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
      const settle = (named: DashboardChange[] | null | undefined) => {
        const write = newestWriteRef.current;
        const wrote = !!write && write.save >= firstCoveredSaveRef.current;
        firstCoveredSaveRef.current = 0;
        if (!write || !wrote) {
          toast.dismiss(toastId);
          return;
        }
        const viewers = otherViewersRef.current;
        toast.success(savedToastTitle(t, shared, named), {
          id: toastId,
          description:
            viewers === 1
              ? t("dashboardSaveStatus.oneOtherViewer")
              : viewers > 1
                ? t("dashboardSaveStatus.otherViewers", { count: viewers })
                : undefined,
          action: {
            label: t("dashboard.undo"),
            onClick: () => onUndo(write.updatedAt),
          },
          duration: 6000,
        });
      };
      save.then(
        ({ changed, updatedAt }) => {
          if (changed && updatedAt) {
            newestWriteRef.current = { save: saveNumber, updatedAt };
          }
          if (isNewest()) settle(changes);
        },
        () => {
          // The caller reports the failure itself. These changes didn't
          // land, so a toast for an earlier write doesn't name them.
          if (isNewest()) settle(null);
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
