import { safeJsonForHtml } from "./agent-readable-resource.js";

export const SSR_SESSION_BOOTSTRAP_MARKER =
  'data-agent-native-session-bootstrap="1"';

export const SSR_SESSION_BOOTSTRAP_TIMEOUT_MS = 15_000;

/**
 * Claimed by the first session-driven navigation of a document: the sign-in
 * gate, the sign-in page leaving for the app, the beta lane switch, or the
 * inline root-home and lane scripts. One page load never leaves for two
 * destinations; whichever decides first wins and the rest stand down.
 */
export const SESSION_NAVIGATION_FLAG = "__agentNativeNavigationStarted";

declare global {
  interface Window {
    [SESSION_NAVIGATION_FLAG]?: string;
  }
}

/**
 * A claim still standing this long after `location.replace` means the page
 * never left: a beforeunload "Stay", a desktop shell that blocked the
 * navigation, or a replace that threw. It is released so the gate stops
 * holding the app and a later navigation can claim the page again.
 */
export const SESSION_NAVIGATION_STALL_MS = 2_000;

/** Fired on `window` when a claim is released without the page leaving. */
export const SESSION_NAVIGATION_RELEASED_EVENT =
  "agent-native:session-navigation-released";

/** True once this document has started leaving because of the session. */
export function isSessionNavigationPending(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window[SESSION_NAVIGATION_FLAG] === "string"
  );
}

function releaseSessionNavigation(href: string): void {
  if (window[SESSION_NAVIGATION_FLAG] !== href) return;
  delete window[SESSION_NAVIGATION_FLAG];
  window.dispatchEvent?.(new Event(SESSION_NAVIGATION_RELEASED_EVENT));
}

/** The only way the client leaves a page because of what the session says. */
export function navigateForSession(href: string): boolean {
  if (typeof window === "undefined" || isSessionNavigationPending()) {
    return false;
  }
  window[SESSION_NAVIGATION_FLAG] = href;
  // A document restored from the back/forward cache is a new page load.
  window.addEventListener?.("pageshow", (event) => {
    if (event.persisted) releaseSessionNavigation(href);
  });
  setTimeout(() => releaseSessionNavigation(href), SESSION_NAVIGATION_STALL_MS);
  window.location.replace(href);
  return true;
}

/** Calls `listener` whenever a claimed navigation is released. */
export function subscribeSessionNavigation(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(SESSION_NAVIGATION_RELEASED_EVENT, listener);
  return () =>
    window.removeEventListener(SESSION_NAVIGATION_RELEASED_EVENT, listener);
}

export function getSsrSessionBootstrapScriptBody(
  sessionPath: string,
  sessionHintCookieName?: string,
): string {
  return `(function __anEarlySessionBootstrap() {
  if (window.__agentNativeSessionBootstrap) return;
  var sessionHintCookieName = ${safeJsonForHtml(sessionHintCookieName ?? "")};
  var hasSessionHint = document.cookie.split(";").some(function (cookie) {
    var entry = cookie.trim();
    var separator = entry.indexOf("=");
    if (separator < 1 || entry.slice(separator + 1) !== "1") return false;
    var name = entry.slice(0, separator);
    return sessionHintCookieName
      ? name === sessionHintCookieName
      : name === "an_session_hint" ||
          (name.indexOf("an_session_") === 0 && name.endsWith("_hint"));
  });
  if (!hasSessionHint) return;
  var controller = typeof AbortController === "function"
    ? new AbortController()
    : null;
  var timeoutId = setTimeout(function () {
    if (controller) controller.abort();
  }, ${SSR_SESSION_BOOTSTRAP_TIMEOUT_MS});
  var requestInit = {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" }
  };
  if (controller) requestInit.signal = controller.signal;
  window.__agentNativeSessionBootstrap = fetch(${safeJsonForHtml(sessionPath)}, requestInit).then(function (response) {
    if (!response.ok) return { state: "unavailable", status: response.status };
    return response.json().then(function (value) {
      return { state: "available", value: value };
    }, function () {
      return { state: "unavailable", status: response.status };
    });
  }).catch(function () {
    return { state: "unavailable" };
  }).finally(function () {
    clearTimeout(timeoutId);
  });
})();`;
}
