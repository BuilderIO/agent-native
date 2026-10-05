import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_TOKEN_QUERY_PARAM,
} from "../shared/embed-auth.js";
import { ROUTE_WARMUP_PRELOAD_ATTRIBUTE } from "../shared/route-chunk-recovery-bootstrap.js";

export function getViteDevRecoveryScript(): string {
  const embedModeParam = JSON.stringify(EMBED_MODE_QUERY_PARAM);
  const embedTokenParam = JSON.stringify(EMBED_TOKEN_QUERY_PARAM);

  return `
(function() {
  try {
    var params = new URLSearchParams(window.location.search || "");
    var embedded = params.get(${embedModeParam});
    if (params.has(${embedTokenParam}) || embedded === "1" || embedded === "true") return;
  } catch (e) {}

  var INSTALL_KEY = "__agentNativeViteDevRecoveryInstalled";
  if (window[INSTALL_KEY]) return;
  window[INSTALL_KEY] = true;

  var RELOAD_KEY = "__an_optimize_reload";
  var RELOAD_HISTORY_PARAM = "__an_vite_dev_recovery";
  var routeWarmupAttribute = ${JSON.stringify(ROUTE_WARMUP_PRELOAD_ATTRIBUTE)};
  var MAX_RELOADS = 3;
  var MIN_RELOAD_INTERVAL_MS = 2000;
  var RESET_AFTER_MS = 8000;

  var reloadTimer = null;
  var overlayShown = false;

  // Track recent reloads in sessionStorage. If we reload too many times
  // in a short window, stop and show a manual-refresh message instead of
  // looping forever.
  function readReloadHistory() {
    var cutoff = Date.now() - 30000;
    var history = [];
    try {
      var raw = sessionStorage.getItem(RELOAD_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) {
        history = arr.filter(function(t) {
          return typeof t === "number" && Number.isFinite(t) && t > cutoff;
        });
      }
    } catch (e) {
      // coercion-ok: blocked or corrupt storage falls back to the URL history marker.
    }
    var params = new URLSearchParams(window.location.search || "");
    var encoded = params.get(RELOAD_HISTORY_PARAM);
    if (encoded) {
      encoded.split(".").forEach(function(value) {
        var timestamp = Number.parseInt(value, 36);
        if (Number.isSafeInteger(timestamp) && timestamp > cutoff) {
          history.push(timestamp);
        }
      });
    }
    return history.filter(function(timestamp, index, values) {
      return values.indexOf(timestamp) === index;
    }).sort(function(a, b) { return a - b; });
  }
  function writeReloadHistory(history) {
    var savedInSession = false;
    try {
      sessionStorage.setItem(RELOAD_KEY, JSON.stringify(history));
      savedInSession = true;
    } catch (e) {
      // coercion-ok: blocked storage falls back to the URL history marker.
    }
    try {
      var url = new URL(window.location.href);
      if (history.length) {
        url.searchParams.set(RELOAD_HISTORY_PARAM, history.map(function(timestamp) {
          return timestamp.toString(36);
        }).join("."));
      } else {
        url.searchParams.delete(RELOAD_HISTORY_PARAM);
      }
      window.history.replaceState(
        window.history.state,
        "",
        url.pathname + url.search + url.hash,
      );
      return true;
    } catch (error) {
      console.warn("[agent-native] Could not persist Vite recovery history.", error);
      return savedInSession;
    }
  }
  function recordReload() {
    var history = readReloadHistory();
    history.push(Date.now());
    return writeReloadHistory(history);
  }
  // Reset the counter after a stable period (page didn't fail again).
  setTimeout(function() {
    try { sessionStorage.removeItem(RELOAD_KEY); } catch (e) {}
    writeReloadHistory([]);
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
        "Auto-reload gave up after " + MAX_RELOADS + " tries. Refresh the page (\\u2318R / Ctrl R)."
      );
      return;
    }
    console.log("[agent-native] Vite re-bundled deps (" + reason + "), reloading\\u2026");
    if (!recordReload()) {
      showOverlay(
        "Dev server out of sync",
        "Auto-reload could not track attempts. Refresh the page manually.",
      );
      return;
    }
    // First reload is silent. One refresh almost always fixes it and the
    // overlay flash is more disruptive than the reload itself. Only show
    // the overlay starting on the second attempt, when something is clearly
    // taking longer than expected.
    if (history.length >= 1) {
      showOverlay("Updating dev server\\u2026", "Reloading the page");
    }
    var lastReloadAt = history.length ? history[history.length - 1] : 0;
    var delay = Math.max(
      300,
      MIN_RELOAD_INTERVAL_MS - Math.max(0, Date.now() - lastReloadAt),
    );
    reloadTimer = setTimeout(function() { window.location.reload(); }, delay);
  }

  window.addEventListener("vite:beforeFullReload", function() {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
  });

  function looksLikeViteFailureMessage(message) {
    if (!message) return false;
    var optimizerUrl = message.indexOf("/node_modules/.vite/deps/") !== -1
        || message.indexOf("/@id/") !== -1
        || message.indexOf("/@fs/") !== -1;
    return message.indexOf("Outdated Optimize Dep") !== -1
        || message.indexOf("Optimize Deps Processing Error") !== -1
        || ((message.indexOf("Failed to fetch dynamically imported module") !== -1
          || message.indexOf("error loading dynamically imported module") !== -1
          || message.indexOf("Importing a module script failed") !== -1)
          && optimizerUrl)
        || (message.indexOf("504") !== -1 && (
          message.indexOf(".vite/deps") !== -1 ||
          message.indexOf("/node_modules/.vite/deps/") !== -1
        ));
  }

  // Vite's preload event is already scoped to a failed module preload, so it
  // carries stronger evidence than a generic rejection. Route modules do not
  // live under the optimizer URL prefix, but they still need Vite's bounded
  // recovery before React Router logs and natively reloads the document.
  function looksLikeVitePreloadFailureMessage(message) {
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
    // Generic resource errors are ambiguous for app route modules; only Vite's
    // transformed module URLs are safe evidence of an optimizer failure.
    try {
      var u = new URL(url, window.location.href);
      if (u.origin !== window.location.origin) return false;
    } catch (e) { return false; }
    return url.indexOf("/node_modules/.vite/deps/") !== -1
        || url.indexOf("/@fs/") !== -1
        || url.indexOf("/@id/") !== -1;
  }

  function looksLikeLocalViteModule(url, target) {
    if (!url || !target) return false;
    var hostname = window.location.hostname;
    var localDevHost = hostname === "localhost"
        || hostname.endsWith(".localhost")
        || /^127(?:\\.\\d{1,3}){3}$/.test(hostname)
        || hostname === "::1"
        || hostname === "[::1]";
    if (!localDevHost) return false;
    if (url.indexOf(window.location.origin + "/") !== 0) return false;
    if (target.tagName === "SCRIPT") return String(target.type || "").toLowerCase() === "module";
    return target.tagName === "LINK"
        && !(target.hasAttribute && target.hasAttribute(routeWarmupAttribute))
        && /(?:^|\\s)modulepreload(?:\\s|$)/i.test(target.rel || "");
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
    if (looksLikeViteDep(url) || looksLikeLocalViteModule(url, t)) {
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
    // A preload event without a concrete error is not enough evidence to
    // reload the document. Vite can emit an empty payload while a route
    // preload is being cancelled; treating that cancellation as an optimizer
    // failure strands the app on its SSR loading fallback.
    if (looksLikeVitePreloadFailureMessage(msg)) {
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
  if (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV === "production"
  ) {
    return false;
  }
  if (viteEnv?.PROD === true) return false;
  if (viteEnv?.DEV === true) return true;
  return true;
}
