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
 *     background value so it can be restored on clear. `css` is run through
 *     isSafeBackgroundStyleValue() below (a minimal duplicate of
 *     isSafeStyleValue() in shared/code-layer.ts) before it ever touches
 *     el.style.background — unsafe values are dropped silently (no style
 *     write) and a `shader-fill-preview-rejected` message is posted back.
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
 *     every screen iframe. `shader.glsl`/`shader.uniforms` are run through
 *     validatePreviewShaderDef() below — a minimal duplicate of the
 *     structural checks validateShaderDef()/validateGlslSource()/
 *     validateUniformManifest() apply on the persist path in
 *     shared/shader-fills.ts — before ever reaching the WebGL compiler; a
 *     rejected shader posts `glsl-shader-preview-rejected` with the reasons
 *     instead of compiling. Also enforces a local MAX_PREVIEW_MOUNTS (8) cap
 *     — every accepted preview request increments a counter that only resets
 *     on `glsl-shader-preview-clear` — matching the runtime's own MAX_MOUNTS,
 *     independent of the runtime's internal bookkeeping.
 *
 *   { type: 'glsl-shader-set-uniform', filter: { shaderId?, nodeId?, preview? },
 *     name, value }
 *     Live-update one uniform on matching mounts (knob scrubbing).
 *
 *   { type: 'glsl-shader-update', id, glsl?, uniforms? }
 *     Hot-swap a registered shader's source/manifest (Edit-code live preview).
 *     Same structural validation as glsl-shader-preview runs before the
 *     hot-swap is forwarded to the runtime.
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

  /**
   * Minimal inline equivalent of isSafeStyleValue() in shared/code-layer.ts
   * (the sanitizer the persist path runs style edits through), scoped to the
   * one property this bridge ever writes: the `background` shorthand. Bridge
   * files cannot import shared modules (see bridge.guard.spec.ts's no-import
   * guard), so this duplicates the source-of-truth's rules instead of
   * reusing them — keep in sync with isSafeStyleValue() in
   * shared/code-layer.ts:
   *   - reject empty values
   *   - reject expression(...) and javascript: breakouts
   *   - reject url(...) (only the background-image longhand is ever allowed
   *     a url() reference on the persist path; the background shorthand
   *     this bridge writes stays on the strict no-url path)
   *   - reject raw <>{}; breakout characters
   */
  function isSafeBackgroundStyleValue(value: string): boolean {
    if (typeof value !== "string") return false;
    var trimmed = value.trim();
    if (!trimmed) return false;
    if (/expression\s*\(/i.test(trimmed)) return false;
    if (/javascript\s*:/i.test(trimmed)) return false;
    if (/url\s*\(/i.test(trimmed)) return false;
    if (/[<>{};]/.test(trimmed)) return false;
    return true;
  }

  function applyPreview(selector: string, nodeId: string, css: string): void {
    // Clear any prior patch first so we don't stack patches.
    clearPreview();
    if (css && !isSafeBackgroundStyleValue(css)) {
      // Reject silently (no style write) + tell the parent why.
      try {
        window.parent.postMessage(
          { type: "shader-fill-preview-rejected", reason: "unsafe-css-value" },
          "*",
        );
      } catch (_err) {}
      return;
    }
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
   * Minimal inline duplicate of the STRUCTURAL (string-level) checks
   * validateGlslSource() / validateUniformManifest() / validateShaderDef()
   * apply on the persist path in shared/shader-fills.ts, run here before any
   * preview/live-edit GLSL reaches the WebGL compiler. Bridge files cannot
   * import shared modules (see bridge.guard.spec.ts's no-import guard), so
   * this duplicates the source-of-truth's rules instead of reusing them —
   * keep in sync with shared/shader-fills.ts. Deliberately a SUBSET: it skips
   * the cross-check that every manifest uniform is declared in the GLSL with
   * the matching type (a knob-completeness nicety, not a GPU-hang/injection
   * risk), since previews render even with unused/partial knobs.
   *
   * Script-tag handling also intentionally differs from a naive "reject both
   * tags" rule, to stay in sync with shader script breakout hardening in
   * shared/shader-fills.ts: an opening `<script` tag is a real injection
   * vector (starts a brand new, arbitrary script), so it stays a hard
   * rejection here too. A bare closing `</script` — e.g. inside a GLSL line
   * comment — is NOT rejected here or on the persist path: escaping
   * (escapeShaderScriptBreakout) happens only at persist-time serialization
   * (serializeShaderScriptBlock), not here on the preview path, since preview
   * GLSL never gets embedded in a `<script>` block in the first place.
   */
  var MAX_GLSL_LENGTH = 20000;
  var UNIFORM_NAME_RE = /^u_[A-Za-z0-9_]{1,48}$/;
  var SHADER_BUILTIN_UNIFORMS = ["u_time", "u_resolution"];

  function validatePreviewGlslSource(glsl: unknown): string[] {
    var errors: string[] = [];
    if (typeof glsl !== "string" || glsl.trim().length === 0) {
      return ["GLSL source is empty"];
    }
    if (glsl.length > MAX_GLSL_LENGTH) {
      errors.push(
        "GLSL source is " + glsl.length + " chars — max is " + MAX_GLSL_LENGTH,
      );
    }
    if (!/void\s+main\s*\(/.test(glsl)) {
      errors.push("GLSL source must define void main()");
    }
    if (!/gl_FragColor/.test(glsl)) {
      errors.push("GLSL source must write gl_FragColor");
    }
    if (/<script/i.test(glsl)) {
      errors.push("GLSL source must not contain an opening script tag");
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(glsl)) {
      errors.push("GLSL source contains control characters");
    }
    return errors;
  }

  function validatePreviewUniformManifest(uniforms: unknown): string[] {
    var errors: string[] = [];
    if (uniforms === undefined || uniforms === null) return errors;
    if (typeof uniforms !== "object") {
      return ["uniforms manifest must be an object"];
    }
    var manifest = uniforms as Record<string, unknown>;
    var names = Object.keys(manifest);
    if (names.length > 16) {
      errors.push("too many uniforms (" + names.length + ") — max is 16");
    }
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var def = manifest[name] as
        | { type?: unknown; value?: unknown; min?: unknown; max?: unknown }
        | undefined;
      if (!UNIFORM_NAME_RE.test(name)) {
        errors.push(
          'uniform "' + name + '" must match u_[A-Za-z0-9_]+ (max 50 chars)',
        );
        continue;
      }
      if (SHADER_BUILTIN_UNIFORMS.indexOf(name) !== -1) {
        errors.push(
          'uniform "' + name + '" is a built-in provided by the runtime',
        );
        continue;
      }
      if (!def || typeof def !== "object") {
        errors.push('uniform "' + name + '" definition must be an object');
        continue;
      }
      if (def.type === "float") {
        if (typeof def.value !== "number" || !isFinite(def.value as number)) {
          errors.push('uniform "' + name + '" value must be a finite number');
        }
      } else if (def.type === "vec2") {
        var v = def.value;
        if (
          !Array.isArray(v) ||
          v.length !== 2 ||
          typeof v[0] !== "number" ||
          typeof v[1] !== "number" ||
          !isFinite(v[0]) ||
          !isFinite(v[1])
        ) {
          errors.push(
            'uniform "' + name + '" value must be [x, y] finite numbers',
          );
        }
      } else if (def.type === "color") {
        if (
          typeof def.value !== "string" ||
          !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(def.value)
        ) {
          errors.push(
            'uniform "' + name + '" value must be a hex color like "#1a2b3c"',
          );
        }
      } else {
        errors.push(
          'uniform "' + name + '" has unknown type — use float, vec2, or color',
        );
      }
    }
    return errors;
  }

  /**
   * Full structural validation for a preview/live-edit shader def. Returns an
   * empty array when valid. Mirrors validateShaderDef()'s string-level checks
   * (see the comment above) without the GLSL↔manifest type cross-check.
   */
  function validatePreviewShaderDef(shader: {
    id?: unknown;
    name?: unknown;
    glsl?: unknown;
    uniforms?: unknown;
  }): string[] {
    var errors = validatePreviewGlslSource(shader.glsl);
    errors = errors.concat(validatePreviewUniformManifest(shader.uniforms));
    if (shader.name !== undefined) {
      if (typeof shader.name !== "string" || shader.name.length > 80) {
        errors.push("shader name must be a string ≤ 80 chars");
      } else if (
        shader.name.indexOf("*/") !== -1 ||
        /<\/?script/i.test(shader.name)
      ) {
        errors.push("shader name contains forbidden sequences");
      }
    }
    return errors;
  }

  function postShaderRejected(errors: string[]): void {
    try {
      window.parent.postMessage(
        { type: "glsl-shader-preview-rejected", errors: errors },
        "*",
      );
    } catch (_err) {}
  }

  // Local preview-mount bookkeeping — enforces the same cap the runtime uses
  // (MAX_MOUNTS = 8 in shader-runtime.bridge.ts) independent of the
  // runtime's own internal `mounts` array, which this bridge has no access
  // to (no imports). Today's single-target glsl-shader-preview protocol only
  // ever needs ONE live preview mount at a time (the runtime's own
  // applyPreview() tears down any prior preview mount before creating a new
  // one), so this counter is deliberately conservative: it counts every
  // ACCEPTED preview request since the last explicit clear rather than
  // trusting that every caller pairs each preview with one, so a
  // hostile/misbehaving parent that fires many previews without ever
  // clearing still gets capped at MAX_PREVIEW_MOUNTS instead of unbounded
  // WebGL context churn.
  var MAX_PREVIEW_MOUNTS = 8;
  var acceptedPreviewCountSinceClear = 0;

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
      // Reject a hostile/broken shader BEFORE it ever reaches the WebGL
      // compiler (GPU-hang risk from arbitrary postMessage GLSL) — same
      // structural checks the persist path runs via validateShaderDef().
      var validationErrors = validatePreviewShaderDef(shader);
      if (validationErrors.length > 0) {
        postShaderRejected(validationErrors);
        return;
      }
      // Enforce the same mount cap the runtime uses (8), independent of the
      // runtime's own bookkeeping — see acceptedPreviewCountSinceClear above.
      if (acceptedPreviewCountSinceClear >= MAX_PREVIEW_MOUNTS) {
        postShaderRejected([
          "too many active shader previews — max is " + MAX_PREVIEW_MOUNTS,
        ]);
        return;
      }
      acceptedPreviewCountSinceClear += 1;
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
      // Same structural validation as glsl-shader-preview before hot-swapping
      // a registered shader's live GLSL/manifest — glsl-shader-update allows
      // a partial patch (e.g. uniforms-only), so only validate whichever
      // parts are actually present in this message.
      var updateErrors: string[] = [];
      if (typeof e.data.glsl === "string") {
        updateErrors = updateErrors.concat(
          validatePreviewGlslSource(e.data.glsl),
        );
      }
      updateErrors = updateErrors.concat(
        validatePreviewUniformManifest(e.data.uniforms),
      );
      if (updateErrors.length > 0) {
        postShaderRejected(updateErrors);
        return;
      }
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
      acceptedPreviewCountSinceClear = 0;
      return;
    }
    if (e.data.type === "glsl-shader-rescan") {
      var api5 = runtime();
      if (api5) api5.scan();
      return;
    }
  });
})();
