import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentNativePath } from "@agent-native/core/client";
import {
  IconAlertCircle,
  IconBrandGoogleDrive,
  IconCheck,
  IconFolderOpen,
  IconLoader2,
  IconPlugConnected,
} from "@tabler/icons-react";
import { extractGoogleDocUrls } from "@shared/google-docs";

declare global {
  interface Window {
    gapi?: any;
    google?: any;
    __googlePickerScriptPromise?: Promise<void>;
  }
}

interface ImportedGoogleDoc {
  documentId: string;
  title: string;
  url: string;
  source: string;
  text: string;
  charCount: number;
  truncated: boolean;
  note?: string;
  origin: "url" | "picker";
}

interface GoogleDocsStatus {
  configured: boolean;
  connected: boolean;
  pickerConfigured: boolean;
  accounts: Array<{ email: string; scope?: string }>;
  pickerApiKey?: string | null;
  pickerAppId?: string | null;
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

interface ImportResponse {
  documentId: string;
  source: string;
  text: string;
  charCount: number;
  truncated: boolean;
  note?: string;
  error?: string;
  message?: string;
}

interface GoogleDocImportHintProps {
  promptText: string;
  onSourceContextChange: (context: string) => void;
}

function endpoint(path: string): string {
  return new URL(agentNativePath(path), window.location.origin).toString();
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
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

function buildSourceContext(doc: ImportedGoogleDoc): string {
  const title = doc.title.replace(/"/g, "'");
  return [
    "Imported Google Docs source material:",
    `<google-doc title="${title}" documentId="${doc.documentId}" source="${doc.source}" charCount="${doc.charCount}" truncated="${doc.truncated}">`,
    doc.text,
    "</google-doc>",
    doc.note ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function GoogleDocImportHint({
  promptText,
  onSourceContextChange,
}: GoogleDocImportHintProps) {
  const googleDocUrl = useMemo(
    () => extractGoogleDocUrls(promptText)[0] ?? "",
    [promptText],
  );
  const [importedDoc, setImportedDoc] = useState<ImportedGoogleDoc | null>(
    null,
  );
  const [status, setStatus] = useState<GoogleDocsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const lastAutoImportUrlRef = useRef("");

  const refreshStatus =
    useCallback(async (): Promise<GoogleDocsStatus | null> => {
      const response = await fetch(
        endpoint("/_agent-native/google-docs/status"),
        {
          credentials: "same-origin",
        },
      );
      const data = await readJson<GoogleDocsStatus>(response);
      if (response.ok) {
        setStatus(data);
        return data;
      }
      setStatus(null);
      return null;
    }, []);

  const importDocument = useCallback(
    async (urlOrId: string, origin: "url" | "picker", title = "Google Doc") => {
      setLoading(true);
      setError(null);
      try {
        const url = new URL(
          endpoint("/_agent-native/actions/import-google-doc"),
        );
        url.searchParams.set("url", urlOrId);
        const response = await fetch(url.toString(), {
          credentials: "same-origin",
        });
        const data = await readJson<ImportResponse>(response);
        if (!response.ok) {
          throw new Error(
            errorFromResponse(response, data, "Could not import Google Doc"),
          );
        }
        setImportedDoc({
          documentId: data.documentId,
          title,
          url: urlOrId,
          source: data.source,
          text: data.text,
          charCount: data.charCount,
          truncated: data.truncated,
          note: data.note,
          origin,
        });
      } catch (caught) {
        setImportedDoc((current) =>
          current?.origin === origin ? null : current,
        );
        setError(caught instanceof Error ? caught.message : String(caught));
        void refreshStatus();
      } finally {
        setLoading(false);
      }
    },
    [refreshStatus],
  );

  useEffect(() => {
    if (!googleDocUrl) {
      lastAutoImportUrlRef.current = "";
      setError(null);
      setImportedDoc((current) => (current?.origin === "url" ? null : current));
      return;
    }
    void refreshStatus();
    if (googleDocUrl === lastAutoImportUrlRef.current) return;
    lastAutoImportUrlRef.current = googleDocUrl;
    void importDocument(googleDocUrl, "url");
  }, [googleDocUrl, importDocument, refreshStatus]);

  useEffect(() => {
    onSourceContextChange(importedDoc ? buildSourceContext(importedDoc) : "");
  }, [importedDoc, onSourceContextChange]);

  useEffect(() => {
    return () => onSourceContextChange("");
  }, [onSourceContextChange]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    const popup = window.open(
      "about:blank",
      "google-docs-oauth",
      "popup,width=520,height=720",
    );
    try {
      const callbackUrl = new URL(
        agentNativePath("/_agent-native/google-docs/callback"),
        window.location.origin,
      ).toString();
      const authUrl = new URL(endpoint("/_agent-native/google-docs/auth-url"));
      authUrl.searchParams.set("redirect_uri", callbackUrl);
      authUrl.searchParams.set(
        "return",
        window.location.pathname + window.location.search,
      );
      const response = await fetch(authUrl.toString(), {
        credentials: "same-origin",
      });
      const data = await readJson<{
        url?: string;
        error?: string;
        message?: string;
      }>(response);
      if (!response.ok || !data.url) {
        throw new Error(
          errorFromResponse(response, data, "Could not start Google OAuth"),
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
    }
  }, [refreshStatus]);

  const chooseDocument = useCallback(async () => {
    setChoosing(true);
    setError(null);
    try {
      const response = await fetch(
        endpoint("/_agent-native/google-docs/picker-token"),
        { credentials: "same-origin" },
      );
      const token = await readJson<PickerToken>(response);
      if (!response.ok) {
        throw new Error(
          errorFromResponse(response, token, "Could not open Google Picker"),
        );
      }

      await loadGooglePickerScript();
      await loadPickerApi();

      const google = window.google;
      if (!google?.picker) {
        throw new Error("Google Picker is unavailable.");
      }

      await new Promise<void>((resolve, reject) => {
        const view = new google.picker.DocsView(google.picker.ViewId.DOCUMENTS)
          .setMimeTypes("application/vnd.google-apps.document")
          .setSelectFolderEnabled(false);
        const picker = new google.picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(token.accessToken)
          .setDeveloperKey(token.apiKey)
          .setAppId(token.appId)
          .setTitle("Choose a Google Doc")
          .setCallback((data: any) => {
            if (data.action === google.picker.Action.CANCEL) {
              resolve();
              return;
            }
            if (data.action !== google.picker.Action.PICKED) return;
            const doc = data.docs?.[0];
            if (!doc?.id) {
              reject(new Error("Google Picker returned no document."));
              return;
            }
            void importDocument(doc.id, "picker", doc.name || "Google Doc")
              .then(resolve)
              .catch(reject);
          })
          .build();
        picker.setVisible(true);
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setChoosing(false);
    }
  }, [importDocument]);

  if (!googleDocUrl && !importedDoc && !error) return null;

  const connectedAccount = status?.accounts?.[0]?.email;
  const needsConnect = status && !status.connected;
  const canPick = !!status?.connected && !!status.pickerConfigured;
  const pickerMissing = !!status?.connected && !status.pickerConfigured;
  const configured = status?.configured !== false;

  return (
    <div className="mx-2 mb-2 rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background">
          {loading ? (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : importedDoc ? (
            <IconCheck className="h-3.5 w-3.5 text-emerald-500" />
          ) : error ? (
            <IconAlertCircle className="h-3.5 w-3.5 text-amber-500" />
          ) : (
            <IconBrandGoogleDrive className="h-3.5 w-3.5 text-[#4285F4]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[12px] font-medium text-foreground">
              {importedDoc
                ? importedDoc.title
                : loading
                  ? "Importing Google Doc"
                  : "Google Doc detected"}
            </p>
            {connectedAccount && (
              <span className="hidden truncate text-[10px] text-muted-foreground/80 sm:inline">
                {connectedAccount}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2">
            {importedDoc
              ? `Ready as source material (${importedDoc.charCount.toLocaleString()} chars${importedDoc.truncated ? ", truncated" : ""}).`
              : loading
                ? "Reading the document text."
                : error || "Checking access."}
          </p>
          {!configured && (
            <p className="mt-1 text-[11px] text-amber-500">
              Google OAuth is not configured for this deployment.
            </p>
          )}
          {pickerMissing && (
            <p className="mt-1 text-[11px] text-amber-500">
              Google Picker needs GOOGLE_PICKER_API_KEY and
              GOOGLE_PICKER_APP_ID.
            </p>
          )}
        </div>
      </div>

      {(needsConnect || canPick || importedDoc) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
          {needsConnect && (
            <button
              type="button"
              onClick={connect}
              disabled={connecting || !configured}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-accent disabled:cursor-default disabled:opacity-60"
            >
              {connecting ? (
                <IconLoader2 className="h-3 w-3 animate-spin" />
              ) : (
                <IconPlugConnected className="h-3 w-3" />
              )}
              {connecting ? "Connecting" : "Connect Google Docs"}
            </button>
          )}
          {canPick && (
            <button
              type="button"
              onClick={chooseDocument}
              disabled={choosing}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-accent disabled:cursor-default disabled:opacity-60"
            >
              {choosing ? (
                <IconLoader2 className="h-3 w-3 animate-spin" />
              ) : (
                <IconFolderOpen className="h-3 w-3" />
              )}
              {importedDoc ? "Choose different doc" : "Choose doc"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
