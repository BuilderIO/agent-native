/**
 * Shader-fill preview bridge — injected into every canvas iframe.
 *
 * Allows the parent to apply a CSS gradient approximation of a shader fill to
 * the currently-selected element WITHOUT persisting anything.
 *
 * Protocol (parent → iframe):
 *
 *   { type: 'shader-fill-preview', selector, nodeId, css }
 *     Apply `css` as the `background` inline style on the first element that
 *     matches `selector` (preferred) or `[data-agent-native-node-id="nodeId"]`.
 *     When both are absent, targets `document.body`. Stores the previous
 *     background value so it can be restored on clear.
 *     Preview-only — never writes to DB, Yjs, or source files.
 *
 *   { type: 'shader-fill-preview-clear' }
 *     Remove the applied background override and restore the previous value.
 *     Called when the user discards the preview or switches selections.
 *
 * Rules:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 */
(function () {
  // Track the element we patched and its original background so we can undo.
  var patchedEl: HTMLElement | null = null;
  var originalBackground = "";

  function resolveTarget(selector: string, nodeId: string): HTMLElement | null {
    if (selector) {
      try {
        var hit = document.querySelector(selector) as HTMLElement | null;
        if (hit) return hit;
      } catch (_err) {}
    }
    if (nodeId) {
      var byId = document.querySelector(
        '[data-agent-native-node-id="' + nodeId.replace(/"/g, '\\"') + '"]',
      ) as HTMLElement | null;
      if (byId) return byId;
    }
    return document.body;
  }

  function applyPreview(selector: string, nodeId: string, css: string): void {
    // Clear any prior patch first so we don't stack patches.
    clearPreview();
    var el = resolveTarget(selector, nodeId);
    if (!el) return;
    originalBackground = el.style.background || "";
    el.style.background = css || "";
    patchedEl = el;
  }

  function clearPreview(): void {
    if (!patchedEl) return;
    patchedEl.style.background = originalBackground;
    patchedEl = null;
    originalBackground = "";
  }

  window.addEventListener("message", function (e: MessageEvent) {
    if (e.source !== window.parent) return;
    if (!e.data || typeof e.data.type !== "string") return;
    if (e.data.type === "shader-fill-preview") {
      var selector = typeof e.data.selector === "string" ? e.data.selector : "";
      var nodeId = typeof e.data.nodeId === "string" ? e.data.nodeId : "";
      var css = typeof e.data.css === "string" ? e.data.css : "";
      applyPreview(selector, nodeId, css);
      return;
    }
    if (e.data.type === "shader-fill-preview-clear") {
      clearPreview();
      return;
    }
  });
})();
