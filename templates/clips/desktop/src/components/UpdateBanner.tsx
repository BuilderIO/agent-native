import {
  IconCheck,
  IconDownload,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import {
  installAndRestart,
  retryUpdateCheck,
  useUpdateStatus,
} from "../lib/updater";

/**
 * An explicit shadcn alert keeps update state discoverable in the compact
 * popover. Settings no longer carries a detached dot that users have to infer.
 */
export function UpdateBanner() {
  const status = useUpdateStatus();
  const [dismissedErrorMessage, setDismissedErrorMessage] = useState<
    string | null
  >(null);

  if (
    status.state === "idle" ||
    status.state === "checking" ||
    status.state === "not-available"
  ) {
    return null;
  }

  if (status.state === "error") {
    if (status.message === dismissedErrorMessage) return null;
    return (
      <Alert
        variant="destructive"
        className="update-banner update-banner--error p-2 text-xs"
      >
        <span className="update-banner-icon" aria-hidden>
          <IconRefresh size={16} stroke={1.8} />
        </span>
        <div className="update-banner-copy">
          <AlertTitle className="mb-0">Update check failed</AlertTitle>
          <AlertDescription className="update-banner-description text-[11px] leading-tight">
            {status.message}
          </AlertDescription>
        </div>
        <div className="update-banner-actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDismissedErrorMessage(status.message)}
          >
            Dismiss
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              retryUpdateCheck().catch((err) => {
                console.error("[clips-updater] retry failed:", err);
              });
            }}
          >
            Retry
          </Button>
        </div>
      </Alert>
    );
  }

  if (status.state === "available") {
    return (
      <Alert className="update-banner update-banner--pending p-2 text-xs">
        <span className="update-banner-icon" aria-hidden>
          <IconDownload size={16} stroke={1.8} />
        </span>
        <div className="update-banner-copy">
          <AlertTitle className="mb-0">Update available</AlertTitle>
          <AlertDescription className="update-banner-description text-[11px] leading-tight">
            Downloading the latest version…
          </AlertDescription>
        </div>
      </Alert>
    );
  }

  if (status.state === "downloading") {
    return (
      <Alert className="update-banner update-banner--pending p-2 text-xs">
        <span className="update-banner-icon" aria-hidden>
          <IconLoader2 size={16} stroke={1.8} className="animate-spin" />
        </span>
        <div className="update-banner-copy">
          <AlertTitle className="mb-0">Downloading update</AlertTitle>
          <AlertDescription className="update-banner-description text-[11px] leading-tight">
            {status.percent}% complete
          </AlertDescription>
        </div>
      </Alert>
    );
  }

  return (
    <Alert className="update-banner update-banner--ready p-2 text-xs">
      <span className="update-banner-icon" aria-hidden>
        <IconCheck size={16} stroke={1.9} />
      </span>
      <div className="update-banner-copy">
        <AlertTitle className="mb-0">Update ready</AlertTitle>
        <AlertDescription className="update-banner-description text-[11px] leading-tight">
          Restart Clips to install it.
        </AlertDescription>
      </div>
      <div className="update-banner-actions">
        <Button
          type="button"
          size="sm"
          className="h-8 px-2.5 text-xs"
          onClick={() => {
            installAndRestart().catch((err) => {
              console.error("[clips-updater] relaunch failed:", err);
            });
          }}
        >
          Update
        </Button>
      </div>
    </Alert>
  );
}
