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
 * GLSL protocol (delegates to the code-backed shader runtime injected right
 * before this bridge — see shader-runtime.bridge.ts / window.__anShaders; all
 * of these no-op harmlessly when the runtime is unavailable):
 *
 *   { type: 'glsl-shader-preview', target: { selector?, nodeId? },
 *     shader: { id?, name?, glsl, uniforms? }, values?, mode: 'fill'|'effect' }
 *     Mount a live WebGL preview of the shader on the target element without
 *     persisting anything. Only the iframe that actually contains the target
 *     mounts it (no body fallback), so the parent can safely broadcast to
 *     every screen iframe.
 *
 *   { type: 'glsl-shader-set-uniform', filter: { shaderId?, nodeId?, preview? },
 *     name, value }
 *     Live-update one uniform on matching mounts (knob scrubbing).
 *
 *   { type: 'glsl-shader-update', id, glsl?, uniforms? }
 *     Hot-swap a registered shader's source/manifest (Edit-code live preview).
 *
 *   { type: 'glsl-shader-preview-clear' }   — unmount preview mounts.
 *   { type: 'glsl-shader-rescan' }          — re-scan persisted annotations.
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

  /**
   * The code-backed GLSL runtime (shader-runtime.bridge.ts) registers itself
   * as window.__anShaders. It is injected immediately before this bridge in
   * the editor, and embedded directly in persisted screen HTML. Everything
   * here degrades to a no-op when it is missing.
   */
  interface AnShadersGlobal {
    version: number;
    scan: () => void;
    applyPreview: (
      target: { nodeId?: string; selector?: string },
      def: {
        id?: string;
        name?: string;
        glsl: string;
        uniforms?: Record<string, unknown>;
        values?: Record<string, unknown>;
      },
      mode?: string,
    ) => boolean;
    clearPreview: () => void;
    setUniform: (
      filter: { shaderId?: string; nodeId?: string; preview?: boolean },
      name: string,
      value: unknown,
    ) => void;
    updateShader: (
      id: string,
      patch: { glsl?: string; uniforms?: Record<string, unknown> },
    ) => void;
  }

  function runtime(): AnShadersGlobal | null {
    var api = (window as unknown as { __anShaders?: AnShadersGlobal })
      .__anShaders;
    return api && api.version >= 1 ? api : null;
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
    if (e.data.type === "glsl-shader-preview") {
      var api = runtime();
      if (!api) return;
      var target =
        e.data.target && typeof e.data.target === "object" ? e.data.target : {};
      var shader =
        e.data.shader && typeof e.data.shader === "object"
          ? e.data.shader
          : null;
      if (!shader || typeof shader.glsl !== "string") return;
      api.applyPreview(
        { nodeId: target.nodeId, selector: target.selector },
        {
          id: shader.id,
          name: shader.name,
          glsl: shader.glsl,
          uniforms: shader.uniforms,
          values:
            e.data.values && typeof e.data.values === "object"
              ? e.data.values
              : undefined,
        },
        e.data.mode === "effect" ? "effect" : "fill",
      );
      return;
    }
    if (e.data.type === "glsl-shader-set-uniform") {
      var api2 = runtime();
      if (!api2) return;
      if (typeof e.data.name !== "string") return;
      api2.setUniform(
        e.data.filter && typeof e.data.filter === "object" ? e.data.filter : {},
        e.data.name,
        e.data.value,
      );
      return;
    }
    if (e.data.type === "glsl-shader-update") {
      var api3 = runtime();
      if (!api3) return;
      if (typeof e.data.id !== "string") return;
      api3.updateShader(e.data.id, {
        glsl: typeof e.data.glsl === "string" ? e.data.glsl : undefined,
        uniforms:
          e.data.uniforms && typeof e.data.uniforms === "object"
            ? e.data.uniforms
            : undefined,
      });
      return;
    }
    if (e.data.type === "glsl-shader-preview-clear") {
      var api4 = runtime();
      if (api4) api4.clearPreview();
      return;
    }
    if (e.data.type === "glsl-shader-rescan") {
      var api5 = runtime();
      if (api5) api5.scan();
      return;
    }
  });
})();
