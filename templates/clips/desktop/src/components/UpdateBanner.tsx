import { useState } from "react";
import { useUpdateStatus, installAndRestart } from "../lib/updater";

/**
 * Compact banner that slots into the top of the popover whenever an update
 * is in flight or ready. Kept tight so it doesn't push the recording
 * controls off-screen. Hidden in idle / checking / not-available states.
 */
export function UpdateBanner() {
  const status = useUpdateStatus();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  if (status.state === "idle") return null;
  if (status.state === "checking") return null;
  if (status.state === "not-available") return null;
  if (status.state === "error") return null;

  // User dismissed for this version — don't keep nagging.
  if (
    (status.state === "available" ||
      status.state === "downloading" ||
      status.state === "downloaded") &&
    status.version === dismissedVersion
  ) {
    return null;
  }

  if (status.state === "available") {
    return (
      <div className="update-banner update-banner--pending">
        <DownloadIcon />
        <span className="update-banner-text">
          Update {status.version} available — downloading…
        </span>
      </div>
    );
  }

  if (status.state === "downloading") {
    return (
      <div className="update-banner update-banner--pending">
        <SpinnerIcon />
        <span className="update-banner-text">
          Downloading update… {status.percent}%
        </span>
      </div>
    );
  }

  // downloaded → actionable restart
  return (
    <div className="update-banner update-banner--ready">
      <span className="update-banner-text">
        Update {status.version} ready — restart to install.
      </span>
      <div className="update-banner-actions">
        <button
          type="button"
          className="update-banner-btn update-banner-btn--ghost"
          onClick={() => setDismissedVersion(status.version)}
        >
          Later
        </button>
        <button
          type="button"
          className="update-banner-btn update-banner-btn--primary"
          onClick={() => {
            installAndRestart().catch((err) => {
              console.error("[clips-updater] relaunch failed:", err);
            });
          }}
        >
          Restart
        </button>
      </div>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className="update-spinner"
      aria-hidden
    >
      <path
        d="M12 3a9 9 0 019 9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
