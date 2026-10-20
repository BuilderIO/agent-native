import { IconX, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { useUpdateStatus } from "./UpdateIndicator.js";

export default function UpdatePrompt() {
  const status = useUpdateStatus();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

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
      data-update-prompt
    >
      <div className="update-prompt-body">
        <div id="update-prompt-title" className="update-prompt-title">
          Update ready
        </div>
        <div className="update-prompt-subtitle">
          Version {status.version} has been downloaded. Relaunch Agent-Native to
          finish installing.
        </div>
      </div>
      <div className="update-prompt-actions">
        <button
          type="button"
          className="update-prompt-btn update-prompt-btn--ghost"
          onClick={dismiss}
        >
          Later
        </button>
        <button
          type="button"
          className="update-prompt-btn update-prompt-btn--primary"
          onClick={installNow}
        >
          <IconRefresh size={14} strokeWidth={2} />
          Relaunch now
        </button>
      </div>
      <button
        type="button"
        className="update-prompt-close"
        onClick={dismiss}
        aria-label="Dismiss update prompt"
      >
        <IconX size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
