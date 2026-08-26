import { useEffect, useRef } from "react";

import type {
  HeroShaderSettings,
  HeroShaderVariant,
  RibbonFieldSettings,
} from "./hero-shader-settings";

// Forked from @agent-native/core's StarfieldBackground (packages/core/src/client/StarfieldBackground.tsx)
// so the hero can expose live-tunable uniforms (particle count, color, blink
// rate, spin, turbulence) without touching the shared component other apps
// depend on. Adapted from "The Universe Within" by BigWings (Martijn
// Steinrucken) — https://www.shadertoy.com/view/lscczl — CC BY-NC-SA 3.0.
const vertexShader = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform float uDark;
uniform vec3 uPointer;
uniform float uLayers;
uniform float uBlinkRate;
uniform float uSpin;
uniform float uTurbulence;
uniform vec3 uColor;
uniform vec3 uBgColor;
uniform float uSpeed;
uniform float uGlow;
uniform float uScale;
uniform float uSeed;
uniform float uVignette;
uniform float uColorMode;
uniform vec3 uAccentColor;

#define S(a, b, t) smoothstep(a, b, t)

float N21(vec2 p) {
  p += uSeed;
  vec3 a = fract(vec3(p.xyx) * vec3(213.897, 653.453, 253.098));
  a += dot(a, a.yzx + 79.76);
  return fract((a.x + a.y) * a.z);
}

vec2 GetPos(vec2 id, vec2 offs, float t) {
  float n = N21(id + offs);
  float n1 = fract(n * 10.);
  float n2 = fract(n * 100.);
  float a = t + n;
  return offs + vec2(sin(a * n1), cos(a * n2)) * uTurbulence;
}

vec2 Attract(vec2 p, vec2 cursor, float strength) {
  vec2 delta = cursor - p;
  float d = length(delta);
  float pull = 1. - smoothstep(.08, 1.9, d);
  pull = pull * pull * (3. - 2. * pull);
  return p + delta * pull * .095 * strength;
}

float df_line(in vec2 a, in vec2 b, in vec2 p) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
  return length(pa - ba * h);
}

float line(vec2 a, vec2 b, vec2 uv) {
  float r1 = .025;
  float r2 = .006;
  float d = df_line(a, b, uv);
  float d2 = length(a - b);
  float fade = S(1.5, .5, d2);
  fade += S(.05, .02, abs(d2 - .75));
  return S(r1, r2, d) * fade;
}

