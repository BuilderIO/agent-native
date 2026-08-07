import { agentNativePath } from "@agent-native/core/client/api-path";
import { useActionMutation } from "@agent-native/core/client/hooks";
import { oauthRedirectUri } from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconBrandGoogleDrive,
  IconFolderOpen,
  IconLoader2,
  IconPlugConnected,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

declare global {
  interface Window {
    gapi?: any;
    google?: any;
    __googlePickerScriptPromise?: Promise<void>;
  }
}

interface GoogleDocsStatus {
  configured: boolean;
  connected: boolean;
  pickerConfigured: boolean;
  accounts: Array<{ email: string; scope?: string }>;
  error?: string;
}

interface PickerToken {
  accessToken: string;
  accountEmail: string;
  apiKey: string;
  appId: string;
  error?: string;
  message?: string;
}

interface GoogleSlidesReferenceImportProps {
  onImported: (imported: { id: string; title: string }) => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  title: string;
  chooseLabel: string;
  connectLabel: string;
  pickingLabel: string;
  connectedLabel: string;
  unavailableLabel: string;
}

function endpoint(path: string): string {
  return new URL(agentNativePath(path), window.location.origin).toString();
}

type JsonReadResult<T> = { ok: true; data: T } | { ok: false; error: Error };

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

function errorFromResponse(
  response: Response,
  data: { error?: string; message?: string },
  fallback: string,
): string {
  return data.message || data.error || `${fallback} (${response.status})`;
}

function loadGooglePickerScript(): Promise<void> {
  if (window.gapi) return Promise.resolve();
  if (!window.__googlePickerScriptPromise) {
    window.__googlePickerScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Google Picker."));
      document.head.appendChild(script);
    });
  }
  return window.__googlePickerScriptPromise;
}

function loadPickerApi(): Promise<void> {
  return new Promise((resolve, reject) => {
    const gapi = window.gapi;
    if (!gapi) {
      reject(new Error("Google Picker did not load."));
      return;
    }
    gapi.load("picker", {
      callback: () => resolve(),
      onerror: () => reject(new Error("Could not load Google Picker.")),
    });
  });
}

