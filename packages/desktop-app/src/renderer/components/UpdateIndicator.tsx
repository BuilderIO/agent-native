import { IconDownload, IconRefresh, IconLoader2 } from "@tabler/icons-react";
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

/**
 * Chat-first rail action that becomes visible whenever an update is in flight
 * or ready to install. The check action stays in the rail so the updater is
 * discoverable in both expanded and collapsed navigation states.
 */
export function UpdateIndicator() {
  const status = useUpdateStatus();
  const updater = window.electronAPI?.updater;
  const itemClassName = (stateClassName: string) =>
    `code-agents-nav-link update-indicator ${stateClassName}`;
  const iconSize = 15;

  if (!updater || !status) return null;

  // Local development builds cannot install a release, so do not add a dead
  // control to that surface.
  if (status.state === "unsupported") {
    return null;
  }

  const checkForUpdates = () => {
    void updater.check().catch(() => {});
  };

  if (status.state === "idle" || status.state === "not-available") {
    return (
      <button
        type="button"
        className={itemClassName("update-indicator--check")}
        onClick={checkForUpdates}
        title={
          status.state === "not-available"
            ? `Up to date - version ${status.currentVersion}. Check again`
            : "Check for updates"
        }
        aria-label="Check for updates"
        data-update-indicator
      >
        <IconRefresh size={iconSize} strokeWidth={1.75} />
        <span>Check for updates</span>
      </button>
    );
  }

  if (status.state === "checking") {
    return (
      <button
        type="button"
        className={itemClassName("update-indicator--checking")}
        disabled
        title="Checking for updates..."
        aria-label="Checking for updates"
        data-update-indicator
      >
        <IconLoader2 size={iconSize} strokeWidth={1.75} className="spin" />
        <span>Checking for updates...</span>
      </button>
    );
  }

  if (status.state === "error") {
    return (
      <button
        type="button"
        className={itemClassName("update-indicator--error")}
        onClick={checkForUpdates}
        title="Update check failed - click to retry"
        aria-label="Retry update check"
        data-update-indicator
      >
        <IconRefresh size={iconSize} strokeWidth={1.75} />
        <span>Retry update check</span>
      </button>
    );
  }

  if (status.state === "available") {
    // Auto-download starts immediately, so this is usually a brief flash
    // before "downloading" arrives. Render a subtle pending state.
    return (
      <button
        type="button"
        className={itemClassName("update-indicator--pending")}
        disabled
        title={`Update ${status.version} available - downloading...`}
        aria-label={`Update ${status.version} available`}
        data-update-indicator
      >
        <IconDownload size={iconSize} strokeWidth={1.75} />
        <span>Update</span>
      </button>
    );
  }

  if (status.state === "downloading") {
    return (
      <button
        type="button"
        className={itemClassName("update-indicator--downloading")}
        disabled
        title={`Downloading update - ${status.percent}%`}
        aria-label={`Downloading update, ${status.percent} percent`}
        data-update-indicator
      >
        <IconLoader2 size={iconSize} strokeWidth={1.75} className="spin" />
        <span>{status.percent}%</span>
      </button>
    );
  }

  // Downloaded or local-dev production update — clicking restarts the app.
  return (
    <button
      type="button"
      className={itemClassName("update-indicator--ready")}
      onClick={() => window.electronAPI?.updater.install()}
      title={`Update ${status.version} ready - click to restart`}
      aria-label={`Restart to update Agent Native to version ${status.version}`}
      data-update-indicator
    >
      <IconRefresh size={iconSize} strokeWidth={1.75} />
      <span>Restart to update</span>
    </button>
  );
}
