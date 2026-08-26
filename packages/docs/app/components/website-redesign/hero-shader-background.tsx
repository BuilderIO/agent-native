import { useEffect, useRef } from "react";

import type {
  AtmosphereSettings,
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

// Original implementation (not a port): gentle travelling waves of light,
// domain-warped with the same N21 hash noise used above, attenuated by a
// radial falloff around `focusX`/`focusY` and then posterized into discrete
// bands. The falloff is applied *before* quantizing, which is what makes the
// band contours ring outward from the bright focus instead of merely striping
// along the flow direction. Strictly two-color (bg/fg, both read from brand
// tokens) so it is greyscale by construction in both themes.
const ribbonFragmentShader = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform vec3 uPointer;
uniform float uWaveCount;
uniform float uWaveScale;
uniform float uFlowAngle;
uniform float uWarp;
uniform float uSpeed;
uniform float uPointerAmount;
uniform float uFocusX;
uniform float uFocusY;
uniform float uSpread;
uniform float uContrast;
uniform float uGlow;
uniform float uBrightness;
uniform float uDither;
uniform float uDitherScale;
uniform float uDotDensity;
uniform float uDotScale;
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

// Smooth travelling wave field in [0,1]. Deliberately continuous -- all the
// banding comes from posterizing this afterwards, so the wave itself stays
// a clean gradient that the quantizer can carve into even steps.
float waveField(vec2 p, float t) {
  float angle = radians(uFlowAngle);
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 perp = vec2(-dir.y, dir.x);

  // Domain-warping the coordinate (rather than adding noise to the result)
  // bends the wavefronts themselves, so the bands undulate organically
  // instead of staying parallel rulings with noise laid over them.
  vec2 warpUv = p * 1.1 + vec2(t * 0.06, t * 0.04);
  float n1 = valueNoise(warpUv);
  float n2 = valueNoise(warpUv + 5.2);
  vec2 warped = p + (vec2(n1, n2) - 0.5) * uWarp;

  float along = dot(warped, dir);
  float across = dot(warped, perp);

  // Summed sines at incommensurate frequencies and drift rates. Each octave
  // is cross-modulated by the perpendicular axis so wavefronts curve along
  // their length, and amplitude falls off per octave so the first wave sets
  // the broad shape while later ones only add fine detail.
  float field = 0.;
  float weight = 0.;
  for (float i = 0.; i < 5.; i += 1.) {
    if (i >= uWaveCount) break;
    float amp = 1. / (1. + i * 0.8);
    float freq = uWaveScale * (1. + i * 0.55);
    float drift = t * (1. + i * 0.23) + i * 2.399963;
    float cross = sin(across * freq * 0.45 - drift * 0.7);
    field += amp * sin(along * freq + drift + cross * 1.3);
    weight += amp;
  }

  return clamp(field / max(weight, 0.001) * 0.5 + 0.5, 0., 1.);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - iResolution.xy * .5) / iResolution.y;
  vec2 pointerUv = (uPointer.xy - iResolution.xy * .5) / iResolution.y;
  vec2 focus = vec2(uFocusX, uFocusY);
  float t = iTime * uSpeed;

  // Ben-Day halftone grid. The wave field is sampled once per cell at the
  // cell's center rather than per pixel, which is what keeps each dot a
  // clean uniform disc -- sampling per pixel would let the tone vary across
  // a single dot and smear its edge.
  float cellSize = 1. / max(uDotDensity, 1.);
  vec2 cell = floor(uv / cellSize);
  vec2 cellCenter = (cell + 0.5) * cellSize;
  vec2 cellUv = (uv - cellCenter) / cellSize;

  // Pointer drags the sampled position, falling off with distance, so the
  // wavefronts bend locally toward the cursor rather than the whole field
  // sliding as one.
  vec2 pointerDelta = pointerUv - cellCenter;
  float pull = 1. - S(0.05, 1.6, length(pointerDelta));
  pull = pull * pull * (3. - 2. * pull);
  vec2 samplePos =
    cellCenter + pointerDelta * pull * 0.35 * uPointerAmount * uPointer.z;

  float tone = waveField(samplePos, t);

  // Radial falloff from the focus point, applied *before* posterizing so the
  // quantizer sees a signal that already decays outward -- that's what makes
  // the dot sizes step down in rings around the bright focus instead of only
  // tracking the wave direction.
  float distFromFocus = length(cellCenter - focus) / max(uSpread, 0.001);
  float falloff = exp(-1.6 * distFromFocus * distFromFocus);
  tone *= falloff;

  // Shapes the tonal distribution: below 1 widens the bright areas, above 1
  // crushes them inward. Tone stays continuous from here on -- dot radius
  // varies smoothly rather than snapping to a few sizes, so brightness reads
  // as a gradient instead of visible steps.
  tone = pow(clamp(tone, 0., 1.), mix(2.6, 0.5, uContrast));

  float smoothTone = tone;

  // sqrt() because the eye reads a dot's *area* as its brightness, and area
  // grows with the square of the radius -- taking the root makes apparent
  // tone track the field linearly instead of darkening too fast.
  float radius = sqrt(clamp(tone, 0., 1.)) * 0.5 * uDotScale;

  // One device pixel expressed in cell-local units, so the dot edge gets the
  // same visual softness regardless of grid density or resolution.
  float px = (1. / iResolution.y) / cellSize;
  float edge = max(px * 1.2, 0.004);

  // Per-pixel hash offsetting the edge test, which erodes each dot's rim
  // stochastically instead of shifting it uniformly -- that's what produces
  // the finely broken-up edges rather than a clean circle or a blur. Keyed on
  // raw fragCoord (not the cell) so the noise is per-pixel; scaled by the
  // dot's own radius so faint small dots aren't dissolved entirely while
  // bright large ones still get texture.
  float dist = length(cellUv);
  float grain = N21(floor(fragCoord / max(uDitherScale, 1.))) - 0.5;
  dist += grain * uDither * max(radius, 0.05) * 0.8;

  float dotMask = 1. - S(radius - edge, radius + edge, dist);

  // Soft halo just outside each dot, scaled by the continuous tone so the
  // grid sits on a gentle wash instead of reading as flat paper cutouts.
  float glowTerm =
    (1. - S(radius, radius + uGlow * 0.9, dist)) * uGlow * smoothTone;

  float value = clamp(dotMask + glowTerm * 0.6, 0., 1.);

  value *= clamp(1. - dot(uv, uv) * uVignette, 0., 1.);
  // Fade up over the first couple of seconds. The smoothstep bounds have to
  // match the input range or the fade never completes -- the previous
  // S(0., 20., min(iTime, 5.)) topped out at 0.156, permanently pinning the
  // whole field to ~16% brightness.
  value *= S(0., 2.5, iTime);

  // Extrapolating away from bg along the fg/bg contrast direction (rather
  // than mixing toward literal white) keeps brightness correct in both
  // themes: in dark mode fg is lighter than bg so it pushes toward white, in
  // light mode fg is darker so it pushes toward black. Scaling by tone means
  // dots nearer the focus pull further than dim outer ones, which is what
  // creates the bright-center/dim-edge separation.
  vec3 lit = mix(uBgColor, uFgColor, value);
  lit += (uFgColor - uBgColor) * value * tone * (uBrightness - 1.);

  fragColor = vec4(clamp(lit, 0., 1.), 1.);
}

