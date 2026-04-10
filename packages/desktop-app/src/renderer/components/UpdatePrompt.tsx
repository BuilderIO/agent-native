import { useEffect, useState } from "react";
import { IconX, IconRefresh } from "@tabler/icons-react";
import { useUpdateStatus } from "./UpdateIndicator.js";

/**
 * One-time toast that appears the first time an update finishes downloading.
 * The user can install now or dismiss; either way the persistent sidebar
 * indicator stays visible so they can install later. Once dismissed for a
 * given version, we don't re-show the toast for that same version.
 */
export default function UpdatePrompt() {
  const status = useUpdateStatus();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  // Show whenever a download finishes for a version we haven't dismissed yet.
  useEffect(() => {
    if (status?.state === "downloaded" && status.version !== dismissedVersion) {
      setShown(true);
    }
  }, [status, dismissedVersion]);

  if (!shown || status?.state !== "downloaded") return null;

  const dismiss = () => {
    setShown(false);
    setDismissedVersion(status.version);
  };

  const installNow = () => {
    window.electronAPI?.updater.install();
  };

  return (
    <div
      className="update-prompt"
      role="alertdialog"
      aria-labelledby="update-prompt-title"
    >
      <div className="update-prompt-body">
        <div id="update-prompt-title" className="update-prompt-title">
          Update ready
        </div>
        <div className="update-prompt-subtitle">
          Version {status.version} has been downloaded. Restart Agent Native to
          finish installing.
        </div>
      </div>
      <div className="update-prompt-actions">
        <button
          type="button"
          tabIndex={-1}
          className="update-prompt-btn update-prompt-btn--ghost"
          onClick={dismiss}
        >
          Later
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="update-prompt-btn update-prompt-btn--primary"
          onClick={installNow}
        >
          <IconRefresh size={14} strokeWidth={2} />
          Restart now
        </button>
      </div>
      <button
        type="button"
        tabIndex={-1}
        className="update-prompt-close"
        onClick={dismiss}
        aria-label="Dismiss update prompt"
      >
        <IconX size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
