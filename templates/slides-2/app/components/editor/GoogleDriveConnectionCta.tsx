import { useT } from "@agent-native/core/client/i18n";
import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";
import {
  IconBrandGoogleDrive,
  IconLoader2,
  IconPlugConnected,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import {
  getGoogleDocsStatus,
  googleDocsRouteErrorMessage,
  type GoogleDocsStatus,
} from "@/lib/google-docs-client";

import { Button } from "../ui/button";

interface GoogleDriveConnectionCtaProps {
  active?: boolean;
}

export function GoogleDriveConnectionCta({
  active = true,
}: GoogleDriveConnectionCtaProps) {
  const t = useT();
  const [status, setStatus] = useState<GoogleDocsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const refreshStatus =
    useCallback(async (): Promise<GoogleDocsStatus | null> => {
      try {
        const response = await getGoogleDocsStatus();
        if (response.unreadable) {
          throw new Error(t("raw.googleDriveUnreadableResponse"));
        }
        if (!response.ok) {
          throw new Error(
            googleDocsRouteErrorMessage(
              response,
              t("raw.googleDriveCheckFailedStatus", {
                status: response.status,
              }),
            ),
          );
        }
        setStatus(response.data);
        setError(null);
        return response.data;
      } catch (caught) {
        setStatus(null);
        setError(caught instanceof Error ? caught.message : String(caught));
        return null;
      } finally {
        setLoading(false);
      }
    }, [t]);

  useEffect(() => {
    if (!active) {
      setStatus(null);
      setError(null);
      setDismissed(false);
      setConnecting(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setDismissed(false);
    void refreshStatus();
  }, [active, refreshStatus]);

  const needsReconnect =
    status?.connected === true && status.googleSlidesUrlImportReady === false;
  const connect = useCallback(() => {
    if (connecting) return;
    setConnecting(true);
    setError(null);
    startWorkspaceProviderOAuth("google_drive", {
      appId: "slides",
      returnPath: `${window.location.pathname}${window.location.search}`,
      scope: "user",
    });
  }, [connecting]);

  if (
    !active ||
    dismissed ||
    loading ||
    (status?.connected && !needsReconnect)
  ) {
    return null;
  }

  const displayStatus = status ?? { configured: false, connected: false };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-xs">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background">
        {connecting ? (
          <IconLoader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : (
          <IconBrandGoogleDrive className="size-3.5 text-primary" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">
          Google Drive {/* i18n-ignore stable provider label */}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          {displayStatus.configured
            ? t("home.googleSlidesReferenceConnect")
            : t("raw.googleOAuthNotConfigured")}
        </p>
        {displayStatus.googleSlidesUrlImportError && (
          <p className="mt-1 text-[11px] text-destructive">
            {displayStatus.googleSlidesUrlImportError}
          </p>
        )}
        {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
      </div>
      {displayStatus.configured && (
        <Button
          type="button"
          size="sm"
          onClick={() => connect()}
          disabled={connecting}
          aria-busy={connecting}
          className="h-7 shrink-0 gap-1.5 rounded-md px-2.5 text-[11px] disabled:cursor-wait"
        >
          {connecting ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : (
            <IconPlugConnected className="size-3.5" />
          )}
          {connecting
            ? t("home.googleSlidesReferencePicking")
            : t("editorExport.connectGoogle")}
        </Button>
      )}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("comments.close")}
      >
        <IconX className="size-3.5" />
      </button>
    </div>
  );
}
