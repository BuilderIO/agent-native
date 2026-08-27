import { useEffect, useRef } from "react";

const vertexShader = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Gentle travelling waves of light, domain-warped with hash noise, attenuated
// by a radial falloff around the focus point (which drifts toward the pointer)
// and resolved through a Ben-Day
// halftone dot grid. The falloff is applied to the tone *before* dot radius is
// derived, which is what makes the dot sizes ring outward from the bright
// centre instead of merely striping along the flow direction. Strictly
// two-color (bg/fg, both read from brand tokens) so it is greyscale by
// construction in both themes.
const fragmentShader = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform vec3 uPointer;
uniform vec3 uFgColor;
uniform vec3 uBgColor;

#define S(a, b, t) smoothstep(a, b, t)

const float WAVE_COUNT = 5.;
const float WAVE_SCALE = 5.5;
const float FLOW_ANGLE = 119.;
const float WARP = 0.35;
const float SPEED = 0.65;
// How far the bright centre travels toward the pointer: 0 pins it to FOCUS, 1
// parks it exactly under the cursor. Short of 1 so the glow reads as drawn
// toward the mouse rather than attached to it.
const float FOCUS_FOLLOW = 0.65;
const vec2 FOCUS = vec2(0., -0.05);
const float SPREAD = 1.2;
const float DOT_DENSITY = 131.;
const float DOT_SCALE = 1.35;
const float GLOW = 1.;
const float BRIGHTNESS = 3.;
const float SEED = 56.;
const float VIGNETTE = 1.7;
// Exponent shaping the tonal distribution: >1 crushes the bright areas inward.
const float TONE_GAMMA = 2.6;
const float FADE_IN_SECONDS = 0.7;

