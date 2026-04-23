import * as amplitude from "@amplitude/analytics-browser";
import * as Sentry from "@sentry/browser";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
  }
}

type GetDefaultProps = (
  name: string,
  properties: Record<string, unknown>,
) => Record<string, unknown>;

let _getDefaultProps: GetDefaultProps | null = null;
let _amplitudeInitialized = false;
let _sentryInitialized = false;

function ensureAmplitude(): boolean {
  if (_amplitudeInitialized) return true;
  const key = (import.meta.env as Record<string, string | undefined>)
    ?.VITE_AMPLITUDE_API_KEY;
  if (!key) return false;
  amplitude.init(key, { autocapture: true });
  _amplitudeInitialized = true;
  return true;
}

function ensureSentry(): void {
  if (_sentryInitialized) return;
  const dsn = (import.meta.env as Record<string, string | undefined>)
    ?.VITE_SENTRY_CLIENT_DSN;
  if (!dsn) return;
  Sentry.init({ dsn });
  _sentryInitialized = true;
}

export function configureTracking(options: {
  getDefaultProps?: GetDefaultProps;
}): void {
  if (options.getDefaultProps) {
    _getDefaultProps = options.getDefaultProps;
  }
}

function resolveProps(
  name: string,
  params?: Record<string, string | number | boolean>,
): Record<string, unknown> {
  if (typeof window === "undefined") return { ...params };
  const base: Record<string, unknown> = {
    url: window.location.origin + window.location.pathname,
    app: window.location.hostname.split(".")[0] || "localhost",
    ...params,
  };
  return _getDefaultProps ? _getDefaultProps(name, base) : base;
}

export function trackEvent(
  name: string,
  params?: Record<string, string | number | boolean>,
): void {
  if (typeof window === "undefined") return;
  ensureSentry();
  const props = resolveProps(name, params);
  window.gtag?.("event", name.replace(/\s+/g, "_"), props);
  if (ensureAmplitude()) {
    amplitude.track(name, props);
  }
}

export function trackSessionStatus(signedIn: boolean): void {
  trackEvent("session status", { signed_in: signedIn });
}
