/**
 * Inline browser handoff for the public marketing home.
 *
 * The server only decides whether this script belongs on the root shell. The
 * browser owns the session check and redirect so the shell stays anonymous and
 * safe for a shared CDN cache.
 */
export function getSsrAuthRedirectScript(): string {
  return `<script data-agent-native-auth-redirect>(function () {
  if (window.__agentNativeAuthRedirectStarted) return;
  window.__agentNativeAuthRedirectStarted = true;
  var root = window.location.pathname.replace(/\\/+$/, "");
  var sessionPath = (root || "") + "/_agent-native/auth/session";
  var homePath = (root || "") + "/home";
  function redirectToAppHome() {
    return fetch(homePath, {
      method: "HEAD",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Accept": "text/html" }
    }).then(function (response) {
      if (!response || !response.ok) return;
      window.location.replace(homePath + window.location.search + window.location.hash);
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
    // A transient session failure must leave the public marketing page usable.
  });
})();</script>`;
}
