import * as Sentry from "@sentry/browser";

declare const __CLIPS_DESKTOP_SENTRY_DSN__: string;
declare const __CLIPS_DESKTOP_SENTRY_ENVIRONMENT__: string;
declare const __CLIPS_DESKTOP_VERSION__: string;

let initialized = false;

function configuredDsn(): string {
  return typeof __CLIPS_DESKTOP_SENTRY_DSN__ === "string"
    ? __CLIPS_DESKTOP_SENTRY_DSN__.trim()
    : "";
}

function configuredEnvironment(): string {
  return typeof __CLIPS_DESKTOP_SENTRY_ENVIRONMENT__ === "string" &&
    __CLIPS_DESKTOP_SENTRY_ENVIRONMENT__
    ? __CLIPS_DESKTOP_SENTRY_ENVIRONMENT__
    : "production";
}

function scrubUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      url.searchParams.set(key, "<redacted>");
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
  if (event.user) {
    delete (event.user as Record<string, unknown>).ip_address;
  }
  return event;
}

export function initDesktopSentry(route: string): void {
  if (initialized) return;
  const dsn = configuredDsn();
  if (!dsn) return;
  initialized = true;

  Sentry.init({
    dsn,
    environment: configuredEnvironment(),
    release: `clips-desktop@${__CLIPS_DESKTOP_VERSION__ || "0.0.0"}`,
    sendDefaultPii: false,
    beforeSend(event) {
      event.tags = {
        ...event.tags,
        app: "agent-native-clips",
        template: "clips",
        runtime: "tauri-webview",
        surface: route,
      };
      return scrubEvent(event);
    },
  });

  Sentry.setTag("app", "agent-native-clips");
  Sentry.setTag("template", "clips");
  Sentry.setTag("runtime", "tauri-webview");
  Sentry.setTag("surface", route);
}
