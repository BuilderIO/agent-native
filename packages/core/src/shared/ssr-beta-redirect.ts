import { safeJsonForHtml } from "./agent-readable-resource.js";
import {
  BETA_FORCE_QUERY_PARAM,
  BETA_FORCE_SESSION_STORAGE_KEY,
  BETA_LANE_REDIRECT_QUERY_PARAM,
  BETA_LANE_RETURN_STORAGE_KEY,
  BETA_LANE_RETURNED_STORAGE_KEY,
  BETA_OPT_OUT_DURATION_MS,
  BETA_OPT_OUT_QUERY_PARAM,
  BETA_OPT_OUT_STORAGE_KEY,
  BETA_REDIRECT_STORAGE_KEY,
  BETA_REDIRECT_SIGN_OUT_STORAGE_KEY,
  ENVIRONMENT_BETA_HOSTS,
} from "./environment-lanes.js";

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

  function returnFromAutomaticBetaRedirect() {
    if (/AgentNativeDesktop/i.test((window.navigator && window.navigator.userAgent) || '')) return;

    var returnTo;
    var alreadyReturned;
    try {
      // The guard holds the deadline of the opt-out this tab last handed
      // production, so it lapses exactly when that opt-out does. A permanent
      // flag would block the legitimate second return in a tab left open
      // longer than the opt-out, stranding the visitor on beta all over again.
      var returnedUntil = Number(window.sessionStorage.getItem(${JSON.stringify(BETA_LANE_RETURNED_STORAGE_KEY)}));
      alreadyReturned = Number.isFinite(returnedUntil) && returnedUntil > Date.now();
      if (currentUrl.searchParams.get(${JSON.stringify(BETA_LANE_REDIRECT_QUERY_PARAM)}) !== null) {
        currentUrl.searchParams.delete(${JSON.stringify(BETA_LANE_REDIRECT_QUERY_PARAM)});
        // The client session gate replaces this URL with beta's sign-in page
        // before the probe below resolves, so the production page the visitor
        // was actually taken from has to be captured now or it is lost.
        if (!alreadyReturned) {
          window.sessionStorage.setItem(
            ${JSON.stringify(BETA_LANE_RETURN_STORAGE_KEY)},
            currentUrl.pathname + currentUrl.search + currentUrl.hash,
          );
        }
        try {
          window.history.replaceState(null, '', currentUrl.toString());
        } catch (error) {
          void error;
        }
      }
      returnTo = window.sessionStorage.getItem(${JSON.stringify(BETA_LANE_RETURN_STORAGE_KEY)});
    } catch (error) {
      // Without session storage the single return cannot be bounded, and an
      // unbounded return is a redirect loop between the two lanes. Staying on
      // beta is the pre-existing behaviour, so this is the safe failure.
      void error;
      return;
    }

    if (alreadyReturned || typeof returnTo !== 'string' || !returnTo) return;
    if (typeof window.fetch !== 'function') return;

    readSessionForProbe(currentUrl).then(function (session) {
      // Unreadable is not signed out. Bouncing on a transient failure would
      // throw away a beta session that is actually fine.
      if (session === undefined) return;
      var authenticated = false;
      if (session !== null) {
        var sessionError = session && typeof session.error === 'string'
          ? session.error.trim()
          : '';
        if (sessionError && sessionError !== 'Not authenticated') return;
        if (!sessionError) {
          authenticated = !!(session && typeof session.email === 'string' && session.email.trim());
        }
      }

      if (authenticated) {
        // The lane redirect worked: this visitor has a beta session and stays.
        try {
          window.sessionStorage.removeItem(${JSON.stringify(BETA_LANE_RETURN_STORAGE_KEY)});
        } catch (error) {
          void error;
        }
        return;
      }

      // One deadline for both: the opt-out production is asked to honour, and
      // the guard that stops this tab returning again while it should hold.
      var optOutUntil = Date.now() + ${BETA_OPT_OUT_DURATION_MS};
      try {
        window.sessionStorage.setItem(
          ${JSON.stringify(BETA_LANE_RETURNED_STORAGE_KEY)},
          String(optOutUntil),
        );
        window.sessionStorage.removeItem(${JSON.stringify(BETA_LANE_RETURN_STORAGE_KEY)});
      } catch (error) {
        void error;
        return;
      }

      var latestHostname = (window.location.hostname || '').toLowerCase().replace(/\\.$/, '');
      if (latestHostname !== hostname) return;

      var target;
      try {
        // Build from the production origin and copy only the path parts. A
        // stored value like "//evil.com" parses as protocol-relative, so it
        // must never be allowed to supply the host, port, or credentials.
        var storedTarget = new URL(returnTo, 'https://' + productionHost);
        target = new URL('https://' + productionHost);
        target.pathname = storedTarget.pathname;
        target.search = storedTarget.search;
        target.hash = storedTarget.hash;
        // The opt-out is what stops production redirecting straight back here.
        target.searchParams.set(
          ${JSON.stringify(BETA_OPT_OUT_QUERY_PARAM)},
          String(optOutUntil),
        );
      } catch (error) {
        void error;
        return;
      }

      try {
        window.location.replace(target.toString());
      } catch (error) {
        void error;
      }
    }).catch(function (error) {
      void error;
    });
  }

  // On beta: undo an automatic lane redirect that landed on a host where the
  // visitor has no session. Sessions are per-host, so the redirect that sent
  // someone here right after they signed in on production cannot carry their
  // session with it, and beta's sign-in page is a dead end they never asked
  // for. A deliberate switch to beta carries no marker and is left alone.
  if (betaHost === hostname) {
    returnFromAutomaticBetaRedirect();
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
    latestUrl.searchParams.set(${JSON.stringify(BETA_LANE_REDIRECT_QUERY_PARAM)}, '1');
    try {
      window.location.replace(latestUrl.toString());
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
