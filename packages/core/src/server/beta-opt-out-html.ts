import {
  BETA_OPT_OUT_DURATION_MS,
  BETA_OPT_OUT_QUERY_PARAM,
  BETA_OPT_OUT_STORAGE_KEY,
  ENVIRONMENT_BETA_HOSTS,
} from "../shared/environment-lanes.js";

export const BETA_OPT_OUT_PERSISTENCE_MARKER =
  "Persist the beta opt-out before authentication";

const ENVIRONMENT_SWITCHER_MARKER =
  'data-agent-native-environment-switcher="1"';
const ENVIRONMENT_SWITCHER_STYLE_MARKER =
  'data-agent-native-environment-switcher-style="1"';
const ENVIRONMENT_SWITCHER_SCRIPT_MARKER =
  'data-agent-native-environment-switcher-script="1"';
const EXISTING_ENVIRONMENT_SWITCHER_RE = /\bid=["']environment-switcher["']/;

function insertBeforeClosingTag(
  html: string,
  fragment: string,
  closingTag: "</body>" | "</head>",
): string {
  const closeIndex = html.indexOf(closingTag);
  if (closeIndex < 0) return html + fragment;
  return html.slice(0, closeIndex) + fragment + html.slice(closeIndex);
}

const environmentSwitcherMarkup = `<div class="environment-switcher" id="environment-switcher" ${ENVIRONMENT_SWITCHER_MARKER} hidden>
  <button type="button" class="environment-badge" id="environment-badge" aria-expanded="false" aria-controls="environment-popover">beta</button>
  <div class="environment-popover" id="environment-popover" role="dialog" aria-labelledby="environment-popover-title" hidden>
    <div class="environment-popover-title" id="environment-popover-title">You're on Agent Native Beta</div>
    <div class="environment-popover-copy">Choose where you want to continue.</div>
    <a class="environment-production-link" id="environment-production-link" href="">Switch to production</a>
  </div>
</div>`;

const environmentSwitcherStyles = `<style ${ENVIRONMENT_SWITCHER_STYLE_MARKER}>
  color-scheme: dark;
  .environment-switcher {
    position: fixed;
    right: max(0.75rem, env(safe-area-inset-right));
    bottom: max(0.75rem, env(safe-area-inset-bottom));
    z-index: 100;
  }
  .environment-switcher[hidden],
  .environment-popover[hidden] { display: none; }
  .environment-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 1.5rem;
    min-width: 0;
    padding: 0 0.5rem;
    background: CanvasText;
    color: Canvas;
    border: 1px solid color-mix(in srgb, Canvas 16%, transparent);
    border-radius: 0.75rem;
    box-shadow: 0 2px 8px color-mix(in srgb, CanvasText 25%, transparent);
    font: inherit;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.03125rem;
    line-height: 1;
    text-transform: uppercase;
    cursor: pointer;
  }
  .environment-badge:hover,
  .environment-badge[aria-expanded="true"] {
    background: color-mix(in srgb, CanvasText 85%, Canvas);
  }
  .environment-badge:focus-visible,
  .environment-production-link:focus-visible {
    outline: 2px solid LinkText;
    outline-offset: 2px;
  }
  .environment-popover {
    position: absolute;
    right: 0;
    bottom: calc(100% + 0.5rem);
    width: min(17.5rem, calc(100vw - 1.5rem));
    padding: 1.25rem;
    background: Canvas;
    color: CanvasText;
    border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    border-radius: 0.75rem;
    box-shadow: 0 18px 50px color-mix(in srgb, CanvasText 42%, transparent);
  }
  .environment-popover-title { margin-bottom: 0.25rem; font-size: 0.875rem; font-weight: 600; line-height: 1.25rem; }
  .environment-popover-copy { margin-bottom: 1rem; color: GrayText; font-size: 0.875rem; line-height: 1.25rem; }
  .environment-production-link {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 2rem;
    padding: 0.375rem 0.75rem;
    color: CanvasText;
    border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    text-decoration: none;
  }
  .environment-production-link:hover {
    background: color-mix(in srgb, CanvasText 12%, Canvas);
  }
</style>`;

const environmentSwitcherScript = `<script ${ENVIRONMENT_SWITCHER_SCRIPT_MARKER}>
(function __anInitEnvironmentBadge() {
  var switcher = document.getElementById('environment-switcher');
  var button = document.getElementById('environment-badge');
  var popover = document.getElementById('environment-popover');
  var productionLink = document.getElementById('environment-production-link');
  if (!switcher || !button || !popover || !productionLink) return;
  if (window.parent !== window) return;

  var betaHosts = ${JSON.stringify(ENVIRONMENT_BETA_HOSTS)};
  var hostname = (window.location.hostname || '').toLowerCase().replace(/\\.$/, '');
  var productionHost = hostname.indexOf('beta.') === 0 ? hostname.slice(5) : '';
  if (!productionHost || betaHosts[productionHost] !== hostname) return;

  try {
    var productionUrl = new URL(window.location.href);
    productionUrl.protocol = 'https:';
    productionUrl.hostname = productionHost;
    productionUrl.port = '';
    productionUrl.searchParams.set(
      ${JSON.stringify(BETA_OPT_OUT_QUERY_PARAM)},
      String(Date.now() + ${BETA_OPT_OUT_DURATION_MS}),
    );
    productionLink.href = productionUrl.toString();
  } catch (error) {
    void error;
    return;
  }

  function setOpen(open) {
    popover.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }

  switcher.hidden = false;
  button.addEventListener('click', function() {
    setOpen(popover.hidden);
  });
  document.addEventListener('click', function(event) {
    if (!switcher.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') setOpen(false);
  });
})();
</script>`;

const betaOptOutPersistenceScript = `<script data-agent-native-beta-opt-out>
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

/**
 * Custom auth pages do not necessarily use the framework onboarding shell.
 * Keep the production switcher's one-time opt-out behavior at the shared auth
 * response boundary so those pages cannot drop the handoff before sign-in.
 */
export function injectBetaOptOutPersistence(loginHtml: string): string {
  let html = loginHtml;
  if (!html.includes(BETA_OPT_OUT_PERSISTENCE_MARKER)) {
    html = insertBeforeClosingTag(html, betaOptOutPersistenceScript, "</body>");
  }
  // The standard onboarding shell already owns this markup, style, and
  // initializer. Custom login pages need the shared switcher, but adding a
  // second copy would create duplicate IDs and event handlers.
  if (EXISTING_ENVIRONMENT_SWITCHER_RE.test(html)) return html;
  if (!html.includes(ENVIRONMENT_SWITCHER_STYLE_MARKER)) {
    html = insertBeforeClosingTag(html, environmentSwitcherStyles, "</head>");
  }
  if (!html.includes(ENVIRONMENT_SWITCHER_MARKER)) {
    html = insertBeforeClosingTag(html, environmentSwitcherMarkup, "</body>");
  }
  if (!html.includes(ENVIRONMENT_SWITCHER_SCRIPT_MARKER)) {
    html = insertBeforeClosingTag(html, environmentSwitcherScript, "</body>");
  }
  return html;
}
