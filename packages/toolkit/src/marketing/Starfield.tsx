import * as React from "react";

import { cn } from "../utils.js";

const VERTEX_SHADER_SOURCE = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform vec3 uPointer;
uniform vec3 uFgColor;
uniform vec3 uBgColor;
uniform float uBrightness;

#define S(a, b, t) smoothstep(a, b, t)

const float DOT_DENSITY = 220.;
const float DOT_SCALE = 0.9;
const float SPEED = 0.65;

float N21(vec2 p) {
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

float waveHeight(float x, float time) {
  float wave = sin(x * 1.7 + time * 0.25) * 0.06;
  wave += sin(x * 4.3 - time * 0.5) * 0.028;
  wave += sin(x * 10.5 + time * 0.8) * 0.012;
  wave += (valueNoise(vec2(x * 2.2 + time * 0.06, 4.)) - 0.5) * 0.05;
  return -0.21 + wave;
}

float waveProfile(vec2 point, vec2 pointerUv, float pointerStrength, float time) {
  float center = waveHeight(point.x, time);
  vec2 pointerDelta = (point - pointerUv) * vec2(0.75, 1.15);
  float pointerPull = pointerStrength * exp(-dot(pointerDelta, pointerDelta) * 2.8);
  center += (pointerUv.y - center) * pointerPull * 0.42;
  center += sin((point.x - pointerUv.x) * 8.0 + time) * pointerPull * 0.035;

  float distance = point.y - center;
  float profile = exp(-pow(distance / 0.065, 2.));
  profile += 0.48 * exp(-pow((distance + 0.09) / 0.12, 2.));
  profile += 0.28 * exp(-pow((distance - 0.14) / 0.16, 2.));
  profile *= 0.35 + 0.65 * valueNoise(vec2(point.x * 5.0 + time * 0.08, point.y * 14.0 - time * 0.04));
  return clamp(profile, 0., 1.);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - iResolution.xy * 0.5) / iResolution.y;
  vec2 pointerUv = (uPointer.xy - iResolution.xy * 0.5) / iResolution.y;
  float time = iTime * SPEED;

  float cellSize = 1. / DOT_DENSITY;
  vec2 cell = floor(uv / cellSize);
  vec2 jitter = vec2(
    N21(cell + vec2(11.7, 2.3)),
    N21(cell + vec2(-5.2, 8.1))
  ) - 0.5;
  vec2 cellCenter = (cell + 0.5 + jitter * 0.7) * cellSize;
  vec2 cellUv = (uv - cellCenter) / cellSize;

  float tone = waveProfile(cellCenter, pointerUv, uPointer.z, time);
  float grain = 0.38 + 0.62 * N21(cell + vec2(17.3, -4.1));
  float dropout = S(0.45, 0.95, grain + tone * 0.8);
  tone *= grain * dropout;

  float radius = sqrt(tone) * 0.5 * DOT_SCALE;
  float pixel = (1. / iResolution.y) / cellSize;
  float edge = max(pixel * 1.2, 0.004);
  float distance = length(cellUv);
  float dotMask = step(0.0001, tone) * (1. - S(radius - edge, radius + edge, distance));
  float glow = (1. - S(radius, radius + 0.7, distance)) * tone * 0.14;
  float value = clamp(dotMask + glow, 0., 1.);

  vec3 lit = mix(uBgColor, uFgColor, value);
  lit += (uFgColor - uBgColor) * value * tone * (uBrightness - 1.);
  fragColor = vec4(clamp(lit, 0., 1.), 1.);
}

