import { createAuthPlugin } from "./auth-plugin.js";
import { getPublicOAuthOrigin } from "./oauth-public-origin.js";
import { getWorkspaceGatewayReturnOrigin } from "./oauth-return-url.js";
import {
  resolveGoogleAuthMode,
  type GoogleAuthMode,
} from "./google-auth-mode.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface GoogleAuthPluginOptions {
  /** Additional paths accessible without authentication */
  publicPaths?: string[];
  /**
   * Google sign-in flow: `'popup'`, `'redirect'`, or `'auto'` (default).
   * Falls back to `GOOGLE_AUTH_MODE` env var, then `'auto'`. Builder web
   * iframes use popup; Builder desktop preview/editor surfaces use redirect.
   */
  googleAuthMode?: GoogleAuthMode;
}

function getGoogleLoginHtml(googleAuthMode: GoogleAuthMode): string {
  const publicOAuthOrigin = getPublicOAuthOrigin();
  const workspaceGatewayReturnOrigin = getWorkspaceGatewayReturnOrigin();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Sign in</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0a0a0a;
    color: #e5e5e5;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .card {
    width: 100%;
    max-width: 360px;
    padding: 2rem;
    background: #141414;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    text-align: center;
  }
  h1 { font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem; color: #fff; }
  .subtitle { font-size: 0.8125rem; color: #888; margin-bottom: 1.5rem; }
  button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    padding: 0.625rem;
    background: #fff;
    color: #000;
    border: none;
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
  }
  button:hover { opacity: 0.85; }
  button:disabled { opacity: 0.5; cursor: wait; }
  .error { margin-top: 0.75rem; font-size: 0.8125rem; color: #f87171; display: none; }
  .error.show { display: block; }
  .debug {
    display: none;
    margin-top: 0.625rem;
    font-size: 0.6875rem;
    line-height: 1.45;
    color: #777;
    word-break: break-word;
  }
  .debug.show { display: block; }
  svg { width: 18px; height: 18px; }
</style>
</head>
<body>
<div class="card">
  <h1>Sign in</h1>
  <p class="subtitle">Continue with your Google account</p>
  <button id="btn" onclick="signIn()">
    <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
    Sign in with Google
  </button>
  <p class="error" id="err"></p>
  <p class="debug" id="debug"></p>
</div>
<script>
  function __anBasePath() {
    var marker = '/_agent-native';
    var idx = window.location.pathname.indexOf(marker);
    return idx > 0 ? window.location.pathname.slice(0, idx) : '';
  }
  function __anPath(path) {
    return __anBasePath() + path;
  }
  var __AN_PUBLIC_OAUTH_ORIGIN = ${JSON.stringify(publicOAuthOrigin)};
  var __AN_WORKSPACE_GATEWAY_RETURN_ORIGIN = ${JSON.stringify(workspaceGatewayReturnOrigin)};
  var __AN_GOOGLE_AUTH_MODE = ${JSON.stringify(googleAuthMode)};
  function __anConfiguredOAuthOrigin() {
    if (!__AN_PUBLIC_OAUTH_ORIGIN) return '';
    try {
      var origin = new URL(__AN_PUBLIC_OAUTH_ORIGIN).origin;
      return origin && origin !== window.location.origin ? origin : '';
    } catch(e) {
      return '';
    }
  }
  function __anAuthPath(path) {
    var origin = __anIsBuilderPreview() ? __anConfiguredOAuthOrigin() : '';
    return origin ? origin + path : __anPath(path);
  }
  function __anGoogleAuthUrlPath() {
    return __anIsBuilderPreview()
      ? __anAuthPath('/_agent-native/google/auth-url')
      : __anPath('/_agent-native/google/auth-url');
  }
  function __anBuilderPreviewReturnOrigin() {
    var candidates = [window.location.href, document.referrer || ''];
    try {
      if (window.location.ancestorOrigins) {
        for (var j = 0; j < window.location.ancestorOrigins.length; j++) {
          candidates.push(window.location.ancestorOrigins[j]);
        }
      }
    } catch(e) {}
    for (var i = 0; i < candidates.length; i++) {
      try {
        var url = new URL(candidates[i]);
        var host = url.hostname.toLowerCase();
        var isPreviewHost =
          host === 'builderio.xyz' || host.slice(-14) === '.builderio.xyz' ||
          host === 'builderio.dev' || host.slice(-14) === '.builderio.dev' ||
          host === 'builder.codes' || host.slice(-14) === '.builder.codes' ||
          host === 'builder.my' || host.slice(-11) === '.builder.my';
        if (url.protocol === 'https:' && isPreviewHost) return url.origin;
      } catch(e) {}
    }
    return '';
  }
  function __anWorkspaceGatewayReturnOrigin() {
    var previewOrigin = __anBuilderPreviewReturnOrigin();
    if (previewOrigin) return previewOrigin;
    if (__AN_WORKSPACE_GATEWAY_RETURN_ORIGIN) return __AN_WORKSPACE_GATEWAY_RETURN_ORIGIN;
    return __anIsBuilderDesktop() ? 'http://127.0.0.1:8080' : '';
  }
  function __anNormalizeWorkspaceReturnPath(ret) {
    try {
      var url = new URL(ret || '/', window.location.origin);
      var path = url.pathname || '/';
      if (path === '/dispatch/dispatch') {
        path = '/dispatch';
      } else if (path.indexOf('/dispatch/') === 0) {
        var rest = path.slice('/dispatch/'.length);
        var first = rest.split('/')[0];
        var dispatchRoutes = {
          overview: true, apps: true, metrics: true, vault: true,
          integrations: true, messaging: true, workspace: true,
          agents: true, destinations: true, identities: true,
          approvals: true, audit: true, team: true, 'thread-debug': true,
          'new-app': true
        };
        if (first === 'dispatch') {
          path = '/dispatch' + rest.slice(first.length);
        } else if (first && !dispatchRoutes[first]) {
          path = '/' + rest;
        }
      }
      return path + url.search + url.hash;
    } catch(e) {
      return ret || '/';
    }
  }
  function __anOAuthReturnTarget(ret) {
    var path = __anNormalizeWorkspaceReturnPath(ret);
    var origin = __anWorkspaceGatewayReturnOrigin();
    return origin ? origin + path : path;
  }
  function __anSessionBridgeUrl(ret, sessionToken) {
    try {
      var url = new URL(ret || window.location.pathname + window.location.search, window.location.origin);
      url.searchParams.set('_session', sessionToken);
      return url.pathname + url.search + url.hash;
    } catch(e) {
      var sep = (ret || '/').indexOf('?') === -1 ? '?' : '&';
      return (ret || '/') + sep + '_session=' + encodeURIComponent(sessionToken);
    }
  }
  function __anFinishOAuthExchange(ret, flowId, sessionToken) {
    if (__anIsBuilderPreview()) {
      if (sessionToken) {
        __anSetOAuthDebug('OAuth exchange redeemed; applying session bridge to embedded app', flowId);
        window.location.replace(__anSessionBridgeUrl(ret, sessionToken));
        return;
      }
      __anSetOAuthDebug('OAuth exchange redeemed; reloading the embedded app', flowId);
      window.location.reload();
      return;
    }
    __anSetOAuthDebug('OAuth exchange redeemed; returning to the app', flowId);
    window.location.href = ret || '/';
  }
  var __anBuilderPreviewSeen = false;
  function __anRememberBuilderPreview() {
    __anBuilderPreviewSeen = true;
    try { sessionStorage.setItem('__an_builder_preview_seen', '1'); } catch(e) {}
  }
  function __anHasBuilderPreviewSignal() {
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.has('builder.preview') || params.has('builder.frameEditing') || params.has('__builder_editing__')) return true;
    } catch(e) {}
    return false;
  }
  function __anIsBuilderPreview() {
    if (__anBuilderPreviewSeen) return true;
    if (__anHasBuilderPreviewSignal()) {
      __anRememberBuilderPreview();
      return true;
    }
    try {
      if (sessionStorage.getItem('__an_builder_preview_seen') === '1') {
        __anBuilderPreviewSeen = true;
        return true;
      }
    } catch(e) {}
    try {
      var ref = document.referrer || '';
      var fromBuilder = ref.indexOf('builder.io') !== -1 || ref.indexOf('builder.my') !== -1 || ref.indexOf('builderio.xyz') !== -1 || ref.indexOf('builderio.dev') !== -1 || ref.indexOf('builder.codes') !== -1;
      if (fromBuilder) __anRememberBuilderPreview();
      return fromBuilder;
    } catch(e) {
      return false;
    }
  }
  __anIsBuilderPreview();
  function __anIsBuilderDesktop() {
    try {
      var ua = navigator.userAgent || '';
      return ua.indexOf('Electron') !== -1 && ua.indexOf('AgentNativeDesktop') === -1;
    } catch(e) {
      return false;
    }
  }
  function __anIsAgentNativeDesktop() {
    try {
      return (navigator.userAgent || '').indexOf('AgentNativeDesktop') !== -1;
    } catch(e) {
      return false;
    }
  }
  function __anIsElectron() {
    try {
      return (navigator.userAgent || '').indexOf('Electron') !== -1;
    } catch(e) {
      return false;
    }
  }
  function __anResolveAuthFlow() {
    if (__anIsBuilderPreview()) return __anIsBuilderDesktop() ? 'redirect' : 'popup';
    var mode = __AN_GOOGLE_AUTH_MODE || 'auto';
    if (mode === 'popup') return 'popup';
    if (mode === 'redirect') return 'redirect';
    return __anIsElectron() ? 'redirect' : 'popup';
  }
  var __anOAuthPollTimer = null;
  var __anOAuthPollCount = 0;
  function __anNewOAuthFlowId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch(e) {}
    return 'builder-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function __anFlowDebugId(flowId) {
    return flowId ? String(flowId).slice(-10) : '';
  }
  function __anShouldShowOAuthDebug() {
    try {
      var loc = window.location || {};
      return (typeof loc.hash === 'string' && loc.hash.indexOf('oauth-debug') !== -1) ||
        (typeof loc.search === 'string' && loc.search.indexOf('oauth_debug=1') !== -1);
    } catch(e) { return false; }
  }
  function __anSetOAuthDebug(message, flowId) {
    var text = message + (flowId ? ' (flow ' + __anFlowDebugId(flowId) + ')' : '');
    try {
      console.info('[agent-native][google-oauth] ' + text);
    } catch(e) {}
    var debug = document.getElementById('debug');
    if (debug) {
      debug.textContent = text;
      if (__anShouldShowOAuthDebug()) debug.classList.add('show');
    }
  }
  function __anShowOAuthError(err, btn, message) {
    if (__anOAuthPollTimer) {
      clearInterval(__anOAuthPollTimer);
      __anOAuthPollTimer = null;
    }
    err.textContent = message;
    err.classList.add('show');
    btn.disabled = false;
  }
  function __anWaitForOAuthExchange(flowId, ret, btn, err) {
    var started = Date.now();
    var timeoutMs = 5 * 60 * 1000;
    __anOAuthPollCount = 0;
    async function check() {
      __anOAuthPollCount++;
      try {
        var res = await fetch(__anPath('/_agent-native/auth/desktop-exchange') + '?flow_id=' + encodeURIComponent(flowId), { credentials: 'include' });
        var data = await res.json().catch(function() { return {}; });
        if (data && (data.email || data.token)) {
          if (__anOAuthPollTimer) clearInterval(__anOAuthPollTimer);
          __anOAuthPollTimer = null;
          __anFinishOAuthExchange(ret, flowId, data.token);
          return;
        }
        if (data && data.error) {
          __anSetOAuthDebug('OAuth exchange returned an error: ' + (data.message || data.error), flowId);
          __anShowOAuthError(err, btn, data.message || data.error);
          return;
        }
        if (data && data.pending && (__anOAuthPollCount === 1 || __anOAuthPollCount % 5 === 0)) {
          __anSetOAuthDebug('Waiting for the Google callback; polling attempt ' + __anOAuthPollCount, flowId);
        }
      } catch(e) {
        if (__anOAuthPollCount === 1 || __anOAuthPollCount % 5 === 0) {
          __anSetOAuthDebug('Could not reach the OAuth exchange endpoint: ' + (e && e.message ? e.message : 'network error'), flowId);
        }
      }
      if (Date.now() - started > timeoutMs) {
        __anShowOAuthError(err, btn, 'Google sign-in did not finish. Flow ' + __anFlowDebugId(flowId) + ' never reached this app. Check the Google OAuth redirect URI and server logs for [agent-native][google-oauth].');
      }
    }
    if (__anOAuthPollTimer) clearInterval(__anOAuthPollTimer);
    __anOAuthPollTimer = setInterval(check, 1000);
    setTimeout(check, 500);
  }
  function __anStartPopupOAuth(ret, btn, err) {
    var flowId = __anNewOAuthFlowId();
    var oauthReturn = __anIsBuilderPreview() ? __anOAuthReturnTarget(ret) : ret;
    var params = new URLSearchParams();
    if (oauthReturn) params.set('return', oauthReturn);
    params.set('desktop', '1');
    params.set('flow_id', flowId);
    params.set('redirect', '1');
    var url = __anGoogleAuthUrlPath() + '?' + params.toString();
    try { sessionStorage.setItem('__an_signin', '1'); } catch(e) {}
    __anSetOAuthDebug('Opening Google sign-in popup', flowId);
    try {
      var popup = window.open('', '_blank', 'width=640,height=760');
      if (!popup) {
        __anShowOAuthError(err, btn, 'Google popup was blocked. Allow popups for this site and try again (flow ' + __anFlowDebugId(flowId) + ').');
        return;
      }
      try { popup.opener = null; } catch(e) {}
      try {
        popup.location.href = url;
      } catch(e) {
        try { popup.close(); } catch(closeErr) {}
        __anShowOAuthError(err, btn, 'Could not navigate Google popup for flow ' + __anFlowDebugId(flowId) + ': ' + (e && e.message ? e.message : 'unknown error'));
        return;
      }
      __anSetOAuthDebug('Google popup opened; waiting for callback', flowId);
    } catch(e) {
      __anShowOAuthError(err, btn, 'Could not open Google popup for flow ' + __anFlowDebugId(flowId) + ': ' + (e && e.message ? e.message : 'unknown error'));
      return;
    }
    __anWaitForOAuthExchange(flowId, ret, btn, err);
  }
  function __anStartNativeDesktopOAuth(ret, btn, err) {
    var flowId = __anNewOAuthFlowId();
    var params = new URLSearchParams();
    if (ret) params.set('return', ret);
    params.set('desktop', '1');
    params.set('flow_id', flowId);
    params.set('redirect', '1');
    var url = __anGoogleAuthUrlPath() + '?' + params.toString();
    __anSetOAuthDebug('Opening Google sign-in in system browser', flowId);
    __anOpenOAuthUrl(url);
    __anWaitForOAuthExchange(flowId, ret, btn, err);
  }
  function __anOpenOAuthUrl(url) {
    try { sessionStorage.setItem('__an_signin', '1'); } catch(e) {}
    window.location.href = url;
  }
  async function signIn() {
    var btn = document.getElementById('btn');
    var err = document.getElementById('err');
    var ret = window.location.pathname + window.location.search;
    btn.disabled = true;
    err.classList.remove('show');
    if (__anResolveAuthFlow() === 'popup') {
      __anStartPopupOAuth(ret, btn, err);
      return;
    }
    if (__anIsAgentNativeDesktop()) {
      __anStartNativeDesktopOAuth(ret, btn, err);
      return;
    }
    if (__anIsBuilderPreview()) {
      var params = new URLSearchParams();
      if (ret) params.set('return', __anOAuthReturnTarget(ret));
      params.set('redirect', '1');
      __anSetOAuthDebug('Opening Google sign-in redirect');
      __anOpenOAuthUrl(__anGoogleAuthUrlPath() + '?' + params.toString());
      return;
    }
    try {
      var res = await fetch(__anGoogleAuthUrlPath() + '?return=' + encodeURIComponent(ret));
      var data = await res.json();
      if (data.url) {
        __anOpenOAuthUrl(data.url);
      } else {
        err.textContent = data.message || 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.';
        err.classList.add('show');
        btn.disabled = false;
      }
    } catch (e) {
      err.textContent = 'Failed to connect. Please try again.';
      err.classList.add('show');
      btn.disabled = false;
    }
  }
</script>
</body>
</html>`;
}

/**
 * Create an auth plugin that uses Google OAuth for authentication.
 *
 * When a user visits the app unauthenticated, they see a "Sign in with Google"
 * page. The Google OAuth callback (handled by the template) creates a session
 * tied to the user's Google email. `getSession()` then returns `{ email }` for
 * all subsequent requests.
 *
 * Better Auth handles Google OAuth internally when GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET are set. The template's callback route at
 * /_agent-native/google/callback handles mobile deep linking.
 *
 * Usage in a template's `server/plugins/auth.ts`:
 * ```ts
 * import { createGoogleAuthPlugin } from "@agent-native/core/server";
 * export default createGoogleAuthPlugin();
 * ```
 */
export function createGoogleAuthPlugin(
  options?: GoogleAuthPluginOptions,
): NitroPluginDef {
  return createAuthPlugin({
    publicPaths: [
      "/_agent-native/google/callback",
      "/_agent-native/google/auth-url",
      "/_agent-native/auth/ba",
      ...(options?.publicPaths ?? []),
    ],
    loginHtml: getGoogleLoginHtml(
      resolveGoogleAuthMode(options?.googleAuthMode),
    ),
  });
}