// Unrolled for WebGL1 compatibility (no dynamic array indexing)
float NetLayer(vec2 st, float n, float t, vec2 pointer, float pointerStrength) {
  vec2 cell = floor(st);
  vec2 id = cell + n;
  vec2 cursor = pointer - cell;
  st = fract(st) - .5;

  vec2 p0 = Attract(GetPos(id, vec2(-1,-1), t), cursor, pointerStrength);
  vec2 p1 = Attract(GetPos(id, vec2( 0,-1), t), cursor, pointerStrength);
  vec2 p2 = Attract(GetPos(id, vec2( 1,-1), t), cursor, pointerStrength);
  vec2 p3 = Attract(GetPos(id, vec2(-1, 0), t), cursor, pointerStrength);
  vec2 p4 = Attract(GetPos(id, vec2( 0, 0), t), cursor, pointerStrength);
  vec2 p5 = Attract(GetPos(id, vec2( 1, 0), t), cursor, pointerStrength);
  vec2 p6 = Attract(GetPos(id, vec2(-1, 1), t), cursor, pointerStrength);
  vec2 p7 = Attract(GetPos(id, vec2( 0, 1), t), cursor, pointerStrength);
  vec2 p8 = Attract(GetPos(id, vec2( 1, 1), t), cursor, pointerStrength);

  float m = 0.;
  float sparkle = 0.;
  float d; float s; float pulse;

  m += line(p4, p0, st);
  d = length(st-p0); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p0.x)+fract(p0.y)+t)*uBlinkRate)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p1, st);
  d = length(st-p1); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p1.x)+fract(p1.y)+t)*uBlinkRate)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p2, st);
  d = length(st-p2); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p2.x)+fract(p2.y)+t)*uBlinkRate)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p3, st);
  d = length(st-p3); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p3.x)+fract(p3.y)+t)*uBlinkRate)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p4, st);
  d = length(st-p4); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p4.x)+fract(p4.y)+t)*uBlinkRate)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p5, st);
  d = length(st-p5); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p5.x)+fract(p5.y)+t)*uBlinkRate)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p6, st);
  d = length(st-p6); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p6.x)+fract(p6.y)+t)*uBlinkRate)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p7, st);
  d = length(st-p7); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p7.x)+fract(p7.y)+t)*uBlinkRate)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p4, p8, st);
  d = length(st-p8); s = (.005/(d*d)); s *= S(1.,.7,d);
  pulse = sin((fract(p8.x)+fract(p8.y)+t)*uBlinkRate)*.4+.6; pulse = pow(pulse, 20.);
  sparkle += s * pulse;

  m += line(p1, p3, st);
  m += line(p1, p5, st);
  m += line(p7, p5, st);
  m += line(p7, p3, st);

  float sPhase = (sin(t + n) + sin(t * .1)) * .25 + .5;
  sPhase += pow(sin(t * .1) * .5 + .5, 50.) * 5.;
  m += sparkle * sPhase * uGlow;

  return m;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - iResolution.xy * .5) / iResolution.y;

  float scaledTime = iTime * uSpeed;
  float t = scaledTime * uSpin;

  float s = sin(t);
  float c = cos(t);
  mat2 rot = mat2(c, -s, s, c);
  vec2 st = uv * rot * uScale;
  vec2 pointerUv = (uPointer.xy - iResolution.xy * .5) / iResolution.y;

  float m = 0.;
  for (float li = 0.; li < 8.; li += 1.) {
    if (li >= uLayers) break;
    float i = li / uLayers;
    float z = fract(t + i);
    float size = mix(15., 1., z);
    float fade = S(0., .6, z) * S(1., .8, z);
    vec2 pointerSt = pointerUv * rot * size * uScale;
    vec2 layerSt = st * size;
    float warp = 1. - smoothstep(.15, 2.7, length(layerSt - pointerSt));
    warp = warp * warp * (3. - 2. * warp) * uPointer.z;
    layerSt -= (pointerSt - layerSt) * warp * .035;
    m += fade * NetLayer(layerSt, i, scaledTime * 0.3, pointerSt, uPointer.z);
  }

  float cursorLift = 1. - smoothstep(.04, .48, length(uv - pointerUv));
  cursorLift = cursorLift * cursorLift * (3. - 2. * cursorLift) * uPointer.z;
  m *= 1. + cursorLift * 1.6;

  // uColorMode is 0 (solid) or 1 (gradient) -- mix() with a 0 factor returns
  // uColor exactly, so solid mode never blends in the accent color.
  vec3 gradientColor = mix(uColor, uAccentColor, uv.x * 0.5 + 0.5);
  vec3 pickedColor = mix(uColor, gradientColor, uColorMode);
  vec3 baseCol = pickedColor * mix(0.342857, 1.0, uDark);
  vec3 col = baseCol * m;

  // Clamped instead of the original raw "1. - dot(uv, uv)": this hero
  // canvas is much wider than tall, so uv.x reaches well past +/-1 near the
  // left/right edges, making the raw vignette go negative there and flip
  // the color's sign instead of fading it out. Clamping keeps it fading to
  // 0 (pure bg) instead of clipping to black. uVignette scales the falloff
  // so it can be dialed down to 0 (no vignette) or exaggerated above 1.
  col *= clamp(1. - dot(uv, uv) * uVignette, 0., 1.);

  float tt = min(iTime, 5.0);
  col *= S(0., 20., tt);

  vec3 bg = uBgColor;

  if (uDark < 0.5) {
    col = bg - col * 1.2;
  } else {
    col = bg + col;
  }

  col = clamp(col, 0., 1.);
  fragColor = vec4(col, 1.);
}