void main() {
  mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

type ThemeColors = {
  bg: readonly [number, number, number];
  fg: readonly [number, number, number];
  brightness: number;
};

const DARK_THEME: ThemeColors = {
  bg: [0, 0, 0],
  fg: [174 / 255, 173 / 255, 172 / 255],
  brightness: 1.6,
};

const LIGHT_THEME: ThemeColors = {
  bg: [250 / 255, 249 / 255, 245 / 255],
  fg: [61 / 255, 61 / 255, 61 / 255],
  brightness: 1,
};

function isDarkMode(): boolean {
  const root = document.documentElement;
  if (root.classList.contains("dark")) return true;
  if (root.classList.contains("light")) return false;
  const dataTheme = root.getAttribute("data-theme");
  if (dataTheme === "dark") return true;
  if (dataTheme === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function createShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function initializeStarfield(
  canvas: HTMLCanvasElement,
  frameRate: number,
): () => void {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", { alpha: false, antialias: false });
  } catch {
    return () => undefined;
  }
  if (!gl) return () => undefined;

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    FRAGMENT_SHADER_SOURCE,
  );
  if (!vertexShader || !fragmentShader) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return () => undefined;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return () => undefined;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return () => undefined;
  }

  const buffer = gl.createBuffer();
  const position = gl.getAttribLocation(program, "position");
  if (!buffer || position < 0) {
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return () => undefined;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const timeUniform = gl.getUniformLocation(program, "iTime");
  const resolutionUniform = gl.getUniformLocation(program, "iResolution");
  const pointerUniform = gl.getUniformLocation(program, "uPointer");
  const fgColorUniform = gl.getUniformLocation(program, "uFgColor");
  const bgColorUniform = gl.getUniformLocation(program, "uBgColor");
  const brightnessUniform = gl.getUniformLocation(program, "uBrightness");
  const reducedMotionQuery = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  );
  let reducedMotion = reducedMotionQuery?.matches ?? false;
  let devicePixelRatio = 1;
  let hasPointer = false;
  let pointerX = 0;
  let pointerY = 0;
  let pointerStrength = 0;
  let targetX = 0;
  let targetY = 0;
  let targetStrength = 0;
  let animationFrame = 0;
  let theme = isDarkMode() ? DARK_THEME : LIGHT_THEME;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || window.innerWidth);
    const height = Math.max(1, rect.height || window.innerHeight);
    devicePixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.floor(width * devicePixelRatio);
    canvas.height = Math.floor(height * devicePixelRatio);
    gl?.viewport(0, 0, canvas.width, canvas.height);
    if (!hasPointer) {
      pointerX = targetX = canvas.width * 0.5;
      pointerY = targetY = canvas.height * 0.5;
    }
  };

  const onPointerMove = (event: Event) => {
    const mouseEvent = event as MouseEvent;
    const rect = canvas.getBoundingClientRect();
    const x = mouseEvent.clientX - rect.left;
    const y = mouseEvent.clientY - rect.top;
    hasPointer = true;
    targetX = x * devicePixelRatio;
    targetY = (rect.height - y) * devicePixelRatio;
    targetStrength =
      x >= 0 && x <= rect.width && y >= 0 && y <= rect.height ? 1 : 0;
  };
  const fadePointer = () => {
    targetStrength = 0;
  };
  const easePointer = (allowPointer: boolean) => {
    if (!allowPointer) {
      pointerStrength = 0;
      return;
    }
    pointerX += (targetX - pointerX) * 0.22;
    pointerY += (targetY - pointerY) * 0.22;
    pointerStrength += (targetStrength - pointerStrength) * 0.14;
    if (pointerStrength < 0.001 && targetStrength === 0) pointerStrength = 0;
  };
  const draw = (timeSeconds: number, allowPointer: boolean) => {
    easePointer(allowPointer && !reducedMotion);
    gl?.uniform1f(timeUniform, timeSeconds);
    gl?.uniform2f(resolutionUniform, canvas.width, canvas.height);
    gl?.uniform3f(pointerUniform, pointerX, pointerY, pointerStrength);
    gl?.uniform3f(fgColorUniform, theme.fg[0], theme.fg[1], theme.fg[2]);
    gl?.uniform3f(bgColorUniform, theme.bg[0], theme.bg[1], theme.bg[2]);
    gl?.uniform1f(brightnessUniform, theme.brightness);
    gl?.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const listenerOptions: AddEventListenerOptions = { passive: true };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", onPointerMove, listenerOptions);
  window.addEventListener("mousemove", onPointerMove, listenerOptions);
  document.addEventListener("pointerleave", fadePointer, listenerOptions);
  window.addEventListener("blur", fadePointer);

  let start = performance.now();
  let last = 0;
  const frameBudget = 1000 / Math.max(1, frameRate);
  const render = (now: number) => {
    if (reducedMotion) {
      animationFrame = 0;
      return;
    }
    animationFrame = requestAnimationFrame(render);
    if (now - last < frameBudget) return;
    last = now;
    draw((now - start) * 0.001, true);
  };
  const startAnimation = () => {
    if (!animationFrame) animationFrame = requestAnimationFrame(render);
  };
  const stopAnimation = () => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  };
  const onReducedMotionChange = () => {
    reducedMotion = reducedMotionQuery?.matches ?? false;
    if (reducedMotion) {
      stopAnimation();
      last = 0;
      draw(20, false);
    } else {
      start = performance.now();
      startAnimation();
    }
  };
  const themeObserver = new MutationObserver(() => {
    theme = isDarkMode() ? DARK_THEME : LIGHT_THEME;
    if (reducedMotion) draw(20, false);
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });

  resize();
  draw(reducedMotion ? 20 : 0, !reducedMotion);
  if (reducedMotionQuery) {
    if (reducedMotionQuery.addEventListener) {
      reducedMotionQuery.addEventListener("change", onReducedMotionChange);
    } else {
      reducedMotionQuery.addListener(onReducedMotionChange);
    }
  }
  if (!reducedMotion) startAnimation();

  return () => {
    stopAnimation();
    resizeObserver.disconnect();
    themeObserver.disconnect();
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", onPointerMove, listenerOptions);
    window.removeEventListener("mousemove", onPointerMove, listenerOptions);
    document.removeEventListener("pointerleave", fadePointer, listenerOptions);
    window.removeEventListener("blur", fadePointer);
    if (reducedMotionQuery) {
      if (reducedMotionQuery.removeEventListener) {
        reducedMotionQuery.removeEventListener("change", onReducedMotionChange);
      } else {
        reducedMotionQuery.removeListener(onReducedMotionChange);
      }
    }
    gl?.deleteBuffer(buffer);
    gl?.deleteProgram(program);
    gl?.deleteShader(vertexShader);
    gl?.deleteShader(fragmentShader);
  };
}

export interface StarfieldProps extends Omit<
  React.ComponentPropsWithoutRef<"canvas">,
  "children"
> {
  /** Keep the default id for compatibility with existing starfield styles. */
  id?: string;
  frameRate?: number;
}

export function Starfield({
  className,
  id = "starfield",
  frameRate = 30,
  ...props
}: StarfieldProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return initializeStarfield(canvas, frameRate);
  }, [frameRate]);

  return (
    <canvas
      {...props}
      ref={canvasRef}
      id={id}
      aria-hidden="true"
      className={cn(
        "pointer-events-none block h-full w-full opacity-[0.35] motion-reduce:opacity-[0.18]",
        className,
      )}
      data-agent-native-starfield
    />
  );
}
