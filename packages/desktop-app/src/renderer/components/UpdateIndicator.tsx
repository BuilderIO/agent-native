import { IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";

/**
 * Subscribes to auto-update status from the main process. Returns the latest
 * UpdateStatus, or null if Electron isn't available (e.g. browser preview).
 */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const updater = window.electronAPI?.updater;
    if (!updater) return;
    let disposed = false;
    let receivedStatusChange = false;
    const unsubscribe = updater.onStatusChange((nextStatus) => {
      receivedStatusChange = true;
      if (!disposed) setStatus(nextStatus);
    });
    void updater
      .getStatus()
      .then((nextStatus) => {
        // The IPC read and the event subscription race during startup. Do not
        // let a stale read put the rail back into an earlier state after the
        // main process has already broadcast a newer one.
        if (!disposed && !receivedStatusChange) setStatus(nextStatus);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return status;
}

/** Chat-first rail action for an update that is ready to install. */
export function UpdateIndicator() {
  const status = useUpdateStatus();
  const updater = window.electronAPI?.updater;

  if (!updater || status?.state !== "downloaded") return null;

  return (
    <button
      type="button"
      className="code-agents-nav-link update-indicator update-indicator--ready"
      onClick={() => updater.install()}
      title={`Update ${status.version} ready - click to restart`}
      aria-label={`Restart to update Agent Native to version ${status.version}`}
      data-update-indicator
    >
      <IconRefresh size={15} strokeWidth={1.75} />
      <span>Restart to update</span>
    </button>
  );
}
