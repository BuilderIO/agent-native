import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { getDesktopContentFiles } from "../lib/desktop-content-files";
import { syncLiveLocalFolder } from "../lib/local-folder-live-sync";
import { connectTemporaryLocalFolder } from "../lib/local-folder-live-sync";

const RECONCILE_DELAY_MS = 120;

export function LocalFolderLiveSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const desktop = getDesktopContentFiles();
    if (!desktop?.onChange || !desktop.subscribeChanges) return;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let active = true;

    const reconcile = (folderId: string) => {
      const current = timers.get(folderId);
      if (current) clearTimeout(current);
      timers.set(
        folderId,
        setTimeout(() => {
          timers.delete(folderId);
          void desktop
            .getFolder({ folderId })
            .then(async (folderResult) => {
              if (!folderResult.ok) return { synced: false as const };
              await connectTemporaryLocalFolder(folderResult.folder);
              return syncLiveLocalFolder(folderId);
            })
            .then((outcome) => {
              if (!active || !outcome.synced) return;
              queryClient.invalidateQueries({
                queryKey: ["action", "list-documents"],
              });
              queryClient.invalidateQueries({
                queryKey: ["action", "get-document"],
              });
              queryClient.invalidateQueries({
                queryKey: ["action", "get-content-database"],
              });
            })
            .catch(() => {
              // A later watcher event or ordinary launch reconciliation retries.
            });
        }, RECONCILE_DELAY_MS),
      );
    };

    const removeListener = desktop.onChange((event) =>
      reconcile(event.folderId),
    );
    const reconcileAll = () =>
      void desktop.getFolder().then((result) => {
        if (!active || !result.ok) return;
        for (const folder of result.folders ?? [result.folder]) {
          if (!folder.id) continue;
          void desktop.subscribeChanges?.({ folderId: folder.id });
          reconcile(folder.id);
        }
      });
    reconcileAll();
    const boundedReconciliation = window.setInterval(reconcileAll, 5_000);

    return () => {
      active = false;
      window.clearInterval(boundedReconciliation);
      removeListener();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [queryClient]);

  return null;
}
