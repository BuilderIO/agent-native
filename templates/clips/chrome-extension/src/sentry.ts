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

function scrubUrl(
  value: string,
  options: { redactAllQueryValues?: boolean } = {},
): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (options.redactAllQueryValues || SENSITIVE_QUERY_PARAM_RE.test(key)) {
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

function shouldDropExpectedMediaPermissionError(
  error: unknown,
  context: CaptureContext,
): boolean {
  const tags = context.tags ?? {};
  const isPermissionProbe =
    tags.surface === "permission" &&
    (!tags.permission ||
      tags.permission === "mic" ||
      tags.permission === "cam");
  const isOptionalBubbleCamera =
    tags.surface === "overlay" && tags.overlayPart === "bubble";
  if (!isPermissionProbe && !isOptionalBubbleCamera) return false;

  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error ?? "");

  return (
    /\bNotAllowedError\b/i.test(text) ||
    /\bPermission (?:denied|dismissed)\b/i.test(text) ||
    /\bPermission denied by system\b/i.test(text) ||
    /\bNotReadableError\b/i.test(text) ||
    /\bCould not start video source\b/i.test(text) ||
    /\b(?:NotFoundError|DevicesNotFoundError)\b/i.test(text) ||
    /\bRequested device not found\b/i.test(text)
  );
}

function shouldDropExpectedMediaPermissionEvent(event: Sentry.Event): boolean {
  if (event.tags?.surface !== "permission") return false;
  const exceptionText = (event.exception?.values ?? [])
    .map((value) => `${value.type ?? ""}: ${value.value ?? ""}`)
    .join(" ");
  return shouldDropExpectedMediaPermissionError(exceptionText, {
    tags: { surface: "permission" },
  });
}

function scrubScopeString(value: string): string {
  const scrubbed = scrubUrl(value, { redactAllQueryValues: true });
  if (scrubbed !== value) return scrubbed;
  return value.replace(/https?:\/\/[^\s"'<>]+/g, (url) =>
    scrubUrl(url, { redactAllQueryValues: true }),
  );
}

function scrubScopeValue(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return scrubScopeString(value);
  if (Array.isArray(value)) {
    return value.map((item) => scrubScopeValue(item, seen));
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  if (Object.prototype.toString.call(value) !== "[object Object]") {
    return value;
  }
  seen.add(value);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      scrubScopeValue(entry, seen),
    ]),
  );
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
      if (shouldDropExpectedMediaPermissionEvent(event)) return null;
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
  if (!initialized || shouldDropExpectedMediaPermissionError(error, context)) {
    return undefined;
  }
  try {
    return Sentry.withScope((scope) => {
      if (context.tags) {
        for (const [key, value] of Object.entries(context.tags)) {
          if (typeof value === "string") {
            scope.setTag(key, scrubScopeString(value));
          }
        }
      }
      if (context.extra) {
        for (const [key, value] of Object.entries(context.extra)) {
          if (value !== undefined) scope.setExtra(key, scrubScopeValue(value));
        }
      }
      if (context.contexts) {
        for (const [key, value] of Object.entries(context.contexts)) {
          scope.setContext(
            key,
            scrubScopeValue(value) as Record<string, unknown>,
          );
        }
      }
      return Sentry.captureException(error);
    });
  } catch {
    return undefined;
  }
}
