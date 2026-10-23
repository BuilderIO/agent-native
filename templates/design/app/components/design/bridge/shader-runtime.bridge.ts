/**
 * Saved GLSL shader runtime for existing fills and shader effects.
 *
 * This script is BOTH:
 *   1. injected into every editor canvas iframe by DesignCanvas.tsx, and
 *   2. embedded into persisted/exported screen HTML (via
 *      `ensureShaderRuntime()` in shared/shader-fills.ts) so standalone
 *      artifacts render their shaders without the editor.
 *
 * It is idempotent — a screen that already embeds the runtime and is then
 * rendered inside the editor (which injects it again) initializes only once.
 *
 * Persisted format it consumes (see shared/shader-fills.ts for the canonical
 * format — keep the parsing here in sync):
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
    type?: string;
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
    domText?: string;
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
    visible: boolean;
  }

  interface AnShadersApi {
    version: number;
    scan: () => void;
  }

  const W = window as unknown as {
    __anShaders?: AnShadersApi;
  } & Window &
    typeof globalThis;

  if (W.__anShaders && W.__anShaders.version >= 1) {
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
  const MAX_MOUNTS = 8;
  const VERT_SRC =
    "attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.0,1.0);}";

  const registry: Record<string, AnShaderDef> = {};
  const mounts: AnShaderMount[] = [];
  let rafId: number | null = null;
  let lastFrameTs: number | null = null;
  let needsRender = false;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  // How large the editor shows this document, from its zoom. Outside the
  // editor nothing sends one, so standalone pages keep full resolution.
  let viewScale = 1;

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
      if (prev && prev.domText === text) continue;
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
  ): AnShaderMount | null {
    const def = registry[defId];
    if (!def || !def.glsl) return null;
    for (let i = 0; i < mounts.length; i++) {
      const existing = mounts[i];
      if (existing.el === el && existing.mode === mode) {
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
    // Zoomed out, render at the on-screen size, but never below one canvas
    // pixel per CSS pixel: presets size grain and halftone dots in canvas
    // pixels, so this keeps them no coarser than a standard display shows.
    const deviceRatio = Math.min(2, W.devicePixelRatio || 1);
    const ratio = Math.max(Math.min(1, deviceRatio), deviceRatio * viewScale);
    const wPx = Math.max(1, Math.round(wCss * ratio));
    const hPx = Math.max(1, Math.round(hCss * ratio));
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

  function frame(ts?: number): void {
    rafId = null;
    // On a board of several screens, Chromium can run each screen's
    // animation-frame callbacks once per screen per display frame, all with
    // the same timestamp. Draw on the first; the rest would repeat its pixels.
    if (typeof ts === "number") {
      if (ts === lastFrameTs) {
        startLoop();
        return;
      }
      lastFrameTs = ts;
    }
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
        );
        if (fillMount) seen.push(fillMount);
      }
      if (effectId && registry[effectId]) {
        const effectMount = ensureMount(
          el,
          effectId,
          "effect",
          parseOverrides(el, EFFECT_VALUES_ATTR),
        );
        if (effectMount) seen.push(effectMount);
      }
    }
    for (let k = mounts.length - 1; k >= 0; k--) {
      const mount = mounts[k];
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

  W.__anShaders = {
    version: 1,
    scan: scan,
  };

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

  // The editor posts its zoom to each screen. Zooming in keeps the
  // document's own resolution; zoom steps round up to eighths so a pinch
  // doesn't reallocate the canvases every frame.
  W.addEventListener("message", function (event: MessageEvent) {
    if (W.parent === W || event.source !== W.parent) return;
    const data = event.data as {
      type?: unknown;
      scaleX?: unknown;
      scaleY?: unknown;
    } | null;
    if (!data || data.type !== "set-editor-chrome-scale") return;
    const scale = Math.max(Number(data.scaleX) || 0, Number(data.scaleY) || 0);
    if (!(scale > 0)) return;
    const next = Math.min(1, Math.ceil(scale * 8) / 8);
    if (next === viewScale) return;
    viewScale = next;
    requestRender();
  });

  try {
    new MutationObserver(function () {
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
