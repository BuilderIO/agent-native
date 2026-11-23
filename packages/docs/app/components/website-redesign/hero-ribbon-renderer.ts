import { buildRibbonSheet } from "./hero-ribbon-geometry";

export interface RibbonPose {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface RibbonSettings {
  speed: number;
  displace: number;
  twistX: number;
  twistY: number;
  twistZ: number;
  glow: number;
  hue: number;
  saturation: number;
  blur: number;
  grain: number;
}

const BASE_SPEED = 4e-5;
// The resting pose is the ribbon clock at 35 s; any other start reshapes it.
const TIME_OFFSET = 35000;
const HUE_BIAS = -0.00159265358979299;

const SHAPE = {
  displaceFrequencyX: 0.005831,
  displaceFrequencyZ: 0.016001,
  twistPowerX: 3.63,
  twistPowerY: 0.7,
  twistPowerZ: 3.95,
  glowPower: 0.806,
  glowRamp: 0.834,
  contrast: 1,
};

const WIDE_POSE: RibbonPose = {
  position: [380, -301.7, -11.1],
  rotation: [-0.449592653589793, -0.117592653589793, 1.87440734641021],
  scale: [9, 8, 5],
};

export const RIBBON_POSES = {
  wide: WIDE_POSE,
  medium: {
    ...WIDE_POSE,
    position: [525, -301.7, -11.1],
    rotation: [-0.64, -0.117592653589793, 1.68],
  },
  small: {
    ...WIDE_POSE,
    position: [320, -315, -11.1],
    rotation: [-0.5, -0.117592653589793, 1.64],
  },
} satisfies Record<string, RibbonPose>;

export const DEFAULT_RIBBON_SETTINGS: RibbonSettings = {
  speed: 1,
  displace: -7.821,
  twistX: -0.65,
  twistY: 0.41,
  twistZ: -0.58,
  glow: 1.98,
  hue: 0,
  saturation: 1,
  blur: 0.02,
  grain: 1.1,
};

const NOISE_GLSL = /* glsl */ `
const float TAU = 6.283185307;

uint rotl17(uint h) {
  return (h << 17u) | (h >> 15u);
}

float latticeHash(vec2 cell) {
  uvec2 bits = floatBitsToUint(cell);
  uint h = bits.x * 0xc2b2ae3du + 0x165667b9u;
  h = rotl17(h) * 0x27d4eb2fu;
  h += bits.y * 0xc2b2ae3du;
  h = rotl17(h) * 0x27d4eb2fu;
  h = (h ^ (h >> 15u)) * 0x85ebca77u;
  h = (h ^ (h >> 13u)) * 0xc2b2ae3du;
  h ^= h >> 16u;
  return uintBitsToFloat((h >> 9u) | 0x3f800000u) - 1.0;
}

float gradientDot(vec2 cell, vec2 offset) {
  float angle = TAU * latticeHash(cell);
  return dot(offset, vec2(cos(angle), sin(angle)));
}

float simplex2(vec2 p) {
  const float SKEW = 0.366025404;
  const float UNSKEW = 0.211324865;
  vec2 cell = floor(p + (p.x + p.y) * SKEW);
  vec2 d0 = p - cell + (cell.x + cell.y) * UNSKEW;
  vec2 corner = d0.x >= d0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 d1 = d0 - corner + UNSKEW;
  vec2 d2 = d0 - 1.0 + 2.0 * UNSKEW;
  vec3 falloff = max(0.5 - vec3(dot(d0, d0), dot(d1, d1), dot(d2, d2)), 0.0);
  vec3 contributions = falloff * falloff * falloff * vec3(
    gradientDot(cell, d0),
    gradientDot(cell + corner, d1),
    gradientDot(cell + 1.0, d2)
  );
  return dot(contributions, vec3(32.99));
}
`;

const SHEET_VERTEX = /* glsl */ `#version 300 es
precision highp float;

in vec3 a_position;
in vec2 a_uv;

uniform mat4 u_projectionView;
uniform mat4 u_model;
uniform float u_time;
uniform float u_displaceAmount;
uniform vec2 u_displaceFrequency;
uniform vec3 u_twist;
uniform vec3 u_twistPower;

out vec2 v_uv;

${NOISE_GLSL}

float decay(float s, float power) {
  return exp2(-exp2(power) * pow(s, power));
}

vec3 spin(vec3 p, vec3 axis, float angle) {
  vec3 k = normalize(axis);
  float c = cos(angle);
  return p * c + cross(k, p) * sin(angle) + k * dot(k, p) * (1.0 - c);
}

void main() {
  v_uv = a_uv;
  vec3 p = a_position;
  p.y += u_displaceAmount * simplex2(vec2(
    p.x * u_displaceFrequency.x + u_time,
    p.z * u_displaceFrequency.y + u_time
  ));
  p = spin(p, vec3(1.0, 0.0, 1.0), u_twist.y * decay(a_uv.x, u_twistPower.y));
  p = spin(p, vec3(0.0, 1.0, 1.0), u_twist.x * decay(a_uv.y, u_twistPower.x));
  p = spin(p, vec3(1.0, 0.0, 1.0), u_twist.z * decay(a_uv.y, u_twistPower.z));
  gl_Position = u_projectionView * u_model * vec4(p, 1.0);
}
`;

const SHEET_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_palette;
uniform float u_pixelHeight;
uniform vec3 u_glow;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_hue;

out vec4 outColor;

${NOISE_GLSL}

vec3 rotateHue(vec3 color, float angle) {
  vec3 grey = vec3(0.57735);
  vec3 onAxis = grey * dot(grey, color);
  vec3 u = color - onAxis;
  return onAxis + u * cos(angle) + cross(grey, u) * sin(angle);
}

void main() {
  float sheen = dFdy(v_uv).y * u_pixelHeight * u_glow.x;
  sheen = clamp(sheen * 0.5 + 0.5, 0.0, 1.0);
  sheen = clamp(smoothstep(0.0, u_glow.z, pow(sheen, u_glow.y)), 0.0, 1.0);

  vec3 color = texture(u_palette, v_uv).rgb;
  float edgeMask = 1.0 - pow(4.0 * v_uv.x * (1.0 - v_uv.x), 3.0);
  float warp = simplex2(vec2(v_uv.x * 0.1, v_uv.y * 0.5));
  float fibre = simplex2(vec2(v_uv.x * (600.0 + 300.0 * warp), v_uv.y * 4.0 * warp)) * 0.5 + 0.5;
  color += fibre * 0.2 * (1.0 - color.b * 0.9) * sheen * edgeMask;

  color = (color - 0.5) * u_contrast + 0.5;
  color = mix(vec3(dot(color, vec3(0.299, 0.587, 0.114))), color, u_saturation);
  color = rotateHue(color, u_hue);

  outColor = clamp(vec4(color, 1.0) + (1.0 - sheen) * 0.25, 0.0, 1.0);
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
uniform float u_blur;
uniform float u_grain;

out vec4 outColor;

const int SWEEP_TAPS = 6;

void main() {
  float step = u_blur / float(SWEEP_TAPS);
  mat2 turn = mat2(cos(step), -sin(step), sin(step), cos(step));
  vec2 offset = v_uv - 0.5;
  vec4 swept = vec4(0.0);
  for (int i = 0; i < SWEEP_TAPS; i++) {
    swept += texture(u_scene, offset + 0.5);
    offset = turn * offset;
  }
  swept /= float(SWEEP_TAPS);

  float sharpness = smoothstep(0.0, 0.7, v_uv.y) - smoothstep(0.2, 1.0, v_uv.y);
  vec4 color = mix(swept, texture(u_scene, v_uv), sharpness);

  float dither = fract(sin(dot(gl_FragCoord.xy * 0.01, vec2(12.9898, 78.233))) * 43758.5453);
  color.rgb += mix(1.0, -1.0, dither) * u_grain * (4.0 / 255.0);
  outColor = vec4(min(color.rgb, 1.0), color.a);
}
`;

type Mat4 = Float32Array;

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** Translation x rotation (Euler XYZ, intrinsic) x scale, column-major. */
function modelMatrix({ position, rotation, scale }: RibbonPose): Mat4 {
  const [rx, ry, rz] = rotation;
  const [a, b] = [Math.cos(rx), Math.sin(rx)];
  const [c, d] = [Math.cos(ry), Math.sin(ry)];
  const [e, f] = [Math.cos(rz), Math.sin(rz)];
  const [sx, sy, sz] = scale;
  return new Float32Array([
    c * e * sx,
    (a * f + b * e * d) * sx,
    (b * f - a * e * d) * sx,
    0,
    -c * f * sy,
    (a * e - b * f * d) * sy,
    (b * e + a * f * d) * sy,
    0,
    d * sz,
    -b * c * sz,
    a * c * sz,
    0,
    position[0],
    position[1],
    position[2],
    1,
  ]);
}

/** Orthographic camera at (100, 0, 5000) aimed at the origin; 1 unit = 1 CSS px. */
function projectionView(width: number, height: number): Mat4 {
  const eye = [100, 0, 5000];
  const length = Math.hypot(eye[0], eye[2]);
  const back = [eye[0] / length, 0, eye[2] / length];
  const right = [back[2], 0, -back[0]];
  const view = new Float32Array([
    right[0],
    0,
    back[0],
    0,
    0,
    1,
    0,
    0,
    right[2],
    0,
    back[2],
    0,
    -(right[0] * eye[0] + right[2] * eye[2]),
    0,
    -(back[0] * eye[0] + back[2] * eye[2]),
    1,
  ]);
  const near = 1;
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

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Ribbon: could not create shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Ribbon shader failed: ${gl.getShaderInfoLog(shader)}`);
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Ribbon program failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function uniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
  return new Proxy({} as Record<string, WebGLUniformLocation | null>, {
    get: (cache, name: string) =>
      name in cache
        ? cache[name]
        : (cache[name] = gl.getUniformLocation(program, name)),
  });
}

