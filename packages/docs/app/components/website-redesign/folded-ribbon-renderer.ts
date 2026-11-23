/**
 * WebGL2 renderer for the homepage hero's folded ribbon: a long strip folded
 * back on itself, twisted along its length and drifting slowly, lit only by
 * how steeply it turns away from the viewer.
 *
 * Framework-free on purpose: the React wrapper and standalone previews both
 * drive it. Every tunable value is read from CSS custom properties on the host
 * element once per drawn frame, so a stylesheet (or a design tool editing
 * them live) retunes the ribbon without a remount.
 */

export interface RibbonPose {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  roll: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

export const RIBBON_POSES: Record<"wide" | "medium" | "small", RibbonPose> = {
  wide: {
    x: 380,
    y: -301.7,
    z: -11.1,
    pitch: -0.4496,
    yaw: -0.1176,
    roll: 1.8744,
    scaleX: 9,
    scaleY: 8,
    scaleZ: 5,
  },
  medium: {
    x: 525,
    y: -301.7,
    z: -11.1,
    pitch: -0.64,
    yaw: -0.1176,
    roll: 1.68,
    scaleX: 9,
    scaleY: 8,
    scaleZ: 5,
  },
  small: {
    x: 320,
    y: -315,
    z: -11.1,
    pitch: -0.5,
    yaw: -0.1176,
    roll: 1.64,
    scaleX: 9,
    scaleY: 8,
    scaleZ: 5,
  },
};

/** CSS custom properties the renderer reads, with their defaults. */
export const RIBBON_KNOBS = {
  "--ribbon-speed": 1,
  "--ribbon-twist": 1,
  "--ribbon-ripple": -7.821,
  "--ribbon-glow": 1.98,
  "--ribbon-fibre": 0.2,
  "--ribbon-grain": 1.1,
  "--ribbon-saturation": 1,
  "--ribbon-hue": 0,
  "--ribbon-explode": 0,
  /** Negative means "run"; zero or more pins the clock to that many ms. */
  "--ribbon-time": -1,
} as const;

export type RibbonKnob = keyof typeof RIBBON_KNOBS;

/** The page colour behind the ribbon, so its softened edges blend into it. */
export const RIBBON_BACKDROP_VAR = "--ribbon-backdrop";

/** Palette stops, painted as soft blobs into the ribbon's colour map. */
export const RIBBON_COLOR_VARS = [
  "--ribbon-color-1",
  "--ribbon-color-2",
  "--ribbon-color-3",
  "--ribbon-color-4",
  "--ribbon-color-5",
  "--ribbon-color-6",
] as const;

const BASE_SPEED = 0.00004;
/** Where the drift starts: picks the opening drape of the ribbon. */
const CLOCK_OFFSET_MS = 35000;
const STRIP_LENGTH = 400;
const STRIP_WIDTH = 400;
const SEGMENTS_ACROSS = 128;
const SEGMENTS_ALONG = 256;
const FOLD_HALF_SPAN = 16;
const CAMERA = { x: 100, y: 0, z: 5000 };
const BLUR_SWEEP_RADIANS = 0.02;
const BLUR_TAPS = 6;
/** Draw on every other display frame, ~30 fps on a 60 Hz screen. */
const FRAME_STRIDE = 2;
const INTRO_RAMP_PER_FRAME = 0.016;
const MAX_DEVICE_PIXEL_RATIO = 2;

const NOISE_GLSL = /* glsl */ `
uint rotl17(uint v) {
  return (v << 17u) | (v >> 15u);
}

// The gradient field is part of the look: each lattice cell's direction comes
// from an xxHash32-style round over the bits of its float coordinates, so the
// ripples land in the same places as the reference composition.
vec2 ribbonGradient(vec2 cell) {
  uvec2 bits = floatBitsToUint(cell);
  uint h = rotl17(bits.x * 0xc2b2ae3du + 0x165667b9u) * 0x27d4eb2fu;
  h = rotl17(h + bits.y * 0xc2b2ae3du) * 0x27d4eb2fu;
  h = (h ^ (h >> 15u)) * 0x85ebca77u;
  h = (h ^ (h >> 13u)) * 0xc2b2ae3du;
  h ^= h >> 16u;
  float unit = uintBitsToFloat((h >> 9u) | 0x3f800000u) - 1.0;
  float turn = 6.28318530718 * unit;
  return vec2(cos(turn), sin(turn));
}

// 2D simplex noise with a cubic falloff kernel, normalised to roughly [-1, 1].
float ribbonNoise(vec2 p) {
  const float SKEW = 0.36602540378;
  const float UNSKEW = 0.21132486540;
  vec2 cell = floor(p + dot(p, vec2(SKEW)));
  vec2 d0 = p - cell + dot(cell, vec2(UNSKEW));
  vec2 stepTo = d0.x >= d0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 d1 = d0 - stepTo + UNSKEW;
  vec2 d2 = d0 - 1.0 + 2.0 * UNSKEW;
  vec3 falloff = max(vec3(0.5) - vec3(dot(d0, d0), dot(d1, d1), dot(d2, d2)), 0.0);
  vec3 kernel = falloff * falloff * falloff;
  vec3 ramps = vec3(
    dot(d0, ribbonGradient(cell)),
    dot(d1, ribbonGradient(cell + stepTo)),
    dot(d2, ribbonGradient(cell + 1.0))
  );
  return 32.99 * dot(kernel, ramps);
}
`;

const RIBBON_VERTEX = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec3 a_position;
in vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_viewProjection;
uniform float u_clock;
uniform float u_twist;
uniform float u_ripple;
uniform float u_explode;
out vec2 v_uv;
${NOISE_GLSL}

// Long-tailed falloff: 1 at x = 0, collapsing toward 0 as x grows.
float taper(float x, float sharpness) {
  return exp2(-exp2(sharpness) * pow(x, sharpness));
}

vec3 spin(vec3 p, vec3 axis, float angle) {
  axis = normalize(axis);
  float c = cos(angle);
  return p * c + cross(axis, p) * sin(angle) + axis * dot(axis, p) * (1.0 - c);
}

void main() {
  v_uv = a_uv;
  vec3 p = a_position;
  p.y += u_ripple * ribbonNoise(vec2(p.x * 0.005831 + u_clock, p.z * 0.016001 + u_clock));
  p.y += u_explode * (a_uv.x < 0.46 ? -18.0 : 18.0);
  p = spin(p, vec3(0.5, 0.0, 0.5), u_twist * 0.41 * taper(a_uv.x, 0.7));
  p = spin(p, vec3(0.0, 0.5, 0.5), u_twist * -0.65 * taper(a_uv.y, 3.63));
  p = spin(p, vec3(0.5, 0.0, 0.5), u_twist * -0.58 * taper(a_uv.y, 3.95));
  gl_Position = u_viewProjection * u_model * vec4(p, 1.0);
}
`;

const RIBBON_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
uniform sampler2D u_palette;
uniform float u_screenHeight;
uniform float u_glow;
uniform float u_fibre;
uniform float u_saturation;
uniform float u_hue;
out vec4 outColor;
${NOISE_GLSL}

vec3 rotateHue(vec3 c, float radians) {
  vec3 grey = vec3(0.57735);
  vec3 along = grey * dot(grey, c);
  vec3 across = c - along;
  return along + across * cos(radians) + cross(grey, across) * sin(radians);
}

void main() {
  // How fast the strip's length coordinate sweeps past a screen row: large
  // where the surface faces us, near zero (or negative) where it turns away.
  float facing = dFdy(v_uv.y) * u_screenHeight * u_glow;
  facing = clamp(facing * 0.5 + 0.5, 0.0, 1.0);
  facing = smoothstep(0.0, 0.834, pow(facing, 0.806));

  vec3 color = texture(u_palette, v_uv).rgb;

  float edge = 1.0 - pow(4.0 * v_uv.x * (1.0 - v_uv.x), 3.0);
  float warp = ribbonNoise(vec2(v_uv.x * 0.1, v_uv.y * 0.5));
  float fibres = ribbonNoise(vec2(v_uv.x * (600.0 + 300.0 * warp), v_uv.y * 4.0 * warp)) * 0.5 + 0.5;
  color += fibres * u_fibre * (1.0 - color.b * 0.9) * facing * edge;

  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(luma), color, u_saturation);
  color = rotateHue(color, u_hue);
  color = clamp(color + (1.0 - facing) * 0.25, 0.0, 1.0);
  // Squaring deepens the mid-tones; the palette is authored for this.
  outColor = vec4(color * color, 1.0);
}
`;

const FINISH_VERTEX = /* glsl */ `#version 300 es
in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner * 0.5 + 0.5;
  gl_Position = vec4(a_corner, 0.0, 1.0);
}
`;

const FINISH_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform float u_grain;
out vec4 outColor;

void main() {
  // A slight swirl about the centre, strongest toward the top and bottom.
  vec2 offset = v_uv - 0.5;
  float step = ${BLUR_SWEEP_RADIANS.toFixed(4)} / ${BLUR_TAPS.toFixed(1)};
  mat2 turn = mat2(cos(step), sin(step), -sin(step), cos(step));
  vec4 swirl = vec4(0.0);
  for (int i = 0; i < ${BLUR_TAPS}; i++) {
    swirl += texture(u_scene, offset + 0.5);
    offset = turn * offset;
  }
  swirl /= ${BLUR_TAPS.toFixed(1)};
  vec4 sharp = texture(u_scene, v_uv);
  float keepSharp = smoothstep(0.0, 0.7, v_uv.y) - smoothstep(0.2, 1.0, v_uv.y);
  vec4 color = mix(swirl, sharp, keepSharp);

  float speck = fract(sin(dot(gl_FragCoord.xy * 0.01, vec2(41.27, 93.11))) * 24634.6345);
  color.rgb += mix(1.0, -1.0, speck) * u_grain * (4.0 / 255.0) * color.a;
  outColor = vec4(min(color.rgb, vec3(1.0)), color.a);
}
`;

type Mat4 = Float32Array;

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function modelMatrix(pose: RibbonPose): Mat4 {
  const [cx, sx] = [Math.cos(pose.pitch), Math.sin(pose.pitch)];
  const [cy, sy] = [Math.cos(pose.yaw), Math.sin(pose.yaw)];
  const [cz, sz] = [Math.cos(pose.roll), Math.sin(pose.roll)];
  // Rotation applied as X * Y * Z (intrinsic X, then Y, then Z), column-major.
  const r = [
    cy * cz,
    cx * sz + sx * sy * cz,
    sx * sz - cx * sy * cz,
    -cy * sz,
    cx * cz - sx * sy * sz,
    sx * cz + cx * sy * sz,
    sy,
    -sx * cy,
    cx * cy,
  ];
  return new Float32Array([
    r[0] * pose.scaleX,
    r[1] * pose.scaleX,
    r[2] * pose.scaleX,
    0,
    r[3] * pose.scaleY,
    r[4] * pose.scaleY,
    r[5] * pose.scaleY,
    0,
    r[6] * pose.scaleZ,
    r[7] * pose.scaleZ,
    r[8] * pose.scaleZ,
    0,
    pose.x,
    pose.y,
    pose.z,
    1,
  ]);
}

function viewProjection(width: number, height: number): Mat4 {
  const eye = CAMERA;
  const len = Math.hypot(eye.x, eye.y, eye.z);
  const back = [eye.x / len, eye.y / len, eye.z / len];
  const sideLen = Math.hypot(back[2], back[0]);
  const side = [back[2] / sideLen, 0, -back[0] / sideLen];
  const up = [
    back[1] * side[2] - back[2] * side[1],
    back[2] * side[0] - back[0] * side[2],
    back[0] * side[1] - back[1] * side[0],
  ];
  const dot = (v: number[]) => v[0] * eye.x + v[1] * eye.y + v[2] * eye.z;
  const view = new Float32Array([
    side[0],
    up[0],
    back[0],
    0,
    side[1],
    up[1],
    back[1],
    0,
    side[2],
    up[2],
    back[2],
    0,
    -dot(side),
    -dot(up),
    -dot(back),
    1,
  ]);
  const near = 0;
  const far = 10000;
  const projection = new Float32Array([
    2 / width,
    0,
    0,
    0,
    0,
    2 / height,
    0,
    0,
    0,
    0,
    -2 / (far - near),
    0,
    0,
    0,
    -(far + near) / (far - near),
    1,
  ]);
  return multiply(projection, view);
}

interface StripMesh {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** The strip, folded back on itself around a tight half-cylinder. */
export function buildFoldedStrip(): StripMesh {
  const across = SEGMENTS_ACROSS + 1;
  const along = SEGMENTS_ALONG + 1;
  const positions = new Float32Array(across * along * 3);
  const uvs = new Float32Array(across * along * 2);
  let p = 0;
  let t = 0;
  for (let row = 0; row < along; row++) {
    const v = 1 - row / SEGMENTS_ALONG;
    const y = STRIP_LENGTH / 2 - (row * STRIP_LENGTH) / SEGMENTS_ALONG;
    // Layers sit 4 apart at the ends and pinch to 2 through the middle.
    const gap = 4 - 2 * Math.pow(4 * v * (1 - v), 9.5);
    for (let col = 0; col < across; col++) {
      const u = col / SEGMENTS_ACROSS;
      let x = (col * STRIP_WIDTH) / SEGMENTS_ACROSS - STRIP_WIDTH / 2;
      let z = 0;
      if (x < -FOLD_HALF_SPAN) {
        z = gap;
      } else if (x < FOLD_HALF_SPAN) {
        const along01 = (x + FOLD_HALF_SPAN) / (2 * FOLD_HALF_SPAN);
        z = Math.cos(along01 * Math.PI) * gap;
        x = Math.cos((along01 - 0.5) * Math.PI) * gap - FOLD_HALF_SPAN;
      } else {
        z = -gap;
        x = -x;
      }
      x += STRIP_WIDTH / 4;
      // Lay the strip along X, thickness along Y, folded width along Z.
      positions[p++] = y;
      positions[p++] = z;
      positions[p++] = x;
      uvs[t++] = u;
      uvs[t++] = v;
    }
  }
  const indices = new Uint32Array(SEGMENTS_ACROSS * SEGMENTS_ALONG * 6);
  let i = 0;
  for (let row = 0; row < SEGMENTS_ALONG; row++) {
    for (let col = 0; col < SEGMENTS_ACROSS; col++) {
      const a = row * across + col;
      const b = a + across;
      indices[i++] = a;
      indices[i++] = b;
      indices[i++] = a + 1;
      indices[i++] = b;
      indices[i++] = b + 1;
      indices[i++] = a + 1;
    }
  }
  return { positions, uvs, indices };
}

/**
 * Where each palette slot lands on the strip, as soft ellipses in texture
 * space (x across the strip, y down its length from the leading end):
 * [x, y, radiusX, radiusY, slot]. Slot 6 is the base wash under everything.
 * Slot 1 fills the upper body, 2 the inner layer and lower band, 3 warms the
 * middle, 4 is a cool glint, 5 deepens the trailing end.
 */
const PALETTE_BLOBS: readonly (readonly [
  number,
  number,
  number,
  number,
  number,
])[] = [
  [0.3, 0.22, 0.17, 0.28, 1],
  [0.9, 0.5, 0.06, 0.14, 1],
  [0.18, 0.6, 0.15, 0.22, 2],
  [0.7, 0.18, 0.12, 0.25, 2],
  [0.38, 0.62, 0.12, 0.18, 3],
  [0.62, 0.8, 0.12, 0.14, 3],
  [0.72, 0.48, 0.08, 0.1, 4],
  [0.08, 0.92, 0.1, 0.12, 5],
  [0.88, 0.9, 0.1, 0.14, 5],
];

/** Soft, overlapping blobs of each palette colour, like a long-exposure smear. */
export function paintPalette(colors: readonly string[], size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const slot = (n: number) => colors[n - 1] ?? colors[colors.length - 1] ?? "";
  ctx.fillStyle = slot(6);
  ctx.fillRect(0, 0, size, size);
  ctx.filter = `blur(${Math.round(size * 0.06)}px)`;
  for (const [x, y, rx, ry, n] of PALETTE_BLOBS) {
    ctx.fillStyle = slot(n);
    ctx.beginPath();
    ctx.ellipse(x * size, y * size, rx * size, ry * size, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // A thin pale streak down the middle reads as a crease catching light.
  ctx.filter = `blur(${Math.round(size * 0.012)}px)`;
  ctx.fillStyle = slot(6);
  ctx.fillRect(size * 0.49, 0, size * 0.02, size);
  return canvas;
}

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Could not create a ribbon shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? "Ribbon shader failed");
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Ribbon program failed");
  }
  return program;
}

export interface RibbonRendererOptions {
  /** Element whose CSS custom properties tune the ribbon. Defaults to the canvas. */
  knobSource?: Element;
  /** Draw a single still frame and never animate. */
  still?: boolean;
  /** Skip the swirl-and-grain finishing pass. */
  skipFinish?: boolean;
  /** Hold one composition instead of following the viewport's breakpoint. */
  pose?: RibbonPose;
  /**
   * Frame this many CSS pixels of the scene regardless of the canvas's own
   * size, so a thumbnail shows the same composition as the full hero.
   */
  frame?: { width: number; height: number };
}

export interface RibbonRenderer {
  setVisible(visible: boolean): void;
  resize(): void;
  dispose(): void;
}

export function createRibbonRenderer(
  canvas: HTMLCanvasElement,
  options: RibbonRendererOptions = {},
): RibbonRenderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
  });
  if (!gl) return null;

  const knobSource = options.knobSource ?? canvas;
  const ribbon = compile(gl, RIBBON_VERTEX, RIBBON_FRAGMENT);
  const finish = compile(gl, FINISH_VERTEX, FINISH_FRAGMENT);
  const strip = buildFoldedStrip();

  const ribbonVao = gl.createVertexArray();
  gl.bindVertexArray(ribbonVao);
  const bindAttribute = (
    program: WebGLProgram,
    name: string,
    data: Float32Array,
    size: number,
  ) => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };
  bindAttribute(ribbon, "a_position", strip.positions, 3);
  bindAttribute(ribbon, "a_uv", strip.uvs, 2);
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, strip.indices, gl.STATIC_DRAW);

  const finishVao = gl.createVertexArray();
  gl.bindVertexArray(finishVao);
  bindAttribute(
    finish,
    "a_corner",
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    2,
  );
  gl.bindVertexArray(null);

  const uniform = (program: WebGLProgram, name: string) =>
    gl.getUniformLocation(program, name);
  const at = {
    model: uniform(ribbon, "u_model"),
    viewProjection: uniform(ribbon, "u_viewProjection"),
    clock: uniform(ribbon, "u_clock"),
    twist: uniform(ribbon, "u_twist"),
    ripple: uniform(ribbon, "u_ripple"),
    explode: uniform(ribbon, "u_explode"),
    palette: uniform(ribbon, "u_palette"),
    screenHeight: uniform(ribbon, "u_screenHeight"),
    glow: uniform(ribbon, "u_glow"),
    fibre: uniform(ribbon, "u_fibre"),
    saturation: uniform(ribbon, "u_saturation"),
    hue: uniform(ribbon, "u_hue"),
    scene: uniform(finish, "u_scene"),
    grain: uniform(finish, "u_grain"),
  };

  const paletteTexture = gl.createTexture();
  let paletteKey = "";
  const sceneTexture = gl.createTexture();
  const sceneDepth = gl.createRenderbuffer();
  const sceneTarget = gl.createFramebuffer();
  let width = 0;
  let height = 0;

  const readKnobs = () => {
    const style = getComputedStyle(knobSource);
    const knobs = { ...RIBBON_KNOBS } as Record<RibbonKnob, number>;
    for (const name of Object.keys(RIBBON_KNOBS) as RibbonKnob[]) {
      const raw = parseFloat(style.getPropertyValue(name));
      if (Number.isFinite(raw)) knobs[name] = raw;
    }
    const colors = RIBBON_COLOR_VARS.map((name) =>
      style.getPropertyValue(name).trim(),
    ).filter(Boolean);
    const backdrop = style.getPropertyValue(RIBBON_BACKDROP_VAR).trim();
    return { knobs, colors, backdrop };
  };

  let backdropKey = "";
  let backdropRgb: [number, number, number] = [0, 0, 0];
  const resolveBackdrop = (value: string) => {
    if (value === backdropKey) return backdropRgb;
    backdropKey = value;
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe || !value) return (backdropRgb = [0, 0, 0]);
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    return (backdropRgb = [r / 255, g / 255, b / 255]);
  };

  const refreshPalette = (colors: string[]) => {
    const key = colors.join(",");
    if (key === paletteKey || colors.length === 0) return;
    paletteKey = key;
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      paintPalette(colors),
    );
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      canvas.width,
      canvas.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, sceneDepth);
    gl.renderbufferStorage(
      gl.RENDERBUFFER,
      gl.DEPTH_COMPONENT24,
      canvas.width,
      canvas.height,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      sceneTexture,
      0,
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      sceneDepth,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const poseFor = (): RibbonPose => {
    if (options.pose) return options.pose;
    const viewport = window.innerWidth;
    if (viewport < 640) return RIBBON_POSES.small;
    if (viewport < 1264) return RIBBON_POSES.medium;
    return RIBBON_POSES.wide;
  };

  const draw = (elapsedMs: number) => {
    const { knobs, colors, backdrop } = readKnobs();
    refreshPalette(colors);
    const [backR, backG, backB] = resolveBackdrop(backdrop);
    const clockMs =
      knobs["--ribbon-time"] >= 0 ? knobs["--ribbon-time"] : elapsedMs;
    const clock =
      (CLOCK_OFFSET_MS + clockMs) * BASE_SPEED * knobs["--ribbon-speed"];

    gl.bindFramebuffer(gl.FRAMEBUFFER, options.skipFinish ? null : sceneTarget);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(backR, backG, backB, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(ribbon);
    gl.bindVertexArray(ribbonVao);
    gl.uniformMatrix4fv(at.model, false, modelMatrix(poseFor()));
    gl.uniformMatrix4fv(
      at.viewProjection,
      false,
      viewProjection(
        options.frame?.width ?? width,
        options.frame?.height ?? height,
      ),
    );
    gl.uniform1f(at.clock, clock);
    gl.uniform1f(at.twist, knobs["--ribbon-twist"]);
    gl.uniform1f(at.ripple, knobs["--ribbon-ripple"]);
    gl.uniform1f(at.explode, knobs["--ribbon-explode"]);
    gl.uniform1f(at.screenHeight, canvas.height);
    gl.uniform1f(at.glow, knobs["--ribbon-glow"]);
    gl.uniform1f(at.fibre, knobs["--ribbon-fibre"]);
    gl.uniform1f(at.saturation, knobs["--ribbon-saturation"]);
    gl.uniform1f(at.hue, knobs["--ribbon-hue"]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
    gl.uniform1i(at.palette, 0);
    gl.drawElements(gl.TRIANGLES, strip.indices.length, gl.UNSIGNED_INT, 0);

    if (options.skipFinish) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(finish);
    gl.bindVertexArray(finishVao);
    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.uniform1i(at.scene, 0);
    gl.uniform1f(at.grain, knobs["--ribbon-grain"]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  let frame = 0;
  let drawnFrames = 0;
  let introRamp = 0;
  let runningMs = 0;
  let lastTick: number | null = null;
  let visible = true;

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    drawnFrames++;
    if (drawnFrames % FRAME_STRIDE !== 0) return;
    if (lastTick !== null) runningMs += now - lastTick;
    lastTick = now;
    draw(runningMs * introRamp);
    introRamp = Math.min(1, introRamp + INTRO_RAMP_PER_FRAME);
  };

  const start = () => {
    if (frame || options.still || !visible) return;
    lastTick = null;
    frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  resize();
  if (options.still) {
    draw(0);
  } else {
    start();
  }

  return {
    setVisible(next) {
      visible = next;
      if (next) start();
      else stop();
    },
    resize() {
      resize();
      if (options.still || !frame) draw(runningMs * introRamp);
    },
    dispose() {
      stop();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