void main() {
  mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

function hexToRgb01(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  if (normalized.length !== 6 || Number.isNaN(value)) return [0.35, 0.35, 0.35];
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

interface ConstellationShaderBackgroundProps extends HeroShaderSettings {
  frameRate?: number;
}

// Sits behind the page-grid's column-divider lines inside the hero's
// `PageSection` (which is `position: relative`, so `zIndex: -1` here stays
// scoped to that section instead of dropping behind the whole page).
function ConstellationShaderBackground({
  particleCount,
  color,
  colorMode,
  accentColor,
  blinkRate,
  spin,
  turbulence,
  intensity,
  animationSpeed,
  glow,
  scale,
  seed,
  vignette,
  paused,
  frameRate = 30,
}: ConstellationShaderBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const animationControlRef = useRef<{
    start: () => void;
    stop: () => void;
  } | null>(null);

  // Tweak values are read fresh every frame from this ref instead of
  // re-running the WebGL-init effect, so dragging a slider updates the
  // shader live without tearing down/recreating the GL context per tick.
  const settingsRef = useRef({
    particleCount,
    color,
    colorMode,
    accentColor,
    blinkRate,
    spin,
    turbulence,
    animationSpeed,
    glow,
    scale,
    seed,
    vignette,
    paused,
  });
  useEffect(() => {
    settingsRef.current = {
      particleCount,
      color,
      colorMode,
      accentColor,
      blinkRate,
      spin,
      turbulence,
      animationSpeed,
      glow,
      scale,
      seed,
      vignette,
      paused,
    };
  }, [
    particleCount,
    color,
    colorMode,
    accentColor,
    blinkRate,
    spin,
    turbulence,
    animationSpeed,
    glow,
    scale,
    seed,
    vignette,
    paused,
  ]);

  useEffect(() => {
    const canvasRaw = canvasRef.current;
    const containerRaw = containerRef.current;
    if (!canvasRaw || !containerRaw) return;
    const canvas: HTMLCanvasElement = canvasRaw;
    const container: HTMLElement = containerRaw;

    const glRaw = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!glRaw) return;
    const gl: WebGLRenderingContext = glRaw;

    function compileShader(type: number, src: string) {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vs = compileShader(gl.VERTEX_SHADER, vertexShader);
    const fs = compileShader(gl.FRAGMENT_SHADER, fragmentShader);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }
    gl.useProgram(program);

    const buf = gl.createBuffer();
    if (!buf) {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const posAttrib = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(posAttrib);
    gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, "iTime");
    const uRes = gl.getUniformLocation(program, "iResolution");
    const uDark = gl.getUniformLocation(program, "uDark");
    const uPointer = gl.getUniformLocation(program, "uPointer");
    const uLayers = gl.getUniformLocation(program, "uLayers");
    const uBlinkRate = gl.getUniformLocation(program, "uBlinkRate");
    const uSpin = gl.getUniformLocation(program, "uSpin");
    const uTurbulence = gl.getUniformLocation(program, "uTurbulence");
    const uColor = gl.getUniformLocation(program, "uColor");
    const uBgColor = gl.getUniformLocation(program, "uBgColor");
    const uSpeed = gl.getUniformLocation(program, "uSpeed");
    const uGlow = gl.getUniformLocation(program, "uGlow");
    const uScale = gl.getUniformLocation(program, "uScale");
    const uSeed = gl.getUniformLocation(program, "uSeed");
    const uVignette = gl.getUniformLocation(program, "uVignette");
    const uColorMode = gl.getUniformLocation(program, "uColorMode");
    const uAccentColor = gl.getUniformLocation(program, "uAccentColor");

    const reducedMotionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    let reducedMotion = reducedMotionQuery?.matches ?? false;

    let dpr = 1;
    let hasPointer = false;
    let pointerX = 0;
    let pointerY = 0;
    let pointerStrength = 0;
    let targetX = 0;
    let targetY = 0;
    let targetStrength = 0;

    function readDarkMode() {
      return (
        document.documentElement.classList.contains("dark") ||
        document.documentElement.getAttribute("data-theme") === "dark"
      );
    }

    // --b-bg-page is authored as a hex string in tokens.css and flips value
    // under `.light .builder-brand-tokens`, so reading it here keeps the
    // shader's backdrop identical to the page behind it in both themes
    // instead of hardcoding pure black/white.
    function readBgColor(): [number, number, number] {
      const raw = getComputedStyle(container)
        .getPropertyValue("--b-bg-page")
        .trim();
      return hexToRgb01(raw || "#0a0a0a");
    }

    let dark = readDarkMode();
    let bgColor = readBgColor();

    function easePointer(allowPointer: boolean) {
      if (!allowPointer) {
        pointerStrength = 0;
        return;
      }
      pointerX += (targetX - pointerX) * 0.22;
      pointerY += (targetY - pointerY) * 0.22;
      pointerStrength += (targetStrength - pointerStrength) * 0.14;
      if (pointerStrength < 0.001 && targetStrength === 0) {
        pointerStrength = 0;
      }
    }

    function draw(timeSeconds: number, allowPointer = !reducedMotion) {
      easePointer(allowPointer);
      const [r, g, b] = hexToRgb01(settingsRef.current.color);
      const [ar, ag, ab] = hexToRgb01(settingsRef.current.accentColor);
      gl.uniform1f(uTime, timeSeconds);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uDark, dark ? 1.0 : 0.0);
      gl.uniform3f(uPointer, pointerX, pointerY, pointerStrength);
      gl.uniform1f(uLayers, settingsRef.current.particleCount);
      gl.uniform1f(uBlinkRate, settingsRef.current.blinkRate);
      gl.uniform1f(uSpin, settingsRef.current.spin);
      gl.uniform1f(uTurbulence, settingsRef.current.turbulence);
      gl.uniform1f(uSpeed, settingsRef.current.animationSpeed);
      gl.uniform1f(uGlow, settingsRef.current.glow);
      gl.uniform1f(uScale, settingsRef.current.scale);
      gl.uniform1f(uSeed, settingsRef.current.seed);
      gl.uniform1f(uVignette, settingsRef.current.vignette);
      gl.uniform1f(
        uColorMode,
        settingsRef.current.colorMode === "gradient" ? 1 : 0,
      );
      gl.uniform3f(uColor, r, g, b);
      gl.uniform3f(uAccentColor, ar, ag, ab);
      gl.uniform3f(uBgColor, bgColor[0], bgColor[1], bgColor[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function resize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      dpr = Math.min(window.devicePixelRatio, 1.5);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (!hasPointer) {
        pointerX = targetX = canvas.width * 0.5;
        pointerY = targetY = canvas.height * 0.5;
      }
    }

    function handlePointerMove(event: PointerEvent | MouseEvent) {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const inside = x >= 0 && x <= rect.width && y >= 0 && y <= rect.height;

      hasPointer = true;
      targetX = x * dpr;
      targetY = (rect.height - y) * dpr;
      targetStrength = inside ? 1 : 0;
    }

    function fadePointer() {
      targetStrength = 0;
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("mousemove", handlePointerMove, { passive: true });
    document.addEventListener("pointerleave", fadePointer, { passive: true });
    window.addEventListener("blur", fadePointer);

    const observer = new MutationObserver(() => {
      dark = readDarkMode();
      bgColor = readBgColor();
      if (reducedMotion) draw(20, false);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    // Tracks hero visibility so the RAF loop can stop entirely once scrolled
    // past instead of waking every frame just to no-op.
    let isVisible = true;
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? true;
        if (isVisible) startAnimation();
      },
      { threshold: 0 },
    );
    visibilityObserver.observe(container);

    const startTime = performance.now();
    let lastFrame = 0;
    const frameBudget = 1000 / Math.max(1, frameRate);
    const reducedMotionStaticTime = 20;

    function render(now: number) {
      if (reducedMotion || !isVisible || settingsRef.current.paused) {
        rafRef.current = 0;
        return;
      }
      rafRef.current = requestAnimationFrame(render);

      if (now - lastFrame < frameBudget) return;
      lastFrame = now;

      draw((now - startTime) * 0.001);
    }

    function startAnimation() {
      if (
        !rafRef.current &&
        !reducedMotion &&
        isVisible &&
        !settingsRef.current.paused
      ) {
        rafRef.current = requestAnimationFrame(render);
      }
    }

    function stopAnimation() {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    }

    animationControlRef.current = {
      start: startAnimation,
      stop: stopAnimation,
    };

    function handleReducedMotionChange() {
      reducedMotion = reducedMotionQuery?.matches ?? false;
      if (reducedMotion) {
        stopAnimation();
        lastFrame = 0;
        draw(reducedMotionStaticTime, false);
      } else {
        startAnimation();
      }
    }

    draw(reducedMotion ? reducedMotionStaticTime : 0, !reducedMotion);
    if (reducedMotionQuery) {
      reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
    }
    if (!reducedMotion) startAnimation();

    return () => {
      stopAnimation();
      animationControlRef.current = null;
      if (reducedMotionQuery) {
        reducedMotionQuery.removeEventListener(
          "change",
          handleReducedMotionChange,
        );
      }
      observer.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mousemove", handlePointerMove);
      document.removeEventListener("pointerleave", fadePointer);
      window.removeEventListener("blur", fadePointer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [frameRate]);

  // `paused` is otherwise only read from a ref inside the render loop so
  // toggling it doesn't tear down the GL context; that also means the RAF
  // loop needs an explicit nudge to resume once it's stopped itself.
  useEffect(() => {
    if (!paused) animationControlRef.current?.start();
  }, [paused]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: -1,
        opacity: intensity,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}

const ribbonVertexShader = vertexShader;

// Original implementation (not a port): flowing sine "ribbons" are
// domain-warped with the same N21 hash noise used above, biased toward
// `focusX`/`focusY` by a radial falloff mask, then resolved through a
// halftone dot-matrix grid so the whole field reads as an animated dot
// pattern rather than smooth bands. Strictly two-color (bg/fg, both read
// from brand tokens) so it is greyscale by construction in both themes.
const ribbonFragmentShader = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform vec3 uPointer;
uniform float uRibbonCount;
uniform float uDensity;
uniform float uFlowAngle;
uniform float uWarp;
uniform float uSpeed;
uniform float uPointerAmount;
uniform float uFocusX;
uniform float uFocusY;
uniform float uSpread;
uniform float uContrast;
uniform float uGlow;
uniform float uSeed;
uniform float uVignette;
uniform vec3 uFgColor;
uniform vec3 uBgColor;

#define S(a, b, t) smoothstep(a, b, t)

float N21(vec2 p) {
  p += uSeed;
  vec3 a = fract(vec3(p.xyx) * vec3(213.897, 653.453, 253.098));
  a += dot(a, a.yzx + 79.76);
  return fract((a.x + a.y) * a.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = N21(i);
  float b = N21(i + vec2(1., 0.));
  float c = N21(i + vec2(0., 1.));
  float d = N21(i + vec2(1., 1.));
  vec2 u = f * f * (3. - 2. * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1. - u.x) + (d - b) * u.x * u.y;
}

float ribbonField(vec2 p, float t) {
  float angle = radians(uFlowAngle);
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 perp = vec2(-dir.y, dir.x);

  vec2 warpUv = p * 1.3 + vec2(t * 0.05, t * 0.03);
  float n1 = valueNoise(warpUv);
  float n2 = valueNoise(warpUv + 5.2);
  vec2 warped = p + (vec2(n1, n2) - 0.5) * uWarp * 1.2;

  float along = dot(warped, dir);
  float across = dot(warped, perp);

  float field = 0.;
  for (float i = 0.; i < 4.; i += 1.) {
    if (i >= uRibbonCount) break;
    float phase = i * 2.399963;
    float bandFreq = 2.4 + i * 0.6;
    float band = sin(along * bandFreq + t * (0.6 + i * 0.15) + phase);
    float bandWidth = 0.35 + 0.1 * sin(t * 0.2 + i);
    float offset = band * 0.4 - i * 0.18 + 0.27;
    field += S(bandWidth, 0., abs(across - offset) - 0.05);
  }
  return clamp(field, 0., 1.);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - iResolution.xy * .5) / iResolution.y;
  vec2 pointerUv = (uPointer.xy - iResolution.xy * .5) / iResolution.y;
  vec2 focus = vec2(uFocusX, uFocusY);
  float t = iTime * uSpeed;

  float cellSize = 0.16 / max(uDensity, 0.05);
  vec2 cell = floor(uv / cellSize);
  vec2 cellUv = fract(uv / cellSize) - 0.5;
  vec2 cellCenter = (cell + 0.5) * cellSize;

  vec2 cellPointerDelta = pointerUv - cellCenter;
  float cellPull = 1. - S(0.05, 1.6, length(cellPointerDelta));
  cellPull = cellPull * cellPull * (3. - 2. * cellPull);
  vec2 cellSamplePos =
    cellCenter + cellPointerDelta * cellPull * 0.4 * uPointerAmount * uPointer.z;
  float cellField = ribbonField(cellSamplePos, t);
  float cellDistFromFocus = length(cellCenter - focus) / max(uSpread, 0.001);
  float cellMask = 1. - S(0., 1.4, cellDistFromFocus);
  cellField *= cellMask;

  float jitter = (N21(cell) - 0.5) * 0.25 * (sin(t * 2. + N21(cell) * 10.) * 0.5 + 0.5);
  float value = clamp(cellField + jitter, 0., 1.);

  float radius = mix(0.03, 0.26, value);
  float edge = mix(0.28, 0.03, uContrast) * max(radius, 0.05);
  float dotShape = 1. - S(radius - edge, radius + edge, length(cellUv));

  float glowRadius = radius + uGlow * 0.5;
  float glowTerm = (1. - S(radius, glowRadius, length(cellUv))) * uGlow * value;

  float dotMask = clamp(dotShape + glowTerm * 0.6, 0., 1.);
  dotMask *= clamp(1. - dot(uv, uv) * uVignette, 0., 1.);
  dotMask *= S(0., 20., min(iTime, 5.0));

  vec3 col = mix(uBgColor, uFgColor, clamp(dotMask, 0., 1.));
  fragColor = vec4(col, 1.);
}

void main() {
  mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

interface RibbonFieldShaderBackgroundProps extends RibbonFieldSettings {
  frameRate?: number;
}

function RibbonFieldShaderBackground({
  ribbonCount,
  density,
  flowAngle,
  warp,
  speed,
  pointerAmount,
  smoothing,
  focusX,
  focusY,
  spread,
  contrast,
  glow,
  intensity,
  seed,
  vignette,
  paused,
  frameRate = 30,
}: RibbonFieldShaderBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const animationControlRef = useRef<{
    start: () => void;
    stop: () => void;
  } | null>(null);

  const settingsRef = useRef({
    ribbonCount,
    density,
    flowAngle,
    warp,
    speed,
    pointerAmount,
    smoothing,
    focusX,
    focusY,
    spread,
    contrast,
    glow,
    seed,
    vignette,
    paused,
  });
  useEffect(() => {
    settingsRef.current = {
      ribbonCount,
      density,
      flowAngle,
      warp,
      speed,
      pointerAmount,
      smoothing,
      focusX,
      focusY,
      spread,
      contrast,
      glow,
      seed,
      vignette,
      paused,
    };
  }, [
    ribbonCount,
    density,
    flowAngle,
    warp,
    speed,
    pointerAmount,
    smoothing,
    focusX,
    focusY,
    spread,
    contrast,
    glow,
    seed,
    vignette,
    paused,
  ]);

  useEffect(() => {
    const canvasRaw = canvasRef.current;
    const containerRaw = containerRef.current;
    if (!canvasRaw || !containerRaw) return;
    const canvas: HTMLCanvasElement = canvasRaw;
    const container: HTMLElement = containerRaw;

    const glRaw = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!glRaw) return;
    const gl: WebGLRenderingContext = glRaw;

    function compileShader(type: number, src: string) {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vs = compileShader(gl.VERTEX_SHADER, ribbonVertexShader);
    const fs = compileShader(gl.FRAGMENT_SHADER, ribbonFragmentShader);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }
    gl.useProgram(program);

    const buf = gl.createBuffer();
    if (!buf) {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const posAttrib = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(posAttrib);
    gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, "iTime");
    const uRes = gl.getUniformLocation(program, "iResolution");
    const uPointer = gl.getUniformLocation(program, "uPointer");
    const uRibbonCount = gl.getUniformLocation(program, "uRibbonCount");
    const uDensity = gl.getUniformLocation(program, "uDensity");
    const uFlowAngle = gl.getUniformLocation(program, "uFlowAngle");
    const uWarp = gl.getUniformLocation(program, "uWarp");
    const uSpeed = gl.getUniformLocation(program, "uSpeed");
    const uPointerAmount = gl.getUniformLocation(program, "uPointerAmount");
    const uFocusX = gl.getUniformLocation(program, "uFocusX");
    const uFocusY = gl.getUniformLocation(program, "uFocusY");
    const uSpread = gl.getUniformLocation(program, "uSpread");
    const uContrast = gl.getUniformLocation(program, "uContrast");
    const uGlow = gl.getUniformLocation(program, "uGlow");
    const uSeed = gl.getUniformLocation(program, "uSeed");
    const uVignette = gl.getUniformLocation(program, "uVignette");
    const uFgColor = gl.getUniformLocation(program, "uFgColor");
    const uBgColor = gl.getUniformLocation(program, "uBgColor");

    const reducedMotionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    let reducedMotion = reducedMotionQuery?.matches ?? false;

    let dpr = 1;
    let hasPointer = false;
    let pointerX = 0;
    let pointerY = 0;
    let pointerStrength = 0;
    let targetX = 0;
    let targetY = 0;
    let targetStrength = 0;

    // --b-bg-page and --b-text-secondary are authored as hex strings in
    // tokens.css and both flip value under `.light .builder-brand-tokens`,
    // so reading them here keeps the shader theme-correct without any
    // user-facing color pickers.
    function readBgColor(): [number, number, number] {
      const raw = getComputedStyle(container)
        .getPropertyValue("--b-bg-page")
        .trim();
      return hexToRgb01(raw || "#0a0a0a");
    }

    function readFgColor(): [number, number, number] {
      const raw = getComputedStyle(container)
        .getPropertyValue("--b-text-secondary")
        .trim();
      return hexToRgb01(raw || "#aeadac");
    }

    let bgColor = readBgColor();
    let fgColor = readFgColor();

    function easePointer(allowPointer: boolean) {
      if (!allowPointer) {
        pointerStrength = 0;
        return;
      }
      const rate = settingsRef.current.smoothing;
      pointerX += (targetX - pointerX) * rate * 6;
      pointerY += (targetY - pointerY) * rate * 6;
      pointerStrength += (targetStrength - pointerStrength) * rate * 4;
      if (pointerStrength < 0.001 && targetStrength === 0) {
        pointerStrength = 0;
      }
    }

    function draw(timeSeconds: number, allowPointer = !reducedMotion) {
      easePointer(allowPointer);
      gl.uniform1f(uTime, timeSeconds);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform3f(uPointer, pointerX, pointerY, pointerStrength);
      gl.uniform1f(uRibbonCount, settingsRef.current.ribbonCount);
      gl.uniform1f(uDensity, settingsRef.current.density);
      gl.uniform1f(uFlowAngle, settingsRef.current.flowAngle);
      gl.uniform1f(uWarp, settingsRef.current.warp);
      gl.uniform1f(uSpeed, settingsRef.current.speed);
      gl.uniform1f(uPointerAmount, settingsRef.current.pointerAmount);
      gl.uniform1f(uFocusX, settingsRef.current.focusX);
      gl.uniform1f(uFocusY, settingsRef.current.focusY);
      gl.uniform1f(uSpread, settingsRef.current.spread);
      gl.uniform1f(uContrast, settingsRef.current.contrast);
      gl.uniform1f(uGlow, settingsRef.current.glow);
      gl.uniform1f(uSeed, settingsRef.current.seed);
      gl.uniform1f(uVignette, settingsRef.current.vignette);
      gl.uniform3f(uFgColor, fgColor[0], fgColor[1], fgColor[2]);
      gl.uniform3f(uBgColor, bgColor[0], bgColor[1], bgColor[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function resize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      dpr = Math.min(window.devicePixelRatio, 1.5);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (!hasPointer) {
        pointerX = targetX = canvas.width * 0.5;
        pointerY = targetY = canvas.height * 0.5;
      }
    }

    function handlePointerMove(event: PointerEvent | MouseEvent) {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const inside = x >= 0 && x <= rect.width && y >= 0 && y <= rect.height;

      hasPointer = true;
      targetX = x * dpr;
      targetY = (rect.height - y) * dpr;
      targetStrength = inside ? 1 : 0;
    }

    function fadePointer() {
      targetStrength = 0;
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("mousemove", handlePointerMove, { passive: true });
    document.addEventListener("pointerleave", fadePointer, { passive: true });
    window.addEventListener("blur", fadePointer);

    const observer = new MutationObserver(() => {
      bgColor = readBgColor();
      fgColor = readFgColor();
      if (reducedMotion) draw(20, false);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    let isVisible = true;
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? true;
        if (isVisible) startAnimation();
      },
      { threshold: 0 },
    );
    visibilityObserver.observe(container);

    const startTime = performance.now();
    let lastFrame = 0;
    const frameBudget = 1000 / Math.max(1, frameRate);
    const reducedMotionStaticTime = 20;

    function render(now: number) {
      if (reducedMotion || !isVisible || settingsRef.current.paused) {
        rafRef.current = 0;
        return;
      }
      rafRef.current = requestAnimationFrame(render);

      if (now - lastFrame < frameBudget) return;
      lastFrame = now;

      draw((now - startTime) * 0.001);
    }

    function startAnimation() {
      if (
        !rafRef.current &&
        !reducedMotion &&
        isVisible &&
        !settingsRef.current.paused
      ) {
        rafRef.current = requestAnimationFrame(render);
      }
    }

    function stopAnimation() {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    }

    animationControlRef.current = {
      start: startAnimation,
      stop: stopAnimation,
    };

    function handleReducedMotionChange() {
      reducedMotion = reducedMotionQuery?.matches ?? false;
      if (reducedMotion) {
        stopAnimation();
        lastFrame = 0;
        draw(reducedMotionStaticTime, false);
      } else {
        startAnimation();
      }
    }

    draw(reducedMotion ? reducedMotionStaticTime : 0, !reducedMotion);
    if (reducedMotionQuery) {
      reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
    }
    if (!reducedMotion) startAnimation();

    return () => {
      stopAnimation();
      animationControlRef.current = null;
      if (reducedMotionQuery) {
        reducedMotionQuery.removeEventListener(
          "change",
          handleReducedMotionChange,
        );
      }
      observer.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mousemove", handlePointerMove);
      document.removeEventListener("pointerleave", fadePointer);
      window.removeEventListener("blur", fadePointer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [frameRate]);

  useEffect(() => {
    if (!paused) animationControlRef.current?.start();
  }, [paused]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: -1,
        opacity: intensity,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}

export interface HeroShaderBackgroundProps {
  variant: HeroShaderVariant;
  constellation: HeroShaderSettings;
  ribbonField: RibbonFieldSettings;
  frameRate?: number;
}

// Sits behind the page-grid's column-divider lines inside the hero's
// `PageSection` (which is `position: relative`, so `zIndex: -1` here stays
// scoped to that section instead of dropping behind the whole page). Only
// the active variant is mounted so a single GL context/RAF loop is ever
// alive at once.
export function HeroShaderBackground({
  variant,
  constellation,
  ribbonField,
  frameRate,
}: HeroShaderBackgroundProps) {
  if (variant === "ribbon-field") {
    return (
      <RibbonFieldShaderBackground {...ribbonField} frameRate={frameRate} />
    );
  }
  return (
    <ConstellationShaderBackground {...constellation} frameRate={frameRate} />
  );
}