float N21(vec2 p) {
  p += SEED;
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

// Smooth travelling wave field in [0,1], kept deliberately continuous so dot
// radius varies as a gradient rather than snapping to visible steps.
float waveField(vec2 p, float t) {
  float angle = radians(FLOW_ANGLE);
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 perp = vec2(-dir.y, dir.x);

  // Domain-warping the coordinate (rather than adding noise to the result)
  // bends the wavefronts themselves, so the bands undulate organically
  // instead of staying parallel rulings with noise laid over them.
  // Drifting the warp field faster than the waves themselves is what makes
  // the pattern evolve rather than slide past as a rigid texture.
  vec2 warpUv = p * 1.1 + vec2(t * 0.14, t * 0.1);
  float n1 = valueNoise(warpUv);
  float n2 = valueNoise(warpUv + 5.2);
  vec2 warped = p + (vec2(n1, n2) - 0.5) * WARP;

  float along = dot(warped, dir);
  float across = dot(warped, perp);

  // Summed sines at incommensurate frequencies and drift rates. Each octave
  // is cross-modulated by the perpendicular axis so wavefronts curve along
  // their length, and amplitude falls off per octave so the first wave sets
  // the broad shape while later ones only add fine detail.
  float field = 0.;
  float weight = 0.;
  for (float i = 0.; i < WAVE_COUNT; i += 1.) {
    float amp = 1. / (1. + i * 0.8);
    float freq = WAVE_SCALE * (1. + i * 0.55);
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
  float t = iTime * SPEED;

  // Ben-Day halftone grid. The wave field is sampled once per cell at the
  // cell's center rather than per pixel, which is what keeps each dot a
  // clean uniform disc -- sampling per pixel would let the tone vary across
  // a single dot and smear its edge.
  float cellSize = 1. / DOT_DENSITY;
  vec2 cell = floor(uv / cellSize);
  vec2 cellCenter = (cell + 0.5) * cellSize;
  vec2 cellUv = (uv - cellCenter) / cellSize;

  float tone = waveField(cellCenter, t);

  // Radial falloff around the focus point, which is what puts a bright centre
  // in the field at all. The focus leans toward the pointer rather than
  // snapping to it, and uPointer.z eases 0 -> 1 on enter and back on leave, so
  // the bright area drifts after the mouse and settles back to FOCUS when the
  // mouse is gone. Moving the focus rather than warping each cell is what
  // makes the interaction legible: the composition follows the cursor instead
  // of the pattern smearing in one small neighbourhood.
  vec2 focus = FOCUS + (pointerUv - FOCUS) * FOCUS_FOLLOW * uPointer.z;
  float distFromFocus = length(cellCenter - focus) / SPREAD;
  tone *= exp(-1.6 * distFromFocus * distFromFocus);
  tone = pow(clamp(tone, 0., 1.), TONE_GAMMA);

  // sqrt() because the eye reads a dot's *area* as its brightness, and area
  // grows with the square of the radius -- taking the root makes apparent
  // tone track the field linearly instead of darkening too fast.
  float radius = sqrt(tone) * 0.5 * DOT_SCALE;

  // One device pixel expressed in cell-local units, so the dot edge gets the
  // same visual softness regardless of grid density or resolution.
  float px = (1. / iResolution.y) / cellSize;
  float edge = max(px * 1.2, 0.004);

  float dist = length(cellUv);
  float dotMask = 1. - S(radius - edge, radius + edge, dist);

  // Soft halo just outside each dot, scaled by the continuous tone so the
  // grid sits on a gentle wash instead of reading as flat paper cutouts.
  float glowTerm = (1. - S(radius, radius + GLOW * 0.9, dist)) * GLOW * tone;

  float value = clamp(dotMask + glowTerm * 0.6, 0., 1.);

  value *= clamp(1. - dot(uv, uv) * VIGNETTE, 0., 1.);
  value *= S(0., FADE_IN_SECONDS, iTime);

  // Extrapolating away from bg along the fg/bg contrast direction (rather
  // than mixing toward literal white) keeps brightness correct in both
  // themes: in dark mode fg is lighter than bg so it pushes toward white, in
  // light mode fg is darker so it pushes toward black. Scaling by tone means
  // dots nearer the focus pull further than dim outer ones, which is what
  // creates the bright-center/dim-edge separation.
  vec3 lit = mix(uBgColor, uFgColor, value);
  lit += (uFgColor - uBgColor) * value * tone * (BRIGHTNESS - 1.);

  fragColor = vec4(clamp(lit, 0., 1.), 1.);
}

void main() {
  mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

// Per-frame approach fractions at the 30fps draw budget below, so ~0.12 is a
// ~250ms settle. Deliberately slow: the lag is the "floating toward the mouse"
// feel, and anything fast enough to keep up reads as the glow being pinned to
// the cursor.
const POINTER_POSITION_EASING = 0.12;
const POINTER_STRENGTH_EASING = 0.08;

// Module scope, not per-mount: the shader clock (and with it the intro fade)
// has to survive a remount, otherwise anything that re-runs the setup effect --
// HMR, a route revalidation -- replays the fade and it reads as the field
// fading in twice in a row.
let shaderEpoch = 0;

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

export interface HeroShaderBackgroundProps {
  frameRate?: number;
}

// Sits behind the page-grid's column-divider lines inside the hero's
// `PageSection` (which is `position: relative`, so `zIndex: -1` here stays
// scoped to that section instead of dropping behind the whole page).
export function HeroShaderBackground({
  frameRate = 30,
}: HeroShaderBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

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
    const uPointer = gl.getUniformLocation(program, "uPointer");
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
    // so reading them here keeps the shader theme-correct.
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
      pointerX += (targetX - pointerX) * POINTER_POSITION_EASING;
      pointerY += (targetY - pointerY) * POINTER_POSITION_EASING;
      pointerStrength +=
        (targetStrength - pointerStrength) * POINTER_STRENGTH_EASING;
      if (pointerStrength < 0.001 && targetStrength === 0) {
        pointerStrength = 0;
      }
    }

    function draw(timeSeconds: number, allowPointer = !reducedMotion) {
      easePointer(allowPointer);
      gl.uniform1f(uTime, timeSeconds);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform3f(uPointer, pointerX, pointerY, pointerStrength);
      gl.uniform3f(uFgColor, fgColor[0], fgColor[1], fgColor[2]);
      gl.uniform3f(uBgColor, bgColor[0], bgColor[1], bgColor[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function resize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      dpr = Math.min(window.devicePixelRatio, 1.5);
      // Drawing-buffer sizing, not styling: the buffer is in device pixels and
      // the CSS box is in layout pixels, so neither has a Tailwind equivalent.
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

    if (!shaderEpoch) shaderEpoch = performance.now();
    const startTime = shaderEpoch;
    let lastFrame = 0;
    const frameBudget = 1000 / Math.max(1, frameRate);
    const reducedMotionStaticTime = 20;

    function render(now: number) {
      if (reducedMotion || !isVisible) {
        rafRef.current = 0;
        return;
      }
      rafRef.current = requestAnimationFrame(render);

      if (now - lastFrame < frameBudget) return;
      lastFrame = now;

      draw((now - startTime) * 0.001);
    }

    function startAnimation() {
      if (!rafRef.current && !reducedMotion && isVisible) {
        rafRef.current = requestAnimationFrame(render);
      }
    }

    function stopAnimation() {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    }

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

    draw(
      reducedMotion
        ? reducedMotionStaticTime
        : (performance.now() - startTime) * 0.001,
      !reducedMotion,
    );
    if (reducedMotionQuery) {
      reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
    }
    if (!reducedMotion) startAnimation();

    return () => {
      stopAnimation();
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

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="absolute inset-0 z-[-1] opacity-[var(--b-hero-shader-opacity)]"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
