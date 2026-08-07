import { agentNativePath } from "@agent-native/core/client/api-path";
import { oauthRedirectUri } from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconBrandGoogleDrive,
  IconLoader2,
  IconPlugConnected,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../ui/button";

interface GoogleDocsStatus {
  configured: boolean;
  connected: boolean;
  error?: string;
  message?: string;
}

interface GoogleDocsAuthResponse {
  url?: string;
  error?: string;
  message?: string;
}

type JsonReadResult<T> = { ok: true; data: T } | { ok: false; error: Error };

function endpoint(path: string): string {
  return new URL(agentNativePath(path), window.location.origin).toString();
}

async function readJson<T>(response: Response): Promise<JsonReadResult<T>> {
  try {
    return { ok: true, data: (await response.json()) as T };
  } catch (caught) {
    return {
      ok: false,
      error: new Error("The server returned an unreadable response.", {
        cause: caught,
      }),
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

export interface GoogleDriveConnectionCtaProps {
  onConnected?: () => void;
}

export function GoogleDriveConnectionCta({
  onConnected,
}: GoogleDriveConnectionCtaProps) {
  const t = useT();
  const [status, setStatus] = useState<GoogleDocsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    void refreshStatus();
  }, [refreshStatus]);

  const connect = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    setError(null);
    const popup = window.open(
      "about:blank",
      "google-docs-oauth",
      "popup,width=520,height=720",
    );
    try {
      const authUrl = new URL(endpoint("/_agent-native/google-docs/auth-url"));
      authUrl.searchParams.set(
        "redirect_uri",
        oauthRedirectUri("/_agent-native/google-docs/callback"),
      );
      authUrl.searchParams.set(
        "return",
        window.location.pathname + window.location.search,
      );
      const response = await fetch(authUrl.toString(), {
        credentials: "same-origin",
      });
      const result = await readJson<GoogleDocsAuthResponse>(response);
      if (!result.ok) throw result.error;
      if (!response.ok || !result.data.url) {
        throw responseError(
          response,
          result.data,
          "Could not start Google OAuth",
        );
      }
      if (!popup) {
        window.location.href = result.data.url;
        return;
      }
      popup.location.href = result.data.url;

      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline && !popup.closed) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_200));
        const next = await refreshStatus();
        if (next?.connected) {
          popup.close();
          onConnected?.();
          return;
        }
      }
      const next = await refreshStatus();
      if (next?.connected) onConnected?.();
    } catch (caught) {
      popup?.close();
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setConnecting(false);
    }
  }, [connecting, onConnected, refreshStatus]);

  if (loading || status?.connected) return null;

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
    </div>
  );
}
