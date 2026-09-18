/**
 * Tweak bridge — injected into every canvas iframe.
 *
 * ALWAYS injected so the parent's postMessage (`tweak-values`) can update CSS
 * custom properties on the iframe's :root regardless of which editor mode is
 * active. Without this the tweak panel silently no-ops in Comment mode.
 *
 * Protocol (parent → iframe):
 *
 *   { type: 'tweak-values', values: Record<string, string> }
 *     Apply each key/value pair as a CSS custom property on :root.
 *
 * Rules:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 */
(function () {
  window.addEventListener("message", function (e: MessageEvent) {
    if (e.source !== window.parent) return;
    if (!e.data || e.data.type !== "tweak-values") return;
    var root = document.documentElement;
    var vals: Record<string, string> = e.data.values || {};
    Object.keys(vals).forEach(function (k: string) {
      root.style.setProperty(k, vals[k]);
    });
  });
})();
