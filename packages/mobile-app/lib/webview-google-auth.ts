export const WEBVIEW_GOOGLE_AUTH_SCRIPT = `
(function () {
  if (window.__agentNativeMobileOAuth) return;
  var active = null;
  var documentId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  var sequence = 0;
  var finish = function (request, result) {
    if (active !== request) return;
    clearTimeout(request.timer);
    request.controller.abort();
    active = null;
    request.resolve(result);
  };
  window.__agentNativeMobileOAuth = {
    start: function (url) {
      if (active) finish(active, 'failed');
      return new Promise(function (resolve) {
        var start = new URL(url, location.href);
        if (start.origin !== location.origin || !start.pathname.endsWith('/_agent-native/google/auth-url')) {
          resolve('failed'); return;
        }
        var base = start.pathname.slice(0, -'/_agent-native/google/auth-url'.length);
        if (base === '/' || base.startsWith('//')) { resolve('failed'); return; }
        var request = { id: documentId + '-' + (++sequence), resolve: resolve, controller: new AbortController(), base: base };
        active = request;
        request.timer = setTimeout(function () { finish(request, 'failed'); }, 300000);
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'agent-native-google-auth', requestId: request.id, url: start.href
        }));
      });
    },
    complete: function (id, token) {
      var request = active;
      if (!request || request.id !== id) return;
      if (!token) { finish(request, 'cancelled'); return; }
      var options = { credentials: 'include', cache: 'no-store', signal: request.controller.signal };
      fetch(location.origin + request.base + '/_agent-native/auth/mobile-session', Object.assign({}, options, {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Request-Source': 'mobile' }
      })).then(function (response) {
        if (!response.ok || active !== request) throw new Error('Session handoff failed.');
        return fetch(location.origin + request.base + '/_agent-native/auth/session', options);
      }).then(function (response) {
        if (!response.ok) throw new Error('Session confirmation failed.');
        return response.json();
      }).then(function (session) {
        if (session.token !== token || typeof session.email !== 'string' || !session.email) {
          throw new Error('Session cookie was not confirmed.');
        }
        finish(request, 'signed-in');
      }).catch(function () { finish(request, 'failed'); });
    }
  };
})();
true;
`;

export function webViewGoogleAuthCompletionScript(
  requestId: string,
  token: string | null,
  expectedOrigin: string,
): string {
  return `if (location.origin === ${JSON.stringify(expectedOrigin)}) { window.__agentNativeMobileOAuth?.complete(${JSON.stringify(requestId)}, ${JSON.stringify(token)}); } true;`;
}

export function validatedWebViewOAuthToken(
  googleUrl: string,
  callbackUrl: string,
): string | null {
  const expected = new URL(googleUrl).searchParams.get("state");
  const callback = new URL(callbackUrl);
  if (
    !expected ||
    callback.protocol !== "agentnative:" ||
    callback.hostname !== "oauth-complete" ||
    callback.pathname !== "" ||
    callback.searchParams.get("state") !== expected
  )
    return null;
  return callback.searchParams.get("token") || null;
}
