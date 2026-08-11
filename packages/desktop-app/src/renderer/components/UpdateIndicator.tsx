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
    updater
      .getStatus()
      .then(setStatus)
      .catch(() => {});
    return updater.onStatusChange(setStatus);
  }, []);

  return status;
}

/**
 * Sidebar pill that becomes visible whenever an update is in flight or
 * ready to install. Hidden in idle / not-available / unsupported states so it
 * doesn't add visual noise.
 */
export function UpdateIndicator({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "rail";
}) {
  const status = useUpdateStatus();
  const itemClassName = (stateClassName: string) =>
    `${variant === "rail" ? "code-agents-nav-link" : "sidebar-item"} update-indicator ${stateClassName}`;
  const itemTabIndex = variant === "rail" ? undefined : -1;
  const iconSize = variant === "rail" ? 15 : 18;
  const icon = (element: React.ReactNode) =>
    variant === "rail" ? (
      element
    ) : (
      <span className="icon-wrapper">{element}</span>
    );
  const label = (value: string) => (
    <span className={variant === "rail" ? undefined : "item-label"}>
      {value}
    </span>
  );

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
        type="button"
        className={itemClassName("update-indicator--pending")}
        tabIndex={itemTabIndex}
        disabled
        title={`Update ${status.version} available — downloading…`}
        aria-label={`Update ${status.version} available`}
      >
        {icon(<IconDownload size={iconSize} strokeWidth={1.75} />)}
        {label("Update")}
      </button>
    );
  }

  if (status.state === "downloading") {
    return (
      <button
        type="button"
        className={itemClassName("update-indicator--downloading")}
        tabIndex={itemTabIndex}
        disabled
        title={`Downloading update — ${status.percent}%`}
        aria-label={`Downloading update, ${status.percent} percent`}
      >
        {icon(
          <IconLoader2 size={iconSize} strokeWidth={1.75} className="spin" />,
        )}
        {label(`${status.percent}%`)}
      </button>
    );
  }

  // Downloaded or local-dev production update — clicking restarts the app.
  return (
    <button
      type="button"
      className={itemClassName("update-indicator--ready")}
      tabIndex={itemTabIndex}
      onClick={() => window.electronAPI?.updater.install()}
      title={`Update ${status.version} ready — click to restart`}
      aria-label={`Restart to update Agent Native to version ${status.version}`}
    >
      {icon(<IconRefresh size={iconSize} strokeWidth={1.75} />)}
      {label("Restart to update")}
    </button>
  );
}
