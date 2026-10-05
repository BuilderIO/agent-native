import { safeJsonForHtml } from "./agent-readable-resource.js";
import {
  BETA_FORCE_QUERY_PARAM,
  BETA_FORCE_SESSION_STORAGE_KEY,
  BETA_LANE_REDIRECT_QUERY_PARAM,
  BETA_OPT_OUT_QUERY_PARAM,
  BETA_OPT_OUT_STORAGE_KEY,
  BETA_REDIRECT_STORAGE_KEY,
  BETA_REDIRECT_SIGN_OUT_STORAGE_KEY,
  ENVIRONMENT_BETA_HOSTS,
} from "./environment-lanes.js";
import {
  SESSION_NAVIGATION_FLAG,
  SESSION_NAVIGATION_RELEASED_EVENT,
  SESSION_NAVIGATION_STALL_MS,
} from "./ssr-session-bootstrap.js";

export const SSR_BETA_REDIRECT_MARKER = 'data-agent-native-beta-redirect="1"';

/**
 * The marker is a performance hint set after the client verifies a Builder
 * employee session. The browser re-checks the current session before using
 * it, so it never becomes an authorization check.
 */
export function getSsrBetaRedirectScriptBody(
  sessionPath = "/_agent-native/auth/session",
  frameworkRoutePrefix = "/_agent-native",
): string {
  return `(function __anEarlyBetaRedirect() {
  if (window.__agentNativeBetaRedirectStarted) return;
  window.__agentNativeBetaRedirectStarted = true;
  if (window.parent !== window) return;

  var betaHosts = ${JSON.stringify(ENVIRONMENT_BETA_HOSTS)};
  var hostname = (window.location.hostname || '').toLowerCase().replace(/\\.$/, '');
  var productionHost = hostname.indexOf('beta.') === 0 ? hostname.slice(5) : hostname;
  var betaHost = betaHosts[productionHost];
  if (typeof betaHost !== 'string') return;

  var currentUrl;
  try {
    currentUrl = new URL(window.location.href);
  } catch (error) {
    void error;
    return;
  }

  function sessionProbePathFor(url) {
    var probePath = ${safeJsonForHtml(sessionPath)};
    var appConfig = window.__AGENT_NATIVE_CONFIG__;
    if (!appConfig || appConfig.workspaceRuntime !== true) return probePath;

    var frameworkSessionPath = ${safeJsonForHtml(`${frameworkRoutePrefix}/auth/session`)};
    var frameworkSegment = ${safeJsonForHtml(frameworkRoutePrefix.slice(1))};
    var knownWorkspaceMounts = Array.isArray(appConfig.workspaceAppMountPaths)
      ? appConfig.workspaceAppMountPaths
      : null;
    var workspaceMount = '';
    if (knownWorkspaceMounts) {
      var mountSegment = url.pathname.split('/').find(function (segment) {
        return segment;
      });
      var candidateWorkspaceMount = mountSegment &&
        mountSegment !== '_agent-native' &&
        mountSegment !== frameworkSegment &&
        mountSegment !== 'api' &&
        mountSegment !== 'sign-in' &&
        mountSegment !== 'login' &&
        mountSegment !== 'signup'
        ? '/' + mountSegment
        : '';
      if (knownWorkspaceMounts.indexOf(candidateWorkspaceMount) !== -1) {
        workspaceMount = candidateWorkspaceMount;
      }
    }
    if (
      workspaceMount &&
      typeof probePath === 'string' &&
      probePath.endsWith(frameworkSessionPath)
    ) {
      var configuredWorkspaceMount = probePath.slice(
        0,
        -frameworkSessionPath.length,
      );
      if (configuredWorkspaceMount !== workspaceMount) {
        probePath = workspaceMount + frameworkSessionPath;
      }
    }
    return probePath;
  }

  // One session read per page: reuse the read the session bootstrap started,
  // or publish this one in the same shape so the app reuses it. A probe that
  // targets a different workspace mount than the app reads stays separate.
  // Resolves to the session body, null when signed out (401/403), or undefined
  // when the answer is unreadable.
  function readSessionForProbe(url) {
    var probePath = sessionProbePathFor(url);
    var sharesAppRead = probePath === ${safeJsonForHtml(sessionPath)};
    var read = sharesAppRead ? window.__agentNativeSessionBootstrap : undefined;
    if (!read) {
      read = window.fetch(probePath, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      }).then(function (response) {
        if (!response) return { state: 'unavailable' };
        if (!response.ok) return { state: 'unavailable', status: response.status };
        return response.json().then(function (value) {
          return { state: 'available', value: value };
        }, function () {
          return { state: 'unavailable', status: response.status };
        });
      }, function () {
        return { state: 'unavailable' };
      });
      if (sharesAppRead) window.__agentNativeSessionBootstrap = read;
    }
    return read.then(function (result) {
      if (result && result.state === 'available') return result.value;
      if (result && (result.status === 401 || result.status === 403)) return null;
      return undefined;
    });
  }

  if (betaHost === hostname) {
    // Older automatic arrivals carry this marker; beta must never send them back to production.
    if (currentUrl.searchParams.has(${JSON.stringify(BETA_LANE_REDIRECT_QUERY_PARAM)})) {
      currentUrl.searchParams.delete(${JSON.stringify(BETA_LANE_REDIRECT_QUERY_PARAM)});
      try {
        window.history.replaceState(null, '', currentUrl.toString());
      } catch (error) {
        void error;
      }
    }
    return;
  }

  if (currentUrl.searchParams.get(${JSON.stringify(BETA_FORCE_QUERY_PARAM)}) === 'true') {
    try {
      window.sessionStorage.setItem(${JSON.stringify(BETA_FORCE_SESSION_STORAGE_KEY)}, '1');
    } catch (error) {
      void error;
    }
    return;
  }

  try {
    if (window.sessionStorage.getItem(${JSON.stringify(BETA_FORCE_SESSION_STORAGE_KEY)}) === '1') return;
  } catch (error) {
    void error;
  }

  if (/AgentNativeDesktop/i.test((window.navigator && window.navigator.userAgent) || '')) return;

  var optOutValue = currentUrl.searchParams.get(${JSON.stringify(BETA_OPT_OUT_QUERY_PARAM)});
  if (optOutValue !== null) {
    var optOutExpiry = Number(optOutValue);
    if (Number.isFinite(optOutExpiry) && optOutExpiry > Date.now()) {
      try {
        window.localStorage.setItem(
          ${JSON.stringify(BETA_OPT_OUT_STORAGE_KEY)},
          String(optOutExpiry),
        );
        window.localStorage.removeItem(${JSON.stringify(BETA_REDIRECT_STORAGE_KEY)});
      } catch (error) {
        void error;
        return;
      }
      currentUrl.searchParams.delete(${JSON.stringify(BETA_OPT_OUT_QUERY_PARAM)});
      try {
        window.history.replaceState(null, '', currentUrl.toString());
      } catch (error) {
        void error;
      }
      return;
    }

    currentUrl.searchParams.delete(${JSON.stringify(BETA_OPT_OUT_QUERY_PARAM)});
    try {
      window.history.replaceState(null, '', currentUrl.toString());
    } catch (error) {
      void error;
    }
  }

  var storedOptOut;
  var storedRedirect;
  try {
    storedOptOut = window.localStorage.getItem(${JSON.stringify(BETA_OPT_OUT_STORAGE_KEY)});
    if (storedOptOut !== null) {
      var storedOptOutExpiry = Number(storedOptOut);
      if (Number.isFinite(storedOptOutExpiry) && storedOptOutExpiry > Date.now()) return;
      window.localStorage.removeItem(${JSON.stringify(BETA_OPT_OUT_STORAGE_KEY)});
    }
    storedRedirect = window.localStorage.getItem(${JSON.stringify(BETA_REDIRECT_STORAGE_KEY)});
  } catch (error) {
    void error;
    return;
  }

  var redirectExpiry = Number(storedRedirect);
  function clearRedirectMarker() {
    try {
      window.localStorage.removeItem(${JSON.stringify(BETA_REDIRECT_STORAGE_KEY)});
    } catch (error) {
      void error;
    }
  }

  function isSignOutStarted() {
    if (window.__agentNativeBetaRedirectSignOutStarted === true) return true;
    try {
      return window.sessionStorage.getItem(${JSON.stringify(BETA_REDIRECT_SIGN_OUT_STORAGE_KEY)}) === '1';
    } catch (error) {
      void error;
      return false;
    }
  }

  if (!Number.isFinite(redirectExpiry) || redirectExpiry <= Date.now()) {
    if (storedRedirect !== null) clearRedirectMarker();
    return;
  }

  if (isSignOutStarted()) return;

  if (typeof window.fetch !== 'function') return;

  readSessionForProbe(currentUrl).then(function (session) {
    if (session === undefined) return;
    if (session === null) {
      clearRedirectMarker();
      return;
    }
    var sessionError = session && typeof session.error === 'string'
      ? session.error.trim()
      : '';
    if (sessionError && sessionError !== 'Not authenticated') return;
    if (sessionError === 'Not authenticated') {
      clearRedirectMarker();
      return;
    }
    var email = session && typeof session.email === 'string'
      ? session.email.trim().toLowerCase()
      : '';
    if (!email) return;
    if (!email.endsWith('@builder.io')) {
      clearRedirectMarker();
      return;
    }

    if (isSignOutStarted()) return;

    var latestUrl;
    try {
      latestUrl = new URL(window.location.href);
    } catch (error) {
      void error;
      return;
    }
    var latestHostname = (latestUrl.hostname || '').toLowerCase().replace(/\\.$/, '');
    var latestProductionHost = latestHostname.indexOf('beta.') === 0
      ? latestHostname.slice(5)
      : latestHostname;
    if (latestHostname !== hostname || betaHosts[latestProductionHost] !== betaHost) return;
    if (latestUrl.searchParams.get(${JSON.stringify(BETA_FORCE_QUERY_PARAM)}) === 'true') return;
    var latestOptOut = latestUrl.searchParams.get(${JSON.stringify(BETA_OPT_OUT_QUERY_PARAM)});
    if (latestOptOut !== null && Number(latestOptOut) > Date.now()) return;

    var latestRedirect;
    try {
      latestRedirect = window.localStorage.getItem(${JSON.stringify(BETA_REDIRECT_STORAGE_KEY)});
    } catch (error) {
      void error;
      return;
    }
    if (!Number.isFinite(Number(latestRedirect)) || Number(latestRedirect) <= Date.now()) return;

    latestUrl.protocol = 'https:';
    latestUrl.hostname = betaHost;
    latestUrl.port = '';
    latestUrl.searchParams.delete(${JSON.stringify(BETA_OPT_OUT_QUERY_PARAM)});
    if (typeof window[${JSON.stringify(SESSION_NAVIGATION_FLAG)}] === 'string') return;
    var laneHref = latestUrl.toString();
    window[${JSON.stringify(SESSION_NAVIGATION_FLAG)}] = laneHref;
    // Same release as navigateForSession: a page still here after the stall
    // window never left, so the app must not stay held behind the claim.
    setTimeout(function () {
      if (window[${JSON.stringify(SESSION_NAVIGATION_FLAG)}] !== laneHref) return;
      delete window[${JSON.stringify(SESSION_NAVIGATION_FLAG)}];
      if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event(${JSON.stringify(SESSION_NAVIGATION_RELEASED_EVENT)}));
      }
    }, ${SESSION_NAVIGATION_STALL_MS});
    try {
      window.location.replace(laneHref);
    } catch (error) {
      void error;
    }
  }).catch(function (error) {
    void error;
    // A transient session failure must leave production usable; retry the hint
    // on a later navigation instead of redirecting without a current session.
  });
})();`;
}

export function getSsrBetaRedirectScript(
  sessionPath = "/_agent-native/auth/session",
  frameworkRoutePrefix = "/_agent-native",
): string {
  return `<script ${SSR_BETA_REDIRECT_MARKER}>${getSsrBetaRedirectScriptBody(sessionPath, frameworkRoutePrefix)}</script>`;
}
