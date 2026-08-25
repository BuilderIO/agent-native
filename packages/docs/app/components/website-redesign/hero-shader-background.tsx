import { useEffect, useRef } from "react";

import type { HeroShaderSettings } from "./hero-shader-settings";

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

export interface HeroShaderBackgroundProps extends HeroShaderSettings {
  frameRate?: number;
}

// Sits behind the page-grid's column-divider lines inside the hero's
// `PageSection` (which is `position: relative`, so `zIndex: -1` here stays
// scoped to that section instead of dropping behind the whole page).
export function HeroShaderBackground({
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
}: HeroShaderBackgroundProps) {
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
