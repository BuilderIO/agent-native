/**
 * Interact links bridge — the only editor script besides the theme bridge that
 * an Interact markup preview carries. Interact runs the design as it would run
 * in a tab, so this listens for one thing: a click on a link the browser would
 * resolve against the editor instead of the design.
 *
 * A prototype lives in a `srcdoc` iframe, whose base URL is the editor's. So a
 * plain `<a href="/pricing">`, and equally a `<a href="#features">`, would load
 * the editor inside the preview. Those clicks are handled here:
 *   - an `<a href>` to a relative path, or any element marked `data-screen`,
 *     is cancelled and reported to the editor, which switches screens when the
 *     path names one and otherwise shows nothing;
 *   - an `<a href="#id">` is cancelled and scrolls its target into view, as the
 *     browser's own fragment jump would in a tab (a missing target does
 *     nothing, and a bare `#` goes to the top);
 *   - everything else is left to the page: external, `mailto:`, `tel:` and
 *     `javascript:` links, links that open a new window or download, modified
 *     clicks (Cmd, Ctrl, Shift, Alt, middle, right), and any click the page
 *     already handled.
 *
 * The listener runs in the bubble phase so the page's own handlers see the
 * click first. It never listens for scrolling, dragging, keys or forms.
 *
 * Protocol (iframe → parent):
 *
 *   { type: 'prototype-navigate', href: string, screen: string }
 *
 * Rules:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 */
(function () {
  if ((window as { __anInteractLinks?: unknown }).__anInteractLinks) return;
  (window as { __anInteractLinks?: unknown }).__anInteractLinks = true;

  // A destination the browser would resolve against the editor: no scheme and
  // not protocol-relative. Anchors (`#...`) are told apart by the caller.
  function isRelative(href: string): boolean {
    return !(/^[a-z][a-z0-9+.-]*:/i.test(href) || /^\/\//.test(href));
  }

  function screenName(path: string): string {
    return path.replace(/^(?:\.{0,2}\/)+/, "").split(/[?#]/)[0] || "";
  }

  function scrollToFragment(fragment: string): void {
    var id = fragment;
    try {
      id = decodeURIComponent(fragment);
    } catch (_err) {
      // coercion-ok: a malformed escape is looked up as the raw text.
      id = fragment;
    }
    var dest = id
      ? document.getElementById(id) || document.getElementsByName(id)[0]
      : null;
    if (dest) {
      dest.scrollIntoView();
    } else if (!id || id.toLowerCase() === "top") {
      window.scrollTo(0, 0);
    }
  }

  document.addEventListener("click", function (e: MouseEvent) {
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    var start = e.target as Element | null;
    if (!start || !start.closest) return;
    var link = start.closest("a[href], [data-screen]");
    if (!link) return;

    var marked = link.getAttribute("data-screen");
    var target = marked ? marked.trim() : "";
    if (!target) {
      if (link.localName !== "a") return;
      var openIn = link.getAttribute("target");
      if (link.hasAttribute("download")) return;
      if (openIn && openIn.toLowerCase() !== "_self") return;
      var href = (link.getAttribute("href") || "").trim();
      if (!href) return;
      if (href.charAt(0) === "#") {
        e.preventDefault();
        scrollToFragment(href.slice(1));
        return;
      }
      if (!isRelative(href)) return;
      target = href;
    }

    e.preventDefault();
    try {
      (window.parent as Window).postMessage(
        {
          type: "prototype-navigate",
          href: target,
          screen: screenName(target),
        },
        "*",
      );
    } catch (_err) {
      // coercion-ok: the editor is gone, so there is no screen to switch to.
      return;
    }
  });
})();
