/**
 * Code-backed GLSL shader runtime — the self-contained engine behind shader
 * fills and shader effects.
 *
 * This script is BOTH:
 *   1. injected into every editor canvas iframe (via
 *      SHADER_FILL_PREVIEW_BRIDGE_SCRIPT in DesignCanvas.tsx), and
 *   2. embedded into persisted/exported screen HTML (via
 *      `ensureShaderRuntime()` in shared/shader-fills.ts) so standalone
 *      artifacts render their shaders without the editor.
 *
 * It is idempotent — a screen that already embeds the runtime and is then
 * rendered inside the editor (which injects it again) initializes only once.
 *
 * Persisted format it consumes (see shared/shader-fills.ts for the canonical
 * spec + serializers — keep the parsing here in sync):
 *
 *   <script type="application/x-agent-native-shader"
 *           data-shader-id="an-shader-x" data-shader-name="Name"
 *           data-shader-mode="fill">
 *   [block comment] an-shader v1
 *   { "uniforms": { "u_speed": { "type": "float", "value": 1, ... } } }
 *   [end block comment]
 *   ...GLSL fragment source...
 *   </script>
 *
 *   (The manifest rides in a leading GLSL block comment opened with slash-
 *   star-bang and the marker "an-shader v1", closed with star-slash; the
 *   literal characters can't appear in this header without ending it.)
 *
 *   <div data-an-shader-fill="an-shader-x"
 *        data-an-shader-uniforms='{"u_speed":2}'>…</div>
 *   <div data-an-shader-effect="an-shader-y">…</div>
 *
 * Fills render to a canvas placed BEHIND the element's content (negative
 * z-index inside an isolated stacking context, above the element's own
 * background so the persisted fallback background stays underneath). Effects
 * render to a pointer-transparent overlay canvas ON TOP of the content.
 *
 * Built-in uniforms provided automatically when declared by the GLSL:
 *   uniform float u_time;       // seconds since load (0 for reduced motion)
 *   uniform vec2  u_resolution; // canvas size in physical pixels
 *
 * Graceful degradation: no WebGL, compile errors, or too many mounts → the
 * canvas is removed and the element keeps its persisted fallback background.
 * The failure reason lands in `data-an-shader-error` for inspectability.
 *
 * Rules:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 */