void main() {
  mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

interface RibbonFieldShaderBackgroundProps extends RibbonFieldSettings {
  frameRate?: number;
}

function RibbonFieldShaderBackground({
  waveCount,
  waveScale,
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
  brightness,
  dither,
  ditherScale,
  dotDensity,
  dotScale,
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
    waveCount,
    waveScale,
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
    brightness,
    dither,
    ditherScale,
    dotDensity,
    dotScale,
    seed,
    vignette,
    paused,
  });
  useEffect(() => {
    settingsRef.current = {
      waveCount,
      waveScale,
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
      brightness,
      dither,
      ditherScale,
      dotDensity,
      dotScale,
      seed,
      vignette,
      paused,
    };
  }, [
    waveCount,
    waveScale,
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
    brightness,
    dither,
    ditherScale,
    dotDensity,
    dotScale,
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
    const uWaveCount = gl.getUniformLocation(program, "uWaveCount");
    const uWaveScale = gl.getUniformLocation(program, "uWaveScale");
    const uFlowAngle = gl.getUniformLocation(program, "uFlowAngle");
    const uWarp = gl.getUniformLocation(program, "uWarp");
    const uSpeed = gl.getUniformLocation(program, "uSpeed");
    const uPointerAmount = gl.getUniformLocation(program, "uPointerAmount");
    const uFocusX = gl.getUniformLocation(program, "uFocusX");
    const uFocusY = gl.getUniformLocation(program, "uFocusY");
    const uSpread = gl.getUniformLocation(program, "uSpread");
    const uContrast = gl.getUniformLocation(program, "uContrast");
    const uGlow = gl.getUniformLocation(program, "uGlow");
    const uBrightness = gl.getUniformLocation(program, "uBrightness");
    const uDither = gl.getUniformLocation(program, "uDither");
    const uDitherScale = gl.getUniformLocation(program, "uDitherScale");
    const uDotDensity = gl.getUniformLocation(program, "uDotDensity");
    const uDotScale = gl.getUniformLocation(program, "uDotScale");
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
      gl.uniform1f(uWaveCount, settingsRef.current.waveCount);
      gl.uniform1f(uWaveScale, settingsRef.current.waveScale);
      gl.uniform1f(uFlowAngle, settingsRef.current.flowAngle);
      gl.uniform1f(uWarp, settingsRef.current.warp);
      gl.uniform1f(uSpeed, settingsRef.current.speed);
      gl.uniform1f(uPointerAmount, settingsRef.current.pointerAmount);
      gl.uniform1f(uFocusX, settingsRef.current.focusX);
      gl.uniform1f(uFocusY, settingsRef.current.focusY);
      gl.uniform1f(uSpread, settingsRef.current.spread);
      gl.uniform1f(uContrast, settingsRef.current.contrast);
      gl.uniform1f(uGlow, settingsRef.current.glow);
      gl.uniform1f(uBrightness, settingsRef.current.brightness);
      gl.uniform1f(uDither, settingsRef.current.dither);
      gl.uniform1f(uDitherScale, settingsRef.current.ditherScale);
      gl.uniform1f(uDotDensity, settingsRef.current.dotDensity);
      gl.uniform1f(uDotScale, settingsRef.current.dotScale);
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

const atmosphereVertexShader = vertexShader;

// Adapted from the classic "Atmospheric Scattering" GLSL by GLtracy
// (public-domain Shadertoy demo): a planet + Rayleigh/Mie atmosphere
// raymarched per-pixel. The sphere is anchored toward the bottom of the
// canvas via uCenterX/uCenterY so mostly its upper limb and atmosphere halo
// are in frame, and the sun direction is animated (pitch/yaw uniforms) so
// its grazing-angle glow sweeps around the visible rim over time instead of
// the original demo's camera-orbit.
const atmosphereFragmentShader = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform float uPlanetRadius;
uniform float uAtmosphereThickness;
uniform float uFov;
uniform float uEyeDistance;
uniform float uCenterX;
uniform float uCenterY;
uniform float uLightPitch;
uniform float uLightYawStart;
uniform float uLightYawEnd;
uniform float uLightSpeed;
uniform vec3 uRayleighColor;
uniform float uRayleighHeight;
uniform float uMieStrength;
uniform float uMieExtinction;
uniform float uMieHeight;
uniform float uMieG;
uniform float uExposure;
uniform float uGamma;
uniform float uOutSteps;
uniform float uInSteps;
uniform vec3 uPageColor;
uniform float uScreenBlend;
uniform float uLightSaturation;
uniform float uLightScreenAmount;
uniform float uIntroDuration;
uniform float uWarpAmount;
uniform float uWarpScale;
uniform float uWarpSpeed;
uniform float uDitherAmount;
uniform float uDitherScale;
uniform float uDitherSpeed;
uniform float uDitherMode;
uniform float uPosterizeLevels;

const float PI = 3.14159265359;
const float MAX = 10000.0;

vec2 ray_vs_sphere(vec3 p, vec3 dir, float r) {
  float b = dot(p, dir);
  float c = dot(p, p) - r * r;

  float d = b * b - c;
  if (d < 0.0) {
    return vec2(MAX, -MAX);
  }
  d = sqrt(d);

  return vec2(-b - d, -b + d);
}

float phase_mie(float g, float c, float cc) {
  float gg = g * g;

  float a = (1.0 - gg) * (1.0 + cc);

  float b = 1.0 + gg - 2.0 * g * c;
  b *= sqrt(b);
  b *= 2.0 + gg;

  return (3.0 / 8.0 / PI) * a / b;
}

float phase_ray(float cc) {
  return (3.0 / 16.0 / PI) * (1.0 + cc);
}

float density(vec3 p, float ph) {
  return exp(-max(length(p) - uPlanetRadius, 0.0) / ph);
}

float optic(vec3 p, vec3 q, float ph) {
  vec3 s = (q - p) / uOutSteps;
  vec3 v = p + s * 0.5;

  float sum = 0.0;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= uOutSteps) break;
    sum += density(v, ph);
    v += s;
  }
  sum *= length(s);

  return sum;
}

vec3 in_scatter(vec3 o, vec3 dir, vec2 e, vec3 l) {
  float ph_ray = uRayleighHeight;
  float ph_mie = uMieHeight;

  vec3 k_ray = uRayleighColor;
  vec3 k_mie = vec3(uMieStrength);
  float k_mie_ex = uMieExtinction;
  float R = uPlanetRadius + uAtmosphereThickness;

  vec3 sum_ray = vec3(0.0);
  vec3 sum_mie = vec3(0.0);

  float n_ray0 = 0.0;
  float n_mie0 = 0.0;

  float len = (e.y - e.x) / uInSteps;
  vec3 s = dir * len;
  vec3 v = o + dir * (e.x + len * 0.5);

  for (int i = 0; i < 160; i++) {
    if (float(i) >= uInSteps) break;

    float d_ray = density(v, ph_ray) * len;
    float d_mie = density(v, ph_mie) * len;

    n_ray0 += d_ray;
    n_mie0 += d_mie;

    vec2 f = ray_vs_sphere(v, l, R);
    vec3 u = v + l * f.y;

    float n_ray1 = optic(v, u, ph_ray);
    float n_mie1 = optic(v, u, ph_mie);

    vec3 att = exp(-(n_ray0 + n_ray1) * k_ray - (n_mie0 + n_mie1) * k_mie * k_mie_ex);

    sum_ray += d_ray * att;
    sum_mie += d_mie * att;

    v += s;
  }

  float c = dot(dir, -l);
  float cc = c * c;
  vec3 scatter =
    sum_ray * k_ray * phase_ray(cc) +
    sum_mie * k_mie * phase_mie(uMieG, c, cc);

  return uExposure * scatter;
}

// Ordered (Bayer) dither thresholds, built recursively so no const array
// lookup is needed -- WebGL 1 can't index an array by a non-constant, and this
// closed form is the standard workaround. Returns a per-pixel threshold in
// [0,1) spread evenly enough that quantizing against it yields the classic
// uniform crosshatch rather than clumped noise.
float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}

