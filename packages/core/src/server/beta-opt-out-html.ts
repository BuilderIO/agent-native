import {
  BETA_OPT_OUT_QUERY_PARAM,
  BETA_OPT_OUT_STORAGE_KEY,
} from "../shared/environment-lanes.js";

export const BETA_OPT_OUT_PERSISTENCE_MARKER =
  "Persist the beta opt-out before authentication";

/**
 * Custom auth pages do not necessarily use the framework onboarding shell.
 * Keep the production switcher's one-time opt-out behavior at the shared auth
 * response boundary so those pages cannot drop the handoff before sign-in.
 */
export function injectBetaOptOutPersistence(loginHtml: string): string {
  if (loginHtml.includes(BETA_OPT_OUT_PERSISTENCE_MARKER)) return loginHtml;

  const script = `<script data-agent-native-beta-opt-out>
// ${BETA_OPT_OUT_PERSISTENCE_MARKER}.
(function __anPersistBetaOptOut() {
  try {
    var optOutUrl = new URL(window.location.href);
    var optOutValue = optOutUrl.searchParams.get(${JSON.stringify(BETA_OPT_OUT_QUERY_PARAM)});
    if (optOutValue === null) return;
    var optOutExpiry = Number(optOutValue);
    var optOutStorageReady = false;
    try {
      if (Number.isFinite(optOutExpiry) && optOutExpiry > Date.now()) {
        window.localStorage.setItem(
          ${JSON.stringify(BETA_OPT_OUT_STORAGE_KEY)},
          String(optOutExpiry),
        );
      }
      optOutStorageReady = true;
    } catch (error) {
      void error;
    }
    if (optOutStorageReady) {
      optOutUrl.searchParams.delete(${JSON.stringify(BETA_OPT_OUT_QUERY_PARAM)});
      window.history.replaceState(null, '', optOutUrl.toString());
    }
  } catch (error) {
    void error;
  }
})();
</script>`;

  const bodyCloseIndex = loginHtml.indexOf("</body>");
  if (bodyCloseIndex >= 0) {
    return (
      loginHtml.slice(0, bodyCloseIndex) +
      script +
      loginHtml.slice(bodyCloseIndex)
    );
  }

  const headCloseIndex = loginHtml.indexOf("</head>");
  if (headCloseIndex >= 0) {
    return (
      loginHtml.slice(0, headCloseIndex) +
      script +
      loginHtml.slice(headCloseIndex)
    );
  }

  return loginHtml + script;
}