/** Draws the folded ribbon and its finishing pass into a transparent canvas. */
export class RibbonRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly sheetProgram: WebGLProgram;
  private readonly finishProgram: WebGLProgram;
  private readonly sheetUniforms: Record<string, WebGLUniformLocation | null>;
  private readonly finishUniforms: Record<string, WebGLUniformLocation | null>;
  private readonly sheetVao: WebGLVertexArrayObject;
  private readonly finishVao: WebGLVertexArrayObject;
  private readonly indexCount: number;
  private readonly palette: WebGLTexture;
  private readonly sceneTexture: WebGLTexture;
  private readonly sceneDepth: WebGLRenderbuffer;
  private readonly sceneTarget: WebGLFramebuffer;
  private size = { width: 0, height: 0, pixelRatio: 1 };

  static create(canvas: HTMLCanvasElement): RibbonRenderer | null {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
      failIfMajorPerformanceCaveat: true,
    });
    return gl ? new RibbonRenderer(gl) : null;
  }

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.sheetProgram = compile(gl, SHEET_VERTEX, SHEET_FRAGMENT);
    this.finishProgram = compile(gl, FINISH_VERTEX, FINISH_FRAGMENT);
    this.sheetUniforms = uniforms(gl, this.sheetProgram);
    this.finishUniforms = uniforms(gl, this.finishProgram);

    const sheet = buildRibbonSheet();
    this.indexCount = sheet.indices.length;
    this.sheetVao = gl.createVertexArray();
    gl.bindVertexArray(this.sheetVao);
    this.attribute(this.sheetProgram, "a_position", sheet.positions, 3);
    this.attribute(this.sheetProgram, "a_uv", sheet.uvs, 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sheet.indices, gl.STATIC_DRAW);

    this.finishVao = gl.createVertexArray();
    gl.bindVertexArray(this.finishVao);
    this.attribute(
      this.finishProgram,
      "a_corner",
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      2,
    );
    gl.bindVertexArray(null);

    this.palette = this.texture();
    this.sceneTexture = this.texture();
    this.sceneDepth = gl.createRenderbuffer();
    this.sceneTarget = gl.createFramebuffer();
  }

  private attribute(
    program: WebGLProgram,
    name: string,
    data: Float32Array,
    size: number,
  ) {
    const { gl } = this;
    const location = gl.getAttribLocation(program, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  private texture() {
    const { gl } = this;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  /**
   * `srgb` palettes are decoded to linear on sampling, which deepens their
   * colours; `linear` palettes render exactly as authored.
   */
  setPalette(source: TexImageSource, encoding: "srgb" | "linear") {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.palette);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      encoding === "srgb" ? gl.SRGB8_ALPHA8 : gl.RGBA8,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source,
    );
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  resize(width: number, height: number, pixelRatio: number) {
    const { gl } = this;
    const deviceWidth = Math.max(1, Math.round(width * pixelRatio));
    const deviceHeight = Math.max(1, Math.round(height * pixelRatio));
    this.size = { width, height, pixelRatio };
    gl.canvas.width = deviceWidth;
    gl.canvas.height = deviceHeight;

    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      deviceWidth,
      deviceHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneDepth);
    gl.renderbufferStorage(
      gl.RENDERBUFFER,
      gl.DEPTH_COMPONENT24,
      deviceWidth,
      deviceHeight,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.sceneTexture,
      0,
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      this.sceneDepth,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * `clockMs` is the ribbon's own clock: wall time already eased in and scaled
   * by the speed knob by the caller, so changing speed never jumps the pose.
   */
  draw(clockMs: number, pose: RibbonPose, settings: RibbonSettings) {
    const { gl, size } = this;
    const deviceWidth = gl.canvas.width;
    const deviceHeight = gl.canvas.height;
    const time = (TIME_OFFSET + clockMs) * BASE_SPEED;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget);
    gl.viewport(0, 0, deviceWidth, deviceHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    const s = this.sheetUniforms;
    gl.useProgram(this.sheetProgram);
    gl.uniformMatrix4fv(
      s.u_projectionView,
      false,
      projectionView(size.width, size.height),
    );
    gl.uniformMatrix4fv(s.u_model, false, modelMatrix(pose));
    gl.uniform1f(s.u_time, time);
    gl.uniform1f(s.u_displaceAmount, settings.displace);
    gl.uniform2f(
      s.u_displaceFrequency,
      SHAPE.displaceFrequencyX,
      SHAPE.displaceFrequencyZ,
    );
    gl.uniform3f(s.u_twist, settings.twistX, settings.twistY, settings.twistZ);
    gl.uniform3f(
      s.u_twistPower,
      SHAPE.twistPowerX,
      SHAPE.twistPowerY,
      SHAPE.twistPowerZ,
    );
    gl.uniform1f(s.u_pixelHeight, deviceHeight);
    gl.uniform3f(s.u_glow, settings.glow, SHAPE.glowPower, SHAPE.glowRamp);
    gl.uniform1f(s.u_contrast, SHAPE.contrast);
    gl.uniform1f(s.u_saturation, settings.saturation);
    gl.uniform1f(s.u_hue, HUE_BIAS + settings.hue);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.palette);
    gl.uniform1i(s.u_palette, 0);
    gl.bindVertexArray(this.sheetVao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, deviceWidth, deviceHeight);
    gl.disable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const f = this.finishUniforms;
    gl.useProgram(this.finishProgram);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    gl.uniform1i(f.u_scene, 0);
    gl.uniform1f(f.u_blur, settings.blur);
    gl.uniform1f(f.u_grain, settings.grain);
    gl.bindVertexArray(this.finishVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose() {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
