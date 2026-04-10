import { useEffect, useState } from "react";
import { IconDownload, IconRefresh, IconLoader2 } from "@tabler/icons-react";

/**
 * Subscribes to auto-update status from the main process. Returns the latest
 * UpdateStatus, or null if Electron isn't available (e.g. browser preview).
 */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const updater = window.electronAPI?.updater;
    if (!updater) return;
    updater.getStatus().then(setStatus);
    return updater.onStatusChange(setStatus);
  }, []);

  return status;
}

/**
 * Sidebar pill that becomes visible whenever an update is in flight or
 * ready to install. Hidden in idle / not-available / dev / unsupported
 * states so it doesn't add visual noise.
 */
export function UpdateIndicator() {
  const status = useUpdateStatus();

  if (!status) return null;

  // Hide when there's nothing to show.
  if (
    status.state === "idle" ||
    status.state === "checking" ||
    status.state === "not-available" ||
    status.state === "unsupported"
  ) {
    return null;
  }

  if (status.state === "error") {
    // Errors are non-actionable from the UI; let the next periodic check retry.
    return null;
  }

  if (status.state === "available") {
    // Auto-download starts immediately, so this is usually a brief flash
    // before "downloading" arrives. Render a subtle pending state.
    return (
      <button
        className="sidebar-item update-indicator update-indicator--pending"
        tabIndex={-1}
        title={`Update ${status.version} available — downloading…`}
        aria-label={`Update ${status.version} available`}
      >
        <span className="icon-wrapper">
          <IconDownload size={18} strokeWidth={1.75} />
        </span>
        <span className="item-label">Update</span>
      </button>
    );
  }

  if (status.state === "downloading") {
    return (
      <button
        className="sidebar-item update-indicator update-indicator--downloading"
        tabIndex={-1}
        title={`Downloading update — ${status.percent}%`}
        aria-label={`Downloading update, ${status.percent} percent`}
      >
        <span className="icon-wrapper">
          <IconLoader2 size={18} strokeWidth={1.75} className="spin" />
        </span>
        <span className="item-label">{status.percent}%</span>
      </button>
    );
  }

  // Downloaded — clicking restarts the app and applies the update.
  return (
    <button
      className="sidebar-item update-indicator update-indicator--ready"
      tabIndex={-1}
      onClick={() => window.electronAPI?.updater.install()}
      title={`Update ${status.version} ready — click to restart`}
      aria-label={`Update ${status.version} ready, click to restart`}
    >
      <span className="icon-wrapper">
        <IconRefresh size={18} strokeWidth={1.75} />
      </span>
      <span className="item-label">Restart</span>
    </button>
  );
}
