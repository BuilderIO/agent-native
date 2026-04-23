/**
 * Client-side analytics helpers — multi-provider (GA + Amplitude).
 *
 * Safe to call unconditionally — no-ops when no provider is loaded.
 *
 * Every event automatically includes `url` (full location.href) and
 * `app` (derived from hostname). Override or extend defaults with
 * `configureTracking({ getDefaultProps })`.
 */

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    amplitude?: {
      track: (name: string, props?: Record<string, unknown>) => void;
      setUserId: (id: string) => void;
      init: (key: string, options?: Record<string, unknown>) => void;
    };
  }
}

type GetDefaultProps = (
  name: string,
  properties: Record<string, unknown>,
) => Record<string, unknown>;

let _getDefaultProps: GetDefaultProps | null = null;

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
    url: window.location.href,
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
  const props = resolveProps(name, params);
  window.gtag?.("event", name, props);
  window.amplitude?.track(name, props);
}

/** Track whether the current user is signed in. Call once per page load. */
export function trackSessionStatus(signedIn: boolean): void {
  trackEvent("session status", { signed_in: signedIn });
}