(function () {
  interface AnUniformDef {
    type?: string; // 'float' | 'vec2' | 'color'
    value?: unknown;
    min?: number;
    max?: number;
    step?: number;
    label?: string;
  }

  interface AnShaderDef {
    name: string;
    mode: "fill" | "effect";
    glsl: string;
    uniforms: Record<string, AnUniformDef>;
    /** Raw script-tag text at last collect, to detect DOM-side updates. */
    domText?: string;
    /** True when updated at runtime (updateShader) and not yet persisted. */
    volatile?: boolean;
  }

  interface AnShaderMount {
    el: HTMLElement;
    canvas: HTMLCanvasElement;
    gl: WebGLRenderingContext;
    program: WebGLProgram;
    locs: Record<string, WebGLUniformLocation | null>;
    defId: string;
    mode: "fill" | "effect";
    values: Record<string, unknown>;
    preview: boolean;
    visible: boolean;
  }

  interface AnShadersApi {
    version: number;
    scan: () => void;
    applyPreview: (
      target: { nodeId?: string; selector?: string },
      def: {
        id?: string;
        name?: string;
        glsl: string;
        uniforms?: Record<string, AnUniformDef>;
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
      patch: { glsl?: string; uniforms?: Record<string, AnUniformDef> },
    ) => void;
  }

  const W = window as unknown as {
    __anShaders?: AnShadersApi;
  } & Window &
    typeof globalThis;

  if (W.__anShaders && W.__anShaders.version >= 1) {
    // Another copy (embedded + injected) already runs — just rescan.
    try {
      W.__anShaders.scan();
    } catch (_err) {
      /* noop */
    }
    return;
  }

  const SCRIPT_TYPE = "application/x-agent-native-shader";
  const FILL_ATTR = "data-an-shader-fill";
  const EFFECT_ATTR = "data-an-shader-effect";
  const VALUES_ATTR = "data-an-shader-uniforms";
  const EFFECT_VALUES_ATTR = "data-an-shader-effect-uniforms";
  const ERROR_ATTR = "data-an-shader-error";
  const CANVAS_ATTR = "data-an-shader-canvas";
  const PREVIEW_DEF_ID = "__an-shader-preview";
  const MAX_MOUNTS = 8;
  const VERT_SRC =
    "attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.0,1.0);}";

  const registry: Record<string, AnShaderDef> = {};
  const mounts: AnShaderMount[] = [];
  let rafId: number | null = null;
  let needsRender = false;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;

  function nowMs(): number {
    return W.performance && W.performance.now
      ? W.performance.now()
      : Date.now();
  }
  const t0 = nowMs();

  let reducedMotion = false;
  try {
    reducedMotion = !!(
      W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
    if (W.matchMedia) {
      const mq = W.matchMedia("(prefers-reduced-motion: reduce)");
      const onChange = function () {
        reducedMotion = mq.matches;
        requestRender();
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
    }
  } catch (_err) {
    /* noop */
  }

  // ── Manifest parsing (keep in sync with shared/shader-fills.ts) ──────────

  function parseBlock(text: string): {
    uniforms: Record<string, AnUniformDef>;
    glsl: string;
  } {
    const m = /^\s*\/\*!\s*an-shader\s+v\d+\s*([\s\S]*?)\*\//.exec(text);
    let uniforms: Record<string, AnUniformDef> = {};
    let glsl = text;
    if (m) {
      glsl = text.slice((m.index || 0) + m[0].length);
      try {
        const meta = JSON.parse(m[1]) as {
          uniforms?: Record<string, AnUniformDef>;
        };
        if (meta && meta.uniforms && typeof meta.uniforms === "object") {
          uniforms = meta.uniforms;
        }
      } catch (_err) {
        /* malformed manifest — treat as no uniforms */
      }
    }
    return { uniforms: uniforms, glsl: glsl.replace(/^[ \t]*\r?\n/, "") };
  }

  function hexToRgb(hex: unknown): [number, number, number] {
    let h = String(hex || "").replace("#", "");
    if (h.length === 3 || h.length === 4) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    const n = parseInt(h.slice(0, 6), 16);
    if (isNaN(n)) return [0.5, 0.5, 0.5];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  // ── Definition collection ─────────────────────────────────────────────────

  function invalidateMountsFor(defId: string): void {
    for (let i = mounts.length - 1; i >= 0; i--) {
      if (mounts[i].defId === defId) unmount(mounts[i]);
    }
  }

  function collectDefs(): void {
    const scripts = document.querySelectorAll(
      'script[type="' + SCRIPT_TYPE + '"]',
    );
    for (let i = 0; i < scripts.length; i++) {
      const s = scripts[i];
      const id = s.getAttribute("data-shader-id");
      if (!id) continue;
      const text = s.textContent || "";
      const prev = registry[id];
      if (prev && prev.domText === text) continue; // unchanged in DOM
      if (prev && prev.volatile && prev.domText === undefined) continue;
      const parsed = parseBlock(text);
      registry[id] = {
        name: s.getAttribute("data-shader-name") || id,
        mode:
          s.getAttribute("data-shader-mode") === "effect" ? "effect" : "fill",
        glsl: parsed.glsl,
        uniforms: parsed.uniforms,
        domText: text,
      };
      if (prev && prev.glsl !== parsed.glsl) invalidateMountsFor(id);
    }
  }

  // ── WebGL plumbing ────────────────────────────────────────────────────────

  function compileProgram(
    gl: WebGLRenderingContext,
    fragSrc: string,
  ): WebGLProgram {
    function sh(type: number, src: string): WebGLShader {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("createShader failed");
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader) || "shader compile failed";
        gl.deleteShader(shader);
        throw new Error(log);
      }
      return shader;
    }
    const vs = sh(gl.VERTEX_SHADER, VERT_SRC);
    const fs = sh(gl.FRAGMENT_SHADER, fragSrc);
    const program = gl.createProgram();
    if (!program) throw new Error("createProgram failed");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "program link failed");
    }
    return program;
  }

  function resolveValues(
    def: AnShaderDef,
    overrides: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k in def.uniforms) {
      if (!Object.prototype.hasOwnProperty.call(def.uniforms, k)) continue;
      out[k] = def.uniforms[k].value;
    }
    if (overrides) {
      for (const k2 in overrides) {
        if (!Object.prototype.hasOwnProperty.call(overrides, k2)) continue;
        if (Object.prototype.hasOwnProperty.call(out, k2)) {
          out[k2] = overrides[k2];
        }
      }
    }
    return out;
  }

  let io: IntersectionObserver | null = null;
  try {
    io = new IntersectionObserver(function (entries) {
      for (let i = 0; i < entries.length; i++) {
        for (let j = 0; j < mounts.length; j++) {
          if (mounts[j].canvas === entries[i].target) {
            mounts[j].visible = entries[i].isIntersecting;
          }
        }
      }
      startLoop();
    });
  } catch (_err) {
    io = null;
  }

  function unmount(mount: AnShaderMount): void {
    const idx = mounts.indexOf(mount);
    if (idx !== -1) mounts.splice(idx, 1);
    try {
      if (io) io.unobserve(mount.canvas);
    } catch (_err) {
      /* noop */
    }
    try {
      const lose = mount.gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    } catch (_err) {
      /* noop */
    }
    if (mount.canvas.parentNode) {
      mount.canvas.parentNode.removeChild(mount.canvas);
    }
  }

  function ensureMount(
    el: HTMLElement,
    defId: string,
    mode: "fill" | "effect",
    overrides: Record<string, unknown> | null | undefined,
    preview: boolean,
  ): AnShaderMount | null {
    const def = registry[defId];
    if (!def || !def.glsl) return null;
    // A fill and an effect may coexist on the same element — mount identity
    // is (element, mode, preview), so replacing a fill never tears down the
    // element's effect and vice versa.
    for (let i = 0; i < mounts.length; i++) {
      const existing = mounts[i];
      if (
        existing.el === el &&
        existing.preview === preview &&
        existing.mode === mode
      ) {
        if (existing.defId === defId) {
          existing.values = resolveValues(def, overrides);
          requestRender();
          return existing;
        }
        unmount(existing);
        break;
      }
    }
    if (mounts.length >= MAX_MOUNTS) {
      el.setAttribute(ERROR_ATTR, "too-many-shaders");
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.setAttribute(CANVAS_ATTR, defId);
    canvas.setAttribute("aria-hidden", "true");
    const cs = canvas.style;
    cs.position = "absolute";
    cs.left = "0";
    cs.top = "0";
    cs.width = "100%";
    cs.height = "100%";
    cs.pointerEvents = "none";
    cs.borderRadius = "inherit";
    cs.display = "block";
    cs.zIndex = mode === "effect" ? "2147483646" : "-1";

    try {
      const computed = W.getComputedStyle(el);
      if (computed && computed.position === "static") {
        el.style.position = "relative";
      }
    } catch (_err) {
      /* noop */
    }
    el.style.isolation = "isolate";
    if (mode === "effect") el.appendChild(canvas);
    else el.insertBefore(canvas, el.firstChild);

    let gl: WebGLRenderingContext | null = null;
    try {
      gl = (canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
      }) ||
        canvas.getContext(
          "experimental-webgl",
        )) as WebGLRenderingContext | null;
    } catch (_err) {
      gl = null;
    }
    if (!gl) {
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      el.setAttribute(ERROR_ATTR, "webgl-unavailable");
      return null;
    }

    let program: WebGLProgram;
    try {
      program = compileProgram(gl, def.glsl);
    } catch (err) {
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      const msg = err instanceof Error ? err.message : String(err);
      el.setAttribute(ERROR_ATTR, msg.slice(0, 200));
      return null;
    }
    el.removeAttribute(ERROR_ATTR);

    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // One oversized triangle covering the viewport — cheaper than a quad.
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const mount: AnShaderMount = {
      el: el,
      canvas: canvas,
      gl: gl,
      program: program,
      locs: {},
      defId: defId,
      mode: mode,
      values: resolveValues(def, overrides),
      preview: preview,
      visible: true,
    };
    mounts.push(mount);
    try {
      if (io) io.observe(canvas);
    } catch (_err) {
      /* noop */
    }
    requestRender();
    return mount;
  }

  function loc(
    mount: AnShaderMount,
    name: string,
  ): WebGLUniformLocation | null {
    if (!(name in mount.locs)) {
      mount.locs[name] = mount.gl.getUniformLocation(mount.program, name);
    }
    return mount.locs[name];
  }

  function drawMount(mount: AnShaderMount, timeSec: number): void {
    const el = mount.el;
    const canvas = mount.canvas;
    const gl = mount.gl;
    if (!el.isConnected) {
      unmount(mount);
      return;
    }
    const rect = el.getBoundingClientRect();
    const wCss = Math.max(1, Math.round(rect.width));
    const hCss = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, W.devicePixelRatio || 1);
    const wPx = Math.max(1, Math.round(wCss * dpr));
    const hPx = Math.max(1, Math.round(hCss * dpr));
    if (canvas.width !== wPx || canvas.height !== hPx) {
      canvas.width = wPx;
      canvas.height = hPx;
      gl.viewport(0, 0, wPx, hPx);
    }
    gl.useProgram(mount.program);
    const def = registry[mount.defId];
    const uniforms = def ? def.uniforms : {};
    const lt = loc(mount, "u_time");
    if (lt) gl.uniform1f(lt, timeSec);
    const lr = loc(mount, "u_resolution");
    if (lr) gl.uniform2f(lr, wPx, hPx);
    for (const name in mount.values) {
      if (!Object.prototype.hasOwnProperty.call(mount.values, name)) continue;
      const u = uniforms[name];
      const l = loc(mount, name);
      if (!l || !u) continue;
      const v = mount.values[name];
      if (u.type === "color") {
        const rgb = hexToRgb(v);
        gl.uniform3f(l, rgb[0], rgb[1], rgb[2]);
      } else if (u.type === "vec2" && Array.isArray(v) && v.length >= 2) {
        gl.uniform2f(l, Number(v[0]) || 0, Number(v[1]) || 0);
      } else {
        gl.uniform1f(l, Number(v) || 0);
      }
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(): void {
    rafId = null;
    const t = (nowMs() - t0) / 1000;
    const animate = !reducedMotion && !document.hidden;
    for (let i = mounts.length - 1; i >= 0; i--) {
      const mount = mounts[i];
      if (!mount.el.isConnected) {
        unmount(mount);
        continue;
      }
      if (mount.visible === false && !needsRender) continue;
      drawMount(mount, reducedMotion ? 0 : t);
    }
    needsRender = false;
    if (animate && mounts.length > 0) startLoop();
  }

  function startLoop(): void {
    if (rafId !== null) return;
    if (mounts.length === 0) return;
    if (W.requestAnimationFrame) {
      rafId = W.requestAnimationFrame(frame);
    } else {
      rafId = setTimeout(frame, 66) as unknown as number;
    }
  }

  function requestRender(): void {
    needsRender = true;
    startLoop();
  }

  // ── Scanning ──────────────────────────────────────────────────────────────

  function parseOverrides(
    el: HTMLElement,
    attr: string,
  ): Record<string, unknown> | null {
    const raw = el.getAttribute(attr);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_err) {
      return null;
    }
  }

  function scan(): void {
    collectDefs();
    const els = document.querySelectorAll(
      "[" + FILL_ATTR + "],[" + EFFECT_ATTR + "]",
    );
    const seen: AnShaderMount[] = [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i] as HTMLElement;
      const fillId = el.getAttribute(FILL_ATTR);
      const effectId = el.getAttribute(EFFECT_ATTR);
      if (fillId && registry[fillId]) {
        const fillMount = ensureMount(
          el,
          fillId,
          "fill",
          parseOverrides(el, VALUES_ATTR),
          false,
        );
        if (fillMount) seen.push(fillMount);
      }
      if (effectId && registry[effectId]) {
        const effectMount = ensureMount(
          el,
          effectId,
          "effect",
          parseOverrides(el, EFFECT_VALUES_ATTR),
          false,
        );
        if (effectMount) seen.push(effectMount);
      }
    }
    for (let k = mounts.length - 1; k >= 0; k--) {
      const mount = mounts[k];
      if (mount.preview) continue;
      if (seen.indexOf(mount) === -1) unmount(mount);
    }
    startLoop();
  }

  function scheduleScan(): void {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(function () {
      scanTimer = null;
      scan();
    }, 100);
  }

  // ── Public API (used by the shader-fill-preview bridge + inspector) ──────

  function resolveTarget(target: {
    nodeId?: string;
    selector?: string;
  }): HTMLElement | null {
    if (target && target.selector) {
      try {
        const hit = document.querySelector(target.selector);
        if (hit) return hit as HTMLElement;
      } catch (_err) {
        /* invalid selector */
      }
    }
    if (target && target.nodeId) {
      const byId = document.querySelector(
        '[data-agent-native-node-id="' +
          String(target.nodeId).replace(/"/g, '\\"') +
          '"]',
      );
      if (byId) return byId as HTMLElement;
    }
    return null;
  }

  function applyPreview(
    target: { nodeId?: string; selector?: string },
    def: {
      id?: string;
      name?: string;
      glsl: string;
      uniforms?: Record<string, AnUniformDef>;
      values?: Record<string, unknown>;
    },
    mode?: string,
  ): boolean {
    clearPreview();
    const el = resolveTarget(target || {});
    // No body fallback: in a multi-screen editor every screen iframe receives
    // the same message — only the one containing the target should mount.
    if (!el || !def || typeof def.glsl !== "string") return false;
    const resolvedMode: "fill" | "effect" =
      mode === "effect" ? "effect" : "fill";
    registry[PREVIEW_DEF_ID] = {
      name: (def.name || "Preview") + "",
      mode: resolvedMode,
      glsl: def.glsl,
      uniforms: def.uniforms || {},
      volatile: true,
    };
    const mount = ensureMount(
      el,
      PREVIEW_DEF_ID,
      resolvedMode,
      def.values || null,
      true,
    );
    return !!mount;
  }

  function clearPreview(): void {
    for (let i = mounts.length - 1; i >= 0; i--) {
      if (mounts[i].preview) unmount(mounts[i]);
    }
    delete registry[PREVIEW_DEF_ID];
  }

  function setUniform(
    filter: { shaderId?: string; nodeId?: string; preview?: boolean },
    name: string,
    value: unknown,
  ): void {
    const f = filter || {};
    for (let i = 0; i < mounts.length; i++) {
      const mount = mounts[i];
      if (f.preview !== undefined && mount.preview !== !!f.preview) continue;
      if (f.shaderId && mount.defId !== f.shaderId) continue;
      if (f.nodeId) {
        const nid = mount.el.getAttribute("data-agent-native-node-id");
        if (nid !== f.nodeId) continue;
      }
      mount.values[name] = value;
    }
    requestRender();
  }

  function updateShader(
    id: string,
    patch: { glsl?: string; uniforms?: Record<string, AnUniformDef> },
  ): void {
    const def = registry[id];
    if (!def || !patch) return;
    let recompile = false;
    if (typeof patch.glsl === "string" && patch.glsl !== def.glsl) {
      def.glsl = patch.glsl;
      recompile = true;
    }
    if (patch.uniforms && typeof patch.uniforms === "object") {
      def.uniforms = patch.uniforms;
    }
    def.volatile = true;
    if (recompile) invalidateMountsFor(id);
    scan();
    requestRender();
  }

  W.__anShaders = {
    version: 1,
    scan: scan,
    applyPreview: applyPreview,
    clearPreview: clearPreview,
    setUniform: setUniform,
    updateShader: updateShader,
  };

  // ── Boot ──────────────────────────────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      scan();
    });
  } else {
    scan();
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) requestRender();
  });

  try {
    new MutationObserver(function () {
      // Debounced; scan() is idempotent so canvas-insert echoes converge.
      scheduleScan();
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        FILL_ATTR,
        EFFECT_ATTR,
        VALUES_ATTR,
        EFFECT_VALUES_ATTR,
      ],
    });
  } catch (_err) {
    /* noop */
  }
})();
