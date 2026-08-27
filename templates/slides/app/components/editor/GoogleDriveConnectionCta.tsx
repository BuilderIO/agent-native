import { agentNativePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";
import {
  IconBrandGoogleDrive,
  IconLoader2,
  IconPlugConnected,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../ui/button";

interface GoogleDocsStatus {
  configured: boolean;
  connected: boolean;
  googleSlidesUrlImportReady?: boolean;
  error?: string;
  message?: string;
}

interface GoogleDriveConnectionCtaProps {
  /** Only query and render for a detected pasted-link intent. */
  active?: boolean;
}

type JsonReadResult<T> = { ok: true; data: T } | { ok: false; error: Error };

function endpoint(path: string): string {
  return new URL(agentNativePath(path), window.location.origin).toString();
}

async function readJson<T>(response: Response): Promise<JsonReadResult<T>> {
  try {
    return { ok: true, data: (await response.json()) as T };
  } catch (caught) {
    const error = new Error("The server returned an unreadable response.");
    (error as Error & { cause?: unknown }).cause = caught;
    return {
      ok: false,
      error,
    };
  }
}

function responseError(
  response: Response,
  data: { error?: string; message?: string },
  fallback: string,
): Error {
  return new Error(
    data.message || data.error || `${fallback} (${response.status})`,
  );
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
        const response = await fetch(
          endpoint("/_agent-native/google-docs/status"),
          { credentials: "same-origin" },
        );
        const result = await readJson<GoogleDocsStatus>(response);
        if (!result.ok) throw result.error;
        if (!response.ok) {
          throw responseError(
            response,
            result.data,
            "Could not check Google Drive",
          );
        }
        setStatus(result.data);
        setError(null);
        return result.data;
      } catch (caught) {
        setStatus(null);
        setError(caught instanceof Error ? caught.message : String(caught));
        return null;
      } finally {
        setLoading(false);
      }
    }, []);

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
        {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
      </div>
      {displayStatus.configured && (
        <Button
          type="button"
          size="sm"
          onClick={() => void connect()}
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