float bayer8(vec2 a) {
  return bayer2(0.25 * a) * 0.0625 + bayer2(0.5 * a) * 0.25 + bayer2(a);
}

mat3 rot3xy(vec2 angle) {
  vec2 c = cos(angle);
  vec2 s = sin(angle);

  return mat3(
    c.y,       0.0,  -s.y,
    s.y * s.x, c.x,  c.y * s.x,
    s.y * c.x, -s.x, c.y * c.x
  );
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 center = vec2(iResolution.x * uCenterX, iResolution.y * uCenterY);
  vec2 xy = fragCoord - center;

  // Gentle continuous morph. Displacing the sampling coordinate before the
  // ray direction is built warps the sphere itself (silhouette, atmosphere
  // band and terminator all together) rather than smearing a finished image,
  // so it reads as the globe breathing instead of a post-process wobble.
  //
  // Two sine pairs per axis at unrelated frequencies and drift rates: a
  // single sine would visibly slosh back and forth, whereas summing
  // incommensurate ones gives a long, non-repeating wander. Each axis is
  // driven by the *other* axis' coordinate, which shears rather than merely
  // translating. Once running it never settles or loops back.
  //
  // Held off until the intro animations are done, then eased in over ten
  // seconds. Both start times are derived rather than configured: the light
  // sweep finishes when iTime * uLightSpeed reaches 1 (see lightProgress
  // below), and the ignition ramp finishes at uIntroDuration, so waiting for
  // whichever lands later keeps this correct when either is retuned. A zero
  // light speed never completes a sweep, so there's nothing to wait on.
  // Ramping the amplitude (rather than starting the clock late) means the
  // motion arrives already mid-phase and eases up from nothing, instead of
  // snapping on from a static warp field.
  float lightSweepEnd = abs(uLightSpeed) > 0.0 ? 1.0 / abs(uLightSpeed) : 0.0;
  float warpStart = max(lightSweepEnd, uIntroDuration);
  float warpGate = smoothstep(warpStart, warpStart + 10.0, iTime);

  if (uWarpAmount > 0.0 && warpGate > 0.0) {
    vec2 wp = fragCoord / iResolution.y * 6.2831 * uWarpScale;
    float wt = iTime * uWarpSpeed;
    vec2 warp = vec2(
      sin(wp.y + wt) + 0.5 * sin(wp.y * 2.3 - wt * 1.3),
      sin(wp.x * 0.9 - wt * 0.8) + 0.5 * sin(wp.x * 1.7 + wt * 1.1)
    );
    xy += warp * uWarpAmount * warpGate;
  }

  float cot_half_fov = tan(radians(90.0 - uFov * 0.5));
  float zdist = iResolution.y * 0.5 * cot_half_fov;
  vec3 dir = normalize(vec3(xy, -zdist));

  vec3 eye = vec3(0.0, 0.0, uEyeDistance);

  // Eases from uLightYawStart to uLightYawEnd exactly once and holds at the
  // end -- clamp() stops lightProgress at 1 once iTime * uLightSpeed
  // reaches it instead of it wrapping/reversing, and smoothstep just eases
  // the approach/settle instead of a constant-speed linear sweep.
  float lightPitchRad = radians(uLightPitch);
  float lightProgress = smoothstep(0.0, 1.0, clamp(iTime * uLightSpeed, 0.0, 1.0));
  float lightYawRad = radians(mix(uLightYawStart, uLightYawEnd, lightProgress));
  vec3 l = normalize(rot3xy(vec2(lightPitchRad, lightYawRad)) * vec3(0.0, 0.0, 1.0));

  float R = uPlanetRadius + uAtmosphereThickness;
  vec2 e = ray_vs_sphere(eye, dir, R);
  if (e.x > e.y) {
    // Fully transparent instead of a flat fill color -- the real page
    // background (whatever it is) shows straight through with zero risk
    // of a token-color mismatch, and there's no hard geometric edge since
    // the alpha below fades with the scattering brightness itself.
    fragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  vec2 f = ray_vs_sphere(eye, dir, uPlanetRadius);
  e.y = min(e.y, f.x);

  // Intro ignition: ramps the scattering brightness up from zero over the
  // first uIntroDuration seconds, so the globe visibly lights up rather than
  // popping in fully lit. Alpha below is derived from this same brightness,
  // so the whole effect fades in from fully transparent for free.
  // uIntroDuration of 0 disables it, and the reduced-motion static frame is
  // drawn well past any duration, so it renders already-lit.
  float intro = uIntroDuration <= 0.0
    ? 1.0
    : smoothstep(0.0, 1.0, clamp(iTime / uIntroDuration, 0.0, 1.0));

  vec3 I = in_scatter(eye, dir, e, l) * intro;
  vec3 col = clamp(pow(max(I, vec3(0.0)), vec3(1.0 / uGamma)), 0.0, 1.0);

  // Alpha tracks the scattering brightness itself, so the glow fades
  // smoothly to fully transparent at the sphere's silhouette instead of
  // cutting to a flat opaque disc against the void.
  float alpha = clamp(max(max(col.r, col.g), col.b) * 1.6, 0.0, 1.0);

  // Light mode composites here rather than via CSS mix-blend-mode. Every
  // ancestor PageSection sets isolation: isolate, which makes the hero an
  // isolated blending group -- a CSS blend mode on this canvas resolves
  // against that group's transparent backdrop instead of the actual page
  // background, silently collapsing back into plain alpha-over compositing.
  //
  // Pure screen against a near-white page is mathematically almost a no-op:
  // with (1 - pageColor) ~= 0.02, the screened result can never sit more than
  // ~2% away from white, so the effect vanishes no matter how saturated the
  // scattering is. Hence the two-step: boost saturation first (so whatever
  // luminance we do spend reads as colored light instead of grey haze), then
  // mix only partway toward the screened result. uLightScreenAmount = 1 is
  // pure screen (brightest, zero added darkness, near-invisible) and 0 is a
  // straight saturated composite (most color, some luminance drop).
  if (uScreenBlend > 0.5) {
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = clamp(mix(vec3(luma), col, uLightSaturation), 0.0, 1.0);
    vec3 screened = 1.0 - (1.0 - uPageColor) * (1.0 - col);
    col = mix(col, screened, uLightScreenAmount);
  }

  // Dither to break up 8-bit banding. This gradient is extremely shallow (a
  // near-black falloff spread over hundreds of pixels), so consecutive pixels
  // round to the same byte for long runs and the transitions show up as hard
  // concentric contours. Noise pushes pixels either side of each rounding
  // boundary, turning the contour into a gradient. Alpha gets the same
  // treatment with a decorrelated offset -- it's derived from the same
  // brightness, so dithering only the color would leave the alpha steps
  // banding on their own.
  //
  // uDitherAmount is in quantization steps: 1.0 is the +/- half-LSB that
  // exactly cancels banding while staying invisible, and larger values push
  // past correction into deliberate visible grain.
  // Snapping the coordinate to a grid makes each sample cover an
  // uDitherScale-sized block of device pixels, so the pattern gets chunkier
  // rather than denser. Note this is in *device* pixels, so on a HiDPI
  // display a scale of 1 is finer than one CSS pixel.
  vec2 ditherCoord = floor(fragCoord / max(uDitherScale, 1.0));

  // Quantizing time advances the pattern a fixed number of times per second
  // instead of every rendered frame, which is what makes it read as grain
  // running at a chosen rate. 0 freezes it into a static pattern.
  float ditherTime = floor(iTime * uDitherSpeed);

  if (uDitherMode > 0.5) {
    // Ordered/Bayer: posterize to uPosterizeLevels tonal bands, offsetting
    // each pixel by its Bayer threshold before the floor(). That threshold
    // is what turns the hard band boundaries into the classic crosshatch --
    // pixels near a boundary tip to either side in a regular pattern, so the
    // eye reads intermediate tones that the reduced palette can't represent.
    float levels = max(uPosterizeLevels, 2.0) - 1.0;
    float threshold = bayer8(ditherCoord + ditherTime);

    col = clamp(floor(col * levels + threshold) / levels, 0.0, 1.0);
    // Alpha is posterized against the same threshold so it steps in lockstep
    // with the color. This is what makes the texture visible at all: the
    // effect fades out via alpha, so leaving alpha smooth would blur the
    // crosshatch away exactly where it should be most legible.
    alpha = clamp(floor(alpha * levels + threshold) / levels, 0.0, 1.0);
  } else if (uDitherAmount > 0.0) {
    float noise = fract(
      sin(dot(ditherCoord + ditherTime, vec2(12.9898, 78.233))) * 43758.5453
    );
    float noiseAlpha = fract(
      sin(dot(ditherCoord + ditherTime, vec2(63.7264, 10.873))) * 32416.1873
    );
    float ditherStep = uDitherAmount / 255.0;
    col += (noise - 0.5) * ditherStep;
    // Scaled by alpha so grain fades out with the effect instead of
    // speckling the fully transparent void around it.
    alpha += (noiseAlpha - 0.5) * ditherStep * alpha;
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
}

void main() {
  mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

interface AtmosphereShaderBackgroundProps extends AtmosphereSettings {
  frameRate?: number;
}

function AtmosphereShaderBackground({
  planetRadius,
  atmosphereThickness,
  fov,
  eyeDistance,
  centerX,
  centerY,
  lightPitch,
  lightYawStart,
  lightYawEnd,
  lightSpeed,
  rayleighR,
  rayleighG,
  rayleighB,
  rayleighHeight,
  mieStrength,
  mieExtinction,
  mieHeight,
  mieG,
  exposure,
  gamma,
  outScatterSteps,
  inScatterSteps,
  lightSaturation,
  lightScreenAmount,
  introDuration,
  ditherMode,
  ditherAmount,
  ditherScale,
  ditherSpeed,
  posterizeLevels,
  warpAmount,
  warpScale,
  warpSpeed,
  intensity,
  paused,
  frameRate = 30,
}: AtmosphereShaderBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const animationControlRef = useRef<{
    start: () => void;
    stop: () => void;
  } | null>(null);

  // Explicitly typed rather than inferred: every numeric field here is fed
  // straight to gl.uniform1f, and an omitted field silently becomes
  // undefined -> NaN -> a solid black canvas. Annotating it makes forgetting
  // to thread a new setting through a compile error instead.
  const settingsRef = useRef<Omit<AtmosphereSettings, "intensity">>({
    planetRadius,
    atmosphereThickness,
    fov,
    eyeDistance,
    centerX,
    centerY,
    lightPitch,
    lightYawStart,
    lightYawEnd,
    lightSpeed,
    rayleighR,
    rayleighG,
    rayleighB,
    rayleighHeight,
    mieStrength,
    mieExtinction,
    mieHeight,
    mieG,
    exposure,
    gamma,
    outScatterSteps,
    inScatterSteps,
    lightSaturation,
    lightScreenAmount,
    introDuration,
    ditherMode,
    ditherAmount,
    ditherScale,
    ditherSpeed,
    posterizeLevels,
    warpAmount,
    warpScale,
    warpSpeed,
    paused,
  });
  useEffect(() => {
    settingsRef.current = {
      planetRadius,
      atmosphereThickness,
      fov,
      eyeDistance,
      centerX,
      centerY,
      lightPitch,
    lightYawStart,
    lightYawEnd,
    lightSpeed,
      rayleighR,
      rayleighG,
      rayleighB,
      rayleighHeight,
      mieStrength,
      mieExtinction,
      mieHeight,
      mieG,
      exposure,
      gamma,
      outScatterSteps,
      inScatterSteps,
      lightSaturation,
      lightScreenAmount,
      introDuration,
      ditherMode,
      ditherAmount,
      ditherScale,
      ditherSpeed,
      posterizeLevels,
      warpAmount,
      warpScale,
      warpSpeed,
      paused,
    };
  }, [
    planetRadius,
    atmosphereThickness,
    fov,
    eyeDistance,
    centerX,
    centerY,
    lightPitch,
    lightYawStart,
    lightYawEnd,
    lightSpeed,
    rayleighR,
    rayleighG,
    rayleighB,
    rayleighHeight,
    mieStrength,
    mieExtinction,
    mieHeight,
    mieG,
    exposure,
    gamma,
    outScatterSteps,
    inScatterSteps,
    lightSaturation,
    lightScreenAmount,
    introDuration,
    ditherMode,
    ditherAmount,
    ditherScale,
    ditherSpeed,
    posterizeLevels,
    warpAmount,
    warpScale,
    warpSpeed,
    paused,
  ]);

  useEffect(() => {
    const canvasRaw = canvasRef.current;
    const containerRaw = containerRef.current;
    if (!canvasRaw || !containerRaw) return;
    const canvas: HTMLCanvasElement = canvasRaw;
    const container: HTMLElement = containerRaw;

    // alpha: true (unlike the other two shaders) -- void/background pixels
    // are rendered fully transparent below, so the real page background
    // shows straight through with no risk of a token-color mismatch or a
    // hard geometric edge at the sphere's silhouette.
    //
    // premultipliedAlpha: false because the fragment shader outputs
    // straight (unpremultiplied) color -- `vec4(col, alpha)`, not
    // `vec4(col * alpha, alpha)`. WebGL's default of `true` tells the
    // browser to treat the RGB as already alpha-multiplied when
    // compositing the canvas onto the page; since ours isn't, that
    // mismatch was double-darkening every semi-transparent pixel, which is
    // why `screen` blend mode still looked dark instead of brightening-only.
    const glRaw = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
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

    const vs = compileShader(gl.VERTEX_SHADER, atmosphereVertexShader);
    const fs = compileShader(gl.FRAGMENT_SHADER, atmosphereFragmentShader);
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
    const uPlanetRadius = gl.getUniformLocation(program, "uPlanetRadius");
    const uAtmosphereThickness = gl.getUniformLocation(
      program,
      "uAtmosphereThickness",
    );
    const uFov = gl.getUniformLocation(program, "uFov");
    const uEyeDistance = gl.getUniformLocation(program, "uEyeDistance");
    const uCenterX = gl.getUniformLocation(program, "uCenterX");
    const uCenterY = gl.getUniformLocation(program, "uCenterY");
    const uLightPitch = gl.getUniformLocation(program, "uLightPitch");
    const uLightYawStart = gl.getUniformLocation(program, "uLightYawStart");
    const uLightYawEnd = gl.getUniformLocation(program, "uLightYawEnd");
    const uLightSpeed = gl.getUniformLocation(program, "uLightSpeed");
    const uRayleighColor = gl.getUniformLocation(program, "uRayleighColor");
    const uRayleighHeight = gl.getUniformLocation(program, "uRayleighHeight");
    const uMieStrength = gl.getUniformLocation(program, "uMieStrength");
    const uMieExtinction = gl.getUniformLocation(program, "uMieExtinction");
    const uMieHeight = gl.getUniformLocation(program, "uMieHeight");
    const uMieG = gl.getUniformLocation(program, "uMieG");
    const uExposure = gl.getUniformLocation(program, "uExposure");
    const uGamma = gl.getUniformLocation(program, "uGamma");
    const uOutSteps = gl.getUniformLocation(program, "uOutSteps");
    const uInSteps = gl.getUniformLocation(program, "uInSteps");
    const uPageColor = gl.getUniformLocation(program, "uPageColor");
    const uScreenBlend = gl.getUniformLocation(program, "uScreenBlend");
    const uLightSaturation = gl.getUniformLocation(program, "uLightSaturation");
    const uLightScreenAmount = gl.getUniformLocation(
      program,
      "uLightScreenAmount",
    );
    const uIntroDuration = gl.getUniformLocation(program, "uIntroDuration");
    const uWarpAmount = gl.getUniformLocation(program, "uWarpAmount");
    const uWarpScale = gl.getUniformLocation(program, "uWarpScale");
    const uWarpSpeed = gl.getUniformLocation(program, "uWarpSpeed");
    const uDitherAmount = gl.getUniformLocation(program, "uDitherAmount");
    const uDitherScale = gl.getUniformLocation(program, "uDitherScale");
    const uDitherSpeed = gl.getUniformLocation(program, "uDitherSpeed");
    const uDitherMode = gl.getUniformLocation(program, "uDitherMode");
    const uPosterizeLevels = gl.getUniformLocation(program, "uPosterizeLevels");

    const reducedMotionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    let reducedMotion = reducedMotionQuery?.matches ?? false;

    let dpr = 1;

    function draw(timeSeconds: number) {
      gl.uniform1f(uTime, timeSeconds);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uPlanetRadius, settingsRef.current.planetRadius);
      gl.uniform1f(
        uAtmosphereThickness,
        settingsRef.current.atmosphereThickness,
      );
      gl.uniform1f(uFov, settingsRef.current.fov);
      gl.uniform1f(uEyeDistance, settingsRef.current.eyeDistance);
      gl.uniform1f(uCenterX, settingsRef.current.centerX);
      gl.uniform1f(uCenterY, settingsRef.current.centerY);
      gl.uniform1f(uLightPitch, settingsRef.current.lightPitch);
      gl.uniform1f(uLightYawStart, settingsRef.current.lightYawStart);
      gl.uniform1f(uLightYawEnd, settingsRef.current.lightYawEnd);
      gl.uniform1f(uLightSpeed, settingsRef.current.lightSpeed);
      gl.uniform3f(
        uRayleighColor,
        settingsRef.current.rayleighR,
        settingsRef.current.rayleighG,
        settingsRef.current.rayleighB,
      );
      gl.uniform1f(uRayleighHeight, settingsRef.current.rayleighHeight);
      gl.uniform1f(uMieStrength, settingsRef.current.mieStrength);
      gl.uniform1f(uMieExtinction, settingsRef.current.mieExtinction);
      gl.uniform1f(uMieHeight, settingsRef.current.mieHeight);
      gl.uniform1f(uMieG, settingsRef.current.mieG);
      gl.uniform1f(uExposure, settingsRef.current.exposure);
      gl.uniform1f(uGamma, settingsRef.current.gamma);
      gl.uniform1f(uOutSteps, settingsRef.current.outScatterSteps);
      gl.uniform1f(uInSteps, settingsRef.current.inScatterSteps);
      gl.uniform3f(uPageColor, pageColor[0], pageColor[1], pageColor[2]);
      gl.uniform1f(uScreenBlend, dark ? 0 : 1);
      gl.uniform1f(uLightSaturation, settingsRef.current.lightSaturation);
      gl.uniform1f(
        uLightScreenAmount,
        settingsRef.current.lightScreenAmount,
      );
      gl.uniform1f(uIntroDuration, settingsRef.current.introDuration);
      gl.uniform1f(uWarpAmount, settingsRef.current.warpAmount);
      gl.uniform1f(uWarpScale, settingsRef.current.warpScale);
      gl.uniform1f(uWarpSpeed, settingsRef.current.warpSpeed);
      gl.uniform1f(uDitherAmount, settingsRef.current.ditherAmount);
      gl.uniform1f(uDitherScale, settingsRef.current.ditherScale);
      gl.uniform1f(uDitherSpeed, settingsRef.current.ditherSpeed);
      gl.uniform1f(
        uDitherMode,
        settingsRef.current.ditherMode === "ordered" ? 1 : 0,
      );
      gl.uniform1f(uPosterizeLevels, settingsRef.current.posterizeLevels);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // Rendered into a width/height-swapped buffer, then CSS-rotated 90deg
    // clockwise (see the canvas's inline transform below) -- swapping the
    // source buffer's own dimensions before that rotate() is what lets the
    // rotated result land back on the container's exact WxH box with zero
    // stretching or cropping.
    function resize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      dpr = Math.min(window.devicePixelRatio, 1.5);
      canvas.width = h * dpr;
      canvas.height = w * dpr;
      canvas.style.width = h + "px";
      canvas.style.height = w + "px";
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    resize();
    window.addEventListener("resize", resize);

    function readDarkMode() {
      return (
        document.documentElement.classList.contains("dark") ||
        document.documentElement.getAttribute("data-theme") === "dark"
      );
    }

    function readPageColor(): [number, number, number] {
      const raw = getComputedStyle(container)
        .getPropertyValue("--b-bg-page")
        .trim();
      return hexToRgb01(raw || "#0a0a0a");
    }

    // Dark mode keeps plain alpha-over compositing (the void is already
    // near-black, so the scattering colors read as light against space).
    // Light mode screens against the page color instead -- see the shader's
    // uScreenBlend branch for why this can't be a CSS blend mode.
    let dark = readDarkMode();
    let pageColor = readPageColor();

    function applyTheme() {
      dark = readDarkMode();
      pageColor = readPageColor();
    }

    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, {
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
        draw(reducedMotionStaticTime);
      } else {
        startAnimation();
      }
    }

    draw(reducedMotion ? reducedMotionStaticTime : 0);
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
      themeObserver.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener("resize", resize);
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
        overflow: "hidden",
      }}
    >
      {/* Rendered into a width/height-swapped buffer (see resize() above)
          then rotated 90deg clockwise here -- centering + rotating a
          swapped-dimension box lands it back on the container's exact
          footprint with no stretching or cropping.

          `opacity` lives on this canvas itself rather than the wrapper div:
          an *ancestor* with opacity < 1 forces an isolated blending group,
          so this element's `mix-blend-mode: screen` (set in applyBlendMode
          above) would only ever see a transparent backdrop instead of the
          real page background -- silently degrading into plain alpha-over
          compositing, which is why light mode still looked like it was
          darkening instead of only brightening. Same-element opacity +
          blend-mode doesn't have that problem: the blend resolves against
          the true backdrop first, then the result fades by `opacity`. */}
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%) rotate(90deg)",
          opacity: intensity,
        }}
      />
    </div>
  );
}

export interface HeroShaderBackgroundProps {
  variant: HeroShaderVariant;
  constellation: HeroShaderSettings;
  ribbonField: RibbonFieldSettings;
  atmosphere: AtmosphereSettings;
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
  atmosphere,
  frameRate,
}: HeroShaderBackgroundProps) {
  if (variant === "ribbon-field") {
    return (
      <RibbonFieldShaderBackground {...ribbonField} frameRate={frameRate} />
    );
  }
  if (variant === "atmosphere") {
    return (
      <AtmosphereShaderBackground {...atmosphere} frameRate={frameRate} />
    );
  }
  return (
    <ConstellationShaderBackground {...constellation} frameRate={frameRate} />
  );
}
