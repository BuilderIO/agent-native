import {
  actionErrorMessage,
  callAction,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";
import { extractGoogleDocUrls } from "@shared/google-docs";
import {
  IconAlertCircle,
  IconBrandGoogleDrive,
  IconCheck,
  IconFolderOpen,
  IconLoader2,
  IconPlugConnected,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getGoogleDocsStatus,
  getGooglePickerToken,
  googleDocsRouteErrorMessage,
  type GoogleDocsStatus,
} from "@/lib/google-docs-client";

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

function loadGooglePickerScript(loadFailedMessage: string): Promise<void> {
  if (window.gapi) return Promise.resolve();
  if (!window.__googlePickerScriptPromise) {
    window.__googlePickerScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(loadFailedMessage));
      document.head.appendChild(script);
    });
  }
  return window.__googlePickerScriptPromise;
}

function loadPickerApi(
  didNotLoadMessage: string,
  loadFailedMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const gapi = window.gapi;
    if (!gapi) {
      reject(new Error(didNotLoadMessage));
      return;
    }
    gapi.load("picker", {
      callback: () => resolve(),
      onerror: () => reject(new Error(loadFailedMessage)),
    });
  });
}

function buildSourceContext(doc: ImportedGoogleDoc): string {
  const title = doc.title.replace(/"/g, "'");
  return [
    "Imported Google Docs source material:",
    `<google-doc title="${title}" documentId="${doc.documentId}" source="${doc.source}" charCount="${doc.charCount}" truncated="${doc.truncated}">`, // i18n-ignore source-context wrapper, not UI copy
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
  const t = useT();
  const formatters = useFormatters();
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
      const response = await getGoogleDocsStatus();
      const data = response.data ?? {};
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
        const data = await callAction<ImportResponse>(
          "import-google-doc",
          { url: urlOrId },
          { method: "GET" },
        );
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
        setError(
          actionErrorMessage(caught) ??
            (caught instanceof Error ? caught.message : String(caught)),
        );
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

  const connect = useCallback(() => {
    setConnecting(true);
    setError(null);
    startWorkspaceProviderOAuth("google_drive", {
      appId: "slides",
      returnPath: `${window.location.pathname}${window.location.search}`,
      scope: "user",
    });
  }, []);

  const chooseDocument = useCallback(async () => {
    setChoosing(true);
    setError(null);
    try {
      const response = await getGooglePickerToken();
      if (response.unreadable || !response.ok || !response.data) {
        throw new Error(
          googleDocsRouteErrorMessage(
            response,
            t("home.googleDocImport.pickerOpenFailedStatus", {
              status: response.status,
            }),
          ),
        );
      }
      const token = response.data;

      await loadGooglePickerScript(t("home.googleDocImport.pickerLoadFailed"));
      await loadPickerApi(
        t("home.googleDocImport.pickerDidNotLoad"),
        t("home.googleDocImport.pickerLoadFailed"),
      );

      const google = window.google;
      if (!google?.picker) {
        throw new Error(t("home.googleDocImport.pickerUnavailable"));
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
          .setTitle(t("home.googleDocImport.pickerSelectTitle"))
          .setCallback((data: any) => {
            if (data.action === google.picker.Action.CANCEL) {
              resolve();
              return;
            }
            if (data.action !== google.picker.Action.PICKED) return;
            const doc = data.docs?.[0];
            if (!doc?.id) {
              reject(
                new Error(t("home.googleDocImport.pickerMissingDocument")),
              );
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
  }, [importDocument, t]);

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
            <IconBrandGoogleDrive
              className={
                /* guard:allow-raw-color — official Google Drive brand mark color. */ "h-3.5 w-3.5 text-[#4285F4]"
              }
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[12px] font-medium text-foreground">
              {importedDoc
                ? importedDoc.title
                : loading
                  ? t("home.googleDocImport.importing")
                  : t("home.googleDocImport.detected")}
            </p>
            {connectedAccount && (
              <span className="hidden truncate text-[10px] text-muted-foreground/80 sm:inline">
                {connectedAccount}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2">
            {importedDoc
              ? importedDoc.truncated
                ? t("home.googleDocImport.readyTruncated", {
                    count: formatters.formatNumber(importedDoc.charCount),
                  })
                : t("home.googleDocImport.ready", {
                    count: formatters.formatNumber(importedDoc.charCount),
                  })
              : loading
                ? t("home.googleDocImport.reading")
                : error || t("home.googleDocImport.checkingAccess")}
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
              {connecting
                ? t("home.googleDocImport.connecting")
                : t("home.googleDocImport.connect")}
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
              {importedDoc
                ? t("home.googleDocImport.chooseDifferent")
                : t("home.googleDocImport.choose")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
