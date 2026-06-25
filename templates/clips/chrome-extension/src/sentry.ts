import * as Sentry from "@sentry/browser";

declare const __CLIPS_SENTRY_DSN__: string;
declare const __CLIPS_SENTRY_ENVIRONMENT__: string;

type CaptureContext = {
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown>>;
};

const SENSITIVE_QUERY_PARAM_RE =
  /(?:token|secret|password|passwd|pwd|key|api[-_]?key|code|state|session|auth|credential)/i;

let initialized = false;
let globalErrorCaptureInstalled = false;

function configuredDsn(): string {
  return typeof __CLIPS_SENTRY_DSN__ === "string"
    ? __CLIPS_SENTRY_DSN__.trim()
    : "";
}

function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version || "unknown";
  } catch {
    return "unknown";
  }
}

function scrubUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PARAM_RE.test(key)) {
        url.searchParams.set(key, "<redacted>");
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

function scrubEvent<T extends Sentry.Event>(event: T): T {
  if (event.request?.url) {
    event.request.url = scrubUrl(event.request.url);
  }
  if (Array.isArray(event.breadcrumbs)) {
    for (const breadcrumb of event.breadcrumbs) {
      const data = breadcrumb.data as Record<string, unknown> | undefined;
      if (!data) continue;
      for (const key of ["url", "from", "to"]) {
        if (typeof data[key] === "string") {
          data[key] = scrubUrl(data[key]);
        }
      }
    }
  }
  if (event.user) {
    delete (event.user as Record<string, unknown>).ip_address;
  }
  return event;
}

function installGlobalErrorCapture(surface: string): void {
  if (globalErrorCaptureInstalled) return;
  globalErrorCaptureInstalled = true;
  const target = globalThis as typeof globalThis & {
    addEventListener?: (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => void;
  };
  if (typeof target.addEventListener !== "function") return;

  target.addEventListener("error", (event) => {
    const errorEvent = event as ErrorEvent;
    const error =
      errorEvent.error instanceof Error
        ? errorEvent.error
        : new Error(errorEvent.message || "Unhandled extension error");
    captureExtensionError(error, {
      tags: { surface, mechanism: "global-error" },
      extra: {
        filename: errorEvent.filename,
        lineno: errorEvent.lineno,
        colno: errorEvent.colno,
      },
    });
  });

  target.addEventListener("unhandledrejection", (event) => {
    const rejection = event as PromiseRejectionEvent;
    const error =
      rejection.reason instanceof Error
        ? rejection.reason
        : new Error(String(rejection.reason ?? "Unhandled promise rejection"));
    captureExtensionError(error, {
      tags: { surface, mechanism: "unhandled-rejection" },
    });
  });
}

export function initExtensionSentry(surface: string): void {
  if (initialized) return;
  const dsn = configuredDsn();
  if (!dsn) return;
  initialized = true;

  Sentry.init({
    dsn,
    environment:
      typeof __CLIPS_SENTRY_ENVIRONMENT__ === "string" &&
      __CLIPS_SENTRY_ENVIRONMENT__
        ? __CLIPS_SENTRY_ENVIRONMENT__
        : "production",
    release: `clips-chrome-extension@${extensionVersion()}`,
    sendDefaultPii: false,
    skipBrowserExtensionCheck: true,
    beforeSend(event) {
      event.tags = {
        ...event.tags,
        app: "agent-native-clips",
        template: "clips",
        runtime: "chrome-extension",
        surface,
      };
      return scrubEvent(event);
    },
  });

  Sentry.setTag("app", "agent-native-clips");
  Sentry.setTag("template", "clips");
  Sentry.setTag("runtime", "chrome-extension");
  Sentry.setTag("surface", surface);
  installGlobalErrorCapture(surface);
}

export function captureExtensionError(
  error: unknown,
  context: CaptureContext = {},
): string | undefined {
  if (!initialized) return undefined;
  try {
    return Sentry.withScope((scope) => {
      if (context.tags) {
        for (const [key, value] of Object.entries(context.tags)) {
          if (typeof value === "string") scope.setTag(key, value);
        }
      }
      if (context.extra) {
        for (const [key, value] of Object.entries(context.extra)) {
          if (value !== undefined) scope.setExtra(key, value);
        }
      }
      if (context.contexts) {
        for (const [key, value] of Object.entries(context.contexts)) {
          scope.setContext(key, value);
        }
      }
      return Sentry.captureException(error);
    });
  } catch {
    return undefined;
  }
}
