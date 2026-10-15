import {
  dedupeCollabUsersByEmail,
  type CollabUser,
} from "@agent-native/core/client/collab";
import { useT } from "@agent-native/core/client/i18n";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

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
 * "Saved" with Undo. Only the newest save on the open dashboard updates it,
 * and it offers Undo only when a save it covers changed the dashboard.
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
  const newestWriteRef = useRef(0);

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
    <T extends { changed: boolean }>(save: Promise<T>): Promise<T> => {
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
      save.then(
        ({ changed }) => {
          if (changed) {
            newestWriteRef.current = Math.max(
              newestWriteRef.current,
              saveNumber,
            );
          }
          if (!isNewest()) return;
          const wrote = newestWriteRef.current >= firstCoveredSaveRef.current;
          firstCoveredSaveRef.current = 0;
          if (!wrote) {
            toast.dismiss(toastId);
            return;
          }
          const viewers = otherViewersRef.current;
          toast.success(
            shared
              ? t("dashboardSaveStatus.savedShared")
              : t("dashboardSaveStatus.saved"),
            {
              id: toastId,
              description:
                viewers === 1
                  ? t("dashboardSaveStatus.oneOtherViewer")
                  : viewers > 1
                    ? t("dashboardSaveStatus.otherViewers", { count: viewers })
                    : undefined,
              action: { label: t("dashboard.undo"), onClick: onUndo },
              duration: 6000,
            },
          );
        },
        () => {
          // The caller reports the failure itself; only the pending toast goes.
          if (!isNewest()) return;
          firstCoveredSaveRef.current = 0;
          toast.dismiss(toastId);
        },
      );
      return save;
    },
    [dashboardId, onUndo, shared, t],
  );
}
