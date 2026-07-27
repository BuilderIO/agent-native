import * as Sentry from "@sentry/electron/main";
import { resolveDesktopSentryConfig } from "@shared/sentry-config";
import { app, type WebContents } from "electron";

type WebContentsRole =
  | "shell-renderer"
  | "app-webview"
  | "oauth-window"
  | "web-contents";

interface WebContentsMetadata {
  role?: WebContentsRole;
  appId?: string;
}

const instrumentedWebContents = new WeakSet<WebContents>();
const webContentsMetadata = new Map<number, WebContentsMetadata>();
let desktopSentryEnabled = false;

function errorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function shouldDropMainProcessError(hint: { originalException?: unknown }) {
  const code = errorCode(hint.originalException);
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED";
}

function sanitizeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === "about:blank") return value;

  try {
    const url = new URL(value);
    if (url.protocol === "file:") return "file://desktop-renderer";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0] || undefined;
  }
}

function webContentsDetails(contents: WebContents) {
  const metadata = webContentsMetadata.get(contents.id) ?? {};
  return {
    id: contents.id,
    type: contents.getType(),
    role: metadata.role ?? "web-contents",
    app_id: metadata.appId,
    url: sanitizeUrl(contents.getURL()),
  };
}

function withWebContentsScope(
  contents: WebContents,
  callback: (scope: Sentry.Scope) => void,
) {
  const details = webContentsDetails(contents);
  Sentry.withScope((scope) => {
    scope.setTag("electron.web_contents.type", details.type);
    scope.setTag("electron.web_contents.role", details.role);
    if (details.app_id) scope.setTag("app.id", details.app_id);
    scope.setContext("electron_web_contents", details);
    callback(scope);
  });
}

function levelForRenderProcessGone(
  reason: Electron.RenderProcessGoneDetails["reason"],
): Sentry.SeverityLevel {
  if (reason === "crashed" || reason === "oom") return "fatal";
  if (reason === "launch-failed" || reason === "integrity-failure") {
    return "error";
  }
  return "warning";
}

export function initializeDesktopSentry(): boolean {
  const config = resolveDesktopSentryConfig(process.env, {
    isPackaged: app.isPackaged,
    version: app.getVersion(),
  });
  if (!config.enabled || !config.dsn) return false;

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    ipcMode: Sentry.IPCMode.Protocol,
    debug: config.debug,
    attachScreenshot: false,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event, hint) {
      if (shouldDropMainProcessError(hint)) return null;
      return event;
    },
    initialScope: {
      tags: {
        runtime: "electron-main",
        "desktop.shell": "agent-native",
        "desktop.process": "main",
      },
      contexts: {
        app: {
          app_name: app.name,
          app_version: app.getVersion(),
          app_packaged: app.isPackaged,
        },
      },
    },
  });

  desktopSentryEnabled = true;
  return true;
}

export function setSentryWebContentsMetadata(
  contentsOrId: WebContents | number | undefined,
  metadata: WebContentsMetadata,
) {
  if (!contentsOrId) return;
  const id = typeof contentsOrId === "number" ? contentsOrId : contentsOrId.id;
  if (!id) return;
  webContentsMetadata.set(id, {
    ...webContentsMetadata.get(id),
    ...metadata,
  });
}

export function installSentryWebContentsInstrumentation(
  contents: WebContents,
  metadata: WebContentsMetadata = {},
) {
  if (!desktopSentryEnabled) return;
  setSentryWebContentsMetadata(contents, metadata);
  if (instrumentedWebContents.has(contents)) return;
  instrumentedWebContents.add(contents);

  contents.once("destroyed", () => {
    webContentsMetadata.delete(contents.id);
  });

  contents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, url, isMainFrame) => {
      if (errorCode === -3) return;
      if (isMainFrame === false) return;

      const details = {
        ...webContentsDetails(contents),
        error_code: errorCode,
        error_description: errorDescription,
        failed_url: sanitizeUrl(url),
      };
      Sentry.addBreadcrumb({
        category: "electron.web_contents",
        message: "did-fail-load",
        level: "warning",
        data: details,
      });

      withWebContentsScope(contents, (scope) => {
        scope.setTag("electron.load_error.code", String(errorCode));
        scope.setContext("electron_load_failure", details);
        Sentry.captureMessage("Electron webContents failed to load", "warning");
      });
    },
  );

  contents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;

    const eventDetails = {
      ...webContentsDetails(contents),
      reason: details.reason,
      exit_code: details.exitCode,
    };
    const level = levelForRenderProcessGone(details.reason);
    Sentry.addBreadcrumb({
      category: "electron.web_contents",
      message: "render-process-gone",
      level,
      data: eventDetails,
    });

    withWebContentsScope(contents, (scope) => {
      scope.setLevel(level);
      scope.setTag("electron.render_process.reason", details.reason);
      scope.setContext("electron_render_process_gone", eventDetails);
      Sentry.captureMessage("Electron renderer process gone", level);
    });
  });

  contents.on("unresponsive", () => {
    Sentry.addBreadcrumb({
      category: "electron.web_contents",
      message: "unresponsive",
      level: "warning",
      data: webContentsDetails(contents),
    });
  });

  contents.on("responsive", () => {
    Sentry.addBreadcrumb({
      category: "electron.web_contents",
      message: "responsive",
      level: "info",
      data: webContentsDetails(contents),
    });
  });
}
