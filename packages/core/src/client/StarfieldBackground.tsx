import { useEffect, useRef } from "react";

const vertexShader = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Gentle travelling waves of light, domain-warped with hash noise, attenuated
// by a radial falloff around the focus point and resolved through a Ben-Day
// halftone dot grid. Keep this in the shared component so public app pages can
// use the same WebGL field as the docs homepage.
const fragmentShader = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform vec3 uPointer;
uniform vec3 uFgColor;
uniform vec3 uBgColor;
uniform float uBrightness;

#define S(a, b, t) smoothstep(a, b, t)

const float WAVE_COUNT = 5.;
const float WAVE_SCALE = 5.5;
const float FLOW_ANGLE = 119.;
const float WARP = 0.35;
const float SPEED = 0.65;
const float FOCUS_FOLLOW = 0.65;
const vec2 FOCUS = vec2(0., -0.05);
const float SPREAD = 1.2;
const float DOT_DENSITY = 131.;
const float DOT_SCALE = 1.35;
const float GLOW = 1.;
const float SEED = 56.;
const float VIGNETTE = 1.7;
const float TONE_GAMMA = 2.6;
const float FADE_IN_SECONDS = 0.7;

float N21(vec2 p) {
  p += SEED;
  vec3 a = fract(vec3(p.xyx) * vec3(213.897, 653.453, 253.098));
  a += dot(a, a.yzx + 79.76);
  return fract((a.x + a.y) * a.z);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float a = N21(cell);
  float b = N21(cell + vec2(1., 0.));
  float c = N21(cell + vec2(0., 1.));
  float d = N21(cell + vec2(1., 1.));
  vec2 u = f * f * (3. - 2. * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1. - u.x) + (d - b) * u.x * u.y;
}

float waveField(vec2 p, float t) {
  float angle = radians(FLOW_ANGLE);
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 warpUv = p * 1.1 + vec2(t * 0.14, t * 0.1);
  float n1 = valueNoise(warpUv);
  float n2 = valueNoise(warpUv + 5.2);
  vec2 warped = p + (vec2(n1, n2) - 0.5) * WARP;
  float along = dot(warped, dir);
  float across = dot(warped, perp);
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
  float cellSize = 1. / DOT_DENSITY;
  vec2 cell = floor(uv / cellSize);
  vec2 cellCenter = (cell + 0.5) * cellSize;
  vec2 cellUv = (uv - cellCenter) / cellSize;
  float tone = waveField(cellCenter, t);
  vec2 focus = FOCUS + (pointerUv - FOCUS) * FOCUS_FOLLOW * uPointer.z;
  float distFromFocus = length(cellCenter - focus) / SPREAD;
  tone *= exp(-1.6 * distFromFocus * distFromFocus);
  tone = pow(clamp(tone, 0., 1.), TONE_GAMMA);
  float radius = sqrt(tone) * 0.5 * DOT_SCALE;
  float px = (1. / iResolution.y) / cellSize;
  float edge = max(px * 1.2, 0.004);
  float dist = length(cellUv);
  float dotMask = 1. - S(radius - edge, radius + edge, dist);
  float glowTerm = (1. - S(radius, radius + GLOW * 0.9, dist)) * GLOW * tone;
  float value = clamp(dotMask + glowTerm * 0.6, 0., 1.);
  value *= clamp(1. - dot(uv, uv) * VIGNETTE, 0., 1.);
  value *= S(0., FADE_IN_SECONDS, iTime);
  vec3 lit = mix(uBgColor, uFgColor, value);
  lit += (uFgColor - uBgColor) * value * tone * (uBrightness - 1.);
  fragColor = vec4(clamp(lit, 0., 1.), 1.);
}

void main() {
  mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

let shaderEpoch = 0;

export interface StarfieldBackgroundProps {
  className?: string;
  frameRate?: number;
}

export function StarfieldBackground({
  className = "",
  frameRate = 30,
}: StarfieldBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvasRaw = canvasRef.current;
    const containerRaw = containerRef.current;
    if (!canvasRaw || !containerRaw) return;
    // Non-null assertions: null branches exited above and these are
    // referenced inside closures where TypeScript loses the narrowing.
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
    const pos = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, "iTime");
    const uRes = gl.getUniformLocation(program, "iResolution");
    const uPointer = gl.getUniformLocation(program, "uPointer");
    const uFgColor = gl.getUniformLocation(program, "uFgColor");
    const uBgColor = gl.getUniformLocation(program, "uBgColor");
    const uBrightness = gl.getUniformLocation(program, "uBrightness");
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
      const root = document.documentElement;
      if (root.classList.contains("dark")) return true;
      if (root.classList.contains("light")) return false;
      return root.getAttribute("data-theme") === "dark";
    }

    function readTheme() {
      const dark = readDarkMode();
      return dark
        ? {
            bg: [10 / 255, 10 / 255, 10 / 255] as [number, number, number],
            fg: [174 / 255, 173 / 255, 172 / 255] as [number, number, number],
            brightness: 3,
          }
        : {
            bg: [250 / 255, 249 / 255, 245 / 255] as [number, number, number],
            fg: [0, 103 / 255, 127 / 255] as [number, number, number],
            brightness: 1.15,
          };
    }

    let theme = readTheme();

    function easePointer(allowPointer: boolean) {
      if (!allowPointer) {
        pointerStrength = 0;
        return;
      }
      pointerX += (targetX - pointerX) * 0.12;
      pointerY += (targetY - pointerY) * 0.12;
      pointerStrength += (targetStrength - pointerStrength) * 0.08;
      if (pointerStrength < 0.001 && targetStrength === 0) {
        pointerStrength = 0;
      }
    }

    function draw(timeSeconds: number, allowPointer = !reducedMotion) {
      easePointer(allowPointer);
      gl.uniform1f(uTime, timeSeconds);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform3f(uPointer, pointerX, pointerY, pointerStrength);
      gl.uniform3f(uFgColor, theme.fg[0], theme.fg[1], theme.fg[2]);
      gl.uniform3f(uBgColor, theme.bg[0], theme.bg[1], theme.bg[2]);
      gl.uniform1f(uBrightness, theme.brightness);
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
    window.addEventListener("mousemove", handlePointerMove, {
      passive: true,
    });
    document.addEventListener("pointerleave", fadePointer, {
      passive: true,
    });
    window.addEventListener("blur", fadePointer);

    const observer = new MutationObserver(() => {
      theme = readTheme();
      if (reducedMotion) draw(20, false);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    if (!shaderEpoch) shaderEpoch = performance.now();
    const startTime = shaderEpoch;
    let lastFrame = 0;
    const frameBudget = 1000 / Math.max(1, frameRate);
    const reducedMotionStaticTime = 20;

    function render(now: number) {
      if (reducedMotion) {
        rafRef.current = 0;
        return;
      }
      rafRef.current = requestAnimationFrame(render);

      if (now - lastFrame < frameBudget) return;
      lastFrame = now;

      const rect = container.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;

      draw((now - startTime) * 0.001);
    }

    function startAnimation() {
      if (!rafRef.current) {
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
      className={className}
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}
