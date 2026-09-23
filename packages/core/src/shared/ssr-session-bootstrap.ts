import { safeJsonForHtml } from "./agent-readable-resource.js";

export const SSR_SESSION_BOOTSTRAP_MARKER =
  'data-agent-native-session-bootstrap="1"';

export const SSR_SESSION_BOOTSTRAP_TIMEOUT_MS = 15_000;

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
