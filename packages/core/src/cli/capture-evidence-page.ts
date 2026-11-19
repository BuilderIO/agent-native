// Plain JS strings: Playwright serializes page functions with toString(), and a
// bundler's injected helpers (e.g. __name) would not exist in the page.

/** Installed before any page script. Records GPU, animation-frame and worker facts. */
export const EVIDENCE_INIT_SCRIPT = String.raw`
(() => {
  if (window.__anEvidence) return;
  const MAX_UNIFORMS = 64, MAX_VALUES = 32, MAX_CANVASES = 8;
  const ev = (window.__anEvidence = {
    contexts: [], failedContexts: [], rafTicks: 0,
    webgpuRequests: 0, offscreenCanvases: 0, workers: 0,
    offscreenSet: new WeakSet(), drawsTotal: 0,
  });
  const clip = (v, n) => String(v).slice(0, n);
  const GL_KINDS = ["webgl", "webgl2", "experimental-webgl"];

  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => origRaf((t) => { ev.rafTicks++; return cb(t); });

  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const ctx = origGetContext.call(this, kind, ...rest);
    if (GL_KINDS.includes(kind)) {
      if (ctx) {
        if (!ev.contexts.some((c) => c.gl === ctx) && ev.contexts.length < MAX_CANVASES) {
          ev.contexts.push({ canvas: this, gl: ctx, kind: String(kind), draws: 0, lastDrawAt: 0,
            programs: 0, uniforms: new Map(), locations: new WeakMap(), shaders: [] });
        }
      } else if (ev.failedContexts.length < MAX_CANVASES) {
        ev.failedContexts.push({ canvas: this, kind: String(kind) });
      }
    }
    return ctx;
  };

  const origOffscreen = HTMLCanvasElement.prototype.transferControlToOffscreen;
  if (origOffscreen) {
    HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
      ev.offscreenCanvases++;
      ev.offscreenSet.add(this);
      return origOffscreen.call(this);
    };
  }

  const OrigWorker = window.Worker;
  if (OrigWorker) {
    window.Worker = new Proxy(OrigWorker, {
      construct(target, args) { ev.workers++; return Reflect.construct(target, args); },
    });
  }

  if (navigator.gpu && navigator.gpu.requestAdapter) {
    const orig = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = (...a) => { ev.webgpuRequests++; return orig(...a); };
  }

  const entryFor = (gl) => ev.contexts.find((c) => c.gl === gl);
  const toValues = (arr) => Array.from(arr).slice(0, MAX_VALUES).map((n) => (typeof n === "number" && isFinite(n) ? n : null));
  const sameValues = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  const UNIFORM_METHODS = [
    "uniform1f", "uniform2f", "uniform3f", "uniform4f", "uniform1i", "uniform2i", "uniform3i", "uniform4i",
    "uniform1fv", "uniform2fv", "uniform3fv", "uniform4fv", "uniform1iv", "uniform2iv", "uniform3iv", "uniform4iv",
    "uniformMatrix2fv", "uniformMatrix3fv", "uniformMatrix4fv",
    "uniform1ui", "uniform2ui", "uniform3ui", "uniform4ui", "uniform1uiv", "uniform2uiv", "uniform3uiv", "uniform4uiv",
  ];
  const DRAW_METHODS = ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "drawRangeElements"];

  const patch = (proto) => {
    if (!proto) return;
    const wrap = (name, make) => {
      const orig = proto[name];
      if (typeof orig !== "function") return;
      proto[name] = make(orig);
    };
    wrap("createProgram", (orig) => function (...a) {
      const e = entryFor(this); if (e) e.programs++; return orig.apply(this, a);
    });
    wrap("shaderSource", (orig) => function (shader, source) {
      const e = entryFor(this);
      if (e && e.shaders.length < 16) e.shaders.push({ length: String(source).length });
      return orig.call(this, shader, source);
    });
    wrap("getUniformLocation", (orig) => function (program, name) {
      const loc = orig.call(this, program, name);
      const e = entryFor(this);
      if (e && loc) e.locations.set(loc, clip(name, 96));
      return loc;
    });
    for (const method of UNIFORM_METHODS) {
      wrap(method, (orig) => function (loc, ...rest) {
        const e = entryFor(this);
        const name = e && loc ? e.locations.get(loc) : undefined;
        if (e && name !== undefined && (e.uniforms.has(name) || e.uniforms.size < MAX_UNIFORMS)) {
          const raw = method.endsWith("v")
            ? (method.startsWith("uniformMatrix") ? rest[1] : rest[0])
            : rest;
          const values = raw && typeof raw.length === "number" ? toValues(raw) : [];
          const prev = e.uniforms.get(name);
          e.uniforms.set(name, {
            type: method, values,
            updates: (prev ? prev.updates : 0) + 1,
            changes: (prev ? prev.changes : 0) + (prev && !sameValues(prev.values, values) ? 1 : 0),
          });
        }
        return orig.call(this, loc, ...rest);
      });
    }
    for (const method of DRAW_METHODS) {
      wrap(method, (orig) => function (...a) {
        const e = entryFor(this);
        if (e) { e.draws++; e.lastDrawAt = performance.now(); ev.drawsTotal++; }
        return orig.apply(this, a);
      });
    }
  };
  patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);

  const STYLE_PROPS = ["display", "position", "transform", "transformOrigin", "opacity", "filter", "mixBlendMode",
    "backgroundImage", "backgroundColor", "color", "zIndex", "overflow", "clipPath", "willChange",
    "animationName", "animationDuration", "animationTimingFunction", "animationDelay", "animationIterationCount",
    "animationDirection", "animationFillMode", "animationPlayState", "transitionProperty", "transitionDuration",
    "pointerEvents", "maskImage", "perspective"];
  const SKIP_VALUES = new Set(["none", "normal", "auto", "0s", "visible", "static", "0px", "all", ""]);

  const styleSubset = (el, full) => {
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of STYLE_PROPS) {
      const v = cs[p];
      if (full || !SKIP_VALUES.has(v)) out[p] = clip(v, 200);
    }
    if (full) {
      const custom = {};
      let n = 0;
      for (let i = 0; i < cs.length && n < 40; i++) {
        const prop = cs[i];
        if (prop.startsWith("--")) { custom[prop] = clip(cs.getPropertyValue(prop), 120); n++; }
      }
      if (n) out.customProperties = custom;
    }
    return out;
  };
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: +(r.x + scrollX).toFixed(2), y: +(r.y + scrollY).toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) };
  };
  const describe = (el, full) => ({
    tag: el.tagName.toLowerCase(),
    id: el.id ? clip(el.id, 80) : undefined,
    classes: Array.from(el.classList).slice(0, 12).map((c) => clip(c, 60)),
    rect: rectOf(el),
    style: styleSubset(el, full),
  });

  const uniformSnapshot = (entry) => {
    const out = {};
    for (const [name, u] of entry.uniforms) out[name] = { type: u.type, values: u.values, updates: u.updates, changes: u.changes };
    return out;
  };
  const canvasFacts = (canvas) => {
    const base = {
      rect: rectOf(canvas),
      widthAttr: canvas.width, heightAttr: canvas.height,
      cssWidth: +canvas.clientWidth, cssHeight: +canvas.clientHeight,
      id: canvas.id ? clip(canvas.id, 80) : undefined,
      classes: Array.from(canvas.classList).slice(0, 8).map((c) => clip(c, 60)),
    };
    const entry = ev.contexts.find((c) => c.canvas === canvas);
    if (entry) {
      return Object.assign(base, {
        context: entry.kind, draws: entry.draws, programs: entry.programs,
        drawingBuffer: { width: entry.gl.drawingBufferWidth, height: entry.gl.drawingBufferHeight },
        uniforms: uniformSnapshot(entry),
        shaders: entry.shaders.map((s) => ({ length: s.length })),
      });
    }
    if (ev.offscreenSet.has(canvas)) return Object.assign(base, { context: "offscreen-transferred" });
    if (ev.failedContexts.some((f) => f.canvas === canvas)) return Object.assign(base, { context: "webgl-unavailable" });
    return Object.assign(base, { context: "none-observed" });
  };

  const root = (selector) => (selector ? document.querySelector(selector) : document.documentElement);
  const within = (rootEl, el) => rootEl === el || rootEl.contains(el);

  ev.ready = (selector) => {
    const rootEl = root(selector);
    if (!rootEl) return { ready: false, reason: "selection-absent" };
    if (document.readyState === "loading") return { ready: false, reason: "document-loading" };
    const canvases = rootEl.tagName === "CANVAS" ? [rootEl] : Array.from(rootEl.querySelectorAll("canvas"));
    const glCanvases = canvases.filter((c) => ev.contexts.some((x) => x.canvas === c));
    if (glCanvases.length) {
      const drew = glCanvases.some((c) => ev.contexts.find((x) => x.canvas === c).draws > 0);
      return drew ? { ready: true, reason: "gpu-draw-observed" } : { ready: false, reason: "waiting-for-first-draw" };
    }
    const settled = canvases.every((c) => ev.failedContexts.some((f) => f.canvas === c) || ev.offscreenSet.has(c));
    if (canvases.length && !settled) return { ready: false, reason: "waiting-for-canvas-context" };
    return { ready: true, reason: canvases.length ? "canvas-settled-without-live-context" : "dom-present" };
  };

  ev.probe = (selector) => {
    const matches = selector ? Array.from(document.querySelectorAll(selector)) : [document.documentElement];
    if (!matches.length) return { selectionPresent: false, matchCount: 0 };
    const rootEl = matches[0];
    const layers = [];
    const walker = [rootEl].concat(Array.from(rootEl.querySelectorAll("*")).slice(0, 400));
    for (const el of walker) {
      if (layers.length >= 40) break;
      const cs = getComputedStyle(el);
      const interesting = el === rootEl || el.tagName === "CANVAS" || el.tagName === "VIDEO" || el.tagName === "SVG" ||
        cs.animationName !== "none" || cs.transform !== "none" || cs.willChange !== "auto" || cs.filter !== "none";
      if (interesting) layers.push(describe(el, el === rootEl));
    }
    const ancestors = [];
    for (let p = rootEl.parentElement; p && ancestors.length < 6; p = p.parentElement) {
      ancestors.push({ tag: p.tagName.toLowerCase(), id: p.id ? clip(p.id, 80) : undefined, classes: Array.from(p.classList).slice(0, 6).map((c) => clip(c, 60)) });
    }
    const canvases = (rootEl.tagName === "CANVAS" ? [rootEl] : Array.from(rootEl.querySelectorAll("canvas"))).slice(0, MAX_CANVASES).map(canvasFacts);
    const animations = [];
    for (const a of document.getAnimations()) {
      const target = a.effect && a.effect.target;
      if (!target || !within(rootEl, target) || animations.length >= 30) continue;
      let timing = {}, timingError;
      try { timing = a.effect.getComputedTiming(); } catch (e) { timingError = clip(e, 120); }
      let keyframes = [], keyframesError;
      try { keyframes = a.effect.getKeyframes().slice(0, 12).map((k) => { const o = {}; for (const key of Object.keys(k)) o[key] = clip(k[key], 120); return o; }); } catch (e) { keyframesError = clip(e, 120); }
      animations.push({
        kind: a.constructor.name,
        name: clip(a.animationName || a.transitionProperty || a.id || "", 80),
        playState: a.playState,
        scrollDriven: typeof window.ScrollTimeline === "function" && a.timeline instanceof window.ScrollTimeline,
        timing: {
          duration: typeof timing.duration === "number" ? timing.duration : String(timing.duration),
          delay: timing.delay, endDelay: timing.endDelay, iterations: String(timing.iterations),
          direction: timing.direction, easing: clip(timing.easing, 80), fill: timing.fill,
          progress: timing.progress, currentIteration: timing.currentIteration,
        },
        currentTime: a.currentTime && typeof a.currentTime === "number" ? a.currentTime : null,
        target: { tag: target.tagName.toLowerCase(), id: target.id ? clip(target.id, 60) : undefined, classes: Array.from(target.classList).slice(0, 6).map((c) => clip(c, 60)) },
        keyframes, timingError, keyframesError,
      });
    }
    const classNames = new Set(), ids = new Set();
    for (const el of walker.slice(0, 200)) {
      el.classList.forEach((c) => classNames.add(c));
      if (el.id) ids.add(el.id);
    }
    return {
      selectionPresent: true,
      matchCount: matches.length,
      element: describe(rootEl, true),
      ancestors, layers, canvases, animations,
      sliceTerms: {
        classNames: Array.from(classNames).slice(0, 80),
        ids: Array.from(ids).slice(0, 40),
        animationNames: Array.from(new Set(animations.map((a) => a.name).filter(Boolean))),
        uniformNames: Array.from(new Set(canvases.flatMap((c) => Object.keys(c.uniforms || {})))).slice(0, 64),
      },
      page: {
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        webgpuRequests: ev.webgpuRequests, offscreenCanvases: ev.offscreenCanvases, workers: ev.workers,
      },
    };
  };

  ev.observe = (selector, durationMs, intervalMs) => new Promise((resolve) => {
    const rootEl = root(selector);
    if (!rootEl) { resolve({ sampled: 0, reason: "selection-absent" }); return; }
    const entries = ev.contexts.filter((c) => rootEl === c.canvas || rootEl.contains(c.canvas));
    const t0 = performance.now();
    const raf0 = ev.rafTicks, draws0 = ev.drawsTotal;
    const uniforms0 = {};
    entries.forEach((e, i) => { for (const [n, u] of e.uniforms) uniforms0[i + ":" + n] = u.values.join(","); });
    const samples = [];
    const take = () => {
      const cs = getComputedStyle(rootEl);
      const anims = document.getAnimations().filter((a) => a.effect && a.effect.target && within(rootEl, a.effect.target)).slice(0, 5);
      samples.push({
        t: +(performance.now() - t0).toFixed(1), rect: rectOf(rootEl), transform: cs.transform, opacity: cs.opacity,
        animationTimes: anims.map((a) => (typeof a.currentTime === "number" ? +a.currentTime.toFixed(1) : null)),
      });
    };
    take();
    const timer = setInterval(() => {
      take();
      if (performance.now() - t0 >= durationMs || samples.length >= 60) {
        clearInterval(timer);
        const first = samples[0], last = samples[samples.length - 1];
        const changedUniforms = [];
        entries.forEach((e, i) => { for (const [n, u] of e.uniforms) { const key = i + ":" + n; if (uniforms0[key] !== undefined && uniforms0[key] !== u.values.join(",")) changedUniforms.push(n); else if (uniforms0[key] === undefined) changedUniforms.push(n); } });
        const advancing = last.animationTimes.some((t, i) => t !== null && first.animationTimes[i] !== null && t !== first.animationTimes[i]);
        resolve({
          sampled: samples.length, durationMs: +(performance.now() - t0).toFixed(1),
          rectChanged: JSON.stringify(first.rect) !== JSON.stringify(last.rect),
          transformChanged: samples.some((s) => s.transform !== first.transform),
          opacityChanged: samples.some((s) => s.opacity !== first.opacity),
          animationsAdvancing: advancing,
          rafTicks: ev.rafTicks - raf0, draws: ev.drawsTotal - draws0,
          uniformsChanged: Array.from(new Set(changedUniforms)).slice(0, 32),
          samples: samples.filter((_, i) => i % Math.max(1, Math.ceil(samples.length / 12)) === 0).slice(0, 12),
        });
      }
    }, Math.max(16, intervalMs));
  });

  ev.inlineSources = (maxEach, maxCount) => {
    const out = [];
    for (const el of Array.from(document.querySelectorAll("style, script:not([src])"))) {
      if (out.length >= maxCount) break;
      const type = el.tagName.toLowerCase() === "style" ? "stylesheet" : "script";
      if (type === "script") {
        const t = el.getAttribute("type");
        if (t && !/javascript|module|^$/i.test(t)) continue;
      }
      const text = el.textContent || "";
      if (!text.trim()) continue;
      out.push({ type, index: out.length, length: text.length, text: text.slice(0, maxEach) });
    }
    return out;
  };

  ev.environment = () => ({
    innerWidth, innerHeight, devicePixelRatio, outerWidth,
    screenWidth: screen.width, screenHeight: screen.height,
    visualViewportScale: window.visualViewport ? window.visualViewport.scale : 1,
    userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
  });
})();
`;

/** Runs in about:blank before navigation to learn what this browser can render. */
export const RENDER_CAPABILITY_SCRIPT = String.raw`
(() => {
  const probe = (kind) => {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext(kind);
      if (!gl) return { available: false };
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
      return {
        available: true, renderer: renderer.slice(0, 200),
        software: /swiftshader|llvmpipe|softpipe|software/i.test(renderer),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      };
    } catch (e) { return { available: false, error: String(e).slice(0, 120) }; }
  };
  return {
    webgl: probe("webgl"), webgl2: probe("webgl2"),
    webgpu: { exposed: typeof navigator.gpu !== "undefined" },
    offscreenCanvas: typeof OffscreenCanvas !== "undefined",
  };
})()
`;
