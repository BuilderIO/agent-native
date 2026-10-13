import {
  SESSION_NAVIGATION_FLAG,
  SESSION_NAVIGATION_RELEASED_EVENT,
  SESSION_NAVIGATION_STALL_MS,
} from "./ssr-session-bootstrap.js";

// The hint may move a likely-signed-in visitor from the public root to the
// app home, whose gate makes the authoritative check. It never decides
// "signed out" and never sends anyone to sign-in.
export function getSsrAuthRedirectScript(
  sessionHintCookieName = "an_session_hint",
  appHomePath = "/home",
  frameworkRoutePrefix = "/_agent-native",
): string {
  if (appHomePath === "/") return "";

  return `<script data-agent-native-auth-redirect>(function () {
  if (window.__agentNativeAuthRedirectStarted) return;
  window.__agentNativeAuthRedirectStarted = true;
  var navigationFlag = ${JSON.stringify(SESSION_NAVIGATION_FLAG)};
  var releasedEvent = ${JSON.stringify(SESSION_NAVIGATION_RELEASED_EVENT)};
  var root = window.location.pathname.replace(/\\/+$/, "");
  var homePath = (root || "") + ${JSON.stringify(appHomePath)};
  var sessionHintCookieName = ${JSON.stringify(sessionHintCookieName)};
  function hasSessionHint() {
    if (typeof document !== "object" || typeof document.cookie !== "string") return false;
    var prefix = sessionHintCookieName + "=";
    return document.cookie.split(";").some(function (cookie) {
      var entry = cookie.trim();
      return entry.indexOf(prefix) === 0 && entry.slice(prefix.length) === "1";
    });
  }
  function redirectFromHint() {
    if (typeof window[navigationFlag] === "string") return;
    var target = homePath + window.location.search + window.location.hash;
    window[navigationFlag] = target;
    // Same release as navigateForSession: a page still here after the stall
    // window never left, so the app must not stay held behind the claim.
    setTimeout(function () {
      if (window[navigationFlag] !== target) return;
      delete window[navigationFlag];
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new Event(releasedEvent));
      }
    }, ${SESSION_NAVIGATION_STALL_MS});
    window.location.replace(target);
  }
  if (hasSessionHint()) {
    redirectFromHint();
    return;
  }
  var sessionPath = (root || "") + ${JSON.stringify(`${frameworkRoutePrefix}/auth/session`)};
  function redirectToAppHome() {
    return fetch(homePath, {
      method: "HEAD",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Accept": "text/html" }
    }).then(function (response) {
      if (!response || !response.ok) return;
      redirectFromHint();
    });
  }
  fetch(sessionPath, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Accept": "application/json" }
  }).then(function (response) {
    if (!response.ok) return null;
    return response.json();
  }).then(function (session) {
    if (!session || typeof session.email !== "string" || session.error) return;
    return redirectToAppHome();
  }).catch(function () { // coercion-ok: auth probe intentionally fails open so marketing remains usable.
    // A transient session failure must leave the public root usable.
  });
})();</script>`;
}