export function GoogleSlidesReferenceImport({
  onImported,
  onBusyChange,
  title,
  chooseLabel,
  connectLabel,
  pickingLabel,
  connectedLabel,
  unavailableLabel,
}: GoogleSlidesReferenceImportProps) {
  const t = useT();
  const [status, setStatus] = useState<GoogleDocsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const importMutation = useActionMutation("import-google-slides-reference");

  const refreshStatus =
    useCallback(async (): Promise<GoogleDocsStatus | null> => {
      try {
        const response = await fetch(
          endpoint("/_agent-native/google-docs/status"),
          {
            credentials: "same-origin",
          },
        );
        const result = await readJson<GoogleDocsStatus>(response);
        if (!result.ok) throw result.error;
        if (!response.ok) {
          throw new Error(
            errorFromResponse(
              response,
              result.data,
              "Could not check Google Drive",
            ),
          );
        }
        if (!result.data) {
          throw new Error("Google Drive status was empty.");
        }
        setError(null);
        setStatus(result.data);
        return result.data;
      } catch (caught) {
        setStatus(null);
        setError(caught instanceof Error ? caught.message : String(caught));
        return null;
      }
    }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const reportBusy = useCallback(
    (busy: boolean) => {
      onBusyChange?.(busy);
    },
    [onBusyChange],
  );

  const connect = useCallback(async () => {
    setConnecting(true);
    reportBusy(true);
    setError(null);
    const popup = window.open(
      "about:blank",
      "google-docs-oauth",
      "popup,width=520,height=720",
    );
    try {
      const callbackUrl = oauthRedirectUri(
        "/_agent-native/google-docs/callback",
      );
      const authUrl = new URL(endpoint("/_agent-native/google-docs/auth-url"));
      authUrl.searchParams.set("redirect_uri", callbackUrl);
      authUrl.searchParams.set(
        "return",
        window.location.pathname + window.location.search,
      );
      const response = await fetch(authUrl.toString(), {
        credentials: "same-origin",
      });
      const result = await readJson<{
        url?: string;
        error?: string;
        message?: string;
      }>(response);
      if (!result.ok) throw result.error;
      const data = result.data;
      if (!response.ok || !data?.url) {
        throw new Error(
          errorFromResponse(
            response,
            data ?? {},
            "Could not start Google OAuth",
          ),
        );
      }
      if (!popup) {
        window.location.href = data.url;
        return;
      }
      popup.location.href = data.url;

      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline && !popup.closed) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        const next = await refreshStatus();
        if (next?.connected) {
          popup.close();
          return;
        }
      }
      await refreshStatus();
    } catch (caught) {
      popup?.close();
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setConnecting(false);
      reportBusy(false);
    }
  }, [refreshStatus, reportBusy]);

  const chooseDocument = useCallback(async () => {
    setChoosing(true);
    reportBusy(true);
    setError(null);
    try {
      const response = await fetch(
        endpoint("/_agent-native/google-docs/picker-token"),
        {
          credentials: "same-origin",
        },
      );
      const result = await readJson<PickerToken>(response);
      if (!result.ok) throw result.error;
      const token = result.data;
      if (!response.ok || !token) {
        throw new Error(
          errorFromResponse(
            response,
            token ?? {},
            "Could not open Google Picker",
          ),
        );
      }

      await loadGooglePickerScript();
      await loadPickerApi();

      const google = window.google;
      if (!google?.picker) {
        throw new Error("Google Picker is unavailable.");
      }

      await new Promise<void>((resolve, reject) => {
        const view = new google.picker.DocsView(
          google.picker.ViewId.PRESENTATIONS,
        )
          .setMimeTypes("application/vnd.google-apps.presentation")
          .setSelectFolderEnabled(false);
        const picker = new google.picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(token.accessToken)
          .setDeveloperKey(token.apiKey)
          .setAppId(token.appId)
          .setTitle("Choose a Google Slides deck")
          .setCallback((data: any) => {
            if (data.action === google.picker.Action.CANCEL) {
              resolve();
              return;
            }
            if (data.action !== google.picker.Action.PICKED) return;
            const deck = data.docs?.[0];
            if (!deck?.id) {
              reject(new Error("Google Picker returned no deck."));
              return;
            }
            void importMutation
              .mutateAsync({
                fileId: deck.id,
                ...(typeof deck.name === "string" && deck.name
                  ? { title: deck.name }
                  : {}),
              })
              .then(async (imported) => {
                if (!imported || typeof imported.id !== "string") {
                  throw new Error(
                    "The Google Slides import did not create a deck.",
                  );
                }
                await onImported({
                  id: imported.id,
                  title:
                    typeof imported.title === "string" && imported.title
                      ? imported.title
                      : deck.name || "Imported Google Slides",
                });
                resolve();
              })
              .catch(reject);
          })
          .build();
        picker.setVisible(true);
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setChoosing(false);
      reportBusy(false);
    }
  }, [importMutation, onImported, reportBusy]);

  const connectedAccount = status?.accounts?.[0]?.email;
  const needsConnect = status && !status.connected;
  const canPick = !!status?.connected && !!status.pickerConfigured;
  const pickerMissing = !!status?.connected && !status.pickerConfigured;
  const configured = status?.configured !== false;
  const unavailable = !status || !configured || pickerMissing || needsConnect;

  return (
    <div className="rounded-lg border border-border/70 bg-muted/35 px-3 py-3 text-xs text-muted-foreground">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background">
          {connecting || choosing ? (
            <IconLoader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : (
            <IconBrandGoogleDrive className="size-3.5 text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[12px] font-medium text-foreground">
              {title}
            </p>
            {connectedAccount && (
              <span className="hidden truncate text-[10px] text-muted-foreground/80 sm:inline">
                {connectedAccount}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2">
            {error ? error : unavailable ? unavailableLabel : connectedLabel}
          </p>
          {!configured && (
            <p className="mt-1 text-[11px] text-amber-500">
              {t("raw.googleOAuthNotConfigured")}
            </p>
          )}
          {pickerMissing && (
            <p className="mt-1 text-[11px] text-amber-500">
              {t("raw.googlePickerNeedsKeys")}
            </p>
          )}
        </div>
      </div>

      {(needsConnect || canPick) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
          {needsConnect && (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={connecting || !configured}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-accent disabled:cursor-default disabled:opacity-60"
            >
              {connecting ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : (
                <IconPlugConnected className="size-3.5" />
              )}
              {connecting ? pickingLabel : connectLabel}
            </button>
          )}
          {canPick && (
            <button
              type="button"
              onClick={() => void chooseDocument()}
              disabled={choosing}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-accent disabled:cursor-default disabled:opacity-60"
            >
              {choosing ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : (
                <IconFolderOpen className="size-3.5" />
              )}
              {choosing ? pickingLabel : chooseLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
