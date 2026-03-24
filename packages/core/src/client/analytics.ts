/**
 * Client-side analytics helpers.
 *
 * These are safe to call unconditionally — they're no-ops when
 * Google Analytics isn't loaded (GA_MEASUREMENT_ID not set).
 */

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
  }
}

/** Send a custom event to Google Analytics. No-op if GA isn't loaded. */
export function trackEvent(
  name: string,
  params?: Record<string, string | number | boolean>,
): void {
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("event", name, params);
  }
}

/** Track whether the current user is signed in. Call once per page load. */
export function trackSessionStatus(signedIn: boolean): void {
  trackEvent("session_status", { signed_in: signedIn });
}
