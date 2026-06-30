/**
 * Navigation bridge — injected into every canvas iframe.
 *
 * ALWAYS injected. A prototype lives in a `srcdoc` iframe, so a plain
 * `<a href="/pricing">` resolves the relative URL against the PARENT app
 * document and navigates the iframe to the Design app itself ("Design not
 * found"), nuking the prototype. We intercept link clicks + relative form
 * submits and route them to the parent instead:
 *   - in-page anchors (`#...`) and `javascript:`/`@click` handlers: left alone
 *   - external `http(s)`/`//` links: opened in a new tab by the parent
 *   - internal/relative links (or an explicit `data-screen`): asked to switch
 *     to the matching screen in a multi-screen design; otherwise a no-op so the
 *     prototype never blows itself away.
 *
 * Protocol (iframe → parent):
 *
 *   { type: 'prototype-navigate', href: string, screen: string }
 *     Sent when the user clicks an internal link or a `data-screen` element.
 *
 * Rules:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 */
(function () {
  function classify(
    href: string,
  ): { external: boolean; href: string; screen?: string } | null {
    var h = (href || "").trim();
    if (!h) return null;
    var lower = h.toLowerCase();
    if (lower.charAt(0) === "#") return null;
    if (lower.indexOf("javascript:") === 0) return null;
    if (lower.indexOf("mailto:") === 0 || lower.indexOf("tel:") === 0) {
      return { external: true, href: h };
    }
    if (/^https?:\/\//i.test(h) || /^\/\//.test(h)) {
      return { external: true, href: h };
    }
    var screen = h.replace(/^\.?\//, "").split(/[?#]/)[0];
    return { external: false, href: h, screen: screen };
  }
  document.addEventListener(
    "click",
    function (e: MouseEvent) {
      var t = e.target as Element | null;
      if (!t || !t.closest) return;
      var a = t.closest("a[href], [data-screen]") as HTMLElement | null;
      if (!a) return;
      var ds = a.getAttribute && a.getAttribute("data-screen");
      // In-page anchors ('#...') and empty hrefs must be handled in-document.
      // A srcdoc document resolves '#'/'' against the PARENT app URL, so the
      // browser's default action would navigate the iframe to the app itself.
      if (!ds) {
        var rawHref = a.getAttribute("href");
        if (rawHref != null) {
          var hh = rawHref.trim();
          if (hh === "" || hh.charAt(0) === "#") {
            e.preventDefault();
            var fid = hh.charAt(0) === "#" ? hh.slice(1) : "";
            var tgt = fid ? document.getElementById(fid) : null;
            if (tgt && tgt.scrollIntoView) {
              tgt.scrollIntoView({ behavior: "smooth", block: "start" });
            } else {
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
            return;
          }
        }
      }
      var info = ds
        ? {
            external: false,
            href: ds,
            screen: ds.replace(/^\.?\//, "").split(/[?#]/)[0],
          }
        : classify(a.getAttribute("href") || "");
      if (!info) return;
      if (info.external) {
        // Open external links in a new tab from the iframe itself (the sandbox
        // grants allow-popups), bound to this real user click. We deliberately
        // do NOT round-trip through the parent: a parent window.open() driven
        // by postMessage would let any script in here spawn popups without a
        // gesture.
        try {
          a.setAttribute("target", "_blank");
          a.setAttribute("rel", "noopener noreferrer");
        } catch (_err) {}
        return; // allow the native click to proceed
      }
      e.preventDefault();
      try {
        (window.parent as Window).postMessage(
          {
            type: "prototype-navigate",
            href: info.href,
            screen: info.screen || "",
          },
          "*",
        );
      } catch (_err) {}
    },
    true,
  );
  document.addEventListener(
    "submit",
    function (e: SubmitEvent) {
      var f = e.target as HTMLFormElement | null;
      if (!f || f.tagName !== "FORM") return;
      var action = f.getAttribute("action") || "";
      if (/^https?:\/\//i.test(action)) return;
      e.preventDefault();
    },
    true,
  );
})();
