/**
 * Synchronous dev-only browser recovery for Vite optimized-dependency races.
 *
 * Keep this script dependency-free and non-module-safe: React Router SSR roots
 * inline it before `<Scripts />`, and the Vite plugin injects it at
 * `head-prepend` for HTML that does pass through transformIndexHtml.
 */
export function getViteDevRecoveryScript(): string {
  return `
(function() {
  var RELOAD_KEY = "__an_optimize_reload";
  var MAX_RELOADS = 3;
  var RESET_AFTER_MS = 8000;

  var reloadTimer = null;
  var overlayShown = false;

  // Track recent reloads in sessionStorage. If we reload too many times
  // in a short window, stop and show a manual-refresh message instead of
  // looping forever.
  function readReloadHistory() {
    try {
      var raw = sessionStorage.getItem(RELOAD_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      var cutoff = Date.now() - 30000;
      return Array.isArray(arr) ? arr.filter(function(t) { return t > cutoff; }) : [];
    } catch (e) { return []; }
  }
  function recordReload() {
    try {
      var history = readReloadHistory();
      history.push(Date.now());
      sessionStorage.setItem(RELOAD_KEY, JSON.stringify(history));
    } catch (e) {}
  }
  // Reset the counter after a stable period (page didn't fail again).
  setTimeout(function() {
    try { sessionStorage.removeItem(RELOAD_KEY); } catch (e) {}
  }, RESET_AFTER_MS);

  function showOverlay(title, subtitle) {
    if (overlayShown) return;
    overlayShown = true;
    var mount = function() {
      if (!document.body) { setTimeout(mount, 16); return; }
      var el = document.createElement("div");
      el.id = "__an-reload-overlay";
      el.style.cssText = [
        "position:fixed","inset:0","z-index:2147483647",
        "display:flex","align-items:center","justify-content:center",
        "background:rgba(0,0,0,0.6)","backdrop-filter:blur(8px)",
        "-webkit-backdrop-filter:blur(8px)",
        "font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif",
        "color:#fff","font-size:14px"
      ].join(";");
      el.innerHTML =
        '<div style="background:#171717;padding:20px 24px;border-radius:12px;' +
        'border:1px solid rgba(255,255,255,0.1);max-width:340px;text-align:center;' +
        'box-shadow:0 20px 60px rgba(0,0,0,0.5)">' +
        '<div style="font-weight:600;margin-bottom:6px">' + title + '</div>' +
        '<div style="font-size:12px;opacity:0.7">' + subtitle + '</div>' +
        '</div>';
      document.body.appendChild(el);
    };
    mount();
  }

  function scheduleReload(reason) {
    if (reloadTimer) return;
    var history = readReloadHistory();
    if (history.length >= MAX_RELOADS) {
      console.warn("[agent-native] Dev server keeps re-bundling. Manual refresh needed.", reason);
      showOverlay(
        "Dev server out of sync",
        "Auto-reload gave up after " + MAX_RELOADS + " tries. Refresh the page (\\u2318R / Ctrl+R)."
      );
      return;
    }
    console.log("[agent-native] Vite re-bundled deps (" + reason + "), reloading\\u2026");
    recordReload();
    // First reload is silent. One refresh almost always fixes it and the
    // overlay flash is more disruptive than the reload itself. Only show
    // the overlay starting on the second attempt, when something is clearly
    // taking longer than expected.
    if (history.length >= 1) {
      showOverlay("Updating dev server\\u2026", "Reloading the page");
    }
    reloadTimer = setTimeout(function() { window.location.reload(); }, 300);
  }

  function looksLikeViteFailureMessage(message) {
    if (!message) return false;
    return message.indexOf("Failed to fetch dynamically imported module") !== -1
        || message.indexOf("error loading dynamically imported module") !== -1
        || message.indexOf("Importing a module script failed") !== -1
        || message.indexOf("Outdated Optimize Dep") !== -1
        || message.indexOf("Optimize Deps Processing Error") !== -1
        || (message.indexOf("504") !== -1 && (
          message.indexOf(".vite/deps") !== -1 ||
          message.indexOf("/node_modules/.vite/deps/") !== -1
        ));
  }

  function looksLikeViteDep(url) {
    if (!url) return false;
    // Only treat same-origin URLs as Vite deps. Do not reload the page
    // because some third-party CDN script 404'd.
    try {
      var u = new URL(url, window.location.href);
      if (u.origin !== window.location.origin) return false;
    } catch (e) { return false; }
    return url.indexOf("/node_modules/.vite/deps/") !== -1
        || url.indexOf("/@fs/") !== -1
        || url.indexOf("/@id/") !== -1
        || url.indexOf("?v=") !== -1
        || url.indexOf("?import") !== -1
        || /\\.(m?js|ts|tsx|jsx)(\\?|$)/.test(url);
  }

  // 1) <script type="module"> / <link> 504. These fire on the element, not
  //    window, so use capture phase to catch resource load errors.
  window.addEventListener("error", function(e) {
    var t = e.target;
    if (!t || t === window) {
      var message = String(e.message || "");
      if (looksLikeViteFailureMessage(message)) {
        scheduleReload("window error");
      }
      return;
    }
    var tag = t.tagName;
    if (tag !== "SCRIPT" && tag !== "LINK") return;
    var url = t.src || t.href || "";
    if (looksLikeViteDep(url)) {
      var name = url.split("/").pop();
      scheduleReload("script 504: " + name);
    }
  }, true);

  // Vite's documented hook for failed dynamic-import preloads. This mostly
  // targets production chunk skew, but it also fires for some dev optimizer
  // races, so wire it into the same guarded reload path.
  window.addEventListener("vite:preloadError", function(e) {
    var payload = e && e.payload;
    var msg = String((payload && (payload.message || payload)) || "");
    if (!msg || looksLikeViteFailureMessage(msg)) {
      if (e.preventDefault) e.preventDefault();
      scheduleReload("preload error");
    }
  });

  // 2) Dynamic import failures (React Router code splitting, lazy components).
  window.addEventListener("unhandledrejection", function(e) {
    var msg = String((e.reason && (e.reason.message || e.reason)) || "");
    if (looksLikeViteFailureMessage(msg)) {
      scheduleReload("dynamic import");
    }
  });

  // Static module-graph fetch failures for child imports don't always surface
  // as element errors or rejections. Chrome exposes the HTTP status via
  // Resource Timing; when available, use it as a final safety net.
  var seenResources = {};
  function checkResourceEntry(entry) {
    var url = entry && entry.name;
    if (!url || seenResources[url]) return;
    seenResources[url] = true;
    if (!looksLikeViteDep(url)) return;
    if (entry.responseStatus === 504) {
      var name = url.split("/").pop();
      scheduleReload("resource 504: " + name);
    }
  }
  function checkExistingResources() {
    try {
      var entries = performance.getEntriesByType("resource") || [];
      for (var i = 0; i < entries.length; i++) checkResourceEntry(entries[i]);
    } catch (e) {}
  }
  if (window.PerformanceObserver) {
    try {
      var observer = new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) checkResourceEntry(entries[i]);
      });
      observer.observe({ type: "resource", buffered: true });
    } catch (e) {
      setTimeout(checkExistingResources, 0);
    }
  } else {
    setTimeout(checkExistingResources, 0);
  }
})();`;
}

export function shouldInlineViteDevRecoveryScript(): boolean {
  const viteEnv = (
    import.meta as ImportMeta & {
      env?: { DEV?: boolean; PROD?: boolean };
    }
  ).env;
  if (viteEnv?.PROD === true) return false;
  if (viteEnv?.DEV === true) return true;
  if (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV === "production"
  ) {
    return false;
  }
  return true;
}
