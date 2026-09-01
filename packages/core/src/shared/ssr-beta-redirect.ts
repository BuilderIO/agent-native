import {
  BETA_FORCE_QUERY_PARAM,
  BETA_FORCE_SESSION_STORAGE_KEY,
  BETA_OPT_OUT_QUERY_PARAM,
  BETA_OPT_OUT_STORAGE_KEY,
  BETA_REDIRECT_STORAGE_KEY,
  ENVIRONMENT_BETA_HOSTS,
} from "./environment-lanes.js";

export const SSR_BETA_REDIRECT_MARKER = 'data-agent-native-beta-redirect="1"';

/**
 * The marker is a performance hint set after the client verifies a Builder
 * employee session. It is never an authorization check; the normal session
 * gate remains responsible for access control.
 */
export function getSsrBetaRedirectScriptBody(): string {
  return `(function __anEarlyBetaRedirect() {
  if (window.__agentNativeBetaRedirectStarted) return;
  window.__agentNativeBetaRedirectStarted = true;
  if (window.parent !== window) return;

  var betaHosts = ${JSON.stringify(ENVIRONMENT_BETA_HOSTS)};
  var hostname = (window.location.hostname || '').toLowerCase().replace(/\\.$/, '');
  var productionHost = hostname.indexOf('beta.') === 0 ? hostname.slice(5) : hostname;
  var betaHost = betaHosts[productionHost];
  if (typeof betaHost !== 'string' || betaHost === hostname) return;

  var currentUrl;
  try {
    currentUrl = new URL(window.location.href);
  } catch (error) {
    void error;
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
  if (!Number.isFinite(redirectExpiry) || redirectExpiry <= Date.now()) {
    if (storedRedirect !== null) {
      try {
        window.localStorage.removeItem(${JSON.stringify(BETA_REDIRECT_STORAGE_KEY)});
      } catch (error) {
        void error;
      }
    }
    return;
  }

  currentUrl.protocol = 'https:';
  currentUrl.hostname = betaHost;
  currentUrl.port = '';
  currentUrl.searchParams.delete(${JSON.stringify(BETA_OPT_OUT_QUERY_PARAM)});
  try {
    window.location.replace(currentUrl.toString());
  } catch (error) {
    void error;
  }
})();`;
}

export function getSsrBetaRedirectScript(): string {
  return `<script ${SSR_BETA_REDIRECT_MARKER}>${getSsrBetaRedirectScriptBody()}</script>`;
}
